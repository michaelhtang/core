// The running company for FinTech 10 section 5, Accounting Prep (Mr. Tang approved it 2026-11-11). Every lesson, figure and test in that
// section READS its numbers from here; nobody retypes them. Amounts are integer cents. The file checks itself when it is imported: the opening
// balance sheet balances, every entry's debits equal its credits, and the books still balance after every transaction.
//
// Scope (FIN1015 outcomes 1.1 to 2.7, plan days Nov 23 to Dec 4): why keep books, the accounting equation, the opening balance sheet, GAAP as
// an idea (no named principles), revenue and expense accounts, a chart of accounts, double entry, the opening entry, opening ledger accounts,
// posting, comparing a service business, a retail business and a corporation. NOT in scope, and not to be taught: a trial balance, adjusting
// or closing entries, depreciation, GST, payroll, interest on the loan (the loan payment here is principal only, and a card says so).

export const COMPANY = {
  name: "Kiran's Bike Repair",
  owner: 'Kiran',                                   // first name only, a made-up person
  kind: 'a service business with one owner (a sole proprietorship)',
  what: 'Kiran repairs and tunes bikes in a small rented shop in town.',
  opens: 'June 1',                                  // dates are "June 1", "Jun 2" ...: no year
};

// The words every level uses, one word per idea. "Capital" is the outcome's word (FIN1015 1.4: assets, liabilities, capital).
export const GLOSSARY = {
  'financial statements': 'Reports that sum up a business in numbers. The two in this section are the balance sheet and the income statement.',
  'asset': 'Something of value that the business owns.',
  'liability': 'A debt: something the business owes to someone else.',
  "owner's equity": "The owner's share of the business: what is left of the assets after the liabilities. Also called capital.",
  'capital': "The owner's equity. The account Kiran, Capital holds what Kiran has put into the business and left in it.",
  'accounting equation': "Assets = Liabilities + Owner's Equity. It is true after every transaction.",
  'balance sheet': "A statement of what a business owns and owes on one date, and the owner's equity.",
  'income statement': 'A statement of revenue and expenses over a period, ending in net income or a net loss.',
  'transaction': 'An event that changes the business in dollars, such as a sale, a purchase or a payment.',
  'account': 'One page of the books that tracks one thing, such as Cash or Bank Loan.',
  'chart of accounts': 'The numbered list of every account a business uses.',
  'revenue': "Money the business earns from its work. It raises the owner's equity.",
  'expense': "A cost of running the business. It lowers the owner's equity.",
  'drawings': "Money the owner takes out for personal use. It lowers the owner's equity, and it is not an expense.",
  'net income': 'Revenue minus expenses, when revenue is larger. When expenses are larger, it is a net loss.',
  'accounts receivable': 'Money customers owe the business for work already done.',
  'accounts payable': 'Money the business owes its suppliers for things already received.',
  'on account': 'Bought or sold now, to be paid for later.',
  'debit': 'An entry on the left side of an account.',
  'credit': 'An entry on the right side of an account.',
  'double entry': 'Every transaction is recorded twice: debits in one or more accounts, and credits of the same total in others.',
  'journal': 'The book where each transaction is first written, in date order, as debits and credits.',
  'ledger': 'The book of all the accounts. Each account shows its debits, its credits and its balance.',
  'posting': 'Copying each debit and credit from the journal into its account in the ledger.',
  'opening entry': 'The first journal entry of a business. It records everything on the opening balance sheet.',
  'GAAP': 'Generally accepted accounting principles: the shared rules for keeping books, so that statements can be trusted and compared.',
};

