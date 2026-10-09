#!/usr/bin/env python3
"""Render issues.json as a board of pins, one pin per issue.

    python3 tools/progress/build.py            # writes docs/site/progress.html
    python3 tools/progress/build.py --check    # exit 1 if the page is stale

The pins are placed by this script, not by a browser: positions are derived
from the issue numbers, so the same input always gives the same page and a
diff of the output is readable. A pin with no annotation is a pin nobody can
read, so an empty one fails the build rather than rendering blank.

issues.json is maintained by hand. `tea issues list` gives the state and the
title, but the one-line annotation on each pin is a judgement about where the
work stands, and no field in the tracker holds it. Re-run with --audit to
compare the file against the tracker.
"""
import argparse
import html
import json
import os
import subprocess
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
DATA = os.path.join(ROOT, 'tools/progress/issues.json')
OUT = os.path.join(ROOT, 'docs/site/progress.html')

# The pin sits on a board whose height grows with the number of pins, so a
# crowded area spreads down the board instead of overlapping. Two columns,
# because a one-line annotation needs the width and a phone gets one column
# from the stylesheet.
COLS = 2
ROW_H = 108          # px between pin rows
PAD_TOP = 92         # room for the area heading above the first pin
PIN_H = 74           # the tallest a two-line annotation runs


def load():
    with open(DATA) as f:
        return json.load(f)


