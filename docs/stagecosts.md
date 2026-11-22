# Stage costs

*Branch `p12-stagecosts`, 2026-10-30, cut from main @ 013fd70.*

## Why

Measured before this change: a student who takes one job and does nothing else (autopay on, cash left in chequing, a shared room) reaches age 55 with about $1.04M in chequing (11x a year of net pay) and, at 65, a retirement check that says Covered for 3 in 4 such students. Two causes: wages grow faster than prices (a 3% raise every 12 months against 2.1% inflation, plus promotions), while the bills catalogue only follows prices, so bills / net pay falls from 57% at month 60 to about 35% by month 400; and nothing in the bills changed with age. The 5c analysis (docs/phase5-life.md, "As built (5c)") named the lever: Stage B and C cost lines in the bills catalogue, not the pension figures. This builds that lever.

## As built

**Catalogue** (`modules/bills/catalogue.js`, one table with every other bill). Each stage row has `from_age` / `to_age` (the world's age, from `life.age`) and `tenure` ('own', 'rent' or '' = everyone). Amounts are season-start dollars, billed x the world price index like every line. Every amount is ILLUSTRATIVE: a round monthly figure for one adult's share, in the range Statistics Canada's Survey of Household Spending (table 11-10-0222-01) gives for that kind of spending; no row quotes a StatCan number.

| Id | Line | Ages | Who / tier | 50/30/20 | A month (season-start $) |
|---|---|---|---|---|---|
| `household-modest` | Household growth (modest) | 36-54 | optional, **default** | needs | $450 |
| `household-full` | Household growth (family with children) | 36-54 | optional | needs | $1,100 |
| `vehicle-used` | Vehicle replacement and upkeep (used car) | 36-54 | optional, **default** | needs | $250 |
| `vehicle-new` | Vehicle replacement and upkeep (new car) | 36-54 | optional | wants | $600 |
| `home-upkeep` | Home upkeep and repairs (owner) | 36-70 | required, owners | needs | $150 |
| `renter-extras` | Household furnishings and supplies (renter) | 36-70 | required, renters | needs | $75 |
| `health-55` | Health and care (dental, vision, prescriptions) | 55-59 | required, everyone | needs | $150 |
| `health-60` | Health and care (dental, vision, prescriptions) | 60-64 | required, everyone | needs | $210 |
| `health-65` | Health and care (dental, vision, prescriptions) | 65-70 | required, everyone | needs | $280 |
| `travel-modest` | Travel and leisure (some) | 55-70 | optional, **default** | wants | $200 |
| `travel-full` | Travel and leisure (often) | 55-70 | optional | wants | $600 |

A student who changes nothing pays, on top of the Stage A bills ($1,385 a month at season-start prices for a renter on the defaults): **+$775 a month from 36 to 54** (household $450, used car $250, renter extras $75; an owner $850) and **+$425 at 55-59, +$485 at 60-64, +$555 from 65** (health, travel, renter extras). At the price index those are, for example, $1,037 at 36 (index 1.34) and $1,357 at 65 (index 2.44).

- **Defaults.** An optional slot's default is its first option (the existing bills rule), so a student who never opens Plans pays the modest tier from the month the slot starts. Nothing is written at the boundary: the default is derived every month, exactly as Stage A's phone or transport defaults. "None" is always offered for an optional slot. Required rows (home upkeep or renter extras, health and care) cannot be turned off.
- **Stage boundaries.** Rows bill only while `from_age <= age <= to_age`. Without the `life` module the age is unknown and only the Stage A rows bill, as before. Months 1-168 (ages 22-35) bill exactly what they billed before (tested at 168 vs 169).
- **Age steps** are separate rows of the same slot with consecutive ages (health and care at 55, 60, 65).
- **Owner or renter.** An owner is a student whose housing lines this month include the primary home's property tax; they pay home upkeep, everyone else renter extras.
- **The bill path is the existing one:** issued in bills' tick, owed through the `payable` account (one `bills.owed` txn per student per tick), paid by autopay or by hand, late fee lines, `module.bills.late` (stress, credit, leaderboards), history. No new ledger kinds. Net worth counts an unpaid stage line through `payable`, like any bill.
- **Plans tab** shows a stage slot only from its first age (the `/choice` route refuses it before, 400), with the student's tenure's price list.
- **Notes.** The feed's town item at a stage change now says "New life costs start on this month's bills: see Life, and change them in Bills, Plans" (Stage B and C, when bills is loaded). The Life panel has a card "Costs that come with age": the lines on the student's bills now (with Default / Your choice / Always billed) and the ones coming later, at today's prices. The teacher's Life panel has the whole stage cost table (read-only).
- **Retirement.** The live check's bills are `bills.monthBills` (every non-fee line of the latest month billed), so the stage lines count as they are billed. The "lasts until age N" projection now takes `steps` from the new read-only `bills.stageCosts({ playerId, baseAge })`: the student's stage lines (their choices, their tenure) at each later age where a line starts, stops or steps, at today's prices; a later month's bills = today's bills - today's step + that age's step (then inflated as before). `baseAge` is the age of the month billed (retirement ticks before bills), so a step boundary is not counted twice.
- **Performance.** Bills' tick reads the age once per tick and filters the catalogue twice (renter, owner); per student it is the same O(1) work as before. The catalogue rows are cached per database (they change only at boot). `stageCosts` (one bills_choices query and one owner query per call) runs once per student in retirement's Stage C tick.

**Data:** migration `bills 012_stage_ages`: `bills_catalogue.from_age` (default 0), `to_age` (default 99), `tenure` (default ''): the Stage A rows keep every age and tenure.

**Teacher overrides:** `config.options.bills.amounts = { "<id>": cents }` works for the stage rows too (a whole number above 0; anything else is ignored). To remove a line, delete its row from the catalogue and restart: it is retired (`active = 0`) and no longer billed; bills already issued keep their amount.

## Measuring a whole life

`scripts/lifecycle.mjs`: one world lived month by month from 1 to 577 (age 22 to 70) with every module ticking and 40 scripted bots per profile (200 bots, about 9-10 minutes on this machine). The bots act only through the real route handlers, plus jobs' own bot (a job, promotions) until 65. Every profile keeps the default retirement age 65 and CPP/OAS at 65.

| Profile | What it does |
|---|---|
| idle | one job, autopay, nothing else: cash in chequing, a shared room, no draw plan (a never-saved renter) |
| spender | idle, but picks the dearest option in every Plans slot (also a never-saved renter, with a bigger lifestyle) |
| modest | idle + 5% of net pay into the TFSA index fund (RRSP when the TFSA is full); a draw plan at retirement |
| diligent | 15% of net pay into the RRSP while there is room, then the TFSA, then non-registered, all in the index fund; a draw plan at retirement |
| mortgage | diligent, but first saves for a condo (20% down, 25 years, bought around age 28-30) and invests 15% after |

The savers' retirement: at 65 and each world year after, a RRIF and a draw plan of (bills - net pensions) x 1.1, RRSP first (retirement's own bot rule, without its random CPP age). "Annual net pay" = 12 x the last month's net pay before the checkpoint. "Covered" = no shortfall in the month's live check (`retirement_status`). 65 is measured at month 521, after the plans set at 517 have run.

