// life (docs/phase5-life.md 5b): age and stage, the pace plan and the stage-paced clock, retirement (work stops), stage events (with fakes for the
// other modules' services), the Life Review snapshots, the teacher panel's permissions, and life switched off.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createApp, ROOT } from '../lib/app.js';
import { createClock } from '../lib/clock.js';
import { boot, seeded, tmpDir } from './helpers.js';
import { ageAt, stageOf, endMonth, checkPlan, paceTable, DEFAULT_PLAN, monthOfAge } from '../modules/life/stages.js';

const CONFIG = JSON.parse(fs.readFileSync(new URL('../config/vdaa.json', import.meta.url), 'utf8'));
const PASS = 'another long passphrase';
const made = [];
after(() => { for (const d of made) fs.rmSync(d, { recursive: true, force: true }); });

// A bare app on a hand-set clock (Mon 2026-11-02, 08:00 in Edmonton) with one fintech10 class of n students, each logged in once.
async function world({ n = 1, config = CONFIG, modulesDir, course = 'fintech10' } = {}) {
  const dataDir = tmpDir();
  made.push(dataDir);
  let t = Date.parse('2026-11-02T15:00:00Z');
  const app = await createApp({ dataDir, config, clock: createClock({ now: () => t }), ...(modulesDir && { modulesDir }) });
  app.world.create();
  const cls = app.players.createClass({ name: 'Block 1', course });
  const ids = await app.players.createStudents({ classId: cls.id, count: n, hash: false });
  for (const s of ids) app.modules.onLogin({ ...s, class_id: cls.id }, course);
  const users = ids.map((s) => ({ id: s.id, username: s.username, role: 'student', class_id: cls.id }));
  const handler = (mod, method, p) => app.modules.routes().find((r) => r.module === mod && r.method === method && r.path === p).handler;
  const get = (mod, p, user, url = 'http://t/') => handler(mod, 'GET', p)({ user, body: {}, params: {}, url: new URL(url) });
  const post = (mod, p, body, user) => handler(mod, 'POST', p)({ user, body, params: {}, url: new URL('http://t/') });
  const advance = (months) => { t += 60_000; return app.world.advance(months === undefined ? {} : { months }); };
  const jumpTo = (month) => app.db.prepare('UPDATE worlds SET month = ? WHERE id = ?').run(month, app.world.current().id);   // skip ahead without ticks
  const settings = () => app.db.prepare("SELECT actor, detail FROM audit_log WHERE action = 'world.settings' ORDER BY id").all().map((r) => ({ actor: r.actor, ...JSON.parse(r.detail) }));
  return { app, cls, users, get, post, advance, jumpTo, settings, setNow: (iso) => { t = Date.parse(iso); }, close: () => app.db.close() };
}

// A modules folder with the real bank-basic and life, plus fake exchange / rates / housing services that record their calls (the other editor's
// stageEvent, queueRate, marketEvent and allocation are not on main yet).
function withFakes() {
  const d = tmpDir();
  made.push(d);
  for (const id of ['bank-basic', 'life']) fs.symlinkSync(path.join(ROOT, 'modules', id), path.join(d, id));
  const lib = pathToFileURL(path.join(ROOT, 'lib', 'modules.js')).href;
  const fake = (id, services) => {
    fs.mkdirSync(path.join(d, id));
    fs.writeFileSync(path.join(d, id, 'index.js'), `import { defineModule } from '${lib}';\nexport default defineModule({ id: '${id}', services: { ${services} } });\n`);
  };
  fake('exchange', `stageEvent(k, args) { (globalThis.lifeCalls ??= []).push(['exchange.stageEvent', args, k.world.current().month]); return { ok: true }; },
    allocation(k, { playerId }) { return { stocks: 6000, bonds: 4000, playerId }; }`);
  fake('rates', `queueRate(k, args) { (globalThis.lifeCalls ??= []).push(['rates.queueRate', args, k.world.current().month]); return { ok: true }; }`);
  fake('housing', `marketEvent(k, args) { (globalThis.lifeCalls ??= []).push(['housing.marketEvent', args, k.world.current().month]); return { ok: true }; }`);
  return d;
}
const fakeConfig = (options = {}) => ({ courses: { fintech10: { label: 'FT10', modules: ['bank-basic', 'exchange', 'rates', 'housing', 'life'] } }, options: { 'bank-basic': { startCents: 50000 }, life: options } });

