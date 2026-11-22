# Phase 4: Ventures

Student businesses on **Venture Row**. FT20/30 teams found and run companies, hire classmates (FT10 included), sell to town NPCs and classmates, borrow or raise equity, publish statements, pay small business tax, and can go public on the Exchange after a pitch at the Amphitheatre.

Outcomes:
- ENT2020: feasibility, pricing, break-even, financing (loans vs equity).
- FIN1015 / FIN3050: journals, ledgers, statements.
- FIN3090: cap tables.
- FIN3080: the IPO, dividends.
- FIN3910/3920: the business plan.

Built as one module, `ventures`, under the v2 contract, on the Phase 4 core:
- service calls (`k.modules.call`);
- business account owners;
- `k.world.priceIndex`;
- the exchange `listSecurity` service.

It lands in three waves:
- **4a:** registry, team, treasury, products and NPC demand, statements.
- **4b:** payroll (hiring classmates), small business tax, loans.
- **4c:** equity, cap table, the IPO, dividends.

## Decisions (Mr. Tang, 2026-10-23)

- **Founders:** FT20/30 teams of 2-4. FT10 students join as staff, customers and small investors. A student is on at most one founding team per season.
- **Customers:** town NPCs (simulated demand) plus classmates, who pay with in-game money.
- **IPO:** after a minimum track record, the team pitches at the Amphitheatre and the world teacher approves the listing, the price and the share count.
- **Payroll (changed 2026-10-23, after the 4b sim showed student companies can afford only 10-20 staff hours a month):** a business job is **part-time paid hours on top of** the student's job-board job (10-40 hours a month), paid from the treasury with its own pay stub. *Originally:* a business job replaced the job-board job. A student holds one job: either a catalogue job, with wages minted by the town, or a business job, with wages paid from the business treasury. Both use the same T4127 pay stub. A business that can't make payroll must lay people off.

## Registry (4a)

**Founding a company:**
- A founder (FT20/30, in a class whose course has `ventures`) registers it with:
  - a name: pseudonymous, 3-40 characters, checked against a short blocklist; the teacher can rename;
  - a sector, chosen from the town sectors the exchange already uses;
  - a one-paragraph plan: what it sells, to whom, at what price, and its break-even;
  - 1-3 co-founders, invited by username in the same class; they accept in their own panel.
- Registration needs the teacher's approval (`/approve`), like a promotion.

**Founder equity:**
- Founders split 100% of the equity at founding, by agreement.
- Each founder confirms the split. The default is equal.
- Shares are integer micro-units, as on the exchange.

**Treasury:**
- The company gets a business ledger account `ventures.treasury` (owner_type 'business').
- Founders capitalise it from chequing: each puts in at least $100. This is equity, recorded on the cap table.
- The treasury resets at season close like any account. The company's net value counts toward the founders' net worth (see Net worth).

**Limits:**
- One active company per founding team.
- A company can be dissolved by unanimous founders or by the teacher. Any treasury cash left is paid out to shareholders pro rata, then the account is closed.

## Products and NPC demand (4a)

**Products:** each company sells up to 3 products. For each one the team chooses:
- a unit cost, from a sector cost table with materials and time (config, with the source noted, ILLUSTRATIVE);
- a price;
- a monthly production quantity.

Production is paid from the treasury when the month starts.

**NPC demand** (world tick):
- Quantity demanded per product follows a linear demand curve per sector: `Q = max(0, a − b·P)`.
  - `a` (town size) scales with the number of students in the world.
  - `b` (price sensitivity) is per sector; elastic sectors (restaurants) have a high `b`, inelastic ones (convenience) a low `b`.
- Demand is split among competing companies in the same sector, weighted by price and a small "reputation" (on-time payroll, delivered orders).
- Units sold are `min(produced + inventory, demand share)`. Revenue is minted into the treasury (the NPCs are outside the town), plus GST if registered (see Tax).
- Unsold units carry over as inventory and lose a per-sector spoilage share each month.
- A seeded draw from the world secret adds noise (±10%), so prices teach elasticity, not luck.

**Classmates:**
- Students can buy a company's products from its storefront panel with chequing or the card.
- These are real ledger transfers: player → treasury.
- What a classmate buys is a cosmetic item: it shows on the avatar or home, through the Outfitters `grantItem` service if Outfitters is enabled, otherwise as a receipt line.
- Price-gouging limit: at most 3× unit cost.

**The panel shows:**
- each product's demand curve, with the team's price on it;
- last month's units sold, revenue, cost and margin;
- a break-even calculator.

