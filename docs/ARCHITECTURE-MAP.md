# melee-pc architecture map

Orientation doc. Read this before non-trivial work. It is an index and a symbol
map, not a design doc: it tells you what exists, where it lives, and which
existing doc is the authority on it.

This repo already has good per-topic docs. This file does not repeat them.

| Question | Authority |
|---|---|
| layers, threads, memory map, aurora | `docs/architecture.md` |
| the two-layer boundary rule, conventions | `CODING_STYLE.md` |
| how to build, per platform | `docs/building.md` |
| what breaks when porting a scene | `docs/porting-notes.md` |
| rollback, matchmaking, ranked, LAN design | `docs/netcode-plan.md` (2329 lines, §-numbered) |
| what is verified and how | `docs/testing.md`, `docs/netplay-verification.md` |
| diagnostic environment variables | `docs/debugging.md` |
| the browser target | `platforms/browser/README.md`, and the **melee-web** repo |

## What this repo is

The doldecomp Melee decompilation, adapted to run natively on PC and in a
browser. Game code stays as close to upstream as the data model allows; every
divergence is tagged `/* PORT: ... */`. `src/UPSTREAM_COMMIT` pins the decomp
commit.

```
src/melee, src/sysdolphin   the game (1894 + 149 files). Upstream code.
src/pc                      the platform layer (89 files, plus 15 vendored
                            libm sources). Ours.
extern/aurora               vendored GX -> WebGPU + Dolphin SDK surface.
platforms/<target>          per-target entry and packaging.
```

The one rule: **game code calls the Dolphin SDK, never the host.** New host
behaviour belongs in `src/pc` behind a `pc_*` function. See
`CODING_STYLE.md#1-architectural-overview--the-two-layers`.

## Function index — what already exists

This section exists so an agent does not re-implement what is here. A name
present below is already written. Grep this first.

### `src/pc/pc.h` — the platform surface the game calls

57 declarations in 177 lines. Grouped by concern:

| Concern | Functions |
|---|---|
| lifecycle, frame | `pc_platform_init` `pc_frame_boundary` `pc_sim_period_ns` `pc_os_wait_alarm` `pc_os_yield` `pc_log_line`, `pc_exit_requested` |
| keyboard, touch | `pc_keyboard_event` `pc_keyboard_apply` `pc_keyboard_tas_set` `pc_touch_apply` |
| GC adapter | `pc_gcadapter_init` `pc_gcadapter_poll` `pc_gcadapter_apply` `pc_gcadapter_status` `pc_gcadapter_raw` `pc_gcadapter_report_count` `pc_gcadapter_web_report` `pc_gcadapter_web_opened` |
| timing, input latency | `pc_monotonic_ns` `pc_input_latency_record` `pc_input_latency` |
| feature queries | `pc_is_input_hud_enabled` `pc_is_hitboxes_enabled` `pc_is_boot_css_enabled` `pc_is_20xx_enabled` `pc_is_20xx_rules_enabled` `pc_is_pause_enabled` `pc_is_pause_on_blur_enabled` `pc_is_custom_textures_enabled` `pc_is_unlock_all_enabled` `pc_is_frozen_stadium_enabled` `pc_is_free_camera_enabled` `pc_is_ucf_enabled` `pc_get_hud_mode` |
| audio volume | `pc_audio_set_volume` `pc_audio_set_music_volume` `pc_audio_set_sfx_volume` `pc_audio_get_music_volume` `pc_audio_get_sfx_volume` `pc_audio_set_reverb` `pc_get_music_volume` `pc_get_sfx_volume` |
| textures, gfx | `pc_textures_init` `pc_textures_reload` `pc_textures_shutdown` `pc_textures_get_path` `pc_gfx_prewarm` |
| vertex arrays, THP | `pc_vtx_array_scan` `pc_vtx_array_size` `pc_thp_decode_frame` |
| version, install | `pc_app_version` `pc_app_rev` `pc_install_id` `pc_unlock_state_get` `pc_unlock_state_set` `pc_unlock_state_all` |
| environment settings | `pc_env_int` (an integer `MELEE_*` setting, clamped to `[lo, hi]`; unset or non-numeric gives the default) |
| SDK gaps filled here | `GXInitFogAdjTable` `VIPadFrameBufferWidth` |

A feature query is the pattern for a new toggle. Add a `pc_is_*_enabled` for a
flag, or use `pc_env_int` for a clamped integer. Do not read `getenv` from game
code.

### `src/pc` by file

