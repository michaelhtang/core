// Every rate and limit for `savings`. Rates are in basis points (1 bp = 0.01%) so all interest math stays in integers.
// Sources (checked 2026-10-22; classroom defaults sit just under the best-in-market rates, as a big bank would):
//   HISA 2.75%: Ratehub savings-account comparison https://www.ratehub.ca/savings-accounts lists 2.80% (Oaken) and 3.00% (Manulife, 2-year
//     promo); the best-in-market figure 4.60% (Simplii) is a 5-month promotion. Bank of Canada overnight rate 2.25% (Sept 2026).
//   GIC 12 months 3.70%: Ratehub https://www.ratehub.ca/gics lists 3.75% (Oaken, non-redeemable 1-year); Ratehub best-gic-rates, Sept 2026: 3.65% (Achieva).
//   GIC 36 months 3.80%: Ratehub shows no 3-year leader on the pages read, so this is interpolated between the 1-year and 5-year rates.
//   GIC 60 months 3.90%: Ratehub lists 4.30% (EQ Bank / Achieva); best-gic-rates, Sept 2026: 4.15% (Haventree). 3.90% is a typical bank rate.
export const SOURCES_CHECKED = '2026-10-22';
export const HISA_BP = 275;
export const GIC_TERMS = { 12: 370, 36: 380, 60: 390 };   // term in world months -> annual rate, bp
export const GIC_MIN_CENTS = 10000;                        // $100
export const MAX_RATE_BP = 2000;                           // the teacher's HISA lever: 0% to 20%
export const PAY_KIND = 'jobs.pay';                        // jobs' payday txn kind, read (not written) for the savings rate
