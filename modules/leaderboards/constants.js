// leaderboards: Wolf ranks and the health score (docs/leaderboards.md).
// Tier thresholds are net worth in cents at season-start prices; the module multiplies them by the world price index (rates priceIndexBp)
// so inflation does not hand everyone a promotion. Defaults come from `npm run sim -- --months=60` (docs/leaderboards.md "Calibration");
// config.options.leaderboards.tiers overrides any of them.
export const TIERS = ['Pup', 'Scout', 'Hunter', 'Pack Leader', 'Alpha'];
export const TIER_KEYS = ['scout', 'hunter', 'packLeader', 'alpha'];                       // TIERS[1..4]
export const DEFAULT_THRESHOLDS = { scout: 500000, hunter: 1550000, packLeader: 3500000, alpha: 8450000 };   // $5,000 / $15,500 / $35,000 / $84,500 at season-start prices, spaced so ranks move all season; docs/leaderboards.md "Calibration"
// Over a 48-year life (the life module loaded, docs/phase5-life.md 5b) the same cutoffs are also multiplied by a factor for the life stage the world month
// is in, so the ranks keep moving as savings compound for decades. Stage A (months 1-168, ages 22-35) keeps the tuned 60-month season: x1. B and C are the
// best fit to the 576-month sim's deflated net worth at the stage ends (B at month 396; C over months 396 and 576, ages 55 and 70), 2026-10-29, a sim without
// retirement. A multiplier cannot reach the target spread there (no Pups or Alphas at all): see docs/phase5-life.md "As built (5b deps)". Without life: x1.
export const STAGE_FACTORS = { A: 1, B: 21, C: 25 };
export const stageOfMonth = (month) => (month <= 168 ? 'A' : month <= 396 ? 'B' : 'C');   // age 22 + floor((month - 1) / 12): A < 36, B < 55, C after
export const ROUND_CENTS = 100000;                                                         // boards show net worth to the nearest $1,000
export const BOARD_SIZE = 10;
export const CUSHION_MONTHS = 3;                                                           // 3 months of net pay in HISA + GICs = 100
export const DEBT_CEILING = 3;                                                             // debt of 3 x annual gross = 0
export const NO_FILE_CREDIT = 50;
export const RECENT_PAY_MONTHS = 3;                                                        // a pay stub older than this no longer counts as income
export const COMEBACK_WINDOW = 12;
export const GOUGE_PCT = 140, GOUGE_MONTHS = 6;                                         // 6b "Rent gouger": rent >= 140% of the NPC tier with a tenant, 6+ months
export const AWARDS = ['wolf', 'healthiest', 'comeback', 'pack', 'founder'];   // founder: only when a company exists
export const AWARD_NAMES = { wolf: 'Wolf of the Season', healthiest: 'Healthiest Wolf', comeback: 'Best Comeback', pack: 'Top Pack', founder: 'Founder of the Season', employer: 'Best Employer', retirement: 'Best Retirement' };
