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
      addEventListener(type, fn) {
        handlers.set(type, fn);
        // Also kept on the element, so a listener bound to one control rather
        // than delegated at the root can be fired on its own in a test.
        if (type === 'click') el.handler = fn;
      },
      setPointerCapture() {},
      attrs: {},
      setAttribute(name, value) { el.attrs[name] = value; },
      getAttribute(name) { return el.attrs[name]; },
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
  const game = make('div');
  game.id = 'game';
  const fullscreen = { requests: 0, exits: 0 };
  game.requestFullscreen = () => { fullscreen.requests++; return Promise.resolve(); };
  const docHandlers = new Map();
  globalThis.document = {
    getElementById: (id) => (id === 'touch' ? root : id === 'game' ? game
      : globalThis.document.body.children.find((el) => el.id === id) || null),
    createElement: make,
    visibilityState: 'visible',
    fullscreenElement: null,
    body: {
      classList: {
        set: new Set(),
        add(c) { this.set.add(c); },
        remove(c) { this.set.delete(c); },
        contains(c) { return this.set.has(c); },
        toggle(c) { this.set.has(c) ? this.set.delete(c) : this.set.add(c); },
      },
      // The menu button is a direct child of <body>, not of the overlay.
      children: [],
      append(...kids) { globalThis.document.body.children.push(...kids); },
    },
    exitFullscreen() { fullscreen.exits++; return Promise.resolve(); },
    addEventListener(type, fn) { docHandlers.set(type, fn); },
  };
  globalThis.fullscreenState = fullscreen;
  globalThis.addEventListener = (type, fn) => docHandlers.set(type, fn);
  return { root, handlers, docHandlers, fullscreen };
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
  const overlay = createTouchOverlay(mod, null);
  // Recursive: the drawer's controls sit inside the tray rather than directly
  // under the overlay root.
  const byId = new Map();
  const walk = (el) => {
    for (const kid of el.children) {
      if (kid.id) byId.set(kid.id, kid);
      walk(kid);
    }
  };
  walk(dom.root);
  // The engine reads the overlay on the game frame, so a test that wants to
  // see what the engine sees has to advance a frame. frame() is what
  // onFrame in shell.mjs does.
  const frame = () => overlay.sample();
  // shell.mjs adds the menu button on the same line it starts the overlay, so
  // the harness mirrors that rather than testing a state the page never has.
  const { addMenuButton } = await import('../../platforms/browser/menu-button.mjs');
  const menu = addMenuButton();
  return { ...dom, dom: globalThis.document, mod, byId, overlay, menu, frame };
}

test('the requested layout maps to the GameCube pad bits', async () => {
  const { handlers, mod, byId, frame } = await load({});
  // Button, then the bit dolphin/pad.h gives it. A and B are the face buttons,
  // Y stays jump, and R is a trigger even though it sits where X would.
  for (const [id, bit] of [['a', 0x0100], ['b', 0x0200], ['y', 0x0800], ['z', 0x0010]]) {
    down(handlers, byId.get(`pad-${id}`), 0, 0);
    frame();
    assert.equal(lastPad(mod)[1] & bit, bit, id);
    up(handlers, 'pointerup', byId.get(`pad-${id}`));
    frame();
    assert.equal(lastPad(mod)[1], 0, `${id} released`);
  }
  // A shoulder is a trigger, not a button bit: a digital press sends the full
  // 255 so it is a hard shield rather than a light one.
  down(handlers, byId.get('pad-l'), 0, 0);
  frame();
  assert.equal(lastPad(mod)[6], 255, 'L trigger');
  up(handlers, 'pointerup', byId.get('pad-l'));
  frame();
  down(handlers, byId.get('pad-r'), 0, 0);
  frame();
  assert.equal(lastPad(mod)[7], 255, 'R trigger');
});

test('A on top of the C-stick presses A and does not aim the C-stick', async () => {
  // A is drawn over the middle of the C-stick ring, so the hit test has to
  // pick A. If it picked the ring, every A press would also throw a smash.
  const { handlers, mod, byId, frame } = await load({});
  down(handlers, byId.get('pad-a'), 0, 0);
  frame();
  const pad = lastPad(mod);
  assert.equal(pad[1] & 0x0100, 0x0100, 'A pressed');
  assert.deepEqual([pad[4], pad[5]], [0, 0], 'C-stick centred');
});

