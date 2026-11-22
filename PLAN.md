# vDAA (virtual Dr. Anne Anderson): plan

## Decisions (2026-10-21)
- **Name:** vDAA, the virtual Dr. Anne Anderson. Site: `vdaa.michaelhtang.com`.
- **Pilot:** Semester 2. It's built module by module alongside the course plan, so each unit's building opens when that unit starts.
- **Approval:** this is a locally developed tool for Mr. Tang's own course, so there's no approval stage for the pilot. It stays privacy-by-design anyway: pseudonymous PIN accounts, no names or emails stored.
- **Budget:** $0. The pilot runs on the existing GCP VM behind Cloudflare.
- **Separate from TradeLab and STAX North.** Those are in-class simulations. vDAA is the persistent world where students actually invest, with its own exchange.

### Who's in the Semester 2 town
- **Mr. Tang teaches mostly FinTech 20/30.** They're the entrepreneurs, investors and analysts: business registry, financing, the exchange, registered accounts, small business tax.
- **A colleague teaches FinTech 10.** They're the workers, renters, customers and first-time savers: payday, budgets, banking, credit, housing.
- So the teacher console supports **several teachers**, each owning their own classes, with Mr. Tang as admin. The colleague's classes need zero setup: PIN cards, the day's quest, done.
- Build order follows both course plans. Payday and the Business Registry come first, because FT10 needs jobs and FT20/30 need to be the employers.

### Look and feel: a WoW-style adventure in a pixel-art world
The reference is a pixel-art fantasy scene screen:
- **Scenes:** full-bleed pixel-art scenes at dusk (purple, magenta and orange) for each zone.
- **Panels:** dark translucent glass with thin light borders.
- **Text:** a huge heavy display headline, plus small-caps labels with a sparkle.
- **Money:** a gold coin counter as the hero number. Amounts are always real CAD.
- **Controls:** pill buttons for sound and full screen.
- **Mascot:** a guide character in the corner.

World of Warcraft ideas mapped to the course:

| WoW idea | vDAA |
|---|---|
| Zones | districts that unlock by unit (Payday Square, Credit Quarter, Harbour Exchange, Venture Row, Tax Keep) |
| Quest givers with "!" | townspeople who hand out the day's lesson quest |
| Professions | careers and jobs (from ALIS) |
| Guilds | FT20/30 businesses, with a guild bank as the company treasury |
| Auction House | the exchange and marketplace |
| Reputation with factions | credit score and standing with the Bank, Landlords and Tax Office |
| Raids | cross-class events (recession, market crash) that need several blocks to work together |
| Mailbox | job offers, contracts and bills |
| Hearthstone | home |

Achievements, levels and XP follow outcome codes.

**The town is DAA itself, reimagined as a fantasy city:**

| Real place | vDAA |
|---|---|
| Front entrance (charcoal cladding, white sign band, warm wood soffit) | the town gate: login and welcome screen |
| **The Agora** (the great central column ringed by timber poles, where FinTech Marketplace businesses set up tables) | the **town square and market hall**: FT20/30 business stalls, the auction house, today's news. The heart of the map |
| Library with the living wall, flanked by the second-floor staff connectors | the **Archive**: quest board, codex (Learn), achievements |
| Staff connectors (glass bridges above) | **Council Chambers**: Tax Keep, Bank governor, Mr. Tang's console |
| Mixer stairs (lime and yellow cushions; orange and red ones on the other stair) | the **Amphitheatre**: leaderboards, pitch nights for IPOs, event announcements |
| Gym | the **Arena**: class-vs-class events (market games, "raids") |
| The 2000 (green) and 2300 (purple) wings | districts coloured by wing: housing, Job Centre, Credit Quarter |

