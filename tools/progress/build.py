#!/usr/bin/env python3
# SPDX-License-Identifier: GPL-3.0-or-later
"""The launcher as it should end up, with every issue pinned to the control it
has to produce.

    python3 tools/progress/build.py            # writes docs/site/progress.html
    python3 tools/progress/build.py --check    # exit 1 if the page is stale
    python3 tools/progress/build.py --audit    # compare against the tracker

The board is not a screenshot. mockup.py builds the proposed launcher as real
markup, and each pin measures its own anchor in the browser, so a control that
moves takes its pin with it and no coordinate file can go stale.

Every anchor must exist in the mockup. A pin over empty background still looks
authoritative, so a missing anchor fails the build instead.
"""
import argparse
import html
import json
import os
import re
import subprocess
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import mockup  # noqa: E402

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
DATA = os.path.join(ROOT, 'tools/progress/issues.json')
OUT = os.path.join(ROOT, 'docs/site/progress.html')


def check_anchors(issues, launcher):
    """Fail on an issue whose anchor is not an id in the mockup."""
    ids = set(re.findall(r'\bid="([^"]+)"', launcher))
    missing = [(i['n'], i['anchor']) for i in issues
               if i['anchor'].lstrip('#') not in ids]
    if missing:
        lines = '\n'.join(f'  #{n} anchors to {a}' for n, a in missing)
        raise SystemExit(
            f'these anchors are not in the launcher mockup:\n{lines}\n'
            f'Either add the control to tools/progress/mockup.py, or point '
            f'the issue at one that is there. A pin with no anchor would '
            f'float over the background and still look authoritative.')


def render(data):
    e = html.escape
    issues = data['issues']
    launcher = mockup.launcher_html()
    check_anchors(issues, launcher)

    done = sum(1 for i in issues if i['state'] == 'closed')
    total = len(issues)
    pct = round(100 * done / total) if total else 0

    pins = []
    for i in issues:
        if not i.get('pin', '').strip():
            raise SystemExit(f"issue #{i['n']} has no annotation: "
                             f"a pin nobody can read is worse than no pin")
        pins.append((i['side'],
            f'<a class="pin {i["state"]} {i["side"]}" '
            f'data-anchor="{e(i["anchor"])}" '
            f'href="{e(data["base"])}{i["n"]}" target="_blank" rel="noopener">'
            f'<span class="pin-n">{i["n"]}</span>'
            f'<span class="pin-t">{e(i["title"])}</span>'
            f'<span class="pin-p">{e(i["pin"])}</span></a>'))

    return TEMPLATE.format(
        launcher=launcher,
        pins_left='\n  '.join(h for side, h in pins if side == 'left'),
        pins_right='\n  '.join(h for side, h in pins if side == 'right'),
        done=done, total=total, pct=pct, open_count=total - done,
        note=e(data.get('note', '')), base=e(data['base']),
    )


