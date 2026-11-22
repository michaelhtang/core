# core

**A financial literacy app and a living town economy for high school FinTech courses in Alberta, Canada.**

core is built and run by Mr. Tang, a high school teacher, for his FinTech 10, 20 and 30 classes. Students learn a money topic on the **Learning Road**, then live it in a **virtual town** that keeps running all semester: they get a job and a paycheque with real Alberta payroll deductions, pay rent and bills, save, borrow, build a credit score, invest, and run class businesses.

It is live and used in his classes.

## What students do

- **The Learning Road.** Short, self-paced lessons with pictures and questions, written from the teacher's own course outlines. FinTech 10 has 6 sections, 35 units and about 1,500 questions (Money & You, Investing, Credit & Borrowing, Money Systems & Crypto, Accounting Prep, FinTech Marketplace). FinTech 20/30 has 3 sections and about 480 questions, including a full Canadian income tax unit. Weekly leagues, practice on weak topics, and a side calculator.
- **The town.** Every student has a chequing account and a job. The teacher runs the world clock, so a school week can be months of game time. Students pay bills, choose between renting and buying, take out loans and mortgages, buy insurance, and save in a HISA, GICs, a TFSA and an RRSP.
- **The Exchange.** A stock market with companies, trading, dividends and market news, where the Bank of DAA's policy rate moves prices.
- **The Arcade.** Small games about money (bills, diversifying, debt) and a daily finance word puzzle.
- **Leaderboards and Wolf ranks** across the class.

## Privacy first

Students are **pseudonyms with PINs**. The app never asks for a real name, email or birthdate, from students or teachers. There is no student data in this repository. The teacher prints PIN cards for a class and hands them out.

## How it is built

- **Zero npm dependencies.** Plain Node.js 24 (`node:http`, `node:sqlite`, `node:test`) and plain browser JavaScript.
- **Double-entry ledger.** Every dollar in the town moves through one file, `lib/ledger.js`, so money is never created or lost by accident.
- **One clock.** Game time comes only from `lib/clock.js`, which lets the teacher speed up, pause, or start a new season.
- **Modules.** Each part of the town (jobs, bills, credit, housing, exchange, learn, arcade and more) is a module in `modules/` with its own migrations, routes, screens and docs.
- **A bot simulator** (`scripts/sim.mjs`) plays hundreds of students for years of game time with a fixed seed, to check that the economy stays balanced before a change ships.
- **About 150 test files** in `test/`.

## Run it

```sh
npm start      # http://127.0.0.1:3020  (data lives in ./data/)
npm test       # node --test "test/*.test.js"
npm run sim    # the economy simulator
```

Open `/teach` to create a teacher account, make a class, and print PIN cards. Students sign in at `/`.

More detail: [`docs/running.md`](docs/running.md) (architecture, privacy, deploy, backup) and [`docs/README.md`](docs/README.md) (which doc covers which part).

## How it was made

Mr. Tang designs the course and the rules, writes the lesson outlines, and checks every lesson fact. The code was written with [Claude Code](https://claude.com/claude-code). `HANDOFF.md` and `PROJECT-INSTRUCTIONS.md` are the working notes and rules that each coding session reads first.

## License

MIT. See [LICENSE](LICENSE).
