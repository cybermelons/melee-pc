import test from 'node:test';
import assert from 'node:assert/strict';
import { iceServers, natKind } from '../../platforms/browser/nat.mjs';

// A real srflx line, as RTCIceCandidate.candidate gives it.
const srflx = (external, rport) =>
  `candidate:2 1 udp 1686052607 203.0.113.7 ${external} typ srflx raddr 192.168.2.59 rport ${rport} generation 0`;

test('one local port with two external ports is symmetric', () => {
  assert.equal(natKind([srflx(40001, 50000), srflx(40002, 50000)]), 'symmetric');
});

test('two servers agreeing on one mapping is a cone NAT', () => {
  assert.equal(natKind([srflx(40001, 50000), srflx(40001, 50000)]), 'cone');
});

test('a single answer cannot tell the two apart', () => {
  assert.equal(natKind([srflx(40001, 50000)]), 'unknown');
});

test('host candidates alone say nothing', () => {
  const host = 'candidate:1 1 udp 2122260223 192.168.2.59 50000 typ host generation 0';
  assert.equal(natKind([host, host]), 'unknown');
});

test('different local ports do not make a NAT symmetric', () => {
  assert.equal(natKind([srflx(40001, 50000), srflx(40002, 50001)]), 'unknown');
});

test('STUN is the default, and ?ice= overrides it', () => {
  assert.equal(iceServers('').length, 2);
  const turn = [{ urls: 'turn:relay.example:3478', username: 'u', credential: 'p' }];
  assert.deepEqual(iceServers('?ice=' + encodeURIComponent(JSON.stringify(turn))), turn);
});

test('a malformed or empty ?ice= falls back to STUN rather than failing', () => {
  assert.equal(iceServers('?ice=not-json').length, 2);
  assert.equal(iceServers('?ice=[]').length, 2);
});
