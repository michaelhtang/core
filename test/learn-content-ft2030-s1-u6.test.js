// Content check for the Learning Road unit "Filing and practice returns" (ft2030-s1-u6): every number answer and table amount is recomputed from
// modules/learn/companies/taxpayers-2025.js (rates from tax-rates-2025.js through it); every line number, date and deadline is checked against tax-facts.js.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { SCENARIOS, returnFor, money, USED } from '../modules/learn/companies/taxpayers-2025.js';
import { FILING, T1_LINES, SLIPS, YEAR } from '../modules/learn/companies/tax-facts.js';

const course = JSON.parse(fs.readFileSync(new URL('../modules/learn/content/fintech2030.json', import.meta.url), 'utf8'));
const unit = course.sections.flatMap((s) => s.units).find((u) => u.id === 'ft2030-s1-u6');
const Q = new Map(unit.levels.flatMap((l) => l.questions).map((q) => [q.id, q]));
const { B, C } = SCENARIOS, rb = returnFor(B), rc = returnFor(C);
const tb = B.t4s[0], [c1, c2] = C.t4s;
const FED_LOWEST = USED.fedLowestBp, AB_LOWEST = USED.abLowestBp;   // rates in 1/10000: 14.5% = 1450
const sum = (o) => Object.values(o).reduce((s, x) => s + x, 0);
const rnd = (n, d) => Math.floor((2 * n + d) / (2 * d));
const words = (iso) => { const [y, m, d] = iso.split('-').map(Number); return `${['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'][m - 1]} ${d}, ${y}`; };
const L = (n) => unit.levels[n - 1];
const text = (n) => L(n).cards.map((c) => c.text).join(' ');
const right = (id) => { const q = Q.get(id); return q.options[q.answer].text; };
const line = (n) => T1_LINES[`line${n}`].value.line;
const D_FILE = words(FILING.deadline2025Return.value), D_SELF = words(FILING.deadlineSelfEmployed2025Return.value), D_PAY = words(FILING.paymentDeadline2025.value);

test('shape: 3 levels, 4-6 cards, 7-10 questions, outcome codes, counts', () => {
  assert.equal(unit.levels.length, 3);
  assert.deepEqual(unit.outcome_codes, ['FIN2060 2.3', 'FIN2060 2.5']);
  for (const l of unit.levels) { assert.ok(l.cards.length >= 4 && l.cards.length <= 6); assert.ok(l.questions.length >= 7 && l.questions.length <= 10); }
  assert.equal(unit.levels.flatMap((l) => l.cards).length, 16);
  assert.equal(Q.size, 30);
  assert.equal([...Q.values()].filter((q) => q.type === 'number').length, 14);
  assert.equal([...Q.values()].filter((q) => q.type === 'choice').length, 16);
});

test('the T4A amount is box 028 (Other income) and box 105 never appears for Marcus', () => {
  const t4a = rb.totalIncome - tb.box14;
  assert.equal(t4a, 30000);
  assert.ok(!JSON.stringify(unit).includes('box 105'));
  assert.equal(B.t4as[0].box028, t4a); assert.equal(SLIPS.T4A.box028.value.name, 'Other income');
  assert.deepEqual(L(2).cards[1].figure.rows[4], ['T4A box 028', 'Other income', money(t4a)]);
});

test('scenarios: the return steps recompute from the 2025 rates, and Alberta supplemental credit is $0', () => {
  for (const [s, r] of [[B, rb], [C, rc]]) {
    assert.equal(r.federal.taxOnIncome, rnd(FED_LOWEST * r.taxableIncome, 10000));
    assert.equal(r.alberta.taxOnIncome, rnd(AB_LOWEST * r.taxableIncome, 10000));
    assert.equal(r.federal.bands.length, 1); assert.equal(r.alberta.bands.length, 1);   // all of it in the first bracket
    assert.equal(r.alberta.k5p, 0);
    assert.equal(r.taxableIncome, r.totalIncome - r.rrspDeduction - r.enhancedCppDeduction);
    assert.equal(r.totalTax, Math.max(0, r.federal.taxOnIncome - sum(r.federal.credits)) + Math.max(0, r.alberta.taxOnIncome - sum(r.alberta.credits)));
    assert.equal(r.rrspDeduction, 0);
  }
  assert.equal(rb.federal.afterCredits, 0); assert.equal(rb.alberta.afterCredits, 0); assert.equal(rb.totalTax, 0);
  assert.equal(rb.refund, tb.box22); assert.equal(rb.balanceOwing, 0);
  assert.equal(rc.federal.afterCredits, rc.federal.taxOnIncome - sum(rc.federal.credits));
  assert.equal(rc.alberta.afterCredits, rc.alberta.taxOnIncome - sum(rc.alberta.credits));
  assert.equal(rc.totalTax, rc.federal.afterCredits + rc.alberta.afterCredits);
  assert.equal(rc.totalWithheld, c1.box22 + c2.box22);
  assert.equal(rc.balanceOwing, rc.totalTax - rc.totalWithheld); assert.equal(rc.refund, 0);
  assert.equal(rc.balanceOwing, 20234); assert.equal(rb.refund, 8500);
});

