// walk (docs/walk.md): Town Walk's core is a deterministic integer game; the server replays recorded inputs through the same file and is the only
// one who counts the items. Core determinism, collision, item placement and reachability, a scripted bot, the replay budget, the start/finish API
// (tamper, double finish, other player, expiry, bad inputs, closed season, throttle, auth, module off) and the Today errand.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createClock } from '../lib/clock.js';
import { boot, seeded } from './helpers.js';
import {
  C, MAP, W, H, PX_W, PX_H, DOORS, BUILDINGS, DOOR_KEYS, KINDS, SPAWN, createWalk, step, replay, score, placeItems, doorAt, distField, autoMask,
  nearestWalkable, isSolid, isDoorTile, reachableFromSpawn,
} from '../modules/walk/ui/town/town-core.js';

const REAL = JSON.parse(fs.readFileSync(new URL('../config/vdaa.json', import.meta.url), 'utf8'));
const CORE_SRC = fs.readFileSync(new URL('../modules/walk/ui/town/town-core.js', import.meta.url), 'utf8');
const UP = 1, DOWN = 2, LEFT = 4, RIGHT = 8;

// Walk to one tile with the core's own steering; returns the masks used (what the client records for a tap).
function walkTo(s, tx, ty, log, limit = 4000) {
  const field = distField(tx, ty);
  for (let i = 0; i < limit; i++) {
    const m = autoMask(s, field);
    if (m === 0) return true;
    log.push(m); step(s, m);
  }
  return false;
}
// A bot against the public core only: nearest uncollected item by BFS distance, tap-to-move there. Returns the change list it pressed.
function bot(seed, ticks = C.MAX_TICKS) {
  const s = createWalk(seed), masks = [];
  while (s.collected.length < s.items.length && s.tick < ticks) {
    const left = s.items.filter((it) => !s.collected.includes(it.id));
    const here = distField(s.x + 2 >> 3, s.y + 2 >> 3);
    left.sort((a, b) => here[(b.y >> 3) * W + (b.x >> 3)] - here[(a.y >> 3) * W + (a.x >> 3)]);
    const it = left[left.length - 1], field = distField(it.x >> 3, it.y >> 3);
    for (let guard = 0; guard < 3000 && s.tick < ticks && !s.collected.includes(it.id); guard++) { const m = autoMask(s, field) || 0; masks.push(m); step(s, m); }
  }
  return { state: s, log: toChanges(masks) };
}
function toChanges(masks) {
  const log = []; let last = 0;
  masks.forEach((m, t) => { if (m !== last) { log.push([t, m]); last = m; } });
  return log;
}
const SEEDS = Array.from({ length: 200 }, (_, i) => Math.imul(i + 1, 2654435761) >>> 0);

// ---------- the core ----------
test('core: the map is a 64 x 48 picture with 15 doors, each on the south face of its own 5 x 4 building', () => {
  assert.deepEqual([W, H, PX_W, PX_H], [64, 48, 512, 384]);
  assert.ok(MAP.every((r) => r.length === 64));
  assert.deepEqual(DOORS.map((d) => d.key), DOOR_KEYS);
  assert.equal(new Set(DOOR_KEYS).size, 15);
  for (const k of ['job', 'bank', 'bank-of-daa', 'housing', 'insurance', 'credit', 'bills', 'outfitters', 'exchange', 'networth', 'venture-row', 'amphitheatre', 'life', 'retirement', 'arcade']) assert.ok(DOOR_KEYS.includes(k), k);
  assert.ok(!DOOR_KEYS.includes('walk'));
  for (const b of BUILDINGS) {
    const d = DOORS.find((q) => q.key === b.key);
    assert.deepEqual([d.x, d.y], [b.x + 2, b.y + 3]);
    for (let y = b.y; y < b.y + b.h; y++) for (let x = b.x; x < b.x + b.w; x++) assert.equal(isSolid(x, y), !(x === d.x && y === d.y), `${b.key} ${x},${y}`);
    assert.ok(!isSolid(d.x, d.y + 1) && !isDoorTile(d.x, d.y + 1), `${b.key}: a street tile south of the door`);
    assert.ok(reachableFromSpawn(d.x, d.y), `${b.key} door reachable from the spawn`);
  }
  assert.ok(!isSolid(SPAWN.x >> 3, SPAWN.y >> 3));
});

