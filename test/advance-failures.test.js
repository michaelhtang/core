// Failure isolation in the advance (docs/modules.md section 5, docs/events.md section 3): one student's per-player tick work that throws is
// rolled back to its savepoint and recorded, the advance commits; a module-wide throw still rolls everything back; a listener that throws
// inside the emitter's transaction loses only its own writes; auto-advance stops after a failed advance until the world teacher acts.
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { ROOT, createApp } from '../lib/app.js';
import { createClock } from '../lib/clock.js';
import { start } from '../server.js';
import { withTxn } from '../lib/db.js';
import { tmpDir, openStream } from './helpers.js';

const made = [];
after(() => { for (const d of made) fs.rmSync(d, { recursive: true, force: true }); });
const dir = () => { const d = tmpDir(); made.push(d); return d; };

// Every real module plus the stub-flaky fixture, last in the course.
const base = JSON.parse(fs.readFileSync(path.join(ROOT, 'config', 'vdaa.json'), 'utf8'));
const config = { ...base, courses: Object.fromEntries(Object.entries(base.courses).map(([id, c]) => [id, { ...c, modules: [...c.modules, 'stub-flaky'] }])) };
const modulesDir = dir();
for (const id of fs.readdirSync(path.join(ROOT, 'modules'))) fs.symlinkSync(path.join(ROOT, 'modules', id), path.join(modulesDir, id));
fs.symlinkSync(path.join(ROOT, 'test', 'fixtures', 'modules', 'stub-flaky'), path.join(modulesDir, 'stub-flaky'));
const { control } = await import(pathToFileURL(path.join(modulesDir, 'stub-flaky', 'index.js')).href);
const reset = () => Object.assign(control, { bad: null, wide: false, listenerThrows: false, beforeListen: null });

const quiet = async (fn) => { const e = console.error; console.error = () => {}; try { return await fn(); } finally { console.error = e; } };
const WED_8AM = '2026-06-10T14:00:00Z';                                           // 08:00 in Edmonton
const fake = (iso) => { let t = Date.parse(iso); const c = createClock({ now: () => t }); c.set = (v) => { t = Date.parse(v); }; return c; };

async function world(clock = fake(WED_8AM), sizes = [3, 3]) {
  reset();
  const app = await createApp({ dataDir: dir(), config, modulesDir, clock });
  app.world.create();
  const ids = [];
  for (const [i, count] of sizes.entries()) {
    const cls = app.players.createClass({ name: `Block ${i + 1}`, course: 'fintech10' });
    for (const s of await app.players.createStudents({ classId: cls.id, count, hash: false })) {
      app.modules.onLogin({ id: s.id, username: s.username, class_id: cls.id }, 'fintech10');
      ids.push(s.id);
    }
  }
  const hold = app.db.prepare('INSERT INTO jobs_holdings (player_id, job_id, since_month) VALUES (?, 1, 1)');
  for (const id of ids) hold.run(id);
  return { app, clock, ids, n: (sql, ...a) => app.db.prepare(sql).get(...a).n };
}

test('one student whose per-player work throws: the advance commits, that student is skipped in that module only, once per month', async () => {
  const { app, ids, n } = await world();
  try {
    const bad = ids[2];
    control.bad = bad;
    const w = await quiet(() => app.world.advance({ months: 3 }));
    assert.equal(w.month, 4);
    // stub-flaky: everyone else got a row and a tip every month; the bad student's row and tip were rolled back with their savepoint
    for (const id of ids) assert.equal(n("SELECT COUNT(*) AS n FROM flaky_rows WHERE player_id = ? AND step = 'tip'", id), id === bad ? 0 : 3);
    const tips = (id) => n(`SELECT COUNT(*) AS n FROM entries e JOIN txns t ON t.id = e.txn_id WHERE t.kind = 'stub-flaky.tip' AND e.account_id = ?`, app.ledger.accountId('player', id, 'chequing'));
    assert.equal(tips(bad), 0);
    assert.equal(tips(ids[0]), 3);
    // every other module processed every student (the bad one too) in every month
    for (const table of ['jobs_paystubs', 'savings_snapshots', 'leaderboards_snapshots']) {
      assert.equal(n(`SELECT COUNT(*) AS n FROM ${table} WHERE month BETWEEN 2 AND 4`), ids.length * 3, table);
    }
    assert.equal(n("SELECT COUNT(DISTINCT player_id || '-' || due_month) AS n FROM bills_due WHERE due_month BETWEEN 2 AND 4"), ids.length * 2);   // billed from the month after the first pay
    // recorded once per month, for the bad student only, in the module that failed
    const f = app.db.prepare('SELECT month, module, player_id, error FROM tick_failures ORDER BY id').all();
    assert.deepEqual(f.map((r) => [r.month, r.module, r.player_id]), [[2, 'stub-flaky', bad], [3, 'stub-flaky', bad], [4, 'stub-flaky', bad]]);
    assert.match(f[0].error, /bad data for player/);
    assert.equal(app.ledger.audit().ok, true);
  } finally { app.db.close(); }
});

