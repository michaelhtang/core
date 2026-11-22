// today (docs/phase5-life.md 5a): the day clock, deterministic errands, completion by event and by fact, expiry, streak, rewards,
// the digest, lesson quests and their permissions, and today switched off.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createApp } from '../lib/app.js';
import { createClock } from '../lib/clock.js';
import { boot, seeded, tmpDir } from './helpers.js';
import { selectErrands, tag } from '../modules/today/index.js';
import ERRANDS from '../modules/today/errands.json' with { type: 'json' };

const CONFIG = JSON.parse(fs.readFileSync(new URL('../config/vdaa.json', import.meta.url), 'utf8'));
const PASS = 'another long passphrase';

// A bare app on a hand-set clock with one fintech10 class of n students, each "logged in" once.
async function world({ n = 1, config = CONFIG, autopay = false } = {}) {
  const dataDir = tmpDir();
  let t = Date.parse('2026-11-02T15:00:00Z');
  const app = await createApp({ dataDir, config, clock: createClock({ now: () => t }) });
  app.world.create();
  const cls = app.players.createClass({ name: 'Block 1', course: 'fintech10' });
  const made = await app.players.createStudents({ classId: cls.id, count: n, hash: false });
  // bills' onPlayer turns autopay on for every new student; these tests start from autopay off (like helpers.js manualBills), unless asked
  if (!autopay && app.modules.has('bills')) for (const s of made) app.db.prepare('UPDATE bills_settings SET autopay = 0 WHERE player_id = ?').run(s.id);
  for (const s of made) app.modules.onLogin({ ...s, class_id: cls.id }, 'fintech10');
  const users = made.map((s) => ({ id: s.id, username: s.username, role: 'student', class_id: cls.id }));
  const handler = (mod, method, p) => app.modules.routes().find((r) => r.module === mod && r.method === method && r.path === p).handler;
  const get = (mod, p, user) => handler(mod, 'GET', p)({ user, body: {}, params: {}, url: new URL('http://t/') });
  const post = (mod, p, body, user) => handler(mod, 'POST', p)({ user, body, params: {}, url: new URL('http://t/') });
  const tick = (ms = 60_000) => { t += ms; };
  const advance = (months = 1) => { tick(); const w = app.world.advance({ months }); tick(); return w; };
  const card = (u) => app.modules.homeCardsFor(u, 'fintech10', 'v').find((c) => c.module === 'today')?.data;
  const grant = (u, cents) => { tick(); app.ledger.post({ kind: 'test.grant', legs: [{ account: app.ledger.system('mint'), cents: -cents }, { account: app.ledger.accountId('player', u.id, 'chequing'), cents }] }); tick(); };
  const errands = (u, day) => app.db.prepare('SELECT template, status, reward_cents, txn_id FROM today_errands WHERE player_id = ? AND day_no = ? ORDER BY id').all(u.id, day).map((r) => ({ ...r }));
  const firstJob = () => app.db.prepare('SELECT id FROM jobs_catalogue WHERE active = 1 ORDER BY id LIMIT 1').get().id;
  return { app, cls, users, get, post, tick, advance, card, grant, errands, firstJob, cleanup() { app.db.close(); fs.rmSync(dataDir, { recursive: true, force: true }); } };
}

