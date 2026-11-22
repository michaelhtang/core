// Inflation (docs/phase2.md "Inflation"): rates owns a world price index that steps once per world year (months 13, 25, ...); bills, housing, jobs and
// insurance each keep the latest index per world from module.rates.changed and scale their own prices by it. Without rates the index is 10000.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { boot, seeded } from './helpers.js';

// The real config; 10% inflation by default so the arithmetic is easy to read (a step of 10000 -> 11000 -> 12100).
const config = ({ inflationBp = 1000, modules } = {}) => {
  const c = JSON.parse(fs.readFileSync(new URL('../config/vdaa.json', import.meta.url), 'utf8'));
  c.options.bills = { startAfter: 'login' };
  if (inflationBp !== null) c.options.rates = { inflationBp };
  if (modules) for (const course of Object.values(c.courses)) course.modules = modules;
  return c;
};
async function world(opts, count = 2) {
  const srv = await boot({ config: config(opts) });
  const t = await seeded(srv, count, { transfers: false });
  const app = srv.app;
  const to = (month) => { for (let n = month - app.world.current().month; n > 0; n -= 12) app.world.advance({ months: Math.min(n, 12) }); };
  const give = (s, cents) => app.ledger.post({ kind: 'test.grant', legs: [{ account: app.ledger.system('mint'), cents: -cents }, { account: s.chequing.id, cents }] });
  const due = (s, billId, month) => app.db.prepare('SELECT amount FROM bills_due WHERE player_id = ? AND bill_id = ? AND due_month = ?').get(s.id, billId, month)?.amount;
  return { srv, app, ...t, to, give, due };
}

test('the index steps exactly at months 13, 25, 37 and compounds; the event carries priceIndexBp only when it moves', async () => {
  const w = await world({ inflationBp: null });                                       // the default: 2.1%
  try {
    const seen = [];
    w.app.events.on('module.rates.changed', (p) => seen.push([p.month, p.priceIndexBp, p.inflationBp]));
    w.to(12);
    assert.deepEqual(seen, [[2, 10000, 210]], 'the first tick announces the base index; months 3-12 are quiet');
    w.to(13);
    assert.deepEqual(seen.at(-1), [13, 10210, 210]);
    w.to(24);
    assert.equal(seen.length, 2, 'nothing between the steps');
    w.to(25);
    assert.deepEqual(seen.at(-1), [25, 10424, 210], '10210 x 1.021 = 10424.41, rounded to a basis point');
    w.to(37);
    assert.deepEqual(seen.at(-1), [37, 10643, 210]);                                    // 10424 x 1.021 = 10642.9
    assert.equal(w.app.ledger.audit().ok, true);
    const row = w.app.db.prepare('SELECT price_index_bp FROM rates_policy').get();
    assert.equal(row.price_index_bp, 10643);
  } finally { await w.srv.cleanup(); }
});

test('the teacher changes inflation like the policy rate: queued, applied at the next tick, so the next step uses it', async () => {
  const w = await world({ inflationBp: 1000 });
  try {
    const seen = [];
    w.app.events.on('module.rates.changed', (p) => seen.push([p.month, p.priceIndexBp, p.inflationBp]));
    const s = w.students[0];
    assert.equal((await s.client.post('/api/rates/inflation', { inflation_bp: 500 })).status, 403);
    assert.equal((await w.teacher.post('/api/rates/inflation', { inflation_bp: 1001 })).status, 400);
    w.to(12);
    const r = await w.teacher.post('/api/rates/inflation', { inflation_bp: 500 });      // set in month 12: applies from month 13, the step month
    assert.deepEqual([r.status, r.json.applies_from_month], [200, 13]);
    const cur = (await w.teacher.get('/api/rates/current')).json;
    assert.deepEqual([cur.inflation_bp, cur.pending_inflation_bp, cur.price_index_bp], [1000, 500, 10000]);
    w.to(13);
    assert.deepEqual(seen.at(-1), [13, 10500, 500]);
    w.to(24);
    await w.teacher.post('/api/rates/inflation', { inflation_bp: 0 });                  // set in month 24: applies at the month 25 tick, before the step
    w.to(25);
    assert.deepEqual(seen.at(-1), [25, 10500, 0], 'a 0% step leaves the index where it was');
    w.to(26);
    await w.teacher.post('/api/rates/inflation', { inflation_bp: 1000 });
    w.to(37);
    assert.deepEqual(seen.at(-1), [37, 11550, 1000]);
    const cur2 = (await s.client.get('/api/rates/current')).json;
    assert.deepEqual([cur2.inflation_bp, cur2.pending_inflation_bp, cur2.price_index_bp], [1000, null, 11550]);
  } finally { await w.srv.cleanup(); }
});

