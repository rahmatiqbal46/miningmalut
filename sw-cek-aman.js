/* =============================================================================
   Service worker khusus halaman Cek Aman (cek-aman.html).
   Tugasnya satu: supaya halaman tetap bisa DIBUKA saat HP tanpa sinyal.
   Form dan fotonya sendiri disimpan halaman di IndexedDB, bukan di sini.

   Cakupan dibatasi ke /cek-aman* (didaftarkan dengan scope './cek-aman'),
   jadi modul MiningMalut lain tidak tersentuh.
   Jaringan dulu, cadangan dari cache: versi baru selalu terambil saat ada sinyal.
   ============================================================================= */
var CACHE = 'gng-cek-aman-v1';
var KUNCI = self.location.origin + '/cek-aman';

self.addEventListener('install', function (e) {
  self.skipWaiting();
  e.waitUntil(caches.open(CACHE).then(function (c) {
    return fetch(KUNCI, { cache: 'reload' }).then(function (r) { return simpan(c, r); }).catch(function () {});
  }));
});

self.addEventListener('activate', function (e) {
  e.waitUntil(caches.keys().then(function (ks) {
    return Promise.all(ks.filter(function (k) { return k.indexOf('gng-cek-aman-') === 0 && k !== CACHE; })
      .map(function (k) { return caches.delete(k); }));
  }).then(function () { return self.clients.claim(); }));
});

// Cloudflare Pages mengalihkan /cek-aman.html → /cek-aman. Jawaban hasil pengalihan
// tidak boleh dipakai untuk navigasi, jadi isinya disalin ke Response baru.
function simpan(c, r) {
  if (!r || !r.ok) return r;
  var h = r.headers.get('content-type') || '';
  if (h.indexOf('text/html') < 0) return r;
  return r.clone().blob().then(function (b) {
    var bersih = new Response(b, { status: 200, headers: { 'Content-Type': h } });
    return c.put(KUNCI, bersih).then(function () { return r; });
  });
}

self.addEventListener('fetch', function (e) {
  var req = e.request;
  if (req.method !== 'GET') return;
  var u = new URL(req.url);
  if (u.origin !== self.location.origin || !/^\/cek-aman(\.html)?$/.test(u.pathname)) return;
  e.respondWith(
    fetch(req).then(function (r) {
      if (!r.ok) return r;
      return caches.open(CACHE).then(function (c) { return simpan(c, r.clone()); }).then(function () {
        if (!r.redirected) return r;
        return r.blob().then(function (b) { return new Response(b, { status: 200, headers: { 'Content-Type': r.headers.get('content-type') || 'text/html' } }); });
      });
    }).catch(function () {
      return caches.open(CACHE).then(function (c) { return c.match(KUNCI); }).then(function (m) {
        return m || new Response('<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><body style="font-family:system-ui;padding:32px">Belum ada sinyal dan halaman belum pernah dibuka di HP ini. Buka sekali saat ada sinyal.</body>', { status: 503, headers: { 'Content-Type': 'text/html; charset=utf-8' } });
      });
    })
  );
});
