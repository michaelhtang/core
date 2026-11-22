// Content check for the Learning Road unit "Lending your money" (ft2030-s3-u3): bond and lending arithmetic is recomputed here,
// outline figures are pinned to a cited table, the savings facts come from modules/savings, and the shape is checked.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { HISA_BP, GIC_TERMS, GIC_MIN_CENTS } from '../modules/savings/constants.js';

const course = JSON.parse(fs.readFileSync(new URL('../modules/learn/content/fintech2030.json', import.meta.url), 'utf8'));
const unit = course.sections.flatMap((s) => s.units).find((u) => u.id === 'ft2030-s3-u3');
const Q = new Map(unit.levels.flatMap((l) => l.questions).map((q) => [q.id, q]));
const money = (c) => `$${(c / 100).toLocaleString('en-CA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const text = (l) => unit.levels[l - 1].cards.map((c) => c.text).join(' ') + JSON.stringify(unit.levels[l - 1].cards.map((c) => c.figure ?? ''));
const cents = (d) => Math.round(d * 100);
// bond price, annual coupons: each payment divided by (1 + yield) once per year it waits
const price = (face, cpn, y, n) => { let s = 0; for (let t = 1; t <= n; t++) s += (face * cpn) / (1 + y) ** t; return { coupons: s, face: face / (1 + y) ** n, total: s + face / (1 + y) ** n }; };

const OUT = 'slide-studio/courses/fintech2030/context/claude-project/docs/claude_Fintech 2030 Lesson 22 - Wednesday Oct 14.md';
const OUTLINE = {
  price5at6: { value: 915.75, cite: `${OUT} line 173 (and 192, 202): the 5-year 4% bond at a 6% market yield` },
  price10at6: { value: 852.8, cite: `${OUT} line 202 (and 239): the 10-year bond at 6%` },
  price5at2: { value: 1094.27, cite: `${OUT} line 240: the 5-year bond at 2%` },
  annualCoupons: { value: 'annual', cite: `${OUT} line 205: the Machine uses a 5-year bond with annual coupons` },
};

test('shape: 3 levels, 4-6 cards, 7-10 questions, ids, outcome codes, one go button, no pictures yet', () => {
  assert.ok(unit, 'unit ft2030-s3-u3 is in fintech2030.json');
  assert.equal(unit.title, 'Lending your money');
  assert.equal(unit.blurb, 'Savings accounts, GICs, T-bills and bonds, and why bond prices move.');
  assert.deepEqual(unit.outcome_codes, ['FIN3080 1.8', 'FIN3080 1.9', 'FIN3080 1.10', 'FIN3080 1.15', 'FIN3080 1.16']);
  assert.equal(unit.levels.length, 3);
  unit.levels.forEach((l, i) => {
    assert.equal(l.id, `ft2030-s3-u3-l${i + 1}`);
    assert.ok(l.cards.length >= 4 && l.cards.length <= 6, `${l.id}: ${l.cards.length} cards`);
    assert.ok(l.questions.length >= 7 && l.questions.length <= 10, `${l.id}: ${l.questions.length} questions`);
    assert.ok(l.questions.filter((q) => q.type === 'number').length >= 2, `${l.id}: at least 2 number questions`);
    assert.ok(l.questions.some((q) => q.figure), `${l.id}: at least 1 question with a figure`);
    l.questions.forEach((q, k) => assert.equal(q.id, `${l.id}-q${k + 1}`));
  });
  assert.ok(!JSON.stringify(unit).includes('"image"'), 'no image fields yet');
  assert.deepEqual(unit.levels[1].go, { building: 'networth', label: 'Open Net Worth' });
  assert.ok(unit.levels.every((l, i) => i === 1 || !l.go));
  assert.ok(!/100,000/.test(JSON.stringify(unit)), 'no deposit insurance dollar amount (the outline flags it)');
});

test('outline figures: the bond prices recompute to the class example', () => {
  const p5 = price(1000, 0.04, 0.06, 5), p10 = price(1000, 0.04, 0.06, 10), p5low = price(1000, 0.04, 0.02, 5);
  assert.equal(cents(p5.total), cents(OUTLINE.price5at6.value));
  assert.equal(cents(p10.total), cents(OUTLINE.price10at6.value));
  assert.equal(cents(p5low.total), cents(OUTLINE.price5at2.value));
  assert.equal(cents(p5.coupons) + cents(p5.face), cents(p5.total), 'the two table rows add to the price');
  assert.equal(OUTLINE.annualCoupons.value, 'annual');
  const l3 = text(3);
  for (const v of [cents(p5.total), cents(p10.total), cents(p5.coupons), cents(p5.face)]) assert.ok(l3.includes(money(v)), `level 3 shows ${money(v)}`);
  assert.ok(Q.get('ft2030-s3-u3-l3-q5').prompt.includes(money(cents(p5low.total))));
  assert.ok(/once a year/.test(l3), 'level 3 says coupons come once a year');
});

test('arithmetic: every number answer is recomputed from its prompt', () => {
  const one = (face, cpn, y) => (face * (1 + cpn)) / (1 + y);
  const want = {
    'ft2030-s3-u3-l1-q3': cents(4000 * 0.03),
    'ft2030-s3-u3-l1-q4': cents(1000) - cents(980),
    'ft2030-s3-u3-l1-q5': cents(5000 * 0.03),
    'ft2030-s3-u3-l1-q7': cents(1000 * 0.04 * 5),
    'ft2030-s3-u3-l2-q6': cents(1500 * 0.06) - cents(1500 * 0.04),
    'ft2030-s3-u3-l2-q8': (cents(2000 * 0.06) - cents(2000 * 0.04)) * 5,
    'ft2030-s3-u3-l3-q3': cents(one(1000, 0.03, 0.06)),
    'ft2030-s3-u3-l3-q4': cents(1000) - cents(price(1000, 0.04, 0.06, 10).total),
    'ft2030-s3-u3-l3-q7': cents(one(1000, 0.04, 0.02)),
    'ft2030-s3-u3-l3-q9': cents(1000 * 0.04 * 5 + 1000),
  };
  for (const [id, v] of Object.entries(want)) {
    assert.ok(Q.has(id), id);
    assert.equal(Q.get(id).type, 'number');
    assert.equal(Q.get(id).answer, v, `${id} answer`);
    assert.equal(Q.get(id).unit, '$');
    assert.ok(Q.get(id).working.includes(money(v)), `${id} working shows ${money(v)}`);
  }
  assert.equal([...Q.values()].filter((q) => q.type === 'number').length, Object.keys(want).length, 'every number question is checked');
  assert.ok(text(3).includes(money(want['ft2030-s3-u3-l3-q4'] * 0 + cents(one(1000, 0.04, 0.06)))), 'the one-year worked price is on the card');
  for (const [id, v] of Object.entries(want)) {
    const lvl = Number(id.match(/-l(\d)-/)[1]);
    assert.ok(!text(lvl).includes(money(v)), `${id}: answer ${money(v)} is written on a card of its level`);
  }
});

test('point questions and figures', () => {
  const a = Q.get('ft2030-s3-u3-l1-q6');
  assert.equal(a.figure.bars[a.answer].value * 0.03, 6000, 'a $2,000 face at 3% is $60');
  const q = Q.get('ft2030-s3-u3-l2-q7');
  assert.equal(q.figure.bars[q.answer].label, '4%');
  assert.equal(q.figure.bars[q.answer].value, cents(1000 * 0.04));
  const r = Q.get('ft2030-s3-u3-l3-q6');
  const v = r.figure.bars.map((b) => b.value);
  assert.equal(r.answer, v.indexOf(Math.min(...v)));
  assert.deepEqual(v, [100000, cents(price(1000, 0.04, 0.06, 5).total), cents(price(1000, 0.04, 0.06, 10).total)]);
});

test('the game: savings facts come from modules/savings', () => {
  assert.equal(HISA_BP, 275);
  const t = text(2);
  assert.ok(t.includes('2.75%'), 'level 2 says the game starts at 2.75%');
  assert.ok(t.includes(money(GIC_MIN_CENTS)), 'minimum GIC');
  assert.deepEqual(Object.keys(GIC_TERMS).map(Number), [12, 36, 60]);
  assert.ok(t.includes('12, 36 or 60 months'));
});
