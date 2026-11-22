import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { bareApp, boot, seeded, tmpDir } from './helpers.js';
import { openDb, migrate, coreMigrations } from '../lib/db.js';
import { createApp, ROOT } from '../lib/app.js';

async function twoPlayers() {
  const ctx = await bareApp();
  const [a, b] = await ctx.app.players.createStudents({ classId: ctx.cls.id, count: 2, hash: false });
  const { ledger } = ctx.app;
  for (const p of [a, b]) ctx.app.modules.onLogin(p, 'fintech10');
  return { ...ctx, ledger, a: ledger.accountId('player', a.id, 'chequing'), b: ledger.accountId('player', b.id, 'chequing') };
}

test('the unique index on txns.reverses refuses a second reversal, even around ledger.reverse()', async () => {
  const { ledger, app, a, b, cleanup } = await twoPlayers();
  const t = ledger.transfer({ from: a, to: b, cents: 1000 });
  assert.equal(ledger.isReversed(t), false);
  const r = ledger.reverse(t);
  assert.equal(ledger.isReversed(t), true);
  assert.equal(app.db.prepare('SELECT reverses FROM txns WHERE id = ?').get(r).reverses, t);
  assert.throws(() => ledger.reverse(t), { name: 'LedgerError', message: 'Already reversed' });
  app.db.exec('UPDATE ledger_lock SET open = 1');   // the lock is open, so only the index can say no
  assert.throws(() => app.db.prepare("INSERT INTO txns (kind, actor, created, reverses) VALUES ('reversal', 'x', 0, ?)").run(t), /UNIQUE constraint failed: txns.reverses/);
  app.db.exec('UPDATE ledger_lock SET open = 0');
  assert.equal(ledger.audit().ok, true);
  cleanup();
});

test('statement running balance is right after a reversal and matches the cached balance', async () => {
  const { ledger, a, b, cleanup } = await twoPlayers();
  const t = ledger.transfer({ from: a, to: b, cents: 1000 });
  ledger.transfer({ from: a, to: b, cents: 2000 });
  ledger.reverse(t);
  assert.deepEqual(ledger.statement(a).map((e) => [e.amount_cents, e.balance_cents]), [[1000, 48000], [-2000, 47000], [-1000, 49000], [50000, 50000]]);
  assert.equal(ledger.statement(a)[0].balance_cents, ledger.balance(a));
  assert.equal(ledger.statement(b)[0].balance_cents, ledger.balance(b));
  cleanup();
});

test('sumByKind: out/in/net, since, and excludeReversed drops reversed transfers', async () => {
  const { ledger, a, b, cleanup } = await twoPlayers();
  const t = ledger.transfer({ from: a, to: b, cents: 1000 });
  ledger.transfer({ from: a, to: b, cents: 2000 });
  ledger.transfer({ from: b, to: a, cents: 300 });
  const q = (o) => ledger.sumByKind({ account: a, kind: 'transfer', ...o });
  assert.equal(q({ dir: 'out' }), 3000);
  assert.equal(q({ dir: 'out', excludeReversed: true }), 3000);
  ledger.reverse(t);
  assert.equal(q({ dir: 'out', excludeReversed: true }), 2000);
  assert.equal(q({ dir: 'out' }), 3000);
  assert.equal(q({ dir: 'in', excludeReversed: true }), 300);
  assert.equal(q({}), -3000 + 300);
  assert.equal(q({ dir: 'out', since: Date.now() + 1000 }), 0);
  assert.equal(ledger.sumByKind({ account: a, kind: 'core.reversal', dir: 'in' }), 1000);
  const feed = ledger.txnsByKind({ kind: 'transfer' });
  assert.deepEqual(feed.map((x) => [x.cents, x.reversed]), [[300, 0], [2000, 0], [1000, 1]]);
  cleanup();
});

