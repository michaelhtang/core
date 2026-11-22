# Outfitters (Phase 1b)

A store for wardrobe and home items, built as one module under the v2 contract (`docs/modules.md`): zero core edits. Its job is to make spending decisions mean something once students have income and bills (FIN1010 needs vs wants; FIN3080 opportunity cost).

## Guardrails (PLAN.md §6)

- **Cosmetic only:** no item gives money, rates, score or any game advantage.
- **Fixed catalogue:** no student uploads or naming.
- **No loot boxes or randomness:** no random drops or mystery prices.
- **No real money.**
- **Earned, not bought:** the best items are unlocked by achievements.

## Catalogue (upserted at boot, see docs/modules.md "Catalogues"; config can override prices)

About 24 items in 3 groups.

**Wardrobe** (slots head / top / bottom / shoes / accessory):
- a basic tee to a winter parka;
- a DAA Wolves hoodie;
- a toque;
- sneakers vs designer sneakers, so needs vs wants is visible;
- a phone case.

**Home** (slots couch / bed / desk / tech / decor):
- a second-hand couch vs a new sectional;
- a desk;
- a gaming setup;
- plants;
- a mattress.

**Achievement items:** not for sale. Each unlocks when its condition is met, from events (below).

Each row holds:
- `id`, `group`, `slot`, `name`;
- `price_cents`, a realistic 2026 Canadian retail price. Cite a few anchors; the rest may be illustrative and marked so.
- `category`: `need` or `want`;
- `depreciation_bp_per_month`: clothing ~400, furniture ~150, electronics ~250 (illustrative, documented);
- `icon`: an inline SVG that passes `public/svg-allow.js`;
- `unlock` (achievements only).

## Buying

- **Price shown:** price × the price index (listen to `module.rates.changed` `priceIndexBp`; 10000 without rates), plus **GST 5%**. Alberta has no PST; cite CRA. Show both lines and the total.
- **What it would grow to** (on every item): the total at a long-run planning return over 5 world years. Use the FP Canada / IQPF 2026 Projection Assumption Guidelines' equity or balanced rate (cite; mark the exact figure). "This $180 jacket = $240 in 5 years if invested instead." This is the opportunity-cost lesson.
- **Paying from chequing:** kind `purchase`, chequing → sink.
- **Paying by card:** when the student has a card and a known limit (listen to `module.credit.limit`, per world as bills does). Refused past the limit.
- **Ownership:** an item is owned once per student per world. Equipping is one item per slot.

## Selling (resale)

- An owned item can be sold back at its current value: purchase price (before GST) × (1 − depreciation)^(months owned), floored to the cent.
- The money comes from the mint (the buyer is outside town), kind `resale`.
- Bought on the card: refunded to the card first, up to what it owes; the rest to chequing (see Rules below).
- Show "you paid $X, it's worth $Y now" on every owned item. This is the depreciation lesson.

## Achievements (from existing events only; no other module's tables)

| Item | Unlocked when |
|---|---|
| "Credit 750+" bomber jacket | `module.credit.score` ≥ 750 |
| "First keys" key-ring | first `module.housing.value` with homeValue > 0 |
| "On time" watch | 6 consecutive world months with every `module.bills.paid` on time (booked on its `dueMonth`) and no `module.bills.late` |
| "Promoted" blazer | a promotion: if jobs doesn't emit one, add `module.jobs.promoted { playerId, worldId, month, title }` to jobs (the one allowed cross-module edit) and docs/events.md |
| "Emergency fund" umbrella | the HISA balance reaches 3 × the student's latest monthly bills. Needs `module.savings.snapshot { playerId, worldId, month, hisa, netWorth }` from savings and a bills total. If the bills total isn't available by event, use 3 × last net pay from `module.jobs.paid` instead and document it. |

An achievement is announced to the student once ("Unlocked: …"), and is per world.

**Class goals (Wolf outfits):** when ≥ 80% of a class's students meet a goal in a world month, the class unlocks a Wolf outfit. The first two goals:
- "everyone paid every bill on time this month";
- "class median credit score ≥ 700".

The outfit is shown in the class's corner mascot. Art comes later from ComfyUI: keep an `outfit` key and fall back to the plain wolf. The teacher sees goal progress.

## Panels

- **Student** (building key `outfitters`, name "Outfitters", allowlisted inline SVG icon):
  - shop tab: group filter, each item with price + GST + total, need/want tag, and the "would grow to" line;
  - "My look" and "My place" tabs: equipped items and owned items with current value and a Sell button;
  - achievements with progress.
- **Teacher:** per class: spending on wants vs needs, items sold, achievement counts, class-goal progress, and a world-teacher toggle to open/close the store.

## Simulate

- Bots buy one "need" item every few months.
- 30% buy a "want" when chequing exceeds 2 months of bills.
- 10% sell something old.

## Economy check

`npm run sim -- --months=60`: still meets every docs/phase2.md target. Add a sim column: median spent at Outfitters per student.

## Tests

