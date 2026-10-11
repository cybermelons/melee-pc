// SPDX-License-Identifier: GPL-3.0-or-later
// Signaling for browser netplay: who holds which controller port, and a relay
// for WebRTC offer/answer. State is in memory; a room lives while a stream does.
import http from 'node:http';

const rooms = new Map(); // room -> { claims: [id|null, id|null], subs: Map<id, res> }
const CORS = { 'Access-Control-Allow-Origin': '*', 'Cross-Origin-Resource-Policy': 'cross-origin' };
const send = (room, event, data, except) => {
  for (const [id, res] of room.subs) if (id !== except) res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
};
// claims goes over the wire as an array, because that is what every reader
// expects: lobby.mjs mySlot() calls .indexOf on it, and an object literal
// {0:..,1:..} threw "claims.indexOf is not a function" on every state event,
// which left the lobby unable to render any claim and pairing unable to start.
// Sliced to PAIRABLE so a reader cannot mistake a port the transport does not
// carry for a free seat.
//
// here is the roster for the lobby's list of people in the room. It is read
// straight off subs rather than tracked beside it: the close handler deletes a
// leaver from subs, so the roster cleans itself up and cannot drift from who
// is actually subscribed.
const state = (room) => ({ claims: room.claims.slice(0, 2), here: [...room.subs.keys()] });

// Free whatever slot this id holds. A freed port is takeable by anyone: there
// is no line and no "up next" (#23, owner ruling). Shared by the explicit
// `release` message and the stream-close path, so both orders agree.
const releaseFor = (room, id) => {
  const slot = room.claims.indexOf(id);
  if (slot === -1) return false;
  room.claims[slot] = null;
  return true;
};

// The handler is exported so a host page server can mount it under a path
// instead of running a second process on its own port. `prefix` is stripped
// before matching, so /signal/r/<room> and /r/<room> both work.
export function signalHandler(req, res, prefix = '') {
  const url = new URL(req.url, 'http://x');
  const pathname = prefix && url.pathname.startsWith(prefix)
    ? url.pathname.slice(prefix.length) : url.pathname;
  // The open rooms, for the lobby's Join list. A room with no subscribers is
  // already gone from the Map (the close handler deletes it), so everything
  // here has someone in it. A full room is listed with free:0 rather than
  // left out: a visitor can see it is full instead of wondering where it went.
  // free counts the same two pairable slots state() sends, for the same reason.
  if (req.method === 'GET' && pathname === '/rooms') {
    const open = [...rooms].map(([name, r]) => ({
      name, here: r.subs.size, free: r.claims.slice(0, 2).filter((c) => !c).length,
    }));
    res.writeHead(200, { ...CORS, 'Content-Type': 'application/json', 'Cache-Control': 'no-cache' });
    return res.end(JSON.stringify(open));
  }
  const m = /^\/r\/([\w-]+)(\/events)?$/.exec(pathname);
  if (!m) { res.writeHead(404, CORS); return res.end(); }
  const name = m[1];
  if (req.method === 'GET' && m[2]) {
    const me = url.searchParams.get('me');
    if (!me) { res.writeHead(400, CORS); return res.end(); }
    if (!rooms.has(name)) rooms.set(name, { claims: [null, null], subs: new Map() });
    const room = rooms.get(name);
    res.writeHead(200, { ...CORS, 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' });
    room.subs.set(me, res);
    res.write(`event: state\ndata: ${JSON.stringify(state(room))}\n\n`);
    req.on('close', () => {
      if (room.subs.get(me) === res) room.subs.delete(me);
      if (!room.subs.size) return rooms.delete(name);
      // Release the port too. A claim held by a page that has gone leaves the
      // button grey for everyone and makes the room report itself full, so
      // the other side waits for a peer that cannot answer.
      // A refresh reuses the same id, and its new stream can subscribe before
      // this close fires. Releasing then would drop the claim the new page just
      // retook, so only release when no stream for this id remains.
      if (room.subs.has(me)) return;
      if (releaseFor(room, me)) send(room, 'state', state(room));
    });
    return;
  }
  if (req.method !== 'POST' || m[2]) { res.writeHead(405, CORS); return res.end(); }
  let body = '';
  req.on('data', (c) => { body += c; });
  req.on('end', () => {
    let msg;
    const room = rooms.get(name);
    try { msg = JSON.parse(body); } catch { res.writeHead(400, CORS); return res.end(); }
    if (!room || !msg.from) { res.writeHead(404, CORS); return res.end(); }
    if (msg.type === 'claim') {
      const slot = msg.player;
      if (slot !== 0 && slot !== 1) { res.writeHead(400, CORS); return res.end(); }
      if (room.claims[slot] && room.claims[slot] !== msg.from) {
        // The port is taken: the claim did not take, and nothing is queued.
        res.writeHead(409, CORS);
        return res.end();
      }
      // Moving to another port frees the previous one for anyone to take.
      const prev = room.claims.indexOf(msg.from);
      if (prev !== -1 && prev !== slot) { room.claims[prev] = null; }
      room.claims[slot] = msg.from;
      send(room, 'state', state(room));
    } else if (msg.type === 'release') {
      if (!releaseFor(room, msg.from)) { res.writeHead(409, CORS); return res.end(); }
      send(room, 'state', state(room));
    } else if (msg.type === 'offer' || msg.type === 'answer') {
      send(room, msg.type, { sdp: msg.sdp }, msg.from);
    } else { res.writeHead(400, CORS); return res.end(); }
    res.writeHead(204, CORS);
    res.end();
  });
}

// Standalone: `node tools/browser/signal.mjs`. Importers get the handler only.
if (import.meta.url === `file://${process.argv[1]}`) {
  http.createServer(signalHandler).listen(Number(process.env.PORT || 8101), '127.0.0.1');
}
