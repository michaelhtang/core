// Quick Cash Counter's core (docs/quickcash.md): every pool cost is recomputed from the spec's formulas with ordinary floats, the pool rules hold,
// a replay is deterministic and fast, and the rules of the counter (timeout, lowest bit wins, top pick) behave as written.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { C, KINDS, POOL, createGame, step, replay, score, isOver, report, offers, customerOf, totalCents } from '../modules/arcade/ui/games/quickcash-core.js';

const SRC = fs.readFileSync(new URL('../modules/arcade/ui/games/quickcash-core.js', import.meta.url), 'utf8');

// The spec's formulas, with floats, a 365-day year and the nearest cent. (365 is odd, so a cost is never exactly half a cent: no tie to round.)
const cents = (x) => Math.round(x);
const formula = {
  payday: (D, n) => D * 15 * n,                                  // $15 for every $100, each payday
  cash: (D, d) => cents(D * 100 * 0.23 * d / 365) + 500,        // 23% a year, simple, plus a $5 fee
  line: (D, d) => cents(D * 100 * 0.10 * d / 365),
  card: (D, d) => cents(D * 100 * 0.21 * d / 365),
};
const IDS = ['payday', 'cash', 'line', 'card'];
const topKind = (c) => { const v = c.o.map((x) => x[1]); return v.indexOf(Math.max(...v)); };
const sorted = (c) => c.o.map((x) => x[1]).sort((a, b) => b - a);

test('constants: 30 ticks a second, 6 customers, 600 + 45 ticks each, ROUND 3870, bits 1 to 8', () => {
  assert.deepEqual([C.TPS, C.CUSTOMERS, C.WAIT, C.FLASH, C.ROUND, C.MASK_MAX], [30, 6, 600, 45, 3870, 15]);
  assert.equal(C.ROUND, 6 * (600 + 45));
  assert.deepEqual(KINDS.map((k) => k.id), IDS);
  assert.deepEqual([C.FEE_PER_100, C.PAYDAY_DAYS, C.CASH_PCT, C.CASH_FEE, C.LINE_PCT, C.CARD_PCT, C.YEAR], [15, 14, 23, 500, 10, 21, 365]);
});

