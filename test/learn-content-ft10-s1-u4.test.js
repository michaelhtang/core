// Content check for the Learning Road unit "What Edmonton costs" (ft10-s1-u4): the game's own figures (Housing rents, deposits, the pay stub) are recomputed
// from modules/housing/constants.js and modules/jobs/payroll.js, every class figure is pinned to Mr. Tang's outline, and the shape is pinned.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { RENTALS } from '../modules/housing/constants.js';
import { payStub } from '../modules/jobs/payroll.js';

const course = JSON.parse(fs.readFileSync(new URL('../modules/learn/content/fintech10.json', import.meta.url), 'utf8'));
const unit = course.sections.flatMap((s) => s.units).find((u) => u.id === 'ft10-s1-u4');
const Q = new Map(unit.levels.flatMap((l) => l.questions).map((q) => [q.id, q]));
const money = (c) => `$${(c / 100).toLocaleString('en-CA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const text = JSON.stringify(unit);

// Class figures, in cents, from claude_Lesson 6 Slide Outline Sept 14.md (slide-studio/courses/fintech10/context/claude-project/docs/).
const OUTLINE = {
  alone: { v: 129800, cite: 'Sept 14 line 69 and 74 ("A one-bedroom in Edmonton averages $1,298")' },
  twoBed: { v: 158100, cite: 'Sept 14 line 74 ("A two-bedroom averages $1,581")' },
  pass: { v: 10500, cite: 'Sept 14 line 90 ("Bus pass $105/month")' },
  carLow: { v: 68000, cite: 'Sept 14 line 90 ("$680-$1,150/month, all in")' },
  carHigh: { v: 115000, cite: 'Sept 14 line 90' },
  carMid: { v: 91500, cite: 'Sept 14 line 92 ("Take the midpoint, $915")' },
  modest: { v: 250300, cite: 'Lesson 1 Sept 3 line 16; Lesson 5 Sept 10 line 57 ("$2,503")' },
  modestCar: { v: 331300, cite: 'Lesson 1 Sept 3 line 16 ("~$3,313/month with a car")' },
  wageBooks: { v: 1500, cite: 'Sept 14 line 112 ("on the books at $15")' },
  wageCash: { v: 1700, cite: 'Sept 14 line 112 ("$17 cash")' },
  slideWage: { v: 1500, cite: 'Sept 14 line 74 ("How many hours would that take at $15?")' },
};
const O = Object.fromEntries(Object.entries(OUTLINE).map(([k, x]) => [k, x.v]));
const half = O.twoBed / 2, gap = O.alone - half, gapY = gap * 12, cgap = O.carMid - O.pass, cgapY = cgap * 12, both = gap + cgap, bothY = both * 12;

test('shape: 8 levels, 4-6 cards, 7-10 questions, ids, outcome codes, go button', () => {
  assert.ok(unit, 'unit ft10-s1-u4 is in fintech10.json');
  assert.equal(unit.title, 'What Edmonton costs');
  assert.equal(unit.levels.length, 8);
  assert.deepEqual(unit.outcome_codes, ['FIN1010 1.1', 'FIN1010 1.2', 'FIN1010 1.3', 'FIN1010 2.1', 'FIN1010 2.3']);
  unit.levels.forEach((l, i) => {
    assert.equal(l.id, `ft10-s1-u4-l${i + 1}`);
    assert.ok(l.cards.length >= 4 && l.cards.length <= 6, `${l.id}: ${l.cards.length} cards`);
    assert.ok(l.questions.length >= 7 && l.questions.length <= 10, `${l.id}: ${l.questions.length} questions`);
    if (i !== 3 && i !== 6) assert.ok(l.questions.filter((q) => q.type === 'number').length >= 2, `${l.id}: at least 2 number questions`);
    assert.ok(l.questions.some((q) => q.figure), `${l.id}: at least 1 question with a figure`);
    l.questions.forEach((q, k) => assert.equal(q.id, `${l.id}-q${k + 1}`));
  });
  assert.deepEqual(unit.levels[7].go, { building: 'housing', label: 'Open Housing' });
});

test('outline figures: the class chain is consistent and uses the unrounded half ($790.50, not the slide $790)', () => {
  assert.equal(half, 79050);
  assert.equal(gap, 50750);      // slide shows $508
  assert.equal(gapY, 609000);    // slide $6,090 = 12 x $507.50
  assert.equal(O.carMid, (O.carLow + O.carHigh) / 2);
  assert.equal(cgap, 81000);
  assert.equal(cgapY, 972000);
  assert.equal(both, 131750);    // slide shows $1,318
  assert.equal(bothY, 1581000);
  assert.equal(gapY + cgapY, bothY);
  assert.equal(O.modestCar - O.modest, cgap, 'the car month is the bus month plus the gap');
  assert.equal(gapY / O.slideWage, 406);
  for (const s of ['$790.50', '$507.50', '$6,090.00', '$810.00', '$9,720.00', '$1,317.50', '$15,810.00', '$915.00', '$2,503.00', '$3,313.00']) assert.ok(text.includes(s), s);
  assert.ok(!text.includes('$790 ') && !text.includes('$508') && !text.includes('$1,318'), 'no rounded slide figures');
  for (const x of Object.values(OUTLINE)) assert.ok(x.cite);
});

const num = (id) => Q.get(id);
test('number answers recompute: class chain (levels 1 to 6)', () => {
  const want = {
    'ft10-s1-u4-l1-q3': O.alone + O.pass, 'ft10-s1-u4-l1-q5': O.modest - O.alone - O.pass, 'ft10-s1-u4-l1-q6': O.modestCar - O.modest,
    'ft10-s1-u4-l2-q4': half, 'ft10-s1-u4-l2-q5': O.alone * 12, 'ft10-s1-u4-l2-q9': half * 12,
    'ft10-s1-u4-l3-q1': gap, 'ft10-s1-u4-l3-q2': gapY, 'ft10-s1-u4-l3-q3': gapY / O.slideWage, 'ft10-s1-u4-l3-q4': Math.round(gapY / O.slideWage / 52),
    'ft10-s1-u4-l3-q8': O.alone - 75000, 'ft10-s1-u4-l3-q9': half * 12,
    'ft10-s1-u4-l4-q4': gap - 30000, 'ft10-s1-u4-l4-q5': gapY, 'ft10-s1-u4-l4-q8': Math.round(gap / 1500),
    'ft10-s1-u4-l5-q3': (O.carLow + O.carHigh) / 2, 'ft10-s1-u4-l5-q4': cgap, 'ft10-s1-u4-l5-q5': cgapY, 'ft10-s1-u4-l5-q7': O.carLow - O.pass, 'ft10-s1-u4-l5-q8': O.modest - O.pass + O.carMid,
    'ft10-s1-u4-l6-q1': both, 'ft10-s1-u4-l6-q2': bothY, 'ft10-s1-u4-l6-q4': O.modestCar - both, 'ft10-s1-u4-l6-q5': bothY / 1500,
    'ft10-s1-u4-l6-q8': half + O.carMid - O.alone - O.pass,
  };
  for (const [id, v] of Object.entries(want)) assert.equal(num(id).answer, v, id);
  assert.equal(num('ft10-s1-u4-l1-q4').answer, Math.round(((O.alone + O.pass) / O.modest) * 100));
  assert.equal(num('ft10-s1-u4-l1-q9').answer, Math.round((O.alone / O.modest) * 100));
  assert.equal(num('ft10-s1-u4-l6-q3').answer, (both / 263500) * 100);   // Sam's made-up net pay $2,635.00
});

test('point answers: the keyed bar is the one the prompt describes', () => {
  const bar = (id) => { const q = Q.get(id); return q.figure.bars[q.answer]; };
  assert.equal(bar('ft10-s1-u4-l1-q7').value, O.alone);
  assert.equal(bar('ft10-s1-u4-l2-q6').value, half);
  const l3 = Q.get('ft10-s1-u4-l3-q6'); assert.equal(l3.figure.bars[0].value - bar('ft10-s1-u4-l3-q6').value, gapY);
  assert.ok(bar('ft10-s1-u4-l4-q7').value > gap);
  assert.equal(bar('ft10-s1-u4-l5-q6').value, O.carMid);
  assert.equal(bar('ft10-s1-u4-l6-q6').value, cgapY);
  assert.equal(bar('ft10-s1-u4-l8-q8').value, Math.min(...Q.get('ft10-s1-u4-l8-q8').figure.bars.map((b) => b.value)));
});

test('level 7: the books-or-cash month is recomputed with payStub from payroll.js', () => {
  const books = O.wageBooks * 52, cash = O.wageCash * 52, s = payStub({ grossCents: books, period: 1 });
  assert.equal(num('ft10-s1-u4-l7-q1').answer, cash);
  assert.equal(num('ft10-s1-u4-l7-q2').answer, cash - books);
  assert.equal(num('ft10-s1-u4-l7-q3').answer, s.net);
  assert.equal(num('ft10-s1-u4-l7-q4').answer, s.cpp + s.ei);
  assert.equal(s.federalTax + s.albertaTax, 0, 'no income tax at a part-time student month');
  for (const v of [s.cpp, s.ei, s.net]) assert.ok(text.includes(money(v)), money(v));
});

test('level 8: the game figures come from RENTALS in modules/housing/constants.js', () => {
  const R = Object.fromEntries(RENTALS.map((r) => [r.id, r]));
  const dep = (r) => r.depositCents ?? r.rentCents;
  const a1 = R.apt1.rentCents, rm = R['apt2-roommate'].rentCents;
  assert.equal(num('ft10-s1-u4-l8-q2').answer, rm);
  assert.equal(num('ft10-s1-u4-l8-q3').answer, a1 - rm);
  assert.equal(num('ft10-s1-u4-l8-q4').answer, (a1 - rm) * 12);
  assert.equal(num('ft10-s1-u4-l8-q5').answer, dep(R.apt1));
  assert.equal(num('ft10-s1-u4-l8-q6').answer, O.alone - a1);
  assert.equal(R.parents.depositCents, 0);
  const q1 = Q.get('ft10-s1-u4-l8-q1'); assert.equal(q1.options[q1.answer].text, money(a1));
  const table = unit.levels[7].cards[1].figure.rows;
  assert.deepEqual(table, [['Living with my parents', money(R.parents.rentCents), money(0)], ['1-bedroom apartment', money(a1), money(dep(R.apt1))], ['2-bedroom with a roommate', money(rm), money(dep(R['apt2-roommate']))]]);
  assert.equal(R['apt2-roommate'].rentCents, R.apt2.rentCents / 2);
  const g = Q.get('ft10-s1-u4-l8-q8'); assert.equal(g.figure.bars[g.answer].value, R.parents.rentCents);
});
