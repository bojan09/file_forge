/* FileForge service worker. Generated into public/sw.js by scripts/build-sw.mjs before `next build`; do not edit the output.
 *
 * Why it is written before the build: hosting adapters (Vercel's) only publish files that exist when `next build` finishes,
 * so a worker generated afterwards would never be deployed. The names of Next's hashed scripts and styles are not known
 * then, so the worker finds them itself at install time by reading the app's own pages and following the files they load.
 *
 * What it caches: only the app's own static files (pages, scripts, styles, fonts, the pdf.js worker, icons).
 * What it never caches: anything else. User files are read in the page and never pass through fetch, blob: and data: URLs are not
 * routed through a service worker, and a request outside the app's own static paths goes straight to the network and is not stored.
 * Updates: a new version installs in the background and waits; the page asks the user before it takes over, and never mid-conversion.
 */
const VERSION = "__VERSION__";
const CACHE_PREFIX = "fileforge-app-";
const CACHE = CACHE_PREFIX + VERSION;
const PAGES = __PAGES__;
const STATIC = __STATIC__;
const STATIC_SET = new Set([...PAGES, ...STATIC]);
const MANIFEST_KEY = "/__fileforge_manifest__";
// Paths of Next's hashed files as they appear in HTML, flight data and chunk loaders ("static/immutable/chunks/x.js" is relative to /_next/).
const NEXT_ASSET = /(?:\/_next\/)?static\/(?:[A-Za-z0-9_-]+\/)*[A-Za-z0-9_.%-]+\.(?:js|mjs|css|woff2?|png|jpe?g|svg|webp|ico)/g;
const SCANNED = /\.(?:js|mjs|css|html)$|\/$/;

async function broadcast(message) {
  const clients = await self.clients.matchAll({ includeUncontrolled: true });
  for (const c of clients) c.postMessage(message);
}

const normalize = (m) => (m.startsWith("/_next/") ? m : "/_next/" + m);

async function precache() {
  const cache = await caches.open(CACHE);
  // Fetch bypassing the HTTP cache so a half-updated CDN can't poison a version.
  const get = async (url) => {
    const res = await fetch(new Request(url, { cache: "reload" }));
    if (!res.ok) throw new Error(`precache failed: ${url} ${res.status}`);
    return res;
  };
  const queue = [...STATIC_SET];
  const queued = new Set(queue);
  let done = 0;
  const progress = () => broadcast({ type: "PRECACHE_PROGRESS", version: VERSION, done, total: queued.size });
  // A breadth-first walk with six fetches in flight: every cached script/style/page is scanned for further hashed files (lazy chunks, fonts).
  const handle = async (url) => {
    let res = await cache.match(url);
    if (!res) {
      try {
        res = await get(url);
      } catch (e) {
        // A file known at build time must be there; a path merely found inside a script (a string that only looks like a file) may not be.
        if (STATIC_SET.has(url)) throw e;
        queued.delete(url);
        return;
      }
      await cache.put(url, res.clone());
    }
    done++;
    if (SCANNED.test(url)) {
      const text = await res.text();
      for (const m of text.match(NEXT_ASSET) ?? []) {
        const next = normalize(m);
        if (!queued.has(next)) {
          queued.add(next);
          queue.push(next);
        }
      }
    }
    if (done % 10 === 0) progress();
  };
  await new Promise((resolve, reject) => {
    let inflight = 0;
    let failed = false;
    const pump = () => {
      if (failed) return;
      while (inflight < 6 && queue.length) {
        inflight++;
        handle(queue.shift()).then(
          () => {
            inflight--;
            pump();
          },
          (e) => {
            failed = true;
            reject(e);
          },
        );
      }
      if (!inflight && !queue.length) resolve();
    };
    pump();
  });
  await cache.put(MANIFEST_KEY, new Response(JSON.stringify({ version: VERSION, total: queued.size, urls: [...queued] }), { headers: { "content-type": "application/json" } }));
  await progress();
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
  const ours = STATIC_SET.has(key) || STATIC_SET.has(url.pathname) || url.pathname.startsWith("/_next/static/");
  if (!ours && req.mode !== "navigate") return; // not ours: network only, never stored
  event.respondWith(
    (async () => {
      // caches.match with a cacheName never creates the cache, so "remove offline copy" really leaves nothing behind.
      const hit = (await caches.match(STATIC_SET.has(url.pathname) || url.pathname.startsWith("/_next/") ? url.pathname : key, { cacheName: CACHE })) ?? (await caches.match(req, { cacheName: CACHE, ignoreSearch: true }));
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
        // The manifest is written last, so its presence means every file was stored.
        const m = (await caches.has(CACHE)) ? await caches.match(MANIFEST_KEY, { cacheName: CACHE }) : undefined;
        const info = m ? await m.json() : null;
        const cached = (await caches.has(CACHE)) ? (await (await caches.open(CACHE)).keys()).length : 0;
        event.ports[0] && event.ports[0].postMessage({ version: VERSION, total: info ? info.total : Math.max(cached, STATIC_SET.size), cached: info ? info.total : cached, complete: !!info });
      })(),
    );
  }
});
