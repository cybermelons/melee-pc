// SPDX-License-Identifier: GPL-3.0-or-later
// The issue board positions every pin from a measurement taken in the
// browser, so the generator cannot see its own layout failures.
//
//   . tools/display.sh && run_headless node tests/browser/progress-layout.mjs
//
// What this catches that build.py cannot:
//  - a pin whose anchor resolves to nothing at runtime, which leaves the
//    label stranded with no dot and no line;
//  - two labels on top of each other, which the stacker is supposed to
//    prevent and which looks like a styling quirk rather than a fault;
//  - a label column pushed off the page, which shows up only as a sideways
//    scrollbar and is invisible in a screenshot of the board itself.
//
// Do not pipe the run into grep to tidy the compositor's output. The exit
// status then comes from grep, and a failure reports success. Redirect
// stderr to a file instead if the noise is in the way.
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const require = createRequire(process.env.PLAYWRIGHT_FROM || '/home/kiri/repos/melee-web/');
const pw = require('playwright');

const page = `file://${path.join(root, 'docs/site/progress.html')}`;
// The three-column board, and the one-column fallback below 1320px. 390 is a
// phone, where the board must still read as a list.
const SIZES = [[1420, 1000, 'wide'], [1100, 900, 'narrow'], [390, 800, 'phone']];

const measure = () => {
  const pins = [...document.querySelectorAll('.pin')];
  const box = pins.map((a) => ({ n: a.querySelector('.pin-n').textContent, r: a.getBoundingClientRect() }));
  const overlaps = [];
  for (let i = 0; i < box.length; i += 1) {
    for (let j = i + 1; j < box.length; j += 1) {
      const a = box[i].r; const b = box[j].r;
      if (a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom) {
        overlaps.push(`${box[i].n} over ${box[j].n}`);
      }
    }
  }
  // Every pin names an element in the mockup. build.py rejects an anchor it
  // cannot find in the markup, so a miss here means the page shipped with a
  // pin that points at nothing.
  const stage = document.getElementById('stage');
  const orphans = pins
    .filter((a) => !stage.querySelector(a.dataset.anchor))
    .map((a) => a.dataset.anchor);
  // A label that starts off the left edge is unreachable. The first layout
  // hung both columns off a centred stage and did exactly this.
  const offpage = box.filter((b) => b.r.left < 0 || b.r.right > window.innerWidth)
    .map((b) => b.n);
  const wide = getComputedStyle(document.getElementById('leads')).display !== 'none';
  // Narrow keeps the dots on the mockup and shows a label only when its dot
  // is tapped. The earlier fallback printed the labels as a list instead,
  // which is the one shape this page must not take.
  const shown = box.filter((b) => b.r.width > 0 && b.r.height > 0).length;
  return {
    count: pins.length,
    dots: document.querySelectorAll('.dot').length,
    lines: document.querySelectorAll('#leads line').length,
    wide,
    shown,
    overlaps,
    orphans,
    offpage,
    hscroll: document.documentElement.scrollWidth > window.innerWidth,
  };
};

// Switching a tab must not move anything. Every pane shares one grid cell,
// so the stack is as tall as the tallest pane. Before that, the pane went
// 244px to 100px and the Apply button jumped 144px between two tabs.
const tabShift = () => {
  const seen = [];
  for (const tab of document.querySelectorAll('.tab')) {
    tab.click();
    const apply = document.getElementById('settings-apply').getBoundingClientRect();
    seen.push({ t: tab.textContent.trim(), y: Math.round(apply.top) });
  }
  const ys = [...new Set(seen.map((s) => s.y))];
  return ys.length > 1 ? seen.map((s) => `${s.t}:${s.y}`).join(' ') : '';
};

// A pin whose control sits on a pane that is not in front must be a ghost,
// and so must its dot. The expected set is computed from the markup alone
// (closest('.pane.off')), not from the page's own visibility check.
const ghostCheck = () => {
  const stage = document.getElementById('stage');
  const pins = [...document.querySelectorAll('.pin')];
  const want = pins.filter((a) => stage.querySelector(a.dataset.anchor)?.closest('.pane.off')).length;
  const got = pins.filter((a) => a.classList.contains('ghost')).length;
  const dots = document.querySelectorAll('.dot.ghost').length;
  return { want, got, dots };
};

