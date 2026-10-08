// SPDX-License-Identifier: GPL-3.0-or-later
// Two tabs pair through tools/browser/signal.mjs and exchange datagrams over
// WebRTC. No engine, no GPU. Needs playwright (NODE_PATH or a parent node_modules).
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const require = createRequire(process.env.PLAYWRIGHT_FROM || '/home/kiri/repos/melee-web/');
const { chromium } = require('playwright');
const SERVE = process.env.SERVE || '/home/kiri/repos/melee-web/tools/serve.mjs';

const kids = [
  spawn(process.execPath, [SERVE, path.join(root, 'platforms/browser')], { env: { ...process.env, PORT: '8102' }, stdio: 'ignore' }),
  spawn(process.execPath, [path.join(root, 'tools/browser/signal.mjs')], { env: { ...process.env, PORT: '8101' }, stdio: 'ignore' }),
];
let browser;
const fail = async (msg) => {
  console.log(`FAIL: ${msg}`);
  await browser?.close();
  kids.forEach((k) => k.kill());
  process.exit(1);
};
const check = async (ok, msg) => { if (!ok) await fail(msg); };

try {
  await new Promise((r) => setTimeout(r, 500));
  browser = await chromium.launch();
  const url = `http://127.0.0.1:8102/?room=${randomUUID().slice(0, 8)}`;
  const [a, b] = await Promise.all([0, 1].map(async () => (await (await browser.newContext()).newPage())));
  for (const p of [a, b]) {
    // Headless has no WebGPU, so the preflight after pairing throws; expected.
    await p.goto(url);
    await p.waitForFunction(() => !document.getElementById('p1').hidden);
  }
  const engine = (p) => p.evaluate(() => !!document.querySelector('script[src="./melee_browser.js"]'));
  await check(!(await engine(a)) && !(await engine(b)), 'engine script present before pairing');

  await a.click('#p1');
  await b.waitForFunction(() => document.getElementById('p1').disabled);
  await check(await a.$eval('#p1', (e) => !e.disabled), "A's own P1 is disabled");
  await b.click('#p1', { force: true }); // a disabled button never sends the claim
  await check(!(await engine(b)), 'engine injected after a refused claim');
  await b.click('#p2');
  await a.waitForFunction(() => document.getElementById('p2').disabled);
  await check(await a.$eval('#p1', (e) => !e.disabled) && await b.$eval('#p2', (e) => !e.disabled), 'own buttons disabled');

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
