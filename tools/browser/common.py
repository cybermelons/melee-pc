"""Paths and toolchain locations shared by the browser build scripts."""
import os
import shutil
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
BUILD = ROOT / 'build/browser'

# Emscripten has no GCC, and Clang has no scalar_storage_order, so game C goes
# through disc_lower (LLVM LibTooling) before emcc. See platforms/browser/README.md.
EMSCRIPTEN_VERSION = '6.0.9'


def _llvm():
    """LLVM 22 with LibTooling: LLVM_ROOT, else the usual install locations.

    disc_lower links against libclang-cpp, so this needs the development
    package rather than a plain clang. Distribution packages and Homebrew put
    it in different places and neither is on PATH, so the candidates are
    searched rather than assumed. A clear failure here beats the FileNotFound
    traceback from build_lower.py.
    """
    override = os.environ.get('LLVM_ROOT')
    if override:
        return Path(override)
    candidates = [
        Path.home() / '.local/llvm-22',          # unpacked without root
        Path('/opt/homebrew/opt/llvm@22'),       # macOS, Apple silicon
        Path('/usr/local/opt/llvm@22'),          # macOS, Intel
        Path('/usr/lib/llvm-22'),                # Debian, Ubuntu, Pop!_OS
    ]
    for path in candidates:
        if (path / 'bin/clang++').exists():
            return path
    return candidates[0]


LLVM = _llvm()
SDK = Path(os.environ.get('MELEE_EMSDK', BUILD / 'emsdk'))
EMSCRIPTEN = SDK / 'upstream/emscripten'
SYSROOT = EMSCRIPTEN / 'cache/sysroot'
DISC_LOWER = Path(os.environ.get('DISC_LOWER', BUILD / 'disc_lower'))
WASM_TARGET = '--target=wasm32-unknown-emscripten'


def node():
    """The SDK's bundled node, else whatever is on PATH."""
    bundled = sorted((SDK / 'node').glob('*/bin/node'))
    return str(bundled[-1]) if bundled else shutil.which('node')
