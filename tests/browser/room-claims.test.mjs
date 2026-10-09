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

// The queue (#23). It is the one place in the signal server with real logic:
// it has an order, and a race for a freed port is exactly what it exists to
// resolve. These drive the real HTTP handler rather than calling a helper,
// because the order depends on the close handler and the claim path agreeing.
const harness = (name, port) => {
  const srv = http.createServer((q, s) => signalHandler(q, s)).listen(port, '127.0.0.1');
  const base = `http://127.0.0.1:${port}/r/${name}`;
  const subs = [];
  const latest = new Map(); // id -> last state object this id was sent
  const post = (b) => fetch(base, { method: 'POST', body: JSON.stringify(b) }).then((r) => r.status);
  const sub = async (me) => {
    const ac = new AbortController();
    subs.push(ac);
    const r = await fetch(`${base}/events?me=${me}`, { signal: ac.signal });
    const rd = r.body.getReader();
    (async () => {
      let buf = '';
      for (;;) {
        const { value, done } = await rd.read();
        if (done) return;
        buf += new TextDecoder().decode(value);
        // One read can carry several events, and the last one is the current
        // truth. Parsing every data line keeps that honest.
        for (const line of buf.split('\n')) {
          if (line.startsWith('data: ')) latest.set(me, JSON.parse(line.slice(6)));
        }
        buf = '';
      }
    })().catch(() => {});
    return ac;
  };
  const close = async () => {
    for (const ac of subs) ac.abort();
    srv.closeAllConnections();
    await new Promise((r) => srv.close(r));
  };
  return { post, sub, latest, close };
};

test('a refused claim puts you in line, in the order you asked', { timeout: 10000 }, async () => {
  const h = harness('q1', 8200);
  try {
    await h.sub('alice'); await h.sub('bob'); await h.sub('carol'); await h.sub('dave');
    await wait(100);
    assert.equal(await h.post({ type: 'claim', player: 0, from: 'alice' }), 204);
    assert.equal(await h.post({ type: 'claim', player: 1, from: 'bob' }), 204);
    await wait(50);
    // Both ports held. Two more want in, and the second must not overtake the
    // first just because its request happened to be handled later.
    assert.equal(await h.post({ type: 'claim', player: 0, from: 'carol' }), 409,
      'the claim itself still fails; the port is held');
    assert.equal(await h.post({ type: 'claim', player: 0, from: 'dave' }), 409);
    await wait(100);
    assert.deepEqual(h.latest.get('dave').queue, ['carol', 'dave'],
      'claim order, not handling order');
  } finally { await h.close(); }
});

test('an explicit release hands the port to the first in line', { timeout: 10000 }, async () => {
  const h = harness('q2', 8201);
  try {
    await h.sub('alice'); await h.sub('bob'); await h.sub('carol'); await h.sub('dave');
    await wait(100);
    await h.post({ type: 'claim', player: 0, from: 'alice' });
    await h.post({ type: 'claim', player: 1, from: 'bob' });
    await h.post({ type: 'claim', player: 0, from: 'carol' });
    await h.post({ type: 'claim', player: 0, from: 'dave' });
    await wait(100);
    assert.equal(await h.post({ type: 'release', from: 'alice' }), 204);
    await wait(100);
    const s = h.latest.get('carol');
    assert.equal(s.claims[0], 'carol', 'the first in line got the freed port');
    assert.deepEqual(s.queue, ['dave'], 'and only the first; dave still waits');
  } finally { await h.close(); }
});

test('releasing a port you do not hold is refused and changes nothing', { timeout: 10000 }, async () => {
  const h = harness('q3', 8202);
  try {
    await h.sub('alice'); await h.sub('bob');
    await wait(100);
    await h.post({ type: 'claim', player: 0, from: 'alice' });
    await wait(50);
    assert.equal(await h.post({ type: 'release', from: 'bob' }), 409);
    await wait(50);
    assert.equal(h.latest.get('alice').claims[0], 'alice', 'alice still holds P1');
  } finally { await h.close(); }
});

test('two waiters racing one freed port get an order, not two rejections',
  { timeout: 10000 }, async () => {
    // The race comment 2983 names. Both waiters are in line, the port frees
    // once, and exactly one of them gets it -- the earlier one. Without the
    // queue both would have to re-claim and one would get a bare 409.
    const h = harness('q4', 8203);
    try {
      await h.sub('alice'); await h.sub('bob'); await h.sub('carol'); await h.sub('dave');
      await wait(100);
      await h.post({ type: 'claim', player: 0, from: 'alice' });
      await h.post({ type: 'claim', player: 1, from: 'bob' });
      // carol asks first, dave second, both refused and both queued.
      await h.post({ type: 'claim', player: 0, from: 'carol' });
      await h.post({ type: 'claim', player: 1, from: 'dave' });
      await wait(100);
      await h.post({ type: 'release', from: 'bob' });
      await wait(100);
      const s = h.latest.get('dave');
      assert.equal(s.claims[1], 'carol',
        'the earlier claimant wins the freed port, even though dave asked for this very slot');
      assert.deepEqual(s.queue, ['dave']);
    } finally { await h.close(); }
  });