test('age and stage at every boundary month; the life ends at month 577 (age 70)', () => {
  const at = (m) => [ageAt(m), stageOf(ageAt(m))];
  assert.deepEqual([1, 12, 13, 24, 25, 168, 169, 396, 397, 576, 577].map(at),
    [[22, 'A'], [22, 'A'], [23, 'A'], [23, 'A'], [24, 'A'], [35, 'A'], [36, 'B'], [54, 'B'], [55, 'C'], [69, 'C'], [70, 'C']]);
  assert.equal(endMonth(), 577);
  assert.deepEqual([monthOfAge(36), monthOfAge(55), monthOfAge(60), monthOfAge(65)], [169, 397, 457, 517]);
  assert.equal(ageAt(1, 25), 25);
});

test('plan validation: from month 1, increasing, each pace 1..12, each segment a whole number of class days up to month 577', () => {
  assert.deepEqual(checkPlan(DEFAULT_PLAN), DEFAULT_PLAN);
  assert.deepEqual(checkPlan([{ from_month: 1, months_per_day: 12 }]), [{ from_month: 1, months_per_day: 12 }]);   // 576 = 48 x 12
  const bad = [
    [[], /1 to 24 segments/], ['x', /1 to 24 segments/], [[{ from_month: 2, months_per_day: 1 }], /start at month 1/],
    [[{ from_month: 1, months_per_day: 0 }], /1 to 12/], [[{ from_month: 1, months_per_day: 13 }], /1 to 12/], [[{ from_month: 1, months_per_day: 1.5 }], /1 to 12/],
    [[{ from_month: 1, months_per_day: 1 }, { from_month: 25, months_per_day: 5 }], /not a whole number of class days at 5/],   // 552 is not a multiple of 5
    [[{ from_month: 1, months_per_day: 5 }, { from_month: 25, months_per_day: 4 }], /Segment 1 .*24 months.* at 5/],
    [[{ from_month: 1, months_per_day: 1 }, { from_month: 1, months_per_day: 1 }], /must start after month 1/],
    [[{ from_month: 1, months_per_day: 1 }, { from_month: 577, months_per_day: 1 }], /must start before month 577/],
    [[{ from_month: '1', months_per_day: 1 }], /whole number/], [[null], /from_month, months_per_day/], [[[1, 1]], /from_month, months_per_day/],
  ];
  for (const [plan, want] of bad) assert.throws(() => checkPlan(plan), want, JSON.stringify(plan));
});

test('class-day calculator, by hand: 24 + 36 + 19 + 15 = 94 days from month 1; from month 30 at 4 a day; locked at 2 a day', () => {
  const a = paceTable(DEFAULT_PLAN, { daysLeft: 85 });
  assert.deepEqual(a.rows.map((r) => [r.from_month, r.to_month, r.from_age, r.to_age, r.stages, r.days, r.days_left]),
    [[1, 24, 22, 23, 'A', 24, 24], [25, 168, 24, 35, 'A', 36, 36], [169, 396, 36, 54, 'B', 19, 19], [397, 576, 55, 69, 'C', 15, 15]]);
  assert.deepEqual([a.total_days, a.days_needed, a.spare_days, a.end_month], [94, 94, -9, 577]);
  const b = paceTable(DEFAULT_PLAN, { month: 30, currentPace: 4, daysLeft: 100 });
  assert.deepEqual(b.rows.map((r) => r.days_left), [0, 35, 19, 15]);   // ceil((169 - 30) / 4) = 35
  assert.deepEqual([b.days_needed, b.spare_days], [69, 31]);
  assert.equal(b.rows[1].current, true);
  const c = paceTable(DEFAULT_PLAN, { month: 1, currentPace: 2, locked: true });
  assert.deepEqual(c.rows.map((r) => r.days_left), [12, 72, 114, 90]);
  assert.equal(c.days_needed, 288);
  assert.equal(c.spare_days, null);
});

