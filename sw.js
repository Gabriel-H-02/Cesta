// Service worker de Cesta.
//
// ESTRATEGIA: red primero, cache como red de seguridad.
//
// La primera version iba al reves, cache primero, y era un error: la app son 70 KB
// y se publica a menudo, asi que ahorrar cien milisegundos no compensa quedarse
// clavado en una version vieja. Con cache primero, el unico modo de ver algo nuevo
// era que el service worker se relevara, y mientras eso no pasaba la app se servia
// a si misma la version antigua para siempre.
//
// Ahora se pide a la red siempre que hay conexion, y se guarda copia al vuelo. Sin
// cobertura tira de la copia y sigue abriendo. El nombre del cache lo pone
// publicar.mjs con la version y la fecha.

const CACHE = "cesta-0.9.3-202609121142";
const ARMAZON = ["./index.html", "./estilo.css", "./app.js", "./config.js",
  "./contrato.js", "./imagen.js", "./parser.js", "./almacen.js", "./informe.js",
  "./camara.js", "./documento.js", "./version.js",
  "./icono.svg", "./manifest.webmanifest"];

self.addEventListener("install", (e) => {
  e.waitUntil(
    caches.open(CACHE)
      // Se pide a la red de verdad: sin esto, el cache HTTP del navegador
      // (GitHub Pages manda max-age=600) devolveria los archivos viejos y el
      // service worker nuevo naceria con el contenido antiguo dentro.
      .then((c) => Promise.all(ARMAZON.map((u) =>
        fetch(u, { cache: "no-store" }).then((r) => (r.ok ? c.put(u, r) : null)).catch(() => null))))
      .then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys()
    .then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener("message", (e) => {
  if (e.data?.tipo === "saltar") self.skipWaiting();
  if (e.data?.tipo === "version") e.source?.postMessage({ tipo: "version", cache: CACHE });
});

self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET") return;
  if (url.hostname === "api.anthropic.com" || url.hostname === "generativelanguage.googleapis.com") return;

  if (url.origin !== location.origin) {
    // CDN externo: cache primero, que no cambia y ahorra descarga.
    e.respondWith(caches.match(e.request).then((r) => r || fetch(e.request).then((res) => {
      const copia = res.clone();
      caches.open(CACHE).then((c) => c.put(e.request, copia));
      return res;
    })));
    return;
  }

  e.respondWith(
    fetch(e.request, { cache: "no-store" })
      .then((res) => {
        if (res.ok) {
          const copia = res.clone();
          caches.open(CACHE).then((c) => c.put(e.request, copia));
        }
        return res;
      })
      .catch(() => caches.match(e.request).then((r) => r || caches.match("./index.html"))));
});
