// Tileman service worker: keeps the app itself on the phone so it opens
// offline. Saved tapes live in their own cache ("tileman-tapes"), which the
// page fills; this worker never deletes it.

const APP_CACHE = "tileman-app-v2";
const TAPE_CACHE = "tileman-tapes";
const APP_FILES = [
  "./",
  "./index.html",
  "./app.js",
  "./manifest.webmanifest",
  "./icon-192.png",
  "./icon-512.png",
  "./icon-maskable-512.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(APP_CACHE).then((c) => c.addAll(APP_FILES)).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((k) => k.startsWith("tileman-app-") && k !== APP_CACHE)
          .map((k) => caches.delete(k))
      )
    ).then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== "GET" || url.origin !== self.location.origin) return;

  // Saved tape files (artwork, tracks) are served from the tape cache.
  if (url.pathname.includes("/tapes/") || url.pathname.includes("/tape/")) {
    event.respondWith(
      caches.open(TAPE_CACHE)
        .then((c) => c.match(event.request))
        .then((r) => r || new Response("", { status: 404 }))
    );
    return;
  }

  // The app: try the network first so updates arrive, fall back to the copy
  // on the phone when offline.
  event.respondWith(
    fetch(event.request)
      .then((res) => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(APP_CACHE).then((c) => c.put(event.request, copy));
        }
        return res;
      })
      .catch(() =>
        caches.match(event.request, { ignoreSearch: true })
          .then((r) => r || caches.match("./index.html"))
      )
  );
});
