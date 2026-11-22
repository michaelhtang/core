// THE ONLY WAY MONEY MOVES. Nothing else in the codebase may INSERT or UPDATE entries or balance_cents.
// Every post is one BEGIN IMMEDIATE transaction: legs sum to 0, balances are updated, and accounts that
// may not go negative are checked before commit. Any failure rolls the whole thing back.
import { withTxn } from './db.js';
import { HttpError } from './errors.js';

// code: INSUFFICIENT_FUNDS | UNKNOWN_ACCOUNT | ALREADY_REVERSED | NOT_FOUND | MIXED_CURRENCY | BAD_LEGS, plus BAD_KIND (missing or
// malformed kind) and NOT_REVERSIBLE (a reversal, or another module's txn). Callers match on code; messages are for people.
export class LedgerError extends HttpError {
  constructor(message, code) { super(400, message); this.name = 'LedgerError'; this.code = code; }
}

const validCents = (n) => Number.isSafeInteger(n) && n !== 0;

export function createLedger(db, events, clock) {
  const prepared = new Map();                                       // prepared once: the SQL below is a fixed set of texts, so this stays small
  const prep = (sql) => prepared.get(sql) ?? prepared.set(sql, db.prepare(sql)).get(sql);
  const one = (sql, ...a) => prep(sql).get(...a);
  const all = (sql, ...a) => prep(sql).all(...a);

  const insTxn = db.prepare('INSERT INTO txns (kind, actor, created, meta, reverses) VALUES (?, ?, ?, ?, ?)');
  const insEntry = db.prepare('INSERT INTO entries (txn_id, account_id, amount_cents, memo, created, balance_after_cents) VALUES (?, ?, ?, ?, ?, ?)');
  const bump = db.prepare('UPDATE accounts SET balance_cents = balance_cents + ? WHERE id = ? RETURNING balance_cents');
  const lock = db.prepare('UPDATE ledger_lock SET open = ?'); // raised only inside post(); see migrations/002_ledger_guard.sql
  const getAccount = db.prepare('SELECT * FROM accounts WHERE id = ?');
  const system = Object.fromEntries(all("SELECT id, kind FROM accounts WHERE owner_type = 'system'").map((a) => [a.kind.split(':')[1], a.id]));

  // Opening an account moves no money. Returns the existing id if the owner already has one of this kind.
  function openAccount({ ownerType, ownerId, kind, allowNegative = kind === 'loan' }) {
    db.prepare('INSERT OR IGNORE INTO accounts (owner_type, owner_id, kind, allow_negative, created) VALUES (?, ?, ?, ?, ?)')
      .run(ownerType, ownerId, kind, allowNegative ? 1 : 0, clock.now());
    return one('SELECT id FROM accounts WHERE owner_type = ? AND owner_id = ? AND kind = ?', ownerType, ownerId, kind).id;
  }

  // legs: [{ account, cents (signed), memo? }]. Must sum to 0. Returns the txn id.
  // `reverses` is set only by reverse(); the unique index txns_reverses makes a second reversal of one txn impossible.
  const post = (args) => write(args, null);
  function write({ kind, actor = 'system', meta = {}, legs }, reverses) {
    if (!kind) throw new LedgerError('A transaction needs a kind', 'BAD_KIND');
    if (!Array.isArray(legs) || legs.length < 2) throw new LedgerError('A transaction needs at least two legs', 'BAD_LEGS');
    let sum = 0;
    for (const l of legs) {
      if (!Number.isSafeInteger(l.account) || !validCents(l.cents)) throw new LedgerError('Amounts must be non-zero whole cents', 'BAD_LEGS');
      sum += l.cents;
    }
    if (sum !== 0) throw new LedgerError('Transaction legs must sum to zero', 'BAD_LEGS');
    return withTxn(db, (tx) => {
      lock.run(1);
      const now = clock.now();
      const txnId = Number(insTxn.run(kind, actor, now, JSON.stringify(meta), reverses).lastInsertRowid);
      for (const l of legs) {
        const row = bump.get(l.cents, l.account);
        if (!row) throw new LedgerError('Unknown account', 'UNKNOWN_ACCOUNT');
        insEntry.run(txnId, l.account, l.cents, l.memo ?? null, now, row.balance_cents);   // the only writer of balance_after_cents
      }
      const touched = [...new Set(legs.map((l) => l.account))].map((id) => getAccount.get(id));
      if (new Set(touched.map((a) => a.currency)).size > 1) throw new LedgerError('Currencies cannot be mixed', 'MIXED_CURRENCY');
      if (touched.some((a) => a.balance_cents < 0 && !a.allow_negative)) throw new LedgerError('Insufficient funds', 'INSUFFICIENT_FUNDS');
      const owners = [...new Map(touched.filter((a) => a.owner_type !== 'system').map((a) => [`${a.owner_type}:${a.owner_id}`, { type: a.owner_type, id: a.owner_id }])).values()];
      const posted = { txnId, kind, actor, legs: legs.map((l) => ({ account: l.account, cents: l.cents })), owners };
      tx.onCommit(() => events.emit('ledger.posted', posted));
      lock.run(0);
      return txnId;
    });
  }

  function transfer({ from, to, cents, kind = 'transfer', memo, actor }) {
    if (!Number.isSafeInteger(cents) || cents <= 0) throw new LedgerError('Amount must be a positive whole number of cents', 'BAD_LEGS');
    if (from === to) throw new LedgerError('Cannot transfer to the same account', 'BAD_LEGS');
    return post({ kind, actor, legs: [{ account: from, cents: -cents, memo }, { account: to, cents, memo }] });
  }

  // A compensating transaction: every entry of the original, negated. Nothing is ever deleted or edited.
  // Fails (rolled back) if a leg's account can no longer afford it, e.g. the recipient already spent the money.
  function reverse(txnId, { actor = 'system', memo = 'Reversal' } = {}) {
    return withTxn(db, () => {
      const t = one('SELECT kind FROM txns WHERE id = ?', txnId);
      if (!t) throw new LedgerError('Transaction not found', 'NOT_FOUND');
      if (t.kind === 'core.reversal') throw new LedgerError('A reversal cannot be reversed', 'NOT_REVERSIBLE');
      const legs = all('SELECT account_id, amount_cents FROM entries WHERE txn_id = ?', txnId).map((e) => ({ account: e.account_id, cents: -e.amount_cents, memo }));
      try {
        return write({ kind: 'core.reversal', actor, meta: { reverses: txnId }, legs }, txnId);
      } catch (e) {
        if (/UNIQUE constraint failed: txns\.reverses/.test(e.message)) throw new LedgerError('Already reversed', 'ALREADY_REVERSED');
        throw e;
      }
    });
  }

  const account = (id) => getAccount.get(id);
  const balance = (id) => getAccount.get(id)?.balance_cents ?? 0;

  // Newest first, with the running balance after each entry. range: { since, until (ms), limit }.
  function statement(accountId, { since = 0, until = Number.MAX_SAFE_INTEGER, limit = 100 } = {}) {
    return all(`SELECT e.id, e.txn_id, e.created, t.kind, e.memo, e.amount_cents,
                  e.balance_after_cents AS balance_cents
                FROM entries e JOIN txns t ON t.id = e.txn_id
                WHERE e.account_id = ? AND e.created BETWEEN ? AND ?
                ORDER BY e.id DESC LIMIT ?`, accountId, since, until, Math.min(Math.max(1, limit | 0), 500));
  }

  // Cents moved on an account by txns of one kind since a time. dir: 'out' (money sent, positive), 'in' (received), or omit for the net.
  // excludeReversed drops txns the teacher has reversed.
  function sumByKind({ account, kind, since = 0, dir, excludeReversed = false }) {
    const col = dir === 'out' ? '-e.amount_cents' : 'e.amount_cents';
    return one(`SELECT COALESCE(SUM(${col}), 0) AS n FROM entries e CROSS JOIN txns t ON t.id = e.txn_id   -- CROSS JOIN pins the order: this account's entries first, not every txn of the kind
      WHERE e.account_id = ? AND t.kind = ? AND t.created >= ?
        ${dir === 'out' ? 'AND e.amount_cents < 0' : dir === 'in' ? 'AND e.amount_cents > 0' : ''}
        ${excludeReversed ? 'AND NOT EXISTS (SELECT 1 FROM txns r WHERE r.reverses = t.id)' : ''}`, account, kind, since).n;
  }

  const kindOf = (txnId) => one('SELECT kind FROM txns WHERE id = ?', txnId)?.kind;
  const isReversed = (txnId) => !!one('SELECT 1 FROM txns WHERE reverses = ?', txnId);

  // Newest first: { id, created, actor, meta (parsed), cents (the largest leg), reversed (0|1) }.
  // Newest first (ids only grow). ids: only these txns (still filtered by kind, so a module only ever sees its own).
  function txnsByKind({ kind, since = 0, limit = 100, ids }) {
    const only = Array.isArray(ids) ? 'AND t.id IN (SELECT value FROM json_each(?))' : '';
    return all(`SELECT t.id, t.created, t.actor, t.meta, (SELECT MAX(amount_cents) FROM entries WHERE txn_id = t.id) AS cents,
                  EXISTS (SELECT 1 FROM txns r WHERE r.reverses = t.id) AS reversed
                FROM txns t WHERE t.kind = ? AND t.created >= ? ${only} ORDER BY t.id DESC LIMIT ?`,
      kind, since, ...(only ? [JSON.stringify(ids.filter(Number.isSafeInteger))] : []), Math.min(Math.max(1, limit | 0), 1000)).map((r) => ({ ...r, meta: JSON.parse(r.meta) }));
  }

  // Re-derives everything from entries and reports what is wrong, if anything.
  function audit() {
    const problems = [];
    const total = one('SELECT COALESCE(SUM(amount_cents), 0) AS s FROM entries').s;
    if (total !== 0) problems.push({ type: 'entries_do_not_sum_to_zero', total });
    for (const r of all('SELECT txn_id, SUM(amount_cents) AS s FROM entries GROUP BY txn_id HAVING s <> 0 LIMIT 20')) {
      problems.push({ type: 'txn_unbalanced', txn: r.txn_id, sum: r.s });
    }
    for (const r of all(`SELECT a.id, a.balance_cents, COALESCE(SUM(e.amount_cents), 0) AS s FROM accounts a
                         LEFT JOIN entries e ON e.account_id = a.id GROUP BY a.id HAVING a.balance_cents <> s LIMIT 20`)) {
      problems.push({ type: 'balance_cache_mismatch', account: r.id, cached: r.balance_cents, actual: r.s });
    }
    for (const r of all('SELECT id, kind, balance_cents FROM accounts WHERE balance_cents < 0 AND allow_negative = 0 LIMIT 20')) {
      problems.push({ type: 'forbidden_negative', account: r.id, kind: r.kind, balance_cents: r.balance_cents });
    }
    const moneySupply = 0 - balance(system.mint);                // not -x: that would give -0 before anything is minted
    return {
      ok: problems.length === 0,
      problems,
      moneySupply,                              // minus the mint balance
      sink: balance(system.sink),               // money collected by sinks (taxes, fees, rent)
      circulating: moneySupply - balance(system.sink),
      accounts: one('SELECT COUNT(*) AS n FROM accounts').n,
      entries: one('SELECT COUNT(*) AS n FROM entries').n,
      txns: one('SELECT COUNT(*) AS n FROM txns').n,
    };
  }

  return {
    system: (name) => system[name],            // 'mint' | 'sink'
    openAccount, post, transfer, reverse, account, balance, statement, audit, sumByKind, isReversed, txnsByKind, kindOf,
    accountId: (ownerType, ownerId, kind) => one('SELECT id FROM accounts WHERE owner_type = ? AND owner_id = ? AND kind = ?', ownerType, ownerId, kind)?.id,
    accountsOf: (ownerType, ownerId) => all('SELECT id, kind, currency, balance_cents FROM accounts WHERE owner_type = ? AND owner_id = ? ORDER BY id', ownerType, ownerId),
  };
}
