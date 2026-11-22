// The gap between seasons and the boundary itself (docs/teachers-seasons.md): students can look but not act while a season is closed,
// a session that outlives the season gets the new world's welcome grant once, and season-close cleanup is part of the close.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { boot, seeded, openStream } from './helpers.js';
import { UNIT } from '../modules/exchange/constants.js';
import { createClock } from '../lib/clock.js';

const S2 = { name: 'S2', season_start: '2026-09-01', season_end: '2027-01-01' };
const CLOSED = 'The season is closed. Your teacher will start the next one soon.';
const chequing = async (c) => (await c.get('/api/me')).json.accounts?.find((a) => a.kind === 'chequing')?.balance_cents ?? 0;

test('season gap: outfit resale, a first-login welcome grant and a card application are refused; GETs, logout and teacher routes still work', async () => {
  const srv = await boot();
  try {
    const { app } = srv;
    const { teacher, cls, students: [s1] } = await seeded(srv, 1);
    const [spare] = (await teacher.post(`/api/teach/classes/${cls.id}/students`, { count: 1 })).json.students;   // never logged in yet
    assert.equal((await s1.client.post('/api/outfitters/buy', { item: 'parka', source: 'chequing' })).status, 200);
    const parka = (await s1.client.get('/api/outfitters/state')).json.owned.find((o) => o.item_id === 'parka');
    assert.equal((await teacher.post('/api/teach/world/close')).status, 200);
    const welcomes = () => app.db.prepare("SELECT COUNT(*) AS n FROM txns WHERE kind = 'bank-basic.welcome'").get().n;
    const before = welcomes();

    // A2 bypass 1: selling the outfit in the gap would carry cash into S2
    const sell = await s1.client.post('/api/outfitters/sell', { id: parka.id });
    assert.deepEqual([sell.status, sell.json.error], [409, CLOSED]);
    // A2 bypass 2: a first login in the gap pays no grant (it would sit on top of S2's)
    const c = srv.client();
    assert.equal((await c.post('/api/login', { username: spare.username, secret: spare.pin })).status, 200);
    assert.equal(await chequing(c), 0);
    assert.equal(welcomes(), before);
    // A2 bypass 3: a card application in the gap
    const apply = await s1.client.post('/api/credit/apply');
    assert.deepEqual([apply.status, apply.json.error], [409, CLOSED]);
    assert.equal(app.db.prepare('SELECT COUNT(*) AS n FROM credit_inquiries').get().n, 0);
    assert.equal((await s1.client.post('/api/bank-basic/transfer', { to: spare.username, cents: 100 })).status, 409);

    // looking still works
    const me = (await s1.client.get('/api/me')).json;
    assert.equal(me.world.status, 'closed');
    assert.equal((await s1.client.get('/api/outfitters/state')).status, 200);
    assert.equal((await s1.client.get('/api/leaderboards/board')).status, 200);
    // teachers are not affected, and logout is not refused
    assert.equal((await teacher.post('/api/bank-basic/settings', { class_id: cls.id, enabled: true, per_transfer_cents: 5000, daily_cents: 10000 })).status, 200);
    assert.equal((await c.post('/api/logout')).status, 200);

    // S2: each student starts on exactly one grant
    assert.equal((await teacher.post('/api/teach/world/create', S2)).status, 200);
    assert.equal(await chequing(s1.client), 50000);
    assert.equal((await c.post('/api/login', { username: spare.username, secret: spare.pin })).status, 200);
    assert.equal(await chequing(c), 50000);
    assert.equal(welcomes(), before + 2);
    const t = await s1.client.post('/api/bank-basic/transfer', { to: spare.username, cents: 100 });
    assert.equal(t.status, 200, JSON.stringify(t.json));                                     // acting works again
    assert.equal(app.ledger.audit().ok, true);
  } finally { await srv.cleanup(); }
});

