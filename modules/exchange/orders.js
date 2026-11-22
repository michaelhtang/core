// Order math, pure and in integers. Three fixed-point scales (constants.js):
//   money     cents (the ledger)
//   prices    micro-cents: 1 cent = PRICE_SCALE = 10,000 micro-cents
//   amounts   micro-units: 1 unit (a share or a fund unit) = UNIT = 1,000,000 micro-units
// A trade of `units` micro-units at `price` micro-cents is worth units x price / (UNIT x PRICE_SCALE) cents = units x price / 1e10. Products pass 2^53, so this file does the
// multiplication in BigInt and hands back plain integers.
// ROUNDING (always against the trader, so the market maker never loses a fraction of a cent, and a student never gets a free one):
//   ask    = price x (1 + spread/2), rounded UP to a micro-cent        bid  = price x (1 - spread/2), rounded DOWN
//   a buy costs   ceil(units x ask / 1e10) cents                       a sale pays floor(units x bid / 1e10) cents
//   dollars -> units for a fund: floor, then down to a whole step (0.0001 unit), so the cost never exceeds the dollars given
//   the cost basis of a partial sale: floor(basis x sold / held); selling everything removes all of it
//   a dividend: floor(units x floor(price x yield / 4) / 1e10) cents
import { PRICE_SCALE, UNIT, TFSA_LIMIT_CENTS, RRSP_LIMIT_CENTS, RRSP_EARNED_PCT, RRSP_WITHHOLDING } from './constants.js';

const SCALE = BigInt(PRICE_SCALE) * BigInt(UNIT);   // 1e10
const big = (n) => BigInt(n);
const ceilDiv = (a, b) => (a + b - 1n) / b;          // a, b >= 0

// The market maker's two prices. spreadBp is the whole spread (20 = 0.2%); each side moves half of it.
export function sides(priceMicro, spreadBp) {
  const half = spreadBp / 2;
  return {
    ask: Number(ceilDiv(big(priceMicro) * big(10000 + half), 10000n)),
    bid: Number((big(priceMicro) * big(10000 - half)) / 10000n),
  };
}

export const costCents = (unitsMicro, askMicro) => Number(ceilDiv(big(unitsMicro) * big(askMicro), SCALE));
export const proceedsCents = (unitsMicro, bidMicro) => Number((big(unitsMicro) * big(bidMicro)) / SCALE);

// Most units (a multiple of `step`) that `cents` buys at `askMicro`; costCents of the result is never more than `cents`.
export function unitsForCents(cents, askMicro, step) {
  const u = (big(cents) * SCALE) / big(askMicro);
  return Number(u - (u % big(step)));
}

// Basis (cents paid, with the spread) that goes out with a sale of `sold` of `held` units.
export const basisShare = (basisCents, held, sold) => (sold >= held ? basisCents : Number((big(basisCents) * big(sold)) / big(held)));

// A quarterly dividend: the yield is annual, a quarter of it is paid. dps is micro-cents per unit.
export const dividendPerUnit = (priceMicro, yieldBp) => Number((big(priceMicro) * big(yieldBp)) / 40000n);
export const dividendCents = (unitsMicro, priceMicro, yieldBp) => Number((big(unitsMicro) * big(dividendPerUnit(priceMicro, yieldBp))) / SCALE);

// Is this a legal order size? Stocks: whole shares. Funds: multiples of 0.0001 unit. Returns an error message or null.
export function sizeProblem(kind, unitsMicro, step) {
  if (!Number.isSafeInteger(unitsMicro) || unitsMicro <= 0) return 'Enter an amount to trade';
  if (unitsMicro % step) return kind === 'stock' ? 'Stocks trade in whole shares' : 'Funds trade in steps of 0.0001 of a unit';
  return null;
}

// A limit order is only useful away from the market: a buy below the ask, a sell above the bid.
export const restsOffMarket = (side, limitMicro, bidMicro, askMicro) => (side === 'buy' ? limitMicro < askMicro : limitMicro > bidMicro);

