// outfitters module (docs/outfitters.md): price x index + GST, the would-grow-to line, resale depreciation, the card limit and season scoping, each
// achievement firing once, class goals at 80%, the store switch, and the guardrail (a purchase changes nobody else's numbers).
// Real bank-basic + bills + outfitters; other modules' facts arrive as the events they would emit.
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from '../lib/app.js';
import { svgSourceProblem } from '../public/svg-allow.js';
import { boot, seeded, tmpDir } from './helpers.js';
import { ALL_ITEMS, ITEMS, ACHIEVEMENTS, VENTURE_ITEMS, GOALS, growTo, gstOf, resaleValue, PROJECTION_BP } from '../modules/outfitters/constants.js';

const made = [];
after(() => { for (const d of made) fs.rmSync(d, { recursive: true, force: true }); });

function setup(outfitters = {}, order = ['bank-basic', 'outfitters']) {
  const d = tmpDir(); made.push(d);
  for (const id of order) {
    if (id === 'caller') { fs.mkdirSync(path.join(d, id)); fs.writeFileSync(path.join(d, id, 'index.js'), CALLER); } else fs.symlinkSync(path.join(ROOT, 'modules', id), path.join(d, id));
  }
  const config = { courses: { fintech10: { label: 'x', modules: order }, fintech2030: { label: 'y', modules: order } }, options: { 'bank-basic': { startCents: 50000 }, outfitters } };
  return { config, modulesDir: d };
}

// order defaults to bank-basic + outfitters: a real bills module would flag late the bills these tests never pay
async function world({ count = 2, outfitters, order } = {}) {
  const srv = await boot(setup(outfitters, order));
  const t = await seeded(srv, count, { transfers: false });
  const app = srv.app;
  const give = (s, cents) => app.ledger.post({ kind: 'test.grant', legs: [{ account: app.ledger.system('mint'), cents: -cents }, { account: s.chequing.id, cents }] });
  const bal = (s) => app.ledger.balance(s.chequing.id);
  const state = async (s) => (await s.client.get('/api/outfitters/state')).json;
  const buy = (s, item, source = 'chequing') => s.client.post('/api/outfitters/buy', { item, source });
  const advance = (n = 1) => app.world.advance({ months: n });
  const emit = (type, payload) => app.events.emit(type, payload);
  const wid = () => app.world.current().id;
  for (const s of t.students) give(s, 500000);
  return { srv, app, ...t, give, bal, state, buy, advance, emit, wid };
}

test('catalogue: 19 items for sale + 5 earned + 8 Venture Row goods, every icon passes the SVG allowlist, prices are integer cents, needs and wants both exist', () => {
  assert.equal(ITEMS.length, 19);
  assert.equal(ALL_ITEMS.length, 32);
  assert.equal(new Set(ALL_ITEMS.map((i) => i.id)).size, 32);
  assert.equal(Object.keys(VENTURE_ITEMS).length, 8);
  for (const i of Object.values(VENTURE_ITEMS)) assert.equal(i.unlock, 'venture');
  for (const i of ALL_ITEMS) {
    assert.equal(svgSourceProblem(i.icon), null, i.id);
    assert.ok(Number.isSafeInteger(i.price_cents) && i.price_cents >= 0, i.id);
    assert.ok(i.unlock ? i.price_cents === 0 : i.price_cents > 0, i.id);
    assert.ok(['wardrobe', 'home'].includes(i.grp));
  }
  assert.ok(ITEMS.some((i) => i.category === 'need') && ITEMS.some((i) => i.category === 'want'));
  assert.deepEqual(ACHIEVEMENTS.map((a) => a.key), ['credit750', 'firstkeys', 'ontime', 'promoted', 'emergency']);
  assert.deepEqual(GOALS.map((g) => g.key), ['ontime', 'credit']);
  // a few cited anchors, with their source pages
  for (const id of ['mattress', 'desk', 'gaming']) assert.ok(ITEMS.find((i) => i.id === id).source_url.startsWith('https://') && !ITEMS.find((i) => i.id === id).illustrative);
  // cosmetic only: no money, rate or score is a column of the catalogue
  assert.deepEqual(Object.keys(ITEMS[0]).filter((k) => /rate|score|bonus|cash/.test(k)), []);
});

test('the math: GST rounds to the cent, would-grow-to compounds 5 years at 6.3%, resale depreciates monthly and floors', () => {
  assert.equal(gstOf(18000), 900);
  assert.equal(gstOf(18378), 919);                           // 918.9 rounds up
  assert.equal(PROJECTION_BP, 630);
  assert.equal(growTo(18900), 25652);                        // 18,900 x 1.063^5 = 25,652.4
  assert.equal(growTo(0), 0);
  assert.equal(resaleValue(18000, 400, 0), 18000);           // the day you buy it
  assert.equal(resaleValue(18000, 400, 1), 17280);
  assert.equal(resaleValue(18000, 400, 12), 11028);          // 18000 x 0.96^12 = 11,028.0..., floored
  assert.equal(resaleValue(89500, 150, 12), 74654);
  assert.ok(resaleValue(18000, 400, 5) <= Math.floor(18000 * 0.96 ** 5 + 1e-9));
});

