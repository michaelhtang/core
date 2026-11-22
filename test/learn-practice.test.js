// learn, Practice (docs/learn.md "Practice"): the weakest units from a case table, the seeded shuffle, the mode rotation, the three modes end to end through the routes,
// the daily XP cap, that no money moves, and that a wrong practice answer comes back in the daily review.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createClock, addDays } from '../lib/clock.js';
import { boot, seeded } from './helpers.js';
import { learnFixture } from './learn-fixture.js';
import { PRACTICE, shuffle, seedOf, weakOrder, modeFor } from '../modules/learn/index.js';

const COURSE = JSON.parse(fs.readFileSync(new URL('../modules/learn/content/fintech10.json', import.meta.url), 'utf8'));
const UNIT_IDS = ['ft10-s1-u1', 'ft10-s1-u2', 'ft10-s1-u3', 'ft10-s1-u4'];
const UNITS = new Map(COURSE.sections.flatMap((s) => s.units).map((u) => [u.id, u]));
const QUESTIONS = new Map([...UNITS.values()].flatMap((u) => u.levels.flatMap((l) => l.questions.map((q) => [q.id, q]))));
const FIX = learnFixture({ keep: UNIT_IDS });
const T0 = Date.parse('2026-11-02T15:00:00Z');                   // Monday 2026-11-02, 08:00 in Edmonton
const DAY0 = '2026-11-02';
const right = (q) => (q.type === 'number' ? (q.unit === '$' ? (q.answer / 100).toFixed(2) : String(q.answer)) : q.answer);
const wrong = (q) => (q.type === 'number' ? (q.unit === '$' ? ((q.answer + q.tolerance + 777) / 100).toFixed(2) : (q.answer + q.tolerance + 7).toFixed(2))
  : q.type === 'choice' ? (q.answer + 1) % q.options.length : (q.answer + 1) % (q.figure.points ?? q.figure.bars).length);

// ---------- pure: the weakest units, the shuffle, the rotation ----------
test('weakest units: most wrong first, then the lower box, then content order; units with no answers are left out', () => {
  const u = (id, order, answered, wrong, box = 2) => ({ id, order, answered, wrong, box });
  const cases = [
    ['more wrong first', [u('a', 0, 10, 2), u('b', 1, 10, 5), u('c', 2, 10, 0)], ['b', 'a', 'c']],
    ['a share, not a count: 1 of 2 is worse than 3 of 10', [u('a', 0, 10, 3), u('b', 1, 2, 1)], ['b', 'a']],
    ['equal share: the lower average box first', [u('a', 0, 4, 2, 3), u('b', 1, 4, 2, 1), u('c', 2, 8, 4, 2)], ['b', 'c', 'a']],
    ['equal share and box: content order', [u('c', 2, 4, 2, 1), u('a', 0, 4, 2, 1), u('b', 1, 4, 2, 1)], ['a', 'b', 'c']],
    ['no answers: not ranked', [u('a', 0, 0, 0), u('b', 1, 3, 0)], ['b']],
    ['nothing at all', [], []],
  ];
  for (const [name, units, want] of cases) assert.deepEqual(weakOrder(units).map((x) => x.id), want, name);
});

test('the shuffle: same inputs, same order; another session number, another order; always a permutation', () => {
  const items = Array.from({ length: 30 }, (_, i) => `q${i}`);
  const seed = (n) => seedOf(7, 1, DAY0, n);
  assert.deepEqual(shuffle(items, seed(0)), shuffle(items, seed(0)));
  assert.notDeepEqual(shuffle(items, seed(0)), shuffle(items, seed(1)));
  assert.notDeepEqual(shuffle(items, seedOf(8, 1, DAY0, 0)), shuffle(items, seed(0)), 'another player');
  assert.notDeepEqual(shuffle(items, seedOf(7, 1, '2026-11-03', 0)), shuffle(items, seed(0)), 'another day');
  assert.deepEqual([...shuffle(items, seed(3))].sort(), [...items].sort());
  assert.deepEqual(items.length, 30, 'the input is not changed');
  assert.equal(items[0], 'q0');
  const src = fs.readFileSync(new URL('../modules/learn/practice.js', import.meta.url), 'utf8').replace(/\/\/.*$/gm, '');
  assert.doesNotMatch(src, /Math\.random|Date\.now|new Date\(\)/, 'no randomness and no wall clock');
});

