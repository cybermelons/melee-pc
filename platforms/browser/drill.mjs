// SPDX-License-Identifier: GPL-3.0-or-later
//
// Repetition counting for the training drills.
//
// A drill is a motion state to reach and a condition to reach it under. The
// engine cannot judge that itself, so pc_drill_state (platforms/browser/
// pc_stubs.c) hands the page the fighter's action state and position every
// frame and the judging lives here, where a new drill costs one table entry
// instead of a wasm rebuild.
//
// The motion state numbers come from the compiler rather than from reading
// src/melee/ft/kinds/ftCommon/forward.h by eye: the enum is not in line order
// (ftCo_MS_Wait is 14, and it is the 14th entry only by coincidence of the
// entries before it). Regenerate them the same way if a value looks wrong.
const MS = {
  Wait: 14,
  Turn: 18,
  Dash: 20,
  SquatWait: 40,
  Attack11: 44,
  Attack100Start: 47,
  AttackAirN: 65,
  AttackAirF: 66,
  LandingAirN: 70,
  LandingAirF: 71,
  Guard: 179,
  CatchWait: 216,
  Pass: 244,
};

// Field order of pc_drill_state's output. Keep in step with PC_DRILL_FLOATS
// and the writes in pc_stubs.c; the count there and the length here must
// agree or every field after the mismatch is read from the wrong slot.
const FIELDS = [
  'motion', 'port', 'x', 'y', 'vx', 'vy', 'facing', 'percent', 'air',
];
const FLOATS = FIELDS.length;

// fp->ground_or_air, src/melee/ft/types.h.
const GA_GROUND = 0;
const GA_AIR = 1;

// A repetition is scored on the frame the fighter ENTERS the target state, not
// on every frame it is in it: an animation lasts many frames and a held state
// would otherwise count once per frame.
//
// `enter` is the state that scores. `from` restricts which state it must be
// entered from, for a drill where the entry path is the point (an L-cancel
// scores only from an aerial, not from any landing). `air` requires
// ground_or_air at the moment of entry.
// CharacterKind values, src/melee/ft/forward.h. Taken from the compiler, not
// counted by eye: Fox is 2, not 1. `char` picks the fighter the drill needs
// (an L-cancel drill wants a fast-faller, a spacing drill wants Marth) and
// reaches the engine as MELEE_DRILL_CHAR, which src/melee/gm/gmtrainingmode.c
// reads at boot. Without it every drill loads the same vanilla Mario.
const CK = { Fox: 2, Link: 6, Mario: 8, Marth: 9 };

const DRILLS = {
  r1: { name: 'Jab timing', enter: [MS.Attack11], char: CK.Marth },
  r2: { name: 'Jab to rapid jab', enter: [MS.Attack100Start], from: [MS.Attack11], char: CK.Mario },
  r3: { name: 'Dash dance', enter: [MS.Turn], from: [MS.Dash], char: CK.Fox },
  r4: { name: 'Neutral air', enter: [MS.AttackAirN], air: GA_AIR, char: CK.Fox },
  r5: { name: 'Forward air', enter: [MS.AttackAirF], air: GA_AIR, char: CK.Marth },
  r6: { name: 'L-cancel neutral air', enter: [MS.LandingAirN], from: [MS.AttackAirN], char: CK.Fox },
  r7: { name: 'L-cancel forward air', enter: [MS.LandingAirF], from: [MS.AttackAirF], char: CK.Marth },
  r8: { name: 'Shield timing', enter: [MS.Guard], air: GA_GROUND, char: CK.Marth },
  r9: { name: 'Grab from shield', enter: [MS.CatchWait], from: [MS.Guard], char: CK.Marth },
  r10: { name: 'Platform drop', enter: [MS.Pass], char: CK.Fox },
};

// The query string a drill link carries. MELEE_DRILL names the drill for the
// page; MELEE_DRILL_CHAR is what makes the engine load a different fighter,
// which is the whole difference between ten drills and ten identical training
// sessions.
export function drillSearch(id) {
  const d = DRILLS[id];
  if (!d) return null;
  const q = new URLSearchParams({ MELEE_BOOT_SCENE: 'training', MELEE_DRILL: id });
  if (d.char !== undefined) q.set('MELEE_DRILL_CHAR', String(d.char));
  if (d.cpu !== undefined) q.set('MELEE_DRILL_CPU', String(d.cpu));
  if (d.stage !== undefined) q.set('MELEE_DRILL_STAGE', String(d.stage));
  return '?' + q.toString();
}

// Reads pc_drill_state into a plain object, or null between scenes and during
// a load, when no fighter for the port exists yet.
//
// The float view is built over Module.HEAPU8.buffer rather than taken from
// Module.HEAPF32: only HEAPU8 is in -sEXPORTED_RUNTIME_METHODS
// (platforms/browser/CMakeLists.txt), so HEAPF32 is undefined on Module. The
// view is rebuilt per call because ALLOW_MEMORY_GROWTH detaches the old buffer
// when the heap grows, which would otherwise make every later read throw.
export function createDrill(Module, port = 0) {
  let buffer = 0;

  const read = () => {
    if (!buffer) buffer = Module._malloc(FLOATS * 4);
    if (!Module._pc_drill_state(port, buffer)) return null;
    const view = new Float32Array(Module.HEAPU8.buffer, buffer, FLOATS);
    const out = {};
    for (let i = 0; i < FLOATS; i++) out[FIELDS[i]] = view[i];
    return out;
  };

  return { read, drills: DRILLS, fields: FIELDS, MS };
}

// The judging itself, with no wasm and no page in it, so it can be tested
// against a list of states. `feed` takes one state per frame (null between
// scenes) and returns true on a frame that scores a repetition.
export function createCounter(drill) {
  let prev = null;
  let reps = 0;

  const feed = (state) => {
    const was = prev;
    prev = state;
    // A null state is a scene change, not a transition: a drill must not score
    // from the state the previous scene ended in.
    if (state === null || was === null) return false;
    if (was.motion === state.motion) return false;
    if (!drill.enter.includes(state.motion)) return false;
    if (drill.from && !drill.from.includes(was.motion)) return false;
    if (drill.air !== undefined && state.air !== drill.air) return false;
    reps++;
    return true;
  };

  return { feed, get reps() { return reps; }, reset() { reps = 0; prev = null; } };
}

export { DRILLS, MS, CK, FIELDS, FLOATS };
