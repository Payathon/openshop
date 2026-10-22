import { createSign, createVerify, generateKeyPairSync } from "node:crypto";
import { eq } from "drizzle-orm";
import { AlipaySdk, type AlipaySdkCommonResult } from "alipay-sdk";
import { fen } from "@openshop/core";
import { describe, expect, it } from "vitest";
import { orders } from "../db/schema.ts";
import { BASE, customer, setup } from "../test-helpers.ts";
import { ALIPAY_SANDBOX_GATEWAY, AlipayPagePayProvider, beijingTime, type AlipayClient } from "./alipay.ts";

const APP_ID = "9021000000000000";
const NOTIFY_URL = "https://openshop.example/payments/alipay/notify";

// Base64 body of a PEM, the form Alipay hands out keys in.
const bare = (pem: string) => pem.replace(/-----[^-]+-----|\s/g, "");
const pair = () => generateKeyPairSync("rsa", { modulusLength: 2048, publicKeyEncoding: { type: "spki", format: "pem" }, privateKeyEncoding: { type: "pkcs1", format: "pem" } });
// Our app's keys, and the keys Alipay signs its notifications with.
const app = pair();
const alipay = pair();

const sdk = new AlipaySdk({ appId: APP_ID, privateKey: bare(app.privateKey), alipayPublicKey: bare(alipay.publicKey), gateway: ALIPAY_SANDBOX_GATEWAY });

// Alipay's side, in memory: which trades customers opened and paid, and what we asked of it.
class Gateway {
  trades = new Map<string, string>();
  calls: { method: string; biz: Record<string, string> }[] = [];
  fail: AlipaySdkCommonResult | null = null;

  client: AlipayClient = {
    pageExec: sdk.pageExec.bind(sdk),
    checkNotifySignV2: sdk.checkNotifySignV2.bind(sdk),
    exec: async (method, params) => {
      const biz = params!.bizContent as Record<string, string>;
      this.calls.push({ method, biz });
      if (this.fail) return this.fail;
      const status = this.trades.get(biz.out_trade_no!);
      if (!status && method !== "alipay.trade.refund") return { code: "40004", msg: "Business Failed", subCode: "ACQ.TRADE_NOT_EXIST", subMsg: "交易不存在" };
      if (method === "alipay.trade.query") return { code: "10000", msg: "Success", tradeStatus: status };
      if (method === "alipay.trade.close") {
        if (status !== "WAIT_BUYER_PAY") return { code: "40004", msg: "Business Failed", subCode: "ACQ.TRADE_STATUS_ERROR", subMsg: "交易状态不合法" };
        this.trades.set(biz.out_trade_no!, "TRADE_CLOSED");
      }
      return { code: "10000", msg: "Success", fundChange: "Y" };
    },
  };
}

const provider = (gw = new Gateway()) => ({ gw, alipayPay: new AlipayPagePayProvider({ appId: APP_ID, privateKey: "", alipayPublicKey: "", notifyUrl: NOTIFY_URL }, gw.client) });

// Signs like Alipay does: every field but sign and sign_type, sorted, as k=v joined by &.
function signed(params: Record<string, string>): Record<string, string> {
  const content = Object.keys(params).sort().map((k) => `${k}=${params[k]}`).join("&");
  const sign = createSign("RSA-SHA256").update(content).sign(alipay.privateKey, "base64");
  return { ...params, sign_type: "RSA2", sign };
}

const notification = (orderId: string, extra: Record<string, string> = {}) =>
  signed({ app_id: APP_ID, out_trade_no: orderId, trade_no: "2026101522001400000000000001", trade_status: "TRADE_SUCCESS", total_amount: "168.00", notify_time: "2026-10-15 10:05:00", ...extra });