test('the modes rotate in a fixed order by session number', () => {
  assert.deepEqual(PRACTICE.MODES, ['match', 'climb', 'timed']);
  assert.deepEqual([0, 1, 2, 3, 4, 5, 6].map(modeFor), ['match', 'climb', 'timed', 'match', 'climb', 'timed', 'match']);
});

// ---------- on a server ----------
async function world({ n = 2 } = {}) {
  let t = T0;
  const srv = await boot({ config: { courses: { fintech10: { label: 'x', modules: ['bank-basic', 'learn'] }, fintech2030: { label: 'y', modules: ['bank-basic', 'learn'] } }, options: { learn: { contentDir: FIX.dir } } }, clock: createClock({ now: () => t }) });
  const w = await seeded(srv, n, { transfers: false });
  const db = srv.app.db, rows = (sql, ...a) => db.prepare(sql).all(...a);
  const post = (s, p, body) => { t += 400; return s.client.post(p, body); };
  // A student who has finished levels. plan: unit -> [of every 4 questions, how many were wrong first time, the review box of the others]:
  // u3 worst (3 of 4), then u1 (2 of 4), then u4 (1 of 4), u2 all right. Wrong ones sit in box 0.
  const meet = (s, plan = { 'ft10-s1-u1': [2, 1], 'ft10-s1-u2': [0, 3], 'ft10-s1-u3': [3, 1], 'ft10-s1-u4': [1, 1] }) => {
    for (const [uid, [wrongOf4, box]] of Object.entries(plan)) {
      let i = 0;
      for (const l of UNITS.get(uid).levels) for (const q of l.questions) {
        const bad = i++ % 4 < wrongOf4;
        db.prepare('INSERT INTO learn_answers (player_id, world_id, level_id, question_id, first_choice, first_correct, at) VALUES (?, 1, ?, ?, ?, ?, ?)').run(s.id, l.id, q.id, '0', bad ? 0 : 1, T0);
        db.prepare('INSERT INTO learn_review (player_id, world_id, question_id, box, due_day) VALUES (?, 1, ?, ?, ?)').run(s.id, q.id, bad ? 0 : box, addDays(DAY0, 3));
      }
    }
  };
  const state = async (s) => (await s.client.get('/api/learn/state')).json;
  const start = (s) => post(s, '/api/learn/practice/start');
  const finish = (s) => post(s, '/api/learn/practice/finish');
  const attempt = (s) => { const r = rows("SELECT * FROM learn_attempts WHERE player_id = ? AND level_id GLOB 'practice:*' AND finished_at IS NULL", s.id)[0]; return r && { ...r, st: JSON.parse(r.state) }; };
  // Finish sessions with no XP until the next one is `mode`; returns that session's start reply.
  const toMode = async (s, mode) => {
    for (let i = 0; i < 4; i++) { const r = await start(s); assert.equal(r.status, 200, JSON.stringify(r.json)); if (r.json.mode === mode) return r; assert.equal((await finish(s)).status, 200); }
    throw new Error(`never reached ${mode}`);
  };
  const answer = (s, id, ok = true) => post(s, '/api/learn/practice/answer', { question_id: id, value: (ok ? right : wrong)(QUESTIONS.get(id)) });
  const counts = () => ({ txns: rows('SELECT COUNT(*) AS n FROM txns')[0].n, entries: rows('SELECT COUNT(*) AS n FROM entries')[0].n });
  return { srv, ...w, db, rows, post, meet, state, start, finish, attempt, toMode, answer, counts, adv: (ms) => { t += ms; }, nextDay: async () => { t += 864e5; for (const x of w.students) assert.equal((await x.client.post('/api/login', { username: x.username, secret: x.pin })).status, 200); }, now: () => t, cleanup: srv.cleanup };
}

