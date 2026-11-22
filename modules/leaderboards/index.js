// leaderboards: the Amphitheatre (docs/leaderboards.md). Net worth and financial-health boards for a class and for the town, class-vs-class
// medians, Wolf ranks (Pup ... Alpha, a header chip through the core `badges` hook), a season finale (awards, Hall of Fame, Life Review).
// Inputs are the ledger API (a student's own accounts) and events only; this module reads no other module's tables, and a test greps for that.
// It loads LAST in config, so its onTick snapshot is month-end: after jobs paid, bills were issued, savings paid interest.
//
// Files: snapshot.js (shared reads, input writers, the month-end snapshot), boards.js (boards, class table, awards),
// finale.js (season finale, Life Review, Hall of Fame, rank-ups), migrations.js (tables), constants.js, health.js, flags.js, ui/.
import { defineModule } from '../../lib/modules.js';
import { ok } from '../../lib/kernel.js';
import { TIERS, GOUGE_PCT } from './constants.js';
import { tierName, tipFor, roundNet } from './health.js';
import { flags } from './flags.js';
import { migrations } from './migrations.js';
import { stmt, settingsOf, latestMonth, boardMonth, rowsAt, setInput, addOnTime, addLate, wid, thresholdsAt, tick } from './snapshot.js';
import { nameOf, board, classTable, awardsAt, awardLine } from './boards.js';
import { finale, hallOf, unseenRankUp } from './finale.js';

const ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="9" y="9" width="6" height="11"/><rect x="3" y="13" width="6" height="7"/><rect x="15" y="15" width="6" height="5"/><path d="M12 2.500l1.100 2.200 2.400.3-1.800 1.600.5 2.400-2.200-1.200-2.200 1.200.5-2.400-1.800-1.600 2.400-.3z"/></svg>';