test('worked purchase: price x index + 5% GST, the would-grow-to line, paid from chequing to the sink; sold later at the depreciated value from the mint', async () => {
  const w = await world();
  try {
    const [a, b] = w.students;
    w.advance();
    let s = await w.state(a);
    const puffer = s.items.find((i) => i.id === 'puffer');
    assert.deepEqual([puffer.price_cents, puffer.gst_cents, puffer.total_cents, puffer.grow_cents, puffer.category], [18000, 900, 18900, 25652, 'want']);
    assert.equal(s.gst.bp, 500);
    // the world price index (module.rates.changed) scales the price; GST is on the indexed price
    w.emit('module.rates.changed', { worldId: w.wid(), month: 1, priceIndexBp: 10210 });
    const after = (await w.state(a)).items.find((i) => i.id === 'puffer');
    assert.deepEqual([after.price_cents, after.gst_cents, after.total_cents, after.grow_cents], [18378, 919, 19297, 26191]);

    const before = w.bal(a), sink = w.app.ledger.balance(w.app.ledger.system('sink'));
    const r = await w.buy(a, 'puffer');
    assert.equal(r.status, 200);
    assert.deepEqual([r.json.price_cents, r.json.gst_cents, r.json.total_cents], [18378, 919, 19297]);
    assert.equal(before - w.bal(a), 19297);
    assert.equal(w.app.ledger.balance(w.app.ledger.system('sink')) - sink, 19297);
    const e = w.app.ledger.statement(a.chequing.id, { limit: 1 })[0];
    assert.equal(e.kind, 'outfitters.purchase');
    assert.equal((await w.buy(a, 'puffer')).status, 409, 'owned once');
    assert.equal((await w.buy(b, 'puffer')).status, 200, 'another student can still buy it');

    w.advance(6);
    s = await w.state(a);
    const mine = s.owned.find((o) => o.item_id === 'puffer');
    assert.deepEqual([mine.paid_cents, mine.months_owned, mine.value_cents], [19297, 6, resaleValue(18378, 400, 6)]);
    const cash = w.bal(a), mint = w.app.ledger.balance(w.app.ledger.system('mint'));
    const sold = await a.client.post('/api/outfitters/sell', { id: mine.id });
    assert.equal(sold.status, 200);
    assert.equal(sold.json.value_cents, resaleValue(18378, 400, 6));
    assert.equal(w.bal(a) - cash, resaleValue(18378, 400, 6));
    assert.equal(w.app.ledger.statement(a.chequing.id, { limit: 1 })[0].kind, 'outfitters.resale');
    assert.equal(mint - w.app.ledger.balance(w.app.ledger.system('mint')), resaleValue(18378, 400, 6), 'the money comes from the mint');
    assert.equal((await a.client.post('/api/outfitters/sell', { id: mine.id })).status, 404, 'sold once');
    assert.equal((await w.buy(a, 'puffer')).status, 200, 'can buy it again after selling');
    assert.equal(w.app.ledger.audit().ok, true);
  } finally { await w.srv.cleanup(); }
});

test('chequing is never overdrawn; configured prices override the catalogue', async () => {
  const w = await world({ outfitters: { prices: { tee: 123456 } } });
  try {
    const [a] = w.students;
    assert.equal((await w.state(a)).items.find((i) => i.id === 'tee').price_cents, 123456);
    w.app.ledger.post({ kind: 'test.take', legs: [{ account: a.chequing.id, cents: -(w.bal(a) - 1000) }, { account: w.app.ledger.system('sink'), cents: w.bal(a) - 1000 }] });
    const before = w.bal(a);
    const r = await w.buy(a, 'sectional');
    assert.equal(r.status, 400);
    assert.match(r.json.error, /Not enough in chequing/);
    assert.equal(w.bal(a), before);
    assert.equal((await w.buy(a, 'bomber-750')).status, 400, 'achievement items are not for sale');
    assert.equal((await w.buy(a, 'nope')).status, 400);
    assert.equal((await w.buy(a, 'tee', 'gold')).status, 400);
  } finally { await w.srv.cleanup(); }
});