def place(issues):
    """Give every issue a column and a row inside its area.

    Open issues come first so the work that remains is at the top of each
    area, where a reader looks first. Within a state, the issue number
    orders them, which keeps the page stable as annotations change.
    """
    ordered = sorted(issues, key=lambda i: (i['state'] == 'closed', i['n']))
    out = []
    for idx, issue in enumerate(ordered):
        out.append({**issue, 'col': idx % COLS, 'row': idx // COLS})
    return out


def board_height(placed):
    """Height to the bottom of the last pin, not to the end of its row.

    Reserving a whole row for the last one leaves a band of empty board
    under every area, which reads as a missing pin.
    """
    rows = max((p['row'] for p in placed), default=-1) + 1
    if rows == 0:
        return PAD_TOP
    return PAD_TOP + (rows - 1) * ROW_H + PIN_H + 18


def render(data):
    e = html.escape
    base = data['base']
    areas = data['areas']
    issues = data['issues']

    done = sum(1 for i in issues if i['state'] == 'closed')
    total = len(issues)
    pct = round(100 * done / total) if total else 0

    sections = []
    for area in areas:
        mine = [i for i in issues if i['area'] == area['id']]
        if not mine:
            continue
        placed = place(mine)
        a_done = sum(1 for i in mine if i['state'] == 'closed')
        pins = []
        for p in placed:
            if not p.get('pin', '').strip():
                raise SystemExit(f"issue #{p['n']} has no annotation: a pin "
                                 f"nobody can read is worse than no pin")
            # left is a percentage so the board reflows with the page width;
            # top is pixels so the row spacing does not change with it.
            left = 2 + p['col'] * (96 / COLS)
            top = PAD_TOP + p['row'] * ROW_H
            pins.append(
                f'<a class="pin {p["state"]}" href="{e(base)}{p["n"]}"'
                f' style="left:{left:.2f}%;top:{top}px">'
                f'<span class="head" aria-hidden="true"></span>'
                f'<span class="label">'
                f'<span class="num">#{p["n"]}</span>'
                f'<span class="title">{e(p["title"])}</span>'
                f'<span class="note">{e(p["pin"])}</span>'
                f'</span></a>')
        sections.append(
            f'<section class="area" id="{e(area["id"])}">\n'
            f'  <div class="board" style="height:{board_height(placed)}px">\n'
            f'    <div class="areahead"><h2>{e(area["name"])}</h2>'
            f'<p>{e(area["blurb"])}</p>'
            f'<span class="tally">{a_done} of {len(mine)} closed</span></div>\n'
            + '\n'.join('    ' + p for p in pins)
            + '\n  </div>\n</section>')

    return TEMPLATE.format(
        repo=e(data['repo']),
        done=done, total=total, pct=pct,
        open_count=total - done,
        sections='\n'.join(sections),
    )


TEMPLATE = """<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>melee-pc — issue board</title>
<meta name="description" content="Where every open and closed issue in the melee-pc port stands, grouped by area, with a one-line note on each.">
<style>
  :root {{
    --bg:#0e0f13; --fg:#e8e8ec; --dim:#a4a6b3; --line:#2a2c36;
    --accent:#e4b04a; --card:#171922;
    --open:#e4b04a; --closed:#5b8f6a;
  }}
  * {{ box-sizing:border-box; }}
  body {{ margin:0; font:16px/1.55 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;
         background:var(--bg); color:var(--fg); }}
  a {{ color:var(--accent); }}
  header {{ padding:3rem 1rem 1.6rem; text-align:center; border-bottom:1px solid var(--line); }}
  header h1 {{ margin:0; font-size:2.1rem; letter-spacing:.02em; }}
  header .sub {{ color:var(--dim); margin:.6rem 0 1.4rem; }}
  .bar {{ max-width:30rem; margin:0 auto; height:9px; background:#22242e;
          border-radius:99px; overflow:hidden; }}
  .bar i {{ display:block; height:100%; background:var(--closed); }}
  .counts {{ color:var(--dim); font-size:.9rem; margin-top:.6rem; }}
  main {{ max-width:70rem; margin:0 auto; padding:0 1rem 4rem; }}

  .area {{ margin-top:2.2rem; }}
  .board {{ position:relative; border:1px solid var(--line); border-radius:10px;
            background:var(--card); }}
  .areahead {{ position:absolute; left:0; right:0; top:0; padding:1.1rem 1.2rem .6rem; }}
  .areahead h2 {{ margin:0; font-size:1.15rem; }}
  .areahead p {{ margin:.25rem 0 0; color:var(--dim); font-size:.9rem; }}
  .areahead .tally {{ position:absolute; right:1.2rem; top:1.15rem;
                      color:var(--dim); font-size:.82rem; }}

  /* A pin is the head plus its label. The head marks the spot; the label
     carries the annotation, because a pin you have to hover to read is
     useless on a phone and in a printout. */
  .pin {{ position:absolute; width:calc(48% - 1rem); display:flex; gap:.6rem;
          text-decoration:none; color:inherit; align-items:flex-start; }}
  .pin .head {{ flex:0 0 auto; width:13px; height:13px; margin-top:.35rem;
                border-radius:50%; background:var(--open);
                box-shadow:0 0 0 4px rgba(228,176,74,.16); }}
  .pin.closed .head {{ background:var(--closed);
                       box-shadow:0 0 0 4px rgba(91,143,106,.16); }}
  .pin .label {{ min-width:0; }}
  .pin .num {{ font:600 .78rem/1 ui-monospace,SFMono-Regular,Menlo,monospace;
               color:var(--dim); display:inline-block; margin-right:.4rem; }}
  .pin .title {{ font-weight:600; }}
  .pin.closed .title {{ color:var(--dim); text-decoration:line-through;
                        text-decoration-color:var(--line); }}
  .pin .note {{ display:block; color:var(--dim); font-size:.86rem; margin-top:.2rem; }}
  .pin:hover .title {{ color:var(--accent); }}

  .legend {{ display:flex; gap:1.2rem; justify-content:center; color:var(--dim);
             font-size:.85rem; margin-top:1.2rem; flex-wrap:wrap; }}
  .legend span {{ display:flex; align-items:center; gap:.4rem; }}
  .legend i {{ width:11px; height:11px; border-radius:50%; display:inline-block; }}
  footer {{ color:var(--dim); font-size:.85rem; text-align:center;
            padding:0 1rem 3rem; }}

  /* One column on a narrow screen. The pins are positioned absolutely, so
     static flow replaces the board rather than fighting it. */
  @media (max-width:46rem) {{
    .board {{ height:auto !important; padding:1.2rem; background:var(--card); }}
    .areahead {{ position:static; padding:0 0 .9rem; }}
    .areahead .tally {{ position:static; display:block; margin-top:.3rem; }}
    .pin {{ position:static !important; width:auto;
            padding:.7rem 0; border-top:1px solid var(--line); }}
  }}
</style>
</head>
<body>
<header>
  <h1>melee-pc — issue board</h1>
  <p class="sub">Every issue in {repo}, grouped by area. Each pin carries one line on where that piece stands.</p>
  <div class="bar"><i style="width:{pct}%"></i></div>
  <p class="counts">{done} closed · {open_count} open · {pct}% of {total}</p>
  <div class="legend">
    <span><i style="background:var(--open)"></i> open</span>
    <span><i style="background:var(--closed)"></i> closed</span>
  </div>
</header>
<main>
{sections}
</main>
<footer>
  Generated by <code>tools/progress/build.py</code> from <code>tools/progress/issues.json</code>.
  The notes are written by hand; the tracker holds no field for them.
</footer>
</body>
</html>
"""


def audit(data):
    """Compare issues.json against the tracker, and report what drifted.

    The annotations cannot be checked this way, only the facts the tracker
    owns: which issues exist, and whether each is open or closed.
    """
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
        print(f'audit: #{n} is in the tracker and not in issues.json')
        bad = 1
    for n in sorted(set(mine) - set(live_state)):
        print(f'audit: #{n} is in issues.json and not in the tracker')
        bad = 1
    for n in sorted(set(mine) & set(live_state)):
        if mine[n] != live_state[n]:
            print(f'audit: #{n} is {live_state[n]} in the tracker '
                  f'and {mine[n]} in issues.json')
            bad = 1
    print('audit: issues.json matches the tracker' if not bad else
          'audit: issues.json is out of date')
    return bad


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--check', action='store_true',
                    help='exit 1 if the written page differs from the data')
    ap.add_argument('--audit', action='store_true',
                    help='compare issues.json against the tracker')
    args = ap.parse_args()

    data = load()
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
    print(f'wrote {OUT}: {len(data["issues"])} pins')
    return 0


if __name__ == '__main__':
    sys.exit(main())
