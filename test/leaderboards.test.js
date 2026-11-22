import fs from 'node:fs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { boot, seeded, addClass } from './helpers.js';
import { moduleSource } from './module-source.js';
import { thresholds, tierOf, healthParts, healthScore, ranked, roundNet, median } from '../modules/leaderboards/health.js';
import { DEFAULT_THRESHOLDS } from '../modules/leaderboards/constants.js';

// bank-basic + savings + leaderboards only, so no payday or bill moves money under the numbers; events are driven by hand (they are the contract).
const TIERS = { scout: 100000, hunter: 500000, packLeader: 1000000, alpha: 2000000 };   // $1,000 / $5,000 / $10,000 / $20,000
const config = () => {
  const c = JSON.parse(fs.readFileSync(new URL('../config/vdaa.json', import.meta.url), 'utf8'));
  for (const course of Object.values(c.courses)) course.modules = ['bank-basic', 'savings', 'leaderboards'];
  c.options.leaderboards = { tiers: TIERS };
  return c;
};
const advance = async (teacher, n = 1) => {
  const w = (await teacher.get('/api/teach/state')).json.world;
  const r = await teacher.post('/api/teach/world/advance', { months: n, from: w.month });
  assert.equal(r.status, 200, JSON.stringify(r.json));
};
const give = (app, s, cents) => app.ledger.post({ kind: 'test.grant', legs: [{ account: app.ledger.system('mint'), cents: -cents }, { account: s.chequing.id, cents }] });
const board = async (s) => (await s.client.get('/api/leaderboards/board')).json;
const keys = (v, out = new Set()) => { if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) { out.add(k); keys(x, out); } return out; };

test('pure maths: thresholds scale with the price index; each health part; ranking and medians', () => {
  const base = thresholds({}, 10000);
  assert.deepEqual(base, [DEFAULT_THRESHOLDS.scout, DEFAULT_THRESHOLDS.hunter, DEFAULT_THRESHOLDS.packLeader, DEFAULT_THRESHOLDS.alpha]);
  assert.deepEqual(thresholds({}, 11000), base.map((t) => Math.round(t * 1.1)));      // +10% prices, +10% to climb
  assert.deepEqual(thresholds({ tiers: { alpha: 100 } }, 20000)[3], 200);             // config override, then scaled
  assert.deepEqual([0, base[0] - 1, base[0], base[1], base[2], base[3], 9e9].map((n) => tierOf(n, base)), [0, 0, 1, 2, 3, 4, 4]);   // each cutoff, whatever the defaults
  assert.equal(tierOf(-5, base), 0);
 assert.equal(tierOf(base[1] - 1, base), 1);
  assert.equal(tierOf(base[1], base), 2);
  assert.equal(tierOf(base[1], thresholds({}, 10100)), 1);                            // the same dollars no longer promote once prices rose 1%

  const calm = { saved: 0, netPay: 0, gross: 0, ontime: 0, late: 0, score: null, cardOwed: 0, mortgagePayment: 0 };
  assert.deepEqual(healthParts(calm), { cushion: 0, on_time: 100, credit: 50, load: 100 });         // nothing saved, nothing late, no file, no debt
  assert.equal(healthScore(healthParts(calm)), 63);
  const p = (o) => healthParts({ ...calm, ...o });
  assert.equal(p({ saved: 150000, netPay: 100000 }).cushion, 50);                      // 1.5 months of 3
  assert.equal(p({ saved: 300000, netPay: 100000 }).cushion, 100);
  assert.equal(p({ saved: 900000, netPay: 100000 }).cushion, 100);                     // capped
  assert.equal(p({ saved: 5 }).cushion, 100);                                          // no pay but some savings
  assert.equal(p({ ontime: 3, late: 1 }).on_time, 75);
  assert.equal(p({ score: 300 }).credit, 0);
  assert.equal(p({ score: 600 }).credit, 50);
  assert.equal(p({ score: 900 }).credit, 100);
  assert.equal(p({ score: 1200 }).credit, 100);
  assert.equal(p({ cardOwed: 100000, gross: 500000 }).load, 99);                       // 1,000 owed on 60,000 a year: 100 x (1 - 1/180) = 99.4
  assert.equal(p({ mortgagePayment: 150000, gross: 500000 }).load, 90);                // 12 x 1,500 = 18,000 on 60,000 a year = 0.3x; 0.3 of the 3x ceiling is 10 points off
  assert.equal(p({ cardOwed: 18000000, gross: 500000 }).load, 0);                      // 3x or more
  assert.equal(p({ cardOwed: 1 }).load, 0);                                            // debt and no income
  assert.deepEqual(ranked([5, 5, 3, 1], (x) => x), [1, 1, 3, 4]);
  assert.equal(roundNet(149999), 100000); assert.equal(roundNet(150000), 200000); assert.equal(roundNet(-40000), 0);
  assert.equal(Object.is(roundNet(-1), 0), true);
  assert.equal(median([3, 1, 2]), 2); assert.equal(median([1, 2, 3, 4]), 2.5); assert.equal(median([]), null);
});

