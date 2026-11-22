// learn: the daily loop (streak, freezes, home block) and the daily review.
import { addDays } from '../../lib/clock.js';
import { loadAttempt, courseOf } from './reads.js';

// ---- the daily loop (docs/learn.md "Daily loop"): an every-calendar-day streak with freezes, a 5-question review, a weekly ranked league (league.js). No money. ----
// streakView is read-only (it is what /state and the home card show); keepDay is what a kept day writes. `gap` = whole days strictly between last_day and today.
export const INTERVALS = [1, 2, 4, 8, 16], REVIEW_SIZE = 5, FREEZE_MAX = 2, FREEZE_EVERY = 7;
const dayGap = (from, to) => Math.round((Date.parse(`${to}T12:00:00Z`) - Date.parse(`${from}T12:00:00Z`)) / 864e5) - 1;
export function streakView(row, today) {
  const none = { streak: 0, best: row?.best ?? 0, freezes: 0, kept_today: false, covered: 0 };
  if (!row?.last_day) return { ...none, freezes: row?.freezes ?? 0 };
  if (row.last_day >= today) return { streak: row.streak, best: row.best, freezes: row.freezes, kept_today: true, covered: 0 };
  const gap = dayGap(row.last_day, today);
  return gap <= row.freezes ? { streak: row.streak, best: row.best, freezes: row.freezes, kept_today: false, covered: gap } : none;
}
// -> { row: the new row, frozen: [days a freeze covered], changed: false when today was already kept, earned: a freeze was earned }
export function keepDay(row, today) {
  const cur = row ?? { streak: 0, best: 0, freezes: 0, last_day: null };
  if (cur.last_day && cur.last_day >= today) return { row: cur, frozen: [], changed: false, earned: false };
  const gap = cur.last_day ? dayGap(cur.last_day, today) : 0;
  let { streak, freezes } = cur, frozen = [];
  if (!cur.last_day) streak = 1;
  else if (gap <= freezes) { freezes -= gap; frozen = Array.from({ length: gap }, (_, i) => addDays(cur.last_day, i + 1)); streak += 1; }
  else { streak = 1; freezes = 0; }
  const before = freezes;
  if (streak % FREEZE_EVERY === 0) freezes = Math.min(FREEZE_MAX, freezes + 1);
  return { row: { streak, best: Math.max(cur.best, streak), freezes, last_day: today }, frozen, changed: true, earned: freezes > before };
}
export const mondayOf = (today) => addDays(today, -((new Date(`${today}T12:00:00Z`).getUTCDay() + 6) % 7));
export const streakRow = (k, pid, wid) => k.db.prepare('SELECT * FROM learn_streak WHERE player_id = ? AND world_id = ?').get(pid, wid);
export const reviewId = (today) => `review:${today}`;

// 'done' | 'ready' | 'locked'. Two indexed reads; `count` (the real number of questions) is only worked out for /state.
export function reviewOf(k, pid, wid, today, idx, withCount) {
  const f = k.db.prepare(`SELECT EXISTS(SELECT 1 FROM learn_attempts WHERE player_id = ? AND world_id = ? AND level_id = ? AND finished_at IS NOT NULL) AS done,
    EXISTS(SELECT 1 FROM learn_review WHERE player_id = ? AND world_id = ?) AS has`).get(pid, wid, reviewId(today), pid, wid);
  if (f.done) return { state: 'done', count: 0 };
  if (!f.has) return { state: 'locked', count: 0 };
  if (!withCount) return { state: 'ready', count: REVIEW_SIZE };
  const open = loadAttempt(k, pid, wid, reviewId(today));
  const n = open ? open.st.qids.length : pickReview(k, pid, wid, today, idx).length;
  return { state: n ? 'ready' : 'locked', count: n };
}
// due first, then the soonest due, the lowest box, the id; fewer than 5 due -> the not-yet-due ones fill the rest. Ids the content no longer has are skipped.
const pickReview = (k, pid, wid, today, idx) => k.db.prepare('SELECT question_id FROM learn_review WHERE player_id = ? AND world_id = ? ORDER BY due_day > ?, due_day, box, question_id')
  .all(pid, wid, today).map((r) => r.question_id).filter((id) => idx.questions.has(id)).slice(0, REVIEW_SIZE);

// The daily block of /state and of every /finish. Reads only.
export function dailyOf(k, pid, wid, idx) {
  const today = k.clock.today(), row = streakRow(k, pid, wid), v = streakView(row, today), mon = mondayOf(today), sun = addDays(mon, 6);
  const days = new Map(k.db.prepare('SELECT day, xp, frozen FROM learn_days WHERE player_id = ? AND world_id = ? AND day >= ? AND day <= ?').all(pid, wid, mon, sun).map((r) => [r.day, r]));
  const first = k.db.prepare('SELECT MIN(day) AS d FROM learn_days WHERE player_id = ? AND world_id = ?').get(pid, wid).d;
  const last = row?.last_day;
  const week = Array.from({ length: 7 }, (_, i) => {
    const day = addDays(mon, i), r = days.get(day);
    const state = day > today ? 'future' : day === today ? (v.kept_today ? 'kept' : 'today') : r ? (r.frozen ? 'frozen' : 'kept')
      : v.covered && last && day > last ? 'frozen' : !first || day < first ? 'none' : 'missed';
    return { day, state };
  });
  const xpWeek = [...days.values()].reduce((s, r) => s + r.xp, 0);
  return { today, streak: v.streak, best: v.best, freezes: v.freezes, kept_today: v.kept_today, at_risk: v.streak > 0 && !v.kept_today,
    xp_today: days.get(today)?.xp ?? 0, xp_week: xpWeek, week, review: reviewOf(k, pid, wid, today, idx, true) };
}