const browser = await pw.chromium.launch();
let bad = 0;
for (const [width, height, tag] of SIZES) {
  const p = await (await browser.newContext({ viewport: { width, height } })).newPage();
  const errors = [];
  p.on('pageerror', (e) => errors.push(String(e)));
  p.on('console', (m) => { if (m.type() === 'error') errors.push(`console: ${m.text()}`); });
  await p.goto(page);
  // The labels are text, so the stacker re-runs once the fonts settle.
  await p.waitForTimeout(400);
  const m = await p.evaluate(measure);
  if (!m.wide) {
    // Tap the first dot: exactly one label must open.
    m.tapped = await p.evaluate(() => {
      document.querySelector('.dot').click();
      return [...document.querySelectorAll('.pin')]
        .filter((a) => a.getBoundingClientRect().height > 0).length;
    });
  }
  const ghostProblems = [];
  const g0 = await p.evaluate(ghostCheck);
  if (g0.want === 0) ghostProblems.push('no pins anchored behind an off tab on load: nothing to ghost');
  if (g0.got !== g0.want) ghostProblems.push(`${g0.got} ghost pins on load, ${g0.want} anchored in an off pane`);
  if (g0.dots !== g0.want) ghostProblems.push(`${g0.dots} ghost dots on load, ${g0.want} expected`);
  const tabCount = await p.evaluate(() => document.querySelectorAll('.tab').length);
  for (let i = 0; i < tabCount; i += 1) {
    await p.locator('.tab').nth(i).click();
    const g = await p.evaluate(ghostCheck);
    if (g.got !== g.want || g.dots !== g.want) {
      ghostProblems.push(`tab ${i}: ${g.got} ghost pins, ${g.dots} ghost dots, ${g.want} expected`);
    }
  }
  // Back to the default tab so the hover check and tabShift start as before.
  await p.locator('.tab').first().click();

  if (m.wide) {
    // Hover the first label that is not a ghost: its dot, its line and its
    // control light up, and nothing else does.
    const idx = await p.evaluate(() => [...document.querySelectorAll('.pin')]
      .findIndex((a) => !a.classList.contains('ghost')));
    await p.locator('.pin').nth(idx).hover();
    const hot = await p.evaluate((i) => {
      const pin = document.querySelectorAll('.pin')[i];
      const el = document.getElementById('stage').querySelector(pin.dataset.anchor);
      return {
        pin: pin.classList.contains('hot'),
        dot: document.querySelectorAll('.dot')[i].classList.contains('hot'),
        line: document.querySelectorAll('#leads line')[i].classList.contains('hot'),
        target: el.classList.contains('hot-target'),
        targets: document.querySelectorAll('.hot-target').length,
      };
    }, idx);
    if (!hot.pin || !hot.dot || !hot.line) ghostProblems.push(`hover left pin/dot/line hot: ${hot.pin}/${hot.dot}/${hot.line}`);
    if (!hot.target) ghostProblems.push('hover did not mark the anchored control hot-target');
    if (hot.targets !== 1) ghostProblems.push(`${hot.targets} hot-target elements while hovering, expected 1`);
    await p.mouse.move(0, 0);
    const left = await p.evaluate(() => document.querySelectorAll('.hot, .hot-target').length);
    if (left) ghostProblems.push(`${left} hot/hot-target elements remain after the mouse left`);
  }
  const shift = await p.evaluate(tabShift);
  const problems = [
    ...ghostProblems,
    shift ? `a tab switch moves the panel: ${shift}` : '',
    m.count === 0 ? 'no pins rendered' : '',
    m.orphans.length ? `pins anchored to nothing: ${m.orphans.join(', ')}` : '',
    m.wide && m.lines !== m.count ? `${m.count} pins but ${m.lines} leader lines` : '',
    m.overlaps.length ? `labels overlap: ${m.overlaps.join(', ')}` : '',
    // Every dot must be on the mockup at every width.
    m.dots !== m.count ? `${m.count} pins but ${m.dots} dots` : '',
    !m.wide && m.shown ? `${m.shown} labels visible before any tap` : '',
    !m.wide && m.tapped !== 1 ? `a dot tap showed ${m.tapped} labels` : '',
    m.offpage.length ? `labels off the page: ${m.offpage.join(', ')}` : '',
    m.hscroll ? 'the page scrolls sideways' : '',
    errors.length ? `page errors: ${errors.join('; ')}` : '',
  ].filter(Boolean);
  if (problems.length) {
    bad = 1;
    console.log(`FAIL progress-layout ${tag} (${width}px): ${problems.join('; ')}`);
  } else {
    console.log(`pass ${tag} (${width}px): ${m.count} pins, ${m.dots} dots, ${m.wide ? `${m.lines} lines, ` : 'tap-to-read, '}no overlap, nothing off-page`);
  }
}
await browser.close();
if (!bad) console.log('PASS progress-layout');
process.exit(bad);