| File | Owns |
|---|---|
| `main.c` | entry, logging, crash handler, backend selection (`MELEE_BACKEND`) |
| `vi.c` | the frame boundary and frame pacing |
| `os.c` | interrupt masking as a recursive mutex, alarms, reset, MEM1 size |
| `gx.c`, `vtxarray.c` | GX glue, vertex-array sizing |
| `keyboard.c`, `input_poll.c`, `touch.c`, `gcadapter.c` | input. `input_poll.c` samples at 1000 Hz on its own SDL thread |
| `audio.c`, `music_stream.cpp` | software AX mixer (5 ms callback), custom soundtrack |
| `thp.c`, `thp_jpeg.cpp`, `thp_stream.cpp` | video |
| `disc.h`, `disc_open.c`, `discfont.c` | the disc data model and disc-resident fonts |
| `file_cache.cpp`, `textures.cpp` | archive cache plus loose-file overlay, Dolphin texture packs |
| `launcher.cpp`, `launcher_data.cpp` | RmlUi launcher, F1 overlay, `launcher.cfg` |
| `slp.c`, `slp_format.c` | Slippi replay recording |
| `melee_state.h`, `melee_state.ld`, `melee_state_macho.c`, `melee_state_pe.c` | the game's data and bss region bounds, per object format. This is what rollback snapshots |
| `region.c`, `widescreen.c`, `misc.c`, `version.cpp`, `updater.cpp` | PAL, widescreen, version, update |
| `android_compat.cpp`, `ios_dialog.m`, `windows_arm64_softfp.c`, `libm/` | per-platform shims |
| `stb_image.h`, `stb_vorbis.c` | vendored single-header decoders |
| `net*.{c,h}` | netplay. See below |

### Netplay — 30 files, 13539 lines, in `src/pc`

The largest subsystem and the one most likely to be re-invented. 18 `.c` files
and 12 headers. The table below lists each `.c` file plus `net_internal.h`.
`src/pc/net_internal.h` carries a module list in its header comment; it is the
authority. `src/pc/net.h` (35 declarations) is what the game calls.

| File | Lines | Owns |
|---|---|---|
| `net.c` | 3616 | session lifecycle, receive dispatch, input send and ack, stall and barrier, rollback, the per-tick entry points |
| `net_lan.c` | 1452 | LAN lobby: mDNS/DNS-SD discovery and host election (netcode-plan §8) |
| `net_snapshot.c` | 1042 | whole-region snapshots, the per-frame checksum, the state ring dumped on DESYNC, `MELEE_NET_SYNCTEST`, record and replay |
| `net_match.c` | 900 | matchmaking state machine: `PC_MATCH_DIRECT` / `UNRANKED` / `RANKED`, states `SEARCH` `CONNECT` `READY` `FAIL` |
| `net_handshake.c` | 757 | RULES host to guest, READY back. RULES carries the seed and `start_frame` |
| `net_dht.c` | 678 | the DHT client for serverless matchmaking (netcode-plan §7) |
| `net_rank_session.c` | 570 | the ranked session record. `PC_RANK_BEP44_SALT "meleepc-rank-v2"` |
| `net_dht_item.c` | 564 | bounded BEP44 client: iterative XOR-nearest, 4 in flight, 32-node shortlist, at most 64 gets |
| `net_internal.h` | 549 | the shared internals and the module list |
| `net_sync.c` | 504 | time sync, ported from Slippi `CalcTimeOffsetUs`. Positive offset means we run ahead |
| `net_sfx.c` | 426 | sound effects under rollback. `net_sfx.h` holds the design |
| `net_rank_store.c` | 320 | the on-device rating store |
| `net_wire.c` | 314 | byte order, headers, pad conversion, the per-datagram authentication tag |
| `net_identity.c` | 244 | the device keypair (`secret_key[64]`, `public_key[32]`) |
| `net_reliable.c` | 231 | two stop-and-wait lanes, so a slow caller lane never holds up RULES/READY. Lane 0 is types `< 0x10` |
| `net_rank.c` | 210 | rating maths. `PC_RANK_RECORD_BYTES 360` |
| `net_sim.c` | 158 | the link simulator that replaces `tc netem` (which needs root). Every outgoing datagram passes `tx()` |
| `net_watchdog.c` | 124 | catches the silent death where one side's game thread stops ticking while its socket thread keeps answering |
| `net_chat.c` | 86 | quick chat, 16 messages, reliable type `0x15`. Presentation thread only, outside rollback |

`PC_NET_PROTO_VERSION` is 9 (`src/pc/net.h:35`). Bump it when the wire changes.

Do not add a new transport, a new reliable channel or a new link simulator.
All three exist. `net_sim.c` is how you test loss and jitter without root.

### `extern/`

`aurora` (vendored, editable in-tree), `dht`, `monocypher`. Cryptography is
monocypher; do not add a second crypto dependency.

## The browser target, and the melee-web seam

`platforms/browser/` is the source of truth for the web build. The
**melee-web** repo holds a deployed copy of it under `dist/`, plus hosting,
measurement and netplay-signalling that do not belong here.

