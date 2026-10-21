import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { acquireLease } from "./db/lease.ts";
import { orders, variants } from "./db/schema.ts";
import { startPaymentSync } from "./jobs.ts";
import { address, customer, setup } from "./test-helpers.ts";

const MINUTE = 60_000;
const SAT = "2026-10-17";

type T = Awaited<ReturnType<typeof setup>>;

// Reads straight from the database, so nothing on the way refreshes the order.
const statusOf = async (t: T, id: string) => (await t.db.select({ status: orders.status }).from(orders).where(eq(orders.id, id)))[0]!.status;
const stockOf = async (t: T, id: string) => (await t.db.select({ stock: variants.stock }).from(variants).where(eq(variants.id, id)))[0]!.stock;

async function booking(t: T) {
  const { variantId, token } = await t.nailStudio();
  const order = await t.ok("POST", "/api/s/nail-studio/orders", {
    body: { items: [{ variantId, options: { color: "裸粉" } }], customer, slotStart: `${SAT}T14:00:00+08:00` },
  });
  return { order, token };
}

describe("payment sweep", () => {
  it("confirms a paid order without anyone reading it", async () => {
    const t = await setup();
    const { order, token } = await booking(t);
    await t.pay(order);
    expect(await statusOf(t, order.id)).toBe("pending_payment");

    expect(await t.shop.syncPayments()).toBe(1);
    expect(await statusOf(t, order.id)).toBe("confirmed");
    // The customer list no longer refreshes on read; the sweep put them there.
    expect(await t.ok("GET", "/api/merchant/customers", { token })).toEqual([expect.objectContaining({ phone: customer.phone, orderCount: 1 })]);
  });

  it("expires an unpaid order and returns its stock", async () => {
    const t = await setup();
    const { smallId } = await t.bakery();
    const order = await t.ok("POST", "/api/s/bakery/orders", { body: { items: [{ variantId: smallId }], customer, address } });
    expect(await stockOf(t, smallId)).toBe(0);

    t.advance(10 * MINUTE);
    await t.shop.syncPayments();
    expect(await statusOf(t, order.id)).toBe("pending_payment");

    t.advance(6 * MINUTE);
    await t.shop.syncPayments();
    expect(await statusOf(t, order.id)).toBe("expired");
    expect(await stockOf(t, smallId)).toBe(1);
  });

  it("runs one sweep at a time and never handles an order twice", async () => {
    const t = await setup();
    const { order, token } = await booking(t);
    await t.pay(order);

    const results = await Promise.all([t.shop.syncPayments(), t.shop.syncPayments()]);
    expect(results.filter((r) => r === null)).toHaveLength(1);
    expect(await t.ok("GET", "/api/merchant/customers", { token })).toEqual([expect.objectContaining({ orderCount: 1, totalFen: 16800 })]);
  });

  it("takes over the lease of an instance that died mid-sweep", async () => {
    const t = await setup();
    await acquireLease(t.db, "payment-sync", "dead-instance", t.shop.now(), 60_000);
    expect(await t.shop.syncPayments()).toBeNull();
    t.advance(61_000);
    expect(await t.shop.syncPayments()).toBe(0);
  });

  it("lets the merchant ship an order paid moments ago, before the sweep", async () => {
    const t = await setup();
    const { token, largeId } = await t.bakery();
    const order = await t.ok("POST", "/api/s/bakery/orders", { body: { items: [{ variantId: largeId }], customer, address } });
    await t.pay(order);
    const shipped = await t.ok("POST", `/api/merchant/orders/${order.id}/ship`, { token, body: { trackingNo: "SF123" } });
    expect(shipped.status).toBe("shipped");
  });

  it("keeps sweeping in the background until stopped", async () => {
    const t = await setup();
    const { order } = await booking(t);
    const jobs = startPaymentSync(t.shop, 10);
    try {
      await t.pay(order);
      await expect.poll(() => statusOf(t, order.id), { timeout: 2_000 }).toBe("confirmed");
    } finally {
      await jobs.stop();
    }
  });
});
