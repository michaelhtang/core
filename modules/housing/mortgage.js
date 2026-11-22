// Mortgage maths for housing: pure functions, integer cents, no I/O. Canadian fixed-rate mortgages compound semi-annually, so the monthly
// rate is i = (1 + r/2)^(1/6) - 1 (not r/12). Payment = P*i / (1 - (1+i)^-n) rounded to the cent. See test/mortgage.test.js for two worked cases.
import { DOWN, PREMIUM_BP, SURCHARGE_30Y_BP, STRESS, GDS_MAX, TDS_MAX, LAND_TITLES, PROPERTY_TAX_PER_10M } from './constants.js';

// bp = annual contract rate in basis points (420 = 4.20%).
export const monthlyRate = (bp) => (1 + bp / 20000) ** (1 / 6) - 1;

export function payment(principalCents, bp, months) {
  if (!(principalCents > 0) || !(months > 0)) return 0;
  const i = monthlyRate(bp);
  return Math.round(i === 0 ? principalCents / months : (principalCents * i) / (1 - (1 + i) ** -months));
}

// Interest for one month on a balance owed.
export const interestFor = (balanceCents, bp) => Math.round(balanceCents * monthlyRate(bp));

// The schedule for a payment of `pay` against `principal`, at most `months` rows (the final row is whatever clears the balance, so the
// rounded payment never leaves a stub). Rows: { n, interest, principal, payment, balance } with balance AFTER that payment.
export function schedule(principalCents, bp, months, pay = payment(principalCents, bp, months)) {
  const rows = [];
  let bal = principalCents;
  for (let n = 1; n <= months && bal > 0; n++) {
    const interest = interestFor(bal, bp);
    const due = n === months || bal + interest <= pay ? bal + interest : pay;       // last row clears whatever is left
    const principal = due - interest;
    bal -= principal;
    rows.push({ n, interest, principal, payment: due, balance: bal });
  }
  return rows;
}

// Stress test: qualify at the greater of the contract rate + 2% and 5.25%.
export const stressRateBp = (contractBp) => Math.max(contractBp + STRESS.bufferBp, STRESS.floorBp);

// Minimum down payment: 5% of the first $500,000 and 10% of the part to $1.5M; 20% at or above the cap (not insurable, and the game stops there).
export function minDown(priceCents) {
  if (priceCents >= DOWN.capCents) return Math.ceil((priceCents * DOWN.uninsuredPct) / 100);
  const first = Math.min(priceCents, DOWN.tier1Cents);
  return Math.ceil((first * DOWN.tier1Pct) / 100 + (Math.max(0, priceCents - DOWN.tier1Cents) * DOWN.tier2Pct) / 100);
}

// CMHC default insurance: required when the down payment is under 20%; the premium is a % of the loan (before premium), set by loan-to-value,
// and is added to the loan. 30-year amortization adds 20 bp. Returns { insured, ltvPct, premiumBp, premiumCents }.
export function insurance(priceCents, downCents, amortMonths) {
  const loan = priceCents - downCents;
  if (downCents * 5 >= priceCents) return { insured: false, ltvPct: (loan / priceCents) * 100, premiumBp: 0, premiumCents: 0 };
  const ltvPct = (loan / priceCents) * 100;
  const tier = PREMIUM_BP.find(([max]) => loan * 100 <= max * priceCents) ?? PREMIUM_BP.at(-1);   // integer compare: 90% LTV must land in the 85-90 tier exactly
  const premiumBp = tier[1] + (amortMonths > 300 ? SURCHARGE_30Y_BP : 0);
  return { insured: true, ltvPct, premiumBp, premiumCents: Math.round((loan * premiumBp) / 10000) };
}

// Alberta Land Titles: $50 + $5 per $5,000 (or part) of value, for the transfer (on the price) and the mortgage registration (on the loan).
export const landTitleFee = (valueCents) => LAND_TITLES.baseCents + LAND_TITLES.perBlockCents * Math.ceil(valueCents / LAND_TITLES.blockCents);

// Monthly property tax at the Edmonton residential rate, billed as 1/12 of the year.
export const propertyTaxMonthly = (valueCents) => Math.round((valueCents * PROPERTY_TAX_PER_10M) / 10_000_000 / 12);

