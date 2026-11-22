// Class management (lib/players.js renameClass, removeStudents, deleteClass, resetPins): rename, soft removal of students who never
// logged in, delete (archive) a class, bulk PIN reissue. Removed students' accounts never move again, through ticks and a season close.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { boot, seeded } from './helpers.js';

const PASS = 'another long passphrase';
const login = (srv, username, secret) => srv.client().post('/api/login', { username, secret });
const listOf = async (t, classId) => (await t.get(`/api/teach/classes/${classId}/students`)).json.students;

test('class management: rename, remove, delete and reset PINs; removed students never move again', async () => {
  const srv = await boot();
  const { app } = srv;
  try {
    const { teacher: a, cls, students: [active] } = await seeded(srv, 1);                       // logged in: active
    const raw = (await a.post(`/api/teach/classes/${cls.id}/students`, { count: 3 })).json.students;   // cards printed, nobody logged in
    const idOf = (u) => app.db.prepare('SELECT id FROM players WHERE username = ?').get(u).id;
    const [r1, r2, r3] = raw.map((s) => ({ ...s, id: idOf(s.username) }));

    // rename
    const renamed = await a.post(`/api/teach/classes/${cls.id}/rename`, { name: '  Block 9 ' });
    assert.equal(renamed.status, 200);
    assert.deepEqual(renamed.json, { id: cls.id, name: 'Block 9' });
    assert.equal((await a.get('/api/teach/state')).json.classes[0].name, 'Block 9');
    assert.equal((await a.post(`/api/teach/classes/${cls.id}/rename`, { name: '  ' })).status, 400);

    // another teacher: 404 on every new route
    const b = srv.client();
    const token = new URL((await a.post('/api/teach/invites')).json.url).searchParams.get('invite');
    assert.equal((await b.post('/api/teach/join', { token, username: 'teacherB', passphrase: PASS })).status, 200);
    for (const [p, body] of [['rename', { name: 'x' }], ['remove-students', { ids: [r1.id] }], ['delete', { confirm: 'Block 9' }], ['reset-pins', {}]]) {
      assert.equal((await b.post(`/api/teach/classes/${cls.id}/${p}`, body)).status, 404, p);
    }
    assert.equal((await b.get(`/api/teach/classes/${cls.id}/students`)).status, 404);

    // the list carries created and active
    const list = await listOf(a, cls.id);
    assert.equal(list.length, 4);
    for (const s of list) { assert.equal(typeof s.created, 'number'); assert.equal(s.active, s.id === active.id); }

    // a month ticks with everyone in the class; r1 has money, and a loan account below zero
    assert.equal((await a.post('/api/teach/world/advance', { months: 1 })).status, 200);
    const mint = app.ledger.system('mint');
    const chq = app.ledger.accountId('player', r1.id, 'chequing');
    app.ledger.post({ kind: 'test_grant', legs: [{ account: mint, cents: -7000 }, { account: chq, cents: 7000 }] });
    const loan = app.ledger.openAccount({ ownerType: 'player', ownerId: r1.id, kind: 'loan' });
    app.ledger.post({ kind: 'test_loan', legs: [{ account: loan, cents: -20000 }, { account: chq, cents: 20000 }] });

    // an active student in the batch: 409 naming them, and nothing changes
    const refused = await a.post(`/api/teach/classes/${cls.id}/remove-students`, { ids: [r1.id, active.id] });
    assert.equal(refused.status, 409);
    assert.match(refused.json.error, new RegExp(active.username));
    assert.match(refused.json.error, /active students can't be removed/i);
    assert.equal((await listOf(a, cls.id)).length, 4);
    assert.notEqual(app.ledger.balance(chq), 0);
    // an id not in this class: 404, nothing changes
    assert.equal((await a.post(`/api/teach/classes/${cls.id}/remove-students`, { ids: [r1.id, 999999] })).status, 404);
    assert.equal((await a.post(`/api/teach/classes/${cls.id}/remove-students`, { ids: [] })).status, 400);

    // remove two inactive students
    const removed = await a.post(`/api/teach/classes/${cls.id}/remove-students`, { ids: [r1.id, r2.id, r1.id] });
    assert.equal(removed.status, 200);
    assert.deepEqual(removed.json, { removed: 2 });
    assert.deepEqual((await listOf(a, cls.id)).map((s) => s.id).sort(), [active.id, r3.id].sort());
    assert.equal((await a.get('/api/teach/state')).json.classes[0].students, 2);
    for (const s of [r1, r2]) assert.equal((await login(srv, s.username, s.pin)).status, 401);
    assert.equal((await a.post(`/api/teach/players/${r1.id}/reset-pin`)).status, 404);   // a removed student cannot be given a PIN again
    assert.ok(app.db.prepare("SELECT 1 FROM txns WHERE kind = 'core.student_removed'").get());
    const gone = app.db.prepare("SELECT id FROM accounts WHERE owner_type = 'player' AND owner_id IN (?, ?)").all(r1.id, r2.id).map((x) => x.id);
    assert.ok(gone.length >= 2);
    for (const id of gone) assert.equal(app.ledger.balance(id), 0);
    const mark = app.db.prepare('SELECT MAX(id) AS n FROM entries').get().n;
    assert.ok(app.db.prepare("SELECT 1 FROM audit_log WHERE action = 'students.remove'").get());

    // reset PINs: one, then the whole class (ids omitted); old PINs fail, new ones work
    const one = await a.post(`/api/teach/classes/${cls.id}/reset-pins`, { ids: [r3.id] });
    assert.equal(one.status, 200);
    assert.deepEqual(one.json.cards.map((c) => [c.id, c.username]), [[r3.id, r3.username]]);
    assert.equal((await login(srv, r3.username, r3.pin)).status, 401);
    assert.equal((await login(srv, r3.username, one.json.cards[0].pin)).status, 200);
    const all = await a.post(`/api/teach/classes/${cls.id}/reset-pins`, {});
    assert.deepEqual(all.json.cards.map((c) => c.id).sort(), [active.id, r3.id].sort());
    assert.equal((await login(srv, active.username, active.pin)).status, 401);
    assert.equal((await login(srv, active.username, all.json.cards.find((c) => c.id === active.id).pin)).status, 200);
    assert.equal((await a.post(`/api/teach/classes/${cls.id}/reset-pins`, { ids: [r1.id] })).status, 404);   // removed: not in the class

    // delete: wrong confirm 400, active students 409, otherwise the class is gone
    assert.equal((await a.post(`/api/teach/classes/${cls.id}/delete`, { confirm: 'block 9' })).status, 400);
    const busy = await a.post(`/api/teach/classes/${cls.id}/delete`, { confirm: 'Block 9' });
    assert.equal(busy.status, 409);
    assert.match(busy.json.error, new RegExp(active.username));
    const other = (await a.post('/api/teach/classes', { name: 'Block 2', course: 'fintech10' })).json;
    const doomed = (await a.post(`/api/teach/classes/${other.id}/students`, { count: 2 })).json.students.map((s) => ({ ...s, id: idOf(s.username) }));
    const del = await a.post(`/api/teach/classes/${other.id}/delete`, { confirm: 'Block 2' });
    assert.equal(del.status, 200);
    assert.deepEqual(del.json, { deleted: true });
    assert.deepEqual((await a.get('/api/teach/state')).json.classes.map((c) => c.id), [cls.id]);
    assert.equal((await a.get(`/api/teach/classes/${other.id}/students`)).status, 404);
    assert.equal((await a.post(`/api/teach/classes/${other.id}/rename`, { name: 'Back' })).status, 404);
    for (const s of doomed) assert.equal((await login(srv, s.username, s.pin)).status, 401);

    // the key one: months pass and the season closes; removed students' accounts get nothing new, and they have no season result
    for (let i = 0; i < 3; i++) assert.equal((await a.post('/api/teach/world/advance', { months: 2 })).status, 200);
    const worldId = app.world.current().id;
    assert.equal((await a.post('/api/teach/world/close')).status, 200);
    const au = app.ledger.audit();
    assert.equal(au.ok, true, JSON.stringify(au.problems));
    const late = app.db.prepare('SELECT COUNT(*) AS n FROM entries WHERE id > ? AND account_id IN (SELECT value FROM json_each(?))').get(mark, JSON.stringify(gone)).n;
    assert.equal(late, 0);
    const results = app.db.prepare('SELECT player_id FROM season_results WHERE world_id = ?').all(worldId).map((r) => r.player_id);
    for (const s of [r1, r2, ...doomed]) assert.ok(!results.includes(s.id), `removed ${s.id} has a season result`);
    assert.ok(results.includes(active.id));
  } finally { await srv.cleanup(); }
});

test('a season closes straight after a removal: no 500, audit ok, and the removed students are in no result, award or Life Review', async () => {
  const srv = await boot();
  const { app } = srv;
  try {
    const { teacher: a, cls, students: [active] } = await seeded(srv, 1);
    const raw = (await a.post(`/api/teach/classes/${cls.id}/students`, { count: 2 })).json.students;
    const ids = raw.map((s) => app.db.prepare('SELECT id FROM players WHERE username = ?').get(s.username).id);
    for (let i = 0; i < 3; i++) assert.equal((await a.post('/api/teach/world/advance', { months: 3 })).status, 200);   // snapshots and module rows for everyone
    assert.equal((await a.post(`/api/teach/classes/${cls.id}/remove-students`, { ids })).status, 200);
    const worldId = app.world.current().id;
    const closed = await a.post('/api/teach/world/close');
    assert.equal(closed.status, 200, JSON.stringify(closed.json));
    assert.equal(app.ledger.audit().ok, true);
    const has = (table) => app.db.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE world_id = ? AND player_id IN (SELECT value FROM json_each(?))`).get(worldId, JSON.stringify(ids)).n;
    for (const t of ['season_results', 'leaderboards_awards', 'leaderboards_reviews']) assert.equal(has(t), 0, t);
    assert.equal(app.db.prepare('SELECT COUNT(*) AS n FROM season_results WHERE world_id = ? AND player_id = ?').get(worldId, active.id).n, 1);
  } finally { await srv.cleanup(); }
});
