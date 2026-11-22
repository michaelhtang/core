// learn, the units open to a class (docs/learn.md "Open units"): the lock rule on the server, the teacher route, and every caller of the road logic.
// Three units with levels: A = ft10-s1-u1, B = ft10-s1-u2 (the pay unit), C = ft10-s2-u1 (another section). Everything else is a teaser.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createClock } from '../lib/clock.js';
import { boot, seeded } from './helpers.js';
import { learnFixture } from './learn-fixture.js';

const UA = 'ft10-s1-u1', UB = 'ft10-s1-u2', UC = 'ft10-s2-u1', EMPTY = 'ft10-s2-u2';
const COURSE = JSON.parse(fs.readFileSync(new URL('../modules/learn/content/fintech10.json', import.meta.url), 'utf8'));
const UNITS = Object.fromEntries([UA, UB, UC].map((id) => [id, COURSE.sections.flatMap((s) => s.units).find((u) => u.id === id)]));
const [A, B, C] = [UA, UB, UC].map((id) => UNITS[id].levels);
const QUESTIONS = new Map([...A, ...B, ...C].flatMap((l) => l.questions.map((q) => [q.id, q])));
const FIX = learnFixture({ keep: [UA, UB, UC] });
const T0 = Date.parse('2026-11-02T15:00:00Z');
const MODS = ['bank-basic', 'learn', 'today'];
const cfg = { courses: { fintech10: { label: 'x', modules: MODS }, fintech2030: { label: 'y', modules: MODS } }, options: { learn: { contentDir: FIX.dir } } };
const right = (q) => (q.type === 'number' ? (q.unit === '$' ? (q.answer / 100).toFixed(2) : String(q.answer)) : q.answer);
const MSG = 'That unit is not open for your class yet.';

async function world({ n = 2 } = {}) {
  let t = T0;
  const srv = await boot({ config: cfg, clock: createClock({ now: () => t }) });
  const w = await seeded(srv, n, { transfers: false });
  const rows = (sql, ...a) => srv.app.db.prepare(sql).all(...a);
  const post = (s, p, body) => { t += 400; return s.client.post(p, body); };
  const answerAll = async (s, level) => { for (const q of level.questions) assert.equal((await post(s, '/api/learn/answer', { level_id: level.id, question_id: q.id, value: right(q) })).json.correct, true); };
  const play = async (s, level) => { assert.equal((await post(s, '/api/learn/start', { level_id: level.id })).status, 200); await answerAll(s, level); return post(s, '/api/learn/finish', { level_id: level.id }); };
  const setOpen = (units, who = w.teacher, class_id = w.cls.id) => who.post('/api/learn/open-units', units === 'all' ? { class_id, all: true } : { class_id, units });
  const state = async (s) => (await s.client.get('/api/learn/state')).json;
  const unit = (st, id) => st.sections.flatMap((x) => x.units).find((u) => u.id === id);
  // everything a skipped call must leave alone
  const snap = () => JSON.stringify([...['learn_progress', 'learn_attempts', 'learn_answers', 'learn_review', 'learn_days', 'learn_streak', 'learn_open_set', 'learn_open_unit'].map((x) => rows(`SELECT * FROM ${x} ORDER BY rowid`)),
    rows('SELECT COUNT(*) AS n FROM txns'), rows('SELECT COUNT(*) AS n FROM entries'), rows('SELECT account_id, SUM(amount_cents) AS c FROM entries GROUP BY account_id ORDER BY account_id')]);
  // mark levels finished without playing them (the unlock rules only read learn_progress)
  const finishDirect = (s, levels) => { for (const l of levels) srv.app.db.prepare('INSERT INTO learn_progress (player_id, world_id, level_id, first_try, questions, best_first_try, done_at, paid_cents) VALUES (?, 1, ?, ?, ?, ?, 1, 0)').run(s.id, l.id, l.questions.length, l.questions.length, l.questions.length); };
  return { srv, ...w, rows, post, play, setOpen, state, unit, snap, finishDirect, answerAll, balance: (s) => srv.app.ledger.balance(s.chequing.id), cleanup: srv.cleanup };
}

