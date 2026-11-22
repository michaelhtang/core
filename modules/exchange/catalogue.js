// exchange catalogue: the securities (seeded, extraStocks, listings), the listSecurity/delistSecurity services, queued market events, and the price book
import { ok } from '../../lib/kernel.js';
import { SECURITIES, STOCKS, EQUITY_RETURN_BP, PRICE_SCALE, EVENTS, spreadOf } from './constants.js';
import { sides } from './orders.js';
import { stmt, secretOf } from './reads.js';

const EXTRA = /^[A-Z]{2,5}$/;
const RATE_PAUSE = 'Paused: the Bank of DAA announces a new policy rate at the next world month. Trading reopens after it.';

// ---- the catalogue: the seeded securities, any stocks the deployment adds in config.options.exchange.extraStocks, and this world's listings ----
// extraStocks: [{ ticker 'ABCD', name, sigmaBp 1000-8000, tiltBp -500..500, yieldBp 0-400, startCents 100-1000000 }]; bad rows are ignored.
// What is wrong with a custom stock (the same rules for extraStocks and the listSecurity service), or null.
function stockProblem(x, list) {
  if (typeof x?.ticker !== 'string' || !EXTRA.test(x.ticker)) return 'ticker must be 2 to 5 capital letters';
  if (list.some((s) => s.ticker === x.ticker)) return `ticker ${x.ticker} is already listed`;
  if (typeof x.name !== 'string' || !x.name || x.name.length > 40) return 'name must be 1 to 40 characters';
  if (!ok(x.sigmaBp) || x.sigmaBp < 1000 || x.sigmaBp > 8000) return 'sigmaBp must be 1000 to 8000';
  if (!ok(x.tiltBp) || x.tiltBp < -500 || x.tiltBp > 500) return 'tiltBp must be -500 to 500';
  if (!ok(x.yieldBp) || x.yieldBp < 0 || x.yieldBp > 400) return 'yieldBp must be 0 to 400';
  if (!ok(x.startCents) || x.startCents < 100 || x.startCents > 1_000_000) return 'startCents must be 100 to 1000000';
  return null;
}
const custom = (x, sector, note) => ({ ticker: x.ticker, name: x.name, kind: 'stock', type: 'equity', sector, sigmaBp: x.sigmaBp, muBp: EQUITY_RETURN_BP + x.tiltBp, yieldBp: x.yieldBp, startMicro: x.startCents * PRICE_SCALE, merBp: 0, note });
const fixed = new WeakMap();   // k -> the seeded securities + extraStocks (config only, so cached per kernel)
export function secs(k) {
  let list = fixed.get(k);
  if (!list) {
    list = [...SECURITIES];
    for (const x of Array.isArray(k.config.extraStocks) ? k.config.extraStocks : []) if (!stockProblem(x, list)) list.push(custom(x, 'Custom', 'Added by your teacher.'));
    fixed.set(k, list);
  }
  // Listings (listSecurity) are read each time, not cached: one indexed read, and a listing rolled back with its caller's transaction is gone at once.
  const listed = stmt(k, 'SELECT * FROM exchange_listings WHERE world_id = ? AND delisted_month IS NULL ORDER BY listed_month, ticker').all(k.world.current()?.id ?? -1);
  if (!listed.length) return list;
  const have = new Set(list.map((s) => s.ticker));                     // config wins: a listing can't duplicate a seeded or extraStocks ticker (one price row each)
  return [...list, ...listed.filter((r) => !have.has(r.ticker)).map(listedSec)];
}
const listedSec = (r) => ({ ...custom({ ticker: r.ticker, name: r.name, sigmaBp: r.sigma_bp, tiltBp: r.tilt_bp, yieldBp: 0, startCents: r.start_cents }, r.sector, 'Listed on the DAA Exchange by a student business.'),
  sharesOutstanding: r.shares_outstanding, ownerBusinessId: r.owner_business_id });

