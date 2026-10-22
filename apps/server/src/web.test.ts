import { describe, expect, it } from "vitest";
import { address, BASE, customer, setup } from "./test-helpers.ts";

const SAT = "2026-10-17";
const sat = (hhmm: string) => new Date(`${SAT}T${hhmm}:00+08:00`).toISOString();

type T = Awaited<ReturnType<typeof setup>>;

async function get(t: T, path: string, cookie?: string) {
  const res = await t.app.request(`${BASE}${path}`, cookie ? { headers: { cookie } } : {});
  return { status: res.status, type: res.headers.get("content-type") ?? "", text: await res.text() };
}

// Posts the product page's checkout and returns the response plus the order cookie it set.
async function checkout(t: T, slug: string, body: unknown) {
  const res = await t.app.request(`${BASE}/s/${slug}/checkout`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const setCookie = res.headers.get("set-cookie") ?? "";
  return { status: res.status, body: await res.json(), setCookie, cookie: setCookie.split(";")[0]! };
}

describe("shop pages", () => {
  it("renders the shop with its products and schema.org data", async () => {
    const t = await setup();
    const { product } = await t.nailStudio();
    const page = await get(t, "/s/nail-studio");
    expect(page.status).toBe(200);
    expect(page.type).toContain("text/html");
    expect(page.text).toMatch(/^<!doctype html>/);
    expect(page.text).toContain("小美美甲");
    expect(page.text).toContain("法式美甲");
    expect(page.text).toContain("¥168");
    expect(page.text).toContain(`href="${BASE}/s/nail-studio/p/${product.id}"`);

    const ld = JSON.parse(/<script type="application\/ld\+json">(.*?)<\/script>/s.exec(page.text)![1]!);
    expect(ld).toMatchObject({ "@type": "LocalBusiness", name: "小美美甲", telephone: "13800000000" });
    expect(ld.openingHoursSpecification).toHaveLength(2);
    expect(ld.hasOfferCatalog.itemListElement[0]).toMatchObject({ price: "168.00", priceCurrency: "CNY", itemOffered: { "@type": "Service", name: "法式美甲" } });
  });

  it("switches templates without touching content", async () => {
    const t = await setup();
    const { token } = await t.nailStudio();
    expect((await get(t, "/s/nail-studio")).text).toContain('<body data-style="minimal">');
    const change = await t.ok("POST", "/api/merchant/changes", { token, body: { kind: "theme.update", patch: { style: "dining", font: "serif", radius: "soft" } } });
    expect(change.change.summary).toBe("模板 简约→餐厅；字体 默认→宋体");
    await t.ok("POST", "/api/merchant/publish", { token });
    const page = await get(t, "/s/nail-studio");
    expect(page.text).toContain('<body data-style="dining">');
    expect(page.text).toContain("法式美甲");
  });

  it("says so when the shop or product doesn't exist", async () => {
    const t = await setup();
    await t.nailStudio();
    const shop = await get(t, "/s/no-such-shop");
    expect(shop.status).toBe(404);
    expect(shop.text).toContain("找不到店铺");
    expect((await get(t, "/s/nail-studio/p/prod_nope")).status).toBe(404);
  });

  it("shows product images lazily, and nothing when there are none", async () => {
    const t = await setup();
    const { token, product } = await t.nailStudio();
    expect((await get(t, "/s/nail-studio")).text).not.toContain("<img");

    await t.ok("PUT", `/api/merchant/products/${product.id}`, {
      token,
      body: {
        name: "法式美甲",
        fulfillment: "booking",
        durationMinutes: 90,
        images: ["https://img.example/a.jpg", "/files/b.jpg"],
        orderOptions: [{ key: "color", label: "颜色", type: "choice", choices: ["裸粉", "酒红"], required: true }],
        variants: [{ priceFen: 16800 }],
      },
    });
    const bad = await t.call("PUT", `/api/merchant/products/${product.id}`, {
      token,
      body: { name: "x", fulfillment: "booking", durationMinutes: 90, images: ["javascript:alert(1)"], variants: [{ priceFen: 1 }] },
    });
    expect(bad.status).toBe(400);
    await t.ok("POST", "/api/merchant/publish", { token });

    const shop = await get(t, "/s/nail-studio");
    expect(shop.text).toContain('<img src="https://img.example/a.jpg" alt="法式美甲" class="row-img" width="96" height="96" loading="lazy" decoding="async"');
    const detail = await get(t, `/s/nail-studio/p/${product.id}`);
    expect(detail.text).toContain('class="media"');
    expect(detail.text).toContain('src="https://img.example/a.jpg" alt="法式美甲" width="600" height="600" loading="eager"');
    expect(detail.text).toContain('src="/files/b.jpg" alt="法式美甲" width="600" height="600" loading="lazy"');
  });

  it("renders custom HTML without anything executable", async () => {
    const t = await setup();
    const { token } = await t.nailStudio();
    await t.ok("POST", "/api/merchant/changes", {
      token,
      body: {
        kind: "section.add",
        section: { type: "custom_html", props: { html: `<h3>品牌故事</h3><script>steal()</script><p onclick="x()">十年手艺</p><iframe src="https://evil"></iframe>` } },
      },
    });
    await t.ok("POST", "/api/merchant/publish", { token });
    const text = (await get(t, "/s/nail-studio")).text;
    expect(text).toContain("<h3>品牌故事</h3><p>十年手艺</p>");
    expect(text).not.toMatch(/steal|onclick|iframe/);
  });

  it("tells agents how to order in llms.txt and openshop.json", async () => {
    const t = await setup();
    await t.nailStudio();
    const llms = await get(t, "/s/nail-studio/llms.txt");
    expect(llms.type).toContain("text/plain");
    expect(llms.text).toContain("# 小美美甲");
    expect(llms.text).toContain("（预约，约 90 分钟）：¥168。下单时需要选择：颜色（裸粉、酒红）");
    expect(llms.text).toContain(`npx -y openshop shop ${BASE}/s/nail-studio`);
    expect(llms.text).toContain(`${BASE}/mcp`);

    const wk = JSON.parse((await get(t, "/s/nail-studio/.well-known/openshop.json")).text);
    expect(wk).toMatchObject({ shop: { slug: "nail-studio" }, url: `${BASE}/s/nail-studio`, mcp: { url: `${BASE}/mcp` } });
  });
});

describe("web checkout", () => {
  it("books, pays and lands back on the order page", async () => {
    const t = await setup();
    const { product, variantId } = await t.nailStudio();
    const form = await get(t, `/s/nail-studio/p/${product.id}`);
    expect(form.text).toContain(variantId);
    expect(form.text).toContain('data-date="2026-10-17"');

    const r = await checkout(t, "nail-studio", { items: [{ variantId, options: { color: "裸粉" } }], customer, slotStart: sat("14:00") });
    expect(r.status).toBe(201);
    expect(r.setCookie).toMatch(/HttpOnly/i);
    expect(r.setCookie).toContain("Path=/s/nail-studio");
    // The token is only in the cookie.
    expect(JSON.stringify(r.body)).not.toContain("oso_");

    const pending = await get(t, `/s/nail-studio/orders/${r.body.orderId}`, r.cookie);
    expect(pending.text).toContain("待付款");
    expect(pending.text).toContain(r.body.paymentUrl);

    const back = await t.pay(r.body);
    expect(back).toBe(`${BASE}/s/nail-studio/orders/${r.body.orderId}`);
    const done = await get(t, new URL(back!).pathname, r.cookie);
    expect(done.text).toContain("预约成功");
    expect(done.text).toContain("2026-10-17 周六 14:00–15:30");
    expect(JSON.parse((await get(t, `/s/nail-studio/orders/${r.body.orderId}/status`, r.cookie)).text)).toEqual({ status: "confirmed" });
  });

  it("buys several items for delivery", async () => {
    const t = await setup();
    const { product, largeId } = await t.bakery();
    expect((await get(t, `/s/bakery/p/${product.id}`)).text).toContain('name="quantity"');

    const r = await checkout(t, "bakery", { items: [{ variantId: largeId, quantity: 2 }], customer, address });
    expect(r.status).toBe(201);
    await t.pay(r.body);
    const done = await get(t, `/s/bakery/orders/${r.body.orderId}`, r.cookie);
    expect(done.text).toContain("已付款，待发货");
    expect(done.text).toContain("文一路 100 号");
    expect(done.text).toContain("¥136");
    const stock = await t.ok("GET", `/api/s/bakery/availability?variantId=${largeId}`);
    expect(stock.stock).toBe(8);
  });

  it("explains problems in plain words", async () => {
    const t = await setup();
    const { variantId } = await t.nailStudio();
    const badPhone = await checkout(t, "nail-studio", { items: [{ variantId, options: { color: "裸粉" } }], customer: { name: "王", phone: "123" }, slotStart: sat("14:00") });
    expect(badPhone).toMatchObject({ status: 400, body: { message: "手机号格式不正确" } });
    const noColor = await checkout(t, "nail-studio", { items: [{ variantId }], customer, slotStart: sat("14:00") });
    expect(noColor.body.message).toContain("颜色");
    const closed = await checkout(t, "nail-studio", { items: [{ variantId, options: { color: "裸粉" } }], customer, slotStart: sat("21:00") });
    expect(closed).toMatchObject({ status: 409, body: { error: "slot_unavailable" } });
  });

  it("shows an order only to the browser that placed it", async () => {
    const t = await setup();
    const { variantId } = await t.nailStudio();
    await t.bakery();
    const r = await checkout(t, "nail-studio", { items: [{ variantId, options: { color: "裸粉" } }], customer, slotStart: sat("14:00") });
    expect((await get(t, `/s/nail-studio/orders/${r.body.orderId}`)).status).toBe(404);
    expect((await get(t, `/s/nail-studio/orders/${r.body.orderId}`, `${r.cookie.split("=")[0]}=oso_wrong`)).status).toBe(404);
    // A valid token still doesn't show the order under another shop.
    expect((await get(t, `/s/bakery/orders/${r.body.orderId}`, r.cookie)).status).toBe(404);
  });

  it("cancels from the order page, saying first whether money comes back", async () => {
    const t = await setup();
    const { variantId } = await t.nailStudio();
    const book = (hhmm: string) => checkout(t, "nail-studio", { items: [{ variantId, options: { color: "裸粉" } }], customer, slotStart: sat(hhmm) });
    const cancel = (orderId: string, cookie: string) =>
      t.app.request(`${BASE}/s/nail-studio/orders/${orderId}/cancel`, { method: "POST", headers: { cookie } });

    // Unpaid: a plain cancel.
    const unpaid = await book("10:00");
    expect((await get(t, `/s/nail-studio/orders/${unpaid.body.orderId}`, unpaid.cookie)).text).toContain(">取消预约</button>");

    // Paid and early enough: cancel with refund.
    const paid = await book("14:00");
    await t.pay(paid.body);
    const before = await get(t, `/s/nail-studio/orders/${paid.body.orderId}`, paid.cookie);
    expect(before.text).toContain("取消预约并退款 ¥168");
    expect(before.text).toContain("data-confirm=");
    const res = await cancel(paid.body.orderId, paid.cookie);
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe(`${BASE}/s/nail-studio/orders/${paid.body.orderId}`);
    const after = await get(t, `/s/nail-studio/orders/${paid.body.orderId}`, paid.cookie);
    expect(after.text).toContain("已取消");
    expect(after.text).toContain("款项已原路退回");
    expect(after.text).not.toContain("<button");
    expect(t.payments.refunds).toHaveLength(1);

    // Too close to the appointment: no button, the reason and the shop's phone instead.
    const late = await book("16:00");
    await t.pay(late.body);
    t.advance(45 * 3_600_000);
    const blocked = await get(t, `/s/nail-studio/orders/${late.body.orderId}`, late.cookie);
    expect(blocked.text).toContain("距离预约开始不足 24 小时，需要联系商家取消");
    expect(blocked.text).toContain('href="tel:13800000000"');
    expect(blocked.text).not.toContain("取消预约并退款");
    // Posting anyway changes nothing.
    expect((await cancel(late.body.orderId, late.cookie)).status).toBe(303);
    expect((await get(t, `/s/nail-studio/orders/${late.body.orderId}`, late.cookie)).text).toContain("预约成功");
    expect((await cancel(late.body.orderId, "")).status).toBe(404);
  });

  it("keeps agent orders on the cashier's own success page", async () => {
    const t = await setup();
    const { variantId } = await t.nailStudio();
    const order = await t.ok("POST", "/api/s/nail-studio/orders", {
      body: { items: [{ variantId, options: { color: "裸粉" } }], customer, slotStart: sat("14:00"), source: "agent" },
    });
    expect(await t.pay(order)).toBeNull();
  });
});
