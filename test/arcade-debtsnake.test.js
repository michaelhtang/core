// Debt Snake's server side (docs/debtsnake.md, docs/arcade.md): /start takes optional options for the core and stores them with the mode key,
// /finish replays with the stored options and never trusts the client, best / plays / the class board are per mode key, the Today errand has its
// own event, and a teacher can switch the game off. The core itself is tested on its own branch (test/debtsnake-core.test.js); here it is only used.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createClock } from '../lib/clock.js';
import { boot, seeded, addClass } from './helpers.js';
import { C, MODE_KEYS, parseOptions, optionKey, replay, score } from '../modules/arcade/ui/games/debtsnake-core.js';
import * as billdash from '../modules/arcade/ui/games/billdash-core.js';

const SMALL = { courses: { fintech10: { label: 'x', modules: ['bank-basic', 'arcade', 'games', 'today'] }, fintech2030: { label: 'y', modules: ['bank-basic', 'arcade', 'games', 'today'] } } };
const T0 = Date.parse('2026-11-02T15:00:00Z');
const ERRANDS = JSON.parse(fs.readFileSync(new URL('../modules/today/errands.json', import.meta.url), 'utf8'));

async function world({ n = 2 } = {}) {
  let t = T0;
  const srv = await boot({ config: SMALL, clock: createClock({ now: () => t }) });
  const w = await seeded(srv, n, { transfers: false });
  const other = await addClass(srv, w.teacher, 'Block 2', 1);
  srv.app.db.prepare("INSERT OR IGNORE INTO arcade_class_off (class_id, game) SELECT id, 'wordle' FROM classes").run(); for (const t of ['today_errands', 'today_state']) srv.app.db.exec(`DELETE FROM ${t}`);   // Today picks 3 errands a day: with four arcade errands on one could miss the day, so these worlds drop FinWord and let the day be picked again
  const advance = (ms) => { t += ms; };
  const nextDay = () => { t += 60_000; srv.app.world.advance({ months: 1 }); t += 60_000; };
  const rows = (sql, ...a) => srv.app.db.prepare(sql).all(...a);
  return { srv, ...w, other, advance, nextDay, rows, cleanup: srv.cleanup };
}
const start = (s, opts, game = 'debtsnake') => s.client.post('/api/arcade/start', opts === undefined ? { game } : { game, opts });
const startOk = async (s, opts) => { const r = await start(s, opts); assert.equal(r.status, 200, JSON.stringify(r.json)); return r.json; };
const finish = (s, round, inputs, extra = {}) => s.client.post('/api/arcade/finish', { session: round.session, game: 'debtsnake', inputs, ...extra });
const played = (w, s, round, inputs) => { w.advance(200_000); return finish(s, round, inputs); };   // a full round takes longer than 40% of 3 minutes: advance past the wall-time guard

// A change list of one-tick presses in a pseudo-random order (its own tiny LCG; a test is not the core). Bits: 1 up, 2 down, 4 left, 8 right.
function pressLog(n, every = 7) {
  let r = (n * 2654435761) >>> 0;
  const log = [];
  for (let t = 5; t < 1500; t += every) {
    r = (Math.imul(r, 1664525) + 1013904223) >>> 0;
    log.push([t, 1 << ((r >>> 24) & 3)], [t + 1, 0]);
  }
  return log;
}

test('core contract: the modes in the screen file are exactly the core\'s modes, in the same order', () => {
  const src = fs.readFileSync(new URL('../modules/arcade/ui/games/debtsnake.js', import.meta.url), 'utf8');
  const block = src.slice(src.indexOf('export const MODES'), src.indexOf('export const modeName'));
  assert.deepEqual([...block.matchAll(/\{ key: '(\w+)', name: '([^']+)', rule: '/g)].map((m) => m[1]), MODE_KEYS);
  assert.equal(C.ROUND, 5400);
});

