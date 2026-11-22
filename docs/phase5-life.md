# Phase 5: Life (stages, errands, school, the town opens)

*Spec, 2026-10-29. Waves 5a, 5b (`life`) and 5c (`retirement`) are built (see "As built (5a)", "As built (5b)" and "As built (5c)" at the end); the rest is not. Builds on `docs/engagement-review.md` (the gaps and the reasoning) and Mr. Tang's decisions of the same date. Code references are to main @ 10c8138. Real-world figures (CPP, OAS, RRIF, student loans) are marked ILLUSTRATIVE and must be checked against the cited source when each wave is built.*

**The goal:** a student lives an adult life, 22 to 70, in one semester, through the same three stages as the Life Cycle Wealth Architect: **A** (22-35, starting out), **B** (36-54, building), **C** (55-70, winding down; the brief writes B as "36-55" with 55 already in Stage C). They choose careers (with school and student debt), earn, pay bills, invest, retire on real Canadian rules, and finish with the question the spreadsheet asks: *do my bills at 65 still fit?* A daily rhythm of errands and a lesson quest gives a reason to open the app each class day; energy lets them explore the town and unlock what is inside it.

## Decisions (Mr. Tang, 2026-10-29)

1. **Clock:** stage-paced time. The world month stays the unit; how many months pass per class day changes with the stage.
2. **Errands and energy refresh once per class day** (one advance), never on the wall clock.
3. **Unlocks:** the teacher/unit decides which districts exist; energy and life stage decide what is inside them. *(He did not pick a side; this took the recommendation.)*
4. **Education tier with student debt:** yes, seeded from the brief's 12 careers.
5. **Stage C:** full decumulation (CPP, OAS, RRIF, withdrawals, the live monthly check).
6. **Roadmap:** Phase 5 "The Town", alongside Venture Row. Ventures stays paused; none of this touches the `p4a-ventures` / `p4b-ventures` branches.

## Principles (hold in every wave)

- **One refresh per class day.** A "day" is one advance (the `world.month` event, `lib/world.js:141`), however many months it covers. At 12 months per day, errands do not refresh twelve times.
- **No wall-clock mechanic.** No regen timers, no streak that a calendar day breaks, no notifications. PLAN §6.
- **No randomness in rewards.** Errand choice is deterministic (a seeded draw from a per-world secret, like exchange and insurance). Rewards are fixed amounts. No loot boxes, no gambling, no paid energy.
- **Curriculum is never gated by energy.** Anything a course outcome needs is open to everyone. Gates cover optional depth, lore and cosmetics. A teacher can open any gate for a class.
- **Soft dependencies.** Every module here is optional. A module reads `life` and `town` through `k.modules.has` / `k.modules.call`; if they are not enabled, behaviour is exactly today's.
- **Bots first.** Each wave ships a `simulate` hook, and `npm run sim -- --months=576` audits every month. The economy guard (Gini < 0.40, bills/pay 50-75%, homeowners 20-50%) must hold at every stage.
- **Sessions stay 5-10 minutes.** The Today card is the whole daily loop.

## Wave map

| Wave | Module | What it adds | Touches the economy? |
|---|---|---|---|
| **5a** | `today` | Today card, month digest, errands, lesson quests, energy, streak | Tiny errand wages only |
| **5b** | `life` | Age, stages, stage-paced clock, retirement age, work stops, stage events, Life Review | Yes: pay ends |
| **5c** | `life` (income) | CPP, OAS, RRIF, withdrawal plan, the live Stage C check | Yes: retirement income |
| **5d** | `school` | Programs, enrolment, part-time pay while studying, student loan, careers by tier | Yes: new debt, new wages |
| **5e** | `town` | Districts, locks and gates, explorations, codex | No |

Order is fixed by dependency (`life` before `school` and Stage C; `today` before `town`), and each wave ships alone. Each wave: Sonnet editors in `.worktrees/<name>`, Opus on any ledger or kernel touch, a verifier per finding, two fix rounds at most.

---

## 5a. `today`: the daily loop

### The Today card

A card above the doors on the student home screen, rebuilt after each advance. It replaces the "nothing tells you what happened" gap.

**Month digest** ("since you last played"): everything the student's accounts did since the previous advance, grouped by transaction kind: pay received, bills paid and bills now due, interest and dividends, big moves (a purchase, a move), plus the Wolf-rank change. At 12 months per day it is a year in review. The ledger has no month column (`txns` has `created`, `kind`, `meta`), so the window is wall time: `today` records the time of each advance (`today_days.at`) and sums `entries` of the student's accounts with `created` between the previous advance and now, by `txns.kind`. Student actions between advances land in the same window, which is what "since you last played" should mean. Computed at read time; nothing per student is stored. The sum needs the `entries_account` index that already exists.

**Today's list:** the lesson quest (if any), three errands, energy remaining, streak. Each row links to its building.

On phones the card is the first thing under the header, and the mascot is shown at a smaller size instead of hidden (`theme.css:176`).

### Errands

Three per day per student, chosen deterministically from the student's own state.

- **Catalogue:** `modules/today/errands.json` (data, not code). Each template: `id`, `title`, `building`, `when` (fact comparisons), `done` (an event or fact change), `reward_cents` (× price index), `energy` (granted), `priority`, optional `stage`.
- **Facts:** each module exposes a read-only service `todayFacts(k, playerId)` returning flat numbers and booleans, for example `bills.dueCount`, `bills.autopay`, `jobs.hasJob`, `jobs.promotionEligible`, `savings.idleChequingCents`, `savings.hisaCents`, `exchange.holdings`, `credit.hasCard`. A template's `when` is a list of `{ fact, op, value }` with `op` in `== != < <= > >=`. No eval, no code in the catalogue.
- **Selection:** candidates are the templates whose `when` holds. Sort by `priority`, then by an HMAC of `(world secret, player, day_no, template)`. Take three. A template that completed in the last 3 days is skipped.
- **Kinds:**
  - *Housekeeping with a real cost if skipped:* pay the phone bill (autopay off), make the card minimum, get a job.
  - *Panel tours:* read your pay stub and name the CPP line; open the Bank of DAA and find the pending rate.
  - *Do something useful with money:* move idle chequing to HISA/GIC/TFSA, apply for the card, check mortgage qualification.
  - *Stage errands:* set your retirement age (B), set a withdrawal plan (C).
- **Completion:** a listener on the event the template names (types in `docs/events.md`), or a fact check at the next advance. Errands expire at the next advance; there is no carry-over and no penalty for missing one.
- **Reward:** a fixed small cash amount minted from the town like wages (kind `today.errand`), plus energy. Cash is capped by a config ceiling: lifetime errand income must stay under 1% of lifetime pay in the sim. The larger reward is cosmetic: an Outfitters item or a streak outfit. Outfitters has no `grantItem` service on main (the Phase 4 spec assumes one too), so 5a adds it: `grantItem(k, { playerId, itemId })`, achievement-style, never for sale, idempotent.

### Lesson quests

The planned "World quest" (PLAN.md:302-305): an outline section → a quest file → pushed to the town for a date.

```
quests/<date>.json   { id, date, title, brief, tasks: [ { kind, check } ], justify: true|false, reward_cents, energy }
```

- `check` is from a short vocabulary tied to the same facts and events as errands (`paid_bill`, `moved_to_account`, `opened_registered_account`, `bought_security`, `read_panel`).
- `justify: true` adds a 1-3 sentence written answer ("choose and justify"). It is stored per student and shown only to the teacher (outcome evidence). Minimum length, no profanity filter beyond the school's existing blocklist.
- The quest file is written by Slide Studio on Mr. Tang's Mac and has to reach the vDAA server, so "push to the town" is an authenticated upload to a teacher-console route (`POST /api/today/quest`, world teacher only; as built: module routes mount at `/api/<id>` and `teach` is reserved by core, so Slide Studio's uploader must use this path), not a filesystem write.
- The teacher sees who finished, and the answers, in the console. The pacing-guide slide shows the quest.
- **Slide Studio link:** Build lesson writes `quests/<date>.json` from the outline's "World quest" section, with numbers computed in code like the worksheet forms. This is a Slide Studio change, listed in the build order.
- A day with no quest shows only errands.

### Energy

- A number per student, 0-10 (`energy_cap`, per class setting). **Refilled to the cap at each advance.** Unspent energy does not bank. Errands and quests add a little on completion, up to the cap.
- **It does not gate banking.** Paying bills, moving money, trading, applying, switching jobs, and everything a course outcome needs cost no energy.
- Energy is spent only on explorations (5e). Until 5e ships it simply accumulates as a display, which is why 5a can ship first.

### Streak

Consecutive class days with at least one completed errand or quest. Counted in days (advances), not calendar days, so a no-school stretch never breaks it. It resets on a missed day and costs nothing. Rewards at 5, 10 and 20: cosmetics only.

### Small fixes bundled with 5a

- **Autopay defaults on for new players**, with the first "pay all" as an errand that shows what autopay did. A column `DEFAULT 1` is not enough: the student state reads `!!row?.autopay`, so a player with no `bills_settings` row is off (`bills/index.js:199`, table at `:238`). `bills` gets an `onPlayer` hook that writes the row with autopay on (`setAutopay`, `:209`); players that already exist keep what they have.
- **Jobless nudge:** one tick with no job and the Today card's only errand is "Pick a job".
- **Net worth and HISA on the home screen** next to the chequing balance.
- **Display name** separate from the login username on boards (`leaderboards/index.js:84,92`; today the same string is the transfer address).

### Data (5a)

| Table | Columns |
|---|---|
| `today_days` | world_id, day_no, at (wall ms of the advance), month |
| `today_state` | player_id, world_id, day_no, energy, streak, last_day_done |
| `today_errands` | id, player_id, world_id, day_no, template, status (open/done/expired), done_month, reward_cents |
| `today_quests` | id, world_id, date, body JSON, created |
| `today_quest_done` | quest_id, player_id, world_id, done_month, answer TEXT |
| `today_secrets` | world_id, secret |

Kinds are prefixed `today.*`. `day_no` increments on `world.month`.

### Teacher (5a)

Console panel "Today": quest list and push, per-class energy cap, per-class errand categories on/off, who is stuck, the quest answers.

### Gates (5a)

- Tests: deterministic selection (same inputs, same three errands); completion by event and by fact; expiry at the next advance; the streak does not break on a no-school gap; no reward draws randomness; a student with `today` disabled sees the old home screen; teacher B isolation; the digest equals the ledger.
- Sim: 60 months; errand cash under the cap; the economy guard unchanged.

### As built (5a)

*Branch `p5a-today`, 2026-10-29. Autopay default, Outfitters `grantItem` and the display name were built separately (another editor) and are not in this branch.*

**What shipped**

