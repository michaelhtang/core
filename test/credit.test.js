// credit module (docs/phase2.md Wave 2a): pure score maths, then the card and bureau over HTTP with fixture modules standing in for
// jobs (emits module.jobs.paid), bills (emits module.bills.paid/late from a route) and a shop (posts card purchases).
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { ROOT } from '../lib/app.js';
import { boot, seeded, tmpDir } from './helpers.js';
import { computeScore, paymentFactor, minimumPayment, statementInterest, payoff, decideCard } from '../modules/credit/score.js';
import { WEIGHTS } from '../modules/credit/constants.js';

const MODULES_URL = pathToFileURL(path.join(ROOT, 'lib', 'modules.js')).href;
const made = [];
after(() => { for (const d of made) fs.rmSync(d, { recursive: true, force: true }); });

const GROSS = 250000;
const FAKE_JOBS = `import { defineModule } from '${MODULES_URL}';
export default defineModule({ id: 'jobs', requires: ['bank-basic'], onTick(k, { month, classes }) {
  for (const c of classes) for (const id of c.studentIds) {
    k.ledger.post({ kind: 'pay', legs: [{ account: k.ledger.system('mint'), cents: -200000 }, { account: k.ledger.accountId('player', id, 'chequing'), cents: 200000 }] });
    k.events.emit('paid', { playerId: id, worldId: k.world.current().id, month, net: 200000, gross: ${GROSS} });
  }
} });`;
// Emits whatever bills events a test asks for: POST /api/bills/emit { name, billId, onTime, monthsLate }.
const FAKE_BILLS = `import { defineModule } from '${MODULES_URL}';
export default defineModule({ id: 'bills', requires: ['bank-basic'], routes: [{ method: 'POST', path: '/emit', access: 'student', handler(k, { user, body }) {
  const month = k.world.current().month;
  k.events.emit(body.name, body.name === 'late' ? { playerId: user.id, month, billId: body.billId, monthsLate: 1 } : { playerId: user.id, month, billId: body.billId, onTime: body.onTime, amount: 1000 });
  return { ok: true };
} }] });`;
const SHOP = `import { defineModule } from '${MODULES_URL}';
export default defineModule({ id: 'shop', requires: ['bank-basic'], routes: [{ method: 'POST', path: '/buy', access: 'student', handler(k, { user, body }) {
  const card = k.ledger.accountId('player', user.id, 'card');
  k.ledger.post({ kind: 'purchase', legs: [{ account: card, cents: -body.cents }, { account: k.ledger.system('sink'), cents: body.cents }] });
  return { ok: true };
} }] });`;

function setup({ withJobs = true } = {}) {
  const d = tmpDir(); made.push(d);
  for (const id of ['bank-basic', 'credit']) fs.symlinkSync(path.join(ROOT, 'modules', id), path.join(d, id));
  const fx = { jobs: FAKE_JOBS, bills: FAKE_BILLS, shop: SHOP };
  for (const [id, src] of Object.entries(fx)) { if (id === 'jobs' && !withJobs) continue; fs.mkdirSync(path.join(d, id)); fs.writeFileSync(path.join(d, id, 'index.js'), src); }
  const mods = ['bank-basic', ...(withJobs ? ['jobs'] : []), 'bills', 'credit', 'shop'];
  return { config: { courses: { fintech10: { label: 'x', modules: mods }, fintech2030: { label: 'y', modules: mods } }, options: { 'bank-basic': { startCents: 50000 } } }, modulesDir: d };
}

async function world(opts = {}) {
  const srv = await boot(setup(opts));
  const t = await seeded(srv, 3, { transfers: false });
  const advance = (n = 1) => srv.app.world.advance({ months: n });
  const state = async (s) => (await s.client.get('/api/credit/state')).json;
  const cardBal = (s) => srv.app.ledger.balance(srv.app.ledger.accountId('player', s.id, 'card'));
  const chq = (s) => srv.app.ledger.balance(s.chequing.id);
  const buy = (s, cents) => s.client.post('/api/shop/buy', { cents });
  const emit = (s, name, billId = 'rent', onTime = true) => s.client.post('/api/bills/emit', { name, billId, onTime });
  return { srv, ...t, advance, state, cardBal, chq, buy, emit };
}

