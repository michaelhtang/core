// exchange (docs/phase3.md wave 3a) over HTTP: trades and their numbers, limit orders, the caps and the breaker, the TFSA, dividends and DRIP, market events and news,
// the teacher controls (world teacher only, teacher B isolated), net worth, and what a season close does. The pure maths is in exchange-math.test.js.
import fs from 'node:fs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { boot, seeded, addClass } from './helpers.js';
import { moduleFiles, moduleSource } from './module-source.js';
import { monthStep } from '../modules/exchange/prices.js';
import { sides, costCents, proceedsCents, dividendCents, unitsForCents } from '../modules/exchange/orders.js';
import { SECURITIES, UNIT } from '../modules/exchange/constants.js';

const config = (exchange = {}) => {
  const c = JSON.parse(fs.readFileSync(new URL('../config/vdaa.json', import.meta.url), 'utf8'));
  for (const course of Object.values(c.courses)) course.modules = ['bank-basic', 'rates', 'exchange', 'savings', 'leaderboards'];
  c.options['bank-basic'].startCents = 5_000_000;          // $50,000 each: the 50% cap is never the thing in the way unless a test drains chequing
  c.options.exchange = exchange;
  return c;
};

async function world({ count = 3, exchange, pinSecret = true } = {}) {
  const srv = await boot({ config: config(exchange) });
  const t = await seeded(srv, count, { transfers: false });
  const { app } = srv;
  const tpost = (p, b = {}) => t.teacher.post(`/api/exchange${p}`, b);
  const get = async (s, p) => (await s.client.get(`/api/exchange${p}`)).json;
  const post = (s, p, b = {}) => s.client.post(`/api/exchange${p}`, b);
  const state = (s) => get(s, '/state');
  const acct = (s, kind) => { const a = app.ledger.accountId('player', s.id, kind); return a ? app.ledger.balance(a) : 0; };
  const advance = (n = 1) => app.world.advance({ months: n });
  const audit = () => { const a = app.ledger.audit(); assert.equal(a.ok, true, JSON.stringify(a.problems)); };
  const prices = () => {
    const w = app.world.current();
    const rows = Object.fromEntries(app.db.prepare('SELECT p.ticker, p.price_micro FROM exchange_prices p JOIN (SELECT ticker, MAX(month) m FROM exchange_prices WHERE world_id = ? GROUP BY ticker) x ON x.ticker = p.ticker AND x.m = p.month WHERE p.world_id = ?').all(w.id, w.id).map((r) => [r.ticker, r.price_micro]));
    return { ...Object.fromEntries(SECURITIES.map((q) => [q.ticker, q.startMicro])), ...rows };    // before the first trade or tick there are no rows: the base prices
  };
  // what the next tick will make of the prices (the series is deterministic, so a test can know it ahead of time)
  // (the world's seed secret is made on first use; a test makes a fixed one first so its price path never changes)
  const secret = () => {
    const id = app.world.current().id;
    app.db.prepare("INSERT OR IGNORE INTO exchange_secrets (world_id, secret) VALUES (?, 'test-secret')").run(id);
    return app.db.prepare('SELECT secret FROM exchange_secrets WHERE world_id = ?').get(id).secret;
  };
  const next = (events = [], policyDeltaBp = 0) => monthStep({ worldId: app.world.current().id, secret: secret(), month: app.world.current().month + 1, prev: prices(), securities: SECURITIES, events, policyDeltaBp });
  const chequing = (s) => app.ledger.balance(s.chequing.id);
  const holdings = (s) => app.db.prepare('SELECT * FROM exchange_holdings WHERE player_id = ? AND units_micro > 0').all(s.id);
  if (pinSecret) secret();                                                               // a fixed secret, so each test's price path is the same every run
  return { srv, app, ...t, tpost, get, post, state, acct, advance, audit, prices, next, secret, chequing, holdings, cleanup: () => srv.cleanup() };
}

test('a market buy of a fund by dollars: fractional units, the ask, cost rounded up, ledger and holding agree', async () => {
  const x = await world();
  try {
    const [s] = x.students;
    assert.equal((await x.post(s, '/contribute', { account: 'invest', cents: 1000000 })).status, 200);
    assert.equal(x.acct(s, 'invest'), 1000000);
    const st = await x.state(s);
    const dax = st.securities.find((q) => q.ticker === 'DAAX');
    assert.equal(dax.price_micro, 100_000_000);                                       // $100.0000 at the start
    assert.equal(dax.ask_micro, 100_100_000); assert.equal(dax.bid_micro, 99_900_000);  // +-0.1%
    const pre = (await x.post(s, '/preview', { ticker: 'DAAX', account: 'invest', side: 'buy', type: 'market', cents: 50000 })).json;
    assert.equal(pre.ok, true);
    const units = unitsForCents(50000, 100_100_000, 100);
    assert.equal(pre.units_micro, units); assert.equal(pre.cents, costCents(units, 100_100_000));
    assert.ok(pre.cents <= 50000 && pre.cents >= 49999);
    const r = await x.post(s, '/order', { ticker: 'DAAX', account: 'invest', side: 'buy', type: 'market', cents: 50000 });
    assert.equal(r.status, 200, JSON.stringify(r.json));
    assert.equal(r.json.cents, pre.cents);
    assert.equal(x.acct(s, 'invest'), 1000000 - pre.cents);
    const [h] = x.holdings(s);
    assert.deepEqual([h.ticker, h.account, h.units_micro, h.cost_cents], ['DAAX', 'invest', units, pre.cents]);
    assert.equal(units % 100, 0);
    assert.notEqual(units % UNIT, 0, 'a fraction of a unit');
    const after = await x.state(s);
    assert.equal(after.holdings[0].value_cents, proceedsCents(units, 99_900_000));
    assert.equal(after.holdings[0].gain_cents, proceedsCents(units, 99_900_000) - pre.cents);   // bought at the ask, valued at the bid: the spread
    x.audit();
  } finally { await x.cleanup(); }
});

test('whole shares only for stocks; a sale pays the bid rounded down; cost basis leaves with the units', async () => {
  const x = await world();
  try {
    const [s] = x.students;
    await x.post(s, '/contribute', { account: 'invest', cents: 1000000 });
    const order = (b) => x.post(s, '/order', { ticker: 'AGRA', account: 'invest', type: 'market', ...b });
    assert.equal((await order({ side: 'buy', units_micro: 1_500_000 })).status, 400);
    assert.match((await order({ side: 'buy', units_micro: 1_500_000 })).json.error, /whole shares/);
    const buy = await order({ side: 'buy', units_micro: 10 * UNIT });
    assert.equal(buy.status, 200);
    const { ask, bid } = sides(42_000_000, 100);
    assert.equal(buy.json.cents, costCents(10 * UNIT, ask));                       // 10 x $42.21
    assert.equal(buy.json.cents, 42210);
    const cash = x.acct(s, 'invest');
    const sell = await order({ side: 'sell', units_micro: 4 * UNIT });
    assert.equal(sell.status, 200);
    assert.equal(sell.json.cents, proceedsCents(4 * UNIT, bid)); assert.equal(sell.json.cents, 16716);   // 4 x $41.79
    assert.equal(x.acct(s, 'invest'), cash + 16716);
    const [h] = x.holdings(s);
    assert.deepEqual([h.units_micro, h.cost_cents], [6 * UNIT, 42210 - Math.floor((42210 * 4) / 10)]);   // 40% of the cost leaves with 40% of the shares
    assert.equal((await order({ side: 'sell', units_micro: 7 * UNIT })).status, 400);                    // more than held
    const all = await order({ side: 'sell', units_micro: 6 * UNIT });
    assert.equal(all.status, 200);
    assert.equal(x.holdings(s).length, 0);
    assert.ok(x.acct(s, 'invest') < 1000000, 'a round trip in a calm market costs the spread');
    x.audit();
  } finally { await x.cleanup(); }
});

