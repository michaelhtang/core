# Engagement review: vDAA as "an adult life in one semester"

*Design review, 2026-10-29, main @ 10c8138. Nothing in this document is built. Written for Mr. Tang; the goal it measures against is his: "simulate an adult life in one semester and go through all phases as in my Life Cycle Wealth Architect project. Through careers and getting different jobs they earn income and use the money to pay bills and invest. Daily missions or errands to earn rewards, and an energy mechanism to explore the world to unlock different parts of the game."*

Sources: a read-only scan of the student experience (every claim carries a `file:line`; items marked *derived* are arithmetic from the code, *unconfirmed* were not checked; the eight load-bearing claims in §1 and §3 were re-checked by an independent verifier and confirmed), the Life Cycle Wealth Architect brief as it appears in the FinTech 20/30 lesson docs (Lessons 20, 22, 23, 29–31), PLAN.md §5–6, and a browse of the local demo world as a student.

---

## 1. How it works today

### The town

Eleven doors on the home screen, identical for FinTech 10 and FinTech 20/30 (`config/vdaa.json:3-4`, order from `lib/modules.js:285`):

| Door | Module | What a student does there |
|---|---|---|
| Bank | bank-basic | Chequing statement; send money to a classmate (off by default, `bank-basic/index.js:9`) |
| Bank of DAA | rates | Read-only: policy rate, derived rates, inflation, next announcement |
| Job Centre | jobs | Pick one of 12 jobs; pay stub with T4127 deductions; apply for promotion after 12 months, teacher approves |
| Housing | housing | Change tenure (parents / shared / 1-bed / 2-bed / roommate); buy a condo with a real stress test; sell |
| Insurance | insurance | Tenant and phone cover; teacher-triggered events; claims |
| Credit Bureau | credit | Apply for the starter card; pay; autopay; payoff calculator |
| Bills | bills | Pay / Pay all / autopay; budget vs 50/30/20; plan choices; history |
| Outfitters | outfitters | Cosmetic items with GST and "grows to" line; achievement items; class-goal outfits |
| Exchange | exchange | 3 funds, 8 town stocks; market and limit orders; TFSA and RRSP |
| Net Worth | savings | HISA, GICs, net-worth line, Rule of 72 |
| Amphitheatre | leaderboards | Net worth and health boards, class table, Hall of Fame, Life Review |

### The clock

Everything is tick-driven. One tick = one world month. Default `months_per_day` is 1 (`migrations/001_core.sql:9`), the teacher can set 1–12, and auto-advance fires at 07:00 on school days (`lib/world.js:84-111`). The default season is 150 calendar days (`lib/world.js:34`), about 100 class days, so a default season is **roughly 8 world years**. Wall-clock time matters only for sessions, the transfer cap and rate limit, and the day/night art.

### One world month, in tick order

Payday mints net pay → mortgage debit → insurance premiums and events → card statement and autopay → bills issued, late marks, bills autopay → outfitters streak → exchange prices, fills, dividends → GIC maturity and HISA interest → boards and Wolf rank (`lib/modules.js` order, config order). Mortgage and card are paid before bills; HISA interest lands after bills autopay, so it can never fund the same month's bills.

### Required, recommended, optional

- **Required actions in the whole game: one.** Pick a job. Without a job there is no pay, and bills only start the month after the first pay (`bills/index.js:300`, because `config/vdaa.json:14` sets `startAfter: "pay"`; the code default would start them at login), so a jobless student sits at $500 with no consequence.
- **Autopay is off by default** (`bills/index.js:238`). Until it's on, "Pay all" is the monthly chore; skip it and each unpaid bill earns a fee of max($25, 5%) and a late mark that feeds the credit score and the health board (`bills/index.js:141-150`, `catalogue.js:47`). Nothing is repossessed; there is no eviction, service cut or job loss.
- **Once autopay is on and a job is picked: zero required actions per month.** The one recommended action is "what do I do with the ~$600 surplus" (median bot). Optional: trades (≤10/month), card payment, shopping. Rare: promotion application (once per 12 months), card application, move, condo, insurance.

