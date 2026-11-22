// options.jobs.autoPromote (docs/phase5-life.md 5b, "As built (5b deps)"): over a 48-year life only the first promotion of a career needs the teacher; later
// steps are granted when the eligible student applies with the reflection, logged, and listed for the teacher. Default off: today's behaviour.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { boot, seeded } from './helpers.js';

const config = (jobs) => { const c = JSON.parse(fs.readFileSync(new URL('../config/vdaa.json', import.meta.url), 'utf8')); (c.options.rates ??= {}).inflationBp = 0; if (jobs) c.options.jobs = jobs; else delete c.options.jobs; return { config: c }; };
const REFLECTION = 'I can run the till alone and I help train new cashiers.';

async function world(jobs) {
  const srv = await boot(config(jobs));
  const t = await seeded(srv, 3, { transfers: false });
  const adv = (n) => srv.app.world.advance({ months: n });
  const promo = async (s) => (await s.client.get('/api/jobs/catalogue')).json.promotion;
  const classOf = async (who) => (await who.get('/api/jobs/overview')).json.classes.find((c) => c.id === t.cls.id);
  // the world teacher approves s's waiting application
  const approve = async (s) => { const a = (await classOf(t.teacher)).applications.find((x) => x.player_id === s.id); assert.equal((await t.teacher.post('/api/jobs/decide', { id: a.id, approve: true })).status, 200); };
  return { srv, app: srv.app, ...t, adv, promo, classOf, approve };
}

test('autoPromote off (the default): every step still waits for the teacher, and approved promotions are listed as approved by a teacher', async () => {
  const w = await world();
  try {
    const [s] = w.students;
    await s.client.post('/api/jobs/pick', { job_id: 1 });                                  // cashier: Retail supervisor, then Store manager
    w.adv(12);
    assert.deepEqual((await s.client.post('/api/jobs/apply', { reflection: REFLECTION })).json, { ok: true, promoted: false });
    await w.approve(s);
    w.adv(12);
    assert.equal((await w.promo(s)).auto, false);
    assert.deepEqual((await s.client.post('/api/jobs/apply', { reflection: REFLECTION })).json, { ok: true, promoted: false });
    const c = await w.classOf(w.teacher);
    assert.equal(c.applications.length, 1, 'the second step waits too');
    assert.deepEqual(c.promotions.map((p) => [p.username, p.from, p.to, p.auto]), [[s.username, 'Cashier', 'Retail supervisor', false]]);
    assert.equal((await w.teacher.get('/api/jobs/overview')).json.auto_promote, false);
  } finally { await w.srv.cleanup(); }
});