test('card: needs a card and this season\'s limit; refused past the limit; a new season has no limit', async () => {
  const w = await world({ count: 1 });
  try {
    const [a] = w.students, app = w.app;
    const cardBal = () => app.ledger.balance(app.ledger.accountId('player', a.id, 'card'));
    assert.equal((await w.buy(a, 'tee', 'card')).status, 400);                         // no card
    assert.equal((await w.state(a)).card, null);
    app.ledger.openAccount({ ownerType: 'player', ownerId: a.id, kind: 'card', allowNegative: true });
    const noLimit = await w.buy(a, 'tee', 'card');
    assert.equal(noLimit.status, 400);
    assert.match(noLimit.json.error, /limit .* not known/);
    w.emit('module.credit.limit', { playerId: a.id, worldId: w.wid(), limitCents: 30000, aprBp: 2099 });
    assert.equal((await w.state(a)).card.available_cents, 30000);
    const chq = w.bal(a);
    assert.equal((await w.buy(a, 'sneakers', 'card')).status, 200);                    // $70 + $3.50 = $73.50
    assert.equal(cardBal(), -7350);
    assert.equal(w.bal(a), chq, 'chequing untouched');
    assert.equal(app.ledger.statement(app.ledger.accountId('player', a.id, 'card'), { limit: 1 })[0].kind, 'outfitters.purchase');
    const over = await w.buy(a, 'parka', 'card');                                      // $367.50 with GST > $226.50 left
    assert.equal(over.status, 400);
    assert.match(over.json.error, /Not enough room on your card/);
    assert.equal(cardBal(), -7350);
    assert.equal((await w.buy(a, 'toque', 'card')).status, 200);                       // $26.25 still fits
    // a new season: the old limit is not this season's
    assert.equal((await w.teacher.post('/api/teach/world/close', {})).status, 200);
    assert.equal((await w.teacher.post('/api/teach/world/create', { name: 'Season 2', season_start: '2027-02-01', season_end: '2027-06-30' })).status, 200);
    assert.equal((await w.state(a)).owned.length, 0, 'ownership belongs to its season');
    const s2 = await w.buy(a, 'tee', 'card');
    assert.equal(s2.status, 400);
    assert.match(s2.json.error, /limit .* not known/);
    assert.equal(app.ledger.audit().ok, true);
  } finally { await w.srv.cleanup(); }
});

test('B16: an item bought on the card is refunded to the card: buy + resell + rebuy turns none of the limit into chequing; the refund counts toward the statement', async () => {
  const w = await world({ count: 1, order: ['bank-basic', 'credit', 'outfitters'] });
  try {
    const [a] = w.students, app = w.app;
    const account = app.ledger.openAccount({ ownerType: 'player', ownerId: a.id, kind: 'card', allowNegative: true });   // what credit's /apply does
    app.db.prepare('INSERT INTO credit_files (player_id, world_id, opened_month) VALUES (?, ?, ?)').run(a.id, w.wid(), 1);
    app.db.prepare('INSERT INTO credit_cards (player_id, world_id, account_id, limit_cents, opened_month) VALUES (?, ?, ?, ?, ?)').run(a.id, w.wid(), account, 100000, 1);
    w.emit('module.credit.limit', { playerId: a.id, worldId: w.wid(), limitCents: 100000, aprBp: 2099 });
    const card = () => app.ledger.balance(account);
    const owned = async (item) => (await w.state(a)).owned.find((o) => o.item_id === item);
    const chq = w.bal(a);
    // the cash-advance loop, same month: buy on the card, resell at full value, buy again
    for (let i = 0; i < 2; i++) {
      assert.equal((await w.buy(a, 'parka', 'card')).status, 200);                    // $350 + $17.50 GST on the card
      const sold = await a.client.post('/api/outfitters/sell', { id: (await owned('parka')).id });
      assert.deepEqual([sold.status, sold.json.value_cents, sold.json.to_card_cents], [200, 35000, 35000]);
      assert.equal(w.bal(a), chq, 'chequing gains nothing');
    }
    assert.equal(card(), -2 * 1750, 'the card owes only the GST lost on each round');
    const legs = app.db.prepare('SELECT e.account_id, e.amount_cents FROM entries e JOIN txns t ON t.id = e.txn_id WHERE t.kind = ? ORDER BY e.id DESC LIMIT 2').all('outfitters.resale');
    assert.deepEqual(legs.map((l) => [l.account_id, l.amount_cents]).sort(), [[account, 35000], [app.ledger.system('mint'), -35000]].sort());

    // a card already paid off: the refund cannot push the card into credit, the rest goes to chequing
    assert.equal((await w.buy(a, 'toque', 'card')).status, 200);                       // $26.25 more: owes $61.25
    assert.equal((await a.client.post('/api/credit/pay', { mode: 'full' })).status, 200);
    assert.equal(card(), 0);
    const paid = w.bal(a);
    const sold = await a.client.post('/api/outfitters/sell', { id: (await owned('toque')).id });
    assert.deepEqual([sold.json.value_cents, sold.json.to_card_cents], [2500, 0]);
    assert.deepEqual([card(), w.bal(a)], [0, paid + 2500]);

    // across a statement: the refund counts toward it, so paying the rest in full is paying in full (no interest)
    assert.equal((await w.buy(a, 'parka', 'card')).status, 200);
    w.advance();                                                                       // statement for $367.50
    assert.equal(app.db.prepare('SELECT balance_cents FROM credit_statements WHERE player_id = ? AND settled = 0').get(a.id).balance_cents, 36750);
    const back = await a.client.post('/api/outfitters/sell', { id: (await owned('parka')).id });
    assert.equal(back.json.to_card_cents, resaleValue(35000, (await w.state(a)).items.find((i) => i.id === 'parka').dep_bp, 1));
    assert.equal((await a.client.post('/api/credit/pay', { mode: 'full' })).status, 200);
    w.advance();
    const judged = app.db.prepare('SELECT paid_cents, refund_cents, interest_cents, fee_cents FROM credit_statements WHERE player_id = ? AND settled = 1 ORDER BY id DESC').get(a.id);
    assert.deepEqual({ ...judged }, { paid_cents: 36750 - back.json.to_card_cents, refund_cents: back.json.to_card_cents, interest_cents: 0, fee_cents: 0 });
    assert.equal(app.ledger.audit().ok, true);
  } finally { await w.srv.cleanup(); }
});

