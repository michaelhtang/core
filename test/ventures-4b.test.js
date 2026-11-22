// ventures wave 4b (docs/phase4.md): payroll through jobs from the treasury with the employer's CPP and EI (the same stub), a skipped payday,
// quitting after 2 misses (6c: the company job is part-time on top of the catalogue job, which is never left), layoffs (notice / pay in lieu),
// small business tax with losses carried forward, GST (voluntary, the
// threshold, ITCs, the quarterly return), the Venture Bank (amortisation, late fees, default and freeze, the teacher's resolutions), balance
// sheets that balance with liabilities, the season close settling loans, Best Employer, hire approval, and teacher B isolation.
import fs from 'node:fs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { boot } from './helpers.js';
import { loanPayment, loanDue, loanInterest, yearTax, gstOf } from '../modules/ventures/demand.js';
import { payStub, employerShare } from '../modules/jobs/payroll.js';
import { LOAN_LATE_FEE_CENTS, TAX_RATE_BP, GST_THRESHOLD_CENTS } from '../modules/ventures/constants.js';
import { POLICY_BP } from '../modules/rates/constants.js';

const config = () => {
  const c = JSON.parse(fs.readFileSync(new URL('../config/vdaa.json', import.meta.url), 'utf8'));
  for (const course of Object.values(c.courses)) course.modules = ['bank-basic', 'jobs', 'outfitters', 'ventures', 'leaderboards'];
  c.options['bank-basic'].startCents = 500000;
  c.options.ventures = { rentCents: 0 };   // 4a's storefront rent off: these tests check 4b's money to the cent (test/ventures.test.js covers rent)
  return c;
};
const PLAN = 'We sell drip coffee to students before class at about four dollars; break-even is 60 cups a month.';

async function world({ ft20 = 2, ft10 = 2 } = {}) {
  const srv = await boot({ config: config() });
  const { app } = srv;
  const teacher = srv.client();
  await teacher.post('/api/setup', { username: 'teacher', passphrase: 'correct horse battery' });
  const join = async (course, count, name, who = teacher) => {
    const cls = (await who.post('/api/teach/classes', { name, course })).json;
    const made = (await who.post(`/api/teach/classes/${cls.id}/students`, { count })).json.students;
    const out = [];
    for (const s of made) {
      const c = srv.client();
      await c.post('/api/login', { username: s.username, secret: s.pin });
      out.push({ ...s, client: c, id: (await c.get('/api/me')).json.user.id });
    }
    return { cls, students: out };
  };
  const a = await join('fintech2030', ft20, 'FT30 block');
  const b = ft10 ? await join('fintech10', ft10, 'FT10 block') : { students: [] };
  app.db.prepare("INSERT OR IGNORE INTO ventures_secrets (world_id, secret) VALUES (?, 'test-secret')").run(app.world.current().id);
  const post = (s, p, body = {}) => s.client.post(`/api/ventures${p}`, body);
  const tpost = (p, body = {}, who = teacher) => who.post(`/api/ventures${p}`, body);
  const chq = (s) => app.ledger.balance(app.ledger.accountId('player', s.id, 'chequing'));
  const treasury = (id) => app.ledger.balance(app.ledger.accountId('business', id, 'treasury'));
  const owed = (id) => { const l = app.ledger.accountId('business', id, 'loan'); return l ? -app.ledger.balance(l) || 0 : 0; };
  const audit = () => { const r = app.ledger.audit(); assert.equal(r.ok, true, JSON.stringify(r.problems)); };
  const advance = (n = 1) => app.world.advance({ months: n });
  const month = () => app.world.current().month;
  const statements = (id) => app.db.prepare('SELECT data FROM ventures_statements WHERE company_id = ? ORDER BY month').all(id).map((r) => JSON.parse(r.data));
  const booksOk = (id) => { for (const s of statements(id)) { assert.equal(s.balance.balanced, true, `month ${s.month} balance ${JSON.stringify(s.balance)}`); assert.equal(s.cashflow.reconciled, true, `month ${s.month} cash ${JSON.stringify(s.cashflow)}`); } };
  const one = (sql, ...p) => app.db.prepare(sql).get(...p);
  const drain = (id) => { const t = treasury(id); if (t > 0) app.ledger.post({ kind: 'test.drain', legs: [{ account: app.ledger.accountId('business', id, 'treasury'), cents: -t }, { account: app.ledger.system('sink'), cents: t }] });
    // booked as a distribution, so the company's books still balance (a test stand-in for spending the treasury)
    app.db.prepare('INSERT INTO ventures_flows (company_id, product_id, month, payout_cents) VALUES (?, 0, ?, ?) ON CONFLICT (company_id, product_id, month) DO UPDATE SET payout_cents = payout_cents + excluded.payout_cents').run(id, month(), t); };
  async function found(lead, mates, { name = 'Bean There', sector = 'Food and drink', capital = 20000 } = {}) {
    const r = await post(lead, '/register', { name, sector, plan: PLAN, cofounders: mates.map((m) => m.username).join(', ') });
    assert.equal(r.status, 200, JSON.stringify(r.json));
    for (const m of mates) assert.equal((await post(m, '/respond', { id: r.json.id, accept: true })).status, 200);
    assert.equal((await tpost('/approve', { id: r.json.id, approve: true })).status, 200);
    for (const s of [lead, ...mates]) assert.equal((await post(s, '/capital', { id: r.json.id, cents: capital })).status, 200);
    return r.json.id;
  }
  // a founder posts a job, the student applies from the board, the founder approves
  async function hire(lead, id, kid, { title = 'Barista', hourly = 1600, hours = 10, slots } = {}) {
    const p = await post(lead, '/post-job', { id, title, hourly_cents: hourly, hours, slots });
    assert.equal(p.status, 200, JSON.stringify(p.json));
    const ap = await kid.client.post('/api/ventures/apply', { posting_id: p.json.posting_id });
    assert.equal(ap.status, 200, JSON.stringify(ap.json));
    const h = await post(lead, '/hire', { id, application_id: ap.json.application_id, approve: true });
    assert.equal(h.status, 200, JSON.stringify(h.json));
    return { posting: p.json.posting_id, application: ap.json.application_id, status: h.json.status };
  }
  async function teacherB() {
    const b = srv.client();
    const invite = (await teacher.post('/api/teach/invites')).json;
    assert.equal((await b.post('/api/teach/join', { token: new URL(invite.url).searchParams.get('invite'), username: 'teacherB', passphrase: 'another long passphrase' })).status, 200);
    return b;
  }
  return { srv, app, teacher, ft20: a.students, ft10: b.students, post, tpost, chq, treasury, owed, audit, advance, month, statements, booksOk, one, drain, found, hire, teacherB, cleanup: () => srv.cleanup() };
}