test('locked until a level is finished, then the weak units, the next mode and the XP line show on /state', async () => {
  const w = await world({ n: 1 });
  try {
    const [s] = w.students;
    const before = await w.state(s);
    assert.deepEqual([before.practice.state, before.practice.next_mode, before.practice.xp_today, before.practice.cap, before.weak], ['locked', 'match', 0, 30, []]);
    const locked = await w.start(s);
    assert.deepEqual([locked.status, locked.json.error ?? locked.json.message], [409, 'Finish a level to unlock Practice.']);
    w.meet(s);
    const st = await w.state(s);
    assert.deepEqual([st.practice.state, st.practice.next_mode], ['ready', 'match']);
    assert.deepEqual(st.weak, ['ft10-s1-u3', 'ft10-s1-u1', 'ft10-s1-u4'].map((id) => UNITS.get(id).title), 'the three weakest units, weakest first');
    // a /state read writes nothing
    const n = w.rows('SELECT COUNT(*) AS n FROM learn_attempts')[0].n;
    await w.state(s);
    assert.equal(w.rows('SELECT COUNT(*) AS n FROM learn_attempts')[0].n, n);
  } finally { await w.cleanup(); }
});

test('match: opaque ids, the server checks every pick, 5 XP for a clean game and 3 with a miss; resuming gives the same game; no money moves', async () => {
  const w = await world({ n: 2 });
  try {
    const [a, b] = w.students;
    w.meet(a); w.meet(b);
    const before = w.counts();
    const r = await w.start(a);
    assert.equal(r.status, 200);
    const v = r.json;
    assert.deepEqual([v.mode, v.pairs, v.terms.length, v.meanings.length, v.done, v.wrong], ['match', 5, 5, 5, false, 0]);
    assert.deepEqual(Object.keys(v.terms[0]).sort(), ['id', 'term']);
    assert.deepEqual(Object.keys(v.meanings[0]).sort(), ['id', 'meaning']);
    assert.equal(new Set(v.terms.map((x) => x.term)).size, 5, 'no word twice');
    const pairs = w.attempt(a).st.pairs;
    assert.equal(w.attempt(a).level_id, `practice:${DAY0}:0`);
    assert.ok(pairs.some((p) => p.t.slice(1) !== p.m.slice(1)), 'an id is a place in its own column, so the ids say nothing about the pairing');
    // every pair is a real term of the pool: the terms in the question content
    const known = new Set([...QUESTIONS.values()].flatMap((q) => q.terms ?? []).map((t) => `${t.term}|${t.meaning}`));
    for (const p of pairs) assert.ok(known.has(`${p.term}|${p.meaning}`), p.term);
    // resume: the same game
    assert.deepEqual((await w.start(a)).json, v);
    // a wrong pick, then the right ones
    const [p0, p1] = pairs;
    const miss = await w.post(a, '/api/learn/practice/pick', { term_id: p0.t, meaning_id: p1.m });
    assert.deepEqual([miss.status, miss.json.correct, miss.json.wrong, miss.json.matched.length], [200, false, 1, 0]);
    assert.equal((await w.post(a, '/api/learn/practice/pick', { term_id: 'nope', meaning_id: p1.m })).status, 404);
    assert.equal((await w.finish(a)).json.xp, 0, 'a game left half done earns nothing');
    // a clean game for the other student
    const rb = (await w.start(b)).json, pb = w.attempt(b).st.pairs;
    let last;
    for (const p of pb) last = (await w.post(b, '/api/learn/practice/pick', { term_id: p.t, meaning_id: p.m })).json;
    assert.deepEqual([last.done, last.matched.length, last.wrong], [true, 5, 0]);
    assert.equal(rb.pairs, 5);
    const fin = await w.finish(b);
    assert.equal(fin.status, 200);
    assert.deepEqual([fin.json.xp, fin.json.xp_added, fin.json.capped, fin.json.paid, fin.json.reward_cents, fin.json.mode, fin.json.next_mode], [5, 5, false, false, 0, 'match', 'climb']);
    assert.equal(fin.json.daily.xp_today, 5);
    assert.equal(fin.json.daily.kept_today, true);
    assert.equal((await w.finish(b)).status, 409, 'finished once');
    assert.deepEqual(w.counts(), before, 'no ledger rows');
  } finally { await w.cleanup(); }
});

