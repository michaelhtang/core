// housing: the pure mortgage maths (modules/housing/mortgage.js). Two cases worked by hand, each cross-checked against an independent formula.
import test from 'node:test';
import assert from 'node:assert/strict';
import { monthlyRate, payment, interestFor, schedule, stressRateBp, minDown, insurance, landTitleFee, propertyTaxMonthly, qualify, closingCosts, rentVsBuy } from '../modules/housing/mortgage.js';

// A second way to the same payment, sharing no code with mortgage.js: turn the semi-annual rate into an effective annual rate, take the 12th root,
// and find the payment by bisection on a month-by-month simulation (so it does not use the annuity formula at all).
const iViaEar = (bp) => ((1 + bp / 20000) ** 2) ** (1 / 12) - 1;
function bisectPayment(principal, bp, n) {
  const i = iViaEar(bp);
  const left = (pay) => { let b = principal; for (let m = 0; m < n; m++) b = b * (1 + i) - pay; return b; };
  let lo = 0, hi = principal;
  for (let k = 0; k < 200; k++) { const mid = (lo + hi) / 2; if (left(mid) > 0) lo = mid; else hi = mid; }
  return (lo + hi) / 2;
}

// CASE 1 (by hand). Condo $202,000, 5% down = $10,100, loan $191,900. LTV 95%, so CMHC premium 4.00% of 191,900 = $7,676.00,
// added to the loan: $199,576.00 (19,957,600 cents). Contract 4.20%, 25 years = 300 months.
//   i = (1 + 0.042/2)^(1/6) - 1 = 1.021^(1/6) - 1. ln 1.021 = 0.0207801, / 6 = 0.00346335, e^that = 1.0034694 -> i = 0.00346976.
//   (1+i)^300 = 1.021^50 = e^(50 x 0.0207801) = e^1.039005 = 2.8267; 1 - 1/2.8267 = 0.64624.
//   payment = 199,576.00 x 0.00346976 / 0.64624 = 692.48 / 0.64624 = $1,071.56 (to the cent: 107,156).
//   First month: interest = 199,576.00 x 0.00346976 = $692.48; principal = 1,071.56 - 692.48 = $379.08; balance after = $199,196.92.
test('case 1: $191,900 + 4.00% CMHC premium at 4.20%, 25 years -> $1,071.56; first month $692.48 interest, $379.08 principal', () => {
  const ins = insurance(20200000, 1010000, 300);
  assert.deepEqual([ins.insured, ins.premiumBp, ins.premiumCents], [true, 400, 767600]);
  const loan = 19190000 + ins.premiumCents;
  assert.equal(loan, 19957600);
  assert.ok(Math.abs(monthlyRate(420) - 0.00346976) < 1e-8);
  assert.equal(payment(loan, 420, 300), 107156);
  const rows = schedule(loan, 420, 300);
  assert.deepEqual([rows[0].interest, rows[0].principal, rows[0].balance], [69248, 37908, 19919692]);
  // second formula: bisection on a simulation, rounded to the cent, must agree
  assert.equal(Math.round(bisectPayment(loan, 420, 300)), 107156);
  // the schedule pays the loan off in exactly 300 payments and the last one clears the rounding stub
  assert.equal(rows.length, 300);
  assert.equal(rows.at(-1).balance, 0);
  assert.equal(rows.reduce((t, r) => t + r.principal, 0), loan);
  assert.ok(Math.abs(rows.at(-1).payment - 107156) < 100);
});

