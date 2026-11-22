-- Session idle timeout (lib/players.js IDLE_MS): last_seen is refreshed by requests, at most once a minute. Sessions that exist when
-- this runs count as seen now, so a deploy does not log everyone out.
ALTER TABLE sessions ADD COLUMN last_seen INTEGER NOT NULL DEFAULT 0;
UPDATE sessions SET last_seen = CAST(strftime('%s', 'now') AS INTEGER) * 1000;