test('setPace: only a module that declares it gets it; months_per_day alone leaves auto_stopped, auto_advance clears it', async () => {
  const w = await world();
  try {
    const life = w.app.modules.kernel('life'), jobs = w.app.modules.kernel('jobs');
    assert.equal(typeof life.world.setPace, 'function');
    assert.equal(jobs.world.setPace, undefined);
    const stopped = () => w.app.world.current().auto_stopped;
    w.app.db.prepare("UPDATE worlds SET auto_advance = 'school_days', auto_stopped = 'a student was skipped' WHERE id = ?").run(w.app.world.current().id);
    life.world.setPace({ months_per_day: 3 });
    assert.equal(w.app.world.current().months_per_day, 3);
    assert.equal(stopped(), 'a student was skipped', 'a stop caused by a skipped student is not re-armed by a pace change');
    assert.equal(w.app.world.current().auto_advance, 'school_days');
    life.world.setPace({ auto_advance: 'manual' });
    assert.equal(stopped(), null);
    assert.equal(w.app.world.current().months_per_day, 3);
    assert.deepEqual(w.settings().map((s) => s.actor), ['system:life', 'system:life']);
    assert.throws(() => life.world.setPace({ months_per_day: 13 }), /1 to 12/);
  } finally { w.close(); }
});

test('the stage-paced clock: pace changes only when an advance crosses a boundary; the teacher\'s own pace holds in between; the pace lock holds', async () => {
  const w = await world();
  try {
    const teacherId = await w.app.players.createTeacher({ username: 'boss', passphrase: PASS });
    const teacher = { id: teacherId, username: 'boss', role: 'teacher', world_teacher: 1 };
    assert.deepEqual(w.settings(), [], 'a new world is already at 1 a day: no setting written');
    for (let m = 1; m < 24; m++) w.advance();
    assert.equal(w.app.world.current().months_per_day, 1);
    assert.deepEqual(w.settings(), []);
    w.advance();                                                                   // 24 -> 25: a boundary
    assert.equal(w.app.world.current().month, 25);
    assert.equal(w.app.world.current().months_per_day, 4);
    w.advance();                                                                   // 25 -> 29 at the new pace
    assert.equal(w.app.world.current().month, 29);
    w.app.world.setSettings({ months_per_day: 2 }, `player:${teacherId}`);         // the teacher's own choice mid-segment
    w.advance(); w.advance();                                                      // 29 -> 33: no boundary, life leaves it
    assert.equal(w.app.world.current().months_per_day, 2);
    assert.deepEqual(w.settings().map((s) => [s.actor, s.months_per_day]), [['system:life', 4], [`player:${teacherId}`, 2]]);
    w.jumpTo(167);
    w.advance();                                                                   // 167 -> 169: crosses 169
    assert.equal(w.app.world.current().months_per_day, 12);
    assert.deepEqual(w.post('life', '/lock', { locked: true }, teacher), { ok: true, locked: true });
    w.jumpTo(390);
    w.app.world.setSettings({ months_per_day: 3 });
    w.advance();                                                                   // 390 -> 393
    w.advance();                                                                   // 393 -> 396
    w.advance();                                                                   // 396 -> 399: crosses 397, but locked
    assert.equal(w.app.world.current().months_per_day, 3);
    assert.equal(w.settings().filter((s) => s.actor === 'system:life').length, 2);
  } finally { w.close(); }
});

