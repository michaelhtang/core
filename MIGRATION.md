# vDAA: architecture audit and migration plan

Audited: branch `core` at b6a3b90 (server.js, lib/, migrations/, modules/bank-basic, public/, scripts/, test/; about 2,400 lines of app code plus 1,100 of tests). Date: 2026-10-22.

Method: three read-only scans (state and data flow, module coupling, scaling), then every candidate finding went to an independent verifier that re-read the code and, where cheap, reproduced it on a scratch copy. Only confirmed findings are listed. Scanner observations that were not independently verified are in Appendix B, clearly marked.

This document is written so that each migration step can be handed to a Sonnet session on its own, with the acceptance tests as the contract. Section 6 says which steps need Opus.

---

## Status (2026-10-22): all eight steps done (historical)

> **Historical record.** This block, and the 148-test gate in the table, describe `v1-architecture`. The system has grown since (v9-hardening: 361 tests, Phases 0-3 built); the specs named below are kept current, this audit is not.

Merged to `main`, tagged `v1-architecture` (from `v0-core`). Every step was implemented in its own worktree, reviewed (Opus on
`db.js`, `ledger.js`, `modules.js`/`kernel.js`, `policy.js`, `world.close()`), then checked by an independent verifier before merge.

| Gate | v0-core | v1-architecture |
|---|---|---|
| Tests | 60 | 148 (run twice per step, no flakes) |
| `sentSince` (bank 24h cap, 57k txns) | 3,872–5,343 ms | 0.84 ms |
| Teacher transfers feed | 261–343 ms | 2.6 ms (10-class teacher) |
| Statement, 3k-entry account, limit 50 / 500 | 17–48 / 154–426 ms | 0.08 / 0.43 ms |
| Duplicate-reversal check | 3–29 ms | 0.04 ms |
| Teacher console load | full ledger audit every click | 0.14 ms (audit stored; nightly + on demand) |

Fixed on the way, beyond the plan: the bank feed could hide a second teacher's transfers behind a busy class (now a per-class index
table); account statements were readable by any teacher (now class-scoped); inline module icons use an allowlist; a failing ROLLBACK no
longer masks the original error; password fields never survive a console redraw.

Specs that now describe the code: `docs/events.md`, `docs/modules.md`, `docs/clock.md`, `docs/teachers-seasons.md`.

---

## 1. Verdict

**What is sound, and must be preserved through every step:**

- The money kernel. `lib/ledger.js` is the only writer of `entries`, `txns` and `balance_cents`, and migration 002's triggers enforce that at the database, not just by convention. Entries are append-only; reversals are compensating transactions; `audit()` re-derives everything. This is the hardest part of a game economy to get right and it is right.
- `withTxn` with nested savepoints, so a module hook that fails inside a bigger operation rolls the whole operation back.
- `lib/app.js` as a composition root shared by the server, the tests and the simulator. Every refactor below plugs into that seam.
- Input readers (`lib/input.js`), the fuzz test, test isolation (temp DB per test, port 0), the bot simulator, cents-only money, pseudonymous identity.

**Where it will not scale, in order of how soon it bites:**

1. **Two hot paths are O(total history), not O(result).** The bank's rolling-24-hour cap does a full `txns` scan per in-window row because the reversal link lives only in JSON (3.9 s at 57k txns); the statement recomputes the running balance per row. Both are on the request path of every student panel refresh, and one teacher click fans out to every connected student at once. A student can stall the whole process today by sending 1¢ transfers.
2. **Events are a transport-layer afterthought.** Nothing in the domain layer (ledger, world) emits anything; the only `notify` is a closure handed to HTTP handlers. Money moved by a tick, by the first-login grant, or by the simulator produces no client event, and any future scheduler calling `world.advance()` is silent. Live updates also outlive the session they were authorized for.
3. **The module contract is a real seam for routes, migrations, panels and ticks, but porous and asymmetric.** Modules get the whole kernel (including a player row with `pin_hash`), read ledger internals with raw SQL, share one unprefixed txn-kind namespace, cannot declare dependencies, cannot add a student building without editing core, and are not isolated from each other's failures. The teacher side is generic; the student side is hard-coded.
4. **Two identity and lifecycle assumptions are baked into the schema**: exactly one teacher, and no season lifecycle. The plan needs a colleague's FinTech 10 classes in Semester 2 and a fresh start every season.
5. **Two clocks.** The bank thinks in wall-clock hours; the world thinks in hand-advanced months; nothing maps them.
6. **Process fragility**: an exception in a timer kills the process (reproduced), migrations are not safe to run from two booting processes, the Advance button is not idempotent.

