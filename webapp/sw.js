// 서비스 워커 — 앱 셸 오프라인 캐시 (데이터는 항상 네트워크)
const CACHE = 'stockviewer-v3';
const SHELL = [
  './',
  './index.html',
  './app.css',
  './app.js',
  './naver.js',
  './lib/lightweight-charts.js',
  './manifest.webmanifest',
  './icons/icon-192.png',
  './icons/icon-512.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  // API(프록시) 요청은 항상 네트워크
  if (url.pathname.startsWith('/api/')) return;
  // 셸은 캐시 우선, 없으면 네트워크
  e.respondWith(
    caches.match(e.request).then((hit) => hit || fetch(e.request))
  );
});
