// The price model, pure: no database, no clock, no module state. One call = one world month for every security.
//
// RANDOMNESS. Each draw is seeded by the text `${secret}:${worldId}:${key}:${month}` (key = the ticker, or 'MKT' for the common market factor;
// secret = the world's random 128-bit secret, kept server-side in exchange_secrets; without a secret the prefix is left out):
//   hash32 = FNV-1a over the UTF-8 bytes (32-bit) -> mulberry32(seed) (a 32-bit PRNG, public domain, one multiply-xorshift round per draw)
//   -> two uniforms u = (floor(r x 2^32) + 0.5) / 2^32, strictly inside (0, 1) -> Box-Muller z = sqrt(-2 ln u1) cos(2 pi u2) -> clipped to +-Z_CAP.
// Students cannot predict it (the secret never leaves the server, so the code and the world id are not enough), a teacher cannot rig it (there is no
// input for it), and a rerun of a world with the same secret gives the same series. Floats are used for the model; the price itself is rounded to an integer of micro-cents before it is stored.
// (Math.exp/log/cos are the same on every V8 platform; a different engine could differ in the last bit, hence the price rounds to micro-cents, not further.)
//
// THE STEP (per world month, per security, with sigma and mu as decimals, y the dividend yield):
//   gross = exp(ln(1 + mu - y)/12 + sigma z / sqrt(12))                  the median (compound) growth is (1 + mu - y) a year: mu is a compound return
//   price' = round(price x gross x eventFactor x (1 - MER/12))           the MER comes out of the price bit by bit
//   stock and index fund z = sqrt(rho) M + sqrt(1 - rho) e_ticker        M is the month's market draw: corr(stock, stock) = rho = 0.6, corr(stock, DAAX) = sqrt(0.6)
//   the index fund DAAX is the market factor itself (z = M); the bond fund DAAB has its own independent draw (corr 0 with stocks)
//   the bond fund also takes x max(0.5, 1 - duration x change in policy rate): +25 bp at duration 7 = -1.75%
//   the balanced fund's gross = 0.6 x gross(DAAX) + 0.4 x gross(DAAB), events and the rate shock included, then its own MER
// A stock's mu is a TOTAL return, so its price growth uses mu - y: its dividends are the rest.
import { PRICE_SCALE, Z_CAP, CORRELATION, BREAKER_PCT, MIN_PRICE_MICRO, EVENTS } from './constants.js';

export function hash32(text) {
  let h = 0x811c9dc5;
  for (const b of new TextEncoder().encode(text)) { h ^= b; h = Math.imul(h, 0x01000193) >>> 0; }
  return h >>> 0;
}

export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Box-Muller from two uniforms of the generator, strictly inside (0, 1).
export function normal(rng) {
  const u1 = (Math.floor(rng() * 4294967296) + 0.5) / 4294967296, u2 = (Math.floor(rng() * 4294967296) + 0.5) / 4294967296;
  return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
}

export const zFor = (worldId, key, month, secret = '') => Math.max(-Z_CAP, Math.min(Z_CAP, normal(mulberry32(hash32(`${secret ? `${secret}:` : ''}${worldId}:${key}:${month}`)))));

const isEquity = (s) => s.kind === 'stock' || s.type === 'equity';

// The growth factor of one non-blended security before events, fees and the rate shock.
export const growth = ({ muBp, sigmaBp, yieldBp = 0 }, z) => {
  const mu = muBp / 10000, sigma = sigmaBp / 10000, y = yieldBp / 10000;
  return Math.exp(Math.log(1 + mu - y) / 12 + (sigma * z) / Math.sqrt(12));
};

// Bond price factor for a change in the policy rate (basis points): -duration x change, never below half the price.
export const rateFactor = (durationYears, deltaBp) => Math.max(0.5, 1 - (durationYears * deltaBp) / 10000);

// What the market events multiply a security by (events: [{ kind, ticker }]).
export function eventFactor(sec, events) {
  let f = 1;
  for (const e of events) {
    const ev = EVENTS[e.kind];
    if (!ev) continue;
    if (ev.scope === 'market') f *= 1 + (sec.type === 'bond' ? ev.bondPct : isEquity(sec) ? ev.equityPct : 0) / 100;
    else if (sec.kind === 'stock' && sec.ticker === e.ticker) f *= 1 + ev.stockPct / 100;
  }
  return f;
}

const zOf = (worldId, month, sec, market, secret) => {
  const own = zFor(worldId, sec.ticker, month, secret);
  if (sec.kind === 'stock') return Math.sqrt(CORRELATION) * market + Math.sqrt(1 - CORRELATION) * own;
  return sec.type === 'equity' ? market : own;
};

// One month for every security. prev: { ticker: micro-cents }. Returns { price: {ticker: micro}, halted: {ticker: bool} }.
// halted: the security's NORMAL move (noise, the rate shock, fees; events excluded) was more than BREAKER_PCT, or a crash hit it. Events pass through the breaker:
// they move the price but do not pause trading, except a crash, which pauses the stocks and the index fund for the month (documented exception).
export function monthStep({ worldId, secret = '', month, prev, securities, policyDeltaBp = 0, events = [] }) {
  const market = zFor(worldId, 'MKT', month, secret);
  const crash = events.some((e) => e.kind === 'crash');
  const parts = {};                                                   // gross factors of the single-asset securities, without and with events
  for (const s of securities) {
    if (s.type === 'blend') continue;
    const shock = s.type === 'bond' ? rateFactor(s.durationYears ?? 0, policyDeltaBp) : 1;
    const g = growth(s, zOf(worldId, month, s, market, secret)) * shock;
    parts[s.ticker] = { nat: g, ev: g * eventFactor(s, events) };
  }
  const price = {}, halted = {};
  for (const s of securities) {
    const p = prev[s.ticker];
    if (!Number.isSafeInteger(p)) continue;
    let nat, ev;
    if (s.type === 'blend') {
      const mix = (key) => Object.entries(s.blend).reduce((t, [tk, w]) => t + (w / 100) * (parts[tk]?.[key] ?? 1), 0);
      nat = mix('nat'); ev = mix('ev');
    } else ({ nat, ev } = parts[s.ticker]);
    const fee = 1 - (s.merBp ?? 0) / 10000 / 12;
    const natural = Math.round(p * nat * fee);
    price[s.ticker] = Math.max(MIN_PRICE_MICRO, Math.round(p * ev * fee));
    halted[s.ticker] = Math.abs(natural - p) * 100 > p * BREAKER_PCT || (crash && (s.kind === 'stock' || s.ticker === 'DAAX'));
  }
  return { price, halted };
}

// The expected annual return in basis points, for the Rule of 72 and the MER lesson: funds net of their MER; a stock's is its total return.
export function expectedBp(sec, all) {
  const mu = sec.type === 'blend' ? Object.entries(sec.blend).reduce((t, [tk, w]) => t + (w * all.find((x) => x.ticker === tk).muBp) / 100, 0) : sec.muBp;
  return mu - (sec.merBp ?? 0);
}

// Rule of 72: years to double at an annual rate given in basis points (null when the rate is not positive).
export const doublingYears = (bp) => (bp > 0 ? 72 / (bp / 100) : null);

// Dollars shown to the cent: micro-cents -> cents, rounded half up. The stored price keeps all four extra digits.
export const microToCents = (micro) => Math.round(micro / PRICE_SCALE);
