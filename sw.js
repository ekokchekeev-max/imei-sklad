/* Сервис-воркер: приложение открывается без интернета. */
const V = 'v2';
const SHELL = ['./', 'index.html', 'app.css', 'core.js', 'store.js', 'camera.js', 'app.js', 'manifest.webmanifest', 'icons/icon-192.png', 'icons/icon-512.png', 'icons/apple-touch-icon.png'];
const CDN = /^https:\/\/(cdn\.jsdelivr\.net|unpkg\.com|cdnjs\.cloudflare\.com|tessdata\.projectnaptha\.com)\//;

self.addEventListener('install', e => {
  e.waitUntil(caches.open(V).then(c => Promise.all(SHELL.map(u => c.add(u).catch(() => {})))).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== V).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET' || req.url.includes('/rest/v1/')) return;
  const url = new URL(req.url);
  if (url.origin === location.origin) {
    e.respondWith(fetch(req).then(r => {
      if (r.ok) { const cp = r.clone(); caches.open(V).then(c => c.put(req, cp)); }
      return r;
    }).catch(() => caches.match(req).then(m => m || (req.mode === 'navigate' ? caches.match('index.html') : Response.error()))));
  } else if (CDN.test(req.url)) {
    e.respondWith(caches.match(req).then(m => m || fetch(req).then(r => {
      if (r.ok || r.type === 'opaque') { const cp = r.clone(); caches.open(V).then(c => c.put(req, cp)); }
      return r;
    })));
  }
});