// A day is kept: the streak row, any days a freeze covered, and today's XP (an upsert, so keeping twice in a day only adds XP).
export function keep(k, pid, wid, xp) {
  const today = k.clock.today(), r = keepDay(streakRow(k, pid, wid), today);
  if (r.changed) {
    k.db.prepare(`INSERT INTO learn_streak (player_id, world_id, streak, best, freezes, last_day) VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT (player_id, world_id) DO UPDATE SET streak = excluded.streak, best = excluded.best, freezes = excluded.freezes, last_day = excluded.last_day`)
      .run(pid, wid, r.row.streak, r.row.best, r.row.freezes, today);
    for (const d of r.frozen) k.db.prepare('INSERT OR IGNORE INTO learn_days (player_id, world_id, day, xp, frozen) VALUES (?, ?, ?, 0, 1)').run(pid, wid, d);
  }
  k.db.prepare('INSERT INTO learn_days (player_id, world_id, day, xp) VALUES (?, ?, ?, ?) ON CONFLICT (player_id, world_id, day) DO UPDATE SET xp = xp + excluded.xp')
    .run(pid, wid, today, xp);
  return { day_kept: r.changed, freeze_earned: r.earned };
}

// ---- the daily review: level_id 'review' on /start, /answer and /finish; its attempt row is learn_attempts.level_id = 'review:<day>' ----
// The five question ids are picked once and kept in the attempt state, so leaving and coming back never changes the set.
export const reviewQs = (k, user, a) => { const idx = courseOf(k, user.id); return a.st.qids.map((id) => idx.questions.get(id)).filter(Boolean); };
export const reviewEntry = (k, user, a) => ({ level: { questions: reviewQs(k, user, a) } });          // the shape check() reads
// No review open today. If one was left open yesterday the student has played past midnight: say that, not "start the review first".
export const noReview = (k, user, w) => new k.HttpError(409, loadAttempt(k, user.id, w.id, reviewId(addDays(k.clock.today(), -1)))
  ? 'It is past midnight, so that was yesterday’s review. Go back to the road and start today’s.' : 'Start the review first.');
export function openReview(k, user, w) {
  const idx = courseOf(k, user.id);
  if (!idx) throw new k.HttpError(404, 'That level does not exist');
  const today = k.clock.today(), id = reviewId(today);
  if (k.db.prepare('SELECT 1 FROM learn_attempts WHERE player_id = ? AND world_id = ? AND level_id = ? AND finished_at IS NOT NULL').get(user.id, w.id, id)) throw new k.HttpError(409, 'You have done today’s review. Come back tomorrow.');
  let a = loadAttempt(k, user.id, w.id, id);
  if (!a) {
    const qids = pickReview(k, user.id, w.id, today, idx);
    if (!qids.length) throw new k.HttpError(409, 'Finish a level to unlock the daily review.');
    const st = { first: {}, solved: [], queue: [], qids };
    const rid = k.db.prepare('INSERT INTO learn_attempts (player_id, world_id, level_id, started_at, state) VALUES (?, ?, ?, ?, ?)').run(user.id, w.id, id, k.clock.now(), JSON.stringify(st)).lastInsertRowid;
    a = { id: Number(rid), st };
  }
  return { a, idx };
}
export function finishReview(k, user, w) {
  const today = k.clock.today(), a = loadAttempt(k, user.id, w.id, reviewId(today));
  if (!a) throw noReview(k, user, w);
  const qs = reviewQs(k, user, a), st = a.st;
  if (!qs.length) throw new k.HttpError(409, 'These questions have changed. Start the review again tomorrow.');   // every question left the content file mid-review: no XP for nothing
  const missing = qs.filter((q) => !st.solved.includes(q.id)).length;
  if (missing) throw new k.HttpError(409, `${missing} question${missing === 1 ? '' : 's'} still to get right.`);
  const firstTry = qs.filter((q) => st.first[q.id]?.ok).length, xp = 5 + firstTry;
  return k.db.txn(() => {
    if (!k.db.prepare('UPDATE learn_attempts SET finished_at = ? WHERE id = ? AND finished_at IS NULL').run(k.clock.now(), a.id).changes) throw new k.HttpError(409, 'That attempt is already finished.');
    const get = k.db.prepare('SELECT box FROM learn_review WHERE player_id = ? AND world_id = ? AND question_id = ?'), put = k.db.prepare('UPDATE learn_review SET box = ?, due_day = ? WHERE player_id = ? AND world_id = ? AND question_id = ?');
    for (const q of qs) {
      const row = get.get(user.id, w.id, q.id);
      if (!row) continue;
      const box = st.first[q.id]?.ok ? Math.min(INTERVALS.length - 1, row.box + 1) : 0;
      put.run(box, addDays(today, INTERVALS[box]), user.id, w.id, q.id);
    }
    const kept = keep(k, user.id, w.id, xp);
    return { review: true, first_try: firstTry, questions: qs.length, paid: false, reward_cents: 0, practice: false, words: [], next: null, go: null, xp, ...kept, daily: dailyOf(k, user.id, w.id, courseOf(k, user.id)) };
  });
}
