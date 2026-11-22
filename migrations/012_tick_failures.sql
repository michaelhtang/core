-- Failures that an advance survived (docs/modules.md section 5): one student's per-player work in one module's onTick that threw and was
-- rolled back to its savepoint (k.forEachPlayer), or a module event listener that threw inside the emitter's transaction. The advance
-- itself committed; the world teacher's console lists these. player_id is NULL when the failure is not about one student.
-- source: 'advance' (during world.advance) or 'request' (a listener that failed inside a student's own action, e.g. a payment).
CREATE TABLE tick_failures (
  id        INTEGER PRIMARY KEY,
  world_id  INTEGER NOT NULL REFERENCES worlds(id),
  month     INTEGER NOT NULL,
  module    TEXT NOT NULL,
  player_id INTEGER,
  error     TEXT NOT NULL,
  source    TEXT NOT NULL DEFAULT 'advance' CHECK (source IN ('advance', 'request')),
  created   INTEGER NOT NULL
);
CREATE INDEX tick_failures_world ON tick_failures (world_id, id);

-- Auto-advance stops after an advance it started fails (the whole transaction rolled back), and after any advance that recorded
-- tick_failures: the reason is kept here and the timer does nothing until the world teacher advances by hand without problems or saves
-- the auto-advance setting again (docs/clock.md).
ALTER TABLE worlds ADD COLUMN auto_stopped TEXT;
