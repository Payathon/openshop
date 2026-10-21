import { describe, expect, it } from "vitest";
import { address, customer, setup } from "./test-helpers.ts";

const SAT = "2026-10-17";
const sat = (hhmm: string) => new Date(`${SAT}T${hhmm}:00+08:00`).toISOString();
const MINUTE = 60_000;

describe("shop setup", () => {
  it("shows a new shop and its products publicly", async () => {
    const t = await setup();
    await t.nailStudio();
    const shop = await t.ok("GET", "/api/s/nail-studio");
    expect(shop).toMatchObject({ name: "小美美甲", phone: "13800000000", cancelPolicy: { freeCancelHoursBefore: 24 } });
    expect(shop).not.toHaveProperty("merchantTokenHash");
    const products = await t.ok("GET", "/api/s/nail-studio/products");
    expect(products).toHaveLength(1);
    expect(products[0]).toMatchObject({ name: "法式美甲", fulfillment: "booking", variants: [{ priceFen: 16800 }] });
  });

  it("rejects a taken slug", async () => {
    const t = await setup();
    await t.nailStudio();
    const r = await t.call("POST", "/api/shops", { body: { slug: "nail-studio", name: "另一家", industry: "nail", phone: "13800000001" } });
    expect(r.status).toBe(409);
  });

  it("keeps one merchant out of another shop's products", async () => {
    const t = await setup();
    const nail = await t.nailStudio();
    const bakery = await t.bakery();
    const r = await t.call("PUT", `/api/merchant/products/${nail.product.id}`, {
      token: bakery.token,
      body: { name: "改名", fulfillment: "booking", durationMinutes: 60, variants: [{ priceFen: 1 }] },
    });
    expect(r.status).toBe(404);
    expect((await t.call("GET", "/api/merchant/orders")).status).toBe(401);
  });
});

describe("booking", () => {
  it("books a slot, confirms it on payment, and records the customer", async () => {
    const t = await setup();
    const { variantId, token } = await t.nailStudio();
    const before = await t.ok("GET", `/api/s/nail-studio/availability?variantId=${variantId}&date=${SAT}`);
    expect(before.slots[0]).toMatchObject({ start: sat("10:00"), end: sat("11:30") });

    const order = await t.ok("POST", "/api/s/nail-studio/orders", {
      body: { items: [{ variantId, options: { color: "裸粉" } }], customer, slotStart: sat("14:00"), source: "agent" },
    });
    expect(order).toMatchObject({ status: "pending_payment", totalFen: 16800, slotStart: sat("14:00"), slotEnd: sat("15:30") });
    expect(order.paymentUrl).toMatch(/^http/);
    expect(order.accessToken).toBeTruthy();

    // The slot is held while payment is pending.
    const held = await t.ok("GET", `/api/s/nail-studio/availability?variantId=${variantId}&date=${SAT}`);
    expect(held.slots.map((s: { start: string }) => s.start)).not.toContain(sat("14:00"));

    await t.pay(order);
    const paid = await t.ok("GET", `/api/orders/${order.id}`, { orderToken: order.accessToken });
    expect(paid.status).toBe("confirmed");

    const customers = await t.ok("GET", "/api/merchant/customers", { token });
    expect(customers).toEqual([expect.objectContaining({ phone: customer.phone, name: customer.name, orderCount: 1, totalFen: 16800 })]);
    const orders = await t.ok("GET", "/api/merchant/orders", { token });
    expect(orders[0]).toMatchObject({ id: order.id, status: "confirmed", source: "agent" });
  });

  it("refuses a slot that is already held", async () => {
    const t = await setup();
    const { variantId } = await t.nailStudio();
    const body = { items: [{ variantId, options: { color: "酒红" } }], customer, slotStart: sat("14:00") };
    await t.ok("POST", "/api/s/nail-studio/orders", { body });
    const r = await t.call("POST", "/api/s/nail-studio/orders", { body: { ...body, slotStart: sat("15:00") } });
    expect(r.status).toBe(409);
    expect(r.body.error).toBe("slot_unavailable");
  });

  it("refuses a slot outside opening hours", async () => {
    const t = await setup();
    const { variantId } = await t.nailStudio();
    const r = await t.call("POST", "/api/s/nail-studio/orders", {
      body: { items: [{ variantId, options: { color: "酒红" } }], customer, slotStart: sat("19:00") },
    });
    expect(r.status).toBe(409);
  });

  it("releases the slot when payment times out", async () => {
    const t = await setup();
    const { variantId } = await t.nailStudio();
    const order = await t.ok("POST", "/api/s/nail-studio/orders", {
      body: { items: [{ variantId, options: { color: "酒红" } }], customer, slotStart: sat("14:00") },
    });
    t.advance(16 * MINUTE);
    const after = await t.ok("GET", `/api/s/nail-studio/availability?variantId=${variantId}&date=${SAT}`);
    expect(after.slots.map((s: { start: string }) => s.start)).toContain(sat("14:00"));
    expect((await t.ok("GET", `/api/orders/${order.id}`, { orderToken: order.accessToken })).status).toBe("expired");
  });

  it("needs the slot and the required options", async () => {
    const t = await setup();
    const { variantId } = await t.nailStudio();
    const noSlot = await t.call("POST", "/api/s/nail-studio/orders", { body: { items: [{ variantId, options: { color: "裸粉" } }], customer } });
    expect(noSlot.status).toBe(400);
    const noColor = await t.call("POST", "/api/s/nail-studio/orders", { body: { items: [{ variantId }], customer, slotStart: sat("14:00") } });
    expect(noColor.status).toBe(400);
    expect(noColor.body.message).toBe("缺少下单选项：颜色");
  });

  it("refunds a cancellation made early enough and frees the slot", async () => {
    const t = await setup();
    const { variantId } = await t.nailStudio();
    const order = await t.ok("POST", "/api/s/nail-studio/orders", {
      body: { items: [{ variantId, options: { color: "裸粉" } }], customer, slotStart: sat("14:00") },
    });
    await t.pay(order);
    const cancelled = await t.ok("POST", `/api/orders/${order.id}/cancel`, { orderToken: order.accessToken });
    expect(cancelled).toMatchObject({ status: "cancelled", refunded: true });
    expect(t.payments.refunds).toEqual([{ orderId: order.id, amountFen: 16800 }]);
    const after = await t.ok("GET", `/api/s/nail-studio/availability?variantId=${variantId}&date=${SAT}`);
    expect(after.slots.map((s: { start: string }) => s.start)).toContain(sat("14:00"));
  });

  it("hides an order from anyone without its token", async () => {
    const t = await setup();
    const { variantId } = await t.nailStudio();
    const order = await t.ok("POST", "/api/s/nail-studio/orders", {
      body: { items: [{ variantId, options: { color: "裸粉" } }], customer, slotStart: sat("14:00") },
    });
    expect((await t.call("GET", `/api/orders/${order.id}`)).status).toBe(404);
    expect((await t.call("GET", `/api/orders/${order.id}`, { orderToken: "wrong" })).status).toBe(404);
  });
});