test('B16: a refund is a credit, not a payment: cycling buy + resell on the card after the statement never meets the minimum (same fees and late marks as paying nothing)', async () => {
  const w = await world({ count: 2, order: ['bank-basic', 'credit', 'outfitters'] });
  try {
    const app = w.app, [cycler, control] = w.students;
    for (const s of w.students) {
      s.card = app.ledger.openAccount({ ownerType: 'player', ownerId: s.id, kind: 'card', allowNegative: true });
      app.db.prepare('INSERT INTO credit_files (player_id, world_id, opened_month) VALUES (?, ?, ?)').run(s.id, w.wid(), 1);
      app.db.prepare('INSERT INTO credit_cards (player_id, world_id, account_id, limit_cents, opened_month) VALUES (?, ?, ?, ?, ?)').run(s.id, w.wid(), s.card, 100000, 1);
      w.emit('module.credit.limit', { playerId: s.id, worldId: w.wid(), limitCents: 100000, aprBp: 2099 });
      assert.equal((await w.buy(s, 'parka', 'card')).status, 200);
    }
    w.advance();                                                                       // both: a $367.50 statement, minimum unpaid from here on
    const chq = w.bal(cycler);
    for (let m = 0; m < 3; m++) {                                                     // the cycler buys jeans on the card and resells them every month
      assert.equal((await w.buy(cycler, 'jeans', 'card')).status, 200);
      const id = (await w.state(cycler)).owned.find((o) => o.item_id === 'jeans').id;
      assert.ok((await cycler.client.post('/api/outfitters/sell', { id })).json.to_card_cents > 0);
      w.advance();
    }
    const record = (s) => ({
      fees: app.db.prepare('SELECT COALESCE(SUM(fee_cents), 0) AS n FROM credit_statements WHERE player_id = ? AND settled = 1').get(s.id).n,
      late: app.db.prepare("SELECT COUNT(*) AS n FROM credit_history WHERE player_id = ? AND source = 'card' AND outcome = 'late'").get(s.id).n,
      ontime: app.db.prepare("SELECT COUNT(*) AS n FROM credit_history WHERE player_id = ? AND source = 'card' AND outcome = 'ontime'").get(s.id).n,
      paid: app.db.prepare('SELECT COALESCE(SUM(paid_cents), 0) AS n FROM credit_statements WHERE player_id = ?').get(s.id).n,
    });
    assert.deepEqual(record(cycler), record(control));
    assert.deepEqual(record(control), { fees: 3 * 2900, late: 3, ontime: 0, paid: 0 });
    assert.equal(w.bal(cycler), chq, 'no cash either way');
    assert.equal(app.ledger.audit().ok, true);
  } finally { await w.srv.cleanup(); }
});

test('equip: one item per slot; selling takes it off; earned items cannot be sold', async () => {
  const w = await world({ count: 1 });
  try {
    const [a] = w.students;
    await w.buy(a, 'sneakers'); await w.buy(a, 'designer-sneakers'); await w.buy(a, 'tee');
    const owned = (await w.state(a)).owned;
    const id = (item) => owned.find((o) => o.item_id === item).id;
    assert.equal((await a.client.post('/api/outfitters/equip', { id: id('sneakers') })).status, 200);
    assert.equal((await a.client.post('/api/outfitters/equip', { id: id('designer-sneakers') })).status, 200);
    let eq = (await w.state(a)).owned.filter((o) => o.equipped).map((o) => o.item_id);
    assert.deepEqual(eq, ['designer-sneakers'], 'the shoes slot holds one');
    await a.client.post('/api/outfitters/equip', { id: id('tee') });
    assert.equal((await w.state(a)).owned.filter((o) => o.equipped).length, 2, 'different slots can both be worn');
    await a.client.post('/api/outfitters/sell', { id: id('designer-sneakers') });
    eq = (await w.state(a)).owned.filter((o) => o.equipped).map((o) => o.item_id);
    assert.deepEqual(eq, ['tee']);
    w.emit('module.jobs.promoted', { playerId: a.id, worldId: w.wid(), month: 1, title: 'Supervisor' });
    const blazer = (await w.state(a)).owned.find((o) => o.item_id === 'promoted-blazer');
    assert.equal(blazer.earned, true);
    assert.equal((await a.client.post('/api/outfitters/sell', { id: blazer.id })).status, 400);
    assert.equal((await a.client.post('/api/outfitters/equip', { id: blazer.id })).status, 200);
    assert.equal((await a.client.post('/api/outfitters/equip', { id: 999999 })).status, 404);
  } finally { await w.srv.cleanup(); }
});

