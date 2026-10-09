#!/usr/bin/env python3
"""The pre-Start page controls must stay reachable on a phone.

Two bugs with the same shape shipped a black screen with nothing to tap. Both
hid or covered the controls from page load rather than from Start, and the
unit tests could not see either: they stub the DOM, so they know nothing about
CSS, and there is no browser in the dev container.

#game is fixed, fills the viewport and is black; #menu-panel wraps the mode
links and the Start button. A rule that hides or covers either of those must
be scoped to body.playing, because before Start the page IS the only way to
choose a mode, pick a disc, read an error and press Start.

Reading the cascade by eye is what failed. The rules were correct by
specificity and still wrong, twice. So this check is mechanical: it extracts
every declaration in the mobile block that could take a control away, and
reports any whose selector does not require .playing.
"""
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
PAGE = ROOT / 'platforms/browser/index.html'

# Controls a phone needs before the game runs: the mode links, the disc picker
# and Start, the status and the log that shows an error.
CONTROLS = {'#launch', '#perf', '#bar', '#log', '#menu-panel', '#game', 'body', 'canvas'}

# Deliberately hidden on a phone at all times, game running or not.
# h1 and #keys are page furniture; #touch is the overlay's own root.
ALLOWED_ALWAYS_HIDDEN = {'h1', '#keys', '#touch'}

# Declarations that can take a control away from a thumb.
TAKES_AWAY = (
    re.compile(r'display\s*:\s*none'),
    re.compile(r'position\s*:\s*fixed'),
    re.compile(r'overflow\s*:\s*hidden'),
    re.compile(r'visibility\s*:\s*hidden'),
)


def mobile_block(text):
    start = text.index('@media (pointer: coarse)')
    depth = 0
    i = text.index('{', start)
    for j in range(i, len(text)):
        if text[j] == '{':
            depth += 1
        elif text[j] == '}':
            depth -= 1
            if depth == 0:
                return text[i + 1:j]
    sys.exit('unterminated @media (pointer: coarse) block')


def rules(block):
    # Strip comments first: they contain the words this script greps for.
    block = re.sub(r'/\*.*?\*/', '', block, flags=re.DOTALL)
    for match in re.finditer(r'([^{}]+)\{([^{}]*)\}', block):
        yield match.group(1).strip(), match.group(2).strip()


def main():
    problems = []
    checked = 0
    for selector, body in rules(mobile_block(PAGE.read_text())):
        hits = [p.pattern for p in TAKES_AWAY if p.search(body)]
        if not hits:
            continue
        parts = [s.strip() for s in selector.split(',')]
        for part in parts:
            # An always-hidden piece of furniture is fine.
            if part in ALLOWED_ALWAYS_HIDDEN:
                continue
            # Does this selector name a control we care about?
            if not any(c in part for c in CONTROLS):
                continue
            checked += 1
            # Scoped to a running game: correct.
            if '.playing' in part and ':not(.playing)' not in part:
                continue
            problems.append(f'  {part} {{ {body.splitlines()[0]} ... }}\n'
                            f'      applies before Start and sets: {", ".join(hits)}')

    if problems:
        print('Rules that take a control away before the game runs:\n')
        print('\n'.join(problems))
        sys.exit(f'\n{len(problems)} rule(s) would leave a phone with nothing to tap')
    print(f'mobile css: {checked} hiding/covering rule(s) checked, all scoped to body.playing')

    # The rules that reveal #menu-panel live only in the coarse block, so the
    # button that toggles them must not show anywhere else: on a desktop it
    # was a click that changed nothing.
    text = PAGE.read_text()
    if 'body.playing.menu #menu-panel' not in mobile_block(text):
        sys.exit('menu panel reveal moved out of @media (pointer: coarse)')
    if not re.search(r'@media not all and \(pointer: coarse\)\s*\{\s*#pad-menu\s*\{\s*display:\s*none;', text):
        sys.exit('#pad-menu shows outside @media (pointer: coarse), where it opens nothing')
    print('mobile css: #pad-menu hidden wherever the menu panel cannot open')


if __name__ == '__main__':
    main()
