/* Keeps a copy of the app on the phone so it opens and works without internet. */
var CACHE = 'shop-pos-v3';
var FILES = ['./', 'index.html', 'style.css', 'manifest.webmanifest', 'js/core.js', 'js/scanner.js', 'js/app.js',
  'vendor/qrcode.js', 'vendor/jsQR.js', 'vendor/firebase-app-compat.js', 'vendor/firebase-auth-compat.js',
  'vendor/firebase-firestore-compat.js', 'firebase-config.js', 'icons/logo.jpg', 'icons/icon-192.png', 'icons/icon-512.png'];

self.addEventListener('install', function (e) {
  e.waitUntil(caches.open(CACHE).then(function (c) { return c.addAll(FILES); }).then(function () { return self.skipWaiting(); }));
});
self.addEventListener('activate', function (e) {
  e.waitUntil(caches.keys().then(function (keys) {
    return Promise.all(keys.filter(function (k) { return k !== CACHE; }).map(function (k) { return caches.delete(k); }));
  }).then(function () { return self.clients.claim(); }));
});
// Answer from the saved copy straight away, and refresh that copy in the background when online.
self.addEventListener('fetch', function (e) {
  // Only this app's own files and its fonts. Everything else (the online records) goes straight to the network.
  var url = new URL(e.request.url);
  if (e.request.method !== 'GET' || (url.origin !== location.origin && !/fonts\.(googleapis|gstatic)\.com$/.test(url.hostname))) return;
  e.respondWith(caches.open(CACHE).then(function (cache) {
    return cache.match(e.request).then(function (hit) {
      var fresh = fetch(e.request).then(function (res) {
        if (res && (res.ok || res.type === 'opaque')) cache.put(e.request, res.clone());
        return res;
      }).catch(function () { return hit; });
      return hit || fresh;
    });
  }));
});
