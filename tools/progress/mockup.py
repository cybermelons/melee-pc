# SPDX-License-Identifier: GPL-3.0-or-later
"""The launcher as issue 21 proposes it, as markup rather than a picture.

This is the target the board measures against, so it is deliberately not a
screenshot of the launcher that exists today. Every id a pin anchors to lives
here, and build.py fails if an issue names one that does not.

Two things it is built around:

The lobby replaces the mode list. A visitor is in a lobby from the moment the
page opens, and the URL is the lobby, so the same link is always the same
room. Modes are not places to go, they are save states to load into the room
that already exists, the way a group on a couch puts on a different game
without changing seats. Ports are therefore the real state: four of them,
claimed and released, with everybody over four watching and queued.

The settings are tabs. The real flag list is long (96 MELEE_* names in the C
source), most of it debug instrumentation. The native launcher
(src/pc/launcher.cpp) already chose which of those a player should see, and
these tabs follow that choice rather than a new one. The 20XX row is a
select-all: env_flag_or_20xx in src/pc/input_poll.c turns a sub-flag on when
20XX is on OR when it is set by itself, so a parent checkbox with
individually selectable children is what the code actually does.

Keep this in step with platforms/browser/settings.mjs. A flag that gains a
control there wants a row here, or the mockup stops being the target.
"""

# Tab -> rows. Each row is (id-suffix, label, control-html, hint).
# The ids match the MELEE_* flag where one exists, so a pin can anchor to the
# control for the issue that owns that flag.
def _sel(*options, width=''):
    opts = ''.join(f'<option>{o}</option>' for o in options)
    return f'<select disabled{width}>{opts}</select>'


def _chk(on=False):
    return f'<input type="checkbox" disabled{" checked" if on else ""}>'


TABS = {
    'Game': [
        ('ctl-MELEE_20XX', '20XX conveniences', 'parent', ''),
        ('ctl-MELEE_BOOT_CSS', 'Boot to character select', 'child', ''),
        ('ctl-MELEE_20XX_RULES', 'Tournament rules', 'child',
         '4 stock, 8 minutes, items off.'),
        ('ctl-unlock-all', 'Unlock everything', 'child', ''),
        ('ctl-MELEE_UCF', 'Universal controller fix', _chk(True), ''),
        ('ctl-frozen-stadium', 'Pokémon Stadium', _sel('Normal', 'Hazardless'), ''),
        ('ctl-MELEE_PAUSE', 'Allow pausing', _chk(True),
         'Tournament rules turn pausing off.'),
    ],
    'Video': [
        ('ctl-aspect', 'Aspect', _sel('Original (73:60)', 'Widescreen 16:9'), ''),
        ('ctl-hud-mode', 'HUD', _sel('Classic (4:3)', 'Wide (16:9)'), ''),
        ('ctl-MELEE_SCALE', 'Render scale',
         _sel('1.0 · 960x720', '0.667 · 640x480', '0.5 · 480x360'),
         'Lower renders fewer pixels, to test whether pixel count is the limit.'),
        ('ctl-filter', 'Texture filter', _sel('1x', '4x', '16x'), ''),
        ('ctl-custom-textures', 'Custom textures', _chk(), ''),
        ('ctl-free-camera', 'Camera', _sel('Normal', 'Free'), ''),
        ('ctl-MELEE_HITBOXES', 'Show hitboxes', _chk(), ''),
    ],
    'Audio': [
        ('ctl-volume', 'Master', '<input type="range" disabled value="80">', ''),
        ('ctl-music-volume', 'Music', '<input type="range" disabled value="70">', ''),
        ('ctl-sfx-volume', 'Effects', '<input type="range" disabled value="90">', ''),
        ('ctl-reverb', 'Reverb', _chk(True), ''),
        ('ctl-mute', 'Mute when unfocused', _chk(), ''),
        ('ctl-MELEE_PAUSE_ON_BLUR', 'Pause when unfocused', _chk(),
         'A hidden tab always pauses. This covers a visible but unfocused page.'),
    ],
    'Input': [
        ('ctl-tap-jump', 'Tap to jump', _chk(),
         'Off by default: a tap meant for an attack reads as a jump.'),
        ('ctl-deadzone', 'Stick deadzone', _sel('Default', 'Wide'), ''),
        ('ctl-curve', 'Stick curve', _sel('Linear', 'Eased'), ''),
        ('ctl-cstick', 'C-stick', _sel('Stick', 'Buttons'), ''),
    ],
    'Netplay': [
        ('ctl-net-name', 'Display name',
         '<input type="text" disabled value="kiri" size="10">', ''),
        ('ctl-MELEE_NET_DELAY', 'Input delay', _sel('Auto', '1', '2', '3'), ''),
        ('ctl-net-relay', 'Connection', _sel('Direct, relay if needed', 'Relay always'),
         'A direct connection fails behind a symmetric NAT.'),
    ],
}


