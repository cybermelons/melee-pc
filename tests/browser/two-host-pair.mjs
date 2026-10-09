// SPDX-License-Identifier: GPL-3.0-or-later
// Pair two browsers on two different machines through one shared room link.
//
// pair-e2e.mjs runs both tabs in one browser on one host, so the two sides can
// find each other over loopback. That hides anything that depends on the two
// peers being separate processes on separate machines: a race between the two
// SSE deliveries, a candidate that only works because both sides share an
// address, or a server that only answers the host it runs on. This test puts
// one peer on another machine and keeps the room link as the only thing they
// share.
//
// It needs ssh to REMOTE_HOST, node there, and a playwright install there whose
// browser build must match the local one: playwright pins an exact browser
// revision, so a different playwright version on the far side fails to launch.
// It reverse-forwards the local server port, so the remote host reaches the
// page at its own 127.0.0.1 and no listener is exposed to the LAN.
//
//   REMOTE_PW=/tmp/pwhost node tests/browser/two-host-pair.mjs
//
// WARNING: a pass here is NOT a NAT hole punch. Report the candidate types this
// prints. Two machines on one LAN, or on one tailnet, connect through 'host'
// candidates and never traverse a NAT. A hole punch needs the two peers behind
// different NATs, which one site cannot provide. Use tools/browser/natcheck.py
// to find out whether this network could hole punch at all.
import { spawn, spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const require = createRequire(process.env.PLAYWRIGHT_FROM || '/home/kiri/repos/melee-web/');
const pw = require('playwright');

// The fully qualified tailnet name, not the short one. A bare tailnet hostname
// is shadowed by the local hosts file on the host itself and by the router's
// own DNS on the LAN, and both failures look like a plain connection error
// with nothing pointing at DNS. Check with `getent hosts <name>` run from the
// machine that opens the connection, not from the one serving it.
const HOST = process.env.REMOTE_HOST || 'botan.tail623785.ts.net';
const REMOTE_PW = process.env.REMOTE_PW || '/tmp/pwhost';
const PORT = process.env.PORT || '8111';
const room = randomUUID().slice(0, 8);
// The remote side reaches the page through the reverse forward, so both peers
// use the same loopback URL and neither needs a listener on the LAN.
const url = `http://127.0.0.1:${PORT}/?room=${room}`;

const kids = [];
let browser;
const stop = () => {
  kids.forEach((k) => k.kill());
  spawnSync('ssh', [HOST, `rm -f ${REMOTE_PW}/peer.mjs ${REMOTE_PW}/peer.log`]);
};
const fail = async (msg) => {
  console.log(`FAIL: ${msg}`);
  await browser?.close();
  stop();
  process.exit(1);
};

// The remote peer: claim P2, wait for the channel, then echo every datagram so
// the local side can time a round trip against one clock.
const PEER = `
import { createRequire } from 'node:module';
const pw = createRequire(${JSON.stringify(`${REMOTE_PW}/`)})('playwright');
const browser = await pw.chromium.launch();
const p = await (await browser.newContext()).newPage();
await p.addInitScript(() => {
  const RPC = RTCPeerConnection;
  window.RTCPeerConnection = function (...a) { const x = new RPC(...a); window.__pc = x; return x; };
  window.RTCPeerConnection.prototype = RPC.prototype;
});
await p.goto(${JSON.stringify(url)});
await p.waitForFunction(() => !document.getElementById('p2').hidden);
await p.click('#p2');
try {
  await p.waitForFunction(() => window.meleeNet?.dc.readyState === 'open', null, { timeout: 60000 });
} catch (e) {
  console.log('STUCK ' + JSON.stringify(await p.evaluate(() => ({
    ice: window.__pc?.iceConnectionState, conn: window.__pc?.connectionState,
    gather: window.__pc?.iceGatheringState, sig: window.__pc?.signalingState,
  }))));
  await browser.close();
  process.exit(1);
}
await p.evaluate(() => { meleeNet.dc.onmessage = (e) => meleeNet.dc.send(e.data); });
console.log('READY ' + JSON.stringify(await p.evaluate(() => pairInfo())));
await new Promise((r) => setTimeout(r, 60000));
await browser.close();
`;

// The candidate types of the pair ICE actually chose. 'host' on both sides
// means the two machines reached each other directly, with no NAT in between.
const PAIR_INFO = () => {
  window.pairInfo = async () => {
    const s = await window.__pc.getStats();
    let pair = null;
    s.forEach((x) => { if (x.type === 'candidate-pair' && x.state === 'succeeded') pair = x; });
    if (!pair) return null;
    let local = null; let remote = null;
    s.forEach((x) => {
      if (x.id === pair.localCandidateId) local = x;
      if (x.id === pair.remoteCandidateId) remote = x;
    });
    return { local: local?.candidateType, remote: remote?.candidateType };
  };
};

try {
  kids.push(spawn(process.execPath, [path.join(root, 'tools/browser/serve.mjs'),
    path.join(root, 'platforms/browser')],
  { env: { ...process.env, PORT }, stdio: 'ignore' }));
  // -N carries no command, so this ssh only forwards the port.
  kids.push(spawn('ssh', ['-N', '-R', `${PORT}:127.0.0.1:${PORT}`, HOST], { stdio: 'ignore' }));
  await new Promise((r) => setTimeout(r, 1500));

  const put = spawnSync('ssh', [HOST, `cat > ${REMOTE_PW}/peer.mjs`], { input: PEER });
  if (put.status !== 0) await fail(`could not write the peer script on ${HOST}`);
  kids.push(spawn('ssh', [HOST,
    `cd ${REMOTE_PW} && node peer.mjs > peer.log 2>&1`], { stdio: 'ignore' }));

  browser = await pw.chromium.launch();
  const p = await (await browser.newContext()).newPage();
  await p.addInitScript(() => {
    const RPC = RTCPeerConnection;
    window.RTCPeerConnection = function (...a) { const x = new RPC(...a); window.__pc = x; return x; };
    window.RTCPeerConnection.prototype = RPC.prototype;
  });
  await p.addInitScript(PAIR_INFO);
  await p.goto(url);
  await p.waitForFunction(() => !document.getElementById('p1').hidden);
  await p.click('#p1');
  try {
    await p.waitForFunction(() => window.meleeNet?.dc.readyState === 'open', null, { timeout: 60000 });
  } catch (e) {
    const here = await p.evaluate(() => ({
      ice: window.__pc?.iceConnectionState, conn: window.__pc?.connectionState,
      gather: window.__pc?.iceGatheringState, sig: window.__pc?.signalingState,
    }));
    const there = spawnSync('ssh', [HOST, `cat ${REMOTE_PW}/peer.log`]).stdout?.toString() || '';
    await fail(`channel never opened. local ${JSON.stringify(here)}\nremote: ${there.trim()}`);
  }
  const info = await p.evaluate(() => pairInfo());

  // The remote peer echoes, so this is a round trip measured on one clock and
  // there is no clock difference between the machines to correct for.
  const lat = await p.evaluate(() => new Promise((resolve) => {
    const got = []; let sent = 0;
    meleeNet.dc.onmessage = (e) => {
      got.push(performance.now() - new Float64Array(e.data)[1]);
      if (got.length === 100) resolve(got);
    };
    const tick = () => {
      if (sent === 100) return;
      meleeNet.dc.send(new Float64Array([sent++, performance.now()]).buffer);
      setTimeout(tick, 10); // paced: an unreliable channel may drop a burst
    };
    tick();
    setTimeout(() => resolve(got), 20000);
  }));
  // The channel is unordered with no retransmits, so a few losses are correct
  // behaviour, not a defect. 90 of 100 is the floor.
  if (lat.length < 90) await fail(`only ${lat.length} of 100 datagrams echoed`);
  const med = [...lat].sort((x, y) => x - y)[lat.length >> 1];
  const nat = info && info.local === 'host' && info.remote === 'host'
    ? ' (direct, no NAT traversal: both candidates are host)'
    : '';
  console.log(`PASS two-host-pair: ${HOST} joined the room link, channel open, `
    + `${lat.length}/100 echoed, median round trip ${med.toFixed(2)} ms, `
    + `candidates ${info?.local}<->${info?.remote}${nat}`);
} catch (e) {
  await fail(e.stack || e);
}
await browser.close();
stop();