test('no setting: the road is exactly as before (A opens first, B and C wait in course order)', async () => {
  const w = await world();
  try {
    const [s] = w.students;
    const st = await w.state(s);
    assert.deepEqual([UA, UB, UC].map((id) => w.unit(st, id).status), ['current', 'locked', 'locked']);
    assert.equal(st.next.level_id, A[0].id);
    assert.equal((await w.post(s, '/api/learn/start', { level_id: B[0].id })).status, 403);
    assert.equal((await w.post(s, '/api/learn/start', { level_id: A[0].id })).status, 200);
    assert.equal((await w.teacher.get('/api/learn/teach')).json.classes[0].open_units, null);
  } finally { await w.cleanup(); }
});

test('A closed, B and C open: every route on A is 403 and writes nothing; B opens at its first level; C opens after B', async () => {
  const w = await world();
  try {
    const [s, s2] = w.students;
    const set = await w.setOpen([UB, UC]);
    assert.deepEqual([set.status, set.json], [200, { class_id: w.cls.id, open_units: [UB, UC] }]);
    assert.equal(w.rows("SELECT COUNT(*) AS n FROM audit_log WHERE action = 'learn.open_units'")[0].n, 1);
    const st = await w.state(s);
    assert.deepEqual([UA, UB, UC].map((id) => w.unit(st, id).status), ['closed', 'current', 'locked']);
    assert.ok(w.unit(st, UA).levels.every((l) => l.status === 'locked'));
    assert.deepEqual([st.next.level_id, B[0].id], [B[0].id, B[0].id]);
    assert.equal(w.unit(st, UB).levels[0].status, 'next');
    // every route on a skipped level: 403 with the plain message, nothing written, no money
    const before = w.snap(), bal = w.balance(s);
    for (const [path, body] of [['/api/learn/start', {}], ['/api/learn/answer', { question_id: A[0].questions[0].id, value: right(A[0].questions[0]) }], ['/api/learn/finish', {}]]) {
      const r = await w.post(s, path, { level_id: A[0].id, ...body });
      assert.deepEqual([path, r.status, r.json.error ?? r.json.message], [path, 403, MSG]);
    }
    assert.equal(w.snap(), before);
    assert.equal(w.balance(s), bal);
    assert.equal((await w.post(s, '/api/learn/start', { level_id: A[3].id })).status, 403, 'a later level of a skipped unit too');
    // B level 2 is locked until level 1 is done; B level 1 plays and pays
    assert.equal((await w.post(s, '/api/learn/start', { level_id: B[1].id })).status, 403);
    const fin = await w.play(s, B[0]);
    assert.equal(fin.status, 200);
    assert.equal(fin.json.next.level_id, B[1].id);
    assert.equal(w.balance(s) - bal > 0, true);
    // C waits for every level of B; A's levels never count
    assert.equal((await w.post(s, '/api/learn/start', { level_id: C[0].id })).status, 403);
    w.finishDirect(s, B.slice(1, -1));
    assert.equal((await w.post(s, '/api/learn/start', { level_id: C[0].id })).status, 403, 'one level of B still open');
    const last = await w.play(s, B.at(-1));
    assert.equal(last.json.next.level_id, C[0].id);
    assert.equal((await w.post(s, '/api/learn/start', { level_id: C[0].id })).status, 200);
    const st2 = await w.state(s);
    assert.deepEqual([UA, UB, UC].map((id) => w.unit(st2, id).status), ['closed', 'done', 'current']);
    assert.equal(st2.totals.levels_done, B.length);
    // a student of another class is not affected (here: nobody; the second student of the same class is)
    assert.equal((await w.post(s2, '/api/learn/start', { level_id: A[0].id })).status, 403);
    assert.equal(w.srv.app.ledger.audit().ok, true);
  } finally { await w.cleanup(); }
});

