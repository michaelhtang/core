import fs from 'node:fs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { boot, seeded } from './helpers.js';
import { createClock } from '../lib/clock.js';

// The modules config/vdaa.json enables for fintech10, in load order (the class in these tests is fintech10).
// the teacher console lists only modules that declare a teacher panel
const COURSE_MODULES = JSON.parse(fs.readFileSync(new URL('../config/vdaa.json', import.meta.url), 'utf8')).courses.fintech10.modules
  .filter((m) => /teacherPanels/.test(fs.readFileSync(new URL(`../modules/${m}/index.js`, import.meta.url), 'utf8')));
const PASS = 'another long passphrase';
const tokenOf = (url) => new URL(url).searchParams.get('invite');

// A server whose clock you set by hand, teacher A (world teacher) with a class of students, and teacher B joined by invite.
async function twoTeachers(opts = {}) {
  let t = Date.parse('2026-06-10T14:00:00Z');
  const clock = createClock({ now: () => t });
  const srv = await boot({ clock, ...opts });
  const seed = await seeded(srv, 2);
  const invite = (await seed.teacher.post('/api/teach/invites')).json;
  const b = srv.client();
  const join = await b.post('/api/teach/join', { token: tokenOf(invite.url), username: 'teacherB', passphrase: PASS });
  assert.equal(join.status, 200);
  return { srv, ...seed, b, invite, advanceClock: (ms) => { t += ms; } };
}

test('teacher B cannot see or act on teacher A\'s class: state omits it; students, unlock, reset PIN, add students, bank settings, feed and reverse all 404', async () => {
  const { srv, teacher: a, cls, students: [s1, s2], b } = await twoTeachers();
  try {
    const sent = await s1.client.post('/api/bank-basic/transfer', { to: s2.username, cents: 500 });
    assert.equal(sent.status, 200);

    assert.deepEqual((await b.get('/api/teach/state')).json.classes, []);
    assert.equal((await a.get('/api/teach/state')).json.classes.length, 1);
    assert.equal((await b.get(`/api/teach/classes/${cls.id}/students`)).status, 404);
    assert.equal((await a.get(`/api/teach/classes/${cls.id}/students`)).status, 200);
    assert.equal((await b.post(`/api/teach/classes/${cls.id}/students`, { count: 1 })).status, 404);
    assert.equal((await b.post(`/api/teach/players/${s1.id}/unlock`)).status, 404);
    assert.equal((await b.post(`/api/teach/players/${s1.id}/reset-pin`)).status, 404);
    assert.equal((await a.post(`/api/teach/players/${s1.id}/unlock`)).status, 200);
    const on = { class_id: cls.id, enabled: false, per_transfer_cents: 5000, daily_cents: 10000 };
    assert.equal((await b.post('/api/bank-basic/settings', on)).status, 404);
    assert.deepEqual((await b.get('/api/bank-basic/settings')).json.classes, []);
    assert.equal((await a.get('/api/bank-basic/settings')).json.classes.length, 1);
    assert.deepEqual((await b.get('/api/bank-basic/transfers')).json.transfers, []);
    assert.equal((await a.get('/api/bank-basic/transfers')).json.transfers.length, 1);
    const txn = (await a.get('/api/bank-basic/transfers')).json.transfers[0].id;
    assert.equal((await b.post(`/api/bank-basic/transfers/${txn}/reverse`)).status, 404);
    assert.equal((await a.post(`/api/bank-basic/transfers/${txn}/reverse`)).status, 200);

    // B's own class works and stays B's
    const mine = (await b.post('/api/teach/classes', { name: 'Block B', course: 'fintech10' })).json;
    assert.equal((await b.post(`/api/teach/classes/${mine.id}/students`, { count: 1 })).status, 200);
    assert.equal((await a.get(`/api/teach/classes/${mine.id}/students`)).status, 404);
    assert.deepEqual((await b.get('/api/teach/state')).json.classes.map((c) => c.id), [mine.id]);
    assert.equal((await b.get('/api/teach/audit')).status, 200);                 // audit.read: any teacher
  } finally { await srv.cleanup(); }
});