// Chart of accounts. type: asset | liability | equity | revenue | expense. normal: the side that makes the account grow.
const acct = (no, name, type, normal) => ({ no, name, type, normal });
export const ACCOUNTS = [
  acct(101, 'Cash', 'asset', 'debit'),
  acct(110, 'Accounts Receivable', 'asset', 'debit'),
  acct(120, 'Supplies', 'asset', 'debit'),
  acct(130, 'Tools', 'asset', 'debit'),
  acct(140, 'Equipment', 'asset', 'debit'),
  acct(201, 'Accounts Payable', 'liability', 'credit'),
  acct(210, 'Bank Loan', 'liability', 'credit'),
  acct(301, 'Kiran, Capital', 'equity', 'credit'),
  acct(302, 'Kiran, Drawings', 'equity', 'debit'),
  acct(401, 'Repair Revenue', 'revenue', 'credit'),
  acct(501, 'Rent Expense', 'expense', 'debit'),
  acct(502, 'Advertising Expense', 'expense', 'debit'),
  acct(503, 'Utilities Expense', 'expense', 'debit'),
];
export const account = (name) => { const a = ACCOUNTS.find((x) => x.name === name); if (!a) throw new Error(`no account "${name}"`); return a; };

// An entry: one or more debits and one or more credits. lines: [account name, debit cents, credit cents].
const entry = (date, what, lines) => ({ date, what, lines: lines.map(([name, dr, cr]) => ({ account: account(name).name, debit: dr, credit: cr })) });
const simple = (date, what, debit, credit, cents) => entry(date, what, [[debit, cents, 0], [credit, 0, cents]]);

// The opening balance sheet, as at June 1, written as the opening entry.
export const OPENING = entry('Jun 1', 'Opening entry: Kiran starts the business', [
  ['Cash', 300000, 0], ['Supplies', 40000, 0], ['Tools', 180000, 0], ['Equipment', 220000, 0],
  ['Accounts Payable', 0, 40000], ['Bank Loan', 0, 200000], ['Kiran, Capital', 0, 500000],
]);

// June. Every transaction has one plain entry; nothing here needs a judgement call.
export const JUNE = [
  simple('Jun 2', 'Paid the month’s rent in cash', 'Rent Expense', 'Cash', 60000),
  simple('Jun 3', 'Bought supplies on account', 'Supplies', 'Accounts Payable', 15000),
  simple('Jun 5', 'Repaired bikes for cash', 'Cash', 'Repair Revenue', 45000),
  simple('Jun 8', 'Repaired a bike club’s bikes on account', 'Accounts Receivable', 'Repair Revenue', 30000),
  simple('Jun 10', 'Paid the supplier part of what is owed', 'Accounts Payable', 'Cash', 20000),
  simple('Jun 12', 'Paid for advertising in cash', 'Advertising Expense', 'Cash', 8000),
  simple('Jun 15', 'The bike club paid what it owed', 'Cash', 'Accounts Receivable', 30000),
  simple('Jun 20', 'Kiran took cash out for personal use', 'Kiran, Drawings', 'Cash', 25000),
  simple('Jun 25', 'Paid part of the bank loan (principal only)', 'Bank Loan', 'Cash', 10000),
  simple('Jun 28', 'Bought a tool for cash', 'Tools', 'Cash', 12000),
];

// July: a second, shorter set for the check-in level, starting from the balances at the end of June.
export const JULY = [
  simple('Jul 2', 'Paid the month’s rent in cash', 'Rent Expense', 'Cash', 60000),
  simple('Jul 4', 'Repaired bikes for cash', 'Cash', 'Repair Revenue', 52000),
  simple('Jul 7', 'Bought supplies on account', 'Supplies', 'Accounts Payable', 9000),
  simple('Jul 10', 'Paid the power bill in cash', 'Utilities Expense', 'Cash', 7000),
  simple('Jul 15', 'Repaired a school’s bikes on account', 'Accounts Receivable', 'Repair Revenue', 24000),
];

