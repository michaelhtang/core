// Student landlords (wave 6b, docs/phase6-roles.md §2): a second home bought as a rental (20% down, uninsured, TDS with the primary's payment and half
// the NPC rent), its own mortgage account, listings within 60-150% of the NPC tier, rent posted tenant -> landlord by housing itself (one txn a month,
// never a bill), the bills rent line keyed on tenure, arrears + NSF + credit and stress, eviction after three misses, notices, a sale ending a tenancy,
// season close, and who may do what. The real bank-basic, rates, housing, credit, bills, stress, savings, leaderboards and feed run; a fake `jobs`
// pays a known gross (and can stop paying one student, so their rent bounces).
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { ROOT } from '../lib/app.js';
import { boot, seeded, addClass, tmpDir } from './helpers.js';

const MODULES_URL = pathToFileURL(path.join(ROOT, 'lib', 'modules.js')).href;
const made = [];
after(() => { for (const d of made) fs.rmSync(d, { recursive: true, force: true }); });

const GROSS = 600000, NET = 500000;
// globalThis.__vdaaNoPay: player ids the fake payroll skips this month (a tenant who cannot pay)
const fakeJobs = `import { defineModule } from '${MODULES_URL}';
export default defineModule({ id: 'jobs', requires: ['bank-basic'], services: { todayFacts: () => ({ hasJob: true }) }, onTick(k, { month, classes }) {
  for (const c of classes) for (const id of c.studentIds) {
    if (globalThis.__vdaaNoPay?.has(id)) continue;
    k.ledger.post({ kind: 'pay', legs: [{ account: k.ledger.system('mint'), cents: -${NET} }, { account: k.ledger.accountId('player', id, 'chequing'), cents: ${NET} }] });
    k.events.emit('paid', { playerId: id, worldId: k.world.current().id, month, net: ${NET}, gross: ${GROSS} });
  }
} });`;

function setup(options = {}) {
  const d = tmpDir(); made.push(d);
  const real = ['bank-basic', 'rates', 'housing', 'credit', 'bills', 'stress', 'savings', 'leaderboards', 'feed'];
  for (const id of real) fs.symlinkSync(path.join(ROOT, 'modules', id), path.join(d, id));
  fs.mkdirSync(path.join(d, 'jobs')); fs.writeFileSync(path.join(d, 'jobs', 'index.js'), fakeJobs);
  const mods = ['bank-basic', 'rates', 'jobs', 'housing', 'credit', 'bills', 'stress', 'savings', 'leaderboards', 'feed'];
  return { config: { courses: { fintech10: { label: 'x', modules: mods }, fintech2030: { label: 'y', modules: mods } }, options: { 'bank-basic': { startCents: 50000 }, bills: { startAfter: 'pay' }, housing: options } }, modulesDir: d };
}

async function world({ count = 3, options = {} } = {}) {
  globalThis.__vdaaNoPay = new Set();
  const srv = await boot(setup(options));
  const t = await seeded(srv, count, { transfers: true });                    // student rent needs the class's payments between classmates on (6b review)
  const { app } = srv;
  const events = [];
  app.events.on('*', (payload, type) => { if (type.startsWith('module.housing.')) events.push({ type, ...payload }); });
  const advance = (n = 1) => app.world.advance({ months: n });
  const give = (s, cents) => app.ledger.post({ kind: 'test.grant', legs: [{ account: app.ledger.system('mint'), cents: -cents }, { account: s.chequing.id, cents }] });
  const drain = (s, leave = 0) => { const b = app.ledger.balance(s.chequing.id) - leave; if (b > 0) app.ledger.post({ kind: 'test.drain', legs: [{ account: s.chequing.id, cents: -b }, { account: app.ledger.system('sink'), cents: b }] }); };
  const chq = (s) => app.ledger.balance(s.chequing.id);
  const acct = (s, kind) => { const a = app.ledger.accountId('player', s.id, kind); return a ? app.ledger.balance(a) : null; };
  const state = async (s) => (await s.client.get('/api/housing/state')).json;
  const bills = async (s) => (await s.client.get('/api/bills/state')).json.bills;
  const month = () => app.world.current().month;
  const rentTxns = () => app.db.prepare("SELECT id, meta FROM txns WHERE kind = 'housing.rent' ORDER BY id").all().map((r) => ({ id: r.id, ...JSON.parse(r.meta) }));
  const legs = (txnId) => app.db.prepare('SELECT account_id, amount_cents FROM entries WHERE txn_id = ? ORDER BY id').all(txnId).map((r) => ({ ...r }));
  const audit = () => { const a = app.ledger.audit(); assert.equal(a.ok, true, JSON.stringify(a.problems)); };
  // A landlord: a primary average condo (5% down) and a starter rental (20% down). Returns the rental's home id.
  const landlord = async (s) => {
    give(s, 6000000);
    const p = await s.client.post('/api/housing/buy', { down_cents: 1010000, amort_years: 25 });
    assert.equal(p.status, 200, JSON.stringify(p.json));
    const r = await s.client.post('/api/housing/buy', { down_cents: 3000000, amort_years: 25, property: 'starter', role: 'rental' });
    assert.equal(r.status, 200, JSON.stringify(r.json));
    return r.json.home_id;
  };
  return { srv, app, ...t, events, advance, give, drain, chq, acct, state, bills, month, rentTxns, legs, audit, landlord };
}