test('a session kept across close + create gets the new welcome grant once on /api/me, and the stream says the world changed', async () => {
  const srv = await boot();
  try {
    const { teacher, students: [s] } = await seeded(srv, 1);
    const stream = await openStream(srv, s.client);
    assert.equal((await teacher.post('/api/teach/world/close')).status, 200);
    const w1 = srv.app.db.prepare('SELECT MAX(id) AS id FROM worlds').get().id;
    assert.deepEqual((await stream.next('world')).data, { worldId: w1 });
    assert.equal(await chequing(s.client), 0);
    assert.equal((await teacher.post('/api/teach/world/create', S2)).status, 200);
    assert.deepEqual((await stream.next('world')).data, { worldId: w1 + 1 });
    assert.equal(await chequing(s.client), 50000);
    assert.equal(await chequing(s.client), 50000);                                          // a second /api/me pays nothing
    assert.equal(srv.app.db.prepare("SELECT COUNT(*) AS n FROM txns WHERE kind = 'bank-basic.welcome' AND json_extract(meta, '$.worldId') = ?").get(w1 + 1).n, 1);
    assert.equal(srv.app.db.prepare('SELECT seen_world_id FROM players WHERE id = ?').get(s.id).seen_world_id, w1 + 1);
    stream.close();
  } finally { await srv.cleanup(); }
});

test('a normal close resets jobs and writes the leaderboards finale in the same transaction', async () => {
  const srv = await boot();
  try {
    const { app } = srv;
    const { teacher, students: [s] } = await seeded(srv, 2);
    app.db.prepare('INSERT INTO jobs_holdings (player_id, job_id, since_month) VALUES (?, 1, 1)').run(s.id);
    assert.equal((await teacher.post('/api/teach/world/advance', { months: 2 })).status, 200);   // leaderboards snapshots
    app.db.prepare('UPDATE jobs_holdings SET step = 2, wage_cents = 99999 WHERE player_id = ?').run(s.id);
    const w = app.world.current().id;
    assert.equal((await teacher.post('/api/teach/world/close')).status, 200);
    assert.deepEqual({ ...app.db.prepare('SELECT step, wage_cents, since_month FROM jobs_holdings WHERE player_id = ?').get(s.id) }, { step: 0, wage_cents: null, since_month: 1 });
    assert.ok(app.db.prepare('SELECT COUNT(*) AS n FROM leaderboards_awards WHERE world_id = ?').get(w).n > 0);
    assert.equal(app.db.prepare('SELECT COUNT(*) AS n FROM leaderboards_reviews WHERE world_id = ?').get(w).n, 2);
    assert.ok((await s.client.get('/api/leaderboards/board')).json.last_season.tier);         // what the closed screen shows
  } finally { await srv.cleanup(); }
});

// A server on a clock the test sets by hand, so nothing below depends on real time.
async function onClock() {
  let t = Date.parse('2026-10-01T18:00:00Z');
  const srv = await boot({ clock: createClock({ now: () => t }) });
  return { srv, ...(await seeded(srv, 2)), set: (ms) => { t = ms; }, now: () => t };
}
const lastTransfer = async (teacher) => (await teacher.get('/api/bank-basic/transfers')).json.transfers[0].id;
const reverse = (teacher, id) => teacher.post(`/api/bank-basic/transfers/${id}/reverse`);
const PAST_TRANSFER = [409, 'That transfer is from a past season.'];

test('past-season transfers: a teacher cannot reverse an S1 transfer in the gap or in S2 (also one from before transfers recorded worldId); an S2 one reverses', async () => {
  const x = await onClock();
  try {
    const { srv: { app }, teacher, students: [s1, s2] } = x;
    assert.equal((await s1.client.post('/api/bank-basic/transfer', { to: s2.username, cents: 5000 })).status, 200);
    const transfer = await lastTransfer(teacher);
    assert.equal(JSON.parse(app.db.prepare('SELECT meta FROM txns WHERE id = ?').get(transfer).meta).worldId, app.world.current().id);
    // a transfer from before meta.worldId existed: the timestamp rule decides
    const legacy = app.ledger.post({ kind: 'bank-basic.transfer', actor: `player:${s1.id}`, meta: { from: s1.id, to: s2.id, fromName: s1.username, toName: s2.username },
      legs: [{ account: s1.chequing.id, cents: -100 }, { account: s2.chequing.id, cents: 100 }] });
    app.db.prepare('INSERT INTO bank_transfers (txn_id, class_id) VALUES (?, (SELECT class_id FROM players WHERE id = ?))').run(legacy, s1.id);
    x.set(x.now() + 3600e3);
    assert.equal((await teacher.post('/api/teach/world/close')).status, 200);
    for (const id of [transfer, legacy]) { const r = await reverse(teacher, id); assert.deepEqual([r.status, r.json.error], PAST_TRANSFER, 'gap'); }
    x.set(x.now() + 3600e3);
    assert.equal((await teacher.post('/api/teach/world/create', S2)).status, 200);
    assert.deepEqual([await chequing(s1.client), await chequing(s2.client)], [50000, 50000]);
    x.set(x.now() + 3600e3);
    for (const id of [transfer, legacy]) { const r = await reverse(teacher, id); assert.deepEqual([r.status, r.json.error], PAST_TRANSFER, 'S2'); }
    assert.deepEqual([await chequing(s1.client), await chequing(s2.client)], [50000, 50000]);
    assert.equal((await s1.client.post('/api/bank-basic/transfer', { to: s2.username, cents: 700 })).status, 200);
    assert.equal((await reverse(teacher, await lastTransfer(teacher))).status, 200);
    assert.equal(app.ledger.audit().ok, true);
  } finally { await x.srv.cleanup(); }
});

