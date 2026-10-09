// SPDX-License-Identifier: GPL-3.0-or-later
// A repetition must score on the frame the fighter ENTERS the target state.
// Scoring per frame instead would turn one L-cancel into forty, which is the
// failure this checks for.
import assert from 'node:assert';
import { createCounter, DRILLS, MS } from '../../platforms/browser/drill.mjs';

const frame = (motion, air = 0) => ({ motion, air, port: 0, x: 0, y: 0, vx: 0, vy: 0, facing: 1, percent: 0 });
const run = (drill, states) => {
  const c = createCounter(drill);
  for (const s of states) c.feed(s);
  return c.reps;
};

// A held state scores once, not once per frame.
assert.strictEqual(
  run(DRILLS.r1, [frame(MS.Wait), ...Array(40).fill(frame(MS.Attack11))]), 1);

// Two separate entries score twice.
assert.strictEqual(run(DRILLS.r1, [
  frame(MS.Wait), frame(MS.Attack11), frame(MS.Wait), frame(MS.Attack11),
]), 2);

// `from` rejects the right entry path: r6 is an L-cancel, so a landing that
// did not come from a neutral air does not count.
assert.strictEqual(run(DRILLS.r6, [frame(MS.AttackAirN), frame(MS.LandingAirN)]), 1);
assert.strictEqual(run(DRILLS.r6, [frame(MS.AttackAirF), frame(MS.LandingAirN)]), 0);

// `air` rejects the wrong medium: a shield only scores from the ground.
assert.strictEqual(run(DRILLS.r8, [frame(MS.Wait, 0), frame(MS.Guard, 0)]), 1);
assert.strictEqual(run(DRILLS.r8, [frame(MS.Wait, 1), frame(MS.Guard, 1)]), 0);

// A scene change does not score, even when the states either side would.
assert.strictEqual(run(DRILLS.r1, [frame(MS.Wait), null, frame(MS.Attack11)]), 0);

// Every drill has a name and at least one scoring state.
for (const [id, d] of Object.entries(DRILLS)) {
  assert.ok(d.name, `${id} has no name`);
  assert.ok(d.enter?.length, `${id} has no enter state`);
}

console.log(`drill: all checks passed (${Object.keys(DRILLS).length} drills)`);

// Each drill link must carry its own character, or the ten links boot the
// same match and the drills differ in name only. That was the reported bug.
import { drillSearch } from '../../platforms/browser/drill.mjs';
const searches = Object.keys(DRILLS).map(drillSearch);
assert.strictEqual(new Set(searches).size, searches.length, 'drill links are not distinct');
for (const [id, d] of Object.entries(DRILLS)) {
  const s = drillSearch(id);
  assert.ok(s.includes(`MELEE_DRILL=${id}`), `${id} link lacks its id`);
  assert.ok(s.includes(`MELEE_DRILL_CHAR=${d.char}`), `${id} link lacks its character`);
}
assert.strictEqual(drillSearch('nope'), null);
// More than one character across the set, so the links are not all one fighter.
assert.ok(new Set(Object.values(DRILLS).map((d) => d.char)).size > 1);
console.log('drill links: all checks passed');
