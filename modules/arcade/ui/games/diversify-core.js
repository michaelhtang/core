// Diversify: the whole game, as a pure integer state machine. The browser runs it to play and the server replays the player's recorded inputs
// through the very same file to compute the score, so this file must stay deterministic: no imports, no Math.random, no Date, no floats and no
// division (shifts, % and the idiv() below only), and every random draw comes from the seeded streams below.
// The canvas drawing lives in diversify.js, not here: the server must not need a canvas.
//
// Fixed 30 ticks a second; a round is 45 s = 1350 ticks. Input mask bits: 1 left, 2 right, 4 drop, 8 rebalance (each fires on the press, not while held).
// Paycheques ("coins", $1.50-$2.50 of game money) arrive in the dropper's hands about once a second. The dropper stands over one of four baskets
// (CASH, BONDS, INDEX, STOCK). Drop lets the coin go now; otherwise it lets go on its own after HOLD ticks. It lands FALL ticks later in the
// basket the dropper was over WHEN IT LET GO. Doing nothing therefore puts every coin in CASH (the dropper starts over CASH).
// Rebalance moves a quarter of the biggest basket into the smallest (3 s cooldown).
// The market is fixed by the seed alone: every basket's step noise and a list of news events are drawn BEFORE play from their own streams, so every
// player of the same seed sees the same headlines at the same ticks, whatever they press.
// Score = a small floor  +  how much better the total ended than the same money would have in CASH alone (the excess, positive or negative)  +  a spread bonus
// (how evenly the money was split, averaged over the round)  -  a penalty for the worst drop of the total. Money put in earns nothing by itself: doing nothing scores the floor.
// Money is whole "cents of game money"; growth uses a per-basket remainder so small baskets still grow. Every product stays far below 2^31
// (a basket cannot pass about 60000 and the biggest rate is 7000/16384), asserted in test/diversify.test.js.

export const C = Object.freeze({
  TPS: 30, ROUND: 1350, MAX_INPUTS: 2000, MASK_MAX: 15, LANES: 4,
  MOVE_CD: 4, REBAL_CD: 90, HOLD: 24, FALL: 9,                 // ticks: lane change cooldown, rebalance cooldown, a coin lets go on its own, a coin's fall
  COIN_FIRST: 20, COIN_GAP: 28, COIN_JITTER: 10, COIN_LAST: 1290, COIN_BASE: 150, COIN_STEP: 50, COIN_SIZES: 3,   // a coin is 150, 200 or 250
  STEP: 15,                                                     // the market moves every 15 ticks: 89 steps in a round
  RATE_SHIFT: 14, PCT: 164,                                     // rates are in 1/16384; one percent is 164 of them
  EV_COUNT: 8, EV_FIRST: 150, EV_SPACING: 140, EV_JITTER: 60,   // eight headlines, one in each 140-tick slot
  EV_TTL: 90,                                                   // a headline stays up for 3 s
  MIN_TOTAL: 1000,                                              // below this the total is too small for a drop or a split to mean anything
  FLOOR: 200, GAIN_SHIFT: 2, DIV_MUL: 839, DIV_SHIFT: 20, DD_MUL: 1024,   // score = 200 + (total - what cash alone ended with) >> 2 + (1e6 - mean HHI) * 839 >> 20 (about 600 for an even split) - worst drop in tenths of a percent
});
// drift: growth per market step in 1/16384; noise: the step noise is a triangle in -noise..+noise (same units).
export const BUCKETS = Object.freeze([
  { id: 'cash', label: 'CASH', name: 'Cash (HISA)', drift: 8, noise: 0 },
  { id: 'bonds', label: 'BONDS', name: 'Bonds', drift: 20, noise: 24 },
  { id: 'index', label: 'INDEX', name: 'Index fund', drift: 34, noise: 90 },
  { id: 'stock', label: 'STOCK', name: 'Single stock', drift: 48, noise: 220 },
]);
// hit: percent change to each basket [cash, bonds, index, stock] when the headline lands.
export const EVENTS = Object.freeze([
  { id: 'rates_up', head: 'RATES UP: BONDS FALL', weight: 14, hit: [1, -7, -2, -3] },
  { id: 'rates_down', head: 'RATES DOWN: BONDS RISE', weight: 8, hit: [0, 5, 2, 3] },
  { id: 'crash', head: 'CRASH: STOCKS TUMBLE', weight: 10, hit: [0, 2, -20, -32] },
  { id: 'inflation', head: 'PRICES UP: CASH BUYS LESS', weight: 14, hit: [-6, -3, 0, 0] },
  { id: 'jump', head: 'STOCK JUMPS: UP 30%', weight: 16, hit: [0, 0, 0, 30] },
  { id: 'scandal', head: 'SCANDAL: STOCK FALLS', weight: 16, hit: [0, 0, 0, -40] },
  { id: 'boom', head: 'BOOM: MARKET RISES', weight: 14, hit: [0, 0, 9, 14] },
]);
const WEIGHT_SUM = EVENTS.reduce((a, e) => a + e.weight, 0);
export const STEPS = 89;                                        // market steps in a round: ticks 15, 30 ... 1335

