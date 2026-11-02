import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { Buyer } from "@openshop/client/buyer";
import { createMcpServer } from "@openshop/client/mcp";
import { describe, expect, it } from "vitest";
import { seedDemo } from "./seed.ts";
import { address, BASE, customer, setup } from "./test-helpers.ts";

const DAY = 86_400_000;
// A Saturday six weeks out: still ahead once the trial is over, and outside the free-cancel window.
const LATER = new Date("2026-11-28T14:00:00+08:00").toISOString();

async function nail() {
  const t = await setup();
  const n = await t.nailStudio();
  const order = (slotStart = LATER) =>
    t.call("POST", "/api/s/nail-studio/orders", { body: { items: [{ variantId: n.variantId, options: { color: "裸粉" } }], customer, slotStart } });
  const page = async (path: string) => (await t.app.request(`${BASE}/s/nail-studio${path}`)).text();
  return { t, ...n, order, page };
}

describe("taking orders needs 专业版", () => {
  it("takes orders during the trial", async () => {
    const { t, order } = await nail();
    expect(await t.ok("GET", "/api/s/nail-studio")).toMatchObject({ acceptsOrders: true });
    t.advance(13 * DAY);
    expect((await order()).status).toBe(201);
  });

  it("refuses new orders once the trial is over and nothing was paid, telling the customer to call", async () => {
    const { t, order, variantId } = await nail();
    t.advance(14 * DAY);
    const r = await order();
    expect(r.status).toBe(403);
    expect(r.body).toEqual({ error: "shop_not_accepting_orders", message: "小美美甲暂不支持在线下单，请致电 13800000000 联系店铺预约或购买" });

    // The shop page's checkout goes through the same check.
    const web = await t.app.request(`${BASE}/s/nail-studio/checkout`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ items: [{ variantId, options: { color: "裸粉" } }], customer, slotStart: LATER }),
    });
    expect(web.status).toBe(403);
    expect(await web.json()).toMatchObject({ error: "shop_not_accepting_orders" });
    expect(web.headers.get("set-cookie")).toBeNull();

    // Reading the shop and its slots still works.
    expect(await t.ok("GET", "/api/s/nail-studio")).toMatchObject({ acceptsOrders: false, phone: "13800000000" });
    expect((await t.ok("GET", `/api/s/nail-studio/availability?variantId=${variantId}&date=2026-11-28`)).slots.length).toBeGreaterThan(0);
  });

  it("turns the website and discovery files into call-the-shop on the free plan", async () => {
    const { t, product, page } = await nail();
    expect(await page(`/p/${product.id}`)).toContain("预约并支付");
    t.advance(15 * DAY);

    const productPage = await page(`/p/${product.id}`);
    expect(productPage).not.toContain("预约并支付");
    expect(productPage).not.toContain('id="checkout"');
    expect(productPage).toContain('href="tel:13800000000"');
    expect(productPage).toContain("电话预约");

    const shopPage = await page("");
    expect(shopPage).not.toContain('class="row-cta"');
    expect(shopPage).toContain("暂不支持在线预约");
    expect(shopPage).toContain('href="tel:13800000000" data-after=');

    const llms = await page("/llms.txt");
    expect(llms).toContain("暂不支持在线下单，请致电 13800000000");
    expect(llms).not.toContain("openshop-cli order");
    expect(JSON.parse(await page("/.well-known/openshop.json"))).toMatchObject({ acceptsOrders: false, phone: "13800000000" });
  });

  it("tells the customer's agent over MCP to call the shop", async () => {
    const { t } = await nail();
    t.advance(15 * DAY);
    const buyer = new Buyer({ server: BASE, fetch: (url, init) => Promise.resolve(t.app.fetch(new Request(url, init))), ownShopsOnly: true });
    const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
    await createMcpServer(buyer).connect(serverSide);
    const mcp = new Client({ name: "test", version: "0" });
    await mcp.connect(clientSide);
    const opened = (await mcp.callTool({ name: "shop_open", arguments: { shop: "nail-studio" } })) as { content: { text: string }[] };
    const shop = JSON.parse(opened.content[0]!.text).shop;
    expect(shop).toMatchObject({ acceptsOrders: false });
    expect(shop.note).toContain("13800000000");

    const products = JSON.parse(opened.content[0]!.text).products;
    const r = (await mcp.callTool({
      name: "shop_create_order",
      arguments: { shop: "nail-studio", items: [{ variant_id: products[0].variants[0].id, options: { color: "裸粉" } }], customer, slot_start: LATER },
    })) as { content: { text: string }[]; isError?: boolean };
    expect(r.isError).toBe(true);
    expect(r.content[0]!.text).toBe("error: shop_not_accepting_orders: 小美美甲暂不支持在线下单，请致电 13800000000 联系店铺预约或购买");
    await mcp.close();
  });

  it("takes orders after the trial when paid", async () => {
    const { t, token, order } = await nail();
    await t.pay(await t.ok("POST", "/api/merchant/billing/checkout", { token }));
    await t.billing.syncPayments();
    t.advance(30 * DAY);
    expect((await order(new Date("2026-12-05T14:00:00+08:00").toISOString())).status).toBe(201);
    // Past the paid month too: refused again.
    t.advance(15 * DAY);
    expect((await order(new Date("2026-12-26T14:00:00+08:00").toISOString())).status).toBe(403);
  });

  it("takes orders after the trial with a grant", async () => {
    const { t, order } = await nail();
    t.advance(20 * DAY);
    expect((await order()).status).toBe(403);
    await t.billing.grant("nail-studio", 30);
    expect((await order()).status).toBe(201);
  });

  it("keeps serving orders placed before the trial ended", async () => {
    const { t, order } = await nail();
    const booked = (await order()).body;
    await t.pay(booked);
    const b = await t.bakery();
    const parcel = await t.ok("POST", "/api/s/bakery/orders", { body: { items: [{ variantId: b.largeId }], customer, address } });
    await t.pay(parcel);
    t.advance(15 * DAY);

    // The customer cancels in time and is refunded.
    const cancelled = await t.ok("POST", `/api/orders/${booked.id}/cancel`, { orderToken: booked.accessToken });
    expect(cancelled).toMatchObject({ status: "cancelled", refunded: true });
    // The merchant ships and completes.
    await t.ok("POST", `/api/merchant/orders/${parcel.id}/ship`, { token: b.token, body: { trackingNo: "SF123" } });
    expect(await t.ok("POST", `/api/merchant/orders/${parcel.id}/complete`, { token: b.token })).toMatchObject({ status: "completed" });
    expect(await t.ok("GET", "/api/merchant/orders", { token: b.token })).toHaveLength(1);
  });
});

