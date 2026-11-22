// today: the daily loop (docs/phase5-life.md 5a). A "day" is one advance (one class day), however many world months it covers: the
// first tick of each advance writes one today_days row, and nothing else runs on the advance path. Each student's day is caught up
// lazily, the first time they (or a listener for them) look after the advance: yesterday's open errands get a last fact check, the
// rest expire, the streak is judged, energy refills to the class cap, and three new errands are chosen. The choice is deterministic:
// candidates are the templates whose `when` holds for the student's facts (each module's read-only todayFacts service), sorted by
// priority and then by an HMAC of (world secret, player, day, template). Rewards are fixed cents x the price index, minted like wages
// (kind today.errand / today.quest), capped by options.today.maxRewardCents. Energy is only shown until the town (5e) spends it.
// The digest is computed at read time from the ledger: the student's entries since the previous advance, by txns.kind.
//
// Files here: catalogue.js (errand catalogue, selection, small reads), errands.js (rewards, completing errands, ensureDay, events),
// quests.js (lesson quests, digest, card, quest input); migrations, simulate and the routes stay below.
import { defineModule } from '../../lib/modules.js';
import { REWARD_CEILING, QUEST_REWARD_CEILING, KEY, MAX_CAP, CHECKS, BY_ID, EVENT_TYPES, lastDay, currentDay, capOf, maxQuestReward, openErrands } from './catalogue.js';
import { hintsOf, completeErrand, ensureDay, onEvent } from './errands.js';
import { card, questToday, taskDone, questDone, finishQuest, settle, parseQuest } from './quests.js';
export { CHECKS, checkCatalogue, tag, selectErrands } from './catalogue.js';
export { digest } from './quests.js';

const ANSWER_MIN = 20, ANSWER_MAX = 500;

// Bots: each open errand is done with probability 40% (k.dice, deterministic), and a quest's answer with 50%.
function simulate(k, { month, students }) {
  const w = k.world.current();
  if (w?.status !== 'active') return;
  for (const s of students) {
    const user = { id: s.id, class_id: s.class_id };
    const { day } = ensureDay(k, w, s.id, s.class_id);
    const cap = capOf(k, s.class_id);
    for (const e of openErrands(k, s.id, w.id, day.day_no)) if (k.dice(e.id, month, 7) < 40) completeErrand(k, w, e, cap);
    const q = questToday(k, w);
    if (q && !questDone(k, q.id, s.id) && k.dice(s.id, month, 8) < 50) finishQuest(k, w, q, s.id, day, cap, q.body.justify ? 'I chose this because it keeps my emergency fund safe.' : null);
    settle(k, w, user);
  }
}