test('bills: catalogue amounts issued from month 13 are x index (to the cent); earlier bills keep their amount', async () => {
  const w = await world({ inflationBp: 1000 });
  try {
    const [s] = w.students;
    w.to(14);
    assert.equal(w.due(s, 'rent', 12), 75000);
    assert.equal(w.due(s, 'rent', 13), 82500);
    assert.equal(w.due(s, 'groceries', 12), 36600);
    assert.equal(w.due(s, 'groceries', 14), 40260);
    assert.equal(w.due(s, 'rent', 2), 75000, 'a bill already issued is never repriced');
  } finally { await w.srv.cleanup(); }
});

test('housing: rents and the parents contribution follow the index from month 13; new purchase prices, condo fees, heating and insurance too', async () => {
  const w = await world({ inflationBp: 1000 });
  try {
    const [a, b] = w.students;
    for (const s of [a, b]) w.give(s, 500000);
    assert.equal((await a.client.post('/api/housing/tenure', { tenure: 'apt1' })).status, 200);
    assert.equal((await b.client.post('/api/housing/tenure', { tenure: 'parents' })).status, 200);
    w.to(12);
    let st = (await a.client.get('/api/housing/state')).json;
    assert.deepEqual([w.due(a, 'housing-rent', 12), w.due(b, 'housing-rent', 12)], [129000, 40000]);
    assert.deepEqual(st.buy.properties.map((p) => [p.id, p.price_cents, p.condo_fee_cents, p.heating_cents, p.insurance_cents]),
      [['average', 20200000, 40000, 6000, 3500], ['starter', 15000000, 54600, 0, 3500]]);
    w.to(13);
    assert.deepEqual([w.due(a, 'housing-rent', 13), w.due(b, 'housing-rent', 13)], [141900, 44000]);
    st = (await a.client.get('/api/housing/state')).json;
    assert.deepEqual(st.buy.properties.map((p) => [p.id, p.price_cents, p.condo_fee_cents, p.heating_cents, p.insurance_cents]),
      [['average', 22220000, 44000, 6600, 3850], ['starter', 16500000, 60060, 0, 3850]]);
    assert.equal(st.catalogue.find((c) => c.id === 'apt1').rent_cents, 141900);
    assert.equal(st.catalogue.find((c) => c.id === 'apt1').deposit_cents, 129000, 'the damage deposit stays at the base rent');
  } finally { await w.srv.cleanup(); }
});

test('jobs: new hires and promotions are paid catalogue/step wage x index; a holding\'s own wage moves only by raises (+3%)', async () => {
  const w = await world({ inflationBp: 1000 }, 3);
  try {
    const [old, hire, promo] = w.students;
    const stub = async (s) => { const l = (await s.client.get('/api/jobs/stubs')).json.stubs[0]; return (await s.client.get(`/api/jobs/stubs/${l.id}`)).json; };
    await old.client.post('/api/jobs/pick', { job_id: 1 });                             // cashier, month 1: $15.28
    await promo.client.post('/api/jobs/pick', { job_id: 1 });
    w.to(13);                                                                           // the index is 11000, the 12th pay is the last at the starting wage
    assert.equal((await stub(old)).job.hourly_cents, 1528, 'the index does not touch a wage already being paid');
    await hire.client.post('/api/jobs/pick', { job_id: 2 });                            // line cook hired at month 13: 1687 x 1.1
    assert.equal((await hire.client.get('/api/jobs/catalogue')).json.jobs.find((j) => j.id === 2).hourly_cents, 1856);
    w.to(14);                                                                           // old's 13th pay: the raise is 3% of her own wage, not of the catalogue
    const o = await stub(old);
    assert.deepEqual([o.job.hourly_cents, o.note.includes('Annual raise of 3%')], [Math.round(1528 * 1.03), true]);
    assert.equal((await stub(hire)).job.hourly_cents, 1856);
    assert.equal((await w.teacher.post('/api/jobs/promote', { player_id: promo.id })).status, 200);   // Retail supervisor $19.12 x 1.1 = 2103.2
    w.to(15);
    const p = await stub(promo);
    assert.deepEqual([p.job.title, p.job.hourly_cents], ['Retail supervisor', 2103]);
    assert.equal(w.app.ledger.audit().ok, true);
  } finally { await w.srv.cleanup(); }
});

