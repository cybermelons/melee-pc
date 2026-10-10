// SPDX-License-Identifier: GPL-3.0-or-later
// The user's complaint was "p2: gamepad" and "the controller selection makes
// no sense": the tile printed the internal id while the picker printed a
// readable name. Driven through the real UI rather than the unit test, because
// the unit test calls sourceLabel directly and cannot see what a click paints.
import { createRequire } from 'node:module';
const require = createRequire(process.env.PLAYWRIGHT_FROM || '/home/kiri/repos/melee-web/');
const { chromium } = require('playwright');
const BASE = process.env.BASE || 'http://127.0.0.1:8131/';
let browser;
const out = [];
let allOk = true;
const check = (ok, msg) => { out.push(`${ok ? 'ok  ' : 'FAIL'} ${msg}`); allOk = allOk && ok; return ok; };
try {
  browser = await chromium.launch();
  const p = await (await browser.newContext()).newPage();
  await p.goto(BASE, { waitUntil: 'domcontentloaded' });
  await p.waitForFunction(() => !!document.querySelector('#port-2 .cbtn'));

  // The connect button must say a word, not a glyph.
  const cb = (await p.$eval('#port-2 .cbtn', (e) => e.textContent)).trim();
  check(cb === 'Pad', `port 2 connect button reads a word, got ${JSON.stringify(cb)}`);
  check(!!(await p.$eval('#port-2 .cbtn', (e) => e.title)), 'connect button keeps its title');

  // Every port starts with an em dash, so the tile does not change height.
  const start = (await p.$eval('#port-2 .psrc', (e) => e.textContent)).trim();
  check(start === '—', `port 2 source starts as an em dash, got ${JSON.stringify(start)}`);

  // Open the picker and read the menu entries. These are the readable names.
  await p.click('#port-2 .cbtn');
  const menu = await p.$$eval('#port-2 .psrc-pick', (es) => es.map((e) => e.textContent.trim()));
  check(menu.length > 0, `picker offers sources: ${JSON.stringify(menu)}`);
  check(!menu.includes('gamepad') && !menu.includes('touch') && !menu.includes('adapter'),
    `picker must not print raw ids, got ${JSON.stringify(menu)}`);

  // Pick the pad entry if this engine offers it, else whatever is last.
  const want = menu.find((m) => /pad/i.test(m)) ?? menu[menu.length - 1];
  await p.click(`#port-2 .psrc-pick >> text="${want}"`);

  // The decisive assertion: the tile now prints the SAME string the menu did.
  // Before the fix it printed the id, so this is what the user reported.
  await p.waitForFunction(
    (w) => document.querySelector('#port-2 .psrc').textContent.trim() === w, want, { timeout: 4000 },
  ).catch(() => {});
  const tile = (await p.$eval('#port-2 .psrc', (e) => e.textContent)).trim();
  check(tile === want, `tile prints the picker's own label: menu said ${JSON.stringify(want)}, tile says ${JSON.stringify(tile)}`);
  check(!/^(gamepad|touch|adapter)$/.test(tile), `tile must not print a raw id, got ${JSON.stringify(tile)}`);
} catch (e) {
  out.push(`FAIL ${e.message}`);
  allOk = false;
}
await browser?.close();
console.log(out.join('\n'));
console.log(allOk ? 'PASS pad-ui' : 'FAIL pad-ui');
process.exit(allOk ? 0 : 1);
