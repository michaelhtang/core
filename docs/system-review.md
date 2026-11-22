# vDAA whole-system review (2026-10-22, main @ 069ea9f, tag v8-rrsp)

Method: six read-only scanners (money, security, architecture, clock/ops, frontend, tests/docs), each finding re-checked from scratch by an independent verifier. Only CONFIRMED items are listed. Of about 74 candidates, 69 were confirmed (many at a lower severity than first claimed), 4 rejected, and a few narrowed. 321/321 tests pass; the 60-month sim audits clean every month.

Verdict: the core is sound. Money moves only through the ledger, every advance is one transaction, scoping by class and player holds, SQL is parameterized, the DOM is built safely (no XSS surface found), and the module contract is honoured (no module reads another's tables). The problems are at the edges: debts the ledger doesn't see, the window between seasons, a few teacher-console footguns, information students can trade on, and missing operations pieces (backup, deploy files, setup token).

## Status (2026-10-23)

All eleven section-A items are fixed and merged into main: five fix branches (teach-ui, season, ops, rates-ins, arrears), each independently verified, with up to two fix rounds each; 358 tests pass. How each was fixed:

- A1: every bill is owed from the moment it is issued (a per-student `payable` ledger account), so unpaid bills count in every net-worth figure; a never-payer is below an autopayer from the first snapshot.
- A2: student state-changing requests are refused while the season is closed; students see a "Season closed" screen.
- A3: the Exchange event selector keeps its choice; events, undo, reverse, town-wide triggers, market events and Advance month all confirm.
- A4: PIN batches are kept (never replaced), one action at a time, warning before leaving unprinted cards.
- A5: lateness is judged only for bills and card statements issued before the advance started (`startMonth`).
- A6: nightly WAL-safe backup + pre-deploy backup, tested restore steps, systemd units, nginx site, `deploy-vdaa.sh` with rollback; setup refused without a token.
- A7: bond-linked funds pause while a policy-rate change is pending.
- A8: insurance pays only for events from the month after cover starts (tenant, auto, condo); random events are seeded by a per-world secret.
- A9: signed-in students enter a new season on their next page load (welcome grant once), and every screen re-syncs on close/create.
- A10: a `seasonClose` hook runs inside the close transaction (jobs reset, Hall of Fame/Life Reviews); a failure rolls the close back.
- A11: one noisy address can't lock out a class (600/15 min, /64 keying, world-teacher Unblock); teacher trusted devices can't be locked out by strangers.

Docs (branch b-docs): B15 is fixed (PLAN.md sections 7, 8, 11-13 now describe node:sqlite on the VM and the real data handling, with the retention and data-location choices left as an explicit decision for Mr. Tang and the school). In section C, the docs drift is fixed except the code items: the 39% homeowners claim and the current Wolf-rank defaults in `docs/leaderboards.md`; the duplicate "## 8", the `auto_advance` payload and the undocumented events (`jobs.payday`, `jobs.assigned`, `savings.rate`, `insurance.triggered`, the `bills`/`credit`/`insurance` `changed` events) in `docs/events.md`; `k.policy`, the stale clock note and the unused `onEnable` in `docs/modules.md`; the `createClock` signature in `docs/clock.md`; the stale "Phase 0 core" intro and the script list in `README.md`; the status column in the PLAN roadmap; the historical status block in `MIGRATION.md`; card payments now posting to `payable` and the `module.bills.late` wording in `docs/phase2.md`. Still open from that bullet: `package.json` has no perf/check scripts (code) and there is no CI.

Section B (2026-10-23, six branches, each independently verified with up to two fix rounds; 413 tests on main): B1-B13 and B15-B17 are fixed.
- B1: module events reach teacher consoles as one coalesced hint after commit (none on rollback); a per-kernel statement cache roughly halves a month's advance time.
- B2: listeners inside a transaction run in their own savepoint; a listener whose transaction SQLite aborted rethrows to the emitter.
- B3: per-student tick work runs in savepoints (`k.forEachPlayer`); a skipped student is recorded in `tick_failures` and shown to the world teacher; if a module fails for more than half the students in a month (counting loops and listeners), the whole advance rolls back; auto-advance stops on any failure or skip until the world teacher resumes; dividends and RRSP settlement stay all-or-nothing.
- B4: catalogues are upserted at boot (edits apply on restart; rows removed from the file are retired, not deleted); `housing_catalogue` dropped.
- B5: per-world no-school days editable by the world teacher, pre-filled with the full EPSB 2026-27 calendar; auto-advance stops at season_end.
- B6-B10: console refresh sequencing and focus restore; double-tap guard on student money actions; persistent inputs; first-load retry; readable header pill on day art.
- B11-B13: failed-login timing parity; idle timeout; re-login ends the old session; log out everywhere; raw `__Host-` cookie names with a time-boxed legacy fallback; HSTS; 3 streams per player; `k.players.classesFor(user)`; private data files.
- B16-B17: card-bought resales refund the card (a credit, not a payment); returning employees keep their wage.
- Section C: config option keys declared and checked; runtime hook tests; a 60-month economy guard test; sim teacher actions (`--teacher`); fuzz split plus GET fuzz; season-close tests for credit, savings, insurance and rates; tick-order pairs; robust timing tests.

Still open: B14 and the cross-module helper/event-payload cleanups (Phase 4 prep, review section E); `package.json` perf/check scripts and CI; the retention and data-location decisions in PLAN.md section 8.

Phase 4 core prep (branch p4-kernel, not merged): E1 service calls (`k.modules.call` / `has`); E4 business-owned accounts reset at close, reach their students' streams through an `ownersOf` hook, and a stake is a `seasonAssets` row (no core registry); E5 one core price index (`k.world.priceIndex`), `money`/`dice`/`ok` in the kernel, the payload `worldId`s and `world` in the onTick context (section C's two bullets); E2 a dynamic-securities foundation in exchange (`listSecurity` / `delistSecurity`, market maker still the counterparty). Not done: the card-limit sink (kept as events), E2's matching/settlement and E3 (jobs and student employers).