test('buying a rental: refused as a first home and under 20% down, uninsured, TDS counts the primary payment and half the NPC rent; two mortgage accounts, summed value, per-home renewals, selling each', async () => {
  const w = await world({ count: 2, options: { termMonths: 3 } });
  try {
    const [a] = w.students;
    w.advance(3);                                                            // three months of pay: a lender can see income
    w.give(a, 6000000);
    const first = await a.client.post('/api/housing/buy', { down_cents: 3000000, amort_years: 25, property: 'starter', role: 'rental' });
    assert.equal(first.status, 400);
    assert.match(first.json.error, /cannot be your first home/);
    assert.equal((await a.client.post('/api/housing/buy', { down_cents: 1010000, amort_years: 25 })).status, 200);
    const primary = w.app.db.prepare("SELECT * FROM housing_homes WHERE player_id = ? AND role = 'primary'").get(a.id);
    const low = await a.client.post('/api/housing/buy', { down_cents: 1500000, amort_years: 25, property: 'starter', role: 'rental' });
    assert.equal(low.status, 400);
    assert.match(low.json.error, /at least 20% down/);
    const q = (await a.client.post('/api/housing/qualify', { down_cents: 3000000, amort_years: 25, property: 'starter', role: 'rental' })).json;
    assert.equal(q.ok, true, JSON.stringify(q.reasons));
    assert.equal(q.insured, false);
    assert.equal(q.premiumCents, 0);
    assert.equal(q.primaryPaymentCents, primary.payment_cents);
    assert.equal(q.otherDebtCents, primary.payment_cents);                    // no card: the primary's payment is the only other debt
    assert.equal(q.rentIncomeCents, 64500);                                    // half the 1-bedroom's $1,290
    assert.equal(q.grossMonthlyCents, GROSS + 64500);
    const r = await a.client.post('/api/housing/buy', { down_cents: 3000000, amort_years: 25, property: 'starter', role: 'rental' });
    assert.equal(r.status, 200, JSON.stringify(r.json));
    const rid = r.json.home_id;
    assert.equal((await a.client.post('/api/housing/buy', { down_cents: 3000000, amort_years: 25, property: 'starter', role: 'rental' })).status, 409);
    assert.equal(w.acct(a, 'mortgage'), -primary.loan_cents);
    assert.equal(w.acct(a, `mortgage:${rid}`), -12000000);
    const v0 = w.events.filter((e) => e.type === 'module.housing.value' && e.playerId === a.id).at(-1);
    assert.deepEqual([v0.homeValue, v0.mortgageBalance], [20200000 + 15000000, primary.loan_cents + 12000000], 'the purchase announces the sum of both homes');
    w.advance();
    const pays = w.events.filter((e) => e.type === 'module.housing.payment' && e.playerId === a.id && e.month === w.month());
    assert.deepEqual(pays.map((p) => [p.homeId, p.kind, p.onTime]).sort(), [[primary.id, 'mortgage', true], [rid, 'mortgage', true]].sort());
    assert.equal(pays.at(-1).total, pays.reduce((t, p) => t + p.amount, 0));
    const v1 = w.events.filter((e) => e.type === 'module.housing.value' && e.playerId === a.id).at(-1);
    const homes = w.app.db.prepare("SELECT value_cents, id FROM housing_homes WHERE player_id = ? AND status = 'owned'").all(a.id);
    assert.equal(v1.homeValue, homes.reduce((t, h) => t + h.value_cents, 0));
    assert.equal(v1.mortgageBalance, -w.acct(a, 'mortgage') - w.acct(a, `mortgage:${rid}`));
    assert.equal(w.app.db.prepare('SELECT home_value FROM savings_home WHERE player_id = ?').get(a.id).home_value, v1.homeValue);
    const st = await w.state(a);
    assert.equal(st.home.id, primary.id);
    assert.equal(st.rental.id, rid);
    assert.equal(st.rental.balance_cents, -w.acct(a, `mortgage:${rid}`));
    // owner lines per home: the rental's keys are suffixed, so both homes are billed
    const due = (await w.bills(a)).filter((b) => b.due_month === w.month()).map((b) => b.bill_id);
    for (const key of ['property-tax', 'condo-fees', 'home-insurance', 'property-tax-rental', 'condo-fees-rental', 'home-insurance-rental']) assert.ok(due.includes(`housing-${key}`), key);
    assert.ok(!due.includes('rent'), 'an owner pays no catalogue rent');
    // renewals per home (term 3 months)
    w.advance(3);
    const renewed = w.app.db.prepare('SELECT DISTINCT home_id FROM housing_renewals').all().map((x) => x.home_id).sort();
    assert.deepEqual(renewed, [primary.id, rid].sort());
    // selling the primary while holding the rental: shared room, the rental keeps ticking, the catalogue rent comes back
    const sp = await a.client.post('/api/housing/sell', { home_id: primary.id });
    assert.equal(sp.status, 200, JSON.stringify(sp.json));
    assert.equal(w.acct(a, 'mortgage'), 0);
    assert.equal((await w.state(a)).tenure, 'shared');
    assert.equal(w.events.filter((e) => e.type === 'module.housing.value' && e.playerId === a.id).at(-1).homeValue, w.app.db.prepare('SELECT value_cents FROM housing_homes WHERE id = ?').get(rid).value_cents, 'selling one of two does not announce 0');
    w.advance();
    const later = (await w.bills(a)).filter((b) => b.due_month === w.month()).map((b) => b.bill_id);
    assert.ok(later.includes('rent'), 'a landlord in the shared room pays the shared-room rent');
    assert.ok(later.includes('housing-property-tax-rental'));
    assert.ok(w.events.some((e) => e.type === 'module.housing.payment' && e.homeId === rid && e.month === w.month()), 'the rental mortgage is still debited');
    // selling the rental: its account is paid out, value 0
    const sr = await a.client.post('/api/housing/sell', { home_id: rid });
    assert.equal(sr.status, 200, JSON.stringify(sr.json));
    assert.equal(w.acct(a, `mortgage:${rid}`), 0);
    assert.equal(w.events.filter((e) => e.type === 'module.housing.value' && e.playerId === a.id).at(-1).homeValue, 0);
    w.audit();
  } finally { await w.srv.cleanup(); }
});

