# Phase 6: the Intertwined pieces, then students as landlords and employers

*Spec, 2026-10-29, after `v12-life`. Mr. Tang liked the Intertwined Economy Simulator (docs/poc-survey.md §2) and chose: roles **Landlord** and **Employer / Business Owner** (not Finance Minister or Regulator; the Banker stays the teacher, who is already the Fed); order **pieces first, then roles, then 5c Stage C**. Everything here follows docs/modules.md (modules, services, events, savepoints, kinds), the economy guard in test/economy.test.js, and the errand-cash rule (no errand pays for any of this).*

## 0. What Intertwined has that vDAA lacks

| Intertwined | vDAA at v12 | This phase |
|---|---|---|
| Stress 0-100, rises while jobless or homeless, high stress triggers an emergency loan at interest | nothing | **6a `stress`** |
| Live feed: "Maya raised rent to $620", "Sam hired Casey at $520", "Riley approved a $400 loan at 14%" | exchange news only; audit log is teacher-only and mis-scoped | **6a `feed`** |
| Debrief pattern flags: "tends to hoard cash", "took on excessive debt", "exploited monopoly" | season awards, Hall of Fame, Life Review | **6a flags** in leaderboards |
| Scenario picker: 2008, 1970s stagflation, Volcker, post-COVID, stable | three fixed stage events + hand levers | **6a scenarios** in life |
| Students are landlords: set rent, vacancy, reputation | rent is an NPC price paid to the sink | **6b landlords** |
| Students are employers: post jobs, hire, run payroll, employees can walk | Ventures 4b (paused) already has ~80% of it | **6c employers** |
| Round recap, worksheets from the class's real data | Today digest (5a); Slide Studio can read `/api/teach/log` | later |

Two things from the survey stay out on purpose: **no transfers between students** beyond what already exists (bank-basic, off by default, $50/$100 caps) and nothing is tied to real money.

## 1. Wave 6a: the pieces (no new roles)

### 1.1 `stress` module

