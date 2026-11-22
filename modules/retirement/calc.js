// Pure retirement arithmetic (docs/phase5-life.md 5c): CPP and OAS amounts, the RRIF minimum, the withholding on pensions, the draw allocation, the live check and
// the projection. No I/O, so the module and its tests share it. Money is integer cents except inside the projection (display only, like the exchange's rrspCompare).
import { annualIncomeTax } from '../jobs/payroll.js';   // pure tax maths (the same T4127/T1 code the exchange's settlement uses)
import { CPP_MAX_65_CENTS, CPP_EARLY_BP, CPP_LATE_BP, CPP_FULL_YEARS, PENSION_AGE, OAS_65_CENTS, OAS_LATE_BP, INFLATION_BP, PROJECT_TO_AGE, rrifFactorAge } from './constants.js';

// Each world year's ratio in bp: pensionable earnings above the year's basic exemption / (the year's YMPE - exemption), at most 1, both indexed to that year
// (jobs.cppHistory); summed: "years of full contributions". The same ratio as contributions / the maximum contribution, without the payroll's fixed 2026 cap.
export const yearBp = (y) => Math.min(10000, Math.floor((Math.max(0, y.gross_cents - y.exemption_cents) * 10000) / (y.ympe_cents - y.exemption_cents)));
export const contributedBp = (years) => years.reduce((t, y) => t + yearBp(y), 0);
// The CPP at 65 in season-start dollars from that sum (bp of a full year): max x sum / 39 years, capped at the max.
export const cpp65 = (sumBp) => Math.floor((CPP_MAX_65_CENTS * Math.min(sumBp, CPP_FULL_YEARS * 10000)) / (CPP_FULL_YEARS * 10000));
// Start-age factors in bp: CPP -0.6%/month before 65 (60: 64%), +0.7%/month after (70: 142%); OAS +0.6%/month after 65 (70: 136%).
export const cppFactorBp = (age) => 10000 + (age < PENSION_AGE ? -CPP_EARLY_BP : CPP_LATE_BP) * 12 * Math.abs(age - PENSION_AGE);
export const oasFactorBp = (age) => 10000 + OAS_LATE_BP * 12 * Math.max(0, age - PENSION_AGE);
export const withFactor = (cents, bp) => Math.round((cents * bp) / 10000);
export const cppBase = (sumBp, startAge) => withFactor(cpp65(sumBp), cppFactorBp(startAge));
export const oasBase = (startAge) => withFactor(OAS_65_CENTS, oasFactorBp(startAge));
export const indexed = (cents, indexBp) => Math.round((cents * indexBp) / 10000);

// The RRIF minimum for one month: the RRIF's value / (90 - age) a year, a twelfth of it (rounded up, so twelve months reach the year's minimum).
export const rrifMonthlyMin = (valueCents, age) => (valueCents > 0 ? Math.ceil(valueCents / ((90 - rrifFactorAge(age)) * 12)) : 0);
// Tax withheld at source on a month of CPP + OAS: the annual tax on twelve such months, a twelfth of it (no earned income, so no CPP/EI credits).
export const pensionWithholding = (grossCents) => (grossCents > 0 ? Math.round(annualIncomeTax(12 * grossCents, 0) / 12) : 0);

// Take `cents` from the pots in `order`, each up to what it holds. -> { [account]: cents } (accounts with 0 left out).
export function allocate(cents, pots, order) {
  const out = {};
  let need = cents;
  for (const a of order) {
    if (need <= 0) break;
    const take = Math.min(need, Math.max(0, pots[a]?.cents ?? 0));
    if (take > 0) { out[a] = take; need -= take; }
  }
  return out;
}

// The live check for one month: { pension, draws (the plan's allocation, the RRIF minimum at least), tax (withholding-style, on pensions + the RRSP/RRIF part),
// income = net, bills, covered, shortfall, coverage % (income / bills, capped at 100; no bills = 100) }.
export function check({ cpp, oas, planCents, billsCents, pots, order, rrifMinCents = 0 }) {
  const alloc = allocate(planCents, pots, order);
  if (rrifMinCents > 0) alloc.rrsp = Math.max(alloc.rrsp ?? 0, Math.min(rrifMinCents, pots.rrsp?.cents ?? 0));
  const draws = Object.values(alloc).reduce((t, c) => t + c, 0);
  const pension = cpp + oas;
  const tax = Math.round(annualIncomeTax(12 * (pension + (alloc.rrsp ?? 0)), 0) / 12);
  const income = pension + draws - tax;
  return {
    pension_cents: pension, draw_cents: draws, tax_cents: tax, income_cents: income, bills_cents: billsCents, alloc, plan_counted_cents: planCents,
    ratio_bp: billsCents > 0 ? Math.max(0, Math.min(1_000_000, Math.floor((10000 * income) / billsCents))) : 1_000_000,   // uncapped (at 100x), for Best Retirement's ties
    covered: income >= billsCents, shortfall_cents: Math.max(0, billsCents - income),
    coverage_pct: billsCents > 0 ? Math.max(0, Math.min(100, Math.floor((100 * income) / billsCents))) : 100,
  };
}

// "Your savings last until age N": a deterministic monthly projection from now. Until the retirement age nothing is drawn (wages pay the bills); from it, each month
// draws max(the plan, the bills the pensions leave uncovered), inflated 2.1% a year, from the pots in plan order, and every pot grows at its own rate. Pensions
// count from their start ages, net of the same withholding rate as today. The age at which the pots cannot pay a month in full; PROJECT_TO_AGE if they last.
// offset = months already lived at the current age (0-11). No randomness: the same inputs give the same age.
// steps (bills' stageCosts, docs/stagecosts.md): [{ age, cents }] = the student's stage cost lines at each age they start, stop or step, at today's prices,
// steps[0] being the ones inside billsCents; the bills of a later age are billsCents minus steps[0] plus that age's (so a health line stepping up at 65 counts).
export function lastsUntil({ age, offset = 0, retireAge, cppAge, oasAge, cpp, oas, planCents, billsCents, pots, order, steps = [] }) {
  const stepAt = (a) => steps.findLast((s) => s.age <= a)?.cents ?? 0, now = steps[0]?.cents ?? 0;
  const gross = cpp + oas, netRatio = gross > 0 ? 1 - annualIncomeTax(12 * gross, 0) / (12 * gross) : 1;
  const bal = order.map((a) => ({ c: Math.max(0, pots[a]?.cents ?? 0), r: (pots[a]?.rate_bp ?? 0) / 120000 }));
  const infl = 1 + INFLATION_BP / 10000;
  for (let t = 0; ; t++) {
    const at = age + Math.floor((offset + t) / 12);
    if (at >= PROJECT_TO_AGE) return PROJECT_TO_AGE;
    if (at >= retireAge) {
      const pension = ((at >= cppAge ? cpp : 0) + (at >= oasAge ? oas : 0)) * netRatio;
      let need = Math.max(planCents, billsCents - now + stepAt(at) - pension) * infl ** (t / 12);
      for (const p of bal) { const take = Math.min(need, p.c); p.c -= take; need -= take; }
      if (need > 0.5) return at;
    }
    for (const p of bal) p.c *= 1 + p.r;
  }
}
