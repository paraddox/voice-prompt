const CACHE = "voice-prompter-v2";
const CORE = [
  "/",
  "/app",
  "/styles.css",
  "/js/app.js",
  "/js/shared.js",
  "/js/prompter.js",
  "/js/remote.js",
  "/prompter.html",
  "/remote.html",
  "/vendor/qrcode.js",
  "/manifest.webmanifest",
  "/icon-192.png",
  "/icon-512.png"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((c) => c.addAll(CORE))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(keys.map((k) => (k === CACHE ? null : caches.delete(k))));
      await self.clients.claim();
    })()
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE);
      try {
        const res = await fetch(req);
        if (res && res.ok) cache.put(req, res.clone());
        return res;
      } catch {
        const cached = await cache.match(req);
        if (cached) return cached;
        // Offline fallback: if it's a navigation, serve the app shell.
        if (req.mode === "navigate") return cache.match("/app");
        throw new Error("Offline and not cached");
      }
    })()
  );
});
