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
claimed and released, with everybody over four watching.

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
        # Both ship and the engine honours both: MELEE_BOOT_SCENE is read in
        # src/melee/gm/gm_1A3F.c:337,401 and MELEE_DEBUG_VS in
        # src/melee/gm/gmvsmode.c:199. The demo owes them a row for that
        # reason alone -- a working control the spec does not draw cannot be
        # measured by a parity read.
        ('ctl-MELEE_BOOT_SCENE', 'Boot to',
         _sel('Title screen', 'Versus', 'Training', 'Event match'),
         'Event starts on event match 1. Add &MELEE_EVENT=<0-50> to pick another.'),
        ('ctl-MELEE_DEBUG_VS', 'Versus opponent', _sel('Human', 'CPU'), ''),
        ('ctl-MELEE_20XX', '20XX', 'parent', ''),
        ('ctl-MELEE_BOOT_CSS', 'Character select', 'child', ''),
        ('ctl-MELEE_20XX_RULES', 'Tournament rules', 'child',
         '4 stock, 8 min, no items, no pause.'),
        # A child because 20XX implies it, and the browser target already
        # honours it: platforms/browser/pc_stubs.c:51 reads MELEE_UNLOCK_ALL and
        # falls back to pc_is_20xx_enabled, pc_stubs.c is in the link at
        # platforms/browser/CMakeLists.txt:46, and gm_1601.c consumes it at
        # 2451, 2562 and 2620. So the row needs no C work, only a SETTINGS
        # entry. An earlier note here said the C env read did not exist; that
        # was read off launcher.cpp, which the browser target never builds.
        ('ctl-MELEE_UNLOCK_ALL', 'Unlock everything', 'child', ''),
        ('ctl-MELEE_UCF', 'Controller fix', _chk(True), ''),
        ('ctl-MELEE_FROZEN_STADIUM', 'Hazardless stadium', _chk(), ''),
        ('ctl-MELEE_PAUSE', 'Allow pausing', _chk(True),
         'Tournament rules turn pausing off.'),
    ],
    'Video': [
        # Three modes, as src/pc/widescreen.c:33-49 has them: 0 = 73:60 (the
        # hardware PAR), 1 = exactly 16:9, 2 = fmaxf(73:60, width/height),
        # which fills the actual window (a phone in landscape).
        ('ctl-aspect', 'Aspect',
         _sel('Original (73:60)', 'Widescreen 16:9', 'Fill the window'), ''),
        ('ctl-hud-mode', 'HUD', _sel('Classic (4:3)', 'Wide (16:9)'), ''),
        ('ctl-MELEE_SCALE', 'Render scale',
         _sel('1.0 · 960x720', '0.667 · 640x480', '0.5 · 480x360'), ''),
        ('ctl-filter', 'Texture filter', _sel('1x', '4x', '16x'), ''),
        ('ctl-custom-textures', 'Custom textures', _chk(), ''),
        # A flag under a two-option label, exactly as the native launcher draws it
        # (launcher.cpp:360 and 1356 print prefs.free_camera as Normal/Free).
        # platforms/browser/pc_stubs.c:61 reads MELEE_FREE_CAMERA, so no C work.
        ('ctl-MELEE_FREE_CAMERA', 'Camera', _sel('Normal', 'Free'), ''),
        ('ctl-MELEE_HITBOXES', 'Show hitboxes', _chk(), ''),
    ],
    'Audio': [
        # The three sliders are not disabled: pc_audio_set_volume,
        # pc_audio_set_music_volume and pc_audio_set_sfx_volume are exported
        # and the web sliders are being wired to them.
        ('ctl-volume', 'Master', '<input type="range" value="80">', ''),
        ('ctl-music-volume', 'Music', '<input type="range" value="70">', ''),
        ('ctl-sfx-volume', 'Effects', '<input type="range" value="90">', ''),
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
        ('ctl-MELEE_NET_DELAY', 'Input delay',
         _sel('Saved', 'Auto', '0', '1', '2', '3', '4'), ''),
        ('ctl-net-relay', 'Connection', _sel('Direct, relay if needed', 'Relay always'),
         'A direct connection fails behind a symmetric NAT.'),
    ],
}