export default defineModule({
  id: 'today',
  requires: ['bank-basic'],
  options: { energyCap: 'default energy cap per class (0-20, default 10)', maxRewardCents: `ceiling on one errand's cash, cents (at most ${REWARD_CEILING})`, maxQuestRewardCents: `ceiling on a quest's cash, cents (at most ${QUEST_REWARD_CEILING})` },

  migrations: [{ id: '001_today', sql: `
CREATE TABLE today_days (          -- one row per advance (a class day), whatever months it covers; at = wall ms of its last tick, month = the month it ends on
  world_id INTEGER NOT NULL REFERENCES worlds(id), day_no INTEGER NOT NULL, at INTEGER NOT NULL, month INTEGER NOT NULL, PRIMARY KEY (world_id, day_no)
);
CREATE TABLE today_state (         -- day_no = the day this row was last caught up to
  player_id INTEGER NOT NULL REFERENCES players(id), world_id INTEGER NOT NULL, day_no INTEGER NOT NULL, energy INTEGER NOT NULL,
  streak INTEGER NOT NULL DEFAULT 0, last_day_done INTEGER, PRIMARY KEY (player_id, world_id)
);
CREATE TABLE today_errands (
  id INTEGER PRIMARY KEY, player_id INTEGER NOT NULL REFERENCES players(id), world_id INTEGER NOT NULL, day_no INTEGER NOT NULL, template TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','done','expired')), done_month INTEGER, reward_cents INTEGER NOT NULL DEFAULT 0, txn_id INTEGER REFERENCES txns(id),
  UNIQUE (player_id, world_id, day_no, template)
);
CREATE INDEX today_errands_open ON today_errands(world_id, player_id, status);
CREATE TABLE today_quests (id INTEGER PRIMARY KEY, world_id INTEGER NOT NULL REFERENCES worlds(id), date TEXT NOT NULL, body TEXT NOT NULL, created INTEGER NOT NULL, created_by INTEGER, UNIQUE (world_id, date));
CREATE TABLE today_quest_done (    -- answer: the "choose and justify" text, shown to the student's teachers only
  quest_id INTEGER NOT NULL REFERENCES today_quests(id), player_id INTEGER NOT NULL REFERENCES players(id), world_id INTEGER NOT NULL,
  done_month INTEGER NOT NULL, answer TEXT, reward_cents INTEGER NOT NULL DEFAULT 0, created INTEGER NOT NULL, PRIMARY KEY (quest_id, player_id)
);
CREATE TABLE today_secrets (world_id INTEGER PRIMARY KEY, secret TEXT NOT NULL);   -- the per-world errand draw secret: never sent to a browser
CREATE TABLE today_class (class_id INTEGER PRIMARY KEY REFERENCES classes(id), energy_cap INTEGER NOT NULL);
CREATE TABLE today_visits (player_id INTEGER NOT NULL, world_id INTEGER NOT NULL, day_no INTEGER NOT NULL, building TEXT NOT NULL, PRIMARY KEY (player_id, world_id, day_no, building))` }],

  // The day clock: the first tick of an advance opens the next day; later ticks of the same advance only move its month and time on.
  // Nothing per student happens here (see ensureDay), so a 300-student advance pays one statement for this module.
  onTick(k, { month, startMonth, world }) {
    const last = lastDay(k, world);
    if (month === startMonth + 1 || !last) k.db.prepare('INSERT INTO today_days (world_id, day_no, at, month) VALUES (?, ?, ?, ?)').run(world.id, (last?.day_no ?? 0) + 1, k.clock.now(), month);
    else k.db.prepare('UPDATE today_days SET at = ?, month = ? WHERE world_id = ? AND day_no = ?').run(k.clock.now(), month, world.id, last.day_no);
  },

  events: { ...Object.fromEntries(EVENT_TYPES.map((type) => [type, (k, p) => onEvent(k, type, p)])), 'app.closing': (k) => hintsOf(k).stop() },

  cards: [{ id: 'today', src: 'today.js' }],
  homeCards(k, user) {
    const w = k.world.current();
    if (w?.status !== 'active') return [];
    return [{ id: 'today', title: 'Today', data: card(k, w, user) }];
  },

  teacherPanels: [{ id: 'today-teach', title: 'Today', src: 'teach.js' }],
  simulate,

  routes: [
    { method: 'GET', path: '/state', access: 'student', handler: (k, { user }) => card(k, k.world.active(), user) },
    {
      // The card's links call this before opening a building: it is how panel tours and read_panel tasks are done (honour-based: opening it counts).
      method: 'POST', path: '/visit', access: 'student',
      handler(k, { user, body }) {
        const w = k.world.active();
        const building = k.input.str(body, 'building', { max: 31 });
        if (!KEY.test(building)) throw new k.HttpError(400, 'building must be a building key');
        const { day } = ensureDay(k, w, user.id, user.class_id);
        const errands = openErrands(k, user.id, w.id, day.day_no).filter((e) => BY_ID.get(e.template)?.done.visit === building);
        const q = questToday(k, w);
        const wanted = errands.length || q?.body.tasks.some((t) => t.kind === 'read_panel' && t.check === building);
        if (wanted) {
          k.db.txn(() => {
            k.db.prepare('INSERT OR IGNORE INTO today_visits (player_id, world_id, day_no, building) VALUES (?, ?, ?, ?)').run(user.id, w.id, day.day_no, building);
            const cap = capOf(k, user.class_id);
            for (const e of errands) completeErrand(k, w, e, cap);
          });
        }
        return { ok: true, counted: !!wanted };
      },
    },
    {
      method: 'POST', path: '/answer', access: 'student',
      handler(k, { user, body }) {
        const w = k.world.active();
        const id = k.input.int(body, 'id', { min: 1 });
        const answer = k.input.str(body, 'answer', { max: ANSWER_MAX }).replace(/[\u0000-\u001f\u007f]+/g, ' ').trim();
        const q = questToday(k, w);
        if (!q || q.id !== id) throw new k.HttpError(404, 'That quest is not open today');
        if (!q.body.justify) throw new k.HttpError(400, 'This quest needs no written answer');
        if (answer.length < ANSWER_MIN) throw new k.HttpError(400, `Write one to three sentences (at least ${ANSWER_MIN} characters)`);
        if (questDone(k, q.id, user.id)) throw new k.HttpError(409, 'You already finished this quest');
        const { day } = ensureDay(k, w, user.id, user.class_id);
        if (!q.body.tasks.every((t) => taskDone(k, w, user.id, day, t))) throw new k.HttpError(409, 'Finish the tasks first, then explain your choice');
        finishQuest(k, w, q, user.id, day, capOf(k, user.class_id), answer);
        return { ok: true };
      },
    },

    // ---- teacher ----
    {
      method: 'GET', path: '/teach', access: 'teacher',
      handler(k, { user }) {
        const w = k.world.current();
        const mine = k.players.classesFor(user);
        const day = w ? currentDay(k, w) : null;
        const ids = JSON.stringify(mine.map((c) => c.id));
        const qToday = w ? questToday(k, w) : null;
        const students = !w ? [] : k.db.prepare(`SELECT p.id, p.username, p.class_id, s.streak, s.day_no, s.last_day_done,
            EXISTS (SELECT 1 FROM today_quest_done d WHERE d.player_id = p.id AND d.quest_id = ?) AS quest_done,
            (SELECT COUNT(*) FROM today_errands e WHERE e.player_id = p.id AND e.world_id = ? AND e.status = 'done') AS errands_done,
            (SELECT COUNT(*) FROM today_errands e WHERE e.player_id = p.id AND e.world_id = ? AND e.status = 'done' AND e.day_no = ?) AS done_today,
            (SELECT COALESCE(SUM(e.reward_cents), 0) FROM today_errands e WHERE e.player_id = p.id AND e.world_id = ?) AS errand_cents
          FROM players p LEFT JOIN today_state s ON s.player_id = p.id AND s.world_id = ? WHERE p.role = 'student' AND p.class_id IN (SELECT value FROM json_each(?)) ORDER BY p.class_id, p.username`)
          .all(qToday?.id ?? -1, w.id, w.id, day.day_no, w.id, w.id, ids).map((r) => ({ id: r.id, username: r.username, class_id: r.class_id, quest_done: !!r.quest_done, streak: r.last_day_done !== null && r.last_day_done >= day.day_no - 1 ? r.streak ?? 0 : 0, errands_done: r.errands_done, done_today: r.done_today, errand_cents: r.errand_cents }));
        const quests = !w ? [] : k.db.prepare('SELECT id, date, body FROM today_quests WHERE world_id = ? ORDER BY date DESC LIMIT 30').all(w.id)
          .map((q) => { const b = JSON.parse(q.body); return { id: q.id, quest_id: b.id, date: q.date, title: b.title, justify: b.justify, tasks: b.tasks, reward_cents: b.reward_cents }; });
        const answers = !w ? [] : k.db.prepare(`SELECT d.quest_id, q.date, p.username, p.class_id, d.answer, d.done_month FROM today_quest_done d JOIN today_quests q ON q.id = d.quest_id JOIN players p ON p.id = d.player_id
          WHERE d.world_id = ? AND p.class_id IN (SELECT value FROM json_each(?)) ORDER BY q.date DESC, p.username LIMIT 500`).all(w.id, ids);
        return {
          day: day?.day_no ?? null, today: k.clock.today(), quest_today: qToday && { id: qToday.id, title: qToday.body.title, justify: qToday.body.justify }, can_push: k.policy.can(user, 'world.settings'), max_reward_cents: maxQuestReward(k), checks: CHECKS,
          classes: mine.map((c) => ({ id: c.id, name: c.name, energy_cap: capOf(k, c.id), can_manage: k.policy.can(user, 'class.manage', { classId: c.id }) })),
          students, quests, answers,
        };
      },
    },
    {
      // "Push to the town": the quest file Slide Studio writes (quests/<date>.json), uploaded by the world teacher. Re-pushing a date replaces it.
      method: 'POST', path: '/quest', access: 'teacher',
      handler(k, { user, body }) {
        k.policy.assert(user, 'world.settings');                                  // the town's quest is the whole world's
        const w = k.world.active();
        const q = parseQuest(k, body);
        k.db.txn((tx) => {
          k.db.prepare('INSERT INTO today_quests (world_id, date, body, created, created_by) VALUES (?, ?, ?, ?, ?) ON CONFLICT (world_id, date) DO UPDATE SET body = excluded.body, created = excluded.created, created_by = excluded.created_by')
            .run(w.id, q.date, JSON.stringify(q), k.clock.now(), user.id);
          k.audit('quest', { worldId: w.id, date: q.date, id: q.id }, `player:${user.id}`);
          tx.onCommit(() => k.events.emit('changed', { classId: null }));
        });
        return { ok: true, date: q.date };
      },
    },
    {
      method: 'POST', path: '/cap', access: 'teacher',
      handler(k, { user, body }) {
        const classId = k.input.int(body, 'class_id', { min: 1 });
        k.policy.assert(user, 'class.manage', { classId });
        const cap = k.input.int(body, 'energy_cap', { min: 0, max: MAX_CAP });
        k.db.txn((tx) => {
          k.db.prepare('INSERT INTO today_class (class_id, energy_cap) VALUES (?, ?) ON CONFLICT (class_id) DO UPDATE SET energy_cap = excluded.energy_cap').run(classId, cap);
          k.audit('cap', { classId, energy_cap: cap }, `player:${user.id}`);
          tx.onCommit(() => k.events.emit('changed', { classId }));
        });
        return { ok: true, energy_cap: cap, applies: 'from the next class day' };
      },
    },
  ],
});
