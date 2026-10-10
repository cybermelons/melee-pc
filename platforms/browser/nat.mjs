// NAT classification from the ICE candidates a pairing attempt already
// gathered, and the ICE server list it gathers them with.
//
// Hole punching works because each side learns the external address its NAT
// assigned, and sends there. A symmetric NAT breaks that: it assigns a
// different external port for every destination, so the address one STUN
// server reports is not the address the peer must send to. Gathering against
// two STUN servers makes this visible, because the two report different ports
// for one local port. No relay can be avoided in that case, so the player is
// told rather than left retrying.

const STUN = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun.cloudflare.com:3478' },
];

/** The ICE servers to gather with. `?ice=` overrides, as a JSON array of
 * RTCIceServer, which is how a TURN relay reaches the client with no rebuild. */
export function iceServers(search = typeof location === 'undefined' ? '' : location.search) {
  const raw = new URLSearchParams(search).get('ice');
  if (!raw) return STUN;
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed) && parsed.length) return parsed;
  } catch {
    // A malformed ?ice= must not stop pairing that STUN alone could serve.
  }
  return STUN;
}

/** 'symmetric' when one local port mapped to more than one external port,
 * 'cone' when two or more servers agreed on one mapping, 'unknown' otherwise.
 * One answer alone is 'unknown': a single mapping is what a symmetric NAT and
 * a cone NAT both produce, so it does not separate them. */
export function natKind(candidates) {
  // candidate:<foundation> <component> <proto> <pri> <ip> <port> typ <type> ...
  // raddr/rport name the local address a srflx candidate was mapped from.
  const byLocal = new Map();
  const seen = new Map();
  for (const c of candidates) {
    const m = /^(?:candidate:)?\S+ \d+ \S+ \d+ \S+ (\d+) typ srflx .*\brport (\d+)/.exec(c);
    if (!m) continue;
    const [, external, local] = m;
    if (!byLocal.has(local)) byLocal.set(local, new Set());
    byLocal.get(local).add(external);
    seen.set(local, (seen.get(local) || 0) + 1);
  }
  for (const [, ports] of byLocal) if (ports.size > 1) return 'symmetric';
  // Count answers, not distinct ports: two servers that agree is the evidence
  // for a cone NAT, and a Set of size 1 could be one answer or two identical.
  for (const [local, ports] of byLocal) {
    if (ports.size === 1 && seen.get(local) > 1) return 'cone';
  }
  return 'unknown';
}

// Send the offer once gathering has produced something usable, not once it
// is complete. A STUN server that resolves to an address with no route --
// every one of them does on an IPv4-only network, because they all publish
// AAAA records -- leaves gathering open until the browser's own timeout,
// which is far longer than a player will wait. One srflx candidate is
// already enough to hole punch, so stop waiting for the rest.
//
// "Usable" means a srflx candidate, not merely some candidate. A host
// candidate is a LAN address: two peers on different networks can do nothing
// with it, so an offer carrying only host candidates cannot connect and the
// failure reads as the other player's network. The 3 second cap is therefore
// a ceiling on the wait, not the thing that decides it -- whichever of the
// three arrives first wins, and the srflx arrival is the one that means the
// offer is worth sending.
export const gathered = (pc) => new Promise((resolve) => {
  if (pc.iceGatheringState === 'complete') return resolve();
  const done = () => {
    clearTimeout(timer);
    pc.removeEventListener('icecandidate', onCandidate);
    resolve();
  };
  const timer = setTimeout(done, 3000);
  // Reads the event rather than the shared candidates array, so this does
  // not depend on the order the two icecandidate listeners run in.
  const onCandidate = (e) => { if (e.candidate?.candidate.includes(' typ srflx ')) done(); };
  pc.addEventListener('icecandidate', onCandidate);
  pc.addEventListener('icegatheringstatechange', () => pc.iceGatheringState === 'complete' && done());
});
