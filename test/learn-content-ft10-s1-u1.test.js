// Unit ft10-s1-u1 "Being responsible with money": its numbers, its quoted outline figures and its shape (see modules/learn/content/REVIEW-ft10-s1-u1.md).
// No number in this unit comes from a game module (it teaches ideas and arithmetic with made-up people), so nothing here imports payroll.js or the catalogue;
// every number answer is instead recomputed below from the arithmetic in its own working.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { checkCourse } from '../modules/learn/content.js';

const COURSE = JSON.parse(fs.readFileSync(new URL('../modules/learn/content/fintech10.json', import.meta.url), 'utf8'));
const UNIT = COURSE.sections.flatMap((s) => s.units).find((u) => u.id === 'ft10-s1-u1');
const Q = new Map(UNIT.levels.flatMap((l) => l.questions.map((q) => [q.id, q])));
const c = (d) => Math.round(d * 100);
const mo = (w) => c((w * 52) / 12);
const OUT = '/Users/michaeltang/claude-workspace/slide-studio/courses/fintech10/context/claude-project/docs/';

test('shape: 8 levels, 4-6 cards, 7-10 questions, passes checkCourse', () => {
  assert.equal(UNIT.levels.length, 8);
  for (const l of UNIT.levels) {
    assert.ok(l.cards.length >= 4 && l.cards.length <= 6, l.id);
    assert.ok(l.questions.length >= 7 && l.questions.length <= 10, l.id);
  }
  checkCourse(structuredClone(COURSE), 'fintech10.json');
});

test('every number answer recomputes from its own arithmetic', () => {
  const kit = { b: [60, 40, 50, 30, 20], a: [55, 35, 15, 15, 10] };
  const jonah = [30, 12 * 52 / 12, 8 * 52 / 12, 11, 25, 15 * 52 / 12].map(c);
  const total = jonah.reduce((x, y) => x + y, 0), own = jonah[0] + jonah[5], other = total - own;
  const want = {
    'l1-q4': c(40 - 25), 'l1-q5': c(50 - 18 - 14),
    'l2-q2': c(200 - 130), 'l2-q3': ((50 - 15) / 50) * 100, 'l2-q4': ((30 - 15) / 30) * 100, 'l2-q5': Math.round((55 / 130) * 100),
    'l3-q4': c(60 * 0.1), 'l3-q5': c(85 * 0.1),
    'l4-q5': (60 / 200) * 100, 'l4-q6': c(60 - 50),
    'l5-q5': c(20 * 26), 'l5-q6': c(15 * 52),
    'l6-q2': mo(12), 'l6-q3': mo(8), 'l6-q4': mo(15), 'l6-q5': total, 'l6-q7': ((65 - 39) / 65) * 100,
    'l7-q1': own, 'l7-q2': other, 'l7-q3': c(2503) - total, 'l7-q4': Math.round((own / 100 / 13) * 10) / 10, 'l7-q9': mo(9),
    'l8-q2': c(400 - 350), 'l8-q3': (100 / 400) * 100, 'l8-q4': mo(10),
  };
  assert.equal(total, 21767);
  assert.equal(kit.b.reduce((x, y) => x + y), 200);
  assert.equal(kit.a.reduce((x, y) => x + y), 130);
  const numbers = [...Q.values()].filter((q) => q.type === 'number');
  assert.equal(numbers.length, Object.keys(want).length, 'a number question has no recomputation here');
  for (const [k, v] of Object.entries(want)) {
    const q = Q.get(`ft10-s1-u1-${k}`);
    assert.ok(q, k);
    assert.ok(Math.abs(q.answer - v) < 1e-9, `${q.id}: stored ${q.answer}, recomputed ${v}`);
    assert.ok(!q.check, 'no payroll check here');
  }
});

test('point and figure answers recompute', () => {
  const bar = (id) => Q.get(`ft10-s1-u1-${id}`);
  assert.equal(bar('l1-q7').figure.bars[bar('l1-q7').answer].value, c(40 - 28));
  const l2 = bar('l2-q7').figure.bars.map((b) => b.value);
  assert.equal(bar('l2-q7').answer, l2.indexOf(Math.max(...l2)));
  assert.equal(bar('l3-q6').figure.bars[bar('l3-q6').answer].value * 0.1, c(8));
  assert.equal(bar('l4-q7').figure.bars[bar('l4-q7').answer].value, c(200 * 0.25));
  assert.equal(bar('l5-q7').figure.bars[bar('l5-q7').answer].value, c(780));
  const l6 = bar('l6-q6').figure.bars.map((b) => b.value);
  assert.equal(bar('l6-q6').answer, l6.indexOf(Math.max(...l6)));
  const l7 = bar('l7-q7').figure.bars.map((b) => b.value);
  assert.equal(bar('l7-q7').answer, l7.indexOf(Math.max(...l7)));
  assert.equal(bar('l8-q8').figure.bars[bar('l8-q8').answer].value, c(400 * 0.2));
  // the shrinking-month table adds up
  const kit = UNIT.levels[1].cards[2].figure.rows;
  const money = (s) => Math.round(parseFloat(s.replace(/[$,]/g, '')) * 100);
  assert.equal(kit.slice(0, 5).reduce((n, r) => n + money(r[1]), 0), money(kit[5][1]));
  assert.equal(kit.slice(0, 5).reduce((n, r) => n + money(r[2]), 0), money(kit[5][2]));
});

// Dollar figures quoted from Mr. Tang's outlines. Real prices and rules come only from here; each row names the outline and its line.
const OUTLINE = [
  { text: '$2,503', file: 'claude_Lesson 1 Slide Outline Sept 3.md', line: 16, needle: '$2,503/month' },
  { text: '$3,313', file: 'claude_Lesson 1 Slide Outline Sept 3.md', line: 16, needle: '$3,313/month' },
  { text: '$13.00', file: 'claude_Lesson 3 Slide Outline Sept 8.md', line: 54, needle: '**$13**' },
];
test('quoted outline figures match the outlines', () => {
  const all = JSON.stringify(UNIT);
  for (const o of OUTLINE) {
    assert.ok(all.includes(o.text), `${o.text} should be used`);
    const p = OUT + o.file;
    if (fs.existsSync(p)) assert.ok(fs.readFileSync(p, 'utf8').split('\n')[o.line - 1].includes(o.needle), `${o.file} line ${o.line} no longer has ${o.needle}`);
  }
  // the only places the adult month appears are the two quoted figures
  const adult = all.match(/\$[23],\d{3}(\.\d\d)?/g) ?? [];
  assert.ok(adult.every((x) => ['$2,503.00', '$3,313.00', '$2,285.33'].includes(x)), `unexpected adult-month figure in ${[...new Set(adult)]}`);
  assert.equal(Q.get('ft10-s1-u1-l7-q3').answer, c(2503) - 21767);
  const k = Q.get('ft10-s1-u1-l7-q6');
  assert.ok(k.options[k.answer].text.includes('eighteen and twenty-five'));   // Lesson 2 outline, line 74 ("The gap")
  const l2 = OUT + 'claude_Lesson 2 Slide Outline Sept 4.md';
  if (fs.existsSync(l2)) assert.ok(fs.readFileSync(l2, 'utf8').split('\n')[73].includes('between eighteen and twenty-five'));
});
