-- Core schema. Money is INTEGER cents only. Entries are append-only.

CREATE TABLE worlds (                      -- one per season
  id             INTEGER PRIMARY KEY,
  name           TEXT NOT NULL,
  season_start   TEXT NOT NULL,            -- YYYY-MM-DD
  season_end     TEXT NOT NULL,
  month          INTEGER NOT NULL DEFAULT 1,   -- world month, advanced by the teacher
  months_per_day INTEGER NOT NULL DEFAULT 1 CHECK (months_per_day BETWEEN 1 AND 12),
  created        INTEGER NOT NULL
);

CREATE TABLE classes (
  id        INTEGER PRIMARY KEY,
  world_id  INTEGER NOT NULL REFERENCES worlds(id),
  name      TEXT NOT NULL,                 -- block name, e.g. "Block 3"
  course_id TEXT NOT NULL,                 -- fintech10 | fintech2030 (validated against config/vdaa.json)
  created   INTEGER NOT NULL
);

CREATE TABLE players (                     -- pseudonymous: no names, emails or birthdates
  id       INTEGER PRIMARY KEY,
  username TEXT NOT NULL UNIQUE COLLATE NOCASE,
  pin_hash TEXT NOT NULL,                  -- scrypt; students use a 6-digit PIN, the teacher a passphrase
  class_id INTEGER REFERENCES classes(id),
  role     TEXT NOT NULL CHECK (role IN ('student', 'teacher')),
  avatar   TEXT NOT NULL DEFAULT '{}',     -- json
  created  INTEGER NOT NULL
);
CREATE INDEX players_class ON players(class_id);

CREATE TABLE sessions (
  token_hash TEXT PRIMARY KEY,             -- sha256 of the cookie value
  player_id  INTEGER NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  expires    INTEGER NOT NULL
);

CREATE TABLE accounts (
  id             INTEGER PRIMARY KEY,
  owner_type     TEXT NOT NULL CHECK (owner_type IN ('player', 'business', 'system')),
  owner_id       INTEGER NOT NULL,
  kind           TEXT NOT NULL,            -- chequing, savings, loan, revenue, system:mint, system:sink
  currency       TEXT NOT NULL DEFAULT 'CAD',
  allow_negative INTEGER NOT NULL DEFAULT 0,
  balance_cents  INTEGER NOT NULL DEFAULT 0,   -- cache kept by lib/ledger.js; audit() re-derives it from entries
  created        INTEGER NOT NULL,
  UNIQUE (owner_type, owner_id, kind)
);

CREATE TABLE txns (
  id      INTEGER PRIMARY KEY,
  kind    TEXT NOT NULL,                   -- grant, transfer, payday, ...
  actor   TEXT NOT NULL,                   -- 'system' or 'player:<id>'
  created INTEGER NOT NULL,
  meta    TEXT NOT NULL DEFAULT '{}'       -- json
);

CREATE TABLE entries (                     -- double entry: the legs of one txn sum to 0
  id           INTEGER PRIMARY KEY,
  txn_id       INTEGER NOT NULL REFERENCES txns(id),
  account_id   INTEGER NOT NULL REFERENCES accounts(id),
  amount_cents INTEGER NOT NULL CHECK (amount_cents <> 0),
  memo         TEXT,
  created      INTEGER NOT NULL
);
CREATE INDEX entries_account ON entries(account_id, id);
CREATE INDEX entries_txn ON entries(txn_id);
CREATE TRIGGER entries_no_update BEFORE UPDATE ON entries BEGIN SELECT RAISE(ABORT, 'entries are append-only'); END;
CREATE TRIGGER entries_no_delete BEFORE DELETE ON entries BEGIN SELECT RAISE(ABORT, 'entries are append-only'); END;

CREATE TABLE audit_log (                   -- who did what (teacher actions, setup, PIN resets, world ticks)
  id     INTEGER PRIMARY KEY,
  at     INTEGER NOT NULL,
  actor  TEXT NOT NULL,
  action TEXT NOT NULL,
  detail TEXT NOT NULL DEFAULT '{}'
);

-- The two system accounts. They may go negative: mint is where money is created, sink is where it is collected.
INSERT INTO accounts (owner_type, owner_id, kind, allow_negative, created)
VALUES ('system', 0, 'system:mint', 1, 0), ('system', 0, 'system:sink', 1, 0);