test('unequip: takes one item off and leaves the other slots; a second call is harmless; not yours, sold or unknown is 404', async () => {
  const w = await world({ count: 2 });
  try {
    const [a, b] = w.students;
    await w.buy(a, 'sneakers'); await w.buy(a, 'tee'); await w.buy(a, 'wolves-hoodie');
    const owned = (await w.state(a)).owned;
    const id = (item) => owned.find((o) => o.item_id === item).id;
    const worn = async () => (await w.state(a)).owned.filter((o) => o.equipped).map((o) => o.item_id).sort();
    await a.client.post('/api/outfitters/equip', { id: id('sneakers') });
    await a.client.post('/api/outfitters/equip', { id: id('tee') });
    assert.deepEqual(await worn(), ['sneakers', 'tee']);
    assert.equal((await a.client.post('/api/outfitters/unequip', { id: id('sneakers') })).status, 200);
    assert.deepEqual(await worn(), ['tee'], 'only that item came off');
    assert.equal((await a.client.post('/api/outfitters/unequip', { id: id('sneakers') })).status, 200, 'already off: still fine');
    assert.deepEqual(await worn(), ['tee']);
    assert.equal((await b.client.post('/api/outfitters/unequip', { id: id('tee') })).status, 404, 'not your item');
    assert.deepEqual(await worn(), ['tee'], 'and it stayed on');
    assert.equal((await a.client.post('/api/outfitters/unequip', { id: 999999 })).status, 404);
    await a.client.post('/api/outfitters/sell', { id: id('wolves-hoodie') });
    assert.equal((await a.client.post('/api/outfitters/unequip', { id: id('wolves-hoodie') })).status, 404, 'sold');
    assert.equal((await a.client.post('/api/outfitters/unequip', {})).status, 400, 'an id is required');
  } finally { await w.srv.cleanup(); }
});

test('achievements: each fires once per world, announces once, and lands a free item; credit, keys, promotion, emergency fund', async () => {
  const w = await world({ count: 1 });
  try {
    const [a] = w.students, un = () => w.app.db.prepare('SELECT key FROM outfitters_unlocks WHERE player_id = ? AND world_id = ?').all(a.id, w.wid()).map((r) => r.key).sort();
    const unlocked = [];
    w.app.events.on('module.outfitters.unlocked', (p) => unlocked.push(p.key));
    w.advance();
    w.emit('module.credit.score', { playerId: a.id, month: 1, score: 749 });
    assert.deepEqual(un(), []);
    w.emit('module.credit.score', { playerId: a.id, month: 2, score: 750 });
    w.emit('module.credit.score', { playerId: a.id, month: 3, score: 800 });
    assert.deepEqual(un(), ['credit750']);
    w.emit('module.housing.value', { playerId: a.id, homeValue: 0, mortgageBalance: 0 });
    assert.deepEqual(un(), ['credit750'], 'a home worth nothing is not a home');
    w.emit('module.housing.value', { playerId: a.id, homeValue: 20200000, mortgageBalance: 18000000 });
    w.emit('module.housing.value', { playerId: a.id, homeValue: 20300000, mortgageBalance: 17900000 });
    w.emit('module.jobs.promoted', { playerId: a.id, worldId: w.wid(), month: 3, title: 'Supervisor' });
    w.emit('module.jobs.promoted', { playerId: a.id, worldId: w.wid(), month: 9, title: 'Manager' });
    // emergency fund: 3 x the biggest recent month of bill payments ($1,385 -> $4,155); with no bill history, 3 x last net pay
    w.emit('module.bills.paid', { playerId: a.id, month: 1, billId: 'rent', onTime: true, amount: 138500 });
    w.emit('module.savings.snapshot', { playerId: a.id, worldId: w.wid(), month: 1, hisa: 415499, netWorth: 0 });
    assert.ok(!un().includes('emergency'));
    const s0 = (await w.state(a)).achievements.find((x) => x.key === 'emergency');
    assert.equal(s0.unlocked, false);
    assert.match(s0.text, /\$4154\.99 of \$4155\.00/);
    w.emit('module.savings.snapshot', { playerId: a.id, worldId: w.wid(), month: 2, hisa: 415500, netWorth: 0 });
    w.emit('module.savings.snapshot', { playerId: a.id, worldId: w.wid(), month: 3, hisa: 900000, netWorth: 0 });
    assert.deepEqual(un(), ['credit750', 'emergency', 'firstkeys', 'promoted']);
    assert.deepEqual(unlocked.sort(), ['credit750', 'emergency', 'firstkeys', 'promoted'], 'one event each');
    const s = await w.state(a);
    assert.deepEqual(s.owned.filter((o) => o.earned).map((o) => o.item_id).sort(), ['bomber-750', 'emergency-umbrella', 'first-keys', 'promoted-blazer']);
    assert.deepEqual(s.announce.length, 4);
    await a.client.post('/api/outfitters/seen', {});
    assert.equal((await w.state(a)).announce.length, 0, 'announced once');
    w.emit('module.credit.score', { playerId: a.id, month: 4, score: 810 });
    assert.equal((await w.state(a)).announce.length, 0);
    // fallback without bills: 3 x last net pay
    const w2 = await world({ count: 1 });
    try {
      const [b] = w2.students;
      w2.emit('module.jobs.paid', { playerId: b.id, worldId: w2.wid(), month: 1, net: 200000, gross: 250000 });
      w2.emit('module.savings.snapshot', { playerId: b.id, worldId: w2.wid(), month: 1, hisa: 599999, netWorth: 0 });
      assert.equal((await w2.state(b)).achievements.find((x) => x.key === 'emergency').unlocked, false);
      w2.emit('module.savings.snapshot', { playerId: b.id, worldId: w2.wid(), month: 2, hisa: 600000, netWorth: 0 });
      assert.equal((await w2.state(b)).achievements.find((x) => x.key === 'emergency').unlocked, true);
    } finally { await w2.srv.cleanup(); }
  } finally { await w.srv.cleanup(); }
});

