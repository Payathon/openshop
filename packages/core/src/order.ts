import type { Fulfillment } from "./catalog.ts";

// pending_payment ─pay→ confirmed (booking) ─→ completed
//                 ─pay→ paid (shipping) ─ship→ shipped ─→ completed
// pending_payment ─timeout→ expired; any non-terminal ─cancel→ cancelled
export type OrderStatus = "pending_payment" | "confirmed" | "paid" | "shipped" | "completed" | "cancelled" | "expired";

export const TERMINAL: ReadonlySet<OrderStatus> = new Set(["completed", "cancelled", "expired"]);

// How long stock and slots are held for an unpaid order.
export const PAYMENT_TIMEOUT_MS = 15 * 60_000;

const NEXT: Record<OrderStatus, OrderStatus[]> = {
  pending_payment: ["confirmed", "paid", "cancelled", "expired"],
  confirmed: ["completed", "cancelled"],
  paid: ["shipped", "cancelled"],
  shipped: ["completed"],
  completed: [],
  cancelled: [],
  expired: [],
};

export function canTransition(from: OrderStatus, to: OrderStatus): boolean {
  return NEXT[from].includes(to);
}

export function statusAfterPayment(fulfillment: Fulfillment): OrderStatus {
  return fulfillment === "booking" ? "confirmed" : "paid";
}

export interface CancelPolicy {
  freeCancelHoursBefore: number;
}

export type CancelDecision = { allowed: true; refund: boolean } | { allowed: false; reason: string };

// What happens when the customer cancels on their own. Anything refused here goes to the merchant.
export function cancellation(
  order: { status: OrderStatus; fulfillment: Fulfillment; slotStart: Date | null },
  policy: CancelPolicy,
  now: Date,
): CancelDecision {
  switch (order.status) {
    case "pending_payment":
      return { allowed: true, refund: false };
    case "confirmed": {
      const cutoff = order.slotStart!.getTime() - policy.freeCancelHoursBefore * 3_600_000;
      if (now.getTime() <= cutoff) return { allowed: true, refund: true };
      return { allowed: false, reason: `距离预约开始不足 ${policy.freeCancelHoursBefore} 小时，需要联系商家取消` };
    }
    case "paid":
      return { allowed: true, refund: true };
    case "shipped":
      return { allowed: false, reason: "订单已发货，需要联系商家处理" };
    default:
      return { allowed: false, reason: "订单已结束，无法取消" };
  }
}
