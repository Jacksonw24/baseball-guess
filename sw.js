// Service Worker — heavy pre-cache + stale-while-revalidate
// Bump SHELL_VERSION on each release to evict the old shell cache.
const SHELL_VERSION = "2026-06-14-006";
const DATA_VERSION  = "v7";          // bump to force a fresh bulk re-cache of /data/
const SHELL_CACHE = `bg-shell-${SHELL_VERSION}`;
const DATA_CACHE  = `bg-data-${DATA_VERSION}`;

const SHELL_ASSETS = [
  "./",
  "./index.html",
  "./game.js",
  "./styles.css",
  "./manifest.webmanifest",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/maskable-512.png",
  "./icons/apple-touch-icon.png",
];

const CONCURRENCY = 8;

self.addEventListener("install", (event) => {
  event.waitUntil(installAll());
});

async function installAll() {
  const shellCache = await caches.open(SHELL_CACHE);
  await Promise.all(SHELL_ASSETS.map(async (url) => {
    try { await shellCache.add(url); } catch (e) { /* shell asset missing — skip */ }
  }));

  // Heavy pre-cache: every player JSON in the manifest.
  const dataCache = await caches.open(DATA_CACHE);
  let manifest;
  try {
    const r = await fetch("./data/manifest.json", { cache: "no-store" });
    await dataCache.put("./data/manifest.json", r.clone());
    manifest = await r.json();
  } catch (e) {
    await broadcast({ type: "install-error", error: String(e) });
    return;
  }

  // Iterate over whatever tier keys are actually in the manifest so tier
  // renames in the future don't silently drop the pre-cache step.
  const ids = new Set();
  for (const tier of Object.keys(manifest)) {
    const list = manifest[tier];
    if (Array.isArray(list)) for (const p of list) ids.add(p.id);
  }
  const urls = [...ids].map((id) => `./data/players/${id}.json`);

  // Skip already-cached entries so re-installs are fast
  const toFetch = [];
  for (const url of urls) {
    if (!(await dataCache.match(url))) toFetch.push(url);
  }

  const total = urls.length;
  let done = total - toFetch.length;
  await broadcast({ type: "install-progress", done, total });

  async function pump() {
    while (toFetch.length) {
      const url = toFetch.shift();
      try {
        const r = await fetch(url);
        if (r.ok) await dataCache.put(url, r);
      } catch (e) { /* swallow per-file errors */ }
      done++;
      if (done % 100 === 0 || done === total) {
        await broadcast({ type: "install-progress", done, total });
      }
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, pump));

  await broadcast({ type: "install-complete", total });
  await self.skipWaiting();
}

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(
      names
        .filter((n) =>
          (n.startsWith("bg-shell-") && n !== SHELL_CACHE) ||
          (n.startsWith("bg-data-")  && n !== DATA_CACHE)
        )
        .map((n) => caches.delete(n))
    );
    await self.clients.claim();
    await broadcast({ type: "sw-activated", version: SHELL_VERSION });
  })());
});

async function broadcast(msg) {
  const clients = await self.clients.matchAll({ includeUncontrolled: true, type: "window" });
  for (const c of clients) c.postMessage(msg);
}

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith("/api/")) return;  // never cache API responses
  event.respondWith(handle(req, url));
});

async function handle(req, url) {
  // Data files: stale-while-revalidate
  if (url.pathname.includes("/data/")) {
    const cache = await caches.open(DATA_CACHE);
    const cached = await cache.match(req);
    const networkP = fetch(req).then((r) => {
      if (r.ok) cache.put(req, r.clone());
      return r;
    }).catch(() => null);
    if (cached) {
      // Fire-and-forget background update
      networkP.then(() => {});
      return cached;
    }
    const live = await networkP;
    return live || new Response("Offline", { status: 503, statusText: "Offline" });
  }

  // Shell: cache-first
  const cache = await caches.open(SHELL_CACHE);
  const cached = await cache.match(req);
  if (cached) return cached;
  try {
    const r = await fetch(req);
    if (r.ok && r.type === "basic") cache.put(req, r.clone());
    return r;
  } catch (e) {
    // Offline + uncached navigation: serve cached index as the SPA fallback
    if (req.mode === "navigate") {
      const fallback = await cache.match("./index.html");
      if (fallback) return fallback;
    }
    return new Response("Offline", { status: 503, statusText: "Offline" });
  }
}

self.addEventListener("message", (e) => {
  const t = e.data?.type;
  if (t === "skip-waiting") self.skipWaiting();
  if (t === "ping") e.source?.postMessage({ type: "pong", version: SHELL_VERSION });
});
