// learn: Practice (docs/learn.md "Practice"). Sessions built on the student's weakest units: a word-match game, an XP Climb of questions and a timed round, in turn.
// Like the daily review, the server owns everything: the questions of a session (or the word pairs) are fixed in the attempt state, answers are judged here,
// and the client gets no answer, no `why` for an unanswered question and no pairing. XP goes into learn_days through keep(), capped per day. No money, ever.
// Time only from k.clock; order only from a seeded shuffle (no Math.random, no Date.now), so the same inputs give the same session.
import { createHash } from 'node:crypto';
import { addDays } from '../../lib/clock.js';
import { courseOf, saveAttempt } from './reads.js';
import { keep, dailyOf } from './daily.js';
import { judge, parseValue } from './attempts.js';
import { publicQuestion } from './content.js';

// Every number of Practice is here.
export const PRACTICE = Object.freeze({
  WEAK_UNITS: 3,                                                        // the pool comes from this many of the weakest units
  MODES: Object.freeze(['match', 'climb', 'timed']),                    // session n plays MODES[n % 3]
  MATCH_PAIRS: 5, MATCH_XP: 5, MATCH_XP_WITH_MISS: 3, MATCH_MIN_PAIRS: 3,
  CLIMB_LEVELS: 3, CLIMB_STEPS: 3, CLIMB_STEP_QUESTIONS: 2,              // 3 levels of 3 steps; a step is 2 questions, both right first time
  CLIMB_XP: Object.freeze([Object.freeze([1, 2, 3]), Object.freeze([2, 3, 4]), Object.freeze([3, 4, 5])]),   // XP per step, fixed; total 27, under DAILY_XP_CAP
  TIMED_SECONDS: 120, CHECKPOINTS: Object.freeze([[3, 2], [6, 3], [10, 5]]),   // [right answers, bonus XP]
  DAILY_XP_CAP: 30,                                                     // practice XP that reaches learn_days in one day
  POOL_MIN: 18, POOL_MAX: 40,                                           // questions a climb or timed session wants / keeps
});
const P = PRACTICE;
const OPEN = "level_id GLOB 'practice:*'";

