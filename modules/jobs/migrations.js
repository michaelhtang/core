// jobs: the table migrations (001_jobs to 007_year_index).
import { seedSql, stepsSql } from './catalogue.js';

export const migrations = [{ id: '001_jobs', sql: `
CREATE TABLE jobs_catalogue (
  id              INTEGER PRIMARY KEY,
  title           TEXT NOT NULL,
  employer        TEXT NOT NULL,
  hourly_cents    INTEGER NOT NULL CHECK (hourly_cents >= 1500),
  hours_per_month INTEGER NOT NULL CHECK (hours_per_month BETWEEN 80 AND 160),
  requires_note   TEXT NOT NULL DEFAULT '',
  alis_url        TEXT NOT NULL,
  checked         TEXT NOT NULL
);
${seedSql()}
CREATE TABLE jobs_holdings (
  player_id   INTEGER PRIMARY KEY REFERENCES players(id),
  job_id      INTEGER NOT NULL REFERENCES jobs_catalogue(id),
  since_month INTEGER NOT NULL
);
-- A row here means the teacher turned this job OFF for this class (students cannot pick it; existing holders keep it).
CREATE TABLE jobs_class_off (
  class_id INTEGER NOT NULL REFERENCES classes(id),
  job_id   INTEGER NOT NULL REFERENCES jobs_catalogue(id),
  PRIMARY KEY (class_id, job_id)
);
CREATE TABLE jobs_paystubs (
  id          INTEGER PRIMARY KEY,
  player_id   INTEGER NOT NULL REFERENCES players(id),
  world_id    INTEGER NOT NULL,
  month       INTEGER NOT NULL,
  job_id      INTEGER NOT NULL REFERENCES jobs_catalogue(id),
  gross       INTEGER NOT NULL,
  cpp         INTEGER NOT NULL,
  cpp2        INTEGER NOT NULL,
  ei          INTEGER NOT NULL,
  federal_tax INTEGER NOT NULL,
  alberta_tax INTEGER NOT NULL,
  net         INTEGER NOT NULL,
  ytd_json    TEXT NOT NULL,
  txn_id      INTEGER NOT NULL REFERENCES txns(id),
  UNIQUE (player_id, world_id, month)
);` }, { id: '002_raises', sql: `
-- Promotion path: step 0 is the catalogue row itself, steps 1..3 are these rows (ALIS wages, docs/jobs.md).
CREATE TABLE jobs_steps (
  job_id          INTEGER NOT NULL REFERENCES jobs_catalogue(id),
  step            INTEGER NOT NULL CHECK (step BETWEEN 1 AND 3),
  title           TEXT NOT NULL,
  hourly_cents    INTEGER NOT NULL CHECK (hourly_cents >= 1500),
  hours_per_month INTEGER NOT NULL CHECK (hours_per_month BETWEEN 80 AND 160),
  alis_url        TEXT NOT NULL,
  note            TEXT NOT NULL,
  checked         TEXT NOT NULL,
  PRIMARY KEY (job_id, step)
);
${stepsSql()}
-- Per-student pay: wage_cents NULL means the step's own wage; step_since / raise_since NULL mean since_month. note is shown on the next pay stub, then cleared.
ALTER TABLE jobs_holdings ADD COLUMN step INTEGER NOT NULL DEFAULT 0;
ALTER TABLE jobs_holdings ADD COLUMN wage_cents INTEGER;
ALTER TABLE jobs_holdings ADD COLUMN step_since INTEGER;
ALTER TABLE jobs_holdings ADD COLUMN raise_since INTEGER;
ALTER TABLE jobs_holdings ADD COLUMN note TEXT NOT NULL DEFAULT '';
-- A stub keeps the title, wage and hours it was paid at (NULL on stubs from before raises: read from the catalogue).
ALTER TABLE jobs_paystubs ADD COLUMN step INTEGER NOT NULL DEFAULT 0;
ALTER TABLE jobs_paystubs ADD COLUMN title TEXT;
ALTER TABLE jobs_paystubs ADD COLUMN employer TEXT;
ALTER TABLE jobs_paystubs ADD COLUMN hourly_cents INTEGER;
ALTER TABLE jobs_paystubs ADD COLUMN hours INTEGER;
ALTER TABLE jobs_paystubs ADD COLUMN note TEXT NOT NULL DEFAULT '';
CREATE TABLE jobs_applications (
  id            INTEGER PRIMARY KEY,
  player_id     INTEGER NOT NULL REFERENCES players(id),
  job_id        INTEGER NOT NULL REFERENCES jobs_catalogue(id),
  from_step     INTEGER NOT NULL,
  month         INTEGER NOT NULL,
  reflection    TEXT NOT NULL,
  status        TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'denied', 'void')),
  decided_month INTEGER
);
CREATE UNIQUE INDEX jobs_applications_pending ON jobs_applications (player_id) WHERE status = 'pending';` }, { id: '003_index', sql: `
-- the world price index from module.rates.changed (priceIndexBp), per world
CREATE TABLE jobs_index (world_id INTEGER PRIMARY KEY, index_bp INTEGER NOT NULL);` }, { id: '004_past', sql: `
-- the last time a student held each job they left: a return within 12 world months restores this wage, step and the clocks (moved on by the time away)
CREATE TABLE jobs_past (
  player_id INTEGER NOT NULL REFERENCES players(id), job_id INTEGER NOT NULL REFERENCES jobs_catalogue(id), left_month INTEGER NOT NULL,
  since_month INTEGER NOT NULL, step INTEGER NOT NULL, wage_cents INTEGER NOT NULL, step_since INTEGER, raise_since INTEGER,
  PRIMARY KEY (player_id, job_id)
);` }, { id: '004_active', sql: `
-- 0 = retired from catalogue.js (set at boot): off the board for everyone; holders keep the job and are still paid
ALTER TABLE jobs_catalogue ADD COLUMN active INTEGER NOT NULL DEFAULT 1;` }, { id: '005_auto', sql: `
-- 1 = an automatic promotion (options.jobs.autoPromote): approved when the student applied, with no teacher decision
ALTER TABLE jobs_applications ADD COLUMN auto INTEGER NOT NULL DEFAULT 0;` },
  { id: '006_business', sql: `
-- 4b/6c: a part-time job at a student company (ventures), ON TOP of the catalogue job; business_id = the company (owner_id of its business
-- ledger account). Up to 2 per student, 40 hours a month in all (checked in hireForBusiness). missed = paydays the company could not pay;
-- ends_month = notice given.
CREATE TABLE jobs_business (
  player_id INTEGER NOT NULL REFERENCES players(id), business_id INTEGER NOT NULL,
  employer TEXT NOT NULL, title TEXT NOT NULL,
  hourly_cents INTEGER NOT NULL CHECK (hourly_cents >= 1500), hours_per_month INTEGER NOT NULL CHECK (hours_per_month BETWEEN 10 AND 40),
  since_month INTEGER NOT NULL, missed INTEGER NOT NULL DEFAULT 0, last_missed INTEGER, ends_month INTEGER, note TEXT NOT NULL DEFAULT '',
  PRIMARY KEY (player_id, business_id)
);
CREATE INDEX jobs_business_employer ON jobs_business(business_id);
-- pay stubs: job_id NULL for a business stub (business_id says whose); one stub per student, world, month, kind ('pay' or 'severance', pay in
-- lieu of notice) and SOURCE (the catalogue job = business_id NULL, read as 0; else the company), so a catalogue pay and two company pays share a month
CREATE TABLE jobs_paystubs_v2 (
  id INTEGER PRIMARY KEY, player_id INTEGER NOT NULL REFERENCES players(id), world_id INTEGER NOT NULL, month INTEGER NOT NULL,
  job_id INTEGER REFERENCES jobs_catalogue(id), gross INTEGER NOT NULL, cpp INTEGER NOT NULL, cpp2 INTEGER NOT NULL, ei INTEGER NOT NULL,
  federal_tax INTEGER NOT NULL, alberta_tax INTEGER NOT NULL, net INTEGER NOT NULL, ytd_json TEXT NOT NULL, txn_id INTEGER NOT NULL REFERENCES txns(id),
  step INTEGER NOT NULL DEFAULT 0, title TEXT, employer TEXT, hourly_cents INTEGER, hours INTEGER, note TEXT NOT NULL DEFAULT '',
  business_id INTEGER, kind TEXT NOT NULL DEFAULT 'pay' CHECK (kind IN ('pay', 'severance')),
  CHECK ((job_id IS NULL) = (business_id IS NOT NULL))
);
INSERT INTO jobs_paystubs_v2 (id, player_id, world_id, month, job_id, gross, cpp, cpp2, ei, federal_tax, alberta_tax, net, ytd_json, txn_id, step, title, employer, hourly_cents, hours, note)
  SELECT id, player_id, world_id, month, job_id, gross, cpp, cpp2, ei, federal_tax, alberta_tax, net, ytd_json, txn_id, step, title, employer, hourly_cents, hours, note FROM jobs_paystubs;
DROP TABLE jobs_paystubs;
ALTER TABLE jobs_paystubs_v2 RENAME TO jobs_paystubs;
CREATE UNIQUE INDEX jobs_paystubs_once ON jobs_paystubs (player_id, world_id, month, kind, COALESCE(business_id, 0));` }, { id: '007_year_index', sql: `
-- 5c: the price index at each world year's first payday, so a year's pensionable earnings are compared with that year's indexed YMPE (cppHistory)
CREATE TABLE jobs_year_index (world_id INTEGER NOT NULL REFERENCES worlds(id), year INTEGER NOT NULL, index_bp INTEGER NOT NULL, PRIMARY KEY (world_id, year))` }];