test('a module-wide throw still rolls back the whole advance', async () => {
  const { app, n } = await world();
  try {
    await quiet(() => app.world.advance({ months: 1 }));
    const before = { txns: n('SELECT COUNT(*) AS n FROM txns'), rows: n('SELECT COUNT(*) AS n FROM flaky_rows'), stubs: n('SELECT COUNT(*) AS n FROM jobs_paystubs') };
    control.wide = true;
    await quiet(() => assert.throws(() => app.world.advance({ months: 2 }), /module "stub-flaky": onTick failed: module-wide failure/));
    assert.equal(app.world.current().month, 2);
    assert.deepEqual({ txns: n('SELECT COUNT(*) AS n FROM txns'), rows: n('SELECT COUNT(*) AS n FROM flaky_rows'), stubs: n('SELECT COUNT(*) AS n FROM jobs_paystubs') }, before);
    assert.equal(n('SELECT COUNT(*) AS n FROM tick_failures'), 0);
    assert.equal(app.ledger.audit().ok, true);
  } finally { app.db.close(); }
});

test('a listener that throws inside the tick: its own writes roll back, the emitter carries on and keeps its writes, the failure is recorded', async () => {
  const { app, ids, n } = await world();
  try {
    await quiet(() => app.world.advance({ months: 1 }));                          // a listener that works: its row is kept
    assert.equal(n('SELECT COUNT(*) AS n FROM flaky_heard WHERE month = 2'), 1);
    control.listenerThrows = true;
    await quiet(() => app.world.advance({ months: 1 }));
    assert.equal(app.world.current().month, 3);
    assert.equal(n('SELECT COUNT(*) AS n FROM flaky_heard WHERE month = 3'), 0);      // the throwing listener's insert was rolled back
    assert.equal(n("SELECT COUNT(*) AS n FROM flaky_rows WHERE month = 3 AND step IN ('before-ping', 'after-ping')"), 2);
    assert.equal(n("SELECT COUNT(*) AS n FROM flaky_rows WHERE month = 3 AND step = 'tip'"), ids.length);
    const f = app.db.prepare('SELECT month, module, player_id, error FROM tick_failures').all();
    assert.deepEqual(f.map((r) => [r.month, r.module, r.player_id]), [[3, 'stub-flaky', ids[0]]]);
    assert.match(f[0].error, /^listener for module\.stub-flaky\.ping: listener broke$/);
    // outside a transaction a listener's throw is only logged, as before
    control.listenerThrows = true;
    await quiet(() => app.events.emit('module.stub-flaky.ping', { playerId: ids[0], month: 99 }));
    assert.equal(n('SELECT COUNT(*) AS n FROM tick_failures'), 1);
    assert.equal(n('SELECT COUNT(*) AS n FROM flaky_heard WHERE month = 99'), 1);   // autocommitted before the throw
  } finally { app.db.close(); }
});

test('auto-advance stops after a failed advance, and resumes after a manual advance or a saved setting', async () => {
  const { app, clock } = await world();
  try {
    app.world.setSettings({ auto_advance: 'school_days' });
    control.wide = true;
    await quiet(() => assert.throws(() => app.world.autoAdvance(), /module-wide failure/));
    assert.match(app.world.current().auto_stopped, /module "stub-flaky": onTick failed: module-wide failure/);
    assert.ok(app.db.prepare("SELECT 1 FROM audit_log WHERE action = 'world.auto_stopped'").get());
    control.wide = false;
    clock.set('2026-06-11T14:00:00Z');                                           // Thursday: no retry, even though it would work now
    assert.equal(app.world.autoAdvance(), null);
    assert.equal(app.world.current().month, 1);
    app.world.advance({});                                                       // the world teacher advances by hand: cleared
    assert.equal(app.world.current().auto_stopped, null);
    clock.set('2026-06-12T14:00:00Z');                                           // Friday: auto works again
    assert.equal(app.world.autoAdvance().month, 3);

    control.wide = true;                                                         // stop again, then acknowledge by saving the setting
    clock.set('2026-06-15T14:00:00Z');
    await quiet(() => assert.throws(() => app.world.autoAdvance()));
    control.wide = false;
    clock.set('2026-06-16T14:00:00Z');
    assert.equal(app.world.autoAdvance(), null);
    app.world.setSettings({ auto_advance: 'school_days' });
    assert.equal(app.world.current().auto_stopped, null);
    assert.equal(app.world.autoAdvance().month, 4);
  } finally { app.db.close(); }
});