test('limit orders: the money is held; fills only when the new price crosses, at the market maker price; the rest expire and release the hold', async () => {
  const x = await world();
  try {
    const [s] = x.students;
    await x.post(s, '/contribute', { account: 'invest', cents: 2000000 });
    // find a stock that a queued correction will push down by a few cents more than the spread
    const ev = [{ kind: 'correction' }];
    const n = x.next(ev);
    const pick = SECURITIES.filter((q) => q.kind === 'stock').map((q) => ({ t: q.ticker, nextAsk: sides(n.price[q.ticker], 100).ask, nowAsk: sides(x.prices()[q.ticker], 100).ask })).find((q) => Math.ceil(q.nextAsk / 10000) + 2 < Math.floor(q.nowAsk / 10000));
    assert.ok(pick, 'some stock falls');
    const cross = Math.ceil(pick.nextAsk / 10000), miss = Math.floor(pick.nextAsk / 10000) - 1;
    const lim = (limit_cents, extra = {}) => x.post(s, '/order', { ticker: pick.t, account: 'invest', side: 'buy', type: 'limit', units_micro: 5 * UNIT, limit_cents, ...extra });
    const before = x.acct(s, 'invest');
    const a = await lim(cross), b = await lim(miss);
    assert.equal(a.status, 200, JSON.stringify(a.json)); assert.equal(b.status, 200);
    assert.equal(a.json.hold_cents, costCents(5 * UNIT, cross * 10000));
    assert.equal(x.acct(s, 'invest'), before - a.json.hold_cents - b.json.hold_cents);   // both held
    assert.equal(x.acct(s, 'xhold'), a.json.hold_cents + b.json.hold_cents);
    assert.equal((await x.state(s)).accounts.hold_cents, x.acct(s, 'xhold'));
    await x.tpost('/event', { kind: 'correction' });
    x.audit();
    await x.advance();                                                                    // month 2: the correction lands
    const orders = (await x.state(s)).orders;
    const oa = orders.find((o) => o.id === a.json.order_id), ob = orders.find((o) => o.id === b.json.order_id);
    assert.equal(oa.status, 'filled'); assert.equal(ob.status, 'open', 'the limit one cent under the new ask is not crossed');
    const cost = costCents(5 * UNIT, x.prices() && sides(x.prices()[pick.t], 100).ask);
    assert.equal(x.holdings(s)[0].units_micro, 5 * UNIT);
    assert.equal(x.holdings(s)[0].cost_cents, cost);                                      // filled at the ask, not at the limit
    assert.ok(cost <= a.json.hold_cents);
    assert.equal(x.acct(s, 'xhold'), b.json.hold_cents);                                  // only the unfilled order is still held
    assert.equal(x.acct(s, 'invest'), before - cost - b.json.hold_cents);                 // the difference came back
    x.audit();
  } finally { await x.cleanup(); }
});

test('a sell limit reserves the shares, fills at the bid when the market reaches it, and pays the bid rounded down', async () => {
  const x = await world({ count: 1 });
  try {
    const [s] = x.students;
    await x.post(s, '/contribute', { account: 'invest', cents: 1000000 });
    const ev = [{ kind: 'rally' }], n = x.next(ev);
    const pick = SECURITIES.filter((q) => q.kind === 'stock').map((q) => ({ t: q.ticker, nextBid: sides(n.price[q.ticker], 100).bid, nowBid: sides(x.prices()[q.ticker], 100).bid })).find((q) => Math.floor(q.nextBid / 10000) > Math.ceil(q.nowBid / 10000) + 1);
    assert.ok(pick, 'some stock rises');
    assert.equal((await x.post(s, '/order', { ticker: pick.t, account: 'invest', side: 'buy', type: 'market', units_micro: 5 * UNIT })).status, 200);
    const limit = Math.floor(pick.nextBid / 10000);
    const sellLimit = (u, l) => x.post(s, '/order', { ticker: pick.t, account: 'invest', side: 'sell', type: 'limit', units_micro: u, limit_cents: l });
    const r = await sellLimit(3 * UNIT, limit);
    assert.equal(r.status, 200, JSON.stringify(r.json)); assert.equal(r.json.hold_cents, 0);
    assert.equal((await x.post(s, '/order', { ticker: pick.t, account: 'invest', side: 'sell', type: 'market', units_micro: 3 * UNIT })).status, 400, '3 of the 5 are reserved');
    assert.equal((await x.post(s, '/order', { ticker: pick.t, account: 'invest', side: 'sell', type: 'market', units_micro: 2 * UNIT })).status, 200);
    const cash = x.acct(s, 'invest');
    await x.tpost('/event', { kind: 'rally' });
    await x.advance();
    assert.equal((await x.state(s)).orders.find((o) => o.id === r.json.order_id).status, 'filled');
    const bid = sides(x.prices()[pick.t], 100).bid;
    assert.equal(x.acct(s, 'invest'), cash + proceedsCents(3 * UNIT, bid));
    assert.equal(x.holdings(s).length, 0);
    x.audit();
  } finally { await x.cleanup(); }
});

test('a marketable limit (buy at or above the ask, sell at or below the bid) fills now at the market price, as a market order, and says so', async () => {
  const x = await world({ count: 1 });
  try {
    const [s] = x.students;
    await x.post(s, '/contribute', { account: 'invest', cents: 1000000 });
    const ask = sides(x.prices().AGRA, 100).ask, bid = sides(x.prices().AGRA, 100).bid;
    const cash = x.acct(s, 'invest');
    const pv = (await x.post(s, '/preview', { ticker: 'AGRA', account: 'invest', side: 'buy', type: 'limit', units_micro: 3 * UNIT, limit_cents: Math.ceil(ask / 10000) + 500 })).json;
    assert.deepEqual([pv.type, pv.hold_cents, pv.cents], ['market', 0, costCents(3 * UNIT, ask)]);
    assert.match(pv.note, /fills now/);
    const b = await x.post(s, '/order', { ticker: 'AGRA', account: 'invest', side: 'buy', type: 'limit', units_micro: 3 * UNIT, limit_cents: Math.ceil(ask / 10000) + 500 });
    assert.equal(b.status, 200, JSON.stringify(b.json));
    assert.match(b.json.note, /fills now/);
    assert.equal(x.acct(s, 'invest'), cash - costCents(3 * UNIT, ask));                  // paid the ask, not the higher limit
    assert.equal(x.acct(s, 'xhold'), 0);                                                  // nothing held
    assert.equal(x.holdings(s)[0].units_micro, 3 * UNIT);
    const sl = await x.post(s, '/order', { ticker: 'AGRA', account: 'invest', side: 'sell', type: 'limit', units_micro: UNIT, limit_cents: 100 });
    assert.equal(sl.status, 200, JSON.stringify(sl.json));
    assert.equal(x.holdings(s)[0].units_micro, 2 * UNIT);
    assert.equal(x.acct(s, 'invest'), cash - costCents(3 * UNIT, ask) + proceedsCents(UNIT, bid));   // got the bid, not the $1 limit
    const types = x.app.db.prepare('SELECT type FROM exchange_orders WHERE player_id = ?').all(s.id).map((r) => r.type);
    assert.deepEqual(types, ['market', 'market']);
    x.audit();
  } finally { await x.cleanup(); }
});

test('each world has its own random price secret, made once, never sent to a browser', async () => {
  const x = await world({ count: 1, pinSecret: false });
  try {
    const [s] = x.students;
    await x.post(s, '/contribute', { account: 'invest', cents: 100000 });
    await x.post(s, '/order', { ticker: 'DAAX', account: 'invest', side: 'buy', type: 'market', cents: 10000 });
    const row = () => x.app.db.prepare('SELECT secret FROM exchange_secrets WHERE world_id = ?').get(x.app.world.current().id);
    const first = row()?.secret;
    assert.match(first, /^[0-9a-f]{32}$/);
    await x.advance();
    assert.equal(row().secret, first, 'kept across ticks');
    const st = JSON.stringify(await x.state(s)), teach = JSON.stringify((await x.teacher.get('/api/exchange/teach')).json);
    assert.ok(!st.includes(first) && !teach.includes(first));
  } finally { await x.cleanup(); }
});

test('a limit order that is never crossed rests for 3 world months, then expires and gives the held money back', async () => {
  const x = await world({ count: 1 });
  try {
    const [s] = x.students;
    await x.post(s, '/contribute', { account: 'invest', cents: 500000 });
    const r = await x.post(s, '/order', { ticker: 'AGRA', account: 'invest', side: 'buy', type: 'limit', units_micro: 2 * UNIT, limit_cents: 100 });   // $1.00 for a $42 stock
    assert.equal(r.status, 200); assert.equal(r.json.expires_month, 4);
    assert.equal(x.acct(s, 'xhold'), 200); assert.equal(x.acct(s, 'invest'), 499800);
    await x.advance(2);                                                                   // month 3
    assert.equal((await x.state(s)).orders[0].status, 'open'); assert.equal(x.acct(s, 'xhold'), 200);
    await x.advance();                                                                    // month 4
    assert.equal((await x.state(s)).orders[0].status, 'expired');
    assert.equal(x.acct(s, 'xhold'), 0); assert.equal(x.acct(s, 'invest'), 500000);
    x.audit();
  } finally { await x.cleanup(); }
});

