// exchange trading: holdings value and the value event, planning an order, executing (market and limit), settling buys and sells, cancelling
import { money, ok } from '../../lib/kernel.js';
import { PRICE_SCALE, UNIT, ORDERS_PER_MONTH, ORDER_SHARE_PCT, LIMIT_EXPIRY_MONTHS, BREAKER_PCT, stepOf } from './constants.js';
import { microToCents } from './prices.js';
import { costCents, proceedsCents, unitsForCents, basisShare, sizeProblem, restsOffMarket } from './orders.js';
import { stmt, LABEL, openAcct, balOf, investable, settings, holdingOf, reservedOf, valueOfHolding, addHolding, takeHolding, addTrade } from './reads.js';
import { book, ensurePrices } from './catalogue.js';

// ---- holdings, value ----
export function holdingsValue(k, wid, b, playerId) {
  const rows = playerId === undefined
    ? stmt(k, 'SELECT player_id, ticker, units_micro FROM exchange_holdings WHERE world_id = ? AND ended = 0 AND units_micro > 0').all(wid)
    : stmt(k, 'SELECT player_id, ticker, units_micro FROM exchange_holdings WHERE world_id = ? AND player_id = ? AND ended = 0 AND units_micro > 0').all(wid, playerId);
  const out = new Map();
  for (const r of rows) out.set(r.player_id, (out.get(r.player_id) ?? 0) + valueOfHolding(b, r.ticker, r.units_micro));
  return out;
}
// Tell savings and leaderboards what this student's holdings are worth now.
export function emitValue(k, wid, playerId, cents) {
  stmt(k, 'INSERT INTO exchange_valued (player_id, world_id, cents) VALUES (?, ?, ?) ON CONFLICT (player_id, world_id) DO UPDATE SET cents = excluded.cents').run(playerId, wid, cents);
  k.events.emit('value', { playerId, worldId: wid, holdings: cents });
}
export const afterTrade = (k, tx, w, playerId, classId) => tx.onCommit(() => {
  emitValue(k, w.id, playerId, holdingsValue(k, w.id, book(k, w), playerId).get(playerId) ?? 0);
  k.events.emit('changed', { classId: classId ?? null });
});

