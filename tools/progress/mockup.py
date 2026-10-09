# SPDX-License-Identifier: GPL-3.0-or-later
"""The launcher as issue 21 proposes it, as markup rather than a picture.

This is the target the board measures against, so it is deliberately not a
screenshot of the launcher that exists today. Every id a pin anchors to lives
here, and build.py fails if an issue names one that does not.

The settings rows are generated from the same list as the real form
(platforms/browser/settings.mjs). Keep the two in step: a flag that gains a
control there wants a row here, or the mockup stops being the target.
"""

# key, kind, label, hint
SETTINGS = [
    ('MELEE_BOOT_SCENE', 'choice', 'Boot to',
     'Event starts on event match 1.',
     ['Title screen', 'Versus', 'Training', 'Event match']),
    ('MELEE_DEBUG_VS', 'choice', 'Versus opponent', '', ['Human', 'CPU']),
    ('MELEE_20XX', 'flag', '20XX conveniences',
     'Unlocks the cast and boots to character select.', None),
    ('MELEE_HITBOXES', 'flag', 'Show hitboxes', '', None),
    ('MELEE_PAUSE', 'flag', 'Allow pausing',
     'Tournament rules turn pausing off.', None),
    ('MELEE_PAUSE_ON_BLUR', 'flag', 'Pause when unfocused',
     'A hidden tab always pauses. This covers a visible but unfocused page.',
     None),
    ('MELEE_SCALE', 'choice', 'Render scale',
     'Lower renders fewer pixels, to test whether pixel count is the limit.',
     ['1.0 · 960x720', '0.667 · 640x480', '0.5 · 480x360']),
]


def settings_rows():
    out = []
    for key, kind, label, hint, options in SETTINGS:
        hint_html = f'<span class="setting-hint">{hint}</span>' if hint else ''
        if kind == 'flag':
            control = ('<input type="checkbox" disabled'
                       f'{" checked" if key == "MELEE_PAUSE" else ""}>'
                       f'<span class="setting-label">{label}</span>')
        else:
            opts = ''.join(f'<option>{o}</option>' for o in options)
            control = (f'<span class="setting-label">{label}</span>'
                       f'<select disabled>{opts}</select>')
        out.append(f'<label class="setting" id="ctl-{key}">{control}'
                   f'{hint_html}</label>')
    return '\n      '.join(out)


# The three groups the redesign introduces: pick a mode, start a game, change
# the details. Today all of this is one flat column.
LAUNCHER = """
<div id="menu-panel">

  <section id="modes" class="group">
    <h2 class="group-h">1 · Pick a mode</h2>
    <div class="mode-row">
      <button class="mode" id="mode-vs"><b>Versus</b><i>Two players, one keyboard or two pads</i></button>
      <button class="mode" id="mode-cpu"><b>1P vs CPU</b><i>One player against the computer</i></button>
      <button class="mode" id="mode-training"><b>Training</b><i>Scenarios, hitboxes, no stocks</i></button>
      <button class="mode" id="mode-20xx"><b>20XX</b><i>Full cast, straight to character select</i></button>
    </div>
    <div id="room" class="room">
      <button id="new-room" class="mode wide"><b>New room</b><i>Play with someone over the internet</i></button>
      <p id="room-relay" class="sub">Rooms connect directly where the network allows it, and fall back to a relay where it does not.</p>
    </div>
  </section>

  <section id="play" class="group">
    <h2 class="group-h">2 · Choose a disc and start</h2>
    <div id="bar">
      <label id="disc" class="file">Choose a disc image<input type="file" disabled></label>
      <button id="start" class="primary">Start</button>
      <button id="adapter">Connect GC adapter</button>
    </div>
    <p id="status" class="sub">Engine ready. Pick a disc to enable Start.</p>
    <p id="phone-note" class="sub">On a phone the game fills the screen and this panel folds behind the menu button.</p>
  </section>

  <section id="settings" class="group">
    <h2 class="group-h">3 · Settings <span class="sub-h">applied at boot, so Apply reloads the page</span></h2>
    <div class="setting-grid">
      %SETTINGS%
    </div>
    <div id="access" class="setting-grid">
      <label class="setting"><input type="checkbox" disabled><span class="setting-label">Tap to jump</span><span class="setting-hint">Off by default: a tap meant for an attack reads as a jump.</span></label>
      <label class="setting"><span class="setting-label">Stick deadzone</span><select disabled><option>Default</option><option>Wide</option></select></label>
    </div>
    <div id="touch-layout" class="pad-preview">
      <span class="pad-h">On-screen controls</span>
      <div class="pad-map">
        <i class="pm stick">stick</i><i class="pm b">B</i><i class="pm a">A</i>
        <i class="pm y">Y</i><i class="pm l">L</i><i class="pm z">Z</i>
      </div>
      <span class="setting-hint">Tier 1 is the walk-up set. The rest sits behind a tab.</span>
    </div>
    <div class="apply-row">
      <input id="settings-link" readonly value="https://melee.example/?MELEE_BOOT_SCENE=vs">
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
    return LAUNCHER.replace('%SETTINGS%', settings_rows())
