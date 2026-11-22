// housing module (docs/phase2.md Wave 2b): renting and the damage deposit, buying and qualifying, the pre-authorized mortgage debit, NSF and
// arrears, renewal, selling, the market event, net worth, and what a season close does to homes. The real bank-basic, rates, bills, credit,
// savings and housing run; a fake `jobs` stands in for payroll (it emits module.jobs.paid with a known gross).
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { ROOT } from '../lib/app.js';
import { boot, seeded, tmpDir } from './helpers.js';
import { payment, interestFor, propertyTaxMonthly, closingCosts } from '../modules/housing/mortgage.js';

const MODULES_URL = pathToFileURL(path.join(ROOT, 'lib', 'modules.js')).href;
const made = [];
after(() => { for (const d of made) fs.rmSync(d, { recursive: true, force: true }); });

const GROSS = 450000;
const fakeJobs = (net) => `import { defineModule } from '${MODULES_URL}';
export default defineModule({ id: 'jobs', requires: ['bank-basic'], onTick(k, { month, classes }) {
  for (const c of classes) for (const id of c.studentIds) {
    k.ledger.post({ kind: 'pay', legs: [{ account: k.ledger.system('mint'), cents: -${net} }, { account: k.ledger.accountId('player', id, 'chequing'), cents: ${net} }] });
    k.events.emit('paid', { playerId: id, worldId: k.world.current().id, month, net: ${net}, gross: ${GROSS} });
  }
} });`;

function setup(net, options = {}) {
  const d = tmpDir(); made.push(d);
  for (const id of ['bank-basic', 'rates', 'housing', 'credit', 'bills', 'savings']) fs.symlinkSync(path.join(ROOT, 'modules', id), path.join(d, id));
  fs.mkdirSync(path.join(d, 'jobs')); fs.writeFileSync(path.join(d, 'jobs', 'index.js'), fakeJobs(net));
  const mods = ['bank-basic', 'rates', 'jobs', 'housing', 'credit', 'bills', 'savings'];
  return { config: { courses: { fintech10: { label: 'x', modules: mods }, fintech2030: { label: 'y', modules: mods } }, options: { 'bank-basic': { startCents: 50000 }, bills: { startAfter: 'pay' }, housing: options } }, modulesDir: d };
}

async function world({ net = 400000, count = 2, options = {} } = {}) {
  const srv = await boot(setup(net, options));
  const t = await seeded(srv, count, { transfers: false });
  const { app } = srv;
  const advance = (n = 1) => app.world.advance({ months: n });
  const give = (s, cents) => app.ledger.post({ kind: 'test.grant', legs: [{ account: app.ledger.system('mint'), cents: -cents }, { account: s.chequing.id, cents }] });
  const drain = (s) => { const b = app.ledger.balance(s.chequing.id); if (b > 0) app.ledger.post({ kind: 'test.drain', legs: [{ account: s.chequing.id, cents: -b }, { account: app.ledger.system('sink'), cents: b }] }); };
  const chq = (s) => app.ledger.balance(s.chequing.id);
  const acct = (s, kind) => { const a = app.ledger.accountId('player', s.id, kind); return a ? app.ledger.balance(a) : 0; };
  const state = async (s) => (await s.client.get('/api/housing/state')).json;
  const bills = async (s) => (await s.client.get('/api/bills/state')).json.bills;
  const audit = () => { const a = app.ledger.audit(); assert.equal(a.ok, true, JSON.stringify(a.problems)); };
  return { srv, app, ...t, advance, give, drain, chq, acct, state, bills, audit };
}
const BUY = { down_cents: 1010000, amort_years: 25 };        // $202,000 condo, 5% down (the minimum), 25 years