test('B17 at 10% inflation: quit-and-rehire within 12 months restores the old wage, step and paused clocks; a genuinely new job (or a return after 12 months) starts at catalogue x index', async () => {
  const w = await world({ inflationBp: 1000 }, 4);
  try {
    const [a, back, fresh, gone] = w.students;
    const cur = async (s) => { const j = (await s.client.get('/api/jobs/catalogue')).json; return { hourly: j.current?.hourly_cents, step: j.current?.step, raise: j.promotion?.next_raise_month }; };
    for (const s of [a, back, gone]) assert.equal((await s.client.post('/api/jobs/pick', { job_id: 1 })).status, 200);   // cashier, month 1: $15.28
    w.to(2);
    assert.equal((await gone.client.post('/api/jobs/quit')).status, 200);             // left in month 2
    w.to(14);                                                                         // the index is 11000; a and back had their first raise with the 13th pay
    const raised = Math.round(1528 * 1.03), hire = Math.round(1528 * 1.1);
    assert.deepEqual(await cur(a), { hourly: raised, step: 0, raise: 26 });
    // the switch A -> B -> A in one month: still the 3% raise, not the new-hire 1681 (it used to be the new-hire wage, so switching beat staying)
    await a.client.post('/api/jobs/pick', { job_id: 2 });
    assert.equal((await cur(a)).hourly, Math.round(1687 * 1.1), 'job 2 is a new job: catalogue x index');
    await a.client.post('/api/jobs/pick', { job_id: 1 });
    assert.deepEqual(await cur(a), { hourly: raised, step: 0, raise: 26 });
    // away 3 months: the wage comes back and the raise clock moved on by the time away
    await back.client.post('/api/jobs/quit');
    w.to(17);
    await back.client.post('/api/jobs/pick', { job_id: 1 });
    assert.deepEqual(await cur(back), { hourly: raised, step: 0, raise: 29 });
    // never held it, or left more than 12 months ago: a new hire at catalogue x index
    await fresh.client.post('/api/jobs/pick', { job_id: 1 });
    await gone.client.post('/api/jobs/pick', { job_id: 1 });
    assert.equal((await cur(fresh)).hourly, hire);
    assert.equal((await cur(gone)).hourly, hire);
    w.to(30);
    const paid = (s, m) => w.app.db.prepare('SELECT hourly_cents FROM jobs_paystubs WHERE player_id = ? AND month = ?').get(s.id, m).hourly_cents;
    assert.deepEqual([paid(a, 26), paid(back, 28), paid(back, 29)], [Math.round(raised * 1.03), raised, Math.round(raised * 1.03)]);
    assert.equal(w.app.ledger.audit().ok, true);
  } finally { await w.srv.cleanup(); }
});

test('insurance: premiums are x index from month 13', async () => {
  const w = await world({ inflationBp: 1000 });
  try {
    const [s] = w.students;
    w.to(2);                                                                            // bills has announced the student: they can buy
    assert.equal((await s.client.post('/api/insurance/buy', { policy: 'tenant' })).status, 200);
    w.to(12);
    assert.equal(w.due(s, 'insurance-tenant', 12), 2000);
    w.to(13);
    assert.equal(w.due(s, 'insurance-tenant', 13), 2200);
    const pol = (await s.client.get('/api/insurance/state')).json.policies.find((p) => p.key === 'tenant');
    assert.equal(pol.premium_cents, 2200);
  } finally { await w.srv.cleanup(); }
});

test('without rates the index is 10000: nothing scales, even after 25 months', async () => {
  const w = await world({ inflationBp: null, modules: ['bank-basic', 'jobs', 'housing', 'insurance', 'bills'] });
  try {
    const [a, b] = w.students;
    w.give(a, 500000);
    await a.client.post('/api/housing/tenure', { tenure: 'apt1' });
    w.to(2);
    await b.client.post('/api/insurance/buy', { policy: 'tenant' });
    w.to(25);
    assert.equal((await a.client.get('/api/rates/current')).status, 404);
    assert.deepEqual([w.due(a, 'rent', 25), w.due(a, 'housing-rent', 25), w.due(a, 'groceries', 25)], [undefined, 129000, 36600]);
    assert.equal(w.due(b, 'rent', 25), 75000);
    assert.equal(w.due(b, 'insurance-tenant', 25), 2000);
    const st = (await a.client.get('/api/housing/state')).json;
    assert.deepEqual(st.buy.properties.map((p) => p.price_cents), [20200000, 15000000]);
    await b.client.post('/api/jobs/pick', { job_id: 2 });
    assert.equal((await b.client.get('/api/jobs/catalogue')).json.current.hourly_cents, 1687);
  } finally { await w.srv.cleanup(); }
});
