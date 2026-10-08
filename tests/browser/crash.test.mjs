// SPDX-License-Identifier: GPL-3.0-or-later
// An abort is the one failure a player cannot diagnose: the canvas simply
// stops. onAbort used to write the reason to #status, which body.playing
// hides, so the reason never reached the screen. These check that it does.
import test from 'node:test';
import assert from 'node:assert/strict';
import { showCrash } from '../../platforms/browser/crash.mjs';

// Enough of the DOM for the panel: the four elements it writes to, a body
// class list, and the log it quotes into the report.
function stubDom({ logText = '' } = {}) {
  const make = (id) => ({
    id, textContent: '', href: '', hidden: true, scrolled: false,
    addEventListener(type, fn) { if (type === 'click') this.handler = fn; },
    scrollIntoView() { this.scrolled = true; },
  });
  const els = new Map(
    ['crash', 'crash-why', 'crash-report', 'crash-reload', 'log'].map((id) => [id, make(id)]));
  els.get('log').textContent = logText;
  const set = new Set(['playing', 'menu']);
  globalThis.document = {
    getElementById: (id) => els.get(id) || null,
    body: {
      classList: {
        set,
        add: (c) => set.add(c),
        remove: (c) => set.delete(c),
        contains: (c) => set.has(c),
      },
    },
  };
  return els;
}

test('the reason reaches the panel, not just the hidden status line', () => {
  const els = stubDom();
  const seen = [];
  showCrash('out of memory', { log: (m) => seen.push(m), status: (m) => seen.push(m) });
  assert.equal(els.get('crash').hidden, false, 'the panel must be shown');
  assert.equal(els.get('crash-why').textContent, 'out of memory');
  assert.ok(seen.some((m) => m.includes('out of memory')), 'the log still gets it');
});

// body.playing hides #log and locks the height. The panel tells the reader to
// copy the log, so the class has to go or the instruction is impossible.
test('the page furniture comes back so the log can be copied', () => {
  stubDom();
  showCrash('boom');
  assert.equal(document.body.classList.contains('playing'), false);
  assert.equal(document.body.classList.contains('menu'), false, 'the menu must not stay open');
});

// A phone mid-game is scrolled to the canvas, and dropping the class reflows
// without moving the viewport.
test('the panel is scrolled into view', () => {
  const els = stubDom();
  showCrash('boom');
  assert.equal(els.get('crash').scrolled, true);
});

test('the report carries the reason and the tail of the log', () => {
  const els = stubDom({ logText: 'A'.repeat(4000) + 'TAILMARK' });
  showCrash('Error: assertion failed');
  const href = els.get('crash-report').href;
  assert.ok(href.startsWith('https://github.com/cybermelons/melee-pc/issues/new?'), href);
  assert.ok(href.includes(encodeURIComponent('Error: assertion failed')), 'reason in the title');
  assert.ok(href.includes(encodeURIComponent('TAILMARK')), 'the end of the log travels');
  // The whole log would overrun a practical URL length.
  assert.ok(!href.includes(encodeURIComponent('A'.repeat(2000))), 'only the tail');
});

// An Error, not a string, is what a wasm abort usually hands over.
test('an Error reason is unwrapped rather than stringified as an object', () => {
  const els = stubDom();
  showCrash(new Error('RuntimeError: unreachable'));
  assert.equal(els.get('crash-why').textContent, 'RuntimeError: unreachable');
});

// Missing markup must not turn a crash report into a second crash.
test('a page without the panel still reports the reason', () => {
  globalThis.document = { getElementById: () => null, body: { classList: { add() {}, remove() {}, contains: () => false } } };
  const seen = [];
  assert.equal(showCrash('boom', { log: (m) => seen.push(m) }), 'boom');
  assert.ok(seen.some((m) => m.includes('boom')));
});