test('the end of the life: auto-advance switches to manual once at month 577 (age 70); an advance past it is refused', async () => {
  const w = await world({ n: 1 });
  try {
    w.app.world.setSettings({ auto_advance: 'school_days' });
    w.jumpTo(565);
    w.app.world.setSettings({ months_per_day: 12 });
    assert.equal(w.app.world.autoAdvance().month, 577);                          // Monday 08:00: the timer advances 565 -> 577
    const now = w.app.world.current();
    assert.equal(now.auto_advance, 'manual');
    assert.equal(now.auto_stopped, null, 'an acknowledged stop, not a failure');
    w.setNow('2026-11-03T15:00:00Z');
    assert.equal(w.app.world.autoAdvance(), null, 'the next school day: nothing (manual)');
    const [u] = w.users;
    assert.ok(w.app.modules.badgesFor(u, 'fintech10').some((b) => b.text === 'Life Review ready'));
    assert.ok(w.app.modules.badgesFor(u, 'fintech10').some((b) => b.text === 'Age 70 · Stage C'));
    const quiet = console.error; console.error = () => {};
    try { assert.throws(() => w.advance(1), /The life ended at age 70/); } finally { console.error = quiet; }
    assert.equal(w.app.world.current().month, 577);
    assert.equal(w.settings().filter((s) => s.auto_advance === 'manual' && s.actor === 'system:life').length, 1);
  } finally { w.close(); }
});

test('retirement age: 60-70, from Stage B, not below your age, changeable until reached; the header chip', async () => {
  const w = await world();
  try {
    const [u] = w.users;
    assert.deepEqual(w.app.modules.badgesFor(u, 'fintech10').filter((b) => b.module === 'life').map((b) => b.text), ['Age 22 · Stage A']);
    assert.throws(() => w.post('life', '/retire', { retire_age: 65 }, u), (e) => e.status === 409 && /Stage B/.test(e.message));
    w.jumpTo(169);                                                                 // age 36
    for (const bad of [59, 71, '65', 65.5, null]) assert.throws(() => w.post('life', '/retire', { retire_age: bad }, u), (e) => e.status === 400, String(bad));
    assert.equal(w.post('life', '/retire', { retire_age: 62 }, u).retire.age, 62);
    assert.equal(w.post('life', '/retire', { retire_age: 66 }, u).retire.age, 66);
    w.jumpTo(monthOfAge(61));
    assert.throws(() => w.post('life', '/retire', { retire_age: 60 }, u), (e) => e.status === 400 && /at least 61/.test(e.message));
    assert.equal(w.post('life', '/retire', { retire_age: 63 }, u).retire.can_change, true);
    w.jumpTo(monthOfAge(63));
    assert.throws(() => w.post('life', '/retire', { retire_age: 65 }, u), (e) => e.status === 409 && /reached/.test(e.message));
    const st = w.get('life', '/state', u);
    assert.deepEqual([st.age, st.stage, st.retire.reached, st.retire.can_change], [63, 'C', true, false]);
    assert.deepEqual(st.stages.map((s) => [s.stage, s.from_month, s.to_month]), [['A', 1, 168], ['B', 169, 396], ['C', 397, 576]]);
  } finally { w.close(); }
});

test('off the segment grid (a manual one-month advance at 25): the last class day is shortened to land on 577 instead of failing past it', async () => {
  const w = await world({ n: 1 });
  try {
    const cur = () => w.app.world.current();
    while (cur().month < 25) w.advance();
    w.advance(1);                                                                  // 25 -> 26: off the grid (pace 4 from 25)
    assert.deepEqual([cur().month, cur().months_per_day], [26, 4]);
    const seq = [];
    while (cur().month < 577) { w.advance(); seq.push(cur().month); }             // every day at the world's own pace, no error
    assert.equal(seq.at(-2), 566);
    assert.equal(cur().month, 577);
    assert.equal(cur().months_per_day, 11, 'the final day was 566 -> 577');
    assert.equal(cur().auto_advance, 'manual');
    assert.throws(() => w.advance(), /The life ended/);
  } finally { w.close(); }
});

