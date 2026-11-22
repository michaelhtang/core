// The running example of the FinTech 20 tax section on the 2025 TAX YEAR (Mr. Tang's decision, 2026-11-15): three made-up people and their 2025 slips and returns.
// Every lesson, figure and test READS its numbers from here; nobody retypes them. Amounts are integer cents. Same people, employers and story as the first draft of this section (which used the game's 2026 pay stubs; replaced 2026-11-15 when Mr. Tang chose the 2025 tax year).
// The game itself stays on 2026 (modules/jobs/payroll.js is not used here). Every rate and limit comes from tax-rates-2025.js, which pins them to CRA pages.
//
// MADE UP: the people, the T4 employment income (box 14), the T5 interest, the T4A other income, the RRSP receipts, and box 22 (income tax deducted).
// Box 22 amounts are made up to fit the story, not computed by a payroll formula: A gets a refund, B gets back all that was withheld, C owes (each of her two
// employers withheld as if it were her only job, so together they withheld too little).
// WORKED OUT from the 2025 rates: box 16 CPP, 16A CPP2, 18 EI, 24, 26. One formula per T4:
//   CPP = 5.95% x (min(box 14, YMPE) - exemption), at most the maximum, where exemption = $3,500 x months worked at that employer / 12 (rounded to the cent half up;
//   payroll takes the exemption by pay period; the x months / 12 reading is ours). So C's two six-month T4s take $1,750 each and her CPP adds up to
//   5.95% x (her employment income - $3,500): no overpayment on her return. B's five months take $3,500 x 5/12. CPP2 = 4% x (min(box 14, YAMPE) - YMPE), if positive. EI = 1.64% x min(box 14, $65,700), at most the maximum.
//   Each is rounded to the cent half up. The yearly limits are not prorated.
//   Box 24 and box 26 equal box 14 here (all the incomes are under the EI and CPP limits; see MISSING in tax-rates-2025.js).
// The return rounds each step to the nearest cent, half up, ONCE: the tax on taxable income is rounded once from the exact total of all its brackets
// (each bracket's own amount is rounded only to show it), and each credit is rounded once as credit rate x amount. Nothing is rounded twice.
// The 2025 federal lowest rate is 14.5% for the whole year (the CRA's blended rate; the rate fell to 14% on July 1, 2025) and the credits use 14.5% too.
// Alberta: 8% on the first $60,000 and credits at 8%. Neither the federal Top-up tax credit nor the Alberta supplemental credit can apply to these people (both are 0
// unless the credits are large: federal credits worth over $8,319.38, Alberta credit amounts over $60,000), so returnFor works them out and they come to $0.
// Simplifications: each RRSP amount is within the person's RRSP room; no deductions other than RRSP and CPP; Alberta resident all year; basic claims only.
// NOT here, and not to be taught from this file: tuition, donations, the GST credit, T1 line numbers. Those come from a separate pinned source.
// On import the file checks itself: the total tax of each return is worked out a second way (a plain loop over bracket differences, with its own credit sums) and must match.

import { CATALOGUE } from '../../jobs/catalogue.js';
import * as P from './tax-rates-2025.js';

