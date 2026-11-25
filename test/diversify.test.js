// Diversify (docs/arcade.md): the second arcade game. Its core is a deterministic integer market game; the server replays the recorded inputs
// through the same file and is the only one who computes the score. Core determinism and shape, the bot calibration that carries the lesson
// (a spread-out, rebalancing player beats all-in-stock and all-cash on average, all-in-stock still wins some seeds), the replay budget, the shared
// start/finish API with a per-game best and board, the Today errand (its own event, never completed by a Bill Dash round) and the teacher panel.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createClock } from '../lib/clock.js';
import { boot, seeded } from './helpers.js';
import { C, BUCKETS, EVENTS, STEPS, createGame, step, score, isOver, replay, marketOf, report, lesson, idiv, percents } from '../modules/arcade/ui/games/diversify-core.js';
import * as billdash from '../modules/arcade/ui/games/billdash-core.js';

const REAL = JSON.parse(fs.readFileSync(new URL('../config/vdaa.json', import.meta.url), 'utf8'));
const CORE_SRC = fs.readFileSync(new URL('../modules/arcade/ui/games/diversify-core.js', import.meta.url), 'utf8');
const tot = (s) => s.v[0] + s.v[1] + s.v[2] + s.v[3];

// A player written against the public core. policy(s) -> { lane, rebalance }: where the held coin should go. Returns the change list a client would record.
function bot(seed, policy) {
  const s = createGame(seed), log = [];
  let last = 0;
  while (!isOver(s)) {
    const p = policy(s);
    let want = 0;
    if (s.held) want = p.lane > s.lane ? 2 : p.lane < s.lane ? 1 : 4;
    if (p.rebalance && s.rebCd === 0) want |= 8;
    const mask = want && want === last ? 0 : want;               // let go between presses so each one is an edge
    if (mask !== last) { log.push([s.tick, mask]); last = mask; }
    step(s, mask);
  }
  return log;
}
const to = (lane) => () => ({ lane });
const allStock = to(3), allCash = to(0);
const target = (w) => (s) => {                                   // the coin goes to the basket furthest under its target share
  const t = tot(s) + (s.held?.value ?? 0);
  let best = 0, gap = -Infinity;
  for (let b = 0; b < 4; b++) if (w[b] * t - 100 * s.v[b] > gap) { gap = w[b] * t - 100 * s.v[b]; best = b; }
  return { lane: best };
};
const spread = (s) => ({ ...target([25, 25, 25, 25])(s), rebalance: tot(s) > 2000 && Math.max(...s.v) * 100 > 30 * tot(s) });   // even split, rebalancing when one basket passes 30%
const BOTS = { stock: allStock, cash: allCash, spread };

// ---------- the core ----------
test('core: the same seed and inputs give the same state at every tick (36 seeds); other seeds differ; the market ignores the player', () => {
  const sig = (s) => JSON.stringify(s);
  for (let n = 1; n <= 36; n++) {
    const seed = n * 104729, inputs = bot(seed, spread);
    const a = createGame(seed), b = createGame(seed);
    let i = 0, j = 0, ma = 0, mb = 0;
    while (!a.over) {
      while (i < inputs.length && inputs[i][0] <= a.tick) ma = inputs[i++][1];
      while (j < inputs.length && inputs[j][0] <= b.tick) mb = inputs[j++][1];
      step(a, ma); step(b, mb);
      assert.equal(sig(a), sig(b), `seed ${seed} tick ${a.tick}`);
    }
    assert.equal(a.tick, C.ROUND);
    assert.equal(score(replay(seed, inputs)), score(a));
    // every player of a seed sees the same headlines at the same ticks and the same paycheques, whatever they press
    const stock = replay(seed, bot(seed, allStock)), cash = replay(seed, []);
    assert.deepEqual(stock.log, cash.log);
    assert.deepEqual(stock.mkt, cash.mkt);
    assert.deepEqual(marketOf(seed), createGame(seed).mkt);
  }
  assert.notDeepEqual(marketOf(1).events, marketOf(2).events);
  assert.notDeepEqual(marketOf(1).noise, marketOf(2).noise);
  const m = marketOf(777);
  assert.equal(m.noise.length, STEPS * 4);
  assert.equal(m.events.length, C.EV_COUNT);
  assert.ok(m.events.every((e, i) => e.tick >= C.EV_FIRST + i * C.EV_SPACING && e.tick < C.EV_FIRST + i * C.EV_SPACING + C.EV_JITTER));
  assert.ok(m.coins.length >= 33 && m.coins.length <= 40, `${m.coins.length} paycheques`);
  assert.ok(m.coins.every((c) => c.value >= 150 && c.value <= 250 && c.tick <= C.COIN_LAST));
});

