#!/usr/bin/env python3
"""Check MELEE_BOOT_SCENE=event and MELEE_EVENT reach the event level table.

Source-level, like the other pre-link checks. The chain is short but every
hop is silent when it breaks: the picker offers a scene string, pc_boot_scene
maps that string to GM_EVENT, and pc_event_boot_level sets the level index
that onEnterVs reads out of sqEventInitDataLevelTbl. A typo in the scene
string gives a picker entry that falls through to the "unknown scene"
message, and a level override written anywhere but the init site is a value
that later readers of unk_535 disagree with.

The bound is checked rather than the parse: an out-of-range level indexes the
level table out of bounds, so the clamp is the part that must not regress.
"""
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]


def fail(message):
    print(f"FAIL: {message}")
    sys.exit(1)


def main():
    boot = (ROOT / 'src/melee/gm/gmboot.c').read_text()
    header = (ROOT / 'src/melee/gm/gmboot.h').read_text()
    event = (ROOT / 'src/melee/gm/gmevent.c').read_text()
    settings = (ROOT / 'platforms/browser/settings.mjs').read_text()

    scene = re.search(r'strcmp\(want, "event"\) == 0\) \{(.*?)\n        \}',
                      boot, re.S)
    if scene is None:
        fail('pc_boot_scene does not handle MELEE_BOOT_SCENE=event')
    if 'GM_EVENT' not in scene.group(1):
        fail('the event branch of pc_boot_scene must select GM_EVENT')

    # The picker's value has to be the exact string pc_boot_scene compares
    # against, or the option silently boots to the title screen.
    if "['event', " not in settings:
        fail("settings.mjs does not offer 'event' in the MELEE_BOOT_SCENE picker")

    level = re.search(r'u8 pc_event_boot_level\(void\)\n\{(.*?)\n\}', boot, re.S)
    if level is None:
        fail('pc_event_boot_level is missing from src/melee/gm/gmboot.c')
    body = level.group(1)
    if 'getenv("MELEE_EVENT")' not in body:
        fail('pc_event_boot_level must read MELEE_EVENT')
    # Match the comparison, not a mention of the constant: the OSReport call
    # names PC_EVENT_LEVEL_MAX too, so a substring check still passes when the
    # bound itself has been replaced by something wider.
    if not re.search(r'>\s*PC_EVENT_LEVEL_MAX', body):
        fail('pc_event_boot_level must compare the level against '
             'PC_EVENT_LEVEL_MAX, so an out-of-range value cannot index the '
             'level table')
    if not re.search(r'<\s*0', body):
        fail('pc_event_boot_level must reject a negative level')

    if 'u8 pc_event_boot_level(void);' not in header:
        fail('pc_event_boot_level is not declared in src/melee/gm/gmboot.h')
    if not re.search(r'#define PC_EVENT_LEVEL_MAX\s+50', header):
        fail('PC_EVENT_LEVEL_MAX must stay 50: retail has 51 event matches, '
             'numbered 0 to 50')

    # The override belongs at the one place unk_535 is initialised. Applied
    # later, the results screen and the high-score write see a different level
    # from the match that was played.
    if 'temp_r6->unk_535 = pc_event_boot_level();' not in event:
        fail('gmevent.c must apply pc_event_boot_level() where unk_535 is '
             'initialised')

    print('ok: MELEE_BOOT_SCENE=event and MELEE_EVENT are wired')


if __name__ == '__main__':
    main()
