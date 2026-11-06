import { and, eq, inArray, isNull } from "drizzle-orm";
import webpush from "web-push";
import type { Db } from "./db/client.ts";
import { orderItems, orders, pushSubscriptions } from "./db/schema.ts";
import { newId, ShopError, type OrderNotifier } from "./shop.ts";

// Browser push for new orders (产品决策 #10), so a merchant without the workbench open still
// hears about an order. The workbench's service worker (apps/web/public/sw.js) shows what is
// sent here.
//
// When: an order becomes paid or confirmed, which is when the merchant has something to do.
// OpenShop calls orderPaid after the payment transaction commits and doesn't wait for it.
// At most once per order: orders.notified_at is claimed with one conditional update, so a
// payment confirmed twice, or by two instances, notifies once. The claim comes before sending,
// so a send that fails is logged and not retried; the order is in the workbench either way.

export interface PushTarget {
  endpoint: string;
  keys: { p256dh: string; auth: string };
}

// "gone": the push service says the subscription no longer exists (404/410); we delete it.
// Any other failure throws.
export interface PushSender {
  send(target: PushTarget, payload: string): Promise<"sent" | "gone">;
}

export interface Vapid {
  publicKey: string;
  privateKey: string;
  // A mailto: or https: address push services can contact about our traffic.
  subject: string;
}

// VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY (npx web-push generate-vapid-keys) and VAPID_SUBJECT.
// Unset, a key pair is made for this run: push works, but every subscription stops working
// on restart and the workbench quietly subscribes again the next time it is opened.
export function vapidFromEnv(env: NodeJS.ProcessEnv = process.env): Vapid {
  const subject = env.VAPID_SUBJECT || "mailto:push@openshop.dev";
  if (env.VAPID_PUBLIC_KEY && env.VAPID_PRIVATE_KEY) return { publicKey: env.VAPID_PUBLIC_KEY, privateKey: env.VAPID_PRIVATE_KEY, subject };
  console.warn("VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY are not set; new-order push stops reaching browsers when the server restarts");
  return { ...webpush.generateVAPIDKeys(), subject };
}

export class WebPushSender implements PushSender {
  constructor(private readonly vapid: Vapid) {}

  async send(target: PushTarget, payload: string) {
    try {
      await webpush.sendNotification(target, payload, {
        vapidDetails: this.vapid,
        // Still worth showing after a phone has been off for a while, not after days.
        TTL: 24 * 3600,
        urgency: "high",
        timeout: 10_000,
      });
      return "sent" as const;
    } catch (err) {
      if (err instanceof webpush.WebPushError && (err.statusCode === 404 || err.statusCode === 410)) return "gone" as const;
      throw err;
    }
  }
}

// The server POSTs to whatever endpoint a merchant registers, so only the browsers' push
// services are accepted: Chrome/Edge/Android (FCM), Firefox, Safari and old Edge (WNS).
const PUSH_HOSTS = [/^fcm\.googleapis\.com$/, /^android\.googleapis\.com$/, /\.push\.services\.mozilla\.com$/, /\.push\.apple\.com$/, /\.notify\.windows\.com$/];

export function isPushEndpoint(endpoint: string) {
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    return false;
  }
  return url.protocol === "https:" && !url.port && PUSH_HOSTS.some((h) => h.test(url.hostname));
}

// What the service worker shows. url opens the order in the workbench.
export interface PushMessage {
  title: string;
  body: string;
  url: string;
  // Notifications with the same tag replace each other instead of piling up.
  tag: string;
}

const yuan = (fen: number) => `¥${(fen / 100).toFixed(2).replace(/\.00$/, "")}`;

// Beijing time has no DST: "10月17日 周六 14:00".
function beijingWhen(d: Date) {
  const b = new Date(d.getTime() + 8 * 3_600_000);
  const hm = b.toISOString().slice(11, 16);
  return `${b.getUTCMonth() + 1}月${b.getUTCDate()}日 周${"日一二三四五六"[b.getUTCDay()]} ${hm}`;
}

type OrderRow = typeof orders.$inferSelect;
type ItemRow = typeof orderItems.$inferSelect;

