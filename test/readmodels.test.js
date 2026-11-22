import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { boot, seeded, tmpDir } from './helpers.js';
import { createApp } from '../lib/app.js';
import { createClock } from '../lib/clock.js';

// A clock you set by hand. Edmonton is UTC-6 in summer (MDT): 03:00 local is 09:00Z.
const fake = (iso) => { let t = Date.parse(iso); const c = createClock({ now: () => t }); c.set = (v) => { t = Date.parse(v); }; c.tick = (ms) => { t += ms; }; return c; };
const runs = (app) => app.db.prepare('SELECT COUNT(*) AS n FROM audit_runs').get().n;

test('audit: GET returns the stored result (running one only when none exists); POST runs a fresh one, at most once per 30 s', async () => {
  const clock = fake('2026-06-10T14:00:00Z');
  const srv = await boot({ clock });
  try {
    const { teacher, students } = await seeded(srv, 2);
    assert.equal(runs(srv.app), 0);
    const first = (await teacher.get('/api/teach/audit')).json;
    assert.equal(first.ok, true);
    assert.equal(first.at, clock.now());
    assert.equal(first.moneySupply, 100000);                                      // seeded() logs both students in: two welcome grants
    assert.equal(runs(srv.app), 1);
    clock.tick(5000);
    assert.equal((await teacher.get('/api/teach/audit')).json.at, first.at);       // a refresh never re-audits
    assert.equal(runs(srv.app), 1);

    const fresh = (await teacher.post('/api/teach/audit/run')).json;               // the first manual run is real
    assert.equal(fresh.at, clock.now());
    assert.equal(runs(srv.app), 2);
    clock.tick(29_999);
    assert.equal((await teacher.post('/api/teach/audit/run')).json.at, fresh.at);  // throttled: the stored one comes back
    assert.equal(runs(srv.app), 2);
    clock.tick(1);
    const again = (await teacher.post('/api/teach/audit/run')).json;
    assert.equal(again.at, clock.now());
    assert.equal(runs(srv.app), 3);
    assert.equal((await teacher.get('/api/teach/audit')).json.at, again.at);

    for (const [m, p] of [['get', '/api/teach/audit'], ['post', '/api/teach/audit/run']]) {
      assert.equal((await students[0].client[m](p)).status, 403);
      assert.equal((await srv.client()[m](p)).status, 401);
    }
  } finally { await srv.cleanup(); }
});

test('audit: the nightly tick runs once per local day after 02:00 and a restart does not repeat it', async () => {
  const dir = tmpDir();
  const clock = fake('2026-06-10T07:00:00Z');                                       // 01:00 local
  let app = await createApp({ dataDir: dir, clock });
  try {
    assert.equal(app.audits.nightly(), null);                                      // too early
    assert.equal(runs(app), 0);
    clock.set('2026-06-10T09:00:00Z');                                             // 03:00 local
    assert.equal(app.audits.nightly().ok, true);
    assert.equal(app.audits.nightly(), null);                                      // already done today
    app.db.close();
    app = await createApp({ dataDir: dir, clock });                                // restart
    clock.set('2026-06-11T05:30:00Z');                                             // 23:30 local on the 10th: still the same day
    assert.equal(app.audits.nightly(), null);
    assert.equal(runs(app), 1);
    clock.set('2026-06-11T09:00:00Z');                                             // next local day, 03:00
    assert.ok(app.audits.nightly());
    assert.equal(runs(app), 2);
  } finally { app.db.close(); fs.rmSync(dir, { recursive: true, force: true }); }
});

test('audit: the server exposes the nightly timer as ticks.nightlyAudit', async () => {
  const clock = fake('2026-06-10T09:00:00Z');
  const srv = await boot({ clock });
  try {
    assert.equal(typeof srv.ticks.nightlyAudit, 'function');
    srv.ticks.nightlyAudit();
    assert.equal(runs(srv.app), 1);
    srv.ticks.nightlyAudit();
    assert.equal(runs(srv.app), 1);
  } finally { await srv.cleanup(); }
});

