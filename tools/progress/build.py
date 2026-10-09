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
            f'href="{e(i.get("base", data["base"]))}{i["n"]}" '
            f'target="_blank" rel="noopener">'
            f'<span class="pin-n">{e(i.get("tag", ""))}{i["n"]}</span>'
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
  .board {{ display:grid; grid-template-columns:340px minmax(0,640px) 340px;
            justify-content:center; gap:0 36px;
            max-width:1500px; margin:0 auto; padding:1rem 1rem 4rem; }}
  #stage {{ position:relative; grid-column:2; }}
  /* Each column is its own positioning context, so a label cannot escape
     the page however long it grows. */
  #pin-left {{ position:relative; grid-column:1; }}
  #pin-right {{ position:relative; grid-column:3; }}

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

  /* ---- lobby bar: the room code lives top right ---- */
  #lobby-bar {{ display:flex; align-items:center; justify-content:space-between;
                gap:12px; flex-wrap:wrap;
                border-bottom:1px solid var(--line); padding-bottom:14px; }}
  .lb-left, .lb-right {{ display:flex; align-items:center; gap:8px; }}
  .lb-title {{ font-weight:600; font-size:.98rem; white-space:nowrap; }}
  .chip {{ font-size:.74rem; color:var(--dim); background:#191b24;
           border:1px solid var(--line); border-radius:99px; padding:3px 9px; }}
  #room-code {{ display:flex; align-items:baseline; gap:7px; padding:7px 12px;
                border-radius:8px; background:#1d2130; color:var(--fg);
                border:1px solid #3c4252; }}
  #room-code b {{ font:600 .95rem/1 ui-monospace,SFMono-Regular,Menlo,monospace;
                  letter-spacing:.06em; }}
  #room-code i {{ font-style:normal; font-size:.7rem; color:var(--dim); }}
  #join-btn, #load-btn {{ padding:7px 12px; border-radius:8px; background:#191b24;
               color:var(--fg); border:1px solid var(--line);
               font-size:.82rem; }}
  /* #33: the slot the disc chip used to hold. A press, not a reading. */
  #load-btn {{ background:#1d2130; border-color:#3c4252; }}
  /* #33: one line, because the browser build has no total-loaded figure to
     draw a bar from. */
  .disc {{ margin:0; color:#6f7280; font-size:.74rem; }}

  /* ---- ports: one row, because the lobby is one couch ---- */
  .ports {{ display:grid; grid-template-columns:repeat(4,1fr); gap:8px; }}
  .port {{ display:grid; gap:3px; padding:9px 10px; border-radius:9px;
           background:#15171f; border:1px solid var(--line); }}
  .port b {{ font-size:.72rem; letter-spacing:.08em; color:var(--dim); }}
  .port i {{ font-style:normal; font-size:.84rem; }}
  .port.taken {{ background:#1d2130; border-color:#3c4252; }}
  .port.cpu i {{ color:var(--dim); }}
  .port.free {{ border-style:dashed; }}
  .port.free i {{ color:#6f7280; }}
  .pbtn {{ margin-top:2px; padding:4px 8px; border-radius:6px; font-size:.74rem;
           background:#191b24; color:var(--fg); border:1px solid var(--line); }}
  .port.free .pbtn {{ background:var(--accent); color:#1a1405;
                      border-color:var(--accent); font-weight:600; }}
  /* #31: the port you hold. A left bar and a word, not colour alone, so the
     marker survives a colour-blind reader and a greyscale screenshot. */
  .port.mine {{ border-color:var(--accent); box-shadow:inset 3px 0 0 var(--accent); }}
  .mine-tag {{ margin-left:4px; padding:0 4px; border-radius:3px; font-size:.64rem;
               background:var(--accent); color:#1a1405; letter-spacing:.04em; }}
  /* #30: which source feeds this port, and the button that changes it. */
  .psrc {{ font-size:.68rem; color:var(--dim); letter-spacing:.03em; }}
  .cbtn {{ justify-self:start; padding:2px 7px; border-radius:6px; font-size:.8rem;
           background:#191b24; color:var(--fg); border:1px solid var(--line); }}
  #queue {{ margin:0; color:var(--dim); font-size:.78rem; }}
  #queue b {{ color:var(--fg); font-weight:600; }}
  /* #31: stated rather than left to be inferred from four taken tiles. */
  .seat-none {{ margin:0; padding:5px 9px; border-radius:7px;
                border:1px dashed var(--line); color:var(--dim); font-size:.76rem; }}

  /* ---- save states, not places to go ----
     #33 moved them behind the Load button. The modal is drawn open and after
     the panel, because the board has to show what the button opens: a closed
     dialog measures 0x0 and no pin could anchor into it. */
  .modal {{ margin-top:14px; padding:14px; border-radius:12px;
            background:#0f1117; border:1px solid #3c4252;
            box-shadow:0 10px 30px #0008; }}
  .modal .sheet {{ display:grid; gap:10px; }}
  .sheet-row {{ display:flex; gap:8px; flex-wrap:wrap; }}
  .sheet-row button {{ padding:7px 12px; border-radius:8px; font-size:.82rem;
                       background:#191b24; color:var(--fg);
                       border:1px solid var(--line); }}
  .sheet-row .primary {{ background:var(--accent); color:#1a1405;
                         border-color:var(--accent); font-weight:600; }}
  .states {{ display:grid; grid-template-columns:1fr 1fr; gap:8px; }}
  .state {{ text-align:left; display:grid; gap:2px; padding:9px 10px;
            background:#191b24; color:var(--fg);
            border:1px solid var(--line); border-radius:9px; }}
  .state b {{ font-size:.86rem; }}
  .state i {{ font-style:normal; color:var(--dim); font-size:.72rem; }}
  #state-vs {{ border-color:#3c4252; background:#1d2130; }}
  #states-note {{ margin:0; color:#6f7280; font-size:.76rem; }}

  /* ---- settings tabs: horizontal space instead of one long column ----
     Every pane stays in the markup so a pin can anchor to a control on a tab
     that is not in front; the hidden panes are moved off-screen rather than
     display:none, because a display:none element measures 0x0 and the pin
     placer would stack its label at the top of the column. */
  .tab-heads {{ display:flex; gap:4px; flex-wrap:wrap;
                border-bottom:1px solid var(--line); }}
  .tab {{ padding:7px 12px; font-size:.82rem; background:none; color:var(--dim);
          border:1px solid transparent; border-bottom:none;
          border-radius:7px 7px 0 0; }}
  .tab.on {{ color:var(--fg); background:#191b24; border-color:var(--line);
             margin-bottom:-1px; }}
  /* All panes share one grid cell, so the stack is as tall as the tallest
     pane and a tab switch moves nothing below it. Measured before this:
     the pane went 244px to 100px and the Apply button jumped 144px. */
  .panes {{ display:grid; }}
  .panes > .pane {{ grid-area:1/1; }}
  .pane {{ padding:12px 2px 0; }}
  /* An off pane is hidden but still measurable, so a pin can anchor to a
     control behind another tab. opacity:0 keeps the box; z-index keeps it
     under the pane in front, which is what paints. */
  .pane.off {{ z-index:-1; opacity:0; pointer-events:none; }}
  .pane-grid {{ display:grid; grid-template-columns:1fr 1fr; gap:7px 18px; }}

  /* A run of children folds under its select-all. The fold is open on the
     board so every pinned control has a box to measure. */
  .kids {{ grid-column:1/-1; }}
  .kids > summary {{ margin-left:22px; color:var(--dim); font-size:.74rem;
                     cursor:pointer; list-style:none; }}
  .kids > summary::before {{ content:"\\25b8 "; }}
  .kids[open] > summary::before {{ content:"\\25be "; }}
  .kids .setting {{ margin-top:5px; }}
  /* #29: the children as a grid, so five short labels cost two rows rather
     than five. auto-fit rather than a fixed count: the pane is one column at
     390px, where two children per row do not fit. */
  .kid-grid {{ display:grid; grid-template-columns:repeat(auto-fit,minmax(9.5rem,1fr));
               gap:2px 10px; }}
  .setting.parent {{ font-weight:600; grid-column:1/-1; }}
  .setting.child {{ padding-left:18px;
                    border-left:2px solid #2a2d38; margin-left:4px; }}
  .setting input[type=range] {{ width:92px; accent-color:var(--accent); }}

  .setting {{ display:flex; align-items:center; gap:7px; flex-wrap:wrap;
              font-size:.84rem; }}
  .setting-label {{ color:var(--fg); }}
  .setting select {{ background:#191b24; color:var(--fg); font:inherit;
                     border:1px solid var(--line); border-radius:6px;
                     padding:3px 6px; max-width:11rem; }}
  .setting-hint {{ flex-basis:100%; color:#6f7280; font-size:.73rem; }}
  .primary {{ background:var(--accent) !important; color:#1a1405 !important;
              border-color:var(--accent) !important; font-weight:600; }}
  .apply-row button {{ padding:9px 14px; border-radius:8px;
           border:1px solid var(--line); background:#191b24; color:var(--fg); }}
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

  /* ---- narrow: the game screen, not a squeezed desktop ---- */
  @media (max-width:560px) {{
    #menu-panel {{ padding:12px; gap:12px; }}
    /* The bar wrapped onto two rows at 390px because the title, the disc
       chip and two buttons do not fit. The room code is the one thing that
       has to stay reachable, so it keeps the right and the chip gives way. */
    #lobby-bar {{ gap:8px; padding-bottom:10px; flex-wrap:nowrap; }}
    .lb-left {{ min-width:0; gap:6px; }}
    .lb-right {{ flex:none; gap:6px; }}
    .lb-title {{ font-size:.88rem; }}
    #disc-state {{ font-size:.68rem; }}
    #room-code {{ padding:6px 10px; }}
    #room-code i {{ display:none; }}
    #join-btn {{ padding:6px 10px; }}

    .group-h {{ font-size:.74rem; }}
    .sub-h {{ display:none; }}
    .port {{ padding:7px 8px; }}
    .port i {{ font-size:.78rem; }}
    .pbtn {{ padding:3px 6px; }}
    .modal {{ padding:10px; }}
    .states {{ gap:6px; }}
    .state {{ padding:7px 9px; }}
    .state b {{ font-size:.8rem; }}
    .state i {{ font-size:.68rem; }}

    /* Five tab heads wrapped to a second row. They share the width evenly
       instead, which is what a tab bar on a phone does. */
    .tab-heads {{ display:grid; grid-template-columns:repeat(5,1fr); gap:2px; }}
    .tab {{ padding:7px 2px; font-size:.72rem; text-align:center; }}
    .pane {{ padding:10px 0 0; }}
    .pane-grid {{ grid-template-columns:1fr; gap:4px; }}
    .setting {{ font-size:.78rem; gap:6px; }}
    .setting-hint {{ display:none; }}
    .setting select {{ max-width:8.5rem; padding:2px 5px; }}
    .setting.child {{ padding-left:12px; }}
    .apply-row {{ gap:6px; }}
    #settings-link {{ min-width:0; font-size:11px; padding:6px 8px; }}
  }}

  /* ---- the phone: the viewport is the budget ----
     The launcher is a game screen. Every option has to be reachable inside
     one viewport, with no page scroll, so the board draws a real 390x844
     screen beside the desktop panel. If the controls stop fitting in this
     box, the design is wrong and the picture says so. */
  #phone {{ margin:26px auto 0; width:max-content; }}
  #phone-frame {{ width:min(390px,100%); aspect-ratio:390/844;
                  border:10px solid #23252e; box-sizing:border-box;
                  border-radius:38px; background:#000; overflow:hidden; }}
  #phone {{ max-width:100%; }}
  #phone-screen {{ position:relative; width:100%; height:100%;
                   display:flex; flex-direction:column; }}
  /* The game owns the viewport. The menu is a sheet over it, not a page
     under it. */
  #phone-game {{ flex:1; background:
      radial-gradient(120% 80% at 50% 10%,#1b2434 0%,#0a0c12 70%);
      position:relative; }}
  #phone-fps {{ position:absolute; top:10px; left:12px; color:#4e5260;
                font-size:.68rem; }}
  #phone-menu {{ position:absolute; top:8px; right:10px; width:34px;
                 height:34px; border-radius:9px; font-size:1rem;
                 background:#ffffff14; color:var(--fg);
                 border:1px solid #ffffff22; }}
  #phone-sheet {{ background:#111; border-top:1px solid var(--line);
                  padding:12px 12px 14px; display:grid; gap:10px; }}
  #phone-bar {{ display:flex; align-items:center; justify-content:space-between; }}
  #phone-bar b {{ font-size:.92rem; }}
  #phone-room {{ padding:5px 10px; border-radius:7px; background:#1d2130;
                 color:var(--fg); border:1px solid #3c4252;
                 font:600 .78rem/1 ui-monospace,SFMono-Regular,Menlo,monospace;
                 letter-spacing:.05em; }}
  #phone-ports {{ display:grid; grid-template-columns:repeat(4,1fr); gap:5px; }}
  .pp {{ padding:6px 4px; text-align:center; font-size:.66rem;
         border-radius:7px; background:#15171f;
         border:1px solid var(--line); color:var(--dim); }}
  .pp.taken {{ background:#1d2130; border-color:#3c4252; color:var(--fg); }}
  .pp.free {{ background:var(--accent); color:#1a1405; border-color:var(--accent);
              font-weight:600; }}
  #phone-tabs {{ display:flex; gap:3px; border-bottom:1px solid var(--line); }}
  .pt {{ flex:1; text-align:center; padding:6px 2px; font-size:.68rem;
         color:var(--dim); border-radius:6px 6px 0 0; }}
  .pt.on {{ color:var(--fg); background:#191b24; }}
  /* Two columns, because one column of settings on a phone is the content
     app this must not be. */
  #phone-pane {{ display:grid; grid-template-columns:1fr 1fr; gap:7px 10px; }}
  .pr {{ display:flex; align-items:center; gap:6px; font-size:.72rem; }}
  .box {{ width:12px; height:12px; border-radius:3px; flex:none;
          border:1px solid #4a4e5e; background:#15171f; }}
  .box.on {{ background:var(--accent); border-color:var(--accent); }}
  #phone-apply {{ padding:9px; border-radius:8px; font-weight:600;
                  background:var(--accent); color:#1a1405;
                  border:1px solid var(--accent); }}
  #phone-cap {{ text-align:center; margin:.5rem 0 0; font-size:.74rem; }}

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

  /* Narrow: the board is still a board. The earlier fallback hid the dots
     and printed the labels as a list under the mockup, which is the one
     thing this page must not be. The dots stay on the control; the label
     becomes a tooltip that a tap opens. */
  @media (max-width:1320px) {{
    .board {{ display:block; max-width:680px; }}
    #leads {{ display:none; }}
    #pin-left, #pin-right {{ position:static; }}
    .pin {{ position:fixed; width:min(17rem,74vw); z-index:6;
            display:none; text-align:left !important;
            grid-template-columns:auto 1fr !important;
            background:#171922; border:1px solid #3c4252; border-radius:9px;
            padding:.6rem .7rem; box-shadow:0 8px 24px #000a; }}
    .pin.shown {{ display:grid; }}
    .dot {{ pointer-events:auto; cursor:pointer; width:14px; height:14px;
            margin:-7px 0 0 -7px; }}
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
  // Below the breakpoint there is no label column and no leader line, but
  // the dots still belong on the controls: they are the whole board. Only
  // the column placement and the lines are skipped.
  const wide = getComputedStyle(leads).display !== 'none';

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
    if (wide) {{
      const col = w.left ? colL : colR;
      w.pin.style.top = `${{w.ly + base.top - col.top}}px`;
    }}

    const dot = document.createElement('span');
    dot.className = 'dot' + (w.pin.classList.contains('closed') ? ' closed' : '');
    dot.style.left = `${{w.ax}}px`;
    dot.style.top = `${{w.ay}}px`;
    // Narrow mode has no room for a label column, so the dot opens its own
    // label as a tooltip. The dot is the handle; the control under it stays
    // free to behave like a control.
    dot.addEventListener('click', (ev) => {{
      ev.stopPropagation();
      const was = w.pin.classList.contains('shown');
      for (const q of pins) q.classList.remove('shown');
      if (was) return;
      w.pin.classList.add('shown');
      // Place it beside the dot, then pull it back inside the page.
      const pad = 10;
      const now = stage.getBoundingClientRect();
      w.pin.style.top = `${{w.ay + now.top + 14}}px`;
      w.pin.style.left = '0px';
      const r = w.pin.getBoundingClientRect();
      let x = w.ax + now.left - r.width / 2;
      x = Math.max(pad, Math.min(x, window.innerWidth - r.width - pad));
      w.pin.style.left = `${{x}}px`;
    }});
    stage.append(dot);

    if (!wide) continue;
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

// A tap outside closes the open tooltip. Without this the only way to
// dismiss one is to find its own dot again.
document.addEventListener('click', () => {{
  for (const q of pins) q.classList.remove('shown');
}});

// The tabs are the one live control on the mockup, because a tab that does
// not switch cannot show that the settings fit in the width. An off pane keeps
// its box (opacity:0 and z-index:-1, not display:none), so a pin anchored to a
// control behind another tab still measures and still points at it.
for (const tab of document.querySelectorAll('.tab')) {{
  tab.style.cursor = 'pointer';
  tab.addEventListener('click', () => {{
    const want = tab.dataset.pane;
    for (const t of document.querySelectorAll('.tab')) t.classList.toggle('on', t === tab);
    for (const pane of document.querySelectorAll('.pane')) {{
      pane.classList.toggle('off', pane.id !== want);
    }}
    place();
  }});
}}
</script>
</body>
</html>
"""


def audit(data):
    """Compare issues.json against the tracker and report what drifted."""
    # tea defaults to 30 rows per page and says nothing about it, so page
    # until one comes back short. (#11 and #16 are absent from this list for a
    # different reason: they are pull requests, and tea issues list excludes
    # them. The board carries no pins for either, so the audit is unaffected.)
    live, page = [], 1
    while True:
        try:
            raw = subprocess.run(
                ['tea', 'issues', 'list', '--login', 'noel',
                 '--repo', data['repo'], '--state', 'all', '--output', 'json',
                 '--limit', '50', '--page', str(page)],
                capture_output=True, text=True, timeout=60, check=True).stdout
        except (OSError, subprocess.SubprocessError) as err:
            print(f'audit: could not reach the tracker: {err}')
            return 1
        try:
            batch = json.loads(raw)
        except json.JSONDecodeError:
            # tea prints an error page rather than JSON when the login is wrong.
            print(f'audit: the tracker did not return JSON: {raw[:200]!r}')
            return 1
        live += batch
        if len(batch) < 50:
            break
        page += 1

    live_state = {int(i['index']): i['state'] for i in live}
    mine = {i['n']: i['state'] for i in data['issues'] if 'base' not in i}
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
