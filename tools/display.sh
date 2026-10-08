# SPDX-License-Identifier: GPL-3.0-or-later
# Run a headful browser test without putting a window on anybody's screen.
#
#   . tools/display.sh
#   run_headless node tools/boot-test.mjs
#
# Tests run under cage, a kiosk Wayland compositor, on its headless backend.
# It renders on the real GPU and displays nothing, which this port needs: there
# is no WebGL fallback, so a software compositor cannot host a test.
#
# Two approaches were measured and rejected first:
#  - Placing a window on the desktop display. This session is Wayland
#    (XDG_SESSION_TYPE=wayland, COSMIC), and Playwright's Chromium runs as a
#    native Wayland client, so --window-position, CDP Browser.setWindowBounds
#    and xdotool windowmove are all ignored. A test window landed on the
#    primary monitor every time.
#  - A nested X server (Xephyr on :2). Placement worked there, but WebGPU got
#    an adapter and then lost the device at once, and the engine rendered no
#    frames over 40 s.
# Under cage the same page holds 60.0 fps with no page errors.
export PULSE_SINK=alsa_output.pci-0000_0b_00.1.hdmi-stereo-extra2

# Run a command inside a headless compositor. Audio is muted at the browser
# (--mute-audio) and routed to an idle sink here, because the engine opens its
# own audio path.
#
# This is a shell function, so a wrapper cannot find it by name: write
# `run_headless timeout 500 node x.mjs`, not `timeout 500 run_headless ...`.
#
# Two browser instances run at once here and both hold 60 fps, which is what a
# two-player test needs. Cage's headless backend does log
# "No free output buffer slot" with two clients, and the second instance's p99
# drifts up over 30 s. If a long two-player run degrades, suspect the
# compositor's buffer count before the netcode.
run_headless() {
  XDG_RUNTIME_DIR="${XDG_RUNTIME_DIR:-/run/user/$(id -u)}" \
  WLR_BACKEND=headless WLR_LIBINPUT_NO_DEVICES=1 \
    cage -- env "PULSE_SINK=$PULSE_SINK" "$@"
}
