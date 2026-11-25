// Quick Cash Counter: the whole game, as a pure integer state machine (docs/quickcash.md). The browser runs it to play and the server replays the
// player's recorded inputs through the very same file to compute the score, so this file must stay deterministic: no imports, no Math.random,
// no Date, no floats and no division (shifts, % and the idiv() below only), and every random draw comes from the one seeded stream below.
// The screen lives in quickcash.js, not here: the server must not need a DOM.
//
// You work the loan counter. 6 customers walk up one at a time, each short a sum of money, and each is shown the same four kinds of borrowing, in an
// order the seed shuffled, each with its own length of time. Pick the offer that costs the customer the most (it earns the counter the most) before the
// customer leaves. 30 ticks a second; a customer waits WAIT ticks; a pick ends the wait and a FLASH of ticks shows the result; then the next customer.
// Input mask bits 1, 2, 4, 8 = offer A, B, C, D. A pick is the rising edge of a bit while a customer is waiting; two bits rising on the same tick: the
// lowest wins; presses during the flash are ignored. A customer who waits out the bar leaves and earns $0. Score = the whole dollars of the sum of the
// picked offers' costs (cents summed first, rounded down at the end).
// Every cost is in whole cents and is precomputed in POOL below; test/arcade-quickcash-core.test.js recomputes each one from the formulas in the spec.
export const C = Object.freeze({
  TPS: 30, CUSTOMERS: 6, WAIT: 600, FLASH: 45, ROUND: 6 * (600 + 45), MAX_INPUTS: 2000, MASK_MAX: 15,
  FEE_PER_100: 15, PAYDAY_DAYS: 14, CASH_PCT: 23, CASH_FEE: 500, LINE_PCT: 10, CARD_PCT: 21, YEAR: 365,   // the rates the pool was worked out from (shown on the screen)
});

// The four kinds, in the order of each pool row's offers. `short` is the rate in a few words (on the button); `rule` is the one line on the how-to card.
export const KINDS = Object.freeze([
  { id: 'payday', name: 'Payday loan', short: '$15 for every $100', rule: 'A fee of $15 for every $100 borrowed. The customer borrows it again every payday (14 days apart) and pays the fee each time.', unit: 'payday' },
  { id: 'cash', name: 'Cash advance', short: '23% a year + $5 fee', rule: 'Cash taken out on a credit card. It costs 23% a year for the days it is owed, plus a $5 fee.', unit: 'day' },
  { id: 'line', name: 'Line of credit', short: '10% a year', rule: 'Borrowing up to a limit a bank has set. It costs 10% a year for the days it is owed.', unit: 'day' },
  { id: 'card', name: 'Card balance', short: '21% a year', rule: 'A credit card balance carried for a while. It costs 21% a year for the days it is owed.', unit: 'day' },
]);

// One pool row: the customer's first name, the reason, the amount in whole dollars, then for each kind (payday, cash advance, line of credit, card) the
// term and the cost in cents. The term is a number of paydays for the payday loan and a number of days for the others.
const row = (n, w, a, pd, pc, cd, cc, ld, lc, kd, kc) => Object.freeze({ n, w, a, o: Object.freeze([[pd, pc], [cd, cc], [ld, lc], [kd, kc]].map((x) => Object.freeze(x))) });
export const POOL = Object.freeze([
  row('Maya', 'car repair', 300, 2, 9000, 60, 1634, 120, 986, 45, 777),
  row('Jordan', 'rent is short', 500, 1, 7500, 365, 12000, 365, 5000, 250, 7192),
  row('Sam', 'broken phone', 250, 1, 3750, 30, 973, 200, 1370, 300, 4315),
  row('Priya', 'dentist bill', 400, 1, 6000, 365, 9700, 300, 3288, 300, 6904),
  row('Leo', 'winter tires', 600, 3, 27000, 45, 2201, 180, 2959, 365, 12600),
  row('Ava', 'laptop repair', 350, 1, 5250, 200, 4911, 365, 3500, 320, 6444),
  row('Noah', 'bus pass and food', 200, 2, 6000, 20, 752, 90, 493, 150, 1726),
  row('Chloe', 'fridge stopped working', 450, 2, 13500, 300, 9007, 365, 4500, 280, 7249),
  row('Ethan', 'hockey fees', 275, 1, 4125, 14, 743, 100, 753, 250, 3955),
  row('Zoe', 'vet bill', 325, 1, 4875, 200, 4596, 365, 3250, 365, 6825),
  row('Mateo', 'school trip', 225, 1, 3375, 60, 1351, 150, 925, 320, 4142),
  row('Lily', 'glasses', 250, 2, 7500, 180, 3336, 365, 2500, 200, 2877),
  row('Owen', 'furnace repair', 550, 1, 8250, 365, 13150, 365, 5500, 365, 11550),
  row('Nora', 'moving costs', 500, 1, 7500, 100, 3651, 180, 2466, 365, 10500),
  row('Kai', 'phone bill', 200, 1, 3000, 180, 2768, 300, 1644, 140, 1611),
  row('Isla', 'car insurance', 425, 1, 6375, 300, 8534, 365, 4250, 330, 8069),
  row('Ravi', 'winter coat', 275, 1, 4125, 120, 2579, 200, 1507, 365, 5775),
  row('Hana', 'uniform and shoes', 225, 1, 3375, 260, 4186, 365, 2250, 150, 1942),
  row('Finn', 'tooth pain', 375, 1, 5625, 90, 2627, 250, 2568, 365, 7875),
  row('Tess', 'broken bike', 200, 3, 9000, 40, 1004, 60, 329, 30, 345),
  row('Diego', 'power bill', 350, 1, 5250, 30, 1162, 365, 3500, 365, 7350),
  row('Mia', 'textbooks', 400, 1, 6000, 250, 6801, 365, 4000, 190, 4373),
  row('Ben', 'a flight home', 300, 1, 4500, 365, 7400, 200, 1644, 310, 5351),
  row('Ruby', 'shoes for a job', 200, 1, 3000, 220, 3273, 365, 2000, 230, 2647),
]);

