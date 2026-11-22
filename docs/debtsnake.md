# Debt Snake (Arcade game 3): spec

Mr. Tang's choice (2026-11-20): a snake game about paying down debt, with every mode he saw in public snake games rebuilt as a money rule, same pay as Bill Dash. Clean room: the rules below are written from watching public play only. No code, art, sound or names are copied. Our own look: the Arcade's pixel palette, a teal-and-gold snake, coins and bills, a dark slate board. Never a blue snake with googly eyes on a green checker board.

Same architecture as Bill Dash and Diversify (docs/arcade.md): `modules/arcade/ui/games/debtsnake-core.js` is import-free, integer-only and deterministic (no imports, no floats, no `Math.random`, no `Date`, no division operator; the test scans the source like the other cores). The browser plays it and records `[[tick, mask], ...]`; the server replays the same file with its own seed and the round's options. The client never sends a score.

## The idea in one paragraph

You start as a long snake: your length is your loan. Every segment past the first two is $100 of debt (start: 12 segments = $1,000). Payment coins appear on the board. Eat one and your tail drops a segment: debt down $100. Every "month" interest is charged and your tail grows. A long snake is clumsy and dangerous, so paying down debt literally gives you room to move. Reach $0 and you are **debt free**: a bonus, and from then on coins are savings that grow you (the classic feel) and interest now works for you.

## Core rules (classic)

- 30 ticks a second. `ROUND` = 5400 ticks (3 minutes) at most; a crash ends the round earlier.
- The snake moves one square every `STEP` ticks: slow 7, normal 5, fast 3.
- Boards (columns x rows): small 10 x 9, normal 15 x 13, large 21 x 17. The outer edge is a wall.
- Start: length 12, in the middle row, heading right, tail to the left. Debt = length - 2.
- Coins on the board at once: 1, 3 or 5 (option). A coin never spawns on the snake, a wall, a stone or another item. When one is eaten the next appears on the same tick (no pause).
- **Payment** (debt phase): +10 points, the tail loses one segment on the next move (so the snake visibly shrinks).
- **Interest**: a month is 60 moves. At the end of each month, while in debt, add `1 + floor((debt - 1) / 10)` segments to the tail (1 for debt 1-10, 2 for 11-20, ...). No division operator: use a subtract loop. The UI shows a month bar and warns 8 moves before interest.
- **Debt free** when debt reaches 0: +200 points, once. From then on each coin is **savings**: +10 points and the snake grows by one. Each month, savings interest: +1 segment and +10 points per full 10 segments of savings (savings = length - 2).
- **Crash** into a wall, a stone or your own body (the tail square that moves away this step does not count) ends the round.
- Turns: mask bits 1 up, 2 down, 4 left, 8 right (`MASK_MAX` 15). The core turns on a rising edge of a bit (pressed this tick, not held last tick). Up to 2 turns are queued, so two quick presses between moves both happen (one per move). A turn straight back into the neck is ignored.
- Score never goes below 0. It is the only thing the server keeps; it never moves money.

## Modes

Any one, or a Mix of any set. Keys are stable (stored in the database). `classic` = no twist.

| key | name | rule |
|---|---|---|
| `classic` | Pay It Down | The rules above. |
| `latefees` | Late Fees | Every month interest also drops a wall block. The next block's square is shown as a faint marker one month ahead. |
| `etransfer` | E-Transfer | Coins come in linked pairs. Entering one pops your head out of the other (same direction); one payment, both vanish. |
| `partial` | Partial Payments | Body segments come in pairs: counting from the head (head = 0), segment i is solid when i mod 4 is 0 or 1 and a gap you can pass through when it is 2 or 3 (the head can only reach odd segments, so 1 is solid and 3 is a gap). |
| `noborders` | No Borders | No outer wall: leave one edge and come back on the other. |
| `transfer` | Balance Transfer | After every payment the snake flips: you now steer from the old tail. |
| `payday` | Chasing Payday | Each coin moves one square every 2 moves (seeded walk, never into a wall, stone, snake or item). |
| `cosigner` | Co-signer | A second snake starts mirrored through the centre and always moves the mirror of your direction. Shared debt: a payment by either shrinks both; interest grows both. Either crashing ends the round. |
| `pin` | PIN Unlock | Each coin starts locked. A key appears; take it (no points) and the nearest locked coin opens. Locked coins are solid. |
| `paperwork` | Push the Paperwork | Coins are bill crates. Moving into a crate pushes it one square if the square beyond is free (otherwise it is a crash). Push it onto the mailbox square to make the payment. A crate not delivered for 2 months moves to a fresh square. |
| `predatory` | Payday Loan Trap | A skull "quick cash" offer sits on the board too. Eating it adds 3 segments of debt and -20 points (score floor 0). It moves to a new square every month. |
| `expiring` | Expiring Offer | A coin fades and vanishes 40 moves after it appears; a missed coin adds 1 segment (a late payment) and a new coin appears. |
| `hiddenfees` | Hidden Fees | Fee squares are hidden. Each sits in a dashed 3 x 3 zone with a flag (the zone shows, not the square). Stepping on one: +2 segments, -10 points, and that zone clears. A new zone appears each month, at most 4. |
| `record` | Credit Record | Each payment leaves a stone where the dropped tail segment was (at most 25; the oldest goes first). |
| `fineprint` | Fine Print | Same rules, but the board is dark: you see only 2 squares around your head and 1 around each item. (Drawing only; the core just flags it.) |
| `emergency` | Emergency Fund | Every 2 months an emergency-fund pickup appears. Holding one, a crash flips the snake around instead of ending the round, and uses it up. Hold at most 1. |
| `autopay` | Autopay | 6 arrow tiles. Entering one turns you to its arrow (queued turns are cleared). |
| `bigpurchase` | Big Purchase | Coins are 3 squares long (a car loan). Eating any part pays all three: -3 segments, +30 points. |
| `directdeposit` | Direct Deposit | Coins within 4 squares (counted along rows plus columns) slide one square toward your head every 2 moves. |
| `creditcheck` | Credit Check | A gate wall runs down the middle column with a 3-square gate. The gate is open in even months and shut in odd months (shut = wall). It flashes for 8 moves before it shuts; it stays open while the snake is in it. |
| `tunnel` | Tunnels | Two pairs of tunnel holes. Entering one hole puts your head out of its partner. |
| `practice` | Practice Budget | Crashes never end the round: the move is skipped and the snake turns right (or left if right is blocked). Same rules otherwise. |

