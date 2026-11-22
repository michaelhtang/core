import { test } from 'node:test';
import assert from 'node:assert/strict';
import { boot, seeded } from './helpers.js';
import { describe } from '../modules/bank-basic/history.js';

const hist = (s, q = '') => s.client.get(`/api/bank-basic/history${q}`);
const txnCount = (srv) => srv.app.db.prepare('SELECT COUNT(*) AS n FROM txns').get().n;

test('describe: pay reads as a direct deposit, bills as bill payments, everything gets a category', () => {
  assert.deepEqual(describe('jobs.pay', 'Pay, month 3'), { category: 'pay', title: 'Direct deposit: pay from your job' });
  assert.deepEqual(describe('ventures.payroll', 'Pay from Snow Co'), { category: 'pay', title: 'Direct deposit: Pay from Snow Co' });
  assert.deepEqual(describe('bills.payment', 'Paid Groceries'), { category: 'bills', title: 'Bill payment: Groceries' });
  assert.equal(describe('housing.rent', 'Rent: Unit 4').category, 'bills');
  assert.equal(describe('bank-basic.transfer', 'Sent to OwlA').category, 'transfers');
  assert.equal(describe('savings.interest', 'HISA interest 2%').category, 'savings');
  assert.equal(describe('stress.loan_payment', 'Emergency loan payment').category, 'loans');
  assert.equal(describe('learn.reward', 'Learning Road: Budgets').category, 'rewards');
  assert.deepEqual(describe('core.reversal', 'Reversed by teacher'), { category: 'other', title: 'Reversed by your teacher' });
  assert.deepEqual(describe('mystery.thing', null), { category: 'other', title: 'Other' });
});

test('history: payday direct deposits, bill payments and transfers by world month, with running balances; read-only and own rows only', async () => {
  const srv = await boot();
  try {
    const { students } = await seeded(srv, 2);
    const [a, b] = students;
    assert.equal((await a.client.post('/api/jobs/pick', { job_id: 1 })).status, 200);
    srv.app.world.advance({ months: 1 });                                   // month 2
    srv.app.world.advance({ months: 1 });                                   // month 3: the first pay
    const due = srv.app.db.prepare('SELECT id FROM bills_due WHERE player_id = ? AND paid_txn IS NULL ORDER BY id LIMIT 1').get(a.id);
    assert.ok(due, 'a bill is due');
    assert.equal((await a.client.post('/api/bills/pay', { id: due.id })).status, 200);
    assert.equal((await a.client.post('/api/bank-basic/transfer', { to: b.username, cents: 1234 })).status, 200);

    const before = txnCount(srv);
    const r = await hist(a);
    assert.equal(r.status, 200);
    const h = r.json;
    assert.equal(txnCount(srv), before, 'reading the history posts nothing');
    assert.equal(h.month, 3);
    assert.equal(h.account.kind, 'chequing');
    assert.equal(h.account.balance_cents, srv.app.ledger.balance(a.chequing.id));
    assert.equal(h.entries[0].balance_cents, h.account.balance_cents, 'the newest row ends at the balance');
    for (let i = 0; i + 1 < h.entries.length; i++) assert.equal(h.entries[i].balance_cents - h.entries[i].amount_cents, h.entries[i + 1].balance_cents, 'running balance');
    for (let i = 0; i + 1 < h.entries.length; i++) assert.ok(h.entries[i].month >= h.entries[i + 1].month, 'newest month first');

    const welcome = h.entries.at(-1);
    assert.equal(welcome.title, 'Welcome grant');
    assert.equal(welcome.month, 1);
    const pays = h.entries.filter((e) => e.category === 'pay');
    assert.ok(pays.length >= 1, 'a payday direct deposit');
    assert.ok(pays.every((p) => p.title === 'Direct deposit: pay from your job' && p.amount_cents > 0));
    assert.equal(pays[0].month, 3, 'the month 3 pay is listed under month 3');
    assert.deepEqual(h.last_pay, { cents: pays[0].amount_cents, month: 3 });
    const sent = h.entries.find((e) => e.category === 'transfers');
    assert.equal(sent.amount_cents, -1234);
    assert.equal(sent.month, 3);
    assert.ok(h.entries.some((e) => e.category === 'bills' && e.title.startsWith('Bill payment: ')), 'a bill payment');

    // this month's money in and out add up from this month's rows
    const sum = (m, sign) => h.entries.filter((e) => e.month === m && Math.sign(e.amount_cents) === sign).reduce((s, e) => s + Math.abs(e.amount_cents), 0);
    assert.deepEqual(h.this_month, { in_cents: sum(3, 1), out_cents: sum(3, -1) });
    assert.deepEqual(h.last_month, { in_cents: sum(2, 1), out_cents: sum(2, -1) });

    // own rows only: b sees the transfer as money in, and none of a's pay
    const hb = (await hist(b)).json;
    assert.ok(hb.entries.some((e) => e.category === 'transfers' && e.amount_cents === 1234));
    assert.ok(!hb.entries.some((e) => e.category === 'pay'));

    // the savings account, bad input, teachers
    const accts = h.accounts.map((x) => x.kind);
    assert.ok(accts.includes('chequing'));
    if (accts.includes('hisa')) assert.equal((await hist(a, '?account=hisa')).json.account.kind, 'hisa');
    assert.equal((await hist(a, '?account=loan')).status, 400);
    assert.equal((await hist(a, '?before=abc')).status, 400);
    assert.ok(srv.app.ledger.audit().ok);
  } finally { await srv.cleanup(); }
});

test('history pages backwards with ?before=', async () => {
  const srv = await boot();
  try {
    const { students } = await seeded(srv, 2);
    const [a, b] = students;
    for (let i = 0; i < 105; i++) srv.app.ledger.transfer({ from: a.chequing.id, to: b.chequing.id, cents: 100, kind: 'bank-basic.transfer', memo: `Sent to ${b.username}` });
    const p1 = (await hist(a)).json;
    assert.equal(p1.entries.length, 100);
    assert.ok(p1.next);
    const p2 = (await hist(a, `?before=${p1.next}`)).json;
    assert.equal(p2.entries.length, 6);                                     // 5 transfers and the welcome grant
    assert.equal(p2.next, undefined);
    assert.equal(p2.entries[0].balance_cents, p1.entries.at(-1).balance_cents - p1.entries.at(-1).amount_cents);
  } finally { await srv.cleanup(); }
});
