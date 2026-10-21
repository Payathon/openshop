import { describe, expect, it } from "vitest";
import { Buyer } from "@openshop/client/buyer";
import { TEMPLATES } from "@openshop/core";
import { colorName } from "./content.ts";
import { address, BASE, customer, setup } from "./test-helpers.ts";

type T = Awaited<ReturnType<typeof setup>>;

const HOUR = 3_600_000;

async function page(t: T, url: string) {
  const res = await t.app.request(url.startsWith("http") ? url : `${BASE}${url}`);
  return { status: res.status, text: await res.text() };
}

// A customer's agent talking to this app, as the remote MCP and the CLI do.
const agent = (t: T) => new Buyer({ server: BASE, fetch: (url, init) => Promise.resolve(t.app.fetch(new Request(url, init))) });

async function onboard(t: T, industry = "nail", extra: Record<string, unknown> = {}) {
  return t.ok("POST", "/api/onboarding", { body: { industry, name: "小美美甲", phone: "13800000000", slug: "xiaomei", ...extra } });
}

describe("onboarding", () => {
  it.each(Object.keys(TEMPLATES))("opens a %s shop as a hidden draft with sample content", async (industry) => {
    const t = await setup();
    const shop = await onboard(t, industry);
    expect(shop.shop).toMatchObject({ slug: "xiaomei", status: "draft", industry });
    expect(shop.merchantToken).toMatch(/^osm_/);
    expect(shop.products.length).toBeGreaterThan(0);
    expect(shop.products.every((p: { sample: boolean }) => p.sample)).toBe(true);
    expect(shop.page.sections.map((s: { type: string }) => s.type)).toContain("header");
    expect(shop.changes).toEqual([]);

    // Nobody but the merchant can see it yet.
    expect((await t.call("GET", "/api/s/xiaomei")).status).toBe(404);
    expect((await page(t, "/s/xiaomei")).status).toBe(404);
    await expect(agent(t).open("xiaomei")).rejects.toThrow("找不到店铺");

    // The merchant's preview shows it, samples marked.
    const preview = await page(t, shop.previewUrl);
    expect(preview.status).toBe(200);
    expect(preview.text).toContain("预览");
    expect(preview.text).toContain(shop.products[0].name);
    expect(preview.text).toContain("示例");
  });

  it("follows the chosen modules and generates an address when none is given", async () => {
    const t = await setup();
    const shop = await t.ok("POST", "/api/onboarding", { body: { industry: "generic", modules: ["shopping", "banner"], name: "杂货铺", phone: "13800000000" } });
    expect(shop.shop.slug).toMatch(/^generic-[0-9a-f]{6}$/);
    expect(shop.page.sections.map((s: { type: string }) => s.type)).toEqual(["header", "banner", "products", "contact"]);
    expect(shop.products.every((p: { fulfillment: string }) => p.fulfillment === "shipping")).toBe(true);
    expect(shop.shop.hours).toBeNull();
    expect((await t.call("POST", "/api/onboarding", { body: { industry: "spaceship", name: "x", phone: "13800000000" } })).status).toBe(400);
  });

  it("won't publish sample products, and goes live once they're real", async () => {
    const t = await setup();
    const shop = await onboard(t);
    const token = shop.merchantToken;
    const r = await t.call("POST", "/api/merchant/publish", { token });
    expect(r).toMatchObject({ status: 409, body: { error: "sample_content" } });

    // Editing a sample makes it the merchant's own; deleting removes the rest.
    const [first, ...rest] = shop.products as { id: string; name: string; fulfillment: string; durationMinutes: number }[];
    await t.ok("PUT", `/api/merchant/products/${first!.id}`, {
      token,
      body: { name: first!.name, fulfillment: first!.fulfillment, durationMinutes: first!.durationMinutes, variants: [{ priceFen: 9900 }] },
    });
    for (const p of rest) await t.ok("DELETE", `/api/merchant/products/${p.id}`, { token });

    const published = await t.ok("POST", "/api/merchant/publish", { token });
    expect(published).toMatchObject({ version: 1, url: `${BASE}/s/xiaomei` });
    expect((await t.ok("GET", "/api/s/xiaomei/products")).map((p: { name: string }) => p.name)).toEqual([first!.name]);
    expect((await agent(t).open("xiaomei")).shop.name).toBe("小美美甲");
    expect((await t.call("POST", "/api/merchant/publish", { token })).body.error).toBe("nothing_to_publish");
  });
});

