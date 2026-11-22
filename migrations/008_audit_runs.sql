-- Stored ledger audits (docs: MIGRATION.md step 8). ledger.audit() re-derives everything, so it runs on demand and nightly, not per page load.
CREATE TABLE audit_runs (
  id          INTEGER PRIMARY KEY,
  at          INTEGER NOT NULL,            -- wall ms (the clock)
  ok          INTEGER NOT NULL CHECK (ok IN (0, 1)),
  result_json TEXT NOT NULL                -- the full ledger.audit() result
);
