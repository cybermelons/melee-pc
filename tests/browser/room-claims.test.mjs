// SPDX-License-Identifier: GPL-3.0-or-later
// A controller-port claim must not outlive the stream that made it. A claim
// held by a page that has gone leaves the room reporting itself full, so the
// other player waits for a peer that cannot answer.
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { signalHandler } from '../../tools/browser/signal.mjs';

const PORT = 8199;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// Event streams never end on their own, so a held-open one keeps the process
// alive. closeAllConnections drops them, and the cleanup runs even when an
// assertion throws: otherwise a regression hangs the build instead of failing
// it, which is far harder to read than a failed assertion.
test('a claim does not outlive its stream', { timeout: 10000 }, async () => {
  const srv = http.createServer((q, s) => signalHandler(q, s)).listen(PORT, '127.0.0.1');
  const base = `http://127.0.0.1:${PORT}/r/t1`;
  const post = (b) => fetch(base, { method: 'POST', body: JSON.stringify(b) }).then((r) => r.status);

  const states = [];
  const sub = async (me, signal) => {
    const r = await fetch(`${base}/events?me=${me}`, { signal });
    const rd = r.body.getReader();
    (async () => {
      for (;;) {
        const { value, done } = await rd.read();
        if (done) return;
        states.push(new TextDecoder().decode(value));
      }
    })().catch(() => {});
  };
  // Two subscribers, so the room survives one of them leaving: an empty room
  // is deleted outright, which would free the claim for the wrong reason.
  const keeper = new AbortController();
  const alice = new AbortController();

  try {
    await sub('keeper', keeper.signal);
    await sub('alice', alice.signal);
    await wait(100);

    assert.equal(await post({ type: 'claim', player: 0, from: 'alice' }), 204, 'alice claims P1');
    await wait(100);
    assert.ok(states.some((s) => s.includes('"0":"alice"')), 'state shows alice holding P1');

    alice.abort(); // alice's page goes away
    await wait(200);
    const freed = states.filter((s) => s.includes('event: state')).pop();
    assert.match(freed, /"0":null/, 'P1 is freed when alice’s stream closes');
    assert.equal(await post({ type: 'claim', player: 0, from: 'bob' }), 204, 'bob can now take P1');
  } finally {
    keeper.abort();
    alice.abort();
    srv.closeAllConnections();
    await new Promise((r) => srv.close(r));
  }
});