test('selection is deterministic: the same facts, secret, player and day give the same three; the HMAC orders ties within a priority', () => {
  const facts = { 'jobs.hasJob': true, 'jobs.promotionEligible': false, 'jobs.applicationPending': false, 'bills.autopay': false, 'bills.dueCount': 0, 'bills.overdueCount': 0,
    'savings.idleChequingCents': 200000, 'savings.hisaCents': 0, 'savings.gicCount': 0, 'credit.hasCard': false, 'credit.inquiries': 0, 'credit.minimumDueCents': 0,
    'exchange.holdings': 0, 'exchange.tfsaContributedCents': 0, 'housing.owns': false };
  const args = { facts, secret: 'a'.repeat(32), worldId: 1, playerId: 7, dayNo: 4 };
  const one = selectErrands(args).map((t) => t.id);
  assert.equal(one.length, 3);
  assert.deepEqual(selectErrands({ ...args }).map((t) => t.id), one);
  assert.deepEqual(selectErrands({ ...args, facts: { ...facts } }).map((t) => t.id), one);
  assert.deepEqual(one, ['autopay-on', 'move-to-hisa', 'open-tfsa'], 'priority first');
  // Within one priority the HMAC decides, and it depends on the day: the visit tours (no `when`) rotate.
  const tours = ERRANDS.filter((t) => t.id.startsWith('tour-'));
  const order = (dayNo) => selectErrands({ ...args, templates: tours, dayNo }).map((t) => t.id);
  assert.deepEqual(order(4), order(4));
  const free = tours.filter((t) => t.priority === 8 && !t.when.length);
  const byTag = (dayNo) => free.map((t) => [t.id, tag(args.secret, 1, 7, dayNo, t.id)]).sort((a, b) => (a[1] < b[1] ? -1 : 1)).map(([id]) => id);
  assert.deepEqual(selectErrands({ ...args, templates: free, dayNo: 9 }).map((t) => t.id), byTag(9).slice(0, 3));
  assert.ok([1, 2, 3, 5, 6, 7, 8].some((d) => order(d).join() !== order(4).join()), 'another day gives another order');
  // done recently (last 3 days): skipped; done already by its facts: never offered (no free reward); an absent fact never holds.
  assert.ok(!selectErrands({ ...args, recent: new Set(['move-to-hisa']) }).some((t) => t.id === 'move-to-hisa'));
  assert.ok(!selectErrands({ ...args, facts: { ...facts, 'bills.autopay': true } }).some((t) => t.id === 'autopay-on'));
  const noBills = Object.fromEntries(Object.entries(facts).filter(([k]) => !k.startsWith('bills.')));
  assert.ok(!selectErrands({ ...args, facts: noBills }).some((t) => t.when.some((c) => c.fact.startsWith('bills.'))));
  // jobless: "Pick a job" is the only errand
  assert.deepEqual(selectErrands({ ...args, facts: { ...facts, 'jobs.hasJob': false } }).map((t) => t.id), ['pick-job']);
});

test('one day per advance: a 12-month advance is one day, errands refresh once; the day row is written inside the advance', async () => {
  const w = await world();
  try {
    const [u] = w.users;
    assert.equal(w.card(u).day, 0);
    w.advance(12);
    const days = w.app.db.prepare('SELECT day_no, month FROM today_days').all().map((r) => ({ ...r }));
    assert.deepEqual(days, [{ day_no: 0, month: 1 }, { day_no: 1, month: 13 }]);   // day 0 is written by the first look before any advance
    assert.equal(w.card(u).day, 1);
    assert.equal(w.app.db.prepare('SELECT COUNT(*) AS n FROM today_errands WHERE day_no = 1').get().n, 1);   // jobless: one errand, chosen once
    w.advance(1); w.advance(3);
    assert.deepEqual(w.app.db.prepare('SELECT day_no, month FROM today_days ORDER BY day_no').all().map((r) => [r.day_no, r.month]), [[0, 1], [1, 13], [2, 14], [3, 17]]);
  } finally { w.cleanup(); }
});

test('jobless: Pick a job is the only errand; picking one completes it by fact on the next read, with a balanced, fixed reward and the streak', async () => {
  const w = await world();
  try {
    const [u] = w.users;
    assert.deepEqual(w.card(u).errands.map((e) => [e.title, e.status, e.building]), [['Pick a job at the Job Centre', 'open', 'job']]);
    const before = w.app.ledger.balance(w.app.ledger.accountId('player', u.id, 'chequing'));
    w.post('jobs', '/pick', { job_id: w.firstJob() }, u);
    const c = w.card(u);
    assert.deepEqual(c.errands.map((e) => [e.status, e.reward_cents]), [['done', 200]]);
    assert.equal(c.streak, 1);
    assert.equal(w.app.ledger.balance(w.app.ledger.accountId('player', u.id, 'chequing')), before + 200);
    const txn = w.errands(u, 0)[0].txn_id;
    const legs = w.app.db.prepare('SELECT amount_cents FROM entries WHERE txn_id = ?').all(txn).map((e) => e.amount_cents);
    assert.deepEqual(legs.sort((a, b) => a - b), [-200, 200]);
    assert.equal(w.app.db.prepare('SELECT kind FROM txns WHERE id = ?').get(txn).kind, 'today.errand');
    w.card(u);                                                   // reading again pays nothing twice
    assert.equal(w.app.db.prepare("SELECT COUNT(*) AS n FROM txns WHERE kind = 'today.errand'").get().n, 1);
    assert.equal(w.app.ledger.audit().ok, true);
  } finally { w.cleanup(); }
});