// CASE 2 (by hand). Same condo, 10% down = $20,200, loan $181,800; 30-year amortization for a first-time buyer on an insured purchase: premium
// 3.10% (LTV 90%) + 0.20% surcharge = 3.30% of 181,800 = $5,999.40, loan $187,799.40. Contract 4.50%, 360 months.
//   j = 1.0225^(1/6) - 1: ln 1.0225 = 0.0222506, / 6 = 0.00370844, e^that = 1.00371532 -> j = 0.00371532.
//   (1+j)^360 = 1.0225^60 = e^(60 x 0.0222506) = e^1.335036 = 3.8004; 1 - 1/3.8004 = 0.73687.
//   payment = 187,799.40 x 0.00371532 / 0.73687 = 697.73 / 0.73687 = $946.91 (94,691 cents).
//   First month: interest = 187,799.40 x 0.00371532 = $697.73; principal = 946.91 - 697.73 = $249.18.
test('case 2: 30-year insured, 10% down, 3.30% premium at 4.50% -> $946.91; first month $697.73 / $249.18', () => {
  const ins = insurance(20200000, 2020000, 360);
  assert.deepEqual([ins.premiumBp, ins.premiumCents], [330, 599940]);
  const loan = 18180000 + ins.premiumCents;
  assert.equal(loan, 18779940);
  assert.equal(payment(loan, 450, 360), 94691);
  const [first] = schedule(loan, 450, 360);
  assert.deepEqual([first.interest, first.principal], [69773, 24918]);
  assert.equal(Math.round(bisectPayment(loan, 450, 360)), 94691);
  assert.equal(interestFor(loan, 450), 69773);
});

test('semi-annual compounding is not r/12: 6% a year is 0.4939% a month, 12 payments of it compound to 6.09%', () => {
  assert.ok(Math.abs(monthlyRate(600) - 0.0049386) < 1e-6);
  assert.ok(Math.abs((1 + monthlyRate(600)) ** 12 - 1.0609) < 1e-9);
  assert.equal(monthlyRate(0), 0);
  assert.equal(payment(120000, 0, 12), 10000);                      // a 0% rate is plain division
});

test('CMHC premium tiers by down payment, the 20% cut-off, and the 30-year surcharge', () => {
  const price = 30000000;                                           // $300,000
  const prem = (pct, months = 300) => insurance(price, (price * pct) / 100, months).premiumBp;
  assert.deepEqual([5, 9.99, 10, 14.99, 15, 19.99].map((p) => prem(p)), [400, 400, 310, 310, 280, 280]);
  assert.deepEqual([insurance(price, price * 0.2, 300).insured, insurance(price, price * 0.2, 300).premiumCents], [false, 0]);
  assert.equal(prem(5, 360), 420);
  assert.equal(prem(10, 360), 330);
});

test('minimum down payment: 5% of the first $500k, 10% of the rest, 20% at the $1.5M cap', () => {
  assert.equal(minDown(20200000), 1010000);                         // 5% of $202,000
  assert.equal(minDown(50000000), 2500000);
  assert.equal(minDown(100000000), 7500000);                        // $25,000 + $50,000
  assert.equal(minDown(150000000), 30000000);                       // 20%
});

test('stress test rate: the greater of contract + 2% and 5.25%', () => {
  assert.equal(stressRateBp(420), 620);
  assert.equal(stressRateBp(300), 525);
  assert.equal(stressRateBp(325), 525);
  assert.equal(stressRateBp(326), 526);
});

test('Alberta Land Titles and property tax', () => {
  assert.equal(landTitleFee(20200000), 5000 + 500 * 41);           // $50 + $5 x 41 blocks of $5,000 = $255
  assert.equal(landTitleFee(500000), 5500);
  assert.equal(closingCosts(20200000, 19957600, 150000), 150000 + 25500 + (5000 + 500 * 40));
  assert.equal(propertyTaxMonthly(20200000), 17446);                // $202,000 x 1.03637% / 12 = $174.46
});

