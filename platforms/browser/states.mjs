// SPDX-License-Identifier: GPL-3.0-or-later
// The save-state modal (#33). Load replaces the disc chip in the lobby bar.
//
// Why a modal rather than a section. The four preset tiles were a whole group
// in a panel that has one phone viewport (390x844) to spend, and they are
// pressed once a session. A press that opens them costs one button in the bar
// and gives the height back to the lobby, which is read continuously.
//
// Why <dialog>. showModal() brings the backdrop, the top layer, the focus
// trap and Esc-to-close with it, and ::backdrop is one CSS rule. A div with a
// class would need all four written here. The one thing it does not bring is a
// click on the backdrop, which is two lines below.
//
// Two groups, per the issue: the presets, and the states this player saved.
//
// What a preset actually is today. There is no state-snapshot path in the
// browser build -- nothing in src/pc exposes one to JS -- so a preset is the
// boot the engine can already do, which is a MELEE_BOOT_SCENE query string and
// a reload, the same mechanism drill.mjs uses for a drill link. Naming them
// save states is the design (#24); loading them is a boot until a snapshot
// path exists.
//
// The player's own saves are therefore names and query strings too, kept in
// localStorage. Same store and the same try/catch as tier.mjs: private mode
// and blocked site data throw on read and on write, and neither is fatal here.
import { mintRoom } from './lobby.mjs';

const KEY = 'melee.states';

// The four presets the issue names. Each is the query string that boots it.
export const PRESETS = [
  { id: 'vs', label: 'Versus', hint: 'Character select, 4 ports',
    search: '?MELEE_BOOT_SCENE=vs' },
  { id: '20xx', label: '20XX lobby', hint: 'Full cast, tournament rules',
    search: '?MELEE_20XX=1&MELEE_20XX_RULES=1' },
  { id: 'training', label: 'Training menu', hint: 'Hitboxes, no stocks',
    search: '?MELEE_BOOT_SCENE=training&MELEE_HITBOXES=1' },
  { id: 'event', label: 'Event stage', hint: 'Event match 1',
    search: '?MELEE_BOOT_SCENE=event' },
];

/**
 * The player's saved states, oldest first.
 *
 * Anything that is not an array of {label, search} objects is discarded
 * rather than rendered: the store is a string a visitor can edit, and a
 * half-valid entry would throw inside the render loop.
 */
export function readStates(store = globalThis.localStorage) {
  let raw;
  try {
    raw = store?.getItem(KEY);
  } catch {
    return [];
  }
  if (!raw) return [];
  try {
    const list = JSON.parse(raw);
    if (!Array.isArray(list)) return [];
    return list.filter((s) => s && typeof s.label === 'string'
      && typeof s.search === 'string');
  } catch {
    return [];
  }
}

/** Append one save, returning the new list. A failed write is not fatal. */
export function writeStates(list, store = globalThis.localStorage) {
  try {
    store?.setItem(KEY, JSON.stringify(list));
  } catch {
    // Private mode and blocked site data. The list still applies for this
    // page's lifetime, which is as much as the modal needs.
  }
  return list;
}

/**
 * The name for a state saved now: what the URL says plus the date.
 *
 * A save is the current query string, because that is the whole of what the
 * engine was told to do. With no flags set it is the title screen, which is
 * still worth a name rather than an empty label.
 */
export function stateName(search, now = new Date()) {
  const params = new URLSearchParams(search);
  params.delete('room');
  const flags = [...params.keys()].filter((k) => /^MELEE_/.test(k));
  const what = flags.length
    ? flags.map((k) => k.replace(/^MELEE_/, '').toLowerCase()).join(', ')
    : 'title screen';
  return `${what} · ${now.toISOString().slice(0, 10)}`;
}

/** The query string a save records: the MELEE_* flags, without the room. */
export function saveSearch(search) {
  const out = new URLSearchParams();
  for (const [k, v] of new URLSearchParams(search)) {
    if (/^MELEE_[A-Z0-9_]+$/.test(k)) out.set(k, v);
  }
  const query = out.toString();
  return query ? `?${query}` : '';
}

