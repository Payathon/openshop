import { OpenShopClient, type Address, type Customer, type FetchImpl, type Order, type Product, type Shop } from "./api.ts";

// What a customer's agent does with a shop: open it from a link, look at products and slots,
// order, and follow the order until it is paid. Shared by the MCP tools and the CLI, so both
// return the same agent-facing shapes: prices in yuan, times in Beijing time.

// The customer's own details, kept on their machine and only saved with their consent.
export interface Profile {
  name?: string;
  phone?: string;
  addresses?: Address[];
}

export interface OrderRecord {
  orderId: string;
  accessToken: string;
  server: string;
  shop: string;
  shopName: string;
  createdAt: string;
}

// Local-only storage (~/.openshop). The remote MCP has none and needs the access token instead.
export interface LocalStore {
  profile(): Promise<Profile>;
  saveProfile(p: Profile): Promise<void>;
  orders(): Promise<OrderRecord[]>;
  saveOrder(r: OrderRecord): Promise<void>;
}

export interface OrderInput {
  items: { variantId: string; quantity?: number; options?: Record<string, string> }[];
  customer: Customer;
  slotStart?: string;
  address?: Address;
}

const SLUG = /^[a-z0-9](?:[a-z0-9-]{1,38}[a-z0-9])$/;
const POLL_MS = 2_000;
const WEEKDAYS = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];
const STATUS_TEXT: Record<Order["status"], string> = {
  pending_payment: "待付款",
  confirmed: "预约成功",
  paid: "已付款，待发货",
  shipped: "已发货",
  completed: "已完成",
  cancelled: "已取消",
  expired: "超时未付款，已关闭",
};

export const yuan = (fen: number) => `¥${(fen / 100).toFixed(2)}`;

// "2026-10-17T06:00:00.000Z" -> "2026-10-17T14:00:00+08:00"
export const beijing = (iso: string) => `${new Date(new Date(iso).getTime() + 8 * 3_600_000).toISOString().slice(0, 19)}+08:00`;

const weekdayOf = (date: string) => WEEKDAYS[new Date(`${date}T12:00:00+08:00`).getUTCDay()]!;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export class Buyer {
  private readonly server: string;
  private readonly fetchImpl: FetchImpl | undefined;
  readonly store: LocalStore | null;
  // The remote MCP only serves its own shops, so a link's host is ignored there.
  private readonly ownShopsOnly: boolean;

  constructor(opts: { server: string; fetch?: FetchImpl; store?: LocalStore; ownShopsOnly?: boolean }) {
    this.server = opts.server;
    this.fetchImpl = opts.fetch;
    this.store = opts.store ?? null;
    this.ownShopsOnly = opts.ownShopsOnly ?? false;
  }

  private client(server = this.server) {
    return new OpenShopClient(server, this.fetchImpl);
  }

  // A share link (https://host/s/nail-studio) or a bare slug.
  locate(ref: string): { client: OpenShopClient; slug: string; server: string } {
    const trimmed = ref.trim();
    if (SLUG.test(trimmed)) return { client: this.client(), slug: trimmed, server: this.server };
    let url: URL;
    try {
      url = new URL(trimmed);
    } catch {
      throw new Error(`"${ref}" 不是店铺链接或店铺地址（形如 https://…/s/nail-studio 或 nail-studio）`);
    }
    const slug = /^\/s\/([a-z0-9-]+)\/?/.exec(url.pathname)?.[1];
    if (!slug) throw new Error(`${ref} 不是 OpenShop 店铺链接，店铺链接的路径形如 /s/<店铺地址>`);
    const server = this.ownShopsOnly ? this.server : url.origin;
    return { client: this.client(server), slug, server };
  }

  async open(ref: string) {
    const { client, slug } = this.locate(ref);
    const [shop, products] = await Promise.all([client.shop(slug), client.products(slug)]);
    return { shop: presentShop(shop), products: products.map(presentProduct) };
  }

  async products(ref: string, query?: string) {
    const { client, slug } = this.locate(ref);
    const all = (await client.products(slug)).map(presentProduct);
    const q = query?.trim().toLowerCase();
    if (!q) return all;
    return all.filter((p) => [p.name, p.description, ...p.info.map((i) => i.value)].some((s) => s.toLowerCase().includes(q)));
  }

  async product(ref: string, productId: string) {
    const { client, slug } = this.locate(ref);
    return presentProduct(await client.product(slug, productId));
  }

  async availability(ref: string, variantId: string, date?: string) {
    const { client, slug } = this.locate(ref);
    const a = await client.availability(slug, variantId, date);
    if (a.fulfillment === "shipping") return { fulfillment: a.fulfillment, stock: a.stock };
    return {
      fulfillment: a.fulfillment,
      date: `${a.date} ${weekdayOf(a.date)}`,
      // Pass `start` back unchanged as slotStart when ordering.
      slots: a.slots.map((s) => ({ start: beijing(s.start), time: `${hhmm(s.start)}–${hhmm(s.end)}`, remaining: s.remaining })),
      ...(a.slots.length === 0 ? { note: "这一天没有可预约的时间（不营业或已约满），换一天再查" } : {}),
    };
  }

  async order(ref: string, input: OrderInput) {
    const { client, slug, server } = this.locate(ref);
    const order = await client.createOrder(slug, { ...input, source: "agent" });
    if (this.store) {
      const shop = await client.shop(slug).catch(() => null);
      await this.store.saveOrder({
        orderId: order.id,
        accessToken: order.accessToken,
        server,
        shop: slug,
        shopName: shop?.name ?? slug,
        createdAt: order.createdAt,
      });
    }
    // Locally the token is kept on disk; remotely the agent must hold on to it.
    return { ...presentOrder(order), ...(this.store ? {} : { accessToken: order.accessToken }) };
  }

  // With waitMs, keeps checking while the order is unpaid, up to that long.
  async status(orderId: string, opts: { accessToken?: string | undefined; waitMs?: number | undefined } = {}) {
    const { client, token } = await this.orderAccess(orderId, opts.accessToken);
    const deadline = Date.now() + (opts.waitMs ?? 0);
    let order = await client.order(orderId, token);
    while (order.status === "pending_payment" && Date.now() + POLL_MS < deadline) {
      await sleep(POLL_MS);
      order = await client.order(orderId, token);
    }
    return presentOrder(order);
  }

  async cancel(orderId: string, accessToken?: string) {
    const { client, token } = await this.orderAccess(orderId, accessToken);
    return presentOrder(await client.cancelOrder(orderId, token));
  }

  // Orders placed from this machine, newest first, with their current status.
  async myOrders() {
    if (!this.store) throw new Error("只有本地版本会记录订单");
    const records = (await this.store.orders()).reverse();
    return Promise.all(
      records.map(async (r) => {
        const order = await this.client(r.server)
          .order(r.orderId, r.accessToken)
          .then(presentOrder, (e: Error) => ({ id: r.orderId, error: e.message }));
        return { shop: r.shopName, ...order };
      }),
    );
  }

  private async orderAccess(orderId: string, accessToken?: string) {
    const record = (await this.store?.orders())?.find((r) => r.orderId === orderId);
    if (record) return { client: this.client(record.server), token: record.accessToken };
    if (!accessToken) throw new Error(`本机没有订单 ${orderId} 的记录，需要下单时返回的 accessToken`);
    return { client: this.client(), token: accessToken };
  }
}

