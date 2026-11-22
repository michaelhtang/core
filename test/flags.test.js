// Pattern flags and the fifth health part (wave 6a, docs/phase6-roles.md §1.1 "Health board" and §1.3): the pure calm part, each flag true and false
// from seeded leaderboards rows, the season close storing them, and the teacher route's scoping.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { boot, seeded, bareApp } from './helpers.js';
import { healthParts, healthScore, tipFor, weakest } from '../modules/leaderboards/health.js';
import { flags } from '../modules/leaderboards/flags.js';

test('the fifth health part: calm = 100 - stress only when stress is known; four parts score exactly as before', () => {
  const base = { saved: 300000, netPay: 100000, gross: 150000, ontime: 3, late: 1, score: 660, cardOwed: 0, mortgagePayment: 0 };
  const four = healthParts(base);
  assert.deepEqual(Object.keys(four), ['cushion', 'on_time', 'credit', 'load']);
  assert.deepEqual(healthParts({ ...base, stress: null }), four);
  assert.equal(healthScore(four), Math.round((four.cushion + four.on_time + four.credit + four.load) / 4));
  const five = healthParts({ ...base, stress: 70 });
  assert.equal(five.calm, 30);
  assert.equal(healthScore(five), Math.round((four.cushion + four.on_time + four.credit + four.load + 30) / 5));
  assert.equal(healthParts({ ...base, stress: 0 }).calm, 100);
  assert.equal(weakest(five), 'calm'); assert.equal(tipFor(five).name, 'Calm');
  assert.notEqual(weakest(four), 'calm');
  assert.equal(healthScore({ cushion: 100, on_time: 100, credit: 50, load: 100 }), 88, 'an old snapshot without calm');
});

// Three students in one class, months 2-20. A: every flag. B: just under every line. C: only "excessive debt" (two emergency loans).
function seed(app, cls, [a, b, c]) {
  const w = app.world.current().id;
  const put = app.db.prepare('INSERT INTO leaderboards_snapshots (world_id, player_id, month, class_id, net_worth, health, parts, rank_class, rank_town, tier, chequing, saved, holdings, net_pay) VALUES (?, ?, ?, ?, 0, 50, ?, ?, ?, 0, ?, ?, ?, ?)');
  for (let m = 2; m <= 20; m++) {
    const rank = m <= 12 ? { [b]: 1, [c]: 2, [a]: 3 } : { [a]: 1, [b]: 2, [c]: 3 };
    const parts = (cushion, load) => JSON.stringify({ cushion, on_time: 100, credit: 50, load });
    put.run(w, a, m, cls.id, parts(20, m <= 4 ? 30 : 100), rank[a], rank[a], 500000, 0, 0, 100000);                       // hoards every month, low load 3 months
    put.run(w, b, m, cls.id, parts(40, m <= 3 ? 30 : 100), rank[b], rank[b], m >= 16 ? 500000 : 100000, 0, m === 5 ? 1000 : 0, 100000);   // 5 hoarding months, 2 low-load months, held a share once
    put.run(w, c, m, cls.id, parts(50, 100), rank[c], rank[c], 100000, 300000, 0, 100000);
  }
  const inp = app.db.prepare('INSERT INTO leaderboards_inputs (world_id, player_id, ontime, loans, invested, home_value, mortgage_payment, gross_cents) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
  inp.run(w, a, 12, 0, 0, 20000000, 200000, 500000);    // 40% of gross on the mortgage, cushion 20
  inp.run(w, b, 15, 1, 0, 20000000, 150000, 500000);    // 30%; and one late row below
  inp.run(w, c, 11, 2, 1, 20000000, 200000, 500000);    // 40% but cushion 50; contributed to the TFSA
  app.db.prepare("INSERT INTO leaderboards_late (world_id, player_id, key) VALUES (?, ?, 'b:phone:3')").run(w, b);
  return w;
}
const ALL = ['hoards_cash', 'excessive_debt', 'never_invested', 'always_on_time', 'house_poor', 'late_bloomer'];

test('each flag, true and false, from seeded snapshots, inputs and late rows; the number behind each', async () => {
  const { app, cls, cleanup } = await bareApp();
  try {
    const [a, b, c] = (await app.players.createStudents({ classId: cls.id, count: 3, hash: false })).map((s) => s.id);
    const w = seed(app, cls, [a, b, c]);
    const k = app.modules.kernel('leaderboards');
    const fa = flags(k, { worldId: w, playerId: a });
    assert.deepEqual(fa.map((f) => f.key), ALL);
    const by = Object.fromEntries(fa.map((f) => [f.key, f.detail]));
    assert.match(by.hoards_cash, /^12 of the last 12 months/);
    assert.match(by.excessive_debt, /under 40 in 3 months/);
    assert.match(by.never_invested, /19 months/);
    assert.match(by.always_on_time, /^12 on-time payments, none late/);
    assert.match(by.house_poor, /\$2,000\/month is 40% of gross pay; savings cushion 20/);
    assert.match(by.late_bloomer, /#3 at month 12 to #1 of 3 at month 20/);
    assert.deepEqual(flags(k, { worldId: w, playerId: b }), [], 'just under every line');
    assert.deepEqual(flags(k, { worldId: w, playerId: c }).map((f) => [f.key, f.detail]), [['excessive_debt', '2 emergency loans']]);
    assert.deepEqual(flags(k, { worldId: w + 1, playerId: a }), [], 'another world has no rows');
  } finally { cleanup(); }
});

test('season close stores the flags in the Life Review and leaderboards_flags; the live route is the teacher\'s own classes only', async () => {
  const srv = await boot();
  try {
    const { teacher, cls, students } = await seeded(srv, 3, { transfers: false });
    const app = srv.app;
    const w = seed(app, cls, students.map((s) => s.id));
    const live = await teacher.get(`/api/leaderboards/flags?class_id=${cls.id}`);
    assert.equal(live.status, 200);
    const keys = Object.fromEntries(live.json.students.map((s) => [s.username, s.flags.map((f) => f.key)]));
    assert.deepEqual(students.map((s) => keys[s.username]), [ALL, [], ['excessive_debt']]);
    assert.equal((await teacher.get(`/api/leaderboards/flags?class_id=${cls.id + 99}`)).status, 404);
    assert.equal((await teacher.get('/api/leaderboards/flags?class_id=x')).status, 404);
    assert.equal((await teacher.get('/api/leaderboards/flags')).status, 404);
    assert.equal((await students[0].client.get(`/api/leaderboards/flags?class_id=${cls.id}`)).status, 403);
    const invite = (await teacher.post('/api/teach/invites')).json;
    const other = srv.client();
    assert.equal((await other.post('/api/teach/join', { token: new URL(invite.url).searchParams.get('invite'), username: 'teacherB', passphrase: 'another long passphrase' })).status, 200);
    assert.equal((await other.get(`/api/leaderboards/flags?class_id=${cls.id}`)).status, 404, 'not their class');
    assert.equal((await teacher.post('/api/teach/world/close')).status, 200);
    const review = (await students[0].client.get('/api/leaderboards/board')).json.last_season;
    assert.deepEqual(review.flags.map((f) => f.key), ALL);
    assert.ok(review.flags.every((f) => f.text && f.detail));
    assert.deepEqual(app.db.prepare('SELECT player_id, key FROM leaderboards_flags WHERE world_id = ? ORDER BY player_id, key').all(w).map((r) => [r.player_id, r.key]),
      [...ALL.map((key) => [students[0].id, key]).sort((x, y) => x[1].localeCompare(y[1])), [students[2].id, 'excessive_debt']]);
  } finally { await srv.cleanup(); }
});
