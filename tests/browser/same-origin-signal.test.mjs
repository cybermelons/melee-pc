// SPDX-License-Identifier: GPL-3.0-or-later
// A shared link must pair with no extra setup by the visitor. The page client
// defaults to the signaling on its own origin, so the page server has to mount
// it at that same path. If the two disagree, the room buttons appear and
// nothing behind them works, which looks like a WebRTC fault rather than a
// routing one.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const PREFIX = '/signal';

test('the page client and the page server agree on the signaling path', () => {
  const shell = fs.readFileSync(path.join(ROOT, 'platforms/browser/shell.mjs'), 'utf8');
  const client = /get\('signal'\)\s*\|\|\s*'([^']+)'/.exec(shell);
  assert.ok(client, 'shell.mjs must have a default signaling base');
  assert.equal(client[1], PREFIX,
    'the default must be a path on this origin: a visitor sent a link has no '
    + 'reason to have a second port reachable, and an http:// request from an '
    + 'https:// page is blocked as mixed content');
});

test('the page server answers signaling on that path', async () => {
  const dir = fs.mkdtempSync('/tmp/melee-serve-');
  fs.writeFileSync(path.join(dir, 'index.html'), '<!doctype html>ok');
  const port = 8461;
  const srv = spawn(process.execPath, [path.join(ROOT, 'tools/browser/serve.mjs'), dir],
    { env: { ...process.env, PORT: String(port) }, stdio: 'ignore' });
  try {
    const base = `http://127.0.0.1:${port}`;
    for (let i = 0; i < 40; i++) {
      try { await fetch(base + '/index.html'); break; } catch { await new Promise((r) => setTimeout(r, 100)); }
    }
    // The room endpoint under the client's default prefix must reach the
    // signaling handler, not the static file handler. A 404 here is the bug.
    const ctl = new AbortController();
    const res = await fetch(`${base}${PREFIX}/r/t1/events?me=a`, { signal: ctl.signal });
    assert.equal(res.status, 200, `${PREFIX} must be served by the signaling handler`);
    assert.match(res.headers.get('content-type') || '', /text\/event-stream/);
    ctl.abort();
  } finally {
    srv.kill('SIGKILL');
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