test('core: the same seed and inputs give the same state every tick; another seed differs', () => {
  const { log } = bot(1234, 900);
  const a = createWalk(1234), b = createWalk(1234);
  let i = 0, mask = 0;
  const hashes = [];
  for (let t = 0; t < 900; t++) {
    while (i < log.length && log[i][0] <= t) mask = log[i++][1];
    step(a, mask); step(b, mask);
    assert.equal(JSON.stringify(a), JSON.stringify(b), `tick ${t}`);
    hashes.push(a.x * 100000 + a.y);
  }
  assert.ok(new Set(hashes).size > 100, 'the walker actually moved');
  assert.deepEqual(replay(1234, log, 900), a);
  assert.notDeepEqual(placeItems(1).map((q) => [q.x, q.y]), placeItems(2).map((q) => [q.x, q.y]));
  assert.deepEqual(placeItems(77), placeItems(77));
});

test('core: movement is 1 px a tick, diagonals are not faster, and the walker cannot enter solids or leave the map', () => {
  const s = createWalk(1);
  const x0 = s.x, y0 = s.y;
  for (let i = 0; i < 20; i++) step(s, RIGHT);
  assert.equal(s.x - x0, 20);
  assert.equal(s.face, 3);
  const d = createWalk(1);
  for (let i = 0; i < 40; i++) step(d, RIGHT | UP);
  const moved = Math.abs(d.x - x0) + Math.abs(d.y - y0);
  assert.equal(d.x - x0, 30, '3 ticks in 4');
  assert.equal(y0 - d.y, 30);
  assert.ok(moved === 60);
  // nothing in a long random walk ever overlaps a solid tile or leaves the map
  const w = createWalk(9);
  let r = 12345;
  for (let t = 0; t < 20000; t++) {
    if (t % 25 === 0) r = (Math.imul(r, 1664525) + 1013904223) >>> 0;
    step(w, (r >>> 24) & 15);
    if (w.tick >= C.MAX_TICKS) break;
    const x2 = w.x + C.HB - 1, y2 = w.y + C.HB - 1;
    assert.ok(w.x >= 0 && w.y >= 0 && x2 < PX_W && y2 < PX_H);
    for (const [px, py] of [[w.x, w.y], [x2, w.y], [w.x, y2], [x2, y2]]) assert.ok(!isSolid(px >> 3, py >> 3), `tick ${t}: ${px},${py}`);
  }
  // the fountain blocks: walking up from the spawn stops below it
  const f = createWalk(1);
  for (let i = 0; i < 200; i++) step(f, UP);
  assert.equal(f.y, 24 * 8, 'stopped against the fountain rim');
  // the map edge
  const e = createWalk(1);
  e.x = 16; e.y = 16;
  for (let i = 0; i < 100; i++) step(e, LEFT | UP);
  assert.ok(e.x >= 0 && e.y >= 0);
});

test('core: sliding along a wall works (a diagonal into the fountain keeps its free axis) and a door is not a pixel-exact target', () => {
  const s = createWalk(1);
  s.x = 30 * 8; s.y = 24 * 8;                        // just below the fountain rim
  const y0 = s.y;
  for (let i = 0; i < 30; i++) step(s, UP | RIGHT);   // up is blocked by the rim, right is free: it must slide right
  assert.ok(s.x > 30 * 8 + 15, `slid right to ${s.x}`);
  assert.equal(s.y, y0);
  // enter the bank-of-daa door from slightly off-centre: the nudge slides the box into the door tile
  const door = DOORS.find((d) => d.key === 'bank-of-daa');
  const t = createWalk(1);
  t.x = door.x * 8 + 5; t.y = (door.y + 2) * 8 + 2;   // 1 px too far right for the 4 px box to fit the 8 px door column
  for (let i = 0; i < 30; i++) step(t, UP);
  assert.equal(doorAt(t), 'bank-of-daa');
});