**Mix**: any set of the keys above except `classic`. `fineprint` combines with anything; `practice` combines with anything. If `cosigner` and `transfer` are both on, `transfer` flips both snakes. If two mode rules both place items, each mode places its own and none overlap. When two or more of `etransfer`, `bigpurchase` and `paperwork` are on, each new coin takes the next of them in that order (a pair, a 3-long coin, a crate), so all of them appear. The "?" choice in the picker is the client choosing three modes at random before `/start`: that is a choice of game, never a reward.

## Options and the leaderboard

`opts = { modes: ['classic'] | [keys...], speed: 'slow'|'normal'|'fast', board: 'small'|'normal'|'large', coins: 1|3|5 }`. Defaults: classic, normal, small, 1 (Mr. Tang liked the small board's big apples).

`optionKey(opts)`: the sorted mode keys joined by `+` (`classic`, `latefees`, `etransfer+latefees`). Bests and the class leaderboard are per option key; speed, board and coin count do not split boards.

## Core API (the contract between the core and the screen)

```
export const C = { TPS: 30, ROUND: 5400, MAX_INPUTS: 4000, MASK_MAX: 15, ... };
export const MODE_KEYS = ['classic', 'latefees', ...];   // order above
export function parseOptions(obj) -> normalized opts, or throws Error('...') on anything invalid
export function optionKey(opts) -> string
export function create(seed, opts) -> state
export function step(state, mask) -> undefined   // one tick
export function replay(seed, inputs, opts) -> state   // walks ticks 0..ROUND-1, stops when state.over
export function score(state) -> integer
export function report(state) -> { payments, debt_free, debt, savings, months, max_debt, fees, traps }
export function view(state) -> {
  w, h, tick, over, debt, savings, score, month, month_moves_left,  // month_moves_left counts down to interest
  progress,            // 0..STEP-1: ticks since the last move, for smooth drawing between squares
  snakes: [{ cells: [[x,y], ...] (head first), prev: [[x,y], ...] (the cells one move ago), dir: 0|1|2|3 (up,down,left,right), gaps: bool }],
  items: [{ kind: 'coin'|'key'|'crate'|'mailbox'|'skull'|'fund'|'arrow'|'tunnel'|'zone'|'marker', x, y, ...extra }],
                       // extra: coin {locked, pair, len, dir, fade} arrow {dir} tunnel {pair} zone {w:3,h:3} marker {for:'wall'}
  walls: [[x,y],...], stones: [[x,y],...], gate: null | { x, y0, y1, open, warn },
  dark: bool, wrap: bool, shield: 0|1,
  near: integer,       // squares from the head to the nearest edible coin (for the mouth opening when <= 2)
  events: [{ kind: 'pay'|'save'|'interest'|'debtfree'|'crash'|'fee'|'trap'|'key'|'shield'|'flip'|'teleport'|'expire', x, y, n }]  // what happened on this tick
}
```

Seeded draws (`k.dice`-style hash or a small integer generator inside the core) only; draws happen in a fixed order so every player of a seed sees the same board for the same inputs.

## Feel (what made the original satisfying, rebuilt our way)

1. The mouth opens when a coin is 2 squares ahead or closer, and snaps shut on the bite.
2. The next coin appears on the same tick: never a pause.
3. The body glides between squares (draw at `progress / STEP` between `prev` and `cells`), with rounded corners and a tapered tail.
4. A payment: chomp, a small coin burst, "-$100" floats up, and the last tail segment pops off.
5. Interest: the month bar fills, the tail flashes red for the last 8 moves, then the new segments slide out of the tail with "+$100".
6. Debt free: a short gold flash and "DEBT FREE" once.
7. Instant restart (Space or the Play button) and a best per mode.
8. Sound is off by default (class); no sound in this version.

## Pay

Same as Bill Dash (his decision, 2026-11-20): one Today errand "Play a round of Debt Snake" at 50 cents x price index, once a day when picked, through the existing Today errand path. The score never pays. No stress, wage or ledger effect from the game itself.