test('completion by event (a HISA move), by fact at the next advance (autopay), expiry at the next advance; the streak counts class days', async () => {
  const w = await world();
  try {
    const [u] = w.users;
    w.card(u);
    w.post('jobs', '/pick', { job_id: w.firstJob() }, u);
    w.card(u);                                                   // day 0: pick-job done (streak 1)
    w.grant(u, 200000);
    w.advance();
    assert.deepEqual(w.card(u).errands.map((e) => e.title), ['Turn on bill autopay so nothing is missed', 'Move idle chequing money into your HISA', 'Put some money in a TFSA']);
    w.post('savings', '/move', { direction: 'to_hisa', cents: 10000 }, u);          // ledger.posted, after commit: the listener completes it
    assert.deepEqual(w.errands(u, 1).map((e) => e.status), ['open', 'done', 'open']);
    w.post('bills', '/autopay', { enabled: true }, u);           // no event: judged by its fact at the next advance
    w.advance();
    const c = w.card(u);
    assert.deepEqual(w.errands(u, 1).map((e) => [e.template, e.status]), [['autopay-on', 'done'], ['move-to-hisa', 'done'], ['open-tfsa', 'expired']]);
    assert.equal(c.streak, 2, 'day 0 and day 1');
    assert.ok(!c.errands.some((e) => e.title.startsWith('Move idle')), 'done in the last 3 days: not offered again');
    assert.equal(c.energy, c.energy_cap, 'refilled at the advance');
    // Nothing done on day 2; a long no-school gap on the wall clock changes nothing; the missed class day does.
    w.tick(10 * 864e5);
    assert.equal(w.card(u).streak, 2);
    w.advance();
    assert.equal(w.card(u).streak, 0, 'day 2 was missed');
    assert.equal(w.app.ledger.audit().ok, true);
  } finally { w.cleanup(); }
});

test('completion by a module event: paying a due bill (module.bills.paid, inside the payment) completes "Pay the bills that are due"', async () => {
  const w = await world();
  try {
    const [u] = w.users;
    w.card(u);
    w.post('jobs', '/pick', { job_id: w.firstJob() }, u);
    w.card(u);
    w.advance(); w.card(u);                                      // payday: billing starts the month after the first pay
    w.advance();
    const c = w.card(u);
    assert.ok(c.due.n > 0, 'bills are due');
    assert.ok(c.errands.some((e) => e.title === 'Pay the bills that are due' && e.status === 'open'), JSON.stringify(c.errands));
    w.post('bills', '/pay-all', {}, u);
    assert.equal(w.card(u).errands.find((e) => e.title === 'Pay the bills that are due').status, 'done');
    assert.equal(w.app.ledger.audit().ok, true);
  } finally { w.cleanup(); }
});

test('a new student with the real default (autopay on) gets a valid card, and "Turn on autopay" is never offered', async () => {
  const w = await world({ autopay: true });
  try {
    const [u] = w.users;
    assert.equal(w.app.db.prepare('SELECT autopay FROM bills_settings WHERE player_id = ?').get(u.id).autopay, 1);
    w.card(u);
    w.post('jobs', '/pick', { job_id: w.firstJob() }, u);
    w.grant(u, 200000);
    for (let d = 0; d < 4; d++) {
      const c = w.card(u);
      assert.equal(c.day, d);
      assert.ok(c.errands.length >= 1 && c.errands.length <= 3, JSON.stringify(c.errands));
      assert.ok(!c.errands.some((e) => /autopay/i.test(e.title)), JSON.stringify(c.errands));
      w.advance();
    }
    assert.equal(w.app.db.prepare("SELECT COUNT(*) AS n FROM today_errands WHERE template = 'autopay-on'").get().n, 0);
  } finally { w.cleanup(); }
});

