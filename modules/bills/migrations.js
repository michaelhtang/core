// bills: the module's schema migrations.
import { seedSql } from './catalogue.js';

export const migrations = [{ id: '001_bills', sql: `
CREATE TABLE bills_catalogue (
  id TEXT PRIMARY KEY, slot TEXT NOT NULL, option TEXT NOT NULL, option_label TEXT NOT NULL, name TEXT NOT NULL,
  amount_cents INTEGER NOT NULL CHECK (amount_cents > 0), required INTEGER NOT NULL, category TEXT NOT NULL CHECK (category IN ('needs','wants')),
  sort INTEGER NOT NULL, source_note TEXT NOT NULL, source_url TEXT NOT NULL, checked TEXT NOT NULL, illustrative INTEGER NOT NULL
);
CREATE TABLE bills_choices (player_id INTEGER NOT NULL REFERENCES players(id), slot TEXT NOT NULL, option TEXT NOT NULL, PRIMARY KEY (player_id, slot));
CREATE TABLE bills_settings (player_id INTEGER PRIMARY KEY REFERENCES players(id), autopay INTEGER NOT NULL DEFAULT 0);
CREATE TABLE bills_due (
  id INTEGER PRIMARY KEY, player_id INTEGER NOT NULL REFERENCES players(id), world_id INTEGER NOT NULL, bill_id TEXT NOT NULL, name TEXT NOT NULL,
  category TEXT NOT NULL, amount INTEGER NOT NULL, due_month INTEGER NOT NULL,
  paid_txn INTEGER REFERENCES txns(id), paid_month INTEGER,
  late INTEGER NOT NULL DEFAULT 0, late_month INTEGER, late_fee_cents INTEGER NOT NULL DEFAULT 0, late_fee_txn INTEGER REFERENCES txns(id),
  UNIQUE (player_id, world_id, bill_id, due_month)
);
CREATE INDEX bills_due_open ON bills_due(player_id, world_id) WHERE paid_txn IS NULL;
CREATE TABLE bills_history (
  id INTEGER PRIMARY KEY, player_id INTEGER NOT NULL REFERENCES players(id), world_id INTEGER NOT NULL, due_id INTEGER NOT NULL UNIQUE REFERENCES bills_due(id),
  bill_id TEXT NOT NULL, name TEXT NOT NULL, due_month INTEGER NOT NULL, months_late INTEGER NOT NULL, fee_cents INTEGER NOT NULL, paid_month INTEGER
);
CREATE INDEX bills_history_player ON bills_history(player_id, world_id);
CREATE TABLE bills_pay (
  player_id INTEGER NOT NULL REFERENCES players(id), world_id INTEGER NOT NULL, month INTEGER NOT NULL, net_cents INTEGER NOT NULL, last_entry_id INTEGER NOT NULL,
  PRIMARY KEY (player_id, world_id, month)
);
${seedSql()}` }, { id: '002_pay_events_start', sql: `
ALTER TABLE bills_pay DROP COLUMN last_entry_id;   -- net pay now arrives as an event, not by scanning the ledger
CREATE TABLE bills_start (player_id INTEGER PRIMARY KEY REFERENCES players(id), start_month INTEGER NOT NULL);` }, { id: '003_start_per_world', sql: `
-- The start month belongs to a season: without world_id, a Season 1 start month leaked into Season 2.
CREATE TABLE bills_start_v2 (player_id INTEGER NOT NULL REFERENCES players(id), world_id INTEGER NOT NULL, start_month INTEGER NOT NULL, PRIMARY KEY (player_id, world_id));
INSERT INTO bills_start_v2 (player_id, world_id, start_month) SELECT player_id, (SELECT MAX(id) FROM worlds), start_month FROM bills_start WHERE (SELECT MAX(id) FROM worlds) IS NOT NULL;
DROP TABLE bills_start;
ALTER TABLE bills_start_v2 RENAME TO bills_start;` }, { id: '004_pay_from_housing', sql: `
ALTER TABLE bills_settings ADD COLUMN pay_from TEXT NOT NULL DEFAULT 'chequing' CHECK (pay_from IN ('chequing','card'));
-- credit's card limit per student, kept from module.credit.limit events (bills cannot read credit's tables)
CREATE TABLE bills_limits (player_id INTEGER PRIMARY KEY REFERENCES players(id), limit_cents INTEGER NOT NULL);
-- housing's lines per month, from module.housing.costs events
CREATE TABLE bills_housing (
  player_id INTEGER NOT NULL REFERENCES players(id), world_id INTEGER NOT NULL, month INTEGER NOT NULL, key TEXT NOT NULL,
  name TEXT NOT NULL, amount INTEGER NOT NULL CHECK (amount > 0), category TEXT NOT NULL, PRIMARY KEY (player_id, world_id, month, key)
);` }, { id: '005_limits_per_world', sql: `
-- A card limit belongs to a season: credit has no card in a new world, so Season 1's limit must not let bills borrow in Season 2.
-- Old rows had no world; they are attributed to the latest world (or dropped when there is none).
CREATE TABLE bills_limits_v2 (player_id INTEGER NOT NULL REFERENCES players(id), world_id INTEGER NOT NULL, limit_cents INTEGER NOT NULL, PRIMARY KEY (player_id, world_id));
INSERT INTO bills_limits_v2 (player_id, world_id, limit_cents) SELECT player_id, (SELECT MAX(id) FROM worlds), limit_cents FROM bills_limits WHERE (SELECT MAX(id) FROM worlds) IS NOT NULL;
DROP TABLE bills_limits;
ALTER TABLE bills_limits_v2 RENAME TO bills_limits;` }, { id: '006_lines_known', sql: `
-- Lines other modules ask us to bill, per month (housing costs, insurance costs, town-event expenses): bill_id is the full due id.
CREATE TABLE bills_lines (
  player_id INTEGER NOT NULL REFERENCES players(id), world_id INTEGER NOT NULL, month INTEGER NOT NULL, bill_id TEXT NOT NULL,
  name TEXT NOT NULL, amount INTEGER NOT NULL CHECK (amount > 0), category TEXT NOT NULL, PRIMARY KEY (player_id, world_id, month, bill_id)
);
INSERT INTO bills_lines (player_id, world_id, month, bill_id, name, amount, category) SELECT player_id, world_id, month, 'housing-' || key, name, amount, category FROM bills_housing ORDER BY rowid;
DROP TABLE bills_housing;
-- students whose plans module.bills.choices has been announced this season (the first billed tick)
CREATE TABLE bills_known (player_id INTEGER NOT NULL REFERENCES players(id), world_id INTEGER NOT NULL, PRIMARY KEY (player_id, world_id));` }, { id: '007_index', sql: `
-- the world price index from module.rates.changed (priceIndexBp), per world
CREATE TABLE bills_index (world_id INTEGER PRIMARY KEY, index_bp INTEGER NOT NULL);` }, { id: '008_owed', sql: `
-- the month a row was posted to the student's 'payable' ledger account (NULL = not yet). Unpaid rows from before this migration are posted
-- at the next tick.
ALTER TABLE bills_due ADD COLUMN owed_month INTEGER;` }, { id: '009_active', sql: `
-- 0 = retired from catalogue.js (set at boot): no longer billed; bills already issued keep their own name and amount
ALTER TABLE bills_catalogue ADD COLUMN active INTEGER NOT NULL DEFAULT 1;` }, { id: '010_bot_decided', sql: `
-- 1 = the sim bot's own 80/20 autopay roll was made (onPlayer now writes the row with autopay on for every new student; a bot re-rolls once)
ALTER TABLE bills_settings ADD COLUMN bot_decided INTEGER NOT NULL DEFAULT 0;` }, { id: '011_housed', sql: `
-- 6b: module.housing.costs' housed flag per month (1 = the student's home replaces the catalogue rent line; 0 = it does not, e.g. a landlord who lives
-- in the shared room). No row = an older payload: any housing line replaces it, as before.
CREATE TABLE bills_housed (player_id INTEGER NOT NULL REFERENCES players(id), world_id INTEGER NOT NULL, month INTEGER NOT NULL, housed INTEGER NOT NULL, PRIMARY KEY (player_id, world_id, month));` }, { id: '012_stage_ages', sql: `
-- Stage costs (docs/stagecosts.md): a row bills only while the world's age is from_age..to_age, and (tenure 'own' / 'rent') only for an owner / everyone else.
-- The defaults are the Stage A rows' (every age, every tenure), so nothing billed before changes.
ALTER TABLE bills_catalogue ADD COLUMN from_age INTEGER NOT NULL DEFAULT 0;
ALTER TABLE bills_catalogue ADD COLUMN to_age INTEGER NOT NULL DEFAULT 99;
ALTER TABLE bills_catalogue ADD COLUMN tenure TEXT NOT NULL DEFAULT '';` }];