- `modules/today` (id `today`, requires `bank-basic`), enabled for both courses, last in `config/vdaa.json` (after `leaderboards`).
- **Core hook `homeCards`** (the one core edit: `lib/modules.js` `homeCardsFor`, one line in `server.js` `/api/me`, `homeCard()` in `public/student.js`). Generic, documented in docs/modules.md "Home cards": a module declares `cards: [{ id, src }]` and returns `[{ id, title, data }]`; undeclared ids, titles over 60 characters, data over 8 KB of JSON, a third card and a throwing hook are dropped and logged. With no cards `/api/me` has `homeCards: []` and the home screen is unchanged.
- **Day clock:** day 0 (before the first advance) gets its row on the first look (`at` = the world's creation, `month` frozen), so a tick's events in the first advance never match it. `today.onTick` writes one `today_days` row on the first tick of each advance (`month === startMonth + 1`, inside the advance's transaction) and only moves its `month` and `at` on at the later ticks of the same advance, so a 12-month advance is one day and `at` is the time of its last tick. No per-student work runs on the advance path.
- **Per-student day, caught up lazily** (`ensureDay`): the first time the student's card is read after an advance (`/api/me`, `GET /api/today/state`), or a listener or the bots' `simulate` touches them, the open errands of the last day they were caught up to whose `done` is a fact get their last check (they count for that day, however many class days later the student looks), every other open errand expires, the streak is reset if the last day done is before yesterday, energy refills to the class cap, and three errands are chosen and stored. Idempotent per day. This is how "fact check at the next advance" and "expire at the next advance" are realised.
- **Facts:** a read-only `todayFacts({ playerId })` service in jobs (`hasJob`, `promotionEligible`, `applicationPending`, `monthsInStep`), savings (`idleChequingCents` = the chequing balance, `hisaCents`, `gicCount`, `netWorthCents`), credit (`hasCard`, `inquiries`, `minimumDueCents`), exchange (`holdings` from `exchange_valued`, `tfsaContributedCents`) and housing (`owns`). **Bills has no service**, so `today` reads `bills_due` and `bills_settings` itself, read-only (`bills.dueCount`, `dueCents`, `overdueCount`, `autopay`). A module that is not loaded gives no facts, so its templates never hold.
- **Errands:** 19 templates in `modules/today/errands.json` (housekeeping 6, panel tours 8, do-something-useful 5; stage errands wait for 5b). Each has `module` (the building's owner: a template whose module is not loaded is never offered) and an optional `alone` (used by "Pick a job": while it is a candidate it is the only errand, the jobless nudge). `done` is exactly one of `{ facts }`, `{ event }` (`module.bills.paid`, or `ledger.posted` with `kind` and optional `into` account kind) or `{ visit }` (a building key). Validated at boot (a bad template fails boot naming it); ops `== != < <= > >=`, no eval. Selection: candidates whose `when` holds, minus templates done in the last 3 days, minus templates whose `done` facts already hold (no free reward); lower `priority` first, then the HMAC-SHA256 of `worldId:playerId:dayNo:templateId` keyed by the world's `today_secrets` row; three taken.
- **Completion:** events (listeners built from the catalogue; a module event whose `month` is not the day's month came from a tick and is ignored; a `ledger.posted` must have the student as `actor` and be newer than the day's start), facts (checked at each card read and at the catch-up), visits (`POST /api/today/visit`, sent by the card's "Go" button before it opens the building: honour-based, opening it counts; only stored when an open errand or today's quest asks for that building).
- **Rewards:** `round(reward_cents x price index)`, capped by `options.today.maxRewardCents` (hard ceiling 500), minted into chequing as `today.errand`; quests pay their fixed `reward_cents` (cap `maxQuestRewardCents`, ceiling 1,000) as `today.quest`. No randomness: amounts are fixed, the draw is the HMAC.
- **Energy and streak:** per class `today_class.energy_cap` (default `options.today.energyCap`, else 10; teacher sets 0-20), refilled at each day's catch-up, raised by completions up to the cap, never banked; display only. Streak = consecutive days (advances) with at least one errand or quest done; a no-school gap has no advance, so it cannot break it. Cosmetic rewards at 5/10/20 are a `TODO(grantItem)` in `credit()` (not called).
- **Digest:** at read time, the student's entries (all their accounts except `payable`, so paying a bill shows once) with `created` after the previous day's `at` (day n−1; day 0 = the world's creation), summed by `txns.kind` and grouped: starting money (`bank-basic.welcome`), pay (`jobs.*`), bills/rent/card (`bills.*`, `housing.*`, `insurance.*`, `credit.*`), interest and dividends, errands and quests (`today.*`), other. Plus bills now due (`bills_due` unpaid) and HISA and net worth (savings' facts), which is how "net worth and HISA on the home screen" landed: inside the card.
- **Lesson quests:** `POST /api/today/quest` (world teacher only), body = the quest file `{ id, date, title, brief, tasks: [{ kind, check }], justify, reward_cents, energy }`; every field validated (1-5 tasks; `check` per kind: `moved_to_account` hisa/gic/tfsa/rrsp/invest, `opened_registered_account` tfsa/rrsp/none, `bought_security` a ticker/none, `read_panel` a building key, `paid_bill` none), re-pushing a date replaces it. The quest whose `date` is today's Edmonton date (`k.clock.today()`) shows. Tasks are judged from the student's own actions (txn `actor` = the student) since the day began, or today's visits: `paid_bill` a `bills.payment`; `moved_to_account` a positive entry into that account kind; `opened_registered_account` a contribution into a TFSA/RRSP today (an account that already holds money does not count); `bought_security` a market buy (`exchange.buy`) or a limit buy placed (`exchange.hold`) today, so a limit order filled in a tick (actor system) counts only if the student also acted that day. `justify: true`: after the tasks, `POST /api/today/answer { id, answer }` (20-500 characters, control characters stripped) finishes it; the answer is visible only to the student's own teachers (`GET /api/today/teach`, policy `class.read`).
- **Teacher panel "Today":** push a quest (paste or choose the file), the quest list, per-class energy cap (`POST /api/today/cap`, `class.manage`), per student today's quest (done / not yet), errands done today, errands done, streak and errand cash, and every quest completion with its answer (or "no answer needed").
- **Bots:** `simulate` catches each bot up, completes each open errand with probability 40% (`k.dice`) and today's quest with 50%. The sim prints lifetime errand + quest cash as a share of lifetime net pay and exits 1 at 1% or more; `CARRIED` checks no errands or days carry into a new world.

**Deviations from the spec**

- The quest route is `POST /api/today/quest`, not `/api/teach/today/quest`: module routes mount at `/api/<id>` and `teach` is reserved by core.
- Per-student work is lazy (first look after the advance), not in the advance's per-student loop: month300 was already 875 ms of its 1,000 ms budget, and five service calls per student per advance would not fit. Consequences: a student who never opens the app has no errands that day (nothing to expire); the fact check "at the next advance" sees the facts as of the student's first look after it (after the advance's ticks), so a fact a tick can undo should not be a `done` fact (the shipped ones are not); and `/api/me` can post a reward (inside `k.db.txn`). `/api/me` builds the cards before it reads the balances, so the response that pays a reward already shows it (`test/jobs.test.js`'s exact chequing check now adds the student's `today.*` cash).
- Rank change is omitted from the digest: leaderboards has no service, and this wave does not touch leaderboards.
- No profanity blocklist exists in the codebase, so quest answers get length checks only.
- **Not built, deferred:** per-class errand categories on/off and "who is stuck" (both in "Teacher (5a)" above); Slide Studio's "World quest" → quest file (another repo).
- **Known gaps:** on phones the chequing balance hero still sits above the Today card (the spec wants the card first under the header); the mascot is still hidden under 720 px rather than shown smaller (`theme.css`); the streak cosmetics at 5/10/20 are a `TODO(grantItem)` in `credit()` (Outfitters `grantItem` is now on main, not called yet).
- `today_visits (player_id, world_id, day_no, building)` and `today_class (class_id, energy_cap)` are extra tables; `today_quest_done` also keeps `reward_cents` and `created`; `today_errands` keeps `txn_id`.
- `todayFacts` takes `{ playerId }` (services take one args object), and today prefixes each name with the module id.
- A course that disables a fact module while another course enables it still gets that module's facts (`k.modules.has` is per deployment, not per course). Both courses enable the same modules today.

**Results** (fix round 1, on the merged tree with main's autopay-on default and Outfitters `grantItem`)

- `npm test`: 436 tests, three runs in a row on the final commit, all green (113 / 120 / 122 s), nothing else running.
- New tests in `test/today.test.js` (13): deterministic selection and the jobless rule; one day per 12-month advance; completion by `module.bills.paid` (Pay all); fact completion with a balanced fixed reward; event completion + fact at the next advance + expiry + streak reset; a fact errand done on day 1, day 2 skipped, first look on day 3 (done for day 1, paid once, streak 0); a new student on the real default (autopay on) gets a valid card and is never offered "Turn on autopay"; quest tasks need the student's own action today (an existing TFSA and a system-actor limit fill do not count); the streak over a 16-day no-school gap; reward index and cap; the digest against the ledger and the pay stub; today off for a course; quest validation, permissions, answers and teacher B isolation. `world()` there sets `autopay = 0` for its new students when bills is loaded (as `helpers.js` `manualBills` does). Plus `test/modules.test.js` "homeCards: ...".
- Existing tests changed: `test/db.test.js` module order (leaderboards last of the modules that tick, today last overall); `test/session-security.test.js` B13 (`classesFor(user)` uses 11 → 12); `test/economy.test.js` asserts errand cash < 1% of pay; `test/jobs.test.js` "jobs over HTTP": the chequing balance on `/api/me` after the first payday was `50000 + net`, now `50000 + net + the student's today.* cash`, because `/api/me` now reads balances after the cards and that same request pays "Pick a job" ($2.00).
- `npm run sim -- --months=60`: audit OK in all 61 rows; bills/pay 69/63/60/59/57%, Gini 0.314/0.341/0.321/0.326/0.326 at months 12-60, homeowners 31% at 60. Today: 60 days, 24,749 errands done, errand + quest cash $17,427.80 = **0.039%** of lifetime net pay ($44.4M).
- `npm run sim -- --months=60 --teacher` (before fix round 1): audit OK in all 61 rows, Gini ≤ 0.337, homeowners 31%, season close + new world clean, errand cash 0.040%.
- `node scripts/perf.mjs payday=500 month300=1000`: payday 337 ms, month300 487 ms (exit 0). Payday varies run to run on this machine (129-337 ms in five runs; it is the jobs hook, which today does not touch). Earlier same-machine comparison with the base commit: month300 527 / 506 ms base vs 527 / 498 ms branch.
- Browser checks (local dev server on a scratch data dir, demo seed): the student card at 375 px above the doors, "Go" opens the Job Centre and the errand shows done on return; the "Go" buttons are named "Go: <title>"; the digest shows "Starting money"; the teacher panel renders with no console (CSP) errors, the quest file box styled, and a non-justify quest's completion listed ("Done (no answer needed)") with "Today's quest: Done" for that student.

**Not verified:** a real 576-month run (5b's pace plan does not exist yet); the digest's cost at 576 months of history (it scans the student's entries by `entries_account` and filters `created`; fine at 60 months, untested beyond); Slide Studio uploading a real quest file.

---

## 5b. `life`: age, stages, and the stage-paced clock

### Age and stage

Every student in a world shares the world month, so age is a function of it:

```
age(month)  = 22 + floor((month - 1) / 12)
stage(age)  = A if age < 36 ;  B if age < 55 ;  C otherwise
```

Month 1 is age 22. The season is 576 months: **A = months 1-168, B = months 169-396, C = months 397-576.** The world ends at age 70. Stage and age go in the header ("Age 31 · Stage A") through the `badges` hook.

Per course, `config/vdaa.json` can set `life: { start_age, stages }`. FinTech 10 can run Stage A only (or A and a short B) while FinTech 20/30 runs the full life, with the same code.

### The stage-paced clock

Months per class day follow a **pace plan**, a list of `{ from_month, months_per_day }`. Defaults, to fit 94 class days:

| Months | Age | Stage | Months/day | Class days |
|---|---|---|---|---|
| 1-24 | 22-23 | A, early career | 1 | 24 |
| 25-168 | 24-35 | A, rest | 4 | 36 |
| 169-396 | 36-54 | B | 12 | 19 |
| 397-576 | 55-69 | C | 12 | 15 |
| | | | | **94** |

Why these: Stage A is where the course spends its time, and the first two years hold the tuned 12-month mechanics (first raise, first card, GIC 12, autopay lesson) at today's pace, one month a day. After that a day is a third of a year, then a whole year. Segment lengths are multiples of the pace so an advance never straddles a boundary.

- **Mechanism, one small core edit:** `k.world` exposes only `current`, `priceIndex` and `active` (`lib/kernel.js:112-116`), so a module cannot change the pace today. 5b adds one facade method, `k.world.setPace({ months_per_day, auto_advance })`, a thin wrapper over `world.setSettings` (`lib/world.js:84`), granted only to modules that declare `life`'s need in `options`. `life` listens to `world.month`, and **only when the new month is a segment boundary** (months 1, 25, 169, 397) calls `setPace({ months_per_day })`. Passing only `months_per_day` leaves `auto_stopped` alone (the setter clears it only when `auto_advance` is passed, `lib/world.js:95`), so a stop caused by a skipped student is not silently re-armed. Auto-advance then uses the new value. A teacher "pace lock" switch stops `life` from changing the setting.
- **The end of the life:** `season_end` is a calendar date, and nothing stops the advance at month 576. At the plan's last month `life` calls `setPace({ auto_advance: 'manual' })` (an acknowledged, intentional stop) and the Today card says "Life Review ready"; the teacher closes the season as today.
- **The class-day budget is the teacher's number.** A calculator in the console takes "class days left in the season" and the plan, and shows how many days each stage gets. An `npm run life-pace -- --days=85` script prints the same table. Real class days are fewer than the calendar (the EPSB no-school list already feeds the clock). The plan is editable per world.
- **Stage transitions** emit `life.stage` and are tick-safe: `life.onTick` runs per student inside the existing savepoints.
- **Time-based rules re-read at 12 per day.** GIC 12 and the annual raise now mature in one day; the promotion year is one day. This is the cost of decision 1 and is intentional. Multi-month advances already judge lateness only up to `startMonth` (`docs/modules.md` §5), so nobody is penalised for months they did not play; the digest tells them what happened.

### Retirement

- In Stage B the student can open Life → "Retirement plan" and set a **retirement age 60-70** (default 65). An errand prompts it at age 55. It can be changed until they reach it.
- **Work stops at the retirement age:** the job ends at the next payday after the student reaches it; the catalogue wage stops; the pay stub says so. `jobs` declares no services on main, and the `endHolding` the Phase 4 spec names lives only on the unmerged `p4b-ventures` branch, so 5b adds `jobs.endHolding(k, { playerId, reason })` itself (if 4b has merged by then, it reuses that one). Between 55 and the retirement age they keep working.
- Income after that comes from 5c.

### Stage events

Reuse the existing teacher levers, scheduled: a **crash** in a set world year (the brief's "15% fall in year 5" becomes "a market crash at age 48"), a **rate shock**, a **housing shock**. Each is one config row with a month and a headline; the teacher can move or skip it. This is the Phase 3 crash row, lived.

### Life Review

The season-close Life Review (`leaderboards.js:65-75`) extends with: net worth at 35, 55 and 70; allocation pies at 25 and 65 (from the exchange holdings at those months); years of retirement funded (5c); best and worst month. The Dashboard pies the project asks for are the same data.

### Data (5b)

| Table | Columns |
|---|---|
| `life_state` | player_id, world_id, retire_age, cpp_start_age, oas_start_age |
| `life_pace` | world_id, plan JSON, locked INTEGER |
| `life_snapshots` | player_id, world_id, age, net_worth_cents, allocation JSON |

### Open items (5b), to settle in the build

- **Wolf rank cutoffs** (`leaderboards/constants.js:7`, scaled by the price index) were tuned for ~100 months. Re-tune over 576-month sims, or rank against a stage benchmark ("net worth for your age").
- **Yearly limits** that are fixed today (TFSA $7,000/year, RRSP cap $33,810) need indexing over decades. Decide: index by the price index, or keep fixed to teach that limits are indexed in reality (the real TFSA limit is indexed).
- **Promotions** need a teacher decision today. Over 48 years that is too many. Default: the first promotion in each career needs approval; later steps are automatic after the reflection.
- **Mortgage payoff:** confirm `housing` handles a 25-year mortgage paying to zero and a second purchase (Stage B family home).
- **Perf and ledger growth** at 576 months: re-run `scripts/perf.mjs` and the statement cache.

### Gates (5b)

Tests: age/stage at every boundary month; the pace plan never straddles a segment; work stops at retirement and not before; a pace lock holds; stage events fire once; FT10 runs Stage A only. Sim: `--months=576`, audit OK every month; economy guard at each stage.

### As built (5b)

*Branch `p5b-life`, 2026-10-29, cut from main @ `v11-today`. The dependent changes (exchange/rates/housing stage-event services, limit indexing, auto-promotion, Wolf retune, the Amphitheatre Life Review card, mortgage payoff, the 576-month sim and perf work) are a second branch, `p5b-deps`, not in this one.*

**What shipped**

- `modules/life` (id `life`, requires `bank-basic`), enabled for both courses, after `leaderboards` and before `today` (`test/db.test.js` order assertion: `ticking` now leaves out `today` and `life`, and `life` must sit right after the rest). Building "Life" (inline hourglass SVG), teacher panel "Life".
- **Age and stage** (`modules/life/stages.js`, pure): `ageAt(month) = startAge + floor((month - 1) / 12)`, stage A below 36, B below 55, else C. A = months 1-168, B = 169-396, C = 397-576. Header chip `Age 31 · Stage A` through `badges`, plus `Life Review ready` once the world reaches month 577.
- **The end of the life is month 577** (the first month at age 70), not 576. The life is months 1-576 (ages 22-69); the world starts at month 1 and every advance moves it by its pace, so with the default plan the 94th class day goes 565 -> 577 and month 576 is never the world's month. Measured the other way the default plan would fail its own check (397..576 is 179 months, not a multiple of 12). So a segment's length is `next from_month - from_month`, the last one ending at 577 (`endMonth()`), and every valid plan lands the world exactly on 577.
- **Stage-paced clock, the one core edit:** a module field `needs: ['world.setPace']` (validated: that is the only power; anything else fails boot) and `k.world.setPace({ months_per_day, auto_advance })` on that module's `k` only (`lib/kernel.js`, `lib/modules.js`), a wrapper over `world.setSettings` with actor `system:life` and only those two keys. `options` was not used for this: it declares config keys, not powers. Passing only `months_per_day` leaves `auto_stopped` alone (setSettings clears it only when `auto_advance` is passed; tested).
- **Pace plan** per world (`life_pace`: plan JSON, locked), seeded from `options.life.plan` (checked; a bad one logs and falls back) or the default `[1:1, 25:4, 169:12, 397:12]`. Checks: a list of 1-24 `{ from_month, months_per_day }`, first at month 1, strictly increasing, before 577, pace 1..12, each segment a multiple of its pace. `life` listens to `world.created` and `world.month` (after commit) and calls `setPace({ months_per_day })` **only when the advance crossed a plan boundary** (`from < from_month <= month`, the segment the world is now in), and only if the world is not already at that pace, so a new world writes no setting. Crossing, not equality: an odd manual advance (24 -> 27) still applies the new segment instead of skipping it for good. The teacher's own pace holds until the next boundary; the **pace lock** stops `life` changing it at all. When an advance crosses the end (577), `life` sets `auto_advance: 'manual'` once (an acknowledged stop: `auto_stopped` is cleared), even when the pace is locked; and `onTick` refuses any month past 577 (the advance rolls back with "The life ended at age 70 ... Close the season"; it reads as a 500 naming the module, the existing failure path).
- **Retirement:** Life → "Retirement plan" in Stage B and C. `POST /api/life/retire { retire_age }`: 400 outside 60-70 or below the student's age now, 409 in Stage A and once they reached the age already chosen (default 65 when none is chosen). `life_state (player_id, world_id, retire_age, cpp_start_age, oas_start_age)` gets a row only when an age is chosen (cpp/oas unused until 5c).
- **Work stops at the retirement age:** `life` listens to `module.jobs.paid` (inside the payday, in jobs' per-student savepoint). It returns at once below age 60; from 60, one primary-key read, and when the student's age has reached their retirement age it calls the new `jobs.endHolding({ playerId, reason })`. So the payday of the first month at that age is the last pay, its stub's note says "You reached your retirement age (N): this is your last pay. Work stops here.", and no pay follows. `endHolding` is jobs' `leave()` (so `jobs_past` and the rejoin-within-12-months wage rule hold), plus the reason on this month's stub, an audit row and `module.jobs.assigned`; idempotent (a student with no job gets `ended: false`), plain JSON `{ playerId, ended, jobId, month, reason }`. With `jobs` not loaded the listener never fires.
- **Stage events:** `options.life.events` (or the defaults: a rate shock to 6% at month 241 / age 42, a housing shock of -15% at 289 / 46, a market crash at 337 / 50) are copied into `life_events` per world the first time `life` sees it (an event already in the past then is marked "already past when life began", never fired late). In the tick of its month (`fired_month IS NULL AND skip = 0 AND month <= month`) each fires once through `callIf(k, module, service, args)`: `exchange.stageEvent({ kind: 'crash', headline })`, `rates.queueRate({ rate_bp })`, `housing.marketEvent({ pct })`. `callIf` returns `{ ok: false }` and logs once when the module is not loaded or has no such service (any other error is the service's own); the row then records "<module>.<service> not available". A service that throws fails the advance (a module-wide step, by the contract); the teacher can skip the event and advance again. The teacher moves (to a later month) or skips an event before it fires.
- **Life Review snapshots:** `life_snapshots (player_id, world_id, age, month, net_worth_cents, allocation JSON)` at ages 25, 35, 55, 65 and 70: in each tick, the age window the month is in (25-34 -> 25, ..., 70) gets a row for every student who has none yet, in `k.forEachPlayer`. Net worth is `savings.todayFacts().netWorthCents` (ledger balances + the latest home and holdings values: the same sum leaderboards' tick and season close's ledger + `seasonAssets` use), or the ledger sum without savings. Allocation is `callIf('exchange', 'allocation', { playerId })` when it returns an object, else `{}`. Service `life.snapshots({ playerId })` -> `[{ age, stage, net_worth_cents, allocation }]` in the current world, for leaderboards' Life Review card (other branch).
- **Today:** `life.todayFacts` (`stage` 1/2/3, `age`, `retireSet`, `yearsToRetire`), `'life'` added to today's `FACT_MODULES` (the only way facts reach it), and one errand, "Set your retirement age" (`life.stage >= 2`, `life.retireSet == false`; done by the fact `retireSet == true`, which never flips back). Today's own `stage` key compares letters with `facts['life.stage']`, a number, so it never matches; the errand uses `when` instead.
- **Teacher panel "Life":** month, age, stage, pace and auto-advance; the pace plan (table, JSON edit, lock switch: world teacher only, `world.settings`); the class-day calculator ("Class days left", prefilled from the school days between today and `season_end` on the world's no-school list from `/api/teach/state`, computed in the browser: `k.clock` has no school-day rule); per segment its months, ages, stages, pace, class days and the days still needed from the current month (the current segment at the world's own months per day; every segment at it when locked), the total, and "fits / short by N"; the stage events with move and skip; each of the teacher's own students' retirement ages (`k.players.classesFor(user)`, so teacher B sees only theirs). Routes: `GET /api/life/teach[?days=N]`, `POST /api/life/plan`, `/lock`, `/event` (world teacher), `GET /api/life/state`, `POST /api/life/retire` (student). `npm run life-pace -- --days=85 [--plan=<json>] [--month=M] [--start-age=A]` prints the same table (exit 1 on a bad plan).
- **Bots:** `simulate` gives each bot a retirement age 60-70 (`60 + k.dice(id, 0, 11) % 11`) once it is in Stage B, and from 60 ends the job of every retired bot before the advance (jobs' `simulate` hands every jobless bot a job each month, so without this a retired bot would be re-hired and paid once a month).
- **Per-student work:** snapshots in `k.forEachPlayer` in the tick; retirement inside jobs' own per-student savepoint (the payday listener); `life_state` lazy (only when an age is chosen). Nothing else per student runs on the advance path.
- **Seasons:** every `life_*` table is keyed by `world_id`, so nothing carries (tested: close, new world, no rows; a fresh plan from the config).

**Deviations from the spec**

- **FT10 cannot run "Stage A only":** fintech10 and fintech2030 share one world (one current world, one month, one clock), so per-course stages or pace are not possible; both courses get the full life. Also `k.config` is `options.life`, deployment-wide (a module cannot read `config.courses`), so `start_age` and the plan are per deployment (`options.life.startAge`, `options.life.plan`), not per course.
- The end is month 577 (age 70), not 576 (above). The spec's "Today card says Life Review ready" is the header chip and the Life panel; the Today card is unchanged.
- An errand prompts the retirement age from Stage B (age 36, the brief), not at 55 (the spec).
- `module.life.stage` is emitted once per world at each stage change (inside the tick), not per student: everyone shares the month.
- The sim's `CARRIED` check is not extended: `scripts/sim.mjs` belongs to the other branch. Lines for it: `life: [['retirement ages', 'SELECT COUNT(*) AS n FROM life_state WHERE world_id = ?'], ['snapshots', 'SELECT COUNT(*) AS n FROM life_snapshots WHERE world_id = ?'], ['fired events', 'SELECT COUNT(*) AS n FROM life_events WHERE world_id = ? AND fired_month IS NOT NULL']]`.

**Known gaps**

- **A retired student can pick a job again** at the Job Centre and is paid once (that payday ends it again). Closing it needs a check in jobs' `/pick` (`k.modules.has('life') && k.modules.call('life', 'retired', { playerId }).retired` -> 409); the `retired` service is there for it, the jobs edit is not in this branch.
- **Allocation is `{}`** until the exchange exposes `allocation({ playerId })` returning a plain object by asset class (e.g. `{ cash, stocks, bonds, funds }` in cents); `life` stores whatever object it returns.
- A plan edit applies at the next boundary the world crosses, not at once.
- Snapshot catch-up: a student who joins late, or a world `life` first sees late, gets the current window's snapshot at its first tick (e.g. "35" taken at 40), not the missed earlier ones.
- The stop past 577 is a refused tick (500), not a friendlier 409 from the advance route.

**Results**

- `npm test`: 452 tests (436 + 15 in `test/life.test.js` + 1 in `test/today.test.js`), three runs in a row on the final tree, all green (131 / 116 / 115 s), no sim running.
- New tests (`test/life.test.js`): age and stage at every boundary month (1, 12, 13, 24, 25, 168, 169, 396, 397, 576, 577); plan validation (multiples, pace 1..12, start at 1, increasing, before 577, types); the class-day calculator by hand (94 = 24 + 36 + 19 + 15; from month 30 at 4 a day: 35 + 19 + 15; locked at 2 a day: 288); `setPace` only on life's `k`, `months_per_day` alone keeps `auto_stopped`, `auto_advance` clears it; pace set only when an advance crosses a boundary, the teacher's own pace holds in between, the lock holds; auto-advance (fake clock, `autoAdvance()`) 565 -> 577 then manual, the chips, an advance past 577 refused; retirement-age validation and change-until-reached; work stops at the retirement payday and not before (stub note, no pay after, `jobs_past`, `endHolding` idempotent, rejoin keeps the wage); stage events with fake exchange/rates/housing modules (fire once, skip holds, move, un-skip fires once) and with the services absent; snapshots once per age with savings' net worth, allocation from a fake exchange; bots' retirement ages; teacher panel permissions and teacher B isolation over HTTP; season close leaves no life rows; life switched off. Plus the today errand test and two `needs` rows in the shape table.
- Existing tests changed: `test/db.test.js` (module order), `test/session-security.test.js` B13 (12 -> 13 `classesFor(user)` uses), `test/fuzz-common.js` (the life body fields).
- `npm run sim -- --months=60`: audit OK in all 61 rows; bills/pay 69/63/60/59/57%, Gini 0.307-0.333, homeowners 32% at 60; errand cash 0.039% of pay. `--teacher`: audit OK in all 61 rows, Gini 0.317 at the end, season close + new world "starts clean". (Retirement and stage events do not reach month 60.)
- `node scripts/perf.mjs payday=500 month300=1000`: three runs payday 366-426 ms, month300 581-621 ms (exit 0). The same machine with `life` taken out of the config: payday 394-449, month300 535-573. The load average was 4-5 (other branches' sims running), so the gap is within noise; life's tick at month ~10 is three reads.
- `npm run sim -- --months=576` (this branch, before p5b-deps): exit 0, **audit OK in all 577 rows**, 91 minutes wall (5,453 s) while another 576-month sim ran on the same machine. Gini 0.24 at 168, 0.20 at 396, 0.21 at 577; errand cash 0.033% of lifetime pay. **The economy guard does not hold past the first years:** bills/pay falls to 41% at 168, 35% at 396 and 34-38% in Stage C (guard 50-75%), and 178 of 300 bots (59%) own a home at 577 (guard 20-50%). Both drift long before anyone retires (wages with yearly raises outgrow bills), so they are the 576-month tuning that p5b-deps owns, not a life effect. The sim's own tables only report up to month 60.

---

## 5c. Stage C: retirement income and decumulation

### Income streams

Real Canadian rules, taught as the rules. Every constant has a source and is marked ILLUSTRATIVE if its page cannot be read when built (canada.ca CPP and OAS pages, CRA RRIF page).

- **CPP.** Starts at an age the student chooses, 60-70 (default 65).
  - Reduced 0.6% per month before 65 (36% at 60); increased 0.7% per month after 65 (42% at 70).
  - The amount at 65 comes from the student's own CPP contributions in the game: career-average pensionable earnings against the maximum, scaled by years contributed out of 39, up to the maximum (about $1,500 a month in 2026; confirm). The pay stub already withholds CPP, so the number is theirs.
- **OAS.** Starts at 65, deferrable to 70 (+0.6% per month, up to 36%). About $740 a month at 65 (confirm). Recovery tax (clawback) above the income threshold (about $93,000; confirm).
- **RRSP → RRIF.** Converting is optional before 71. The minimum withdrawal is 1/(90 − age) of the balance for ages under 71, then the CRA table; the full RRIF withdrawal is taxable income with the withholding the exchange already applies (`exchange` RRSP withdrawal rules: 10/20/30%).
- **TFSA withdrawals** are not taxed. **HISA, GIC and non-registered** work as today.
- **Tax in retirement:** the existing `annualIncomeTax` (jobs/payroll.js) runs on retirement income, so a RRIF draw, CPP and OAS are taxed through the same T1 path. Pension income credit and age credit are out of scope for 5c (listed, not built).

### The withdrawal plan

A Life → "Retirement income" panel: the student sets a monthly amount to draw and the order of accounts (default: TFSA last). A plan is a standing instruction paid at each payday (kind `life.draw`), like autopay, and it is changed with an errand-prompted review each class day in Stage C.

### The live check

Each month in Stage C (and a projection from 50 on), the panel shows **retirement income vs bills**, with bills inflated by the price index:

- *Income:* CPP + OAS + draws + any pension, net of tax.
- *Bills:* the student's actual Bills line this month.
- *Verdict:* covered / short by $X, and **"your savings last until age N"** from a deterministic projection of the plan (current balances, plan draws, 2.1% inflation, the account's own rate; no random markets). This is the question the Wealth Architect's Stage C income check (C20, C22) asks, answered with their own money.

If chequing cannot cover a bill the existing late/arrears rules apply unchanged. Nothing new is fatal.

### Health and awards

The Health score swaps "debt load" for **"retirement coverage"** in Stage C (income ÷ bills, capped). New award: **Best Retirement** (highest coverage at the end, class medians as for Top Pack). Both go through the existing `badges` and `seasonClose` hooks.

### Data (5c)

| Table | Columns |
|---|---|
| `life_draw_plan` | player_id, world_id, monthly_cents, order JSON, rrif INTEGER |
| `life_income` | player_id, world_id, month, cpp_cents, oas_cents, draw_cents, tax_cents |

### Gates (5c)

Tests: CPP early/late factors; OAS deferral; RRIF minimum at ages; draw plan order and shortfall; the tax path (CPP and RRIF taxable, TFSA not); the projection is deterministic; retirement before 60 is refused; the ledger stays balanced. Sim: bots retire at 65 with a plan; share of bots covered, share of savings exhausted before 70, Gini at 70. Tune so a diligent student is covered and a student who never saved is visibly short.

---

## 5d. `school`: education tiers and student debt

### Careers by tier

| Tier | Program | Months | Pay while studying | Typical student debt (ILLUSTRATIVE) |
|---|---|---|---|---|
| Entry | none | 0 | full | none |
| Apprenticeship | work-based | 24 | reduced hours, apprentice wage | small, from pay |
| Diploma | college | 24 | part-time | about $20,000 |
| Degree | university | 48 | part-time | about $40,000 |

- The catalogue grows from 12 hourly jobs to the **brief's 12 careers**, mixing trades, diplomas and degrees so debt and starting pay vary (Life Cycle project, Phase 1). **Input needed from Mr. Tang:** the career list lives in the project's Google Doc and is not in the repo; export it, or list the 12. Wages come from ALIS (cited, dated), and net pay from the same T4127 path.
- Existing jobs map to the entry tier. A career has its own ladder of 2-5 steps (more than today's 1-3, so Stage B has somewhere to go), and the `jobs_past` rule (rejoin the same job within 12 months and keep wage and clocks) stays.
- **Career change in mid-life** (Stage B) is allowed through School: retrain for a new tier, with the same debt and part-time rules.

### The School door

A building in the Archive zone: browse programs, see cost and expected starting pay and the break-even age, enrol. While enrolled the student works part-time (the jobs module pays reduced hours) and Bills adds tuition and books per term. Completing the program unlocks the career. Dropping out keeps the debt and gives nothing: a real lesson, with a clear warning on the enrol screen.

### The student loan

- A liability account (`school.loan`, owner player). Advances cover tuition up to a program limit; they credit chequing and add to the loan.
- **Terms** from Canada Student Financial Assistance and Alberta Student Aid, cited at build time: a grace period after the program ends, then monthly payments through Bills (kind `school.loan.payment`) over a fixed term; the federal portion's interest treatment and the Alberta portion's rate are to be read from the sources (the federal portion has charged no interest since April 2023; verify). ILLUSTRATIVE until read.
- Counts in net worth as a debt. Counts in the credit score and the health board's debt-load part. Missing a payment follows the same late-fee and late-mark rules as other bills.
- A **repayment calculator** and a "break-even" view: when does the higher pay beat the debt?

### Data (5d)

| Table | Columns |
|---|---|
| `school_programs` | id, tier, name, months, tuition_cents, loan_limit_cents, career_id (catalogue) |
| `school_enrol` | player_id, world_id, program_id, start_month, end_month, status (studying/done/dropped), hours_pct |
| `school_loans` | player_id, world_id, principal_cents, rate_bp, grace_until, payment_cents |

### Gates (5d)

Tests: enrol and complete; part-time pay while studying; loan advance and amortisation; grace; drop-out keeps the debt; the credit score hears a missed payment; career change in Stage B; ledger balanced; FT10 can disable the module. Sim: bots choose tiers by a mix; report median starting pay, median debt, break-even month, and the Gini at months 60, 168, 396, 576. The guard must hold: students who take the degree path should not be crushed or dominant.

---

## 5e. `town`: districts, locks, explorations

### Districts

PLAN.md:29 named them: Payday Square, Credit Quarter, Harbour Exchange, Venture Row, Tax Keep. The existing buildings group into them (a catalogue in `config`, e.g. Payday Square = Bank, Job Centre, Bills; Credit Quarter = Credit Bureau, Insurance, Housing; Harbour Exchange = Exchange, Net Worth; and so on). The layout is a config row, not a code change.

- **Who opens them:** the teacher (per class, in the console) or an automatic schedule by world month or unit. **Default is everything open**, so existing worlds are unchanged. A course config can declare a plan.
- A closed district shows its doors dimmed with a reason: "Opens in Unit 3" or "Your teacher opens this soon". Never a timer.

### Gates inside a district

A module declares **features** that can be gated: `exchange.stocks`, `exchange.limit-orders`, `housing.buy`, `credit.card`, and so on. A gate's unlock is one of:

- a **stage** (`{ stage: 'B' }`),
- an **exploration** completed (`{ exploration: 'harbour-tour' }`),
- an **errand chain** (`{ errands: 'savings-basics', count: 3 }`).

Modules ask `k.modules.call('town', 'isOpen', { player, feature })`; with `town` disabled the answer is always open. **A feature a course outcome needs may not be gated** (a list in `docs/phase5-life.md`'s own appendix, kept next to the course outcomes). A teacher can open any gate for a class.

### Explorations

Optional side visits inside a district, each costing 1-3 energy, done once per player:

- a **market tour** at the Exchange that tells a stock's story and unlocks its chart history;
- a **training course** at the Job Centre (one extra part-time shift's pay, once);
- a **codex** entry per district (what a real Edmonton place does, the rule behind a building);
- a **neighbour visit**: a short, scripted NPC scenario with one choice (feeds the dilemma cards later).

Content: about 3 per district at launch, written in a batch at build time (no model calls at runtime) and reviewed by Mr. Tang. Each is a row in `town_explorations`: id, district, title, cost, body, unlock, reward (cash cap, item, codex). The Agora art needs the Indigenous education lead's review before any Agora-scene exploration is shown.

### Data (5e)

| Table | Columns |
|---|---|
| `town_districts` | id, name, buildings JSON, rule JSON (default open) |
| `town_class_open` | class_id, district_id, open |
| `town_explored` | player_id, world_id, exploration_id, done_month |
| `town_gates` | feature, unlock JSON (catalogue) |

### Gates (5e)

Tests: default open leaves today's behaviour; a closed district blocks its routes with a clear message; a stage gate opens at the boundary; an exploration costs energy and unlocks once; a teacher override opens a gate; the outcome list cannot be gated (a test fails if an outcome feature has a gate). Sim: no effect on the economy.

---

## Cross-cutting

### Economy guard at 576 months

Run the 60-month sims and the new `--months=576` sims on the same guard: Gini < 0.40, bills/pay 50-75%, homeowners 20-50%, errand cash < 1% of lifetime pay, and new for Phase 5: by Stage C, **at least 60% of diligent bots are covered** and **fewer than 15% of never-saved bots are**. A stage that fails its sim does not ship.

### Teacher workload

- Quests come from the outline, not hand-built.
- The pace plan and districts have defaults; nothing needs setup.
- Promotions beyond the first are automatic (open item, 5b).
- Console panels: Today (quests and answers), Life (pace plan, stage view, who is short in Stage C), Town (districts, gates, override).

### Privacy and safety

No new personal data. Quest answers and errand history are visible to the student's teacher only; classmates see boards and the Hall of Fame as today (pseudonyms; display name added in 5a). No AI call at runtime. No chat.

### Performance

Re-run `scripts/perf.mjs` (payday 500, month300 1000) with 576 months of history per student; the digest sums `entries` by `created` window on the student's accounts (index `entries_account`), checked in the perf run. The existing per-student savepoints and statement cache stay.

### Docs, tests, tags

Each wave updates this file's "As built" section, adds tests per the gates, and is tagged `v11-today`, `v12-life`, `v13-stage-c`, `v14-school`, `v15-town`. `npm test` runs three times per wave; both sims audit OK.

## Build order and effort

1. **5a today** (smallest, no economy change; ships the daily loop and the small fixes). Slide Studio's "World quest" → quest file is part of this wave.
2. **5b life** (age, stages, pace, retirement, Life Review).
3. **5c Stage C** (CPP, OAS, RRIF, the check).
4. **5d school** (needs the brief's career list from Mr. Tang).
5. **5e town** (districts, gates, explorations).

Venture Row (4a-4c) resumes on its own schedule; the pace plan and the stage rules apply to ventures later (a company's year-end tax is already in world years).

## Inputs needed from Mr. Tang before the waves that need them

| Wave | Input |
|---|---|
| 5a | A sample outline "World quest" section (or approval to design one), and the real class-day count for the semester (for the pace table) |
| 5b | The pace plan's day budget; whether FT10 plays Stage A only |
| 5d | The brief's 12 careers (the Google Doc), and ALIS wage source and date |
| 5e | The district grouping of buildings; which features count as curriculum-required |
| any Agora exploration | The Indigenous education lead's review of the Agora art |

## Not in scope

Marriage, children, health shocks, mortality, taxes beyond the existing T1 path plus retirement income, pension plans from employers, estate planning. Student-to-student trading, chat. Ventures (separate spec), dilemma cards (separate spec; explorations and the neighbour visit are where they will plug in).

## As built (5a small fixes)

- **Autopay on for new players.** `bills` has an `onPlayer` hook: `INSERT OR IGNORE INTO bills_settings (player_id, autopay) VALUES (?, 1)`, inside createStudents' txn. Existing players are not migrated: no row still reads as off, and a row someone chose keeps its value. The bots' 80/20 roll in `simulate` used to fire only when no row existed; migration `010_bot_decided` adds `bills_settings.bot_decided` (default 0), and `simulate` rolls once per bot while it is 0 (then sets it to 1), so bots still split 80% on / 20% off. A bot with a pre-existing row re-rolls once. Tests: `seeded()`/`addClass()` in `test/helpers.js` switch autopay back off for the suite's students unless called with `{ autopay: true }`, since most bills tests were written for hand-paying students.
- **`outfitters` service `grantItem(k, { playerId, itemId })`.** Only the five earned items are grantable (`bomber-750`, `first-keys`, `on-time-watch`, `promoted-blazer`, `emergency-umbrella`). Items for sale have no "grantable" flag, so they are refused (400), and the Wolf outfits are class goals, not items, so they are not grantable either. Unknown player: 404. It goes through the same `unlock()` as the events (row, owned item, `module.outfitters.unlocked`, and the "Unlocked:" banner via `announce`), in the current world (`k.world.active()`). Idempotent: a second call returns the identical `{ playerId, itemId, key, worldId, month }` (the first grant's month), with no second event or row. Callers should check `k.modules.has('outfitters')` first: the module may be enabled for no course, and the call throws then.

## As built (5b deps)

*Branch `p5b-deps`, 2026-10-29: the changes in other modules that the `life` module (built separately, "As built (5b)") calls or relies on. Every one is inert without `life`.*

**Services for `life`** (reachable only through `k.modules.call`, no routes; each reuses the teacher lever's code path, factored out of its route):

| Call | Args | Returns | Notes |
|---|---|---|---|
| `exchange.stageEvent` | `{ kind, ticker?, headline? }` | `{ id, kind, ticker, headline, month, appliesFromMonth, already }` | `kind` one of `crash`, `correction`, `rally` (market) or `scandal`, `boom` (stock: `ticker` must be a town company, else 400). Queued now, applied at the next tick like `POST /api/exchange/event` (`queueEvent`). `headline` (1-120 chars, optional) replaces the template in the news (migration `006_headline`). Idempotent per (world, month, kind): a second call that month returns the queued event with `already: true`. 409 between seasons. |
| `exchange.allocation` | `{ playerId }` | `{ equities, bonds, cash, other }` cents | Read-only. Holdings in the non-registered account, TFSA and RRSP at the bid (the same value as `exchange_valued`); index fund and stocks are equities, the bond fund bonds, the balanced fund (DAAG) splits by its own 60/40 weights; cash = invest + tfsa + rrsp + xhold balances. |
| `rates.queueRate` | `{ rate_bp }` (0-1000) | `{ policy_bp, applies_from_month, cancelled }` | Same as `POST /api/rates/policy` (`queuePolicy`): applies at the next tick; the rate in force cancels a queued change. |
| `housing.marketEvent` | `{ pct }` (±5-15) | `{ pct, homes, month }` | Same as `POST /api/housing/market` (`marketMove`): every owned home moves at once. |

A service call (no teacher) emits `module.rates.pending` and `module.housing.value` **inside the caller's transaction**, not after commit as the routes do: called from `life`'s tick in a 12-month advance, an after-commit "pending" would land after the tick that already applied it and leave a stale pending rate (tested). The teacher routes are unchanged.

**The `snapshots` contract leaderboards reads.** At season close the finale calls `k.modules.call('life', 'snapshots', { playerId, worldId })` for each student and expects `[{ age, net_worth_cents, allocation?: { equities, bonds, cash, other } }]` (cents; one row per age snapshotted; `allocation` shaped like `exchange.allocation`'s answer). It keeps net worth at 25/35/55/65/70 (a missing age is `null`) and the allocation at 25 and 65, frozen in the review as `life: { net_worth: [{ age, net_worth_cents }], allocation: [{ age, parts }] }`. Guarded by `k.modules.has('life')` and a try/catch: no life, a throw, no such service or a non-array answer leaves the review and the card exactly as before. The card shows the ages as facts and each allocation as one stacked bar with the same numbers as text (checked in the browser at desktop and 375 px with a fake `life`).

**Yearly limits indexed** (`exchange`, when `life` and `rates` are both loaded): the TFSA limit for world year Y = 7,000 × the price index at the start of Y, to the nearest $500; the RRSP dollar cap = 33,810 × that index, to the nearest $10. Each year's pair is frozen at the year's first tick in `exchange_limits` (migration `007_limits`; this relies on `rates` ticking before `exchange`, which config order gives today: exchange does not require rates, so a config listing exchange first would freeze each year at the previous year's index), so room carried forward keeps the old years' limits. Year 1, or a year with no row (life switched on mid-season), uses the base figures. `tfsaRoom`/`rrspRoom` take a per-year limit function (a number still works). The panel's TFSA line says the limit rises with prices. Without life: no rows, $7,000 and $33,810 as before.

**Automatic promotions** (`jobs`, option `autoPromote`, default off). On: a student past step 0 on their job's path (their first promotion in that career is done) who is eligible (12 months in the step) and applies with the reflection (10+ characters) is promoted at once: the application is stored `approved` with `auto = 1` (migration `005_auto`), audited as `jobs.auto_promote`, and listed for the teacher (`/api/jobs/overview` → per class `promotions`, the newest 10 approved, each with `auto`; panel "Recent promotions"). The first promotion (step 0 → 1) still waits for the teacher, and a denial's cool-off still applies to it; it does not apply to an automatic step. `decide()` is now a no-op on an application that is no longer pending (the bots' `simulate` would otherwise decide an automatic promotion again). **Not turned on in `config/vdaa.json`.** The life wave adds, under `options`: `"jobs": { "autoPromote": true }`. A step restored by `jobs_past` (back in the same job within 12 months) counts as past the first promotion. It changes the bots too: with it on, `simulate` promotes every eligible bot past step 0 at once (`simApprovePct` only gates first promotions), so pay climbs faster in a life sim; the life wave's economy re-tune should expect that.

**Wolf rank cutoffs** (`leaderboards`, when `life` is loaded): the cutoffs (× price index) are also × a stage factor: **A ×1, B ×21, C ×25** (`STAGE_FACTORS`, stage from the world month: A ≤ 168, B ≤ 396, C after; it ignores a per-course `start_age`). A stays ×1 so a Stage-A season ranks exactly as today. Fitted to the 576-month sim's deflated net worth (300 bots, no `life`, so nobody retires):

| Month (age) | Net worth p10 / p25 / p50 / p75 / p90 (season-start $) | Mix at ×1 (Pup / Scout+Hunter / Pack Leader / Alpha) | Mix at the stage factor |
|---|---|---|---|
| 60 (26) | 13,904 / 24,136 / 44,126 / 68,051 / 82,830 | 3 / 37 / 51 / 9 % | ×1: the same |
| 168 (35, end of A) | 99,095 / 155,084 / 238,007 / 307,900 / 369,423 | 0 / 0 / 6 / 94 % | ×1: the same (best alone would be ×7.75: 1 / 59 / 40 / 0 %) |
| 396 (54, end of B) | 379,428 / 578,121 / 791,250 / 962,867 / 1,096,696 | 0 / 0 / 0 / 100 % | ×21: 0 / 42 / 58 / 0 % |
| 397 (55, start of C) | (as month 396) | | ×25: 0 / 63 / 37 / 0 % |
| 576 (69, end of C) | 624,194 / 989,840 / 1,303,809 / 1,586,962 / 1,759,383 | 0 / 0 / 0 / 100 % | ×25: 0 / 21 / 79 / 0 % |

**The aim (15-25% Pup, ≤ 15% Alpha at each stage end) cannot be reached with any multiplier.** At month 60 the distribution is wide (p90/p10 ≈ 6) and the cutoffs span 17× ($5,000 to $84,500); after decades of saving the distribution is compressed (p90/p10 ≈ 3.7 at 168, 2.8 at 576), so a multiplier that keeps the 17× spacing puts almost everyone in the middle two tiers. Also a stage step makes ranks drop at months 169 and 397 (rank-ups are once per tier per season, so climbing back is not re-announced). Decision for Mr. Tang, not built: (i) a per-stage cutoff table at percentiles of the full-life sim (about p20 / p40 / p70 / p88), or (ii) an age benchmark: a factor interpolated between anchor months (×1 to 60, then 168, 396, 576), so ranks move all through each stage. Re-fit either once 5b/5c retirement changes the Stage C distribution.

**Mortgage payoff and a second purchase** (`housing`, tests only, no code change): a 25-year mortgage makes exactly 300 payments, the last one the balance left, then `payment_cents` 0 and no more debits; property tax and condo fees continue; the audit is clean; also through renewals at changing rates. A renewal is recorded every 60 months, the check running before that month's debit, so the fifth lands on the final payment (over the one month left, at that day's rate). Selling then buying again works: the same mortgage account, not first-time (30 years insured refused).

**Results**

- `npm test`: 457 tests, three runs in a row, all green (119 / 120 / 136 s). New: `test/life-services.test.js` (4), `test/life-limits.test.js` (3), `test/jobs-auto.test.js` (3), `test/leaderboards-life.test.js` (8), `test/housing-life.test.js` (3). No existing test changed.
- `npm run sim -- --months=60`: audit OK in all 61 rows; bills/pay 69/63/60/59/57%, homeowners 31%, Gini ≤ 0.333; errand cash 0.039%. `--teacher`: audit OK, the eight teacher actions, season close + new world starts clean.
- `npm run sim -- --months=576` (new: economy check at 60/168/396/576, Wolf mix at 168/396/576, homeowner share, history read timings, `--dump=<file>`): **1 h 41 min** wall time, **audit OK in all 577 rows**. This run was on `82fe0ae` (the sim change alone), started before the other changes here, which are inert without `life`; it was not re-run on the final tree. Economy check: month 168 bills/pay 41%, homeowners 52%, Gini 0.245; month 396 35%, 56%, 0.197; month 576 33%, 58%, 0.190; errand cash 0.027% of lifetime pay. **The guard fails in Stages B and C**: bills/pay drops below 50% from month 79 on, and homeowners pass 50% at month 156, because nobody retires and pay keeps rising faster than bills; that is for the life wave (pay ending, retirement, decumulation) to re-tune, not a defect here.
- `node scripts/perf.mjs payday=500 month300=1000`: payday 392 ms, month300 564 ms (exit 0).
- History after 576 months (the sim's end; 300 students): 3.12 M txns, 6.50 M entries, a 1.7 GB database; the busiest student 22,900 entries (10,984 on chequing). Median reads: statement 50 rows 0.08 ms, 500 rows 0.66 ms (indexed, flat); home cards with the today digest 14.1 ms (0.8 ms at 60 months: it scans all of the student's entries by `entries_account` and filters `created`, so it grows with history; an index on `(account_id, created)` or a running total per day would make it flat); `ledger.audit()` 11.1 s (0.4 s at 60 months: a full scan, the nightly job's cost, and most of the 576-month sim's run time, since the sim audits every month).

## As built (5b merge)

*Branches `p5b-life` and `p5b-deps` merged on `p5b-merge`, 2026-10-29, reviewed (one money/kernel scan, one spec/UI scan, three verifiers), then merged to main as `v12-life`.*

**Fixed after review (all CONFIRMED by an independent verifier or reproduced directly):**
- `modules/jobs/ui/teach.js`: an unescaped apostrophe broke the whole Jobs teacher panel (module failed to parse). Every `modules/*/ui/*.js` now passes `node --check`.
- **The last class day lands on 577 even off the grid.** A manual one-month advance (25 → 26) shifts the world off its segment grid; the final step 566 → 578 was refused by `onTick`, the advance rolled back and auto-advance stopped at 566 with the message "The life ended… close the season" (wrong: no age-70 snapshot yet). `applyPace` now shortens the day that would overshoot to `577 − month` (always 1..11, locked or not), so the world always reaches 577 and switches to manual as designed. Test: "off the segment grid".
- **A retired student can no longer be hired again.** `POST /api/jobs/pick` and the teacher's `/assign` refuse (409) when `life.retired` says so; before, a re-picked job was paid a full month at the old wage every class day until the next payday ended it again.
- **Stage-event bounds match the services.** `checkEvent` accepted `rate_bp` 0-2000 and housing `pct` ±50, but `rates.queueRate` refuses > 1000 bp and `housing.marketEvent` refuses anything outside ±5..15; such a config event would fail the tick at its month and jam the advance. Life now refuses them at boot (logged once, skipped).
- `life.snapshots({ playerId, worldId })` honours `worldId` (leaderboards passes it; it was ignored, harmless today because the finale runs on the closing world).
- The retirement errand now also needs `life.yearsToRetire > 0`, so a student at or past the default age (who cannot change it) is not offered it.

**Merge decisions:**
- `options.jobs.autoPromote` is **off**. With it on, the 60-month economy guard fell to bills/pay 49.4% (floor 50%): bots promoted every eligible step at once. On is the right default for a 48-year life, but the guard and `simApprovePct` need re-tuning together first (Mr. Tang's call).
- `test/life.test.js` was written against fake services; on the merged tree the real `exchange.allocation` and the three stage-event services exist, so the snapshot test reads the real allocation and the "services absent" test drops those modules from the config.
- The sim's bot promotion step tolerates an application already auto-approved.

**Left as reported (not fixed):**
- Wolf tiers drop at months 169 and 397 (stage factors ×21/×25) and later climbs are not re-announced; the factors cannot reproduce the target tier mix over 576 months (p5b-deps report). Needs a per-stage cutoff table or an age-ramped factor.
- Leaderboards hard-codes the stage months 168/396 (deployment `startAge` 22); life's `startAge` option moves life's stages but not the Wolf factors.
- The teacher Life panel rebuilds on every refresh (in-progress plan/event edits are lost); "Class days left" counts today even after today's advance; "Move"/"Skip" buttons have no per-row labels.
- `exchange.stageEvent` idempotency ignores `ticker` (two scandals on different tickers in one month: the second returns the first).
- Dropping `life` or `rates` from the config mid-season makes TFSA/RRSP room fall back to base figures for every year.
- The economy guard ranges (bills/pay 50-75%, homeowners 20-50%) were written for 60 months. Over 576 months bills/pay drifts to ~35% and homeowners to ~59% from wages outgrowing bills (both editors' 576-month runs, audit OK every month); re-tune belongs with the autoPromote decision.
- FT10 and FT20/30 share one world and one clock, so both courses get the full life; "FT10 Stage A only" is not possible without a second world.

**Checks on the merged tree:** `npm test` 473 tests green (3 runs before the review fixes; the affected files re-run after); `npm run sim -- --months=60` and `--teacher` audit OK; perf within thresholds. The 576-month sim was **not** re-run on the merged tree (each editor ran it on their branch, 1.5 h each; the merge changed bounds and guards only).

## As built (5c)

*Branch `p5c-stagec`, 2026-10-30, cut from main @ `v15-employers` (ac8a68f).*

**Where it lives, and why.** A new module, `retirement` (requires `bank-basic` only), not an extension of `life`: income has to land at the payday moment, **before** housing debits rent and the mortgage and before bills runs autopay (bills marks last month's unpaid lines late before autopay, so income arriving after bills would make every retiree late once per class day). `life` ticks after `leaderboards`, too late. So `retirement` sits in `config/vdaa.json` right after `jobs` (`test/db.test.js` asserts jobs < retirement < housing, credit, bills). `life` stays the clock and stage module. Every other module is a soft dependency: without `life` it does nothing (no ages); without `exchange` there are no RRSP/TFSA/non-registered draws and no year-end settlement (the withholding is final); without `bills` the bills line is 0; without `jobs` the CPP record is empty.

**Constants** (`modules/retirement/constants.js`, the OAS recovery tax in `modules/jobs/payroll.js`; pages read 2026-10-29/30):

| Constant | Value | Status | Source |
|---|---|---|---|
| CPP maximum at 65 (2026) | $1,507.65 / month | CONFIRMED | canada.ca `.../publicpensions/cpp/payment-amounts.html` |
| CPP before / after 65 | -0.6% / month (36% at 60), +0.7% / month (42% at 70) | CONFIRMED | canada.ca `.../publicpensions/cpp/when-start.html` |
| CPP formula | max x min(1, sum over world years of min(1, (gross - exemption) / (YMPE - exemption), both x that year's price index) / 39) (fix round 1; first built on CPP withheld / the fixed 2026 maximum) | ILLUSTRATIVE | the game's simplification of career-average pensionable earnings / YMPE with the 17% dropout (about 39 of 47 years) |
| OAS at 65-74 (Oct-Dec 2026) | $762.50 / month | CONFIRMED | canada.ca `.../old-age-security/payments.html` (the spec's "about $740" was an older quarter) |
| OAS deferral | +0.6% / month, 36% at 70 | CONFIRMED | canada.ca `.../old-age-security/when-start.html` |
| OAS recovery tax | 15% of net income above $95,323 (2026 income year, marked an estimate on the page), capped at the OAS received | CONFIRMED | canada.ca `.../old-age-security/recovery-tax.html` |
| RRIF minimum factor, age 70 or younger | 1 / (90 - age) | CONFIRMED | CRA "Chart - Prescribed factors" (71: .0528, 72: .0540 confirmed too; not used, the life ends at 70) |
| Full residence for OAS; no 75+ top-up | | ILLUSTRATIVE | the life ends at 70 |
| Projection inflation | 2.1% / year | ILLUSTRATIVE | the spec's figure |
| Pension withholding at source | annual tax on 12 x this month's CPP + OAS (no earned income) / 12 | game rule | real CPP/OAS withhold only on request |

All amounts are season-start dollars, paid x the world price index (`k.world.priceIndex`), as Service Canada indexes them; the recovery threshold is indexed the same way in the settlement.

**What shipped**

- **CPP.** `jobs.cppHistory({ playerId, worldId? })` (new, read-only) sums the gross of every pay stub with a CPP contribution by world year (catalogue job, company jobs, pay in lieu all count), with that year's YMPE and basic exemption x the price index at its first payday (`jobs_year_index`, fix round 1). The pension at 65 is the formula above; the start age is 60-70 (default 65), chosen in the Retirement building until the pension starts and never below the student's age now (`POST /api/retirement/cpp { age }`: 400 out of range or below age, 409 once started). At the start month the base (season-start dollars, factor applied) is fixed in `retirement_plan.cpp_base_cents`; every month after it is paid x the price index. Before the start the panel shows an estimate: the record so far plus, while still working, the last year's ratio for each year left until the pension or work stops.
- **OAS.** From 65, deferrable to 70 (`POST /oas { age }`, the same rules). The recovery tax is charged in the year-end settlement.
- **Payments.** In the tick, per student (`k.forEachPlayer`), once a month (`retirement_income`'s key): `retirement.cpp` and `retirement.oas`, mint -> chequing net + sink (the withholding), and the gross, withholding and OAS part are added to the exchange's tax year with the new `exchange.recordRetirementIncome`. A 12-month class day pays each month once (tested).
- **Tax.** No tax code in the module. The exchange's year-end RRSP settlement now taxes `G - C + W + P` (P = CPP + OAS) through `annualIncomeTax(net, G)` plus `oasRecoveryTax(net, OAS, threshold x index)` (new pure function in `payroll.js`, next to the T1 code), against everything withheld (RRSP/RRIF withdrawals + pensions); the slip records `p_cents` and `clawback_cents` (migration `exchange 008_retirement`) and the Exchange panel shows both. A student with pensions and no RRSP activity is settled too. Pension income credit and the age amount are not modelled (spec).
- **RRSP -> RRIF.** `POST /rrif` from age 55 (409 before, 409 twice, 409 without the exchange). Once converted, at least `ceil(value / ((90 - age) x 12))` comes out of the RRSP every month (whether retired or not), on top of the plan if the plan draws less from it. The RRIF is the same `rrsp` account and holdings.
- **The draw plan.** `POST /plan { monthly_cents 0..$100,000, order: a permutation of rrsp, invest, hisa, tfsa }`; default order RRSP, non-registered, HISA, TFSA (TFSA last). It runs at the payday moment in every month the student is retired (`life.retired`). Each account gives up to what it holds, in order; what the plan wanted and could not get is `short_cents` on the month's row and the panel's history. RRSP/TFSA/non-registered go through the new `exchange.drawForRetirement({ playerId, account, cents })`: the account's cash first, then holdings sold at the bid through the real `settleSell` (ticker order, skipping a halted or rate-paused security and units a sell limit reserves; kind `exchange.draw_sell`, actor system, not shown in the feed), then the panel's own withdrawal path (TFSA: `exchange_tfsa.withdrawn_cents`, room back next year, already modelled; RRSP/RRIF: 10/20/30% withholding by the size of that one draw, kept for the settlement), kind `exchange.draw`. The HISA is moved by retirement itself (`retirement.draw`, hisa -> chequing). A GIC is not drawable (it matures into chequing on its own). No account goes negative (the ledger refuses, and every draw is capped by the balance; tested with bots). **Non-registered sales are untaxed:** the game has no capital-gains model (the cost basis is tracked on trades, nothing taxes it).
- **The live check** (`calc.js`, pure): income = CPP + OAS + the plan's draws this month (with the RRIF minimum) - a tax estimate (the pension withholding formula on pensions + the RRSP/RRIF part; TFSA, HISA and non-registered untaxed); bills = `bills.monthBills({ playerId })` (new, read-only: every line of the latest month billed except fees and one-off event expenses: rent or the housing lines such as property tax and condo fees, insurance premiums, at the price index) **plus** `housing.monthCosts({ playerId })` (the mortgage payments and a classmate unit's rent, which housing debits from chequing directly and never become Bills lines; added in fix round 1, the first version left them out); verdict covered / short by $X and coverage % (income / bills, capped 100; no bills = 100). "Your savings last until age N": a deterministic monthly projection from now (no draws until the retirement age; from it each month draws max(the plan, the bills the pensions leave uncovered) x 1.021^years from the pots in plan order; each pot grows at its own rate: `exchange.retirementPots` gives each account's cash + holdings at the bid and the value-weighted expected return of its holdings, the HISA its rate from savings' `hisaRate` (world-level); pensions count from their start ages net of the same withholding rate); capped at 100. The panel shows it from age 50 (before retirement: "if you were retired today with your plan").
- **Today:** `retirement.todayFacts` (`cppSet`, `cppOpen`, `planSet`, `covered`, `shortfallCents`, `lastsUntilAge`; 0/false before 50), `'retirement'` in today's `FACT_MODULES`, two Stage C errands: "Set your CPP start age" (`life.stage >= 3`, CPP not chosen and not started; done by the fact) and "Review your retirement income" (a visit to the building). Rewards $1.00 and $0.50 (x index), the existing cap.
- **Health and awards** (`leaderboards`): once a student's `module.retirement.coverage` arrived (from 55, whatever the start age; fix round 1) they get the part `coverage` (Retirement coverage) instead of `load`; still five parts with calm. Worlds and snapshots without the module keep the old parts. Award **Best Retirement** (`retirement`): the class whose savings last longest: the median of the students' last projected age (90 or more counts as 90), then the median uncapped income / bills ratio, then median net worth (fix round 1; first built on capped coverage, which made it a net-worth award). Flag **`retirement_short`** ("Will run out before 90"): the last projection (`lasts_age`, from the same event) under 90. Migration `leaderboards 007_retirement` (inputs `coverage`, `lasts_age`).
- **UI.** Student building "Retirement" (`modules/retirement/ui/retirement.js`): the check card, CPP and OAS start-age sliders with the amount live, the draw plan editor (amount, Up/Down order, each button labelled), the RRIF switch, the last 12 months. Teacher panel "Retirement": per class, short first, income / bills / coverage / short by / lasts to / CPP age / RRIF; "short" = bills not covered or savings projected to run out before 90. h()/textContent only, CSSOM-free, no inline handlers; checked in the browser at 375 px (no horizontal scroll, plan saved, no console errors) and the teacher panel at desktop width.
- **Bots** (`simulate`): from 55 a CPP age 60-70 (`60 + dice % 11`, at least their age); once retired (life's bots retire at 60-70), at retirement and each world year: a RRIF and a plan of (bills - net pensions) x 1.1, order RRSP, non-registered, HISA, TFSA.
- **Sim:** `npm run sim` prints a Stage C line (months 397, 457, 517, 576: students checked, covered, savings last < 90, median coverage, the month's CPP + OAS, draws and shortfall) once the world passes 397, and `CARRIED` checks the three retirement tables after a season close.
- **Money supply:** CPP and OAS are minted like wages. Per retiree at the season-start index: up to $1,507.65 + $762.50 = $2,270.15 a month (at 70 with both deferred: $2,140.86 + $1,037.00 = $3,177.86), x the price index. Nobody is 55 before month 397, so the 60-month economy guard is untouched (verified below).

**Data (5c)**: `retirement_plan (player_id, world_id, cpp_age, oas_age, monthly_cents, draw_order JSON, rrif, rrif_month, cpp_base_cents, cpp_month, oas_base_cents, oas_month)` (a row only once something is chosen or a pension starts), `retirement_income (player_id, world_id, month, cpp_cents, oas_cents, withheld_cents, draw_cents, draw_withheld_cents, short_cents)`, `retirement_status (player_id, world_id, month, income_cents, bills_cents, coverage_pct, shortfall_cents, lasts_age)` (the latest check, for the teacher). All keyed by `world_id`: nothing carries (tested). Exchange: `exchange_rrsp.pension_cents`, `.pension_withheld_cents`, `.oas_cents`; `exchange_settlements.p_cents`, `.clawback_cents`.

**Deviations from the spec**

- Module `retirement` with its own tables (`retirement_plan`, `retirement_income`) instead of `life_draw_plan` / `life_income`; `life_state.cpp_start_age` / `oas_start_age` stay unused. The UI is its own building and teacher panel, not a section of the Life panel (module UIs are per module).
- Draw ledger kinds are the owner's: `exchange.draw` / `exchange.draw_sell` for exchange accounts (only the exchange may write its TFSA/RRSP year rows), `retirement.draw` for the HISA. Pensions are `retirement.cpp` / `retirement.oas`.
- Withholding at source on CPP/OAS (a game rule, settled at year end) where real pensions withhold only on request.
- The RRIF minimum is a twelfth of the current value's yearly minimum each month (not the January 1 value); conversion opens at 55; the forced conversion at 71 never happens (the life ends at 70). A converted RRIF still accepts RRSP contributions (the exchange does not know about the conversion).
- The check's bills are the latest month billed: the tick runs before this month's bills, so the tick's check uses last month's bills (the panel reads the latest).
- The live check's tax is an estimate (withholding-style); the real tax is the year-end settlement.
- Best Retirement is a class award (class medians, as Top Pack); there is no individual award.
- Before retirement, the check shows the student's estimated pensions and plan as if retired today, and the Stage C health part uses that.
- The retirement month holds the last pay, the first CPP/OAS (at 65) and the first plan draw: life ends the job right after that month's payday, and retirement's tick runs after jobs with `life.retired` already true.
- Today's digest counts `retirement.cpp` and `retirement.oas` as pay; draws are moves between the student's own accounts (net only the RRSP withholding), so they show under "other".

**Known gaps**

- **Tuning (the spec's gate):** see "Fixed after review (round 1)", "The gate after the fixes": met for renters, not for homeowners still paying a mortgage at 65; the lever left is the bills catalogue and Stage C costs, not the pensions. **Update (stage costs, 2026-10-30):** that lever is now built: bills' age-gated cost lines (Stage B household, vehicle, home upkeep or renter extras; Stage C health and care stepping at 60 and 65, travel), counted by the live check and the projection. The gate is re-measured over a whole life with scripted profiles in `docs/stagecosts.md` (`scripts/lifecycle.mjs`); the pensions are unchanged.
- Tax brackets in `annualIncomeTax` are fixed 2026 figures while pensions are indexed (bracket creep over 48 years; it already applies to wages).
- Non-registered gains are never taxed (no capital-gains model).
- The 576-month sim was not run (hours); its new Stage C line is untested on a real long run.
- Late fees: the bot behaviour from earlier waves (20% of bots without autopay, a 70% pay chance) piles up fee lines in Stage C as income falls (22% of lines late from 65 in the 30-bot run, 11% at 55-59); the check excludes fee lines by design.

**Results**

- `npm test`: 562 tests, one run, all green (127 s wall), before the last commit (the digest grouping; `test/today.test.js` re-run after it: 14 green).
- New tests `test/retirement.test.js` (9): CPP factors and contribution-years scaling; OAS deferral and the recovery tax; the RRIF minimum and pension withholding; draw order, shortfall, the check, the projection (deterministic, retiring later lasts longer); Stage C health parts; a world jumped to month 456/516 with seeded pay stubs and funded accounts (CPP at 60 at 64%, CPP deferred to 70, OAS deferred, RRIF + holdings sold at the bid, a HISA shortfall, TFSA room back, a 12-month advance paying each month once, the year-end slip = `annualIncomeTax(W + P, 0) + oasRecoveryTax(...)`, the coverage part in the snapshot, the same projection on the panel and the Today facts; audit after every advance); work stops at 65 and pensions begin the same month with no wages after; bots (CPP 60-70, RRIF, TFSA last, no negative balance); routes and the finale (teacher with no classes, bad ages, Best Retirement and `retirement_short` at the close, nothing carried). Existing tests changed: `test/db.test.js` (retirement's place), `test/session-security.test.js` B13 (17 -> 18 `classesFor(user)` uses), `test/fuzz-common.js` (`age`, `monthly_cents`, `order`).
- `npm run sim -- --months=60`: audit OK in all 61 rows; bills/pay 57.1% at 60, Gini 0.325, homeowners 31.3%, errand cash 0.039% (the same as before 5c). `--teacher`: audit OK in all 61 rows, Gini 0.310, homeowners 31.7%, season close + new world "starts clean" (with the retirement CARRIED checks).
- `node scripts/perf.mjs payday=500 month300=1000`: payday 353 ms, month300 547 ms (exit 0). Neither reaches Stage C (retirement's tick returns after one service call before 55).
- A 30-bot Stage C run (scratch script, not a test: months 396-577 one month at a time, seeded 33-year CPP records; 10 "diligent" with $550,000 in RRSP/TFSA/HISA, 10 "middle" with $150,000, 10 "never saved" with half contributions): audit OK at every checkpoint, no negative account; at 65 (index 1.231) median income after tax $3,105 / $2,530 / $2,137 against bills $1,670; covered 10/9/8 of 10; at 70 all 30 covered, savings last past 100 for the medians; month 576: average CPP $1,316, OAS $1,020 a month (indexed); a whole advance month with 30 students in Stage C 84 ms median.

### Fixed after review (round 1)

*An independent review with probe scripts found eight problems; each fix has a test in `test/retirement.test.js` (named "review N").*

1. **Mortgages and student rent were missing from the bills** (high). Housing debits the mortgage and a classmate unit's rent straight from chequing, so `bills.monthBills` never saw them and homeowners and unit tenants were reported covered when short (and the bots drew too little). New read-only `housing.monthCosts({ playerId })` -> `{ mortgageCents, rentCents }` (each owned home's regular payment while a balance is left, not arrears; the unit's rent while the student is its tenant); the check adds it. Also `monthBills` now leaves out every `fees` line (late fees and housing's NSF fee), not only `late-fee-*`. Note: at the end of an amortization with arrears, housing's own renewal sets the regular payment to the whole balance, and the check reports that.
2. **Stage C ticks were slow** (medium-high). `exchange.book()` ran a GROUP BY over the world's whole price history (about 1.2 ms a call by month 500; the draws and checks call it 2-5 times per retiree per month): it now seeks each ticker's latest row by primary key (every caller, not only retirement, benefits). The HISA rate comes from a new world-level `savings.hisaRate({ worldId? })` instead of savings' per-student `todayFacts`. The reviewer's probe (300 students, 515 months of price history, $300,000 each, $3,000 plans), whole advance month in ms, before -> after: month 396 399 -> 61; 397 (age 55) 836 -> 185; 515 466 -> 144; 516 464 -> 144; 517 (retirement) 1,682 -> 320; 518 1,254 -> 201; the same probe without the retirement module: 22-52. 300 `retirementPots` calls 363 -> 26 ms, 300 `todayFacts` 387 -> 41 ms. New `scripts/perf.mjs` scenarios `retire517` and `stagec` (below).
3. **A short account ended the draw** (medium). The draw loop now asks each account in order for what is STILL needed, so holdings that cannot be sold (halted, rate-paused, reserved by a sell limit) or an empty account pass the rest to the next account (the probe's case: $0.01 from the RRSP, the rest from the HISA, short 0). The RRIF minimum stays RRSP-only; what a blocked sale leaves unpaid of it (not what the RRIF does not hold) is carried into next month's minimum (`retirement_plan.rrif_carry_cents`, migration `retirement 002_review`). Draws sell at the latest stored prices (retirement ticks before the exchange), so a breaker trip last month also blocks this month's draw sale; the rest passes on.
4. **A big plan bought full coverage** (medium). The check counts the plan only up to what the accounts could pay every month until 90 (total pots / months to 90), before and after retirement (`check.plan_counted_cents` on the panel).
5. **CPP grew with wage inflation** (medium). Each year was compared with the fixed 2026 maximum while wages rise with the index, so by index 1.7 every worker counted a full year (and the pension was then indexed again). Jobs records the index at each world year's first payday (`jobs_year_index`, migration `jobs 007_year_index`); a year's ratio is (gross - exemption) / (YMPE - exemption), both x that year's index. A 60%-of-YMPE worker counts the same fraction at index 1.0 and 1.7 (tested). Payroll's own CPP deductions still use the fixed 2026 YMPE (unchanged).
6. **Best Retirement was a net-worth award** (low-medium). It now ranks the class median of the projected age (90+ counts as 90), then the median uncapped income / bills ratio (`ratioBp` added to `module.retirement.coverage`, `leaderboards_inputs.coverage_bp`, migration `leaderboards 008_retirement_ratio`), then net worth.
7. **Draws sold while trading was frozen** (low). `drawForRetirement` sells nothing while the teacher has frozen trading (the account's cash still comes out); the month's row says why it fell short (`retirement_income.note`: "trading frozen" or "some holdings could not be sold this month"), shown in the panel's history.
8. **Coverage waited for leaderboards' fixed stage months** (low). With `life.startAge` 30, coverage arrives from month 301 but the debt load stayed until 397. Leaderboards now uses coverage whenever it has been announced, whatever the month.

**The gate after the fixes** (the same scratch scenario, now 40 bots: months 396-577 one month at a time, 33 years of pay stubs at the full YMPE or at half the pensionable range, $570,000 in RRSP/TFSA/HISA or nothing, renting or owning a home with a $1,800 mortgage that ends at 70; the bots' own jobs, bills, retirement ages 60-70 and plans; covered = no shortfall in the month's check):

| Group (10 bots each) | Covered at 65 | Median coverage at 65 | Median "savings last to" at 65 | Covered at 70 |
|---|---|---|---|---|
| Full CPP + savings, renter | 9/10 | 100% | 100+ | 10/10 |
| Full CPP + savings, mortgage | 0/10 | 49% | 96 | 9/10 (the mortgage is paid off) |
| Half CPP, no savings, renter | 3/10 | 94% | 78 | 6/10 |
| Half CPP, no savings, mortgage | 0/10 | 25% | 65 | 0/10 |

A diligent renter is covered and a never-saved renter is short at 65 (the gate's intent) but drifts back towards covered by 70 (6/10): a single renter's catalogue bills ($1,775 at 65, $1,970 at 70 with the index) are close to half-CPP + full OAS after tax. A diligent homeowner is short at 65 while the mortgage runs (bills $3,985 against a plan sized by bots to the bills) and covered once it ends; the bots' plans are not tuned to draw more while a mortgage is left (their plan is sized at retirement and each world year). The levers left are the Stage C costs (the bills catalogue has no retirement-age lines: health, care, travel) and the housing costs, not the pensions, which are the confirmed real amounts; nothing was changed to force an outcome. In this scenario mortgage holders who could not pay before retiring piled up arrears (housing's own renewal sets the final payment to the whole balance, $312,816 in one case), and late lines are 70% of all lines, from those mortgage holders; audit OK at every checkpoint, no negative account. Average pension at 576: CPP $1,166, OAS $1,020 a month (indexed).

**Results (fix round 1):** `npm test` 566 tests, one run, all green. `test/retirement.test.js` 13 tests (4 new "review" tests plus new assertions: the indexed-YMPE equality, the year index, the NSF fee). `npm run sim -- --months=60`: audit OK in all 61 rows, bills/pay 57.1%, Gini 0.329, homeowners 30.7%, errand cash 0.039%. `--teacher`: audit OK in all 61 rows, Gini 0.309, season close + new world starts clean. `node scripts/perf.mjs payday=500 month300=1000 retire517=1500 stagec=1000`: payday 354, month300 519, retire517 970, stagec 659 ms (exit 0). The harness's Stage C months include bills' autopay for 300 billed students (most of the time: `bills.tick` dominates the profile; month300, the same students in Stage A, is 519 ms), so retirement's share is the reviewer probe's difference above: about 120-180 ms a month in steady Stage C and about 270 ms in the month everyone retires.
