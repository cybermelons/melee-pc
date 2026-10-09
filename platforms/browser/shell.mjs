// SPDX-License-Identifier: GPL-3.0-or-later
// Minimal host page for the browser build: disc picker, canvas, persistence.
// The engine's whole host interface is the handful of Module fields set here.
import { createDiscCache } from './disc-cache.mjs';
import { openRemoteDisc } from './remote-disc.mjs';
import { createGCAdapter } from './gcadapter.mjs';
import { checkGraphics } from './gpu-preflight.mjs';
import { createTouchOverlay } from './touch.mjs';
import { iceServers, natKind } from './nat.mjs';
import { addMenuButton } from './menu-button.mjs';
import { addTierToggle } from './tier.mjs';
import { showCrash } from './crash.mjs';
import { addSettings } from './settings.mjs';
import { addLobby, ensureRoom, mySlot, roomLink } from './lobby.mjs';

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
  // The pipelines the boot built are in /cache by now, but only in memory.
  // The flushes on pagehide and visibilitychange start an IndexedDB write the
  // closing page does not wait for, so a visit closed before the 30 s save
  // interval left the next visit nothing to prewarm. Measured: a repeat visit
  // queued 0 known pipeline configs; with this flush it prepares them.
  if (++frames.count === 120) syncfs(false).catch(log);
  if (frames.count % 30 === 0 && frames.samples.length > 60) {
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
  // Runs before Start now (browser_prewarm below), so done returns to the
  // launch row's own status; the click clears it.
  onGraphicsPreparation: (done, total) =>
    status(done === total ? idleStatus() : `Preparing graphics… ${Math.floor(done * 100 / total)}%`),
  onRuntimeInitialized: () => {
    // Neither depends on the disc, so pull IDBFS in while the visitor is still
    // on the launch row rather than after Start. The click awaits this.
    storage = (async () => {
      for (const dir of ['/saves', '/cache']) {
        Module.FS.mkdirTree(dir);
        Module.FS.mount(Module.FS.filesystems.IDBFS, { autoPersist: dir === '/saves' }, dir);
      }
      await syncfs(true);
    })();
    // The window, the device and the cached pipelines need /cache but not the
    // disc, so build them now rather than after Start (main.c). callMain must
    // wait for it; the click does.
    graphics = storage.then(() => Module.ccall('browser_prewarm', null, [], [], { async: true }));
    graphics.catch(log);
    ready = true;
    status(idleStatus());
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
// Mounting and populating /saves and /cache; started once the runtime is up.
let storage = null;
// browser_prewarm, started once storage is in.
let graphics = null;
const idleStatus = () => remoteDisc ? 'Ready.' : 'Choose a GALE01 disc image (.iso or .gcm).';
// SDL listens for keys on window and cancels the ones it takes, Space and
// Enter included. Its window exists from browser_prewarm, before Start, so
// until the game runs keep key events on the page: the Start button, the
// settings form and the room field still need them.
for (const type of ['keydown', 'keyup', 'keypress']) {
  document.addEventListener(type, (event) => {
    if (!document.body.classList.contains('playing')) event.stopPropagation();
  });
}
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
    await graphics;
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

// Every page is in a room (#22). A visitor who arrived with no ?room= gets one
// minted into the URL, so the mode list no longer decides anything and the
// link in the address bar is always the link to share.
//
// Being in a room is not the same as being in a match, and before #22 the code
// could not tell them apart: any ?room= URL blocked the module on the data
// channel, so a visitor sent a link who only wanted to watch sat at a page
// that never booted and never said why. Holding a port is the real condition,
// and the signal server is the only thing that knows it, so the wait is
// published from the `state` event rather than decided here.
const { room: roomId } = ensureRoom(location, history);
const lobby = addLobby($('lobby'), {
  room: roomId,
  onClaim: (i) => claim?.(i),
  onRelease: () => release?.(),
  onCopy: () => navigator.clipboard?.writeText(roomLink(location))
    .then(() => status('Link copied.'), () => status('Could not copy the link.')),
});
// Set by joinLobby once the signal channel is open; before that a tile press
// has nothing to post to.
let claim = null;
let release = null;
// True once melee_browser.js has been added to the page, which is the moment
// preRun copies ENV into the engine. After that a new MELEE_NET_PLAYER cannot
// reach the engine, so a port claimed later has to reload the page.
let injected = false;

// Joining the lobby must not block the engine. Before #22 the page waited on
// `await done` only when the URL named a room, so a visitor with a bare URL
// booted solo. Now every URL names a room, so waiting here would hang every
// solo player at "Take a port" for ever. The lobby is therefore ambient: it
// connects, renders and lets a port be claimed, and only a claim makes this
// page wait for the other side to pair.
async function joinLobby() {
  // Default to the signaling mounted on this origin by the page server. A
  // second port cannot be the default: a visitor who was sent a link has no
  // reason to have 8101 reachable, and a cross-origin http:// request from an
  // https:// page is blocked as mixed content. ?signal= still points at a
  // standalone `node tools/browser/signal.mjs` for local development.
  const signal = new URLSearchParams(location.search).get('signal') || '/signal';
  const me = crypto.randomUUID();
  const base = `${signal}/r/${encodeURIComponent(roomId)}`;
  const post = (msg) => fetch(base, { method: 'POST', body: JSON.stringify({ ...msg, from: me }) });
  status('Take a port.');
  const events = new EventSource(`${base}/events?me=${me}`);
  // Send the offer once gathering has produced something usable, not once it
  // is complete. A STUN server that resolves to an address with no route --
  // every one of them does on an IPv4-only network, because they all publish
  // AAAA records -- leaves gathering open until the browser's own timeout,
  // which is far longer than a player will wait. One srflx candidate is
  // already enough to hole punch, so stop waiting for the rest.
  const gathered = (pc) => new Promise((resolve) => {
    if (pc.iceGatheringState === 'complete') return resolve();
    const done = () => { clearTimeout(timer); resolve(); };
    const timer = setTimeout(done, 3000);
    pc.addEventListener('icegatheringstatechange', () => pc.iceGatheringState === 'complete' && done());
  });
  let slot = -1;
  // Place in the port queue, or -1. Read from the same `state` event as the
  // claims, so it cannot disagree with what the server thinks.
  let place = -1;
  const open = (dc) => {
    dc.binaryType = 'arraybuffer';
    dc.onopen = () => {
      Module.netChannel = dc;
      ENV.MELEE_NET = '127.0.0.1:1';
      ENV.MELEE_NET_PLAYER = String(slot);
      ENV.MELEE_BOOT_SCENE ??= 'vs';
      window.meleeNet = { dc, player: slot };
      events.close();
      // The engine is already loading, or already running. Nothing is gated
      // on this message, so it reports rather than promises.
      status(`Paired as P${slot + 1}.`);
    };
  };
  let pc = null;
  const candidates = [];
  const start = async () => {
    // A host candidate is a LAN address, so with no STUN server two peers on
    // different networks never learn an address the other can reach. STUN
    // gets each side its public address, which is enough for hole punching.
    // Two STUN servers rather than one: a symmetric NAT assigns a different
    // external port per destination, so disagreement between the two is how
    // natKind() below recognises the one NAT that hole punching cannot beat.
    // Symmetric NAT needs a TURN relay, which ?ice= supplies without a
    // rebuild: a JSON array of RTCIceServer, as in
    // ?ice=[{"urls":"turn:host:3478","username":"u","credential":"p"}].
    pc = new RTCPeerConnection({ iceServers: iceServers() });
    status('Pairing…');
    pc.addEventListener('icecandidate', (e) => e.candidate && candidates.push(e.candidate.candidate));
    pc.addEventListener('connectionstatechange', () => {
      if (pc.connectionState !== 'failed') return;
      // Name the cause, because the two cases need different things from the
      // players: a symmetric NAT on this side needs a relay and no amount of
      // retrying helps, whereas anything else may be the other side's network.
      const kind = natKind(candidates);
      status(kind === 'symmetric'
        ? 'Could not connect. Your router uses symmetric NAT, so direct play is impossible without a relay.'
        : 'Could not connect to the other player. One of your networks blocks direct play.');
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
    const { claims, queue } = JSON.parse(e.data);
    place = (queue ?? []).indexOf(me);
    slot = mySlot(claims, me);
    lobby.render(claims, me);
    // Holding a port and having a peer is what opens the channel. Neither
    // this nor the engine boot waits on the other: the engine is already
    // running, or will be, and pairing catches up.
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
  // Giving up a port (#23). The tiles are not repainted here: the server
  // answers with a `state` event, and that one path is what the whole lobby
  // already renders from, so a release that the server refused never shows as
  // one that worked. The engine keeps running -- it is not gated on a port --
  // but this page is no longer paired, so say so rather than implying a match
  // continues.
  release = async () => {
    const r = await post({ type: 'release' });
    status(r.ok ? 'Port released. Take one again to rejoin.' : 'You hold no port.');
  };
  claim = async (i) => {
    const r = await post({ type: 'claim', player: i });
    // A refused claim is not a dead end any more: the server put this page in
    // line, so report the place rather than only the rejection. The state
    // event carrying it may not have arrived yet, hence the fallback.
    if (!r.ok) {
      return status(place >= 0
        ? `P${i + 1} is taken. You are ${place + 1} in line for the next free port.`
        : `P${i + 1} is taken. You are in line for the next free port.`);
    }
    // Before the engine is injected a claim needs nothing: preRun has not run,
    // so the state handler's ENV writes still reach it.
    if (!injected) return;
    // After the boot, ENV is closed: preRun copied it when melee_browser.js
    // loaded, and pc_net_init (net.c:2276) reads MELEE_NET once and returns
    // early when it is absent. A reload is the stopgap, NOT the only door --
    // net.h:15 says a session opens "at runtime by pc_net_connect()", and
    // net_rtc.c:10 and :25 read Module.netChannel at call time rather than at
    // boot, so the channel does not have to exist when the engine starts.
    // What is missing is only an export: there is no EMSCRIPTEN_KEEPALIVE
    // entry for it beside browser_prewarm (main.c:46). #12 carries that work.
    // Note for whoever writes it: pass no socket. connect_impl refuses a
    // supplied one under __EMSCRIPTEN__ (net.c:2049), so pc_net_connect_socket
    // is the wrong seam and browser_net_attach has to find the channel itself.
    //
    // A locally picked disc is a File handle and does not survive a reload, so
    // ask first rather than discarding the player's selection silently. A disc
    // served by this room survives, so that case reloads with no question.
    if (!remoteDisc && $('disc').files.length
        && !confirm('Joining reloads the page, which clears the disc you picked. Pick it again after?')) {
      return status(`Still holding P${i + 1}. Reload when ready to join.`);
    }
    status(`P${i + 1} is yours. Reloading to join the match…`);
    location.reload();
  };
}

// Nothing waits for a partner. joinLobby connects the signalling and returns;
// the engine boots below either way. A player who claims a port is connected
// into the game that is already running, rather than both sides having to
// press Start together. See #12, which carries the mechanism and the one
// cost that cannot be avoided from JS: preRun copies ENV exactly once, so a
// claim that lands after the engine has booted reloads the page.
joinLobby();

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
  injected = true;
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
