# Module contract v2 (MIGRATION.md Step 5)

After this step, a curriculum module (jobs, housing, exchange, registry, tax) is a folder under `modules/` and a line in `config/vdaa.json`. Zero core edits. Requires Step 3 (`app.events`, `tx.onCommit`).

## 1. Shape

```js
// modules/<id>/index.js
import { defineModule } from '../../lib/modules.js';
export default defineModule({
  id: 'jobs',
  requires: ['bank-basic'],                       // optional; module ids
  migrations: [{ id: '001_jobs', sql: `CREATE TABLE jobs_postings (...)` }],
  routes: [{ method: 'GET', path: '/offers', access: 'student', handler(k, ctx) {} }],
  panels: [{ id: 'jobs', building: { key: 'job', name: 'Job Centre', icon: 'job' }, src: 'jobs.js' }],
  teacherPanels: [{ id: 'jobs-teach', title: 'Jobs', src: 'teach.js' }],
  cards: [{ id: 'today', src: 'today.js' }],      // home-screen card renderers, used with the homeCards hook (section "Home cards")
  onPlayer(k, player) {}, onLogin(k, player) {}, onEnable(k, { classIds }) {},
  onTick(k, { month, from, startMonth, world, classes }) {},
  events: { 'ledger.posted': (k, payload) => {} },
  services: { quote(k, args, { from }) { return { cents: 100 }; } },   // other modules: k.modules.call('jobs', 'quote', args)
  needs: ['world.setPace'],                                            // optional facade powers (only life uses one); see section 3
  ownersOf(k, { type, id }) { return []; },                            // the students behind a non-player account owner (a business)
});
```

`defineModule(spec)` validates and returns a frozen copy. Every validation error throws `Error('module "<id>": <field>: <problem>')` at boot.

| Field | Rule |
|---|---|
| `id` | `/^[a-z][a-z0-9-]{1,30}$/`, equals the folder name |
| `requires` | array of ids; each must be loaded (enabled for some course); cycles refused |
| `migrations` | array of `{ id, sql }`; `id` `/^\d{3}_[a-z0-9_]+$/`, unique within the module; recorded as `mod:<module>:<id>` |
| `routes[].access` | **required**: `'student' \| 'teacher' \| 'any' \| 'public'`. No default. `method` GET/POST. `path` must start with `/` and match `/^[\w\-/:]+$/` (no regex metacharacters) |
| `panels[].building` | `{ key, name, icon }`; `key` unique across all modules; `icon` is a core icon name or an inline `<svg>` using only the allowlist in `public/svg-allow.js` (plain shapes and gradients; no links, scripts, styles or DTD; `xmlns` optional) |
| `cards` | optional array of `{ id, src }`: each home card the module's `homeCards` hook may return, and the `ui/` file that draws it. Needs a `homeCards` hook |
| hooks | functions if present |
| `events` | object of event type → function |
| `catalogues` | optional array of `{ table, key, rows }`: `table` one of the module's own tables (`<id with _>_...`), `key` the column names of its primary key or a unique index, `rows()` returns row objects whose keys are column names. See "Catalogues" below |
| `options` | optional object `{ key: 'what it means' }`: every key the module reads from `k.config`. Boot warns on any other key in `config.options.<id>` |
| `services` | optional object `{ name: fn(k, args, { from }) }`, names camelCase (`/^[a-z][A-Za-z0-9]*$/`). See "Services" below |
| `needs` | optional array of facade powers the module needs; the only one is `'world.setPace'` (wave 5b, `life`). Anything else fails boot. Only a module that declares a power gets it on its `k` |

Exports from v1 (`export const id`, `routes`, …) are refused with a message pointing here. bank-basic is ported in the same step.

## 2. Loading

1. Ids = union of `config.courses[*].modules`. Import each `modules/<id>/index.js`, take `default`.
2. Topologically sort by `requires`; missing dependency → boot error naming both modules; cycle → boot error.
3. Run migrations in that order (`mod:<id>:<migration id>`), with Step 2's checksum warning.
4. Register `events` listeners on `app.events`, each wrapped so the listener receives `(k, payload)`. An event emitted inside an open transaction (a tick, a payment) runs the listener in its own savepoint: a throw rolls back that listener's writes only, is logged and recorded in `tick_failures`, and the emitter carries on. Outside a transaction a throw is logged only. See docs/events.md section 3a.
5. Register `onTick` with `app.world.onTick`.

`config/vdaa.json` gains nothing new; per-class enablement stays a module's own business (as bank transfers do).

## 3. The kernel facade `k`

