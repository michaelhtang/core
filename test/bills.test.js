// bills module (docs/phase1.md 1B): bills after a month tick, paying, autopay, late fees and history, choices, the Budget tab
// (with and without a jobs module), the teacher overview. A fake `jobs` module (kind jobs.pay) stands in for the real one.
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { ROOT } from '../lib/app.js';
import { boot, seeded, tmpDir } from './helpers.js';

const MODULES_URL = pathToFileURL(path.join(ROOT, 'lib', 'modules.js')).href;
const made = [];
after(() => { for (const d of made) fs.rmSync(d, { recursive: true, force: true }); });

const PAY = 150000;
const fakeJobs = (net, gross) => `import { defineModule } from '${MODULES_URL}';
export default defineModule({ id: 'jobs', requires: ['bank-basic'], onTick(k, { month, classes }) {
  for (const c of classes) for (const id of c.studentIds) {
    k.ledger.post({ kind: 'pay', legs: [{ account: k.ledger.system('mint'), cents: -${net} }, { account: k.ledger.accountId('player', id, 'chequing'), cents: ${net} }] });
    k.events.emit('paid', { playerId: id, worldId: k.world.current().id, month, net: ${net}, gross: ${gross} });
  }
} });`;
const FAKE_JOBS = fakeJobs(PAY, PAY);
// Posts 10 chequing entries per student: enough to push a jobs.pay entry out of any short statement window.
const NOISE = `import { defineModule } from '${MODULES_URL}';
export default defineModule({ id: 'noise', requires: ['bank-basic'], onTick(k, { classes }) {
  for (const c of classes) for (const id of c.studentIds) for (let i = 0; i < 10; i++) k.ledger.post({ kind: 'x', legs: [{ account: k.ledger.system('mint'), cents: -1 }, { account: k.ledger.accountId('player', id, 'chequing'), cents: 1 }] });
} });`;

// Stands in for housing: tells bills about the first student's housing costs every tick (the second keeps the catalogue rent).
const FAKE_HOUSING = `import { defineModule } from '${MODULES_URL}';
export default defineModule({ id: 'housing', requires: ['bank-basic'], onTick(k, { month, classes }) {
  const id = classes[0].studentIds[0];
  k.events.emit('costs', { playerId: id, month, lines: [{ key: 'rent', name: 'Rent (apartment)', amount: 90000, category: 'needs' }, { key: 'heat', name: 'Heat', amount: 8000, category: 'needs' }] });
} });`;

// Stands in for insurance: a premium line and a town-event expense for the first student every tick (the second keeps the plain bills).
const FAKE_INSURANCE = `import { defineModule } from '${MODULES_URL}';
export default defineModule({ id: 'insurance', requires: ['bank-basic'], onTick(k, { month, classes }) {
  const id = classes[0].studentIds[0];
  k.events.emit('costs', { playerId: id, month, lines: [{ key: 'tenant', name: 'Tenant insurance', amount: 2000, category: 'needs' }, { key: 'junk', name: 'x', amount: 0, category: 'needs' }] });
  k.events.emit('expense', { playerId: id, month, eventId: 70 + month, eventKey: 'phone-screen', name: 'Phone screen', amount: 25000, insuredBy: null });
} });`;

// modules/ with the real bank-basic and bills, plus (optionally) the fake jobs; `order` is the config order (default: jobs before bills).
function setup(withJobs, { order, noise = false, housing = false, insurance = false, credit = false, extra = [], jobs = FAKE_JOBS, bills = {} } = {}) {
  const d = tmpDir(); made.push(d);
  for (const id of ['bank-basic', 'bills', ...(credit ? ['credit'] : []), ...extra]) fs.symlinkSync(path.join(ROOT, 'modules', id), path.join(d, id));
  if (withJobs) { fs.mkdirSync(path.join(d, 'jobs')); fs.writeFileSync(path.join(d, 'jobs', 'index.js'), jobs); }
  if (housing) { fs.mkdirSync(path.join(d, 'housing')); fs.writeFileSync(path.join(d, 'housing', 'index.js'), FAKE_HOUSING); }
  if (insurance) { fs.mkdirSync(path.join(d, 'insurance')); fs.writeFileSync(path.join(d, 'insurance', 'index.js'), FAKE_INSURANCE); }
  if (noise) { fs.mkdirSync(path.join(d, 'noise')); fs.writeFileSync(path.join(d, 'noise', 'index.js'), NOISE); }
  const mods = order ?? (withJobs ? ['bank-basic', 'jobs', 'bills'] : ['bank-basic', 'bills']);
  const config = { courses: { fintech10: { label: 'x', modules: mods }, fintech2030: { label: 'y', modules: mods } }, options: { 'bank-basic': { startCents: 50000 }, bills: { ...bills } } };
  return { config, modulesDir: d };
}

async function world({ jobs = false, count = 3, autopay = false, ...opts } = {}) {
  const srv = await boot(setup(jobs, opts));
  const t = await seeded(srv, count, { transfers: false, autopay });
  const advance = () => srv.app.world.advance({ months: 1 });
  const give = (s, cents) => srv.app.ledger.post({ kind: 'test.grant', legs: [{ account: srv.app.ledger.system('mint'), cents: -cents }, { account: s.chequing.id, cents }] });
  const bal = (s) => srv.app.ledger.balance(s.chequing.id);
  const state = async (s) => (await s.client.get('/api/bills/state')).json;
  return { srv, ...t, advance, give, bal, state };
}

test('bills arrive after a month tick, with the default plans; nothing before', async () => {
  const w = await world();
  try {
    const [a] = w.students;
    assert.deepEqual((await w.state(a)).bills, []);
    w.advance();
    const s = await w.state(a);
    assert.deepEqual(s.bills.map((b) => b.bill_id), ['rent', 'utilities', 'groceries', 'phone-lite', 'internet', 'transit']);
    assert.equal(s.bills.reduce((t, b) => t + b.amount, 0), 75000 + 12000 + 36600 + 2400 + 2500 + 10000);
    assert.equal(s.budget.net_pay, 0);
    assert.ok(s.catalogue.every((c) => c.source_note && c.checked === '2026-10-22'));
    w.advance();                                                             // a second tick adds month 2 (idempotent per month)
    assert.equal((await w.state(a)).bills.length, 18);                    // 12 bills + 6 late-fee lines for month 1
  } finally { await w.srv.cleanup(); }
});

