#!/usr/bin/env python3
"""Build the browser target end to end into build/browser/runtime/platforms/browser.

Prerequisites: tools/browser/setup_sdk.py has run, LLVM with LibTooling is at
LLVM_ROOT, and a real GCC is on PATH for the lowering oracle.
"""
import argparse
import subprocess
import sys

from common import BUILD, EMSCRIPTEN, ROOT, node


def run(cmd):
    subprocess.run(list(map(str, cmd)), cwd=ROOT, check=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument('--jobs', type=int, default=6)
    args = parser.parse_args()
    tools = ROOT / 'tools/browser'

    run([sys.executable, ROOT / 'tests/browser/test_execution_charset.py'])
    # Before the link: these read source rather than build output, and a
    # failure here is cheaper than one found in a browser.
    run([sys.executable, ROOT / 'tests/browser/test_exports.py'])
    run([sys.executable, ROOT / 'tests/browser/test_mobile_css.py'])
    run([sys.executable, ROOT / 'tests/browser/test_pause_on_blur.py'])
    run([sys.executable, ROOT / 'tests/browser/test_no_fpcast_emu.py'])
    run([sys.executable, ROOT / 'tests/browser/test_callback_signatures.py'])
    run([sys.executable, ROOT / 'tests/browser/test_tier_layout.py'])
    run([sys.executable, ROOT / 'tests/browser/test_event_boot.py'])
    run([sys.executable, ROOT / 'tests/browser/test_asset_copy.py'])
    run([sys.executable, ROOT / 'tests/browser/test_ice_servers.py'])
    run([sys.executable, tools / 'build_lower.py'])
    run([sys.executable, tools / 'test_disc_lower.py'])
    run([sys.executable, tools / 'compile_game.py', '--jobs', args.jobs])
    run([EMSCRIPTEN / 'emcmake', 'cmake', '-S', ROOT, '-B', BUILD / 'runtime', '-G', 'Ninja',
         '-DCMAKE_BUILD_TYPE=Release'])
    run(['cmake', '--build', BUILD / 'runtime', '--target', 'melee_browser', '-j', args.jobs])
    tests = sorted([*(ROOT / 'tests/browser').glob('*.test.mjs'), *(ROOT / 'platforms/browser/tests').glob('*.test.mjs')])
    run([node(), '--test', *tests])
    print(BUILD / 'runtime/platforms/browser')


if __name__ == '__main__':
    main()