test('maths: loan amortisation, tax with a loss carried forward, GST, the employer share', () => {
  const pay = loanPayment(500000, 550, 12);
  let bal = 500000, interest = 0;
  for (let n = 0; n < 12; n++) { const d = loanDue(bal, 550, pay, n === 11); interest += d.interest; bal -= d.principal; }
  assert.equal(bal, 0, 'twelve payments clear the loan, the last one carrying the rounding');
  assert.ok(interest > 0 && interest < pay * 12 - 500000 + 12);
  assert.equal(loanInterest(120000, 1200), 1200, '12% a year on $1,200 is $12 a month');
  assert.deepEqual(yearTax(-30000, 0, TAX_RATE_BP), { applied: 0, taxable: 0, tax: 0, lossAfter: 30000 });
  assert.deepEqual(yearTax(100000, 30000, TAX_RATE_BP), { applied: 30000, taxable: 70000, tax: 7700, lossAfter: 0 });
  assert.deepEqual(yearTax(20000, 30000, TAX_RATE_BP), { applied: 20000, taxable: 0, tax: 0, lossAfter: 10000 });
  assert.equal(TAX_RATE_BP, 1100);
  assert.equal(gstOf(400, 500), 20);
  const s = payStub({ grossCents: 250000, period: 1 });
  assert.deepEqual(employerShare(s), { cpp: s.cpp + s.cpp2, ei: Math.round(s.ei * 1.4) });
});

