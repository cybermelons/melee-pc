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
  { key: 'MELEE_20XX', tab: 'Game', kind: 'flag', label: '20XX conveniences',
    hint: 'Unlocks the cast and boots to character select.' },
  { key: 'MELEE_HITBOXES', tab: 'Video', kind: 'flag', label: 'Show hitboxes' },
  { key: 'MELEE_PAUSE', tab: 'Game', kind: 'flag', label: 'Allow pausing',
    hint: 'Tournament rules turn pausing off.' },
  { key: 'MELEE_PAUSE_ON_BLUR', tab: 'Audio', kind: 'flag', label: 'Pause when unfocused',
    hint: 'A hidden tab always pauses. This covers a visible but unfocused page.' },
  { key: 'MELEE_SCALE', tab: 'Video', kind: 'choice', label: 'Render scale',
    hint: 'Lower renders fewer pixels, to test whether pixel count is the limit.',
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
export function buildSearch(values, existing = '') {
  const params = new URLSearchParams(existing);
  for (const { key } of SETTINGS) params.delete(key);
  for (const [key, value] of Object.entries(values)) {
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
  for (const setting of SETTINGS) {
    const row = document.createElement('label');
    row.className = 'setting';
    let input;
    if (setting.kind === 'flag') {
      input = document.createElement('input');
      input.type = 'checkbox';
      input.checked = isOn(values[setting.key]);
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
    pane(setting.tab ?? TABS[0]).append(row);
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
