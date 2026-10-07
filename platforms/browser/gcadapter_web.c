/* SPDX-License-Identifier: GPL-3.0-or-later */
/*
 * WebHID transport for the WUP-028 GameCube adapter.
 *
 * src/pc/gcadapter.c reads the adapter directly rather than through SDL's
 * hidapi gamepad driver, because that driver rescales every axis and Melee's
 * dash, tilt and light-shield thresholds are all in raw 8-bit units (the long
 * comment at the top of that file has the detail). The browser needs the same
 * raw values, so the decode is reused verbatim and only the transport differs:
 * SDL's hidapi has no browser backend, so the 37-byte 0x21 reports arrive from
 * navigator.hid instead.
 *
 * The decode is included, not relinked, because parse_slot and the snapshot
 * publication it drives are static to that translation unit. GC_WEB_TRANSPORT
 * makes it omit its own libusb open/poll path. tools/test_gcadapter.c includes
 * the same file the same way.
 *
 * WebHID needs a user gesture, so the page calls Module.requestGCAdapter()
 * from a click. Until then no adapter exists and the keyboard path owns port 1.
 */
#define GC_WEB_TRANSPORT 1
#include "../../src/pc/gcadapter.c"

#include <emscripten.h>

/* Reports land here from JS. The 1000 Hz input thread drains it, so the seq
 * counter is the handoff: JS bumps it after the bytes are in place, and the
 * reader only decodes a report it has not seen. One slot is enough because a
 * stale report is worth nothing once a newer one exists. */
static _Atomic uint32_t s_web_seq;
static _Atomic uint32_t s_web_open;
static uint8_t s_web_report[GC_REPORT];

/* Called from JS on every input report. Not reentrant with itself: WebHID
 * delivers on the thread that opened the device. */
EMSCRIPTEN_KEEPALIVE
void pc_gcadapter_web_report(const uint8_t* data, int len)
{
    if (len < GC_REPORT || data[0] != 0x21) {
        return;
    }
    memcpy(s_web_report, data, GC_REPORT);
    atomic_fetch_add_explicit(&s_web_seq, 1, memory_order_release);
    atomic_fetch_add_explicit(&s_reports, 1, memory_order_relaxed);
}

EMSCRIPTEN_KEEPALIVE
void pc_gcadapter_web_opened(int opened)
{
    atomic_store_explicit(&s_web_open, opened ? 1 : 0, memory_order_relaxed);
    if (!opened) {
        for (int i = 0; i < GC_SLOTS; i++) {
            clear_slot(i);
        }
        publish_snapshot();
        pc_log_line("GC adapter: disconnected");
    } else {
        pc_log_line("GC adapter: WUP-028 opened over WebHID, raw values active");
    }
}

void pc_gcadapter_init(void)
{
    /* Nothing to open here: WebHID needs a user gesture, so the page drives
     * the open. MELEE_GC_ADAPTER=0 keeps the knob the native path documents,
     * which the host page passes through as a query parameter. */
    const char* env = getenv("MELEE_GC_ADAPTER");
    s_enabled = !(env != NULL && env[0] == '0');
}

/* Kept for tools/adapter-test.mjs, which reads the decoded snapshot back.
 * Both are defined in the decode this file includes; these only re-export
 * them, because EMSCRIPTEN_KEEPALIVE cannot be applied to a definition in an
 * included translation unit without editing the shared file. */
EMSCRIPTEN_KEEPALIVE
bool pc_gcadapter_web_raw(int port, uint8_t raw[6], bool* wireless)
{
    return pc_gcadapter_raw(port, raw, wireless);
}

/* The 1000 Hz input thread owns pc_gcadapter_poll, and that thread only
 * exists once the game is running. tools/adapter-test.mjs decodes without
 * booting the game, so it drives one poll itself. */
EMSCRIPTEN_KEEPALIVE
void pc_gcadapter_web_poll_once(void)
{
    pc_gcadapter_poll();
}

EMSCRIPTEN_KEEPALIVE
uint64_t pc_gcadapter_web_reports(void)
{
    return pc_gcadapter_report_count();
}

void pc_gcadapter_poll(void)
{
    static uint32_t seen;
    if (!atomic_load_explicit(&s_web_open, memory_order_relaxed)) {
        return;
    }
    const uint32_t seq = atomic_load_explicit(&s_web_seq, memory_order_acquire);
    if (seq == seen) {
        return;
    }
    seen = seq;

    uint8_t report[GC_REPORT];
    memcpy(report, s_web_report, GC_REPORT);
    const uint64_t now = (uint64_t) (emscripten_get_now() * 1000000.0);
    for (int i = 0; i < GC_SLOTS; i++) {
        parse_slot(i, report + 1 + 9 * i, now);
    }
    publish_snapshot();
    /* Rumble needs an output report; the adapter is read-only here for now. */
}
