// SPDX-License-Identifier: GPL-3.0-or-later
// Signaling for browser netplay: who holds which controller port, and a relay
// for WebRTC offer/answer. State is in memory; a room lives while a stream does.
import http from 'node:http';

const rooms = new Map(); // room -> { claims: [id|null, id|null], queue: id[], subs: Map<id, res> }
const CORS = { 'Access-Control-Allow-Origin': '*', 'Cross-Origin-Resource-Policy': 'cross-origin' };
const send = (room, event, data, except) => {
  for (const [id, res] of room.subs) if (id !== except) res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
};
const state = (room) => ({ claims: { 0: room.claims[0], 1: room.claims[1] }, queue: [...room.queue] });

// Hand a freed slot to the first in line (#23). The queue is not a waiting
// room -- under the no-wait ruling on #12 there is no pre-match state to wait
// in -- it is a claim-order arbiter: without it, two people racing for the
// same freed port means one of them gets a bare 409 with no recourse.
//
// Only a waiter still subscribed may be given the port. A page that left is
// dropped from the queue by the close handler, but a close that fires in the
// same tick as a release would otherwise hand the port to a ghost and put the
// room straight back into the state the close handler exists to prevent.
const promote = (room, slot) => {
  while (room.queue.length) {
    const next = room.queue.shift();
    if (!room.subs.has(next) || room.claims.includes(next)) continue;
    room.claims[slot] = next;
    return;
  }
};

// Free whatever slot this id holds and pass it on. Shared by the explicit
// `release` message and the stream-close path, so both orders agree.
const releaseFor = (room, id) => {
  const slot = room.claims.indexOf(id);
  if (slot === -1) return false;
  room.claims[slot] = null;
  promote(room, slot);
  return true;
};

// The handler is exported so a host page server can mount it under a path
// instead of running a second process on its own port. `prefix` is stripped
// before matching, so /signal/r/<room> and /r/<room> both work.
export function signalHandler(req, res, prefix = '') {
  const url = new URL(req.url, 'http://x');
  const pathname = prefix && url.pathname.startsWith(prefix)
    ? url.pathname.slice(prefix.length) : url.pathname;
  const m = /^\/r\/([\w-]+)(\/events)?$/.exec(pathname);
  if (!m) { res.writeHead(404, CORS); return res.end(); }
  const name = m[1];
  if (req.method === 'GET' && m[2]) {
    const me = url.searchParams.get('me');
    if (!me) { res.writeHead(400, CORS); return res.end(); }
    if (!rooms.has(name)) rooms.set(name, { claims: [null, null], queue: [], subs: new Map() });
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
      // Leaving the room also leaves the queue, for the same reason: a waiter
      // who has gone would otherwise be handed the next freed port and hold
      // it as a ghost.
      const waiting = room.queue.indexOf(me);
      if (waiting !== -1) room.queue.splice(waiting, 1);
      if (releaseFor(room, me) || waiting !== -1) send(room, 'state', state(room));
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
        // Still a 409: the claim did not take. But the claimant now holds a
        // place in line, so the state event tells them where, and the next
        // port to free comes to them in the order they asked.
        if (!room.queue.includes(msg.from)) {
          room.queue.push(msg.from);
          send(room, 'state', state(room));
        }
        res.writeHead(409, CORS);
        return res.end();
      }
      // Taking a port gives up the place in line; the wait is over.
      const waiting = room.queue.indexOf(msg.from);
      if (waiting !== -1) room.queue.splice(waiting, 1);
      // Dropping the claimant's previous slot frees it, so it goes to the
      // first in line rather than sitting empty while somebody waits.
      const prev = room.claims.indexOf(msg.from);
      if (prev !== -1 && prev !== slot) { room.claims[prev] = null; promote(room, prev); }
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
