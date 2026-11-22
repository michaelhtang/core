// Content check for the Learning Road unit "Slips and the T1" (ft2030-s1-u3): every number answer and table amount is recomputed from
// modules/learn/companies/taxpayers-2025.js, and every box and line number is checked against modules/learn/companies/tax-facts.js.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { SCENARIOS, returnFor, money } from '../modules/learn/companies/taxpayers-2025.js';
import * as P from '../modules/learn/companies/tax-rates-2025.js';
import { SLIPS, T1_LINES } from '../modules/learn/companies/tax-facts.js';

const course = JSON.parse(fs.readFileSync(new URL('../modules/learn/content/fintech2030.json', import.meta.url), 'utf8'));
const unit = course.sections.flatMap((s) => s.units).find((u) => u.id === 'ft2030-s1-u3');
const Q = new Map(unit.levels.flatMap((l) => l.questions).map((q) => [q.id, q]));
const { A, B, C } = SCENARIOS;
const a = A.t4s[0], b = B.t4s[0], [c1, c2] = C.t4s;
const sumOf = (xs) => xs.reduce((s, x) => s + x, 0);
const textOf = (l) => unit.levels[l - 1].cards.map((c) => c.text).join(' ');

test('shape: 3 levels, 4-6 cards, 7-10 questions, outcome codes, go button, no pictures', () => {
  assert.equal(unit.levels.length, 3);
  assert.deepEqual(unit.outcome_codes, ['FIN2060 2.1', 'FIN2060 2.2']);
  for (const l of unit.levels) { assert.ok(l.cards.length >= 4 && l.cards.length <= 6); assert.ok(l.questions.length >= 7 && l.questions.length <= 10); }
  assert.deepEqual(unit.levels[0].go, { building: 'job', label: 'Open the Job Centre' });
  assert.equal(unit.levels[1].go, undefined); assert.equal(unit.levels[2].go, undefined);
  assert.equal(unit.levels.flatMap((l) => l.cards).length, 18);
  assert.ok(!/2026/.test(JSON.stringify(unit)));
  assert.equal(Q.size, 27);
  assert.equal([...Q.values()].filter((q) => q.type === 'number').length, 9);
});

test('2025 T4 boxes: CPP and EI follow the pinned 2025 rates, as the cards state them', () => {
  const t = unit.levels[0].cards.map((c) => c.text).join(' ');
  assert.equal(P.EI_RATE.value, 164); assert.equal(P.CPP_RATE.value, 595); assert.equal(P.CPP_EXEMPTION.value, 350000); assert.equal(P.EI_MIE.value, 6570000);
  assert.ok(t.includes('5.95%') && t.includes('$3,500') && t.includes('1.64%') && t.includes('$65,700'));
  assert.equal(Math.round(P.CPP_RATE.value * (a.box14 - P.CPP_EXEMPTION.value) / 10000), a.box16);   // a full year: no proration
  assert.equal(Math.round(P.EI_RATE.value * a.box24 / 10000), a.box18);
  assert.equal(Math.round(P.EI_RATE.value * b.box24 / 10000), b.box18);
  assert.equal(a.box16A, 0); assert.equal(a.box24, a.box14); assert.equal(a.box26, a.box14);
  assert.ok(t.includes(money(a.box22)) && t.includes('Your own pay stub in the game shows the same kinds of deductions'));
});

