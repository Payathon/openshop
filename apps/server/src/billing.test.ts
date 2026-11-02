import { describe, expect, it } from "vitest";
import { addMonths } from "./billing.ts";
import { BASE, setup, START } from "./test-helpers.ts";

const MINUTE = 60_000;

async function merchant() {
  const t = await setup();
  const { token } = await t.nailStudio();
  const checkout = () => t.ok("POST", "/api/merchant/billing/checkout", { token });
  const overview = () => t.ok("GET", "/api/merchant/billing", { token });
  return { t, token, checkout, overview };
}

describe("专业版 billing", () => {
  it("starts on the free plan", async () => {
    const { overview } = await merchant();
    expect(await overview()).toEqual({ plan: "free", proUntil: null, priceFen: 2900, payments: [] });
  });

  it("opens a ¥29 payment on the platform's provider, not the shop's", async () => {
    const { t, checkout } = await merchant();
    const { id, paymentUrl } = await checkout();
    expect(id).toMatch(/^bill_/);
    expect(paymentUrl).toBe(`${BASE}/dev/fake-pay/${id}`);
    expect(t.billingPayments.get(id)).toMatchObject({ amountFen: 2900, returnUrl: `${BASE}/admin/billing?paid=${id}` });
    expect(t.payments.get(id)).toBeUndefined();
  });

  it("hands out the same open payment again instead of a second one", async () => {
    const { t, checkout, overview } = await merchant();
    const first = await checkout();
    expect(await checkout()).toEqual(first);
    // Too close to expiry to pay in time: a fresh one.
    t.advance(14 * MINUTE);
    expect((await checkout()).id).not.toBe(first.id);
    expect((await overview()).payments).toHaveLength(2);
  });

  it("makes the shop 专业版 for a month once paid, and extends from the end when renewed", async () => {
    const { t, checkout, overview } = await merchant();
    const first = await checkout();
    expect(await t.pay(first)).toBe(`${BASE}/admin/billing?paid=${first.id}`);
    const paid = await overview();
    expect(paid).toMatchObject({ plan: "pro", proUntil: new Date("2026-11-15T10:00:00+08:00").toISOString() });
    expect(paid.payments[0]).toMatchObject({ id: first.id, status: "paid", periodStart: START.toISOString(), paymentUrl: null });

    // Renewing ten days in adds a month to the current end, not to today.
    t.advance(10 * 86_400_000);
    await t.pay(await checkout());
    expect((await overview()).proUntil).toBe(new Date("2026-12-15T10:00:00+08:00").toISOString());

    // Reading again doesn't count a payment twice.
    await t.billing.syncPayments();
    expect((await overview()).proUntil).toBe(new Date("2026-12-15T10:00:00+08:00").toISOString());
  });

  it("starts from the payment time after a lapse", async () => {
    const { t, checkout, overview } = await merchant();
    await t.pay(await checkout());
    await t.billing.syncPayments();
    t.advance(40 * 86_400_000);
    expect((await overview()).plan).toBe("free");
    await t.pay(await checkout());
    const now = new Date(START.getTime() + 40 * 86_400_000);
    expect((await overview()).proUntil).toBe(addMonths(now, 1).toISOString());
  });

  it("closes a payment left unpaid past its expiry", async () => {
    const { t, checkout, overview } = await merchant();
    const { id, paymentUrl } = await checkout();
    t.advance(16 * MINUTE);
    expect(await t.billing.syncPayments()).toBe(1);
    expect(t.billingPayments.get(id)?.state).toBe("closed");
    expect((await overview()).payments[0]).toMatchObject({ id, status: "closed" });
    expect((await t.app.request(paymentUrl, { method: "POST" })).status).toBe(409);
    expect((await overview()).plan).toBe("free");
  });

  it("settles a payment in the sweep without the merchant coming back", async () => {
    const { t, checkout } = await merchant();
    const { id, paymentUrl } = await checkout();
    await t.app.request(paymentUrl, { method: "POST" });
    expect(await t.billing.syncPayments()).toBe(1);
    expect(await t.billing.syncPayments()).toBe(0);
    expect(t.billingPayments.get(id)?.state).toBe("paid");
  });

  it("refunds the latest payment once, taking its month back", async () => {
    const { t, checkout, overview } = await merchant();
    const first = await checkout();
    await t.pay(first);
    await t.billing.syncPayments();
    t.advance(10 * 86_400_000);
    const second = await checkout();
    await t.pay(second);
    await t.billing.syncPayments();

    // Only the latest period can come out.
    await expect(t.billing.refund(first.id)).rejects.toMatchObject({ code: "not_latest" });
    const r = await t.billing.refund(second.id);
    expect(r).toMatchObject({ refundedNow: true, proUntil: new Date("2026-11-15T10:00:00+08:00").toISOString() });
    expect(t.billingPayments.refunds).toEqual([{ orderId: second.id, amountFen: 2900 }]);
    expect(await overview()).toMatchObject({ plan: "pro", proUntil: new Date("2026-11-15T10:00:00+08:00").toISOString() });
    expect((await overview()).payments[0]).toMatchObject({ id: second.id, status: "refunded" });

    // Again: nothing more is refunded.
    expect(await t.billing.refund(second.id)).toMatchObject({ refundedNow: false });
    expect(t.billingPayments.refunds).toHaveLength(1);

    // The month in use is refunded too: 专业版 ends now. A new payment starts from now.
    expect(await t.billing.refund(first.id)).toMatchObject({ refundedNow: true, proUntil: null });
    expect((await overview()).plan).toBe("free");
    await t.pay(await checkout());
    await t.billing.syncPayments();
    expect((await overview()).proUntil).toBe(addMonths(t.shop.now(), 1).toISOString());
  });

  it("won't refund a payment that wasn't paid", async () => {
    const { t, checkout } = await merchant();
    const { id } = await checkout();
    await expect(t.billing.refund(id)).rejects.toMatchObject({ code: "not_paid" });
    await expect(t.billing.refund("bill_missing")).rejects.toMatchObject({ code: "billing_payment_not_found" });
    expect(t.billingPayments.refunds).toEqual([]);
  });

  it("needs a signed-in merchant", async () => {
    const { t } = await merchant();
    expect((await t.call("POST", "/api/merchant/billing/checkout")).status).toBe(401);
  });

  it("reports both providers", async () => {
    const { t } = await merchant();
    expect(await t.ok("GET", "/healthz")).toEqual({ ok: true, payments: "fake", billing: "fake" });
  });
});

describe("addMonths", () => {
  it("adds calendar months in Beijing time and clamps to the month's end", () => {
    expect(addMonths(new Date("2026-01-31T12:00:00+08:00"), 1).toISOString()).toBe(new Date("2026-02-28T12:00:00+08:00").toISOString());
    // 00:30 on the 1st in Beijing is still the 31st in UTC.
    expect(addMonths(new Date("2026-11-01T00:30:00+08:00"), 1).toISOString()).toBe(new Date("2026-12-01T00:30:00+08:00").toISOString());
    expect(addMonths(new Date("2026-12-15T10:00:00+08:00"), 1).toISOString()).toBe(new Date("2027-01-15T10:00:00+08:00").toISOString());
  });
});
