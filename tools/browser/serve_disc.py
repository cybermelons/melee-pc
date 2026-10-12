#!/usr/bin/env python3
"""Serve platforms/browser with HTTP Range support, and the disc at /disc.

python -m http.server answers no Range header, so remote-disc.mjs gets a 200
with the whole file for every block read and openRemoteDisc() refuses it. The
page then has no disc at all, because the launcher no longer carries a picker.
"""
import os, re, sys
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

DISC = os.environ.get('MELEE_DISC', '')

class H(SimpleHTTPRequestHandler):
    def translate_path(self, path):
        if path.split('?')[0].rstrip('/') == '/disc' and DISC:
            return DISC
        return super().translate_path(path)

    def end_headers(self):
        # SharedArrayBuffer needs cross-origin isolation; the engine uses threads.
        self.send_header('Cross-Origin-Opener-Policy', 'same-origin')
        self.send_header('Cross-Origin-Embedder-Policy', 'require-corp')
        self.send_header('Accept-Ranges', 'bytes')
        super().end_headers()

    def do_GET(self):
        rng = self.headers.get('Range')
        if not rng:
            return super().do_GET()
        path = self.translate_path(self.path)
        if not os.path.isfile(path):
            return super().do_GET()
        size = os.path.getsize(path)
        m = re.fullmatch(r'bytes=(\d*)-(\d*)', rng.strip())
        if not m or (not m[1] and not m[2]):
            return super().do_GET()
        if m[1]:
            start = int(m[1])
            end = int(m[2]) if m[2] else size - 1
        else:                      # suffix range: last N bytes
            start, end = max(0, size - int(m[2])), size - 1
        if start >= size:
            self.send_response(416)
            self.send_header('Content-Range', f'bytes */{size}')
            self.end_headers()
            return
        end = min(end, size - 1)
        self.send_response(206)
        self.send_header('Content-Type', self.guess_type(path))
        self.send_header('Content-Range', f'bytes {start}-{end}/{size}')
        self.send_header('Content-Length', str(end - start + 1))
        self.end_headers()
        with open(path, 'rb') as f:
            f.seek(start)
            remaining = end - start + 1
            while remaining > 0:
                chunk = f.read(min(262144, remaining))
                if not chunk:
                    break
                self.wfile.write(chunk)
                remaining -= len(chunk)

    def do_HEAD(self):
        # openRemoteDisc() probes with HEAD and reads content-length.
        path = self.translate_path(self.path)
        if os.path.isfile(path):
            self.send_response(200)
            self.send_header('Content-Type', self.guess_type(path))
            self.send_header('Content-Length', str(os.path.getsize(path)))
            self.end_headers()
            return
        super().do_HEAD()

if __name__ == '__main__':
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8104
    root = sys.argv[2] if len(sys.argv) > 2 else '.'
    os.chdir(root)
    print(f'serving {root} on 0.0.0.0:{port}, disc={DISC or "(none)"}', flush=True)
    ThreadingHTTPServer(('0.0.0.0', port), H).serve_forever()