test('every number answer is recomputed from the taxpayers file', () => {
  const want = {
    'ft2030-s1-u3-l1-q3': Math.round(P.EI_RATE.value * a.box24 / 10000),
    'ft2030-s1-u3-l1-q4': a.box16,
    'ft2030-s1-u3-l1-q6': a.box16 + a.box18 + a.box22,
    'ft2030-s1-u3-l1-q8': Math.round(P.EI_RATE.value * b.box24 / 10000),
    'ft2030-s1-u3-l2-q3': A.t5s[0].box13Interest,
    'ft2030-s1-u3-l2-q6': c1.box14 + c2.box14,
    'ft2030-s1-u3-l2-q8': b.box14 + B.t4as[0].box028,
    'ft2030-s1-u3-l3-q6': returnFor(A).totalIncome,
    'ft2030-s1-u3-l3-q7': returnFor(C).totalIncome,
  };
  for (const [id, v] of Object.entries(want)) { assert.ok(Q.has(id), id); assert.equal(Q.get(id).answer, v, id); }
  assert.equal(Object.keys(want).length, [...Q.values()].filter((q) => q.type === 'number').length);
  assert.equal(returnFor(A).totalIncome, sumOf(A.t4s.map((t) => t.box14)) + sumOf(A.t5s.map((t) => t.box13Interest)));
  assert.equal(returnFor(C).totalIncome, sumOf(C.t4s.map((t) => t.box14)) + sumOf(C.t5s.map((t) => t.box13Interest)));
  // the prompts that carry an amount in words
  assert.ok(Q.get('ft2030-s1-u3-l1-q3').prompt.includes(money(a.box24)));
  assert.ok(Q.get('ft2030-s1-u3-l1-q8').prompt.includes(money(b.box24)));
  assert.ok(Q.get('ft2030-s1-u3-l2-q8').prompt.includes(money(b.box14)) && Q.get('ft2030-s1-u3-l2-q8').prompt.includes(money(B.t4as[0].box028)));
  // trap values
  assert.equal(Q.get('ft2030-s1-u3-l1-q3').traps[0].value, a.box16);
  assert.equal(Q.get('ft2030-s1-u3-l1-q4').traps[0].value, a.box18);
  assert.equal(Q.get('ft2030-s1-u3-l1-q6').traps[0].value, a.box16 + a.box18);
  assert.equal(Q.get('ft2030-s1-u3-l1-q8').traps[0].value, a.box18);
  assert.equal(Q.get('ft2030-s1-u3-l2-q6').traps[0].value, c1.box14 + c2.box14 + C.t5s[0].box13Interest);
  assert.equal(Q.get('ft2030-s1-u3-l3-q6').traps[0].value, returnFor(A).totalIncome + A.rrspReceipts[0]);
  assert.equal(Q.get('ft2030-s1-u3-l3-q7').traps[0].value, c1.box14 + c2.box14);
});

const boxesOf = (t) => [t.box14, t.box16, t.box16A, t.box18, t.box22, t.box24, t.box26];
const facts = [SLIPS.T4.box14, SLIPS.T4.box16, SLIPS.T4.box16A, SLIPS.T4.box18, SLIPS.T4.box22, SLIPS.T4.box24, SLIPS.T4.box26];

test('slip tables: every amount from the taxpayers file, every box number and name from tax-facts.js', () => {
  const t4 = unit.levels[0].cards[1].figure;
  assert.deepEqual(t4.columns, ['Box', 'What it shows', 'Amount']);
  assert.deepEqual(t4.rows, facts.map((f, i) => [String(f.value.box), f.value.name, money(boxesOf(a)[i])]));
  assert.deepEqual(Q.get('ft2030-s1-u3-l1-q2').figure, t4);
  const t5 = unit.levels[1].cards[2].figure;
  assert.deepEqual(t5.rows, [[String(SLIPS.T5.box13.value.box), SLIPS.T5.box13.value.name, money(A.t5s[0].box13Interest)]]);
  assert.deepEqual(unit.levels[1].cards[5].figure.rows, [
    ['T4 box 14', c1.employer, money(c1.box14)], ['T4 box 14', c2.employer, money(c2.box14)], ['T5 box 13', 'Her bank', money(C.t5s[0].box13Interest)]]);
  assert.equal(SLIPS.T4.box14.value.box, 14); assert.equal(SLIPS.T4.box16.value.box, 16); assert.equal(SLIPS.T4.box16A.value.box, '16A');
  assert.equal(SLIPS.T4.box18.value.box, 18); assert.equal(SLIPS.T4.box22.value.box, 22); assert.equal(SLIPS.T4.box24.value.box, 24); assert.equal(SLIPS.T4.box26.value.box, 26);
  assert.equal(SLIPS.T5.box13.value.box, 13); assert.equal(SLIPS.T4A.box105.value.box, 105);
  assert.equal(c1.employer, 'Prairie Threads'); assert.equal(C.t4s.length, 2);
});

