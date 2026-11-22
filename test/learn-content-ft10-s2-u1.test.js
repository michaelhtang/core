// Content check for the Learning Road unit "Why invest" (ft10-s2-u1): every growth figure is recomputed here, every figure quoted from
// Mr. Tang's outlines is pinned to a cited table, and the shape is checked. No game module supplies a number in this unit.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const course = JSON.parse(fs.readFileSync(new URL('../modules/learn/content/fintech10.json', import.meta.url), 'utf8'));
const unit = course.sections.flatMap((s) => s.units).find((u) => u.id === 'ft10-s2-u1');
const Q = new Map(unit.levels.flatMap((l) => l.questions).map((q) => [q.id, q]));
const d = (n) => `$${Math.round(n).toLocaleString('en-CA')}`;
const OUT = 'slide-studio/courses/fintech10/context/claude-project/docs';
// $pmt at the end of each of `dep` months, interest added monthly at r/12, then `grow` months with no deposits
const fv = (pmt, dep, r, grow = 0) => { let b = 0; for (let i = 0; i < dep; i++) b = b * (1 + r / 12) + pmt; return b * (1 + r / 12) ** grow; };
const jar = (y) => 1000 * 1.06 ** y;

const OUTLINE = {
  put: { value: { amara: 24000, ben: 88800 }, cite: `${OUT}/claude_Lesson 10 Slide Outline Sept 18.md lines 136-141 (Total put in)` },
  at8: { value: { amara: 699195, ben: 543280 }, cite: 'Lesson 10 outline line 140; Day 1 outline line 33' },
  at6: { value: { amara: 300114, ben: 326262 }, cite: 'Lesson 10 outline line 141; Day 1 outline line 31 (Return 6%)' },
  gap8: { value: 155915, cite: 'Day 1 outline line 33 (Gap at 8%)' },
  gap6: { value: 26148, cite: 'Day 1 outline line 31 (Gap at 6%)' },
  jordan43: { value: { put: 103200, endsAbout: 655000 }, cite: 'Lesson 10 outline line 183 ($200 a month, 22 to 65, at 7%: $103,200 in, $655,000)' },
};

test('shape: 4 levels, 4-6 cards, 7-10 questions, ids, outcome code, one go button, no pictures yet', () => {
  assert.ok(unit, 'unit ft10-s2-u1 is in fintech10.json');
  assert.equal(unit.title, 'Why invest');
  assert.equal(unit.blurb, 'Saving and investing do different jobs, and time is the biggest tool you have.');
  assert.deepEqual(unit.outcome_codes, ['FIN1010 2.5']);
  assert.equal(unit.levels.length, 4);
  unit.levels.forEach((l, i) => {
    assert.equal(l.id, `ft10-s2-u1-l${i + 1}`);
    assert.ok(l.cards.length >= 4 && l.cards.length <= 6, `${l.id}: ${l.cards.length} cards`);
    assert.ok(l.questions.length >= 7 && l.questions.length <= 10, `${l.id}: ${l.questions.length} questions`);
    assert.ok(l.questions.some((q) => q.figure), `${l.id}: a question with a figure`);
    l.questions.forEach((q, k) => assert.equal(q.id, `${l.id}-q${k + 1}`));
  });
  [1, 2, 3].forEach((n) => assert.ok(unit.levels[n].questions.filter((q) => q.type === 'number').length >= 2));
  assert.ok(!JSON.stringify(unit).includes('"image"'));
  assert.deepEqual(unit.levels[3].go, { building: 'networth', label: 'Open Net Worth' });
  assert.ok(unit.levels.every((l, i) => i === 3 || !l.go));
  assert.ok(!/2\.75|compound|Rule of 72|[!]/.test(JSON.stringify(unit)), 'no game rate, no compounding or Rule of 72 teaching, no exclamation marks');
});

test('arithmetic: every number answer is recomputed', () => {
  const A8 = Math.round(fv(200, 120, 0.08, 444)), B8 = Math.round(fv(200, 444, 0.08));
  const A6 = Math.round(fv(200, 120, 0.06, 444)), B6 = Math.round(fv(200, 444, 0.06));
  const J = (y) => ({ put: 200 * 12 * y, bal: Math.round(fv(200, 12 * y, 0.07)) });
  const c = (x) => Math.round(x * 100);
  const want = {
    'ft10-s2-u1-l1-q5': c(75 * 6), 'ft10-s2-u1-l1-q6': c((540 - 120) / 6),
    'ft10-s2-u1-l2-q1': c(Math.round(jar(1)) - 1000), 'ft10-s2-u1-l2-q2': c(Math.round(jar(20)) - 1000), 'ft10-s2-u1-l2-q3': c(Math.round(jar(20)) - Math.round(jar(10))),
    'ft10-s2-u1-l3-q2': c(200 * 12 * (65 - 28)), 'ft10-s2-u1-l3-q3': c(150 * 12 * (30 - 20)), 'ft10-s2-u1-l3-q5': c(A8 - B8), 'ft10-s2-u1-l3-q6': c(A8 - 200 * 120), 'ft10-s2-u1-l3-q9': c(B6 - A6),
    'ft10-s2-u1-l4-q1': c(2000 * 0.1), 'ft10-s2-u1-l4-q2': c(1800 * 0.1 * 12), 'ft10-s2-u1-l4-q3': c(200 * 12 * 25), 'ft10-s2-u1-l4-q4': c(J(43).bal - J(43).put), 'ft10-s2-u1-l4-q9': c(J(20).bal - J(20).put),
  };
  const numbers = [...Q.values()].filter((q) => q.type === 'number').map((q) => q.id);
  assert.deepEqual(Object.keys(want).sort(), numbers.sort(), 'every number question is covered');
  for (const [id, v] of Object.entries(want)) assert.ok(Math.abs(Q.get(id).answer - v) < 1e-6, `${id}: stored ${Q.get(id).answer}, recomputed ${v}`);
  // each trap is the result of the mistake its why names
  assert.equal(Q.get('ft10-s2-u1-l3-q2').traps[0].value, 200 * 37 * 100);
  assert.equal(Q.get('ft10-s2-u1-l3-q5').traps[0].value, (88800 - 24000) * 100);
  assert.equal(Q.get('ft10-s2-u1-l1-q6').traps[0].value, (540 / 6) * 100);
  assert.equal(Q.get('ft10-s2-u1-l4-q1').traps[0].value, 1800 * 100);
});