TEMPLATE = """<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>melee-pc — the launcher, and what is left to build it</title>
<meta name="description" content="The melee-pc launcher as it should end up, with every open issue pinned to the control it has to produce.">
<style>
  :root {{
    --bg:#0e0f13; --fg:#e8e8ec; --dim:#a4a6b3; --line:#2a2c36;
    --accent:#e4b04a; --card:#171922;
    --open:#e4b04a; --closed:#5b8f6a;
  }}
  * {{ box-sizing:border-box; }}
  body {{ margin:0; background:var(--bg); color:var(--fg);
         font:15px/1.5 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif; }}
  a {{ color:var(--accent); }}
  header {{ padding:2.6rem 1rem 1.4rem; text-align:center; }}
  header h1 {{ margin:0; font-size:1.8rem; }}
  header .sub {{ color:var(--dim); margin:.6rem auto 1.2rem; max-width:44rem; }}
  .bar2 {{ max-width:28rem; margin:0 auto; height:8px; background:#22242e;
           border-radius:99px; overflow:hidden; }}
  .bar2 i {{ display:block; height:100%; background:var(--closed); }}
  .counts {{ color:var(--dim); font-size:.9rem; margin-top:.55rem; }}
  .legend {{ display:flex; gap:1.2rem; justify-content:center; flex-wrap:wrap;
             color:var(--dim); font-size:.85rem; margin-top:.8rem; }}
  .legend span {{ display:flex; align-items:center; gap:.4rem; }}
  .legend i {{ width:10px; height:10px; border-radius:50%; }}

  /* Three explicit columns: a label column, the launcher, a label column.
     Centring the launcher and hanging the labels off it with a negative
     offset instead pushed the left column off the left edge of the page,
     where it was unreachable and showed up only as a sideways scrollbar. */
  .board {{ display:grid; grid-template-columns:300px minmax(0,620px) 300px;
            justify-content:center; gap:0 40px;
            max-width:1420px; margin:0 auto; padding:1rem 1rem 4rem; }}
  #stage {{ position:relative; grid-column:2; }}
  /* Each column is its own positioning context, so a label cannot escape
     the page however long it grows. */
  #pin-left {{ position:relative; grid-column:1; }}
  #pin-right {{ position:relative; grid-column:3; }}
  .board {{ position:relative; max-width:1540px; margin:0 auto;
            padding:1rem 1rem 4rem; }}
  #stage {{ position:relative; width:min(640px,100%); margin:0 auto; }}

  /* ---- the proposed launcher ---- */
  #menu-panel {{
    background:#111; border:1px solid var(--line); border-radius:12px;
    padding:18px; display:grid; gap:18px;
  }}
  #menu-panel .group {{ display:grid; gap:10px; }}
  .group-h {{ margin:0; font-size:.82rem; letter-spacing:.09em;
              text-transform:uppercase; color:var(--dim); font-weight:600; }}
  .sub-h {{ text-transform:none; letter-spacing:0; font-weight:400;
            color:#6f7280; }}
  .sub {{ margin:0; color:var(--dim); font-size:.82rem; }}

  .mode-row {{ display:grid; grid-template-columns:1fr 1fr; gap:8px; }}
  .mode {{ text-align:left; display:grid; gap:2px; padding:10px 12px;
           background:#191b24; color:var(--fg);
           border:1px solid var(--line); border-radius:9px; font:inherit; }}
  .mode b {{ font-size:.95rem; }}
  .mode i {{ font-style:normal; color:var(--dim); font-size:.76rem; }}
  .mode.wide {{ width:100%; }}
  #mode-vs {{ border-color:#3c4252; background:#1d2130; }}
  .room {{ display:grid; gap:6px; }}

  #bar {{ display:flex; gap:8px; align-items:center; flex-wrap:wrap; }}
  .file {{ padding:9px 12px; border:1px dashed #3a3d4a; border-radius:8px;
           color:var(--dim); font-size:.84rem; }}
  .file input {{ display:none; }}
  #menu-panel button {{ font:inherit; }}
  #bar button, .apply-row button {{ padding:9px 14px; border-radius:8px;
           border:1px solid var(--line); background:#191b24; color:var(--fg); }}
  .primary {{ background:var(--accent) !important; color:#1a1405 !important;
              border-color:var(--accent) !important; font-weight:600; }}

  .setting-grid {{ display:grid; gap:7px; }}
  .setting {{ display:flex; align-items:center; gap:7px; flex-wrap:wrap;
              font-size:.86rem; }}
  .setting-label {{ color:var(--fg); }}
  .setting select {{ background:#191b24; color:var(--fg); font:inherit;
                     border:1px solid var(--line); border-radius:6px;
                     padding:3px 6px; }}
  .setting-hint {{ flex-basis:100%; color:#6f7280; font-size:.75rem; }}

  .pad-preview {{ display:grid; gap:6px; padding:10px;
                  border:1px solid var(--line); border-radius:9px;
                  background:#15171f; }}
  .pad-h {{ font-size:.82rem; color:var(--dim); }}
  .pad-map {{ position:relative; height:84px; }}
  .pm {{ position:absolute; display:grid; place-items:center;
         border:1px solid #ffffff2e; border-radius:50%;
         background:#ffffff12; color:#9a9db0; font-style:normal;
         font-size:.62rem; }}
  .pm.stick {{ left:4px; bottom:2px; width:58px; height:58px; }}
  .pm.l {{ left:14px; top:0; width:30px; height:30px; }}
  .pm.z {{ left:52px; top:0; width:30px; height:30px; }}
  .pm.a {{ right:18px; bottom:14px; width:34px; height:34px;
           border-color:#ffffff55; }}
  .pm.b {{ right:58px; bottom:6px; width:30px; height:30px; }}
  .pm.y {{ right:12px; top:4px; width:30px; height:30px; }}

  .apply-row {{ display:flex; gap:8px; align-items:center; flex-wrap:wrap; }}
  #settings-link {{ flex:1; min-width:14rem; background:#0c0d12;
                    color:var(--dim); border:1px solid var(--line);
                    border-radius:6px; padding:8px 10px;
                    font:12px/1 ui-monospace,SFMono-Regular,Menlo,monospace; }}
  #log-tab {{ border-top:1px solid var(--line); padding-top:12px; }}
  #log-tab summary {{ color:var(--dim); font-size:.82rem; cursor:pointer; }}
  #log-tab pre {{ margin:.6rem 0 0; color:#6f7280; font-size:.72rem;
                  white-space:pre-wrap; }}
  /* Nothing on the mockup does anything. A control that looks live and is not
     is worse than one that is visibly inert. */
  #menu-panel button, #menu-panel summary {{ cursor:default; }}

  /* ---- the pins ---- */
  .dot {{ position:absolute; width:11px; height:11px; margin:-5.5px 0 0 -5.5px;
          border-radius:50%; background:var(--open); z-index:4;
          box-shadow:0 0 0 3px rgba(228,176,74,.22); pointer-events:none; }}
  .dot.closed {{ background:var(--closed);
                 box-shadow:0 0 0 3px rgba(91,143,106,.22); }}
  #leads {{ position:absolute; inset:0; overflow:visible; z-index:3;
            pointer-events:none; }}
  #leads line {{ stroke:var(--open); stroke-width:1; opacity:.4; }}
  #leads line.closed {{ stroke:var(--closed); }}

  .pin {{ position:absolute; width:100%; text-decoration:none; color:inherit;
          display:grid; grid-template-columns:auto 1fr; gap:0 .4rem; }}
  .pin-n {{ font:600 .72rem/1.5 ui-monospace,SFMono-Regular,Menlo,monospace;
            color:var(--dim); }}
  .pin.left {{ text-align:right; }}
  .pin-t {{ font-weight:600; font-size:.84rem; }}
  .pin-p {{ grid-column:1/-1; color:var(--dim); font-size:.76rem;
            line-height:1.4; margin-top:.1rem; }}
  .pin.closed .pin-t {{ color:var(--dim); font-weight:500; }}
  .pin:hover .pin-t {{ color:var(--accent); }}

  /* Below this width there is no room for a label column, so the board
     becomes the mockup and then a numbered list. The numbers still tie each
     note to its control, so the mapping survives the fallback. */
  @media (max-width:1320px) {{
    .board {{ display:block; max-width:660px; }}
    .dot, #leads {{ display:none; }}
    #pin-left, #pin-right {{ position:static; }}
    #pin-left {{ margin-top:1.5rem; }}
    .pin {{ position:static !important; width:auto;
            padding:.8rem 0; border-top:1px solid var(--line);
            text-align:left !important; grid-template-columns:auto 1fr !important; }}
    .pin.left .pin-n {{ order:0; }}
  }}
  footer {{ max-width:46rem; margin:0 auto; padding:0 1rem 3rem;
            color:var(--dim); font-size:.82rem; text-align:center; }}
</style>
</head>
<body>
<header>
  <h1>melee-pc — the launcher, and what is left to build it</h1>
  <p class="sub">This is the launcher as it should end up, not as it is today.
     Every pin marks a control that still needs work, and links to its issue.</p>
  <div class="bar2"><i style="width:{pct}%"></i></div>
  <p class="counts">{done} closed · {open_count} open · {pct}% of {total}</p>
  <div class="legend">
    <span><i style="background:var(--open)"></i> still to build</span>
    <span><i style="background:var(--closed)"></i> done</span>
  </div>
</header>

<div class="board">
  <div id="stage">
    <svg id="leads"></svg>
    {launcher}
  </div>
  <div id="pin-left">{pins_left}</div>
  <div id="pin-right">{pins_right}</div>
</div>
<footer>{note} · <a href="{base}">All issues</a></footer>

<script>
// Each pin measures its own anchor, so a control that moves in the mockup
// takes its pin with it. Nothing here is a stored coordinate.
const stage = document.getElementById('stage');
const leads = document.getElementById('leads');
const pins = [...document.querySelectorAll('.pin')];
const MIN_GAP = 8;   // px between two labels before they are pushed apart

function place() {{
  leads.replaceChildren();
  document.querySelectorAll('.dot').forEach((d) => d.remove());
  // The one-column fallback has no room for the label column; the media query
  // hides the lines and dots, so there is nothing to place.
  if (getComputedStyle(leads).display === 'none') return;

  const base = stage.getBoundingClientRect();
  const colL = document.getElementById('pin-left').getBoundingClientRect();
  const colR = document.getElementById('pin-right').getBoundingClientRect();
  const want = [];
  for (const pin of pins) {{
    const el = stage.querySelector(pin.dataset.anchor);
    // check_anchors in build.py makes this unreachable, so a hit here means
    // the generator and the mockup have come apart.
    if (!el) {{ console.error('no anchor for pin', pin.dataset.anchor); continue; }}
    const r = el.getBoundingClientRect();
    const left = pin.parentElement.id === 'pin-left';
    want.push({{
      pin, left,
      // Just outside the box, not on its edge: on a line of text the edge
      // is the first letter, and the dot covered it.
      ax: (left ? r.left - 7 : r.right + 7) - base.left,
      ay: r.top + r.height / 2 - base.top,
      // Where the leader line meets the label column, in stage coordinates.
      ex: (left ? colL.right : colR.left) - base.left,
      h: pin.offsetHeight,
    }});
  }}

  // A label wants to sit level with its control. Where that would overlap the
  // one above, it moves down just enough to clear it, and the leader line
  // slopes to show which control it belongs to.
  for (const side of [true, false]) {{
    const col = want.filter((w) => w.left === side).sort((a, b) => a.ay - b.ay);
    let floor = -1e9;
    for (const w of col) {{
      w.ly = Math.max(w.ay - w.h / 2, floor);
      floor = w.ly + w.h + MIN_GAP;
    }}
  }}

  const ns = 'http://www.w3.org/2000/svg';
  for (const w of want) {{
    // ly is measured from the stage, but each label is positioned inside its
    // own column, so it is converted into that column's coordinates.
    const col = w.left ? colL : colR;
    w.pin.style.top = `${{w.ly + base.top - col.top}}px`;

    const dot = document.createElement('span');
    dot.className = 'dot' + (w.pin.classList.contains('closed') ? ' closed' : '');
    dot.style.left = `${{w.ax}}px`;
    dot.style.top = `${{w.ay}}px`;
    stage.append(dot);

    const line = document.createElementNS(ns, 'line');
    line.setAttribute('x1', w.ax);
    line.setAttribute('y1', w.ay);
    line.setAttribute('x2', w.ex);
    line.setAttribute('y2', w.ly + w.h / 2);
    if (w.pin.classList.contains('closed')) line.setAttribute('class', 'closed');
    leads.append(line);
  }}
}}

place();
// The labels are text, so their height depends on the width, and the stage
// height depends on the labels. Re-measure on resize and once the fonts land.
addEventListener('resize', place);
if (document.fonts) document.fonts.ready.then(place);
</script>
</body>
</html>
"""


