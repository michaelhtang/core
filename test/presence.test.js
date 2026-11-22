// presence (docs/walk.md "As built (presence)"): classmates on the Town Walk screen, live, pseudonyms only. Covers k.push (the kernel's way for a module
// to push its own SSE event), the hub's skippable events, and the whole presence flow over real HTTP and real streams: same class only, never yourself,
// five numbers and a pseudonym and nothing else, expiry, leave, rate limit, strict validation, closed season, the config switch, nothing in the database,
// and a load check with 30 players.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createClock } from '../lib/clock.js';
import { createKernel } from '../lib/kernel.js';
import { createStreams } from '../server.js';
import { boot, seeded, addClass, openStream } from './helpers.js';

const REAL = JSON.parse(fs.readFileSync(new URL('../config/vdaa.json', import.meta.url), 'utf8'));
const T0 = Date.parse('2026-11-02T15:00:00Z');
const configWith = (walk) => { const c = structuredClone(REAL); c.options.walk = { presenceTickMs: 30, ...walk }; return c; };

async function world({ n = 3, config = configWith({}), clock = true } = {}) {
  let t = T0;
  const srv = await boot({ config, ...(clock ? { clock: createClock({ now: () => t }) } : {}) });
  const w = await seeded(srv, n, { transfers: false });
  const streams = [];
  const open = async (client) => { const s = await openStream(srv, client); streams.push(s); return s; };
  return { srv, ...w, open, advance: (ms) => { t += ms; }, async cleanup() { streams.forEach((s) => s.close()); await srv.cleanup(); } };
}
const pos = (s, body) => s.client.post('/api/walk/pos', body);
const snaps = (stream) => stream.events.filter((e) => e.event === 'walk.presence');
// Wait until some snapshot this stream got satisfies pred (a snapshot that was true once and is gone again still counts), or fail.
async function seen(stream, pred, what, ms = 3000) {
  const end = Date.now() + ms;
  for (;;) {
    const hit = snaps(stream).find((e) => pred(e.data.players));
    if (hit) return hit.data.players;
    if (Date.now() > end) assert.fail(`no snapshot with ${what}; got ${JSON.stringify(snaps(stream).slice(-3).map((e) => e.data))}`);
    await new Promise((r) => setTimeout(r, 15));
  }
}
const lastPlayers = (stream) => snaps(stream).at(-1)?.data.players;
const nap = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------- k.push ----------
test('k.push: only the named players get it; a teacher only when listed; it is not a module event, so the teacher console is not poked', async () => {
  const w = await world({ n: 2 });
  try {
    const [a, b] = w.students;
    const sa = await w.open(a.client), sb = await w.open(b.client), st = await w.open(w.teacher);
    const k = createKernel(w.srv.app, 'walk', { call() {}, has: () => false });
    k.push([a.id], 'walk.hello', { n: 1 });
    assert.deepEqual((await sa.next('walk.hello', 1500))?.data, { n: 1 });
    assert.equal(await sb.next('walk.hello', 300), null, 'another student does not get it');
    assert.equal(await st.next('walk.hello', 300), null, 'a teacher does not get it');
    assert.equal(await st.next('console', 800), null, 'no console hint: it is not a module.* event');
    k.push([w.srv.app.players.byUsername('teacher').id, b.id], 'walk.hello', { n: 2 });
    assert.deepEqual((await st.next('walk.hello', 1500))?.data, { n: 2 }, 'listed teachers get it');
    assert.deepEqual((await sb.next('walk.hello', 1500))?.data, { n: 2 });
    k.push([], 'walk.hello', { n: 3 });                                                  // nobody: fine
    k.push([987654], 'walk.hello', { n: 4 });                                            // a player with no stream: fine
  } finally { await w.cleanup(); }
});