test('paying: one bill, an overdraft is refused with the reason, Pay all pays what the balance covers in bill order', async () => {
  const w = await world();
  try {
    const [a] = w.students;
    w.advance();
    const bills = (await w.state(a)).bills;
    const id = (name) => bills.find((b) => b.bill_id === name).id;
    const rent = await a.client.post('/api/bills/pay', { id: id('rent') });
    assert.equal(rent.status, 400);
    assert.match(rent.json.error, /Not enough in chequing: Rent .* is \$750\.00 and you have \$500\.00/);
    assert.equal((await a.client.post('/api/bills/pay', { id: id('groceries') })).status, 200);
    assert.equal(w.bal(a), 50000 - 36600);
    assert.equal((await a.client.post('/api/bills/pay', { id: id('groceries') })).status, 409);
    const all = await a.client.post('/api/bills/pay-all');
    assert.equal(all.json.paid, 1);                                          // utilities ($120) fits in $134; the rest do not
    assert.equal(w.bal(a), 50000 - 36600 - 12000);
    assert.equal((await a.client.post('/api/bills/pay', { id: 999999 })).status, 404);
    const s = await w.state(a);
    assert.equal(s.bills.filter((b) => b.paid).length, 2);
    assert.equal(w.srv.app.ledger.audit().ok, true);
  } finally { await w.srv.cleanup(); }
});

test('autopay pays everything due at the tick, rent first; manual students stay unpaid', async () => {
  const w = await world();
  try {
    const [a, b] = w.students;
    w.give(a, 500000); w.give(b, 500000);
    assert.equal((await a.client.post('/api/bills/autopay', { enabled: true })).status, 200);
    w.advance();
    const sa = await w.state(a), sb = await w.state(b);
    assert.ok(sa.autopay && sa.bills.every((x) => x.paid && x.paid_month === 2));
    assert.ok(sb.bills.every((x) => !x.paid));
    const stmt = w.srv.app.ledger.statement(a.chequing.id, { limit: 10 }).filter((e) => e.kind === 'bills.payment').reverse();
    assert.match(stmt[0].memo, /Rent/);
    assert.equal(w.bal(a), 550000 - 138500);
    assert.equal(sa.history.length, 0);
  } finally { await w.srv.cleanup(); }
});

test('an unpaid bill adds one "Late fee" due line next month (greater of $25 or 5%), is recorded in history, and everything can still be paid', async () => {
  const w = await world();
  try {
    const [a] = w.students;
    w.give(a, 500000);
    w.advance();
    const before = w.bal(a);
    w.advance();
    assert.equal(w.bal(a), before);                                          // nothing is taken: the fee is a bill like any other
    let s = await w.state(a);
    const fees = s.bills.filter((x) => x.category === 'fees');
    assert.deepEqual(fees.map((x) => x.amount), [3750, 2500, 2500, 2500, 2500, 2500]);   // rent 5% = $37.50; every other bill is under $500, so $25
    assert.equal(fees[0].name, 'Late fee: Rent (room in a shared house)');
    assert.ok(fees.every((x) => x.due_month === 3 && !x.paid));
    assert.equal(s.history.length, 6);
    assert.ok(s.history.every((r) => r.months_late === 1 && r.paid_month === null));
    assert.equal(s.bills.filter((x) => x.late).length, 6);
    assert.equal(s.budget.fees, 3750 + 2500 * 5);
    w.advance();                                                             // month 1 is 2 months late (no second fee); month 2's bills are late once; the month-2 fee lines are late but never earn a fee
    s = await w.state(a);
    assert.equal(s.bills.filter((x) => x.category === 'fees').length, 12);
    assert.equal(s.bills.filter((x) => x.category === 'fees' && x.due_month === 4).length, 6);
    assert.deepEqual(s.history.map((r) => r.months_late), [2, 2, 2, 2, 2, 2, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1].reverse());
    const pay = await a.client.post('/api/bills/pay-all');
    assert.equal(pay.json.paid, 6 * 3 + 12);                                 // 18 bills + 12 fee lines
    s = await w.state(a);
    assert.ok(s.history.every((r) => r.paid_month === 4));
    assert.equal(w.srv.app.ledger.audit().ok, true);
  } finally { await w.srv.cleanup(); }
});

test('late fee lines are not lost: a broke student never overdraws, and the fee lines wait unpaid', async () => {
  const w = await world();
  try {
    const [a] = w.students;
    w.srv.app.ledger.post({ kind: 'test.drain', legs: [{ account: a.chequing.id, cents: -49000 }, { account: w.srv.app.ledger.system('sink'), cents: 49000 }] });
    w.advance(); w.advance();
    assert.equal(w.bal(a), 1000);
    const s = await w.state(a);
    assert.equal(s.bills.filter((b) => b.late).length, 6);
    assert.equal(s.history.length, 6);
    assert.equal(s.budget.fees, 3750 + 2500 * 5);                            // owed, not taken
    assert.ok(s.bills.filter((b) => b.category === 'fees').every((b) => !b.paid));
    assert.equal((await a.client.post('/api/bills/pay-all')).status, 400);   // the cheapest line is $25 and $10.00 is left
    assert.ok(w.bal(a) >= 0);
    assert.equal(w.srv.app.ledger.audit().ok, true);
  } finally { await w.srv.cleanup(); }
});

test('tick order: this month\'s bills, then late marks and fee lines, THEN autopay, so autopay pays the fee lines in the same tick', async () => {
  const w = await world();
  try {
    const [a] = w.students;
    w.advance();                                                             // month 1 bills, unpaid (autopay was off)
    w.give(a, 500000);
    await a.client.post('/api/bills/autopay', { enabled: true });
    const before = w.bal(a);
    w.advance();
    const s = await w.state(a);
    const fees = s.bills.filter((b) => b.category === 'fees');
    assert.equal(fees.length, 6);
    assert.ok(s.bills.every((b) => b.paid && b.paid_month === 3));           // month-1 bills, fee lines and month-2 bills, all paid at tick 2
    assert.equal(w.bal(a), before - 2 * 138500 - (3750 + 2500 * 5));
    assert.ok(s.history.every((r) => r.paid_month === 3));
  } finally { await w.srv.cleanup(); }
});

test('/pay and Pay all refuse another season\'s bill (404) and leave it alone', async () => {
  const w = await world();
  try {
    const [a] = w.students;
    w.give(a, 500000);
    w.advance();
    const wid = w.srv.app.world.current().id;
    const old = Number(w.srv.app.db.prepare(`INSERT INTO bills_due (player_id, world_id, bill_id, name, category, amount, due_month) VALUES (?, ?, 'rent', 'Rent', 'needs', 100, 1)`).run(a.id, wid + 99).lastInsertRowid);
    assert.equal((await a.client.post('/api/bills/pay', { id: old })).status, 404);
    const before = w.bal(a);
    assert.equal((await a.client.post('/api/bills/pay-all')).json.paid, 6);
    assert.equal(w.bal(a), before - 138500);
    assert.equal(w.srv.app.db.prepare('SELECT paid_txn FROM bills_due WHERE id = ?').get(old).paid_txn, null);
  } finally { await w.srv.cleanup(); }
});