describe("changes and publishing", () => {
  it("shows pending edits in the preview only, then publishes them", async () => {
    const t = await setup();
    const { token, product } = await t.nailStudio();
    const edit = await t.ok("PUT", `/api/merchant/products/${product.id}`, {
      token,
      body: { name: "法式美甲", fulfillment: "booking", durationMinutes: 90, variants: [{ priceFen: 18800 }] },
    });
    expect(edit.change.summary).toBe("法式美甲 ¥168→¥188；修改了 法式美甲 的下单选项");
    // Same variant id, so links and order history stay valid.
    expect(edit.variants[0].id).toBe(product.variants[0].id);

    const theme = await t.ok("POST", "/api/merchant/changes", { token, body: { kind: "theme.update", patch: { primary: "#e03131" } } });
    expect(theme.change.summary).toBe("主色 粉→红");

    const { url } = await t.ok("POST", "/api/merchant/preview-link", { token });
    const preview = await page(t, url);
    expect(preview.text).toContain("¥188");
    expect(preview.text).toContain("--primary:#e03131");
    const live = await page(t, "/s/nail-studio");
    expect(live.text).toContain("¥168");
    expect(live.text).not.toContain("#e03131");
    expect((await t.ok("GET", "/api/s/nail-studio/products"))[0].variants[0].priceFen).toBe(16800);

    const published = await t.ok("POST", "/api/merchant/publish", { token });
    expect(published).toMatchObject({ version: 2, changes: [edit.change.summary, "主色 粉→红"] });
    expect((await page(t, "/s/nail-studio")).text).toContain("¥188");
    expect(await t.ok("GET", "/api/merchant/changes", { token })).toEqual([]);
    const history = await t.ok("GET", "/api/merchant/publishes", { token });
    expect(history.map((h: { version: number }) => h.version)).toEqual([2, 1]);
  });

  it("edits sections and refuses to drop the shop header", async () => {
    const t = await setup();
    const { token } = await t.nailStudio();
    const add = await t.ok("POST", "/api/merchant/changes", {
      token,
      body: { kind: "section.add", section: { type: "banner", props: { title: "周末法式 8 折" } } },
    });
    expect(add.change.summary).toBe("新增「推广横幅」：周末法式 8 折");
    const overview = await t.ok("GET", "/api/merchant/shop", { token });
    const types = overview.page.sections.map((s: { type: string }) => s.type);
    // New sections land just above the contact block.
    expect(types).toEqual(["header", "products", "booking", "banner", "contact"]);
    const bannerId = overview.page.sections[3].id;

    expect((await t.ok("POST", "/api/merchant/changes", { token, body: { kind: "section.move", id: bannerId, index: 0 } })).change.summary).toBe("把「推广横幅」：周末法式 8 折移到第 1 位");
    expect((await t.ok("POST", "/api/merchant/changes", { token, body: { kind: "section.update", id: bannerId, props: { title: "周末 7 折" } } })).change.summary).toBe(
      "「推广横幅」标题 周末法式 8 折→周末 7 折",
    );
    const header = await t.call("POST", "/api/merchant/changes", { token, body: { kind: "section.remove", id: "header" } });
    expect(header).toMatchObject({ status: 400, body: { message: "页面必须有「店铺信息」" } });
    const noop = await t.call("POST", "/api/merchant/changes", { token, body: { kind: "section.update", id: bannerId, props: { title: "周末 7 折" } } });
    expect(noop.body.error).toBe("no_change");
    expect((await t.call("POST", "/api/merchant/changes", { token, body: { kind: "section.add", section: { type: "marquee" } } })).status).toBe(400);

    await t.ok("POST", "/api/merchant/publish", { token });
    const live = await page(t, "/s/nail-studio");
    expect(live.text.indexOf("周末 7 折")).toBeLessThan(live.text.indexOf("小美美甲</h1>"));
  });

  it("undoes a change together with later changes built on it", async () => {
    const t = await setup();
    const { token } = await t.nailStudio();
    const create = await t.ok("POST", "/api/merchant/products", {
      token,
      body: { name: "手部护理", fulfillment: "booking", durationMinutes: 30, variants: [{ priceFen: 6800 }] },
    });
    const theme = await t.ok("POST", "/api/merchant/changes", { token, body: { kind: "theme.update", patch: { radius: "square" } } });
    await t.ok("PUT", `/api/merchant/products/${create.id}`, {
      token,
      body: { name: "手部护理", fulfillment: "booking", durationMinutes: 30, variants: [{ priceFen: 7800 }] },
    });

    const undone = await t.ok("DELETE", `/api/merchant/changes/${create.change.id}`, { token });
    expect(undone.undone.map((c: { summary: string }) => c.summary)).toEqual(["新增商品 手部护理 ¥68", "手部护理 ¥68→¥78"]);
    expect((await t.ok("GET", "/api/merchant/changes", { token })).map((c: { id: string }) => c.id)).toEqual([theme.change.id]);

    await t.call("DELETE", "/api/merchant/changes", { token });
    expect(await t.ok("GET", "/api/merchant/changes", { token })).toEqual([]);
    expect((await t.call("DELETE", `/api/merchant/changes/${theme.change.id}`, { token })).status).toBe(404);
  });

  it("rolls back to an earlier version, bringing deleted products back", async () => {
    const t = await setup();
    const { token, product, variantId } = await t.nailStudio();
    await t.ok("DELETE", `/api/merchant/products/${product.id}`, { token });
    await t.ok("POST", "/api/merchant/changes", { token, body: { kind: "shop.update", patch: { name: "小美美甲 2.0", phone: "13800000001" } } });
    const v2 = await t.ok("POST", "/api/merchant/publish", { token });
    expect(v2.changes).toEqual(["删除商品 法式美甲", "店名 小美美甲→小美美甲 2.0；电话 13800000000→13800000001"]);
    expect(await t.ok("GET", "/api/s/nail-studio/products")).toEqual([]);

    await t.ok("POST", "/api/merchant/changes", { token, body: { kind: "theme.update", patch: { font: "serif" } } });
    expect((await t.call("POST", "/api/merchant/publishes/1/rollback", { token })).body.error).toBe("pending_changes");
    await t.call("DELETE", "/api/merchant/changes", { token });

    expect(await t.ok("POST", "/api/merchant/publishes/1/rollback", { token })).toEqual({ version: 3, changes: ["回滚到版本 1"] });
    const products = await t.ok("GET", "/api/s/nail-studio/products");
    expect(products[0]).toMatchObject({ id: product.id, variants: [{ id: variantId, priceFen: 16800 }] });
    expect((await t.ok("GET", "/api/s/nail-studio")).name).toBe("小美美甲");
    expect((await t.call("POST", "/api/merchant/publishes/9/rollback", { token })).status).toBe(404);
  });

  it("never lets a publish overwrite live stock", async () => {
    const t = await setup();
    const { token, product, smallId } = await t.bakery();
    // One small box sold (held) after the edit was drafted, before it was published.
    await t.ok("PUT", `/api/merchant/products/${product.id}`, {
      token,
      body: {
        name: "黄油曲奇",
        fulfillment: "shipping",
        variants: [
          { attributes: { 规格: "小盒" }, priceFen: 3900, stock: 99 },
          { attributes: { 规格: "大盒" }, priceFen: 6800, stock: 99 },
          { attributes: { 规格: "礼盒" }, priceFen: 12800, stock: 5 },
        ],
      },
    });
    await t.ok("POST", "/api/s/bakery/orders", { body: { items: [{ variantId: smallId }], customer, address } });
    await t.ok("POST", "/api/merchant/publish", { token });
    const [cookie] = await t.ok("GET", "/api/s/bakery/products");
    expect(cookie.variants.map((v: { priceFen: number; stock: number }) => [v.priceFen, v.stock])).toEqual([
      [3900, 0],
      [6800, 10],
      [12800, 5],
    ]);
  });

  it("closes the shop for a day immediately, without publishing", async () => {
    const t = await setup();
    const { token, variantId } = await t.nailStudio();
    await t.ok("PUT", "/api/merchant/closures", {
      token,
      body: { closures: [{ start: "2026-10-17T00:00:00+08:00", end: "2026-10-18T00:00:00+08:00" }] },
    });
    expect((await t.ok("GET", `/api/s/nail-studio/availability?variantId=${variantId}&date=2026-10-17`)).slots).toEqual([]);
    expect(await t.ok("GET", "/api/merchant/changes", { token })).toEqual([]);
  });
});

