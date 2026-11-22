-- Optional automatic world advance (docs/clock.md): once per school day after 07:00 local, when the teacher has turned it on.
-- last_advanced_day is set by every advance (manual too), so a day the teacher already advanced is never advanced twice.
ALTER TABLE worlds ADD COLUMN auto_advance TEXT NOT NULL DEFAULT 'manual' CHECK (auto_advance IN ('manual', 'school_days'));
ALTER TABLE worlds ADD COLUMN last_advanced_day TEXT;