test('over HTTP: the world teacher sees the problems; a 12-month advance sends the teacher one console hint, after commit', async () => {
  reset();
  const srv = await start({ port: 0, dataDir: dir(), openSetup: true, config, modulesDir, clock: fake(WED_8AM) });
  const call = (cookie) => async (method, p, body) => {
    const r = await fetch(`http://127.0.0.1:${srv.port}${p}`, { method, headers: { 'Content-Type': 'application/json', ...(cookie.v && { cookie: cookie.v }) }, body: body && JSON.stringify(body) });
    const set = r.headers.getSetCookie();
    if (set.length) cookie.v = set.map((c) => c.split(';')[0]).join('; ');
    return { status: r.status, json: await r.json() };
  };
  const jar = {};
  const t = call(jar);
  try {
    assert.equal((await t('POST', '/api/setup', { username: 'teacher', passphrase: 'correct horse battery' })).status, 200);
    const cls = (await t('POST', '/api/teach/classes', { name: 'Block 1', course: 'fintech10' })).json;
    const students = (await t('POST', `/api/teach/classes/${cls.id}/students`, { count: 3 })).json.students;
    const bad = srv.app.players.byUsername(students[1].username);
    control.bad = bad.id;
    const stream = await openStream({ base: `http://127.0.0.1:${srv.port}` }, { cookie: () => jar.v });
    await new Promise((r) => setTimeout(r, 100));
    const consoleHints = () => stream.events.filter((e) => e.event === 'console').length;
    const was = consoleHints();
    const adv = await quiet(() => t('POST', '/api/teach/world/advance', { months: 12 }));
    assert.equal(adv.status, 200);
    await new Promise((r) => setTimeout(r, 800));                                // past the 500 ms throttle
    assert.equal(consoleHints() - was, 1);

    // a failed advance sends no console hint
    control.wide = true;
    const failed = await quiet(() => t('POST', '/api/teach/world/advance', { months: 1 }));
    assert.equal(failed.status, 500);
    await new Promise((r) => setTimeout(r, 800));
    assert.equal(consoleHints() - was, 1);
    control.wide = false;

    const { problems } = (await t('GET', '/api/teach/state')).json;
    assert.equal(problems.auto_stopped, null);                                    // a manual-mode world: problems are listed, auto-advance is never touched
    assert.equal(problems.failures.length, 12);
    assert.deepEqual([problems.failures[0].module, problems.failures[0].username, problems.failures[0].month, problems.failures[0].source], ['stub-flaky', bad.username, 13, 'advance']);
    assert.match(problems.failures[0].error, /bad data for player/);
  } finally { reset(); await srv.close(); }
});

// The verifier's probe3/probe5: a bug that fails EVERY student's pay (a trigger on jobs_paystubs). More than half of a forEachPlayer
// list failing is a bug, so the advance rolls back as it did before per-player savepoints, and auto-advance stops.
const breakPayroll = (app) => app.db.exec("CREATE TRIGGER broken BEFORE INSERT ON jobs_paystubs BEGIN SELECT RAISE(ABORT, 'systemic bug'); END;");
const autopayAll = (app, ids) => { for (const id of ids) app.db.prepare('INSERT INTO bills_settings (player_id, autopay) VALUES (?, 1) ON CONFLICT (player_id) DO UPDATE SET autopay = 1').run(id); };

