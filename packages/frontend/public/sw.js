// Service Worker TVMasjid - cache API paparan sahaja (data offline).
// HTML /display TIDAK dikendalikan SW: kawalan navigasi oleh SW sebelum ini
// menyebabkan pelbagai kegagalan (redirect ditelan, CSP menyekat fetch,
// cache lapuk). Halaman sentiasa dimuatkan terus dari rangkaian.
const CACHE = 'tvmasjid-v5';

self.addEventListener('install', (e) => self.skipWaiting());

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)));
    try {
      // Buang sebarang HTML /display yang tersimpan (versi lama tanpa key).
      const c = await caches.open(CACHE);
      const reqs = await c.keys();
      await Promise.all(reqs.filter((r) => {
        const u = new URL(r.url);
        return u.pathname === '/display';
      }).map((r) => c.delete(r)));
    } catch { /* pembersihan tidak boleh menggagalkan pengaktifan */ }
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== self.location.origin) return;
  if (['/api/settings', '/api/today', '/api/slides'].includes(url.pathname)) {
    e.respondWith(
      fetch(e.request)
        .then((res) => {
          if (res.ok) {
            const copy = res.clone();
            // Kunci cache = URL penuh (termasuk key/token) supaya setiap
            // tenant diasingkan - data tenant lain tidak terdedah/tersasar.
            caches.open(CACHE).then((c) => c.put(e.request.url, copy)).catch(() => {});
          }
          return res;
        })
        .catch(() => caches.match(e.request.url))
    );
  }
});
