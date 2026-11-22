// learn: the reward, the state of the road, and one attempt at a level: start, answer, finish, and the bots.
import { addDays } from '../../lib/clock.js';
import { courseOf, progressRows, roadFor, assertOpen, nextInfo, loadAttempt, saveAttempt, entryFor } from './reads.js';
import { INTERVALS, keep, dailyOf } from './daily.js';
import { leagueOf } from './league.js';
import { practiceOf } from './practice.js';

const BASE_CENTS = 100, PER_FIRST_TRY_CENTS = 10, CAP_CENTS = 200;
const ok = Number.isSafeInteger;

// ---- reward: 100 cents + 10 per first-try answer, at most 200, times the world price index; paid once per level per world ----
export const rewardFor = (firstTry, indexBp) => {
  const raw = BASE_CENTS + PER_FIRST_TRY_CENTS * firstTry, capped = Math.min(raw, CAP_CENTS);
  return { cents: Math.round((capped * indexBp) / 10000), base: BASE_CENTS, bonus: PER_FIRST_TRY_CENTS * firstTry, capped: raw > CAP_CENTS, index_bp: indexBp };
};

export function state(k, user) {
  const idx = courseOf(k, user.id);
  const w = k.world.current();
  if (!idx) return { course: null, world_active: w?.status === 'active', sections: [] };
  const active = w?.status === 'active';
  const done = active ? progressRows(k, user.id, w.id) : new Map();
  const road = roadFor(k, user.id, idx, done);
  const indexBp = active ? k.world.priceIndex(w.id) : 10000;
  const levelOut = (e) => {
    const l = e.level, p = done.get(l.id);
    return { id: l.id, title: l.title, learn: l.learn, n: e.n, of: e.of, cards: l.cards.length, questions: l.questions.length, status: road.status.get(l.id),
      max_reward_cents: rewardFor(l.questions.length, indexBp).cents, ...(p ? { first_try: p.first_try, best_first_try: p.best_first_try, paid_cents: p.paid_cents } : {}),
      ...(road.status.get(l.id) === 'locked' && unitFor.get(e.unit.id).status !== 'closed' ? { after: e.n > 1 ? e.unit.levels[e.n - 2].title : null } : {}) };
  };
  const unitFor = new Map(road.units.map((u) => [u.unit.id, u]));
  const rows = [...done.values()];
  return {
    course: { id: idx.course.id, title: idx.course.title }, world_active: active,
    ...(active ? { daily: dailyOf(k, user.id, w.id, idx), league: leagueOf(k, user, w.id), ...practiceOf(k, user.id, w.id, idx) } : {}),
    totals: { levels_done: rows.length, levels_total: idx.levels.length, cents_earned: rows.reduce((s, r) => s + r.paid_cents, 0), first_try: rows.reduce((s, r) => s + r.first_try, 0), questions: rows.reduce((s, r) => s + r.questions, 0) },
    next: nextInfo(road.next),
    sections: idx.course.sections.map((s) => ({ id: s.id, title: s.title, blurb: s.blurb, units: s.units.map((u) => {
      const ur = unitFor.get(u.id);
      return { id: u.id, title: u.title, blurb: u.blurb, image: u.image ?? null, outcome_codes: u.outcome_codes, status: ur.status, levels_done: ur.done, levels_total: u.levels.length, levels: u.levels.map((l) => levelOut(idx.byLevel.get(l.id))) };
    }) })),
  };
}

// Opens the level for this student (or resumes the open attempt, so leaving and coming back never resets what counts as a first try).
export function openAttempt(k, user, w, levelId) {
  const { idx, e } = entryFor(k, user, levelId);
  assertOpen(k, user, e);
  const done = progressRows(k, user.id, w.id);
  const road = roadFor(k, user.id, idx, done);
  if (road.status.get(levelId) === 'locked') {
    const before = e.n > 1 ? e.unit.levels[e.n - 2].title : null;
    throw new k.HttpError(403, before ? `Finish "${before}" first.` : 'Finish the earlier unit first.');
  }
  let a = loadAttempt(k, user.id, w.id, levelId);
  if (!a) {
    const st = { first: {}, solved: [], queue: [] };
    const id = k.db.prepare('INSERT INTO learn_attempts (player_id, world_id, level_id, started_at, state) VALUES (?, ?, ?, ?, ?)').run(user.id, w.id, levelId, k.clock.now(), JSON.stringify(st)).lastInsertRowid;
    a = { id: Number(id), st, state: JSON.stringify(st) };
  }
  return { a, e, practice: done.has(levelId), indexBp: k.world.priceIndex(w.id) };
}

