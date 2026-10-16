import type { Fen } from "@openshop/core";
import type { PaymentProvider, PaymentRequest, PaymentState } from "./provider.ts";

// In-memory stand-in for Alipay, used in tests and local runs without credentials.
// The payment URL is a dev page; POSTing to it is what the customer's confirmation in Alipay would do.
export class FakePaymentProvider implements PaymentProvider {
  readonly name = "fake";
  readonly refunds: { orderId: string; amountFen: Fen }[] = [];
  private payments = new Map<string, PaymentRequest & { state: PaymentState }>();

  constructor(private readonly baseUrl: string) {}

  async createPayment(p: PaymentRequest) {
    this.payments.set(p.orderId, { ...p, state: "pending" });
    return { paymentUrl: `${this.baseUrl}/dev/fake-pay/${encodeURIComponent(p.orderId)}` };
  }

  async queryPayment(orderId: string): Promise<PaymentState> {
    return this.payments.get(orderId)?.state ?? "closed";
  }

  async closePayment(orderId: string) {
    const p = this.payments.get(orderId);
    if (p?.state === "pending") p.state = "closed";
  }

  async refund(r: { orderId: string; amountFen: Fen }) {
    this.refunds.push(r);
  }

  get(orderId: string) {
    return this.payments.get(orderId);
  }

  // Returns false when the payment is unknown or no longer payable.
  complete(orderId: string): boolean {
    const p = this.payments.get(orderId);
    if (!p || p.state === "closed") return false;
    p.state = "paid";
    return true;
  }
}
