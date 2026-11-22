// insurance module (docs/phase2.md Wave 2b): policies (buy/cancel next month), premiums and event expenses as bills lines, claims in the same tick,
// windfalls, the fairness caps, auto and condo cover from other modules' events, the teacher trigger. Real bank-basic + bills + insurance.
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from '../lib/app.js';
import { boot, seeded, addClass, tmpDir } from './helpers.js';
import { EVENTS, POLICIES } from '../modules/insurance/constants.js';

const made = [];
after(() => { for (const d of made) fs.rmSync(d, { recursive: true, force: true }); });

function setup(insurance = {}, order = ['bank-basic', 'insurance', 'bills']) {
  const d = tmpDir(); made.push(d);
  for (const id of ['bank-basic', 'bills', 'insurance']) fs.symlinkSync(path.join(ROOT, 'modules', id), path.join(d, id));
  const config = { courses: { fintech10: { label: 'x', modules: order }, fintech2030: { label: 'y', modules: order } }, options: { 'bank-basic': { startCents: 50000 }, insurance } };
  return { config, modulesDir: d };
}

// One class, `count` students, one tick already done: bills has announced them, so insurance sees them from the next tick.
async function world({ count = 2, insurance = {}, order } = {}) {
  const srv = await boot(setup(insurance, order));
  const t = await seeded(srv, count, { transfers: false });
  const app = srv.app;
  const advance = (n = 1) => app.world.advance({ months: n });
  const give = (s, cents) => app.ledger.post({ kind: 'test.grant', legs: [{ account: app.ledger.system('mint'), cents: -cents }, { account: s.chequing.id, cents }] });
  const bal = (s) => app.ledger.balance(s.chequing.id);
  const bills = async (s) => (await s.client.get('/api/bills/state')).json.bills;
  const state = async (s) => (await s.client.get('/api/insurance/state')).json;
  const trigger = (event, scope = 'town', class_id) => t.teacher.post('/api/insurance/trigger', { event, scope, ...(class_id ? { class_id } : {}) });
  for (const s of t.students) give(s, 1000000);
  advance();
  return { srv, app, ...t, advance, give, bal, bills, state, trigger };
}

const claimsOf = (w, s) => w.app.ledger.statement(s.chequing.id, { limit: 50 }).filter((e) => e.kind === 'insurance.claim');

test('catalogue sanity: every figure is marked illustrative, premiums and deductibles are positive integer cents, an event is covered only by known policies', () => {
  for (const p of POLICIES) { assert.ok(p.note.length > 20 && p.deductibleCents > 0); if (p.premiumCents !== null) assert.ok(Number.isSafeInteger(p.premiumCents) && p.premiumCents > 0); }
  const keys = new Set(POLICIES.map((p) => p.key));
  for (const e of EVENTS) { assert.ok(Number.isSafeInteger(e.amountCents) && e.amountCents > 0); assert.ok(e.covers.every((c) => keys.has(c))); }
  assert.deepEqual(EVENTS.map((e) => e.amountCents), [25000, 80000, 120000, 90000, 40000, 20000]);
  assert.deepEqual(POLICIES.filter((p) => p.buyable).map((p) => [p.key, p.premiumCents, p.deductibleCents]), [['tenant', 2000, 50000], ['phone', 1200, 10000]]);
});