test('the stick reaches the raw units Melee thresholds against', async () => {
  // A 100x100 ring at the origin: middle (50,50), radius 50. The floating
  // origin holds the centre within half a radius of the middle, leaving 25
  // units of travel, so a touch at the middle has its centre at (50,50).
  const boxes = { 'pad-stick': { left: 0, top: 0, width: 100, height: 100 } };
  const { handlers, mod, byId, frame } = await load(boxes);
  const stick = byId.get('pad-stick');
  const move = (x, y) =>
    handlers.get('pointermove')({ pointerId: 1, clientX: x, clientY: y, preventDefault() {} });

  // The touch starts centred: the thumb is at the origin it just defined, so
  // there is no deflection until it moves.
  down(handlers, stick, 50, 50);
  frame();
  assert.deepEqual([lastPad(mod)[2], lastPad(mod)[3]], [0, 0], 'starts centred');

  // Full deflection right is +80, the same value a GC adapter reports.
  move(75, 50);
  frame();
  assert.deepEqual([lastPad(mod)[2], lastPad(mod)[3]], [80, 0], 'right');

  // Up is positive on the pad and negative on the screen. It arrives over
  // several frames rather than at once: the upward axis is rate-limited so a
  // flick cannot tap jump. See the tap jump tests below.
  move(50, 25);
  for (let i = 0; i < 16; i++) frame();
  assert.deepEqual([lastPad(mod)[2], lastPad(mod)[3]], [0, 80], 'up, once ramped');

  // Beyond the ring the magnitude is clamped as a vector, so a diagonal cannot
  // reach further than a cardinal does: both axes land on 80/sqrt(2) = 57.
  // The upward component ramps, so this needs the frames to settle as well.
  move(550, -450);
  for (let i = 0; i < 16; i++) frame();
  const diag = lastPad(mod);
  assert.deepEqual([diag[2], diag[3]], [57, 57], 'clamped diagonal');
  assert.ok(Math.hypot(diag[2], diag[3]) <= STICK_MAX + 1, 'no further than a cardinal');

  // Inside the deadzone a resting thumb reads as centred rather than walking.
  move(52, 50);
  frame();
  assert.deepEqual([lastPad(mod)[2], lastPad(mod)[3]], [0, 0], 'deadzone');

  // Releasing recentres, so a lifted thumb does not keep the stick held over.
  move(75, 50);
  frame();
  up(handlers, 'pointerup', stick);
  frame();
  assert.deepEqual([lastPad(mod)[2], lastPad(mod)[3]], [0, 0], 'released');
});

test('an upward flick cannot tap jump, and still reaches full deflection', async () => {
  // ftCo_Jump_GetInput needs lstick.y over tap_jump_threshold WHILE
  // active_timer.lstick.y is still under tap_jump_window: PlCo.dat gives 0.6625
  // and 4 frames, and some ground states use the lower 0.5625. The overlay
  // rate-limits the upward axis so a flick never satisfies both at once, which
  // is what turns tap jump off without taking the upward stick away.
  const RELAXED = Math.ceil(0.5625 * STICK_MAX); // 45
  const WINDOW = 4;
  const boxes = { 'pad-stick': { left: 0, top: 0, width: 100, height: 100 } };
  const { handlers, mod, byId, frame } = await load(boxes);
  const stick = byId.get('pad-stick');
  const move = (x, y) =>
    handlers.get('pointermove')({ pointerId: 1, clientX: x, clientY: y, preventDefault() {} });

  down(handlers, stick, 50, 50);
  frame();
  // A flick: straight to full up in one pointer event, which is what a thumb
  // actually does.
  move(50, 25);

  // Through the whole window the reported value stays under even the lower
  // threshold, so neither jump condition is ever met together.
  for (let i = 0; i < WINDOW; i++) {
    frame();
    assert.ok(lastPad(mod)[3] < RELAXED,
      `frame ${i + 1}: y=${lastPad(mod)[3]} reached the relaxed threshold ${RELAXED} inside the ${WINDOW} frame window`);
  }

  // Held, it still gets all the way up: up-B, up-tilt and upward DI need it.
  for (let i = 0; i < 16; i++) frame();
  assert.equal(lastPad(mod)[3], STICK_MAX, 'a held stick still reaches full up');
});

test('coming back up through centre re-ramps instead of snapping to full', async () => {
  // The sequence that needs the reset in rampUp: hold up until the ramp is
  // charged, come back down, then flick up again. Without the reset the second
  // flick reports full deflection on its first frame and tap jumps. Starting
  // from neutral cannot catch this, because a ramp that was never charged has
  // nothing stale to carry over.
  const RELAXED = Math.ceil(0.5625 * STICK_MAX);
  const boxes = { 'pad-stick': { left: 0, top: 0, width: 100, height: 100 } };
  const { handlers, mod, byId, frame } = await load(boxes);
  const stick = byId.get('pad-stick');
  const move = (x, y) =>
    handlers.get('pointermove')({ pointerId: 1, clientX: x, clientY: y, preventDefault() {} });

  down(handlers, stick, 50, 50);
  // Up, fully ramped.
  move(50, 25);
  for (let i = 0; i < 16; i++) frame();
  assert.equal(lastPad(mod)[3], STICK_MAX, 'charged by the first hold');

  // Down: immediate, and it discharges the ramp.
  move(50, 75);
  frame();
  assert.equal(lastPad(mod)[3], -STICK_MAX, 'down is immediate, not ramped');

  // Up again: back to the start of the ramp, not straight to full.
  move(50, 25);
  frame();
  assert.ok(lastPad(mod)[3] < RELAXED,
    `the second flick started pre-charged at ${lastPad(mod)[3]}`);
});

