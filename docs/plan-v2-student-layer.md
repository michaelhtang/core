# vDAA plan v2: the student layer

*Written 2026-11-02 for Mr. Tang, main @ 4480a94 (`v21-stagecosts`). Nothing here is built. It follows `docs/engagement-review.md` (2026-10-29) and records what shipped since, what didn't, and what to do about the gap between a correct economy and a game a teenager wants to open.*

---

## 0. Where the project honestly stands

| | Size | State |
|---|---|---|
| Economy engine (ledger, 19 modules, tick, clock, teacher console) | ~20,000 lines, 17,000 lines of tests, 662 passing | Pilot-ready for the money. Audited to the cent over 60 months; stage-paced clock fits 48 years into 94 class days; CPP/OAS and the live retirement check work; stage costs make a do-nothing life end short. |
| Student experience (panels, Today card, feed, two mini-games, Town Walk) | ~4,700 lines | Thin. Fifteen doors, nearly all forms. One required action in the whole game (pick a job); after autopay, none per month. Consequences are late fees and a score dip. The first life events are bill lines. |
| Education tier and student loans (decided 2026-10-29) | 0 | Not started. This was the brief's central idea. |
| District unlocks by unit (decided 2026-10-29) | 0 | Not started. Energy exists in `today` (cap, refill at the tick) but buys nothing. |
| Real students who have played it | 0 | Every number we have is from scripted bots. |

My estimate: the money side is 70–80% of what a first class needs; the "I want to open this" side is 25–35%. The effort went below the waterline because that is what the plan verified.

**The question this plan answers:** what is the smallest set of changes that turns a correct economy into a life students feel they are living, before the Semester 2 pilot (first class days early February 2027, about 12 school weeks from now with December in the middle).

---

## 1. Held fixed

- **The engine.** No tuning, no new money mechanics, no 576-month runs. Idle net worth at 55 stays 8× pay; the retirement outcome is already right, and no student will see 55 with agency anyway at 12 months a day.
- **Zero dependencies, strict CSP, server-authoritative money.** Every new system is a module under `docs/modules.md`, with bots in `simulate` and the 60-month guards (bills/pay ≈57%, homeowners ≈31%, Gini ≤0.40, errand cash <1%).
- **Devices:** phones at 375 px and school Chromebooks. Everything must work on both, on Canvas 2D.
- **PLAN §6 guardrails:** no gambling, loot, random rewards, wall-clock mechanics, notifications, or real money.
- **Sessions of 5–10 minutes.** The game supports the lesson.

## 2. Not WebGL, and why

A 3D remake changes how the town looks, not what a student does in it. The engagement gap is the absence of **choices, visible consequences, story and identity**. A Three.js town with the same fifteen forms behind the doors is the same game, slower on a Chromebook, with a 3D asset pipeline you do not have (your art is 2D pixel and ComfyUI scenes). You already own a 2D tile town with live classmate presence; that is the foundation.

Decision rule: if the February playtest says *"it looks boring"*, upgrade the renderer (PixiJS-class sprite acceleration, still 2D, same art). If it says *"it is boring"*, which is what I expect, the renderer is not the problem. Build the systems below first.

## 3. The design in one sentence

**A life is a run of choices with consequences you can see, lived in a town you walk through with your classmates.** Five systems deliver that. Each is one module, shippable alone, in payoff order.

### 3.1 Life events ("Crossroads")

The missing piece. A deck of authored situations, each with 2–4 real options whose costs land in the ledger and whose debrief tells the student what the choice cost or saved. Stage-aware, deterministic, teacher-schedulable.

**Card shape** (JSON, authored like `modules/today/errands.json`):

```
{ id, stage: "A"|"B"|"C", title, situation,
  when: [ fact conditions, reusing today's fact DSL ],
  deadline_ticks: 2,
  options: [ { id, label, effects: [...], debrief } ],
  ignore: { option: "...", debrief } ,              // what happens if the deadline passes
  teacher: { on_by_default: true, tags: [...] },
  outcome_codes: [...] }
```

**Effects vocabulary**, all through existing mechanisms, no new money paths:

| Effect | How |
|---|---|
| One-off cost | ledger txn `moments.cost`, chequing (or card if chosen and room) → sink; NSF falls to the existing short-pay path |
| Recurring cost for N months | a per-player bills line: one small bills service `bills.addLine({ playerId, id, amountCents, months })`, billed through the normal payable/autopay/late path (the stage-cost rows already proved the pattern) |
| Financing | the loan-account pattern from `stress` and `housing/mortgage.js`: principal in, monthly payment through bills |
| Income change | `jobs` hours multiplier for N months (hours cut, overtime, a second gig) |
| Stress | the card emits `module.moments.resolved { stressDelta }`; `stress` listens like it does for late bills |
| Insurance | an insured phone or tenant claim pays the deductible only, through the existing claims path |
| Housing | forced move or rent rise via the existing move/rent-change routes |

