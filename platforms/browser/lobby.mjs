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
//
// A controller belongs to a port too (#30). Connecting one was a page-level
// button, which made sense while the page was one seat; with four ports a
// player is putting a pad on the seat they are taking, so each tile carries
// the control and the line that says what feeds it. The sources offered are
// the ones this browser can actually do, injected rather than read off
// `navigator`, because the combinations are the thing worth testing and a
// render path that reads a global cannot be driven from a test.

// The signal server accepts slot 0 and 1 only (tools/browser/signal.mjs:59).
// Four tiles are drawn because four is what a GameCube has and what the
// design is built around; PAIRABLE is how many a claim can currently reach.
export const PORTS = 4;
export const PAIRABLE = 2;

/**
 * Random hex, from getRandomValues rather than randomUUID.
 *
 * randomUUID exists only in a secure context. http://127.0.0.1 is one by
 * exemption, so every local test passed, but the tailnet address a phone
 * actually opens is plain http on a routable IP and is not: both callers below
 * threw "crypto.randomUUID is not a function", which left the page unable to
 * mint a room or an identity -- the whole lobby, dead on the one origin a
 * visitor uses.
 *
 * getRandomValues carries no such requirement. Uniqueness within a room is all
 * either id needs, and 8 hex digits is 32 bits of it, so nothing is lost.
 */
const randomHex = (bytes) => Array.from(crypto.getRandomValues(new Uint8Array(bytes)))
  .map((b) => b.toString(16).padStart(2, '0')).join('');

/** A room id short enough to read aloud and type from a phone. */
export const mintRoom = () => randomHex(4);

/**
 * This page's signaling identity, stable across a reload (#24).
 *
 * Loading a save state is a reload (states.mjs:16-21): there is no snapshot
 * path in the browser build, so a preset press is a MELEE_* query string plus
 * a navigation. That drops the event stream, which fires the close handler in
 * signal.mjs:59.
 *
 * That handler has a guard for exactly this -- "a refresh reuses the same id,
 * and its new stream can subscribe before this close fires" (signal.mjs:66)
 * -- but the guard is keyed on `me`, and a freshly minted UUID can never match
 * it. So every state load released the loader's port, which contradicts #24's
 * own second paragraph: a training scenario "does not cost anybody a port".
 *
 * sessionStorage is the right scope rather than localStorage: a tab is a seat.
 * It survives the reload and dies with the tab, so two tabs are two players
 * and a closed tab frees its port the way the close handler intends.
 *
 * Same try/catch as tier.mjs: private mode and blocked site data throw on both
 * read and write. Falling back to a fresh id costs the port on load, which is
 * the old behaviour -- worse, but not fatal, and better than no identity.
 */
export const ME_KEY = 'melee.me';
export function sessionId(store = globalThis.sessionStorage, mint = () => randomHex(16)) {
  try {
    const held = store?.getItem(ME_KEY);
    if (held) return held;
    const me = mint();
    store?.setItem(ME_KEY, me);
    return me;
  } catch {
    return mint();
  }
}

/**
 * The input sources a browser can actually offer (#30).
 *
 * `navigator` is a parameter rather than a global read, because the whole
 * point is the combinations: WebHID only on Chrome and Edge, the Gamepad API
 * on nearly everything but not in every embedding, touch always. A test
 * cannot drive those from the real navigator, and a render path that reads
 * the global cannot be tested at all.
 *
 * Touch is unconditional on purpose. It is the fallback the issue asks for:
 * a browser with neither of the other two must still have one way in, so the
 * button always has an outcome. The on-screen pad needs no device permission,
 * so there is nothing to detect.
 */
export const SOURCES = [
  { id: 'adapter', label: 'GameCube adapter', gesture: true },
  { id: 'gamepad', label: 'Bluetooth or USB pad', gesture: false },
  { id: 'touch', label: 'On-screen pad', gesture: false },
];

export function detectSources(nav = navigator) {
  const can = {
    adapter: !!nav?.hid,
    // getGamepads, not a `gamepad` key: the API is a navigator method, and
    // checking for a property that does not exist would make every browser
    // report no pad support.
    gamepad: typeof nav?.getGamepads === 'function',
    touch: true,
  };
  return SOURCES.filter((s) => can[s.id]);
}

/**
 * The per-port source record, which nothing else holds (#30).
 *
 * The signal server tracks who holds a port; it does not track what they
 * plugged into it, and the C side has no query either -- pc_touch_set_pad and
 * pc_gcadapter_web_report take a port index but keep no map back. So this is
 * the only record, and the tile reads it.
 *
 * A plain array of PORTS entries, null for a port nothing feeds.
 */
export const newPortSources = () => Array(PORTS).fill(null);

/** Put `source` on `port`, returning a new array. */
export function setPortSource(sources, port, source) {
  const out = sources.slice();
  if (port >= 0 && port < PORTS) out[port] = source;
  return out;
}

