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
  const problems = [
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