test('renting: the deposit is held now, rent replaces the catalogue rent from next month, moving out refunds it', async () => {
  const w = await world();
  try {
    const [a, b] = w.students;
    w.advance(2);                                                           // month 3: paid in months 2 and 3, so bills started
    const before = w.chq(a);
    const r = await a.client.post('/api/housing/tenure', { tenure: 'apt1' });
    assert.equal(r.status, 200, JSON.stringify(r.json));
    assert.equal(r.json.starts_month, 4);
    assert.equal(w.chq(a), before - 129000);                                // one month's rent, held now
    assert.equal(w.acct(a, 'deposit'), 129000);
    assert.equal((await w.state(a)).tenure, 'shared');                      // not yet: a move applies next month
    assert.equal((await a.client.post('/api/housing/tenure', { tenure: 'apt1' })).status, 200);   // asking again is harmless
    w.advance();
    const st = await w.state(a);
    assert.equal(st.tenure, 'apt1');
    const rows = await w.bills(a);
    assert.ok(rows.some((x) => x.bill_id === 'housing-rent' && x.amount === 129000 && x.due_month === 4));
    assert.ok(!rows.some((x) => x.bill_id === 'rent' && x.due_month === 4), 'catalogue rent is replaced');
    assert.ok((await w.bills(b)).some((x) => x.bill_id === 'rent' && x.due_month === 4), 'the other student keeps the catalogue rent');
    // moving to the 2-bedroom with a roommate: the deposit is topped down at the move, and a move out refunds the rest
    assert.equal((await a.client.post('/api/housing/tenure', { tenure: 'apt2-roommate' })).status, 200);
    w.advance();
    assert.equal(w.acct(a, 'deposit'), 81750);
    assert.equal((await a.client.post('/api/housing/tenure', { tenure: 'shared' })).status, 200);
    w.advance();
    assert.equal(w.acct(a, 'deposit'), 0);
    assert.equal((await a.client.post('/api/housing/tenure', { tenure: 'bogus' })).status, 400);
    w.audit();
  } finally { await w.srv.cleanup(); }
});

test('living with parents: a household contribution replaces rent with no deposit; the roommate tenure is half the 2-bedroom with a half deposit', async () => {
  const w = await world();
  try {
    const [a] = w.students;
    w.advance(2);
    const before = w.chq(a);
    const cat = (await w.state(a)).catalogue;
    assert.deepEqual(cat.map((c) => c.id), ['parents', 'shared', 'apt1', 'apt2', 'apt2-roommate']);
    assert.equal(cat.find((c) => c.id === 'apt2-roommate').rent_cents, cat.find((c) => c.id === 'apt2').rent_cents / 2);
    assert.equal(cat[4].name, '2-bedroom with a roommate');
    assert.equal((await a.client.post('/api/housing/tenure', { tenure: 'parents' })).status, 200);
    assert.equal(w.chq(a), before, 'no deposit for living at home');
    w.advance();
    assert.equal(w.acct(a, 'deposit'), 0);
    const rows = await w.bills(a);
    const line = rows.find((x) => x.bill_id === 'housing-rent' && x.due_month === 4);
    assert.equal(line.amount, 40000);
    assert.equal(line.category, 'needs');
    assert.match(line.name, /parents/);
    assert.ok(!rows.some((x) => x.bill_id === 'rent' && x.due_month === 4));
    w.audit();
  } finally { await w.srv.cleanup(); }
});

test('starter condo: a second property with its own price, fee and heating (in the fee); quote, buy and costs lines use it; config overrides both prices', async () => {
  const w = await world({ options: { starterPriceCents: 14000000 } });
  try {
    const [a] = w.students;
    w.advance(3);
    w.give(a, 2000000);
    const st0 = await w.state(a);
    assert.deepEqual(st0.buy.properties.map((p) => [p.id, p.price_cents, p.condo_fee_cents, p.heating_cents]), [['average', 20200000, 40000, 6000], ['starter', 14000000, 54600, 0]]);
    assert.equal(st0.buy.price_cents, 20200000, 'top level is still the average condo');
    assert.equal((await a.client.post('/api/housing/qualify', { ...BUY, property: 'mansion' })).status, 400);
    const q = (await a.client.post('/api/housing/qualify', { down_cents: 700000, amort_years: 25, property: 'starter' })).json;
    assert.equal(q.priceCents, 14000000);
    assert.equal(q.property, 'starter');
    assert.equal(q.ok, true, JSON.stringify(q.reasons));
    const r = await a.client.post('/api/housing/buy', { down_cents: 700000, amort_years: 25, property: 'starter' });
    assert.equal(r.status, 200, JSON.stringify(r.json));
    assert.equal(w.acct(a, 'mortgage'), -q.loanCents);
    w.advance();
    const st = await w.state(a);
    assert.equal(st.home.property, 'starter');
    assert.equal(st.buy, null);
    const due = Object.fromEntries((await w.bills(a)).filter((x) => x.due_month === 5).map((x) => [x.bill_id, x.amount]));
    assert.equal(due['housing-condo-fees'], 54600);
    assert.equal(due['housing-heating'], undefined, 'heat is in the fee');
    assert.equal(due['housing-property-tax'], propertyTaxMonthly(st.home.value_cents));
    w.audit();
  } finally { await w.srv.cleanup(); }
});

