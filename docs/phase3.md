# Phase 3: The Exchange

The DAA Exchange, where students invest. The PLAN gives the topics:
- index funds, bonds and town companies' shares;
- the order book and market maker;
- TFSA / RRSP;
- dividends;
- a news ticker.

Outcomes: FIN3080 (risk and return, Rule of 72, fees, indexes) and FIN3090 (TFSA vs RRSP, tax inside vs outside), and its wealth feeds net worth and the leaderboards. Built as one module, `exchange`, under the v2 contract, in two waves:
- **3a:** securities, prices, trading, holdings, dividends, news, market events, TFSA;
- **3b:** RRSP and its tax refund and withholding, plus the economy check.

Business IPOs (student companies) are Phase 4.

## Guardrails (PLAN §6)

- No margin, short selling, options or leverage.
- Caps: at most 10 orders per student per world month, and no single order above 50% of their total investable cash.
- A circuit breaker: if any security moves more than 20% in one tick, its trading pauses for that month.
- Teacher controls:
  - a freeze-trading toggle (world teacher);
  - an "undo a trade" for the world teacher, as a reversal at the original price.
- Prices are deterministic: each world draws its prices from a seeded series that the server owns. Students can't predict it, the teacher can't rig it, and a rerun of a world is identical.
- No random rewards. A market move is market risk, which is the lesson.

## Securities (seeded catalogue; config can add)

**Funds.** Each has an MER (cite a typical Canadian ETF), deducted monthly from the price.

| Ticker | Name | Expected return / volatility |
|---|---|---|
| `DAAX` | DAA Total Market Index | equities: FP Canada / IQPF 2026 Projection Assumption Guidelines equity return (cite exact figures), volatility ~15%/yr |
| `DAAB` | DAA Bond Index | fixed income return from the same guidelines, volatility ~5%/yr; also moves with the policy rate (see below) |
| `DAAG` | DAA Balanced 60/40 | blended |

**Town company stocks.** About 8 fictional companies, named after the jobs catalogue's employers (e.g. Agora Coffee Co., Beacon Business Services), so a student can own shares in their own employer. Each has:
- a sector;
- volatility: 25–45%/yr, varied;
- expected return: an equity base ± a sector tilt;
- a dividend yield of 0–4%, paid quarterly (world months 3, 6, 9, 12 of each world year).

None of these are real companies or tickers.

**Price model** (per world month, one step):
- price × exp(ln(1 + μ − y)/12 + σ·ε/√12) × (1 − MER/12) (as built: μ compounds, see *The price model*);
- ε comes from a seeded generator: seed = the world's secret + worldId + ticker + month, so it's reproducible but not predictable from the code;
- equities share a common market factor (correlation ~0.6), so a crash hits everything;
- the bond fund also takes −duration (7) × Δ(policy rate) whenever `module.rates.changed` reports a new policy rate. This is the rates link students should notice.
- Prices are in cents with 4 decimal places of precision internally (store as integer micro-cents) and shown to the cent. State the precision explicitly and test it.

**Market events (world teacher):**

| Event | Effect |
|---|---|
| crash | −25% equities, −5% bonds |
| correction | −10% equities |
| rally | +10% equities |
| company scandal | −35% for one stock |
| company boom | +25% for one stock |

An event applies at the next tick on top of the normal step, makes a news headline, and passes through the circuit breaker except a crash, which is the exception and is documented.

## Trading

- **Market orders** fill immediately against the market maker:
  - ask = price × (1 + spread/2), bid = price × (1 − spread/2);
  - spread: funds 0.2%, stocks 1%;
  - whole shares only for stocks;
  - funds allow fractions to 0.0001 of a unit (store micro-units). This keeps dollar-cost averaging possible with small amounts.
- **Limit orders:**
  - rest until filled at the tick, when the new price crosses, at the limit or better;
  - can be cancelled any time;
  - expire after 3 world months;
  - money for a buy limit is held: moved from cash to a hold account, released on cancel or expiry.
  - This is the "order book" lesson. There is no student-to-student matching in Phase 3; the market maker is always the counterparty, which also rules out wash trading and collusion. Student-to-student matching arrives with Phase 4 IPOs.