None of this needs a rewrite. The kernel stays; the migration is about moving events and policy *into* it, tightening the module contract around it, and fixing three queries.

---

## 2. Confirmed findings

Severity: **H** = will break or stall in a normal semester, or is a security/privacy gap; **M** = will hurt as modules are added; **L** = cheap to fix, worth doing while nearby.

### A. Hot paths and bottlenecks

| # | Finding | Evidence | Impact | Sev |
|---|---|---|---|---|
| A1 | `sentSince` (bank rolling-24h cap) runs a `NOT EXISTS` over `txns` with `json_extract` per in-window row: a full `txns` scan each time. Called by `/status`, by `/transfer` inside `BEGIN IMMEDIATE`, and by every bank panel refresh. No per-transfer rate limit; minimum is 1¢. | `modules/bank-basic/index.js:48-51, 61, 80`; EXPLAIN: `CORRELATED SCALAR SUBQUERY … SCAN r`. Measured 3,872 ms at 56,585 txns with 1,500 in-window rows; 1.6 ms without the subquery. | An authenticated student can stall the single process for seconds per request. Cost grows with the whole economy's history. | H |
| A2 | Teacher transfers feed: `WHERE t.kind='transfer'` is `SCAN t`, plus a full-scan `EXISTS` per returned row. Re-run on every teacher console action. | `index.js:124-128`; `ui/teach.js:12`; 261 ms at 56k txns (0.3 ms with the EXISTS removed). | Console slows with history. | M |
| A3 | `statement()` recomputes the running balance per row with a correlated `SUM`: O(limit × entries on that account). | `lib/ledger.js:81-82`; 48 ms at 3,006 entries/limit 50, 426 ms at limit 500; sub-ms on small accounts. | Fine in Phase 1; a daily payday/bills/interest loop puts every account in the thousands by mid-semester. | M |
| A4 | The reversal link exists only in `txns.meta` JSON; "already reversed" is a `SCAN txns`. No index on `txns(kind)` or `txns(created)`. | `ledger.js:70` (29 ms at 56k); `migrations/001_core.sql:50-56`. | Every reversal check and every kind-filtered query scans the table. | M |
| A5 | A `month` broadcast makes every connected student fetch `/api/me` at the same instant, plus statement and `/status` if the bank panel is open. Nothing coalesces or jitters. | `server.js:245, 96-100`; `public/student.js:39-46`; `modules/bank-basic/ui/bank.js:14, 63`. | One teacher click = N to 3N synchronous-SQLite requests in the same tick, with A1 and A3 inside them. | M |
| A6 | `audit()` full-scans entries and runs on every teacher console load and action. | `ledger.js:89-114`; `public/teach.js:19-29`; `server.js:251`; 57 ms at 113k entries. | Linear; the console pays it per click. | L |

### B. State, events and sessions

| # | Finding | Evidence | Impact | Sev |
|---|---|---|---|---|
| B1 | Domain events exist only at the transport layer. `notify` is a closure given to route handlers; `world.advance()` and `ledger.post()` emit nothing; tick/login/player hooks get no notify. | `server.js:245, 324`; `lib/world.js:30-43`; `lib/ledger.js:41-54`; `lib/modules.js:27, 35-36`. | Money moved by ticks, the welcome grant or the simulator is invisible to clients; a future scheduler is silent; the console has no live view. | H |
| B2 | `withTxn` has no after-commit hook, so side effects are sequenced by hand after it returns. Trap: a notify placed after an *inner* `withTxn` inside an outer one fires before the real commit. | `lib/db.js:15-28`; `index.js:79-89`. | Every module re-invents "emit after commit" and some will get it wrong. | M |
| B3 | A revoked session keeps its live SSE stream. Logout, PIN reset, passphrase change and expiry never close streams; the next event still arrives. The client then refetches `/api/me` anonymously, renders $0.00 and throws on `me.world.month`. | Reproduced: both a logged-out and a PIN-reset student's streams received `event: month`. `server.js:164-171, 96-100, 116-119`; `student.js:39-44`. | Stale tabs show wrong data and stop refreshing; revoked sessions keep receiving events. | H |
| B4 | No resync on reconnect: no `id:` lines, no `open`/`error` handlers, no periodic refetch. A reconnect that gets 401 closes the EventSource for good and `stream` is never reset. | `server.js:166`; `student.js:24, 31, 37-47`. Reproduced the permanent close. | After a deploy restart, balances stay stale until the next event or a reload; after re-login, no live updates until reload. | M |
| B5 | PIN-reset race: login awaits scrypt, then creates the session without rechecking. A reset that commits during the scrypt window is followed by a valid session from the old PIN. | `server.js:142-153`; `lib/players.js:118-122`. Reproduced: old-PIN login succeeded in 5 of 6 timed runs. | Reset PIN does not reliably evict someone holding the old PIN. | M |
| B6 | Teacher console has no EventSource and re-renders every module panel on every action, discarding panel state and typed input. | `public/teach.js:12-45`. | Module teacher panels cannot be live or stateful. | M |

