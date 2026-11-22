// housing: the module migrations (001 to 007).
import { RENTALS, SOURCES_CHECKED } from './constants.js';

export const migrations = [{ id: '001_housing', sql: `
CREATE TABLE housing_catalogue (   -- the rent tiers, with where each number came from
  id TEXT PRIMARY KEY, name TEXT NOT NULL, rent_cents INTEGER NOT NULL, sort INTEGER NOT NULL, source_note TEXT NOT NULL, checked TEXT NOT NULL
);
CREATE TABLE housing_tenure (      -- where a student lives this season; no row = a shared room (bills' default)
  player_id INTEGER NOT NULL REFERENCES players(id), world_id INTEGER NOT NULL, tenure TEXT NOT NULL, pending_tenure TEXT, pending_from INTEGER, since_month INTEGER NOT NULL,
  PRIMARY KEY (player_id, world_id)
);
CREATE TABLE housing_homes (       -- per world: a season's homes never carry into the next one
  id INTEGER PRIMARY KEY, player_id INTEGER NOT NULL REFERENCES players(id), world_id INTEGER NOT NULL,
  price_cents INTEGER NOT NULL, down_cents INTEGER NOT NULL, premium_cents INTEGER NOT NULL, loan_cents INTEGER NOT NULL,
  rate_bp INTEGER NOT NULL, amort_months INTEGER NOT NULL, amort_left INTEGER NOT NULL, term_months INTEGER NOT NULL, term_start INTEGER NOT NULL,
  payment_cents INTEGER NOT NULL, value_cents INTEGER NOT NULL, bought_month INTEGER NOT NULL, first_time INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'owned' CHECK (status IN ('owned','sold','ended')), sold_month INTEGER, sold_net_cents INTEGER,
  arrears_cents INTEGER NOT NULL DEFAULT 0, missed_streak INTEGER NOT NULL DEFAULT 0, missed_total INTEGER NOT NULL DEFAULT 0
);
CREATE UNIQUE INDEX housing_one_home ON housing_homes(player_id, world_id) WHERE status = 'owned';
CREATE TABLE housing_payments (home_id INTEGER NOT NULL REFERENCES housing_homes(id), month INTEGER NOT NULL, interest_cents INTEGER NOT NULL, principal_cents INTEGER NOT NULL,
  arrears_paid_cents INTEGER NOT NULL, balance_cents INTEGER NOT NULL, status TEXT NOT NULL, PRIMARY KEY (home_id, month));
CREATE TABLE housing_renewals (id INTEGER PRIMARY KEY, home_id INTEGER NOT NULL REFERENCES housing_homes(id), month INTEGER NOT NULL, old_bp INTEGER NOT NULL, new_bp INTEGER NOT NULL,
  old_payment INTEGER NOT NULL, new_payment INTEGER NOT NULL, balance_cents INTEGER NOT NULL);
CREATE TABLE housing_income (player_id INTEGER NOT NULL REFERENCES players(id), world_id INTEGER NOT NULL, month INTEGER NOT NULL, gross_cents INTEGER NOT NULL, PRIMARY KEY (player_id, world_id, month));
CREATE TABLE housing_card (player_id INTEGER NOT NULL REFERENCES players(id), world_id INTEGER NOT NULL, minimum_cents INTEGER NOT NULL, month INTEGER NOT NULL, PRIMARY KEY (player_id, world_id));
CREATE TABLE housing_rates (world_id INTEGER PRIMARY KEY, mortgage5y_bp INTEGER NOT NULL);
CREATE TABLE housing_market (id INTEGER PRIMARY KEY, world_id INTEGER NOT NULL, month INTEGER NOT NULL, pct INTEGER NOT NULL, by_player INTEGER, created INTEGER NOT NULL);
${RENTALS.filter((r) => r.id !== 'parents').map((r, i) => `INSERT INTO housing_catalogue (id, name, rent_cents, sort, source_note, checked) VALUES ('${r.id}', '${r.name.replace(/'/g, "''")}', ${r.rentCents}, ${i + 1}, '${r.note.replace(/'/g, "''")}', '${SOURCES_CHECKED}');`).join('\n')}` }, { id: '002_homes', sql: `
ALTER TABLE housing_homes ADD COLUMN property TEXT NOT NULL DEFAULT 'average';   -- 'average' or 'starter'
INSERT OR IGNORE INTO housing_catalogue (id, name, rent_cents, sort, source_note, checked) VALUES ('parents', '${RENTALS[0].name.replace(/'/g, "''")}', ${RENTALS[0].rentCents}, 0, '${RENTALS[0].note.replace(/'/g, "''")}', '${SOURCES_CHECKED}');` }, { id: '003_index', sql: `
-- the world price index from module.rates.changed (priceIndexBp), per world
CREATE TABLE housing_index (world_id INTEGER PRIMARY KEY, index_bp INTEGER NOT NULL);` }, { id: '004_rates_pending', sql: `
-- module.rates.pending: the 5-year rate of an announced policy rate, until it applies (or is cancelled); per world, so a new season starts with none
CREATE TABLE housing_rates_pending (world_id INTEGER PRIMARY KEY, mortgage5y_bp INTEGER NOT NULL, effective_month INTEGER);` }, { id: '005_drop_catalogue', sql: `
-- Never read: housing uses RENTALS (constants.js) directly, so the copy seeded by 001/002 only went stale.
DROP TABLE housing_catalogue;` }, { id: '006_landlords', sql: `
-- 6b: a student may own one home of each role. A rental's mortgage is ledger account kind 'mortgage:<home id>'; the primary keeps 'mortgage'.
ALTER TABLE housing_homes ADD COLUMN role TEXT NOT NULL DEFAULT 'primary' CHECK (role IN ('primary','rental'));
DROP INDEX housing_one_home;
CREATE UNIQUE INDEX housing_one_per_role ON housing_homes(player_id, world_id, role) WHERE status = 'owned';
-- a rental offered to classmates. tenant_id: living there, or reserved from since_month; since_month: when the tenancy (or the vacancy) began.
-- arrears_cents / missed_streak: the current tenant's unpaid rent (never housing_homes.arrears_cents, which is the owner's mortgage).
-- pending_rent_cents from rent_from: an announced change; notice_month: the landlord ended the tenancy, the tenant leaves at that month's tick.
CREATE TABLE housing_listings (
  home_id INTEGER PRIMARY KEY REFERENCES housing_homes(id), world_id INTEGER NOT NULL, rent_cents INTEGER NOT NULL CHECK (rent_cents > 0), listed INTEGER NOT NULL DEFAULT 1,
  tenant_id INTEGER REFERENCES players(id), since_month INTEGER NOT NULL, arrears_cents INTEGER NOT NULL DEFAULT 0, missed_streak INTEGER NOT NULL DEFAULT 0, notice_month INTEGER,
  pending_rent_cents INTEGER, rent_from INTEGER, evictions INTEGER NOT NULL DEFAULT 0, written_off_cents INTEGER NOT NULL DEFAULT 0
);
CREATE UNIQUE INDEX housing_one_tenancy ON housing_listings(world_id, tenant_id) WHERE tenant_id IS NOT NULL;
-- one row per unit per month a tenant owed rent: paid or missed (reputation, the tenant's history, the sim's rent figures; never charged twice a month)
CREATE TABLE housing_rent (home_id INTEGER NOT NULL REFERENCES housing_homes(id), world_id INTEGER NOT NULL, month INTEGER NOT NULL, tenant_id INTEGER NOT NULL REFERENCES players(id),
  rent_cents INTEGER NOT NULL, status TEXT NOT NULL CHECK (status IN ('paid','missed')), PRIMARY KEY (home_id, month));
CREATE INDEX housing_rent_world ON housing_rent(world_id, month);` }, { id: '007_tenancy_swap', sql: `
-- A tenant may hold the unit they live in until the tick plus one reservation (moving straight from one classmate's unit to another): setTenure checks it.
DROP INDEX housing_one_tenancy;
CREATE INDEX housing_listings_tenant ON housing_listings(world_id, tenant_id);` }];
