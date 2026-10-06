// Tileman service worker: keeps the app itself on the phone so it opens
// offline. Saved tapes live in their own cache ("tileman-tapes"), which the
// page fills; this worker never deletes it.

const APP_CACHE = "tileman-app-v6";
const TAPE_CACHE = "tileman-tapes";
const APP_FILES = [
  "./",
  "./index.html",
  "./app.js",
  "./mp3join.js",
  "./manifest.webmanifest",
  "./icon-192.png",
  "./icon-512.png",
  "./icon-maskable-512.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    // "reload" skips the browser's own short-term copy, so an update always
    // stores the files that are on the website now.
    caches.open(APP_CACHE)
      .then((c) => c.addAll(APP_FILES.map((f) => new Request(f, { cache: "reload" }))))
      .then(() => self.skipWaiting())
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
    // "no-cache" asks the website whether the file changed, instead of reusing
    // the browser's short-term copy (GitHub Pages allows 10 minutes).
    fetch(event.request, { cache: "no-cache" })
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