- **Accounts:** each student has investment accounts, each with its own cash and holdings:
  - **Non-registered:** cash in ledger account kind `invest`.
  - **TFSA:** ledger kind `tfsa`.
  - **RRSP:** ledger kind `rrsp`, wave 3b.
  - Money moves chequing → account (a contribution) and account → chequing (a withdrawal). Buying moves account cash → sink; selling moves mint → account cash (the market maker is outside town). Holdings are module rows `(player, world, account, ticker, units)`, not ledger money.
- **TFSA rules:**
  - contribution room $7,000 per world year (2026 limit; cite CRA);
  - unused room carries forward;
  - withdrawals give the room back at the start of the next world year;
  - over-contributing is refused up front. This simplification is documented: real CRA charges a 1% per month penalty.
  - Growth and withdrawals are untaxed.
  - The panel shows room left and the "box, not the investment" idea, which ties to the L27 misconception.
- **Dividends:**
  - paid to the account holding the stock;
  - on a non-registered account they're shown as "taxable (not modelled)", with a documented simplification;
  - each student can choose DRIP (reinvest) or cash per holding.

## Value and net worth

- Each tick after prices, the module emits `module.exchange.value { playerId, worldId, holdings }`: holdings at the bid price, cash excluded, since cash is already in the ledger.
- `leaderboards` and `savings` add it to net worth, the same way they add housing value. These are small listener edits in those two modules.
- `seasonAssets` returns holdings value at season close.
- `world.closed` ends holdings, the same as housing's homes, so nothing survives into a new world without its money.

## News ticker

Each tick produces 1–4 headlines from deterministic templates:
- the biggest movers;
- the index level;
- the bond fund reacting to a rate change;
- a dividend paid;
- any market event.

It's shown on the Exchange panel and as a scrolling strip on the student home screen. The strip is a module panel or a badge: no core edit unless needed, and if needed, propose it.

## Panels

**Student** (building key `exchange`, name "Exchange"):
- markets: price, 12-month sparkline (inline SVG via DOM), change %, dividend yield, MER for funds;
- trade ticket: account, market or limit, units or dollars for funds, a preview of cost incl. spread;
- portfolio by account: holdings, average cost, value, gain/loss, allocation pie as inline SVG;
- the activity log under the portfolio (added 2026-11-19): the student's own buys, sales (with the gain or loss against what they paid) and dividends (cash, or reinvested with the DRIP buy folded into the dividend's row), newest first, grouped by world month, the latest 100 (`view.js` `activityView`, `/state` field `activity`). Read-only: it lists `exchange_trades` and `exchange_dividends` for that player only. A trade the teacher undid stays listed, marked. Contributions and withdrawals are not in it;
- open orders;
- TFSA room;
- Rule of 72 for each fund's expected return;
- news.

**Teacher:**
- per class: holdings totals by asset type;
- most-held tickers;
- TFSA usage;
- trades this month;
- freeze toggle, market-event buttons, undo trade (world teacher).

## Simulate

- 60% of bots dollar-cost average 20% of what's left after bills into `DAAX` in a TFSA.
- 15% buy one stock and hold.
- 10% "chase": they buy last month's top mover and sell after a 10% drop.
- The rest don't invest.
- The sim reports median portfolio value, the share investing, and the TFSA share.

## Gates (each wave)

- `npm test` three times;
- `npm run sim -- --months=60`: audit OK every month, and the docs/phase2.md targets still met (report any shift caused by investing, especially Gini);
- perf with the existing thresholds, and one 300-student world month under 1000 ms;
- `node --check` on UI files;
- an end-to-end run over HTTP.

**Tests:**
- price-model determinism: same world, same series;
- the MER drag;
- the bond/rate link;
- spread math;
- limit fills only when crossed;
- the funds hold for a buy limit is released on cancel or expiry;
- caps and the circuit breaker;
- TFSA room, carry-forward and the withdrawal-restores-next-year rule;
- dividends and DRIP;
- the value event and the leaderboard net worth including holdings;
- season close;
- teacher B isolation;
- world-teacher-only controls.

---

# Wave 3a as built

