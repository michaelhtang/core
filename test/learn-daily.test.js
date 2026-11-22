// learn, the daily loop (docs/learn.md "Daily loop"): the streak rules from a case table, the daily review end to end, XP, the class league,
// and that /api/me and /state never write.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createClock, addDays } from '../lib/clock.js';
import { boot, seeded, addClass } from './helpers.js';
import { learnFixture } from './learn-fixture.js';
import { streakView, keepDay } from '../modules/learn/index.js';

const COURSE = JSON.parse(fs.readFileSync(new URL('../modules/learn/content/fintech10.json', import.meta.url), 'utf8'));
const FIX = learnFixture();
const LEVELS = COURSE.sections[0].units.find((u) => u.id === 'ft10-s1-u2').levels, L1 = LEVELS[0].id, L2 = LEVELS[1].id;
const QUESTIONS = new Map(LEVELS.flatMap((l) => l.questions.map((q) => [q.id, q])));
const T0 = Date.parse('2026-11-02T15:00:00Z');                   // Monday 2026-11-02, 08:00 in Edmonton
const DAY0 = '2026-11-02';
const right = (q) => (q.type === 'number' ? (q.unit === '$' ? (q.answer / 100).toFixed(2) : String(q.answer)) : q.answer);
const wrong = (q) => (q.type === 'number' ? (q.unit === '$' ? ((q.answer + q.tolerance + 777) / 100).toFixed(2) : String(q.answer + q.tolerance + 7))
  : q.type === 'choice' ? (q.answer + 1) % q.options.length : (q.answer + 1) % (q.figure.points ?? q.figure.bars).length);

// ---------- the streak rules, pure ----------
test('streak: every case of the table', () => {
  const row = (streak, freezes, last_day, best = streak) => ({ streak, best, freezes, last_day });
  const D = '2026-11-10';
  const cases = [
    // [name, row, expected view {streak, freezes, kept_today}, expected keep {streak, freezes, frozen, changed, earned}]
    ['first ever keep', null, { streak: 0, freezes: 0, kept_today: false }, { streak: 1, freezes: 0, frozen: [], changed: true, earned: false }],
    ['kept already today', row(3, 1, D), { streak: 3, freezes: 1, kept_today: true }, { streak: 3, freezes: 1, frozen: [], changed: false, earned: false }],
    ['kept yesterday', row(3, 0, '2026-11-09'), { streak: 3, freezes: 0, kept_today: false }, { streak: 4, freezes: 0, frozen: [], changed: true, earned: false }],
    ['gap equal to the freezes held', row(3, 2, '2026-11-07'), { streak: 3, freezes: 2, kept_today: false }, { streak: 4, freezes: 0, frozen: ['2026-11-08', '2026-11-09'], changed: true, earned: false }],
    ['gap one larger than the freezes', row(3, 1, '2026-11-07'), { streak: 0, freezes: 0, kept_today: false }, { streak: 1, freezes: 0, frozen: [], changed: true, earned: false }],
    ['a gap with no freeze', row(5, 0, '2026-11-08'), { streak: 0, freezes: 0, kept_today: false }, { streak: 1, freezes: 0, frozen: [], changed: true, earned: false }],
    ['reaching 7 with 0 freezes', row(6, 0, '2026-11-09'), { streak: 6, freezes: 0, kept_today: false }, { streak: 7, freezes: 1, frozen: [], changed: true, earned: true }],
    ['reaching 7 with 1 freeze', row(6, 1, '2026-11-09'), { streak: 6, freezes: 1, kept_today: false }, { streak: 7, freezes: 2, frozen: [], changed: true, earned: true }],
    ['reaching 7 with 2 freezes stays 2', row(6, 2, '2026-11-09'), { streak: 6, freezes: 2, kept_today: false }, { streak: 7, freezes: 2, frozen: [], changed: true, earned: false }],
    ['a frozen day does not count toward 7', row(5, 1, '2026-11-08'), { streak: 5, freezes: 1, kept_today: false }, { streak: 6, freezes: 0, frozen: ['2026-11-09'], changed: true, earned: false }],
    ['6 plus a covered day plus today is 7, not 8', row(6, 1, '2026-11-08'), { streak: 6, freezes: 1, kept_today: false }, { streak: 7, freezes: 1, frozen: ['2026-11-09'], changed: true, earned: true }],
  ];
  for (const [name, r, view, keep] of cases) {
    const v = streakView(r, D);
    assert.deepEqual({ streak: v.streak, freezes: v.freezes, kept_today: v.kept_today }, view, `view: ${name}`);
    const k = keepDay(r, D);
    assert.deepEqual({ streak: k.row.streak, freezes: k.row.freezes, frozen: k.frozen, changed: k.changed, earned: k.earned }, keep, `keep: ${name}`);
    if (k.changed) { assert.equal(k.row.last_day, D, name); assert.ok(k.row.best >= k.row.streak, name); }
    assert.deepEqual(keepDay(k.row, D).row, k.row, `keeping twice the same day changes nothing: ${name}`);
  }
  assert.equal(keepDay(row(9, 0, '2026-11-09', 12), D).row.best, 12, 'best is never lowered');
});

