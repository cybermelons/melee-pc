// SPDX-License-Identifier: GPL-3.0-or-later
// The overlay's job is to turn finger positions into a GameCube pad state, so
// that mapping is what this checks: the requested button layout reaches the
// right pad bits, the stick scales to the raw units Melee thresholds against,
// and a lifted or cancelled touch cannot leave a button held.
import test from 'node:test';
import assert from 'node:assert/strict';

// What a GC adapter reports at full deflection, and what Melee's dash, tilt
// and light-shield thresholds are expressed in.
const STICK_MAX = 80;

// Enough of the DOM for the overlay: elements with a class list, a bounding
// box and pointer-event listeners. jsdom would do the same and is not a
// dependency this repo has.
function stubDom(boxes) {
  const handlers = new Map();
  const make = (tag) => {
    const el = {
      tagName: tag, id: '', className: '', textContent: '', style: {},
      children: [], hidden: true,
      classList: {
        set: new Set(),
        add(c) { this.set.add(c); },
        remove(c) { this.set.delete(c); },
        contains(c) { return this.set.has(c); },
      },
      append(...kids) { el.children.push(...kids); for (const k of kids) k.parent = el; },
      addEventListener(type, fn) { handlers.set(type, fn); },
      setPointerCapture() {},
      getBoundingClientRect() { return boxes[el.id] || { left: 0, top: 0, width: 100, height: 100 }; },
      // The real closest() walks up to the nearest .pad; a control's nub has
      // to resolve to its owning control, which is what this mirrors.
      closest(sel) {
        assert.equal(sel, '.pad');
        for (let node = el; node; node = node.parent) {
          if (String(node.className).startsWith('pad')) return node;
        }
        return null;
      },
    };
    return el;
  };
  const root = make('div');
  root.className = 'root';
  globalThis.document = {
    getElementById: (id) => (id === 'touch' ? root : null),
    createElement: make,
  };
  return { root, handlers };
}

// Records what crossed into C. The overlay is only correct in terms of these
// arguments, because they are all the engine ever sees of it.
function stubModule() {
  const calls = [];
  return {
    calls,
    _pc_touch_set_active(on) { calls.push(['active', on]); },
    _pc_touch_set_pad(...args) { calls.push(['pad', ...args]); },
  };
}

const lastPad = (mod) => mod.calls.filter((c) => c[0] === 'pad').at(-1);
const down = (h, target, x, y) =>
  h.get('pointerdown')({ target, pointerId: 1, clientX: x, clientY: y, preventDefault() {} });
const up = (h, type, target) =>
  h.get(type)({ target, pointerId: 1, preventDefault() {} });

async function load(boxes) {
  const dom = stubDom(boxes);
  const { createTouchOverlay } = await import('../../platforms/browser/touch.mjs');
  const mod = stubModule();
  createTouchOverlay(mod, null);
  const byId = new Map(dom.root.children.map((el) => [el.id, el]));
  return { ...dom, mod, byId };
}

test('the requested layout maps to the GameCube pad bits', async () => {
  const { handlers, mod, byId } = await load({});
  // Button, then the bit dolphin/pad.h gives it. A and B are the face buttons,
  // Y stays jump, and R is a trigger even though it sits where X would.
  for (const [id, bit] of [['a', 0x0100], ['b', 0x0200], ['y', 0x0800], ['z', 0x0010]]) {
    down(handlers, byId.get(`pad-${id}`), 0, 0);
    assert.equal(lastPad(mod)[1] & bit, bit, id);
    up(handlers, 'pointerup', byId.get(`pad-${id}`));
    assert.equal(lastPad(mod)[1], 0, `${id} released`);
  }
  // A shoulder is a trigger, not a button bit: a digital press sends the full
  // 255 so it is a hard shield rather than a light one.
  down(handlers, byId.get('pad-l'), 0, 0);
  assert.equal(lastPad(mod)[6], 255, 'L trigger');
  up(handlers, 'pointerup', byId.get('pad-l'));
  down(handlers, byId.get('pad-r'), 0, 0);
  assert.equal(lastPad(mod)[7], 255, 'R trigger');
});

test('A on top of the C-stick presses A and does not aim the C-stick', async () => {
  // A is drawn over the middle of the C-stick ring, so the hit test has to
  // pick A. If it picked the ring, every A press would also throw a smash.
  const { handlers, mod, byId } = await load({});
  down(handlers, byId.get('pad-a'), 0, 0);
  const pad = lastPad(mod);
  assert.equal(pad[1] & 0x0100, 0x0100, 'A pressed');
  assert.deepEqual([pad[4], pad[5]], [0, 0], 'C-stick centred');
});

test('the stick reaches the raw units Melee thresholds against', async () => {
  // A 100x100 ring at the origin: centre (50,50), radius 50.
  const boxes = { 'pad-stick': { left: 0, top: 0, width: 100, height: 100 } };
  const { handlers, mod, byId } = await load(boxes);
  const stick = byId.get('pad-stick');

  // Full deflection right is +80, the same value the GC adapter reports.
  down(handlers, stick, 100, 50);
  assert.deepEqual([lastPad(mod)[2], lastPad(mod)[3]], [80, 0], 'right');

  // Up is positive on the pad and negative on the screen.
  handlers.get('pointermove')({ pointerId: 1, clientX: 50, clientY: 0, preventDefault() {} });
  assert.deepEqual([lastPad(mod)[2], lastPad(mod)[3]], [0, 80], 'up');

  // Beyond the ring the magnitude is clamped as a vector, so a diagonal cannot
  // reach further than a cardinal does. A true 45 degrees from the centre
  // (50,50), far outside the radius: both axes land on 80/sqrt(2) = 57.
  handlers.get('pointermove')({ pointerId: 1, clientX: 550, clientY: -450, preventDefault() {} });
  const diag = lastPad(mod);
  assert.deepEqual([diag[2], diag[3]], [57, 57], 'clamped diagonal');
  assert.ok(Math.hypot(diag[2], diag[3]) <= STICK_MAX + 1, 'no further than a cardinal');

  // Inside the deadzone a resting thumb reads as centred rather than walking.
  handlers.get('pointermove')({ pointerId: 1, clientX: 55, clientY: 50, preventDefault() {} });
  assert.deepEqual([lastPad(mod)[2], lastPad(mod)[3]], [0, 0], 'deadzone');

  // Releasing recentres, so a lifted thumb does not keep the stick held over.
  down(handlers, stick, 100, 50);
  up(handlers, 'pointerup', stick);
  assert.deepEqual([lastPad(mod)[2], lastPad(mod)[3]], [0, 0], 'released');
});

test('a cancelled touch releases, so no button stays held', async () => {
  // An incoming call ends a touch with pointercancel and never pointerup. A
  // missed one holds the button down for the rest of the match.
  const { handlers, mod, byId } = await load({});
  down(handlers, byId.get('pad-a'), 0, 0);
  assert.notEqual(lastPad(mod)[1], 0);
  up(handlers, 'pointercancel', byId.get('pad-a'));
  assert.equal(lastPad(mod)[1], 0);
});

test('the pad is claimed once, and only after a real touch', async () => {
  // Claiming it at load would override a keyboard on a device that has both.
  const { handlers, mod, byId } = await load({});
  assert.deepEqual(mod.calls, [], 'idle overlay stays quiet');
  down(handlers, byId.get('pad-a'), 0, 0);
  up(handlers, 'pointerup', byId.get('pad-a'));
  assert.equal(mod.calls.filter((c) => c[0] === 'active').length, 1);
});
