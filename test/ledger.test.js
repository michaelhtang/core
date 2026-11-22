import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bareApp } from './helpers.js';
import { withTxn } from '../lib/db.js';

async function twoPlayers() {
  const ctx = await bareApp();
  const [a, b] = await ctx.app.players.createStudents({ classId: ctx.cls.id, count: 2, hash: false });
  const { ledger } = ctx.app;
  for (const p of [a, b]) ctx.app.modules.onLogin(p, 'fintech10');   // the welcome grant arrives on first login
  return { ...ctx, ledger, a: ledger.accountId('player', a.id, 'chequing'), b: ledger.accountId('player', b.id, 'chequing') };
}

test('students are funded by a mint grant on first login; the audit passes and supply matches', async () => {
  const { ledger, a, b, cleanup } = await twoPlayers();
  assert.equal(ledger.balance(a), 50000);
  assert.equal(ledger.balance(b), 50000);
  const audit = ledger.audit();
  assert.equal(audit.ok, true);
  assert.equal(audit.moneySupply, 100000);          // minus the mint balance
  assert.equal(ledger.balance(ledger.system('mint')), -100000);
  assert.equal(ledger.statement(a)[0].kind, 'bank-basic.welcome');
  cleanup();
});

test('transfer is zero-sum: two entries that cancel', async () => {
  const { ledger, app, a, b, cleanup } = await twoPlayers();
  ledger.transfer({ from: a, to: b, cents: 1234, kind: 'transfer', actor: 'test' });
  assert.equal(ledger.balance(a), 50000 - 1234);
  assert.equal(ledger.balance(b), 50000 + 1234);
  assert.equal(app.db.prepare('SELECT SUM(amount_cents) AS s FROM entries').get().s, 0);
  assert.equal(ledger.audit().ok, true);
  cleanup();
});

test('legs that do not sum to zero are rejected and nothing is written', async () => {
  const { ledger, app, a, b, cleanup } = await twoPlayers();
  const before = app.db.prepare('SELECT COUNT(*) AS n FROM entries').get().n;
  assert.throws(() => ledger.post({ kind: 'bad', legs: [{ account: a, cents: -100 }, { account: b, cents: 99 }] }), /sum to zero/);
  assert.equal(app.db.prepare('SELECT COUNT(*) AS n FROM entries').get().n, before);
  cleanup();
});

test('amounts must be whole non-zero cents', async () => {
  const { ledger, a, b, cleanup } = await twoPlayers();
  for (const cents of [0, -5, 1.5, NaN, '10', 2 ** 60]) {
    assert.throws(() => ledger.transfer({ from: a, to: b, cents }), /cents/);
  }
  assert.throws(() => ledger.transfer({ from: a, to: a, cents: 1 }), /same account/);
  cleanup();
});

test('a player account cannot go negative; the failed transfer changes nothing', async () => {
  const { ledger, a, b, cleanup } = await twoPlayers();
  assert.throws(() => ledger.transfer({ from: a, to: b, cents: 50001 }), /Insufficient funds/);
  assert.equal(ledger.balance(a), 50000);
  assert.equal(ledger.balance(b), 50000);
  ledger.transfer({ from: a, to: b, cents: 50000 });   // exactly to zero is fine
  assert.equal(ledger.balance(a), 0);
  cleanup();
});

test('system accounts may go negative (mint does); a multi-leg post is all-or-nothing', async () => {
  const { ledger, app, a, b, cleanup } = await twoPlayers();
  const mint = ledger.system('mint');
  const sink = ledger.system('sink');
  assert.ok(ledger.balance(mint) < 0);
  const entriesBefore = app.db.prepare('SELECT COUNT(*) AS n FROM entries').get().n;
  // first two legs are fine, the third overdraws b: everything must roll back
  assert.throws(() => ledger.post({ kind: 'bad', legs: [
    { account: a, cents: -100 }, { account: sink, cents: 100 }, { account: b, cents: -60000 }, { account: sink, cents: 60000 },
  ] }), /Insufficient funds/);
  assert.equal(ledger.balance(a), 50000);
  assert.equal(ledger.balance(sink), 0);
  assert.equal(app.db.prepare('SELECT COUNT(*) AS n FROM entries').get().n, entriesBefore);
  ledger.transfer({ from: a, to: sink, cents: 700, kind: 'fee' });
  assert.equal(ledger.audit().sink, 700);
  assert.equal(ledger.audit().circulating, 100000 - 700);
  cleanup();
});

test('a post inside a bigger transaction rolls back with it', async () => {
  const { ledger, app, a, b, cleanup } = await twoPlayers();
  assert.throws(() => withTxn(app.db, () => {
    ledger.transfer({ from: a, to: b, cents: 1000 });
    throw new Error('later step failed');
  }), /later step failed/);
  assert.equal(ledger.balance(a), 50000);
  assert.equal(ledger.audit().ok, true);
  cleanup();
});

test('entries are append-only at the database level', async () => {
  const { app, cleanup } = await twoPlayers();
  assert.throws(() => app.db.exec('UPDATE entries SET amount_cents = 1 WHERE id = 1'), /append-only/);
  assert.throws(() => app.db.exec('DELETE FROM entries WHERE id = 1'), /append-only/);
  cleanup();
});

