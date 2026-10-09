// SPDX-License-Identifier: GPL-3.0-or-later
// The issue board places its pins by absolute position, so the layout can
// break in ways the generator cannot see.
//
//   node tests/browser/progress-layout.mjs
//
// build.py reserves PIN_H pixels for the last row of each board. A longer
// annotation makes a pin taller than that, and it then hangs out of the
// bottom of its board or lands on the pin below. Both look like a styling
// quirk and neither fails the build, so only a browser catches them.
//
// Run it under tools/display.sh, which keeps the window off the screen:
//
//   . tools/display.sh && run_headless node tests/browser/progress-layout.mjs
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
// Wide enough for the two-column board, and narrow enough for the one-column
// fallback. The breakpoint is 46rem, so 400 is below it and 1280 is above.
const SIZES = [[1280, 900, 'wide'], [400, 900, 'narrow']];

const measure = () => {
  const pins = [...document.querySelectorAll('.pin')].map((a) => ({
    n: a.querySelector('.num').textContent,
    r: a.getBoundingClientRect(),
  }));
  const overlaps = [];
  for (let i = 0; i < pins.length; i += 1) {
    for (let j = i + 1; j < pins.length; j += 1) {
      const a = pins[i].r; const b = pins[j].r;
      if (a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom) {
        overlaps.push(`${pins[i].n} over ${pins[j].n}`);
      }
    }
  }
  // A pin past the bottom edge of its own board means PIN_H in build.py is
  // now too small for the longest annotation in that area.
  const spills = [];
  document.querySelectorAll('.board').forEach((board) => {
    const edge = board.getBoundingClientRect().bottom;
    board.querySelectorAll('.pin').forEach((a) => {
      const r = a.getBoundingClientRect();
      if (r.bottom > edge + 1) {
        spills.push(`${a.querySelector('.num').textContent} by ${Math.round(r.bottom - edge)}px`);
      }
    });
  });
  return {
    count: pins.length,
    overlaps,
    spills,
    // A horizontal scrollbar on a phone is the usual way an absolute layout
    // fails, and it is invisible in a desktop screenshot.
    hscroll: document.documentElement.scrollWidth > window.innerWidth,
  };
};

const browser = await pw.chromium.launch();
let bad = 0;
for (const [width, height, tag] of SIZES) {
  const p = await (await browser.newContext({ viewport: { width, height } })).newPage();
  const errors = [];
  p.on('pageerror', (e) => errors.push(String(e)));
  await p.goto(page);
  const m = await p.evaluate(measure);
  const problems = [
    m.count === 0 ? 'no pins rendered' : '',
    m.overlaps.length ? `pins overlap: ${m.overlaps.join(', ')}` : '',
    m.spills.length ? `pins hang out of their board: ${m.spills.join(', ')}` : '',
    m.hscroll ? 'the page scrolls sideways' : '',
    errors.length ? `page errors: ${errors.join('; ')}` : '',
  ].filter(Boolean);
  if (problems.length) {
    bad = 1;
    console.log(`FAIL progress-layout ${tag} (${width}px): ${problems.join('; ')}`);
  } else {
    console.log(`pass ${tag} (${width}px): ${m.count} pins, no overlap, none spilling, no sideways scroll`);
  }
}
await browser.close();
if (!bad) console.log('PASS progress-layout');
process.exit(bad);