### C. Module contract and coupling

| # | Finding | Evidence | Impact | Sev |
|---|---|---|---|---|
| C1 | `onLogin` hooks receive the full player row including `pin_hash` (`authenticate()` returns `SELECT *`). `onPlayer` gets a different, sanitized shape. | `lib/players.js:128-130`; `server.js:151`. Stub module printed `pin_hash present: string scrypt$…`. | Secret hash leaks into every module; inconsistent hook shapes. | H |
| C2 | A module route with neither `role` nor `public` is reachable by any logged-in user, student or teacher. The contract comment does not state this default. | `server.js:319-321`; `lib/modules.js:1-6`. Reproduced: student and teacher both got 200. | Silent authorization default; a forgotten `role:` opens a teacher route to students. | H |
| C3 | Txn kinds are one unprefixed namespace. `ledger.transfer()` defaults to `'transfer'`; the bank keys its cap, feed and reverse route on that literal. | `lib/ledger.js:57`; `index.js:50, 128, 136`. Reproduced: a stub module's transfer counted against the bank cap, appeared in the bank feed, and was reversed via the bank route. | Any future money module collides with the bank by default. | H |
| C4 | Student UI slots are hard-coded (`BUILDINGS`, `ICONS`). A panel with an unlisted `building` gets no door and no icon. | `public/student.js:10-16, 88-93`; `public/ui.js:34-44`. | Every new module edits core UI. | M |
| C5 | The kernel API is missing the reads modules need, so the bank reads `entries`, `txns`, `players`, `classes` with raw SQL and depends on `meta` JSON keys; it matches the ledger's error by string. (The README's "never touch those tables" rule is about writes, which modules respect.) | `index.js:36-37, 48-51, 73, 98-102, 124-128, 136, 147`; `ledger.js:51`. | Ledger storage is a de facto public API; schema changes break modules. | M |
| C6 | No inter-module dependency. `'chequing'` is created by bank-basic but assumed by core UI and will be by every money module. A course enabling a money module without bank-basic boots fine and fails at runtime with a misleading error. | `lib/modules.js:13`; `student.js:18, 41, 97`; reproduced "Cannot transfer to the same account". | Misconfiguration surfaces in class, not at boot. | M |
| C7 | Tick context gives modules course ids only; each module must query players/classes itself to find whom to pay. | `lib/modules.js:27`; `lib/world.js:39`. | Every money module re-implements class scoping. | M |
| C8 | Hooks run without isolation: `onPlayer` throwing on one student rolls back the whole class's creation; `onLogin` throwing is a 500 with no login; `onTick` rollback is documented intent. | `lib/players.js:100-107`; `lib/modules.js:35-36`; `server.js:149-152`. Reproduced all three. | One buggy module blocks logins or class setup for everyone. | M |
| C9 | Module migration ids are array indexes; inserting one mid-list renumbers the rest and breaks boot. Core ids are file names; renaming re-applies. | `lib/modules.js:19`; `lib/db.js:45`. Reproduced both ("table … already exists"). | Schema evolution is fragile exactly where modules will do most of it. | M |
| C10 | Two time domains: the bank's cap is wall-clock rolling 24 h; the world is a hand-advanced month counter. Nothing maps one to the other. | `index.js:23, 47-51`; `lib/world.js:30-43`. | Interest, order expiry, late bills and credit history will each pick a clock. | M |
| C11 | `config.courses[course]` is a prototype-key lookup: `'constructor'` is accepted and persisted as a course id. | `lib/players.js:84`. Reproduced. | Teacher-only route; silent class with no modules. | L |

### D. Identity and lifecycle

