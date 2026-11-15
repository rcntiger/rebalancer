// 리밸런서 서비스 워커 — 앱 설치용 최소 구성
// 캐시하지 않음: 항상 최신 index.html 과 실시간 시세를 받도록 네트워크로 그대로 보냄
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));
self.addEventListener('fetch', () => {});
