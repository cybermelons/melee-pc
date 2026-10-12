// SPDX-License-Identifier: GPL-3.0-or-later
// pair-live against two emulated phones, because the supported way to play is
// a link handed to someone who opens it on a phone. A desktop pass says
// nothing about that: the ports grid is four tiles wide on a desktop and must
// fold to two on a phone, and every claim is a touch rather than a click.
// Needs the tailnet. BASE overrides the host.
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';

const require = createRequire(process.env.PLAYWRIGHT_FROM || '/home/kiri/repos/melee-web/');
const { chromium, devices } = require('playwright');
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
  const phone = devices['Pixel 7'];
  const [a, b] = await Promise.all([0, 1].map(async () => (await (await browser.newContext({ ...phone })).newPage())));
  for (const p of [a, b]) {
    // Headless has no WebGPU, so the preflight after pairing throws; expected.
    await p.goto(url);
    // Assert the emulation is real rather than trusting the device descriptor:
    // a desktop context would pass every check below and prove nothing.
    const got = await p.evaluate(() => ({ w: innerWidth, touch: 'ontouchstart' in window, pts: navigator.maxTouchPoints }));
    await check(got.w <= 560 && got.touch && got.pts > 0, `not a phone context: ${JSON.stringify(got)}`);
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
  // Four tiles in a row do not fit a phone, so the media query folds the grid
  // to two columns. Counted, not printed: a regression here is a page a phone
  // player has to scroll sideways to claim a port on.
  let cols;
  for (const p of [a, b]) {
    const pad = await p.evaluate(() => ({ narrow: innerWidth <= 560, cols: getComputedStyle(document.querySelector('.ports')).gridTemplateColumns }));
    await check(pad.narrow, `viewport widened to ${JSON.stringify(pad)}`);
    await check(pad.cols.trim().split(/\s+/).length === 2, `ports grid should be 2 columns on a phone, got ${pad.cols}`);
    cols = pad.cols;
  }
  console.log(`PASS pair-phone: P1/P2 claimed, conflict enforced, channel open, 100+100 datagrams delivered, median one-way ${med[med.length >> 1].toFixed(2)} ms, ports grid ${cols}`);
} catch (e) {
  await fail(e.stack || e);
}
await browser.close();
kids.forEach((k) => k.kill());
