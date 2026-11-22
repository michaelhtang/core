// learn, ranked leagues (docs/learn.md "Leagues"): grouping and settling as pure functions from case tables, then one run through the routes.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createClock } from '../lib/clock.js';
import { boot, seeded, addClass } from './helpers.js';
import { learnFixture } from './learn-fixture.js';
import { LEAGUE, splitGroups, assignGroups, joinGroup, standings, nextTier, zoneFor } from '../modules/learn/league.js';
import { TIERS } from '../modules/learn/tiers.js';

const sizes = (groups) => groups.map((g) => g.length);
const ids = (n) => Array.from({ length: n }, (_, i) => i + 1);

test('constants: the brief\'s numbers and ten ranks', () => {
  assert.deepEqual({ ...LEAGUE }, { GROUP_MAX: 30, PROMOTE: 10, PODIUM: 3, DEMOTE: 5, START: 'iron' });
  assert.deepEqual([TIERS.length, TIERS[0].id, TIERS.at(-1).id], [10, 'iron', 'challenger']);
});

test('group split: ceil(n / 30) groups, as even as possible, every player once', () => {
  const cases = [[0, []], [1, [1]], [29, [29]], [30, [30]], [31, [16, 15]], [45, [23, 22]], [60, [30, 30]], [61, [21, 20, 20]], [65, [22, 22, 21]], [91, [23, 23, 23, 22]]];
  for (const [n, want] of cases) {
    const g = splitGroups(ids(n), 1, '2026-11-02');
    assert.deepEqual(sizes(g), want, `n = ${n}`);
    assert.deepEqual(g.flat().sort((a, b) => a - b), ids(n));
  }
});

test('group split: the order comes from the hash of world, week and player, not from the input order', () => {
  const a = splitGroups(ids(50), 1, '2026-11-02'), b = splitGroups(ids(50).reverse(), 1, '2026-11-02');
  assert.deepEqual(a, b);
  assert.notDeepEqual(a, splitGroups(ids(50), 1, '2026-11-09'), 'another week shuffles again');
  assert.notDeepEqual(a, splitGroups(ids(50), 2, '2026-11-02'), 'another world too');
});

test('assignGroups: one rank per group set, group numbers from 1 inside each rank', () => {
  const players = [...ids(31).map((id) => ({ id, tier: 'iron' })), { id: 100, tier: 'gold' }, { id: 101, tier: 'gold' }];
  const m = assignGroups(players, 1, '2026-11-02');
  const count = (tier, grp) => [...m.values()].filter((v) => v.tier === tier && v.grp === grp).length;
  assert.deepEqual([count('iron', 1), count('iron', 2), count('iron', 3), count('gold', 1), count('gold', 2)], [16, 15, 0, 2, 0]);
  assert.equal(m.size, 33);
});

test('mid-week joiner: the smallest group of the rank, the lowest number on a tie, a new group when all are full', () => {
  const cases = [
    [[], 1], [[[1, 12]], 1], [[[1, 30], [2, 12]], 2], [[[1, 10], [2, 10]], 1], [[[1, 11], [2, 10], [3, 10]], 2],
    [[[1, 30], [2, 30]], 3], [[[1, 30], [3, 5]], 3], [[[1, 29], [2, 30]], 1], [[[1, 30]], 2],
  ];
  for (const [rows, want] of cases) assert.equal(joinGroup(new Map(rows)), want, JSON.stringify(rows));
});

// n players u00.. with the given XP list (best first is not required)
const group = (xps) => xps.map((xp, i) => ({ id: i + 1, username: `u${String(i).padStart(2, '0')}`, xp }));
const run = (xps) => { const st = standings(group(xps)); return { up: [...st.up].sort((a, b) => a - b), down: [...st.down].sort((a, b) => a - b), p: st.promoteN, d: st.demoteN }; };
const rangeIds = (from, to) => Array.from({ length: to - from + 1 }, (_, i) => from + i);
const desc = (n, top = 100) => Array.from({ length: n }, (_, i) => top - i);