test('the deposit needs the money; an unaffordable move changes nothing', async () => {
  const w = await world();
  try {
    const [a] = w.students;
    w.drain(a);
    const r = await a.client.post('/api/housing/tenure', { tenure: 'apt1' });
    assert.equal(r.status, 400);
    assert.match(r.json.error, /damage deposit/);
    assert.equal((await w.state(a)).pending_tenure, null);
  } finally { await w.srv.cleanup(); }
});

test('qualifying: income, GDS and TDS with the stress test, reasons shown; the card minimum counts toward TDS', async () => {
  const w = await world();
  try {
    const [a] = w.students;
    const q0 = (await a.client.post('/api/housing/qualify', BUY)).json;
    assert.equal(q0.ok, false);                                             // no pay yet: lenders see no income
    assert.match(q0.reasons.join(' '), /income/);
    w.advance(3);                                                           // three months of $4,500 gross
    const q = (await a.client.post('/api/housing/qualify', BUY)).json;
    assert.equal(q.grossMonthlyCents, GROSS);
    assert.equal(q.premiumCents, 767600);
    assert.equal(q.loanCents, 19957600);
    assert.equal(q.qualifyingBp, 620);                                      // max(4.20 + 2, 5.25)
    assert.equal(q.qualifyingPaymentCents, payment(19957600, 620, 300));
    assert.equal(q.paymentCents, 107156);
    assert.ok(q.gds < 0.39 && q.tds < 0.44 && q.ok, JSON.stringify(q.reasons));
    // 5% on a thin margin: a $600 card minimum tips TDS over 44% while GDS still passes
    const card = w.app.db.prepare('INSERT INTO housing_card (player_id, world_id, minimum_cents, month) VALUES (?, ?, 60000, 3)');
    card.run(a.id, w.app.world.current().id);
    const tight = (await a.client.post('/api/housing/qualify', BUY)).json;
    assert.equal(tight.ok, false);
    assert.match(tight.reasons.join(' '), /TDS/);
    assert.doesNotMatch(tight.reasons.join(' '), /GDS/);
    assert.equal((await a.client.post('/api/housing/buy', BUY)).status, 400);
    assert.equal((await a.client.post('/api/housing/qualify', { down_cents: 1, amort_years: 25 })).json.reasons.some((r) => /minimum/.test(r)), true);
    assert.equal((await a.client.post('/api/housing/qualify', { down_cents: 1010000, amort_years: 20 })).status, 400);
  } finally { await w.srv.cleanup(); }
});