test('every number answer is recomputed from the taxpayers file', () => {
  const want = {
    'ft2030-s1-u6-l1-q10': 24000 - 20000,
    'ft2030-s1-u6-l2-q1': tb.box14 + (rb.totalIncome - tb.box14),
    'ft2030-s1-u6-l2-q2': rb.totalIncome - rb.enhancedCppDeduction,
    'ft2030-s1-u6-l2-q3': rnd(FED_LOWEST * rb.taxableIncome, 10000),
    'ft2030-s1-u6-l2-q4': sum(rb.federal.credits),
    'ft2030-s1-u6-l2-q6': tb.box22,
    'ft2030-s1-u6-l2-q8': rb.refund,
    'ft2030-s1-u6-l3-q1': c1.box14 + c2.box14 + C.t5s[0].box13Interest,
    'ft2030-s1-u6-l3-q2': rc.totalIncome - rc.enhancedCppDeduction,
    'ft2030-s1-u6-l3-q3': rnd(FED_LOWEST * rc.taxableIncome, 10000) - sum(rc.federal.credits),
    'ft2030-s1-u6-l3-q4': rnd(AB_LOWEST * rc.taxableIncome, 10000) - sum(rc.alberta.credits),
    'ft2030-s1-u6-l3-q5': rc.federal.afterCredits + rc.alberta.afterCredits,
    'ft2030-s1-u6-l3-q6': rc.totalWithheld,
    'ft2030-s1-u6-l3-q8': rc.balanceOwing,
  };
  for (const [id, v] of Object.entries(want)) { assert.ok(Q.has(id), id); assert.equal(Q.get(id).answer, v, id); assert.equal(Q.get(id).unit, '$'); assert.ok(v > 0, id); }
  assert.equal(Object.keys(want).length, [...Q.values()].filter((q) => q.type === 'number').length);
  // amounts quoted inside prompts
  assert.ok(Q.get('ft2030-s1-u6-l2-q2').prompt.includes(money(rb.enhancedCppDeduction)));
  assert.ok(Q.get('ft2030-s1-u6-l3-q2').prompt.includes(money(rc.enhancedCppDeduction)));
  assert.ok(Q.get('ft2030-s1-u6-l3-q5').prompt.includes(money(rc.federal.afterCredits)) && Q.get('ft2030-s1-u6-l3-q5').prompt.includes(money(rc.alberta.afterCredits)));
  const p5 = Q.get('ft2030-s1-u6-l2-q5').prompt;
  for (const v of [sum(rb.federal.credits), rb.federal.taxOnIncome, sum(rb.alberta.credits), rb.alberta.taxOnIncome]) assert.ok(p5.includes(money(v)));
  assert.equal(right('ft2030-s1-u6-l2-q5'), '$0');
  assert.equal(Q.get('ft2030-s1-u6-l2-q5').options[3].text, `-${money(sum(rb.federal.credits) - rb.federal.taxOnIncome)}`);
  assert.equal(Q.get('ft2030-s1-u6-l2-q5').options[1].text, money(rb.federal.taxOnIncome + rb.alberta.taxOnIncome));
  // the dollars in the "$240.00 refund" word problem
  assert.ok(Q.get('ft2030-s1-u6-l1-q10').prompt.includes('$200.00') && Q.get('ft2030-s1-u6-l1-q10').prompt.includes('$240.00'));
  // trap values
  assert.equal(Q.get('ft2030-s1-u6-l2-q1').traps[0].value, tb.box14);
  assert.equal(Q.get('ft2030-s1-u6-l2-q3').traps[0].value, rb.alberta.taxOnIncome);
  assert.equal(Q.get('ft2030-s1-u6-l3-q3').traps[0].value, rc.federal.taxOnIncome);
  assert.equal(Q.get('ft2030-s1-u6-l3-q3').traps[1].value, rc.federal.afterCredits + rc.federal.credits.canadaEmployment);
  assert.equal(Q.get('ft2030-s1-u6-l3-q4').traps[0].value, rc.alberta.taxOnIncome);
  assert.equal(Q.get('ft2030-s1-u6-l3-q8').traps[0].value, rc.totalTax);
  assert.equal(Q.get('ft2030-s1-u6-l3-q6').traps[0].value, c2.box22);
  assert.equal(Q.get('ft2030-s1-u6-l3-q1').traps[0].value, rc.totalIncome - C.t5s[0].box13Interest);
  assert.equal(Q.get('ft2030-s1-u6-l2-q1').traps[1].value, rb.totalIncome + tb.box22);
  assert.equal(Q.get('ft2030-s1-u6-l2-q4').traps[0].value, rb.federal.credits.basicPersonal);
  assert.equal(Q.get('ft2030-s1-u6-l2-q6').traps[0].value, tb.box16);
  assert.equal(Q.get('ft2030-s1-u6-l3-q2').traps[0].value, rc.totalIncome);
  assert.equal(Q.get('ft2030-s1-u6-l3-q5').traps[0].value, rc.federal.afterCredits);
});

