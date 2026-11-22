// ventures: the pure maths (no I/O): unit cost, the linear demand curve, how demand is shared out between competitors, the seeded noise,
// the founders' equity split and the pro-rata payout. test/ventures.test.js checks these directly.
import { createHash } from 'node:crypto';
import { MINUTE_CENTS, NOISE_BP } from './constants.js';

// Unit cost in cents today: materials + minutes at the minimum wage, times the world price index (bp).
export const unitCost = (t, indexBp = 10000) => Math.round(((t.materials_cents + t.minutes * MINUTE_CENTS) * indexBp) / 10000);

// The town's demand curve for one product type, Q = max(0, a - b * P), P in dollars.
//   a = the row's a (per 100 residents) x residents / 100 x the teacher's a multiplier: the town's size (a fixed NPC town, TOWN_SIZE).
//   b = (the row's a x residents / 100) / its choke price x the teacher's b multiplier: price sensitivity. b scales with the town too,
//   so the choke price a/b is the sector's, not the town's (a town twice the size buys twice as much at every price).
// The choke price follows the price index, so inflation moves willingness to pay along with costs.
export function curve(t, residents, aBp = 10000, bBp = 10000, indexBp = 10000) {
  const base = (t.a100 * residents) / 100;
  const chokeDollars = (t.choke_cents * indexBp) / 10000 / 100;
  const a = (base * aBp) / 10000, b = chokeDollars > 0 ? ((base / chokeDollars) * bBp) / 10000 : 0;
  return { a, b, choke_cents: b > 0 ? Math.round((a / b) * 100) : 0, best_cents: b > 0 ? Math.round((a / b) * 50) : 0 };   // best = the revenue-maximising price a/2b
}
export const demandAt = (c, priceCents) => Math.max(0, c.a - (c.b * priceCents) / 100);

// One product type, several competitors: each would sell d_i = Q(P_i) on its own (times its noise, if any); it gets d_i x w_i / sum(w),
// w_i = d_i x reputation_i. One seller gets its whole curve; two sellers at the same price split it; the cheaper (or better-reputed) one
// takes more. Units, as floats.
const own = (c, s) => (demandAt(c, s.price_cents) * (10000 + (s.noise_bp ?? 0))) / 10000;
export function share(c, sellers) {
  const d = sellers.map((s) => own(c, s));
  const w = d.map((x, i) => x * sellers[i].rep_bp);
  const total = w.reduce((t, x) => t + x, 0);
  return sellers.map((s, i) => (total > 0 ? (d[i] * w[i]) / total : 0));
}
// The same, when sellers can only sell what they have (cap, units; Infinity for the town's own shop): a seller's share is capped at its stock
// and what it cannot supply goes to the others in proportion to their shares, until nobody is over (or everyone is full).
export function allocate(c, sellers) {
  const base = share(c, sellers), out = [...base];
  for (let round = 0; round < sellers.length; round++) {
    let excess = 0;
    out.forEach((x, i) => { if (x > sellers[i].cap) { excess += x - sellers[i].cap; out[i] = sellers[i].cap; } });
    const open = out.map((x, i) => (x < sellers[i].cap ? base[i] : 0)), weight = open.reduce((t, x) => t + x, 0);
    if (excess <= 1e-9 || weight <= 0) break;
    out.forEach((x, i) => { if (open[i] > 0) out[i] += (excess * open[i]) / weight; });
  }
  return out;
}
// The town's own shop for a product type (an NPC incumbent): always open, never runs out, priced at refBp of the choke price. It is a
// seller in share()/allocate() like any other, so a student company that prices under it takes more of the town and one over it less.
export const incumbentPrice = (c, refBp) => Math.round((c.choke_cents * refBp) / 10000);

// A seeded draw in [-NOISE_BP, +NOISE_BP] from the world's secret: unknown to students, the same on a rerun.
export function noiseBp(secret, month, productId) {
  const n = createHash('sha256').update(`${secret}:${month}:${productId}`).digest().readUInt32BE(0);
  return (n % (2 * NOISE_BP + 1)) - NOISE_BP;
}

// Founder shares: `total` micro-units split by bp (summing to 10000), or equally when bps is null. Remainders go to the first members, so the
// units always add up to the total exactly.
export function splitUnits(total, n, bps = null) {
  const raw = bps ? bps.map((bp) => Math.floor((total * bp) / 10000)) : Array(n).fill(Math.floor(total / n));
  let left = total - raw.reduce((t, x) => t + x, 0);
  for (let i = 0; left > 0; i = (i + 1) % n, left--) raw[i]++;
  return raw;
}

// floor(a x b / c) without losing precision: cents x micro-units passes 2^53.
export const mulDiv = (a, b, c) => Number((BigInt(a) * BigInt(b)) / BigInt(c));

// Pro rata: cents shared by units, floored, the leftover cents to the largest holders first (ties: list order). Sums to `cents` exactly.
export function proRata(cents, holders) {
  const total = holders.reduce((t, h) => t + h.units, 0);
  if (!total || cents <= 0) return holders.map(() => 0);
  const out = holders.map((h) => mulDiv(cents, h.units, total));
  let left = cents - out.reduce((t, x) => t + x, 0);
  const order = holders.map((h, i) => i).sort((a, b) => holders[b].units - holders[a].units || a - b);
  for (let i = 0; left > 0; i = (i + 1) % order.length, left--) out[order[i]]++;
  return out;
}
// The price (whole cents, in [lo, hi]) that maximises revenue for a lone seller up against the town shop: what the bots aim near.
export function bestAgainstShop(c, lo, hi, refBp) {
  const shop = { price_cents: incumbentPrice(c, refBp), rep_bp: 10000 };
  let best = lo, top = -1;
  for (let p = lo; p <= hi; p += Math.max(1, Math.floor((hi - lo) / 400))) {
    const r = p * share(c, [{ price_cents: p, rep_bp: 10000 }, shop])[0];
    if (r > top) { top = r; best = p; }
  }
  return best;
}

// ---- wave 4b: the Venture Bank's loan maths. A business term loan compounds monthly at the nominal annual rate / 12 (unlike a Canadian
// mortgage, which the Interest Act has compound semi-annually: modules/housing/mortgage.js), so housing's payment() is not reused. ----
export const loanInterest = (balanceCents, bp) => Math.round((balanceCents * bp) / 120000);
export function loanPayment(principalCents, bp, months) {
  if (!(principalCents > 0) || !(months > 0)) return 0;
  const i = bp / 120000;
  return Math.round(i === 0 ? principalCents / months : (principalCents * i) / (1 - (1 + i) ** -months));
}
// What is due this month on `balance`: the payment, or on the last one (last = the term's final month) whatever clears the balance, so the
// rounded payment never leaves a stub. { interest, principal, due }.
export function loanDue(balanceCents, bp, paymentCents, last = false) {
  const interest = loanInterest(balanceCents, bp);
  const due = last ? balanceCents + interest : Math.min(paymentCents, balanceCents + interest);
  return { interest, principal: due - interest, due };
}
// Small business income tax for a year: losses carried forward first. { applied, taxable, tax, lossAfter }.
export function yearTax(incomeCents, lossCfCents, rateBp) {
  if (incomeCents <= 0) return { applied: 0, taxable: 0, tax: 0, lossAfter: lossCfCents - incomeCents };
  const applied = Math.min(lossCfCents, incomeCents), taxable = incomeCents - applied;
  return { applied, taxable, tax: Math.round((taxable * rateBp) / 10000), lossAfter: lossCfCents - applied };
}
export const gstOf = (cents, bp) => Math.round((cents * bp) / 10000);