def _rows(rows):
    out = []
    for rid, label, control, hint in rows:
        cls = 'setting'
        if control == 'parent':
            cls += ' parent'
            control = _chk()
        elif control == 'child':
            cls += ' child'
            control = _chk()
        hint_html = f'<span class="setting-hint">{hint}</span>' if hint else ''
        out.append(f'<label class="{cls}" id="{rid}">{control}'
                   f'<span class="setting-label">{label}</span>'
                   f'{hint_html}</label>')
    return '\n        '.join(out)


def _tabs():
    names = list(TABS)
    heads = ''.join(
        f'<button class="tab{" on" if i == 0 else ""}" '
        f'data-pane="pane-{n.lower()}">{n}</button>'
        for i, n in enumerate(names))
    # Every panel is in the markup so a pin can anchor to a control on a tab
    # that is not in front. Only the first is shown.
    panes = '\n      '.join(
        f'<div class="pane{"" if i == 0 else " off"}" id="pane-{n.lower()}">'
        f'<div class="pane-grid">{_rows(TABS[n])}</div></div>'
        for i, n in enumerate(names))
    return (f'<div class="tab-heads" id="setting-tabs">{heads}</div>'
            f'\n      <div class="panes">{panes}</div>')


# The four ports are the lobby's real state. Two taken, one queued behind a
# claim, one free.
PORTS = """
    <div id="ports" class="ports">
      <div class="port taken" id="port-1"><b>P1</b><i>kiri</i><button class="pbtn">Release</button></div>
      <div class="port taken" id="port-2"><b>P2</b><i>guest-4f</i><button class="pbtn">Release</button></div>
      <div class="port cpu" id="port-3"><b>P3</b><i>CPU lv 9</i><button class="pbtn">Take</button></div>
      <div class="port free" id="port-4"><b>P4</b><i>free</i><button class="pbtn">Take</button></div>
    </div>
    <p id="queue" class="sub">2 watching · <b>mango</b> is next for a free port. A port taken mid-match drops in on the next frame.</p>
"""

LAUNCHER = """
<div id="menu-panel">

  <header id="lobby-bar">
    <div class="lb-left">
      <span class="lb-title">Melee</span>
      <span id="disc-state" class="chip">Loading disc… 62%</span>
    </div>
    <div class="lb-right">
      <button id="room-code" title="Copy the link to this lobby"><b>FIG-7K2</b><i>copy link</i></button>
      <button id="join-btn">Join</button>
    </div>
  </header>

  <section id="lobby" class="group">
    <h2 class="group-h">Lobby <span class="sub-h">everyone at this link is in this room</span></h2>
    %PORTS%
  </section>

  <section id="states" class="group">
    <h2 class="group-h">Load a save state</h2>
    <div class="states">
      <button class="state" id="state-vs"><b>Versus</b><i>Character select, 4 ports</i></button>
      <button class="state" id="state-20xx"><b>20XX lobby</b><i>Full cast, tournament rules</i></button>
      <button class="state" id="state-training"><b>Training menu</b><i>Hitboxes, no stocks</i></button>
      <button class="state" id="state-event"><b>Event stage</b><i>Event match 1</i></button>
    </div>
    <p id="states-note" class="sub">A state loads into this lobby. Nobody changes rooms, and the ports stay as they are. Training tools run outside the player ports, so a scenario needs no seat of its own.</p>
  </section>

  <section id="settings" class="group">
    <h2 class="group-h">Settings <span class="sub-h">applied at boot, so Apply reloads the page</span></h2>
    <div id="setting-body">
      %TABS%
    </div>
    <div class="apply-row">
      <input id="settings-link" readonly value="https://melee.example/?room=FIG-7K2&amp;MELEE_20XX=1">
      <button id="settings-apply" class="primary">Apply &amp; reload</button>
    </div>
  </section>

  <details id="log-tab"><summary>Engine log</summary>
    <pre>engine: wasm ready
engine: adapter nvidia/turing
engine: 60.0 fps</pre></details>

</div>
"""


def launcher_html():
    return LAUNCHER.replace('%PORTS%', PORTS).replace('%TABS%', _tabs())
