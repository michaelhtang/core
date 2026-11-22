// ventures (docs/phase4.md wave 4a) over HTTP: founding (FT20/30 only, invites, the split, teacher approval, one team a season), the treasury and
// capital, products and the price cap, production from the treasury (skipped when short), NPC demand (the curve, competition, noise, spoilage),
// the classmate storefront (ledger transfer + Outfitters item), statements that balance, dissolution pro rata, teacher controls and teacher B
// isolation, the balance hint (ownersOf), net worth and the leaderboards award, and the season wind-up. The pure maths is tested first.
import fs from 'node:fs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { boot, openStream } from './helpers.js';
import { moduleFiles, moduleSource } from './module-source.js';
import { curve, demandAt, share, allocate, incumbentPrice, noiseBp, splitUnits, proRata, unitCost } from '../modules/ventures/demand.js';
import { productType, FOUNDER_UNITS, SPOILAGE_BP, INCUMBENT_REF_BP, RENT_CENTS, TOWN_SIZE } from '../modules/ventures/constants.js';

const config = (ventures) => {
  const c = JSON.parse(fs.readFileSync(new URL('../config/vdaa.json', import.meta.url), 'utf8'));
  for (const course of Object.values(c.courses)) course.modules = ['bank-basic', 'outfitters', 'ventures', 'leaderboards'];
  c.options['bank-basic'].startCents = 500000;   // $5,000 each
  if (ventures) c.options.ventures = ventures;
  return c;
};
const PLAN = 'We sell drip coffee to students before class at about four dollars; break-even is 60 cups a month.';

async function world({ ft20 = 4, ft10 = 2, ventures } = {}) {
  const srv = await boot({ config: config(ventures) });
  const { app } = srv;
  const teacher = srv.client();
  await teacher.post('/api/setup', { username: 'teacher', passphrase: 'correct horse battery' });
  const join = async (course, count, name) => {
    const cls = (await teacher.post('/api/teach/classes', { name, course })).json;
    const made = (await teacher.post(`/api/teach/classes/${cls.id}/students`, { count })).json.students;
    const out = [];
    for (const s of made) {
      const c = srv.client();
      await c.post('/api/login', { username: s.username, secret: s.pin });
      const me = (await c.get('/api/me')).json;
      out.push({ ...s, client: c, id: me.user.id });
    }
    return { cls, students: out };
  };
  const a = await join('fintech2030', ft20, 'FT30 block');
  const b = ft10 ? await join('fintech10', ft10, 'FT10 block') : { students: [] };
  app.db.prepare("INSERT OR IGNORE INTO ventures_secrets (world_id, secret) VALUES (?, 'test-secret')").run(app.world.current().id);
  const post = (s, p, body = {}) => s.client.post(`/api/ventures${p}`, body);
  const state = async (s) => (await s.client.get('/api/ventures/state')).json;
  const tpost = (p, body = {}, who = teacher) => who.post(`/api/ventures${p}`, body);
  const chq = (s) => app.ledger.balance(app.ledger.accountId('player', s.id, 'chequing'));
  const treasury = (id) => { const x = app.ledger.accountId('business', id, 'treasury'); return x ? app.ledger.balance(x) : 0; };
  const audit = () => { const r = app.ledger.audit(); assert.equal(r.ok, true, JSON.stringify(r.problems)); };
  const advance = (n = 1) => app.world.advance({ months: n });
  const statements = (id) => app.db.prepare('SELECT data FROM ventures_statements WHERE company_id = ? ORDER BY month').all(id).map((r) => JSON.parse(r.data));
  // a whole founding: register with these co-founders, they accept, the teacher approves, each puts in `capital`
  async function found(lead, mates, { name = 'Bean There', sector = 'Food and drink', capital = 20000 } = {}) {
    const r = await post(lead, '/register', { name, sector, plan: PLAN, cofounders: mates.map((m) => m.username).join(', ') });
    assert.equal(r.status, 200, JSON.stringify(r.json));
    for (const m of mates) assert.equal((await post(m, '/respond', { id: r.json.id, accept: true })).status, 200);
    assert.equal((await tpost('/approve', { id: r.json.id, approve: true })).status, 200);
    for (const s of [lead, ...mates]) assert.equal((await post(s, '/capital', { id: r.json.id, cents: capital })).status, 200);
    return r.json.id;
  }
  return { srv, app, teacher, ft20: a.students, ft10: b.students, cls: a.cls, ft10cls: b.cls, post, state, tpost, chq, treasury, audit, advance, statements, found, cleanup: () => srv.cleanup() };
}

