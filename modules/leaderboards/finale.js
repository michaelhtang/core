// leaderboards: the season finale (awards, Life Review), the Hall of Fame and unseen rank-ups.
import { ok } from '../../lib/kernel.js';
import { AWARD_NAMES } from './constants.js';
import { tierName } from './health.js';
import { flags } from './flags.js';
import { stmt, settingsOf, latestMonth, rowsAt } from './snapshot.js';
import { awardsAt } from './boards.js';

// "Your life in snapshots" for the Life Review (docs/phase5-life.md 5b), from the life module's `snapshots` service when it is loaded. The contract read here:
// k.modules.call('life', 'snapshots', { playerId, worldId }) -> [{ age, net_worth_cents, allocation?: { equities, bonds, cash, other } (cents) }], one row per
// age snapshotted. Kept: net worth at 25/35/55/65/70 and the allocation at 25 and 65; a missing age is null. Without life, or if the call throws or answers
// something else, the review has no `life` and the card is unchanged.
const LIFE_AGES = [25, 35, 55, 65, 70], ALLOC_AGES = [25, 65], ALLOC_KEYS = ['equities', 'bonds', 'cash', 'other'];
function lifeSnapshots(k, worldId, playerId) {
  if (!k.modules.has('life')) return null;
  let rows;
  try { rows = k.modules.call('life', 'snapshots', { playerId, worldId }); } catch (e) { k.log.warn(`life snapshots skipped: ${e.message}`); return null; }
  if (!Array.isArray(rows)) return null;
  const at = (age) => rows.find((r) => r?.age === age);
  const parts = (a) => (a && typeof a === 'object' && ALLOC_KEYS.every((x) => a[x] === undefined || (ok(a[x]) && a[x] >= 0)) ? Object.fromEntries(ALLOC_KEYS.map((x) => [x, a[x] ?? 0])) : null);
  const out = {
    net_worth: LIFE_AGES.map((age) => ({ age, net_worth_cents: ok(at(age)?.net_worth_cents) ? at(age).net_worth_cents : null })),
    allocation: ALLOC_AGES.map((age) => ({ age, parts: parts(at(age)?.allocation) })),
  };
  return out.net_worth.some((n) => n.net_worth_cents !== null) || out.allocation.some((a) => a.parts) ? out : null;
}

export function finale(k, worldId) {
  const month = latestMonth(k, worldId);
  if (month == null) return;
  const season = k.world.current()?.id === worldId ? k.world.current().name : 'Season';
  const names = new Map(k.players.classes().map((c) => [c.id, c.name]));
  const series = new Map();
  for (const r of stmt(k, 'SELECT player_id, month, net_worth FROM leaderboards_snapshots WHERE world_id = ? ORDER BY player_id, month').all(worldId)) {
    (series.get(r.player_id) ?? series.set(r.player_id, []).get(r.player_id)).push(r);
  }
  const final = rowsAt(k, worldId, month);
  k.db.txn((tx) => {
    const putAward = stmt(k, 'INSERT OR REPLACE INTO leaderboards_awards (world_id, award, season, player_id, name, class_name, value) VALUES (?, ?, ?, ?, ?, ?, ?)');
    for (const a of awardsAt(k, worldId, month)) putAward.run(worldId, a.award, season, a.player_id, a.player_id == null ? null : k.players.get(a.player_id)?.username ?? null, names.get(a.class_id) ?? null, a.value);
    const putReview = stmt(k, 'INSERT OR REPLACE INTO leaderboards_reviews (world_id, player_id, season, data) VALUES (?, ?, ?, ?)');
    const putFlag = stmt(k, 'INSERT OR REPLACE INTO leaderboards_flags (world_id, player_id, key, detail) VALUES (?, ?, ?, ?)');
    const size = final.length;
    for (const r of final) {
      let best = null;
      const s = series.get(r.player_id) ?? [];
      for (let i = 1; i < s.length; i++) { const gain = s[i].net_worth - s[i - 1].net_worth; if (!best || gain > best.gain_cents) best = { month: s[i].month, gain_cents: gain }; }
      const life = lifeSnapshots(k, worldId, r.player_id);
      const fl = flags(k, { worldId, playerId: r.player_id });
      for (const f of fl) putFlag.run(worldId, r.player_id, f.key, f.detail);
      putReview.run(worldId, r.player_id, season, JSON.stringify({
        net_worth_cents: r.net_worth, tier: tierName(r.tier), best_month: best, health: r.health, parts: JSON.parse(r.parts), rank_class: r.rank_class, rank_town: r.rank_town, of_town: size,
        ...(life && { life }), flags: fl,
      }));
    }
    tx.onCommit(() => k.events.emit('awards', { worldId }));   // module.leaderboards.awards: teacher consoles refetch
  });
}

export const hallOf = (k) => {
  const rows = stmt(k, 'SELECT * FROM leaderboards_awards ORDER BY world_id DESC, award').all();
  const out = [];
  for (const a of rows) {
    let s = out.find((x) => x.world_id === a.world_id);
    if (!s) { s = { world_id: a.world_id, season: a.season, awards: [] }; out.push(s); }
    const hidden = settingsOf(k, a.world_id).hide_amounts === 1;
    s.awards.push({ award: a.award, title: AWARD_NAMES[a.award], name: a.name, class_name: a.class_name, value: (a.award === 'wolf' || a.award === 'founder') && hidden ? null : a.value });
  }
  return out;
};

export function unseenRankUp(k, worldId, playerId, month) {
  const r = stmt(k, 'SELECT tier FROM leaderboards_rankups WHERE world_id = ? AND player_id = ? AND seen = 0 AND month <= ? ORDER BY tier DESC LIMIT 1').get(worldId, playerId, month);
  return r ? tierName(r.tier) : null;
}