test('the errand: same reward, energy and priority as Bill Dash (his decision), its own event', () => {
  const bd = ERRANDS.find((e) => e.id === 'play-bill-dash'), ds = ERRANDS.find((e) => e.id === 'play-debt-snake');
  assert.ok(ds);
  assert.equal(ds.title, 'Play a round of Debt Snake');
  for (const f of ['reward_cents', 'energy', 'priority', 'module', 'building']) assert.equal(ds[f], bd[f], f);
  assert.deepEqual(ds.when, [{ fact: 'arcade.debtsnakeOn', op: '==', value: true }]);
  assert.deepEqual(ds.done, { event: 'module.arcade.played_debtsnake' });
});

test('migration 004 adds opts and mode to arcade_runs; the older columns are still there', async () => {
  const w = await world({ n: 1 });
  try {
    const cols = w.rows('PRAGMA table_info(arcade_runs)').map((c) => c.name);
    for (const c of ['id', 'player_id', 'world_id', 'game', 'seed', 'score', 'ticks', 'status', 'flag', 'started_at', 'finished_at', 'opts', 'mode']) assert.ok(cols.includes(c), c);
  } finally { await w.cleanup(); }
});

test('start without opts uses the defaults; with opts it stores the normalized options and the mode key', async () => {
  const w = await world();
  try {
    const [a, b] = w.students;
    const plain = await startOk(a);
    assert.equal(plain.game, 'debtsnake');
    assert.equal(plain.ticks, C.ROUND);
    assert.deepEqual(plain.opts, parseOptions({}));
    assert.equal(plain.mode, 'classic');
    const row = w.rows('SELECT * FROM arcade_runs WHERE id = ?', plain.session)[0];
    assert.deepEqual(JSON.parse(row.opts), parseOptions({}));
    assert.equal(row.mode, 'classic');
    const mixed = await startOk(b, { modes: ['latefees', 'etransfer'], speed: 'fast', board: 'normal', coins: 3 });
    assert.equal(mixed.mode, 'etransfer+latefees', 'sorted mode keys joined by +');
    assert.deepEqual(mixed.opts, parseOptions({ modes: ['latefees', 'etransfer'], speed: 'fast', board: 'normal', coins: 3 }));
    assert.equal(mixed.mode, optionKey(mixed.opts));
    assert.deepEqual(JSON.parse(w.rows('SELECT opts FROM arcade_runs WHERE id = ?', mixed.session)[0].opts), mixed.opts);
    // Bill Dash and Diversify have no options: their rows keep opts and mode empty and their start answers exactly as before
    const bd = (await start(a, undefined, 'billdash')).json;
    assert.deepEqual(Object.keys(bd).sort(), ['game', 'seed', 'session', 'ticks']);
    const bdRow = w.rows('SELECT opts, mode FROM arcade_runs WHERE id = ?', bd.session)[0];
    assert.deepEqual([bdRow.opts, bdRow.mode], [null, null]);
    assert.equal((await start(a, { modes: ['nope'] }, 'billdash')).status, 200, 'a game without options ignores opts');
  } finally { await w.cleanup(); }
});

test('bad opts are a 400 with the core\'s own message, and burn nothing (an open round stays open)', async () => {
  const w = await world({ n: 1 });
  try {
    const [a] = w.students;
    const open = await startOk(a);
    const bad = [{ modes: ['nope'] }, { modes: 'classic' }, { modes: [] }, { speed: 'warp' }, { board: 'huge' }, { coins: 2 }, { coins: '3' }, 'classic', 7, [], { modes: ['latefees', 5] }];
    for (const opts of bad) {
      let why;
      try { parseOptions(opts); } catch (e) { why = e.message; }
      assert.ok(why, `the core rejects ${JSON.stringify(opts)}`);
      const r = await start(a, opts);
      assert.equal(r.status, 400, JSON.stringify(opts));
      assert.equal(r.json.error, why, 'the message is the core\'s');
    }
    assert.equal(w.rows("SELECT COUNT(*) AS n FROM arcade_runs WHERE game = 'debtsnake'")[0].n, 1, 'no row for a bad start');
    assert.equal(w.rows('SELECT status FROM arcade_runs WHERE id = ?', open.session)[0].status, 'open', 'the older round was not superseded');
  } finally { await w.cleanup(); }
});