// ---- per-class aggregates ----
test('console read models: the classes list and the students list are one grouped join, with no per-row subquery and no scan of entries or txns', async () => {
  const { SQL } = await import('../lib/players.js');
  const { bareApp } = await import('./helpers.js');
  const { app, cleanup } = await bareApp();
  try {
    for (const name of ['teacherClasses', 'classStudents']) {
      const plan = app.db.prepare(`EXPLAIN QUERY PLAN ${SQL[name]}`).all(1).map((r) => r.detail);
      assert.ok(plan.length > 0);
      assert.ok(!plan.some((d) => /CORRELATED|SUBQUERY/i.test(d)), `${name}: ${plan.join(' | ')}`);
      assert.ok(!plan.some((d) => /\b(SCAN|SEARCH) (entries|txns)\b/.test(d)), `${name}: ${plan.join(' | ')}`);
      assert.ok(!plan.some((d) => /^SCAN/.test(d)), `${name} scans a table: ${plan.join(' | ')}`);   // aliases (SCAN c) hide the table name, so no scan at all
    }
  } finally { cleanup(); }
});

test('console read models: counts and balances are right (students only, summed over their accounts, class by class)', async () => {
  const srv = await boot();
  try {
    const { teacher, cls, students } = await seeded(srv, 3);
    const other = (await teacher.post('/api/teach/classes', { name: 'Block 2', course: 'fintech10' })).json;
    await teacher.post(`/api/teach/classes/${other.id}/students`, { count: 2 });
    await students[0].client.post('/api/bank-basic/transfer', { to: students[1].username, cents: 1234 });
    const state = (await teacher.get('/api/teach/state')).json;
    assert.deepEqual(state.classes.map((c) => [c.id, c.students]), [[cls.id, 3], [other.id, 2]]);
    const list = (await teacher.get(`/api/teach/classes/${cls.id}/students`)).json.students;
    assert.equal(list.length, 3);
    assert.equal(list.find((s) => s.id === students[0].id).balance_cents, 50000 - 1234);
    assert.equal(list.find((s) => s.id === students[1].id).balance_cents, 50000 + 1234);
    assert.deepEqual(list.map((s) => s.username), list.map((s) => s.username).sort((a, b) => a.localeCompare(b, 'en', { sensitivity: 'base' })));
    const empty = (await teacher.get(`/api/teach/classes/${other.id}/students`)).json.students;
    assert.deepEqual(empty.map((s) => s.balance_cents), [0, 0]);                  // cards printed, nobody logged in
  } finally { await srv.cleanup(); }
});

// ---- bank transfers feed: cursor pages ----
test('bank feed: pages of 100 by txn id (?before=), next only when older rows exist, no gaps or repeats, own classes only', async () => {
  const srv = await boot();
  try {
    const { teacher, cls, students: [s1, s2] } = await seeded(srv, 2);
    const { ledger, db } = srv.app;
    const post = () => {                                                              // as the bank's /transfer route does: ledger post + bank_transfers row
      const id = ledger.post({ kind: 'bank-basic.transfer', actor: `player:${s1.id}`, meta: { from: s1.id, to: s2.id, fromName: s1.username, toName: s2.username },
        legs: [{ account: s1.chequing.id, cents: -1 }, { account: s2.chequing.id, cents: 1 }] });
      db.prepare('INSERT INTO bank_transfers (txn_id, class_id) VALUES (?, ?)').run(id, cls.id);
      return id;
    };
    const ids = Array.from({ length: 250 }, post);
    const page = async (q = '') => (await teacher.get(`/api/bank-basic/transfers${q}`)).json;
    const p1 = await page();
    assert.equal(p1.transfers.length, 100);
    assert.deepEqual(p1.transfers.map((t) => t.id), ids.slice(150).reverse());
    assert.equal(p1.next, ids[150]);
    const p2 = await page(`?before=${p1.next}`);
    assert.deepEqual(p2.transfers.map((t) => t.id), ids.slice(50, 150).reverse());
    assert.equal(p2.next, ids[50]);
    const p3 = await page(`?before=${p2.next}`);
    assert.deepEqual(p3.transfers.map((t) => t.id), ids.slice(0, 50).reverse());
    assert.ok(!('next' in p3));                                                         // the last page has no next
    const exact = await page(`?before=${ids[100]}`);                                    // exactly 100 older rows: still no next
    assert.equal(exact.transfers.length, 100);
    assert.ok(!('next' in exact));
    for (const bad of ['abc', '-1', '1.5', '', '9'.repeat(16)]) assert.equal((await teacher.get(`/api/bank-basic/transfers?before=${bad}`)).status, 400, bad);
    assert.deepEqual((await page('?before=1')).transfers, []);
  } finally { await srv.cleanup(); }
});