test('worked example: tenant insurance, a burst pipe: the full bill, the premium, a claim of amount minus deductible in the same tick, net cost = deductible + premiums', async () => {
  const w = await world();
  try {
    const [a, b] = w.students;
    assert.equal((await a.client.post('/api/insurance/buy', { policy: 'tenant' })).status, 200);   // starts next month
    w.advance();                                                              // in force (and billed) from here; it pays for events landing from next month
    await a.client.post('/api/bills/pay-all'); await b.client.post('/api/bills/pay-all');
    const m = w.app.world.current().month + 1;
    assert.equal((await w.trigger('burst-pipe', 'town')).json.applies_from_month, m);
    const before = [w.bal(a), w.bal(b)];
    w.advance();
    const ba = await w.bills(a), bb = await w.bills(b);
    const pipeA = ba.find((x) => x.bill_id.startsWith('event-')), prem = ba.find((x) => x.bill_id === 'insurance-tenant' && x.due_month === m);
    assert.deepEqual([pipeA.name, pipeA.amount, pipeA.due_month], ['Burst pipe (contents damaged)', 120000, m]);
    assert.deepEqual([prem.name, prem.amount], ['Tenant insurance', 2000]);
    assert.equal(bb.find((x) => x.bill_id.startsWith('event-')).amount, 120000);
    assert.equal(bb.some((x) => x.bill_id === 'insurance-tenant'), false);
    // the claim: 120000 - 50000 = 70000, already in chequing (same tick), kind insurance.claim, mint -> chequing
    const [claim] = claimsOf(w, a);
    assert.equal(claim.amount_cents, 70000);
    assert.equal(w.bal(a) - before[0], 70000);
    assert.equal(claimsOf(w, b).length, 0);
    assert.equal(w.bal(b) - before[1], 0);
    const sa = await w.state(a);
    assert.deepEqual(sa.events.map((e) => [e.insured_by, e.amount, e.deductible, e.claim_cents, e.net_cents]), [['tenant', 120000, 50000, 70000, 50000]]);
    // both pay everything: the two students are otherwise identical, so the gap is the insurance: the premium minus the claim
    await a.client.post('/api/bills/pay-all'); await b.client.post('/api/bills/pay-all');
    assert.equal((before[0] - w.bal(a)) - (before[1] - w.bal(b)), 2000 - 70000);
    assert.deepEqual([sa.summary.uninsured_cost_cents, sa.summary.insured_cost_cents], [120000, 120000 - 70000 + 2 * 2000]);   // 54,000 with cover (two premiums) against 120,000 without
    assert.deepEqual((await w.state(a)).premium_history, [{ month: m, key: 'tenant', amount: 2000 }, { month: m - 1, key: 'tenant', amount: 2000 }]);
    assert.equal(w.app.ledger.audit().ok, true);
  } finally { await w.srv.cleanup(); }
});

// A1: the event bill is owed from the tick it is issued, the same tick the claim lands, so leaving it unpaid is never a profit.
test('an insured expense left unpaid: the bill is owed the same tick the claim lands; the event nets minus the deductible, never a gain', async () => {
  const w = await world();
  try {
    const [a] = w.students;
    const owes = () => 0 - w.app.ledger.balance(w.app.ledger.accountId('player', a.id, 'payable'));
    assert.equal((await a.client.post('/api/insurance/buy', { policy: 'tenant' })).status, 200);
    w.advance();                                                               // the tenant policy starts
    assert.equal((await w.trigger('burst-pipe', 'town')).status, 200);
    const [chq0, owed0] = [w.bal(a), owes()];
    w.advance();                                                               // the event: bill 120,000 owed, claim 70,000, same tick
    const pipe = (await w.bills(a)).find((x) => x.bill_id.startsWith('event-'));
    const owedFor = w.app.db.prepare("SELECT t.id FROM txns t, json_each(t.meta, '$.dueIds') j WHERE t.kind = 'bills.owed' AND j.value = ?").get(pipe.id);
    assert.ok(owedFor, 'the event bill is owed at issue');
    assert.equal(w.app.db.prepare('SELECT owed_month FROM bills_due WHERE id = ?').get(pipe.id).owed_month, w.app.world.current().month);
    const claim = claimsOf(w, a)[0].amount_cents;
    assert.equal(claim, 70000);
    assert.ok(owes() - owed0 >= pipe.amount, 'the debt is in the ledger');
    assert.equal(w.bal(a) - chq0, claim);                                      // unpaid: chequing moved only by the claim
    assert.ok(claim - pipe.amount <= 0);                                       // claim - bill = minus the deductible
    assert.equal(claim - pipe.amount, -50000);
    assert.equal(w.app.ledger.audit().ok, true);
  } finally { await w.srv.cleanup(); }
});

