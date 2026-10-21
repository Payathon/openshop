import { createHash, randomBytes, randomUUID } from "node:crypto";
import { and, asc, desc, eq, gt, gte, inArray, lt, or, sql } from "drizzle-orm";
import {
  availableSlots,
  canTransition,
  cancellation,
  checkOptionValues,
  fen,
  PAYMENT_TIMEOUT_MS,
  statusAfterPayment,
  type BookingSchedule,
  type CancelPolicy,
  type OrderStatus,
  type ProductInput,
} from "@openshop/core";
import type { Db } from "./db/client.ts";
import { customers, orderItems, orders, products, shops, variants, type Address, type StoredSchedule } from "./db/schema.ts";
import type { PaymentProvider } from "./payments/provider.ts";

export class ShopError extends Error {
  constructor(
    readonly status: 400 | 401 | 404 | 409 | 502,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");
const newToken = (prefix: string) => `${prefix}_${randomBytes(24).toString("base64url")}`;
const newId = (prefix: string) => `${prefix}_${randomUUID().replaceAll("-", "").slice(0, 16)}`;

// Beijing time has no DST, so local dates are a fixed shift away.
const localDate = (d: Date) => new Date(d.getTime() + 8 * 3_600_000).toISOString().slice(0, 10);

type ShopRow = typeof shops.$inferSelect;
type ProductRow = typeof products.$inferSelect;
type VariantRow = typeof variants.$inferSelect;
type OrderRow = typeof orders.$inferSelect;

export interface NewShop {
  slug: string;
  name: string;
  industry: string;
  description?: string | undefined;
  phone: string;
  address?: string | undefined;
  schedule?: StoredSchedule | undefined;
  cancelPolicy?: CancelPolicy | undefined;
}

export interface NewOrder {
  items: { variantId: string; quantity?: number | undefined; options?: Record<string, string> | undefined }[];
  customer: { name: string; phone: string };
  slotStart?: string | undefined;
  address?: Address | undefined;
  source?: "web" | "agent" | undefined;
}

const publicShop = (s: ShopRow) => ({
  id: s.id,
  slug: s.slug,
  name: s.name,
  industry: s.industry,
  description: s.description,
  phone: s.phone,
  address: s.address,
  schedule: s.schedule && { weekly: s.schedule.weekly, capacity: s.schedule.capacity },
  cancelPolicy: s.cancelPolicy,
});

const publicProduct = (p: ProductRow, vs: VariantRow[]) => ({
  id: p.id,
  name: p.name,
  description: p.description,
  images: p.images,
  fulfillment: p.fulfillment,
  durationMinutes: p.durationMinutes,
  orderOptions: p.orderOptions,
  info: p.info,
  published: p.published,
  variants: vs
    .filter((v) => v.productId === p.id && !v.deleted)
    .sort((a, b) => a.position - b.position)
    .map((v) => ({ id: v.id, attributes: v.attributes, priceFen: v.priceFen, stock: v.stock })),
});

export type RenderedOrder = {
  id: string;
  shopId: string;
  status: OrderStatus;
  fulfillment: OrderRow["fulfillment"];
  source: string;
  items: {
    productId: string;
    variantId: string;
    productName: string;
    attributes: Record<string, string>;
    options: Record<string, string>;
    quantity: number;
    unitFen: number;
  }[];
  totalFen: number;
  customer: { name: string; phone: string };
  address: Address | null;
  slotStart: string | null;
  slotEnd: string | null;
  paymentUrl: string | null;
  paymentExpiresAt: string;
  refunded: boolean;
  trackingNo: string | null;
  createdAt: string;
  paidAt: string | null;
};

const toSchedule = (s: StoredSchedule): BookingSchedule => ({
  ...s,
  closures: s.closures.map((c) => ({ start: new Date(c.start), end: new Date(c.end) })),
});

export class OpenShop {
  readonly db: Db;
  readonly payments: PaymentProvider;
  private readonly clock: () => Date;
  readonly baseUrl: string;

  constructor(deps: { db: Db; payments: PaymentProvider; clock?: () => Date; baseUrl: string }) {
    this.db = deps.db;
    this.payments = deps.payments;
    this.clock = deps.clock ?? (() => new Date());
    this.baseUrl = deps.baseUrl;
  }

  // ---- shops ------------------------------------------------------------

  now() {
    return this.clock();
  }

  // The shop's public web address. Path-based for now; subdomains would change only this.
  shopUrl(slug: string) {
    return `${this.baseUrl}/s/${slug}`;
  }

  async createShop(input: NewShop) {
    const token = newToken("osm");
    const row: ShopRow = {
      id: newId("shop"),
      slug: input.slug,
      name: input.name,
      industry: input.industry,
      description: input.description ?? "",
      phone: input.phone,
      address: input.address ?? null,
      schedule: input.schedule ?? null,
      cancelPolicy: input.cancelPolicy ?? { freeCancelHoursBefore: 24 },
      merchantTokenHash: sha256(token),
      createdAt: this.clock(),
    };
    const inserted = await this.db.insert(shops).values(row).onConflictDoNothing({ target: shops.slug }).returning();
    if (inserted.length === 0) throw new ShopError(409, "slug_taken", `店铺地址 ${input.slug} 已被使用`);
    return { shop: publicShop(row), merchantToken: token };
  }

  // Returns the shop id the merchant token belongs to.
  async authenticate(token: string): Promise<string | null> {
    const [s] = await this.db.select({ id: shops.id }).from(shops).where(eq(shops.merchantTokenHash, sha256(token)));
    return s?.id ?? null;
  }

  async getShop(slug: string) {
    return publicShop(await this.shopBySlug(slug));
  }

  private async shopBySlug(slug: string) {
    const [s] = await this.db.select().from(shops).where(eq(shops.slug, slug));
    if (!s) throw new ShopError(404, "shop_not_found", `找不到店铺 ${slug}`);
    return s;
  }

  // ---- products ---------------------------------------------------------
  // Content edits go straight to live data for now; the changeset/preview layer comes in M4.

  async listProducts(slug: string) {
    const shop = await this.shopBySlug(slug);
    const ps = await this.db
      .select()
      .from(products)
      .where(and(eq(products.shopId, shop.id), eq(products.published, true), eq(products.deleted, false)))
      .orderBy(asc(products.createdAt), asc(products.id));
    return this.withVariants(ps);
  }

  async getProduct(slug: string, productId: string) {
    const shop = await this.shopBySlug(slug);
    const [p] = await this.db
      .select()
      .from(products)
      .where(and(eq(products.id, productId), eq(products.shopId, shop.id), eq(products.published, true), eq(products.deleted, false)));
    if (!p) throw new ShopError(404, "product_not_found", "找不到这个商品");
    return (await this.withVariants([p]))[0]!;
  }

  private async withVariants(ps: ProductRow[]) {
    if (ps.length === 0) return [];
    const vs = await this.db.select().from(variants).where(inArray(variants.productId, ps.map((p) => p.id)));
    return ps.map((p) => publicProduct(p, vs));
  }

  async createProduct(shopId: string, input: ProductInput) {
    checkProductShape(input);
    const product: ProductRow = {
      id: newId("prod"),
      shopId,
      name: input.name,
      description: input.description,
      images: input.images,
      fulfillment: input.fulfillment,
      durationMinutes: input.durationMinutes,
      orderOptions: input.orderOptions,
      info: input.info,
      published: input.published,
      deleted: false,
      createdAt: this.clock(),
    };
    const vs = input.variants.map((v, position) => ({
      id: newId("var"),
      productId: product.id,
      shopId,
      position,
      attributes: v.attributes,
      priceFen: v.priceFen,
      stock: input.fulfillment === "shipping" ? (v.stock ?? 0) : null,
      deleted: false,
    }));
    await this.db.transaction(async (tx) => {
      await tx.insert(products).values(product);
      await tx.insert(variants).values(vs);
    });
    return publicProduct(product, vs);
  }

  // Variants are matched by position so existing ids (and order history) stay stable.
  async updateProduct(shopId: string, productId: string, input: ProductInput) {
    checkProductShape(input);
    return this.db.transaction(async (tx) => {
      const [p] = await tx
        .update(products)
        .set({
          name: input.name,
          description: input.description,
          images: input.images,
          fulfillment: input.fulfillment,
          durationMinutes: input.durationMinutes,
          orderOptions: input.orderOptions,
          info: input.info,
          published: input.published,
        })
        .where(and(eq(products.id, productId), eq(products.shopId, shopId), eq(products.deleted, false)))
        .returning();
      if (!p) throw new ShopError(404, "product_not_found", "找不到这个商品");
      const existing = await tx
        .select()
        .from(variants)
        .where(and(eq(variants.productId, productId), eq(variants.deleted, false)))
        .orderBy(asc(variants.position));
      for (const [position, v] of input.variants.entries()) {
        const stock = input.fulfillment === "shipping" ? (v.stock ?? 0) : null;
        const old = existing[position];
        if (old) {
          await tx.update(variants).set({ attributes: v.attributes, priceFen: v.priceFen, stock }).where(eq(variants.id, old.id));
        } else {
          await tx.insert(variants).values({ id: newId("var"), productId, shopId, position, attributes: v.attributes, priceFen: v.priceFen, stock, deleted: false });
        }
      }
      for (const old of existing.slice(input.variants.length)) {
        await tx.update(variants).set({ deleted: true }).where(eq(variants.id, old.id));
      }
      const vs = await tx.select().from(variants).where(eq(variants.productId, productId));
      return publicProduct(p, vs);
    });
  }

  async deleteProduct(shopId: string, productId: string) {
    const r = await this.db
      .update(products)
      .set({ deleted: true })
      .where(and(eq(products.id, productId), eq(products.shopId, shopId)))
      .returning({ id: products.id });
    if (r.length === 0) throw new ShopError(404, "product_not_found", "找不到这个商品");
  }

  // An operational change: takes effect immediately, outside any changeset.
  async setStock(shopId: string, variantId: string, stock: number) {
    const r = await this.db
      .update(variants)
      .set({ stock })
      .where(and(eq(variants.id, variantId), eq(variants.shopId, shopId), sql`${variants.stock} is not null`))
      .returning({ id: variants.id, stock: variants.stock });
    if (r.length === 0) throw new ShopError(404, "variant_not_found", "找不到这个需要库存的规格");
    return r[0]!;
  }

  // ---- availability -----------------------------------------------------

  async availability(slug: string, variantId: string, date?: string) {
    const shop = await this.shopBySlug(slug);
    await this.refreshPending(shop.id);
    const { product, variant } = await this.sellable(shop.id, variantId);
    if (product.fulfillment === "shipping") return { fulfillment: "shipping" as const, stock: variant.stock ?? 0 };
    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new ShopError(400, "invalid_request", "预约类商品需要 date 参数，格式 YYYY-MM-DD");
    const slots = await this.slotsFor(this.db, shop, product, date);
    return { fulfillment: "booking" as const, date, slots };
  }

  private async slotsFor(db: Db, shop: ShopRow, product: ProductRow, date: string) {
    if (!shop.schedule) return [];
    const dayStart = new Date(`${date}T00:00:00+08:00`);
    const dayEnd = new Date(dayStart.getTime() + 24 * 3_600_000);
    const now = this.clock();
    const held = await db
      .select({ start: orders.slotStart, end: orders.slotEnd })
      .from(orders)
      .where(
        and(
          eq(orders.shopId, shop.id),
          eq(orders.fulfillment, "booking"),
          lt(orders.slotStart, dayEnd),
          gt(orders.slotEnd, dayStart),
          or(eq(orders.status, "confirmed"), and(eq(orders.status, "pending_payment"), gt(orders.paymentExpiresAt, now))),
        ),
      );
    return availableSlots({
      date,
      schedule: toSchedule(shop.schedule),
      durationMinutes: product.durationMinutes!,
      bookings: held.map((h) => ({ start: h.start!, end: h.end! })),
      now,
    });
  }

  private async sellable(shopId: string, variantId: string) {
    const [row] = await this.db
      .select({ product: products, variant: variants })
      .from(variants)
      .innerJoin(products, eq(products.id, variants.productId))
      .where(
        and(
          eq(variants.id, variantId),
          eq(variants.shopId, shopId),
          eq(variants.deleted, false),
          eq(products.deleted, false),
          eq(products.published, true),
        ),
      );
    if (!row) throw new ShopError(404, "variant_not_found", `找不到商品规格 ${variantId}`);
    return row;
  }

  // ---- orders -----------------------------------------------------------

  async createOrder(slug: string, input: NewOrder) {
    const shop = await this.shopBySlug(slug);
    await this.refreshPending(shop.id);
    if (input.items.length === 0) throw new ShopError(400, "invalid_request", "订单里没有商品");

    const lines: { product: ProductRow; variant: VariantRow; quantity: number; options: Record<string, string> }[] = [];
    for (const item of input.items) {
      const { product, variant } = await this.sellable(shop.id, item.variantId);
      const checked = checkOptionValues(product.orderOptions, item.options ?? {});
      if (!checked.ok) throw new ShopError(400, "invalid_options", checked.error);
      lines.push({ product, variant, quantity: item.quantity ?? 1, options: checked.values });
    }
    const fulfillment = lines[0]!.product.fulfillment;
    if (lines.some((l) => l.product.fulfillment !== fulfillment)) {
      throw new ShopError(400, "mixed_fulfillment", "预约和购买需要分开下单");
    }

    let slot: { start: Date; end: Date } | null = null;
    if (fulfillment === "booking") {
      if (lines.length !== 1 || lines[0]!.quantity !== 1) throw new ShopError(400, "invalid_request", "一个预约订单只能包含一项服务");
      if (!input.slotStart) throw new ShopError(400, "slot_required", "预约类商品需要选择时间（slotStart）");
      const start = new Date(input.slotStart);
      if (Number.isNaN(start.getTime())) throw new ShopError(400, "invalid_request", "slotStart 不是有效时间");
      slot = { start, end: new Date(start.getTime() + lines[0]!.product.durationMinutes! * 60_000) };
    } else if (!input.address) {
      throw new ShopError(400, "address_required", "需要收货地址");
    }

    const now = this.clock();
    const accessToken = newToken("oso");
    const totalFen = lines.reduce((sum, l) => sum + l.variant.priceFen * l.quantity, 0);
    const order: OrderRow = {
      id: newId("ord"),
      shopId: shop.id,
      status: "pending_payment",
      fulfillment,
      source: input.source ?? "web",
      customerName: input.customer.name,
      customerPhone: input.customer.phone,
      address: fulfillment === "shipping" ? input.address! : null,
      slotStart: slot?.start ?? null,
      slotEnd: slot?.end ?? null,
      totalFen,
      accessTokenHash: sha256(accessToken),
      paymentUrl: null,
      paymentExpiresAt: new Date(now.getTime() + PAYMENT_TIMEOUT_MS),
      refunded: false,
      trackingNo: null,
      createdAt: now,
      paidAt: null,
    };

    await this.db.transaction(async (tx) => {
      if (slot) {
        // Serialises bookings per shop so two customers can't take the last seat together.
        await tx.select({ id: shops.id }).from(shops).where(eq(shops.id, shop.id)).for("update");
        const open = await this.slotsFor(tx as unknown as Db, shop, lines[0]!.product, localDate(slot.start));
        if (!open.some((s) => s.start.getTime() === slot.start.getTime())) {
          throw new ShopError(409, "slot_unavailable", "这个时间已被约满或不在营业时间内，请换一个时间");
        }
      } else {
        for (const l of lines) {
          const r = await tx
            .update(variants)
            .set({ stock: sql`${variants.stock} - ${l.quantity}` })
            .where(and(eq(variants.id, l.variant.id), gte(variants.stock, l.quantity)))
            .returning({ id: variants.id });
          if (r.length === 0) throw new ShopError(409, "out_of_stock", `${l.product.name} 库存不足`);
        }
      }
      await tx.insert(orders).values(order);
      await tx.insert(orderItems).values(
        lines.map((l) => ({
          id: newId("item"),
          orderId: order.id,
          productId: l.product.id,
          variantId: l.variant.id,
          productName: l.product.name,
          attributes: l.variant.attributes,
          options: l.options,
          quantity: l.quantity,
          unitFen: l.variant.priceFen,
        })),
      );
    });

    const subject = `${shop.name} - ${lines.map((l) => l.product.name).join("、")}`.slice(0, 120);
    const { paymentUrl } = await this.payments.createPayment({
      orderId: order.id,
      shopId: shop.id,
      amountFen: fen(totalFen),
      subject,
      expiresAt: order.paymentExpiresAt,
      returnUrl: order.source === "web" ? `${this.shopUrl(shop.slug)}/orders/${order.id}` : undefined,
    });
    await this.db.update(orders).set({ paymentUrl }).where(eq(orders.id, order.id));
    return { ...(await this.renderOrder({ ...order, paymentUrl })), accessToken };
  }

  async getOrder(orderId: string, accessToken: string) {
    const order = await this.orderForCustomer(orderId, accessToken);
    return this.renderOrder(await this.refreshOrder(order));
  }

  async cancelOrder(orderId: string, accessToken: string): Promise<RenderedOrder> {
    const order = await this.refreshOrder(await this.orderForCustomer(orderId, accessToken));
    const [shop] = await this.db.select().from(shops).where(eq(shops.id, order.shopId));
    const decision = cancellation(order, shop!.cancelPolicy, this.clock());
    if (!decision.allowed) throw new ShopError(409, "cancel_not_allowed", decision.reason);
    if (order.status === "pending_payment") {
      await this.payments.closePayment(order.id);
      // Paid in the meantime: fall through to the paid path on the refreshed order.
      if ((await this.payments.queryPayment(order.id)) === "paid") return this.cancelOrder(orderId, accessToken);
    }
    if (decision.refund) await this.payments.refund({ orderId: order.id, amountFen: fen(order.totalFen) });
    const updated = await this.finish(order, "cancelled", { refunded: decision.refund });
    return this.renderOrder(updated);
  }

  private async orderForCustomer(orderId: string, accessToken: string) {
    const [o] = await this.db.select().from(orders).where(eq(orders.id, orderId));
    if (!o || o.accessTokenHash !== sha256(accessToken)) throw new ShopError(404, "order_not_found", "找不到这个订单");
    return o;
  }

  // ---- payment sync -----------------------------------------------------
  // Without a public notify_url we learn about payments by asking. Every read path that
  // depends on order state refreshes pending orders first.

  private async refreshPending(shopId: string) {
    const pending = await this.db.select().from(orders).where(and(eq(orders.shopId, shopId), eq(orders.status, "pending_payment")));
    for (const o of pending) await this.refreshOrder(o);
  }

  private async refreshOrder(order: OrderRow): Promise<OrderRow> {
    if (order.status !== "pending_payment") return order;
    let state = await this.payments.queryPayment(order.id);
    if (state === "pending" && this.clock() >= order.paymentExpiresAt) {
      await this.payments.closePayment(order.id);
      state = await this.payments.queryPayment(order.id);
      if (state !== "paid") return this.finish(order, "expired");
    }
    if (state === "paid") return this.markPaid(order);
    if (state === "closed") return this.finish(order, "expired");
    return order;
  }

  private async markPaid(order: OrderRow): Promise<OrderRow> {
    const now = this.clock();
    return this.db.transaction(async (tx) => {
      const [locked] = await tx.select().from(orders).where(eq(orders.id, order.id)).for("update");
      if (!locked || locked.status !== "pending_payment") return locked!;
      const [paid] = await tx
        .update(orders)
        .set({ status: statusAfterPayment(locked.fulfillment), paidAt: now })
        .where(eq(orders.id, order.id))
        .returning();
      await tx
        .insert(customers)
        .values({
          id: newId("cus"),
          shopId: locked.shopId,
          phone: locked.customerPhone,
          name: locked.customerName,
          orderCount: 1,
          totalFen: locked.totalFen,
          firstOrderAt: now,
          lastOrderAt: now,
        })
        .onConflictDoUpdate({
          target: [customers.shopId, customers.phone],
          set: {
            name: locked.customerName,
            orderCount: sql`${customers.orderCount} + 1`,
            totalFen: sql`${customers.totalFen} + ${locked.totalFen}`,
            lastOrderAt: now,
          },
        });
      return paid!;
    });
  }

  // Ends an order and returns any stock it was holding. Booked slots free themselves
  // because only live orders count against capacity.
  private async finish(order: OrderRow, status: "cancelled" | "expired", extra: { refunded?: boolean } = {}) {
    return this.db.transaction(async (tx) => {
      const [locked] = await tx.select().from(orders).where(eq(orders.id, order.id)).for("update");
      if (!locked || !canTransition(locked.status, status)) return locked!;
      if (locked.fulfillment === "shipping") {
        const items = await tx.select().from(orderItems).where(eq(orderItems.orderId, order.id));
        for (const i of items) {
          await tx.update(variants).set({ stock: sql`${variants.stock} + ${i.quantity}` }).where(eq(variants.id, i.variantId));
        }
      }
      const [done] = await tx.update(orders).set({ status, ...extra }).where(eq(orders.id, order.id)).returning();
      return done!;
    });
  }

  // ---- merchant ---------------------------------------------------------

  async listOrders(shopId: string, status?: OrderStatus) {
    await this.refreshPending(shopId);
    const rows = await this.db
      .select()
      .from(orders)
      .where(and(eq(orders.shopId, shopId), status ? eq(orders.status, status) : undefined))
      .orderBy(desc(orders.createdAt));
    return Promise.all(rows.map((o) => this.renderOrder(o)));
  }

  async shipOrder(shopId: string, orderId: string, trackingNo: string) {
    await this.refreshPending(shopId);
    return this.db.transaction(async (tx) => {
      const [o] = await tx.select().from(orders).where(and(eq(orders.id, orderId), eq(orders.shopId, shopId))).for("update");
      if (!o) throw new ShopError(404, "order_not_found", "找不到这个订单");
      if (!canTransition(o.status, "shipped")) throw new ShopError(409, "invalid_status", "只有已付款、待发货的订单可以发货");
      const [shipped] = await tx.update(orders).set({ status: "shipped", trackingNo }).where(eq(orders.id, orderId)).returning();
      return this.renderOrder(shipped!, tx as unknown as Db);
    });
  }

  async listCustomers(shopId: string) {
    await this.refreshPending(shopId);
    return this.db
      .select({
        id: customers.id,
        name: customers.name,
        phone: customers.phone,
        orderCount: customers.orderCount,
        totalFen: customers.totalFen,
        firstOrderAt: customers.firstOrderAt,
        lastOrderAt: customers.lastOrderAt,
      })
      .from(customers)
      .where(eq(customers.shopId, shopId))
      .orderBy(desc(customers.lastOrderAt));
  }

  private async renderOrder(o: OrderRow, db: Db = this.db): Promise<RenderedOrder> {
    const items = await db.select().from(orderItems).where(eq(orderItems.orderId, o.id));
    return {
      id: o.id,
      shopId: o.shopId,
      status: o.status,
      fulfillment: o.fulfillment,
      source: o.source,
      items: items.map((i) => ({
        productId: i.productId,
        variantId: i.variantId,
        productName: i.productName,
        attributes: i.attributes,
        options: i.options,
        quantity: i.quantity,
        unitFen: i.unitFen,
      })),
      totalFen: o.totalFen,
      customer: { name: o.customerName, phone: o.customerPhone },
      address: o.address,
      slotStart: o.slotStart?.toISOString() ?? null,
      slotEnd: o.slotEnd?.toISOString() ?? null,
      paymentUrl: o.status === "pending_payment" ? o.paymentUrl : null,
      paymentExpiresAt: o.paymentExpiresAt.toISOString(),
      refunded: o.refunded,
      trackingNo: o.trackingNo,
      createdAt: o.createdAt.toISOString(),
      paidAt: o.paidAt?.toISOString() ?? null,
    };
  }
}

function checkProductShape(input: ProductInput) {
  if (input.fulfillment === "booking" && !input.durationMinutes) {
    throw new ShopError(400, "invalid_request", "预约类商品需要填写服务时长（durationMinutes）");
  }
}