test('streak: the day turns over at midnight Edmonton time', () => {
  let t = Date.parse('2026-11-03T06:59:00Z');                      // 23:59 on 2 Nov in Edmonton (UTC-7)
  const clock = createClock({ now: () => t });
  assert.equal(clock.today(), '2026-11-02');
  const first = keepDay(null, clock.today());
  t += 2 * 60 * 1000;                                              // 00:01 on 3 Nov
  assert.equal(clock.today(), '2026-11-03');
  assert.equal(streakView(first.row, clock.today()).kept_today, false);
  assert.equal(keepDay(first.row, clock.today()).row.streak, 2);
});

// ---------- the loop on a server ----------
async function world({ n = 3 } = {}) {
  let t = T0;
  const srv = await boot({ config: { courses: { fintech10: { label: 'x', modules: ['bank-basic', 'learn'] }, fintech2030: { label: 'y', modules: ['bank-basic', 'learn'] } }, options: { learn: { contentDir: FIX.dir } } }, clock: createClock({ now: () => t }) });
  const w = await seeded(srv, n, { transfers: false });
  const rows = (sql, ...a) => srv.app.db.prepare(sql).all(...a);
  const post = (s, p, body) => { t += 400; return s.client.post(p, body); };
  const playLevel = async (s, levelId, { miss = [] } = {}) => {
    assert.equal((await post(s, '/api/learn/start', { level_id: levelId })).status, 200);
    for (const [i, q] of LEVELS.find((l) => l.id === levelId).questions.entries()) {
      if (miss.includes(i)) await post(s, '/api/learn/answer', { level_id: levelId, question_id: q.id, value: wrong(q) });
      assert.equal((await post(s, '/api/learn/answer', { level_id: levelId, question_id: q.id, value: right(q) })).json.correct, true);
    }
    return post(s, '/api/learn/finish', { level_id: levelId });
  };
  const playReview = async (s, { miss = [] } = {}) => {
    const st = await post(s, '/api/learn/start', { level_id: 'review' });
    if (st.status !== 200) return { start: st };
    for (const [i, q] of st.json.questions.entries()) {
      const full = QUESTIONS.get(q.id);
      if (miss.includes(i)) await post(s, '/api/learn/answer', { level_id: 'review', question_id: q.id, value: wrong(full) });
      assert.equal((await post(s, '/api/learn/answer', { level_id: 'review', question_id: q.id, value: right(full) })).json.correct, true);
    }
    return { start: st, fin: await post(s, '/api/learn/finish', { level_id: 'review' }) };
  };
  return { srv, ...w, rows, post, playLevel, playReview, state: async (s) => (await s.client.get('/api/learn/state')).json, day: () => srv.app.clock.today(), nextDay: async () => { t += 864e5; for (const x of w.students) assert.equal((await x.client.post('/api/login', { username: x.username, secret: x.pin })).status, 200); }, cleanup: srv.cleanup };
}

test('XP and the streak: a first completion keeps the day, a replay gives nothing, a second level the same day only adds XP', async () => {
  const w = await world({ n: 1 });
  try {
    const [s] = w.students;
    const before = (await w.state(s)).daily;
    assert.deepEqual([before.streak, before.review.state, before.xp_today, before.at_risk], [0, 'locked', 0, false]);
    const r = (await w.playLevel(s, L1)).json;
    assert.deepEqual([r.xp, r.day_kept, r.freeze_earned, r.daily.streak, r.daily.kept_today], [10 + r.first_try, true, false, 1, true]);
    const again = (await w.playLevel(s, L1)).json;
    assert.deepEqual([again.practice, again.xp, again.day_kept, again.daily.xp_today], [true, 0, false, r.xp]);
    const second = (await w.playLevel(s, L2)).json;
    assert.deepEqual([second.day_kept, second.daily.streak, second.daily.xp_today], [false, 1, r.xp + second.xp]);
    assert.equal(w.rows('SELECT COUNT(*) AS n FROM learn_days')[0].n, 1);
    // next day, only a replay: the streak is alive but not kept, and replaying does not keep it
    await w.nextDay();
    await w.playLevel(s, L1);
    const d = (await w.state(s)).daily;
    assert.deepEqual([d.streak, d.kept_today, d.at_risk], [1, false, true]);
    assert.equal(w.rows('SELECT COUNT(*) AS n FROM learn_days')[0].n, 1);
    // the cash side is untouched: one reward per level, nothing for XP
    assert.equal(w.rows("SELECT COUNT(*) AS n FROM txns WHERE kind = 'learn.reward'")[0].n, 2);
  } finally { await w.cleanup(); }
});

