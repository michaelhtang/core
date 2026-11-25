// arcade (docs/arcade.md): Bill Dash's core is a deterministic integer game; the server replays recorded inputs through the same file and
// is the only one who computes the score. Core determinism and shape, the replay budget, the start/finish API (tamper, double finish, other
// player, expiry, bad inputs, closed season, throttle, auth, module off) and the Today errand.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createClock } from '../lib/clock.js';
import { boot, seeded } from './helpers.js';
import { C, KINDS, SALE, createGame, step, score, isOver, replay, yOf } from '../modules/arcade/ui/games/billdash-core.js';

const REAL = JSON.parse(fs.readFileSync(new URL('../config/vdaa.json', import.meta.url), 'utf8'));
const CORE_SRC = fs.readFileSync(new URL('../modules/arcade/ui/games/billdash-core.js', import.meta.url), 'utf8');

// A greedy player written against the public core: the lowest useful item, skip SALE and bills it cannot afford, tap every other tick so each
// press is an edge. skill 0..: ticks it waits after first seeing an item. Returns the change list it pressed (what a client would record).
function play(seed, { wait = 0, sloppy = false } = {}) {
  const s = createGame(seed), seen = new Map(), log = [];
  let last = 0, flip = 0;
  while (!isOver(s)) {
    for (const it of s.items) if (!seen.has(it.id)) seen.set(it.id, s.tick);
    const target = s.items.filter((it) => (sloppy || it.kind !== SALE) && (sloppy || it.kind === 4 || KINDS[it.kind].cost <= s.cash) && s.tick - seen.get(it.id) >= wait).sort((a, b) => b.y - a.y)[0];
    let mask = 0;
    if (target && !(flip++ & 1)) mask = target.lane !== s.lane ? (target.lane < s.lane ? 1 : 2) : yOf(target) >= C.PAY_TOP ? 4 : 0;
    if (mask !== last) { log.push([s.tick, mask]); last = mask; }
    step(s, mask);
  }
  return log;
}
// mulberry-free pseudo-random presses for the "random inputs" baseline (its own tiny LCG; the test file is not the core)
function randomLog(seed) {
  let r = seed >>> 0, last = 0;
  const log = [];
  for (let t = 0; t < C.ROUND; t++) {
    r = (Math.imul(r, 1664525) + 1013904223) >>> 0;
    const mask = (r >>> 24) & 7;
    if (mask !== last) { log.push([t, mask]); last = mask; }
  }
  return log;
}

// ---------- the core ----------
test('core: the same seed and inputs give the same score and state; other seeds differ', () => {
  const inputs = play(1234);
  const a = replay(1234, inputs), b = replay(1234, inputs);
  assert.deepEqual(a, b);
  assert.equal(score(a), score(b));
  assert.ok(score(a) > 0);
  const seeds = [1, 2, 3, 4, 5, 6, 7, 8].map((n) => score(replay(n * 7919, play(n * 7919))));
  assert.ok(new Set(seeds).size > 4, `another seed plays another round: ${seeds}`);
  assert.notEqual(JSON.stringify(replay(1234, inputs)), JSON.stringify(replay(4321, inputs)));
  assert.notDeepEqual(replay(1, []).items, replay(2, []).items);
});

test('core: no input ends early with a low score; a greedy player scores far above random presses; the round is capped at 1350 ticks', () => {
  const none = replay(99, []);
  assert.equal(score(none), 0);
  assert.ok(none.over && none.lives === 0 && none.tick < C.ROUND, 'three late bills end it before time is up');
  const seeds = [11, 22, 33, 44, 55, 66, 77, 88];
  const avg = (f) => seeds.reduce((t, sd) => t + score(replay(sd, f(sd))), 0) / seeds.length;
  const bot = avg(play), rnd = avg(randomLog);
  assert.ok(bot > 300, `greedy bot averages ${bot}`);
  assert.ok(bot > rnd * 2, `greedy ${bot} vs random ${rnd}`);
  // a flawless-hearts round stops at the cap, and extra input after the end changes nothing
  const s = createGame(5);
  s.lives = 99;
  for (let i = 0; i < 5000; i++) step(s, 0);
  assert.equal(s.tick, C.ROUND);
  assert.ok(s.over);
  const frozen = JSON.stringify(s);
  step(s, 7);
  assert.equal(JSON.stringify(s), frozen);
});