test('catch-up after a skipped day: a fact errand done on day 1, nobody looking on day 2, first look on day 3 => done for day 1, paid once', async () => {
  const w = await world();
  try {
    const [u] = w.users;
    w.card(u);
    w.post('jobs', '/pick', { job_id: w.firstJob() }, u);
    w.card(u);                                                   // day 0: pick-job done
    w.advance();
    assert.ok(w.card(u).errands.some((e) => e.title === 'Turn on bill autopay so nothing is missed'));   // day 1 chosen
    w.post('bills', '/autopay', { enabled: true }, u);           // done on day 1, the card not opened again
    w.advance();                                                 // day 2: nobody looks
    w.advance();                                                 // day 3: the first look
    const c = w.card(u);
    assert.equal(c.day, 3);
    const row = w.app.db.prepare("SELECT status, reward_cents FROM today_errands WHERE player_id = ? AND day_no = 1 AND template = 'autopay-on'").get(u.id);
    assert.deepEqual({ ...row }, { status: 'done', reward_cents: 100 });
    assert.equal(w.app.db.prepare("SELECT COUNT(*) AS n FROM txns WHERE kind = 'today.errand' AND json_extract(meta, '$.template') = 'autopay-on'").get().n, 1);
    w.card(u);
    assert.equal(w.app.db.prepare("SELECT COUNT(*) AS n FROM txns WHERE kind = 'today.errand' AND json_extract(meta, '$.template') = 'autopay-on'").get().n, 1, 'paid once');
    assert.equal(w.app.db.prepare('SELECT last_day_done FROM today_state WHERE player_id = ?').get(u.id).last_day_done, 1);
    assert.equal(c.streak, 0, 'day 2 was missed');
    assert.ok(w.errands(u, 1).every((e) => e.status !== 'open'), 'the rest of day 1 expired');
  } finally { w.cleanup(); }
});

test('quest tasks need the student\'s own action today: an existing TFSA does not count as opening one, a tick-time limit fill does not count as buying', async () => {
  const w = await world();
  try {
    const [u] = w.users;
    w.grant(u, 500000);
    w.post('exchange', '/contribute', { account: 'tfsa', cents: 20000 }, u);       // day 0: the TFSA already holds money
    w.post('exchange', '/contribute', { account: 'invest', cents: 20000 }, u);
    w.advance();
    const wid = w.app.world.current().id;
    // a limit fill as the tick posts it (actor system, kind exchange.fill), after the day began: the student did nothing today
    w.app.ledger.post({ kind: 'exchange.fill', actor: 'system', meta: { ticker: 'DAAX', orderId: 1 }, legs: [{ account: w.app.ledger.accountId('player', u.id, 'invest'), cents: -5000 }, { account: w.app.ledger.system('sink'), cents: 5000 }] });
    w.tick();
    const date = w.app.clock.today();
    const push = (tasks) => w.app.db.prepare('INSERT INTO today_quests (world_id, date, body, created) VALUES (?, ?, ?, 0) ON CONFLICT (world_id, date) DO UPDATE SET body = excluded.body')
      .run(wid, date, JSON.stringify({ id: 'q', date, title: 'Q', brief: 'B', tasks, justify: false, reward_cents: 100, energy: 1 }));
    push([{ kind: 'opened_registered_account', check: 'tfsa' }]);
    assert.deepEqual(w.card(u).quest.tasks.map((t) => t.done), [false], 'an existing TFSA is not "opened" today');
    push([{ kind: 'bought_security' }]);
    assert.deepEqual(w.card(u).quest.tasks.map((t) => t.done), [false], 'a fill in the tick is not the student buying today');
    w.post('exchange', '/contribute', { account: 'tfsa', cents: 1000 }, u);
    push([{ kind: 'opened_registered_account', check: 'tfsa' }]);
    assert.equal(w.card(u).quest.done, true, 'their own contribution today counts');
  } finally { w.cleanup(); }
});

