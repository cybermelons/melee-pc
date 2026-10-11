// SPDX-License-Identifier: GPL-3.0-or-later
// Real controls for the boot flags, which were reachable only by typing a URL.
//
// Every MELEE_* flag is read once into Module.ENV at preRun and cached behind a
// `static int on = -1` on the C side (src/pc/input_poll.c), so none of them can
// change while the engine runs. A control therefore cannot toggle a setting
// live: it edits the query string and the page reloads. That is also the form
// the issue asks to keep working, because a query string is what a player can
// paste to someone else.
//
// The reload is explicit rather than automatic. A locally picked disc is a File
// handle, which cannot survive a reload, so an accidental reload costs that
// player their disc selection. Apply is a button the player presses, and it
// says what it is going to do.

// The flags worth a control. Anything else still works as a query parameter;
// this is the set a visitor should not have to know the spelling of.
// `scene` entries are radio-like (one boot scene), `flag` entries are
// independent switches, and `choice` takes one of several values.
//
// `parent` names a flag that implies this one. env_flag_or_20xx in
// src/pc/input_poll.c reads such a flag as: present means its own value wins,
// including an explicit 0; absent means follow the parent. So a child control
// is written to the URL only when it disagrees with its parent, and an
// untouched child displays whatever the parent is set to.
//
// `tab` groups the row. The panel is one viewport on a phone, and a flat list
// does not fit one: the full flag set is 96 MELEE_* names in the C source, of
// which this is the curated subset. Tabs use the width instead of the height.
// A setting with no tab lands in the first one, so adding a flag cannot drop
// its control off the page.
// Two kinds of control, because the engine offers two ways in.
// SETTINGS (below) are env flags read once at boot: they go through the query
// string and a reload. LIVE (further below) are the five `prefs` fields that
// have no std::getenv but DO have an exported C setter -- widescreen, volume,
// music_volume, sfx_volume, reverb. They call the setter directly while the
// engine runs and persist in localStorage (`melee.live.<fn>`). They are never
// written to the URL: a volume slider behind a page reload would cost the
// player the match, and a room link must not carry your volume to a friend.
// The rest of the launcher's prefs (hud_mode, custom_textures, free_camera,
// filter_mode, anisotropy, mute, net_name) have neither an env reader nor an
// exported setter, so they are not reachable from here. See issue #28.
export const TABS = ['Game', 'Video', 'Audio', 'Netplay'];

export const SETTINGS = [
  { key: 'MELEE_BOOT_SCENE', tab: 'Game', kind: 'choice', label: 'Boot to',
    hint: 'Event starts on event match 1. Add &MELEE_EVENT=<0-50> to pick another.',
    options: [['', 'Title screen'], ['vs', 'Versus'], ['training', 'Training'],
              ['event', 'Event match']] },
  { key: 'MELEE_DEBUG_VS', tab: 'Game', kind: 'choice', label: 'Versus opponent',
    options: [['', 'Human'], ['cpu', 'CPU']] },
  { key: 'MELEE_20XX', tab: 'Game', kind: 'flag', label: '20XX',
    hint: 'Full cast, character select.' },
  { key: 'MELEE_BOOT_CSS', tab: 'Game', kind: 'flag', parent: 'MELEE_20XX',
    label: 'Character select' },
  { key: 'MELEE_20XX_RULES', tab: 'Game', kind: 'flag', parent: 'MELEE_20XX',
    label: 'Tournament rules',
    hint: '4 stock, 8 min, no items, no pause.' },
  { key: 'MELEE_HITBOXES', tab: 'Video', kind: 'flag', label: 'Show hitboxes' },
  { key: 'MELEE_PAUSE', tab: 'Game', kind: 'flag', label: 'Allow pausing',
    hint: 'Tournament rules turn pausing off.' },
  { key: 'MELEE_PAUSE_ON_BLUR', tab: 'Audio', kind: 'flag', label: 'Pause when unfocused',
    hint: 'A hidden tab always pauses. This covers a visible but unfocused page.' },
  { key: 'MELEE_SCALE', tab: 'Video', kind: 'choice', label: 'Render scale',
    options: [['', '1.0 · 960x720'], ['0.667', '0.667 · 640x480'], ['0.5', '0.5 · 480x360']] },
  // src/pc/launcher.cpp:1870. Off writes nothing, which leaves the launcher
  // preference in charge; a netplay session forces it on regardless.
  { key: 'MELEE_UCF', tab: 'Game', kind: 'flag', label: 'Controller fix' },
  // src/pc/launcher.cpp:1842, read as env[0] != '0'.
  { key: 'MELEE_FROZEN_STADIUM', tab: 'Game', kind: 'flag', label: 'Hazardless stadium' },
  // src/pc/net.c:2171: "auto" derives the delay from ping and jitter, any
  // other value is atoi'd and must land under RING/2 (32) or it falls back
  // to 2. The native launcher cycles 0..4 then auto, so those are the honest
  // choices. Empty follows the saved preference.
  { key: 'MELEE_NET_DELAY', tab: 'Netplay', kind: 'choice', label: 'Input delay',
    options: [['', 'Saved'], ['auto', 'Auto'], ['0', '0'], ['1', '1'], ['2', '2'],
              ['3', '3'], ['4', '4']] },
];

