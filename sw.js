/* Offline cache: app shell cache-first with background refresh; Firebase SDK cached at runtime. Firestore keeps its own offline copy. */
// The TEST / PREVIEW copy shares this origin with the live board, so it uses its own cache names and
// each copy only ever deletes its own old caches.
var PREVIEW = /preview/i.test(self.registration ? self.registration.scope : self.location.href);
var PREFIX = PREVIEW ? 'ppa-mb-preview-' : 'ppa-mb-';
var CACHE = PREFIX + 'v14';
var SHELL = ['./', 'index.html', 'css/app.css?v=14', 'js/config.js?v=14', 'js/status.js?v=14', 'js/meter-ocr.js?v=14', 'js/sample.js?v=14', 'js/store.js?v=14', 'js/app.js?v=14', 'js/views.js?v=14', 'js/fsp-import.js?v=14', 'js/settings.js?v=14', 'img/ppa-logo.png', 'img/icon-192.png', 'img/icon-512.png', 'manifest.webmanifest', 'template.csv'];
self.addEventListener('install', function (e) { e.waitUntil(caches.open(CACHE).then(function (c) { return c.addAll(SHELL); }).then(function () { return self.skipWaiting(); })); });
self.addEventListener('activate', function (e) { e.waitUntil(caches.keys().then(function (ks) { return Promise.all(ks.filter(function (k) { return k !== CACHE && k.indexOf(PREFIX) === 0 && (PREVIEW || k.indexOf('ppa-mb-preview-') !== 0); }).map(function (k) { return caches.delete(k); })); }).then(function () { return self.clients.claim(); })); });
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
