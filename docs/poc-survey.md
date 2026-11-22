# Proofs of concept: virtual lives with a virtual economy

*Survey, 2026-10-29. Looked at ChatGPT Sites (OpenAI's hosted site builder, public beta) and at the working life-and-economy sims it turned up, to check vDAA's design against things that run today. Links were visited on this date; several are young products.*

## 1. ChatGPT Sites itself

What it is: describe a site to ChatGPT, it builds and hosts it (`<name>.<handle>.chatgpt.site`, custom domains allowed), with a 10 GB database per site, file storage, "Sign in with ChatGPT" for visitors who want their progress saved, and sharing to selected people / workspace / public. Building counts against Codex usage; hosting is metered separately. Plus, Pro, Business, Enterprise and Edu plans ([help centre](https://help.openai.com/en/articles/20001339-creating-and-using-chatgpt-sites), [feature page](https://chatgpt.com/features/sites/)).

**No life-economy sim exists on Sites yet.** The gallery ([OpenAI's picks](https://chatgpt.com/features/sites/), [developer showcase](https://developers.openai.com/showcase/websites), [40 real sites](https://stacktr.ee/blog/chatgpt-sites-examples), [awesomesites.ai](https://awesomesites.ai/)) is landing pages, storefronts, games, art, 3D scenes and tools (OpenAI's own "Explore more sites" is all storefronts and landing pages). The nearest:

| Site | What it proves | What it lacks |
|---|---|---|
| [MiniTown](https://minitown-cozy-sim.openai.chatgpt.site/) (OpenAI's own) | A cozy voxel town: zone homes/shops/workplaces, residents walk to jobs, "jobs filled" counter, day/night, save/load, 1×/2×/4× speed | No money at all |
| [Tidetown](https://tidetown.logicleaptech.chatgpt.site/) | "A little place, full of life" builder, saved on the device | Single player, no economy |
| [Afterlight](https://afterlight-tidal-garden.bpow.chatgpt.site/) | A shared persistent world where visitors leave traces | Art piece, no systems |
| Inflation Lab, Coleslaw Classic (MMO) | A teaching tool; a browser MMO with 17 skills | No public links |

**Why vDAA should not move onto Sites:** visitors who save progress sign in with a ChatGPT account (students would need accounts; our design is teacher-issued pseudonymous PINs with no emails); third-party explainers report the Sites terms forbid financial-transaction features and content aimed at under-13s ([PlayCode](https://playcode.io/blog/chatgpt-sites-explained), unverified against OpenAI's own text); every edit burns Codex usage; and the data sits in OpenAI's hosting, which is the retention/data-location decision in PLAN.md §8 all over again. Sites is fine for a throwaway visual prototype (a town map mock, a card layout) and nothing else.

## 2. Things that actually work (and what each proves)

**[Lagos Life](https://thecondia.com/lagos-life-game/)** (browser, launched 2026-10-01, 2 M+ self-reported players in a week, [Vanguard](https://www.vanguardngr.com/2026/10/lagos-life-game-crosses-2-million-users-heres-how-to-play/)). Create a character, choose a "Nepo" or "Lapo" start, take a job that drains **energy**, buy **food**, pay **rent**, move between real Lagos places, meet other players. No storyline. Proves: a plain life loop (work → energy → food → rent → nicer places) is enough to hold millions, with no quest content. Its failure is the lesson ([Innovation Village](https://innovation-village.com/lagos-life-game-draws-scrutiny-over-virtual-currency-payments-and-player-data/)): a loophole let players mint currency and **transfer** it, some ended with "trillions"; the fix was zeroing accounts that had only received transfers. Also 18+ only, real-money top-ups, heavy data collection.

**[Intertwined Economy Simulator](https://www.intertwinedfinance.com/economy-simulator)** (US classrooms, $500 per class, live). Every student is somebody: renter/employee, **landlord**, **business owner**, **banker**, **finance minister**, **regulator**; the **teacher is the Fed**. 12 rounds; leases and jobs reset each round; a **stress meter** climbs while homeless or jobless and triggers an emergency loan at interest; class dashboard shows inflation, Gini, unemployment, taxes in effect, trust in government; scenario picker (2008, 1970s stagflation, Volcker, post-COVID); worksheets pre-filled with each student's real decisions and debriefs built from the class's data. Proves: the thing a worksheet cannot do is *the friend two rows over set your rent*. This is the closest live cousin of vDAA.

**[Realmside](https://www.realmside.com/)** (free, "a living mirror of America"). Start in a hostel with a week to rent a room **from a player landlord**; shifts at **player companies** or the city; buy land, build, list a company on the exchange; banks, credit bands, mortgages; elections, ordinances, courts; a council-set **wealth tax on idle cash**, a **citizen dividend** and a **newcomer boost** ([handbook](https://www.realmside.com/handbook)). Proves: player-run supply works, and idle-cash tax + dividend is a tidy anti-hoarding sink/faucet pair. Don't copy its two-currency (real money) model.

**[Polis](https://aklow-labs.com/polis/town)** (Aklow Labs; LLM citizens). Nine AI citizens in a Mallorca town, **one tick = one month, 720 ticks = 60 years**, 25,000 background residents as customers/employees/voters, careers from nurse to hacker, events ("tax reform"), karma, health, stress, net worth; citizens can die. Proves: a month tick over a whole life reads well as a story, and a second meter (stress/health) plus world events gives drama a ledger alone does not.

**[Agentsburg](https://github.com/vertuzz/agentsburg)** (AGPL, Python/Postgres, 24/7). Rent, food, taxes and loans deducted **hourly**; free raw gathering as the only guaranteed faucet; 31 goods, 32 recipes; marketplace orders matched every minute; **NPC demand scales inversely with the number of players online**; bankruptcy below −200 liquidates and resets; weekly elections; the whole economy in seven YAML files. Proves: NPC demand that scales with the live crowd keeps a sparse world alive (our bots do this), and rules-as-data is worth it.

**Classroom-economy incumbents** ([PayGrade](https://freetech4teach.teachermade.com/?p=5785), [Stash101](https://stash101.substack.com/p/how-stash101-saved-my-classroom), ClassEquity, [ClassBank](https://classbank.com), [Banqer](https://banqer.co/blog/setting-up-virtual-classroom-economy-guide-for-teachers)): classroom jobs, paycheques, fines, desk rent, a store. None has a persistent shared world, a market, housing or a life arc. That gap is vDAA's reason to exist, and it is still open.

## 3. What this changes for vDAA

Keep (now confirmed by working products): the month tick and the 48-year life (Polis), bots as scaling NPC demand (Agentsburg), the double-entry ledger (Lagos Life's crash is exactly the bug a ledger prevents), teacher-as-central-bank (Intertwined: the Bank of DAA already is).

Add, in this order:

1. **A stress/health meter that rises while jobless, homeless or behind on bills, and triggers an emergency loan at interest** (Intertwined). Cheap: one number per student in `savings`/`credit` facts, shown as a header chip, fed into the Amphitheatre health board. Strongest motivator in the survey.
2. **Energy spent by work, refilled by food/rest** (Lagos Life). 5a shows energy; 5e was going to spend it on exploring. Spend it on shifts too, so a day has a budget.
3. **Students as landlords and employers** (Intertwined, Realmside). This is Ventures (Phase 4), paused. The survey says it is the single biggest engagement lever, so Ventures should follow 5c, before 5d/5e, and part-time jobs in 4b should be *student-posted* jobs.
4. **Named macro scenarios** (Intertwined): package the stage events (rate shock 42, housing shock 46, crash 50) plus the teacher levers as pickable scenarios ("2008", "1981 Alberta", "2022 inflation") with a one-line debrief each.
5. **Idle-cash tax + citizen dividend** (Realmside) as an optional teacher lever, for the day a class hoards chequing instead of investing.

Do not: transfers between students (Lagos Life's exploit path; keep them off or capped and logged), real money or a second currency, Sites hosting, ChatGPT sign-in for students.

## Sources
- OpenAI: [Creating and using ChatGPT Sites](https://help.openai.com/en/articles/20001339-creating-and-using-chatgpt-sites), [ChatGPT Sites](https://chatgpt.com/features/sites/), [showcase](https://developers.openai.com/showcase/websites), [MiniTown](https://developers.openai.com/showcase/minitown)
- [ChatGPT Sites examples: 40 real sites](https://stacktr.ee/blog/chatgpt-sites-examples), [ChatGPT Sites explained (limits)](https://playcode.io/blog/chatgpt-sites-explained), [awesomesites.ai](https://awesomesites.ai/)
- [Lagos Life explained](https://thecondia.com/lagos-life-game/), [Vanguard: how to play](https://www.vanguardngr.com/2026/10/lagos-life-game-crosses-2-million-users-heres-how-to-play/), [Innovation Village: scrutiny](https://innovation-village.com/lagos-life-game-draws-scrutiny-over-virtual-currency-payments-and-player-data/)
- [Intertwined Economy Simulator](https://www.intertwinedfinance.com/economy-simulator)
- [Realmside](https://www.realmside.com/), [handbook](https://www.realmside.com/handbook)
- [Polis town](https://aklow-labs.com/polis/town), [Studio Meyer write-up](https://studiomeyer.io/en/blog/polis-mediterranean-town) (page now gone)
- [Agentsburg](https://github.com/vertuzz/agentsburg), [Product Hunt](https://www.producthunt.com/products/agentsburg/makers)
- Classroom economies: [PayGrade](https://freetech4teach.teachermade.com/?p=5785), [Stash101](https://stash101.substack.com/p/how-stash101-saved-my-classroom), [ClassBank](https://classbank.com), [Banqer](https://banqer.co/blog/setting-up-virtual-classroom-economy-guide-for-teachers)
