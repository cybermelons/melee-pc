// SPDX-License-Identifier: GPL-3.0-or-later
// The lobby decides three things that are wrong in ways a screenshot does not
// show: which port is yours, whether you are a spectator, and whether a room
// id reaches the URL without reloading the page.
import test from 'node:test';
import assert from 'assert/strict';
import { readFileSync } from 'fs';
import {
  PORTS, PAIRABLE, SOURCES, ensureRoom, portStates, mySlot, spectating, roomLink,
  addLobby, detectSources, newPortSources, setPortSource, sourceLabel,
  sessionId, ME_KEY,
} from '../../platforms/browser/lobby.mjs';

const loc = (search, pathname = '/', origin = 'http://melee.test') =>
  ({ search, pathname, origin, href: `${origin}${pathname}${search}` });

// Enough of the DOM for addLobby: elements that hold a class, an id, children
// and click listeners. Same approach as touch.test.mjs -- jsdom would do it
// and is not a dependency this repo has.
function stubDoc() {
  const make = (tag) => {
    const node = {
      tagName: tag, id: '', className: '', textContent: '', title: '',
      hidden: false, disabled: false, children: [], handlers: {},
      attrs: {},
      append(...kids) { node.children.push(...kids); },
      addEventListener(type, fn) { node.handlers[type] = fn; },
      setAttribute(name, value) { node.attrs[name] = value; },
      getAttribute(name) { return node.attrs[name] ?? null; },
      removeAttribute(name) { node[name] = ''; },
      get firstChild() { return node.children[0]; },
      /**
       * Every node under this one, so a test can look inside a tile. Strings
       * are skipped: the real append takes text nodes too, and the lobby
       * appends a literal space next to the "you" tag.
       */
      descendants() {
        return node.children.flatMap(
          (k) => (typeof k === 'string' ? [] : [k, ...k.descendants()]));
      },
      /**
       * Descendants carrying a class, in document order. Split rather than
       * compared whole: render() writes "port free" and "port taken mine".
       */
      find(sel) {
        const cls = sel.replace('.', '');
        return node.descendants()
          .filter((k) => String(k.className).split(' ').includes(cls));
      },
    };
    return node;
  };
  return { createElement: make, host: make('div') };
}

/** addLobby against the stub, with `nav` as the browser it detects. */
function buildLobby(nav, opts = {}) {
  const doc = stubDoc();
  const host = doc.host;
  host.ownerDocument = doc;
  const api = addLobby(host, { room: 'r', sources: detectSources(nav), ...opts });
  return { host, api };
}

test('a URL with no room gets one, without reloading the page', () => {
  const calls = [];
  const history = { replaceState: (...a) => calls.push(a) };
  const { room, minted } = ensureRoom(loc(''), history, () => 'abcd1234');
  assert.equal(room, 'abcd1234');
  assert.equal(minted, true);
  assert.equal(calls.length, 1, 'replaceState is the only navigation');
  assert.equal(calls[0][2], '/?room=abcd1234');
});

test('a URL that already names a room is left alone', () => {
  const history = { replaceState: () => assert.fail('must not navigate') };
  const { room, minted } = ensureRoom(loc('?room=keepme'), history);
  assert.equal(room, 'keepme');
  assert.equal(minted, false);
});

test('minting a room keeps the parameters already in the URL', () => {
  // A settings link carries MELEE_* flags. Minting a room must not drop them,
  // or applying a setting and then being put in a room would undo it.
  let url = '';
  const history = { replaceState: (_s, _t, u) => { url = u; } };
  ensureRoom(loc('?MELEE_20XX=1'), history, () => 'xyz');
  assert.ok(url.includes('MELEE_20XX=1'), url);
  assert.ok(url.includes('room=xyz'), url);
});

test('your own port reads as yours, not as taken', () => {
  const states = portStates(['me', 'other', null, null], 'me');
  assert.equal(states[0].mine, true);
  assert.equal(states[0].taken, false, 'your own port is not "taken"');
  assert.equal(states[1].taken, true);
  assert.equal(states[1].mine, false);
});

test('four tiles are drawn, and the ones past the pairable count say so', () => {
  const states = portStates([null, null, null, null], 'me');
  assert.equal(states.length, PORTS);
  assert.equal(states[0].reachable, true);
  assert.equal(states[PAIRABLE].reachable, false,
    'a port the transport cannot reach must not be offered as free');
});

