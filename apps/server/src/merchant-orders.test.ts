import { expect, it } from "vitest";
import { address, customer, setup } from "./test-helpers.ts";

const SAT = "2026-10-17";
const sat = (hhmm: string) => new Date(`${SAT}T${hhmm}:00+08:00`).toISOString();

it("lets the merchant cancel a paid booking inside the customer's window, refunding it and freeing the slot", async () => {
  const t = await setup();
  const { variantId, token } = await t.nailStudio();
  const order = await t.ok("POST", "/api/s/nail-studio/orders", {
    body: { items: [{ variantId, options: { color: "裸粉" } }], customer, slotStart: sat("14:00") },
  });
  await t.pay(order);
  // Within 24 hours of the slot the customer can no longer cancel themselves; the merchant still can.
  t.advance(2 * 86_400_000 + 3 * 3_600_000);
  expect((await t.call("POST", `/api/orders/${order.id}/cancel`, { orderToken: order.accessToken })).body.error).toBe("cancel_not_allowed");

  const cancelled = await t.ok("POST", `/api/merchant/orders/${order.id}/cancel`, { token });
  expect(cancelled).toMatchObject({ status: "cancelled", refunded: true });
  expect(t.payments.refunds).toEqual([{ orderId: order.id, amountFen: 16800 }]);
  const slots = await t.ok("GET", `/api/s/nail-studio/availability?variantId=${variantId}&date=${SAT}`);
  expect(slots.slots.map((s: { start: string }) => s.start)).toContain(sat("14:00"));
});

it("cancels an unpaid order without a refund, and completes a booking", async () => {
  const t = await setup();
  const { variantId, token } = await t.nailStudio();
  const unpaid = await t.ok("POST", "/api/s/nail-studio/orders", { body: { items: [{ variantId, options: { color: "裸粉" } }], customer, slotStart: sat("10:00") } });
  expect(await t.ok("POST", `/api/merchant/orders/${unpaid.id}/cancel`, { token })).toMatchObject({ status: "cancelled", refunded: false });
  expect(t.payments.refunds).toEqual([]);

  const booked = await t.ok("POST", "/api/s/nail-studio/orders", { body: { items: [{ variantId, options: { color: "裸粉" } }], customer, slotStart: sat("16:00") } });
  await t.pay(booked);
  expect(await t.ok("GET", `/api/merchant/orders/${booked.id}`, { token })).toMatchObject({ status: "confirmed" });
  expect(await t.ok("POST", `/api/merchant/orders/${booked.id}/complete`, { token })).toMatchObject({ status: "completed" });
  expect((await t.call("POST", `/api/merchant/orders/${booked.id}/cancel`, { token })).body.error).toBe("cancel_not_allowed");
});

it("won't cancel a shipped order or touch another shop's orders", async () => {
  const t = await setup();
  const { token, smallId } = await t.bakery();
  const nail = await t.nailStudio();
  const order = await t.ok("POST", "/api/s/bakery/orders", { body: { items: [{ variantId: smallId }], customer, address } });
  await t.pay(order);
  expect((await t.call("POST", `/api/merchant/orders/${order.id}/cancel`, { token: nail.token })).status).toBe(404);
  await t.ok("POST", `/api/merchant/orders/${order.id}/ship`, { token, body: { trackingNo: "SF1" } });
  expect((await t.call("POST", `/api/merchant/orders/${order.id}/cancel`, { token })).body.message).toBe("订单已发货，不能取消");
  expect(await t.ok("POST", `/api/merchant/orders/${order.id}/complete`, { token })).toMatchObject({ status: "completed" });
});
