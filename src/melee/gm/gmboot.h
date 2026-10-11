#ifndef MELEE_GM_1BF9_H
#define MELEE_GM_1BF9_H

#ifdef TARGET_PC
#include <dolphin/types.h>

/// MELEE_BOOT_SCENE: the GameModeKind to boot straight into, or GM_COUNT when
/// the knob is unset. Cached, so this is cheap to call from an on_load hook.
u8 pc_boot_scene(void);

/// Pick the boot scene after startup, when ENV is already closed. The browser
/// needs this: a netplay port is claimed after preRun copied ENV into the
/// engine, so MELEE_BOOT_SCENE can never reach it. Overwrites what
/// pc_boot_scene() answers and records a pending request. It does not by
/// itself leave the current scene: gmscene.c ends the running scene when it
/// sees pc_boot_scene_request(), and gm_1A3F.c then routes to the request.
void pc_set_boot_scene(u8 mode);

/// The mode a runtime pc_set_boot_scene() asked for and nothing has acted on
/// yet, or GM_COUNT when none is pending.
u8 pc_boot_scene_request(void);

/// Mark the pending request acted on, so it fires once.
void pc_boot_scene_consume(void);

/// The highest event match index in sqEventInitDataLevelTbl. Retail has 51
/// event matches, numbered 0 to 50.
#define PC_EVENT_LEVEL_MAX 50

/// MELEE_EVENT: which event match to start on when pc_boot_scene() is
/// GM_EVENT. 0 when the knob is unset or holds an unusable value. Cached, so
/// this is cheap to call from an init path.
u8 pc_event_boot_level(void);
#endif

#endif
