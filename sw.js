/* Offline cache: app shell cache-first with background refresh; Firebase SDK cached at runtime. Firestore keeps its own offline copy. */
var CACHE = 'ppa-mb-v7';
var SHELL = ['./', 'index.html', 'css/app.css?v=7', 'js/config.js?v=7', 'js/status.js?v=7', 'js/sample.js?v=7', 'js/store.js?v=7', 'js/app.js?v=7', 'js/views.js?v=7', 'js/fsp-import.js?v=7', 'js/settings.js?v=7', 'img/ppa-logo.png', 'img/icon-192.png', 'img/icon-512.png', 'manifest.webmanifest', 'template.csv'];
self.addEventListener('install', function (e) { e.waitUntil(caches.open(CACHE).then(function (c) { return c.addAll(SHELL); }).then(function () { return self.skipWaiting(); })); });
self.addEventListener('activate', function (e) { e.waitUntil(caches.keys().then(function (ks) { return Promise.all(ks.filter(function (k) { return k !== CACHE; }).map(function (k) { return caches.delete(k); })); }).then(function () { return self.clients.claim(); })); });
self.addEventListener('fetch', function (e) {
  var u = new URL(e.request.url);
  if (e.request.method !== 'GET') return;
  if (/firestore\.googleapis|identitytoolkit|securetoken|googleapis\.com\/(identity|v1)/.test(u.href)) return; // live data: never cache
  var sameOrigin = u.origin === location.origin, sdk = u.hostname === 'www.gstatic.com';
  if (!sameOrigin && !sdk) return;
  e.respondWith(caches.open(CACHE).then(function (c) {
    return c.match(e.request, { ignoreSearch: false }).then(function (hit) {
      var net = fetch(e.request).then(function (r) { if (r && r.ok) c.put(e.request, r.clone()); return r; }).catch(function () { return hit || c.match('index.html'); });
      return hit || net;
    });
  }));
});
