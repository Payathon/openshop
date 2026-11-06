import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router";
import { get, message, post } from "./api.ts";
import { Card, useToast } from "./ui.tsx";

// New-order notifications on this device. The service worker (public/sw.js) shows what the
// server sends (apps/server/src/push.ts) to the subscription registered here. Each device and
// browser is turned on separately.

// needs-install: an iPhone or iPad in Safari; iOS only offers push to a web app opened from
// the home screen (iOS 16.4+).
export type PushState = "loading" | "unsupported" | "needs-install" | "denied" | "off" | "on";

const SW_URL = "/admin/sw.js";
const SCOPE = "/admin/";

const isIos = () => /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
const installed = () => matchMedia("(display-mode: standalone)").matches || (navigator as { standalone?: boolean }).standalone === true;
const supported = () => "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;

// Registered on every visit so the worker is ready before the merchant turns push on.
export function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) return;
  navigator.serviceWorker.register(SW_URL, { scope: SCOPE }).catch((err: unknown) => console.warn("service worker:", err));
}

const subscription = async () => (await navigator.serviceWorker.getRegistration(SCOPE))?.pushManager.getSubscription() ?? null;

async function readState(): Promise<PushState> {
  if (isIos() && !installed()) return "needs-install";
  if (!supported()) return "unsupported";
  if (Notification.permission === "denied") return "denied";
  return Notification.permission === "granted" && (await subscription()) ? "on" : "off";
}

function base64UrlBytes(s: string) {
  const b = atob(s.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(s.length / 4) * 4, "="));
  return Uint8Array.from(b, (c) => c.charCodeAt(0));
}

const sameKey = (a: ArrayBuffer | null, b: Uint8Array) => !!a && a.byteLength === b.length && new Uint8Array(a).every((x, i) => x === b[i]);

// Subscribes with the server's current key and registers the result. A subscription made with
// an older key (the server's keys changed) can't receive anything, so it is replaced.
async function subscribe() {
  const { publicKey } = await get<{ publicKey: string }>("/api/merchant/push");
  const key = base64UrlBytes(publicKey);
  await navigator.serviceWorker.register(SW_URL, { scope: SCOPE });
  const reg = await navigator.serviceWorker.ready;
  let sub = await reg.pushManager.getSubscription();
  if (sub && !sameKey(sub.options.applicationServerKey, key)) {
    await sub.unsubscribe();
    sub = null;
  }
  sub ??= await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
  await post("/api/merchant/push/subscriptions", sub.toJSON());
}

// On each workbench visit: re-register a subscription this device already has, in case the
// server deleted it or its keys changed. Never asks for permission.
export async function refreshPush() {
  if (!supported() || Notification.permission !== "granted" || !(await subscription())) return;
  await subscribe().catch((err: unknown) => console.warn("push refresh:", err));
}

// Before logging out: this device stops getting the shop's orders.
export async function turnOffPush() {
  if (!supported()) return;
  const sub = await subscription().catch(() => null);
  if (!sub) return;
  await post("/api/merchant/push/unsubscribe", { endpoint: sub.endpoint }).catch(() => {});
  await sub.unsubscribe().catch(() => {});
}

export function usePush() {
  const [state, setState] = useState<PushState>("loading");
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  const reload = useCallback(() => readState().then(setState, () => setState("unsupported")), []);
  useEffect(() => void reload(), [reload]);

  const run = (fn: () => Promise<void>) => async () => {
    setBusy(true);
    try {
      await fn();
    } catch (e) {
      toast(message(e), { critical: true });
    }
    await reload();
    setBusy(false);
  };

  const enable = run(async () => {
    // Must come straight from the click: browsers only ask in response to one.
    if ((await Notification.requestPermission()) !== "granted") return;
    await subscribe();
    toast("已开启新订单提醒");
  });
  const disable = run(async () => {
    await turnOffPush();
    toast("已关闭这台设备的提醒");
  });
  const test = run(async () => {
    const { sent } = await post<{ sent: number }>("/api/merchant/push/test");
    toast(sent > 0 ? "已发送，几秒内会弹出提醒" : "没有发出去，请关闭后重新开启", { critical: sent === 0 });
  });
  return { state, busy, enable, disable, test };
}

// For the Settings page.
export function PushCard() {
  const { state, busy, enable, disable, test } = usePush();
  return (
    <Card title="新订单提醒">
      {state === "loading" ? null : state === "on" ? (
        <>
          <p className="subtle">这台设备已开启。顾客付款后会弹出提醒，不用一直开着后台。其他手机或电脑要分别开启。</p>
          <div className="row">
            <button className="btn" disabled={busy} onClick={() => void test()}>
              发一条测试提醒
            </button>
            <button className="btn plain" disabled={busy} onClick={() => void disable()}>
              关闭
            </button>
          </div>
        </>
      ) : state === "off" ? (
        <>
          <p className="subtle">顾客付款后，在这台设备上弹出提醒，不用一直开着后台。</p>
          <div>
            <button className="btn primary" disabled={busy} onClick={() => void enable()}>
              开启提醒
            </button>
          </div>
        </>
      ) : state === "needs-install" ? (
        <p className="subtle">
          iPhone 和 iPad 要先把后台添加到主屏幕：在 Safari 里点底部的“分享”，选“添加到主屏幕”，然后从主屏幕打开 OpenShop，再回到这里开启。需要 iOS 16.4 或更新的版本。
        </p>
      ) : state === "denied" ? (
        <p className="subtle">浏览器已禁止 OpenShop 发通知。到浏览器的网站设置里把通知改成“允许”，再回来开启。</p>
      ) : (
        <p className="subtle">这个浏览器不支持提醒。电脑上可以用 Chrome、Edge、Firefox 或 Safari，安卓手机用 Chrome。</p>
      )}
    </Card>
  );
}

const DISMISSED = "openshop.push-prompt-dismissed";

// A quiet suggestion above the order list, until the merchant turns push on or says no.
export function PushPrompt() {
  const { state, busy, enable } = usePush();
  const [dismissed, setDismissed] = useState(() => {
    try {
      return localStorage.getItem(DISMISSED) === "1";
    } catch {
      return false;
    }
  });
  if (dismissed || (state !== "off" && state !== "needs-install")) return null;
  const dismiss = () => {
    try {
      localStorage.setItem(DISMISSED, "1");
    } catch {
      // Private mode: it just shows again next time.
    }
    setDismissed(true);
  };
  return (
    <div className="banner push-prompt" role="status">
      <div className="body">
        <p>{state === "off" ? "开启新订单提醒，不开着后台也能第一时间知道有人下单。" : "在 iPhone 上收新订单提醒，要先把后台添加到主屏幕。"}</p>
      </div>
      {state === "off" ? (
        <button className="btn primary" disabled={busy} onClick={() => void enable()}>
          开启
        </button>
      ) : (
        <Link className="btn" to="/settings">
          怎么开
        </Link>
      )}
      <button className="btn plain" onClick={dismiss}>
        不用了
      </button>
    </div>
  );
}
