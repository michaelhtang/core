// exchange services for other modules: stageEvent, allocation (life), retirementPots, drawForRetirement, recordRetirementIncome (retirement); reached through k.modules.call
import { ok } from '../../lib/kernel.js';
import { EVENTS, PRICE_SCALE, UNIT, stepOf } from './constants.js';
import { expectedBp } from './prices.js';
import { proceedsCents, yearOf } from './orders.js';
import { stmt, needWorld, balOf, settings, reservedOf, valueOfHolding } from './reads.js';
import { secs, queueEvent, book } from './catalogue.js';
import { settleSell } from './trading.js';
import { withdraw } from './registered.js';

// ---- services for the life module (docs/phase5-life.md 5b): reachable only through k.modules.call, no route ----
// stageEvent { kind, ticker? (stock-scope kinds), headline? (1-120 characters) }: the teacher's market event, scheduled by a stage. Idempotent per
// (world, month, kind): a second call in the same world month returns the event already queued (already: true) and queues nothing.
export function stageEvent(k, args) {
  const w = k.world.active();
  const { kind, ticker = null, headline = null } = args ?? {};
  if (typeof kind !== 'string' || !Object.hasOwn(EVENTS, kind)) throw new k.HttpError(400, `stageEvent: kind must be one of ${Object.keys(EVENTS).join(', ')}`);
  const text = headline === null ? null : typeof headline === 'string' ? headline.replace(/[\u0000-\u001f\u007f]/g, ' ').trim() : '';
  if (text !== null && (!text || text.length > 120)) throw new k.HttpError(400, 'stageEvent: headline must be 1 to 120 characters');
  const row = (id) => stmt(k, 'SELECT id, kind, ticker, headline, created_month FROM exchange_events WHERE id = ?').get(id);
  const view = (r, already) => ({ id: r.id, kind: r.kind, ticker: r.ticker, headline: r.headline, month: r.created_month, appliesFromMonth: r.created_month + 1, already });
  const have = stmt(k, 'SELECT id FROM exchange_events WHERE world_id = ? AND created_month = ? AND kind = ? ORDER BY id LIMIT 1').get(w.id, w.month, kind);
  if (have) return view(row(have.id), true);
  return view(row(queueEvent(k, w, { kind, ticker, headline: text, by: null, classId: null })), false);
}
// allocation { playerId }: read-only. What the student's non-registered account, TFSA and RRSP hold, in cents at the bid, by asset class: the index fund and
// stocks are equities, the bond fund bonds, a blend (the balanced fund) splits by its own weights, the cash in those accounts (and held for buy limits) is cash.
export function allocation(k, args) {
  const playerId = args?.playerId;
  if (!ok(playerId)) throw new k.HttpError(400, 'allocation: playerId must be an integer');
  const w = needWorld(k), b = book(k, w);
  const out = { equities: 0, bonds: 0, cash: ['invest', 'tfsa', 'rrsp', 'xhold'].reduce((t, kind) => t + balOf(k, playerId, kind), 0), other: 0 };
  const typeOf = (t) => b.get(t)?.sec.type;
  for (const h of stmt(k, 'SELECT ticker, units_micro FROM exchange_holdings WHERE player_id = ? AND world_id = ? AND ended = 0 AND units_micro > 0').all(playerId, w.id)) {
    const v = valueOfHolding(b, h.ticker, h.units_micro), sec = b.get(h.ticker)?.sec;
    if (sec?.type === 'equity') out.equities += v;
    else if (sec?.type === 'bond') out.bonds += v;
    else if (sec?.type === 'blend') {
      const pct = (type) => Object.entries(sec.blend).filter(([t]) => typeOf(t) === type).reduce((n, [, p]) => n + p, 0);
      const eq = Math.round((v * pct('equity')) / 100), bd = pct('equity') + pct('bond') === 100 ? v - eq : Math.round((v * pct('bond')) / 100);
      out.equities += eq; out.bonds += bd; out.other += v - eq - bd;
    } else out.other += v;
  }
  return out;
}

