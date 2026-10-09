"""The XOR-MAPPED-ADDRESS parser must survive a real server's extra attributes.

A STUN server is free to put other attributes before the one we want, and to
pad each to 4 bytes. A parser that assumes the mapping comes first, or that
forgets the padding, reads a wrong port and reports a symmetric NAT on a
network that is not one. That misdirects the player to a relay they do not
need, so the walk over the attributes is worth pinning.
"""
import importlib.util
import os
import socket
import struct
import sys
import threading

MAGIC = 0x2112A442
ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
spec = importlib.util.spec_from_file_location(
    'natcheck', os.path.join(ROOT, 'tools/browser/natcheck.py'))
natcheck = importlib.util.module_from_spec(spec)
spec.loader.exec_module(natcheck)


def attr(kind, value):
    return struct.pack('>HH', kind, len(value)) + value + b'\0' * (-len(value) % 4)


def response(tid, ip, port):
    xport = port ^ (MAGIC >> 16)
    xaddr = bytes(a ^ b for a, b in zip(socket.inet_aton(ip), MAGIC.to_bytes(4, 'big')))
    body = (
        # SOFTWARE first, with a length that is not a multiple of 4, so a
        # parser that skips the padding lands mid-attribute from here on.
        attr(0x8022, b'test server')
        + attr(0x0020, b'\0\x01' + struct.pack('>H', xport) + xaddr)
    )
    return struct.pack('>HHI', 0x0101, len(body), MAGIC) + tid + body


def serve(sock, ip, port):
    data, peer = sock.recvfrom(2048)
    sock.sendto(response(data[8:20], ip, port), peer)


def main():
    server = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    server.bind(('127.0.0.1', 0))
    threading.Thread(target=serve, args=(server, '203.0.113.7', 41234),
                     daemon=True).start()
    client = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    client.bind(('127.0.0.1', 0))
    client.settimeout(4)
    got = natcheck.mapping(client, *server.getsockname())
    assert got == ('203.0.113.7', 41234), got
    print('pass: natcheck reads the mapping past a padded earlier attribute')
    return 0


if __name__ == '__main__':
    sys.exit(main())
