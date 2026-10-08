// SPDX-License-Identifier: GPL-3.0-or-later
// An abort used to be invisible. onAbort wrote to #status, and body.playing
// hides #bar, so the whole failure was a dead canvas with no reason on it.
// This uncovers the reason and offers the two things worth offering: start
// again, or report it.
//
// The engine cannot be resumed after an abort, so this does not try. It keeps
// the log on screen instead, because that is what a report needs.
//
// Its own module rather than inline in shell.mjs so a test can reach it
// without booting the engine.

const REPORT_URL = 'https://github.com/cybermelons/melee-pc/issues/new';
// A URL has a practical length limit, so the report carries the tail of the
// log rather than all of it.
const LOG_TAIL = 1500;

export function showCrash(reason, { log = () => {}, status = () => {} } = {}) {
  const text = String(reason && reason.message ? reason.message : reason);
  status(`Engine stopped: ${text}`);
  log(`abort: ${text}`);
  const panel = document.getElementById('crash');
  if (!panel) return text;
  document.getElementById('crash-why').textContent = text;
  const tail = (document.getElementById('log')?.textContent || '').slice(-LOG_TAIL);
  const body = `\n\n${text}\n\n\`\`\`\n${tail}\n\`\`\`\n`;
  document.getElementById('crash-report').href = REPORT_URL
    + `?title=${encodeURIComponent(`Engine stopped: ${text.slice(0, 80)}`)}`
    + `&body=${encodeURIComponent(body)}`;
  document.getElementById('crash-reload')
    .addEventListener('click', () => location.reload());
  panel.hidden = false;
  // The log sits under the panel, so bring the page's own furniture back:
  // without this the log is still hidden by body.playing and cannot be
  // copied. This also releases the locked height and overflow, so the page
  // scrolls. The menu class goes too, or the panel opens behind the crash.
  document.body.classList.remove('playing');
  document.body.classList.remove('menu');
  // A phone mid-game is scrolled to the canvas, and the reflow above does not
  // move the viewport, so without this the panel can sit off-screen.
  panel.scrollIntoView({ block: 'start' });
  return text;
}
