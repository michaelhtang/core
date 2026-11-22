# One clock (MIGRATION.md Step 6)

Two kinds of time exist in core and each quantity must say which it uses.

| Wall time (real hours, America/Edmonton) | World time (integer world months) |
|---|---|
| sessions, login throttles, anti-abuse rate limits (transfers per 10 min, rolling 24 h caps) | pay periods, bills and rent due, interest and compounding, loan/mortgage terms, GIC maturity, credit history length, order expiry on the exchange, quest due dates |
| audit timestamps (`created`, `at`) | season length |

Rule: **anything a student is learning about runs on world time. Anything that protects the system runs on wall time.** The bank's transfer cap is anti-abuse, so it stays wall time, and its message says "in the last 24 hours", not "today".

## `lib/clock.js`

```js
createClock({ now = () => Date.now(), tz = 'America/Edmonton', noSchool = [] } = {}) → {
  tz,                    // the zone name
  now(),                 // ms, wall
  today(),               // 'YYYY-MM-DD' in tz (Intl.DateTimeFormat en-CA)
  dayOf(ms),             // the same, for any timestamp
  hour(),                // 0-23 in tz (auto-advance waits for 07:00; the nightly audit has its own hour)
  isSchoolDay(day, list?), // Mon–Fri and not on `list` (a world's no-school days), else not on config.calendar.noSchool
}
// also exported: addDays('YYYY-MM-DD', n), calendar arithmetic with no time zone or DST in it.
parseNoSchool(list)        // validates and canonicalises a no-school list; throws naming the bad entry
```

`createApp({ clock })` defaults to `createClock()`; tests and the sim pass a fake (`now` backed by a variable). `app.world.month()` stays the world clock. The module facade's `k.clock` is `{ now, today, month: () => world.current().month }`.

Every `Date.now()` in `lib/` and `modules/` goes through `clock.now()`. (`server.js` cookies/static may keep `Date.now`.) `world.create()` uses `clock.today()` for `season_start`, fixing the UTC-date bug.

## No-school days

An entry is `YYYY-MM-DD` or `YYYY-MM-DD to YYYY-MM-DD` (inclusive). The date must exist (2027-02-29 is refused), a range must not end before it starts, at most 200 entries. A bad entry in `config.calendar.noSchool` fails boot; a bad one from the console is a 400 naming it.

- `config.calendar.noSchool` is the default. `worlds.no_school` (migration 012, JSON) is the world's own list; NULL means "use the default". `world.noSchool(w)` returns whichever applies.
- The world teacher edits it in the console (World clock, "No-school days and season end": one entry per line) → `POST /api/teach/world/settings { no_school: [...] }` (`null` goes back to the default). `/api/teach/state` returns `world.no_school` (the list in force) and `world.season_over`.
- The default holds **every non-instructional day of the Edmonton Public Schools 2026-27 school year** (Dr. Anne Anderson High School is an EPSB school). Source: the official district calendar, "2026–27 School Year Calendar", https://epsb.ca/media/epsb/calendars/EPSB_School_Year_Calendar_2026-27.pdf (linked from https://epsb.ca/calendars/printablecalendars/; footer "D26 – April 2, 2026"), read 2026-10-23. Every date below is read from that page (its colour legend: public holiday, PD day, operational day, Teachers' Convention, teachers' day in lieu, board-approved non-instructional day, winter/spring break):

| Date | On the calendar |
|---|---|
| 2026-08-03 | Public holiday (marked in the public-holiday colour; not named on the page) |
| 2026-08-28 | First operational day (no students) |
| 2026-08-31 | PD day (no students); stored with 08-28 as one range (08-29/30 are a weekend). First day of classes: September 1 |
| 2026-09-07 | Labour Day |
| 2026-09-21 | PD day |
| 2026-09-30 | National Day for Truth and Reconciliation |
| 2026-10-12 | Thanksgiving |
| 2026-10-19 | PD day |
| 2026-11-11 | Remembrance Day |
| 2026-11-12 to 2026-11-13 | Board-approved non-instructional days (no teachers or students) |
| 2026-11-16 | Teachers' day in lieu (no teachers or students) |
| 2026-12-21 to 2026-12-31 | Winter break (Christmas Day Dec 25 and Boxing Day Dec 26 inside it) |
| 2027-01-01 | New Year's Day; stored with the winter break as one range |
| 2027-01-29 | PD day |
| 2027-02-15 | Family Day |
| 2027-02-25 to 2027-02-26 | Teachers' Convention (no students) |
| 2027-03-10 | Board-approved non-instructional day |
| 2027-03-11 to 2027-03-12 | PD days (stored with 03-10 as one range) |
| 2027-03-26 | Good Friday |
| 2027-03-29 | Easter Monday |
| 2027-03-30 to 2027-04-02 | Spring Break (stored with 03-29 as one range) |
| 2027-04-05 | PD day |
| 2027-05-20 | Teachers' day in lieu (no teachers or students) |
| 2027-05-21 | Board-approved non-instructional day |
| 2027-05-24 | Victoria Day |
| 2027-06-21 | PD day |
| 2027-06-29 | Last operational day (no students; June 28 is the last day of classes) |

  The calendar covers August 2026 to June 2027 only: July and the rest of August are summer and are not listed, so a season running over the summer should end by June 28 or have the summer added in the console. Schools with a modified calendar may have different PD days (the calendar says so), so check the school's own calendar and edit the list in the console. A new season starts with the previous season's list.