test('the streak never breaks over a no-school gap: days are advances, not calendar days', async () => {
  const config = structuredClone(CONFIG);                        // only modules whose errands are building tours once a job is held
  for (const c of Object.values(config.courses)) c.modules = ['bank-basic', 'rates', 'jobs', 'savings', 'today'];
  const w = await world({ config });
  try {
    const [u] = w.users;
    const visitOf = (e) => ERRANDS.find((x) => x.title === e.title)?.done.visit;
    const tour = (day) => { const e = w.card(u).errands.find((x) => x.status === 'open' && visitOf(x)); assert.ok(e, `an errand on day ${day}`); w.post('today', '/visit', { building: e.building }, u); };
    w.card(u);
    w.post('jobs', '/pick', { job_id: w.firstJob() }, u);
    assert.equal(w.card(u).streak, 1, 'day 0: pick-job done');
    for (let d = 1; d <= 3; d++) {
      w.tick(d === 2 ? 16 * 864e5 : 864e5);                       // winter break: 16 calendar days with no advance
      w.advance();
      tour(d);
    }
    assert.equal(w.card(u).streak, 4);
  } finally { w.cleanup(); }
});

test('rewards: fixed cents x the price index, capped by options.today.maxRewardCents; never more than the hard ceiling', async () => {
  const config = structuredClone(CONFIG);
  config.options.today = { maxRewardCents: 150 };
  const w = await world({ n: 2, config });
  try {
    const [a, b] = w.users;
    w.card(a); w.card(b);
    w.post('jobs', '/pick', { job_id: w.firstJob() }, a);
    assert.equal(w.card(a).errands[0].reward_cents, 150, 'pick-job is $2.00, capped at $1.50');
    w.app.db.prepare('INSERT INTO price_index (world_id, index_bp) VALUES (?, 12000) ON CONFLICT (world_id) DO UPDATE SET index_bp = 12000').run(w.app.world.current().id);
    w.post('jobs', '/pick', { job_id: w.firstJob() }, b);
    assert.equal(w.card(b).errands[0].reward_cents, 150);
    assert.equal(w.app.db.prepare("SELECT SUM(e.amount_cents) AS n FROM entries e JOIN txns t ON t.id = e.txn_id WHERE t.kind = 'today.errand'").get().n, 0, 'every reward txn balances');
    assert.equal(w.app.ledger.audit().ok, true);
  } finally { w.cleanup(); }
  const w2 = await world();
  try {
    const [u] = w2.users;
    w2.card(u);
    w2.app.db.prepare('INSERT INTO price_index (world_id, index_bp) VALUES (?, 12000) ON CONFLICT (world_id) DO UPDATE SET index_bp = 12000').run(w2.app.world.current().id);
    w2.post('jobs', '/pick', { job_id: w2.firstJob() }, u);
    assert.equal(w2.card(u).errands[0].reward_cents, 240, '$2.00 x 1.2');
  } finally { w2.cleanup(); }
});

test('the digest equals the ledger over the window since the previous advance, grouped by kind; pay matches the pay stub', async () => {
  const w = await world();
  try {
    const [u] = w.users;
    w.post('jobs', '/pick', { job_id: w.firstJob() }, u);
    w.advance(); w.card(u);
    w.post('savings', '/move', { direction: 'to_hisa', cents: 5000 }, u);
    w.advance(); w.advance();                                    // day 3: its window is (day 2's advance, now]
    const c = w.card(u);
    const since = w.app.db.prepare('SELECT at FROM today_days WHERE day_no = 2').get().at;
    const sql = w.app.db.prepare(`SELECT COALESCE(SUM(e.amount_cents), 0) AS n FROM entries e JOIN accounts a ON a.id = e.account_id
      WHERE a.owner_type = 'player' AND a.owner_id = ? AND a.kind <> 'payable' AND e.created > ?`).get(u.id, since).n;
    assert.equal(c.digest.total, sql);
    assert.equal(Object.values(c.digest.groups).reduce((s, v) => s + v, 0), sql);
    const month = w.app.db.prepare('SELECT month FROM today_days WHERE day_no = 3').get().month;
    const net = w.app.db.prepare('SELECT SUM(net) AS n FROM jobs_paystubs WHERE player_id = ? AND month = ?').get(u.id, month).n;
    assert.ok(net > 0);
    assert.equal(c.digest.groups.pay, net, 'one advance: one month of pay');
    assert.ok(c.digest.groups.bills < 0 || c.due.n > 0, 'bills paid, or now due');
  } finally { w.cleanup(); }
});

