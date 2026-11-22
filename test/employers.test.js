// 6c student employers (docs/phase6-roles.md §3 "As built (6c employers)"): a company job is part-time ON TOP of the catalogue job (2 at most,
// 40 h in all, one stub per source and month, one module.jobs.paid), posting slots, the wage floor x the price index, payroll from the treasury
// once a month and its misses (one feed item a month), the feed items, the missed-payroll flag, retirement ending every job, and the season close.
// A bare app with route handlers called directly (no HTTP), so the file stays quick.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createApp } from '../lib/app.js';
import { createClock } from '../lib/clock.js';
import { tmpDir } from './helpers.js';
import { monthOfAge } from '../modules/life/stages.js';
import { flags } from '../modules/leaderboards/flags.js';

const BASE = JSON.parse(fs.readFileSync(new URL('../config/vdaa.json', import.meta.url), 'utf8'));
const made = [];
after(() => { for (const d of made) fs.rmSync(d, { recursive: true, force: true }); });
const PLAN = 'We sell drip coffee to students before class at about four dollars; break-even is 60 cups a month.';

// ft30 founders (class 1) and ft10 employees (class 2), both the world teacher's. Rent off: the money checks are to the cent.
async function world({ ft30 = 2, ft10 = 2, ventures = {} } = {}) {
  const config = structuredClone(BASE);
  for (const c of Object.values(config.courses)) c.modules = ['bank-basic', 'jobs', 'stress', 'ventures', 'leaderboards', 'life', 'feed'];
  config.options['bank-basic'].startCents = 500000;
  config.options.ventures = { rentCents: 0, ...ventures };
  const dataDir = tmpDir();
  made.push(dataDir);
  let t = Date.parse('2026-11-02T15:00:00Z');
  const app = await createApp({ dataDir, config, clock: createClock({ now: () => t }) });
  app.world.create();
  const tid = await app.players.createTeacher({ username: 'teacherA', passphrase: 'another long passphrase' });
  const teacher = { id: tid, username: 'teacherA', role: 'teacher', world_teacher: 1 };
  const make = async (course, count, name) => {
    const cls = app.players.createClass({ name, course, teacherId: tid });
    const ids = await app.players.createStudents({ classId: cls.id, count, hash: false });
    for (const s of ids) app.modules.onLogin({ ...s, class_id: cls.id }, course);
    return ids.map((s) => ({ id: s.id, username: s.username, role: 'student', class_id: cls.id }));
  };
  const founders = await make('fintech2030', ft30, 'FT30 block'), kids = await make('fintech10', ft10, 'FT10 block');
  app.db.prepare("INSERT OR IGNORE INTO ventures_secrets (world_id, secret) VALUES (?, 'test-secret')").run(app.world.current().id);
  const handler = (mod, method, p) => app.modules.routes().find((r) => r.module === mod && r.method === method && r.path === p).handler;
  const get = (mod, p, user) => handler(mod, 'GET', p)({ user, body: {}, params: {}, url: new URL('http://t/') });
  const post = (mod, p, body, user) => handler(mod, 'POST', p)({ user, body, params: {}, url: new URL('http://t/') });
  const status = (fn) => { try { fn(); return 200; } catch (e) { return e.status ?? 500; } };
  const advance = (months = 1) => { t += 60_000; return app.world.advance({ months }); };
  const one = (sql, ...a) => app.db.prepare(sql).get(...a);
  const treasury = (id) => app.ledger.balance(app.ledger.accountId('business', id, 'treasury'));
  const chq = (u) => app.ledger.balance(app.ledger.accountId('player', u.id, 'chequing'));
  const audit = () => { const r = app.ledger.audit(); assert.equal(r.ok, true, JSON.stringify(r.problems)); };
  const found = (lead, mate, name, capital = 50000) => {
    const { id } = post('ventures', '/register', { name, sector: 'Food and drink', plan: PLAN, cofounders: mate.username }, lead);
    post('ventures', '/respond', { id, accept: true }, mate);
    post('ventures', '/approve', { id, approve: true }, teacher);
    for (const s of [lead, mate]) post('ventures', '/capital', { id, cents: capital }, s);
    return id;
  };
  const postJob = (lead, id, { title = 'Barista', hourly = 1600, hours = 10, slots } = {}) => post('ventures', '/post-job', { id, title, hourly_cents: hourly, hours, slots }, lead).posting_id;
  const apply = (kid, postingId) => post('ventures', '/apply', { posting_id: postingId }, kid).application_id;
  const hire = (lead, id, appId) => post('ventures', '/hire', { id, application_id: appId, approve: true }, lead);
  return { app, teacher, founders, kids, get, post, status, advance, one, treasury, chq, audit, found, postJob, apply, hire, jumpTo: (m) => app.db.prepare('UPDATE worlds SET month = ? WHERE id = ?').run(m, app.world.current().id), close: () => app.db.close() };
}