test('maths: the curve, competition, noise, the split and the pro-rata payout', () => {
  const coffee = productType('coffee');
  const c = curve(coffee, 100);
  assert.equal(c.a, 200); assert.equal(c.choke_cents, 800); assert.equal(c.best_cents, 400);   // Q = 200 - 25P: choke $8, revenue-maximising $4
  assert.equal(demandAt(c, 400), 100); assert.equal(demandAt(c, 900), 0);
  assert.deepEqual(curve(coffee, 200).choke_cents, 800, 'a bigger town buys more at every price; the choke price is the sector\'s');
  assert.equal(curve(coffee, 100, 20000).a, 400);
  assert.equal(curve(coffee, 100, 10000, 20000).choke_cents, 400, 'b x 2 halves the choke price');
  assert.equal(curve(coffee, 100, 10000, 10000, 11000).choke_cents, 880, 'the choke price follows the price index');
  assert.equal(unitCost(coffee), 190); assert.equal(unitCost(coffee, 11000), 209);
  // one seller gets its whole curve; two at one price split it; the cheaper one takes more; a better reputation takes more
  assert.deepEqual(share(c, [{ price_cents: 400, rep_bp: 10000 }]), [100]);
  assert.deepEqual(share(c, [{ price_cents: 400, rep_bp: 10000 }, { price_cents: 400, rep_bp: 10000 }]), [50, 50]);
  const [cheap, dear] = share(c, [{ price_cents: 300, rep_bp: 10000 }, { price_cents: 500, rep_bp: 10000 }]);
  assert.ok(cheap > dear && cheap + dear <= 125);
  const [good, bad] = share(c, [{ price_cents: 400, rep_bp: 12000 }, { price_cents: 400, rep_bp: 8000 }]);
  assert.ok(good > bad); assert.equal(Math.round(good + bad), 100);
  // noise: within +-10%, the same draw for the same secret, month and product, different otherwise
  const draws = Array.from({ length: 200 }, (_, i) => noiseBp('s', i, 7));
  assert.ok(draws.every((d) => d >= -1000 && d <= 1000) && new Set(draws).size > 100);
  assert.equal(noiseBp('s', 3, 7), noiseBp('s', 3, 7)); assert.notEqual(noiseBp('s', 3, 7), noiseBp('t', 3, 7));
  assert.deepEqual(share(c, [{ price_cents: 400, rep_bp: 10000, noise_bp: 1000 }]).map(Math.round), [110], 'noise scales what a seller would sell');
  // the town shop: under its price you win most of the town, over it you lose it
  const shop = { price_cents: incumbentPrice(c, INCUMBENT_REF_BP), rep_bp: 10000, cap: Infinity };
  assert.equal(shop.price_cents, 320);
  const under = share(c, [{ price_cents: 250, rep_bp: 10000 }, shop])[0], over = share(c, [{ price_cents: 450, rep_bp: 10000 }, shop])[0];
  assert.ok(under > demandAt(c, 250) / 2 && over < demandAt(c, 450) / 2, `${under} ${over}`);
  // allocate: a seller is capped at its stock and the rest flows to the others (here, to the shop and the other seller)
  const free = allocate(c, [{ price_cents: 1, rep_bp: 10000, cap: 1 }, { price_cents: 300, rep_bp: 10000, cap: 1000 }, shop]);
  const alone = allocate(c, [{ price_cents: 300, rep_bp: 10000, cap: 1000 }, shop]);
  assert.equal(free[0], 1, 'a 1-cent rival with one unit sells one unit');
  assert.ok(free[1] >= alone[1] - 1, `the honest seller loses at most what the rival could supply: ${free[1]} vs ${alone[1]}`);
  assert.ok(Math.abs(free.reduce((t, x) => t + x, 0) - share(c, [{ price_cents: 1, rep_bp: 10000 }, { price_cents: 300, rep_bp: 10000 }, shop]).reduce((t, x) => t + x, 0)) < 1e-6, 'nothing lost or made up');
  // equal split of 3: whole micro-units, adding up exactly; a 50/30/20 split
  assert.deepEqual(splitUnits(FOUNDER_UNITS, 3), [333333334, 333333333, 333333333]);
  assert.deepEqual(splitUnits(FOUNDER_UNITS, 3, [5000, 3000, 2000]), [500000000, 300000000, 200000000]);
  assert.deepEqual(proRata(1000, [{ units: 1 }, { units: 1 }, { units: 1 }]), [334, 333, 333]);
  assert.deepEqual(proRata(99_999_999, [{ units: 333333334 }, { units: 666666666 }]).reduce((t, x) => t + x, 0), 99_999_999, 'no precision lost past 2^53');
  assert.deepEqual(proRata(0, [{ units: 5 }]), [0]);
});

test('founding: FT10 cannot found (but sees Venture Row); FT20/30 registers with checks, co-founders accept, the teacher approves, each capitalises $100+', async () => {
  const x = await world();
  try {
    const [lead, m1, m2, other] = x.ft20, [kid] = x.ft10;
    const ft10 = await x.post(kid, '/register', { name: 'Kid Co', sector: 'Food and drink', plan: PLAN, cofounders: x.ft10[1].username });
    assert.equal(ft10.status, 403); assert.match(ft10.json.error, /FinTech 20\/30/);
    assert.equal((await x.state(kid)).can_found, false);
    assert.ok((await kid.client.get('/api/me')).json.panels.some((p) => p.building.key === 'venture-row'));
    assert.equal((await x.state(lead)).can_found, true);
    const reg = (body) => x.post(lead, '/register', { name: 'Bean There', sector: 'Food and drink', plan: PLAN, cofounders: m1.username, ...body });
    for (const [body, re] of [[{ name: 'ab' }, /3 to 40/], [{ name: 'Shit Coffee' }, /not allowed/], [{ name: 'Big Ass Mugs' }, /not allowed/], [{ sector: 'Crypto' }, /Pick a sector/],
      [{ plan: 'coffee' }, /one-paragraph plan/], [{ cofounders: '' }, /Invite 1 to 3/], [{ cofounders: 'a b c d' }, /Invite 1 to 3/], [{ cofounders: kid.username }, /not a student in your class/],
      [{ cofounders: lead.username }, /already on your own team/]]) {
      const r = await reg(body);
      assert.equal(r.status, 400, JSON.stringify(body)); assert.match(r.json.error, re);
    }
    assert.equal((await reg({ name: 'Grapefruit Café' })).status, 400, 'é is not in the allowed characters');
    const r = await reg({ cofounders: `${m1.username} ${m2.username}` });
    assert.equal(r.status, 200, JSON.stringify(r.json));
    const id = r.json.id;
    assert.equal((await reg({ name: 'Second Try' })).status, 409, 'on one founding team at a time');
    assert.match((await x.post(other, '/register', { name: 'bean there', sector: 'Restaurants', plan: PLAN, cofounders: m1.username })).json.error, /already uses that name/);
    // the invitee sees it, accepts; the split is equal by default; the registrant proposes 50/30/20 and the others confirm it again
    const inv = (await x.state(m1)).invites;
    assert.deepEqual(inv.map((i) => [i.id, i.founder]), [[id, lead.username]]);
    assert.deepEqual(inv[0].members.map((m) => m.share_bp), [3333, 3333, 3333]);
    assert.equal((await x.post(m1, '/respond', { id, accept: true })).status, 200);
    assert.equal((await x.post(m1, '/split', { id, split: '50,30,20' })).status, 403, 'only the registrant proposes');
    assert.match((await x.post(lead, '/split', { id, split: '50,40' })).json.error, /3 whole percents/);
    assert.match((await x.post(lead, '/split', { id, split: '50,30,30' })).json.error, /add up to 100/);
    assert.equal((await x.post(lead, '/split', { id, split: '50,30,20' })).status, 200);
    assert.equal((await x.post(m2, '/respond', { id, accept: true })).status, 200);
    let mine = (await x.state(lead)).mine;
    assert.equal(mine.status, 'forming', 'm1 has not confirmed the new split');
    assert.deepEqual(mine.members.map((m) => [m.share_bp, m.confirmed]), [[5000, true], [3000, false], [2000, true]]);
    assert.equal((await x.tpost('/approve', { id, approve: true })).status, 409, 'not until the team has formed');
    assert.equal((await x.post(m1, '/confirm', { id })).status, 200);
    assert.equal((await x.state(lead)).mine.status, 'pending');
    // a student invited elsewhere cannot join a second team
    assert.equal((await x.post(other, '/register', { name: 'Other Co', sector: 'Restaurants', plan: PLAN, cofounders: m2.username })).status, 409);
    // the teacher approves: the cap table is the agreed split; capital
    assert.equal((await x.tpost('/approve', { id, approve: true, note: 'Nice plan' })).status, 200);
    mine = (await x.state(lead)).mine;
    assert.equal(mine.status, 'approved');
    assert.deepEqual(mine.cap_table.map((c) => [c.username, c.shares]), [[lead.username, 500], [m1.username, 300], [m2.username, 200]]);
    assert.match((await x.post(lead, '/capital', { id, cents: 9999 })).json.error, /at least \$100/);
    assert.match((await x.post(lead, '/capital', { id, cents: 99_000_000 })).json.error, /Not enough in chequing/);
    assert.equal((await x.post(kid, '/capital', { id, cents: 10000 })).status, 404, 'not a founder');
    const before = x.chq(lead);
    assert.equal((await x.post(lead, '/capital', { id, cents: 25000 })).json.status, 'approved');
    assert.equal((await x.post(lead, '/capital', { id, cents: 100 })).status, 200, 'a top-up of any size once you are in for $100');
    assert.equal(x.chq(lead), before - 25100);
    await x.post(m1, '/capital', { id, cents: 10000 });
    assert.equal((await x.post(m2, '/capital', { id, cents: 10000 })).json.status, 'active');
    assert.equal(x.treasury(id), 45100);
    assert.equal(x.app.db.prepare("SELECT owner_type FROM accounts WHERE owner_type = 'business' AND owner_id = ? AND kind = 'treasury'").get(id).owner_type, 'business');
    assert.deepEqual((await x.state(lead)).mine.members.map((m) => m.capital_cents), [25100, 10000, 10000]);
    x.audit();
  } finally { await x.cleanup(); }
});

