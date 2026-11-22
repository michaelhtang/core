-- Teachers, classes and seasons (docs/teachers-seasons.md). The setup teacher is the world teacher; every existing class belongs to them.
ALTER TABLE players ADD COLUMN world_teacher INTEGER NOT NULL DEFAULT 0;
UPDATE players SET world_teacher = 1 WHERE role = 'teacher';

CREATE TABLE class_teachers (
  class_id   INTEGER NOT NULL REFERENCES classes(id),
  teacher_id INTEGER NOT NULL REFERENCES players(id),
  PRIMARY KEY (class_id, teacher_id)
);
INSERT INTO class_teachers SELECT c.id, p.id FROM classes c, players p WHERE p.role = 'teacher';

CREATE TABLE teacher_invites (
  token_hash TEXT PRIMARY KEY,
  created_by INTEGER NOT NULL REFERENCES players(id),
  expires    INTEGER NOT NULL,
  used_by    INTEGER REFERENCES players(id)
);

ALTER TABLE worlds ADD COLUMN status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'closed'));
CREATE TABLE season_results (
  world_id        INTEGER NOT NULL REFERENCES worlds(id),
  player_id       INTEGER NOT NULL REFERENCES players(id),
  net_worth_cents INTEGER NOT NULL,
  PRIMARY KEY (world_id, player_id)
);