// FNV-1a over the char codes, then mulberry32 kept as a raw uint32 stream (no division to a float). One stream per purpose, so the market, the
// headlines and the paycheques never disturb each other.
export function hash32(text) {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) { h ^= text.charCodeAt(i) & 255; h = Math.imul(h, 0x01000193) >>> 0; }
  return h >>> 0;
}
const stream = (seed, name) => ({ x: hash32(`diversify:${name}:${seed >>> 0}`) });
function next(r) {
  r.x = (r.x + 0x6d2b79f5) >>> 0;
  let t = r.x;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return (t ^ (t >>> 14)) >>> 0;
}
const draw = (r, n) => next(r) % n;

// floor(a / b) for 0 <= a < 2^31 and b > 0, by shift and subtract (the core has no division operator).
export function idiv(a, b) {
  let q = 0, r = 0;
  for (let i = 30; i >= 0; i--) { r = (r << 1) | ((a >> i) & 1); if (r >= b) { r -= b; q |= 1 << i; } }
  return q;
}

// The seed's whole market: step noise, headlines and paycheques. Fixed draw order: noise (step, then basket, two draws each), headlines (tick, kind), coins (gap, size).
export function marketOf(seed) {
  const nr = stream(seed, 'market'), er = stream(seed, 'news'), cr = stream(seed, 'coins');
  const noise = [];
  for (let t = 0; t < STEPS; t++) for (const b of BUCKETS) noise.push(draw(nr, b.noise + 1) + draw(nr, b.noise + 1) - b.noise);
  const events = [];
  for (let j = 0; j < C.EV_COUNT; j++) {
    const tick = C.EV_FIRST + j * C.EV_SPACING + draw(er, C.EV_JITTER);
    let r = draw(er, WEIGHT_SUM), k = 0;
    while (r >= EVENTS[k].weight) { r -= EVENTS[k].weight; k++; }
    events.push({ tick, kind: k });
  }
  const coins = [];
  for (let tick = C.COIN_FIRST; tick <= C.COIN_LAST; tick += C.COIN_GAP + draw(cr, C.COIN_JITTER)) coins.push({ tick, value: C.COIN_BASE + C.COIN_STEP * draw(cr, C.COIN_SIZES) });
  return { noise, events, coins };
}

export function createGame(seed) {
  return {
    seed: seed >>> 0, tick: 0, over: false, prev: 0, mkt: marketOf(seed),
    lane: 0, moveCd: 0, rebCd: 0, held: null, falling: [], coinIx: 0, evIx: 0, stepIx: 0,
    v: [0, 0, 0, 0], f: [0, 0, 0, 0],                           // basket values and their growth remainders
    ev: [0, 0, 0, 0], ef: [0, 0, 0, 0],                         // the even-split benchmark: the same coins in four equal parts, same market, no rebalancing
    cb: [0], cbf: [0],                                               // the cash benchmark: every paycheque that landed, held in CASH, with CASH's own growth and headlines
    invested: 0, head: -1, headTtl: 0, fx: [], log: [],
    peak: 0, peakTick: 0, peakEven: 0,
    worst: { dd: 0, loss: 0, tick: 0, peakTick: 0, v: null, evenLoss: 0, ev: -1 },     // v: the baskets at the lowest point of the worst drop
    hhiSum: 0, hhiN: 0,
    stats: { drops: 0, autos: 0, moves: 0, rebalances: 0 },
  };
}

const sum = (a) => a[0] + a[1] + a[2] + a[3];
export const totalOf = (s) => sum(s.v);

// Grow basket b by r/16384, keeping the remainder so tiny baskets still grow.
function bump(V, F, b, r) {
  const d = V[b] * r + F[b];
  V[b] += d >> C.RATE_SHIFT;
  F[b] = d & ((1 << C.RATE_SHIFT) - 1);
}

function release(s, byHand) {
  s.falling.push({ lane: s.lane, value: s.held.value, from: s.tick, land: s.tick + C.FALL });
  s.held = null;
  if (byHand) s.stats.drops++; else s.stats.autos++;
}

function rebalance(s) {
  let hi = 0, lo = 0;
  for (let b = 1; b < C.LANES; b++) { if (s.v[b] > s.v[hi]) hi = b; if (s.v[b] < s.v[lo]) lo = b; }
  if (hi === lo || s.v[hi] < 4) return false;
  const amt = s.v[hi] >> 2;
  s.v[hi] -= amt; s.v[lo] += amt; s.stats.rebalances++;
  return true;
}