test('"On time" watch: six world months in a row with a bill paid on time and no late bill; a late bill resets the streak; fires once', async () => {
  const w = await world({ count: 2 });
  try {
    const [a, b] = w.students, has = (s) => w.app.db.prepare("SELECT 1 FROM outfitters_unlocks WHERE player_id = ? AND key = 'ontime'").get(s.id) !== undefined;
    const month = () => w.app.world.current().month;
    w.advance();
    for (let i = 0; i < 6; i++) {
      for (const s of [a, b]) w.emit('module.bills.paid', { playerId: s.id, month: month(), billId: 'rent', onTime: !(s === b && i === 2), amount: 100000 });
      w.advance();
      if (i < 5) assert.equal(has(a), false, `not after ${i + 1} months`);
    }
    assert.equal(has(a), true, 'six clean months, judged at the tick after the sixth');
    assert.equal(has(b), false, 'b paid month 3 late');
    assert.equal((await w.state(a)).achievements.find((x) => x.key === 'ontime').unlocked, true);
    assert.equal(w.app.db.prepare("SELECT COUNT(*) AS n FROM outfitters_unlocks WHERE key = 'ontime'").get().n, 1);
    // b: a late event also breaks it, and a clean run is needed again
    for (let i = 0; i < 6; i++) { w.emit('module.bills.paid', { playerId: b.id, month: month(), billId: 'rent', onTime: true, amount: 100000 }); w.advance(); }
    assert.equal(has(b), true, 'six clean months after the late one');
    const before = w.app.db.prepare('SELECT COUNT(*) AS n FROM outfitters_owned WHERE player_id = ?').get(a.id).n;
    for (let i = 0; i < 3; i++) { w.emit('module.bills.paid', { playerId: a.id, month: month(), billId: 'rent', onTime: true, amount: 100000 }); w.advance(); }
    assert.equal(w.app.db.prepare('SELECT COUNT(*) AS n FROM outfitters_owned WHERE player_id = ?').get(a.id).n, before, 'no second watch');
    // a bill still unpaid at month end is flagged late at the next tick, which blocks the award
    const w3 = await world({ count: 1 });
    try {
      const [c] = w3.students, m3 = () => w3.app.world.current().month;
      w3.advance();
      for (let i = 0; i < 5; i++) { w3.emit('module.bills.paid', { playerId: c.id, month: m3(), billId: 'rent', onTime: true, amount: 100000 }); w3.advance(); }
      w3.emit('module.bills.paid', { playerId: c.id, month: m3(), billId: 'rent', onTime: true, amount: 100000 });   // month 6 looks clean...
      w3.emit('module.bills.late', { playerId: c.id, month: m3() + 1, billId: 'utilities', monthsLate: 1 });          // ...but a bill due in it is late next tick
      w3.advance();
      assert.equal(w3.app.db.prepare("SELECT COUNT(*) AS n FROM outfitters_unlocks WHERE key = 'ontime'").get().n, 0);
    } finally { await w3.srv.cleanup(); }
  } finally { await w.srv.cleanup(); }
});

test('class goals: the Wolf outfit unlocks when 80% of the class meets the goal, not at 60%; the credit goal needs a 700 median and 80% with a score', async () => {
  const w = await world({ count: 5 });
  try {
    const month = () => w.app.world.current().month, goals = () => w.app.db.prepare('SELECT goal FROM outfitters_goals WHERE class_id = ?').all(w.cls.id).map((r) => r.goal);
    w.advance();
    const pay = (list) => { for (const s of list) w.emit('module.bills.paid', { playerId: s.id, month: month(), billId: 'rent', onTime: true, amount: 100000 }); };
    pay(w.students.slice(0, 3)); w.advance();                               // 3 of 5 = 60%
    assert.deepEqual(goals(), []);
    let t = (await w.teacher.get('/api/outfitters/overview')).json.classes[0];
    assert.deepEqual([t.goals[0].pct, t.goals[0].unlocked, t.outfit], [60, false, null]);
    pay(w.students.slice(0, 4)); w.advance();                               // 4 of 5 = 80%
    assert.deepEqual(goals(), ['ontime']);
    t = (await w.teacher.get('/api/outfitters/overview')).json.classes[0];
    assert.deepEqual([t.goals[0].unlocked, t.outfit], [true, { key: 'suit', name: 'Suit Wolf' }]);
    assert.deepEqual((await w.state(w.students[4])).class.outfit, { key: 'suit', name: 'Suit Wolf' }, 'the whole class gets it, even the one who was late');
    // credit: four scores of 700+ and one under: median 720 but only if 80% have a score
    const scores = [720, 740, 700, 760];
    scores.slice(0, 3).forEach((sc, i) => w.emit('module.credit.score', { playerId: w.students[i].id, month: month(), score: sc }));
    w.advance();
    assert.ok(!goals().includes('credit'), '3 of 5 have a score: not enough of the class');
    w.emit('module.credit.score', { playerId: w.students[3].id, month: month(), score: scores[3] });
    w.advance();
    assert.ok(goals().includes('credit'));
    w.advance(3);
    assert.deepEqual(goals().sort(), ['credit', 'ontime'], 'each goal once');
    // a low median does not unlock
    const w2 = await world({ count: 5 });
    try {
      w2.advance();
      w2.students.forEach((s, i) => w2.emit('module.credit.score', { playerId: s.id, month: 1, score: [650, 660, 690, 800, 810][i] }));
      w2.advance();
      assert.deepEqual(w2.app.db.prepare('SELECT goal FROM outfitters_goals').all(), []);
    } finally { await w2.srv.cleanup(); }
  } finally { await w.srv.cleanup(); }
});

