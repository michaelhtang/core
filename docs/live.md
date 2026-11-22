# Live town: the home screen and open buildings update by themselves

## As built

**The rule.** The SSE stream is only a hint channel (`public/sync.js`): when a hint arrives the page refetches `/api/me` and redraws from it, so a hint never carries data and a student only ever reads their own authorised endpoints. This wave adds two more hints and reuses the three that already existed.

### What was already live (before this wave)

| Hint (SSE event) | Sent by | To | What the page does |
|---|---|---|---|
| `balance` | core, on every `ledger.posted` (and a business owner's students through `ownersOf`) | the owner's streams | debounced `/api/me` refetch: balance, **all header chips** (they come from the core `badges` hook: stress, Wolf rank, DAAX ticker, newest headline, age and stage), every home card's `onRefresh` (Around town, Today, Stress...) and open panel `onRefresh` |
| `month` | core, `world.month` | every stream | month chip set at once from the payload, then the same refetch, with 0-300 ms jitter so a class does not refetch in one instant |
| `world` | core, season closed or created | every stream | refetch, full redraw if the season status flipped |
| `replaced`, `ping` | core | one stream | parked notice / keepalive |

So a month tick already updated the ticker, the news chip, the stress and Wolf chips, the Today digest and the Around town card with no reload. Exchange prices and news are only ever written inside the month tick (a teacher's market event is queued and applied at the next tick), so there is nothing between ticks to push for them; the new test `test/live.test.js` pins this ("the ticker and news chips ride on the month event"). What was **not** live: a feed item caused by a classmate or the town between ticks (a job taken, a home bought, a rates announcement), and an errand or quest that finished without moving money.

### What was added

| Hint | Module | To | Meaning |
|---|---|---|---|
| `feed.new` | feed | the students of the class that got a new item; a town item (class NULL) goes to the students of every class | `{}`: "the Around town list changed". The page refetches `/api/me`, which redraws the card and the chips |
| `today.done` | today | the one student whose errand or quest was just completed | `{}`: the Today card flips the row to done (and the energy and streak chips) on the refetch |
| `walk.roster` | walk | the teachers of the class (teacher panel only) | see docs/walk.md; sent only when someone joins or leaves the map |
| `walk.presence.off` | walk | the class's students | a teacher switched presence off (docs/walk.md) |

`public/student.js` lists `feed.new` and `today.done` in its `events` (so they poke the debounced refetch) and `feed.new` in `broadcast` (so it gets the jitter). Nothing else on the page changed: the cards already redraw from `ctx.onRefresh`.

**Coalescing and the tick.** A month tick emits tens of thousands of domain events inside one transaction, so a push is never sent from a listener. `lib/live.js` `createHints(flush, 500)` is the one helper: a module calls `k.db.afterCommit(() => hints.mark(key))` where it writes, and one unref'd timer per module calls `flush(keys)` once per 500 ms window with every key marked meanwhile, then `k.push(..., { skippable: true })` in pieces of 200 ids. `k.db.afterCommit` (new, `lib/kernel.js`, wraps `lib/db.js` `afterCommit`, the same mechanism `server.js` uses for the console hint) runs the mark after the outermost COMMIT, at once if no transaction is open, and drops it when its transaction or savepoint rolls back, so a rolled-back month or a failed student savepoint pushes nothing. Per feed item or completed errand the cost is one closure and one `Set.add`. Each module clears its timer on `app.closing`.

**Privacy.** The payloads are `{}`. Classmates cannot learn each other's balances: they learn only that their own class list changed, then read the card data (the `homeCards` payload of their own `/api/me`), exactly as before (a feed amount is already hidden as `$•••` when leaderboards hides amounts). A class push goes only to that class's students (`k.players.inClass`), never to a teacher or another class; `today.done` goes to one student.

### Numbers

`node scripts/perf.mjs payday=500 month300=1000` (median ms, this machine, limits are 500 and 1000), two runs each:

| | payday | month300 |
|---|---|---|
| before (main @892ce81 and an earlier run) | 429.2, 412.5, 393.6 | 617.3, 572.5, 605.3 |
| after | 385.9, 387.4 | 578.5, 561.2 |

No measurable cost (run-to-run noise is larger than the difference). A micro-benchmark of 20,000 feed inserts in one transaction (the feed's own writes dominate): 240-259 ms before, 263-276 ms after (about 1 microsecond per item for the mark), and exactly one `stream.push` after the window. `node scripts/sim.mjs --months=60`: exit 0, economy guard clean.

### Ceilings

- A `feed.new` makes every student of that class refetch `/api/me` at most about twice a second (pushes are at least 500 ms apart; the client adds a 150 ms debounce and up to 300 ms jitter, so the gap can be as short as about 500 ms). A month that also writes feed items makes students refetch twice per advance (`month`, then `feed.new` about 500 ms later). A class of 30 in a busy lesson is a few dozen `/api/me` a second at worst; `/api/me` is built to be fetched on every live update (docs/modules.md homeCards). If it ever hurts, raise `LIVE_MS` in `lib/live.js`.
- A fact-based errand (such as "Pick a job") is completed when the Today card is next built, not at the click; the job's own feed item (or any balance change) is what makes an open page rebuild it. An errand finished by a fact with no feed item and no money still waits for the next refetch, or for the student to come back to the town (the card also fetches fresh when it opens).
- `today.done` is sent when the completion commits; a completion inside `/api/me` makes one extra refetch.
- A town item goes to every class, including courses that do not enable the feed (they refetch once for nothing).
- Hints are skippable: a backed-up socket drops them; the next one, a reconnect or a reload carries the truth.
- The teacher console was not changed: its panels still refresh on its own `ledger`/`console` hints; only `walk.roster` is new there.

### Tests and checks

`test/live.test.js`: a class push reaches that class only, no payload, none to the other class or the teacher; 1000 items in one transaction become one push per student after the commit; 1000 single commits are one or two windows; nothing on a rollback or a rolled-back savepoint; a town item reaches every class; `today.done` reaches only the finisher; the month event brings the ticker, headline and Wolf chips; the UI files carry the hooks (grep); `createHints` itself. Browser check (demo seed, local server): with a student on the home screen, a classmate's job pick added the Around town line, a teacher advance updated month, stress, DAAX, headline and Wolf chips, and the student's own job pick flipped the errand to done and added $2.00, all without a reload (a `window` marker survived); at 375 px the page did not scroll sideways; no console errors on either page.
