#!/usr/bin/env python3
"""Check MELEE_PAUSE_ON_BLUR reaches aurora's pauseOnFocusLost, opt-in.

Source-level, like the other pre-link checks: the flag is three hops (env ->
pc_is_pause_on_blur_enabled -> AuroraConfig.pauseOnFocusLost -> aurora
window::is_paused), and a break in any hop leaves a flag that parses and does
nothing. Pinning the default matters as much as the wiring: a pause that is on
by default stops a game whenever a second player, a stream layout or another
window takes focus.
"""
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]


def fail(message):
    print(f"FAIL: {message}")
    sys.exit(1)


def main():
    helper = (ROOT / 'src/pc/input_poll.c').read_text()
    body = re.search(
        r'bool pc_is_pause_on_blur_enabled\(void\) \{(.*?)\n\}', helper, re.S)
    if body is None:
        fail('pc_is_pause_on_blur_enabled is missing from src/pc/input_poll.c')
    # env_is_set treats a missing variable and "0" alike, which is what makes
    # the flag opt-in. env_flag_or_20xx would make MELEE_20XX imply it.
    if 'env_is_set("MELEE_PAUSE_ON_BLUR")' not in body.group(1):
        fail('pause-on-blur must read MELEE_PAUSE_ON_BLUR through env_is_set, '
             'so that unset and 0 both mean off')

    if 'bool pc_is_pause_on_blur_enabled(void);' not in (ROOT / 'src/pc/pc.h').read_text():
        fail('pc_is_pause_on_blur_enabled is not declared in src/pc/pc.h')

    # Both platforms, because a flag wired on one is a bug report on the other.
    for source in ('platforms/browser/main.c', 'src/pc/main.c'):
        text = (ROOT / source).read_text()
        if '.pauseOnFocusLost = pc_is_pause_on_blur_enabled(),' not in text:
            fail(f'{source} does not set .pauseOnFocusLost from the flag')

    # The engine half: aurora must still honour the config field, and must
    # still stop a hidden window regardless of it. Both are load-bearing --
    # the comment in platforms/browser/main.c promises the hidden case works
    # without the flag.
    window = (ROOT / 'extern/aurora/lib/window.cpp').read_text()
    paused = re.search(r'bool is_paused\(\) noexcept \{(.*?)\n\}', window, re.S)
    if paused is None:
        fail('aurora is_paused() not found in extern/aurora/lib/window.cpp')
    if 'g_config.pauseOnFocusLost' not in paused.group(1):
        fail('aurora is_paused() no longer reads pauseOnFocusLost')
    if 'SDL_WINDOW_HIDDEN' not in paused.group(1):
        fail('aurora is_paused() no longer stops a hidden window, so the '
             'opt-in flag is now the only thing pausing a backgrounded tab')

    print('pause-on-blur: flag opt-in, wired on both platforms, aurora honours it')


if __name__ == '__main__':
    main()
