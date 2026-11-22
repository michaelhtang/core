-- Class management (lib/players.js removeStudents, deleteClass). Rows are never deleted (foreign keys everywhere, an append-only ledger):
-- a deleted class is hidden by archived (ms, NULL = live); a removed student is detached (class_id NULL) and cannot log in.
ALTER TABLE classes ADD COLUMN archived INTEGER;

-- When the player first started a session (a login). A student who has ever logged in is "active" and is never removed: everything
-- a student does needs a session, and nothing the system does to a new account (welcome hooks, ticks, autopay) starts one.
-- Students from before this migration count as logged in if they entered a world (migration 010) or still have a session.
ALTER TABLE players ADD COLUMN first_login INTEGER;
UPDATE players SET first_login = CAST(strftime('%s', 'now') AS INTEGER) * 1000
  WHERE seen_world_id IS NOT NULL OR id IN (SELECT player_id FROM sessions);
