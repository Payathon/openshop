import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { get, message, post } from "../api.ts";
import { Badge, Banner, Card, Empty, Field, Page, dateTime, timeOnly, useToast, yuan } from "../ui.tsx";

export type OrderStatus = "pending_payment" | "confirmed" | "paid" | "shipped" | "completed" | "cancelled" | "expired";

export interface Order {
  id: string;
  status: OrderStatus;
  fulfillment: "booking" | "shipping";
  source: "web" | "agent";
  items: { productName: string; attributes: Record<string, string>; options: Record<string, string>; quantity: number; unitFen: number }[];
  totalFen: number;
  customer: { name: string; phone: string };
  address: { recipient: string; phone: string; region: string; detail: string } | null;
  slotStart: string | null;
  slotEnd: string | null;
  refunded: boolean;
  trackingNo: string | null;
  createdAt: string;
  paidAt: string | null;
}

const STATUS: Record<OrderStatus, { label: string; tone?: "success" | "warning" | "critical" | "info" }> = {
  pending_payment: { label: "待付款", tone: "warning" },
  confirmed: { label: "已预约", tone: "success" },
  paid: { label: "待发货", tone: "info" },
  shipped: { label: "已发货", tone: "success" },
  completed: { label: "已完成" },
  cancelled: { label: "已取消" },
  expired: { label: "已关闭" },
};

export const StatusBadge = (props: { status: OrderStatus }) => <Badge {...(STATUS[props.status].tone ? { tone: STATUS[props.status].tone } : {})}>{STATUS[props.status].label}</Badge>;
export const SourceBadge = (props: { source: Order["source"] }) => (props.source === "agent" ? <Badge tone="info">来自 AI</Badge> : null);

const FILTERS: { key: string; label: string; match: (o: Order) => boolean }[] = [
  { key: "todo", label: "待处理", match: (o) => o.status === "confirmed" || o.status === "paid" },
  { key: "all", label: "全部", match: () => true },
  { key: "pending", label: "待付款", match: (o) => o.status === "pending_payment" },
  { key: "done", label: "已结束", match: (o) => ["shipped", "completed", "cancelled", "expired"].includes(o.status) },
];

export const itemsText = (o: Order) =>
  o.items.map((i) => `${i.productName}${Object.values(i.attributes).length ? `（${Object.values(i.attributes).join("/")}）` : ""}${i.quantity > 1 ? ` ×${i.quantity}` : ""}`).join("、");

export const whenText = (o: Order) =>
  o.slotStart && o.slotEnd ? `${dateTime(o.slotStart)}–${timeOnly(o.slotEnd)}` : o.address ? o.address.region : "";

