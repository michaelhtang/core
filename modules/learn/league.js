// learn: ranked leagues (docs/learn.md "Leagues"). Pure functions first (grouping, settling), then the few reads and writes.
// Every number you may want to change is in LEAGUE. No money anywhere: a rank is a name and a badge only.
import { createHash } from 'node:crypto';
import { addDays } from '../../lib/clock.js';
import { mondayOf } from './daily.js';
import { TIERS, tierIndex } from './tiers.js';

// PODIUM: the top places of a group's promotion zone move up two ranks instead of one (Mr. Tang, 2026-11-19, so Challenger is reachable in one semester).
export const LEAGUE = Object.freeze({ GROUP_MAX: 30, PROMOTE: 10, PODIUM: 3, DEMOTE: 5, START: 'iron' });
export const tierOf = (id) => TIERS[tierIndex(id)] ?? TIERS[0];
const slim = (t) => ({ id: t.id, name: t.name });

// ---- pure: grouping ----
// A fixed order that nobody chooses: the hash of (world, week, player). No random numbers, no clock.
export const shuffleKey = (worldId, week, playerId) => createHash('sha256').update(`${worldId}|${week}|${playerId}`).digest('hex');
// The players of ONE rank -> groups (arrays of ids): ceil(n / GROUP_MAX) groups, sizes as even as possible (the first n % g groups get one extra).
export function splitGroups(ids, worldId, week, max = LEAGUE.GROUP_MAX) {
  const sorted = [...ids].sort((a, b) => { const x = shuffleKey(worldId, week, a), y = shuffleKey(worldId, week, b); return x < y ? -1 : x > y ? 1 : a - b; });
  const g = Math.ceil(sorted.length / max), base = g ? Math.floor(sorted.length / g) : 0, extra = g ? sorted.length % g : 0, out = [];
  for (let i = 0, at = 0; i < g; i++) { const size = base + (i < extra ? 1 : 0); out.push(sorted.slice(at, at + size)); at += size; }
  return out;
}
// players: [{ id, tier }] -> Map id -> { tier, grp } (group numbers count from 1 inside each rank).
export function assignGroups(players, worldId, week, max = LEAGUE.GROUP_MAX) {
  const byTier = new Map();
  for (const p of players) { if (!byTier.has(p.tier)) byTier.set(p.tier, []); byTier.get(p.tier).push(p.id); }
  const out = new Map();
  for (const [tier, ids] of byTier) splitGroups(ids, worldId, week, max).forEach((g, i) => g.forEach((id) => out.set(id, { tier, grp: i + 1 })));
  return out;
}
// A student who first appears mid-week: sizes = Map grp -> members of their rank. The smallest group (lowest number on a tie); a new group when all are full.
export function joinGroup(sizes, max = LEAGUE.GROUP_MAX) {
  if (!sizes.size) return 1;
  let best = null;
  for (const [grp, n] of [...sizes].sort((a, b) => a[0] - b[0])) if (n < max && (best === null || n < sizes.get(best))) best = grp;
  return best ?? Math.max(...sizes.keys()) + 1;
}

