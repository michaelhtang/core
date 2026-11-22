// exchange tick and bots: the monthly step (prices, news, limit fills, dividends, RRSP year-end, value events), fillLimit, settleRrsp, and the simulation bots
import { money, dice } from '../../lib/kernel.js';
import { PRICE_SCALE, UNIT, DIVIDEND_MONTHS } from './constants.js';
import { monthStep, microToCents } from './prices.js';
import { costCents, proceedsCents, unitsForCents, dividendCents, dividendPerUnit, crosses, yearOf, indexedTfsa, indexedRrsp } from './orders.js';
import { headlines } from './news.js';
import { stmt, openAcct, balOf, settings, holdingOf, valueOfHolding, secretOf } from './reads.js';
import { secs, book, ensurePrices } from './catalogue.js';
import { holdingsValue, emitValue, settleBuy, settleSell, placeOrder, closeOrder } from './trading.js';
import { indexing, tfsaRoomOf, incomeByYear, rrspRoomOf, rrspYear, slip, oasThreshold, contribute } from './registered.js';

// ---- the tick ----
export function tick(k, { month }) {
  const w = k.world.current();
  const list = secs(k);
  if (indexing(k) && month > 1 && (month - 1) % 12 === 0) {                     // a new world year: freeze its indexed limits (rates has already stepped the index this tick)
    const idx = k.world.priceIndex(w.id);
    stmt(k, 'INSERT OR IGNORE INTO exchange_limits (world_id, year, tfsa_cents, rrsp_cents, index_bp) VALUES (?, ?, ?, ?, ?)').run(w.id, yearOf(month), indexedTfsa(idx), indexedRrsp(idx), idx);
  }
  ensurePrices(k, w, month - 1);
  // prices: step every month since the latest stored one (normally just this month); this month's events and rate shock apply to the last step
  const latest = new Map(stmt(k, 'SELECT ticker, MAX(month) AS m FROM exchange_prices WHERE world_id = ? GROUP BY ticker').all(w.id).map((r) => [r.ticker, r.m]));
  const priceAt = stmt(k, 'SELECT price_micro FROM exchange_prices WHERE world_id = ? AND ticker = ? AND month = ?');
  const first = Math.min(...list.map((s) => latest.get(s.ticker) ?? month - 1)) + 1;
  const rateRow = stmt(k, 'SELECT policy_bp, applied_bp FROM exchange_rates WHERE world_id = ?').get(w.id);
  const deltaBp = rateRow && rateRow.applied_bp !== null ? rateRow.policy_bp - rateRow.applied_bp : 0;
  if (rateRow) stmt(k, 'UPDATE exchange_rates SET applied_bp = policy_bp WHERE world_id = ?').run(w.id);
  const events = stmt(k, 'SELECT id, kind, ticker, headline FROM exchange_events WHERE world_id = ? AND applied_month IS NULL AND created_month < ? ORDER BY id').all(w.id, month);
  if (events.length) stmt(k, 'UPDATE exchange_events SET applied_month = ? WHERE world_id = ? AND applied_month IS NULL AND created_month < ?').run(month, w.id, month);
  const before = {};
  const put = stmt(k, 'INSERT OR REPLACE INTO exchange_prices (world_id, ticker, month, price_micro, halted) VALUES (?, ?, ?, ?, ?)');
  for (let m = Math.min(first, month); m <= month; m++) {
    const prev = {};
    for (const s of list) { const p = priceAt.get(w.id, s.ticker, m - 1)?.price_micro; if (p !== undefined) prev[s.ticker] = p; }
    if (m === month) Object.assign(before, prev);
    const r = monthStep({ worldId: w.id, secret: secretOf(k, w.id), month: m, prev, securities: list, policyDeltaBp: m === month ? deltaBp : 0, events: m === month ? events : [] });
    for (const [ticker, price] of Object.entries(r.price)) put.run(w.id, ticker, m, price, r.halted[ticker] ? 1 : 0);
  }
  const b = book(k, w);
  const change = (ticker) => (before[ticker] ? b.get(ticker).price / before[ticker] - 1 : 0);

  // news
  const nameOf = (t) => b.get(t)?.sec.name ?? t;
  const payers = list.filter((s) => s.kind === 'stock' && s.yieldBp > 0).sort((x, y) => y.yieldBp - x.yieldBp || x.ticker.localeCompare(y.ticker));
  const payMonth = DIVIDEND_MONTHS.includes(((month - 1) % 12) + 1);
  const news = headlines({
    month, events: events.map((e) => ({ kind: e.kind, ticker: e.ticker, name: e.ticker ? nameOf(e.ticker) : null, headline: e.headline })),
    rate: deltaBp ? { deltaBp, bondPct: change('DAAB') } : null,
    dividend: payMonth && payers[0] ? { ticker: payers[0].ticker, name: payers[0].name, perUnitCents: Math.round(dividendPerUnit(b.get(payers[0].ticker).price, payers[0].yieldBp) / PRICE_SCALE) } : null,
    index: { price: microToCents(b.get('DAAX').price), change: change('DAAX') },
    movers: list.filter((s) => s.kind === 'stock').map((s) => ({ ticker: s.ticker, name: s.name, change: change(s.ticker) })),
  });
  const ins = stmt(k, 'INSERT INTO exchange_news (world_id, month, kind, ticker, text) VALUES (?, ?, ?, ?, ?)');
  for (const n of news) ins.run(w.id, month, n.kind, n.ticker, n.text);

  // limit orders: fill the ones the new prices cross (unless trading is paused or that security is), then expire the old ones
  const frozen = !!settings(k, w.id).frozen;
  k.forEachPlayer(stmt(k, "SELECT * FROM exchange_orders WHERE world_id = ? AND status = 'open' ORDER BY id").all(w.id), (o) => {   // each order in its holder's own savepoint
    const m = b.get(o.ticker);
    if (m && !frozen && !m.halted && !m.paused && crosses(o.side, o.limit_micro, m.bid, m.ask)) { if (fillLimit(k, w, month, o, m)) return; }
    if (month >= o.expires_month) closeOrder(k, o, 'expired');
  }, (o) => o.player_id);

  // dividends: months 3, 6, 9 and 12 of each world year; cash, or DRIP into more of the same stock at the ask
  if (payMonth && payers.length) {
    const tickers = payers.map((s) => s.ticker);
    const rows = stmt(k, `SELECT player_id, account, ticker, units_micro, drip FROM exchange_holdings WHERE world_id = ? AND ended = 0 AND units_micro > 0
      AND ticker IN (SELECT value FROM json_each(?)) ORDER BY player_id, account, ticker`).all(w.id, JSON.stringify(tickers));
    const insDiv = stmt(k, 'INSERT INTO exchange_dividends (player_id, world_id, month, ticker, account, units_micro, cents, drip) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
    for (const h of rows) {                                                      // all or nothing: a quarterly dividend is never retried, so a throw rolls back the advance
      const m = b.get(h.ticker), cents = dividendCents(h.units_micro, m.price, m.sec.yieldBp);
      if (cents <= 0) continue;
      const acct = openAcct(k, h.player_id, h.account);
      k.ledger.post({ kind: 'dividend', actor: 'system', meta: { ticker: h.ticker, month, units: h.units_micro },
        legs: [{ account: k.ledger.system('mint'), cents: -cents, memo: `${h.ticker} dividend` }, { account: acct, cents, memo: `${m.sec.name} dividend${h.drip ? ' (reinvested)' : ''}` }] });
      insDiv.run(h.player_id, w.id, month, h.ticker, h.account, h.units_micro, cents, h.drip);
      if (h.drip) {                                                    // DRIP: buy back in at the ask; a reinvestment may be a fraction of a share, and it ignores a pause
        const units = unitsForCents(cents, m.ask, 100), cost = units > 0 ? costCents(units, m.ask) : 0;
        if (units > 0 && cost > 0 && cost <= cents) {
          settleBuy(k, w, { pid: h.player_id, account: h.account, sec: m.sec, units, cost, price: m.ask, via: 'drip', orderId: null, month, kind: 'drip_buy',
            legs: [{ account: acct, cents: -cost, memo: `DRIP: ${h.ticker}` }, { account: k.ledger.system('sink'), cents: cost, memo: `DRIP: ${h.ticker}` }] });
        }
      }
    }
  }

  // RRSP: the first tick of a new world year settles the year just ended
  if (month > 1 && (month - 1) % 12 === 0) settleRrsp(k, w, month);

  // value: everyone holding anything, and anyone who held something at the last tick and no longer does
  const values = holdingsValue(k, w.id, b);
  const last = new Map(stmt(k, 'SELECT player_id, cents FROM exchange_valued WHERE world_id = ? AND cents <> 0').all(w.id).map((r) => [r.player_id, r.cents]));
  k.forEachPlayer([...values], ([pid, cents]) => emitValue(k, w.id, pid, cents), ([pid]) => pid);
  k.forEachPlayer([...last.keys()].filter((pid) => !values.has(pid)), (pid) => emitValue(k, w.id, pid, 0));
}

// Year-end RRSP settlement for world year yearOf(month) - 1: everyone with RRSP activity in that year, and everyone still carrying a balance owing from the year before.
// A refund is minted into chequing; a balance owing is paid out of chequing, as far as chequing goes, and the rest is carried (no interest) into the next settlement.
function settleRrsp(k, w, month) {
  const year = yearOf(month) - 1;
  const who = new Map();
  for (const r of stmt(k, 'SELECT player_id FROM exchange_rrsp WHERE world_id = ? AND year = ? AND (contributed_cents > 0 OR withdrawn_cents > 0 OR pension_cents > 0)').all(w.id, year)) who.set(r.player_id, 0);
  const thr = oasThreshold(k, w.id);
  for (const r of stmt(k, 'SELECT player_id, unpaid_cents FROM exchange_settlements WHERE world_id = ? AND year = ? AND unpaid_cents > 0').all(w.id, year - 1)) who.set(r.player_id, r.unpaid_cents);
  let refunds = 0;
  for (const [pid, carry] of [...who].sort((a, b) => a[0] - b[0])) {            // all or nothing: the year-end settlement is never retried, so a throw rolls back the advance
    const y = rrspYear(k, pid, w.id, year), G = incomeByYear(k, pid, w.id)[year] ?? 0, sl = slip(G, y.c, y.w, y.h, y.p, y.o, thr);
    const net = sl.settle - carry, refund = Math.max(0, net), owing = Math.max(0, -net);
    const chq = openAcct(k, pid, 'chequing'), paid = Math.min(owing, k.ledger.balance(chq));
    if (refund) k.ledger.post({ kind: 'rrsp_refund', actor: 'system', meta: { year, month }, legs: [{ account: k.ledger.system('mint'), cents: -refund, memo: `RRSP tax refund (world year ${year})` }, { account: chq, cents: refund, memo: `RRSP tax refund (world year ${year})` }] });
    if (paid) k.ledger.post({ kind: 'rrsp_tax', actor: 'system', meta: { year, month }, legs: [{ account: chq, cents: -paid, memo: `RRSP tax owing (world year ${year})` }, { account: k.ledger.system('sink'), cents: paid, memo: `RRSP tax owing (world year ${year})` }] });
    stmt(k, `INSERT INTO exchange_settlements (player_id, world_id, year, month, g_cents, c_cents, w_cents, h_cents, tax_before_cents, tax_after_cents, carry_cents, refund_cents, owing_cents, paid_cents, unpaid_cents, p_cents, clawback_cents)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(pid, w.id, year, month, G, y.c, y.w, y.h, sl.tax_before, sl.tax_after, carry, refund, owing, paid, owing - paid, y.p, sl.clawback);
    k.db.txn((tx) => tx.onCommit(() => k.events.emit('rrsp_settled', { playerId: pid, worldId: w.id, year, refund, owing })));   // after the tick commits
    if (refund) refunds++;
  }
  if (refunds) stmt(k, 'INSERT INTO exchange_news (world_id, month, kind, ticker, text) VALUES (?, ?, ?, ?, ?)').run(w.id, month, 'rrsp', null, `${refunds} ${refunds === 1 ? 'student' : 'students'} got ${refunds === 1 ? 'an RRSP tax refund' : 'RRSP tax refunds'} for world year ${year}`);
}

// Fill a resting limit at the market maker's price (the limit or better). Returns true when it filled.
function fillLimit(k, w, month, o, m) {
  const sec = m.sec;
  if (o.side === 'buy') {
    const cost = costCents(o.units_micro, m.ask);
    const legs = [{ account: openAcct(k, o.player_id, 'xhold'), cents: -o.hold_cents, memo: `${sec.ticker} buy limit filled` }, { account: k.ledger.system('sink'), cents: cost, memo: `Bought ${sec.ticker}` }];
    if (o.hold_cents > cost) legs.push({ account: openAcct(k, o.player_id, o.account), cents: o.hold_cents - cost, memo: `Better price than your limit: ${money(o.hold_cents - cost)} back` });
    settleBuy(k, w, { pid: o.player_id, account: o.account, sec, units: o.units_micro, cost, price: m.ask, via: 'limit', orderId: o.id, month, kind: 'fill', legs, meta: { orderId: o.id } });
  } else {
    const h = holdingOf(k, o.player_id, w.id, o.account, sec.ticker);
    if (!h || h.units_micro < o.units_micro) { closeOrder(k, o, 'cancelled'); return true; }
    settleSell(k, w, { pid: o.player_id, account: o.account, sec, units: o.units_micro, proceeds: proceedsCents(o.units_micro, m.bid), price: m.bid, via: 'limit', orderId: o.id, month });
  }
  stmt(k, "UPDATE exchange_orders SET status = 'filled', filled_month = ?, hold_cents = 0 WHERE id = ?").run(month, o.id);
  return true;
}

// ---- bots (scripts/sim.mjs): 60% dollar-cost average, 15% buy one stock and hold, 10% chase, the rest do not invest; the first 75% also use the RRSP ----
export function bots(k, { month, students }) {
  const w = k.world.current();
  if (!w || w.status !== 'active') return;
  const stocks = secs(k).filter((s) => s.kind === 'stock');
  const topMover = () => {
    const rows = stmt(k, 'SELECT ticker, month, price_micro FROM exchange_prices WHERE world_id = ? AND month IN (?, ?)').all(w.id, month, month - 1);
    const at = (t, m) => rows.find((r) => r.ticker === t && r.month === m)?.price_micro;
    return stocks.map((s) => ({ s, ch: at(s.ticker, month) && at(s.ticker, month - 1) ? at(s.ticker, month) / at(s.ticker, month - 1) : 1 })).sort((a, b2) => b2.ch - a.ch || a.s.ticker.localeCompare(b2.s.ticker))[0]?.s;
  };
  for (const s of students) {
    const u = { id: s.id, class_id: s.class_id }, d = dice(s.id, 0, 11);
    if (d < 75) {                                                     // RRSP (the investing bots): 5% of last year's average gross a month into DAAX while there is room; the refund goes into the TFSA
      try {
        ensureWorld(k, w);
        const year = yearOf(w.month), prev = incomeByYear(k, s.id, w.id)[year - 1] ?? 0;
        const refund = (w.month - 1) % 12 === 0 ? (stmt(k, 'SELECT refund_cents FROM exchange_settlements WHERE player_id = ? AND world_id = ? AND year = ?').get(s.id, w.id, year - 1)?.refund_cents ?? 0) : 0;
        const toTfsa = Math.min(refund, balOf(k, s.id, 'chequing'), tfsaRoomOf(k, s.id, w.id, year));
        if (toTfsa >= 1000) { contribute(k, { id: s.id, class_id: s.class_id }, 'tfsa', toTfsa); placeOrder(k, { id: s.id, class_id: s.class_id }, { ticker: 'DAAX', account: 'tfsa', side: 'buy', type: 'market', cents: balOf(k, s.id, 'tfsa') }); }
        const cents = Math.min(Math.floor((prev * 5) / 1200), rrspRoomOf(k, s.id, w.id, year), balOf(k, s.id, 'chequing'));
        if (cents >= 1000) { contribute(k, { id: s.id, class_id: s.class_id }, 'rrsp', cents); placeOrder(k, { id: s.id, class_id: s.class_id }, { ticker: 'DAAX', account: 'rrsp', side: 'buy', type: 'market', cents: balOf(k, s.id, 'rrsp') }); }
      } catch (e) { if (!(e instanceof k.HttpError)) throw e; }
    }
    const chq = balOf(k, s.id, 'chequing');
    try {
      ensureWorld(k, w);
      if (d < 60) {                                                   // dollar-cost average: 20% of what is left, into DAAX, inside the TFSA
        const room = tfsaRoomOf(k, s.id, w.id, yearOf(w.month)), cents = Math.min(Math.floor(chq / 5), room);
        if (cents >= 1000) { contribute(k, u, 'tfsa', cents); placeOrder(k, u, { ticker: 'DAAX', account: 'tfsa', side: 'buy', type: 'market', cents: balOf(k, s.id, 'tfsa') }); }
      } else if (d < 75) {                                            // one stock, then hold it
        if (stmt(k, 'SELECT 1 FROM exchange_holdings WHERE player_id = ? AND world_id = ? AND units_micro > 0').get(s.id, w.id) || chq < 100000) continue;
        const pick = stocks[dice(s.id, 0, 13) % stocks.length], m = book(k, w).get(pick.ticker), shares = Math.floor(Math.floor(chq * 0.3) / costCents(UNIT, m.ask));
        if (shares >= 1) {
          const account = tfsaRoomOf(k, s.id, w.id, yearOf(w.month)) >= costCents(shares * UNIT, m.ask) ? 'tfsa' : 'invest';
          contribute(k, u, account, costCents(shares * UNIT, m.ask));
          placeOrder(k, u, { ticker: pick.ticker, account, side: 'buy', type: 'market', units_micro: shares * UNIT });
        }
      } else if (d < 85) {                                            // chase: buy last month's top mover, sell after a 10% drop
        const held = stmt(k, "SELECT ticker, units_micro, cost_cents FROM exchange_holdings WHERE player_id = ? AND world_id = ? AND account = 'invest' AND units_micro > 0").get(s.id, w.id);
        const b = book(k, w);
        if (held) {
          if (valueOfHolding(b, held.ticker, held.units_micro) * 10 <= held.cost_cents * 9) placeOrder(k, u, { ticker: held.ticker, account: 'invest', side: 'sell', type: 'market', units_micro: held.units_micro });
        } else if (chq >= 100000 && month > 1) {
          const pick = topMover(), m = pick && b.get(pick.ticker), shares = m ? Math.floor(Math.floor(chq * 0.3) / costCents(UNIT, m.ask)) : 0;
          if (shares >= 1) { contribute(k, u, 'invest', costCents(shares * UNIT, m.ask)); placeOrder(k, u, { ticker: pick.ticker, account: 'invest', side: 'buy', type: 'market', units_micro: shares * UNIT }); }
        }
      }
    } catch (e) { if (!(e instanceof k.HttpError)) throw e; }          // a cap, a pause or no room this month: skip it
  }
}
const ensureWorld = (k, w) => k.db.txn(() => ensurePrices(k, w));