test('teacherPanels: modules of the courses the teacher has a class in; the world teacher with no classes sees all, another teacher with none sees none', async () => {
  const srv = await boot();
  try {
    const a = srv.client();
    await a.post('/api/setup', { username: 'teacher', passphrase: 'correct horse battery' });
    const panels = async (c) => (await c.get('/api/me')).json.teacherPanels.map((p) => p.module);
    assert.deepEqual(await panels(a), COURSE_MODULES);
    const b = srv.client();
    await b.post('/api/teach/join', { token: tokenOf((await a.post('/api/teach/invites')).json.url), username: 'teacherB', passphrase: PASS });
    assert.deepEqual(await panels(b), []);
    await b.post('/api/teach/classes', { name: 'B1', course: 'fintech10' });
    assert.deepEqual(await panels(b), COURSE_MODULES);
    assert.equal((await b.get('/api/me')).json.user.world_teacher, false);
    assert.equal((await a.get('/api/me')).json.user.world_teacher, true);
  } finally { await srv.cleanup(); }
});

test('only the world teacher advances or configures the clock, closes seasons and invites; others get 403', async () => {
  const { srv, teacher: a, b } = await twoTeachers();
  try {
    const from = (await a.get('/api/teach/state')).json.world.month;
    for (const [p, body] of [['/api/teach/world/advance', { from }], ['/api/teach/world/settings', { months_per_day: 2 }], ['/api/teach/world/settings', { auto_advance: 'school_days' }],
      ['/api/teach/world/close', {}], ['/api/teach/world/create', { name: 'x', season_start: '2026-09-01', season_end: '2027-01-01' }], ['/api/teach/invites', {}]]) {
      assert.equal((await b.post(p, body)).status, 403, p);
    }
    assert.equal((await a.get('/api/teach/state')).json.world.month, from);
    assert.equal((await a.post('/api/teach/world/advance', { from })).json.month, from + 1);
    assert.equal((await b.get('/api/teach/state')).json.world.month, from + 1);   // B can read the clock
  } finally { await srv.cleanup(); }
});

test('invites: single use, 7 days, unknown tokens 404, only the hash is stored, joins are throttled', async () => {
  const { srv, teacher: a, invite, advanceClock } = await twoTeachers();
  try {
    assert.match(invite.url, /\/teach\?invite=[0-9a-f]{64}$/);
    const token = tokenOf(invite.url);
    const rows = srv.app.db.prepare('SELECT * FROM teacher_invites').all();
    assert.equal(rows.length, 1);
    assert.notEqual(rows[0].token_hash, token);
    assert.ok(rows[0].used_by);
    const join = (c, body) => c.post('/api/teach/join', body);
    // used: 404, and no second teacher
    assert.equal((await join(srv.client(), { token, username: 'teacherC', passphrase: PASS })).status, 404);
    // unknown
    assert.equal((await join(srv.client(), { token: 'f'.repeat(64), username: 'teacherC', passphrase: PASS })).status, 404);
    // expired
    const fresh = tokenOf((await a.post('/api/teach/invites')).json.url);
    advanceClock(7 * 864e5 + 1000);
    const late = srv.client();
    assert.equal((await join(late, { token: fresh, username: 'teacherC', passphrase: PASS })).status, 404);
    // within 7 days works; a short passphrase and a taken username are refused without using the invite up
    const a2 = srv.client();
    const live = tokenOf((await (async () => { const c = srv.client(); await c.post('/api/login', { username: 'teacher', secret: 'correct horse battery' }); return c.post('/api/teach/invites'); })()).json.url);
    assert.equal((await join(a2, { token: live, username: 'teacherD', passphrase: 'short' })).status, 400);
    assert.equal((await join(a2, { token: live, username: 'teacher', passphrase: PASS })).status, 409);
    assert.equal((await join(a2, { token: live, username: 'teacherD', passphrase: PASS })).status, 200);
    assert.equal((await a2.get('/api/me')).json.user.username, 'teacherD');
    assert.equal(srv.app.db.prepare("SELECT COUNT(*) AS n FROM players WHERE role = 'teacher' AND world_teacher = 0").get().n, 2);
    // throttle: wrong tokens from one IP run into the per-key limit (5 a minute)
    let last;
    for (let i = 0; i < 6; i++) last = await join(srv.client(), { token: 'a'.repeat(64), username: 'teacherE', passphrase: PASS });
    assert.equal(last.status, 429);
  } finally { await srv.cleanup(); }
});