test('work stops at the retirement payday and not before: the last stub says why; endHolding is idempotent; a retired student cannot pick a job again', async () => {
  const w = await world({ n: 2 });
  try {
    const [u, other] = w.users;
    w.jumpTo(monthOfAge(60) - 2);                                                  // month 455, age 59
    const job = w.app.db.prepare('SELECT id FROM jobs_catalogue WHERE active = 1 ORDER BY id LIMIT 1').get().id;
    w.post('life', '/retire', { retire_age: 60 }, u);
    for (const s of [u, other]) w.post('jobs', '/pick', { job_id: job }, s);
    const holds = (s) => !!w.app.db.prepare('SELECT 1 FROM jobs_holdings WHERE player_id = ?').get(s.id);
    const stub = (s, m) => w.app.db.prepare('SELECT note, hourly_cents FROM jobs_paystubs WHERE player_id = ? AND month = ?').get(s.id, m);
    w.advance(1);                                                                  // 456, age 59: paid, keeps the job
    assert.ok(stub(u, 456) && holds(u));
    assert.doesNotMatch(stub(u, 456).note, /retirement/);
    w.advance(1);                                                                  // 457, age 60: the last pay, then the job ends
    assert.match(stub(u, 457).note, /You reached your retirement age \(60\): this is your last pay/);
    assert.equal(holds(u), false);
    assert.ok(holds(other), 'the default retirement age is 65');
    w.advance(1);
    assert.equal(stub(u, 458), undefined, 'no pay after retiring');
    assert.ok(stub(other, 458));
    const past = w.app.db.prepare('SELECT job_id, left_month, wage_cents FROM jobs_past WHERE player_id = ?').get(u.id);
    assert.deepEqual([past.job_id, past.left_month], [job, 457]);
    const k = w.app.modules.kernel('life');
    const again = k.modules.call('jobs', 'endHolding', { playerId: u.id, reason: 'again' });
    assert.deepEqual(again, { playerId: u.id, ended: false, jobId: null, businessIds: [], month: 458, reason: 'again' });   // 6c: businessIds, the company jobs it ended
    assert.throws(() => k.modules.call('jobs', 'endHolding', { playerId: 'x' }), /whole number/);
    assert.throws(() => w.post('jobs', '/pick', { job_id: job }, u), (e) => e.status === 409 && /retired/.test(e.message));   // no second career
    assert.equal(holds(u), false);
    w.post('jobs', '/pick', { job_id: job }, other);                               // not retired: picking still works
    assert.ok(holds(other));
    assert.equal(w.app.ledger.audit().ok, true);
  } finally { w.close(); }
});