test('upgrade: a v0 database (migrations 001+002, old-style reversal) migrates to 003 with a clean audit and correct running balances', async () => {
  const dataDir = tmpDir();
  try {
    const old = openDb(path.join(dataDir, 'vdaa.db'));
    migrate(old, coreMigrations(path.join(ROOT, 'migrations')).filter((m) => /\/00[12]_/.test(m.id)));
    const acct = (id) => old.prepare("INSERT INTO accounts (owner_type, owner_id, kind, created) VALUES ('player', ?, 'chequing', 0)").run(id).lastInsertRowid;
    const [mint, A, B] = [1, Number(acct(1)), Number(acct(2))];
    old.exec('UPDATE ledger_lock SET open = 1');
    const txn = (kind, meta, legs) => {
      const id = Number(old.prepare('INSERT INTO txns (kind, actor, created, meta) VALUES (?, ?, ?, ?)').run(kind, 'system', Date.now(), JSON.stringify(meta)).lastInsertRowid);
      for (const [acc, c] of legs) {
        old.prepare('UPDATE accounts SET balance_cents = balance_cents + ? WHERE id = ?').run(c, acc);
        old.prepare('INSERT INTO entries (txn_id, account_id, amount_cents, created) VALUES (?, ?, ?, 0)').run(id, acc, c);
      }
      return id;
    };
    txn('grant', { reason: 'welcome' }, [[mint, -50000], [A, 50000]]);
    txn('grant', { reason: 'welcome' }, [[mint, -50000], [B, 50000]]);
    const t3 = txn('transfer', {}, [[A, -1000], [B, 1000]]);
    txn('transfer', {}, [[A, -2000], [B, 2000]]);
    const rev = txn('reversal', { reverses: t3 }, [[A, 1000], [B, -1000]]);
    old.exec('UPDATE ledger_lock SET open = 0');
    old.close();

    const app = await createApp({ dataDir });   // applies 003
    const { ledger, db } = app;
    assert.equal(ledger.audit().ok, true, JSON.stringify(ledger.audit().problems));
    assert.deepEqual(ledger.statement(A).map((e) => e.balance_cents), [48000, 47000, 49000, 50000]);
    assert.deepEqual(ledger.statement(B).map((e) => e.balance_cents), [52000, 53000, 51000, 50000]);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM entries WHERE balance_after_cents IS NULL').get().n, 0);
    assert.equal(db.prepare('SELECT reverses FROM txns WHERE id = ?').get(rev).reverses, t3);
    assert.equal(ledger.isReversed(t3), true);
    assert.throws(() => ledger.reverse(t3), /Already reversed/);
    assert.equal(ledger.sumByKind({ account: A, kind: 'bank-basic.transfer', dir: 'out', excludeReversed: true }), 2000);
    assert.throws(() => db.exec('UPDATE entries SET balance_after_cents = 0'), /append-only/);   // the trigger is back
    ledger.transfer({ from: A, to: B, cents: 500 });                                             // and new posts keep the chain going
    assert.equal(ledger.statement(A)[0].balance_cents, 47500);
    assert.equal(ledger.audit().ok, true);
    db.close();
  } finally { fs.rmSync(dataDir, { recursive: true, force: true }); }
});

test('transfers: under 100 cents is a 400; the 21st in 10 minutes is a 429, and failed sends do not use up the allowance', async () => {
  const srv = await boot();
  try {
    const { students } = await seeded(srv, 2);
    const [a, b] = students;
    const send = (cents) => a.client.post('/api/bank-basic/transfer', { to: b.username, cents });
    const small = await send(99);
    assert.equal(small.status, 400);
    assert.match(small.json.error, /minimum/);
    for (let i = 0; i < 5; i++) assert.equal((await send(10_000_000)).status, 400);   // refused: not counted
    for (let i = 0; i < 20; i++) assert.equal((await send(100)).status, 200, `transfer ${i + 1}`);
    const over = await send(100);
    assert.equal(over.status, 429);
    assert.equal((await b.client.post('/api/bank-basic/transfer', { to: a.username, cents: 100 })).status, 200);   // per player
    assert.equal(srv.app.ledger.audit().ok, true);
  } finally { await srv.cleanup(); }
});
