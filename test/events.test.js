import test from 'node:test';
import assert from 'node:assert/strict';
import { openDb, withTxn, afterCommit } from '../lib/db.js';
import { createEvents } from '../lib/events.js';
import { boot, bareApp, seeded, openStream } from './helpers.js';

const memDb = () => openDb(':memory:');
const quiet = (fn) => { const e = console.error; console.error = () => {}; try { return fn(); } finally { console.error = e; } };

test('onCommit: runs after the outer commit, in order', () => {
  const db = memDb();
  db.exec('CREATE TABLE t (n)');
  const seen = [];
  withTxn(db, (tx) => {
    tx.onCommit(() => seen.push(['a', db.isTransaction]));
    tx.onCommit(() => seen.push(['b', db.isTransaction]));
    db.exec('INSERT INTO t VALUES (1)');
    assert.deepEqual(seen, []);
  });
  assert.deepEqual(seen, [['a', false], ['b', false]]);
});

test('onCommit: nested success bubbles, nested failure discards only its own, outer failure discards all', () => {
  const db = memDb();
  const seen = [];
  withTxn(db, (tx) => {
    tx.onCommit(() => seen.push('outer1'));
    withTxn(db, (t2) => { t2.onCommit(() => seen.push('inner-ok')); withTxn(db, (t3) => t3.onCommit(() => seen.push('deep-ok'))); });
    assert.throws(() => withTxn(db, (t2) => { t2.onCommit(() => seen.push('inner-bad')); withTxn(db, (t3) => t3.onCommit(() => seen.push('deep-bad'))); throw new Error('no'); }), /no/);
    tx.onCommit(() => seen.push('outer2'));
    assert.deepEqual(seen, []);
  });
  assert.deepEqual(seen, ['outer1', 'inner-ok', 'deep-ok', 'outer2']);

  seen.length = 0;
  assert.throws(() => withTxn(db, (tx) => { tx.onCommit(() => seen.push('x')); withTxn(db, (t2) => t2.onCommit(() => seen.push('y'))); throw new Error('boom'); }), /boom/);
  assert.deepEqual(seen, []);
  assert.equal(db.isTransaction, false);
});

test('onCommit: a throwing callback is logged, never thrown, and does not stop later callbacks', () => {
  const db = memDb();
  const seen = [];
  quiet(() => withTxn(db, (tx) => {
    tx.onCommit(() => { throw new Error('bad listener'); });
    tx.onCommit(() => seen.push('after'));
  }));
  assert.deepEqual(seen, ['after']);
});

test('onCommit: a captured tx used after the transaction ended throws; async callbacks are refused', () => {
  const db = memDb();
  let captured;
  withTxn(db, (tx) => { captured = tx; });
  assert.throws(() => captured.onCommit(() => {}), /outside its transaction/);
  let inner;
  withTxn(db, () => { withTxn(db, (tx) => { inner = tx; }); });
  assert.throws(() => inner.onCommit(() => {}), /outside its transaction/);
  const seen = [];
  assert.throws(() => withTxn(db, async (tx) => { tx.onCommit(() => seen.push('x')); }), /synchronous/);
  assert.deepEqual(seen, []);
  assert.equal(db.isTransaction, false);
});

test('afterCommit: deferred inside a transaction, immediate outside', () => {
  const db = memDb();
  const seen = [];
  afterCommit(db, () => seen.push('now'));
  withTxn(db, () => { afterCommit(db, () => seen.push('later')); assert.deepEqual(seen, ['now']); });
  assert.deepEqual(seen, ['now', 'later']);
  assert.throws(() => withTxn(db, () => { afterCommit(db, () => seen.push('lost')); throw new Error('x'); }));
  assert.deepEqual(seen, ['now', 'later']);
});

test('events: on/off/emit, wildcard, a throwing listener is isolated', () => {
  const logged = [];
  const ev = createEvents({ log: { error: (...a) => logged.push(a) } });
  const seen = [];
  const off = ev.on('a', (p) => seen.push(['a', p]));
  ev.on('*', (p, type) => seen.push(['*', type]));
  ev.on('a', () => { throw new Error('x'); });
  ev.emit('a', 1);
  assert.deepEqual(seen, [['a', 1], ['*', 'a']]);
  assert.equal(logged.length, 1);
  assert.match(logged[0][0], /a/);
  off();
  assert.equal(ev.listenerCount('a'), 1);
  ev.emit('b', 2);
  assert.deepEqual(seen.at(-1), ['*', 'b']);
});

test('world.advance() called directly emits exactly one world.month, however many months it covers', async () => {
  const { app, cleanup } = await bareApp();
  try {
    const seen = [];
    app.events.on('world.month', (p) => seen.push(p));
    const from = app.world.current().month;
    app.world.advance({ months: 3 });
    assert.equal(seen.length, 1);
    assert.deepEqual(seen[0], { from, month: from + 3, worldId: app.world.current().id });
    assert.throws(() => app.world.advance({ months: 2, from: 0 }));    // stale: nothing emitted
    assert.equal(seen.length, 1);
    app.world.setMonthsPerDay(2);
  } finally { cleanup(); }
});