def _one(rid, label, control, hint, cls='setting'):
    # The hint is a tooltip, not a row of its own (#29 comment 3809: "don't add
    # more text bloat that could just be tooltips"). A hint that costs a line
    # per control spent the one phone viewport the panel has.
    title = f' title="{hint}"' if hint else ''
    return (f'<label class="{cls}" id="{rid}"{title}>{control}'
            f'<span class="setting-label">{label}</span></label>')


def _rows(rows):
    """Emit the rows, with a run of children nested under its parent.

    Not a fold: the owner ruled twice that the children sit open under the
    parent with no summary row (#29 comments 3181 and 3809). The fold saved a
    row and cost a click on every visit, and the "Individual settings" summary
    was itself the text bloat the ruling removes.
    """
    out, kids = [], []

    def flush():
        if not kids:
            return
        out.append(f'<div class="kids" id="kids-20xx">{"".join(kids)}</div>')
        kids.clear()

    for rid, label, control, hint in rows:
        if control == 'parent':
            flush()
            out.append(_one(rid, label, _chk(), hint, 'setting parent'))
        elif control == 'child':
            kids.append(_one(rid, label, _chk(), hint, 'setting child'))
        else:
            flush()
            out.append(_one(rid, label, control, hint))
    flush()
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


# The four ports are the lobby's real state. Two taken and two
# unavailable, since the networked game seats two.
PORTS = """
    <!-- Four tiles because a GameCube has four ports. P3 and P4 are marked
         unavailable because the networked game seats two, so no one can take them. -->
    <div id="ports" class="ports">
      <div class="port taken mine" id="port-1"><b>P1 <span id="port-mine" class="mine-tag">you</span></b><i>kiri</i><span class="psrc">adapter</span><button class="cbtn" id="port-1-pad" title="Connect a controller to this port">⌘</button><button class="pbtn">Release</button></div>
      <div class="port taken" id="port-2"><b>P2</b><i>guest-4f</i><span class="psrc">touch</span><button class="cbtn" title="Connect a controller to this port">⌘</button><button class="pbtn">Release</button></div>
      <div class="port off" id="port-3"><b>P3</b><i>2P only</i><span class="psrc">—</span><button class="cbtn" title="Connect a controller to this port">⌘</button><button class="pbtn" disabled>Take</button></div>
      <div class="port off" id="port-4"><b>P4</b><i>2P only</i><span class="psrc">—</span><button class="cbtn" title="Connect a controller to this port">⌘</button><button class="pbtn" disabled>Take</button></div>
    </div>
    <!-- The roster is who is in the room. There is no queue: a free port is
         takeable by anyone (#23). -->
    <p id="here" class="sub">In the room: kiri, guest-4f, mango, armada</p>
    <!-- The other half of #31: what a visitor holding no port is told. Drawn
         here because the mockup shows you holding P1, so the state cannot be
         shown on the tiles at the same time. -->
    <p id="no-port" class="sub seat-none">Spectating · you hold no port · take a free one</p>
"""