test('plan choices apply to the next month; invalid choices are refused', async () => {
  const w = await world();
  try {
    const [a] = w.students;
    w.advance();
    assert.equal((await a.client.post('/api/bills/choice', { slot: 'transport', option: 'car' })).status, 200);
    assert.equal((await a.client.post('/api/bills/choice', { slot: 'internet', option: 'none' })).status, 200);
    assert.equal((await a.client.post('/api/bills/choice', { slot: 'transport', option: 'jetpack' })).status, 400);
    assert.equal((await a.client.post('/api/bills/choice', { slot: 'rent', option: 'room' })).status, 400);   // required bills are not a choice
    assert.equal((await w.state(a)).bills.length, 6);                        // month 1 is unchanged
    w.advance();
    const m2 = (await w.state(a)).bills.filter((b) => b.due_month === w.srv.app.world.current().month && b.category !== 'fees').map((b) => b.bill_id);
    assert.deepEqual(m2, ['rent', 'utilities', 'groceries', 'phone-lite', 'car-insurance', 'car-gas']);
    const slots = (await w.state(a)).slots;
    assert.equal(slots.find((x) => x.slot === 'transport').current, 'car');
  } finally { await w.srv.cleanup(); }
});

test('Budget without a jobs module: "No pay yet" (net pay 0, no split), bills still work', async () => {
  const w = await world();
  try {
    const [a] = w.students;
    w.advance();
    const s = await w.state(a);
    assert.equal(s.budget.net_pay, 0);
    assert.equal(s.budget.pct, null);
    assert.equal(s.budget.left, -138500);
    assert.equal(s.bills.length, 6);
  } finally { await w.srv.cleanup(); }
});

for (const order of [['bank-basic', 'jobs', 'bills'], ['bank-basic', 'bills', 'jobs']]) {
  test(`Budget with a jobs module (config order ${order.join(', ')}): this month's net pay, bills, what is left, the 50/30/20 split`, async () => {
    const w = await world({ jobs: true, order });
    try {
      const [a] = w.students;
      w.advance();
      const s = await w.state(a);
      assert.equal(s.budget.net_pay, PAY);
      assert.equal(s.budget.needs, 136000);
      assert.equal(s.budget.wants, 2500);
      assert.equal(s.budget.left, PAY - 138500);
      assert.deepEqual(s.budget.pct, { needs: 91, wants: 2, savings: 8 });
      assert.deepEqual(s.budget.targets, { needs: 50, wants: 30, savings: 20 });
      w.advance();                                                           // the late fee lines come out of what is left
      const s2 = await w.state(a);
      assert.equal(s2.budget.net_pay, PAY);
      assert.equal(s2.budget.fees, 3750 + 2500 * 5);
      assert.equal(s2.budget.left, PAY - 138500 - (3750 + 2500 * 5));
    } finally { await w.srv.cleanup(); }
  });
}

test('net pay does not depend on what else hits chequing: 60 other entries between payday and bills still count', async () => {
  const w = await world({ jobs: true, noise: true, order: ['bank-basic', 'jobs', 'noise', 'bills'] });
  try {
    const [a] = w.students;
    w.advance();
    assert.equal((await w.state(a)).budget.net_pay, PAY);
    w.advance();
    assert.equal((await w.state(a)).budget.net_pay, PAY);
  } finally { await w.srv.cleanup(); }
});

test('a payday rolled back takes its net-pay rows with it', async () => {
  const w = await world({ jobs: true });
  try {
    const [a] = w.students;
    w.srv.app.world.onTick('zz-boom', () => { throw new Error('boom'); });   // runs after every module's tick: the whole advance rolls back
    assert.throws(() => w.advance());
    assert.equal(w.srv.app.db.prepare('SELECT COUNT(*) AS n FROM bills_pay').get().n, 0);
    assert.equal((await w.state(a)).budget.net_pay, 0);
  } finally { await w.srv.cleanup(); }
});

test('startAfter "pay": bills start the month AFTER a student\'s first pay, so nobody is late before their first payday', async () => {
  const w = await world({ jobs: true, bills: { startAfter: 'pay' } });
  try {
    const [a] = w.students;
    w.advance();                                                             // first pay at tick 2, no bills yet
    let s = await w.state(a);
    assert.deepEqual(s.bills, []);
    assert.equal(s.budget.net_pay, PAY);
    w.advance();
    s = await w.state(a);
    assert.equal(s.bills.length, 6);
    assert.ok(s.bills.every((b) => b.due_month === 3 && !b.late));
  } finally { await w.srv.cleanup(); }
});

test('startAfter "login" (default, no jobs): bills start the month after the first login; a student who logs in later is not billed for months before', async () => {
  const w = await world();
  try {
    const [a] = w.students;
    w.advance(); w.advance();
    const late = await w.teacher.post(`/api/teach/classes/${w.cls.id}/students`, { count: 1 });
    const c = w.srv.client();
    await c.post('/api/login', { username: late.json.students[0].username, secret: late.json.students[0].pin });
    w.advance();                                                             // month 4
    assert.equal((await c.get('/api/bills/state')).json.bills.length, 6);
    assert.deepEqual((await c.get('/api/bills/state')).json.bills.map((b) => b.due_month), [4, 4, 4, 4, 4, 4]);
    assert.equal((await w.state(a)).bills.filter((b) => b.category !== 'fees').length, 18);
  } finally { await w.srv.cleanup(); }
});

test('teacher overview: who is paid up, late, on autopay; students cannot read it', async () => {
  const w = await world();
  try {
    const [a, b] = w.students;
    w.give(a, 500000);
    await a.client.post('/api/bills/autopay', { enabled: true });
    w.advance(); w.advance();
    const ov = await w.teacher.get('/api/bills/overview');
    assert.equal(ov.status, 200);
    const rows = Object.fromEntries(ov.json.classes[0].students.map((s) => [s.username, s]));
    assert.deepEqual([rows[a.username].autopay, rows[a.username].open, rows[a.username].late], [true, 0, 0]);
    assert.equal(rows[b.username].late, 6);
    assert.equal(rows[b.username].late_ever, 6);
    assert.equal((await a.client.get('/api/bills/overview')).status, 403);
    assert.equal((await w.teacher.get('/api/bills/state')).status, 403);
  } finally { await w.srv.cleanup(); }
});

