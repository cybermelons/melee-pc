#!/usr/bin/env python3
"""Check the browser page assets copy at build time, not configure time.

configure_file runs when CMake regenerates the build system. A page script
added after the last configure was therefore missing from the build directory
until someone re-ran cmake by hand. The browser end-to-end tests serve that
directory, so a missing module is a 404 that stops the page before the engine
starts. The failure then looks like an engine fault, which is expensive to
chase: it already cost one wrong diagnosis.

A POST_BUILD copy_if_different runs on every link, so the served directory
cannot fall behind the sources.
"""
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]


def fail(message):
    print(f"FAIL: {message}")
    sys.exit(1)


def main():
    cmake = (ROOT / 'platforms/browser/CMakeLists.txt').read_text()

    # configure_file for the page assets is the regression: it is the call that
    # only runs at configure time. The glob itself is fine either way.
    if re.search(r'configure_file\([^)]*BROWSER_ASSETS', cmake) or \
            re.search(r'foreach\(asset IN LISTS BROWSER_ASSETS\)', cmake):
        fail('the page assets are copied with configure_file again, so a file '
             'added after the last cmake run will be missing from the build '
             'directory and the served page will 404')

    copy = re.search(
        r'add_custom_command\(TARGET melee_browser POST_BUILD\s*'
        r'COMMAND \$\{CMAKE_COMMAND\} -E copy_if_different '
        r'\$\{BROWSER_ASSETS\}', cmake)
    if copy is None:
        fail('platforms/browser/CMakeLists.txt must refresh ${BROWSER_ASSETS} '
             'in a POST_BUILD copy_if_different step')

    # The glob has to keep covering every page file type the host page loads.
    for ext in ('*.mjs', '*.js', '*.html'):
        if ext not in cmake:
            fail(f'the BROWSER_ASSETS glob no longer covers {ext}')

    print('ok: browser page assets refresh on every link')


if __name__ == '__main__':
    main()