test('on top: a company job never touches the catalogue job; 2 company jobs and 40 hours at most, one per company; one stub per source and month; ONE module.jobs.paid with the month\'s totals', async () => {
  const w = await world({ ft30: 6, ft10: 1 });
  try {
    const [l1, m1, l2, m2, l3, m3] = w.founders, [kid] = w.kids;
    const [a, b, c] = [w.found(l1, m1, 'Alpha Cafe'), w.found(l2, m2, 'Beta Beans'), w.found(l3, m3, 'Gamma Grind')];
    w.post('jobs', '/pick', { job_id: 4 }, kid);
    w.hire(l1, a, w.apply(kid, w.postJob(l1, a, { hours: 25 })));
    assert.equal(w.one('SELECT job_id FROM jobs_holdings WHERE player_id = ?', kid.id).job_id, 4, 'the catalogue job is untouched');
    assert.equal(w.status(() => w.hire(l2, b, w.apply(kid, w.postJob(l2, b, { hours: 20 })))), 409, '25 + 20 is over 40 hours');
    assert.equal(w.status(() => w.hire(l1, a, w.apply(kid, w.postJob(l1, a, { title: 'Second shift', hours: 10 })))), 409, 'one job per company');
    w.hire(l2, b, w.apply(kid, w.postJob(l2, b, { title: 'Roaster', hourly: 1700, hours: 15 })));
    assert.equal(w.status(() => w.hire(l3, c, w.apply(kid, w.postJob(l3, c, { hours: 10 })))), 409, 'two company jobs at most (and 40 hours)');
    const cat = w.get('jobs', '/catalogue', kid);
    assert.deepEqual([cat.current.title, cat.business.map((x) => x.employer), cat.business_room], ['Retail associate', ['Alpha Cafe', 'Beta Beans'], { jobs_left: 0, hours_left: 0, max_jobs: 2, max_hours: 40 }]);
    const paid = [];
    const off = w.app.events.on('module.jobs.paid', (p) => { if (p.playerId === kid.id) paid.push(p); });
    w.advance();
    off();
    const stubs = w.app.db.prepare('SELECT business_id, gross, net FROM jobs_paystubs WHERE player_id = ? AND month = 2 ORDER BY id').all(kid.id);
    assert.deepEqual(stubs.map((s) => s.business_id), [null, a, b], 'the catalogue stub, then one per company');
    assert.deepEqual(stubs.slice(1).map((s) => s.gross), [1600 * 25, 1700 * 15]);
    assert.deepEqual(paid.map((p) => [p.month, p.gross, p.net]), [[2, stubs.reduce((t, s) => t + s.gross, 0), stubs.reduce((t, s) => t + s.net, 0)]], 'one paid event, the month\'s totals');
    assert.throws(() => w.app.db.prepare("INSERT INTO jobs_paystubs (player_id, world_id, month, job_id, business_id, gross, cpp, cpp2, ei, federal_tax, alberta_tax, net, ytd_json, txn_id) SELECT player_id, world_id, month, job_id, business_id, gross, cpp, cpp2, ei, federal_tax, alberta_tax, net, ytd_json, txn_id FROM jobs_paystubs WHERE player_id = ? AND month = 2 AND business_id = ?").run(kid.id, a), /UNIQUE/, 'one stub per source and month');
    // quitting the catalogue job leaves the company jobs; quitting a company job leaves the rest
    w.post('jobs', '/quit', {}, kid);
    assert.equal(w.get('jobs', '/catalogue', kid).business.length, 2);
    w.post('jobs', '/quit-business', { business_id: a }, kid);
    assert.deepEqual(w.get('jobs', '/catalogue', kid).business.map((x) => x.employer), ['Beta Beans']);
    w.advance();
    assert.deepEqual(w.app.db.prepare('SELECT business_id FROM jobs_paystubs WHERE player_id = ? AND month = 3').all(kid.id).map((s) => s.business_id), [b]);
    w.audit();
  } finally { w.close(); }
});