test('buying: closing costs, the ledger, the first debit splits interest and principal, costs lines replace rent, credit opens a file, net worth adds the home', async () => {
  const w = await world();
  try {
    const [a] = w.students;
    w.advance(3);
    w.give(a, 2000000);
    const cash = w.chq(a);
    const supply = w.app.ledger.audit().moneySupply;
    const r = await a.client.post('/api/housing/buy', BUY);
    assert.equal(r.status, 200, JSON.stringify(r.json));
    const closing = closingCosts(20200000, 19957600, 150000);
    assert.equal(closing, 150000 + 25500 + 25000);                          // legal + Land Titles on the transfer ($255) and on the mortgage ($250)
    assert.equal(w.chq(a), cash - 1010000 - closing);
    assert.equal(w.acct(a, 'mortgage'), -19957600);
    assert.equal(w.app.ledger.audit().moneySupply, supply);
    w.audit();
    let st = await w.state(a);
    assert.equal(st.tenure, 'own');
    assert.equal(st.home.payment_cents, 107156);
    // net worth right after buying: the premium and the closing costs are gone, everything else is the home's value; unpaid bills are owed
    const nw = (await a.client.get('/api/savings/status')).json;
    assert.equal(nw.home_value_cents, 20200000);
    assert.equal(nw.bills_owed_cents, -(await w.bills(a)).filter((x) => !x.paid).reduce((t, x) => t + x.amount, 0));
    assert.equal(nw.net_worth_cents, cash - 767600 - closing + nw.bills_owed_cents);
    assert.equal(nw.mortgage_cents, -19957600);

    w.advance();                                                            // month 5: the first debit
    const interest = interestFor(19957600, 420);
    assert.equal(interest, 69248);
    assert.equal(w.acct(a, 'mortgage'), -(19957600 - (107156 - interest)));
    st = await w.state(a);
    assert.equal(st.home.payments[0].interest_cents, 69248);
    assert.equal(st.home.payments[0].principal_cents, 37908);
    assert.equal(st.home.value_cents, Math.round(20200000 * 1.0025));       // +0.25% a month
    const lines = await w.bills(a);
    const due = Object.fromEntries(lines.filter((x) => x.due_month === 5).map((x) => [x.bill_id, x.amount]));
    assert.equal(due['housing-property-tax'], propertyTaxMonthly(st.home.value_cents));
    assert.deepEqual([due['housing-condo-fees'], due['housing-heating'], due['housing-home-insurance']], [40000, 6000, 3500]);
    assert.equal(due.rent, undefined);
    assert.equal(Object.keys(due).some((id) => /mortgage/.test(id)), false, 'the mortgage is a debit, not a bill');
    const ledgerKinds = w.app.db.prepare("SELECT kind FROM txns WHERE kind LIKE 'housing.%' ORDER BY id").all().map((x) => x.kind);
    assert.ok(ledgerKinds.includes('housing.mortgage_payment') && ledgerKinds.includes('housing.purchase'));
    assert.ok((await a.client.get('/api/credit/state')).json.score, 'a mortgage payment opens the credit file');
    const nw2 = (await a.client.get('/api/savings/status')).json;
    assert.equal(nw2.home_value_cents, st.home.value_cents);
    assert.equal((await a.client.post('/api/housing/buy', BUY)).status, 409);                   // one home at a time
    assert.equal((await a.client.post('/api/housing/tenure', { tenure: 'apt1' })).status, 409); // sell before you rent
    w.audit();
  } finally { await w.srv.cleanup(); }
});

