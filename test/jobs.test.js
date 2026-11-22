import test from 'node:test';
import assert from 'node:assert/strict';
import { boot, seeded, bareApp } from './helpers.js';
import { runSim } from '../scripts/sim.mjs';
import { payStub } from '../modules/jobs/payroll.js';
import { CATALOGUE } from '../modules/jobs/catalogue.js';

test('catalogue: twelve jobs, each at or above $15.00/h, 80 to 160 hours, with an ALIS url and a check date; the migration seeded the same rows', async () => {
  assert.equal(CATALOGUE.length, 12);
  for (const c of CATALOGUE) {
    assert.ok(c.hourly_cents >= 1500, c.title);
    assert.ok(c.hours_per_month >= 80 && c.hours_per_month <= 160, c.title);
    assert.match(c.alis_url, /^https:\/\/alis\.alberta\.ca\/occinfo\/occupations-in-alberta\/occupation-profiles\/[a-z-]+\/$/);
    assert.match(c.checked, /^\d{4}-\d{2}-\d{2}$/);
  }
  const { app, cleanup } = await bareApp();
  const rows = app.db.prepare('SELECT * FROM jobs_catalogue ORDER BY id').all();
  assert.deepEqual(rows.map(({ active, ...r }) => ({ ...r })), CATALOGUE.map((c) => ({ ...c })));   // active: the boot upsert's retire flag
  cleanup();
});

test('payday: one pay txn per student per month (mint, chequing, sink; legs sum to zero), idempotent, YTD resets in a new year, audit clean', async () => {
  const { app, cls, cleanup } = await bareApp();
  try {
    const [a, b] = await app.players.createStudents({ classId: cls.id, count: 2, hash: false });
    for (const s of [a, b]) app.modules.onLogin({ id: s.id, username: s.username, class_id: cls.id }, 'fintech10');
    app.db.prepare('INSERT INTO jobs_holdings (player_id, job_id, since_month) VALUES (?, 4, 1)').run(a.id);   // retail associate: $17.06 x 132 h; b has no job
    const chq = (id) => app.ledger.balance(app.ledger.accountId('player', id, 'chequing'));
    const gross = 1706 * 132;

    app.world.advance({ months: 1 });                                                                    // month 2
    const s1 = payStub({ grossCents: gross, period: 2 });
    assert.equal(chq(a.id), 50000 + s1.net);
    assert.equal(chq(b.id), 50000);
    const stubs = app.db.prepare('SELECT * FROM jobs_paystubs').all();
    assert.equal(stubs.length, 1);
    assert.equal(stubs[0].net, s1.net);
    const legs = app.db.prepare('SELECT e.amount_cents, a.owner_type, a.kind FROM entries e JOIN accounts a ON a.id = e.account_id WHERE e.txn_id = ?').all(stubs[0].txn_id);
    assert.equal(legs.length, 3);
    assert.equal(legs.reduce((s, l) => s + l.amount_cents, 0), 0);
    assert.equal(legs.find((l) => l.owner_type === 'system' && l.amount_cents < 0).amount_cents, -gross);   // mint pays the gross
    assert.equal(legs.find((l) => l.owner_type === 'system' && l.amount_cents > 0).amount_cents, gross - s1.net);   // sink takes the deductions
    assert.equal(app.db.prepare("SELECT kind FROM txns WHERE id = ?").get(stubs[0].txn_id).kind, 'jobs.pay');

    app.db.prepare('UPDATE worlds SET month = month - 1').run();                                         // run month 2's payday again: nothing happens
    app.world.advance({ months: 1 });
    assert.equal(app.db.prepare('SELECT COUNT(*) AS n FROM jobs_paystubs').get().n, 1);
    assert.equal(chq(a.id), 50000 + s1.net);

    app.world.advance({ months: 11 });                                                                   // months 3..13: month 13 is period 1 of year 2
    const all = app.db.prepare('SELECT * FROM jobs_paystubs WHERE player_id = ? ORDER BY month').all(a.id);
    assert.deepEqual(all.map((s) => s.month), [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13]);
    const last = JSON.parse(all.at(-1).ytd_json);
    assert.equal(last.gross, gross);                                                                     // year 2 starts again from zero; month 13 is the 12th pay, still at the starting wage
    assert.equal(JSON.parse(all[10].ytd_json).gross, 11 * gross);                                        // eleven stubs in year 1
    assert.equal(app.ledger.audit().ok, true);
  } finally { cleanup(); }
});

