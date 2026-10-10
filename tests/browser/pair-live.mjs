// SPDX-License-Identifier: GPL-3.0-or-later
// pair-e2e against the deployment rather than a local server: the page, the
// /signal handler and the TLS front end are the ones a visitor gets, so a
// divergence between the built dist and the source shows up here and nowhere
// else. Needs the tailnet. BASE overrides the host.
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';

const require = createRequire(process.env.PLAYWRIGHT_FROM || '/home/kiri/repos/melee-web/');
const { chromium } = require('playwright');
// The page and /signal share one origin, so there is no ?signal= to pass.
const BASE = process.env.BASE || 'https://botan.tail623785.ts.net:8099';

const kids = [];  // live deployment, nothing to spawn
let browser;
const fail = async (msg) => {
  console.log(`FAIL: ${msg}`);
  await browser?.close();
  kids.forEach((k) => k.kill());
  process.exit(1);
};
const check = async (ok, msg) => { if (!ok) await fail(msg); };

try {
  browser = await chromium.launch({ args: ['--ignore-certificate-errors'] });
  const url = `${BASE}/?room=${randomUUID().slice(0, 8)}`;
  const [a, b] = await Promise.all([0, 1].map(async () => (await (await browser.newContext()).newPage())));
  for (const p of [a, b]) {
    // Headless has no WebGPU, so the preflight after pairing throws; expected.
    await p.goto(url);
    // #22 replaced the mode list with port tiles: #p1/#p2 are gone, and the
    // claim is the .pbtn inside #port-N.
    await p.waitForFunction(() => !!document.querySelector('#port-1 .pbtn'));
  }
  const engine = (p) => p.evaluate(() => !!document.querySelector('script[src="./melee_browser.js"]'));
  await check(!(await engine(a)) && !(await engine(b)), 'engine script present before pairing');

  await a.click('#port-1 .pbtn');
  // B sees A's claim: the tile reads taken and its button refuses.
  await b.waitForFunction(() => document.querySelector('#port-1 .pbtn').disabled);
  // A's own tile stays enabled, because for A that button is now Release.
  // Waited for, not read straight after B's: the two pages get their own state
  // frames and B's can land first, so reading A's tile without this waits on
  // nothing and fails on a render that was simply one tick away.
  await a.waitForFunction(() => document.querySelector('#port-1 .pbtn').textContent === 'Release');
  await check(await a.$eval('#port-1 .pbtn', (e) => !e.disabled && e.textContent === 'Release'),
    "A's own port 1 should offer Release, not a disabled Take");
  await check(await a.$eval('#port-1', (e) => e.className.includes('mine')),
    "A's port 1 should carry the mine class");
  await b.click('#port-1 .pbtn', { force: true }); // a disabled button never sends the claim
  await check(!(await engine(b)), 'engine injected after a refused claim');
  await b.click('#port-2 .pbtn');
  await a.waitForFunction(() => document.querySelector('#port-2 .pbtn').disabled);
  await check(await a.$eval('#port-1 .pbtn', (e) => !e.disabled)
    && await b.$eval('#port-2 .pbtn', (e) => !e.disabled), 'own buttons usable');
  // Ports 3 and 4 are drawn but unreachable until #6 lands a transport that
  // carries more than two peers (lobby.mjs PAIRABLE = 2). Two players is the
  // supported case, so the test states it rather than leaving it implied.
  await check(await a.$eval('#port-3 .pbtn', (e) => e.disabled),
    'port 3 should be disabled while PAIRABLE is 2');

  for (const p of [a, b]) await p.waitForFunction(() => window.meleeNet?.dc.readyState === 'open', null, { timeout: 15000 });
  await check((await a.evaluate(() => meleeNet.player)) === 0 && (await b.evaluate(() => meleeNet.player)) === 1, 'player numbers');

  // Each datagram carries its sequence number and send time. Clocks are shared
  // (same machine, performance.timeOrigin + now), so one-way time is receive - send.
  const run = (p) => p.evaluate(() => new Promise((resolve) => {
    const got = new Set(); const lat = [];
    meleeNet.dc.onmessage = (e) => {
      const v = new Float64Array(e.data);
      lat.push(performance.timeOrigin + performance.now() - v[1]);
      got.add(v[0]);
      if (got.size === 100) resolve({ n: got.size, lat });
    };
    setTimeout(() => resolve({ n: got.size, lat }), 8000);
    window.sendAll = async () => {
      for (let i = 0; i < 100; i++) {
        meleeNet.dc.send(new Float64Array([i, performance.timeOrigin + performance.now()]).buffer);
        await new Promise((r) => setTimeout(r, 5)); // paced: unreliable channel may drop bursts
      }
    };
  }));
  const [ra, rb] = [run(a), run(b)];
  await Promise.all([a, b].map((p) => p.waitForFunction(() => window.sendAll)));
  await Promise.all([a.evaluate(() => sendAll()), b.evaluate(() => sendAll())]);
  const [gotA, gotB] = await Promise.all([ra, rb]);
  await check(gotA.n === 100 && gotB.n === 100, `datagrams received A=${gotA.n} B=${gotB.n} of 100`);
  const med = [...gotA.lat, ...gotB.lat].sort((x, y) => x - y);
  console.log(`PASS pair-e2e: P1/P2 claimed, conflict enforced, channel open, 100+100 datagrams delivered, median one-way ${med[med.length >> 1].toFixed(2)} ms`);
} catch (e) {
  await fail(e.stack || e);
}
await browser.close();
kids.forEach((k) => k.kill());