test('k.push: the event must be walk.<name> in lower case, ids a short list of whole numbers, data JSON up to 4 KB', () => {
  const emitted = [];
  const app = { events: { emit: (t, p) => emitted.push([t, p]) }, config: {}, db: { prepare() {} }, world: {}, clock: {}, ledger: {}, players: {}, policy: {} };
  const k = createKernel(app, 'walk', { call() {}, has: () => false });
  for (const bad of ['walk', 'walk.', 'arcade.x', 'Walk.x', 'walk.X', 'walk.a b', 'walk.a_b', `walk.${'a'.repeat(40)}`, 'bank-basic.x', '.walk.x', 'walkx.pres', 7, null, undefined, ['walk.x']]) {
    assert.throws(() => k.push([1], bad, {}), /k\.push: event/, String(bad));
  }
  for (const good of ['walk.a', 'walk.ab', 'walk.presence', 'walk.a-b.c1', `walk.${'a'.repeat(35)}`]) k.push([1], good, {});
  assert.equal(emitted.length, 5);
  const many = Array.from({ length: 201 }, (_, i) => i + 1);
  for (const bad of [1, '1', null, undefined, {}, many, [1.5], ['1'], [NaN], [Infinity], [null], [2 ** 60]]) assert.throws(() => k.push(bad, 'walk.ok', {}), /k\.push: playerIds/, JSON.stringify(bad)?.slice(0, 20));
  k.push(many.slice(0, 200), 'walk.ok', {});
  assert.throws(() => k.push([1], 'walk.ok', undefined), /k\.push: data/);
  assert.throws(() => k.push([1], 'walk.ok', () => 1), /k\.push: data/);
  assert.throws(() => k.push([1], 'walk.ok', { s: 'x'.repeat(4096) }), /k\.push: data/);
  assert.throws(() => k.push([1], 'walk.ok', 1n), TypeError);
  k.push([1], 'walk.ok', { s: 'x'.repeat(4000) });
  const n = emitted.length;
  k.push([1], 'walk.ok', 'x'.repeat(4000));
  assert.equal(emitted.length, n + 1);
  assert.deepEqual(emitted.at(-1), ['stream.push', { to: [1], event: 'walk.ok', data: 'x'.repeat(4000), skippable: false }], 'an internal event, not module.*');
  k.push([1], 'walk.ok', {}, { skippable: true });
  assert.equal(emitted.at(-1)[1].skippable, true);
  k.push([1], 'walk.ok', {}, { skippable: 'yes' });
  assert.equal(emitted.at(-1)[1].skippable, false, 'only true counts');
  assert.ok(emitted.every(([type]) => !type.startsWith('module.')));
});

test('the hub: a skippable event is dropped while a stream is backed up; others and non-skippable events still go', () => {
  const hub = createStreams();
  const wrote = [];
  let backed = false, drain;
  const res = { write: (s) => { wrote.push(s); return !backed; }, once: (_, f) => { drain = f; }, end() {} };
  const stream = { res, playerId: 1, role: 'student', tokenHash: 'x' };
  hub.add(stream);
  hub.send([stream], 'walk.presence', { a: 1 }, true);
  assert.equal(wrote.length, 1);
  backed = true;
  hub.send([stream], 'walk.other', { a: 2 });                                           // goes, but the socket now says it is full
  assert.equal(wrote.length, 2);
  hub.send([stream], 'walk.presence', { a: 3 }, true);
  hub.send([stream], 'ping');
  assert.equal(wrote.length, 2, 'skipped while backed up');
  hub.send([stream], 'walk.other', { a: 4 });
  assert.equal(wrote.length, 3, 'a non-skippable custom event is still written');
  backed = false; drain();
  hub.send([stream], 'walk.presence', { a: 5 }, true);
  assert.equal(wrote.length, 4, 'after the drain it flows again');
});

