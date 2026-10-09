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

    peer = re.search(r'new RTCPeerConnection\(\s*\{([^}]*(?:\}[^}]*)*?)\}\s*\)', shell)
    if peer is None:
        fail('no RTCPeerConnection construction found in shell.mjs')

    # An empty list is the regression itself, not merely a missing option.
    if re.search(r'iceServers:\s*\[\s*\]', shell):
        fail('iceServers is empty again, so each peer gathers only LAN '
             'addresses and two players on different networks cannot pair')

    if not re.search(r"iceServers:\s*\[\s*\{\s*urls:\s*['\"]stuns?:", shell):
        fail('RTCPeerConnection must be given a STUN server in iceServers, so '
             'each peer learns its public address')

    # Without this the remaining failure mode is an indefinite hang, and the
    # player cannot tell a slow network from one that blocks direct play.
    if 'connectionstatechange' not in shell:
        fail('nothing watches connectionState, so a failed ICE negotiation '
             'leaves the status text saying it is still pairing')
    if not re.search(r"connectionState\s*===\s*['\"]failed['\"]", shell):
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