- **Mascot:** an original pixel-art **DAA Wolf**. Royal blue and white fur, ice-blue eyes, a white jersey with light-blue stripes, drawn from the school mascot. It's the guide in the corner of every screen: it hands out quests, cheers milestones, and gets new outfits as you level.
- **Palette:** "Wolves at aurora".
  - Royal blue #1F3FA6, ice blue #7FD3F7, snow white, night navy glass #0E1630.
  - Honey wood #D9A86C for the glulam beams, gold #F5C451 for coins.
  - Accents: lime #B5D334 (mixer stairs), ember #F26B3A (orange cushions), green-violet northern lights.
  
  It keeps the dusk-scene feel of the reference, but in DAA's blues under an Alberta night sky.
- **Respect:** the Agora's central structure honours Indigenous design, and the school is named for Dr. Anne Anderson, a Métis Cree educator. Depict the space respectfully as the school's gathering place, never as a game prop, and check the art with the school's Indigenous education lead before launch. **Status (2026-10-22):** the photoreal Agora scene (public/art/scenes/agora-*.webp, from design/scenes/agora-7201 and its day twin) is now the home-screen background; it has not yet been reviewed by the Indigenous education lead, which must happen before students see it.
- **Photos:** reference only. Student faces and photos never go into the game, and the EPSB logo isn't used.

All art, names and the mascot are original. Nothing is taken from WoW or any other game, and vDAA gets its own mascot and palette (a DAA-themed guide). The UI is themeable from the start (`public/theme.css`, `.scene`, `.glass`), so the art pass slots in. Light enough for Chromebooks, and honours reduced motion.

### Stack for the $0 pilot (replaces Supabase for now)
- **Server:** one zero-dependency Node 24 process using built-in `node:sqlite` (WAL), the same pattern as TradeLab. It runs as systemd `vdaa` on 127.0.0.1:3020 behind nginx and Cloudflare, with a proxied AAAA record for `vdaa`.
  - The VM had about 426 MB of free RAM, 2 GB of swap, 24 GB of free disk and a near-zero load on 2026-10-21. One more Node process (about 60–80 MB) fits.
  - SQLite has a single writer, so trades and payroll are applied one after another. That's what we want for a ledger and an order book, the same job a Durable Object would do.
- **Live updates:** Server-Sent Events, with no socket library.
- **Egress:** the free tier includes about 1 GB a month of outbound traffic from the VM. Static files are served with long cache headers so Cloudflare serves them, and API replies are small gzipped JSON.
- **Backups:** a nightly SQLite `VACUUM INTO` copy on the VM (`scripts/backup.mjs`, systemd timer, newest 14), plus `scripts/pull-backup.sh`, which Mr. Tang runs to pull a copy to the Mac; restore steps in `scripts/restore.md`.
- **Later:** if it outgrows the VM, the same schema moves to Supabase (Postgres) or Cloudflare D1/Durable Objects. Section 1 keeps that path.
- **Deploys:** like STAX North, `./deploy-vdaa.sh` run by Mr. Tang. Cloudflare DNS and certbot steps are his to run; the steps are given when we get there.

---

A persistent virtual town where every FinTech student has an avatar, a job, a bank account and a credit score, and can rent or buy a home, start a business, raise money and trade shares on a class stock exchange. Every system in the town teaches one part of the program of studies. Classes in different blocks share the same town and economy, so one block's businesses are another block's employers, landlords and investments.

Working name only. Pick the real one (and a town name) before Phase 1.

---

## 1. The two tools you asked about

*This is the original comparison, kept for the "later" path. The pilot does not use Supabase or Workers: it runs one Node process with SQLite on the GCP VM (see "Stack for the $0 pilot" and section 7).*

**Supabase** is a hosted Postgres database with the extras an app needs already wired in:
- sign-in (Auth);
- **row-level security**, so a student can only ever read or change their own rows;
- **Realtime**, which pushes a change, such as a new trade, to every open screen instantly;
- file storage;
- small server functions.

It's the "backend in a box" option. You write tables and a few SQL functions, and you skip writing and running a server. It has a Canadian region (ca-central-1). The free tier pauses a project after a week with no activity. The Pro plan is about $25 USD a month and doesn't pause.

