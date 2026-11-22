// Phase 4 foundations in the core (docs/modules.md "Services" and "Business owners"): module service calls, business-owned accounts at season
// close and in the SSE balance hints, the core price index, payload worldId preferred by listeners, and exchange's listSecurity / delistSecurity.
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { ROOT, createApp } from '../lib/app.js';
import { defineModule } from '../lib/modules.js';
import { boot, seeded, tmpDir, openStream } from './helpers.js';

const MODULES_URL = pathToFileURL(path.join(ROOT, 'lib', 'modules.js')).href;
const made = [];
after(() => { for (const d of made) fs.rmSync(d, { recursive: true, force: true }); });
const dir = () => { const d = tmpDir(); made.push(d); return d; };
// A modules directory: real modules symlinked in, plus fixtures written from source.
function modulesDir({ link = [], src = {} }) {
  const d = dir();
  for (const id of link) fs.symlinkSync(path.join(ROOT, 'modules', id), path.join(d, id));
  for (const [id, code] of Object.entries(src)) {
    fs.mkdirSync(path.join(d, id));
    fs.writeFileSync(path.join(d, id, 'index.js'), `import { defineModule } from '${MODULES_URL}';\n${code}`);
  }
  return d;
}
const cfg = (modules, options = {}) => ({ courses: { fintech10: { label: 'FT10', modules } }, options: { 'bank-basic': { startCents: 50000 }, ...options } });

// ---------- 1. service calls ----------

const SVC = `export default defineModule({ id: 'svc',
  migrations: [{ id: '001_init', sql: 'CREATE TABLE svc_log (note TEXT)' }],
  services: {
    add(k, args, { from }) {
      k.db.prepare('INSERT INTO svc_log VALUES (?)').run(\`\${from}:\${args.a + args.b}\`);
      args.a = 999;                                                     // the caller's object must not change
      const txn = k.ledger.post({ kind: 'grant', legs: [{ account: k.ledger.system('mint'), cents: -1 }, { account: k.ledger.system('sink'), cents: 1 }] });
      return { sum: args.b + 1, id: k.id, from, kind: k.db.prepare('SELECT kind FROM txns WHERE id = ?').get(txn).kind, list: [1, 2] };
    },
    boom(k) { k.db.prepare("INSERT INTO svc_log VALUES ('boom')").run(); throw new k.HttpError(409, 'svc says no'); },
    fn() { return { f: () => 1 }; },
  },
});`;
const CALLER = `export default defineModule({ id: 'caller', migrations: [{ id: '001_init', sql: 'CREATE TABLE caller_log (note TEXT)' }] });`;

test('services: a call runs the callee with its own k, in the caller\'s transaction; errors reach the caller; args and results are copies; unknown module or service is a clear error', async () => {
  assert.throws(() => defineModule({ id: 'badsvc', services: { x: 1 } }), /module "badsvc": services\.x: must be a function/);
  assert.throws(() => defineModule({ id: 'badsvc', services: [] }), /module "badsvc": services: must be an object/);
  const app = await createApp({ dataDir: dir(), config: cfg(['svc', 'caller']), modulesDir: modulesDir({ src: { svc: SVC, caller: CALLER } }) });
  try {
    const k = app.modules.kernel('caller');
    const log = () => app.db.prepare('SELECT note FROM svc_log').all().map((r) => r.note);
    assert.equal(k.modules.has('svc'), true);
    assert.equal(k.modules.has('ventures'), false);

    const args = { a: 2, b: 3 };
    const r = k.modules.call('svc', 'add', args);
    assert.deepEqual(r, { sum: 4, id: 'svc', from: 'caller', kind: 'svc.grant', list: [1, 2] });   // the callee's k: its ledger kind prefix
    assert.equal(args.a, 2, 'the callee got a copy of the args');
    assert.deepEqual(log(), ['caller:5']);
    assert.equal(app.db.isTransaction, false, 'a call outside a transaction opened (and committed) its own');

    // inside the caller's transaction: a later throw in the caller rolls the callee's writes back too
    assert.throws(() => k.db.txn(() => { k.modules.call('svc', 'add', { a: 1, b: 1 }); throw new Error('caller fails'); }), /caller fails/);
    assert.deepEqual(log(), ['caller:5']);

    // a callee that throws: the error reaches the caller as is; only the callee's own writes are undone, the caller's stand if it carries on
    k.db.txn(() => {
      k.db.prepare("INSERT INTO caller_log VALUES ('before')").run();
      assert.throws(() => k.modules.call('svc', 'boom', {}), (e) => e.status === 409 && e.message === 'svc says no');
      k.db.prepare("INSERT INTO caller_log VALUES ('after')").run();
    });
    assert.deepEqual(log(), ['caller:5']);
    assert.deepEqual(app.db.prepare('SELECT note FROM caller_log').all().map((x) => x.note), ['before', 'after']);

    assert.throws(() => k.modules.call('ventures', 'list', {}), /module "caller": k\.modules\.call: module "ventures" is not loaded/);
    assert.throws(() => k.modules.call('svc', 'nope', {}), /module "caller": k\.modules\.call: module "svc" has no service "nope"/);
    assert.throws(() => k.modules.call('svc', 'toString', {}), /has no service "toString"/);
    assert.throws(() => k.modules.call('svc', 'add', { a: 1, b: () => 2 }), { name: 'DataCloneError' });   // plain data only
    assert.throws(() => k.modules.call('svc', 'fn', {}), { name: 'DataCloneError' });
    assert.equal(app.ledger.audit().ok, true);
  } finally { app.db.close(); }
});

