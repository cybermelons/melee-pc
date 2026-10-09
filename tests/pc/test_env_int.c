/* SPDX-License-Identifier: GPL-3.0-or-later */
/* pc_env_int clamps a MELEE_* integer setting. A bad query parameter must not
 * boot the game into a character or stage that does not exist, so the clamp is
 * the thing under test, not the parse. */
#include <assert.h>
#include <stdio.h>
#include <stdlib.h>

int pc_env_int(const char* name, int def, int lo, int hi);

static int check(const char* value, int def, int lo, int hi) {
    if (value == NULL) {
        unsetenv("MELEE_TEST_INT");
    } else {
        setenv("MELEE_TEST_INT", value, 1);
    }
    return pc_env_int("MELEE_TEST_INT", def, lo, hi);
}

int main(void) {
    /* Unset, empty, and non-numeric all fall back, so an absent setting keeps
     * the behaviour the hardcoded value had. */
    assert(check(NULL, 8, 0, 25) == 8);
    assert(check("", 8, 0, 25) == 8);
    assert(check("marth", 8, 0, 25) == 8);

    /* In range passes through. 9 is CKind_Mars, the case the drills need. */
    assert(check("9", 8, 0, 25) == 9);
    assert(check("0", 8, 0, 25) == 0);
    assert(check("25", 8, 0, 25) == 25);

    /* Out of range clamps rather than falling back: a caller asking for 99
     * wants the highest valid character, not Mario. */
    assert(check("99", 8, 0, 25) == 25);
    assert(check("-5", 8, 0, 25) == 0);

    /* A trailing suffix still parses, matching strtol. */
    assert(check("9abc", 8, 0, 25) == 9);

    printf("pc_env_int: all checks passed\n");
    return 0;
}
