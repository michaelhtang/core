// The Bank screen's transaction history (GET /api/bank-basic/history). READ-ONLY: it reads the ledger's entries for the student's own
// bank accounts (chequing, and the savings account when there is one) in the current season, and never posts or changes anything.
// Each row gets a world month, a plain-language category and a title, so the screen can group by month and filter like a bank app.
export const PAGE = 100;
export const ACCOUNTS = { chequing: 'Chequing', hisa: 'Savings (HISA)' };   // the accounts the Bank screen shows, in this order
const PAY_KINDS = ['jobs.pay', 'ventures.payroll', 'ventures.severance'];

export const CATEGORIES = {
  pay: 'Pay', bills: 'Bills and rent', shopping: 'Shopping', loans: 'Loans and credit',
  savings: 'Savings and investing', transfers: 'Transfers', rewards: 'Rewards', other: 'Other',
};
const BY_MODULE = { jobs: 'pay', bills: 'bills', housing: 'bills', outfitters: 'shopping', stress: 'loans', credit: 'loans', savings: 'savings', exchange: 'savings', retirement: 'savings', learn: 'rewards', today: 'rewards' };
const BY_KIND = {
  'ventures.payroll': 'pay', 'ventures.severance': 'pay', 'bank-basic.transfer': 'transfers', 'bank-basic.welcome': 'rewards',
  'housing.purchase': 'other', 'housing.sale': 'other', 'insurance.windfall': 'rewards',
};

// { category, title } for one entry. Titles are the ledger memos (already plain language), with pay and bills worded like a bank statement.
export function describe(kind, memo) {
  const category = BY_KIND[kind] ?? BY_MODULE[kind.split('.')[0]] ?? 'other';
  let title = memo || CATEGORIES[category];
  if (kind === 'jobs.pay') title = 'Direct deposit: pay from your job';
  else if (kind === 'ventures.payroll' || kind === 'ventures.severance') title = `Direct deposit: ${memo || 'pay'}`;
  else if (kind === 'bills.payment' && memo?.startsWith('Paid ')) title = `Bill payment: ${memo.slice(5)}`;
  else if (kind === 'core.reversal') title = memo === 'Reversed by teacher' ? 'Reversed by your teacher' : (memo || 'Reversal');
  return { category, title };
}

// The world month in force at a wall time, from the world.advance records since the season began (cached per world and month).
const advCache = new WeakMap();
function advancesOf(k, w) {
  const key = `${w.id}:${w.month}`;
  const hit = advCache.get(k);
  if (hit?.key === key) return hit.list;
  const list = k.db.prepare("SELECT at, CAST(json_extract(detail, '$.to') AS INTEGER) AS m FROM audit_log WHERE action = 'world.advance' AND at >= ? ORDER BY id").all(w.created);
  advCache.set(k, { key, list });
  return list;
}
function monthAt(list, t) {
  let lo = 0, hi = list.length - 1, m = 1;
  while (lo <= hi) { const mid = (lo + hi) >> 1; if (list[mid].at <= t) { m = list[mid].m; lo = mid + 1; } else hi = mid - 1; }
  return m;
}
// A month tick posts before its world.advance record is written, so a txn that names its month (meta.month) is trusted when that is
// later; a bill paid late by hand names its due month, so the later of the two (the month the money actually moved) wins.
function monthOf(list, row, current) {
  let meta = {};
  try { meta = JSON.parse(row.meta); } catch { /* not JSON: no month */ }
  const named = Number.isSafeInteger(meta?.month) ? meta.month : 0;
  return Math.min(current, Math.max(named, monthAt(list, row.created)));
}

const ROWS = `SELECT e.id, e.created, e.amount_cents, e.balance_after_cents, e.memo, t.kind, t.meta FROM entries e JOIN txns t ON t.id = e.txn_id`;

// accountKind: 'chequing' | 'hisa'. before: an entry id (page backwards). Returns null when the student has no such account.
export function history(k, playerId, accountKind, before) {
  const w = k.world.current();
  const id = k.ledger.accountId('player', playerId, accountKind);
  if (!id || !w) return null;
  const list = advancesOf(k, w);
  const rows = k.db.prepare(`${ROWS} WHERE e.account_id = ? AND e.created >= ? AND e.id < ? ORDER BY e.id DESC LIMIT ?`)
    .all(id, w.created, before ?? Number.MAX_SAFE_INTEGER, PAGE + 1);
  const more = rows.length > PAGE;
  if (more) rows.pop();
  const shape = (r) => ({ id: r.id, created: r.created, month: monthOf(list, r, w.month), ...describe(r.kind, r.memo), amount_cents: r.amount_cents, balance_cents: r.balance_after_cents });

  // Money in and out this month and last month. A month's tick posts just before its world.advance record, so everything from those two
  // months was posted after the advance record two before the latest (or the season start): reading from there is enough.
  const since = list.length >= 3 ? list.at(-3).at : w.created;
  const totals = { [w.month]: { in_cents: 0, out_cents: 0 }, [w.month - 1]: { in_cents: 0, out_cents: 0 } };
  for (const r of k.db.prepare(`${ROWS} WHERE e.account_id = ? AND e.created >= ?`).all(id, Math.max(since, w.created))) {
    const t = totals[monthOf(list, r, w.month)];
    if (t) t[r.amount_cents > 0 ? 'in_cents' : 'out_cents'] += Math.abs(r.amount_cents);
  }
  const pay = accountKind === 'chequing' ? k.db.prepare(`${ROWS} WHERE e.account_id = ? AND e.created >= ? AND e.amount_cents > 0
      AND t.kind IN (SELECT value FROM json_each(?)) ORDER BY e.id DESC LIMIT 1`).get(id, w.created, JSON.stringify(PAY_KINDS)) : null;

  return {
    month: w.month,
    account: { kind: accountKind, label: ACCOUNTS[accountKind], ending: String(id).padStart(4, '0').slice(-4), balance_cents: k.ledger.balance(id) },
    accounts: Object.keys(ACCOUNTS).filter((kind) => k.ledger.accountId('player', playerId, kind)).map((kind) => ({ kind, label: ACCOUNTS[kind], balance_cents: k.ledger.balance(k.ledger.accountId('player', playerId, kind)) })),
    this_month: totals[w.month],
    last_month: w.month > 1 ? totals[w.month - 1] : null,
    last_pay: pay ? { cents: pay.amount_cents, month: monthOf(list, pay, w.month) } : null,
    categories: CATEGORIES,
    entries: rows.map(shape),
    ...(more && { next: rows.at(-1).id }),
  };
}