test('the store switch: the world teacher closes it for buying and selling; students and other teachers cannot', async () => {
  const w = await world({ count: 1 });
  try {
    const [a] = w.students;
    assert.equal((await a.client.post('/api/outfitters/store', { open: false })).status, 403);
    assert.equal((await w.buy(a, 'tee')).status, 200);
    assert.equal((await w.teacher.post('/api/outfitters/store', { open: false })).status, 200);
    assert.equal((await w.state(a)).open, false);
    const r = await w.buy(a, 'toque');
    assert.equal(r.status, 409);
    assert.match(r.json.error, /closed/);
    assert.equal((await a.client.post('/api/outfitters/sell', { id: (await w.state(a)).owned[0].id })).status, 409);
    assert.equal((await w.teacher.get('/api/outfitters/overview')).json.open, false);
    assert.equal((await w.teacher.post('/api/outfitters/store', { open: true })).status, 200);
    assert.equal((await w.buy(a, 'toque')).status, 200);
  } finally { await w.srv.cleanup(); }
});

test('teacher overview: spending on needs vs wants, items sold, achievement counts', async () => {
  const w = await world({ count: 2 });
  try {
    const [a, b] = w.students;
    await w.buy(a, 'tee'); await w.buy(a, 'hoodie'.replace('hoodie', 'wolves-hoodie')); await w.buy(b, 'designer-sneakers');
    await a.client.post('/api/outfitters/sell', { id: (await w.state(a)).owned.find((o) => o.item_id === 'tee').id });
    w.emit('module.jobs.promoted', { playerId: a.id, worldId: w.wid(), month: 1, title: 'x' });
    const c = (await w.teacher.get('/api/outfitters/overview')).json.classes[0];
    assert.deepEqual(c.needs, { items: 1, cents: 2100 });
    assert.deepEqual(c.wants, { items: 2, cents: 6825 + 29400 });
    assert.deepEqual([c.sold.items, c.sold.cents], [1, 2000]);
    assert.equal(c.achievements.find((x) => x.key === 'promoted').count, 1);
    assert.equal((await a.client.get('/api/outfitters/overview')).status, 403);
  } finally { await w.srv.cleanup(); }
});

test('guardrails: a purchase changes nothing but the buyer\'s money and outfitters\' own tables; no random prices; the same price twice', async () => {
  const w = await world({ count: 2, order: ['bank-basic', 'bills', 'outfitters'] });
  try {
    const [a, b] = w.students;
    w.advance(2);
    const tables = w.app.db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE 'outfitters_%' AND name NOT IN ('accounts', 'txns', 'entries', 'audit_log', 'sessions')").all().map((r) => r.name);
    const snap = () => JSON.stringify(tables.map((t) => [t, w.app.db.prepare(`SELECT * FROM ${t}`).all()]));
    const others = () => [w.bal(b)];
    const before = snap(), o = others(), supply = w.app.ledger.audit().moneySupply;
    const q1 = (await w.state(a)).items.map((i) => i.total_cents);
    for (const id of ['tee', 'mattress', 'gaming', 'plants']) assert.equal((await w.buy(a, id)).status, 200);
    await a.client.post('/api/outfitters/equip', { id: (await w.state(a)).owned[0].id });
    await a.client.post('/api/outfitters/sell', { id: (await w.state(a)).owned.find((x) => x.item_id === 'gaming').id });
    assert.equal(snap(), before, 'no other module\'s table changed');
    assert.deepEqual(others(), o);
    assert.deepEqual((await w.state(b)).items.map((i) => i.total_cents), q1, 'prices do not depend on what you bought, and are the same for everyone');
    assert.deepEqual((await w.state(a)).items.map((i) => i.total_cents), q1);
    assert.equal(w.app.ledger.audit().ok, true);
    // only the GST (the loss on resale aside) leaves circulation: the supply is untouched by a purchase
    assert.ok(w.app.ledger.audit().moneySupply >= supply);
  } finally { await w.srv.cleanup(); }
});

