import { test } from 'node:test';
import assert from 'node:assert/strict';
import { boot, seeded, addClass } from './helpers.js';

const audit = (srv) => srv.app.ledger.audit();
const send = (from, to, cents) => from.client.post('/api/bank-basic/transfer', { to: to.username, cents });

test('transfers are OFF by default; the teacher switches them on per class', async () => {
  const srv = await boot();
  try {
    const { teacher, cls, students } = await seeded(srv, 2, { transfers: false });
    const [a, b] = students;
    assert.deepEqual((await a.client.get('/api/bank-basic/status')).json, { enabled: false, per_transfer_cents: 5000, daily_cents: 10000, sent_24h_cents: 0 });
    const refused = await send(a, b, 100);
    assert.equal(refused.status, 403);
    assert.match(refused.json.error, /turned off/);
    const settings = (await teacher.get('/api/bank-basic/settings')).json.classes[0];
    assert.equal(settings.transfers_enabled, 0);
    assert.equal((await teacher.post('/api/bank-basic/settings', { class_id: cls.id, enabled: true, per_transfer_cents: 5000, daily_cents: 10000 })).status, 200);
    assert.equal((await send(a, b, 100)).status, 200);
    // and off again
    await teacher.post('/api/bank-basic/settings', { class_id: cls.id, enabled: false, per_transfer_cents: 5000, daily_cents: 10000 });
    assert.equal((await send(a, b, 100)).status, 403);
  } finally { await srv.cleanup(); }
});

test('settings are validated (teacher only, sane numbers)', async () => {
  const srv = await boot();
  try {
    const { teacher, cls } = await seeded(srv, 1, { transfers: false });
    const post = (b) => teacher.post('/api/bank-basic/settings', b);
    const ok = { class_id: cls.id, enabled: true, per_transfer_cents: 5000, daily_cents: 10000 };
    assert.equal((await post({ ...ok, enabled: 'yes' })).status, 400);
    assert.equal((await post({ ...ok, per_transfer_cents: 0 })).status, 400);
    assert.equal((await post({ ...ok, per_transfer_cents: 12.5 })).status, 400);
    assert.equal((await post({ ...ok, per_transfer_cents: 20000 })).status, 400);   // above the daily limit
    assert.equal((await post({ ...ok, class_id: 999 })).status, 404);
    assert.equal((await post({ ...ok, class_id: {} })).status, 400);
    assert.equal((await post({ ...ok, class_id: '1' })).status, 400);
    assert.equal((await post(ok)).status, 200);
  } finally { await srv.cleanup(); }
});

test('default limits: $50 per transfer and $100 per rolling day; a reversed transfer frees its share', async () => {
  const srv = await boot();
  try {
    const { teacher, cls, students } = await seeded(srv, 2, { transfers: false });
    const [a, b] = students;
    await teacher.post('/api/bank-basic/settings', { class_id: cls.id, enabled: true, per_transfer_cents: 5000, daily_cents: 10000 });
    const over = await send(a, b, 5001);
    assert.equal(over.status, 400);
    assert.match(over.json.error, /\$50\.00 per transfer/);
    const first = await send(a, b, 5000);
    assert.equal(first.status, 200);
    assert.equal((await send(a, b, 5000)).status, 200);
    const daily = await send(a, b, 100);
    assert.equal(daily.status, 400);
    assert.match(daily.json.error, /Daily limit: \$100\.00.*in the last 24 hours/);
    assert.doesNotMatch(daily.json.error, /today/);
    assert.equal((await a.client.get('/api/bank-basic/status')).json.sent_24h_cents, 10000);
    assert.equal((await teacher.post(`/api/bank-basic/transfers/${first.json.txn}/reverse`)).status, 200);
    assert.equal((await send(a, b, 5000)).status, 200);                       // the reversed $50 no longer counts
    assert.equal(srv.app.ledger.balance(a.chequing.id), 50000 - 10000);
    assert.equal(audit(srv).ok, true);
  } finally { await srv.cleanup(); }
});

test('the daily limit holds under 40 parallel transfers', async () => {
  const srv = await boot();
  try {
    const { teacher, cls, students } = await seeded(srv, 2, { transfers: false });
    const [a, b] = students;
    await teacher.post('/api/bank-basic/settings', { class_id: cls.id, enabled: true, per_transfer_cents: 5000, daily_cents: 10000 });
    const results = await Promise.all(Array.from({ length: 40 }, () => send(a, b, 1000)));
    assert.equal(results.filter((r) => r.status === 200).length, 10);
    assert.equal(srv.app.ledger.balance(b.chequing.id), 50000 + 10000);
    assert.equal(audit(srv).ok, true);
  } finally { await srv.cleanup(); }
});

test('recipients must be in the same class: other classes, teachers and unknown names are all refused alike', async () => {
  const srv = await boot();
  try {
    const { teacher, students } = await seeded(srv, 2);
    const other = await addClass(srv, teacher, 'Block 2');
    await teacher.post('/api/bank-basic/settings', { class_id: other.cls.id, enabled: true, per_transfer_cents: 5000, daily_cents: 10000 });
    const [a] = students;
    for (const name of [other.students[0].username, 'teacher', 'NoSuchPerson99', '', 'system:mint']) {
      const r = await a.client.post('/api/bank-basic/transfer', { to: name, cents: 100 });
      assert.equal(r.status, 404, name);
      assert.equal(r.json.error, 'No one in your class has that username');
    }
    assert.equal(srv.app.ledger.balance(other.students[0].chequing.id), 50000);
    assert.equal(srv.app.db.prepare("SELECT COUNT(*) AS n FROM txns WHERE kind = 'bank-basic.transfer'").get().n, 0);
  } finally { await srv.cleanup(); }
});