test('core: a sloppy player who pays what they cannot afford and buys SALE tags scores well below a careful one', () => {
  const seeds = [11, 22, 33, 44, 55, 66];
  const avg = (o) => seeds.reduce((t, sd) => t + score(replay(sd, play(sd, o))), 0) / seeds.length;
  assert.ok(avg({ wait: 25, sloppy: true }) < avg({}) * 0.85);
  const g = createGame(3);   // an impulse buy costs cash and scores nothing
  g.items = [{ id: 1, kind: SALE, lane: g.lane, y: C.PAY_TOP << 4 }];
  step(g, 4);
  assert.equal(g.cash, C.START_CASH - C.SALE_COST);
  assert.equal(g.score, 0);
  assert.equal(g.stats.impulse, 1);
  const n = createGame(3);   // a bill with too little cash stays, and costs a little
  n.cash = 0; n.items = [{ id: 1, kind: 0, lane: n.lane, y: C.PAY_TOP << 4 }];
  step(n, 4);
  assert.equal(n.items.length, 1);
  assert.equal(n.score, -C.NSF_PENALTY);
  assert.equal(score(n), 0, 'the final score floors at 0');
});

test('core: import-free and integer-only (no imports, no Math.random, no Date, no trig/sqrt/floor/round, no division, no decimal literals)', () => {
  const code = CORE_SRC.split('\n').map((l) => l.replace(/\/\/.*$/, '')).join('\n');
  assert.doesNotMatch(code, /\bimport\b|\brequire\b/);
  assert.doesNotMatch(code, /Math\.random|\bDate\b|performance\.|Math\.(sin|cos|tan|sqrt|floor|ceil|round|pow|exp|log|trunc|hypot)/);
  assert.deepEqual([...new Set(code.match(/Math\.\w+/g))].sort(), ['Math.imul', 'Math.max', 'Math.min']);
  assert.doesNotMatch(code, /\d\.\d/, 'no float literals');
  assert.doesNotMatch(code.replace(/`[^`]*`/g, ''), /[^/*\s]\s*\/\s*[^/*\s]/, 'no division');
});

test('the game scripts under ui/games parse (ui-syntax only walks ui/*.js)', () => {
  const dir = new URL('../modules/arcade/ui/games/', import.meta.url).pathname;
  for (const f of fs.readdirSync(dir)) execFileSync(process.execPath, ['--check', path.join(dir, f)], { stdio: 'pipe' });
});

test('replay of a full 1350-tick round takes well under 20 ms', () => {
  const inputs = play(4242);
  assert.ok(inputs.length > 50);
  const full = [];
  for (let t = 0; t < C.ROUND; t += 2) full.push([t, t % 4 === 0 ? 0 : 5]);   // a 675-entry log that never loses (hearts aside) to time the worst loop
  replay(1, full);                                                              // warm up the JIT: the server's first call is cold, so also check that below
  for (const log of [inputs, full]) {
    const t0 = process.hrtime.bigint();
    for (let i = 0; i < 10; i++) replay(4242 + i, log);
    const ms = Number(process.hrtime.bigint() - t0) / 1e6 / 10;
    assert.ok(ms < 20, `replay took ${ms.toFixed(2)} ms`);
  }
  const cold = process.hrtime.bigint();
  const hearts = createGame(7); hearts.lives = 99;
  while (!isOver(hearts)) step(hearts, 0);                                      // the longest possible round: all 1350 ticks
  assert.equal(hearts.tick, C.ROUND);
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
const startRound = async (s) => { const r = await s.client.post('/api/arcade/start', { game: 'billdash' }); assert.equal(r.status, 200, JSON.stringify(r.json)); return r.json; };

test('start then finish: the server score is its own replay, whatever the body says; the run is stored and counted once', async () => {
  const w = await world();
  try {
    const [a] = w.students;
    const round = await startRound(a);
    assert.match(round.session, /^[0-9a-f]{32}$/);
    assert.equal(round.ticks, C.ROUND);
    assert.ok(Number.isInteger(round.seed) && round.seed >= 0 && round.seed < 2 ** 32);
    const inputs = play(round.seed);
    const expected = score(replay(round.seed, inputs));
    assert.ok(expected > 0);
    w.advance(46_000);
    const fin = await a.client.post('/api/arcade/finish', { session: round.session, game: 'billdash', inputs, score: 999999, best: 999999 });
    assert.equal(fin.status, 200, JSON.stringify(fin.json));
    assert.equal(fin.json.score, expected);
    assert.equal(fin.json.best, expected);
    assert.equal(fin.json.new_best, true);
    assert.deepEqual(fin.json.leaderboard.map((r) => [r.username, r.best, r.mine]), [[a.username, expected, true]]);
    const row = w.rows('SELECT * FROM arcade_runs WHERE id = ?', round.session)[0];
    assert.equal(row.status, 'finished');
    assert.equal(row.score, expected);
    assert.equal(row.seed, round.seed);
    // double finish: rejected, and nothing is counted twice
    const again = await a.client.post('/api/arcade/finish', { session: round.session, inputs });
    assert.equal(again.status, 409);
    assert.equal(w.rows("SELECT COUNT(*) AS n FROM arcade_runs WHERE status = 'finished'")[0].n, 1);
    // state: personal best and board come from verified runs only
    const st = (await a.client.get('/api/arcade/state')).json;
    assert.equal(st.world_active, true);
    assert.equal(st.my_best, expected);
    assert.equal(st.games[0].key, 'billdash');
    assert.equal(st.games[0].plays, 1);
    assert.equal(st.leaderboard.length, 1);
  } finally { await w.cleanup(); }
});

test('tampered inputs change the score (and only the replay decides); a worse second round does not lower the best', async () => {
  const w = await world();
  try {
    const [a] = w.students;
    const r1 = await startRound(a);
    const honest = play(r1.seed);
    // drop more and more of the opening moves until the score changes: for about 8% of seeds dropping the first 8 changes nothing
    const tampered = [honest.slice(8), honest.slice(16), honest.slice(32), []].find((t) => score(replay(r1.seed, t)) !== score(replay(r1.seed, honest)));
    assert.ok(tampered, 'some tamper must matter for this seed');
    w.advance(46_000);
    const f1 = (await a.client.post('/api/arcade/finish', { session: r1.session, inputs: tampered })).json;
    assert.equal(f1.score, score(replay(r1.seed, tampered)));
    const r2 = await startRound(a);
    w.advance(46_000);
    const f2 = (await a.client.post('/api/arcade/finish', { session: r2.session, inputs: [] })).json;
    assert.equal(f2.score, 0);
    assert.equal(f2.best, f1.score);
    assert.equal(f2.new_best, false);
  } finally { await w.cleanup(); }
});

test("another player's session, a missing session and a different game are refused; a new start supersedes the old one", async () => {
  const w = await world();
  try {
    const [a, b] = w.students;
    const r1 = await startRound(a);
    w.advance(46_000);
    assert.equal((await b.client.post('/api/arcade/finish', { session: r1.session, inputs: [] })).status, 404);
    assert.equal((await a.client.post('/api/arcade/finish', { session: 'f'.repeat(32), inputs: [] })).status, 404);
    assert.equal((await a.client.post('/api/arcade/finish', { session: r1.session, game: 'nope', inputs: [] })).status, 400);
    assert.equal((await a.client.post('/api/arcade/start', { game: 'nope' })).status, 400);
    const r2 = await startRound(a);                                      // supersedes r1
    assert.notEqual(r2.session, r1.session);
    assert.equal((await a.client.post('/api/arcade/finish', { session: r1.session, inputs: [] })).status, 409);
    assert.deepEqual(w.rows("SELECT id FROM arcade_runs WHERE player_id = ? AND status = 'open'", a.id).map((r) => r.id), [r2.session]);
    w.advance(46_000);
    assert.equal((await a.client.post('/api/arcade/finish', { session: r2.session, inputs: [] })).status, 200);
  } finally { await w.cleanup(); }
});

test('an expired round (10 minutes) is refused; a finish faster than 40% of the play time is rejected, not counted', async () => {
  const w = await world();
  try {
    const [a] = w.students;
    const r1 = await startRound(a);
    w.advance(11 * 60e3);
    assert.equal((await a.client.post('/api/arcade/finish', { session: r1.session, inputs: [] })).status, 409);
    assert.equal(w.rows('SELECT status FROM arcade_runs WHERE id = ?', r1.session)[0].status, 'expired');
    const r2 = await startRound(a);
    const inputs = play(r2.seed);
    w.advance(3000);                                                     // a 45 s round in 3 s
    const fast = await a.client.post('/api/arcade/finish', { session: r2.session, inputs });
    assert.equal(fast.status, 422);
    const row = w.rows('SELECT status, flag, score FROM arcade_runs WHERE id = ?', r2.session)[0];
    assert.deepEqual({ ...row }, { status: 'rejected', flag: 'fast', score: null });
    assert.equal((await a.client.post('/api/arcade/finish', { session: r2.session, inputs })).status, 409, 'no second try with the same round');
    assert.equal((await a.client.get('/api/arcade/state')).json.my_best, null);
    // a round that ends early (no input: three hearts gone) needs only 40% of the ticks it actually played
    const r3 = await startRound(a);
    const early = replay(r3.seed, []);
    assert.ok(early.tick < C.ROUND / 2);
    w.advance(Math.ceil((early.tick * 1000 * 0.4) / C.TPS) + 500);
    assert.equal((await a.client.post('/api/arcade/finish', { session: r3.session, inputs: [] })).status, 200);
  } finally { await w.cleanup(); }
});

test('bad inputs: wrong types, unsorted or duplicate ticks, out-of-range ticks and masks, too many entries, a bad session id', async () => {
  const w = await world();
  try {
    const [a] = w.students;
    const r = await startRound(a);
    w.advance(46_000);
    const finish = (inputs, extra = {}) => a.client.post('/api/arcade/finish', { session: r.session, inputs, ...extra });
    const big = Array.from({ length: C.MAX_INPUTS + 1 }, (_, i) => [i % C.ROUND, 0]);
    for (const bad of ['x', {}, null, 7, [[1]], [[1, 2, 3]], [['1', 2]], [[1.5, 2]], [[1, 2.5]], [[5, 1], [5, 2]], [[9, 1], [3, 2]], [[-1, 1]], [[C.ROUND, 1]], [[0, 8]], [[0, -1]], [1, 2], big, undefined]) {
      const res = await finish(bad);
      assert.equal(res.status, 400, `${JSON.stringify(bad)?.slice(0, 40)} -> ${res.status}`);
    }
    assert.equal((await a.client.post('/api/arcade/finish', { session: 'nope', inputs: [] })).status, 400);
    assert.equal((await a.client.post('/api/arcade/finish', { session: 7, inputs: [] })).status, 400);
    assert.equal(w.rows('SELECT status FROM arcade_runs WHERE id = ?', r.session)[0].status, 'open', 'a malformed finish does not burn the round');
    assert.equal((await finish([[0, 4], [1, 0], [C.ROUND - 1, 2]])).status, 200, 'the edges are valid');
  } finally { await w.cleanup(); }
});

test('unauthenticated: 401; a closed season: no new rounds (409) and no finishes', async () => {
  const w = await world();
  try {
    const anon = w.srv.client();
    assert.equal((await anon.get('/api/arcade/state')).status, 401);
    assert.equal((await anon.post('/api/arcade/start', { game: 'billdash' })).status, 401);
    assert.equal((await anon.post('/api/arcade/finish', { session: 'a'.repeat(32), inputs: [] })).status, 401);
    const [a] = w.students;
    const r = await startRound(a);
    assert.equal((await w.teacher.post('/api/teach/world/close')).status, 200);
    const closed = await a.client.post('/api/arcade/start', { game: 'billdash' });
    assert.equal(closed.status, 409);
    assert.match(closed.json.error, /season is closed/i);
    w.advance(46_000);
    assert.equal((await a.client.post('/api/arcade/finish', { session: r.session, inputs: [] })).status, 409);
    const st = await a.client.get('/api/arcade/state');
    assert.equal(st.status, 200);
    assert.equal(st.json.world_active, false);
    assert.deepEqual(st.json.leaderboard, []);
  } finally { await w.cleanup(); }
});

test('the start throttle: 12 rounds an hour per student per game, games and other students unaffected, and the hour passes', async () => {
  const w = await world();
  try {
    const [a, b] = w.students;
    for (let i = 0; i < 12; i++) await startRound(a);
    const over = await a.client.post('/api/arcade/start', { game: 'billdash' });
    assert.equal(over.status, 429);
    assert.match(over.json.error, /12 rounds of Bill Dash this hour.*another game.*\d+ minutes?/);
    // each game has its own limit: a full Bill Dash hour does not block Diversify, and the reverse
    for (let i = 0; i < 12; i++) assert.equal((await a.client.post('/api/arcade/start', { game: 'diversify' })).status, 200);
    const over2 = await a.client.post('/api/arcade/start', { game: 'diversify' });
    assert.equal(over2.status, 429);
    assert.match(over2.json.error, /rounds of Diversify/);
    await startRound(b);
    w.advance(3600e3 + 1000);
    await startRound(a);
  } finally { await w.cleanup(); }
});

test('a course that does not enable arcade gets 404 on every arcade route and no panel', async () => {
  const config = structuredClone(REAL);
  config.courses.fintech10.modules = config.courses.fintech10.modules.filter((m) => m !== 'arcade');
  const w = await world({ n: 1, config });
  try {
    const [a] = w.students;
    assert.equal((await a.client.get('/api/arcade/state')).status, 404);
    assert.equal((await a.client.post('/api/arcade/start', { game: 'billdash' })).status, 404);
    assert.ok(!(await a.client.get('/api/me')).json.panels.some((p) => p.module === 'arcade'));
    // (and where it is on, the door and its script are there)
    const on = await world({ n: 1 });
    try {
      const panel = (await on.students[0].client.get('/api/me')).json.panels.find((p) => p.module === 'arcade');
      assert.equal(panel.building.key, 'arcade');
      assert.match(panel.src, /^\/m\/arcade\/arcade\.js\?v=/);
      for (const f of ['arcade.js', 'arcade.css', 'games/billdash.js', 'games/billdash-core.js']) {
        const res = await fetch(`${on.srv.base}/m/arcade/${f}`);
        assert.equal(res.status, 200, f);
        if (f.endsWith('.js')) assert.doesNotMatch(await res.text(), /__V__/, 'the cache token is filled in');
      }
    } finally { await on.cleanup(); }
    assert.deepEqual(w.rows("SELECT id FROM arcade_runs"), []);
  } finally { await w.cleanup(); }
});

test('the class board: top 10 of the student\'s own class, best verified run each, pseudonyms only', async () => {
  const w = await world({ n: 3 });
  try {
    const runs = [];
    for (const [i, s] of w.students.entries()) {
      const r = await startRound(s);
      w.advance(46_000);
      const inputs = i === 2 ? [] : play(r.seed, { wait: i * 20 });
      const fin = await s.client.post('/api/arcade/finish', { session: r.session, inputs });
      assert.equal(fin.status, 200);
      runs.push([s.username, fin.json.score]);
    }
    const board = (await w.students[0].client.get('/api/arcade/state')).json.leaderboard;
    assert.deepEqual(board.map((r) => [r.username, r.best]), runs.slice().sort((x, y) => y[1] - x[1]).map(([u, b]) => [u, b]));
    assert.deepEqual(board.map((r) => r.rank), [1, 2, 3]);
    assert.deepEqual(Object.keys(board[0]).sort(), ['best', 'mine', 'rank', 'username']);
  } finally { await w.cleanup(); }
});

// ---------- the Today errand ----------
test('a verified finish completes "Play a round of Bill Dash" once, for at most $1.00; a second round pays nothing more', async () => {
  const config = { courses: { fintech10: { label: 'x', modules: ['bank-basic', 'arcade', 'today'] }, fintech2030: { label: 'y', modules: ['bank-basic', 'arcade', 'today'] } } };
  const w = await world({ n: 2, config });
  try {
    const [a, b] = w.students;
    const errand = async (s) => (await s.client.get('/api/today/state')).json.errands.find((e) => e.title === 'Play a round of Bill Dash');
    assert.equal((await errand(a)).status, 'open');
    assert.equal((await errand(b)).status, 'open');
    const before = w.srv.app.ledger.balance(a.chequing.id);
    const play1 = async (s) => { const r = await startRound(s); w.advance(46_000); return s.client.post('/api/arcade/finish', { session: r.session, inputs: play(r.seed) }); };
    assert.equal((await play1(a)).status, 200);
    const done = await errand(a);
    assert.equal(done.status, 'done');
    assert.ok(done.reward_cents > 0 && done.reward_cents <= 100, `reward ${done.reward_cents}`);
    assert.equal(w.srv.app.ledger.balance(a.chequing.id) - before, done.reward_cents);
    assert.equal((await errand(b)).status, 'open', 'only the student who played');
    assert.equal((await play1(a)).status, 200);
    assert.equal(w.rows("SELECT COUNT(*) AS n FROM txns WHERE kind = 'today.errand' AND json_extract(meta, '$.template') = 'play-bill-dash'")[0].n, 1, 'paid once');
    assert.equal(w.srv.app.ledger.balance(a.chequing.id) - before, done.reward_cents);
    // a rejected (too fast) finish emits nothing: b's errand stays open
    const r = await startRound(b);
    w.advance(2000);
    assert.equal((await b.client.post('/api/arcade/finish', { session: r.session, inputs: play(r.seed) })).status, 422);
    assert.equal((await errand(b)).status, 'open');
    assert.equal(w.srv.app.ledger.audit().ok, true);
  } finally { await w.cleanup(); }
});

// The Arcade grid shows a picture for every in-app game; a new game in GAMES needs its jpg in ui/thumbs (a missing one is a broken tile).
test('every game the Arcade lists has a thumbnail served at /m/arcade/thumbs/<key>.jpg', async () => {
  const w = await world({ n: 1 });
  try {
    w.srv.app.db.exec('DELETE FROM arcade_class_off');                       // every game on again, so every tile is checked
    const keys = (await w.students[0].client.get('/api/arcade/state')).json.games.map((g) => g.key);
    assert.ok(keys.length >= 2);
    for (const key of keys) {
      const pic = await fetch(`${w.srv.base}/m/arcade/thumbs/${key}.jpg`);
      assert.equal(pic.status, 200, `thumbnail for ${key}`);
      assert.equal(pic.headers.get('content-type'), 'image/jpeg');
    }
  } finally { await w.cleanup(); }
});