test('the bill-start rule restarts each season: a student who gets a job late in season 2 is not billed before that first pay', async () => {
  const srv = await boot();
  try {
    const { teacher, students: [s] } = await seeded(srv, 1, { transfers: false });
    const db = srv.app.db;
    const billsIn = (worldId) => db.prepare('SELECT DISTINCT due_month FROM bills_due WHERE player_id = ? AND world_id = ? ORDER BY due_month').all(s.id, worldId).map((r) => r.due_month);
    const firstPay = (worldId) => db.prepare('SELECT MIN(month) AS m FROM bills_pay WHERE player_id = ? AND world_id = ?').get(s.id, worldId).m;
    const advance = async () => { const w = (await teacher.get('/api/teach/state')).json.world; assert.equal((await teacher.post('/api/teach/world/advance', { from: w.month })).status, 200); };

    // Season 1: a job from month 1, paid in month 2, billed from month 3.
    assert.equal((await s.client.post('/api/jobs/pick', { job_id: 1 })).status, 200);
    for (let i = 0; i < 3; i++) await advance();
    const w1 = srv.app.world.current().id;
    assert.equal(firstPay(w1), 2);
    assert.deepEqual(billsIn(w1), [3, 4]);

    // Close; new season; the student has quit and only takes a job in month 5.
    assert.equal((await teacher.post('/api/teach/world/close', {})).status, 200);
    assert.equal((await teacher.post('/api/teach/world/create', { name: 'Season 2', season_start: '2027-02-01', season_end: '2027-06-30' })).status, 200);
    const w2 = srv.app.world.current().id;
    assert.notEqual(w2, w1);
    assert.equal((await s.client.post('/api/jobs/quit', {})).status, 200);
    for (let i = 0; i < 4; i++) await advance();                       // months 1 -> 5: no job, no pay
    assert.deepEqual(billsIn(w2), [], 'no bills before the first pay of this season');
    assert.equal((await s.client.post('/api/jobs/pick', { job_id: 1 })).status, 200);
    for (let i = 0; i < 3; i++) await advance();                       // months 6-8: paid from month 6, billed from month 7
    assert.equal(firstPay(w2), 6);
    assert.deepEqual(billsIn(w2), [7, 8]);
  } finally { await srv.cleanup(); }
});

// ---- Phase 2 (wave 2a): events, pay-from-card, housing lines ----

test('bills.paid and bills.late events: every payment path, onTime by due month, late again each tick, emitted inside the transaction', async () => {
  const w = await world();
  try {
    const [a, b] = w.students;
    const ev = { paid: [], late: [] }, inTxn = [];
    w.srv.app.events.on('module.bills.paid', (p) => { ev.paid.push(p); inTxn.push(w.srv.app.db.isTransaction); });
    w.srv.app.events.on('module.bills.late', (p) => { ev.late.push(p); inTxn.push(w.srv.app.db.isTransaction); });
    w.give(a, 1000000); w.give(b, 1000000);
    await b.client.post('/api/bills/autopay', { enabled: true });
    w.advance();                                                             // first tick (m): b's autopay pays all six at the tick
    const m = w.srv.app.world.current().month;
    const mine = (list, s) => list.filter((e) => e.playerId === s.id);
    assert.equal(mine(ev.paid, b).length, 6);
    assert.ok(mine(ev.paid, b).every((e) => e.onTime && e.month === m && e.amount > 0));
    const id = (await w.state(a)).bills.find((x) => x.bill_id === 'rent').id;
    assert.equal((await a.client.post('/api/bills/pay', { id })).status, 200);   // manual, same month
    assert.deepEqual(mine(ev.paid, a), [{ playerId: a.id, worldId: w.srv.app.world.current().id, month: m, dueMonth: m, billId: 'rent', onTime: true, amount: 75000 }]);
    assert.equal(ev.late.length, 0);
    w.advance();                                                             // month 2: a's five other month-1 bills are late (b autopaid month 2 and nothing is late)
    assert.deepEqual(mine(ev.late, a).map((e) => [e.billId, e.monthsLate, e.month]).sort(), ['groceries', 'internet', 'phone-lite', 'transit', 'utilities'].map((x) => [x, 1, m + 1]));
    assert.equal(mine(ev.late, b).length, 0);
    w.advance();                                                             // month 3: still late, 2 months; month-2 bills and fee lines are late once
    assert.equal(mine(ev.late, a).filter((e) => e.month === m + 2 && e.billId === 'groceries')[0].monthsLate, 2);
    assert.ok(mine(ev.late, a).some((e) => e.month === m + 2 && e.billId.startsWith('late-fee-') && e.monthsLate === 1));
    const before = ev.paid.length;
    assert.equal((await a.client.post('/api/bills/pay-all')).status, 200);   // Pay all: month-1 and month-2 bills are overdue, month-3's are on time
    const late = ev.paid.slice(before).filter((e) => !e.onTime), onTime = ev.paid.slice(before).filter((e) => e.onTime);
    const dueNow = app => app.db.prepare('SELECT COUNT(*) AS n FROM bills_due WHERE player_id = ? AND paid_month = ? AND due_month = ?').get(a.id, m + 2, m + 2).n;
    assert.ok(late.length > 0 && onTime.length === dueNow(w.srv.app) && late.every((e) => e.month === m + 2));
    assert.ok(ev.paid.slice(before).every((e) => e.playerId === a.id));
    assert.ok(inTxn.every((t) => t === true), 'emitted inside the same transaction as the write');
  } finally { await w.srv.cleanup(); }
});

test('pay from card: needs a card account; the limit comes from module.credit.limit; refused past it; autopay follows pay_from', async () => {
  const w = await world();
  try {
    const [a, b] = w.students;
    const app = w.srv.app;
    const openCard = (s) => app.ledger.openAccount({ ownerType: 'player', ownerId: s.id, kind: 'card', allowNegative: true });
    const cardBal = (s) => app.ledger.balance(app.ledger.accountId('player', s.id, 'card'));
    assert.equal((await a.client.post('/api/bills/pay-from', { source: 'card' })).status, 400);   // no card yet
    assert.equal((await a.client.post('/api/bills/pay-from', { source: 'gold' })).status, 400);
    assert.equal((await w.state(a)).card, null);
    openCard(a); openCard(b);
    assert.equal((await a.client.post('/api/bills/pay-from', { source: 'card' })).status, 200);
    assert.equal((await w.state(a)).pay_from, 'card');
    w.advance();
    const bills = (await w.state(a)).bills, id = (n) => bills.find((x) => x.bill_id === n).id;
    assert.equal((await w.state(a)).paying_from, 'chequing');               // card chosen, limit not known yet: chequing pays meanwhile
    assert.equal(cardBal(a), 0);
    app.events.emit('module.credit.limit', { playerId: a.id, worldId: app.world.current().id, limitCents: 100000 });
    const chq = w.bal(a);
    assert.equal((await a.client.post('/api/bills/pay', { id: id('groceries') })).status, 200);
    assert.equal(cardBal(a), -36600);
    assert.equal(w.bal(a), chq);                                             // chequing untouched
    const e = app.ledger.statement(app.ledger.accountId('player', a.id, 'card'), { limit: 5 })[0];
    assert.equal(e.kind, 'bills.payment');
    const over = await a.client.post('/api/bills/pay', { id: id('rent') });
    assert.equal(over.status, 400);
    assert.match(over.json.error, /Not enough room on your card: Rent .* is \$750\.00 and you have \$634\.00 available/);
    assert.equal(cardBal(a), -36600);
    const st = (await w.state(a)).card;
    assert.deepEqual([st.limit_cents, st.available_cents], [100000, 63400]);
    app.events.emit('module.credit.limit', { playerId: a.id, worldId: app.world.current().id, limitCents: 40000 });   // the latest limit wins
    assert.equal((await w.state(a)).card.available_cents, 3400);
    assert.equal((await a.client.post('/api/bills/pay-all')).json.paid, 1);  // only the $24 phone plan fits in what is left
    assert.ok(cardBal(a) >= -40000);
    // autopay follows pay_from
    app.events.emit('module.credit.limit', { playerId: b.id, worldId: app.world.current().id, limitCents: 1000000 });
    await b.client.post('/api/bills/pay-from', { source: 'card' });
    await b.client.post('/api/bills/autopay', { enabled: true });
    const bChq = w.bal(b);
    w.advance();
    assert.equal(cardBal(b), -(2 * 138500 + 3750 + 2500 * 5));              // b's autopay also cleared last tick's bills and their fee lines
    assert.equal(w.bal(b), bChq);
    assert.equal((await b.client.post('/api/bills/pay-from', { source: 'chequing' })).status, 200);
    assert.equal(app.ledger.audit().ok, true);
  } finally { await w.srv.cleanup(); }
});