describe("shipping", () => {
  it("holds stock, ships after payment, and needs an address", async () => {
    const t = await setup();
    const { token, largeId } = await t.bakery();
    const noAddress = await t.call("POST", "/api/s/bakery/orders", { body: { items: [{ variantId: largeId, quantity: 2 }], customer } });
    expect(noAddress.status).toBe(400);

    const order = await t.ok("POST", "/api/s/bakery/orders", { body: { items: [{ variantId: largeId, quantity: 2 }], customer, address } });
    expect(order).toMatchObject({ status: "pending_payment", totalFen: 13600 });
    const stock = await t.ok("GET", "/api/s/bakery/availability?variantId=" + largeId);
    expect(stock.stock).toBe(8);

    expect((await t.call("POST", `/api/merchant/orders/${order.id}/ship`, { token, body: { trackingNo: "SF1" } })).status).toBe(409);
    await t.pay(order);
    expect((await t.ok("GET", `/api/orders/${order.id}`, { orderToken: order.accessToken })).status).toBe("paid");
    const shipped = await t.ok("POST", `/api/merchant/orders/${order.id}/ship`, { token, body: { trackingNo: "SF1" } });
    expect(shipped).toMatchObject({ status: "shipped", trackingNo: "SF1" });
  });

  it("does not oversell the last item", async () => {
    const t = await setup();
    const { smallId } = await t.bakery();
    const body = { items: [{ variantId: smallId }], customer, address };
    await t.ok("POST", "/api/s/bakery/orders", { body });
    const r = await t.call("POST", "/api/s/bakery/orders", { body });
    expect(r.status).toBe(409);
    expect(r.body.error).toBe("out_of_stock");
  });

  it("returns held stock when payment times out", async () => {
    const t = await setup();
    const { smallId } = await t.bakery();
    await t.ok("POST", "/api/s/bakery/orders", { body: { items: [{ variantId: smallId }], customer, address } });
    t.advance(16 * MINUTE);
    expect((await t.ok("GET", "/api/s/bakery/availability?variantId=" + smallId)).stock).toBe(1);
  });

  it("lets the merchant restock immediately", async () => {
    const t = await setup();
    const { token, smallId } = await t.bakery();
    await t.ok("PUT", `/api/merchant/variants/${smallId}/stock`, { token, body: { stock: 20 } });
    expect((await t.ok("GET", "/api/s/bakery/availability?variantId=" + smallId)).stock).toBe(20);
  });

  it("does not mix booking and shipping items in one order", async () => {
    const t = await setup();
    const { token, variantId } = await t.nailStudio();
    const cookie = await t.ok("POST", "/api/merchant/products", {
      token,
      body: { name: "护甲油", fulfillment: "shipping", variants: [{ priceFen: 2900, stock: 5 }] },
    });
    await t.ok("POST", "/api/merchant/publish", { token });
    const r = await t.call("POST", "/api/s/nail-studio/orders", {
      body: {
        items: [{ variantId, options: { color: "裸粉" } }, { variantId: cookie.variants[0].id }],
        customer,
        slotStart: sat("14:00"),
        address,
      },
    });
    expect(r.status).toBe(400);
  });
});
