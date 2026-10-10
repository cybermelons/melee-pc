# melee-pc

Read `docs/ARCHITECTURE-MAP.md`, `docs/architecture.md` and `docs/testing.md`
before non-trivial work.

## Never put a browser or game window on this host's screen

`tsunomaki` is the user's gaming desktop. A test window steals focus and
interrupts whatever they are doing. COSMIC cannot prevent this: `cosmic-comp`
activates every new toplevel unconditionally, and `CosmicComp/v1/` carries no
focus key. There is no setting to turn off. The fix belongs in the test.

Every headful browser check goes through `tools/display.sh`:

```sh
. tools/display.sh
run_headless node tools/boot-test.mjs
```

`run_headless` is a shell function, so a wrapper cannot find it by name: write
`run_headless timeout 500 node x.mjs`, not `timeout 500 run_headless ...`.

Never use `DISPLAY=:N` or `--ozone-platform=x11`; both are measured and
rejected in `tools/display.sh`. Never write a literal `false` for a Playwright
or Puppeteer `headless` option.

The live gameplay tests in `docs/testing.md` need the user's own disc and
display. The user runs those. Never start a game window on their screen.

`tools/display.sh` is also copied into melee-web and tsro. Keep them in sync.
Its `PULSE_SINK` is pinned to an HDMI sink that does not exist on every host;
the copies resolve the sink at source time.

## The gate

```sh
ninja -C build unit_tests && ctest --test-dir build -L melee --output-on-failure
python3 tools/check_style.py && python3 tools/compile_check.py
```

## Code navigation (LSP)

The `LSP` tool works in this checkout for C (clangd) and for the browser
`.mjs` files (typescript-language-server). Set up and measured on tsunomaki,
2026-10-10.

- C: clangd 18 reads `build/compile_commands.json`. CMake writes it
  (`CMAKE_EXPORT_COMPILE_COMMANDS ON`). The index is in `.cache/clangd/`.
- JS: the root `jsconfig.json` puts `platforms/browser`, `tests/browser` and
  `tools/browser` in one project. It is local only (`.git/info/exclude`), as is
  `.cache/`.

Rules:

1. **Wait for a cold C index.** The first index takes about 6 minutes. Until
   it is complete, `findReferences` gives only the declaration. Measured:
   `pc_env_int` gave 1 ref, then 5 refs in 3 files after the index finished.
2. **Run the first query of a session 2 times.** The first `.mjs` query for
   `isOn` found 1 file; the second found 2, with the test file.
3. **For an impact set, use LSP and grep together** (`grep -rlw SYMBOL`).
   grep also finds comments; LSP does not.
4. **A worktree has no `build/` and no `jsconfig.json`.** Configure CMake
   there, copy `jsconfig.json`, or use grep.
5. **Restart the session** after a change to `jsconfig.json` or to the LSP
   plugins.
