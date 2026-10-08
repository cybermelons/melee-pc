// SPDX-License-Identifier: GPL-3.0-or-later
// Touch overlay for phones: an analog stick, a C-stick with the face buttons
// on it, the two shoulders and Start, drawn as DOM elements over the canvas.
//
// src/pc/touch.c has an SDL finger-event path for Android and iOS, but it
// carries its own hardcoded zones. This build does not use it (pc_touch_event
// is a no-op under Emscripten) because the layout here has to be visible: a
// player cannot aim at a region they cannot see. So the DOM owns the layout
// and only the resulting pad state crosses into C, through pc_touch_set_pad.

// dolphin/pad.h. Melee reads these raw, so the names stay the GameCube ones
// even where this overlay gives a button a different position.
const PAD = {
  A: 0x0100,
  B: 0x0200,
  X: 0x0400,
  Y: 0x0800,
  Z: 0x0010,
  R: 0x0020,
  L: 0x0040,
  START: 0x1000,
  UP: 0x0008,
  DOWN: 0x0004,
  LEFT: 0x0001,
  RIGHT: 0x0002,
};

// Melee's dash, tilt and light-shield thresholds are in raw 8-bit units, so a
// stick at full deflection must reach the same 80 the GC adapter reports and
// nothing here rescales to a different range (see gcadapter.mjs).
const STICK_MAX = 80;
// Below this fraction of the stick radius the finger reads as centred. A thumb
// resting on glass never sits still, and without a deadzone that drift is a
// constant slow walk.
const DEADZONE = 0.2;

// The pad state the engine sees. Rebuilt from the live pointers every change
// rather than accumulated, so a touch that ends can never leave a button set.
const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

const pressed = new Map(); // pointerId -> control
const sticks = new Map();  // pointerId -> { el, kind, cx, cy, radius, dx, dy }

function buildState() {
  let buttons = 0;
  let triggerL = 0;
  let triggerR = 0;
  for (const control of pressed.values()) {
    buttons |= control.button || 0;
    if (control.button === PAD.L) triggerL = 255;
    if (control.button === PAD.R) triggerR = 255;
  }
  let stickX = 0, stickY = 0, substickX = 0, substickY = 0;
  for (const stick of sticks.values()) {
    if (stick.kind === 'stick') {
      stickX = stick.dx;
      stickY = stick.dy;
    } else {
      substickX = stick.dx;
      substickY = stick.dy;
    }
  }
  return { buttons, stickX, stickY, substickX, substickY, triggerL, triggerR };
}