// ---------- 2. business owners ----------

// A stand-in for the ventures module: business 7 is owned by the students in biz_members; a stake is a seasonAssets row.
const BIZ = `export default defineModule({ id: 'biz',
  migrations: [{ id: '001_init', sql: 'CREATE TABLE biz_members (business_id INTEGER, player_id INTEGER, stake_cents INTEGER)' }],
  ownersOf(k, { type, id }) { return type === 'business' ? k.db.prepare('SELECT player_id FROM biz_members WHERE business_id = ?').all(id).map((r) => r.player_id) : []; },
  seasonAssets(k) { return k.db.prepare('SELECT player_id AS playerId, stake_cents AS cents FROM biz_members').all().map((r) => ({ ...r })); },
});`;

test('business accounts: the owners get the balance hint, season close resets them to the sink, season_results stay per student (a stake is a seasonAssets row)', async () => {
  const srv = await boot({ config: cfg(['bank-basic', 'biz']), modulesDir: modulesDir({ link: ['bank-basic'], src: { biz: BIZ } }) });
  try {
    const { app } = srv;
    const { teacher, students: [a, b] } = await seeded(srv, 2, { transfers: false });
    app.db.prepare('INSERT INTO biz_members VALUES (7, ?, 12345)').run(a.id);
    const k = app.modules.kernel('biz');
    const treasury = k.ledger.openAccount({ ownerType: 'business', ownerId: 7, kind: 'treasury' });
    const loan = k.ledger.openAccount({ ownerType: 'business', ownerId: 7, kind: 'loan' });
    const [sa, sb] = await Promise.all([openStream(srv, a.client), openStream(srv, b.client)]);
    k.ledger.post({ kind: 'seed', legs: [{ account: k.ledger.system('mint'), cents: -80000 }, { account: treasury, cents: 50000 }, { account: loan, cents: 30000 }] });
    k.ledger.post({ kind: 'borrow', legs: [{ account: loan, cents: -60000 }, { account: treasury, cents: 60000 }] });   // the loan account goes negative
    assert.ok(await sa.next('balance'), 'the owner hears about the business account');
    assert.equal(await sb.next('balance', 300), null, 'a student who does not own it does not');
    sa.close(); sb.close();

    assert.equal((await teacher.post('/api/teach/world/close')).status, 200);
    const w = app.db.prepare('SELECT id FROM worlds').get().id;
    assert.deepEqual([app.ledger.balance(treasury), app.ledger.balance(loan)], [0, 0]);
    assert.equal(app.db.prepare("SELECT COUNT(*) AS n FROM entries e JOIN txns t ON t.id = e.txn_id WHERE t.kind = 'core.season_reset' AND e.account_id IN (?, ?)").get(treasury, loan).n, 2);
    const results = Object.fromEntries(app.db.prepare('SELECT player_id, net_worth_cents FROM season_results WHERE world_id = ?').all(w).map((r) => [r.player_id, r.net_worth_cents]));
    assert.deepEqual(results, { [a.id]: 50000 + 12345, [b.id]: 50000 }, 'one row per student; business money is in no one\'s result, a stake is');
    assert.equal(app.ledger.audit().ok, true);
  } finally { await srv.cleanup(); }
});