test('audit notices a tampered balance and a forbidden negative', async () => {
  const { ledger, app, a, cleanup } = await twoPlayers();
  app.db.exec('UPDATE ledger_lock SET open = 1');          // get past the guard to simulate a corrupted database
  app.db.prepare('UPDATE accounts SET balance_cents = -5 WHERE id = ?').run(a);
  app.db.exec('UPDATE ledger_lock SET open = 0');
  const audit = ledger.audit();
  assert.equal(audit.ok, false);
  const types = audit.problems.map((p) => p.type);
  assert.ok(types.includes('balance_cache_mismatch'));
  assert.ok(types.includes('forbidden_negative'));
  cleanup();
});

test('statement returns newest first with a running balance', async () => {
  const { ledger, a, b, cleanup } = await twoPlayers();
  ledger.transfer({ from: a, to: b, cents: 300, memo: 'lunch' });
  const [latest, grant] = ledger.statement(a);
  assert.equal(latest.amount_cents, -300);
  assert.equal(latest.balance_cents, 49700);
  assert.equal(latest.memo, 'lunch');
  assert.equal(grant.balance_cents, 50000);
  cleanup();
});

test('balance_cents, entries and txns cannot be written except through the ledger (trigger guard)', async () => {
  const { ledger, app, a, b, cleanup } = await twoPlayers();
  assert.throws(() => app.db.prepare('UPDATE accounts SET balance_cents = balance_cents + 100 WHERE id = ?').run(a), /only change through lib\/ledger\.js/);
  assert.throws(() => app.db.exec("INSERT INTO accounts (owner_type, owner_id, kind, balance_cents, created) VALUES ('player', 999, 'chequing', 100, 0)"), /start at zero/);
  assert.throws(() => app.db.exec("INSERT INTO txns (kind, actor, created) VALUES ('x', 'y', 0)"), /through lib\/ledger\.js/);
  assert.throws(() => app.db.exec(`INSERT INTO entries (txn_id, account_id, amount_cents, created) VALUES (1, ${a}, 5, 0)`), /through lib\/ledger\.js/);
  assert.equal(ledger.balance(a), 50000);
  // the flag is lowered again after a good post and after a refused one, so it is never left open
  ledger.transfer({ from: a, to: b, cents: 10 });
  assert.equal(app.db.prepare('SELECT open FROM ledger_lock').get().open, 0);
  assert.throws(() => ledger.transfer({ from: a, to: b, cents: 10_000_000 }), /Insufficient/);
  assert.equal(app.db.prepare('SELECT open FROM ledger_lock').get().open, 0);
  assert.throws(() => app.db.prepare('UPDATE accounts SET balance_cents = 0 WHERE id = ?').run(a), /ledger\.js/);
  assert.equal(ledger.audit().ok, true);
  cleanup();
});

test('reverse posts the opposite entries (nothing deleted), once, and never twice or of a reversal', async () => {
  const { ledger, app, a, b, cleanup } = await twoPlayers();
  const txn = ledger.transfer({ from: a, to: b, cents: 2500 });
  const entriesBefore = app.db.prepare('SELECT COUNT(*) AS n FROM entries').get().n;
  const rev = ledger.reverse(txn, { actor: 'teacher' });
  assert.equal(ledger.balance(a), 50000);
  assert.equal(ledger.balance(b), 50000);
  assert.equal(app.db.prepare('SELECT COUNT(*) AS n FROM entries').get().n, entriesBefore + 2);
  assert.equal(app.db.prepare('SELECT COUNT(*) AS n FROM entries WHERE txn_id = ?').get(txn).n, 2);   // original untouched
  assert.throws(() => ledger.reverse(txn), /Already reversed/);
  assert.throws(() => ledger.reverse(rev), /cannot be reversed/);
  assert.throws(() => ledger.reverse(99999), /not found/);
  assert.equal(ledger.audit().ok, true);
  cleanup();
});

test('reverse fails cleanly if the recipient already spent the money', async () => {
  const { ledger, app, a, b, cleanup } = await twoPlayers();
  const txn = ledger.transfer({ from: a, to: b, cents: 40000 });
  ledger.transfer({ from: b, to: ledger.system('sink'), cents: 85000, kind: 'fee' });   // b now has 5000, owes 40000 back
  const before = app.db.prepare('SELECT COUNT(*) AS n FROM txns').get().n;
  assert.throws(() => ledger.reverse(txn), /Insufficient funds/);
  assert.equal(app.db.prepare('SELECT COUNT(*) AS n FROM txns').get().n, before);
  assert.equal(ledger.audit().ok, true);
  cleanup();
});

test('the welcome grant is paid once per student however often (or concurrently) they log in; spare cards hold nothing', async () => {
  const { app, cls, cleanup } = await bareApp();
  const [a, b] = await app.players.createStudents({ classId: cls.id, count: 2, hash: false });
  assert.equal(app.ledger.audit().moneySupply, 0);                       // cards exist, nobody has logged in
  assert.equal(app.ledger.balance(app.ledger.accountId('player', a.id, 'chequing')), 0);
  for (let i = 0; i < 5; i++) app.modules.onLogin(a, 'fintech10');
  assert.equal(app.ledger.balance(app.ledger.accountId('player', a.id, 'chequing')), 50000);
  assert.equal(app.ledger.balance(app.ledger.accountId('player', b.id, 'chequing')), 0);   // the spare card
  assert.equal(app.ledger.audit().moneySupply, 50000);
  cleanup();
});
