// Content check for the Learning Road unit "A return by hand" (ft2030-s1-u5): every number answer and table amount is recomputed from
// modules/learn/companies/taxpayers-2025.js (rates and limits from tax-rates-2025.js through it), every line and box number is checked against tax-facts.js, and the
// without-RRSP comparison is recomputed from the taxpayers file's own returnFor.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { SCENARIOS, returnFor, money, USED } from '../modules/learn/companies/taxpayers-2025.js';
import * as P from '../modules/learn/companies/tax-rates-2025.js';
import { SLIPS, T1_LINES } from '../modules/learn/companies/tax-facts.js';

const course = JSON.parse(fs.readFileSync(new URL('../modules/learn/content/fintech2030.json', import.meta.url), 'utf8'));
const unit = course.sections.flatMap((s) => s.units).find((u) => u.id === 'ft2030-s1-u5');
const Q = new Map(unit.levels.flatMap((l) => l.questions).map((q) => [q.id, q]));
const { A } = SCENARIOS;
const t4 = A.t4s[0], r = returnFor(A);
const rn = returnFor({ ...A, rrspReceipts: [] });                // Priya's return with no RRSP deduction
const FED_LOWEST = USED.fedLowestBp, AB_LOWEST = USED.abLowestBp, TC = USED.fedBpa, TCP = USED.abBpa, CEA = USED.canadaEmployment;   // rates in 1/10000: 14.5% = 1450
const L = (n) => T1_LINES[`line${n}`].value.line;
const sum = (o) => Object.values(o).reduce((s, x) => s + x, 0);
const credit = (rateBp, amount) => Math.floor((2 * rateBp * amount + 10000) / 20000);   // amount x rate, to the nearest cent, half up
const cppBase = t4.box16 - r.enhancedCppDeduction;
const textOf = (l) => unit.levels[l - 1].cards.map((c) => c.text).join(' ');
const rightText = (id) => { const q = Q.get(id); return q.options[q.answer].text; };

test('shape: 3 levels, 4-6 cards, 7-10 questions, outcome code, no go button, no pictures', () => {
  assert.equal(unit.levels.length, 3);
  assert.deepEqual(unit.outcome_codes, ['FIN2060 2.3']);
  assert.equal(unit.title, 'A return by hand');
  for (const l of unit.levels) { assert.ok(l.cards.length >= 4 && l.cards.length <= 6); assert.ok(l.questions.length >= 7 && l.questions.length <= 10); assert.equal(l.go, undefined); }
  assert.equal(unit.levels.flatMap((l) => l.cards).length, 17);
  assert.equal(Q.size, 29);
  assert.equal([...Q.values()].filter((q) => q.type === 'number').length, 19);
  assert.equal([...Q.values()].filter((q) => q.type === 'choice').length, 10);
});

test('scenario A sits in the first band of both tables, K5P is 0, and the CPP splits into deduction + credit parts', () => {
  assert.equal(r.federal.bands.length, 1); assert.equal(r.alberta.bands.length, 1); assert.equal(r.alberta.k5p, 0);
  assert.equal(FED_LOWEST, 1450); assert.equal(AB_LOWEST, 800);   // 14.5% for the whole 2025 year, and 8%
  assert.equal(TC, 1612900); assert.equal(TCP, 2232300); assert.equal(CEA, 147100); assert.equal(r.federal.bands[0].to, 5737500); assert.equal(r.alberta.bands[0].to, 6000000);
  assert.equal(P.FED_BPA.value, TC); assert.equal(P.AB_BPA.value, TCP); assert.equal(P.CANADA_EMPLOYMENT_AMOUNT.value, CEA); assert.equal(P.FED_BRACKETS[0].value.to, 5737500); assert.equal(P.AB_BRACKETS[0].value.to, 6000000);
  assert.equal(r.enhancedCppDeduction + cppBase, t4.box16);
  assert.equal(credit(FED_LOWEST, cppBase), r.federal.credits.cppBase); assert.equal(credit(AB_LOWEST, cppBase), r.alberta.credits.cppBase);
  assert.equal(money(r.totalIncome), '$27,563.50');
});