test('slots and the wage floor: a 2-place posting closes when filled (the other applicants are told); the floor is options.ventures.minWageCents x the price index, at posting and at hire', async () => {
  const w = await world({ ft10: 3, ventures: { minWageCents: 1600 } });
  try {
    const [lead, mate] = w.founders, [k1, k2, k3] = w.kids;
    const id = w.found(lead, mate, 'Slot Machine Cafe');
    const setIndex = (bp) => w.app.db.prepare('INSERT INTO price_index (world_id, index_bp) VALUES (?, ?) ON CONFLICT (world_id) DO UPDATE SET index_bp = excluded.index_bp').run(w.app.world.current().id, bp);
    setIndex(11000);
    assert.equal(w.get('ventures', '/openings', k1).min_wage_cents, 1760, '$16.00 (the option) x 1.10');
    assert.equal(w.status(() => w.postJob(lead, id, { hourly: 1759 })), 400);
    assert.equal(w.status(() => w.postJob(lead, id, { hourly: 1760, slots: 6 })), 400, '1 to 5 places');
    const p = w.postJob(lead, id, { hourly: 1760, slots: 2 });
    const apps = [k1, k2, k3].map((k) => w.apply(k, p));
    assert.deepEqual(w.get('ventures', '/openings', k1).openings.map((o) => [o.slots, o.filled]), [[2, 0]]);
    w.hire(lead, id, apps[0]);
    assert.deepEqual(w.get('ventures', '/openings', k1).openings.map((o) => [o.slots, o.filled]), [[2, 1]]);
    setIndex(12000);                                                          // prices rose after posting: $19.20 now
    assert.equal(w.status(() => w.hire(lead, id, apps[1])), 409, 'under today\'s floor');
    setIndex(11000);
    w.hire(lead, id, apps[1]);
    assert.equal(w.one('SELECT open FROM ventures_postings WHERE id = ?', p).open, 0, 'filled: closed');
    assert.equal(w.one('SELECT status FROM ventures_applications WHERE id = ?', apps[2]).status, 'withdrawn');
    assert.deepEqual(w.get('ventures', '/openings', k3).openings, []);
    assert.equal(w.get('ventures', '/teach', w.teacher).classes[0].companies[0].staff, 2);
    w.audit();
  } finally { w.close(); }
});

