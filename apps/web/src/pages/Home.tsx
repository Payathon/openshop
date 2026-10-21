import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router";
import { renderSVG } from "uqr";
import { get } from "../api.ts";
import { useSession } from "../session.tsx";
import { useStudio } from "../studio.tsx";
import { Badge, Card, Empty, Page, useToast, yuan } from "../ui.tsx";
import { itemsText, SourceBadge, StatusBadge, whenText, type Order } from "./Orders.tsx";

const dayKey = (iso: string) => new Date(iso).toLocaleDateString("zh-CN", { timeZone: "Asia/Shanghai" });

function SetupGuide() {
  const { overview, publish } = useStudio();
  const navigate = useNavigate();
  if (!overview) return null;
  const samples = overview.products.filter((p) => p.sample && p.published);
  const hasProducts = overview.products.some((p) => p.published && !p.sample);
  const live = overview.shop.status === "live";
  const steps = [
    {
      done: samples.length === 0 && hasProducts,
      title: "换上你的真实商品",
      body: samples.length
        ? `店里现在有 ${samples.length} 个示例商品（${samples.map((p) => p.name).join("、")}）。改成你自己的名字和价格，或者删掉。`
        : "顾客会在店铺页上看到这些商品并直接下单。",
      action: () => navigate("/products"),
      label: "去改商品",
    },
    ...(overview.shop.hours
      ? [{ done: false, optional: true, title: "确认营业时间", body: "顾客只能在营业时间内预约。临时休息也在这里设置。", action: () => navigate("/schedule"), label: "设置时间" }]
      : []),
    { done: false, optional: true, title: "装修店铺", body: "换主色、加横幅和相册，让店铺更像你。", action: () => navigate("/design"), label: "去装修" },
    {
      done: live,
      title: "发布上线",
      body: live ? "店铺已经上线，可以分享给顾客了。" : "发布后顾客就能打开你的店铺，下单付款。",
      action: () => void publish(),
      label: "发布上线",
    },
  ];
  const doneCount = steps.filter((s) => s.done).length;
  if (live && samples.length === 0) return null;

  return (
    <Card title="开店指南" action={<span className="subtle">已完成 {doneCount} / {steps.length}</span>}>
      <div className="guide">
        {steps.map((s, i) => (
          <div key={i} className={s.done ? "guide-step done" : "guide-step"}>
            <span className="guide-check" aria-hidden>
              {s.done ? "✓" : i + 1}
            </span>
            <div className="stack" style={{ gap: 4, flex: 1 }}>
              <div className="row">
                <strong>{s.title}</strong>
                {"optional" in s && s.optional && <Badge>可选</Badge>}
              </div>
              <p className="muted">{s.body}</p>
            </div>
            {!s.done && (
              <button className={i === steps.length - 1 ? "btn primary" : "btn"} onClick={s.action}>
                {s.label}
              </button>
            )}
          </div>
        ))}
      </div>
    </Card>
  );
}

function ShareCard() {
  const { shop } = useSession();
  const toast = useToast();
  const qr = useMemo(() => renderSVG(shop.url, { border: 1 }), [shop.url]);
  const copy = async (text: string, what: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast(`${what}已复制`);
    } catch {
      prompt("复制下面的内容", text);
    }
  };
  const agentHint = `帮我在这家店下单：${shop.url}`;

  return (
    <Card title="分享你的店铺">
      <div className="share">
        <div className="qr" dangerouslySetInnerHTML={{ __html: qr }} aria-label="店铺二维码" />
        <div className="stack" style={{ flex: 1, minWidth: 0 }}>
          <div className="link-box">{shop.url}</div>
          <div className="row">
            <button className="btn primary" onClick={() => void copy(shop.url, "店铺链接")}>
              复制链接
            </button>
            <a className="btn" href={shop.url} target="_blank" rel="noreferrer">
              打开店铺
            </a>
          </div>
          <p className="subtle">
            发到微信群、朋友圈或小红书。顾客也可以把链接丢给自己的 AI 助手，比如对 Claude 说“{agentHint}”，助手会帮他查时间、下单。
          </p>
        </div>
      </div>
    </Card>
  );
}

function Today(props: { live: boolean }) {
  const [orders, setOrders] = useState<Order[] | null>(null);
  const navigate = useNavigate();
  useEffect(() => {
    get<Order[]>("/api/merchant/orders").then(setOrders, () => setOrders([]));
  }, []);
  // A shop that isn't live yet and has no orders has nothing to show here.
  if (!orders || (!props.live && orders.length === 0)) return null;
  const today = dayKey(new Date().toISOString());
  const paid = orders.filter((o) => o.paidAt);
  const todo = orders.filter((o) => o.status === "confirmed" || o.status === "paid");
  const upcoming = orders
    .filter((o) => o.status === "confirmed" && o.slotStart && new Date(o.slotStart) > new Date())
    .sort((a, b) => a.slotStart!.localeCompare(b.slotStart!))
    .slice(0, 5);
  const toShip = orders.filter((o) => o.status === "paid");
  const list = upcoming.length ? upcoming : toShip.slice(0, 5);

  return (
    <>
      <div className="stats">
        <Card>
          <span className="subtle">今日订单</span>
          <span className="stat">{paid.filter((o) => dayKey(o.paidAt!) === today).length}</span>
        </Card>
        <Card>
          <span className="subtle">待处理</span>
          <span className="stat">{todo.length}</span>
        </Card>
        <Card>
          <span className="subtle">累计收入</span>
          <span className="stat">{yuan(paid.filter((o) => !o.refunded).reduce((s, o) => s + o.totalFen, 0))}</span>
        </Card>
      </div>
      <Card flush title={upcoming.length ? "接下来的预约" : toShip.length ? "待发货" : "订单"} action={<Link to="/orders">全部订单</Link>}>
        {list.length === 0 ? (
          <Empty>{orders.length ? "暂时没有要处理的订单" : "还没有订单。把店铺分享出去，第一单就会出现在这里。"}</Empty>
        ) : (
          <div className="list">
            {list.map((o) => (
              <button key={o.id} className="list-row" onClick={() => navigate(`/orders/${o.id}`)}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div>
                    <strong>{o.customer.name}</strong> · {itemsText(o)}
                  </div>
                  <div className="subtle">{whenText(o)}</div>
                </div>
                <div className="row">
                  <SourceBadge source={o.source} />
                  <StatusBadge status={o.status} />
                </div>
              </button>
            ))}
          </div>
        )}
      </Card>
    </>
  );
}

export function Home() {
  const { me, shop } = useSession();
  return (
    <Page title={`你好，${me.account.name}`}>
      <SetupGuide />
      {shop.status === "live" ? <ShareCard /> : null}
      <Today live={shop.status === "live"} />
    </Page>
  );
}
