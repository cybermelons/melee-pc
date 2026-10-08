// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * MELEE_20XX_RULES must produce the tournament rule set, not the flag alone.
 *
 *   python3 tools/browser/serve.py --port 5191 &
 *   MELEE_ISO=/path/to/GALE01.iso PLAYWRIGHT_MODULE=/path/to/playwright \
 *     node tests/browser/tournament-rules-e2e.mjs
 *
 * The engine reports the whole rule set it installed (gm/gmmain_lib.c), so this
 * asserts the rules a match actually ran under. Reading the flag back, or
 * finding the field in the binary, would pass even when the value never
 * reached the per-mode rules that gm_80167BC8 derives.
 *
 * items=off needs both fields: item_freq stops the spawns, and item_mask is
 * the item switch, which defaults to every item enabled.
 */
import { createRequire } from 'node:module';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';

const { chromium } = createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE || 'playwright');
const iso = process.env.MELEE_ISO;
if (!iso) throw Error('Set MELEE_ISO to your own GALE01 disc image.');
const base = process.env.MELEE_TEST_URL || 'http://127.0.0.1:5191/';
const output = path.resolve(process.env.TEST_OUTPUT || 'build/browser/tournament-rules');
await mkdir(output, { recursive: true });

// pause is the one field with an opt-in, so it is checked per case rather than
// in the shared set.
const EXPECTED = {
  stock: '4', time: '8min', items: 'off', item_mask: '0',
  stage_sel: '0', friendly_fire: '1', handicap: '0', damage_ratio: '10',
};
const all = [
  { name: 'tournament', env: { MELEE_20XX_RULES: '1' }, pause: '0' },
  // A lone player still needs a way to stop a match, so pausing is opt-in.
  { name: 'tournament-pause', env: { MELEE_20XX_RULES: '1', MELEE_PAUSE: '1' }, pause: '1' },
];
// One case per process by default. A second engine run in the same cage
// session loses the Vulkan swapchain ("X connection error received", GPU
// process restart), which fails the case for a reason unrelated to the rules.
// Pass case names to pick them, as shell-e2e.mjs does.
const cases = process.argv.length > 2
  ? all.filter((c) => process.argv.slice(2).includes(c.name))
  : all.slice(0, 1);

// Bundled Chromium, not channel 'chrome': this host has no Google Chrome.
// headless has no WebGPU adapter, so cage provides the isolation instead
// (tools/display.sh).
const browser = await chromium.launch({
  headless: false,
  args: ['--no-sandbox', '--enable-unsafe-webgpu', '--enable-features=Vulkan',
    '--ignore-gpu-blocklist', '--ozone-platform=x11', '--mute-audio'],
});
const failures = [];
try {
  for (const test of cases) {
    const context = await browser.newContext({ viewport: { width: 1000, height: 1000 } });
    const page = await context.newPage();
    const logs = [];
    page.on('console', (m) => logs.push(m.text()));
    page.on('pageerror', (e) => logs.push('PAGEERROR ' + e.message));
    try {
      const url = new URL(base);
      const env = { MELEE_SEED: '1', MELEE_SCENE_LOG: '1', MELEE_BOOT_SCENE: 'vs', ...test.env };
      for (const [k, v] of Object.entries(env)) url.searchParams.set(k, v);
      await page.goto(url.href);
      await page.locator('#disc').setInputFiles(iso);
      await page.waitForFunction(() => !document.querySelector('#start').disabled, null, { timeout: 60000 });
      await page.locator('#start').click();
      await page.waitForFunction(() => window.meleeFrames.count >= 120, null, { timeout: 180000 });
      await page.screenshot({ path: path.join(output, `${test.name}.png`) });

      const line = logs.find((l) => l.includes('20xx rules:'));
      if (!line) throw Error('no "20xx rules:" report; the 20XX block did not run');
      const expect = { ...EXPECTED, pause: test.pause };
      for (const [key, want] of Object.entries(expect)) {
        if (!new RegExp(`\\b${key}=${want}\\b`).test(line)) {
          throw Error(`${key}=${want} missing from: ${line.trim()}`);
        }
      }
      console.log(`PASS ${test.name}: ${line.trim()}`);
    } catch (error) {
      failures.push(`${test.name}: ${error.message}`);
      console.log(`FAIL ${test.name}: ${error.message}`);
      console.log(logs.slice(-15).join('\n'));
      await page.screenshot({ path: path.join(output, `${test.name}-failed.png`) }).catch(() => {});
    }
    await context.close();
  }
} finally {
  await browser.close();
}
if (failures.length) { console.log('FAILURES:\n' + failures.join('\n')); process.exitCode = 1; }
else console.log('PASS: MELEE_20XX_RULES installs the tournament rule set, items off');