// ---- the seeded shuffle: sha256 Fisher-Yates. The same (items, seed) always gives the same order. ----
export const seedOf = (playerId, worldId, day, n) => createHash('sha256').update(`practice|${playerId}|${worldId}|${day}|${n}`).digest('hex');
const draw = (seed, tag) => createHash('sha256').update(`${seed}:${tag}`).digest().readUInt32BE(0);
export function shuffle(items, seed) {
  const a = items.slice();
  for (let i = a.length - 1; i > 0; i--) { const j = draw(seed, i) % (i + 1); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}
export const modeFor = (n) => P.MODES[n % P.MODES.length];

// ---- weakest units. `units`: [{ id, order, answered, wrong, box }] (box = the average learn_review box). Most wrong first, then the lower box, then content order. ----
export const weakOrder = (units) => units.filter((u) => u.answered > 0)
  .sort((a, b) => (b.wrong * a.answered - a.wrong * b.answered) || (a.box - b.box) || (a.order - b.order));

const UNITS = new WeakMap();
function unitIndex(idx) {                                                // question id -> { unit, order (of the unit), pos (of the question) }, built once per course
  if (!UNITS.has(idx)) {
    const m = new Map();
    idx.units.forEach(({ unit }, order) => unit.levels.forEach((l) => l.questions.forEach((q) => m.set(q.id, { unit, order }))));
    [...idx.questions.keys()].forEach((id, pos) => { const e = m.get(id); if (e) e.pos = pos; });
    UNITS.set(idx, m);
  }
  return UNITS.get(idx);
}
// What the student has met, by unit: { id, title, order, answered, wrong, box, met: [question ids in content order] }, most wrong first.
function weakUnits(k, pid, wid, idx) {
  const where = unitIndex(idx), by = new Map(), sums = new Map();
  const unitOfQ = (qid) => {
    const e = where.get(qid);
    if (!e) return null;
    if (!by.has(e.unit.id)) by.set(e.unit.id, { id: e.unit.id, title: e.unit.title, order: e.order, answered: 0, wrong: 0, box: 0, met: new Map() });
    return by.get(e.unit.id);
  };
  const answers = k.db.prepare('SELECT question_id, first_correct FROM learn_answers WHERE player_id = ? AND world_id = ?').all(pid, wid);
  for (const r of answers) { const u = unitOfQ(r.question_id); if (u) { u.answered++; if (!r.first_correct) u.wrong++; u.met.set(r.question_id, where.get(r.question_id).pos); } }
  for (const r of k.db.prepare('SELECT question_id, box FROM learn_review WHERE player_id = ? AND world_id = ?').all(pid, wid)) {
    const u = unitOfQ(r.question_id);
    if (!u) continue;
    u.met.set(r.question_id, where.get(r.question_id).pos);
    const s = sums.get(u.id) ?? { sum: 0, n: 0 };
    sums.set(u.id, { sum: s.sum + r.box, n: s.n + 1 });
  }
  for (const u of by.values()) { const s = sums.get(u.id); u.box = s ? s.sum / s.n : 0; u.met = [...u.met].sort((a, b) => a[1] - b[1]).map((x) => x[0]); }
  return { ranked: weakOrder([...by.values()]), unlocked: answers.length > 0 };
}
// The pool: what the student has met in the weakest units; while `enough(ids)` is false, the next weakest unit is added. -> content-ordered question ids
function poolOf(ranked, enough) {
  let n = Math.min(P.WEAK_UNITS, ranked.length), ids = [];
  for (;;) {
    ids = ranked.slice(0, n).flatMap((u) => u.met);
    if (enough(ids) || n >= ranked.length) return ids;
    n++;
  }
}
const termsOf = (ids, idx) => { const seen = new Map(); for (const id of ids) for (const t of idx.questions.get(id)?.terms ?? []) if (!seen.has(t.term.trim().toLowerCase())) seen.set(t.term.trim().toLowerCase(), { ...t, qid: id }); return [...seen.values()]; };

// ---- the open session and the numbers on /state ----
export const openRow = (k, pid, wid) => {
  const row = k.db.prepare(`SELECT * FROM learn_attempts WHERE player_id = ? AND world_id = ? AND ${OPEN} AND finished_at IS NULL`).get(pid, wid);
  return row && { ...row, st: legacy(JSON.parse(row.state)) };
};
// An old open 'pyramid' attempt is closed gracefully as a finished climb that keeps the XP it had banked (2 per cleared step). Nothing is written until finish.
const legacy = (st) => st.mode !== 'pyramid' ? st : { mode: 'climb', n: st.n, day: st.day, pool: [], at: 0, step: 0, cur: [], done: [], over: true, ended: 'legacy', first: {}, legacy_xp: (st.cleared ?? 0) * 2 };
const sessions = (k, pid, wid) => k.db.prepare(`SELECT COUNT(*) AS n FROM learn_attempts WHERE player_id = ? AND world_id = ? AND ${OPEN}`).get(pid, wid).n;
const usedToday = (k, pid, wid, day) => k.db.prepare('SELECT xp FROM learn_practice_days WHERE player_id = ? AND world_id = ? AND day = ?').get(pid, wid, day)?.xp ?? 0;

// The Practice block of /state, and the titles of the weak units. Reads only.
export function practiceOf(k, pid, wid, idx) {
  const today = k.clock.today(), { ranked, unlocked } = weakUnits(k, pid, wid, idx), open = openRow(k, pid, wid);
  return {
    practice: { state: unlocked ? 'ready' : 'locked', next_mode: open ? open.st.mode : modeFor(sessions(k, pid, wid)), open: !!open, xp_today: usedToday(k, pid, wid, today), cap: P.DAILY_XP_CAP },
    weak: unlocked ? ranked.slice(0, P.WEAK_UNITS).map((u) => u.title) : [],
  };
}

// ---- what the client may see of a session ----
const qOut = (idx, id) => ({ ...publicQuestion(idx.questions.get(id)), from: unitIndex(idx).get(id).unit.title });
const timedXp = (right) => P.CHECKPOINTS.reduce((s, [at, xp]) => s + (right >= at ? xp : 0), 0);
const isOver = (k, st) => k.clock.now() >= st.ends_at;
export function viewOf(k, a, idx) {
  const st = a.st, base = { mode: st.mode, session: st.n };
  if (st.mode === 'match') {
    const byT = new Map(st.pairs.map((p) => [p.t, p]));
    return { ...base, pairs: st.pairs.length, terms: st.tOrder.map((id) => ({ id, term: byT.get(id).term })), meanings: st.mOrder.map((id) => ({ id, meaning: st.pairs.find((p) => p.m === id).meaning })),
      matched: st.matched.map((t) => ({ term_id: t, meaning_id: byT.get(t).m })), wrong: st.wrong, done: st.matched.length === st.pairs.length };
  }
  if (st.mode === 'climb') {
    return { ...base, levels: P.CLIMB_LEVELS, per_level: P.CLIMB_STEPS, xp_steps: P.CLIMB_XP, step: st.step, banked: climbBanked(st), over: st.over, ended: st.ended ?? null,
      size: st.cur.length, position: st.done.length, questions: st.cur.slice(st.done.length).map((id) => qOut(idx, id)), xp: climbXp(st) };
  }
  const over = isOver(k, st);
  return { ...base, seconds: P.TIMED_SECONDS, ends_at: st.ends_at, server_now: k.clock.now(), over, right: st.right, answered: st.answered,
    checkpoints: P.CHECKPOINTS.map(([at, xp]) => ({ right: at, xp, reached: st.right >= at })), xp: timedXp(st.right), question: over ? null : qOut(idx, st.pool[st.at % st.pool.length]) };
}

// ---- start: resume the open session or build one. The ids are fixed here, so leaving and coming back never changes the set. ----
export function startPractice(k, user, w) {
  const idx = courseOf(k, user.id);
  if (!idx) throw new k.HttpError(404, 'That course does not exist');
  let a = openRow(k, user.id, w.id);
  if (!a) {
    const { ranked, unlocked } = weakUnits(k, user.id, w.id, idx);
    if (!unlocked) throw new k.HttpError(409, 'Finish a level to unlock Practice.');
    const day = k.clock.today(), n = sessions(k, user.id, w.id), seed = seedOf(user.id, w.id, day, n);
    let mode = modeFor(n), st;
    if (mode === 'match') {
      const ids = poolOf(ranked, (x) => termsOf(x, idx).length >= P.MATCH_PAIRS), terms = shuffle(termsOf(ids, idx), seed).slice(0, P.MATCH_PAIRS);
      if (terms.length >= P.MATCH_MIN_PAIRS) {
        // The ids are only places in each column's own shuffled order, so they say nothing about which word goes with which meaning; the pairing stays here.
        const tl = shuffle(terms, `${seed}:terms`), ml = shuffle(terms, `${seed}:meanings`);
        if (ml.every((t, i) => t === tl[i])) ml.push(ml.shift());       // never the same order in both columns
        const tid = new Map(tl.map((t, i) => [t, `t${i + 1}`])), mid = new Map(ml.map((t, i) => [t, `m${i + 1}`]));
        st = { mode, n, day, pairs: terms.map((t) => ({ t: tid.get(t), m: mid.get(t), term: t.term, meaning: t.meaning })), tOrder: tl.map((t) => tid.get(t)), mOrder: ml.map((t) => mid.get(t)), matched: [], wrong: 0 };
      } else mode = 'climb';                                             // a student who has met fewer than three words plays an XP Climb instead
    }
    if (!st) {
      const pool = shuffle(poolOf(ranked, (x) => x.length >= P.POOL_MIN), seed).slice(0, P.POOL_MAX);
      if (mode === 'climb') { st = { mode, n, day, pool, at: 0, step: 0, cur: [], done: [], over: false, first: {} }; drawStep(st); }
      else { const started = k.clock.now(); st = { mode, n, day, pool, at: 0, started, ends_at: started + P.TIMED_SECONDS * 1000, right: 0, answered: 0, first: {} }; }
    }
    const id = k.db.prepare('INSERT INTO learn_attempts (player_id, world_id, level_id, started_at, state) VALUES (?, ?, ?, ?, ?)')
      .run(user.id, w.id, `practice:${day}:${n}`, k.clock.now(), JSON.stringify(st)).lastInsertRowid;
    a = { id: Number(id), st };
  }
  return viewOf(k, a, idx);
}
const noPractice = (k) => new k.HttpError(409, 'Start Practice first.');

// ---- match: one pick, a word and a meaning ----
export function pickPractice(k, user, w, termId, meaningId) {
  const idx = courseOf(k, user.id), a = openRow(k, user.id, w.id);
  if (!a) throw noPractice(k);
  const st = a.st;
  if (st.mode !== 'match') throw new k.HttpError(409, 'This is not a matching game.');
  const pair = st.pairs.find((p) => p.t === termId);
  if (!pair || !st.mOrder.includes(meaningId)) throw new k.HttpError(404, 'That word is not in this game.');
  if (st.matched.includes(termId)) return { correct: true, already: true, ...viewOf(k, a, idx) };
  const correct = pair.m === meaningId;
  if (correct) st.matched.push(termId); else st.wrong++;
  saveAttempt(k, a);
  return { correct, ...viewOf(k, a, idx) };
}

// ---- climb: the rules live in these small functions. st.step = steps banked so far (0..9); the XP of a step is fixed in CLIMB_XP. ----
const CLIMB_TOTAL = P.CLIMB_LEVELS * P.CLIMB_STEPS;
const climbStepXp = (i) => P.CLIMB_XP[Math.floor(i / P.CLIMB_STEPS)][i % P.CLIMB_STEPS];
const climbBanked = (st) => st.legacy_xp !== undefined ? 0 : st.step;
function climbXp(st) {
  if (st.legacy_xp !== undefined) return st.legacy_xp;                   // an old open pyramid attempt: closed with the XP it had banked
  let xp = 0;
  for (let i = 0; i < st.step; i++) xp += climbStepXp(i);
  return xp;
}
// Ends the climb; the banked steps stay banked.
const climbEnd = (st, why) => { st.over = true; st.ended = why; st.cur = []; st.done = []; };
// Fills the current step from the pool; when the pool cannot fill it, the climb is over.
function drawStep(st) {
  const size = P.CLIMB_STEP_QUESTIONS;
  st.done = [];
  if (st.at + size > st.pool.length) return climbEnd(st, 'pool');
  st.cur = st.pool.slice(st.at, st.at + size);
  st.at += size;
}
// One answer in the climb. Wrong: the climb ends. Right: when both questions of the step are right it is banked, then the next step starts (or all nine are done).
function climbAnswered(st, correct) {
  if (!correct) return climbEnd(st, 'wrong');
  st.done.push(true);
  if (st.done.length < st.cur.length) return;
  st.step++;
  if (st.step >= CLIMB_TOTAL) climbEnd(st, 'complete'); else drawStep(st);
}

// ---- climb and timed: one answer ----
export function answerPractice(k, user, w, body) {
  const idx = courseOf(k, user.id), a = openRow(k, user.id, w.id);
  if (!a) throw noPractice(k);
  const st = a.st;
  if (st.mode === 'match') throw new k.HttpError(409, 'This is a matching game. Pick a word and its meaning.');
  const qid = k.input.str(body, 'question_id', { max: 80 });
  if (st.mode === 'timed' && isOver(k, st)) throw new k.HttpError(409, 'Time is up.');
  const here = st.mode === 'timed' ? st.pool[st.at % st.pool.length] : st.cur[st.done.length];
  if (st.over || qid !== here) throw new k.HttpError(409, st.over ? 'This round is over. Finish it to see your XP.' : 'Answer the question on the screen.');
  const q = idx.questions.get(qid);
  if (!q) throw new k.HttpError(404, 'That question is not in this session.');
  const { correct, why, working } = judge(q, parseValue(k, q, body));
  if (!st.first[qid]) {
    st.first[qid] = correct;
    if (!correct) {                                                      // a wrong first answer comes back in the daily review: box 0, due tomorrow
      k.db.prepare(`INSERT INTO learn_review (player_id, world_id, question_id, box, due_day) VALUES (?, ?, ?, 0, ?)
        ON CONFLICT (player_id, world_id, question_id) DO UPDATE SET box = 0, due_day = excluded.due_day`).run(user.id, w.id, qid, addDays(k.clock.today(), 1));
    }
  }
  if (st.mode === 'climb') climbAnswered(st, correct);
  else { st.answered++; if (correct) st.right++; st.at++; }
  saveAttempt(k, a);
  return { correct, why, ...(working ? { working } : {}), ...(correct ? { correct_value: q.answer } : {}), ...viewOf(k, a, idx) };
}

// ---- finish: the XP, the cap, the day ----
export function earnedXp(st) {
  if (st.mode === 'match') return st.matched.length === st.pairs.length ? (st.wrong === 0 ? P.MATCH_XP : P.MATCH_XP_WITH_MISS) : 0;
  if (st.mode === 'climb') return climbXp(st);
  return timedXp(st.right);
}
export function finishPractice(k, user, w) {
  const a = openRow(k, user.id, w.id);
  if (!a) throw noPractice(k);
  const st = a.st, earned = earnedXp(st);
  return k.db.txn(() => {
    if (!k.db.prepare('UPDATE learn_attempts SET finished_at = ? WHERE id = ? AND finished_at IS NULL').run(k.clock.now(), a.id).changes) throw new k.HttpError(409, 'That session is already finished.');
    const today = k.clock.today(), used = usedToday(k, user.id, w.id, today), added = Math.min(earned, Math.max(0, P.DAILY_XP_CAP - used));
    let kept = { day_kept: false, freeze_earned: false };
    if (earned > 0) {                                                    // 0 XP (a game left unfinished) does not keep the day
      k.db.prepare('INSERT INTO learn_practice_days (player_id, world_id, day, xp) VALUES (?, ?, ?, ?) ON CONFLICT (player_id, world_id, day) DO UPDATE SET xp = xp + excluded.xp').run(user.id, w.id, today, added);
      kept = keep(k, user.id, w.id, added);
    }
    const idx = courseOf(k, user.id);
    return { practice: true, mode: st.mode, session: st.n, xp: earned, xp_added: added, capped: added < earned, cap: P.DAILY_XP_CAP, xp_today: used + added,
      ...(st.mode === 'match' ? { wrong: st.wrong } : st.mode === 'climb' ? { banked: climbBanked(st), steps: CLIMB_TOTAL, ended: st.ended ?? null } : { right: st.right, answered: st.answered }),
      paid: false, reward_cents: 0, ...kept, next_mode: modeFor(st.n + 1), daily: dailyOf(k, user.id, w.id, idx) };
  });
}
