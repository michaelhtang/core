// Content check for the Learning Road unit "Risk and return" (ft10-s2-u4): game constants are recomputed from modules/exchange/constants.js, every figure quoted
// from Mr. Tang's Lesson 11 outline is pinned to a cited table, every number answer is recomputed from its prompt, and the shape of the unit is checked.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { EVENTS, FUNDS, STOCKS } from '../modules/exchange/constants.js';

const course = JSON.parse(fs.readFileSync(new URL('../modules/learn/content/fintech10.json', import.meta.url), 'utf8'));
const unit = course.sections.flatMap((s) => s.units).find((u) => u.id === 'ft10-s2-u4');
const Q = new Map(unit.levels.flatMap((l) => l.questions).map((q) => [q.id, q]));
const text = (l) => unit.levels[l - 1].cards.map((c) => c.text).join(' ');
const c = (d) => Math.round(d * 100);

// Figures quoted from Mr. Tang's Lesson 11 outline (slide-studio/courses/fintech10/context/claude-project/docs/claude_Lesson 11 Slide Outline Sept 22.md).
const OUTLINE = {
  savingsPct: { value: 1.5, cite: 'Lesson 11 outline line 179 (slide 7: "A savings account pays about 1.5%")' },
  stockUpPct: { value: 8, cite: 'Lesson 11 outline line 179 ("A stock might pay 8%")' },
  stockDownPct: { value: 30, cite: 'Lesson 11 outline line 179 ("or lose 30%")' },
  cashIn: { value: 'a day or two', cite: 'Lesson 11 outline lines 148-149 (index fund and one company\'s stock: cash in 1-2 days)' },
};

test('shape: 7 levels, 4-6 cards, 7-10 questions, ids, outcome codes, one go button', () => {
  assert.ok(unit, 'unit ft10-s2-u4 is in fintech10.json');
  assert.equal(unit.title, 'Risk and return');
  assert.equal(unit.blurb, 'What you can own, how risky each choice is, and four questions to ask first.');
  assert.deepEqual(unit.outcome_codes, ['FIN1010 3.7', 'FIN1010 2.6']);
  assert.equal(unit.levels.length, 7);
  unit.levels.forEach((l, i) => {
    assert.equal(l.id, `ft10-s2-u4-l${i + 1}`);
    assert.ok(l.cards.length >= 4 && l.cards.length <= 6, `${l.id}: ${l.cards.length} cards`);
    assert.ok(l.questions.length >= 7 && l.questions.length <= 10, `${l.id}: ${l.questions.length} questions`);
    assert.ok(l.questions.filter((q) => q.type === 'number').length >= 2, `${l.id}: at least 2 number questions`);
    assert.ok(l.questions.some((q) => q.figure || q.type === 'point'), `${l.id}: at least 1 question with a figure`);
    l.questions.forEach((q, k) => assert.equal(q.id, `${l.id}-q${k + 1}`));
  });
  assert.deepEqual(unit.levels[6].go, { building: 'exchange', label: 'Look at the Exchange' });
  assert.ok(unit.levels.every((l, i) => i === 6 || !l.go));
  assert.ok(!JSON.stringify(unit).includes('"image"'), 'no image fields until the pictures are made');
});

test('game constants: events and "ups and downs" come from modules/exchange/constants.js', () => {
  const crash = EVENTS.crash, scandal = EVENTS.scandal;
  assert.equal(crash.equityPct, -25);
  assert.equal(crash.bondPct, -5);
  assert.equal(scandal.stockPct, -35);
  assert.ok(text(7).includes(`${Math.abs(scandal.stockPct)}%`));
  const q = Q.get('ft10-s2-u4-l7-q7');
  assert.ok(q.prompt.includes(`${Math.abs(crash.equityPct)}%`) && q.prompt.includes(`${Math.abs(crash.bondPct)}%`));
  assert.equal(q.answer, Math.round(c(2000) * Math.abs(crash.equityPct) / 100) + Math.round(c(2000) * Math.abs(crash.bondPct) / 100));
  assert.equal(Q.get('ft10-s2-u4-l7-q6').answer, Math.abs(scandal.stockPct) / 100);   // one of 100 equal parts
  const by = Object.fromEntries([...FUNDS, ...STOCKS].map((s) => [s.ticker, s]));
  const rows = unit.levels[6].cards[5].figure.rows;
  assert.deepEqual(rows.map((r) => r[1]), ['DAAB', 'DAAX', 'CORN', 'CALL'].map((t) => `about ${by[t].sigmaBp / 100}% a year`));
  assert.deepEqual(rows.map((r) => r[0]), ['DAAB', 'DAAX', 'CORN', 'CALL'].map((t) => by[t].name));
  const bars = Q.get('ft10-s2-u4-l7-q8').figure.bars;
  assert.deepEqual(bars.map((b) => b.value), ['DAAB', 'DAAX', 'CORN', 'CALL'].map((t) => by[t].sigmaBp / 100));
  assert.equal(Q.get('ft10-s2-u4-l7-q8').answer, bars.length - 1);
  assert.equal(Math.max(...bars.map((b) => b.value)), by.CALL.sigmaBp / 100);
  assert.deepEqual(FUNDS.map((f) => f.ticker), ['DAAX', 'DAAB', 'DAAG']);   // the three funds level 2 card 4 describes
  assert.equal(by.DAAG.blend.DAAX, 60);
});

