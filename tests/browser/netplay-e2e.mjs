// SPDX-License-Identifier: GPL-3.0-or-later
// Two headful pages pair over WebRTC, play a netplay match, and must advance
// together, see each other's input, and hold framerate. Run under cage:
//   . tools/display.sh && run_headless timeout 900 node tests/browser/netplay-e2e.mjs
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const require = createRequire(process.env.PLAYWRIGHT_FROM || '/home/kiri/repos/melee-web/');
const { chromium } = require('playwright');
const SERVE = process.env.SERVE || '/home/kiri/repos/melee-web/tools/serve.mjs';
const DISC = process.env.MELEE_DISC || '/home/kiri/repos/melee-web/melee_1.02.iso';
const SHOTS = process.env.SHOTS || '/tmp/claude-1000/-home-kiri-repos/b0b22c1a-2078-5ae6-9042-11b01d847b1a/scratchpad';

const SERVE_DIR = process.env.SERVE_DIR || path.join(root, 'build/browser/runtime/platforms/browser');
const PORT = process.env.SERVE_PORT || '8102';
const kids = [
  spawn(process.execPath, [SERVE, SERVE_DIR],
    { env: { ...process.env, PORT, MELEE_DISC: DISC }, stdio: 'ignore' }),
];
// The deployed shell defaults to a same-origin /signal mount inside serve.mjs;
// the build dir's shell still wants a standalone signal server on 8101.
if (!process.env.SERVE_DIR) {
  kids.push(spawn(process.execPath, [path.join(root, 'tools/browser/signal.mjs')],
    { env: { ...process.env, PORT: '8101' }, stdio: 'ignore' }));
}
let browser;
let pages = [];
const logs = [[], []];
const fail = async (msg) => {
  console.log(`FAIL: ${msg}`);
  logs.forEach((l, i) => console.log(`--- last logs ${'AB'[i]} ---\n${l.slice(-25).join('\n')}`));
  for (const p of pages) console.log('frames:', await p.evaluate(() => meleeFrames.count).catch((e) => String(e).slice(0, 200)));
  await browser?.close();
  kids.forEach((k) => k.kill());
  process.exit(1);
};
const check = async (ok, msg) => { if (!ok) await fail(msg); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const BAD = /net: DESYNC|net: disconnected|peer silent|PAGEERROR|abort\(|sendto error|recvfrom error/;

try {
  await sleep(500);
  browser = await chromium.launch({
    headless: false, // headless has no WebGPU; cage provides the isolation
    args: ['--no-sandbox', '--enable-unsafe-webgpu', '--enable-features=Vulkan', '--ignore-gpu-blocklist',
      '--ozone-platform=x11', '--mute-audio', '--window-position=0,0', '--window-size=1280,1000'],
  });
  const url = `http://127.0.0.1:${PORT}/?room=${randomUUID().slice(0, 8)}&MELEE_BOOT_SCENE=vs&MELEE_SCENE_LOG=1&MELEE_SEED=1`;
  const [a, b] = await Promise.all([0, 1].map(async () => (await (await browser.newContext()).newPage())));
  pages = [a, b];
  pages.forEach((p, i) => {
    p.on('console', (m) => logs[i].push(m.text()));
    p.on('pageerror', (e) => logs[i].push('PAGEERROR ' + e.message));
  });
  for (const p of pages) {
    await p.goto(url);
    await p.waitForFunction(() => !document.getElementById('p1').hidden);
  }
  await a.click('#p1');
  await b.waitForFunction(() => document.getElementById('p1').disabled);
  await b.click('#p2');
  const T = { timeout: 180000 };
  for (const p of pages) await p.waitForFunction(() => window.meleeNet?.dc?.readyState === 'open', null, T);
  await check((await a.evaluate(() => meleeNet.player)) === 0 && (await b.evaluate(() => meleeNet.player)) === 1, 'player numbers');
  for (const p of pages) await p.waitForSelector('#start:not([disabled])', T);
  await Promise.all(pages.map((p) => p.click('#start')));

  const has = (i, re) => logs[i].some((l) => re.test(l));
  const until = async (cond, what) => {
    for (let t = 0; t < 180; t++) { if (cond()) return; await sleep(1000); }
    await fail(`timeout waiting for ${what}`);
  };
  await until(() => [0, 1].every((i) => has(i, /net: handshake done/)), 'handshake on both pages');
  await check(has(0, /net: rollback with .*player P1/) && has(1, /net: rollback with .*player P2/), 'rollback line names wrong player');
  await until(() => [0, 1].every((i) => has(i, /boot scene: game mode/)), 'boot scene: game mode on both');
  for (const p of pages) await p.waitForFunction(() => (meleeFrames.count || 0) > 0, null, T);

  // Input crossing: net.c write_head logs this once per side on the first non-zero remote pad.
  const press = async (p) => { await p.focus('#canvas'); await p.keyboard.down('x'); await sleep(120); await p.keyboard.up('x'); };
  const FIRST = /net: first remote button press \(/;
  await press(a);
  await until(() => has(1, FIRST), 'B to see a remote button press from A');
  await press(b);
  await until(() => has(0, FIRST), 'A to see a remote button press from B');

  // Frame advance + pacing over 20 s; screenshots at 10 s.
  await sleep(1000);
  const start = await Promise.all(pages.map((p) => p.evaluate(() => { meleeFrames.samples.length = 0; return meleeFrames.count; })));
  await sleep(10000);
  await Promise.all(pages.map((p, i) => p.screenshot({ path: path.join(SHOTS, `netplay-${'AB'[i]}.png`) })));
  await sleep(10000);
  const stats = await Promise.all(pages.map((p, i) => p.evaluate((c0) => {
    const f = meleeFrames, s = f.samples, sorted = [...s].sort((x, y) => x - y);
    return { advanced: f.count - c0, n: s.length, fps: 1000 * s.length / s.reduce((x, y) => x + y, 0), p99: sorted[Math.floor(s.length * 0.99)] };
  }, start[i])));

  for (let i = 0; i < 2; i++) {
    const bad = logs[i].find((l) => BAD.test(l));
    await check(!bad, `page ${'AB'[i]} logged: ${bad}`);
    const s = stats[i];
    await check(s.advanced >= 1100, `page ${'AB'[i]} advanced only ${s.advanced} frames in 20 s`);
    await check(s.fps >= 58.5 && s.p99 <= 33.4, `page ${'AB'[i]} fps ${s.fps.toFixed(2)} p99 ${s.p99.toFixed(1)} ms`);
  }
  const f = (s) => `${s.advanced} frames, ${s.fps.toFixed(2)} fps, p99 ${s.p99.toFixed(1)} ms`;
  console.log(`PASS netplay-e2e: P1/P2 handshake done, input crossed both ways, A ${f(stats[0])}, B ${f(stats[1])}`);
} catch (e) {
  await fail(e.stack || e);
}
await browser.close();
kids.forEach((k) => k.kill());