test('mySlot finds the port you hold, and -1 when you hold none', () => {
  assert.equal(mySlot(['a', 'me'], 'me'), 1);
  assert.equal(mySlot(['a', 'b'], 'me'), -1);
  assert.equal(mySlot([], 'me'), -1);
});

test('holding no port while every pairable one is held is spectating', () => {
  assert.equal(spectating(['a', 'b'], 'me'), true);
});

test('a free port means you are not spectating, you just have not claimed', () => {
  // The distinction the tiles cannot draw: two of four tiles free reads as
  // two open seats, and calling that visitor a spectator is wrong.
  assert.equal(spectating(['a', null], 'me'), false);
  assert.equal(spectating([null, null], 'me'), false);
});

test('holding a port is never spectating, even with the rest full', () => {
  assert.equal(spectating(['me', 'b'], 'me'), false);
});

test('a sparse claims array does not read as a held port', () => {
  // The server sends a positional array, so a hole is undefined rather than
  // null. Treating undefined as a holder would make an empty room look full.
  const claims = [];
  claims[1] = 'b';
  assert.equal(spectating(claims, 'me'), false);
  assert.equal(portStates(claims, 'me')[0].taken, false);
});

test('the share link carries the room', () => {
  assert.equal(roomLink(loc('?room=FIG7K2')), 'http://melee.test/?room=FIG7K2');
});

// Nothing waits for a partner. The engine boots whatever the ports say, and a
// claim connects you into the game that is already running. This went through
// two wrong rules first, so both are checked here as regressions: "the URL
// named a room" blocked a visitor who only wanted to watch, and "you hold a
// port" still blocked a player whose partner never arrived.
//
// A rule about what the page does NOT do cannot be checked by calling a pure
// function, so this reads the module. The thing that would break it is a
// top-level `await` on the pairing promise coming back, which is how both
// wrong versions were written.
test('the shell does not wait for a partner before booting', () => {
  const shell = readFileSync(
    new URL('../../platforms/browser/shell.mjs', import.meta.url), 'utf8');
  // Comments are stripped first: this file explains the two wrong rules it
  // replaced, and a test that reads prose as code fails on its own history.
  const code = shell.replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n').map((l) => l.replace(/\/\/.*$/, '')).join('\n');
  assert.ok(!/\bawait\s+(pairing|done)\b/.test(code),
    'a wait for a partner is back in shell.mjs');
  assert.ok(/^joinLobby\(\);$/m.test(shell),
    'joinLobby must be called without await, so signalling does not gate the boot');
});

test('holding a port with no partner is not a wait', () => {
  // The case that made the previous rule wrong. This visitor holds P1 and has
  // nobody to pair with, and must be looking at a running game rather than a
  // lobby that never proceeds.
  assert.equal(mySlot(['me', null], 'me'), 0, 'the port is held');
  assert.equal(spectating(['me', null], 'me'), false, 'and this is not spectating');
});

test('two players with the same name do not both read as you (#31)', () => {
  // The case the marker exists for. Claims hold the server-assigned id, not
  // the display name, so two players called "kiri" are still two ids. A
  // marker that matched on the name would mark both tiles.
  const states = portStates(['kiri-a', 'kiri-b'], 'kiri-b');
  assert.equal(states[0].mine, false, 'the other player is not you');
  assert.equal(states[1].mine, true);
  assert.equal(states.filter((s) => s.mine).length, 1,
    'exactly one tile can be yours');
});

test('the marker moves on release, and nothing is yours after it', () => {
  // #31 asks for the marker to follow a claim and a release with no reload.
  // Release is the server dropping the id from the array, so the only thing
  // that has to hold is that no tile claims to be yours afterwards.
  assert.equal(portStates(['me', 'b'], 'me').filter((s) => s.mine).length, 1);
  assert.equal(portStates([null, 'b'], 'me').filter((s) => s.mine).length, 0);
});

// Controller connect per port (#30). Two things here are wrong in ways a
// screenshot does not show: which sources a browser is offered, and which
// port a connected controller is recorded against.

test('a browser with everything is offered all three sources', () => {
  const ids = detectSources({ hid: {}, getGamepads: () => [] }).map((s) => s.id);
  assert.deepEqual(ids, ['adapter', 'gamepad', 'touch']);
});

test('a browser with no WebHID is not offered the adapter at all', () => {
  // The issue's rule: a source the browser cannot do is ABSENT, not present
  // and failing. An iPhone has no WebHID, and the old page-level button hid
  // itself there because it had one outcome.
  const ids = detectSources({ getGamepads: () => [] }).map((s) => s.id);
  assert.ok(!ids.includes('adapter'), ids.join());
  assert.deepEqual(ids, ['gamepad', 'touch']);
});