export const LESSON = 'A parent, a friend, or a card paid off in full would have cost nothing in money.';

// FNV-1a over the char codes, then mulberry32 kept as a raw uint32 stream (no division to a float).
export function hash32(text) {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) { h ^= text.charCodeAt(i) & 255; h = Math.imul(h, 0x01000193) >>> 0; }
  return h >>> 0;
}
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
// Cents as "$12.34".
export const money = (c) => `$${idiv(c, 100)}.${idiv(c % 100, 10)}${c % 10}`;

// The seed picks 6 of the 24 customers (no repeats), then the order of the four offers for each. The draw order is fixed: the six picks, then the six shuffles.
export function createGame(seed) {
  const r = { x: hash32(`quickcash:${seed >>> 0}`) };
  const idx = POOL.map((_, i) => i), order = [], perm = [];
  for (let i = 0; i < C.CUSTOMERS; i++) {
    const j = i + draw(r, idx.length - i);
    const t = idx[i]; idx[i] = idx[j]; idx[j] = t;
    order.push(idx[i]);
  }
  for (let i = 0; i < C.CUSTOMERS; i++) {
    const p = [0, 1, 2, 3];
    for (let k = 3; k > 0; k--) { const j = draw(r, k + 1), t = p[k]; p[k] = p[j]; p[j] = t; }
    perm.push(p);                                                  // perm[i][slot] = the kind shown in slot A..D for customer i
  }
  return {
    seed: seed >>> 0, tick: 0, over: false, prev: 0, order, perm,
    ci: 0, phase: 0, t: 0,                                         // phase 0 = the customer waits (t ticks so far), 1 = the result flash (t ticks so far)
    picks: [-1, -1, -1, -1, -1, -1], earned: [0, 0, 0, 0, 0, 0],   // per customer: the slot picked (-1 = left) and the cents it earned
    last: null,                                                    // { ci, slot, cents, top } of the customer just served, for the flash
  };
}

// The four offers shown to customer i, in slot order A..D: { kind, term, cents }.
export function offers(s, i) {
  const c = POOL[s.order[i]];
  return s.perm[i].map((kind) => ({ kind, term: c.o[kind][0], cents: c.o[kind][1] }));
}
export const customerOf = (s, i) => POOL[s.order[i]];
const topOf = (s, i) => offers(s, i).reduce((m, o) => Math.max(m, o.cents), 0);

// One tick. mask: what is held right now (0..15).
export function step(s, mask) {
  if (s.over) return s;
  mask &= C.MASK_MAX;
  const press = mask & ~s.prev;
  s.prev = mask;
  const i = s.ci;
  if (s.phase === 0) {
    if (press) {
      const slot = press & 1 ? 0 : press & 2 ? 1 : press & 4 ? 2 : 3;     // the lowest bit wins
      const cents = offers(s, i)[slot].cents;
      s.picks[i] = slot; s.earned[i] = cents;
      s.last = { ci: i, slot, cents, top: cents === topOf(s, i) };
      s.phase = 1; s.t = 0;
    } else if (++s.t >= C.WAIT) {
      s.last = { ci: i, slot: -1, cents: 0, top: false };
      s.phase = 1; s.t = 0;
    }
  } else if (++s.t >= C.FLASH) {
    s.ci++; s.phase = 0; s.t = 0;
    if (s.ci >= C.CUSTOMERS) s.over = true;
  }
  s.tick++;
  if (s.tick >= C.ROUND) s.over = true;
  return s;
}

export const totalCents = (s) => s.earned.reduce((a, b) => a + b, 0);
export const score = (s) => idiv(totalCents(s), 100);          // whole dollars, rounded down after summing the cents
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

// What /finish sends back and the end card shows: a row for each customer served (the picks, the most and least expensive offers), the total and the count of top picks.
export function report(s) {
  const rows = [];
  let topCount = 0;
  for (let i = 0; i < C.CUSTOMERS; i++) {
    const c = customerOf(s, i), o = offers(s, i);
    let hi = o[0], lo = o[0];
    for (const x of o) { if (x.cents > hi.cents) hi = x; if (x.cents < lo.cents) lo = x; }
    const slot = s.picks[i], wasTop = slot >= 0 && o[slot].cents === hi.cents;
    if (wasTop) topCount++;
    rows.push({ name: c.n, why: c.w, amount: c.a, pick: slot < 0 ? null : { kind: o[slot].kind, term: o[slot].term }, paid: s.earned[i], top: { kind: hi.kind, term: hi.term, cents: hi.cents }, low: { kind: lo.kind, term: lo.term, cents: lo.cents }, wasTop });
  }
  return { rows, total: totalCents(s), topCount, lesson: LESSON };
}