test('autoPromote on: the first promotion needs the teacher (and a denial still cools off); later steps are granted at once, logged, listed; teacher B sees none of it', async () => {
  const w = await world({ autoPromote: true });
  try {
    const [s, e] = w.students;
    await s.client.post('/api/jobs/pick', { job_id: 1 });                                  // cashier (2 steps)
    await e.client.post('/api/jobs/pick', { job_id: 8 });                                  // apprentice electrician (3 steps)
    w.adv(12);                                                                             // month 13: both eligible for their first promotion
    assert.equal((await w.promo(s)).auto, false);
    assert.deepEqual((await s.client.post('/api/jobs/apply', { reflection: REFLECTION })).json, { ok: true, promoted: false }, 'the first promotion of a career waits');
    assert.equal((await e.client.post('/api/jobs/apply', { reflection: 'I passed my first period exams.' })).status, 200);
    const pending = (await w.classOf(w.teacher)).applications;
    assert.equal(pending.length, 2);
    await w.approve(s);
    assert.equal((await w.teacher.post('/api/jobs/decide', { id: pending.find((a) => a.player_id === e.id).id, approve: false })).status, 200);
    assert.equal((await w.promo(e)).eligible_month, 16, 'a denied first promotion keeps its cool-off');

    // s is now on step 1: the next step is automatic. A denial on this step from before the option was turned on does not hold it back.
    const sw = w.app.world.current().month;
    w.app.db.prepare("INSERT INTO jobs_applications (player_id, job_id, from_step, month, reflection, status, decided_month) VALUES (?, 1, 1, ?, 'old', 'denied', ?)").run(s.id, sw + 11, sw + 11);
    w.adv(11);                                                                             // month 24: 11 months in the step
    let p = await w.promo(s);
    assert.deepEqual([p.auto, p.can_apply, p.eligible_month], [true, false, 25]);
    assert.equal((await s.client.post('/api/jobs/apply', { reflection: REFLECTION })).status, 409, 'still 12 months in the step');
    w.adv(1);                                                                              // month 25
    p = await w.promo(s);
    assert.deepEqual([p.auto, p.can_apply], [true, true], 'the old denial is irrelevant');
    assert.equal((await s.client.post('/api/jobs/apply', { reflection: 'short' })).status, 400, 'the reflection is still required');
    assert.deepEqual((await s.client.post('/api/jobs/apply', { reflection: REFLECTION })).json, { ok: true, promoted: true, title: 'Store manager' });
    const cur = (await s.client.get('/api/jobs/catalogue')).json;
    assert.deepEqual([cur.current.step, cur.current.title, cur.promotion.next, cur.promotion.pending], [2, 'Store manager', null, null]);
    const row = w.app.db.prepare("SELECT status, auto, decided_month FROM jobs_applications WHERE player_id = ? AND from_step = 1 AND status <> 'denied'").get(s.id);
    assert.deepEqual({ ...row }, { status: 'approved', auto: 1, decided_month: 25 });
    assert.equal(w.app.db.prepare("SELECT COUNT(*) AS n FROM audit_log WHERE action = 'jobs.auto_promote' AND actor = ?").get(`player:${s.id}`).n, 1);
    const c = await w.classOf(w.teacher);
    assert.equal(c.applications.length, 0, 'nothing waits for the teacher');
    assert.deepEqual(c.promotions.map((x) => [x.username, x.from, x.to, x.auto, x.month]), [[s.username, 'Retail supervisor', 'Store manager', true, 25], [s.username, 'Cashier', 'Retail supervisor', false, 13]]);
    assert.equal((await w.teacher.get('/api/jobs/overview')).json.auto_promote, true);
    w.adv(1);
    const stubs = (await s.client.get('/api/jobs/stubs')).json.stubs;
    const stub = (await s.client.get(`/api/jobs/stubs/${stubs[0].id}`)).json;
    assert.deepEqual([stub.month, stub.job.title, stub.job.step], [26, 'Store manager', 2]);
    assert.match(stub.note, /Promotion: you are now Store manager/);

    // teacher B (not this class's teacher) sees neither the class nor its promotions
    const invite = (await w.teacher.post('/api/teach/invites')).json;
    const b = w.srv.client();
    assert.equal((await b.post('/api/teach/join', { token: new URL(invite.url).searchParams.get('invite'), username: 'teacherB', passphrase: 'another long passphrase' })).status, 200);
    const ob = (await b.get('/api/jobs/overview')).json;
    assert.deepEqual(ob.classes, []);
    assert.equal(w.app.ledger.audit().ok, true);
  } finally { await w.srv.cleanup(); }
});

test('autoPromote on, bots: the sim applies once per eligible step and an automatic step is never decided (or promoted) twice', async () => {
  const w = await world({ autoPromote: true });
  try {
    const [s] = w.students;
    await s.client.post('/api/jobs/pick', { job_id: 8 });
    w.app.db.prepare('UPDATE jobs_holdings SET step = 1, step_since = 1 WHERE player_id = ?').run(s.id);   // past the first promotion
    w.adv(12);
    w.app.modules.simulate({ month: w.app.world.current().month, students: [{ id: s.id, class_id: w.cls.id, course_id: 'fintech10' }] });
    const h = w.app.db.prepare('SELECT step FROM jobs_holdings WHERE player_id = ?').get(s.id);
    assert.equal(h.step, 2, 'one step, not two');
    assert.deepEqual(w.app.db.prepare('SELECT status, auto FROM jobs_applications WHERE player_id = ?').all(s.id).map((r) => ({ ...r })), [{ status: 'approved', auto: 1 }]);
  } finally { await w.srv.cleanup(); }
});