test('listings: 60-150% of the NPC tier, only your own rental, a tenant cannot list, classmates only, one tenant per unit', async () => {
  const w = await world({ count: 3 });
  try {
    const [a, b, c] = w.students;
    w.advance(3);
    const rid = await w.landlord(a);
    const tier = 129000;                                                       // starter -> 1-bedroom
    assert.equal((await a.client.post('/api/housing/list', { home_id: rid, rent_cents: Math.ceil(tier * 0.6) - 1 })).status, 400);
    assert.equal((await a.client.post('/api/housing/list', { home_id: rid, rent_cents: Math.floor(tier * 1.5) + 1 })).status, 400);
    assert.equal((await a.client.post('/api/housing/list', { home_id: rid, rent_cents: Math.ceil(tier * 0.6) })).status, 200);
    assert.equal((await a.client.post('/api/housing/list', { home_id: rid, rent_cents: tier })).status, 409);   // already listed
    assert.equal((await a.client.post('/api/housing/unlist', { home_id: rid })).status, 200);
    assert.equal((await a.client.post('/api/housing/list', { home_id: rid, rent_cents: Math.floor(tier * 1.5) })).status, 200);
    // only the owner manages it; a primary is not a rental
    for (const p of ['/list', '/rent']) assert.equal((await b.client.post(`/api/housing${p}`, { home_id: rid, rent_cents: tier })).status, 404, p);
    for (const p of ['/unlist', '/end-tenancy']) assert.equal((await b.client.post(`/api/housing${p}`, { home_id: rid })).status, 404, p);
    const primary = w.app.db.prepare("SELECT id FROM housing_homes WHERE player_id = ? AND role = 'primary'").get(a.id).id;
    assert.equal((await a.client.post('/api/housing/list', { home_id: primary, rent_cents: tier })).status, 404);
    // the market: classmates see it with the landlord's username; the landlord does not see their own
    const m = (await b.client.get('/api/housing/market')).json;
    assert.deepEqual(m.listings.map((l) => [l.home_id, l.landlord, l.rent_cents, l.npc_cents, l.months_vacant, l.reputation]), [[rid, a.username, Math.floor(tier * 1.5), tier, 0, 0]]);
    assert.ok(m.tiers.some((t) => t.id === 'apt1' && t.rent_cents === tier));
    assert.equal((await a.client.get('/api/housing/market')).json.listings.length, 0);
    assert.equal((await a.client.post('/api/housing/tenure', { tenure: `unit:${rid}` })).status, 409);   // the landlord owns a home
    // another class cannot see it or rent it
    const [d] = (await addClass(w.srv, w.teacher, 'Block 2', 1)).students;
    assert.equal((await d.client.get('/api/housing/market')).json.listings.length, 0);
    assert.equal((await d.client.post('/api/housing/tenure', { tenure: `unit:${rid}` })).status, 404);
    // one tenant per unit: b reserves it, c is refused; a tenant cannot list anything
    const r = await b.client.post('/api/housing/tenure', { tenure: `unit:${rid}` });
    assert.equal(r.status, 200, JSON.stringify(r.json));
    assert.equal((await c.client.post('/api/housing/tenure', { tenure: `unit:${rid}` })).status, 409);
    assert.equal((await b.client.post('/api/housing/list', { home_id: rid, rent_cents: tier })).status, 404);
    assert.equal((await a.client.post('/api/housing/unlist', { home_id: rid })).status, 409, 'cannot unlist under a tenant');
    // b changes their mind: the reservation is released, c can take it
    assert.equal((await b.client.post('/api/housing/tenure', { tenure: 'shared' })).status, 200);
    assert.equal(w.app.db.prepare('SELECT tenant_id FROM housing_listings WHERE home_id = ?').get(rid).tenant_id, null);
    assert.equal((await c.client.post('/api/housing/tenure', { tenure: `unit:${rid}` })).status, 200);
    w.audit();
  } finally { await w.srv.cleanup(); }
});

