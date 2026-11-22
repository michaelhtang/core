import test from 'node:test';
import assert from 'node:assert/strict';
import { boot, seeded, bareApp } from './helpers.js';
import { runSim } from '../scripts/sim.mjs';
import { CATALOGUE, PATHS } from '../modules/jobs/catalogue.js';
import { readFileSync } from 'node:fs';

// These two tests check the promotion wages themselves, so they run with no inflation (the index scaling has its own tests in test/inflation.test.js).
const noInflation = () => { const c = JSON.parse(readFileSync(new URL('../config/vdaa.json', import.meta.url), 'utf8')); (c.options.rates ??= {}).inflationBp = 0; return { config: c }; };

test('promotion paths: every job has 1 to 3 steps, each with an ALIS url, a source note and a wage above the step before it; the migration seeded the same rows', async () => {
  assert.ok(PATHS.length >= 12);
  for (const job of CATALOGUE) {
    const steps = PATHS.filter((p) => p.job_id === job.id);
    assert.ok(steps.length >= 1 && steps.length <= 3, job.title);
    let before = job.hourly_cents;
    steps.forEach((s, i) => {
      assert.equal(s.step, i + 1, job.title);
      assert.ok(s.hourly_cents > before, `${job.title}: ${s.title} must pay more than the step before`);
      assert.ok(s.hours_per_month >= 80 && s.hours_per_month <= 160);
      assert.match(s.alis_url, /^https:\/\/alis\.alberta\.ca\/occinfo\/(occupations-in-alberta\/occupation-profiles|wages-and-salaries-in-alberta)\/[a-z0-9-]+\/(\d+\/)?$/);
      assert.ok(s.note.length > 10);
      before = s.hourly_cents;
    });
  }
  const electrician = PATHS.filter((p) => p.job_id === 8).map((p) => p.hourly_cents);
  assert.deepEqual(electrician, [2015, 2351, 2686]);                                  // 60%, 70%, 80% of $33.58
  const { app, cleanup } = await bareApp();
  assert.deepEqual(app.db.prepare('SELECT job_id, step, title, hourly_cents, hours_per_month, alis_url, note, checked FROM jobs_steps ORDER BY job_id, step').all().map((r) => ({ ...r })), PATHS.map((p) => ({ ...p })));
  cleanup();
});

test('raises: +3% after 12 months in the job, again after 12 more (compounding), each student on their own clock, stub says so once, audit clean', async () => {
  const { app, cls, cleanup } = await bareApp();
  try {
    const [a, b] = await app.players.createStudents({ classId: cls.id, count: 2, hash: false });
    for (const s of [a, b]) app.modules.onLogin({ id: s.id, username: s.username, class_id: cls.id }, 'fintech10');
    app.db.prepare('INSERT INTO jobs_holdings (player_id, job_id, since_month) VALUES (?, 1, 1)').run(a.id);   // cashier $15.28
    app.world.advance({ months: 6 });                                                                         // month 7
    app.db.prepare('INSERT INTO jobs_holdings (player_id, job_id, since_month) VALUES (?, 1, 7)').run(b.id);  // b starts later
    app.world.advance({ months: 12 }); app.world.advance({ months: 8 });                                                                      // month 27
    const stubs = (id) => app.db.prepare('SELECT month, hourly_cents, gross, note FROM jobs_paystubs WHERE player_id = ? ORDER BY month').all(id);
    const sa = stubs(a.id);
    const w1 = Math.round(1528 * 1.03), w2 = Math.round(w1 * 1.03);
    // a took the job in month 1, so pays run from month 2: twelve pays at the starting wage (months 2-13), the raise with the 13th pay (month 14)
    assert.deepEqual([...new Set(sa.filter((s) => s.month < 14).map((s) => s.hourly_cents))], [1528]);
    assert.equal(sa.filter((s) => s.month < 14).length, 12);
    assert.equal(sa.find((s) => s.month === 14).hourly_cents, w1);                                           // first raise on the 13th pay
    assert.match(sa.find((s) => s.month === 14).note, /Annual raise of 3%/);
    assert.equal(sa.find((s) => s.month === 15).note, '');                                                    // the note shows once
    assert.equal(sa.find((s) => s.month === 25).hourly_cents, w1);
    assert.equal(sa.find((s) => s.month === 26).hourly_cents, w2);                                            // compounding, 12 months after the first raise
    assert.equal(sa.find((s) => s.month === 14).gross, w1 * 118);
    const sb = stubs(b.id);
    assert.equal(sb.find((s) => s.month === 20).hourly_cents, w1);                                           // b's 13th pay: job in month 7, pays from 8
    assert.equal(sb.find((s) => s.month === 19).hourly_cents, 1528);
    assert.equal(app.ledger.audit().ok, true);
  } finally { cleanup(); }
});

