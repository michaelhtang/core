// housing over a 48-year life (docs/phase5-life.md 5b, "As built (5b deps)"): a 25-year mortgage paid to exactly zero, and a sale followed by a second
// purchase. The real bank-basic, rates, housing, credit, bills and savings run; a fake `jobs` emits module.jobs.paid with a known gross (as in housing.test.js).
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

const fakeJobs = `import { defineModule } from '${MODULES_URL}';
export default defineModule({ id: 'jobs', requires: ['bank-basic'], onTick(k, { month, classes }) {
  for (const c of classes) for (const id of c.studentIds) {
    k.ledger.post({ kind: 'pay', legs: [{ account: k.ledger.system('mint'), cents: -400000 }, { account: k.ledger.accountId('player', id, 'chequing'), cents: 400000 }] });
    k.events.emit('paid', { playerId: id, worldId: k.world.current().id, month, net: 400000, gross: 450000 });
  }
} });`;
const BUY = { down_cents: 1010000, amort_years: 25 };   // the $202,000 condo, 5% down, 25 years

async function world() {
  const d = tmpDir(); made.push(d);
  for (const id of ['bank-basic', 'rates', 'housing', 'credit', 'bills', 'savings']) fs.symlinkSync(path.join(ROOT, 'modules', id), path.join(d, id));
  fs.mkdirSync(path.join(d, 'jobs')); fs.writeFileSync(path.join(d, 'jobs', 'index.js'), fakeJobs);
  const mods = ['bank-basic', 'rates', 'jobs', 'housing', 'credit', 'bills', 'savings'];
  const config = { courses: { fintech10: { label: 'x', modules: mods }, fintech2030: { label: 'y', modules: mods } }, options: { 'bank-basic': { startCents: 50000 }, bills: { startAfter: 'pay' }, rates: { inflationBp: 0 } } };
  const srv = await boot({ config, modulesDir: d });
  const t = await seeded(srv, 1, { transfers: false, autopay: true });
  const { app } = srv;
  const [s] = t.students;
  const give = (cents) => app.ledger.post({ kind: 'test.grant', legs: [{ account: app.ledger.system('mint'), cents: -cents }, { account: s.chequing.id, cents }] });
  const debt = () => { const a = app.ledger.accountId('player', s.id, 'mortgage'); return a ? 0 - app.ledger.balance(a) : 0; };
  const state = async () => (await s.client.get('/api/housing/state')).json;
  return { srv, app, s, give, debt, state };
}

