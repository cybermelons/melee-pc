// SPDX-License-Identifier: GPL-3.0-or-later
// Minimal host page for the browser build: disc picker, canvas, persistence.
// The engine's whole host interface is the handful of Module fields set here.
import { createDiscCache } from './disc-cache.mjs';
import { openRemoteDisc } from './remote-disc.mjs';
import { createGCAdapter } from './gcadapter.mjs';
import { checkGraphics } from './gpu-preflight.mjs';
import { createTouchOverlay } from './touch.mjs';
import { addMenuButton } from './menu-button.mjs';
import { addTierToggle } from './tier.mjs';
import { showCrash } from './crash.mjs';
import { addSettings } from './settings.mjs';

const $ = (id) => document.getElementById(id);
const lines = [];
function log(text) {
  lines.push(String(text));
  $('log').textContent = lines.slice(-80).join('\n');
  console.log(text);
}
const status = (text) => { $('status').textContent = text; };

// Render size. platforms/browser/main.c reads windowWidth and windowHeight from
// Module.canvas, so the backing store set here is what the engine renders into.
// The CSS width is separate and unchanged, so the picture always fills the same
// box and only the rendered pixel count moves.
//
// MELEE_SCALE=<n> multiplies the base size, so one URL is one render size. It
// is a measurement knob, not a quality setting: it answers whether a slow frame
// is the pixel count by changing only that. Unset, the base size is unchanged.
//
// Mobile does not currently need it. An iPhone holds 60 fps at the full 960x720
// once the pipeline cache is warm; a cold first run is much slower while shaders
// compile (see README, "first launch").
//
// A phone is a touch device, which is also what decides whether the on-screen
// controls appear. matchMedia rather than a user-agent test, and the same
// query the stylesheet uses, so the two cannot disagree about what a phone is.
const TOUCH = matchMedia('(pointer: coarse)').matches;
const BASE_WIDTH = 960;
const BASE_HEIGHT = 720;
const SCALE = Number(new URLSearchParams(location.search).get('MELEE_SCALE') || 1);
if (SCALE > 0 && SCALE !== 1) {
  const canvas = $('canvas');
  canvas.width = Math.max(64, Math.round(BASE_WIDTH * SCALE));
  canvas.height = Math.max(48, Math.round(BASE_HEIGHT * SCALE));
}

// Rolling frame statistics; also read by tests/browser/shell-e2e.mjs.
const frames = { count: 0, last: 0, samples: [] };
window.meleeFrames = frames;
// A phone has no console attached, so the same figures also go to the on-page
// log every 2 seconds. A thermal drop is a trend rather than one number, and
// that needs a series to be visible at all.
let lastReport = 0;
// Set at Start on a touch device; the overlay's pad state is read here rather
// than written from its own event handlers, so input reaches the engine on the
// game frame at 60Hz instead of at the browser's pointer event rate.
let overlay = null;
// Set on abort. onFrame is called from the engine's own loop, so this is what
// stops the page's per-frame work; the engine is already past saving.
let crashed = false;
function onFrame() {
  if (crashed) return;
  if (overlay) overlay.sample();
  const now = performance.now();
  if (frames.last) {
    frames.samples.push(now - frames.last);
    if (frames.samples.length > 7200) frames.samples.shift(); // two minutes
  }
  frames.last = now;
  if (++frames.count % 30 === 0 && frames.samples.length > 60) {
    const recent = frames.samples.slice(-120);
    const sorted = [...recent].sort((a, b) => a - b);
    const fps = 1000 * recent.length / recent.reduce((a, b) => a + b, 0);
    const mean = recent.reduce((a, b) => a + b, 0) / recent.length;
    const p99 = sorted[Math.floor(sorted.length * 0.99)];
    const canvas = $('canvas');
    const size = `${canvas.width}x${canvas.height}`;
    $('stats').textContent =
      `${fps.toFixed(1)} fps · ${mean.toFixed(1)} ms · p99 ${p99.toFixed(1)} ms · ${size}`;
    if (now - lastReport > 2000) {
      lastReport = now;
      log(`t=${(now / 1000).toFixed(0)}s ${fps.toFixed(1)} fps mean=${mean.toFixed(1)}ms` +
          ` p99=${p99.toFixed(1)}ms ${size}`);
    }
  }
}