test('every student failing in one module rolls the advance back and stops auto-advance; nothing is half-done for the whole school', async () => {
  const { app, clock, n } = await world();
  try {
    app.world.setSettings({ auto_advance: 'school_days' });
    breakPayroll(app);
    await quiet(() => assert.throws(() => app.world.autoAdvance(), /jobs: 6 of 6 students failed in month 2, so nothing was skipped: systemic bug$/));
    assert.equal(app.world.current().month, 1);
    assert.match(app.world.current().auto_stopped, /6 of 6 students failed/);
    for (const day of ['2026-06-11', '2026-06-12', '2026-06-15', '2026-06-16']) { clock.set(`${day}T14:00:00Z`); assert.equal(app.world.autoAdvance(), null); }
    assert.equal(app.world.current().month, 1);
    assert.deepEqual([n('SELECT COUNT(*) AS n FROM jobs_paystubs'), n('SELECT COUNT(*) AS n FROM tick_failures'), n('SELECT COUNT(*) AS n FROM bills_due')], [0, 0, 0]);
  } finally { app.db.close(); }
});

test('probe5: after three good months, a payroll bug issues no late lines or fees (the advance rolls back)', async () => {
  const { app, clock, ids, n } = await world();
  try {
    autopayAll(app, ids);
    app.world.setSettings({ auto_advance: 'school_days' });
    for (const day of ['2026-06-10', '2026-06-11', '2026-06-12']) { clock.set(`${day}T14:00:00Z`); assert.ok(app.world.autoAdvance()); }
    assert.equal(app.world.current().auto_stopped, null);
    const before = [n('SELECT COUNT(*) AS n FROM bills_due WHERE late = 1'), n("SELECT COUNT(*) AS n FROM bills_due WHERE bill_id LIKE 'late-fee-%'"), n('SELECT COUNT(*) AS n FROM bills_due')];
    breakPayroll(app);
    for (const day of ['2026-06-15', '2026-06-16', '2026-06-17']) { clock.set(`${day}T14:00:00Z`); await quiet(() => { try { app.world.autoAdvance(); } catch { /* the first one throws */ } }); }
    assert.equal(app.world.current().month, 4);
    assert.deepEqual([n('SELECT COUNT(*) AS n FROM bills_due WHERE late = 1'), n("SELECT COUNT(*) AS n FROM bills_due WHERE bill_id LIKE 'late-fee-%'"), n('SELECT COUNT(*) AS n FROM bills_due')], before);
    assert.ok(app.world.current().auto_stopped);
  } finally { app.db.close(); }
});

test('an advance that skipped anyone stops auto-advance (manual or auto); an advance without problems restarts it', async () => {
  const { app, clock, ids } = await world();
  try {
    app.world.setSettings({ auto_advance: 'school_days' });
    control.bad = ids[0];
    assert.equal((await quiet(() => app.world.autoAdvance())).month, 2);            // committed: one student skipped in stub-flaky
    assert.equal(app.world.current().auto_stopped, 'the advance to month 2 skipped some work (1 problem listed below)');
    clock.set('2026-06-11T14:00:00Z');
    assert.equal(app.world.autoAdvance(), null);                                     // stopped until the teacher has looked
    await quiet(() => app.world.advance({}));                                        // a manual advance that skips someone: still stopped
    assert.match(app.world.current().auto_stopped, /^the advance to month 3 skipped some work/);
    control.bad = null;
    app.world.advance({});                                                           // a clean manual advance restarts it
    assert.equal(app.world.current().auto_stopped, null);
    clock.set('2026-06-12T14:00:00Z');
    assert.equal(app.world.autoAdvance().month, 5);
  } finally { app.db.close(); }
});

test('a listener whose transaction SQLite aborts (disk full) stops the emitter: the advance throws and nothing is auto-committed after it', async () => {
  const { app, n } = await world();
  try {
    await quiet(() => app.world.advance({ months: 1 }));
    const before = { rows: n('SELECT COUNT(*) AS n FROM flaky_rows'), txns: n('SELECT COUNT(*) AS n FROM txns') };
    control.beforeListen = () => {
      app.db.exec(`PRAGMA max_page_count = ${app.db.prepare('PRAGMA page_count').get().page_count + 3}`);
      app.db.prepare('INSERT INTO flaky_heard (player_id, month) VALUES (?, ?)').run(null, 'x'.repeat(4096 * 50));
    };
    await quiet(() => assert.throws(() => app.world.advance({ months: 1 }), /listener for module\.stub-flaky\.ping failed and the transaction was aborted/));
    app.db.exec('PRAGMA max_page_count = 1073741823');
    assert.equal(app.db.isTransaction, false);
    assert.equal(app.world.current().month, 2);
    assert.deepEqual({ rows: n('SELECT COUNT(*) AS n FROM flaky_rows'), txns: n('SELECT COUNT(*) AS n FROM txns') }, before);   // no 'after-ping' row slipped out
    assert.equal(app.ledger.audit().ok, true);
  } finally { app.db.exec('PRAGMA max_page_count = 1073741823'); app.db.close(); }
});