// value -> the thing compared with the answer, or a 400
export function parseValue(k, q, body) {
  const v = Object.hasOwn(body, 'value') ? body.value : undefined;
  if (q.type !== 'number') {
    const n = q.type === 'choice' ? q.options.length : (q.figure.points ?? q.figure.bars).length;
    if (!ok(v) || v < 0 || v >= n) throw new k.HttpError(400, `value must be a whole number from 0 to ${n - 1}`);
    return v;
  }
  const text = typeof v === 'number' && Number.isFinite(v) ? String(v) : v;
  if (typeof text !== 'string' || text.length > 30) throw new k.HttpError(400, 'Type a number such as 137.35');
  const t = text.replace(/[\s,]/g, '').replace(/^\$/, '').replace(/%$/, '');
  if (q.unit === '$') {
    const m = /^(\d{1,9})(?:\.(\d{1,2}))?$/.exec(t);
    if (!m) throw new k.HttpError(400, 'Type dollars and cents such as 137.35');
    return Number(m[1]) * 100 + Number((m[2] ?? '').padEnd(2, '0'));
  }
  if (!/^\d{1,9}(\.\d{1,4})?$/.test(t)) throw new k.HttpError(400, 'Type a number such as 52 or 5.95');
  return Number(t);
}
const near = (a, b, tol) => Math.abs(a - b) <= tol + 1e-9;
// The right answer written with fewer decimals, correctly rounded, also counts (Mr. Tang, 2026-11-18: "4.33 doesn't accept 4.3").
// At least one decimal must stay: $43.33 accepts 43.3 (and 43.30), not 43. Dollars are cents here, so one decimal = a multiple of 10 cents.
export function roundedMatch(q, v) {
  if (q.unit === '$') return q.answer % 10 !== 0 && v % 10 === 0 && Math.round(q.answer / 10) * 10 === v;
  const dec = String(q.answer).split('.')[1]?.length ?? 0;
  for (let d = 1; d < dec; d++) if (Math.abs(Math.round(q.answer * 10 ** d) / 10 ** d - v) < 1e-9) return true;
  return false;
}

// Is this value right, and what the student is told about it. Reads the question only (the teacher preview uses it with no attempt).
export function judge(q, v) {
  if (q.type === 'choice') return { correct: v === q.answer, why: q.options[v].why };
  if (q.type === 'point') { const correct = v === q.answer; return { correct, why: correct ? q.why : q.miss }; }
  const correct = near(v, q.answer, q.tolerance) || roundedMatch(q, v);
  const trap = !correct && q.traps?.find((t) => near(v, t.value, 0));
  return { correct, why: correct ? q.why : trap ? trap.why : q.miss, ...(correct ? { working: q.working } : {}) };
}

// One answer. Writes the attempt only. Returns what the student may see: never the answer of a question still unsolved.
export function check(k, a, e, q, v) {
  const st = a.st, left = () => e.level.questions.length - st.solved.length;
  if (st.solved.includes(q.id)) return { correct: true, already: true, left: left() };
  const { correct, why, working } = judge(q, v);
  if (!st.first[q.id]) st.first[q.id] = { v, ok: correct };                  // the FIRST answer decides the first-try count, whatever comes after
  if (correct) { st.solved.push(q.id); st.queue = st.queue.filter((x) => x !== q.id); } else if (!st.queue.includes(q.id)) st.queue.push(q.id);
  saveAttempt(k, a);
  return { correct, why, ...(working ? { working } : {}), ...(correct ? { correct_value: q.answer } : { queued: true }), left: left(), first_try: Object.values(st.first).filter((x) => x.ok).length };
}

