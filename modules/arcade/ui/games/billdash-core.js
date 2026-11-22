// Bill Dash: the whole game, as a pure integer state machine. The browser runs it to play and the server replays the player's recorded inputs
// through the very same file to compute the score, so this file must stay deterministic: no imports, no Math.random, no Date, no floats and no
// division (shifts and % only), and every random draw comes from the seeded generator below, consumed in a fixed order.
// The canvas drawing lives in billdash.js, not here: the server must not need a canvas.
//
// Fixed 30 ticks a second; a round is 45 s = 1350 ticks. Input mask bits: 1 left, 2 right, 4 action (a move or a stamp fires on the press, not while held).
// Four lanes, items fall from the top. In the pay zone (item top y from PAY_TOP to LATE_Y - 1) the action key stamps the lowest item in the player's lane:
//   a bill     -> paid if cash covers it (cash goes down, score goes up by its value, +25% when still early in the zone); too little cash -> it stays, small penalty
//   a paycheque -> cash goes up by PAY_AMOUNT (cash is capped)
//   a sale tag -> an impulse buy: costs cash, scores nothing
// A bill that reaches LATE_Y unpaid is late: a fee comes off the score and a heart is lost. Zero hearts or time up ends the round.

export const C = Object.freeze({
  TPS: 30, ROUND: 1350, LANES: 4, LIVES: 3,
  START_CASH: 60, CASH_CAP: 150, PAY_AMOUNT: 60,
  SPAWN_Y: -12, ITEM_H: 12, PAY_TOP: 64, EARLY_Y: 76, LATE_Y: 96, LANE_GAP_Y: 6,   // pixels; an item's y is its top edge
  SPEED_START: 28, SPEED_END: 56,                    // fall speed in 1/16 px per tick, ramps linearly over the round
  GAP_START: 26, GAP_END: 12, JITTER: 6,             // ticks between spawns (ramps down), plus 0..JITTER-1 from the RNG
  MOVE_CD: 3, HIT_CD: 4, WHIFF_CD: 9, NSF_CD: 12,    // ticks before the next move / stamp
  NSF_PENALTY: 3, LATE_FEE: 20, SALE_COST: 20, EARLY_SHIFT: 2,   // early bonus = value >> EARLY_SHIFT
  RAMP_MUL: 97, RAMP_SHIFT: 7,                       // tick * 97 >> 7 is 0..1023 over 1350 ticks (an integer stand-in for tick / ROUND)
  PITY_CASH: 30,                                     // broke and no paycheque on screen: the next spawn is a paycheque
  MAX_INPUTS: 2000,
});
// kind index = position. weight: share of spawns out of 100.
export const KINDS = Object.freeze([
  { id: 'rent', label: 'Rent', bill: true, cost: 60, value: 60, weight: 8 },
  { id: 'phone', label: 'Phone', bill: true, cost: 15, value: 15, weight: 17 },
  { id: 'card', label: 'Card', bill: true, cost: 25, value: 25, weight: 16 },
  { id: 'ins', label: 'Insurance', bill: true, cost: 35, value: 35, weight: 12 },
  { id: 'pay', label: 'Paycheque', bill: false, cost: 0, value: 0, weight: 33 },
  { id: 'sale', label: 'SALE', bill: false, cost: 0, value: 0, weight: 14 },
]);
export const RENT = 0, PHONE = 1, CARD = 2, INS = 3, PAY = 4, SALE = 5;

// FNV-1a over the char codes, then mulberry32 kept as a raw uint32 stream (no division to a float).
export function hash32(text) {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) { h ^= text.charCodeAt(i) & 255; h = Math.imul(h, 0x01000193) >>> 0; }
  return h >>> 0;
}
function next(s) {
  s.rng = (s.rng + 0x6d2b79f5) >>> 0;
  let t = s.rng;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return (t ^ (t >>> 14)) >>> 0;
}
const draw = (s, n) => next(s) % n;

export function createGame(seed) {
  const s = {
    seed: seed >>> 0, rng: hash32(`billdash:${seed >>> 0}`), tick: 0, over: false, prev: 0,
    lane: 1, moveCd: 0, actCd: 0, cash: C.START_CASH, score: 0, lives: C.LIVES,
    items: [], nextId: 1, spawnIn: 20, fx: [],
    stats: { paid: 0, late: 0, nsf: 0, impulse: 0, deposits: 0, whiffs: 0, early: 0 },
  };
  return s;
}