test('cancel a limit order: the hold is released at once; others cannot cancel it; it cannot be cancelled twice', async () => {
  const x = await world();
  try {
    const [s, o] = x.students;
    await x.post(s, '/contribute', { account: 'invest', cents: 500000 });
    const ask = sides(x.prices().AGRA ?? 42_000_000, 100).ask;
    const r = await x.post(s, '/order', { ticker: 'AGRA', account: 'invest', side: 'buy', type: 'limit', units_micro: 3 * UNIT, limit_cents: Math.floor(ask / 10000) - 200 });
    assert.equal(r.status, 200, JSON.stringify(r.json));
    assert.ok(x.acct(s, 'xhold') > 0);
    assert.equal((await x.post(o, '/cancel', { id: r.json.order_id })).status, 404);
    assert.equal((await x.post(s, '/cancel', { id: r.json.order_id })).status, 200);
    assert.equal(x.acct(s, 'xhold'), 0); assert.equal(x.acct(s, 'invest'), 500000);
    assert.equal((await x.post(s, '/cancel', { id: r.json.order_id })).status, 409);
    x.audit();
  } finally { await x.cleanup(); }
});

test('caps: 10 orders per world month; one buy at most 50% of investable cash', async () => {
  const x = await world();
  try {
    const [s, t] = x.students;
    await x.post(s, '/contribute', { account: 'invest', cents: 1000000 });
    const buy = (who, cents) => x.post(who, '/order', { ticker: 'DAAX', account: 'invest', side: 'buy', type: 'market', cents });
    for (let i = 0; i < 10; i++) assert.equal((await buy(s, 1000)).status, 200, `order ${i + 1}`);
    const eleventh = await buy(s, 1000);
    assert.equal(eleventh.status, 400); assert.match(eleventh.json.error, /10 orders/);
    assert.equal((await x.state(s)).caps.orders_used, 10);
    await x.advance();
    assert.equal((await buy(s, 1000)).status, 200, 'a new world month, a fresh allowance');
    // the 50% rule: drain chequing, put $100 in the account, so investable cash is $100
    x.app.ledger.post({ kind: 'test.drain', legs: [{ account: t.chequing.id, cents: -(x.chequing(t) - 10000) }, { account: x.app.ledger.system('sink'), cents: x.chequing(t) - 10000 }] });
    await x.post(t, '/contribute', { account: 'invest', cents: 10000 });
    assert.equal(x.chequing(t), 0);
    const big = await buy(t, 6000);
    assert.equal(big.status, 400); assert.match(big.json.error, /50%/);
    assert.equal((await buy(t, 5000)).status, 200);
    x.audit();
  } finally { await x.cleanup(); }
});

test('the circuit breaker: a crash pauses the stocks and the index fund for the month; the next tick reopens them; the teacher freeze pauses everything', async () => {
  const x = await world();
  try {
    const [s] = x.students;
    await x.post(s, '/contribute', { account: 'invest', cents: 1000000 });
    const buy = (ticker, extra = {}) => x.post(s, '/order', { ticker, account: 'invest', side: 'buy', type: 'market', units_micro: UNIT, ...extra });
    await x.advance();                                                                    // month 2, calm
    assert.equal((await x.tpost('/event', { kind: 'crash' })).status, 200);
    assert.equal((await buy('AGRA')).status, 200, 'queued, not yet applied');
    const before = x.prices();
    await x.advance();                                                                    // month 3: the crash applies
    const st = await x.state(s);
    for (const t of ['AGRA', 'DAAX', 'CALL']) assert.equal(st.securities.find((q) => q.ticker === t).halted, true, t);
    assert.equal(st.securities.find((q) => q.ticker === 'DAAB').halted, false);
    const refused = await buy('AGRA');
    assert.equal(refused.status, 400); assert.match(refused.json.error, /paused/);
    assert.equal((await buy('DAAB')).status, 200);
    const ratio = x.prices().DAAX / before.DAAX;
    assert.ok(ratio < 0.85 && ratio > 0.6, `DAAX fell ${ratio}`);                          // -25% on top of a normal month
    await x.advance();
    const later = await x.state(s);
    assert.equal(later.securities.filter((q) => q.halted).length <= 1, true, 'trading reopens unless that stock itself moved a lot');
    // freeze
    assert.equal((await x.post(x.students[1], '/freeze', { frozen: true })).status, 403);
    assert.equal((await x.tpost('/freeze', { frozen: true })).status, 200);
    const frozen = await buy('DAAB');
    assert.equal(frozen.status, 400); assert.match(frozen.json.error, /paused trading/);
    assert.equal((await x.post(s, '/contribute', { account: 'invest', cents: 100 })).status, 200, 'cash can still move');
    await x.tpost('/freeze', { frozen: false });
    assert.equal((await buy('DAAB')).status, 200);
    x.audit();
  } finally { await x.cleanup(); }
});

test('TFSA: $7,000 room a world year, over-contribution refused, a withdrawal gives room back only next world year, unused room carries forward', async () => {
  const x = await world();
  try {
    const [s, t] = x.students;
    const room = async (who) => (await x.state(who)).tfsa.room_cents;
    assert.equal(await room(s), 700000);
    assert.equal((await x.post(s, '/contribute', { account: 'tfsa', cents: 700001 })).status, 400);
    assert.equal((await x.post(s, '/contribute', { account: 'tfsa', cents: 700000 })).status, 200);
    assert.equal(await room(s), 0);
    assert.equal((await x.post(s, '/contribute', { account: 'tfsa', cents: 1 })).status, 400);
    assert.equal((await x.post(s, '/withdraw', { account: 'tfsa', cents: 300000 })).status, 200);
    assert.equal(await room(s), 0, 'still no room this year');
    assert.equal(x.acct(s, 'tfsa'), 400000);
    assert.equal((await x.post(s, '/withdraw', { account: 'tfsa', cents: 500000 })).status, 400);          // only $4,000 of cash in it
    await x.advance(11);                                                                  // month 12: still world year 1
    assert.equal(await room(s), 0);
    await x.advance();                                                                    // month 13: world year 2
    assert.equal((await x.state(s)).year, 2);
    assert.equal(await room(s), 700000 + 300000);
    assert.equal(await room(t), 1400000, 'a student who used nothing carries the whole first year forward');
    assert.equal((await x.post(t, '/contribute', { account: 'tfsa', cents: 1400000 })).status, 200);
    // growth never uses up room: buy and sell inside the TFSA, room is unchanged
    await x.post(s, '/order', { ticker: 'DAAX', account: 'tfsa', side: 'buy', type: 'market', cents: 100000 });
    assert.equal(await room(s), 1000000);
    // non-registered contributions have no limit
    assert.equal((await x.post(s, '/contribute', { account: 'invest', cents: 3000000 })).status, 200);
    x.audit();
  } finally { await x.cleanup(); }
});

test('dividends: paid in months 3, 6, 9, 12 to the account that holds the stock; DRIP reinvests at the ask, cash lands as cash', async () => {
  const x = await world();
  try {
    const [s] = x.students;
    await x.post(s, '/contribute', { account: 'invest', cents: 1000000 });
    await x.post(s, '/contribute', { account: 'tfsa', cents: 700000 });
    for (const account of ['invest', 'tfsa']) assert.equal((await x.post(s, '/order', { ticker: 'CORN', account, side: 'buy', type: 'market', units_micro: 10 * UNIT })).status, 200);
    assert.equal((await x.post(s, '/drip', { account: 'tfsa', ticker: 'CORN', drip: true })).status, 200);
    assert.equal((await x.post(s, '/drip', { account: 'invest', ticker: 'DAAX', drip: true })).status, 404);
    const cashInvest = x.acct(s, 'invest'), cashTfsa = x.acct(s, 'tfsa');
    await x.advance();                                                                    // month 2: no dividend
    assert.equal(x.acct(s, 'invest'), cashInvest);
    await x.advance();                                                                    // month 3: CORN pays 3.5% a year = 0.875% a quarter
    const p = x.prices().CORN, pay = dividendCents(10 * UNIT, p, 350);
    assert.ok(pay > 0);
    assert.equal(x.acct(s, 'invest'), cashInvest + pay, 'cash dividend');
    const { ask } = sides(p, 100);
    const reinvested = unitsForCents(pay, ask, 100);
    const tfsaHold = x.holdings(s).find((h) => h.account === 'tfsa');
    assert.equal(tfsaHold.units_micro, 10 * UNIT + reinvested, 'DRIP bought more at the ask (a fraction of a share)');
    assert.equal(x.acct(s, 'tfsa'), cashTfsa + pay - costCents(reinvested, ask));
    assert.equal(x.holdings(s).find((h) => h.account === 'invest').units_micro, 10 * UNIT);
    const st = await x.state(s);
    assert.equal(st.dividends.length, 2);
    assert.ok(st.news.some((n) => n.kind === 'dividend'));
    assert.equal(x.app.db.prepare("SELECT COUNT(*) AS n FROM exchange_trades WHERE via = 'drip'").get().n, 1);
    x.audit();
  } finally { await x.cleanup(); }
});