New module, config order **after `bills`, before `leaderboards`** (it needs the month's late bills and leaderboards needs its number; `test/db.test.js` order check updated). Reads no other module's tables: jobless comes from `jobs.todayFacts`, late bills from `module.bills.late`, missed housing payments from `module.housing.payment`, retirement from `life.retired` (all behind `k.modules.has`).

**Score.** `stress_state(player_id, world_id, score 0-100, loan_id NULL, updated_month)`. Each tick, in `k.forEachPlayer`:
- +15 jobless (no holding) unless retired (`life.retired`) or in the first 2 months of the world;
- +10 per bill marked late this tick (`module.bills.late` counted per student, cap +30);
- +20 for a missed mortgage or rent payment (`module.housing.payment` with `onTime:false`);
- +25 on eviction (6b, `module.housing.evicted`);
- −10 when none of the above happened this month and the student has a job; −5 otherwise;
- clamp 0-100. Multi-month advances apply the per-month rule each month (the tick runs per month already).

**Levels** (chip text, `badges` hook, read from the stored row): 0-24 Calm, 25-49 Tight, 50-79 Strained, 80-100 Crisis. Chip: `Stress 62 · Strained`, title explains what moved it this month. Also a `todayFacts` service: `{ score, level, hasLoan }` (errand templates may use it; none pays cash for lowering stress).

**Health board.** `module.stress.score {playerId, score}` after each tick; leaderboards stores it in `leaderboards_inputs.stress` (migration) and adds a fifth part `calm = 100 − stress` to `healthParts` (`health.js` divisor 4 → 5; `PART_NAMES`/`TIPS` gain "Calm"). Old snapshots without the part are read as-is (the UI already tolerates missing parts? the editor checks; if not, default 100).

**Emergency loan.** When the score first reaches **80** in a tick, or when the student asks (`POST /api/stress/loan`, allowed from score ≥ 50, one loan at a time):
- principal = max($1,000 × price index, one month's net pay as last paid), rounded to the dollar; APR **19.99%** (`options.stress.loanAprBp`, 500-3000), 12 monthly payments by the housing `payment()` formula (`modules/housing/mortgage.js` is pure; import it, do not copy);
- account kind `loan` (ledger default allows negative): `mint → chequing` principal, kind `loan` (new money, like `housing.sale`); each tick after: `chequing → loan` principal part, `chequing → sink` interest, kind `loan_payment`; a short chequing = missed payment: +10 stress, $25 fee line, `module.stress.payment {playerId, onTime:false}` (credit marks it late exactly as it does `module.housing.payment`; credit's listener accepts any `kind`);
- paid off → row closed, `module.stress.loan_closed`; a second loan only after the first is closed;
- shown on the Bank page as "Emergency loan: $843 left, $92/month, 19.99%" (homeCards is not used; a small card in `bank-basic`'s page via `cards` of the stress module, `ui/stress.js`).
- The feed gets `loan` items; the teacher's panel lists loans per class.

**Bots.** Bots never ask; they take the automatic loan at 80 and repay like everyone. Expect few: jobless bots are re-hired every month by jobs' `simulate`.

**Guard.** New line in `test/economy.test.js`: students with an open loan at month 60 **< 15%**; audits clean. Gini unaffected (loans are ≤ a month's pay). Stress has no ledger effect itself.

### 1.2 `feed` module

New module, any order after the emitters (place last, after `today`). Table `feed_items(id, world_id, class_id NULL for town, month, at, kind, player_id NULL, text, cents NULL)`, index `(class_id, id)`. Rows are written by `events` listeners (in the emitter's savepoint, never throwing into it):

| Source | Item |
|---|---|
| new `module.jobs.hired {playerId, jobId, title, employer}` (3-line emit in jobs `/pick` and `/assign`) | "ninja42 took a job: Cashier at Riverside Grocery" |
| `module.jobs.promoted` | "ninja42 was promoted to Retail supervisor" |
| `module.credit.limit` | "ninja42 got a credit card, $1,500 limit at 20.99%" |
| `ledger.posted` kind `housing.purchase` / `housing.sale` | "ninja42 bought a starter condo for $150,000" |
| new `module.housing.moved {playerId, tenure}` (one emit in housing `move()`) | "ninja42 moved into a 1-bedroom" |
| `ledger.posted` kind `exchange.buy`/`exchange.sell` with cents ≥ $2,000 | "ninja42 bought $2,400 of DAAX" |
| `module.stress.loan` | "ninja42 took an emergency loan, $1,000 at 19.99%" |
| `module.life.stage`, `module.rates.pending`, `module.insurance.triggered`, housing `market` audit → town items (class_id NULL) | "Rates: the Bank of DAA will move to 6.00% next month" |
| 6b/6c | "maya listed a condo for rent at $1,400", "sam hired casey at $17.50/h", "maya raised the rent on unit 2 to $1,520" |

Usernames (pseudonyms) only; `cents` rendered subject to leaderboards' `hide_amounts` (read through a `leaderboards.settings` service if it exists, else always shown). Keep 500 rows per class (prune in the tick). Routes: `GET /api/feed/class` (student: own class + town, last 30), `GET /api/feed/teach?class_id=` (teacher: own classes, last 100, `since` cursor). UI: a `homeCards` card "Around town" (last 8, the student's own items first), and a teacher panel with a class filter that refreshes on the existing console hint. Nothing is pushed to students until their own `/api/me` refreshes; that is fine.

### 1.3 Pattern flags (leaderboards)

`flags(k, { worldId, playerId })` in `modules/leaderboards/flags.js`, computed from `leaderboards_snapshots` (month series, `parts`), `leaderboards_inputs`, `leaderboards_late`, the player's ledger accounts, and services (`savings`/`exchange`/`housing`/`stress` todayFacts). No other module's tables (the grep test stays). Stored at season close in the review JSON (`flags: [{ key, text, detail }]`) and a migration table `leaderboards_flags(world_id, player_id, key, detail)`; on demand through `GET /api/leaderboards/flags?class_id=` (teacher, live data, same function). Six flags, each with the number behind it:

1. **Hoards cash** — chequing > 3 × net pay while HISA + GIC + holdings < 1 × net pay, in ≥ 6 of the last 12 months.
2. **Excessive debt** — `parts.load` < 40 in ≥ 3 months, or an emergency loan taken twice.
3. **Never invested** — holdings 0 and TFSA/RRSP contributions 0 all season (and, with life, `allocation.equities` 0 at 35).
4. **Paid every bill on time** — zero `leaderboards_late` rows and ≥ 12 on-time bills.
5. **House-poor** — owns, mortgage payment × 12 / gross > 35%, and cushion < 30.
6. **Late bloomer** — class rank at month 12 to the end improved by ≥ 10 places (or ≥ a third of the class).
(6b adds **Rent gouger**: rent ≥ 140% of the NPC tier with a tenant for ≥ 6 months. 6c adds **Missed payroll**.)

Shown: in the student's season review / Life Review as "What the numbers say", and in the teacher's Amphitheatre panel as a class table (a debrief sheet; Slide Studio can read the route later).

### 1.4 Scenario picker (life)

`modules/life/scenarios.json`: `[{ id, name, blurb, events: [{ offset, kind, args, headline }] }]`, offsets in months from the chosen start. `KINDS` grows: `correction|rally|scandal|boom → exchange.stageEvent {kind, ticker?}`, `inflation → rates.setInflation {inflation_bp}` (new service wrapping the `/inflation` insert; takes effect at the next year step), `insurance → insurance.triggerEvent {event, scope:'town'}` (new service wrapping `/trigger`). `checkEvent` gets the new kinds with the services' bounds. Route `POST /api/life/scenario { id, from_month? }` (world teacher): replaces **unfired** rows (fired ones stay), inserts the scenario's rows with the next ids, audits, emits `changed`; the existing `/event` skip/move still works per row. Teacher panel: a picker with the blurb and the resulting dated list.

Four scenarios to start (numbers are the editor's to tune within bounds; the names are what the class sees):
- **Stable** — empty.
- **2008** — months +3 correction, +6 crash, +7 housing −15, +8 rate 100 bp, +9 rate 50 bp, +14 rally.
- **1981 Alberta** — +2 rate 1000 bp (the cap; the real 18% needs `MAX_POLICY_BP` raised, which touches mortgage pricing: **not in this wave**), +3 housing −15, +6 insurance car-repair town event, +18 rate 700 bp.
- **2022 inflation** — +1 inflation 800 bp, +4 rate 300 bp, +6 rate 500 bp, +10 rate 600 bp, +13 inflation 300 bp, +16 housing −10.

### 1.5 6a build plan

Two editors, both in worktrees cut from main: **Editor A (Sonnet)**: `feed` + scenarios (+ the three small emits). **Editor B (Opus)**: `stress` + loan + leaderboards fifth part + flags. Each: tests (`test/stress.test.js`, `test/feed.test.js`, `test/scenarios.test.js`, `test/flags.test.js`), `npm test` ×3, `npm run sim -- --months=60` and `--teacher`, perf; docs: `docs/modules.md` services/events lists and an "As built (6a)" section here. No 576-month sim unless the tick path changed beyond adding a module (it did not: stress is a new per-student tick, so run perf and read `month300`). Then one combined review (money scan on B, spec/UI scan on both), one verifier pass, ≤ 2 fix rounds, tag `v13-pieces`.

## 2. Wave 6b: student landlords (housing)

**Rule.** A student may own **two** homes: a primary and one rental. The rental is bought like any home, with **20% down, uninsured**, TDS counting the primary's mortgage payment, and 50% of the listed rent counted as income; it cannot be the first home. Migration drops `housing_one_home` and adds `housing_homes.role ('primary'|'rental')`, each home its own mortgage account (kind `mortgage:<homeId>`, prefix-matched like `gic:`; `tickHome`, `debtOf`, `sell` pick the account per home; `module.housing.value` carries the **sum** of homes and debts).

**Listing.** `housing_listings(home_id, world_id, rent_cents, listed, tenant_id NULL, since_month, arrears_cents, missed_streak)`. Rent must sit between **60% and 150% of the NPC tier** for that property (starter → apt1, average → apt2, scaled by the price index); this is the only bound that stops rent being a transfer channel. A landlord cannot rent to themself. One tenant per unit; no deposit for student units (keep the NPC deposit path untouched).

**Renting.** `GET /api/housing/market` returns the NPC tiers plus classmates' listings (username, rent, months vacant, "landlord reputation" = on-time months − disputes, from this world). `POST /tenure { tenure: 'unit:<id>' }` moves at `pending_from` as today. Each tick, housing itself posts `tenant chequing → landlord chequing` for rent, kind `rent` (not a bill; the `costs` emit has no rent line for a student unit, and bills' rent-line suppression predicate is fixed to key on tenure, not on "any housing line"). Short chequing: arrears + `$45` NSF line + `module.housing.payment {kind:'rent', onTime:false}` (credit late mark, stress +20). **Three misses in a row: eviction** to the shared room, `module.housing.evicted`, stress +25, the landlord keeps the arrears as a loss. A tenant may give notice (move at next month); a landlord may end a tenancy with one month's notice or raise the rent with two months' notice (feed item "raised the rent on unit 2 to $1,520"), within the bound.

**Vacancy** costs the landlord every owner line (mortgage, tax, fee, heat, insurance) with no rent. Selling a rental with a tenant ends the tenancy at the sale month. Season close ends units and tenancies with the homes.

**Guard.** `ownersShare` becomes `COUNT(DISTINCT player_id)`; rent arrears do not use `housing_homes.arrears_cents`. Bots: a bot owner with net worth in the top quartile and no rental buys one at month ≥ 30 (10% by hash dice) and lists at the NPC price; a bot renter takes the cheapest listing with 30% chance. Expect bills/pay for tenants of student units to **fall** (rent leaves bills): the guard's `bills` should count student rent as a bill-equivalent (sim.mjs adds `housing.rent` to the median bills figure).

**Build.** One Opus editor (ledger and mortgage paths), Sonnet for `ui/housing.js` market and landlord panels if split. Tag `v14-landlords`.

## 3. Wave 6c: student employers (Ventures)

Not new work: **merge** `p4a-ventures` (tip e2ab884, the WIP fixed-demand/fixed-rent change, tests green, sims not rerun) and `p4b-ventures` (tip 00fba3a, postings/hiring/payroll/missed pay/layoffs), reconcile them with each other and with main's jobs (5b's `autoPromote` migration `005_auto`, services `{ todayFacts, endHolding }`, the retired check), then apply these decisions:

- **On top, 10-40 h/month** (his 2026-10-23 decision in docs/phase4.md), not "replaces": `hireForBusiness` no longer calls `leave()`; business hours capped at 40; the pay-stub unique key gains the source (`job_id`/`business_id`); tax is computed per stub (documented simplification).
- **Slots**: `ventures_postings.slots` (1-5); the posting closes when filled; the founder sets an hourly wage ≥ **$15.00** (Alberta minimum, `options.ventures.minWageCents`, scaled by the price index).
- **Short treasury** = skip + reputation −500 + `module.jobs.unpaid` as built; after 2 misses the student may quit from the board (the 4b `/back` becomes a plain quit, since the catalogue job was never left).
- Retired students cannot be hired (`life.retired`); `jobs_class_off` does not apply (the board is town-wide, as built).
- Feed items: hired, wage raised, payroll missed, laid off. Flag: **Missed payroll** (founder) and **Walked for a better offer** (employee, informational).
- Then re-run the 4a tuning table, sims and perf (p4a's WIP never did), and the guard with ventures in both courses (4b saw Gini +0.01-0.02).

**Build.** One Opus editor for the merge and payroll (the merge is the risk), Sonnet for the Job Centre board UI. 4c (equity, IPO, dividends) stays after. Tag `v15-employers`.

## 4. Then 5c (Stage C)

Unchanged from docs/phase5-life.md: CPP/OAS/RRIF, the withdrawal plan, the "live check". Stress gets one more input there: income below the withdrawal plan.

## 5. Inputs needed from Mr. Tang

| Decision | Default used here |
|---|---|
| Emergency loan APR and size | 19.99%, max($1,000, one month's net) over 12 months |
| Stress thresholds and the automatic-loan trigger | automatic at 80, on request from 50 |
| Evictions allowed (a classmate evicts a classmate) | yes, after 3 missed months, with notice items in the feed |
| Rent bound | 60-150% of the NPC tier |
| Max homes per student | 2 |
| Business minimum wage | $15.00/h |
| Scenario names and the four shock lists | as in §1.4; "1981 Alberta" capped at 10% policy rate |
| Who sees flags | students see their own; teachers see the class table |

## 6. Model and agent use

Per feedback 2026-10-29 ("optimize model use"): Sonnet for orchestration, specs and UI; Opus only for the ledger paths (loan, rent, payroll, the Ventures merge); no Fable; ≤ 2 editors in parallel; one combined scan + one verifier pass per fix round; long sims only when the tick path changes.

## As built (6a stress + flags)

*Editor B, branch `p6a-stress`, cut from `b63c536`.*

**`stress` module** (`modules/stress/`, config `... credit, bills, stress, outfitters ...` in both courses; `test/db.test.js` checks bills before stress before leaderboards). Tables: `stress_state(player_id, world_id, score, updated_month, why, net_cents, pay_month)`, `stress_marks(player_id, world_id, month, late, missed, evicted)`, `stress_loans(...)` with a unique open loan per (player, world). No `loan_id` on the state row: the open loan is found by the unique index, so nothing has to be kept in step.
- **Inputs, per month.** Listeners count into `stress_marks` keyed by the event's own `month`; the tick for month M reads and deletes the row for M (and anything older). So a 12-month advance scores each month on that month's events only, and the counts roll back with the emitter's savepoint. `module.bills.late` counts once per late row per tick, as bills emits it: a bill left unpaid re-emits `late` every tick, so a student who never pays sits near 100. Late-fee lines are skipped (a consequence, not a bill). Jobless is `jobs.todayFacts().hasJob === false`, not counted in world months 1-2 (the first tick is month 2, so only that tick is graced) or when `life.retired`. A missed loan payment (+10) counts as "something happened" for the calm-month rule.
- **Levels and chip** as specified; the chip title lists what moved it (`+15 no job, +10 1 bill late`). The home card "Stress" (homeCards: `cards` are home cards only, so it is not on the Bank page) shows the score, a native `<meter>`, the month's reasons, the loan and the "Ask for an emergency loan" button. No card or chip before the student's first tick.
- **Loan, as booked.** Deviation from §1.1's wording "`mint → chequing`": the disbursement is `loan −P / chequing +P` (kind `stress.loan`), the mortgage pattern, so the loan account carries the debt (negative) and net worth does not jump by the principal. Payment: one txn `chequing −due / loan +principal / sink +interest` (`stress.loan_payment`), `interestFor` and `payment` from `housing/mortgage.js`; the 12th payment made clears what is left, so with no misses the 12 payments are exactly `schedule(P, apr, 12)` and the principal parts sum to P. A missed payment cannot take a fee from a short chequing, so the month's interest and the $25 fee are added to the debt in one txn `loan −(interest + 2500) / sink +(interest + 2500)` (`stress.loan_missed`); missed months are not payments, so the term stretches a month per miss and the 12th payment made also clears the fees. Principal = max($1,000 × price index, the last net pay from `module.jobs.paid`), to the dollar. Automatic only when the score **crosses** 80 in a tick (previous < 80) with no open loan; a student who stays at 100 after paying one off gets no second automatic loan until the score drops below 80 and crosses again.
- **Credit.** A new listener `module.stress.payment` marks each payment on the history (`source 'loan'`, on time or late). A loan does not open a credit file by itself; the marks count once a file opens.
- **Season close.** Nothing to do: every row is per `world_id`, and the loan account is zeroed by `core.season_reset` with the rest. `scripts/sim.mjs` checks `stress_state` and `stress_loans` in the new world (CARRIED).
- Teacher panel "Stress": per class, username, score, level, loan left (and missed payments).

**Leaderboards.** Migration `003_stress_flags`: `leaderboards_inputs.stress / loans / invested`, `leaderboards_snapshots.chequing / saved / holdings / net_pay` (NULL in months snapshotted before 6a), table `leaderboards_flags`. `healthParts` adds `calm = 100 − stress` only when stress is known, and `healthScore` is the mean of the parts present, so a world without stress (and every old snapshot) scores exactly as before; the UI draws only the parts a row has.

**Flags** (`modules/leaderboards/flags.js`): read only leaderboards' tables and life's `snapshots` service, never the ledger, because the season close's `seasonClose` hook runs after every account is zeroed. That is why the snapshots gained the four month-end columns. Notes per flag: (1) hoards cash counts only months with pay; (2) loans come from `module.stress.loan`; (3) never invested needs the exchange loaded and at least one 6a snapshot, and "contributions" are any `exchange.contribute` (investment account, TFSA or RRSP); (4) the on-time count is bills, card statements and mortgage payments together (leaderboards' `ontime`); (5) house-poor reads the last mortgage payment and last gross pay; (6) late bloomer compares class rank at the first snapshot from month 12 with the last. Stored in the review JSON (`flags`) and `leaderboards_flags` at close; `GET /api/leaderboards/flags?class_id=` (your own classes, else 404) runs the same function on live rows. Students see "What the numbers say" on the Life Review card; the teacher's Amphitheatre panel has a "Pattern flags" button per class.

## As built (6a feed + scenarios)

*Editor A, branch `p6a-feed`, cut from main `b63c536` (`v12-life` + this spec). The stress module, the loan, the leaderboards fifth part and the flags are Editor B's (`p6a-stress`); nothing here touches `modules/stress` or `modules/leaderboards`.*

### `feed`

- `modules/feed`: table `feed_items(id, world_id, class_id NULL = town, month, at, kind, player_id NULL, text, cents NULL)`, index `(class_id, id)` (migration `001_feed`). Last in both courses' module lists (after `today`); `test/db.test.js` asserts feed last, today right before it, life before both.
- **Amounts.** The row's `text` holds the token `{$}` where an amount belongs and `cents` the amount; the reader swaps in money (`$1,500`) or `$•••` when amounts are hidden. Students get the hidden form when `leaderboards.settings({ worldId })` answers `{ hide_amounts: true }`. **That service does not exist** (leaderboards is Editor B's, off limits here): without it amounts show, as the spec says. Teachers always see money. To honour the setting, leaderboards adds `services.settings = (k, { worldId }) => ({ hide_amounts: settingsOf(k, worldId).hide_amounts === 1 })`.
- **Listeners** never throw into the emitter (each is wrapped; a failure is logged and dropped; tested with junk payloads and a dropped table). Sources and the payloads found in the code (the spec's guesses fixed where wrong):

| Event | Payload (as emitted) | Item (class from the kernel) |
|---|---|---|
| `module.jobs.hired` (new, after commit, jobs `/pick` and `/assign`, only when the job changed) | `{ playerId, jobId, title, employer }` | "ninja42 took a job: Cashier at Corner Mart" |
| `module.jobs.promoted` | `{ playerId, worldId, month, title }` | "ninja42 was promoted to Retail supervisor" |
| `module.credit.limit` | `{ playerId, worldId, limitCents, aprBp }` | "ninja42 got a credit card, {$} limit at 20.99%" |
| `module.housing.moved` (new, inside the tick) | `{ playerId, worldId, month, tenure, name }` | "ninja42 moved into 1-bedroom apartment" |
| `ledger.posted` `housing.purchase` / `housing.sale` | `{ txnId, kind, actor, legs, owners }`: **no meta**; the feed reads `txns.meta` (`price` / `value`) by `txnId` | "bought a home for {$}" / "sold their home for {$}" |
| `ledger.posted` `exchange.buy` / `exchange.sell`, largest leg >= $2,000 | the ticker is in `txns.meta`; `exchange.drip_buy` is not a feed kind | "bought {$} of DAAX" |
| `module.stress.loan` | `{ playerId, worldId, cents, aprBp }` (stress's emitter; the feed reads `cents`) | "took an emergency loan, {$} at 19.99%" |
| `module.life.stage` | `{ worldId, month, age, stage }` | town: "everyone is now 36, Stage B of life" |
| `module.rates.pending` with `pendingBp` not null | `{ worldId, pendingBp, effectiveMonth, mortgage5yBp }` | town: "Rates: the Bank of DAA will move to 6.00% next month" |
| `module.insurance.triggered` | was `{ id }`; now `{ id, event, name, scope, classId }` | town (or that class): "Town event next month: Car repair" |

- **Deviations from the spec.** (1) `module.housing.moved` is emitted in `applyPending` (when the move takes effect at the tick), not in `setTenure` (the request): asking to move is cancellable, the move is the news, and `setTenure` also runs for bots every month. (2) The "housing `market` audit" town item is not built: marketMove emits no event (only one `module.housing.value` per home); a one-line `module.housing.market { worldId, month, pct }` emit would feed it. (3) `ledger.posted` is emitted after commit, so those rows are written outside the emitter's transaction; the module events inside a tick (`life.stage`, `housing.moved`, `rates.pending` from a service) are written in the emitter's savepoint. (4) The teacher route always includes the town's rows with the classes' rows; with no `class_id` it lists every class the teacher reads. (5) A class-scoped insurance trigger is that class's item, not the town's.
- **Pruning.** In the month tick, per class and for the town (`class_id NULL`) in the current world: everything older than the newest 500. Other worlds' rows are not touched.
- **Routes.** `GET /api/feed/class` (student: own class + town, newest 30, `{ month, items: [{ id, class_id, month, at, kind, mine, town, text }] }`; no player ids); `GET /api/feed/teach[?class_id=&since=]` (teacher: `{ month, classes, items (newest 100, + username), last_id }`; a class that is not the teacher's is a 404, a bad number a 400; `since` = only ids above it).
- **UI.** Card "Around town" (`homeCards`, newest 8 of class + town with the student's own first; `ui/feed.js`, `ui/feed.css`), teacher panel "Around town" (class filter built once, so a live refresh redraws only the list). Text is set with `textContent` (the `h()` helper), no inline styles or handlers; checked in the browser at 375 px and desktop, no console errors.

### Scenarios

- `modules/life/scenarios.json`: `stable` (empty), `2008`, `1981-alberta` (rate to the 1000 bp cap, housing -15, a town car-repair event, rate 700), `2022-inflation`, with the spec's offsets and original headlines. Loaded and checked once at boot by `checkEvent` (a bad file fails boot naming the scenario).
- **New event kinds** in life: `correction`, `rally`, `scandal`, `boom` (all through `exchange.stageEvent { kind, ticker?, headline }`; `scandal`/`boom` need `ticker`, one of the eight town companies, checked against `modules/exchange/constants.js`; the starter scenarios use none), `inflation` (`rates.setInflation { inflation_bp }`), `insurance` (`insurance.triggerEvent { event, scope: 'town' }`). The config-level `options.life.events` take them too (`{ month, kind, headline, rate_bp? | pct? | inflation_bp? | event? | ticker? }`).
- **Bounds cannot disagree.** `checkEvent` imports the services' own limits from their constants files (`MAX_POLICY_BP`, `MAX_INFLATION_BP`, `MARKET_EVENT_MIN/MAX_PCT`, insurance's `EVENTS`, exchange's `STOCKS`); a constants-only import, no module code. One tightening: a headline with a control character is refused (`exchange.stageEvent` turns those into spaces and then refuses an empty result). `test/scenarios.test.js` runs a boundary table (rate -1/0/1000/1001, inflation, housing +-4..16, insurance keys, every town ticker and some bad ones, headlines) through both `checkEvent` and the real services and asserts they agree.
- **New services.** `rates.setInflation({ inflation_bp })` (0-1000; the shared `queueInflation` also serves `POST /api/rates/inflation`; audit actor `system` for the service; applies at the next year step; the same value again changes nothing). `insurance.triggerEvent({ event, scope: 'town' })` (400 for an unknown event or any other scope; the shared `queueTrigger` also serves `POST /api/insurance/trigger`; `by_player` is stored as 0 for a service call, nothing reads it; idempotent per world, event and month: `{ id, event, applies_from_month, already }`; emits `triggered` inside the caller's transaction, like `rates.queueRate`'s `pending`).
- **Route** `POST /api/life/scenario { id, from_month? }` (world teacher): replaces every row with `fired_month IS NULL` (a skipped but unfired row too), keeps fired rows, numbers new rows after the highest id ever used (ids are not reused), months = `from_month + offset` (default the current world month; `from_month` must be between the current month and 576, else 400), skips rows whose month is < 2 or >= 577, audits `life.scenario`, emits `module.life.changed`. Returns `{ ok, scenario, from_month, removed, inserted, skipped }`. Unknown id 404. `GET /api/life/teach` gains `scenarios` (the whole file).
- **Teacher panel** (`modules/life/ui/teach.js`): a "Scenario" card (picker, "From world month", blurb, the resulting dated list with ages and skipped rows marked, "Use this scenario" with a confirm). The picker is built once, so a refresh never resets what you picked or typed. The panel's other two parts redraw on a refresh only when no field inside them has focus (this also closes the "teacher Life panel rebuilds on every refresh" gap from 5b merge).

### Other changes

- `modules/jobs`: `announceHire` + `module.jobs.hired` in `/pick` and `/assign`. `modules/housing`: `moved` emit in `applyPending`. `modules/insurance`: `queueTrigger`, the `triggerEvent` service, a richer `triggered` payload. `modules/rates`: `queueInflation`, the `setInflation` service.
- Tests changed: `test/db.test.js` (module order with feed), `test/session-security.test.js` (13 -> 14 `classesFor(user)` uses), `test/today.test.js` ("today switched off" also drops feed, which has a home card), `test/fuzz-common.js` (`from_month`). New: `test/feed.test.js` (11), `test/scenarios.test.js` (11), `test/ui-syntax.test.js` (every `public/*.js` and `modules/*/ui/*.js` passes `node --check`), and the helper `test/app-world.js`.

## As built (6a merge)

*`p6a-stress` and `p6a-feed` merged on `p6a-merge`, 2026-10-29; one combined review (money + integration + UI); the fixes below were each traced in code by the review and reproduced or tested here.*

**Seams fixed in the merge:** the feed now reads the loan event's real payload `{ playerId, worldId, cents, aprBp }`; leaderboards gained the `settings({ worldId })` service the feed uses for `hide_amounts`; `config/vdaa.json` order is `... bills, stress, outfitters, ... leaderboards, life, today, feed`.

**Fixed after review:**
- **No balloon after a miss.** The 12th payment clears everything only when no payment was missed; after a miss the term stretches at the regular payment (the added interest and $25 fees could otherwise make the last payment unaffordable, and every month would be another miss).
- **Bills' repeat "late" emits count half.** Bills re-emits `late` every tick for an unpaid bill; a bill's first late month now counts +10 (`first: true` on the event), each later month it stays unpaid +5 (cap +30 as before), so a 12-month advance cannot push a student into an automatic loan over one forgotten bill. Migration `002_late_again`.
- **`module.stress.payment` reaches leaderboards:** a missed loan payment is a late mark for the On time part and the "Paid every bill on time" flag.
- **`seasonClose` closes open loan rows** (the next world reuses the same ledger account).
- **The emergency loan button asks for confirmation** (amount, APR, term).
- Doc lines about `leaderboards.settings` and the loan payload updated.

**Decisions kept as built:** every "late" re-emit still counts (at half) rather than once, so a bill left unpaid for months keeps a student's stress up; the loan disbursement is `loan -P / chequing +P` (mortgage pattern), not `mint`, so it does not change the money supply; the Stress card is a home card (cards cannot sit on the Bank page).

**Not done (6b's job):** `module.housing.evicted` has no emitter yet; the market-event town item needs a one-line `module.housing.market` emit.

## As built (6b landlords)

*Branch `p6b-landlords`, cut from main `f525a5d` (`v13-pieces`). One editor. Tests: `test/landlords.test.js` (7).*

**Two homes.** Migration `006_landlords`: `housing_homes.role` (`primary` | `rental`, existing rows `primary`), `housing_one_home` dropped, unique `housing_one_per_role (player_id, world_id, role) WHERE status = 'owned'`. Each home has its own mortgage account: the primary keeps kind `mortgage` (old data and tests unchanged), a rental uses `mortgage:<homeId>` (opened `allowNegative`). `debtOf`, `tickHome`, `sale`, `catchUp`, renewals, arrears and the payment history are per home. Net worth (savings' `sumBalances`, the sim's `worth`, leaderboards' `accountsOf` loop) and `core.season_reset` already take every player account; leaderboards' snapshot now prefix-matches `mortgage:` for the debt gate, savings' `/status` `mortgage_cents` sums both. Every owned home ticks every month whatever the owner's tenure (a landlord who sold the primary and lives in the shared room still pays the rental's mortgage and owner lines). A rental's bill lines carry the key suffix `-rental` (`property-tax-rental`, `condo-fees-rental`, `heating-rental`, `home-insurance-rental`, `nsf-rental`), so bills never merges them with the primary's.

**Buying a rental** (`POST /buy` / `/qualify` with `role: 'rental'`): refused as a first home this world ("not first-time", so a student who sold their primary may still buy one), refused when a rental is owned, refused while renting a classmate's unit; 20% down minimum (`RENTAL_DOWN_PCT`), which makes it uninsured (no CMHC premium); TDS adds the primary's `payment_cents` to the card minimum; income adds 50% (`RENT_INCOME_PCT`) of the NPC tier for that property (nothing is listed yet, so the expected rent is the tier); the stress test, GDS and TDS limits are the same `qualify()`. A 30-year amortization is allowed (uninsured). The purchase txn meta has `homeId` and `role` (the feed says "bought a rental condo").

**Value and payment events.** `module.housing.value` is one emit per student: the SUM of owned homes' values and of their debts (tick, purchase, sale, market event), so "latest per player" listeners (savings, leaderboards, insurance, outfitters) stay right. `module.housing.payment` per mortgage gains `homeId`, `role`, `total` (the month's payments over all homes; leaderboards stores `total` as `mortgage_payment`, so the house-poor flag and the debt-load part see both mortgages); a rental miss is late key `m:<month>:<homeId>`.

**Listings.** `housing_listings(home_id PK, world_id, rent_cents, listed, tenant_id, since_month, arrears_cents, missed_streak, notice_month, pending_rent_cents, rent_from, evictions, written_off_cents)`, (the review's migration `007_tenancy_swap` replaced the unique `(world_id, tenant_id)` index by a plain one: a tenant may hold the unit they live in until the tick plus one reservation, checked in `setTenure`), and `housing_rent(home_id, world_id, month, tenant_id, rent_cents, status paid|missed)` (PK `(home_id, month)`: never charged twice a month; reputation; the sim's tenant-months). Rent band: `rentBand(k, property)` in `modules/housing/index.js` (the one definition, routes and bots): NPC tier starter -> `apt1`, average -> `apt2`, times the price index; 60% (ceil) to 150% (floor). Routes, all `access: 'student'`, the student's own owned rental only (404 otherwise, also for a primary or another student's home):
- `POST /api/housing/list { home_id, rent_cents }` -> `{ ok, home_id, rent_cents }`; 409 when already listed. After commit `module.housing.listed { playerId, worldId, month, homeId, rentCents }`.
- `POST /api/housing/unlist { home_id }` -> `{ ok, home_id }`; 409 while a tenant lives there or has reserved it.
- `POST /api/housing/rent { home_id, rent_cents }` -> `{ ok, home_id, rent_cents, from_month }`: at once while vacant; with a tenant (or a reservation) `from_month = month + 2`. After commit `module.housing.rent_changed { playerId, worldId, month, homeId, rentCents, oldCents, fromMonth, tenanted }` (the feed item is written when announced).
- `POST /api/housing/end-tenancy { home_id }` -> `{ ok, home_id, moves_out_month }`: a resident gets `notice_month = month + 1` (409 if already given; the tenant cannot cancel it); a reservation not yet moved in is cancelled at once.
- `GET /api/housing/market` -> `{ month, tiers: [{ id, name, rent_cents, deposit_cents }], listings: [{ home_id, tenure: 'unit:<id>', landlord (username), property_name, rent_cents, npc_cents, months_vacant, reputation }] }`: vacant listed units of the student's own CLASS only, never their own.
- `GET /api/housing/state` gains `rental` (the home view + `listing` + `band`), `unit` (the classmate's unit rented or reserved: landlord, rent, pending rent, arrears, missed_streak, notice_month, moving_in), `buy_rental` (offers at 20% down when allowed); `past_homes` rows gain `role`. `/sell` and `/catch-up` take an optional `home_id` (default: the primary, as before).

**Renting.** `POST /tenure { tenure: 'unit:<homeId>' }`: the tenant must own no home; the unit must be listed, owned, in this world and the landlord in the same class (else 404); not their own (400); taken -> 409. The unit is RESERVED at the request (`tenant_id` set, `since_month = month + 1`), so a second classmate gets a 409 at once; asking for anything else releases the reservation, and the move applies at `pending_from` as any move (`applyPending` checks the reservation still holds, else the student goes to the shared room). No deposit (an NPC deposit is refunded at the move). A tenant gives notice by asking to move anywhere (next month).

**Rent each tick.** The tick runs students living in (or moving into or out of) a unit first, then everyone else, each in its own savepoint, so the rent reaches the landlord before the landlord's own mortgage debit. Announced rent changes apply first (one module-wide UPDATE). Rent: one txn `housing.rent` tenant chequing -rent / landlord chequing +rent (+ arrears in the same txn when chequing covers both), meta `{ month, homeId, tenantId, landlordId, rent, arrears }`; `module.housing.payment { kind: 'rent', onTime: true, ... }`. Short (no partial rent): arrears += rent, `missed_streak` + 1, the $45 NSF fee posted `housing.rent_nsf` chequing -> sink when chequing has $45, else added to the arrears (owed to the landlord); `payment { onTime: false }` (credit late mark `housing/rent`, stress +20, leaderboards late `r:<month>`). The third miss in a row: eviction: the tenant to the shared room at once (`setShared`), the arrears written off (`written_off_cents`, no ledger post: rent never received), `evictions` + 1, the listing stays listed and vacant from that month, `module.housing.evicted { playerId, worldId, month, homeId, landlordId, writtenOffCents }` (stress +25, feed "was evicted"), audit `housing.evicted`. The tenant was housed in the eviction month (no catalogue rent for it). When a tenancy ends any other way (notice, the tenant's move, a sale, a cancelled reservation), arrears left are collected (`housing.rent`, rent 0): all of it, or what chequing holds (never below zero), and only the rest written off; a tenant buying a home must cover the arrears too and pays them before the purchase. The spec requires a write-off only at eviction; the rest is this branch's rule.

**Bills.** `module.housing.costs` carries `housed`: an owner in their home, an NPC rental (incl. parents), or a classmate's unit (with `lines: []`) -> true; a landlord in the shared room -> false (they pay the shared-room rent plus the rental's lines). Bills stores it per month in `bills_housed` (migration `011_housed`) before the empty-lines return and with the same one-month shift when it arrives after bills issued that month; the predicate is the flag when present, else (an older payload) "any housing- line", as before. Tested: a student-unit tenant never gets the catalogue rent; the shared room still does; an NPC rental has `housing-rent` instead; a late flag applies next month without reversing this month.

**Vacancy, notices, sale.** A vacant rental pays every owner line and its mortgage. Selling a rental ends a tenancy at the sale (the tenant to the shared room, a `moved` event after commit) and unlists it; selling the primary while holding a rental is allowed (tenure -> shared). Season close: `world.closed` ends homes and sets every listing of the world unlisted with no tenant; everything is per `world_id`; `seasonAssets` gives one row per owned home. The sim's CARRIED check gained `housing listings`, `student rent`, `unit tenancies`.

**Feed** (listeners in `modules/feed`): "ninja42 listed a condo for rent at $1,400", "ninja42 moved into ninja17's condo" (the existing `moved` item: `name` is "<landlord>'s condo"), "ninja17 raised (lowered) the rent on their condo to $1,520" (when announced), "ninja42 was evicted", town "Housing: homes moved -15%" (new `module.housing.market { worldId, month, pct }` from `marketMove`, inside the caller's transaction for the life service, after commit for the teacher route), "bought a rental condo for $150,000".

**Leaderboards.** Migration `004_rent_gouge`: `leaderboards_inputs.gouge_months`, +1 for the landlord each rent month (paid or missed: "with a tenant") at `rentCents >= 140% x npcCents` (from the rent payment event; no housing table read). Flag 7 `rent_gouger` ("Rent gouger") at >= 6 months (`GOUGE_PCT`, `GOUGE_MONTHS` in `modules/leaderboards/constants.js`). Rent payments count on time / late for the tenant like a bill.

**Bots** (`simulate`, hash dice only): from month 30, an owner in its class's top quarter by chequing + HISA + GICs (the liquid worth the buy rule already computes; no extra scan) with no rental buys one with `dice < 10` a month (starter first, 20% down, same `quote`) and lists it at the NPC tier. A renter bot owning nothing in the shared room or an NPC apartment (not parents) looks once a year (`month % 12 === id % 12`) and with `dice < 30` takes the cheapest vacant unit in its class **if the rent is at most 40% of its gross** (deviation, below). Bots with a unit (living there or reserved) skip the parents/roommate preference and the primary-purchase rule (a tenant bot never buys a home; `buy()` would end the tenancy correctly, the skip only keeps the bots simple). Rent goes through the same tick. No student UI shows a raw account kind, so `mortgage:<id>` is never displayed.

**UI** (`modules/housing/ui/housing.js`, `teach.js`): "Classmates' units for rent" (landlord, place, rent, % of the going rent, months empty, reputation, a Rent button with a confirm and an aria-label naming the landlord and rent; hidden for owners); the tenant's view (rent, pending change, notice, unpaid rent); "Your rental" (value, mortgage, payment, owner costs, rent and band, tenant or Vacant, unpaid rent, evictions; List, Change rent with the two-month notice in the confirm, Unlist, End tenancy, Pay the arrears, Sell my rental, built once so a typed rent survives a refresh); "Buy a rental" (property, down payment seeded at 20%, Check through `/qualify` with `role: 'rental'`, Buy with a confirm). Teacher: per class "Student rentals" (landlord, place, rent and pending change, going rent, rent vs going, tenant or Vacant and notice, unpaid rent, months empty, evictions) inside the existing `GET /teach` (no new teacher route; B13's `classesFor(user)` count unchanged at 16). Text via `h()`/`textContent` only, no inline styles or handlers. Checked in the browser at 375 px (no horizontal scroll, every button named) as a landlord, a tenant and the teacher. Two `replaceChildren(..., null)` spots that printed the word "null" (one new, one already on main in the buy text and the lender's verdict) were fixed.

**Deviations and decisions.**
- Renter bots take a unit only at rent <= 40% of gross (the brief says only "cheapest listing, 30%"): at 30% almost no bot could afford a $1,290+ unit (2 tenants in 300 at month 60); without a gate low earners would move into units they cannot carry next to their bills.
- The 50% rent income at purchase is 50% of the NPC tier (nothing is listed yet).
- The unit is reserved at the request (one tenant per unit, immediate 409), not decided at the tick.
- A landlord's end-tenancy is stored as `notice_month` on the listing and acted on in the rent pass, so the tenant cannot cancel it by re-asking.
- The rent NSF fee goes to the sink from chequing, else is added to the arrears (so, if later cured, it reaches the landlord, as a landlord's own NSF charge would).
- A rent change of a vacant unit applies at once; only a tenanted (or reserved) unit needs two months' notice. The 60-150% band is checked when a rent is set or announced, not again when the price index moves the tier.
- Reputation = rent months paid on time minus months missed, over the landlord's units this world (the brief's definition; the spec's "disputes" do not exist).
- The market shows the same class only (privacy and fairness); the teacher sees every class's rentals.
- Sim bills/pay adds the PAID `housing.rent` of the month for each tenant (ledger kind, as briefed), so a missed rent month lowers that tenant's figure.

**Known gaps.** Student rent is off in a class until the teacher turns on payments between classmates (review fix 7). Credit's history keeps one `housing` mark per (month, kind): a landlord paying both mortgages the same month gets one mark, and two misses one late mark (the score is unaffected in kind, slightly in count). No teacher lever over tenancies (end, waive arrears). A tenant cannot pay rent arrears by hand (they clear with the next rent that chequing covers, or at move-out). `module.housing.payment` rent events are not counted by `stress` beyond the missed ones (on-time rent does not lower stress by itself; the calm-month rule already applies).

**Numbers (2026-10-29, this branch).** `npm test`: 513 pass, 0 fail (economy guard 77 s). `npm run sim -- --months=60` (300 bots): rentals owned month 48 / 60 = 1 / 6 (2.0% of students), listed 6, let 4, 24 tenant-months, 0 evictions, average rent 100% of the NPC tier; homeowners (distinct students) 95 (31.7%), owners in arrears 0.0%, bills/pay 57.1% (student rent counted), Gini 0.331, audit OK every month. `--teacher`: rentals 5 (1.7%), let 3, 27 tenant-months, 0 evictions; homeowners 30.7%, bills/pay 57.1%, Gini 0.310; season close + new world starts clean (CARRIED includes listings, student rent, unit tenancies), audit OK. `node scripts/perf.mjs payday=500 month300=1000`: payday 375 ms, month300 590 ms. Guard lines added to `test/economy.test.js`: rental owners < 25% of students at month 60, evictions < 0.2 per tenant-year (none happen in the sim; the eviction path is covered by `test/landlords.test.js`).

**Fixed after review (round 1).** Each has a test in `test/landlords.test.js` ("review 1" to "review 7").
1. **An announced rent change no longer follows a leaving tenant to the next one.** `leaveUnit` (every end of a tenancy or reservation) applies `pending_rent_cents` at once (a vacant unit's rent changes at once) and clears it, so the next tenant pays what the market showed. The same covers "accept a reservation, announce a rise, cancel it".
2. **Arrears are not written off when the tenant can pay.** A tenant buying a home needs chequing for the down payment, closing costs and the rent arrears, and the arrears are collected before the purchase. Any other move-out collects what chequing holds (never below zero) and writes off only the rest. Eviction still writes everything off (the spec).
3. **Moving between units is never a 500.** From a lived-in unit straight to another (held until the tick, one reservation besides) and a reservation swapped for another (the old one released first). The unique index became a code check (migration `007_tenancy_swap`). A unit you live in or have reserved is never offered to you in the market.
4. **TDS counts the other home for either role.** A landlord who sold the primary and buys again is judged with the rental's payment. Half of the rent a let rental is let at counts as income.
5. **The teacher's warning covers every home** (any missed-in-a-row streak at 3+). The rentals table shows the rental's mortgage owed and its mortgage arrears, besides the tenant's unpaid rent.
6. **A sale of a let rental keeps the tenant's planned move** (only the tenure becomes the shared room).
7. **Student rent follows the class's bank-basic switch for payments between classmates.** `POST /list` and `/tenure { tenure: 'unit:..' }` get a 409 when `transfers_enabled` is off, read through a new read-only service `bank-basic.transfersEnabled({ classId }) -> { enabled }`. The state has `student_rent`, and the UI hides the Rent and List buttons with a note. Tenancies already running keep paying rent if the teacher turns it off. Transfers are OFF by default, so a class has no student landlords until its teacher turns payments on; `scripts/sim.mjs` turns them on for every sim class (bank-basic has no bots, so nothing else changes). Otherwise the 60-150% band is the only cap: at most 150% x $1,635 = $2,452.50 a month per landlord-tenant pair at price index 1.0. The teacher sees every listing in the housing panel.
8. **Guard.** `test/economy.test.js` rental owners < 10% at month 60 (observed ~2%). The eviction guard stays, but it is vacuous in the 300-bot sims (0 evictions in every run). The eviction path is covered only by "missed rent: ... eviction after three misses". A bot-driven eviction test was not added: forcing a renter bot onto the yearly roll and then starving it is not cheap.

**Numbers after the review fixes (2026-10-29).** `npm test`: 519 pass, 0 fail (13 landlord tests; economy guard 76 s). `npm run sim -- --months=60`: rentals 7 (2.3%), all 7 listed, 6 let, 55 tenant-months, 0 evictions, rent 99% of the NPC tier (the run's other columns were not kept). `--teacher`: rentals 5 (1.7%), let 2, 15 tenant-months, 0 evictions; month 60 homeowners 94 (31.3%), owners in arrears 0.0%, bills/pay 57.1%, Gini 0.314, audit OK every month, season close + new world starts clean. Perf: payday 368 ms (limit 500), month300 574 ms (limit 1000).

## As built (6c employers)

*Branch `p6c-employers`, cut from main `71ec59b` (`v14-landlords`). One editor. Tests: `test/employers.test.js` (5), `test/ventures-4b.test.js` (10, ported), `test/ventures.test.js` (16, as merged).*

**What was merged from each side.** Two merge commits, then the 6c decisions on top:
- `p4a-ventures` (tip `e2ab884`): the 4a module (registry, team and split, treasury, products, statements, storefronts with the Outfitters item), fix round 1 (stock-limited town demand, the town's own shop at 40% of the choke price, spending caps per buyer, leaving and capital refunds before opening, removing an unpaid founder), the rent rounds and the paused WIP: a **fixed 300-resident NPC town** (`TOWN_SIZE`, `options.ventures.townSize`) and a **fixed $50 rent x the price index**. Also leaderboards' `ventures_value` (net worth, Founder of the Season), outfitters' Venture Row items, sim columns.
- `p4b-ventures` (tip `00fba3a`, built on the 4a first build `9267049`): payroll from the treasury through jobs (`hireForBusiness`, `endBusinessJob`, `staffOf`; ventures `payroll`), the employer's CPP and EI, missed pays and reputation, layoffs with notice or pay in lieu, small business tax with losses carried forward, GST, the Venture Bank, postings and applications, hire approval, Best Employer, bots' companies hiring.

**Conflicts and how they were resolved.**
- *Demand.* p4b never touched p4a's `townDemand`; p4a's WIP is the demand code as merged. p4b's GST on town sales is computed from the `npc_cents` flows p4a's tick writes, so it works unchanged with the shop and the stock cap.
- *Stakes.* p4a's (a company that never opened is worth each founder's capital; otherwise the exact pro-rata split a dissolution pays) with p4b's limited liability (book value net of the loan and taxes owed, never below 0).
- *Storefront.* p4a's per-buyer caps are on the price; p4b's GST is charged on top (the buyer pays price + GST).
- *Statements.* Both sets of lines: rent (4a) and wages, employer share, interest, fees, forgiven loans, tax (4b); the balance sheet carries the loan, GST payable and tax owed; operating cash pays rent; financing nets refunds. Income tax counts rent as an expense (p4b's formula did not know about rent; fixed in the merge).
- *Bots.* Production keeps two months of rent (4a) **and** next month's payroll and loan payment (4b) back.
- *Freeze.* Unfreezing resets the rent count (4a) and is refused while the loan is in default (4b).
- *Migrations.* Neither branch was ever merged, so their ids were renumbered after main's: ventures `001_ventures`, `002_rent_refunds` (4a), `003_payroll_tax_loans` (4b; 6c adds `ventures_postings.slots` and `ventures_companies.missed_month` in it); jobs `006_business` after main's `005_auto` (rewritten for 6c in place: never applied anywhere); leaderboards `005_ventures_value`, `006_ventures_employer` after main's `003_stress_flags`, `004_rent_gouge`. No applied migration was edited.
- *Services objects.* Both branches added a second `services:` key that silently replaced main's: jobs now has one object (`todayFacts`, `endHolding`, `hireForBusiness`, `endBusinessJob`, `staffOf`); outfitters has one `grantItem` (an `itemId` is the earned item as on main; a `sector` is the Venture Row item, `{ itemId, name, granted }`).
- *Config order.* `... exchange, savings, ventures, leaderboards, life, today, feed` in both courses. `test/db.test.js` now allows ventures between savings and leaderboards: ventures' tick moves only business treasuries and system accounts (never a student's), and leaderboards reads the stakes ventures announces in the same tick.
- *Fuzz BASE.* The two merges would have repeated `plan` (life / ventures) and `title` (today / ventures) keys; one key reaches both parsers. Added `slots`, `business_id`.

**The 6c decisions, as built.**
1. **On top, part-time.** `hireForBusiness` never calls `leave()`. `jobs_business` is keyed `(player_id, business_id)`, hours 10-40 (`BUSINESS_MAX_HOURS` 40), at most 2 company jobs (`BUSINESS_MAX_JOBS`) and 40 hours in all, one per company (409 otherwise). `leave()` (quit, switch, a teacher's removal) ends only the catalogue job. Pay stubs are unique per `(player, world, month, kind, COALESCE(business_id, 0))` (an expression index: SQLite treats NULLs as distinct, so a plain UNIQUE with `business_id` would not stop two catalogue stubs). **Payday is one pass per student**: the catalogue pay, then each company job (each its own T4127 stub on its own period's gross, with the year to date of every stub before this month: two employers each withhold as if they were the only one, which is also how real payroll works), then **one `module.jobs.paid` with the month's totals** (stress, outfitters and leaderboards keep "the last pay" and would otherwise have seen only the last stub; bills, credit, housing and exchange add, and see the same sum). A layoff's pay in lieu of notice sends its own `paid`.
2. **Slots and the wage floor.** `ventures_postings.slots` 1-5 (default 1), the posting closes when that many are hired and its other applicants are marked withdrawn. The floor is `options.ventures.minWageCents` (default 1500, never below) x the price index, checked at posting and again at hire ("prices have risen: close it and post again").
3. **Short treasury.** As 4b built it (no pay, no stub, reputation -500, `missed_paydays`, `module.jobs.unpaid`). 4b's `POST /api/jobs/back` is gone (404); `POST /api/jobs/quit-business { business_id }` quits one company job. **Deviation:** quitting is allowed at any time, as 4b's `/quit` always allowed; from 2 misses the job's note says "you may quit this job (your Job Centre job is not affected)" and the Quit button is the primary one. Nothing in the UI talks about "going back" any more.
4. **Retired students** get a 409 from `/apply` and from `hireForBusiness` (life's `retired`), and `GET /openings` returns `retired: true` and no openings. **Retirement ends every company job**: `endHolding` deletes them with the catalogue job (no pay in lieu: retirement is the student's own end of work) and returns `businessIds`. `jobs_class_off` does not apply to company jobs: the board is town-wide (FT10 employees are in other classes), said on the teacher panel. Bots respect slots and `MAX_STAFF` (they go through `hireNow`).
5. **Feed.** `module.ventures.hired { playerId, businessId, title, wageCents, hoursPerMonth, hirerId, company, classId, worldId, month }` (after commit), `module.ventures.payroll_missed { businessId, month, worldId, classId, company }` (in the payday, once per company and month however many staff went unpaid, kept by `ventures_companies.missed_month`), `module.ventures.laid_off { playerId, businessId, mode, endsMonth, company, classId, worldId, month }` (after commit). The spec's minimal payloads gained the fields the feed needs without reading ventures' tables. Items: "ninja42 hired ninja17 at $17.50/h" (the hirer's class, and the employee's when it is another class; the amount follows `hide_amounts`), "Missed payroll at <company>" (the company's class), "ninja17 was laid off from <company>". Company names already pass ventures' name rule (3-40 letters, digits, spaces, `& ' . , ! -`, blocklist) and are clipped to 40 again in the feed; text only through `textContent`.
6. **Flag `missed_payroll`** ("Missed payroll"): from the `missedPaydays` that `module.ventures.value` already carries into `leaderboards_inputs.ventures_missed` (the company's count, which never goes down in a season), so no new listener or migration: a founder (shareholder) whose company missed at least one pay. Employees are never flagged.
7. **Economy.** Guard unchanged and green with ventures in both courses (numbers below).
8. **UI.** Job Centre: your job, then each part-time company job (wage, hours, notes, notice, a named Quit button); the board marks your employers, shows places left and "over your 40 part-time hours"; copy says part-time on top. Venture Row staff card: places (1-5), filled counts, aria-labels naming the person on Hire / Decline / Give notice / Lay off / Close. Teacher: a per-class "employers" table (status, staff, pays made, pays missed, loan owed, tax paid, tax owed) above the company cards. All text via `h()` / `textContent`, no inline styles or handlers (`h()` binds `on*` with `addEventListener`), no tool names in copy.

**Payload and route changes** are listed in docs/modules.md ("Wave 6c") and docs/events.md section 12.

**Tuning table (docs/phase4.md "Balance"), rerun on the merged code.** A lone company selling all 3 of its sector's products at the profit-maximising price against the town's shop, before spoilage, index 1.0, less the $50 rent, per founder in a team of 2, as a share of the sim's median net pay at month 36 ($2,409.28, the same figure as 4a's table). With the fixed 300-resident town every school size sees the old "300 students" row; the numbers match that row ($498 / $213 before), so the WIP changed the small-school economics only, as intended. The last column is the part-time hours that month's profit pays at $15.00/h plus about 8% employer CPP and EI.

| Sector | Company profit a month | Per founder (share of median net) | Staff hours it could pay |
|---|---|---|---|
| Convenience retail (best) | $997 | $499 (20.7%) | 61 |
| Business services | $821 | $411 (17.1%) | 50 |
| Warehousing and freight | $766 | $383 (15.9%) | 47 |
| Customer service tech | $755 | $378 (15.7%) | 46 |
| Electrical contracting | $748 | $374 (15.5%) | 46 |
| Food and drink | $719 | $360 (14.9%) | 44 |
| Clothing retail | $553 | $277 (11.5%) | 34 |
| Restaurants (worst) | $428 | $214 (8.9%) | 26 |

Inside 4a's target (best 15-25%, worst break-even to 10%). A company can carry one or two 10-40 h part-time staff, which is why the on-top rule was chosen. **No demand constant was changed:** the guard passed as merged.

**Numbers (2026-10-29, this branch).** `npm test`: 550 pass, 0 fail (124 s wall). Economy guard (`test/economy.test.js`, ventures in both courses, 100 bots, teacher actions): green, 33 s alone. `npm run sim -- --months=60` (300 bots): audit OK all 61 months, 0 statements out of balance; bills/pay 69% → 57%, homeowners 31.3% at month 60, owners in arrears 0.0%, Gini 0.310 / 0.339 / 0.322 / 0.327 / 0.331 (months 12-60; the 6b sims had 0.331 at month 60), open emergency loans 10.3%, rentals 2.3%, errand cash 0.040% of pay. Companies 9 (27 founders) at month 12, 6 (18) from month 24; median margin 13-24%; revenue about $4,700-5,150 a month (all companies); founders in the Town board's top 10: 3-5; part-time employees 1-4 (0.3-1.3% of bots); pays made / missed 158 / 0 by month 60; 1 loan, 0 defaults; income tax paid $3,503; GST remitted $0 (no company reached the $30,000 threshold or registered). `--teacher`: audit OK all 61 months, Gini 0.307 / 0.336 / 0.308 / 0.305 / 0.312, bills/pay 57.1%, homeowners 31.0%, arrears 0.0%; companies 7 (21), 2 part-time employees, pays 104 / 0, 2 loans, 0 defaults, tax $4,372; season close + new world starts clean, audit OK. `node scripts/perf.mjs payday=500 month300=1000`: payday 348 ms, month300 517 ms.

**Known gaps.** No missed payroll happens in the sims (bots hire only with three months of payroll in the treasury), so the miss path is covered only by `test/employers.test.js` and `test/ventures-4b.test.js`. Bot employment stays small (≤ 1.3%). (`todayFacts.hasJob` now counts company jobs: review fix 6.) A layoff's pay in lieu sends its own `module.jobs.paid`, so "last pay" listeners see only that stub until the next payday. No `module.ventures.wage_raised` (wages are fixed per posting; a new posting is the raise) and no "Walked for a better offer" flag: the 6c brief scoped the feed to hired / payroll missed / laid off and the flags to missed payroll. A dissolution, the season close and retirement end company jobs without a feed item. The 375 px browser check of the changed panels was not run in this branch (syntax test only).

**Fixed after review (round 1).** Each has a test in `test/employers.test.js` ("review 1", "review 2", "review 3, 4, 6"), and each test fails with its fix reverted.
1. **A Venture Bank loan can no longer become the founders' wages.** Two founders could put in $100 each, borrow $5,000, hire themselves at $60/h and keep about $2,100 each while the loan stayed unpaid (the season close zeroes the loan account). `payroll()`, the one point every pay goes through, now pays an **owner** (an accepted founder or any shareholder) only when the treasury after the pay still covers what the company owes (`liabilitiesOf`: the loan, GST payable, tax owed): owners are paid from equity, never from borrowed cash. Otherwise it is the short-treasury path (no pay, reputation, `payroll_missed`). It holds when the loan comes after the hire too, and for pay in lieu. A non-owner employee is paid as before. `/post-job` caps the wage at `options.ventures.maxWageCents` (default $150.00, 10 x the minimum) x the price index. At season close `seasonAssets` settles with write-off: what the treasury cannot pay of the loan is `written_off` with `forgiven_cents`, no longer recorded as `settled`.
2. **Bots no longer get stuck on stale postings.** Before reusing or posting one, a bot company closes its open postings under today's wage or at other hours (applicants are told), so the price index can no longer block hiring forever (tested at index 1.20).
3. **A second pay in lieu from the same company in one month** is a 409, checked before the stub index could throw a 500.
4. **Posting titles** (shown town-wide): control characters become spaces, at most 60 characters, and the company-name blocklist applies (one `blocked()` helper for both).
5. **`scripts/sim.mjs` CARRIED** checks `jobs_business` is empty after the close (the table is not per world).
6. **`jobs.todayFacts`**: `hasJob` is true for the catalogue job OR any company job (stress's jobless +15 and the pick-a-job errand read it); `hasCompanyJob` is the new separate fact.

**Numbers after the review fixes (2026-10-29).** `npm test`: 553 pass, 0 fail (123 s). `npm run sim -- --months=60`: audit OK all 61 months, 0 unbalanced statements; Gini 0.308 / 0.335 / 0.317 / 0.323 / 0.328; bills/pay 57.1%, homeowners 31.0%, arrears 0.0%; companies 9 (27) then 6 (18), median margin 9-18%, part-time employees 2-3, pays 137 / 0 missed, 1 loan, 0 defaults, tax $3,471. `--teacher`: audit OK all 61 months, Gini 0.309 / 0.336 / 0.309 / 0.308 / 0.312, bills/pay 57.1%, homeowners 31.0%; companies 7 (21), 2 employees, pays 104 / 0, 2 loans, 0 defaults; season close + new world starts clean (now including `company jobs`), audit OK. Perf: payday 351 ms, month300 522 ms.
