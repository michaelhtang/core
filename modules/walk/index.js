// walk: "Town Walk", a top-down pixel town where the student walks around, picks up six items and enters building doors (docs/walk.md).
// Same pattern as arcade: the browser walks a fixed-step, integer-only core (ui/town/town-core.js) and records its inputs as a change list;
// /finish replays those inputs through the very same file with the seed the server chose at /start and counts the items itself. The API takes
// no collected count, so a client cannot claim one. One Today errand listens for module.walk.collected. No stress, wage or ledger effect.
// A visit is one row of walk_runs: open -> finished | rejected | expired | superseded (a new /start replaces an open one).
// The wall-time check is a bot-batch guard only; the count comes from the replay alone.
// Presence (POST /pos, /leave): classmates on the screen see each other. In memory only, cosmetic, no money, never in the replay (docs/walk.md).
import { randomBytes } from 'node:crypto';
import { defineModule } from '../../lib/modules.js';
import { createThrottle } from '../../lib/throttle.js';
import { C, placeItems, replay } from './ui/town/town-core.js';

const ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="5" r="2.5"/><path d="M12 8v6M12 10l-4 3M12 10l4 3M12 14l-3 7M12 14l3 7"/></svg>';
const EXPIRES_MS = 15 * 60e3, MIN_PLAY_PCT = 40, MIN_COLLECTED = 3, SESSION = /^[0-9a-f]{32}$/;
const ok = Number.isSafeInteger;
const TTL_MS = 10e3, MIN_POST_MS = 200, EMOTE_MS = 2500, MAX_SHOWN = 40, MAX_ROSTER = 100;      // presence: an entry lives 10 s after its last post; one post per 200 ms per player
const POS_KEYS = new Set(['x', 'y', 'dir', 'emote']);

const throttles = new WeakMap();
const throttleFor = (k) => {   // ponytail: in memory, per kernel; a restart forgets it (a start only costs a row)
  if (!throttles.has(k)) throttles.set(k, createThrottle({ now: k.clock.now, ip: k.config.startsPerHour ?? 12, ipWindowMs: 3600e3 }));
  return throttles.get(k);
};

// ticks: whole number 1..MAX_TICKS. inputs: [[tick, mask], ...] whole numbers, strictly increasing ticks in 0..ticks-1, masks 0-15, at most MAX_INPUTS.
function parseFinish(k, body) {
  const { MAX_TICKS, MAX_INPUTS } = C;
  const { ticks, inputs } = body;
  if (!ok(ticks) || ticks < 1 || ticks > MAX_TICKS) throw new k.HttpError(400, `ticks must be a whole number from 1 to ${MAX_TICKS}`);
  if (!Array.isArray(inputs) || inputs.length > MAX_INPUTS) throw new k.HttpError(400, `inputs must be a list of at most ${MAX_INPUTS} [tick, mask] pairs`);
  let last = -1;
  for (const e of inputs) {
    if (!Array.isArray(e) || e.length !== 2 || !ok(e[0]) || !ok(e[1])) throw new k.HttpError(400, 'each input must be [tick, mask] with whole numbers');
    if (e[0] <= last || e[0] >= ticks) throw new k.HttpError(400, 'input ticks must increase and stay below ticks');
    if (e[1] < 0 || e[1] > 15) throw new k.HttpError(400, 'input masks must be 0 to 15');
    last = e[0];
  }
  return { ticks, inputs };
}

