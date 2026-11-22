// learn, the Wolf's cheers (modules/learn/ui/cheer.js, docs/learn.md "Wolf cheers"): pure, so tested straight.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cheerFor, LINES, pickLine } from '../modules/learn/ui/cheer.js';

const res = (o) => ({ phase: 'result', levelId: 'L1', index: 4, total: 8, correct: true, lastCheer: -1, ...o });
const ask = (o) => ({ phase: 'ask', levelId: 'L1', index: 0, total: 8, lastCheer: -1, ...o });

test('triggers fire when they should', () => {
  const cases = [
    ['3 right in a row', res({ streak: 3 }), 'streak3'],
    ['5 right in a row', res({ streak: 5 }), 'streak5'],
    ['4 right in a row is quiet', res({ streak: 4 }), null],
    ['right after a miss', res({ fixed: true, streak: 0 }), 'fixed'],
    ['a wrong answer never cheers', res({ correct: false, streak: 3, fixed: true }), null],
    ['halfway of 8', ask({ index: 4, pos: 4 }), 'half'],
    ['no halfway on a 3-question level', ask({ index: 1, total: 3 }), null],
    ['last question coming up', ask({ index: 7, pos: 7 }), 'last'],
    ['no cheer in the retry round', ask({ index: 9, pos: 7, retry: true }), null],
    ['timed checkpoint', res({ checkpoint: true, total: 0 }), 'checkpoint'],
    ['climb level', res({ climbLevel: true, total: 0 }), 'climb'],
    ['an ordinary question', res({ streak: 1 }), null],
  ];
  for (const [name, ev, want] of cases) assert.equal(cheerFor(ev)?.trigger ?? null, want, name);
});

test('never two questions in a row, at most one per question', () => {
  assert.equal(cheerFor(res({ streak: 3, index: 3, lastCheer: 2 })), null, 'the question after a cheer');
  assert.equal(cheerFor(res({ streak: 3, index: 3, lastCheer: 3 })), null, 'the same question again');
  assert.ok(cheerFor(res({ streak: 3, index: 3, lastCheer: 1 })), 'one question gap is fine');
  assert.ok(cheerFor(res({ streak: 3, index: 0, lastCheer: -1 })), 'the first question of a session');
  // a whole 8-question level of right answers: cheers never sit on neighbouring questions
  let last = -1; const at = [];
  for (let i = 0; i < 8; i++) {
    for (const ev of [ask({ index: i, pos: i }), res({ index: i, streak: i + 1 })]) { const c = cheerFor({ ...ev, lastCheer: last }); if (c) { last = i; at.push(i); } }
  }
  assert.ok(at.length >= 2 && at.length <= 5, `occasional: ${at}`);
  for (let i = 1; i < at.length; i++) assert.ok(at[i] - at[i - 1] >= 2, `gap at ${at}`);
});

test('same inputs, same line; lines come from the trigger list', () => {
  const ev = res({ streak: 3, levelId: 'ft10-s1-u1-l2', index: 2 });
  assert.deepEqual(cheerFor(ev), cheerFor({ ...ev }));
  assert.ok(LINES.streak3.includes(cheerFor(ev).text));
  const seen = new Set(); for (let i = 0; i < 40; i++) seen.add(pickLine('fixed', `L${i}`, i));
  assert.ok(seen.size > 1, 'the hash spreads over the lines');
});

test('every line is under 8 words, 4 to 6 per trigger, plain and money-free', () => {
  assert.deepEqual(Object.keys(LINES).sort(), ['checkpoint', 'climb', 'fixed', 'half', 'last', 'streak3', 'streak5']);
  for (const [t, lines] of Object.entries(LINES)) {
    assert.ok(lines.length >= 4 && lines.length <= 6, t);
    for (const l of lines) { assert.ok(l.split(/\s+/).length < 8, l); assert.doesNotMatch(l, /\$|cash|money|XP|!/i, l); }
  }
});
