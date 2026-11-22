// The services wave 5b's life module calls (docs/phase5-life.md 5b, "As built (5b deps)"): exchange.stageEvent, rates.queueRate, housing.marketEvent and
// exchange.allocation, through k.modules.call from a fake caller module. They reuse the teacher levers' code paths; there is no route for them.
// The real bank-basic, rates, housing, exchange and savings run; a fake `jobs` emits module.jobs.paid with a known gross (housing needs income to lend).
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { ROOT } from '../lib/app.js';
import { boot, seeded, tmpDir } from './helpers.js';
import { monthStep } from '../modules/exchange/prices.js';
import { SECURITIES, UNIT } from '../modules/exchange/constants.js';
import { proceedsCents, sides } from '../modules/exchange/orders.js';

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
// The caller: queues a policy rate from inside its own tick when options.caller.rateAt is that month (a stage event fired during an advance).
const caller = `import { defineModule } from '${MODULES_URL}';
export default defineModule({ id: 'caller', options: { rateAt: 'month', rateBp: 'bp' }, onTick(k, { month }) {
  if (month === k.config.rateAt) k.modules.call('rates', 'queueRate', { rate_bp: k.config.rateBp });
} });`;

async function world(callerOpts = {}) {
  const d = tmpDir(); made.push(d);
  for (const id of ['bank-basic', 'rates', 'housing', 'exchange', 'savings']) fs.symlinkSync(path.join(ROOT, 'modules', id), path.join(d, id));
  fs.mkdirSync(path.join(d, 'jobs')); fs.writeFileSync(path.join(d, 'jobs', 'index.js'), fakeJobs);
  fs.mkdirSync(path.join(d, 'caller')); fs.writeFileSync(path.join(d, 'caller', 'index.js'), caller);
  const mods = ['bank-basic', 'rates', 'jobs', 'housing', 'exchange', 'savings', 'caller'];
  const config = { courses: { fintech10: { label: 'x', modules: mods }, fintech2030: { label: 'y', modules: mods } }, options: { 'bank-basic': { startCents: 50000 }, caller: callerOpts } };
  const srv = await boot({ config, modulesDir: d });
  const t = await seeded(srv, 2, { transfers: false });
  const { app } = srv;
  const k = app.modules.kernel('caller');
  const wid = () => app.world.current().id;
  app.db.prepare("INSERT OR IGNORE INTO exchange_secrets (world_id, secret) VALUES (?, 'test-secret')").run(wid());   // a fixed price path
  const give = (s, cents) => app.ledger.post({ kind: 'test.grant', legs: [{ account: app.ledger.system('mint'), cents: -cents }, { account: s.chequing.id, cents }] });
  const audit = () => { const a = app.ledger.audit(); assert.equal(a.ok, true, JSON.stringify(a.problems)); };
  const status = (fn) => { try { fn(); return 200; } catch (e) { return e.status; } };
  return { srv, app, ...t, k, wid, give, audit, status, advance: (n = 1) => app.world.advance({ months: n }) };
}