test('payroll: treasury -> chequing + sink once a month, balanced; a short treasury skips (reputation, unpaid notice) with ONE "Missed payroll" feed item a month; hired and laid-off feed items; the missed-payroll flag', async () => {
  const w = await world({ ft10: 2 });
  try {
    const [lead, mate] = w.founders, [k1, k2] = w.kids;
    const id = w.found(lead, mate, 'Payday Pantry');
    const p = w.postJob(lead, id, { hourly: 1750, hours: 10, slots: 2 });
    for (const k of [k1, k2]) w.hire(lead, id, w.apply(k, p));
    const feed = (u) => w.get('feed', '/class', u).items.map((i) => i.text);
    assert.ok(feed(lead).includes(`${lead.username} hired ${k1.username} at $17.50/h`), JSON.stringify(feed(lead)));
    assert.ok(feed(k2).includes(`${lead.username} hired ${k2.username} at $17.50/h`), 'the employee\'s class sees it too (another class)');
    const t0 = w.treasury(id);
    w.advance();
    const pays = w.app.db.prepare("SELECT t.id FROM txns t WHERE t.kind = 'ventures.payroll'").all();
    assert.equal(pays.length, 2, 'one pay per employee per month');
    const stubs = w.app.db.prepare('SELECT gross FROM jobs_paystubs WHERE business_id = ? AND month = 2').all(id);
    const employer = w.one('SELECT SUM(employer_cents) AS n FROM ventures_flows WHERE company_id = ?', id).n;
    assert.equal(t0 - w.treasury(id), stubs.reduce((t, s) => t + s.gross, 0) + employer);
    w.audit();
    // drain the treasury (a test stand-in for spending it, booked as a distribution so the books balance): both pays are missed
    const cash = w.treasury(id);
    w.app.ledger.post({ kind: 'test.drain', legs: [{ account: w.app.ledger.accountId('business', id, 'treasury'), cents: -cash }, { account: w.app.ledger.system('sink'), cents: cash }] });
    w.app.db.prepare('INSERT INTO ventures_flows (company_id, product_id, month, payout_cents) VALUES (?, 0, 2, ?) ON CONFLICT (company_id, product_id, month) DO UPDATE SET payout_cents = payout_cents + excluded.payout_cents').run(id, cash);
    const unpaid = [];
    const off = w.app.events.on('module.jobs.unpaid', (e) => unpaid.push(e.playerId));
    const rep0 = w.one('SELECT rep_bp FROM ventures_companies WHERE id = ?', id).rep_bp;
    w.advance();
    off();
    assert.deepEqual(unpaid.sort(), [k1.id, k2.id].sort());
    assert.equal(w.one('SELECT COUNT(*) AS n FROM jobs_paystubs WHERE business_id = ? AND month = 3', id).n, 0);
    assert.equal(w.one('SELECT rep_bp FROM ventures_companies WHERE id = ?', id).rep_bp, rep0 - 1000, '-500 per missed pay');
    assert.equal(feed(lead).filter((t) => t === 'Missed payroll at Payday Pantry').length, 1, 'one item for the month, not one per employee');
    w.post('ventures', '/layoff', { id, player_id: k1.id, mode: 'notice' }, lead);
    assert.ok(feed(k1).includes(`${k1.username} was laid off from Payday Pantry`));
    const fl = flags(w.app.modules.kernel('leaderboards'), { worldId: w.app.world.current().id, playerId: lead.id });
    assert.deepEqual(fl.filter((f) => f.key === 'missed_payroll').map((f) => f.detail), ['their company missed 2 pays to its staff']);
    assert.equal(flags(w.app.modules.kernel('leaderboards'), { worldId: w.app.world.current().id, playerId: k1.id }).some((f) => f.key === 'missed_payroll'), false, 'an employee is not flagged');
    w.audit();
  } finally { w.close(); }
});

test('retirement: a retired student cannot apply or be hired; the retirement payday ends the catalogue job AND every company job', async () => {
  const w = await world({ ft10: 2 });
  try {
    const [lead, mate] = w.founders, [kid, old] = w.kids;
    w.jumpTo(monthOfAge(60) - 1);
    w.post('life', '/retire', { retire_age: 60 }, kid);
    w.post('life', '/retire', { retire_age: 60 }, old);
    const id = w.found(lead, mate, 'Golden Years');
    w.post('jobs', '/pick', { job_id: 4 }, kid);
    w.hire(lead, id, w.apply(kid, w.postJob(lead, id, { hours: 10, slots: 2 })));
    w.advance();                                                               // the payday at 60: paid by both, then work stops
    assert.equal(w.app.db.prepare('SELECT COUNT(*) AS n FROM jobs_paystubs WHERE player_id = ? AND month = ?').get(kid.id, monthOfAge(60)).n, 2);
    assert.equal(w.one('SELECT COUNT(*) AS n FROM jobs_holdings WHERE player_id = ?', kid.id).n, 0);
    assert.equal(w.one('SELECT COUNT(*) AS n FROM jobs_business WHERE player_id = ?', kid.id).n, 0, 'the company job ended too');
    assert.equal(w.get('ventures', '/openings', old).retired, true);
    const p = w.postJob(lead, id, { title: 'Greeter' });
    assert.equal(w.status(() => w.apply(old, p)), 409, 'a retired student cannot apply');
    assert.equal(w.status(() => w.app.modules.kernel('ventures').modules.call('jobs', 'hireForBusiness', { playerId: old.id, businessId: id, employer: 'Golden Years', title: 'Greeter', hourlyCents: 1600, hoursPerMonth: 10, month: w.app.world.current().month })), 409, 'nor be hired');
    w.audit();
  } finally { w.close(); }
});