test('a claim is never negative: a deductible above the bill claims nothing and posts nothing; a phone policy does not cover a pipe', async () => {
  const w = await world({ insurance: { eventAmounts: { 'phone-screen': 5000 } } });
  try {
    const [a] = w.students;
    await a.client.post('/api/insurance/buy', { policy: 'phone' });
    w.advance();                                                              // the waiting period: it pays for events from next month
    await w.trigger('phone-screen');
    w.advance();
    const s = await w.state(a);
    assert.deepEqual(s.events.map((e) => [e.insured_by, e.amount, e.claim_cents, e.net_cents]), [['phone', 5000, 0, 5000]]);
    assert.equal(claimsOf(w, a).length, 0);
    w.advance(2);                                                             // month 4: the gap has passed
    await w.trigger('burst-pipe'); w.advance();
    assert.deepEqual((await w.state(a)).events[0].insured_by, null);
    assert.equal((await w.bills(a)).find((x) => x.amount === 120000 && x.bill_id.startsWith('event-')).paid, false);
  } finally { await w.srv.cleanup(); }
});

test('a windfall pays chequing from the mint (insurance.windfall), has no bill, and needs no policy', async () => {
  const w = await world();
  try {
    const [a] = w.students;
    const before = w.bal(a);
    await w.trigger('tax-refund');
    w.advance();
    assert.equal(w.bal(a), before + 20000);
    assert.equal(w.app.ledger.statement(a.chequing.id, { limit: 5 })[0].kind, 'insurance.windfall');
    assert.equal((await w.bills(a)).some((x) => x.bill_id.startsWith('event-')), false);
    assert.deepEqual((await w.state(a)).events.map((e) => [e.kind, e.amount, e.net_cents]), [['windfall', 20000, -20000]]);
    assert.equal(w.app.ledger.audit().ok, true);
  } finally { await w.srv.cleanup(); }
});

test('fairness: one event per student per 3 world months; a per-season dollar cap on expenses; the trigger records who was skipped and why', async () => {
  const w = await world({ count: 3, insurance: { seasonCapCents: 150000 } });
  try {
    const [a] = w.students;
    await w.trigger('laptop-theft');                                           // $900
    w.advance();                                                              // month 2
    await w.trigger('dental');                                                // too soon (gap 3: allowed from month 5)
    w.advance();                                                              // month 3
    w.advance();                                                              // month 4
    let ov = (await w.teacher.get('/api/insurance/overview')).json;
    assert.deepEqual(ov.triggers.map((t) => [t.name, t.applied, t.skipped_recent, t.skipped_cap]), [['Dental emergency', 0, 3, 0], ['Laptop stolen', 3, 0, 0]]);
    await w.trigger('burst-pipe');                                            // month 5 tick: gap ok (month 2 -> 5), but 900 + 1200 > 1500
    w.advance();
    ov = (await w.teacher.get('/api/insurance/overview')).json;
    assert.deepEqual([ov.triggers[0].applied, ov.triggers[0].skipped_recent, ov.triggers[0].skipped_cap], [0, 0, 3]);
    await w.trigger('phone-screen'); w.advance(3);                            // $250: 900 + 250 <= 1500, applies once the gap has passed
    assert.equal((await w.state(a)).events.length, 2);
    await w.trigger('tax-refund'); w.advance(3);                              // windfalls are not capped (and count as the one event in their window)
    assert.equal((await w.state(a)).events.length, 3);
    assert.ok(ov.caps.gap_months === 3 && ov.caps.season_cap_cents === 150000);
  } finally { await w.srv.cleanup(); }
});

