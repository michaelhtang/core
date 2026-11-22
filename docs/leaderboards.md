# Leaderboards and Wolf ranks

The game's objective, made visible:

- finish the season with the highest net worth;
- also: the best financial health, the best class, and the best Wolf rank.

Built as one module, `leaderboards`, under the v2 contract (`docs/modules.md`), placed **last** in config, after savings, so it sees month-end numbers. Its building is the **Amphitheatre**, building key `amphitheatre`.

## What a student sees (Amphitheatre panel)

1. **Net worth.**
   - Class board and Town board: top 10, each with rank, pseudonym, Wolf rank, the change since last month (▲3 / ▼1), and net worth rounded to the nearest $1,000.
   - Below the top 10, the student's own row: "You: #14 of 31, ▲3, $23,000".
   - A world-teacher setting can hide the rounded amounts so only ranks and tiers show.
2. **Financial health** (same layout, score 0–100). The point is that any income can win. Components, each 0–100, averaged:
   - **Savings cushion:** (HISA + GIC balances) ÷ last month's net pay. 3 months or more = 100.
   - **On time:** share of this season's bills, card payments and mortgage payments paid on time.
   - **Credit:** (score − 300) ÷ 6. No file = 50.
   - **Debt load:** card balance + 12 × mortgage payment, ÷ annual gross. 0 = 100, linear to 0 at 3×.

   Show the student their own four parts with one tip for the weakest.
3. **Class vs class:** every class in the world, by median net worth and median health. The student's class is highlighted. Medians, not averages, so one rich student can't carry a class.
4. **Wolf ranks**, from net worth:
   - Pup → Scout → Hunter → Pack Leader → Alpha.
   - Thresholds are config, scaled by the price index (rates `priceIndexBp`) so inflation doesn't hand everyone promotions.
   - Calibrate the defaults with the 60-month sim. The first idea was Alpha ≈ top 10% at month 60, Pack Leader ≈ top 30%, Hunter ≈ median; the current spacing (see Calibration below) is Hunter ≈ month-24 median, Pack Leader ≈ month-36 p70, Alpha ≈ month-60 p90.
   - Shown as a header chip beside the name everywhere (the core `badges` hook) and on every board row.
   - A rank-up is announced once.

## Data (events and the ledger API only; no other module's tables)

- **Net worth:**
  - the sum of the student's player accounts (`k.ledger.accountsOf('player', id)`), which already includes HISA, GICs, card debt (negative), the mortgage (negative), deposits, and unpaid bills (bills' `payable` account, negative from the tick a bill is issued), so a student who leaves bills unpaid never out-ranks one who pays;
  - plus home value from `module.housing.value`.
- **Health inputs:**
  - `module.jobs.paid` (net, gross);
  - `module.bills.paid` / `module.bills.late`;
  - `module.housing.payment`;
  - `module.credit.score`;
  - `module.credit.statement` (card balance);
  - account balances by kind via the ledger API.
- **Monthly snapshots:** one row per student per world month in `leaderboards_snapshots(world_id, player_id, month, net_worth, health, rank_class, rank_town, tier)`, written in `onTick`. Boards read the latest snapshot (cheap); "change since last month" compares two snapshots.

## Season finale

At season close, the `seasonClose` hook (inside the close transaction; a failure fails the close) stores the Life Review and the awards in `leaderboards_awards`:

- **Wolf of the Season:** top net worth, town-wide;
- **Healthiest Wolf:** top health score;
- **Best Comeback:** largest rank climb over the last 12 months;
- **Top Pack:** the class with the best median health.

The final snapshot is taken from the last month before close. A **Hall of Fame** tab shows the awards from every past season.

Each student's **Life Review** card, shown in the new season under "Last season":
- final net worth and Wolf rank;
- best month;
- the four health parts.

## Privacy and fairness

- Pseudonyms only, never real names.
- Nobody's balances, debts or bills are shown, only rounded net worth (or nothing, if the teacher hides amounts), rank, tier and health score.
- Students without a job or with no activity still appear, at their real numbers.
- Teacher B (invite) sees their own classes' boards and the Town board, which is pseudonyms only.

## Teacher panel

- All boards per class.
- The amounts toggle (world teacher).
- Current award leaders.
- A "freeze boards" toggle for test weeks: boards show the last snapshot before the freeze.

## Sim and gates

- The sim prints the median health and the tier distribution at months 12, 24, 36, 48 and 60.
- Tests:
  - net worth equals the ledger sum plus home;
  - each health part;
  - tier thresholds scale with the index;
  - rank change;
  - medians for class vs class;
  - the awards at close;
  - the badge chip text;
  - privacy (no balance fields in board responses);
  - teacher isolation.
