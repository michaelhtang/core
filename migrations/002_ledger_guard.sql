-- Only lib/ledger.js may write money. SQLite has no session variables, so ledger.post() raises a flag row inside its own
-- BEGIN IMMEDIATE transaction and lowers it again before commit. Other connections never see it raised (it is uncommitted
-- until it is already back to 0), so these triggers refuse every other writer, including a hand-typed UPDATE in the sqlite3 shell.
CREATE TABLE ledger_lock (id INTEGER PRIMARY KEY CHECK (id = 1), open INTEGER NOT NULL DEFAULT 0);
INSERT INTO ledger_lock (id, open) VALUES (1, 0);

CREATE TRIGGER accounts_balance_guard BEFORE UPDATE OF balance_cents ON accounts
WHEN (SELECT open FROM ledger_lock) = 0
BEGIN SELECT RAISE(ABORT, 'balance_cents can only change through lib/ledger.js'); END;

CREATE TRIGGER accounts_start_at_zero BEFORE INSERT ON accounts
WHEN NEW.balance_cents <> 0
BEGIN SELECT RAISE(ABORT, 'accounts start at zero; money arrives only through lib/ledger.js'); END;

CREATE TRIGGER entries_guard BEFORE INSERT ON entries
WHEN (SELECT open FROM ledger_lock) = 0
BEGIN SELECT RAISE(ABORT, 'entries can only be written through lib/ledger.js'); END;

CREATE TRIGGER txns_guard BEFORE INSERT ON txns
WHEN (SELECT open FROM ledger_lock) = 0
BEGIN SELECT RAISE(ABORT, 'txns can only be written through lib/ledger.js'); END;
