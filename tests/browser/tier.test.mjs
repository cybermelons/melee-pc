// SPDX-License-Identifier: GPL-3.0-or-later
// The control tier toggle. Hand-written stubs rather than jsdom: the module
// touches three globals only (document.body.classList, localStorage and the
// host element), and a real DOM would hide which of them it depends on.
import test from 'node:test';
import assert from 'node:assert/strict';

function stubBody() {
  const set = new Set();
  return {
    set,
    classList: {
      add(c) { set.add(c); },
      remove(c) { set.delete(c); },
      contains(c) { return set.has(c); },
      toggle(c, on) { if (on) set.add(c); else set.delete(c); },
    },
  };
}

// `store` null makes every access throw, which is what a private window and
// blocked site data both do.
function install(store, { stored } = {}) {
  const body = stubBody();
  const host = { children: [], append(...kids) { host.children.push(...kids); } };
  globalThis.document = {
    body,
    createElement: () => ({
      attrs: {}, textContent: '', type: '', id: '',
      setAttribute(n, v) { this.attrs[n] = v; },
      getAttribute(n) { return this.attrs[n]; },
      addEventListener(type, fn) { if (type === 'click') this.click = fn; },
    }),
  };
  const data = new Map(stored ? [['melee.tier', stored]] : []);
  globalThis.localStorage = store === null ? {
    getItem() { throw new Error('blocked'); },
    setItem() { throw new Error('blocked'); },
  } : {
    getItem: (k) => (data.has(k) ? data.get(k) : null),
    setItem: (k, v) => data.set(k, String(v)),
  };
  return { body, host, data };
}

test('a new visitor gets tier 1, and the label offers more buttons', async () => {
  const { body, host } = install({});
  const { addTierToggle } = await import('../../platforms/browser/tier.mjs');
  const button = addTierToggle(host);
  assert.ok(body.classList.contains('tier1'), 'tier 1 is the default');
  assert.equal(button.textContent, 'More buttons');
  // aria-pressed tracks tier 2, so the control reads as off in tier 1.
  assert.equal(button.getAttribute('aria-pressed'), 'false');
  assert.equal(host.children.length, 1, 'the toggle went into the panel');
});

test('the toggle flips the tier live and relabels itself', async () => {
  const { body, data } = install({});
  const host = { children: [], append(...k) { host.children.push(...k); } };
  const { addTierToggle } = await import('../../platforms/browser/tier.mjs');
  const button = addTierToggle(host);

  button.click();
  assert.equal(body.classList.contains('tier1'), false, 'now tier 2');
  assert.equal(button.textContent, 'Fewer buttons');
  assert.equal(button.getAttribute('aria-pressed'), 'true');
  // Remembered, so a returning player keeps the tier they went looking for.
  assert.equal(data.get('melee.tier'), '2');

  button.click();
  assert.ok(body.classList.contains('tier1'), 'back to tier 1');
  assert.equal(button.textContent, 'More buttons');
  assert.equal(data.get('melee.tier'), '1');
});

test('a stored tier 2 is restored before the game starts', async () => {
  const { body } = install({}, { stored: '2' });
  const host = { children: [], append(...k) { host.children.push(...k); } };
  const { addTierToggle } = await import('../../platforms/browser/tier.mjs');
  const button = addTierToggle(host);
  assert.equal(body.classList.contains('tier1'), false, 'restored tier 2');
  assert.equal(button.textContent, 'Fewer buttons');
});

test('blocked site data still applies a tier', async () => {
  // localStorage throws in a private window. The overlay must not be left
  // with no tier at all, which would show every control to a new visitor.
  const { body } = install(null);
  const host = { children: [], append(...k) { host.children.push(...k); } };
  const { addTierToggle } = await import('../../platforms/browser/tier.mjs');
  const button = addTierToggle(host);
  assert.ok(body.classList.contains('tier1'), 'fell back to tier 1');
  // And a press still works for this page's lifetime, even though it cannot
  // be remembered.
  button.click();
  assert.equal(body.classList.contains('tier1'), false, 'flipped anyway');
});

test('a missing panel does not throw, and the tier still applies', async () => {
  // The page can lack #menu-panel; the overlay must degrade rather than throw
  // and take the whole shell down with it.
  const { body } = install({}, { stored: '2' });
  const { addTierToggle } = await import('../../platforms/browser/tier.mjs');
  assert.equal(addTierToggle(null), null);
  assert.equal(body.classList.contains('tier1'), false, 'tier applied anyway');
});