for (const order of [['bank-basic', 'housing', 'bills'], ['bank-basic', 'bills', 'housing']]) {
  test(`housing costs replace the catalogue rent line, other bills unchanged, no duplicate rent (config order ${order.join(', ')})`, async () => {
    const w = await world({ housing: true, order, count: 2 });
    try {
      const [a, b] = w.students;
      let m = 0;
      const ids = async (s) => (await w.state(s)).bills.filter((x) => x.due_month === m).map((x) => x.bill_id).sort();
      // housing after bills (a misordered config): its lines arrive after month 1's rent was issued, so they apply from month 2 (a lag, never a reversal)
      const lag = order.indexOf('housing') > order.indexOf('bills');
      const catalogueIds = ['groceries', 'internet', 'phone-lite', 'rent', 'transit', 'utilities'];
      const housingIds = ['groceries', 'housing-heat', 'housing-rent', 'internet', 'phone-lite', 'transit', 'utilities'];
      w.advance();
      m = w.srv.app.world.current().month;
      assert.deepEqual(await ids(a), lag ? catalogueIds : housingIds);
      assert.deepEqual(await ids(b), catalogueIds);
      if (!lag) {
        const s = await w.state(a);
        assert.equal(s.bills.find((x) => x.bill_id === 'housing-rent').amount, 90000);
        assert.equal(s.budget.needs, 90000 + 8000 + 12000 + 36600 + 2400 + 10000);
        assert.equal(s.bills.filter((x) => x.bill_id === 'rent').length, 0);
      }
      w.give(a, 1000000);
      await a.client.post('/api/bills/autopay', { enabled: true });
      w.advance();                                                           // month 2: housing lines (both orders); month 1's bills are late and fined like any bill
      m = w.srv.app.world.current().month;
      assert.deepEqual((await ids(a)).filter((x) => !x.startsWith('late-fee')), housingIds);   // month 2 is housing lines in both orders
      const s2 = await w.state(a);
      assert.equal(s2.bills.filter((x) => x.bill_id === 'rent').length, 0);   // state lists unpaid bills + this month's; month 1's (paid) don't show
      assert.equal(s2.bills.filter((x) => x.bill_id === 'housing-rent').length, 1);
      assert.ok(s2.bills.some((x) => /^Late fee: Rent/.test(x.name)));
      assert.ok(s2.bills.every((x) => x.paid));                              // autopay paid everything in the same tick
      assert.equal(w.srv.app.ledger.audit().ok, true);
      const spent = 50000 + 1000000 - w.bal(a);                              // rent is paid exactly once per month in either order
      const month2 = 98000 + 63500;
      assert.equal(spent, lag ? (75000 + 63500) + (3750 + 2500 * 5) + month2      // month 1 catalogue + its fees, month 2 housing
                              : 2 * month2 + (4500 + 2500 * 6));             // two months of housing lines + month 1's fee lines
      assert.equal(w.srv.app.ledger.statement(w.srv.app.ledger.accountId('player', a.id, 'chequing'), { limit: 200 }).filter((e) => e.kind === 'core.reversal').length, 0);   // never a reversal
    } finally { await w.srv.cleanup(); }
  });
}

// ---- Wave 2a integration: the real credit and bills together (fake jobs: $3,400 gross -> a $1,700 card limit) ----

for (const order of [['bank-basic', 'insurance', 'bills'], ['bank-basic', 'bills', 'insurance']]) {
  test(`insurance costs and town-event expenses become due lines; rent and the other bills are untouched; misordered config lags one month, never reverses (${order.join(', ')})`, async () => {
    const w = await world({ insurance: true, order, count: 2 });
    try {
      const [a, b] = w.students;
      const lag = order.indexOf('insurance') > order.indexOf('bills');
      const ids = async (s) => (await w.state(s)).bills.filter((x) => !x.bill_id.startsWith('late-fee')).map((x) => `${x.bill_id}:${x.due_month}`).sort();
      w.advance();                                                           // month 1 for bills (first billed tick)
      const m = w.srv.app.world.current().month;
      const base = ['groceries', 'internet', 'phone-lite', 'rent', 'transit', 'utilities'].map((x) => `${x}:${m}`);
      assert.deepEqual(await ids(b), base);
      assert.deepEqual(await ids(a), lag ? base : [...base, `event-${70 + m}:${m}`, `insurance-tenant:${m}`].sort());
      w.advance();                                                           // month 2: both lines for the month, in both orders
      // in the lag order, month 1's lines were kept for month 2 and month 2's wait for month 3
      assert.ok((await ids(a)).includes(`insurance-tenant:${m + 1}`) && (await ids(a)).includes(`event-${70 + m + (lag ? 0 : 1)}:${m + 1}`));
      const s = await w.state(a);
      const line = s.bills.find((x) => x.bill_id === `insurance-tenant`);
      assert.deepEqual([line.name, line.amount, line.category], ['Tenant insurance', 2000, 'needs']);
      assert.equal(s.bills.find((x) => x.bill_id.startsWith('event-')).amount, 25000);
      assert.equal(s.bills.some((x) => x.bill_id.endsWith('-junk')), false);   // an amount of 0 is refused
    } finally { await w.srv.cleanup(); }
  });
}

test('module.bills.choices: announced once at a student\'s first billed tick, then whenever they change a plan; options are every slot\'s effective option', async () => {
  const w = await world({ count: 2 });
  try {
    const [a, b] = w.students;
    const got = [];
    w.srv.app.events.on('module.bills.choices', (p) => got.push(p));
    assert.equal((await a.client.post('/api/bills/choice', { slot: 'transport', option: 'car' })).status, 200);
    assert.equal(got.length, 0, 'not billed yet, so nothing is announced');
    w.advance();
    const mine = (s) => got.filter((e) => e.playerId === s.id);
    assert.deepEqual(mine(a), [{ playerId: a.id, options: { phone: 'lite', internet: 'share', transport: 'car' }, autoPremiumCents: 18000 }]);
    assert.deepEqual(mine(b)[0].options, { phone: 'lite', internet: 'share', transport: 'ets' });
    w.advance();
    assert.equal(got.length, 2, 'once per student per season');
    assert.equal((await b.client.post('/api/bills/choice', { slot: 'phone', option: 'none' })).status, 200);
    assert.deepEqual(mine(b).at(-1).options, { phone: 'none', internet: 'share', transport: 'ets' });
  } finally { await w.srv.cleanup(); }
});