describe("Alipay 电脑网站支付", () => {
  it("signs a GET cashier link that expires with the order's hold", async () => {
    const { alipayPay } = provider();
    const { paymentUrl } = await alipayPay.createPayment({
      orderId: "ord_1",
      shopId: "shop_1",
      amountFen: fen(16850),
      subject: "小美美甲 - 法式/猫眼&纯色",
      expiresAt: new Date("2026-10-15T02:15:00Z"),
      returnUrl: `${BASE}/s/nail/orders/ord_1`,
    });

    const url = new URL(paymentUrl);
    expect(`${url.origin}${url.pathname}`).toBe(ALIPAY_SANDBOX_GATEWAY);
    const q = Object.fromEntries(url.searchParams);
    expect(q).toMatchObject({ app_id: APP_ID, method: "alipay.trade.page.pay", sign_type: "RSA2", return_url: `${BASE}/s/nail/orders/ord_1`, notify_url: NOTIFY_URL });
    expect(JSON.parse(q.biz_content!)).toEqual({
      out_trade_no: "ord_1",
      total_amount: "168.50",
      subject: "小美美甲 - 法式 猫眼 纯色",
      product_code: "FAST_INSTANT_TRADE_PAY",
      time_expire: "2026-10-15 10:15:00",
    });

    // The signature Alipay checks: all other parameters, sorted.
    const { sign, ...rest } = q;
    const content = Object.keys(rest).sort().map((k) => `${k}=${rest[k]}`).join("&");
    expect(createVerify("RSA-SHA256").update(content).verify(app.publicKey, sign!, "base64")).toBe(true);
  });

  it("leaves return_url out of agent orders", async () => {
    const { alipayPay } = provider();
    const { paymentUrl } = await alipayPay.createPayment({ orderId: "ord_2", shopId: "s", amountFen: fen(100), subject: "x", expiresAt: new Date() });
    expect(new URL(paymentUrl).searchParams.has("return_url")).toBe(false);
  });

  it("reads the trade status", async () => {
    const { gw, alipayPay } = provider();
    expect(await alipayPay.queryPayment("ord_1")).toBe("pending"); // cashier not opened yet
    for (const [status, state] of [["WAIT_BUYER_PAY", "pending"], ["TRADE_SUCCESS", "paid"], ["TRADE_FINISHED", "paid"], ["TRADE_CLOSED", "closed"]]) {
      gw.trades.set("ord_1", status!);
      expect(await alipayPay.queryPayment("ord_1")).toBe(state);
    }
    gw.fail = { code: "20000", msg: "Service Currently Unavailable", subCode: "isp.unknow-error", subMsg: "系统繁忙" };
    await expect(alipayPay.queryPayment("ord_1")).rejects.toThrow("isp.unknow-error");
  });

  it("closes an open trade and lets a missing or settled one be", async () => {
    const { gw, alipayPay } = provider();
    await alipayPay.closePayment("never-opened");
    gw.trades.set("paid", "TRADE_SUCCESS");
    await alipayPay.closePayment("paid");
    expect(gw.trades.get("paid")).toBe("TRADE_SUCCESS");
    gw.trades.set("open", "WAIT_BUYER_PAY");
    await alipayPay.closePayment("open");
    expect(gw.trades.get("open")).toBe("TRADE_CLOSED");
    gw.fail = { code: "40002", msg: "Invalid Arguments", subCode: "isv.invalid-signature", subMsg: "验签出错" };
    await expect(alipayPay.closePayment("open")).rejects.toThrow("isv.invalid-signature");
  });

  it("refunds in full with a request number a retry repeats", async () => {
    const { gw, alipayPay } = provider();
    await alipayPay.refund({ orderId: "ord_1", amountFen: fen(16800) });
    await alipayPay.refund({ orderId: "ord_1", amountFen: fen(16800) });
    expect(gw.calls.map((c) => c.biz)).toEqual([
      { out_trade_no: "ord_1", refund_amount: "168.00", out_request_no: "ord_1-refund" },
      { out_trade_no: "ord_1", refund_amount: "168.00", out_request_no: "ord_1-refund" },
    ]);
    gw.fail = { code: "40004", msg: "Business Failed", subCode: "ACQ.SELLER_BALANCE_NOT_ENOUGH", subMsg: "卖家余额不足" };
    await expect(alipayPay.refund({ orderId: "ord_1", amountFen: fen(16800) })).rejects.toThrow("ACQ.SELLER_BALANCE_NOT_ENOUGH");
  });

  it("trusts only notifications Alipay signed for this app", () => {
    const { alipayPay } = provider();
    expect(alipayPay.verifyNotification(notification("ord_1"))).toBe("ord_1");
    expect(alipayPay.verifyNotification({ ...notification("ord_1"), total_amount: "0.01" })).toBeNull();
    expect(alipayPay.verifyNotification(notification("ord_1", { app_id: "2021000000000001" }))).toBeNull();
    const { sign: _, ...unsigned } = notification("ord_1");
    expect(alipayPay.verifyNotification(unsigned)).toBeNull();
  });

  it("formats times in Beijing time", () => {
    expect(beijingTime(new Date("2026-12-31T16:30:05Z"))).toBe("2027-01-01 00:30:05");
  });
});

