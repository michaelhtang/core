-- The world price index, one row per world (lib/world.js keeps it from module.rates.changed). It replaces the copies each module kept
-- (jobs_index, housing_index, bills_index, insurance_index, outfitters_index, leaderboards_index): those tables stay, unread and no longer written.
-- Existing worlds are filled from rates_policy by rates' own migration 003_core_index (a core migration cannot read a module's table).
CREATE TABLE price_index (
  world_id INTEGER PRIMARY KEY REFERENCES worlds(id),
  index_bp INTEGER NOT NULL CHECK (index_bp > 0)
);
