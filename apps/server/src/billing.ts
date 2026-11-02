import { and, asc, desc, eq, gt, max } from "drizzle-orm";
import { fen, PAYMENT_TIMEOUT_MS } from "@openshop/core";
import type { Db } from "./db/client.ts";
import { acquireLease, releaseLease } from "./db/lease.ts";
import { billingPayments, shops } from "./db/schema.ts";
import type { PaymentProvider } from "./payments/provider.ts";
import { newId, providerCall, ShopError } from "./shop.ts";

// Merchants paying OpenShop for 专业版（含网站维护）. This is the platform's own revenue, so it
// goes through the platform's own payment provider (PLATFORM_ALIPAY_*), never the one that takes
// customers' payments for shops: customers' money must not pass through the platform's account
// (二清), and the platform's fee must not land in a shop's.

// One plan, bought one month at a time.
export const PRO_PRICE_FEN = 2900;
const PRO_MONTHS = 1;

// Billing payment ids are the out_trade_no. The prefix tells them from order ids (ord_…), which
// is how the fake cashier routes a payment to the right provider.
export const BILLING_ID_PREFIX = "bill";

// A pending payment is handed out again only while it leaves the merchant time to pay.
const REUSE_MARGIN_MS = 2 * 60_000;
const SWEEP_LEASE_MS = 60_000;

type BillingRow = typeof billingPayments.$inferSelect;

export type RenderedBillingPayment = {
  id: string;
  plan: BillingRow["plan"];
  months: number;
  amountFen: number;
  status: BillingRow["status"];
  paymentUrl: string | null;
  paymentExpiresAt: string;
  periodStart: string | null;
  periodEnd: string | null;
  createdAt: string;
  paidAt: string | null;
  refundedAt: string | null;
};

const render = (b: BillingRow): RenderedBillingPayment => ({
  id: b.id,
  plan: b.plan,
  months: b.months,
  amountFen: b.amountFen,
  status: b.status,
  // Only an open payment's cashier link is worth showing.
  paymentUrl: b.status === "pending" ? b.paymentUrl : null,
  paymentExpiresAt: b.paymentExpiresAt.toISOString(),
  periodStart: b.periodStart?.toISOString() ?? null,
  periodEnd: b.periodEnd?.toISOString() ?? null,
  createdAt: b.createdAt.toISOString(),
  paidAt: b.paidAt?.toISOString() ?? null,
  refundedAt: b.refundedAt?.toISOString() ?? null,
});

// Calendar months in Beijing time, clamped to the month's last day (Jan 31 + 1 → Feb 28).
export function addMonths(d: Date, months: number): Date {
  const local = new Date(d.getTime() + 8 * 3_600_000);
  const y = local.getUTCFullYear();
  const m = local.getUTCMonth() + months;
  const lastDay = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  local.setUTCFullYear(y, m, Math.min(local.getUTCDate(), lastDay));
  return new Date(local.getTime() - 8 * 3_600_000);
}

export class Billing {
  readonly db: Db;
  readonly payments: PaymentProvider;
  private readonly clock: () => Date;
  private readonly baseUrl: string;

  constructor(deps: { db: Db; payments: PaymentProvider; clock?: () => Date; baseUrl: string }) {
    this.db = deps.db;
    this.payments = deps.payments;
    this.clock = deps.clock ?? (() => new Date());
    this.baseUrl = deps.baseUrl;
  }

  // The shop's plan and recent payments. Asks the provider about pending ones first, so a
  // merchant coming back from the cashier sees the payment as soon as Alipay has it.
  async overview(shopId: string) {
    const pending = await this.db
      .select()
      .from(billingPayments)
      .where(and(eq(billingPayments.shopId, shopId), eq(billingPayments.status, "pending")));
    for (const b of pending) {
      await this.refresh(b).catch((err: unknown) => console.error(`billing refresh: ${b.id}:`, err));
    }
    const proUntil = await this.proUntil(this.db, shopId);
    const recent = await this.db
      .select()
      .from(billingPayments)
      .where(eq(billingPayments.shopId, shopId))
      .orderBy(desc(billingPayments.createdAt))
      .limit(20);
    return {
      plan: proUntil && proUntil > this.clock() ? ("pro" as const) : ("free" as const),
      proUntil: proUntil?.toISOString() ?? null,
      priceFen: PRO_PRICE_FEN,
      payments: recent.map(render),
    };
  }

  // A cashier link for one more month of 专业版. An open payment that still leaves time to pay
  // is handed out again, so pressing the button twice doesn't open two trades.
  async checkout(shopId: string) {
    const now = this.clock();
    const [open] = await this.db
      .select()
      .from(billingPayments)
      .where(
        and(
          eq(billingPayments.shopId, shopId),
          eq(billingPayments.status, "pending"),
          gt(billingPayments.paymentExpiresAt, new Date(now.getTime() + REUSE_MARGIN_MS)),
        ),
      )
      .orderBy(desc(billingPayments.createdAt))
      .limit(1);
    if (open) return { id: open.id, paymentUrl: open.paymentUrl };

    const id = newId(BILLING_ID_PREFIX);
    const paymentExpiresAt = new Date(now.getTime() + PAYMENT_TIMEOUT_MS);
    const { paymentUrl } = await providerCall(() =>
      this.payments.createPayment({
        orderId: id,
        shopId,
        amountFen: fen(PRO_PRICE_FEN),
        subject: `OpenShop 专业版 ${PRO_MONTHS} 个月`,
        expiresAt: paymentExpiresAt,
        returnUrl: `${this.baseUrl}/admin/billing?paid=${id}`,
      }),
    );
    await this.db.insert(billingPayments).values({
      id,
      shopId,
      plan: "pro",
      months: PRO_MONTHS,
      amountFen: PRO_PRICE_FEN,
      status: "pending",
      paymentUrl,
      paymentExpiresAt,
      createdAt: now,
    });
    return { id, paymentUrl };
  }

