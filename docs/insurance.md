# insurance (Wave 2b): policies and town events

Code: `modules/insurance/` (`constants.js` every figure, all **illustrative**; `index.js`; `ui/insurance.js`, `ui/teach.js`). Tests: `test/insurance.test.js`.
Config order: `bank-basic, rates, jobs, [housing,] insurance, credit, bills, savings`: insurance before bills so its lines are this month's due lines.

## Policies
| Policy | Premium | Deductible | Covers | How held |
|---|---|---|---|---|
| tenant | $20/mo | $500 | burst pipe, laptop theft | student buys/cancels, effective next month; billed as `insurance-tenant` |
| phone protection | $12/mo | $100 | phone screen | same; `insurance-phone` |
| auto | the Bills "Car insurance" line | $500 | car repair | automatic when the student chose the car (`module.bills.choices`); not billed again |
| condo unit | in housing's costs ($35) | $500 | burst pipe (before tenant) | automatic while `module.housing.value` has homeValue > 0; not billed again |

Premiums are emitted as `module.insurance.costs` each tick before bills. Cancel before a policy has started deletes it; cancel after ends it next month.

## Town events
Catalogue (illustrative): phone screen $250, car repair $800, burst pipe $1,200, laptop theft $900, dental emergency $400 (no policy covers it), tax refund $200 (windfall).
The world teacher triggers one for a class or the whole town; it lands at the next tick (`insurance_triggers`, who was hit / skipped is stored on the trigger). Optional random draw: `config.options.insurance.randomEvents` (default off; the sim turns it on only with `--events-random`), `randomChancePct` (default 8) per student per month.

**Fairness caps (PLAN section 4):** at most 1 event of any kind per student in any 3 world months (`minGapMonths`), and at most $3,000 of *expense* events per student per season (`seasonCapCents`). Windfalls are not capped but do use the student's one event in their window. A skipped student gets nothing; the trigger row counts `skipped_recent` and `skipped_cap`.

**Waiting period:** a bought policy pays only for events landing after a whole month in force (`start_month < event month`): bought in m, billed from m+1, pays for events from m+2. Teacher triggers and random events alike. Auto and condo follow the same rule: auto starts the month after a switch to the car (switching away ends it), or the month of the first billed tick for a car chosen before it (bills already charges its insurance that month), condo the month after the purchase (a sale ends it); the start months are kept in `insurance_players` from the events insurance already receives. Migration `005_cover_backfill` gives rows from before the columns existed a start of 0 (in force), the driver's world from `insurance_known`; housing's monthly value fills a missing condo start the same way. The student panel says so and shows "Pays claims for events from world month N" (or "Car cover pays ..." / "Condo cover pays ...") while a cover is new.
**Random draws:** `HMAC-SHA256(secret, "worldId:playerId:month:salt")`, the secret a per-world random 16 bytes in `insurance_secrets` (made on first use, never in a route response); deterministic per world and secret.

**Expense:** `module.insurance.expense` -> bills adds the full amount as due line `event-<id>`. If a held policy covers it (see the waiting period), insurance posts a claim (`insurance.claim`, mint -> chequing) of `max(0, amount - deductible)` in the same tick, so the student sees the full bill and the claim.
**Windfall:** `insurance.windfall`, mint -> chequing, no bill.

Only students bills has announced (`module.bills.choices`, at their first billed tick) are eligible, so nobody gets a claim for a bill that was never issued; a trigger in the very first tick therefore lands on nobody.