test('payroll: a business job is part-time on top of the catalogue job; payday pays gross + employer CPP and EI from the treasury (nothing minted) with the same T4127 stub', async () => {
  const x = await world();
  try {
    const [lead, m1] = x.ft20, [kid, kid2] = x.ft10;
    const id = await x.found(lead, [m1]);
    for (const k of [kid, kid2]) assert.equal((await k.client.post('/api/jobs/pick', { job_id: 4 })).status, 200);
    // the board lists the company's job beside the catalogue, with the company's name
    assert.match((await x.post(lead, '/post-job', { id, title: 'Too cheap', hourly_cents: 1499, hours: 10 })).json.error, /minimum wage/);
    assert.match((await x.post(lead, '/post-job', { id, title: 'Barista', hourly_cents: 1600, hours: 5 })).json.error, /10 to 40/);
    assert.match((await x.post(lead, '/post-job', { id, title: 'Barista', hourly_cents: 1600, hours: 41 })).json.error, /10 to 40/);
    assert.equal((await x.post(kid, '/post-job', { id, title: 'Barista', hourly_cents: 1600, hours: 10 })).status, 404, 'only founders post');
    const { status } = await x.hire(lead, id, kid, { slots: 2 });
    assert.equal(status, 'hired');
    const board = (await kid2.client.get('/api/ventures/openings')).json.openings;
    assert.deepEqual(board.map((o) => [o.company, o.title, o.gross_cents, o.slots, o.filled]), [['Bean There', 'Barista', 16000, 2, 1]], 'one of two places left');
    const cat = (await kid.client.get('/api/jobs/catalogue')).json;
    assert.equal(cat.current.title, 'Retail associate', 'the catalogue job is kept');
    assert.deepEqual(cat.business.map((b) => [b.employer, b.title, b.gross_cents]), [['Bean There', 'Barista', 16000]]);
    assert.equal(x.one('SELECT COUNT(*) AS n FROM jobs_holdings WHERE player_id = ?', kid.id).n, 1);
    const [t0, c0, supply0] = [x.treasury(id), x.chq(kid), x.app.ledger.audit().moneySupply];
    x.advance();
    const s = payStub({ grossCents: 16000, period: 2 }), er = employerShare(s);
    assert.equal(t0 - x.treasury(id), 16000 + er.cpp + er.ei, 'gross + employer CPP (= employee) + employer EI (1.4 x)');
    const cat2 = x.one('SELECT net FROM jobs_paystubs WHERE player_id = ? AND month = 2 AND business_id IS NULL', kid.id).net;
    assert.equal(x.chq(kid) - c0, s.net + cat2, 'both pays: the catalogue job and the company job');
    const stub = x.one('SELECT * FROM jobs_paystubs WHERE player_id = ? AND month = 2 AND business_id = ?', kid.id, id);
    assert.equal(x.one('SELECT kind FROM txns WHERE id = ?', stub.txn_id).kind, 'ventures.payroll', 'paid by the company, not minted');
    // the money supply grew only by the catalogue pays (minted), not by the business pay
    const minted = x.one('SELECT SUM(gross) AS n FROM jobs_paystubs WHERE month = 2 AND business_id IS NULL').n;
    assert.equal(x.app.ledger.audit().moneySupply - supply0, minted);
    // the stub: identical fields to a catalogue stub, with the employer's name
    const ids = (await kid.client.get('/api/jobs/stubs')).json.stubs.filter((q) => q.employer === 'Bean There'), ids2 = (await kid2.client.get('/api/jobs/stubs')).json.stubs;
    const view = (await kid.client.get(`/api/jobs/stubs/${ids[0].id}`)).json, view2 = (await kid2.client.get(`/api/jobs/stubs/${ids2[0].id}`)).json;
    assert.deepEqual(Object.keys(view).sort(), Object.keys(view2).sort());
    assert.deepEqual([view.job.employer, view.job.title, view.gross, view.cpp, view.cpp2, view.ei, view.federal_tax, view.alberta_tax, view.net],
      ['Bean There', 'Barista', s.gross, s.cpp, s.cpp2, s.ei, s.federalTax, s.albertaTax, s.net]);
    // the books: wages and the employer's contributions on month 1 (the work paid for at the month-2 payday), balanced
    const st = x.statements(id).find((q) => q.month === 1);
    assert.equal(st.income.wages_cents, 16000); assert.equal(st.income.employer_cents, er.cpp + er.ei);
    assert.equal(st.income.net_cents, -(16000 + er.cpp + er.ei));
    x.booksOk(id);
    // a second advance pays again, with the year to date of every stub before this month carried (both sources: each stub is taxed on its own period)
    x.advance();
    const ytd = x.one('SELECT SUM(gross) AS gross, SUM(cpp) AS cpp, SUM(cpp2) AS cpp2, SUM(ei) AS ei, SUM(federal_tax) AS federalTax, SUM(alberta_tax) AS albertaTax, SUM(net) AS net FROM jobs_paystubs WHERE player_id = ? AND month = 2', kid.id);
    const s2 = payStub({ grossCents: 16000, period: 3, ytd: { ...ytd } });
    assert.equal(x.one('SELECT net FROM jobs_paystubs WHERE player_id = ? AND month = 3 AND business_id = ?', kid.id, id).net, s2.net);
    assert.equal(x.one('SELECT paydays FROM ventures_companies WHERE id = ?', id).paydays, 2);
    // founders may employ themselves
    assert.equal((await x.hire(lead, id, m1, { title: 'Manager', hourly: 2000, hours: 20 })).status, 'hired');
    assert.equal((await x.teacher.get('/api/ventures/teach')).json.classes[0].companies[0].staff, 2);
    x.audit();
  } finally { await x.cleanup(); }
});

