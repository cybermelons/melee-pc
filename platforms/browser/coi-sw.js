// SPDX-License-Identifier: GPL-3.0-or-later
// The engine's threads need SharedArrayBuffer, which needs a cross-origin
// isolated page (COOP/COEP headers). Static hosts such as GitHub Pages cannot
// send headers, so this service worker adds them to every response in its
// scope. shell.mjs registers it only when the page is not isolated already;
// tools/browser/serve.py sends the headers itself.
//
// It also caches the engine, which is 5.2 MB gzipped and the whole of a repeat
// visit's download. A static host that cannot send COOP/COEP cannot send a
// useful validator either, so there is nothing here to revalidate against:
// the cache key carries the engine's own bytes instead, and a new build lands
// at a new key. tools/serve.mjs sends an ETag and gets a 304, and does not
// register this worker at all, so the two caching paths never overlap.
const CACHE = 'melee-engine-v1';
// Only the two large immutable artifacts. The page, the shell and the modules
// are small and change often, so caching them would trade a visible staleness
// bug for a download that is already short.
const CACHED = ['melee_browser.wasm', 'melee_browser.js'];

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil((async () => {
  // Drop an older engine's entries, so a cache does not grow by one engine per
  // deploy. Keys other than CACHE belong to a previous version of this worker.
  for (const key of await caches.keys()) {
    if (key !== CACHE) await caches.delete(key);
  }
  await self.clients.claim();
})()));

function isolate(response) {
  if (response.status === 0) return response; // opaque: not ours to rewrite
  const headers = new Headers(response.headers);
  headers.set('Cross-Origin-Opener-Policy', 'same-origin');
  headers.set('Cross-Origin-Embedder-Policy', 'require-corp');
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.cache === 'only-if-cached' && request.mode !== 'same-origin') return;

  const url = new URL(request.url);
  // Same origin only, and never a range request: a cached range would be a
  // partial body stored under the key of a whole one. /disc is read by range
  // and is the player's own file, so it is never cached here.
  const cacheable = request.method === 'GET'
    && url.origin === location.origin
    && !request.headers.has('range')
    && CACHED.some((name) => url.pathname.endsWith('/' + name));

  if (!cacheable) {
    event.respondWith(fetch(request).then(isolate));
    return;
  }

  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const hit = await cache.match(url.pathname);
    // The headers still have to be added: a cached response replays the bytes
    // that were stored, and isolation is a property of this response.
    if (hit) return isolate(hit);
    const response = await fetch(request);
    // Only a complete 200 is worth storing; an error page under the engine's
    // key would be served as the engine until the next deploy.
    if (response.status === 200) {
      // put() consumes the body, so store a clone and return the original.
      await cache.put(url.pathname, response.clone());
    }
    return isolate(response);
  })());
});
