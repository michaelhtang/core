// The 2025 running example of the FinTech 20 tax section (modules/learn/companies/taxpayers-2025.js): every figure pinned as literal cents, recomputed here
// with plain arithmetic, and every rate used checked against the pinned facts in tax-rates-2025.js.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SCENARIOS, returnFor, money, GLOSSARY, USED } from '../modules/learn/companies/taxpayers-2025.js';
import * as P from '../modules/learn/companies/tax-rates-2025.js';

const T4_BOXES = ['box14', 'box16', 'box16A', 'box18', 'box22', 'box24', 'box26'];
// [scenario, T4 index, box14, 16, 16A, 18, 22, 24, 26]
const T4S = [
  ['A', 0, 2750000, 142800, 0, 45100, 142000, 2750000, 2750000],
  ['B', 0, 860000, 42493, 0, 14104, 8500, 860000, 860000],
  ['C', 0, 1350000, 69913, 0, 22140, 110000, 1350000, 1350000],
  ['C', 1, 2100000, 114538, 0, 34440, 185000, 2100000, 2100000],
];
// [scenario, total income, RRSP, line 22215, net = taxable, fed on income, fed credits (BPA, CPP, EI, CEA), fed after, AB on income, AB credits (BPA, CPP, EI), AB after, total tax, withheld, refund, owing]
const RETURNS = [
  ['A', 2756350, 120000, 24000, 2612350, 378791, [233871, 17226, 6540, 21330], 99824, 208988, [178584, 9504, 3608], 17292, 117116, 142000, 24884, 0],
  ['B', 890000, 0, 7142, 882858, 128014, [233871, 5126, 2045, 21330], 0, 70629, [178584, 2828, 1128], 0, 0, 8500, 8500, 0],
  ['C', 3570000, 0, 31000, 3539000, 513155, [233871, 22250, 8204, 21330], 227500, 283120, [178584, 12276, 4526], 87734, 315234, 295000, 0, 20234],
];
const sum = (xs) => xs.reduce((s, x) => s + x, 0);
const half = (n, d) => Math.floor((2 * n + d) / (2 * d));

test('every T4 box is pinned', () => {
  for (const [id, i, ...boxes] of T4S) assert.deepEqual(T4_BOXES.map((b) => SCENARIOS[id].t4s[i][b]), boxes, `${id}${i}`);
  assert.equal(SCENARIOS.C.t4s.length, 2);
  assert.deepEqual(SCENARIOS.B.t4s[0].months, [8, 9, 10, 11, 12]);
  assert.deepEqual(SCENARIOS.A.t4s.map((t) => t.employer), ['Maple Street Grill']);
  assert.deepEqual(SCENARIOS.B.t4s.map((t) => t.employer), ['Agora Coffee Co.']);
  assert.deepEqual(SCENARIOS.C.t4s.map((t) => t.employer), ['Prairie Threads', 'Beacon Business Services']);
});

test('CPP, CPP2 and EI on each T4 are recomputed from the 2025 formulas', () => {
  for (const [id, i, b14, b16, b16A, b18] of T4S) {
    const t = SCENARIOS[id].t4s[i];
    assert.equal(half(595 * (Math.min(t.box14, 7130000) - half(350000 * t.months.length, 12)), 10000), b16, `${id}${i} CPP`);
    assert.equal(half(400 * Math.max(0, Math.min(t.box14, 8120000) - 7130000), 10000), b16A, `${id}${i} CPP2`);
    assert.equal(half(164 * Math.min(t.box14, 6570000), 10000), b18, `${id}${i} EI`);
    assert.equal(t.box14, b14);
  }
});

test('the CPP exemption is prorated by months worked', () => {
  assert.equal(half(350000 * 6, 12), 175000);   // each of C's two six-month T4s
  assert.equal(half(350000 * 5, 12), 145833);   // B
  const c = SCENARIOS.C.t4s;
  assert.ok(Math.abs(sum(c.map((t) => t.box16)) - half(595 * (sum(c.map((t) => t.box14)) - 350000), 10000)) <= 1);   // within a cent of one year's formula
});

test('the other slips are pinned', () => {
  const OTHER = [['A', 6350, 0, 120000], ['B', 0, 30000, 0], ['C', 120000, 0, 0]];
  for (const [id, interest, otherIncome, rrsp] of OTHER) {
    const s = SCENARIOS[id];
    assert.deepEqual([sum(s.t5s.map((x) => x.box13Interest)), sum(s.t4as.map((x) => x.box028)), sum(s.rrspReceipts)], [interest, otherIncome, rrsp], id);
  }
});

test('each return step is pinned', () => {
  for (const [id, total, rrsp, f5, net, fedTax, fedCr, fedAfter, abTax, abCr, abAfter, tax, withheld, refund, owing] of RETURNS) {
    const r = returnFor(SCENARIOS[id]);
    assert.deepEqual([r.totalIncome, r.rrspDeduction, r.enhancedCppDeduction, r.netIncome, r.taxableIncome], [total, rrsp, f5, net, net], id);
    assert.deepEqual([r.federal.taxOnIncome, sum(r.federal.bands.map((b) => b.amount)), Object.values(r.federal.credits), r.federal.topUp, r.federal.afterCredits], [fedTax, fedTax, fedCr, 0, fedAfter], id);
    assert.deepEqual([r.alberta.taxOnIncome, sum(r.alberta.bands.map((b) => b.amount)), Object.values(r.alberta.credits), r.alberta.k5p, r.alberta.afterCredits], [abTax, abTax, abCr, 0, abAfter], id);
    assert.deepEqual([r.totalTax, r.totalWithheld, r.refund, r.balanceOwing], [tax, withheld, refund, owing], id);
    assert.equal(r.totalTax, r.federal.afterCredits + r.alberta.afterCredits);
  }
});