test('the sideways axis is never limited', async () => {
  // A sideways flick is a dash, and it has no tap jump to avoid.
  const boxes = { 'pad-stick': { left: 0, top: 0, width: 100, height: 100 } };
  const { handlers, mod, byId, frame } = await load(boxes);
  const stick = byId.get('pad-stick');
  const move = (x, y) =>
    handlers.get('pointermove')({ pointerId: 1, clientX: x, clientY: y, preventDefault() {} });

  down(handlers, stick, 50, 50);
  frame();
  move(75, 50);
  frame();
  assert.equal(lastPad(mod)[2], STICK_MAX, 'sideways is immediate');
});

test('the stick centre floats to where the thumb lands', async () => {
  // A fixed centre would read the distance from the ring's middle as
  // deflection, so a thumb landing off-centre would start the stick already
  // pushed over. The same offset landing must read as centred instead.
  const boxes = { 'pad-stick': { left: 0, top: 0, width: 100, height: 100 } };
  const { handlers, mod, byId, frame } = await load(boxes);
  const stick = byId.get('pad-stick');

  down(handlers, stick, 65, 40);
  frame();
  assert.deepEqual([lastPad(mod)[2], lastPad(mod)[3]], [0, 0], 'off-centre landing is centred');

  // Moving right from that new origin deflects right, by the travel that is
  // left between the floating centre and the rim.
  handlers.get('pointermove')({ pointerId: 1, clientX: 90, clientY: 40, preventDefault() {} });
  frame();
  assert.equal(lastPad(mod)[2], 80, 'full right from the floating origin');
  assert.equal(lastPad(mod)[3], 0);
});

test('a tap between two frames is not lost', async () => {
  // Pointer events fire faster and less regularly than the 60Hz simulation, so
  // a press and its release can both land between two game frames. Dropping
  // that tap loses an input the player made correctly.
  const { handlers, mod, byId, frame } = await load({});
  down(handlers, byId.get('pad-a'), 0, 0);
  up(handlers, 'pointerup', byId.get('pad-a'));
  frame();
  assert.equal(lastPad(mod)[1] & 0x0100, 0x0100, 'tap latched to the next frame');
  // It must not stick after the frame that reported it.
  frame();
  assert.equal(lastPad(mod)[1], 0, 'released on the frame after');
});

test('losing the window releases everything', async () => {
  // A notification or a call takes the touches away without a pointercancel
  // for each one. Without the reset the stick stays held and the character
  // walks off the stage while the player is not even looking.
  const boxes = { 'pad-stick': { left: 0, top: 0, width: 100, height: 100 } };
  const { handlers, docHandlers, mod, byId, frame } = await load(boxes);
  down(handlers, byId.get('pad-stick'), 50, 50);
  handlers.get('pointermove')({ pointerId: 1, clientX: 75, clientY: 50, preventDefault() {} });
  down(handlers, byId.get('pad-b'), 0, 0);
  frame();
  assert.notEqual(lastPad(mod)[1], 0, 'B held');
  assert.equal(lastPad(mod)[2], 80, 'stick held over');

  document.visibilityState = 'hidden';
  docHandlers.get('visibilitychange')();
  const pad = lastPad(mod);
  assert.deepEqual(pad.slice(1), [0, 0, 0, 0, 0, 0, 0], 'everything released at once');

  // And it stays released: no stale pointer state revives it on later frames.
  frame();
  assert.deepEqual(lastPad(mod).slice(1), [0, 0, 0, 0, 0, 0, 0], 'stays released');
});

test('a cancelled touch releases, so no button stays held', async () => {
  // An incoming call ends a touch with pointercancel and never pointerup. A
  // missed one holds the button down for the rest of the match.
  const { handlers, mod, byId, frame } = await load({});
  down(handlers, byId.get('pad-a'), 0, 0);
  frame();
  assert.notEqual(lastPad(mod)[1], 0);
  up(handlers, 'pointercancel', byId.get('pad-a'));
  frame();
  assert.equal(lastPad(mod)[1], 0);
});