// ---- the books ----
// balances after the opening entry and the first n of the given entries: { 'Cash': cents, ... }, every account present, each on its normal side
export function balances(entries = []) {
  const b = Object.fromEntries(ACCOUNTS.map((a) => [a.name, 0]));
  for (const e of [OPENING, ...entries]) for (const l of e.lines) {
    const a = account(l.account);
    b[a.name] += a.normal === 'debit' ? l.debit - l.credit : l.credit - l.debit;
  }
  return b;
}
const sum = (b, type) => ACCOUNTS.filter((a) => a.type === type).reduce((s, a) => s + b[a.name], 0);
// the accounting equation from a set of balances; equity = capital - drawings + revenue - expenses
export function equation(b) {
  const assets = sum(b, 'asset'), liabilities = sum(b, 'liability');
  const revenue = sum(b, 'revenue'), expenses = sum(b, 'expense'), drawings = b['Kiran, Drawings'], capital = b['Kiran, Capital'];
  const equity = capital - drawings + revenue - expenses;
  return { assets, liabilities, equity, capital, drawings, revenue, expenses, netIncome: revenue - expenses, balanced: assets === liabilities + equity };
}
// one account's page in the ledger: every debit and credit that touched it, in order, and its balance
export function ledgerAccount(name, entries = []) {
  const a = account(name), rows = [];
  for (const e of [OPENING, ...entries]) for (const l of e.lines) if (l.account === a.name) rows.push({ date: e.date, debit: l.debit, credit: l.credit });
  const debits = rows.reduce((s, r) => s + r.debit, 0), credits = rows.reduce((s, r) => s + r.credit, 0);
  return { account: a, rows, debits, credits, balance: a.normal === 'debit' ? debits - credits : credits - debits };
}
export const money = (cents) => `$${(cents / 100).toLocaleString('en-CA', { maximumFractionDigits: 0 })}`;   // whole dollars: every amount here is

// ---- two more made-up businesses, for "comparing statements" (FIN1015 1.3). Small, whole-dollar, one month. ----
export const COMPARE = {
  service: { name: COMPANY.name, kind: 'service, one owner', sells: 'work (repairs)', equityLines: ['Kiran, Capital'] },
  retail: {
    name: 'Pedal Parts', kind: 'retail, one owner', sells: 'goods it buys and resells (bike parts)',
    income: { sales: 400000, costOfGoodsSold: 240000, expenses: 100000 },                 // gross profit 1,600; net income 600
    balance: { cash: 250000, inventory: 300000, equipment: 150000, accountsPayable: 200000, capital: 500000 },
    equityLines: ['Dana, Capital'],
  },
  corporation: {
    name: 'Wheelworks Inc.', kind: 'a corporation, owned by shareholders', sells: 'goods it makes (bike wheels)',
    balance: { cash: 600000, inventory: 500000, equipment: 900000, accountsPayable: 300000, bankLoan: 450000, shareCapital: 1000000, retainedEarnings: 250000 },
    equityLines: ['Share Capital', 'Retained Earnings'],
  },
};

// ---- self-check, on import ----
(function check() {
  const fail = (m) => { throw new Error(`kirans-bike-repair.js: ${m}`); };
  for (const e of [OPENING, ...JUNE, ...JULY]) {
    const dr = e.lines.reduce((s, l) => s + l.debit, 0), cr = e.lines.reduce((s, l) => s + l.credit, 0);
    if (dr !== cr || dr <= 0) fail(`${e.date}: debits ${dr} and credits ${cr} must be equal and above zero`);
    if (!e.lines.every((l) => Number.isSafeInteger(l.debit) && Number.isSafeInteger(l.credit) && l.debit % 100 === 0 && l.credit % 100 === 0 && (l.debit === 0) !== (l.credit === 0))) fail(`${e.date}: every line is whole dollars on exactly one side`);
  }
  const all = [...JUNE, ...JULY];
  for (let n = 0; n <= all.length; n++) {
    const b = balances(all.slice(0, n)), q = equation(b);
    if (!q.balanced) fail(`the books do not balance after ${n} transaction(s)`);
    if (Object.entries(b).some(([, v]) => v < 0)) fail(`an account is on the wrong side after ${n} transaction(s): ${JSON.stringify(b)}`);
  }
  const r = COMPARE.retail, c = COMPARE.corporation.balance;
  if (r.balance.cash + r.balance.inventory + r.balance.equipment !== r.balance.accountsPayable + r.balance.capital) fail('Pedal Parts does not balance');
  if (c.cash + c.inventory + c.equipment !== c.accountsPayable + c.bankLoan + c.shareCapital + c.retainedEarnings) fail('Wheelworks Inc. does not balance');
})();
