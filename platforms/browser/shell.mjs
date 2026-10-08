// SPDX-License-Identifier: GPL-3.0-or-later
// Minimal host page for the browser build: disc picker, canvas, persistence.
// The engine's whole host interface is the handful of Module fields set here.
import { createDiscCache } from './disc-cache.mjs';
import { openRemoteDisc } from './remote-disc.mjs';
import { createGCAdapter } from './gcadapter.mjs';
import { checkGraphics } from './gpu-preflight.mjs';

const $ = (id) => document.getElementById(id);
const lines = [];
function log(text) {
  lines.push(String(text));
  $('log').textContent = lines.slice(-80).join('\n');
  console.log(text);
}
const status = (text) => { $('status').textContent = text; };

// Rolling frame statistics; also read by tests/browser/shell-e2e.mjs.
const frames = { count: 0, last: 0, samples: [] };
window.meleeFrames = frames;
function onFrame() {
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
    $('stats').textContent = `${fps.toFixed(1)} fps · p99 ${sorted[Math.floor(sorted.length * 0.99)].toFixed(1)} ms`;
  }
}

function syncfs(populate) {
  return new Promise((resolve, reject) =>
    Module.FS.syncfs(populate, (error) => (error ? reject(error) : resolve())));
}

// Any MELEE_* query parameter becomes an environment variable, so the knobs in
// docs/testing.md work unchanged: ?MELEE_BOOT_SCENE=vs&MELEE_SEED=1
// src/pc/slp.c is not in this build: platforms/browser/pc_stubs.c replaces the
// recorder, so MELEE_SLP_DIR would do nothing here.
const ENV = {};
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
  onAbort: (reason) => status(`Engine stopped: ${reason}`),
  onGraphicsPreparation: (done, total) =>
    status(done === total ? 'Starting…' : `Preparing graphics… ${Math.floor(done * 100 / total)}%`),
  onRuntimeInitialized: () => {
    ready = true;
    status(remoteDisc ? 'Ready.' : 'Choose a GALE01 disc image (.iso or .gcm).');
    updateStart();
    adapter = createGCAdapter(Module, log);
    // An adapter authorised in an earlier visit reopens without a gesture.
    adapter.resume().then((found) => {
      $('adapter').hidden = found;
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
    // A crash or an OOM kill fires no event at all, so persist /saves on an
    // interval too, and once more on pagehide, the last event a browser
    // guarantees. MELEE_SAVE_SECS=0 turns the interval off.
    //
    // There is no replay recorder to flush here: platforms/browser/pc_stubs.c
    // stubs out the pc_slp_* entry points, so the memory card in /saves is the
    // only thing the page has to persist.
    const every = Number(ENV.MELEE_SAVE_SECS ?? 30);
    if (every > 0) {
      setInterval(() => syncfs(false).catch(log), every * 1000);
    }
    addEventListener('pagehide', () => { syncfs(false).catch(log); });
    status('');
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