test('match: a miss makes it 3 XP', async () => {
  const w = await world({ n: 1 });
  try {
    const [s] = w.students;
    w.meet(s);
    await w.start(s);
    const pairs = w.attempt(s).st.pairs;
    await w.post(s, '/api/learn/practice/pick', { term_id: pairs[0].t, meaning_id: pairs[1].m });
    for (const p of pairs) await w.post(s, '/api/learn/practice/pick', { term_id: p.t, meaning_id: p.m });
    const fin = (await w.finish(s)).json;
    assert.deepEqual([fin.xp, fin.wrong], [3, 1]);
  } finally { await w.cleanup(); }
});

test('climb: 3 levels of 3 steps, 2 questions a step; a step banks on two right answers; fixed XP per step; all 9 steps = 27 XP', async () => {
  const w = await world({ n: 1 });
  try {
    const [s] = w.students;
    w.meet(s);
    const before = w.counts();
    assert.deepEqual([PRACTICE.CLIMB_LEVELS, PRACTICE.CLIMB_STEPS, PRACTICE.CLIMB_STEP_QUESTIONS, PRACTICE.CLIMB_XP], [3, 3, 2, [[1, 2, 3], [2, 3, 4], [3, 4, 5]]]);
    let v = (await w.toMode(s, 'climb')).json;
    assert.deepEqual([v.mode, v.levels, v.per_level, v.xp_steps, v.step, v.banked, v.size, v.position, v.questions.length, v.over, v.xp], ['climb', 3, 3, [[1, 2, 3], [2, 3, 4], [3, 4, 5]], 0, 0, 2, 0, 2, false, 0]);
    for (const key of ['answer', 'why', 'working', 'miss', 'traps']) assert.ok(!(key in v.questions[0]), `${key} leaked`);
    assert.deepEqual((await w.start(s)).json, v, 'resuming gives the same step');
    const other = [...QUESTIONS.keys()].find((id) => id !== v.questions[0].id);
    assert.equal((await w.answer(s, other)).status, 409, 'not the question on the screen');
    // one right answer does not bank the step
    v = (await w.answer(s, v.questions[0].id)).json;
    assert.deepEqual([v.step, v.banked, v.position, v.xp], [0, 0, 1, 0]);
    // the second banks it (+1 XP) and the next step starts
    v = (await w.answer(s, v.questions[0].id)).json;
    assert.deepEqual([v.step, v.banked, v.position, v.questions.length, v.xp], [1, 1, 0, 2, 1]);
    const seen = [1];
    while (!v.over) { v = (await w.answer(s, v.questions[0].id)).json; seen.push(v.xp); }
    assert.deepEqual([v.banked, v.xp, v.ended], [9, 27, 'complete']);
    assert.deepEqual([...new Set(seen)], [1, 3, 6, 8, 11, 15, 18, 22, 27], 'XP rises by the step: 1 2 3, 2 3 4, 3 4 5');
    assert.equal((await w.post(s, '/api/learn/practice/answer', { question_id: 'whatever', value: 0 })).status, 409, 'nothing more to answer');
    const fin = (await w.finish(s)).json;
    assert.deepEqual([fin.xp, fin.xp_added, fin.banked, fin.steps, fin.mode, fin.next_mode, fin.paid, fin.reward_cents], [27, 27, 9, 9, 'climb', 'timed', false, 0]);
    assert.ok(27 <= PRACTICE.DAILY_XP_CAP);
    assert.deepEqual(w.counts(), before);
  } finally { await w.cleanup(); }
});

