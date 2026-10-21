/* FileForge service worker. Generated into out/sw.js by scripts/build-sw.mjs; do not edit the output.
 *
 * What it caches: only the app's own static files (pages, scripts, styles, fonts, the pdf.js worker, icons), listed at build time.
 * What it never caches: anything else. User files are read in the page and never pass through fetch, blob: and data: URLs are not
 * routed through a service worker, and a request that is not in the precache list goes straight to the network and is not stored.
 * Updates: a new version installs in the background and waits; the page asks the user before it takes over, and never mid-conversion.
 */
const VERSION = "__VERSION__";
const CACHE_PREFIX = "fileforge-app-";
const CACHE = CACHE_PREFIX + VERSION;
const PRECACHE = __PRECACHE__;
const PRECACHE_SET = new Set(PRECACHE);

async function broadcast(message) {
  const clients = await self.clients.matchAll({ includeUncontrolled: true });
  for (const c of clients) c.postMessage(message);
}

async function precache() {
  const cache = await caches.open(CACHE);
  let done = 0;
  // Fetch bypassing the HTTP cache so a half-updated CDN can't poison a version.
  await Promise.all(
    PRECACHE.map(async (url) => {
      if (await cache.match(url)) return void done++;
      const res = await fetch(new Request(url, { cache: "reload" }));
      if (!res.ok) throw new Error(`precache failed: ${url} ${res.status}`);
      await cache.put(url, res);
      done++;
      if (done % 10 === 0 || done === PRECACHE.length) broadcast({ type: "PRECACHE_PROGRESS", version: VERSION, done, total: PRECACHE.length });
    }),
  );
}

self.addEventListener("install", (event) => {
  event.waitUntil(precache());
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      for (const key of await caches.keys()) if (key.startsWith(CACHE_PREFIX) && key !== CACHE) await caches.delete(key);
      await self.clients.claim();
      broadcast({ type: "ACTIVATED", version: VERSION });
    })(),
  );
});

function cacheKey(url) {
  // Pages are exported with a trailing slash; the cache holds that form.
  if (url.pathname.endsWith("/") || /\.[a-z0-9]+$/i.test(url.pathname)) return url.pathname;
  return url.pathname + "/";
}

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname === "/sw.js") return;
  const key = cacheKey(url);
  const inCache = PRECACHE_SET.has(key) || PRECACHE_SET.has(url.pathname);
  if (!inCache && req.mode !== "navigate") return; // not ours: network only, never stored
  event.respondWith(
    (async () => {
      // caches.match with a cacheName never creates the cache, so "remove offline copy" really leaves nothing behind.
      const hit = (await caches.match(PRECACHE_SET.has(url.pathname) ? url.pathname : key, { cacheName: CACHE })) ?? (await caches.match(req, { cacheName: CACHE, ignoreSearch: true }));
      if (hit) {
        // Turbopack passes a worker its configuration in the script URL (query or #fragment, which a service worker can't see).
        // A response taken from the cache carries the stored URL without them, and a worker's location comes from the response
        // URL, so the configuration would be lost. A response constructed here has no URL of its own, which makes the browser
        // keep the request's full URL.
        return url.search || req.destination === "worker" || req.destination === "sharedworker" ? new Response(hit.body, { status: hit.status, statusText: hit.statusText, headers: hit.headers }) : hit;
      }
      if (req.mode === "navigate") {
        // Unknown page while offline: fall back to the app shell rather than the browser's error page.
        try {
          return await fetch(req);
        } catch {
          const shell = await caches.match("/", { cacheName: CACHE });
          if (shell) return shell;
          throw new Error("offline");
        }
      }
      return fetch(req);
    })(),
  );
});

self.addEventListener("message", (event) => {
  const data = event.data || {};
  if (data.type === "SKIP_WAITING") self.skipWaiting();
  else if (data.type === "STATUS") {
    event.waitUntil(
      (async () => {
        const keys = (await caches.has(CACHE)) ? await (await caches.open(CACHE)).keys() : [];
        const have = new Set(keys.map((k) => new URL(k.url).pathname));
        const missing = PRECACHE.filter((u) => !have.has(u));
        event.ports[0] && event.ports[0].postMessage({ version: VERSION, total: PRECACHE.length, cached: PRECACHE.length - missing.length, complete: missing.length === 0 });
      })(),
    );
  }
});
