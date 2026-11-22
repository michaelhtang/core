// Teacher panels for the arcade and the walk (docs/arcade.md, docs/walk.md "Teacher panel"), and the walk's per-class presence switch: scoping (another teacher's
// class is invisible, students get 403), counts after seeded runs, the switch persisting, clearing the class's entries and blocking /pos for that class only,
// the live roster event, and the migration running twice. Real HTTP, real streams, a hand-set clock for the presence timers.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createClock } from '../lib/clock.js';
import { createApp } from '../lib/app.js';
import { boot, seeded, addClass, openStream, tmpDir } from './helpers.js';

const REAL = JSON.parse(fs.readFileSync(new URL('../config/vdaa.json', import.meta.url), 'utf8'));
const T0 = Date.parse('2026-11-02T15:00:00Z');
const PASS = 'another long passphrase';
const nap = (ms) => new Promise((r) => setTimeout(r, ms));
const configWith = (walk) => { const c = structuredClone(REAL); c.options.walk = { presenceTickMs: 30, ...walk }; return c; };

// Teacher A (world teacher) with Block 1 and Block 2, teacher B (invited) with Block B. Students are logged in; the clock is ours.
async function school({ config = configWith({}) } = {}) {
  let t = T0;
  const dataDir = tmpDir();
  const srv = await boot({ config, dataDir, clock: createClock({ now: () => t }) });
  const a = await seeded(srv, 2, { transfers: false });
  const a2 = await addClass(srv, a.teacher, 'Block 2', 2);
  const invite = (await a.teacher.post('/api/teach/invites')).json;
  const b = srv.client();
  assert.equal((await b.post('/api/teach/join', { token: new URL(invite.url).searchParams.get('invite'), username: 'teacherB', passphrase: PASS })).status, 200);
  const mine = (await b.post('/api/teach/classes', { name: 'Block B', course: 'fintech10' })).json;
  const made = (await b.post(`/api/teach/classes/${mine.id}/students`, { count: 1 })).json.students;
  const bs = srv.client();
  await bs.post('/api/login', { username: made[0].username, secret: made[0].pin });
  const streams = [];
  const open = async (client) => { const s = await openStream(srv, client); streams.push(s); return s; };
  return { srv, dataDir, a, a2, b, bCls: mine, bStudent: { ...made[0], client: bs }, open, advance: (ms) => { t += ms; },
    db: srv.app.db, async cleanup() { streams.forEach((s) => s.close()); await srv.cleanup(); fs.rmSync(dataDir, { recursive: true, force: true }); } };
}
const worldId = (db) => db.prepare('SELECT id FROM worlds ORDER BY id DESC LIMIT 1').get().id;
const insertRun = (db, table, row) => {
  const cols = Object.keys(row);
  db.prepare(`INSERT INTO ${table} (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`).run(...Object.values(row));
};
let n = 0;
const arcadeRun = (db, p, status, score, at, flag = null) => insertRun(db, 'arcade_runs', { id: (++n).toString(16).padStart(32, '0'), player_id: p.id, world_id: worldId(db), game: 'billdash', seed: n, score, ticks: 100, status, flag, started_at: at - 1000, finished_at: at });
const walkRun = (db, p, status, collected, at, flag = null) => insertRun(db, 'walk_runs', { id: (++n).toString(16).padStart(32, '0'), player_id: p.id, world_id: worldId(db), seed: n, collected, ticks: 100, status, flag, started_at: at - 1000, finished_at: at });