test("Marcus's T4A is box 028 (Other income), and box 105 is the scholarship box", () => {
  assert.ok(textOf(2).includes(money(B.t4as[0].box028)));
  assert.ok(textOf(2).includes(`box ${SLIPS.T4A.box105.value.box} is for scholarships, fellowships, bursaries, and artists' project grants`));
  assert.ok(textOf(2).includes(`line ${SLIPS.T4A.box105.value.line}`));
  assert.ok(Object.keys(B.t4as[0]).includes('box028') && SLIPS.T4A.box028.value.name === 'Other income');
  assert.ok(textOf(2).includes(`box ${SLIPS.T4A.box028.value.box} is ${SLIPS.T4A.box028.value.name}`));
  assert.equal(Q.get('ft2030-s1-u3-l2-q7').options[Q.get('ft2030-s1-u3-l2-q7').answer].text, `Box ${SLIPS.T4A.box105.value.box}`);
});

test('choice answers name the right box or line from tax-facts.js', () => {
  const right = (id) => { const q = Q.get(id); return q.options[q.answer].text; };
  assert.equal(right('ft2030-s1-u3-l1-q2'), `Box ${SLIPS.T4.box14.value.box}`);
  assert.equal(right('ft2030-s1-u3-l1-q5'), `Box ${SLIPS.T4.box16.value.box}`);
  assert.equal(right('ft2030-s1-u3-l1-q7'), `Box ${SLIPS.T4.box14.value.box}`);
  assert.equal(right('ft2030-s1-u3-l1-q9'), `Box ${SLIPS.T4.box22.value.box}`);
  assert.equal(right('ft2030-s1-u3-l2-q2'), `Box ${SLIPS.T5.box13.value.box}`);
  assert.equal(right('ft2030-s1-u3-l2-q9'), `A T5, box ${SLIPS.T5.box13.value.box}`);
  assert.equal(right('ft2030-s1-u3-l3-q1'), `Line ${T1_LINES.line15000.value.line}`);
  assert.equal(right('ft2030-s1-u3-l3-q2'), `Line ${T1_LINES.line20800.value.line}`);
  assert.equal(right('ft2030-s1-u3-l3-q3'), `Line ${T1_LINES.line43700.value.line}`);
  assert.equal(right('ft2030-s1-u3-l3-q4'), `Line ${T1_LINES.line48400.value.line}`);
  assert.equal(right('ft2030-s1-u3-l3-q5'), `Line ${SLIPS.T4.box14.value.line}`);
  assert.equal(SLIPS.T4.box22.value.line, T1_LINES.line43700.value.line);
  assert.equal(SLIPS.T4.box14.value.line, T1_LINES.line10100.value.line);
});

test('return-line tables: line numbers and names from tax-facts.js, in order', () => {
  const rows = (ns) => ns.map((n) => [String(T1_LINES[`line${n}`].value.line), T1_LINES[`line${n}`].value.name]);
  const t1 = unit.levels[2].cards[1].figure, t2 = unit.levels[2].cards[3].figure;
  assert.deepEqual(t1.columns, ['Line', 'What it is']);
  assert.deepEqual(t1.rows, rows([10100, 12100, 15000, 20800, 23600, 26000]));
  assert.deepEqual(t2.rows, rows([30000, 30800, 31200, 31260, 42000, 43700, 48400, 48500]));
  for (const t of [t1, t2]) { const n = t.rows.map((r) => Number(r[0])); assert.deepEqual(n, [...n].sort((x, y) => x - y)); }
  assert.deepEqual(unit.levels[2].cards[5].figure.rows, [['T4, box 14', money(a.box14)], ['T5, box 13', money(A.t5s[0].box13Interest)], ['RRSP receipt', money(A.rrspReceipts[0])]]);
  assert.deepEqual(Q.get('ft2030-s1-u3-l3-q7').figure.rows.map((r) => r[1]), [c1.box14, c2.box14, C.t5s[0].box13Interest].map(money));
  assert.ok(textOf(3).includes('2025 return'));
});