## A. Fix before the pilot

| # | Finding | Evidence | Fix direction |
|---|---|---|---|
| A1 | **Unpaid bills are not debt.** Net worth = ledger accounts + home + holdings; open `bills_due` rows (and late-fee lines) are invisible. A student who never pays anything ranks above a student who pays on time. An insured expense's claim is minted while the bill stays unpaid, so the claim is pure profit. | 4 students, 10 months: never-pays = $26,495 net worth vs autopay = $14,515; board ranks C #1 (never pays + insurance), B #2, payers last. Same order in `season_results`. `bills/index.js:96-136`, `leaderboards/index.js:52-58`, `savings/index.js:154-158`, `world.js:36-41`. | Make arrears a ledger debt: a per-player `bills.arrears` account (allow_negative). When a bill goes late, move the amount into arrears (student owes it); paying later clears arrears. Every net-worth sum uses `accountsOf`, so all of them pick it up with no listener edits. Optionally collect from chequing automatically on payday (garnish) after N months late. |
| A2 | **The season gap is unguarded.** Between `close` and the next `create`, `current()` returns the closed world and only exchange checks `w.status`. Students can sell outfits (cash into S2), get a welcome grant in the closed world and again in S2 ($1,000 vs $500), apply for a card and buy/resell. | HTTP repro: parka bought before close, sold in the gap → S2 chequing $850 vs $500. Spare student: `welcome worldId:1` then `welcome worldId:2` → $1,000. `world.js:14,20-28`, `outfitters/index.js:74,113`, `bank-basic/index.js:55-68`. | Kernel guard: when `k.world.current().status !== 'active'`, reject student POSTs (except login/logout) with 409 "The season is closed", and skip `onLogin` grants. Show a "Season closed, next one starts soon" screen. Alternatively make close+create one teacher action. |
| A3 | **Exchange teacher panel can fire an event at the wrong company.** The company `<select>` is rebuilt on every console refresh (any student trade), resetting to the first stock; "Queue event" has no confirm and events can't be undone. | `modules/exchange/ui/teach.js:19,26`; refresh on every ledger hint (`server.js:137-141`). | Preserve the selected ticker across rebuilds; add a confirm naming the company and the effect. |
| A4 | **PIN cards can be lost.** "Generate accounts" and "Reset PIN" write the same `cards` variable, so resetting one PIN replaces a freshly generated batch (PINs are shown once). Generate has no busy state; a double-click creates two batches and the first batch's PINs are gone. | `public/teach.js:245,253,51-54`; scrypt makes the window wide. | Separate variables (append reset cards); disable the button while in flight; prompt to print/download before leaving. |
| A5 | **Multi-month advances mark bills late before anyone can pay.** Bills issued in month m are late at the m+1 tick; "Advance 2+ months" runs both ticks in one transaction. | Repro: advance {months:2} → rent, utilities, groceries, phone, internet, transit all `months_late:1` with fees $25–37.50 each. `bills/index.js:105,118,122-131`. Credit statements behave the same. | In `onTick`, only mark late if `due_month < from` (the month the advance started at; `from` is already in the tick context). Same for credit statements. |
| A6 | **No backup, no restore, no deploy files, setup token optional.** PLAN.md promises a nightly `.backup`; nothing exists. No systemd unit, nginx snippet or deploy script. With `VDAA_SETUP_TOKEN` unset, the first stranger to POST `/api/setup` becomes world teacher; with it set, guesses are unthrottled. | `git ls-files`; `server.js:189-191`. | `scripts/backup.mjs` using `VACUUM INTO` (WAL-safe) + a cron line and a pull-to-Mac step, with a tested restore; `deploy/vdaa.service`, `deploy/nginx.conf` (real_ip from Cloudflare ranges, `X-Forwarded-Proto https`), `deploy-vdaa.sh`; refuse `/api/setup` without a token unless `VDAA_DEV=1`; throttle it. |
| A7 | **Students can trade on a queued rate change.** `pending_bp` is visible to students; the DAAB shock (−7 × Δ) is deterministic and larger than the noise. | Monte-Carlo (20k): −100 bp cut → +7.05% mean, 100% profitable, worst +1.78%; −25 bp → +1.81%, 89% profitable. `rates/index.js:79,89`, `exchange/index.js:334-345`. | Don't show the pending rate to students (the Bank of DAA announces at the tick), or apply the bond shock at the tick the change is queued (markets price announcements immediately). |
| A8 | **Insurance can be gamed.** No waiting period: buy in m, event at m+1, cancel. With `randomEvents` on, the draw is `dice(id, month, salt)` with no secret, so a student can predict every random event from the code and their own id (4/4 predicted). | `insurance/index.js:28,88-92,141,155,18,96`. | Seed random events with the world secret (like exchange); require a policy to be held before the trigger is queued (start ≤ queued month), or a 1-month waiting period. |
| A9 | **Students signed in across a season boundary get no grant and no notice.** `onLogin` only runs on POST /login; `world.create` emits nothing; `world.closed` goes to teachers only. 14-day sessions make this common on Chromebooks. | Repro: cookie kept through close+create → `/api/me` shows chequing $0 in S2. | Run the "new world" hooks on first `/api/me` in a new world id (or broadcast `world.created` to students and force a re-sync). |
| A10 | **Season-close cleanup isn't atomic.** `world.closed` listeners run after commit, errors swallowed, no retry. `jobs_holdings` is not per world, so a failed jobs listener carries S1 wages/steps into S2. Hall of Fame/Life Review are written the same way. | Repro: listener throws → close succeeds, `jobs_holdings` still `step:2, wage 99999`. `modules.js:156`, `jobs/index.js:155,228-233`, `leaderboards/index.js:299`. | Add a `seasonClose` hook that runs inside the close transaction (like `seasonAssets`), and move the jobs reset and the finale into it. Or make `jobs_holdings` per world. |
| A11 | **One student can lock out the whole class.** The per-IP login bucket (150 wrong tries / 15 min) is keyed on the school's shared NAT address, so one student spraying wrong PINs blocks everyone on that IP, teacher included. Per-account lockout from any IP (30/hour) is by design and teacher-unlockable. | `lib/throttle.js:35,46,51`; verifier repro. | Raise the per-IP bucket for authenticated-looking traffic, or key the IP bucket on (IP, username) with a larger pure-IP ceiling; keep per-account lockout. |

