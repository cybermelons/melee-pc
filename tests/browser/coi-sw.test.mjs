// SPDX-License-Identifier: GPL-3.0-or-later
// coi-sw.js runs as a service worker, so it is loaded here against fakes for
// the globals it uses. What is worth testing is not the caching itself but
// where it must not apply: a range request and a non-200 both produce a body
// that would be wrong to replay under the whole file's key.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import {fileURLToPath} from 'node:url';

const source = fs.readFileSync(
  path.join(path.dirname(fileURLToPath(import.meta.url)), '../../platforms/browser/coi-sw.js'), 'utf8');

// One store per load, so each test sees a fresh cache.
function load({fetchImpl}) {
  const store = new Map();
  const cache = {
    match: async (key) => store.get(String(key)),
    put: async (key, res) => { store.set(String(key), res); },
  };
  const listeners = {};
  const sandbox = {
    self: {
      addEventListener: (type, fn) => { listeners[type] = fn; },
      skipWaiting: () => {},
      clients: {claim: async () => {}},
    },
    caches: {open: async () => cache, keys: async () => [...store.keys()].length ? ['melee-engine-v1'] : [], delete: async () => true},
    location: {origin: 'https://example.test'},
    fetch: fetchImpl,
    Headers, Request, Response, URL,
  };
  vm.runInNewContext(source, sandbox);
  return {listeners, store};
}

// The worker answers through event.respondWith, so capture what it passes.
async function dispatch(listeners, request) {
  let answer;
  await listeners.fetch({request, respondWith: (p) => { answer = p; }});
  return answer;
}

const engine = 'https://example.test/melee_browser.wasm';

test('caches the engine and replays it with the isolation headers', async () => {
  let calls = 0;
  const {listeners, store} = load({fetchImpl: async () => { calls++; return new Response('wasm', {status: 200}); }});
  const first = await dispatch(listeners, new Request(engine));
  assert.equal(first.headers.get('Cross-Origin-Embedder-Policy'), 'require-corp');
  assert.equal(await first.text(), 'wasm');
  assert.equal(store.size, 1, 'the engine was stored');
  // The second visit is the point: no network, and still isolated.
  const second = await dispatch(listeners, new Request(engine));
  assert.equal(calls, 1, 'a cache hit does not refetch');
  assert.equal(second.headers.get('Cross-Origin-Opener-Policy'), 'same-origin');
  assert.equal(await second.text(), 'wasm');
});

test('never caches a range request, whose body is a fragment', async () => {
  const {listeners, store} = load({fetchImpl: async () => new Response('part', {status: 206})});
  await dispatch(listeners, new Request(engine, {headers: {range: 'bytes=0-3'}}));
  assert.equal(store.size, 0, 'a 206 fragment is not stored under the whole file key');
});

test('never caches a non-200, which would be served as the engine', async () => {
  const {listeners, store} = load({fetchImpl: async () => new Response('not found', {status: 404})});
  const res = await dispatch(listeners, new Request(engine));
  assert.equal(res.status, 404, 'the error still reaches the page');
  assert.equal(store.size, 0, 'an error page is not stored under the engine key');
});

test('leaves everything else alone but still isolates it', async () => {
  const {listeners, store} = load({fetchImpl: async () => new Response('<html>', {status: 200})});
  const res = await dispatch(listeners, new Request('https://example.test/index.html'));
  assert.equal(store.size, 0, 'the page is not cached');
  assert.equal(res.headers.get('Cross-Origin-Embedder-Policy'), 'require-corp');
});

test('does not cache another origin', async () => {
  const {listeners, store} = load({fetchImpl: async () => new Response('wasm', {status: 200})});
  await dispatch(listeners, new Request('https://elsewhere.test/melee_browser.wasm'));
  assert.equal(store.size, 0, 'a cross-origin engine is not stored');
});