// ---------- the teacher panels ----------
test('arcade teacher panel: counts, best and recent rounds of the teacher\'s own classes; students 403; another teacher sees none of it', async () => {
  const w = await school();
  try {
    const [s1, s2] = w.a.students;
    arcadeRun(w.db, s1, 'finished', 120, T0 + 1000); arcadeRun(w.db, s1, 'finished', 300, T0 + 2000); arcadeRun(w.db, s2, 'finished', 200, T0 + 3000);
    arcadeRun(w.db, s2, 'rejected', null, T0 + 4000, 'fast'); arcadeRun(w.db, s2, 'expired', null, T0 + 5000); arcadeRun(w.db, w.a2.students[0], 'finished', 999, T0 + 6000);
    for (let i = 0; i < 12; i++) arcadeRun(w.db, s2, 'finished', 10 + i, T0 + 10000 + i);
    const got = (await w.a.teacher.get('/api/arcade/teach')).json;
    assert.deepEqual(got.classes.map((c) => c.name), ['Block 1', 'Block 2']);
    const c1 = got.classes[0], c2 = got.classes[1];
    assert.equal(c1.finished, 3 + 12);
    assert.equal(c1.rejected, 1);
    assert.deepEqual(c1.rejected_by, { fast: 1 });
    assert.equal(c1.players, 2, 'unique players with a verified round');
    assert.deepEqual(c1.best, { score: 300, username: s1.username, game: 'billdash' });
    assert.equal(c1.recent.length, 10, 'the last ten');
    assert.deepEqual(c1.recent[0], { username: s2.username, game: 'billdash', score: 21, at: T0 + 10011 }, 'newest first');
    assert.deepEqual([c2.finished, c2.players, c2.best.score], [1, 1, 999], 'classes are counted apart');
    assert.equal((await w.a.students[0].client.get('/api/arcade/teach')).status, 403, 'students are refused');
    assert.equal((await w.srv.client().get('/api/arcade/teach')).status, 401, 'and so is nobody');
    const other = (await w.b.get('/api/arcade/teach')).json;
    assert.deepEqual(other.classes.map((c) => c.name), ['Block B'], 'teacher B sees only their own class');
    assert.deepEqual([other.classes[0].finished, other.classes[0].best], [0, null]);
    assert.ok(!JSON.stringify(other).includes(s1.username), 'no pseudonym of another teacher\'s class');
  } finally { await w.cleanup(); }
});

test('arcade teacher panel: a real round finished at once is rejected as too fast and shows up as such', async () => {
  const w = await school();
  try {
    const s = w.a.students[0];
    const round = (await s.client.post('/api/arcade/start', { game: 'billdash' })).json;
    assert.equal((await s.client.post('/api/arcade/finish', { session: round.session, game: 'billdash', inputs: [] })).status, 422);
    const c = (await w.a.teacher.get('/api/arcade/teach')).json.classes[0];
    assert.deepEqual([c.finished, c.rejected, c.rejected_by], [0, 1, { fast: 1 }]);
  } finally { await w.cleanup(); }
});

test('walk teacher panel: visits, rejected, items-collected buckets and players per class; scoped; students 403', async () => {
  const w = await school();
  try {
    const [s1, s2] = w.a.students;
    for (const c of [0, 2, 3, 5, 6, 6]) walkRun(w.db, s1, 'finished', c, T0 + 1000 + c);
    walkRun(w.db, s2, 'finished', 4, T0 + 2000); walkRun(w.db, s2, 'rejected', null, T0 + 3000, 'fast'); walkRun(w.db, s2, 'open', null, T0 + 4000);
    walkRun(w.db, w.a2.students[0], 'finished', 6, T0 + 5000);
    const got = (await w.a.teacher.get('/api/walk/teach')).json;
    const c1 = got.classes[0];
    assert.deepEqual([c1.name, c1.visits, c1.rejected, c1.players], ['Block 1', 7, 1, 2]);
    assert.deepEqual(c1.rejected_by, { fast: 1 });
    assert.deepEqual(c1.items, { '0-2': 2, '3-5': 3, '6': 2 });
    assert.deepEqual([got.classes[1].visits, got.classes[1].items['6']], [1, 1]);
    assert.deepEqual([c1.presence, c1.on_map], [true, { count: 0, players: [] }]);
    assert.equal((await s1.client.get('/api/walk/teach')).status, 403);
    const other = (await w.b.get('/api/walk/teach')).json;
    assert.deepEqual(other.classes.map((c) => [c.name, c.visits]), [['Block B', 0]]);
    assert.ok(!JSON.stringify(other).includes(s1.username));
  } finally { await w.cleanup(); }
});

// ---------- the presence switch ----------
const pos = (s, body = { x: 100, y: 100, dir: 0 }) => s.client.post('/api/walk/pos', body);

