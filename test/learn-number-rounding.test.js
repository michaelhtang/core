// learn: a number answer typed with fewer decimals, correctly rounded, counts (judge in modules/learn/attempts.js, roundedMatch).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { judge, roundedMatch } from '../modules/learn/attempts.js';

const q = (answer, unit, tolerance = 0) => ({ type: 'number', answer, unit, tolerance, why: 'y', miss: 'm', working: 'w' });

test('dollars: $43.33 accepts 43.33, 43.3 and 43.30, not 43, 43.4 or 43.2', () => {
  const d = q(4333, '$', 2);
  for (const [v, ok] of [[4333, true], [4335, true], [4330, true], [4300, false], [4340, false], [4320, false], [4000, false]]) assert.equal(judge(d, v).correct, ok, `${v}`);
});
test('dollars: rounding goes to the nearest ten cents (43.35 -> 43.4), and an answer already in tens of cents adds nothing', () => {
  assert.equal(roundedMatch(q(4335, '$'), 4340), true);
  assert.equal(roundedMatch(q(4335, '$'), 4330), false);
  assert.equal(roundedMatch(q(4330, '$'), 4300), false);
  assert.equal(roundedMatch(q(6500, '$'), 6000), false);
});
test('other units: 4.333 accepts 4.33 and 4.3, not 4; 12.5 accepts nothing new; whole answers are unchanged', () => {
  for (const [v, ok] of [[4.333, true], [4.33, true], [4.3, true], [4, false], [4.34, false]]) assert.equal(judge(q(4.333, '%'), v).correct, ok, `${v}`);
  assert.equal(judge(q(12.5, '%'), 12).correct, false);
  assert.equal(judge(q(12.5, '%'), 13).correct, false);
  assert.equal(judge(q(52, 'hours'), 50).correct, false);
  assert.equal(judge(q(4.35, '%'), 4.4).correct, true);
});
test('a wrong answer still gets the miss text', () => {
  assert.equal(judge(q(4333, '$', 2), 4300).why, 'm');
});