const hhmm = (iso: string) => beijing(iso).slice(11, 16);

function presentShop(s: Shop) {
  return {
    slug: s.slug,
    name: s.name,
    industry: s.industry,
    description: s.description,
    phone: s.phone,
    address: s.address,
    // Only shops that take bookings have opening hours and a cancellation window.
    ...(s.schedule
      ? {
          hours: [...s.schedule.weekly]
            .sort((a, b) => ((a.weekday + 6) % 7) - ((b.weekday + 6) % 7))
            .map((h) => `${WEEKDAYS[h.weekday]} ${h.open}–${h.close}`),
          cancelPolicy: `预约开始前 ${s.cancelPolicy.freeCancelHoursBefore} 小时以上可免费取消并自动退款`,
        }
      : {}),
  };
}

function presentProduct(p: Product) {
  return {
    id: p.id,
    name: p.name,
    description: p.description,
    fulfillment: p.fulfillment,
    ...(p.fulfillment === "booking" ? { durationMinutes: p.durationMinutes } : {}),
    info: p.info,
    // Ask the customer about every required option before ordering.
    orderOptions: p.orderOptions,
    variants: p.variants.map((v) => ({
      id: v.id,
      attributes: v.attributes,
      price: yuan(v.priceFen),
      ...(v.stock === null ? {} : { stock: v.stock }),
    })),
  };
}

export function presentOrder(o: Order) {
  const slotDate = o.slotStart && beijing(o.slotStart).slice(0, 10);
  return {
    id: o.id,
    status: o.status,
    statusText: STATUS_TEXT[o.status],
    items: o.items.map((i) => ({
      name: i.productName,
      attributes: i.attributes,
      options: i.options,
      quantity: i.quantity,
      price: yuan(i.unitFen),
    })),
    total: yuan(o.totalFen),
    customer: o.customer,
    ...(o.slotStart && o.slotEnd ? { slot: `${slotDate} ${weekdayOf(slotDate!)} ${hhmm(o.slotStart)}–${hhmm(o.slotEnd)}` } : {}),
    ...(o.address ? { address: o.address } : {}),
    ...(o.paymentUrl ? { paymentUrl: o.paymentUrl, payBefore: beijing(o.paymentExpiresAt).slice(0, 16).replace("T", " ") } : {}),
    ...(o.refunded ? { refunded: true } : {}),
    ...(o.trackingNo ? { trackingNo: o.trackingNo } : {}),
    next: nextStep(o),
  };
}

function nextStep(o: Order): string {
  switch (o.status) {
    case "pending_payment":
      return "请用户付款：支付宝收银台链接交给支付宝支付技能处理；其他链接（本地模拟收银台）原样发给用户打开。用户说付好了再查询订单状态。超过 payBefore 未付款，订单自动关闭。";
    case "confirmed":
      return "预约成功，告诉用户时间和店铺地址。";
    case "paid":
      return "付款成功，等商家发货。";
    case "shipped":
      return "商家已发货，trackingNo 是快递单号。";
    case "cancelled":
      return o.refunded ? "订单已取消，款项原路退回。" : "订单已取消。";
    case "expired":
      return "订单超时未付款，已关闭；需要的话重新下单。";
    case "completed":
      return "订单已完成。";
  }
}
