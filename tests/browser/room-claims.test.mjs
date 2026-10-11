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
    // Read the claim out of the parsed frame, not out of its JSON text. An
    // assertion on the text passes for any shape that spells the id, which is
    // how an object literal went unnoticed while lobby.mjs mySlot() needed an
    // array and threw on every state event.
    const holders = states
      .filter((s) => s.includes('event: state'))
      .map((s) => JSON.parse(/data: (.*)/.exec(s)[1]).claims[0]);
    assert.ok(holders.includes('alice'), 'state shows alice holding P1');

    alice.abort(); // alice's page goes away
    await wait(200);
    const freed = states.filter((s) => s.includes('event: state')).pop();
    assert.equal(JSON.parse(/data: (.*)/.exec(freed)[1]).claims[0], null,
      'P1 is freed when alice’s stream closes');
    assert.equal(await post({ type: 'claim', player: 0, from: 'bob' }), 204, 'bob can now take P1');
  } finally {
    keeper.abort();
    alice.abort();
    srv.closeAllConnections();
    await new Promise((r) => srv.close(r));
  }
});

// Claims (#23). There is no queue: a free port is takeable by anyone and a
// taken one refuses. These drive the real HTTP handler rather than calling a
// helper, because the outcome depends on the close handler and the claim path
// agreeing.
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

test('a taken port refuses a second claimant and its holder keeps it', { timeout: 10000 }, async () => {
  const h = harness('q1', 8200);
  try {
    await h.sub('alice'); await h.sub('bob'); await h.sub('carol');
    await wait(100);
    assert.equal(await h.post({ type: 'claim', player: 0, from: 'alice' }), 204);
    assert.equal(await h.post({ type: 'claim', player: 1, from: 'bob' }), 204);
    await wait(50);
    assert.equal(await h.post({ type: 'claim', player: 0, from: 'carol' }), 409,
      'the claim itself fails; the port is held');
    await wait(100);
    const s = h.latest.get('carol');
    assert.equal(s.claims[0], 'alice', 'alice still holds P1');
    assert.equal(s.claims[1], 'bob', 'and bob still holds P2');
    assert.ok(!('queue' in s), 'a refusal enrolls nobody in anything');
  } finally { await h.close(); }
});