// ---------- 3. the core price index ----------

const PEEK = `export default defineModule({ id: 'peek',
  migrations: [{ id: '001_init', sql: 'CREATE TABLE peek_seen (bp INTEGER)' }],
  events: { 'module.rates.changed'(k) { k.db.prepare('INSERT INTO peek_seen VALUES (?)').run(k.world.priceIndex()); } },
});`;

test('price index: the core keeps the latest priceIndexBp per world from module.rates.changed; a module listening to the same event already reads it; 10000 otherwise', async () => {
  const dataDir = dir();
  const mods = modulesDir({ link: ['rates'], src: { peek: PEEK } });
  let app = await createApp({ dataDir, config: cfg(['rates', 'peek']), modulesDir: mods });
  try {
    app.world.create();
    const k = app.modules.kernel('peek'), w = app.world.current().id;
    assert.equal(k.world.priceIndex(), 10000);
    app.world.advance({ months: 1 });                                               // rates' first tick announces 10000
    app.events.emit('module.rates.changed', { worldId: w, priceIndexBp: 10350 });
    app.events.emit('module.rates.changed', { worldId: w, priceIndexBp: -5 });      // refused
    app.events.emit('module.rates.changed', { worldId: 'x', priceIndexBp: 10400 });
    assert.equal(k.world.priceIndex(), 10350);
    assert.equal(k.world.priceIndex(w + 1), 10000);
    assert.deepEqual(app.db.prepare('SELECT bp FROM peek_seen').all().map((r) => r.bp), [10000, 10350, 10350, 10350]);
    // an advance that rolls back takes the index with it (the write is inside the tick)
    app.db.prepare('UPDATE rates_policy SET pending_inflation_bp = 900 WHERE world_id = ?').run(w);
    app.db.prepare('UPDATE worlds SET month = 12 WHERE id = ?').run(w);
    const off = app.events.on('module.rates.changed', () => { throw Object.assign(new Error('disk gone'), { toEmitter: true }); });
    assert.throws(() => app.world.advance({ months: 1 }), /disk gone/);
    off();
    assert.equal(k.world.priceIndex(), 10350);
    // upgrade: rates' migration 003 fills the core table from rates_policy for worlds that already had an index
    app.db.prepare('UPDATE rates_policy SET price_index_bp = 10612').run();
    app.db.exec("DELETE FROM price_index; DELETE FROM schema_migrations WHERE id = 'mod:rates:003_core_index'");
    app.db.close();
    app = await createApp({ dataDir, config: cfg(['rates', 'peek']), modulesDir: mods });
    assert.equal(app.world.priceIndex(), 10612);
  } finally { app.db.close(); }
});

// ---------- 4. payload worldId wins over the current world ----------

test('listeners book housing.value, housing.payment, bills.paid, bills.late and credit.score on the payload\'s worldId, falling back to the current world', async () => {
  const app = await createApp({ dataDir: dir(), config: cfg(['bank-basic', 'credit', 'outfitters', 'savings', 'leaderboards']) });
  try {
    app.world.create();
    const cls = app.players.createClass({ name: 'B1', course: 'fintech10' });
    const [s] = await app.players.createStudents({ classId: cls.id, count: 1, hash: false });
    const old = app.world.current().id;
    app.world.close();
    app.world.create({ name: 'Season 2' });
    const now = app.world.current().id;
    const emit = (type, p) => app.events.emit(`module.${type}`, { playerId: s.id, ...p });
    emit('housing.value', { worldId: old, homeValue: 300000, mortgageBalance: 0 });
    emit('housing.value', { homeValue: 1, mortgageBalance: 0 });                           // no worldId: the current world
    emit('housing.payment', { worldId: old, month: 3, onTime: true, amount: 100, kind: 'mortgage' });
    emit('bills.late', { worldId: old, month: 4, billId: 'rent', monthsLate: 1 });
    emit('bills.paid', { worldId: old, month: 5, dueMonth: 5, billId: 'rent', onTime: true, amount: 100 });
    emit('credit.score', { worldId: old, month: 5, score: 760 });
    const q = (sql) => app.db.prepare(sql).all(s.id).map((r) => ({ ...r }));
    assert.deepEqual(q('SELECT world_id, home_value FROM savings_home WHERE player_id = ? ORDER BY world_id'), [{ world_id: old, home_value: 300000 }, { world_id: now, home_value: 1 }]);
    assert.deepEqual(q('SELECT world_id, source, month, outcome FROM credit_history WHERE player_id = ? ORDER BY id'),
      [{ world_id: old, source: 'housing', month: 3, outcome: 'ontime' }, { world_id: old, source: 'bill', month: 4, outcome: 'late' }, { world_id: old, source: 'bill', month: 5, outcome: 'ontime' }]);
    assert.deepEqual(q('SELECT world_id, month, ok, bad FROM outfitters_bm WHERE player_id = ? ORDER BY month'), [{ world_id: old, month: 4, ok: 0, bad: 1 }, { world_id: old, month: 5, ok: 1, bad: 0 }]);
    assert.deepEqual(q('SELECT world_id, score FROM leaderboards_inputs WHERE player_id = ? AND score IS NOT NULL'), [{ world_id: old, score: 760 }]);
  } finally { app.db.close(); }
});