test('presence switch: validated, scoped to the teacher\'s classes, audited, persisted, and in /state', async () => {
  const w = await school();
  try {
    const [s1] = w.a.students;
    const set = (c, body) => c.post('/api/walk/settings', body);
    assert.equal((await set(s1.client, { class_id: w.a.cls.id, presence: false })).status, 403, 'a student cannot');
    assert.equal((await set(w.b, { class_id: w.a.cls.id, presence: false })).status, 404, 'another teacher\'s class does not exist for them');
    assert.equal((await set(w.a.teacher, { class_id: w.a.cls.id, presence: 'no' })).status, 400);
    assert.equal((await set(w.a.teacher, { class_id: 'x', presence: false })).status, 400);
    assert.equal((await set(w.a.teacher, { class_id: 99999, presence: false })).status, 404);
    assert.equal((await set(w.a.teacher, { presence: false })).status, 400);
    assert.equal(w.db.prepare('SELECT COUNT(*) AS n FROM walk_class_settings').get().n, 0, 'every refusal left nothing behind');
    assert.equal((await s1.client.get('/api/walk/state')).json.presence, true);
    const r = await set(w.a.teacher, { class_id: w.a.cls.id, presence: false });
    assert.deepEqual(r.json, { ok: true, class_id: w.a.cls.id, presence: false });
    assert.equal((await s1.client.get('/api/walk/state')).json.presence, false);
    assert.equal((await w.a2.students[0].client.get('/api/walk/state')).json.presence, true, 'the other class is untouched');
    assert.deepEqual(w.db.prepare('SELECT class_id, presence FROM walk_class_settings').all().map((x) => ({ ...x })), [{ class_id: w.a.cls.id, presence: 0 }]);
    assert.equal((await w.a.teacher.get('/api/walk/teach')).json.classes[0].presence, false);
    const audit = w.db.prepare("SELECT actor, detail FROM audit_log WHERE action = 'walk.presence'").get();
    assert.equal(audit.actor, `player:${(await w.a.teacher.get('/api/me')).json.user.id}`);
    assert.deepEqual(JSON.parse(audit.detail), { class: w.a.cls.id, presence: false });
    await set(w.a.teacher, { class_id: w.a.cls.id, presence: true });                                  // back on: one row, updated
    assert.deepEqual(w.db.prepare('SELECT presence FROM walk_class_settings').all().map((x) => x.presence), [1]);
    assert.equal((await s1.client.get('/api/walk/state')).json.presence, true);
  } finally { await w.cleanup(); }
});

test('presence switch: a second app on the same data dir sees it (the choice is persisted), and the migration runs twice without a trace', async () => {
  const w = await school();
  try {
    await w.a.teacher.post('/api/walk/settings', { class_id: w.a.cls.id, presence: false });
    const again = await createApp({ dataDir: w.dataDir, clock: createClock({ now: () => T0 }) });       // boots every module's migrations a second time
    try {
      assert.deepEqual(again.db.prepare('SELECT presence FROM walk_class_settings WHERE class_id = ?').all(w.a.cls.id).map((x) => x.presence), [0]);
      assert.equal(again.db.prepare("SELECT COUNT(*) AS n FROM schema_migrations WHERE id LIKE 'mod:walk:%'").get().n, 2);
      assert.deepEqual(again.db.prepare("SELECT id FROM schema_migrations WHERE id LIKE 'mod:walk:%' ORDER BY id").all().map((x) => x.id), ['mod:walk:001_runs', 'mod:walk:002_class_settings']);
    } finally { again.db.close(); }
  } finally { await w.cleanup(); }
});