test('stage events fire once, in the tick of their month; a skipped one never fires; a moved one fires at its new month (fake services)', async () => {
  globalThis.lifeCalls = [];
  const events = [{ month: 3, kind: 'crash', headline: 'Crash!' }, { month: 4, kind: 'rate', rate_bp: 500, headline: 'Rates up' }, { month: 5, kind: 'housing', pct: -10, headline: 'Homes down' }];
  const w = await world({ config: fakeConfig({ events }), modulesDir: withFakes() });
  try {
    const teacherId = await w.app.players.createTeacher({ username: 'boss', passphrase: PASS });
    const teacher = { id: teacherId, username: 'boss', role: 'teacher', world_teacher: 1 };
    const ids = w.get('life', '/teach', teacher).events.map((e) => e.id);
    w.advance(); w.advance();                                                      // month 3
    assert.deepEqual(globalThis.lifeCalls, [['exchange.stageEvent', { kind: 'crash', headline: 'Crash!' }, 3]]);
    w.post('life', '/event', { id: ids[1], skip: true }, teacher);
    w.post('life', '/event', { id: ids[2], month: 7 }, teacher);
    assert.throws(() => w.post('life', '/event', { id: ids[0], skip: true }, teacher), (e) => e.status === 409);
    assert.throws(() => w.post('life', '/event', { id: ids[2], month: 2 }, teacher), (e) => e.status === 400);
    for (let i = 0; i < 6; i++) w.advance();                                       // to month 9
    assert.deepEqual(globalThis.lifeCalls.map(([what, args, month]) => [what, month]), [['exchange.stageEvent', 3], ['housing.marketEvent', 7]]);
    assert.deepEqual(globalThis.lifeCalls[1][1], { pct: -10 });
    const v = w.get('life', '/teach', teacher).events;
    assert.deepEqual(v.map((e) => [e.month, e.skip, e.fired_month, e.result]), [[3, false, 3, 'done'], [4, true, null, null], [7, false, 7, 'done']]);
    w.post('life', '/event', { id: ids[1], skip: false }, teacher);                // un-skipped after its month: fires at the next tick, once
    w.advance(); w.advance();
    assert.deepEqual(globalThis.lifeCalls.slice(2), [['rates.queueRate', { rate_bp: 500 }, 10]]);
    assert.deepEqual(w.get('life', '/state', w.users[0]).events.map((e) => e.headline), ['Crash!', 'Homes down', 'Rates up']);
  } finally { w.close(); }
});

test('stage events with the services absent (modules not loaded): recorded as not available, the advance goes on', async () => {
  const config = structuredClone(CONFIG);
  for (const c of Object.values(config.courses)) c.modules = c.modules.filter((m) => !['exchange', 'rates', 'housing', 'insurance', 'credit', 'bills', 'savings', 'leaderboards', 'outfitters'].includes(m));
  config.options.life = { events: [{ month: 2, kind: 'crash', headline: 'Crash' }, { month: 2, kind: 'rate', rate_bp: 300, headline: 'Rates' }, { month: 2, kind: 'housing', pct: 5, headline: 'Homes' }] };
  const w = await world({ config });
  try {
    const warn = console.warn; console.warn = () => {};
    try { w.advance(); w.advance(); } finally { console.warn = warn; }
    assert.deepEqual(w.app.db.prepare('SELECT fired_month, result FROM life_events ORDER BY id').all().map((r) => [r.fired_month, r.result]),
      [[2, 'exchange.stageEvent not available'], [2, 'rates.queueRate not available'], [2, 'housing.marketEvent not available']]);
    assert.equal(w.app.world.current().month, 3);
  } finally { w.close(); }
});

test('Life Review snapshots: once per age, at the first tick at or after it, with savings\' net worth; allocation from the exchange when it gives one', async () => {
  const w = await world({ n: 2, config: (() => { const c = structuredClone(CONFIG); c.options.life = { startAge: 24 }; return c; })() });
  try {
    const [u] = w.users;
    const k = w.app.modules.kernel('life');
    for (let m = 1; m < 12; m++) w.advance();                                      // to month 12, age 24
    assert.deepEqual(k.modules.call('life', 'snapshots', { playerId: u.id }), []);
    w.advance();                                                                   // month 13, age 25
    const net = k.modules.call('savings', 'todayFacts', { playerId: u.id }).netWorthCents;
    const alloc = k.modules.call('exchange', 'allocation', { playerId: u.id });   // the exchange is loaded in the merged tree
    assert.deepEqual(k.modules.call('life', 'snapshots', { playerId: u.id }), [{ age: 25, stage: 'A', net_worth_cents: net, allocation: alloc }]);
    w.advance(); w.advance();
    assert.equal(w.app.db.prepare('SELECT COUNT(*) AS n FROM life_snapshots WHERE age = 25').get().n, 2, 'once per student');
    assert.equal(w.app.db.prepare('SELECT month FROM life_snapshots WHERE player_id = ?').get(u.id).month, 13);
  } finally { w.close(); }
  const f = await world({ config: fakeConfig({ startAge: 25, events: [] }), modulesDir: withFakes() });
  try {
    f.advance();
    assert.deepEqual(f.app.modules.kernel('life').modules.call('life', 'snapshots', { playerId: f.users[0].id }).map((s) => [s.age, s.allocation.stocks, s.allocation.bonds]), [[25, 6000, 4000]]);
  } finally { f.close(); }
});