export const money = (cents) => (cents % 100 === 0 ? `$${(cents / 100).toLocaleString('en-CA')}` : `$${(cents / 100).toLocaleString('en-CA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);

export const GLOSSARY = {
  'T4': 'The slip an employer gives you for the year: what you earned and what was taken off your pay (CPP, EI and income tax).',
  'T4A': 'A slip for other kinds of income that are not pay from an employer.',
  'T5': 'A slip from a bank for the interest your savings earned.',
  'T1': 'The income tax return a person files each year.',
  'total income': 'All the income on your slips, added up.',
  'deduction': 'An amount you may subtract from your income before tax is worked out, such as an RRSP contribution.',
  'taxable income': 'Your total income minus your deductions. Tax is worked out on this amount.',
  'non-refundable tax credit': 'An amount that lowers the tax you owe, but cannot take it below $0. The basic personal amount is one.',
  'tax withheld': 'Income tax your employer took off each paycheque and sent to the government for you.',
  'refund': 'Money the government pays back to you when the tax withheld is more than the tax you owe.',
  'balance owing': 'Money you must pay when the tax you owe is more than the tax withheld.',
};

// the figures used, read from tax-rates-2025.js (the test checks this object against the pinned file)
const v = (x) => x.value;
export const USED = {
  fedLowestBp: v(P.FED_CREDIT_RATE), fedBpa: v(P.FED_BPA), canadaEmployment: v(P.CANADA_EMPLOYMENT_AMOUNT), abLowestBp: v(P.AB_CREDIT_RATE), abBpa: v(P.AB_BPA),
  cppRateBp: v(P.CPP_RATE), cppBaseBp: v(P.CPP_BASE_RATE), cppExemption: v(P.CPP_EXEMPTION), ympe: v(P.YMPE), cppMax: v(P.CPP_MAX),
  cpp2RateBp: v(P.CPP2_RATE), yampe: v(P.CPP2_YAMPE), cpp2Max: v(P.CPP2_MAX), eiRateBp: v(P.EI_RATE), mie: v(P.EI_MIE), eiMax: v(P.EI_MAX),
};
if (v(P.FED_LOWEST_RATE) !== USED.fedLowestBp || v(P.FED_BRACKETS[0]).rateBp !== USED.fedLowestBp || v(P.AB_BRACKETS[0]).rateBp !== USED.abLowestBp) throw new Error('taxpayers-2025.js: lowest rates disagree');

const rnd = (num, den) => Math.floor((2 * num + den) / (2 * den));   // to the nearest cent, half up (num >= 0)
const clamp0 = (n) => (n < 0 ? 0 : n);
const sum = (xs) => xs.reduce((s, x) => s + x, 0);
const job = (id) => { const c = CATALOGUE.find((x) => x.id === id); if (!c) throw new Error(`no catalogue job ${id}`); return c; };

// A T4: employer and job from the game's catalogue; box 14 and box 22 are made up; the rest are worked out from the 2025 rates.
export function t4(jobId, months, box14, box22) {
  const c = job(jobId);
  const exemption = rnd(USED.cppExemption * months.length, 12);           // the basic exemption for the months worked
  const cpp = Math.min(rnd(USED.cppRateBp * clamp0(Math.min(box14, USED.ympe) - exemption), 10000), USED.cppMax);
  const cpp2 = Math.min(rnd(USED.cpp2RateBp * clamp0(Math.min(box14, USED.yampe) - USED.ympe), 10000), USED.cpp2Max);
  const ei = Math.min(rnd(USED.eiRateBp * Math.min(box14, USED.mie), 10000), USED.eiMax);
  return { employer: c.employer, job: c.title, months, box14, box16: cpp, box16A: cpp2, box18: ei, box22, box24: Math.min(box14, USED.mie), box26: Math.min(box14, USED.yampe) };
}
const YEAR = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];

export const SCENARIOS = {
  A: { id: 'A', person: 'Priya', story: 'A first full-time job: a line cook at Maple Street Grill for all twelve months.',
       t4s: [t4(2, YEAR, 2750000, 142000)], t5s: [{ box13Interest: 6350 }], t4as: [], rrspReceipts: [120000] },
  B: { id: 'B', person: 'Marcus', story: 'A part-time student: a barista at Agora Coffee Co. from August to December only (5 months).',
       t4s: [t4(3, [8, 9, 10, 11, 12], 860000, 8500)], t5s: [], t4as: [{ label: 'T4A: other income (made-up)', box028: 30000 }], rrspReceipts: [] },
  C: { id: 'C', person: 'Amara', story: 'A more complex year: a retail associate at Prairie Threads January to June, then an administrative assistant at Beacon Business Services July to December.',
       t4s: [t4(4, [1, 2, 3, 4, 5, 6], 1350000, 110000), t4(9, [7, 8, 9, 10, 11, 12], 2100000, 185000)], t5s: [{ box13Interest: 120000 }], t4as: [], rrspReceipts: [] },
};

// Tax from a bracket table of pinned facts: each band's amount (rounded only to show it), and the tax on the income rounded ONCE from the exact total.
function bands(facts, a) {
  const rows = facts.map((x) => x.value).map((b) => ({ from: b.from, to: b.to, rateBp: b.rateBp, inBand: clamp0(Math.min(a, b.to ?? Infinity) - b.from) })).filter((b) => b.inBand > 0);
  return { bands: rows.map((b) => ({ ...b, amount: rnd(b.rateBp * b.inBand, 10000) })), taxOnIncome: rnd(sum(rows.map((b) => b.rateBp * b.inBand)), 10000) };
}
const credit = (rateBp, amount) => rnd(rateBp * amount, 10000);

export function returnFor(s) {
  const employment = sum(s.t4s.map((t) => t.box14));
  const totalIncome = employment + sum(s.t5s.map((t) => t.box13Interest)) + sum(s.t4as.map((t) => t.box028));
  const rrspDeduction = sum(s.rrspReceipts);
  const cpp = sum(s.t4s.map((t) => t.box16)), cpp2 = sum(s.t4s.map((t) => t.box16A)), ei = sum(s.t4s.map((t) => t.box18));
  const cppBase = rnd(cpp * USED.cppBaseBp, USED.cppRateBp);                 // the base 4.95% part of CPP (box 16): the credit, line 30800
  const enhancedCppDeduction = cpp - cppBase + cpp2;                         // line 22215: the first additional 1% part of box 16, plus all of box 16A
  const netIncome = totalIncome - rrspDeduction - enhancedCppDeduction;
  const taxableIncome = netIncome;                                           // no other deductions in this running example
  if (netIncome > v(P.FED_BPA_REDUCTION_START)) throw new Error('taxpayers-2025.js: basic personal amount reduction not modelled');

  const fed = bands(P.FED_BRACKETS, taxableIncome);
  const federalCredits = { basicPersonal: credit(USED.fedLowestBp, USED.fedBpa), cppBase: credit(USED.fedLowestBp, cppBase), ei: credit(USED.fedLowestBp, ei), canadaEmployment: credit(USED.fedLowestBp, Math.min(employment, USED.canadaEmployment)) };
  const topUp = rnd(v(P.TOPUP_RATE) * clamp0(sum(Object.values(federalCredits)) - v(P.TOPUP_THRESHOLD)), 10000);   // Top-up tax credit, line 34990
  const federalAfterCredits = clamp0(fed.taxOnIncome - sum(Object.values(federalCredits)) - topUp);

  const alb = bands(P.AB_BRACKETS, taxableIncome);
  const abAmounts = USED.abBpa + cppBase + ei;                               // the credit amounts: basic personal, base CPP, EI
  const albertaCredits = { basicPersonal: credit(USED.abLowestBp, USED.abBpa), cppBase: credit(USED.abLowestBp, cppBase), ei: credit(USED.abLowestBp, ei) };
  const k5p = rnd(v(P.AB_SUPP_RATE) * clamp0(credit(USED.abLowestBp, abAmounts) - v(P.AB_SUPP_BASE)), 10000);   // Alberta supplemental tax credit, line 61545 (kept under the name k5p)
  const albertaAfterCredits = clamp0(alb.taxOnIncome - sum(Object.values(albertaCredits)) - k5p);

  const totalTax = federalAfterCredits + albertaAfterCredits;
  const totalWithheld = sum(s.t4s.map((t) => t.box22));
  return {
    totalIncome, rrspDeduction, enhancedCppDeduction, netIncome, taxableIncome,
    federal: { bands: fed.bands, taxOnIncome: fed.taxOnIncome, credits: federalCredits, topUp, afterCredits: federalAfterCredits },
    alberta: { bands: alb.bands, taxOnIncome: alb.taxOnIncome, credits: albertaCredits, k5p, afterCredits: albertaAfterCredits },
    totalTax, totalWithheld, refund: clamp0(totalWithheld - totalTax), balanceOwing: clamp0(totalTax - totalWithheld),
  };
}

// ---- checks on import ----
// The second way: bracket differences (tax = sum of (rate - rate of the bracket below) x income above each lower limit), credits worked from the T4 boxes directly.
function taxAgain(s) {
  const emp = s.t4s.reduce((a, t) => a + t.box14, 0), c16 = s.t4s.reduce((a, t) => a + t.box16, 0), c16A = s.t4s.reduce((a, t) => a + t.box16A, 0), e18 = s.t4s.reduce((a, t) => a + t.box18, 0);
  const base = Math.round(c16 * 495 / 595);                                  // base share of box 16, 495/595, to the cent
  const taxable = emp + s.t5s.reduce((a, t) => a + t.box13Interest, 0) + s.t4as.reduce((a, t) => a + t.box028, 0) - s.rrspReceipts.reduce((a, r) => a + r, 0) - (c16 - base) - c16A;
  const diffTax = (table, x) => { let tot = 0, prev = 0; for (const { value: b } of table) { if (x > b.from) tot += (b.rateBp - prev) * (x - b.from); prev = b.rateBp; } return Math.floor((2 * tot + 10000) / 20000); };
  const cr = (bp, amt) => Math.floor((2 * bp * amt + 10000) / 20000);       // each credit rounded once, as on the return
  const fedCr = cr(1450, 16129_00) + cr(1450, base) + cr(1450, e18) + cr(1450, Math.min(emp, 1471_00));
  const abCr = cr(800, 22323_00) + cr(800, base) + cr(800, e18);
  return { fed: Math.max(0, diffTax(P.FED_BRACKETS, taxable) - fedCr), ab: Math.max(0, diffTax(P.AB_BRACKETS, taxable) - abCr) };
}
for (const s of Object.values(SCENARIOS)) {
  const r = returnFor(s), again = taxAgain(s);
  if (r.totalTax !== again.fed + again.ab) throw new Error(`taxpayers-2025.js: scenario ${s.id} tax ${r.totalTax} != second way ${again.fed + again.ab}`);
  if (sum(r.federal.bands.map((b) => b.amount)) !== r.federal.taxOnIncome || sum(r.alberta.bands.map((b) => b.amount)) !== r.alberta.taxOnIncome) throw new Error(`taxpayers-2025.js: scenario ${s.id} bands do not add to the tax`);
  if (r.federal.topUp !== 0 || r.alberta.k5p !== 0) throw new Error(`taxpayers-2025.js: scenario ${s.id} top-up / Alberta supplemental credit should be 0`);
}