test('finish replays with the options stored at start, whatever the client says; a client score is ignored', async () => {
  const w = await world({ n: 1 });
  try {
    const [a] = w.students;
    // no input at all: the snake runs straight on until it crashes, so the length of the round depends on the board and the speed
    const opts = { modes: ['practice', 'noborders'], speed: 'slow', board: 'large', coins: 5 };
    const round = await startOk(a, opts);
    const stored = JSON.parse(w.rows('SELECT opts FROM arcade_runs WHERE id = ?', round.session)[0].opts);
    const inputs = pressLog(3);
    const expected = replay(round.seed, inputs, stored);
    const asDefaults = replay(round.seed, inputs, parseOptions({}));
    assert.notEqual(JSON.stringify([expected.tick, score(expected)]), JSON.stringify([asDefaults.tick, score(asDefaults)]), 'the options change this round (or the test proves nothing)');
    const fin = await played(w, a, round, inputs);
    assert.equal(fin.status, 200, JSON.stringify(fin.json));
    const fake = await finish(a, round, inputs, { score: 99999, best: 99999, opts: { modes: ['classic'] }, mode: 'classic' });
    assert.equal(fake.status, 409, 'a round counts once');
    assert.equal(fin.json.score, score(expected), 'the score is the replay with the stored options');
    assert.equal(fin.json.ticks, expected.tick);
    assert.equal(fin.json.mode, optionKey(stored));
    assert.equal(w.rows('SELECT score FROM arcade_runs WHERE id = ?', round.session)[0].score, score(expected));
    // and a body that claims a score and other options, on a fresh round, is ignored the same way
    const r2 = await startOk(a, { modes: ['latefees'] });
    const f2 = await played(w, a, r2, inputs);
    assert.equal(f2.status, 200);
    const sent = await start(a, { modes: ['fineprint'] });
    assert.equal(sent.status, 200);
    w.advance(200_000);
    const f3 = await finish(a, sent.json, inputs, { score: 123456, opts: { modes: ['classic'], speed: 'fast' }, mode: 'classic' });
    assert.equal(f3.status, 200);
    const want = replay(sent.json.seed, inputs, parseOptions({ modes: ['fineprint'] }));
    assert.equal(f3.json.score, score(want));
    assert.equal(f3.json.mode, 'fineprint');
    assert.equal(w.rows('SELECT mode FROM arcade_runs WHERE id = ?', sent.json.session)[0].mode, 'fineprint');
  } finally { await w.cleanup(); }
});

test('input checks use the core: masks up to 15, ticks below 5400, at most 4000 entries; a bad log is a 400 that burns nothing', async () => {
  const w = await world({ n: 1 });
  try {
    const [a] = w.students;
    const round = await startOk(a);
    w.advance(200_000);
    for (const bad of [[[5, 16]], [[5400, 1]], [[5, 1], [5, 2]], [[5, -1]], 'x', Array.from({ length: 4001 }, (_, i) => [i, i & 1])]) {
      assert.equal((await finish(a, round, bad)).status, 400, JSON.stringify(bad).slice(0, 40));
    }
    assert.equal(w.rows('SELECT status FROM arcade_runs WHERE id = ?', round.session)[0].status, 'open');
    assert.equal((await finish(a, round, [[5, 15], [6, 0]])).status, 200, 'mask 15 is the core\'s maximum');
  } finally { await w.cleanup(); }
});