**Edit the browser shell HERE, not in melee-web's `dist/`.** A fix applied only
to `dist/` is lost on the next deploy. melee-web's own
`docs/ARCHITECTURE-MAP.md` carries the current divergence table and is the
authority on which files diverge deliberately.

**This repo has two live `main` branches.** `origin` is
`github.com:cybermelons/melee-pc`; `noel` is `gitea-noel:cybermelon/melee-pc`.
They forked at `60e0c0d2`. Check both before you call a file stale.

Measured at `noel/main` `3f8ef042` against melee-web `origin/main` `5df4f77`:
identical `crash.mjs` `drill.mjs` `gcadapter.mjs` `gpu-preflight.mjs`
`menu-button.mjs` `nat.mjs` `remote-disc.mjs` `settings.mjs` `tier.mjs`
`touch.mjs`; diverged `shell.mjs` (125 lines), `coi-sw.js` (145),
`disc-cache.mjs` (4). Those three splits are deliberate, per melee-web's map.

`menu-button.mjs` and `touch.mjs` differ on `origin/main` but match on
`noel/main`, because the fixes landed on noel first. That is a remote lag, not
drift.

The browser build does not use CMake directly: `tools/browser/build.py` drives
it, and `tools/browser/build_lower.py` plus `disc_lower.cpp` run a LibTooling
lowering pass over the disc structs. It needs LLVM 22 with LibTooling and a
real GCC 12+ as the oracle. Netplay does not use UDP, which browsers do not
have: `platforms/browser/net_rtc.c` carries the datagrams over a WebRTC data
channel instead, and `tests/browser/pair-e2e.mjs` pairs two real browsers and
exchanges 100 datagrams each way.

## How JS reaches the C (the two bridges)

There are exactly two routes from the browser shell into the engine. Reaching
for a third is almost always a sign of not knowing which of these applies.

**1. Query string to `getenv`.** The shell writes `Module.ENV`, Emscripten
fills the environment before `main`, and C reads it with `getenv`. Read **once
at startup**, so it cannot change a running game. 60 `getenv` readers exist
across `src/pc`. `settings.mjs` uses this route for all three of its controls
(`MELEE_UCF`, `MELEE_FROZEN_STADIUM`, `MELEE_NET_DELAY`).

**2. An exported function, called live.** Add the symbol to
`-sEXPORTED_FUNCTIONS` in `platforms/browser/CMakeLists.txt:52`, then call
`Module._name(args)` from JS. Works mid-game. The WebHID controller is the
worked example: `gcadapter.mjs:27` calls
`Module._pc_gcadapter_web_report(buffer, REPORT)`.

Current exports: `_main` `_browser_prewarm` `_malloc` `_free`
`_pc_touch_set_pad` `_pc_touch_set_active` `_pc_gcadapter_web_report`
`_pc_gcadapter_web_opened` `_pc_slp_web_finish` `_pc_slp_web_checkpoint`
`_pc_input_tas_set` `_pc_drill_state`.

**`prefs` does not exist in the web build.** `launcher.cpp` is not in
`BROWSER_PC_SOURCES` (`platforms/browser/CMakeLists.txt:25` excludes the
launcher by design), so the 28 `prefs` fields the native launcher offers have
no storage here at all. A web control cannot read or write one. It must call
route 2 on whatever module owns the behaviour instead.

Six of those settings do have a live setter already compiled into the web
build, so they need an export and nothing more:
`pc_widescreen_set_mode(int)` (`widescreen.c:45`), `pc_audio_set_volume(float)`
(`audio.c:101`), `pc_audio_set_music_volume` (`:107`), `pc_audio_set_sfx_volume`
(`:111`), `pc_audio_set_reverb(bool)` (`:271`), and mute via
`pc_audio_set_volume(0)`. The other six — hud_mode, custom_textures,
free_camera, filter_mode, anisotropy, net_name — have neither a setter nor a
`getenv`, and are out of reach without new C.

**No input setting exists anywhere in the engine.** Deadzone, stick curve,
tap-jump and C-stick mode appear in no `getenv` reader and no `prefs` field.
Controller *support* is complete (`gcadapter.mjs`, a full WUP-028 WebHID
transport); controller *settings* are absent. Do not draw a control for one.

## The lobby and the room

`lobby.mjs` owns the room: `PORTS = 4`, `PAIRABLE = 2`, `mintRoom` (8 chars of
a UUID), `ensureRoom`, and `sessionId`.

