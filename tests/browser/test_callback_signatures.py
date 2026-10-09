#!/usr/bin/env python3
"""Fail when a cast to a function-pointer typedef hides an arity disagreement.

A cast to a function-pointer typedef stops the compiler checking the callee.
On PowerPC a surplus argument sits unused in a register and nothing happens,
so the decomp carries casts that were always harmless there. Under wasm the
indirect call compares the whole signature and traps when it disagrees, which
produced the "function signature mismatch" boot failure at frame 2.

tests/browser/test_no_fpcast_emu.py cannot catch this class. wasm-ld's own
signature check is static and cross-object, so a call through a pointer whose
arity differs only at the cast site is invisible to it.

This compares declared parameter counts: the target type's against the
callee's. It does not resolve parameter types, because wasm does not
distinguish one pointer type from another; every pointer is an i32. It does
compare "returns a value" against "returns void", because that difference is
part of a wasm signature. camera.c carried three of those.

Two cast spellings are checked. A cast to a named function-pointer typedef,
as in (HSD_GObjEvent) fn, and an inline cast, as in (void (*)(Foo*)) fn.
A cast of a pointer variable rather than of a named function cannot be
checked at all, because the source does not say what it points to.
"""
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]

# Casts this check cannot judge, each with the reason it is exempt.
EXEMPT = {
    # PanicCallback is variadic (OSContext*, ...), so a callee taking fewer
    # named parameters is correct. The only site is also inside
    # #ifndef TARGET_PC and never reaches the browser build.
    'PanicCallback',
    # Event is void (*)(void) and is used across the tree as an intermediate
    # launderer inside a double cast, as in (real_type)(Event) callee. The
    # outer cast is the real target type, so comparing against Event is
    # meaningless.
    'Event',
}


def fail(message):
    print(f'FAIL: {message}')
    sys.exit(1)


def count_params(text):
    """Count top-level comma-separated parameters in a parameter list."""
    text = text.strip()
    if text in ('', 'void'):
        return 0
    depth = 0
    count = 1
    for ch in text:
        if ch in '([':
            depth += 1
        elif ch in ')]':
            depth -= 1
        elif ch == ',' and depth == 0:
            count += 1
    return count


def main():
    sources = sorted([*ROOT.glob('src/**/*.c'), *ROOT.glob('platforms/**/*.c')])

    typedefs = {}
    for header in sorted(ROOT.glob('src/**/*.h')):
        for m in re.finditer(
                r'typedef\s+[\w\s\*]+?\(\s*\*\s*(\w+)\s*\)\s*\(([^;]*)\)\s*;',
                header.read_text()):
            params = m.group(2)
            # A variadic typedef accepts any number of named parameters.
            if '...' in params:
                continue
            typedefs[m.group(1)] = count_params(params)

    if len(typedefs) < 50:
        fail(f'only {len(typedefs)} function-pointer typedefs found; '
             'the typedef pattern has stopped matching')

    # A definition ends in '{', which is what separates it from a prototype.
    defs = {}
    for src in sources:
        for m in re.finditer(
                r'^([\w][\w\s\*]*?)(\w+)\s*\(([^;{)]*(?:\([^)]*\)[^;{)]*)*)\)\s*\{',
                src.read_text(), re.MULTILINE):
            returns_value = m.group(1).split() != ['void']
            defs.setdefault(m.group(2),
                            (count_params(m.group(3)), returns_value, src))

    if len(defs) < 10000:
        fail(f'only {len(defs)} function definitions indexed; '
             'the definition pattern has stopped matching')

    # An inline function-pointer cast: (void (*)(Foo*, int)) callee.
    # Group 1 is the return type, group 2 the parameter list.
    inline_cast = re.compile(
        r'\(\s*([\w]+)\s*\(\s*\*\s*\)\s*\(([^()]*(?:\([^()]*\)[^()]*)*)\)\s*\)'
        r'\s*(?:\(\s*Event\s*\)\s*)?([A-Za-z_]\w*)')

    bad = []
    for src in sources:
        lines = src.read_text().splitlines()
        for n, line in enumerate(lines, 1):
            # Casts to a named typedef.
            for m in re.finditer(r'\((\w+)\)\s*(?:\((\w+)\)\s*)?([A-Za-z_]\w*)',
                                 line):
                outer, _inner, callee = m.groups()
                if outer in EXEMPT or outer not in typedefs:
                    continue
                # The callee may sit on the line after a long cast.
                target = callee
                if target in typedefs or target in ('void', 'NULL'):
                    nxt = lines[n] if n < len(lines) else ''
                    mm = re.match(r'\s*([A-Za-z_]\w*)', nxt)
                    if not mm:
                        continue
                    target = mm.group(1)
                if target not in defs:
                    # A cast of a pointer variable, not of a named function.
                    # Its arity cannot be known from the source.
                    continue
                got, _returns, deffile = defs[target]
                if got != typedefs[outer]:
                    bad.append(
                        f'{src.relative_to(ROOT)}:{n}: ({outer}) wants '
                        f'{typedefs[outer]} parameters, but {target} defines '
                        f'{got} (in {deffile.relative_to(ROOT)})')

            # Inline casts, which name no typedef.
            for m in inline_cast.finditer(line):
                ret, params, target = m.groups()
                if target not in defs:
                    continue
                # A local variable can share a name with a function defined
                # elsewhere, as AXRegisterCallback's "callback" parameter
                # does. Only trust a definition in the same file.
                if defs[target][2] != src:
                    continue
                want = count_params(params)
                got, returns_value, deffile = defs[target]
                wants_value = ret != 'void'
                if got != want:
                    bad.append(
                        f'{src.relative_to(ROOT)}:{n}: a cast to '
                        f'{ret} (*)({params.strip()}) wants {want} parameters, '
                        f'but {target} defines {got} '
                        f'(in {deffile.relative_to(ROOT)})')
                elif returns_value != wants_value:
                    bad.append(
                        f'{src.relative_to(ROOT)}:{n}: a cast to '
                        f'{ret} (*)({params.strip()}) disagrees with {target} '
                        f'on whether a value is returned '
                        f'(in {deffile.relative_to(ROOT)})')

    if bad:
        fail('a cast hides a signature the indirect call will reject:\n  '
             + '\n  '.join(sorted(bad)))

    print(f'OK: {len(typedefs)} callback typedefs, no cast hides a '
          'signature the indirect call would reject')


if __name__ == '__main__':
    main()
