// Cachea el armazon para que la app abra al instante y sin cobertura.
// El analisis del ticket si necesita red: sin ella se avisa y se reintenta luego.
const CACHE = "cesta-v5";
const ARMAZON = ["./index.html", "./estilo.css", "./app.js", "./config.js",
  "./contrato.js", "./imagen.js", "./parser.js", "./almacen.js", "./informe.js",
  "./camara.js",
  "./icono.svg", "./manifest.webmanifest"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ARMAZON)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys()
    .then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (url.hostname === "api.anthropic.com") return;          // nunca se cachea
  if (url.origin !== location.origin) {                       // SDK del CDN: red, y si falla, cache
    e.respondWith(fetch(e.request).then((r) => {
      const copia = r.clone();
      caches.open(CACHE).then((c) => c.put(e.request, copia));
      return r;
    }).catch(() => caches.match(e.request)));
    return;
  }
  e.respondWith(caches.match(e.request).then((r) => r || fetch(e.request)));
});