test('best, plays and the class board are per mode; /state and /board return one mode at a time; Bill Dash is unchanged', async () => {
  const w = await world({ n: 3 });
  try {
    const [a, b, c] = w.students;
    const run = async (s, opts, n) => { const r = await startOk(s, opts); const f = await played(w, s, r, pressLog(n)); assert.equal(f.status, 200, JSON.stringify(f.json)); return { r, f: f.json, want: score(replay(r.seed, pressLog(n), r.opts)) }; };
    const a1 = await run(a, undefined, 1);
    const a2 = await run(a, { modes: ['latefees'] }, 2);
    const b1 = await run(b, undefined, 3);
    assert.equal(a1.f.score, a1.want);
    assert.equal(a1.f.mode, 'classic');
    assert.deepEqual(a1.f.leaderboard.map((r) => r.username).sort(), [a.username], 'a classic board holds classic rounds only');
    assert.equal(a2.f.mode, 'latefees');
    assert.deepEqual(a2.f.leaderboard.map((r) => [r.username, r.best]), [[a.username, a2.want]], 'the Late Fees board has only the Late Fees round');
    assert.equal(a2.f.plays, 1, 'plays are per mode');
    assert.equal(a2.f.new_best, true, 'a first round in a new mode is a new best for that mode');
    // /state: default mode classic, or the mode asked for, with every mode played in `modes`
    const game = async (s, q = '') => (await s.client.get(`/api/arcade/state${q}`)).json.games.find((g) => g.key === 'debtsnake');
    const g0 = await game(a);
    assert.equal(g0.mode, 'classic');
    assert.equal(g0.best, a1.want);
    assert.equal(g0.plays, 1);
    assert.deepEqual(g0.leaderboard.map((r) => r.username).sort(), [a.username, b.username].sort());
    assert.deepEqual(g0.modes, { classic: { best: a1.want, plays: 1 }, latefees: { best: a2.want, plays: 1 } });
    const g1 = await game(a, '?game=debtsnake&mode=latefees');
    assert.equal(g1.mode, 'latefees');
    assert.deepEqual([g1.best, g1.plays], [a2.want, 1]);
    assert.deepEqual(g1.leaderboard.map((r) => r.username), [a.username]);
    // /board: read only, one mode, a mode nobody has played is empty, an unknown one is a 400
    const before = w.rows('SELECT COUNT(*) AS n FROM arcade_runs')[0].n;
    const brd = (s, mode) => s.client.get(`/api/arcade/board?game=debtsnake${mode === undefined ? '' : `&mode=${encodeURIComponent(mode)}`}`);
    assert.deepEqual((await brd(b, 'latefees')).json, { game: 'debtsnake', mode: 'latefees', best: null, plays: 0, leaderboard: [{ rank: 1, username: a.username, best: a2.want, mine: false }] });
    assert.equal((await brd(c, 'classic')).json.best, null, 'c has no rounds');
    assert.equal((await brd(c)).json.mode, 'classic', 'the default mode is classic');
    assert.deepEqual((await brd(c, 'etransfer+latefees')).json.leaderboard, []);
    for (const bad of ['nope', 'latefees+classic', 'latefees+latefees', 'LateFees', 'latefees+nope']) assert.equal((await brd(c, bad)).status, 400, bad);
    assert.equal((await c.client.get('/api/arcade/board?game=billdash')).status, 400, 'Bill Dash has no modes');
    assert.equal((await c.client.get('/api/arcade/board?game=nope')).status, 400);
    assert.equal(w.rows('SELECT COUNT(*) AS n FROM arcade_runs')[0].n, before, 'reading a board writes nothing');
    assert.equal((await w.srv.client().get('/api/arcade/board?game=debtsnake')).status, 401);
    // the same student, a better round in the same mode: best only rises, plays count up
    const a3 = await run(a, undefined, 4);
    assert.equal(a3.f.best, Math.max(a1.want, a3.want));
    assert.equal(a3.f.plays, 2);
    assert.equal(a3.f.new_best, a3.want > a1.want);
    // Bill Dash: its own top-level best and board, untouched by snake rounds
    const r = (await start(c, undefined, 'billdash')).json;
    w.advance(46_000);
    const f = await c.client.post('/api/arcade/finish', { session: r.session, inputs: [] });
    assert.equal(f.status, 200);
    const st = (await c.client.get('/api/arcade/state')).json;
    assert.deepEqual(st.leaderboard.map((x) => x.username), [c.username]);
    assert.equal(st.my_best, billdash.score(billdash.replay(r.seed, [])));
    assert.equal(st.games.find((x) => x.key === 'billdash').mode, undefined, 'Bill Dash has no mode');
  } finally { await w.cleanup(); }
});

