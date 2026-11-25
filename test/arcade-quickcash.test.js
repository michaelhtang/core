// Quick Cash Counter's server side (docs/quickcash.md): /start and /finish for the `quickcash` key replay the recorded inputs through the core, the score is the
// replay's alone, a verified finish emits module.arcade.played_quickcash, and that completes the Today errand "Play a round of Quick Cash Counter", which pays
// exactly like Debt Snake's (Mr. Tang, 2026-11-25): 50 cents x the price index, once a day, only while the game is on. The score never pays. The core has its own test file.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createClock } from '../lib/clock.js';
import { boot, seeded, addClass } from './helpers.js';
import { C, createGame, step, offers, replay, score } from '../modules/arcade/ui/games/quickcash-core.js';

const SMALL = { courses: { fintech10: { label: 'x', modules: ['bank-basic', 'arcade', 'games', 'today'] }, fintech2030: { label: 'y', modules: ['bank-basic', 'arcade', 'games', 'today'] } } };
const T0 = Date.parse('2026-11-02T15:00:00Z');

async function world({ n = 2 } = {}) {
  let t = T0;
  const srv = await boot({ config: SMALL, clock: createClock({ now: () => t }) });
  const w = await seeded(srv, n, { transfers: false });
  const other = await addClass(srv, w.teacher, 'Block 2', 1);
  // Today picks 3 errands a day: with five arcade errands on one could miss, so these worlds drop FinWord and Diversify (leaving Bill Dash, Debt Snake and
  // Quick Cash Counter) and let the day be picked again
  for (const g of ['wordle', 'diversify']) srv.app.db.prepare('INSERT OR IGNORE INTO arcade_class_off (class_id, game) SELECT id, ? FROM classes').run(g);
  for (const x of ['today_errands', 'today_state']) srv.app.db.exec(`DELETE FROM ${x}`);
  const advance = (ms) => { t += ms; };
  const nextDay = () => { t += 60_000; srv.app.world.advance({ months: 1 }); t += 60_000; };
  const rows = (sql, ...a) => srv.app.db.prepare(sql).all(...a);
  return { srv, ...w, other, advance, nextDay, rows, cleanup: srv.cleanup };
}
const QC = 'Play a round of Quick Cash Counter', DS = 'Play a round of Debt Snake';
const errand = async (s, title = QC) => (await s.client.get('/api/today/state')).json.errands.find((e) => e.title === title);
const paid = (w) => w.rows("SELECT COUNT(*) AS n FROM txns WHERE kind = 'today.errand' AND json_extract(meta, '$.template') = 'play-quickcash'")[0].n;
const start = (s) => s.client.post('/api/arcade/start', { game: 'quickcash' });
const startOk = async (s) => { const r = await start(s); assert.equal(r.status, 200, JSON.stringify(r.json)); return r.json; };
const finish = (s, round, inputs, extra = {}) => s.client.post('/api/arcade/finish', { session: round.session, game: 'quickcash', inputs, ...extra });

// A bot: presses the most expensive offer (or the cheapest) at the first tick of each customer's wait, one tick long.
function bot(seed, pick = Math.max) {
  const s = createGame(seed), log = [];
  let mask = 0;
  while (!s.over) {
    const want = s.phase === 0 && s.t === 0 && mask === 0 ? 1 << (() => { const c = offers(s, s.ci).map((o) => o.cents); return c.indexOf(pick(...c)); })() : 0;
    if (want !== mask) { log.push([s.tick, want]); mask = want; }
    step(s, mask);
  }
  return log;
}

test('it is registered: title, blurb, ticks 3870, a tile for a student, and a Today errand and fact like Debt Snake\'s', async () => {
  const w = await world();
  try {
    const [a] = w.students;
    const g = (await a.client.get('/api/arcade/state')).json.games.find((x) => x.key === 'quickcash');
    assert.equal(g.title, 'Quick Cash Counter');
    assert.ok(g.blurb.length > 30 && !/\n/.test(g.blurb));
    assert.equal(g.ticks, 3870);
    assert.deepEqual([g.best, g.plays, g.leaderboard], [null, 0, []]);
    const r = await startOk(a);
    assert.deepEqual([r.game, r.ticks], ['quickcash', 3870]);
    assert.equal(r.opts, undefined, 'a game with no options stores none');
    const errands = JSON.parse(fs.readFileSync(new URL('../modules/today/errands.json', import.meta.url), 'utf8'));
    const qc = errands.find((e) => e.id === 'play-quickcash'), ds = errands.find((e) => e.id === 'play-debt-snake');
    assert.equal(qc.title, QC);
    for (const f of ['reward_cents', 'energy', 'priority', 'module', 'building']) assert.equal(qc[f], ds[f], f);
    assert.deepEqual([qc.reward_cents, qc.energy, qc.priority], [50, 1, 6]);
    assert.deepEqual(qc.when, [{ fact: 'arcade.quickcashOn', op: '==', value: true }]);
    assert.deepEqual(qc.done, { event: 'module.arcade.played_quickcash' });
    assert.equal(errands.filter((e) => /quickcash|quick cash/i.test(JSON.stringify(e))).length, 1, 'one errand, no other pay');
    assert.equal(w.srv.app.modules.kernel('today').modules.call('arcade', 'todayFacts', { playerId: a.id }).quickcashOn, true);
  } finally { await w.cleanup(); }
});

