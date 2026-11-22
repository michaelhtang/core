// exchange reads: the prepared-statement helper, ledger balances, holdings and trade rows, the price-series secret (the bottom layer; imports no sibling but constants)
import { randomBytes } from 'node:crypto';
import { proceedsCents } from './orders.js';

export const ACCOUNTS = ['invest', 'tfsa', 'rrsp'];
export const LABEL = { invest: 'non-registered account', tfsa: 'TFSA', rrsp: 'RRSP' };

// Statements are prepared once per kernel: the tick and the badges run them for every student.
const prepared = new WeakMap();
export const stmt = (k, sql) => {
  const byText = prepared.get(k) ?? prepared.set(k, new Map()).get(k);
  return byText.get(sql) ?? byText.set(sql, k.db.prepare(sql)).get(sql);
};

// ---- accounts and cash ----
export const openAcct = (k, playerId, kind) => k.ledger.openAccount({ ownerType: 'player', ownerId: playerId, kind });
export const balOf = (k, playerId, kind) => { const a = k.ledger.accountId('player', playerId, kind); return a ? k.ledger.balance(a) : 0; };
// Total investable cash: chequing, the three investment accounts and what is held for open buy limits.
export const investable = (k, playerId) => ['chequing', 'invest', 'tfsa', 'rrsp', 'xhold'].reduce((t, kind) => t + balOf(k, playerId, kind), 0);
export const settings = (k, worldId) => stmt(k, 'SELECT frozen FROM exchange_settings WHERE world_id = ?').get(worldId) ?? { frozen: 0 };

// ---- holdings, value ----
export const holdingOf = (k, pid, wid, account, ticker) => stmt(k, 'SELECT units_micro, cost_cents, drip FROM exchange_holdings WHERE player_id = ? AND world_id = ? AND account = ? AND ticker = ? AND ended = 0').get(pid, wid, account, ticker);
export const reservedOf = (k, pid, wid, account, ticker) => stmt(k, "SELECT COALESCE(SUM(units_micro), 0) AS n FROM exchange_orders WHERE player_id = ? AND world_id = ? AND account = ? AND ticker = ? AND side = 'sell' AND status = 'open'").get(pid, wid, account, ticker).n;
export const valueOfHolding = (b, ticker, units) => (b.get(ticker) ? proceedsCents(units, b.get(ticker).bid) : 0);

// Each world's price series is also seeded by a random secret kept only in this table (never sent to a browser), so knowing the code and the world id
// is not enough to compute next month's prices.
export function secretOf(k, worldId) {
  const row = stmt(k, 'SELECT secret FROM exchange_secrets WHERE world_id = ?').get(worldId);
  if (row) return row.secret;
  const secret = randomBytes(16).toString('hex');
  stmt(k, 'INSERT INTO exchange_secrets (world_id, secret) VALUES (?, ?)').run(worldId, secret);
  return secret;
}

export function addHolding(k, wid, pid, account, ticker, units, cost) {
  stmt(k, `INSERT INTO exchange_holdings (player_id, world_id, account, ticker, units_micro, cost_cents) VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT (player_id, world_id, account, ticker) DO UPDATE SET units_micro = units_micro + excluded.units_micro, cost_cents = cost_cents + excluded.cost_cents, ended = 0`).run(pid, wid, account, ticker, units, cost);
}
export const takeHolding = (k, wid, pid, account, ticker, units, cost) => stmt(k, 'UPDATE exchange_holdings SET units_micro = units_micro - ?, cost_cents = MAX(0, cost_cents - ?) WHERE player_id = ? AND world_id = ? AND account = ? AND ticker = ?').run(units, cost, pid, wid, account, ticker);
export const addTrade = (k, t) => Number(stmt(k, `INSERT INTO exchange_trades (order_id, player_id, world_id, account, ticker, side, units_micro, price_micro, cents, basis_cents, month, txn_id, via, created)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(t.orderId ?? null, t.pid, t.wid, t.account, t.ticker, t.side, t.units, t.price, t.cents, t.basis ?? 0, t.month, t.txn, t.via, k.clock.now()).lastInsertRowid);

export const needWorld = (k) => { const w = k.world.current(); if (!w) throw new k.HttpError(409, 'There is no active world'); return w; };
export const trim = (s, n) => (s.length <= n ? s : `${s.slice(0, n - 1)}...`);
