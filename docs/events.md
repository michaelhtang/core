# Domain events (MIGRATION.md Step 3)

Goal: anything that changes state a client cares about emits an event from inside the kernel. Core events fire after the transaction commits; module events fire either inside the emitter's transaction or after its commit, as section 3a lists. The HTTP/SSE layer is just one subscriber (it relays only after commit). Modules never get `notify`.

## 1. `withTxn` gains `onCommit`

```js
withTxn(db, (tx) => {
  ...writes...
  tx.onCommit(() => events.emit('x', payload));   // runs after the OUTERMOST COMMIT
  return result;
});
```

Semantics, exactly:

- `fn` receives `tx = { onCommit(cb) }`. Existing callers that ignore the argument keep working.
- Per database handle, keep a stack of frames in a `WeakMap<DatabaseSync, Frame[]>`. A frame is `{ name, callbacks: [] }`. Opening an outer transaction pushes frame 0 (`BEGIN IMMEDIATE`); a nested call pushes a savepoint frame named `sp<depth>` (depth = stack length, so names are unique per handle and the module-level `savepoints` counter is deleted).
- `tx.onCommit(cb)` appends to the **current (top)** frame.
- Nested success (`RELEASE`): pop the frame and **append its callbacks to the parent frame**, in order.
- Nested failure (`ROLLBACK TO; RELEASE`): pop the frame and **discard** its callbacks.
- Outer success: `COMMIT`, pop, then run the callbacks in registration order. Each is wrapped: an exception is logged (`console.error('[onCommit]', e)`) and never thrown to the caller, and never stops the remaining callbacks.
- Outer failure: `ROLLBACK`, pop, discard.
- If `fn` returns a Promise: throw as today, before COMMIT (so nothing commits and nothing fires).
- Calling `tx.onCommit` after `withTxn` returned (captured `tx`) throws `Error('onCommit called outside its transaction')`.