test('today switched off for a course: no card, no rows, the same home screen; switched on for the other course it works', async () => {
  const config = structuredClone(CONFIG);
  config.courses.fintech10.modules = config.courses.fintech10.modules.filter((m) => m !== 'today' && m !== 'feed' && m !== 'learn');   // feed (6a) and learn have home cards too
  const w = await world({ config });
  try {
    const [u] = w.users;
    assert.deepEqual(w.app.modules.homeCardsFor(u, 'fintech10', 'v'), []);
    w.post('savings', '/move', { direction: 'to_hisa', cents: 1000 }, u);
    w.advance();
    const todays = (course) => w.app.modules.homeCardsFor(u, course, 'v').filter((c) => c.module === 'today');   // stress (6a) has a card too after a tick
    assert.deepEqual(todays('fintech10'), []);
    assert.equal(w.app.db.prepare('SELECT COUNT(*) AS n FROM today_state').get().n, 0);
    assert.equal(w.app.db.prepare('SELECT COUNT(*) AS n FROM today_errands').get().n, 0);
    assert.equal(w.app.db.prepare("SELECT COUNT(*) AS n FROM txns WHERE kind LIKE 'today.%'").get().n, 0);
    assert.equal(todays('fintech2030').length, 1, 'the module itself is loaded for the other course');
  } finally { w.cleanup(); }
  // and with today in no course at all, /api/me carries an empty homeCards list
  const off = structuredClone(CONFIG);
  for (const c of Object.values(off.courses)) c.modules = c.modules.filter((m) => m !== 'today' && m !== 'feed' && m !== 'learn');
  const srv = await boot({ config: off });
  try {
    const { students: [s] } = await seeded(srv, 1, { transfers: false });
    const me = (await s.client.get('/api/me')).json;
    assert.deepEqual(me.homeCards, []);
    assert.equal((await s.client.get('/api/today/state')).status, 404);
  } finally { await srv.cleanup(); }
});