/** What the tile prints for a port's source. Em dash for nothing. */
export const sourceLabel = (source) => source ?? '—';

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
export function addLobby(host, {
  room, onClaim, onRelease, onCopy, onConnect, onLoad, sources = detectSources(),
} = {}) {
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
  // Load, where the disc chip used to be drawn (#33). The chip read a
  // percentage the browser build cannot measure -- remote-disc.mjs answers one
  // HTTP Range per block, so there is no total-loaded figure -- and the most
  // valuable slot in the bar is worth a press instead. What the disc line can
  // honestly say now sits under the bar, outside the modal.
  const loadBtn = el('button', null, 'Load');
  loadBtn.id = 'load-btn';
  loadBtn.type = 'button';
  loadBtn.title = 'Load a save state';
  if (onLoad) loadBtn.addEventListener('click', onLoad);
  left.append(el('span', 'lb-title', 'Melee'), loadBtn);
  const right = el('div', 'lb-right');
  const code = el('button');
  code.id = 'room-code';
  code.title = 'Copy the link to this lobby';
  // The room code alone (#6). The `<i>` label under it is gone: the title
  // already says what the press does, and #room-code is a flex row with a gap,
  // so dropping the child leaves no separator and no empty box behind. The
  // title is not enough on its own for a screen reader -- it reads the code as
  // the button's name and the title only as a hint -- so aria-label carries
  // the action that the visible word used to.
  code.setAttribute('aria-label', 'Copy the link to this lobby');
  code.append(el('b', null, room ?? ''));
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
    // Which source feeds this port. Always present, em dash when none, so the
    // tile does not change height when a controller is connected.
    const src = el('span', 'psrc', sourceLabel(null));
    // The controller button (#30). One per tile, because a player connects a
    // pad to the seat they are taking rather than to the page.
    const cbtn = el('button', 'cbtn', '⌘');
    cbtn.title = 'Connect a controller to this port';
    // The board pins #30 to #port-1-pad, so port 1 carries the id.
    if (i === 0) cbtn.id = 'port-1-pad';
    // The source list, built from what this browser detected. Hidden until
    // the press: WebHID needs a user gesture, and the gesture has to be the
    // press of a source, not the press of the page, so the picker is opened
    // from inside this handler's call stack.
    const menu = el('div', 'psrc-menu');
    menu.hidden = true;
    for (const s of sources) {
      const item = el('button', 'psrc-pick', s.label);
      item.addEventListener('click', () => {
        menu.hidden = true;
        onConnect?.(i, s.id);
      });
      menu.append(item);
    }
    // No sources at all cannot happen -- touch is unconditional -- but a
    // caller that injects an empty list gets a disabled button rather than
    // one that opens an empty menu.
    cbtn.disabled = sources.length === 0;
    cbtn.addEventListener('click', () => { menu.hidden = !menu.hidden; });
    const act = el('button', 'pbtn', 'Take');
    act.addEventListener('click', () => {
      if (tile.className.split(' ').includes('mine')) onRelease?.(i);
      else onClaim?.(i);
    });
    tile.append(name, who, src, cbtn, menu, act);
    ports.append(tile);
    tiles.push({ tile, name, who, act, tag, src, cbtn, menu });
  }

  const seat = el('p', 'sub seat-none');
  seat.id = 'no-port';
  seat.hidden = true;

  host.append(bar, ports, seat);

  // The per-port source record lives here, because nothing else holds it: the
  // signal server tracks claims only, and C keeps no map back from a port.
  let portSources = newPortSources();

  const api = {
    /** Paint the claims array onto the tiles. */
    render(claims, me) {
      for (const s of portStates(claims, me)) {
        const { tile, who, act, tag, src } = tiles[s.port];
        src.textContent = sourceLabel(portSources[s.port]);
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
      if (alone) seat.textContent = 'Spectating · you hold no port · take a free one or queue';
    },
    setRoom(value) { code.firstChild.textContent = value; },
    /**
     * Record that `source` now feeds `port`, and show it (#30).
     *
     * Painted straight onto the tile rather than waiting for the next
     * `state` event: connecting a controller changes nothing the signal
     * server knows, so no event follows and a render-only update would leave
     * the tile reading em dash until somebody else claimed a port.
     */
    setSource(port, source) {
      portSources = setPortSource(portSources, port, source);
      const tile = tiles[port];
      if (tile) tile.src.textContent = sourceLabel(portSources[port]);
    },
    /** The record, for the caller that needs to know what feeds a port. */
    get sources() { return portSources; },
    join,
    loadBtn,
  };

  // Paint an empty room before the server has said anything. Without this the
  // tiles keep the markup defaults until the first `state` event, which means
  // ports 3 and 4 read "free" with a live Take button, though a claim on them
  // cannot work until #6 lands the transport. A page whose signal server is
  // unreachable never gets that event at all, so the lie would be permanent.
  api.render([], null);
  return api;
}