// ---- pure: settling ----
// One group's standings: rows [{ id, username, xp }] (any order) -> { order: ids best first, up: Set, double: Set, down: Set, promoteN, podiumN, demoteN }.
// Up: the top promoteN, plus everyone tied with the last of them, and only with XP > 0.
// Double (a subset of up, they move two ranks): the top podiumN = min(PODIUM, promoteN), plus everyone tied with the last of them.
// Down: the bottom demoteN, but a tie across the line spares everyone tied with the student just above it (not at 0 XP: 0 XP is the bottom and is never spared).
export function standings(rows, { promote = LEAGUE.PROMOTE, podium = LEAGUE.PODIUM, demote = LEAGUE.DEMOTE } = {}) {
  const sorted = [...rows].sort((a, b) => b.xp - a.xp || (a.username < b.username ? -1 : a.username > b.username ? 1 : a.id - b.id)), n = sorted.length;
  // Up: PROMOTE, but at most half the group (at least 1). Down: DEMOTE, but at most a quarter. So any group of 20 or more moves 10 up and 5 down.
  const promoteN = n ? Math.min(promote, Math.max(1, Math.floor(n / 2))) : 0, demoteN = Math.min(demote, Math.floor(n / 4));
  const podiumN = Math.min(podium, promoteN), up = new Set(), double = new Set(), down = new Set();
  if (promoteN > 0) { const cut = sorted[promoteN - 1].xp; for (const r of sorted) if (r.xp > 0 && r.xp >= cut) up.add(r.id); }
  if (podiumN > 0) { const cut = sorted[podiumN - 1].xp; for (const r of sorted) if (up.has(r.id) && r.xp >= cut) double.add(r.id); }
  if (demoteN > 0) {
    const inside = sorted.slice(n - demoteN), above = sorted[n - demoteN - 1];
    for (const r of inside) if ((r.xp === 0 || !above || above.xp !== r.xp) && !up.has(r.id)) down.add(r.id);
  }
  return { order: sorted.map((r) => r.id), up, double, down, promoteN, podiumN, demoteN };
}
// What a rank becomes: up2 is two ranks up; nothing goes past Challenger or below Iron.
const STEP = { up2: 2, up: 1, down: -1, stay: 0 };
export const nextTier = (id, zone) => TIERS[Math.max(0, Math.min(TIERS.length - 1, tierIndex(id) + (STEP[zone] ?? 0)))].id;
const zoneOf = (id, st) => (st.double.has(id) ? 'up2' : st.up.has(id) ? 'up' : st.down.has(id) ? 'down' : 'stay');
// The zone a row shows is the move that would really happen: up2 from Grandmasters is up (Challenger is the ceiling), any move that cannot happen is stay.
export const zoneFor = (tier, id, st) => { const d = tierIndex(nextTier(tier, zoneOf(id, st))) - tierIndex(tier); return d >= 2 ? 'up2' : d === 1 ? 'up' : d < 0 ? 'down' : 'stay'; };

// ---- storage ----
const weekXp = (k, wid, week) => new Map(k.db.prepare('SELECT player_id, SUM(xp) AS xp FROM learn_days WHERE world_id = ? AND day >= ? AND day <= ? GROUP BY player_id').all(wid, week, addDays(week, 6)).map((r) => [r.player_id, r.xp]));
const rankOf = (k, pid, wid) => k.db.prepare('SELECT tier FROM learn_rank WHERE player_id = ? AND world_id = ?').get(pid, wid)?.tier ?? LEAGUE.START;

