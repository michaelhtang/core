// Content check for the Learning Road unit "Compound growth and the Rule of 72" (ft10-s2-u2): the growth arithmetic is recomputed here,
// every figure quoted from Mr. Tang's outlines is pinned to a cited table, the savings facts come from modules/savings, and the shape is checked.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import savings, { monthlyInterest } from '../modules/savings/index.js';
import { HISA_BP } from '../modules/savings/constants.js';

const course = JSON.parse(fs.readFileSync(new URL('../modules/learn/content/fintech10.json', import.meta.url), 'utf8'));
const unit = course.sections.flatMap((s) => s.units).find((u) => u.id === 'ft10-s2-u2');
const Q = new Map(unit.levels.flatMap((l) => l.questions).map((q) => [q.id, q]));
const money = (c) => `$${(c / 100).toLocaleString('en-CA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const money0 = (c) => `$${Math.round(c / 100).toLocaleString('en-CA')}`;
const text = (l) => unit.levels[l - 1].cards.map((c) => c.text).join(' ');
const compound = (p, rate, n) => p * (1 + rate) ** n;                        // float, independent of the generator's BigInt
const simple = (p, rate, n) => p + p * rate * n;
const cents = (x) => Math.round(x * 100) / 100;                              // dollars, to the cent
const OUT = 'slide-studio/courses/fintech10/context/claude-project/docs';

// Figures quoted from Mr. Tang's outlines. The lesson recomputes the 10% table to the dollar; the slide differs in two cells (see REVIEW).
const OUTLINE = {
  slideSimple: { value: [1100, 1500, 2000, 3000, 4000], cite: `${OUT}/claude_Lesson 10 Slide Outline Sept 18.md lines 82-86 (Simple column, years 1, 5, 10, 20, 30)` },
  slideCompound: { value: [1100, 1610, 2594, 6728, 17449], cite: `${OUT}/claude_Lesson 10 Slide Outline Sept 18.md lines 82-86 (Compound column)` },
  ruleExamples: { value: { 6: 12, 8: 9 }, cite: 'Lesson 10 outline line 96 ("At 6%, twelve years. At 8%, nine.")' },
  doubling: { value: { 4: [18, 40000], 6: [12, 80000], 8: [9, 160000], 12: [6, 640000] }, cite: 'Lesson 10 outline lines 117-120 ($10,000 at 29 to age 65)' },
  exact12: { value: 591356, cite: 'Lesson 10 outline line 126 (12% really gives $591,356)' },
  monthlyFactor: { value: 1.0617, cite: 'Lesson 11 outline line 50 (previous x 1.0617 at 6%)' },
};

test('shape: 6 levels, 4-6 cards, 7-10 questions, ids, outcome code, one go button, no pictures yet', () => {
  assert.ok(unit, 'unit ft10-s2-u2 is in fintech10.json');
  assert.equal(unit.title, 'Compound growth and the Rule of 72');
  assert.equal(unit.blurb, 'Growth on growth, and a quick way to see how long money takes to double.');
  assert.deepEqual(unit.outcome_codes, ['FIN1010 2.4']);
  assert.equal(unit.levels.length, 6);
  unit.levels.forEach((l, i) => {
    assert.equal(l.id, `ft10-s2-u2-l${i + 1}`);
    assert.ok(l.cards.length >= 4 && l.cards.length <= 6, `${l.id}: ${l.cards.length} cards`);
    assert.ok(l.questions.length >= 7 && l.questions.length <= 10, `${l.id}: ${l.questions.length} questions`);
    assert.ok(l.questions.filter((q) => q.type === 'number').length >= 2, `${l.id}: at least 2 number questions`);
    assert.ok(l.questions.some((q) => q.figure), `${l.id}: at least 1 question with a figure`);
    l.questions.forEach((q, k) => assert.equal(q.id, `${l.id}-q${k + 1}`));
  });
  assert.ok(!JSON.stringify(unit).includes('"image"'), 'no image fields yet');
  assert.deepEqual(unit.levels[5].go, { building: 'networth', label: 'Open Net Worth' });
  assert.ok(unit.levels.every((l, i) => i === 5 || !l.go));
  assert.ok(!/inflation|two savers|Amara|Ben\b/i.test(JSON.stringify(unit)), 'inflation and the two-savers story belong to other units');
});

test('arithmetic: every number answer is recomputed from its prompt', () => {
  const want = {
    'ft10-s2-u2-l1-q3': cents(40000 * 0.05),
    'ft10-s2-u2-l1-q4': cents(150000 * 0.04),
    'ft10-s2-u2-l1-q6': (1800 / 60000) * 100,
    'ft10-s2-u2-l1-q7': 80000 + cents(80000 * 0.03),
    'ft10-s2-u2-l2-q1': cents(200000 * 0.05),
    'ft10-s2-u2-l2-q2': simple(200000, 0.05, 6),
    'ft10-s2-u2-l2-q4': simple(50000, 0.04, 10),
    'ft10-s2-u2-l2-q9': simple(30000, 0.06, 5),
    'ft10-s2-u2-l3-q3': Math.round(compound(200000, 0.05, 2)),
    'ft10-s2-u2-l3-q4': 110000 * 0.1,
    'ft10-s2-u2-l3-q6': Math.round(compound(40000, 0.05, 3)),
    'ft10-s2-u2-l3-q8': Math.round(compound(50000, 0.1, 3)),
    'ft10-s2-u2-l4-q2': Math.round(compound(100000, 0.1, 10) / 100) * 100 - simple(100000, 0.1, 10),
    'ft10-s2-u2-l4-q3': Math.round(compound(100000, 0.1, 20) / 100) * 100 - simple(100000, 0.1, 20),
    'ft10-s2-u2-l4-q4': 10000 * 30,
    'ft10-s2-u2-l4-q5': Math.round(compound(100000, 0.1, 30) / 100) * 100 - 100000,
    'ft10-s2-u2-l5-q5': 72 / 6,
    'ft10-s2-u2-l5-q6': 72 / 8,
    'ft10-s2-u2-l5-q8': Math.round(compound(100000, 0.08, 9) / 100) * 100,
    'ft10-s2-u2-l6-q1': 500000 * 2 ** ((58 - 22) / 9),   // Noor's money doubles every 9 years
    'ft10-s2-u2-l6-q3': 200000 * 2 ** (48 / (72 / 6)),
    'ft10-s2-u2-l6-q6': 64000000 - Math.round(compound(1000000, 0.12, 36) / 100) * 100,
    'ft10-s2-u2-l6-q9': Math.round(1000000 * 1.0617) - 1000000 * 1.06,
  };
  const numbers = [...Q.values()].filter((q) => q.type === 'number').map((q) => q.id);
  assert.deepEqual(Object.keys(want).sort(), numbers.sort(), 'every number question is covered by this test');
  for (const [id, v] of Object.entries(want)) assert.ok(Math.abs(Q.get(id).answer - v) < 1e-6, `${id}: stored ${Q.get(id).answer}, recomputed ${v}`);
  // the compound answers hold to the cent, not just to the dollar
  assert.equal(Q.get('ft10-s2-u2-l3-q3').answer, 220500);
  assert.equal(Q.get('ft10-s2-u2-l3-q6').answer, 46305);
  assert.equal(Q.get('ft10-s2-u2-l3-q8').answer, 66550);
});

test('tables and bars: every figure value equals the recomputed one', () => {
  const years = [1, 5, 10, 20, 30];
  const dollars = (c) => c.toLocaleString('en-CA');
  const l4 = unit.levels[3].cards[1].figure;
  years.forEach((y, i) => {
    assert.equal(l4.rows[i][0], String(y));
    assert.equal(l4.rows[i][1], `$${dollars(Math.round(simple(1000, 0.1, y)))}`);
    assert.equal(l4.rows[i][2], `$${dollars(Math.round(compound(1000, 0.1, y)))}`);
  });
  // level 3 table: year, start, interest, end for $1,000 at 10%
  const t3 = unit.levels[2].cards[2].figure.rows;
  let bal = 1000;
  t3.forEach((r, i) => {
    const end = cents(bal * 1.1);
    assert.deepEqual(r, [String(i + 1), money(bal * 100), money(Math.round((end - bal) * 100)), money(Math.round(end * 100))]);
    bal = end;
  });
  assert.deepEqual(unit.levels[2].cards[3].figure.bars.map((b) => b.value), [10000, 11000, 12100, 13310, 14641]);
  // level 2 line and table: simple interest, equal steps
  assert.deepEqual(unit.levels[1].cards[3].figure.points.map((p) => p.value), [0, 5, 10, 15, 20, 25, 30].map((y) => simple(100000, 0.1, y)));
  // level 4 line (compound, to the cent) and gap bars (table figures)
  assert.deepEqual(unit.levels[3].cards[4].figure.points.map((p) => p.value), [0, 5, 10, 15, 20, 25, 30].map((y) => Math.round(compound(100000, 0.1, y))));
  const gaps = Q.get('ft10-s2-u2-l4-q8').figure.bars.map((b) => b.value);
  assert.deepEqual(gaps, years.map((y) => (Math.round(compound(1000, 0.1, y)) - simple(1000, 0.1, y)) * 100));
  // level 5 table: 72 / rate beside the exact time, to one decimal
  unit.levels[4].cards[2].figure.rows.forEach(([rate, rule, exact]) => {
    const r = Number.parseInt(rate, 10);
    assert.equal(rule, String(72 / r));
    assert.equal(exact, (Math.log(2) / Math.log(1 + r / 100)).toFixed(1));
  });
  // level 6 tables
  unit.levels[5].cards[1].figure.rows.forEach(([rate, every, doublings, end]) => {
    const r = Number.parseInt(rate, 10), per = 72 / r;
    assert.equal(every, `${per} years`);
    assert.equal(doublings, String(36 / per));
    assert.equal(end, `$${dollars(10000 * 2 ** (36 / per))}`);
  });
  unit.levels[5].cards[3].figure.rows.forEach(([rate, rule, exact]) => {
    const r = Number.parseInt(rate, 10);
    assert.equal(rule, `$${dollars(10000 * 2 ** (36 / (72 / r)))}`);
    assert.equal(exact, `$${dollars(Math.round(compound(10000, r / 100, 36)))}`);
  });
  assert.deepEqual(Q.get('ft10-s2-u2-l6-q5').figure.bars.map((b) => b.value), [4, 6, 8, 12].map((r) => 1000000 * 2 ** (36 / (72 / r))));
});

test('outline figures: the class example and the rule examples are quoted as written, and two cells differ on purpose', () => {
  const y = [1, 5, 10, 20, 30];
  assert.deepEqual(y.map((n) => simple(1000, 0.1, n)), OUTLINE.slideSimple.value);
  const mine = y.map((n) => Math.round(compound(1000, 0.1, n)));
  const diffs = mine.map((v, i) => v - OUTLINE.slideCompound.value[i]);
  assert.deepEqual(diffs, [0, 1, 0, -1, 0], 'only year 5 (1,610 on the slide, 1,610.51 rounds to 1,611) and year 20 (6,728 on the slide, 6,727.4999 rounds to 6,727) differ');
  assert.ok(text(4).includes('$17,449') && text(4).includes('$4,000'));
  for (const [r, yrs] of Object.entries(OUTLINE.ruleExamples.value)) assert.equal(72 / Number(r), yrs);
  assert.ok(text(5).includes('72 / 6 = 12 years') && text(5).includes('72 / 8 = 9 years'));
  for (const [r, [per, end]] of Object.entries(OUTLINE.doubling.value)) {
    assert.equal(72 / Number(r), per);
    assert.equal(10000 * 2 ** (36 / per), end);
  }
  assert.equal(Math.round(compound(10000, 0.12, 36)), OUTLINE.exact12.value);
  assert.ok(text(6).includes(money0(OUTLINE.exact12.value * 100)) && text(6).includes('$640,000'));
  assert.equal(Math.round(OUTLINE.doubling.value[12][1] / OUTLINE.doubling.value[4][1]), 16);
  assert.ok(text(6).includes('16 times'));
});

test('the game: monthly interest compounds as the savings module computes it, and the default rate is the one quoted', () => {
  assert.equal(HISA_BP, 275, 'level 6 card 6 says the game starts at 2.75%');
  assert.ok(text(6).includes('2.75%'));
  assert.equal(savings.panels[0].building.key, unit.levels[5].go.building);
  // 12 months of the module's own monthly interest at 6% on a large balance: the yearly factor is about 1.0617
  let bal = 100000000;
  for (let i = 0; i < 12; i++) bal += monthlyInterest(bal, 600);
  const factor = bal / 100000000;
  assert.ok(Math.abs(factor - OUTLINE.monthlyFactor.value) < 0.00005, `monthly factor ${factor}`);
  assert.ok(factor > 1.06, 'more often gives more than the plain rate');
  // each month's interest is figured on the balance that already holds last month's interest
  assert.ok(monthlyInterest(100000000 + monthlyInterest(100000000, 275), 275) > monthlyInterest(100000000, 275));
  assert.ok(text(6).includes('1.0617'));
  assert.ok(Math.abs(Q.get('ft10-s2-u2-l6-q9').answer - (Math.round(1000000 * 1.0617) - 1000000 * 1.06)) < 1e-6);
});

test('choices: the doubling and rate answers match the rule', () => {
  const right = (id) => Q.get(id).options[Q.get(id).answer].text;
  assert.equal(right('ft10-s2-u2-l5-q2'), `${72 / 9} years`);
  assert.equal(right('ft10-s2-u2-l5-q3'), `${72 / 3} years`);
  assert.equal(right('ft10-s2-u2-l5-q4'), `${72 / 4 - 72 / 12} more years`);
  assert.equal(right('ft10-s2-u2-l5-q9'), `About ${72 / 10} years`);
  assert.equal(right('ft10-s2-u2-l6-q2'), `${36 / (72 / 8)} doublings`);
  assert.equal(right('ft10-s2-u2-l6-q4'), `${640000 / 40000} times`);
  assert.equal(right('ft10-s2-u2-l3-q2'), String(1 + 0.06));
  assert.equal(Q.get('ft10-s2-u2-l2-q6').answer, 3);
  assert.equal(simple(1000, 0.1, 15), 2500);
  assert.equal(Q.get('ft10-s2-u2-l3-q7').answer, 3);
  assert.equal(Q.get('ft10-s2-u2-l4-q7').figure.points.findIndex((p) => p.value > 500000), Q.get('ft10-s2-u2-l4-q7').answer);
  assert.equal(Q.get('ft10-s2-u2-l4-q8').figure.bars.findIndex((b) => b.value > 100000), Q.get('ft10-s2-u2-l4-q8').answer);
  assert.equal(Q.get('ft10-s2-u2-l3-q7').figure.bars.findIndex((b) => b.value > 13000), Q.get('ft10-s2-u2-l3-q7').answer);
  assert.equal(Q.get('ft10-s2-u2-l2-q6').figure.points.findIndex((p) => p.value >= 250000), Q.get('ft10-s2-u2-l2-q6').answer);
  assert.equal(Q.get('ft10-s2-u2-l1-q8').figure.bars.findIndex((b) => b.value === 3000), Q.get('ft10-s2-u2-l1-q8').answer);
  assert.equal([4, 6, 8, 12].findIndex((r) => 72 / r === 9), Q.get('ft10-s2-u2-l6-q5').answer);
});
