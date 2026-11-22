// credit: every constant in one place, each with its source and the date it was checked (2026-10-22).
// ILLUSTRATIVE unless marked otherwise: Equifax and TransUnion do not publish their formulas, so the weights below are the figures
// commonly printed by Canadian consumer-finance sites, and every curve below them is this game's own teaching model.

// Factor weights. Source: Hardbacon, "How is your credit score calculated in Canada?" (hardbacon.ca/en/credit-score/how-is-credit-score-calculated-canada/)
// and ClearScore Canada's Equifax guide (clearscore.com/ca/learn/credit-score-and-report/equifax-credit-scores-and-report), both
// 35 / 30 / 15 / 10 / 10; both say the bureaus' exact formulas are proprietary (Equifax Canada's help page lists the factors without
// percentages). Neither FCAC nor Equifax Canada page was readable for percentages, so: illustrative. Checked 2026-10-22.
export const WEIGHTS = { payment: 0.35, utilization: 0.30, length: 0.15, new: 0.10, mix: 0.10 };

export const SCORE_MIN = 300, SCORE_MAX = 900;   // the range Canadian bureaus report (Equifax Canada, TransUnion Canada: 300 to 900)
// Score bands as printed by Hardbacon (checked 2026-10-22); lenders' own cut-offs differ.
export const BANDS = [[750, 'Excellent'], [700, 'Very good'], [650, 'Good'], [600, 'Fair'], [300, 'Poor']];
export const bandOf = (score) => BANDS.find(([min]) => score >= min)[1];

// Payment history (game model): on-time months build the factor from 70% (thin file) to 100% over 3 months; each late payment mark
// takes 25% off, fading linearly to nothing over 24 world months (docs/phase2.md). At most 3 marks count per month.
export const PAYMENT = { thin: 0.7, buildPerMonth: 0.1, latePenalty: 0.25, decayMonths: 24, maxMarksPerMonth: 3 };
// Utilization (card balance / limit) to factor: flat to 10%, then down to 0 at 100% (the "keep it under 30%" rule of thumb).
export const UTILIZATION_CURVE = [[0, 1], [0.1, 1], [0.3, 0.8], [0.5, 0.5], [0.75, 0.2], [1, 0]];
export const LENGTH_FULL_MONTHS = 36;            // months of history for a full length factor (a real file takes years; a season is ~5 months, so compressed)
export const NEW_CREDIT = [1, 0.85, 0.6, 0.35, 0.15, 0];   // factor by number of applications in the last 12 months (0, 1, 2, ... 5+)
export const INQUIRY_WINDOW = 12;
export const MIX = [0, 0.5, 0.8, 1];             // factor by number of product types held (card, mortgage, line of credit)

// The card (docs/phase2.md). Illustrative: a student card in the $500-$2,500 range.
export const CARD_APR_BP = 2099;                 // 20.99%, the fixed default; module.rates.changed overrides it when rates is loaded
export const MIN_PAYMENT = { floorCents: 1000, pct: 3 };   // max($10, 3% of the statement balance); Quebec's different rule is out of scope
export const LATE_FEE_CENTS = 2900;              // $29, illustrative
export const SCORE_DECLINE_BELOW = 560;
export const MAX_INQUIRIES = 4;                  // this many applications in 12 months is declined as "too many recent applications"
// Limit = clamp(floorTo100(average monthly gross over the last 3 months x pct(score)), 500, 2500).
export const LIMIT = { minCents: 50000, maxCents: 250000, stepCents: 10000, minAvgGrossCents: 100000, windowMonths: 3,
  noFilePct: 0.5, pctAt560: 0.3, pctAt800: 1.0 };
export const limitPct = (score) => (score === null ? LIMIT.noFilePct
  : Math.min(LIMIT.pctAt800, Math.max(LIMIT.pctAt560, LIMIT.pctAt560 + ((score - 560) * (LIMIT.pctAt800 - LIMIT.pctAt560)) / 240)));