# A phone, drawn at its real size, because "no scrolling" is a claim about a
# fixed height and cannot be shown on a page that grows. 390x844 is an
# iPhone 14. The frame is the budget: if the controls do not fit inside it,
# the design is wrong, and the board shows that rather than describing it.
PHONE = """
<div id="phone">
  <div id="phone-frame">
    <div id="phone-screen">
      <div id="phone-game">
        <span id="phone-fps">60 fps</span>
        <button id="phone-menu">\u2630</button>
      </div>
      <div id="phone-sheet">
        <header id="phone-bar">
          <b>Melee</b>
          <button id="phone-room">FIG-7K2</button>
        </header>
        <div id="phone-ports">
          <span class="pp taken">P1 kiri</span>
          <span class="pp taken">P2 guest</span>
          <span class="pp cpu">P3 CPU</span>
          <span class="pp free">P4 take</span>
        </div>
        <div id="phone-tabs">
          <span class="pt on">Game</span><span class="pt">Video</span><span class="pt">Audio</span><span class="pt">Input</span><span class="pt">Net</span>
        </div>
        <div id="phone-pane">
          <span class="pr"><i class="box on"></i>20XX</span>
          <span class="pr"><i class="box"></i>Boot to CSS</span>
          <span class="pr"><i class="box on"></i>UCF</span>
          <span class="pr"><i class="box"></i>Hitboxes</span>
          <span class="pr"><i class="box on"></i>Pausing</span>
          <span class="pr"><i class="box"></i>Unlock all</span>
        </div>
        <button id="phone-apply">Apply &amp; reload</button>
      </div>
    </div>
  </div>
  <p id="phone-cap" class="sub">390 \u00d7 844, nothing scrolls</p>
</div>
"""

LAUNCHER = """
<div id="menu-panel">

  <header id="lobby-bar">
    <div class="lb-left">
      <span class="lb-title">Melee</span>
      <button id="load-btn" title="Load a save state">Load</button>
    </div>
    <div class="lb-right">
      <button id="room-code" title="Copy the link to this lobby" aria-label="Copy the link to this lobby"><b>FIG-7K2</b></button>
      <button id="join-btn">Join</button>
    </div>
  </header>

  <!-- The disc keeps a place outside the modal, because the disc is what
       the engine reads, and a visitor wants to know it is there. There is no
       load step and no progress bar: remote-disc.mjs answers one HTTP Range
       per block and disc-cache.mjs caches blocks, so the disc is never
       fetched as a unit and no total-loaded figure exists. The line says the
       disc is reachable, which is all the code can honestly report. #25 and
       melee-web#34 both hang off this. -->
  <p id="disc-state" class="disc">Disc ready &middot; served by this room &middot; read on demand, never loaded whole</p>

  <section id="lobby" class="group">
    <h2 class="group-h">Lobby <span class="sub-h">everyone at this link is in this room</span></h2>
    %PORTS%
  </section>


  <section id="settings" class="group">
    <h2 class="group-h">Settings <span class="sub-h">applied at boot, so Apply reloads the page</span></h2>
    <div id="setting-body">
      %TABS%
    </div>
    <div class="apply-row">
      <input id="settings-link" readonly value="http://melee.example/?room=FIG-7K2&amp;MELEE_20XX=1">
      <button id="settings-apply" class="primary">Apply &amp; reload</button>
    </div>
  </section>

  <details id="log-tab"><summary>Engine log</summary>
    <pre>engine: wasm ready
engine: adapter nvidia/turing
engine: 60.0 fps</pre></details>

</div>
"""

MODAL = """
<div id="load-modal" class="modal">
  <div id="states" class="sheet">
    <h2 class="group-h">Load a save state <span class="sub-h">the lobby keeps its ports</span></h2>
    <div class="states">
      <button class="state" id="state-vs"><b>Versus</b><i>Character select, 4 ports</i></button>
      <button class="state" id="state-20xx"><b>20XX lobby</b><i>Full cast, tournament rules</i></button>
      <button class="state" id="state-training"><b>Training menu</b><i>Hitboxes, no stocks</i></button>
      <button class="state" id="state-event"><b>Event stage</b><i>Event match 1</i></button>
    </div>
    <h2 class="group-h">Your saves</h2>
    <div class="states" id="own-states">
      <button class="state" id="state-own-1"><b>Fox ditto g3</b><i>yesterday &middot; 2 ports</i></button>
      <button class="state" id="state-own-2"><b>Ledge practice</b><i>Monday &middot; training</i></button>
    </div>
    <div class="sheet-row">
      <button id="state-save" class="primary">Save current state</button>
      <button id="load-close">Close</button>
    </div>
  </div>
</div>
"""


def launcher_html():
    return (LAUNCHER.replace('%PORTS%', PORTS).replace('%TABS%', _tabs())
            + MODAL + PHONE)