test('settling: who moves, from a case table', () => {
  const cases = [
    ['a full group: top 10 up, bottom 5 down', desc(30), rangeIds(1, 10), rangeIds(26, 30), 10, 5],
    ['a tie at the promote line: everyone tied with the last one inside moves up', [...desc(9), 50, 50, 50, ...desc(18, 40)], rangeIds(1, 12), rangeIds(26, 30), 10, 5],
    ['a tie at the demote line spares everyone tied', [...desc(24, 100), 5, 5, 4, 3, 2, 1], rangeIds(1, 10), [27, 28, 29, 30], 10, 5],
    ['everyone tied above 0: all move up, nobody drops', Array(30).fill(7), rangeIds(1, 30), [], 10, 5],
    ['0 XP never moves up and is the bottom, even when tied', [...desc(4), ...Array(26).fill(0)], rangeIds(1, 4), rangeIds(26, 30), 10, 5],
    ['nobody played: nobody moves up, the bottom still drops', Array(30).fill(0), [], rangeIds(26, 30), 10, 5],
    ['a group of 12: half (6) up, a quarter (3) down', desc(12), rangeIds(1, 6), [10, 11, 12], 6, 3],
    ['a group of 20: 10 up, 5 down, as in a full group', desc(20), rangeIds(1, 10), rangeIds(16, 20), 10, 5],
    ['a group of 2: 1 up, nobody down', desc(2), [1], [], 1, 0],
    ['a group of 29: 10 up, 5 down', desc(29), rangeIds(1, 10), rangeIds(25, 29), 10, 5],
    ['a group of 5: 2 up, 1 down', desc(5), [1, 2], [5], 2, 1],
    ['a group of 1 with XP: up; with none: stays', [10], [1], [], 1, 0],
    ['a group of 1 with 0 XP', [0], [], [], 1, 0],
    ['a group of 6: 3 up, 1 down', desc(6), [1, 2, 3], [6], 3, 1],
  ];
  for (const [name, xps, up, down, p, d] of cases) assert.deepEqual(run(xps), { up, down, p, d }, name);
});

test('podium: the top 3 of the promotion zone move up two, never more than the zone, ties go with them, never at 0 XP', () => {
  const dbl = (xps) => { const st = standings(group(xps)); return { double: [...st.double].sort((a, b) => a - b), n: st.podiumN }; };
  const cases = [
    ['a full group: places 1 to 3', desc(30), { double: [1, 2, 3], n: 3 }],
    ['a tie at 3rd: everyone tied with 3rd jumps too', [100, 90, 80, 80, ...desc(26, 50)], { double: [1, 2, 3, 4], n: 3 }],
    ['a group of 4: 2 promote, both on the podium', desc(4), { double: [1, 2], n: 2 }],
    ['a group of 6: 3 promote, all on the podium', desc(6), { double: [1, 2, 3], n: 3 }],
    ['a group of 1 with XP', [10], { double: [1], n: 1 }],
    ['0 XP is never on the podium', [10, 0, 0, 0, 0, 0, 0, 0], { double: [1], n: 3 }],
    ['nobody played', Array(30).fill(0), { double: [], n: 3 }],
  ];
  for (const [name, xps, want] of cases) assert.deepEqual(dbl(xps), want, name);
  const st = standings(group(desc(30)));
  for (const id of st.double) assert.ok(st.up.has(id), 'the podium is inside the promotion zone');
});

test('podium: two ranks up, capped at Challenger, and the zone a row shows is the real move', () => {
  assert.equal(nextTier('iron', 'up2'), 'silver');
  assert.equal(nextTier('masters', 'up2'), 'challenger');
  assert.equal(nextTier('grandmasters', 'up2'), 'challenger');
  assert.equal(nextTier('challenger', 'up2'), 'challenger');
  const st = standings(group(desc(30)));
  assert.deepEqual([1, 3, 4, 10, 11].map((id) => zoneFor('gold', id, st)), ['up2', 'up2', 'up', 'up', 'stay']);
  assert.equal(zoneFor('masters', 1, st), 'up2');
  assert.equal(zoneFor('grandmasters', 1, st), 'up', 'one step left: shown as a move of one');
  assert.equal(zoneFor('challenger', 1, st), 'stay');
  // a student on the podium every week: 9 moves from Iron in 5 weeks
  let tier = 'iron', weeks = 0;
  while (tier !== 'challenger') { tier = nextTier(tier, zoneFor(tier, 1, st)); weeks++; }
  assert.equal(weeks, 5);
});