test('a browser with no Gamepad API is not offered a pad', () => {
  const ids = detectSources({ hid: {} }).map((s) => s.id);
  assert.deepEqual(ids, ['adapter', 'touch']);
});

test('a browser with neither still offers touch, so the button has an outcome', () => {
  // The last bullet of #30. The failure this prevents is a controller button
  // that opens an empty list, which is the page-level button's old problem
  // moved onto four tiles instead of fixed.
  const ids = detectSources({}).map((s) => s.id);
  assert.deepEqual(ids, ['touch']);
  assert.equal(detectSources(null).length, 1, 'no navigator at all is still touch');
});

test('getGamepads is checked as a method, not as a property', () => {
  // The bug this catches: testing `nav.gamepad` or `'getGamepads' in nav` on
  // a navigator-shaped object. Every real browser has the method, so a wrong
  // check reports no pad support everywhere and silently drops the source.
  assert.ok(detectSources({ getGamepads: () => [] }).some((s) => s.id === 'gamepad'));
  assert.ok(!detectSources({ getGamepads: 'yes' }).some((s) => s.id === 'gamepad'),
    'a non-callable getGamepads is not the Gamepad API');
});

test('WebHID is the only source that needs a user gesture', () => {
  // The third bullet of #30: the picker opens from the press. The flag is
  // what tells the shell which source must stay inside the click's stack.
  const gesture = SOURCES.filter((s) => s.gesture).map((s) => s.id);
  assert.deepEqual(gesture, ['adapter']);
});

test('a fresh port record says nothing feeds any port', () => {
  const sources = newPortSources();
  assert.equal(sources.length, PORTS);
  assert.deepEqual(sources, [null, null, null, null]);
  assert.equal(sourceLabel(sources[0]), '—', 'an unfed port prints a dash, not "null"');
});

test('a source lands on the port it was chosen on, and only that port', () => {
  // The record #30 says does not exist yet. pc_touch_set_pad and
  // pc_gcadapter_web_report both take a port index, so C can route more than
  // one source; nothing on either side remembers which port chose which.
  let s = newPortSources();
  s = setPortSource(s, 2, 'touch');
  assert.deepEqual(s, [null, null, 'touch', null]);
  s = setPortSource(s, 0, 'adapter');
  assert.deepEqual(s, ['adapter', null, 'touch', null],
    'a second connect must not move the first');
});

test('setting a port source does not mutate the array handed in', () => {
  // render() reads the record every repaint. A mutating setter would make the
  // tile and the record agree by accident and hide a stale read.
  const before = newPortSources();
  const after = setPortSource(before, 1, 'gamepad');
  assert.deepEqual(before, [null, null, null, null]);
  assert.equal(after[1], 'gamepad');
});

test('a port index outside the four is ignored rather than growing the record', () => {
  assert.deepEqual(setPortSource(newPortSources(), 9, 'touch'), [null, null, null, null]);
  assert.deepEqual(setPortSource(newPortSources(), -1, 'touch'), [null, null, null, null]);
});

test('replacing a port source replaces it rather than keeping both', () => {
  // Swapping a touch pad for an adapter on the same seat. A port is fed by
  // one thing, so the tile must not end up printing two.
  let s = setPortSource(newPortSources(), 0, 'touch');
  s = setPortSource(s, 0, 'adapter');
  assert.equal(s[0], 'adapter');
});

test('every port tile gets a controller button, and port 1 carries the board id', () => {
  // The first bullet of #30, through the real addLobby. The id is the anchor
  // tools/progress/build.py checks against the mockup, so it has to be on the
  // element the board pin points at.
  const { host } = buildLobby({ hid: {}, getGamepads: () => [] });
  const tiles = host.find('.port');
  assert.equal(tiles.length, PORTS);
  for (const tile of tiles) {
    assert.equal(tile.descendants().filter((n) => n.className === 'cbtn').length, 1,
      'one controller button per tile');
    assert.equal(tile.descendants().filter((n) => n.className === 'psrc').length, 1,
      'and one line saying what feeds it');
  }
  const pads = host.find('.cbtn');
  assert.equal(pads[0].id, 'port-1-pad');
  assert.deepEqual(pads.slice(1).map((p) => p.id), ['', '', ''],
    'only one element may carry the anchor id');
});