**Market seed.** The exchange seeds each world's prices with a random secret, so two runs see different markets (one unpinned "after" run had the diligent profile 83% covered at 65 where another had 100%). The script pins it (`--seed`, default `lifecycle-1`); every number below is from seed-pinned runs, before (main @ 013fd70 with this script) and after, at seed 1 (DAAX ends at $2,805) and seed 2 (a weaker market, DAAX ends at $922). Idle and spender hold no securities, so their numbers do not depend on the seed. Price index: 1.34 at 36, 1.99 at 55, 2.44 at 65, 2.71 at 70.

### Before and after (40 bots per profile; "seed 1; seed 2")

| Profile | Age | Net worth / annual net pay | Coverage % (median) | Covered | Coverage < 90%, after |
|---|---|---|---|---|---|
| idle | 55 | 11.2x -> **8.0x** (p25 6.2x) | 97.5 -> 62.5 | 43% -> 0% | 100% |
| idle | 65 | 15.5x -> 11.8x | 100 -> **73.5** | 73% -> **0%** | **100%** |
| idle | 70 | 15.5x -> 11.1x | 100 -> **74** | 73% -> **0%** | **100%** |
| spender | 55 | 10.0x -> 3.1x (p25 0.9x) | 84 -> 40 | 0% -> 0% | 100% |
| spender | 65 | 14.0x -> 6.0x | 88 -> 55 | 0% -> 0% | 100% |
| spender | 70 | 13.7x -> 4.5x | 89 -> 56 | 0% -> 0% | 100% |
| modest | 55 | 14.0x -> 10.6x; 11.6x -> 8.3x | 98 -> 63 | 40% -> 0% | 100% |
| modest | 65 | 19.6x -> 15.6x; 17.6x -> 13.8x | 100 -> 100 | 100% -> 90%; 100% -> 60% | 5%; 10% |
| modest | 70 | 19.2x -> 14.5x; 17.4x -> 12.8x | 100 -> 100; 100 -> 96 | 100% -> 88%; 100% -> 40% | 8%; 25% |
| diligent | 55 | 19.6x -> 16.6x; 13.2x -> 10.1x | 98.5 -> 63 | 45% -> 0% | 100% |
| diligent | 65 | 29.4x -> 25.8x; 24.0x -> 20.3x | 100 -> 100 | 100% -> **100%; 95%** | 0%; 0% |
| diligent | 70 | 27.8x -> 23.5x; 22.8x -> 18.4x | 100 -> 100 | 100% -> 100%; 95% | 0%; 5% |
| mortgage | 55 | 18.6x -> 15.2x; 13.7x -> 10.1x | 99.5 -> 61.5 | 50% -> 0% | 100% |
| mortgage | 65 | 28.3x -> 23.8x; 24.5x -> 19.9x | 100 -> 100 | 93% -> **83%; 83%** | 13%; 18% |
| mortgage | 70 | 27.6x -> 22.2x; 24.0x -> 18.4x | 100 -> 100 | 93% -> 83%; 78% | 15%; 18% |