test('decline and withdraw: a declined invite re-splits equally; every co-founder declining cancels; a teacher decline frees the team', async () => {
  const x = await world();
  try {
    const [lead, m1, m2, m3] = x.ft20;
    const id = (await x.post(lead, '/register', { name: 'Fizz Works', sector: 'Food and drink', plan: PLAN, cofounders: `${m1.username},${m2.username}` })).json.id;
    await x.post(lead, '/split', { id, split: '60,20,20' });
    await x.post(m1, '/respond', { id, accept: false });
    assert.deepEqual((await x.state(lead)).mine.members.filter((m) => m.status !== 'declined').map((m) => m.share_bp), [5000, 5000]);
    await x.post(m2, '/respond', { id, accept: false });
    assert.equal(x.app.db.prepare('SELECT status FROM ventures_companies WHERE id = ?').get(id).status, 'cancelled');
    assert.equal((await x.state(lead)).can_found, true, 'a cancelled registration is not a founding team');
    const id2 = (await x.post(lead, '/register', { name: 'Fizz Works', sector: 'Food and drink', plan: PLAN, cofounders: m3.username })).json.id;
    await x.post(m3, '/respond', { id: id2, accept: true });
    assert.equal((await x.tpost('/approve', { id: id2, approve: false, note: 'Say more about your customers' })).status, 200);
    assert.equal((await x.state(lead)).last_declined.note, 'Say more about your customers');
    assert.equal((await x.state(m3)).can_found, true);
    const id3 = (await x.post(lead, '/register', { name: 'Fizz Works', sector: 'Food and drink', plan: PLAN, cofounders: m1.username })).json.id;
    assert.equal((await x.post(m1, '/cancel', { id: id3 })).status, 403, 'only the registrant withdraws');
    assert.equal((await x.post(lead, '/cancel', { id: id3 })).status, 200);
  } finally { await x.cleanup(); }
});