def audit(data):
    """Compare issues.json against the tracker and report what drifted."""
    try:
        raw = subprocess.run(
            ['tea', 'issues', 'list', '--login', 'noel',
             '--repo', data['repo'], '--state', 'all', '--output', 'json'],
            capture_output=True, text=True, timeout=60, check=True).stdout
    except (OSError, subprocess.SubprocessError) as err:
        print(f'audit: could not reach the tracker: {err}')
        return 1
    try:
        live = json.loads(raw)
    except json.JSONDecodeError:
        # tea prints an error page rather than JSON when the login is wrong.
        print(f'audit: the tracker did not return JSON: {raw[:200]!r}')
        return 1

    live_state = {int(i['index']): i['state'] for i in live}
    mine = {i['n']: i['state'] for i in data['issues']}
    bad = 0
    for n in sorted(set(live_state) - set(mine)):
        print(f'audit: #{n} is in the tracker and not on the board')
        bad = 1
    for n in sorted(set(mine) - set(live_state)):
        print(f'audit: #{n} is on the board and not in the tracker')
        bad = 1
    for n in sorted(set(mine) & set(live_state)):
        if mine[n] != live_state[n]:
            print(f'audit: #{n} is {live_state[n]} in the tracker '
                  f'and {mine[n]} on the board')
            bad = 1
    print('audit: the board matches the tracker' if not bad else
          'audit: the board is out of date')
    return bad


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--check', action='store_true',
                    help='exit 1 if the written page differs from the data')
    ap.add_argument('--audit', action='store_true',
                    help='compare the board against the tracker')
    args = ap.parse_args()

    with open(DATA) as f:
        data = json.load(f)
    if args.audit:
        return audit(data)

    page = render(data)
    if args.check:
        try:
            with open(OUT) as f:
                current = f.read()
        except FileNotFoundError:
            print(f'{OUT} does not exist; run without --check')
            return 1
        if current != page:
            print(f'{OUT} is stale; run tools/progress/build.py')
            return 1
        print(f'{OUT} is up to date')
        return 0

    with open(OUT, 'w') as f:
        f.write(page)
    print(f'wrote {OUT}: {len(data["issues"])} pins on the launcher mockup')
    return 0


if __name__ == '__main__':
    sys.exit(main())