// A flag is on for any value other than "0" or the empty string, matching
// env_is_set in src/pc/input_poll.c. Reading it the same way here keeps the
// checkbox honest about what the engine will do with the URL it produces.
export function isOn(value) {
  return value != null && value !== '' && value !== '0';
}

// The URL a given set of choices produces. Omitted and default-valued settings
// are left out entirely, so a shared link carries only what was changed and
// stays readable. Parameters the page does not own (room, signal, and any
// MELEE_* without a control) are preserved.
//
// A child whose value agrees with its parent is left out, which is how the
// engine reads an absent child: env_flag_or_20xx falls through to the parent.
// A child that disagrees must be written even when it is off, because only a
// present value can say "off while the parent is on", and "0" is how
// env_flag_or_20xx hears that.
export function buildSearch(values, existing = '') {
  const params = new URLSearchParams(existing);
  const parentOf = new Map(SETTINGS.filter((s) => s.parent).map((s) => [s.key, s.parent]));
  for (const { key } of SETTINGS) params.delete(key);
  for (const [key, value] of Object.entries(values)) {
    const parent = parentOf.get(key);
    if (parent) {
      if (isOn(value) === isOn(values[parent])) continue;
      params.set(key, isOn(value) ? '1' : '0');
      continue;
    }
    if (value !== '' && value != null) params.set(key, value);
  }
  const search = params.toString();
  return search ? `?${search}` : '';
}

// Reads the current URL into the control values.
export function readSearch(search = '') {
  const params = new URLSearchParams(search);
  const values = {};
  for (const { key, kind } of SETTINGS) {
    const value = params.get(key);
    if (value == null) continue;
    values[key] = kind === 'flag' ? (isOn(value) ? '1' : '') : value;
  }
  return values;
}

// Live controls: NOT query-string settings, see the header. `fn` is the exported
// C name without its leading underscore. The UI value is a 0-100 integer for a
// range, 0|1 for a flag, and the option value for a choice; it is stored as
// such and converted only at the call (range / 100 -> float, flag -> 1.0|0.0,
// choice -> int).
export const LIVE = [
  { fn: 'pc_audio_set_volume', ctl: 'ctl-volume', tab: 'Audio', label: 'Volume',
    control: 'range', default: 80 },
  { fn: 'pc_audio_set_music_volume', ctl: 'ctl-music-volume', tab: 'Audio', label: 'Music',
    control: 'range', default: 70 },
  { fn: 'pc_audio_set_sfx_volume', ctl: 'ctl-sfx-volume', tab: 'Audio', label: 'Sound effects',
    control: 'range', default: 90 },
  { fn: 'pc_audio_set_reverb', ctl: 'ctl-reverb', tab: 'Audio', label: 'Reverb',
    control: 'flag', default: 1 },
  { fn: 'pc_widescreen_set_mode', ctl: 'ctl-aspect', tab: 'Video', label: 'Aspect',
    control: 'choice', default: 0,
    options: [[0, 'Original (73:60)'], [1, 'Widescreen 16:9'], [2, 'Fill the window']] },
];

const liveKey = (d) => `melee.live.${d.fn}`;

function liveArg(d, raw) {
  const n = Number(raw);
  if (d.control === 'range') return n / 100;
  if (d.control === 'flag') return n ? 1.0 : 0.0;
  return n | 0;
}