test('products, production and town demand: the cap, at most 3, production paid from the treasury at the month start (skipped when short), sales minted, spoilage, inventory carries over, statements balance', async () => {
  const x = await world({ ft20: 4, ft10: 0 });
  try {
    const [lead, m1] = x.ft20;
    const id = await x.found(lead, [m1], { name: 'Corner Kiosk', sector: 'Convenience retail' });
    const prod = (product, price_cents, quantity, who = lead) => x.post(who, '/product', { id, product, price_cents, quantity });
    assert.match((await prod('snacks', 511, 10)).json.error, /no price gouging/);         // 3 x $1.70 = $5.10
    assert.match((await prod('coffee', 300, 10)).json.error, /Convenience retail products/);
    assert.equal((await prod('snacks', 510, 0)).status, 200);
    assert.equal((await prod('charger', 1500, 2)).status, 200);
    assert.equal((await prod('supplies', 1000, 1)).status, 200);
    assert.equal((await x.post(lead, '/drop', { id, product: 'supplies' })).status, 200);
    assert.equal((await prod('supplies', 1000, 1)).status, 200, 'dropped and back: still 3');
    // a fourth would be refused: the sector only has 3 types, so check the rule with a fake 4th row
    x.app.db.prepare("INSERT INTO ventures_products (company_id, type_key, price_cents, quantity, created_month) VALUES (?, 'x4', 1, 0, 1)").run(id);
    await x.post(lead, '/drop', { id, product: 'supplies' });
    assert.match((await prod('supplies', 1000, 1)).json.error, /at most 3/);
    x.app.db.prepare("DELETE FROM ventures_products WHERE type_key = 'x4'").run();
    assert.equal((await prod('snacks', 300, 40, m1)).status, 200, 'any founder can change products');
    await prod('supplies', 1000, 1);
    const t0 = x.treasury(id);                                                            // 40 000
    // month 2: production for month 2 is paid now: 40 x $1.70 + 2 x $6.50 + 1 x $5.00
    await x.advance();
    const RENT = RENT_CENTS;
    assert.equal(x.treasury(id), t0 - RENT - (40 * 170 + 2 * 650 + 500), 'rent, then the production runs');
    let p = (await x.state(lead)).mine.products;
    assert.deepEqual(p.map((q) => [q.key, q.inventory_units]), [['snacks', 40], ['charger', 2], ['supplies', 1]]);
    // month 3: the town buys month 2's demand. The town is the simulated one of 300 residents (not the 4 students): snacks a = 160 x 3 = 480,
    // choke $10, the town shop at $4; at $3 with +-10% noise the town wants far more than the 40 made, so all 40 sell
    const c = curve(productType('snacks'), TOWN_SIZE), shop = { price_cents: incumbentPrice(c, INCUMBENT_REF_BP), rep_bp: 10000 };
    const wanted = Math.floor(share(c, [{ price_cents: 300, rep_bp: 10000, noise_bp: noiseBp('test-secret', 2, p[0].id) }, shop])[0]);
    const want = Math.min(40, wanted);
    assert.ok(wanted > 40, String(wanted));
    const before = x.treasury(id);
    await x.advance();
    const st = x.statements(id);
    const m2 = st.find((s) => s.month === 2);
    const snack = m2.products.find((q) => q.key === 'snacks');
    assert.equal(snack.demand_units, wanted); assert.equal(snack.npc_units, want);
    assert.equal(snack.revenue_cents, want * 300); assert.equal(snack.cogs_cents, want * 170);
    const left = 40 - want, spoiled = Math.floor((left * SPOILAGE_BP['Convenience retail']) / 10000);
    assert.equal(snack.spoiled_units, spoiled);
    p = (await x.state(lead)).mine.products;
    assert.equal(p[0].inventory_units, left - spoiled + 40, 'unsold units carry over, plus month 3\'s run');
    assert.equal(x.treasury(id), before + m2.income.revenue_cents - RENT - (40 * 170 + 2 * 650 + 500));
    // every statement balances and reconciles, month after month
    for (const s of x.statements(id)) {
      assert.equal(s.balance.balanced, true, JSON.stringify(s.balance));
      assert.equal(s.balance.cash_cents + s.balance.inventory_cents, s.balance.share_capital_cents + s.balance.retained_cents - s.balance.distributions_cents);
      assert.equal(s.cashflow.reconciled, true, JSON.stringify(s.cashflow));
      assert.equal(s.income.net_cents, s.income.revenue_cents - s.income.cogs_cents - s.income.spoilage_cents - s.income.rent_cents);
      if (s.month >= 2) assert.equal(s.income.rent_cents, RENT, 'rent every month the company is open');
    }
    // a run the treasury cannot pay is skipped, with a note; the rest of the books still balance
    await prod('charger', 1500, 10000);
    const t = x.treasury(id);
    await x.advance();
    p = (await x.state(lead)).mine.products;
    assert.match(p.find((q) => q.key === 'charger').note, /Production skipped/);
    const ch = p.find((q) => q.key === 'charger'), m = x.app.world.current().month;
    assert.equal(x.app.db.prepare('SELECT COALESCE(SUM(produced_units), 0) AS n FROM ventures_flows WHERE product_id = ? AND month = ?').get(ch.id, m).n, 0, 'the charger run was not paid');
    assert.ok(t > 0 && x.treasury(id) >= 0);
    for (const s of x.statements(id)) assert.equal(s.balance.balanced && s.cashflow.reconciled, true);
    // the journal lists every posting with its kind and the entry it stands for
    const j = (await x.state(lead)).mine.journal;
    assert.ok(j.some((e) => e.kind === 'ventures.capital' && e.debit === 'Cash' && e.credit === 'Share capital'));
    assert.ok(j.some((e) => e.kind === 'ventures.production' && e.debit === 'Inventory'));
    assert.ok(j.some((e) => e.kind === 'ventures.npc_sale' && e.cents > 0));
    x.audit();
  } finally { await x.cleanup(); }
});

test('competition: two companies selling the same product split the town; the cheaper one sells more; a stockout costs reputation', async () => {
  const x = await world({ ft20: 4, ft10: 0 });
  try {
    const [a1, a2, b1, b2] = x.ft20;
    const a = await x.found(a1, [a2], { name: 'Cheap Beans' }), b = await x.found(b1, [b2], { name: 'Dear Beans' });
    await x.tpost('/sector', { sector: 'Food and drink', a_bp: 2500, b_bp: 2500 });   // a quarter of the town for coffee (same $8 choke price), so 100 cups cover it
    await x.post(a1, '/product', { id: a, product: 'coffee', price_cents: 200, quantity: 100 });
    await x.post(b1, '/product', { id: b, product: 'coffee', price_cents: 550, quantity: 1 });
    await x.advance(2);
    const sa = x.statements(a).find((s) => s.month === 2).products[0], sb = x.statements(b).find((s) => s.month === 2).products[0];
    assert.ok(sa.demand_units > sb.demand_units, `${sa.demand_units} vs ${sb.demand_units}`);
    assert.equal(sb.npc_units, 1, 'Dear Beans made only one');
    const rep = (id) => x.app.db.prepare('SELECT rep_bp FROM ventures_companies WHERE id = ?').get(id).rep_bp;
    assert.ok(rep(b) < 10000, 'unmet demand costs reputation'); assert.ok(rep(a) > 10000, 'meeting demand earns some');
  } finally { await x.cleanup(); }
});

test('storefront: a classmate (FT10 too) buys with chequing or card into the treasury, gets the Outfitters item once, a receipt every time; the price cap and stock hold; founders cannot buy their own', async () => {
  const x = await world({ ft20: 2, ft10: 2 });
  try {
    const [lead, m1] = x.ft20, [kid, kid2] = x.ft10;
    const id = await x.found(lead, [m1], { name: 'Tee Time', sector: 'Clothing retail' });
    await x.post(lead, '/product', { id, product: 'tee', price_cents: 2500, quantity: 2 });
    let board = (await x.state(kid)).board;
    assert.deepEqual(board.map((b) => [b.name, b.products[0].in_stock]), [['Tee Time', false]], 'in stock or sold out, never the count');
    const pid = board[0].products[0].id;
    assert.match((await x.post(kid, '/buy', { id: pid, source: 'chequing' })).json.error, /Sold out/);
    await x.advance();                                                                    // month 2: 2 tees made
    assert.match((await x.post(kid2, '/buy', { id: pid, source: 'card' })).json.error, /credit card/);
    const t = x.treasury(id), c = x.chq(kid);
    const r = await x.post(kid, '/buy', { id: pid, source: 'chequing' });
    assert.equal(r.status, 200, JSON.stringify(r.json));
    assert.equal(r.json.item, 'Student-label tee');
    assert.equal(x.chq(kid), c - 2500); assert.equal(x.treasury(id), t + 2500);
    const owned = (await kid.client.get('/api/outfitters/state')).json.owned;
    assert.ok(owned.some((o) => o.item_id === 'vr-tee' && o.venture && o.value_cents === 0));
    assert.equal((await kid.client.post('/api/outfitters/sell', { id: owned.find((o) => o.item_id === 'vr-tee').id })).status, 400, 'no resale to the mint');
    const again = await x.post(kid, '/buy', { id: pid, source: 'chequing' });
    assert.equal(again.json.item, null, 'owned once a season: a receipt only');
    assert.equal((await x.state(kid)).receipts.length, 2);
    assert.match((await x.post(kid2, '/buy', { id: pid, source: 'chequing' })).json.error, /Sold out/);
    assert.equal((await x.post(m1, '/buy', { id: pid, source: 'chequing' })).status, 409, 'not from your own company');
    // the month's statement has the classmate sales, at cost
    await x.advance();
    const s = x.statements(id).find((q) => q.month === 2);
    assert.equal(s.income.store_cents, 5000); assert.equal(s.products[0].store_units, 2); assert.equal(s.products[0].cogs_cents, 2 * 1000);
    assert.equal(s.balance.balanced, true);
    x.audit();
  } finally { await x.cleanup(); }
});