test('pure maths: minimum, interest, payoff, decision, factors', () => {
  assert.equal(minimumPayment(100000), 3000);            // 3% of $1,000
  assert.equal(minimumPayment(20000), 1000);             // 3% = $6, floor $10
  assert.equal(minimumPayment(700), 700);                // never more than owed
  assert.equal(minimumPayment(0), 0);
  assert.equal(minimumPayment(33334), 1001);             // 3% = 1000.02 rounds up
  assert.equal(statementInterest(100000, 2099), 1749);   // 1000.00 x 20.99% / 12 = 17.4917 -> 17.49
  assert.equal(statementInterest(10, 2099), 0);
  const p = payoff({ balanceCents: 100000, aprBp: 2099 });
  assert.deepEqual(p, { months: 139, totalInterestCents: 110128, totalPaidCents: 210128 });
  assert.equal(payoff({ balanceCents: 100000, aprBp: 0 }).totalInterestCents, 0);
  assert.equal(payoff({ balanceCents: 100000, aprBp: 9000 }).months, null);        // interest outruns the minimum: never ends
  assert.ok(Math.abs(Object.values(WEIGHTS).reduce((a, b) => a + b, 0) - 1) < 1e-9);

  assert.equal(decideCard({ avgGrossCents: 50000, score: null, inquiries12: 0 }).approved, false);
  assert.match(decideCard({ avgGrossCents: 50000, score: null, inquiries12: 0 }).reasons[0], /Income/);
  assert.match(decideCard({ avgGrossCents: 300000, score: 500, inquiries12: 0 }).reasons[0], /Score/);
  assert.match(decideCard({ avgGrossCents: 300000, score: 700, inquiries12: 4 }).reasons[0], /Too many/);
  assert.equal(decideCard({ avgGrossCents: 250000, score: null, inquiries12: 0 }).limitCents, 120000);   // 50% of $2,500
  assert.equal(decideCard({ avgGrossCents: 250000, score: 800, inquiries12: 0 }).limitCents, 250000);    // 100%, at the cap
  assert.equal(decideCard({ avgGrossCents: 100000, score: null, inquiries12: 0 }).limitCents, 50000);    // floor $500
  assert.equal(decideCard({ avgGrossCents: 900000, score: 900, inquiries12: 0 }).limitCents, 250000);    // cap $2,500

  assert.equal(computeScore({ month: 5, file: null }), null);                       // no file, no score
  const file = { openedMonth: 1, inquiryMonths: [1], products: 1 };
  const base = computeScore({ month: 1, file, history: [], card: { owedCents: 0, limitCents: 100000 } });
  assert.ok(base.score >= 300 && base.score <= 900);
  assert.deepEqual(base.factors.map((f) => f.key), ['payment', 'utilization', 'length', 'new', 'mix']);
  assert.ok(base.factors.every((f) => f.sub >= 0 && f.sub <= 1 && f.tip && f.detail));
  const util = (owed) => computeScore({ month: 1, file, card: { owedCents: owed, limitCents: 100000 } }).score;
  assert.ok(util(0) >= util(30000) && util(30000) > util(60000) && util(60000) > util(100000));   // more utilization, lower score
  const hist = (n) => [{ month: 1, outcome: 'ontime', n: 3 }, { month: 2, outcome: 'ontime', n: 3 }, { month: 3, outcome: 'ontime', n: 3 }, ...(n ? [{ month: 3, outcome: 'late', n }] : [])];
  assert.ok(paymentFactor(hist(0), 3).sub === 1 && paymentFactor(hist(1), 3).sub === 0.75);
  assert.ok(paymentFactor(hist(1), 15).sub > paymentFactor(hist(1), 3).sub);        // a late mark fades
  assert.equal(paymentFactor(hist(1), 27).sub, 1);                                  // gone after 24 months
  assert.equal(paymentFactor(hist(9), 3).sub, 0.25);                                // at most 3 marks a month count
  assert.equal(computeScore({ month: 1, file: { ...file, inquiryMonths: [] }, card: null }).factors[3].sub, 1);
  assert.ok(computeScore({ month: 30, file: { ...file, inquiryMonths: [1] }, card: null }).factors[3].sub === 1);   // inquiry older than 12 months
  // a perfect file at 36+ months with every product reaches the top of the range
  const top = computeScore({ month: 60, file: { openedMonth: 1, inquiryMonths: [], products: 3 }, history: hist(0), card: { owedCents: 0, limitCents: 1 } });
  assert.equal(top.score, 900);
});