test('the pad is claimed once, and only after a real touch', async () => {
  // Claiming it at load would override a keyboard on a device that has both.
  const { handlers, mod, byId, frame } = await load({});
  // An idle overlay must not write even when frames are running.
  frame();
  frame();
  assert.deepEqual(mod.calls, [], 'idle overlay stays quiet');
  down(handlers, byId.get('pad-a'), 0, 0);
  frame();
  up(handlers, 'pointerup', byId.get('pad-a'));
  frame();
  assert.equal(mod.calls.filter((c) => c[0] === 'active').length, 1);
  // Once everything is released the overlay goes quiet again, so a player who
  // switches to a keyboard is not fighting an overlay writing zeroes forever.
  const settled = mod.calls.length;
  frame();
  frame();
  assert.equal(mod.calls.length, settled, 'quiet once released');
});

// The menu case: a player in fullscreen has no keyboard, so every button the
// game reads in a menu has to be reachable from the overlay. X and the D-pad
// are not used in a match, which is why they live in the drawer, but a menu
// needs them and an unreachable button is an unusable menu.
test('the drawer carries X and the D-pad, with the right pad bits', async () => {
  const { handlers, mod, byId, frame } = await load({});
  const expected = { x: 0x0400, up: 0x0008, down: 0x0004, left: 0x0001, right: 0x0002 };
  for (const [id, bit] of Object.entries(expected)) {
    const el = byId.get(`pad-${id}`);
    assert.ok(el, `pad-${id} is missing from the overlay`);
    down(handlers, el, 0, 0);
    frame();
    assert.equal(mod.calls.at(-1)[1], bit, `pad-${id} sent the wrong bit`);
    up(handlers, 'pointerup', el);
    frame();
  }
});

// Drawn inside the tray, not at the overlay root: the tray is what the
// <details> hides when closed, so a control appended to the root instead
// would stay on screen during a match and cover the picture.
test('the drawer controls are inside the tray, not loose on the overlay', async () => {
  const { byId } = await load({});
  for (const id of ['pad-x', 'pad-up', 'pad-down', 'pad-left', 'pad-right']) {
    assert.equal(byId.get(id).parent.id, 'pad-tray', `${id} is not in the tray`);
  }
  // The match controls stay out of it, or they would be hidden when closed.
  for (const id of ['pad-a', 'pad-b', 'pad-stick', 'pad-cstick']) {
    assert.notEqual(byId.get(id).parent.id, 'pad-tray', `${id} must not be in the drawer`);
  }
});

// Fullscreen has to promote #game: that element holds the canvas AND this
// overlay, so requesting it on the canvas would leave every control undrawn.
test('the fullscreen button requests #game, not the canvas', async () => {
  const { byId, fullscreen } = await load({});
  const button = byId.get('pad-full');
  assert.ok(button, 'pad-full is missing');
  button.handler();
  assert.equal(fullscreen.requests, 1);
});

// A pointerup during the transition can land outside the re-laid-out overlay
// and never reach onUp, which would hold the button down for ever.
test('a fullscreen change releases everything held', async () => {
  const { handlers, docHandlers, mod, byId, frame } = await load({});
  down(handlers, byId.get('pad-a'), 0, 0);
  frame();
  assert.equal(mod.calls.at(-1)[1], 0x0100);
  docHandlers.get('fullscreenchange')();
  assert.deepEqual(mod.calls.at(-1).slice(1), [0, 0, 0, 0, 0, 0, 0]);
});

// The page's controls (mode links, disc picker, Start) are hidden while the
// game runs, so without this button neither a phone nor a desktop can reach
// them at all. It lives on <body> rather than in the overlay because the
// overlay only exists on a coarse pointer.
test('the menu button toggles the panel class on the body', async () => {
  const { menu } = await load({});
  assert.ok(menu, 'pad-menu is missing');
  assert.equal(document.body.classList.contains('menu'), false);
  assert.equal(menu.getAttribute('aria-expanded'), 'false');
  menu.handler();
  assert.equal(document.body.classList.contains('menu'), true, 'first tap must open it');
  // A screen reader has no other way to tell the panel is open: the class is
  // on <body> and the styling that reveals the panel is not announced.
  assert.equal(menu.getAttribute('aria-expanded'), 'true');
  menu.handler();
  assert.equal(document.body.classList.contains('menu'), false, 'second tap must close it');
  assert.equal(menu.getAttribute('aria-expanded'), 'false');
});

// A second call must not stack a second button on the body.
test('the menu button is added once', async () => {
  const { dom } = await load({});
  const { addMenuButton } = await import('../../platforms/browser/menu-button.mjs');
  assert.equal(addMenuButton(), null, 'a repeat call must not add another button');
  assert.equal(dom.body.children.filter((el) => el.id === 'pad-menu').length, 1);
});

// The menu button is a page control, not a game input: a tap on it must not
// reach the engine as a button press.
test('the menu and fullscreen buttons send no pad input', async () => {
  const { mod, byId, menu, frame } = await load({});
  menu.handler();
  byId.get('pad-full').handler();
  frame();
  assert.equal(mod.calls.length, 0, 'a page control must not claim the pad');
});