test("tick_failures.source: 'advance' inside an advance, 'request' for a listener failing inside a student's own action", async () => {
  const { app, ids } = await world();
  try {
    control.listenerThrows = true;
    await quiet(() => app.world.advance({ months: 1 }));
    await quiet(() => withTxn(app.db, () => app.events.emit('module.stub-flaky.ping', { playerId: ids[1], month: 2 })));   // as inside a payment
    assert.deepEqual(app.db.prepare('SELECT player_id, source FROM tick_failures ORDER BY id').all().map((r) => [r.player_id, r.source]), [[ids[0], 'advance'], [ids[1], 'request']]);
  } finally { app.db.close(); }
});

// Round 2 (verifier pG, pC, pD): the systemic rule counts distinct students per module per month, across loops and listeners.
test('pG: a listener that fails for every student (bills on module.jobs.paid) rolls the advance back', async () => {
  const { app, n } = await world();
  try {
    app.db.exec("CREATE TRIGGER broken BEFORE INSERT ON bills_pay BEGIN SELECT RAISE(ABORT, 'bills_pay listener bug'); END;");
    await quiet(() => assert.throws(() => app.world.advance({}), /bills: 6 of 6 students failed in month 2, so nothing was skipped: listener for module\.jobs\.paid: bills_pay listener bug$/));
    assert.equal(app.world.current().month, 1);
    assert.deepEqual([n('SELECT COUNT(*) AS n FROM jobs_paystubs'), n('SELECT COUNT(*) AS n FROM tick_failures')], [0, 0]);
  } finally { app.db.close(); }
});

test('pC: classes of one student each, a module broken for all of them: rolled back (and a one-student world rolls back on one failure)', async () => {
  const { app } = await world(undefined, [1, 1, 1, 1]);
  try {
    app.db.exec("CREATE TRIGGER broken BEFORE INSERT ON outfitters_facts BEGIN SELECT RAISE(ABORT, 'outfitters bug'); END; CREATE TRIGGER broken2 BEFORE UPDATE ON outfitters_facts BEGIN SELECT RAISE(ABORT, 'outfitters bug'); END;");
    await quiet(() => assert.throws(() => app.world.advance({}), /outfitters: 4 of 4 students failed in month 2, so nothing was skipped/));
    assert.equal(app.world.current().month, 1);
  } finally { app.db.close(); }
  const solo = await world(undefined, [1]);
  try {
    control.bad = solo.ids[0];
    await quiet(() => assert.throws(() => solo.app.world.advance({}), /stub-flaky: 1 of 1 students failed in month 2/));
    assert.equal(solo.app.world.current().month, 1);
  } finally { solo.app.db.close(); }
});

test('pD: one student whose two GICs fail is one student: skipped, the others mature, the advance commits', async () => {
  const { app, ids, n } = await world();
  try {
    await quiet(() => app.world.advance({ months: 3 }));
    const gic = app.modules.routes().find((r) => r.fullPath === '/api/savings/gic').handler;
    const buy = (id, cents) => gic({ user: { id, username: 'x', role: 'student', class_id: null }, body: { term_months: 12, cents }, params: {} });
    buy(ids[0], 10000); buy(ids[0], 20000); buy(ids[1], 10000);
    await quiet(() => app.world.advance({ months: 11 }));                          // month 15: they mature at 16
    app.db.exec(`CREATE TRIGGER broken BEFORE UPDATE OF matured_month ON savings_gics WHEN NEW.player_id = ${ids[0]} BEGIN SELECT RAISE(ABORT, 'gic bug'); END;`);
    await quiet(() => app.world.advance({ months: 1 }));
    assert.equal(app.world.current().month, 16);
    assert.equal(n('SELECT COUNT(*) AS n FROM savings_gics WHERE player_id = ? AND matured_month IS NOT NULL', ids[1]), 1);
    assert.equal(n('SELECT COUNT(*) AS n FROM savings_gics WHERE player_id = ? AND matured_month IS NULL', ids[0]), 2);   // retried at a later tick
    assert.deepEqual(app.db.prepare("SELECT DISTINCT module, player_id FROM tick_failures WHERE module = 'savings'").all().map((r) => [r.module, r.player_id]), [['savings', ids[0]]]);
    assert.equal(app.ledger.audit().ok, true);
  } finally { app.db.close(); }
});
