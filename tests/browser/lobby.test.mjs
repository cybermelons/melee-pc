// SPDX-License-Identifier: GPL-3.0-or-later
// The lobby decides three things that are wrong in ways a screenshot does not
// show: which port is yours, whether you are a spectator, and whether a room
// id reaches the URL without reloading the page.
import test from 'node:test';
import assert from 'assert/strict';
import {
  PORTS, PAIRABLE, ensureRoom, portStates, mySlot, spectating, roomLink,
} from '../../platforms/browser/lobby.mjs';

const loc = (search, pathname = '/', origin = 'http://melee.test') =>
  ({ search, pathname, origin, href: `${origin}${pathname}${search}` });

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

// The gate shell.mjs uses: hold a port and the engine waits for the channel,
// hold none and it boots now. Before #22 the condition was "the URL named a
// room", which made a visitor who was sent a link wait for a match they were
// never in. The rule is small enough to state as a function, so state it and
// check it rather than leaving it in a comment.
const waitsForChannel = (claims, me) => mySlot(claims, me) >= 0;

test('holding a port makes the engine wait; holding none boots it', () => {
  assert.equal(waitsForChannel(['me', null], 'me'), true);
  assert.equal(waitsForChannel([null, null], 'me'), false,
    'an empty room is the solo case and must boot');
  assert.equal(waitsForChannel(['a', 'b'], 'me'), false,
    'a spectator must boot, not wait for a match it is not in');
  assert.equal(spectating(['a', 'b'], 'me'), true,
    'and that visitor is a spectator, which is why it must not wait');
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