// ---------- 5. exchange: dynamic securities ----------

const IPO = (id) => `export default defineModule({ id: '${id}', requires: ['exchange'] });`;

test('exchange listSecurity: a module lists a stock (town-stock price model by sector), students trade it with the market maker, it shows in /state, it steps each month; delist is refused while held and only for the lister', async () => {
  const config = cfg(['bank-basic', 'rates', 'exchange', 'ipo', 'other'], { 'bank-basic': { startCents: 5_000_000 } });
  const srv = await boot({ config, modulesDir: modulesDir({ link: ['bank-basic', 'rates', 'exchange'], src: { ipo: IPO('ipo'), other: IPO('other') } }) });
  try {
    const { app } = srv;
    const { teacher, students: [s] } = await seeded(srv, 1, { transfers: false });
    app.db.prepare("INSERT OR IGNORE INTO exchange_secrets (world_id, secret) VALUES (?, 'test-secret')").run(app.world.current().id);   // a fixed price path: no random circuit-breaker pause
    const k = app.modules.kernel('ipo');
    const list = (args) => k.modules.call('exchange', 'listSecurity', args);
    const lemn = { ticker: 'LEMN', name: 'Lemon Stand Co.', kind: 'stock', sector: 'Food and drink', startCents: 500, sharesOutstanding: 1000, ownerBusinessId: 7 };
    const st = async () => (await s.client.get('/api/exchange/state')).json;

    // a listing rolled back with its caller's transaction leaves nothing behind
    assert.throws(() => k.db.txn(() => { list(lemn); throw new Error('caller fails'); }), /caller fails/);
    assert.equal((await st()).securities.some((q) => q.ticker === 'LEMN'), false);

    assert.deepEqual(list(lemn), { ticker: 'LEMN', worldId: app.world.current().id, month: 1, startCents: 500, sigmaBp: 2800, tiltBp: -50 });   // AGRA's sector: its sigma and tilt
    assert.deepEqual([list({ ...lemn, ticker: 'ZAPP', sector: 'Rockets', sigmaBp: 5000 }).sigmaBp, list({ ...lemn, ticker: 'QUIT', sector: 'Rockets' }).tiltBp], [5000, 0]);
    for (const [bad, why] of [[{ ...lemn }, /LEMN is already listed/], [{ ...lemn, ticker: 'DAAX' }, /DAAX is already listed/], [{ ...lemn, ticker: 'ab' }, /2 to 5 capital letters/],
      [{ ...lemn, ticker: 'BOND', kind: 'fund' }, /kind must be 'stock'/], [{ ...lemn, ticker: 'NEWW', startCents: 5 }, /startCents/], [{ ...lemn, ticker: 'NEWW', sharesOutstanding: 0 }, /sharesOutstanding/]]) {
      assert.throws(() => list(bad), (e) => e.status === 400 && why.test(e.message), JSON.stringify(bad));
    }

    const sec = (await st()).securities.find((q) => q.ticker === 'LEMN');
    assert.deepEqual([sec.name, sec.kind, sec.sector, sec.price_cents, sec.volatility_bp, sec.yield_bp], ['Lemon Stand Co.', 'stock', 'Food and drink', 500, 2800, 0]);
    assert.equal((await s.client.post('/api/exchange/contribute', { account: 'invest', cents: 100000 })).status, 200);
    const buy = await s.client.post('/api/exchange/order', { ticker: 'LEMN', account: 'invest', side: 'buy', type: 'market', units_micro: 10_000_000 });
    assert.equal(buy.status, 200, JSON.stringify(buy.json));
    assert.equal((await st()).holdings.find((h) => h.ticker === 'LEMN').units_micro, 10_000_000);
    assert.throws(() => k.modules.call('exchange', 'delistSecurity', { ticker: 'LEMN' }), (e) => e.status === 409 && /still has holders/.test(e.message));

    app.world.advance({ months: 1 });
    assert.equal(app.db.prepare("SELECT COUNT(*) AS n FROM exchange_prices WHERE ticker = 'LEMN'").get().n, 2, 'the base price and one monthly step');
    const sell = await s.client.post('/api/exchange/order', { ticker: 'LEMN', account: 'invest', side: 'sell', type: 'market', units_micro: 10_000_000 });
    assert.equal(sell.status, 200, JSON.stringify(sell.json));

    assert.throws(() => app.modules.kernel('other').modules.call('exchange', 'delistSecurity', { ticker: 'LEMN' }), (e) => e.status === 403);
    assert.deepEqual(k.modules.call('exchange', 'delistSecurity', { ticker: 'LEMN' }), { ticker: 'LEMN', delistedMonth: 2 });
    assert.throws(() => k.modules.call('exchange', 'delistSecurity', { ticker: 'LEMN' }), (e) => e.status === 404);
    assert.throws(() => list(lemn), /LEMN was already used this season/);
    assert.equal((await st()).securities.some((q) => q.ticker === 'LEMN'), false);
    assert.equal((await teacher.get('/api/exchange/teach')).json.stocks.some((q) => q.ticker === 'LEMN'), false);
    assert.equal((await s.client.post('/api/exchange/preview', { ticker: 'LEMN', account: 'invest', side: 'buy', type: 'market', units_micro: 1_000_000 })).json.problem, 'Unknown ticker');
    assert.equal(app.ledger.audit().ok, true);
  } finally { await srv.cleanup(); }
});