// ---- services for the retirement module (docs/phase5-life.md 5c): reachable only through k.modules.call, no route ----
const DRAW_ACCOUNTS = ['rrsp', 'tfsa', 'invest'];
// retirementPots { playerId } -> { rrsp, tfsa, invest: { cents, rate_bp } }: read-only. Each account's cash + holdings at the bid, and its own expected
// return (the holdings' expected returns weighted by value, cash at 0), for the retirement projection.
export function retirementPots(k, args) {
  const playerId = args?.playerId;
  if (!ok(playerId)) throw new k.HttpError(400, 'retirementPots: playerId must be an integer');
  const w = needWorld(k), b = book(k, w), list = secs(k);
  const out = Object.fromEntries(DRAW_ACCOUNTS.map((a) => [a, { cents: balOf(k, playerId, a), weighted: 0 }]));
  for (const h of stmt(k, 'SELECT account, ticker, units_micro FROM exchange_holdings WHERE player_id = ? AND world_id = ? AND ended = 0 AND units_micro > 0').all(playerId, w.id)) {
    const o = out[h.account], m = b.get(h.ticker);
    if (!o || !m) continue;
    const v = valueOfHolding(b, h.ticker, h.units_micro);
    o.cents += v; o.weighted += v * expectedBp(m.sec, list);
  }
  return Object.fromEntries(DRAW_ACCOUNTS.map((a) => [a, { cents: out[a].cents, rate_bp: out[a].cents > 0 ? Math.round(out[a].weighted / out[a].cents) : 0 }]));
}
// drawForRetirement { playerId, account 'rrsp' | 'tfsa' | 'invest', cents }: the retirement plan's monthly draw from one account. The account's cash first; when that
// is short, holdings are sold at the bid (the real sale: settleSell, the market maker's spread is the cost; kind exchange.draw_sell, so it is not a trade in the
// feed) in ticker order, skipping a halted or paused security and units a sell limit reserves; then the cash goes to chequing through the same withdrawal as
// the panel's (TFSA: room back next year; RRSP/RRIF: withholding 10/20/30% to the sink, kept for the year-end settlement), kind exchange.draw, actor system.
// Never more than the account holds. While the teacher has frozen trading nothing is sold (the cash still comes out). Returns { account, cents (drawn, gross),
// withheld_cents, net_cents, sold_cents, note } (note: why holdings were left unsold when the cash was short: 'trading frozen' or 'some holdings could not be sold this month').
export function drawForRetirement(k, args) {
  const { playerId, account, cents } = args ?? {};
  if (!ok(playerId) || !DRAW_ACCOUNTS.includes(account) || !ok(cents) || cents <= 0) throw new k.HttpError(400, 'drawForRetirement: { playerId, account rrsp|tfsa|invest, cents > 0 }');
  const w = needWorld(k);
  if (w.status !== 'active') throw new k.HttpError(409, 'The season is closed');
  return k.db.txn(() => {
    let cash = balOf(k, playerId, account), sold = 0, skipped = false;
    const frozen = !!settings(k, w.id).frozen;
    if (cash < cents && !frozen) {
      const b = book(k, w);
      for (const h of stmt(k, 'SELECT ticker, units_micro FROM exchange_holdings WHERE player_id = ? AND world_id = ? AND account = ? AND ended = 0 AND units_micro > 0 ORDER BY ticker').all(playerId, w.id, account)) {
        const m = b.get(h.ticker);
        if (!m || m.halted || m.paused || m.bid <= 0) { skipped = true; continue; }
        const step = stepOf(m.sec), free = h.units_micro - reservedOf(k, playerId, w.id, account, h.ticker);
        const need = cents - cash;
        let units = Math.ceil((need * PRICE_SCALE * UNIT) / m.bid);              // enough units to raise `need` at the bid (a float estimate, then checked below)
        units = Math.ceil(units / step) * step;
        while (units < free && proceedsCents(units, m.bid) < need) units += step;
        if (units >= free) units = free === h.units_micro ? free : free - (free % step);   // all of it, or as much as a legal size allows
        if (free < h.units_micro) skipped = true;                                // some units are reserved by a sell limit
        if (units <= 0) continue;
        const proceeds = proceedsCents(units, m.bid);
        if (proceeds <= 0) continue;
        settleSell(k, w, { pid: playerId, account, sec: m.sec, units, proceeds, price: m.bid, via: 'draw', orderId: null, month: w.month, kind: 'draw_sell', actor: 'system' });
        sold += proceeds;
        cash = balOf(k, playerId, account);
        if (cash >= cents) break;
      }
    }
    const take = Math.min(cents, cash);
    const note = take < cents && (frozen || skipped) ? (frozen ? 'trading frozen' : 'some holdings could not be sold this month') : '';
    if (take <= 0) return { account, cents: 0, withheld_cents: 0, net_cents: 0, sold_cents: sold, note };
    const r = withdraw(k, { id: playerId, class_id: null }, account, take, { kind: 'draw', actor: 'system' });
    return { account, cents: take, withheld_cents: r.withheld_cents, net_cents: r.net_cents, sold_cents: sold, note };
  });
}
// recordRetirementIncome { playerId, month, cents, withheldCents, oasCents }: CPP + OAS paid this month (gross), the tax withheld on it and the OAS part, added to
// the world year's row, so the year-end settlement (settleRrsp) taxes it with everything else through annualIncomeTax (and the OAS recovery tax). No money moves here.
export function recordRetirementIncome(k, args) {
  const { playerId, month, cents, withheldCents, oasCents } = args ?? {};
  if (![playerId, month, cents, withheldCents, oasCents].every((n) => ok(n) && n >= 0) || withheldCents > cents || oasCents > cents) throw new k.HttpError(400, 'recordRetirementIncome: { playerId, month, cents, withheldCents <= cents, oasCents <= cents }');
  const w = needWorld(k);
  stmt(k, `INSERT INTO exchange_rrsp (player_id, world_id, year, pension_cents, pension_withheld_cents, oas_cents) VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT (player_id, world_id, year) DO UPDATE SET pension_cents = pension_cents + excluded.pension_cents, pension_withheld_cents = pension_withheld_cents + excluded.pension_withheld_cents,
    oas_cents = oas_cents + excluded.oas_cents`).run(playerId, w.id, yearOf(month), cents, withheldCents, oasCents);
  return { year: yearOf(month) };
}
