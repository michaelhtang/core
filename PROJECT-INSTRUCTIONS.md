# core (formerly vDAA): project instructions

core (always lowercase; formerly vDAA) is a financial literacy app and economy simulation for Mr. Tang's high school FinTech courses (Alberta): self-paced lessons (the Learning Road) plus a persistent virtual town where students earn, pay bills, save, borrow, invest and run businesses. Zero-dependency Node 24 with `node:sqlite`. Live at vdaa.michaelhtang.com.

The project folder is `/Users/michaeltang/claude-workspace/vdaa`. Start of a session: read `HANDOFF.md` if you have not, then `docs/README.md` to find the one or two files the task needs. Do not read further than the task needs.

## Who does what (model use)

The session runs on Fable 5.2. Fable plans, writes the briefs, reads the reports and diffs, decides, and talks to Mr. Tang. The work itself goes to cheaper models through the Agent tool. Pass `model` on every Agent call.

| Work | Agent | Model |
|---|---|---|
| Finding files, mapping code, collecting facts, reading long files or logs | `scanner` (read-only) | `sonnet` |
| One scoped code or doc change, with its test | `editor`, `isolation: "worktree"` | `sonnet` |
| Writing a lesson unit from `modules/learn/content-kit/BRIEF.md` | `editor`, `isolation: "worktree"` | `sonnet` |
| Checking a finding or a finished change from scratch; checking a lesson unit blind per `VERIFY.md` | `verifier` | `sonnet` |
| Edits to the ledger, the kernel, the world tick or any code that moves money | `editor`, `isolation: "worktree"` | `opus`, and say so before spawning |

Limits:

- Fable does a task itself only when it is about five tool calls or fewer, or a lookup with a known target. Past that, delegate.
- At most two editors at once, and never two on the same files. Editors run only the test file for their change; Fable runs the full suite, one run at a time, before a merge.
- One verifier pass per round, covering every finding of that round. Report only what it confirms.
- A fix loop stops after two rounds with no progress. Report what is stuck.
- No Fable or Opus subagents apart from the Opus row above.

Briefs: state the goal, the files, what is already ruled out, what done looks like, and the one check to run. Point at files; do not paste them. Give a verifier the code and the data, never the conclusion.

## Keeping the token bill down

- Never read these whole: `modules/learn/content/fintech10.json`, `PLAN.md`, the `docs/phase*.md` files, `MIGRATION.md`, `replica/`, and the old notes file `vdaa.md`. Search for the lines, or send a scanner.
- Ask agents for a short report: what changed, the check that proves it, what is not verified. No file dumps.
- While working, run only the test file that covers the change. Run the full `npm test` (about 3 minutes) once, before a merge.
- Run the 60-month sim only when the tick path, a bot, or a balance number changed. Run a 576-month sim only when asked.
- Long commands run in the background. No polling, no recurring or scheduled Claude runs.
- Use the advisor twice on a large task (before committing to an approach, before saying it is done), not on small ones.

## Rules of the repo

- `npm test` means `node --test "test/*.test.js"`. Never bare `node --test`. Tests stay flat in `test/`.
- Work in a worktree (`git worktree add .worktrees/<name> -b <branch> main`). Merge to `main`, tag, remove the worktree.
- No new dependencies. Money moves only through `lib/ledger.js`. Time comes only from `lib/clock.js`. Never edit a shipped migration.
- Students are pseudonyms with PINs: no names, no emails, nothing identifying, anywhere.
- No random rewards. Bots use `k.dice` or the sim's seeded `random`, so a sim run is reproducible.
- Lesson figures come from Mr. Tang's outlines or a pinned company file, and every unit lists its facts in a `REVIEW-*.md` for him to confirm.
- Art and clean-room rules are in `HANDOFF.md` section 5, rules 10 to 12. Read them before touching art, `replica/` or anything with a password.
- Canadian and Alberta context. Plain language a Grade 10 student reads easily. Student-facing pages credit "Mr. Tang", never a tool.

## What is yours and what is his

Yours, without asking: code structure, refactors, bug fixes found along the way, tests, docs, commits and tags on `main`, branch and worktree cleanup. Keep `main` green and deployable, keep `HANDOFF.md` sections 2 and 6 current after a merge, tag or deploy, and report briefly what you did and why.

His, always ask first: any deploy to the live site (he must say "deploy" in this conversation), anything on the server, lesson facts and wording, anything that changes what students earn or owe (pay, prices, loan and stress tuning), and whether a new game mechanic moves in-game money.

## Reporting to him

Lead with what changed and what is left. Say plainly what was not verified. Short sentences, no jargon he has to decode.