test('a level finished before the setting still counts in totals but cannot be replayed; an open attempt cannot be continued', async () => {
  const w = await world({ n: 1 });
  try {
    const [s] = w.students;
    const fin = await w.play(s, A[0]);
    assert.equal(fin.status, 200);
    assert.equal((await w.post(s, '/api/learn/start', { level_id: A[1].id })).status, 200);   // left open
    await w.setOpen([UB, UC]);
    const st = await w.state(s);
    assert.deepEqual([st.totals.levels_done, st.totals.cents_earned], [1, fin.json.reward_cents]);
    assert.equal(w.unit(st, UA).levels_done, 1);
    assert.equal(w.unit(st, UA).status, 'closed');
    const before = w.snap();
    for (const [path, level] of [['/api/learn/start', A[0]], ['/api/learn/finish', A[1]]]) assert.equal((await w.post(s, path, { level_id: level.id })).status, 403, path);
    assert.equal((await w.post(s, '/api/learn/answer', { level_id: A[1].id, question_id: A[1].questions[0].id, value: right(A[1].questions[0]) })).status, 403);
    assert.equal(w.snap(), before);
    // the daily review still reviews A's finished level
    assert.equal((await w.post(s, '/api/learn/start', { level_id: 'review' })).status, 200);
    assert.equal(st.daily.review.state, 'ready');
    // clearing the setting makes A required again: the open attempt resumes and A's level 2 is next
    await w.setOpen('all');
    assert.equal((await w.state(s)).next.level_id, A[1].id);
    assert.equal((await w.post(s, '/api/learn/start', { level_id: A[1].id })).status, 200);
  } finally { await w.cleanup(); }
});

test('changing the setting forward and back, and clearing it, takes effect on the next request', async () => {
  const w = await world({ n: 1 });
  try {
    const [s] = w.students;
    const next = async () => (await w.state(s)).next.level_id;
    assert.equal(await next(), A[0].id);
    await w.setOpen([UC]);
    assert.equal(await next(), C[0].id);
    assert.equal((await w.post(s, '/api/learn/start', { level_id: B[0].id })).status, 403, 'B is skipped now');
    assert.equal((await w.post(s, '/api/learn/start', { level_id: C[0].id })).status, 200);
    await w.setOpen([UB, UC]);
    assert.equal(await next(), B[0].id);
    assert.equal((await w.post(s, '/api/learn/start', { level_id: C[0].id })).status, 403, 'C waits for B again');
    assert.equal((await w.post(s, '/api/learn/start', { level_id: B[0].id })).status, 200);
    await w.setOpen([UA, UB, UC]);
    assert.equal(await next(), A[0].id, 'all three open is the same as no setting');
    await w.setOpen([UC]);
    const cleared = await w.setOpen('all');
    assert.deepEqual([cleared.status, cleared.json.open_units], [200, null]);
    assert.equal(w.rows('SELECT COUNT(*) AS n FROM learn_open_set')[0].n + w.rows('SELECT COUNT(*) AS n FROM learn_open_unit')[0].n, 0);
    assert.equal(await next(), A[0].id);
    assert.equal((await w.post(s, '/api/learn/start', { level_id: C[0].id })).status, 403);
    assert.equal((await w.teacher.get('/api/learn/teach')).json.classes[0].open_units, null);
  } finally { await w.cleanup(); }
});

test('the teacher route: only your own class, only a unit of its course that has levels, never a student', async () => {
  const w = await world({ n: 1 });
  try {
    const [s] = w.students;
    const before = w.snap();
    assert.equal((await w.setOpen([UB], s.client)).status, 403);
    assert.equal((await w.setOpen(['nope'])).status, 400);
    assert.equal((await w.setOpen([UB, EMPTY])).status, 400, 'a unit with no levels');
    assert.equal((await w.setOpen([UB, UB])).status, 400, 'a duplicate');
    assert.equal((await w.teacher.post('/api/learn/open-units', { class_id: w.cls.id, all: true, units: [UB] })).status, 400, 'the list and all: true together');
    assert.equal((await w.setOpen('UB')).status, 400, 'units must be a list');
    assert.equal((await w.teacher.post('/api/learn/open-units', { class_id: w.cls.id })).status, 400, 'neither units nor all');
    assert.equal((await w.setOpen([UB], w.teacher, 9999)).status, 404);
    assert.equal((await w.teacher.post('/api/learn/open-units', { units: [UB] })).status, 400, 'class_id is required');
    assert.equal(w.snap(), before);
    const invite = new URL((await w.teacher.post('/api/teach/invites')).json.url).searchParams.get('invite');
    const b = w.srv.client();
    assert.equal((await b.post('/api/teach/join', { token: invite, username: 'teacherB', passphrase: 'another long passphrase' })).status, 200);
    const bc = (await b.post('/api/teach/classes', { name: 'B block', course: 'fintech10' })).json;
    assert.equal((await w.setOpen([UB], w.teacher, bc.id)).status, 404, "not another teacher's class");
    assert.equal((await w.setOpen([UB], b, w.cls.id)).status, 404, 'nor the other way round');
    assert.equal(w.rows('SELECT COUNT(*) AS n FROM learn_open_set')[0].n, 0);
    assert.equal((await w.setOpen([UB], b, bc.id)).status, 200);
    assert.deepEqual(w.rows('SELECT class_id, unit_id FROM learn_open_unit').map((r) => ({ ...r })), [{ class_id: bc.id, unit_id: UB }]);
    // the panel payload: the setting and the sections with the units a class may open (units with levels only)
    const c = (await w.teacher.get('/api/learn/teach')).json.classes[0];
    assert.equal(c.open_units, null);
    assert.deepEqual(c.open_sections.flatMap((x) => x.units.map((u) => u.id)), [UA, UB, UC]);
    assert.deepEqual(c.open_sections.map((x) => x.units.length), [2, 1]);
    assert.deepEqual((await b.get('/api/learn/teach')).json.classes[0].open_units, [UB]);
  } finally { await w.cleanup(); }
});

