// exchange: the DAA Exchange (docs/phase3.md wave 3a). Three index funds and eight town stocks, a seeded deterministic price series, a market maker that is always
// the other side of a trade, market and limit orders, a non-registered account and a TFSA, quarterly dividends (cash or DRIP), a news ticker, teacher market events.
//
// MONEY. Ledger account kinds: 'invest' (non-registered cash), 'tfsa' (TFSA cash), 'xhold' (cash held for open buy limits; one per student, per-order amounts live in
// exchange_orders). contribute/withdraw move money chequing <-> account. A buy moves account -> sink (the market maker is outside town), a sale mint -> account, a dividend
// mint -> account. Holdings are module rows, not ledger money: units are integer micro-units (1e6 = one unit), prices integer micro-cents (see orders.js for the rounding).
// Net worth: after every trade and every tick the module emits module.exchange.value { playerId, worldId, holdings } (holdings at the BID, in cents, cash excluded because
// the ledger already has it). savings and leaderboards add it, as they add housing's home value. seasonAssets returns the same number at season close; world.closed ends
// the season's holdings and open orders (the core resets every account to zero, so nothing may survive into the next world).
//
// THE RRSP (wave 3b). A third account, kind 'rrsp', that trades, holds and takes dividends exactly like the TFSA. Room comes from LAST world year's pay: exchange_income is
// filled from module.jobs.paid (the only way this module learns income), room = 18% of last year's gross up to the dollar limit, carried forward (orders.js rrspRoom). A
// withdrawal is taxed at source (withholding to the sink, by the size of that one withdrawal) and never gives room back. When a tick enters a new world year, each student
// with RRSP activity in the year just ended gets a settlement (settleRrsp): tax(G) - tax(G - C + W) + H, a refund minted into chequing or a balance paid out of it, using the
// one cross-module import allowed, the pure annualIncomeTax from jobs/payroll.js. What chequing cannot cover is carried into the next settlement.
//
// PRICES (prices.js): one step per world month for each security, drawn from a seed of worldId + ticker + month. The step runs in onTick; modules before this one in config
// order (rates) have already reported the policy rate (module.rates.changed), so the bond fund's duration shock lands in the same tick. A market event queued by the world
// teacher applies at the next tick on top of the normal step.
// Tick order: prices (+ events, rate shock) -> circuit breaker flags -> news -> limit fills and expiry -> dividends (months 3, 6, 9, 12) -> value events.
//
// Events out: module.exchange.value { playerId, worldId, holdings }, module.exchange.changed { classId } (teacher console refetches),
//   module.exchange.rrsp_settled { playerId, worldId, year, refund, owing } (after commit).
// Events in: module.rates.changed (the policy rate), module.rates.pending (a queued policy change: the bond-linked funds pause until it applies),
//   module.jobs.paid (gross, for RRSP room), world.closed.
//
// FILE MAP (this folder): index.js (this file) the module definition: services, events, badges, panels, routes; migrations.js the schema; reads.js statements, balances,
// holdings and trade rows; catalogue.js securities, listings, queued events, the price book; trading.js planning, placing, settling, cancelling orders; registered.js limits,
// TFSA/RRSP room and slip, contribute/withdraw; services.js the services other modules call; tick.js the monthly tick and the sim bots; view.js the /state payload and order
// input. Pure maths: constants.js, prices.js, orders.js, news.js. UI: ui/.
import { defineModule } from '../../lib/modules.js';
import { money, ok } from '../../lib/kernel.js';
import { EVENTS, ORDERS_PER_MONTH } from './constants.js';
import { microToCents } from './prices.js';
import { yearOf } from './orders.js';
import { migrations } from './migrations.js';
import { stmt, trim, needWorld, openAcct, balOf, settings, holdingOf, reservedOf, valueOfHolding, addHolding, takeHolding } from './reads.js';
import { book, secs, queueEvent, listSecurity, delistSecurity } from './catalogue.js';
import { planOrder, placeOrder, cancelOrder, holdingsValue, afterTrade } from './trading.js';
import { limitsIn, accountOf, contribute, withdraw } from './registered.js';
import { stageEvent, allocation, retirementPots, drawForRetirement, recordRetirementIncome } from './services.js';
import { tick, bots } from './tick.js';
import { state, orderInput, MAX_CENTS } from './view.js';

const ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 20h18"/><path d="M6 16l4-5 3 3 5-7"/><path d="M15 7h3v3"/></svg>';