test('tables, lines and bars: every figure value equals the recomputed one', () => {
  const l2 = unit.levels[1].cards[2].figure.rows;
  [0, 1, 5, 10, 20, 30].forEach((y, i) => assert.deepEqual(l2[i], [String(y), '$1,000', d(jar(y))]));
  const added = unit.levels[1].cards[4].figure.bars.map((b) => b.value);
  assert.deepEqual(added, [[0, 10], [10, 20], [20, 30]].map(([a, b]) => (Math.round(jar(b)) - Math.round(jar(a))) * 100));
  const t4 = unit.levels[1].cards[3].text;
  [10, 20, 30].forEach((y) => assert.ok(t4.includes(d(Math.round(jar(y)) - 1000)), `gap at year ${y} in level 2 card 4`));
  // level 3
  const ages = [18, 28, 38, 48, 58, 65];
  const line = unit.levels[2].cards[4].figure.points.map((p) => p.value);
  assert.deepEqual(line, ages.map((a) => (a === 18 ? 0 : Math.round(fv(200, 120, 0.08, (a - 28) * 12)) * 100)));
  assert.equal(Q.get('ft10-s2-u1-l3-q7').answer, ages.findIndex((a, i) => i > 0 && line[i] > 30000000));
  assert.deepEqual(unit.levels[2].cards[2].figure.rows, [['Amara', '$24,000', d(fv(200, 120, 0.08, 444))], ['Ben', '$88,800', d(fv(200, 444, 0.08))]]);
  assert.deepEqual(unit.levels[2].cards[5].figure.rows, [['8%', d(fv(200, 120, 0.08, 444)), d(fv(200, 444, 0.08)), 'Amara'], ['6%', d(fv(200, 120, 0.06, 444)), d(fv(200, 444, 0.06)), 'Ben']]);
  assert.ok(24000 / 88800 < 1 / 3 && (88800 / 24000).toFixed(1) === '3.7');
  // level 4
  const yrs = [1, 10, 20, 30, 43];
  const rows = unit.levels[3].cards[2].figure.rows;
  yrs.forEach((y, i) => assert.deepEqual(rows[i], [String(y), d(2400 * y), d(fv(200, 12 * y, 0.07))]));
  unit.levels[3].cards[1].figure.rows.forEach((r, i) => assert.deepEqual(r, [String(yrs[i]), d(2400 * yrs[i])]));
  const g = [10, 20, 30, 43].map((y) => Math.round(fv(200, 12 * y, 0.07)) - 2400 * y);
  assert.deepEqual(unit.levels[3].cards[3].figure.bars.map((b) => b.value), g.map((x) => x * 100));
  assert.deepEqual(Q.get('ft10-s2-u1-l4-q5').figure.bars.map((b) => b.value), [10, 20, 30, 43].map((y) => Math.round(fv(200, 12 * y, 0.07)) * 100));
  assert.equal(Q.get('ft10-s2-u1-l4-q5').answer, 1);
});

test('outline figures: quoted as written, and the one rounded figure differs on purpose', () => {
  const A8 = Math.round(fv(200, 120, 0.08, 444)), B8 = Math.round(fv(200, 444, 0.08)), A6 = Math.round(fv(200, 120, 0.06, 444)), B6 = Math.round(fv(200, 444, 0.06));
  assert.deepEqual({ amara: 200 * 120, ben: 200 * 444 }, OUTLINE.put.value);
  assert.deepEqual({ amara: A8, ben: B8 }, OUTLINE.at8.value);
  assert.deepEqual({ amara: A6, ben: B6 }, OUTLINE.at6.value);
  assert.equal(A8 - B8, OUTLINE.gap8.value);
  assert.equal(B6 - A6, OUTLINE.gap6.value);
  assert.equal(200 * 12 * 43, OUTLINE.jordan43.value.put);
  assert.equal(Math.round(Math.round(fv(200, 516, 0.07)) / 1000) * 1000, OUTLINE.jordan43.value.endsAbout, 'the slide rounds $655,226 to $655,000');
  const all = unit.levels.flatMap((l) => l.cards.map((c) => c.text)).join(' ');
  for (const v of ['$699,195', '$543,280', '$155,915']) assert.ok(all.includes(v), v);
});
