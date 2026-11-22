# Phase 2: Credit and Housing

Four new modules under the v2 contract, plus small changes to `bills` and `savings`. Built in two waves:

- **Wave 2a:** `rates` (Bank of DAA), `credit` (bureau + credit card), and the `bills` / `savings` changes they need.
- **Wave 2b:** `housing` (rent tiers, buying, mortgages, renewal) and `insurance` (policies + town events).

Module order in `config/vdaa.json` (2a ships without housing and insurance): `bank-basic, rates, jobs, housing, insurance, credit, bills, savings`. Housing and insurance tick before bills so their lines (`costs`, `expense`) become this month's due lines; credit ticks before bills on purpose: credit's autopay clears last month's card charges first, then bills charges this month's to the card (see docs/credit.md). Insurance sits right after housing, so a home bought this month is known before premiums are emitted. Modules talk only through events (`k.events.emit` inside the tick transaction, listened to via the `events` field), never through each other's tables. Every constant has a source and a checked date in the module's constants file; anything a page wouldn't confirm is marked illustrative. Integer cents throughout.

**The rule that ties it together:** each module emits facts about its own domain (`paid`, `late`, `costs`, `value`, `changed`); the modules that care listen. A module that's switched off simply produces no events, and everything else keeps working.

## Events added (also to docs/events.md)