test('outline figures: the class example rates and the cash-in time are quoted as written', () => {
  const t = text(5);
  assert.ok(t.includes(`${OUTLINE.savingsPct.value}%`) && t.includes(`${OUTLINE.stockUpPct.value}%`) && t.includes(`${OUTLINE.stockDownPct.value}%`));
  assert.ok(text(4).includes(OUTLINE.cashIn.value));
  assert.equal(Q.get('ft10-s2-u4-l5-q4').answer, Math.round(c(2500) * OUTLINE.stockDownPct.value / 100));
  assert.equal(Q.get('ft10-s2-u4-l5-q6').answer, Math.round(c(2000) * 0.34) - Math.round(c(2000) * OUTLINE.savingsPct.value / 100));
  assert.ok(Q.get('ft10-s2-u4-l5-q6').prompt.includes(`${OUTLINE.savingsPct.value}%`));
});

test('arithmetic: every number answer is recomputed from its prompt', () => {
  const years = [-30, 4, 12, 34];
  assert.ok(text(5).includes(`${years.reduce((a, b) => a + b, 0) / 4}%`), 'card 3 states the average of the four years');
  const prices = [100, 80, 50, 100];
  const unitsEnd = prices.reduce((a, p) => a + 100 / p, 0);
  const want = {
    'ft10-s2-u4-l1-q3': c(800) * 0.05,
    'ft10-s2-u4-l1-q4': c(40000) * 0.02,
    'ft10-s2-u4-l1-q6': c(40000) * 0.02 - c(30000) * 0.02,
    'ft10-s2-u4-l2-q7': c(2000) * 0.01,
    'ft10-s2-u4-l2-q8': c(1000) / 200,
    'ft10-s2-u4-l3-q8': ((1000 - 700) / 1000) * 100,
    'ft10-s2-u4-l3-q10': (150 / 1000) * 100,
    'ft10-s2-u4-l4-q6': ((40 - 10) / 40) * 100,
    'ft10-s2-u4-l4-q7': c(1800) - c(900),
    'ft10-s2-u4-l5-q3': [-18, 6, 14, 30].reduce((a, b) => a + b, 0) / 4,
    'ft10-s2-u4-l5-q4': c(2500) * 0.3,
    'ft10-s2-u4-l5-q5': ((864 - 800) / 800) * 100,
    'ft10-s2-u4-l5-q6': c(2000) * 0.34 - c(2000) * 0.015,
    'ft10-s2-u4-l5-q10': Math.round(((1000 - 700) / 700) * 1000) / 10,
    'ft10-s2-u4-l6-q6': c(4000) - c(100) * 36,
    'ft10-s2-u4-l6-q7': (1500 / 5000) * 100,
    'ft10-s2-u4-l7-q2': c(120 * 10) - c(90 * 10),
    'ft10-s2-u4-l7-q3': ((1200 - 900) / 1200) * 100,
    'ft10-s2-u4-l7-q4': Math.round(unitsEnd * 100 * 100),
    'ft10-s2-u4-l7-q6': 0.35,
    'ft10-s2-u4-l7-q7': c(2000) * 0.25 + c(2000) * 0.05,
  };
  const numbers = [...Q.values()].filter((q) => q.type === 'number').map((q) => q.id);
  assert.deepEqual(Object.keys(want).sort(), numbers.sort(), 'every number question is covered by this test');
  for (const [id, v] of Object.entries(want)) assert.ok(Math.abs(Q.get(id).answer - v) < 1e-6, `${id}: stored ${Q.get(id).answer}, recomputed ${v}`);
  assert.equal(unitsEnd, 5.25);
  // point questions: the keyed bar is the right one
  const bars = (id) => Q.get(id).figure.bars;
  assert.equal(bars('ft10-s2-u4-l1-q7')[Q.get('ft10-s2-u4-l1-q7').answer].value, c(50000) * 0.02);
  assert.equal(bars('ft10-s2-u4-l2-q9')[Q.get('ft10-s2-u4-l2-q9').answer].value, c(2000) * 0.045);
  const sw = bars('ft10-s2-u4-l3-q9');
  assert.equal(sw[Q.get('ft10-s2-u4-l3-q9').answer].value, Math.max(...sw.map((b) => b.value)));
  const held = bars('ft10-s2-u4-l4-q8');   // the biggest amount that is neither the locked GIC nor the property: savings $900, index fund $1,500
  assert.deepEqual(held.map((b) => b.value), [c(900), c(1500), c(2000), c(6000)]);
  assert.equal(Q.get('ft10-s2-u4-l4-q8').answer, 1);
  const f5 = bars('ft10-s2-u4-l5-q7');
  assert.equal(Q.get('ft10-s2-u4-l5-q7').answer, f5.findIndex((b) => b.value < c(1000)));
  assert.equal(f5.filter((b) => b.value < c(1000)).length, 1);
  const f6 = bars('ft10-s2-u4-l6-q8');
  assert.equal(Q.get('ft10-s2-u4-l6-q8').answer, f6.findIndex((b) => b.value === Math.max(...f6.map((x) => x.value))));
});