test('the activity log: a student sees only their own buys, sales and dividends, newest first, with the DRIP buy folded into its dividend', async () => {
  const x = await world();
  try {
    const [s, other] = x.students;
    await x.post(s, '/contribute', { account: 'invest', cents: 1000000 });
    await x.post(s, '/contribute', { account: 'tfsa', cents: 700000 });
    for (const account of ['invest', 'tfsa']) assert.equal((await x.post(s, '/order', { ticker: 'CORN', account, side: 'buy', type: 'market', units_micro: 10 * UNIT })).status, 200);
    await x.post(s, '/drip', { account: 'tfsa', ticker: 'CORN', drip: true });
    await x.advance(2);                                                                   // month 3: both holdings get a dividend
    const sold = (await x.post(s, '/order', { ticker: 'CORN', account: 'invest', side: 'sell', type: 'market', units_micro: 4 * UNIT })).json;
    const st = await x.state(s);
    assert.deepEqual(st.activity.map((a) => [a.month, a.type, a.account]), [[3, 'sell', 'invest'], [3, 'dividend', 'tfsa'], [3, 'dividend', 'invest'], [1, 'buy', 'tfsa'], [1, 'buy', 'invest']]);
    const [sell, dripDiv, cashDiv, buy] = st.activity;
    const trade = x.app.db.prepare('SELECT * FROM exchange_trades WHERE id = ?').get(sold.trade_id);
    assert.equal(sell.cents, trade.cents); assert.equal(sell.units_micro, 4 * UNIT); assert.equal(sell.gain_cents, trade.cents - trade.basis_cents); assert.equal(sell.via, 'market');
    const drip = x.app.db.prepare("SELECT * FROM exchange_trades WHERE via = 'drip'").get();
    assert.equal(dripDiv.drip, true); assert.deepEqual(dripDiv.reinvested, { units_micro: drip.units_micro, price_cents: Math.round(drip.price_micro / 10000), cents: drip.cents });
    assert.equal(cashDiv.drip, false); assert.equal(cashDiv.reinvested, null); assert.equal(cashDiv.units_micro, 10 * UNIT);
    assert.equal(cashDiv.cents, x.app.db.prepare("SELECT cents FROM exchange_dividends WHERE account = 'invest'").get().cents);
    assert.equal(buy.units_micro, 10 * UNIT); assert.equal(buy.via, 'market'); assert.equal(buy.type, 'buy');
    assert.deepEqual((await x.state(other)).activity, [], 'another student sees none of it');
    assert.equal((await x.tpost('/undo', { id: sold.trade_id })).status, 200);
    assert.equal((await x.state(s)).activity[0].undone, true, 'a trade the teacher undid stays listed, marked');
    x.audit();
  } finally { await x.cleanup(); }
});

test('the bond fund follows the policy rate: +100 bp at duration 7 takes 7% off DAAB, and nothing off DAAX', async () => {
  const x = await world();
  try {
    await x.advance();                                                                    // month 2: rates announces the policy rate (2.25%)
    assert.equal((await x.tpost('/event', { kind: 'rally' })).status, 200);       // unrelated: proves the queue is per event
    const res = await x.teacher.post('/api/rates/policy', { policy_bp: 325 });
    assert.equal(res.status, 200, JSON.stringify(res.json));
    const flat = x.next([{ kind: 'rally' }]), up = x.next([{ kind: 'rally' }], 100);
    await x.advance();                                                                    // month 3
    const p = x.prices();
    assert.equal(p.DAAB, up.price.DAAB); assert.equal(p.DAAX, up.price.DAAX);
    assert.ok(Math.abs(p.DAAB / flat.price.DAAB - 0.93) < 1e-6);
    assert.equal(p.DAAX, flat.price.DAAX);
    const news = (await x.state(x.students[0])).news.map((n) => n.text).join(' | ');
    assert.match(news, /Policy rate up 100 bp: the DAA Bond Index falls/);
  } finally { await x.cleanup(); }
});

test('a queued policy change pauses the bond-linked funds (DAAB, DAAG) until the tick that applies it; other securities trade; cancelling lifts the pause', async () => {
  const x = await world();
  try {
    const [s] = x.students;
    const seen = [];
    x.app.events.on('module.rates.pending', (p) => seen.push(p));
    await x.advance();                                                                    // month 2: rates announces 2.25%
    await x.post(s, '/contribute', { account: 'invest', cents: 1000000 });
    const PAUSE = 'Paused: the Bank of DAA announces a new policy rate at the next world month. Trading reopens after it.';
    const order = (ticker, extra = {}) => x.post(s, '/order', { ticker, account: 'invest', side: 'buy', type: 'market', units_micro: UNIT, ...extra });
    const paused = async () => Object.fromEntries((await x.state(s)).securities.map((q) => [q.ticker, q.paused]));
    assert.equal((await order('DAAB')).status, 200);
    assert.equal((await x.teacher.post('/api/rates/policy', { policy_bp: 125 })).status, 200);   // a 100 bp cut, applied at month 3
    assert.deepEqual(seen.at(-1), { worldId: x.app.world.current().id, pendingBp: 125, effectiveMonth: 3, mortgage5yBp: 125 + 195 });   // housing prices new mortgages at it
    assert.equal((await s.client.get('/api/rates/current')).json.pending_bp, 125, 'students still see the announcement');
    for (const t of ['DAAB', 'DAAG']) {
      for (const extra of [{}, { type: 'limit', limit_cents: 5000 }, { side: 'sell' }]) {
        const r = await order(t, extra);
        assert.equal(r.status, 400, `${t} ${JSON.stringify(extra)}`); assert.equal(r.json.error, PAUSE);
      }
      assert.equal((await x.post(s, '/preview', { ticker: t, account: 'invest', side: 'buy', type: 'market', units_micro: UNIT })).json.problem, PAUSE);
    }
    const p = await paused();
    assert.deepEqual([p.DAAB, p.DAAG, p.DAAX, p.AGRA], [PAUSE, PAUSE, null, null]);
    assert.equal((await order('DAAX')).status, 200); assert.equal((await order('AGRA')).status, 200);
    const flat = x.next(), cut = x.next([], -100);
    await x.advance();                                                                    // month 3: the cut applies, DAAB +7%
    assert.equal(x.prices().DAAB, cut.price.DAAB);
    assert.ok(Math.abs(cut.price.DAAB / flat.price.DAAB - 1.07) < 1e-6);
    assert.deepEqual(seen.at(-1), { worldId: x.app.world.current().id, pendingBp: null, effectiveMonth: null, mortgage5yBp: null });
    assert.equal((await paused()).DAAB, null);
    assert.equal((await order('DAAB')).status, 200, 'reopened at the tick that applied it');
    // queue another change, then cancel it by announcing the rate in force: the pause lifts at once and nothing moves at the tick
    await x.teacher.post('/api/rates/policy', { policy_bp: 200 });
    assert.equal((await order('DAAG')).status, 400);
    const c = await x.teacher.post('/api/rates/policy', { policy_bp: 125 });
    assert.equal(c.json.cancelled, true);
    assert.equal(seen.at(-1).pendingBp, null);
    assert.equal((await x.teacher.get('/api/rates/current')).json.pending_bp, null);
    assert.equal((await order('DAAG')).status, 200);
    const calm = x.next();
    await x.advance();
    assert.equal(x.prices().DAAB, calm.price.DAAB, 'no rate shock');
    x.audit();
  } finally { await x.cleanup(); }
});