test('missed payroll: a short treasury skips the pay (no stub, unpaid notice, reputation); after 2 misses the board says the student may quit it, and the catalogue job was never left', async () => {
  const x = await world({ ft20: 2, ft10: 1 });
  try {
    const [lead, m1] = x.ft20, [kid] = x.ft10;
    const id = await x.found(lead, [m1]);
    await kid.client.post('/api/jobs/pick', { job_id: 4 });
    x.app.db.prepare('UPDATE jobs_holdings SET wage_cents = 1800 WHERE player_id = ?').run(kid.id);   // a raise earned on the catalogue job
    await x.hire(lead, id, kid, { title: 'Big job', hourly: 5000, hours: 40 });                        // $2,000 a month: the $400 treasury cannot pay
    const unpaid = [];
    const off = x.app.events.on('module.jobs.unpaid', (p) => unpaid.push(p));
    const t0 = x.treasury(id);
    x.advance();
    assert.equal(x.one('SELECT COUNT(*) AS n FROM jobs_paystubs WHERE player_id = ? AND business_id IS NOT NULL', kid.id).n, 0, 'no pay, no stub');
    assert.equal(x.one('SELECT gross FROM jobs_paystubs WHERE player_id = ? AND month = 2 AND business_id IS NULL', kid.id).gross, 1800 * 132, 'the catalogue job pays as usual');
    assert.equal(x.treasury(id), t0, 'nothing paid');
    assert.deepEqual(unpaid.map((u) => [u.playerId, u.employer, u.missed]), [[kid.id, 'Bean There', 1]]);
    assert.equal(x.one('SELECT rep_bp, missed_paydays FROM ventures_companies WHERE id = ?', id).rep_bp, 9500);
    let cat = (await kid.client.get('/api/jobs/catalogue')).json;
    assert.equal(cat.business[0].missed, 1); assert.equal(cat.business[0].unpaid_warning, false);
    assert.match(cat.business[0].note, /could not make payroll/);
    x.advance();
    cat = (await kid.client.get('/api/jobs/catalogue')).json;
    assert.equal(cat.business[0].missed, 2); assert.equal(cat.business[0].unpaid_warning, true);
    assert.match(cat.business[0].note, /you may quit this job/);
    assert.equal(unpaid.length, 2); off();
    assert.equal((await kid.client.post('/api/jobs/back')).status, 404, '4b\'s "old job back" route is gone: the catalogue job was never left');
    assert.equal((await kid.client.post('/api/jobs/quit-business', { business_id: id })).status, 200);
    assert.equal((await kid.client.post('/api/jobs/quit-business', { business_id: id })).status, 404, 'already quit');
    cat = (await kid.client.get('/api/jobs/catalogue')).json;
    assert.deepEqual(cat.business, []);
    assert.deepEqual([cat.current.title, cat.current.hourly_cents], ['Retail associate', 1800], 'still on the catalogue job, at the same wage');
    x.advance();
    assert.equal(x.one('SELECT gross FROM jobs_paystubs WHERE player_id = ? AND month = 4', kid.id).gross, 1800 * 132);
    assert.equal(x.one('SELECT missed_paydays FROM ventures_companies WHERE id = ?', id).missed_paydays, 2);
    x.booksOk(id); x.audit();
  } finally { await x.cleanup(); }
});