test('climb: a wrong answer ends the climb at once, keeps the banked XP and puts the question back in the review', async () => {
  const w = await world({ n: 1 });
  try {
    const [s] = w.students;
    w.meet(s);
    let v = (await w.toMode(s, 'climb')).json;
    for (let i = 0; i < 4; i++) v = (await w.answer(s, v.questions[0].id)).json;     // steps 1 and 2 banked: 1 + 2 XP
    assert.deepEqual([v.banked, v.xp], [2, 3]);
    const q = v.questions[0].id;
    const miss = (await w.answer(s, q, false)).json;
    assert.deepEqual([miss.correct, miss.over, miss.ended, miss.banked, miss.xp, miss.questions.length], [false, true, 'wrong', 2, 3, 0]);
    assert.ok(!('correct_value' in miss), 'the right answer of a missed question is not given');
    assert.deepEqual({ ...w.rows('SELECT box, due_day FROM learn_review WHERE player_id = ? AND question_id = ?', s.id, q)[0] }, { box: 0, due_day: addDays(DAY0, 1) });
    assert.equal((await w.answer(s, q)).status, 409, 'the climb is over');
    const fin = (await w.finish(s)).json;
    assert.deepEqual([fin.xp, fin.xp_added, fin.banked, fin.ended], [3, 3, 2, 'wrong']);
  } finally { await w.cleanup(); }
});

test('climb: the second question of a step wrong ends the climb too, and a wrong first step earns nothing', async () => {
  const w = await world({ n: 1 });
  try {
    const [s] = w.students;
    w.meet(s);
    let v = (await w.toMode(s, 'climb')).json;
    v = (await w.answer(s, v.questions[0].id)).json;
    v = (await w.answer(s, v.questions[0].id, false)).json;
    assert.deepEqual([v.over, v.banked, v.xp], [true, 0, 0]);
    const fin = (await w.finish(s)).json;
    assert.deepEqual([fin.xp, fin.xp_added], [0, 0]);
  } finally { await w.cleanup(); }
});

test('climb: stopping early keeps the XP of the banked steps', async () => {
  const w = await world({ n: 1 });
  try {
    const [s] = w.students;
    w.meet(s);
    let v = (await w.toMode(s, 'climb')).json;
    for (let i = 0; i < 6; i++) v = (await w.answer(s, v.questions[0].id)).json;     // 3 steps = level 1 = 1 + 2 + 3
    v = (await w.answer(s, v.questions[0].id)).json;                                 // half of step 4: not banked
    assert.deepEqual([v.over, v.banked, v.xp], [false, 3, 6]);
    const fin = (await w.finish(s)).json;
    assert.deepEqual([fin.xp, fin.xp_added, fin.banked], [6, 6, 3]);
    assert.equal(w.rows('SELECT xp FROM learn_days WHERE player_id = ? AND day = ?', s.id, DAY0)[0].xp, 6);
  } finally { await w.cleanup(); }
});

test('climb: the pool running out ends it with the XP banked', async () => {
  const w = await world({ n: 1 });
  try {
    const [s] = w.students;
    w.meet(s, { 'ft10-s1-u1': [2, 1] });                                   // one unit, so the pool is just what was met there
    await w.toMode(s, 'climb');
    const a = w.attempt(s);
    const st = a.st;
    st.pool = st.pool.slice(0, 5);                                         // five questions: the open step, one more step, and one left over
    w.db.prepare('UPDATE learn_attempts SET state = ? WHERE id = ?').run(JSON.stringify({ ...st }), a.id);
    let v = (await w.start(s)).json, n = 0;
    while (!v.over && n < 20) { n++; v = (await w.answer(s, v.questions[0].id)).json; }
    assert.deepEqual([v.over, v.ended, v.banked, v.xp, n], [true, 'pool', 2, 3, 4]);
    assert.equal((await w.finish(s)).json.xp, 3);
  } finally { await w.cleanup(); }
});