test('settling: the order is XP, then username', () => {
  const st = standings([{ id: 1, username: 'b', xp: 5 }, { id: 2, username: 'a', xp: 5 }, { id: 3, username: 'c', xp: 9 }]);
  assert.deepEqual(st.order, [3, 2, 1]);
});

test('ranks: Iron is the floor, Challenger the ceiling', () => {
  assert.equal(nextTier('iron', 'down'), 'iron');
  assert.equal(nextTier('iron', 'up'), 'bronze');
  assert.equal(nextTier('gold', 'down'), 'silver');
  assert.equal(nextTier('challenger', 'up'), 'challenger');
  assert.equal(nextTier('grandmasters', 'up'), 'challenger');
  assert.equal(nextTier('silver', 'stay'), 'silver');
  const st = standings(group(desc(30)));
  assert.equal(zoneFor('challenger', 1, st), 'stay', 'no zone mark where nothing can happen');
  assert.equal(zoneFor('iron', 30, st), 'stay');
  assert.equal(zoneFor('iron', 1, st), 'up2');
  assert.equal(zoneFor('iron', 4, st), 'up');
  assert.equal(zoneFor('gold', 30, st), 'down');
});

// ---------- through the routes ----------
const COURSE = JSON.parse(fs.readFileSync(new URL('../modules/learn/content/fintech10.json', import.meta.url), 'utf8'));
const LEVELS = COURSE.sections[0].units.find((u) => u.id === 'ft10-s1-u2').levels, L1 = LEVELS[0].id, L2 = LEVELS[1].id;
const right = (q) => (q.type === 'number' ? (q.unit === '$' ? (q.answer / 100).toFixed(2) : String(q.answer)) : q.answer);
const DAY0 = '2026-11-02';

test('end to end: a week passes, the top student jumps two ranks from the podium; a missed week and a late joiner', async () => {
  let t = Date.parse('2026-11-02T15:00:00Z');                       // Monday, 08:00 in Edmonton
  const fx = learnFixture();
  const srv = await boot({ config: { courses: { fintech10: { label: 'x', modules: ['bank-basic', 'learn'] }, fintech2030: { label: 'y', modules: ['bank-basic', 'learn'] } }, options: { learn: { contentDir: fx.dir } } }, clock: createClock({ now: () => t }) });
  try {
    const w = await seeded(srv, 3, { transfers: false });
    const [a, b, c] = w.students, db = srv.app.db;
    const state = async (s) => (await s.client.get('/api/learn/state')).json.league;
    const play = async (s, levelId) => {
      assert.equal((await s.client.post('/api/learn/start', { level_id: levelId })).status, 200);
      for (const q of LEVELS.find((l) => l.id === levelId).questions) { t += 400; await s.client.post('/api/learn/answer', { level_id: levelId, question_id: q.id, value: right(q) }); }
      assert.equal((await s.client.post('/api/learn/finish', { level_id: levelId })).status, 200);
    };
    const weeks = async (n) => { t += 7 * n * 864e5; for (const x of w.students) assert.equal((await x.client.post('/api/login', { username: x.username, secret: x.pin })).status, 200); };
    const rank = (s) => db.prepare('SELECT tier FROM learn_rank WHERE player_id = ?').get(s.id)?.tier;

    // week 1: all in Iron; a plays
    assert.deepEqual([(await state(a)).tier.id, (await state(a)).group_size], ['iron', 3]);
    await play(a, L1);
    const late = (await addClass(srv, w.teacher, 'Block 2', 1)).students[0];            // first seen mid-week: joins the Iron group
    assert.equal((await state(late)).group_size, 4);
    assert.equal((await state(a)).group_size, 4);

    // two weeks pass with no reads in the second: week 1 is settled by the first read of week 3
    await weeks(2);
    const lg = await state(a);
    assert.deepEqual([lg.tier.id, lg.week_start, lg.last_result.moved, lg.last_result.steps, lg.last_result.from.id, lg.last_result.to.name, lg.last_result.week_start], ['silver', '2026-11-16', 'up', 2, 'iron', 'Silver', DAY0]);
    assert.equal(lg.group_size, 1, 'a Silver group of one');
    assert.deepEqual([rank(a), rank(b), rank(c)], ['silver', 'iron', 'iron'], 'only a played');
    assert.equal((await state(b)).last_result.moved, 'stay');
    // the same week read again settles nothing twice
    const snap = JSON.stringify([db.prepare('SELECT * FROM learn_rank ORDER BY player_id').all(), db.prepare('SELECT * FROM learn_league_group ORDER BY week, player_id').all(), db.prepare('SELECT * FROM learn_league_done').all()]);
    for (let i = 0; i < 3; i++) { await state(a); await state(b); }
    assert.equal(JSON.stringify([db.prepare('SELECT * FROM learn_rank ORDER BY player_id').all(), db.prepare('SELECT * FROM learn_league_group ORDER BY week, player_id').all(), db.prepare('SELECT * FROM learn_league_done').all()]), snap);
    assert.deepEqual(db.prepare('SELECT week FROM learn_league_done ORDER BY week').all().map((r) => r.week), [DAY0]);

    // the teacher sees the rank; the student never sees an id
    assert.equal((await w.teacher.post('/api/login', { username: 'teacher', secret: 'correct horse battery' })).status, 200);   // a week later: sign in again
    const roster = (await w.teacher.get('/api/learn/teach')).json.classes[0].roster;
    assert.equal(roster.find((r) => r.username === a.username).rank, 'silver');
    assert.ok(lg.rows.every((x) => !('id' in x)), 'a row carries a username, never an id');

    // week 3: a plays again alone in Silver, first of a group of one, and jumps to Platinum a week later
    await play(a, L2);
    await weeks(1);
    assert.deepEqual([(await state(a)).tier.id, (await state(a)).last_result.moved, (await state(a)).last_result.steps], ['platinum', 'up', 2]);
    assert.deepEqual(db.prepare('SELECT week FROM learn_league_done ORDER BY week').all().map((r) => r.week), [DAY0, '2026-11-16']);
  } finally { await srv.cleanup(); }
});