test('the offered list holds only the sources this browser can do', () => {
  const full = buildLobby({ hid: {}, getGamepads: () => [] });
  assert.deepEqual(full.host.find('.psrc-pick').slice(0, 3).map((n) => n.textContent),
    SOURCES.map((s) => s.label));
  const phone = buildLobby({});
  const labels = phone.host.find('.psrc-pick').map((n) => n.textContent);
  assert.equal(labels.length, PORTS, 'one item per tile, which is touch alone');
  assert.ok(labels.every((l) => l === 'On-screen pad'), labels.join());
});

test('the source list is closed until the button is pressed', () => {
  // WebHID needs a user gesture, so nothing may open a picker on load. The
  // list being hidden at build time is what proves no load-time path exists.
  const { host } = buildLobby({ hid: {}, getGamepads: () => [] });
  assert.ok(host.find('.psrc-menu').every((m) => m.hidden));
});

test('pressing a source reports the port and the source, and closes the list', () => {
  const calls = [];
  const { host } = buildLobby({ hid: {}, getGamepads: () => [] },
    { onConnect: (...a) => calls.push(a) });
  const tile = host.find('.port')[2];
  const menu = tile.descendants().find((n) => n.className === 'psrc-menu');
  tile.descendants().find((n) => n.className === 'cbtn').handlers.click();
  assert.equal(menu.hidden, false, 'the press opens the list');
  menu.children.find((n) => n.textContent === 'GameCube adapter').handlers.click();
  assert.deepEqual(calls, [[2, 'adapter']], 'the third tile is port index 2');
  assert.equal(menu.hidden, true);
});

test('a tile shows which source feeds it, and only that tile', () => {
  // The second bullet of #30. Painted by setSource rather than by render,
  // because connecting a controller changes nothing the signal server knows,
  // so no `state` event follows it.
  const { host, api } = buildLobby({ hid: {}, getGamepads: () => [] });
  const shown = () => host.find('.psrc').map((n) => n.textContent);
  assert.deepEqual(shown(), ['—', '—', '—', '—']);
  api.setSource(1, 'touch');
  assert.deepEqual(shown(), ['—', 'touch', '—', '—']);
  assert.equal(api.sources[1], 'touch');
});

test('a repaint from the server keeps what the tile says feeds it', () => {
  // The regression: render() repaints every tile from the claims array, and
  // claims carry no source. A render that rebuilt the line from the claims
  // would wipe a connected controller the moment anybody else took a seat.
  const { host, api } = buildLobby({ hid: {}, getGamepads: () => [] });
  api.setSource(0, 'adapter');
  api.render(['me', 'other', null, null], 'me');
  assert.equal(host.find('.psrc')[0].textContent, 'adapter');
});

test('a browser that can do nothing gets a disabled button, not an empty list', () => {
  // Cannot happen through detectSources, which always has touch. This is the
  // guard for a caller that injects a list, so the button never opens empty.
  const { host } = buildLobby({}, { sources: [] });
  assert.ok(host.find('.cbtn').every((b) => b.disabled));
});