test('core: import-free and integer-only (no imports, no Math.random, no Date, no trig/sqrt/floor/round, no division, no decimal literals)', () => {
  const code = SRC.split('\n').map((l) => l.replace(/\/\/.*$/, '')).join('\n');
  assert.doesNotMatch(code, /\bimport\b|\brequire\b/);
  assert.doesNotMatch(code, /Math\.random|\bDate\b|performance\.|Math\.(sin|cos|tan|sqrt|floor|ceil|round|pow|exp|log|trunc|hypot)/);
  assert.ok([...new Set(code.match(/Math\.\w+/g))].every((m) => ['Math.imul', 'Math.max', 'Math.min'].includes(m)), 'only imul, max and min');
  assert.doesNotMatch(code, /\d\.\d/, 'no float literals');
  assert.doesNotMatch(code.replace(/`[^`]*`/g, ''), /[^/*\s]\s*\/\s*[^/*\s]/, 'no division');
  // and at run time: only whole numbers anywhere in the state
  const nums = (v, out = []) => { if (typeof v === 'number') out.push(v); else if (v && typeof v === 'object') Object.values(v).forEach((x) => nums(x, out)); return out; };
  for (let n = 1; n <= 20; n++) assert.ok(nums(replay(n * 7919, bot(n * 7919, 'top'))).every(Number.isInteger));
});

test('the pool: 24 customers, every cost matches the spec formula to the cent', () => {
  assert.equal(POOL.length, 24);
  assert.ok(Object.isFrozen(POOL) && POOL.every((c) => Object.isFrozen(c) && Object.isFrozen(c.o) && c.o.every(Object.isFrozen)));
  assert.equal(new Set(POOL.map((c) => c.n)).size, 24, 'first names are different');
  for (const c of POOL) {
    assert.equal(c.o.length, 4, `${c.n}: all four kinds`);
    assert.ok(Number.isInteger(c.a) && c.a >= 200 && c.a <= 600, `${c.n}: amount $200 to $600`);
    assert.ok(c.o[0][0] >= 1 && c.o[0][0] <= 3, `${c.n}: 1 to 3 paydays`);
    for (const k of [1, 2, 3]) assert.ok(c.o[k][0] >= 1 && c.o[k][0] <= 365, `${c.n}: ${IDS[k]} term is 1 to 365 days`);
    IDS.forEach((id, k) => assert.equal(c.o[k][1], formula[id](c.a, c.o[k][0]), `${c.n} ${id}`));
  }
});

test('pool rules: winners by kind, no line of credit on top, top two at least $1 apart, enough close ones', () => {
  const win = [0, 0, 0, 0];
  for (const c of POOL) win[topKind(c)]++;
  assert.ok(win[0] >= 6, `payday wins ${win[0]}`);
  assert.ok(win[1] >= 5, `cash advance wins ${win[1]}`);
  assert.equal(win[2], 0, 'a line of credit never wins');
  assert.ok(win[3] >= 5, `card wins ${win[3]}`);
  assert.deepEqual(win, [8, 8, 0, 8]);
  const gaps = POOL.map((c) => { const s = sorted(c); return s[0] - s[1]; });
  assert.ok(gaps.every((g) => g >= 100), `smallest gap ${Math.min(...gaps)} cents`);
  assert.ok(gaps.filter((g) => g <= 1000).length >= 6, 'at least 6 gaps of $10 or less');
  assert.equal(gaps.filter((g) => g <= 1000).length, 8);
  assert.equal(Math.min(...gaps), 170);
});

test('student-facing wording: no store, brand or product names, no overdraft, no late-fee figure', () => {
  const words = [...KINDS.flatMap((k) => [k.name, k.short, k.rule]), ...POOL.flatMap((c) => [c.n, c.w])].join(' ');
  assert.doesNotMatch(words, /overdraft|late fee|walmart|costco|amazon|visa|mastercard|interac|td\b|rbc|scotia|paypal/i);
  assert.doesNotMatch(words, /again to pay back|borrows again to/i, 'the unit does not say that');
  assert.match(KINDS[0].rule, /every payday/);
});

test('createGame: the seed picks 6 different customers and an order of the four offers for each; the same seed is the same game', () => {
  const seen = new Set();
  for (let seed = 1; seed <= 300; seed++) {
    const s = createGame(seed);
    assert.equal(new Set(s.order).size, 6);
    assert.ok(s.order.every((i) => i >= 0 && i < 24));
    for (const p of s.perm) assert.deepEqual([...p].sort(), [0, 1, 2, 3]);
    s.order.forEach((i) => seen.add(i));
    assert.deepEqual(createGame(seed).order, s.order);
    assert.deepEqual(createGame(seed).perm, s.perm);
  }
  assert.equal(seen.size, 24, 'every customer turns up for some seed');
  assert.notDeepEqual(createGame(1).order, createGame(2).order);
  assert.equal(createGame(2 ** 32 + 5).seed, 5, 'a seed is a uint32');
});

// A bot: at the start of each customer's wait it presses one slot for one tick. policy: 'top' = the most expensive offer, 'low' = the cheapest, 'a' = always A.
function bot(seed, policy, hold = 1) {
  const s = createGame(seed), log = [];
  let mask = 0, upAt = -1;
  while (!s.over) {
    let want = 0;
    if (s.phase === 0 && s.t === 0 && upAt < 0) {
      const o = offers(s, s.ci), cs = o.map((x) => x.cents);
      want = 1 << (policy === 'a' ? 0 : cs.indexOf(policy === 'top' ? Math.max(...cs) : Math.min(...cs)));
      upAt = s.tick + hold;
    } else if (upAt >= 0 && s.tick < upAt) want = mask;
    else upAt = -1;
    if (want !== mask) { log.push([s.tick, want]); mask = want; }
    step(s, mask);
  }
  return log;
}

test('a perfect bot (always the most expensive offer) scores exactly the sum of the six top costs, in whole dollars', () => {
  for (let seed = 1; seed <= 200; seed++) {
    const s = replay(seed, bot(seed, 'top'));
    const tops = createGame(seed).order.map((i) => sorted(POOL[i])[0]);
    assert.equal(totalCents(s), tops.reduce((a, b) => a + b, 0));
    assert.equal(score(s), Math.floor(totalCents(s) / 100));
    assert.ok(isOver(s));
    assert.equal(report(s).topCount, 6);
  }
  const worst = replay(5, bot(5, 'low'));
  assert.ok(score(worst) < score(replay(5, bot(5, 'top'))));
  assert.equal(report(worst).topCount, 0);
});

test('replay is deterministic: the same seed and inputs give the same score and state', () => {
  const inputs = bot(77, 'a');
  assert.deepEqual(replay(77, inputs), replay(77, inputs));
  assert.equal(score(replay(77, inputs)), score(replay(77, inputs)));
  assert.notEqual(score(replay(77, bot(77, 'top'))), score(replay(78, bot(78, 'low'))));
});

test('a customer who waits out the bar leaves: $0, and doing nothing for the whole round scores 0 and ends at tick ROUND', () => {
  const s = replay(9, []);
  assert.equal(score(s), 0);
  assert.equal(s.tick, C.ROUND);
  assert.deepEqual(s.picks, [-1, -1, -1, -1, -1, -1]);
  assert.ok(report(s).rows.every((r) => r.pick === null && r.paid === 0 && !r.wasTop));
  // one tick before the bar runs out, a press still counts; on the tick it runs out, it does not
  const g = createGame(9);
  for (let i = 0; i < C.WAIT - 1; i++) step(g, 0);
  step(g, 1);
  assert.equal(g.picks[0], 0, 'tick 599 is still in time');
  const h = createGame(9);
  for (let i = 0; i < C.WAIT; i++) step(h, 0);
  assert.equal(h.last.slot, -1);
  step(h, 1);
  assert.equal(h.picks[0], -1, 'tick 600 is too late');
});

test('the lowest bit wins on a double press, and only a rising edge counts', () => {
  for (const [mask, slot] of [[3, 0], [12, 2], [10, 1], [6, 1], [15, 0], [8, 3], [4, 2], [2, 1]]) {
    const s = createGame(3);
    step(s, mask);
    assert.equal(s.picks[0], slot, `mask ${mask}`);
    assert.equal(s.earned[0], offers(s, 0)[slot].cents);
  }
  // a held key does not pick again for the next customer; it must be let go and pressed again
  const s = createGame(3);
  for (let i = 0; i < C.WAIT + C.FLASH + 50; i++) step(s, 1);
  assert.deepEqual(s.picks.slice(0, 2), [0, -1], 'held through the flash: the next customer is not picked');
  // presses during the flash are ignored, and the flash takes exactly FLASH ticks
  const f = createGame(3);
  step(f, 2);
  assert.equal(f.phase, 1);
  for (let i = 1; i < C.FLASH; i++) { step(f, i % 2 ? 0 : 4); assert.equal(f.ci, 0); }
  step(f, 0);
  assert.equal(f.ci, 1);
  assert.equal(f.phase, 0);
  assert.equal(f.picks[0], 1, 'the press at the first tick is the pick; the later ones changed nothing');
  assert.equal(f.picks[1], -1);
});

test('the round ends after customer 6 (an early picker is done sooner) and the report matches the state', () => {
  const s = replay(21, bot(21, 'top'));
  assert.equal(s.tick, 6 * (1 + C.FLASH) - 0, 'six picks at the first tick of each wait: 46 ticks each');
  const r = report(s);
  assert.equal(r.rows.length, 6);
  assert.equal(r.total, totalCents(s));
  r.rows.forEach((row, i) => {
    const c = customerOf(s, i);
    assert.deepEqual([row.name, row.why, row.amount], [c.n, c.w, c.a]);
    assert.equal(row.top.cents, sorted(c)[0]);
    assert.equal(row.low.cents, sorted(c)[3]);
    assert.equal(row.paid, row.top.cents);
    assert.ok(row.wasTop && row.pick.kind === row.top.kind);
  });
  assert.match(r.lesson, /parent/);
  assert.doesNotThrow(() => JSON.stringify(r));
});

test('replay of a full round takes well under 20 ms', () => {
  const inputs = bot(4242, 'top');
  const t0 = process.hrtime.bigint();
  for (let i = 0; i < 20; i++) replay(4242, inputs);
  const each = Number(process.hrtime.bigint() - t0) / 20 / 1e6;
  assert.ok(each < 20, `${each} ms`);
  const slow = process.hrtime.bigint();
  replay(9, []);                                                   // the longest round: nobody picks, all 3870 ticks
  assert.ok(Number(process.hrtime.bigint() - slow) / 1e6 < 20);
});