test('core: a round is exactly 1350 ticks, the controls do what they say, and extra input after the end changes nothing', () => {
  const g = createGame(5);
  for (let i = 0; i < 30; i++) step(g, 0);
  assert.equal(g.lane, 0, 'the dropper starts over CASH, so doing nothing banks everything as cash');
  step(g, 2); step(g, 0);
  assert.equal(g.lane, 1);
  step(g, 2);                                                         // inside the 4-tick cooldown: ignored
  assert.equal(g.lane, 1);
  for (let i = 0; i < 6; i++) step(g, 0);
  step(g, 1);
  assert.equal(g.lane, 0);
  // a held coin is dropped by hand into the lane the dropper is over, and lands FALL ticks later
  const d = createGame(9);
  while (!d.held) step(d, 0);
  const value = d.held.value;
  step(d, 4);
  assert.equal(d.held, null);
  assert.equal(d.stats.drops, 1);
  assert.equal(d.falling[0].lane, 0);
  for (let i = 0; i < C.FALL; i++) step(d, 0);
  assert.equal(d.v[0], value);
  assert.equal(d.invested, value);
  // an untouched coin lets go on its own after HOLD ticks
  const a = createGame(9);
  while (!a.held) step(a, 0);
  for (let i = 0; i < C.HOLD; i++) step(a, 0);
  assert.equal(a.held, null);
  assert.equal(a.stats.autos, 1);
  // rebalance moves a quarter of the biggest basket into the smallest, then waits 3 s
  const r = createGame(3);
  r.v = [0, 800, 400, 40]; r.f = [0, 0, 0, 0];
  step(r, 8);
  assert.deepEqual(r.v, [200, 600, 400, 40], 'a quarter of BONDS (200) went to CASH');
  assert.equal(r.rebCd, C.REBAL_CD);
  step(r, 0); step(r, 8);
  assert.deepEqual(r.v, [200, 600, 400, 40], 'cooldown: no second rebalance');
  assert.equal(r.stats.rebalances, 1);
  const done = createGame(5);
  for (let i = 0; i < 5000; i++) step(done, 15);
  assert.equal(done.tick, C.ROUND);
  assert.ok(done.over);
  const frozen = JSON.stringify(done);
  step(done, 7);
  assert.equal(JSON.stringify(done), frozen);
  assert.equal(score(replay(5, [])), score(replay(5, [[0, 0]])));
});

test('core: headlines hit the baskets they name, by the percent they name', () => {
  for (const e of EVENTS) {
    const g = createGame(1);
    g.v = [10000, 10000, 10000, 10000];
    const ix = EVENTS.indexOf(e);
    g.mkt.events = [{ tick: 0, kind: ix }];
    step(g, 0);
    assert.equal(g.head, ix);
    e.hit.forEach((p, b) => assert.ok(Math.abs(g.v[b] - 10000 * (100 + p) / 100) <= 6, `${e.id} basket ${b}: ${g.v[b]}`));
  }
  assert.ok(EVENTS.some((e) => e.hit[3] <= -40) && EVENTS.some((e) => e.hit[3] >= 30), 'a stock can crash 40% or jump');
  assert.ok(EVENTS.every((e) => e.head.length <= 28 && /^[A-Z0-9 :%+-]+$/.test(e.head)), 'headlines fit the pixel font and the 160 px screen');
});