### What a student sees after a tick

The balance number, the "World month N" chip and the badge chips (DAAX price, newest headline, `Wolf: tier`, `Ranked up!`) redraw (`public/student.js:31-39`). There is **no "what happened this month" summary**, no toast, no activity feed, no badge on a door. Each panel shows its own delta only when opened. On phones (<720 px) the wolf mascot is hidden (`theme.css:176`).

### Time to consequence (world months)

| Choice | Payoff / cost shows |
|---|---|
| Autopay, job | 1 tick |
| Raise | 13th pay (+3%) |
| Promotion | 12 months in step + teacher approval |
| Credit score | opens at card approval ≈708, ≈771 after three on-time months (*derived*) |
| Condo | needs 3 months of gross history; starter condo needs gross ≈$3,350/month (*derived*; only 3 of 12 entry jobs clear it) |
| Scout rank ($5k) | ≈17 months for a cashier saving $272/month (*derived*) |
| GIC | 12 / 36 / 60 months, non-redeemable |
| RRSP refund | earliest month 25 |

### Where the surprise comes from

Only two sources are unpredictable to a student: Exchange prices (seeded, same for everyone) and teacher actions (rate changes, events, crashes). Insurance random events are off by default (`insurance/index.js:114`). Everything else is deterministic from the student's own history.

---

## 2. Strengths

These are real and worth protecting.

1. **The money is honest.** Double-entry ledger, integer cents, T4127 pay stubs, CMHC and stress-test rules, TFSA/RRSP room, GST on purchases. The sim audits balance every month for 60 months. Students can't be lied to by the game, and that's the whole point of a FinTech course.
2. **Consequences are proportionate and recoverable.** Late fees, interest, NSF, arrears, late marks: all real, none fatal. A student can dig out. "Best Comeback" is an award.
3. **Teacher control without teacher labour.** Auto-advance on school days, one-click events, per-class settings, teacher-B isolation. A colleague can run a class with PIN cards and nothing else.
4. **The "grows to" habit.** Outfitters prices show what the money would become invested at 6.3% for 5 years. That's opportunity cost taught at the point of purchase.
5. **Health, not just wealth.** The Amphitheatre's Health score (cushion, on-time, credit, debt load) and the Healthiest Wolf award reward behaviour, not luck.
6. **Short sessions by design.** Nothing demands more than a few minutes. No chat, no notifications, no pull.
7. **The module contract.** Everything below is addable as a module with named migrations and hooks, zero core edits, and bots in `simulate` so it can be balance-tested over 60 months before a student sees it.

---

## 3. Gaps, measured against the Life Cycle Wealth Architect

The project's structure, as the lessons describe it:

- **Phase 1, Budget:** a career from the brief's list of 12 (trades, diplomas, degrees, chosen so debt and starting salary vary), ALIS salary, PDOC net pay, monthly expenses at Edmonton prices, a student-loan payment if the career needs school, an emergency fund of 3–6 months.
- **Phase 2, Research:** an investment library of seven asset classes with sourced, realistic 2026 returns; Rule of 72.
- **Phase 3, Simulation (Growth Tracker):** three life stages, **A 22–35, B 36–55, C 55–70**; an asset allocation per stage; a crash row (a 15% fall in year 5); a Stage C income check against bills grown by inflation over 33 years.
- **Dashboard:** allocation pies at age 25 and age 65. **FinTech 30 layer:** registered accounts.