test('the season of a transfer is its worldId, not the clock: S2 created in the same millisecond, then the clock set back', async () => {
  const x = await onClock();
  try {
    const { teacher, students: [s1, s2] } = x;
    assert.equal((await s1.client.post('/api/bank-basic/transfer', { to: s2.username, cents: 5000 })).status, 200);
    const s1Transfer = await lastTransfer(teacher);
    assert.equal((await teacher.post('/api/teach/world/close')).status, 200);
    assert.equal((await teacher.post('/api/teach/world/create', S2)).status, 200);              // same millisecond as the S1 transfer
    assert.deepEqual([await chequing(s1.client), await chequing(s2.client)], [50000, 50000]);
    const r = await reverse(teacher, s1Transfer);
    assert.deepEqual([r.status, r.json.error], PAST_TRANSFER);
    assert.deepEqual([await chequing(s1.client), await chequing(s2.client)], [50000, 50000]);
    x.set(x.now() - 3600e3);                                                                      // the clock goes back an hour
    assert.equal((await s1.client.post('/api/bank-basic/transfer', { to: s2.username, cents: 700 })).status, 200);
    assert.equal((await reverse(teacher, await lastTransfer(teacher))).status, 200);              // still this season's transfer
    assert.deepEqual([await chequing(s1.client), await chequing(s2.client)], [50000, 50000]);
  } finally { await x.srv.cleanup(); }
});

test('past-season trades: a teacher cannot undo an S1 trade in the gap or in S2', async () => {
  const srv = await boot();
  try {
    const { teacher, students: [s1] } = await seeded(srv, 1);
    assert.equal((await s1.client.post('/api/exchange/contribute', { account: 'invest', cents: 20000 })).status, 200);
    const buy = await s1.client.post('/api/exchange/order', { ticker: 'BEAC', account: 'invest', side: 'buy', type: 'market', units_micro: UNIT });   // one share, about $25
    assert.equal(buy.status, 200, JSON.stringify(buy.json));
    const undo = async (label) => {
      const u = await teacher.post('/api/exchange/undo', { id: buy.json.trade_id });
      assert.deepEqual([u.status, u.json.error], [409, 'That trade is from a past season.'], label);
    };
    assert.equal((await teacher.post('/api/teach/world/close')).status, 200);
    await undo('gap');
    assert.equal(srv.app.db.prepare("SELECT COUNT(*) AS n FROM accounts WHERE owner_type = 'player' AND balance_cents <> 0").get().n, 0);
    assert.equal((await teacher.post('/api/teach/world/create', S2)).status, 200);
    assert.equal(await chequing(s1.client), 50000);
    await undo('S2');
    assert.equal(await chequing(s1.client), 50000);
    assert.equal(srv.app.ledger.audit().ok, true);
  } finally { await srv.cleanup(); }
});

