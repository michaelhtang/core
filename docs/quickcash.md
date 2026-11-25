# Quick Cash Counter (Arcade game 4): spec

Status: spec, 2026-11-25. Mr. Tang picked this game from the NGPF Arcade inventory. Clean room: the general idea (you play the lender, so you learn what the lender knows) is the only thing taken from anywhere. Names, wording, structure and figures come from his lesson `ft10-s3-u4` ("Quick cash, real cost") and this spec. Nobody opens or copies any other game.

## The idea in one paragraph

You work the loan counter at a made-up lender. Customers walk up one at a time, each short a sum of money. The counter sells four kinds of borrowing, the four that cost money in his lesson: a payday loan, a cash advance on a credit card, a line of credit, and a credit card balance carried for a while. Each customer gets all four offers, each with its own length of time. Pick the one that earns the counter the most before the customer gives up and leaves. No calculator. The lesson underneath: **what borrowing costs depends on the rate and on how long you owe it**, and the payday fee is the highest rate of all. After the round, every customer's card shows what they really paid and what was cheapest for them.

## Rules

- 30 ticks a second. A round is 6 customers. Each customer waits 600 ticks (20 s, a bar shows it). Picking an offer ends the wait; then a 45-tick result flash; then the next customer. `ROUND = 6 * (600 + 45) = 3870`. The round ends after customer 6 or at tick ROUND.
- Inputs: mask bits 1, 2, 4, 8 = offer A, B, C, D (`MASK_MAX = 15`). A pick is the rising edge of one bit while a customer is waiting. Two bits rising on the same tick: the lowest wins. Presses during the flash are ignored.
- A customer who waits out the bar leaves: the counter earns $0 for them.
- Score = the sum, in whole dollars (cents rounded down at the end of the round, after summing cents), of what the picked offers cost each customer. Nothing else adds or subtracts.
- Seeded: the server's seed picks 6 of the pool's customers (no repeats) and the order of the four offers for each. Draw order is fixed. Integer maths only (the core's own `idiv`, no `/`, no floats, no `Math.random`, no `Date`), so the replay matches on any engine.

## Costs (all in cents, precomputed in the pool table; the test recomputes every one)

| kind | how the cost is worked out | source |
|---|---|---|
| payday loan | $15 for every $100, for each payday the customer borrows it (1, 2 or 3 paydays, 14 days each) | his class notes, `REVIEW-ft10-s3-u4` items 2, 3, 8 (his Flag 4, decided 2026-11-25: "just go with $15 per $100 payday cap") |
| cash advance | 23% a year, simple, for the days owed, plus a $5 fee | his example rates, items 5 |
| line of credit | 10% a year, simple, for the days owed | his example rates, item 5 |
| card balance carried | 21% a year, simple, for the days owed | "a card at about 21% a year", item 16 |

Days use a 365-day year and round to the nearest cent, as the unit does. Terms: up to 365 days. Payday repeats: at most 3 (the unit's own example goes to 13; the game stays short). "Borrows it again every payday" is the wording; never "borrows again to pay back the last loan" (the unit does not say that).

## The pool

24 made-up customers (a first name, a reason in a few words such as "car repair" or "rent is short", the amount: $200 to $600). Each has its four offers with their terms. Pool rules, checked by the test:
- Every customer gets all four kinds.
- The most expensive offer is a payday loan for at least 6 customers, a cash advance for at least 5, a carried card balance for at least 5. (A line of credit never wins: it is the cheapest rate, which is the lesson.)
- The top two offers of every customer are at least $1.00 apart (no ties to argue about).
- At least 6 customers have a top-two gap of $10 or less (so it takes thought).

## Screens

- Before: a "How to play" card (numbered steps written from the constants) and the four kinds with their rule in one line each.
- Playing: the customer (name, reason, amount), the wait bar, four offer buttons A to D (kind, rate, how long). Keys 1-4 or A-D, or tap. Big tap targets on a phone.
- Flash: "+$NN" and whether it was the most expensive of the four.
- End card: a row per customer: what they paid with your pick, the most expensive offer, the cheapest offer, and one line: "A parent, a friend, or a card paid off in full would have cost nothing" (unit item 6). Then the total and how many of 6 were the top pick.
- Student-facing pages credit Mr. Tang. Plain Grade 10 language. No store, brand or product names. No overdraft, no late-fee dollar figure, no payday rules beyond the $15.

## Server

Registered in `GAMES` as `quickcash` (title "Quick Cash Counter"), event `played_quickcash` emitted on a verified finish with at least one input, like the others. **Pay:** Today errand `play-quickcash` ("Play a round of Quick Cash Counter", 50 cents x price index, energy 1, priority 6), exactly like Debt Snake's (Mr. Tang, 2026-11-25), done by `module.arcade.played_quickcash` and offered only while the game is on for the class (`todayFacts` gives `quickcashOn`). The score never pays; nothing else about money changes. Per-class switch, teacher panel, leaderboard and the 12-an-hour start limit come from the shared Arcade code. Tile in the Arcade grid after the other in-app games; placeholder thumbnail = the game's own ready frame at 480 x 300 (ComfyUI art later).

## Decided, and still open (his)

Decided by him on 2026-11-25:
- Pay: Today errand `play-quickcash` ("Play a round of Quick Cash Counter", 50 cents x price index, energy 1, priority 6), exactly like Debt Snake's (Mr. Tang, 2026-11-25), done by `module.arcade.played_quickcash` and offered only while the game is on for the class (`todayFacts` gives `quickcashOn`). The score never pays; nothing else about money changes.
- The $15 per $100 payday cap (his Flag 4): "just go with $15 per $100 payday cap". It stays the figure from his class notes; the Alberta check in Flag 4 was not done.

Still open:
1. Every figure, the made-up amounts and terms, and all student-facing wording go in `modules/arcade/REVIEW-quickcash.md` for him to confirm (next to `REVIEW-wordle.md`).

## As built (2026-11-25)

Built and tested, not live: his review is pending. Files: `modules/arcade/ui/games/quickcash-core.js` (the game: `C`, `KINDS`, `POOL`, `createGame`, `step`, `replay`, `score`, `isOver`, `report`, plus `offers`, `customerOf`, `money`, `idiv`), `ui/games/quickcash.js` (the DOM screen), the `quickcash` entry in `GAMES` (`modules/arcade/index.js`), a tile and a `UI.quickcash` entry in `ui/arcade.js`, `.arc-qc*` rules in `arcade.css`, `ui/thumbs/quickcash.jpg`, `modules/arcade/REVIEW-quickcash.md`, and tests `test/arcade-quickcash-core.test.js` and `test/arcade-quickcash.test.js`. The errand `play-quickcash` is in `modules/today/errands.json` (added after the build, on his 2026-11-25 pay decision).

As specified, with these choices the spec left open:
- **Rules.** 30 ticks a second, 6 customers, 600-tick wait, 45-tick flash, `ROUND` 3870, `MASK_MAX` 15, `MAX_INPUTS` 2000 (as Bill Dash and Diversify; 100 could reject a round from a student who mashes keys). A pick is a rising edge while a customer waits; the lowest bit wins a double press; a key held through the flash does not pick for the next customer (it must be let go and pressed again). The wait ends on the 600th tick without a pick (a press on that tick is too late). A round of six early picks ends after 6 x 46 = 276 ticks; a round with no picks runs all 3870.
- **Draw order.** One stream, `hash32("quickcash:" + seed)`: six draws pick the customers (a partial shuffle of the 24), then six four-card shuffles give each customer's offer order.
- **The pool** is a frozen table of 24 rows, costs in cents. Payday loan = amount in dollars x 15 x paydays (cents, exact). Cash advance, line of credit and card = amount x rate x days over 365, nearest cent, plus the $5 fee for the cash advance. Because 365 is odd, no cost is ever exactly half a cent, so rounding has no tie. Winners: payday 8, cash advance 8, card 8, line of credit 0. Smallest top-two gap $1.70; 8 customers have a gap of $10 or less.
- **Score** is `idiv(sum of cents, 100)`. `report(state)` is what `/finish` returns as `stats`: a row per customer (name, reason, amount, the pick, what they paid, the most and least expensive offer, whether the pick was the top), `total` cents, `topCount` and the one-line sentence. The sentence says "cost nothing in money" (his note: a friend can cost the relationship).
- **Screen.** A DOM screen, not a canvas. The game's card has numbered steps written from the constants and the four kinds in one line each (the same "How to play" section the other games use). Playing shows the customer, a wait bar, four offer buttons A to D, then the flash. Keys 1 to 4 and A to D, or tap. One second of "Get ready" first (not part of the core's ticks). A hidden tab or closed page abandons the round, as in the other games. The end card is built from the server's report. Credit: the legend on the game's card says it is built from Mr. Tang's lesson "Quick cash, real cost".
- **Thumbnail** `ui/thumbs/quickcash.jpg` (480 x 300): ComfyUI art (2026-11-25): `node tools/comfy-gen.mjs art thumb-quickcash --seed 401 --w 1280 --h 800` (FLUX Krea, the lesson-art style), scaled to 480 x 300. Picked from seeds 401 to 404: 403 drew "NFT" on a bag and 404 a face too close to a real public figure, so both were deleted. The sign reads "QUICK-CASH LOAN", a generic phrase, not a store name. Source PNG kept only on his Mac (design/art/*.png is ignored by git).
- **Server.** No new routes: `quickcash` is a `GAMES` key, so start, finish, the per-class switch, the teacher panel, the leaderboard and the 12 starts an hour come from the shared code. `module.arcade.played_quickcash` is emitted on a verified finish with at least one input; Today's `play-quickcash` errand listens for it. Test: `test/arcade-quickcash.test.js` (offered only while on, done by a verified finish with input, pays 50 cents x the index once, not by an empty log or a rejected round).
- **Tests that pin the game list** (`arcade-switches`, `arcade-wordle`, `diversify`) now list `quickcash` after `debtsnake`. With five arcade errands at priority 6, the test worlds that read an arcade errand (`arcade`, `arcade-switches`, `arcade-debtsnake`, `diversify`) drop FinWord and Quick Cash Counter so their three picks are certain; the Quick Cash Counter test drops FinWord and Diversify.

Not verified: play on a real phone. A headless 375 px run played a whole round with keys, a double press and a tap, and a replay of the recorded inputs matched; no student has played it. The $15 per $100 is his decision (2026-11-25), the figure from his class notes; the Alberta cap itself was not looked up.