// ---- planning an order (shared by preview and execution) ----
// input: { ticker, account, side 'buy'|'sell', type 'market'|'limit', units_micro?, cents? (a dollar amount to spend: buys only), limit_cents? }.
// Returns { problem, ... }: problem is a plain sentence or null. Every cap and pause is checked here, so a preview shows exactly what an order would be told.
export function planOrder(k, pid, w, b, input) {
  const m = b.get(input.ticker);
  const plan = { problem: null, ticker: input.ticker, account: input.account, side: input.side, type: input.type, units: 0, price: 0, cents: 0, spreadCents: 0, holdCents: 0 };
  const fail = (text) => { plan.problem ??= text; return plan; };
  if (!m) return fail('Unknown ticker');
  const { sec } = m, step = stepOf(sec), buy = input.side === 'buy';
  let limit = input.type === 'limit';
  plan.sec = sec;
  if (w.status !== 'active') return fail('The season is closed');
  if (settings(k, w.id).frozen) return fail('Your teacher has paused trading');
  if (m.paused) return fail(m.paused);                              // market and limit orders alike: nobody enters or exits on the known move
  if (!limit && m.halted) return fail(`${sec.ticker} is paused for the rest of this world month: it moved more than ${BREAKER_PCT}% in one step`);
  const used = stmt(k, 'SELECT COUNT(*) AS n FROM exchange_orders WHERE player_id = ? AND world_id = ? AND placed_month = ?').get(pid, w.id, w.month).n;
  if (used >= ORDERS_PER_MONTH) return fail(`You have placed ${ORDERS_PER_MONTH} orders this world month, the limit. Try again next month.`);
  let limitMicro = null;
  if (limit) {
    if (!ok(input.limit_cents) || input.limit_cents <= 0) return fail('Enter a limit price');
    limitMicro = input.limit_cents * PRICE_SCALE;
    // A limit that already crosses today's price fills now, at the market price (as good as the limit or better), as on a real exchange.
    if (!restsOffMarket(input.side, limitMicro, m.bid, m.ask)) {
      limit = false; plan.type = 'market'; limitMicro = null;
      plan.note = buy ? `Your limit is at or above today's ask, so it fills now at ${money(microToCents(m.ask))}.` : `Your limit is at or below today's bid, so it fills now at ${money(microToCents(m.bid))}.`;
      if (m.halted) return fail(`${sec.ticker} is paused for the rest of this world month: it moved more than ${BREAKER_PCT}% in one step`);
    }
  }
  const ref = limit ? limitMicro : buy ? m.ask : m.bid;             // the price the size is worked out at
  let units = input.units_micro;
  const have = buy ? 0 : (holdingOf(k, pid, w.id, input.account, sec.ticker)?.units_micro ?? 0) - reservedOf(k, pid, w.id, input.account, sec.ticker);
  if (units === undefined || units === null) {
    if (!buy || !ok(input.cents) || input.cents <= 0) return fail('Enter how many to trade');
    units = unitsForCents(input.cents, ref, step);
    if (units <= 0) return fail(`${money(input.cents)} is not enough for one ${sec.kind === 'stock' ? 'share' : '0.0001 of a unit'} at ${money(microToCents(ref))}`);
  }
  plan.units = units;
  const size = !buy && units === have && units > 0 ? null : sizeProblem(sec.kind, units, step);
  if (size) return fail(size);
  plan.price = ref;
  plan.cents = buy ? costCents(units, ref) : proceedsCents(units, ref);
  const mid = proceedsCents(units, m.price);
  plan.spreadCents = limit ? 0 : buy ? plan.cents - mid : mid - plan.cents;
  if (!ok(plan.cents) || plan.cents <= 0) return fail('That is too small to trade');
  if (buy) {
    plan.holdCents = limit ? plan.cents : 0;
    const cash = balOf(k, pid, input.account);
    if (cash < plan.cents) return fail(`Not enough cash in your ${LABEL[input.account]}: this order is ${money(plan.cents)} and it holds ${money(cash)}. Contribute from chequing first.`);
    const cap = Math.floor((investable(k, pid) * ORDER_SHARE_PCT) / 100);
    if (plan.cents > cap) return fail(`One order can use at most ${ORDER_SHARE_PCT}% of your investable cash (${money(cap)}). This one is ${money(plan.cents)}.`);
  } else if (units > have) return fail(have > 0 ? `You can sell at most ${have / UNIT} of ${sec.ticker} in this account (some may be reserved by a sell limit)` : `You do not hold ${sec.ticker} in this account`);
  return plan;
}

// ---- executing ----
export function settleBuy(k, w, { pid, account, sec, units, cost, price, via, orderId, month, kind, legs, meta }) {
  const txn = k.ledger.post({ kind, actor: via === 'drip' ? 'system' : `player:${pid}`, meta: { ticker: sec.ticker, units, price, month, ...meta }, legs });
  addHolding(k, w.id, pid, account, sec.ticker, units, cost);
  return addTrade(k, { orderId, pid, wid: w.id, account, ticker: sec.ticker, side: 'buy', units, price, cents: cost, month, txn, via });
}
export function settleSell(k, w, { pid, account, sec, units, proceeds, price, via, orderId, month, kind = 'sell', actor = `player:${pid}` }) {
  const h = holdingOf(k, pid, w.id, account, sec.ticker);
  const basis = basisShare(h.cost_cents, h.units_micro, units);
  const txn = k.ledger.post({ kind, actor, meta: { ticker: sec.ticker, units, price, month, basis },
    legs: [{ account: k.ledger.system('mint'), cents: -proceeds, memo: `Sold ${sec.ticker}` }, { account: openAcct(k, pid, account), cents: proceeds, memo: `Sold ${sec.ticker}` }] });
  takeHolding(k, w.id, pid, account, sec.ticker, units, basis);
  return addTrade(k, { orderId, pid, wid: w.id, account, ticker: sec.ticker, side: 'sell', units, price, cents: proceeds, basis, month, txn, via });
}