test('quests: world teacher only, every field validated; a student answers after the tasks; answers reach their own teachers only (teacher B isolation)', async () => {
  let t = Date.parse('2026-11-02T18:00:00Z');                    // 2026-11-02 in Edmonton
  const srv = await boot({ clock: createClock({ now: () => t }) });
  try {
    const { teacher: a, cls, students: [s1, s2] } = await seeded(srv, 2, { transfers: false });
    const invite = (await a.post('/api/teach/invites')).json;
    const b = srv.client();
    assert.equal((await b.post('/api/teach/join', { token: new URL(invite.url).searchParams.get('invite'), username: 'teacherB', passphrase: PASS })).status, 200);
    const clsB = (await b.post('/api/teach/classes', { name: 'Block B', course: 'fintech10' })).json;
    const [sb] = (await b.post(`/api/teach/classes/${clsB.id}/students`, { count: 1 })).json.students;
    const cb = srv.client();
    await cb.post('/api/login', { username: sb.username, secret: sb.pin });
    await cb.get('/api/me');

    const quest = { id: 'budget-1', date: '2026-11-02', title: 'Budget check', brief: 'Open the Bills building and decide.', tasks: [{ kind: 'read_panel', check: 'bills' }], justify: true, reward_cents: 300, energy: 2 };
    for (const [why, body] of [['bad kind', { ...quest, tasks: [{ kind: 'hack' }] }], ['no tasks', { ...quest, tasks: [] }], ['six tasks', { ...quest, tasks: Array(6).fill({ kind: 'paid_bill' }) }],
      ['bad date', { ...quest, date: '2026-02-30' }], ['reward over the cap', { ...quest, reward_cents: 100001 }], ['bad check', { ...quest, tasks: [{ kind: 'moved_to_account', check: 'mattress' }] }],
      ['long title', { ...quest, title: 'x'.repeat(81) }], ['no brief', { ...quest, brief: '' }], ['justify not a boolean', { ...quest, justify: 'yes' }], ['tasks not a list', { ...quest, tasks: { kind: 'paid_bill' } }]]) {
      assert.equal((await a.post('/api/today/quest', body)).status, 400, why);
    }
    assert.equal((await s1.client.post('/api/today/quest', quest)).status, 403, 'a student');
    assert.equal((await b.post('/api/today/quest', quest)).status, 403, 'not the world teacher');
    assert.equal((await a.post('/api/today/quest', quest)).status, 200);

    const st = (await s1.client.get('/api/today/state')).json;
    assert.equal(st.quest.title, 'Budget check');
    assert.deepEqual(st.quest.tasks, [{ kind: 'read_panel', check: 'bills', done: false }]);
    const answer = { id: st.quest.id, answer: 'I keep my rent first because needs come before wants.' };
    assert.equal((await s1.client.post('/api/today/answer', answer)).status, 409, 'tasks first');
    assert.equal((await s1.client.post('/api/today/visit', { building: 'bills' })).json.counted, true);
    assert.equal((await s1.client.post('/api/today/answer', { ...answer, answer: 'too short' })).status, 400);
    assert.equal((await s1.client.post('/api/today/answer', { ...answer, id: st.quest.id + 1 })).status, 404);
    assert.equal((await s1.client.post('/api/today/answer', answer)).status, 200);
    assert.equal((await s1.client.post('/api/today/answer', answer)).status, 409, 'once');
    assert.equal((await s1.client.get('/api/today/state')).json.quest.done, true);
    await cb.post('/api/today/visit', { building: 'bills' });
    assert.equal((await cb.post('/api/today/answer', { id: st.quest.id, answer: 'Teacher B class: I chose to pay the phone bill first.' })).status, 200);
    assert.equal((await s2.client.get('/api/today/teach')).status, 403, 'students never see answers');

    const va = (await a.get('/api/today/teach')).json;
    assert.deepEqual(va.answers.map((x) => x.username), [s1.username]);
    assert.equal(va.can_push, true);
    const vb = (await b.get('/api/today/teach')).json;
    assert.deepEqual(vb.answers.map((x) => x.username), [sb.username]);
    assert.deepEqual(vb.classes.map((c) => c.id), [clsB.id]);
    assert.ok(!vb.students.some((x) => x.class_id === cls.id));
    assert.equal(vb.can_push, false);
    assert.equal((await b.post('/api/today/cap', { class_id: cls.id, energy_cap: 3 })).status, 404, 'teacher B cannot set class A\'s cap');
    assert.equal((await b.post('/api/today/cap', { class_id: clsB.id, energy_cap: 3 })).status, 200);
    assert.equal((await a.post('/api/today/cap', { class_id: cls.id, energy_cap: 99 })).status, 400);
    const quests = srv.app.db.prepare("SELECT COUNT(*) AS n FROM txns WHERE kind = 'today.quest'").get().n;
    assert.equal(quests, 2);
    assert.equal(srv.app.ledger.audit().ok, true);
  } finally { await srv.cleanup(); }
});

test('the life stage errand (5b): "Set your retirement age" from Stage B until it is set, done by its fact', async () => {
  const w = await world();
  try {
    const [u] = w.users;
    w.post('jobs', '/pick', { job_id: w.firstJob() }, u);                             // not jobless (that nudge is alone on the card)
    const open = () => w.card(u).errands.find((e) => e.title === 'Set your retirement age');
    assert.equal(open(), undefined, 'Stage A: not offered');
    w.app.db.prepare('UPDATE worlds SET month = 168 WHERE id = ?').run(w.app.world.current().id);
    w.advance();                                                                       // month 169: age 36, Stage B, a new class day
    assert.equal(open()?.status, 'open');
    w.post('life', '/retire', { retire_age: 67 }, u);
    assert.equal(open().status, 'done');
  } finally { w.cleanup(); }
});