test('scope: a class trigger hits only that class; the town trigger every billed student', async () => {
  const w = await world({ count: 2 });
  try {
    const other = await addClass(w.srv, w.teacher, 'Block 2', 2);
    for (const s of other.students) w.give(s, 1000000);
    w.advance();                                                              // the second class is billed and announced from here
    await w.trigger('dental', 'class', other.cls.id);
    w.advance();
    assert.deepEqual((await Promise.all(w.students.map(w.state))).map((s) => s.events.length), [0, 0]);
    assert.deepEqual((await Promise.all(other.students.map(w.state))).map((s) => s.events.length), [1, 1]);
    assert.equal((await w.trigger('dental', 'class', 99999)).status, 404);
    w.advance(3);
    await w.trigger('dental'); w.advance();
    assert.deepEqual((await Promise.all([...w.students, ...other.students].map(w.state))).map((s) => s.events.length), [1, 1, 2, 2]);   // the other class already had its first
  } finally { await w.srv.cleanup(); }
});

test('policies: buy and cancel take effect next month; double buy and cancelling what you do not have are 409; changing your mind before it ends resumes it', async () => {
  const w = await world();
  try {
    const [a] = w.students;
    const pol = async (k) => (await w.state(a)).policies.find((p) => p.key === k);
    const m = w.app.world.current().month;
    assert.equal((await a.client.post('/api/insurance/buy', { policy: 'phone' })).json.applies, 'next month');
    assert.deepEqual([(await pol('phone')).held, (await pol('phone')).starts_next_month], [false, true]);
    assert.equal((await a.client.post('/api/insurance/buy', { policy: 'phone' })).status, 409);
    assert.equal((await a.client.post('/api/insurance/cancel', { policy: 'tenant' })).status, 409);
    assert.equal((await a.client.post('/api/insurance/cancel', { policy: 'phone' })).status, 200);   // never started: gone, nothing billed
    assert.equal((await pol('phone')).starts_next_month, false);
    await a.client.post('/api/insurance/buy', { policy: 'phone' });
    w.advance(2);                                                             // held from m + 1; premium billed in m + 1 and m + 2
    assert.equal((await pol('phone')).held, true);
    assert.equal((await w.bills(a)).filter((x) => x.bill_id === 'insurance-phone').map((x) => x.due_month).join(), `${m + 1},${m + 2}`);
    assert.equal((await a.client.post('/api/insurance/cancel', { policy: 'phone' })).status, 200);
    assert.deepEqual([(await pol('phone')).held, (await pol('phone')).cancelling], [true, true]);    // still covered this month
    assert.equal((await a.client.post('/api/insurance/buy', { policy: 'phone' })).status, 200);       // changed their mind
    assert.equal((await pol('phone')).cancelling, false);
    await a.client.post('/api/insurance/cancel', { policy: 'phone' });
    w.advance();                                                              // not held, no premium line
    assert.equal((await pol('phone')).held, false);
    assert.equal((await w.bills(a)).some((x) => x.bill_id === 'insurance-phone' && x.due_month === m + 3), false);
    assert.equal((await a.client.post('/api/insurance/buy', { policy: 'auto' })).status, 400);
    assert.equal((await a.client.post('/api/insurance/buy', { policy: 'nope' })).status, 400);
  } finally { await w.srv.cleanup(); }
});