function syncfs(populate) {
  return new Promise((resolve, reject) =>
    Module.FS.syncfs(populate, (error) => (error ? reject(error) : resolve())));
}

// Any MELEE_* query parameter becomes an environment variable, so the knobs in
// docs/testing.md work unchanged: ?MELEE_BOOT_SCENE=vs&MELEE_SEED=1
// MELEE_SLP_DIR defaults to /saves, which is mounted IDBFS with autoPersist,
// so replays survive a reload without an explicit syncfs. Unset, the writer
// records nothing (src/pc/slp.c).
const ENV = { MELEE_SLP_DIR: '/saves/slp' };
for (const [key, value] of new URLSearchParams(location.search)) {
  if (/^MELEE_[A-Z0-9_]+$/.test(key)) ENV[key] = value;
}

window.Module = {
  // preRun is the one point where this works: Emscripten has created ENV but
  // has not yet run the static constructor that snapshots it into environ.
  preRun: [() => Object.assign(Module.ENV, ENV)],
  canvas: $('canvas'),
  print: log,
  printErr: log,
  onFrame,
  onAbort: (reason) => { crashed = true; showCrash(reason, { log, status }); },
  onGraphicsPreparation: (done, total) =>
    status(done === total ? 'Starting…' : `Preparing graphics… ${Math.floor(done * 100 / total)}%`),
  onRuntimeInitialized: () => {
    ready = true;
    status(remoteDisc ? 'Ready.' : 'Choose a GALE01 disc image (.iso or .gcm).');
    updateStart();
    adapter = createGCAdapter(Module, log);
    // An adapter authorised in an earlier visit reopens without a gesture.
    adapter.resume().then((found) => {
      // Mobile browsers have no WebHID, where the button can only report that.
      // Keep it hidden there rather than offer a control with one outcome.
      $('adapter').hidden = found || !navigator.hid;
      if (found) log('GC adapter: reconnected');
    }, (error) => log(`GC adapter: ${error.message}`));
  },
};

// Not `typeof Module.callMain`: that exists as soon as the script runs, while
// the wasm is still compiling, and a disc picked by then started a dead runtime.
let ready = false;
let adapter = null;
// A disc served alongside the page, so a visitor does not supply their own.
// Probed once at load; null means this server has none.
let remoteDisc = null;
function updateStart() {
  $('start').disabled = !(ready && (remoteDisc || $('disc').files.length));
}
$('disc').addEventListener('change', updateStart);

// Hidden before the runtime initializes as well, so it is never tappable on a
// browser without WebHID.
if (!navigator.hid) $('adapter').hidden = true;

// Into the menu panel, so the same button that reveals the panel mid-game
// reveals the settings. Built at load rather than on first open: the form
// reads the URL, and the URL does not change while the page lives.
addSettings($('menu-panel'));

// The control tier toggle, in the same panel. Applied at load rather than on
// first open, so the overlay is already in the stored tier when the game
// starts. Unlike every control in the settings form, this one takes effect
// immediately: the tier belongs to the overlay rather than to the engine, so
// it needs no reload.
addTierToggle($('menu-panel'));

$('adapter').addEventListener('click', async () => {
  try {
    $('adapter').hidden = await adapter.request();
  } catch (error) {
    status(error.message);
    log(error.stack || error);
  }
});