test('config order: insurance, then credit, tick before bills in both courses', () => {
  const c = JSON.parse(fs.readFileSync(path.join(ROOT, 'config', 'vdaa.json'), 'utf8'));
  for (const course of Object.values(c.courses)) {
    const at = (id) => course.modules.indexOf(id);
    assert.ok(at('insurance') >= 0 && at('insurance') < at('credit') && at('credit') < at('bills'), course.modules.join(', '));
  }
});

// Three months of pay, a card, bills on the card with autopay, credit autopay `mode`; then 8 months. Returns one row per month.
async function cardMonths(mode) {
  const srv = await boot(setup(true, { order: ['bank-basic', 'jobs', 'credit', 'bills'], credit: true, jobs: fakeJobs(300000, 340000), bills: { startAfter: 'pay' } }));
  try {
    const { students: [s] } = await seeded(srv, 1, { transfers: false });
    const app = srv.app, db = app.db, wid = () => app.world.current().id;
    const card = () => app.ledger.balance(app.ledger.accountId('player', s.id, 'card'));
    assert.equal((await s.client.post('/api/bills/autopay', { enabled: true })).status, 200);
    app.world.advance({ months: 3 });
    const ap = (await s.client.post('/api/credit/apply')).json;
    assert.deepEqual([ap.approved, ap.limit_cents], [true, 170000]);
    assert.equal((await s.client.post('/api/bills/pay-from', { source: 'card' })).status, 200);
    assert.equal((await s.client.post('/api/credit/autopay', { mode })).status, 200);
    const fromChequing = () => db.prepare("SELECT COUNT(*) AS n FROM txns WHERE kind = 'bills.payment' AND json_extract(meta, '$.from') = 'chequing'").get().n;
    const base = fromChequing();                                             // bills paid from chequing before the card existed
    const rows = [];
    for (let i = 1; i <= 8; i++) {
      app.world.advance({ months: 1 });
      const m = app.world.current().month;
      rows.push({
        i, card_owed: -card(), interest: db.prepare('SELECT COALESCE(SUM(interest_cents), 0) AS n FROM credit_statements WHERE player_id = ?').get(s.id).n,
        late_marks: db.prepare("SELECT COUNT(*) AS n FROM credit_history WHERE player_id = ? AND outcome = 'late'").get(s.id).n,
        late_bills: db.prepare('SELECT COUNT(*) AS n FROM bills_history WHERE player_id = ?').get(s.id).n,
        unpaid: db.prepare('SELECT COUNT(*) AS n FROM bills_due WHERE player_id = ? AND world_id = ? AND paid_txn IS NULL').get(s.id, wid()).n,
        score: db.prepare('SELECT score FROM credit_scores WHERE player_id = ? AND month = ?').get(s.id, m).score,
        chequing: app.ledger.balance(s.chequing.id),
        from_chequing: fromChequing() - base,
      });
    }
    if (process.env.CARD_TABLE) console.table(rows.map(({ from_chequing, ...r }) => ({ mode, ...r })));
    assert.equal(app.ledger.audit().ok, true);
    return rows;
  } finally { await srv.cleanup(); }
}

test('a pay-in-full student (card for bills, both autopays on, $1,700 limit) is never late, pays no interest, never goes over the limit, and the score never drops', async () => {
  const rows = await cardMonths('full');
  for (const r of rows) {
    assert.equal(r.late_marks, 0, `month ${r.i}`);
    assert.equal(r.late_bills, 0, `month ${r.i}`);
    assert.equal(r.unpaid, 0, `month ${r.i}`);
    assert.equal(r.interest, 0, `month ${r.i}`);
    assert.ok(r.card_owed <= 170000, `month ${r.i}: ${r.card_owed} owed on a $1,700 limit`);
  }
  for (let i = 2; i < rows.length; i++) assert.ok(rows[i].score >= rows[i - 1].score, `score fell in month ${i + 1}`);
});

test('a minimum-payer fills the card and autopay then pays the bills the card cannot take from chequing: no late bills while chequing covers them', async () => {
  const rows = await cardMonths('min');
  const last = rows.at(-1);
  assert.ok(last.card_owed > 100000, 'the card fills up');
  assert.ok(last.from_chequing > 0, 'some bills fell back to chequing');
  for (const r of rows) {
    assert.equal(r.late_bills, 0, `month ${r.i}`);
    assert.equal(r.unpaid, 0, `month ${r.i}`);
    assert.equal(r.late_marks, 0, `month ${r.i}`);
    assert.ok(r.chequing > 0);
  }
});

test('a card limit belongs to its season: after close and a new season there is no card in credit, so bills pays from chequing and charges nothing to the old card', async () => {
  const srv = await boot(setup(true, { order: ['bank-basic', 'jobs', 'credit', 'bills'], credit: true, jobs: fakeJobs(300000, 340000), bills: { startAfter: 'pay' } }));
  try {
    const { teacher, students: [s] } = await seeded(srv, 1, { transfers: false });
    const app = srv.app, card = () => app.ledger.balance(app.ledger.accountId('player', s.id, 'card'));
    app.world.advance({ months: 3 });
    assert.equal((await s.client.post('/api/credit/apply')).json.approved, true);
    assert.equal((await s.client.post('/api/bills/pay-from', { source: 'card' })).status, 200);
    app.world.advance({ months: 1 });
    const pay = async () => {
      const bill = (await s.client.get('/api/bills/state')).json.bills.find((b) => !b.paid);
      const before = app.ledger.balance(s.chequing.id);
      assert.equal((await s.client.post('/api/bills/pay', { id: bill.id })).status, 200);
      return before - app.ledger.balance(s.chequing.id) > 0;
    };
    assert.equal(await pay(), false, 'season 1: the card pays');
    assert.ok(card() < 0);
    assert.equal((await teacher.post('/api/teach/world/close', {})).status, 200);
    assert.equal(card(), 0);
    assert.equal((await teacher.post('/api/teach/world/create', { name: 'Season 2', season_start: '2027-02-01', season_end: '2027-06-30' })).status, 200);
    app.world.advance({ months: 3 });                                        // paid again, so billed again
    assert.equal(app.db.prepare('SELECT COUNT(*) AS n FROM credit_cards WHERE world_id = ?').get(app.world.current().id).n, 0);
    assert.equal((await s.client.get('/api/bills/state')).json.paying_from, 'chequing');
    assert.equal(await pay(), true, 'season 2: chequing pays');
    assert.equal(card(), 0, 'nothing charged to the old card');
    assert.equal(app.ledger.audit().ok, true);
  } finally { await srv.cleanup(); }
});