test('no file: score is null; a declined application is recorded but opens no file; income rules and reasons', async () => {
  const w = await world();
  try {
    const [a] = w.students;
    let st = await w.state(a);
    assert.equal(st.score, null);
    assert.match(st.no_file_message, /No credit history yet/);
    const r = await a.client.post('/api/credit/apply');
    assert.equal(r.json.approved, false);
    assert.match(r.json.reasons[0], /Income/);
    st = await w.state(a);
    assert.equal(st.score, null);                                           // a decline opens no file
    assert.equal(st.apply.last.approved, false);
    assert.equal(st.inquiries.length, 1);
    assert.equal(w.srv.app.ledger.accountId('player', a.id, 'card'), undefined);
    assert.equal((await a.client.post('/api/credit/pay', { mode: 'min' })).status, 400);   // no card
  } finally { await w.srv.cleanup(); }
});

test('approval: limit from 3 months of gross, card account may go negative, once only; teacher 403 for students', async () => {
  const w = await world();
  try {
    const [a] = w.students;
    w.advance(3);                                                           // pay in months 2, 3, 4: average gross is $2,500 over the window
    const r = await a.client.post('/api/credit/apply');
    assert.equal(r.status, 200, JSON.stringify(r.json));
    assert.equal(r.json.approved, true);
    assert.equal(r.json.limit_cents, 120000);                               // no file: 50% of $2,500, to the $100
    assert.equal((await a.client.post('/api/credit/apply')).status, 409);
    const acct = w.srv.app.ledger.account(w.srv.app.ledger.accountId('player', a.id, 'card'));
    assert.equal(acct.allow_negative, 1);
    assert.equal((await w.buy(a, 50000)).status, 200);                      // the card goes negative: money owed
    assert.equal(w.cardBal(a), -50000);
    const st = await w.state(a);
    assert.equal(st.card.owed_cents, 50000);
    assert.equal(st.card.available_cents, 70000);
    assert.equal(st.card.apr_bp, 2099);
    assert.ok(st.score.score >= 300 && st.score.factors.length === 5);
    assert.equal((await a.client.get('/api/credit/teach')).status, 403);
    const me = (await a.client.get('/api/me')).json;
    const panel = me.panels.find((p) => p.module === 'credit');
    assert.deepEqual([panel.building.key, panel.building.name], ['credit', 'Credit Bureau']);
    assert.equal((await fetch(w.srv.base + panel.src, { headers: { cookie: a.client.cookie() } })).status, 200);
    assert.equal(w.srv.app.ledger.audit().ok, true);
  } finally { await w.srv.cleanup(); }
});

test('statement, minimum, interest on the statement balance, on-time and late, in tick order', async () => {
  const w = await world();
  try {
    const [a, b] = w.students;
    w.advance(3);
    await a.client.post('/api/credit/apply'); await b.client.post('/api/credit/apply');
    const seen = [];
    w.srv.app.events.on('module.credit.score', (p) => seen.push(p));
    await w.buy(a, 100000); await w.buy(b, 100000);
    w.advance();                                                            // tick: statement of $1,000.00, minimum $30.00, due next tick
    let sa = (await w.state(a)).card.statement;
    assert.deepEqual([sa.balance_cents, sa.minimum_cents, sa.due_month, sa.paid_cents], [100000, 3000, sa.month + 1, 0]);
    assert.deepEqual(seen.map((s) => s.playerId).sort(), [a.id, b.id].sort());   // a score event per student with a file, each tick
    assert.equal(seen.length, 2);

    assert.equal((await a.client.post('/api/credit/pay', { mode: 'amount', cents: 10 })).status, 200);
    assert.equal((await a.client.post('/api/credit/pay', { mode: 'min' })).json.paid_cents, 2990);        // the minimum is $30; $0.10 already paid
    assert.equal((await a.client.post('/api/credit/pay', { mode: 'min' })).status, 400);                  // nothing left of it
    assert.equal((await a.client.post('/api/credit/pay', { mode: 'amount', cents: 999999 })).status, 400);  // more than owed
    assert.equal((await a.client.post('/api/credit/pay', { mode: 'amount', cents: 0 })).status, 400);
    assert.equal((await a.client.post('/api/credit/pay', { mode: 'wat' })).status, 400);

    w.advance();                                                            // next tick: a paid the minimum (no fee), b did not
    // a: owed 970.00 after paying 30.00; interest = floor(1000.00 x 20.99% / 12) = 17.49 on the WHOLE statement balance
    assert.equal(w.cardBal(a), -(100000 - 3000 + 1749));
    assert.equal(w.cardBal(b), -(100000 + 1749 + 2900));                    // unpaid minimum: interest AND the $29 late fee
    const hist = (await w.state(a)).card.statements[0];
    assert.deepEqual([hist.interest_cents, hist.fee_cents, hist.paid_cents], [1749, 0, 3000]);
    const sb = (await w.state(b)).card;
    assert.equal(sb.statements[0].fee_cents, 2900);
    assert.equal(sb.statement.balance_cents, 104649);                        // the new statement carries interest and the fee
    assert.equal(sb.statement.minimum_cents, 3140);                         // ceil(3% of 1,046.49)
    const late = w.srv.app.db.prepare("SELECT COUNT(*) AS n FROM credit_history WHERE player_id = ? AND outcome = 'late' AND source = 'card'").get(b.id).n;
    assert.equal(late, 1);
    assert.ok((await w.state(b)).score.score < (await w.state(a)).score.score);
    assert.equal(w.srv.app.ledger.audit().ok, true);
  } finally { await w.srv.cleanup(); }
});

