// SPDX-License-Identifier: GPL-3.0-or-later
// The control tier toggle (#3): tier 1 is stick, A, B and jump; tier 2 adds the
// C-stick, the shoulders, Z and Start.
//
// Not a MELEE_* setting. Every entry in settings.mjs edits the query string and
// reloads, because the engine caches each flag behind a `static int on = -1` at
// first read. The tier is a property of the overlay rather than of the engine,
// so it can change live -- and it has to, because a reload loses a locally
// picked disc, and the player who wants more buttons is mid-match.
//
// The tier itself is one class on <body>, applied by the stylesheet. This
// module only owns the class and the control that flips it.
const KEY = 'melee.tier';

// Tier 1 is the default for a new visitor, per the issue. A returning player
// gets whichever tier they last chose: a player who went looking for the
// shoulders once should not have to find them again on every visit.
export function readTier() {
  try {
    return localStorage.getItem(KEY) === '2' ? 2 : 1;
  } catch {
    // Private mode and blocked site data both throw here. Fall back to the
    // default rather than leaving the overlay with no tier at all.
    return 1;
  }
}

export function applyTier(tier) {
  document.body.classList.toggle('tier1', tier !== 2);
  try {
    localStorage.setItem(KEY, String(tier));
  } catch {
    // Not fatal: the tier still applies for this page's lifetime.
  }
}

// Builds the toggle into `host` and applies the stored tier. Returns the
// button, or null when `host` is missing, so a page without the markup
// degrades rather than throwing.
export function addTierToggle(host) {
  applyTier(readTier());
  if (!host) return null;
  const button = document.createElement('button');
  button.type = 'button';
  button.id = 'tier-toggle';
  const label = () => {
    const tier1 = document.body.classList.contains('tier1');
    // The label names what the press does, not the state it is in: "More
    // buttons" is the offer the issue asks to make.
    button.textContent = tier1 ? 'More buttons' : 'Fewer buttons';
    button.setAttribute('aria-pressed', String(!tier1));
  };
  button.addEventListener('click', () => {
    applyTier(document.body.classList.contains('tier1') ? 2 : 1);
    label();
  });
  label();
  host.append(button);
  return button;
}