test('auto (car chosen in Bills) and condo (module.housing.value) cover come from events, are never billed twice, and pay their events', async () => {
  const w = await world();
  try {
    const [a, b] = w.students;
    await a.client.post('/api/bills/choice', { slot: 'transport', option: 'car' });   // announced via module.bills.choices (a is billed already)
    const auto = async (s) => (await w.state(s)).policies.find((p) => p.key === 'auto');
    const m = w.app.world.current().month;
    assert.deepEqual([(await auto(a)).held, (await auto(a)).starts_next_month, (await auto(a)).claims_from_month, (await auto(a)).premium_cents, (await auto(b)).held], [false, true, m + 2, 18000, false]);
    w.app.events.emit('module.housing.value', { playerId: b.id, homeValue: 20200000, mortgageBalance: 19000000 });
    assert.deepEqual([(await w.state(b)).policies.find((p) => p.key === 'condo').held, (await w.state(b)).policies.find((p) => p.key === 'condo').claims_from_month], [false, m + 2]);
    w.advance();                                                              // both in force from here, so they pay for events landing from next month
    w.app.events.emit('module.housing.value', { playerId: b.id, homeValue: 20300000, mortgageBalance: 18900000 });   // housing's monthly value: keeps the start
    assert.equal((await w.state(b)).policies.find((p) => p.key === 'condo').held, true);
    assert.equal((await auto(a)).held, true);
    await w.trigger('car-repair'); w.advance(3);                              // the gap (3 months) passes before the next event
    await w.trigger('burst-pipe'); w.advance();
    const sa = await w.state(a), sb = await w.state(b);
    assert.deepEqual(sa.events.map((e) => [e.name, e.insured_by, e.claim_cents]), [['Burst pipe (contents damaged)', null, 0], ['Car repair', 'auto', 30000]]);   // 800 - 500 deductible
    assert.deepEqual(sb.events.map((e) => [e.insured_by, e.claim_cents]), [['condo', 70000], [null, 0]]);
    assert.equal((await w.bills(a)).some((x) => x.bill_id.startsWith('insurance-')), false);   // no insurance line: bills' own Car insurance is the premium
    assert.equal(sa.summary.premiums_cents, 5 * 18000);                        // held from m + 1: months m + 1 .. m + 5                        // recorded for the history, never billed by insurance
    // selling the home ends condo cover
    w.app.events.emit('module.housing.value', { playerId: b.id, homeValue: 0, mortgageBalance: 0 });
    assert.equal((await w.state(b)).policies.find((p) => p.key === 'condo').held, false);
  } finally { await w.srv.cleanup(); }
});

test('teacher: only the world teacher triggers; bad input is a 400/404; the overview says who was insured and the totals; students see neither', async () => {
  const w = await world({ count: 3 });
  try {
    const [a, b, c] = w.students;
    await a.client.post('/api/insurance/buy', { policy: 'tenant' });
    w.advance();                                                              // in force for a whole month before the event lands
    for (const [body, status] of [[{ event: 'nope', scope: 'town' }, 400], [{ event: 'dental', scope: 'world' }, 400], [{ event: 'dental', scope: 'class' }, 400], [{ event: 'dental', scope: 'class', class_id: 12345 }, 404]]) assert.equal((await w.teacher.post('/api/insurance/trigger', body)).status, status, JSON.stringify(body));
    assert.equal((await a.client.post('/api/insurance/trigger', { event: 'dental', scope: 'town' })).status, 403);
    assert.equal((await a.client.get('/api/insurance/overview')).status, 403);
    assert.equal((await w.teacher.get('/api/insurance/state')).status, 403);
    await w.trigger('laptop-theft', 'class', w.cls.id);
    w.advance();
    const ov = (await w.teacher.get('/api/insurance/overview')).json;
    assert.equal(ov.can_trigger, true);
    assert.deepEqual(ov.events.map((e) => [e.student, e.insured_by, e.claim_cents, e.net_cents]).sort(), [[a.username, 'tenant', 40000, 50000], [b.username, null, 0, 90000], [c.username, null, 0, 90000]].sort());
    assert.deepEqual([ov.totals.expenses_cents, ov.totals.claims_cents, ov.totals.insured_events, ov.totals.uninsured_events, ov.totals.holders.tenant], [270000, 40000, 1, 2, 1]);
    assert.deepEqual(ov.triggers.map((t) => [t.scope, t.class, t.applied]), [['class', 'Block 1', 3]]);
  } finally { await w.srv.cleanup(); }
});