test('every number answer is recomputed from the taxpayers file and the 2025 rates', () => {
  const fedAmt = { basicPersonal: TC, cppBase, ei: t4.box18, canadaEmployment: Math.min(t4.box14, CEA) };
  const abAmt = { basicPersonal: TCP, cppBase, ei: t4.box18 };
  const interest = A.t5s[0].box13Interest, rrsp = A.rrspReceipts[0];
  const want = {
    'ft2030-s1-u5-l1-q2': t4.box14 + interest,
    'ft2030-s1-u5-l1-q5': t4.box16 - cppBase,
    'ft2030-s1-u5-l1-q6': rrsp + r.enhancedCppDeduction,
    'ft2030-s1-u5-l1-q7': r.totalIncome - r.rrspDeduction - r.enhancedCppDeduction,
    'ft2030-s1-u5-l1-q9': t4.box14 + interest - rrsp - r.enhancedCppDeduction,
    'ft2030-s1-u5-l2-q1': credit(FED_LOWEST, r.taxableIncome),
    'ft2030-s1-u5-l2-q3': credit(FED_LOWEST, fedAmt.basicPersonal),
    'ft2030-s1-u5-l2-q4': credit(FED_LOWEST, cppBase),
    'ft2030-s1-u5-l2-q5': credit(FED_LOWEST, fedAmt.ei),
    'ft2030-s1-u5-l2-q6': credit(FED_LOWEST, fedAmt.canadaEmployment),
    'ft2030-s1-u5-l2-q8': sum(r.federal.credits),
    'ft2030-s1-u5-l2-q9': credit(FED_LOWEST, r.taxableIncome) - sum(r.federal.credits),
    'ft2030-s1-u5-l3-q1': credit(AB_LOWEST, r.taxableIncome),
    'ft2030-s1-u5-l3-q2': credit(AB_LOWEST, abAmt.basicPersonal),
    'ft2030-s1-u5-l3-q3': sum(r.alberta.credits),
    'ft2030-s1-u5-l3-q4': credit(AB_LOWEST, r.taxableIncome) - sum(r.alberta.credits),
    'ft2030-s1-u5-l3-q5': r.federal.afterCredits + r.alberta.afterCredits,
    'ft2030-s1-u5-l3-q7': t4.box22 - r.totalTax,
    'ft2030-s1-u5-l3-q9': rn.totalTax - r.totalTax,
  };
  for (const [id, v] of Object.entries(want)) { assert.ok(Q.has(id), id); assert.equal(Q.get(id).answer, v, id); }
  assert.equal(Object.keys(want).length, [...Q.values()].filter((q) => q.type === 'number').length);
  // the same answers from the file's own return
  const g = (id) => Q.get(`ft2030-s1-u5-${id}`).answer;
  assert.equal(g('l1-q2'), r.totalIncome); assert.equal(g('l1-q5'), r.enhancedCppDeduction); assert.equal(g('l1-q7'), r.netIncome); assert.equal(g('l1-q9'), r.taxableIncome);
  assert.equal(g('l2-q1'), r.federal.taxOnIncome); assert.equal(g('l2-q3'), r.federal.credits.basicPersonal); assert.equal(g('l2-q4'), r.federal.credits.cppBase);
  assert.equal(g('l2-q5'), r.federal.credits.ei); assert.equal(g('l2-q6'), r.federal.credits.canadaEmployment); assert.equal(g('l2-q9'), r.federal.afterCredits);
  assert.equal(g('l3-q1'), r.alberta.taxOnIncome); assert.equal(g('l3-q2'), r.alberta.credits.basicPersonal); assert.equal(g('l3-q4'), r.alberta.afterCredits);
  assert.equal(g('l3-q5'), r.totalTax); assert.equal(g('l3-q7'), r.refund);
  for (const q of Q.values()) if (q.type === 'number') { assert.equal(q.unit, '$'); assert.equal(q.tolerance, 1); }
});