/**
 * Build the modal into `host`, returning { open, close, isOpen, refresh }.
 *
 * `load` takes the query string a tile asks for, so a test can assert what a
 * press would navigate to without navigating. That string carries a freshly
 * minted ?room=, per #35: see withRoom below for why the old room cannot
 * come along.
 *
 * `search` is where a save reads the current flags from, injected for the
 * same reason.
 */
export function addStates(host, {
  load = (search) => location.assign(search || location.pathname),
  search = () => location.search,
  store = globalThis.localStorage,
  now = () => new Date(),
  mint = mintRoom,
} = {}) {
  if (!host) return null;
  const doc = host.ownerDocument ?? document;
  const el = (tag, cls, text) => {
    const node = doc.createElement(tag);
    if (cls) node.className = cls;
    if (text != null) node.textContent = text;
    return node;
  };

  // A load mints a new room, it does not carry the old one (#35).
  //
  // A preset load is a reload: there is no snapshot path in the browser
  // build, so the page navigates and the signaling stream closes. Every peer
  // in the old room saw this player leave and take their port with them. If
  // the new page then rejoined on the same ?room=, it would arrive as a
  // stranger claiming a seat the others have already reassigned, and the two
  // sides would disagree about who holds which port.
  //
  // So the loader gets a fresh room and invites again. The cost is one
  // re-share; the alternative is a lobby whose port map is wrong and says
  // nothing about it.
  const withRoom = (stateSearch) => {
    const params = new URLSearchParams(stateSearch);
    params.set('room', mint());
    return `?${params}`;
  };

  const dialog = el('dialog', 'modal');
  dialog.id = 'load-modal';
  const sheet = el('div', 'sheet');
  sheet.id = 'states';

  const head = (text, sub) => {
    const h = el('h2', 'group-h', text);
    if (sub) h.append(el('span', 'sub-h', sub));
    return h;
  };

  const tile = (id, label, hint, stateSearch) => {
    const button = el('button', 'state');
    button.type = 'button';
    if (id) button.id = id;
    button.append(el('b', null, label), el('i', null, hint));
    button.addEventListener('click', () => load(withRoom(stateSearch)));
    return button;
  };

  const presets = el('div', 'states');
  for (const p of PRESETS) {
    presets.append(tile(`state-${p.id}`, p.label, p.hint, p.search));
  }

  const own = el('div', 'states');
  own.id = 'own-states';
  // The empty case is a line rather than nothing: a group with no tiles and
  // no text reads as a rendering fault.
  const empty = el('p', 'sub', 'No saves yet. Save current state keeps the '
    + 'flags this page is running with.');

  let saves = readStates(store);
  const renderOwn = () => {
    // replaceChildren, not children.length = 0: HTMLCollection.length is
    // read-only in a real DOM and assigning it throws, which a DOM stub that
    // models children as a plain array would never show.
    own.replaceChildren(...saves.map(
      (s, i) => tile(`state-own-${i + 1}`, s.label, s.hint ?? 'your save', s.search)));
    empty.hidden = saves.length > 0;
  };

  const save = el('button', 'primary', 'Save current state');
  save.type = 'button';
  save.id = 'state-save';
  save.addEventListener('click', () => {
    const current = saveSearch(search());
    saves = writeStates(
      [...saves, { label: stateName(search(), now()), search: current }], store);
    renderOwn();
  });

  const close = el('button', null, 'Close');
  close.type = 'button';
  close.id = 'load-close';
  close.addEventListener('click', () => dialog.close());

  const row = el('div', 'sheet-row');
  row.append(save, close);

  sheet.append(
    head('Load a save state', 'opens a new room'), presets,
    head('Your saves'), own, empty, row);
  dialog.append(sheet);
  // A click on the backdrop lands on the <dialog> itself, because the sheet
  // covers the rest of it. The only thing showModal does not give for free.
  dialog.addEventListener('click', (event) => {
    if (event.target === dialog) dialog.close();
  });
  host.append(dialog);
  renderOwn();

  return {
    dialog,
    open() {
      // The list can have changed in another tab since the last open.
      saves = readStates(store);
      renderOwn();
      dialog.showModal();
    },
    close() { dialog.close(); },
    get isOpen() { return !!dialog.open; },
    get saves() { return saves; },
  };
}