test('exchange.stageEvent: queued for the next tick like the teacher event, with its own headline; idempotent per world, month and kind; validated', async () => {
  const w = await world();
  try {
    w.advance();                                                                          // month 2: prices exist
    const month = w.app.world.current().month;
    const first = w.k.modules.call('exchange', 'stageEvent', { kind: 'crash', headline: 'A market crash at age 48' });
    assert.deepEqual({ ...first, id: 0 }, { id: 0, kind: 'crash', ticker: null, headline: 'A market crash at age 48', month, appliesFromMonth: month + 1, already: false });
    const again = w.k.modules.call('exchange', 'stageEvent', { kind: 'crash', headline: 'fired twice' });
    assert.deepEqual(again, { ...first, already: true }, 'a re-fire returns the queued event');
    assert.equal(w.app.db.prepare("SELECT COUNT(*) AS n FROM exchange_events WHERE kind = 'crash'").get().n, 1);
    assert.equal(w.app.db.prepare('SELECT by_player FROM exchange_events WHERE id = ?').get(first.id).by_player, null);
    for (const bad of [{ kind: 'meteor' }, {}, { kind: 'scandal' }, { kind: 'scandal', ticker: 'DAAX' }, { kind: 'rally', headline: 'x'.repeat(121) }, { kind: 'rally', headline: '   ' }, { kind: 'rally', headline: 5 }]) {
      assert.equal(w.status(() => w.k.modules.call('exchange', 'stageEvent', bad)), 400, JSON.stringify(bad));
    }
    const boom = w.k.modules.call('exchange', 'stageEvent', { kind: 'boom', ticker: 'KEYS' });   // a stock-scope kind takes a town company's ticker; no headline = the template
    assert.equal(boom.ticker, 'KEYS'); assert.equal(boom.headline, null);
    // the next tick applies it exactly as monthStep does with the event, and the news shows the headline
    const prev = Object.fromEntries(w.app.db.prepare('SELECT ticker, price_micro FROM exchange_prices WHERE world_id = ? AND month = ?').all(w.wid(), month).map((r) => [r.ticker, r.price_micro]));
    const want = monthStep({ worldId: w.wid(), secret: 'test-secret', month: month + 1, prev, securities: SECURITIES, events: [{ kind: 'crash', ticker: null }, { kind: 'boom', ticker: 'KEYS' }] });
    w.advance();
    const got = Object.fromEntries(w.app.db.prepare('SELECT ticker, price_micro FROM exchange_prices WHERE world_id = ? AND month = ?').all(w.wid(), month + 1).map((r) => [r.ticker, r.price_micro]));
    assert.deepEqual(got, want.price);
    assert.equal(w.app.db.prepare('SELECT applied_month FROM exchange_events WHERE id = ?').get(first.id).applied_month, month + 1);
    const news = w.app.db.prepare("SELECT text FROM exchange_news WHERE world_id = ? AND month = ? AND kind = 'event'").all(w.wid(), month + 1).map((r) => r.text);
    assert.ok(news.includes('A market crash at age 48'), JSON.stringify(news));
    assert.ok(news.some((t) => /Keystone Distribution \(KEYS\) booms/.test(t)), JSON.stringify(news));
    // a new month is a new key
    assert.equal(w.k.modules.call('exchange', 'stageEvent', { kind: 'crash' }).already, false);
    w.audit();
    w.app.world.close();
    assert.equal(w.status(() => w.k.modules.call('exchange', 'stageEvent', { kind: 'rally' })), 409, 'between seasons');
  } finally { await w.srv.cleanup(); }
});

test('rates.queueRate: the teacher policy path (applies at the next tick, bond funds pause, new mortgages price it in), and from inside an advance leaves nothing stale', async () => {
  const w = await world({ rateAt: 3, rateBp: 400 });
  try {
    const [s] = w.students;
    w.advance();                                                                          // month 2: rates' first tick, policy 225
    for (const bad of [-1, 1001, 2.5, '300', undefined]) assert.equal(w.status(() => w.k.modules.call('rates', 'queueRate', { rate_bp: bad })), 400, String(bad));
    const r = w.k.modules.call('rates', 'queueRate', { rate_bp: 300 });
    assert.deepEqual(r, { policy_bp: 300, applies_from_month: 3, cancelled: false });
    // module.rates.pending reached exchange and housing at once (inside the call), as the teacher's does after commit
    assert.deepEqual({ ...w.app.db.prepare('SELECT pending_bp, effective_month FROM exchange_rate_pending WHERE world_id = ?').get(w.wid()) }, { pending_bp: 300, effective_month: 3 });
    assert.equal(w.app.db.prepare('SELECT mortgage5y_bp FROM housing_rates_pending WHERE world_id = ?').get(w.wid()).mortgage5y_bp, 495);
    const st = (await s.client.get('/api/exchange/state')).json;
    assert.match(st.securities.find((q) => q.ticker === 'DAAB').paused, /policy rate/);
    assert.equal(st.securities.find((q) => q.ticker === 'DAAX').paused, null);
    assert.equal((await s.client.post('/api/housing/qualify', { down_cents: 1010000, amort_years: 25 })).json.contractBp, 495, 'new mortgages price in the announced rate');
    // the caller's own tick queues 400 in month 3; month 4 applies it; the two-month advance must not leave month 3's "pending" behind
    w.advance(2);
    const cur = (await w.teacher.get('/api/rates/current')).json;
    assert.deepEqual([cur.policy_bp, cur.pending_bp, cur.history.map((h) => [h.month, h.policy_bp])], [400, null, [[2, 225], [3, 300], [4, 400]]]);
    assert.equal(w.app.db.prepare('SELECT COUNT(*) AS n FROM exchange_rate_pending WHERE world_id = ?').get(w.wid()).n, 0);
    assert.equal(w.app.db.prepare('SELECT COUNT(*) AS n FROM housing_rates_pending WHERE world_id = ?').get(w.wid()).n, 0);
    assert.equal(w.app.db.prepare('SELECT mortgage5y_bp FROM housing_rates WHERE world_id = ?').get(w.wid()).mortgage5y_bp, 595);
    // queuing the rate in force cancels, as the route does
    w.k.modules.call('rates', 'queueRate', { rate_bp: 500 });
    assert.deepEqual(w.k.modules.call('rates', 'queueRate', { rate_bp: 400 }), { policy_bp: 400, applies_from_month: 5, cancelled: true });
    assert.equal(w.app.db.prepare('SELECT COUNT(*) AS n FROM exchange_rate_pending WHERE world_id = ?').get(w.wid()).n, 0);
    w.audit();
  } finally { await w.srv.cleanup(); }
});