test('an old open pyramid attempt is closed as a finished climb that keeps the XP it banked (2 per cleared step); nothing breaks', async () => {
  const w = await world({ n: 1 });
  try {
    const [s] = w.students;
    w.meet(s);
    const old = { mode: 'pyramid', n: 1, day: DAY0, pool: ['a', 'b'], at: 2, step: 2, cur: ['a'], done: [], cleared: 2, over: false, first: {} };
    w.db.prepare('INSERT INTO learn_attempts (player_id, world_id, level_id, started_at, state) VALUES (?, 1, ?, ?, ?)').run(s.id, `practice:${DAY0}:1`, T0, JSON.stringify(old));
    assert.equal((await w.state(s)).practice.open, true);
    assert.equal((await w.state(s)).practice.next_mode, 'climb');
    const r = await w.start(s);
    assert.deepEqual([r.status, r.json.mode, r.json.over, r.json.questions.length, r.json.xp], [200, 'climb', true, 0, 4]);
    assert.equal((await w.post(s, '/api/learn/practice/answer', { question_id: 'a', value: 0 })).status, 409, 'nothing to answer');
    const fin = (await w.finish(s)).json;
    assert.deepEqual([fin.mode, fin.xp, fin.xp_added, fin.paid, fin.reward_cents, fin.next_mode], ['climb', 4, 4, false, 0, 'timed']);
    assert.equal((await w.state(s)).practice.open, false);
  } finally { await w.cleanup(); }
});

test('timed: 120 seconds on the server clock, checkpoints at 3, 6 and 10 right, answers after the time are refused', async () => {
  const w = await world({ n: 1 });
  try {
    const [s] = w.students;
    w.meet(s);
    const before = w.counts();
    const r = await w.toMode(s, 'timed');
    let v = r.json;
    assert.deepEqual([v.mode, v.seconds, v.over, v.right, v.xp, v.checkpoints.map((c) => [c.right, c.xp])], ['timed', 120, false, 0, 0, [[3, 2], [6, 3], [10, 5]]]);
    assert.equal(v.ends_at - v.server_now <= 120000 && v.ends_at - v.server_now > 119000, true, 'about two minutes to go');
    assert.deepEqual((await w.start(s)).json.question, v.question, 'resuming asks the same question');
    for (let i = 1; i <= 6; i++) {
      v = (await w.answer(s, v.question.id)).json;
      assert.equal(v.right, i);
      assert.equal(v.xp, i >= 6 ? 5 : i >= 3 ? 2 : 0, `xp after ${i}`);
    }
    const wrongOne = (await w.answer(s, v.question.id, false)).json;
    assert.deepEqual([wrongOne.correct, wrongOne.right, wrongOne.answered], [false, 6, 7]);
    w.adv(121000);                                                           // past the end
    const late = await w.answer(s, wrongOne.question?.id ?? v.question.id);
    assert.deepEqual([late.status, late.json.error ?? late.json.message], [409, 'Time is up.']);
    assert.equal((await w.start(s)).json.over, true);
    const fin = (await w.finish(s)).json;
    assert.deepEqual([fin.xp, fin.xp_added, fin.right, fin.answered, fin.paid, fin.reward_cents], [5, 5, 6, 7, false, 0]);
    assert.deepEqual(w.counts(), before);
  } finally { await w.cleanup(); }
});

test('timed: ten right is 2 + 3 + 5 XP; the pool cycles when it runs out; the student can finish early', async () => {
  const w = await world({ n: 1 });
  try {
    const [s] = w.students;
    w.meet(s, { 'ft10-s1-u1': [2, 1] });
    let v = (await w.toMode(s, 'timed')).json;
    const pool = w.attempt(s).st.pool.length;
    for (let i = 0; i < 10; i++) v = (await w.answer(s, v.question.id)).json;
    assert.deepEqual([v.right, v.xp], [10, 10]);
    assert.ok(pool > 0);
    assert.equal(w.attempt(s).st.pool[w.attempt(s).st.at % pool], v.question.id);
    assert.equal((await w.finish(s)).json.xp, 10);
  } finally { await w.cleanup(); }
});