test('teacher jobs actions that write a student\'s holding are refused between seasons and work again in the next one', async () => {
  const srv = await boot();
  try {
    const { app } = srv;
    const { teacher, students: [s] } = await seeded(srv, 1);
    assert.equal((await teacher.post('/api/jobs/assign', { player_id: s.id, job_id: 1 })).status, 200);
    app.db.prepare("INSERT INTO jobs_applications (player_id, job_id, from_step, month, reflection) VALUES (?, 1, 0, 1, 'Ready for more responsibility.')").run(s.id);
    const appId = app.db.prepare('SELECT id FROM jobs_applications').get().id;
    assert.equal((await teacher.post('/api/teach/world/close')).status, 200);   // voids the application, resets the holding
    app.db.prepare("UPDATE jobs_applications SET status = 'pending'").run();   // as if one slipped in: /decide must still refuse
    const before = { ...app.db.prepare('SELECT * FROM jobs_holdings WHERE player_id = ?').get(s.id) };
    for (const [path, body] of [['/promote', { player_id: s.id }], ['/raise', { player_id: s.id }], ['/assign', { player_id: s.id, job_id: 2 }], ['/decide', { id: appId, approve: true }]]) {
      const r = await teacher.post(`/api/jobs${path}`, body);
      assert.deepEqual([r.status, r.json.error], [409, 'The season is closed. Start the next one first.'], path);
    }
    assert.deepEqual({ ...app.db.prepare('SELECT * FROM jobs_holdings WHERE player_id = ?').get(s.id) }, before);
    assert.equal((await teacher.post('/api/bank-basic/settings', { class_id: s.class_id ?? 1, enabled: true, per_transfer_cents: 5000, daily_cents: 10000 })).status, 200);   // settings stay allowed
    assert.equal((await teacher.post('/api/teach/world/create', S2)).status, 200);
    assert.equal((await teacher.post('/api/jobs/raise', { player_id: s.id })).status, 200);
  } finally { await srv.cleanup(); }
});

test('world-level teacher writes meant for the next tick are refused between seasons (they would be lost) and work again in the next one; board hide/freeze stay allowed', async () => {
  const srv = await boot();
  try {
    const { app } = srv;
    const { teacher } = await seeded(srv, 1, { transfers: false });
    app.world.advance({ months: 2 });
    const writes = [
      ['/api/rates/policy', { policy_bp: 500 }], ['/api/rates/inflation', { inflation_bp: 800 }],
      ['/api/insurance/trigger', { event: 'phone-screen', scope: 'town' }],
      ['/api/exchange/event', { kind: 'crash' }], ['/api/exchange/freeze', { frozen: true }],
      ['/api/housing/market', { pct: 10 }], ['/api/outfitters/store', { open: false }], ['/api/savings/rate', { hisa_bp: 400 }],
    ];
    assert.equal((await teacher.post('/api/teach/world/close')).status, 200);
    const counts = () => ['rates_policy', 'insurance_triggers', 'exchange_events', 'exchange_settings', 'housing_market', 'outfitters_store', 'savings_policy']
      .map((t) => app.db.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get().n);
    const before = counts();
    for (const [path, body] of writes) {
      const r = await teacher.post(path, body);
      assert.deepEqual([r.status, r.json.error], [409, 'The season is closed. Start the next one first.'], path);
    }
    assert.deepEqual(counts(), before, 'nothing written');
    // the closed season's boards are still shown in the gap, so hiding amounts or (un)freezing them acts on what students see now
    assert.equal((await teacher.post('/api/leaderboards/hide', { hide_amounts: true })).status, 200);
    assert.equal((await teacher.post('/api/teach/world/create', S2)).status, 200);
    app.world.advance({ months: 1 });
    for (const [path, body] of writes) {
      const r = await teacher.post(path, body);
      if (path === '/api/savings/rate') assert.equal(r.status, 403, 'the HISA rate follows the Bank of DAA here (not a season refusal)');
      else assert.equal(r.status, 200, `${path} ${JSON.stringify(r.json)}`);
    }
    app.world.advance({ months: 1 });
    assert.equal((await teacher.get('/api/rates/current')).json.policy_bp, 500, 'the S2 change applied');
  } finally { await srv.cleanup(); }
});