test('the amounts quoted in prompts are the file\'s amounts, and every trap is a real wrong answer', () => {
  const m = money, has = (id, ...cents) => cents.forEach((c) => assert.ok(Q.get(`ft2030-s1-u5-${id}`).prompt.includes(m(c)), `${id} ${m(c)}`));
  has('l1-q2', t4.box14, A.t5s[0].box13Interest); has('l1-q5', t4.box16, cppBase); has('l1-q6', r.rrspDeduction, r.enhancedCppDeduction);
  has('l1-q7', r.totalIncome, r.rrspDeduction + r.enhancedCppDeduction); has('l1-q9', t4.box14, A.t5s[0].box13Interest, r.rrspDeduction, r.enhancedCppDeduction);
  has('l2-q1', r.taxableIncome); has('l2-q3', TC); has('l2-q4', cppBase); has('l2-q5', t4.box18); has('l2-q6', Math.min(t4.box14, CEA));
  has('l2-q8', ...Object.values(r.federal.credits)); has('l2-q9', r.federal.taxOnIncome, sum(r.federal.credits));
  has('l3-q1', r.taxableIncome); has('l3-q2', TCP); has('l3-q3', ...Object.values(r.alberta.credits)); has('l3-q4', r.alberta.taxOnIncome, sum(r.alberta.credits));
  has('l3-q5', r.federal.afterCredits, r.alberta.afterCredits); has('l3-q7', r.totalTax, t4.box22); has('l3-q8', r.totalTax, t4.box22);
  has('l3-q9', rn.taxableIncome, rn.totalTax); has('l3-q10', rn.totalWithheld, rn.totalTax);
  const trap = (id, i) => Q.get(`ft2030-s1-u5-${id}`).traps[i].value;
  assert.equal(trap('l1-q2', 0), t4.box14); assert.equal(trap('l1-q5', 0), cppBase); assert.equal(trap('l1-q5', 1), t4.box16);
  assert.equal(trap('l1-q7', 0), r.totalIncome - r.rrspDeduction); assert.equal(trap('l1-q9', 1), r.totalIncome - r.rrspDeduction);
  assert.equal(trap('l2-q4', 0), credit(FED_LOWEST, t4.box16)); assert.equal(trap('l2-q9', 0), r.federal.taxOnIncome);
  assert.equal(trap('l3-q1', 0), r.federal.taxOnIncome); assert.equal(trap('l3-q5', 0), r.federal.afterCredits);
  assert.equal(trap('l3-q7', 0), t4.box22); assert.equal(trap('l3-q9', 0), r.rrspDeduction);
  for (const q of Q.values()) for (const t of q.traps ?? []) assert.notEqual(t.value, q.answer, q.id);
});

test('the rates and band edges quoted on the cards are the pinned 2025 figures', () => {
  assert.ok(textOf(2).includes(`${FED_LOWEST / 100}%`) && textOf(2).includes(money(r.federal.bands[0].to)));
  assert.ok(textOf(3).includes(`${AB_LOWEST / 100}%`) && textOf(3).includes(money(r.alberta.bands[0].to)));
  assert.ok(textOf(2).includes(money(r.taxableIncome)));
  assert.ok(textOf(3).includes(`${money(r.rrspDeduction)} higher`));
  assert.ok(textOf(1).includes("This return is for the 2025 tax year, the same year the tax program your class uses files in December."), 'the tax-year card');
});