test('a resting limit on a bond-linked fund is not filled while a policy change is pending', async () => {
  const x = await world({ count: 1 });
  try {
    const [s] = x.students;
    await x.advance();
    await x.post(s, '/contribute', { account: 'invest', cents: 1000000 });
    assert.equal((await x.post(s, '/order', { ticker: 'DAAB', account: 'invest', side: 'buy', type: 'market', units_micro: 10 * UNIT })).status, 200);
    // a limit that rests now and crosses at next month's price
    const n = x.next(), sec = SECURITIES.find((q) => q.ticker === 'DAAB'), now = sides(x.prices().DAAB, 20), nxt = sides(n.price.DAAB, 20);
    const lim = nxt.bid > now.bid ? { side: 'sell', limit_cents: Math.floor(nxt.bid / 10000) } : { side: 'buy', limit_cents: Math.ceil(nxt.ask / 10000) };
    const r = await x.post(s, '/order', { ticker: 'DAAB', account: 'invest', type: 'limit', units_micro: UNIT, ...lim });
    assert.equal(r.json.status, 'open', JSON.stringify(r.json));
    // a change that waits longer than one tick (rates always applies at the next one; this pins the guard on the fill itself)
    const wid = x.app.world.current().id;
    x.app.events.emit('module.rates.pending', { worldId: wid, pendingBp: 300, effectiveMonth: x.app.world.current().month + 2 });
    await x.advance();
    assert.equal(x.prices().DAAB, n.price.DAAB);
    assert.equal(sec.type, 'bond');
    assert.equal((await x.state(s)).orders.find((o) => o.id === r.json.order_id).status, 'open', 'not filled while paused');
    x.app.events.emit('module.rates.pending', { worldId: wid, pendingBp: null, effectiveMonth: null });
    assert.equal((await x.post(s, '/order', { ticker: 'DAAB', account: 'invest', side: 'buy', type: 'market', units_micro: UNIT })).status, 200);
    x.audit();
  } finally { await x.cleanup(); }
});

test('a resting limit on DAAB placed before the announcement fills at the tick that applies the change, at the shocked price', async () => {
  const x = await world({ count: 1 });
  try {
    const [s] = x.students;
    await x.advance();                                                                    // month 2
    await x.post(s, '/contribute', { account: 'invest', cents: 1000000 });
    assert.equal((await x.post(s, '/order', { ticker: 'DAAB', account: 'invest', side: 'buy', type: 'market', units_micro: 10 * UNIT })).status, 200);
    const cutBid = sides(x.next([], -100).price.DAAB, 20).bid;                             // next month's bid after a 100 bp cut (+7%)
    const r = await x.post(s, '/order', { ticker: 'DAAB', account: 'invest', side: 'sell', type: 'limit', units_micro: UNIT, limit_cents: Math.floor(cutBid / 10000) });
    assert.equal(r.json.status, 'open', JSON.stringify(r.json));
    await x.teacher.post('/api/rates/policy', { policy_bp: 125 });
    await x.advance();                                                                    // month 3: the cut applies, the pause lifts, the limit crosses
    const o = (await x.state(s)).orders.find((q) => q.id === r.json.order_id);
    assert.deepEqual([o.status, o.filled_month], ['filled', 3]);
    assert.equal(x.app.db.prepare('SELECT price_micro FROM exchange_trades WHERE order_id = ?').get(r.json.order_id).price_micro, cutBid);
    x.audit();
  } finally { await x.cleanup(); }
});

test('a change queued at the end of a season does not pause the next season', async () => {
  const x = await world({ count: 1 });
  try {
    const [s] = x.students;
    await x.advance();
    await x.teacher.post('/api/rates/policy', { policy_bp: 325 });
    assert.equal((await x.state(s)).securities.find((q) => q.ticker === 'DAAB').paused !== null, true);
    x.app.world.close({ actor: 'system' });
    x.app.world.create({ name: 'Season 2' });
    assert.deepEqual((await x.state(s)).securities.filter((q) => q.paused).map((q) => q.ticker), []);
    x.app.ledger.post({ kind: 'test.grant', legs: [{ account: x.app.ledger.system('mint'), cents: -100000 }, { account: s.chequing.id, cents: 100000 }] });   // the new season starts at zero
    await x.post(s, '/contribute', { account: 'invest', cents: 100000 });
    const o = await x.post(s, '/order', { ticker: 'DAAG', account: 'invest', side: 'buy', type: 'market', units_micro: UNIT }); assert.equal(o.status, 200, JSON.stringify(o.json));
    await x.advance();
    assert.deepEqual((await x.state(s)).securities.filter((q) => q.paused).map((q) => q.ticker), []);
    x.audit();
  } finally { await x.cleanup(); }
});

test('world-teacher events: queued now, applied at the next tick on top of the normal step, with a headline; students and teacher B are refused', async () => {
  const x = await world();
  try {
    const [s] = x.students;
    const b = x.srv.client();
    const invite = (await x.teacher.post('/api/teach/invites')).json;
    assert.equal((await b.post('/api/teach/join', { token: new URL(invite.url).searchParams.get('invite'), username: 'teacherB', passphrase: 'another long passphrase' })).status, 200);
    for (const [path, body] of [['/event', { kind: 'crash' }], ['/freeze', { frozen: true }], ['/undo', { id: 1 }]]) {
      assert.equal((await b.post(`/api/exchange${path}`, body)).status, 403, `teacher B ${path}`);
      assert.equal((await s.client.post(`/api/exchange${path}`, body)).status, 403, `student ${path}`);
    }
    assert.equal((await x.teacher.post('/api/exchange/event', { kind: 'nonsense' })).status, 400);
    assert.equal((await x.teacher.post('/api/exchange/event', { kind: 'scandal', ticker: 'DAAX' })).status, 400);   // a company, not a fund
    assert.equal((await x.teacher.post('/api/exchange/event', { kind: 'scandal', ticker: 'KEYS' })).status, 200);
    assert.equal((await x.teacher.post('/api/exchange/event', { kind: 'boom', ticker: 'PRAI' })).status, 200);
    const calm = x.next(), withEv = x.next([{ kind: 'scandal', ticker: 'KEYS' }, { kind: 'boom', ticker: 'PRAI' }]);
    await x.advance();
    assert.equal(x.prices().KEYS, withEv.price.KEYS); assert.ok(Math.abs(x.prices().KEYS / calm.price.KEYS - 0.65) < 1e-6);
    assert.ok(Math.abs(x.prices().PRAI / calm.price.PRAI - 1.25) < 1e-6);
    const news = (await x.state(s)).news;
    assert.ok(news.some((n) => n.kind === 'event' && /Keystone Distribution \(KEYS\) hit by scandal/.test(n.text)));
    assert.ok(news.some((n) => n.kind === 'event' && /Prairie Threads \(PRAI\) booms/.test(n.text)));
    assert.equal(news.filter((n) => n.month === 2).length <= 4, true);
    // applied exactly once
    await x.advance();
    assert.equal(x.app.db.prepare('SELECT COUNT(*) AS n FROM exchange_events WHERE applied_month IS NULL').get().n, 0);
    const thisMonth = (await x.state(s)).news.filter((n) => n.month === 3);
    assert.ok(thisMonth.length >= 1 && thisMonth.every((n) => n.kind !== 'event'));
  } finally { await x.cleanup(); }
});

