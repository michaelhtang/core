// Pure maths for leaderboards: tiers, the four health parts, ranking, medians. No database in here, so tests call it directly.
import { TIERS, TIER_KEYS, DEFAULT_THRESHOLDS, ROUND_CENTS, CUSHION_MONTHS, DEBT_CEILING, NO_FILE_CREDIT } from './constants.js';

const clamp = (n) => Math.max(0, Math.min(100, n));
export const roundNet = (cents) => (Math.round(cents / ROUND_CENTS) * ROUND_CENTS) || 0;   // `|| 0` turns -0 into 0

// Thresholds in force: defaults, then config overrides, each scaled by the price index (basis points, 10000 = season start) and by the life stage's factor
// (STAGE_FACTORS; 1 without the life module).
export function thresholds(config, indexBp = 10000, factor = 1) {
  const base = { ...DEFAULT_THRESHOLDS, ...(config?.tiers ?? {}) };
  return TIER_KEYS.map((key) => Math.round((base[key] * indexBp * factor) / 10000));
}
// 0 = Pup ... 4 = Alpha.
export const tierOf = (netCents, thr) => thr.reduce((t, min, i) => (netCents >= min ? i + 1 : t), 0);
export const tierName = (i) => TIERS[i] ?? TIERS[0];

// The parts, each 0-100 (rounded), from plain numbers. s = {
//   saved (HISA + GIC cents), netPay, gross (monthly cents, 0 when not paid lately), ontime, late (counts), score (null = no file), cardOwed, mortgagePayment (cents),
//   stress (0-100, from the stress module; null or missing = no fifth part, so a world without stress scores exactly as before),
//   coverage (0-100, retirement income / bills, from the retirement module in Stage C; null or missing = the debt-load part as before) }
export function healthParts(s) {
  const cushion = s.netPay > 0 ? clamp((100 * s.saved) / (CUSHION_MONTHS * s.netPay)) : s.saved > 0 ? 100 : 0;
  const total = s.ontime + s.late;
  const onTime = total ? (100 * s.ontime) / total : 100;
  const credit = s.score == null ? NO_FILE_CREDIT : clamp((s.score - 300) / 6);
  const debt = s.cardOwed + 12 * s.mortgagePayment;
  const load = debt <= 0 ? 100 : s.gross > 0 ? clamp(100 * (1 - debt / (DEBT_CEILING * 12 * s.gross))) : 0;
  const parts = { cushion: Math.round(cushion), on_time: Math.round(onTime), credit: Math.round(credit), load: Math.round(load) };
  if (s.coverage != null) { delete parts.load; parts.coverage = Math.round(clamp(s.coverage)); }   // Stage C (5c): retirement coverage replaces the debt load
  if (s.stress != null) parts.calm = Math.round(clamp(100 - s.stress));
  return parts;
}
// The mean of the parts present: four, or five with calm (coverage takes load's place in Stage C).
export const healthScore = (p) => { const v = Object.keys(PART_NAMES).filter((key) => p[key] != null).map((key) => p[key]); return Math.round(v.reduce((t, x) => t + x, 0) / v.length); };

export const PART_NAMES = { cushion: 'Savings cushion', on_time: 'On time', credit: 'Credit', load: 'Debt load', coverage: 'Retirement coverage', calm: 'Calm' };
const TIPS = {
  cushion: 'Move money from chequing into savings. Three months of take-home pay in HISA or GICs earns full marks.',
  on_time: 'Pay every bill, card minimum and mortgage payment by its due month. Autopay in the Bills building helps.',
  credit: 'Pay your card in full each month and never miss a minimum. Your score rises slowly, so start early.',
  load: 'Owe less compared with what you earn: pay the card down and think twice before a bigger mortgage.',
  coverage: 'Make your retirement income cover your bills: choose when CPP and OAS start and set a draw plan in the Retirement building.',
  calm: 'Keep a job, pay bills on time and never miss a housing or loan payment: stress falls every calm month.',
};
export const weakest = (parts) => Object.keys(PART_NAMES).reduce((w, k) => (parts[k] != null && parts[k] < parts[w] ? k : w), 'cushion');
export const tipFor = (parts) => { const key = weakest(parts); return { part: key, name: PART_NAMES[key], text: TIPS[key] }; };

// Competition ranking (1, 2, 2, 4) of rows already sorted best-first; `by` reads the value being ranked.
export function ranked(sorted, by) {
  let rank = 0, prev;
  return sorted.map((r, i) => { if (i === 0 || by(r) !== prev) rank = i + 1; prev = by(r); return rank; });
}

export const median = (values) => {
  if (!values.length) return null;
  const x = [...values].sort((a, b) => a - b);
  const mid = x.length >> 1;
  return x.length % 2 ? x[mid] : (x[mid - 1] + x[mid]) / 2;
};