// ---------- presence over HTTP ----------
test('presence: classmates see each other, never themselves or another class; the payload is a pseudonym and four numbers', async () => {
  const w = await world({ n: 3 });
  try {
    const [a1, a2, a3] = w.students;
    const b = await addClass(w.srv, w.teacher, 'Block 2', 2);
    const [b1] = b.students;
    const s1 = await w.open(a1.client), s2 = await w.open(a2.client), s3 = await w.open(a3.client), sb = await w.open(b1.client), st = await w.open(w.teacher);
    assert.deepEqual((await pos(a1, { x: 100, y: 200, dir: 1 })).json, { ok: true });
    assert.equal((await pos(a2, { x: 300, y: 50, dir: 3 })).status, 200);
    assert.equal((await pos(b1, { x: 10, y: 20, dir: 0 })).status, 200);
    const got = await seen(s1, (p) => p.length === 1, 'one classmate');
    assert.deepEqual(got, [{ u: a2.username, x: 300, y: 50, d: 3, e: 0 }]);
    assert.deepEqual(Object.keys(got[0]).sort(), ['d', 'e', 'u', 'x', 'y']);
    await seen(s2, (p) => p.length === 1 && p[0].u === a1.username && p[0].x === 100 && p[0].y === 200 && p[0].d === 1, 'a1 for a2');
    await seen(sb, (p) => p.length === 0, 'an empty list for the other class');
    await nap(150);
    const names = (s) => snaps(s).flatMap((e) => e.data.players.map((p) => p.u));
    assert.ok(!names(s1).includes(a1.username), 'never yourself');
    assert.ok(!names(s2).includes(a2.username));
    assert.ok(!names(s1).includes(b1.username) && !names(s2).includes(b1.username), 'never another class');
    assert.deepEqual(names(sb), [], 'the other class sees nobody from this one');
    assert.deepEqual(snaps(s3), [], 'a classmate who is not on the screen gets nothing');
    assert.deepEqual(snaps(st), [], 'a teacher gets nothing');
    for (const e of [...snaps(s1), ...snaps(s2), ...snaps(sb)]) assert.deepEqual(Object.keys(e.data), ['players']);
    const raw = JSON.stringify([...snaps(s1), ...snaps(s2)].map((e) => e.data));
    assert.doesNotMatch(raw, /class|Block|"id"|player_id|\d{5,}/i, 'no ids, no class names');
    assert.equal((await st.next('console', 300)), null, 'the teacher console is not poked by presence');
  } finally { await w.cleanup(); }
});

test('presence: a moved player is sent again, a stationary one still gets a keepalive, an emote shows for 2.5 s and then goes', async () => {
  const w = await world({ n: 2 });
  try {
    const [a1, a2] = w.students;
    const s2 = await w.open(a2.client);
    await pos(a2, { x: 1, y: 1, dir: 0 });
    await pos(a1, { x: 100, y: 100, dir: 0 });
    await seen(s2, (p) => p[0]?.x === 100, 'start');
    w.advance(250);
    await pos(a1, { x: 108, y: 100, dir: 3 });
    await seen(s2, (p) => p[0]?.x === 108 && p[0].d === 3, 'moved');
    const before = snaps(s2).length;
    await nap(120);
    assert.equal(snaps(s2).length, before, 'nothing changed: no new snapshot');
    w.advance(3500);                                                                       // a keepalive is due; both are still inside 10 s
    await pos(a2, { x: 1, y: 1, dir: 0 });
    await pos(a1, { x: 108, y: 100, dir: 3 });
    for (let i = 0; i < 60 && snaps(s2).length <= before; i++) await nap(50);              // wait for the next tick instead of a fixed nap: the machine can be slow
    assert.ok(snaps(s2).length > before, 'a keepalive snapshot went out');
    w.advance(250);
    await pos(a1, { x: 108, y: 100, dir: 3, emote: 3 });
    await seen(s2, (p) => p[0]?.e === 3, 'star');
    w.advance(250);
    await pos(a1, { x: 108, y: 100, dir: 3 });                                             // emote 0 / omitted keeps a running emote
    await nap(120);
    assert.equal(lastPlayers(s2)[0].e, 3);
    w.advance(2600);
    await seen(s2, (p) => p[0]?.e === 0 && snaps(s2).findIndex((x) => x.data.players[0]?.e === 3) < snaps(s2).findIndex((x) => x === snaps(s2).at(-1)), 'emote cleared');
    assert.equal(lastPlayers(s2)[0].e, 0);
  } finally { await w.cleanup(); }
});