for (const rates of [null, [225, 450, 125, 380, 600]]) test(`a 25-year mortgage pays to exactly zero${rates ? ' through five renewals at changing rates' : ''}: 300 payments, the last one is what is left, then the debits stop and the owner keeps paying property tax and condo fees`, async () => {
  const w = await world();
  try {
    w.app.world.advance({ months: 3 });                                                   // three months of pay: a lender can see income
    w.give(2000000);
    const bought = await w.s.client.post('/api/housing/buy', BUY);
    assert.equal(bought.status, 200, JSON.stringify(bought.json));
    const start = w.app.world.current().month, loan = bought.json.loan_cents;
    assert.equal(w.debt(), loan);
    // 26 years, a year at a time: the debt only ever goes down and never below zero, chequing never below zero
    let last = loan;
    for (let y = 0; y < 26; y++) {
      if (rates && y % 5 === 4) w.app.db.prepare('UPDATE rates_policy SET pending_bp = ?').run(rates[(y + 1) / 5 % rates.length]);   // a new policy rate before each 5-year renewal
      w.app.world.advance({ months: 12 });
      const d = w.debt();
      assert.ok(d >= 0 && d <= last, `year ${y + 1}: ${d} after ${last}`);
      assert.ok(w.app.ledger.balance(w.s.chequing.id) >= 0);
      last = d;
    }
    assert.equal(w.debt(), 0, 'paid off');
    const home = w.app.db.prepare("SELECT * FROM housing_homes WHERE player_id = ? AND status = 'owned'").get(w.s.id);
    const pays = w.app.db.prepare("SELECT month, interest_cents, principal_cents, balance_cents, status FROM housing_payments WHERE home_id = ? ORDER BY month").all(home.id);
    assert.equal(pays.length, 300, 'one payment a month for 25 years, no stub payment after');
    // renewed every 60 months (the check runs before that month's debit); the fifth lands on the last payment, over the 1 month left, so that payment is the balance
    const renewals = w.app.db.prepare('SELECT month, new_bp, new_payment, balance_cents FROM housing_renewals WHERE home_id = ? ORDER BY month').all(home.id);
    assert.deepEqual(renewals.map((r) => r.month - start), [60, 120, 180, 240, 300]);
    if (rates) assert.deepEqual(renewals.map((r) => r.new_bp), [450, 125, 380, 600, 225].map((bp) => bp + 195), 'each renewal at the 5-year rate of its day');
    assert.equal(renewals.at(-1).new_payment, pays.at(-1).principal_cents + pays.at(-1).interest_cents);
    assert.ok(pays.every((p) => p.status === 'paid'));
    assert.equal(pays[0].month, start + 1); assert.equal(pays.at(-1).month, start + 300);
    assert.equal(pays.reduce((t, p) => t + p.principal_cents, 0), loan, 'the principal paid adds up to the loan');
    const final = pays.at(-1), before = pays.at(-2);
    assert.equal(final.balance_cents, 0);
    assert.equal(final.principal_cents, before.balance_cents, 'the last payment is the balance that was left');
    assert.ok(final.principal_cents + final.interest_cents <= home.payment_cents || home.payment_cents === 0);
    assert.deepEqual([home.payment_cents, home.amort_left, home.arrears_cents], [0, 0, 0]);
    const debits = w.app.db.prepare("SELECT COUNT(*) AS n FROM txns WHERE kind = 'housing.mortgage_payment'").get().n;
    assert.equal(debits, 300);
    // the account stays at zero and is debited no more; the home's costs keep coming
    const after = w.app.world.current().month;
    w.app.world.advance({ months: 3 });
    assert.equal(w.debt(), 0);
    assert.equal(w.app.db.prepare("SELECT COUNT(*) AS n FROM txns WHERE kind = 'housing.mortgage_payment'").get().n, debits);
    const lines = w.app.db.prepare('SELECT name FROM bills_due WHERE player_id = ? AND due_month > ?').all(w.s.id, after).map((r) => r.name);
    for (const name of ['Property tax (Edmonton 2026)', 'Condo fees']) assert.equal(lines.filter((n) => n === name).length, 3, name);
    const st = await w.state();
    assert.deepEqual([st.tenure, st.home.balance_cents, st.home.next_principal_cents, st.home.schedule.length], ['own', 0, 0, 0]);
    assert.equal(st.home.equity_cents, st.home.value_cents);
    const a = w.app.ledger.audit(); assert.equal(a.ok, true, JSON.stringify(a.problems));
  } finally { await w.srv.cleanup(); }
});

test('sell, then buy again: the second purchase reuses the mortgage account, is not a first-time purchase (no 30 years insured), and pays as before', async () => {
  const w = await world();
  try {
    w.app.world.advance({ months: 3 });
    w.give(2000000);
    assert.equal((await w.s.client.post('/api/housing/buy', BUY)).status, 200);
    const mort = w.app.ledger.accountId('player', w.s.id, 'mortgage');
    w.app.world.advance({ months: 12 }); w.app.world.advance({ months: 12 });
    const sold = await w.s.client.post('/api/housing/sell');
    assert.equal(sold.status, 200, JSON.stringify(sold.json));
    assert.equal(w.debt(), 0, 'the sale paid the mortgage out');
    let st = await w.state();
    assert.deepEqual([st.tenure, st.home, st.past_homes.length], ['shared', null, 1]);
    assert.equal(st.buy.first_time, false);
    w.app.world.advance({ months: 2 });
    w.give(1000000);
    const thirty = await w.s.client.post('/api/housing/buy', { ...BUY, amort_years: 30 });
    assert.equal(thirty.status, 400); assert.match(thirty.json.error, /only for first-time buyers/);
    const again = await w.s.client.post('/api/housing/buy', BUY);
    assert.equal(again.status, 200, JSON.stringify(again.json));
    assert.equal(w.app.ledger.accountId('player', w.s.id, 'mortgage'), mort, 'the same mortgage account');
    assert.equal(w.debt(), again.json.loan_cents);
    w.app.world.advance({ months: 3 });
    st = await w.state();
    assert.equal(st.tenure, 'own');
    assert.equal(st.home.payments.filter((p) => p.status === 'paid').length, 3);
    assert.ok(w.debt() < again.json.loan_cents);
    assert.equal(w.app.db.prepare('SELECT COUNT(*) AS n FROM housing_homes WHERE player_id = ?').get(w.s.id).n, 2);
    const a = w.app.ledger.audit(); assert.equal(a.ok, true, JSON.stringify(a.problems));
  } finally { await w.srv.cleanup(); }
});
