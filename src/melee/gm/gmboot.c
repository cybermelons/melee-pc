#include "gmboot.h"

#include "gm_unsplit.h"
#include "gmmain_lib.h"
#include "types.h"
#include <melee/lb/lbcardgame.h>
#include <melee/lb/lbcardnew.h>
#include <melee/lb/lblanguage.h>
#include <melee/ty/toy.h>
#ifdef TARGET_PC
#include "gmonlinemode.h"
#include <pc/pc.h>
#include <stdlib.h>
#include <string.h>
#endif

/* 1BF948 */ static void bootOnLoad(GameModeState*);
/* 1BF9A8 */ static void bootOnLeave(GameModeState*);
/* 1BFA3C */ static void memcardOnLoad(GameModeState*);

/// @todo Move to toy header
enum {
    TROPHY_PIKMIN = 275,
};

struct loadData {
    u32 x0;
    u8 x4;
    u8 mode_id; ///< Copied to ::leaveData::mode_id to set next mode
};

struct leaveData {
    u32 x0;
    u8 mode_id;
};

static struct loadData load_data;
static struct leaveData leave_data;

#ifdef TARGET_PC
/* File scope rather than function-local so pc_set_boot_scene can answer for
 * the browser. */
static int s_boot_done;
static u8 s_boot_scene = GM_COUNT;

/* A runtime request is separate state from the cache above, because the init
 * path in gm_1A3F.c reads pc_boot_scene() once and is done with it, whereas a
 * request has to survive until the running scene ends. GM_COUNT means none
 * pending. */
static u8 s_requested_scene = GM_COUNT;

/* MELEE_BOOT_SCENE=<title|vs|classic|training|event|unranked|direct|ranked>: skip the whole menu walk and
 * boot into one scene with a fixed setup. Menu navigation here can only be
 * driven by synthetic input, which misses keypresses often enough that an
 * automated run cannot rely on it (see tools/smoke_test.py).
 *
 * vs maps to GM_DEBUG_VS because that mode already *is* a fixed direct start
 * (onEnterDebugVs in gmvsmode.c fills the StartMeleeData itself). classic and
 * training still open on a character-select state, so their on_load hooks
 * seed the pick and jump past it. */
u8 pc_boot_scene(void)
{
    if (!s_boot_done) {
        const char* want = getenv("MELEE_BOOT_SCENE");
        s_boot_done = 1;
        if (want == NULL || want[0] == '\0') {
            /* MELEE_BOOT_CSS=1 (and so MELEE_20XX=1): the 20XX "boot to CSS"
             * behaviour, which bootOnLeave describes as a Gekko code that
             * changes scene_id to a hardcoded GM_VS. Answering here rather
             * than in bootOnLoad is what makes it work: GM_BOOT runs its
             * memory-card scene before bootOnLeave ever applies mode_id, and
             * on an empty card that scene stops on "Create Game Data?" and
             * waits for a button nobody is there to press. Every caller of
             * this function already skips GM_BOOT, so the prompt never
             * appears. GM_VS keeps its own first state, so the character
             * select is reached normally and fills the preload cache. */
            if (pc_is_boot_css_enabled()) {
                s_boot_scene = GM_VS;
            }
        } else if (strcmp(want, "title") == 0) {
            s_boot_scene = GM_TITLE;
        } else if (strcmp(want, "vs") == 0) {
            s_boot_scene = GM_DEBUG_VS;
        } else if (strcmp(want, "classic") == 0) {
            s_boot_scene = GM_CLASSIC;
        } else if (strcmp(want, "training") == 0) {
            s_boot_scene = GM_TRAINING;
        } else if (strcmp(want, "event") == 0) {
            /* The event scene needs no character select: onEnterVs in
             * gmevent.c builds the whole match from the level table, so the
             * only thing to choose is which level. pc_boot_event_level reads
             * that, and gmEvent_ApplyBootLevel applies it. */
            s_boot_scene = GM_EVENT;
        } else if (strcmp(want, "unranked") == 0) {
            s_boot_scene = GM_ONLINE;
            gmOnline_SetKind(ONLINE_KIND_UNRANKED);
        } else if (strcmp(want, "direct") == 0) {
            s_boot_scene = GM_ONLINE;
            gmOnline_SetKind(ONLINE_KIND_DIRECT);
        } else if (strcmp(want, "ranked") == 0) {
            s_boot_scene = GM_ONLINE;
            gmOnline_SetKind(ONLINE_KIND_RANKED);
        } else {
            OSReport("MELEE_BOOT_SCENE: unknown scene '%s'; valid values are "
                     "title, vs, classic, training, event, unranked, direct, "
                     "ranked\n",
                     want);
        }
    }
    return s_boot_scene;
}

