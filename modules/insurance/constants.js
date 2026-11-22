// Every number the insurance module uses, with where it came from. checked = 2026-10-22.
// Nothing here could be confirmed from a page (insurers' rates depend on the person, car and address), so EVERY figure is ILLUSTRATIVE:
// a plausible round number chosen for teaching, not a quote. Amounts are integer cents.
// config.options.insurance can override: eventAmounts { "<event key>": cents }, seasonCapCents, minGapMonths, randomEvents, randomChancePct.
export const CHECKED = '2026-10-22';

// Policies, in the order they are tried when an event could be covered by more than one (a condo owner's pipe is the condo policy's, not tenant's).
//   billedBy: 'insurance' = premium is a due line `insurance-<key>` (this module emits module.insurance.costs);
//             'bills'     = the premium is already bills' own "Car insurance" line (the student chose car), so nothing is billed twice;
//             'housing'   = housing's costs already include the premium (the student owns a condo).
export const POLICIES = [
  { key: 'condo', name: 'Condo unit insurance', premiumCents: 3500, deductibleCents: 50000, billedBy: 'housing', buyable: false, category: 'needs',
    note: 'Included automatically when you own a condo; the premium is in your housing costs. Illustrative: $35 a month (docs/phase2.md) and a $500 deductible.' },
  { key: 'auto', name: 'Auto insurance', premiumCents: null, deductibleCents: 50000, billedBy: 'bills', buyable: false, category: 'needs',
    note: 'Included automatically when you choose the car under Bills > Plans; the premium is the "Car insurance" bill you already pay. Illustrative $500 deductible.' },
  { key: 'tenant', name: 'Tenant insurance', premiumCents: 2000, deductibleCents: 50000, billedBy: 'insurance', buyable: true, category: 'needs',
    note: 'Covers your contents (burst pipe, laptop theft). Illustrative: $20 a month, $500 deductible.' },
  { key: 'phone', name: 'Phone protection', premiumCents: 1200, deductibleCents: 10000, billedBy: 'insurance', buyable: true, category: 'wants',
    note: 'Covers a cracked screen or a lost phone. Illustrative: $12 a month, $100 deductible.' },
];

// Town events. covers = policy keys that pay out, in the order they are tried. kind 'windfall' pays the student (no policy involved).
export const EVENTS = [
  { key: 'phone-screen', name: 'Cracked phone screen', amountCents: 25000, kind: 'expense', covers: ['phone'] },
  { key: 'car-repair', name: 'Car repair', amountCents: 80000, kind: 'expense', covers: ['auto'] },
  { key: 'burst-pipe', name: 'Burst pipe (contents damaged)', amountCents: 120000, kind: 'expense', covers: ['condo', 'tenant'] },
  { key: 'laptop-theft', name: 'Laptop stolen', amountCents: 90000, kind: 'expense', covers: ['tenant'] },
  { key: 'dental', name: 'Dental emergency', amountCents: 40000, kind: 'expense', covers: [] },
  { key: 'tax-refund', name: 'Tax refund (windfall)', amountCents: 20000, kind: 'windfall', covers: [] },
];

// Fairness (PLAN section 4: "bad luck is capped and insurable"): at most one event per student in any MIN_GAP_MONTHS world months,
// and at most SEASON_CAP_CENTS of expense events per student per season (windfalls pay out and are not capped).
export const MIN_GAP_MONTHS = 3;
export const SEASON_CAP_CENTS = 300000;
export const RANDOM_CHANCE_PCT = 8;   // chance a student is drawn in a given month when randomEvents is on
