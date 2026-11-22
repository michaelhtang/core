-- The last active world a student "logged in" to (docs/teachers-seasons.md). A session that outlives a season sees a new world id
-- on /api/me, which runs the onLogin hooks (the welcome grant) once there, as a fresh login would.
ALTER TABLE players ADD COLUMN seen_world_id INTEGER REFERENCES worlds(id);