test('every transfer is written to audit_log, and the teacher feed shows who, to whom, how much and when', async () => {
  const srv = await boot();
  try {
    const { teacher, students } = await seeded(srv, 2);
    const [a, b] = students;
    const t1 = await send(a, b, 1234);
    const t2 = await send(b, a, 100);
    const logged = srv.app.db.prepare("SELECT actor, detail FROM audit_log WHERE action = 'bank-basic.transfer' ORDER BY id").all();
    assert.equal(logged.length, 2);
    assert.equal(logged[0].actor, `player:${a.id}`);
    assert.deepEqual(JSON.parse(logged[0].detail), { txn: t1.json.txn, to: b.id, cents: 1234 });
    assert.equal(JSON.parse(logged[1].detail).txn, t2.json.txn);
    const { transfers } = (await teacher.get('/api/bank-basic/transfers')).json;
    assert.equal(transfers.length, 2);
    assert.deepEqual([transfers[1].from_name, transfers[1].to_name, transfers[1].cents, transfers[1].class_name, transfers[1].reversed], [a.username, b.username, 1234, 'Block 1', 0]);
    assert.ok(Math.abs(transfers[1].created - Date.now()) < 60000);
    assert.equal((await a.client.get('/api/bank-basic/transfers')).status, 403);
  } finally { await srv.cleanup(); }
});

test('reverse: posts a compensating txn, keeps the original entries, is logged, notifies, and cannot be repeated', async () => {
  const srv = await boot();
  try {
    const { teacher, students } = await seeded(srv, 2);
    const [a, b] = students;
    const t = await send(a, b, 7000);
    const entries = srv.app.db.prepare('SELECT COUNT(*) AS n FROM entries').get().n;
    const rev = await teacher.post(`/api/bank-basic/transfers/${t.json.txn}/reverse`);
    assert.equal(rev.status, 200);
    assert.equal(srv.app.ledger.balance(a.chequing.id), 50000);
    assert.equal(srv.app.ledger.balance(b.chequing.id), 50000);
    assert.equal(srv.app.db.prepare('SELECT COUNT(*) AS n FROM entries').get().n, entries + 2);
    assert.equal(srv.app.db.prepare('SELECT COUNT(*) AS n FROM entries WHERE txn_id = ?').get(t.json.txn).n, 2);
    assert.equal(srv.app.db.prepare("SELECT COUNT(*) AS n FROM audit_log WHERE action = 'bank-basic.transfer.reverse'").get().n, 1);
    const statement = (await a.client.get(`/api/accounts/${a.chequing.id}/statement`)).json.entries;
    assert.equal(statement[0].memo, 'Reversed by teacher');
    assert.equal((await teacher.get('/api/bank-basic/transfers')).json.transfers[0].reversed, 1);
    assert.equal((await teacher.post(`/api/bank-basic/transfers/${t.json.txn}/reverse`)).status, 400);   // already reversed
    assert.equal((await teacher.post(`/api/bank-basic/transfers/${rev.json.txn}/reverse`)).status, 404);  // a reversal is not a transfer
    assert.equal((await teacher.post('/api/bank-basic/transfers/99999/reverse')).status, 404);
    assert.equal(audit(srv).ok, true);
  } finally { await srv.cleanup(); }
});

test('reverse is refused (409, nothing changes) when the recipient has already spent the money', async () => {
  const srv = await boot();
  try {
    const { teacher, students } = await seeded(srv, 3);
    const [a, b, c] = students;
    const t = await send(a, b, 40000);
    await send(b, c, 80000);                                   // b now holds 10,000 and cannot return 40,000
    const txns = srv.app.db.prepare('SELECT COUNT(*) AS n FROM txns').get().n;
    const r = await teacher.post(`/api/bank-basic/transfers/${t.json.txn}/reverse`);
    assert.equal(r.status, 409);
    assert.match(r.json.error, /already spent/);
    assert.equal(srv.app.db.prepare('SELECT COUNT(*) AS n FROM txns').get().n, txns);
    assert.equal(audit(srv).ok, true);
  } finally { await srv.cleanup(); }
});

test('the $500 welcome grant arrives on FIRST LOGIN, once; spare cards hold no money', async () => {
  const srv = await boot();
  try {
    const teacher = srv.client();
    await teacher.post('/api/setup', { username: 'teacher', passphrase: 'correct horse battery' });
    const cls = (await teacher.post('/api/teach/classes', { name: 'Block 1', course: 'fintech10' })).json;
    const { students } = (await teacher.post(`/api/teach/classes/${cls.id}/students`, { count: 3 })).json;
    assert.equal(srv.app.ledger.audit().moneySupply, 0);          // three cards printed, nobody logged in
    const balances = () => srv.app.db.prepare("SELECT balance_cents AS c FROM accounts WHERE kind = 'chequing' ORDER BY id").all().map((r) => r.c);
    assert.deepEqual(balances(), [0, 0, 0]);
    // student 0 logs in on five devices at once; student 1 once; student 2 never
    await Promise.all(Array.from({ length: 5 }, () => srv.client().post('/api/login', { username: students[0].username, secret: students[0].pin })));
    const second = srv.client();
    await second.post('/api/login', { username: students[1].username, secret: students[1].pin });
    assert.deepEqual(balances(), [50000, 50000, 0]);
    assert.equal(srv.app.ledger.audit().moneySupply, 100000);
    assert.equal((await second.get('/api/me')).json.accounts[0].balance_cents, 50000);
    assert.equal(srv.app.db.prepare("SELECT COUNT(*) AS n FROM txns WHERE kind = 'bank-basic.welcome'").get().n, 2);
  } finally { await srv.cleanup(); }
});