test('a verified finish completes "Play a round of Debt Snake" once for the same pay as Bill Dash; an empty log, another game and a rejected finish do not', async () => {
  const w = await world({ n: 2 });
  try {
    const [a, b] = w.students;
    const errand = async (s, title = 'Play a round of Debt Snake') => (await s.client.get('/api/today/state')).json.errands.find((e) => e.title === title);
    assert.equal((await errand(a)).status, 'open');
    const bdReward = (await errand(a, 'Play a round of Bill Dash')).reward_cents;
    assert.equal((await errand(a)).reward_cents, bdReward, 'same pay as Bill Dash');
    // a Bill Dash round does not complete it
    const rb = (await start(a, undefined, 'billdash')).json;
    w.advance(46_000);
    assert.equal((await a.client.post('/api/arcade/finish', { session: rb.session, inputs: [[0, 1], [1, 0]] })).status, 200);
    assert.equal((await errand(a)).status, 'open');
    assert.equal((await errand(a, 'Play a round of Bill Dash')).status, 'done');
    // an empty log scores but earns nothing
    const e1 = await startOk(a, { modes: ['practice'] });
    assert.equal((await played(w, a, e1, [])).status, 200);
    assert.equal((await errand(a)).status, 'open');
    const before = w.srv.app.ledger.balance(a.chequing.id);
    const r1 = await startOk(a);
    assert.equal((await played(w, a, r1, pressLog(1))).status, 200);
    assert.equal((await errand(a)).status, 'done');
    assert.equal(w.srv.app.ledger.balance(a.chequing.id) - before, bdReward);
    assert.equal((await errand(b)).status, 'open', 'only the student who played');
    const r2 = await startOk(a, { modes: ['tunnel'] });
    assert.equal((await played(w, a, r2, pressLog(2))).status, 200);
    assert.equal(w.rows("SELECT COUNT(*) AS n FROM txns WHERE kind = 'today.errand' AND json_extract(meta, '$.template') = 'play-debt-snake'")[0].n, 1, 'paid once');
    // a finish that was too fast is rejected and emits nothing
    const r3 = await startOk(b, { modes: ['practice'] });   // practice never crashes, so the round is the full 5400 ticks
    w.advance(2000);
    assert.equal((await finish(b, r3, pressLog(5))).status, 422);
    assert.equal((await errand(b)).status, 'open');
    assert.equal(w.srv.app.ledger.audit().ok, true);
  } finally { await w.cleanup(); }
});

test('switched off for a class: hidden there, no start, no board, no errand from the next day; the other class keeps it; the teacher panel lists the switch', async () => {
  const w = await world({ n: 1 });
  try {
    const [a] = w.students, [b] = w.other.students;
    const keys = async (s) => (await s.client.get('/api/arcade/state')).json.games.filter((g) => g.kind !== 'daily').map((g) => g.key);
    const titles = async (s) => (await s.client.get('/api/today/state')).json.errands.map((e) => e.title);
    assert.ok((await keys(a)).includes('debtsnake'));
    assert.ok((await titles(a)).includes('Play a round of Debt Snake'));
    const teach = (await w.teacher.get('/api/arcade/teach')).json.classes.find((c) => c.id === w.cls.id);
    assert.ok(teach.switches.some((x) => x.key === 'debtsnake' && x.on && !x.linked));
    assert.ok(teach.games.some((g) => g.key === 'debtsnake'), 'the panel has a section for the game');
    assert.equal((await w.teacher.post('/api/arcade/switch', { class_id: w.cls.id, game: 'debtsnake', enabled: false })).status, 200);
    assert.ok(!(await keys(a)).includes('debtsnake'));
    const s = await start(a);
    assert.equal(s.status, 403);
    assert.match(s.json.error, /turned Debt Snake off/);
    assert.equal((await a.client.get('/api/arcade/board?game=debtsnake')).status, 403);
    assert.equal((await start(a, undefined, 'billdash')).status, 200, 'other games are untouched');
    assert.ok((await keys(b)).includes('debtsnake'), 'Block 2 keeps it');
    assert.equal((await start(b)).status, 200);
    w.nextDay();
    assert.ok(!(await titles(a)).includes('Play a round of Debt Snake'), 'no errand once it is off');
    assert.ok((await titles(b)).includes('Play a round of Debt Snake'));
    assert.equal((await w.teacher.post('/api/arcade/switch', { class_id: w.cls.id, game: 'debtsnake', enabled: true })).status, 200);
    assert.ok((await keys(a)).includes('debtsnake'));
    assert.equal((await start(a)).status, 200);
  } finally { await w.cleanup(); }
});