## Statements (4a)

Each world month the module writes the company's statements from its own ledger postings and tables:
- **Income statement:** revenue, cost of goods sold, wages, interest, tax, net income.
- **Balance sheet:** cash, inventory at cost, loans, equity. It must balance; a test checks this.
- **Cash flow:** operating, financing.

Statements are visible to:
- founders: full;
- shareholders after the IPO: full;
- the teacher: full;
- everyone: a public summary (revenue band, profitable yes/no) on the Venture Row board.

A "journal" view lists every posting with its kind, for FIN1015.

## Payroll (4b)

**Hiring:**
- A company posts a job with a title, an hourly wage of at least the Alberta minimum used by jobs, and hours.
- A student applies from the job board. Business jobs are listed alongside catalogue jobs.
- A founder approves the hire.
- On hire, the business job is added **on top of** the student's catalogue job, which never ends: part-time, 10-40 hours a month, at most 2 company jobs and 40 hours in all (see Decisions; built in 6c, docs/phase6-roles.md "As built (6c employers)"). Jobs pays each job through its own payday, each with its own stub, calling the `ventures.payroll` service for business jobs.

**Paying wages:**
- Gross comes from the treasury, not the mint.
- Deductions follow T4127 exactly as now, and the employer share of CPP and EI is also paid from the treasury. CPP employer = employee; EI employer = 1.4 × employee (cite CRA).
- Pay stubs are identical to today's.
- If the treasury can't cover gross plus employer costs at payday:
  - pay is skipped for that month;
  - the student gets a `module.jobs.unpaid` notice;
  - the company's reputation drops;
  - after 2 missed paydays the Job Centre tells the student they may quit that job (they may quit a company job at any time; their catalogue job was never left, so there is nothing to "go back" to).
- Founders can also pay themselves wages. They are employees like anyone else.

**Layoffs:** a founder can end a job with one month's notice, or immediately with one month's wages as severance.

## Small business tax (4b)

**Income tax:**
- A company with net income pays tax at year end (the first tick of each world year).
- The rate is the 2026 combined small business rate for a Canadian-controlled private corporation in Alberta: federal 9% + Alberta 2% = **11%** on active business income. Cite CRA and Alberta TRA; mark ILLUSTRATIVE if a page can't be read.
- Losses carry forward and offset later income.

**GST:**
- Registration is optional until revenue in the last 4 world quarters passes the $30,000 small-supplier threshold (cite CRA), then mandatory.
- A registered company charges 5% on sales, claims input tax credits on production costs, and remits quarterly.
- The panel shows the GST return.

**The tax slip:** a mini T2 schedule showing net income, losses applied, taxable income, tax, and GST collected, credited and remitted.

## Loans (4b)

- The **Venture Bank** (in the Council scene with the bank) lends to a company.
- The amount is up to 3× trailing 3-month average revenue, or $5,000 for a new company with an approved plan.
- The rate is policy + a spread (config) and the term is 12-36 world months, amortised monthly.
- Payments come from the treasury.
- A missed payment means a late fee and reputation loss. After 3 misses the loan defaults: the company is frozen (no new production) until the teacher resolves it.
- Founders' personal credit is not touched; the company is a separate legal entity. That is the lesson.

## Equity and IPO (4c)

**Cap table:**
- Shares are held in `ventures_shares (business, holder player, units)`.
- Before the IPO, founders can sell shares privately to classmates through offer → accept, with cash player → player. Both sides confirm. The teacher sees every private sale.

**IPO gate:** the company needs a track record:
- at least 3 consecutive profitable world months;
- statements published each month;
- no missed payroll in the last 3 months;
- at least 2 shareholders or employees.

The team then requests an IPO with a proposed share count and price per share.

**Pitch:**
- The request shows up at the Amphitheatre as a "pitch night" card: the plan, the statements and the ask.
- The world teacher approves, adjusts the price or count, or declines with a note.
- On approval:
  - exchange `listSecurity` lists the ticker (4 letters, unique);
  - new shares are sold to the public through the market maker at the IPO price, and the proceeds go to the treasury;
  - founders keep their existing shares, now tradable.
- The market maker quotes the stock with the normal 1% spread.

**Price after the IPO:**
- The town stock model applies, with the company's fundamentals as a drift tilt: trailing earnings growth and margin, capped.
- So good management shows up in the share price, but markets stay noisy.
- Student-to-student order matching is still not used; the market maker is the counterparty. This is documented, and matching is a Phase 6 item if the order book needs it.