**Draw rule:** at each tick, for each student, the eligible cards (stage, `when` facts, not seen this season, teacher-enabled) are hashed on `(playerId, worldId, month)`; one is dealt if the student has no open card and the stage's rate allows (Stage A: about one card per three ticks; B and C at 12 months a day: one per tick, a year has an event). Deterministic, so `simulate` replays it and bots answer by profile.

**Default is a choice.** Ignoring a card resolves it at the deadline with the worst *reasonable* path, never a fatal one. The car card ignored means bussing and a 10% hours cut for two months, not job loss.

**Starter deck, Stage A (12 cards, season-start dollars, ILLUSTRATIVE):**

| Card | Options (effect) |
|---|---|
| Your car won't start | Repair $1,400 now · Finance it, $130/month × 12 · Bus for 3 months (hours −10%, Stress +10) |
| Phone screen shattered | Replace $900 · Claim it (deductible $150, needs phone cover) · Live with it (Stress +5, no cost) |
| Roommate moves out | Cover the full rent 2 months then find someone · Move to a 1-bed now · Move home with parents (tenure change) |
| Dental emergency | Pay $600 · Card it · Wait (Stress +10, $900 in 3 months) |
| Wedding invitation out of town | Go, $700 · Send a gift, $150 · Decline (Stress +5) |
| Hours cut at work | Take it (hours −20% × 3) · Pick up a second gig (+15% hours, Stress +10) · Change jobs (jobs_past rule) |
| Job offer across town | Take it (+8% pay, transport bill +$60/month) · Stay |
| Parking ticket + towing | Pay $240 now · Pay late ($340, late mark) |
| Laptop died | Replace $1,200 · Refurb $500 · Borrow (Stress +5) |
| Tax refund arrived | Spend it (Outfitters credit) · HISA · TFSA (pairs with the RRSP year-end) |
| Friend asks for a loan | Lend $300 (repaid 50/50 at month +4 by seed) · Decline (Stress +5) |
| Landlord raises rent 8% | Accept · Move (moving cost $800) · Negotiate (seeded: 60% hold at +4%) |

Stage B (10) and Stage C (8) follow the same shape: childcare vs the household tier, a parent needs help, layoff with severance, a furnace, relocation for a promotion, downsizing, a health bill, helping an adult child, an early-retirement offer.

**Where students see it:** the Today card shows an open card first; in the town the card is a marker at the relevant door. Feed posts class counts, never names: "Four classmates had a car break down this month." Leaderboards gain a *Best Decision* award from summed debrief deltas.

**Teacher side:** enable/disable any card per class, schedule one for the whole class on a date (the insurance-trigger pattern), and see the choice split afterwards. **This is where the queued dilemma cards live:** a class card, everyone chooses, a short justification, the split goes on the board, the teacher runs the debate.

**Tone rules:** cards are about the student's *adult self*, never their family now. No death, no divorce, no addiction in the default deck; a teacher switch can add a "hard life" set later. Every card reviewed by you before students see it.

### 3.2 The town as the front door

Make `walk` the home screen instead of a door. Doors already map to modules; errands and Crossroads cards become markers (an "!" over a building, an NPC at the door); classmates are already there with presence. Keep the current panel list as a one-tap "list view" for slow devices and screen readers.

District locks: a `districts` option per course lists which buildings exist from which unit (date or teacher switch), as decided on 2026-10-29. A locked door says why ("Opens in Unit 3", "Stage B"), never a timer. Energy, already in `today`, pays for optional explorations inside a district (a side gig, a market tour); routine banking stays free.

### 3.3 Identity: an avatar and a home

The walking sprite wears Outfitters items (the catalogue exists; it just isn't on the sprite). A **home interior** scene behind the Housing door reflects tenure (parents' basement → shared room → 1-bed → condo → family home) and placed items. Wealth and its absence become visible without reading a number, which is the comparison students will actually make.

### 3.4 Month recap

On the first open after a tick, a ten-second animated recap built from the digest `today` already computes: pay in, bills out, interest, a card's consequence, rank move. At 12 months a day it is a year in review. This closes "nothing visibly happens" with one component and no new data.

### 3.5 School: education tiers and student loans

The brief's point: trade debt now for salary later. A School door; each catalogue job gets a tier (entry, apprenticeship, diploma, degree) with months of study, reduced hours while studying, and a Canada/Alberta student loan on the ledger (loan-account pattern, payments through bills, repayment rules cited at build time, ILLUSTRATIVE until then). Seed the upper tiers from the Life Cycle Wealth Architect's 12 careers and ALIS wages so the game and the spreadsheet share one career list.