**Cloudflare Workers** are small pieces of JavaScript that run on Cloudflare's network, close to the user, with no server to manage. Around them sit:
- **Pages**, for static sites;
- **D1**, a SQLite database;
- **KV**, a fast key-value store;
- **R2**, for files;
- **Durable Objects**: one stateful "room" that every request for that room goes through, one at a time. That suits an order book or a live town square.

Your domain's DNS is already on Cloudflare, so a site like `world.michaelhtang.com` is a few clicks. The free plan covers a class pilot comfortably. Check current limits before launch.

**Recommendation:** use Supabase for the system of record and Cloudflare Pages for the front end.
- Money is relational, and Postgres plus row-level security makes "nobody can mint money" enforceable in the database itself. It doesn't depend on the app code being right.
- Ten classes of 30 is tiny for Postgres. Order matching can be one SQL function inside a transaction.
- Add a Cloudflare Durable Object per exchange only if the town grows to many schools and the order book gets busy (Phase 6).
- Keep it off the GCP e2-micro. That VM is great for TradeLab and STAX, but a school-day app with live updates shouldn't share 1 GB of RAM with them.

Not on this stack: the game logic never calls Claude on a timer. AI is used at build time (quests, news copy, NPC lines generated in batches) and on demand only, in line with the no-usage-heavy-automation rule.

---

## 2. What students do (the core loops)

**Daily loop, about 5–10 minutes at the start or end of a work block:**
1. **Payday.** Gross pay, then federal and Alberta tax, CPP and EI, then net pay, on a real-looking pay stub.
2. **Bills.** Rent or mortgage, utilities, phone, groceries. Late payment hurts the credit score.
3. **Today's quest.** A short task tied to the day's lesson, for example "Your landlord offers a 2-year lease or month-to-month. Choose and justify," or "Calculate your mortgage payment before the bank shows it."
4. **Check the news ticker.** Rate changes, a company's results, a market event. Then react: buy, sell, save, refinance.

**Long loops:**
- **Housing:** shared room, then apartment, then condo or house (rent vs buy, down payment, mortgage, renewal at a new rate).
- **Credit:** first credit card, building a score, the cost of carrying a balance, consolidation.
- **Wealth:** HISA, then GIC, then the index fund, then shares of classmates' companies; TFSA vs RRSP; Rule of 72; fees.
- **Business** (FT20/30 lead, FT10 joins as staff, customers and investors): register a company, build a product line, set prices, hire, pay tax, publish statements, raise money, IPO on the exchange, pay dividends.

**Season loop:** one semester is one season. It ends with a "Life Review" (net worth, financial health score, best decision, worst decision) that feeds the reflection assignment. Then a new season starts fresh, with an alumni hall of fame.

---

## 3. Every system is a module of the program of studies

| Town building or system | What students practise | FinTech 10 | FinTech 20 | FinTech 30 |
|---|---|---|---|---|
| Job Centre and pay stubs | income, deductions, net pay, PDOC | FIN1010 | FIN2060 | |
| Bank and credit union | chequing, HISA, GIC, interest, compounding | FIN1010 | | FIN3080 |
| Credit Bureau and card desk | credit score, interest, minimum payments | FIN1010 | | |
| Housing Office | rent vs buy, mortgages (semi-annual compounding), renewal | FIN1010 | | |
| CRA Tax Office | personal return, credits, refunds | | FIN2060 | |
| Ledger Hall | journals, ledgers, statements for their business | FIN1015 | | FIN3050 |
| Business Registry | feasibility, business plan, pricing, break-even | MAM3030, FIN1910 | ENT2020, FIN2910/2920 | FIN3910/3920 |
| Venture Bank and angel investors | loans vs equity, pitching, cap tables | | ENT2020 | FIN3090 |
| Exchange | order book, IPO, dividends, indexes, risk and return, Rule of 72 | | | FIN3080 |
| Registered Accounts desk | TFSA, RRSP, tax inside vs outside | | | FIN3090 |
| Insurance Office and events | risk, premiums, deductibles, crashes | FIN1010 | | FIN3080 |
| Town Hall and messages | professional communication, proposals | MAM1030 | | |
| Spreadsheet export | every account exports to Sheets for analysis | | INF2080 | |
| Outfitters (wardrobe and home items) | needs vs wants, opportunity cost, depreciation, GST on the price tag | FIN1010 | | FIN3080 |