const ramp = (tick) => (tick * C.RAMP_MUL) >> C.RAMP_SHIFT;                      // 0..1023
export const speedAt = (tick) => C.SPEED_START + (((C.SPEED_END - C.SPEED_START) * ramp(tick)) >> 10);
export const gapAt = (tick) => C.GAP_START - (((C.GAP_START - C.GAP_END) * ramp(tick)) >> 10);
export const yOf = (item) => item.y >> 4;
export const score = (s) => Math.max(0, s.score);
export const isOver = (s) => s.over;

const fx = (s, kind, lane, y, v = 0) => { if (s.fx.length < 12) s.fx.push({ kind, lane, y, v, ttl: 14 }); };

function spawn(s) {
  const r = draw(s, 100), laneRoll = draw(s, C.LANES), jitter = draw(s, C.JITTER);   // always three draws, whether or not the spawn happens
  let kind = 0, acc = 0;
  for (let i = 0; i < KINDS.length; i++) { acc += KINDS[i].weight; if (r < acc) { kind = i; break; } }
  if (s.cash < C.PITY_CASH && !s.items.some((it) => it.kind === PAY)) kind = PAY;
  for (let i = 0; i < C.LANES; i++) {
    const lane = (laneRoll + i) % C.LANES;
    if (s.items.some((it) => it.lane === lane && yOf(it) < C.SPAWN_Y + C.ITEM_H + C.LANE_GAP_Y)) continue;
    s.items.push({ id: s.nextId++, kind, lane, y: C.SPAWN_Y << 4 });
    break;
  }
  s.spawnIn = gapAt(s.tick) + jitter;
}

function act(s) {
  let hit = null;
  for (const it of s.items) {
    const y = yOf(it);
    if (it.lane === s.lane && y >= C.PAY_TOP && y < C.LATE_Y && (!hit || it.y > hit.y)) hit = it;
  }
  if (!hit) { s.actCd = C.WHIFF_CD; s.stats.whiffs++; return; }
  const k = KINDS[hit.kind], y = yOf(hit);
  if (hit.kind === PAY) {
    s.cash = Math.min(C.CASH_CAP, s.cash + C.PAY_AMOUNT); s.stats.deposits++; s.actCd = C.HIT_CD;
    fx(s, 'cash', hit.lane, y, C.PAY_AMOUNT);
  } else if (hit.kind === SALE) {
    s.cash = Math.max(0, s.cash - C.SALE_COST); s.stats.impulse++; s.actCd = C.HIT_CD;
    fx(s, 'oops', hit.lane, y, C.SALE_COST);
  } else if (s.cash >= k.cost) {
    s.cash -= k.cost;
    const early = y < C.EARLY_Y, gain = k.value + (early ? k.value >> C.EARLY_SHIFT : 0);
    s.score += gain; s.stats.paid++; if (early) s.stats.early++; s.actCd = C.HIT_CD;
    fx(s, 'paid', hit.lane, y, gain);
    s.items = s.items.filter((it) => it !== hit);
    return;
  } else {
    s.score -= C.NSF_PENALTY; s.stats.nsf++; s.actCd = C.NSF_CD;
    fx(s, 'nsf', hit.lane, y, C.NSF_PENALTY);
    return;
  }
  s.items = s.items.filter((it) => it !== hit);
}

// One tick. mask: what is held right now (0..7).
export function step(s, mask) {
  if (s.over) return s;
  mask &= 7;
  const press = mask & ~s.prev;
  s.prev = mask;
  if (s.moveCd > 0) s.moveCd--;
  if (s.actCd > 0) s.actCd--;
  if (press & 1 && s.moveCd === 0 && s.lane > 0) { s.lane--; s.moveCd = C.MOVE_CD; }
  if (press & 2 && s.moveCd === 0 && s.lane < C.LANES - 1) { s.lane++; s.moveCd = C.MOVE_CD; }
  if (press & 4 && s.actCd === 0) act(s);
  const v = speedAt(s.tick);
  let late = false;
  const keep = [];
  for (const it of s.items) {
    it.y += v;
    if (yOf(it) < C.LATE_Y) { keep.push(it); continue; }
    if (KINDS[it.kind].bill) {
      s.score -= C.LATE_FEE; s.lives--; s.stats.late++; late = true;
      fx(s, 'late', it.lane, C.LATE_Y - 4, C.LATE_FEE);
    }
  }
  s.items = keep;
  for (const f of s.fx) f.ttl--;
  s.fx = s.fx.filter((f) => f.ttl > 0);
  if (--s.spawnIn <= 0) spawn(s);
  s.tick++;
  if (late && s.lives <= 0) s.over = true;
  if (s.tick >= C.ROUND) s.over = true;
  return s;
}

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