test('daily review: locked, ready, judged by the server, finished once a day, and ready again tomorrow with the boxes moved', async () => {
  const w = await world({ n: 1 });
  try {
    const [s] = w.students;
    const locked = await w.post(s, '/api/learn/start', { level_id: 'review' });
    assert.deepEqual([locked.status, locked.json.error ?? locked.json.message], [409, 'Finish a level to unlock the daily review.']);
    await w.playLevel(s, L1, { miss: [0, 1] });                    // q0 and q1 wrong first time -> box 0; the other seven box 2
    const rv = (r) => Object.fromEntries(w.rows('SELECT question_id, box, due_day FROM learn_review').map((x) => [x.question_id, x]));
    const qs0 = LEVELS[0].questions.map((q) => q.id);
    assert.deepEqual([rv()[qs0[0]].box, rv()[qs0[0]].due_day, rv()[qs0[2]].box, rv()[qs0[2]].due_day], [0, addDays(DAY0, 1), 2, addDays(DAY0, 4)]);
    const st = await w.state(s);
    assert.deepEqual(st.daily.review, { state: 'ready', count: 5 });
    // the payload holds no answers
    const start = await w.post(s, '/api/learn/start', { level_id: 'review' });
    assert.equal(start.status, 200);
    assert.deepEqual([start.json.cards, start.json.max_reward_cents, start.json.level.review], [[], 0, true]);
    assert.match(JSON.stringify(start.json), /"from":/);
    for (const q of start.json.questions) for (const key of ['answer', 'why', 'working', 'miss', 'traps', 'check']) assert.ok(!(key in q), `${key} leaked`);
    const ids = start.json.questions.map((q) => q.id);
    assert.equal(ids.length, 5);
    assert.deepEqual(ids.slice(0, 2), [qs0[0], qs0[1]], 'the ones due soonest come first');
    // resuming gives the same set; a question outside it is a 404; finishing early is a 409
    assert.deepEqual((await w.post(s, '/api/learn/start', { level_id: 'review' })).json.questions.map((q) => q.id), ids);
    const outside = qs0.find((id) => !ids.includes(id));
    assert.equal((await w.post(s, '/api/learn/answer', { level_id: 'review', question_id: outside, value: 0 })).status, 404);
    assert.equal((await w.post(s, '/api/learn/finish', { level_id: 'review' })).status, 409);
    const ans = await w.post(s, '/api/learn/answer', { level_id: 'review', question_id: ids[0], value: wrong(QUESTIONS.get(ids[0])) });
    assert.equal(ans.json.correct, false);
    assert.ok(!('correct_value' in ans.json));
    // finish: the first question was wrong first, the other four right
    await w.post(s, '/api/learn/answer', { level_id: 'review', question_id: ids[0], value: right(QUESTIONS.get(ids[0])) });
    for (const id of ids.slice(1)) await w.post(s, '/api/learn/answer', { level_id: 'review', question_id: id, value: right(QUESTIONS.get(id)) });
    const bal = w.srv.app.ledger.balance(s.chequing.id), progress = w.rows('SELECT COUNT(*) AS n FROM learn_progress')[0].n, answers = w.rows('SELECT COUNT(*) AS n FROM learn_answers')[0].n;
    const fin = (await w.post(s, '/api/learn/finish', { level_id: 'review' })).json;
    assert.deepEqual([fin.xp, fin.first_try, fin.day_kept, fin.daily.review.state], [5 + 4, 4, false, 'done']);   // the level already kept the day
    assert.deepEqual([w.srv.app.ledger.balance(s.chequing.id), w.rows('SELECT COUNT(*) AS n FROM learn_progress')[0].n, w.rows('SELECT COUNT(*) AS n FROM learn_answers')[0].n], [bal, progress, answers], 'no money, no progress, no answers');
    const after = rv();
    assert.deepEqual([after[ids[0]].box, after[ids[0]].due_day], [0, addDays(DAY0, 1)], 'wrong first: back to box 0, due tomorrow');
    assert.deepEqual([after[ids[1]].box, after[ids[1]].due_day], [1, addDays(DAY0, 2)], 'right: box 0 -> 1, due in 2 days');
    assert.deepEqual([after[ids[2]].box, after[ids[2]].due_day], [3, addDays(DAY0, 8)], 'right: box 2 -> 3, due in 8 days');
    const done = await w.post(s, '/api/learn/start', { level_id: 'review' });
    assert.deepEqual([done.status, done.json.error ?? done.json.message], [409, 'You have done today’s review. Come back tomorrow.']);
    // tomorrow it is ready again
    await w.nextDay();
    assert.equal((await w.state(s)).daily.review.state, 'ready');
    assert.equal((await w.playReview(s)).start.status, 200);
  } finally { await w.cleanup(); }
});

