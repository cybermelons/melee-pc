"""The server must stay on loopback unless MELEE_BIND asks for more.

A listener on every interface is a surprise, so the default matters as much as
the option. This starts the server both ways and checks which address answers.

The tailnet case needs a second machine to be useful, so this test only proves
the bind address is honoured. It uses 127.0.0.2, which is also loopback, so the
test exposes nothing to the network.
"""
import os
import socket
import subprocess
import sys
import time
import urllib.error
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
SERVE = os.path.join(ROOT, 'tools/browser/serve.mjs')
DOCROOT = os.path.join(ROOT, 'platforms/browser')


def free_port():
    with socket.socket() as s:
        s.bind(('127.0.0.1', 0))
        return s.getsockname()[1]


def get(url):
    try:
        with urllib.request.urlopen(url, timeout=3) as r:
            return r.status
    except urllib.error.HTTPError as err:
        return err.code
    except Exception:
        return None


def serve(port, bind=None):
    env = dict(os.environ, PORT=str(port))
    if bind:
        env['MELEE_BIND'] = bind
    proc = subprocess.Popen([os.environ.get('NODE', 'node'), SERVE, DOCROOT],
                            env=env, stdout=subprocess.DEVNULL,
                            stderr=subprocess.DEVNULL)
    for _ in range(40):  # the server needs a moment before it answers
        time.sleep(0.1)
        if get(f'http://{bind or "127.0.0.1"}:{port}/'):
            break
    return proc


def main():
    port = free_port()
    proc = serve(port)
    try:
        assert get(f'http://127.0.0.1:{port}/') == 200, 'default bind does not serve loopback'
    finally:
        proc.terminate()
        proc.wait(timeout=10)

    # 127.0.0.2 is loopback too, so this binds a different address without
    # putting a listener on the network.
    port = free_port()
    proc = serve(port, '127.0.0.2')
    try:
        assert get(f'http://127.0.0.2:{port}/') == 200, 'MELEE_BIND address does not serve'
        assert get(f'http://127.0.0.1:{port}/') is None, \
            'MELEE_BIND was ignored: 127.0.0.1 answered on a 127.0.0.2 bind'
    finally:
        proc.terminate()
        proc.wait(timeout=10)

    print('pass: the server binds loopback by default and honours MELEE_BIND')
    return 0


if __name__ == '__main__':
    sys.exit(main())