test('rent: one balanced txn a month tenant -> landlord, no catalogue rent line for the tenant (the shared room and an NPC rental unchanged), each month once over a 12-month advance, the rent-gouger flag', async () => {
  const w = await world({ count: 4 });
  try {
    const [a, b, c, d] = w.students;
    w.advance(3);
    const rid = await w.landlord(a);
    const rent = Math.floor(129000 * 1.5);                                     // 150%: a gouger's rent
    assert.equal((await a.client.post('/api/housing/list', { home_id: rid, rent_cents: rent })).status, 200);
    assert.equal((await b.client.post('/api/housing/tenure', { tenure: `unit:${rid}` })).status, 200);
    assert.equal((await d.client.post('/api/housing/tenure', { tenure: 'apt1' })).status, 200);
    w.advance();
    const m = w.month();
    const txns = w.rentTxns();
    assert.equal(txns.length, 1);
    assert.deepEqual([txns[0].month, txns[0].rent, txns[0].tenantId, txns[0].landlordId, txns[0].homeId], [m, rent, b.id, a.id, rid]);
    const l = w.legs(txns[0].id);
    assert.deepEqual(l, [{ account_id: b.chequing.id, amount_cents: -rent }, { account_id: a.chequing.id, amount_cents: rent }], 'tenant and landlord chequing move by the same cents');
    assert.equal((await w.state(b)).tenure, `unit:${rid}`);
    assert.ok(w.app.db.prepare("SELECT 1 FROM feed_items WHERE text = ?").get(`${b.username} moved into ${a.username}'s condo`), 'feed: moved into the landlord\'s condo');
    assert.ok(w.app.db.prepare("SELECT 1 FROM feed_items WHERE text = ? AND cents = ?").get(`${a.username} listed a condo for rent at {$}`, rent));
    const thisMonth = async (s) => (await w.bills(s)).filter((x) => x.due_month === m).map((x) => x.bill_id);
    const bb = await thisMonth(b);
    assert.ok(!bb.includes('rent') && !bb.some((x) => x.startsWith('housing-')), `the tenant has no rent bill: ${bb}`);
    assert.ok((await thisMonth(c)).includes('rent'), 'the shared room still pays the catalogue rent');
    const dd = await thisMonth(d);
    assert.ok(dd.includes('housing-rent') && !dd.includes('rent'), 'an NPC rental replaces it with its own line');
    assert.equal(w.events.filter((e) => e.type === 'module.housing.payment' && e.kind === 'rent' && e.onTime).length, 1);
    // 12 months in one advance: 12 rent txns, one per month
    w.advance(12);
    const months = w.rentTxns().map((t) => t.month);
    assert.equal(months.length, 13);
    assert.deepEqual(months, Array.from({ length: 13 }, (_, i) => m + i));
    assert.equal(w.app.db.prepare("SELECT COUNT(*) AS n FROM housing_rent WHERE home_id = ? AND status = 'paid'").get(rid).n, 13);
    for (const s of [b]) assert.ok(!(await w.bills(s)).some((x) => x.bill_id === 'rent' && x.due_month > m - 1), 'never a catalogue rent line while a tenant');
    // rent at 150% of the NPC tier, with a tenant, 6+ months: the rent-gouger flag (leaderboards hears it through the rent payment event)
    assert.equal(w.app.db.prepare('SELECT gouge_months FROM leaderboards_inputs WHERE player_id = ?').get(a.id).gouge_months, 13);
    const f = (await w.teacher.get(`/api/leaderboards/flags?class_id=${w.cls.id}`)).json;
    const mine = JSON.stringify(f);
    assert.match(mine, /rent_gouger/);
    // the teacher sees the listing with the tenant and the NPC tier
    const t = (await w.teacher.get('/api/housing/teach')).json;
    const row = t.classes[0].listings.find((x) => x.home_id === rid);
    assert.deepEqual([row.landlord, row.tenant, row.rent_cents, row.npc_cents, row.arrears_cents], [a.username, b.username, rent, Math.round((129000 * w.app.world.priceIndex()) / 10000), 0]);   // the tier follows the price index
    assert.equal(t.classes[0].students.find((s) => s.id === b.id).tenure, `Rents from ${a.username}`);
    w.audit();
  } finally { await w.srv.cleanup(); }
});