test('real jobs and savings emit module.jobs.promoted and module.savings.snapshot', async () => {
  const srv = await boot(setup({}, ['bank-basic', 'jobs', 'savings', 'outfitters']));
  try {
    const { teacher, students: [s] } = await seeded(srv, 1, { transfers: false });
    const seen = [];
    srv.app.events.on('module.jobs.promoted', (p) => seen.push(['promoted', p]));
    srv.app.events.on('module.savings.snapshot', (p) => seen.push(['snapshot', p]));
    assert.equal((await teacher.post('/api/jobs/assign', { player_id: s.id, job_id: 1 })).status, 200);
    srv.app.world.advance({ months: 2 });
    assert.equal((await teacher.post('/api/jobs/promote', { player_id: s.id })).status, 200);
    const promoted = seen.find(([t]) => t === 'promoted')[1];
    assert.deepEqual([promoted.playerId, promoted.worldId, typeof promoted.title], [s.id, srv.app.world.current().id, 'string']);
    assert.ok(srv.app.db.prepare("SELECT 1 FROM outfitters_unlocks WHERE player_id = ? AND key = 'promoted'").get(s.id));
    const snap = seen.filter(([t]) => t === 'snapshot').at(-1)[1];
    assert.deepEqual(Object.keys(snap).sort(), ['hisa', 'month', 'netWorth', 'playerId', 'worldId']);
    assert.equal(snap.playerId, s.id);
    assert.equal(snap.hisa, srv.app.ledger.balance(srv.app.ledger.accountId('player', s.id, 'hisa')));
    assert.ok(snap.netWorth > 0);
  } finally { await srv.cleanup(); }
});

// ---- grantItem service (wave 5a): another module hands a student an earned item ----
const CALLER = `import { defineModule } from '${new URL('../lib/modules.js', import.meta.url).href}';
export default defineModule({ id: 'caller', requires: ['outfitters'] });`;

test('grantItem: a caller module grants an earned item through k.modules.call: owned, unlocked event and banner, idempotent, plain JSON; rejects unknown items, sale items and unknown players', async () => {
  const w = await world({ order: ['bank-basic', 'outfitters', 'caller'] });
  try {
    const [a, b] = w.students;
    const k = w.app.modules.kernel('caller');
    const seen = [];
    w.app.events.on('module.outfitters.unlocked', (p) => seen.push(p));
    assert.equal(k.modules.has('outfitters'), true);
    const r1 = k.modules.call('outfitters', 'grantItem', { playerId: a.id, itemId: 'on-time-watch' });
    assert.deepEqual(r1, { playerId: a.id, itemId: 'on-time-watch', key: 'ontime', worldId: w.wid(), month: w.app.world.current().month });
    assert.deepEqual(seen, [{ playerId: a.id, key: 'ontime', itemId: 'on-time-watch' }]);
    const s = await w.state(a);
    assert.equal(s.achievements.find((x) => x.key === 'ontime').unlocked, true);
    assert.ok(s.owned.some((o) => o.item_id === 'on-time-watch' && o.earned));
    assert.deepEqual(s.announce, ['"On time" watch'], 'the Unlocked: banner has it');

    w.advance();                                                              // idempotent: same result a month later, no second event or row
    const r2 = k.modules.call('outfitters', 'grantItem', { playerId: a.id, itemId: 'on-time-watch' });
    assert.deepEqual(r2, r1);
    assert.equal(seen.length, 1);
    assert.equal(w.app.db.prepare("SELECT COUNT(*) AS n FROM outfitters_owned WHERE player_id = ? AND item_id = 'on-time-watch'").get(a.id).n, 1);
    assert.equal(JSON.stringify(r1), JSON.stringify(structuredClone(r1)));
    assert.equal((await w.state(b)).achievements.find((x) => x.key === 'ontime').unlocked, false, 'nobody else gets it');

    assert.throws(() => k.modules.call('outfitters', 'grantItem', { playerId: a.id, itemId: 'nope' }), (e) => e.status === 400);
    assert.throws(() => k.modules.call('outfitters', 'grantItem', { playerId: a.id, itemId: ITEMS[0].id }), (e) => e.status === 400, 'a catalogue item for sale is not grantable');
    assert.throws(() => k.modules.call('outfitters', 'grantItem', { playerId: a.id, itemId: 'wolf-suit' }), (e) => e.status === 400, 'Wolf outfits are class goals, not items');
    assert.throws(() => k.modules.call('outfitters', 'grantItem', { playerId: 99999, itemId: 'on-time-watch' }), (e) => e.status === 404);
    assert.throws(() => k.modules.call('outfitters', 'grantItem', { itemId: 'on-time-watch' }), (e) => e.status === 404);
    assert.throws(() => k.modules.call('outfitters', 'grantItem', undefined), (e) => e.status === 404);
    assert.equal(seen.length, 1);
    assert.equal(w.app.ledger.audit().ok, true);
  } finally { await w.srv.cleanup(); }
});
