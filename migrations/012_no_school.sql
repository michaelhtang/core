-- The world teacher's no-school days (docs/clock.md): a JSON list of 'YYYY-MM-DD' / 'YYYY-MM-DD to YYYY-MM-DD'. NULL = config.calendar.noSchool.
ALTER TABLE worlds ADD COLUMN no_school TEXT;