test('missed rent: arrears, the $45 NSF fee (from chequing, else added to arrears), a credit late mark, stress, and eviction after three misses with the arrears written off', async () => {
  const w = await world({ count: 2 });
  try {
    const [a, b] = w.students;
    w.advance(3);
    const rid = await w.landlord(a);
    const rent = 129000;
    assert.equal((await a.client.post('/api/housing/list', { home_id: rid, rent_cents: rent })).status, 200);
    assert.equal((await b.client.post('/api/housing/tenure', { tenure: `unit:${rid}` })).status, 200);
    globalThis.__vdaaNoPay.add(b.id);
    w.drain(b, 10000);                                                         // $100: short of the rent, enough for the NSF fee
    w.advance();
    const m1 = w.month();
    let l = w.app.db.prepare('SELECT * FROM housing_listings WHERE home_id = ?').get(rid);
    assert.deepEqual([l.arrears_cents, l.missed_streak, l.tenant_id], [rent, 1, b.id]);
    assert.equal(w.chq(b), 10000 - 4500, 'the NSF fee came out of chequing');
    assert.equal(w.rentTxns().length, 0);
    const miss = w.events.filter((e) => e.type === 'module.housing.payment' && e.kind === 'rent');
    assert.deepEqual(miss.map((e) => [e.playerId, e.onTime, e.month, e.landlordId]), [[b.id, false, m1, a.id]]);
    assert.ok(w.app.db.prepare("SELECT 1 FROM credit_history WHERE player_id = ? AND source = 'housing' AND ref = 'rent' AND outcome = 'late'").get(b.id), 'credit marks it late');
    assert.match(w.app.db.prepare('SELECT why FROM stress_state WHERE player_id = ?').get(b.id).why, /housing payment/, 'stress +20');
    assert.ok(w.app.db.prepare("SELECT 1 FROM leaderboards_late WHERE player_id = ? AND key = ?").get(b.id, `r:${m1}`), 'leaderboards counts the late rent');
    w.drain(b);
    w.advance();                                                               // second miss: no money even for the fee, so it is added to the arrears
    l = w.app.db.prepare('SELECT * FROM housing_listings WHERE home_id = ?').get(rid);
    assert.deepEqual([l.arrears_cents, l.missed_streak], [2 * rent + 4500, 2]);
    w.drain(b);                                                                // (stress's emergency loan, paid out after the second miss, would cover it)
    w.advance();                                                               // third miss: evicted
    const m3 = w.month();
    l = w.app.db.prepare('SELECT * FROM housing_listings WHERE home_id = ?').get(rid);
    assert.deepEqual([l.tenant_id, l.listed, l.arrears_cents, l.missed_streak, l.evictions, l.written_off_cents, l.since_month], [null, 1, 0, 0, 1, 3 * rent + 9000, m3]);
    assert.equal((await w.state(b)).tenure, 'shared');
    const ev = w.events.filter((e) => e.type === 'module.housing.evicted');
    assert.deepEqual(ev.map((e) => [e.playerId, e.worldId, e.month, e.homeId]), [[b.id, w.app.world.current().id, m3, rid]]);
    assert.ok(w.app.db.prepare('SELECT 1 FROM feed_items WHERE text = ?').get(`${b.username} was evicted`));
    assert.match(w.app.db.prepare('SELECT why FROM stress_state WHERE player_id = ?').get(b.id).why, /vict/i);
    assert.equal(w.app.db.prepare("SELECT COUNT(*) AS n FROM housing_rent WHERE home_id = ? AND status = 'missed'").get(rid).n, 3);
    // the month after: the shared room's catalogue rent, no student rent
    globalThis.__vdaaNoPay.delete(b.id);
    w.advance();
    assert.ok((await w.bills(b)).some((x) => x.bill_id === 'rent' && x.due_month === w.month()));
    assert.equal(w.rentTxns().length, 0);
    // the teacher sees the eviction; the market shows the unit vacant again with the landlord's reputation (-3)
    const t = (await w.teacher.get('/api/housing/teach')).json;
    assert.equal(t.classes[0].evictions, 1);
    assert.equal((await b.client.get('/api/housing/market')).json.listings[0].reputation, -3);
    w.audit();
  } finally { await w.srv.cleanup(); }
});

test('a vacancy still costs every owner line; notices (landlord one month, tenant next month), a rent change with two months notice, a sale ends the tenancy, and the arrears are collected when a tenant can pay at move-out', async () => {
  const w = await world({ count: 3 });
  try {
    const [a, b, c] = w.students;
    w.advance(3);
    const rid = await w.landlord(a);
    assert.equal((await a.client.post('/api/housing/list', { home_id: rid, rent_cents: 129000 })).status, 200);
    w.advance();
    const m = w.month();
    const due = (await w.bills(a)).filter((x) => x.due_month === m).map((x) => x.bill_id);
    for (const key of ['property-tax-rental', 'condo-fees-rental', 'home-insurance-rental']) assert.ok(due.includes(`housing-${key}`), `vacant: ${key}`);
    assert.ok(w.events.some((e) => e.type === 'module.housing.payment' && e.homeId === rid && e.month === m && e.onTime), 'vacant: the rental mortgage is paid');
    assert.equal(w.rentTxns().length, 0);
    assert.equal((await b.client.get('/api/housing/market')).json.listings[0].months_vacant, 1);
    // b moves in; the landlord raises the rent with two months' notice
    assert.equal((await b.client.post('/api/housing/tenure', { tenure: `unit:${rid}` })).status, 200);
    w.advance();
    const r = await a.client.post('/api/housing/rent', { home_id: rid, rent_cents: 152000 });
    assert.equal(r.status, 200, JSON.stringify(r.json));
    assert.equal(r.json.from_month, w.month() + 2);
    assert.ok(w.app.db.prepare('SELECT 1 FROM feed_items WHERE text = ? AND cents = 152000').get(`${a.username} raised the rent on their condo to {$}`), 'feed item when announced');
    assert.equal((await a.client.post('/api/housing/rent', { home_id: rid, rent_cents: 200000 })).status, 400, 'still inside the band');
    w.advance();
    assert.equal(w.rentTxns().at(-1).rent, 129000);
    w.advance();
    assert.equal(w.rentTxns().at(-1).rent, 152000, 'the new rent from the announced month');
    // the landlord ends the tenancy: one month's notice, cannot be repeated, the tenant cannot cancel it
    const e = await a.client.post('/api/housing/end-tenancy', { home_id: rid });
    assert.equal(e.status, 200, JSON.stringify(e.json));
    assert.equal(e.json.moves_out_month, w.month() + 1);
    assert.equal((await a.client.post('/api/housing/end-tenancy', { home_id: rid })).status, 409);
    assert.equal((await b.client.post('/api/housing/tenure', { tenure: `unit:${rid}` })).status, 400);
    const n = w.rentTxns().length;
    w.advance();
    assert.equal((await w.state(b)).tenure, 'shared');
    assert.equal(w.rentTxns().length, n, 'no rent in the month they leave');
    assert.ok((await w.bills(b)).some((x) => x.bill_id === 'rent' && x.due_month === w.month()), 'back in the shared room: catalogue rent');
    // the tenant gives notice: they move next month, no rent that month; arrears left are collected when chequing covers them
    assert.equal((await c.client.post('/api/housing/tenure', { tenure: `unit:${rid}` })).status, 200);
    w.advance();
    w.app.db.prepare('UPDATE housing_listings SET arrears_cents = 5000 WHERE home_id = ?').run(rid);   // a leftover the tenant still owes
    assert.equal((await c.client.post('/api/housing/tenure', { tenure: 'shared' })).status, 200);
    const k = w.rentTxns().length;
    w.advance();
    const after = w.rentTxns().slice(k);
    assert.deepEqual(after.map((t) => [t.rent, t.arrears]), [[0, 5000]], 'only the arrears, collected at the move');
    assert.deepEqual(w.legs(after[0].id), [{ account_id: c.chequing.id, amount_cents: -5000 }, { account_id: a.chequing.id, amount_cents: 5000 }]);
    // a sale ends a tenancy at once
    assert.equal((await b.client.post('/api/housing/tenure', { tenure: `unit:${rid}` })).status, 200);
    w.advance();
    assert.equal((await w.state(b)).tenure, `unit:${rid}`);
    const s = await a.client.post('/api/housing/sell', { home_id: rid });
    assert.equal(s.status, 200, JSON.stringify(s.json));
    assert.equal((await w.state(b)).tenure, 'shared');
    const l = w.app.db.prepare('SELECT * FROM housing_listings WHERE home_id = ?').get(rid);
    assert.deepEqual([l.tenant_id, l.listed], [null, 0]);
    const k2 = w.rentTxns().length;
    w.advance();
    assert.equal(w.rentTxns().length, k2);
    w.audit();
  } finally { await w.srv.cleanup(); }
});