One facade object per module, built once at load. Modules receive `k`, never `app`.

```js
k = {
  id,                                   // the module id
  money(cents), dice(id, month, salt), ok(n),   // '$12.34'; a deterministic 0..99 draw (bots only, not secret); Number.isSafeInteger.
                                        // Also exported by lib/kernel.js for module-level helpers: import { money, dice, ok } from '../../lib/kernel.js'
  log: { info, warn, error },           // prefixed '[<id>]'
  config,                               // config.options[id] ?? {}  (frozen)
  clock,                                // { now, today, month }: wall ms, the Edmonton day 'YYYY-MM-DD', and the current world's month (docs/clock.md)
  events: { emit(name, payload) },      // emits 'module.<id>.<name>'; listening is via the `events` field
  HttpError, LedgerError, input: { str, int, bool, idParam },
  db: { prepare(sql), txn(fn), afterCommit(cb) },   // txn = withTxn(db, fn); "your own tables only" (documented, not enforced); afterCommit(cb): cb runs after the outermost commit (at once if none is open) and is dropped if its savepoint rolls back (a hot loop's cheaper tx.onCommit). prepare is cached per
                                        // kernel by SQL text: the statement is shared, so never change its flags (setReadBigInts etc.)
  forEachPlayer(list, fn, idOf),        // per-player work in onTick: fn(item) per item, each in its own savepoint (section 5); idOf(item) -> player id, default the item
  audit(action, detail, actor),         // logAudit with action prefixed '<id>.'
  ledger: {
    openAccount, accountId, accountsOf, account, balance, statement,
    post({ kind, ... }),                // kind must be a bare name; stored as '<id>.<kind>'
    transfer({ kind, ... }),            // kind REQUIRED (no 'transfer' default)
    reverse(txnId, opts),               // refused unless the txn's kind starts with '<id>.'
    sumByKind({ account, kind, since, excludeReversed }),   // kind auto-prefixed
    txnsByKind({ kind, since, limit }),                      // kind auto-prefixed
    isReversed, system,
  },
  players: {
    get(id), student(id),               // sanitized: { id, username, role, class_id }
    inClass(classId),                   // [{ id, username }] students only
    classes({ courses }),               // [{ id, name, course_id }], every class
    classesFor(user),                   // the same, only the classes this teacher reads (policy class.read); use this in teacher routes
    classOf(playerId),
  },
  world: { current, active, priceIndex },   // active(): the current world, or HttpError 409 "The season is closed. Start the next one first." between seasons
                                            // priceIndex(worldId = current): the world price index in bp (10000 = season start; also without rates), core table price_index
                                            // + setPace({ months_per_day, auto_advance }) for a module with needs: ['world.setPace'] only: world.setSettings with
                                            //   actor 'system:<id>', those two keys only (never no_school); months_per_day alone leaves auto_stopped alone
  modules: { call(id, name, args), has(id) },   // another module's services (section "Services")
  push(playerIds, event, data, { skippable }),   // one custom SSE event to these players' open streams only (section "Pushing live data"); throws on a bad name, list or size
  policy: { can, assert },      // who may do what (docs/teachers-seasons.md): assert(user, action, resource) throws 404 for class/player resources, 403 for world actions
}
```

- Kind rules: a bare kind is `/^[a-z][a-z0-9_]*$/`; the wrapper prefixes it. A kind containing `.` is refused. Core-owned kinds are `core.reversal` and (Step 7) `core.season_reset`.
- `LedgerError` gains `code`: `INSUFFICIENT_FUNDS`, `UNKNOWN_ACCOUNT`, `ALREADY_REVERSED`, `NOT_FOUND`, `MIXED_CURRENCY`, `BAD_LEGS`. Messages stay as they are. bank-basic switches from string matching to `e.code`.

## 4. Data migration (core migration `004_kind_prefix.sql`)

`txns.kind`: `transfer` → `bank-basic.transfer`, `grant` (with `meta.reason = 'welcome'`) → `bank-basic.welcome`, `reversal` → `core.reversal`. Do it inside the migration with the ledger guard triggers temporarily satisfied (raise `ledger_lock`, update, lower), as 003 did. `ledger.reverse()` writes `core.reversal`.

## 5. Hooks and failure isolation

