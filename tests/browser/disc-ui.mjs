// SPDX-License-Identifier: GPL-3.0-or-later
// Checks the two things the plan left unverified: that :has() actually folds
// the "Load disc" label away when shell.mjs hides the input, and that a click
// on the label still reaches the clipped input.
import { createRequire } from 'node:module';
const require = createRequire(process.env.PLAYWRIGHT_FROM || '/home/kiri/repos/melee-web/');
const { chromium } = require('playwright');
const BASE = process.env.BASE || 'http://127.0.0.1:8131/';
let browser;
const out = [];
const check = (ok, msg) => { out.push(`${ok ? 'ok  ' : 'FAIL'} ${msg}`); return ok; };
let allOk = true;
try {
  browser = await chromium.launch();
  const p = await (await browser.newContext()).newPage();
  await p.goto(BASE, { waitUntil: 'domcontentloaded' });
  await p.waitForSelector('#disc-label', { state: 'attached' });

  // 1. native chrome gone: the label's text is ours, not the UA's.
  const txt = (await p.$eval('#disc-label', (e) => e.textContent)).trim();
  allOk = check(txt === 'Load disc', `label text is "Load disc", got ${JSON.stringify(txt)}`) && allOk;

  // 2. the input is clipped but still rendered (a label forwards a click only
  //    to a rendered input), and the label is visible.
  const vis = await p.evaluate(() => {
    const i = document.getElementById('disc');
    const l = document.getElementById('disc-label');
    const ci = getComputedStyle(i);
    const cl = getComputedStyle(l);
    return { inputDisplay: ci.display, inputOpacity: ci.opacity, labelDisplay: cl.display,
             inputBox: i.getBoundingClientRect().width, labelBox: l.getBoundingClientRect().width };
  });
  allOk = check(vis.inputDisplay !== 'none', `input must stay rendered, display=${vis.inputDisplay}`) && allOk;
  allOk = check(vis.labelDisplay !== 'none' && vis.labelBox > 40, `label visible, display=${vis.labelDisplay} w=${vis.labelBox}`) && allOk;

  // 3. the click reaches the input. A real file dialog cannot be driven, so
  //    the proof is that the browser fires the picker at all: Playwright
  //    surfaces that as a filechooser event.
  const chooser = p.waitForEvent('filechooser', { timeout: 4000 }).then(() => true).catch(() => false);
  await p.click('#disc-label');
  allOk = check(await chooser, 'clicking the label opens the file picker') && allOk;

  // 4. :has() folds the label away exactly as shell.mjs:344 would.
  await p.evaluate(() => { document.getElementById('disc').hidden = true; });
  const hid = await p.$eval('#disc-label', (e) => getComputedStyle(e).display);
  allOk = check(hid === 'none', `:has(input[hidden]) must hide the label, display=${hid}`) && allOk;

  // 5. and the disabled rule from shell.mjs:289.
  await p.evaluate(() => { const i = document.getElementById('disc'); i.hidden = false; i.disabled = true; });
  const dis = await p.$eval('#disc-label', (e) => getComputedStyle(e).opacity);
  allOk = check(Number(dis) < 1, `:has(input:disabled) must dim the label, opacity=${dis}`) && allOk;

  // 6. :has() support itself, stated rather than assumed.
  const sup = await p.evaluate(() => CSS.supports('selector(:has(input))'));
  allOk = check(sup, 'this engine supports :has()') && allOk;
} catch (e) {
  out.push(`FAIL ${e.message}`);
  allOk = false;
}
await browser?.close();
console.log(out.join('\n'));
console.log(allOk ? 'PASS disc-ui' : 'FAIL disc-ui');
process.exit(allOk ? 0 : 1);