export function placeOrder(k, user, input) {
  const w = k.world.current();
  return k.db.txn((tx) => {
    if (!w) throw new k.HttpError(409, 'There is no active world');
    ensurePrices(k, w);
    const b = book(k, w);
    const plan = planOrder(k, user.id, w, b, input);
    if (plan.problem) throw new k.HttpError(400, plan.problem);
    const { sec, units, cents } = plan, type = plan.type, limit = type === 'limit', buy = input.side === 'buy';
    const acct = openAcct(k, user.id, input.account);
    const now = k.clock.now();
    const order = (status, extra = {}) => Number(stmt(k, `INSERT INTO exchange_orders (player_id, world_id, account, ticker, side, type, units_micro, limit_micro, hold_cents, status, placed_month, expires_month, filled_month, created)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(user.id, w.id, input.account, sec.ticker, input.side, type, units, limit ? plan.price : null, extra.hold ?? 0, status, w.month, limit ? w.month + LIMIT_EXPIRY_MONTHS : null, status === 'filled' ? w.month : null, now).lastInsertRowid);
    let result;
    if (limit) {
      let hold = 0;
      if (buy) {
        hold = plan.holdCents;
        k.ledger.post({ kind: 'hold', actor: `player:${user.id}`, meta: { ticker: sec.ticker, units, limit: plan.price },
          legs: [{ account: acct, cents: -hold, memo: `Held for a ${sec.ticker} buy limit` }, { account: openAcct(k, user.id, 'xhold'), cents: hold, memo: `Held for a ${sec.ticker} buy limit` }] });
      }
      const id = order('open', { hold });
      result = { order_id: id, status: 'open', expires_month: w.month + LIMIT_EXPIRY_MONTHS, hold_cents: hold };
    } else if (buy) {
      const id = order('filled');
      const trade = settleBuy(k, w, { pid: user.id, account: input.account, sec, units, cost: cents, price: plan.price, via: 'market', orderId: id, month: w.month, kind: 'buy',
        legs: [{ account: acct, cents: -cents, memo: `Bought ${sec.ticker}` }, { account: k.ledger.system('sink'), cents, memo: `Bought ${sec.ticker}` }] });
      result = { order_id: id, trade_id: trade, status: 'filled', units_micro: units, price_micro: plan.price, cents };
    } else {
      const id = order('filled');
      const trade = settleSell(k, w, { pid: user.id, account: input.account, sec, units, proceeds: cents, price: plan.price, via: 'market', orderId: id, month: w.month });
      result = { order_id: id, trade_id: trade, status: 'filled', units_micro: units, price_micro: plan.price, cents };
    }
    k.audit('order', { playerId: user.id, ticker: sec.ticker, side: input.side, type, units, cents }, `player:${user.id}`);
    afterTrade(k, tx, w, user.id, user.class_id);
    return plan.note ? { ...result, note: plan.note } : result;
  });
}

// Give back what an open order holds, and close it with `status`.
export function closeOrder(k, o, status) {
  if (o.side === 'buy' && o.hold_cents > 0) {
    k.ledger.post({ kind: 'release', actor: 'system', meta: { orderId: o.id, status },
      legs: [{ account: openAcct(k, o.player_id, 'xhold'), cents: -o.hold_cents, memo: `Released: ${o.ticker} buy limit ${status}` }, { account: openAcct(k, o.player_id, o.account), cents: o.hold_cents, memo: `Released: ${o.ticker} buy limit ${status}` }] });
  }
  stmt(k, 'UPDATE exchange_orders SET status = ?, hold_cents = 0 WHERE id = ?').run(status, o.id);
}

export function cancelOrder(k, user, id) {
  const o = stmt(k, 'SELECT * FROM exchange_orders WHERE id = ? AND player_id = ?').get(id, user.id);
  if (!o) throw new k.HttpError(404, 'Order not found');
  if (o.status !== 'open') throw new k.HttpError(409, `That order is already ${o.status}`);
  return k.db.txn((tx) => {
    closeOrder(k, o, 'cancelled');
    tx.onCommit(() => k.events.emit('changed', { classId: user.class_id ?? null }));
    return { ok: true, released_cents: o.hold_cents };
  });
}