describe("Alipay in the shop", () => {
  const SAT = "2026-10-17";

  async function booked() {
    const { gw, alipayPay } = provider();
    const t = await setup(alipayPay);
    const { variantId } = await t.nailStudio();
    const order = await t.ok("POST", "/api/s/nail-studio/orders", {
      body: { items: [{ variantId, options: { color: "裸粉" } }], customer, slotStart: `${SAT}T14:00:00+08:00` },
    });
    const statusOf = async () => (await t.db.select({ status: orders.status }).from(orders).where(eq(orders.id, order.id)))[0]!.status;
    const notify = (form: Record<string, string>) =>
      t.app.request(`${BASE}/payments/alipay/notify`, { method: "POST", body: new URLSearchParams(form), headers: { "content-type": "application/x-www-form-urlencoded" } });
    return { t, gw, order, statusOf, notify };
  }

  it("hands the customer an Alipay cashier link", async () => {
    const { order } = await booked();
    expect(order.paymentUrl.startsWith(`${ALIPAY_SANDBOX_GATEWAY}?`)).toBe(true);
  });

  it("confirms the order as soon as Alipay's notification arrives", async () => {
    const { gw, order, statusOf, notify } = await booked();
    gw.trades.set(order.id, "TRADE_SUCCESS");
    const res = await notify(notification(order.id));
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("success");
    expect(await statusOf()).toBe("confirmed");
  });

  it("asks Alipay rather than believing the notification", async () => {
    const { gw, order, statusOf, notify } = await booked();
    gw.trades.set(order.id, "WAIT_BUYER_PAY");
    expect((await notify(notification(order.id))).status).toBe(200);
    expect(await statusOf()).toBe("pending_payment");
  });

  it("rejects a forged notification", async () => {
    const { gw, order, statusOf, notify } = await booked();
    gw.trades.set(order.id, "TRADE_SUCCESS");
    const res = await notify({ ...notification(order.id), sign: "forged" });
    expect(res.status).toBe(400);
    expect(await statusOf()).toBe("pending_payment");
  });

  it("still shows the order while Alipay is unreachable, and says so on cancel", async () => {
    const { t, gw, order } = await booked();
    gw.fail = { code: "20000", msg: "Service Currently Unavailable", subCode: "isp.unknow-error", subMsg: "系统繁忙" };
    const read = await t.call("GET", `/api/orders/${order.id}`, { orderToken: order.accessToken });
    expect(read).toMatchObject({ status: 200, body: { status: "pending_payment" } });
    const cancel = await t.call("POST", `/api/orders/${order.id}/cancel`, { orderToken: order.accessToken });
    expect(cancel).toMatchObject({ status: 502, body: { error: "payment_unavailable" } });
  });

  it("expires an order whose cashier was never opened", async () => {
    const { t, gw, order, statusOf } = await booked();
    t.advance(16 * 60_000);
    await t.shop.syncPayments();
    expect(await statusOf()).toBe("expired");
    expect(gw.calls.map((c) => c.method)).toContain("alipay.trade.close");
  });
});
