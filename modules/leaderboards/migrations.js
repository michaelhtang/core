// leaderboards: the database migrations (tables are all leaderboards_*).
export const migrations = [{ id: '001_leaderboards', sql: `
CREATE TABLE leaderboards_snapshots (       -- one row per student per world month, written in onTick
  world_id   INTEGER NOT NULL REFERENCES worlds(id),
  player_id  INTEGER NOT NULL REFERENCES players(id),
  month      INTEGER NOT NULL,
  class_id   INTEGER NOT NULL,
  net_worth  INTEGER NOT NULL,
  health     INTEGER NOT NULL,
  parts      TEXT NOT NULL,                 -- {"cushion":..,"on_time":..,"credit":..,"load":..}
  rank_class INTEGER NOT NULL,
  rank_town  INTEGER NOT NULL,
  tier       INTEGER NOT NULL,              -- 0 Pup .. 4 Alpha
  PRIMARY KEY (world_id, player_id, month)
);
CREATE INDEX leaderboards_snapshots_month ON leaderboards_snapshots(world_id, month);
CREATE TABLE leaderboards_inputs (          -- the latest numbers events announced, per student and season
  world_id         INTEGER NOT NULL REFERENCES worlds(id),
  player_id        INTEGER NOT NULL REFERENCES players(id),
  net_cents        INTEGER,                 -- jobs.paid: last net pay, gross, and the month
  gross_cents      INTEGER,
  pay_month        INTEGER,
  score            INTEGER,                 -- credit.score
  mortgage_payment INTEGER,                 -- housing.payment
  home_value       INTEGER,                 -- housing.value
  ontime           INTEGER NOT NULL DEFAULT 0,   -- bills, card statements and mortgage payments paid on time
  last_min         INTEGER NOT NULL DEFAULT 0,   -- credit.statement: the minimum on the statement now waiting to be paid
  PRIMARY KEY (world_id, player_id)
);
CREATE TABLE leaderboards_late (            -- one row per late bill (per due month), late card minimum or late mortgage payment
  world_id  INTEGER NOT NULL REFERENCES worlds(id),
  player_id INTEGER NOT NULL REFERENCES players(id),
  key       TEXT NOT NULL,
  PRIMARY KEY (world_id, player_id, key)
);
CREATE TABLE leaderboards_index (world_id INTEGER PRIMARY KEY REFERENCES worlds(id), bp INTEGER NOT NULL);   -- price index, from rates
CREATE TABLE leaderboards_rankups (         -- a rank-up is announced once: seen = 1 when the student has read it
  world_id  INTEGER NOT NULL REFERENCES worlds(id),
  player_id INTEGER NOT NULL REFERENCES players(id),
  tier      INTEGER NOT NULL,
  month     INTEGER NOT NULL,
  seen      INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (world_id, player_id, tier)
);
CREATE TABLE leaderboards_settings (
  world_id    INTEGER PRIMARY KEY REFERENCES worlds(id),
  hide_amounts INTEGER NOT NULL DEFAULT 0,
  frozen_month INTEGER
);
CREATE TABLE leaderboards_awards (
  world_id   INTEGER NOT NULL REFERENCES worlds(id),
  award      TEXT NOT NULL,
  season     TEXT NOT NULL,
  player_id  INTEGER,
  name       TEXT,
  class_name TEXT,
  value      INTEGER NOT NULL,
  PRIMARY KEY (world_id, award)
);
CREATE TABLE leaderboards_reviews (         -- each student's Life Review for a closed season
  world_id  INTEGER NOT NULL REFERENCES worlds(id),
  player_id INTEGER NOT NULL REFERENCES players(id),
  season    TEXT NOT NULL,
  data      TEXT NOT NULL,
  PRIMARY KEY (world_id, player_id)
)` }, { id: '002_exchange_value', sql: `
-- exchange.value: holdings at the bid, in cents
ALTER TABLE leaderboards_inputs ADD COLUMN exchange_value INTEGER` }, { id: '003_stress_flags', sql: `
-- 6a: stress.score (the fifth health part, calm = 100 - stress; NULL = no stress module, four parts), emergency loans taken, any investment contribution
ALTER TABLE leaderboards_inputs ADD COLUMN stress INTEGER;
ALTER TABLE leaderboards_inputs ADD COLUMN loans INTEGER NOT NULL DEFAULT 0;
ALTER TABLE leaderboards_inputs ADD COLUMN invested INTEGER NOT NULL DEFAULT 0;
-- the month-end facts the pattern flags read (NULL in months snapshotted before 6a)
ALTER TABLE leaderboards_snapshots ADD COLUMN chequing INTEGER;
ALTER TABLE leaderboards_snapshots ADD COLUMN saved INTEGER;
ALTER TABLE leaderboards_snapshots ADD COLUMN holdings INTEGER;
ALTER TABLE leaderboards_snapshots ADD COLUMN net_pay INTEGER;
CREATE TABLE leaderboards_flags (           -- the pattern flags that held at season close (flags.js)
  world_id  INTEGER NOT NULL REFERENCES worlds(id),
  player_id INTEGER NOT NULL REFERENCES players(id),
  key       TEXT NOT NULL,
  detail    TEXT NOT NULL,
  PRIMARY KEY (world_id, player_id, key)
)` }, { id: '004_rent_gouge', sql: `
-- 6b: months a student's unit was let at >= 140% of the NPC rent tier (module.housing.payment kind 'rent'), for the rent-gouger flag
ALTER TABLE leaderboards_inputs ADD COLUMN gouge_months INTEGER NOT NULL DEFAULT 0` }, { id: '005_ventures_value', sql: `
-- ventures.value: a student's stake in a company at book value, and that company's whole value (Founder of the Season)
ALTER TABLE leaderboards_inputs ADD COLUMN ventures_value INTEGER;
ALTER TABLE leaderboards_inputs ADD COLUMN ventures_company INTEGER` }, { id: '006_ventures_employer', sql: `
-- ventures.value (wave 4b): the company's staff and its on-time and missed pays (Best Employer)
ALTER TABLE leaderboards_inputs ADD COLUMN ventures_staff INTEGER;
ALTER TABLE leaderboards_inputs ADD COLUMN ventures_paydays INTEGER;
ALTER TABLE leaderboards_inputs ADD COLUMN ventures_missed INTEGER` }, { id: '007_retirement', sql: `
-- 5c: module.retirement.coverage (Stage C): the retirement coverage health part (0-100) and the projected age the savings last until (the retirement_short flag)
ALTER TABLE leaderboards_inputs ADD COLUMN coverage INTEGER;
ALTER TABLE leaderboards_inputs ADD COLUMN lasts_age INTEGER` }, { id: '008_retirement_ratio', sql: `
-- 5c fix round 1: the uncapped income / bills ratio (bp) from module.retirement.coverage, Best Retirement's tie-break
ALTER TABLE leaderboards_inputs ADD COLUMN coverage_bp INTEGER` }];