test('jobs over HTTP: pick, pay stub components, privacy, quit, teacher assign and catalogue toggle', async () => {
  const srv = await boot();
  try {
    const { teacher, cls, students: [s1, s2] } = await seeded(srv, 2, { transfers: false });
    const cat = (await s1.client.get('/api/jobs/catalogue')).json;
    assert.equal(cat.jobs.length, 12);
    assert.equal(cat.mine, null);
    assert.equal((await s1.client.post('/api/jobs/pick', { job_id: 99 })).status, 404);
    assert.equal((await s1.client.post('/api/jobs/pick', { job_id: 'x' })).status, 400);
    assert.equal((await s1.client.post('/api/jobs/pick', { job_id: 2 })).status, 200);                    // line cook: $16.87 x 136 h
    assert.equal((await s1.client.get('/api/jobs/catalogue')).json.mine.job_id, 2);
    assert.equal((await teacher.get('/api/jobs/catalogue')).status, 403);                                 // student route

    const state = (await teacher.get('/api/teach/state')).json;
    assert.equal((await teacher.post('/api/teach/world/advance', { from: state.world.month })).status, 200);
    const gross = 1687 * 136, want = payStub({ grossCents: gross, period: 2 });
    const list = (await s1.client.get('/api/jobs/stubs')).json.stubs;
    assert.equal(list.length, 1);
    const stub = (await s1.client.get(`/api/jobs/stubs/${list[0].id}`)).json;
    assert.deepEqual([stub.gross, stub.cpp, stub.cpp2, stub.ei, stub.federal_tax, stub.alberta_tax, stub.net],
      [want.gross, want.cpp, want.cpp2, want.ei, want.federalTax, want.albertaTax, want.net]);
    assert.equal(stub.deductions, want.gross - want.net);
    assert.equal(stub.job.employer, 'Maple Street Grill');
    assert.equal(stub.employee, s1.username);
    assert.deepEqual(stub.ytd, want.ytd);
    // + any Today errand cash ("Pick a job", paid by this same /api/me, whose balances are read after the cards)
    const me1 = (await s1.client.get('/api/me')).json;
    const todayCash = srv.app.db.prepare("SELECT COALESCE(SUM(e.amount_cents), 0) AS n FROM entries e JOIN txns t ON t.id = e.txn_id WHERE e.account_id = ? AND t.kind LIKE 'today.%'").get(s1.chequing.id).n;
    assert.equal(me1.accounts.find((a) => a.kind === 'chequing').balance_cents, 50000 + want.net + todayCash);
    assert.equal((await s2.client.get(`/api/jobs/stubs/${list[0].id}`)).status, 404);                     // someone else's stub
    assert.equal((await s2.client.get('/api/jobs/stubs')).json.stubs.length, 0);                          // s2 has no job: no stub

    // teacher: overview, assign, remove, and the class's board
    const ov = (await teacher.get('/api/jobs/overview')).json;
    const row = ov.classes.find((c) => c.id === cls.id).students.find((s) => s.id === s1.id);
    assert.deepEqual([row.job_id, row.last_net, row.last_month], [2, want.net, 2]);
    assert.equal((await teacher.post('/api/jobs/assign', { player_id: s2.id, job_id: 1 })).status, 200);
    assert.equal((await s2.client.get('/api/jobs/catalogue')).json.mine.job_id, 1);
    assert.equal((await teacher.post('/api/jobs/assign', { player_id: s2.id, job_id: null })).status, 200);
    assert.equal((await s2.client.get('/api/jobs/catalogue')).json.mine, null);
    assert.equal((await teacher.post('/api/jobs/catalogue', { class_id: cls.id, job_id: 3, enabled: false })).status, 200);
    assert.equal((await s2.client.get('/api/jobs/catalogue')).json.jobs.length, 11);
    assert.equal((await s2.client.post('/api/jobs/pick', { job_id: 3 })).status, 404);
    assert.equal((await s1.client.post('/api/jobs/quit', {})).status, 200);
    assert.equal((await s1.client.get('/api/jobs/catalogue')).json.mine, null);
    assert.equal((await s1.client.post('/api/jobs/assign', { player_id: s2.id, job_id: 1 })).status, 403);   // students cannot assign
    assert.equal(srv.app.ledger.audit().ok, true);
  } finally { await srv.cleanup(); }
});

test('sim with jobs on: bots take jobs, supply grows by the gross paid, audit stays clean', async () => {
  const rows = await runSim({ bots: 60, classes: 4, months: 6 });
  assert.ok(rows.every((r) => r.auditOk));
  assert.ok(rows.at(-1).supply > rows[0].supply);
  assert.ok(rows.at(-1).median > rows[0].median);
});