test('a verified finish: the score is the replay\'s, the event fires once, and the errand pays 50 cents x the price index once; the score never pays', async () => {
  const w = await world();
  try {
    const [a, b] = w.students, seen = [];
    w.srv.app.events.on('module.arcade.played_quickcash', (p) => seen.push(p));
    assert.equal((await errand(a)).status, 'open');
    w.srv.app.db.prepare('INSERT INTO price_index (world_id, index_bp) VALUES (?, 12000) ON CONFLICT (world_id) DO UPDATE SET index_bp = 12000').run(w.srv.app.world.current().id);
    const before = w.rows('SELECT COUNT(*) AS n FROM txns')[0].n, cash = w.srv.app.ledger.balance(a.chequing.id);
    const r = await startOk(a);
    const inputs = bot(r.seed);
    w.advance(10_000);
    const f = await finish(a, r, inputs, { score: 99999 });                  // a claimed score is ignored
    assert.equal(f.status, 200, JSON.stringify(f.json));
    assert.equal(f.json.score, score(replay(r.seed, inputs)));
    assert.equal(f.json.stats.topCount, 6);
    assert.equal(f.json.stats.rows.length, 6);
    assert.equal(Math.floor(f.json.stats.total / 100), f.json.score);
    assert.equal(f.json.best, f.json.score);
    assert.equal(f.json.leaderboard.length, 1);
    assert.deepEqual(seen.map((p) => [p.playerId, p.game, p.score]), [[a.id, 'quickcash', f.json.score]]);
    assert.equal((await finish(a, r, inputs)).status, 409, 'once');
    assert.equal(seen.length, 1);
    const done = await errand(a);
    assert.equal(done.status, 'done');
    assert.equal(w.srv.app.ledger.balance(a.chequing.id) - cash, 60, '$0.50 x 1.2');
    assert.equal(done.reward_cents, 60);
    assert.equal((await errand(a, DS)).reward_cents, 60, 'the same pay as Debt Snake');
    assert.equal(w.rows('SELECT COUNT(*) AS n FROM txns')[0].n, before + 1, 'the errand is the only money that moved');
    assert.equal((await errand(b)).status, 'open', 'only the student who played');
    // the cheapest-pick round scores less and counts for its own board row
    const r2 = await startOk(a);
    w.advance(10_000);
    const low = bot(r2.seed, Math.min);
    const f2 = await finish(a, r2, low);
    assert.equal(f2.json.stats.topCount, 0);
    assert.equal(f2.json.score, score(replay(r2.seed, low)));
    assert.equal(f2.json.best, Math.max(f.json.score, f2.json.score));
    assert.equal(paid(w), 1, 'paid once a day');
    assert.equal(w.srv.app.ledger.balance(a.chequing.id) - cash, 60, 'a second round pays nothing more');
    assert.equal(w.srv.app.ledger.audit().ok, true);
  } finally { await w.cleanup(); }
});

test('no input at all: all six customers leave, score 0, the replay runs all 3870 ticks, no event and the errand stays open', async () => {
  const w = await world();
  try {
    const [a] = w.students, seen = [];
    w.srv.app.events.on('module.arcade.played_quickcash', (p) => seen.push(p));
    const r = await startOk(a);
    w.advance(60_000);                                                        // 40% of the 129 seconds is 51.6 s
    const f = await finish(a, r, []);
    assert.equal(f.status, 200);
    assert.deepEqual([f.json.score, f.json.ticks, f.json.stats.topCount], [0, C.ROUND, 0]);
    assert.equal(seen.length, 0, 'an empty log is not a played round');
    assert.equal((await errand(a)).status, 'open');
    assert.equal(paid(w), 0);
  } finally { await w.cleanup(); }
});

test('too fast to be played is a 422 and emits nothing; bad inputs are a 400 that does not burn the round; neither completes the errand', async () => {
  const w = await world();
  try {
    const [a] = w.students, seen = [];
    w.srv.app.events.on('module.arcade.played_quickcash', (p) => seen.push(p));
    const r = await startOk(a);
    for (const bad of [[[0, 16]], [[3870, 1]], [[5, 1], [5, 0]], [[0, 1.5]], 'x']) assert.equal((await finish(a, r, bad)).status, 400, JSON.stringify(bad));
    assert.equal((await finish(a, r, bot(r.seed))).status, 422, 'a perfect round in 0 seconds');
    assert.equal(seen.length, 0);
    assert.equal((await errand(a)).status, 'open');
    assert.equal(paid(w), 0);
  } finally { await w.cleanup(); }
});

test('a teacher can switch it off for a class: it is hidden, cannot be started, the switch lists it, and the errand is not offered there from the next day', async () => {
  const w = await world();
  try {
    const [a] = w.students, [o] = w.other.students;
    const fact = (s) => w.srv.app.modules.kernel('today').modules.call('arcade', 'todayFacts', { playerId: s.id }).quickcashOn;
    assert.ok(await errand(a));
    assert.equal((await w.teacher.post('/api/arcade/switch', { class_id: w.cls.id, game: 'quickcash', enabled: false })).status, 200);
    assert.deepEqual([fact(a), fact(o)], [false, true]);
    w.nextDay();
    assert.equal(await errand(a), undefined, 'no errand once it is off');
    assert.ok(await errand(o), 'Block 2 still gets it');
    assert.ok(!(await a.client.get('/api/arcade/state')).json.games.some((g) => g.key === 'quickcash'));
    assert.equal((await start(a)).status, 403);
    const teach = (await w.teacher.get('/api/arcade/teach')).json.classes.find((c) => c.id === w.cls.id);
    assert.equal(teach.switches.find((x) => x.key === 'quickcash').on, false);
    assert.equal(teach.games.find((x) => x.key === 'quickcash').title, 'Quick Cash Counter');
    await w.teacher.post('/api/arcade/switch', { class_id: w.cls.id, game: 'quickcash', enabled: true });
    assert.equal((await start(a)).status, 200);
  } finally { await w.cleanup(); }
});