---

## 4. Playtest before building

The biggest unknown is not answerable by simulation. Before wave 1, put the **current build** in front of one block for 20 minutes. Zero build cost.

**Protocol:** log in with PIN cards; say only "this is your life at 22, see what you can do"; advance the month once at minute 10. Watch and note: time to first action; what they tried to click; whether anyone found Town Walk or the arcade; what they said to each other; who did nothing; what they asked you.

**Exit slip (self-report, `noKey`):** What did you do first? What did you want to do that you couldn't? Did anything surprise you? Would you open it tomorrow without being told? One thing you'd add.

**Decision rule:** "I didn't know what to do" → 3.2 and 3.4 first. "Nothing happened" → 3.1 first. "It looks boring" → renderer last, but noted. "Fun, what else is there" → 3.5 and districts.

---

## 5. Build order and cost

Each wave: Sonnet editor in a worktree, Opus only where the ledger is touched (3.1 effects, 3.5 loans), one independent review, 60-month sim guards, ff-merge, tag. Rough cost is in sessions of the kind this project has been running.

| Wave | Ships | Ledger touch | Sessions | Pilot gate |
|---|---|---|---|---|
| 0 · Playtest | nothing built; protocol above | none | 0 | before Dec break if possible |
| 1 · See it | 3.4 month recap · 3.2 town as front door with list-view toggle · markers for errands | none | 1–2 | first day of Semester 2 |
| 2 · Crossroads A | 3.1 module, 12 Stage A cards, teacher enable/schedule, feed counts, Best Decision award, bots by profile | yes (effects) | 2–3 | week 2 of Semester 2 |
| 3 · Identity | 3.3 avatar on sprite, home interiors by tenure | none | 1–2 | week 3–4 |
| 4 · School | 3.5 tiers, study months, student loan, School door, careers from the brief | yes (loan) | 2–3 | the careers/credit unit |
| 5 · Crossroads B/C + dilemmas | 18 more cards, class dilemma mode, Life Review adds "best and worst decision" | small | 1–2 | when a class reaches Stage B |
| 6 · Districts | per-unit locks, energy spends inside districts | none | 1 | as units open |

Waves 1 and 2 are the pilot. Everything after is driven by what the first two weeks show.

## 6. Stopped

Economy tuning · the 576-month run · Ventures 4c equity · more mini-games · Fable for builds (plans and whole-system reviews only) · WebGL.

## 7. Risks

- **Content tone.** A card can land on a student's real life (a parent's illness, a lost job at home). Mitigation: cards are about the adult self; teacher switch per card; you review every card; no hard-life set in the pilot.
- **Time.** Twelve school weeks to February with December in them. Mitigation: waves 1–2 are the pilot; 3–6 are in-semester.
- **A second teacher runs it.** The FT10 colleague needs the console to be enough. Mitigation: the playtest doubles as a console check; one page of "first week" instructions ships with wave 1.
- **The real-time feel is still unjudged** (the in-app browser runs at 1 fps). Mitigation: the playtest is on real devices.
- **Scope creep in cards.** Thirty cards is enough for a semester. Mitigation: the deck is JSON; add cards from what students ask for, not from a list.

## 8. Decisions for Mr. Tang

**Decided 2026-11-02 (Mr. Tang):**
1. **Playtest:** Block 4, current build, date to be set (before the December break if possible).
2. **Town first by default,** list view one tap away in the header.
3. **Card tone:** default deck excludes death, divorce and addiction; a teacher-enabled "hard life" set comes later, not in the pilot.
4. **School:** four tiers seeded from the brief's 12 careers.
5. **FT10 vs FT20/30:** same deck and town; Stage B/C cards and the RRSP cards are FT20/30-only.

The options as first laid out, for reference:

1. **Playtest:** which block and date? Even one period before the break changes wave 1.
2. **Town first by default,** or list first with the town one tap away? Recommendation: town by default, list in the header.
3. **Card tone:** confirm the default-deck exclusions (no death, divorce, addiction) and whether a teacher-enabled hard-life set is wanted later.
4. **School scope:** four tiers seeded from the brief's 12 careers (recommended), or the full ALIS list?
5. **FT10 vs FT20/30:** same deck and town, with Stage B/C cards and the RRSP cards FT20/30-only? Recommendation: yes.

---

*Code references: errand facts and energy in `modules/today/`; loan pattern in `modules/stress/index.js` and `modules/housing/mortgage.js`; per-age bill rows in `modules/bills/catalogue.js` (`v21-stagecosts`); town doors in `modules/walk/ui/town/town-core.js`; teacher triggers in `modules/insurance/`. The 2026-10-29 decisions are in `docs/engagement-review.md` §5.*