// Settle one finished week of a world, once. The caller holds the txn.
function settleWeek(k, wid, week) {
  if (k.db.prepare('SELECT 1 FROM learn_league_done WHERE world_id = ? AND week = ?').get(wid, week)) return;
  const xp = weekXp(k, wid, week), groups = new Map();
  for (const r of k.db.prepare('SELECT g.player_id AS id, g.tier, g.grp, p.username FROM learn_league_group g JOIN players p ON p.id = g.player_id WHERE g.world_id = ? AND g.week = ?').all(wid, week)) {
    const key = `${r.tier}|${r.grp}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push({ id: r.id, tier: r.tier, username: r.username, xp: xp.get(r.id) ?? 0 });
  }
  const setTo = k.db.prepare('UPDATE learn_league_group SET to_tier = ? WHERE world_id = ? AND week = ? AND player_id = ?');
  const setRank = k.db.prepare('INSERT INTO learn_rank (player_id, world_id, tier) VALUES (?, ?, ?) ON CONFLICT (player_id, world_id) DO UPDATE SET tier = excluded.tier');
  for (const rows of groups.values()) {
    const st = standings(rows);
    for (const r of rows) { const to = nextTier(r.tier, zoneOf(r.id, st)); setTo.run(to, wid, week, r.id); setRank.run(r.id, wid, to); }
  }
  k.db.prepare('INSERT INTO learn_league_done (world_id, week) VALUES (?, ?)').run(wid, week);
}

// Everything /state needs to be true before it reads: finished weeks settled (oldest first), and this student in a group for this week.
// The one write on the /state path; when there is nothing to do it is two indexed reads.
function ensure(k, user, wid, mon) {
  const open = () => k.db.prepare('SELECT DISTINCT week FROM learn_league_group WHERE world_id = ? AND week < ? AND week NOT IN (SELECT week FROM learn_league_done WHERE world_id = ?) ORDER BY week').all(wid, mon, wid).map((r) => r.week);
  const member = () => k.db.prepare('SELECT 1 FROM learn_league_group WHERE world_id = ? AND week = ? AND player_id = ?').get(wid, mon, user.id);
  if (!open().length && member()) return;
  k.db.txn(() => {
    for (const w of open()) settleWeek(k, wid, w);
    if (member()) return;
    const any = k.db.prepare('SELECT 1 FROM learn_league_group WHERE world_id = ? AND week = ? LIMIT 1').get(wid, mon);
    const put = k.db.prepare('INSERT OR IGNORE INTO learn_league_group (world_id, week, player_id, tier, grp) VALUES (?, ?, ?, ?, ?)');
    if (!any) {                                                               // the first read of the week: every student of the world who has logged in (live classes only) is placed at once; others join when they first look
      const ranks = new Map(k.db.prepare('SELECT player_id, tier FROM learn_rank WHERE world_id = ?').all(wid).map((r) => [r.player_id, r.tier]));
      const players = k.db.prepare("SELECT p.id FROM players p JOIN classes c ON c.id = p.class_id WHERE c.world_id = ? AND c.archived IS NULL AND p.role = 'student' AND p.first_login IS NOT NULL").all(wid)
        .map((r) => ({ id: r.id, tier: ranks.get(r.id) ?? LEAGUE.START }));
      if (!players.some((p) => p.id === user.id)) players.push({ id: user.id, tier: ranks.get(user.id) ?? LEAGUE.START });
      for (const [id, g] of assignGroups(players, wid, mon)) put.run(wid, mon, id, g.tier, g.grp);
    } else {                                                                  // a late arrival joins the smallest group of their rank
      const tier = rankOf(k, user.id, wid);
      const sizes = new Map(k.db.prepare('SELECT grp, COUNT(*) AS n FROM learn_league_group WHERE world_id = ? AND week = ? AND tier = ? GROUP BY grp').all(wid, mon, tier).map((r) => [r.grp, r.n]));
      put.run(wid, mon, user.id, tier, joinGroup(sizes));
    }
  });
}

// /state `league`. Usernames only; a teacher is not in a league (null).
export function leagueOf(k, user, wid) {
  if (user.role !== 'student') return null;
  const mon = mondayOf(k.clock.today());
  ensure(k, user, wid, mon);
  const me = k.db.prepare('SELECT tier, grp FROM learn_league_group WHERE world_id = ? AND week = ? AND player_id = ?').get(wid, mon, user.id);
  const xp = weekXp(k, wid, mon);
  const members = k.db.prepare('SELECT g.player_id AS id, p.username FROM learn_league_group g JOIN players p ON p.id = g.player_id WHERE g.world_id = ? AND g.week = ? AND g.tier = ? AND g.grp = ?')
    .all(wid, mon, me.tier, me.grp).map((r) => ({ id: r.id, username: r.username, xp: xp.get(r.id) ?? 0 }));
  const st = standings(members), byId = new Map(members.map((m) => [m.id, m]));
  const all = st.order.map((id, i) => ({ rank: i + 1, username: byId.get(id).username, xp: byId.get(id).xp, me: id === user.id, zone: zoneFor(me.tier, id, st) }));
  const mine = all.find((r) => r.me), n = all.length;
  const prev = k.db.prepare('SELECT week, tier, to_tier FROM learn_league_group WHERE world_id = ? AND player_id = ? AND to_tier IS NOT NULL ORDER BY week DESC LIMIT 1').get(wid, user.id);
  const last = prev ? { week_start: prev.week, from: slim(tierOf(prev.tier)), to: slim(tierOf(prev.to_tier)),
    moved: tierIndex(prev.to_tier) > tierIndex(prev.tier) ? 'up' : tierIndex(prev.to_tier) < tierIndex(prev.tier) ? 'down' : 'stay', steps: Math.abs(tierIndex(prev.to_tier) - tierIndex(prev.tier)) } : null;
  return { week_start: mon, tier: slim(tierOf(me.tier)), group_size: n,
    rows: all,                                                                // the whole group (up to GROUP_MAX), like Duolingo
    my_rank: mine.rank, promote_line: st.promoteN, podium_line: st.podiumN, demote_line: st.demoteN ? n - st.demoteN + 1 : null, last_result: last };
}

// The teacher roster: Map player id -> rank id (a student with no rank row is in Iron).
export const ranksOf = (k, wid, ids) => new Map(k.db.prepare('SELECT player_id, tier FROM learn_rank WHERE world_id = ? AND player_id IN (SELECT value FROM json_each(?))').all(wid, JSON.stringify(ids)).map((r) => [r.player_id, r.tier]));
