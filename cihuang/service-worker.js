/* 词谎 Lexicon Liar — offline shell cache.
 * 只缓存静态外壳与词包；/api/ 永不缓存，排行榜与校验始终走网络。
 */

const VERSION = "cihuang-v1-20261025f";
const SHELL = [
  "./",
  "./index.html",
  "./assets/style.css?v=20261025f",
  "./assets/game.js?v=20261025f",
  "./assets/art/tavern.webp",
  "./assets/art/mask1.webp",
  "./assets/art/mask2.webp",
  "./assets/art/mask3.webp",
  "./assets/art/bartender.webp",
  "./assets/art/icon.webp",
  "./assets/fonts/fusion-pixel-12px.woff2",
  "./data/topics/hs.json",
  "./data/game/hs.json",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(VERSION).then((cache) => cache.addAll(SHELL)).then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== VERSION).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith("/api/")) return;

  // 页面导航：网络优先，断网时回退到缓存外壳
  if (req.mode === "navigate") {
    event.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(VERSION).then((cache) => cache.put("./index.html", copy)).catch(() => {});
          return res;
        })
        .catch(() => caches.match("./index.html")),
    );
    return;
  }

  // 词包：网络优先，成功后写缓存；离线再用旧词包
  if (url.pathname.includes("/data/")) {
    event.respondWith(
      fetch(req)
        .then((res) => {
          if (res.ok) {
            const copy = res.clone();
            caches.open(VERSION).then((cache) => cache.put(req, copy)).catch(() => {});
          }
          return res;
        })
        .catch(() => caches.match(req)),
    );
    return;
  }

  // 静态资源：缓存优先，后台刷新
  event.respondWith(
    caches.match(req).then((cached) => {
      const network = fetch(req)
        .then((res) => {
          if (res.ok) {
            const copy = res.clone();
            caches.open(VERSION).then((cache) => cache.put(req, copy)).catch(() => {});
          }
          return res;
        })
        .catch(() => cached);
      return cached || network;
    }),
  );
});