test('the three returns are recomputed with plain arithmetic', () => {
  for (const [id] of RETURNS) {
    const s = SCENARIOS[id], r = returnFor(s);
    const emp = sum(s.t4s.map((t) => t.box14)), cpp = sum(s.t4s.map((t) => t.box16)), ei = sum(s.t4s.map((t) => t.box18));
    const base = half(cpp * 495, 595), taxable = emp + sum(s.t5s.map((t) => t.box13Interest)) + sum(s.t4as.map((t) => t.box028)) - sum(s.rrspReceipts) - (cpp - base);
    assert.equal(r.taxableIncome, taxable, id);
    // all three people are under the first brackets: one band each (14.5% federal, 8% Alberta)
    assert.ok(taxable < 5737500 && taxable < 6000000);
    const fedCredits = [half(1450 * 1612900, 10000), half(1450 * base, 10000), half(1450 * ei, 10000), half(1450 * Math.min(emp, 147100), 10000)];
    const abCredits = [half(800 * 2232300, 10000), half(800 * base, 10000), half(800 * ei, 10000)];
    const fed = Math.max(0, half(1450 * taxable, 10000) - sum(fedCredits)), ab = Math.max(0, half(800 * taxable, 10000) - sum(abCredits));
    assert.equal(r.totalTax, fed + ab, id);
  }
});

test('the three stories end the way they should', () => {
  const [a, b, c] = ['A', 'B', 'C'].map((id) => returnFor(SCENARIOS[id]));
  assert.ok(a.refund >= 20000 && a.refund <= 30000 && a.balanceOwing === 0);
  assert.equal(b.totalTax, 0);
  assert.ok(b.totalWithheld > 0 && b.refund === b.totalWithheld);
  assert.ok(c.balanceOwing >= 15000 && c.balanceOwing <= 40000 && c.refund === 0);
  assert.equal(SCENARIOS.C.t4s.length, 2);
  assert.equal(money(a.refund), '$248.84');
  assert.equal(money(b.refund), '$85');
  assert.equal(money(c.balanceOwing), '$202.34');
});

test('every rate and limit used equals tax-rates-2025.js (and the CRA 2025 value)', () => {
  assert.deepEqual(USED, {
    fedLowestBp: P.FED_CREDIT_RATE.value, fedBpa: P.FED_BPA.value, canadaEmployment: P.CANADA_EMPLOYMENT_AMOUNT.value, abLowestBp: P.AB_CREDIT_RATE.value, abBpa: P.AB_BPA.value,
    cppRateBp: P.CPP_RATE.value, cppBaseBp: P.CPP_BASE_RATE.value, cppExemption: P.CPP_EXEMPTION.value, ympe: P.YMPE.value, cppMax: P.CPP_MAX.value,
    cpp2RateBp: P.CPP2_RATE.value, yampe: P.CPP2_YAMPE.value, cpp2Max: P.CPP2_MAX.value, eiRateBp: P.EI_RATE.value, mie: P.EI_MIE.value, eiMax: P.EI_MAX.value,
  });
  assert.deepEqual(USED, { fedLowestBp: 1450, fedBpa: 1612900, canadaEmployment: 147100, abLowestBp: 800, abBpa: 2232300, cppRateBp: 595, cppBaseBp: 495, cppExemption: 350000, ympe: 7130000, cppMax: 403410, cpp2RateBp: 400, yampe: 8120000, cpp2Max: 39600, eiRateBp: 164, mie: 6570000, eiMax: 107748 });
  assert.equal(P.FED_LOWEST_RATE.value, P.FED_BRACKETS[0].value.rateBp);
  assert.equal(P.AB_CREDIT_RATE.value, P.AB_BRACKETS[0].value.rateBp);
  assert.deepEqual(P.FED_BRACKETS.map((x) => x.value.rateBp), [1450, 2050, 2600, 2900, 3300]);
  assert.deepEqual(P.AB_BRACKETS.map((x) => x.value.rateBp), [800, 1000, 1200, 1300, 1400, 1500]);
  assert.equal(P.CPP_BASE_RATE.value + P.CPP_FIRST_ADDITIONAL_RATE.value, P.CPP_RATE.value);
  assert.equal(half(P.CPP_BASE_RATE.value * (P.YMPE.value - P.CPP_EXEMPTION.value), 10000), P.CPP_BASE_MAX.value);
  assert.equal(P.CPP_MAX.value, P.CPP_BASE_MAX.value + 67800);   // $678.00 first additional maximum, in cents
  assert.equal(P.AB_SUPP_BASE.value, half(P.AB_CREDIT_RATE.value * 6000000, 10000));   // $4,800 = 8% of $60,000
});

test('every pinned fact has a short quote, a canada.ca url and a read date', () => {
  const facts = Object.values(P).flatMap((x) => (Array.isArray(x) && x.length && x[0].quote ? x : x && x.quote ? [x] : []));
  assert.ok(facts.length > 40);
  for (const x of facts) {
    assert.ok(x.quote.split(/\s+/).length <= 25, x.quote);
    assert.ok(x.url.startsWith('https://www.canada.ca/'), x.url);
    assert.equal(x.read, '2026-11-15');
  }
  assert.ok(Array.isArray(P.MISSING) && P.MISSING.length > 0);
});

test('GLOSSARY keeps the 2026 wording and keys', () => {
  assert.ok(GLOSSARY['T4'] && GLOSSARY['refund'] && GLOSSARY['balance owing']);
});
