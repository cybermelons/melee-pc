// SPDX-License-Identifier: GPL-3.0-or-later
// WebHID transport for the WUP-028 GameCube adapter.
//
// The engine decodes the adapter's 37-byte 0x21 reports itself, in the same C
// code the desktop build uses, so this file only moves bytes: it opens the
// device and hands each report to pc_gcadapter_web_report. Nothing here
// rescales an axis, because Melee's dash, tilt and light-shield thresholds are
// in raw 8-bit units.
const VID = 0x057e;
const PID = 0x0337;
const REPORT = 37;

// Chrome reports the 0x21 input report without its leading id byte, so the
// report id is prepended to match the layout the C decode expects.
const REPORT_ID = 0x21;

export function createGCAdapter(Module, log = () => {}) {
  let device = null;
  let buffer = 0;

  const report = (event) => {
    const data = event.data; // DataView, id byte already stripped
    if (event.reportId !== REPORT_ID || data.byteLength + 1 < REPORT) return;
    const heap = Module.HEAPU8;
    heap[buffer] = REPORT_ID;
    for (let i = 0; i < REPORT - 1; i++) heap[buffer + 1 + i] = data.getUint8(i);
    Module._pc_gcadapter_web_report(buffer, REPORT);
  };

  const attach = async (handle) => {
    if (!handle.opened) await handle.open();
    device = handle;
    if (!buffer) buffer = Module._malloc(REPORT);
    device.addEventListener('inputreport', report);
    // Start streaming: the same 0x13 the adapter's own drivers send.
    await device.sendReport(0x13, new Uint8Array(0));
    Module._pc_gcadapter_web_opened(1);
    log('GC adapter: connected');
  };

  navigator.hid?.addEventListener('disconnect', (event) => {
    if (event.device !== device) return;
    device.removeEventListener('inputreport', report);
    device = null;
    Module._pc_gcadapter_web_opened(0);
  });

  return {
    get connected() { return device !== null; },

    // Reopen a previously granted adapter. No user gesture needed, so this can
    // run at startup; it finds nothing until a request() has been accepted once.
    async resume() {
      if (device || !navigator.hid) return false;
      const granted = await navigator.hid.getDevices();
      const found = granted.find((d) => d.vendorId === VID && d.productId === PID);
      if (!found) return false;
      await attach(found);
      return true;
    },

    // Must be called from a user gesture: WebHID requires one for the picker.
    async request() {
      if (!navigator.hid) throw Error('This browser has no WebHID. Try a current Chrome or Edge.');
      const picked = await navigator.hid.requestDevice({
        filters: [{ vendorId: VID, productId: PID }],
      });
      if (!picked.length) return false; // the person dismissed the picker
      await attach(picked[0]);
      return true;
    },
  };
}