test('presence switch: off clears that class at once, blocks /pos and /leave for it only, tells its students\' maps, and on again works', async () => {
  const w = await school();
  try {
    const [s1, s2] = w.a.students, [m1, m2] = w.a2.students;
    const ss1 = await w.open(s1.client), ss2 = await w.open(s2.client), sm1 = await w.open(m1.client);
    for (const s of [s1, s2, m1, m2]) assert.equal((await pos(s)).status, 200);
    w.advance(300);
    const roster = async () => (await w.a.teacher.get('/api/walk/teach')).json.classes.map((c) => [c.name, c.on_map.players.length]);
    assert.deepEqual(await roster(), [['Block 1', 2], ['Block 2', 2]]);
    await w.a.teacher.post('/api/walk/settings', { class_id: w.a.cls.id, presence: false });
    assert.deepEqual(await roster(), [['Block 1', 0], ['Block 2', 2]], 'the class entries are gone now, not in 10 seconds');
    assert.deepEqual((await ss1.next('walk.presence.off', 1500))?.data, {});
    assert.ok(await ss2.next('walk.presence.off', 1500), 'every connected student of the class');
    assert.equal(await sm1.next('walk.presence.off', 400), null, 'the other class is not told');
    assert.deepEqual((await pos(s1)).json, { presence: false });
    assert.deepEqual((await s2.client.post('/api/walk/leave', {})).json, { presence: false });
    assert.equal((await pos(m1, { x: 120, y: 100, dir: 1 })).json.ok, true, 'the other class still posts');
    w.advance(300);
    assert.equal((await pos(s1)).json.presence, false, 'and the blocked class stays blocked');
    assert.deepEqual(await roster(), [['Block 1', 0], ['Block 2', 2]]);
    const snaps = ss1.events.filter((e) => e.event === 'walk.presence').length;
    await nap(250);
    assert.equal(ss1.events.filter((e) => e.event === 'walk.presence').length, snaps, 'nothing more is broadcast to it');
    await w.a.teacher.post('/api/walk/settings', { class_id: w.a.cls.id, presence: true });
    assert.equal((await pos(s1)).json.ok, true);
    assert.deepEqual(await roster(), [['Block 1', 1], ['Block 2', 2]]);
  } finally { await w.cleanup(); }
});

test('presence switch: it overrides options.walk.presence for the class, either way', async () => {
  const w = await school({ config: configWith({ presence: false }) });
  try {
    const [s1] = w.a.students, [m1] = w.a2.students;
    assert.equal((await s1.client.get('/api/walk/state')).json.presence, false, 'the config default');
    assert.deepEqual((await pos(s1)).json, { presence: false });
    await w.a.teacher.post('/api/walk/settings', { class_id: w.a.cls.id, presence: true });
    assert.equal((await s1.client.get('/api/walk/state')).json.presence, true);
    assert.equal((await pos(s1)).json.ok, true);
    assert.equal((await m1.client.get('/api/walk/state')).json.presence, false, 'other classes keep the default');
  } finally { await w.cleanup(); }
});

// ---------- the live roster ----------
test('walk.roster: the class\'s teachers hear who is on the map when someone joins or leaves, nobody else does, and a move alone sends nothing', async () => {
  const w = await school();
  try {
    const [s1, s2] = w.a.students;
    const ta = await w.open(w.a.teacher), tb = await w.open(w.b), st = await w.open(s2.client);
    assert.equal((await pos(s1)).status, 200);
    const first = (await ta.next('walk.roster', 2000))?.data;
    assert.deepEqual(first, { class_id: w.a.cls.id, count: 1, players: [s1.username] });
    w.advance(300);
    await pos(s1, { x: 150, y: 90, dir: 2 });                                                          // a move: the roster did not change
    await pos(s2); w.advance(300);
    const second = (await ta.next('walk.roster', 2000))?.data;
    assert.deepEqual(second, { class_id: w.a.cls.id, count: 2, players: [s1.username, s2.username].sort() });
    await nap(250);
    assert.equal(ta.events.filter((e) => e.event === 'walk.roster').length, 2, 'one event per join, none for a move');
    await s2.client.post('/api/walk/leave', {});
    assert.deepEqual((await ta.next('walk.roster', 2000))?.data, { class_id: w.a.cls.id, count: 1, players: [s1.username] });
    assert.equal(await tb.next('walk.roster', 400), null, 'teacher B, not this class\'s teacher');
    assert.equal(await st.next('walk.roster', 100), null, 'students never get it');
    w.advance(11000);                                                                                  // s1 goes quiet: the entry expires and the roster empties
    await nap(150);
    assert.ok(ta.events.some((e) => e.event === 'walk.roster' && e.data.class_id === w.a.cls.id && e.data.count === 0), 'an expiry is a leave too');
  } finally { await w.cleanup(); }
});