// A1: a bill is owed from the tick it is issued (ledger account 'payable'), so net worth, the boards and season results count every unpaid bill.
test('bills owed: a never-payer is never above an autopayer (board, savings, season results); owed = the unpaid rows every tick; paying moves chequing to owed; close resets it', async () => {
  const w = await world({ jobs: true, count: 2, extra: ['savings', 'leaderboards'], order: ['bank-basic', 'jobs', 'bills', 'savings', 'leaderboards'] });
  try {
    const [a, b] = w.students;
    const app = w.srv.app, db = app.db, sink = () => app.ledger.balance(app.ledger.system('sink'));
    assert.equal((await a.client.post('/api/bills/autopay', { enabled: true })).status, 200);
    const owes = (s) => { const id = app.ledger.accountId('player', s.id, 'payable'); return id ? 0 - app.ledger.balance(id) : 0; };
    const unpaid = (s, where = '1') => db.prepare(`SELECT COALESCE(SUM(amount), 0) AS n FROM bills_due WHERE player_id = ? AND world_id = ? AND paid_txn IS NULL AND ${where}`).get(s.id, app.world.current().id).n;
    const board = (s, m) => db.prepare('SELECT net_worth FROM leaderboards_snapshots WHERE player_id = ? AND month = ?').get(s.id, m).net_worth;
    const status = async (s) => (await s.client.get('/api/savings/status')).json;
    const gaps = [];
    for (let i = 0; i < 12; i++) {
      w.advance();
      const m = app.world.current().month;
      assert.equal(app.ledger.audit().ok, true, `month ${m}`);
      for (const s of [a, b]) assert.equal(owes(s), unpaid(s), `month ${m}: owed = the unpaid rows`);
      const st = await w.state(b);
      assert.deepEqual([st.owed_cents, st.overdue_cents], [owes(b), unpaid(b, 'late = 1')]);
      const [sa, sb] = [await status(a), await status(b)];
      assert.equal(sb.bills_owed_cents, -owes(b));
      assert.equal(db.prepare('SELECT net_worth FROM savings_snapshots WHERE player_id = ? AND month = ?').get(b.id, m).net_worth, board(b, m));
      assert.ok(board(b, m) <= board(a, m), `month ${m}: board ${board(b, m)} vs ${board(a, m)}`);
      assert.ok(sb.net_worth_cents <= sa.net_worth_cents, `month ${m}: savings ${sb.net_worth_cents} vs ${sa.net_worth_cents}`);
      gaps.push({ month: m, b_minus_a: board(b, m) - board(a, m), b_owed: owes(b), b_overdue: unpaid(b, 'late = 1') });
    }
    if (process.env.OWED_TABLE) console.table(gaps);
    assert.ok(gaps.some((g) => g.b_owed > 0) && gaps.at(-1).b_minus_a < 0, 'the never-payer falls behind by the late fees');
    assert.ok(db.prepare("SELECT COUNT(*) AS n FROM bills_due WHERE player_id = ? AND bill_id LIKE 'late-fee-%' AND owed_month IS NOT NULL").get(b.id).n > 0, 'fee lines are owed too');
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM txns t, json_each(t.meta, '$.dueIds') j WHERE t.kind = 'bills.owed' GROUP BY j.value HAVING n > 1").all().length, 0, 'each row is owed once');
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM bills_due WHERE owed_month IS NULL').get().n, 0);

    // Paying a late row: chequing -> owed; the sink got it at issue, so it does not move; net worth does not move.
    const row = db.prepare('SELECT * FROM bills_due WHERE player_id = ? AND late = 1 AND paid_txn IS NULL ORDER BY id LIMIT 1').get(b.id);
    const m = app.world.current().month;
    const [owed0, sink0, chq0, nw0] = [owes(b), sink(), w.bal(b), (await status(b)).net_worth_cents];
    assert.equal((await b.client.post('/api/bills/pay', { id: row.id })).status, 200);
    assert.deepEqual([owed0 - owes(b), sink() - sink0, chq0 - w.bal(b), (await status(b)).net_worth_cents - nw0], [row.amount, 0, row.amount, 0]);
    assert.equal(owes(b), unpaid(b));

    assert.equal((await w.teacher.post('/api/teach/world/close', {})).status, 200);
    const res = new Map(db.prepare('SELECT player_id, net_worth_cents FROM season_results').all().map((r) => [r.player_id, r.net_worth_cents]));
    assert.ok(res.get(b.id) <= res.get(a.id), `season results: ${res.get(b.id)} vs ${res.get(a.id)}`);
    assert.equal(res.get(b.id), board(b, m));                               // the board's number (paying moved no net worth)
    assert.deepEqual([owes(a), owes(b)], [0, 0], 'season close resets the owed account');
    assert.equal(app.ledger.audit().ok, true);
  } finally { await w.srv.cleanup(); }
});

test('bills owed: the sink receives each bill exactly once (at issue); payments go chequing -> owed; turning autopay on clears what is owed', async () => {
  const w = await world({ jobs: true, count: 2 });
  try {
    const [s, t] = w.students;
    const app = w.srv.app, db = app.db, sinkId = app.ledger.system('sink');
    assert.equal((await t.client.post('/api/bills/autopay', { enabled: true })).status, 200);
    w.advance(); w.advance(); w.advance();
    const acct = app.ledger.accountId('player', s.id, 'payable');
    assert.ok(app.ledger.balance(acct) < 0);
    assert.equal((await s.client.post('/api/bills/autopay', { enabled: true })).status, 200);
    w.advance();
    assert.equal(app.ledger.balance(acct), 0);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM bills_due WHERE paid_txn IS NULL').get().n, 0);
    const due = db.prepare('SELECT COALESCE(SUM(amount), 0) AS n FROM bills_due').get().n;
    const sunk = (kind) => db.prepare('SELECT COALESCE(SUM(e.amount_cents), 0) AS n FROM entries e JOIN txns t ON t.id = e.txn_id WHERE e.account_id = ? AND t.kind = ?').get(sinkId, kind).n;
    assert.equal(sunk('bills.owed'), due);
    assert.equal(sunk('bills.payment'), 0);
    const paidInto = db.prepare("SELECT COUNT(*) AS n FROM entries e JOIN txns t ON t.id = e.txn_id JOIN accounts a ON a.id = e.account_id WHERE t.kind = 'bills.payment' AND e.amount_cents > 0 AND a.kind <> 'payable'").get().n;
    assert.equal(paidInto, 0, 'every payment lands in the owed account');
    assert.equal(app.ledger.audit().ok, true);
  } finally { await w.srv.cleanup(); }
});