test('layoffs: one month\'s notice (the next payday is the last), or now with one month\'s wages as pay in lieu of notice (refused if the treasury cannot)', async () => {
  const x = await world({ ft20: 2, ft10: 2 });
  try {
    const [lead, m1] = x.ft20, [kid, kid2] = x.ft10;
    const id = await x.found(lead, [m1], { capital: 50000 });
    await x.hire(lead, id, kid); await x.hire(lead, id, kid2, { title: 'Baker', hourly: 1700, hours: 12 });
    assert.equal((await x.post(lead, '/layoff', { id, player_id: kid.id, mode: 'notice' })).json.ends_month, 2);
    assert.equal((await x.post(lead, '/layoff', { id, player_id: kid.id, mode: 'notice' })).status, 409, 'notice already given');
    x.advance();
    assert.ok(x.one('SELECT 1 FROM jobs_paystubs WHERE player_id = ? AND month = 2', kid.id), 'paid through the notice month');
    assert.deepEqual((await kid.client.get('/api/jobs/catalogue')).json.business, [], 'then the job ends');
    // pay in lieu of notice: a second stub this month (kind severance), the job ends now
    const t0 = x.treasury(id), c0 = x.chq(kid2);
    const r = await x.post(lead, '/layoff', { id, player_id: kid2.id, mode: 'severance' });
    assert.equal(r.status, 200, JSON.stringify(r.json));
    const sev = x.one("SELECT * FROM jobs_paystubs WHERE player_id = ? AND kind = 'severance'", kid2.id);
    assert.equal(sev.month, 2); assert.equal(sev.gross, 1700 * 12);
    assert.ok(x.one("SELECT 1 FROM jobs_paystubs WHERE player_id = ? AND month = 2 AND kind = 'pay'", kid2.id), 'the regular pay of the month too');
    const ytd = JSON.parse(x.one("SELECT ytd_json FROM jobs_paystubs WHERE player_id = ? AND month = 2 AND kind = 'pay'", kid2.id).ytd_json);
    const s = payStub({ grossCents: 1700 * 12, period: 2, ytd }), er = employerShare(s);
    assert.equal(t0 - x.treasury(id), s.gross + er.cpp + er.ei); assert.equal(x.chq(kid2) - c0, s.net);
    assert.deepEqual((await kid2.client.get('/api/jobs/catalogue')).json.business, []);
    assert.equal(x.one('SELECT COUNT(*) AS n FROM jobs_business').n, 0);
    // a layoff with pay the treasury cannot cover is refused; notice still works
    await x.hire(lead, id, kid, { title: 'Big job', hourly: 5000, hours: 40 });
    assert.match((await x.post(lead, '/layoff', { id, player_id: kid.id, mode: 'severance' })).json.error, /Give one month's notice/);
    assert.equal((await x.post(lead, '/layoff', { id, player_id: kid.id, mode: 'notice' })).status, 200);
    assert.equal((await x.post(lead, '/layoff', { id, player_id: kid2.id, mode: 'notice' })).status, 404, 'not an employee any more');
    x.advance();
    assert.equal(x.statements(id).find((q) => q.month === 2).income.wages_cents, 1600 * 10 * 0 + 1700 * 12, 'month 2: the pay in lieu of notice (the month-2 pays are month 1\'s work)');
    x.booksOk(id); x.audit();
  } finally { await x.cleanup(); }
});

test('small business tax: 11% at the first tick of each world year on net income, a loss carried forward against the next year, paid from the treasury', async () => {
  const x = await world({ ft20: 2, ft10: 1 });
  try {
    const [lead, m1] = x.ft20, [kid] = x.ft10;
    const id = await x.found(lead, [m1]);
    await x.tpost('/sector', { sector: 'Food and drink', a_bp: 40000, b_bp: 10000 });
    await x.post(lead, '/product', { id, product: 'coffee', price_cents: 400, quantity: 0 });
    await x.hire(lead, id, kid, { hourly: 1500, hours: 10 });
    await x.post(lead, '/layoff', { id, player_id: kid.id, mode: 'notice' });
    x.advance(12);                                           // year 1: one pay, no sales: a loss
    const y1 = x.one('SELECT * FROM ventures_tax WHERE company_id = ? AND year = 1', id);
    const wages = x.statements(id).reduce((t, s) => t + s.income.wages_cents + s.income.employer_cents, 0);
    assert.deepEqual([y1.income_cents, y1.tax_cents, y1.loss_cf_cents], [-wages, 0, wages]);
    await x.post(lead, '/product', { id, product: 'coffee', price_cents: 400, quantity: 22 });
    const before = x.statements(id).length;
    x.advance(12);                                           // year 2: sales; the tick into month 25 assesses it
    const y2 = x.one('SELECT * FROM ventures_tax WHERE company_id = ? AND year = 2', id);
    const income = x.statements(id).filter((s) => s.month >= 13 && s.month <= 24).reduce((t, s) => t + s.income.pretax_cents, 0);
    assert.ok(income > wages, `year 2 earns more than the year-1 loss (${income} vs ${wages})`);
    assert.equal(y2.income_cents, income);
    assert.equal(y2.loss_before_cents, wages); assert.equal(y2.loss_applied_cents, wages);
    assert.equal(y2.tax_cents, Math.round(((income - wages) * 1100) / 10000));
    const dec = x.statements(id).find((s) => s.month === 24);
    assert.equal(dec.income.tax_cents, y2.tax_cents, 'the tax is on the last month of the year');
    assert.equal(dec.balance.tax_owed_cents, 0, 'and paid from the treasury at the same tick');
    assert.ok(x.statements(id).length > before);
    const slip = (await lead.client.get('/api/ventures/state')).json.mine.finance.tax.slips;
    assert.deepEqual(slip.map((t) => [t.year, t.tax_cents]), [[2, y2.tax_cents], [1, 0]]);
    x.booksOk(id); x.audit();
  } finally { await x.cleanup(); }
});

test('GST: voluntary registration charges 5% on town and classmate sales, claims ITCs on production, files and remits quarterly; past $30,000 it is mandatory', async () => {
  const x = await world({ ft20: 4, ft10: 1 });
  try {
    const [lead, m1, l2, m2] = x.ft20, [kid] = x.ft10;
    const id = await x.found(lead, [m1]);
    await x.tpost('/sector', { sector: 'Food and drink', a_bp: 40000, b_bp: 10000 });
    assert.equal((await x.post(lead, '/gst', { id })).json.since, 2);
    assert.equal((await x.post(lead, '/gst', { id })).status, 409);
    await x.post(lead, '/product', { id, product: 'coffee', price_cents: 400, quantity: 20 });
    x.advance();                                             // month 2: the first run, with GST on it
    const prod2 = x.statements(id).length ? x.one('SELECT SUM(production_cents) AS n FROM ventures_flows WHERE company_id = ? AND month = 2', id).n : 0;
    assert.equal(x.one('SELECT SUM(gst_itc_cents) AS n FROM ventures_flows WHERE company_id = ? AND month = 2', id).n, Math.round(prod2 * 0.05));
    const pid = (await kid.client.get('/api/ventures/state')).json.board.find((b) => b.id === id).products[0].id;
    const c0 = x.chq(kid), buy = await kid.client.post('/api/ventures/buy', { id: pid, source: 'chequing' });
    assert.equal(buy.status, 200, JSON.stringify(buy.json));
    assert.equal(c0 - x.chq(kid), 420, 'the classmate pays $4.00 + $0.20 GST');
    x.advance(2);                                            // ticks into 3 and 4: the quarter (months 1-3) is filed at the tick into month 4
    const ret = x.one('SELECT * FROM ventures_gst WHERE company_id = ? AND quarter = 1', id);
    const fl = x.one('SELECT SUM(gst_collected_cents) AS c, SUM(gst_itc_cents) AS i, SUM(npc_cents) AS n FROM ventures_flows WHERE company_id = ? AND month BETWEEN 1 AND 3', id);
    assert.deepEqual([ret.collected_cents, ret.itc_cents, ret.net_cents], [fl.c, fl.i, fl.c - fl.i]);
    const town = x.app.db.prepare('SELECT month, SUM(npc_cents) AS n FROM ventures_flows WHERE company_id = ? AND month BETWEEN 1 AND 3 GROUP BY month').all(id).reduce((t, r) => t + gstOf(r.n, 500), 0);
    assert.ok(fl.n > 0, 'the town bought coffee');
    assert.equal(fl.c, town + 20, 'GST on each month of town sales + the classmate\'s 20 cents');
    const remitted = x.one('SELECT SUM(gst_remitted_cents) AS n FROM ventures_flows WHERE company_id = ?', id).n;
    assert.equal(remitted, ret.net_cents, 'remitted (or refunded) in full');
    const st = x.statements(id).find((s) => s.month === 3);
    assert.equal(st.balance.gst_payable_cents, 0, 'nothing owed for the filed quarter');
    // the threshold: an unregistered company past $30,000 over the last 4 quarters must register (from the month after next)
    const id2 = await x.found(l2, [m2], { name: 'Big Seller', sector: 'Restaurants' });
    x.app.db.prepare('INSERT INTO ventures_flows (company_id, product_id, month, store_cents) VALUES (?, 0, 0, ?)').run(id2, GST_THRESHOLD_CENTS - 1);   // month 0: inside the window, no books
    x.advance(3);                                            // the tick into month 7 checks months up to 6
    assert.equal(x.one('SELECT gst_registered FROM ventures_companies WHERE id = ?', id2).gst_registered, 0, 'at the threshold, still a small supplier');
    x.app.db.prepare('UPDATE ventures_flows SET store_cents = store_cents + 2 WHERE company_id = ? AND product_id = 0 AND month = 0').run(id2);
    x.advance(3);
    assert.deepEqual({ ...x.one('SELECT gst_registered, gst_since, gst_mandatory FROM ventures_companies WHERE id = ?', id2) }, { gst_registered: 1, gst_since: 11, gst_mandatory: 1 });
    const g = (await l2.client.get('/api/ventures/state')).json.mine.finance.gst;
    assert.equal(g.mandatory, true);
    x.booksOk(id); x.audit();
  } finally { await x.cleanup(); }
});

test('the Venture Bank: $5,000 for a new company, amortised monthly from the treasury, the balance sheet carries the loan; one loan at a time', async () => {
  const x = await world({ ft20: 2, ft10: 0 });
  try {
    const [lead, m1] = x.ft20;
    const id = await x.found(lead, [m1]);
    const offer = (await lead.client.get('/api/ventures/state')).json.mine.finance.loan_offer;
    assert.deepEqual([offer.max_cents, offer.rate_bp, offer.new_company], [500000, POLICY_BP + 300, true]);
    assert.equal((await x.post(lead, '/borrow', { id, cents: 500001, term: 12 })).status, 400);
    assert.equal((await x.post(lead, '/borrow', { id, cents: 500000, term: 6 })).status, 400, 'term 12 to 36');
    const r = await x.post(lead, '/borrow', { id, cents: 500000, term: 12 });
    assert.equal(r.status, 200, JSON.stringify(r.json));
    assert.equal(r.json.payment_cents, loanPayment(500000, POLICY_BP + 300, 12));
    assert.equal(x.treasury(id), 540000); assert.equal(x.owed(id), 500000);
    assert.equal((await x.post(lead, '/borrow', { id, cents: 10000, term: 12 })).status, 409);
    const [c0, c1] = [x.chq(lead), x.chq(m1)];
    x.advance(12);
    assert.equal(x.owed(id), 0);
    assert.equal(x.one('SELECT status, months_paid FROM ventures_loans WHERE company_id = ?', id).status, 'paid');
    const sts = x.statements(id);
    const interest = sts.reduce((t, s) => t + s.income.interest_cents, 0);
    assert.equal(x.treasury(id), 540000 - 500000 - interest, 'principal + interest left the treasury');
    assert.equal(sts[0].balance.loans_cents, 500000 - (r.json.payment_cents - Math.round((500000 * (POLICY_BP + 300)) / 120000)));
    assert.ok(sts.every((s, i) => i === 0 || s.balance.loans_cents <= sts[i - 1].balance.loans_cents));
    assert.deepEqual([x.chq(lead), x.chq(m1)], [c0, c1], 'the founders paid nothing personally');
    x.booksOk(id); x.audit();
  } finally { await x.cleanup(); }
});

test('the Venture Bank: a missed payment adds interest + a late fee and costs reputation; 3 misses default and freeze the company; the teacher restructures, forgives or dissolves; teacher B cannot', async () => {
  const x = await world({ ft20: 4, ft10: 0 });
  try {
    const [lead, m1, l2, m2] = x.ft20;
    const id = await x.found(lead, [m1]);
    await x.post(lead, '/product', { id, product: 'coffee', price_cents: 400, quantity: 5 });
    await x.post(lead, '/borrow', { id, cents: 100000, term: 12 });
    const [c0, c1] = [x.chq(lead), x.chq(m1)];
    x.drain(id);
    x.advance();
    const rate = POLICY_BP + 300;
    assert.equal(x.owed(id), 100000 + loanInterest(100000, rate) + LOAN_LATE_FEE_CENTS);
    assert.deepEqual({ ...x.one('SELECT misses, status FROM ventures_loans WHERE company_id = ?', id) }, { misses: 1, status: 'active' });
    assert.ok(x.one('SELECT rep_bp FROM ventures_companies WHERE id = ?', id).rep_bp <= 9700);
    x.advance(2);
    assert.equal(x.one('SELECT status FROM ventures_loans WHERE company_id = ?', id).status, 'default');
    assert.equal(x.one('SELECT status FROM ventures_companies WHERE id = ?', id).status, 'frozen');
    x.advance();
    assert.equal(x.one('SELECT COALESCE(SUM(produced_units), 0) AS n FROM ventures_flows WHERE company_id = ? AND month = 5', id).n, 0, 'frozen: no production');
    assert.match((await x.tpost('/freeze', { id, frozen: false })).json.error, /in default/);
    const b = await x.teacherB();
    for (const action of ['forgive', 'restructure', 'dissolve']) assert.equal((await x.tpost('/resolve', { id, action, term_months: 24 }, b)).status, 404, `teacher B ${action}`);
    // restructure: a new 24-month term on what is owed now
    const owedNow = x.owed(id);
    assert.equal((await x.tpost('/resolve', { id, action: 'restructure', term_months: 24 })).status, 200);
    assert.deepEqual({ ...x.one('SELECT status, misses, principal_cents, payment_cents FROM ventures_loans WHERE company_id = ?', id) }, { status: 'active', misses: 0, principal_cents: owedNow, payment_cents: loanPayment(owedNow, rate, 24) });
    assert.equal(x.one('SELECT status FROM ventures_companies WHERE id = ?', id).status, 'active');
    // default again, then forgive: a gain on the books, nothing owed
    x.drain(id); x.advance(3); x.drain(id);
    assert.equal(x.one('SELECT status FROM ventures_loans WHERE company_id = ?', id).status, 'default');
    const owed2 = x.owed(id);
    assert.equal((await x.tpost('/resolve', { id, action: 'forgive' })).status, 200);
    assert.equal(x.owed(id), 0);
    assert.equal(x.one('SELECT SUM(forgiven_cents) AS n FROM ventures_flows WHERE company_id = ?', id).n, owed2);
    x.advance();
    assert.deepEqual([x.chq(lead), x.chq(m1)], [c0, c1], 'the founders\' own money is untouched: the company is a separate legal entity');
    x.booksOk(id);
    // another company defaults; the teacher dissolves it: the loan is written off, the founders get nothing and owe nothing
    const id2 = await x.found(l2, [m2], { name: 'Sinking Ship', sector: 'Restaurants' });
    await x.post(l2, '/borrow', { id: id2, cents: 50000, term: 12 });
    const [d0, d1] = [x.chq(l2), x.chq(m2)];
    for (let i = 0; i < 3; i++) { x.drain(id2); x.advance(); }
    assert.equal((await x.tpost('/resolve', { id: id2, action: 'dissolve' })).status, 200);
    assert.equal(x.one('SELECT status FROM ventures_companies WHERE id = ?', id2).status, 'dissolved');
    assert.equal(x.owed(id2), 0);
    assert.equal(x.one('SELECT status FROM ventures_loans WHERE company_id = ?', id2).status, 'written_off');
    assert.deepEqual([x.chq(l2), x.chq(m2)], [d0, d1]);
    x.booksOk(id2); x.audit();
  } finally { await x.cleanup(); }
});

test('season close: open loans are settled from the treasury before the pay-out; stakes are book value net of the loan; Best Employer; the next season starts clean', async () => {
  const x = await world({ ft20: 2, ft10: 1 });
  try {
    const [lead, m1] = x.ft20, [kid] = x.ft10;
    const id = await x.found(lead, [m1]);
    await kid.client.post('/api/jobs/pick', { job_id: 2 });
    await x.hire(lead, id, kid);
    await x.post(lead, '/borrow', { id, cents: 100000, term: 24 });
    x.advance(2);
    const leaders = (await x.teacher.get('/api/leaderboards/teach')).json.leaders;
    assert.ok(leaders.some((a) => a.award === 'employer' && [lead.username, m1.username].includes(a.name) && a.value === 1 && a.title === 'Best Employer'), JSON.stringify(leaders));
    const value = x.treasury(id) - x.owed(id);
    assert.ok(value > 0 && x.owed(id) > 0);
    const w = x.app.world.current().id, [cl, cm] = [x.chq(lead), x.chq(m1)];
    assert.equal((await x.teacher.post('/api/teach/world/close')).status, 200);
    assert.ok(x.one("SELECT 1 FROM txns WHERE kind = 'ventures.loan_settle'"), 'settled from the treasury');
    assert.equal(x.one('SELECT status FROM ventures_loans WHERE company_id = ?', id).status, 'settled');
    const res = Object.fromEntries(x.app.db.prepare('SELECT player_id, net_worth_cents FROM season_results WHERE world_id = ?').all(w).map((q) => [q.player_id, q.net_worth_cents]));
    assert.equal(res[lead.id] + res[m1.id], cl + cm + value, 'the stakes are treasury - loan, pro rata');
    assert.equal(x.owed(id), 0); assert.equal(x.treasury(id), 0);
    assert.equal(x.one('SELECT COUNT(*) AS n FROM jobs_business').n, 0);
    assert.equal(x.one('SELECT job_id FROM jobs_holdings WHERE player_id = ?', kid.id).job_id, 2, 'the employee kept the catalogue job all along');
    x.audit();
  } finally { await x.cleanup(); }
});

test('teacher: hire approval (world setting), the loan spread, the class view; teacher B can neither approve hires nor change the settings', async () => {
  const x = await world({ ft20: 2, ft10: 1 });
  try {
    const [lead, m1] = x.ft20, [kid] = x.ft10;
    const id = await x.found(lead, [m1]);
    const b = await x.teacherB();
    assert.equal((await x.tpost('/finance-settings', { hire_approval: true }, b)).status, 403);
    assert.equal((await x.tpost('/finance-settings', { hire_approval: true, loan_spread_bp: 450 })).status, 200);
    const h = await x.hire(lead, id, kid);
    assert.equal(h.status, 'approved', 'waits for the teacher');
    assert.deepEqual((await kid.client.get('/api/jobs/catalogue')).json.business, []);
    assert.equal((await x.tpost('/hire-approve', { application_id: h.application, approve: true }, b)).status, 404);
    const v = (await x.teacher.get('/api/ventures/teach')).json;
    assert.deepEqual(v.classes[0].companies[0].hires.map((q) => q.username), [kid.username]);
    assert.equal(v.finance.loan_spread_bp, 450);
    assert.equal((await x.tpost('/hire-approve', { application_id: h.application, approve: true })).status, 200);
    assert.equal((await kid.client.get('/api/jobs/catalogue')).json.business[0].employer, 'Bean There');
    assert.equal((await lead.client.get('/api/ventures/state')).json.mine.finance.loan_offer.rate_bp, POLICY_BP + 450);
    assert.equal((await b.get('/api/ventures/teach')).json.classes.length, 0, 'B sees none of it');
    x.advance();
    const row = (await x.teacher.get('/api/ventures/teach')).json.classes[0].companies[0];
    assert.equal(row.staff, 1); assert.match(row.payroll, /on time/);
    x.audit();
  } finally { await x.cleanup(); }
});