export function createTouchOverlay(Module, log) {
  const root = document.getElementById('touch');
  if (!root) return null;

  // A digital shoulder sends the full 255 rather than a mid value: there is no
  // travel on a touchscreen to express a light shield, and a partial trigger
  // would make every shield a light one.
  //
  // Button positions follow the request: the C-stick sits on the right with A
  // in its middle and B to its left, Y stays Y for jump, R takes the place X
  // would have on the right, and L is on the left beside the stick.
  const controls = [
    { id: 'stick', kind: 'stick', label: '' },
    { id: 'cstick', kind: 'cstick', label: 'C' },
    { id: 'a', button: PAD.A, label: 'A' },
    { id: 'b', button: PAD.B, label: 'B' },
    { id: 'y', button: PAD.Y, label: 'Y' },
    { id: 'r', button: PAD.R, label: 'R' },
    { id: 'l', button: PAD.L, label: 'L' },
    { id: 'z', button: PAD.Z, label: 'Z' },
    { id: 'start', button: PAD.START, label: 'Start' },
    // The rest live in the drawer. The game needs every one of them in a menu
    // even though a match rarely does: X is a confirm on some screens, and the
    // D-pad moves the cursor where the analog stick is ignored (the stage
    // select's zoom, the name entry grid, the debug menu). A full-screen
    // player cannot reach a keyboard, so the overlay has to carry them.
    { id: 'x', button: PAD.X, label: 'X', drawer: true },
    { id: 'up', button: PAD.UP, label: '\u25b2', drawer: true },
    { id: 'down', button: PAD.DOWN, label: '\u25bc', drawer: true },
    { id: 'left', button: PAD.LEFT, label: '\u25c0', drawer: true },
    { id: 'right', button: PAD.RIGHT, label: '\u25b6', drawer: true },
  ];

  // Fullscreen goes on #game, the element that holds the canvas AND this
  // overlay. Requesting it on the canvas alone would promote only the canvas
  // into the fullscreen layer and every control here would stop being drawn,
  // which is exactly the case this control exists to serve.
  //
  // The button hides itself where the API is missing: iOS Safari on iPhone
  // has no element fullscreen, so offering it there is a control with no
  // outcome. The page is already full-bleed from the CSS, so nothing is lost.
  const game = document.getElementById('game');
  if (game && game.requestFullscreen) {
    const full = document.createElement('div');
    full.className = 'pad btn';
    full.id = 'pad-full';
    full.textContent = '\u26f6';
    // click, not pointerdown: this one is a page control rather than a game
    // input, so it does not go through publish() and must not latch a frame.
    full.addEventListener('click', () => {
      if (document.fullscreenElement) {
        document.exitFullscreen().catch((error) => log(`Fullscreen: ${error.message}`));
      } else {
        game.requestFullscreen().catch((error) => log(`Fullscreen: ${error.message}`));
      }
    });
    root.append(full);
  }

  // The menu button is not created here. It is a page control rather than a
  // game input, and it is the only way back to the page's own controls once
  // body.playing hides them, so a desktop player needs it as much as a phone
  // player does. This overlay only exists on a coarse pointer, so a button
  // created here would never appear on a desktop. shell.mjs creates it.

  // A <details> element, so the open and closed states are the browser's own
  // and there is no toggle handler or open flag to keep in step. The summary
  // is the tab the player taps.
  const drawer = document.createElement('details');
  drawer.id = 'pad-drawer';
  const summary = document.createElement('summary');
  summary.textContent = '+';
  summary.id = 'pad-more';
  drawer.append(summary);
  const tray = document.createElement('div');
  tray.id = 'pad-tray';
  drawer.append(tray);
  root.append(drawer);

  const byEl = new Map();
  for (const control of controls) {
    const el = document.createElement('div');
    el.className = `pad ${control.kind || 'btn'}`;
    el.id = `pad-${control.id}`;
    el.textContent = control.label;
    if (control.kind) {
      // The stick needs a visible thumb so the player can see how far the
      // deflection has gone; a ring alone gives no feedback.
      const nub = document.createElement('div');
      nub.className = 'nub';
      el.append(nub);
      control.nub = nub;
    }
    control.el = el;
    byEl.set(el, control);
    (control.drawer ? tray : root).append(el);
  }

  let active = false;
  let touched = false;
  // Buttons seen since the last sample, whether or not they are still held.
  // A pointer events stream can deliver a press and its release between two
  // game frames, and a tap dropped that way is a missed input the player made
  // correctly. src/pc/touch.c latches the same way for the same reason.
  let latched = 0;

  // The touch handlers only mark the state dirty. The engine reads it once per
  // game frame through sample() below, so input arrives at the simulation's
  // 60Hz rather than at whatever rate the browser chooses to fire pointer
  // events at, which is both faster and irregular.
  function publish() {
    touched = true;
    latched |= buildState().buttons;
  }

  // Called from the frame hook in shell.mjs, on the game frame.
  function sample() {
    if (!touched) return;
    // Only claim the virtual pad once a touch has actually happened, so a
    // desktop visitor with a keyboard is never overridden by an idle overlay.
    if (!active) {
      active = true;
      Module._pc_touch_set_active(1);
    }
    const st = buildState();
    Module._pc_touch_set_pad(st.buttons | latched, st.stickX, st.stickY,
      st.substickX, st.substickY, st.triggerL, st.triggerR);
    const reported = latched;
    latched = 0;
    // Nothing is held any more, so one more frame is owed: this one reported a
    // latched tap, and stopping here would leave that press as the last state
    // the engine saw and hold it for ever. The next frame writes the zero.
    if (pressed.size === 0 && sticks.size === 0 && reported === 0) {
      touched = false;
    }
  }

  // A notification, an app switch or a call takes the touches away without
  // sending pointercancel for each one. Without this reset the stick stays
  // held and the character walks off the stage while the player is elsewhere.
  function releaseAll() {
    for (const stick of sticks.values()) {
      stick.el.classList.remove('on');
      stick.control.nub.style.transform = '';
    }
    for (const control of pressed.values()) {
      control.el.classList.remove('on');
    }
    sticks.clear();
    pressed.clear();
    latched = 0;
    if (active) {
      Module._pc_touch_set_pad(0, 0, 0, 0, 0, 0, 0);
    }
    touched = false;
  }

  function moveStick(stick, clientX, clientY) {
    const dx = (clientX - stick.cx) / stick.radius;
    const dy = (clientY - stick.cy) / stick.radius;
    const length = Math.hypot(dx, dy);
    // Past the ring the stick stays at full deflection in that direction
    // instead of clamping each axis on its own, which would otherwise let a
    // diagonal reach further than a cardinal and break angle-sensitive moves.
    const scale = length > 1 ? 1 / length : 1;
    let ux = dx * scale;
    let uy = dy * scale;
    if (Math.hypot(ux, uy) < DEADZONE) {
      ux = 0;
      uy = 0;
    }
    stick.dx = Math.round(ux * STICK_MAX);
    // Screen Y grows downwards and the pad's grows upwards. The | 0 turns the
    // -0 that negating a zero produces back into 0.
    stick.dy = -Math.round(uy * STICK_MAX) | 0;
    stick.el.classList.add('on');
    const nub = stick.control.nub;
    nub.style.transform = `translate(${ux * 50}%, ${uy * 50}%)`;
  }

  function onDown(event) {
    const control = byEl.get(event.target.closest('.pad'));
    if (!control) return;
    // Without this the browser also fires a mouse event, scrolls the page, or
    // pops a selection callout, and the canvas loses the touch entirely.
    event.preventDefault();
    control.el.setPointerCapture(event.pointerId);
    if (control.kind) {
      const box = control.el.getBoundingClientRect();
      // Measured per touch rather than cached: the ring's size follows the
      // viewport, which changes on rotation and on a browser chrome reveal.
      const radius = box.width / 2;
      // Floating origin: the centre is where the thumb lands, not the middle
      // of the ring. A fixed centre means the first move of every touch is
      // whatever offset the thumb happened to land at, which reads as the
      // stick jumping before it tracks.
      //
      // Held half a radius inside the ring so there is travel in every
      // direction. Without the clamp, a thumb landing on the rim leaves no
      // room to push further that way and the stick cannot reach full
      // deflection outward at all.
      const limit = radius / 2;
      const cx = clamp(event.clientX, box.left + box.width / 2 - limit,
        box.left + box.width / 2 + limit);
      const cy = clamp(event.clientY, box.top + box.height / 2 - limit,
        box.top + box.height / 2 + limit);
      const stick = {
        control,
        el: control.el,
        kind: control.kind,
        cx,
        cy,
        // The travel left between the floating centre and the rim.
        radius: radius - limit,
        dx: 0,
        dy: 0,
      };
      sticks.set(event.pointerId, stick);
      // Not moveStick: the thumb is at the origin it just defined, so the
      // stick starts centred. Calling moveStick here would be a no-op at
      // best, and at worst would read the clamp offset as deflection.
      stick.el.classList.add('on');
    } else {
      pressed.set(event.pointerId, control);
      control.el.classList.add('on');
    }
    publish();
  }

  function onMove(event) {
    const stick = sticks.get(event.pointerId);
    if (!stick) return;
    event.preventDefault();
    moveStick(stick, event.clientX, event.clientY);
    publish();
  }

  function onUp(event) {
    const stick = sticks.get(event.pointerId);
    if (stick) {
      sticks.delete(event.pointerId);
      stick.el.classList.remove('on');
      stick.control.nub.style.transform = '';
    }
    const control = pressed.get(event.pointerId);
    if (control) {
      pressed.delete(event.pointerId);
      control.el.classList.remove('on');
    }
    if (stick || control) {
      event.preventDefault();
      publish();
    }
  }

  root.addEventListener('pointerdown', onDown);
  root.addEventListener('pointermove', onMove);
  // pointercancel matters as much as pointerup here: an incoming call or a
  // system gesture ends the touch that way, and a missed one sticks a button
  // down for the rest of the match.
  for (const type of ['pointerup', 'pointercancel']) {
    root.addEventListener(type, onUp);
  }

  // Entering or leaving fullscreen re-lays-out the overlay under the player's
  // thumb, and a pointerup that lands outside it never reaches onUp, which
  // would hold the button for ever. Drop everything on the transition.
  document.addEventListener('fullscreenchange', releaseAll);

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') releaseAll();
  });
  // Safari does not always fire visibilitychange when the app goes to the
  // background, but it does fire pagehide.
  addEventListener('pagehide', releaseAll);

  root.hidden = false;
  if (log) log('Touch overlay: on');
  return { root, sample, releaseAll };
}