test('a payment the account cannot cover is missed: interest is added, arrears, an NSF fee line, onTime false, a credit mark, a teacher warning after three; catch-up clears it', async () => {
  const w = await world({ net: 100 });
  try {
    const [a] = w.students;
    w.advance(3);
    w.give(a, 1300000);
    assert.equal((await a.client.post('/api/housing/buy', BUY)).status, 200);
    const events = [];
    w.app.events.on('module.housing.payment', (e) => events.push(e));
    w.drain(a);
    w.advance();                                                            // month 5: only $1.00 of pay in chequing
    let st = await w.state(a);
    assert.equal(st.home.arrears_cents, 107156);
    assert.equal(st.home.missed_streak, 1);
    assert.equal(st.home.balance_cents, 19957600 + 69248);                  // the month's interest was added to the debt
    assert.deepEqual(events.at(-1), { playerId: a.id, worldId: w.app.world.current().id, month: 5, onTime: false, amount: 107156, kind: 'mortgage', homeId: 1, role: 'primary', total: 107156 });
    assert.ok((await w.bills(a)).some((x) => x.bill_id === 'housing-nsf' && x.amount === 4500 && x.category === 'fees'));
    w.drain(a); w.advance(); w.drain(a); w.advance();
    st = await w.state(a);
    assert.equal(st.home.missed_streak, 3);
    assert.equal(st.home.arrears_cents, 3 * 107156);
    const t = (await w.teacher.get('/api/housing/teach')).json;
    assert.equal(t.warnings.length, 1);
    assert.equal(t.warnings[0].username, a.username);
    const late = w.app.db.prepare("SELECT COUNT(*) AS n FROM credit_history WHERE player_id = ? AND source = 'housing' AND outcome = 'late'").get(a.id).n;
    assert.equal(late, 3);
    w.audit();
    // catching up: needs the money, then it is all principal (the interest was already added)
    assert.equal((await a.client.post('/api/housing/catch-up')).status, 400);
    w.give(a, 3 * 107156 + 1000);
    assert.equal((await a.client.post('/api/housing/catch-up')).status, 200);
    st = await w.state(a);
    assert.equal(st.home.arrears_cents, 0);
    assert.equal((await a.client.post('/api/housing/catch-up')).status, 400);
    // the streak ends with the next debit that goes through
    w.give(a, 200000);
    w.advance();
    assert.equal((await w.state(a)).home.missed_streak, 0);
    assert.equal(events.at(-1).onTime, true);
    w.audit();
  } finally { await w.srv.cleanup(); }
});

test('renewal: at the end of the term the payment is recalculated at the new 5-year rate over the remaining amortization', async () => {
  const w = await world({ options: { termMonths: 2 } });
  try {
    const [a] = w.students;
    w.advance(3);
    w.give(a, 2000000);
    assert.equal((await a.client.post('/api/housing/buy', BUY)).status, 200);           // bought in month 4: term runs to month 6
    await w.teacher.post('/api/rates/policy', { policy_bp: 425 });                      // 4.25% + 1.95% = 6.20% from the next tick
    w.advance();                                                                        // month 5: the old rate, one payment made
    const debt = -w.acct(a, 'mortgage');
    assert.equal((await w.state(a)).home.renewals.length, 0);
    w.advance();                                                                        // month 6: renews first, then pays at the new rate
    const st = await w.state(a);
    assert.equal(st.mortgage_bp, 620);
    const ren = st.home.last_renewal;
    assert.deepEqual([ren.month, ren.old_bp, ren.new_bp, ren.old_payment, ren.balance_cents], [6, 420, 620, 107156, debt]);
    assert.equal(ren.new_payment, payment(debt, 620, 299));                              // 300 months at purchase, one tick since: 299 left
    assert.ok(ren.new_payment > ren.old_payment, 'a rate shock');
    assert.equal(st.home.payment_cents, ren.new_payment);
    assert.equal(st.home.renewal_month, 8);
    w.audit();
  } finally { await w.srv.cleanup(); }
});

test('selling: value less 4% commission and legal fees pays out the mortgage and the rest goes to chequing; back to a shared room', async () => {
  const w = await world();
  try {
    const [a] = w.students;
    w.advance(3);
    w.give(a, 2000000);
    assert.equal((await a.client.post('/api/housing/buy', BUY)).status, 200);
    w.advance(2);
    const st = await w.state(a);
    const sale = st.home.sale;
    assert.equal(sale.commission_cents, Math.round(st.home.value_cents * 0.04));
    assert.equal(sale.net_cents, st.home.value_cents - sale.commission_cents - 150000 - st.home.balance_cents);
    const before = w.chq(a);
    const r = await a.client.post('/api/housing/sell');
    assert.equal(r.status, 200, JSON.stringify(r.json));
    assert.equal(w.chq(a), before + sale.net_cents);
    assert.equal(w.acct(a, 'mortgage'), 0);
    const after = await w.state(a);
    assert.equal(after.home, null);
    assert.equal(after.tenure, 'shared');
    assert.equal((await a.client.get('/api/savings/status')).json.home_value_cents, 0);
    assert.equal((await a.client.post('/api/housing/sell')).status, 400);
    assert.equal(after.past_homes.length, 1);
    w.advance();                                                                        // no more debits, no more cost lines
    assert.equal((await w.bills(a)).some((x) => x.bill_id === 'housing-property-tax' && x.due_month === 7), false);
    w.audit();
  } finally { await w.srv.cleanup(); }
});

