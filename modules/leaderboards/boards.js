// leaderboards: board, class table, awards and award lines (the ranked reads).
import { BOARD_SIZE, COMEBACK_WINDOW, AWARD_NAMES } from './constants.js';
import { tierName, ranked, median, roundNet } from './health.js';
import { stmt, byNet, byHealth, netOf, healthOf, rowsAt } from './snapshot.js';

// ---- boards ----
export const nameOf = (k, cache) => (id) => cache.get(id) ?? (cache.set(id, k.players.get(id)?.username ?? 'unknown'), cache.get(id));

// One ranked list (a class when `classId` is given, else the town). Rows are trimmed to the public fields: no balance, debt or bill ever leaves here.
export function board(k, { rows, prev, metric, classId, viewerId, hidden, name, limit = BOARD_SIZE }) {
  const cmp = metric === 'net' ? byNet : byHealth, by = metric === 'net' ? netOf : healthOf;
  const scope = (rs) => (classId == null ? rs : rs.filter((r) => r.class_id === classId)).sort(cmp);
  const cur = scope([...rows]), now = ranked(cur, by);
  const old = scope([...prev]), then = new Map(ranked(old, by).map((rank, i) => [old[i].player_id, rank]));
  const line = (r, i) => ({
    rank: now[i], name: name(r.player_id), tier: tierName(r.tier), mine: r.player_id === viewerId,
    delta: then.has(r.player_id) ? then.get(r.player_id) - now[i] : null,   // places climbed since last month (positive = up)
    ...(metric === 'net' ? { net_worth_cents: hidden ? null : roundNet(r.net_worth) } : { health: r.health }),
  });
  const at = cur.findIndex((r) => r.player_id === viewerId);
  return { size: cur.length, top: cur.slice(0, limit).map(line), me: at < 0 ? null : line(cur[at], at) };
}

// shown: class ids whose amounts are given even when hidden (the teacher's own classes).
export function classTable(k, rows, viewerClass, hidden, shown = new Set()) {
  const names = new Map(k.players.classes().map((c) => [c.id, c.name]));
  const groups = new Map();
  for (const r of rows) (groups.get(r.class_id) ?? groups.set(r.class_id, []).get(r.class_id)).push(r);
  const list = [...groups].map(([id, rs]) => ({ id, name: names.get(id) ?? 'Class', size: rs.length, mine: id === viewerClass, net: median(rs.map(netOf)), health: median(rs.map(healthOf)) }));
  const rankBy = (key) => { const s = [...list].sort((a, b) => b[key] - a[key] || a.id - b.id); return new Map(ranked(s, (c) => c[key]).map((rank, i) => [s[i].id, rank])); };
  const rn = rankBy('net'), rh = rankBy('health');
  return list.sort((a, b) => rn.get(a.id) - rn.get(b.id) || a.id - b.id).map((c) => ({
    name: c.name, size: c.size, mine: c.mine, rank_net: rn.get(c.id), rank_health: rh.get(c.id),
    median_net_worth_cents: hidden && !shown.has(c.id) ? null : roundNet(c.net), median_health: Math.round(c.health),
  }));
}

