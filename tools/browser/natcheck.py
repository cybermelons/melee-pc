#!/usr/bin/env python3
"""Report whether this network can hole punch, before blaming the netplay code.

Pairing fails for two reasons that need different answers from the player, and
the browser cannot always separate them. This asks the question directly: send
a STUN binding request from one local UDP port to two different servers, and
compare the external mappings they report.

One mapping for both destinations is a cone NAT. The address a STUN server
reports is the address the peer must send to, so hole punching works.

Two different mappings is a symmetric NAT. The NAT picks a new external port
per destination, so no address learned from a STUN server is the one the peer
needs, and only a relay (TURN) connects the pair. See issue 17.

This is also the one netplay property a single machine can measure. Two tabs on
one host cannot perform a real hole punch: they would have to send to their own
public address from inside the NAT, which needs hairpinning that most consumer
routers do not do. Their failure says nothing about two real players.
"""
import os
import socket
import struct
import sys

SERVERS = [('stun.l.google.com', 19302), ('stun.cloudflare.com', 3478)]
MAGIC = 0x2112A442


def mapping(sock, host, port):
    """The (address, port) a STUN server sees, from XOR-MAPPED-ADDRESS."""
    sock.sendto(struct.pack('>HHI', 0x0001, 0, MAGIC) + os.urandom(12), (host, port))
    data, _ = sock.recvfrom(2048)
    i = 20  # past the fixed header, into the attributes
    while i + 4 <= len(data):
        kind, length = struct.unpack('>HH', data[i:i + 4])
        value = data[i + 4:i + 4 + length]
        if kind == 0x0020:
            xport = struct.unpack('>H', value[2:4])[0] ^ (MAGIC >> 16)
            xaddr = bytes(a ^ b for a, b in zip(value[4:8], MAGIC.to_bytes(4, 'big')))
            return socket.inet_ntoa(xaddr), xport
        i += 4 + length + (-length % 4)  # attributes are padded to 4 bytes
    raise ValueError('no XOR-MAPPED-ADDRESS in the response')


def main():
    sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    sock.bind(('0.0.0.0', 0))
    sock.settimeout(4)
    print(f'local port {sock.getsockname()[1]}')
    found = []
    for host, port in SERVERS:
        try:
            addr = mapping(sock, host, port)
        except Exception as err:  # unreachable, filtered, or a malformed answer
            print(f'  {host}:{port} FAIL {err!r}')
            continue
        found.append(addr)
        print(f'  {host}:{port} -> {addr[0]}:{addr[1]}')
    ports = {p for _, p in found}
    if len(ports) > 1:
        print('symmetric NAT: the mapping changes per destination, so direct play'
              ' needs a relay')
        return 2
    if len(ports) == 1:
        print('cone NAT: one mapping per local port, so hole punching works')
        return 0
    print('unknown: no server answered, so this says nothing about the NAT')
    return 1


if __name__ == '__main__':
    sys.exit(main())
