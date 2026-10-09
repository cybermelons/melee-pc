// Static host for the browser build.
//
// Threads need a cross-origin isolated page, so every response carries
// COOP/COEP. Binds to loopback only: a public URL comes from `tailscale funnel`
// in front of this, never from binding a public interface here.
//
// Set MELEE_DISC to a disc image to serve it at /disc, so a visitor plays
// without supplying their own dump. The image stays outside the served root and
// is reachable only at that one path.
//
// The server binds loopback only and has no authentication, so anything put in
// front of it (Tailscale Funnel, for example) publishes the page to anyone with
// the URL.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { signalHandler } from './signal.mjs';

const ROOT = path.resolve(process.argv[2]
  || 'build/browser/runtime/platforms/browser');
const PORT = Number(process.env.PORT || 8099);
// Loopback by default, because a listener on every interface is a surprise.
// Set MELEE_BIND to serve another machine, for example a tailnet address so a
// phone can open the page and claim the second player slot. A netplay test
// needs two machines, and two tabs on one host cannot stand in for them.
const BIND = process.env.MELEE_BIND || '127.0.0.1';
const DISC = process.env.MELEE_DISC ? path.resolve(process.env.MELEE_DISC) : '';

const TYPES = {
  '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript',
  '.wasm': 'application/wasm', '.json': 'application/json',
};

http.createServer((req, res) => {
  const headers = {
    'Cross-Origin-Opener-Policy': 'same-origin',
    'Cross-Origin-Embedder-Policy': 'require-corp',
    'Cross-Origin-Resource-Policy': 'same-origin',
  };

  const url = new URL(req.url, 'http://x');
  // Netplay signaling, mounted here rather than run as a second process on its
  // own port: one origin, and nothing extra to start.
  if (url.pathname.startsWith('/signal/')) {
    return signalHandler(req, res, '/signal');
  }
  const name = url.pathname === '/' ? '/index.html' : decodeURIComponent(url.pathname);
  // /disc is the one path outside ROOT, and only when MELEE_DISC names a file.
  let file;
  if (name === '/disc') {
    if (!DISC) { res.writeHead(404, headers); return res.end('404'); }
    file = DISC;
  } else {
    // Resolve, then confirm the result is still inside ROOT: path.join alone
    // follows ".." out of the directory, which would serve any readable file.
    file = path.resolve(ROOT, '.' + path.posix.normalize(name));
    if (file !== ROOT && !file.startsWith(ROOT + path.sep)) {
      res.writeHead(403, headers);
      return res.end('403');
    }
  }

  let st;
  try { st = fs.statSync(file); } catch { res.writeHead(404, headers); return res.end('404'); }
  if (!st.isFile()) { res.writeHead(404, headers); return res.end('404'); }

  headers['Content-Type'] = TYPES[path.extname(file)] || 'application/octet-stream';
  headers['Accept-Ranges'] = 'bytes';

  const range = req.headers.range;
  if (range) {
    const m = /bytes=(\d*)-(\d*)/.exec(range);
    const start = m[1] ? Number(m[1]) : 0;
    const end = m[2] ? Number(m[2]) : st.size - 1;
    if (!(start <= end && end < st.size)) {
      res.writeHead(416, { ...headers, 'Content-Range': `bytes */${st.size}` });
      return res.end();
    }
    headers['Content-Range'] = `bytes ${start}-${end}/${st.size}`;
    headers['Content-Length'] = end - start + 1;
    res.writeHead(206, headers);
    return fs.createReadStream(file, { start, end }).pipe(res);
  }

  headers['Content-Length'] = st.size;
  res.writeHead(200, headers);
  fs.createReadStream(file).pipe(res);
}).listen(PORT, BIND, () =>
  console.log(`serving ${ROOT} on ${BIND}:${PORT}${DISC ? `, disc ${DISC} at /disc` : ''}`));
