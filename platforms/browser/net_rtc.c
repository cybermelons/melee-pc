/* SPDX-License-Identifier: GPL-3.0-or-later */
/* The browser's net.c datagram seam: the paired WebRTC data channel the page
 * keeps at Module.netChannel (unordered, maxRetransmits 0). Both calls are
 * synchronous, so they stay out of ASYNCIFY_IMPORTS. */
#include <emscripten.h>

/* HEAPU8 is a SharedArrayBuffer view (-pthread) and send() rejects those, so
 * the payload is copied out first. */
EM_JS(int, browser_net_attach, (void* rxbuf), {
    const dc = Module.netChannel;
    if (!dc || dc.readyState !== 'open')
        return 0;
    dc.binaryType = 'arraybuffer';
    dc.onmessage = (e) => {
        const b = new Uint8Array(e.data);
        if (b.length === 0 || b.length > 512)
            return;
        HEAPU8.set(b, rxbuf);
        _browser_net_rx(b.length);
    };
    return 1;
});

EM_JS(int, browser_net_send, (const void* p, int n), {
    const dc = Module.netChannel;
    if (!dc || dc.readyState !== 'open')
        return -1;
    dc.send(HEAPU8.slice(p, p + n));
    return n;
});