test('presence: an entry expires 10 s after its last post, /leave removes it at once, and so does logging out', async () => {
  const w = await world({ n: 4 });
  try {
    const [a1, a2, a3, a4] = w.students;
    const s1 = await w.open(a1.client);
    for (const [s, x] of [[a1, 1], [a2, 2], [a3, 3], [a4, 4]]) await pos(s, { x, y: 5, dir: 0 });
    await seen(s1, (p) => p.length === 3, 'three classmates');
    // leave
    assert.deepEqual((await a2.client.post('/api/walk/leave', {})).json, { ok: true });
    await seen(s1, (p) => p.length === 2 && !p.some((q) => q.u === a2.username), 'a2 gone after leave');
    // logout (session ends)
    assert.equal((await a3.client.post('/api/logout', {})).status, 200);
    await seen(s1, (p) => p.length === 1 && p[0].u === a4.username, 'a3 gone after logout');
    // a4 goes quiet; a1 keeps posting
    for (let i = 0; i < 4; i++) { w.advance(3000); await pos(a1, { x: 1, y: 5, dir: 0 }); await nap(60); }
    await seen(s1, (p) => p.length === 0, 'a4 expired');
    assert.deepEqual((await a2.client.post('/api/walk/leave', {})).json, { ok: true }, 'leaving twice is fine');
  } finally { await w.cleanup(); }
});

test('presence: one post per 200 ms per player (extra ones are dropped, not an error)', async () => {
  const w = await world({ n: 2 });
  try {
    const [a1, a2] = w.students;
    const s2 = await w.open(a2.client);
    await pos(a2, { x: 1, y: 1, dir: 0 });
    assert.deepEqual((await pos(a1, { x: 100, y: 100, dir: 0 })).json, { ok: true });
    const fast = await pos(a1, { x: 111, y: 100, dir: 0 });
    assert.deepEqual([fast.status, fast.json], [200, { ok: true, dropped: true }]);
    await seen(s2, (p) => p[0]?.x === 100, 'first post');
    await nap(100);
    assert.ok(!snaps(s2).some((e) => e.data.players.some((p) => p.x === 111)), 'the dropped post changed nothing');
    w.advance(199);
    assert.equal((await pos(a1, { x: 112, y: 100, dir: 0 })).json.dropped, true);
    w.advance(1);
    assert.deepEqual((await pos(a1, { x: 113, y: 100, dir: 0 })).json, { ok: true });
    await seen(s2, (p) => p[0]?.x === 113, 'after 200 ms');
  } finally { await w.cleanup(); }
});

test('presence: strict validation (whole numbers in range, known fields only, an object body), and a bad post changes nothing', async () => {
  const w = await world({ n: 2 });
  try {
    const [a1, a2] = w.students;
    const s2 = await w.open(a2.client);
    await pos(a2, { x: 1, y: 1, dir: 0 });
    const ok = { x: 10, y: 20, dir: 2 };
    const bads = [
      { ...ok, x: 1.5 }, { ...ok, y: 0.1 }, { ...ok, dir: 1.5 }, { ...ok, emote: 1.5 }, { ...ok, x: '10' }, { ...ok, x: null }, { ...ok, x: true }, { ...ok, x: 1e21 },
      { ...ok, x: -1 }, { ...ok, x: 512 }, { ...ok, y: -1 }, { ...ok, y: 384 }, { ...ok, dir: -1 }, { ...ok, dir: 4 }, { ...ok, emote: 4 }, { ...ok, emote: -1 }, { ...ok, emote: '1' }, { ...ok, emote: null },
      { ...ok, extra: 1 }, { ...ok, id: 5 }, { ...ok, u: 'Someone' }, { ...ok, class_id: 1 }, { x: 1, y: 1 }, { x: 1, dir: 0 }, { y: 1, dir: 0 }, {},
      [], [1, 2, 3], null, 'x', 7,
    ];
    for (const bad of bads) assert.equal((await pos(a1, bad)).status, 400, JSON.stringify(bad));
    assert.equal((await a1.client.post('/api/walk/pos', undefined)).status, 400, 'no body is {}: x is missing');
    await nap(120);
    assert.deepEqual(snaps(s2).flatMap((e) => e.data.players), [], 'nothing was stored for a1');
    for (const good of [{ x: 0, y: 0, dir: 0 }, { x: 511, y: 383, dir: 3, emote: 3 }, { x: 5, y: 5, dir: 1, emote: 0 }]) { w.advance(250); assert.equal((await pos(a1, good)).status, 200, JSON.stringify(good)); }
  } finally { await w.cleanup(); }
});