test('daily review: a review alone keeps the day and builds the streak; ids the content no longer has are skipped', async () => {
  const w = await world({ n: 1 });
  try {
    const [s] = w.students;
    await w.playLevel(s, L1);
    w.srv.app.db.prepare("INSERT INTO learn_review (player_id, world_id, question_id, box, due_day) VALUES (?, 1, 'gone-question', 0, '2000-01-01')").run(s.id);
    await w.nextDay();
    const { start, fin } = await w.playReview(s);
    assert.ok(!start.json.questions.some((q) => q.id === 'gone-question'));
    assert.equal(start.json.questions.length, 5);
    assert.deepEqual([fin.json.day_kept, fin.json.daily.streak, fin.json.xp], [true, 2, 5 + 5]);
    assert.equal((await w.state(s)).daily.week.find((d) => d.day === addDays(DAY0, 1)).state, 'kept');
  } finally { await w.cleanup(); }
});

test('daily review: a review left open past midnight says so plainly, and today\u2019s review still starts', async () => {
  const w = await world({ n: 1 });
  try {
    const [s] = w.students;
    await w.playLevel(s, L1);
    await w.nextDay();
    const q = (await w.post(s, '/api/learn/start', { level_id: 'review' })).json.questions[0];
    await w.nextDay();                                                          // midnight passes with the review open
    const ans = await w.post(s, '/api/learn/answer', { level_id: 'review', question_id: q.id, value: right(QUESTIONS.get(q.id)) });
    const fin = await w.post(s, '/api/learn/finish', { level_id: 'review' });
    for (const r of [ans, fin]) { assert.equal(r.status, 409); assert.match(r.json.error, /yesterday/); }
    assert.equal((await w.playReview(s)).fin.status, 200);
  } finally { await w.cleanup(); }
});

test('week strip: kept, frozen (a held freeze), missed and none', async () => {
  const w = await world({ n: 1 });
  try {
    const [s] = w.students;
    await w.playLevel(s, L1);                                      // Monday 2 Nov
    const db = w.srv.app.db;
    db.prepare('UPDATE learn_streak SET freezes = 2, streak = 3, best = 3 WHERE player_id = ?').run(s.id);
    await w.nextDay(); await w.nextDay(); await w.nextDay();                         // Thursday: Tue and Wed are uncovered days in between
    const d = (await w.state(s)).daily;
    assert.deepEqual(d.week.map((x) => x.state), ['kept', 'frozen', 'frozen', 'today', 'future', 'future', 'future']);
    assert.equal(d.streak, 3);
    db.prepare('UPDATE learn_streak SET freezes = 0 WHERE player_id = ?').run(s.id);
    const lost = (await w.state(s)).daily;
    assert.deepEqual([lost.streak, lost.week[1].state, lost.week[0].state], [0, 'missed', 'kept']);
  } finally { await w.cleanup(); }
});

