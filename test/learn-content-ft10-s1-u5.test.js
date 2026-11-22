// Content check for the Learning Road unit "Budget methods" (ft10-s1-u5): the pay figures are recomputed from modules/jobs/payroll.js,
// every figure quoted from Mr. Tang's outlines is pinned to a cited table, and the shape (levels, cards, questions) is checked.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { payStub } from '../modules/jobs/payroll.js';

const course = JSON.parse(fs.readFileSync(new URL('../modules/learn/content/fintech10.json', import.meta.url), 'utf8'));
const unit = course.sections.flatMap((s) => s.units).find((u) => u.id === 'ft10-s1-u5');
const Q = new Map(unit.levels.flatMap((l) => l.questions).map((q) => [q.id, q]));
const money = (c) => `$${(c / 100).toLocaleString('en-CA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const money0 = (c) => `$${Math.round(c / 100).toLocaleString('en-CA')}`;
const pct = (a, b) => Math.round((a / b) * 1000) / 10;
const text = (l) => unit.levels[l - 1].cards.map((c) => c.text).join(' ');

// Figures quoted from Mr. Tang's Lesson 6 outline (slide-studio/courses/fintech10/context/claude-project/docs/claude_Lesson 6 Slide Outline Sept 14.md).
const OUTLINE = {
  needsAloneCents: { value: 220300, cite: 'Lesson 6 outline line 163 (table row "1-bedroom alone + transit", needs $2,203)' },
  needsRoommateCents: { value: 169600, cite: 'Lesson 6 outline line 164 (table row "Roommate + transit", needs $1,696)' },
  shares: { value: [50, 30, 20], cite: 'Lesson 6 outline lines 148 and 150-152 (50% needs, 30% wants, 20% savings and debt)' },
};

// The game's own pay stub: gross $2,600.00 a month (full time, general minimum wage, 52 weeks / 12 months).
const S = payStub({ grossCents: 260000, period: 1 });
const NET = S.net, GROSS = S.gross;
const dollar = (c) => Math.round(c / 100) * 100;
const A = OUTLINE.needsAloneCents.value, R = OUTLINE.needsRoommateCents.value;

test('shape: 7 levels, 4-6 cards, 7-10 questions, ids, outcome codes, one go button', () => {
  assert.ok(unit, 'unit ft10-s1-u5 is in fintech10.json');
  assert.equal(unit.title, 'Budget methods');
  assert.equal(unit.blurb, 'Four ways to budget: 50/30/20, zero-based, envelopes and pay yourself first.');
  assert.deepEqual(unit.outcome_codes, ['FIN1010 2.5', 'FIN1010 3.5.5', 'FIN1010 4.3']);
  assert.equal(unit.levels.length, 7);
  unit.levels.forEach((l, i) => {
    assert.equal(l.id, `ft10-s1-u5-l${i + 1}`);
    assert.ok(l.cards.length >= 4 && l.cards.length <= 6, `${l.id}: ${l.cards.length} cards`);
    assert.ok(l.questions.length >= 7 && l.questions.length <= 10, `${l.id}: ${l.questions.length} questions`);
    assert.ok(l.questions.filter((q) => q.type === 'number').length >= 2, `${l.id}: at least 2 number questions`);
    assert.ok(l.questions.some((q) => q.figure), `${l.id}: at least 1 question with a figure`);
    l.questions.forEach((q, k) => assert.equal(q.id, `${l.id}-q${k + 1}`));
  });
  assert.deepEqual(unit.levels[5].go, { building: 'networth', label: 'Open Net Worth' });
  assert.ok(unit.levels.every((l, i) => i === 5 || !l.go));
  assert.ok(!/sixty percent|60 percent|quiz|Budgeting Pro|Savings Guru|Debt Slayer|Credit Champion/i.test(JSON.stringify(unit)), 'no slide-16 types and no invented effectiveness figure');
});

test('pay figures: every number that depends on the game pay stub is recomputed from payroll.js', () => {
  assert.equal(GROSS, 260000);
  assert.equal(NET, 224905, 'the pay unit teaches $2,249.05 for $2,600.00 gross');
  assert.equal(Q.get('ft10-s1-u5-l1-q5').answer, GROSS - NET);
  assert.equal(Q.get('ft10-s1-u5-l1-q6').answer, pct(NET, GROSS));
  assert.equal(Q.get('ft10-s1-u5-l2-q7').answer, dollar(NET * 0.2));
  assert.equal(Q.get('ft10-s1-u5-l3-q4').answer, pct(A, NET));
  assert.equal(Q.get('ft10-s1-u5-l3-q5').answer, pct(R, NET));
  for (const f of [unit.levels[0].cards[2].figure, Q.get('ft10-s1-u5-l1-q5').figure]) {
    assert.deepEqual(f.lines.map((l) => l.cents), [S.gross, S.cpp, S.ei, S.federalTax, S.albertaTax, S.net]);
  }
  assert.ok(text(1).includes(money(NET)));
  const rows = unit.levels[1].cards[3].figure.rows.map((r) => r[2]);
  assert.deepEqual(rows, [0.5, 0.3, 0.2].map((p) => money0(dollar(NET * p))));
  assert.ok(unit.levels[1].cards[3].text.includes(money(NET)));
  const t3 = text(3);
  assert.ok(t3.includes(`${Math.round(pct(A, NET))}%`) && t3.includes(`${pct(R, NET)}%`) && t3.includes(money(NET)));
  assert.equal(Q.get('ft10-s1-u5-l3-q7').figure.bars[2].value, dollar(NET * 0.5));
  assert.ok(unit.levels[5].cards[4].text.includes(money(NET - 22500)));
});

test('outline figures: the class needs totals are quoted as written, the take-home needed is double them', () => {
  assert.equal(OUTLINE.needsAloneCents.value, 220300);
  assert.equal(OUTLINE.needsRoommateCents.value, 169600);
  assert.deepEqual(OUTLINE.shares.value, [50, 30, 20]);
  const t = unit.levels[2];
  assert.deepEqual(t.cards[1].figure.rows.map((r) => r[1]), [money0(A), money0(R)]);
  assert.deepEqual(t.cards[2].figure.rows.map((r) => r.slice(1)), [[money0(A), money0(A * 2)], [money0(R), money0(R * 2)]]);
  assert.equal(Q.get('ft10-s1-u5-l3-q1').answer, A * 2);
  assert.equal(Q.get('ft10-s1-u5-l3-q2').answer, R * 2);
  assert.equal(Q.get('ft10-s1-u5-l3-q3').answer, A * 2 - R * 2);
  assert.ok(t.cards[4].text.includes(money0(A * 2 - R * 2)));
  assert.ok(!/70,200|51,600|3,391/.test(JSON.stringify(unit)), 'the slides\' gross salary column and rounded take-home are not quoted');
});

test('arithmetic: every number answer is recomputed from its prompt', () => {
  const jobs = [80000, 32000, 9000, 5500, 15000, 30000, 12000];
  const tomas = 210000 - jobs.reduce((a, b) => a + b, 0);
  const mia = [0, 4000, 0, 1500, 0, 2500];
  const miaTotal = mia.reduce((a, b) => a + b, 0);
  const want = {
    'ft10-s1-u5-l1-q5': GROSS - NET,
    'ft10-s1-u5-l1-q6': pct(NET, GROSS),
    'ft10-s1-u5-l1-q7': Math.round((4000 * 52) / 12 / 100) * 100,
    'ft10-s1-u5-l2-q5': 240000 / 2,
    'ft10-s1-u5-l2-q6': Math.round(180000 * 0.3),
    'ft10-s1-u5-l2-q7': dollar(NET * 0.2),
    'ft10-s1-u5-l2-q8': 60000 - (31000 + 8500 + 14000),
    'ft10-s1-u5-l3-q1': A * 2,
    'ft10-s1-u5-l3-q2': R * 2,
    'ft10-s1-u5-l3-q3': A * 2 - R * 2,
    'ft10-s1-u5-l3-q4': pct(A, NET),
    'ft10-s1-u5-l3-q5': pct(R, NET),
    'ft10-s1-u5-l3-q9': 154000 - 260000 / 2,
    'ft10-s1-u5-l4-q2': tomas,
    'ft10-s1-u5-l4-q3': tomas - 10000,
    'ft10-s1-u5-l4-q6': 190000 - (75000 + 28000 + 6000 + 20000 + 11000),
    'ft10-s1-u5-l4-q9': 164000 - 150000,
    'ft10-s1-u5-l5-q3': 10000 - 6450,
    'ft10-s1-u5-l5-q4': 30000 / 5,
    'ft10-s1-u5-l5-q5': 30000 + 10000 + 6000,
    'ft10-s1-u5-l5-q9': 30000 - (8730 + 6415 + 5280),
    'ft10-s1-u5-l6-q3': 190000 - 19000,
    'ft10-s1-u5-l6-q4': 12000 * 12,
    'ft10-s1-u5-l6-q5': pct(30000, 200000),
    'ft10-s1-u5-l6-q7': miaTotal,
    'ft10-s1-u5-l6-q8': 6 * 5000 - miaTotal,
    'ft10-s1-u5-l7-q7': 240000 - (36000 + 15000 + 32000),
    'ft10-s1-u5-l7-q8': 142000 - 260000 / 2,
  };
  const numbers = [...Q.values()].filter((q) => q.type === 'number').map((q) => q.id);
  assert.deepEqual(Object.keys(want).sort(), numbers.sort(), 'every number question is covered by this test');
  for (const [id, v] of Object.entries(want)) assert.equal(Q.get(id).answer, v, `${id}: stored answer equals the recomputed value`);
  assert.equal(unit.levels[3].cards[2].figure.rows.at(-1)[1], money(tomas));
  assert.deepEqual(Q.get('ft10-s1-u5-l6-q6').figure.bars.map((b) => b.value), mia);
  assert.equal(Q.get('ft10-s1-u5-l6-q6').answer, mia.indexOf(Math.max(...mia)));
  const steps = Q.get('ft10-s1-u5-l7-q9').figure.bars.map((b) => b.value);
  assert.deepEqual(steps, [200000, 170000, 142000, 130000]);
  assert.deepEqual(steps.map((v, i) => (v < 150000 && v > 135000 ? i : -1)).filter((i) => i >= 0), [Q.get('ft10-s1-u5-l7-q9').answer], 'exactly one bar is in range');
});
