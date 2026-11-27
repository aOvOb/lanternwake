// Service worker: 버전 이름이 붙은 캐시를 cache-first로 쓴다.
// VERSION과 ASSETS는 tools/release.js가 고친다. 손으로 고치지 않는다.
const VERSION = '0.3.0';
const CACHE = 'lanternwake-' + VERSION;
const ASSETS = [ /* @assets-start */
  './',
  './index.html',
  './manifest.webmanifest',
  './js/account.js',
  './js/audio.js',
  './js/autotest.js',
  './js/config.js',
  './js/data/enemies.js',
  './js/data/evolutions.js',
  './js/data/passives.js',
  './js/data/waves.js',
  './js/data/weapons.js',
  './js/entities/areas.js',
  './js/entities/ebullets.js',
  './js/entities/effects.js',
  './js/entities/enemies.js',
  './js/entities/pickups.js',
  './js/entities/player.js',
  './js/entities/projectiles.js',
  './js/game.js',
  './js/grid.js',
  './js/input.js',
  './js/main.js',
  './js/net.js',
  './js/platform.js',
  './js/quality.js',
  './js/render.js',
  './js/storage.js',
  './js/systems/collision.js',
  './js/systems/levelup.js',
  './js/systems/spawner.js',
  './js/ui.js',
  './js/util.js',
  './js/weapons/behaviors.js',
  './icons/apple-touch-icon-180.png',
  './icons/favicon-32.png',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png'
  /* @assets-end */ ];

self.addEventListener('install', function (e) {
  e.waitUntil(caches.open(CACHE).then(function (c) {
    // cache:'reload'는 HTTP 캐시에 남은 옛 파일이 새 캐시에 섞이는 것을 막는다
    return c.addAll(ASSETS.map(function (u) { return new Request(u, { cache: 'reload' }); }));
  }));
  self.skipWaiting();
});

self.addEventListener('activate', function (e) {
  e.waitUntil(caches.keys().then(function (keys) {
    return Promise.all(keys.filter(function (k) { return k.indexOf('lanternwake-') === 0 && k !== CACHE; })
      .map(function (k) { return caches.delete(k); }));
  }).then(function () { return self.clients.claim(); }));
});

self.addEventListener('fetch', function (e) {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  // API 경로는 캐시하지 않고 index.html로 바꾸지도 않는다. navigate 요청(로그인 이동 등)도 네트워크 그대로 보낸다.
  // respondWith를 부르지 않으면 브라우저가 요청을 그대로 처리한다.
  if (/(^|\/)api(\/|$)/.test(url.pathname)) return;
  if (req.mode === 'navigate') {
    e.respondWith(caches.match('./index.html').then(function (r) { return r || fetch(req); }));
    return;
  }
  e.respondWith(caches.match(req, { ignoreSearch: true }).then(function (r) { return r || fetch(req); }));
});
