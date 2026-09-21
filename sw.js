// Service worker: shell = cache-first, ไฟล์ข้อมูล = network-first (ออฟไลน์ใช้ตัวล่าสุดที่เคยโหลด)
const VERSION = "v2";
const CACHE = "market-board-" + VERSION;
const SHELL = ["./", "index.html", "manifest.json", "watchlist.json",
  "style.css", "rules.js", "app.js",
  "icon-192.png", "icon-512.png", "apple-touch-icon.png"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

const isData = (u) => u.pathname.endsWith("/watchlist.json") || u.pathname.includes("/data/");

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);

  if (url.origin === location.origin && isData(url)) {
    e.respondWith(
      fetch(req, { cache: "no-cache" })
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy));
          return res;
        })
        .catch(() => caches.match(req))
    );
    return;
  }

  // ฟอนต์ Google: เก็บไว้ใช้ออฟไลน์
  if (url.host === "fonts.googleapis.com" || url.host === "fonts.gstatic.com") {
    e.respondWith(
      caches.match(req).then((hit) => hit || fetch(req).then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(req, copy));
        return res;
      }))
    );
    return;
  }

  // ตัวแอป: ใช้ของในเครื่องก่อน แล้วรีเฟรชเงียบๆ เพื่อให้รอบถัดไปได้เวอร์ชันใหม่
  e.respondWith(
    caches.match(req).then((hit) => {
      const net = fetch(req).then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(req, copy));
        return res;
      }).catch(() => hit);
      return hit || net;
    })
  );
});
