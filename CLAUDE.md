# melee-pc

Read `docs/architecture.md` and `docs/testing.md` before non-trivial work.

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