describe("preview links", () => {
  it("expire after a day and can't be forged or reused for another shop", async () => {
    const t = await setup();
    const nail = await t.nailStudio();
    const bakery = await t.bakery();
    const { url } = await t.ok("POST", "/api/merchant/preview-link", { token: nail.token });
    expect((await page(t, url)).status).toBe(200);
    expect((await page(t, `${url}/p/${nail.product.id}`)).text).toContain("预览里不能下单");

    const forged = url.replace(/.$/, (ch: string) => (ch === "A" ? "B" : "A"));
    expect((await page(t, forged)).status).toBe(404);
    const other = (await t.ok("POST", "/api/merchant/preview-link", { token: bakery.token })).url as string;
    expect((await page(t, other.replace("/s/bakery/", "/s/nail-studio/"))).status).toBe(404);

    t.advance(25 * HOUR);
    const expired = await page(t, url);
    expect(expired.status).toBe(404);
    expect(expired.text).toContain("已过期");
  });
});

it("names theme colours the way merchants would", () => {
  expect(["#d6336c", "#e03131", "#1f6feb", "#2f9e44", "#f59f00", "#111827", "#ffffff", "#7048e8"].map(colorName)).toEqual([
    "粉",
    "红",
    "蓝",
    "绿",
    "橙",
    "黑",
    "白",
    "紫",
  ]);
});