// A5: a statement issued during a 2+ month advance is judged at the next advance, so the student gets a live month to pay its minimum.
test('multi-month advance: a statement issued during the advance is not judged (no fee, interest or late mark) until the next advance', async () => {
  const w = await world();
  try {
    const [a] = w.students;
    w.advance(3);
    await a.client.post('/api/credit/apply');
    await w.buy(a, 100000);
    const lates = () => w.srv.app.db.prepare("SELECT COUNT(*) AS n FROM credit_history WHERE player_id = ? AND outcome = 'late' AND source = 'card'").get(a.id).n;
    w.advance(2);                                                           // tick 1 issues the $1,000 statement; tick 2 must not judge it
    assert.equal(w.cardBal(a), -100000);
    assert.equal(lates(), 0);
    const st = (await w.state(a)).card.statement;
    assert.deepEqual([st.balance_cents, st.minimum_cents, st.month], [100000, 3000, w.srv.app.world.current().month - 1]);
    assert.equal(w.srv.app.db.prepare('SELECT COUNT(*) AS n FROM credit_statements WHERE player_id = ?').get(a.id).n, 1, 'no second statement while the first is open');
    w.advance();                                                            // one live month later, unpaid: judged as usual
    assert.equal(w.cardBal(a), -(100000 + 1749 + 2900));
    assert.equal(lates(), 1);
    assert.equal(w.srv.app.ledger.audit().ok, true);
  } finally { await w.srv.cleanup(); }
});

test('autopay: full pays everything owed at the tick (no statement, no interest), min pays the last statement\'s minimum (never late)', async () => {
  const w = await world();
  try {
    const [a, b, c] = w.students;
    w.advance(3);
    for (const s of w.students) await s.client.post('/api/credit/apply');
    assert.equal((await a.client.post('/api/credit/autopay', { mode: 'full' })).status, 200);
    assert.equal((await b.client.post('/api/credit/autopay', { mode: 'min' })).status, 200);
    assert.equal((await a.client.post('/api/credit/autopay', { mode: 'sometimes' })).status, 400);
    for (const s of w.students) await w.buy(s, 80000);
    const before = w.chq(a);
    w.advance();                                                            // full: pays the $800 owed now, so no statement is ever issued; min and none: statements of $800
    assert.equal(w.cardBal(a), 0);
    assert.equal(w.chq(a), before - 80000 + 200000);                        // paid $800 plus a month's pay
    assert.ok(!(await w.state(a)).card.statement);
    await w.buy(a, 5000);                                                   // a charge after credit's tick (what bills does)
    w.advance();                                                            // next tick: full clears it, no interest; min pays $24 of the $800
    assert.equal(w.cardBal(a), 0);
    assert.equal((await w.state(a)).card.statements.length, 0);
    assert.equal(w.cardBal(b), -(80000 - 2400 + statementInterest(80000, 2099)));   // min: $24 paid, interest on the whole $800
    assert.equal((await w.state(b)).card.statements[0].fee_cents, 0);
    assert.equal(w.cardBal(c), -(80000 + statementInterest(80000, 2099) + 2900));
    assert.equal((await w.state(a)).card.autopay, 'full');
  } finally { await w.srv.cleanup(); }
});