test('exchange listings never duplicate a seeded or config ticker, and a ticker with price history this season cannot be listed', async () => {
  const config = cfg(['bank-basic', 'rates', 'exchange', 'ipo'], { 'bank-basic': { startCents: 5_000_000 } });
  const srv = await boot({ config, modulesDir: modulesDir({ link: ['bank-basic', 'rates', 'exchange'], src: { ipo: IPO('ipo') } }) });
  try {
    const { app } = srv;
    const { students: [s] } = await seeded(srv, 1, { transfers: false });
    const k = app.modules.kernel('ipo');
    const w = app.world.current();
    // a stale listing row with a town ticker (e.g. config changed after listing): /state shows AGRA once and the advance still works
    app.db.prepare(`INSERT INTO exchange_listings (world_id, ticker, name, sector, sigma_bp, tilt_bp, start_cents, shares_outstanding, owner_business_id, listed_by, listed_month, created)
      VALUES (?, 'AGRA', 'Shadow', 'Food and drink', 3000, 0, 500, 100, NULL, 'ipo', ?, 0)`).run(w.id, w.month);
    const st = (await s.client.get('/api/exchange/state')).json;
    assert.equal(st.securities.filter((q) => q.ticker === 'AGRA').length, 1);
    app.world.advance({ months: 1 });
    // a ticker that has price history in this world (e.g. removed from extraStocks) is refused
    app.db.prepare('INSERT INTO exchange_prices (world_id, ticker, month, price_micro, halted) VALUES (?, ?, ?, ?, 0)').run(w.id, 'ZEDD', w.month, 113544000);
    assert.throws(() => k.modules.call('exchange', 'listSecurity', { ticker: 'ZEDD', name: 'Zed', kind: 'stock', sector: 'food and drink', startCents: 500, sharesOutstanding: 10 }), /already used this season/);
    // a blank name is refused (trimmed)
    assert.throws(() => k.modules.call('exchange', 'listSecurity', { ticker: 'BLNK', name: '   ', kind: 'stock', sector: 'Food and drink', startCents: 500, sharesOutstanding: 10 }), /name/);
  } finally { await srv.cleanup(); }
});