function headline(s, ix) {
  const e = EVENTS[s.mkt.events[ix].kind];
  for (let b = 0; b < C.LANES; b++) if (e.hit[b]) { bump(s.v, s.f, b, e.hit[b] * C.PCT); bump(s.ev, s.ef, b, e.hit[b] * C.PCT); }
  if (e.hit[0]) bump(s.cb, s.cbf, 0, e.hit[0] * C.PCT);
  s.head = s.mkt.events[ix].kind; s.headTtl = C.EV_TTL;
  s.log.push({ kind: s.head, tick: s.tick });
  s.fx = e.hit.map((p, b) => ({ b, pct: p, ttl: 36 })).filter((f) => f.pct);
}

// Shares in tenths of a percent (they sum to 1000, give or take rounding); all zero before any money has landed.
export function sharesOf(s) {
  const t = sum(s.v);
  return s.v.map((x) => (t > 0 ? idiv(x * 1000, t) : 0));
}

// Peak, worst drop and the even-split benchmark's loss over the same stretch; called once a tick.
function track(s) {
  const t = sum(s.v);
  if (t < C.MIN_TOTAL) return;
  if (t >= s.peak) { s.peak = t; s.peakTick = s.tick; s.peakEven = sum(s.ev); return; }
  const dd = idiv((s.peak - t) * 1000, s.peak);
  if (dd > s.worst.dd) {
    let last = -1;
    for (const e of s.log) if (e.tick >= s.peakTick - 30 && e.tick <= s.tick) last = e.kind;
    s.worst = { dd, loss: s.peak - t, tick: s.tick, peakTick: s.peakTick, v: s.v.slice(), evenLoss: s.peakEven - sum(s.ev), ev: last };
  }
}

// One tick. mask: what is held right now (0..15).
export function step(s, mask) {
  if (s.over) return s;
  mask &= C.MASK_MAX;
  const press = mask & ~s.prev;
  s.prev = mask;
  const t = s.tick;
  if (s.moveCd > 0) s.moveCd--;
  if (s.rebCd > 0) s.rebCd--;
  if (press & 1 && s.moveCd === 0 && s.lane > 0) { s.lane--; s.moveCd = C.MOVE_CD; s.stats.moves++; }
  if (press & 2 && s.moveCd === 0 && s.lane < C.LANES - 1) { s.lane++; s.moveCd = C.MOVE_CD; s.stats.moves++; }
  if (press & 8 && s.rebCd === 0 && rebalance(s)) s.rebCd = C.REBAL_CD;
  const coin = s.mkt.coins[s.coinIx];
  if (coin && coin.tick === t) { if (s.held) release(s, false); s.held = { value: coin.value, age: 0 }; s.coinIx++; }
  if (s.held) { if (press & 4) release(s, true); else if (++s.held.age >= C.HOLD) release(s, false); }
  while (s.falling.length && s.falling[0].land <= t) {
    const d = s.falling.shift(), q = d.value >> 2;
    s.v[d.lane] += d.value; s.invested += d.value; s.cb[0] += d.value;
    for (let b = 0; b < C.LANES; b++) s.ev[b] += q;
    s.ev[2] += d.value - 4 * q;
  }
  while (s.evIx < s.mkt.events.length && s.mkt.events[s.evIx].tick <= t) headline(s, s.evIx++);
  if (t > 0 && t % C.STEP === 0 && s.stepIx < STEPS) {
    const i = s.stepIx++ * C.LANES;
    for (let b = 0; b < C.LANES; b++) { const r = BUCKETS[b].drift + s.mkt.noise[i + b]; bump(s.v, s.f, b, r); bump(s.ev, s.ef, b, r); }
    bump(s.cb, s.cbf, 0, BUCKETS[0].drift + s.mkt.noise[i]);
    const total = sum(s.v);
    if (total >= C.MIN_TOTAL) {
      let h = 0;
      for (let b = 0; b < C.LANES; b++) { const p = idiv(s.v[b] * 1000, total); h += p * p; }
      s.hhiSum += h; s.hhiN++;
    }
  }
  if (s.headTtl > 0) s.headTtl--;
  for (const f of s.fx) f.ttl--;
  s.fx = s.fx.filter((f) => f.ttl > 0);
  track(s);
  s.tick++;
  if (s.tick >= C.ROUND) s.over = true;
  return s;
}

// The score and its parts: the floor, the excess over cash alone (negative when the mix did worse than cash), the spread bonus, the drop penalty.
export function parts(s) {
  const gain = (sum(s.v) - s.cb[0]) >> C.GAIN_SHIFT;
  const bonus = s.hhiN ? ((1000000 - idiv(s.hhiSum, s.hhiN)) * C.DIV_MUL) >> C.DIV_SHIFT : 0;
  const penalty = (s.worst.dd * C.DD_MUL) >> 10;
  return { floor: C.FLOOR, gain, bonus, penalty };
}
export const score = (s) => { const p = parts(s); return Math.max(0, p.floor + p.gain + p.bonus - p.penalty); };
export const isOver = (s) => s.over;

