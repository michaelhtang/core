// The world clock. One class day = one in-world month by default. The teacher advances it by hand, or (optionally, per world)
// autoAdvance() does it once per school day after 07:00 local; the server calls that from a timer. Modules subscribe to month
// ticks with onTick(); a module-wide failure undoes the whole advance (per-student work is isolated by k.forEachPlayer, docs/modules.md section 5).
import { withTxn, logAudit } from './db.js';
import { HttpError } from './errors.js';
import { addDays, parseNoSchool } from './clock.js';

const MODES = ['manual', 'school_days'];
const AUTO_HOUR = 7;

export function createWorld(db, app) {
  const hooks = [];
  const { clock } = app;
  let advancing = false;                                                           // true while advance() runs the month ticks
  const latest = db.prepare('SELECT * FROM worlds ORDER BY id DESC LIMIT 1');   // prepared once: modules read the world for every student every month
  const current = () => latest.get();
  const defaultNoSchool = parseNoSchool(app.config?.calendar?.noSchool ?? []);   // config.calendar.noSchool; a bad entry fails boot
  // The world price index (core table price_index, migration 013): rates announces it in module.rates.changed, inside its tick, and the core keeps
  // the latest per world, so the write commits or rolls back with the tick. This listener is registered before any module's, so a module listening
  // to the same event already reads the new index. 10000 (no inflation) for a world rates never announced, or without rates.
  const indexOf = db.prepare('SELECT index_bp FROM price_index WHERE world_id = ?');
  const setIndex = db.prepare('INSERT INTO price_index (world_id, index_bp) VALUES (?, ?) ON CONFLICT (world_id) DO UPDATE SET index_bp = excluded.index_bp');
  app.events?.on('module.rates.changed', (p) => {
    if (Number.isSafeInteger(p?.worldId) && Number.isSafeInteger(p.priceIndexBp) && p.priceIndexBp > 0) setIndex.run(p.worldId, p.priceIndexBp);
  });

  const world = {
    current,
    isAdvancing: () => advancing,
    priceIndex: (worldId = current()?.id) => indexOf.get(worldId ?? -1)?.index_bp ?? 10000,

    // Refused while a season is active. A new season takes every existing class with it; players, PINs and classes carry over, money does not.
    // world.created after commit: student streams re-sync, and /api/me runs onLogin (the welcome grant) for sessions from the last season.
    create({ name = 'Season 1', seasonStart = clock.today(), seasonEnd = addDays(seasonStart, 150), actor = 'system' } = {}) {
      return withTxn(db, (tx) => {
        const prev = current();
        if (prev?.status === 'active') throw new HttpError(409, 'A season is still active. Close it first.');
        // The teacher's no-school days carry into the next season (NULL stays NULL: the config default).
        const id = Number(db.prepare('INSERT INTO worlds (name, season_start, season_end, created, no_school) VALUES (?, ?, ?, ?, ?)').run(name, seasonStart, seasonEnd, clock.now(), prev?.no_school ?? null).lastInsertRowid);
        db.prepare('UPDATE classes SET world_id = ?').run(id);
        logAudit(db, actor, 'world.create', { worldId: id, name });
        tx.onCommit(() => app.events.emit('world.created', { worldId: id }));
        return current();
      });
    },

    // Season close (docs/teachers-seasons.md): record each student's net worth, post every non-zero player and business balance to the sink as
    // core.season_reset (so the ledger stays balanced and auditable), mark the world closed, then each module's seasonClose hook (its
    // own end-of-season cleanup; a throw rolls the whole close back). One transaction; world.closed after commit (hints and per-world tidying only).
    close({ actor = 'system' } = {}) {
      return withTxn(db, (tx) => {
        const w = current();
        if (!w || w.status !== 'active') throw new HttpError(409, 'There is no active season to close');
        db.prepare(`INSERT INTO season_results (world_id, player_id, net_worth_cents)
          SELECT ?, p.id, COALESCE((SELECT SUM(a.balance_cents) FROM accounts a WHERE a.owner_type = 'player' AND a.owner_id = p.id), 0)
          FROM players p WHERE p.role = 'student' AND p.class_id IS NOT NULL`).run(w.id);   // not removed students (lib/players.js detach)
        // Assets that aren't money (a home): each module's seasonAssets hook adds them, in this transaction, before the reset zeroes the accounts.
        const addAsset = db.prepare('UPDATE season_results SET net_worth_cents = net_worth_cents + ? WHERE world_id = ? AND player_id = ?');
        for (const { playerId, cents } of app.modules?.seasonAssets(w.id) ?? []) addAsset.run(cents, w.id, playerId);
        // Every non-system account: players' and businesses' (owner_type 'business', Phase 4). Business money is in no one's season result;
        // a student's stake in a business reaches theirs only as a seasonAssets row of the module that owns the business.
        const sink = app.ledger.system('sink');
        for (const a of db.prepare("SELECT id, balance_cents FROM accounts WHERE owner_type <> 'system' AND balance_cents <> 0 ORDER BY id").all()) {
          app.ledger.post({ kind: 'core.season_reset', actor, meta: { worldId: w.id }, legs: [{ account: a.id, cents: -a.balance_cents, memo: 'Season reset' }, { account: sink, cents: a.balance_cents, memo: 'Season reset' }] });
        }
        db.prepare("UPDATE worlds SET status = 'closed' WHERE id = ?").run(w.id);
        app.modules?.seasonClose(current());
        logAudit(db, actor, 'world.close', { worldId: w.id, name: w.name });
        tx.onCommit(() => app.events.emit('world.closed', { worldId: w.id }));
        return current();
      });
    },

    // fn({ app, month, world, startMonth }) runs once per world month, in registration order, inside the advance transaction.
    // startMonth = the world month when this advance began (the last month students had live): with months 2+ per advance, a module judges
    // lateness only on what was due by then, so nobody is late for a month they never got to play.
    onTick(id, fn) { hooks.push({ id, fn }); },

    // The no-school days auto-advance skips: the world's own list (set by the world teacher), or config.calendar.noSchool while it has none.
    noSchool: (w = current()) => (w?.no_school == null ? defaultNoSchool : JSON.parse(w.no_school)),

    // Any of { months_per_day, auto_advance, no_school }; undefined means leave it, no_school null means back to the config default.
    // Emits world.settings once.
    setSettings({ months_per_day, auto_advance, no_school } = {}, actor = 'system') {
      if (months_per_day === undefined && auto_advance === undefined && no_school === undefined) throw new HttpError(400, 'Nothing to change');
      if (months_per_day !== undefined && (!Number.isInteger(months_per_day) || months_per_day < 1 || months_per_day > 12)) throw new HttpError(400, 'Months per class day must be 1 to 12');
      if (auto_advance !== undefined && !MODES.includes(auto_advance)) throw new HttpError(400, 'auto_advance must be manual or school_days');
      let days;
      if (no_school != null) { try { days = JSON.stringify(parseNoSchool(no_school)); } catch (e) { throw new HttpError(400, e.message); } }
      return withTxn(db, (tx) => {
        const w = current();
        if (!w) throw new HttpError(409, 'No world yet');
        const next = { months_per_day: months_per_day ?? w.months_per_day, auto_advance: auto_advance ?? w.auto_advance };
        db.prepare('UPDATE worlds SET months_per_day = ?, auto_advance = ? WHERE id = ?').run(next.months_per_day, next.auto_advance, w.id);
        if (no_school !== undefined) db.prepare('UPDATE worlds SET no_school = ? WHERE id = ?').run(days ?? null, w.id);
        if (auto_advance !== undefined) db.prepare('UPDATE worlds SET auto_stopped = NULL WHERE id = ?').run(w.id);   // saving the setting acknowledges a stop
        logAudit(db, actor, 'world.settings', { ...next, ...(no_school !== undefined && { no_school: days ? JSON.parse(days) : null }) });
        tx.onCommit(() => app.events.emit('world.settings', { worldId: w.id, ...next }));
        return current();
      });
    },

    setMonthsPerDay: (n, actor) => world.setSettings({ months_per_day: n }, actor),

    advance({ months, from, auto = false, actor = auto ? 'system:auto' : 'system' } = {}) {
      return withTxn(db, (tx) => {
        const w = current();
        if (!w) throw new HttpError(409, 'No world yet');
        if (w.status !== 'active') throw new HttpError(409, 'The season is closed. Start a new one first.');
        if (from !== undefined && from !== w.month) throw new HttpError(409, 'The world already moved on. Refresh and try again.');
        const n = months ?? w.months_per_day;
        if (!Number.isInteger(n) || n < 1 || n > 12) throw new HttpError(400, 'Advance 1 to 12 months at a time');
        const seen = db.prepare('SELECT COALESCE(MAX(id), 0) AS id FROM tick_failures').get().id;
        const students = db.prepare("SELECT COUNT(*) AS n FROM players WHERE role = 'student' AND class_id IN (SELECT id FROM classes WHERE world_id = ?)").get(w.id).n;
        const monthFailures = db.prepare("SELECT module, player_id, error FROM tick_failures WHERE id > ? AND month = ? AND source = 'advance' ORDER BY id");
        advancing = true;
        try {
          for (let i = 0; i < n; i++) {
            const month = current().month + 1;
            db.prepare('UPDATE worlds SET month = ? WHERE id = ?').run(month, w.id);
            for (const h of hooks) h.fn({ app, month, world: current(), startMonth: w.month });
            // Per-student isolation is for one student's data, not for a bug. If one module failed this month for more than half of the
            // world's students (distinct students; listener failures count), or for no student in particular, the whole advance rolls back.
            const by = new Map();
            for (const f of monthFailures.all(seen, month)) {
              const m = by.get(f.module) ?? by.set(f.module, { ids: new Set(), wide: false, first: f.error }).get(f.module);
              if (f.player_id === null) m.wide = true; else m.ids.add(f.player_id);
            }
            for (const [module, m] of by) {
              if (m.wide || m.ids.size * 2 > students) throw new HttpError(500, `${module}: ${m.wide ? 'a failure not tied to one student' : `${m.ids.size} of ${students} students failed`} in month ${month}, so nothing was skipped: ${m.first}`);
            }
          }
        } finally { advancing = false; }
        // In a world on school_days, an advance that skipped anyone (tick_failures) stops auto-advance until the world teacher has looked
        // (docs/clock.md); one that skipped no one restarts a stopped one. Manual advances count for last_advanced_day too.
        const problems = db.prepare('SELECT COUNT(*) AS n FROM tick_failures WHERE id > ?').get(seen).n;
        db.prepare('UPDATE worlds SET last_advanced_day = ?, auto_stopped = ? WHERE id = ?')
          .run(clock.today(), problems && w.auto_advance === 'school_days' ? `the advance to month ${current().month} skipped some work (${problems} problem${problems === 1 ? '' : 's'} listed below)` : null, w.id);
        logAudit(db, actor, 'world.advance', { months: n, to: current().month, ...(auto && { auto: true }) });
        const now = current();
        tx.onCommit(() => app.events.emit('world.month', { from: w.month, month: now.month, worldId: w.id }));
        return now;
      });
    },

    // The timer body: advance once if this world is on school_days, today is a school day (not on its no-school list), the season has
    // not reached season_end (from then on only the teacher advances, by hand), it is past 07:00 local, and today has
    // not been advanced yet (by this timer, before a restart, or by hand). Returns the world after advancing, or null.
    // An advance that fails (the whole transaction rolled back) stops it: the error goes in worlds.auto_stopped and the timer does nothing
    // until the world teacher advances by hand or saves the auto-advance setting again, so the same failure is not retried every 5 minutes.
    // An advance that commits but skipped some students sets auto_stopped too (in advance(), above).
    autoAdvance() {
      const w = current();
      const today = clock.today();
      if (!w || w.status !== 'active' || w.auto_advance !== 'school_days' || w.auto_stopped || today >= w.season_end || !clock.isSchoolDay(today, world.noSchool(w)) || clock.hour() < AUTO_HOUR || w.last_advanced_day === today) return null;
      try { return world.advance({ from: w.month, auto: true }); } catch (e) {
        const why = String(e?.message ?? e).slice(0, 500);
        withTxn(db, (tx) => {
          db.prepare('UPDATE worlds SET auto_stopped = ? WHERE id = ?').run(why, w.id);
          logAudit(db, 'system:auto', 'world.auto_stopped', { month: w.month, error: why });
          tx.onCommit(() => app.events.emit('world.settings', { worldId: w.id, months_per_day: w.months_per_day, auto_advance: w.auto_advance }));   // consoles refetch
        });
        throw e;
      }
    },
  };
  return world;
}