describe("grants", () => {
  it("gives 专业版 from now for some days without a payment, and only ever moves the end later", async () => {
    const { t, token } = await nail();
    const overview = () => t.ok("GET", "/api/merchant/billing", { token });
    t.advance(20 * DAY);
    const now = t.shop.now();
    const { grant, plan } = await t.billing.grant("nail-studio", 30);
    expect(grant).toMatchObject({ days: 30, periodStart: now, periodEnd: new Date(now.getTime() + 30 * DAY) });
    expect(plan).toMatchObject({ plan: "pro", source: "grant", until: grant.periodEnd });
    expect(await overview()).toMatchObject({ plan: "pro", source: "grant", proUntil: grant.periodEnd.toISOString(), payments: [] });
    expect(t.billingPayments.refunds).toEqual([]);

    // A shorter grant later doesn't cut it short.
    t.advance(DAY);
    expect((await t.billing.grant("nail-studio", 5)).plan.until).toEqual(grant.periodEnd);

    // Paying during a grant adds the month after it.
    await t.pay(await t.ok("POST", "/api/merchant/billing/checkout", { token }));
    expect(grant.periodEnd.toISOString()).toBe(new Date("2026-12-04T10:00:00+08:00").toISOString());
    expect(await overview()).toMatchObject({ source: "paid", proUntil: new Date("2027-01-04T10:00:00+08:00").toISOString() });
  });

  it("refuses an unknown shop or a bad number of days", async () => {
    const { t } = await nail();
    await expect(t.billing.grant("nope", 30)).rejects.toMatchObject({ code: "shop_not_found" });
    await expect(t.billing.grant("nail-studio", 0)).rejects.toMatchObject({ code: "invalid_request" });
    await expect(t.billing.grant("nail-studio", 1.5)).rejects.toMatchObject({ code: "invalid_request" });
  });

  it("is given to seeded demo shops so they outlive the trial", async () => {
    const t = await setup();
    await seedDemo(t.shop);
    t.advance(300 * DAY);
    expect(await t.ok("GET", "/api/s/nail-studio")).toMatchObject({ acceptsOrders: true });
    expect(await t.ok("GET", "/api/s/bakery")).toMatchObject({ acceptsOrders: true });
  });
});
