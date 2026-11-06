import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { orders, pushSubscriptions } from "./db/schema.ts";
import { isPushEndpoint } from "./push.ts";
import { OpenShop } from "./shop.ts";
import { address, BASE, customer, setup } from "./test-helpers.ts";

type T = Awaited<ReturnType<typeof setup>>;

const SAT = "2026-10-17";
const keys = { p256dh: "BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlUls0VJXg7A8u-Ts1XbjhazAkj7I99e8QcYP7DkM", auth: "tBHItJI5svbpez7KI4CCXg" };
const chrome = { endpoint: "https://fcm.googleapis.com/fcm/send/chrome-1", keys };
const firefox = { endpoint: "https://updates.push.services.mozilla.com/wpush/v2/firefox-1", keys };
const safari = { endpoint: "https://web.push.apple.com/safari-1", keys };

// A browser: keeps the session cookie between requests.
function browser(t: T) {
  let cookie = "";
  return async (method: string, path: string, body?: unknown) => {
    const res = await t.app.request(`${BASE}${path}`, {
      method,
      headers: { ...(cookie ? { cookie } : {}), ...(body === undefined ? {} : { "content-type": "application/json" }) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const set = res.headers.get("set-cookie");
    if (set) cookie = set.split(";")[0]!;
    const text = await res.text();
    return { status: res.status, body: text ? JSON.parse(text) : null };
  };
}

const subscriptions = (t: T) => t.db.select().from(pushSubscriptions).orderBy(pushSubscriptions.endpoint);

async function booking(t: T, source?: "agent") {
  const { variantId, token } = await t.nailStudio();
  const order = await t.ok("POST", "/api/s/nail-studio/orders", {
    body: { items: [{ variantId, options: { color: "裸粉" } }], customer, slotStart: `${SAT}T14:00:00+08:00`, ...(source ? { source } : {}) },
  });
  return { order, token };
}

describe("push subscriptions", () => {
  it("need a merchant, and belong to the shop and account that made them", async () => {
    const t = await setup();
    expect((await t.call("GET", "/api/merchant/push")).status).toBe(401);
    expect((await t.call("POST", "/api/merchant/push/subscriptions", { body: chrome })).status).toBe(401);
    expect((await t.call("POST", "/api/merchant/push/unsubscribe", { body: { endpoint: chrome.endpoint } })).status).toBe(401);
    expect((await t.call("POST", "/api/merchant/push/test")).status).toBe(401);
    expect((await t.call("POST", "/api/merchant/push/subscriptions", { token: "osm_wrong", body: chrome })).status).toBe(401);

    // The workbench: a signed-in account with a shop.
    const b = browser(t);
    await b("POST", "/api/auth/register", { name: "小美", email: "mei@example.com", password: "password1" });
    const { body: created } = await b("POST", "/api/onboarding", { industry: "nail", name: "小美美甲", phone: "13800000000" });
    expect((await b("GET", "/api/merchant/push")).body).toEqual({ publicKey: "test-vapid-public-key" });
    expect((await b("POST", "/api/merchant/push/subscriptions", chrome)).status).toBe(201);
    // Subscribing again (the workbench does on every visit) keeps one row.
    expect((await b("POST", "/api/merchant/push/subscriptions", chrome)).status).toBe(201);
    const me = (await b("GET", "/api/auth/me")).body;
    expect(await subscriptions(t)).toEqual([expect.objectContaining({ endpoint: chrome.endpoint, shopId: created.shop.id, accountId: me.account.id })]);

    // A merchant token works too, with no account behind it.
    const { token } = await t.nailStudio();
    await t.ok("POST", "/api/merchant/push/subscriptions", { token, body: firefox });
    expect((await subscriptions(t))[1]).toMatchObject({ endpoint: firefox.endpoint, accountId: null });

    // Another shop can't unsubscribe this one's browser.
    await t.ok("POST", "/api/merchant/push/unsubscribe", { token, body: { endpoint: chrome.endpoint } });
    expect(await subscriptions(t)).toHaveLength(2);
    expect((await b("POST", "/api/merchant/push/unsubscribe", { endpoint: chrome.endpoint })).status).toBe(200);
    expect((await subscriptions(t)).map((s) => s.endpoint)).toEqual([firefox.endpoint]);
  });

  it("only accept browsers' push services as endpoints", async () => {
    const t = await setup();
    const { token } = await t.nailStudio();
    for (const endpoint of ["http://fcm.googleapis.com/fcm/send/x", "https://169.254.169.254/latest", "https://fcm.googleapis.com.evil.example/x", "https://fcm.googleapis.com:8443/x", "not a url"]) {
      const r = await t.call("POST", "/api/merchant/push/subscriptions", { token, body: { endpoint, keys } });
      expect(r.body.error, endpoint).toBe("invalid_endpoint");
    }
    expect((await t.call("POST", "/api/merchant/push/subscriptions", { token, body: { endpoint: chrome.endpoint } })).status).toBe(400);
    expect([chrome, firefox, safari, { endpoint: "https://wns2-par02p.notify.windows.com/w/?token=x" }].every((s) => isPushEndpoint(s.endpoint))).toBe(true);
    expect(await subscriptions(t)).toEqual([]);
  });

  it("moves a browser to the shop that subscribed it last", async () => {
    const t = await setup();
    const nail = await t.nailStudio();
    const bakery = await t.bakery();
    await t.ok("POST", "/api/merchant/push/subscriptions", { token: nail.token, body: chrome });
    await t.ok("POST", "/api/merchant/push/subscriptions", { token: bakery.token, body: chrome });
    const bakeryShop = (await t.ok("GET", "/api/merchant/shop", { token: bakery.token })).shop;
    expect(await subscriptions(t)).toEqual([expect.objectContaining({ endpoint: chrome.endpoint, shopId: bakeryShop.id })]);
    // So the nail studio's new order doesn't reach it.
    const order = await t.ok("POST", "/api/s/nail-studio/orders", {
      body: { items: [{ variantId: nail.variantId, options: { color: "裸粉" } }], customer, slotStart: `${SAT}T14:00:00+08:00` },
    });
    await t.pay(order);
    await t.shop.syncPayments();
    await t.push.idle();
    expect(t.pushSender.sent).toEqual([]);
  });
});

describe("new-order push", () => {
  it("tells the shop's browsers once when a booking is paid, however often payment is confirmed", async () => {
    const t = await setup();
    const { order, token } = await booking(t);
    await t.ok("POST", "/api/merchant/push/subscriptions", { token, body: chrome });
    await t.ok("POST", "/api/merchant/push/subscriptions", { token, body: firefox });

    // Not paid yet: nothing to tell.
    await t.shop.syncPayments();
    await t.push.idle();
    expect(t.pushSender.sent).toEqual([]);

    await t.pay(order);
    // Confirmed by the sweep, a notification, the merchant opening it and the customer reading
    // it, some at the same time, and by a second instance sharing the database.
    const other = new OpenShop({ db: t.db, payments: t.payments, baseUrl: BASE, clock: () => t.shop.now(), notifier: t.push });
    await Promise.all([t.shop.syncPayments(), t.shop.syncOrder(order.id), other.syncOrder(order.id)]);
    await t.ok("GET", `/api/merchant/orders/${order.id}`, { token });
    await t.ok("GET", `/api/orders/${order.id}`, { orderToken: order.accessToken });
    await t.shop.syncPayments();
    // Even asked directly again.
    t.push.orderPaid(order.id);
    await t.push.idle();

    expect(t.pushSender.sent.map((s) => s.endpoint).sort()).toEqual([chrome.endpoint, firefox.endpoint]);
    expect(t.pushSender.sent[0]!.message).toEqual({
      title: "新预约：法式美甲 · 10月17日 周六 14:00",
      body: "王小姐 · ¥168",
      url: `/admin/orders/${order.id}`,
      tag: `order-${order.id}`,
    });
    const [row] = await t.db.select().from(orders).where(eq(orders.id, order.id));
    expect(row!.status).toBe("confirmed");
    expect(row!.notifiedAt).not.toBeNull();
  });

  it("says when the order came through the customer's AI, and counts parcels", async () => {
    const t = await setup();
    const { order, token } = await booking(t, "agent");
    await t.ok("POST", "/api/merchant/push/subscriptions", { token, body: chrome });
    await t.pay(order);
    await t.shop.syncPayments();

    const shop = await t.bakery();
    await t.ok("POST", "/api/merchant/push/subscriptions", { token: shop.token, body: firefox });
    const parcel = await t.ok("POST", "/api/s/bakery/orders", {
      body: { items: [{ variantId: shop.largeId, quantity: 2 }, { variantId: shop.smallId }], customer, address },
    });
    await t.pay(parcel);
    await t.shop.syncPayments();
    await t.push.idle();

    expect(t.pushSender.sent.map((s) => [s.endpoint, s.message.title, s.message.body])).toEqual([
      [chrome.endpoint, "新预约：法式美甲 · 10月17日 周六 14:00", "来自 AI · 王小姐 · ¥168"],
      [firefox.endpoint, "新订单：¥174 · 3 件", "王小姐 · 黄油曲奇（大盒） ×2、黄油曲奇（小盒）"],
    ]);
  });

  it("deletes expired subscriptions and never lets a failing push service hold up the payment", async () => {
    const t = await setup();
    const { order, token } = await booking(t);
    for (const s of [chrome, firefox, safari]) await t.ok("POST", "/api/merchant/push/subscriptions", { token, body: s });
    t.pushSender.gone.add(firefox.endpoint);
    t.pushSender.failing.add(safari.endpoint);

    await t.pay(order);
    expect(await t.shop.syncPayments()).toBe(1);
    // The order is confirmed whatever the push services do.
    expect((await t.ok("GET", `/api/merchant/orders/${order.id}`, { token })).status).toBe("confirmed");
    await t.push.idle();

    expect(t.pushSender.sent.map((s) => s.endpoint)).toEqual([chrome.endpoint]);
    // Gone is deleted; down is kept for next time.
    expect((await subscriptions(t)).map((s) => s.endpoint)).toEqual([chrome.endpoint, safari.endpoint]);
  });

  it("sends a test notification to the shop's browsers", async () => {
    const t = await setup();
    const { token } = await t.nailStudio();
    expect(await t.ok("POST", "/api/merchant/push/test", { token })).toEqual({ sent: 0 });
    await t.ok("POST", "/api/merchant/push/subscriptions", { token, body: chrome });
    expect(await t.ok("POST", "/api/merchant/push/test", { token })).toEqual({ sent: 1 });
    expect(t.pushSender.sent[0]!.message.title).toBe("新订单提醒已开启");
  });
});
