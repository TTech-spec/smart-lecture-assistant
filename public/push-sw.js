/* Attendly: show a notice when the server wakes this phone (loaded by the app's service worker). */
async function readConfig() {
  try {
    const cache = await caches.open("attendly-config");
    const res = await cache.match("/__attendly_config");
    return res ? await res.json() : null;
  } catch { return null; }
}

async function latestNotice() {
  const cfg = await readConfig();
  if (!cfg || !cfg.url || !cfg.key) return null;
  try {
    const res = await fetch(cfg.url.replace(/\/$/, "") + "/rest/v1/rpc/latest_notice", {
      method: "POST",
      headers: { apikey: cfg.key, Authorization: "Bearer " + cfg.key, "Content-Type": "application/json" },
      body: "{}",
    });
    return res.ok ? await res.json() : null;
  } catch { return null; }
}

self.addEventListener("push", (event) => {
  event.waitUntil((async () => {
    const n = await latestNotice();
    const title = (n && n.title) || "Attendly";
    await self.registration.showNotification(title, {
      body: (n && n.body) || "You have a new notice from your lecturer.",
      icon: "/icon-192.png",
      badge: "/icon-192.png",
      tag: n && n.id ? "notice-" + n.id : "notice",
      data: { url: (n && n.url) || "/" },
    });
  })());
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || "/";
  event.waitUntil((async () => {
    const all = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    for (const c of all) {
      if ("focus" in c) { await c.focus(); if ("navigate" in c) return c.navigate(url); return; }
    }
    return self.clients.openWindow(url);
  })());
});