  // Run by jobs.ts next to the order sweep, under its own lease. Returns how many payments were
  // checked, or null when another instance is sweeping.
  async syncPayments(opts: { holder?: string; batch?: number } = {}): Promise<number | null> {
    const holder = opts.holder ?? newId("sweep");
    if (!(await acquireLease(this.db, "billing-sync", holder, this.clock(), SWEEP_LEASE_MS))) return null;
    try {
      const pending = await this.db
        .select()
        .from(billingPayments)
        .where(eq(billingPayments.status, "pending"))
        .orderBy(asc(billingPayments.paymentExpiresAt))
        .limit(opts.batch ?? 500);
      for (const b of pending) {
        await this.refresh(b).catch((err: unknown) => console.error(`billing sync: ${b.id}:`, err));
      }
      return pending.length;
    } finally {
      await releaseLease(this.db, "billing-sync", holder);
    }
  }

  // Settles one payment now, for a payment notification. Unknown ids are ignored.
  async syncPayment(id: string) {
    const [b] = await this.db.select().from(billingPayments).where(eq(billingPayments.id, id));
    if (b) await this.refresh(b);
  }

  // As OpenShop.refreshOrder: past its expiry an unpaid payment is closed at the provider, then
  // asked about once more, since the merchant may have paid in between.
  private async refresh(b: BillingRow) {
    if (b.status !== "pending") return;
    let state = await this.payments.queryPayment(b.id);
    if (state === "pending" && this.clock() >= b.paymentExpiresAt) {
      await this.payments.closePayment(b.id);
      state = await this.payments.queryPayment(b.id);
      if (state !== "paid") state = "closed";
    }
    if (state === "paid") await this.markPaid(b.id);
    else if (state === "closed") {
      await this.db
        .update(billingPayments)
        .set({ status: "closed" })
        .where(and(eq(billingPayments.id, b.id), eq(billingPayments.status, "pending")));
    }
  }

  // Idempotent: only a pending payment becomes paid. The shop row is locked so two payments
  // settling at once still line their months up end to end instead of overlapping.
  private async markPaid(id: string) {
    const now = this.clock();
    await this.db.transaction(async (tx) => {
      const [locked] = await tx.select().from(billingPayments).where(eq(billingPayments.id, id)).for("update");
      if (!locked || locked.status !== "pending") return;
      await tx.select({ id: shops.id }).from(shops).where(eq(shops.id, locked.shopId)).for("update");
      const until = await this.proUntil(tx, locked.shopId);
      // Renewing while active extends from the current end; otherwise the month starts now.
      const periodStart = until && until > now ? until : now;
      await tx
        .update(billingPayments)
        .set({ status: "paid", paidAt: now, periodStart, periodEnd: addMonths(periodStart, locked.months) })
        .where(eq(billingPayments.id, id));
    });
  }

  // Refunds a paid payment in full, once. There is no platform admin UI; the operator runs
  // billing-refund.ts. Its months stop counting, so the shop's 专业版 ends where the previous
  // payment's period does, or now if the refunded month was already in use. Only the shop's
  // latest period can be refunded: taking out one in the middle would leave a gap, and the
  // operator can refund later ones first.
  // The refund call runs inside the transaction, holding the shop row: if it fails nothing
  // changes, and if the commit fails a retry repeats the same out_request_no (<id>-refund),
  // which Alipay refunds only once.
  async refund(id: string): Promise<{ payment: RenderedBillingPayment; refundedNow: boolean; proUntil: string | null }> {
    const now = this.clock();
    return this.db.transaction(async (tx) => {
      const [found] = await tx.select({ shopId: billingPayments.shopId }).from(billingPayments).where(eq(billingPayments.id, id));
      if (!found) throw new ShopError(404, "billing_payment_not_found", `找不到付款 ${id}`);
      await tx.select({ id: shops.id }).from(shops).where(eq(shops.id, found.shopId)).for("update");
      const [locked] = await tx.select().from(billingPayments).where(eq(billingPayments.id, id)).for("update");
      const b = locked!;
      const until = async () => (await this.proUntil(tx, b.shopId))?.toISOString() ?? null;
      if (b.status === "refunded") return { payment: render(b), refundedNow: false, proUntil: await until() };
      if (b.status !== "paid") throw new ShopError(409, "not_paid", "这笔付款没有付成功，不能退款");
      if (b.periodEnd!.getTime() !== (await this.proUntil(tx, b.shopId))?.getTime()) {
        throw new ShopError(409, "not_latest", "只能退最后一笔专业版付款，请先退之后的付款");
      }
      await providerCall(() => this.payments.refund({ orderId: b.id, amountFen: fen(b.amountFen) }));
      const [done] = await tx.update(billingPayments).set({ status: "refunded", refundedAt: now }).where(eq(billingPayments.id, id)).returning();
      return { payment: render(done!), refundedNow: true, proUntil: await until() };
    });
  }

  // Only paid, unrefunded months count.
  private async proUntil(db: Db, shopId: string): Promise<Date | null> {
    const [row] = await db
      .select({ until: max(billingPayments.periodEnd) })
      .from(billingPayments)
      .where(and(eq(billingPayments.shopId, shopId), eq(billingPayments.status, "paid")));
    return row?.until ?? null;
  }
}