test('dissolve: unanimous founders (or the teacher) pay the treasury out pro rata; inventory is written off; the final statement balances', async () => {
  const x = await world({ ft20: 4, ft10: 0 });
  try {
    const [lead, m1, m2, m3] = x.ft20;
    const r = await x.post(lead, '/register', { name: 'Split Shop', sector: 'Clothing retail', plan: PLAN, cofounders: m1.username });
    await x.post(lead, '/split', { id: r.json.id, split: '70,30' });
    await x.post(m1, '/respond', { id: r.json.id, accept: true });
    await x.tpost('/approve', { id: r.json.id, approve: true });
    const id = r.json.id;
    await x.post(lead, '/capital', { id, cents: 10001 }); await x.post(m1, '/capital', { id, cents: 10000 });
    await x.post(lead, '/product', { id, product: 'tote', price_cents: 1200, quantity: 3 });
    await x.advance();
    const cash = x.treasury(id), [c0, c1] = [x.chq(lead), x.chq(m1)];
    assert.equal((await x.post(lead, '/vote-dissolve', { id, approve: true })).json.dissolved, false);
    assert.equal((await x.post(m1, '/vote-dissolve', { id, approve: true })).json.dissolved, true);
    assert.equal(x.treasury(id), 0);
    assert.equal(x.chq(lead) - c0 + x.chq(m1) - c1, cash);
    assert.deepEqual([x.chq(lead) - c0, x.chq(m1) - c1], proRata(cash, [{ units: 700 }, { units: 300 }]), '70/30 of the cash, to the cent');
    const last = x.statements(id).at(-1);
    assert.equal(last.final, true); assert.equal(last.balance.cash_cents, 0); assert.equal(last.balance.inventory_cents, 0);
    assert.equal(last.balance.balanced, true); assert.equal(last.cashflow.reconciled, true);
    assert.equal(last.income.spoilage_cents, 3 * 600, 'the totes were written off');
    assert.equal((await x.state(lead)).can_found, false, 'still a founding team this season');
    // the teacher dissolves another
    const id2 = await x.found(m2, [m3], { name: 'Teacher Ends It', sector: 'Restaurants' });
    assert.equal((await x.tpost('/dissolve', { id: id2 })).status, 200);
    assert.equal(x.treasury(id2), 0);
    assert.equal((await x.tpost('/dissolve', { id: id2 })).status, 409);
    x.audit();
  } finally { await x.cleanup(); }
});

test('teacher: approvals, rename, freeze (no production or sales), sector demand settings (world teacher only); teacher B sees and touches only their own class', async () => {
  const x = await world({ ft20: 2, ft10: 0 });
  try {
    const [lead, m1] = x.ft20;
    const id = await x.found(lead, [m1], { name: 'Freeze Frame', sector: 'Food and drink' });
    await x.post(lead, '/product', { id, product: 'coffee', price_cents: 400, quantity: 5 });
    const b = x.srv.client();
    const invite = (await x.teacher.post('/api/teach/invites')).json;
    assert.equal((await b.post('/api/teach/join', { token: new URL(invite.url).searchParams.get('invite'), username: 'teacherB', passphrase: 'another long passphrase' })).status, 200);
    for (const [p, body] of [['/approve', { id, approve: false }], ['/rename', { id, name: 'Hijacked' }], ['/freeze', { id, frozen: true }], ['/dissolve', { id }]]) assert.equal((await x.tpost(p, body, b)).status, 404, `teacher B ${p}`);
    assert.equal((await b.get(`/api/ventures/company/${id}`)).json.plan, undefined, 'B gets the public summary only');
    assert.equal((await x.tpost('/sector', { sector: 'Food and drink', a_bp: 20000, b_bp: 10000 }, b)).status, 403);
    assert.equal((await lead.client.post('/api/ventures/approve', { id, approve: true })).status, 403, 'students are not teachers');
    // B's own class: B approves their own students' company and sees only it
    const bCls = (await b.post('/api/teach/classes', { name: 'B block', course: 'fintech2030' })).json;
    const made = (await b.post(`/api/teach/classes/${bCls.id}/students`, { count: 2 })).json.students;
    const bs = [];
    for (const s of made) { const c = x.srv.client(); await c.post('/api/login', { username: s.username, secret: s.pin }); bs.push({ ...s, client: c }); }
    const bid = (await bs[0].client.post('/api/ventures/register', { name: 'B Brews', sector: 'Restaurants', plan: PLAN, cofounders: bs[1].username })).json.id;
    await bs[1].client.post('/api/ventures/respond', { id: bid, accept: true });
    assert.equal((await x.tpost('/approve', { id: bid, approve: true }, b)).status, 200);
    const bv = (await b.get('/api/ventures/teach')).json;
    assert.deepEqual(bv.classes.map((c) => [c.name, c.companies.map((q) => q.name)]), [['B block', ['B Brews']]]);
    assert.equal(bv.can_settings, false);
    assert.ok(!JSON.stringify(bv).includes(lead.username) && !JSON.stringify(bv).includes('Freeze Frame'));
    // the world teacher: rename (checks apply), freeze, settings
    assert.match((await x.tpost('/rename', { id, name: 'B Brews' })).json.error, /already uses/);
    assert.equal((await x.tpost('/rename', { id, name: 'Thaw Co' })).status, 200);
    assert.equal((await x.state(lead)).mine.name, 'Thaw Co');
    assert.equal((await x.tpost('/freeze', { id, frozen: true })).status, 200);
    const t = x.treasury(id);
    await x.advance(2);
    assert.equal(x.treasury(id), t, 'frozen: no production, no sales');
    assert.equal((await x.post(m1, '/capital', { id, cents: 100 })).status, 409);
    assert.equal((await x.tpost('/freeze', { id, frozen: false })).status, 200);
    assert.match((await x.tpost('/sector', { sector: 'Food and drink', a_bp: 100, b_bp: 10000 })).json.error, /between/);
    assert.equal((await x.tpost('/sector', { sector: 'Food and drink', a_bp: 20000, b_bp: 5000 })).status, 200);
    const v = (await x.teacher.get('/api/ventures/teach')).json;
    assert.deepEqual(v.settings.find((s) => s.sector === 'Food and drink'), { sector: 'Food and drink', a_bp: 20000, b_bp: 5000, spoilage_bp: 4000 });
    const coffee = (await x.state(lead)).sector_views.find((s) => s.sector === 'Food and drink').products.find((p) => p.key === 'coffee');
    assert.equal(coffee.choke_cents, 3200, 'a x 2 and b x 1/2: choke $8 -> $32');
    const full = (await x.teacher.get(`/api/ventures/company/${id}`)).json;
    assert.ok(full.statements.length >= 2 && full.journal.length > 0);
    assert.equal((await x.srv.client().get(`/api/ventures/company/${id}`)).status, 401);
    x.audit();
  } finally { await x.cleanup(); }
});

