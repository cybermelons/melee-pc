#ifndef MELEE_GM_1BF9_H
#define MELEE_GM_1BF9_H

#ifdef TARGET_PC
#include <dolphin/types.h>

/// MELEE_BOOT_SCENE: the GameModeKind to boot straight into, or GM_COUNT when
/// the knob is unset. Cached, so this is cheap to call from an on_load hook.
u8 pc_boot_scene(void);

/// The highest event match index in sqEventInitDataLevelTbl. Retail has 51
/// event matches, numbered 0 to 50.
#define PC_EVENT_LEVEL_MAX 50

/// MELEE_EVENT: which event match to start on when pc_boot_scene() is
/// GM_EVENT. 0 when the knob is unset or holds an unusable value. Cached, so
/// this is cheap to call from an init path.
u8 pc_event_boot_level(void);
#endif

#endif
