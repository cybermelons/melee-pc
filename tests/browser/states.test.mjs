// SPDX-License-Identifier: GPL-3.0-or-later
// The save-state modal (#33) decides four things a screenshot does not show:
// that the modal is shut until Load is pressed, that it holds both groups
// rather than only the presets, that Save current state adds to the player's
// own group, and that a load mints a new room (#35).
//
// The height claims are not here. "shorter at 390px" and "fits the viewport"
// are measurements of the real CSS, so they live in
// tests/browser/launcher-layout.mjs, which drives a browser.
import test from 'node:test';
import assert from 'assert/strict';
import {
  PRESETS, readStates, writeStates, stateName, saveSearch, addStates,
} from '../../platforms/browser/states.mjs';
import { addLobby, detectSources } from '../../platforms/browser/lobby.mjs';

// Enough of the DOM for addStates: the same hand-rolled stub as
// lobby.test.mjs and touch.test.mjs, plus <dialog>'s open/showModal/close and
// replaceChildren, which is what the modal actually uses. jsdom would do it
// and is not a dependency this repo has.
function stubDoc() {
  const make = (tag) => {
    const node = {
      tagName: tag, id: '', className: '', textContent: '', title: '', type: '',
      hidden: false, disabled: false, open: false, children: [], handlers: {},
      append(...kids) { node.children.push(...kids); },
      replaceChildren(...kids) { node.children = [...kids]; },
      addEventListener(type, fn) {
        // Several listeners can land on one node (the dialog takes a click of
        // its own), so keep a list rather than the last one.
        (node.handlers[type] ??= []).push(fn);
      },
      click(target = node) {
        for (const fn of node.handlers.click ?? []) fn({ target });
      },
      attrs: {},
      setAttribute(name, value) { node.attrs[name] = value; },
      getAttribute(name) { return node.attrs[name] ?? null; },
      removeAttribute(name) { node[name] = ''; },
      // <dialog>: the real element sets .open, which is what the CSS and the
      // page read, so the stub does the same rather than tracking a flag of
      // its own that the code under test never sees.
      showModal() { node.open = true; },
      close() { node.open = false; },
      get firstChild() { return node.children[0]; },
      descendants() {
        return node.children.flatMap(
          (k) => (typeof k === 'string' ? [] : [k, ...k.descendants()]));
      },
      byId(id) { return node.descendants().find((k) => k.id === id); },
      find(sel) {
        const cls = sel.replace('.', '');
        return node.descendants()
          .filter((k) => String(k.className).split(' ').includes(cls));
      },
    };
    return node;
  };
  const host = make('div');
  host.ownerDocument = { createElement: make };
  return host;
}

/** A localStorage stand-in, so a test never touches the real one. */
const memStore = (initial) => {
  let value = initial ?? null;
  return {
    getItem: () => value,
    setItem: (_k, v) => { value = v; },
    get raw() { return value; },
  };
};

/** addStates against the stub, returning the host, the api and the loads. */
function build(opts = {}) {
  const host = stubDoc();
  const loads = [];
  const api = addStates(host, {
    load: (search) => loads.push(search),
    search: () => '?room=FIG7K2',
    store: memStore(),
    now: () => new Date('2026-10-09T12:00:00Z'),
    ...opts,
  });
  return { host, api, loads };
}

test('the modal is shut until Load is pressed, and shuts again on Close', () => {
  const { host, api } = build();
  const dialog = host.byId('load-modal');
  assert.equal(dialog.open, false, 'a modal open at load is a section again');
  api.open();
  assert.equal(api.isOpen, true);
  host.byId('load-close').click();
  assert.equal(api.isOpen, false);
});

test('the Load button in the lobby bar is what opens it', () => {
  // The wiring the page does: addLobby takes onLoad, and the button carries
  // the id the board pins #33 to.
  const lobbyHost = stubDoc();
  let opened = 0;
  const lobby = addLobby(lobbyHost, {
    room: 'r', sources: detectSources({}), onLoad: () => { opened += 1; },
  });
  const bar = lobbyHost.byId('lobby-bar');
  const button = bar.descendants().find((n) => n.id === 'load-btn');
  assert.ok(button, 'the bar must carry #load-btn, which the board pins to');
  assert.equal(button.textContent, 'Load');
  assert.equal(lobby.loadBtn, button);
  // In the bar's left group, beside the title, where the chip used to be.
  const left = bar.find('.lb-left')[0];
  assert.ok(left.children.includes(button), 'Load belongs in the bar, not below it');
  button.click();
  assert.equal(opened, 1);
});

test('no chip is left in the lobby bar', () => {
  // The other half of the first bullet: the bar holds the title, Load, the
  // room code and Join, and nothing that reads a disc percentage.
  const host = stubDoc();
  addLobby(host, { room: 'r', sources: detectSources({}) });
  const bar = host.byId('lobby-bar');
  const ids = bar.descendants().map((n) => n.id).filter(Boolean);
  assert.deepEqual(ids, ['load-btn', 'room-code', 'join-btn']);
  assert.ok(!bar.descendants().some((n) => n.id === 'disc-state'),
    'the disc line lives under the bar, outside it and outside the modal');
});

