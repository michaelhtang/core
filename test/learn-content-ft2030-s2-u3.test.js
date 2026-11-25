// Content check for "From data to paperwork" (ft2030-s2-u3). No game module is involved: every figure is arithmetic on made-up
// businesses, recomputed here from first principles. Outline figures are cited below with file and line.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const course = JSON.parse(fs.readFileSync(new URL('../modules/learn/content/fintech2030.json', import.meta.url), 'utf8'));
const section = course.sections.find((s) => s.id === 'ft2030-s2');
const unit = section.units.find((u) => u.id === 'ft2030-s2-u3');
const [L1, L2, L3] = unit.levels;
const Q = new Map(unit.levels.flatMap((l) => l.questions).map((x) => [x.id, x]));
const q = (n) => Q.get(`ft2030-s2-u3-${n}`);
const right = (n) => q(n).options[q(n).answer].text;
const D = (c) => `$${(c / 100).toLocaleString('en-CA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const up = (a, b) => Math.ceil(a / b - 1e-9);
const pct = (a, b) => (a / b) * 100;

// Outline figures (dollars), with the file and line they come from.
//   "2026-09-17 Lesson 7.md" line 34: $2.50 becomes $2 or $3; $3.75 becomes $3 or $4 (a whole-dollar price).
//   "2026-09-17 Lesson 7.md" line 58: $400 of payment units go out, $310 come back, $90 are still out.
//   "2026-09-18 Lesson 8.md" line 82: a venture raises $300 and nets $40, so it spent $260.
const OUTLINE = { l7_34: [[2.5, 2, 3], [3.75, 3, 4]], l7_58: { out: 400, back: 310, still: 90 }, l8_82: { raised: 300, net: 40, spent: 260 } };
test('outline figures (Lesson 7 lines 34 and 58, Lesson 8 line 82) recompute', () => {
  for (const [p, lo, hi] of OUTLINE.l7_34) { assert.equal(Math.floor(p), lo); assert.equal(Math.ceil(p), hi); }
  assert.equal(OUTLINE.l7_58.out - OUTLINE.l7_58.back, OUTLINE.l7_58.still);
  assert.equal(OUTLINE.l8_82.raised - OUTLINE.l8_82.net, OUTLINE.l8_82.spent);
  assert.ok(L2.cards[0].text.includes(D(250)) && L2.cards[0].text.includes('$2 or $3'));
  assert.ok(L2.cards[1].text.includes('$400 out and $310 back leaves $90 out'));
  assert.deepEqual(L3.cards[2].figure.rows, [['Total raised', D(OUTLINE.l8_82.raised * 100)], ['Total spent', D(OUTLINE.l8_82.spent * 100)], ['Net funds', D(OUTLINE.l8_82.net * 100)]]);
});

test('shape and counts', () => {
  assert.equal(section.units.at(-1).id, 'ft2030-s2-u3');
  assert.equal(unit.title, 'From data to paperwork');
  assert.deepEqual(unit.outcome_codes, ['ENT2020 2.5', 'ENT2020 3.1', 'ENT2020 3.3']);
  assert.equal(unit.levels.length, 3);
  unit.levels.forEach((l, i) => {
    assert.equal(l.id, `ft2030-s2-u3-l${i + 1}`);
    assert.ok(l.cards.length >= 4 && l.cards.length <= 6 && l.questions.length >= 7 && l.questions.length <= 10);
    l.questions.forEach((x, k) => assert.equal(x.id, `${l.id}-q${k + 1}`));
    assert.ok(l.questions.filter((x) => x.type === 'number').length >= 2);
    assert.ok(l.questions.some((x) => x.figure) || l.cards.some((c) => c.figure));
    for (const c of l.cards) if (c.figure?.kind === 'table') assert.ok(c.figure.columns.length <= 4);
    assert.equal(l.go, undefined);
  });
  assert.ok(!JSON.stringify(unit).includes('"image"'));
  assert.ok(!/!|\bAI\b|Marketplace|ticket/i.test(JSON.stringify(unit)));
});

// A number question never asks for a figure already printed on a card (or card figure) of its level.
test('no copied answers: no number answer appears on a card of its level', () => {
  for (const l of unit.levels) {
    const printed = l.cards.map((c) => `${c.text} ${c.figure ? JSON.stringify(c.figure.rows ?? c.figure.bars) : ''}`).join(' ');
    for (const x of l.questions.filter((y) => y.type === 'number')) {
      const shown = x.unit === '$' ? D(x.answer) : `${x.answer}%`;
      assert.ok(!printed.includes(shown), `${x.id}: ${shown} is printed on a card`);
    }
  }
});

test('level 1: two samples, shares, gap, bars', () => {
  assert.deepEqual(L1.cards[2].figure.rows, [['In class', '25', '20', `${pct(20, 25)}%`], ['Outside', '20', '8', `${pct(8, 20)}%`]]);
  assert.ok(L1.cards[3].text.includes(`${pct(20, 25)}% down to ${pct(8, 20)}% is a drop of ${pct(20, 25) - pct(8, 20)} points`));
  assert.equal(q('l1-q3').answer, pct(30, 40));
  assert.equal(q('l1-q4').answer, pct(35, 50) - pct(5, 20));
  assert.equal(pct(35, 50) - pct(5, 20), 45);
  assert.equal(right('l1-q5'), 'The outside share, because strangers have no reason to be kind');
  assert.equal(right('l1-q6'), 'Reprice');
  assert.equal(right('l1-q7'), 'Reposition');
  const outside = [70, 45, 30, 60];
  assert.deepEqual(q('l1-q9').figure.bars.map((b) => b.value), outside);
  assert.equal(q('l1-q9').answer, outside.indexOf(Math.min(...outside)));
  assert.ok(q('l1-q9').prompt.includes('85%'));
  assert.equal(L1.cards[4].figure.rows.length, 4);
});

test('level 2: whole dollars, Sprout Cups, break-even, money left', () => {
  const fixed = 8400, cost = 120, market = 120, asked = 40;
  const m = (p) => p - cost, be = (p) => up(fixed, m(p));
  assert.deepEqual(L2.cards[3].figure.rows, [300, 400].map((p) => [D(p), D(m(p)), String(be(p))]));
  assert.equal(be(300), 47);
  assert.equal(be(400), 30);
  assert.ok(fixed / m(300) > 46 && fixed / m(300) < 47); // 46.67 rounds up to 47
  assert.deepEqual(L2.cards[4].figure.rows, [[D(300), '28 of 40', `${pct(28, 40)}%`], [D(400), '12 of 40', `${pct(12, 40)}%`]]);
  const buyers = (n) => (market * n) / asked, left = (p, n) => buyers(n) * m(p) - fixed;
  assert.deepEqual(L2.cards[5].figure.rows, [[300, 28], [400, 12]].map(([p, n]) => [D(p), String(buyers(n)), D(left(p, n))]));
  assert.equal(left(300, 28), 6720);
  assert.equal(left(400, 12), 1680);
  assert.equal(q('l2-q2').answer, 500 - 210);
  assert.equal(right('l2-q1'), '$4 or $5');
  const be3 = up(12000, 500 - 210);
  assert.equal(be3, 42);
  assert.equal(right('l2-q3'), `${be3} items`);
  assert.deepEqual(new Set(q('l2-q3').options.map((o) => o.text)), new Set([`${be3} items`, `${Math.floor(12000 / 290)} items`, `${up(12000, 500)} items`, `${up(12000, 210)} items`]));
  assert.equal(right('l2-q4'), 'Higher margin, fewer items needed');
  assert.ok(300 - 120 > 250 - 120 && up(fixed, 300 - 120) < up(fixed, 250 - 120));
  assert.equal(q('l2-q5').answer, 50 * (400 - 130) - 9600);
  assert.equal(q('l2-q5').answer, 3900);
  // q6: unit cost 1.00, fixed 60.00, 100 pass by; rounding up to $3 wins even with fewer buyers
  const l6 = (p, s) => s * (p - 100) - 6000;
  assert.equal(l6(200, 90), 3000);
  assert.equal(l6(300, 60), 6000);
  assert.ok(right('l2-q6').startsWith('$3,'));
  assert.deepEqual(q('l2-q6').figure.rows, [['$2.00', '90%'], ['$3.00', '60%']]);
  assert.equal(q('l2-q7').answer, (520 - 455) * 100);
  assert.match(right('l2-q8'), /still owes that value/);
  const share = [85, 55, 25, 10], prices = [200, 300, 400, 500];
  const tot = share.map((s, i) => s * (prices[i] - 140));
  assert.deepEqual(tot, [5100, 8800, 6500, 3600]);
  assert.deepEqual(q('l2-q9').figure.bars.map((b) => b.value), share);
  assert.equal(q('l2-q9').answer, tot.indexOf(Math.max(...tot)));
});

test('level 3: net funds, unsold plan, packs', () => {
  const net = (r, s) => r - s;
  assert.equal(q('l3-q3').answer, net(41000, 33000) + net(28000, 30500));
  assert.equal(net(28000, 30500), -2500);
  assert.deepEqual(q('l3-q3').figure.rows, [['A', D(41000), D(33000)], ['B', D(28000), D(30500)]]);
  assert.equal(q('l3-q7').answer, 40 * (300 - 150));
  assert.equal(up(130, 50), 3); // card 6 case: 130 cups, packs of 50
  assert.ok(L3.cards[5].text.includes('Need 130 cups in packs of 50? Buy 3 packs.'));
  assert.equal(q('l3-q8').answer, up(340, 75) * 420);
  assert.equal(up(340, 75), 5);
  assert.deepEqual(L3.cards[5].figure.rows, [['Paper cups, 250 mL, pack of 50', '3', D(600), D(3 * 600)], ['Lids, pack of 100', '2', D(950), D(2 * 950)]]);
  assert.match(right('l3-q1'), /Supplier credit/);
  assert.match(right('l3-q4'), /holds the money/);
  assert.match(right('l3-q6'), /cheaper on the last day/);
  assert.match(right('l3-q9'), /pack of 25, 4 packs/);
});

test('the right choice does not sit in one place in any level', () => {
  for (const l of unit.levels) assert.ok(new Set(l.questions.filter((x) => x.type === 'choice').map((x) => x.answer)).size >= 2);
});
