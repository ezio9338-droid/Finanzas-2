/* Hucha · service worker: la app funciona sin conexión */
var PREFIJO = 'hucha-cati-';
var CACHE = PREFIJO + 'v4';
var ARCHIVOS = [
  './', 'index.html', 'css/app.css?v=4', 'js/core.js?v=4', 'js/vault.js?v=4', 'js/app.js?v=4',
  'manifest.webmanifest', 'icons/apple-touch-icon.png', 'icons/icon-192.png', 'icons/icon-512.png'
];
self.addEventListener('install', function (e) {
  e.waitUntil(caches.open(CACHE).then(function (c) { return c.addAll(ARCHIVOS); }).then(function () { return self.skipWaiting(); }));
});
self.addEventListener('activate', function (e) {
  // Solo borra cachés antiguas de ESTA app (otras apps del mismo dominio tienen las suyas).
  e.waitUntil(caches.keys().then(function (ks) {
    return Promise.all(ks.filter(function (k) { return k.indexOf(PREFIJO) === 0 && k !== CACHE; }).map(function (k) { return caches.delete(k); }));
  }).then(function () { return self.clients.claim(); }));
});
self.addEventListener('fetch', function (e) {
  var req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return;
  // Red primero (para recibir actualizaciones), caché si no hay conexión.
  e.respondWith(fetch(req).then(function (res) {
    var copia = res.clone();
    caches.open(CACHE).then(function (c) { c.put(req, copia); });
    return res;
  }).catch(function () {
    return caches.open(CACHE).then(function (c) {
      return c.match(req).then(function (r) { return r || c.match('index.html'); });
    });
  }));
});
