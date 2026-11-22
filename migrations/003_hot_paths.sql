-- Hot-path schema: reversals, kind lookups, running balances and session expiry become index reads.

-- One reversal per txn, enforced by the database. Backfilled from the old meta JSON.
ALTER TABLE txns ADD COLUMN reverses INTEGER REFERENCES txns(id);
UPDATE txns SET reverses = json_extract(meta, '$.reverses') WHERE kind = 'reversal';
CREATE UNIQUE INDEX txns_reverses ON txns(reverses) WHERE reverses IS NOT NULL;
CREATE INDEX txns_kind_created ON txns(kind, created);

-- Running balance after each entry. Entries are append-only so it never changes; from here on ledger.post() writes it on INSERT.
-- The one-off backfill UPDATE needs entries_no_update out of the way. It is dropped and re-created identically inside this
-- migration's transaction, so it is never absent once the migration commits (and a failure rolls the drop back too).
-- (txns has no UPDATE trigger, and the ledger_lock guards only cover INSERTs and accounts.balance_cents, so nothing else trips.)
ALTER TABLE entries ADD COLUMN balance_after_cents INTEGER;
DROP TRIGGER entries_no_update;
UPDATE entries SET balance_after_cents = w.b
  FROM (SELECT id, SUM(amount_cents) OVER (PARTITION BY account_id ORDER BY id) AS b FROM entries) AS w
  WHERE entries.id = w.id;
CREATE TRIGGER entries_no_update BEFORE UPDATE ON entries BEGIN SELECT RAISE(ABORT, 'entries are append-only'); END;

CREATE INDEX sessions_expires ON sessions(expires);