// QUALIFYING (by hand): a student with $4,500 gross a month and a $30.00 card minimum buys the $202,000 condo with 10% down, 25 years, contract 4.20%.
//   Loan $181,800 + 3.10% premium ($5,635.80) = $187,435.80. Stress rate = max(4.20 + 2, 5.25) = 6.20%.
//   Payment at 6.20% over 300 months = $1,221.60 (j = 1.031^(1/6) - 1 = 0.0050912; 1 - 1.031^-50 = 0.78218; 187,435.80 x 0.0050912 / 0.78218).
//   Property tax $174.46 + heating $60 + half the $400 condo fee ($200) -> housing costs $1,656.06.
//   GDS = 1,656.06 / 4,500 = 36.8% (limit 39%); TDS = (1,656.06 + 30) / 4,500 = 37.5% (limit 44%): qualifies. The real payment at 4.20% is $1,006.38.
test('qualify: GDS and TDS at the stress-test payment', () => {
  const base = { priceCents: 20200000, contractBp: 420, amortMonths: 300, heatingCents: 6000, condoFeeCents: 40000, otherDebtCents: 3000 };
  const ok = qualify({ ...base, downCents: 2020000, grossMonthlyCents: 450000 });
  assert.equal(ok.premiumCents, 563580);
  assert.equal(ok.loanCents, 18743580);
  assert.equal(ok.qualifyingBp, 620);
  assert.equal(ok.qualifyingPaymentCents, 122160);
  assert.equal(ok.paymentCents, 100638);
  assert.equal(ok.gdsCostsCents, 122160 + 17446 + 6000 + 20000);
  assert.ok(Math.abs(ok.gds - 0.368) < 0.001 && Math.abs(ok.tds - 0.3747) < 0.001);
  assert.equal(ok.ok, true);
  const poor = qualify({ ...base, downCents: 1010000, grossMonthlyCents: 260000 });
  assert.equal(poor.ok, false);
  assert.equal(poor.reasons.length, 2);                              // both GDS and TDS fail, each with its own reason
  assert.match(poor.reasons[0], /GDS/);
  assert.match(poor.reasons[1], /TDS/);
  // the card payment alone can break TDS while GDS passes
  const card = qualify({ ...base, downCents: 2020000, grossMonthlyCents: 450000, otherDebtCents: 50000 });
  assert.equal(card.reasons.length, 1);
  assert.match(card.reasons[0], /TDS/);
  // a down payment under the minimum, a price over the cap, no income
  assert.match(qualify({ ...base, downCents: 100000, grossMonthlyCents: 450000 }).reasons.join(' '), /minimum/);
  assert.match(qualify({ ...base, priceCents: 160000000, downCents: 32000000, grossMonthlyCents: 4500000 }).reasons.join(' '), /1,500,000/);
  assert.match(qualify({ ...base, downCents: 2020000, grossMonthlyCents: 0 }).reasons.join(' '), /income/);
});

test('rent vs buy: the same money both ways, an extra year of drift favours the owner, a high rent favours buying', () => {
  const i = { priceCents: 20200000, downCents: 1010000, contractBp: 420, amortMonths: 300, rentCents: 129000, condoFeeCents: 40000, heatingCents: 6000, insuranceCents: 3500, years: 5, driftBp: 25, investBp: 275, legalCents: 150000, commissionPct: 4 };
  const r = rentVsBuy(i);
  assert.equal(r.months, 60);
  assert.equal(r.paymentCents, 107156);
  assert.equal(r.upfrontCents, 1010000 + 150000 + 25500 + (5000 + 500 * 40));
  assert.ok(r.balanceCents > 0 && r.balanceCents < r.loanCents);
  assert.equal(r.equityCents, r.homeValueCents - r.saleCostsCents - r.balanceCents);
  assert.ok(r.rentSpentCents === 129000 * 60);
  assert.ok(rentVsBuy({ ...i, driftBp: 100 }).buyerWealthCents > r.buyerWealthCents);
  assert.equal(rentVsBuy({ ...i, rentCents: 400000, driftBp: 100 }).cheaper, 'buy');
  assert.equal(rentVsBuy({ ...i, rentCents: 60000, driftBp: 0 }).cheaper, 'rent');
});