$('start').addEventListener('click', async () => {
  $('start').disabled = true;
  $('disc').disabled = true;
  try {
    Module.discFile = remoteDisc || $('disc').files[0];
    Module.readDisc = createDiscCache(Module.discFile).read;
    for (const dir of ['/saves', '/cache']) {
      Module.FS.mkdirTree(dir);
      Module.FS.mount(Module.FS.filesystems.IDBFS, { autoPersist: dir === '/saves' }, dir);
    }
    await syncfs(true);
    // The pipeline cache is written by a background thread; flush it when the
    // page is hidden rather than on every write.
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') syncfs(false).catch(log);
    });
    // A closed tab runs no atexit hook, so the recorder would leave its last
    // .slp without the patched raw length or metadata. pagehide is the last
    // event a browser guarantees; finish the file, then persist /saves.
    // pagehide does not fire on a crash or an OOM kill, so checkpoint the open
    // .slp and persist /saves on an interval as well. The interval covers both
    // the replay and the memory card. MELEE_SAVE_SECS=0 turns it off; the
    // replay writes themselves are per-frame regardless.
    const every = Number(ENV.MELEE_SAVE_SECS ?? ENV.MELEE_SLP_SAVE_SECS ?? 30);
    if (every > 0) {
      setInterval(() => {
        try {
          Module._pc_slp_web_checkpoint();
        } catch (error) { log(error.message); }
        syncfs(false).catch(log);
      }, every * 1000);
    }
    addEventListener('pagehide', () => {
      try {
        Module._pc_slp_web_finish();
      } catch (error) { log(error.message); }
      syncfs(false).catch(log);
    });
    status('');
    // Hides the page furniture on a phone and lets the canvas fill the
    // viewport; the CSS keeps the controls visible until this point so the
    // game can be started and an error can be read.
    document.body.classList.add('playing');
    addMenuButton();
    if (TOUCH) overlay = createTouchOverlay(Module, log);
    $('canvas').focus();
    Module.callMain([]);
  } catch (error) {
    status(error.message);
    log(error.stack || error);
  }
});

// Probe for a server-side disc before the engine reports ready, so the picker
// is only offered when there is nothing to fall back on.
try {
  remoteDisc = await openRemoteDisc();
} catch (error) {
  log(`Server disc: ${error.message}`);
}
if (remoteDisc) {
  $('disc').hidden = true;
  // The disc comes from the server, so telling the visitor to choose one
  // points at a control that is now hidden.
  $('launch-hint').textContent = 'Pick a mode, then click Start.';
  log(`Server disc: ${(remoteDisc.size / 1048576).toFixed(0)} MiB`);
  updateStart();
}