test('undo a trade (world teacher only, own classes only): the cash and the holding go back; a second undo is refused', async () => {
  const x = await world();
  try {
    const [s] = x.students;
    const b = x.srv.client();
    const invite = (await x.teacher.post('/api/teach/invites')).json;
    await b.post('/api/teach/join', { token: new URL(invite.url).searchParams.get('invite'), username: 'teacherB', passphrase: 'another long passphrase' });
    await x.post(s, '/contribute', { account: 'invest', cents: 1000000 });
    const buy = (await x.post(s, '/order', { ticker: 'BEAC', account: 'invest', side: 'buy', type: 'market', units_micro: 5 * UNIT })).json;
    assert.equal(x.acct(s, 'invest'), 1000000 - buy.cents);
    const tid = buy.trade_id;
    assert.equal((await b.post('/api/exchange/undo', { id: tid })).status, 403);
    const view = (await x.teacher.get('/api/exchange/teach')).json;
    assert.ok(view.trades.some((t) => t.id === tid && t.ticker === 'BEAC' && t.side === 'buy'));
    assert.equal((await x.teacher.post('/api/exchange/undo', { id: tid })).status, 200);
    assert.equal(x.acct(s, 'invest'), 1000000);                                           // back at the original price
    assert.equal(x.holdings(s).length, 0);
    assert.equal((await x.teacher.post('/api/exchange/undo', { id: tid })).status, 409);
    assert.equal((await x.teacher.post('/api/exchange/undo', { id: 99999 })).status, 404);
    // undo a sale: the proceeds go back to the market maker and the shares come back with their cost
    await x.post(s, '/order', { ticker: 'BEAC', account: 'invest', side: 'buy', type: 'market', units_micro: 5 * UNIT });
    const sell = (await x.post(s, '/order', { ticker: 'BEAC', account: 'invest', side: 'sell', type: 'market', units_micro: 2 * UNIT })).json;
    const cashAfterSell = x.acct(s, 'invest');
    assert.equal((await x.teacher.post('/api/exchange/undo', { id: sell.trade_id })).status, 200);
    assert.equal(x.acct(s, 'invest'), cashAfterSell - sell.cents);
    assert.equal(x.holdings(s)[0].units_micro, 5 * UNIT);
    x.audit();
    // teacher B has a class of their own: B's view has no trades of A's students, and cannot undo them even if B were the world teacher
    const bClass = (await b.post('/api/teach/classes', { name: 'B block', course: 'fintech10' })).json;
    assert.ok(bClass.id);
    const bView = (await b.get('/api/exchange/teach')).json;
    assert.deepEqual(bView.classes.map((c) => c.name), ['B block']);
    assert.equal(bView.trades.length, 0); assert.equal(bView.can_control, false);
    assert.ok(!JSON.stringify(bView).includes(s.username));
  } finally { await x.cleanup(); }
});

test('teacher view: holdings by asset type, most-held tickers, TFSA usage, trades this month; scoped to the teacher\'s classes', async () => {
  const x = await world({ count: 2 });
  try {
    const [s, t] = x.students;
    await x.post(s, '/contribute', { account: 'tfsa', cents: 300000 });
    await x.post(s, '/order', { ticker: 'DAAX', account: 'tfsa', side: 'buy', type: 'market', cents: 100000 });
    await x.post(s, '/order', { ticker: 'AGRA', account: 'tfsa', side: 'buy', type: 'market', units_micro: 3 * UNIT });
    await x.post(t, '/contribute', { account: 'invest', cents: 50000 });
    await x.post(t, '/order', { ticker: 'AGRA', account: 'invest', side: 'buy', type: 'market', units_micro: UNIT });
    const other = await addClass(x.srv, x.teacher, 'Block 2', 1);
    const v = (await x.teacher.get('/api/exchange/teach')).json;
    const c = v.classes.find((q) => q.name === 'Block 1');
    assert.equal(c.students, 2); assert.equal(c.investors, 2);
    assert.ok(c.funds_cents > 0 && c.stocks_cents > 0);
    assert.deepEqual(c.top[0].ticker, 'AGRA'); assert.equal(c.top[0].holders, 2);
    assert.equal(c.tfsa_users, 1); assert.equal(c.tfsa_contributed_cents, 300000);
    assert.equal(c.trades_this_month, 3);
    assert.equal(v.classes.find((q) => q.name === 'Block 2').investors, 0);
    assert.equal((await x.teacher.get('/api/exchange/state')).status, 403);               // a student route
    assert.equal((await s.client.get('/api/exchange/teach')).status, 403);
    assert.equal((await x.srv.client().get('/api/exchange/state')).status, 401);
    assert.ok(other.cls.id);
  } finally { await x.cleanup(); }
});

test('net worth includes holdings: savings right after a trade, the leaderboards snapshot at the tick, and the seasonal result at close; holdings and orders end with the season', async () => {
  const x = await world({ count: 2 });
  try {
    const [s, t] = x.students;
    const w1 = x.app.world.current();
    await x.post(s, '/contribute', { account: 'tfsa', cents: 500000 });
    const buy = (await x.post(s, '/order', { ticker: 'DAAX', account: 'tfsa', side: 'buy', type: 'market', cents: 400000 })).json;
    const worth = () => x.app.db.prepare("SELECT SUM(balance_cents) AS n FROM accounts WHERE owner_type = 'player' AND owner_id = ?").get(s.id).n;
    const nw = (await s.client.get('/api/savings/status')).json;
    assert.equal(nw.exchange_value_cents, proceedsCents(buy.units_micro, 99_900_000));
    assert.equal(nw.net_worth_cents, worth() + nw.exchange_value_cents);                  // the spread already shows
    await x.post(s, '/order', { ticker: 'AGRA', account: 'tfsa', side: 'buy', type: 'limit', units_micro: UNIT, limit_cents: 100 });
    await x.advance();
    const value = proceedsCents(x.holdings(s)[0].units_micro, sides(x.prices().DAAX, 20).bid);
    const snap = x.app.db.prepare('SELECT net_worth FROM leaderboards_snapshots WHERE player_id = ? AND month = 2').get(s.id).net_worth;
    assert.equal(snap, worth() + value, 'the leaderboards net worth counts the holdings at the bid');
    assert.equal(x.app.db.prepare('SELECT net_worth FROM savings_snapshots WHERE player_id = ? AND month = 2').get(s.id).net_worth, worth() + value);
    assert.equal(x.app.db.prepare('SELECT net_worth FROM leaderboards_snapshots WHERE player_id = ? AND month = 2').get(t.id).net_worth, x.app.db.prepare("SELECT SUM(balance_cents) AS n FROM accounts WHERE owner_type = 'player' AND owner_id = ?").get(t.id).n, 'no holdings: just the ledger');
    // a sale takes the value back out of net worth immediately
    await x.post(s, '/order', { ticker: 'DAAX', account: 'tfsa', side: 'sell', type: 'market', units_micro: x.holdings(s)[0].units_micro });
    assert.equal((await s.client.get('/api/savings/status')).json.exchange_value_cents, 0);
    // buy again, then close the season
    const again = (await x.post(s, '/order', { ticker: 'DAAX', account: 'tfsa', side: 'buy', type: 'market', cents: 100000 })).json;
    assert.ok(again.units_micro > 0);
    const expected = worth() + proceedsCents(again.units_micro, sides(x.prices().DAAX, 20).bid);
    x.app.world.close({ actor: 'system' });
    const result = x.app.db.prepare('SELECT net_worth_cents FROM season_results WHERE world_id = ? AND player_id = ?').get(w1.id, s.id).net_worth_cents;
    assert.equal(result, expected, 'seasonAssets adds the holdings value');
    assert.equal(x.app.db.prepare('SELECT COUNT(*) AS n FROM exchange_holdings WHERE world_id = ? AND ended = 0').get(w1.id).n, 0);
    assert.equal(x.app.db.prepare("SELECT COUNT(*) AS n FROM exchange_orders WHERE world_id = ? AND status = 'open'").get(w1.id).n, 0);
    x.audit();
    // a new world: nothing carries over, and the TFSA room is back
    x.app.world.create({ name: 'Season 2' });
    const st = await x.state(s);
    assert.deepEqual([st.holdings.length, st.orders.length, st.tfsa.room_cents, st.accounts.tfsa_cents], [0, 0, 700000, 0]);
    assert.equal(st.portfolio_cents, 0);
    x.audit();
  } finally { await x.cleanup(); }
});

// ---- wave 3b: the RRSP ----
// Income reaches the exchange only as module.jobs.paid, so these worlds (no jobs module) feed it by emitting that event. year: 1.. ; months are the world months of that year.
const feed = (x, s, year, perMonth = 400000) => {
  for (let m = 1; m <= 12; m++) x.app.events.emit('module.jobs.paid', { playerId: s.id, worldId: x.app.world.current().id, month: (year - 1) * 12 + m, gross: perMonth, net: Math.round(perMonth * 0.8) });
};
const drain = (x, s, leave) => {
  const take = x.chequing(s) - leave;
  x.app.ledger.post({ kind: 'test.drain', actor: 'system', legs: [{ account: s.chequing.id, cents: -take }, { account: x.app.ledger.system('sink'), cents: take }] });
};
const slipRow = (x, s, year) => x.app.db.prepare('SELECT * FROM exchange_settlements WHERE player_id = ? AND world_id = ? AND year = ?').get(s.id, x.app.world.current().id, year);
const near = (a, b, tol, what) => assert.ok(Math.abs(a - b) <= tol, `${what ?? ''} ${a} vs ${b}`);