test('an explicit release frees the port for anyone to take', { timeout: 10000 }, async () => {
  const h = harness('q2', 8201);
  try {
    await h.sub('alice'); await h.sub('bob'); await h.sub('carol');
    await wait(100);
    await h.post({ type: 'claim', player: 0, from: 'alice' });
    await h.post({ type: 'claim', player: 1, from: 'bob' });
    await h.post({ type: 'claim', player: 0, from: 'carol' }); // refused
    await wait(100);
    assert.equal(await h.post({ type: 'release', from: 'alice' }), 204);
    await wait(100);
    assert.equal(h.latest.get('carol').claims[0], null,
      'the freed port goes to nobody in particular, including the one refused earlier');
    assert.equal(await h.post({ type: 'claim', player: 0, from: 'carol' }), 204, 'anyone can take it');
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

test('moving to another port frees the old one', { timeout: 10000 }, async () => {
  // signal.mjs drops a claimant's previous slot on every claim.
  const h = harness('q7', 8206);
  try {
    await h.sub('alice'); await h.sub('bob');
    await wait(100);
    await h.post({ type: 'claim', player: 0, from: 'alice' });
    await wait(100);
    // alice moves P1 -> P2. P2 was free, so the claim takes, and P1 frees.
    assert.equal(await h.post({ type: 'claim', player: 1, from: 'alice' }), 204);
    await wait(100);
    const s = h.latest.get('bob');
    assert.equal(s.claims[1], 'alice', 'alice moved to P2');
    assert.equal(s.claims[0], null, 'and the P1 she left is free');
    assert.equal(await h.post({ type: 'claim', player: 0, from: 'bob' }), 204, 'anyone can take it');
  } finally { await h.close(); }
});

test('claims are in the state every subscriber sees', { timeout: 10000 }, async () => {
  const h = harness('q8', 8207);
  try {
    await h.sub('alice'); await h.sub('bob'); await h.sub('carol');
    await wait(100);
    await h.post({ type: 'claim', player: 0, from: 'alice' });
    await h.post({ type: 'claim', player: 1, from: 'bob' });
    await wait(100);
    for (const who of ['alice', 'bob', 'carol']) {
      assert.deepEqual(h.latest.get(who).claims, ['alice', 'bob'], `${who} sees the claims`);
    }
  } finally { await h.close(); }
});

test('a fresh subscriber is told the current claims', { timeout: 10000 }, async () => {
  // The first state event a page gets is the one it renders from.
  const h = harness('q10', 8209);
  try {
    await h.sub('alice'); await h.sub('bob');
    await wait(100);
    await h.post({ type: 'claim', player: 0, from: 'alice' });
    await h.post({ type: 'claim', player: 1, from: 'bob' });
    await wait(100);
    await h.sub('late');
    await wait(100);
    assert.deepEqual(h.latest.get('late').claims, ['alice', 'bob']);
  } finally { await h.close(); }
});

// Loading a save state is a reload (#24, states.mjs:16-21): no snapshot path
// exists in the browser build, so a preset press is a query string plus a
// navigation. That drops the event stream and fires the close handler, and
// the issue's second paragraph says it must not cost a port --
// "a training scenario needs no seat of its own and does not cost anybody a
// port". A reload is simulated the way the browser does it: the new stream
// subscribes under the same id, then the old one closes.
test('loading a state keeps the port it was loaded from', { timeout: 10000 }, async () => {
  const h = harness('s1', 8210);
  try {
    await h.sub('keeper');
    const before = await h.sub('alice');
    await wait(100);
    assert.equal(await h.post({ type: 'claim', player: 0, from: 'alice' }), 204);
    await wait(100);
    assert.equal(h.latest.get('keeper').claims[0], 'alice', 'alice holds P1');

    // The state load: ?MELEE_BOOT_SCENE=training&MELEE_HITBOXES=1 with the same
    // ?room=, so the same page comes back under the same identity.
    await h.sub('alice');
    before.abort();
    await wait(300);
    assert.equal(h.latest.get('keeper').claims[0], 'alice',
      'the port survived the reload a state load performs');
  } finally { await h.close(); }
});

test('a state load costs no other player their port', { timeout: 10000 }, async () => {
  // The other half of the same paragraph. Reloading one page must not disturb
  // anybody else's claim.
  const h = harness('s2', 8211);
  try {
    const alice = await h.sub('alice');
    await h.sub('bob');
    await wait(100);
    await h.post({ type: 'claim', player: 0, from: 'alice' });
    await h.post({ type: 'claim', player: 1, from: 'bob' });
    await wait(100);
    await h.sub('alice');
    alice.abort();
    await wait(300);
    const s = h.latest.get('bob');
    assert.equal(s.claims[1], 'bob', 'bob kept P2 through someone else’s state load');
    assert.equal(s.claims[0], 'alice', 'and alice kept P1');
  } finally { await h.close(); }
});

test('a tab that closes for real still frees its port', { timeout: 10000 }, async () => {
  // The guard must not become a leak: keeping a claim across a reload is only
  // correct because a page that does not come back has no stream under its id.
  const h = harness('s3', 8212);
  try {
    await h.sub('keeper');
    const alice = await h.sub('alice');
    await wait(100);
    await h.post({ type: 'claim', player: 0, from: 'alice' });
    await wait(100);
    alice.abort(); // no replacement stream: the tab is gone
    await wait(300);
    assert.equal(h.latest.get('keeper').claims[0], null, 'a closed tab frees its port');
  } finally { await h.close(); }
});