| Life Cycle piece | vDAA today | Gap |
|---|---|---|
| Career → salary → net pay | 12 hourly jobs ($15–24/h), raises, 1–3 promotion steps, real deductions | **No education tier, no student debt.** Every career starts at entry wage. The brief's point, that a diploma or degree trades debt now for salary later, isn't in the game. |
| Edmonton bills | Default $1,385/month, price-indexed, plan choices | Covered. |
| Emergency fund | Achievement item at HISA ≥ 3× bills (`outfitters/constants.js:107`) | Covered; invisible on the home screen. |
| Investment library, realistic returns | HISA, 3 GIC terms, 3 funds, 8 stocks, Rule of 72 on Net Worth | Partial. No bonds held directly, no real-estate asset other than the condo. GIC rates are fixed and don't follow the policy rate (`savings/constants.js:9-11`). |
| **Life stages A / B / C** | **None.** No age, no stage, no retirement. | **The largest gap.** The world has years but no life. Nothing changes because a student is "45". |
| Allocation by stage | Student picks any mix at any time | No prompt or view of "what mix fits my stage". |
| Crash row | Teacher crash event exists (`exchange/constants.js:74-80`) | Covered as a lever; not scheduled, not framed as a life event. |
| Stage C income check vs inflated bills | Inflation steps exist (months 13, 25…); bills are indexed | **Nothing asks the question.** There is no decumulation, pension, CPP/OAS or "can my savings pay my bills at 65". |
| Dashboard at 25 and 65 | 12-month net-worth line | No life-span view. |
| Registered accounts | TFSA and RRSP with real room rules, year-end settlement | Covered (FT30 layer). |

### Gaps against the engagement goal

1. **Nothing happens between ticks, and nothing invites a return.** No errands, no "today" surface. The only streak is Outfitters' six-month on-time counter (`outfitters/constants.js:107`), which a student sees only as an unlock. The scan's summary: the median student takes one to three actions, spends two or three minutes, and often none.
2. **The home screen tells no story.** One balance, eleven doors. A student can't see at a glance what changed, what's due, or what to do next.
3. **The map doesn't grow.** PLAN.md:29 planned districts that unlock by unit; on main all eleven doors are open from minute one. Nothing is earned.
4. **One path, same for everyone.** FT10 and FT20/30 see the identical town. The only divergence is what a student chooses to do with surplus.
5. **Peers are a leaderboard.** Boards and capped transfers are the whole social layer (Ventures on branches adds teams). Board rows show login usernames, which are also the transfer addresses (`leaderboards/index.js:84,92`): mild, but worth a display-name field eventually.
6. **The jobless path is a hole.** The one student who never picks a job never meets the game.

---

## 4. Design direction

Four systems, each a module under the v2 contract. They are ordered so that each one is useful alone.

### 4.1 Life stages (the spine)

Give every student an **age**. Age 22 at season start; the stage is a pure function of age.

