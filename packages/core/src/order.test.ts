import { describe, expect, it } from "vitest";
import { cancellation, canTransition, statusAfterPayment } from "./order.ts";

const HOUR = 3_600_000;
const now = new Date("2026-10-15T12:00:00+08:00");

describe("order transitions", () => {
  it("confirms bookings on payment but leaves shipping orders waiting to ship", () => {
    expect(statusAfterPayment("booking")).toBe("confirmed");
    expect(statusAfterPayment("shipping")).toBe("paid");
  });

  it("only allows shipping a paid shipping order", () => {
    expect(canTransition("paid", "shipped")).toBe(true);
    expect(canTransition("confirmed", "shipped")).toBe(false);
    expect(canTransition("pending_payment", "shipped")).toBe(false);
  });

  it("never leaves a terminal status", () => {
    expect(canTransition("cancelled", "confirmed")).toBe(false);
    expect(canTransition("expired", "paid")).toBe(false);
  });
});

describe("cancellation", () => {
  const policy = { freeCancelHoursBefore: 24 };

  it("cancels an unpaid order without a refund", () => {
    expect(cancellation({ status: "pending_payment", fulfillment: "booking", slotStart: null }, policy, now)).toEqual({
      allowed: true,
      refund: false,
    });
  });

  it("refunds a booking cancelled before the free-cancel cutoff", () => {
    const slotStart = new Date(now.getTime() + 30 * HOUR);
    expect(cancellation({ status: "confirmed", fulfillment: "booking", slotStart }, policy, now)).toEqual({
      allowed: true,
      refund: true,
    });
  });

  it("needs the merchant once a booking is past the cutoff", () => {
    const slotStart = new Date(now.getTime() + 2 * HOUR);
    expect(cancellation({ status: "confirmed", fulfillment: "booking", slotStart }, policy, now)).toEqual({
      allowed: false,
      reason: "距离预约开始不足 24 小时，需要联系商家取消",
    });
  });

  it("refunds a shipping order that has not shipped yet", () => {
    expect(cancellation({ status: "paid", fulfillment: "shipping", slotStart: null }, policy, now)).toEqual({
      allowed: true,
      refund: true,
    });
  });

  it("refuses once shipped", () => {
    expect(cancellation({ status: "shipped", fulfillment: "shipping", slotStart: null }, policy, now)).toEqual({
      allowed: false,
      reason: "订单已发货，需要联系商家处理",
    });
  });
});