export function finish(k, user, w, levelId) {
  const { idx, e } = entryFor(k, user, levelId);
  assertOpen(k, user, e);
  const a = loadAttempt(k, user.id, w.id, levelId);
  if (!a) throw new k.HttpError(409, 'Start the level first.');
  const qs = e.level.questions, st = a.st;
  const missing = qs.filter((q) => !st.solved.includes(q.id)).length;
  if (missing) throw new k.HttpError(409, `${missing} question${missing === 1 ? '' : 's'} still to get right.`);
  const firstTry = qs.filter((q) => st.first[q.id]?.ok).length;
  const prior = k.db.prepare('SELECT * FROM learn_progress WHERE player_id = ? AND world_id = ? AND level_id = ?').get(user.id, w.id, levelId);
  const indexBp = k.world.priceIndex(w.id);
  const words = [...new Map(qs.flatMap((q) => q.terms ?? []).map((t) => [t.term, t])).values()];
  const next = () => {
    const idx = courseOf(k, user.id), nxt = roadFor(k, user.id, idx, progressRows(k, user.id, w.id)).next;
    return nextInfo(nxt);
  };
  return k.db.txn(() => {
    if (!k.db.prepare('UPDATE learn_attempts SET finished_at = ? WHERE id = ? AND finished_at IS NULL').run(k.clock.now(), a.id).changes) throw new k.HttpError(409, 'That attempt is already finished.');
    if (prior) {                                                              // a replay: nothing is paid and the first completion's numbers stand; only the best is kept
      k.db.prepare('UPDATE learn_progress SET best_first_try = MAX(best_first_try, ?) WHERE player_id = ? AND world_id = ? AND level_id = ?').run(firstTry, user.id, w.id, levelId);
      return { first_try: firstTry, questions: qs.length, paid: false, reward_cents: 0, practice: true, words, next: next(), go: e.level.go ?? null, xp: 0, day_kept: false, freeze_earned: false, daily: dailyOf(k, user.id, w.id, courseOf(k, user.id)) };
    }
    const r = rewardFor(firstTry, indexBp);
    const chq = k.ledger.accountId('player', user.id, 'chequing');
    if (r.cents > 0 && chq) {
      k.ledger.post({ kind: 'reward', actor: 'system', meta: { worldId: w.id, level: levelId, firstTry, questions: qs.length }, legs: [
        { account: k.ledger.system('mint'), cents: -r.cents, memo: `Learning Road: ${e.level.title}` }, { account: chq, cents: r.cents, memo: `Learning Road: ${e.level.title}` }] });
    }
    const paid = r.cents > 0 && chq ? r.cents : 0;
    k.db.prepare('INSERT INTO learn_progress (player_id, world_id, level_id, first_try, questions, best_first_try, done_at, paid_cents) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .run(user.id, w.id, levelId, firstTry, qs.length, firstTry, k.clock.now(), paid);
    const ins = k.db.prepare('INSERT OR IGNORE INTO learn_answers (player_id, world_id, level_id, question_id, first_choice, first_correct, at) VALUES (?, ?, ?, ?, ?, ?, ?)');
    for (const q of qs) ins.run(user.id, w.id, levelId, q.id, String(st.first[q.id].v), st.first[q.id].ok ? 1 : 0, k.clock.now());
    const today = k.clock.today(), put = k.db.prepare('INSERT OR IGNORE INTO learn_review (player_id, world_id, question_id, box, due_day) VALUES (?, ?, ?, ?, ?)');
    for (const q of qs) { const box = st.first[q.id].ok ? 2 : 0; put.run(user.id, w.id, q.id, box, addDays(today, INTERVALS[box])); }
    const xp = 10 + firstTry, kept = keep(k, user.id, w.id, xp);
    k.db.afterCommit(() => k.events.emit('completed', { playerId: user.id, worldId: w.id, levelId, firstTry, questions: qs.length }));
    return { first_try: firstTry, questions: qs.length, paid: true, reward_cents: paid, reward: r, practice: false, words, next: next(), go: e.level.go ?? null, xp, ...kept, daily: dailyOf(k, user.id, w.id, courseOf(k, user.id)) };
  });
}

// Bots (scripts/sim.mjs): a day's play is 0-2 open levels, each answered through the same functions the routes use, ~70% right first time.
export function simulate(k, { month, students }) {
  const w = k.world.current();
  if (w?.status !== 'active') return;
  for (const s of students) {
    const idx = courseOf(k, s.id);
    if (!idx) continue;
    const roll = k.dice(s.id, month, 41), plays = roll < 35 ? 0 : roll < 85 ? 1 : 2;
    for (let i = 0; i < plays; i++) {
      const nxt = roadFor(k, s.id, idx, progressRows(k, s.id, w.id)).next;
      if (!nxt) break;
      const user = { id: s.id, class_id: s.class_id };
      const { a, e } = openAttempt(k, user, w, nxt.level.id);
      e.level.questions.forEach((q, qi) => {
        if (k.dice(s.id * 1000 + qi, month * 7 + i, 43) < 70) check(k, a, e, q, rightValue(q));
        else { check(k, a, e, q, wrongValue(q)); check(k, a, e, q, rightValue(q)); }
      });
      finish(k, user, w, nxt.level.id);
    }
  }
}
const rightValue = (q) => q.answer;
const wrongValue = (q) => (q.type === 'number' ? q.answer + q.tolerance + 7 : q.type === 'choice' ? (q.answer + 1) % q.options.length : (q.answer + 1) % (q.figure.points ?? q.figure.bars).length);

