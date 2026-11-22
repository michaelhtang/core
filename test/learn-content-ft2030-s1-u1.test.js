// Content check for the Learning Road unit "Kinds of taxes" (ft2030-s1-u1): every number answer is recomputed from modules/learn/companies/tax-facts.js.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { SALES, CAPITAL_GAINS, KINDS, INHERITANCE } from '../modules/learn/companies/tax-facts.js';

const course = JSON.parse(fs.readFileSync(new URL('../modules/learn/content/fintech2030.json', import.meta.url), 'utf8'));
const unit = course.sections.flatMap((s) => s.units).find((u) => u.id === 'ft2030-s1-u1');
const Q = new Map(unit.levels.flatMap((l) => l.questions).map((q) => [q.id, q]));
const money = (c) => `$${(c / 100).toLocaleString('en-CA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const tax = (cents, pct) => (cents * pct) / 100;
const GST = SALES.gstRate.value, ON = SALES.hst.ON.value, NS = SALES.hst.NS.value, BC = SALES.pst.BC.value, SK = SALES.pst.SK.value, INC = CAPITAL_GAINS.inclusionRate2025.value * 100;
const text = (l) => unit.levels[l - 1].cards.map((c) => c.text).join(' ');

test('shape: 3 levels, 4-6 cards, 7-10 questions, outcome code, no pictures', () => {
  assert.equal(unit.levels.length, 3);
  assert.deepEqual(unit.outcome_codes, ['FIN2060 1.1']);
  for (const l of unit.levels) { assert.ok(l.cards.length >= 4 && l.cards.length <= 6); assert.ok(l.questions.length >= 7 && l.questions.length <= 10); assert.equal(l.go, undefined); }
  assert.equal(unit.levels.flatMap((l) => l.cards).length, 17);
  assert.equal(Q.size, 27);
});

test('every number answer is recomputed from tax-facts.js', () => {
  const want = {
    'ft2030-s1-u1-l2-q3': tax(6000, GST),
    'ft2030-s1-u1-l2-q5': BC + GST,
    'ft2030-s1-u1-l2-q6': tax(8000, ON),
    'ft2030-s1-u1-l2-q7': tax(8000, ON) - tax(8000, GST),
    'ft2030-s1-u1-l2-q9': tax(20000, SK),
    'ft2030-s1-u1-l3-q3': 180000 - 125000,
    'ft2030-s1-u1-l3-q4': INC,
    'ft2030-s1-u1-l3-q5': tax(180000 - 125000, INC),
    'ft2030-s1-u1-l3-q6': tax(240000 - 150000, INC),
    'ft2030-s1-u1-l3-q10': tax(12000, GST),
  };
  for (const [id, v] of Object.entries(want)) { assert.ok(Q.has(id), id); assert.equal(Q.get(id).answer, v, id); }
  assert.equal(Object.keys(want).length, [...Q.values()].filter((q) => q.type === 'number').length);
});

test('figures and cards quote the facts file', () => {
  const rates = unit.levels[1].cards[1].figure.rows;
  assert.deepEqual(rates.map((r) => r[1]), [SALES.hst.NB, SALES.hst.NL, SALES.hst.NS, SALES.hst.ON, SALES.hst.PE].map((f) => `${f.value}%`));
  assert.deepEqual(unit.levels[1].cards[2].figure.rows.map((r) => r.slice(1)), [[`${GST}%`, `${SALES.albertaPstRate.value}%`], ...[SALES.pst.BC, SALES.pst.MB, SALES.pst.QC, SALES.pst.SK].map((f) => [`${GST}%`, `${f.value}%`])]);
  const bars = Q.get('ft2030-s1-u1-l2-q8').figure.bars;
  assert.deepEqual(bars.map((b) => b.value), [GST, ON, NS, SALES.hst.NB.value].map((p) => tax(10000, p)));
  assert.equal(bars[Q.get('ft2030-s1-u1-l2-q8').answer].label, 'Nova Scotia');
  const l3 = Q.get('ft2030-s1-u1-l3-q8'); const gain = 120000 - 80000;
  assert.deepEqual(l3.figure.bars.map((b) => b.value), [120000, 80000, gain, tax(gain, INC)]);
  assert.equal(l3.answer, 3);
  assert.ok(text(3).includes(`${INC}%`) && text(3).includes('2025'));
  assert.ok(text(2).includes(money(tax(8000, ON) - tax(8000, GST))));
});

test('wording follows the quotes: excise taxes name vehicles and fuels, capital gain names selling costs, death has no gain claim', () => {
  const dump = JSON.stringify(unit.levels[0]);
  assert.ok(KINDS.exciseTaxes.quote.includes('fuel-inefficient vehicles') && KINDS.exciseFuels.quote.includes('gasoline'));
  assert.ok(unit.levels[0].cards[3].text.includes('fuel-inefficient vehicles') && unit.levels[0].cards[3].text.includes('gasoline, diesel fuel'));
  assert.ok(!dump.includes('Fuels such as'));
  const l3 = unit.levels[2];
  assert.ok(CAPITAL_GAINS.gain.quote.includes('the total of its ACB and the outlays and expenses incurred to sell'));
  assert.ok(l3.cards[1].text.includes('the total of its adjusted cost base (ACB) and the outlays and expenses incurred to sell it') && l3.cards[1].text.includes('nothing was spent to sell'));
  assert.ok(!JSON.stringify(l3).includes('final return') && !JSON.stringify(l3).includes('can create'));
  assert.ok(INHERITANCE.deemedDisposition.quote.includes('considered to have sold all their property') && l3.cards[5].text.includes('considered to have sold all their property just before death'));
});