test('close season: balances zero, audit ok, season_results match, second close 409, new world takes the classes, same PIN logs in and gets a new welcome grant', async () => {
  const srv = await boot();
  try {
    const { teacher: a, cls, students: [s1, s2] } = await seeded(srv, 2);
    const { app } = srv;
    const closed = [];
    app.events.on('world.closed', (e) => closed.push(e));
    await s1.client.post('/api/bank-basic/transfer', { to: s2.username, cents: 1234 });
    const loan = app.ledger.openAccount({ ownerType: 'player', ownerId: s1.id, kind: 'loan' });
    app.ledger.post({ kind: 'test_loan', legs: [{ account: loan, cents: -20000 }, { account: s1.chequing.id, cents: 20000 }] });   // a negative loan balance resets too
    const before = Object.fromEntries([s1, s2].map((s) => [s.id, app.db.prepare("SELECT SUM(balance_cents) AS n FROM accounts WHERE owner_type = 'player' AND owner_id = ?").get(s.id).n]));
    assert.deepEqual(before, { [s1.id]: 50000 - 1234 + 20000 - 20000, [s2.id]: 50000 + 1234 });
    const supply = app.ledger.audit().moneySupply;
    const worldId = app.world.current().id;

    assert.equal((await a.post('/api/teach/world/create', { name: 'S2', season_start: '2026-09-01', season_end: '2027-01-01' })).status, 409);   // still active
    const res = await a.post('/api/teach/world/close');
    assert.equal(res.status, 200);
    assert.equal(res.json.status, 'closed');
    assert.deepEqual(closed, [{ worldId }]);
    assert.equal(app.db.prepare("SELECT COUNT(*) AS n FROM accounts WHERE owner_type = 'player' AND balance_cents <> 0").get().n, 0);
    const au = app.ledger.audit();
    assert.equal(au.ok, true, JSON.stringify(au.problems));
    assert.equal(au.moneySupply, supply);                                                    // money moved to the sink, none destroyed
    assert.deepEqual(app.db.prepare('SELECT player_id, net_worth_cents FROM season_results WHERE world_id = ? ORDER BY player_id').all(worldId).map((r) => [r.player_id, r.net_worth_cents]),
      [[s1.id, before[s1.id]], [s2.id, before[s2.id]]]);
    assert.ok(app.db.prepare("SELECT 1 FROM txns WHERE kind = 'core.season_reset'").get());
    assert.equal((await a.post('/api/teach/world/close')).status, 409);
    assert.equal((await a.post('/api/teach/world/advance', {})).status, 409);                // nothing ticks in a closed season
    assert.equal((await s1.client.get('/api/me')).json.accounts.find((x) => x.kind === 'chequing').balance_cents, 0);

    assert.equal((await a.post('/api/teach/world/create', { name: 'S2', season_start: '2026-09-01', season_end: '2027-01-01' })).status, 200);
    assert.equal((await a.post('/api/teach/world/create', { name: 'S3', season_start: '2026-09-01', season_end: '2027-01-01' })).status, 409);
    const w2 = app.world.current();
    assert.notEqual(w2.id, worldId);
    assert.equal(app.db.prepare('SELECT world_id FROM classes WHERE id = ?').get(cls.id).world_id, w2.id);
    assert.equal((await a.get('/api/teach/state')).json.classes.length, 1);
    assert.equal((await a.post('/api/teach/world/advance', {})).status, 200);

    // the same pseudonym and PIN log in again; the welcome grant is paid once for this season
    for (const s of [s1, s2]) {
      const c = srv.client();
      assert.equal((await c.post('/api/login', { username: s.username, secret: s.pin })).status, 200);
      assert.equal((await c.post('/api/login', { username: s.username, secret: s.pin })).status, 200);
      assert.equal((await c.get('/api/me')).json.accounts.find((x) => x.kind === 'chequing').balance_cents, 50000);
    }
    assert.equal(app.db.prepare("SELECT COUNT(*) AS n FROM txns WHERE kind = 'bank-basic.welcome'").get().n, 4);
    assert.equal(app.ledger.audit().ok, true);
  } finally { await srv.cleanup(); }
});

