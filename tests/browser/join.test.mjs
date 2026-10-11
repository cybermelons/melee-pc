// SPDX-License-Identifier: GPL-3.0-or-later
// The join modal decides what a screenshot does not show: that the Join button
// is wired to anything at all (it was a dead control), that a full room cannot
// be pressed, that a press goes to the room it names, that an unreachable
// signal server is a line and not a throw, and that the server really reports
// the occupancy the list draws.
import test from 'node:test';
import assert from 'assert/strict';
import http from 'node:http';
import { addJoin } from '../../platforms/browser/join.mjs';
import { addLobby, detectSources } from '../../platforms/browser/lobby.mjs';
import { signalHandler } from '../../tools/browser/signal.mjs';

// Enough of the DOM for addJoin: the same hand-rolled stub as
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

const ROOMS = [
  { name: 'FIG7K2', here: 1, free: 1 },
  { name: 'FULL001', here: 2, free: 0 },
  { name: 'OPEN002', here: 1, free: 2 },
];

/** addJoin against the stub, returning the host, the api and the navigations. */
function build(opts = {}) {
  const host = stubDoc();
  const gone = [];
  const api = addJoin(host, {
    fetchRooms: async () => ROOMS,
    go: (name) => gone.push(name),
    ...opts,
  });
  return { host, api, gone };
}

test('the modal is shut until Join is pressed, and shuts again on Close', async () => {
  // Driven through addLobby, so it is the BUTTON that opens it. Join was built
  // with no click handler, and open() working on its own proves nothing about
  // that.
  const host = stubDoc();
  const join = addJoin(host, { fetchRooms: async () => ROOMS, go() {} });
  const lobbyHost = stubDoc();
  addLobby(lobbyHost, {
    room: 'r', sources: detectSources({}), onJoin: () => join.open(),
  });
  assert.equal(host.byId('join-modal').open, false, 'shut at load');
  lobbyHost.byId('join-btn').click();
  await new Promise((r) => setImmediate(r));
  assert.equal(join.isOpen, true, 'pressing Join must open the modal');
  host.byId('join-close').click();
  assert.equal(join.isOpen, false);
});

test('a room with no free seat is disabled and says so, a room with one is pressable', async () => {
  const { host, api } = build();
  await api.open();
  const open = host.byId('join-room-FIG7K2');
  const full = host.byId('join-room-FULL001');
  assert.equal(open.disabled, false);
  assert.equal(full.disabled, true);
  const hint = (b) => b.children.find((k) => k.tagName === 'i').textContent;
  assert.equal(hint(open), '1 here · 1 free');
  assert.match(hint(full), /2 here · 0 free/);
  assert.match(hint(full), /full/);
});

test('pressing a room navigates to that room and to no other', async () => {
  const { host, api, gone } = build();
  await api.open();
  host.byId('join-room-OPEN002').click();
  assert.deepEqual(gone, ['OPEN002'], 'the second open room, not the first');
});

test('the modal opens on the press, before the room list has arrived', async () => {
  // A press must not look dead while the signal server is thinking. The modal
  // shows itself and says it is reading, and the list replaces that line when
  // the answer comes. Awaiting the fetch first made the press silent for as
  // long as the server took, with no timeout anywhere.
  let answer;
  const { host, api } = build({ fetchRooms: () => new Promise((r) => { answer = r; }) });
  const opened = api.open();
  assert.equal(api.isOpen, true, 'shown before the fetch settles');
  const line = host.byId('join-list').children.find((k) => k.tagName === 'p');
  assert.equal(line.hidden, false);
  assert.match(line.textContent, /Reading/);
  answer(ROOMS);
  await opened;
  assert.equal(host.byId('join-list').children.find((k) => k.tagName === 'p').hidden, true,
    'the line gives way to the list');
  assert.ok(host.byId('join-room-FIG7K2'), 'and the rooms are rendered');
});

test('an unreachable signal server renders a line rather than throwing out of open', async () => {
  const { host, api } = build({ fetchRooms: async () => { throw new Error('down'); } });
  await assert.doesNotReject(() => api.open());
  assert.equal(api.isOpen, true, 'the modal still opens, with a line in it');
  const line = host.byId('join-list').children.find((k) => k.tagName === 'p');
  assert.equal(line.hidden, false);
  assert.match(line.textContent, /Could not reach/);
});

// Event streams never end on their own, so the server and the streams are
// torn down in a finally: a regression must fail, not hang the build.
async function withRooms(prefix, fn) {
  const srv = http.createServer((q, s) => signalHandler(q, s, prefix));
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const origin = `http://127.0.0.1:${srv.address().port}${prefix}`;
  const ctl = new AbortController();
  const sub = (room, me) => fetch(`${origin}/r/${room}/events?me=${me}`, { signal: ctl.signal });
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  try {
    await fn({ origin, sub, wait });
  } finally {
    ctl.abort();
    srv.closeAllConnections();
    await new Promise((r) => srv.close(r));
  }
}

test('the rooms endpoint reports occupancy and free seats', { timeout: 10000 }, async () => {
  await withRooms('', async ({ origin, sub, wait }) => {
    await sub('joinA', 'alice');
    await sub('joinA', 'bob');
    await sub('joinB', 'carol');
    await wait(100);
    const claim = await fetch(`${origin}/r/joinA`, {
      method: 'POST', body: JSON.stringify({ type: 'claim', player: 0, from: 'alice' }),
    });
    assert.equal(claim.status, 204);
    const res = await fetch(`${origin}/rooms`);
    assert.equal(res.status, 200);
    const byName = Object.fromEntries((await res.json()).map((r) => [r.name, r]));
    assert.deepEqual(byName.joinA, { name: 'joinA', here: 2, free: 1 });
    assert.deepEqual(byName.joinB, { name: 'joinB', here: 1, free: 2 });
  });
});

test('the rooms endpoint works under the mount prefix too', { timeout: 10000 }, async () => {
  await withRooms('/signal', async ({ origin, sub, wait }) => {
    await sub('joinP', 'alice');
    await wait(100);
    const res = await fetch(`${origin}/rooms`);
    assert.equal(res.status, 200);
    assert.ok((await res.json()).some((r) => r.name === 'joinP' && r.here === 1));
  });
});
