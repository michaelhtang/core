# Phase 1: Payday Town

Three modules under the v2 contract (`docs/modules.md`). Zero core edits except one small contract addition in 1A (the `simulate` hook). Enabled for both courses in `config/vdaa.json`, in this order: `bank-basic`, `jobs`, `bills`, `savings`, so each world month runs payday, then bills, then interest.

One world month is one pay period (12 per year). Every amount is integer cents; every rate and constant lives in one file per module with a comment giving its source and the date it was checked.

The student loop each class day: **payday** (pay stub arrives) → **bills** (pay them, or set autopay) → **save** (move money to HISA, buy a GIC) → **check net worth**.

---

## 1A. `jobs`: Job Centre and payroll

### Payroll (`modules/jobs/payroll.js`, pure functions, no I/O)

Implements the CRA's **T4127 Payroll Deductions Formulas, 122nd edition (January 1, 2026)** for Alberta, pay periods P = 12, no claim codes beyond the basic (TD1 claim code 1 federally and provincially). Fetch T4127 from canada.ca and implement its formulas and 2026 constants exactly; cite the section of T4127 next to each constant. Do not use any number not traceable to T4127 or the sources below.

Verified 2026 values (checked 2026-10-22; confirm each against T4127):

| Item | 2026 |
|---|---|
| CPP rate (employee) | 5.95% (of which 1% is the "first additional" part, deducted from income, not a credit) |
| CPP basic exemption | $3,500/yr |
| YMPE / YAMPE | $74,600 / $85,000 |
| CPP2 rate | 4% on earnings between YMPE and YAMPE |
| EI rate / max insurable | 1.63% / $68,900 (max premium $1,123.07) |
| Federal brackets | 14% to $58,523; 20.5% to $117,045; 26% to $181,440; 29% to $258,482; 33% above |
| Federal BPA | $16,452 (full amount up to $181,440 net income) |
| Alberta brackets | 8% to $61,200; 10% to $154,259; 12% to $185,111; 13% to $246,813; 14% to $370,220; 15% above |
| Alberta BPA | $22,769 |

Things to take from T4127 itself, not guess: the Canada employment amount and its credit (K4), the provincial non-refundable credit rate Alberta uses for K1P/K2P (the lowest Alberta rate is now 8%; T4127 says which rate applies to the credits), any Alberta-specific reductions, and the CPP2/first-additional treatment (F5, F5A).

API:

```js
payStub({ grossCents, period /* 1..12 */, ytd /* { gross, cpp, cpp2, ei } cents so far this calendar year */ })
  → { gross, cpp, cpp2, ei, federalTax, albertaTax, net, ytd: { gross, cpp, cpp2, ei, federalTax, albertaTax, net } }
```

CPP, CPP2 and EI stop at their annual maximums using `ytd` (as real payroll does). Tax uses the annualized T4127 method (A = P × (I − F5A)). Round to the cent the way T4127 says.

