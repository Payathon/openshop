import { useEffect, useState } from "react";
import { useSearchParams } from "react-router";
import { get, message, post } from "../api.ts";
import { Badge, Banner, Card, Empty, Page, dateTime, useToast, yuan } from "../ui.tsx";

interface BillingPayment {
  id: string;
  months: number;
  amountFen: number;
  status: "pending" | "paid" | "closed" | "refunded";
  paymentUrl: string | null;
  paymentExpiresAt: string;
  periodStart: string | null;
  periodEnd: string | null;
  createdAt: string;
  paidAt: string | null;
  refundedAt: string | null;
}

export interface Billing {
  plan: "free" | "pro";
  // What the current 专业版 run ends with: the 14-day trial, a paid month, or a grant from us.
  source: "trial" | "paid" | "grant" | null;
  // When 专业版 ends, or ended once it has lapsed.
  proUntil: string | null;
  trialEndsAt: string;
  priceFen: number;
  payments: BillingPayment[];
}

// Same list as the homepage's pricing section. The free plan is the website only.
const PRO_FEATURES = [
  "在线预约和下单",
  "支付宝收款与自动退款",
  "顾客的 AI 助手下单（MCP 和 Skill）",
  "订单与顾客管理",
  "自定义域名",
  "去掉 OpenShop 标识",
  "更多次数的 AI 改店",
  "网站托管与维护",
];

export const fullDate = (iso: string) => new Date(iso).toLocaleDateString("zh-CN", { timeZone: "Asia/Shanghai", year: "numeric", month: "long", day: "numeric" });

// Whole days left, counting a part day as one, so the last day reads 还剩 1 天.
export const daysLeft = (iso: string) => Math.max(1, Math.ceil((new Date(iso).getTime() - Date.now()) / 86_400_000));

// Back from the cashier, Alipay may take a moment to report the payment; each read asks it.
const POLL_MS = 2_000;
const POLL_TIMES = 10;

export function BillingPage() {
  const [params, setParams] = useSearchParams();
  const paidId = params.get("paid");
  const toast = useToast();
  const [billing, setBilling] = useState<Billing | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(paidId !== null);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const load = async (left: number) => {
      try {
        const b = await get<Billing>("/api/merchant/billing");
        if (cancelled) return;
        setBilling(b);
        setError(null);
        if (!paidId) return;
        const p = b.payments.find((x) => x.id === paidId);
        if (p?.status === "paid") {
          setConfirming(false);
          toast("已开通专业版");
          setParams({}, { replace: true });
        } else if (p?.status === "pending" && left > 0) {
          timer = setTimeout(() => void load(left - 1), POLL_MS);
        } else {
          setConfirming(false);
        }
      } catch (e) {
        if (!cancelled) setError(message(e));
        setConfirming(false);
      }
    };
    void load(POLL_TIMES);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [paidId, setParams, toast]);

  async function checkout() {
    setBusy(true);
    try {
      const { paymentUrl } = await post<{ id: string; paymentUrl: string }>("/api/merchant/billing/checkout");
      window.location.href = paymentUrl;
    } catch (e) {
      toast(message(e), { critical: true });
      setBusy(false);
    }
  }

  const pro = billing?.plan === "pro";
  const waiting = paidId && billing?.payments.find((p) => p.id === paidId);
  const history = billing?.payments.filter((p) => p.status === "paid" || p.status === "refunded") ?? [];

  return (
    <Page title="套餐与续费" narrow>
      {error && <Banner tone="critical">{error}</Banner>}
      {confirming && <Banner tone="info" title="正在确认付款…">支付宝确认后，这里会自动更新。</Banner>}
      {!confirming && waiting && waiting.status !== "paid" && (
        <Banner tone="warning" title="还没收到这笔付款">
          {waiting.status === "pending" ? "如果已经付过款，稍等片刻刷新页面。" : "这笔付款已超时关闭，没有扣款。可以重新开通。"}
        </Banner>
      )}

      <Card title="当前套餐">
        {!billing ? (
          <Empty>加载中…</Empty>
        ) : (
          <div className="row between">
            <div className="stack" style={{ gap: 2 }}>
              <div className="row">
                <strong>{pro ? "专业版" : "免费版"}</strong>
                {billing.source === "trial" && <Badge tone="info">试用中</Badge>}
                {billing.source === "paid" && <Badge tone="success">使用中</Badge>}
                {billing.source === "grant" && <Badge tone="success">赠送</Badge>}
              </div>
              <div className="subtle">
                {billing.source === "trial"
                  ? `试用到 ${fullDate(billing.proUntil!)}，还剩 ${daysLeft(billing.proUntil!)} 天。在试用期内开通，从试用结束那天开始算，不浪费试用的天数。`
                  : pro
                    ? `${fullDate(billing.proUntil!)} 到期`
                    : `专业版已于 ${fullDate(billing.proUntil ?? billing.trialEndsAt)} 到期。店铺目前只能展示，顾客无法在线下单，只能打电话联系你。`}
              </div>
            </div>
          </div>
        )}
      </Card>

      <Card title="专业版" action={<strong>{yuan(billing?.priceFen ?? 2900)}/月</strong>}>
        <ul className="stack" style={{ gap: 6, margin: 0, paddingLeft: 20 }}>
          {PRO_FEATURES.map((f) => (
            <li key={f}>{f}</li>
          ))}
        </ul>
        <p className="subtle">按月购买，每次一个月，不自动续费。到期前（包括试用期内）续费，从原到期日往后顺延一个月。免费版只有店铺网站：商品展示、营业时间、地址和电话。</p>
        <div>
          <button className="btn primary" onClick={() => void checkout()} disabled={busy || !billing}>
            {busy ? "正在打开支付宝…" : billing?.source === "paid" ? "续费一个月" : "开通专业版"}
          </button>
        </div>
      </Card>

      <Card flush title="付款记录">
        {!billing ? (
          <Empty>加载中…</Empty>
        ) : history.length === 0 ? (
          <Empty>还没有付款记录</Empty>
        ) : (
          <div className="list">
            {history.map((p) => (
              <div key={p.id} className="history-row">
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className="row">
                    <strong>专业版 {p.months} 个月</strong>
                    {p.status === "refunded" && <Badge>已退款</Badge>}
                    <span className="subtle">{dateTime(p.paidAt!)}</span>
                  </div>
                  <div className="subtle">
                    {p.status === "refunded" ? `${dateTime(p.refundedAt!)} 全额退款，这个月不再计入` : `${fullDate(p.periodStart!)} 至 ${fullDate(p.periodEnd!)}`}
                  </div>
                </div>
                <span>{yuan(p.amountFen)}</span>
              </div>
            ))}
          </div>
        )}
      </Card>
    </Page>
  );
}
