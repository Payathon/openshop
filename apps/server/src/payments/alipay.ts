import { AlipaySdk, type AlipaySdkCommonResult } from "alipay-sdk";
import { fenToYuan, type Fen } from "@openshop/core";
import type { PaymentProvider, PaymentRequest, PaymentState } from "./provider.ts";

export const ALIPAY_SANDBOX_GATEWAY = "https://openapi-sandbox.dl.alipaydev.com/gateway.do";

export interface AlipayConfig {
  appId: string;
  // The app's private key for Node: PKCS#1, the raw base64 without PEM header lines.
  privateKey: string;
  // Alipay's public key, used to verify responses and notifications.
  alipayPublicKey: string;
  // Defaults to the sandbox; production sets https://openapi.alipay.com/gateway.do explicitly.
  gateway?: string | undefined;
  // Public HTTPS address Alipay posts payment results to. Without it results come only from query.
  notifyUrl?: string | undefined;
}

// What the provider needs from the SDK; tests pass a stand-in.
export type AlipayClient = Pick<AlipaySdk, "pageExec" | "exec" | "checkNotifySignV2">;

// 电脑网站支付 (AI网页应用收款, the Vibe Pay web product). The same cashier link serves both
// paths: a web customer opens it in the browser, and a customer's agent hands it to Alipay's
// payment skill. All money goes to this app's own account.
export class AlipayPagePayProvider implements PaymentProvider {
  readonly name = "alipay";
  private readonly sdk: AlipayClient;

  constructor(
    private readonly config: AlipayConfig,
    sdk?: AlipayClient,
  ) {
    this.sdk =
      sdk ??
      new AlipaySdk({
        appId: config.appId,
        privateKey: config.privateKey,
        alipayPublicKey: config.alipayPublicKey,
        gateway: config.gateway ?? ALIPAY_SANDBOX_GATEWAY,
        signType: "RSA2",
        timeout: 10_000,
      });
  }

  // Signs locally without calling Alipay, so placing an order never waits on the gateway. The
  // trade itself exists at Alipay only once the customer opens the cashier.
  async createPayment(p: PaymentRequest) {
    // A GET link rather than the auto-submitting form: agents need a URL to pass on, and it is
    // the form's action plus its fields, as in Alipay's agent-pay demo.
    const paymentUrl = this.sdk.pageExec("alipay.trade.page.pay", "GET", {
      bizContent: {
        out_trade_no: p.orderId,
        total_amount: fenToYuan(p.amountFen),
        subject: cleanSubject(p.subject),
        product_code: "FAST_INSTANT_TRADE_PAY",
        // Alipay stops taking payment when our hold on the stock or slot runs out.
        time_expire: beijingTime(p.expiresAt),
      },
      ...(p.returnUrl ? { returnUrl: p.returnUrl } : {}),
      ...(this.config.notifyUrl ? { notifyUrl: this.config.notifyUrl } : {}),
    });
    return { paymentUrl };
  }

  async queryPayment(orderId: string): Promise<PaymentState> {
    const r = await this.sdk.exec("alipay.trade.query", { bizContent: { out_trade_no: orderId } });
    // Not opened at Alipay yet: still payable until time_expire.
    if (r.subCode === "ACQ.TRADE_NOT_EXIST") return "pending";
    check("alipay.trade.query", r);
    switch (r.tradeStatus) {
      case "TRADE_SUCCESS":
      case "TRADE_FINISHED":
        return "paid";
      case "WAIT_BUYER_PAY":
        return "pending";
      case "TRADE_CLOSED":
        return "closed";
      default:
        throw new Error(`alipay.trade.query: unknown trade_status ${r.tradeStatus}`);
    }
  }

  async closePayment(orderId: string) {
    const r = await this.sdk.exec("alipay.trade.close", { bizContent: { out_trade_no: orderId } });
    // Never opened (nothing to close; time_expire keeps it shut) or already paid or closed:
    // the caller queries next and acts on what it finds.
    if (r.subCode === "ACQ.TRADE_NOT_EXIST" || r.subCode === "ACQ.TRADE_STATUS_ERROR") return;
    check("alipay.trade.close", r);
  }

  // Orders are only ever refunded in full, once, so the order id doubles as the refund request
  // number; a retry after a timeout repeats the same request instead of refunding twice.
  async refund(r: { orderId: string; amountFen: Fen }) {
    const res = await this.sdk.exec("alipay.trade.refund", {
      bizContent: { out_trade_no: r.orderId, refund_amount: fenToYuan(r.amountFen), out_request_no: `${r.orderId}-refund` },
    });
    check("alipay.trade.refund", res);
  }

  // A payment notification we can trust: signed by Alipay and meant for this app. Returns the
  // order id it is about; the caller confirms the state with queryPayment.
  verifyNotification(params: Record<string, string>): string | null {
    if (params.app_id !== this.config.appId || !params.out_trade_no) return null;
    return this.sdk.checkNotifySignV2(params) ? params.out_trade_no : null;
  }
}

function check(method: string, r: AlipaySdkCommonResult) {
  if (r.code !== "10000") throw new Error(`${method}: ${r.code} ${r.subCode ?? ""} ${r.subMsg ?? r.msg}`.trim());
}

// Alipay rejects / = & in subject.
const cleanSubject = (s: string) => s.replace(/[/=&]/g, " ").slice(0, 256);

// "yyyy-MM-dd HH:mm:ss" in Beijing time, whatever the server's own time zone.
export const beijingTime = (d: Date) => new Date(d.getTime() + 8 * 3600_000).toISOString().slice(0, 19).replace("T", " ");