const STEP = ['Step', 'Amount'];
test('tables: every amount from the taxpayers file, every line number and name from tax-facts.js', () => {
  const m = money, c = (l, i) => unit.levels[l - 1].cards[i].figure;
  assert.deepEqual(c(1, 2).columns, STEP);
  assert.deepEqual(c(1, 2).rows, [[`T4 box 14 (line ${SLIPS.T4.box14.value.line})`, m(t4.box14)], ['T5 box 13', m(A.t5s[0].box13Interest)], [`Total income (line ${L(15000)})`, '?']]);
  assert.deepEqual(c(1, 5).rows, [[`Total income (line ${L(15000)})`, m(r.totalIncome)], [`RRSP deduction (line ${L(20800)})`, m(r.rrspDeduction)], [`CPP deduction (line ${L(22215)})`, '?'], [`Net income (line ${L(23600)})`, '?'], [`Taxable income (line ${L(26000)})`, '?']]);
  assert.deepEqual(c(2, 3).columns, ['Credit', 'Amount', 'Line']);
  assert.deepEqual(c(2, 3).rows, [
    ['Basic personal amount', m(TC), String(L(30000))], ['Base CPP contributions', m(cppBase), String(L(30800))],
    ['EI premiums', m(t4.box18), String(L(31200))], ['Canada employment amount', m(Math.min(t4.box14, CEA)), String(L(31260))]]);
  assert.deepEqual(c(2, 4).rows[0], [`Taxable income (line ${L(26000)})`, m(r.taxableIncome)]);
  assert.ok(c(2, 4).rows[3][0].includes(String(L(42000))));
  assert.deepEqual(c(3, 1).rows, [['Basic personal amount', m(TCP)], ['Base CPP contributions', m(cppBase)], ['EI premiums', m(t4.box18)]]);
  assert.deepEqual(c(3, 4).columns, STEP);
  assert.deepEqual(c(3, 4).rows, [
    [`Total income (${L(15000)})`, m(r.totalIncome)], [`RRSP deduction (${L(20800)})`, m(r.rrspDeduction)], [`CPP deduction (${L(22215)})`, m(r.enhancedCppDeduction)],
    [`Net income (${L(23600)})`, m(r.netIncome)], [`Taxable income (${L(26000)})`, m(r.taxableIncome)], [`Net federal tax (${L(42000)})`, m(r.federal.afterCredits)],
    ['Alberta tax after credits', m(r.alberta.afterCredits)], ['Total tax', m(r.totalTax)], [`Tax withheld, T4 box 22 (${L(43700)})`, m(r.totalWithheld)], [`Refund (${L(48400)})`, m(r.refund)]]);
  assert.deepEqual(c(3, 5).rows, [
    ['Taxable income', m(r.taxableIncome), m(rn.taxableIncome)], ['Total tax', m(r.totalTax), '?'], ['Tax withheld', m(r.totalWithheld), m(rn.totalWithheld)], ['Refund or owing', `${m(r.refund)} refund`, '?']]);
  // the credits table adds up as the chain says
  assert.equal(sum(r.federal.credits), r.federal.credits.basicPersonal + r.federal.credits.cppBase + r.federal.credits.ei + r.federal.credits.canadaEmployment);
  assert.equal(r.federal.afterCredits + r.alberta.afterCredits, r.totalTax);
  assert.equal(r.totalWithheld - r.totalTax, r.refund);
});

test('line and box numbers: every one in the unit is in tax-facts.js with the meaning the unit gives it', () => {
  assert.equal(L(15000), 15000); assert.equal(T1_LINES.line15000.value.name, 'Total income');
  assert.equal(T1_LINES.line20800.value.name, 'RRSP deduction');
  assert.equal(T1_LINES.line22215.value.name, 'Deduction for CPP or QPP enhanced contributions on employment income');
  assert.equal(T1_LINES.line23600.value.name, 'Net income'); assert.equal(T1_LINES.line26000.value.name, 'Taxable income');
  assert.equal(T1_LINES.line42000.value.name, 'Net federal tax'); assert.equal(T1_LINES.line43700.value.name, 'Total income tax deducted');
  assert.equal(T1_LINES.line48400.value.name, 'Refund'); assert.equal(T1_LINES.line48500.value.name, 'Balance owing');
  assert.equal(T1_LINES.line30000.value.name, 'Basic personal amount'); assert.equal(T1_LINES.line30800.value.name, 'Base CPP or QPP contributions through employment income');
  assert.equal(T1_LINES.line31200.value.name, 'Employment insurance premiums through employment'); assert.equal(T1_LINES.line31260.value.name, 'Canada employment amount');
  assert.equal(SLIPS.T4.box14.value.line, L(10100)); assert.equal(SLIPS.T4.box22.value.line, L(43700)); assert.equal(SLIPS.T4.box18.value.line, L(31200));
  assert.equal(SLIPS.T4.box14.value.box, 14); assert.equal(SLIPS.T4.box16.value.box, 16); assert.equal(SLIPS.T4.box18.value.box, 18); assert.equal(SLIPS.T4.box22.value.box, 22);
  assert.equal(SLIPS.T5.box13.value.box, 13); assert.equal(L(12100), 12100);
  // box 16 feeds lines 30800 and 22215 (the facts file's quote)
  assert.ok(SLIPS.T4.box16.quote.includes('line 30800') && SLIPS.T4.box16.quote.includes('line 22215'));
  // the right choice names the right line or box
  const R = (id) => rightText(`ft2030-s1-u5-${id}`);
  assert.equal(R('l1-q1'), `Line ${L(15000)}`); assert.equal(R('l1-q4'), `Line ${L(22215)}`);
  assert.equal(R('l2-q7'), `Line ${L(31200)}`); assert.equal(R('l2-q10'), `Line ${L(42000)}`);
  assert.equal(R('l3-q6'), `Box ${SLIPS.T4.box22.value.box}, line ${L(43700)}`);
  // every wrong option that names a line or box names a real one
  const known = new Set([...Object.values(T1_LINES).map((x) => x.value?.line), ...Object.values(SLIPS.T4).map((x) => x.value.line)].filter(Boolean).map(String));
  for (const q of Q.values()) if (q.type === 'choice') for (const o of q.options) for (const [, n] of o.text.matchAll(/[Ll]ine (\d{5})/g)) assert.ok(known.has(n), `${q.id}: ${n}`);
});