## B. Fix soon (medium)

| # | Finding | Evidence / fix |
|---|---|---|
| B1 | A 12-month advance blocks the event loop ~13 s (300 students) and writes ~105k SSE `console` events to every teacher stream, inside the transaction, including for advances that roll back. | `kernel.js:50` emits immediately; `server.js:152`. Coalesce the `console` hint like the `ledger` hint; fan out after commit. |
| B2 | Listener errors inside a tick are swallowed with no savepoint, leaving partial state; docs say listeners run "after commit" but tick-time `module.*` events run synchronously inside the advance. | `lib/events.js:11-16`, `modules.js:155-157`; `docs/modules.md:95`, `docs/events.md:3,43` vs `:55`. Add a strict in-txn emit (rethrow) for tick events; fix the docs. |
| B3 | One shared transaction means one failure domain: a data-dependent throw for one student rolls back every class's month, and auto-advance retries forever every 5 min. | `modules.js:158-168`, `world.js:82-86`, `server.js:493`. Per-student savepoint + quarantine list surfaced to the world teacher. |
| B4 | Catalogue edits never reach a deployed database: wages/prices are seeded inside migration SQL; a checksum change only warns. `housing_catalogue` is written and never read. | `db.js:79-83`, `jobs/index.js:154,195`, `bills:225`, `outfitters:248`. Seed via idempotent upserts at boot, or ship UPDATE migrations. |
| B5 | Auto-advance ignores holidays (`noSchool: []`) and `season_end` is display-only. | `clock.js:15-18`, `world.js:74-102`. Fill Alberta/Parkland break dates; stop auto-advance at season_end. |
| B6 | Teacher console: focus (not text) lost on every refresh, ~16 requests per poke, no sequencing; Undo/Reverse, Advance, insurance "Whole town" trigger, housing market event have no confirm; rows shift under the cursor. | `public/teach.js:42-105`, module teach.js files. Debounce refresh harder, restore focus generally, confirm irreversible actions. |
| B7 | Student money buttons have no busy state (double-tap → double POST): savings move/GIC, exchange, bank send; "Buy this condo" has no confirm. Housing posts `/qualify` on every refresh. | `savings.js:45-49,96-99`, `exchange.js:103-111`, `bank.js:35-45`, `housing.js:114-118,155`. Disable while in flight; confirm condo. |
| B8 | Jobs promotion-reflection textarea is rebuilt on every refresh (typed text lost). Credit/housing inputs lose focus (phone keyboard dismissed). | `jobs/ui/jobs.js:17,49`, `credit.js:103`, `housing.js:151-153`. Keep persistent elements. |
| B9 | A failed first `/api/me` leaves a blank page: no message, no retry, stream never opened. | `sync.js:55`, `student.js:113`, `teach.js:358`. Show "Can't reach vDAA, retrying…" and retry. |
| B10 | Header class label and "← Back to town" sit on the photo outside glass (ice on bright day art); contrast unverified but likely poor. | `theme.css:138-141,117`, `app.css:5`. Put them in a pill or add a text-shadow; check at `/?daypart=day`. |
| B11 | Teacher passphrase is limited per IP only (IPv6 /64 rotation defeats it); `/api/teach/passphrase` not throttled; teacher usernames identifiable by timing. Sessions 14 days, no idle timeout, old sessions survive re-login; no "log out everywhere". | `server.js:200-205,304-311,19,209-215`, `throttle.js:45`. Per-username failure budget for teachers; throttle the passphrase route; idle timeout; self-service logout-all. |
| B12 | Cookie parser returns 400 for ANY malformed cookie, including ones set by sibling `*.michaelhtang.com` apps; cookie is `sid` not `__Host-sid`; no HSTS. SSE connections uncapped per session. | `server.js:52-60,227-233`. Ignore bad cookies; rename; cap streams per player (3). |
| B13 | Leaderboards `/teach` gives an invited teacher other classes' medians and the leader's value even with hide-amounts (parity with what students see; info-level). Each teacher route re-implements the class filter (11 sites). | `leaderboards/index.js:388-389`; add `k.players.classesFor(user)`. |
| B14 | Business `owner_type` is allowed by the schema but season close, `season_results`, `seasonAssets` and SSE hints assume players only (latent until Phase 4). | `world.js:36-43`, `modules.js:228`, `server.js:138`. |
| B15 | PLAN.md still describes Supabase/RLS/pg_cron (§7, §11) and says "student data is wiped at the end of each season" — nothing is purged; players and per-world rows persist. This matters if the plan is shown to the school as a privacy statement. | `PLAN.md:210-212,247-248,291-292`. Rewrite to match node:sqlite + a real retention policy (e.g. purge per-world rows N months after close). |
| B16 | Cash advance via outfitters: buy on card, resell same month at full pre-GST price into chequing (~95%), interest-free within grace. Not money creation (GST lost) but levers A7. | `outfitters/index.js:80-123`, `constants.js:131`. Resale from card purchases goes back to the card, or same-month resale pays less. |
| B17 | Quit-and-rehire beats the 3% raise when inflation > raise (only at teacher-set inflation above ~3%). | `jobs/index.js:21-22,62-67`. Rehire wage = max(catalogue × index, previous wage) within N months, or keep the raise clock. |