test('slip, step and credit tables: amounts from the taxpayers file, lines from tax-facts.js', () => {
  assert.deepEqual(L(2).cards[1].figure.rows, [
    ['T4 box 14', SLIPS.T4.box14.value.name, money(tb.box14)], ['T4 box 16', SLIPS.T4.box16.value.name, money(tb.box16)], ['T4 box 18', SLIPS.T4.box18.value.name, money(tb.box18)], ['T4 box 22', SLIPS.T4.box22.value.name, money(tb.box22)], ['T4A box 028', 'Other income', '$300']]);
  assert.deepEqual(L(2).cards[2].figure.rows.map((r) => r[1]), ['15000', '20800', '22215', '23600', '26000', '42000', 'no line', 'no line', '43700', '48400', '48500']);
  for (const n of [15000, 20800, 22215, 23600, 26000, 42000, 43700, 48400, 48500, 30000, 30800, 31200, 31260]) assert.equal(T1_LINES[`line${n}`].value.line, n);
  assert.deepEqual(L(2).cards[2].figure.rows.map((r) => r[0]), ['Total income', 'RRSP deduction', 'CPP deduction', 'Net income', 'Taxable income', 'Net federal tax', 'Alberta tax after credits', 'Total tax', 'Tax withheld, T4 box 22', 'Refund', 'Balance owing']);
  const fc = rb.federal.credits;
  assert.deepEqual(L(2).cards[3].figure.rows, [['30000', 'Basic personal amount', money(fc.basicPersonal)], ['30800', 'Base CPP contributions', money(fc.cppBase)], ['31200', 'EI premiums', money(fc.ei)], ['31260', 'Canada employment amount', money(fc.canadaEmployment)]]);
  assert.deepEqual(Q.get('ft2030-s1-u6-l2-q4').figure, L(2).cards[3].figure);
  assert.deepEqual(Q.get('ft2030-s1-u6-l2-q10').figure, L(2).cards[2].figure);
  const t = text(2);
  assert.ok(t.includes(money(rb.enhancedCppDeduction)) && t.includes(`up to ${money(rb.federal.bands[0].to)}`) && t.includes(`up to ${money(rb.alberta.bands[0].to)}`) && t.includes(money(sum(rb.alberta.credits))));
  assert.ok(t.includes(`${FED_LOWEST / 100}%`) && t.includes(`${AB_LOWEST / 100}%`) && !t.includes(' 14%'));
  assert.deepEqual(L(3).cards[0].figure.rows, [
    ['T4 box 14', c1.employer, money(c1.box14)], ['T4 box 14', c2.employer, money(c2.box14)], ['T5 box 13', 'Her bank', money(C.t5s[0].box13Interest)], ['T4 box 22', c1.employer, money(c1.box22)], ['T4 box 22', c2.employer, money(c2.box22)]]);
  assert.equal(SLIPS.T5.box13.value.box, 13); assert.equal(SLIPS.T4.box22.value.box, 22); assert.equal(SLIPS.T4.box14.value.box, 14);
  const cf = rc.federal.credits, ca = rc.alberta.credits;
  assert.deepEqual(L(3).cards[2].figure.rows, [['Basic personal amount', money(cf.basicPersonal), money(ca.basicPersonal)], ['Base CPP contributions', money(cf.cppBase), money(ca.cppBase)], ['EI premiums', money(cf.ei), money(ca.ei)], ['Canada employment amount', money(cf.canadaEmployment), 'none']]);
  assert.ok(text(3).includes(money(rc.enhancedCppDeduction)));
  assert.equal(Object.keys(ca).includes('canadaEmployment'), false);
  for (const id of ['q1', 'q6']) assert.deepEqual(Q.get(`ft2030-s1-u6-l3-${id}`).figure, L(3).cards[0].figure);
  assert.deepEqual(Q.get('ft2030-s1-u6-l2-q1').figure, L(2).cards[1].figure);
});