Each row is a **module**: its own tables, server functions, UI panel, quest templates and outcome codes. A course turns modules on in config, the same way Slide Studio courses now come from `hub.config.json`. A future course is a new config entry plus any new modules, with no rewrite.

---

## 4. Economy design: the part that makes or breaks it

- **Time.** One class day is one in-world month (teacher-adjustable). A semester is about 6–7 years in-world, long enough to *see* compounding, mortgage renewals and a market cycle.
- **Money is a double-entry ledger.** Every dollar moves between two accounts in one database transaction, so the total supply is always explainable. Students never write balances; they call server functions (`pay_rent`, `place_order`) that check rules and post entries.
- **Faucets and sinks.**
  - Money comes in through wages, quest rewards, interest and dividends.
  - It goes out through rent, bills, taxes, fees, insurance, depreciation and business costs.
  - Tune them in a **simulation first**: run 300 bot players for 3 seasons and check inflation, inequality (a Gini-style spread) and how many players go broke. Do this before any student logs in.
- **Central bank.** The teacher, or a schedule, sets the policy rate. Loan and savings rates move with it, so Bank of Canada decisions become a gameplay event.
- **Prices and data.**
  - Use the FP Canada 2026 planning rates as the long-run drift for the index fund and bonds.
  - Base inflation is 2.1%.
  - STAX North's Canadian history data can drive "historical replay" market seasons.
- **NPC demand and liquidity.** Town NPCs buy from student businesses (demand curve and price elasticity), and a market-maker bot quotes every listed share. Markets keep working when another block is offline.
- **Fairness.**
  - Rank on **financial health and growth %**, not raw wealth.
  - Everyone starts equal each season.
  - Bad luck (events) is capped and insurable.
  - No pay-to-win, no real money, no loot boxes.

---

## 5. Classes playing together

- **One town, many blocks.**
  - FT10 students are mostly workers, renters, customers and small investors.
  - FT20/30 teams run the businesses, set prices, hire FT10 students, and list on the exchange.
  - FT30 also act as analysts and angel investors.
- **Asynchronous by design.** Blocks meet at different times, so everything works without the other side online:
  - limit orders sit in the book;
  - job offers wait in an inbox;
  - sales to NPCs happen on each world tick.
- **Inter-class events.** Examples: "Block 1's grocery chain raises prices 8%", "Block 4's ETF launches", "an election promises a housing rebate". Each is generated from real in-game data and shown in the news ticker.
- **Moderation.** No free chat. Communication is through structured actions: offers, contracts, job postings, pitch decks, reviews with preset phrases, and short written proposals that the teacher approves. Messages show pseudonyms only.

---

## 6. Engagement, and the guardrails around it

- **Feel:** a top-down town map (Neopets/Sims feel) with an avatar and a home you furnish and upgrade (a visible reward for good budgeting), plus businesses with storefronts.
- **Progression:** achievements tied to outcome codes, for example "Emergency fund: 3 months", "First IPO", "Credit score 750+", "Filed a return with zero errors", "Survived a crash without selling".
- **Social proof without toxicity:** a hall of fame for good decisions, class goals ("raise the block's average health score to 70"), and team businesses.
- **Short sessions:** 5–10 minutes a day. The game supports the lesson; it doesn't replace it.
- **Guardrails:** no gambling mechanics; caps on trade frequency and size; circuit breakers on the exchange; no student-to-student trading in Phase 3 (the market maker is always the counterparty, which rules out wash trading), with collusion and wash-trade detection a Phase 4 item; teacher freeze and undo.
- **Items and gear (Outfitters):** cosmetic only, no stat or money advantage; a fixed catalogue with no student uploads or naming; no loot boxes, random drops or mystery prices; no real money; the best items are earned by achievements, not bought. Art comes from Mr. Tang's ComfyUI with the DAA Wolf as the style reference.