test('RRSP room: none in world year 1, 18% of last year\'s pay up to $33,810, unused room carries forward, a withdrawal never gives room back', async () => {
  const x = await world();
  try {
    const [s, t, u] = x.students;
    const room = async (who) => (await x.state(who)).rrsp.room_cents;
    assert.equal(await room(s), 0);
    const r1 = await x.post(s, '/contribute', { account: 'rrsp', cents: 100 });
    assert.equal(r1.status, 400); assert.match(r1.json.error, /no RRSP room in world year 1/);
    feed(x, s, 1); feed(x, t, 1, 2500000); feed(x, u, 1);                                 // $48,000, $300,000 and $48,000 in world year 1
    assert.equal(await room(s), 0, 'this year\'s pay only makes room next year');
    await x.advance(12);                                                                  // month 13: world year 2
    assert.equal(await room(s), 864000);                                                  // 18% of $48,000
    assert.equal(await room(t), 3381000, 'the $33,810 dollar limit');
    assert.equal((await x.state(s)).rrsp.last_year_income_cents, 4800000);
    assert.equal((await x.post(s, '/contribute', { account: 'rrsp', cents: 864001 })).status, 400);
    assert.match((await x.post(s, '/contribute', { account: 'rrsp', cents: 864001 })).json.error, /over your RRSP room/);
    const c = await x.post(s, '/contribute', { account: 'rrsp', cents: 864000 });
    assert.equal(c.status, 200); assert.equal(c.json.room_cents, 0);
    assert.equal(x.acct(s, 'rrsp'), 864000);
    assert.equal((await x.post(s, '/contribute', { account: 'rrsp', cents: 1 })).status, 400);
    const w = await x.post(s, '/withdraw', { account: 'rrsp', cents: 100000 });
    assert.equal(w.status, 200); assert.equal(await room(s), 0, 'a withdrawal does not restore room');
    // carry-forward: u uses nothing in year 2; year 2's pay makes year 3's room on top
    feed(x, s, 2); feed(x, u, 2);
    await x.advance(12);                                                                  // month 25: world year 3
    assert.equal(await room(u), 864000 * 2);
    assert.equal(await room(s), 864000, 'new room only: last year\'s room was used up and the withdrawal gave nothing back');
    x.audit();
  } finally { await x.cleanup(); }
});

test('RRSP withdrawals: tax withheld at source by the size of one withdrawal (10% to $5,000, 20% to $15,000, 30% above), to the sink', async () => {
  const x = await world({ count: 1 });
  try {
    const [t] = x.students;
    feed(x, t, 1, 2500000);
    await x.advance(12);
    assert.equal((await x.post(t, '/contribute', { account: 'rrsp', cents: 3381000 })).status, 200);
    const sink = () => x.app.ledger.balance(x.app.ledger.system('sink'));
    for (const [cents, withheld] of [[500000, 50000], [500001, 100000], [1500001, 450000]]) {
      const chq = x.chequing(t), sk = sink(), rr = x.acct(t, 'rrsp');
      const r = await x.post(t, '/withdraw', { account: 'rrsp', cents });
      assert.equal(r.status, 200, JSON.stringify(r.json));
      assert.deepEqual([r.json.withheld_cents, r.json.net_cents], [withheld, cents - withheld]);
      assert.equal(x.chequing(t), chq + cents - withheld); assert.equal(sink(), sk + withheld); assert.equal(x.acct(t, 'rrsp'), rr - cents);
    }
    assert.equal((await x.post(t, '/withdraw', { account: 'rrsp', cents: 900000 })).status, 400, 'only 3,381,000 - 2,500,002 = 880,998 left');
    const st = (await x.state(t)).rrsp;
    assert.equal(st.withdrawn_cents, 2500002); assert.equal(st.withheld_cents, 600000);
    assert.deepEqual(st.bands.map((b) => [b.up_to_cents, b.pct]), [[500000, 10], [1500000, 20], [null, 30]]);
    x.audit();
  } finally { await x.cleanup(); }
});

test('RRSP year-end settlement for a contributor: refund = tax(G) - tax(G - C), about C x the marginal rate, minted into chequing; event after commit; a headline; the tax slip', async () => {
  const x = await world();
  try {
    const [s, t] = x.students;
    const got = [];
    x.app.events.on('module.exchange.rrsp_settled', (p) => got.push({ ...p, inTx: x.app.db.isTransaction }));
    feed(x, s, 1); feed(x, t, 1); await x.advance(12);                                    // month 13
    feed(x, s, 2); feed(x, t, 2);
    await x.post(s, '/contribute', { account: 'rrsp', cents: 800000 });
    await x.post(s, '/order', { ticker: 'DAAX', account: 'rrsp', side: 'buy', type: 'market', cents: 500000 });
    const before = x.chequing(s), tBefore = x.chequing(t);
    assert.equal((await x.state(s)).rrsp.if_year_ended.settle, (await x.state(s)).rrsp.if_year_ended.tax_before - (await x.state(s)).rrsp.if_year_ended.tax_after);
    near((await x.state(s)).rrsp.if_year_ended.net_cents, 176000, 3, 'the refund if the year ended today');
    await x.advance(11);                                                                  // month 24: still year 2
    assert.equal(got.length, 0); assert.equal(slipRow(x, s, 2), undefined);
    await x.advance();                                                                    // month 25: the settlement
    const row = slipRow(x, s, 2);
    assert.deepEqual([row.g_cents, row.c_cents, row.w_cents, row.h_cents, row.month], [4800000, 800000, 0, 0, 25]);
    near(row.refund_cents, 800000 * 0.22, 3, '22% of $8,000');
    assert.equal(row.refund_cents, row.tax_before_cents - row.tax_after_cents);
    assert.equal(x.chequing(s), before + row.refund_cents);
    assert.deepEqual([row.owing_cents, row.unpaid_cents], [0, 0]);
    assert.equal(x.chequing(t), tBefore, 'no RRSP activity, no settlement');
    assert.equal(slipRow(x, t, 2), undefined);
    assert.deepEqual(got, [{ playerId: s.id, worldId: x.app.world.current().id, year: 2, refund: row.refund_cents, owing: 0, inTx: false }]);
    const tx = x.app.db.prepare("SELECT t.id, e.memo FROM txns t JOIN entries e ON e.txn_id = t.id WHERE t.kind = 'exchange.rrsp_refund' AND e.amount_cents > 0").all();
    assert.deepEqual(tx.map((q) => q.memo), ['RRSP tax refund (world year 2)']);
    const view = (await x.state(s)).rrsp;
    assert.equal(view.last.year, 2); assert.equal(view.last.refund_cents, row.refund_cents); assert.equal(view.contributed_cents, 0, 'a new year starts from zero');
    assert.ok((await x.state(s)).news.some((n) => n.kind === 'rrsp' && /1 student got an RRSP tax refund for world year 2/.test(n.text)));
    x.audit();
  } finally { await x.cleanup(); }
});

test('RRSP settlement for a withdrawer: owing = tax on the withdrawal less what was withheld; owing larger than chequing is carried into the next settlement', async () => {
  const x = await world({ count: 1 });
  try {
    const [s] = x.students;
    const got = [];
    x.app.events.on('module.exchange.rrsp_settled', (p) => got.push(p));
    feed(x, s, 1); await x.advance(12);                                                   // month 13
    feed(x, s, 2);
    await x.post(s, '/contribute', { account: 'rrsp', cents: 800000 });
    await x.advance(12);                                                                  // month 25: the contribution is settled (a refund)
    assert.equal(got.length, 1);
    feed(x, s, 3);
    const w = (await x.post(s, '/withdraw', { account: 'rrsp', cents: 800000 })).json;    // year 3: take it all out; 20% withheld
    assert.equal(w.withheld_cents, 160000);
    drain(x, s, 5000);                                                                    // chequing is nearly empty when the bill comes
    await x.advance(12);                                                                  // month 37: settle year 3
    const row = slipRow(x, s, 3);
    assert.deepEqual([row.c_cents, row.w_cents, row.h_cents], [0, 800000, 160000]);
    assert.equal(row.owing_cents, row.tax_after_cents - row.tax_before_cents - 160000);
    near(row.owing_cents, 800000 * 0.22 - 160000, 3, 'tax on the $8,000 less the $1,600 withheld');
    assert.deepEqual([row.refund_cents, row.paid_cents, row.unpaid_cents], [0, 5000, row.owing_cents - 5000]);
    assert.equal(x.chequing(s), 0, 'everything it had went to the tax');
    assert.deepEqual(got.at(-1), { playerId: s.id, worldId: x.app.world.current().id, year: 3, refund: 0, owing: row.owing_cents });
    // year 4 has no RRSP activity, but the unpaid balance is collected at the next year-end (no interest)
    x.app.ledger.post({ kind: 'test.grant', actor: 'system', legs: [{ account: x.app.ledger.system('mint'), cents: -50000 }, { account: s.chequing.id, cents: 50000 }] });
    await x.advance(12);                                                                  // month 49
    const next = slipRow(x, s, 4);
    assert.deepEqual([next.c_cents, next.w_cents, next.carry_cents, next.owing_cents, next.paid_cents, next.unpaid_cents], [0, 0, row.unpaid_cents, row.unpaid_cents, row.unpaid_cents, 0]);
    assert.equal(x.chequing(s), 50000 - row.unpaid_cents);
    x.audit();
  } finally { await x.cleanup(); }
});