test('promotion over HTTP: too early is refused, apply with a reflection, teacher approves, the new title and wage start at the next payday, with a promotion note', async () => {
  const srv = await boot(noInflation());
  try {
    const { teacher, cls, students: [s1, s2, s3] } = await seeded(srv, 3, { transfers: false });
    const adv = (n) => srv.app.world.advance({ months: n });
    await s1.client.post('/api/jobs/pick', { job_id: 1 });                                                  // cashier
    await s2.client.post('/api/jobs/pick', { job_id: 8 });                                                  // apprentice electrician
    const cat = (await s1.client.get('/api/jobs/catalogue')).json;
    assert.deepEqual(cat.path.map((p) => p.title), ['Cashier', 'Retail supervisor', 'Store manager']);
    assert.equal(cat.promotion.eligible_month, 13);
    assert.equal(cat.promotion.can_apply, false);
    assert.equal((await s1.client.post('/api/jobs/apply', { reflection: 'I am ready for more.' })).status, 409);   // too early
    assert.equal((await s3.client.post('/api/jobs/apply', { reflection: 'I am ready for more.' })).status, 409);   // no job
    adv(12);                                                                                                // month 13
    assert.equal((await s1.client.get('/api/jobs/catalogue')).json.promotion.can_apply, true);
    assert.equal((await s1.client.post('/api/jobs/apply', { reflection: 'short' })).status, 400);
    assert.equal((await s1.client.post('/api/jobs/apply', { reflection: 'I can run the till alone and I help train new cashiers.' })).status, 200);
    assert.equal((await s1.client.post('/api/jobs/apply', { reflection: 'I can run the till alone and I help train new cashiers.' })).status, 409);   // already waiting
    assert.equal((await s1.client.post('/api/jobs/decide', { id: 1, approve: true })).status, 403);         // students cannot decide

    const ov = (await teacher.get('/api/jobs/overview')).json;
    const c = ov.classes.find((x) => x.id === cls.id);
    assert.equal(c.applications.length, 1);
    assert.deepEqual([c.applications[0].username, c.applications[0].from, c.applications[0].to], [s1.username, 'Cashier', 'Retail supervisor']);
    assert.match(c.applications[0].reflection, /till alone/);
    const row = c.students.find((s) => s.id === s1.id);
    assert.deepEqual([row.step, row.title, row.next, row.pending], [0, 'Cashier', 'Retail supervisor', true]);

    assert.equal((await teacher.post('/api/jobs/decide', { id: c.applications[0].id, approve: true })).status, 200);
    assert.equal((await teacher.post('/api/jobs/decide', { id: c.applications[0].id, approve: true })).status, 404);   // decided once
    adv(1);                                                                                                 // month 14: first pay as a supervisor
    const stubs = (await s1.client.get('/api/jobs/stubs')).json.stubs;
    const stub = (await s1.client.get(`/api/jobs/stubs/${stubs[0].id}`)).json;
    assert.equal(stub.month, 14);
    assert.equal(stub.job.title, 'Retail supervisor');
    assert.equal(stub.job.step, 1);
    assert.equal(stub.job.hourly_cents, 1912);
    assert.equal(stub.job.hours, 151);
    assert.match(stub.note, /Promotion: you are now Retail supervisor/);
    const old = (await s1.client.get(`/api/jobs/stubs/${stubs[1].id}`)).json;                                // the stub before it keeps its own title and wage
    assert.deepEqual([old.job.title, old.job.hourly_cents, old.note.includes('Annual raise')], ['Cashier', 1528, false]);   // the 12th pay: still the starting wage
    adv(1);
    assert.equal((await s1.client.get(`/api/jobs/stubs/${(await s1.client.get('/api/jobs/stubs')).json.stubs[0].id}`)).json.note, '');
    assert.equal((await s1.client.get('/api/jobs/catalogue')).json.promotion.eligible_month, 25);   // 12 months after the promotion (month 13)

    // deny: a cool-off of 3 months before the next application; teacher override grants a promotion and a raise at any time
    adv(10);                                                                                                // month 25... the electrician (job 8) has been at step 0 since month 1
    assert.equal((await s2.client.post('/api/jobs/apply', { reflection: 'I passed my first period exams.' })).status, 200);
    const app2 = (await teacher.get('/api/jobs/overview')).json.classes[0].applications[0];
    assert.equal((await teacher.post('/api/jobs/decide', { id: app2.id, approve: false })).status, 200);
    const e = (await s2.client.get('/api/jobs/catalogue')).json.promotion;
    assert.equal(e.can_apply, false);
    assert.equal(e.eligible_month, 25 + 3);
    assert.equal((await teacher.post('/api/jobs/promote', { player_id: s2.id })).status, 200);              // override ignores the clock
    assert.equal((await teacher.post('/api/jobs/promote', { player_id: s2.id })).status, 200);
    assert.equal((await teacher.post('/api/jobs/promote', { player_id: s2.id })).status, 200);
    assert.equal((await teacher.post('/api/jobs/promote', { player_id: s2.id })).status, 409);              // top of the path
    assert.equal((await teacher.post('/api/jobs/promote', { player_id: s3.id })).status, 409);              // no job
    assert.equal((await teacher.post('/api/jobs/raise', { player_id: s2.id })).status, 200);
    adv(1);
    const sb = (await s2.client.get('/api/jobs/stubs')).json.stubs[0];
    const st2 = (await s2.client.get(`/api/jobs/stubs/${sb.id}`)).json;
    assert.deepEqual([st2.job.title, st2.job.hourly_cents], ['Apprentice electrician (4th period)', Math.round(2686 * 1.03)]);
    assert.match(st2.note, /Promotion/);
    assert.match(st2.note, /Raise from your teacher/);
    assert.equal(srv.app.ledger.audit().ok, true);
  } finally { await srv.cleanup(); }
});

