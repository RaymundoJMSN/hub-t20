// sw.js — service worker do Hub T20: rede primeiro, cache como reserva (páginas e arquivos já vistos abrem offline).
// /api/ nunca é cacheado (dados vivos e sessão). Subir CACHE quando mudar algo grande no shell.
const CACHE = "hub-t20-v1";
self.addEventListener("install", (e) => { self.skipWaiting(); });
self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener("fetch", (e) => {
  const req = e.request;
  const url = new URL(req.url);
  if (req.method !== "GET" || url.origin !== location.origin || url.pathname.startsWith("/api/") || url.pathname === "/login") return;
  e.respondWith(
    fetch(req).then((res) => {
      if (res.ok && res.type === "basic") caches.open(CACHE).then((c) => c.put(req, res.clone()));
      return res;
    }).catch(() => caches.match(req).then((hit) => hit || (req.mode === "navigate" ? caches.match("/") : undefined)))
  );
});
