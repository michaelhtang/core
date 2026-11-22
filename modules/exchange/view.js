// exchange student view: the /state payload (securities, holdings, RRSP card, orders, the activity log, news) and the order request body parser
import { PRICE_SCALE, UNIT, ORDERS_PER_MONTH, ORDER_SHARE_PCT, LIMIT_EXPIRY_MONTHS, BREAKER_PCT, SOURCES_CHECKED, GUIDELINES_URL, TFSA_URL, RRSP_URL, RRSP_EARNED_PCT, RRSP_WITHHOLDING, COMPARE_CENTS, COMPARE_YEARS, COMPARE_RETIRE_BP, spreadOf, stepOf } from './constants.js';
import { expectedBp, doublingYears, microToCents } from './prices.js';
import { yearOf, tfsaRoom, rrspCompare } from './orders.js';
import { annualIncomeTax } from '../jobs/payroll.js';
import { stmt, balOf, investable, settings, reservedOf, valueOfHolding } from './reads.js';
import { book, secs } from './catalogue.js';
import { indexing, limitsOf, limitsIn, tfsaRows, tfsaRoomOf, incomeByYear, rrspRoomOf, rrspYear, slip, oasThreshold, accountOf } from './registered.js';

export const MAX_UNITS = 10_000_000_000, MAX_CENTS = 10_000_000_000;

// ---- the student's view ----
function holdingsView(k, w, b, pid) {
  const rows = stmt(k, 'SELECT account, ticker, units_micro, cost_cents, drip FROM exchange_holdings WHERE player_id = ? AND world_id = ? AND ended = 0 AND units_micro > 0 ORDER BY account, ticker').all(pid, w.id);
  return rows.map((h) => {
    const m = b.get(h.ticker), value = valueOfHolding(b, h.ticker, h.units_micro);
    return { account: h.account, ticker: h.ticker, name: m?.sec.name ?? h.ticker, kind: m?.sec.kind ?? 'stock', units_micro: h.units_micro, cost_cents: h.cost_cents, value_cents: value, gain_cents: value - h.cost_cents,
      avg_cents: Math.round((h.cost_cents * UNIT) / h.units_micro), drip: !!h.drip, reserved_micro: reservedOf(k, pid, w.id, h.account, h.ticker), pays: (m?.sec.yieldBp ?? 0) > 0 };
  });
}

// The student's own activity log, newest first: buys and sells (market orders, limit fills, retirement draws; a trade the teacher undid is marked) and dividends
// (cash, or reinvested: the DRIP buy is folded into its dividend's row). Read-only: it lists this player's exchange_trades and exchange_dividends in this world.
// Order inside one world month: the market orders a student places after the month starts, then the tick's dividends and retirement draws, then its limit fills.
export const ACTIVITY_MAX = 100;
function activityView(k, w, b, pid) {
  const trades = stmt(k, 'SELECT id, month, account, ticker, side, units_micro, price_micro, cents, basis_cents, via, undone FROM exchange_trades WHERE player_id = ? AND world_id = ? ORDER BY id DESC LIMIT ?').all(pid, w.id, ACTIVITY_MAX * 2);
  const divs = stmt(k, 'SELECT id, month, account, ticker, units_micro, cents, drip FROM exchange_dividends WHERE player_id = ? AND world_id = ? ORDER BY id DESC LIMIT ?').all(pid, w.id, ACTIVITY_MAX);
  const key = (r) => `${r.month}|${r.account}|${r.ticker}`, drips = new Map();
  for (const t of trades) if (t.via === 'drip' && !drips.has(key(t))) drips.set(key(t), t);
  const used = new Set(), out = [];
  const base = (r) => ({ month: r.month, ticker: r.ticker, name: b.get(r.ticker)?.sec.name ?? r.ticker, kind: b.get(r.ticker)?.sec.kind ?? 'stock', account: r.account });
  for (const d of divs) {
    const t = d.drip ? drips.get(key(d)) : undefined;
    if (t) used.add(t.id);
    out.push({ type: 'dividend', ...base(d), units_micro: d.units_micro, cents: d.cents, drip: !!d.drip,
      reinvested: t ? { units_micro: t.units_micro, price_cents: microToCents(t.price_micro), cents: t.cents } : null, order: [d.month, 1, d.id] });
  }
  for (const t of trades) {
    if (used.has(t.id)) continue;
    out.push({ type: t.side, ...base(t), units_micro: t.units_micro, price_cents: microToCents(t.price_micro), cents: t.cents, via: t.via, undone: !!t.undone,
      gain_cents: t.side === 'sell' ? t.cents - t.basis_cents : null, order: [t.month, t.via === 'market' ? 2 : t.via === 'limit' ? 0 : 1, t.id] });
  }
  out.sort((a, z) => z.order[0] - a.order[0] || z.order[1] - a.order[1] || z.order[2] - a.order[2]);
  return out.slice(0, ACTIVITY_MAX).map(({ order, ...r }) => r);
}