test('switching or quitting a job drops its pending application and its raises; a promoted student never loses a raise they already earned', async () => {
  const srv = await boot(noInflation());
  try {
    const { teacher, students: [s1] } = await seeded(srv, 1, { transfers: false });
    srv.app.world.advance({ months: 1 });
    await s1.client.post('/api/jobs/pick', { job_id: 1 });
    srv.app.world.advance({ months: 12 });
    await s1.client.post('/api/jobs/apply', { reflection: 'I help train new cashiers every week.' });
    const id = (await teacher.get('/api/jobs/overview')).json.classes[0].applications[0].id;
    await s1.client.post('/api/jobs/pick', { job_id: 2 });                                                  // switch: the application is void
    assert.equal((await teacher.post('/api/jobs/decide', { id, approve: true })).status, 404);
    assert.equal((await s1.client.get('/api/jobs/catalogue')).json.current.step, 0);
    await teacher.post('/api/jobs/assign', { player_id: s1.id, job_id: 2 });                                // same job again: nothing is wiped
    srv.app.world.advance({ months: 12 }); srv.app.world.advance({ months: 1 });                            // the 13th pay in this job carries the raise: 1687 -> 1738
    await teacher.post('/api/jobs/assign', { player_id: s1.id, job_id: 2 });
    assert.equal((await s1.client.get('/api/jobs/catalogue')).json.current.hourly_cents, 1738);
    await teacher.post('/api/jobs/promote', { player_id: s1.id });                                          // Cook pays $18.62 > 1738
    assert.equal((await s1.client.get('/api/jobs/catalogue')).json.current.hourly_cents, 1862);
    await teacher.post('/api/jobs/raise', { player_id: s1.id });
    await teacher.post('/api/jobs/promote', { player_id: s1.id });                                          // Chef $22.06 > 1918
    assert.equal((await s1.client.get('/api/jobs/catalogue')).json.current.title, 'Chef');
  } finally { await srv.cleanup(); }
});

test('season close: the next season starts everyone on the catalogue entry wage, step 0, no pending application; the job is kept', async () => {
  const { app, cls, cleanup } = await bareApp();
  try {
    const [a] = await app.players.createStudents({ classId: cls.id, count: 1, hash: false });
    app.modules.onLogin({ id: a.id, username: a.username, class_id: cls.id }, 'fintech10');
    app.db.prepare('INSERT INTO jobs_holdings (player_id, job_id, since_month) VALUES (?, 1, 1)').run(a.id);
    app.world.advance({ months: 12 }); app.world.advance({ months: 2 });
    app.db.prepare("INSERT INTO jobs_applications (player_id, job_id, from_step, month, reflection) VALUES (?, 1, 0, 14, 'Ready for more responsibility.')").run(a.id);
    app.db.prepare('UPDATE jobs_holdings SET step = 1, wage_cents = 2100, step_since = 14, raise_since = 14, note = ? WHERE player_id = ?').run('x', a.id);
    app.world.close({ actor: 'test' });
    const h = app.db.prepare('SELECT * FROM jobs_holdings WHERE player_id = ?').get(a.id);
    assert.deepEqual([h.job_id, h.step, h.wage_cents, h.step_since, h.raise_since, h.since_month, h.note], [1, 0, null, null, null, 1, '']);
    assert.equal(app.db.prepare("SELECT COUNT(*) AS n FROM jobs_applications WHERE status = 'pending'").get().n, 0);
    app.world.create({ name: 'Season 2' });
    app.world.advance({ months: 1 });
    const s = app.db.prepare('SELECT hourly_cents, title, month FROM jobs_paystubs WHERE player_id = ? ORDER BY id DESC LIMIT 1').get(a.id);
    assert.deepEqual([s.hourly_cents, s.title, s.month], [1528, 'Cashier', 2]);                             // entry wage, no raise carried over
    assert.equal(app.ledger.audit().ok, true);
  } finally { cleanup(); }
});

test('sim: bots are promoted (about 70% of applications approved), pay grows by raises and steps, audit clean', async () => {
  const rows = await runSim({ bots: 60, classes: 4, months: 40 });
  assert.ok(rows.every((r) => r.auditOk));
  assert.ok(rows[36].medGross > rows[3].medGross * 1.1, `median gross month 37 ${rows[36].medGross} vs month 4 ${rows[3].medGross}`);
});