// ---- audit_log reader ----
const PASS = 'another long passphrase';
const keysOf = (v) => (v && typeof v === 'object' ? Object.entries(v).flatMap(([k, x]) => [k, ...keysOf(x)]) : []);

// World teacher A with a class and two students, teacher B (joined by invite) with a class and two students of their own.
async function twoClasses() {
  const srv = await boot();
  const seed = await seeded(srv, 2);
  const { teacher: a, cls: clsA, students: sa } = seed;
  const token = new URL((await a.post('/api/teach/invites')).json.url).searchParams.get('invite');
  const b = srv.client();
  assert.equal((await b.post('/api/teach/join', { token, username: 'teacherB', passphrase: PASS })).status, 200);
  const clsB = (await b.post('/api/teach/classes', { name: 'Block B', course: 'fintech10' })).json;
  await b.post('/api/bank-basic/settings', { class_id: clsB.id, enabled: true, per_transfer_cents: 5000, daily_cents: 10000 });
  const made = (await b.post(`/api/teach/classes/${clsB.id}/students`, { count: 2 })).json.students;
  const sb = [];
  for (const m of made) { const c = srv.client(); await c.post('/api/login', { username: m.username, secret: m.pin }); sb.push({ ...m, id: srv.app.players.byUsername(m.username).id, client: c }); }
  return { srv, a, b, clsA, clsB, sa, sb };
}

