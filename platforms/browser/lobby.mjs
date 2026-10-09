// SPDX-License-Identifier: GPL-3.0-or-later
// The lobby replaces the mode list (#22). Three things that used to be
// separate are one thing here:
//
// A visitor is in a room on arrival. The mode links each booted a different
// scene from a fresh page, so "which mode" was a navigation decision made
// before anything loaded. A save state loads into the room that already
// exists (#24), so the room comes first and the scene is a later choice.
//
// The room is the URL. ensureRoom mints an id into ?room= when none is there,
// with replaceState rather than a reload: the page is already loading, and a
// reload here would restart the engine the visitor is waiting for.
//
// Ports are the lobby's real state. The signal server already tracks claims
// and already pushes them on its `state` event, so this renders that array
// rather than keeping a second copy. What it cannot do yet is four of them:
// the WebRTC path in shell.mjs pairs exactly two peers, so slots 3 and 4 are
// drawn and disabled until #6 lands the transport that carries more.

// The signal server accepts slot 0 and 1 only (tools/browser/signal.mjs:59).
// Four tiles are drawn because four is what a GameCube has and what the
// design is built around; PAIRABLE is how many a claim can currently reach.
export const PORTS = 4;
export const PAIRABLE = 2;

/** A room id short enough to read aloud and type from a phone. */
export const mintRoom = () => crypto.randomUUID().slice(0, 8);

/**
 * The room this page is in, minting one when the URL names none.
 *
 * Returns the id and whether it was just minted, because a freshly minted
 * room has nobody else in it and the status line says a different thing.
 */
export function ensureRoom(location, history, mint = mintRoom) {
  const params = new URLSearchParams(location.search);
  const existing = params.get('room');
  if (existing) return { room: existing, minted: false };
  const room = mint();
  params.set('room', room);
  // replaceState, not assign: the engine is already loading on this page.
  history.replaceState(null, '', `${location.pathname}?${params}`);
  return { room, minted: true };
}

/**
 * What each tile shows, from the claims array the signal server sends.
 *
 * `claims` is sparse and positional: claims[i] is the id holding port i, or
 * null. `me` is this page's id. Anything past PAIRABLE is unreachable until
 * the transport carries more than two peers.
 */
export function portStates(claims, me) {
  const out = [];
  for (let i = 0; i < PORTS; i += 1) {
    const holder = claims[i] ?? null;
    out.push({
      port: i,
      holder,
      mine: holder !== null && holder === me,
      taken: holder !== null && holder !== me,
      // A tile past the pairable count is not "free", it is not yet possible.
      // Saying "free" and then refusing the claim is the worse of the two.
      reachable: i < PAIRABLE,
    });
  }
  return out;
}

/** Which port this page holds, or -1. The engine needs the number. */
export const mySlot = (claims, me) => {
  const i = claims.indexOf(me);
  return i === -1 ? -1 : i;
};

/**
 * Whether this visitor is a spectator: in the room, holding no port (#23).
 *
 * Distinct from "has not claimed yet": every pairable port being held by
 * somebody else is what makes a visitor a spectator, and the tiles alone do
 * not say it, because four tiles with two held reads as two free seats.
 */
export function spectating(claims, me) {
  if (mySlot(claims, me) !== -1) return false;
  // An index loop rather than .every(): the server sends a positional array,
  // so an unclaimed port can be a hole, and .every() skips holes. A sparse
  // [ , 'b'] would report every pairable port held and call a visitor in an
  // almost empty room a spectator.
  for (let i = 0; i < PAIRABLE; i += 1) {
    if (claims[i] === null || claims[i] === undefined) return false;
  }
  return true;
}

/** The link to share, which is this page's URL with its room. */
export const roomLink = (location) => {
  const params = new URLSearchParams(location.search);
  if (!params.get('room')) return location.href;
  return `${location.origin}${location.pathname}?${params}`;
};

/**
 * Build the lobby into `host`, returning the handles the page updates.
 *
 * The markup matches tools/progress/mockup.py, which is the target the issue
 * board measures against. Ids are the mockup's ids so a board pin anchored to
 * a control points at the same control here.
 */
export function addLobby(host, { room, onClaim, onRelease, onCopy } = {}) {
  const doc = host.ownerDocument ?? document;
  const el = (tag, cls, text) => {
    const node = doc.createElement(tag);
    if (cls) node.className = cls;
    if (text != null) node.textContent = text;
    return node;
  };

  const bar = el('header');
  bar.id = 'lobby-bar';
  const left = el('div', 'lb-left');
  left.append(el('span', 'lb-title', 'Melee'));
  const right = el('div', 'lb-right');
  const code = el('button');
  code.id = 'room-code';
  code.title = 'Copy the link to this lobby';
  code.append(el('b', null, room ?? ''), el('i', null, 'copy link'));
  if (onCopy) code.addEventListener('click', onCopy);
  const join = el('button', null, 'Join');
  join.id = 'join-btn';
  right.append(code, join);
  bar.append(left, right);

  const ports = el('div', 'ports');
  ports.id = 'ports';
  const tiles = [];
  for (let i = 0; i < PORTS; i += 1) {
    const tile = el('div', 'port');
    tile.id = `port-${i + 1}`;
    const name = el('b', null, `P${i + 1}`);
    // The "you" tag (#31). A word, because the inset bar that marks your tile
    // is a colour, and colour alone fails for a colour-blind player and fails
    // in a screenshot. Only one tile can carry the id, so render clears it
    // from the others rather than leaving two tiles claiming to be yours.
    const tag = el('span', 'mine-tag', 'you');
    tag.hidden = true;
    name.append(' ', tag);
    const who = el('i', null, 'free');
    const act = el('button', 'pbtn', 'Take');
    act.addEventListener('click', () => {
      if (tile.className.split(' ').includes('mine')) onRelease?.(i);
      else onClaim?.(i);
    });
    tile.append(name, who, act);
    ports.append(tile);
    tiles.push({ tile, name, who, act, tag });
  }

  const seat = el('p', 'sub seat-none');
  seat.id = 'no-port';
  seat.hidden = true;

  host.append(bar, ports, seat);

  const api = {
    /** Paint the claims array onto the tiles. */
    render(claims, me) {
      for (const s of portStates(claims, me)) {
        const { tile, who, act, tag } = tiles[s.port];
        const cls = ['port'];
        if (s.mine) cls.push('taken', 'mine');
        else if (s.taken) cls.push('taken');
        else cls.push('free');
        tile.className = cls.join(' ');
        who.textContent = s.mine ? 'you' : s.taken ? 'taken' : s.reachable ? 'free' : 'needs #6';
        act.textContent = s.mine ? 'Release' : 'Take';
        act.disabled = !s.reachable || s.taken;
        tag.hidden = !s.mine;
        // The board pins #31 to #port-mine, so the id has to be on the tile
        // that is actually yours. It moves with a claim and a release, which
        // is why it is set here and not in the markup.
        if (s.mine) tag.id = 'port-mine';
        else tag.removeAttribute('id');
      }
      const alone = spectating(claims, me);
      seat.hidden = !alone;
      if (alone) seat.textContent = 'Spectating · you hold no port · wait for one to free up';
    },
    setRoom(value) { code.firstChild.textContent = value; },
    join,
  };

  // Paint an empty room before the server has said anything. Without this the
  // tiles keep the markup defaults until the first `state` event, which means
  // ports 3 and 4 read "free" with a live Take button, though a claim on them
  // cannot work until #6 lands the transport. A page whose signal server is
  // unreachable never gets that event at all, so the lie would be permanent.
  api.render([], null);
  return api;
}
