const CACHE_NAME = "minha-agenda-v1";
const APP_SHELL = ["/", "/manifest.json", "/icon.png"];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL)));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))),
    ),
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET" || new URL(event.request.url).origin !== self.location.origin) return;
  event.respondWith(
    fetch(event.request).then((response) => {
      if (response.ok) {
        const copy = response.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
      }
      return response;
    }).catch(async () => (await caches.match(event.request)) || Response.error()),
  );
});

self.addEventListener("push", (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch { data = { body: event.data?.text() || "" }; }
  const options = {
    body: data.body || "Você tem um compromisso em breve.",
    icon: "/icon.png",
    badge: "/icon.png",
    tag: data.tag || "minha-agenda",
    renotify: false,
    data: { url: data.url || "/", snoozeUrl: data.snoozeUrl || "/" },
    actions: [{ action: "snooze", title: "Adiar 5 min" }, { action: "open", title: "Abrir agenda" }],
  };
  event.waitUntil(self.registration.showNotification(data.title || "CODIFEX AGENDAS", options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = event.action === "snooze" ? event.notification.data?.snoozeUrl : event.notification.data?.url;
  event.waitUntil((async () => {
    const target = new URL(url || "/", self.location.origin).href;
    const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    for (const client of windows) {
      if ("focus" in client) {
        await client.focus();
        if ("navigate" in client) await client.navigate(target);
        return;
      }
    }
    await self.clients.openWindow(target);
  })());
});
