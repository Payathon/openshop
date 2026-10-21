import { createApp } from "./app.ts";
import { connectPglite } from "./db/client.ts";
import { FakePaymentProvider } from "./payments/fake.ts";
import { OpenShop } from "./shop.ts";

export const BASE = "http://openshop.test";

// Thursday 2026-10-15, 10:00 Beijing time.
export const START = new Date("2026-10-15T10:00:00+08:00");

export const nailSchedule = {
  weekly: [6, 0].map((weekday) => ({ weekday, open: "10:00", close: "20:00" })),
  capacity: 1,
  stepMinutes: 30,
  closures: [],
};

export async function setup() {
  let now = START;
  const payments = new FakePaymentProvider(BASE);
  const shop = new OpenShop({ db: await connectPglite(), payments, clock: () => now, baseUrl: BASE });
  const app = createApp(shop, payments);

  async function call(method: string, path: string, opts: { token?: string; orderToken?: string; body?: unknown } = {}) {
    const res = await app.request(`${BASE}${path}`, {
      method,
      headers: {
        ...(opts.token ? { authorization: `Bearer ${opts.token}` } : {}),
        ...(opts.orderToken ? { "x-order-token": opts.orderToken } : {}),
        ...(opts.body === undefined ? {} : { "content-type": "application/json" }),
      },
      ...(opts.body === undefined ? {} : { body: JSON.stringify(opts.body) }),
    });
    const text = await res.text();
    return { status: res.status, body: text ? JSON.parse(text) : null };
  }

  // Asserts a 2xx and returns the body.
  async function ok(method: string, path: string, opts: Parameters<typeof call>[2] = {}) {
    const r = await call(method, path, opts);
    if (r.status >= 300) throw new Error(`${method} ${path} -> ${r.status} ${JSON.stringify(r.body)}`);
    return r.body;
  }

  // A nail studio open weekends 10–20 with one technician and a 90-minute French manicure.
  async function nailStudio() {
    const created = await ok("POST", "/api/shops", {
      body: {
        slug: "nail-studio",
        name: "小美美甲",
        industry: "nail",
        phone: "13800000000",
        address: "杭州市西湖区文三路 1 号",
        schedule: nailSchedule,
        cancelPolicy: { freeCancelHoursBefore: 24 },
      },
    });
    const token = created.merchantToken as string;
    const product = await ok("POST", "/api/merchant/products", {
      token,
      body: {
        name: "法式美甲",
        fulfillment: "booking",
        durationMinutes: 90,
        orderOptions: [{ key: "color", label: "颜色", type: "choice", choices: ["裸粉", "酒红"], required: true }],
        variants: [{ priceFen: 16800 }],
      },
    });
    await ok("POST", "/api/merchant/publish", { token });
    return { token, product, variantId: product.variants[0].id as string };
  }

  // A bakery shipping cookies in two sizes.
  async function bakery() {
    const created = await ok("POST", "/api/shops", {
      body: { slug: "bakery", name: "麦香烘焙", industry: "bakery", phone: "13900000000" },
    });
    const token = created.merchantToken as string;
    const product = await ok("POST", "/api/merchant/products", {
      token,
      body: {
        name: "黄油曲奇",
        fulfillment: "shipping",
        variants: [
          { attributes: { 规格: "小盒" }, priceFen: 3800, stock: 1 },
          { attributes: { 规格: "大盒" }, priceFen: 6800, stock: 10 },
        ],
      },
    });
    await ok("POST", "/api/merchant/publish", { token });
    return { token, product, smallId: product.variants[0].id as string, largeId: product.variants[1].id as string };
  }

  // What the customer's confirmation in Alipay does in the fake provider.
  // Returns where the cashier sends the customer afterwards (web orders only).
  async function pay(order: { paymentUrl: string }) {
    const res = await app.request(order.paymentUrl, { method: "POST" });
    if (res.status !== 200 && res.status !== 303) throw new Error(`fake pay failed: ${res.status}`);
    return res.headers.get("location");
  }

  return {
    shop,
    app,
    payments,
    call,
    ok,
    nailStudio,
    bakery,
    pay,
    advance(ms: number) {
      now = new Date(now.getTime() + ms);
    },
  };
}

export const customer = { name: "王小姐", phone: "13700000000" };
export const address = { recipient: "王小姐", phone: "13700000000", region: "浙江省杭州市西湖区", detail: "文一路 100 号" };