// Room mode (?room=<id>): claim a controller port and open a WebRTC data channel
// to the other tab. This must finish before melee_browser.js is injected,
// because preRun copies ENV into the engine only once that script loads.
const roomId = new URLSearchParams(location.search).get('room');
async function pairIfRoom() {
  if (!roomId) return;
  const signal = new URLSearchParams(location.search).get('signal') || `http://${location.hostname}:8101`;
  const me = crypto.randomUUID();
  const base = `${signal}/r/${encodeURIComponent(roomId)}`;
  const post = (msg) => fetch(base, { method: 'POST', body: JSON.stringify({ ...msg, from: me }) });
  const buttons = [$('p1'), $('p2')];
  for (const b of buttons) b.hidden = false;
  status('Pick P1 or P2.');
  const events = new EventSource(`${base}/events?me=${me}`);
  const gathered = (pc) => new Promise((resolve) => {
    if (pc.iceGatheringState === 'complete') return resolve();
    pc.addEventListener('icegatheringstatechange', () => pc.iceGatheringState === 'complete' && resolve());
  });
  let slot = -1;
  let paired;
  const done = new Promise((resolve) => { paired = resolve; });
  const open = (dc) => {
    dc.binaryType = 'arraybuffer';
    dc.onopen = () => {
      Module.netChannel = dc;
      ENV.MELEE_NET = '127.0.0.1:1';
      ENV.MELEE_NET_PLAYER = String(slot);
      ENV.MELEE_BOOT_SCENE ??= 'vs';
      window.meleeNet = { dc, player: slot };
      events.close();
      status(`Paired as P${slot + 1}. Loading engine…`);
      paired();
    };
  };
  let pc = null;
  const start = async () => {
    // A host candidate is a LAN address, so with no STUN server two peers on
    // different networks never learn an address the other can reach. STUN
    // gets each side its public address, which is enough for hole punching.
    // Symmetric NAT still fails and needs a TURN relay: see the ICE failure
    // message below, which is what tells the players that is what happened.
    pc = new RTCPeerConnection({ iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] });
    status('Pairing…');
    pc.addEventListener('connectionstatechange', () => {
      if (pc.connectionState === 'failed') {
        status('Could not connect to the other player. One of your networks blocks direct play.');
      }
    });
    if (slot === 0) {
      open(pc.createDataChannel('melee', { ordered: false, maxRetransmits: 0 }));
      await pc.setLocalDescription(await pc.createOffer());
      await gathered(pc);
      post({ type: 'offer', sdp: pc.localDescription.sdp });
    } else {
      pc.ondatachannel = (e) => open(e.channel);
    }
  };
  events.addEventListener('state', (e) => {
    const { claims } = JSON.parse(e.data);
    slot = claims[0] === me ? 0 : claims[1] === me ? 1 : -1;
    buttons.forEach((b, i) => { b.disabled = claims[i] !== null && claims[i] !== me; });
    if (slot >= 0 && claims[0] && claims[1] && !pc) start();
  });
  events.addEventListener('offer', async (e) => {
    // The two SSE deliveries are not ordered against each other, so the offer
    // can arrive before the state event that creates pc. Create it here too
    // rather than throwing TypeError into a listener nobody is watching.
    // Only the answering side may create pc here. The offering side already
    // has one, and must not build a second.
    if (!pc) { slot = 1; await start(); }
    await pc.setRemoteDescription({ type: 'offer', sdp: JSON.parse(e.data).sdp });
    await pc.setLocalDescription(await pc.createAnswer());
    await gathered(pc);
    post({ type: 'answer', sdp: pc.localDescription.sdp });
  });
  events.addEventListener('answer', (e) =>
    pc.setRemoteDescription({ type: 'answer', sdp: JSON.parse(e.data).sdp }));
  buttons.forEach((b, i) => b.addEventListener('click', async () => {
    const r = await post({ type: 'claim', player: i });
    if (!r.ok) status(`P${i + 1} is taken.`);
  }));
  await done;
}
await pairIfRoom();

// Fail with a readable message before the wasm is fetched; otherwise a browser
// without WebGPU only shows a bare Emscripten abort.
try {
  await checkGraphics();
} catch (error) {
  status(error.message);
  throw error; // stops the module, so melee_browser.js is never injected
}

// Threads need a cross-origin isolated page. Where the server cannot send
// COOP/COEP (GitHub Pages), coi-sw.js adds them and the page reloads once
// under its control; the session flag stops a browser that still refuses
// from reloading for ever.
if (crossOriginIsolated) {
  sessionStorage.removeItem('melee-coi-reload');
  const script = document.createElement('script');
  script.src = './melee_browser.js';
  script.onerror = () => status('melee_browser.js is missing: run tools/browser/build.py first.');
  document.head.append(script);
} else if (navigator.serviceWorker && !sessionStorage.getItem('melee-coi-reload')) {
  sessionStorage.setItem('melee-coi-reload', '1');
  navigator.serviceWorker.register('./coi-sw.js')
    .then(() => navigator.serviceWorker.ready)
    .then(() => location.reload(), (error) => status(`Cannot enable threads: ${error.message}`));
} else {
  status('This page needs cross-origin isolation for its threads, and this browser did not allow it.');
}