test('the modal holds both groups and the save action, not only presets', () => {
  const { host, api } = build({ store: memStore(JSON.stringify(
    [{ label: 'Fox ditto g3', search: '?MELEE_BOOT_SCENE=vs' }])) });
  api.open();
  // The four presets the issue names, each with the id the mockup draws.
  for (const p of PRESETS) {
    assert.ok(host.byId(`state-${p.id}`), `missing preset tile state-${p.id}`);
  }
  assert.equal(PRESETS.length, 4);
  // The player's own group, separate from the presets.
  const own = host.byId('own-states');
  assert.ok(own, 'the modal must carry #own-states');
  assert.equal(own.children.length, 1);
  assert.equal(own.children[0].id, 'state-own-1');
  // And the action.
  assert.ok(host.byId('state-save'));
});

test('Save current state adds a tile to the player\'s own group', () => {
  const store = memStore();
  const { host, api } = build({ store });
  api.open();
  assert.equal(host.byId('own-states').children.length, 0);
  host.byId('state-save').click();
  const own = host.byId('own-states');
  assert.equal(own.children.length, 1, 'the save must appear without a reload');
  // And it survives one: the store is what a second page reads.
  assert.equal(readStates(store).length, 1);
  assert.equal(readStates(store)[0].label, 'title screen · 2026-10-09');
});

test('a preset press loads that preset in a new room, not the old one', () => {
  const { host, api, loads } = build({ mint: () => 'NEWR00M' });
  api.open();
  host.byId('state-vs').click();
  assert.equal(loads.length, 1);
  assert.ok(loads[0].includes('MELEE_BOOT_SCENE=vs'), loads[0]);
  // #35: a load is a reload, so the old room has already written this player
  // off and reassigned their port. Rejoining it would make the two sides
  // disagree about the port map, so the loader mints a room and invites again.
  assert.ok(loads[0].includes('room=NEWR00M'), loads[0]);
  assert.ok(!loads[0].includes('FIG7K2'),
    `the old room must not ride along: ${loads[0]}`);
});

test('a load mints a room even when the player was in none', () => {
  // Opening the modal from a bare URL still produces a room, so the loaded
  // page is a lobby someone can be invited to rather than a dead end.
  const { host, api, loads } = build({ search: () => '', mint: () => 'FRESH1' });
  api.open();
  host.byId('state-20xx').click();
  assert.ok(loads[0].includes('room=FRESH1'), loads[0]);
});

test('a save records the flags and not the room', () => {
  // The room is where the state loads, not part of the state. A save that
  // carried it would send a second player into the first player's lobby.
  assert.equal(saveSearch('?room=FIG7K2&MELEE_20XX=1'), '?MELEE_20XX=1');
  assert.equal(saveSearch('?room=FIG7K2'), '');
  // A non-MELEE parameter is not a boot flag and does not belong in a state.
  assert.equal(saveSearch('?utm_source=x&MELEE_HITBOXES=1'), '?MELEE_HITBOXES=1');
});

test('a state name says what it boots, and names the title screen', () => {
  const day = new Date('2026-10-09T00:00:00Z');
  assert.equal(stateName('?room=r&MELEE_20XX=1', day), '20xx · 2026-10-09');
  assert.equal(stateName('?room=r', day), 'title screen · 2026-10-09');
});

test('a corrupt or blocked store reads as no saves, rather than throwing', () => {
  // The store is a string a visitor can edit, and private mode throws on both
  // read and write. Neither may take the modal down: the presets are the
  // thing a first-time visitor came for.
  assert.deepEqual(readStates(memStore('not json')), []);
  assert.deepEqual(readStates(memStore('{"not":"an array"}')), []);
  assert.deepEqual(readStates(memStore('[{"label":"no search"}]')), []);
  const throwing = {
    getItem() { throw new Error('blocked'); },
    setItem() { throw new Error('blocked'); },
  };
  assert.deepEqual(readStates(throwing), []);
  assert.doesNotThrow(() => writeStates([{ label: 'a', search: '' }], throwing));
  // And the modal still builds and still opens on a store that throws.
  const { host, api } = build({ store: throwing });
  api.open();
  assert.ok(host.byId('state-vs'));
  assert.equal(api.isOpen, true);
});

test('a click on the backdrop closes the modal, a click in the sheet does not', () => {
  const { host, api } = build();
  const dialog = host.byId('load-modal');
  api.open();
  // showModal gives Esc and the focus trap; the backdrop click is the one
  // thing it does not, so it is the one thing worth a test.
  dialog.click(host.byId('states'));
  assert.equal(api.isOpen, true, 'a click inside the sheet must not close it');
  dialog.click(dialog);
  assert.equal(api.isOpen, false);
});