## Season end

Auto-advance does nothing on or after the world's `season_end` (Edmonton date). The teacher can still advance by hand, and close the season when ready. The console says when auto-advance has stopped.

With `life` enabled (wave 5b) the months per class day follow its pace plan (changed only when an advance crosses a plan boundary, through `k.world.setPace`), and when the life is over (the world reaches month 577, age 70) `life` switches auto-advance to manual once and refuses any further advance until the season is closed (docs/phase5-life.md "As built (5b)").

## Auto-advance (optional per world)

- Migration: `worlds.auto_advance TEXT NOT NULL DEFAULT 'manual' CHECK (auto_advance IN ('manual','school_days'))`, `worlds.last_advanced_day TEXT`.
- In `server.js`, a guarded 5-minute timer: if `auto_advance = 'school_days'` and today is before `season_end` and `clock.isSchoolDay(today, world.noSchool())` and local time ≥ 07:00 and `last_advanced_day !== today` → `world.advance({ from: current.month, auto: true })`, which sets `last_advanced_day = today` inside the same transaction. A manual advance also sets it, so the timer never double-advances a day the teacher already advanced.
- Teacher console: a toggle on the World clock panel (`POST /api/teach/world/settings { auto_advance }`).
- **Auto-advance stops on any problem** (migration 012, `worlds.auto_stopped TEXT`), so it never keeps advancing past something the world teacher has not seen:
  - When an advance the timer started throws (the whole transaction rolled back: a module-wide `onTick` failure, or one module failing for more than half of the world's students in a month, see docs/modules.md section 5), `autoAdvance()` stores the error in `worlds.auto_stopped`, writes a `world.auto_stopped` audit row, emits `world.settings` (teacher consoles refetch) and rethrows (the timer logs it).
  - When any advance, manual or automatic, commits but recorded `tick_failures` (some students skipped in some module) in a world on `school_days`, `advance()` sets `auto_stopped` to "the advance to month N skipped some work (K problems listed below)" in the same transaction. A manual advance only records it; the stop applies to the timer. A world on `manual` never gets `auto_stopped`: its console lists the problems under the neutral heading and shows no resume button, so nothing there can switch auto-advance on. The resume button re-saves the world's current `auto_advance` value.
  - While `auto_stopped` is set the timer does nothing, so the same failure is not retried every 5 minutes. It is cleared by an advance that recorded no failures (the world teacher's manual one) or by saving the auto-advance setting (`POST /api/teach/world/settings { auto_advance }`, the console's "Resume auto-advance" button), after which the next timer tick tries again.
  - The world teacher's console shows "Auto-advance stopped: <reason>" in the "Problems in recent advances" panel (`GET /api/teach/state` → `problems.auto_stopped`), above the list of skipped students.
- An advance of 2+ months (by hand, or `months_per_day` ≥ 2) runs one tick per month in one transaction. Each tick's `onTick` context carries `startMonth` (the month the advance began), so bills and credit only judge lines due by then; anything issued during the advance is judged at the next one.

## Tests

1. Fake clock: `today()` returns the Edmonton date at 23:30 MDT (UTC next day).
2. Auto-advance: with school_days on, two timer ticks on the same school day advance once; a tick on Saturday does nothing; a restart (new app on same DB) the same day does not advance again; a manual advance earlier that day blocks the auto one.
3. Grep-test: no `Date.now(` in `lib/` or `modules/` except `lib/clock.js`.
4. `test/data.test.js`: a no-school date (config default and the teacher's own list) is skipped by auto-advance; a weekday on or after season_end is not auto-advanced while a manual advance works; invalid dates are refused by the route (400) and in config (boot fails).
