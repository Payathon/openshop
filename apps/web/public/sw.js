// The workbench's service worker, scope /admin/. It only shows new-order notifications sent
// by the server (apps/server/src/push.ts); it caches nothing, so the workbench always loads
// fresh from the server.

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

// The payload is { title, body, url, tag }. A push must always show something: browsers
// penalise or revoke push for a worker that receives one silently.
self.addEventListener("push", (event) => {
  let msg = {};
  try {
    msg = event.data ? event.data.json() : {};
  } catch {
    // Not JSON: fall through to the generic text.
  }
  event.waitUntil(
    self.registration.showNotification(msg.title || "OpenShop 有新消息", {
      body: msg.body || "",
      tag: msg.tag,
      data: { url: msg.url || "/admin/orders" },
      icon: "/admin/icons/icon-192.png",
      badge: "/admin/icons/icon-192.png",
      lang: "zh-CN",
    }),
  );
});

// Opens the order: in a workbench window that is already open if there is one.
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = new URL(event.notification.data?.url || "/admin/orders", self.location.origin).href;
  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      const open = windows.find((w) => new URL(w.url).pathname.startsWith("/admin"));
      if (open) {
        await open.focus();
        return open.navigate(url).catch(() => self.clients.openWindow(url));
      }
      return self.clients.openWindow(url);
    })(),
  );
});