test('core: import-free and integer-only (no imports, no Math.random, no Date, no trig/sqrt/floor/round, no division, no decimal literals)', () => {
  const code = CORE_SRC.split('\n').map((l) => l.replace(/\/\/.*$/, '')).join('\n');
  assert.doesNotMatch(code, /\bimport\b|\brequire\b/);
  assert.doesNotMatch(code, /Math\.random|\bDate\b|performance\.|Math\.(sin|cos|tan|sqrt|floor|ceil|round|pow|exp|log|trunc|hypot)/);
  assert.ok([...new Set(code.match(/Math\.\w+/g))].every((m) => ['Math.imul', 'Math.max', 'Math.min'].includes(m)), 'only imul, max and min');
  assert.doesNotMatch(code, /\d\.\d/, 'no float literals');
  assert.doesNotMatch(code.replace(/`[^`]*`/g, ''), /[^/*\s]\s*\/\s*[^/*\s]/, 'no division');
  // and at run time: only whole numbers anywhere in the state, and every product stays far below 2^31
  const nums = (v, out = []) => { if (typeof v === 'number') out.push(v); else if (v && typeof v === 'object') Object.values(v).forEach((x) => nums(x, out)); return out; };
  let biggest = 0;
  for (let n = 1; n <= 30; n++) for (const pol of [allStock, spread, allCash]) {
    const s = createGame(n * 31337);
    const inputs = bot(n * 31337, pol);
    let i = 0, mask = 0;
    while (!s.over) {
      while (i < inputs.length && inputs[i][0] <= s.tick) mask = inputs[i++][1];
      step(s, mask);
      if (s.tick % 50 === 0) assert.ok(nums(s).every(Number.isSafeInteger), 'integers only');
      biggest = Math.max(biggest, ...s.v);
    }
  }
  assert.ok(biggest * 7000 * 8 < 2 ** 31, `largest basket ${biggest}`);
  assert.equal(idiv(1000, 7), 142); assert.equal(idiv(0, 5), 0); assert.equal(idiv(2 ** 31 - 1, 1), 2 ** 31 - 1);
});

test('the displayed percents are whole numbers that add up to 100', () => {
  for (let n = 1; n <= 20; n++) {
    const r = report(replay(n * 31, bot(n * 31, spread)));
    assert.ok(r.pct.every(Number.isInteger) && r.pct.reduce((a, b) => a + b, 0) === 100, `${r.pct}`);
  }
  assert.deepEqual(percents([0, 0, 0, 0]), [0, 0, 0, 0]);
  assert.deepEqual(percents([1, 1, 1, 0]), [34, 33, 33, 0]);
});

// ---------- the lesson: calibration over 200 seeds ----------
test('bots over 200 seeds: spread + rebalance beats all-cash by a wide margin and all-in-stock on average; all-in-stock still wins some seeds', (t) => {
  const N = 200, scores = { stock: [], cash: [], spread: [] }, worst = { stock: [], cash: [], spread: [] };
  for (let n = 1; n <= N; n++) {
    const seed = n * 7919;
    for (const [name, pol] of Object.entries(BOTS)) { const e = replay(seed, bot(seed, pol)); scores[name].push(score(e)); worst[name].push(e.worst.dd); }
  }
  const mean = (a) => a.reduce((x, y) => x + y, 0) / a.length;
  const beats = (a, b) => scores[a].filter((x, i) => x > scores[b][i]).length;
  const stockWins = beats('stock', 'spread'), cashWins = beats('cash', 'spread'), spreadOverCash = beats('spread', 'cash');
  t.diagnostic(`mean score: spread ${mean(scores.spread).toFixed(0)}, cash ${mean(scores.cash).toFixed(0)}, all-in stock ${mean(scores.stock).toFixed(0)}; all-in stock beat spread on ${stockWins}/${N} seeds, cash beat spread on ${cashWins}/${N}; mean worst drop (tenths of a percent): spread ${mean(worst.spread).toFixed(0)}, stock ${mean(worst.stock).toFixed(0)}`);
  assert.ok(mean(scores.spread) > mean(scores.cash) + 350, 'spread beats all-cash by at least 350 points');
  assert.ok(spreadOverCash >= N * 0.85, `spread beats cash on ${spreadOverCash}/${N} seeds`);
  assert.ok(mean(scores.spread) > mean(scores.stock) + 200, 'spread beats all-in stock by at least 200 points');
  assert.ok(stockWins >= N * 0.08 && stockWins <= N * 0.25, `all-in stock wins ${stockWins} seeds: luck can pay, but not usually`);
  assert.ok(mean(scores.cash) > 0 && Math.min(...scores.cash) > 0, 'doing nothing is a low but non-zero score');
  assert.ok(mean(scores.cash) < mean(scores.spread) / 3);
  assert.ok(mean(worst.spread) < mean(worst.stock) / 2, 'a spread player has a much smaller worst drop');
  const sd = (a) => Math.sqrt(mean(a.map((x) => (x - mean(a)) ** 2)));
  assert.ok(sd(scores.spread) < sd(scores.stock) / 2, 'and a steadier score');
  assert.ok(scores.stock.some((x) => x === 0), 'a bad seed wrecks an all-in stock player');
  assert.ok(Math.max(...scores.spread) < 2500, 'spread scores stay in a sane band');
});

const $c = (c) => `$${Math.floor(c / 100)}.${String(c % 100).padStart(2, '0')}`;   // the debrief's money format
test('lesson: every rule can be reached and reads as plain, advice-free text', () => {
  const base = { total: 8000, invested: 7900, cashEnd: 7800, evenEnd: 7950, pct: [25, 25, 25, 25], spread: 700, events: [], worst: { dd: 40, ddPct: 4, loss: 300, evenLoss: 250, topBucket: 2, topPct: 30, ev: null } };
  const cases = {
    none: [{ ...base, invested: 100 }, /Almost no money/],
    concentrated: [{ ...base, worst: { ...base.worst, dd: 300, ddPct: 30, loss: 2400, evenLoss: 1100, topBucket: 3, topPct: 90 } }, /lowest point of your biggest drop \(30% off the peak, \$24\.00\), 90% of your money was in Single stock\. An even split.*lost \$11\.00/],
    cashLost: [{ ...base, total: 7500, pct: [80, 10, 5, 5], events: ['inflation'] }, /80% of your money sat in cash\. Its buying power fell to \$75\.00 from \$79\.00 put in when prices rose\. An even split.*ended at \$79\.50 this round/],
    cashGrew: [{ ...base, evenEnd: 7900, pct: [80, 10, 5, 5] }, /ended at \$80\.00 from \$79\.00 put in\.$/],
    lucky: [{ ...base, pct: [5, 5, 10, 80], worst: { ...base.worst, ddPct: 3 } }, /80% of your money ended in Single stock and this round it worked/],
    steady: [{ ...base }, /kept your money spread across baskets, and your worst drop this round was only 4%/],
    plain: [{ ...base, spread: 400, pct: [10, 30, 30, 30] }, /worst drop this round was 4% off the peak/],
  };
  const seen = new Set();
  for (const [name, [r, re]] of Object.entries(cases)) {
    const text = lesson(r);
    assert.match(text, re, name);
    seen.add(text);
    assert.doesNotMatch(text, /jackpot|you should|buy |sell |guarantee|get rich|inflation/i, name);
    assert.ok(text.length < 280, name);
  }
  assert.equal(seen.size, Object.keys(cases).length);
  const heavy = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map((n) => report(replay(n * 1999, bot(n * 1999, allStock))));
  assert.ok(heavy.some((x) => /lowest point of your biggest drop/.test(x.lesson)), 'a crashed all-in stock round gets the concentration sentence');
});

// A sentence may only say what the numbers shown beside it say. Written as asserts over 200 seeds x 3 bots.
test('lesson: no sentence contradicts the report (200 seeds x all-in stock, all cash, spread)', () => {
  const rule = new Map();
  const hit = (name) => rule.set(name, (rule.get(name) ?? 0) + 1);
  for (let n = 1; n <= 200; n++) {
    const seed = n * 7919;
    for (const [bn, pol] of Object.entries(BOTS)) {
      const r = report(replay(seed, bot(seed, pol))), t = r.lesson, w = r.worst, who = `${bn} seed ${seed}: ${t}`;
      assert.equal(r.pct.reduce((a, b) => a + b, 0), 100, who);
      assert.ok(r.pct.every(Number.isInteger) && Number.isInteger(w.ddPct), who);
      assert.equal(w.ddPct, Math.floor(w.dd / 10), who);
      const pctShown = [...t.matchAll(/(\d+)%/g)].map((m) => Number(m[1]));
      if (/lowest point of your biggest drop/.test(t)) {                    // concentration: the composition at the trough, and a what-if that really lost less
        hit('concentration');
        assert.deepEqual(pctShown, [w.ddPct, w.topPct], who);
        assert.ok(w.topPct >= 60 && w.ddPct >= 7, who);
        assert.ok(w.evenLoss < w.loss, `the even split must have lost less: ${who}`);
        assert.ok(t.includes($c(w.loss)) && t.includes($c(Math.max(0, w.evenLoss))), who);
      } else if (/sat in cash/.test(t)) {
        hit('cash');
        assert.deepEqual(pctShown, [r.pct[0]], who);
        assert.ok(r.pct[0] >= 50, who);
        if (/It ended at/.test(t)) assert.ok(r.total >= r.invested && t.includes($c(r.total)) && t.includes($c(r.invested)), `'ended at' needs total >= invested: ${who}`);
        if (/buying power fell/.test(t)) assert.ok(r.total < r.invested, `'fell' needs total < invested: ${who}`);
        if (/when prices rose/.test(t)) assert.ok(r.events.includes('inflation') && r.total < r.invested, who);
        if (/An even split/.test(t)) assert.ok(r.evenEnd > r.total && t.includes($c(r.evenEnd)), `a 'did better' what-if needs a higher even-split total: ${who}`);
        else assert.ok(r.evenEnd <= r.total, `an even split that did better must be said: ${who}`);
      } else if (/this round it worked/.test(t)) {
        hit('worked');
        assert.deepEqual(pctShown, [Math.max(...r.pct)], who);
        assert.ok(r.total >= r.invested && r.total > r.cashEnd && w.ddPct < 7 && Math.max(...r.pct) >= 60, who);
      } else if (/kept your money spread/.test(t)) {
        hit('spread');
        assert.deepEqual(pctShown, [w.ddPct], who);
        assert.ok(w.ddPct < 10 && r.spread >= 620, who);
      } else if (/worst drop this round/.test(t)) {
        hit('plain');
        assert.deepEqual(pctShown, [w.ddPct], who);
      } else assert.fail(`unrecognised sentence: ${who}`);
      assert.doesNotMatch(t, /\bgrew\b|inflation|this seed|kind to/i, who);
    }
  }
  assert.ok(rule.size >= 4, `the sweep reached ${[...rule.keys()]}`);
});

test('replay of a full 1350-tick round takes well under 20 ms', () => {
  const inputs = bot(4242, spread);
  assert.ok(inputs.length > 50);
  const spam = [];
  for (let t = 0; t < C.ROUND; t += 2) spam.push([t, t % 4 === 0 ? 0 : 15]);   // a 675-entry log that presses everything
  replay(1, spam);                                                              // warm up the JIT; the server's first call is cold, so also check that below
  for (const log of [inputs, spam, []]) {
    const t0 = process.hrtime.bigint();
    for (let i = 0; i < 10; i++) replay(4242 + i, log);
    const ms = Number(process.hrtime.bigint() - t0) / 1e6 / 10;
    assert.ok(ms < 20, `replay took ${ms.toFixed(2)} ms`);
  }
  const cold = process.hrtime.bigint();
  replay(99, bot(99, spread));
  assert.ok(Number(process.hrtime.bigint() - cold) / 1e6 < 20);
});

// ---------- the API ----------
const T0 = Date.parse('2026-11-02T15:00:00Z');
async function world({ n = 3, config = REAL } = {}) {
  let t = T0;
  const srv = await boot({ config, clock: createClock({ now: () => t }) });
  const w = await seeded(srv, n, { transfers: false });
  for (const g of ['wordle', 'quickcash']) srv.app.db.prepare("INSERT OR IGNORE INTO arcade_class_off (class_id, game) SELECT id, ? FROM classes").run(g); for (const t of ['today_errands', 'today_state']) srv.app.db.exec(`DELETE FROM ${t}`);   // Today picks 3 errands a day: with five arcade errands on some could miss the day, so these worlds drop FinWord and Quick Cash Counter and let the day be picked again
  const rows = (sql, ...a) => srv.app.db.prepare(sql).all(...a);
  return { srv, ...w, advance: (ms) => { t += ms; }, rows, cleanup: srv.cleanup };
}
const startRound = async (s, game = 'diversify') => { const r = await s.client.post('/api/arcade/start', { game }); assert.equal(r.status, 200, JSON.stringify(r.json)); return r.json; };
const finishAs = (s, r, inputs, extra = {}) => s.client.post('/api/arcade/finish', { session: r.session, game: r.game, inputs, ...extra });

test('start then finish: the server score is its own replay, whatever the body says; the debrief numbers are the replay\'s; counted once', async () => {
  const w = await world();
  try {
    const [a] = w.students;
    const round = await startRound(a);
    assert.equal(round.game, 'diversify');
    assert.equal(round.ticks, 1350);
    const inputs = bot(round.seed, spread);
    const local = replay(round.seed, inputs);
    w.advance(46_000);
    const fin = await finishAs(a, round, inputs, { score: 999999, best: 999999, stats: { total: 1 }, lesson: 'x' });
    assert.equal(fin.status, 200, JSON.stringify(fin.json));
    assert.equal(fin.json.score, score(local));
    assert.deepEqual(fin.json.stats, report(local), 'the debrief is the server replay, identical to a local one');
    assert.equal(fin.json.stats.pct.length, 4);
    assert.ok(typeof fin.json.stats.lesson === 'string' && fin.json.stats.lesson.length > 20);
    assert.equal(fin.json.hearts, undefined);
    assert.equal(fin.json.new_best, true);
    assert.equal(fin.json.ticks, 1350);
    const row = w.rows('SELECT * FROM arcade_runs WHERE id = ?', round.session)[0];
    assert.deepEqual([row.game, row.status, row.score, row.seed], ['diversify', 'finished', score(local), round.seed]);
    assert.equal((await finishAs(a, round, inputs)).status, 409, 'a double finish is refused');
    assert.equal(w.rows("SELECT COUNT(*) AS n FROM arcade_runs WHERE status = 'finished'")[0].n, 1);
    // a finish that names the other game is refused without burning the round
    const r2 = await startRound(a);
    assert.equal((await a.client.post('/api/arcade/finish', { session: r2.session, game: 'billdash', inputs: [] })).status, 400);
    assert.equal(w.rows('SELECT status FROM arcade_runs WHERE id = ?', r2.session)[0].status, 'open');
  } finally { await w.cleanup(); }
});

test('tampered inputs change the score (and only the replay decides); a worse second round does not lower the best', async () => {
  const w = await world();
  try {
    const [a] = w.students;
    const r1 = await startRound(a);
    const honest = bot(r1.seed, spread);
    // drop more and more of the opening moves until the score changes (some seeds shrug off the first few)
    const tampered = [honest.slice(4), honest.slice(10), honest.slice(30), []].find((t) => score(replay(r1.seed, t)) !== score(replay(r1.seed, honest)));
    assert.ok(tampered, 'some tamper must matter for this seed');
    w.advance(46_000);
    const f1 = (await finishAs(a, r1, tampered)).json;
    assert.equal(f1.score, score(replay(r1.seed, tampered)));
    const r2 = await startRound(a);
    w.advance(46_000);
    const f2 = (await finishAs(a, r2, [])).json;
    assert.equal(f2.score, score(replay(r2.seed, [])));
    assert.equal(f2.best, Math.max(f1.score, f2.score));
  } finally { await w.cleanup(); }
});

test("another player's session is a 404; a new start supersedes the old one, across games; an unknown game is a 400", async () => {
  const w = await world();
  try {
    const [a, b] = w.students;
    const r1 = await startRound(a);
    w.advance(46_000);
    assert.equal((await finishAs(b, r1, [])).status, 404);
    const r2 = await startRound(a, 'billdash');                           // one open round per player, whichever game
    assert.deepEqual(w.rows("SELECT id FROM arcade_runs WHERE player_id = ? AND status = 'open'", a.id).map((r) => r.id), [r2.session]);
    assert.equal((await finishAs(a, r1, [])).status, 409);
    assert.equal((await a.client.post('/api/arcade/start', { game: 'diversifY' })).status, 400);
    assert.equal((await a.client.post('/api/arcade/start', { game: 'constructor' })).status, 400);
    assert.equal((await a.client.post('/api/arcade/start', {})).status, 400);
  } finally { await w.cleanup(); }
});

test('bad inputs: the mask range is the game\'s own (0-15 here, 0-7 for Bill Dash); everything else as for Bill Dash', async () => {
  const w = await world();
  try {
    const [a] = w.students;
    const r = await startRound(a);
    w.advance(46_000);
    const big = Array.from({ length: C.MAX_INPUTS + 1 }, (_, i) => [i % C.ROUND, 0]);
    for (const bad of ['x', {}, null, 7, [[1]], [[1, 2, 3]], [['1', 2]], [[1.5, 2]], [[1, 2.5]], [[5, 1], [5, 2]], [[9, 1], [3, 2]], [[-1, 1]], [[C.ROUND, 1]], [[0, 16]], [[0, -1]], [1, 2], big, undefined]) {
      const res = await finishAs(a, r, bad);
      assert.equal(res.status, 400, `${JSON.stringify(bad)?.slice(0, 40)} -> ${res.status}`);
    }
    assert.equal(w.rows('SELECT status FROM arcade_runs WHERE id = ?', r.session)[0].status, 'open', 'a malformed finish does not burn the round');
    assert.equal((await finishAs(a, r, [[0, 15], [1, 8], [C.ROUND - 1, 4]])).status, 200, 'mask 15 and the edges are valid');
    const bd = await startRound(a, 'billdash');
    assert.equal((await finishAs(a, bd, [[0, 8]])).status, 400, 'Bill Dash still stops at 7');
  } finally { await w.cleanup(); }
});

test('a finish faster than 40% of the play time is rejected for Diversify too (a round never ends early, so 18 s is the floor)', async () => {
  const w = await world();
  try {
    const [a] = w.students;
    const r1 = await startRound(a);
    w.advance(17_000);
    const fast = await finishAs(a, r1, bot(r1.seed, spread));
    assert.equal(fast.status, 422);
    assert.deepEqual({ ...w.rows('SELECT status, flag, score FROM arcade_runs WHERE id = ?', r1.session)[0] }, { status: 'rejected', flag: 'fast', score: null });
    const r2 = await startRound(a);
    w.advance(18_500);
    assert.equal((await finishAs(a, r2, [])).status, 200);
  } finally { await w.cleanup(); }
});

test('per game: best, plays and class board are separate; /state lists both games, each with its own board', async () => {
  const w = await world({ n: 3 });
  try {
    const [a, b] = w.students;
    const play = async (s, game, inputs) => { const r = await startRound(s, game); w.advance(46_000); const f = await finishAs(s, r, inputs(r.seed)); assert.equal(f.status, 200); return f.json; };
    const bd = await play(a, 'billdash', () => []);                      // Bill Dash, no input: scores 0 at the three-heart stop
    const dv = await play(a, 'diversify', (seed) => bot(seed, spread));
    const dv2 = await play(b, 'diversify', (seed) => bot(seed, allCash));
    assert.ok(dv.score > 0);
    const st = (await a.client.get('/api/arcade/state')).json;
    st.games = st.games.filter((g) => g.kind !== 'daily');                 // this test is about the two replay games; FinWord is a daily game with no board
    assert.deepEqual(st.games.map((g) => g.key), ['billdash', 'diversify', 'debtsnake']);
    const [gb, gd] = st.games;
    assert.deepEqual([gb.best, gb.plays, gd.best, gd.plays], [bd.score, 1, dv.score, 1]);
    assert.deepEqual(gb.leaderboard.map((r) => [r.username, r.best]), [[a.username, bd.score]], 'Bill Dash board: only Bill Dash scores');
    assert.deepEqual(gd.leaderboard.map((r) => [r.username, r.best]), [[a.username, dv.score], [b.username, dv2.score]].sort((x, y) => y[1] - x[1]), 'Diversify board: only Diversify scores');
    assert.deepEqual(st.leaderboard, gb.leaderboard, 'the old top-level board is still Bill Dash\'s');
    assert.equal(st.my_best, bd.score);
    assert.equal(gd.ticks, 1350);
    assert.ok(gd.blurb.length > 20 && gd.title === 'Diversify');
    assert.equal(dv.best, dv.score);
    assert.equal(dv.leaderboard.length, 1, 'the finish returns that game\'s own board');
    assert.equal(dv2.leaderboard.length, 2);
    assert.equal((await b.client.get('/api/arcade/state')).json.games.filter((g) => g.kind !== 'daily')[0].best, null, 'b never played Bill Dash');
    // a Bill Dash score, however big, cannot appear in Diversify's board
    w.srv.app.db.prepare("UPDATE arcade_runs SET score = 99999 WHERE game = 'billdash'").run();
    const again = (await a.client.get('/api/arcade/state')).json.games.filter((g) => g.kind !== 'daily');
    assert.equal(again[0].best, 99999);
    assert.ok(again[1].leaderboard.every((r) => r.best < 99999) && again[1].best === dv.score);
  } finally { await w.cleanup(); }
});

test('the start throttle is per game: 12 rounds an hour of each, so using up one game never blocks the other', async () => {
  const w = await world();
  try {
    const [a] = w.students;
    for (let i = 0; i < 12; i++) await startRound(a, i % 2 ? 'billdash' : 'diversify');   // 6 of each: neither is full
    for (let i = 0; i < 6; i++) await startRound(a, 'diversify');
    assert.equal((await a.client.post('/api/arcade/start', { game: 'diversify' })).status, 429);
    await startRound(a, 'billdash');                                                        // Bill Dash still has 5 left
  } finally { await w.cleanup(); }
});

test('the panel ships both games\' scripts, with the cache token filled in', async () => {
  const w = await world({ n: 1 });
  try {
    for (const f of ['arcade.js', 'arcade.css', 'teach.js', 'games/billdash.js', 'games/billdash-core.js', 'games/diversify.js', 'games/diversify-core.js']) {
      const res = await fetch(`${w.srv.base}/m/arcade/${f}`);
      assert.equal(res.status, 200, f);
      if (f.endsWith('.js')) assert.doesNotMatch(await res.text(), /__V__/, f);
    }
  } finally { await w.cleanup(); }
});

// ---------- the Today errand ----------
test('"Play a round of Diversify" completes once for at most $0.50 x the index; a Bill Dash round does not complete it, nor a Diversify round the Bill Dash one', async () => {
  const config = { courses: { fintech10: { label: 'x', modules: ['bank-basic', 'arcade', 'today'] }, fintech2030: { label: 'y', modules: ['bank-basic', 'arcade', 'today'] } } };
  const w = await world({ n: 3, config });
  try {
    const [a, b, c] = w.students;
    const errand = async (s, title) => (await s.client.get('/api/today/state')).json.errands.find((e) => e.title === title);
    const DV = 'Play a round of Diversify', BD = 'Play a round of Bill Dash';
    const open = async (s) => ({ dv: await errand(s, DV), bd: await errand(s, BD) });
    // the three picks per day are chosen per player; make sure the errands we are about to play are among them by looking at what is offered
    const offered = [];
    for (const s of [a, b, c]) offered.push(await open(s));
    const dvOffered = [a, b, c].filter((s, i) => offered[i].dv);
    assert.ok(offered.every((o) => o.bd), 'and the Bill Dash errand too');
    const meta = ERRANDS_META();
    assert.deepEqual([meta.building, meta.reward_cents <= 50, meta.energy, meta.priority, meta.done.event], ['arcade', true, 1, 6, 'module.arcade.played_diversify']);
    assert.equal(ERRANDS_META('play-bill-dash').done.event, 'module.arcade.played', 'the Bill Dash errand keeps its own event');
    const play = async (s, game, inputs) => { const r = await startRound(s, game); w.advance(46_000); const f = await finishAs(s, r, inputs(r.seed)); assert.equal(f.status, 200); };
    assert.equal(dvOffered.length, 3, 'with only bank-basic, arcade and today loaded, both arcade errands are in everyone\'s three');
    const who = dvOffered[0];
    const i = [a, b, c].indexOf(who);
    const before = w.srv.app.ledger.balance(who.chequing.id);
    if (offered[i].bd) { await play(who, 'billdash', () => [[0, 4], [1, 0]]); assert.equal((await errand(who, DV)).status, 'open', 'a Bill Dash round does not complete the Diversify errand'); assert.equal((await errand(who, BD)).status, 'done'); }
    await play(who, 'diversify', (seed) => bot(seed, spread));
    const done = await errand(who, DV);
    assert.equal(done.status, 'done');
    assert.ok(done.reward_cents > 0 && done.reward_cents <= 100, `reward ${done.reward_cents}`);
    await play(who, 'diversify', (seed) => bot(seed, spread));
    assert.equal(w.rows("SELECT COUNT(*) AS n FROM txns WHERE kind = 'today.errand' AND json_extract(meta, '$.template') = 'play-diversify'")[0].n, 1, 'paid once');
    const bdPaid = offered[i].bd ? 1 : 0;
    assert.equal(w.srv.app.ledger.balance(who.chequing.id) - before, done.reward_cents + (bdPaid ? (await errand(who, BD)).reward_cents : 0));
    const other = [a, b, c].find((s) => s !== who);
    assert.notEqual((await errand(other, DV))?.status, 'done', 'only the student who played');
    assert.equal(w.srv.app.ledger.audit().ok, true);
  } finally { await w.cleanup(); }
});

test('an empty input log still scores but never completes an errand (either game): no errand for a round nobody played', async () => {
  const config = { courses: { fintech10: { label: 'x', modules: ['bank-basic', 'arcade', 'today'] }, fintech2030: { label: 'y', modules: ['bank-basic', 'arcade', 'today'] } } };
  const w = await world({ n: 1, config });
  try {
    const [a] = w.students;
    const status = async (title) => (await a.client.get('/api/today/state')).json.errands.find((e) => e.title === title).status;
    for (const game of ['diversify', 'billdash']) {
      const r = await startRound(a, game);
      w.advance(46_000);
      const fin = await finishAs(a, r, []);
      assert.equal(fin.status, 200);
      assert.equal(typeof fin.json.score, 'number');
      assert.equal(await status(game === 'diversify' ? 'Play a round of Diversify' : 'Play a round of Bill Dash'), 'open', `${game}: nothing pressed, no errand`);
    }
    const r = await startRound(a);
    w.advance(46_000);
    assert.equal((await finishAs(a, r, [[5, 4]])).status, 200);
    assert.equal(await status('Play a round of Diversify'), 'done', 'one recorded input is a played round');
  } finally { await w.cleanup(); }
});
const ERRANDS = JSON.parse(fs.readFileSync(new URL('../modules/today/errands.json', import.meta.url), 'utf8'));
function ERRANDS_META(id = 'play-diversify') { return ERRANDS.find((e) => e.id === id); }

// ---------- the teacher panel ----------
test('teacher panel: both games per class with the same fields, scoped to the teacher; the class totals still cover everything', async () => {
  const w = await world({ n: 2 });
  try {
    const [a, b] = w.students;
    const play = async (s, game, inputs) => { const r = await startRound(s, game); w.advance(46_000); assert.equal((await finishAs(s, r, inputs(r.seed))).status, 200); };
    await play(a, 'diversify', (seed) => bot(seed, spread));
    await play(b, 'diversify', (seed) => bot(seed, allCash));
    await play(a, 'billdash', () => []);
    const r = await startRound(b);
    w.advance(1000);
    assert.equal((await finishAs(b, r, [])).status, 422);
    const got = (await w.teacher.get('/api/arcade/teach')).json;
    const c = got.classes[0];
    assert.deepEqual(c.games.map((g) => g.key), ['billdash', 'diversify', 'debtsnake', 'quickcash']);
    const [gb, gd] = c.games;
    for (const g of [gb, gd]) assert.deepEqual(Object.keys(g).sort(), ['best', 'finished', 'key', 'players', 'recent', 'rejected', 'rejected_by', 'title']);
    assert.deepEqual([gb.title, gb.finished, gb.players, gb.rejected], ['Bill Dash', 1, 1, 0]);
    assert.deepEqual([gd.title, gd.finished, gd.players, gd.rejected, gd.rejected_by], ['Diversify', 2, 2, 1, { fast: 1 }]);
    assert.equal(gd.best.game, 'diversify');
    assert.ok(gd.recent.every((x) => x.game === 'diversify') && gd.recent.length === 2);
    assert.deepEqual([c.finished, c.rejected, c.players], [3, 1, 2], 'the class line counts every game');
    assert.equal((await a.client.get('/api/arcade/teach')).status, 403);
  } finally { await w.cleanup(); }
});

test('the teacher panel script and the arcade panel script do not call Bill Dash the only game', () => {
  const ui = fs.readFileSync(new URL('../modules/arcade/ui/teach.js', import.meta.url), 'utf8');
  assert.match(ui, /c\.games/);
  assert.doesNotMatch(ui.match(/const said = .*/)[0].split('//')[0], /best/, 'the all-games line has no best: the two games score on different scales');
  assert.match(ui, /bestOf\(g\)/, 'each game section keeps its own best');
  const bdcore = billdash.C;
  assert.equal(bdcore.MASK_MAX, undefined, 'Bill Dash core is untouched: its mask stays 0-7 through the server default');
});