| Hook | When | Context | If it throws |
|---|---|---|---|
| `onPlayer(k, player)` | each new student, inside createStudents' txn | sanitized player | creation fails; message names the module |
| `onLogin(k, player)` | each student login, after auth, before session; and the first `/api/me` of a session in an active world the student has not entered yet (`players.seen_world_id`). Never while the world is closed. Must be idempotent per world | sanitized player | **logged, login proceeds**; `seen_world_id` is not set, so the next `/api/me` runs the hooks again |
| `onEnable(k, { classIds })` | at boot, for classes whose course enables the module but that have no `module_enabled` row yet; then a row is written | — | boot continues; logged; retried next boot |
| `onTick(k, { month, from, startMonth, world, classes })` | each world month, inside advance's txn | `world`: the world row being advanced (as `k.world.current()`). `classes`: `[{ id, course_id, studentIds }]` already filtered to classes whose course enables this module. `from` = `month - 1`. `startMonth` = the world month when this advance began (the last month students had live); equal to `from` in a 1-month advance. With 2+ months per advance, judge lateness only on what was due by `startMonth`, so nobody is penalised for a month they never got to play | inside a `k.forEachPlayer` loop: that student's part is rolled back to its savepoint and recorded, the loop and the advance go on, unless that module failed this month for more than half of the world's students (below). Anywhere else (module-wide steps): the whole advance rolls back, message names the module; an auto-advance then stops (docs/clock.md) |
| `events[type](k, payload)` | when the event is emitted: synchronously inside the emitter's transaction for the events docs/events.md section 3a lists as in-transaction, otherwise after commit | — | inside a transaction: the listener's own savepoint is rolled back (its writes only; the emitter's stay), logged, recorded in `tick_failures`. After commit: logged |
| `badges(k, user)` | each `/api/me` for a student whose course enables the module | returns `[{ text, title? }]` (≤ 3, text ≤ 40 chars): chips beside the student's name | skipped and logged |
| `homeCards(k, user)` | each `/api/me` for a student whose course enables the module (not between seasons: the home screen is not drawn) | returns `[{ id, title, data }]`: cards above the doors on the home screen. `id` one of the module's `cards`, `title` 1-60 chars, `data` plain JSON ≤ 8 KB, ≤ 2 per module. See "Home cards" | the module's cards are skipped and logged; a card that breaks a rule is dropped alone |
| `seasonAssets(k, { worldId })` | season close (`world.close`), inside its transaction, before accounts are reset | returns `[{ playerId, cents }]`: non-money assets (a home, holdings) added to each student's season result. A student's stake in a business is a row like any other (`cents` = what the module says the stake is worth); business accounts themselves count for no one | the close fails, naming the module |
| `ownersOf(k, { type, id })` | after commit of every ledger post that touched an account whose owner is not a player (`ledger.posted` owners) | returns the player ids who should get the `balance` hint for that owner (a business's members); the server merges every module's answer | logged, skipped (it is only a hint) |
| `seasonClose(k, { world })` | season close, the last step inside its transaction: `season_results` final, every player and business account zeroed, `world.status = 'closed'` | end-of-season cleanup that must not be skipped (jobs resets `jobs_holdings`, which is not per world; leaderboards writes its finale). Rows keyed by `world_id` need nothing | the whole close rolls back; 500 naming the module |
| `simulate(k, { month, students })` | bots only: `scripts/sim.mjs`, once per world month before it advances; `students` are the bots in courses that enable the module | `[{ id, class_id }]` | the sim fails |

`onEnable` is supported (and tested with fixture modules) but no shipped module uses it today; the hook table above and `module_enabled` below describe what it does if one does.

Core table for `onEnable`: `module_enabled(module_id TEXT, class_id INTEGER, at INTEGER, PRIMARY KEY(module_id, class_id))`.

**Failure domains in an advance.** The advance is one transaction over N months, so a normal advance is atomic. Inside it, a module puts each student's work in `k.forEachPlayer(list, fn, idOf)`: `fn(item)` runs in a savepoint per item; if it throws, that savepoint is rolled back (the student's writes in this module this month, the ledger posts, and the events and `onCommit` callbacks queued inside it), a row goes into the core table `tick_failures(world_id, month, module, player_id, error, source, created)` (migration 012; `source` is `'advance'`, or `'request'` for a listener that failed inside a student's own action), the error is logged and the loop continues with the next student. The advance commits; the skipped student's month is incomplete for that module only (for example no bills issued for them that month), never half-written inside that module. Two limits keep this from hiding a real bug. If SQLite itself aborted the transaction the error is rethrown. And after each month's hooks, `world.advance` reads that month's `tick_failures` (source `'advance'`, written inside the advance) and, per module, counts **distinct students**, across all of the module's loops and its listeners: **if one module failed for more than half of the world's students** (so in a one-student world, one failure), **or had a failure not tied to any student** (`player_id` NULL), the advance throws `<module>: <f> of <n> students failed in month <m>, so nothing was skipped: <first error>` and the whole advance rolls back. So a bug that hits most of the school, in a big loop, in classes of one, or in a listener, changes nothing, while one student with several bad rows (two GICs) is still one student skipped. In a world on `school_days`, an advance that recorded a failure also stops auto-advance until the world teacher has looked (docs/clock.md).

A skipped student's month is only **partly consistent across modules**: the other modules went ahead without knowing. If jobs failed for them, bills still billed them (with no pay to cover it); if bills failed, insurance still recorded that month's premium with no bill line. Nothing reconciles this; the world teacher should check that student (the console panel says so).

Modules use it in the per-student loops of `onTick` whose work a later tick repeats or catches up: jobs (payday), bills, credit, housing, insurance (premiums, town events, the random draw), savings (GIC maturities, which a later tick retries; HISA interest; snapshot events), exchange (limit orders, which stay open and are retried; value announcements), outfitters (streaks; class goals stay class-wide) and leaderboards (each student's snapshot row; ranking and writing the boards stay module-wide). Work that happens once and is never retried stays **all or nothing**: exchange's quarterly dividends and the year-end RRSP settlement run as plain loops, so a throw there rolls back the whole advance rather than losing one student's dividend or refund for good. Module-wide steps (prices, catalogue reads, one-statement snapshots) stay outside it too: a throw there still rolls back the whole advance. The world teacher's console lists the newest 50 `tick_failures` of the season ("Problems in recent advances", from `GET /api/teach/state` → `problems.failures`: module, student, month, source, error; a row is labelled "Skipped in the advance" or "During a student's action").

## 6. Routes and UI

- Routes mount at `/api/<id><path>`. Handler signature `handler(k, { user, body, params, url })`. `user` is sanitized. `access: 'student'` also requires the module enabled for the student's course (as today). `'teacher'` checks role (and, after Step 7, `policy.can`).
- `/api/me` returns `panels` in module load order, each `{ module, id, building: { key, name, icon }, src }`. `public/student.js` deletes `BUILDINGS` and draws doors from `me.panels`; the icon is `icon(name)` for a core name or the module's inline SVG (inserted via `DOMParser` + `importNode`, `image/svg+xml`, rejecting any `<script>` or `on*` attribute).
- Panel modules: `render(el, { me, onRefresh, on(eventName, fn) })` for both student and teacher panels. `on` subscribes to SSE event names on the shared EventSource.
- Teacher console menu: the console (`public/teach.js`) shows one view at a time, chosen from a menu, with a dashboard first. Each teacher panel is a menu item of its own, under the heading `MODULE_GROUP` in `public/teach-menu.js` gives its module (a module not listed there lands under "Other"; `test/teach-menu.test.js` checks every panel is reachable). A panel's script is loaded the first time its view is opened, and from then on it stays in the page, hidden when another view is chosen. Its `onRefresh` callbacks run only while it is on screen, and once more when it is opened again.

## 7. Tests (definition of done)

`test/modules.test.js` with fixture modules in `test/fixtures/modules/`:

1. Each shape rule fails boot with a message naming module and field (table-driven).
2. `requires`: order respected; missing dependency and cycle fail boot.
3. Migrations are keyed by name, not position: after `[001_a, 002_b]` is applied, `[001_a, 002_b, 003_c]` applies only `003_c`; editing `002_b`'s SQL warns on checksum and does not re-run; a duplicate name fails boot.
4. A route without `access` fails boot; `'teacher'` route → 403 for students.
5. `k.ledger.post({ kind: 'bank-basic.x' })` is refused; a jobs fixture's transfer does not count toward bank-basic's cap and cannot be reversed through bank-basic's route.
6. A throwing `onLogin` does not block login.
7. `stub-jobs` fixture: a payday `onTick` crediting `chequing` from `mint` for only its course's classes; a panel with a new building that shows up as a door in `/api/me`; a teacher panel. Zero diff outside the fixture.
8. `onEnable` runs once per class, survives restart without re-running.
9. bank-basic still passes all of its existing tests after the port.

## Home cards

A module can put a card on the student's home screen, above the doors (Phase 5, wave 5a; `today` is the first user). Two parts:

- **Server:** the `homeCards(k, user)` hook returns `[{ id, title, data }]`. `lib/modules.js` (`homeCardsFor`) calls it for each module the student's course enables, in load order, and `/api/me` returns `homeCards: [{ module, id, title, data, src }]` (empty when no module has a card). Each card is checked: `id` must be declared in the module's `cards`, `title` is plain text of 1-60 characters, `data` must serialise as JSON in at most 8,192 bytes, and only the first 2 cards of a module are used. A card that breaks a rule is dropped and logged; a hook that throws drops that module's cards and is logged. Nothing a card does can fail `/api/me`. The hook may write (it runs outside a transaction; use `k.db.txn`), but must be cheap: `/api/me` is fetched on every live update.
- **Browser:** `cards: [{ id, src }]` names the renderer, `modules/<id>/ui/<src>`, an ES module that exports `renderCard(el, ctx)`. `public/student.js` draws each card as a `section.glass.panel` with the title as its `h2` and calls `renderCard(body, { card, me, onRefresh, on })`, where `ctx.card` always reads the latest copy from `me.homeCards` (a live update runs the `onRefresh` callbacks). If the script fails to load or throws, the card keeps only its title. With no cards the home screen is exactly what it was before the hook existed.
- **Lead cards:** a card the hook returns with `lead: true` is passed through as `lead: true` in `/api/me` `homeCards`, and `public/student.js` draws those first, above the balance, then the balance, then the rest in load order. Anything else is unchanged; a card without the flag behaves exactly as before. `learn` is the one user (the Learning Road card, switched off with `options.learn.home = false`).
- Tests: `test/modules.test.js` "homeCards: declared cards only, ...", `test/today.test.js` "today switched off for a course".

## Learn (the Learning Road)

`learn` (docs/learn.md) is a curriculum module with no tick: lesson content in `modules/learn/content/<course>.json`, server-checked answers, one `learn.reward` ledger txn per level per world, the event `module.learn.completed`, a lead home card, a `learn` building and a teacher panel. It sits right before `today` in both courses (pinned in `test/db.test.js`) and offers `todayFacts` (`hasOpenLevel`) for Today's `learn-level` errand.

## Catalogues

Wages, prices, bills and items live in code (`modules/<id>/catalogue.js` or `constants.js`), each row with its source. A module lists them in `catalogues`, and **every boot**, after the module's migrations, upserts each row by its key: new keys are inserted, changed columns of existing keys are updated (rows that did not change are not written), and a key that was removed from the file is **left in the table**, never deleted, because player rows (holdings, owned items, pay stubs, bills) reference it. If the table has an `active` column (jobs_catalogue, bills_catalogue, outfitters_items all do), every row in the file is set `active = 1` and a key no longer in the file is set `active = 0`: **retired**. The module offers only active rows for new business (bills issues only active bills, and a choice of a retired option falls back to the slot's default; outfitters lists and sells only active items; jobs lists, lets students pick and teachers assign only active jobs) while what already exists keeps working (issued bills keep their own name and amount, owned items still join their row, a job holder keeps the job and is paid). Putting the row back in the file makes it active again. jobs_steps has no `active`: a step removed from the file stays on the promotion path. So the rule is: **edit the catalogue file and restart; nothing else**. Do not write an UPDATE migration for a figure. Boot logs `[<id>] catalogue <table>: N row(s) added or updated` and `... retired (no longer in the file): <keys>` when something changed.
- Every row of `rows()` must have exactly the same keys (in any order); otherwise boot fails naming the module, the table and the row.

- The first seed is still in the module's original migration SQL (jobs 001/002, bills 001, outfitters 001). Those migrations already ran and are kept as they are. Because their SQL is built from the catalogue file, a catalogue edit changes their checksum, so boot also prints `migration mod:<id>:001_... changed since it was applied`. That warning is expected after a catalogue edit and harmless: the upsert has applied the edit.
- Each module reads its catalogue table (or, like housing's rent tiers, the constants directly), never a copy of it. housing's old `housing_catalogue` table was written and never read; migration `005_drop_catalogue` drops it.
- Prices the deployment overrides (`options.bills.amounts`, `options.outfitters.prices`) stay overrides at read time; the table keeps the file's figure.
- Tests: `test/data.test.js` "catalogue edits reach an existing database on restart", "a row removed from a catalogue is retired", "catalogue rows with different keys fail boot".

## Pushing live data (`k.push`)

`k.push(playerIds, event, data, { skippable = false })` sends one custom Server-Sent Event to the open `/api/stream` of exactly the listed players, for cosmetic live features (the walk's classmate presence is the first). The panel receives it with `ctx.on(event, (ev) => JSON.parse(ev.data))`; no refetch is triggered. The kernel enforces, and throws a plain `Error` (a bug in the module, not an `HttpError`) on:

- `event` matches `/^[a-z][a-z0-9.-]{1,40}$/` and starts with `<moduleId>.` plus at least one more character (`walk.presence`), so one module cannot send or spoof a core event (`balance`, `ledger`, `console`, `month`, `world`) or another module's.
- `playerIds` is an array of at most 200 whole numbers. A teacher gets it only if the teacher's own id is listed; `[]` and ids with no open stream are fine and do nothing.
- `data` is JSON (`JSON.stringify` works and is defined) of at most 4096 bytes.
- `skippable: true` joins the backpressure skip set: while a stream's socket is backed up the event is dropped instead of queued (the next one carries the state). Use it for anything that is re-sent soon anyway. Without it the event is always written.

It is **not** a `module.*` event: it never pokes the teacher console, and `events` listeners do not see it (the internal app event is `stream.push`). It is fire and forget and **not transactional**: it goes out at once even inside a `k.db.txn` that later rolls back (put it in `tx.onCommit` or `k.db.afterCommit` if that matters; for a push that a month tick could trigger thousands of times, mark it in `lib/live.js` `createHints` instead, see docs/live.md), and nothing is stored or replayed, so a client that reconnects must be sent the whole state again. Keep payloads free of ids and personal data unless every listed player may see them.

`events` listeners may also use the core event `app.closing`, emitted by `server.js` `close()` just before the database closes, to stop the module's own timers (walk's presence broadcaster does). Timers should be `unref`'d as well.

## Options

`config/vdaa.json` `options.<id>` reaches the module as `k.config` (frozen). Each module declares the keys it reads in `options`; at boot an undeclared key logs `config: options.<id>.<key> is not an option of module "<id>"` and is ignored, and `options.<id>` for a folder that does not exist logs `there is no module "<id>"`. Options for a module that exists but is not enabled for any course are ignored silently. Money is integer cents and rates basis points, **except savings**: `options.savings.hisaRate` and `gicRates` are **percent** (`2.5` = 2.5%), as the teacher's savings rate is; this is kept for compatibility.

## Services

A service is a synchronous request/response between modules: `services: { listSecurity(k, args, { from }) { ... } }` in the callee, `k.modules.call('exchange', 'listSecurity', args)` in the caller.

- It runs now, inside the caller's transaction (a savepoint: if the service throws, its own writes are undone and the error reaches the caller unchanged; if the caller's transaction later rolls back, the service's writes go with it). Called outside a transaction, it opens one.
- The service gets **its own** `k` (its tables, its ledger kind prefix: a post inside exchange's service is `exchange.<kind>`), the args and `{ from }`, the calling module's id (for "only the module that listed it may delist it").
- Args and the result are plain data, structured-cloned on the way in and out: no functions (a `DataCloneError`), and neither side can mutate the other's objects.
- A module that is not loaded, or a name it does not export, throws `module "<caller>": k.modules.call: ...`. `k.modules.has('<id>')` (loaded for any course) lets a caller degrade instead. Declare `requires` when the caller cannot work without it.
- **Service or event?** An event says "this happened" to whoever listens (zero or many), and a listener's failure never stops the emitter. A service asks one named module to do something or answer something, and the caller needs the result or must fail with it: list a security, settle a trade, read a limit. Keep announcing state changes as events; use a service when the caller would otherwise need another module's tables.

Shipped services (6a additions: rates `setInflation({ inflation_bp })` and insurance `triggerEvent({ event, scope: 'town' })`, both for the life module's scenarios, described in docs/phase6-roles.md "As built (6a feed + scenarios)"): `todayFacts({ playerId })` in jobs, savings, credit, exchange, housing and life (read-only flat facts for the Today card, docs/phase5-life.md "As built (5a)" and "As built (5b)"); jobs `endHolding({ playerId, reason })` (end the job now, reason on this month's pay stub, idempotent); life `snapshots({ playerId })` (the Life Review net worth at 25/35/55/65/70) and `retired({ playerId })`; exchange `listSecurity({ ticker, name, kind: 'stock', sector, startCents, sharesOutstanding, ownerBusinessId, sigmaBp?, tiltBp? })` and `delistSecurity({ ticker })` (docs/events.md section 10). For the life module (docs/phase5-life.md "As built (5b deps)"), each the same code path as the teacher lever, with no route: exchange `stageEvent({ kind, ticker?, headline? })` (a market event for the next tick, idempotent per world, month and kind) and `allocation({ playerId })` (read-only `{ equities, bonds, cash, other }` cents at the bid), rates `queueRate({ rate_bp })`, housing `marketEvent({ pct })`.

## Feed (6a)

`feed` listens, it is never called. Events it reads (names and payloads: docs/phase6-roles.md "As built (6a feed + scenarios)"): new `module.jobs.hired { playerId, jobId, title, employer }` (after commit, jobs `/pick` and `/assign`), new `module.housing.moved { playerId, worldId, month, tenure, name }` (inside the tick, when a pending move takes effect), `module.jobs.promoted`, `module.credit.limit`, `ledger.posted` (kinds `housing.purchase`, `housing.sale`, `exchange.buy`, `exchange.sell`), `module.life.stage`, `module.rates.pending`, `module.insurance.triggered` (payload now `{ id, event, name, scope, classId }`) and, for the stress module, `module.stress.loan { playerId, worldId, month, principalCents, aprBp }`. It reads `leaderboards.settings({ worldId }) -> { hide_amounts }` when that service exists. Routes: `GET /api/feed/class` (student), `GET /api/feed/teach[?class_id=&since=]` (teacher). Card `feed` ("Around town").

Wave 6a (docs/phase6-roles.md "As built (6a stress + flags)"): stress `todayFacts({ playerId, worldId? })` → `{ score, level, hasLoan }` (read-only; `level` is Calm, Tight, Strained or Crisis). Events stress emits, all **inside the emitter's transaction** (the tick, or the student's `POST /api/stress/loan`): `module.stress.score { playerId, worldId, month, score }` once per student per tick (leaderboards keeps it as the fifth health part); `module.stress.loan { playerId, worldId, cents, aprBp }` when an emergency loan is paid out (automatic in the tick, or asked for); `module.stress.loan_closed { playerId, worldId, cents, aprBp }` (cents = the original principal) when the last payment clears it; `module.stress.payment { playerId, worldId, month, onTime, amount, kind: 'loan' }` once per loan payment due (credit marks it on the history, source `loan`). Stress listens to `module.bills.late`, `module.housing.payment`, `module.housing.evicted` (emitted since 6b) and `module.jobs.paid`. Leaderboards also listens to `module.stress.score`, `module.stress.loan` and `ledger.posted` kind `exchange.contribute`.

Wave 6b (docs/phase6-roles.md "As built (6b landlords)"): one new service, bank-basic `transfersEnabled({ classId }) -> { enabled }` (read-only; housing allows student rent only where the class's payments between classmates are on). Housing emits `module.housing.evicted`, `.listed`, `.rent_changed` and `.market` (new), `module.housing.payment` with `kind: 'rent'` (new kind; mortgage payments gain `homeId`, `role`, `total`), `module.housing.costs` with `housed`, and `module.housing.value` as the sum over a student's homes (docs/events.md section 7). Listeners added: bills (`housed`, table `bills_housed`), leaderboards (rent on time / late, `gouge_months`, the `rent_gouger` flag; a `mortgage:<id>` account counts as a mortgage), feed (listed, rent changed, evicted, the market town item), stress (`evicted` now has an emitter). Ledger: account kind `mortgage:<homeId>` (a rental's mortgage, prefix-matched like `gic:`; net worth and the season reset already take every player account), txn kinds `housing.rent` (tenant chequing -> landlord chequing) and `housing.rent_nsf` (tenant chequing -> sink). Housing routes added: `GET /market`, `POST /list`, `/unlist`, `/rent`, `/end-tenancy` (student, own rental only); `/qualify` and `/buy` take `role`, `/sell` and `/catch-up` take `home_id`. No new teacher route: `GET /api/housing/teach` gains `listings` and `evictions` per class.

Phase 4 (Ventures): outfitters `grantItem({ playerId, worldId, sector })` gives a Venture Row storefront buyer the cosmetic item for that sector (free, no resale, once per student and season) and returns `{ itemId, name, granted }` (docs/events.md section 12).

Wave 4b (Ventures): jobs `hireForBusiness({ playerId, businessId, employer, title, hourlyCents, hoursPerMonth, month })`, `endBusinessJob({ playerId, businessId, mode: 'notice' | 'severance' | 'now', month })` and `staffOf({ businessId })` (business jobs, for ventures); ventures `payroll({ businessId, playerId, grossCents, netCents, employerCppCents, employerEiCents, month, kind: 'pay' | 'severance' })` → `{ paid, txnId?, employer?, reason? }` (jobs' payday pays a business job from the company's treasury through it). Jobs and ventures call each other's services; neither reads the other's tables.

Wave 6c (docs/phase6-roles.md "As built (6c employers)"): a company job is part-time ON TOP of the catalogue job. `hireForBusiness` never ends the catalogue job; it refuses a retired student (life `retired`), a second job at the same company, a third company job and more than 40 hours in all (409). `endHolding` (retirement) ends the catalogue job and every company job and returns `businessIds`. `module.jobs.paid` is sent once per student per month with the month's totals. Ventures emits `module.ventures.hired`, `.payroll_missed` and `.laid_off` (docs/events.md section 12) and the feed listens to all three; leaderboards' flag `missed_payroll` reads `missedPaydays` from the existing `module.ventures.value` listener. Jobs route `POST /quit-business { business_id }` replaces 4b's `/back`; `GET /catalogue` returns `business` as a list plus `business_room`. Ventures `POST /post-job` takes `slots` (1-5); `GET /openings` returns the scaled wage floor, `slots`, `filled` and `retired`. Option `options.ventures.minWageCents` (default 1500, never below it) x the price index is the posting floor. No new teacher route (`classesFor(user)` count unchanged).

Wave 5c (docs/phase5-life.md "As built (5c)"), all for the `retirement` module: jobs `cppHistory({ playerId, worldId? })` -> `{ years: [{ year, gross_cents, cpp_cents, months, index_bp, ympe_cents, exemption_cents }] }` (read-only; pay by world year, company jobs too, with that year's indexed YMPE and exemption); exchange `retirementPots({ playerId })` -> `{ rrsp, tfsa, invest: { cents, rate_bp } }` (read-only; cash + holdings at the bid, value-weighted expected return), `drawForRetirement({ playerId, account: 'rrsp' | 'tfsa' | 'invest', cents })` -> `{ account, cents, withheld_cents, net_cents, sold_cents }` (sells at the bid when the cash is short, then the panel's own withdrawal: TFSA room back next year, RRSP withholding 10/20/30%), `recordRetirementIncome({ playerId, month, cents, withheldCents, oasCents })` (CPP + OAS into the year-end settlement); bills `monthBills({ playerId })` -> `{ month, cents }` (read-only; the latest month's lines except fees and one-off event expenses); housing `monthCosts({ playerId })` -> `{ mortgageCents, rentCents }` (read-only; what housing debits directly: regular mortgage payments, a classmate unit's rent); savings `hisaRate({ worldId? })` -> `{ bp }`; life `age()` -> `{ month, age, stage }`; savings' `todayFacts` gains `hisaRateBp`. `drawForRetirement` also returns `note` (why holdings were left unsold) and sells nothing while trading is frozen. `module.retirement.coverage` carries `ratioBp` (uncapped income / bills). Retirement's own: `todayFacts({ playerId })` -> `{ cppSet, cppOpen, planSet, covered, shortfallCents, lastsUntilAge }`.

## Business owners

`accounts.owner_type` has always allowed `'business'`; the core keeps **no business registry**. The future ventures module owns its businesses (its own table, its own ids) and opens their accounts with `k.ledger.openAccount({ ownerType: 'business', ownerId: <its business id>, kind })`. One registry is enough: only that module creates business ids. The core does three things for them:

- **Season close** resets every non-system account to the sink (`core.season_reset`), businesses' too. `season_results` stay one row per student (player accounts only); a student's equity stake reaches it as a `seasonAssets` row.
- **Balance hints**: `ledger.posted` lists `{ type: 'business', id }` among its owners; the server asks every module's `ownersOf` hook which students that is and sends them `balance`.
- `seasonAssets` rows are `[{ playerId, cents }]` as before; nothing else changes shape.

## Cross-module code imports

Modules talk by events and services and read only their own tables. The one code import that crosses a module boundary is `exchange` (wave 3b) importing the pure function `annualIncomeTax(taxableCents, earnedCents?)` from `modules/jobs/payroll.js`: annual federal + Alberta income tax from the same T4127 constants as `payStub`, no I/O and no table reads, used for the RRSP year-end settlement. `payStub` is unchanged. (Exchange also reads the employers' names from `modules/jobs/catalogue.js`, a constants file.)

Since 5c, `retirement` imports the same pure `annualIncomeTax` (for the withholding at source on CPP + OAS and the live check's tax estimate), and `exchange` also imports `oasRecoveryTax` and `OAS_RECOVERY_THRESHOLD` from the same file (the OAS recovery tax in the year-end settlement). Both are tax maths with no I/O, kept in the one file that holds the T4127/T1 constants, so no tax code is duplicated.

Since 6a, `life` also imports **constants only** from `rates`, `housing`, `exchange` and `insurance` (`MAX_POLICY_BP`, `MAX_INFLATION_BP`, `MARKET_EVENT_MIN_PCT` / `MAX_PCT`, `STOCKS`, `EVENTS`): so that `checkEvent` accepts exactly the values those modules' services accept, and a scenario row can never jam the tick. No module code, no tables.