/* The browser cannot set MELEE_BOOT_SCENE: ENV was copied into the engine at
 * preRun, and a netplay port is only claimed after that. Overwriting the
 * cache and marking it resolved is what lets pc_boot_scene() answer for a
 * caller that never had the env var, and stops a later first call from
 * re-reading ENV over the top of it. The scene running right now ends at its
 * next frame (gmscene.c) and the mode loop in gm_1A3F.c routes to this one
 * instead of the mode the scene chose. */
void pc_set_boot_scene(u8 mode)
{
    s_boot_done = 1;
    s_boot_scene = mode;
    s_requested_scene = mode;
}

u8 pc_boot_scene_request(void)
{
    return s_requested_scene;
}

void pc_boot_scene_consume(void)
{
    s_requested_scene = GM_COUNT;
}

/* MELEE_EVENT=<0..50>: which event match MELEE_BOOT_SCENE=event starts on.
 * Read once, like the scene above, because the engine caches boot settings
 * and nothing can change them after startup. An unparsable or out-of-range
 * value reports and falls back to level 0 rather than indexing the level
 * table out of bounds. */
u8 pc_event_boot_level(void)
{
    static int done;
    static u8 level;

    if (!done) {
        const char* want = getenv("MELEE_EVENT");
        done = 1;
        if (want != NULL && want[0] != '\0') {
            char* end;
            long v = strtol(want, &end, 10);
            if (*end != '\0' || v < 0 || v > PC_EVENT_LEVEL_MAX) {
                OSReport("MELEE_EVENT: '%s' is not a level from 0 to %d; "
                         "using 0\n",
                         want, PC_EVENT_LEVEL_MAX);
            } else {
                level = (u8) v;
            }
        }
    }
    return level;
}
#endif

GameModeState gm_Mode_Boot_States[] = {
    {
        0,
        1,
        0,
        bootOnLoad,
        bootOnLeave,
        GS_MEMCARD,
        &load_data,
        &leave_data,
    },
    {
        -1,
    },
};

void bootOnLoad(GameModeState* scene)
{
    struct loadData* scene_data = gm_GetGameModeStateEnterData(scene);
    scene_data->x4 = 0;
    scene_data->x0 = 0;
    if (gmMainLib_8046B0F0.skip_intro == true) {
        scene_data->mode_id = GM_TITLE;
    } else {
        gm_801BF708(0);
        scene_data->mode_id = GM_OPENING_MV;
    }
}

void bootOnLeave(GameModeState* data)
{
    struct leaveData* scene_data = gm_GetGameModeStateExitData(data);

    if (!Toy_803048C0(TROPHY_PIKMIN)) {
        if (!lb_8001C2D8(0, "01",
                         lbLang_GetLanguageSetting() == LANG_JP ? "GPIJ"
                                                                : "GPIE",
                         "Pikmin dataFile"))
        {
            Toy_803124BC();
            Toy_SetUnlockState(TROPHY_PIKMIN, true);
        }
    }

    gm_SetGameModeOverride(lbCardGame_DecideGameMode);

    // Enter mode
    // Gekko "boot to CSS" code changes scene_id to a hardcoded 2 (::GM_VS)
    gm_ChangeGameModeAfterCurrentScene(scene_data->mode_id);
}

GameModeState gm_Mode_MemCard_States[] = {
    {
        0,
        3,
        0,
        memcardOnLoad,
        NULL,
        {
            GS_MEMCARD,
            &load_data,
            &leave_data,
        },
    },
    { -1 },
};

void memcardOnLoad(GameModeState* scene)
{
    struct loadData* temp_r3 = gm_GetGameModeStateEnterData(scene);
    temp_r3->x4 = 0;
    temp_r3->x0 = 1;
}
