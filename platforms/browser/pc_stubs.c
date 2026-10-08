/* SPDX-License-Identifier: GPL-3.0-or-later */
/*
 * Native-only pieces of src/pc that the browser platform replaces.
 *
 * The desktop launcher (launcher.cpp) and the archive file cache
 * (file_cache.cpp) have no browser counterpart: settings come from the hosting
 * page through the environment, and disc reads are cached by disc-cache.mjs.
 * The GameCube adapter keeps its decode and gets a WebHID transport
 * (gcadapter_web.c). Everything else in src/pc is compiled unchanged.
 */
#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>
#include <stdlib.h>

#include <emscripten.h>

#include "pc/file_cache.h"
#include "pc/pc.h"
#include "pc/slp.h"
#include "pc/slp_format.h"

/* Desktop launcher preferences; defaults match launcher_data.hpp. MELEE_UCF is
 * the one the launcher also reads from the environment (launcher.cpp). */
bool pc_is_unlock_all_enabled(void) {
    return false;
}
bool pc_is_frozen_stadium_enabled(void) {
    return false;
}
bool pc_is_free_camera_enabled(void) {
    return false;
}
bool pc_is_ucf_enabled(void) {
    const char* env = getenv("MELEE_UCF");
    return env != NULL && env[0] != '0';
}
int pc_get_hud_mode(void) {
    return 0;
}
bool pc_is_custom_textures_enabled(void) {
    return false;
}
/* Netplay lobby identity and Direct Connect settings (net_lan.c, net_match.c); the lobby itself is
 * unreachable here. */
const char* pc_get_net_name(void) {
    return "";
}
const char* pc_get_net_target(void) {
    return "";
}
void pc_set_net_target(const char* code) {
    (void)code;
}
int pc_get_net_port(void) {
    return 0;
}
uint64_t pc_install_id(void) {
    return 0;
}
const char* pc_app_rev(void) {
    return "browser";
}

/* Archive cache and background prewarm: the page owns disc caching. */
bool pc_file_cache_get(const char* filename, void* dst, size_t* size) {
    (void)filename;
    (void)dst;
    (void)size;
    return false;
}
bool pc_file_cache_get_size(const char* filename, size_t* size) {
    (void)filename;
    (void)size;
    return false;
}
void pc_file_cache_put(const char* filename, const void* data, size_t size) {
    (void)filename;
    (void)data;
    (void)size;
}
void pc_file_cache_start_prewarm(void) {}
bool pc_file_cache_require(const char* filename) {
    (void)filename;
    return false;
}

/* A closed tab runs no atexit hook, so a training session would leave its
 * .slp without the patched raw length or metadata. shell.mjs calls this on
 * pagehide; pc_slp_match_end is idempotent (slp.c clears s_rec). */
EMSCRIPTEN_KEEPALIVE void pc_slp_web_finish(void) {
    pc_slp_match_end();
    slp_writer_shutdown();
}

/* Periodic safety net: pagehide does not fire on a crash or an OOM kill. */
EMSCRIPTEN_KEEPALIVE void pc_slp_web_checkpoint(void) {
    slp_writer_checkpoint();
}

/* TAS input for the test driver: wall-clock key presses cannot hit the frame
 * windows a SHFFL needs (fast fall at the apex, L within 7 frames of landing).
 * A driver sets a scancode byte array per rendered frame via Module.onFrame;
 * pc_keyboard_apply folds it into the one-frame latch. */
EMSCRIPTEN_KEEPALIVE void pc_input_tas_set(const uint8_t* keys, int count) {
    pc_keyboard_tas_set(keys, count);
}