test('market event: the world teacher moves every home 5 to 15%; others cannot; students are refused', async () => {
  const w = await world();
  try {
    const [a, b] = w.students;
    w.advance(3);
    w.give(a, 2000000);
    assert.equal((await a.client.post('/api/housing/buy', BUY)).status, 200);
    assert.equal((await w.teacher.post('/api/housing/market', { pct: 3 })).status, 400);
    assert.equal((await w.teacher.post('/api/housing/market', { pct: 20 })).status, 400);
    assert.equal((await a.client.post('/api/housing/market', { pct: 10 })).status, 403);
    const r = await w.teacher.post('/api/housing/market', { pct: -10 });
    assert.equal(r.status, 200, JSON.stringify(r.json));
    assert.equal(r.json.homes, 1);
    assert.equal((await w.state(a)).home.value_cents, 18180000);
    assert.equal((await a.client.get('/api/savings/status')).json.home_value_cents, 18180000);   // savings heard it at once
    assert.equal((await w.teacher.get('/api/housing/teach')).json.events[0].pct, -10);
    assert.equal((await w.state(b)).home, null);
  } finally { await w.srv.cleanup(); }
});

test('the rent-vs-buy calculator answers with the student typed numbers and validates them', async () => {
  const w = await world();
  try {
    const [a] = w.students;
    const body = { price_cents: 20200000, down_cents: 1010000, rate_bp: 420, amort_years: 25, rent_cents: 129000, condo_fee_cents: 40000, heating_cents: 6000, insurance_cents: 3500, years: 5, drift_bp: 25, invest_bp: 275 };
    const r = await a.client.post('/api/housing/calc', body);
    assert.equal(r.status, 200, JSON.stringify(r.json));
    assert.equal(r.json.paymentCents, 107156);
    assert.ok(['buy', 'rent'].includes(r.json.cheaper));
    assert.equal(r.json.down_ok, true);
    assert.equal((await a.client.post('/api/housing/calc', { ...body, down_cents: 202000 })).json.down_ok, false);
    assert.equal((await a.client.post('/api/housing/calc', { ...body, years: 0 })).status, 400);
  } finally { await w.srv.cleanup(); }
});

test('season close: the home does not survive into the new season; the season result counts its value; the mortgage account is reset to zero', async () => {
  const w = await world();
  try {
    const [a] = w.students;
    w.advance(3);
    w.give(a, 2000000);
    assert.equal((await a.client.post('/api/housing/buy', BUY)).status, 200);
    w.advance();
    const home = (await w.state(a)).home;
    const worldId = w.app.world.current().id;
    const ledgerSum = w.app.db.prepare("SELECT SUM(balance_cents) AS n FROM accounts WHERE owner_type = 'player' AND owner_id = ?").get(a.id).n;
    assert.equal((await w.teacher.post('/api/teach/world/close')).status, 200);
    assert.equal(w.acct(a, 'mortgage'), 0);                                             // the core's season_reset zeroed it
    assert.equal(w.app.db.prepare("SELECT status FROM housing_homes WHERE player_id = ?").get(a.id).status, 'ended');
    assert.equal(w.app.db.prepare('SELECT net_worth_cents AS n FROM season_results WHERE world_id = ? AND player_id = ?').get(worldId, a.id).n, ledgerSum + home.value_cents);
    w.audit();
    assert.equal((await w.teacher.post('/api/teach/world/create', { name: 'S2', season_start: '2026-09-01', season_end: '2027-01-01' })).status, 200);
    const st = await w.state(a);
    assert.equal(st.home, null);                                                        // no owned home with no debt
    assert.equal(st.tenure, 'shared');
    assert.equal(st.buy.first_time, true);                                              // a new season is a fresh start
    assert.equal((await a.client.get('/api/savings/status')).json.home_value_cents, 0);
    w.advance();                                                                        // no phantom costs or debits for the old home
    assert.equal(w.acct(a, 'mortgage'), 0);
    assert.equal((await w.bills(a)).some((x) => /housing-/.test(x.bill_id)), false);
    w.audit();
  } finally { await w.srv.cleanup(); }
});