test('choice questions with money: right option recomputed, one right answer', () => {
  assert.equal(r.refund > 0 && r.balanceOwing === 0, true); assert.equal(rightText('ft2030-s1-u5-l3-q8'), 'A refund');
  assert.equal(rightText('ft2030-s1-u5-l1-q3'), 'Her RRSP receipt');
  assert.equal(rightText('ft2030-s1-u5-l1-q8'), 'They are the same amount'); assert.equal(r.netIncome, r.taxableIncome);
  assert.equal(rightText('ft2030-s1-u5-l2-q2'), 'It lowers the tax you owe, but not below $0');
  assert.equal(rightText('ft2030-s1-u5-l3-q10'), `A balance owing of ${money(rn.balanceOwing)}`);
});

test('without the RRSP deduction: recomputed from returnFor, and it is a balance owing', () => {
  assert.equal(rn.rrspDeduction, 0); assert.equal(rn.taxableIncome, r.taxableIncome + r.rrspDeduction);
  assert.equal(rn.totalWithheld, r.totalWithheld);
  assert.deepEqual(rn.federal.credits, r.federal.credits); assert.deepEqual(rn.alberta.credits, r.alberta.credits);
  assert.equal(rn.totalTax, credit(FED_LOWEST, rn.taxableIncome) - sum(r.federal.credits) + credit(AB_LOWEST, rn.taxableIncome) - sum(r.alberta.credits));
  assert.equal(rn.totalTax - r.totalTax, 27000);                       // 22.5% of $1,200.00
  assert.equal(rn.totalTax - r.totalTax, credit(FED_LOWEST + AB_LOWEST, r.rrspDeduction));
  assert.equal(rn.refund, 0); assert.equal(rn.balanceOwing, rn.totalTax - rn.totalWithheld); assert.equal(rn.balanceOwing, 2116);
  assert.equal(r.refund - 0 + rn.balanceOwing, rn.totalTax - r.totalTax);   // the swing from a refund to owing is the whole drop
  const q = Q.get('ft2030-s1-u5-l3-q10');
  assert.deepEqual(q.options.map((o) => o.text).sort(), [`A balance owing of ${money(rn.balanceOwing)}`, `A balance owing of ${money(rn.totalTax - r.totalTax)}`, `A refund of ${money(rn.balanceOwing)}`, `A refund of ${money(r.refund)}`].sort());
});

test('glossary terms on questions are the taxpayers file\'s wording', async () => {
  const { GLOSSARY } = await import('../modules/learn/companies/taxpayers-2025.js');
  for (const q of Q.values()) for (const t of q.terms ?? []) assert.equal(t.meaning, GLOSSARY[t.term], `${q.id} ${t.term}`);
});