// The RRSP card: room, this year's figures, what the year-end settlement would be if the year ended today, the last tax slip and the TFSA-vs-RRSP comparison.
function rrspView(k, pid, w, year, expectedBp) {
  const inc = incomeByYear(k, pid, w.id), y = rrspYear(k, pid, w.id, year), G = inc[year] ?? 0;
  const last = stmt(k, 'SELECT * FROM exchange_settlements WHERE player_id = ? AND world_id = ? ORDER BY year DESC LIMIT 1').get(pid, w.id) ?? null;
  const carry = stmt(k, 'SELECT unpaid_cents FROM exchange_settlements WHERE player_id = ? AND world_id = ? AND year = ?').get(pid, w.id, year - 1)?.unpaid_cents ?? 0;
  const sl = slip(G, y.c, y.w, y.h, y.p, y.o, oasThreshold(k, w.id));
  // the rate the next dollar of taxable income is taxed at (bracket rates only: CPP and EI stay as earned), on last year's pay, or this year's so far scaled up to a year
  const base = inc[year - 1] || Math.round((G * 12) / (((w.month - 1) % 12) + 1)), marginalBp = Math.round(((annualIncomeTax(base + 100000, base) - annualIncomeTax(base, base)) * 10000) / 100000);
  return {
    limit_cents: limitsIn(k, w.id, year).rrsp, earned_pct: RRSP_EARNED_PCT, room_cents: rrspRoomOf(k, pid, w.id, year), url: RRSP_URL,
    income_cents: G, last_year_income_cents: inc[year - 1] ?? 0, contributed_cents: y.c, withdrawn_cents: y.w, withheld_cents: y.h,
    if_year_ended: { ...sl, carry_cents: carry, net_cents: sl.settle - carry },
    bands: RRSP_WITHHOLDING.map(([top, pct], i) => ({ from_cents: i ? RRSP_WITHHOLDING[i - 1][0] : 0, up_to_cents: Number.isFinite(top) ? top : null, pct })),
    last, marginal_bp: marginalBp,
    compare: { cents: COMPARE_CENTS, years: COMPARE_YEARS, expected_bp: expectedBp, marginal_bp: marginalBp,
      rows: [['Retire at the same tax rate', marginalBp], ['Retire at a lower rate', COMPARE_RETIRE_BP[0]], ['Retire at a higher rate', COMPARE_RETIRE_BP[1]]].map(([label, retire_bp]) => ({ label, retire_bp, ...rrspCompare(COMPARE_CENTS, expectedBp, COMPARE_YEARS, marginalBp, retire_bp) })) },
  };
}

