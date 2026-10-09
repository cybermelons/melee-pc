// SPDX-License-Identifier: GPL-3.0-or-later
// Pairing must send its offer on a network where a STUN server is partly
// unreachable. Every public STUN server publishes an AAAA record, so an
// IPv4-only network leaves one candidate pair pending and ICE gathering never
// reaches 'complete'. Waiting for 'complete' before posting the offer hangs
// the pairing for as long as the browser's own gathering timeout, which is
// minutes. This pins the wait instead.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const shell = readFileSync(path.join(root, 'platforms/browser/shell.mjs'), 'utf8');

test('the offer does not wait for ICE gathering to complete', () => {
  const m = /const gathered = \(pc\) => new Promise\((?:.|\n)*?\n  \}\);/.exec(shell);
  assert.ok(m, 'gathered() not found in shell.mjs');
  assert.match(m[0], /setTimeout/,
    'gathered() resolves only on iceGatheringState === "complete", so a STUN '
    + 'server with an unreachable address stalls the pairing');
});