test('core: items for 200 seeds are walkable, on no door, spaced, away from the spawn, distinct kinds, and reachable from the spawn', () => {
  const spawnTile = [SPAWN.x >> 3, SPAWN.y >> 3];
  const reach = distField(...spawnTile);
  for (const seed of SEEDS) {
    const items = placeItems(seed);
    assert.equal(items.length, C.ITEMS);
    assert.deepEqual(items.map((q) => q.id), [1, 2, 3, 4, 5, 6]);
    assert.equal(new Set(items.map((q) => q.kind)).size, 6);
    for (const it of items) {
      assert.ok(KINDS.includes(it.kind));
      const tx = it.x >> 3, ty = it.y >> 3;
      assert.deepEqual([it.x & 7, it.y & 7], [4, 4], 'tile centre');
      assert.ok(!isSolid(tx, ty) && !isDoorTile(tx, ty), `seed ${seed}: ${tx},${ty}`);
      assert.ok(reach[ty * W + tx] >= 0, `seed ${seed}: item at ${tx},${ty} is unreachable`);
      assert.ok(Math.max(Math.abs(tx - spawnTile[0]), Math.abs(ty - spawnTile[1])) >= C.MIN_GAP);
    }
    for (let i = 0; i < 6; i++) for (let j = i + 1; j < 6; j++) assert.ok(Math.max(Math.abs((items[i].x >> 3) - (items[j].x >> 3)), Math.abs((items[i].y >> 3) - (items[j].y >> 3))) >= C.MIN_GAP, `seed ${seed}`);
  }
  assert.ok(new Set(SEEDS.map((sd) => placeItems(sd).map((q) => q.kind).join())).size > 50, 'the kind order varies with the seed');
});

test('core: every item of every sampled seed can actually be walked to with real steps (tap-to-move from the spawn), not just on the tile grid', () => {
  for (const seed of SEEDS.slice(0, 40)) {
    for (const it of placeItems(seed)) {
      const s = createWalk(seed);
      const log = [];
      assert.ok(walkTo(s, it.x >> 3, it.y >> 3, log), `seed ${seed} item ${it.id}`);
      assert.ok(s.collected.includes(it.id), `seed ${seed}: standing on the tile picks item ${it.id} up`);
    }
  }
});

test('core: pickups count once each, in order, only within the radius', () => {
  const s = createWalk(5);
  const [a, b] = s.items;
  s.x = a.x - 2 + C.PICK_R + 1; s.y = a.y - 2;        // centre 7 px right of the item: too far
  step(s, 0);
  assert.equal(score(s), 0);
  s.x = a.x - 2 + C.PICK_R; s.y = a.y - 2;             // exactly 6 px
  step(s, 0);
  assert.deepEqual(s.collected, [a.id]);
  step(s, 0); step(s, 0);
  assert.deepEqual(s.collected, [a.id], 'standing still does not collect twice');
  s.x = b.x - 2; s.y = b.y - 2;
  step(s, 0);
  assert.deepEqual(s.collected, [a.id, b.id]);
  assert.equal(score(s), 2);
  assert.equal(nearestWalkable(0, 0).x >= 2, true);
});

