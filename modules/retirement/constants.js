// Retirement income constants (docs/phase5-life.md 5c). Each figure says where it comes from and whether it was read from that page at build time
// (CONFIRMED, 2026-10-29) or is the game's own simplification (ILLUSTRATIVE). Money is integer cents, rates basis points. The amounts are season-start
// (2026) dollars: the module pays them x the world price index, as Service Canada indexes CPP and OAS to the CPI.

// CPP. CONFIRMED: the maximum monthly retirement pension at 65 in 2026 is $1,507.65
// (https://www.canada.ca/en/services/benefits/publicpensions/cpp/payment-amounts.html).
export const CPP_MAX_65_CENTS = 150765;
// CONFIRMED: "Payments decrease by 0.6% each month" before 65 (up to 36% at 60) and "increase by 0.7% each month" after 65 (up to 42% at 70)
// (https://www.canada.ca/en/services/benefits/publicpensions/cpp/when-start.html).
export const CPP_MIN_AGE = 60, CPP_MAX_AGE = 70, PENSION_AGE = 65;
export const CPP_EARLY_BP = 60, CPP_LATE_BP = 70;                 // per month, in basis points (60 = 0.6%)
// ILLUSTRATIVE (the game's formula): the pension at 65 = the maximum x (the sum, over the student's world years, of that year's CPP contributions / the year's
// maximum contribution, each at most 1) / 39, capped at the maximum. The real formula averages pensionable earnings / YMPE over the contributory period
// (18 to 65, 47 years) with the lowest 17% dropped (about 39 years); contributions / maximum contribution is (earnings - $3,500) / (YMPE - $3,500), the
// same ratio from the pay stubs' own CPP lines.
export const CPP_FULL_YEARS = 39;

// OAS. CONFIRMED: up to $762.50 a month at ages 65-74, October to December 2026
// (https://www.canada.ca/en/services/benefits/publicpensions/old-age-security/payments.html); deferral "payments increase by 0.6% each month (7.2% per year),
// up to 36% at age 70" (https://www.canada.ca/en/services/benefits/publicpensions/old-age-security/when-start.html). ILLUSTRATIVE: every student has the
// 40 years of residence for the full pension; the 10% top-up at 75 never applies (the life ends at 70).
export const OAS_65_CENTS = 76250;
export const OAS_MIN_AGE = 65, OAS_MAX_AGE = 70, OAS_LATE_BP = 60;
// The recovery tax (15% above $95,323 for the 2026 income year, CONFIRMED) is in modules/jobs/payroll.js (oasRecoveryTax), next to the income tax it adds to.

// RRIF. CONFIRMED: the minimum factor at age 70 or younger is 1 / (90 - age)
// (https://www.canada.ca/en/revenue-agency/services/tax/businesses/topics/completing-slips-summaries/t4rsp-t4rif-information-returns/payments/chart-prescribed-factors.html).
// The CRA table for 71+ is not needed: the life ends at 70. The real conversion deadline is the end of the year you turn 71, so it never forces anyone in the game.
export const RRIF_FROM_AGE = 55;                                  // the game opens conversion in Stage C
export const rrifFactorAge = (age) => Math.min(age, 70);

// The live check and projection. ILLUSTRATIVE: 2.1% inflation a year (the spec's figure; the Bank of Canada targets 2%); the panel opens at 50.
export const INFLATION_BP = 210;
export const OPEN_AGE = 50, STAGE_C_AGE = 55, PROJECT_TO_AGE = 100, SHORT_BEFORE_AGE = 90;
// The accounts a draw plan can take from, and the default order (TFSA last). A GIC is not drawable: it pays into chequing at maturity.
export const DRAWABLE = ['rrsp', 'invest', 'hisa', 'tfsa'];
export const LABELS = { rrsp: 'RRSP / RRIF', invest: 'Non-registered', hisa: 'HISA', tfsa: 'TFSA' };
export const MAX_DRAW_CENTS = 10_000_000;                         // $100,000 a month