// ---- presence (docs/walk.md "As built (presence)"): cosmetic, in memory only, never in the database ----
// st.byClass: classId -> Map(playerId -> { u, x, y, d, e, emoteUntil, seen, quiet }). One timer runs only while there is an entry.
const presences = new WeakMap();
const presenceOf = (k) => {
  if (!presences.has(k)) presences.set(k, { byClass: new Map(), dirty: new Set(), sentAt: new Map(), roster: new Set(), timer: null });
  return presences.get(k);
};
// Effective switch for a class: the teacher's row in walk_class_settings (migration 002) when there is one, else options.walk.presence (default on).
const presenceFor = (k, classId) => {
  const row = ok(classId) ? k.db.prepare('SELECT presence FROM walk_class_settings WHERE class_id = ?').get(classId) : undefined;
  return row ? row.presence === 1 : k.config.presence !== false;
};
// The teachers of a class see who is on the map: walk.roster {class_id, count, players} goes to them only when someone joins or leaves (never per move).
const rosterOf = (st, classId) => [...(st.byClass.get(classId)?.values() ?? [])].map((e) => e.u).sort();
const flushRoster = (k, st) => {
  for (const classId of st.roster) {
    st.roster.delete(classId);
    try {
      const teachers = k.db.prepare('SELECT teacher_id FROM class_teachers WHERE class_id = ?').all(classId).map((r) => r.teacher_id);   // core table, read only
      const players = rosterOf(st, classId);
      if (teachers.length) k.push(teachers, 'walk.roster', { class_id: classId, count: players.length, players: players.slice(0, MAX_ROSTER) }, { skippable: true });
    } catch (err) { k.log.error('roster push failed', err); }
  }
};
const pushTick = (k, st) => {
  const now = k.clock.now(), w = k.world.current();
  const live = w?.status === 'active';
  for (const [classId, mates] of st.byClass) {
    for (const [pid, e] of mates) {
      if (!live || now - e.seen > TTL_MS) { mates.delete(pid); st.dirty.add(classId); st.roster.add(classId); }
      else if (e.e && now >= e.emoteUntil) { e.e = 0; st.dirty.add(classId); }
    }
    if (!mates.size) { st.byClass.delete(classId); st.dirty.delete(classId); st.sentAt.delete(classId); continue; }
    if (!st.dirty.has(classId) && now - (st.sentAt.get(classId) ?? 0) < TTL_MS / 3) continue;   // nothing moved: a keepalive every ~3 s so nobody times out
    st.dirty.delete(classId); st.sentAt.set(classId, now);
    const all = [...mates].sort((a, b) => (a[1].u < b[1].u ? -1 : 1));
    for (const [pid, me] of mates) {
      const others = all.filter(([id]) => id !== pid).slice(0, MAX_SHOWN).map(([, o]) => ({ u: o.u, x: o.x, y: o.y, d: o.d, e: o.e }));   // never yourself, at most 40 others
      if (!others.length && me.quiet) continue;                               // alone and already told so
      me.quiet = !others.length;
      try { k.push([pid], 'walk.presence', { players: others }, { skippable: true }); } catch (err) { k.log.error('presence push failed', err); }
    }
  }
  flushRoster(k, st);
  if (!st.byClass.size && st.timer) { clearInterval(st.timer); st.timer = null; }
};
const startPresence = (k, st) => {
  if (st.timer) return;
  st.timer = setInterval(() => { try { pushTick(k, st); } catch (err) { k.log.error('presence tick failed', err); } }, Math.max(20, Number(k.config.presenceTickMs) || 500));   // never a tight spin
  st.timer.unref();
};
const dropPresence = (k, playerId) => {
  const st = presenceOf(k);
  for (const [classId, mates] of st.byClass) if (mates.delete(playerId)) { st.dirty.add(classId); st.roster.add(classId); }
};

const bestOf = (k, playerId, worldId) => k.db.prepare("SELECT MAX(collected) AS best, COUNT(*) AS visits FROM walk_runs WHERE player_id = ? AND world_id = ? AND status = 'finished'").get(playerId, worldId);