- Gates as usual: `npm test` three times, sim 60 months audit OK, perf, `node --check`.

## As built

### Module and data

- `modules/leaderboards`, last in both courses (after `savings`), building key `amphitheatre`, teacher panel "Amphitheatre". Routes: student `GET /board`, `POST /ack`, `GET /hall`; teacher `GET /teach`, `POST /hide`, `POST /freeze` (the two settings are world-teacher only).
- Tables: `leaderboards_snapshots(world_id, player_id, month, class_id, net_worth, health, parts, rank_class, rank_town, tier)` (one row per student per world month, from `onTick`), `leaderboards_inputs` (the latest numbers events announced), `leaderboards_late`, `leaderboards_index` (no longer used: the price index is `k.world.priceIndex`), `leaderboards_rankups`, `leaderboards_settings`, `leaderboards_awards`, `leaderboards_reviews`. A test greps the module for any other module's table.
- The world starts at month 1, so the first snapshot is month 2. Boards read the latest snapshot (or the frozen month); "change" compares it with the snapshot of the month before. Ranks are competition ranks (1, 2, 2, 4); ties break by net worth, then player id.
- Events listened to: `module.jobs.paid`, `module.bills.paid`, `module.bills.late`, `module.housing.payment`, `module.housing.value`, `module.credit.score`, `module.credit.statement`, `module.rates.changed` (price index), `ledger.posted` (only kind `credit.late_fee`); the finale is the `seasonClose` hook. Emitted: `module.leaderboards.settings` and `module.leaderboards.awards` (`{ worldId }`, teacher consoles refetch).

### Net worth

Sum of the student's player accounts (`k.ledger.accountsOf`) plus the home value from the latest `module.housing.value`. Boards round it to the nearest $1,000. Even a student's own board row is rounded (the Net Worth building has the exact figure); the Life Review shows the exact final figure.

### Health score as built

Four parts, each rounded to a whole number 0-100; the score is the mean of the four rounded parts, rounded.

| Part | Formula |
|---|---|
| Savings cushion | (HISA + GIC balances) / last net pay, `min(100, 100 x saved / (3 x net pay))`. No recent pay: 100 if anything is saved, else 0. A pay stub older than 3 world months counts as no pay. |
| On time | on-time payments / (on-time + late). Counted: each bill (a late-fee line is not a bill), each card statement minimum, each mortgage payment. Nothing due yet: 100. |
| Credit | `(score - 300) / 6`, clamped 0-100. No file: 50. |
| Debt load | `d = card owed + 12 x mortgage payment`; `100 x (1 - d / (3 x 12 x monthly gross))`, clamped; no debt: 100; debt and no recent pay: 0. The mortgage payment only counts while the mortgage account holds debt. |

Card statements: `module.credit.statement` is counted on time when it arrives for the statement that was waiting; a missed minimum posts `credit.late_fee`, which arrives after the advance commits and flips that one to late, so a late card payment shows from the next month's snapshot (one month of lag, by design: no other module's tables are read).

The tip names the lowest part (ties: the first in the order above).

### Wolf ranks

Pup, Scout, Hunter, Pack Leader, Alpha from net worth. Thresholds are net worth at season-start prices, multiplied by the world price index (`priceIndexBp` / 10000) of the month: `config.options.leaderboards.tiers` (`scout`, `hunter`, `packLeader`, `alpha`, in cents) overrides any default. Chips: `Wolf: <rank>` always, plus `Ranked up: <rank>!` until the student opens the Amphitheatre and taps "Nice!" (`POST /ack`). A rank-up needs a higher tier than the month before, and is announced once per tier per season (a drop is quiet; regaining a tier is not announced again). The chips follow the frozen month when boards are frozen.

### Season finale

In `seasonClose` (inside the close transaction) from the last snapshot month:

- **Wolf of the Season:** highest net worth in town. **Healthiest Wolf:** highest health (ties: net worth). **Top Pack:** class with the best median health (ties: median net worth, then class id).
- **Best Comeback:** the most places climbed in town rank between the snapshot 12 months before the last one (or the first snapshot, in a shorter season) and the last. Only students with a snapshot at both ends count; no award if nobody climbed.
- Ties inside an award go to the lower player id (or class id); Best Comeback ties go first to the better final rank, then the lower id.
- Hall of Fame keeps each season's awards (pseudonym, class, value). Wolf of the Season's amount follows the "hide amounts" setting of that season.
- Life Review per student: final net worth and Wolf rank, final town rank, best month (largest one-month net worth gain), the four health parts. It shows under "Last season" in the next season, and as soon as the old season closes.