// The four awards at `month` (live for the teacher's "leaders", final at season close).
export function awardsAt(k, worldId, month) {
  const rows = rowsAt(k, worldId, month);
  if (!rows.length) return [];
  const out = [];
  const top = [...rows].sort(byNet)[0];
  out.push({ award: 'wolf', player_id: top.player_id, class_id: top.class_id, value: roundNet(top.net_worth) });
  const fit = [...rows].sort(byHealth)[0];
  out.push({ award: 'healthiest', player_id: fit.player_id, class_id: fit.class_id, value: fit.health });
  const first = stmt(k, 'SELECT MIN(month) AS m FROM leaderboards_snapshots WHERE world_id = ?').get(worldId).m;
  const base = Math.max(first, month - COMEBACK_WINDOW);
  if (base < month) {
    const was = new Map(rowsAt(k, worldId, base).map((r) => [r.player_id, r.rank_town]));
    const climbs = rows.filter((r) => was.has(r.player_id)).map((r) => ({ ...r, climb: was.get(r.player_id) - r.rank_town })).filter((r) => r.climb > 0)
      .sort((a, b) => b.climb - a.climb || a.rank_town - b.rank_town || a.player_id - b.player_id);
    if (climbs.length) out.push({ award: 'comeback', player_id: climbs[0].player_id, class_id: climbs[0].class_id, value: climbs[0].climb });
  }
  const groups = new Map();
  for (const r of rows) (groups.get(r.class_id) ?? groups.set(r.class_id, []).get(r.class_id)).push(r);
  const packs = [...groups].map(([id, rs]) => ({ id, health: median(rs.map(healthOf)), net: median(rs.map(netOf)) }))
    .sort((a, b) => b.health - a.health || b.net - a.net || a.id - b.id);
  out.push({ award: 'pack', player_id: null, class_id: packs[0].id, value: Math.round(packs[0].health) });
  // Founder of the Season (Phase 4): the founder of the most valuable company (book value, from module.ventures.value), ties to the bigger stake
  const lead = stmt(k, 'SELECT player_id, ventures_company FROM leaderboards_inputs WHERE world_id = ? AND ventures_company > 0 ORDER BY ventures_company DESC, ventures_value DESC, player_id LIMIT 1').get(worldId);
  const at = lead && rows.find((r) => r.player_id === lead.player_id);
  if (at) out.push({ award: 'founder', player_id: lead.player_id, class_id: at.class_id, value: roundNet(lead.ventures_company) });
  // Best Employer (Phase 4 wave 4b): a founder or shareholder of the company with the most staff and no missed payroll this season (ties: more
  // on-time pays, then the bigger company), from module.ventures.value { staff, paydays, missedPaydays }
  const boss = stmt(k, `SELECT player_id, ventures_staff FROM leaderboards_inputs WHERE world_id = ? AND ventures_staff > 0 AND ventures_missed = 0
    ORDER BY ventures_staff DESC, ventures_paydays DESC, ventures_company DESC, ventures_value DESC, player_id LIMIT 1`).get(worldId);
  const bat = boss && rows.find((r) => r.player_id === boss.player_id);
  if (bat) out.push({ award: 'employer', player_id: boss.player_id, class_id: bat.class_id, value: boss.ventures_staff });
  // Best Retirement (5c): the class whose students' savings last longest: the median of the retirement module's last projection (lasts_age, 90 or more counts
  // as 90), then the median uncapped income / bills ratio, then median net worth (class medians, as Top Pack). Only classes with a retirement check.
  const ret = new Map(stmt(k, 'SELECT player_id, lasts_age, coverage_bp FROM leaderboards_inputs WHERE world_id = ? AND lasts_age IS NOT NULL').all(worldId).map((r) => [r.player_id, r]));
  const cov = [...groups].map(([id, rs]) => ({ id, rs: rs.filter((r) => ret.has(r.player_id)), net: median(rs.map(netOf)) })).filter((c) => c.rs.length)
    .map((c) => ({ ...c, lasts: median(c.rs.map((r) => Math.min(90, ret.get(r.player_id).lasts_age))), ratio: median(c.rs.map((r) => ret.get(r.player_id).coverage_bp ?? 0)) }))
    .sort((a, b) => b.lasts - a.lasts || b.ratio - a.ratio || b.net - a.net || a.id - b.id);
  if (cov.length) out.push({ award: 'retirement', player_id: null, class_id: cov[0].id, value: Math.round(cov[0].lasts) });
  return out;
}

export const awardLine = (k, a, hidden, names) => ({
  award: a.award, title: AWARD_NAMES[a.award], name: a.player_id == null ? null : names(a.player_id),
  class_name: k.players.classes().find((c) => c.id === a.class_id)?.name ?? null,
  value: (a.award === 'wolf' || a.award === 'founder') && hidden ? null : a.value,
  unit: { wolf: 'net worth', healthiest: 'health score', comeback: 'places climbed', pack: 'median health', founder: 'company value', employer: 'staff', retirement: 'median age savings last (90 = 90 or more)' }[a.award],
});