export function Orders() {
  const navigate = useNavigate();
  const [orders, setOrders] = useState<Order[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState("todo");

  useEffect(() => {
    get<Order[]>("/api/merchant/orders").then(setOrders, (e) => setError(message(e)));
  }, []);

  const f = FILTERS.find((x) => x.key === filter)!;
  const shown = orders?.filter(f.match) ?? [];

  return (
    <Page title="订单">
      {error && <Banner tone="critical">{error}</Banner>}
      <Card flush>
        <div className="card-header">
          <div className="tabs" role="tablist">
            {FILTERS.map((x) => (
              <button key={x.key} role="tab" aria-selected={x.key === filter} className={x.key === filter ? "tab active" : "tab"} onClick={() => setFilter(x.key)}>
                {x.label}
                {orders && <span className="count">{orders.filter(x.match).length}</span>}
              </button>
            ))}
          </div>
        </div>
        {orders === null ? (
          <Empty>加载中…</Empty>
        ) : shown.length === 0 ? (
          <Empty>{filter === "todo" ? "没有待处理的订单" : "这里还没有订单"}</Empty>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table className="table">
              <thead>
                <tr>
                  <th>顾客</th>
                  <th>内容</th>
                  <th>时间 / 地址</th>
                  <th>状态</th>
                  <th className="num">金额</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((o) => (
                  <tr key={o.id} className="link" onClick={() => navigate(`/orders/${o.id}`)}>
                    <td>
                      <div>{o.customer.name}</div>
                      <div className="subtle">{dateTime(o.createdAt)} 下单</div>
                    </td>
                    <td>{itemsText(o)}</td>
                    <td>{whenText(o)}</td>
                    <td>
                      <div className="row">
                        <StatusBadge status={o.status} />
                        <SourceBadge source={o.source} />
                      </div>
                    </td>
                    <td className="num">{yuan(o.totalFen)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </Page>
  );
}

export function OrderDetail() {
  const { id } = useParams();
  const toast = useToast();
  const [order, setOrder] = useState<Order | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [trackingNo, setTrackingNo] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const all = await get<Order[]>("/api/merchant/orders");
      const o = all.find((x) => x.id === id);
      if (!o) setError("找不到这个订单");
      setOrder(o ?? null);
    } catch (e) {
      setError(message(e));
    }
  }, [id]);
  useEffect(() => void load(), [load]);

  async function ship() {
    setBusy(true);
    try {
      setOrder(await post<Order>(`/api/merchant/orders/${id}/ship`, { trackingNo }));
      toast("已标记发货");
    } catch (e) {
      toast(message(e), { critical: true });
    } finally {
      setBusy(false);
    }
  }

  if (!order) return <Page title="订单" back="/orders">{error ? <Banner tone="critical">{error}</Banner> : <Empty>加载中…</Empty>}</Page>;

  return (
    <Page
      title={`${order.customer.name} 的订单`}
      back="/orders"
      badge={
        <div className="row">
          <StatusBadge status={order.status} />
          <SourceBadge source={order.source} />
        </div>
      }
    >
      <div className="layout">
        <div className="col">
          <Card title={order.fulfillment === "booking" ? "预约内容" : "商品"}>
            <div className="list">
              {order.items.map((i, n) => (
                <div key={n} className="row between" style={{ padding: "8px 0" }}>
                  <div>
                    <div>{i.productName}</div>
                    <div className="subtle">
                      {[...Object.values(i.attributes), ...Object.entries(i.options).map(([, v]) => v)].join(" · ") || "默认规格"}
                    </div>
                  </div>
                  <div className="num">
                    {yuan(i.unitFen)} × {i.quantity}
                  </div>
                </div>
              ))}
              <div className="row between" style={{ padding: "8px 0", fontWeight: 650 }}>
                <span>合计</span>
                <span>{yuan(order.totalFen)}</span>
              </div>
            </div>
          </Card>
          {order.fulfillment === "booking" && order.slotStart && (
            <Card title="预约时间">
              <p style={{ fontSize: 16 }}>{whenText(order)}</p>
            </Card>
          )}
          {order.fulfillment === "shipping" && (
            <Card title="发货">
              {order.status === "paid" ? (
                <div className="stack">
                  <Field label="快递单号">
                    <input className="input" value={trackingNo} onChange={(e) => setTrackingNo(e.target.value)} placeholder="例如 SF1234567890" />
                  </Field>
                  <div>
                    <button className="btn primary" disabled={!trackingNo.trim() || busy} onClick={ship}>
                      标记为已发货
                    </button>
                  </div>
                </div>
              ) : order.trackingNo ? (
                <p>快递单号：{order.trackingNo}</p>
              ) : (
                <p className="muted">{order.status === "pending_payment" ? "顾客付款后才能发货" : "不需要发货"}</p>
              )}
            </Card>
          )}
        </div>
        <div className="col">
          <Card title="顾客">
            <div className="stack" style={{ gap: 4 }}>
              <div>{order.customer.name}</div>
              <a href={`tel:${order.customer.phone}`}>{order.customer.phone}</a>
            </div>
            {order.address && (
              <div className="stack" style={{ gap: 4 }}>
                <h3>收货地址</h3>
                <div>
                  {order.address.recipient} {order.address.phone}
                </div>
                <div className="muted">
                  {order.address.region} {order.address.detail}
                </div>
              </div>
            )}
          </Card>
          <Card title="记录">
            <div className="stack" style={{ gap: 4 }}>
              <div className="subtle">下单：{dateTime(order.createdAt)}</div>
              {order.paidAt && <div className="subtle">付款：{dateTime(order.paidAt)}</div>}
              {order.refunded && <div className="subtle">已原路退款</div>}
              <div className="subtle">订单号：{order.id}</div>
            </div>
          </Card>
          <Link to="/orders" className="muted">
            ← 返回订单列表
          </Link>
        </div>
      </div>
    </Page>
  );
}
