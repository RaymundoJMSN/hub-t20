// sw.js — service worker do Hub T20.
//  • páginas HTML: rede primeiro, cache como reserva (offline abre o que já foi visto)
//  • css/js/fontes/ícones e dados fixos (/api/c/*, grimório, poderes, textos): CACHE PRIMEIRO e atualiza por trás
//    (stale-while-revalidate) → a segunda visita a qualquer aba é instantânea; mudança de deploy chega na visita seguinte
//  • o resto da /api/ (sessão, votos, agenda, magias da mesa): só rede
// Subir CACHE quando quiser derrubar tudo que está guardado.
const CACHE = "hub-t20-v2";
const FIXO = /\.(css|js|mjs|png|svg|ico|ttf|otf|woff2|webmanifest)$/;
const API_FIXA = /^\/api\/(c\/|grimorio|poderes|poder\/|texto\/)/;

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener("fetch", (e) => {
  const req = e.request;
  const url = new URL(req.url);
  if (req.method !== "GET" || url.origin !== location.origin || url.pathname === "/login" || url.pathname === "/sw.js") return;
  if (url.pathname.startsWith("/api/") && !API_FIXA.test(url.pathname)) return;
  const guardar = (res) => { if (res && res.ok && res.type === "basic") caches.open(CACHE).then((c) => c.put(req, res.clone())); return res; };
  if (FIXO.test(url.pathname) || API_FIXA.test(url.pathname)) {
    e.respondWith(caches.match(req).then((hit) => {
      const rede = fetch(req).then(guardar).catch(() => hit);
      return hit || rede;
    }));
    return;
  }
  e.respondWith(fetch(req).then(guardar).catch(() => caches.match(req).then((hit) => hit || (req.mode === "navigate" ? caches.match("/") : undefined))));
});