// Does a market with this bid and ask fill a resting limit order at the limit or better? A buy fills at the ask when ask <= limit; a sell at the bid when bid >= limit.
export const crosses = (side, limitMicro, bidMicro, askMicro) => (side === 'buy' ? askMicro <= limitMicro : bidMicro >= limitMicro);

// ---- the TFSA (a box, not an investment) ----
// World year of a world month: months 1-12 are year 1, 13-24 year 2, ...
export const yearOf = (month) => Math.floor((month - 1) / 12) + 1;
// A yearly dollar limit: cents for every year, or a function year -> cents (the limits indexed over a 48-year life, docs/phase5-life.md 5b).
const perYear = (limit) => (typeof limit === 'function' ? limit : () => limit);
// The indexed limits for a year whose price index (at its start) is indexBp: the base x the index, the TFSA to the nearest $500 and the RRSP to the nearest $10.
export const indexedTfsa = (indexBp) => Math.round((TFSA_LIMIT_CENTS * indexBp) / 10000 / 50000) * 50000;
export const indexedRrsp = (indexBp) => Math.round((RRSP_LIMIT_CENTS * indexBp) / 10000 / 1000) * 1000;
// Room in `year`: the limit for each year so far + unused room carried forward (the sum of everything contributed is taken off) + withdrawals made in EARLIER years.
// rows: [{ year, contributed, withdrawn }] for the season so far.
export function tfsaRoom(year, rows, limit = TFSA_LIMIT_CENTS) {
  const at = perYear(limit);
  let limits = 0;
  for (let y = 1; y <= year; y++) limits += at(y);
  const contributed = rows.reduce((t, r) => t + r.contributed, 0);
  const back = rows.filter((r) => r.year < year).reduce((t, r) => t + r.withdrawn, 0);
  return Math.max(0, limits - contributed + back);
}

// ---- the RRSP (a deduction now, tax on the way out) ----
// Room in `year`: for each year so far, 18% of the PREVIOUS year's earned income up to the dollar limit (year 1 has no earlier year, so no room), added up, less everything ever
// contributed. So unused room carries forward, and a withdrawal does not appear: it never gives room back. income: { [year]: gross cents }.
export function rrspRoom(year, income, contributed, limit = RRSP_LIMIT_CENTS) {
  const at = perYear(limit);
  let earned = 0;
  for (let y = 2; y <= year; y++) earned += Math.min(Math.floor(((income[y - 1] ?? 0) * RRSP_EARNED_PCT) / 100), at(y));
  return Math.max(0, earned - contributed);
}
// The tax withheld at source on ONE withdrawal: the whole amount at its band's rate (10% to $5,000, 20% to $15,000, 30% above), rounded half up to the cent.
export const rrspWithheld = (cents) => Math.floor((cents * RRSP_WITHHOLDING.find(([top]) => cents <= top)[1] + 50) / 100);
// The year-end settlement. taxBefore = tax on the year's income as earned, taxAfter = tax with the contributions deducted and the withdrawals added; withheld is what was
// already paid on the withdrawals. Positive: a refund; negative: a balance owing.
export const rrspSettle = (taxBefore, taxAfter, withheld) => taxBefore - taxAfter + withheld;
// Teaching comparison of the same `cents` in a TFSA and an RRSP over `years` at `bp` a year (display only, floats are fine here, nothing touches the ledger).
// TFSA: grows, comes out untaxed. RRSP: grows untaxed and comes out taxed at `retireBp`, plus the refund (`marginalBp` of the contribution) invested in a TFSA now.
export function rrspCompare(cents, bp, years, marginalBp, retireBp) {
  const g = (1 + bp / 10000) ** years;
  return { tfsa: Math.round(cents * g), rrsp: Math.round(cents * g * (1 - retireBp / 10000)) + Math.round(((cents * marginalBp) / 10000) * g) };
}