function storedLive(d) {
  try {
    const v = localStorage.getItem(liveKey(d));
    return v == null ? null : v;
  } catch { return null; }
}

// Calls the setter (when the runtime is up) and persists the UI value. With no
// runtime the value is still stored and applyStoredLive pushes it later.
function applyLive(d, raw) {
  const fn = globalThis.Module?.['_' + d.fn];
  if (typeof fn === 'function') fn(liveArg(d, raw));
  try { localStorage.setItem(liveKey(d), String(raw)); } catch { /* storage blocked: engine call above still took effect */ }
}

// The page calls this once after the runtime is up so stored values take
// effect. A control never touched has no stored value and is left alone, so the
// engine's own pref stays in force.
export function applyStoredLive() {
  for (const d of LIVE) {
    const v = storedLive(d);
    if (v != null) applyLive(d, v);
  }
}

// Builds the form into `host`. Returns the element, or null if `host` is
// missing, so a page without the markup degrades rather than throwing.
// `reload` takes the new query string, so a test can assert what Apply would
// navigate to without navigating.
export function addSettings(host, { reload = (search) => location.assign(search || location.pathname) } = {}) {
  if (!host) return null;
  const values = readSearch(location.search);
  const form = document.createElement('form');
  form.id = 'settings';
  // Not a submit: a GET submit would serialize every control, including the
  // defaults this deliberately omits from the URL.
  form.addEventListener('submit', (event) => event.preventDefault());

  const inputs = new Map();
  const panes = new Map();
  const pane = (name) => {
    let found = panes.get(name);
    if (!found) {
      found = document.createElement('div');
      found.className = panes.size ? 'pane off' : 'pane';
      panes.set(name, found);
    }
    return found;
  };
  // A child the URL does not name follows its parent, so it shows the parent's
  // state rather than a bare unchecked box that would misreport the engine.
  const shownValue = (setting) => (
    setting.parent && values[setting.key] == null
      ? values[setting.parent] : values[setting.key]);
  // Children that the player has not touched keep following the parent, so
  // ticking the parent must re-display them. A child the player set stays put.
  const touched = new Set();
  const kids = new Map();
  const folds = new Map();
  for (const setting of SETTINGS) {
    const row = document.createElement('label');
    // The board pins each control by this id, and the spec names it: an
    // env-backed row is ctl- plus the env name (tools/progress/mockup.py).
    // Without it a built control reads as missing to a parity check, which is
    // how four shipped rows were reported REGRESSED.
    row.id = `ctl-${setting.key}`;
    row.className = setting.parent ? 'setting child'
      : (SETTINGS.some((s) => s.parent === setting.key) ? 'setting parent' : 'setting');
    let input;
    if (setting.kind === 'flag') {
      input = document.createElement('input');
      input.type = 'checkbox';
      input.checked = isOn(shownValue(setting));
      if (setting.parent) {
        input.addEventListener('change', () => touched.add(setting.key));
        if (!kids.has(setting.parent)) kids.set(setting.parent, []);
        kids.get(setting.parent).push({ key: setting.key, input });
      }
      row.append(input, document.createTextNode(` ${setting.label}`));
    } else {
      input = document.createElement('select');
      for (const [value, text] of setting.options) {
        const option = document.createElement('option');
        option.value = value;
        option.textContent = text;
        if ((values[setting.key] ?? '') === value) option.selected = true;
        input.append(option);
      }
      row.append(document.createTextNode(`${setting.label} `), input);
    }
    input.name = setting.key;
    inputs.set(setting.key, input);
    // The hint is a tooltip, not a row of its own (#29 comment 3809). A hint
    // that costs a line per control spent the one phone viewport the panel has.
    if (setting.hint) row.title = setting.hint;
    if (setting.parent) {
      // A run of children sits open under its parent, with no fold and no
      // summary row (#29 comments 3181 and 3809). The summary was itself the
      // text bloat the ruling removes, and the fold cost a click on every
      // visit to save one row.
      let kidBox = folds.get(setting.parent);
      if (!kidBox) {
        kidBox = document.createElement('div');
        kidBox.className = 'kids';
        // MELEE_20XX -> kids-20xx: the board pins this box by this id.
        kidBox.id = `kids-${setting.parent.replace(/^MELEE_/, '').toLowerCase()}`;
        folds.set(setting.parent, kidBox);
        pane(setting.tab ?? TABS[0]).append(kidBox);
      }
      kidBox.append(row);
    } else {
      pane(setting.tab ?? TABS[0]).append(row);
    }
  }

  // Live rows. Deliberately not added to `inputs`: current() iterates only that
  // Map, so these can never reach buildSearch(). They have no `name` either.
  for (const d of LIVE) {
    const row = document.createElement('label');
    row.className = 'setting live';
    row.id = d.ctl;
    const label = document.createElement('span');
    label.className = 'setting-label';
    label.textContent = d.label;
    const saved = storedLive(d);
    const start = saved ?? d.default;
    let input;
    let event = 'change';
    if (d.control === 'range') {
      input = document.createElement('input');
      input.type = 'range';
      input.min = '0';
      input.max = '100';
      input.step = '1';
      input.value = String(start);
      event = 'input';
    } else if (d.control === 'flag') {
      input = document.createElement('input');
      input.type = 'checkbox';
      input.checked = Number(start) !== 0;
    } else {
      input = document.createElement('select');
      for (const [value, text] of d.options) {
        const option = document.createElement('option');
        option.value = String(value);
        option.textContent = text;
        if (String(value) === String(start)) option.selected = true;
        input.append(option);
      }
    }
    input.addEventListener(event, () => applyLive(
      d, d.control === 'flag' ? (input.checked ? 1 : 0) : input.value));
    row.append(label, input);
    pane(d.tab).append(row);
  }

  // The select-all. Only an untouched child follows, which is what
  // env_flag_or_20xx does: a child with its own value keeps it.
  for (const [parentKey, children] of kids) {
    const box = inputs.get(parentKey);
    if (!box) continue;
    box.addEventListener('change', () => {
      for (const kid of children) {
        if (!touched.has(kid.key)) kid.input.checked = box.checked;
      }
    });
  }

  // One head per pane. The heads come before the panes so a screen reader
  // reaches the control that switches a pane before the pane itself.
  const heads = document.createElement('div');
  heads.className = 'tab-heads';
  heads.id = 'setting-tabs';
  for (const [name, body] of panes) {
    const head = document.createElement('button');
    head.type = 'button';
    head.className = body.className === 'pane' ? 'tab on' : 'tab';
    head.textContent = name;
    head.addEventListener('click', () => {
      for (const [other, otherBody] of panes) {
        const front = other === name;
        otherBody.className = front ? 'pane' : 'pane off';
      }
      for (const other of heads.children) {
        other.className = other.textContent === name ? 'tab on' : 'tab';
      }
    });
    heads.append(head);
  }
  // The panes share one grid cell, so the stack keeps the height of the
  // tallest and a switch does not move the Apply button below it.
  const stack = document.createElement('div');
  stack.className = 'panes';
  for (const body of panes.values()) stack.append(body);
  // One wrapper over heads and panes, so the board can pin the tabbed body.
  const settingBody = document.createElement('div');
  settingBody.id = 'setting-body';
  settingBody.append(heads);
  settingBody.append(stack);
  form.append(settingBody);

  const current = () => {
    const out = {};
    for (const [key, input] of inputs) {
      out[key] = input.type === 'checkbox' ? (input.checked ? '1' : '') : input.value;
    }
    return out;
  };

  const link = document.createElement('input');
  link.id = 'settings-link';
  link.type = 'text';
  link.readOnly = true;
  link.setAttribute('aria-label', 'Shareable link for these settings');

  const apply = document.createElement('button');
  apply.id = 'settings-apply';
  apply.type = 'button';
  apply.textContent = 'Apply & reload';

  // Says why a press costs something, because it can: a disc the player picked
  // from their own machine cannot be carried across the reload.
  const note = document.createElement('p');
  note.id = 'settings-note';
  note.textContent =
    'Settings apply at boot, so the page reloads. A disc you picked yourself has to be chosen again.';

  const refresh = () => { link.value = new URL(buildSearch(current()) || '?', location.href).href; };
  form.addEventListener('change', refresh);
  refresh();
  apply.addEventListener('click', () => reload(buildSearch(current())));

  form.append(link, apply, note);
  host.append(form);
  return form;
}
