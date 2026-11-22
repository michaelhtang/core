// The Arcade's per-class switches (POST /api/arcade/switch, his choice 2026-11-19: "all games, errands follow"). A game turned off for a class is
// hidden from that class, cannot be started, and its Today errand is no longer offered there from the next class day; other classes are untouched.
// The linked games (modules/games) are switched the same way and drop out of the Arcade grid. Teachers switch only their own classes.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createClock } from '../lib/clock.js';
import { boot, seeded, addClass } from './helpers.js';

const REAL = JSON.parse(fs.readFileSync(new URL('../config/vdaa.json', import.meta.url), 'utf8'));
const SMALL = { courses: { fintech10: { label: 'x', modules: ['bank-basic', 'arcade', 'games', 'today'] }, fintech2030: { label: 'y', modules: ['bank-basic', 'arcade', 'games', 'today'] } } };

async function world(config = SMALL) {
  let t = Date.parse('2026-11-02T15:00:00Z');
  const srv = await boot({ config, clock: createClock({ now: () => t }) });
  const w = await seeded(srv, 1, { transfers: false });
  const other = await addClass(srv, w.teacher, 'Block 2', 1);
  srv.app.db.prepare("INSERT OR IGNORE INTO arcade_class_off (class_id, game) SELECT id, 'wordle' FROM classes").run(); for (const t of ['today_errands', 'today_state']) srv.app.db.exec(`DELETE FROM ${t}`);   // Today picks 3 errands a day: with four arcade errands on one could miss the day, so these worlds drop FinWord and let the day be picked again
  const nextDay = () => { t += 60_000; srv.app.world.advance({ months: 1 }); t += 60_000; };
  return { srv, ...w, other, nextDay, cleanup: srv.cleanup };
}
const sw = (w, classId, game, on) => w.teacher.post('/api/arcade/switch', { class_id: classId, game, enabled: on });
const titles = async (s) => (await s.client.get('/api/today/state')).json.errands.map((e) => e.title);
const arcadeGames = async (s) => (await s.client.get('/api/arcade/state')).json.games.filter((g) => g.kind !== 'daily').map((g) => g.key);

test('off for one class: hidden there, cannot start, no errand from the next day; the other class keeps it; on again brings it back', async () => {
  const w = await world();
  try {
    const [a] = w.students, [b] = w.other.students;
    assert.deepEqual(await arcadeGames(a), ['billdash', 'diversify', 'debtsnake']);
    assert.ok((await titles(a)).includes('Play a round of Bill Dash'));
    assert.equal((await sw(w, w.cls.id, 'billdash', false)).status, 200);
    assert.deepEqual(await arcadeGames(a), ['diversify', 'debtsnake']);
    const start = await a.client.post('/api/arcade/start', { game: 'billdash' });
    assert.equal(start.status, 403);
    assert.match(start.json.error, /turned Bill Dash off/);
    assert.equal((await a.client.post('/api/arcade/start', { game: 'diversify' })).status, 200);
    assert.deepEqual(await arcadeGames(b), ['billdash', 'diversify', 'debtsnake'], 'Block 2 is untouched');
    w.nextDay();
    assert.ok(!(await titles(a)).includes('Play a round of Bill Dash'), 'no Bill Dash errand once it is off');
    assert.ok((await titles(a)).includes('Play a round of Diversify'));
    assert.ok((await titles(b)).includes('Play a round of Bill Dash'), 'Block 2 still gets it');
    const teach = (await w.teacher.get('/api/arcade/teach')).json.classes.find((c) => c.id === w.cls.id);
    assert.deepEqual(teach.switches.filter((x) => !x.linked).map((x) => [x.key, x.on]), [['billdash', false], ['diversify', true], ['debtsnake', true], ['wordle', false]]);
    assert.equal((await sw(w, w.cls.id, 'billdash', true)).status, 200);
    assert.equal((await sw(w, w.cls.id, 'billdash', true)).status, 200, 'switching on twice is fine');
    assert.deepEqual(await arcadeGames(a), ['billdash', 'diversify', 'debtsnake']);
    assert.equal((await a.client.post('/api/arcade/start', { game: 'billdash' })).status, 200);
    w.nextDay();
    assert.ok((await titles(a)).includes('Play a round of Bill Dash'));
    assert.equal(w.srv.app.ledger.audit().ok, true);
  } finally { await w.cleanup(); }
});

test('linked games: a switch per game the course sees; off drops it from More games for that class only', async () => {
  const w = await world();
  try {
    const [a] = w.students, [b] = w.other.students;
    const teach = (await w.teacher.get('/api/arcade/teach')).json.classes.find((c) => c.id === w.cls.id);
    assert.deepEqual(teach.switches.filter((x) => x.linked).map((x) => [x.key, x.on]), [['stax', true], ['payday', true]], 'FinTech 10 has no Wolf Pack Returns switch');
    assert.equal((await sw(w, w.cls.id, 'stax', false)).status, 200);
    assert.deepEqual((await a.client.get('/api/games/list')).json.games.map((g) => g.id), ['payday']);
    assert.deepEqual((await b.client.get('/api/games/list')).json.games.map((g) => g.id), ['stax', 'payday']);
    assert.equal((await sw(w, w.cls.id, 'taxdesk', false)).status, 400, 'not a game this course sees');
    assert.equal((await sw(w, w.cls.id, 'tradelab', false)).status, 400, 'TradeLab is its own door, not an Arcade game');
    const c30 = (await w.teacher.post('/api/teach/classes', { name: 'Block 30', course: 'fintech2030' })).json;
    assert.equal((await sw(w, c30.id, 'taxdesk', false)).status, 200);
  } finally { await w.cleanup(); }
});

test('switch: teacher only, own classes only, checked input', async () => {
  const w = await world();
  try {
    const [a] = w.students;
    assert.equal((await a.client.post('/api/arcade/switch', { class_id: w.cls.id, game: 'billdash', enabled: false })).status, 403);
    assert.equal((await sw(w, 999999, 'billdash', false)).status, 404);
    assert.equal((await sw(w, w.cls.id, 'nope', false)).status, 400);
    assert.equal((await w.teacher.post('/api/arcade/switch', { class_id: w.cls.id, game: 'billdash', enabled: 'no' })).status, 400);
    const stranger = w.srv.client();
    assert.equal((await stranger.post('/api/arcade/switch', { class_id: w.cls.id, game: 'billdash', enabled: false })).status, 401);
  } finally { await w.cleanup(); }
});

test('with the real config, the switches and both errands still load', async () => {
  const w = await world(REAL);
  try {
    const teach = (await w.teacher.get('/api/arcade/teach')).json.classes[0];
    assert.deepEqual(teach.switches.map((x) => x.key), ['billdash', 'diversify', 'debtsnake', 'wordle', 'stax', 'payday']);
  } finally { await w.cleanup(); }
});
