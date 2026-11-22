// Content check for "Costs and break-even" (ft2030-s2-u2). No game module is involved: every figure is arithmetic on made-up
// businesses, recomputed here from first principles. The class example (Jo) comes from Mr. Tang's outline, cited below.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const course = JSON.parse(fs.readFileSync(new URL('../modules/learn/content/fintech2030.json', import.meta.url), 'utf8'));
const unit = course.sections.flatMap((s) => s.units).find((u) => u.id === 'ft2030-s2-u2');
const [L1, L2, L3] = unit.levels;
const Q = new Map(unit.levels.flatMap((l) => l.questions).map((x) => [x.id, x]));
const q = (n) => Q.get(`ft2030-s2-u2-${n}`);
const right = (n) => q(n).options[q(n).answer].text;
const D = (c) => `$${(c / 100).toLocaleString('en-CA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const up = (a, b) => Math.ceil(a / b - 1e-9);

// Outline "2026-09-16 Lesson 6.md" (slide figures in dollars): line 59 margin, line 69 break-even, line 71 49/51, line 81 per day.
const OUTLINE = { price: 3.0, varCost: 1.1, margin: 1.9, fixed: 95, units: 50, perDay5: 5, units400: 400, perDay40: 40, days: 10 };
test('outline figures (Lesson 6 lines 59, 69, 71, 81) recompute', () => {
  assert.equal(Math.round((OUTLINE.price - OUTLINE.varCost) * 100), OUTLINE.margin * 100);
  assert.equal(OUTLINE.fixed / OUTLINE.margin, OUTLINE.units);
  assert.equal(OUTLINE.units / OUTLINE.days, OUTLINE.perDay5);
  assert.equal(OUTLINE.units400 / OUTLINE.days, OUTLINE.perDay40);
});

test('shape and counts', () => {
  assert.equal(unit.title, 'Costs and break-even');
  assert.deepEqual(unit.outcome_codes, ['ENT2020 3.2', 'ENT2020 3.3']);
  assert.equal(unit.levels.length, 3);
  unit.levels.forEach((l, i) => {
    assert.equal(l.id, `ft2030-s2-u2-l${i + 1}`);
    assert.ok(l.cards.length >= 4 && l.cards.length <= 6 && l.questions.length >= 7 && l.questions.length <= 10);
    l.questions.forEach((x, k) => assert.equal(x.id, `${l.id}-q${k + 1}`));
    assert.ok(l.questions.filter((x) => x.type === 'number').length >= 2);
    assert.ok(l.questions.some((x) => x.figure) || l.cards.some((c) => c.figure));
    for (const c of l.cards) if (c.figure?.kind === 'table') assert.ok(c.figure.columns.length <= 4);
    assert.equal(l.go, undefined);
  });
  assert.ok(!JSON.stringify(unit).includes('"image"'));
});

test('level 1: Mei, fixed 80, unit cost 1.40, total cost', () => {
  const fixed = 4000 + 2500 + 1500, unitCost = 90 + 30 + 20, total = (n) => fixed + unitCost * n;
  assert.equal(q('l1-q3').answer, 3500 + 2000 + 1200); // Ravi's fixed costs, not Mei's
  assert.equal(q('l1-q4').answer, 85 + 15 + 60); // a candle's unit cost, not Mei's
  assert.equal(q('l1-q6').answer, total(30));
  assert.deepEqual(L1.cards[5].figure.rows, [0, 20, 40].map((n) => [String(n), D(unitCost * n), D(total(n))]));
  assert.deepEqual(q('l1-q8').figure.bars.map((b) => b.value), [0, 10, 20, 30, 40].map(total));
  assert.equal(q('l1-q8').answer, 2);
  assert.equal(right('l1-q7'), `${D(fixed)}, her fixed costs`);
  assert.ok(L1.cards[3].text.includes(D(unitCost)));
  assert.ok(right('l1-q9').startsWith('The price is below the unit cost'));
  assert.ok(q('l1-q9').prompt.includes(D(120)) && q('l1-q9').prompt.includes(D(140)));
});

test('level 2: Jo, margin, break-even, check table, rounding, Ana', () => {
  const fixed = 6000 + 2000 + 1500, price = 300, unitCost = 110, m = price - unitCost;
  assert.equal(fixed, OUTLINE.fixed * 100);
  assert.equal(m, OUTLINE.margin * 100);
  const be = up(fixed, m);
  assert.equal(be, OUTLINE.units);
  assert.equal(q('l2-q1').answer, 350 - 130); // winter fair hot chocolate
  assert.equal(q('l2-q2').answer, 5500 + 1800 + 1200);
  assert.equal(right('l2-q3'), `${be} cups`);
  const res = (n) => n * m - fixed;
  assert.equal(res(49), -190);
  assert.equal(res(51), 190);
  assert.equal(res(50), 0);
  assert.equal(q('l2-q5').answer, res(54));
  assert.equal(q('l2-q6').answer, -res(45));
  assert.equal(q('l2-q9').answer, up(10000, 400 - 150) * 400); // Ana at break-even
  const row = (n) => [String(n), D(n * price), D(fixed + n * unitCost), res(n) === 0 ? 'Even' : res(n) > 0 ? `${D(res(n))} profit` : `${D(-res(n))} short`];
  assert.deepEqual(L2.cards[3].figure.rows, [49, 50, 51].map(row));
  assert.equal(right('l2-q7'), `${up(10000, 400 - 150)} bookmarks`);
  assert.equal(up(10000, 250), 40);
  assert.equal(right('l2-q8'), `${up(9500, 200)} items`);
  assert.equal(up(9500, 200), 48);
  assert.equal(9500 / 200, 47.5);
  assert.equal(right('l2-q10'), 'No number of pins works'); // Noor: $2.00 - $2.00 = $0.00 margin
  const wrong = q('l2-q3').options.map((o) => o.text).filter((t) => t !== right('l2-q3'));
  assert.deepEqual(new Set(wrong), new Set([`${up(fixed, price)} cups`, `${up(fixed, unitCost)} cups`, `${fixed / 100} cups`]));
});

test('level 3: per day, price and cost changes, three results, unsold cups', () => {
  const fixed = 9500, price = 300, unitCost = 110, m = price - unitCost, be = (p, c = unitCost, f = fixed) => up(f, p - c);
  assert.equal(right('l3-q1'), `${be(price) / 5} cups a day`);
  assert.equal(be(price) / 5, 10);
  const bakerBE = up(36000, 250 - 160);
  assert.equal(bakerBE, OUTLINE.units400);
  assert.equal(right('l3-q2'), `${bakerBE / OUTLINE.days} loaves a day`);
  assert.equal(q('l3-q3').answer, (30 / 50) * 100);
  assert.equal(q('l3-q4').answer, 275 - unitCost);
  assert.equal(right('l3-q5'), `${be(250)} cups`);
  assert.equal(be(250), 68);
  assert.equal(right('l3-q6'), `${be(price, 140)} cups`);
  assert.equal(be(price, 140), 60);
  assert.equal(up(11000, m), 58);
  assert.deepEqual(L3.cards[2].figure.rows, [300, 250, 200, 150].map((p) => [D(p), D(p - unitCost), String(be(p))]));
  const res = (n) => n * m - fixed;
  assert.equal(q('l3-q7').answer, -res(30));
  assert.equal(q('l3-q8').answer, res(90));
  assert.equal(res(90), 7600);
  assert.deepEqual(L3.cards[4].figure.rows, [['Half the plan', '40', `${D(-res(40))} short`], ['The plan', '80', `${D(res(80))} profit`], ['Half as much again', '120', `${D(res(120))} profit`]]);
  assert.equal(q('l3-q9').answer, (90 - 65) * unitCost);
  assert.equal((80 - 60) * unitCost, 2200); // card 6 case
  assert.deepEqual(q('l3-q10').figure.bars.map((b) => b.value), [15000, 17000, 21200, 35700]);
  assert.deepEqual(q('l3-q10').figure.bars.map((b) => b.value), [300, 250, 200, 150].map((p) => be(p) * p));
  assert.equal(q('l3-q10').answer, 3);
});