test('presence: 401 when signed out, 403 for a teacher, 409 between seasons, 404 where walk is off; state says whether presence is on', async () => {
  const w = await world({ n: 2 });
  try {
    const [a1] = w.students;
    const anon = w.srv.client();
    for (const p of ['pos', 'leave']) assert.equal((await anon.post(`/api/walk/${p}`, { x: 1, y: 1, dir: 0 })).status, 401, p);
    assert.equal((await w.teacher.post('/api/walk/pos', { x: 1, y: 1, dir: 0 })).status, 403);
    assert.equal((await w.teacher.post('/api/walk/leave', {})).status, 403);
    assert.equal((await a1.client.get('/api/walk/state')).json.presence, true);
    assert.equal((await pos(a1, { x: 1, y: 1, dir: 0 })).status, 200);
    assert.equal((await w.teacher.post('/api/teach/world/close')).status, 200);
    w.advance(250);
    assert.equal((await pos(a1, { x: 1, y: 1, dir: 0 })).status, 409);
    assert.equal((await a1.client.get('/api/walk/state')).json.presence, true);
  } finally { await w.cleanup(); }
  const config = configWith({});
  config.courses.fintech10.modules = config.courses.fintech10.modules.filter((m) => m !== 'walk');
  const off = await world({ n: 1, config });
  try {
    assert.equal((await pos(off.students[0], { x: 1, y: 1, dir: 0 })).status, 404);
    assert.equal((await off.students[0].client.post('/api/walk/leave', {})).status, 404);
  } finally { await off.cleanup(); }
});

test('presence: options.walk.presence = false switches it off: the state says so, the routes answer {presence:false}, nothing is broadcast or kept', async () => {
  const w = await world({ n: 2, config: configWith({ presence: false }) });
  try {
    const [a1, a2] = w.students;
    const s1 = await w.open(a1.client), s2 = await w.open(a2.client);
    assert.equal((await a1.client.get('/api/walk/state')).json.presence, false);
    assert.deepEqual((await pos(a1, { x: 1, y: 1, dir: 0 })).json, { presence: false });
    assert.deepEqual((await pos(a2, { x: 2, y: 2, dir: 0 })).json, { presence: false });
    assert.deepEqual((await a2.client.post('/api/walk/leave', {})).json, { presence: false });
    await nap(200);
    assert.deepEqual([...snaps(s1), ...snaps(s2)], []);
  } finally { await w.cleanup(); }
  const dflt = await world({ n: 1, config: structuredClone(REAL) });                        // the shipped config, no tick override: presence defaults to on
  try { assert.equal((await dflt.students[0].client.get('/api/walk/state')).json.presence, true); } finally { await dflt.cleanup(); }
  assert.equal(REAL.options.walk.presence, true, 'config/vdaa.json declares it');
});

test('presence: nothing about positions or presence is written to the database', async () => {
  const w = await world({ n: 3 });
  try {
    const db = w.srv.app.db;
    const tables = () => db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all().map((r) => r.name);
    const counts = () => Object.fromEntries(tables().map((t) => [t, db.prepare(`SELECT COUNT(*) AS n FROM "${t}"`).get().n]));
    const before = { tables: tables(), counts: counts() };
    const s1 = await w.open(w.students[0].client);
    for (let i = 0; i < 6; i++) {
      for (const [j, s] of w.students.entries()) await pos(s, { x: 10 * i + j, y: 77, dir: i & 3, emote: i === 2 ? 1 : 0 });
      w.advance(250);
    }
    await w.students[1].client.post('/api/walk/leave', {});
    await seen(s1, (p) => p.length >= 1, 'it ran');
    assert.deepEqual(tables(), before.tables, 'no new table');
    assert.deepEqual(counts(), before.counts, 'no new row anywhere');
    assert.deepEqual(db.prepare("SELECT name FROM sqlite_master WHERE (sql LIKE '%presence%' OR sql LIKE '%emote%') AND name NOT LIKE 'walk_class_settings%'").all(), [], 'no schema mentions it');   // except the teacher's per-class on/off switch: a setting, never a position
  } finally { await w.cleanup(); }
});

test('presence: the shipped files are served and the cache token is filled in', async () => {
  const w = await world({ n: 1 });
  try {
    for (const f of ['walk.js', 'walk.css', 'town/town.js', 'town/presence.js', 'town/art.js']) {
      const res = await fetch(`${w.srv.base}/m/walk/${f}`);
      assert.equal(res.status, 200, f);
      if (f.endsWith('.js')) assert.doesNotMatch(await res.text(), /__V__/);
    }
  } finally { await w.cleanup(); }
});