test('bots pick a retirement age (60-70, deterministic) in Stage B; a retired bot\'s job is ended before the advance', async () => {
  const w = await world({ n: 12 });
  try {
    const bots = w.users.map((u) => ({ id: u.id, class_id: u.class_id, course_id: 'fintech10' }));
    w.app.modules.simulate({ month: 1, students: bots });
    assert.equal(w.app.db.prepare('SELECT COUNT(*) AS n FROM life_state').get().n, 0, 'Stage A: not yet');
    w.jumpTo(169);
    w.app.modules.simulate({ month: 169, students: bots });
    const ages = w.app.db.prepare('SELECT player_id, retire_age FROM life_state ORDER BY player_id').all().map((r) => r.retire_age);
    assert.equal(ages.length, 12);
    assert.ok(ages.every((a) => a >= 60 && a <= 70) && new Set(ages).size > 3, ages.join());
    w.app.modules.simulate({ month: 170, students: bots });
    assert.deepEqual(w.app.db.prepare('SELECT retire_age FROM life_state ORDER BY player_id').all().map((r) => r.retire_age), ages, 'chosen once');
    w.jumpTo(monthOfAge(70) - 1);                                                  // age 69: every bot is retired except those at 70
    w.app.modules.simulate({ month: monthOfAge(70) - 1, students: bots });
    const working = w.app.db.prepare('SELECT player_id FROM jobs_holdings').all().map((r) => r.player_id);
    const at70 = w.app.db.prepare('SELECT player_id FROM life_state WHERE retire_age = 70').all().map((r) => r.player_id);
    assert.deepEqual(working.sort(), at70.sort());
  } finally { w.close(); }
});

test('teacher panel: plan edits and the lock are the world teacher\'s; another teacher sees only their own students\' retirement ages', async () => {
  const srv = await boot();
  try {
    const { teacher: a, cls, students: [s1] } = await seeded(srv, 1, { transfers: false });
    const invite = (await a.post('/api/teach/invites')).json;
    const b = srv.client();
    assert.equal((await b.post('/api/teach/join', { token: new URL(invite.url).searchParams.get('invite'), username: 'teacherB', passphrase: PASS })).status, 200);
    const clsB = (await b.post('/api/teach/classes', { name: 'Block B', course: 'fintech10' })).json;
    await b.post(`/api/teach/classes/${clsB.id}/students`, { count: 1 });

    const va = (await a.get('/api/life/teach?days=85')).json;
    assert.deepEqual([va.age, va.stage, va.can_edit, va.calc.total_days, va.calc.spare_days], [22, 'A', true, 94, -9]);
    assert.deepEqual(va.classes.map((c) => c.id), [cls.id]);
    assert.deepEqual(va.classes[0].students.map((s) => [s.username, s.retire_age, s.set]), [[s1.username, 65, false]]);
    const vb = (await b.get('/api/life/teach')).json;
    assert.equal(vb.can_edit, false);
    assert.deepEqual(vb.classes.map((c) => c.id), [clsB.id]);
    assert.ok(!vb.classes.some((c) => c.students.some((s) => s.username === s1.username)));
    assert.equal((await a.get('/api/life/teach?days=-1')).status, 400);
    assert.equal((await a.get('/api/life/teach?days=abc')).status, 400);

    const plan = [{ from_month: 1, months_per_day: 2 }, { from_month: 25, months_per_day: 12 }];
    for (const [path, body] of [['/api/life/plan', { plan }], ['/api/life/lock', { locked: true }], ['/api/life/event', { id: 1, skip: true }]]) {
      assert.equal((await b.post(path, body)).status, 403, `teacher B: ${path}`);
      assert.equal((await s1.client.post(path, body)).status, 403, `a student: ${path}`);
    }
    assert.equal((await s1.client.get('/api/life/teach')).status, 403);
    assert.equal((await a.post('/api/life/plan', { plan: [{ from_month: 1, months_per_day: 5 }] })).status, 400);
    assert.equal((await a.post('/api/life/plan', { plan })).status, 200);
    assert.deepEqual((await a.get('/api/life/teach')).json.calc.rows.map((r) => r.days), [12, 46]);
    assert.equal((await a.post('/api/life/lock', { locked: 'yes' })).status, 400);
    assert.equal((await a.post('/api/life/event', { id: 99, skip: true })).status, 404);
    assert.equal((await a.post('/api/life/event', { id: 1 })).status, 400);
    assert.equal((await a.post('/api/life/event', { id: 1, skip: true })).status, 200);
    assert.equal((await s1.client.get('/api/life/state')).json.age, 22);
    assert.ok((await s1.client.get('/api/me')).json.badges.some((x) => x.text === 'Age 22 · Stage A'));
  } finally { await srv.cleanup(); }
});