## C. Tests, sim, docs (low)

- `test/modules.test.js:479-495`: three hook tests only check `defineModule` accepts/rejects a spec; the runtime behaviours (badges throw skipped, bad seasonAssets row fails close, simulate course filter) are untested.
- No test asserts the 60-month economy targets; the sim never runs teacher actions (rate change, events, promotions, freeze) or a season close with activity; jobs/insurance bots bypass the routes; bots never lose a job or change behaviour.
- Sim "paying in full" is biased low (cards with no statement drop out of the denominator), not a bot bug; true share > 54%.
- Sim is non-deterministic (bills `Math.random`, exchange secret) — fine, but `jobs/index.js:244` still claims determinism.
- Timing-bounded assertions (`test/security.test.js:214-230` upper bounds; 100 ms sleeps in resync/events tests) could flake on a slow box.
- Season close untested for credit, savings, insurance, rates (low exposure: no listeners). Fuzz covers POST bodies only; `auto_advance` not in BASE; `/api/outfitters/unequip` untested.
- Config: ~30 option keys read, 2 declared; no schema, typos ignored; `savings.hisaRate` is a percent, others bp. Both courses list identical modules; `requires` is only `bank-basic`.
- Tick-order guard covers most pairs but not housing<credit, housing<insurance, jobs<housing/credit/exchange, rates<credit/savings/outfitters; order comes from config, not the contract.
- Duplicated helpers: price-index sink ×6, card-limit sink ×2, `money` ×9, `dice` ×6, `ok` ×6; `k.db.prepare` uncached (two private caches; credit re-prepares per student per tick).
- Event payload inconsistency: housing.value/payment, bills.paid/late, credit.score lack `worldId`; onTick context drops `world`.
- Docs drift: `docs/leaderboards.md:134` claims 39% homeowners (now ~31%); events.md two "## 8" headings, `world.settings` payload missing `auto_advance`, undocumented events (jobs.payday, jobs.assigned, savings.rate, insurance.triggered, *.changed); modules.md §3 omits `k.policy`, stale clock note; clock.md signature omits `noSchool`/`dayOf`/`hour`; `onEnable` unused; README "Phase 0 core"; PLAN roadmap has no status column; package.json lacks perf/check scripts; no CI.
- Data files are world-readable (umask); DB holds scrypt hashes of 6-digit PINs.
- `scripts/demo-seed.mjs` defaults to the production port (harmless once a teacher exists).

