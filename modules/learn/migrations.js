// learn: the table migrations (001 progress, 002 daily, 003 open units, 004 league, 005 practice).
export const migrations = [{ id: '001_progress', sql: `
CREATE TABLE learn_progress (       -- one row per level a student has finished this season; the reward was paid when it was written
  player_id INTEGER NOT NULL REFERENCES players(id), world_id INTEGER NOT NULL REFERENCES worlds(id), level_id TEXT NOT NULL,
  first_try INTEGER NOT NULL, questions INTEGER NOT NULL, best_first_try INTEGER NOT NULL, done_at INTEGER NOT NULL, paid_cents INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (player_id, world_id, level_id)
);
CREATE TABLE learn_attempts (       -- a started level: state = { first: { questionId: { v, ok } }, solved: [ids], queue: [ids to fix] }; finished_at NULL while open
  id INTEGER PRIMARY KEY, player_id INTEGER NOT NULL REFERENCES players(id), world_id INTEGER NOT NULL REFERENCES worlds(id), level_id TEXT NOT NULL,
  started_at INTEGER NOT NULL, state TEXT NOT NULL, finished_at INTEGER
);
CREATE UNIQUE INDEX learn_attempts_open ON learn_attempts(player_id, world_id, level_id) WHERE finished_at IS NULL;
CREATE TABLE learn_answers (        -- each question's FIRST answer on the first completed run of a level: the teacher's per-question numbers
  player_id INTEGER NOT NULL REFERENCES players(id), world_id INTEGER NOT NULL REFERENCES worlds(id), level_id TEXT NOT NULL, question_id TEXT NOT NULL,
  first_choice TEXT NOT NULL, first_correct INTEGER NOT NULL, at INTEGER NOT NULL,
  PRIMARY KEY (player_id, world_id, level_id, question_id)
);
CREATE INDEX learn_answers_q ON learn_answers(world_id, level_id, question_id)` },
  { id: '002_daily', sql: `
CREATE TABLE learn_streak (         -- the every-day streak; last_day = the last day kept ('YYYY-MM-DD', Edmonton); what a student SEES is streakView(row, today)
  player_id INTEGER NOT NULL REFERENCES players(id), world_id INTEGER NOT NULL REFERENCES worlds(id),
  streak INTEGER NOT NULL, best INTEGER NOT NULL, freezes INTEGER NOT NULL, last_day TEXT,
  PRIMARY KEY (player_id, world_id)
);
CREATE TABLE learn_days (           -- a row = that day was kept (by play, or frozen = 1 when a freeze covered it); xp = XP earned that day
  player_id INTEGER NOT NULL REFERENCES players(id), world_id INTEGER NOT NULL REFERENCES worlds(id), day TEXT NOT NULL,
  xp INTEGER NOT NULL DEFAULT 0, frozen INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (player_id, world_id, day)
);
CREATE TABLE learn_review (         -- the spaced-repetition queue: one row per question the student has met; box 0-4, due_day = the first day it may come back
  player_id INTEGER NOT NULL REFERENCES players(id), world_id INTEGER NOT NULL REFERENCES worlds(id), question_id TEXT NOT NULL,
  box INTEGER NOT NULL, due_day TEXT NOT NULL,
  PRIMARY KEY (player_id, world_id, question_id)
);
CREATE INDEX learn_attempts_pl ON learn_attempts(player_id, world_id, level_id);
INSERT OR IGNORE INTO learn_review (player_id, world_id, question_id, box, due_day)
  SELECT player_id, world_id, question_id, CASE WHEN first_correct = 0 THEN 0 ELSE 2 END, '2000-01-01' FROM learn_answers` },
  { id: '003_open', sql: `
CREATE TABLE learn_open_set (       -- a row = this class has a setting: only the units in learn_open_unit are open (even if there are none). No row = every unit is open.
  class_id INTEGER PRIMARY KEY REFERENCES classes(id), set_at INTEGER NOT NULL, set_by INTEGER NOT NULL REFERENCES players(id)
);
CREATE TABLE learn_open_unit (      -- the open units of a class that has a setting; a unit added to the course later is closed until a teacher opens it
  class_id INTEGER NOT NULL REFERENCES classes(id), unit_id TEXT NOT NULL, PRIMARY KEY (class_id, unit_id)
)` },
  { id: '004_league', sql: `
CREATE TABLE learn_rank (           -- a student's league rank in a world (tiers.js ids); no row = Iron
  player_id INTEGER NOT NULL REFERENCES players(id), world_id INTEGER NOT NULL REFERENCES worlds(id), tier TEXT NOT NULL,
  PRIMARY KEY (player_id, world_id)
);
CREATE TABLE learn_league_group (   -- who was in which group in a league week (week = its Monday); to_tier = the rank after settling, NULL until the week is settled
  world_id INTEGER NOT NULL REFERENCES worlds(id), week TEXT NOT NULL, player_id INTEGER NOT NULL REFERENCES players(id),
  tier TEXT NOT NULL, grp INTEGER NOT NULL, to_tier TEXT,
  PRIMARY KEY (world_id, week, player_id)
);
CREATE INDEX learn_league_group_g ON learn_league_group(world_id, week, tier, grp);
CREATE TABLE learn_league_done (    -- a row = that world's week has been settled (once)
  world_id INTEGER NOT NULL REFERENCES worlds(id), week TEXT NOT NULL, PRIMARY KEY (world_id, week)
)` },
  { id: '005_practice', sql: `
CREATE TABLE learn_practice_days (  -- the practice XP that reached learn_days on a day (after the daily cap); what was earned beyond the cap is shown but not stored
  player_id INTEGER NOT NULL REFERENCES players(id), world_id INTEGER NOT NULL REFERENCES worlds(id), day TEXT NOT NULL,
  xp INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (player_id, world_id, day)
)` }];