- price × index + GST;
- the would-grow-to math;
- resale depreciation to the cent;
- card limit and season (world) scoping;
- each achievement fires once;
- class goals unlock at the 80% threshold;
- the guardrails (no stat effect: no other module's numbers change after purchases, apart from the money spent).

---

## As built (2026-10-22)

Files: `modules/outfitters/{index.js, constants.js, ui/outfitters.js, ui/outfitters.css, ui/teach.js}`. Config order: `... credit, bills, outfitters, savings` (after bills, so last month's late marks are known when the streak is judged; before savings, which stays last).

### Constants and sources (all in `constants.js`, checked 2026-10-22)

| What | Value | Source |
|---|---|---|
| GST | 5% (500 bp), no PST | CRA "GST/HST calculator (and rates)": Alberta 5% GST, 0% PST |
| "Would grow to" | total x 1.063^5 (630 bp, 5 world years, compounded yearly, floored to the cent) | FP Canada / IFP 2026 Projection Assumption Guidelines (released 2026-04-16): Canadian equities 6.3%. **Exact-figure warning:** the FP Canada release lists Canadian 6.3% and U.S. 6.4%; the Institute's French page swaps them (6.4% / 6.6%). The guidelines are meant for 10+ years; 5 years is a classroom simplification |
| Depreciation | clothing 400, furniture 150, electronics 250 bp a month | illustrative, no source |
| Mattress (queen) | $895 | endy.com, Endy queen |
| Desk | $199 | IKEA Canada desks, LAGKAPTEN / ALEX 120x60 |
| Gaming setup | $749.99 | PS5 Digital Edition after Sony's April 2, 2026 Canadian rise (tech-insider.org; secondary) |
| Everything else (parka, tees, couches, ...) | marked illustrative in the catalogue and in the shop | the parka's retail pages could not be read |

`config.options.outfitters`: `prices { "<item id>": cents }`, `projectionBp`.

### Rules decided while building

- **Price** = (catalogue price or config override) x the world price index (`module.rates.changed`), rounded; **GST** = 5% of that, rounded; total = price + GST. Resale uses the price paid before GST, `floor(price x (1 - dep)^months)`, months = world months since purchase (0 on the day: full value), integer (BigInt) math.
- **Card:** refused without a card, or without a limit announced for THIS world (`module.credit.limit`), or past `balance + limit`. A new season has no limit until credit announces one.
- **Resale** pays from the mint. An item bought from chequing pays into chequing. An item bought **on the card is refunded to the card** (decision 2026-10-23, review B16): the money goes to the card up to what the card owes at the sale, and only the rest (when the card was already paid off) goes to chequing. This is the real-world norm (a store refunds to the original payment method) and closes the cash advance: buy on the card, resell the same month at full pre-GST value into chequing, buy again, turning about 95% of the limit into interest-free cash. Rejected: a same-month resale discount (it would also penalize a student paying cash who changes their mind). The refund is also announced as `module.outfitters.refund` (with the purchase's `boughtMonth`) inside the sale's transaction. As on a real card it is a credit, not a payment: by itself it never meets the minimum or earns an on-time mark (a statement settled by payments plus refunds of items on it counts as paid in full), so buying and reselling on the card after a statement cannot stand in for paying it. It does settle the open statement's balance for interest, but only when the refunded purchase was on that statement. **Earned items** (price 0) are given on unlock, can be equipped, never sold.
- **Store switch:** `POST /api/outfitters/store { open }` (world teacher). Closed stops both buying and selling.
- **Emergency fund:** "monthly bills" = the largest month of `module.bills.paid` amounts in the last 3 months (bills has no total event); with none, last net pay from `module.jobs.paid`.
- **On time (6 months):** a world month is clean when a bill DUE in it was paid on time (`module.bills.paid` is booked on its `dueMonth`, so bills paid by hand in a later live month count for the month they belong to, exactly like autopay at the tick) and no late payment or `module.bills.late` fell in it. Judged at our tick over the six months up to `startMonth` (the last month students had live; in a 1-month advance that is the month before the tick), and the streak is 0 if any tick of this advance flagged a bill late, so a bill left unpaid at month end (flagged late at the next bills tick) blocks the award. Months issued during a multi-month advance are judged at the next advance, the same rule bills uses for lateness. Chosen over "a month with no payment is neutral": that rule still gives a hand-payer who pays two months of bills in one live month half the clean months of an autopayer; booking on the due month gives both the same streak and the same unlock tick (`test/bills.test.js` "multi-month advances: a hand-payer ..."). The emergency fund's "monthly bills" is booked on `dueMonth` too, so paying two months at once does not double it.
- **Class goals:** checked at our tick. "Everyone on time": 80% of the class's students have a clean last month. "Credit 700": at least 80% of the class has a score and the median of those scores is 700 or more (reading "80% meet the goal" for a median goal as "80% take part"). The outfit keys are `suit` and `grad` (art in public/art/wolf-<key>.png; `hoodie` and `winter` exist for future goals); the student panel probes the image and only then sets the corner mascot, otherwise the plain wolf stays.
- **Season scoping:** ownership, unlocks, goals, limits and facts are all keyed by world id. Items are not a season asset (no `seasonAssets`): they never count toward a season result.
- **Bots** (`simulate`): every 4 months a bot buys the cheapest "need" it lacks if chequing covers it plus a month of bills; 30% buy a "want" every 3rd month when chequing exceeds 2 months of bills plus the price; 10% sell the oldest item over a year old.