export default defineModule({
  id: 'leaderboards',
  options: { tiers: 'Wolf rank threshold overrides' },
  requires: ['bank-basic'],
  services: { settings: (k, { worldId }) => ({ hide_amounts: settingsOf(k, worldId).hide_amounts === 1 }) },   // the feed honours it (docs/phase6-roles.md 6a)

  migrations,

  events: {
    'module.jobs.paid': (k, p) => {
      if (!ok(p?.playerId) || !ok(p.net) || !ok(p.gross) || !ok(p.month)) return;
      setInput(k, wid(k, p), p.playerId, { net_cents: p.net, gross_cents: p.gross, pay_month: p.month });
    },
    'module.bills.paid': (k, p) => {
      if (ok(p?.playerId) && p.onTime === true && !String(p.billId).startsWith('late-fee-')) addOnTime(k, wid(k, p), p.playerId, 1);   // a late payment was counted when it went late
    },
    'module.bills.late': (k, p) => {
      if (ok(p?.playerId) && ok(p.month) && ok(p.monthsLate) && !String(p.billId).startsWith('late-fee-')) addLate(k, wid(k, p), p.playerId, `b:${p.billId}:${p.month - p.monthsLate}`);
    },
    // kind 'mortgage': one per home (total = the month's payments over all the student's homes, 6b); kind 'rent' (6b): a tenant's rent month to a
    // classmate, on time or late for the tenant like a bill, and a month "with a tenant" for the landlord's rent-gouger count when the rent is >= 140% of the NPC tier.
    'module.housing.payment': (k, p) => {
      if (!ok(p?.playerId) || !ok(p.month) || !ok(p.amount) || (p.kind !== 'mortgage' && p.kind !== 'rent')) return;
      const w = wid(k, p);
      if (p.kind === 'rent') {
        if (p.onTime) addOnTime(k, w, p.playerId, 1); else addLate(k, w, p.playerId, `r:${p.month}`);
        if (ok(p.landlordId) && ok(p.rentCents) && ok(p.npcCents) && p.npcCents > 0 && p.rentCents * 100 >= p.npcCents * GOUGE_PCT) {
          stmt(k, 'INSERT INTO leaderboards_inputs (world_id, player_id, gouge_months) VALUES (?, ?, 1) ON CONFLICT (world_id, player_id) DO UPDATE SET gouge_months = gouge_months + 1').run(w, p.landlordId);
        }
        return;
      }
      setInput(k, w, p.playerId, { mortgage_payment: ok(p.total) && p.total >= p.amount ? p.total : p.amount });
      if (p.onTime) addOnTime(k, w, p.playerId, 1); else addLate(k, w, p.playerId, ok(p.homeId) && p.role === 'rental' ? `m:${p.month}:${p.homeId}` : `m:${p.month}`);
    },
    'module.stress.payment': (k, p) => {   // an emergency loan payment counts like a mortgage one
      if (!ok(p?.playerId) || !ok(p.month)) return;
      const w = wid(k, p);
      if (p.onTime) addOnTime(k, w, p.playerId, 1); else addLate(k, w, p.playerId, `l:${p.month}`);
    },
    'module.housing.value': (k, p) => { if (ok(p?.playerId) && ok(p.homeValue) && p.homeValue >= 0) setInput(k, wid(k, p), p.playerId, { home_value: p.homeValue }); },
    'module.exchange.value': (k, p) => { if (ok(p?.playerId) && ok(p.holdings) && p.holdings >= 0) setInput(k, wid(k, p), p.playerId, { exchange_value: p.holdings }); },
    'module.ventures.value': (k, p) => {
      if (!ok(p?.playerId) || !ok(p.stake) || p.stake < 0 || !ok(p.companyValue) || p.companyValue < 0) return;
      setInput(k, wid(k, p), p.playerId, { ventures_value: p.stake, ventures_company: p.companyValue, ...(ok(p.staff) && ok(p.paydays) && ok(p.missedPaydays) && { ventures_staff: p.staff, ventures_paydays: p.paydays, ventures_missed: p.missedPaydays }) });
    },
    'module.credit.score': (k, p) => { if (ok(p?.playerId) && ok(p.score)) setInput(k, wid(k, p), p.playerId, { score: p.score }); },
    // A statement that was waiting is judged at the next statement event: counted on time here; a missed minimum posts credit.late_fee, which flips it below.
    'module.credit.statement': (k, p) => {
      if (!ok(p?.playerId) || !ok(p.minimum)) return;
      const w = wid(k, p);
      const was = stmt(k, 'SELECT last_min FROM leaderboards_inputs WHERE world_id = ? AND player_id = ?').get(w, p.playerId)?.last_min ?? 0;
      if (was > 0) addOnTime(k, w, p.playerId, 1);
      setInput(k, w, p.playerId, { last_min: p.minimum });
    },
    'module.retirement.coverage': (k, p) => {
      if (ok(p?.playerId) && ok(p.coverage) && p.coverage >= 0 && p.coverage <= 100 && ok(p.lastsUntilAge)) setInput(k, wid(k, p), p.playerId, { coverage: p.coverage, lasts_age: p.lastsUntilAge, coverage_bp: ok(p.ratioBp) && p.ratioBp >= 0 ? p.ratioBp : null });
    },
    'module.stress.score': (k, p) => { if (ok(p?.playerId) && ok(p.score) && p.score >= 0 && p.score <= 100) setInput(k, wid(k, p), p.playerId, { stress: p.score }); },
    'module.stress.loan': (k, p) => {
      if (ok(p?.playerId)) stmt(k, 'INSERT INTO leaderboards_inputs (world_id, player_id, loans) VALUES (?, ?, 1) ON CONFLICT (world_id, player_id) DO UPDATE SET loans = loans + 1').run(wid(k, p), p.playerId);
    },
    'ledger.posted': (k, p) => {
      const w = k.world.current()?.id;
      if (p?.kind === 'exchange.contribute') {                                      // money into an investment account, TFSA or RRSP (the "never invested" flag)
        for (const o of p.owners ?? []) if (o.type === 'player' && ok(o.id) && w) setInput(k, w, o.id, { invested: 1 });
        return;
      }
      if (p?.kind !== 'credit.late_fee') return;
      for (const o of p.owners ?? []) if (o.type === 'player' && ok(o.id) && w) { addOnTime(k, w, o.id, -1); addLate(k, w, o.id, `c:${p.txnId}`); }
    },
  },

  // The finale (awards, Hall of Fame, Life Reviews) is written inside the close transaction, from the snapshots: a failure fails the close.
  seasonClose: (k, { world }) => finale(k, world.id),

  panels: [{ id: 'amphitheatre', building: { key: 'amphitheatre', name: 'Amphitheatre', icon: ICON }, src: 'leaderboards.js' }],
  teacherPanels: [{ id: 'leaderboards-teach', title: 'Amphitheatre', src: 'teach.js' }],

  onTick: tick,

  // The Wolf rank chip, and a one-time "Ranked up" chip until the student opens the Amphitheatre.
  badges(k, user) {
    const w = k.world.current();
    if (!w) return [];
    const month = boardMonth(k, w.id);
    const tier = month == null ? 0 : stmt(k, 'SELECT tier FROM leaderboards_snapshots WHERE world_id = ? AND player_id = ? AND month = ?').get(w.id, user.id, month)?.tier ?? 0;
    const out = [{ text: `Wolf: ${tierName(tier)}`, title: 'Your Wolf rank, from your net worth. See the Amphitheatre.' }];
    const up = month == null ? null : unseenRankUp(k, w.id, user.id, month);
    if (up) out.push({ text: `Ranked up: ${up}!`, title: 'Open the Amphitheatre to celebrate.' });
    return out;
  },

  routes: [
    {
      method: 'GET', path: '/board', access: 'student',
      handler(k, { user }) {
        const w = k.world.current();
        const set = settingsOf(k, w.id);
        const hidden = set.hide_amounts === 1;
        const month = boardMonth(k, w.id);
        const review = stmt(k, 'SELECT season, data FROM leaderboards_reviews WHERE player_id = ? ORDER BY world_id DESC LIMIT 1').get(user.id);
        const out = {
          month: month ?? null, season: w.name, hidden, frozen: set.frozen_month != null, tiers: TIERS,
          last_season: review ? { season: review.season, ...JSON.parse(review.data) } : null,
        };
        if (month == null) return { ...out, empty: true };
        const rows = rowsAt(k, w.id, month), prev = rowsAt(k, w.id, month - 1);
        const mine = rows.find((r) => r.player_id === user.id);
        const name = nameOf(k, new Map());
        const args = (metric, classId) => ({ rows, prev, metric, classId, viewerId: user.id, hidden, name });
        const parts = mine ? JSON.parse(mine.parts) : null;
        const thr = thresholdsAt(k, w.id, month);
        return {
          ...out,
          net: { class: board(k, args('net', user.class_id)), town: board(k, args('net', null)) },
          health: { class: board(k, args('health', user.class_id)), town: board(k, args('health', null)) },
          classes: classTable(k, rows, user.class_id, hidden),
          me: mine && {
            tier: tierName(mine.tier), tier_index: mine.tier, health: mine.health, parts, tip: tipFor(parts),
            next: mine.tier >= TIERS.length - 1 ? null : { name: tierName(mine.tier + 1), at_cents: hidden ? null : roundNet(thr[mine.tier]) },
            rank_up: unseenRankUp(k, w.id, user.id, month),
          },
        };
      },
    },
    {
      method: 'POST', path: '/ack', access: 'student',   // the student has read their rank-up
      handler(k, { user }) {
        const w = k.world.current();
        stmt(k, 'UPDATE leaderboards_rankups SET seen = 1 WHERE world_id = ? AND player_id = ? AND seen = 0 AND month <= ?').run(w.id, user.id, boardMonth(k, w.id) ?? -1);   // only what the boards show
        return { ok: true };
      },
    },
    {
      method: 'GET', path: '/hall', access: 'student',
      handler(k) { return { seasons: hallOf(k) }; },
    },

    // ---- teacher ----
    {
      method: 'GET', path: '/teach', access: 'teacher',
      handler(k, { user }) {
        const w = k.world.current();
        const set = settingsOf(k, w.id);
        const month = boardMonth(k, w.id);
        const out = { season: w.name, month: month ?? null, hidden: set.hide_amounts === 1, frozen: set.frozen_month != null, can_set: k.policy.can(user, 'world.settings'), hall: hallOf(k) };
        if (month == null) return { ...out, classes: [], town: [], leaders: [], class_table: [] };
        const rows = rowsAt(k, w.id, month), prev = rowsAt(k, w.id, month - 1);
        const name = nameOf(k, new Map());
        const mine = k.players.classesFor(user);
        const own = new Set(mine.map((c) => c.id)), hide = set.hide_amounts === 1;
        // A whole class (every student) with both ranks. Teachers see rounded amounts for their own classes whatever the students'
        // setting; other classes' amounts (medians, the Wolf leader's net worth) only as students would see them.
        const classBoard = (classId) => {
          const a = { rows, prev, classId, viewerId: -1, hidden: false, name, limit: Infinity };
          const health = new Map(board(k, { ...a, metric: 'health' }).top.map((r) => [r.name, r]));
          return board(k, { ...a, metric: 'net' }).top.map((r) => ({ ...r, health: health.get(r.name)?.health, health_rank: health.get(r.name)?.rank }));
        };
        const town = board(k, { rows, prev, metric: 'net', classId: null, viewerId: -1, hidden: true, name }).top;   // pseudonyms only: no amounts
        return {
          ...out,
          classes: mine.map((c) => ({ id: c.id, name: c.name, rows: classBoard(c.id) })),
          town: town.map(({ net_worth_cents, ...r }) => r),
          class_table: classTable(k, rows, -1, hide, own),
          leaders: awardsAt(k, w.id, month).map((a) => awardLine(k, a, hide && !own.has(a.class_id), name)),
        };
      },
    },
    {
      method: 'GET', path: '/flags', access: 'teacher',   // the pattern flags of one of your classes, live (the same function the season close stores)
      handler(k, { user, url }) {
        const classId = k.input.idParam(url?.searchParams.get('class_id'));
        const c = k.players.classesFor(user).find((x) => x.id === classId);
        if (!c) throw new k.HttpError(404, 'Not found');
        const w = k.world.current();
        if (!w) throw new k.HttpError(409, 'No season yet');
        return { class_id: c.id, name: c.name, month: latestMonth(k, w.id), students: k.players.inClass(c.id).map((s) => ({ username: s.username, flags: flags(k, { worldId: w.id, playerId: s.id }) })) };
      },
    },
    {
      method: 'POST', path: '/hide', access: 'teacher',
      handler(k, { user, body }) {
        k.policy.assert(user, 'world.settings');
        const hide = k.input.bool(body, 'hide_amounts');
        const w = k.world.current();
        k.db.txn((tx) => {
          stmt(k, 'INSERT INTO leaderboards_settings (world_id, hide_amounts) VALUES (?, ?) ON CONFLICT (world_id) DO UPDATE SET hide_amounts = excluded.hide_amounts').run(w.id, hide ? 1 : 0);
          k.audit('hide', { worldId: w.id, hide_amounts: hide }, `player:${user.id}`);
          tx.onCommit(() => k.events.emit('settings', { worldId: w.id }));
        });
        return { ok: true, hidden: hide };
      },
    },
    {
      method: 'POST', path: '/freeze', access: 'teacher',
      handler(k, { user, body }) {
        k.policy.assert(user, 'world.settings');
        const freeze = k.input.bool(body, 'freeze');
        const w = k.world.current();
        const month = freeze ? latestMonth(k, w.id) : null;
        if (freeze && month == null) throw new k.HttpError(409, 'There is no snapshot to freeze yet. Advance a month first.');
        k.db.txn((tx) => {
          stmt(k, 'INSERT INTO leaderboards_settings (world_id, frozen_month) VALUES (?, ?) ON CONFLICT (world_id) DO UPDATE SET frozen_month = excluded.frozen_month').run(w.id, month);
          k.audit('freeze', { worldId: w.id, frozen_month: month }, `player:${user.id}`);
          tx.onCommit(() => k.events.emit('settings', { worldId: w.id }));
        });
        return { ok: true, frozen: freeze, month };
      },
    },
  ],
});