test('season close: homes, listings and tenancies end with the world, both homes count in the season result, and the audit is clean', async () => {
  const w = await world({ count: 2 });
  try {
    const [a, b] = w.students;
    w.advance(3);
    const rid = await w.landlord(a);
    assert.equal((await a.client.post('/api/housing/list', { home_id: rid, rent_cents: 129000 })).status, 200);
    assert.equal((await b.client.post('/api/housing/tenure', { tenure: `unit:${rid}` })).status, 200);
    w.advance(2);
    const old = w.app.world.current().id;
    const homes = w.app.db.prepare("SELECT SUM(value_cents) AS v FROM housing_homes WHERE player_id = ? AND status = 'owned'").get(a.id).v;
    const ledger = w.app.db.prepare("SELECT SUM(balance_cents) AS n FROM accounts WHERE owner_type = 'player' AND owner_id = ?").get(a.id).n;
    w.app.world.close();
    assert.equal(w.app.db.prepare('SELECT net_worth_cents FROM season_results WHERE world_id = ? AND player_id = ?').get(old, a.id).net_worth_cents, ledger + homes);
    assert.equal(w.app.db.prepare("SELECT COUNT(*) AS n FROM accounts WHERE owner_type = 'player' AND balance_cents <> 0").get().n, 0);
    assert.equal(w.app.db.prepare("SELECT COUNT(*) AS n FROM housing_homes WHERE world_id = ? AND status = 'owned'").get(old).n, 0);
    assert.equal(w.app.db.prepare('SELECT COUNT(*) AS n FROM housing_listings WHERE world_id = ? AND (listed = 1 OR tenant_id IS NOT NULL)').get(old).n, 0);
    w.app.world.create({ name: 'Season 2' });
    const nw = w.app.world.current().id;
    assert.equal(w.app.db.prepare('SELECT COUNT(*) AS n FROM housing_listings WHERE world_id = ?').get(nw).n, 0);
    assert.equal((await w.state(b)).tenure, 'shared');
    w.advance(2);
    assert.equal(w.app.db.prepare('SELECT COUNT(*) AS n FROM housing_rent WHERE world_id = ?').get(nw).n, 0, 'no rent in the new world');
    w.audit();
  } finally { await w.srv.cleanup(); }
});

test('bills: a housed flag that arrives after bills issued the month applies next month (no catalogue rent then, never a reversal); an older payload without the flag keeps the old rule', async () => {
  const w = await world({ count: 2 });
  try {
    const [a, b] = w.students;
    w.advance(3);
    const m = w.month();
    assert.ok((await w.bills(a)).some((x) => x.bill_id === 'rent' && x.due_month === m), 'already issued this month');
    w.app.events.emit('module.housing.costs', { playerId: a.id, month: m, lines: [], housed: true });   // late: misordered, or a test
    assert.equal(w.app.db.prepare('SELECT housed FROM bills_housed WHERE player_id = ? AND month = ?').get(a.id, m + 1).housed, 1);
    assert.equal(w.app.db.prepare('SELECT COUNT(*) AS n FROM bills_housed WHERE player_id = ? AND month = ?').get(a.id, m).n, 0);
    w.app.events.emit('module.housing.costs', { playerId: b.id, month: m + 1, lines: [{ key: 'x', name: 'Old line', amount: 100, category: 'needs' }] });   // no flag
    w.advance();
    const due = async (s) => (await w.bills(s)).filter((x) => x.due_month === m + 1).map((x) => x.bill_id);
    assert.ok((await due(a)).includes('rent') === false, 'housed next month: no catalogue rent');
    assert.ok((await w.bills(a)).some((x) => x.bill_id === 'rent' && x.due_month === m), 'this month is not reversed');
    assert.ok(!(await due(b)).includes('rent') && (await due(b)).includes('housing-x'), 'no flag: any housing line replaces the rent, as before');
    w.audit();
  } finally { await w.srv.cleanup(); }
});