test('activity log: the world teacher sees everything, newest first; another teacher only rows about their own classes and students', async () => {
  const { srv, a, b, clsA, clsB, sa, sb } = await twoClasses();
  try {
    await sa[0].client.post('/api/bank-basic/transfer', { to: sa[1].username, cents: 500 });
    const t = await sb[0].client.post('/api/bank-basic/transfer', { to: sb[1].username, cents: 700 });
    assert.equal((await b.post(`/api/bank-basic/transfers/${t.json.txn}/reverse`)).status, 200);
    await a.post(`/api/teach/players/${sa[0].id}/unlock`);
    await a.post(`/api/teach/players/${sa[1].id}/reset-pin`);
    await b.post(`/api/teach/players/${sb[0].id}/unlock`);

    const all = (await a.get('/api/teach/log')).json.log;
    const total = srv.app.db.prepare('SELECT COUNT(*) AS n FROM audit_log').get().n;
    assert.equal(all.length, total);                                              // fewer than 50 rows: one page, no next
    assert.deepEqual(all.map((r) => r.id), all.map((r) => r.id).sort((x, y) => y - x));
    assert.ok(all.some((r) => r.action === 'setup') && all.some((r) => r.action === 'teacher.invite') && all.some((r) => r.action === 'world.create' || r.action === 'class.create'));
    assert.equal(all[0].action, 'login.unlock');
    assert.equal(all[0].actor_name, 'teacherB');

    const mine = (await b.get('/api/teach/log')).json.log;
    assert.ok(mine.length > 0 && mine.length < all.length);
    const has = (rows, fn) => rows.some(fn);
    // B sees B's class, B's students' transfer (and its reversal), B's unlock; none of A's class, students, setup, invite or world rows
    assert.ok(has(mine, (r) => r.action === 'class.create' && r.detail.id === clsB.id));
    assert.ok(has(mine, (r) => r.action === 'students.create' && r.detail.classId === clsB.id));
    assert.ok(has(mine, (r) => r.action === 'bank-basic.transfer' && r.detail.to === sb[1].id));
    assert.ok(has(mine, (r) => r.action === 'bank-basic.transfer.reverse' && r.detail.class === clsB.id));
    assert.ok(has(mine, (r) => r.action === 'bank-basic.settings' && r.detail.class === clsB.id));
    assert.ok(has(mine, (r) => r.action === 'login.unlock' && r.detail.player === sb[0].id));
    for (const r of mine) {
      assert.ok(![clsA.id].includes(r.detail.classId) && r.detail.class !== clsA.id && !(r.action === 'class.create' && r.detail.id === clsA.id), `leaked class A row ${r.action}`);
      assert.ok(![sa[0].id, sa[1].id].includes(r.detail.player) && ![sa[0].id, sa[1].id].includes(r.detail.to), `leaked class A student row ${r.action}`);
      assert.ok(!['setup', 'teacher.invite', 'teacher.join', 'world.create', 'world.advance', 'passphrase.change'].includes(r.action), `unscoped row ${r.action}`);
    }
    // and A (the world teacher) sees B's rows too: everything
    assert.ok(all.some((r) => r.action === 'bank-basic.transfer' && r.detail.to === sb[1].id));
  } finally { await srv.cleanup(); }
});

test('activity log: 50 per page, ?before= pages without gaps or repeats, next only when more exist; bad cursors are 400, students 403', async () => {
  const srv = await boot();
  try {
    const { teacher, students } = await seeded(srv, 2);
    for (let i = 0; i < 120; i++) srv.app.db.prepare("INSERT INTO audit_log (at, actor, action, detail) VALUES (?, 'system', 'test.row', ?)").run(i, JSON.stringify({ i }));
    const total = srv.app.db.prepare('SELECT COUNT(*) AS n FROM audit_log').get().n;
    const seen = [];
    let q = '', pages = 0;
    for (;;) {
      const r = (await teacher.get(`/api/teach/log${q}`)).json;
      pages++;
      assert.ok(r.log.length <= 50);
      seen.push(...r.log.map((x) => x.id));
      if (!r.next) break;
      assert.equal(r.log.length, 50);
      assert.equal(r.next, r.log.at(-1).id);
      q = `?before=${r.next}`;
    }
    assert.equal(pages, Math.ceil(total / 50));
    assert.equal(seen.length, total);
    assert.equal(new Set(seen).size, total);
    assert.deepEqual(seen, [...seen].sort((x, y) => y - x));
    for (const bad of ['abc', '-1', '1.5', '', '9'.repeat(16)]) assert.equal((await teacher.get(`/api/teach/log?before=${bad}`)).status, 400, bad);
    assert.equal((await students[0].client.get('/api/teach/log')).status, 403);
    assert.equal((await srv.client().get('/api/teach/log')).status, 401);
  } finally { await srv.cleanup(); }
});