test('season close leaves no life rows in the next world', async () => {
  const w = await world();
  try {
    const [u] = w.users;
    w.jumpTo(200);
    w.post('life', '/retire', { retire_age: 61 }, u);
    w.advance();
    w.app.world.close();
    const next = w.app.world.create({ name: 'Season 2' });
    for (const t of ['life_state', 'life_snapshots']) assert.equal(w.app.db.prepare(`SELECT COUNT(*) AS n FROM ${t} WHERE world_id = ?`).get(next.id).n, 0, t);
    assert.equal(w.app.db.prepare('SELECT COUNT(*) AS n FROM life_events WHERE world_id = ? AND fired_month IS NOT NULL').get(next.id).n, 0);
    assert.deepEqual(JSON.parse(w.app.db.prepare('SELECT plan FROM life_pace WHERE world_id = ?').get(next.id).plan), DEFAULT_PLAN, 'a fresh plan from the config');
    assert.equal(w.app.modules.kernel('life').modules.call('life', 'todayFacts', { playerId: u.id }).retireSet, false);
  } finally { w.close(); }
});

test('life switched off: the clock keeps the teacher\'s pace, no chips, no stage errand, work never stops', async () => {
  const config = structuredClone(CONFIG);
  for (const c of Object.values(config.courses)) c.modules = c.modules.filter((m) => m !== 'life');
  const w = await world({ config });
  try {
    const [u] = w.users;
    for (let m = 1; m < 26; m++) w.advance();
    assert.equal(w.app.world.current().months_per_day, 1);
    assert.deepEqual(w.settings(), []);
    assert.equal(w.app.modules.has('life'), false);
    assert.ok(!w.app.modules.badgesFor(u, 'fintech10').some((b) => /Stage/.test(b.text)));
    assert.equal(w.app.db.prepare("SELECT 1 FROM sqlite_master WHERE name = 'life_state'").get(), undefined);
    const job = w.app.db.prepare('SELECT id FROM jobs_catalogue WHERE active = 1 ORDER BY id LIMIT 1').get().id;
    w.post('jobs', '/pick', { job_id: job }, u);
    w.jumpTo(monthOfAge(66));
    w.advance(1); w.advance(1);
    assert.ok(w.app.db.prepare('SELECT 1 FROM jobs_holdings WHERE player_id = ?').get(u.id), 'still working at 66');
    assert.ok(!w.app.modules.homeCardsFor(u, 'fintech10', 'v').find((c) => c.module === 'today').data.errands.some((e) => e.title === 'Set your retirement age'));
  } finally { w.close(); }
});
