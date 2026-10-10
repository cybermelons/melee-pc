// SPDX-License-Identifier: GPL-3.0-or-later
// Pairing must send its offer on a network where a STUN server is partly
// unreachable. Every public STUN server publishes an AAAA record, so an
// IPv4-only network leaves one candidate pair pending and ICE gathering never
// reaches 'complete'. Measured on this host 2026-10-10: gathering was still
// open after 12 seconds, while the first srflx candidate arrived at 11 ms.
// Waiting for 'complete' before posting the offer therefore hangs the pairing
// for as long as the browser's own gathering timeout, which is minutes.
//
// These tests drive gathered() against a fake RTCPeerConnection rather than
// matching the text of shell.mjs. The old test here asserted only that a
// setTimeout was present, which any rewrite keeps and which says nothing about
// what the function waits for.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { gathered } from '../../platforms/browser/nat.mjs';

// Just enough RTCPeerConnection for gathered(): a gathering state and the two
// events it listens on.
const fakePc = (state = 'gathering') => {
  const listeners = new Map();
  return {
    iceGatheringState: state,
    addEventListener: (type, fn) => {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type).add(fn);
    },
    removeEventListener: (type, fn) => listeners.get(type)?.delete(fn),
    emit(type, event) { for (const fn of listeners.get(type) ?? []) fn(event); },
    count: (type) => listeners.get(type)?.size ?? 0,
  };
};
const candidate = (text) => ({ candidate: { candidate: text } });
// Runs `body` with the 3 second cap disabled, so only a candidate or a
// gathering-complete event can resolve. Without this a test that merely awaits
// gathered() proves nothing: the cap resolves it either way, which is how an
// earlier version of this file passed against a gathered() with no srflx gate
// at all.
const withoutTheCap = async (body) => {
  const real = globalThis.setTimeout;
  globalThis.setTimeout = () => 0;
  try { return await body(); } finally { globalThis.setTimeout = real; }
};
const SRFLX = 'candidate:1 1 udp 1 203.0.113.4 54321 typ srflx raddr 192.168.1.9 rport 54321';
const HOST = 'candidate:2 1 udp 1 192.168.1.9 54321 typ host';

// A timeout, because with the cap disabled a missing gate hangs this test
// rather than failing it, and a hang reports nothing.
test('a srflx candidate releases the offer without waiting for the timer',
  { timeout: 3000 }, () => withoutTheCap(async () => {
    const pc = fakePc();
    const wait = gathered(pc);
    pc.emit('icecandidate', candidate(SRFLX));
    // With the cap disabled, this await returns only because the srflx
    // candidate resolved it, and hangs the test if the gate is missing.
    await wait;
    // The listener is removed, so a later candidate cannot resolve a settled
    // promise or keep the peer connection referenced after pairing moves on.
    assert.equal(pc.count('icecandidate'), 0, 'the candidate listener must be removed');
  }));

test('a host candidate does not release the offer', async () => {
  const pc = fakePc();
  let settled = false;
  gathered(pc).then(() => { settled = true; });
  pc.emit('icecandidate', candidate(HOST));
  // A host candidate is a LAN address. An offer carrying only host candidates
  // cannot reach a peer on another network, so this must not count as usable.
  await new Promise((r) => setImmediate(r));
  assert.equal(settled, false, 'a host candidate is not enough to send the offer');
});

test('the end-of-candidates event does not release the offer', async () => {
  const pc = fakePc();
  let settled = false;
  gathered(pc).then(() => { settled = true; });
  // The browser signals the end of gathering with a null candidate. Reading
  // .candidate.candidate on it would throw inside the listener.
  pc.emit('icecandidate', { candidate: null });
  await new Promise((r) => setImmediate(r));
  assert.equal(settled, false);
});

test('gathering reaching complete releases the offer', async () => {
  const pc = fakePc();
  const wait = gathered(pc);
  pc.iceGatheringState = 'complete';
  pc.emit('icegatheringstatechange');
  await wait;
});

test('a peer that already finished gathering resolves at once', async () => {
  await gathered(fakePc('complete'));
});

test('the timer is a ceiling, so a silent network still sends an offer', async () => {
  const real = globalThis.setTimeout;
  let delay = null;
  // Fires the timer rather than waiting 3 real seconds, and records the delay,
  // because the point of the cap is that it is bounded and short.
  globalThis.setTimeout = (fn, ms) => { delay = ms; real(fn, 0); return 0; };
  try {
    await gathered(fakePc());
    assert.equal(delay, 3000, 'the cap must stay a few seconds, not minutes');
  } finally {
    globalThis.setTimeout = real;
  }
});