// The shared replay: inputs is a change list [[tick, mask], ...] sorted by tick; a mask holds from its tick until the next entry. Returns the final state.
export function replay(seed, inputs) {
  const s = createGame(seed);
  let i = 0, mask = 0;
  while (!s.over) {
    while (i < inputs.length && inputs[i][0] <= s.tick) mask = inputs[i++][1];
    step(s, mask);
  }
  return s;
}

// ---- the debrief: numbers from the replay and one plain sentence chosen by rules ----
// Every rule compares only numbers the report carries (and the screen shows), and every sentence says "this round" or "in this game", so it is true
// of that round. No advice. Money is shown in whole cents like the rest of the debrief.
const money = (c) => `$${idiv(c, 100)}.${idiv(c % 100, 10)}${c % 10}`;
// Whole percents of the baskets (floored; the remainder goes to the biggest so they add up to 100), the same numbers the screen shows.
export function percents(v) {
  const t = sum(v), p = [0, 0, 0, 0];
  if (t <= 0) return p;
  let top = 0;
  for (let b = 0; b < C.LANES; b++) { p[b] = idiv(v[b] * 100, t); if (v[b] > v[top]) top = b; }
  p[top] += 100 - sum(p);
  return p;
}
export function lesson(r) {
  const w = r.worst, top = r.pct.indexOf(Math.max(...r.pct));
  if (r.invested < C.MIN_TOTAL) return 'Almost no money was banked this round. Drop each paycheque into a basket to see how risk and spreading work.';
  if (w.ddPct >= 7 && w.topPct >= 60 && w.evenLoss < w.loss && w.loss - w.evenLoss >= 100) {
    return `At the lowest point of your biggest drop (${w.ddPct}% off the peak, ${money(w.loss)}), ${w.topPct}% of your money was in ${BUCKETS[w.topBucket].name}. An even split of the same paycheques lost ${money(Math.max(0, w.evenLoss))} over that stretch in this game.`;
  }
  if (r.pct[0] >= 50) {
    const rose = r.total >= r.invested;
    return `${r.pct[0]}% of your money sat in cash. ${rose ? `It ended at ${money(r.total)} from ${money(r.invested)} put in` : `Its buying power fell to ${money(r.total)} from ${money(r.invested)} put in${r.events.includes('inflation') ? ' when prices rose' : ''}`}.${r.evenEnd > r.total ? ` An even split of the same paycheques ended at ${money(r.evenEnd)} this round.` : ''}`;
  }
  if (r.pct[top] >= 60 && w.ddPct < 7 && r.total >= r.invested && r.total > r.cashEnd) {
    return `${r.pct[top]}% of your money ended in ${BUCKETS[top].name} and this round it worked: ${money(r.total)} from ${money(r.invested)} put in. In another round that basket could fall hard, and one result does not show the risk.`;
  }
  if (r.spread >= 620 && w.ddPct < 10) return `You kept your money spread across baskets, and your worst drop this round was only ${w.ddPct}%. In this game, a mix means one basket's bad news hits only part of your money.`;
  return `Your worst drop this round was ${w.ddPct}% off the peak. In this game, baskets that do not all fall together make drops like that smaller.`;
}

// What /finish sends back and the debrief shows: split at the end, worst drop, score parts and the sentence. Percents are whole numbers; the screen shows exactly these.
export function report(s) {
  const total = sum(s.v), w = s.worst;
  let topBucket = 0, topPct = 0;
  if (w.v) {
    const p = percents(w.v);
    for (let b = 0; b < C.LANES; b++) if (p[b] > topPct) { topPct = p[b]; topBucket = b; }
  }
  const r = {
    total, invested: s.invested, cashEnd: s.cb[0], evenEnd: sum(s.ev), values: s.v.slice(), pct: percents(s.v),
    spread: s.hhiN ? 1000 - idiv(idiv(s.hhiSum, s.hhiN), 1000) : 0,       // 0..750: how evenly the money was split, averaged over the round
    parts: parts(s), events: s.log.map((e) => EVENTS[e.kind].id), rebalances: s.stats.rebalances, drops: s.stats.drops, autos: s.stats.autos,
    worst: { dd: w.dd, ddPct: idiv(w.dd, 10), loss: w.loss, evenLoss: w.evenLoss, topBucket, topPct, ev: w.ev >= 0 ? EVENTS[w.ev].id : null },
  };
  r.lesson = lesson(r);
  return r;
}