| # | Finding | Evidence | Impact | Sev |
|---|---|---|---|---|
| D1 | Single-teacher model: a second teacher is refused; classes have no owner; every `/api/teach` and module teacher route is gated by role only. | `lib/players.js:70, 73`; `migrations/001_core.sql:13-19`; `server.js:183-251`; `index.js:96-153`. | The Semester 2 plan has a colleague running FinTech 10. Adding them today means every teacher route needs an ownership predicate. | H |
| D2 | No season lifecycle: `world.create()` inserts a row and resets the counter and settings; balances, classes and players carry over; nothing is scoped by `world_id`. | `lib/world.js:10-18`; reproduced. | "Everyone starts equal each season" and "season wipe" (PLAN §4, §8) have no mechanism. | M |

### E. Process and ops

| # | Finding | Evidence | Impact | Sev |
|---|---|---|---|---|
| E1 | The three `setInterval`s have no try/catch and there is no process-level error handler. | `server.js:335-341`. Reproduced: a write lock held by a second connection killed the process at `purgeSessions` after the 5 s busy timeout. | Any transient DB error in a timer takes the server down (systemd restarts it, dropping all streams). | H |
| E2 | `migrate()` checks `schema_migrations` outside the transaction that applies the migration. | `lib/db.js:31-41`. | Two processes booting together re-run DDL and one fails. | L |
| E3 | Advance is non-idempotent with no in-flight guard; two concurrent POSTs advanced to months 2 and 3. | `public/teach.js:26-29, 89`; `lib/world.js:30-43`. | A double-click skips a month for every class. | M |
| E4 | Static files are read and SHA-1-hashed on every request, even for a 304, while `assetVersion()` already walks and hashes everything at startup. | `server.js:254-266, 285-292`. | Wasted sync work per request; the photoreal scenes are 1–1.5 MB each. | L |
| E5 | Single-process state: throttle counters, locks, SSE clients and the asset version are in memory; sessions are in SQLite. | `lib/throttle.js:21`; `server.js:300-301`. | Accepted ceiling for the pilot (PLAN says one process). Document it; do not design around it yet. | — |

---

## 3. Target shape

Same stack, same files, with the invariants moved into the kernel and the module boundary made explicit.

```
public/ shell (student.js, teach.js, ui.js)      modules/<id>/ui/*.js
   doors and panels come from /api/me, not a hard-coded list
   SSE is a hint channel: refetch on event, on open, on reconnect
                 │
server.js  transport only: body, cookies, origin, static (prebuilt), SSE fan-out
                 │  subscribes to app.events; never called by modules
lib/app.js composition root
   db.js      withTxn + onCommit queue        events.js  in-process bus
   ledger.js  money (prefixed kinds, read API) clock.js   wall time ↔ world month
   players.js identity (sanitized rows)        policy.js  can(user, action, resource)
   world.js   ticks, seasons                   modules.js registry v2: defineModule, kernel facade,
                                                            requires, named migrations, hook isolation
```

Rules after migration:

1. Money still moves only through `ledger.post()`; kinds are `<module>.<name>` or `core.<name>`.
2. Anything that changes state a client cares about emits a domain event from inside the kernel, after commit. The SSE layer is a subscriber.
3. Modules see a kernel facade, not `app`. The facade is the SDK; raw SQL is for a module's own tables.
4. Authorization is explicit on every route (`access:`) and resource-scoped through `policy.can`.
5. One `clock`. Modules never call `Date.now()`.

---

## 4. Migration steps

Each step is one worktree and one PR. Gates for every step: `npm test`, `npm run sim`, and from Step 0 on `node scripts/perf.mjs` (numbers must not regress). Steps 1, 2 and 4 are independent of each other; 3 before 4's server half; 5 after 3; 6 and 7 after 5; 8 last.

### Step 0. Baseline and perf harness

**Who:** Sonnet. **Size:** XS.

- Merge `core` into `main`; tag `v0-core`.
- Add `scripts/perf.mjs`: seeds a temp DB with 10 classes × 30 bots, 60k txns of mixed kinds (transfers, grants, 2% reversals), one account with 3,000 entries; times `sentSince` (1,500 in-window rows), the teacher transfers list, `statement()` at limit 50 and 500, `ledger.reverse` duplicate check, and `audit()`. Prints a table; exits non-zero above thresholds given on the command line.
- Acceptance: harness runs; current numbers recorded in its header comment as the "before".

### Step 1. Schema for the hot paths (A1–A4, A6 partly)

**Who:** Sonnet. **Size:** S. Fixes the only finding that is an open stall today.

Migration `003_hot_paths.sql`:

- `ALTER TABLE txns ADD COLUMN reverses INTEGER REFERENCES txns(id)`; backfill from `json_extract(meta,'$.reverses')`; `CREATE UNIQUE INDEX txns_reverses ON txns(reverses) WHERE reverses IS NOT NULL` (the database now enforces "one reversal per txn"; the JSON scan goes away).
- `CREATE INDEX txns_kind_created ON txns(kind, created)`.
- `ALTER TABLE entries ADD COLUMN balance_after_cents INTEGER`; backfill with a window function (`SUM(amount_cents) OVER (PARTITION BY account_id ORDER BY id)`); entries are append-only so this never changes.
- `CREATE INDEX sessions_expires ON sessions(expires)` (cheap, while here).

Code:

- `ledger.post()`: `bump` becomes `UPDATE … RETURNING balance_cents`; write `balance_after_cents` on each entry. `reverse()` sets `reverses` and relies on the unique index for "already reversed" (map the constraint error to `LedgerError`). `statement()` reads `balance_after_cents`; drop the correlated subquery.
- New ledger reads: `sumByKind({ account, kind, since, excludeReversed })`, `isReversed(txnId)`, `txnsByKind({ kind, since, limit })` joined with `reverses`.
- bank-basic: `sentSince` → `ledger.sumByKind`; transfers feed → `ledger.txnsByKind`; remove every `json_extract` on `reverses`.
- Guardrail for A1's abuse angle: minimum transfer 100¢ and a per-player action limit (20 transfers per 10 minutes) using the existing `createThrottle` pattern with a second instance.

Acceptance: `npm test` green; `perf.mjs`: `sentSince` < 5 ms, transfers feed < 5 ms, statement limit 50 < 2 ms and limit 500 < 10 ms on the 3,000-entry account, duplicate-reversal check < 1 ms; `audit()` OK on a DB migrated from v0 data (test by seeding on `v0-core`, then migrating).

### Step 2. Process hardening (E1–E4, C11, C1)

**Who:** Sonnet. **Size:** S.

- Wrap each interval body in try/catch with a log line; `process.on('uncaughtException')` and `'unhandledRejection'` log, then exit non-zero so systemd restarts cleanly (do not swallow). Guard the startup `purgeSessions()`.
- `migrate()`: move the `schema_migrations` check inside the same `withTxn` (BEGIN IMMEDIATE serializes two booters). Add a `checksum` column; warn on drift for already-applied ids.
- Static: build `Map<path, { body, gzipBody, etag, type }>` at startup from the same walk `assetVersion()` does (public/ and every `modules/*/ui`), with `__V__` substituted once. Serve from memory; gzip JS/CSS/HTML once. `VDAA_DEV=1` re-reads per request.
- Advance idempotency: `POST /api/teach/world/advance` takes `from` (the month the client saw); `world.advance` throws 409 when `current().month !== from`. `teach.js` sends it and disables the button while in flight.
- `Object.hasOwn(config.courses, course)` in `players.js:84` and `modules.js:23`.
- `readBody`: accumulate Buffers, enforce the limit on bytes, decode once.
- `players.authenticate()` returns `{ id, username, role, class_id }`; the hash never leaves `players.js`. (Removes C1 before the contract work.)

Acceptance: tests for each item: a throwing timer does not exit the process; two concurrent `createApp` on one dir both succeed; 304 path serves from memory; concurrent advances give `[2, 409]`; `course:'constructor'` → 400; a UTF-8 character split across chunks round-trips; a stub module's `onLogin` sees no `pin_hash`.

### Step 3. Events in the domain layer (B1, B2, B6 server half)

**Who:** Opus writes the half-page spec below into code-level detail and reviews the diff to `db.js` and `ledger.js`; Sonnet implements. **Size:** M.

- `db.js`: `withTxn(db, fn)` passes a `tx` with `tx.onCommit(fn)`. Callbacks queue on the *outermost* transaction (per-db stack in a `WeakMap`, replacing the module-level `savepoints` counter) and run after `COMMIT` returns; a `ROLLBACK` at any level discards the callbacks queued inside the rolled-back scope. Callback errors are logged, never thrown into the caller.
- `lib/events.js`: `createEvents()` → `{ on(type, fn), off, emit(type, payload) }`. Synchronous, listener errors caught and logged. Attached as `app.events` in `app.js`.
- Emit points (all via `tx.onCommit`): `ledger.posted { txnId, kind, actor, legs: [{ account, cents }], owners: [{ type, id }] }` (owners come from the `touched` rows already loaded in `post()`); `world.month { month, from }` once per `advance()`; `session.revoked { playerId, tokenHash? }` from `endSession`, `resetPin`, `setPassphrase`, `purgeSessions`; `module.<id>.*` for module-specific events (bank settings).
- `server.js` SSE becomes a subscriber: `ledger.posted` → `balance` to each player owner; `world.month` → broadcast; `session.revoked` → close that player's streams (Step 4 keys streams by token). Remove `notify` from the handler context. bank-basic drops its two `notify` calls.
- Teacher console opens `/api/stream` too (role-aware fan-out: teachers get `ledger` hints at most once per 500 ms, and `month`).

