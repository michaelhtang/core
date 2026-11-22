# credit (Wave 2a): the Credit Bureau and the card

Code: `modules/credit/` (`constants.js` every number and its source, `score.js` pure maths, `index.js` module). Tests: `test/credit.test.js`.

## Inputs (events only)

`module.jobs.paid` (gross, for the limit), `module.bills.paid` (`onTime: true` is an on-time mark, on the bill's `dueMonth`, so a bill paid by hand in the live month after a multi-month advance marks the same month as autopay at the tick), `module.bills.late` (a late mark),
`module.housing.payment` (on-time or late; an optional `kind: 'mortgage'` also opens the file and counts toward the mix),
`module.rates.changed` (`cardAprBp`; default 2099), `module.outfitters.refund` (a store refund is a credit, not a payment, review B16: kept as the statement's `refund_cents`, never toward the minimum or an on-time mark; it counts toward paying the statement in full, for interest, only when the purchase was on that statement, `boughtMonth < statement month`; a statement settled in full by payments plus such refunds owes nothing, so it has no late fee either). `paid` with `onTime: false` adds nothing: bills emits `late` first.
Marks are unique per (student, source, bill, month), so a bill that stays late is one mark a month.
Booking on-time bill marks on the due month (not the paid month) matters only early in a season: across 2-month advances, a hand-payer's live score trailed an autopayer's by 21 points for the first two advances (626 vs 647, 652 vs 673) until three on-time months filled the payment factor; now they are equal at every point. The score saved at a tick is computed before that tick's payments, so in the first two advances the saved score of a hand-payer still lags by the month not yet paid (604 vs 626, 652 vs 673), then matches.

## Emitted

`module.credit.score` `{ playerId, month, score }` each tick per student with a file (inside the tick transaction).
`module.credit.statement` `{ playerId, worldId, month, balance, minimum }` each tick per card holder, with the new statement (0 / 0 when nothing is owed): housing's TDS uses the minimum.
`module.credit.limit` `{ playerId, worldId, limitCents, aprBp }` on approval, so anything that spends on the card (bills, Outfitters) can enforce the limit without reading credit's tables. (Addition to the phase2 events table.)

## Score = 300 + 600 x sum(weight x factor); no file = null ("No credit history yet")

| Factor | Weight | Factor 0..1 |
|---|---|---|
| Payment history | 35% | thin file 0.7, +0.1 per month with an on-time payment (cap 1); minus 0.25 per late mark, each fading linearly to 0 over 24 months; at most 3 marks a month |
| Utilization | 30% | card owed / limit: 1.0 to 10%, 0.8 at 30%, 0.5 at 50%, 0.2 at 75%, 0 at 100%; no card = 0.5 |
| Length | 15% | months since the file opened / 36 |
| New credit | 10% | applications in the last 12 months: 0 = 1, 1 = .85, 2 = .6, 3 = .35, 4 = .15, 5+ = 0 |
| Mix | 10% | product types held (card, mortgage, line of credit): 1 = .5, 2 = .8, 3 = 1 |

Weights: the 35/30/15/10/10 split printed by Hardbacon and ClearScore Canada (checked 2026-10-22). Equifax and TransUnion do not publish
their formulas and no FCAC or Equifax page readable that day gave percentages, so the weights and every curve are **illustrative**.
Bands (Hardbacon): Poor 300-599, Fair 600-649, Good 650-699, Very good 700-749, Excellent 750-900.

## Card

Ledger account kind `card`, opened with `k.ledger.openAccount({ ..., allowNegative: true })` (the facade passes the option through; no core change).
Negative = owed. Application: one inquiry always; declined (with reasons) if the 3-month average gross is under $1,000, the score is under 560,
or 4 applications in 12 months. Limit = clamp(floor to $100 of average gross x pct, $500, $2,500), pct = 50% with no file, else 30% at 560 rising to 100% at 800.

Credit ticks before bills (config order `... jobs, credit, bills ...`). Tick order per card holder: (1) autopay first, all or nothing from chequing: `full` pays everything owed now (the last statement and any charge since), `min` pays the last statement's minimum, (2) the last statement is judged: minimum unpaid = $29
late fee + late mark, else an on-time mark; interest = floor(statement balance x APR / 12) on the WHOLE statement balance unless it was paid in full,
(3) new statement = what is owed after autopay (so it includes the interest and fee), minimum = max($10, ceil 3%) capped at the balance, due next tick, (4) score recomputed and emitted.
With 2+ months per advance, a statement issued during the advance (month > `startMonth`) is not judged and not replaced until the next advance (autopay still runs each tick), so the student gets a live month to pay the minimum. The cost of that: a statement carried through a multi-month advance earns one month of interest, not one per month carried, so revolvers pay less interest when months per day is above 1 (by design: no penalty without a live month to act).
Charges made after credit's tick (bills pays by card after it) land in the next statement; autopay-full clears them at the next tick, so a pay-in-full student never pays interest or sits near the limit. Simplification: real cards charge interest from each purchase date.

Worked example: $1,000.00 statement at 20.99%, minimum paid. Minimum $30.00. Interest floor(100000 x 2099 / 120000) = $17.49, so the next
balance is $987.49. At minimums only, this balance takes 139 months and $1,101.28 of interest.