| Event | Emitted by | Payload |
|---|---|---|
| `module.rates.changed` | rates | `{ worldId, month, policyBp, primeBp, hisaBp, mortgage5yBp, mortgageVarBp, locBp, cardAprBp, inflationBp, priceIndexBp }` (a world's first tick, a policy change, and each month the price index steps; see "Inflation") |
| `module.bills.paid` | bills | `{ playerId, month, dueMonth, billId, onTime, amount }` |
| `module.bills.late` | bills | `{ playerId, month, billId, monthsLate }` (only for rows due at or before the month the advance started) |
| `module.housing.costs` | housing | `{ playerId, month, lines: [{ key, name, amount, category }] }` (each tick, before bills by load order; bills turns them into due lines and stops charging its own rent line) |
| `module.housing.value` | housing | `{ playerId, homeValue, mortgageBalance }` |
| `module.housing.payment` | housing | `{ playerId, month, onTime, amount, kind: 'mortgage' }` |
| `module.credit.limit` | credit | `{ playerId, worldId, limitCents, aprBp }` (emitted on approval, after commit; there is no limit-change flow in 2a. Bills keeps the latest per player and world to refuse card payments past it) |
| `module.credit.score` | credit | `{ playerId, month, score }` |
| `module.credit.statement` | credit | `{ playerId, worldId, month, balance, minimum }` (housing's TDS) |
| `module.insurance.costs` | insurance | `{ playerId, month, lines: [{ key, name, amount, category }] }` (each tick, before bills; bills turns them into due lines `insurance-<key>`) |
| `module.insurance.expense` | insurance | `{ playerId, month, eventId, eventKey, name, amount, insuredBy }` (module events are prefixed with the emitting module's id, so this is not `module.events.*`; `eventId` is an addition: bills keys the due line `event-<eventId>` by it) |
| `module.bills.choices` | bills | `{ playerId, options, autoPremiumCents }`: `options` = every plan slot's effective option; emitted at a student's first billed tick and whenever they change a plan; insurance listens |

---

## Wave 2a

### `rates`: the Bank of DAA

- One table per world: `policy_bp` (default **225** = 2.25%, Bank of Canada after its Sept 2, 2026 hold), with derived rates computed, not stored separately:
  - prime = policy + 220 bp (4.45%);
  - HISA = policy + 50 bp (2.75%);
  - 5-year fixed mortgage = policy + 195 bp (4.20%, near the ~4.0–4.4% advertised insured 5-year fixed range, 2026);
  - variable mortgage = prime − 50 bp;
  - line of credit = prime + 300 bp;
  - card APR fixed at 2099 bp (20.99%).
  
  All spreads are config options.
- **Rate announcements:** the world teacher sets a new policy rate from the panel; it takes effect next tick. Announcing the rate already in force cancels a queued change. Students see the queued rate (announcements are the lesson); `module.rates.pending` tells the Exchange, which pauses the bond-linked funds until it applies (docs/phase3.md). Optionally, scheduled announcement months (8 per world year, like the Bank of Canada) show a "Next announcement: month N" banner.
- Student panel (building `bank-of-daa`): the policy rate history chart and what each change does to "your" HISA, card and (later) mortgage rates.
- `savings` change: when `rates` is loaded, HISA = the `rates` HISA rate (listens to `changed`); savings' own lever is hidden. Without `rates`, nothing changes.

### `credit`: the Credit Bureau and the card desk

**Score.** Range 300–900, as Canadian bureaus report. Recomputed each tick from the module's own records, which are fed by events. Weights per the commonly published Canadian breakdown: payment history 35%, utilization 30%, length of history 15%, new credit 10%, mix 10%. Cite the source.
- **Payment history:** on-time vs late from `bills.paid`, `bills.late`, `housing.payment` and the card's own payments; a late payment's weight decays over 24 world months.
- **Utilization:** card balance ÷ limit.
- **Length:** months since the first credit account.
- **New credit:** applications in the last 12 months.
- **Mix:** card, mortgage, line of credit.
- **Starting point:** "no file" until the first credit product.

Show students the score **and** the factor breakdown. The point is that they can see why it moved.

**Credit card.**
- **Application:** one inquiry. Approval and limit come from the last 3 months' gross pay (from `jobs.paid`) and the score: $500 to $2,500 tiers, with the formula in the constants file.
- **Account:** kind `card`, a liability that may go negative.
- **Spending:** bills can be paid by card (the bills change below), and later Outfitters purchases.
- **Monthly statement each tick:** balance, minimum payment = max($10, 3% of balance) (outside Quebec), due by the next tick.
- **Interest:** if last statement's balance wasn't paid in full, interest = floor(balance × APR / 12) on the statement balance. Document the simplification; real cards charge from the purchase date.
- **Payments:** a student pays min, full or any amount from chequing; autopay options are min or full.
- **Late:** missing the minimum costs a $29 late fee posted to the card, plus a payment-history hit.
- **"Payoff calculator":** at minimum payments only, how many months and how much interest. This is the FIN1010 moment.

**Line of credit:** later; not in 2a.

### `bills` changes (2a)

- **Emit events:** `paid` and `late` at the right moments.
- **Payment source:** chequing (default) or card, if the student has one. A card payment posts `card −amount, payable +amount` (kind `bills.payment`): a bill is owed from the moment it is issued (the sink was paid then, kind `bills.owed`), so paying it, from chequing or the card, clears the student's `payable` account and the sink gets nothing again. Only an unpaid row from before migration 008, never posted to `payable`, still pays the sink, and the card account is found with `k.ledger.accountId('player', id, 'card')`. `card` is a documented shared account kind, like `chequing`. If the card would exceed its limit, the payment is refused.
- **Built (2a):** `paid` carries `billId` = the bill's id string (`rent`, `groceries`, `late-fee-<dueId>`, `housing-<key>`), `onTime` = paid in or before its due month; `late` fires every tick for every still-unpaid overdue bill (fee lines included) that was due at or before the month the advance started (`startMonth`, so a multi-month advance never marks a bill late for a month the student never got to play), `monthsLate` = months past due. Both are emitted inside the write's transaction. Student setting `pay_from` (`chequing` | `card`, `POST /api/bills/pay-from {source}`; `card` is selectable only when `k.ledger.accountId('player', id, 'card')` exists). The card limit is the latest `module.credit.limit` per player and world (table `bills_limits`, keyed `(player_id, world_id)`); without one for the current world, card payment is unavailable (chequing pays), so a Season 1 limit never lets bills borrow in Season 2. Autopay follows `pay_from`; autopay from the card pays a bill from chequing instead when the card has no room for it (and chequing covers it), so nobody is marked late while they have money. A manual pay keeps the refusal, because the student chooses. Housing lines become due lines `housing-<key>` and replace that month's catalogue rent line when they arrive before bills' tick (housing loads before bills). Lines arriving after bills' tick apply from the next month, never a reversal. Housing line categories other than needs/wants/fees count as needs.
- **Housing costs (2b, but build the listener now):** listen to `module.housing.costs`; when a student has housing lines this month, replace the catalogue rent line with them.

---

## Wave 2b

### `housing`: rent or buy

**Tenure options** (each a row in a seeded catalogue with source and checked date):
- **Shared room:** the bills default.
- **1-bedroom apartment:** $1,290/month (Edmonton average, Rentals.ca March 2026 $1,288, Nesto June 2026 $1,292).
- **2-bedroom:** about $1,635 (shared with a roommate option).
- **Buy a condo:** list price default **$202,000** (Edmonton average condo, June 2026).
  - Condo fees: illustrative $400/month.
  - Property tax: 1.03637%/year, Edmonton 2026 residential, Bylaw 21442, billed monthly as 1/12.
  - Home insurance (condo unit): illustrative $35/month.

**Moving:** a tenure change applies next month. Renting adds a one-month damage deposit, held by housing as an account, refundable on move-out.

**Buying** (FIN1010: rent vs buy, mortgages).
- **Down payment minimum:** 5% of the first $500,000 and 10% of the portion from $500,000 to $1,500,000. Above $1.5M needs 20% and isn't insurable; for this game, cap prices at $1.5M.
- **Mortgage default insurance** if the down payment is under 20%: the CMHC premium is added to the loan.
  - 4.00% for 5–9.99% down;
  - 3.10% for 10–14.99%;
  - 2.80% for 15–19.99%.
  - Verify the current table on cmhc-schl.gc.ca and cite it.
- **Qualifying:**
  - **Stress test:** qualify at max(contract rate + 2%, 5.25%).
  - **GDS** = (mortgage payment at the qualifying rate + property tax + heating + 50% of condo fees) ÷ gross monthly income ≤ 39%.
  - **TDS** = GDS costs + other debt payments (card minimum) ÷ gross ≤ 44%.
  - Gross income is the last 3 months from `jobs.paid`. Show the student each ratio and why they did or didn't qualify.
- **Closing costs:** legal fees, illustrative $1,500, plus the Alberta land title fee formula (cite the Land Titles fee schedule).
- **Amortization:** 25 years by default; 30 for first-time buyers on insured purchases if the current rules allow. Verify and cite, as sources disagree.
- **Term:** 60 world months.
- **Canadian semi-annual compounding:** monthly rate i = (1 + r/2)^(1/6) − 1; payment = P·i / (1 − (1+i)^−n), rounded to the cent. Each tick: interest = round(balance·i), principal = payment − interest.
- **Accounts:** the mortgage is account kind `mortgage` (liability, may go negative). The home is not money: its value lives in `housing_homes` and is announced via `module.housing.value`.
- **Payment:** a pre-authorized debit from chequing each tick (kind `housing.mortgage_payment`, legs chequing −payment, mortgage +principal, sink +interest).
  - Insufficient funds means a missed payment: arrears plus a $45 NSF fee, a `payment` event with `onTime: false`, and a credit hit.
  - Three missed payments in a row: a teacher-visible warning. No foreclosure in the pilot.
- **Renewal:** at term end, the new rate is `rates`' current 5-year fixed and the payment is recalculated. Show the before/after payment: the "rate shock" lesson.
- **Selling:** at the current value minus 4% realtor commission (illustrative) and legal fees; the mortgage is paid out and the rest goes to chequing.
- **Home value:** a simple drift of +0.25%/month by default. The world teacher can trigger a market event of ±5–15%.
- **Panel:** rent vs buy calculator, current tenure, mortgage statement (payment split, balance, amortization chart), renewal date.

### `savings` change (2b)

The net worth panel listens to `module.housing.value` and adds home value. The mortgage is already negative in the ledger.

### `insurance`: policies and town events

**Policies** (monthly premiums are bills lines via `module.insurance.costs`; chosen and built, see docs/insurance.md):
- **tenant:** illustrative $20/month, $500 deductible, covers contents events;
- **condo unit:** in housing's costs;
- **auto:** if the student chose car in bills; the bills car line becomes the premium;
- **phone protection:** $12/month, $100 deductible.

**Town events:**
- **Triggers:**
  - The world teacher triggers one from a fixed catalogue for a class or the whole town.
  - Optionally, a random monthly draw.
  - At most 1 event per student per 3 world months, and capped dollar impact per season (PLAN §4 fairness).
- **Catalogue** (illustrative amounts, editable):
  - phone screen $250;
  - car repair $800;
  - burst pipe / contents $1,200;
  - laptop theft $900;
  - dental emergency $400;
  - windfall $200 (a tax refund).
- **How they play out:** an expense becomes a bills due line via `module.insurance.expense`. If the student holds the matching policy, insurance pays the claim minus the deductible (kind `insurance.claim`, mint → chequing, amount minus deductible, never negative), and the student sees both lines.
- **Waiting period (as built):** a bought policy (tenant, phone) pays only for an event landing after it has been in force for a whole month: `start_month < event month`. Bought in month m, it starts and is billed from m+1 and pays for events landing from m+2, so buying in the month a trigger is queued (it lands at m+1) and cancelling afterwards pays nothing. The same rule applies to teacher triggers and random events, and to the automatic cover: auto starts the month after the student switches to the car (`module.bills.choices`; switching away ends it; a car already chosen at the first billed tick is covered from that tick, its first premium month), condo the month after they are first seen owning a home in this world (`module.housing.value`; a sale ends it). Both are kept in insurance's own `insurance_players` (`auto_world`, `auto_start`, `condo_start`), so switching to the car in the month a car repair is queued pays nothing.
- **Random draws (as built):** seeded by an HMAC-SHA256 of `worldId:playerId:month:salt` keyed by a per-world random secret (16 bytes, hex) kept only in `insurance_secrets` and never returned by a route, so the code and a student's id are not enough to predict them; the same world and secret always give the same draws.

**Teacher panel:** trigger an event, see who was insured.

---

## Economy check (end of 2b)

`npm run sim -- --bots=300 --classes=10 --months=60` stays audit-OK. Report:
- median score;
- share with a card;
- median card balance;
- share paying in full;
- homeowners;
- median mortgage payment ÷ gross;
- arrears share;
- Gini.

Bots:
- 70% get a card;
- 60% of those pay in full, 30% the minimum, 10% random;
- the 20% with the most savings try to buy from month 24 and must qualify;
- 50% hold tenant insurance.

Targets:
- median score 650–760 by month 24;
- under 10% of homeowners in arrears;
- Gini under 0.40.

"Paying in full" counts every card not charged interest at the tick, including a card with no statement because its balance was already paid (until 2026-10-23 those dropped out of the denominator, so the share read about 11% instead of about 56%).

**The guard (2026-10-23):** `test/economy.test.js` runs 100 bots for 60 months with `teacher: true` (`npm run sim -- --teacher`): the world teacher raises the policy rate 100 bp at month 18 and cuts 50 bp at 40, triggers a town insurance event (24), a housing market event of -10% (30) and an exchange crash (36), and approves a few promotions (19, 31, 43), all through the real route handlers; then closes the season, creates the next world and checks that nothing carried over (holdings, orders, cards, statements, GICs, policies, homes, bills due, pending rates, any non-zero player account). It asserts audit OK every month, bills/pay 50–75% and Gini < 0.40 at months 12–60, homeowners 20–50% and owners in arrears < 10% at month 60, from the sim's own `balanceTable`. About 35 s idle, up to ~150 s inside the suite on a loaded machine; `VDAA_SKIP_ECONOMY=1` (or `true`) skips it.

## Gates

`npm test` twice, `npm run sim`, perf with all existing thresholds; a full 300-student world month with every module measured separately at < 1 s (median ~500 ms, max ~650 ms, 2026-10-22), `node --check` on every UI file.

## Decision (2026-10-22): making homeownership reachable

At the real $202,000 average Edmonton condo, no student on a catalogue entry-level wage qualifies (best job grosses ~$3,525/month; the stress test needs ~$4,300). Mr. Tang chose all of:

- **Living with parents:** a new cheapest tenure — a small monthly household contribution instead of rent (source a realistic figure; mark illustrative if none).
- **Roommates:** an explicit "2-bedroom with a roommate" tenure at half the 2-bed rent.
- **Starter condo tier:** older Edmonton 1-bedroom condos (~$140–160k, from real listings, cited) next to the $202k average.
- **Raises and promotions (jobs):** pay grows with time in a job, and each job has a promotion path with ALIS wages per step.

Target for the 60-month economy check: a meaningful share of students can buy by mid-season through saving, roommates/parents and promotions, with arrears < 10%.

**Built (housing, 2026-10-22):** `parents` tenure ($400 contribution, no deposit), roommate tenure named "2-bedroom with a roommate" (key `apt2-roommate` unchanged, half rent, half deposit), a second property `starter` ($150,000, $546 fee with heat; config `starterPriceCents`). Bots: 15% parents, 30% roommate, rest shared room; from month 24 the richest 20% buy the average condo if they qualify, else the starter (`npm run sim -- --starter=<dollars>`). Teacher market events are labelled town-wide. Sources in modules/housing/constants.js.

Implementation note (jobs, raises and promotions): built on branch `p2-raises`; design, sources and the promotion paths are in `docs/jobs.md`. 60-month sim (300 bots, default config): median gross $2,341 at month 12, $3,001 at 24, $3,919 at 36, $4,301 at 60 (the entry median is about $2,000).

## Inflation

Measured before this change (60-month sim, 300 bots): wages grew (3% a year raises plus promotions) while every price was frozen, so bills fell from 69% to 40% of net pay and 223 of 300 bots owned a home by month 60, with 0% arrears.

- **`rates` owns it.** `options.rates.inflationBp`, default **210** (2.1%): PLAN.md's base inflation, just above the Bank of Canada's 2% inflation-control target (bankofcanada.ca/core-functions/monetary-policy/inflation/, read 2026-10-22). The world teacher can set 0-10% (`POST /api/rates/inflation {inflation_bp}`); like the policy rate it is queued and applied at the next tick, so the next step uses it.
- **The index.** One world price index in basis points, 10000 at the season start. It steps once per world year, at months 13, 25, 37, ...: `index = round(index x (10000 + inflation) / 10000)` (so the second step is 10210 x 1.021 = 10424, compounding, rounded to a basis point). `module.rates.changed` carries `priceIndexBp` and `inflationBp` and is emitted on the month the index steps (as well as on a policy change and a world's first tick).
- **Consumers** read the index with `k.world.priceIndex(worldId)` (core table `price_index`, written from the event before any module listener runs; Phase 4 prep). The old per-module tables (`bills_index`, `housing_index`, `jobs_index`, `insurance_index`, …) are kept but no longer read or written. Without `rates` the index is 10000, so nothing changes.
  - **bills:** catalogue amounts x index (rounded to the cent) for bills issued from then on; a bill already issued is never repriced. Late-fee floor stays as configured.
  - **housing:** rents, the parents' contribution, condo fees, heating and home insurance x index for new months; NEW purchase prices (average and starter condo) x index, capped at the $1.5M insured limit. A home already bought keeps its own value (0.25%/month drift); property tax follows that value. The damage deposit is left at the base rent (scaling it would ask every renter for a top-up each January).
  - **jobs:** catalogue (entry) and promotion-step wages x index, for NEW hires and promotions only. A hire's wage is stored on the holding when they are hired; after that it changes only by raises (still `raiseBp`, 3%) and promotions (a promotion never lowers a wage). The Job Centre shows what a new hire would earn today.
  - **insurance:** premiums x index (condo-unit cover uses the same factor as housing's home-insurance line; the auto premium is bills' car-insurance line, so it is scaled there). Town-event amounts are not scaled.
- Teacher UI: the Bank of DAA teacher panel has an inflation field; the student panel shows the rate and how far prices have risen.

## Balance (Phase 2)

Run 2026-10-22: `npm run sim -- --bots=300 --classes=10 --months=60` (default config, audit OK every month; three runs gave the same table to within one home; Math.random bots vary only the median score and card columns). Bills = median of each bot's bills due that month, fees excluded; net pay = median net pay that month. `npm run sim` now prints this table at the end, and `--opt=module.key=value` overrides any option for a run (for example `--opt=jobs.simApprovePct=70`).

| Month | Median net pay | Median bills | Bills / pay | Homeowners | Owners in arrears | Median score | Gini |
|---|---|---|---|---|---|---|---|
| 12 | 2,013.41 | 1,385.00 | 69% | 0 (0%) | n/a | 613-664 | 0.30 |
| 24 | 2,238.50 | 1,414.09 | 63% | 0 (0%) | n/a | 652 | 0.33 |
| 36 | 2,409.28 | 1,443.73 | 60% | 98 (33%) | 0.0% | 703-708 | 0.31 |
| 48 | 2,490.13 | 1,474.06 | 59% | 112 (37%) | 0.0% | 721-730 | 0.32 |
| 60 | 2,634.72 | 1,505.08 | 57% | 117 (39%) | 0.0% | 720-740 | 0.32 |

Targets: homeowners at month 60 30-50% (**39%**); bills / net pay 50-75% at months 12, 36, 60 (**69%, 60%, 57%**); owners in arrears < 10% (**0%**); median score 650-760 by month 24 (**652**; 613-664 at month 12, the score is still building then); Gini < 0.40 (**0.32**). All met.

Tuning changes (only these; the tax code, cited prices and cited wages are untouched):

1. **Promotion auto-approve rate in the sim: 70% -> 10%** (`options.jobs.simApprovePct`, bots only; the real teacher decides in the game). With the 3-month cool-off, 70% meant every bot climbed its whole ladder within about 18 months of becoming eligible: median gross went from $2,273 (month 12) to $4,599 (month 60), +102%, against 2.1% inflation, so bills fell to 41% of pay and 76% of bots owned (a 70/40/25% sweep gave 76/68/55% owners and 41/42/47% bills-to-pay at month 60). At 10% median gross reaches $3,177 (+40%: 3% raises plus occasional promotions). A 15% rate with 2% raises and 2.5% inflation put bills at exactly 50% of pay at month 60, so 10% keeps a margin.
2. **Inflation default 2.1%** (inside the allowed 1.8-2.5%) and **raise 3%** were kept: with promotions slowed they land in range, and 2.1% is PLAN.md's number. Sweeping raise to 2% and inflation to 2.5% moved bills / pay by one point or less.
3. **Bot buying rule unchanged.** "Richest 20% try from month 24, must qualify, down payment and closing costs from their own chequing plus HISA after a $3,000 buffer" already meets the targets once incomes stop doubling: nobody qualifies before month 25 (0 owners at month 24), and the owner count then rises to 39%, inside 30-50%. Owners in arrears are 0% because a bot only buys when it qualifies and keeps a cash buffer, and the sim's pay is steady; this check says little until the teacher's market events or job loss are simulated.

Known thin margin: the median score at month 24 was 652 in the recorded run against a floor of 650 (a second run gave 673; bot behaviour is random); credit scoring is not tuned in this pass.

## Teacher note: promotions are your growth lever

In the simulation only 10% of promotion applications are approved (bots, `options.jobs.simApprovePct`). In class, promotions are approved by the teacher from the Job Centre panel. How generously you approve them sets how fast incomes grow, and so how many students can buy a home: at a 70% approval rate the sim's median gross doubled in five world years and three quarters of students owned a home; at 10%, about 39% own by month 60. Approving for a strong reflection (and not by default) keeps the economy in its balanced range.