test('the shell opens the WebHID picker from the press and never from a load', () => {
  // #30's third bullet is a rule about what the page does NOT do, which no
  // pure function can check, so this reads the module. The thing that would
  // break it is adapter.request() back on a load path, or resume() growing
  // into a picker.
  const shell = readFileSync(
    new URL('../../platforms/browser/shell.mjs', import.meta.url), 'utf8');
  const code = shell.replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n').map((l) => l.replace(/\/\/.*$/, '')).join('\n');
  assert.ok(/adapter\.request\(\)/.test(code), 'the adapter plumbing is still wired');
  // request() may appear once only, inside connectPort, which onConnect calls
  // from the tile's click handler.
  assert.equal(code.match(/adapter\.request\(\)/g).length, 1);
  assert.ok(/async function connectPort\(/.test(code));
  assert.ok(/connectPort\(i, source\)/.test(code),
    'the port button is what calls it');
  assert.ok(!/\$\('adapter'\)/.test(code),
    'the page-level connect button is gone (#30)');
});

test('a spectator is told to take a free port or queue (#23)', () => {
  // The exact wording the issue asks for, middle dots and all. It drifted
  // once already -- the page said "wait for one to free up" while the mockup
  // said this -- so the string is asserted whole rather than by keyword.
  const { host, api } = buildLobby({ getGamepads: () => [] });
  api.render(['a', 'b', null, null], 'me');
  const seat = host.descendants().find((n) => n.id === 'no-port');
  assert.equal(seat.hidden, false);
  assert.equal(
    seat.textContent,
    'Spectating · you hold no port · take a free one or queue');
});

test('the room code button shows no "copy link" label but still has a name (#6)', () => {
  // The visible word is gone; the button is still reachable. A button whose
  // only content is the room code announces as the code, so the action lives
  // in aria-label and in the title that draws the hover.
  const { host } = buildLobby({ getGamepads: () => [] }, { room: 'FIG-7K2' });
  const code = host.descendants().find((n) => n.id === 'room-code');
  assert.ok(code, 'the room code button is still drawn');
  const text = code.descendants()
    .map((n) => n.textContent).concat(code.textContent).join(' ');
  assert.ok(!/copy link/i.test(text), 'no visible "copy link" text');
  assert.ok(!code.descendants().some((n) => n.tagName === 'i'),
    'the <i> is dropped, not left empty');
  assert.equal(code.title, 'Copy the link to this lobby');
  assert.equal(code.getAttribute('aria-label'), 'Copy the link to this lobby');
  // setRoom writes through firstChild, which is now the only child.
  assert.equal(code.firstChild.textContent, 'FIG-7K2');
});

test('neither the page nor the mockup still says "copy link" (#6)', () => {
  // Both sources, because the mockup is what the board renders and the page
  // is what a visitor sees; one being fixed is how they drifted last time.
  for (const rel of ['../../platforms/browser/lobby.mjs', '../../tools/progress/mockup.py']) {
    const src = readFileSync(new URL(rel, import.meta.url), 'utf8');
    assert.ok(!/>copy link</.test(src), `${rel} still renders "copy link"`);
    assert.ok(!/wait for one to free up/.test(src), `${rel} still has the old #23 tail`);
  }
});

// A seat has to survive a reload (#24). Loading a save state is a reload, so
// an identity minted per page load hands the port back to the room every time
// -- which is exactly what the issue's second paragraph says must not happen.
const memStore = (init = {}) => {
  const m = new Map(Object.entries(init));
  return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, String(v)), map: m };
};

test('sessionId is stable across reloads in the same tab', () => {
  const store = memStore();
  let n = 0;
  const mint = () => `uuid-${n += 1}`;
  const first = sessionId(store, mint);
  // A reload re-runs the module against the same sessionStorage.
  const second = sessionId(store, mint);
  assert.equal(second, first, 'a reload keeps the identity the port is held under');
  assert.equal(n, 1, 'and does not mint a second id');
  assert.equal(store.getItem(ME_KEY), first, 'the id is what was stored');
});

test('sessionId is different in a different tab', () => {
  // Two tabs are two players: sessionStorage is per-tab, so each gets its own
  // seat. localStorage would make a second tab steal the first one's port.
  let n = 0;
  const mint = () => `uuid-${n += 1}`;
  assert.notEqual(sessionId(memStore(), mint), sessionId(memStore(), mint));
});

test('sessionId defaults to the per-tab store, not the shared one', () => {
  // The scope is the whole point and the default is what ships: localStorage
  // is shared across every tab on the origin, so two tabs would send the same
  // `me` and the second would take over the first one's port.
  const src = readFileSync(new URL('../../platforms/browser/lobby.mjs', import.meta.url), 'utf8');
  const sig = /export function sessionId\(store = globalThis\.(\w+)/.exec(src);
  assert.ok(sig, 'sessionId still takes an injectable store');
  assert.equal(sig[1], 'sessionStorage', 'the default store must be per-tab');
});

test('sessionId still yields an id when the store throws', () => {
  // Private mode and blocked site data throw on read and on write. Losing the
  // port on load is the old behaviour; having no identity at all is worse.
  const boom = { getItem() { throw new Error('denied'); }, setItem() { throw new Error('denied'); } };
  assert.match(sessionId(boom, () => 'fallback'), /fallback/);
  const writeOnly = { getItem: () => null, setItem() { throw new Error('denied'); } };
  assert.equal(sessionId(writeOnly, () => 'fresh'), 'fresh');
});

test('the lobby identity is not minted fresh per page load', () => {
  // The regression guard. signal.mjs:66 only keeps a claim across a refresh
  // when the id matches, so shell.mjs must not call randomUUID for `me`.
  const src = readFileSync(new URL('../../platforms/browser/shell.mjs', import.meta.url), 'utf8');
  assert.ok(/const me = sessionId\(\)/.test(src), 'shell.mjs takes `me` from sessionId');
  assert.ok(!/const me = crypto\.randomUUID\(\)/.test(src),
    'shell.mjs must not mint a fresh id for `me`; a state load would drop the port');
});