// 新预约：法式美甲 · 10月17日 周六 14:00 / 新订单：¥168 · 2 件, with who and what below.
export function orderMessage(o: OrderRow, items: ItemRow[]): PushMessage {
  const ai = o.source === "agent" ? "来自 AI · " : "";
  const what = (i: ItemRow) => {
    const attrs = Object.values(i.attributes);
    return `${i.productName}${attrs.length ? `（${attrs.join("/")}）` : ""}${i.quantity > 1 ? ` ×${i.quantity}` : ""}`;
  };
  const base = { url: `/admin/orders/${o.id}`, tag: `order-${o.id}` };
  if (o.fulfillment === "booking" && o.slotStart) {
    const name = items[0]?.productName ?? "预约";
    return { ...base, title: `新预约：${name} · ${beijingWhen(o.slotStart)}`, body: `${ai}${o.customerName} · ${yuan(o.totalFen)}` };
  }
  const count = items.reduce((n, i) => n + i.quantity, 0);
  return { ...base, title: `新订单：${yuan(o.totalFen)} · ${count} 件`, body: `${ai}${o.customerName} · ${items.map(what).join("、")}` };
}

export class Push implements OrderNotifier {
  readonly db: Db;
  readonly publicKey: string;
  private readonly sender: PushSender;
  private readonly clock: () => Date;
  private readonly inflight = new Set<Promise<void>>();

  constructor(deps: { db: Db; sender: PushSender; publicKey: string; clock?: () => Date }) {
    this.db = deps.db;
    this.sender = deps.sender;
    this.publicKey = deps.publicKey;
    this.clock = deps.clock ?? (() => new Date());
  }

  // Upserts by endpoint: the same browser signing in to another shop moves there.
  async subscribe(shopId: string, accountId: string | null, target: PushTarget) {
    if (!isPushEndpoint(target.endpoint)) throw new ShopError(400, "invalid_endpoint", "这个浏览器的推送服务暂不支持");
    const row = { shopId, accountId, endpoint: target.endpoint, p256dh: target.keys.p256dh, auth: target.keys.auth };
    await this.db
      .insert(pushSubscriptions)
      .values({ id: newId("push"), ...row, createdAt: this.clock() })
      .onConflictDoUpdate({ target: pushSubscriptions.endpoint, set: row });
  }

  // Only the shop's own subscriptions; an unknown endpoint is fine (already gone).
  async unsubscribe(shopId: string, endpoint: string) {
    await this.db.delete(pushSubscriptions).where(and(eq(pushSubscriptions.shopId, shopId), eq(pushSubscriptions.endpoint, endpoint)));
  }

  // OrderNotifier: never throws and never makes the caller wait.
  orderPaid(orderId: string) {
    const p = this.announce(orderId)
      .catch((err: unknown) => console.error(`push: order ${orderId}:`, err))
      .finally(() => this.inflight.delete(p));
    this.inflight.add(p);
  }

  // Resolves once the notifications started so far are sent or have failed. For shutdown and tests.
  async idle() {
    while (this.inflight.size > 0) await Promise.all(this.inflight);
  }

  // From the workbench's "发一条测试提醒". Returns how many browsers it reached.
  async test(shopId: string) {
    return this.deliver(shopId, { title: "新订单提醒已开启", body: "有顾客付款后，会像这样提醒你", url: "/admin/orders", tag: "test" });
  }

  private async announce(orderId: string) {
    const [claimed] = await this.db
      .update(orders)
      .set({ notifiedAt: this.clock() })
      .where(and(eq(orders.id, orderId), isNull(orders.notifiedAt), inArray(orders.status, ["confirmed", "paid"])))
      .returning();
    if (!claimed) return;
    const items = await this.db.select().from(orderItems).where(eq(orderItems.orderId, orderId));
    await this.deliver(claimed.shopId, orderMessage(claimed, items));
  }

  private async deliver(shopId: string, message: PushMessage) {
    const subs = await this.db.select().from(pushSubscriptions).where(eq(pushSubscriptions.shopId, shopId));
    const payload = JSON.stringify(message);
    const results = await Promise.all(
      subs.map((s) =>
        this.sender.send({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, payload).catch((err: unknown) => {
          // One browser failing doesn't stop the others.
          console.error(`push: ${new URL(s.endpoint).host}:`, err);
          return "failed" as const;
        }),
      ),
    );
    const gone = subs.filter((_, i) => results[i] === "gone").map((s) => s.endpoint);
    if (gone.length > 0) await this.db.delete(pushSubscriptions).where(inArray(pushSubscriptions.endpoint, gone));
    return results.filter((r) => r === "sent").length;
  }
}