Also export `afterCommit(db, cb)`: if `db.isTransaction` and a frame exists, append to the top frame; otherwise run `cb` immediately (same try/catch). This lets code that does not own the transaction (ledger.post called inside someone else's withTxn) defer correctly.

## 2. `lib/events.js`

```js
export function createEvents({ log = console } = {}) → {
  on(type, fn)  → returns off()        // type is an exact string, or '*' for all
  emit(type, payload)                  // synchronous; each listener in try/catch, errors logged with the type
  listenerCount(type)
}
```

No wildcards beyond `'*'`, no async, no ordering guarantees between listeners beyond registration order. `app.events = createEvents()` in `lib/app.js`, created before the ledger so the ledger can take it. Module listeners (a module's `events` field) are wrapped once more by `lib/modules.js`; see section 3a for what a failure does.

## 3. Events (names and payloads are the contract)

The core events in this table are all emitted through `afterCommit`/`tx.onCommit`, never mid-transaction. Module events (`module.<id>.<name>`, the rows from `module.jobs.paid` on and sections 7 to 9) may fire inside the emitter's transaction; section 3a has the exact list.

| Type | Emitted by | Payload |
|---|---|---|
| `ledger.posted` | `ledger.post()` (also covers reverse and transfer) | `{ txnId, kind, actor, legs: [{ account, cents }], owners: [{ type, id }] }` — `owners` is the distinct `(owner_type, owner_id)` of touched accounts, excluding `system`; `type` is `player` or `business` |
| `world.month` | `world.advance()`, once per call (not per month) | `{ from, month, worldId }` |
| `world.settings` | `world.setSettings()` (`setMonthsPerDay()` calls it) | `{ worldId, months_per_day, auto_advance }`: both fields, always, whichever one changed; `auto_advance` is `manual` or `school_days` |
| `world.closed` | `world.close()` (Step 7) | `{ worldId }` — after the season-close transaction commits; every stream (students and teachers) gets a `world { worldId }` hint. Cleanup that must happen belongs in the `seasonClose` hook, not here |
| `world.created` | `world.create()` | `{ worldId }` — after commit; every stream gets a `world { worldId }` hint (students re-sync, and `/api/me` runs `onLogin` in the new world) |
| `session.revoked` | `players.endSession`, `resetPin`, `setPassphrase`, `purgeSessions` | `{ playerId, tokenHash }` for endSession (single session); `{ playerId }` for resetPin/setPassphrase (all of a player's sessions); purgeSessions emits one `{ playerId, tokenHash }` per purged row (SELECT the rows first, then DELETE, same txn) |
| `class.created` | `players.createClass` | `{ classId, course_id }` |
| `players.created` | `players.createStudents` | `{ classId, playerIds }` |
| `module.<id>.<name>` | modules (bank-basic: `module.bank-basic.settings` `{ classId }`) | module-defined |
| `module.jobs.paid` | jobs payday, once per student per month paid (6c: the catalogue pay and any part-time company pays together, `net` and `gross` the month's totals; a layoff's pay in lieu of notice sends its own), **synchronously inside the advance transaction** (not after commit, on purpose: a listener's writes commit or roll back with the pay) | `{ playerId, worldId, month, net, gross }`; bills listens |

**worldId.** Every module event about a player's state in a season carries `worldId` (housing.value and .payment, bills.paid and .late and credit.score gained it in Phase 4 prep). A listener books the row on the payload's `worldId` and falls back to `k.world.current()` only when it is missing (an older emitter, a test).

## 3a. Module events: inside the transaction or after commit, and what a listener failure does

`k.events.emit(name, payload)` is synchronous: every listener runs before `emit` returns. So an event emitted directly in a tick or inside a `k.db.txn` block reaches its listeners **inside the emitter's transaction**, and their writes commit or roll back with it. An event emitted from `tx.onCommit` reaches them **after commit**, outside any transaction. From the code (`k.events.emit` call sites):

Inside the emitter's transaction:

| Event | Where |
|---|---|
| `module.jobs.paid` | payday (tick), per student |
| `module.bills.paid` | inside each payment's transaction: manual pay, Pay all, autopay in the tick |
| `module.bills.late` | tick, per late line |
| `module.bills.choices` | tick, at a student's first billed tick (a plan change sends it after commit) |
| `module.credit.score`, `module.credit.statement` | tick, per student with a file / card |
| `module.housing.costs`, `module.housing.payment` | tick, per student |
| `module.housing.value` | tick, per owner |
| `module.insurance.costs`, `module.insurance.expense` | tick, per student (`expense`: a town event that cost money) |
| `module.outfitters.unlocked` | wherever an achievement unlocks: the tick, or a listener running inside one |
| `module.outfitters.goal` | tick, per class |
| `module.exchange.value` | tick, per holder |
| `module.ventures.value` | tick, per shareholder |
| `module.ventures.payroll_missed` | jobs' payday (the tick), through ventures' `payroll` service: once per company and month a pay was missed (6c) |
| `module.rates.changed`, `module.rates.pending` (`pendingBp: null`, the applied change) | tick |
| `module.savings.snapshot` | tick, per student with a HISA |
| `module.housing.moved` | tick, per student whose pending move takes effect (`{ playerId, worldId, month, tenure, name }`); the feed's "moved into ..." (6b: also when a landlord's notice ends a tenancy; `tenure` may be `unit:<homeId>`, `name` then "ninja17's condo") |
| `module.housing.payment` kind `'rent'`, `module.housing.evicted` | housing (6b), the tick: each student-unit rent month, and the third missed month in a row (payloads in section 7) |
| `module.housing.market` | housing (6b), inside the caller's transaction when the life module's `marketEvent` service runs it (after commit for the teacher's `POST /market`): `{ worldId, month, pct }`; the feed's town item |
| `module.life.stage` | tick, once per world when the world month enters a new life stage: `{ worldId, month, age, stage }` (no listener yet) |
| `module.retirement.coverage` | retirement (5c), the tick, once per student per month in Stage C (age 55+): `{ playerId, worldId, month, coverage, ratioBp, shortfallCents, lastsUntilAge }` (ratioBp = income / bills in bp, uncapped): the live check (coverage 0-100 = retirement income after tax / this month's bills, capped; the projection's age, 100 = "100 or later"). leaderboards keeps `coverage` and `lasts_age` in `leaderboards_inputs` (the Stage C health part, Best Retirement, the `retirement_short` flag) |
| `module.stress.score`, `.loan`, `.loan_closed`, `.payment` | stress (6a): the tick per student; `.loan` also inside the student's `POST /api/stress/loan`. Payloads in docs/modules.md "Services" |

`today` (wave 5a) listens to the event types its errand catalogue names (`modules/today/errands.json`: `module.bills.paid`, and `ledger.posted` for a student's own `savings.move` / `exchange.contribute`). A module event that carries a `month` other than the day's month was emitted by a tick, not by the student, and is ignored; a `ledger.posted` counts only when `actor` is the student and the txn is newer than the day's start. It reads no other module's tables except bills' `bills_due` and `bills_settings` (read only, for its facts; bills has no service).

`life` (wave 5b) listens to `world.created` and `world.month` (after commit: it sets the pace when an advance crossed a plan boundary, and switches auto-advance to manual once the life is over) and to `module.jobs.paid` (inside the payday: the first payday at the retirement age is the last; it calls `jobs.endHolding`). It reads no other module's tables.

After commit (`tx.onCommit`): `module.jobs.hired` (`{ playerId, jobId, title, employer }`: `/pick` or the teacher's `/assign`, only when the job actually changed); `module.life.changed` (the world teacher edited the plan, the lock or a stage event; `{ classId: null }`); `module.jobs.promoted`, `.payday`, `.assigned`; `module.bills.changed`, `.choices` (a plan change); `module.credit.limit`, `.changed`; `module.housing.value` (purchase, sale, market event), `.changed`, `.listed`, `.rent_changed`, `.market` (the teacher's market event); a sale of a let rental also sends the tenant's `.moved`; `module.insurance.changed`, `.triggered`; `module.outfitters.bought`, `.sold`, `.changed`; `module.exchange.value` (after a trade, undo or fill), `.changed`, `.rrsp_settled`; `module.ventures.value` (after capital, a storefront sale, a dropped product or a dissolution), `.changed`, `.hired` (a founder's or teacher's hire), `.laid_off` (a layoff, notice or now); `module.rates.pending` (a teacher's queued or cancelled change); `module.savings.rate`; `module.leaderboards.settings`, `.awards`; `module.bank-basic.settings`.

**A listener that throws:**

- **Inside a transaction:** each module listener call runs in its own savepoint (`lib/modules.js`). A throw rolls back that listener's writes only, never the emitter's, and never another listener's. It is logged and recorded in `tick_failures` (module = the listener's module, `player_id` = `payload.playerId` when it is one, error `listener for <type>: <message>`, `source` = `'advance'` during an advance, `'request'` inside a student's own action such as a payment), and the emitter carries on. The world teacher sees it in the console's "Problems in recent advances" panel; one during an advance also stops auto-advance in a `school_days` world, and listener failures count toward the advance's rule that one module failing for more than half of the students rolls it back (docs/modules.md section 5). If the emitter's transaction later rolls back, the record goes with it.
- **If SQLite aborted the whole transaction** inside the listener (disk full, I/O error), there is nothing left to isolate: the error is thrown to the emitter (`emit` rethrows errors marked `toEmitter`), so the emitter stops instead of carrying on outside any transaction and auto-committing its later writes. In a tick that fails the advance.
- **After commit:** logged only (`[<id>] listener for <type> failed`); the committed work stands. Nothing is recorded.
- The core `'*'` subscribers (the SSE hub) are not module listeners and are unaffected.

`createClass`, `setMonthsPerDay` and the bank settings upsert become `withTxn` blocks (they currently write + audit outside a transaction; MIGRATION.md B-table).

## 4. The ledger

`createLedger(db, events)`. In `post()`, after the checks and before `lock.run(0)`, compute `owners` from the `touched` rows already loaded, then `tx.onCommit(() => events.emit('ledger.posted', {...}))`. Because `post()` uses `withTxn`, a post inside an outer transaction that later rolls back emits nothing.

## 5. SSE becomes a subscriber (`server.js`)

- Streams: `{ res, playerId, role, tokenHash, id }`. Index by playerId (`Map<playerId, Set<stream>>`) plus a `Set` of teacher streams.
- Every write goes through one `write(stream, event, data)` that prefixes an `id:` line (process-monotonic counter) and wraps `res.write` in try/catch (on throw: end and remove the stream).
- Subscriptions installed in `start()`:
  - `ledger.posted` → `balance` `{}` to each player owner's streams, and for a `business` owner to the streams of the students every module's `ownersOf` hook names (docs/modules.md "Business owners"); to teacher streams, `ledger` `{}` at most once per 500 ms (trailing throttle).
  - `world.month` → `month` `{ month }` to all streams.
  - `world.settings` → `world` `{}` to teacher streams.
  - `world.closed`, `world.created` → `world` `{ worldId }` to all streams (the student app's `events.world` makes it re-sync and, when the season's status changed, redraw: the "Season closed" screen or the new town).
  - `session.revoked` → end matching streams (by tokenHash if present, else every stream of playerId). Step 4 relies on this.
  - `class.created`, `players.created` → `console` `{}` to teacher streams (teacher console refetches).
  - `module.*` → the same `console` hint, coalesced: each event marks the console dirty and queues one flush on the open transaction (`afterCommit`); after the commit the first flush sends at most one `console` per 500 ms (trailing throttle, like `ledger`). An advance that rolls back sends none, and a 12-month advance at 300 students sends one instead of ~40,000.
  - `stream.push` → `k.push` (docs/modules.md "Pushing live data"): `{ to: [playerId], event, data, skippable }`; the named event goes to those players' streams only, never as `console`, and a `skippable` one is dropped while a stream's socket is backed up. Not a `module.*` event, so no teacher console hint. Events pushed this way today: `walk.presence`, `walk.presence.off`, `walk.roster`, `feed.new`, `today.done` (docs/live.md).
- `app.closing` is emitted by `server.js` `close()` before timers and streams are torn down; module `events` listeners use it to stop their own timers. It is not relayed to any stream.
- Remove `notify` from the handler context and from `bank-basic` (its `balance` pushes now come from `ledger.posted`). Keep the 25 s `ping`.
- The `/api/teach/world/advance` route no longer notifies; `world.advance()` does.

## 6. Tests (definition of done)

1. onCommit: callback runs after outer commit; nested success bubbles; nested failure discards only its own callbacks; outer failure discards all; a throwing callback doesn't break the caller or later callbacks; a captured tx used later throws.
2. `world.advance()` called directly (no HTTP) emits exactly one `world.month` with `{from, month}`.
3. A `ledger.post` inside an outer `withTxn` that then throws emits no `ledger.posted`.
4. Over HTTP: a transfer delivers `balance` to both students' streams and a `ledger` hint to the teacher stream (open `/api/stream` with fetch and read the body).
5. The welcome grant on first login emits `ledger.posted` with the student as owner.
6. `npm run sim` can attach `app.events.on('*', …)` and count events; add a `--events` flag that prints totals.

## 7. Phase 2 module events (bills)

| Type | Emitted by | Payload |
|---|---|---|
| `module.bills.paid` | bills, inside the payment's transaction (manual, Pay all, autopay; fee lines too) | `{ playerId, worldId, month, dueMonth, billId, onTime, amount }`; `month` = the month it was paid, `dueMonth` = the month it was due, `onTime` = the line was never marked late (so a line issued during a multi-month advance and paid in the next live month is on time). Credit and outfitters book it on `dueMonth` (falling back to `month` without it) |
| `module.bills.late` | bills, inside the tick, once per still-unpaid bill row due at or before the month the advance started (`startMonth`), so nobody is late for a month they never got to play; a row stays late and re-emits each tick until it is paid | `{ playerId, worldId, month, billId, monthsLate }` |
| `module.credit.limit` | credit, after commit when a card is approved | `{ playerId, worldId, limitCents, aprBp }`; bills listens and keeps the latest per (player, world), so a card pays only within this season's limit |
| `module.credit.score` | credit, each tick per student with a file | `{ playerId, worldId, month, score }` |
| `module.credit.statement` | credit, inside the tick, each tick per card holder when it issues the new statement (also with `balance: 0, minimum: 0` when nothing is owed, so a paid-off card clears it) | `{ playerId, worldId, month, balance, minimum }`; housing keeps the latest per (player, world) for TDS |
| `module.rates.changed` | rates, inside the tick: a world's first tick, each tick a queued policy change takes effect, and each tick the price index steps (months 13, 25, 37, ...) | `{ worldId, month, policyBp, primeBp, hisaBp, mortgage5yBp, mortgageVarBp, locBp, cardAprBp, inflationBp, priceIndexBp }`; `priceIndexBp` is the world price index in basis points (10000 at the season start, x (1 + inflation) each world year), `inflationBp` the annual rate in force; savings listens (HISA); **the core** keeps the latest `priceIndexBp` per world (table `price_index`, migration 013; its listener is registered before every module's, so a module listening to this event already reads the new index) and bills, housing, jobs, insurance, outfitters and leaderboards scale their prices by `k.world.priceIndex()`. Their old `*_index` tables are kept, no longer written or read. A listener that ignores the two new fields is unaffected |
| `module.rates.pending` | rates: after the commit of a teacher's `POST /api/rates/policy` (a change queued, or `pendingBp: null` when the teacher announces the rate already in force, which cancels it), and inside the tick that applies a queued change (`pendingBp: null`) | `{ worldId, pendingBp, effectiveMonth, mortgage5yBp }` (`effectiveMonth` and `mortgage5yBp` null when `pendingBp` is null; `mortgage5yBp` is rates' `derive()` of the pending rate, the 5-year fixed that `module.rates.changed` will carry); exchange keeps it in `exchange_rate_pending` and pauses DAAB and DAAG while it waits; housing keeps `mortgage5yBp` in `housing_rates_pending` and prices quotes and new mortgages at it |
| `module.housing.costs` | housing (wave 2b), each tick before bills (config order) | `{ playerId, month, lines: [{ key, name, amount, category }], housed }`; bills listens. `housed` (6b, boolean): whether the student's home replaces bills' own catalogue rent line that month (an owner living in their home, an NPC rental, a classmate's unit: true; a landlord living in the shared room: false); a tenant of a classmate's unit gets `lines: []` with `housed: true`. Bills keeps it per month (`bills_housed`); without the field, any housing line replaces the rent, as before. A rental's lines carry the key suffix `-rental` (`property-tax-rental`, `nsf-rental`, ...). If they arrive after bills already issued that month (misordered config), lines and flag apply from the next month: never a reversal |
| `module.housing.value` | housing, each tick per owner (and at a purchase, a sale and a market event) | `{ playerId, worldId, homeValue, mortgageBalance }`; 6b: the SUM over every home the student owns and the sum of those homes' mortgages (one emit per student); `homeValue` is 0 after the last home is sold. Savings keeps the latest per (player, world) and adds it to net worth |
| `module.housing.payment` | housing, inside the tick, one per mortgage debit and (6b) one per student-unit rent month | mortgage: `{ playerId, worldId, month, onTime, amount, kind: 'mortgage', homeId, role, total }` (`role` primary or rental, `total` = this month's payments over all the student's homes; leaderboards keeps it as `mortgage_payment`); rent: `{ playerId (the tenant), worldId, month, onTime, amount, kind: 'rent', homeId, landlordId, rentCents, npcCents }`. `onTime: false` when chequing could not cover it (credit marks it late; only a mortgage opens the file; stress +20; leaderboards counts both kinds on time / late, and rent at >= 140% of `npcCents` toward the landlord's rent-gouger months) |
| `module.housing.evicted` | housing (6b), inside the tick, at a tenant's third missed rent month in a row | `{ playerId (the tenant), worldId, month, homeId, landlordId, writtenOffCents }`; stress +25, feed "was evicted" |
| `module.housing.listed` | housing (6b), after the commit of `POST /api/housing/list` | `{ playerId (the landlord), worldId, month, homeId, rentCents }`; feed "listed a condo for rent at $1,400" |
| `module.housing.rent_changed` | housing (6b), after the commit of `POST /api/housing/rent` (when announced, not when it applies) | `{ playerId, worldId, month, homeId, rentCents, oldCents, fromMonth, tenanted }`; feed "raised (lowered) the rent on their condo to $1,520" |
| `module.housing.changed` | housing, after commit | `{ classId }`: the teacher console refetches |
| `module.bills.choices` | bills, at a student's first billed tick and whenever they change a plan | `{ playerId, options, autoPremiumCents }`; insurance listens (auto cover when `options.transport === 'car'`) |
| `module.insurance.costs` | insurance (wave 2b), each tick before bills (config order: `... housing, insurance, credit, bills ...`) | `{ playerId, month, lines: [{ key, name, amount, category }] }`; bills makes due lines `insurance-<key>`, same lag-not-reversal rule as housing |
| `module.insurance.expense` | insurance, inside the tick, when a town event costs a student money | `{ playerId, month, eventId, eventKey, name, amount, insuredBy }` (module events carry the emitting module's id); bills makes one due line `event-<eventId>` |

## 8. Phase 1b events (Outfitters)

| Type | Emitted by | Payload |
|---|---|---|
| `module.jobs.promoted` | jobs, after the commit of a promotion (teacher override, an approved application, or a bot) | `{ playerId, worldId, month, title }`; `title` is the new step's title. Outfitters unlocks the "Promoted" blazer |
| `module.savings.snapshot` | savings, inside the tick, once per student with a HISA, right after the net worth snapshot row | `{ playerId, worldId, month, hisa, netWorth }` (cents); outfitters' "Emergency fund" umbrella |
| `module.outfitters.bought` | outfitters, after commit | `{ playerId, itemId, category, cents }`; `cents` is price + GST |
| `module.outfitters.sold` | outfitters, after commit | `{ playerId, itemId, cents }` |
| `module.outfitters.refund` | outfitters, inside the sale's transaction | `{ playerId, worldId, cents, boughtMonth }`: the part of a card-bought item's resale paid back to the card; a credit, not a payment: credit counts it toward paying the open statement in full only if the purchase was on it (`boughtMonth` < the statement's month) |
| `module.outfitters.unlocked` | outfitters, when an achievement unlocks (once per player per world) | `{ playerId, key, itemId }` |
| `module.outfitters.goal` | outfitters, inside the tick, when a class unlocks a Wolf outfit | `{ classId, goal, outfit, month }` |
| `module.outfitters.changed` | outfitters, after commit | `{ classId }`: the teacher console refetches |

Outfitters listens to `module.credit.limit` and `module.credit.score`, `module.housing.value`, `module.bills.paid` and `.late`, `module.jobs.paid` and `.promoted`, and `module.savings.snapshot`. It reads no other module's tables.

## 9. Leaderboards (Phase 3)

`leaderboards` loads last in config, so its `onTick` snapshot is month-end. It listens to `module.jobs.paid`, `module.bills.paid`, `module.bills.late`, `module.housing.payment`, `module.housing.value`, `module.credit.score`, `module.credit.statement`, `ledger.posted` (kind `credit.late_fee`, to learn that a card minimum was missed) and nothing at season close: its finale (awards and Life Reviews) is the `seasonClose` hook, inside the close transaction.

| Type | Emitted by | Payload |
|---|---|---|
| `module.leaderboards.settings` | leaderboards, after commit, when a world teacher hides amounts or freezes the boards | `{ worldId }`: the teacher console refetches |
| `module.leaderboards.awards` | leaderboards, after commit, when the season's awards and Life Reviews are stored | `{ worldId }` |

## 10. Exchange (Phase 3, waves 3a and 3b)

`exchange` loads after `rates` and `outfitters` and BEFORE `savings` and `leaderboards` (config order: `... outfitters, exchange, savings, leaderboards`), so the holdings value it announces in a tick is in that tick's net worth snapshots. It listens to `module.rates.changed` (the policy rate, for the bond fund's duration shock), `module.rates.pending` (a queued policy change pauses the bond-linked funds until it applies), `module.jobs.paid` (wave 3b: `gross` summed by world year, the only way it learns income, for RRSP room and the year-end tax settlement) and `world.closed` (holdings and open orders end with the season). It reads no other module's tables.

| Type | Emitted by | Payload |
|---|---|---|
| `module.exchange.value` | exchange, inside the tick for every student with holdings (and once with `holdings: 0` after they sell the last of them), and after commit following each trade, teacher undo or limit fill | `{ playerId, worldId, holdings }`; `holdings` is the value of the student's shares and fund units at the market maker's BID, in cents, cash excluded (cash is already in the ledger). `savings` keeps the latest per (player, world) in `savings_exchange` and adds it to net worth (snapshots and `/status`); `leaderboards` keeps it in `leaderboards_inputs.exchange_value` and adds it to net worth, the way both add `module.housing.value` |
| `module.exchange.changed` | exchange, after commit (a trade, a cancel, a contribution, a teacher control) | `{ classId }`: the teacher console refetches |
| `module.exchange.rrsp_settled` | exchange (wave 3b), after the commit of the tick that starts a new world year, once per student settled (RRSP activity in the year just ended, or a balance owing carried from the year before) | `{ playerId, worldId, year, refund, owing }` (cents; `year` is the world year just ended). `refund` or `owing` is the net result, after any balance carried in; at most one is non-zero. What chequing could not cover is carried to the next settlement (`exchange_settlements.unpaid_cents`) |

**Services (Phase 4 foundation, docs/modules.md "Services").** `listSecurity({ ticker, name, kind: 'stock', sector, startCents, sharesOutstanding, ownerBusinessId, sigmaBp?, tiltBp? })` adds a stock to this world's catalogue (table `exchange_listings`; same checks as `options.exchange.extraStocks`, 409 between seasons). It moves like the town stock of the same sector (that stock's sigma and sector tilt), else like a typical one (sigma 3300 bp, no tilt), unless the caller passes `sigmaBp` / `tiltBp`; no dividend. Returns `{ ticker, worldId, month, startCents, sigmaBp, tiltBp }`. `delistSecurity({ ticker })` takes it off (only the module that listed it; refused with 409 while anyone holds it or has an open order); the ticker is not reused that season. The market maker is still the counterparty, so the business receives nothing from trades and `sharesOutstanding` is recorded, not enforced: student-to-student matching and its settlement are the next step.

Ledger kinds posted by exchange (stored as `exchange.<kind>`): `contribute` and `withdraw` (chequing <-> `invest`/`tfsa`), `buy` and `drip_buy` (account -> sink), `sell` (mint -> account), `dividend` (mint -> account), `hold` and `release` (account <-> `xhold`, the cash held for open buy limits), `fill` (xhold -> sink, and the better-price refund back to the account), `undo_buy` and `undo_sell` (the teacher's undo, at the original price). Account kinds opened: `invest`, `tfsa`, `rrsp` (wave 3b), `xhold`. Wave 3b adds: `withdraw` from `rrsp` has a third leg, the tax withheld at source (rrsp -> chequing + sink); `rrsp_refund` (mint -> chequing, memo "RRSP tax refund (world year N)") and `rrsp_tax` (chequing -> sink, the balance owing) at a world-year start.
Wave 5c (retirement's services, actor `system`, inside retirement's tick): `draw_sell` (mint -> account: a holding sold at the bid to fund a retirement draw; not `sell`, so the feed does not list it as a trade) and `draw` (account -> chequing, plus the withholding to the sink from `rrsp`: the same bookkeeping as `withdraw`). The settlement now also taxes CPP + OAS (`exchange_rrsp.pension_cents`, withheld `pension_withheld_cents`, `oas_cents`) and adds the OAS recovery tax (`exchange_settlements.p_cents`, `clawback_cents`).

Ledger kinds posted by retirement (5c): `cpp` and `oas` (mint -> chequing net + sink, the tax withheld at source), `draw` (hisa -> chequing).

## 11. Refetch hints and other module events

Every `module.*` event also makes the server send `console` to the teacher streams (`server.js`, the `'*'` listener), so the teacher console refetches. The `changed` events carry only `{ classId }` and the four others below only a small id or number; none carries data a listener needs, they exist for that nudge. All are emitted after commit unless the row says otherwise.

| Type | Emitted by | Payload |
|---|---|---|
| `module.jobs.unpaid` | jobs, after the advance commits, for each business-job pay the company's treasury could not cover (wave 4b) | `{ playerId, worldId, month, employer, businessId, missed }`: `missed` = paydays this job has missed so far (2 or more: the Job Centre tells the student they may quit it; 6c: quitting is allowed at any time, and the catalogue job was never left). The student's notice is also on the job (`/api/jobs/catalogue` `business[].note`) |
| `module.jobs.payday` | jobs, once per month ticked in which at least one student was paid (after the advance commits; no event for a month where everyone was already paid) | `{ month }`; teacher consoles refetch |
| `module.jobs.assigned` | jobs, after commit: a student applies for a promotion, or a teacher assigns a job, decides an application, promotes or raises a wage | `{ playerId }`; teacher consoles refetch |
| `module.savings.rate` | savings, after the commit of the world teacher setting the HISA rate (refused when the rate follows the policy rate) | `{ worldId, hisa_bp }`; takes effect from the next month |
| `module.insurance.triggered` | insurance, after the commit of the world teacher triggering a town event for the town or one class | `{ id, event, name, scope, classId }` (`event` the catalogue key, `name` its title, `classId` null for the town): the `insurance_triggers` row; the event is applied at the next tick (`applies_from_month` = month + 1). The `triggerEvent` service (no teacher) emits it at once inside the caller's transaction |
| `module.bills.changed` | bills, after commit: autopay switched, pay-from source changed, a plan choice made | `{ classId }` |
| `module.today.changed` | today, after commit: the world teacher pushed a lesson quest (`classId: null`), or a teacher set a class's energy cap | `{ classId }` |
| `module.credit.changed` | credit, after commit: a card application decided, or card autopay mode changed | `{ classId }` |
| `module.insurance.changed` | insurance, after commit: a policy bought or cancelled | `{ classId }` |

The other `*.changed` events (`module.housing.changed`, `module.outfitters.changed`, `module.exchange.changed`) are in sections 7 to 10; `module.rates.changed` is different (it carries the new rates). `module.bank-basic.settings` is in section 3.

## 12. Ventures (Phase 4, wave 4a)

`ventures` loads after `exchange` and before `savings` and `leaderboards` (config order `... exchange, ventures, savings, leaderboards`), so the stakes it announces in a tick are in that tick's leaderboard snapshot. It listens to `module.credit.limit` (the card limit, for storefront purchases on the card, as outfitters does). It reads no other module's tables; it calls outfitters' `grantItem` service when outfitters is loaded.

| Type | Emitted by | Payload |
|---|---|---|
| `module.ventures.value` | ventures, inside the tick for every shareholder of a company with books, and after commit following capital, a storefront sale, a dropped product or a dissolution (`stake: 0` then) | `{ playerId, worldId, stake, companyValue, company }`: `stake` = the holder's share of the company's book value (treasury + inventory at cost), cents; `companyValue` = that book value; `company` = its name. Wave 4b: book value is net of the loan and taxes owed, never below 0, and the payload adds `staff`, `paydays` and `missedPaydays` (the company's, for Best Employer). `leaderboards` keeps `stake` in `leaderboards_inputs.ventures_value` and adds it to net worth, and `companyValue` in `ventures_company` for the Founder of the Season award. `savings` does not listen yet (its net worth line leaves stakes out) |
| `module.ventures.hired` | ventures, after commit: a hire (6c) | `{ playerId, businessId, title, wageCents, hoursPerMonth, hirerId, company, classId, worldId, month }`: `hirerId` = the founder who said yes (the registrant when a teacher approved), `company` = its name (ventures' name rule), `classId` = the company's class. The feed's "ninja42 hired ninja17 at $17.50/h" |
| `module.ventures.payroll_missed` | ventures, inside jobs' payday (its `payroll` service), once per company and month however many staff went unpaid (6c) | `{ businessId, month, worldId, classId, company }`; the feed's "Missed payroll at <company>" (a class item). The missed-payroll flag reads `missedPaydays` from `module.ventures.value` |
| `module.ventures.laid_off` | ventures, after commit: a founder's layoff (`notice` or `severance`) (6c) | `{ playerId, businessId, mode, endsMonth, company, classId, worldId, month }`; the feed's "ninja17 was laid off from <company>". Not sent when a dissolution, the season close or retirement ends a job |
| `module.ventures.changed` | ventures, after commit: a registration, invite answer, split, approval, capital, product change, purchase, rename, freeze, dissolution or sector setting | `{ classId }`: the teacher console refetches |

Ledger kinds posted by ventures (stored as `ventures.<kind>`): `capital` (founder chequing -> the company's `treasury`, an account with owner_type 'business' and owner_id = the company id), `production` (treasury -> sink), `npc_sale` (mint -> treasury), `store_sale` (a student's chequing or card -> treasury), `payout` (treasury -> each shareholder's chequing, pro rata, when an active company is dissolved), `refund` (treasury -> a founder's chequing: exactly the capital they paid in, when they leave before the company opens or a company that never opened is cancelled), `rent` (treasury -> sink, the monthly storefront rent). `ownersOf` names a company's accepted founders and shareholders, so they get the `balance` hint for the treasury.

## 13. Learning Road (`learn`)

| Type | Emitted by | Payload |
|---|---|---|
| `module.learn.completed` | learn, after commit (`k.db.afterCommit`), once per level per world: the student's FIRST completion of a level, the same transaction that paid the reward and wrote `learn_progress`. A replay of a finished level emits nothing | `{ playerId, worldId, levelId, firstTry, questions }` |

Today's errand `learn-level` ("Finish a level on the Learning Road") listens for it. The reward itself is a ledger txn of kind `learn.reward` (mint to the student's chequing). See docs/learn.md.