test('a ledger.post inside an outer withTxn that then throws emits no ledger.posted; committed ones emit once', async () => {
  const { app, cls, cleanup } = await bareApp();
  try {
    const [s] = await app.players.createStudents({ classId: cls.id, count: 1, hash: false });
    const acct = app.ledger.accountId('player', s.id, 'chequing');
    const seen = [];
    app.events.on('ledger.posted', (p) => seen.push(p));
    const grant = () => app.ledger.post({ kind: 'grant', legs: [{ account: app.ledger.system('mint'), cents: -500 }, { account: acct, cents: 500 }] });
    assert.throws(() => withTxn(app.db, () => { grant(); throw new Error('abort'); }), /abort/);
    assert.equal(seen.length, 0);
    assert.equal(app.ledger.balance(acct), 0);
    const txnId = withTxn(app.db, () => grant());
    assert.equal(seen.length, 1);
    assert.deepEqual(seen[0], { txnId, kind: 'grant', actor: 'system', legs: [{ account: app.ledger.system('mint'), cents: -500 }, { account: acct, cents: 500 }], owners: [{ type: 'player', id: s.id }] });
  } finally { cleanup(); }
});

test('the welcome grant on first login emits ledger.posted with the student as owner', async () => {
  const { app, cls, cleanup } = await bareApp();
  try {
    const [s] = await app.players.createStudents({ classId: cls.id, count: 1, hash: false });
    const seen = [];
    app.events.on('ledger.posted', (p) => seen.push(p));
    app.modules.onLogin({ id: s.id, username: s.username, class_id: cls.id }, cls.course_id);
    assert.equal(seen.length, 1);
    assert.equal(seen[0].kind, 'bank-basic.welcome');
    assert.deepEqual(seen[0].owners, [{ type: 'player', id: s.id }]);
    app.modules.onLogin({ id: s.id, username: s.username, class_id: cls.id }, cls.course_id);   // idempotent: no second grant, no second event
    assert.equal(seen.length, 1);
  } finally { cleanup(); }
});

test('class.created and players.created fire after commit', async () => {
  const { app, cls, cleanup } = await bareApp();
  try {
    const seen = [];
    app.events.on('*', (p, type) => seen.push([type, p]));
    const c2 = app.players.createClass({ name: 'Block 2', course: 'fintech10' });
    const made = await app.players.createStudents({ classId: c2.id, count: 2, hash: false });
    assert.deepEqual(seen.filter(([t]) => t === 'class.created'), [['class.created', { classId: c2.id, course_id: 'fintech10' }]]);
    assert.deepEqual(seen.filter(([t]) => t === 'players.created'), [['players.created', { classId: c2.id, playerIds: made.map((m) => m.id) }]]);
  } finally { cleanup(); }
});

test('over HTTP: a transfer delivers balance to both students and a ledger hint to the teacher; reset PIN closes the stream', async () => {
  const srv = await boot();
  try {
    const { teacher, students: [a, b, c] } = await seeded(srv, 3);
    const [ta, sa, sb, sc] = await Promise.all([openStream(srv, teacher), openStream(srv, a.client), openStream(srv, b.client), openStream(srv, c.client)]);
    assert.equal(ta.status, 200);
    const r = await a.client.post('/api/bank-basic/transfer', { to: b.username, cents: 1000 });
    assert.equal(r.status, 200);
    assert.ok(await sa.next('balance'));
    assert.ok(await sb.next('balance'));
    assert.equal(await sc.next('balance', 300), null);                 // an uninvolved student hears nothing
    const hint = await ta.next('ledger');
    assert.ok(hint);
    assert.ok(Number.isInteger(hint.id));

    // advance: every stream hears the month
    const adv = await teacher.post('/api/teach/world/advance', { months: 1 });
    assert.equal(adv.status, 200);
    for (const s of [ta, sa, sb, sc]) assert.equal((await s.next('month')).data.month, adv.json.month);

    // a teacher world setting and a class creation reach the console
    await teacher.post('/api/teach/world/settings', { months_per_day: 2 });
    assert.ok(await ta.next('world'));
    await teacher.post('/api/teach/classes', { name: 'Block 9', course: 'fintech10' });
    assert.ok(await ta.next('console'));
    await teacher.post('/api/bank-basic/settings', { class_id: 1, enabled: false, per_transfer_cents: 100, daily_cents: 200 });
    assert.ok(await ta.next('console'));

    // a PIN reset ends that student's sessions and streams
    const reset = await teacher.post(`/api/teach/players/${c.id}/reset-pin`, {});
    assert.equal(reset.status, 200);
    await new Promise((r2) => setTimeout(r2, 100));
    assert.equal((await c.client.get('/api/me')).json.user, null);
    [ta, sa, sb, sc].forEach((s) => s.close());
  } finally { await srv.cleanup(); }
});

test('logout ends that session\'s stream but not the same player\'s other session', async () => {
  const srv = await boot();
  try {
    const { students: [a] } = await seeded(srv, 1);
    const other = srv.client();
    const names = (await a.client.get('/api/me')).json.user.username;
    await other.post('/api/login', { username: names, secret: a.pin });
    const s1 = await openStream(srv, a.client);
    const s2 = await openStream(srv, other);
    await a.client.post('/api/logout');
    await new Promise((r) => setTimeout(r, 100));
    await srv.app.world.advance({ months: 1 });
    assert.ok(await s2.next('month'));
    assert.equal(await s1.next('month', 300), null);                   // the logged-out stream was closed
    s1.close(); s2.close();
  } finally { await srv.cleanup(); }
});