test('season close: company jobs end and the catalogue job stays; postings and applications close; the next world starts with none', async () => {
  const w = await world({ ft10: 2 });
  try {
    const [lead, mate] = w.founders, [kid, k2] = w.kids;
    const id = w.found(lead, mate, 'Last Call Cafe');
    w.post('jobs', '/pick', { job_id: 2 }, kid);
    const p = w.postJob(lead, id, { slots: 2 });
    w.hire(lead, id, w.apply(kid, p));
    const waiting = w.apply(k2, p);
    w.advance();
    w.app.world.close();
    assert.equal(w.one('SELECT COUNT(*) AS n FROM jobs_business').n, 0);
    assert.equal(w.one('SELECT job_id FROM jobs_holdings WHERE player_id = ?', kid.id).job_id, 2);
    assert.equal(w.one('SELECT COUNT(*) AS n FROM ventures_postings WHERE open = 1').n, 0);
    assert.equal(w.one('SELECT status FROM ventures_applications WHERE id = ?', waiting).status, 'withdrawn');
    assert.equal(w.one('SELECT status FROM ventures_companies WHERE id = ?', id).status, 'wound_up');
    w.app.world.create({ name: 'Season 2' });
    assert.deepEqual(w.get('ventures', '/openings', k2).openings, []);
    assert.deepEqual(w.get('jobs', '/catalogue', kid).business, []);
    w.audit();
  } finally { w.close(); }
});

// ---- fixed after review (round 1) ----
const drainTo = (w, id, keep) => {   // a test stand-in for spending the treasury, booked as a distribution so the books still balance
  const cash = w.treasury(id) - keep;
  w.app.ledger.post({ kind: 'test.drain', legs: [{ account: w.app.ledger.accountId('business', id, 'treasury'), cents: -cash }, { account: w.app.ledger.system('sink'), cents: cash }] });
  w.app.db.prepare('INSERT INTO ventures_flows (company_id, product_id, month, payout_cents) VALUES (?, 0, ?, ?) ON CONFLICT (company_id, product_id, month) DO UPDATE SET payout_cents = payout_cents + excluded.payout_cents').run(id, w.app.world.current().month, cash);
};

test('review 1: owners are paid only from equity (never from a Venture Bank loan); a non-owner is paid as before; the wage ceiling; a loan left at season close is written off', async () => {
  const w = await world({ ft30: 4, ft10: 1 });
  try {
    const [lead, mate, l2, m2] = w.founders, [kid] = w.kids;
    const id = w.found(lead, mate, 'Loan Shark Cafe', 10000);                           // $100 each
    assert.equal(w.status(() => w.postJob(lead, id, { hourly: 15001, hours: 40 })), 400, 'over $150.00 an hour');
    assert.equal(w.post('ventures', '/borrow', { id, cents: 500000, term: 12 }, lead).ok, true);
    const p = w.postJob(lead, id, { hourly: 6000, hours: 40, slots: 3 });
    for (const s of [lead, mate, kid]) w.hire(lead, id, w.apply(s, p));
    const [c1, c2] = [w.chq(lead), w.chq(mate)];
    w.advance();
    assert.deepEqual([w.chq(lead), w.chq(mate)], [c1, c2], 'the founders took nothing from the borrowed treasury');
    assert.deepEqual(w.app.db.prepare('SELECT player_id FROM jobs_paystubs WHERE business_id = ?').all(id).map((r) => r.player_id), [kid.id], 'the non-owner employee is paid');
    assert.equal(w.one('SELECT missed_paydays FROM ventures_companies WHERE id = ?', id).missed_paydays, 2);
    assert.match(w.get('jobs', '/catalogue', lead).business[0].note, /could not make payroll/);
    // an owner IS paid when equity covers it: a company with no debt and enough cash
    const id2 = w.found(l2, m2, 'Equity Espresso', 100000);
    w.hire(l2, id2, w.apply(l2, w.postJob(l2, id2, { hours: 10 })));
    const c3 = w.chq(l2);
    w.advance();
    assert.ok(w.chq(l2) > c3, 'paid from equity');
    // season close: the loan the treasury cannot cover is written off (a gain), not recorded as settled
    drainTo(w, id, 1000);
    const owed = -w.app.ledger.balance(w.app.ledger.accountId('business', id, 'loan'));
    w.app.world.close();
    const loan = w.one('SELECT status FROM ventures_loans WHERE company_id = ?', id);
    assert.equal(loan.status, 'written_off');
    assert.equal(w.one('SELECT SUM(forgiven_cents) AS n FROM ventures_flows WHERE company_id = ?', id).n, owed - 1000);
    w.audit();
  } finally { w.close(); }
});

