#!/usr/bin/env python3
"""Serve the built browser target locally.

The engine uses threads, so the page must be cross-origin isolated
(COOP/COEP); a plain `python3 -m http.server` will not work.
"""
import argparse
import http.server
import os
import urllib.error
import urllib.request

from common import BUILD

OUTPUT = BUILD / 'runtime/platforms/browser'

# Dev only: PINNOTATE_URL=http://host:8140 proxies the pinnotate server same-origin
# (its Origin check and COEP both need that) and adds annotate.js to the page.
PINNOTATE = os.environ.get('PINNOTATE_URL', '').rstrip('/')
PIN_PATHS = ('/annotate.js', '/annotate', '/annotations', '/annotate/link')
PIN_TAG = b'<script type="module" src="/annotate.js"></script>'


class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(OUTPUT), **kwargs)

    def pin_proxy(self):
        body = None
        if self.command == 'POST':
            body = self.rfile.read(int(self.headers.get('Content-Length') or 0))
        req = urllib.request.Request(PINNOTATE + self.path, body, method=self.command)
        for h in ('Host', 'Origin', 'Content-Type'):
            if self.headers.get(h):
                req.add_header(h, self.headers[h])
        try:
            r = urllib.request.urlopen(req, timeout=10)
        except urllib.error.HTTPError as e:
            r = e
        except OSError:
            return self.send_error(502, 'pinnotate unreachable')
        data = r.read()
        self.send_response(r.status if hasattr(r, 'status') else r.code)
        self.send_header('Content-Type', r.headers.get('Content-Type', 'application/octet-stream'))
        self.send_header('Content-Length', str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_POST(self):
        if PINNOTATE and self.path in PIN_PATHS:
            return self.pin_proxy()
        self.send_error(405)

    def do_GET(self):
        path = self.path.split('?')[0]
        if PINNOTATE and path in PIN_PATHS:
            return self.pin_proxy()
        if PINNOTATE and path in ('/', '/index.html'):
            data = (OUTPUT / 'index.html').read_bytes().replace(b'</html>', PIN_TAG + b'</html>', 1)
            self.send_response(200)
            self.send_header('Content-Type', 'text/html')
            self.send_header('Content-Length', str(len(data)))
            self.end_headers()
            return self.wfile.write(data)
        super().do_GET()

    def end_headers(self):
        self.send_header('Cross-Origin-Opener-Policy', 'same-origin')
        self.send_header('Cross-Origin-Embedder-Policy', 'require-corp')
        self.send_header('Cache-Control', 'no-store')
        super().end_headers()


def main():
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument('--port', type=int, default=5190)
    parser.add_argument('--host', default='0.0.0.0')
    args = parser.parse_args()
    if not (OUTPUT / 'melee_browser.wasm').exists():
        raise SystemExit('Nothing to serve: run tools/browser/build.py first.')
    print(f'http://{args.host}:{args.port}/')
    http.server.ThreadingHTTPServer((args.host, args.port), Handler).serve_forever()


if __name__ == '__main__':
    main()
