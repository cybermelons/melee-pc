// SPDX-License-Identifier: GPL-3.0-or-later
// Signaling for browser netplay: who holds which controller port, and a relay
// for WebRTC offer/answer. State is in memory; a room lives while a stream does.
import http from 'node:http';

const rooms = new Map(); // room -> { claims: [id|null, id|null], subs: Map<id, res> }
const CORS = { 'Access-Control-Allow-Origin': '*', 'Cross-Origin-Resource-Policy': 'cross-origin' };
const send = (room, event, data, except) => {
  for (const [id, res] of room.subs) if (id !== except) res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
};
const state = (room) => ({ claims: { 0: room.claims[0], 1: room.claims[1] } });

http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  const m = /^\/r\/([\w-]+)(\/events)?$/.exec(url.pathname);
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
      if (!room.subs.size) rooms.delete(name);
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
      if (room.claims[slot] && room.claims[slot] !== msg.from) { res.writeHead(409, CORS); return res.end(); }
      room.claims = room.claims.map((id) => (id === msg.from ? null : id));
      room.claims[slot] = msg.from;
      send(room, 'state', state(room));
    } else if (msg.type === 'offer' || msg.type === 'answer') {
      send(room, msg.type, { sdp: msg.sdp }, msg.from);
    } else { res.writeHead(400, CORS); return res.end(); }
    res.writeHead(204, CORS);
    res.end();
  });
}).listen(Number(process.env.PORT || 8101), '127.0.0.1');