test('core: import-free and integer-only (no imports, no Math.random, no Date, no trig/sqrt/floor/round, no division, no decimal literals)', () => {
  const code = CORE_SRC.split('\n').map((l) => l.replace(/\/\/.*$/, '')).join('\n');
  assert.doesNotMatch(code, /\bimport\b|\brequire\b/);
  assert.doesNotMatch(code, /Math\.random|\bDate\b|performance\.|Math\.(sin|cos|tan|sqrt|floor|ceil|round|pow|exp|log|trunc|hypot)/);
  for (const m of new Set(code.match(/Math\.\w+/g))) assert.ok(['Math.abs', 'Math.imul', 'Math.max', 'Math.min'].includes(m), m);
  assert.doesNotMatch(code, /\d\.\d/, 'no float literals');
  assert.doesNotMatch(code.replace(/`[^`]*`/g, ''), /[^/*\s]\s*\/\s*[^/*\s]/, 'no division');
});

test('the town scripts under ui/town parse (ui-syntax only walks ui/*.js)', () => {
  const dir = new URL('../modules/walk/ui/town/', import.meta.url).pathname;
  for (const f of fs.readdirSync(dir)) execFileSync(process.execPath, ['--check', path.join(dir, f)], { stdio: 'pipe' });
});

test('a scripted bot (BFS to the nearest item, tap-to-move steering) collects all 6 within 3 minutes for several seeds, and the replay agrees', () => {
  for (const seed of [1, 2, 3, 99, 4242, 1e9 + 7, 4294967295, ...SEEDS.slice(0, 20)]) {
    const { state, log } = bot(seed);
    assert.equal(score(state), 6, `seed ${seed} collected ${score(state)} by tick ${state.tick}`);
    assert.ok(state.tick < C.MAX_TICKS, `seed ${seed} took ${state.tick} ticks`);
    const end = replay(seed, log, state.tick);
    assert.deepEqual(end.collected, state.collected);
    assert.ok(log.length < C.MAX_INPUTS, `seed ${seed}: ${log.length} input changes fit the API limit`);
  }
});

test('replay of the full 5400 ticks takes well under 20 ms, even cold', () => {
  const inputs = [];
  for (let t = 0; t < C.MAX_TICKS; t += 3) inputs.push([t, [RIGHT, DOWN, LEFT, UP | RIGHT, DOWN | LEFT, 0][(t / 3 | 0) % 6]]);   // 1800 changes, the worst loop
  assert.ok(inputs.length <= C.MAX_INPUTS);
  const cold = process.hrtime.bigint();
  replay(1, inputs);
  const coldMs = Number(process.hrtime.bigint() - cold) / 1e6;
  assert.ok(coldMs < 20, `cold replay ${coldMs.toFixed(2)} ms`);
  const t0 = process.hrtime.bigint();
  for (let i = 0; i < 10; i++) replay(1 + i, inputs);
  const ms = Number(process.hrtime.bigint() - t0) / 1e6 / 10;
  assert.ok(ms < 20, `replay took ${ms.toFixed(2)} ms`);
});

// ---------- the API ----------
const T0 = Date.parse('2026-11-02T15:00:00Z');
async function world({ n = 3, config = REAL } = {}) {
  let t = T0;
  const srv = await boot({ config, clock: createClock({ now: () => t }) });
  const w = await seeded(srv, n, { transfers: false });
  const rows = (sql, ...a) => srv.app.db.prepare(sql).all(...a);
  return { srv, ...w, advance: (ms) => { t += ms; }, rows, cleanup: srv.cleanup };
}
const startVisit = async (s) => { const r = await s.client.post('/api/walk/start', {}); assert.equal(r.status, 200, JSON.stringify(r.json)); return r.json; };
const ticksOf = (log) => Math.min(C.MAX_TICKS, (log.at(-1)?.[0] ?? 0) + 60);
const needMs = (ticks) => Math.ceil((ticks * 1000 * 0.4) / C.TPS) + 500;

test('start then finish: the server count is its own replay, whatever the body says; the run is stored and counted once', async () => {
  const w = await world();
  try {
    const [a] = w.students;
    const visit = await startVisit(a);
    assert.match(visit.session, /^[0-9a-f]{32}$/);
    assert.equal(visit.max_ticks, C.MAX_TICKS);
    assert.ok(Number.isInteger(visit.seed) && visit.seed >= 0 && visit.seed < 2 ** 32);
    assert.deepEqual(visit.items, placeItems(visit.seed));
    const { state, log } = bot(visit.seed);
    const ticks = state.tick;
    const expected = replay(visit.seed, log, ticks);
    assert.equal(score(expected), 6);
    w.advance(needMs(ticks));
    const fin = await a.client.post('/api/walk/finish', { session: visit.session, ticks, inputs: log, collected: 99, score: 99, items: [1, 2, 3, 4, 5, 6, 7], best: 99 });
    assert.equal(fin.status, 200, JSON.stringify(fin.json));
    assert.equal(fin.json.collected, 6);
    assert.deepEqual(fin.json.items, expected.collected);
    assert.equal(fin.json.best, 6);
    assert.equal(fin.json.new_best, true);
    const row = w.rows('SELECT * FROM walk_runs WHERE id = ?', visit.session)[0];
    assert.equal(row.status, 'finished');
    assert.equal(row.collected, 6);
    assert.equal(row.ticks, ticks);
    assert.equal(row.seed, visit.seed);
    const again = await a.client.post('/api/walk/finish', { session: visit.session, ticks, inputs: log });
    assert.equal(again.status, 409);
    assert.equal(w.rows("SELECT COUNT(*) AS n FROM walk_runs WHERE status = 'finished'")[0].n, 1);
    const st = (await a.client.get('/api/walk/state')).json;
    assert.deepEqual([st.world_active, st.my_best, st.visits], [true, 6, 1]);
  } finally { await w.cleanup(); }
});

test('a client that claims items it never walked to gets only what the replay found; tampered inputs change the result', async () => {
  const w = await world();
  try {
    const [a] = w.students;
    const v = await startVisit(a);
    w.advance(5 * 60e3);
    const none = await a.client.post('/api/walk/finish', { session: v.session, ticks: 900, inputs: [], collected: 6, score: 6 });
    assert.equal(none.status, 200);
    assert.equal(none.json.collected, 0, 'standing at the spawn collects nothing');
    const v2 = await startVisit(a);
    const { state, log } = bot(v2.seed);
    const tampered = log.slice(0, Math.max(1, log.length >> 1));                      // drop the second half of the walk
    const expected = replay(v2.seed, tampered, state.tick);
    assert.ok(score(expected) < 6, 'the tamper matters for this seed');
    w.advance(needMs(state.tick));
    const res = (await a.client.post('/api/walk/finish', { session: v2.session, ticks: state.tick, inputs: tampered })).json;
    assert.equal(res.collected, score(expected));
    // fewer ticks than the walk needed: fewer items
    const v3 = await startVisit(a);
    const b3 = bot(v3.seed);
    w.advance(needMs(b3.state.tick));
    const short = (await a.client.post('/api/walk/finish', { session: v3.session, ticks: Math.max(1, b3.state.tick >> 1), inputs: b3.log.filter(([t]) => t < b3.state.tick >> 1) })).json;
    assert.equal(short.collected, score(replay(v3.seed, b3.log, b3.state.tick >> 1)));
    assert.ok(short.collected < 6);
  } finally { await w.cleanup(); }
});

test("another player's visit, a missing visit and a superseded one are refused; a new start supersedes the old one", async () => {
  const w = await world();
  try {
    const [a, b] = w.students;
    const v1 = await startVisit(a);
    w.advance(60e3);
    assert.equal((await b.client.post('/api/walk/finish', { session: v1.session, ticks: 10, inputs: [] })).status, 404);
    assert.equal((await a.client.post('/api/walk/finish', { session: 'f'.repeat(32), ticks: 10, inputs: [] })).status, 404);
    const v2 = await startVisit(a);
    assert.notEqual(v2.session, v1.session);
    assert.equal((await a.client.post('/api/walk/finish', { session: v1.session, ticks: 10, inputs: [] })).status, 409);
    assert.deepEqual(w.rows("SELECT id FROM walk_runs WHERE player_id = ? AND status = 'open'", a.id).map((r) => r.id), [v2.session]);
    w.advance(60e3);
    assert.equal((await a.client.post('/api/walk/finish', { session: v2.session, ticks: 10, inputs: [] })).status, 200);
  } finally { await w.cleanup(); }
});

test('an expired visit (15 minutes) is refused; a finish faster than 40% of the play time is rejected, not counted', async () => {
  const w = await world();
  try {
    const [a] = w.students;
    const v1 = await startVisit(a);
    w.advance(14 * 60e3);
    // 14 minutes in is still fine to look at; 16 is not
    w.advance(2 * 60e3);
    assert.equal((await a.client.post('/api/walk/finish', { session: v1.session, ticks: 100, inputs: [] })).status, 409);
    assert.equal(w.rows('SELECT status FROM walk_runs WHERE id = ?', v1.session)[0].status, 'expired');
    const v2 = await startVisit(a);
    const { state, log } = bot(v2.seed);
    w.advance(3000);                                                                  // a walk of thousands of ticks in 3 s
    const fast = await a.client.post('/api/walk/finish', { session: v2.session, ticks: state.tick, inputs: log });
    assert.equal(fast.status, 422);
    assert.deepEqual({ ...w.rows('SELECT status, flag, collected FROM walk_runs WHERE id = ?', v2.session)[0] }, { status: 'rejected', flag: 'fast', collected: null });
    assert.equal((await a.client.post('/api/walk/finish', { session: v2.session, ticks: state.tick, inputs: log })).status, 409, 'no second try with the same visit');
    assert.equal((await a.client.get('/api/walk/state')).json.my_best, null);
    // exactly 40% of the play time is enough
    const v3 = await startVisit(a);
    w.advance(Math.ceil((300 * 1000 * 0.4) / C.TPS));
    assert.equal((await a.client.post('/api/walk/finish', { session: v3.session, ticks: 300, inputs: [] })).status, 200);
  } finally { await w.cleanup(); }
});

test('bad bodies: wrong types, unsorted or duplicate ticks, out-of-range ticks and masks, floats, too many entries, bad ticks, bad session id', async () => {
  const w = await world();
  try {
    const [a] = w.students;
    const v = await startVisit(a);
    w.advance(5 * 60e3);
    const finish = (inputs, ticks = 600, extra = {}) => a.client.post('/api/walk/finish', { session: v.session, ticks, inputs, ...extra });
    const big = Array.from({ length: C.MAX_INPUTS + 1 }, (_, i) => [i, 0]);
    for (const bad of ['x', {}, null, 7, [[1]], [[1, 2, 3]], [['1', 2]], [[1.5, 2]], [[1, 2.5]], [[5, 1], [5, 2]], [[9, 1], [3, 2]], [[-1, 1]], [[600, 1]], [[0, 16]], [[0, -1]], [1, 2], big, undefined]) {
      const res = await finish(bad);
      assert.equal(res.status, 400, `${JSON.stringify(bad)?.slice(0, 40)} -> ${res.status}`);
    }
    for (const ticks of [0, -1, 1.5, '600', null, C.MAX_TICKS + 1, 1e9]) assert.equal((await finish([], ticks)).status, 400, `ticks ${ticks}`);
    assert.equal((await a.client.post('/api/walk/finish', { session: v.session, inputs: [] })).status, 400, 'ticks is required');
    assert.equal((await a.client.post('/api/walk/finish', { session: 'nope', ticks: 5, inputs: [] })).status, 400);
    assert.equal((await a.client.post('/api/walk/finish', { session: 7, ticks: 5, inputs: [] })).status, 400);
    assert.equal(w.rows('SELECT status FROM walk_runs WHERE id = ?', v.session)[0].status, 'open', 'a malformed finish does not burn the visit');
    assert.equal((await finish([[0, 15], [1, 0], [599, 8]])).status, 200, 'the edges are valid');
  } finally { await w.cleanup(); }
});

test('the longest visit (5400 ticks, 1800 changes) is accepted', async () => {
  const w = await world({ n: 1 });
  try {
    const [a] = w.students;
    const v = await startVisit(a);
    const inputs = [];
    for (let t = 0; t < C.MAX_TICKS; t += 3) inputs.push([t, [RIGHT, DOWN, LEFT, UP | RIGHT, DOWN | LEFT, 0][(t / 3 | 0) % 6]]);
    w.advance(needMs(C.MAX_TICKS));
    const t0 = process.hrtime.bigint();
    const res = await a.client.post('/api/walk/finish', { session: v.session, ticks: C.MAX_TICKS, inputs });
    assert.equal(res.status, 200, JSON.stringify(res.json));
    assert.equal(res.json.collected, score(replay(v.seed, inputs, C.MAX_TICKS)));
    assert.ok(Number(process.hrtime.bigint() - t0) / 1e6 < 500);
  } finally { await w.cleanup(); }
});

test('unauthenticated: 401; a closed season: no new visits (409) and no finishes', async () => {
  const w = await world();
  try {
    const anon = w.srv.client();
    assert.equal((await anon.get('/api/walk/state')).status, 401);
    assert.equal((await anon.post('/api/walk/start', {})).status, 401);
    assert.equal((await anon.post('/api/walk/finish', { session: 'a'.repeat(32), ticks: 5, inputs: [] })).status, 401);
    const [a] = w.students;
    const v = await startVisit(a);
    assert.equal((await w.teacher.post('/api/teach/world/close')).status, 200);
    const closed = await a.client.post('/api/walk/start', {});
    assert.equal(closed.status, 409);
    assert.match(closed.json.error, /season is closed/i);
    w.advance(60e3);
    assert.equal((await a.client.post('/api/walk/finish', { session: v.session, ticks: 10, inputs: [] })).status, 409);
    const st = await a.client.get('/api/walk/state');
    assert.equal(st.status, 200);
    assert.equal(st.json.world_active, false);
  } finally { await w.cleanup(); }
});

test('the start throttle: 12 visits an hour per student, others unaffected, and the hour passes', async () => {
  const w = await world();
  try {
    const [a, b] = w.students;
    for (let i = 0; i < 12; i++) await startVisit(a);
    assert.equal((await a.client.post('/api/walk/start', {})).status, 429);
    await startVisit(b);
    w.advance(3600e3 + 1000);
    await startVisit(a);
  } finally { await w.cleanup(); }
});

test('a course that does not enable walk gets 404 on every walk route and no panel; where it is on, the panel and its files are served', async () => {
  const config = structuredClone(REAL);
  config.courses.fintech10.modules = config.courses.fintech10.modules.filter((m) => m !== 'walk');
  const w = await world({ n: 1, config });
  try {
    const [a] = w.students;
    assert.equal((await a.client.get('/api/walk/state')).status, 404);
    assert.equal((await a.client.post('/api/walk/start', {})).status, 404);
    assert.equal((await a.client.post('/api/walk/finish', { session: 'a'.repeat(32), ticks: 5, inputs: [] })).status, 404);
    assert.ok(!(await a.client.get('/api/me')).json.panels.some((p) => p.module === 'walk'));
    const on = await world({ n: 1 });
    try {
      const panel = (await on.students[0].client.get('/api/me')).json.panels.find((p) => p.module === 'walk');
      assert.equal(panel.building.key, 'walk');
      assert.equal(panel.building.name, 'Town Walk');
      assert.match(panel.src, /^\/m\/walk\/walk\.js\?v=/);
      for (const f of ['walk.js', 'walk.css', 'town/town.js', 'town/town-core.js', 'town/art.js', 'town/pixfont.js', 'town/facts.js']) {
        const res = await fetch(`${on.srv.base}/m/walk/${f}`);
        assert.equal(res.status, 200, f);
        if (f.endsWith('.js')) assert.doesNotMatch(await res.text(), /__V__/, 'the cache token is filled in');
      }
      assert.equal(new Set((await on.students[0].client.get('/api/me')).json.panels.map((p) => p.building.key)).size, (await on.students[0].client.get('/api/me')).json.panels.length, 'building keys are unique');
    } finally { await on.cleanup(); }
    assert.deepEqual(w.rows('SELECT id FROM walk_runs'), []);
  } finally { await w.cleanup(); }
});

// ---------- the Today errand ----------
test('a verified finish with 3 or more items completes "Take a stroll through town and collect 3 items" once, for at most 50 cents x the price index', async () => {
  const config = { courses: { fintech10: { label: 'x', modules: ['bank-basic', 'walk', 'today'] }, fintech2030: { label: 'y', modules: ['bank-basic', 'walk', 'today'] } } };
  const w = await world({ n: 3, config });
  try {
    const [a, b, c] = w.students;
    const errand = async (s) => (await s.client.get('/api/today/state')).json.errands.find((e) => e.title === 'Take a stroll through town and collect 3 items');
    for (const s of [a, b, c]) { const e = await errand(s); assert.equal(e.status, 'open'); assert.equal(e.building, 'walk'); }
    const before = w.srv.app.ledger.balance(a.chequing.id);
    // a visit with fewer than 3 items completes nothing
    const v0 = await startVisit(a);
    const part = bot(v0.seed);
    let cut = 0;
    while (cut < part.state.tick && score(replay(v0.seed, part.log, cut)) < 2) cut += 10;
    assert.equal(score(replay(v0.seed, part.log, cut)), 2);
    w.advance(needMs(cut));
    assert.equal((await a.client.post('/api/walk/finish', { session: v0.session, ticks: cut, inputs: part.log.filter(([t]) => t < cut) })).status, 200);
    assert.equal((await errand(a)).status, 'open', 'two items is not enough');
    const full = async (s) => { const v = await startVisit(s); const r = bot(v.seed); w.advance(needMs(r.state.tick)); return s.client.post('/api/walk/finish', { session: v.session, ticks: r.state.tick, inputs: r.log }); };
    assert.equal((await full(a)).status, 200);
    const done = await errand(a);
    assert.equal(done.status, 'done');
    assert.ok(done.reward_cents > 0, `reward ${done.reward_cents}`);
    const index = w.srv.app.ledger.balance(a.chequing.id) - before;
    assert.equal(index, done.reward_cents);
    assert.ok(done.reward_cents <= 50 * 3, 'at most 50 cents x a generous price index');
    assert.equal((await errand(b)).status, 'open', 'only the student who walked');
    assert.equal((await full(a)).status, 200);
    assert.equal(w.rows("SELECT COUNT(*) AS n FROM txns WHERE kind = 'today.errand' AND json_extract(meta, '$.template') = 'walk-stroll'")[0].n, 1, 'paid once');
    assert.equal(w.srv.app.ledger.balance(a.chequing.id) - before, done.reward_cents);
    // a rejected (too fast) finish emits nothing: b's errand stays open
    const v = await startVisit(b);
    const r = bot(v.seed);
    w.advance(2000);
    assert.equal((await b.client.post('/api/walk/finish', { session: v.session, ticks: r.state.tick, inputs: r.log })).status, 422);
    assert.equal((await errand(b)).status, 'open');
    assert.equal((await errand(c)).status, 'open');
    assert.equal(w.srv.app.ledger.audit().ok, true);
  } finally { await w.cleanup(); }
});

test('the errand template: one walk errand, at most 50 cents, energy 1, completed by the walk event, and the walk module has no other money path', () => {
  const errands = JSON.parse(fs.readFileSync(new URL('../modules/today/errands.json', import.meta.url), 'utf8')).filter((e) => e.module === 'walk');
  assert.equal(errands.length, 1);
  const [e] = errands;
  assert.deepEqual([e.building, e.reward_cents <= 50, e.energy, e.done.event], ['walk', true, 1, 'module.walk.collected']);
  assert.ok(e.title.length <= 80);
  const src = fs.readFileSync(new URL('../modules/walk/index.js', import.meta.url), 'utf8').split('\n').map((l) => l.replace(/\/\/.*$/, '')).join('\n');
  assert.doesNotMatch(src, /ledger|stress|wage|promotion|post\(/i);
});