Acceptance: `world.advance()` called directly (no HTTP, as the sim does) emits `world.month`; a `ledger.post` inside an outer `withTxn` that then throws emits nothing; a transfer over HTTP delivers `balance` to both students and a `ledger` hint to the teacher stream; `npm run sim` can count events via a listener.

### Step 4. Client resync and session safety (B3, B4, B5, A5)

**Who:** Sonnet. **Size:** S. Needs Step 3's `session.revoked`.

- Streams keyed by `{ tokenHash, playerId, role }`; `session.revoked` ends them. `/api/stream` sends `id:` lines (monotonic per process) so browsers resend `Last-Event-ID`; no replay is needed under the hint model, the client just refetches on `open`.
- `student.js`: `open` → refetch; `error` with `readyState === CLOSED` → `stream = null`, refetch `/api/me` (shows the login view if revoked); coalesce pokes with a 150 ms trailing debounce and 0–300 ms jitter on broadcast events (defuses A5); the month chip reads `event.data.month` directly; `me` assignments carry a request sequence so an older response never overwrites a newer one.
- `teach.js`: same stream handling; module panels are created once per panel id and kept across `draw()`; panels get `{ me, onRefresh }` like student panels; typed input survives a refresh.
- Login: `authenticate` returns the hash it verified; the route re-reads `pin_hash` by id immediately before `startSession` and returns 401 on mismatch. `logout` becomes `public: true` (idempotent).

Acceptance: node tests reproducing the verifier scenarios: a logged-out or PIN-reset student's stream is closed within one event; reconnect after a server restart refetches; a 401 reconnect leads to the login view and a later login reconnects without reload; the old-PIN race returns 401 in 20 of 20 timed runs; 30 simulated clients on a `month` broadcast produce requests spread over ≥ 300 ms.

### Step 5. Module contract v2 (C2–C9)

**Who:** Opus writes the contract (this section expanded into `docs/modules.md`) and reviews `lib/modules.js` and the ledger prefix enforcement; Sonnet implements the registry, ports bank-basic, and writes the stub module and the contract tests. **Size:** M–L. The payoff step: after it, Phases 1–4's modules need zero core edits.

`modules/<id>/index.js` exports `export default defineModule({ … })`; `defineModule` (in `lib/modules.js`) validates at load and fails boot with a message naming the module and the field:

- `id`; `requires: ['bank-basic']` (topological load order; missing → boot error).
- `migrations: [{ id: '001_settings', sql }]` → recorded as `mod:<id>:<name>`; duplicate names refused; checksums from Step 2.
- `routes: [{ method, path, access: 'student' | 'teacher' | 'any' | 'public', handler }]`. `access` is required; no default.
- `panels: [{ id, building: { key, name, icon }, src }]`. Core draws doors from `/api/me.panels` in module order; `BUILDINGS` is deleted; `icon` is a named core icon or an inline SVG string the module ships.
- `teacherPanels: [{ id, title, src }]`, rendered with `{ me, onRefresh }`, filtered to modules enabled for a course the teacher owns (after Step 7; until then, all).
- Hooks, all receiving the kernel facade `k` first: `onPlayer(k, player)`, `onLogin(k, player)`, `onTick(k, { month, from, classes: [{ id, course_id, studentIds }] })` already filtered to classes whose course enables the module, `onEnable(k, { classIds })` for backfill when a module is switched on for existing classes.
- `events: { 'ledger.posted': fn, … }` subscriptions, registered on `app.events` at load.

Kernel facade (what modules get instead of `app`): `{ id, log, ledger, players, world, clock, events, config, db, HttpError, LedgerError, input }` where:

- `ledger` is wrapped so `post()`/`transfer()` require or auto-prefix `kind` as `<id>.<name>`; core kinds are `core.reversal`, `core.season_reset`. Migration renames existing rows: `transfer` → `bank-basic.transfer`, `grant` → `bank-basic.welcome`, `reversal` → `core.reversal`. `LedgerError` gets a `code` (`INSUFFICIENT_FUNDS`, `UNKNOWN_ACCOUNT`, `ALREADY_REVERSED`, …); bank-basic matches on the code.
- `players` adds `inClass(classId)`, `classesForCourses(courseIds)`, `student(id)`; rows are sanitized.
- `db` exposes `txn(fn)` and `prepare` with the documented rule "your own tables only"; `audit(action, detail)` is on the facade so modules stop importing `lib/db.js`.

Isolation policy, written into the contract: `onLogin` errors are logged and login proceeds; `onPlayer` errors fail student creation with the module id in the message; `onTick` errors roll back the advance (kept) with the module id in the message; event listeners never throw into the emitter.

Port bank-basic to v2 (it becomes the reference module). Add `modules/stub-jobs` under `test/fixtures/`: a payday tick that credits `chequing` from `mint` for the classes it is enabled for, one panel with a new building, one teacher panel.

Acceptance: `test/modules.test.js`: shape errors name the field; `requires` orders loading and fails on a missing dependency; named migrations survive an insertion; a route without `access` fails boot; an unprefixed kind is refused; a throwing `onLogin` does not block login; stub-jobs gets a door and runs its tick only for its classes, with zero diff outside `modules/` and the fixture.

### Step 6. One clock (C10)

**Who:** Opus for the half-page design (which quantities are world-time vs wall-time); Sonnet implements. **Size:** S.

- `lib/clock.js`: `now()` (wall, injectable so tests and the sim can drive it), `today()` (America/Edmonton `YYYY-MM-DD`), `month()` (world). `createApp({ clock })`.
- `worlds` gains `last_advanced_day`; an optional policy `auto_advance: 'manual' | 'school_days'` runs in a guarded timer and calls `world.advance({ from })` at most once per Edmonton school day (idempotent across restarts because the day is stored).
- Every `Date.now()` in `lib/` and `modules/` goes through `clock`. The bank cap is declared as what it is (`window: 24h wall`) and its message says "in the last 24 hours", not "today". Interest, rent, order expiry (future modules) are specified in world months.

Acceptance: sim drives both clocks; auto-advance across a simulated restart advances once; existing tests green with a fake clock.

### Step 7. Teachers, classes and seasons (D1, D2)

**Who:** Opus designs the policy surface and the season semantics (two decisions for Mr. Tang below); Sonnet implements. **Size:** M.

- `class_teachers(class_id, teacher_id)`; `createTeacher` allowed after setup via a one-time invite token generated in the console; `lib/policy.js`: `can(user, action, resource)` with actions `class.read`, `class.manage`, `player.manage`, `world.advance` (world actions stay with the setup teacher, or any teacher: decide). Every `/api/teach` and module teacher route resolves its class and calls `can`; `teach/state` lists only the caller's classes.
- Seasons: `worlds.status` (`active` | `closed`); `world.close()` snapshots net worth per player into `season_results`, posts `core.season_reset` transactions that move every player balance to `system:sink` (the ledger stays balanced and auditable), and marks the world closed; `world.create()` is refused while one is active; classes get `world_id` of the new season on reopen.

Decisions needed: (1) do players keep their pseudonyms across seasons (recommended: yes, zero the money, keep the name and achievements); (2) can any teacher advance the world, or only one (recommended: one designated "world teacher", since the clock is shared by all blocks).

Acceptance: teacher B gets 403/404 on teacher A's class routes and does not see it in state; a closed season's balances are zero, `audit()` passes, `season_results` holds the snapshot; the console's module panels are filtered by the teacher's courses.

### Step 8. Read models and console cost (A6, B6 leftovers)

**Who:** Sonnet. **Size:** S.

- `audit()` runs on demand (button) and nightly in a guarded timer, with the last result cached in `audit_runs`; the console shows the cached result.
- Per-class aggregates as one indexed query; transfers feed paginated by `txn.id` cursor; an `audit_log` reader endpoint and panel (it is write-only today).

Acceptance: console load does no full-table scans (EXPLAIN in a test); feed pages.

---

## 5. Accepted ceilings and non-goals

Named so nobody "fixes" them by accident:

