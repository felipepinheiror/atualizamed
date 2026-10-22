// Service worker mínimo: permite instalar o AtualizaMed como aplicativo.
// Não guarda nada em cache e só cuida dos pedidos ao próprio app (fontes e APIs externas seguem direto).
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));
self.addEventListener("fetch", (e) => {
  if (new URL(e.request.url).origin !== self.location.origin) return;
  e.respondWith(fetch(e.request));
});