test('only some units open: the 1st and 3rd of three. The 3rd unlocks when the 1st is done; the 2nd is 403 and its progress still counts', async () => {
  const w = await world({ n: 1 });
  try {
    const [s] = w.students;
    w.finishDirect(s, B.slice(0, 1));                                   // progress made in B before it was closed
    await w.setOpen([UA, UC]);
    const st = await w.state(s);
    assert.deepEqual([UA, UB, UC].map((id) => w.unit(st, id).status), ['current', 'closed', 'locked']);
    assert.deepEqual([st.next.level_id, st.totals.levels_done, w.unit(st, UB).levels_done], [A[0].id, 1, 1]);
    assert.equal((await w.post(s, '/api/learn/start', { level_id: B[1].id })).status, 403);
    assert.equal((await w.post(s, '/api/learn/start', { level_id: B[0].id })).status, 403, 'no practice replay of a closed unit');
    assert.equal((await w.post(s, '/api/learn/start', { level_id: C[0].id })).status, 403, 'C waits for A');
    w.finishDirect(s, A.slice(0, -1));
    assert.equal((await w.post(s, '/api/learn/start', { level_id: C[0].id })).status, 403, 'one level of A still open');
    assert.equal((await w.play(s, A.at(-1))).json.next.level_id, C[0].id, 'B is not in the way');
    assert.equal((await w.post(s, '/api/learn/start', { level_id: C[0].id })).status, 200);
    // an unlisted unit stays closed even though it is in the course: this is also what a unit added to the course later looks like
    assert.equal((await w.state(s)).sections.flatMap((x) => x.units).filter((u) => u.status === 'closed').map((u) => u.id).join(), UB);
  } finally { await w.cleanup(); }
});

test('an empty open set closes everything; opening one more unit later opens it; clearing opens all', async () => {
  const w = await world({ n: 1 });
  try {
    const [s] = w.students;
    assert.deepEqual([(await w.setOpen([])).status, (await w.teacher.get('/api/learn/teach')).json.classes[0].open_units], [200, []]);
    let st = await w.state(s);
    assert.deepEqual([UA, UB, UC].map((id) => w.unit(st, id).status), ['closed', 'closed', 'closed']);
    assert.equal(st.next, null);
    for (const l of [A[0], B[0], C[0]]) assert.equal((await w.post(s, '/api/learn/start', { level_id: l.id })).status, 403);
    const card = (await s.client.get('/api/me')).json;
    assert.deepEqual((card.cards ?? card.homeCards).find((x) => x.id === 'road').data.next, null);
    assert.equal(w.srv.app.modules.kernel('today').modules.call('learn', 'todayFacts', { playerId: s.id }).hasOpenLevel, false);
    await w.setOpen([UB]);
    st = await w.state(s);
    assert.deepEqual([UA, UB, UC].map((id) => w.unit(st, id).status), ['closed', 'current', 'closed']);
    assert.equal(st.next.level_id, B[0].id);
    await w.setOpen([UB, UC]);
    assert.equal(w.unit(await w.state(s), UC).status, 'locked', 'opened, and it unlocks after B');
    await w.setOpen('all');
    assert.equal(w.unit(await w.state(s), UA).status, 'current');
  } finally { await w.cleanup(); }
});