test('the module reads no other module\'s tables', () => {
  const src = moduleSource('leaderboards');   // every server-side file of the module
  const others = src.match(/\b(?:FROM|JOIN|INTO|UPDATE)\s+(?!leaderboards_)(?:bills|jobs|housing|credit|savings|rates|insurance|bank_basic|stress|exchange|life|today|outfitters)_\w+/gi);
  assert.equal(others, null);
  assert.doesNotMatch(src, /import .* from '\.\.\/(?!\.\.)/);                          // no sibling module imports
});

test('snapshots, ranks and change, tiers, health parts from events, class medians, badges and the one-time rank-up, then the season finale', async () => {
  const srv = await boot({ config: config() });
  try {
    const { teacher, students: [s0, s1, s2, s3] } = await seeded(srv, 4);
    const { students: [t0, t1, t2] } = await addClass(srv, teacher, 'Block 2', 3);
    const app = srv.app;
    const worldId = app.world.current().id;
    assert.equal((await board(s0)).empty, true);                                            // before the first month
    assert.equal((await srv.client().get('/api/leaderboards/board')).status, 401);

    give(app, s0, 2500000); give(app, t0, 1200000); give(app, s1, 500000); give(app, s2, 100000);   // each also holds the $500 welcome grant
    await advance(teacher);                                                                  // month 2
    let b = await board(s0);
    assert.equal(b.month, 2);                                                                // the world starts at month 1, so the first tick is month 2
    assert.deepEqual(b.net.town.top.slice(0, 4).map((r) => [r.name, r.rank, r.tier, r.delta]),
      [[s0.username, 1, 'Alpha', null], [t0.username, 2, 'Pack Leader', null], [s1.username, 3, 'Hunter', null], [s2.username, 4, 'Scout', null]]);
    assert.deepEqual(b.net.town.top.slice(4).map((r) => r.rank), [5, 5, 5]);                // a three-way tie shares rank 5
    assert.equal(b.net.town.size, 7); assert.equal(b.net.class.size, 4);
    assert.deepEqual((await s0.client.get('/api/me')).json.badges.map((x) => x.text), ['Wolf: Alpha']);   // the first snapshot announces nothing
    assert.deepEqual((await s3.client.get('/api/me')).json.badges.map((x) => x.text), ['Wolf: Pup']);
    const ledgerSum = (s) => app.ledger.accountsOf('player', s.id).reduce((n, a) => n + a.balance_cents, 0);
    const snap = (s, m) => app.db.prepare('SELECT * FROM leaderboards_snapshots WHERE player_id = ? AND month = ?').get(s.id, m);
    assert.equal(snap(s1, 2).net_worth, ledgerSum(s1));                                     // net worth is the ledger sum

    // month 3: s2 leaps ahead; t2 shows a $4,000 home; s1 builds a cushion, a pay stub and one late bill; Block 2 gets credit files
    give(app, s2, 3000000);
    app.events.emit('module.housing.value', { playerId: t2.id, homeValue: 400000, mortgageBalance: 0 });
    assert.equal((await s1.client.post('/api/savings/move', { direction: 'to_hisa', cents: 300000 })).status, 200);
    app.events.emit('module.jobs.paid', { playerId: s1.id, worldId, month: 3, net: 100000, gross: 150000 });
    for (let i = 0; i < 3; i++) app.events.emit('module.bills.paid', { playerId: s1.id, month: 3, billId: 'phone', onTime: true, amount: 100 });
    app.events.emit('module.bills.late', { playerId: s1.id, month: 3, billId: 'rent', monthsLate: 1 });
    app.events.emit('module.bills.late', { playerId: s1.id, month: 3, billId: 'rent', monthsLate: 1 });          // the same bill again: counted once
    app.events.emit('module.bills.late', { playerId: s1.id, month: 3, billId: 'late-fee-9', monthsLate: 1 });    // a fee line is not a bill of its own
    app.events.emit('module.credit.score', { playerId: t1.id, month: 3, score: 900 });
    app.events.emit('module.credit.score', { playerId: t2.id, month: 3, score: 900 });
    await advance(teacher);                                                                  // month 3
    assert.equal(snap(t2, 3).net_worth, ledgerSum(t2) + 400000);                             // ledger sum + home value
    b = await board(s2);
    assert.deepEqual(b.net.town.top.map((r) => [r.rank, r.delta]), [[1, 3], [2, -1], [3, -1], [4, -1], [5, 0], [6, -1], [6, -1]]);   // s2 4th -> 1st; t2 held 5th
    assert.deepEqual([b.net.class.me.rank, b.net.class.me.delta, b.net.class.me.mine], [1, 2, true]);                     // in Block 1: 3rd -> 1st
    assert.deepEqual(b.net.class.top.map((r) => r.name), [s2, s0, s1, s3].map((s) => s.username));
    assert.deepEqual(b.net.town.top.map((r) => r.tier), ['Alpha', 'Alpha', 'Pack Leader', 'Hunter', 'Scout', 'Pup', 'Pup']);

    // health: s1 = cushion 100 (3 months of net pay), on time 3 of 4 = 75, no credit file 50, no debt 100
    const mine1 = (await board(s1)).me;
    assert.deepEqual(mine1.parts, { cushion: 100, on_time: 75, credit: 50, load: 100 });
    assert.equal(mine1.health, 81);
    assert.equal(mine1.tip.part, 'credit'); assert.match(mine1.tip.text, /card/);
    assert.deepEqual(b.health.town.top.map((r) => [r.name, r.rank, r.health]).slice(0, 3), [[s1.username, 1, 81], [t2.username, 2, 75], [t1.username, 2, 75]]);
    assert.equal(b.health.town.top[3].rank, 4);
    // class vs class: medians, not averages
    assert.deepEqual(b.classes.map((c) => [c.name, c.size, c.mine, c.rank_net, c.rank_health, c.median_net_worth_cents, c.median_health]),
      [['Block 1', 4, true, 1, 2, 1600000, 63], ['Block 2', 3, false, 2, 1, 500000, 75]]);

    // badges: the rank chip, plus a "Ranked up" chip once (s2: Scout -> Alpha; t2: Pup -> Scout; s0 stayed Alpha)
    assert.deepEqual((await s2.client.get('/api/me')).json.badges.map((x) => x.text), ['Wolf: Alpha', 'Ranked up: Alpha!']);
    assert.deepEqual((await t2.client.get('/api/me')).json.badges.map((x) => x.text), ['Wolf: Scout', 'Ranked up: Scout!']);
    assert.deepEqual((await s0.client.get('/api/me')).json.badges.map((x) => x.text), ['Wolf: Alpha']);
    assert.equal(b.me.rank_up, 'Alpha');
    assert.equal((await s2.client.post('/api/leaderboards/ack')).status, 200);
    assert.deepEqual((await s2.client.get('/api/me')).json.badges.map((x) => x.text), ['Wolf: Alpha']);                     // announced once
    assert.equal((await board(s2)).me.rank_up, null);
    assert.deepEqual((await t2.client.get('/api/me')).json.badges.map((x) => x.text), ['Wolf: Scout', 'Ranked up: Scout!']); // ack is per student

    // privacy: no balance, debt or bill fields; amounts rounded to $1,000; nobody's exact numbers
    const raw = (await s0.client.get('/api/leaderboards/board')).json;
    assert.deepEqual([...keys(raw)].filter((k) => /balance|debt|bill|chequing|hisa|card|mortgage|gic|owe/i.test(k)), []);
    const cents = [...JSON.stringify(raw).matchAll(/"[a-z_]*net_worth_cents":(-?\d+)/g)].map((m) => Number(m[1]));
    assert.ok(cents.length > 10 && cents.every((n) => n % 100000 === 0), 'rounded to $1,000');
    for (const exact of [3150000, 2550000, 550687, 1250000]) assert.ok(!JSON.stringify(raw).includes(String(exact)), `exact ${exact} stays hidden`);
    assert.equal(raw.net.class.me.net_worth_cents, 2600000);                                // even your own row is rounded ($25,500 -> $26,000)
    assert.equal((await s0.client.get('/api/leaderboards/teach')).status, 403);

    // teacher: whole classes, rounded amounts, pseudonyms only on the town board, award leaders
    const view = (await teacher.get('/api/leaderboards/teach')).json;
    assert.deepEqual(view.classes.map((c) => [c.name, c.rows.length]), [['Block 1', 4], ['Block 2', 3]]);
    assert.ok(view.town.every((r) => !('net_worth_cents' in r)));
    assert.deepEqual(view.leaders.map((l) => [l.award, l.name ?? l.class_name, l.value]), [['wolf', s2.username, 3200000], ['healthiest', s1.username, 81], ['comeback', s2.username, 3], ['pack', 'Block 2', 75]]);

    // season finale: awards, Hall of Fame, Life Review
    assert.equal((await teacher.post('/api/teach/world/close')).status, 200);
    const hall = (await s3.client.get('/api/leaderboards/hall')).json.seasons;
    assert.equal(hall.length, 1);
    assert.deepEqual(hall[0].awards.map((a) => [a.award, a.name ?? a.class_name, a.value]), [['comeback', s2.username, 3], ['healthiest', s1.username, 81], ['pack', 'Block 2', 75], ['wolf', s2.username, 3200000]]);
    const review = (await board(s2)).last_season;
    assert.deepEqual([review.net_worth_cents, review.tier, review.rank_town, review.of_town, review.health], [3150000, 'Alpha', 1, 7, 63]);
    assert.deepEqual(review.best_month, { month: 3, gain_cents: 3000000 });
    assert.deepEqual(review.parts, { cushion: 0, on_time: 100, credit: 50, load: 100 });
    assert.equal((await srv.app.ledger.audit()).ok, true);

    // the new season: the Life Review is waiting under "Last season", boards start empty, Hall of Fame keeps the old awards
    assert.equal((await teacher.post('/api/teach/world/create', { name: 'S2', season_start: '2026-09-01', season_end: '2027-01-01' })).status, 200);
    const next = await board(s2);
    assert.equal(next.empty, true); assert.equal(next.last_season.season, 'Season 1'); assert.equal(next.last_season.net_worth_cents, 3150000);
    assert.equal((await s0.client.get('/api/leaderboards/hall')).json.seasons.length, 1);
    assert.deepEqual((await s2.client.get('/api/me')).json.badges.map((x) => x.text), ['Wolf: Pup']);   // a new season starts everyone at Pup
  } finally { await srv.cleanup(); }
});

test('card minimums: a statement judged on time counts, a late fee flips it; mortgage and card parts of the health score', async () => {
  const srv = await boot({ config: config() });
  try {
    const { teacher, students: [s] } = await seeded(srv, 1);
    const app = srv.app, worldId = app.world.current().id;
    const parts = async () => (await board(s)).me.parts;
    app.events.emit('module.credit.statement', { playerId: s.id, worldId, month: 1, balance: 50000, minimum: 2500 });
    await advance(teacher);
    assert.equal((await parts()).on_time, 100);                                              // nothing judged yet
    app.events.emit('module.credit.statement', { playerId: s.id, worldId, month: 3, balance: 50000, minimum: 2500 });   // statement 1 was judged
    await advance(teacher);
    assert.equal((await parts()).on_time, 100);
    app.events.emit('module.credit.statement', { playerId: s.id, worldId, month: 4, balance: 50000, minimum: 2500 });   // statement 2 judged, in the tick...
    await advance(teacher);
    assert.equal((await parts()).on_time, 100);                                              // ...and its late fee is posted after the commit, so it shows from the next snapshot
    app.ledger.post({ kind: 'credit.late_fee', legs: [{ account: s.chequing.id, cents: -2900 }, { account: app.ledger.system('sink'), cents: 2900 }] });
    await advance(teacher);
    assert.equal((await parts()).on_time, 50);                                               // 1 on time, 1 late
    // mortgage payments: two on time, one missed
    app.events.emit('module.housing.payment', { playerId: s.id, month: 6, onTime: true, amount: 150000, kind: 'mortgage' });
    app.events.emit('module.housing.payment', { playerId: s.id, month: 7, onTime: true, amount: 150000, kind: 'mortgage' });
    app.events.emit('module.housing.payment', { playerId: s.id, month: 8, onTime: false, amount: 150000, kind: 'mortgage' });
    await advance(teacher);
    assert.equal((await parts()).on_time, 60);                                               // 3 on time, 2 late
    assert.equal((await parts()).load, 100);                                                 // no mortgage account holds debt, so the payment adds no load
  } finally { await srv.cleanup(); }
});

test('teacher settings: hide amounts, freeze for a test week; only the world teacher; teacher B sees only their own classes and the town as pseudonyms', async () => {
  const srv = await boot({ config: config() });
  try {
    const { teacher, students: [s0, s1] } = await seeded(srv, 2);
    const { students: aTwo } = await addClass(srv, teacher, 'Block 2', 2);
    const app = srv.app;
    const invite = (await teacher.post('/api/teach/invites')).json;
    const b = srv.client();
    assert.equal((await b.post('/api/teach/join', { token: new URL(invite.url).searchParams.get('invite'), username: 'teacherB', passphrase: 'another long passphrase' })).status, 200);
    const bClass = (await b.post('/api/teach/classes', { name: 'B block', course: 'fintech10' })).json;
    const made = (await b.post(`/api/teach/classes/${bClass.id}/students`, { count: 9 })).json.students;
    for (const m of made) await srv.client().post('/api/login', { username: m.username, secret: m.pin });   // first login opens accounts
    give(app, s0, 700000);
    for (const m of made) give(app, { chequing: { id: app.ledger.accountId('player', app.players.byUsername(m.username).id, 'chequing') } }, 100000);   // B's students outrank A's, so A's fall off the town top 10
    await advance(teacher);                                                                  // month 2
    const bView = (await b.get('/api/leaderboards/teach')).json;
    assert.deepEqual(bView.classes.map((c) => c.name), ['B block']);                         // not Block 1 or Block 2
    assert.equal(bView.classes[0].rows.length, 9);
    assert.equal(bView.town.length, 10);                                                     // the town board is capped, pseudonyms only
    assert.ok(bView.town.every((r) => !('net_worth_cents' in r) && !('health' in r)));
    const mineB = new Set(bView.classes[0].rows.map((r) => r.name));
    const strangers = [s0, s1, ...aTwo].map((s) => s.username).filter((n) => !bView.town.some((r) => r.name === n));
    assert.ok(strangers.length >= 3);
    for (const n of strangers) assert.ok(!JSON.stringify(bView.classes).includes(n) && !mineB.has(n), `${n} (teacher A's class, off the town top 10) is not in B's view`);
    const aView = (await teacher.get('/api/leaderboards/teach')).json;
    assert.deepEqual(aView.classes.map((c) => c.name), ['Block 1', 'Block 2']);
    assert.ok(!JSON.stringify(aView.classes).includes(made[0].username));
    assert.equal(aView.can_set, true); assert.equal(bView.can_set, false);
    for (const path of ['/api/leaderboards/hide', '/api/leaderboards/freeze']) assert.equal((await b.post(path, { hide_amounts: true, freeze: true })).status, 403);

    // hide amounts: ranks and tiers stay, amounts go
    assert.equal((await teacher.post('/api/leaderboards/hide', { hide_amounts: 'yes' })).status, 400);
    assert.equal((await teacher.post('/api/leaderboards/hide', { hide_amounts: true })).status, 200);
    let sb = await board(s0);
    assert.equal(sb.hidden, true);
    assert.ok([...sb.net.town.top, ...sb.net.class.top].every((r) => r.net_worth_cents === null && typeof r.rank === 'number' && r.tier));
    assert.equal(sb.net.class.me.net_worth_cents, null);
    assert.ok(sb.classes.every((c) => c.median_net_worth_cents === null));
    assert.equal(sb.me.next.at_cents, null);
    assert.ok((await teacher.get('/api/leaderboards/teach')).json.classes[0].rows.every((r) => typeof r.net_worth_cents === 'number'));   // the teacher still sees rounded amounts
    await teacher.post('/api/leaderboards/hide', { hide_amounts: false });
    assert.equal(typeof (await board(s0)).net.class.me.net_worth_cents, 'number');

    // freeze: boards (and chips) keep showing the last snapshot before the freeze while the world moves on
    assert.equal((await teacher.post('/api/leaderboards/freeze', { freeze: true })).json.month, 2);
    give(app, s1, 9000000);
    await advance(teacher);                                                                  // month 3 is snapshotted but not shown
    sb = await board(s1);
    assert.deepEqual([sb.month, sb.frozen, sb.me.tier], [2, true, 'Pup']);
    assert.deepEqual((await s1.client.get('/api/me')).json.badges.map((x) => x.text), ['Wolf: Pup']);
    assert.equal((await s1.client.post('/api/leaderboards/ack')).status, 200);               // acknowledging while frozen cannot swallow a rank-up the boards do not show yet
    assert.equal((await teacher.post('/api/leaderboards/freeze', { freeze: false })).status, 200);
    assert.deepEqual((await s1.client.get('/api/me')).json.badges.map((x) => x.text), ['Wolf: Alpha', 'Ranked up: Alpha!']);
    sb = await board(s1);
    assert.deepEqual([sb.month, sb.frozen, sb.me.tier, sb.net.town.top[0].name], [3, false, 'Alpha', s1.username]);
  } finally { await srv.cleanup(); }
});

test('a rank-up needs a higher tier and is announced once per tier; prices rising holds a student back; dropping to Pup is quiet', async () => {
  const srv = await boot({ config: config() });
  try {
    const { teacher, students: [s] } = await seeded(srv, 1);
    const app = srv.app, worldId = app.world.current().id;
    const chips = async () => (await s.client.get('/api/me')).json.badges.map((x) => x.text);
    const wipe = () => app.ledger.post({ kind: 'test.wipe', legs: [{ account: s.chequing.id, cents: -app.ledger.balance(s.chequing.id) }, { account: app.ledger.system('sink'), cents: app.ledger.balance(s.chequing.id) }] });
    await advance(teacher);                                                                  // month 2: Pup with $500
    give(app, s, 590000);                                                                    // $6,400: Hunter ($5,000) at season-start prices...
    app.events.emit('module.rates.changed', { worldId, month: 3, priceIndexBp: 13000, policyBp: 225, hisaBp: 275 });   // ...but prices are +30%, so Hunter is $6,500
    await advance(teacher);
    assert.deepEqual(await chips(), ['Wolf: Scout', 'Ranked up: Scout!']);
    give(app, s, 20000);                                                                     // $6,600
    await advance(teacher);
    assert.deepEqual(await chips(), ['Wolf: Hunter', 'Ranked up: Hunter!']);                 // Pup -> Scout -> Hunter: the highest unread tier is announced
    await s.client.post('/api/leaderboards/ack');
    wipe(); await advance(teacher);
    assert.deepEqual(await chips(), ['Wolf: Pup']);                                          // a drop announces nothing
    give(app, s, 660000);
    await advance(teacher);
    assert.deepEqual(await chips(), ['Wolf: Hunter']);                                       // Hunter was announced already this season
    assert.equal((await board(s)).me.next.name, 'Pack Leader');
    assert.equal((await board(s)).me.next.at_cents, 1300000);                                // $10,000 x 1.3
  } finally { await srv.cleanup(); }
});
