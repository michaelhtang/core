# Where things are

Start with `docs/running.md` (run, architecture, privacy, deploy, backup). This page says which doc to open next.

## The code

| Folder | What lives there |
|---|---|
| `server.js` | Starts the HTTP server and dispatches each request. Its parts are in `lib/`: `http.js` (cookies, request helpers), `routes.js` (the core API routes), `streams.js` (live updates), `static.js` (static files). |
| `lib/` | The core every module uses: ledger, clock, events, database, module loader. Money only moves through `lib/ledger.js`. |
| `modules/<name>/` | One building each. `index.js` declares the module (routes, events, services); a large module keeps its functions in topic files beside it, listed at the top of its `index.js`. `ui/` holds the pages, `constants.js` the numbers. Rules: `modules.md`. |
| `migrations/` | Core database changes, applied in order. Never edit one that has shipped. |
| `public/` | The student and teacher pages, shared styles, fonts and pictures (`art/`). |
| `test/` | `npm test` runs every `test/*.test.js` (about 3 minutes). Keep tests flat in this folder: a test in a subfolder is not run. A test that checks a module's source text reads all its files through `test/module-source.js`. |
| `scripts/` | Command-line tools: the economy simulation, backups, demo data, lesson tools (`learn-*.mjs`). |
| `tools/` | Picture tools (`comfy-gen.mjs`). |
| `deploy/` | Service, backup timer and nginx files for the VM. The deploy script itself is `../deploy-vdaa.sh`. |
| `design/` | Picture prompts and the pinned gateway certificate. |
| `replica/` | Notes from studying the site the Learning Road was adapted from. Lesson writers do not open it. |

## How the system works (read before changing the core)

- `modules.md`: the contract every module follows.
- `events.md`: domain events.
- `clock.md`: the one world clock.
- `teachers-seasons.md`: teachers, classes and seasons.
- `live.md`: how pages update by themselves.

## One doc per building

`learn.md` (Learning Road), `jobs.md`, `credit.md`, `housing.md`, `insurance.md`, `outfitters.md`, `leaderboards.md`,
`stagecosts.md`, `arcade.md`, `walk.md`. Links to Mr. Tang's games on other sites (STAX North, Money Month, Tax Desk in the Arcade; TradeLab as its own door): `modules/games/index.js`.

The buildings built in phases are specified in the phase docs, and the code comments point at them:
`phase1.md` (jobs, bills, savings), `phase2.md` (credit, housing), `phase3.md` (the Exchange), `phase4.md` (Ventures),
`phase5-life.md` (life stages, errands), `phase6-roles.md` (landlords, employers).

## Writing lessons

- `../modules/learn/content-kit/BRIEF.md`: the rules a lesson writer follows.
- `../modules/learn/content-kit/VERIFY.md`: how an independent checker checks a new unit.
- `learn.md`: the lesson format, pay rule and open-units setting.
- `scripts/learn-unit.mjs check|splice <unit.json>`: validate a unit and put it into the course file.
- `scripts/learn-copy-units.mjs`: copy whole units from one course file to another.
- `scripts/learn-unlock-to.mjs`: in a local preview database, move a test student to a given level.
- `scripts/learn-scaffold-section.mjs`: add a new section of empty units to the course file.
- `scripts/learn-render-art.mjs`, `scripts/learn-wire-art.mjs`: render a unit's pictures from `design/art/<unit>-prompts.tsv` on the ComfyUI gateway,
  then convert the chosen ones and attach them to the unit's cards.
- `modules/learn/content/REVIEW-*.md`: the facts in each unit, for Mr. Tang to confirm.

## Splitting a large file

Move code, do not change it, and prove it:

- `node scripts/split-moved-only.mjs <base ref> <paths>`: the lines before and after must be the same set (only comments may be new).
- `node scripts/split-shape.mjs <repo root>`: a fingerprint of every module definition (migrations, routes, services, events).
  Run it on a checkout of the commit before the change and on the current one; the two outputs must be identical.
- New files go beside the file they came from (`lib/` or `modules/<name>/`): the deploy script ships only `package.json`, `server.js`,
  `lib`, `config`, `migrations`, `modules`, `public`, `scripts` and `deploy`, so a new top-level folder would not reach the server.

## Plans and history (not needed to change code)

- `../PLAN.md`: the original plan. `plan-v2-student-layer.md`: the current direction.
- `../MIGRATION.md`: the architecture migration of 2026-10-22 (finished).
- `system-review.md`, `engagement-review.md`, `poc-survey.md`: reviews and research.
- `deploy-wednesday.md`, `playtest-block4.md`: the runbook and plan for the first playtest. The teacher setup steps in
  `deploy-wednesday.md` are still the ones to follow on the live site.
