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
export const TABS = ['Game', 'Video', 'Audio'];

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
    if (setting.hint) {
      const hint = document.createElement('span');
      hint.className = 'setting-hint';
      hint.textContent = setting.hint;
      row.append(hint);
    }
    if (setting.parent) {
      // A run of children folded under one summary. Always-open children cost
      // a row each for an exception most players never take, and the panel has
      // one phone viewport to spend. The parent carries the common case.
      let fold = folds.get(setting.parent);
      if (!fold) {
        fold = document.createElement('details');
        fold.className = 'kids';
        const summary = document.createElement('summary');
        summary.textContent = 'Individual settings';
        fold.append(summary);
        folds.set(setting.parent, fold);
        pane(setting.tab ?? TABS[0]).append(fold);
      }
      fold.append(row);
    } else {
      pane(setting.tab ?? TABS[0]).append(row);
    }
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
  form.append(heads);
  // The panes share one grid cell, so the stack keeps the height of the
  // tallest and a switch does not move the Apply button below it.
  const stack = document.createElement('div');
  stack.className = 'panes';
  for (const body of panes.values()) stack.append(body);
  form.append(stack);

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
