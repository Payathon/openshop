/** @jsxImportSource hono/jsx */
import { presentOrder } from "@openshop/client/buyer";
import type { CancelDecision, Theme } from "@openshop/core";
import type { RenderedOrder } from "../shop.ts";
import type { ShopUrls } from "./discovery.ts";
import { Layout, price, TitleBar, variantLabel, type PublicShop } from "./layout.tsx";
import { CANCEL_SCRIPT, ORDER_SCRIPT } from "./scripts.ts";

const TONE: Record<RenderedOrder["status"], "ok" | "warn" | "bad"> = {
  pending_payment: "warn",
  confirmed: "ok",
  paid: "ok",
  shipped: "ok",
  completed: "ok",
  cancelled: "bad",
  expired: "bad",
};

function Cancel(p: { order: RenderedOrder; shop: PublicShop; urls: ShopUrls; decision: CancelDecision }) {
  const { order, decision } = p;
  if (!decision.allowed) {
    return (
      <p class="fine">
        {decision.reason}：<a href={`tel:${p.shop.phone}`}>{p.shop.phone}</a>
      </p>
    );
  }
  const what = order.fulfillment === "booking" ? "预约" : "订单";
  const label = decision.refund ? `取消${what}并退款 ${price(order.totalFen)}` : `取消${what}`;
  const confirm = decision.refund ? `确定取消吗？${price(order.totalFen)} 会原路退回。` : "确定取消这个订单吗？";
  return (
    <form method="post" action={`${p.urls.shop}/orders/${order.id}/cancel`} data-confirm={confirm}>
      <button type="submit" class="btn danger block">
        {label}
      </button>
    </form>
  );
}

export function OrderPage(p: {
  shop: PublicShop;
  order: RenderedOrder;
  urls: ShopUrls;
  theme: Theme;
  // What cancelling would do now; null once the order has ended.
  cancel: CancelDecision | null;
}) {
  const { shop, order, urls } = p;
  const shown = presentOrder(order);
  const pending = order.status === "pending_payment";
  return (
    <Layout title={`${shown.statusText} - ${shop.name}`} theme={p.theme}>
      <TitleBar shop={shop} home={urls.shop} back={urls.shop} />
      <section class="section order-head" id="order-status" data-status={order.status} data-url={`${urls.shop}/orders/${order.id}/status`}>
        <h1 class={`status ${TONE[order.status]}`}>{shown.statusText}</h1>
        {pending && order.paymentUrl ? (
          <>
            <p class="muted">请在 {shown.payBefore?.slice(11)} 前完成付款，超时订单会自动关闭。</p>
            <a class="btn block" href={order.paymentUrl}>
              去支付 {price(order.totalFen)}
            </a>
          </>
        ) : null}
        {order.status === "confirmed" ? (
          <p class="muted">
            请按时到店{shop.address ? `：${shop.address}` : ""}。需要改期请联系店铺 <a href={`tel:${shop.phone}`}>{shop.phone}</a>。
          </p>
        ) : null}
        {order.status === "paid" ? <p class="muted">店家会尽快发货。</p> : null}
        {order.status === "shipped" && order.trackingNo ? <p class="muted">快递单号：{order.trackingNo}</p> : null}
        {order.status === "cancelled" && order.refunded ? <p class="muted">款项已原路退回。</p> : null}
        {order.status === "expired" ? (
          <p class="muted">
            超时未付款，订单已关闭。<a href={urls.shop}>重新下单</a>
          </p>
        ) : null}
      </section>

      <section class="section">
        <h2>订单详情</h2>
        <dl class="rows">
          {order.items.map((i) => (
            <>
              <dt>{i.quantity > 1 ? `${i.productName} ×${i.quantity}` : i.productName}</dt>
              <dd>
                {[variantLabel(i.attributes), ...Object.values(i.options)].filter(Boolean).join("，") || "—"}
              </dd>
            </>
          ))}
          {shown.slot ? (
            <>
              <dt>时间</dt>
              <dd>{shown.slot}</dd>
            </>
          ) : null}
          {order.address ? (
            <>
              <dt>收货地址</dt>
              <dd>
                {order.address.recipient} {order.address.phone}
                <br />
                {order.address.region} {order.address.detail}
              </dd>
            </>
          ) : (
            <>
              <dt>预约人</dt>
              <dd>
                {order.customer.name} {order.customer.phone}
              </dd>
            </>
          )}
          <dt>金额</dt>
          <dd class="price">{price(order.totalFen)}</dd>
          <dt>订单号</dt>
          <dd class="small">{order.id}</dd>
        </dl>
      </section>
      {p.cancel ? (
        <div class="section">
          <Cancel order={order} shop={shop} urls={urls} decision={p.cancel} />
        </div>
      ) : null}
      {pending ? <script dangerouslySetInnerHTML={{ __html: ORDER_SCRIPT }} /> : null}
      {p.cancel?.allowed ? <script dangerouslySetInnerHTML={{ __html: CANCEL_SCRIPT }} /> : null}
    </Layout>
  );
}
