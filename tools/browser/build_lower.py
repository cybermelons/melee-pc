#!/usr/bin/env python3
"""Build tools/browser/disc_lower.cpp against the LLVM development libraries."""
import subprocess

from common import DISC_LOWER, LLVM, ROOT

if not (LLVM / 'bin/clang++').exists():
    raise SystemExit(
        f'no LLVM with LibTooling at {LLVM}\n'
        'disc_lower links against libclang-cpp, so this needs the LLVM 22 '
        'development package, not a plain clang.\n'
        'Set LLVM_ROOT, or install to one of the locations common.py searches.')

DISC_LOWER.parent.mkdir(parents=True, exist_ok=True)
subprocess.run([
    str(LLVM / 'bin/clang++'), '-std=c++20', '-O1',
    str(ROOT / 'tools/browser/disc_lower.cpp'),
    f'-I{LLVM / "include"}', f'-L{LLVM / "lib"}', f'-Wl,-rpath,{LLVM / "lib"}',
    '-lclang-cpp', '-lLLVM',
    '-o', str(DISC_LOWER),
], check=True)
print(DISC_LOWER)