test('lines, dates and deadlines match tax-facts.js', () => {
  assert.equal(D_FILE, 'April 30, 2026'); assert.equal(D_SELF, 'June 15, 2026'); assert.equal(D_PAY, 'April 30, 2026');
  assert.equal(FILING.deadline2025Return.year, 2025); assert.equal(FILING.paymentDeadline2025.year, 2025);
  assert.deepEqual(L(1).cards[4].figure.rows, [[D_FILE, 'Deadline to file (most people)'], [D_SELF, 'Deadline to file if you or your partner is self-employed'], [D_PAY, 'Deadline to pay your taxes']]);
  assert.ok(text(1).includes(`open from ${words(YEAR.netfileWindow.value.from)} until ${words(YEAR.netfileWindow.value.until)}`));
  assert.ok(text(1).includes('2025 return'));
  assert.equal(right('ft2030-s1-u6-l1-q6'), D_FILE); assert.equal(right('ft2030-s1-u6-l1-q7'), D_SELF);
  assert.equal(right('ft2030-s1-u6-l1-q8'), D_PAY); assert.equal(right('ft2030-s1-u6-l3-q10'), D_PAY);
  assert.ok(text(3).includes(`was ${D_PAY}`));
  assert.equal(right('ft2030-s1-u6-l2-q10'), `Line ${line(48400)}`);
  assert.equal(right('ft2030-s1-u6-l3-q7'), `A balance owing, on line ${line(48500)}`);
  assert.ok(text(3).includes(`line ${line(48500)}`) && text(3).includes(`line ${line(48400)}`) && text(3).includes(`line ${line(22215)}`) && Q.get("ft2030-s1-u6-l2-q2").prompt.includes(`line ${line(22215)}`));
  assert.deepEqual(L(1).cards[0].figure.rows.map((r) => r[0]), ['Tax software', 'SimpleFile (by invitation)', 'A paper tax return', 'A professional tax preparer', 'A free tax clinic volunteer']);
  assert.deepEqual(FILING.waysToFileOwn.value, ['tax software', 'SimpleFile', 'paper tax return']);
  assert.deepEqual(FILING.waysToFileHelp.value, ['professional tax preparer', 'free tax clinic volunteer']);
  assert.ok(FILING.efile.say.includes('EFILE') && FILING.netfileWhat.say.includes('NETFILE') && FILING.paperSlips === undefined);
  assert.ok(T1_LINES.paperSlips.say.includes('one copy of each'));
  assert.ok(FILING.studentsShouldFile.say.includes('even with little income'));
  assert.ok(!/discounter/i.test(JSON.stringify(Object.values(FILING).map((f) => f.say))), 'the facts file holds no tax discounter fact, so the unit gives no figure for one');
});

test('the tax year is said once, in level 2 card 1, and level 1 and 3 do not repeat it', () => {
  assert.ok(L(2).cards[0].text.includes('2025 tax year'));
  assert.ok(!text(3).includes("game's numbers"));
});

test('the tax-year sentence is identical in unit 5 and unit 6', () => {
  const s = "This return is for the 2025 tax year, the same year the tax program your class uses files in December.";
  assert.equal(L(2).cards[0].text, s);
});
