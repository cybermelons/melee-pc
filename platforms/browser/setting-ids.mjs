// SPDX-License-Identifier: GPL-3.0-or-later
// The single list of setting-row ids. tools/progress/mockup.py and settings.mjs
// both derive their row ids from it, and `build.py --parity` asserts it matches
// the mockup, so a row the demo draws and the launcher never builds cannot
// hide behind a grep.
export const SETTING_IDS = [
  'ctl-MELEE_20XX',
  'ctl-MELEE_BOOT_CSS',
  'ctl-MELEE_20XX_RULES',
  'ctl-unlock-all',
  'ctl-MELEE_UCF',
  'ctl-MELEE_FROZEN_STADIUM',
  'ctl-MELEE_PAUSE',
  'ctl-aspect',
  'ctl-hud-mode',
  'ctl-MELEE_SCALE',
  'ctl-filter',
  'ctl-custom-textures',
  'ctl-free-camera',
  'ctl-MELEE_HITBOXES',
  'ctl-volume',
  'ctl-music-volume',
  'ctl-sfx-volume',
  'ctl-reverb',
  'ctl-mute',
  'ctl-MELEE_PAUSE_ON_BLUR',
  'ctl-tap-jump',
  'ctl-deadzone',
  'ctl-curve',
  'ctl-cstick',
  'ctl-net-name',
  'ctl-MELEE_NET_DELAY',
  'ctl-net-relay',
];