test('the daily cap: XP beyond 30 a day is shown as earned but adds nothing to learn_days; the day is still kept', async () => {
  const w = await world({ n: 1 });
  try {
    const [s] = w.students;
    w.meet(s);
    w.db.prepare('INSERT INTO learn_practice_days (player_id, world_id, day, xp) VALUES (?, 1, ?, 28)').run(s.id, DAY0);
    w.db.prepare('INSERT INTO learn_days (player_id, world_id, day, xp) VALUES (?, 1, ?, 28)').run(s.id, DAY0);
    await w.start(s);
    for (const p of w.attempt(s).st.pairs) await w.post(s, '/api/learn/practice/pick', { term_id: p.t, meaning_id: p.m });
    const f1 = (await w.finish(s)).json;
    assert.deepEqual([f1.xp, f1.xp_added, f1.capped, f1.cap, f1.xp_today], [5, 2, true, 30, 30]);
    assert.equal(w.rows('SELECT xp FROM learn_days WHERE player_id = ? AND day = ?', s.id, DAY0)[0].xp, 30);
    assert.equal(f1.daily.kept_today, true);
    // another session the same day: all of it is over the cap
    let v = (await w.start(s)).json;
    v = (await w.answer(s, v.questions[0].id)).json;
    v = (await w.answer(s, v.questions[0].id)).json;                       // one step banked: 1 XP, all of it over the cap
    const f2 = (await w.finish(s)).json;
    assert.deepEqual([f2.mode, f2.xp, f2.xp_added, f2.capped, f2.xp_today], ['climb', 1, 0, true, 30]);
    assert.equal(w.rows('SELECT xp FROM learn_days WHERE player_id = ? AND day = ?', s.id, DAY0)[0].xp, 30);
    assert.deepEqual((await w.state(s)).practice, { state: 'ready', next_mode: 'timed', open: false, xp_today: 30, cap: 30 });
    // tomorrow the cap is new
    await w.nextDay();
    assert.equal((await w.state(s)).practice.xp_today, 0);
  } finally { await w.cleanup(); }
});

test('a student with no match words falls back to an XP Climb, and the rotation carries on; practice before any level is refused on every route', async () => {
  const w = await world({ n: 1 });
  try {
    const [s] = w.students;
    for (const [p, body] of [['answer', { question_id: 'x', value: 0 }], ['pick', { term_id: 't1', meaning_id: 'm1' }], ['finish', {}]]) {
      assert.equal((await w.post(s, `/api/learn/practice/${p}`, body)).status, 409, p);
    }
    const noTerms = [...UNITS.values()].flatMap((u) => u.levels.flatMap((l) => l.questions)).filter((q) => !q.terms?.length).slice(0, 12);
    const lvl = UNITS.get('ft10-s1-u1').levels[0].id;
    noTerms.forEach((q) => {
      w.db.prepare('INSERT OR IGNORE INTO learn_answers (player_id, world_id, level_id, question_id, first_choice, first_correct, at) VALUES (?, 1, ?, ?, ?, 0, ?)').run(s.id, lvl, q.id, '0', T0);
      w.db.prepare('INSERT OR IGNORE INTO learn_review (player_id, world_id, question_id, box, due_day) VALUES (?, 1, ?, 0, ?)').run(s.id, q.id, DAY0);
    });
    const r = await w.start(s);
    assert.equal(r.json.mode, 'climb');
  } finally { await w.cleanup(); }
});

test('the mode rotation through the routes: match, climb, timed, match; the next mode is on /state', async () => {
  const w = await world({ n: 1 });
  try {
    const [s] = w.students;
    w.meet(s);
    const seen = [];
    for (let i = 0; i < 4; i++) {
      const next = (await w.state(s)).practice.next_mode, r = await w.start(s);
      assert.equal(r.json.mode, next);
      seen.push(r.json.mode);
      assert.equal((await w.state(s)).practice.open, true);
      assert.equal((await w.finish(s)).status, 200);
    }
    assert.deepEqual(seen, ['match', 'climb', 'timed', 'match']);
  } finally { await w.cleanup(); }
});

test('the same student, world, day and session number always get the same set', async () => {
  const sets = [];
  for (let i = 0; i < 2; i++) {
    const w = await world({ n: 1 });
    try { const [s] = w.students; w.meet(s); await w.toMode(s, 'climb'); sets.push(w.attempt(s).st.pool); } finally { await w.cleanup(); }
  }
  assert.deepEqual(sets[0], sets[1]);
  assert.ok(sets[0].length >= PRACTICE.POOL_MIN);
});
