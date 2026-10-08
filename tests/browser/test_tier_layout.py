#!/usr/bin/env python3
"""Check the two control tiers stay wired (issue #3).

Source-level, like the other pre-link checks. The tier is a class on <body>
plus one stylesheet rule, so the pieces sit in three files and a break in any
one of them leaves a toggle that does nothing: a rule without the marked
controls hides everything, and marked controls without the rule hide nothing.
"""
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]

# Tier 1 is the walk-up set from the issue: stick, A, B and jump. Jump is Y
# rather than the X the issue names, because the shipped button positions
# follow a later direct request.
TIER1 = {'stick', 'a', 'b', 'y'}


def fail(message):
    print(f"FAIL: {message}")
    sys.exit(1)


def main():
    touch = (ROOT / 'platforms/browser/touch.mjs').read_text()

    # Exactly the walk-up set carries tier1, so tier 1 is four controls. A
    # fifth would put a control in front of a visitor the issue keeps back; a
    # missing one would leave them unable to move or attack.
    marked = set(re.findall(r"\{ id: '(\w+)'[^}]*tier1: true", touch))
    if marked != TIER1:
        fail('the tier 1 controls in platforms/browser/touch.mjs are '
             f'{sorted(marked)}, expected {sorted(TIER1)}')

    # The class has to reach the element, or the stylesheet cannot see it.
    if "if (control.tier1) el.classList.add('tier1');" not in touch:
        fail('touch.mjs no longer puts the tier1 class on the element, so the '
             'stylesheet rule cannot tell the tiers apart')

    html = (ROOT / 'platforms/browser/index.html').read_text()
    # The rule that hides tier 2. Checked with its two exemptions: the drawer
    # (X and the D-pad, which the game's menus need) is not a .pad at all, and
    # #pad-full is a page control that only borrows the look.
    rule = re.search(r'body\.tier1\s+#touch[^{]*\{[^}]*display:\s*none', html)
    if rule is None:
        fail('index.html has no body.tier1 rule hiding the tier 2 controls, '
             'so the toggle changes nothing')
    if '#pad-full' not in rule.group(0):
        fail('the body.tier1 rule no longer exempts #pad-full, so tier 1 '
             'hides the fullscreen button')

    tier = (ROOT / 'platforms/browser/tier.mjs').read_text()
    # Tier 1 is the default for a new visitor. Written as the fallback of the
    # stored read, so a missing or unreadable value lands there.
    if "=== '2' ? 2 : 1" not in tier:
        fail('tier.mjs no longer defaults a new visitor to tier 1')
    # The toggle must not go through the reload path: settings.mjs reloads,
    # and a reload mid-match loses a locally picked disc.
    if 'location.assign' in tier or 'location.reload' in tier:
        fail('tier.mjs reloads the page; the tier belongs to the overlay and '
             'must apply live, because a reload loses a local disc')

    shell = (ROOT / 'platforms/browser/shell.mjs').read_text()
    if 'addTierToggle(' not in shell:
        fail('shell.mjs never calls addTierToggle, so the toggle is absent '
             'and the stored tier is never applied')

    print(f'tiers: {len(TIER1)} walk-up controls, rule present, applies live')


if __name__ == '__main__':
    main()