- **One process, one SQLite file, synchronous queries, 5 s busy timeout.** Correct for a few classes on one VM. The ledger and triggers are already safe across processes if that ever changes; events and throttles are not (E5), and would move to the DB or a broker then, not now.
- **In-memory throttle and streams.** A restart drops login counters and reconnects every stream within 5 s. Fine.
- **No Postgres port.** The data layer is deliberately SQLite-shaped (`RAISE` triggers, `json_extract`, `INSERT OR IGNORE`, `COLLATE NOCASE`, synchronous `withTxn`). Porting would mean an async data layer, not a driver swap. Do not pre-abstract for it; do keep SQL inside `lib/` and module files, never in `public/`.
- **No framework, no generic plugin system.** `defineModule` is a validator and a facade, not a platform.
- **Hint-model SSE, no replay.** Clients refetch; the server never stores events.

---

## 6. Who does what

The split that keeps tokens down: Opus owns the four files that carry invariants (`lib/db.js`, `lib/ledger.js`, `lib/modules.js`, `lib/policy.js`) and the three specs; Sonnet does everything else with the acceptance tests as the contract.

| Step | Design | Implementation | Review before merge |
|---|---|---|---|
| 0 Baseline + perf harness | this doc | Sonnet | tests + harness runs |
| 1 Hot-path schema | this doc | Sonnet | harness thresholds; Opus skims the `ledger.post` diff (RETURNING + balance_after) |
| 2 Process hardening | this doc | Sonnet | tests |
| 3 Domain events | **Opus**: `onCommit` semantics, event names and payloads, ordering | Sonnet | **Opus** on `db.js` and `ledger.js` only |
| 4 Client resync | this doc | Sonnet | tests |
| 5 Module contract v2 | **Opus**: `docs/modules.md`, facade surface, kind migration | Sonnet (registry, bank-basic port, stub, tests) | **Opus** on `lib/modules.js` and the ledger wrapper |
| 6 One clock | **Opus**: half page | Sonnet | tests |
| 7 Teachers and seasons | **Opus** + two decisions from Mr. Tang | Sonnet | **Opus** on `lib/policy.js` and `world.close()` |
| 8 Read models | this doc | Sonnet | tests |

How to hand a step to Sonnet:

1. New worktree from `main`, one step only.
2. Paste that step's section and the "Rules after migration" list from §3. Not the whole document.
3. Tell it the gates: `npm test`, `npm run sim`, `node scripts/perf.mjs`, and that the acceptance list is the definition of done. Let it run the tests rather than reason about them.
4. For Steps 3, 5 and 7, first have Opus produce the spec file named in the table; Sonnet gets the spec plus the section.
5. One PR per step; Opus reviews only the files the table names.

Haiku has no role here: nothing in this plan is low-stakes enough to be worth the re-reading it would cause.

---

## Appendix A. Verifier measurements

Scratch copy on a Mac, Node 26.9, `node:sqlite`. VM numbers (Node 24, e2-micro) will be slower.

| Query | Size | Time |
|---|---|---|
| `sentSince` with reversal `NOT EXISTS` | 56,585 txns, 1,500 in-window rows | 3,872 ms |
| same without the subquery | same | 1.6 ms |
| `sentSince` | 30,201 txns, 800 rows | 852 ms |
| teacher transfers feed (100 rows) | 56k txns | 261 ms (0.3 ms with EXISTS removed) |
| `statement()` limit 50 / 500 | 3,006-entry account | 48 ms / 426 ms |
| `statement()` limit 50 | 250 / 1,000 / 2,000 entries | 1.7 / 8.1 / 16.7 ms |
| `ledger.reverse` duplicate check | 56k txns | 29 ms |
| `audit()` | 113k entries | 57 ms |
| 60 concurrent scrypt (student creation) | | 551 ms, RSS +66 MiB |

## Appendix B. Scanner observations not independently verified

Not findings. Listed so they are not lost; verify before acting.

- Throttle `Map` grows with attempts for non-existent usernames and rotating IPs; the sweep is every 60 s and entries live up to an hour (`lib/throttle.js:36-50, 96`).
- `audit_log` has no reader anywhere; the bank teacher panel says transfers are "logged" but the log is not visible.
- `fuzz.test.js` discovers core routes by regex over `server.js` source and only asserts `>= 13`, so a multi-line `route()` call would be silently skipped.
- `security.test.js` has timing-sensitive windows (400 ms / 30 s) that may flake on a loaded VM.
- Two "locked" definitions: `throttle.status()` counts the per-IP minute bucket, `trouble()` only the hourly one, so the roster can show "Unlock" for students not in Login trouble.
- `createStudents` hashes up to 60 PINs concurrently (`Promise.all`), peaking memory on the 1 GB VM.
- PLAN.md says a nightly `.backup` exists on the VM; no script for it is in this repo.