test('activity log: no detail ever carries a pin, hash, token or passphrase key, whatever the actions were', async () => {
  const { srv, a, b, sa, sb } = await twoClasses();
  try {
    await a.post(`/api/teach/players/${sa[0].id}/reset-pin`);
    await a.post('/api/teach/passphrase', { current: 'correct horse battery', next: 'a brand new passphrase' });
    await a.post('/api/teach/invites');
    await sa[1].client.post('/api/bank-basic/transfer', { to: sa[0].username, cents: 500 });
    for (const [who, client] of [['a', a], ['b', b]]) {
      const rows = (await client.get('/api/teach/log')).json.log;
      assert.ok(rows.length >= 3, `${who}: ${rows.length} rows`);
      for (const r of rows) for (const k of keysOf(r.detail)) assert.ok(!/pin|hash|token|passphrase/i.test(k), `${who}: ${r.action} has key ${k}`);
    }
    // the stored rows themselves, too
    for (const r of srv.app.db.prepare('SELECT action, detail FROM audit_log').all()) for (const k of keysOf(JSON.parse(r.detail))) assert.ok(!/pin|hash|token|passphrase/i.test(k), `${r.action}: ${k}`);
    // and the reader strips one that ever slipped in
    srv.app.db.prepare("INSERT INTO audit_log (at, actor, action, detail) VALUES (0, 'system', 'oops', ?)").run(JSON.stringify({ pin_hash: 'x', ok: 1 }));
    assert.deepEqual((await a.get('/api/teach/log')).json.log.find((r) => r.action === 'oops').detail, { ok: 1 });
  } finally { await srv.cleanup(); }
});

// ---- cleanups ----
test('createStudents hashes PINs with bounded concurrency (mapLimit: at most 8 in flight, results in order), and 60 students still work', async () => {
  const { mapLimit } = await import('../lib/players.js');
  let live = 0, peak = 0;
  const out = await mapLimit(Array.from({ length: 60 }, (_, i) => i), 8, async (n) => {
    peak = Math.max(peak, ++live);
    await new Promise((r) => setTimeout(r, 1 + (n % 3)));
    live--;
    return n * 2;
  });
  assert.equal(peak, 8);
  assert.deepEqual(out, Array.from({ length: 60 }, (_, i) => i * 2));
  assert.deepEqual(await mapLimit([], 8, () => 1), []);
  assert.deepEqual(await mapLimit([5], 8, (x) => x + 1), [6]);

  const { bareApp } = await import('./helpers.js');
  const { app, cls, cleanup } = await bareApp();
  try {
    const students = await app.players.createStudents({ classId: cls.id, count: 60 });
    assert.equal(students.length, 60);
    assert.equal(new Set(students.map((s) => s.username)).size, 60);
    const s = students[59];
    assert.ok(await app.players.authenticate(s.username, s.pin));                  // the hash at the end of the batch matches its own PIN
  } finally { cleanup(); }
});

test('throttle: status().locked and trouble().locked are one rule (the hourly cap or the per-minute cap, from any IP)', async () => {
  const { createThrottle } = await import('../lib/throttle.js');
  let t = 1e12;
  const th = createThrottle({ now: () => t, user: 3, userHourly: 6 });
  const fail = (name, ip) => th.reserve(ip, name);                                   // a failed login keeps its slot
  const agree = (name) => {
    const s = th.status(name);
    const tr = th.trouble(1).find((x) => x.username === name);
    assert.equal(tr?.locked, s.locked, `${name}: trouble ${tr?.locked} vs status ${s.locked}`);
    return s.locked;
  };
  for (let i = 0; i < 3; i++) fail('amy', '10.0.0.1');
  assert.equal(agree('amy'), true);                                                  // minute cap full: locked in both
  t += 61_000;
  assert.equal(agree('amy'), false);                                                 // lifted by itself, in both
  for (let i = 0; i < 2; i++) fail('bob', '10.0.0.1');
  assert.equal(agree('bob'), false);
  for (let i = 0; i < 3; i++) { fail('cy', `10.0.0.${i + 10}`); fail('cy', `10.0.0.${i + 10}`); t += 61_000; }   // 6 over the hour: never 3 in a minute
  assert.equal(th.status('cy').failures, 6);
  assert.equal(agree('cy'), true);                                                   // hourly cap full (6): locked in both
  th.clear('cy');
  assert.equal(th.status('cy').locked, false);
});
