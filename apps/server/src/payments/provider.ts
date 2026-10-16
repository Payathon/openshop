import type { Fen } from "@openshop/core";

// Modelled on 电脑网站支付 (alipay.trade.page.pay): the order id is out_trade_no, the
// payment URL is the cashier, and results are read with query because local runs have
// no public notify_url. Money always goes to the shop's own account (no 二清).
export type PaymentState = "pending" | "paid" | "closed";

export interface PaymentRequest {
  orderId: string;
  shopId: string;
  amountFen: Fen;
  subject: string;
  expiresAt: Date;
}

export interface PaymentProvider {
  readonly name: string;
  createPayment(p: PaymentRequest): Promise<{ paymentUrl: string }>;
  queryPayment(orderId: string): Promise<PaymentState>;
  // Closes an unpaid payment so it can no longer be paid (alipay.trade.close).
  closePayment(orderId: string): Promise<void>;
  refund(p: { orderId: string; amountFen: Fen }): Promise<void>;
}
