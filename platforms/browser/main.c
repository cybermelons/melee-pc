/* SPDX-License-Identifier: GPL-3.0-or-later */
#include "pc/discfont.h"
#include "pc/launcher.h"
#include "pc/net.h"
#include "pc/net_lan.h"
#include "pc/pc.h"
#include <SDL3/SDL.h>
#include <aurora/aurora.h>
#include <aurora/dvd.h>
#include <dolphin/card.h>
#include <melee/gm/forward.h>
#include <melee/gm/gmboot.h>
#include <emscripten.h>
#include <stdarg.h>
#include <stdio.h>
#include <stdlib.h>
#include <sys/stat.h>
extern int melee_main(void);
void pc_log_line(const char* fmt, ...) {
    va_list a;
    va_start(a, fmt);
    vfprintf(stderr, fmt, a);
    va_end(a);
    fputc('\n', stderr);
}
static void log_message(AuroraLogLevel level, const char* module, const char* message, unsigned n) {
    fprintf(stderr, "[%s] %.*s\n", module, n, message);
    if (level == LOG_FATAL)
        abort();
}
/* The hosting page owns settings and the disc picker. */
void pc_menu_init(SDL_Window* w) {
    (void)w;
}
void pc_menu_update(void) {}
void pc_menu_toggle(void) {}
void pc_menu_event(const SDL_Event* e) {
    (void)e;
}
bool pc_menu_is_open(void) {
    return false;
}
/* Creates the window and the device and builds the cached pipelines, without
 * the disc and without touching game state. The page calls it (async ccall)
 * once /cache is populated and before Start, so the pipeline cache warms while
 * the visitor is still on the launch row; main() calls it too and does
 * nothing the second time. Each call must finish before the next starts: it
 * yields to the browser while it builds. */
static bool graphics_ready;
EMSCRIPTEN_KEEPALIVE void browser_prewarm(void) {
    if (graphics_ready)
        return;
    graphics_ready = true;
    mkdir("/saves", 0777);
    mkdir("/cache", 0777);
    AuroraConfig c = {.appName = "Melee",
        .userPath = "/saves",
        .cachePath = "/cache",
        .msaa = 1,
        .maxTextureAnisotropy = 1,
        /* MELEE_VSYNC=0 is a measurement knob: with vsync on, the frame
         * boundary blocks on VBlank, so fps reads as the display refresh rate
         * and cannot show how much of the frame budget the port actually
         * uses. Turning it off (with MELEE_SIM_HZ raised) makes the port
         * CPU-bound so throughput becomes measurable. Parity with
         * src/pc/main.c, which reads the same variable. */
        .vsync = !(getenv("MELEE_VSYNC") && getenv("MELEE_VSYNC")[0] == '0'),
        /* A hidden tab stops anyway; this covers a tab that is still visible
         * but not focused, which is why it is opt-in (src/pc/pc.h). */
        .pauseOnFocusLost = pc_is_pause_on_blur_enabled(),
        /* MELEE_ALLOW_CPU_ADAPTER is a test-harness knob, not a player
         * setting (#18). aurora drops a CPU adapter at gpu.cpp:931 unless
         * config.allowCpuAdapter is set, so a host with no real GPU cannot
         * boot the game at all and no automated browser check can run. The
         * software adapter is far too slow to play on; this exists so a
         * headless check can reach the engine. Parity with .vsync above,
         * which reads its variable the same inline way: env_flag in
         * pc_stubs.c is static and not visible here. */
        .allowCpuAdapter = getenv("MELEE_ALLOW_CPU_ADAPTER") != NULL
            && getenv("MELEE_ALLOW_CPU_ADAPTER")[0] != '\0'
            && getenv("MELEE_ALLOW_CPU_ADAPTER")[0] != '0',
        .logLevel = LOG_INFO,
        .windowWidth = 960,
        .windowHeight = 720,
        .logCallback = log_message,
        .desiredBackend = BACKEND_WEBGPU,
        .mem1Size = PC_MEM1_SIZE,
        .mem2Size = PC_ARAM_SIZE};
    /* The page owns the canvas, so it owns the render size too. */
    c.windowWidth = EM_ASM_INT({ return Module.canvas.width; });
    c.windowHeight = EM_ASM_INT({ return Module.canvas.height; });
    static char* argv[] = {"melee", NULL};
    AuroraInfo info = aurora_initialize(1, argv, &c);
    (void)info;
    extern void browser_prepare_graphics(void);
    browser_prepare_graphics();
}
/* The page cannot set MELEE_NET: it only learns its slot when the WebRTC data
 * channel opens, which is after preRun copied ENV into the engine. So the
 * session is opened from here instead, once dc.onopen has a channel for
 * browser_net_attach (net_rtc.c) to find. Mirrors pc_net_init's direct-session
 * setup, which no longer runs in the browser because MELEE_NET stays empty.
 * The address is inert: the browser transport never dials it, but connect_impl
 * still wants one it can parse. Game thread only (net_lan.h), which the page's
 * ccall is, as the engine runs on the main thread. */
EMSCRIPTEN_KEEPALIVE int browser_net_start(int player, unsigned int seed)
{
    if (!pc_net_connect("127.0.0.1", 1, player, (uint32_t)seed)) {
        return 0;
    }
    pc_net_set_direct();
    return 1;
}
/* The page cannot pick the VS scene through MELEE_BOOT_SCENE for the same
 * reason it cannot set MELEE_NET: ENV closed at preRun, and a port claimed
 * after injection has nowhere to put it. A peer in that position boots through
 * GM_BOOT into the memory-card prompt and stalls. This asks the live engine to
 * go to GM_DEBUG_VS, the mode MELEE_BOOT_SCENE=vs maps to, instead: the
 * running scene ends at its next frame and the mode loop routes to it. Game
 * thread only, like browser_net_start. */
EMSCRIPTEN_KEEPALIVE int browser_boot_scene_vs(void)
{
    pc_set_boot_scene(GM_DEBUG_VS);
    return 1;
}
int main(int argc, char** argv) {
    (void)argc;
    (void)argv;
    browser_prewarm();
    if (!aurora_dvd_open("disc")) {
        fprintf(stderr, "Unsupported or unreadable disc\n");
        return 1;
    }
    if (!pc_load_disc_fonts("disc"))
        return 2;
    pc_platform_init();
    aurora_card_set_present(true);
    return melee_main();
}