test('balance hints: a post to the treasury reaches the founders\' streams (ownersOf), not other students\'', async () => {
  const x = await world({ ft20: 3, ft10: 0 });
  try {
    const [lead, m1, other] = x.ft20;
    const id = await x.found(lead, [m1], { name: 'Hint Co' });
    const [sa, so] = await Promise.all([openStream(x.srv, m1.client), openStream(x.srv, other.client)]);
    await x.post(lead, '/capital', { id, cents: 500 });
    assert.ok(await sa.next('balance'), 'a co-founder hears about the treasury');
    assert.equal(await so.next('balance', 300), null);
    sa.close(); so.close();
    assert.deepEqual(x.app.modules.ownersOf({ type: 'business', id }).sort(), [lead.id, m1.id].sort());
  } finally { await x.cleanup(); }
});

test('net worth and the season: stakes at book value reach leaderboards and the season results pro rata; the companies wind up; the next season starts clean', async () => {
  const x = await world({ ft20: 2, ft10: 1 });
  try {
    const [lead, m1] = x.ft20, [kid] = x.ft10;
    const r = await x.post(lead, '/register', { name: 'Stake Co', sector: 'Convenience retail', plan: PLAN, cofounders: m1.username });
    await x.post(lead, '/split', { id: r.json.id, split: '75,25' });
    await x.post(m1, '/respond', { id: r.json.id, accept: true });
    await x.tpost('/approve', { id: r.json.id, approve: true });
    const id = r.json.id;
    await x.post(lead, '/capital', { id, cents: 30000 }); await x.post(m1, '/capital', { id, cents: 10000 });
    await x.post(lead, '/product', { id, product: 'charger', price_cents: 1900, quantity: 4 });
    await x.advance();
    await x.post(kid, '/buy', { id: (await x.state(kid)).board[0].products[0].id, source: 'chequing' });
    await x.advance();
    const value = x.treasury(id) + x.app.db.prepare('SELECT SUM(inventory_cost_cents) AS n FROM ventures_products WHERE company_id = ?').get(id).n;
    const inp = x.app.db.prepare('SELECT ventures_value, ventures_company FROM leaderboards_inputs WHERE player_id = ? AND world_id = ?').get(lead.id, x.app.world.current().id);
    const split = proRata(value, [{ units: 750 }, { units: 250 }]);
    assert.equal(inp.ventures_company, value); assert.equal(inp.ventures_value, split[0]);
    const snap = x.app.db.prepare('SELECT net_worth FROM leaderboards_snapshots WHERE player_id = ? ORDER BY month DESC LIMIT 1').get(lead.id).net_worth;
    assert.equal(snap, x.chq(lead) + inp.ventures_value, 'the stake is in net worth');
    const leaders = (await x.teacher.get('/api/leaderboards/teach')).json.leaders;
    assert.ok(leaders.some((a) => a.award === 'founder' && a.name === lead.username && a.title === 'Founder of the Season'), JSON.stringify(leaders));
    // season close: stakes into season_results, the treasury reset, companies wound up
    const w = x.app.world.current().id, [cl, cm] = [x.chq(lead), x.chq(m1)];
    assert.equal((await x.teacher.post('/api/teach/world/close')).status, 200);
    const res = Object.fromEntries(x.app.db.prepare('SELECT player_id, net_worth_cents FROM season_results WHERE world_id = ?').all(w).map((q) => [q.player_id, q.net_worth_cents]));
    assert.equal(res[lead.id], cl + split[0]); assert.equal(res[m1.id], cm + split[1]);
    assert.equal(split[0] + split[1], value, 'the whole company reaches the season results, to the cent');
    assert.equal(x.treasury(id), 0);
    assert.deepEqual({ ...x.app.db.prepare('SELECT status, wound_up_cents FROM ventures_companies WHERE id = ?').get(id) }, { status: 'wound_up', wound_up_cents: value });
    assert.ok(x.app.db.prepare("SELECT 1 FROM leaderboards_awards WHERE world_id = ? AND award = 'founder'").get(w));
    x.audit();
    assert.equal((await x.teacher.post('/api/teach/world/create', { name: 'Season 2', season_start: '2027-02-01', season_end: '2027-06-30' })).status, 200);
    const st = await x.state(lead);
    assert.equal(st.mine, null); assert.equal(st.can_found, true); assert.deepEqual(st.board, []);
  } finally { await x.cleanup(); }
});

