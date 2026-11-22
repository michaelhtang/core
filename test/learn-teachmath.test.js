// The teacher panel's unit list (modules/learn/ui/teachmath.js): which units are listed for a class, and the one line of numbers for each.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { shownUnits, unitLine } from '../modules/learn/ui/teachmath.js';

const level = (n, finished, pct) => ({ id: `l${n}`, n, title: `Level ${n}`, finished, median_first_try_pct: pct });
const unit = (id, levels, hardest = []) => ({ id, title: id, section: 'S', levels, hardest });
const quiet = unit('quiet', [level(1, 0, null), level(2, 0, null)]);
const played = unit('played', [level(1, 5, 80), level(2, 3, 60), level(3, 3, 60), level(4, 1, 90)]);
const answered = unit('answered', [level(1, 0, null)], [{ question_id: 'q', first_try_pct: 50, answered: 2 }]);   // answers on a level nobody has finished yet

test('a class is shown its open units, and any closed unit that has results', () => {
  const ids = (open_units) => shownUnits({ open_units, units: [quiet, played, answered] }).map((u) => u.id);
  assert.deepEqual(ids(null), ['quiet', 'played', 'answered']);            // no setting: every unit is open
  assert.deepEqual(ids(['quiet']), ['quiet', 'played', 'answered']);       // closed after students played: the rows stay
  assert.deepEqual(ids([]), ['played', 'answered']);                       // nothing open: only what has results
  assert.deepEqual(shownUnits({ open_units: [], units: [quiet] }), []);
});

test('one line per unit: who finished it, level finishes, and the level with the lowest median first try', () => {
  assert.deepEqual(unitLine(played, 6), { done: 1, finished: 12, total: 24, lowest: played.levels[1] });   // a tie goes to the earlier level
  assert.deepEqual(unitLine(quiet, 6), { done: 0, finished: 0, total: 12, lowest: null });
  assert.deepEqual(unitLine(quiet, 0), { done: 0, finished: 0, total: 0, lowest: null });                  // a class with no students yet
});