test('a trigger before bills has announced anyone lands on nobody (no claim for a bill that was never issued); random draws are off by default and obey the caps when on', async () => {
  const srv = await boot(setup());
  try {
    const t = await seeded(srv, 2, { transfers: false });
    await t.teacher.post('/api/insurance/trigger', { event: 'tax-refund', scope: 'town' });
    const before = srv.app.ledger.balance(t.students[0].chequing.id);
    srv.app.world.advance({ months: 1 });                                     // first billed tick: insurance runs before bills, so nobody is known yet
    assert.equal(srv.app.ledger.balance(t.students[0].chequing.id), before);
    assert.deepEqual((await t.teacher.get('/api/insurance/overview')).json.triggers.map((x) => x.applied), [0]);
    srv.app.world.advance({ months: 12 });
    assert.equal(srv.app.db.prepare('SELECT COUNT(*) AS n FROM insurance_events').get().n, 0, 'random events are off by default');
  } finally { await srv.cleanup(); }

  const w = await world({ count: 3, insurance: { randomEvents: true, randomChancePct: 100, seasonCapCents: 200000 } });
  try {
    w.advance(12);
    for (const s of w.students) {
      const ev = (await w.state(s)).events.slice().reverse();
      assert.ok(ev.length >= 2, `${ev.length} events`);
      for (let i = 1; i < ev.length; i++) assert.ok(ev[i].month - ev[i - 1].month >= 3, 'at least 3 months apart');
      assert.ok(ev.filter((e) => e.kind === 'expense').reduce((t, e) => t + e.amount, 0) <= 200000, 'season cap');
    }
    assert.equal(w.app.ledger.audit().ok, true);
  } finally { await w.srv.cleanup(); }
});

test('waiting period: a policy bought in month m pays nothing for an event queued in m (it lands at m+1), and pays for one landing at m+2; buying, claiming and cancelling in one go does not work', async () => {
  const w = await world({ insurance: { minGapMonths: 1 } });
  try {
    const [a] = w.students;
    const m = w.app.world.current().month;
    await a.client.post('/api/insurance/buy', { policy: 'tenant' });
    assert.equal((await w.state(a)).policies.find((p) => p.key === 'tenant').claims_from_month, m + 2);
    await w.trigger('burst-pipe');                                            // queued in m, lands at the m+1 tick
    w.advance();
    let ev = (await w.state(a)).events;
    assert.deepEqual(ev.map((e) => [e.month, e.insured_by, e.claim_cents]), [[m + 1, null, 0]]);
    assert.equal(claimsOf(w, a).length, 0);
    assert.equal((await w.bills(a)).some((x) => x.bill_id === 'insurance-tenant' && x.due_month === m + 1), true, 'the premium is billed from m+1 all the same');
    await w.trigger('laptop-theft');                                          // queued in m+1, lands at m+2: covered
    await a.client.post('/api/insurance/cancel', { policy: 'tenant' });       // cancelling now ends it at m+2, so it is not in force when the event lands
    w.advance();
    ev = (await w.state(a)).events;
    assert.deepEqual(ev[0].month, m + 2);
    assert.deepEqual([ev[0].insured_by, ev[0].claim_cents], [null, 0], 'cancelled before it landed: not covered');
    await a.client.post('/api/insurance/buy', { policy: 'tenant' });          // m+2: starts m+3, pays from m+4
    w.advance();
    await w.trigger('laptop-theft'); w.advance();                             // lands at m+4
    ev = (await w.state(a)).events;
    assert.deepEqual([ev[0].month, ev[0].insured_by, ev[0].claim_cents], [m + 4, 'tenant', 40000]);
    assert.equal(claimsOf(w, a).length, 1);
    assert.equal(w.app.ledger.audit().ok, true);
  } finally { await w.srv.cleanup(); }
});