export default defineModule({
  id: 'exchange',
  options: { extraStocks: 'extra securities added to the catalogue' },
  requires: ['bank-basic'],

  migrations,
  services: {
    listSecurity, delistSecurity, stageEvent, allocation, retirementPots, drawForRetirement, recordRetirementIncome,
    // The Today card's facts (modules/today): read-only. holdings = the last announced value at the bid (as savings and leaderboards keep it).
    todayFacts: (k, { playerId }) => {
      const wid = k.world.current().id;
      return {
        holdings: stmt(k, 'SELECT cents FROM exchange_valued WHERE player_id = ? AND world_id = ?').get(playerId, wid)?.cents ?? 0,
        tfsaContributedCents: stmt(k, 'SELECT COALESCE(SUM(contributed_cents), 0) AS n FROM exchange_tfsa WHERE player_id = ? AND world_id = ?').get(playerId, wid).n,
      };
    },
  },

  events: {
    'module.rates.changed': (k, { worldId, policyBp }) => {
      if (!ok(worldId) || !ok(policyBp)) return;
      stmt(k, 'INSERT INTO exchange_rates (world_id, policy_bp, applied_bp) VALUES (?, ?, ?) ON CONFLICT (world_id) DO UPDATE SET policy_bp = excluded.policy_bp').run(worldId, policyBp, policyBp);
    },
    // A queued policy change (pendingBp) or its end (null: applied or cancelled). The bond-linked funds pause while it waits (book()).
    'module.rates.pending': (k, { worldId, pendingBp, effectiveMonth }) => {
      if (!ok(worldId)) return;
      if (pendingBp === null) stmt(k, 'DELETE FROM exchange_rate_pending WHERE world_id = ?').run(worldId);
      else if (ok(pendingBp) && ok(effectiveMonth)) stmt(k, 'INSERT INTO exchange_rate_pending (world_id, pending_bp, effective_month) VALUES (?, ?, ?) ON CONFLICT (world_id) DO UPDATE SET pending_bp = excluded.pending_bp, effective_month = excluded.effective_month').run(worldId, pendingBp, effectiveMonth);
    },
    // Earned income by world year (jobs emits this inside the payday transaction, so the row commits with the pay). RRSP room is 18% of last year's total.
    'module.jobs.paid': (k, { playerId, worldId, month, gross }) => {
      if (!ok(playerId) || !ok(worldId) || !ok(month) || !ok(gross) || gross <= 0) return;
      stmt(k, `INSERT INTO exchange_income (player_id, world_id, year, gross_cents) VALUES (?, ?, ?, ?)
        ON CONFLICT (player_id, world_id, year) DO UPDATE SET gross_cents = gross_cents + excluded.gross_cents`).run(playerId, worldId, yearOf(month), gross);
    },
    // Season close: the core has zeroed every account, so the season's holdings and open orders end with it.
    'world.closed': (k, { worldId }) => {
      if (!ok(worldId)) return;
      stmt(k, 'UPDATE exchange_holdings SET ended = 1 WHERE world_id = ? AND ended = 0').run(worldId);
      stmt(k, "UPDATE exchange_orders SET status = 'ended', hold_cents = 0 WHERE world_id = ? AND status = 'open'").run(worldId);
    },
  },

  // Holdings are not money: season close adds what they are worth (at the bid) to each owner's result, before the accounts reset.
  seasonAssets(k, { worldId }) {
    const w = { id: worldId, month: 0 };
    return [...holdingsValue(k, worldId, book(k, w)).entries()].map(([playerId, cents]) => ({ playerId, cents }));
  },

  // The header chips: the index level and the newest headline (the strip on the home screen is a proposal, see docs/phase3.md).
  badges(k, user) {
    const w = k.world.current();
    if (!w) return [];
    const two = stmt(k, "SELECT price_micro FROM exchange_prices WHERE world_id = ? AND ticker = 'DAAX' ORDER BY month DESC LIMIT 2").all(w.id);
    if (!two.length) return [];
    const ch = two.length > 1 ? ((two[0].price_micro - two[1].price_micro) * 100) / two[1].price_micro : 0;
    const news = stmt(k, 'SELECT text FROM exchange_news WHERE world_id = ? ORDER BY id DESC LIMIT 1').get(w.id);
    return [{ text: `DAAX ${money(microToCents(two[0].price_micro))} ${ch >= 0 ? '+' : ''}${ch.toFixed(1)}%`, title: 'The DAA Total Market Index, change since last month. Open the Exchange.' },
      ...(news ? [{ text: trim(news.text, 40), title: news.text.slice(0, 120) }] : [])];
  },

  panels: [{ id: 'exchange', building: { key: 'exchange', name: 'Exchange', icon: ICON }, src: 'exchange.js' }],
  teacherPanels: [{ id: 'exchange-teach', title: 'Exchange', src: 'teach.js' }],

  onTick: tick,
  simulate: bots,

  routes: [
    { method: 'GET', path: '/state', access: 'student', handler: (k, { user }) => state(k, user) },
    {
      method: 'POST', path: '/preview', access: 'student',   // what an order would cost or pay, and whether it would be refused: nothing is saved
      handler(k, { user, body }) {
        const w = needWorld(k), input = orderInput(k, body), b = book(k, w);
        const p = planOrder(k, user.id, w, b, input);
        return { ok: !p.problem, problem: p.problem, type: p.type, note: p.note ?? null, units_micro: p.units, price_micro: p.price, cents: p.cents, spread_cents: p.spreadCents, hold_cents: p.holdCents,
          price_cents: microToCents(p.price), orders_used: stmt(k, 'SELECT COUNT(*) AS n FROM exchange_orders WHERE player_id = ? AND world_id = ? AND placed_month = ?').get(user.id, w.id, w.month).n };
      },
    },
    { method: 'POST', path: '/order', access: 'student', handler: (k, { user, body }) => placeOrder(k, user, orderInput(k, body)) },
    { method: 'POST', path: '/cancel', access: 'student', handler: (k, { user, body }) => cancelOrder(k, user, k.input.int(body, 'id', { min: 1 })) },
    { method: 'POST', path: '/contribute', access: 'student', handler: (k, { user, body }) => contribute(k, user, accountOf(k, body), k.input.int(body, 'cents', { min: 1, max: MAX_CENTS })) },
    { method: 'POST', path: '/withdraw', access: 'student', handler: (k, { user, body }) => withdraw(k, user, accountOf(k, body), k.input.int(body, 'cents', { min: 1, max: MAX_CENTS })) },
    {
      method: 'POST', path: '/drip', access: 'student',      // reinvest this holding's dividends (DRIP) or take them as cash
      handler(k, { user, body }) {
        const w = needWorld(k), account = accountOf(k, body), ticker = k.input.str(body, 'ticker', { max: 8 }), on = k.input.bool(body, 'drip');
        const r = stmt(k, 'UPDATE exchange_holdings SET drip = ? WHERE player_id = ? AND world_id = ? AND account = ? AND ticker = ? AND ended = 0').run(on ? 1 : 0, user.id, w.id, account, ticker);
        if (!r.changes) throw new k.HttpError(404, 'You do not hold that');
        return { ok: true, drip: on };
      },
    },

    // ---- teacher ----
    {
      method: 'GET', path: '/teach', access: 'teacher',
      handler(k, { user }) {
        const w = needWorld(k), b = book(k, w), list = secs(k);
        const classes = k.players.classesFor(user);
        const ids = JSON.stringify(classes.map((c) => c.id));
        const held = stmt(k, `SELECT p.class_id, h.player_id, h.ticker, h.units_micro FROM exchange_holdings h JOIN players p ON p.id = h.player_id
          WHERE h.world_id = ? AND h.ended = 0 AND h.units_micro > 0 AND p.class_id IN (SELECT value FROM json_each(?))`).all(w.id, ids);
        const cash = stmt(k, `SELECT p.class_id, a.owner_id AS player_id, SUM(a.balance_cents) AS n FROM accounts a JOIN players p ON a.owner_type = 'player' AND a.owner_id = p.id
          WHERE a.kind IN ('invest', 'tfsa', 'rrsp', 'xhold') AND a.balance_cents > 0 AND p.class_id IN (SELECT value FROM json_each(?)) GROUP BY a.owner_id`).all(ids);
        const tfsa = stmt(k, `SELECT p.class_id, COUNT(DISTINCT t.player_id) AS users, SUM(t.contributed_cents) AS contributed FROM exchange_tfsa t JOIN players p ON p.id = t.player_id
          WHERE t.world_id = ? AND p.class_id IN (SELECT value FROM json_each(?)) GROUP BY p.class_id`).all(w.id, ids);
        const rrsp = stmt(k, `SELECT p.class_id, COUNT(DISTINCT CASE WHEN t.contributed_cents > 0 THEN t.player_id END) AS users, SUM(t.contributed_cents) AS contributed FROM exchange_rrsp t JOIN players p ON p.id = t.player_id
          WHERE t.world_id = ? AND p.class_id IN (SELECT value FROM json_each(?)) GROUP BY p.class_id`).all(w.id, ids);
        const refunds = stmt(k, `SELECT p.class_id, SUM(t.refund_cents) AS refunded FROM exchange_settlements t JOIN players p ON p.id = t.player_id
          WHERE t.world_id = ? AND p.class_id IN (SELECT value FROM json_each(?)) GROUP BY p.class_id`).all(w.id, ids);
        const trades = stmt(k, `SELECT p.class_id, COUNT(*) AS n FROM exchange_trades t JOIN players p ON p.id = t.player_id
          WHERE t.world_id = ? AND t.month = ? AND t.undone = 0 AND t.via <> 'drip' AND p.class_id IN (SELECT value FROM json_each(?)) GROUP BY p.class_id`).all(w.id, w.month, ids);
        const out = classes.map((c) => {
          const mine = held.filter((h) => h.class_id === c.id), kinds = { fund: 0, stock: 0 }, by = new Map();
          for (const h of mine) {
            const v = valueOfHolding(b, h.ticker, h.units_micro), kind = b.get(h.ticker)?.sec.kind ?? 'stock';
            kinds[kind] += v;
            const e = by.get(h.ticker) ?? by.set(h.ticker, { ticker: h.ticker, name: b.get(h.ticker)?.sec.name ?? h.ticker, holders: new Set(), value_cents: 0 }).get(h.ticker);
            e.holders.add(h.player_id); e.value_cents += v;
          }
          const investors = new Set([...mine.map((h) => h.player_id), ...cash.filter((x) => x.class_id === c.id).map((x) => x.player_id)]);
          const t = tfsa.find((x) => x.class_id === c.id), r = rrsp.find((x) => x.class_id === c.id);
          return {
            id: c.id, name: c.name, students: k.players.inClass(c.id).length, investors: investors.size, funds_cents: kinds.fund, stocks_cents: kinds.stock,
            cash_cents: cash.filter((x) => x.class_id === c.id).reduce((s, x) => s + x.n, 0),
            top: [...by.values()].map((e) => ({ ticker: e.ticker, name: e.name, holders: e.holders.size, value_cents: e.value_cents })).sort((x, y) => y.holders - x.holders || y.value_cents - x.value_cents || x.ticker.localeCompare(y.ticker)).slice(0, 5),
            tfsa_users: t?.users ?? 0, tfsa_contributed_cents: t?.contributed ?? 0,
            rrsp_users: r?.users ?? 0, rrsp_contributed_cents: r?.contributed ?? 0, rrsp_refund_cents: refunds.find((x) => x.class_id === c.id)?.refunded ?? 0, trades_this_month: trades.find((x) => x.class_id === c.id)?.n ?? 0,
          };
        });
        const names = new Map(classes.flatMap((c) => k.players.inClass(c.id).map((s) => [s.id, { username: s.username, class: c.name }])));
        const recent = stmt(k, `SELECT t.id, t.player_id, t.account, t.ticker, t.side, t.units_micro, t.price_micro, t.cents, t.month, t.via, t.undone FROM exchange_trades t JOIN players p ON p.id = t.player_id
          WHERE t.world_id = ? AND t.via <> 'drip' AND p.class_id IN (SELECT value FROM json_each(?)) ORDER BY t.id DESC LIMIT 25`).all(w.id, ids);
        return {
          month: w.month, frozen: !!settings(k, w.id).frozen, can_control: k.policy.can(user, 'world.settings'), tfsa_limit_cents: limitsIn(k, w.id, yearOf(w.month)).tfsa, rrsp_limit_cents: limitsIn(k, w.id, yearOf(w.month)).rrsp, orders_max: ORDERS_PER_MONTH,
          classes: out,
          events: Object.entries(EVENTS).map(([kind, e]) => ({ kind, name: e.name, scope: e.scope, pct: e.scope === 'stock' ? e.stockPct : e.equityPct, bond_pct: e.bondPct ?? null })),
          stocks: list.filter((s) => s.kind === 'stock').map((s) => ({ ticker: s.ticker, name: s.name })),
          queued: stmt(k, 'SELECT id, kind, ticker, created_month, applied_month FROM exchange_events WHERE world_id = ? ORDER BY id DESC LIMIT 8').all(w.id),
          trades: recent.map((t) => ({ id: t.id, student: names.get(t.player_id)?.username ?? '', class: names.get(t.player_id)?.class ?? '', account: t.account, ticker: t.ticker, side: t.side, units_micro: t.units_micro, price_cents: microToCents(t.price_micro), cents: t.cents, month: t.month, via: t.via, undone: !!t.undone })),
          news: stmt(k, 'SELECT month, text FROM exchange_news WHERE world_id = ? ORDER BY id DESC LIMIT 6').all(w.id),
          securities: list.map((s) => ({ ticker: s.ticker, price_cents: microToCents(b.get(s.ticker).price), halted: b.get(s.ticker).halted })),
        };
      },
    },
    {
      method: 'POST', path: '/freeze', access: 'teacher',
      handler(k, { user, body }) {
        k.policy.assert(user, 'world.settings');                         // trading is the whole world's
        const frozen = k.input.bool(body, 'frozen'), w = k.world.active();   // 409 between seasons: a closed world never ticks again, so this would be lost
        k.db.txn((tx) => {
          stmt(k, 'INSERT INTO exchange_settings (world_id, frozen) VALUES (?, ?) ON CONFLICT (world_id) DO UPDATE SET frozen = excluded.frozen').run(w.id, frozen ? 1 : 0);
          k.audit('freeze', { worldId: w.id, frozen }, `player:${user.id}`);
          tx.onCommit(() => k.events.emit('changed', { classId: user.class_id ?? null }));
        });
        return { ok: true, frozen };
      },
    },
    {
      method: 'POST', path: '/event', access: 'teacher',
      handler(k, { user, body }) {
        k.policy.assert(user, 'world.settings');
        const kind = k.input.str(body, 'kind', { max: 12 }), ev = Object.hasOwn(EVENTS, kind) ? EVENTS[kind] : null;
        if (!ev) throw new k.HttpError(400, `Pick an event: ${Object.keys(EVENTS).join(', ')}`);
        const w = k.world.active();   // 409 between seasons: a closed world never ticks again, so this would be lost
        const ticker = ev.scope === 'stock' ? k.input.str(body, 'ticker', { max: 8 }) : null;
        queueEvent(k, w, { kind, ticker, headline: null, by: user.id, classId: user.class_id ?? null });
        return { ok: true, applies_from_month: w.month + 1 };
      },
    },
    {
      method: 'POST', path: '/undo', access: 'teacher',   // undo one trade at its original price: the cash goes back the other way and the holding is put back
      handler(k, { user, body }) {
        k.policy.assert(user, 'world.settings');
        const id = k.input.int(body, 'id', { min: 1 }), w = needWorld(k);
        const t = stmt(k, 'SELECT * FROM exchange_trades WHERE id = ?').get(id);
        if (!t) throw new k.HttpError(404, 'Trade not found');
        k.policy.assert(user, 'player.manage', { playerId: t.player_id });   // and only for a student in one of this teacher's classes (404 otherwise)
        if (t.world_id !== w.id || w.status !== 'active') throw new k.HttpError(409, 'That trade is from a past season.');   // its season's money was reset
        if (t.undone) throw new k.HttpError(409, 'That trade was already undone');
        if (t.via === 'drip') throw new k.HttpError(400, 'Undo the dividend by hand: reinvested dividends are not undone one by one');
        return k.db.txn((tx) => {
          const acct = openAcct(k, t.player_id, t.account), h = holdingOf(k, t.player_id, w.id, t.account, t.ticker);
          if (t.side === 'buy') {
            const free = (h?.units_micro ?? 0) - reservedOf(k, t.player_id, w.id, t.account, t.ticker);
            if (free < t.units_micro) throw new k.HttpError(409, 'The student no longer has these shares free to take back (sold, or reserved by a sell limit)');
            k.ledger.post({ kind: 'undo_buy', actor: `player:${user.id}`, meta: { tradeId: t.id }, legs: [{ account: k.ledger.system('sink'), cents: -t.cents, memo: `Trade undone by your teacher: ${t.ticker}` }, { account: acct, cents: t.cents, memo: `Trade undone by your teacher: ${t.ticker}` }] });
            takeHolding(k, w.id, t.player_id, t.account, t.ticker, t.units_micro, t.cents);
          } else {
            if (balOf(k, t.player_id, t.account) < t.cents) throw new k.HttpError(409, 'The student has already moved the sale proceeds out of that account, so the sale cannot be undone');
            k.ledger.post({ kind: 'undo_sell', actor: `player:${user.id}`, meta: { tradeId: t.id }, legs: [{ account: acct, cents: -t.cents, memo: `Trade undone by your teacher: ${t.ticker}` }, { account: k.ledger.system('mint'), cents: t.cents, memo: `Trade undone by your teacher: ${t.ticker}` }] });
            addHolding(k, w.id, t.player_id, t.account, t.ticker, t.units_micro, t.basis_cents);
          }
          stmt(k, 'UPDATE exchange_trades SET undone = 1 WHERE id = ?').run(t.id);
          k.audit('undo', { tradeId: t.id, playerId: t.player_id, ticker: t.ticker, side: t.side, cents: t.cents }, `player:${user.id}`);
          afterTrade(k, tx, w, t.player_id, user.class_id);
          return { ok: true, cents: t.cents };
        });
      },
    },
  ],
});