// ---- fix round 1 (review) ----
const listAt = async (w, s, rid, cents) => assert.equal((await s.client.post('/api/housing/list', { home_id: rid, rent_cents: cents })).status, 200);
const listing = (w, rid) => w.app.db.prepare('SELECT * FROM housing_listings WHERE home_id = ?').get(rid);

test('review 1: an announced rent change never follows a leaving tenant to the next one: it applies when the unit falls vacant, and the next tenant pays what the market showed', async () => {
  const w = await world({ count: 4 });
  try {
    const [a, b, c, d] = w.students;
    w.advance(3);
    const rid = await w.landlord(a);
    await listAt(w, a, rid, 129000);
    assert.equal((await b.client.post('/api/housing/tenure', { tenure: `unit:${rid}` })).status, 200);
    w.advance();                                                                // b lives there at $1,290
    assert.equal((await a.client.post('/api/housing/rent', { home_id: rid, rent_cents: 190000 })).status, 200);   // announced for month + 2
    assert.equal((await a.client.post('/api/housing/end-tenancy', { home_id: rid })).status, 200);
    w.advance();                                                                // b leaves; the unit is vacant
    let l = listing(w, rid);
    assert.deepEqual([l.tenant_id, l.pending_rent_cents, l.rent_from, l.rent_cents], [null, null, null, 190000], 'the change applied at the vacancy');
    const shown = (await c.client.get('/api/housing/market')).json.listings.find((x) => x.home_id === rid).rent_cents;
    assert.equal(shown, 190000);
    assert.equal((await c.client.post('/api/housing/tenure', { tenure: `unit:${rid}` })).status, 200);
    w.advance(3);
    assert.deepEqual([...new Set(w.rentTxns().filter((t) => t.tenantId === c.id).map((t) => t.rent))], [shown], 'the next tenant pays what the market showed, from the start');
    // the deliberate version: accept a reservation, announce a rise, cancel the reservation: the rise is simply the new asking rent
    assert.equal((await c.client.post('/api/housing/tenure', { tenure: 'shared' })).status, 200);
    w.advance();
    assert.equal((await d.client.post('/api/housing/tenure', { tenure: `unit:${rid}` })).status, 200);
    assert.equal((await a.client.post('/api/housing/rent', { home_id: rid, rent_cents: 150000 })).status, 200);
    assert.equal(listing(w, rid).pending_rent_cents, 150000, 'a reservation gets notice');
    assert.equal((await a.client.post('/api/housing/end-tenancy', { home_id: rid })).status, 200);   // cancels the reservation at once
    l = listing(w, rid);
    assert.deepEqual([l.tenant_id, l.pending_rent_cents, l.rent_cents], [null, null, 150000]);
    w.audit();
  } finally { await w.srv.cleanup(); }
});

test('review 2: a tenant who buys a home pays the rent arrears first (refused when chequing cannot cover both); moving out collects what chequing has and writes off only the rest', async () => {
  const w = await world({ count: 3 });
  try {
    const [a, b, c] = w.students;
    w.advance(3);
    const rid = await w.landlord(a);
    await listAt(w, a, rid, 129000);
    assert.equal((await b.client.post('/api/housing/tenure', { tenure: `unit:${rid}` })).status, 200);
    w.advance();
    w.app.db.prepare('UPDATE housing_listings SET arrears_cents = 50000, missed_streak = 1 WHERE home_id = ?').run(rid);
    const q = (await b.client.post('/api/housing/qualify', { down_cents: 1010000, amort_years: 25 })).json;
    w.drain(b); w.give(b, q.cashNeededCents + 49999);
    const short = await b.client.post('/api/housing/buy', { down_cents: 1010000, amort_years: 25 });
    assert.equal(short.status, 400);
    assert.match(short.json.error, /owe \$500\.00 in rent/);
    w.give(b, 1);
    const landlordBefore = w.chq(a);
    assert.equal((await b.client.post('/api/housing/buy', { down_cents: 1010000, amort_years: 25 })).status, 200);
    assert.equal(w.chq(a), landlordBefore + 50000, 'the arrears reached the landlord');
    assert.deepEqual([listing(w, rid).tenant_id, listing(w, rid).written_off_cents], [null, 0]);
    assert.equal(w.chq(b), 0);
    // voluntary move-out with arrears larger than chequing: what is there is collected, the rest written off
    assert.equal((await c.client.post('/api/housing/tenure', { tenure: `unit:${rid}` })).status, 200);
    w.advance();
    w.app.db.prepare('UPDATE housing_listings SET arrears_cents = 50000, missed_streak = 1 WHERE home_id = ?').run(rid);
    assert.equal((await c.client.post('/api/housing/tenure', { tenure: 'shared' })).status, 200);
    globalThis.__vdaaNoPay.add(c.id);
    w.drain(c, 20000);
    w.advance();
    const t = w.rentTxns().at(-1);
    assert.deepEqual([t.tenantId, t.rent, t.arrears], [c.id, 0, 20000]);
    assert.equal(listing(w, rid).written_off_cents, 30000);
    w.audit();
  } finally { await w.srv.cleanup(); }
});

