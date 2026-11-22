// leaderboards: shared reads (statements, settings, months, inputs) and the month-end snapshot (onTick).
import { ok } from '../../lib/kernel.js';
import { RECENT_PAY_MONTHS, STAGE_FACTORS, stageOfMonth } from './constants.js';
import { thresholds, tierOf, healthParts, healthScore, ranked } from './health.js';

// Statements are prepared once per kernel: the listeners below run thousands of times in one world month, and compiling SQL each time cost more than the tick itself.
const prepared = new WeakMap();
export const stmt = (k, sql) => {
  const byText = prepared.get(k) ?? prepared.set(k, new Map()).get(k);
  return byText.get(sql) ?? byText.set(sql, k.db.prepare(sql)).get(sql);
};
export const byNet = (a, b) => b.net_worth - a.net_worth || a.player_id - b.player_id;
export const byHealth = (a, b) => b.health - a.health || b.net_worth - a.net_worth || a.player_id - b.player_id;
export const netOf = (r) => r.net_worth;
export const healthOf = (r) => r.health;

// ---- settings and months ----
export const settingsOf = (k, worldId) => stmt(k, 'SELECT hide_amounts, frozen_month FROM leaderboards_settings WHERE world_id = ?').get(worldId) ?? { hide_amounts: 0, frozen_month: null };
export const latestMonth = (k, worldId) => stmt(k, 'SELECT MAX(month) AS m FROM leaderboards_snapshots WHERE world_id = ?').get(worldId).m;
// The month the boards show: the last snapshot, or the month a teacher froze them at.
export const boardMonth = (k, worldId) => settingsOf(k, worldId).frozen_month ?? latestMonth(k, worldId);
// Not a student removed since (core players.class_id NULL, lib/players.js detach): until the next tick their row is still the latest one.
export const rowsAt = (k, worldId, month) => stmt(k, `SELECT player_id, class_id, net_worth, health, parts, rank_class, rank_town, tier FROM leaderboards_snapshots
  WHERE world_id = ? AND month = ? AND player_id IN (SELECT id FROM players WHERE class_id IS NOT NULL)`).all(worldId, month);

// ---- inputs kept from events ----
export function setInput(k, worldId, playerId, patch) {   // column names are literals in this file, never data
  const cols = Object.keys(patch);
  stmt(k, `INSERT INTO leaderboards_inputs (world_id, player_id, ${cols.join(', ')}) VALUES (?, ?, ${cols.map(() => '?').join(', ')})
    ON CONFLICT (world_id, player_id) DO UPDATE SET ${cols.map((c) => `${c} = excluded.${c}`).join(', ')}`).run(worldId, playerId, ...Object.values(patch));
}
export const addOnTime = (k, worldId, playerId, n) => stmt(k, `INSERT INTO leaderboards_inputs (world_id, player_id, ontime) VALUES (?, ?, MAX(0, ?))
  ON CONFLICT (world_id, player_id) DO UPDATE SET ontime = MAX(0, ontime + ?)`).run(worldId, playerId, n, n);
export const addLate = (k, worldId, playerId, key) => stmt(k, 'INSERT OR IGNORE INTO leaderboards_late (world_id, player_id, key) VALUES (?, ?, ?)').run(worldId, playerId, key);
export const wid = (k, p) => (ok(p?.worldId) ? p.worldId : k.world.current()?.id);

// The Wolf cutoffs for world month `month`: price index x the life stage's factor when the life module is loaded (x1 without it).
export const thresholdsAt = (k, worldId, month) => thresholds(k.config, k.world.priceIndex(worldId), k.modules.has('life') ? STAGE_FACTORS[stageOfMonth(month)] : 1);

// ---- the snapshot ----
export function tick(k, { month, classes }) {
  const w = k.world.current();
  const thr = thresholdsAt(k, w.id, month);
  const inputs = new Map(stmt(k, 'SELECT * FROM leaderboards_inputs WHERE world_id = ?').all(w.id).map((r) => [r.player_id, r]));
  const lates = new Map(stmt(k, 'SELECT player_id, COUNT(*) AS n FROM leaderboards_late WHERE world_id = ? GROUP BY player_id').all(w.id).map((r) => [r.player_id, r.n]));
  const before = new Map(stmt(k, 'SELECT player_id, tier FROM leaderboards_snapshots WHERE world_id = ? AND month = ?').all(w.id, month - 1).map((r) => [r.player_id, r.tier]));
  const rows = [];
  for (const c of classes) {
    k.forEachPlayer(c.studentIds, (id) => {                                      // a student whose row cannot be built is left out of this month's boards
      const inp = inputs.get(id) ?? {};
      let net = (inp.home_value ?? 0) + (inp.exchange_value ?? 0) + (inp.ventures_value ?? 0), saved = 0, cardOwed = 0, mortgage = 0, chequing = 0;
      for (const a of k.ledger.accountsOf('player', id)) {   // the ledger sum already holds HISA, GICs, the card, mortgage and emergency loan (negative), the deposit
        net += a.balance_cents;
        if (a.kind === 'chequing') chequing = a.balance_cents;
        else if (a.kind === 'hisa' || a.kind.startsWith('gic:')) saved += a.balance_cents;
        else if (a.kind === 'card') cardOwed = Math.max(0, -a.balance_cents);
        else if (a.kind === 'mortgage' || a.kind.startsWith('mortgage:')) mortgage += a.balance_cents;   // 6b: a rental's mortgage is 'mortgage:<home id>'
      }
      const paid = inp.pay_month != null && inp.pay_month > month - RECENT_PAY_MONTHS;
      const parts = healthParts({
        saved, netPay: paid ? inp.net_cents : 0, gross: paid ? inp.gross_cents : 0, ontime: inp.ontime ?? 0, late: lates.get(id) ?? 0,
        score: inp.score ?? null, cardOwed, mortgagePayment: mortgage < 0 ? inp.mortgage_payment ?? 0 : 0, stress: inp.stress ?? null,
        coverage: inp.coverage ?? null,   // 5c: once the retirement module announced coverage (from age 55, whatever the start age), it replaces the debt load
      });
      rows.push({ player_id: id, class_id: c.id, net_worth: net, health: healthScore(parts), parts: JSON.stringify(parts), tier: tierOf(net, thr),
        chequing, saved, holdings: inp.exchange_value ?? 0, net_pay: paid ? inp.net_cents : 0 });   // the month's facts the pattern flags read (flags.js)
    });
  }
  const town = new Map();
  const sorted = [...rows].sort(byNet);
  ranked(sorted, netOf).forEach((rank, i) => town.set(sorted[i].player_id, rank));
  const inClass = new Map();
  for (const c of classes) {
    const mine = sorted.filter((r) => r.class_id === c.id);
    ranked(mine, netOf).forEach((rank, i) => inClass.set(mine[i].player_id, rank));
  }
  const put = stmt(k, 'INSERT OR REPLACE INTO leaderboards_snapshots (world_id, player_id, month, class_id, net_worth, health, parts, rank_class, rank_town, tier, chequing, saved, holdings, net_pay) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
  const up = stmt(k, 'INSERT OR IGNORE INTO leaderboards_rankups (world_id, player_id, tier, month) VALUES (?, ?, ?, ?)');
  for (const r of rows) {
    put.run(w.id, r.player_id, month, r.class_id, r.net_worth, r.health, r.parts, inClass.get(r.player_id), town.get(r.player_id), r.tier, r.chequing, r.saved, r.holdings, r.net_pay);
    if (before.has(r.player_id) && r.tier > before.get(r.player_id)) up.run(w.id, r.player_id, r.tier, month);   // once per tier per season (the key)
  }
}