**Tests (definition of done):** 6 cases from PDOC (CRA's Payroll Deductions Online Calculator, Alberta, monthly, 2026, claim code 1): gross per month $1,500, $2,600, $4,000, $6,500, $9,000, and a December $6,500 with YTD gross $71,500 so CPP hits YMPE. If PDOC can't be driven from here, compute the expected values by hand from T4127's worked formulas in the test file's comments, show the arithmetic, and flag in the report that PDOC comparison is still to do (Mr. Tang will check one stub against PDOC himself). Each component must match to the cent.

### Jobs

- `jobs_catalogue` (module table, seeded by migration): ~12 entry-level Alberta jobs a high-school student or recent grad could hold (cashier, line cook, barista, retail associate, lifeguard, warehouse associate, daycare assistant, apprentice electrician (1st period), administrative assistant, junior bookkeeper, customer service rep, landscaper). Columns: `id, title, hourly_cents, hours_per_month, requires_note, alis_url, checked`. Wages from **ALIS (alis.alberta.ca) occupation wage data** with the page URL in `alis_url`; nothing below Alberta's $15.00/h minimum. If an ALIS page can't be read, mark the row `requires_note = 'wage illustrative'` and say so in the report. Hours: 80–160 per month.
- `jobs_holdings`: `player_id PK, job_id, since_month`. One job per student. Students pick from the catalogue (the "Job Centre" door); quitting or switching takes effect next payday. Teacher can assign or remove a job per student and set the class's catalogue on/off per job.
- `jobs_paystubs`: `id, player_id, world_id, month, job_id, gross, cpp, cpp2, ei, federal_tax, alberta_tax, net, ytd_json, txn_id`. One per student per world month with a job.

### Payday (`onTick`)

For each student with a job in classes where `jobs` is enabled: `gross = hourly × hours`; compute `payStub` with YTD from this calendar year's stubs (calendar year = world year: months 1–12, 13–24, …); post **one** ledger transaction kind `pay` with three legs: `mint −gross`, `chequing +net`, `sink +(cpp+cpp2+ei+federal+alberta)` (the employer is outside the town economy, so pay is minted; deductions go straight to the sink). Legs sum to zero; the pay stub row stores the txn id. Idempotent per (player, world, month).

### UI

- Student panel `jobs` (building `{ key: 'job', name: 'Job Centre', icon: 'job' }`): your job (or "Pick a job"), the catalogue with hourly wage, hours and monthly gross, and a **pay stub** view styled like a real Canadian stub: earnings, each deduction, net, YTD column, pay period, employer name (the job title's "employer" is a fictional DAA-town business, e.g. "Agora Coffee Co."). Student can open any past stub.
- Teacher panel: per class, who has which job, last net pay; assign/remove; catalogue toggles.

### Contract addition (core, small)

`defineModule` accepts an optional `simulate(k, { month, students: [{ id, class_id }] })`, called by `scripts/sim.mjs` once per world month **before** `world.advance`, for bots only. Jobs' simulate: every bot without a job takes a random catalogue job. Validation and docs/modules.md updated; a contract test added.

---

## 1B. `bills`: monthly costs and a budget

- `bills_catalogue` (migration-seeded, config-overridable through `config.options.bills`): the default monthly bills for a young adult renting in Edmonton: shared-room rent, utilities share, phone plan, groceries, transit (ETS monthly pass) or car (insurance + gas), internet share. Each with `amount_cents`, `required` (rent, utilities, groceries are required; phone/internet/transit choices), and a source note (rental listing averages, ETS fare page, a carrier's plan page) with URL and checked date. Where a source can't be read, mark it illustrative.
- `bills_choices`: per student, which optional plans they chose (e.g. transit vs car, phone tier). Chosen in the panel; changes apply next month.
- `bills_due`: one row per student per world month per bill: `amount, due_month, paid_txn, paid_month`. Created by `onTick`, in this order: **(1) this month's bills, (2) last month's unpaid bills are marked late (and get a fee line), (3) autopay**, so autopay can pay fee lines and a fee is never taken ahead of it. Bills for a student start **the month after their first pay** (config `options.bills.startAfter: "pay"`, set in `config/vdaa.json`), or the month after their first login (`"login"`, the code default, for a world without jobs), so nobody is late before they could have been paid.
- Paying: student pays individually or "Pay all"; **autopay** toggle pays everything due right after the late marks if the balance covers it (in bill order: oldest first, rent first). Payment = ledger txn kind `payment`: `chequing −amount` (or the card), `payable +amount` (the sink was paid when the bill was issued; see Bills owed). `/pay` only accepts a bill of the current world (404 otherwise).
- Late: at the next `onTick`, any bill still unpaid is marked late and adds a **new due line** "Late fee: <bill>" (category `fees`, `max($25, 5% of the bill)`, configurable) to this month's `bills_due`. Nothing is taken from chequing: the fee line is paid like any bill (manually, Pay all, autopay) and never overdraws, so an uncollected fee is not lost. A fee line can itself go late (history row) but never earns a fee of its own, so at most one fee per original bill. **Record** each late payment in `bills_history` (player, month, bill, days_late equivalent = months) — Phase 2's credit score reads this. Never let a payment overdraw (ledger refuses; the UI says why).
- **Bills owed** (added after the 2026-10-22 review, A1): a bill is a debt from the tick it is issued (accounts payable). At each tick, after the new bills and the late marks and fee lines, every row not yet owed is posted to the student's ledger account `payable` (`allow_negative`, opened on first use) as one txn per student: `bills.owed`, `payable −total`, `sink +total`, `meta.dueIds`, the memo lists the bills; `bills_due.owed_month` records it, so each row is owed once. Every payment (by hand, Pay all, autopay, card or the chequing fallback) is `chequing`/card `→ payable`, so the sink receives each bill exactly once, at issue. Net worth (savings, leaderboards, season results) sums every player account, so a student who never pays is behind one who pays by exactly the late fees, from the first month. Season close resets `payable` like any account. Overdue is not an account: it is the sum of the late, unpaid rows. The Bills tab shows "Bills owed: $X (overdue: $Y)"; the Net Worth panel lists "Bills owed". `/api/bills/state` has `owed_cents` and `overdue_cents`; `/api/savings/status` has `bills_owed_cents` (negative, from the ledger). Unpaid rows from before migration 008 are posted at the next tick (paid before that, they go to the sink as they used to).
- **Multi-month advances** (A5): a line is judged late only if it was due by the month the advance started (`onTick`'s `startMonth`). Lines issued during a 2+ month advance are judged at the next advance, so students always get a live month to pay. `module.bills.paid`'s `onTime` is `!late` (the line was never marked late), not `paid month <= due month`: a bill due during a 2-month advance and paid by hand in the next live month is on time, like autopay at the tick. The event also carries `dueMonth`, so credit and outfitters book the payment on the month the bill belongs to (a hand-payer and an autopayer with the same on-time behaviour get the same leaderboards count, credit marks and outfitters streak; `test/bills.test.js` "multi-month advances: a hand-payer ...").
- **Budget** tab in the bills panel: this month's net pay, each bill, what is left. Net pay arrives as the event `module.jobs.paid` (`{ playerId, worldId, month, net, gross }`), which jobs emits inside the payday transaction right after posting each pay; bills stores it in `bills_pay` (so it rolls back with the payday) and needs neither jobs' tables, nor its load order. With jobs not loaded, the Budget says "No pay yet". A simple "50/30/20" bar compares needs/wants/savings. Needs and wants come from each bill's `category` (phone, transit, car, groceries, rent, utilities = needs; internet = want), not from `required`: it teaches that a phone plan is a need but a 50 GB upgrade is a choice you can price. Late-fee lines count against "left", not against needs or wants.
- Teacher panel: per class, who's paid, who's late, who's on autopay.
- `simulate`: bots turn autopay on 80% of the time; the rest pay manually with a 70% chance each month.

---

## 1C. `savings`: HISA and GICs

- On a student's first visit (or `onPlayer`), open accounts kind `hisa` (no negative). Transfers chequing ↔ HISA, any amount, instant (kind `move`).
- **Interest:** monthly on HISA: `floor(balance × annual_rate / 12)` from mint (kind `interest`), posted in `onTick`. `annual_rate` is the **policy rate** (`config.options.savings.hisaRate`, default 2.75% with source note) — the teacher can change it from the panel (it becomes the "central bank" lever in Phase 2).
- **GICs:** terms 12, 36, 60 world months at fixed rates (defaults 3.70%, 3.80%, 3.90% with source notes from Ratehub, checked date), minimum $100, non-redeemable. Each GIC is its own account kind `gic` with `savings_gics(account_id PK, player_id, principal, rate_bp, start_month, term_months, matured_month)`. Interest compounds annually and is paid at maturity into chequing (kind `gic_maturity`: mint pays the interest, the GIC account's principal moves back). Buying: kind `gic_buy` chequing → gic account.
- **Net worth** panel (building `{ key: 'networth', name: 'Net Worth', icon: <inline svg> }`): chequing + HISA + GICs (− debts later), a 12-month line from month-end snapshots (`savings_snapshots(player_id, month, net_worth)` written in `onTick`), and the Rule of 72 for the HISA rate.
- Teacher panel: class total savings, average savings rate (saved ÷ net pay), the HISA rate control.
- `simulate`: bots move 10–30% of what's left after bills to HISA; 20% buy a 12-month GIC when HISA > $1,000.

---

## 1D. Bank screen: transaction history (`bank-basic`)

The Bank screen reads like a bank app (added 2026-11-19 at Mr. Tang's request). Top: a tab per bank account the student has (Chequing, Savings (HISA)), then an account card with the balance, money in and money out this world month (and last month), and the last direct deposit. Then the send-to-a-classmate form (only when the teacher has it on), then every transaction this season, newest first, grouped by world month with a subtotal per month, each row with a category icon, a title, the amount and the running balance, and filter chips (All, Money in, Money out, and each category present: Pay, Bills and rent, Shopping, Loans and credit, Savings and investing, Transfers, Rewards, Other). Pay shows as "Direct deposit: pay from your job", bills as "Bill payment: <bill>".

`GET /api/bank-basic/history?account=chequing|hisa&before=<entry id>` (student, own accounts only, 100 rows a page). **Read-only**: it reads `entries` and `txns` and never posts. Code: `modules/bank-basic/history.js` (categories in `describe()`), UI `modules/bank-basic/ui/bank.js` and `bank.css`, tests `test/bank-history.test.js`. A row's world month is the later of the txn's `meta.month` and the month in force when it was posted (from the `world.advance` audit records), because a month's tick posts just before its advance record and a bill paid late names its due month. The few tick txns with no `meta.month` (GIC maturity, damage deposit refund) can show one month early.

## Economy check (after all three merge)

`npm run sim -- --bots=300 --classes=10 --months=24` must stay audit-OK and report per month: median net pay, median bills, median savings, share of bots with any late bill, Gini of net worth. Target ranges for the default config (adjust catalogue/bills, not the tax code, to land in them): median bills 60–85% of median net pay; < 20% of bots ever late after month 3; Gini < 0.35 at month 24. Record the run in `docs/phase1.md` under "Balance".

## Balance

Run 2026-10-22: `npm run sim -- --bots=300 --classes=10 --months=24` (default config, audit OK every month; each row is the world month shown, money in dollars, medians over bots). The sim prints these columns every month.

| Month | Median net pay | Median bills | Bills / pay | Median savings (HISA + GIC) | Late now | Ever late (after month 3) | Gini of net worth |
|---|---|---|---|---|---|---|---|
| 1 | not paid yet | not billed yet | | 0.00 | 0.0% | 0.0% | 0.000 |
| 3 | 2,013.41 | 1,385.00 | 69% | 595.09 | 0.0% | 0.0% | 0.165 |
| 6 | 2,013.41 | 1,385.00 | 69% | 2,232.80 | 5.7% | 12.3% | 0.231 |
| 12 | 2,013.41 | 1,385.00 | 69% | 5,841.44 | 5.0% | 16.3% | 0.273 |
| 24 | 2,013.41 | 1,385.00 | 69% | 11,483.17 | 9.3% | 17.3% | 0.302 |

Targets for the default config:

- **Median bills 60-85% of median net pay: 69%. In range.** No tuning of the catalogue or the jobs hours was needed (the cheapest job, a cashier, nets $1,657 against $1,385 of default bills, so even the lowest-paid bot stays in the black).
- **Gini < 0.35 at month 24: 0.30. In range.**
- **Under 20% of bots ever late after month 3: 5-9% are late in any given month, and 17-23% have been late at least once by month 24 (it varies by run because each bot picks autopay at random).** The cumulative number is the share of bots that are manual payers (about 20%): every late bot in the run is a manual payer who skipped a month on purpose (the bots' 30% chance of not paying). Not one autopay bot is ever late, so no bot is late because it cannot afford its bills. Read as "share of bots late in a month" the target is met by a wide margin; read as "ever late" it sits on the line by construction of the bots, not by the economy.

Bot behaviour was reviewed: every bot takes a job in month 1 (before the first tick), is first paid in month 2, and (rule below) is first billed in month 3. Manual bots pay what they can with a 70% chance each month; fee lines are paid with the bills.

**When bills start.** A student's first bill lands the month AFTER their first pay (`options.bills.startAfter: "pay"`, set in `config/vdaa.json`). In a world without jobs it is the month after their first login (`"login"`, the code default). Students who take a job late are not billed for the months before they could have been paid; the Budget tab shows their first pay as soon as it lands.

## Gates for every module

`npm test` twice, `npm run sim`, `node scripts/perf.mjs sentSince=5 feed=5 stmt50=2 stmt500=10 dupReverse=1 console=10`, `node --check` on all UI files. Payday for 300 students must take < 500 ms (add `payday` to perf.mjs in 1A).