test('the module reads no other module\'s tables and never uses the wall clock or Math.random', () => {
  for (const f of moduleFiles('ventures')) {
    const src = moduleSource('ventures', f);
    assert.equal(src.match(/\b(?:FROM|JOIN|INTO|UPDATE)\s+(?!ventures_)(?:bills|jobs|housing|credit|savings|rates|insurance|bank_basic|leaderboards|outfitters|exchange)_\w+/gi), null, f);
    assert.doesNotMatch(src, /Date\.now\(|Math\.random\(/, f);
  }
});

// ---------- fix round 1 ----------

test('round 1, item 1: a rival with no stock takes no town demand; one with a unit at 1 cent takes at most that unit', async () => {
  const x = await world({ ft20: 4, ft10: 0 });
  try {
    const [a1, a2, g1, g2] = x.ft20;
    const honest = await x.found(a1, [a2], { name: 'Honest Beans' }), grief = await x.found(g1, [g2], { name: 'Penny Beans' });
    await x.tpost('/sector', { sector: 'Food and drink', a_bp: 40000, b_bp: 40000 });
    await x.post(a1, '/product', { id: honest, product: 'coffee', price_cents: 300, quantity: 60 });
    await x.post(g1, '/product', { id: grief, product: 'coffee', price_cents: 1, quantity: 0 });   // listed, never made
    const pid = (id) => x.app.db.prepare("SELECT id FROM ventures_products WHERE company_id = ? AND type_key = 'coffee'").get(id).id;
    const cv = curve(productType('coffee'), TOWN_SIZE, 40000, 40000), shop = { price_cents: incumbentPrice(cv, INCUMBENT_REF_BP), rep_bp: 10000, cap: Infinity };
    const rep = (id) => x.app.db.prepare('SELECT rep_bp FROM ventures_companies WHERE id = ?').get(id).rep_bp;
    await x.advance();                                                                     // month 2: the honest run is made
    const me = { price_cents: 300, rep_bp: rep(honest), noise_bp: noiseBp('test-secret', 2, pid(honest)), cap: 60 };
    await x.advance();                                                                     // month 3: month 2's sales
    const sold2 = x.statements(honest).find((q) => q.month === 2).products[0].npc_units;
    assert.equal(sold2, Math.min(60, Math.floor(allocate(cv, [me, shop])[0] + 1e-9)), 'exactly as if the empty rival were not there');
    assert.equal(rep(grief), 10000, 'a product that never had a run is not penalised either (item 5)');
    // the rival makes one unit at 1 cent: it sells it, and the honest company loses at most that one unit
    await x.post(g1, '/product', { id: grief, product: 'coffee', price_cents: 1, quantity: 1 });
    await x.advance();                                                                     // month 4: the 1-unit run
    const h = { price_cents: 300, rep_bp: rep(honest), noise_bp: noiseBp('test-secret', 4, pid(honest)), cap: x.app.db.prepare('SELECT inventory_units AS n FROM ventures_products WHERE id = ?').get(pid(honest)).n };
    const g = { price_cents: 1, rep_bp: rep(grief), noise_bp: noiseBp('test-secret', 4, pid(grief)), cap: 1 };
    await x.advance();
    const s4 = x.statements(honest).find((q) => q.month === 4).products[0], r4 = x.statements(grief).find((q) => q.month === 4).products[0];
    assert.equal(r4.npc_units, 1);
    assert.equal(s4.npc_units, Math.min(h.cap, Math.floor(allocate(cv, [h, g, shop])[0] + 1e-9)));
    assert.ok(s4.npc_units >= Math.min(h.cap, Math.floor(allocate(cv, [h, shop])[0])) - 1, 'at most one unit lost to the rival');
    x.audit();
  } finally { await x.cleanup(); }
});

test('round 1, item 2: storefront spending is capped per buyer per world month ($100 at one company, $250 in all); the allowance is shown; it resets next month', async () => {
  const x = await world({ ft20: 6, ft10: 1 });
  try {
    const [a, b, c, d, e, f] = x.ft20, [kid] = x.ft10;
    const ids = [await x.found(a, [b], { name: 'Tray One', sector: 'Restaurants' }), await x.found(c, [d], { name: 'Tray Two', sector: 'Restaurants' }), await x.found(e, [f], { name: 'Tray Three', sector: 'Restaurants' })];
    for (const [i, lead] of [a, c, e].entries()) await x.post(lead, '/product', { id: ids[i], product: 'catering', price_cents: i === 2 ? 9500 : 8000, quantity: 3 });
    await x.advance();
    const shelf = async () => (await x.state(kid)).board.sort((p, q) => p.name.localeCompare(q.name));
    const prod = async (name) => (await shelf()).find((q) => q.name === name).products[0].id;
    let st = await x.state(kid);
    assert.deepEqual([st.pay.cap_company_cents, st.pay.cap_month_cents, st.pay.left_month_cents], [10000, 25000, 25000]);
    assert.equal((await x.post(kid, '/buy', { id: await prod('Tray One') })).status, 200);
    const again = await x.post(kid, '/buy', { id: await prod('Tray One') });
    assert.equal(again.status, 409); assert.match(again.json.error, /at most \$100\.00 a world month at one company \(\$20\.00 left/);
    assert.equal((await shelf()).find((q) => q.name === 'Tray One').allowance_cents, 2000);
    assert.equal((await x.post(kid, '/buy', { id: await prod('Tray Two') })).status, 200);
    const third = await x.post(kid, '/buy', { id: await prod('Tray Three') });                  // 80 + 80 + 95 > 250
    assert.equal(third.status, 409); assert.match(third.json.error, /\$250\.00 a world month on Venture Row \(\$90\.00 left\)/);
    assert.equal((await x.state(kid)).pay.left_month_cents, 9000);
    // the bypass the cap closes: a friend moving money to the founders through trays is held to $100 a company a month
    const moved = x.app.db.prepare('SELECT COALESCE(SUM(cents), 0) AS n FROM ventures_purchases WHERE player_id = ? AND company_id = ?').get(kid.id, ids[0]).n;
    assert.equal(moved, 8000);
    await x.advance();
    assert.equal((await x.state(kid)).pay.left_month_cents, 25000, 'a new world month, a new allowance');
    assert.equal((await x.post(kid, '/buy', { id: await prod('Tray One') })).status, 200);
    x.audit();
  } finally { await x.cleanup(); }
});

test('round 1, item 3: before the company opens any founder may leave (capital back, shares re-split equally); after it opens they cannot', async () => {
  const x = await world({ ft20: 4, ft10: 0 });
  try {
    const [lead, b, c] = x.ft20;
    const id = (await x.post(lead, '/register', { name: 'Stuck Co', sector: 'Food and drink', plan: PLAN, cofounders: `${b.username} ${c.username}` })).json.id;
    await x.post(b, '/respond', { id, accept: true });
    await x.post(lead, '/split', { id, split: '98,1,1' });
    assert.equal((await x.post(b, '/leave', { id })).status, 200, 'B is not stuck with 1%');
    assert.deepEqual((await x.state(lead)).mine.members.filter((m) => m.status !== 'declined').map((m) => m.share_bp), [5000, 5000]);
    assert.equal((await x.state(b)).can_found, true);
    // approved, with capital in: a leaver gets exactly their capital back and the cap table is re-split equally
    await x.post(c, '/respond', { id, accept: true });
    assert.equal((await x.tpost('/approve', { id, approve: true })).status, 200);
    const before = x.chq(c);
    await x.post(c, '/capital', { id, cents: 12345 });
    assert.equal((await x.post(c, '/leave', { id })).status, 200);
    assert.equal(x.chq(c), before, 'every cent back');
    const co = x.app.db.prepare('SELECT status FROM ventures_companies WHERE id = ?').get(id).status;
    assert.equal(co, 'cancelled', 'one founder left: the company is cancelled');
    // a three-founder company that opened: leaving is refused
    const [l2, m2, n2] = [x.ft20[1], x.ft20[2], x.ft20[3]];
    const id2 = await x.found(l2, [m2, n2], { name: 'Open Co' });
    assert.equal((await x.post(n2, '/leave', { id: id2 })).status, 409);
    for (const st of x.statements(id)) assert.equal(st.balance.balanced && st.cashflow.reconciled, true);
    x.audit();
  } finally { await x.cleanup(); }
});

test('round 1, item 4: a company that never opened refunds each founder exactly what they paid (cancel, teacher dissolve, season close); founders who paid can remove one who has not after 2 months', async () => {
  const x = await world({ ft20: 4, ft10: 0 });
  try {
    const [a, b, c, d] = x.ft20;
    const reg = async (lead, mates, name) => { const id = (await x.post(lead, '/register', { name, sector: 'Food and drink', plan: PLAN, cofounders: mates.map((m) => m.username).join(' ') })).json.id; for (const m of mates) await x.post(m, '/respond', { id, accept: true }); await x.tpost('/approve', { id, approve: true }); return id; };
    // teacher dissolve: A paid $300, B paid nothing: A gets $300, B gets nothing of it
    const id = await reg(a, [b], 'Never Open');
    const [ca, cb] = [x.chq(a), x.chq(b)];
    await x.post(a, '/capital', { id, cents: 30000 });
    assert.equal((await x.tpost('/dissolve', { id })).status, 200);
    assert.deepEqual([x.chq(a) - ca, x.chq(b) - cb], [0, 0], 'A has their $300 back; B got none of it');
    assert.equal(x.app.db.prepare('SELECT status FROM ventures_companies WHERE id = ?').get(id).status, 'cancelled');
    assert.equal((await x.state(a)).can_found, true);
    // removal: a 3-founder team where A never pays in
    const id2 = await reg(c, [d, a], 'Pay Up Co');
    await x.post(c, '/capital', { id: id2, cents: 10000 }); await x.post(d, '/capital', { id: id2, cents: 10000 });
    assert.match((await x.post(c, '/remove', { id: id2, username: a.username })).json.error, /has until world month/);
    assert.equal((await x.post(a, '/remove', { id: id2, username: c.username })).status, 403, 'only a founder who paid in can remove');
    await x.advance(2);
    assert.equal((await x.post(c, '/remove', { id: id2, username: d.username })).status, 409, 'D has paid in');
    assert.equal((await x.post(c, '/remove', { id: id2, username: a.username.toUpperCase() })).status, 200);
    const mine = (await x.state(c)).mine;
    assert.equal(mine.status, 'active', 'everyone left has paid in: it opens');
    assert.deepEqual(mine.cap_table.map((q) => q.share_bp), [5000, 5000]);
    // season close of a company that never opened: each founder's result is their own capital, not a share of everyone's
    const [e1, e2] = [x.ft20[0], x.ft20[1]];
    const id3 = await reg(e1, [e2], 'Close Never');
    await x.post(e1, '/capital', { id: id3, cents: 40000 });
    const w = x.app.world.current().id, [c1, c2] = [x.chq(e1), x.chq(e2)];
    await x.teacher.post('/api/teach/world/close');
    const res = Object.fromEntries(x.app.db.prepare('SELECT player_id, net_worth_cents FROM season_results WHERE world_id = ?').all(w).map((q) => [q.player_id, q.net_worth_cents]));
    assert.deepEqual([res[e1.id], res[e2.id]], [c1 + 40000, c2]);
    x.audit();
  } finally { await x.cleanup(); }
});

test('round 1, items 6-8: co-founder names differing only in case are one invite; the company\'s class console hears a storefront sale; rent is charged and two unpaid months freeze the company', async () => {
  const x = await world({ ft20: 2, ft10: 1, ventures: { rentCents: 15000 } });
  try {
    const [lead, m1] = x.ft20, [kid] = x.ft10;
    const r = await x.post(lead, '/register', { name: 'Case Co', sector: 'Clothing retail', plan: PLAN, cofounders: `${m1.username}, ${m1.username.toUpperCase()} ${m1.username.toLowerCase()}` });
    assert.equal(r.status, 200, JSON.stringify(r.json));
    assert.equal((await x.state(m1)).invites[0].members.length, 2);
    await x.post(m1, '/respond', { id: r.json.id, accept: true });
    await x.tpost('/approve', { id: r.json.id, approve: true });
    const id = r.json.id;
    await x.post(lead, '/capital', { id, cents: 10000 }); await x.post(m1, '/capital', { id, cents: 10000 });
    await x.post(lead, '/product', { id, product: 'tote', price_cents: 1200, quantity: 1 });
    const heard = [];
    x.app.events.on('module.ventures.changed', (p) => heard.push(p.classId));
    await x.advance();                                                                     // month 2: rent $150 + one tote
    assert.equal(x.treasury(id), 20000 - 15000 - 600);
    assert.equal((await x.post(kid, '/buy', { id: (await x.state(kid)).board[0].products[0].id })).status, 200);
    assert.ok(heard.includes(x.cls.id) && heard.includes(x.ft10cls.id), JSON.stringify(heard));
    await x.advance();                                                                     // month 3: $56 in the treasury, rent unpaid once
    let st = x.statements(id).at(-1);
    assert.equal(st.income.rent_cents, 15000); assert.equal(st.balance.balanced, true);
    assert.equal(x.app.db.prepare('SELECT status, rent_missed FROM ventures_companies WHERE id = ?').get(id).rent_missed, 1);
    await x.advance();                                                                     // month 4: unpaid again: frozen
    const co = { ...x.app.db.prepare('SELECT status, rent_missed, note FROM ventures_companies WHERE id = ?').get(id) };
    assert.equal(co.status, 'frozen'); assert.match(co.note, /rent unpaid/);
    await x.advance();
    for (const q of x.statements(id)) assert.equal(q.balance.balanced && q.cashflow.reconciled, true);
    assert.equal((await x.tpost('/freeze', { id, frozen: false })).status, 200);
    assert.equal(x.app.db.prepare('SELECT rent_missed FROM ventures_companies WHERE id = ?').get(id).rent_missed, 0);
    x.audit();
  } finally { await x.cleanup(); }
});