test('league: students who never logged in and students of a deleted class are not placed at the start of the week', async () => {
  const t = Date.parse('2026-11-02T15:00:00Z'), fx = learnFixture();
  const srv = await boot({ config: { courses: { fintech10: { label: 'x', modules: ['bank-basic', 'learn'] }, fintech2030: { label: 'y', modules: ['bank-basic', 'learn'] } }, options: { learn: { contentDir: fx.dir } } }, clock: createClock({ now: () => t }) });
  try {
    const w = await seeded(srv, 2, { transfers: false }), db = srv.app.db;
    db.prepare("INSERT INTO players (username, pin_hash, class_id, role, created) VALUES ('NeverIn', 'x', ?, 'student', 0)").run(w.cls.id);
    const gone = (await addClass(srv, w.teacher, 'Block 9', 1)).students[0];
    db.prepare('UPDATE classes SET archived = 1 WHERE id = (SELECT class_id FROM players WHERE id = ?)').run(gone.id);
    const lg = (await w.students[0].client.get('/api/learn/state')).json.league;
    assert.equal(lg.group_size, 2, 'only the two students of the live class who logged in');
    assert.ok(!lg.rows.some((r) => r.username === 'NeverIn' || r.username === gone.username));
  } finally { await srv.cleanup(); }
});

test('league: the table shows the whole group, mixed across classes, with the lines for its size', async () => {
  const t = Date.parse('2026-11-02T15:00:00Z'), fx = learnFixture();
  const srv = await boot({ config: { courses: { fintech10: { label: 'x', modules: ['bank-basic', 'learn'] }, fintech2030: { label: 'y', modules: ['bank-basic', 'learn'] } }, options: { learn: { contentDir: fx.dir } } }, clock: createClock({ now: () => t }) });
  try {
    const w = await seeded(srv, 2, { transfers: false });
    await addClass(srv, w.teacher, 'Block 2', 11);
    const lg = (await w.students[0].client.get('/api/learn/state')).json.league;
    assert.equal(lg.group_size, 13, 'both classes of the world in one Iron group');
    assert.equal(lg.rows.length, 13, 'every member is listed, not only the first 10');
    assert.deepEqual(lg.rows.map((r) => r.rank), ids(13));
    assert.equal(lg.rows.filter((r) => r.me).length, 1);
    assert.deepEqual([lg.promote_line, lg.demote_line], [6, 11], '13 students: half (6) up, a quarter (3) down');
  } finally { await srv.cleanup(); }
});
