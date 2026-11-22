// The running company of FinTech 10 section 5 (modules/learn/companies/kirans-bike-repair.js): the figures Mr. Tang approved, and that the
// books balance at every step. The lessons of that section read their numbers from this file.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { COMPANY, ACCOUNTS, OPENING, JUNE, JULY, COMPARE, GLOSSARY, balances, equation, ledgerAccount, money } from '../modules/learn/companies/kirans-bike-repair.js';

test('the opening balance sheet: assets $7,400 = liabilities $2,400 + capital $5,000', () => {
  const b = balances(), q = equation(b);
  assert.deepEqual([b.Cash, b.Supplies, b.Tools, b.Equipment], [300000, 40000, 180000, 220000]);
  assert.deepEqual([b['Accounts Payable'], b['Bank Loan'], b['Kiran, Capital']], [40000, 200000, 500000]);
  assert.deepEqual([q.assets, q.liabilities, q.equity, q.balanced], [740000, 240000, 500000, true]);
  assert.equal(COMPANY.name, "Kiran's Bike Repair");
});

test('after June: assets $7,070 = liabilities $2,250 + owner\'s equity $4,820; net income $70', () => {
  const b = balances(JUNE), q = equation(b);
  assert.deepEqual([b.Cash, b['Accounts Receivable'], b.Supplies, b.Tools, b.Equipment], [240000, 0, 55000, 192000, 220000]);
  assert.deepEqual([b['Accounts Payable'], b['Bank Loan']], [35000, 190000]);
  assert.deepEqual([q.revenue, q.expenses, q.netIncome, q.drawings], [75000, 68000, 7000, 25000]);
  assert.deepEqual([q.assets, q.liabilities, q.equity, q.balanced], [707000, 225000, 482000, true]);
  assert.equal(JUNE.length, 10);
});

test('the books balance after every transaction, June and July, and no account goes negative', () => {
  const all = [...JUNE, ...JULY];
  for (let n = 0; n <= all.length; n++) {
    const b = balances(all.slice(0, n)), q = equation(b);
    assert.ok(q.balanced, `after ${n}`);
    assert.ok(Object.values(b).every((v) => v >= 0), `after ${n}`);
  }
  const q = equation(balances(all));
  assert.deepEqual([q.assets, q.liabilities, q.equity], [725000, 234000, 491000]);
});

test('every entry: debits equal credits, whole dollars, one side per line; the opening entry is the opening balance sheet', () => {
  for (const e of [OPENING, ...JUNE, ...JULY]) {
    assert.equal(e.lines.reduce((s, l) => s + l.debit, 0), e.lines.reduce((s, l) => s + l.credit, 0), e.date);
    for (const l of e.lines) { assert.ok((l.debit === 0) !== (l.credit === 0)); assert.equal((l.debit + l.credit) % 100, 0); }
  }
  assert.equal(OPENING.lines.reduce((s, l) => s + l.debit, 0), 740000);
  for (const e of [...JUNE, ...JULY]) assert.equal(e.lines.length, 2, `${e.date} is a simple entry`);
});

test('the ledger: Cash after June has debits $3,750 and credits $1,350; accounts are numbered by kind', () => {
  const cash = ledgerAccount('Cash', JUNE);
  assert.deepEqual([cash.debits, cash.credits, cash.balance], [375000, 135000, 240000]);
  assert.equal(cash.rows.length, 9);
  const first = { asset: 1, liability: 2, equity: 3, revenue: 4, expense: 5 };
  for (const a of ACCOUNTS) assert.equal(String(a.no)[0], String(first[a.type]), a.name);
  assert.equal(new Set(ACCOUNTS.map((a) => a.no)).size, ACCOUNTS.length);
  assert.equal(money(740000), '$7,400');
});

test('the comparison businesses balance, and the glossary has one line for each word the section uses', () => {
  const r = COMPARE.retail, c = COMPARE.corporation.balance;
  assert.equal(r.income.sales - r.income.costOfGoodsSold - r.income.expenses, 60000);
  assert.equal(r.balance.cash + r.balance.inventory + r.balance.equipment, r.balance.accountsPayable + r.balance.capital);
  assert.equal(c.cash + c.inventory + c.equipment, c.accountsPayable + c.bankLoan + c.shareCapital + c.retainedEarnings);
  for (const w of ['asset', 'liability', "owner's equity", 'capital', 'accounting equation', 'balance sheet', 'revenue', 'expense', 'drawings', 'debit', 'credit', 'journal', 'ledger', 'posting', 'opening entry', 'chart of accounts', 'GAAP']) assert.ok(GLOSSARY[w]?.length > 20, w);
});
