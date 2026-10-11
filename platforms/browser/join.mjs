// SPDX-License-Identifier: GPL-3.0-or-later
// The join modal (#45). Join lists the lobbies that are open right now.
//
// Why a modal. Same reasons as the save-state modal in states.mjs: the list is
// read once, when a visitor decides where to go, so it costs one button in the
// bar and no height in the panel. It is a <dialog> for the same reasons too
// (backdrop, top layer, focus trap and Esc come with showModal; the backdrop
// click is the two lines below).
//
// Where the list comes from. The signal server holds every room in memory and
// serves them at GET /rooms. The list is fetched on every open, never cached:
// rooms appear and vanish as streams open and close, and a stale list sends a
// visitor to a lobby that has gone.
//
// A full room is listed, disabled, rather than hidden. You cannot take a seat
// that does not exist, but a room that silently vanishes from the list reads
// as a fault, and "full" is the answer the visitor wanted.
//
// A press navigates to ?room=<name>, the same shape as the link the room code
// button copies. It is a navigation, not a swap in place: the lobby, the
// signal stream and the port claim all belong to the room the page loaded with.
//
// The signal server being unreachable is the normal case for a visitor who was
// sent a link, so a failed fetch renders a line and never throws out of open().

/**
 * The open rooms from the signal server: [{ name, here, free }].
 *
 * The base is the one the shell joins with: ?signal= for a standalone server,
 * else the one mounted on this origin. Anything that is not an array of
 * {name} objects is discarded rather than rendered: the response is whatever
 * answered at that URL, and a half-valid entry would throw in the render loop.
 */
export async function fetchRooms(search = location.search) {
  const signal = new URLSearchParams(search).get('signal') || '/signal';
  const res = await fetch(`${signal}/rooms`);
  if (!res.ok) throw new Error(`rooms: ${res.status}`);
  const list = await res.json();
  if (!Array.isArray(list)) return [];
  return list.filter((r) => r && typeof r.name === 'string');
}

/**
 * Build the modal into `host`, returning { dialog, open, close, isOpen, rooms }.
 *
 * `go` takes the room a press asks for, so a test can assert what a press
 * would navigate to without navigating. `fetchRooms` is injected so a test
 * needs no network.
 */
export function addJoin(host, {
  fetchRooms: load = fetchRooms,
  go = (name) => location.assign(`?room=${encodeURIComponent(name)}`),
} = {}) {
  if (!host) return null;
  const doc = host.ownerDocument ?? document;
  const el = (tag, cls, text) => {
    const node = doc.createElement(tag);
    if (cls) node.className = cls;
    if (text != null) node.textContent = text;
    return node;
  };

  const dialog = el('dialog', 'modal');
  dialog.id = 'join-modal';
  const sheet = el('div', 'sheet');
  sheet.id = 'join-list';

  const list = el('div', 'states');
  // The empty case is a line rather than nothing: a group with no buttons and
  // no text reads as a rendering fault. It also says which empty it is.
  const empty = el('p', 'sub');

  let rooms = [];
  const render = (note) => {
    list.replaceChildren(...rooms.map((r) => {
      const full = !(r.free > 0);
      const button = el('button', 'state');
      button.type = 'button';
      button.id = `join-room-${r.name}`;
      button.disabled = full;
      button.append(el('b', null, r.name),
        el('i', null, `${r.here} here · ${r.free} free${full ? ' (full)' : ''}`));
      button.addEventListener('click', () => go(r.name));
      return button;
    }));
    empty.textContent = note ?? '';
    empty.hidden = rooms.length > 0;
  };

  const close = el('button', null, 'Close');
  close.type = 'button';
  close.id = 'join-close';
  close.addEventListener('click', () => dialog.close());
  const row = el('div', 'sheet-row');
  row.append(close);

  const heading = el('h2', 'group-h', 'Join a lobby');
  sheet.append(heading, list, empty, row);
  dialog.append(sheet);
  // A click on the backdrop lands on the <dialog> itself, because the sheet
  // covers the rest of it. The only thing showModal does not give for free.
  dialog.addEventListener('click', (event) => {
    if (event.target === dialog) dialog.close();
  });
  host.append(dialog);
  render('No open lobbies found.');

  return {
    dialog,
    async open() {
      // Shown first, filled after. Awaiting the fetch before showModal left
      // the Join press looking dead for as long as the signal server took to
      // answer, and an unreachable server is the normal case for a visitor who
      // was sent a link. So the modal opens on the press and says it is
      // reading, and the list replaces that line when the answer arrives.
      rooms = [];
      render('Reading the open lobbies…');
      dialog.showModal();
      // Re-read on every open: the set of rooms changes constantly.
      try {
        rooms = await load();
        render('No open lobbies found.');
      } catch {
        rooms = [];
        render('Could not reach the lobby server.');
      }
    },
    close() { dialog.close(); },
    get isOpen() { return !!dialog.open; },
    get rooms() { return rooms; },
  };
}