test('a waiter who leaves is not handed the next freed port', { timeout: 10000 }, async () => {
  // A ghost holding a port is the exact failure the close handler above
  // exists to prevent, and promoting a departed waiter would recreate it.
  const h = harness('q5', 8204);
  try {
    await h.sub('alice'); await h.sub('bob');
    const carol = await h.sub('carol');
    await h.sub('dave');
    await wait(100);
    await h.post({ type: 'claim', player: 0, from: 'alice' });
    await h.post({ type: 'claim', player: 1, from: 'bob' });
    await h.post({ type: 'claim', player: 0, from: 'carol' });
    await h.post({ type: 'claim', player: 0, from: 'dave' });
    await wait(100);
    carol.abort();
    await wait(200);
    assert.deepEqual(h.latest.get('dave').queue, ['dave'], 'carol left the queue too');
    await h.post({ type: 'release', from: 'alice' });
    await wait(100);
    assert.equal(h.latest.get('dave').claims[0], 'dave',
      'the port went to the waiter who is still here');
  } finally { await h.close(); }
});

test('taking a port gives up your place in line', { timeout: 10000 }, async () => {
  const h = harness('q6', 8205);
  try {
    await h.sub('alice'); await h.sub('bob'); await h.sub('carol');
    await wait(100);
    await h.post({ type: 'claim', player: 0, from: 'alice' });
    await h.post({ type: 'claim', player: 0, from: 'carol' }); // refused, queued
    await wait(100);
    assert.deepEqual(h.latest.get('carol').queue, ['carol']);
    // P2 is free, so this one takes. Staying in line afterwards would hand
    // carol a second port the moment one frees, and signal.mjs only ever lets
    // one id hold one slot.
    assert.equal(await h.post({ type: 'claim', player: 1, from: 'carol' }), 204);
    await wait(100);
    const s = h.latest.get('carol');
    assert.equal(s.claims[1], 'carol');
    assert.deepEqual(s.queue, []);
  } finally { await h.close(); }
});

test('moving to another port frees the old one to the first in line', { timeout: 10000 }, async () => {
  // signal.mjs already dropped a claimant's previous slot on every claim.
  // That freed slot now has to reach the first in line, or a move leaves a
  // port empty while somebody is waiting for exactly that port.
  const h = harness('q7', 8206);
  try {
    await h.sub('alice'); await h.sub('bob');
    await wait(100);
    await h.post({ type: 'claim', player: 0, from: 'alice' });
    await h.post({ type: 'claim', player: 0, from: 'bob' }); // refused, queued for P1
    await wait(100);
    assert.deepEqual(h.latest.get('bob').queue, ['bob']);
    // alice moves P1 -> P2. P2 was free, so the claim takes, and P1 frees.
    assert.equal(await h.post({ type: 'claim', player: 1, from: 'alice' }), 204);
    await wait(100);
    const s = h.latest.get('bob');
    assert.equal(s.claims[1], 'alice', 'alice moved to P2');
    assert.equal(s.claims[0], 'bob', 'and the P1 she left went to the waiter');
    assert.deepEqual(s.queue, []);
  } finally { await h.close(); }
});

test('the queue is in the state every subscriber sees', { timeout: 10000 }, async () => {
  // "Visible to everyone, so somebody waiting can see their place" (#23).
  // The queue has to be in the broadcast state, not only in the reply to the
  // refused claim, or only the waiter would know and nobody could see a line.
  const h = harness('q8', 8207);
  try {
    await h.sub('alice'); await h.sub('bob'); await h.sub('carol');
    await wait(100);
    await h.post({ type: 'claim', player: 0, from: 'alice' });
    await h.post({ type: 'claim', player: 1, from: 'bob' });
    await h.post({ type: 'claim', player: 0, from: 'carol' });
    await wait(100);
    for (const who of ['alice', 'bob', 'carol']) {
      assert.deepEqual(h.latest.get(who).queue, ['carol'], `${who} sees the line`);
    }
  } finally { await h.close(); }
});

test('asking twice does not take two places in line', { timeout: 10000 }, async () => {
  const h = harness('q9', 8208);
  try {
    await h.sub('alice'); await h.sub('bob'); await h.sub('carol');
    await wait(100);
    await h.post({ type: 'claim', player: 0, from: 'alice' });
    await h.post({ type: 'claim', player: 1, from: 'bob' });
    await h.post({ type: 'claim', player: 0, from: 'carol' });
    await h.post({ type: 'claim', player: 1, from: 'carol' });
    await h.post({ type: 'claim', player: 0, from: 'carol' });
    await wait(100);
    assert.deepEqual(h.latest.get('carol').queue, ['carol']);
  } finally { await h.close(); }
});

test('a fresh subscriber is told the queue, not just the claims', { timeout: 10000 }, async () => {
  // The first state event a page gets is the one it renders from, so a
  // spectator who arrives mid-line has to see the line in it.
  const h = harness('q10', 8209);
  try {
    await h.sub('alice'); await h.sub('bob'); await h.sub('carol');
    await wait(100);
    await h.post({ type: 'claim', player: 0, from: 'alice' });
    await h.post({ type: 'claim', player: 1, from: 'bob' });
    await h.post({ type: 'claim', player: 0, from: 'carol' });
    await wait(100);
    await h.sub('late');
    await wait(100);
    assert.deepEqual(h.latest.get('late').queue, ['carol']);
  } finally { await h.close(); }
});