test('random events are drawn from a per-world secret: the same secret gives the same events, another secret others; the secret is in no route response', async () => {
  const run = async (secret) => {
    const w = await world({ count: 4, insurance: { randomEvents: true, randomChancePct: 50, minGapMonths: 1, seasonCapCents: 10000000 } });
    try {
      if (secret) w.app.db.prepare('INSERT INTO insurance_secrets (world_id, secret) VALUES (?, ?)').run(w.app.world.current().id, secret);
      w.advance(12);
      const events = await Promise.all(w.students.map(async (s) => (await w.state(s)).events.map((e) => `${e.month}:${e.event_key}`).join()));
      const made = w.app.db.prepare('SELECT secret FROM insurance_secrets WHERE world_id = ?').get(w.app.world.current().id).secret;
      if (!secret) {
        assert.match(made, /^[0-9a-f]{32}$/);
        const [a] = w.students;
        const replies = [await w.state(a), (await w.teacher.get('/api/insurance/overview')).json, (await a.client.post('/api/insurance/buy', { policy: 'phone' })).json,
          (await a.client.post('/api/insurance/cancel', { policy: 'phone' })).json, (await w.trigger('dental')).json, (await a.client.get('/api/me')).json];
        for (const r of replies) assert.ok(!JSON.stringify(r).includes(made));
      }
      return events;
    } finally { await w.srv.cleanup(); }
  };
  const one = await run('secret-one'), again = await run('secret-one'), two = await run('secret-two');
  assert.deepEqual(again, one);
  assert.notDeepEqual(two, one);
  assert.ok(one.every((e) => e.length > 0));
  await run(null);
});

test('auto and condo cover have the same waiting period: switching to the car in the month a car repair is queued pays nothing, and the switcher is not better off; a student with a car for a while is paid', async () => {
  const w = await world({ count: 3 });
  try {
    const [a, b, c] = w.students;
    for (const s of [a, b]) await s.client.post('/api/bills/choice', { slot: 'transport', option: 'ets' });
    await c.client.post('/api/bills/choice', { slot: 'transport', option: 'car' });        // c has had the car since before the trigger month
    w.advance();
    for (const s of w.students) await s.client.post('/api/bills/pay-all');
    const before = [w.bal(a), w.bal(b)];
    await w.trigger('car-repair');                                                         // queued in m, lands at m+1
    await a.client.post('/api/bills/choice', { slot: 'transport', option: 'car' });        // a tries to game it
    w.advance();
    await a.client.post('/api/bills/choice', { slot: 'transport', option: 'ets' });        // and switches back
    for (const s of w.students) await s.client.post('/api/bills/pay-all');
    const ev = async (s) => (await w.state(s)).events.map((e) => [e.event_key, e.insured_by, e.claim_cents]);
    assert.deepEqual(await ev(a), [['car-repair', null, 0]]);
    assert.deepEqual(await ev(b), [['car-repair', null, 0]]);
    assert.deepEqual(await ev(c), [['car-repair', 'auto', 30000]]);
    assert.equal(claimsOf(w, a).length, 0);
    assert.ok(before[0] - w.bal(a) >= before[1] - w.bal(b), 'switching to the car for the event month did not pay');
    assert.equal((await w.state(a)).policies.find((p) => p.key === 'auto').claims_from_month, null, 'switching away ends cover');
    // condo: bought this month, covered for events from the month after next
    w.advance(2);
    w.app.events.emit('module.housing.value', { playerId: b.id, homeValue: 20200000, mortgageBalance: 19000000 });
    await w.trigger('burst-pipe'); w.advance();
    assert.deepEqual((await ev(b))[0], ['burst-pipe', null, 0]);
    assert.equal(w.app.ledger.audit().ok, true);
  } finally { await w.srv.cleanup(); }
});

