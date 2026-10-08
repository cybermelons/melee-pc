#!/usr/bin/env python3
"""Every Module._* the page calls must be in -sEXPORTED_FUNCTIONS.

-sEXPORTED_FUNCTIONS replaces Emscripten's default export list rather than
extending it, so a name the JS calls but the flag omits links fine and fails at
runtime, in the subsystem that made the call rather than anywhere near the
flag. _malloc reached production that way once: it survived only because
something else in the link happened to keep it.

This check is mechanical on purpose. It reads the two sides and compares them,
so a new Module._* call fails the build instead of a user's browser.
"""
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
BROWSER = ROOT / 'platforms/browser'


def exported():
    text = (BROWSER / 'CMakeLists.txt').read_text()
    match = re.search(r'-sEXPORTED_FUNCTIONS=([^\s]+)', text)
    if match is None:
        sys.exit('no -sEXPORTED_FUNCTIONS in platforms/browser/CMakeLists.txt')
    return set(match.group(1).split(','))


def called():
    found = {}
    for path in sorted(BROWSER.glob('*.mjs')):
        for line_no, line in enumerate(path.read_text().splitlines(), 1):
            for name in re.findall(r'Module\.(_[A-Za-z0-9_]+)', line):
                found.setdefault(name, f'{path.relative_to(ROOT)}:{line_no}')
    return found


def main():
    have = exported()
    missing = {n: w for n, w in called().items() if n not in have}
    if missing:
        for name, where in sorted(missing.items()):
            print(f'{where}: Module.{name} is called but not in EXPORTED_FUNCTIONS')
        sys.exit(f'{len(missing)} unexported symbol(s)')
    print(f'exports: {len(called())} Module._* calls, all exported')


if __name__ == '__main__':
    main()