test('two classes with different settings do not affect each other', async () => {
  const w = await world({ n: 1 });
  try {
    const [s] = w.students;
    const other = await (await import('./helpers.js')).addClass(w.srv, w.teacher, 'Block 2', 1);
    const [o] = other.students;
    await w.setOpen([UC], w.teacher, other.cls.id);
    assert.equal(w.unit(await w.state(s), UA).status, 'current', 'class 1 has no setting');
    assert.equal(w.unit(await w.state(o), UA).status, 'closed');
    assert.equal((await w.post(o, '/api/learn/start', { level_id: C[0].id })).status, 200);
    assert.equal((await w.post(s, '/api/learn/start', { level_id: C[0].id })).status, 403, 'class 1 still needs A and B first');
    await w.setOpen([UA]);
    assert.equal((await w.post(o, '/api/learn/start', { level_id: C[0].id })).status, 200, 'class 2 unchanged');
    assert.equal((await w.post(o, '/api/learn/start', { level_id: A[0].id })).status, 403);
  } finally { await w.cleanup(); }
});

test('reads write nothing: /state, the home card and /teach with a setting', async () => {
  const w = await world({ n: 1 });
  try {
    const [s] = w.students;
    await w.setOpen([UB, UC]);
    await w.play(s, B[0]);
    const before = w.snap(), rowsBefore = JSON.stringify(w.rows('SELECT * FROM audit_log'));
    await w.state(s);
    const me = (await s.client.get('/api/me')).json;
    const card = me.cards?.find((x) => x.id === 'road') ?? me.homeCards?.find((x) => x.id === 'road');
    assert.equal(card.data.next.level_id, B[1].id);
    await w.teacher.get('/api/learn/teach');
    await s.client.get('/api/today/state');
    assert.equal(w.snap(), before);
    assert.equal(JSON.stringify(w.rows('SELECT * FROM audit_log')), rowsBefore);
  } finally { await w.cleanup(); }
});

test('the Today errand fact follows the setting: no open level in the open units means no errand', async () => {
  const w = await world({ n: 1 });
  try {
    const [s] = w.students;
    // Today reads this fact when it builds a day's errands (errands.json: learn.hasOpenLevel)
    const errand = async () => (w.srv.app.modules.kernel('today').modules.call('learn', 'todayFacts', { playerId: s.id }).hasOpenLevel ? 'open' : undefined);
    assert.ok(await errand(), 'offered with no setting');
    await w.setOpen([UC]);
    assert.ok(await errand(), 'offered while C has open levels');
    w.finishDirect(s, C);
    assert.equal(await errand(), undefined, 'A and B are skipped, C is done');
    await w.setOpen('all');
    assert.ok(await errand(), 'offered again: A is required again');
  } finally { await w.cleanup(); }
});

test('bots only play the open units', async () => {
  const w = await world({ n: 4 });
  try {
    await w.setOpen([UB, UC]);
    const bots = w.students.map((s) => ({ id: s.id, class_id: w.cls.id, course_id: 'fintech10' }));
    for (let month = 1; month <= 12; month++) w.srv.app.modules.simulate({ month, students: bots });
    const ids = w.rows('SELECT DISTINCT level_id FROM learn_progress').map((r) => r.level_id);
    assert.ok(ids.length > 0);
    const skipped = new Set(A.map((l) => l.id));
    assert.ok(ids.every((id) => !skipped.has(id)), ids.join());
    assert.ok(w.rows('SELECT level_id FROM learn_attempts').every((r) => !skipped.has(r.level_id)));
    assert.equal(w.srv.app.ledger.audit().ok, true);
  } finally { await w.cleanup(); }
});

test('the home card points at the first unfinished level in the open units', async () => {
  const w = await world({ n: 1 });
  try {
    const [s] = w.students;
    const card = async () => { const me = (await s.client.get('/api/me')).json; return (me.cards ?? me.homeCards).find((x) => x.id === 'road').data; };
    assert.equal((await card()).next.level_id, A[0].id);
    await w.setOpen([UC]);
    const d = await card();
    assert.deepEqual([d.next.level_id, d.next.unit_id], [C[0].id, UC]);
  } finally { await w.cleanup(); }
});
