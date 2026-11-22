import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { tmpDir, bareApp } from './helpers.js';
import { createApp } from '../lib/app.js';
import { openDb, migrate } from '../lib/db.js';

test('migrations are idempotent: reopening the same database applies nothing twice', async () => {
  const dir = tmpDir();
  const first = await createApp({ dataDir: dir });
  const ids = first.db.prepare('SELECT id FROM schema_migrations ORDER BY id').all().map((r) => r.id);
  const accounts = first.db.prepare('SELECT COUNT(*) AS n FROM accounts').get().n;
  first.db.close();
  const second = await createApp({ dataDir: dir });
  assert.deepEqual(second.db.prepare('SELECT id FROM schema_migrations ORDER BY id').all().map((r) => r.id), ids);
  assert.equal(second.db.prepare('SELECT COUNT(*) AS n FROM accounts').get().n, accounts); // system accounts not re-seeded
  assert.ok(ids.includes('core/001_core.sql') && ids.includes('core/002_ledger_guard.sql') && ids.includes('mod:bank-basic:001_settings'));
  second.db.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

test('migrate() applies each item once, in order, and a failing one leaves no trace', () => {
  const dir = tmpDir();
  const db = openDb(`${dir}/m.db`);
  const items = [{ id: 'x/001', sql: 'CREATE TABLE t (a INTEGER)' }, { id: 'x/002', sql: 'INSERT INTO t VALUES (1)' }];
  migrate(db, items);
  migrate(db, items);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM t').get().n, 1);
  assert.throws(() => migrate(db, [{ id: 'x/003', sql: 'CREATE TABLE u (a); INSERT INTO nope VALUES (1)' }]));
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE name = 'u'").get().n, 0);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM schema_migrations WHERE id = 'x/003'").get().n, 0);
  db.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

test('the database runs in WAL mode', async () => {
  const { app, cleanup } = await bareApp();
  assert.equal(app.db.prepare('PRAGMA journal_mode').get().journal_mode, 'wal');
  cleanup();
});

test('world clock: advance runs tick hooks in order; a failing hook undoes the advance', async () => {
  const { app, cleanup } = await bareApp();
  const seen = [];
  app.world.onTick('a', ({ month }) => seen.push(`a${month}`));
  app.world.onTick('b', ({ month }) => seen.push(`b${month}`));
  assert.equal(app.world.current().month, 1);
  app.world.advance();
  assert.deepEqual(seen, ['a2', 'b2']);
  app.world.setMonthsPerDay(2);
  assert.equal(app.world.advance().month, 4);
  app.world.onTick('boom', () => { throw new Error('tick failed'); });
  assert.throws(() => app.world.advance(), /tick failed/);
  assert.equal(app.world.current().month, 4);
  assert.throws(() => app.world.advance({ months: 0 }), /1 to 12/);
  cleanup();
});

test('module registry: enabled modules per course, panels and routes', async () => {
  const { app, cleanup } = await bareApp();
  assert.deepEqual(app.modules.enabledFor('fintech10'), app.config.courses.fintech10.modules);   // whatever config/vdaa.json lists, in order
  assert.deepEqual(app.modules.enabledFor('nope'), []);
  assert.equal(app.modules.panelsFor('fintech10', 'v1')[0].src, '/m/bank-basic/bank.js?v=v1');
  assert.ok(app.modules.routes().some((r) => r.fullPath === '/api/bank-basic/transfer'));
  cleanup();
});

test('no personal data columns exist: players hold only a pseudonym, hash, class, role and avatar', async () => {
  const { app, cleanup } = await bareApp();
  const cols = app.db.prepare('PRAGMA table_info(players)').all().map((c) => c.name);
  assert.deepEqual(cols.sort(), ['avatar', 'class_id', 'created', 'first_login', 'id', 'pin_hash', 'role', 'seen_world_id', 'username', 'world_teacher']);   // seen_world_id: a world id; first_login: a timestamp. Neither is personal
  cleanup();
});

test('module order in config/vdaa.json: what each module needs to run before', () => {
  const config = JSON.parse(fs.readFileSync(new URL('../config/vdaa.json', import.meta.url), 'utf8'));
  for (const [course, { modules }] of Object.entries(config.courses)) {
    const at = (m) => { const i = modules.indexOf(m); assert.ok(i >= 0, `${course}: ${m} enabled`); return i; };
    const before = (a, b, why) => assert.ok(at(a) < at(b), `${course}: ${a} before ${b} (${why})`);
    for (const m of ['jobs', 'housing', 'insurance', 'bills']) before('rates', m, 'the price index arrives before amounts are issued');
    for (const m of ['credit', 'savings', 'outfitters']) before('rates', m, "this month's card APR, HISA rate and price index arrive before they are used");
    before('jobs', 'bills', 'net pay is known when bills are issued');
    for (const m of ['housing', 'credit', 'exchange']) before('jobs', m, "this month's pay (module.jobs.paid) is counted toward qualifying, the card limit and RRSP room");
    before('housing', 'credit', "the mortgage payment's on-time or late mark (module.housing.payment) is in this month's score");
    before('housing', 'insurance', 'a condo bought this month (module.housing.value) is known when insurance judges cover');
    before('housing', 'bills', "housing costs become this month's due lines");
    before('insurance', 'bills', "premiums and event expenses become this month's due lines");
    before('credit', 'bills', "card autopay clears last month's charges before bills charges this month's");
    before('bills', 'outfitters', "bills' late marks for last month are known when the on-time streak is judged");
    if (modules.includes('stress')) { before('bills', 'stress', "this month's late bills are in the stress score"); before('stress', 'leaderboards', 'the health board reads this month\'s stress'); }
    before('exchange', 'arcade', 'arcade comes after exchange'); before('arcade', 'walk', 'walk comes after arcade'); assert.equal(at('savings') - at('walk'), 1, `${course}: walk right before savings`);   // arcade has no tick; the slot is pinned so the order stays one decision
    before('exchange', 'savings', "the net worth snapshot includes the holdings value the exchange announces this tick");
    before('exchange', 'leaderboards', 'the month-end snapshot includes the holdings value');
    before('rates', 'exchange', "the bond fund's rate shock uses this month's policy rate");
    // retirement (5c): pensions and draws land at the payday moment, before housing debits rent and the mortgage and bills runs autopay (bills marks a line late before autopay)
    if (modules.includes('retirement')) { before('jobs', 'retirement', 'the payday moment'); for (const m of ['housing', 'credit', 'bills']) before('retirement', m, 'retirement income is in chequing before payments are taken'); }
    // today (5a) comes after it: its tick only writes the day row (no money, no per-student work), and its day starts after every other tick.
    // life (5b) sits between them: its tick reads month-end net worth (savings) for the Life Review snapshots and ends jobs after payday.
    // feed (6a) is last of all: it only listens and prunes, so every emitter has ticked before it.
    // learn (the Learning Road) has no tick and sits right before today, so it counts with the tail.
    const ticking = modules.filter((m) => m !== 'today' && m !== 'life' && m !== 'feed' && m !== 'learn');
    const tail = modules.filter((m) => m === 'feed' || m === 'today' || m === 'learn');
    if (modules.includes('learn')) assert.equal(modules.indexOf('today') - modules.indexOf('learn'), 1, `${course}: learn right before today`);
    if (modules.includes('feed')) assert.equal(modules.at(-1), 'feed', `${course}: feed last (it only listens, after every emitter)`);
    if (modules.includes('today')) assert.equal(modules.at(modules.includes('feed') ? -2 : -1), 'today', `${course}: today right before feed (the day begins after every other module's tick)`);
    if (modules.includes('life')) assert.equal(modules.at(-1 - tail.length), 'life', `${course}: life after leaderboards, before today`);
    assert.equal(ticking.at(-1), 'leaderboards', `${course}: leaderboards last of the rest (its snapshot is month-end, after every other module's tick)`);
    // ventures (6c) may sit between savings and leaderboards: its tick moves only business treasuries and system accounts (never a student's), and
    // leaderboards reads the stakes it announces this tick (module.ventures.value).
    const rest = ticking.filter((m) => m !== 'ventures');
    if (modules.includes('ventures')) { before('savings', 'ventures', 'Phase 6c order'); before('ventures', 'leaderboards', 'the month-end snapshot includes the stakes ventures announces'); }
    assert.equal(rest.at(-2), 'savings', `${course}: savings right before it (its snapshot is month-end net worth)`);
  }
});