Notes: the check at 55 (month 397) still holds month 396's bills (the Stage B lines; retirement ticks before bills), and before retirement it counts the pensions "as if retired today" with no draw plan yet, so nobody is covered at 55: that row says "you are not ready yet", for everyone. Annual net pay is about $52,000 at 36, $91,600 at 55 and $106,000-108,000 in the last working year (bots are promoted). 37 of 40 mortgage bots bought (around age 28-30); every mortgage is paid off by 65; the 3 who never bought never invested (the profile invests only once it owns), which is about half of the mortgage profile's short share (5-7 bots); the rest were not examined one by one (a likely cause: the bot plan, the gap x 1.1, is drawn from the RRSP first and the withholding on it can leave a small shortfall, as test/stagecosts.test.js found with x1.1).

**Bills / net pay, median** (lifecycle, idle / diligent / mortgage): before m168 42/41/57%, m180 42/41/57%, m240 39/38/52%, m300 37/36/49%, m380 39/37/42%, m420 35/34/35%, m516 34/33/33%. After: m168 42/41/57% (unchanged), m180 **65/64/82%**, m240 61/60/75%, m300 58/56/71%, m380 61/58/65%, m420 46/45/48%, m516 46/45/46%. The spender: 99% at m180, 87% at m300.

**Retirement bills / income** (the live check's income: pensions + draws - tax), idle / spender / modest / diligent / mortgage, at 66 (m529): before 95/111/95/44/49% (seed 1), after 133/175/96/62/71% (seed 1), 133/175/98/74/82% (seed 2); at 69 (m565) after: 134/177/96/60/69% and 134/177/107/85/94%.

**Late lines** (non-fee lines marked late, share of the last 120 months): before 0% at every checkpoint; after 5% at 55, 65 and 70, all of them the spender's (the dearest tier of everything is more than a bot's pay in Stage B: that is the profile's point; its p25 net worth at 55 is under one year's pay).

### The whole sim (300 default bots, every module's bots)

