/* Service Worker：オフライン起動と、電波復帰時の自動送信 */
const CACHE = 'pump-log-v4';
const FILES = [
  './',
  './index.html',
  './app.js',
  './store.js',
  './manifest.json',
  './icon-192.png',
  './icon-512.png'
];

importScripts('./store.js');

self.addEventListener('install', (e) => {
  // cache: 'reload' でブラウザの古いキャッシュを使わず、必ず最新版を取りに行く
  e.waitUntil(caches.open(CACHE)
    .then(c => c.addAll(FILES.map(u => new Request(u, { cache: 'reload' }))))
    .then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// 自分のファイルはキャッシュ優先（圏外でも開ける）。GASへの通信は触らない。
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== self.location.origin) return;
  e.respondWith(
    caches.match(e.request, { ignoreSearch: true }).then(hit => {
      const net = fetch(e.request.url, { cache: 'no-cache' }).then(res => {
        if (res.ok) caches.open(CACHE).then(c => c.put(e.request, res.clone()));
        return res;
      }).catch(() => hit);
      return hit || net;
    })
  );
});

// Android Chrome：電波が戻るとアプリを閉じていても送信される
self.addEventListener('sync', (e) => {
  if (e.tag === 'send-records') {
    e.waitUntil(
      PumpStore.syncPending().then(notifyClients).catch(err => {
        notifyClients({ error: String(err.message || err) });
        throw err; // 失敗を返すとブラウザが後で再試行してくれる
      })
    );
  }
});

async function notifyClients(msg) {
  const list = await self.clients.matchAll({ includeUncontrolled: true });
  list.forEach(c => c.postMessage({ type: 'synced', detail: msg }));
}