test('league: this week by XP in my rank group, usernames only, 0 XP rows shown, the whole group is listed with my own row in it', async () => {
  const w = await world({ n: 3 });
  try {
    const [a, b, c] = w.students;
    const other = await addClass(w.srv, w.teacher, 'Block 2', 1), o = other.students[0];
    const first = (await w.state(a)).league;
    assert.deepEqual([first.tier, first.group_size, first.week_start, first.last_result], [{ id: 'iron', name: 'Iron' }, 4, DAY0, null]);
    assert.equal(first.rows.length, 4, 'everyone in the world is in the group, even at 0 XP');
    await w.playLevel(a, L1);                                      // 19
    await w.playLevel(b, L1, { miss: [0, 1] });                    // 17
    await w.playLevel(o, L1);                                      // 19, a different class, the same league
    const lg = (await w.state(b)).league;
    const expect = [[a.username, 19], [b.username, 17], [o.username, 19], [c.username, 0]].sort((x, y) => y[1] - x[1] || (x[0] < y[0] ? -1 : 1));
    assert.deepEqual(lg.rows.map((r) => [r.username, r.xp]), expect);
    assert.deepEqual(lg.rows.map((r) => r.rank), [1, 2, 3, 4]);
    assert.deepEqual(Object.keys(lg.rows[0]), ['rank', 'username', 'xp', 'me', 'zone']);
    assert.deepEqual([lg.my_rank, lg.rows.find((r) => r.me).username, lg.group_size, lg.promote_line, lg.demote_line], [lg.rows.findIndex((r) => r.me) + 1, b.username, 4, 2, 4]);        // 4 in the group: up 2 (half), down 1 (a quarter)
    assert.equal(lg.podium_line, 2, 'a group of 4: the podium is never bigger than the promotion zone');
    assert.deepEqual(lg.rows.map((r) => r.zone), ['up2', 'up2', 'stay', 'stay']);      // both promoted rows are on the podium; the last one is in the down zone, but Iron is the floor
    // last week does not count
    w.srv.app.db.prepare('UPDATE learn_days SET day = ?').run('2026-11-01');
    assert.ok((await w.state(a)).league.rows.every((r) => r.xp === 0));
    // 15 students: every row is listed, me at 12th (groups are built from scratch)
    const db = w.srv.app.db, ins = db.prepare("INSERT INTO players (username, pin_hash, class_id, role, created, first_login) VALUES (?, 'x', ?, 'student', 0, 1)");
    db.prepare('DELETE FROM learn_days').run(); db.prepare('DELETE FROM learn_league_group').run();
    for (let i = 0; i < 11; i++) {
      const id = Number(ins.run(`Fake${String(i).padStart(2, '0')}`, w.cls.id).lastInsertRowid);
      db.prepare('INSERT INTO learn_days (player_id, world_id, day, xp) VALUES (?, 1, ?, ?)').run(id, DAY0, 100 + i);
    }
    db.prepare('INSERT INTO learn_days (player_id, world_id, day, xp) VALUES (?, 1, ?, 5)').run(c.id, DAY0);
    const big = (await w.state(c)).league;
    assert.deepEqual([big.rows.length, big.rows[11].me, big.my_rank, big.group_size, big.promote_line, big.demote_line], [15, true, 12, 15, 7, 13]);   // up 7 (half of 15), down 3 (a quarter)
    assert.deepEqual(big.rows.map((r) => r.rank), Array.from({ length: 15 }, (_, i) => i + 1));
    assert.equal(big.podium_line, 3);
    assert.deepEqual([big.rows[0].zone, big.rows[2].zone, big.rows[3].zone, big.rows[6].zone, big.rows[7].zone, big.rows[11].zone], ['up2', 'up2', 'up', 'up', 'stay', 'stay']);
  } finally { await w.cleanup(); }
});

test('reads write nothing: /api/me and /state leave every learn table as it was, and the home card carries the daily summary', async () => {
  const w = await world({ n: 1 });
  try {
    const [s] = w.students;
    await w.playLevel(s, L1);
    await w.nextDay();
    const count = () => ['learn_streak', 'learn_days', 'learn_review', 'learn_attempts', 'learn_progress'].map((t) => JSON.stringify(w.rows(`SELECT * FROM ${t}`)));
    const before = count();
    for (let i = 0; i < 2; i++) { await s.client.get('/api/learn/state'); await s.client.get('/api/me'); }
    assert.deepEqual(count(), before);
    const card = (await s.client.get('/api/me')).json.homeCards.find((x) => x.module === 'learn');
    assert.deepEqual(card.data.daily, { streak: 1, kept_today: false, freezes: 0, review: 'ready' });
  } finally { await w.cleanup(); }
});

test('teacher panel: a roster with streak, best, days kept in 7 and XP this week', async () => {
  const w = await world({ n: 2 });
  try {
    await w.playLevel(w.students[0], L1);
    const c = (await w.teacher.get('/api/learn/teach')).json.classes[0];
    assert.equal(c.students, 2);
    const me = c.roster.find((r) => r.username === w.students[0].username);
    assert.deepEqual([me.streak, me.best, me.kept_7, me.xp_week > 0], [1, 1, 1, true]);
    assert.deepEqual(c.roster.find((r) => r.username === w.students[1].username), { username: w.students[1].username, rank: 'iron', streak: 0, best: 0, kept_7: 0, xp_week: 0 });
  } finally { await w.cleanup(); }
});
