#!/usr/bin/env python3
"""Check the pairing code configures ICE and reports an ICE failure.

An empty iceServers list makes each browser gather host candidates only, which
are LAN addresses. Two players on different networks then never learn an
address the other can reach, so hole punching is never even attempted and
pairing hangs. A STUN server gets each side its public address.

This regressed once in a way worth pinning: the fix was applied to a deployed
copy of shell.mjs and never to this source tree, so the source kept an empty
list and every later build dropped the fix. The gate exists so the source is
what gets checked.

The servers themselves live in nat.mjs, which shell.mjs calls through
iceServers(). That indirection is the point: `?ice=` can supply a TURN relay
without a rebuild. So this gate reads both files, and requires that every
iceServers() path ends at the STUN list rather than at an empty one.

Symmetric NAT still needs a TURN relay. That is unimplemented, so the page must
at least say why it failed rather than show "Pairing..." for ever.
"""
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]


def fail(message):
    print(f"FAIL: {message}")
    sys.exit(1)


def main():
    shell = (ROOT / 'platforms/browser/shell.mjs').read_text()
    nat = (ROOT / 'platforms/browser/nat.mjs').read_text()

    peer = re.search(r'new RTCPeerConnection\(\s*\{([^}]*(?:\}[^}]*)*?)\}\s*\)', shell)
    if peer is None:
        fail('no RTCPeerConnection construction found in shell.mjs')

    # An empty list is the regression itself, not merely a missing option.
    for name, text in (('shell.mjs', shell), ('nat.mjs', nat)):
        if re.search(r'iceServers:\s*\[\s*\]', text):
            fail(f'iceServers is empty again in {name}, so each peer gathers '
                 'only LAN addresses and two players on different networks '
                 'cannot pair')

    # The construction must be configured from iceServers(), inline or not:
    # an omitted iceServers key gathers host candidates only, exactly as an
    # empty list does.
    if not re.search(r'iceServers:', peer.group(0)):
        fail('RTCPeerConnection is constructed without an iceServers key, so '
             'each peer gathers only LAN addresses')
    if 'iceServers' not in shell.split('new RTCPeerConnection')[0]:
        fail('shell.mjs must import iceServers from nat.mjs')

    # nat.mjs holds the servers. Require a STUN url, and require two of them:
    # one mapping cannot tell a symmetric NAT from a cone NAT.
    stun = re.findall(r"urls:\s*['\"](stuns?:[^'\"]+)['\"]", nat)
    if not stun:
        fail('nat.mjs must list a STUN server, so each peer learns its '
             'public address')
    if len(stun) < 2:
        fail('nat.mjs must list two STUN servers, because one srflx mapping '
             'cannot distinguish a symmetric NAT from a cone NAT')

    # Every return path must end at the STUN list. A malformed or absent
    # ?ice= that returned [] would reintroduce the original regression
    # through the override instead of through the default.
    servers = re.search(r'export function iceServers\([^)]*\)\s*\{(.*?)\n\}', nat, re.S)
    if servers is None:
        fail('no iceServers() function found in nat.mjs')
    returns = re.findall(r'return\s+([^;]+);', servers.group(1))
    if not returns:
        fail('iceServers() returns nothing')
    for expr in returns:
        if re.match(r'\[\s*\]', expr.strip()):
            fail('iceServers() can return an empty list, which gathers only '
                 'LAN addresses')

    # Without this the remaining failure mode is an indefinite hang, and the
    # player cannot tell a slow network from one that blocks direct play.
    if 'connectionstatechange' not in shell:
        fail('nothing watches connectionState, so a failed ICE negotiation '
             'leaves the status text saying it is still pairing')
    # Either direction of the test is fine: an early return on
    # `!== 'failed'` and a positive `=== 'failed'` branch do the same thing.
    if not re.search(r"connectionState\s*[!=]==\s*['\"]failed['\"]", shell):
        fail('the connectionstatechange listener must test for the failed '
             'state and report it')

    # The two SSE deliveries are not ordered against each other. An offer that
    # arrives before the state event hit a null pc and threw TypeError inside a
    # listener, which silenced the answering side.
    if not re.search(r'if \(!pc\)', shell):
        fail('the offer listener must create the peer connection when the '
             'offer arrives before the state event, rather than throwing')

    print('ok: iceServers carries STUN, ICE failure is reported, offer '
          'ordering is handled')


if __name__ == '__main__':
    main()