---

## 7. Architecture

This is what runs today (the $0 pilot stack described above). The Supabase design in section 1 is kept only as the "later" path.

```
Browser (Chromebook-friendly)
  ├─ town map (HTML panels over a photoreal scene; PixiJS only if Phase 5 needs it)
  ├─ panels per module (bank, housing, exchange, ...)
  └─ teacher console (/teach)
        │  HTTPS, cookie session, JSON requests, Server-Sent Events for live updates
        ▼
Cloudflare (proxied DNS and TLS) → nginx → one Node 24 process (server.js, 127.0.0.1:3020)
        ▼
One SQLite file (node:sqlite, WAL) on the GCP VM (us-central1, United States)
  ├─ ledger: accounts, txns, entries (double-entry; entries are append-only by database trigger)
  ├─ core: worlds (one per season), classes, players, sessions, trusted_devices, class_teachers, teacher_invites,
  │  module_enabled, season_results, audit_log, audit_runs, ledger_lock
  ├─ module tables, one prefix per module: bank-basic (bank_class_settings, bank_transfers), rates, jobs, housing,
  │  insurance, credit, bills, outfitters, exchange, savings, leaderboards (each module owns its tables and reads no other module's)
  └─ the world tick (payday, interest, rent, bills, market maker, snapshots) runs inside the teacher's Advance
     (or the school-day auto-advance timer), as one transaction
```