## D. Rejected (checked and not a problem)

- Pay stub view "goes stale" after payday — it shows a correctly labelled earlier stub with the new one listed.
- Credit bots "don't pay in full" — a sim reporting artifact.
- `docs/leaderboards.md:27` vs `:134` contradiction — consistent.
- `credit/constants.js:21` "season ~5 months" — correct (150 days).
- Teacher console "wipes typed text" — only focus is lost; values persist.

## E. Phase 4 readiness (student businesses, IPOs, student-to-student matching)

The v2 contract holds for S2. It will not hold for Phase 4 as built:

1. There is no request/response path between modules; events are fire-and-forget and swallow errors. A ventures module can't ask exchange to list a security or settle a trade. Add a kernel service registry (`k.modules.call(id, fn, args)`) with a strict in-txn emit.
2. Exchange's market maker is the counterparty (buys → sink, sells/dividends ← mint); `secs(k)` is a static catalogue cached per kernel. Student-to-student matching needs a separate settlement path and a dynamic security table.
3. Jobs mints gross pay and `jobs_holdings.job_id` FKs the fixed catalogue; a student employer breaks both.
4. Season close, `season_results`, `seasonAssets` and SSE assume player owners; business accounts survive the reset today.
5. Move the price-index sink, card-limit sink, `money`/`dice`/`ok` and a cached `prepare` into the kernel before adding a sixth copy.

## F. Day-one runbook gaps

No backup/restore; no undo-an-advance; a persistently throwing module tick freezes the clock with no way to skip it short of editing config; no world-teacher passphrase reset (SQL by hand); no re-run of a missed season cleanup; no "season closed" screen; no deploy files; holiday list empty.