test('season close for credit, savings, insurance and rates: after close + create the new world has no card or statement, no GIC or HISA balance, no policy and no pending rate', async () => {
  const srv = await boot();
  try {
    const { app } = srv;
    const { teacher, students: [s] } = await seeded(srv, 1, { transfers: false });
    assert.equal((await teacher.post('/api/jobs/assign', { player_id: s.id, job_id: 1 })).status, 200);
    app.world.advance({ months: 4 });                                                         // three pays: enough income for a card
    const card = await s.client.post('/api/credit/apply');
    assert.equal(card.json.approved, true, JSON.stringify(card.json));
    assert.equal((await s.client.post('/api/outfitters/buy', { item: 'tee', source: 'card' })).status, 200);
    app.world.advance({ months: 1 });                                                         // a statement for the tee
    assert.equal((await s.client.post('/api/savings/move', { direction: 'to_hisa', cents: 20000 })).status, 200);
    const term = (await s.client.get('/api/savings/status')).json.gic_rates[0].term_months;
    assert.equal((await s.client.post('/api/savings/gic', { term_months: term, cents: 10000 })).status, 200);
    assert.equal((await s.client.post('/api/insurance/buy', { policy: 'tenant' })).status, 200);
    app.world.advance({ months: 1 });                                                         // the policy is in force
    assert.equal((await teacher.post('/api/rates/policy', { policy_bp: 500 })).status, 200);   // queued for a tick that never comes
    // S1, before the close: all of it is there
    const credit = async () => (await s.client.get('/api/credit/state')).json;
    const savings = async () => (await s.client.get('/api/savings/status')).json;
    const held = async () => (await s.client.get('/api/insurance/state')).json.policies.filter((p) => p.held || p.starts_next_month).map((p) => p.key);
    const rates = async () => (await teacher.get('/api/rates/current')).json;
    assert.ok((await credit()).card.statement);
    assert.deepEqual([(await savings()).hisa_cents > 0, (await savings()).gics.length], [true, 1]);
    assert.deepEqual(await held(), ['tenant']);
    assert.equal((await rates()).pending_bp, 500);
    const s1Policy = (await rates()).policy_bp;

    assert.equal((await teacher.post('/api/teach/world/close')).status, 200);
    assert.equal((await teacher.post('/api/teach/world/create', S2)).status, 200);
    assert.equal(await chequing(s.client), 50000);                                          // entered S2 (/api/me): the welcome grant only
    const c = await credit();
    assert.deepEqual([c.card, c.score, c.inquiries], [null, null, []]);
    assert.equal(app.ledger.balance(app.ledger.accountId('player', s.id, 'card')), 0);
    const v = await savings();
    assert.deepEqual([v.hisa_cents, v.gics], [0, []]);
    assert.deepEqual(await held(), []);
    const r = await rates();
    assert.deepEqual([r.pending_bp, r.policy_bp], [null, s1Policy], 'the S1 queued change did not carry over');
    app.world.advance({ months: 1 });
    assert.equal((await rates()).policy_bp, s1Policy, 'nor applied at the first S2 tick');
    assert.equal((await credit()).card, null);
    assert.equal(app.ledger.audit().ok, true);
  } finally { await srv.cleanup(); }
});

test('season close forgets past jobs: a job quit in S1 and picked again in S2 is a new hire (since this month, entry wage), not a return', async () => {
  const srv = await boot();
  try {
    const { app } = srv;
    const { teacher, students: [s] } = await seeded(srv, 1, { transfers: false });
    assert.equal((await s.client.post('/api/jobs/pick', { job_id: 1 })).status, 200);
    app.world.advance({ months: 9 });
    assert.equal((await s.client.post('/api/jobs/quit')).status, 200);
    assert.equal(app.db.prepare('SELECT COUNT(*) AS n FROM jobs_past').get().n, 1);
    assert.equal((await teacher.post('/api/teach/world/close')).status, 200);
    assert.equal(app.db.prepare('SELECT COUNT(*) AS n FROM jobs_past').get().n, 0);
    assert.equal((await teacher.post('/api/teach/world/create', S2)).status, 200);
    assert.equal((await s.client.post('/api/jobs/pick', { job_id: 1 })).status, 200);
    const h = app.db.prepare('SELECT since_month, step, step_since, raise_since FROM jobs_holdings WHERE player_id = ?').get(s.id);
    assert.deepEqual({ ...h }, { since_month: app.world.current().month, step: 0, step_since: null, raise_since: null });
    const p = (await s.client.get('/api/jobs/catalogue')).json.promotion;
    assert.deepEqual([p.can_apply, p.next_raise_month], [false, app.world.current().month + 13]);
  } finally { await srv.cleanup(); }
});