`sessionId` keys on `sessionStorage`, not `localStorage` or a fresh UUID: a tab
is a seat. It survives a reload and dies with the tab, so two tabs are two
players and a closed tab frees its port. A fresh UUID per load defeated
`signal.mjs`'s refresh guard and dropped the loader's port on every save-state
load (#24).

**A save-state load mints a new room (#35).** A preset load is a reload, since
the browser build has no snapshot path, so the old room has already written
this player off and reassigned the port. `states.mjs`'s `withRoom` therefore
replaces `?room=` rather than preserving it.

## Build and test entry points

| Want | Run |
|---|---|
| a native build | the CMake presets: `release` `debug` `relwithdebinfo`, and `linux-default` `linux-debug` `macos-default` `windows-mingw` `android-arm64` `android-x86_64` |
| the unit suite | `ninja -C build unit_tests && ctest --test-dir build -L melee --output-on-failure` |
| style and compile gates (CI runs both) | `python3 tools/check_style.py`, `python3 tools/compile_check.py` |
| the browser build | `tools/browser/build.py` |
| the pc unit tests | `tests/pc`, and `tests/browser` for the web build |
| a netplay check | the `tools/net_*.py` and `tools/test_net_*.c` family. `docs/testing.md` says which proves what |

`tools/` holds 130+ scripts. Before writing a new harness, grep it: the
`test_*.py` plus `test_*.c` pairs are existing fixtures, and
`net_determinism.py` `net_fuzz.py` `net_lan_fuzz.py` `net_acceptance.py`
`net_state_compare.py` already exist.

## Landmine index

Before you touch X, know Y. The porting bug classes in
`docs/porting-notes.md` are not repeated here; read that file before bringing
up a scene.

| Area | Rule |
|---|---|
| disc data | A struct that maps disc bytes is `DISC_STRUCT`, and a pointer in it is `DISC_PTR(T)`, read with `DP(T, slot)` and written with `DP_SET`. Two views over the same blob must **both** be `DISC_STRUCT`, or one reads every field byte-swapped. A small int coming back as `0x??000000` is the tell. |
| ARAM | Anything below `0x01000000` is an ARAM offset, not an address (`PC_IS_ARAM_ADDR`, `src/pc/disc.h:111`). |
| `GXEnd` | Retail `GXEnd` is empty and the decomp omits it, but aurora's submits the draw. Every `GXBegin` needs one. |
| `bool` in a decomp signature | Usually "int the decompiler could not name". Under `_Bool` every value above 1 clamps to 1, so a scene id or index silently becomes 1. |
| `char` signedness | Plain `char` is unsigned on every ARM target. The build passes `-fsigned-char` to all first-party targets. Do not drop it. |
| environment variables | 66 `MELEE_*` knobs are read in `src/pc` alone. `grep -rho 'getenv("\(MELEE\|AURORA\)_[A-Z0-9_]*")' src extern/aurora/lib` is the authoritative list; the table in `docs/debugging.md` lags it. Check before you add a knob. |
| netplay determinism | Both peers must run the same code over the same state. `net_snapshot.c` already has the checksum, the state ring and `MELEE_NET_SYNCTEST`. Use them; do not add a second checksum. |
| rollback and the state region | Snapshots copy the linker-defined `__melee_data_*` / `__melee_bss_*` region. New mutable game state outside that region is invisible to rollback, and a desync follows. |
| threads | aurora delivers draw-done and DVD callbacks on worker threads. The game brackets shared-state updates with `OSDisableInterrupts` / `OSRestoreInterrupts`, which `src/pc/os.c` maps onto a recursive mutex. |
| the browser build | It needs WebGPU. There is no WebGL fallback, and aurora refuses a CPU adapter, so the game cannot boot headless on a host without a real GPU. Automated browser checks need a GPU host. |
| this host | `tsunomaki` is the user's desktop. Do not put a window on its screen: no headed tests, no game windows. Run builds under `ionice -c3 nice`. Visual checks go to `botan` or run headless. |

## Drift log

What this map does not know, and where it disagrees with a sibling doc.

| Item | State |
|---|---|
| MEM1 size | `docs/architecture.md:70` says "MEM1 (24 MB)". `src/pc/pc.h:14` says `PC_MEM1_SIZE (96u * 1024 * 1024)`. The code is the authority, so the doc is stale. This map does not restate a number. |
| `src/melee` and `src/sysdolphin` | 2043 files, not indexed. Upstream decomp code; `src/UPSTREAM_COMMIT` pins the commit. Expand on demand. |
| `extern/aurora` | vendored, not indexed. `docs/architecture.md#aurora` is the authority. |
| two `main` branches | `origin` (GitHub) and `noel` (gitea) forked at `60e0c0d2`. At the time of writing noel carries 10 commits GitHub does not, all in `platforms/browser/` and `tests/browser/`. A file that looks stale on one remote may be current on the other. |
| function index scope | names only, from headers. It tells you a function exists. It does not give you the signature or the semantics. Read the source. |
| netcode-plan | 2329 lines and §-numbered. This map names which file does what; the plan is the authority on why, and parts of it describe intended work, not shipped work. |