`npm run sim -- --months=240` (Stage A plus 72 months of Stage B), before / after (the bots' rule below included), median: bills / pay 53% / 53% at 168, **54% / 77% at 169**, 53% / 74% at 180, 52% / 67% at 200, 51% / 67% at 220, 47% / 62% at 240; students with a late bill unpaid now 5.7-8.3% / 6.0-10.0%; median credit score 780 / 780 at 241, paying cards in full 60.1% / 58.7%, Gini 0.238 / 0.292 at 241, homeowners 59% / 59%, owners in arrears 0% / 0%, audit OK every month, errand cash 0.031% of pay in both.

**A bot rule (bills' `simulate`, bots only):** from 36, a bot with a late bill it has not paid sets every optional stage slot to None, as a student who cannot keep up would. Without it (an earlier run of the same amounts) the sim's late-now share rose to 16-21% from month 200 (sim bots never change a plan, and 59% of them carry a mortgage plus owner lines by then).

### Guards (before -> after)

- `npm run sim -- --months=60`: bills/pay 57.1% -> 57.1% at 60 (57.7% / 57.7% at 61), homeowners 94 (31.3%) -> 95 (31.7%) at 61, Gini 0.335 -> 0.328 at 60, errand cash 0.039% -> 0.040%, audit OK in all 61 rows both.
- `--teacher`: bills/pay 57.1% -> 57.1%, homeowners 30.3% -> 30.3% at 60, Gini 0.315 -> 0.304, errand cash 0.040% -> 0.039%, season close + new world starts clean, audit OK, both.
- `node scripts/perf.mjs payday=500 month300=1000 retire517=1500 stagec=1000` (median ms): payday 376 -> 378, month300 610 -> 556, retire517 1,082 -> 1,194, stagec 722 -> 829 (exit 0). The Stage C months grew by the stage lines' payments for 300 students and one `stageCosts` call per retiree.
- The 60-month economy guard (`test/economy.test.js`) is unchanged: nothing bills before month 169.
- A 576-month full sim was started and stopped at month 306 after 40 minutes (about 18 s a month by then with other runs alongside; the rest would have taken well over the hour budget). Through month 306: audit OK in every row; bills/pay 53% at 168, 85% at 169, 75% at 240, 69% at 300 (round 1 amounts, before the bot rule; superseded by the 240-month run above).

### Targets

| Target | Result |
|---|---|
| (1) Stage A unchanged | Met: sim 60 and teacher within noise; lifecycle bills / pay identical through month 168; a test checks month 168 vs 169. |
| (2) Idle: net worth 2-5x annual net pay at 55; short at 65 for >= 70% and not covered again by 70 | **Net worth not met: 8.0x** (11.2x before; p25 6.2x). Short: met, 100% under 90% at 65 and 70 (median coverage 73.5% and 74%, 0% covered at both). |
| (3) Diligent covered at 65 for >= 80%; mortgage-holder too | Met: diligent 100% / 95% (seed 1 / 2); mortgage 83% / 83%. |
| (4) Never-saved renter short at 65 and 70; a modest saver in between | Idle and spender: short at both. Modest (5% from age 22): 90% covered (strong market) or 60% (weak market) at 65, median coverage 100%; "in between" only in the weaker market. |
| (5) Bills / pay 55-70% in B, 70-90% of income in early retirement for idle | Lifecycle B: 58-65% (idle), 56-64% (diligent), 65-82% (mortgage). Whole sim B: 62-77%, above 70% in the first 4-5 years of B. Retirement: idle 133% (it must be over 111% for target 2, so (2) and (5) cannot both hold for idle); diligent 60-85%. |
| (6) Money correctness | Met: the existing bill path, audits OK at every checkpoint and every sim row, no negative account, nothing new in net worth. |
| (7) Performance | Met (above). |

**The trade-off.** Stage A is frozen, and it already leaves the idle student with 5.1x a year's pay at 36 (a $258,000 floor against $91,600 of pay at 55, i.e. 2.8x before Stage B adds anything). Holding 5x at 55 would need Stage B bills / pay around 80-85% for the idle profile, and the whole sim would then sit near 90% in early Stage B with late bills climbing (round 1 of tuning: +$1,050 a month in Stage B gave the idle profile 6.9x but the sim 85% at 169 and 32-34% of bots late by month 240). Round 2 (+$775) keeps the sim within reach of the band and the late share where it was; the net worth target is the one given up. If it matters more than the Stage B band, the levers are household-modest and vehicle-used (each +$100 a month moves the idle profile's 55 multiple by about -0.4x and the sim's early Stage B bills / pay by about +3 points).
