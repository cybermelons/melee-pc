#!/usr/bin/env python3
# SPDX-License-Identifier: GPL-3.0-or-later
"""Tests for build.parity. Run: python3 tools/progress/test_parity.py"""
import io
import os
import sys
from contextlib import redirect_stdout

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import build  # noqa: E402

MOCK = '<div id="have"></div><div id="gone"></div><div id="dyn"></div>'
REAL = '<div id="have"></div>'
JS = 'document.getElementById("dyn")'


def run(state, anchor, mock=MOCK, real=REAL, js=JS):
    data = {'issues': [{'n': 1, 'state': state, 'anchor': anchor}]}
    with redirect_stdout(io.StringIO()):
        return build.parity(data, mock, real, js)


tests = 0


def check(got, want, name):
    global tests
    assert got == want, f'{name}: exit {got}, wanted {want}'
    tests += 1


check(run('closed', '#gone'), 1, 'closed pin, absent anchor')
check(run('open', '#gone'), 0, 'open pin, absent anchor')
check(run('closed', '#have'), 0, 'closed pin, markup anchor')
check(run('closed', '#dyn'), 1, 'closed pin, js-only anchor')
check(run('open', '#dyn'), 0, 'open pin, js-only anchor')
check(run('open', '#have', mock=''), 1, 'empty mockup set')
check(run('open', '#have', real=''), 1, 'empty real set')

assert tests == 7, f'ran {tests} tests, expected 7'
print(f'{tests} passed')