test('RRSP: trades, holds and pays dividends like the TFSA (DRIP works); the cash and holdings count in net worth at face value', async () => {
  const x = await world({ count: 1 });
  try {
    const [s] = x.students;
    feed(x, s, 1); await x.advance(12);
    await x.post(s, '/contribute', { account: 'rrsp', cents: 864000 });
    const buy = (await x.post(s, '/order', { ticker: 'CORN', account: 'rrsp', side: 'buy', type: 'market', units_micro: 20 * UNIT })).json;
    assert.equal(x.acct(s, 'rrsp'), 864000 - buy.cents);
    const dax = (await x.post(s, '/order', { ticker: 'DAAX', account: 'rrsp', side: 'buy', type: 'market', cents: 200000 })).json;
    assert.deepEqual(x.holdings(s).map((h) => h.account), ['rrsp', 'rrsp']);
    assert.equal((await x.post(s, '/drip', { account: 'rrsp', ticker: 'CORN', drip: true })).status, 200);
    const nw = (await s.client.get('/api/savings/status')).json;
    assert.equal(nw.exchange_value_cents, (await x.state(s)).portfolio_cents);
    const worth = x.app.db.prepare("SELECT SUM(balance_cents) AS n FROM accounts WHERE owner_type = 'player' AND owner_id = ?").get(s.id).n;
    assert.equal(nw.net_worth_cents, worth + nw.exchange_value_cents, 'rrsp cash is in the ledger, holdings in the value event: both count, pre-tax');
    assert.equal((await x.state(s)).accounts.rrsp_cents, x.acct(s, 'rrsp'));
    await x.advance(2);                                                                   // month 15: the March dividend of world year 2
    const d = x.app.db.prepare("SELECT * FROM exchange_dividends WHERE player_id = ? AND ticker = 'CORN'").get(s.id);
    assert.equal(d.account, 'rrsp'); assert.equal(d.drip, 1);
    assert.ok(x.holdings(s).find((h) => h.ticker === 'CORN').units_micro > 20 * UNIT, 'reinvested inside the RRSP');
    assert.ok(dax.units_micro > 0);
    x.audit();
  } finally { await x.cleanup(); }
});

test('RRSP teacher view: usage per class (share contributing, total put in, total refunds); teacher B sees only their own class', async () => {
  const x = await world();
  try {
    const [s, t] = x.students;
    const b = x.srv.client();
    const invite = (await x.teacher.post('/api/teach/invites')).json;
    await b.post('/api/teach/join', { token: new URL(invite.url).searchParams.get('invite'), username: 'teacherB', passphrase: 'another long passphrase' });
    feed(x, s, 1); feed(x, t, 1); await x.advance(12);
    feed(x, s, 2);
    await x.post(s, '/contribute', { account: 'rrsp', cents: 800000 });
    await x.post(t, '/contribute', { account: 'rrsp', cents: 100000 });
    let c = (await x.teacher.get('/api/exchange/teach')).json.classes[0];
    assert.deepEqual([c.rrsp_users, c.rrsp_contributed_cents, c.rrsp_refund_cents, c.students], [2, 900000, 0, 3]);
    await x.advance(12);
    c = (await x.teacher.get('/api/exchange/teach')).json.classes[0];
    const refunds = slipRow(x, s, 2).refund_cents + slipRow(x, t, 2).refund_cents;
    assert.equal(c.rrsp_refund_cents, refunds); assert.ok(refunds > 0);
    const bClass = (await b.post('/api/teach/classes', { name: 'B block', course: 'fintech10' })).json;
    assert.ok(bClass.id);
    const bView = (await b.get('/api/exchange/teach')).json;
    assert.deepEqual(bView.classes.map((q) => [q.name, q.rrsp_users, q.rrsp_contributed_cents, q.rrsp_refund_cents]), [['B block', 0, 0, 0]]);
    assert.ok(!JSON.stringify(bView).includes(s.username));
  } finally { await x.cleanup(); }
});

test('RRSP season close: room, income, contributions and the account all reset with the new world; nothing is settled across seasons', async () => {
  const x = await world({ count: 1 });
  try {
    const [s] = x.students;
    feed(x, s, 1); await x.advance(12);
    await x.post(s, '/contribute', { account: 'rrsp', cents: 864000 });
    assert.equal((await x.state(s)).rrsp.room_cents, 0);
    const w1 = x.app.world.current();
    x.app.world.close({ actor: 'system' });
    x.audit();
    x.app.world.create({ name: 'Season 2' });
    const st = (await x.state(s)).rrsp;
    assert.deepEqual([st.room_cents, st.income_cents, st.last_year_income_cents, st.contributed_cents, st.last], [0, 0, 0, 0, null]);
    assert.equal((await x.state(s)).accounts.rrsp_cents, 0);
    assert.equal((await x.post(s, '/contribute', { account: 'rrsp', cents: 100 })).status, 400);
    await x.advance(12); await x.advance();                                              // a year turns in the new world: nothing from season 1 is settled
    assert.equal(x.app.db.prepare('SELECT COUNT(*) AS n FROM exchange_settlements WHERE world_id <> ?').get(w1.id).n, 0);
    assert.equal(x.app.db.prepare('SELECT COUNT(*) AS n FROM exchange_income WHERE world_id = ?').get(x.app.world.current().id).n, 0);
    x.audit();
  } finally { await x.cleanup(); }
});

test('badges, the news strip: the index level and the newest headline appear in /api/me after the first tick', async () => {
  const x = await world({ count: 1 });
  try {
    const [s] = x.students;
    assert.equal((await s.client.get('/api/me')).json.badges.filter((b) => /DAAX/.test(b.text)).length, 0);
    await x.advance();
    const badges = (await s.client.get('/api/me')).json.badges;
    const dax = badges.find((b) => /^DAAX \$\d/.test(b.text));
    assert.ok(dax && dax.text.length <= 40, JSON.stringify(badges));
    const me = (await s.client.get('/api/me')).json;
    assert.ok(me.panels.some((p) => p.building.key === 'exchange'));
    assert.ok(badges.every((b) => b.text.length <= 40));
  } finally { await x.cleanup(); }
});

test('config can add a stock; the series is deterministic per world; a rerun of the same world id and secret gives the same prices', async () => {
  const extra = { extraStocks: [{ ticker: 'TOWN', name: 'Town Hall Bakery', sigmaBp: 3000, tiltBp: 0, yieldBp: 100, startCents: 2500 }, { ticker: 'bad', name: 'x', sigmaBp: 3000, tiltBp: 0, yieldBp: 0, startCents: 100 }] };
  const a = await world({ count: 1, exchange: extra }), b = await world({ count: 1, exchange: extra });
  try {
    const st = await a.state(a.students[0]);
    assert.ok(st.securities.some((q) => q.ticker === 'TOWN' && q.price_cents === 2500));
    assert.ok(!st.securities.some((q) => q.ticker === 'bad'));
    assert.equal(a.secret(), b.secret());
    await a.advance(6); await b.advance(6);
    assert.deepEqual(a.prices(), b.prices(), 'two fresh databases, world id 1 and the same secret in both: the same series');
    assert.ok(a.prices().TOWN > 0 && a.prices().TOWN !== 2500 * 10000);
  } finally { await a.cleanup(); await b.cleanup(); }
});

test('the module reads no other module\'s tables and never uses the wall clock', () => {
  for (const f of moduleFiles('exchange')) {
    const src = moduleSource('exchange', f);
    assert.equal(src.match(/\b(?:FROM|JOIN|INTO|UPDATE)\s+(?!exchange_)(?:bills|jobs|housing|credit|savings|rates|insurance|bank_basic|leaderboards|outfitters)_\w+/gi), null, f);
    assert.doesNotMatch(src, /Date\.now\(|Math\.random\(/, f);
  }
});