| Stage | Ages | What changes |
|---|---|---|
| A · Starting out | 22–35 | Today's game: entry jobs, rent, first card, first condo, TFSA. |
| B · Building | 36–55 | Raises compound; promotions open the second and third steps; a second housing tier (family home); RRSP matters; a mid-life event or two (teacher levers already exist: crash, rate hike, housing shock). |
| C · Winding down | 55–70 | Pay stops at the retirement age the student chooses (60–70). Income becomes CPP + OAS (real 2026 figures, ILLUSTRATIVE if a page can't be cited) + withdrawals the student sets from TFSA/RRSP(RRIF)/HISA. **The Stage C check runs live every month: do bills (inflation-grown) still fit?** |
| Life Review | 70 | Existing season-close Life Review, extended: net worth at 35 / 55 / 70, years of retirement funded, allocation pies at 25 and 65. |

This is Phase 3 of the Wealth Architect, played instead of spreadsheeted. The brief's Growth Tracker becomes the thing they live through; the spreadsheet becomes the plan they check against it.

**The clock is the hard decision.** 22→70 is 48 years = 576 world months. The default season is ~100 ticks. Three ways to fit it, each with a cost:

| Option | How | Cost |
|---|---|---|
| **a. Faster months** | `months_per_day` 6 (already a teacher setting) → ~50 years in 100 class days | Every 12-month clock (raise, promotion eligibility, GIC, RRSP room) collapses to two class days. Stage A, the part the course teaches most, flies by. |
| **b. Stage-paced time** | *Corrected in `docs/phase5-life.md`:* the first 24 months at 1/day (24 days), the rest of Stage A at 4/day (36), B at 12/day (19), C at 12/day (15) = 94 class days. (The earlier "Stage A ≈30 days" figure did not add up: Stage A alone is 168 months.) A per-stage `months_per_day` in world settings. | Clean, but the 12-month mechanics feel different in each stage; sims must re-tune for B and C. |
| **c. Age decoupled from months** | World months as now; the teacher advances the *stage* per unit (or the student "graduates" a stage by meeting a checklist). Age is display plus the stage rules. | Keeps every mechanic as tuned. Loses the "years pass" feel; Stage C then needs a synthetic jump in bills and savings. |

Recommendation: **b**, because it keeps the unit the course spends its time on (Stage A) at today's tuned pace and still finishes a life. But this is Mr. Tang's call; it changes the feel of every existing 12-month rule.

### 4.2 Careers with an education tier (Phase 1 done properly)

Add a **School** door (the Archive zone fits). Each catalogue job gets a tier:

| Tier | Entry | Example | Student debt |
|---|---|---|---|
| Trade / entry | now | Cashier, Barista, Landscaper | none |
| Apprenticeship | enrol while working; 24 world months of reduced hours | Electrician (already in catalogue as "apprentice") | small, paid from pay |
| Diploma | 24 months, part-time pay only | Bookkeeper, Admin, Dental hygienist | ~$20k Canada Student Loan |
| Degree | 48 months, part-time pay only | Teacher, Nurse, Accountant | ~$40k |

A student loan is a liability on the ledger with the real repayment rules (repayment terms from Canada Student Financial Assistance and Alberta Student Aid; cite at build time, ILLUSTRATIVE until then). Payments flow through Bills. The brief's list of 12 careers and ALIS wages can seed the higher tiers, which makes the game and the spreadsheet use the same careers.

"Getting different jobs" then means: change jobs for a raise, qualify for a tier, or get promoted. Keep the existing jobs_past rule so switching back is cheap.

### 4.3 Errands and quests (the daily reason to open it)

**Rule first: the refresh is the tick, not the clock.** One school day = one tick = one new set of errands. No wall-clock regen, no "come back in 4 hours". PLAN §6 wants 5–10 minute sessions and no pull; this keeps it.

Three kinds, all from a `quests` module:

1. **Lesson quest** (PLAN.md:117-120, 302-305, already planned). The outline's "World quest" section → quest file → pushed to the town for that date. One per class day, worth an outcome code and a modest reward. The teacher sees who completed it.
2. **Errands.** Three per tick, drawn deterministically from the student's own state, never random rewards:
   - *Chores that teach the panel:* "Move your surplus somewhere that earns" (HISA/GIC/TFSA), "Check your pay stub: how much was CPP?", "Read the Bank of DAA: what's pending?"
   - *Housekeeping with a real cost if skipped:* "Pay the phone bill" when autopay is off; "Your card minimum is due".
   - *Stage errands:* "Set your retirement age" (Stage B), "Set a withdrawal plan" (Stage C).
   Reward: a fixed small cash amount tied to the errand (an "errand wage"), plus energy (below). Completing all three gives the streak day; streaks are **per tick**, not per calendar day, so a student absent on Tuesday isn't punished by the calendar, only by the world.
3. **Milestones.** The existing achievements (Emergency fund, First keys, Credit 750+, On time, Promoted) surface here instead of being buried in Outfitters.

Where it lives: a **Today** card on the home screen above the doors: "Month 14 · 3 errands · the lesson quest · what changed since last month (pay, bills, interest, rank)". This also closes the "no month summary" gap with one component.

### 4.4 Energy and exploration (unlocking the map)

Energy is the student's **time**: a budget of actions per tick, refilled at the tick. It pays for *exploring*, not for routine banking. Suggested rule set:

- **Refill at the tick** to a cap (say 10). Errands and the lesson quest add a little. Nothing refills on the clock.
- **Routine actions are free** (pay bills, move savings, trade). Energy never blocks the course content.
- **Exploring costs energy:** opening a locked district the first time, taking an optional side activity inside it (a training course at School, a side gig at the Job Centre for extra hours, a market tour at the Exchange that unlocks a stock's story).
- **Two unlock drivers, one owner each**, so they don't fight:
  - **The teacher/unit unlocks which districts exist** (PLAN.md:29: Payday Square, Credit Quarter, Harbour Exchange, Venture Row, Tax Keep). A class in week 2 doesn't see the Exchange.
  - **Energy and stage unlock what's inside a district.** Within the Exchange: funds first, stocks after a tour, limit orders after a stage-A errand chain. Within Housing: condo after the "First keys" path, family home in Stage B.
- Visible on the map: a locked door shows *why* ("Opens in Unit 3" vs "Costs 2 energy" vs "Stage B"). Never a timer.

Guardrails to keep: no gambling, no loot boxes, no random reward draws, no energy purchase, no notifications, no wall-clock mechanic (PLAN §6).

### 4.5 Smaller fixes, independent of the above

- **Autopay default on** for new players, with the first "Pay all" as a Stage A errand that teaches what autopay is doing. Keeps the lesson, removes the trap.
- **Jobless nudge:** after one tick without a job, the Today card's only errand is "Get a job"; after three, Bills still starts (rent is real even if pay isn't).
- **Net worth and HISA on the home screen**, not one door away.
- **Mascot on phones**, smaller rather than hidden.
- **Display name** separate from login username on boards.
- GIC rates follow the policy rate like HISA does.

---

## 5. Decisions for Mr. Tang

**Decided 2026-10-29 (Mr. Tang):**
1. **Clock:** stage-paced time (option b). A per-stage `months_per_day` in world settings.
2. **Energy and errands refresh per tick**, never on the wall clock.
3. **Unlock ownership:** teacher/unit decides which districts exist; energy and life stage decide what is inside them. *(He answered "unlock ownership" without picking a side; this takes the recommendation. Say so if you want a single driver instead.)*
4. **Education tier with student debt:** yes, seeded from the brief's 12 careers.
5. **Stage C:** full decumulation (CPP/OAS/RRIF, withdrawals, the live monthly check).
6. **Roadmap:** Phase 5 "The Town" items, alongside Venture Row.

The options as first laid out, for reference:

1. **Clock model:** a (faster months), b (stage-paced), or c (age decoupled)? Recommendation: b.
2. **Energy refresh:** per tick (recommended) or per calendar day? Per calendar day is the industry pattern and the thing PLAN §6 is designed to avoid.
3. **Unlock ownership:** teacher/unit for districts, energy/stage inside them (recommended), or a single driver?
4. **Education tier with student debt:** yes, with the brief's 12 careers as the catalogue? This is the biggest content job.
5. **Stage C:** full decumulation (CPP/OAS/RRIF, withdrawals, the live check) or just the check at season end?
6. **Where it lands in the roadmap:** these are Phase 5 "The Town" items (PLAN.md:319) alongside Venture Row. Ventures stays paused where it is; none of this touches the p4a/p4b branches.

## 6. Build order, once decided

Each step is one module, shippable alone, bots in `simulate`, 60-month sim audit, Gini/bills/homeowner guards still holding.

1. `today` card + quests module with errands and the lesson-quest file (closes the engagement gap first; no economy change).
2. `life` module: age, stages, stage-paced clock, Stage C income (CPP/OAS), withdrawals, extended Life Review.
3. `school` tier in jobs: education paths, student loan through Bills, careers from the brief.
4. Energy and district locks: config per course for which districts open per unit; energy costs on explore actions.
5. The small fixes in 4.5 (most can go in with step 1).

Then the dilemma cards, already queued, read the same class data the errands do.

---

*Reviewed for Mr. Tang. Code references are to main @ 10c8138; the student-experience scan that produced them is reproducible with the scanner brief in this session.*