test('housing.marketEvent: every owner moves at once by 5-15% (savings hears it inside the call), validated, recorded with no teacher', async () => {
  const w = await world();
  try {
    const [a, b] = w.students;
    w.advance(3);
    w.give(a, 2000000);
    assert.equal((await a.client.post('/api/housing/buy', { down_cents: 1010000, amort_years: 25 })).status, 200);
    for (const bad of [3, -4, 16, -20, 7.5, '10', undefined]) assert.equal(w.status(() => w.k.modules.call('housing', 'marketEvent', { pct: bad })), 400, String(bad));
    const seen = [];
    w.app.events.on('module.housing.value', (p) => seen.push({ ...p, inTx: w.app.db.isTransaction }));
    const r = w.k.modules.call('housing', 'marketEvent', { pct: -10 });
    assert.deepEqual(r, { pct: -10, homes: 1, month: 4 });
    assert.deepEqual(seen.map((p) => [p.playerId, p.homeValue, p.inTx]), [[a.id, 18180000, true]]);
    assert.equal((await a.client.get('/api/housing/state')).json.home.value_cents, 18180000);
    assert.equal((await a.client.get('/api/savings/status')).json.home_value_cents, 18180000);
    assert.deepEqual(w.app.db.prepare('SELECT month, pct, by_player FROM housing_market WHERE world_id = ?').all(w.wid()).map((r) => ({ ...r })), [{ month: 4, pct: -10, by_player: null }]);
    assert.equal(w.k.modules.call('housing', 'marketEvent', { pct: 15 }).homes, 1);
    assert.equal((await b.client.get('/api/housing/state')).json.home, null);
    w.audit();
  } finally { await w.srv.cleanup(); }
});

test('exchange.allocation: equities, bonds, cash and other at the bid across the three accounts; the balanced fund splits 60/40; read-only', async () => {
  const w = await world();
  try {
    const [a, b] = w.students;
    w.give(a, 5000000);
    const post = (p, body) => a.client.post(`/api/exchange${p}`, body);
    assert.equal((await post('/contribute', { account: 'tfsa', cents: 700000 })).status, 200);
    assert.equal((await post('/contribute', { account: 'invest', cents: 2000000 })).status, 200);
    for (const [ticker, account, cents] of [['DAAX', 'tfsa', 300000], ['DAAG', 'tfsa', 300000], ['DAAB', 'invest', 500000]]) assert.equal((await post('/order', { ticker, account, side: 'buy', type: 'market', cents })).status, 200, ticker);
    assert.equal((await post('/order', { ticker: 'KEYS', account: 'invest', side: 'buy', type: 'market', units_micro: 10 * UNIT })).status, 200);
    const bid = (t, units) => proceedsCents(units, sides(SECURITIES.find((s) => s.ticker === t).startMicro, t === 'KEYS' ? 100 : 20).bid);
    const units = (t) => w.app.db.prepare('SELECT SUM(units_micro) AS n FROM exchange_holdings WHERE player_id = ? AND ticker = ?').get(a.id, t).n;
    const cash = ['invest', 'tfsa', 'rrsp', 'xhold'].reduce((t, kind) => { const id = w.app.ledger.accountId('player', a.id, kind); return t + (id ? w.app.ledger.balance(id) : 0); }, 0);
    const daag = bid('DAAG', units('DAAG')), eq = Math.round(daag * 0.6);
    const before = w.app.ledger.audit();
    const got = w.k.modules.call('exchange', 'allocation', { playerId: a.id });
    assert.deepEqual(got, { equities: bid('DAAX', units('DAAX')) + bid('KEYS', units('KEYS')) + eq, bonds: bid('DAAB', units('DAAB')) + daag - eq, cash, other: 0 });
    const valued = w.app.db.prepare('SELECT cents FROM exchange_valued WHERE player_id = ?').get(a.id).cents;
    assert.equal(got.equities + got.bonds + got.other, valued, 'the same holdings value the net worth uses');
    assert.deepEqual(w.k.modules.call('exchange', 'allocation', { playerId: b.id }), { equities: 0, bonds: 0, cash: 0, other: 0 });
    for (const bad of [undefined, 'x', 1.5]) assert.equal(w.status(() => w.k.modules.call('exchange', 'allocation', { playerId: bad })), 400);
    assert.equal(w.app.ledger.audit().moneySupply, before.moneySupply, 'nothing posted');
  } finally { await w.srv.cleanup(); }
});