test('a car chosen before the first billed tick is covered from that tick (its premium month); a switch later in the world waits a month', async () => {
  const srv = await boot(setup());
  try {
    const t = await seeded(srv, 2, { transfers: false });
    const app = srv.app, [a, b] = t.students;
    for (const s of t.students) app.ledger.post({ kind: 'test.grant', legs: [{ account: app.ledger.system('mint'), cents: -1000000 }, { account: s.chequing.id, cents: 1000000 }] });
    await a.client.post('/api/bills/choice', { slot: 'transport', option: 'car' });   // before bills has announced a: no event yet
    app.world.advance({ months: 1 });                                                 // M: the first billed tick announces a with the car
    const M = app.world.current().month;
    const auto = async (s) => (await s.client.get('/api/insurance/state')).json.policies.find((p) => p.key === 'auto');
    assert.deepEqual([(await auto(a)).held, (await auto(a)).claims_from_month], [true, M + 1]);
    await b.client.post('/api/bills/choice', { slot: 'transport', option: 'car' });   // a switch in M: starts M + 1, pays from M + 2
    assert.deepEqual([(await auto(b)).held, (await auto(b)).claims_from_month], [false, M + 2]);
    await t.teacher.post('/api/insurance/trigger', { event: 'car-repair', scope: 'town' });
    app.world.advance({ months: 1 });                                                 // lands at M + 1
    const ev = (s) => app.db.prepare('SELECT insured_by, claim_cents FROM insurance_events WHERE player_id = ?').all(s.id).map((e) => [e.insured_by, e.claim_cents]);
    assert.deepEqual(ev(a), [['auto', 30000]]);
    assert.deepEqual(ev(b), [[null, 0]]);
  } finally { await srv.cleanup(); }
});

test('upgrade: drivers and owners from before the cover-start columns keep their cover (migration backfill; housing.value fills a missing start)', async () => {
  const dataDir = tmpDir(); made.push(dataDir);
  const one = await boot({ ...setup(), dataDir });
  const t = await seeded(one, 2, { transfers: false });
  const [a, b] = t.students;
  for (const s of t.students) one.app.ledger.post({ kind: 'test.grant', legs: [{ account: one.app.ledger.system('mint'), cents: -1000000 }, { account: s.chequing.id, cents: 1000000 }] });
  one.app.world.advance({ months: 1 });
  await a.client.post('/api/bills/choice', { slot: 'transport', option: 'car' });
  one.app.events.emit('module.housing.value', { playerId: b.id, homeValue: 20200000, mortgageBalance: 19000000 });
  // the state an old database is in: the rows without the new columns' values, and the backfill not yet run
  one.app.db.exec("UPDATE insurance_players SET auto_world = NULL, auto_start = NULL, condo_start = NULL; DELETE FROM schema_migrations WHERE id = 'mod:insurance:005_cover_backfill'");
  await one.cleanup();
  const two = await boot({ ...setup(), dataDir });
  try {
    const app = two.app, w = app.world.current();
    const trigger = (key) => app.db.prepare("INSERT INTO insurance_triggers (world_id, event_key, scope, created_month, by_player) VALUES (?, ?, 'town', ?, 1)").run(w.id, key, app.world.current().month);
    const ev = (s) => app.db.prepare('SELECT event_key, insured_by, claim_cents FROM insurance_events WHERE player_id = ? ORDER BY id').all(s.id).map((e) => [e.event_key, e.insured_by, e.claim_cents]);
    trigger('car-repair'); app.world.advance({ months: 1 });                           // the next month: both already in force
    app.world.advance({ months: 3 });
    trigger('burst-pipe'); app.world.advance({ months: 1 });
    assert.deepEqual(ev(a), [['car-repair', 'auto', 30000], ['burst-pipe', null, 0]]);
    assert.deepEqual(ev(b), [['car-repair', null, 0], ['burst-pipe', 'condo', 70000]]);
    // defensive: a current owner whose start is missing gets one from housing's monthly value, still covered
    app.db.prepare('UPDATE insurance_players SET condo_start = NULL WHERE player_id = ?').run(b.id);
    app.events.emit('module.housing.value', { playerId: b.id, homeValue: 20300000, mortgageBalance: 18900000 });
    assert.equal(app.db.prepare('SELECT condo_start FROM insurance_players WHERE player_id = ?').get(b.id).condo_start, 0);
    assert.equal(app.ledger.audit().ok, true);
  } finally { await two.cleanup(); }
});