**Dividends:**
- The board (founders, by majority) can declare a cash dividend per share from retained earnings.
- It is paid from the treasury to every holder on the exchange: TFSA, RRSP, non-registered, the same flows as town-stock dividends.

## Net worth and leaderboards

- A founder's or shareholder's stake counts toward net worth.
  - Before the IPO: book value, which is the holder's share of (treasury + inventory at cost − loans).
  - After the IPO: exchange holdings already count; unlisted founder shares count at the last price.
- These come through `seasonAssets` (business stakes owned by players) and the `module.exchange.value` path.
- At season close, companies are wound up in the same transaction (`seasonClose`): open loans are settled from the treasury, shareholders are paid out pro rata, and the business accounts reset.
- New awards:
  - **Founder of the Season**, for the highest company value;
  - **Best Employer**, for on-time payroll and the most staff.

## Teacher

- **Approvals:** registrations, hires (optional setting), IPOs.
- **Oversight:** rename a company, freeze it, dissolve it, see all statements and private sales.
- **Settings:** demand parameters per sector (world teacher), the loan spread, the IPO track-record rules.
- **Class view:** a list of companies with their revenue, staff, payroll status, loans and tax.

## Simulate

- 30% of FT20/30 bots form teams of 2-3 and register, pricing near the demand curve's revenue-maximising price plus or minus noise.
- 60% of FT10 bots accept business jobs when offered.
- Some companies borrow, and a few IPO when they qualify (bot teacher approves).
- The sim reports, at months 12, 24, 36, 48 and 60:
  - the number of companies;
  - the median margin;
  - the share of students employed by companies;
  - missed payrolls;
  - defaults;
  - IPOs;
  - the change in Gini.

## Gates (each wave)

- `npm test` three times.
- Both 60-month sims audit OK every month, and the economy guard still holds (Gini < 0.40, bills/pay 50-75%, homeowners 20-50%).
- Perf thresholds hold.
- Tests for each rule above, especially:
  - the balance sheet balances;
  - payroll from the treasury, with employer CPP and EI;
  - a skipped payday when the treasury is short;
  - tax with loss carry-forward;
  - the GST threshold;
  - loan amortisation and default;
  - the IPO gate;
  - dividend flows to TFSA, RRSP and non-registered accounts;
  - season wind-up;
  - teacher B isolation;
  - FT10 can't found a company.

## As built (4a)

`modules/ventures` (index.js, constants.js, demand.js for the pure maths, ui/ventures.js + ventures.css, ui/teach.js), test/ventures.test.js. Building **Venture Row** (key `venture-row`, core icon `registry`), drawn on the Agora scene (the market hall, PLAN.md; `public/theme.css`).