test('payment history from bills events: late marks lower the score and fade over 24 months; on-time months build it', async () => {
  const w = await world();
  try {
    const [a] = w.students;
    w.advance(3);
    await a.client.post('/api/credit/apply');
    const pay = async () => (await w.state(a)).score.factors.find((f) => f.key === 'payment');
    const p0 = await pay();
    for (const m of ['rent', 'phone', 'food']) await w.emit(a, 'paid', m, true);
    const p1 = await pay();
    assert.ok(p1.sub > p0.sub && p1.sub === 0.8);                          // one on-time month: 70% + 10%
    w.advance(); for (const m of ['rent', 'phone']) await w.emit(a, 'paid', m, true);
    w.advance(); await w.emit(a, 'paid', 'rent', true);
    assert.equal((await pay()).sub, 1);
    await w.emit(a, 'late', 'rent');
    await w.emit(a, 'late', 'rent');                                       // the same bill, same month: counted once
    await w.emit(a, 'paid', 'rent', false);                                // paid late: the late event already counted it
    assert.equal((await pay()).sub, 0.75);
    const hit = (await w.state(a)).score.score;
    w.advance(12);
    const later = await pay();
    assert.ok(later.sub > 0.75 && later.sub < 1);
    w.advance(12); w.advance(1);                                                       // 25 months after the late mark
    assert.equal((await pay()).sub, 1);
    assert.ok((await w.state(a)).score.score > hit);
  } finally { await w.srv.cleanup(); }
});

test('rates and housing events: card APR follows module.rates.changed; a mortgage payment opens a file and counts toward the mix', async () => {
  const w = await world();
  try {
    const [a, b] = w.students;
    w.advance(3);
    await a.client.post('/api/credit/apply');
    await w.buy(a, 100000);
    w.advance();
    w.srv.app.events.emit('module.rates.changed', { worldId: w.srv.app.world.current().id, month: 5, cardAprBp: 1999 });
    assert.equal((await w.state(a)).card.apr_bp, 1999);
    const before = w.cardBal(a);
    w.advance();
    assert.equal(w.cardBal(a), before - statementInterest(100000, 1999) - 2900, 'unpaid statement: interest at the new rate plus the fee');
    // housing: late payment mark; mortgage opens a file for a student who has no card
    w.srv.app.events.emit('module.housing.payment', { playerId: b.id, month: 5, onTime: true, amount: 100000, kind: 'mortgage' });
    const s = await w.state(b);
    assert.ok(s.score, 'a mortgage opens the file');
    assert.equal(s.score.factors.find((f) => f.key === 'mix').sub, 0.5);
    w.srv.app.events.emit('module.housing.payment', { playerId: b.id, month: 6, onTime: false, amount: 100000 });
    assert.ok((await w.state(b)).score.factors[0].sub < s.score.factors[0].sub);
  } finally { await w.srv.cleanup(); }
});

test('payoff calculator route; teacher overview (class-scoped, distribution, utilization, late counts)', async () => {
  const w = await world();
  try {
    const [a, b] = w.students;
    const r = await a.client.post('/api/credit/payoff', { balance_cents: 100000, apr_bp: 2099 });
    assert.deepEqual([r.json.months, r.json.totalInterestCents, r.json.first_minimum_cents, r.json.first_interest_cents], [139, 110128, 3000, 1749]);
    assert.equal((await a.client.post('/api/credit/payoff', { balance_cents: 0, apr_bp: 2099 })).status, 400);
    w.advance(3);
    await a.client.post('/api/credit/apply'); await b.client.post('/api/credit/apply');
    await w.buy(a, 60000);
    await w.emit(b, 'late', 'rent');
    const v = (await w.teacher.get('/api/credit/teach')).json;
    const cls = v.classes[0];
    assert.equal(cls.students.length, 3);
    assert.equal(cls.card_holders, 2);
    assert.equal(cls.late_students, 1);
    assert.equal(cls.distribution.find((d) => d.band === 'No file').count, 1);
    assert.equal(cls.distribution.reduce((t, d) => t + d.count, 0), 3);
    assert.ok(Math.abs(cls.avg_utilization - 0.25) < 1e-9);                // a: 600 of 1,200; b: 0
  } finally { await w.srv.cleanup(); }
});

test('without jobs or bills events: the module still boots and applications are declined for income', async () => {
  const w = await world({ withJobs: false });
  try {
    const [a] = w.students;
    w.advance(2);
    assert.equal((await a.client.post('/api/credit/apply')).json.approved, false);
  } finally { await w.srv.cleanup(); }
});
