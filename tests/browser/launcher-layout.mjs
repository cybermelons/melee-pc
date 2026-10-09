// SPDX-License-Identifier: GPL-3.0-or-later
// The launcher's height at a phone width, measured rather than asserted.
//
//   node tests/browser/launcher-layout.mjs
//
// #33 claims two things that are heights, and a unit test cannot see either,
// because the unit tests stub the DOM and know nothing about CSS:
//
//  - at 390px the launcher is SHORTER than it was before the Load button, so
//    the button has to pay for the disc line it brought with it;
//  - the modal FITS the viewport without scrolling, which is a claim about a
//    fixed height and is false the moment the sheet grows past 844px.
//
// Both are measured against the page as it was the moment before #33, which
// `git archive` writes into a temporary tree beside the current one. Two
// static servers, two viewports, one subtraction.
//
// BASE is that commit by name, not HEAD. Measuring against HEAD would make
// the check pass trivially the moment this change was committed -- the
// baseline would become the new page and the difference would be zero -- so
// the number to beat is the launcher as the issue found it. A later issue
// that shortens the launcher further can leave this alone; one that makes it
// taller again has to say so here.
//
// The engine is never started. WebGPU is refused on a headless host (aurora
// will not take a CPU adapter), so this measures the launcher's layout only,
// which is all the issue's claim is about. Do not pipe the run into grep: the
// exit status then comes from grep and a failure reports success.
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { createReadStream, existsSync, mkdtempSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const require = createRequire(process.env.PLAYWRIGHT_FROM || '/home/kiri/repos/melee-web/');
const pw = require('playwright');

// The launcher as #33 found it: 4b612a71, the commit this change was written
// against. A worktree would do and would also take a lock on a shared
// checkout, so this is an archive into a temporary directory instead.
const BASE = process.env.LAUNCHER_BASE || '4b612a71';
const base = mkdtempSync(join(tmpdir(), 'launcher-base-'));
execFileSync('/bin/sh', ['-c',
  `git -C '${root}' archive ${BASE} platforms/browser | tar -x -C '${base}' --strip-components=2`]);

const TYPES = {
  '.html': 'text/html', '.mjs': 'text/javascript', '.js': 'text/javascript',
  '.css': 'text/css', '.json': 'application/json', '.wasm': 'application/wasm',
};

/** A static server over `dir`, on an arbitrary free port. */
const serve = (dir) => new Promise((resolve) => {
  const server = createServer((req, res) => {
    const rel = normalize(decodeURIComponent(req.url.split('?')[0]))
      .replace(/^(\.\.[/\\])+/, '');
    const file = join(dir, rel === '/' ? 'index.html' : rel);
    if (!file.startsWith(dir) || !existsSync(file) || !statSync(file).isFile()) {
      res.writeHead(404).end();
      return;
    }
    res.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream' });
    createReadStream(file).pipe(res);
  });
  server.listen(0, '127.0.0.1', () => resolve({
    server, url: `http://127.0.0.1:${server.address().port}/index.html`,
  }));
});

/** The launcher's height, with the panel's own children broken out. */
const panelHeight = () => {
  const panel = document.getElementById('menu-panel');
  return {
    panel: Math.round(panel.getBoundingClientRect().height),
    parts: [...panel.children].map((e) => ({
      id: e.id || e.tagName.toLowerCase(),
      h: Math.round(e.getBoundingClientRect().height),
    })),
  };
};

/**
 * Open the modal and measure it. Returns nulls when the page has no Load
 * button, which is what the baseline page looks like.
 */
const modalBox = () => {
  const button = document.getElementById('load-btn');
  const dialog = document.getElementById('load-modal');
  if (!button || !dialog) return null;
  button.click();
  const box = dialog.getBoundingClientRect();
  return {
    open: !!dialog.open,
    w: Math.round(box.width),
    h: Math.round(box.height),
    fitsHeight: box.height <= window.innerHeight,
    fitsWidth: box.width <= window.innerWidth,
    // The bullet is about the modal, so this is the dialog's own overflow and
    // not the page's: the launcher behind it is taller than a phone and
    // always was.
    scrolls: dialog.scrollHeight > dialog.clientHeight + 1,
    presets: document.querySelectorAll('#load-modal .states > .state').length,
    hasOwnGroup: !!document.getElementById('own-states'),
    hasSave: !!document.getElementById('state-save'),
    // The disc line must be outside the modal, which is the third bullet.
    discOutside: !!document.getElementById('disc-state')
      && !dialog.contains(document.getElementById('disc-state')),
  };
};

const WIDTH = 390;
const HEIGHT = 844;

const browser = await pw.chromium.launch();
const measure = async (url) => {
  const page = await (await browser.newContext({
    viewport: { width: WIDTH, height: HEIGHT },
  })).newPage();
  const errors = [];
  page.on('pageerror', (e) => {
    // The engine's WebGPU refusal is expected on a headless host and is not a
    // layout fault. Everything else is.
    if (!/WebGPU|requestAdapter/.test(String(e))) errors.push(String(e));
  });
  await page.goto(url);
  // The lobby and the settings form are built by a module, and the panel is
  // only its final height once they have run.
  await page.waitForSelector('#lobby-bar', { timeout: 10000 }).catch(() => {});
  await page.waitForTimeout(400);
  const height = await page.evaluate(panelHeight);
  const modal = await page.evaluate(modalBox);
  return { ...height, modal, errors };
};

const before = await serve(base);
const after = await serve(join(root, 'platforms/browser'));
const was = await measure(before.url);
const now = await measure(after.url);
await browser.close();
before.server.close();
after.server.close();

const parts = (m) => m.parts.map((p) => `${p.id} ${p.h}`).join(', ');
console.log(`before: #menu-panel ${was.panel}px at ${WIDTH}px wide (${parts(was)})`);
console.log(`after:  #menu-panel ${now.panel}px at ${WIDTH}px wide (${parts(now)})`);

const m = now.modal;
if (m) {
  console.log(`modal:  ${m.w}x${m.h} in a ${WIDTH}x${HEIGHT} viewport, `
    + `${m.presets} presets, own group ${m.hasOwnGroup}, save ${m.hasSave}`);
}

const problems = [
  now.errors.length ? `page errors after: ${now.errors.join('; ')}` : '',
  was.errors.length ? `page errors before: ${was.errors.join('; ')}` : '',
  // Bullet 4, first half. Equal is not shorter: the Load button has to pay
  // for the line it added.
  now.panel >= was.panel
    ? `the launcher is not shorter at ${WIDTH}px: ${was.panel} -> ${now.panel}` : '',
  // Bullet 1: the chip is gone and Load is in its place.
  !m ? 'no #load-btn and #load-modal on the page' : '',
  m && !m.open ? 'pressing Load did not open the modal' : '',
  // Bullet 2.
  m && m.presets !== 4 ? `${m.presets} preset tiles, not 4` : '',
  m && !m.hasOwnGroup ? 'the modal has no group for the player\'s own saves' : '',
  m && !m.hasSave ? 'the modal has no Save current state action' : '',
  // Bullet 3.
  m && !m.discOutside ? 'the disc line is missing, or is inside the modal' : '',
  // Bullet 4, second half.
  m && !m.fitsHeight ? `the modal is ${m.h}px tall in a ${HEIGHT}px viewport` : '',
  m && !m.fitsWidth ? `the modal is ${m.w}px wide in a ${WIDTH}px viewport` : '',
  m && m.scrolls ? 'the modal scrolls at a phone size' : '',
].filter(Boolean);

if (problems.length) {
  console.log(`FAIL launcher-layout: ${problems.join('; ')}`);
  process.exit(1);
}
console.log(`PASS launcher-layout: ${was.panel - now.panel}px shorter at `
  + `${WIDTH}px, modal fits ${WIDTH}x${HEIGHT} without scrolling`);