test('review 3: moving straight from one classmate\'s unit to another, and swapping one reservation for another, never a 500; your own unit is never offered back to you', async () => {
  const w = await world({ count: 5 });
  try {
    const [a, d, f, b, c] = w.students;
    w.advance(3);
    const x = await w.landlord(a), y = await w.landlord(d), z = await w.landlord(f);
    for (const [s, id] of [[a, x], [d, y], [f, z]]) await listAt(w, s, id, 129000);
    // a reservation swapped for another: X released, Y reserved
    assert.equal((await c.client.post('/api/housing/tenure', { tenure: `unit:${x}` })).status, 200);
    const sw = await c.client.post('/api/housing/tenure', { tenure: `unit:${y}` });
    assert.equal(sw.status, 200, JSON.stringify(sw.json));
    assert.deepEqual([listing(w, x).tenant_id, listing(w, y).tenant_id], [null, c.id]);
    assert.equal((await b.client.post('/api/housing/tenure', { tenure: `unit:${x}` })).status, 200);
    w.advance();
    assert.equal((await w.state(b)).tenure, `unit:${x}`);
    assert.ok(!(await b.client.get('/api/housing/market')).json.listings.some((l) => l.home_id === x || l.home_id === y), 'a unit you live in or someone reserved is not offered');
    // lived-in X -> Z: allowed; b holds X until the tick and Z from now
    const mv = await b.client.post('/api/housing/tenure', { tenure: `unit:${z}` });
    assert.equal(mv.status, 200, JSON.stringify(mv.json));
    assert.deepEqual([listing(w, x).tenant_id, listing(w, z).tenant_id], [b.id, b.id]);
    assert.equal((await b.client.post('/api/housing/tenure', { tenure: `unit:${y}` })).status, 409, 'Y is c\'s');
    w.advance();
    assert.equal((await w.state(b)).tenure, `unit:${z}`);
    assert.deepEqual([listing(w, x).tenant_id, listing(w, z).tenant_id], [null, b.id]);
    const last = w.rentTxns().filter((t) => t.month === w.month());
    assert.deepEqual(last.map((t) => [t.tenantId, t.homeId]).sort(), [[b.id, z], [c.id, y]].sort(), 'each pays the new unit only');
    w.audit();
  } finally { await w.srv.cleanup(); }
});

test('review 4 + 5: buying a primary counts a rental\'s mortgage in TDS; the teacher warning and the rentals table see a rental mortgage behind', async () => {
  const w = await world({ count: 2 });
  try {
    const [a] = w.students;
    w.advance(3);
    const rid = await w.landlord(a);
    const primary = w.app.db.prepare("SELECT id FROM housing_homes WHERE player_id = ? AND role = 'primary'").get(a.id).id;
    assert.equal((await a.client.post('/api/housing/sell', { home_id: primary })).status, 200);
    const rentalPay = w.app.db.prepare('SELECT payment_cents FROM housing_homes WHERE id = ?').get(rid).payment_cents;
    const q = (await a.client.post('/api/housing/qualify', { down_cents: 1010000, amort_years: 25 })).json;
    assert.equal(q.otherDebtCents, rentalPay, 'the rental payment is a debt for the new primary');
    // the rental's mortgage bounces three months running: the teacher is warned, and the rentals row shows it
    globalThis.__vdaaNoPay.add(a.id);
    for (let i = 0; i < 3; i++) { w.drain(a); w.advance(); }
    const t = (await w.teacher.get('/api/housing/teach')).json;
    assert.deepEqual(t.warnings.map((x) => [x.username, x.missed_streak]), [[a.username, 3]]);
    const row = t.classes[0].listings.find((x) => x.home_id === rid);
    assert.equal(row.mortgage_missed_streak, 3);
    assert.ok(row.mortgage_arrears_cents > 0);
    w.audit();
  } finally { await w.srv.cleanup(); }
});

test('review 6: selling a let rental keeps the tenant\'s planned move', async () => {
  const w = await world({ count: 2 });
  try {
    const [a, b] = w.students;
    w.advance(3);
    const rid = await w.landlord(a);
    await listAt(w, a, rid, 129000);
    assert.equal((await b.client.post('/api/housing/tenure', { tenure: `unit:${rid}` })).status, 200);
    w.advance();
    assert.equal((await b.client.post('/api/housing/tenure', { tenure: 'apt1' })).status, 200);
    assert.equal((await a.client.post('/api/housing/sell', { home_id: rid })).status, 200);
    const st = await w.state(b);
    assert.deepEqual([st.tenure, st.pending_tenure], ['shared', 'apt1']);
    w.advance();
    assert.equal((await w.state(b)).tenure, 'apt1');
    w.audit();
  } finally { await w.srv.cleanup(); }
});

test('review 7: with payments between classmates off for the class, listing and renting a classmate\'s unit are refused (409), and the state says so', async () => {
  const w = await world({ count: 2 });
  try {
    const [a, b] = w.students;
    w.advance(3);
    const rid = await w.landlord(a);
    await listAt(w, a, rid, 129000);
    assert.equal((await w.teacher.post('/api/bank-basic/settings', { class_id: w.cls.id, enabled: false, per_transfer_cents: 100000, daily_cents: 10000000 })).status, 200);
    const r = await b.client.post('/api/housing/tenure', { tenure: `unit:${rid}` });
    assert.equal(r.status, 409);
    assert.match(r.json.error, /turned off/);
    assert.equal((await a.client.post('/api/housing/unlist', { home_id: rid })).status, 200);
    assert.equal((await a.client.post('/api/housing/list', { home_id: rid, rent_cents: 129000 })).status, 409);
    assert.equal((await w.state(b)).student_rent, false);
    assert.equal(w.app.modules.kernel('housing').modules.call('bank-basic', 'transfersEnabled', { classId: w.cls.id }).enabled, false);
  } finally { await w.srv.cleanup(); }
});