### Calibration

`npm run sim -- --months=60` (300 bots, 10 classes, default config, 2026-10-22; audit OK every month; the docs/phase2.md targets are all still met: 39% homeowners in that first run, before the Exchange; about 31-32% since, see the latest re-tune below, bills/pay 69/60/57%, 0% owners in arrears, median score 652 at month 24, Gini 0.32). The sim prints, at months 12, 24, 36, 48, 60, the median health, the tier counts and net worth percentiles deflated by the price index (so they compare with the thresholds). Defaults chosen from the month-60 percentiles: Hunter = p50, Pack Leader = p70, Alpha = p90 (rounded to $500), Scout = $5,000 (about the 25th percentile at month 12, so a student reaches it in the first year).

**Current defaults (`DEFAULT_THRESHOLDS` in `modules/leaderboards/constants.js`): Scout $5,000, Hunter $15,500, Pack Leader $35,000, Alpha $84,500 (at season-start prices).** The paragraphs below are the history of how they got there; each earlier set of numbers is superseded.

First re-tune (integrator, 2026-10-22; superseded): Scout $5,000, Hunter $15,000, Pack Leader $35,000, Alpha $85,000. The first calibration put Hunter at the month-60 median ($46,000), which left nearly everyone a Scout for the first 30 world months; for a school season ranks must move all the way through, so the cutoffs are spaced across the season: Hunter ≈ month-24 median, Pack Leader ≈ month-36 p70, Alpha ≈ month-60 p90. Result (300 bots, 60 months): month 12: 64/174/62/0/0, month 24: 17/118/127/38/0, month 36: 14/69/140/77/0, month 48: 8/32/112/143/5, month 60: 8/20/74/168/30 (Pup/Scout/Hunter/Pack Leader/Alpha). Alpha stays the top 10%.

Re-tuned with the Exchange and the RRSP (2026-10-22): investing lifts the top of the distribution, so the cutoffs were set from the same rule averaged over five 60-month runs, each with a different random price secret (each run is a different market). Averages: month-12 p25 $5,877, month-24 median $15,760, month-36 p70 $36,090, month-60 p90 $90,090. Defaults then **Scout $5,000, Hunter $15,500, Pack Leader $36,000, Alpha $90,000** (superseded). With the old $85,000 Alpha cutoff, Alpha at month 60 ran 33-46 of 300 (11-15%) across the five markets.

Re-tuned again after unpaid bills started counting as debt (2026-10-23, bills owed from issue): five 60-month runs, different price secrets. Averages: month-24 median $15,475, month-36 p70 $34,928, month-60 p90 $84,303. Defaults now (current) **Scout $5,000, Hunter $15,500, Pack Leader $35,000, Alpha $84,500**. At the previous $90,000 Alpha cutoff only 16-30 of 300 (5-10%) reached Alpha at month 60. Homeowners 31-32%, Gini 0.325-0.337, audit OK every month in all five.

The table below is the first calibration run (old cutoffs), kept for its percentiles.

| Month | Median health | Pup / Scout / Hunter / Pack Leader / Alpha | Net worth p25 / p50 / p70 / p90 (season-start $) | Price index |
|---|---|---|---|---|
| 12 | 85 | 72 / 228 / 0 / 0 / 0 | 5,490 / 8,680 / 12,132 / 18,232 | 10000 |
| 24 | 88 | 17 / 283 / 0 / 0 / 0 | 9,590 / 15,578 / 23,386 / 36,158 | 10210 |
| 36 | 90 | 12 / 252 / 32 / 4 / 0 | 14,548 / 24,665 / 34,162 / 47,154 | 10424 |
| 48 | 91 | 8 / 196 / 54 / 37 / 5 | 19,988 / 34,704 / 46,531 / 65,644 | 10643 |
| 60 | 91 | 7 / 140 / 63 / 62 / 28 | 27,473 / 47,085 / 62,142 / 85,684 | 10867 |

At month 60: Hunter or better 51%, Pack Leader or better 30%, Alpha 9%. Reading it: the bots are well behaved (they pay bills, keep a cushion), so health is high and bunched (median 85-91); real students will spread out. Nobody is Hunter or better at month 24; Hunters and a few Pack Leaders appear by month 36 and Alphas by month 48, so in a short season few students will reach the top three: if a season runs shorter than about 36 world months, lower the three thresholds in `config.options.leaderboards.tiers`.