export default defineModule({
  id: 'walk',
  requires: ['bank-basic'],
  options: {
    startsPerHour: 'visits one student may start per hour (default 12)',
    presence: 'boolean, default true: students on the Town Walk see classmates of their own class who are on it too (docs/walk.md); false = off, nothing is broadcast',
    presenceTickMs: 'how often presence snapshots go out, milliseconds (default 500; tests use a small one)',
  },

  // A presence entry goes with its player's session, and every timer stops when the server closes (server.js emits app.closing).
  events: {
    'session.revoked': (k, { playerId }) => { if (ok(playerId)) dropPresence(k, playerId); },
    'app.closing': (k) => { const st = presenceOf(k); clearInterval(st.timer); st.timer = null; st.byClass.clear(); st.dirty.clear(); st.roster.clear(); },
  },

  migrations: [{ id: '001_runs', sql: `
CREATE TABLE walk_runs (          -- one row per started visit; collected is the server's replay result, set at finish
  id TEXT PRIMARY KEY, player_id INTEGER NOT NULL REFERENCES players(id), world_id INTEGER NOT NULL REFERENCES worlds(id),
  seed INTEGER NOT NULL, ticks INTEGER, collected INTEGER,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','finished','rejected','expired','superseded')),
  flag TEXT,                      -- why a finish was rejected ('fast')
  started_at INTEGER NOT NULL, finished_at INTEGER
);
CREATE INDEX walk_runs_player ON walk_runs(player_id, world_id, status)` },
  { id: '002_class_settings', sql: `
CREATE TABLE walk_class_settings (  -- a teacher's presence switch for one class; no row = options.walk.presence (default on)
  class_id INTEGER PRIMARY KEY REFERENCES classes(id), presence INTEGER NOT NULL CHECK (presence IN (0, 1)), changed_at INTEGER NOT NULL
)` }],

  teacherPanels: [{ id: 'walk-teach', title: 'Town Walk', src: 'teach.js' }],

  panels: [{ id: 'walk', building: { key: 'walk', name: 'Town Walk', icon: ICON }, src: 'walk.js' }],

  routes: [
    {
      method: 'GET', path: '/state', access: 'student',   // cheap and read-only
      handler(k, { user }) {
        const w = k.world.current();
        const active = w?.status === 'active';
        const mine = active ? bestOf(k, user.id, w.id) : { best: null, visits: 0 };
        return { world_active: active, my_best: mine.best, visits: mine.visits, items: C.ITEMS, max_ticks: C.MAX_TICKS, presence: presenceFor(k, user.class_id) };
      },
    },
    {
      method: 'POST', path: '/start', access: 'student',
      handler(k, { user }) {
        const w = k.world.active();                                           // 409 between seasons
        throttleFor(k).reserve(`p${user.id}`, '', { teacher: true });         // 429 over startsPerHour
        const id = randomBytes(16).toString('hex'), seed = randomBytes(4).readUInt32BE();
        k.db.txn(() => {
          k.db.prepare("UPDATE walk_runs SET status = 'superseded' WHERE player_id = ? AND status = 'open'").run(user.id);
          k.db.prepare('INSERT INTO walk_runs (id, player_id, world_id, seed, started_at) VALUES (?, ?, ?, ?, ?)').run(id, user.id, w.id, seed, k.clock.now());
        });
        return { session: id, seed, max_ticks: C.MAX_TICKS, items: placeItems(seed) };   // the client does not need to re-derive them; the server never trusts what it sends back
      },
    },
    {
      method: 'POST', path: '/finish', access: 'student',
      handler(k, { user, body }) {
        const sid = k.input.str(body, 'session', { max: 40 });
        if (!SESSION.test(sid)) throw new k.HttpError(400, 'session must be the id from /start');
        const run = k.db.prepare('SELECT * FROM walk_runs WHERE id = ?').get(sid);
        if (!run || run.player_id !== user.id) throw new k.HttpError(404, 'Visit not found');
        const w = k.world.active();
        if (run.status !== 'open') throw new k.HttpError(409, run.status === 'finished' ? 'That visit was already finished.' : 'That visit is over. Start a new one.');
        const now = k.clock.now();
        if (run.world_id !== w.id || now - run.started_at > EXPIRES_MS) {
          k.db.prepare("UPDATE walk_runs SET status = 'expired' WHERE id = ? AND status = 'open'").run(sid);
          throw new k.HttpError(409, 'That visit ran out of time. Start a new one.');
        }
        const { ticks, inputs } = parseFinish(k, body);                       // a malformed body is a 400 and does not burn the visit
        const end = replay(run.seed, inputs, ticks);                          // outside any transaction; the count is this and nothing the client said
        const found = end.collected.length, before = bestOf(k, user.id, w.id).best;
        const minMs = Math.floor((ticks * 1000 * MIN_PLAY_PCT) / (C.TPS * 100));
        const fast = now - run.started_at < minMs;
        const changed = k.db.txn(() => k.db.prepare("UPDATE walk_runs SET status = ?, flag = ?, collected = ?, ticks = ?, finished_at = ? WHERE id = ? AND status = 'open'")
          .run(fast ? 'rejected' : 'finished', fast ? 'fast' : null, fast ? null : found, ticks, now, sid).changes);
        if (!changed) throw new k.HttpError(409, 'That visit was already finished.');
        if (fast) throw new k.HttpError(422, 'That visit finished faster than it can be walked, so it does not count.');
        if (found >= MIN_COLLECTED) k.events.emit('collected', { playerId: user.id, worldId: w.id, collected: found });   // after the commit, once
        const mine = bestOf(k, user.id, w.id);
        return { collected: found, items: end.collected, best: mine.best, visits: mine.visits, new_best: before === null || found > before, ticks };
      },
    },
    // ---- teacher: this season's visits per class, who is on the map now, and the presence switch ----
    {
      method: 'GET', path: '/teach', access: 'teacher',
      handler(k, { user }) {
        const w = k.world.current(), st = presenceOf(k), now = k.clock.now();
        const hi = C.ITEMS, mid = `3-${hi - 1}`;
        const count = k.db.prepare(`SELECT COUNT(CASE WHEN status = 'finished' THEN 1 END) AS finished, COUNT(CASE WHEN status = 'rejected' THEN 1 END) AS rejected,
          COUNT(DISTINCT CASE WHEN status = 'finished' THEN player_id END) AS players,
          COUNT(CASE WHEN status = 'finished' AND collected <= 2 THEN 1 END) AS low, COUNT(CASE WHEN status = 'finished' AND collected BETWEEN 3 AND ? THEN 1 END) AS mid,
          COUNT(CASE WHEN status = 'finished' AND collected >= ? THEN 1 END) AS high
          FROM walk_runs WHERE world_id = ? AND player_id IN (SELECT value FROM json_each(?))`);
        const why = k.db.prepare("SELECT flag, COUNT(*) AS n FROM walk_runs WHERE world_id = ? AND status = 'rejected' AND player_id IN (SELECT value FROM json_each(?)) GROUP BY flag");
        return {
          season: w?.status === 'active' ? w.name : null,
          classes: k.players.classesFor(user).map((c) => {
            const ids = JSON.stringify(k.players.inClass(c.id).map((s) => s.id));
            const r = w ? count.get(hi - 1, hi, w.id, ids) : { finished: 0, rejected: 0, players: 0, low: 0, mid: 0, high: 0 };
            const here = [...(st.byClass.get(c.id)?.values() ?? [])].filter((e) => now - e.seen <= TTL_MS).map((e) => e.u).sort();
            return {
              id: c.id, name: c.name, visits: r.finished, rejected: r.rejected, rejected_by: w ? Object.fromEntries(why.all(w.id, ids).map((x) => [x.flag ?? 'other', x.n])) : {},
              players: r.players, items: { '0-2': r.low, [mid]: r.mid, [String(hi)]: r.high },
              presence: presenceFor(k, c.id), on_map: { count: here.length, players: here.slice(0, MAX_ROSTER) },
            };
          }),
        };
      },
    },
    {
      method: 'POST', path: '/settings', access: 'teacher',   // { class_id, presence }: your own classes only (404 for anyone else's)
      handler(k, { user, body }) {
        const classId = k.input.int(body, 'class_id', { min: 1 }), on = k.input.bool(body, 'presence');
        k.policy.assert(user, 'class.manage', { classId });
        k.db.txn(() => {
          k.db.prepare('INSERT INTO walk_class_settings (class_id, presence, changed_at) VALUES (?, ?, ?) ON CONFLICT (class_id) DO UPDATE SET presence = excluded.presence, changed_at = excluded.changed_at')
            .run(classId, on ? 1 : 0, k.clock.now());
          k.audit('presence', { class: classId, presence: on }, `player:${user.id}`);
        });
        if (!on) {                                                                 // off: forget the class now, tell its connected students to hide classmates, tell its teachers it is empty
          const st = presenceOf(k);
          st.byClass.delete(classId); st.dirty.delete(classId); st.sentAt.delete(classId); st.roster.add(classId);
          flushRoster(k, st);
          const ids = k.players.inClass(classId).map((s) => s.id);
          for (let i = 0; i < ids.length; i += 200) k.push(ids.slice(i, i + 200), 'walk.presence.off', {});
        }
        return { ok: true, class_id: classId, presence: on };
      },
    },
    {
      // Where I am on the map, a few times a second while the Town Walk is open. Cosmetic: no ledger, no replay, nothing stored.
      method: 'POST', path: '/pos', access: 'student',
      handler(k, { user, body }) {
        if (!presenceFor(k, user.class_id)) return { presence: false };
        for (const key of Object.keys(body)) if (!POS_KEYS.has(key)) throw new k.HttpError(400, `Unknown field "${key}"`);
        const { x, y, dir, emote = 0 } = body;
        if (!ok(x) || x < 0 || x > 511 || !ok(y) || y < 0 || y > 383) throw new k.HttpError(400, 'x must be a whole number 0 to 511 and y 0 to 383');
        if (!ok(dir) || dir < 0 || dir > 3) throw new k.HttpError(400, 'dir must be a whole number 0 to 3');
        if (!ok(emote) || emote < 0 || emote > 3) throw new k.HttpError(400, 'emote must be a whole number 0 to 3');
        k.world.active();                                                         // 409 between seasons
        if (!ok(user.class_id)) throw new k.HttpError(400, 'No class');
        const st = presenceOf(k), now = k.clock.now();
        let mates = st.byClass.get(user.class_id);
        if (!mates) st.byClass.set(user.class_id, mates = new Map());
        const e = mates.get(user.id);
        if (e && now - e.seen < MIN_POST_MS) return { ok: true, dropped: true };   // too fast: ignored, not an error (the client's next post carries the news)
        if (!e) { mates.set(user.id, { u: user.username, x, y, d: dir, e: emote, emoteUntil: emote ? now + EMOTE_MS : 0, seen: now, quiet: false }); st.dirty.add(user.class_id); st.roster.add(user.class_id); }
        else {
          const next = emote || (now < e.emoteUntil ? e.e : 0);
          if (e.x !== x || e.y !== y || e.d !== dir || e.e !== next) st.dirty.add(user.class_id);
          if (emote) e.emoteUntil = now + EMOTE_MS;
          Object.assign(e, { x, y, d: dir, e: next, seen: now });
        }
        startPresence(k, st);
        return { ok: true };
      },
    },
    {
      method: 'POST', path: '/leave', access: 'student',
      handler(k, { user }) {
        if (!presenceFor(k, user.class_id)) return { presence: false };
        dropPresence(k, user.id);
        return { ok: true };
      },
    },
  ],
});
