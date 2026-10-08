#!/usr/bin/env python3
"""Check the browser link needs no function-pointer-cast emulation.

EMULATE_FUNCTION_POINTER_CASTS wraps every indirect call and emits a thunk per
signature. It cost 1.55 MB of the wasm module (9.6%) and Melee's engine calls
through pointers constantly, so the wrapper cost is spread everywhere and does
not show up as one hot function.

The decomp turned out not to need it: exactly one prototype disagreed with its
definition. ftLib_IsFramesRemaining was declared void while it returns
ftAnim_IsFramesRemaining's bool, and gm_1798.c declared it s32 locally and
compared the result to 0.

This is a source-level check, because the real one is the link itself: a
reintroduced mismatch makes wasm-ld print "function signature mismatch" and,
without the flag, the call traps at run time instead of being wrapped. The
check pins both ends so neither half can regress quietly: the flag must stay
out, and the prototype that forced it must stay consistent.
"""
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]


def fail(message):
    print(f"FAIL: {message}")
    sys.exit(1)


def main():
    cmake = (ROOT / 'platforms/browser/CMakeLists.txt').read_text()
    if 'EMULATE_FUNCTION_POINTER_CASTS' in cmake.replace('# ', '#'):
        # The rationale comment names the flag, so only a live link option counts.
        for line in cmake.splitlines():
            stripped = line.lstrip()
            if stripped.startswith('#'):
                continue
            if 'EMULATE_FUNCTION_POINTER_CASTS' in line:
                fail('EMULATE_FUNCTION_POINTER_CASTS is back in the browser link '
                     'options; it costs 1.55 MB and a wrapper on every indirect '
                     'call. If a signature mismatch forced it back, fix the '
                     'prototype instead and say which one here.')

    # The one prototype that forced the flag. bool in all three places, and no
    # local extern re-declaring it: that local s32 is what hid the conflict.
    ftlib_h = (ROOT / 'src/melee/ft/ftlib.h').read_text()
    if not re.search(r'bool ftLib_IsFramesRemaining\(HSD_GObj\*\);', ftlib_h):
        fail('src/melee/ft/ftlib.h must declare ftLib_IsFramesRemaining as bool; '
             'it forwards ftAnim_IsFramesRemaining, which returns bool')

    ftlib_c = (ROOT / 'src/melee/ft/ftlib.c').read_text()
    if not re.search(r'bool ftLib_IsFramesRemaining\(HSD_GObj\* gobj\)', ftlib_c):
        fail('src/melee/ft/ftlib.c must define ftLib_IsFramesRemaining as bool')

    caller = (ROOT / 'src/melee/gm/gm_1798.c').read_text()
    if re.search(r'extern\s+\w+\s+ftLib_IsFramesRemaining', caller):
        fail('src/melee/gm/gm_1798.c re-declares ftLib_IsFramesRemaining locally; '
             'that local prototype is what disagreed with the definition. '
             'Include melee/ft/ftlib.h instead.')
    if 'melee/ft/ftlib.h' not in caller:
        fail('src/melee/gm/gm_1798.c calls ftLib_IsFramesRemaining but does not '
             'include melee/ft/ftlib.h')

    print('OK: browser link needs no fpcast emulation')


if __name__ == '__main__':
    main()