Files: `modules/exchange/` (`constants.js` every number with its source, `prices.js` the price model, `orders.js` the integer order math, `news.js` headlines, `index.js` the module, `ui/exchange.js` + `exchange.css` the student panel, `ui/teach.js`). Tests: `test/exchange-math.test.js` (pure), `test/exchange.test.js` (over HTTP). Config order: `... outfitters, exchange, savings, leaderboards`. The RRSP is wave 3b (below).

## Sources (checked 2026-10-22; all in `constants.js`)

| Constant | Value | Source |
|---|---|---|
| Equity return (DAAX and the stock base) | 6.3% a year | FP Canada / Institute of Financial Planning, 2026 Projection Assumption Guidelines (published 2026-04-16, in force 2026-04-30): Canadian equities 6.3%, US 6.4%, international developed 6.6%, emerging 7.5%. fpcanada.ca release. The IQPF's own communique lists 6.4% / 6.6% for the first two rows (reversed); the PDF itself was not confirmed, so FP Canada's own page is followed |
| Fixed income return (DAAB) | 3.2% | same guidelines (short-term 2.4%, inflation 2.1%) |
| DAAX MER 0.06% | iShares Core S&P/TSX Capped Composite (XIC): MER 0.06%, management fee 0.05% | Cboe Canada ETF comparison pages, Apr-May 2026 (BlackRock's page did not show Key Facts when read) |
| DAAB MER 0.10% | iShares Canadian Universe Bond (XBB) 0.10% | TradingView and Pensions & Investments listings (one older page said 0.33%) |
| DAAG MER 0.20% | ILLUSTRATIVE | typical all-in-one balanced ETF; no page read |
| Bond duration 7 | ILLUSTRATIVE | the usual figure for a broad Canadian bond ETF; the effective duration was not on any page read |
| TFSA limit $7,000 for 2026 | CRA, "Calculate your TFSA contribution room" (announced 2025-12-01); room = limit + carry-forward + last year's withdrawals - contributions; 1% a month on over-contributions | canada.ca |
| Stock volatilities (25-45%), sector tilts, yields (0-4%), start prices | ILLUSTRATIVE | teaching figures |

## The price model

Per world month, per security (`prices.js`, pure):

```
gross  = exp(ln(1 + mu - y)/12 + sigma * z / sqrt(12))             mu = total expected return (compound), y = dividend yield (stocks), sigma = volatility
price' = round(price x gross x eventFactor x rateFactor x (1 - MER/12))     integer micro-cents, never below 1 cent
```

- **Seed.** `z` is a standard normal from Box-Muller over two uniforms `u = (floor(r x 2^32) + 0.5) / 2^32` (strictly inside (0, 1)) of `mulberry32(fnv1a32("<secret>:<worldId>:<ticker>:<month>"))`, clipped to +-3.5. The market factor `M` uses the key `MKT`. `secret` is 16 random bytes (hex) made the first time a world's prices are touched and kept in `exchange_secrets`; no route returns it, so reading the source code is not enough to compute next month's prices. A rerun of a world with the same id and secret repeats the series.
- **Drift.** The FP Canada / IQPF figures are compound (geometric) long-run returns, so the step uses `ln(1 + mu - y)/12`: with z = 0 every month the price grows exactly `mu - y` a year, and that is the median path. The mean path is a little higher (about `sigma^2/2` a year), as in real markets. Worlds differ (the first world's 60-month DAAX path happens to be a +2.6 sigma bull run; worlds 2-5 are not).
- **Correlation.** Stocks: `z = sqrt(0.6) M + sqrt(0.4) e_ticker`, so any two stocks correlate at 0.6 and a stock with DAAX at sqrt(0.6) = 0.77. DAAX is the market factor itself (`z = M`). DAAB has its own independent draw (correlation 0 with equities). DAAG's gross factor is 0.6 x DAAX's + 0.4 x DAAB's, then its own 0.20% MER. Tested empirically over 6,000 months.
- **Dividends.** A stock's `mu` is a total return (guideline 6.3% + the sector tilt); price growth uses `mu - y` so dividends are not counted twice. Quarterly (months 3, 6, 9, 12 of a world year): `floor(units x floor(price x yield / 4) / 1e10)` cents, from the mint into the account that holds the stock; DRIP buys back at the ask (fractions allowed, ignoring a breaker pause), otherwise cash.
- **Bond fund and the rate.** `module.rates.changed` stores the policy rate; at the tick DAAB is multiplied by `max(0.5, 1 - 7 x change)` (+100 bp = -7%), once, then the rate is marked applied. The first announcement of a world is not a change.
- **Events** (world teacher, queued, applied at the next tick on top of the normal step): crash -25% stocks and DAAX / -5% DAAB, correction -10%, rally +10%, scandal -35% / boom +25% on one stock. DAAG feels them through its two parts. A headline is made.
- **Rate announcement pause.** A queued policy-rate change makes the bond fund's next move known (DAAB x (1 - 7 x change)), so while one is pending the bond-linked funds (type `bond`, and any `blend` holding a bond fund: DAAB and DAAG, worked out from the catalogue) take no market orders, no new limit orders, buy or sell, and no limit fills, with "Paused: the Bank of DAA announces a new policy rate at the next world month. Trading reopens after it." Holders keep their exposure; nobody enters or exits on the known move. The pending rate stays visible to students. Exchange learns of it from `module.rates.pending` (its own `exchange_rate_pending` table) and pauses while `effective_month > world month`; rates clears it inside the tick that applies the change (before exchange's tick, so resting limits can fill at the new price) or at once when the teacher cancels. The Markets cards show the reason. (No DRIP is affected: funds pay no dividends.)
- **Circuit breaker.** A security whose NORMAL move (noise, the rate shock, fees; events excluded) exceeds 20% pauses market orders and limit fills for the rest of that world month (the next tick reopens it). Events pass through the breaker (they move the price but do not pause trading), except a crash, which pauses the stocks and DAAX for the month. This is the reading of "passes through the circuit breaker except a crash" the spec left open.

## Fixed point and rounding

Cents in the ledger. Prices: integer **micro-cents** (1e-4 cent, `PRICE_SCALE = 10,000` per cent; $100.00 = 100,000,000). Fund units and shares: integer **micro-units** (`UNIT = 1,000,000`); funds trade in steps of 100 micro-units (0.0001 unit), stocks in whole shares (a DRIP can leave a fraction). Value of a trade = `units x price / 1e10` cents, computed in BigInt. Rounding is always against the trader: ask rounds UP, bid rounds DOWN (to the micro-cent); a buy costs `ceil`, a sale pays `floor`; dollars-to-units floors to a step so the cost never exceeds the dollars; a partial sale removes `floor(basis x sold / held)` of the cost basis. No float touches the ledger.

## Trading and accounts

- Ledger accounts: `invest` (non-registered), `tfsa`, `xhold` (cash held for buy limits). Kinds: `contribute`, `withdraw`, `buy`, `sell`, `dividend`, `drip_buy`, `hold`, `release`, `fill`, `undo_buy`, `undo_sell` (see events.md section 9).
- Market order: fills now at the ask / bid. Limit order: rests when it is off the market (a buy below the ask, a sell above the bid); a marketable limit (a buy at or above the ask, a sell at or below the bid) fills now as a market order at the ask / bid, the limit or better, is stored as `market`, and the reply carries a `note` saying so (it is refused only if the security is paused); a buy limit holds `ceil(units x limit)` cents; it fills at the tick when ask <= limit (sell: bid >= limit) **at the market maker's price, the limit or better**, with the difference returned; it expires after 3 world months; cancel any time. A sell limit reserves the shares.
- Caps: 10 orders per student per world month (market orders and limit placements; cancels, DRIP and dividends do not count); one BUY may commit at most 50% of investable cash (chequing + invest + tfsa + held), measured before the order. The 50% rule is applied to buys only.
- TFSA room in `exchange_tfsa` by world year: `7,000 x year - contributed + withdrawn in earlier years`. Over-contribution is refused up front (real CRA: 1% a month). The non-registered account has no limit. Dividends in it are labelled "taxable (not modelled)".
- Undo a trade (world teacher, and only a student in one of their classes, else 404): a compensating transaction at the original price (sink -> account for a buy, account -> mint for a sale), holdings put back. Refused with 409 if the shares are no longer free (sold, or reserved) or the proceeds were withdrawn. Reinvested dividends are not undone one by one.
- Teacher controls (world teacher only): freeze trading, queue an event, undo a trade. Freeze stops new orders and limit fills; prices keep moving; contributions, withdrawals and cancels still work.

## Net worth and the season

`module.exchange.value { playerId, worldId, holdings }` (holdings at the bid, cash excluded) after every trade and each tick. `savings` (`savings_exchange`, snapshots and `/status` as `exchange_value_cents`) and `leaderboards` (`leaderboards_inputs.exchange_value`) add it, as for homes. `seasonAssets` returns the same value at close; `world.closed` ends the season's holdings (`ended = 1`) and open orders.

## News

One to four headlines per tick (events, the bond fund reacting to a rate change, a dividend, the index level, the two biggest movers) from fixed templates (`news.js`). Shown on the panel as a scrolling strip. **The home-screen strip is a proposal, not built**: modules can only add header chips through `badges`, so exchange adds two (`DAAX $99.28 -4.5%` and the newest headline, cut to 40 characters). A real scrolling strip on the home screen needs a core hook such as a `homeStrip` panel slot in `public/student.js`.

## Simulate (bots)

60% dollar-cost average 20% of their chequing balance (what is left after bills) into DAAX inside the TFSA each month; 15% buy one stock once (30% of chequing, TFSA if there is room) and hold; 10% chase (buy last month's top-moving stock in the non-registered account, sell after a 10% drop); the rest do not invest. `scripts/sim.mjs` counts holdings in net worth, prints an exchange line at months 12-60 and takes `--skip-worlds=N` to run in world N+1 (each world id is a different market).

### Balance (wave 3a)

`npm run sim -- --months=60` (300 bots, audit OK every month). Phase 2 targets with investing on (world 1, a +2.6 sigma bull market for DAAX: $100 to $287):

| Month | Bills / pay | Homeowners | Owners in arrears | Median score | Gini |
|---|---|---|---|---|---|
| 12 | 69% | 0 | n/a | 679 | 0.296 |
| 24 | 63% | 0 | n/a | 652 | 0.324 |
| 36 | 60% | 76 (25%) | 0% | 704 | 0.308 |
| 48 | 59% | 90 (30%) | 0% | 722 | 0.317 |
| 60 | 57% | 96 (32%) | 0% | 724 | 0.324 |

All Phase 2 targets still hold (homeowners at month 60 30-50%, bills/pay 50-75%, arrears under 10%, score at month 24 650+, Gini under 0.40). **Shift caused by investing:** homeowners at month 60 fall from 39% to 32% (cash in the TFSA is not available for a down payment), and Gini moves by under 0.01. Other worlds (2-5), month 60: median net worth $41.9k-48.6k against $44.5k with no exchange; Wolf ranks Pup/Scout/Hunter/Pack Leader/Alpha 4-7 / 18-28 / 71-98 / 144-160 / 24-40 against 8 / 26 / 89 / 152 / 25 without; owners 96-99.

Investing (world 1, from month 12): 86.7% of bots hold something or have cash in an investment account, 87.3% of those use a TFSA; median portfolio of an investor $2,098 (month 12), $4,899 (24), $10,133 (36), $20,651 (48), $39,005 (60, bull market).

## Deviations and proposals

- News strip on the student home screen: chips via `badges` only (see News).
- 50% order cap applies to buys.
- Circuit breaker and events: the reading above.
- A market event passes through the breaker (no pause) except a crash.
- DRIP buys fractions of a share (as real DRIPs do) at the ask.
- Cross-module edits: `savings` and `leaderboards` listeners for `module.exchange.value` and one migration each (`savings_exchange`, `leaderboards_inputs.exchange_value`), `config/vdaa.json`, `test/db.test.js` (module order), `test/fuzz.test.js` BASE, `public/theme.css` (the `exchange` zone uses the council scene), `scripts/sim.mjs`, `scripts/perf.mjs` (`month300`).

## Wave 3b: RRSP (spec)

The FIN3090 lesson: a TFSA shelters growth from tax; an RRSP also gives a deduction now and taxes the money on the way out. And a withdrawal's withholding is not the whole tax.

### Account

- A third investment account, ledger kind `rrsp`. It's added to `ACCOUNTS`, `investable`, the account labels and the trade ticket. It trades, holds and takes dividends exactly like the TFSA: growth and dividends inside are untaxed, and DRIP works.
- Contribution: chequing → `rrsp`, refused up front above the room left. The real CRA $2,000 over-contribution buffer and the 1%/month penalty are not modelled (documented).
- Withdrawal: `rrsp` → chequing minus withholding. Withholding goes to the `sink` and is recorded as tax already paid for that world year.
  - CRA rates outside Quebec, applied to the amount of that single withdrawal: 10% up to $5,000, 20% over $5,000 up to $15,000, 30% over $15,000.
  - Cite canada.ca "Tax rates on withdrawals".
  - A withdrawal never restores room (unlike a TFSA). The panel says so.

### Room

- Room for world year y = carried-forward unused room + min(18% x earned income in world year y − 1, $33,810).
  - The $33,810 is the 2026 RRSP dollar limit; cite CRA "MP, DB, RRSP, DPSP, ALDA, TFSA limits, YMPE and the YAMPE".
  - Earned income = the sum of `gross` from `module.jobs.paid` events for that player in that world year. Store it in an `exchange_income(player_id, world_id, year, gross_cents)` table.
- World year 1 has no room. The panel explains that room comes from last year's pay.
- Room is per world (season): a new season starts at 0, like money.
- `yearOf(month)` from orders.js defines world years.

### Year-end tax settlement (the refund)

When a tick moves the world into a new world year (month 13, 25, ...), each player with any RRSP activity in the year just ended (a contribution or a withdrawal) gets a settlement:

```
G  = earned income that year (exchange_income)
C  = RRSP contributions that year
W  = RRSP withdrawals that year (gross, before withholding)
H  = withholding taken that year
settle = tax(G) - tax(G - C + W) + H         positive: refund; negative: balance owing
```

- `tax(x)` is the annual federal + Alberta income tax on x, using the 2026 brackets and basic personal amounts already in `modules/jobs/payroll.js`.
  - Add one pure exported function there, `annualIncomeTax(incomeCents)`. It includes the lowest-rate credits for the basic personal amount, the Canada employment amount, and CPP/EI at the annual rates on x, so that the zero-tax point is right. It also includes Alberta's K5P supplemental credit.
  - It's a pure import (no table read), the only cross-module code import. Note it in docs/modules.md.
  - Test it: zero below the threshold, and the marginal rate between two nearby incomes matches the bracket rates (14% + 8% = 22% for a typical student).
- Payroll over- or under-withholding on wages is not settled. The game only settles the RRSP difference (documented simplification).
- Refund: `mint` → chequing, ledger kind `rrsp_refund`, memo "RRSP tax refund (world year N)".
- Owing: chequing → `sink` up to the chequing balance. Anything left over is carried into next year's settlement (no interest, documented).
- Emit `module.exchange.rrsp_settled { playerId, worldId, year, refund, owing }` after commit (docs/events.md), and add a news line for the class: "N students got RRSP refunds this year".
- Show the last settlement on the panel as a mini tax slip: G, C, W, tax before, tax after, withheld, refund or owing.

### Panel

- **RRSP card:** room left, contributions this year, "your refund if the year ended today" (the settlement formula with this year's figures so far), and the withholding table.
- **TFSA vs RRSP comparison:** the same $1,000 in each, 30 years at DAAX's expected return. TFSA: grows untaxed, comes out untaxed. RRSP: grows untaxed, plus the refund now if invested, taxed on the way out at the student's current marginal rate. One sentence on why the RRSP wins when your tax rate is higher now than in retirement, and the TFSA wins otherwise.

### Teacher

RRSP usage per class (share contributing, total contributed, total refunds).

### Net worth

RRSP cash and holdings count at face value (pre-tax), like real net-worth statements. The panel notes that some of it will go to tax on withdrawal.

### Simulate

Of the investing bots, those with RRSP room put 5% of gross into the RRSP each month (in DAAX) while room lasts, and put their refund into the TFSA. The sim reports the RRSP share and the median refund at months 24, 36, 48 and 60.

### Gates

- As for 3a.
- Tests:
  - room (year 1 zero, 18% of last year's income, the cap, carry-forward, a withdrawal not restoring room);
  - withholding bands at exactly $5,000 / $15,000;
  - the settlement for a contributor (refund ≈ C × marginal);
  - a withdrawer (owing = tax − withheld);
  - owing larger than chequing (carry-forward);
  - `annualIncomeTax` at known points;
  - no settlement without RRSP activity;
  - the event;
  - teacher B isolation;
  - season close (room and income reset).

---

# Wave 3b as built

Files changed: `modules/exchange/{index,orders,constants}.js`, `ui/exchange.js`, `ui/teach.js`; `modules/jobs/payroll.js` (one new pure export, `annualIncomeTax`; `payStub` untouched); `scripts/sim.mjs`; docs (`events.md` section 9, `modules.md`). Tests: `test/exchange-math.test.js` (room, withholding bands, settlement and comparison, pure), `test/exchange.test.js` (seven RRSP tests over HTTP), `test/jobs-payroll.test.js` (`annualIncomeTax`). No new config, no edits to `savings`, `leaderboards` or any other module: RRSP cash is a ledger account (net worth already sums every account) and its holdings go through the existing `module.exchange.value`.

## Sources added (checked 2026-10-22)

| Constant | Value | Source |
|---|---|---|
| RRSP dollar limit, 2026 | $33,810 | canada.ca, "MP, DB, RRSP, DPSP, ALDA, TFSA limits, YMPE and the YAMPE" (`.../registered-plans-administrators/pspa/mp-rrsp-dpsp-tfsa-limits-ympe.html`), page opened and the figure read; the same page gives the TFSA limit $7,000 |
| New room = 18% of the previous year's earned income | 18% | the same CRA rule, as given in the wave 3b spec; no page read for the percentage |
| Withholding outside Quebec: 10% up to $5,000, 20% over $5,000 up to and including $15,000, 30% over $15,000 | rates by the size of one withdrawal | CRA, "Tax rates on withdrawals" (read 2026-10-22): https://www.canada.ca/en/revenue-agency/services/tax/individuals/topics/rrsps-related-plans/making-withdrawals/tax-rates-on-withdrawals.html. The same page warns the withholding may not cover the full tax, which is the lesson. Not modelled: CRA treats several withdrawals close together as one, for the rate |
| Lower and higher retirement tax rates in the TFSA vs RRSP table (15%, 30%) | ILLUSTRATIVE | teaching figures |
| `annualIncomeTax` | the T4127 constants already in `payroll.js`, applied to annual amounts | CPP/EI annual rates and maximums (Tables 8.3 to 8.7), federal and Alberta bracket tables, BPA, Canada employment amount, K5P. The annual CPP basic exemption is $3,500 (the stub uses $291.66 x 12 = $3,499.92) |

## How it works

- **Account and room.** `ACCOUNTS = [invest, tfsa, rrsp]`; the RRSP trades, holds, takes dividends and DRIP exactly like the TFSA (same code path). `exchange_income(player, world, year, gross)` is summed from `module.jobs.paid`; `exchange_rrsp(player, world, year, contributed, withdrawn, withheld)`; room by year = `sum over years 2..y of min(floor(18% x income(year-1)), $33,810) - everything ever contributed` (`rrspRoom`), so unused room carries forward and withdrawals never appear. Room is per world: new world, new rows.
- **Withdrawal.** Chequing gets `amount - withheld`, the sink gets the withholding (one `withdraw` transaction with a third leg), the withholding is added to that year's `withheld_cents`. The band is by the size of the single withdrawal, applied to all of it (exactly $5,000 is 10%, $5,000.01 is 20%; exactly $15,000 is 20%); rounded half up to the cent. A $0.01 to $0.04 withdrawal withholds nothing.
- **Settlement.** Runs inside the first tick of a new world year (months 13, 25, ...), for the year just ended, in player-id order. `settle = tax(G) - tax(G - C + W) + H - carry`, positive refunds (`rrsp_refund`, mint -> chequing), negative is owing (`rrsp_tax`, chequing -> sink, as far as chequing goes). The row in `exchange_settlements` keeps G, C, W, H, both taxes, the carry brought in, refund, owing, paid and unpaid. The event goes out through `tx.onCommit` on a nested transaction inside the tick, so listeners run after the whole advance commits (tested: no transaction open in the listener).
- **State.** `GET /state` gains `rrsp` (room, this year's figures, "if the year ended today", the withholding bands, the last tax slip, the comparison) and `accounts.rrsp_cents`. `GET /teach` gains `rrsp_users`, `rrsp_contributed_cents`, `rrsp_refund_cents` per class. `POST /withdraw` returns `withheld_cents` and `net_cents`.
- **Sim.** The first 75% of bots (the DCA and buy-and-hold groups, i.e. the investing ones) put 5% of last year's average monthly gross into DAAX inside the RRSP each month while room lasts, and at the first month of a world year put their refund (as far as TFSA room and chequing go) into DAAX in the TFSA. The sim prints an `rrsp:` block at months 24, 36, 48, 60.

## Decisions the spec left open

1. **`annualIncomeTax(taxableCents, earnedCents = taxableCents)` has an optional second argument.** CPP, EI and the Canada employment amount are charged on pay, and an RRSP deduction or a withdrawal changes taxable income but not pay. With a single argument the settlement would also shrink the CPP/EI credits when income "falls" by the contribution, and the refund would be about 20.3% of the contribution instead of the 22% bracket rate. The settlement therefore calls `annualIncomeTax(G)` and `annualIncomeTax(max(0, G - C + W), G)`. The one-argument form (the spec's signature) is unchanged and tested; its marginal rate is a little under the bracket rates, as the spec's note about CPP/EI implies, and the test says so.
2. **Cross-checked, not only pinned.** `annualIncomeTax($48,000)` is $5,470.43; twelve `payStub` periods at $4,000 give $5,470.44. The test allows 12 cents.
3. **Withholding is rounded half up to the cent** and applies to the whole withdrawal at its band's rate (not by slices), which is how the CRA table works.
4. **Contributions count in the world year they are made** (no 60-day rule, no "contribute in March, deduct last year").
5. **Carry-forward.** A student with a balance owing that chequing could not cover is settled again at the next year start even with no RRSP activity that year (otherwise it would never be collected). The carry is netted against that settlement: a refund of $200 against $50 carried is a $150 refund. `refund`/`owing` in the event and the slip are the net figures. No interest.
6. **Event payload.** `{ playerId, worldId, year, refund, owing }` with `year` the world year just ended; one event per settled student, including a student settled only for carry.
7. **The news line is town-wide, not per class.** `exchange_news` is per world (prices are the same for every class), so the headline is "N students got RRSP tax refunds for world year Y" counting every class, made only when N > 0 (kind `rrsp`).
8. **"Your refund if the year ended today"** uses pay so far this world year, this year's contributions and withdrawals, and the carried balance; before any pay it is 0. The marginal rate in the comparison is the bracket rate on the student's current taxable income (last year's pay, else this year's pay so far scaled to a year).
9. **The comparison** shows the refund invested in a TFSA, three retirement rates (same as today's marginal rate, a lower 15% and a higher 30%; the last two ILLUSTRATIVE). At the same rate the two tie, which is the point; the one-sentence rule is on the panel.
10. **RRSP room is by event, so only jobs pay counts.** Welcome grants, transfers, interest and dividends are not earned income. A student with no job has no room.
11. **Net worth** needed no listener change: RRSP cash is a ledger account and RRSP holdings flow through `module.exchange.value`. The panel says some of it is pre-tax.
12. **Season close** needed no handler: income, contributions, settlements and room are keyed by world id and the core zeroes the accounts. A settlement never crosses worlds (tested).
13. **Federal basic personal amount** is the flat $16,452 (as in `payStub`); the reduction above $181,440 is not modelled.

## Balance (wave 3b)

`npm run sim -- --months=60` (300 bots, audit OK all 61 rows). The runs are not identical from run to run (each world's price seed is random): homeowners at month 60 were 92 to 94 (31%) in the two runs made, Gini 0.315 to 0.322, bills/pay 57%. Last run: `economy check (month 61): median score 754, cards 69.3%, paying in full 14.3%, homeowners 94, median mortgage payment / gross 18.4%, owners in arrears 0.0%, Gini 0.315`. Compared with wave 3a (homeowners 96, 32%; Gini 0.324) the RRSP costs about 2 to 4 homeowners in 300 (cash locked in an RRSP is not available for a down payment) and moves Gini by under 0.01; all Phase 2 targets still hold. About 85% of investors hold an RRSP; the median refund at the latest year-end is $278 (month 36), $331 (48) and $372 (60) for the 222 students refunded.