test('welcome grants from before seasons existed (no worldId) count as the first world: no second grant in it, a new one in the next', async () => {
  const srv = await boot();
  try {
    const { students: [s] } = await seeded(srv, 1);
    const { app } = srv;
    app.db.exec('DROP TRIGGER IF EXISTS txns_guard');   // test-only: rewrite the stored meta the way an old database has it
    app.db.prepare("UPDATE txns SET meta = '{\"reason\":\"welcome\"}' WHERE kind = 'bank-basic.welcome'").run();
    const player = { id: s.id, username: s.username, class_id: 1 };
    const n = () => app.db.prepare("SELECT COUNT(*) AS n FROM txns WHERE kind = 'bank-basic.welcome'").get().n;
    app.modules.onLogin(player, 'fintech10');
    assert.equal(n(), 1);
    app.world.close();
    app.world.create({ name: 'S2' });
    app.modules.onLogin(player, 'fintech10');
    assert.equal(n(), 2);
    app.modules.onLogin(player, 'fintech10');
    assert.equal(n(), 2);
  } finally { await srv.cleanup(); }
});

test("bank feed: a busy class elsewhere never pushes a teacher's own transfers out of view", async () => {
  const { srv, students: [s1, s2], b } = await twoTeachers();
  try {
    const mine = (await b.post('/api/teach/classes', { name: 'Block B', course: 'fintech10' })).json;
    await b.post('/api/bank-basic/settings', { class_id: mine.id, enabled: true, per_transfer_cents: 5000, daily_cents: 10000 });
    const [x, y] = (await b.post(`/api/teach/classes/${mine.id}/students`, { count: 2 })).json.students;
    const cx = srv.client(); await cx.post('/api/login', { username: x.username, secret: x.pin });
    const cy = srv.client(); await cy.post('/api/login', { username: y.username, secret: y.pin });
    assert.equal((await cx.post('/api/bank-basic/transfer', { to: y.username, cents: 300 })).status, 200);
    // 1,200 newer transfers in teacher A's class, straight through the ledger (as the bank would post them).
    const { ledger } = srv.app;
    const { db } = srv.app;
    for (let i = 0; i < 1200; i++) {
      const id = ledger.post({ kind: 'bank-basic.transfer', actor: `player:${s1.id}`, meta: { from: s1.id, to: s2.id, fromName: s1.username, toName: s2.username },
        legs: [{ account: s1.chequing.id, cents: -1 }, { account: s2.chequing.id, cents: 1 }] });
      db.prepare('INSERT INTO bank_transfers (txn_id, class_id) VALUES (?, ?)').run(id, s1.class_id ?? db.prepare('SELECT class_id FROM players WHERE id = ?').get(s1.id).class_id);
    }
    const feed = (await b.get('/api/bank-basic/transfers')).json.transfers;
    assert.equal(feed.length, 1);
    assert.equal(feed[0].from_name, x.username);
  } finally { await srv.cleanup(); }
});

test("account statements: a teacher reads only their own students' accounts; system accounts are the world teacher's", async () => {
  const { srv, teacher: a, students: [s1], b } = await twoTeachers();
  try {
    const path = `/api/accounts/${s1.chequing.id}/statement`;
    assert.equal((await a.get(path)).status, 200);
    assert.equal((await b.get(path)).status, 404);
    const mint = srv.app.ledger.system('mint');
    assert.equal((await a.get(`/api/accounts/${mint}/statement`)).status, 200);
    assert.equal((await b.get(`/api/accounts/${mint}/statement`)).status, 404);
    const mine = (await b.post('/api/teach/classes', { name: 'Block B', course: 'fintech10' })).json;
    const [x] = (await b.post(`/api/teach/classes/${mine.id}/students`, { count: 1 })).json.students;
    const xAcct = srv.app.ledger.accountId('player', srv.app.players.byUsername(x.username).id, 'chequing');
    assert.equal((await b.get(`/api/accounts/${xAcct}/statement`)).status, 200);
    assert.equal((await a.get(`/api/accounts/${xAcct}/statement`)).status, 404);
  } finally { await srv.cleanup(); }
});