test('an announced policy rate is priced into new mortgages at once: buying before or after the tick gives the same rate, payment and stress test; cancelling restores today\'s pricing; a new season has none', async () => {
  const w = await world({ count: 3 });
  try {
    const [a, b, c] = w.students;
    const DOWN = { down_cents: 8000000, amort_years: 25 };
    w.advance(3);
    w.give(a, 9000000); w.give(b, 9000000);
    const quote = async (s) => (await s.client.post('/api/housing/qualify', DOWN)).json;
    const today = await quote(a);
    assert.deepEqual([today.contractBp, today.pricedIn, today.rateNote], [420, false, null]);
    assert.equal((await w.teacher.post('/api/rates/policy', { policy_bp: 500 })).status, 200);          // +275 bp from the next tick: 5.00% + 1.95% = 6.95%
    const qa = await quote(a);
    assert.deepEqual([qa.contractBp, qa.qualifyingBp, qa.pricedIn], [695, 895, true]);
    assert.match(qa.rateNote, /Lenders have already priced in the Bank of DAA's announced rate/);
    assert.equal((await w.state(a)).buy.mortgage_bp, 695, 'the offer on the Housing page is the announced rate too');
    assert.equal((await w.state(a)).mortgage_bp, 420, 'the rate in force (renewals) is unchanged until the tick');
    const ba = await a.client.post('/api/housing/buy', DOWN);
    assert.equal(ba.status, 200, JSON.stringify(ba.json));
    w.advance();
    const qb = await quote(b);
    assert.equal(qb.pricedIn, false);
    for (const key of ['contractBp', 'qualifyingBp', 'qualifyingPaymentCents', 'paymentCents', 'loanCents', 'ok']) assert.equal(qa[key], qb[key], key);
    assert.equal((await b.client.post('/api/housing/buy', DOWN)).status, 200);
    const homes = w.app.db.prepare('SELECT player_id, rate_bp, payment_cents FROM housing_homes ORDER BY player_id').all();
    assert.deepEqual(homes.map((h) => [h.rate_bp, h.payment_cents]), [[695, qa.paymentCents], [695, qa.paymentCents]], 'front-running saves nothing');
    // cancelling: queuing the rate in force again restores today's pricing
    await w.teacher.post('/api/rates/policy', { policy_bp: 225 });
    assert.deepEqual([(await quote(c)).contractBp, (await quote(c)).pricedIn], [420, true], 'a cut is priced in too');
    await w.teacher.post('/api/rates/policy', { policy_bp: 500 });                                         // the rate in force: cancels
    const back = await quote(c);
    assert.deepEqual([back.contractBp, back.pricedIn], [695, false]);
    assert.equal(w.app.db.prepare('SELECT COUNT(*) AS n FROM housing_rates_pending').get().n, 0);
    // a new season: a change queued at close is not carried over
    await w.teacher.post('/api/rates/policy', { policy_bp: 700 });
    assert.equal((await quote(c)).contractBp, 895);
    assert.equal((await w.teacher.post('/api/teach/world/close', {})).status, 200);
    assert.equal((await w.teacher.post('/api/teach/world/create', { name: 'Season 2', season_start: '2027-02-01', season_end: '2027-06-30' })).status, 200);
    const s2 = w.app.world.current().id;
    assert.equal(w.app.db.prepare('SELECT COUNT(*) AS n FROM housing_rates_pending WHERE world_id = ?').get(s2).n, 0);
    const fresh = await quote(c);
    assert.deepEqual([fresh.contractBp, fresh.pricedIn], [420, false]);
    w.audit();
  } finally { await w.srv.cleanup(); }
});