// ---- services (docs/modules.md "Services"): Phase 4's ventures module lists a student business's stock here (its IPO) and delists it ----
// The price model is the town stocks' (prices.js): a business in a town company's sector moves like it (that stock's sigma and sector tilt), any other
// like a typical town stock, unless the caller passes sigmaBp / tiltBp. No dividend yet (a listed company's dividend must come from its own treasury).
// ponytail: the market maker is still the counterparty (buys -> sink, sells <- mint), so the business gets no IPO proceeds and sharesOutstanding is
// recorded, not enforced. Student-to-student matching, with a settlement path that pays the business and its shareholders, is the next step.
const DEFAULT_SIGMA_BP = 3300;   // KEYS, the middle of the town's stocks
export function listSecurity(k, args, { from }) {
  const w = k.world.active();
  const x = args ?? {};
  if (x.kind !== 'stock') throw new k.HttpError(400, "listSecurity: kind must be 'stock'");
  const sector = typeof x.sector === 'string' && x.sector.trim() && x.sector.length <= 40 ? x.sector.trim() : null;
  if (!sector) throw new k.HttpError(400, 'listSecurity: sector must be 1 to 40 characters');
  if (!ok(x.sharesOutstanding) || x.sharesOutstanding < 1) throw new k.HttpError(400, 'listSecurity: sharesOutstanding must be a positive whole number');
  if (x.ownerBusinessId !== undefined && x.ownerBusinessId !== null && !ok(x.ownerBusinessId)) throw new k.HttpError(400, 'listSecurity: ownerBusinessId must be an integer');
  const peer = STOCKS.find((s) => s.sector.toLowerCase() === sector.toLowerCase());
  const sec = { ticker: x.ticker, name: typeof x.name === 'string' ? x.name.trim() : x.name, startCents: x.startCents, yieldBp: 0, sigmaBp: x.sigmaBp ?? peer?.sigmaBp ?? DEFAULT_SIGMA_BP, tiltBp: x.tiltBp ?? (peer ? peer.muBp - EQUITY_RETURN_BP : 0) };
  const taken = stmt(k, 'SELECT 1 FROM exchange_listings WHERE world_id = ? AND ticker = ?').get(w.id, sec.ticker)   // a delisted ticker is not reused within its season (its prices are kept)
    ?? stmt(k, 'SELECT 1 FROM exchange_prices WHERE world_id = ? AND ticker = ? LIMIT 1').get(w.id, sec.ticker);   // nor one with price history (e.g. removed from extraStocks)
  const why = stockProblem(sec, secs(k)) ?? (taken ? `ticker ${sec.ticker} was already used this season` : null);
  if (why) throw new k.HttpError(400, `listSecurity: ${why}`);
  stmt(k, `INSERT INTO exchange_listings (world_id, ticker, name, sector, sigma_bp, tilt_bp, start_cents, shares_outstanding, owner_business_id, listed_by, listed_month, created)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(w.id, sec.ticker, sec.name, sector, sec.sigmaBp, sec.tiltBp, sec.startCents, x.sharesOutstanding, x.ownerBusinessId ?? null, from, w.month, k.clock.now());
  k.audit('list', { worldId: w.id, ticker: sec.ticker, by: from, ownerBusinessId: x.ownerBusinessId ?? null });
  return { ticker: sec.ticker, worldId: w.id, month: w.month, startCents: sec.startCents, sigmaBp: sec.sigmaBp, tiltBp: sec.tiltBp };
}
// Refused while anyone holds it or has an open order for it (a cash-out of the holders comes with the settlement step); only the module that listed it.
export function delistSecurity(k, args, { from }) {
  const w = k.world.active();
  const r = stmt(k, 'SELECT * FROM exchange_listings WHERE world_id = ? AND ticker = ? AND delisted_month IS NULL').get(w.id, args?.ticker);
  if (!r) throw new k.HttpError(404, `delistSecurity: ${args?.ticker} is not listed`);
  if (r.listed_by !== from) throw new k.HttpError(403, `delistSecurity: ${r.ticker} was listed by "${r.listed_by}"`);
  if (stmt(k, 'SELECT 1 FROM exchange_holdings WHERE world_id = ? AND ticker = ? AND ended = 0 AND units_micro > 0 LIMIT 1').get(w.id, r.ticker)
    || stmt(k, "SELECT 1 FROM exchange_orders WHERE world_id = ? AND ticker = ? AND status = 'open' LIMIT 1").get(w.id, r.ticker)) throw new k.HttpError(409, `delistSecurity: ${r.ticker} still has holders or open orders`);
  stmt(k, 'UPDATE exchange_listings SET delisted_month = ? WHERE world_id = ? AND ticker = ?').run(w.month, w.id, r.ticker);
  k.audit('delist', { worldId: w.id, ticker: r.ticker, by: from });
  return { ticker: r.ticker, delistedMonth: w.month };
}

// A market event, queued now and applied at the next tick on top of the normal step (the teacher's POST /event and the stageEvent service).
// A stock-scope event (scandal, boom) needs one of the town companies' tickers. headline: shown in the news instead of the template (or null). Returns the row id.
export function queueEvent(k, w, { kind, ticker, headline, by, classId }) {
  if (EVENTS[kind].scope === 'stock' && !secs(k).some((s) => s.kind === 'stock' && s.ticker === ticker)) throw new k.HttpError(400, 'Pick one of the town companies');
  return k.db.txn((tx) => {
    const id = Number(stmt(k, 'INSERT INTO exchange_events (world_id, kind, ticker, created_month, by_player, created, headline) VALUES (?, ?, ?, ?, ?, ?, ?)').run(w.id, kind, EVENTS[kind].scope === 'stock' ? ticker : null, w.month, by, k.clock.now(), headline).lastInsertRowid);
    k.audit('event', { id, worldId: w.id, kind, ticker: EVENTS[kind].scope === 'stock' ? ticker : null, ...(headline && { headline }) }, by == null ? 'system' : `player:${by}`);
    tx.onCommit(() => k.events.emit('changed', { classId }));
    return id;
  });
}

// Bond-linked: the bond fund, and any blend holding it. Their next move on a queued policy change is known in advance, so they pause until it applies.
const bondLinked = (s, list) => s.type === 'bond' || (s.type === 'blend' && Object.keys(s.blend).some((t) => list.find((x) => x.ticker === t)?.type === 'bond'));

// ---- prices ----
// The latest price of every security in this world (the base price when nothing has been stored yet), with the market maker's bid and ask, the breaker flag,
// and `paused` (a reason, or null) while a queued policy-rate change is waiting for its tick.
export function book(k, w) {
  const pending = stmt(k, 'SELECT effective_month FROM exchange_rate_pending WHERE world_id = ?').get(w.id);
  const ratePause = pending && pending.effective_month > w.month;
  // The latest row of each security: one primary-key seek per ticker (a GROUP BY over the world's whole price history cost ~1 ms per call by month 500, and
  // the retirement draws call book() for every retiree every month).
  const latest = stmt(k, 'SELECT price_micro, halted, month FROM exchange_prices WHERE world_id = ? AND ticker = ? ORDER BY month DESC LIMIT 1');
  const out = new Map();
  const list = secs(k);
  for (const s of list) {
    const r = latest.get(w.id, s.ticker), price = r?.price_micro ?? s.startMicro;
    out.set(s.ticker, { sec: s, price, halted: !!r?.halted, paused: ratePause && bondLinked(s, list) ? RATE_PAUSE : null, month: r?.month ?? w.month, ...sides(price, spreadOf(s)) });
  }
  return out;
}
// A world's first trade or first tick stores the base prices (at `month`), so the series always has a starting row.
export function ensurePrices(k, w, month = w.month) {
  const have = new Set(stmt(k, 'SELECT DISTINCT ticker FROM exchange_prices WHERE world_id = ?').all(w.id).map((r) => r.ticker));
  for (const s of secs(k)) if (!have.has(s.ticker)) stmt(k, 'INSERT INTO exchange_prices (world_id, ticker, month, price_micro, halted) VALUES (?, ?, ?, ?, 0)').run(w.id, s.ticker, month, s.startMicro);
  secretOf(k, w.id);
}