- **Front end:** plain HTML/CSS panels over photoreal scenes, light enough for Chromebooks and phones.
- **Security** (enforced in the Node code and by SQLite triggers; there is no row-level security because there is no Postgres):
  - Money moves only through `lib/ledger.js`. Database triggers refuse any change to account balances and any insert of entries or transactions that does not come through `lib/ledger.js`, and entries can never be updated or deleted.
  - Students can call routes but never write ledger rows. Every route checks the session, the module being on for the class's course, season state (student writes are refused while a season is closed), limits and ownership. SQL is parameterized.
  - Who sees which class is decided in one place, `lib/policy.js` (see section 8).
  - A ledger audit (entries sum to zero, cached balances match, nothing negative that shouldn't be) runs nightly and on demand, and the result is stored.
- **Modules** live in `modules/<name>/index.js` (migrations, routes, hooks, events) with `ui/` panels; `config/vdaa.json` lists which are on for each course. Contract: `docs/modules.md`. (Quests, `quests.json` and `outcomes.json` are not built yet.)
- **Tests:**
  - `npm test` (361 tests on `v9-hardening`);
  - an economy simulator (bots) for balance: `npm run sim`;
  - Playwright class rehearsals (30 bots) like STAX North's `class-test` are not built.

---

## 8. Privacy (FOIP) and approvals

This section says what the system does **today**, as built and checked against the code on `v9-hardening` (2026-10-23). It may be shown to the school as the privacy statement, so it describes only what is true now. Where something is not decided, it says so.

### What is stored
- **Accounts:** a username (students get a generated pseudonym such as `BraveOtter42` from their teacher; a teacher chooses their own, 3-32 characters of letters, digits and `_ . -`), the class (a block name such as "Block 3", free text up to 40 characters), a role, the avatar choices, and a **hash** of the sign-in secret (scrypt; a 6-digit PIN for students, a 12+ character passphrase for teachers). The PIN or passphrase itself is never stored; a PIN is shown once, when it is generated or reset, to print the card.
- **Not asked for:** the system never asks for real names, emails, birthdates, photos or phone numbers, and there is no district or third-party sign-in. The name-to-username map stays offline with Mr. Tang and is not in the system. Nothing enforces that, though: the places someone can type free text are the teacher's chosen username, class (block) names, and a student's short promotion reflection (500 characters, stored with the application and kept), which the system does not screen. Teachers should use a pseudonym and remind students not to put personal information in reflections.
- **Game data, per season:** the ledger (every transaction of fictional money: pay, bills, transfers, trades), and each module's rows (pay stubs, bills, credit file, housing, insurance, Outfitters items, Exchange holdings and orders, leaderboard snapshots, awards and Life Reviews, season results). All of it is about a pseudonym and play money.
- **Sessions:** a hashed cookie token, valid 14 days; a teacher's "trusted device" is also a hashed token, kept 180 days after last use. Expired ones are deleted.
- **Teacher invitations:** a hashed single-use token, valid 7 days; the row is kept after use.
- **Audit log:** who (an internal player id) did what and when: teacher actions, setup, PIN resets, season closes, ticks, and also students' own actions (job choices, buying or selling a home, card approval, Exchange orders, transfers), with class and world names in the details. It holds no PINs, passphrases or tokens.
- **IP addresses:** used in memory to throttle login attempts and not written to the database (the one exception is an audit-log line when a teacher unblocks an address). The web servers on the way (Cloudflare and nginx) see addresses as any web server does; nginx's default access log records visitor IP addresses, so the VM's log probably does; its settings and retention are to be checked on the VM and have not been checked for this section.
- **Known limit:** the database holds hashes of 6-digit PINs. Anyone who got a copy of the file could guess the PINs offline, which is why the file is private to one system user (mode 700, files 0600) and why a PIN only ever opens a game account.

### Where it lives
- **One SQLite file on the GCP VM, in Google Cloud region `us-central1` (Iowa, United States). It is not in Canada.** (The earlier plan assumed a Canadian Supabase region; that is not what was built.)
- Traffic passes through **Cloudflare**, which proxies and terminates TLS for `vdaa.michaelhtang.com`; Cloudflare's network is not limited to Canada.
- **Backups:** a nightly copy (07:20 UTC) on the same VM, the newest 14 kept; a copy before every deploy, the newest 5 kept; and Mr. Tang runs `scripts/pull-backup.sh` to pull the newest nightly copy to his Mac (`~/vdaa-backups`). **Nothing deletes the copies on the Mac**, so they are kept until he removes them. Every backup is a full copy of the database, so anything retained in the live database is retained in the backups too, until they roll off or are removed.
- The server makes no outgoing requests of its own (no analytics, email, payment or AI service calls); it only answers requests. The art-generation tool in `tools/` is not deployed and runs only on Mr. Tang's computer; `scripts/demo-seed.mjs` is included in the deploy (the whole `scripts/` folder is) but is never run on the server.

### Who can see what
- **A student** sees their own accounts, pay stubs, bills, credit, home and holdings. Other students show up in these places: the top 10 of the student's class and of the whole town plus their own row (pseudonym, Wolf rank, health score, change since last month, and net worth rounded to the nearest $1,000 unless the world teacher hides amounts; the Town board covers every class); the class-comparison table (every class's name with its median net worth and health); the Hall of Fame of past award winners (pseudonym, class name, net worth); and classmates' usernames in transfer memos. If a teacher turns transfers on, a student can send small amounts to classmates in the same class only.
- **A teacher** sees and manages only the classes they own (usernames, balances, activity, PIN resets, transfers). Another teacher's classes and students are a 404 to them, and their activity-log view is limited to their own classes. This is enforced in `lib/policy.js`. The exception is the leaderboards panel, which shows every teacher what students see town-wide: the top 10 (pseudonyms), each class's name, size and median score, and award winners with their class names.
- **The world teacher** (Mr. Tang, who ran first-run setup) additionally runs the world clock, seasons, settings and teacher invitations, and reads the whole activity log.
- **Whoever administers the VM** can read the database file directly: Mr. Tang (he reaches the VM over SSH through Google's IAP), and Google Cloud as the host.
- Nobody outside the school gets a login. There are no ads, analytics scripts or third-party requests from a student's browser: fonts and art are served from the same site.

### Retention: what happens to data at the end of a season
**Today nothing is deleted at season close.** An earlier version of this plan said student data would be wiped each season; that was never built, and this section replaces it.
- At close the game saves each student's final net worth (`season_results`), moves every account balance to zero with a normal ledger transaction (`core.season_reset`; the history stays), and ends open positions (homes, Exchange holdings and orders, jobs reset). Nothing is erased.
- **Players carry over.** The same username, PIN hash and class continue into the next season; classes move to the new season with them.
- Every per-season table keeps its rows (they are keyed by season and never read again in the next one), and ledger entries are append-only by design. The audit log is never trimmed.
- The only things that are deleted: login sessions (on expiry or sign-out, and when a PIN or passphrase changes), trusted-device tokens, and a few working rows (for example an insurance policy cancelled before it started, a job after it is quit, a pending-rate placeholder once applied).
- There is no "delete this student" tool and no scheduled purge. The nightly, pre-deploy and Mac backups keep whatever the database held on that day.

> **Decision needed (Mr. Tang / school): retention.** Not decided; the options are:
> 1. **Keep for the pilot.** Keep everything as it is for the Semester 2 pilot, then decide with what we learn. Cost: nothing to build; students' pseudonymous game history is held indefinitely.
> 2. **Purge per-season rows N months after a season closes.** Pick N; a scheduled job (to be built) removes that season's per-world rows (and the matching players, if they have no later season), and the oldest backups roll off. Players and classes that are still active are kept.
> 3. **Delete a student on request.** A teacher-triggered action (to be built) removes or anonymises one student's player row, sessions, devices and per-season rows. Ledger entries are append-only by design, so this would have to anonymise rather than delete those; how is part of the design.
>
> These can be combined (for example 1 now, 3 always, 2 once N is chosen). Whichever is chosen also has to say what happens to the existing backups, including the copies on the Mac.
>
> **Also undecided: data location.** The pilot runs in the United States (`us-central1`). If the school needs the data held in Canada, it has to move (a Canadian cloud region or a different host), which is not planned yet.

### Approvals
- **Sign-off:** section "Decisions (2026-10-21)" records that the pilot is a locally developed tool for Mr. Tang's own course with no approval stage. Whether the school wants a review anyway is Mr. Tang's call; if so, send them this section (data stored, where, who sees it, retention) and note that no sign-in through the district is used.
- **Real money:** none. The real-money Marketplace project stays separate, with its approval gate.

---

## 9. Teacher console and links to Slide Studio and the Course Hub

- **Console:**
  - classes and PIN cards;
  - season controls (start, pause, time speed, policy rate);
  - trigger events (crash, recession, rate shock, rebate);
  - approve business registrations and IPOs;
  - freeze or undo a trade;
  - view dashboards by class;
  - **outcome evidence export**: which student showed which outcome code, with the in-game artifact (pay stub, tax return, statements).
- **Slide Studio:**
  - An outline can include a **"World quest" (draft)** section.
  - **Build lesson** turns it into a quest file, with numbers computed in code like the worksheet forms, and pushes it to the town for that date.
  - The pacing-guide slide shows the quest.
- **Course Hub:** today's lesson card links to today's quest, so a colleague teaching FinTech 10 can run it with no setup.

---

## 10. Roadmap, timed to your units

| Phase | Ships | Rough effort | Pilot | Status |
|---|---|---|---|---|
| 0 · Decide (1–2 wk) | name; FOIP and admin approval; economy spreadsheet and bot simulation; module list; mockups | small | none | Built: the bot simulation, module list and `vdaa` name (`v0-core`, `v1-architecture`). School approval is not recorded here (see Decisions) |
| 1 · Payday Town | accounts and PIN cards, jobs, pay stubs (tax/CPP/EI), budget and bills, bank (chequing, HISA, GIC), net worth page, quests, teacher console v1 | 3–4 wk | 1 FT10 class, 2 weeks | Built, `v2-payday-town`: accounts and PIN cards, jobs and T4127 pay stubs, bills, savings (HISA, GIC), net worth, teacher console. Quests are not built |
| 1b · Outfitters | avatar wardrobe and home items bought from chequing (GST shown, "what this would grow to" line, resale value that depreciates per world month); achievement-only items; class goals unlock Wolf outfits. A module under the v2 contract (docs/modules.md), zero core edits | 1–2 wk | with Payday Town, once students have income and bills | Built, `v5-outfitters` |
| 2 · Credit and Housing | credit score, cards, loans, rent vs buy, mortgages and renewals, insurance, events | 3 wk | FT10 credit and borrowing unit | Built, `v3-credit` (rates, credit; bills changes) and `v4-housing` (housing, insurance, events) |
| 3 · The Exchange | index fund, bonds, GICs, order book, market maker, TFSA/RRSP wrappers, dividends, news ticker | 3–4 wk | FT20/30 investment planning | Built: `v6-leaderboards`, `v7-exchange`, `v8-rrsp` (TFSA and RRSP); `v9-hardening` is the whole-system review pass |
| 4 · Ventures | business registry, products and NPC demand, payroll (hire classmates), statements, small business tax, loans and equity, IPO | 4–5 wk | FT20/30 projects | Not started |
| 5 · The Town | map and avatars, homes to furnish, achievements, seasons, cross-class contracts, Slide Studio quests, Hub link | 3–4 wk | all blocks | Not started. The Agora scene (photoreal home-screen background) exists but its review by the Indigenous education lead is still pending, and must happen before students see it |
| 6 · Scale | module SDK and docs, multi-school worlds, Durable Object exchanges if needed, analytics | as needed | other teachers | Not started |

A realistic target is Phases 1–2 in time for **Semester 2**, so the colleague teaching FinTech 10 gets Payday Town and Credit and Housing from day one. Phases 3–5 follow across the semester.

---

## 11. Costs

- **Pilot:** $0. The existing GCP VM (free tier) and Cloudflare (free), with no database service to pay for: SQLite lives on the VM, with nightly backups.
- **Real school use:** still $0 on the same VM while it fits (about 60-80 MB of RAM for the process). If it outgrows the VM or the school needs the data somewhere else (for example a Canadian region, see the retention decision in section 8), the cost is whatever that host charges; moving to Supabase Pro (about $25 USD/month, no pausing, daily backups) is the old estimate for that path.
- **Claude:** only at build time, plus small on-demand content batches. No per-tick or per-student model calls.

---

## 12. Risks

| Risk | What we do about it |
|---|---|
| Economy breaks (inflation, one rich student) | bot simulation before launch; sinks; caps; teacher levers; seasons reset |
| Cheating, alt accounts, collusion | teacher-issued accounts only; trade limits; the market maker is always the counterparty (no student-to-student trades, so no wash trades) until Phase 4, where detection is needed; audit log; undo |
| Distraction from learning | 5–10 minute sessions; quests tied to the day's lesson; outcome evidence, not just points |
| Privacy | pseudonyms only, hashed PINs, teacher scoping, nightly backups; retention and data location (the pilot is in us-central1) are open decisions in section 8 |
| Teacher workload | automatic ticks; quests generated from outlines; one-click events; Hub link for colleagues |
| Too big to finish | ship Phase 1 alone as a useful product; every phase stands on its own |

---

## 13. Decisions needed from Mr. Tang

1. Name for the platform and the town.
2. Pilot class and start date (Semester 2 FT10?).
3. Approval route: who at Dr. Anne Anderson School or EPSB signs off on a new student tool.
4. Budget: free pilot only (as built), or paid hosting for the school year if the data location or load requires it.
5. Reuse: fold TradeLab's game and leaderboard ideas and STAX North's Canadian data into the Exchange, or keep them separate.
6. **Retention and data location:** see the "Decision needed" notes in section 8 (what happens to student data after a season; the pilot is hosted in the United States).
