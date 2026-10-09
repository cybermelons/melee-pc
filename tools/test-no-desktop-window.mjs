// SPDX-License-Identifier: GPL-3.0-or-later
// Guard the rule in CLAUDE.md: no test may open a window on this host's screen.
//
// Static check over every chromium.launch() in the repo. It fails on the three
// ways a window has reached the desktop here:
//   - headless: false         -> a window with no opt-out
//   - a missing headless key  -> the default is not stated, so it can drift
//   - --ozone-platform=x11    -> Chromium leaves Wayland for the X server and
//                                escapes cage, so the window lands on the desk
//
//   node tools/test-no-desktop-window.mjs
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

// Tracked files only. A gitignored `tmp_*.mjs` is a one-off scratch script by
// the repo's own convention, so it never reaches another machine and this check
// cannot hold it to the rule. Failing on local scratch would only teach people
// to skip the check.
const files = execFileSync('git', ['ls-files', '-z', '*.mjs', '*.js'], { encoding: 'utf8' })
  .split('\0').filter(Boolean);

const OK_HEADLESS = /headless:\s*(true|process\.env\.HEADLESS\s*!==\s*'0')/;
const fails = [];
for (const f of files) {
  if (f.endsWith('test-no-desktop-window.mjs')) continue;
  const s = readFileSync(f, 'utf8');
  if (!/chromium\.launch\(/.test(s)) continue;
  if (/headless:\s*false/.test(s)) fails.push(`${f}: literal 'headless: false'`);
  else if (!OK_HEADLESS.test(s)) fails.push(`${f}: no stated headless default`);
  if (/--ozone-platform=x11/.test(s)) fails.push(`${f}: '--ozone-platform=x11' escapes cage`);
}

if (fails.length) {
  console.error('FAIL: a test can put a window on the desktop:');
  for (const m of fails) console.error('  -', m);
  process.exit(1);
}
console.log(`PASS: ${files.length} files scanned, every chromium.launch() defaults to headless`);
