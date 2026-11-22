// Content check for "The business idea" (ft2030-s2-u1). No game module and no dollar figure from Mr. Tang's outlines is involved:
// every number is arithmetic on made-up students and a made-up school, recomputed here from first principles.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const course = JSON.parse(fs.readFileSync(new URL('../modules/learn/content/fintech2030.json', import.meta.url), 'utf8'));
const unit = course.sections.flatMap((s) => s.units).find((u) => u.id === 'ft2030-s2-u1');
const [L1, L2, L3] = unit.levels;
const Q = new Map(unit.levels.flatMap((l) => l.questions).map((x) => [x.id, x]));
const q = (n) => Q.get(`ft2030-s2-u1-${n}`);
const right = (n) => q(n).options[q(n).answer].text;

test('shape and counts', () => {
  assert.equal(unit.title, 'The business idea');
  assert.deepEqual(unit.outcome_codes, []); // ENT2020 2.1, 2.3, 2.4 are about financing and do not fit this unit
  assert.equal(unit.levels.length, 3);
  unit.levels.forEach((l, i) => {
    assert.equal(l.id, `ft2030-s2-u1-l${i + 1}`);
    assert.ok(l.cards.length >= 4 && l.cards.length <= 6 && l.questions.length >= 7 && l.questions.length <= 10);
    l.questions.forEach((x, k) => assert.equal(x.id, `${l.id}-q${k + 1}`));
    assert.ok(l.cards.some((c) => c.figure));
    for (const c of l.cards) if (c.figure?.kind === 'table') assert.ok(c.figure.columns.length <= 4);
    assert.equal(l.go, undefined);
  });
  assert.ok(unit.levels.slice(1).every((l) => l.questions.filter((x) => x.type === 'number' || x.type === 'point').length >= 2));
  assert.ok(!JSON.stringify(unit).includes('"image"'));
});

test('no number answer is written on a card or card figure of its level', () => {
  for (const l of unit.levels) {
    const text = l.cards.map((c) => c.text + JSON.stringify(c.figure ?? {})).join(' ');
    for (const x of l.questions.filter((y) => y.type === 'number')) {
      const t = x.unit === '$' ? `$${(x.answer / 100).toFixed(2)}` : `${x.answer}%`;
      assert.ok(!text.includes(t), `${x.id}: ${t} appears on a card`);
    }
  }
});

test('level 2: Oakfield funnel, shares and the juice bars', () => {
  const rows = L2.cards[1].figure.rows;
  assert.deepEqual(rows.map((r) => Number(r[1])), [800, 800 * 0.7, 800 * 0.7 * 0.5, 800 * 0.7 * 0.5 * 0.25]);
  assert.deepEqual(rows.map((r) => Number(r[1])), [800, 560, 280, 70]);
  assert.equal(q('l2-q3').answer, Math.round(((600 * 0.5 * 0.4) / 600) * 100));
  assert.equal(q('l2-q3').answer, 20);
  assert.equal(q('l2-q4').answer, Math.round(((500 * 0.6 * 0.2) / 500) * 100));
  assert.equal(q('l2-q4').answer, 12);
  assert.ok(q('l2-q5').prompt.includes('120') && q('l2-q5').prompt.includes('90'));
  assert.ok(90 < 120 && right('l2-q5').startsWith('The market is smaller'));
  const bars = q('l2-q10').figure.bars;
  assert.deepEqual(bars.map((b) => b.value), [275, 350, 225, 300]); // cents
  assert.deepEqual(bars.map((b, i) => [b.value < 250, i]).filter(([lt]) => lt).map(([, i]) => i), [q('l2-q10').answer]);
  assert.equal(bars[q('l2-q10').answer].label, 'Corner shop');
  assert.equal(right('l2-q8'), 'Closer');
  assert.ok(L2.cards[5].text.includes('$2.00'));
  assert.deepEqual(L2.cards[5].figure.rows.map((r) => r[1]), ['$2.00', '$2.50', '$3.25', '$0.00']);
});

test('level 3: survey shares and the sample', () => {
  const picks = [21, 11, 4, 14], total = picks.reduce((a, b) => a + b, 0);
  assert.equal(total, 50);
  assert.deepEqual(q('l3-q7').figure.rows.map((r) => Number(r[1])), picks);
  assert.deepEqual(q('l3-q8').figure.rows.map((r) => Number(r[1])), picks);
  assert.equal(q('l3-q7').answer, Math.round((14 / total) * 100));
  assert.equal(q('l3-q7').answer, 28);
  assert.equal(q('l3-q8').answer, Math.round(((11 + 4) / total) * 100));
  assert.equal(q('l3-q8').answer, 30);
  assert.equal(q('l3-q9').answer, Math.round((7 / (28 + 7)) * 100));
  assert.equal(q('l3-q9').answer, 20);
  const s = L3.cards[5].figure.rows.map((r) => Number(r[1]));
  assert.deepEqual(s, [18, 10, 12]);
  assert.equal(s.reduce((a, b) => a + b, 0), 40);
  assert.equal((18 / 40) * 100, 45);
  assert.ok(L3.cards[5].text.includes('18 of 40 is 45%'));
  assert.ok(right('l3-q6').includes('would not buy'));
});

test('level 1 keys that rest on the cards', () => {
  assert.equal(right('l1-q1'), 'Product or service, customer, benefit, distribution');
  assert.ok(right('l1-q5').includes('distribution'));
  assert.deepEqual(L1.cards[4].figure.rows.map((r) => r[0]), ['Product', 'Customer', 'Benefit', 'Distribution']);
});