export function state(k, user) {
  const w = k.world.current();
  const b = book(k, w);
  const list = secs(k);
  const spark = new Map();
  for (const r of stmt(k, 'SELECT ticker, month, price_micro FROM exchange_prices WHERE world_id = ? AND month > ? ORDER BY ticker, month').all(w.id, w.month - 13)) (spark.get(r.ticker) ?? spark.set(r.ticker, []).get(r.ticker)).push(r);
  const securities = list.map((s) => {
    const m = b.get(s.ticker), pts = spark.get(s.ticker) ?? [];
    const prev = pts.length > 1 ? pts.at(-2).price_micro : null;
    const exp = expectedBp(s, list);
    return {
      ticker: s.ticker, name: s.name, kind: s.kind, type: s.type, sector: s.sector ?? null, note: s.note, price_micro: m.price, price_cents: microToCents(m.price), bid_micro: m.bid, ask_micro: m.ask, bid_cents: microToCents(m.bid), ask_cents: microToCents(m.ask),
      change_bp: prev ? Math.round(((m.price - prev) * 10000) / prev) : null, halted: m.halted, paused: m.paused, yield_bp: s.yieldBp ?? 0, mer_bp: s.merBp ?? 0, volatility_bp: s.sigmaBp ?? null, expected_bp: exp, doubling_years: doublingYears(exp),
      spread_bp: spreadOf(s), step_micro: stepOf(s), spark: pts.map((p) => microToCents(p.price_micro)), duration_years: s.durationYears ?? null,
    };
  });
  const holdings = holdingsView(k, w, b, user.id);
  const cash = { chequing_cents: balOf(k, user.id, 'chequing'), invest_cents: balOf(k, user.id, 'invest'), tfsa_cents: balOf(k, user.id, 'tfsa'), rrsp_cents: balOf(k, user.id, 'rrsp'), hold_cents: balOf(k, user.id, 'xhold') };
  const year = yearOf(w.month), rows = tfsaRows(k, user.id, w.id);
  const alloc = new Map([['cash', cash.invest_cents + cash.tfsa_cents + cash.rrsp_cents + cash.hold_cents]]);
  for (const h of holdings) alloc.set(h.ticker, (alloc.get(h.ticker) ?? 0) + h.value_cents);
  const orders = stmt(k, `SELECT id, account, ticker, side, type, units_micro, limit_micro, hold_cents, status, placed_month, expires_month, filled_month FROM exchange_orders
    WHERE player_id = ? AND world_id = ? AND (status = 'open' OR placed_month >= ?) ORDER BY (status = 'open') DESC, id DESC LIMIT 30`).all(user.id, w.id, w.month - 3);
  const used = stmt(k, 'SELECT COUNT(*) AS n FROM exchange_orders WHERE player_id = ? AND world_id = ? AND placed_month = ?').get(user.id, w.id, w.month).n;
  const inv = investable(k, user.id);
  const rrsp = rrspView(k, user.id, w, year, securities.find((q) => q.ticker === 'DAAX').expected_bp);
  return {
    month: w.month, year, open: w.status === 'active', frozen: !!settings(k, w.id).frozen, checked: SOURCES_CHECKED, guidelines_url: GUIDELINES_URL, tfsa_url: TFSA_URL,
    securities, accounts: cash, holdings,
    portfolio_cents: holdings.reduce((t, h) => t + h.value_cents, 0), cost_cents: holdings.reduce((t, h) => t + h.cost_cents, 0),
    allocation: [...alloc].filter(([, c]) => c > 0).map(([key, cents]) => ({ key, label: key === 'cash' ? 'Cash' : key, cents })),
    rrsp,
    tfsa: { limit_cents: limitsIn(k, w.id, year).tfsa, limits_total_cents: tfsaRoom(year, [], limitsOf(k, w.id).tfsa), indexed: indexing(k), room_cents: tfsaRoomOf(k, user.id, w.id, year), contributed_cents: rows.reduce((t, r) => t + r.contributed, 0), withdrawn_cents: rows.reduce((t, r) => t + r.withdrawn, 0),
      room_back_cents: rows.filter((r) => r.year === year).reduce((t, r) => t + r.withdrawn, 0) },
    orders: orders.map((o) => ({ ...o, name: b.get(o.ticker)?.sec.name ?? o.ticker, limit_cents: o.limit_micro === null ? null : Math.round(o.limit_micro / PRICE_SCALE) })),
    caps: { orders_used: used, orders_max: ORDERS_PER_MONTH, investable_cents: inv, order_share_pct: ORDER_SHARE_PCT, max_order_cents: Math.floor((inv * ORDER_SHARE_PCT) / 100), breaker_pct: BREAKER_PCT, limit_expiry_months: LIMIT_EXPIRY_MONTHS },
    dividends: stmt(k, 'SELECT month, ticker, account, cents, drip FROM exchange_dividends WHERE player_id = ? AND world_id = ? ORDER BY id DESC LIMIT 10').all(user.id, w.id),
    activity: activityView(k, w, b, user.id), activity_max: ACTIVITY_MAX,
    news: stmt(k, 'SELECT month, kind, ticker, text FROM exchange_news WHERE world_id = ? ORDER BY id DESC LIMIT 12').all(w.id),
  };
}

// the units a student typed (micro-units) or the dollars they want to spend, from a request body
export function orderInput(k, body) {
  const input = {
    ticker: k.input.str(body, 'ticker', { max: 8 }), account: accountOf(k, body), side: k.input.str(body, 'side', { max: 5 }), type: k.input.str(body, 'type', { max: 6 }),
    units_micro: k.input.int(body, 'units_micro', { optional: true, min: 1, max: MAX_UNITS }), cents: k.input.int(body, 'cents', { optional: true, min: 1, max: MAX_CENTS }),
    limit_cents: k.input.int(body, 'limit_cents', { optional: true, min: 1, max: MAX_CENTS }),
  };
  if (input.side !== 'buy' && input.side !== 'sell') throw new k.HttpError(400, 'side must be buy or sell');
  if (input.type !== 'market' && input.type !== 'limit') throw new k.HttpError(400, 'type must be market or limit');
  if (input.type === 'limit' && input.limit_cents === undefined) throw new k.HttpError(400, 'Enter a limit price');
  if (input.side === 'sell' && input.units_micro === undefined) throw new k.HttpError(400, 'Enter how many to sell');
  return input;
}