test('review 2: a bot company closes postings under today\'s wage (or at other hours) and posts again at the price index 1.20', async () => {
  const w = await world({ ft30: 2, ft10: 6 });
  try {
    const [lead, mate] = w.founders;
    const id = w.found(lead, mate, 'Bot Venture 1', 300000);
    const wid = w.app.world.current().id;
    const stale = [w.postJob(lead, id, { hourly: 1600, hours: 40 }), w.postJob(lead, id, { hourly: 1600, hours: 20 }), w.postJob(lead, id, { hourly: 1600, hours: 10 })];
    w.app.db.prepare('INSERT INTO price_index (world_id, index_bp) VALUES (?, 12000) ON CONFLICT (world_id) DO UPDATE SET index_bp = 12000').run(wid);
    for (const m of [1, 2, 3]) w.app.db.prepare('INSERT INTO ventures_statements (company_id, month, data, revenue_cents, net_cents) VALUES (?, ?, ?, 300000, 300000)').run(id, m, '{}');
    const students = w.app.db.prepare("SELECT p.id, p.class_id, c.course_id FROM players p JOIN classes c ON c.id = p.class_id WHERE p.role = 'student'").all();
    w.app.modules.simulate({ month: w.app.world.current().month, students });
    assert.deepEqual(stale.map((s) => w.one('SELECT open FROM ventures_postings WHERE id = ?', s).open), [0, 0, 0], 'the stale postings are closed');
    const fresh = w.app.db.prepare('SELECT hourly_cents, hours FROM ventures_postings WHERE company_id = ? AND id > ?').all(id, stale[2]);
    assert.ok(fresh.length >= 1 && fresh.every((x) => x.hourly_cents >= 1800 && x.hours === 40), JSON.stringify(fresh));
    assert.equal(w.one('SELECT COUNT(*) AS n FROM jobs_business WHERE business_id = ?', id).n, 1, 'and a bot is hired');
  } finally { w.close(); }
});

test('review 3, 4, 6: a second pay in lieu in one month is a 409 (not a 500); job titles lose control characters and pass the blocklist; a company job alone counts as a job', async () => {
  const w = await world({ ft10: 1 });
  try {
    const [lead, mate] = w.founders, [kid] = w.kids;
    const id = w.found(lead, mate, 'Twice Shy', 100000);
    assert.equal(w.status(() => w.postJob(lead, id, { title: 'Kill floor' })), 400, 'the blocklist');
    const p = w.postJob(lead, id, { title: 'Bar\u0007ista\nlead', slots: 2 });
    assert.equal(w.one('SELECT title FROM ventures_postings WHERE id = ?', p).title, 'Bar ista lead');
    w.hire(lead, id, w.apply(kid, p));
    const facts = () => w.app.modules.kernel('stress').modules.call('jobs', 'todayFacts', { playerId: kid.id });
    assert.deepEqual([facts().hasJob, facts().hasCompanyJob], [true, true], 'no catalogue job, one company job: has a job');
    w.post('ventures', '/layoff', { id, player_id: kid.id, mode: 'severance' }, lead);
    assert.deepEqual([facts().hasJob, facts().hasCompanyJob], [false, false]);
    w.hire(lead, id, w.apply(kid, p));
    assert.equal(w.status(() => w.post('ventures', '/layoff', { id, player_id: kid.id, mode: 'severance' }, lead)), 409);
    w.audit();
  } finally { w.close(); }
});