// ---------- load ----------
test('load: 30 players posting every 250 ms for 3 s stay responsive, each stream gets about 2 snapshots a second, a snapshot never exceeds 40 players, the broadcast is cheap', async () => {
  const w = await world({ n: 45, config: configWith({ presenceTickMs: 500 }), clock: false });   // the real clock and the real 500 ms tick
  try {
    const kids = w.students;
    const streams = [];
    for (const s of kids) streams.push(await w.open(s.client));
    const st = await w.open(w.teacher);
    // time what a tick spends in the hub: stream.push emits that follow one another
    const events = w.srv.app.events, emit = events.emit.bind(events);
    const bursts = []; let last = -1e9;
    events.emit = (type, payload) => {
      if (type !== 'stream.push') return emit(type, payload);
      const t0 = performance.now();
      if (t0 - last > 100) bursts.push(0);
      emit(type, payload);
      const t1 = performance.now();
      bursts[bursts.length - 1] += t1 - t0; last = t1;
    };
    let stop = false, lag = 0, probes = 0;
    const probe = (async () => { while (!stop) { const t0 = performance.now(); await kids[40].client.get('/api/walk/state'); lag = Math.max(lag, performance.now() - t0); probes++; await nap(100); } })();
    const t0 = performance.now(), until = t0 + 3000;
    let posts = 0, bad = 0;
    await Promise.all(kids.slice(0, 30).map(async (s, i) => {
      await nap(i * 8);
      for (let n = 0; performance.now() < until; n++) {
        const r = await pos(s, { x: (i * 13 + n * 3) % 512, y: (i * 7 + n) % 384, dir: n & 3 });
        posts++; if (r.status !== 200 || r.json.dropped) bad++;
        await nap(250);
      }
    }));
    const secs = (performance.now() - t0) / 1000;
    stop = true; await probe;
    const fps = streams.slice(0, 30).map((s) => snaps(s).length / secs).sort((a, b) => a - b);
    const mean = bursts.reduce((a, b) => a + b, 0) / bursts.length, max = Math.max(...bursts);
    console.log(`  load: ${posts} posts in ${secs.toFixed(1)} s (${bad} dropped or failed), ${bursts.length} ticks, broadcast per tick mean ${mean.toFixed(2)} ms max ${max.toFixed(2)} ms, snapshots/s per stream min ${fps[0].toFixed(2)} median ${fps[15].toFixed(2)} max ${fps[29].toFixed(2)}, slowest probe ${lag.toFixed(0)} ms over ${probes} probes`);
    assert.ok(posts >= 30 * 8, `posts ${posts}`);
    assert.equal(bad, 0, 'no post failed or was rate limited at 250 ms');
    assert.ok(lag < 500, `an unrelated request took ${lag.toFixed(0)} ms during the load`);
    assert.ok(mean < 10 && max < 50, `broadcast per tick mean ${mean.toFixed(2)} ms, max ${max.toFixed(2)} ms`);
    assert.ok(fps[0] > 0.5 && fps[29] < 3.5, `snapshots per second per stream ${fps[0].toFixed(2)}..${fps[29].toFixed(2)}`);
    for (const s of streams.slice(0, 30)) {
      const l = lastPlayers(s);
      assert.ok(l && l.length === 29, `each of 30 sees the other 29 (${l?.length})`);
    }
    assert.equal(await st.next('console', 200), null, 'no teacher console hints from presence');
    // beyond 40: a snapshot lists at most 40, never the receiver
    for (const [i, s] of kids.slice(30).entries()) await pos(s, { x: i, y: 9, dir: 0 });
    await seen(streams[0], (p) => p.length === 40, 'a capped list of 40', 3000);
    assert.ok(snaps(streams[0]).every((e) => e.data.players.length <= 40 && !e.data.players.some((p) => p.u === kids[0].username)));
    assert.ok(snaps(streams[44]).every((e) => e.data.players.length <= 40 && !e.data.players.some((p) => p.u === kids[44].username)));
  } finally { await w.cleanup(); }
});
