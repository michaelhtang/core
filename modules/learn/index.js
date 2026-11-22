// learn: the Learning Road (docs/learn.md). A Duolingo-style road of short lessons: a few cards, then questions; a missed question comes back at the end.
// The SERVER owns every answer. /state and /start send cards and questions with no answer, no `why` and no `working`; /answer checks one question and
// returns the feedback for what the student chose; the right answer is only returned once the student has given it. A level pays once per world
// (kind learn.reward, from the mint, like a Today errand) and /finish pays only when every question has been answered correctly.
// Content: modules/learn/content/<course>.json, checked at boot (content.js).
// A teacher can play any level without saving anything: /preview/start and /preview/answer (docs/learn.md "Teacher preview").
// Files: migrations.js (tables), reads.js (courses, road, open attempt row), daily.js (streak, daily review), league.js (ranked leagues), practice.js (Practice sessions), attempts.js (reward, state, start/answer/check/finish, bots).
import { defineModule } from '../../lib/modules.js';
import { publicQuestion } from './content.js';
import { addDays } from '../../lib/clock.js';
import { migrations } from './migrations.js';
import { coursesOf, courseOf, progressRows, roadFor, assertOpen, nextInfo, loadAttempt, entryFor } from './reads.js';
import { streakView, mondayOf, streakRow, reviewId, reviewOf, reviewQs, reviewEntry, noReview, openReview, finishReview } from './daily.js';
import { rewardFor, state, openAttempt, parseValue, check, judge, finish, simulate } from './attempts.js';
export { rewardFor } from './attempts.js';
export { streakView, keepDay } from './daily.js';
export { LEAGUE, splitGroups, assignGroups, joinGroup, standings, nextTier } from './league.js';
import { LEAGUE, ranksOf } from './league.js';
import { startPractice, pickPractice, answerPractice, finishPractice } from './practice.js';
export { PRACTICE, shuffle, seedOf, weakOrder, modeFor } from './practice.js';

const ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 21c0-5 14-5 14-10S5 11 5 6M5 3.500v1M19 18.500v2M12 8.500v1"/></svg>';

const lastAnswer = new WeakMap();                              // ponytail: in memory per kernel; a restart forgets it (it only spaces out answers)
const gapOf = (k) => (Number.isSafeInteger(k.config.answerGapMs) && k.config.answerGapMs >= 0 ? k.config.answerGapMs : 300);

const tooFast = (k, user) => { const last = lastAnswer.get(k)?.get(user.id); return last !== undefined && k.clock.now() - last < gapOf(k); };
const markAnswer = (k, user) => { if (!lastAnswer.has(k)) lastAnswer.set(k, new Map()); lastAnswer.get(k).set(user.id, k.clock.now()); };
const openRow = (k, classId) => (k.db.prepare('SELECT 1 FROM learn_open_set WHERE class_id = ?').get(classId) ? k.db.prepare('SELECT unit_id FROM learn_open_unit WHERE class_id = ? ORDER BY unit_id').all(classId).map((r) => r.unit_id) : null);
// The teacher preview finds a level in any loaded course: a teacher has no class of their own, and may not have made one yet.
const previewEntry = (k, levelId) => {
  for (const idx of coursesOf(k).values()) { const e = idx.byLevel.get(levelId); if (e) return e; }
  throw new k.HttpError(404, 'That level does not exist');
};
const median = (xs) => { const s = xs.slice().sort((a, b) => a - b); return s.length ? (s.length % 2 ? s[(s.length - 1) / 2] : Math.round((s[s.length / 2 - 1] + s[s.length / 2]) / 2)) : null; };