// A5: a 2+ month advance judges only what was due when it started, so nobody is late for a month they never got to play.
test('multi-month advance: bills issued during the advance are not late until the next advance; a single advance then marks them', async () => {
  const w = await world({ jobs: true, count: 1 });
  try {
    const [s] = w.students;
    const app = w.srv.app, db = app.db;
    const start = app.world.current().month;
    app.world.advance({ months: 2 });                                        // bills start at start+1 and would have been late at start+2
    const late = () => db.prepare('SELECT bill_id, due_month, late_month FROM bills_due WHERE player_id = ? AND late = 1 ORDER BY id').all(s.id);
    assert.ok(db.prepare('SELECT COUNT(*) AS n FROM bills_due WHERE player_id = ?').get(s.id).n > 0, 'bills were issued');
    assert.deepEqual(late(), []);
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM bills_due WHERE player_id = ? AND bill_id LIKE 'late-fee-%'").get(s.id).n, 0);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM bills_history WHERE player_id = ?').get(s.id).n, 0);
    w.advance();                                                              // one live month later: both months' unpaid bills are late now
    const now = app.world.current().month;
    const l = late();
    assert.ok(l.length > 0 && l.every((r) => r.due_month <= start + 2 && r.late_month === now));
    assert.deepEqual([...new Set(l.map((r) => r.due_month))], [start + 1, start + 2]);
    assert.ok(db.prepare("SELECT COUNT(*) AS n FROM bills_due WHERE player_id = ? AND bill_id LIKE 'late-fee-%' AND due_month = ?").get(s.id, now).n > 0);
    assert.equal(app.ledger.audit().ok, true);
  } finally { await w.srv.cleanup(); }
});

test('multi-month advances: a hand-payer who pays every live month matches an autopayer (on time, leaderboards, credit, outfitters streak); nobody is late', async () => {
  const config = JSON.parse(fs.readFileSync(path.join(ROOT, 'config', 'vdaa.json'), 'utf8'));
  config.options['bank-basic'].startCents = 50_000_000; config.options.bills.startAfter = 'login';
  const srv = await boot({ config });
  try {
    const { students: [hand, auto] } = await seeded(srv, 2, { transfers: false });
    const app = srv.app, db = app.db, wid = app.world.current().id;
    await auto.client.post('/api/bills/autopay', { enabled: true });
    for (const s of [hand, auto]) db.prepare('INSERT INTO credit_files (player_id, world_id, opened_month) VALUES (?, ?, 0)').run(s.id, wid);   // a file, so a score exists
    const score = (s) => db.prepare('SELECT score FROM credit_scores WHERE player_id = ? ORDER BY month DESC LIMIT 1').get(s.id)?.score;
    const ontimeMonths = (s) => db.prepare("SELECT month FROM credit_history WHERE player_id = ? AND source = 'bill' AND outcome = 'ontime' GROUP BY month ORDER BY month").all(s.id).map((r) => r.month);
    const ev = [];
    app.events.on('module.bills.paid', (p) => ev.push(p));
    for (let i = 0; i < 8; i++) {
      app.world.advance({ months: 2 });
      assert.equal((await hand.client.post('/api/bills/pay-all', {})).status, 200);
      const live = async (s) => (await s.client.get('/api/credit/state')).json.score.score;   // the score right now, after the hand-payer paid
      assert.equal(await live(hand), await live(auto), `same credit score after advance ${i + 1}`);
      assert.deepEqual(ontimeMonths(hand), ontimeMonths(auto), `same on-time months after advance ${i + 1}`);
    }
    // The score saved at a tick is computed before that tick's payments, so mid-advance it lags by the month the hand-payer has not paid yet;
    // once three on-time months fill the payment factor the saved scores are the same too.
    assert.equal(score(hand), score(auto));
    assert.ok(ev.length > 0 && ev.every((p) => p.onTime === true && Number.isInteger(p.dueMonth)), 'every payment on time, with its due month');
    for (const s of [hand, auto]) assert.equal(db.prepare('SELECT COUNT(*) AS n FROM bills_due WHERE player_id = ? AND late = 1').get(s.id).n, 0, 'no late marks');
    for (const s of [hand, auto]) assert.equal(db.prepare("SELECT COUNT(*) AS n FROM credit_history WHERE player_id = ? AND outcome = 'late'").get(s.id).n, 0);
    const lb = (s) => db.prepare('SELECT ontime FROM leaderboards_inputs WHERE player_id = ?').get(s.id)?.ontime;
    assert.ok(lb(auto) > 0);
    assert.equal(lb(hand), lb(auto), 'leaderboards on-time count');
    const streak = (s) => db.prepare('SELECT streak FROM outfitters_facts WHERE player_id = ?').get(s.id)?.streak;
    const unlocked = (s) => db.prepare("SELECT month FROM outfitters_unlocks WHERE player_id = ? AND key = 'ontime'").get(s.id)?.month;
    assert.equal(streak(hand), 6); assert.equal(streak(auto), 6);
    assert.ok(unlocked(auto) !== undefined);
    assert.equal(unlocked(hand), unlocked(auto), 'the On time watch unlocks at the same tick');
    assert.equal(app.ledger.audit().ok, true);
  } finally { await srv.cleanup(); }
});

test('new students start with autopay ON (onPlayer writes the row); a player with no row stays off; a student can turn it off; bills go late when off', async () => {
  const w = await world({ autopay: true });                                    // the real default: seeded() does not switch it off
  try {
    const [a, b, c] = w.students;
    const db = w.srv.app.db;
    assert.deepEqual(db.prepare('SELECT player_id, autopay FROM bills_settings ORDER BY player_id').all().map((r) => r.autopay), [1, 1, 1]);
    for (const s of w.students) { w.give(s, 500000); assert.equal((await w.state(s)).autopay, true); }
    db.prepare('DELETE FROM bills_settings WHERE player_id = ?').run(b.id);   // an existing player from before this change: no row = off, untouched
    assert.equal((await w.state(b)).autopay, false);
    assert.equal((await c.client.post('/api/bills/autopay', { enabled: false })).status, 200);   // c turns it off
    assert.equal((await w.state(c)).autopay, false);
    w.advance();                                                               // month 1: bills issued; a's autopay pays them at the tick
    const [sa, sb, sc] = [await w.state(a), await w.state(b), await w.state(c)];
    assert.ok(sa.bills.length > 0 && sa.bills.every((x) => x.paid), 'autopay on by default pays the bills');
    assert.ok(sb.bills.every((x) => !x.paid) && sc.bills.every((x) => !x.paid), 'no row and turned off: unpaid');
    w.advance();
    for (const s of [b, c]) {
      const st = await w.state(s);
      assert.ok(st.overdue_cents > 0, 'unpaid bills go late with autopay off');
      assert.ok(st.bills.some((x) => x.late), 'a late bill');
    }
    assert.equal((await w.state(a)).overdue_cents, 0);
    assert.equal(w.srv.app.ledger.audit().ok, true);
  } finally { await w.srv.cleanup(); }
});

test('onPlayer is idempotent and never flips an existing choice', async () => {
  const w = await world({ autopay: true, count: 1 });
  try {
    const [a] = w.students;
    const db = w.srv.app.db, k = w.srv.app.modules.kernel('bills');
    await a.client.post('/api/bills/autopay', { enabled: false });
    const hook = (await import('../modules/bills/index.js')).default.onPlayer;
    hook(k, { id: a.id });
    assert.equal((await w.state(a)).autopay, false, 'INSERT OR IGNORE: the chosen "off" stays');
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM bills_settings WHERE player_id = ?').get(a.id).n, 1);
  } finally { await w.srv.cleanup(); }
});