// Everything about a purchase offer in one place. input: { priceCents, downCents, contractBp, amortMonths, grossMonthlyCents, heatingCents,
// condoFeeCents, otherDebtCents }. Qualification runs at the stress rate; the student's real payment is at the contract rate.
// Returns the numbers and `reasons` (why not), `ok` only when there are none.
export function qualify(i) {
  const { priceCents, downCents, contractBp, amortMonths, grossMonthlyCents, heatingCents, condoFeeCents, otherDebtCents = 0 } = i;
  const reasons = [];
  const minD = minDown(priceCents);
  if (!(priceCents > 0)) reasons.push('Enter a price.');
  if (priceCents > DOWN.capCents) reasons.push('The price is over $1,500,000: that is past the insured-mortgage cap, and this game stops there.');
  if (downCents < minD) reasons.push(`The down payment is under the minimum for this price (5% of the first $500,000 and 10% of the rest).`);
  if (downCents >= priceCents) reasons.push('The down payment must be less than the price.');
  const ins = insurance(priceCents, Math.min(downCents, priceCents), amortMonths);
  const loanBeforePremium = Math.max(0, priceCents - downCents);
  const loanCents = loanBeforePremium + ins.premiumCents;
  const qualifyingBp = stressRateBp(contractBp);
  const qualifyingPayment = payment(loanCents, qualifyingBp, amortMonths);
  const realPayment = payment(loanCents, contractBp, amortMonths);
  const tax = propertyTaxMonthly(priceCents);
  const gdsCosts = qualifyingPayment + tax + heatingCents + Math.round(condoFeeCents / 2);
  const gds = grossMonthlyCents > 0 ? gdsCosts / grossMonthlyCents : Infinity;
  const tds = grossMonthlyCents > 0 ? (gdsCosts + otherDebtCents) / grossMonthlyCents : Infinity;
  if (!(grossMonthlyCents > 0)) reasons.push('Your income over the last 3 months is not enough to measure: a lender needs to see your pay.');
  else {
    const pct = (x) => `${(x * 100).toFixed(1)}%`;
    if (gds > GDS_MAX) reasons.push(`Housing costs at the qualifying rate would be ${pct(gds)} of your gross income; the limit (GDS) is 39%.`);
    if (tds > TDS_MAX) reasons.push(`Housing costs plus your card payment would be ${pct(tds)} of your gross income; the limit (TDS) is 44%.`);
  }
  return {
    ok: reasons.length === 0, reasons, minDownCents: minD, insured: ins.insured, ltvPct: ins.ltvPct, premiumBp: ins.premiumBp, premiumCents: ins.premiumCents,
    loanBeforePremiumCents: loanBeforePremium, loanCents, contractBp, qualifyingBp, qualifyingPaymentCents: qualifyingPayment, paymentCents: realPayment,
    propertyTaxCents: tax, heatingCents, condoFeeCents, condoFeeCountedCents: Math.round(condoFeeCents / 2), otherDebtCents, grossMonthlyCents,
    gdsCostsCents: gdsCosts, gds: Number.isFinite(gds) ? gds : null, tds: Number.isFinite(tds) ? tds : null, gdsMax: GDS_MAX, tdsMax: TDS_MAX,
    // The most a student could borrow's worth of income: gross a lender would need for the 39% / 44% limits.
    grossNeededCents: Math.ceil(Math.max(gdsCosts / GDS_MAX, (gdsCosts + otherDebtCents) / TDS_MAX)),
  };
}

// Closing costs paid on the day: legal fees plus Alberta Land Titles on the transfer and on the mortgage.
export const closingCosts = (priceCents, loanCents, legalCents) => legalCents + landTitleFee(priceCents) + landTitleFee(loanCents);

// The rent-vs-buy calculator (FIN1010). Same budget both ways: the renter invests the down payment and closing costs at `investBp` (a HISA, monthly
// compounding) and, each month, whatever owning would cost beyond the rent (a month where rent is dearer is drawn from the pot). The buyer pays the
// mortgage, property tax (on the drifting value), condo fees, heating and insurance, and at the end sells: value less commission and legal fees less
// the balance owed is the equity. Whoever finishes with more wealth came out ahead. All cents.
// i: { priceCents, downCents, contractBp, amortMonths, rentCents, condoFeeCents, heatingCents, insuranceCents, years, driftBp, investBp, legalCents, commissionPct }
export function rentVsBuy(i) {
  const months = Math.max(1, Math.round(i.years * 12));
  const ins = insurance(i.priceCents, i.downCents, i.amortMonths);
  const loan = i.priceCents - i.downCents + ins.premiumCents;
  const pay = payment(loan, i.contractBp, i.amortMonths);
  const rows = schedule(loan, i.contractBp, i.amortMonths, pay);
  const upfront = i.downCents + closingCosts(i.priceCents, loan, i.legalCents);
  let value = i.priceCents, ownSpent = upfront, rentSpent = 0, invest = upfront;
  for (let m = 1; m <= months; m++) {
    value = Math.round(value * (1 + i.driftBp / 10000));
    const own = (rows[m - 1]?.payment ?? 0) + propertyTaxMonthly(value) + i.condoFeeCents + i.heatingCents + i.insuranceCents;
    ownSpent += own;
    rentSpent += i.rentCents;
    invest = Math.round(invest * (1 + i.investBp / 120000)) + (own - i.rentCents);
  }
  const balance = rows[months - 1]?.balance ?? 0;
  const saleCosts = Math.round((value * i.commissionPct) / 100) + i.legalCents;
  const equity = value - saleCosts - balance;
  return {
    months, loanCents: loan, premiumCents: ins.premiumCents, paymentCents: pay, upfrontCents: upfront,
    monthlyOwnCents: pay + propertyTaxMonthly(i.priceCents) + i.condoFeeCents + i.heatingCents + i.insuranceCents, monthlyRentCents: i.rentCents,
    homeValueCents: value, balanceCents: balance, saleCostsCents: saleCosts, equityCents: equity, ownSpentCents: ownSpent, rentSpentCents: rentSpent,
    renterWealthCents: invest, buyerWealthCents: equity, cheaper: equity > invest ? 'buy' : equity < invest ? 'rent' : 'same',
  };
}