export default defineModule({
  id: 'learn',
  requires: ['bank-basic'],
  options: { home: 'true (default) puts the Learning Road card first on the student home screen', answerGapMs: 'least time between two answers from one student, ms (default 300)', contentDir: 'a directory of course JSON files to use instead of modules/learn/content (tests; default none)' },

  migrations,

  panels: [{ id: 'learn', building: { key: 'learn', name: 'Learning Road', icon: ICON }, src: 'learn.js' }],
  teacherPanels: [{ id: 'learn-teach', title: 'Learning Road', src: 'teach.js' }],
  cards: [{ id: 'road', src: 'card.js' }],

  // Cheap: this runs in /api/me. One indexed read of the student's finished levels.
  homeCards(k, user) {
    const w = k.world.current();
    const idx = courseOf(k, user.id);
    if (!idx || w?.status !== 'active') return [];
    const done = progressRows(k, user.id, w.id), road = roadFor(k, user.id, idx, done);
    const cur = road.next ?? null, u = cur && road.units.find((x) => x.unit.id === cur.unit.id);
    return [{ id: 'road', title: 'Learning Road', lead: k.config.home !== false, data: { next: nextInfo(cur), image: cur?.unit.image ?? null, unit_done: u?.done ?? 0, unit_total: cur?.of ?? 0, levels_done: done.size, levels_total: idx.levels.length,
      daily: { ...(({ streak, kept_today, freezes }) => ({ streak, kept_today, freezes }))(streakView(streakRow(k, user.id, w.id), k.clock.today())), review: reviewOf(k, user.id, w.id, k.clock.today(), idx, false).state } } }];
  },

  services: {
    // Today's errand "Finish a level on the Learning Road" is offered only when there is an open level.
    todayFacts(k, { playerId }) {
      const w = k.world.current(), idx = courseOf(k, playerId);
      if (!idx || w?.status !== 'active') return { hasOpenLevel: false };
      return { hasOpenLevel: !!roadFor(k, playerId, idx, progressRows(k, playerId, w.id)).next };
    },
  },
  simulate,

  routes: [
    { method: 'GET', path: '/state', access: 'student', handler: (k, { user }) => state(k, user) },
    {
      method: 'POST', path: '/start', access: 'student',
      handler(k, { user, body }) {
        const levelId = k.input.str(body, 'level_id', { max: 80 });
        const w = k.world.active();
        if (levelId === 'review') {
          const { a, idx } = k.db.txn(() => openReview(k, user, w));
          const from = (qid) => idx.levels.find((e) => e.level.questions.some((q) => q.id === qid)).level.title;
          return {
            level: { id: 'review', title: 'Daily review', review: true, learn: [], n: 0, of: 0, unit_title: '', section_title: '', go: null },
            practice: false, max_reward_cents: 0, cards: [], questions: reviewQs(k, user, a).map((q) => ({ ...publicQuestion(q), from: from(q.id) })),
            solved: a.st.solved, queue: a.st.queue,
          };
        }
        const { a, e, practice, indexBp } = k.db.txn(() => openAttempt(k, user, w, levelId));
        const l = e.level;
        return {
          level: { id: l.id, title: l.title, learn: l.learn, n: e.n, of: e.of, unit_title: e.unit.title, section_title: e.section.title, go: l.go ?? null },
          practice, max_reward_cents: rewardFor(l.questions.length, indexBp).cents,
          cards: l.cards, questions: l.questions.map(publicQuestion),
          solved: a.st.solved, queue: a.st.queue,                              // a resumed attempt: what is already right and what still has to be fixed
        };
      },
    },
    {
      method: 'POST', path: '/answer', access: 'student',
      handler(k, { user, body }) {
        const levelId = k.input.str(body, 'level_id', { max: 80 }), qid = k.input.str(body, 'question_id', { max: 80 });
        const w = k.world.active();
        const review = levelId === 'review', ra = review ? loadAttempt(k, user.id, w.id, reviewId(k.clock.today())) : null;
        if (review && !ra) throw noReview(k, user, w);
        const ent = review ? null : entryFor(k, user, levelId);
        if (ent) assertOpen(k, user, ent.e);
        const e = review ? reviewEntry(k, user, ra) : ent.e;
        const q = e.level.questions.find((x) => x.id === qid);
        if (!q) throw new k.HttpError(404, review ? 'That question is not in today’s review' : 'That question is not in this level');
        const v = parseValue(k, q, body);
        if (tooFast(k, user)) throw new k.HttpError(429, 'Slow down a little, then answer again.');
        return k.db.txn(() => {
          const a = loadAttempt(k, user.id, w.id, review ? reviewId(k.clock.today()) : levelId);
          if (!a) throw review ? noReview(k, user, w) : new k.HttpError(409, 'Start the level first.');
          markAnswer(k, user);
          return check(k, a, e, q, v);
        });
      },
    },
    {
      method: 'POST', path: '/finish', access: 'student',
      handler(k, { user, body }) {
        const levelId = k.input.str(body, 'level_id', { max: 80 });
        return levelId === 'review' ? finishReview(k, user, k.world.active()) : finish(k, user, k.world.active(), levelId);
      },
    },
    // ---- Practice (docs/learn.md "Practice"): the weakest units, three kinds of session in turn. XP only, never money. ----
    { method: 'POST', path: '/practice/start', access: 'student', handler: (k, { user }) => k.db.txn(() => startPractice(k, user, k.world.active())) },
    {
      method: 'POST', path: '/practice/answer', access: 'student',
      handler(k, { user, body }) {
        if (tooFast(k, user)) throw new k.HttpError(429, 'Slow down a little, then answer again.');
        return k.db.txn(() => { const r = answerPractice(k, user, k.world.active(), body); markAnswer(k, user); return r; });
      },
    },
    { method: 'POST', path: '/practice/pick', access: 'student', handler: (k, { user, body }) => k.db.txn(() => pickPractice(k, user, k.world.active(), k.input.str(body, 'term_id', { max: 20 }), k.input.str(body, 'meaning_id', { max: 20 }))) },
    { method: 'POST', path: '/practice/finish', access: 'student', handler: (k, { user }) => finishPractice(k, user, k.world.active()) },
    // ---- teacher preview: play any level as a student sees it. The database is not read or written: no attempt, no progress, no pay, no season needed. ----
    {
      method: 'POST', path: '/preview/start', access: 'teacher',
      handler(k, { body }) {
        const e = previewEntry(k, k.input.str(body, 'level_id', { max: 80 })), l = e.level;
        return {
          level: { id: l.id, title: l.title, learn: l.learn, n: e.n, of: e.of, unit_title: e.unit.title, section_title: e.section.title, go: null },
          preview: true, practice: false, max_reward_cents: 0, cards: l.cards, questions: l.questions.map(publicQuestion), solved: [], queue: [],
        };
      },
    },
    {
      // Judges one answer exactly as /answer does and remembers nothing. The player (ui/player.js) keeps the retry list and the first-try count itself.
      method: 'POST', path: '/preview/answer', access: 'teacher',
      handler(k, { body }) {
        const e = previewEntry(k, k.input.str(body, 'level_id', { max: 80 })), qid = k.input.str(body, 'question_id', { max: 80 });
        const q = e.level.questions.find((x) => x.id === qid);
        if (!q) throw new k.HttpError(404, 'That question is not in this level');
        const { correct, why, working } = judge(q, parseValue(k, q, body));
        return { correct, why, ...(working ? { working } : {}) };
      },
    },
    {
      // A teacher chooses the units open to a class: { class_id, units: [ids] } sets the whole set (empty closes everything); { class_id, all: true } clears the setting.
      // Takes effect on the students' next request.
      method: 'POST', path: '/open-units', access: 'teacher',
      handler(k, { user, body }) {
        const classId = k.input.int(body, 'class_id', { min: 1 });
        k.policy.assert(user, 'class.manage', { classId });                       // 404 for a class that is not yours
        const clear = Object.hasOwn(body, 'all') && k.input.bool(body, 'all');
        const ids = body.units;
        if (clear && ids !== undefined) throw new k.HttpError(400, 'Send the list of units or all: true, not both.');
        if (!clear) {
          if (!Array.isArray(ids) || ids.length > 500 || ids.some((x) => typeof x !== 'string' || x.length > 80)) throw new k.HttpError(400, 'units must be a list of unit ids, or send all: true to open everything');
          if (new Set(ids).size !== ids.length) throw new k.HttpError(400, 'Each unit can be listed only once.');
          const byId = new Map((coursesOf(k).get(k.players.classes().find((c) => c.id === classId)?.course_id)?.units ?? []).map((x) => [x.unit.id, x.unit]));
          for (const id of ids) {
            if (!byId.has(id)) throw new k.HttpError(400, 'A unit you ticked is not in this class’s course.');
            if (!byId.get(id).levels.length) throw new k.HttpError(400, 'A unit you ticked has no levels yet, so it cannot be opened.');
          }
        }
        k.db.txn(() => {
          k.db.prepare('DELETE FROM learn_open_unit WHERE class_id = ?').run(classId);
          if (clear) k.db.prepare('DELETE FROM learn_open_set WHERE class_id = ?').run(classId);
          else {
            k.db.prepare('INSERT INTO learn_open_set (class_id, set_at, set_by) VALUES (?, ?, ?) ON CONFLICT (class_id) DO UPDATE SET set_at = excluded.set_at, set_by = excluded.set_by').run(classId, k.clock.now(), user.id);
            for (const id of ids) k.db.prepare('INSERT INTO learn_open_unit (class_id, unit_id) VALUES (?, ?)').run(classId, id);
          }
          k.audit('open_units', { class: classId, units: clear ? null : ids }, `player:${user.id}`);
        });
        return { class_id: classId, open_units: clear ? null : [...ids].sort() };
      },
    },
    {
      // A teacher: per class and per unit, who finished each level, the median first-try percent, and the three questions the class missed most. Read only; this season.
      method: 'GET', path: '/teach', access: 'teacher',
      handler(k, { user }) {
        const w = k.world.current();
        return {
          season: w?.status === 'active' ? w.name : null,
          // every level of every course, for "Preview a lesson" (it does not depend on the teacher's classes or on a season)
          courses: [...coursesOf(k).values()].map((idx) => ({ id: idx.course.id, title: idx.course.title, units: idx.units.filter((x) => x.unit.levels.length)
            .map(({ section, unit }) => ({ id: unit.id, title: unit.title, section: section.title, levels: unit.levels.map((l, i) => ({ id: l.id, n: i + 1, title: l.title })) })) })),
          classes: k.players.classesFor(user).map((c) => {
            const idx = coursesOf(k).get(c.course_id);
            const students = k.players.inClass(c.id), ids = JSON.stringify(students.map((s) => s.id));
            const base = { id: c.id, name: c.name, students: students.length, open_units: openRow(k, c.id),
              open_sections: (idx?.course.sections ?? []).map((sec) => ({ id: sec.id, title: sec.title, units: sec.units.filter((u) => u.levels.length).map((u) => ({ id: u.id, title: u.title })) })).filter((sec) => sec.units.length) };
            if (!idx || !w) return { ...base, units: [] };
            const today = k.clock.today(), mon = mondayOf(today), sums = (sql, ...a) => new Map(k.db.prepare(sql).all(w.id, ...a, ids).map((r) => [r.player_id, r.n]));
            const streaks = new Map(k.db.prepare('SELECT * FROM learn_streak WHERE world_id = ? AND player_id IN (SELECT value FROM json_each(?))').all(w.id, ids).map((r) => [r.player_id, r]));
            const xpWeek = sums('SELECT player_id, SUM(xp) AS n FROM learn_days WHERE world_id = ? AND day >= ? AND day <= ? AND player_id IN (SELECT value FROM json_each(?)) GROUP BY player_id', mon, addDays(mon, 6));
            const kept7 = sums('SELECT player_id, COUNT(*) AS n FROM learn_days WHERE world_id = ? AND frozen = 0 AND day > ? AND day <= ? AND player_id IN (SELECT value FROM json_each(?)) GROUP BY player_id', addDays(today, -7), today);
            const ranks = ranksOf(k, w.id, students.map((s) => s.id));
            base.roster = students.map((s) => { const v = streakView(streaks.get(s.id), today); return { username: s.username, rank: ranks.get(s.id) ?? LEAGUE.START, streak: v.streak, best: v.best, kept_7: kept7.get(s.id) ?? 0, xp_week: xpWeek.get(s.id) ?? 0 }; });
            const prog = new Map();
            for (const r of k.db.prepare('SELECT level_id, first_try, questions FROM learn_progress WHERE world_id = ? AND player_id IN (SELECT value FROM json_each(?))').all(w.id, ids)) {
              if (!prog.has(r.level_id)) prog.set(r.level_id, []);
              prog.get(r.level_id).push(Math.round((100 * r.first_try) / r.questions));
            }
            const hard = new Map();
            for (const r of k.db.prepare('SELECT question_id, COUNT(*) AS n, SUM(first_correct) AS right FROM learn_answers WHERE world_id = ? AND player_id IN (SELECT value FROM json_each(?)) GROUP BY question_id').all(w.id, ids)) hard.set(r.question_id, r);
            return { ...base, units: idx.units.filter((x) => x.unit.levels.length).map(({ section, unit }) => ({
              id: unit.id, title: unit.title, section: section.title,
              levels: unit.levels.map((l, i) => ({ id: l.id, n: i + 1, title: l.title, finished: (prog.get(l.id) ?? []).length, median_first_try_pct: median(prog.get(l.id) ?? []) })),
              hardest: unit.levels.flatMap((l) => l.questions.map((q) => ({ q, level: l.title, a: hard.get(q.id) }))).filter((x) => x.a)
                .map((x) => ({ question_id: x.q.id, level: x.level, prompt: x.q.prompt, first_try_pct: Math.round((100 * x.a.right) / x.a.n), answered: x.a.n }))
                .sort((x, y) => x.first_try_pct - y.first_try_pct || y.answered - x.answered || (x.question_id < y.question_id ? -1 : 1)).slice(0, 3),
            })) };
          }),
        };
      },
    },
  ],
});