**Decisions:**
- **Enabled for both courses; founding is FT20/30 only** (`FOUNDING_COURSES = ['fintech2030']`). FT10 students see Venture Row and buy from the storefronts (they are never FT20/30 students' classmates, so storefronts are **town-wide**: any student in the world can buy from any open company). A FT10 student registering gets a 403 that says so.
- **Flow:** register (name, sector, plan, 1-3 co-founders from the same class) → `forming`; each invitee accepts (accepting = agreeing to the current split) → when everyone has accepted and confirmed, `pending` → the teacher approves (`POST /api/ventures/approve`; the world teacher, or a teacher of the company's class: `class.manage`) → `approved` (the cap table is written from the split and the treasury opened) → each founder puts in capital; when every founder is in for at least $100 in all, `active`. Declining an invite re-splits equally among those left; if every co-founder declines, the registration is cancelled. The registrant can withdraw a forming or pending registration. A teacher decline frees the team to register again.
- **One team a season:** a student is "on a founding team" while they are an accepted member of a company that is forming, pending, approved, active, frozen, dissolved or wound up in this world (cancelled and declined registrations do not count). So a team has at most one company, and a dissolved company's founders cannot found another that season.
- **Split:** 1,000 founder shares (`FOUNDER_UNITS`, micro-units as on the exchange), equal by default (remainder micro-units to the first members); the registrant may propose whole percents in team order, and everyone else confirms again. Capital does not change the split (it is "by agreement"); the cap table shows both. Private sales and the IPO are 4c and will write to `ventures_shares`.
- **Names:** `^[A-Za-z0-9][A-Za-z0-9 &'.,!-]{2,39}$`, unique per world (case-insensitive), a short blocklist of whole words and a few roots; the teacher renames.
- **Products:** 3 product types per sector (24 rows in constants.js), each with materials + minutes (time at Alberta's $15.00/h minimum wage, alberta.ca/minimum-wage) and a demand row (a per 100 students, choke price). Materials, demand and spoilage are ILLUSTRATIVE. Unit costs and choke prices follow the world price index. A company sells at most 3 (one of each type). The **3 x unit cost price cap applies to every sale** (one price for town and classmates), checked when the price is set and again at a classmate purchase.
- **Demand:** `Q = max(0, a - b·P)` per product type with a = a100 × students/100 × the teacher's a multiplier, b = (a100 × students/100) / choke × the teacher's b multiplier. **b scales with the town too** (unlike the literal "b per sector"): otherwise a bigger town would also have a higher choke price, and prices would not mean the same in a 30-student and a 300-student world. The teacher's per-sector settings are multipliers of a and b (25% to 400%). Competition is per product type: each seller would sell d_i = Q(P_i) alone, and gets d_i × w_i / Σw with w_i = d_i × reputation_i. Noise ±10% per product per month from sha256(world secret, month, product id) (`ventures_secrets`). Reputation (5000-15000 bp) loses 300 in a month with unmet town demand and gains 100 in a month that delivered every order (on-time payroll joins it in 4b).
- **The month:** the tick into month m sells month m-1's town demand from stock, spoils part of what is left (per sector: services 100%, restaurants 75%, food and drink 40%, convenience 3%, clothing 2%), writes month m-1's statements, then pays month m's production from the treasury (a run the treasury cannot pay is **skipped** that month, with a note on the product and in the statement; setting a quantity is never refused, the panel warns). A product added during a month first sells in the month after its first run. Frozen companies: no production and no sales, spoilage and statements continue.
- **Statements** are built from `ventures_flows` (per company, product and month) and the treasury balance, and stored (`ventures_statements`), so a month's books never change. Balance sheet: cash + inventory at cost = share capital + retained earnings − distributions (no loans yet); cash flow: opening + operating (sales − production paid) + financing (capital − payouts) = closing. Each statement carries `balanced` and `reconciled`; tests assert both, and the sim reports any that fail (0 in every run). Inventory uses weighted average cost; the last unit carries the rounding, so cost leaves inventory exactly. Wages, interest and tax lines are 0 until 4b.
- **Journal:** the treasury's ledger postings, each with its kind and the accounting entry it stands for (`JOURNAL` in constants.js: capital = Dr Cash / Cr Share capital, production = Dr Inventory / Cr Cash, ...). Inventory moves are not cash and are in the statements, not the journal.
- **Visibility:** founders and a teacher who may act on the company get the full view (`GET /api/ventures/company/:id`, and `mine` in `/state`); everyone gets the public summary on the board (revenue band of the last statement, profitable yes/no). Teacher B gets 404 on another class's company, 403 on sector settings, and their console lists only their own classes.
- **Storefront:** one unit per purchase, chequing or card (the card limit kept from `module.credit.limit`, as outfitters does), refused from your own company and when sold out. The buyer gets the Outfitters item for the company's sector through the new outfitters **`grantItem` service** (8 "Venture Row" items, `unlock = 'venture'`, never for sale, price 0, no resale to the mint, owned once per season, so a second purchase in a sector is a receipt only); without outfitters, a receipt line only. The outfitters seed migration still seeds the old list (its checksum is unchanged); the catalogue upsert adds the 8 items at boot.
- **Dissolve** (an active company): unanimous founder votes (`/vote-dissolve`, a vote can be taken back) or the teacher. Stock is written off (spoilage), the treasury is paid pro rata by shares (floored, leftover cents to the largest holders; BigInt so cents × micro-units never loses precision), and a final statement closes the books at zero. The account stays open at $0 (the ledger has no close).
- **Season close:** the core zeroes every account *before* `seasonClose` runs, so the wind-up pays out through **`seasonAssets`**: each holder's stake (their share of treasury + inventory at cost) is added to their season result; `seasonClose` then marks the companies `wound_up` (records the value) and cancels anything still forming or pending. The treasury goes to the sink in the core reset; nothing carries into the next world (the sim's `--teacher` check covers companies and business balances).
- **Net worth:** `module.ventures.value { playerId, worldId, stake, companyValue, company }` (in the tick per shareholder; after commit on capital, a sale, a dropped product, a dissolution). Leaderboards adds `stake` to net worth (migration 003, `ventures_value`) and awards **Founder of the Season** to the founder of the company with the highest book value (ties to the bigger stake). The sim adds stakes to net worth for its Gini. Savings' net worth line does not include stakes yet.
- **Balance hints:** `ownersOf` returns a company's accepted founders and shareholders.
- **Bots:** in their first month, 30% of FT20/30 bots form teams of 2-3 per class (4 → 2 + 2), the bot teacher approves, each puts in $150, and they sell 1-3 products priced at the revenue-maximising price ±15% (within the cap); each month they make last month's demand +5% less the expected leftover, within the treasury. 20% of all bots buy a unit now and then (from chequing, keeping $1,500). `--teacher` adds the world teacher raising Food and drink town demand to 120% in month 26.

**Fix round 1 (after the independent verification):**
- **Town demand only goes to stock.** Only products with units on hand compete (`townDemand` in index.js, `allocate` in demand.js); each is capped at its stock and what it cannot supply flows to the others in proportion to their shares (mostly to the town shop). Listing a product at 1 cent with no stock takes nothing; with one unit it takes that unit. `demand_units` (and reputation) use what a product would have sold with unlimited stock, counted only for products that have had a paid production run, so a product nobody has made yet costs no reputation.
- **The town shop (NPC incumbent).** Every product type has the town's own shop in the market: never sold out, priced at 40% of the choke price (`INCUMBENT_REF_BP`, ILLUSTRATIVE), a seller in the same share formula. Pricing under it wins most of the town; over it, little. The panel draws it on the demand curve and the Sectors tab lists it.
- **Storefront rent** is $50 a month (`RENT_CENTS`, ILLUSTRATIVE) times the price index; `options.ventures.rentCents` overrides it. (Round 1 first scaled it with the school, 17 cents a student with a $10 floor; the paused WIP e2ab884 made both demand and rent independent of the school, see "Fixed town" below.) Paid from the treasury at each month start, before production; an income-statement line and an operating cash outflow. Unpaid two months in a row: the company is frozen (the teacher unfreezes it; that resets the count). Rent is not accrued as a liability: a missed month is simply missed.
- **Storefront caps:** a buyer may spend at most $100 a world month at one company and $250 on Venture Row (`storePerCompanyCents`, `storePerMonthCents`), so a storefront is no way round a class's transfer settings. The remaining allowance is shown on the storefront.
- **Leaving before the company opens:** any founder may leave a forming, pending or approved company (`/leave`): the split goes back to equal for those left, and in an approved company their capital comes back to them exactly (kind `refund`, treasury -> chequing; share capital falls by it) and the cap table is re-split equally. Fewer than 2 left: cancelled. Once the company is active, leaving is a share sale (4c).
- **A company that never opened refunds capital, not shares:** withdrawal, a teacher dissolution and the season close give each founder exactly the capital they paid in (status `cancelled` for the first two, so the team may found again). Founders who have paid in may remove one who has not, from 2 world months after approval (`/remove`).
- Duplicate co-founder names that differ only in case are one invite (was a 500); a storefront sale nudges the company's class console too; `seasonAssets` and the stakes use the same exact pro-rata split as a dissolution (every cent of the company reaches someone); the public board says "in stock" / "sold out", never the count.
- Bots price near the revenue-maximising price against the town shop (±15%), make last month's demand +15%, and keep two months of rent in the treasury.

**Fixed town (WIP e2ab884, merged in 6c).** Town demand is a fixed NPC town of 300 residents (`TOWN_SIZE`, `options.ventures.townSize`), not the school: a = a100 x residents / 100 x the teacher's multiplier, whatever the class sizes, so a bigger school means more companies splitting the same town. The town's own shop stays always open at 40% of the choke price, and rent is the fixed $50 x the price index. The table below is from before that change; the rerun on the merged code (one row: every school now sees the "300" economics) is in docs/phase6-roles.md "As built (6c employers)".

**Balance (what a well-run company earns).** A lone company selling all 3 of its sector's products at the profit-maximising prices, before spoilage, per founder in a team of 2, as a share of the sim's median net pay ($2,409 at month 36). Best sector Convenience retail, worst Restaurants, at every size:

| Town | 4a as first built (monopoly, no rent) | Round 1 (town shop + fixed $50 rent) | Now (town shop + 17 cents a student rent, $10 floor) |
|---|---|---|---|
| 30 students | $118 (4.9%) / $65 (2.7%) | $27 (1.1%) / −$4 (−0.1%) | $47 (2.0%) / $16 (0.7%) |
| 100 students | $393 (16.3%) / $220 (9.1%) | $149 (6.2%) / $55 (2.3%) | $166 (6.9%) / $71 (2.9%) |
| 300 students | $1,184 (49.1%) / $661 (27.4%) | $498 (20.7%) / $214 (8.9%) | $498 (20.7%) / $213 (8.9%) |

Tuned for the 300-student town (best 15-25%, worst break-even to 10%). With demand and rent both proportional to the student count, a company's profit is proportional to the town, so no town size runs at a loss any more. But the percentages are not the same at every size: a 30-student town is a tenth of the market, so a company there earns a tenth as much against the same median pay. To give a small world the 300-student economics per company, the world teacher can set a sector's town demand and price sensitivity both to the same multiple (a and b x 300% makes a 100-student town's demand curves those of a 300-student town).

**Gates (4a, after fix round 1):** `npm test` 3 × 435/435. `npm run sim -- --months=60` (300 bots) and `--teacher`: audit OK all 61 months, no statement fails to balance, the economy guard holds (bills/pay 69% → 57%, homeowners 31% at month 60, owners in arrears 0%), season close starts clean.

| Month | Companies open (founders) | Median margin | Revenue (all, last month) | Gini | Founders in the Town board top 10 |
|---|---|---|---|---|---|
| 12 | 13 (36) | 25.9% | $3,685 | 0.307 | 3 |
| 24 | 8 (24) | 24.4% | $5,169 | 0.335 | 3 |
| 36 | 8 (24) | 20.5% | $4,748 | 0.318 | 2 |
| 48 | 7 (21) | 20.1% | $5,045 | 0.325 | 2 |
| 60 | 7 (21) | 19.2% | $4,845 | 0.333 | 2 |

(`--teacher`: Gini 0.309 / 0.336 / 0.311 / 0.308 / 0.315; 1 founder in the top 10 at month 60.) Companies drop from 16 to 7-8 because bot teams in weak or crowded sectors (two restaurants, three clothing shops) lose money, miss rent and are frozen; the strong ones stay open. Founders are 7% of the town and 10-20% of the Town board's top 10 at month 60: ahead, not dominant. For comparison, the same default sim before ventures had Gini 0.308 / 0.337 / 0.318 / 0.323 / 0.331. `node scripts/perf.mjs payday=500 month300=1000`: payday 181 ms, month300 668 ms.

**Seams left for 4b/4c:** `ventures_shares` (the cap table) for private sales, the IPO (`listSecurity` with `ownerBusinessId` = the company id) and dividends; the statement already has wages, interest and tax lines and a loans line on the balance sheet; reputation is one column to which payroll punctuality can add; the teacher view has staff/payroll/loans/tax columns at their 4a values.

## As built (4b)

*Superseded in part by 6c (docs/phase6-roles.md "As built (6c employers)"): a business job is now part-time **on top of** the catalogue job, never instead of it. The bullets below marked (4b only) describe the branch as first built: one job per student, `leave()` ending both, `POST /back`, the season close restoring the old job, the bots' "go back" exit. 6c replaced each of them.*

`modules/ventures` (a 4b section in index.js, 4b constants in constants.js, loan and tax maths in demand.js, Staff / Tax / Venture Bank cards in ui/ventures.js, settings, hire approvals and default resolution in ui/teach.js), `modules/jobs` (business jobs, migration 005, three services, the board and `POST /back` in ui/jobs.js), `modules/leaderboards` (Best Employer, migration 004), test/ventures-4b.test.js.

**Payroll:**
- (4b only) **One job per student, two tables.** A business job lives in `jobs_business` (player, business id, employer name, title, wage, hours 10-160, missed paydays, notice); a catalogue job stays in `jobs_holdings`. `leave()` ends both, so taking a catalogue job ends a business job and vice versa. Jobs exposes `hireForBusiness`, `endBusinessJob` and `staffOf`; ventures never reads a jobs table and jobs never reads a ventures table (they call each other's services).
- **Pay stubs:** `jobs_paystubs` was rebuilt (migration `005_business`): `job_id` is NULL on a business stub, which carries `business_id` and the employer's name, and `kind` ('pay' or 'severance') joins the unique key so pay in lieu of notice can share a month with the regular pay. The stub view is unchanged (same fields); the employer line shows the company.
- **Payday:** jobs computes the same T4127 stub and the employer's share (`employerShare` in payroll.js: CPP = the employee's CPP + CPP2; EI = 1.4 x, CRA pages cited there), then calls ventures `payroll`, which posts ONE transaction `ventures.payroll`: treasury -(gross + employer CPP + EI), employee chequing +net, sink +(deductions + employer share). Nothing is minted. A business pay emits `module.jobs.paid` like any pay.
- **Books:** jobs ticks before ventures, so the pay at the tick into month m is month m-1's work and goes on month m-1's books (written later in the same tick); if those books are already closed it goes on month m's. Pay in lieu of notice goes on the current month.
- **A short treasury:** (the `/back` part is 4b only; 6c: `POST /quit-business`) no pay, no stub, `missed` + 1 and a note on the job, `module.jobs.unpaid` after commit, company reputation -500 per missed pay, `missed_paydays` + 1. From 2 missed paydays `/api/jobs/catalogue` offers `old_job` (the latest `jobs_past` row) and `POST /api/jobs/back` restores it at the wage it was left on, however long ago (the 12-month rehire window does not apply here).
- **Hiring:** a founder posts a job (title, wage >= Alberta's $15.00, 10-160 h/month; at most 3 open postings, 10 staff); students see `GET /api/ventures/openings` on the Job Centre board (town-wide, like the storefronts: FT10 students are in other classes) and apply; a founder hires. With the world teacher's **hire approval** on, the founders' yes waits for a teacher (`/hire-approve`). Founders can hire themselves.
- **Layoffs:** `notice` (the next payday is the last; `ends_month`), or `severance`: now, one month's wages as a 'severance' stub. Pay in lieu of notice is employment income for CRA (CPP, EI and tax deducted, the employer's share paid), so it is a normal stub; refused (409) when the treasury cannot pay it. Dissolving a company ends its jobs with no pay (a simplification: wages owed are not ranked ahead of shareholders).
- (4b only) **Season close:** jobs puts every company employee back on the catalogue job they left (entry wage, like everyone) and clears `jobs_business`. 6c: it only clears `jobs_business` (the catalogue job was kept).

**Small business tax:**
- **Income tax:** at the tick into the first month of each world year, each company's net income for the 12 months just ended (from the flows: revenue - COGS - spoilage - wages - employer share - interest - late fees + forgiven loans) is taxed at 11% (`TAX_FEDERAL_BP` 900, read from CRA's corporation tax rates page; `TAX_ALBERTA_BP` 200, ILLUSTRATIVE: alberta.ca's corporate income tax page gives the $500,000 threshold, not the rate). A loss goes into `loss_cf_cents` and is applied first against the next profit. The tax is on the last month's books; it is paid from the treasury at the same tick as far as it goes, and the rest is "income tax owed" (a liability, paid at later ticks). `ventures_tax` is the mini T2.
- **GST:** voluntary registration (`POST /gst`) charges from the next month; at each world quarter's end, sales over the last 12 months past $30,000 make it mandatory from the month after next (CRA's four-quarter rule; the single-quarter rule is not modelled). A registrant charges 5% on town sales (minted with the sale) and classmate sales (the buyer pays price + GST; the 3 x price cap is on the price before GST), and pays 5% on production (an input tax credit; if the treasury cannot pay it there is no credit). The quarter's return (`ventures_gst`: sales, collected, ITCs, net) is filed at the next tick and remitted (or refunded from the mint) from the treasury. Town demand responds to the price before GST.

**Loans (the Venture Bank):**
- Up to 3 x the trailing 3-month average revenue (= the 3 months' sum), or $5,000 for a company with fewer than 3 statements; at least $100; 12-36 months; one loan at a time; rate = policy (from `module.rates.changed`, else rates' `POLICY_BP`) + the spread (300 bp default, `options.ventures.loanSpreadBp`, or the world teacher's setting). Interest compounds monthly at rate/12 (a business term loan; the Interest Act's semi-annual compounding is for mortgages, so housing's `payment()` is not reused). The final payment clears the balance.
- The loan is the business `loan` account (allow_negative): disbursement loan -P / treasury +P; a payment treasury -due / loan +principal / sink +interest (`ventures.loan_payment`). The first instalment is at the tick after borrowing.
- A missed payment: the month's interest and a $50 late fee (ILLUSTRATIVE) are added to the loan, reputation -300; the third miss is a **default**: the loan stops collecting and the company is frozen (no production or sales; payroll still runs) until a teacher resolves it: **forgive** (written off: loan +, mint -; a gain on the income statement), **restructure** (a new 12-36 month term on what is owed, at today's rate) or **dissolve**. A defaulted company cannot be unfrozen with `/freeze`. The founders' own accounts are never touched.

**Statements:** the income statement adds employer CPP and EI, late fees, a forgiven loan, income before tax and income tax; the balance sheet: cash + inventory = loan + GST payable + income tax owed + equity (`balanced`, every statement, every sim month: 0 failures); the cash flow: operating (sales and GST collected, less production, GST paid, wages, employer share, interest paid, taxes and GST remitted) and financing (capital and loans in, less principal repaid and payouts).

**Net worth and the season:** book value = treasury + inventory - loan - GST payable - tax owed (taxes owed are liabilities too), never below 0 for a stake. At season close `seasonAssets` takes the stakes first, then settles the loan and taxes owed from the treasury (`ventures.loan_settle`); the core reset takes what is left. Dissolution pays the loan and taxes from the treasury first, writes off the rest of the loan, then pays shareholders. **Best Employer:** the founder or shareholder of the company with the most staff and no missed pay this season (ties: more on-time pays, then company value), from `module.ventures.value { staff, paydays, missedPaydays }`.

**Teacher:** `/finance-settings` (world teacher: the spread, hire approval), `/hire-approve`, `/resolve` (a class's teacher or the world teacher), the class view's staff / payroll / loans / tax columns (staff count, pays made and missed, loan owed and status, tax paid and owed). Teacher B gets 404 on another class's hires and loans and 403 on the settings.

**Bots:** a bot company with 3 statements and a positive average net income: every third borrows once (up to $2,000 over 24 months), and it hires 1-3 staff at $16.00/h for the hours 60% of its average net income pays (10-80 h) while the treasury holds 3 months of payroll; one losing money gives notice to its newest hire. 60% of FT10 bots accept (once a season). Production keeps next month's payroll and loan payment back. A bot whose company job does not cover its bills (chequing under $500), or whose company missed 2 pays, goes back to its old catalogue job. Without that exit, bots that swapped a $2,000 catalogue job for a $170 company job sank $20,000-$30,000 into debt and Gini passed 0.40: **company revenues (about $1,300 a month each) cannot pay a living wage**, so company jobs are short part-time trials in the sim. That is a balance question for Mr. Tang (see deferred).

**Gates (4b):** `npm test` 3 x 440/440. Both 60-month sims (300 bots) audit OK all 61 months, every statement balances, the economy guard holds; `--teacher`: season close starts clean.

| Month | Gini default (4a) | Gini `--teacher` (4a) | Employed by companies | Pays made / missed | Loans (defaults) | Income tax paid | GST remitted |
|---|---|---|---|---|---|---|---|
| 12 | 0.324 (0.311) | 0.315 (0.303) | 11 (3.7%) / 7 (2.3%) | 35 / 0, 52 / 1 | 5 (0) | $0 | $0 |
| 24 | 0.359 (0.339) | 0.345 (0.326) | 6 (2.0%) / 1 (0.3%) | 130 / 0, 145 / 1 | 5 (0) | $5,361 / $5,619 | $676 / $465 |
| 36 | 0.341 (0.322) | 0.319 (0.317) | 1 / 0 | 179 / 0, 148 / 1 | 5 (0) | $12,092 / $14,245 | $2,794 / $2,247 |
| 48 | 0.345 (0.325) | 0.313 (0.306) | 1 / 0 | 191 / 0, 148 / 1 | 5 (0) | $20,367 / $25,706 | $4,894 / $4,070 |
| 60 | 0.345 (0.330) | 0.313 (0.307) | 1 / 0 | 203 / 0, 148 / 1 | 5 (0) | $29,655 / $37,098 | $7,006 / $5,911 |

(Pairs are default / `--teacher`.) Bills/pay 69% → 57% (default) and 69% → 55%; homeowners 31% / 33% at month 60, owners in arrears 0%. Companies 16 (43 founders) / 15 (42), median margin 37%. Gini is 0.01-0.02 above 4a: the few months bots spend on part-time company jobs. `node scripts/perf.mjs payday=500 month300=1000`: payday 133 ms, month300 519 ms.

**Deferred:**
- Balance: company revenue cannot fund a full-time wage, so a company job is a pay cut for nearly everyone. Options for Mr. Tang: let staff hours replace the bought-in "time" part of unit cost (so hiring saves production cost), allow a part-time company job alongside a catalogue job, or raise town demand. **Decided 2026-10-23 and built in 6c: part-time on top of the catalogue job.**
- No raises or promotions on business jobs (the founders set the wage; a new posting is the way to pay more). Wages owed are not ranked ahead of shareholders on dissolution. GST's single-quarter $30,000 rule; GST deregistration; instalments of income tax; the small business limit ($500,000) is never reached.
- The Venture Bank lives on the Venture Row panel, not yet in the Council scene.
