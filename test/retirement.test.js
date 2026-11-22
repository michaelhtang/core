// retirement (docs/phase5-life.md 5c): CPP and OAS factors, contribution-years scaling, the RRIF minimum, the OAS recovery tax, the draw plan's order and
// shortfall, the deterministic projection; then a world jumped to the edge of Stage C with seeded pay stubs and funded accounts: pensions from their ages,
// draws once retired, a 12-month advance paying every month once, the year-end settlement through annualIncomeTax, the health part and award, routes and
// teacher B, and a season close that carries nothing.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createApp } from '../lib/app.js';
import { createClock } from '../lib/clock.js';
import { tmpDir } from './helpers.js';
import { monthOfAge } from '../modules/life/stages.js';
import { annualIncomeTax, oasRecoveryTax, OAS_RECOVERY_THRESHOLD, YMPE, CPP_EXEMPTION_ANNUAL } from '../modules/jobs/payroll.js';
import { cppFactorBp, oasFactorBp, contributedBp, cpp65, cppBase, oasBase, rrifMonthlyMin, pensionWithholding, allocate, check, lastsUntil } from '../modules/retirement/calc.js';
import { CPP_MAX_65_CENTS, OAS_65_CENTS } from '../modules/retirement/constants.js';
import { healthParts, healthScore } from '../modules/leaderboards/health.js';

const CONFIG = JSON.parse(fs.readFileSync(new URL('../config/vdaa.json', import.meta.url), 'utf8'));
const made = [];
after(() => { for (const d of made) fs.rmSync(d, { recursive: true, force: true }); });

test('CPP: -0.6% a month before 65, +0.7% after; scaled by years of full contributions out of 39, capped at the maximum', () => {
  assert.deepEqual([60, 62, 65, 67, 70].map(cppFactorBp), [6400, 7840, 10000, 11680, 14200]);
  // a world year as jobs.cppHistory returns it: gross pay that year and the YMPE / exemption x that year's index
  const yr = (gross, idx = 10000) => ({ gross_cents: gross, ympe_cents: Math.round((YMPE * idx) / 10000), exemption_cents: Math.round((CPP_EXEMPTION_ANNUAL * idx) / 10000) });
  const full = (n, gross = YMPE) => Array.from({ length: n }, () => yr(gross));
  assert.equal(contributedBp(full(39)), 390000);
  assert.equal(cpp65(contributedBp(full(39))), CPP_MAX_65_CENTS);
  assert.equal(cpp65(contributedBp(full(45))), CPP_MAX_65_CENTS, '45 years: still the maximum');
  assert.equal(cpp65(contributedBp(full(39, 2 * YMPE))), CPP_MAX_65_CENTS, 'pay over the YMPE counts as one full year');
  assert.equal(cpp65(contributedBp(full(13))), Math.floor(CPP_MAX_65_CENTS / 3), '13 of 39 years: a third');
  const half = CPP_EXEMPTION_ANNUAL + (YMPE - CPP_EXEMPTION_ANNUAL) / 2;
  assert.equal(contributedBp(full(39, half)), 39 * 5000, 'half the pensionable earnings every year: half');
  // review 5: wages rise with the price index, so a year is compared with ITS indexed YMPE: a 60%-of-YMPE worker counts the same at index 1.0 and 1.7
  assert.equal(contributedBp([yr(Math.round(0.6 * YMPE), 10000)]), contributedBp([yr(Math.round(0.6 * YMPE * 1.7), 17000)]));
  assert.ok(contributedBp([yr(Math.round(0.6 * YMPE * 1.7), 17000)]) < 6000, 'not a full year at index 1.7');
  assert.equal(cpp65(0), 0);
  assert.equal(cppBase(390000, 60), Math.round(CPP_MAX_65_CENTS * 0.64));
  assert.equal(cppBase(390000, 70), Math.round(CPP_MAX_65_CENTS * 1.42));
});

test('OAS: +0.6% a month after 65 (36% at 70); the recovery tax is 15% above the threshold, never more than the OAS', () => {
  assert.deepEqual([65, 66, 70].map(oasFactorBp), [10000, 10720, 13600]);
  assert.equal(oasBase(65), OAS_65_CENTS);
  assert.equal(oasBase(70), Math.round(OAS_65_CENTS * 1.36));
  assert.equal(oasRecoveryTax(OAS_RECOVERY_THRESHOLD, 900000), 0);
  assert.equal(oasRecoveryTax(OAS_RECOVERY_THRESHOLD + 1000000, 900000), 150000, '15% of $10,000 over');
  assert.equal(oasRecoveryTax(OAS_RECOVERY_THRESHOLD + 100000000, 900000), 900000, 'capped at the OAS received');
  assert.equal(oasRecoveryTax(12000000, 900000, 20000000), 0, 'an indexed (higher) threshold');
});

test('RRIF minimum: value / (90 - age) a year, a twelfth a month; the withholding on pensions is the annual tax over twelve', () => {
  assert.equal(rrifMonthlyMin(30000000, 65), Math.ceil(30000000 / (25 * 12)));   // 4% a year at 65
  assert.equal(rrifMonthlyMin(30000000, 70), Math.ceil(30000000 / (20 * 12)));   // 5% at 70
  assert.equal(rrifMonthlyMin(30000000, 55), Math.ceil(30000000 / (35 * 12)));
  assert.equal(rrifMonthlyMin(0, 65), 0);
  assert.equal(pensionWithholding(0), 0);
  assert.equal(pensionWithholding(200000), Math.round(annualIncomeTax(2400000, 0) / 12));
  assert.ok(pensionWithholding(200000) > 0 && pensionWithholding(200000) < 40000);
});

test('the draw plan takes from the accounts in order, each until it runs out; the shortfall shows; the check and the projection', () => {
  const pots = { rrsp: { cents: 50000, rate_bp: 500 }, invest: { cents: 0, rate_bp: 0 }, hisa: { cents: 30000, rate_bp: 200 }, tfsa: { cents: 100000, rate_bp: 600 } };
  assert.deepEqual(allocate(100000, pots, ['rrsp', 'invest', 'hisa', 'tfsa']), { rrsp: 50000, hisa: 30000, tfsa: 20000 });
  assert.deepEqual(allocate(100000, pots, ['tfsa', 'rrsp', 'invest', 'hisa']), { tfsa: 100000 });
  assert.deepEqual(allocate(500000, pots, ['rrsp', 'invest', 'hisa', 'tfsa']), { rrsp: 50000, hisa: 30000, tfsa: 100000 }, 'everything there is, no more');
  const c = check({ cpp: 150000, oas: 76000, planCents: 100000, billsCents: 400000, pots, order: ['tfsa', 'rrsp', 'invest', 'hisa'] });
  assert.equal(c.tax_cents, Math.round(annualIncomeTax(12 * 226000, 0) / 12), 'TFSA draws are not taxed');
  assert.equal(c.income_cents, 326000 - c.tax_cents);
  assert.equal(c.covered, false);
  assert.equal(c.shortfall_cents, 400000 - c.income_cents);
  assert.equal(c.coverage_pct, Math.floor((100 * c.income_cents) / 400000));
  const r = check({ cpp: 150000, oas: 76000, planCents: 100000, billsCents: 400000, pots, order: ['rrsp', 'tfsa', 'invest', 'hisa'] });
  assert.ok(r.tax_cents > c.tax_cents, 'RRSP/RRIF draws are taxed');
  assert.equal(check({ cpp: 0, oas: 0, planCents: 0, billsCents: 0, pots, order: ['rrsp'] }).coverage_pct, 100);
  const m = check({ cpp: 0, oas: 0, planCents: 0, billsCents: 100000, pots, order: ['tfsa'], rrifMinCents: 60000 });
  assert.equal(m.alloc.rrsp, 50000, 'the RRIF minimum is drawn even with no plan, up to what the RRIF holds');

  const base = { age: 60, offset: 0, retireAge: 60, cppAge: 65, oasAge: 65, cpp: 150000, oas: 76000, planCents: 0, billsCents: 300000, order: ['rrsp', 'invest', 'hisa', 'tfsa'] };
  const rich = { rrsp: { cents: 50_000_000, rate_bp: 400 }, invest: { cents: 0, rate_bp: 0 }, hisa: { cents: 0, rate_bp: 0 }, tfsa: { cents: 20_000_000, rate_bp: 400 } };
  const poor = { rrsp: { cents: 3_000_000, rate_bp: 400 }, invest: { cents: 0, rate_bp: 0 }, hisa: { cents: 0, rate_bp: 0 }, tfsa: { cents: 0, rate_bp: 0 } };
  const a1 = lastsUntil({ ...base, pots: rich }), a2 = lastsUntil({ ...base, pots: rich });
  assert.equal(a1, a2, 'deterministic');
  assert.equal(a1, 100, 'a large RRSP and TFSA last past 100');
  const p = lastsUntil({ ...base, pots: poor });
  assert.ok(p >= 60 && p < 65, `$30,000 covering the whole bill from 60 runs out before the pensions start (got ${p})`);
  assert.equal(lastsUntil({ ...base, pots: poor, retireAge: 70 }) > p, true, 'retiring later: the same savings last longer');
  assert.equal(lastsUntil({ ...base, pots: poor, planCents: 0, billsCents: 0 }), 100, 'nothing to draw: they last');
});

test('Stage C health: coverage replaces the debt load, still five parts with calm', () => {
  const s = { saved: 0, netPay: 0, gross: 0, ontime: 1, late: 0, score: 700, cardOwed: 0, mortgagePayment: 0, stress: 10 };
  assert.deepEqual(Object.keys(healthParts(s)), ['cushion', 'on_time', 'credit', 'load', 'calm']);
  const c = healthParts({ ...s, coverage: 64 });
  assert.deepEqual(Object.keys(c), ['cushion', 'on_time', 'credit', 'coverage', 'calm']);
  assert.equal(c.coverage, 64);
  assert.equal(healthScore(c), Math.round((c.cushion + c.on_time + c.credit + 64 + c.calm) / 5));
});

// A bare app on a hand-set clock with one fintech10 class of n students (as test/life.test.js).
async function world({ n = 1, config = CONFIG } = {}) {
  const dataDir = tmpDir();
  made.push(dataDir);
  let t = Date.parse('2026-11-02T15:00:00Z');
  const app = await createApp({ dataDir, config, clock: createClock({ now: () => t }) });
  app.world.create();
  const cls = app.players.createClass({ name: 'Block 1', course: 'fintech10' });
  const ids = await app.players.createStudents({ classId: cls.id, count: n, hash: false });
  for (const s of ids) app.modules.onLogin({ ...s, class_id: cls.id }, 'fintech10');
  const users = ids.map((s) => ({ id: s.id, username: s.username, role: 'student', class_id: cls.id }));
  const handler = (mod, method, p) => app.modules.routes().find((r) => r.module === mod && r.method === method && r.path === p).handler;
  const get = (mod, p, user) => handler(mod, 'GET', p)({ user, body: {}, params: {}, url: new URL('http://t/') });
  const post = (mod, p, body, user) => handler(mod, 'POST', p)({ user, body, params: {}, url: new URL('http://t/') });
  const audit = () => { const r = app.ledger.audit(); assert.equal(r.ok, true, JSON.stringify(r.problems)); };
  const advance = (months) => { t += 60_000; const r = app.world.advance(months === undefined ? {} : { months }); audit(); return r; };
  const jumpTo = (month) => app.db.prepare('UPDATE worlds SET month = ? WHERE id = ?').run(month, app.world.current().id);   // skip ahead without ticks
  const wid = () => app.world.current().id;
  const acct = (id, kind) => app.ledger.openAccount({ ownerType: 'player', ownerId: id, kind });
  const bal = (id, kind) => app.ledger.balance(acct(id, kind));
  const grant = (id, kind, cents) => app.ledger.post({ kind: 'test.grant', legs: [{ account: app.ledger.system('mint'), cents: -cents }, { account: acct(id, kind), cents }] });
  // One pay stub a year (month 12y) with `gross` (default: the YMPE, a full year) and some CPP withheld, for `years` world years (no jobs_year_index row: index 1.0).
  const stubs = (id, years, gross = YMPE) => {
    const txn = app.db.prepare('SELECT id FROM txns ORDER BY id LIMIT 1').get().id, job = app.db.prepare('SELECT id FROM jobs_catalogue ORDER BY id LIMIT 1').get().id;
    const ins = app.db.prepare("INSERT INTO jobs_paystubs (player_id, world_id, month, job_id, gross, cpp, cpp2, ei, federal_tax, alberta_tax, net, ytd_json, txn_id) VALUES (?, ?, ?, ?, ?, 1, 0, 0, 0, 0, 0, '{}', ?)");
    for (let y = 1; y <= years; y++) ins.run(id, wid(), 12 * y, job, gross, txn);
  };
  const kinds = (id, kind) => app.db.prepare('SELECT COUNT(*) AS n, COALESCE(SUM(e.amount_cents), 0) AS cents FROM entries e JOIN txns t ON t.id = e.txn_id WHERE e.account_id = ? AND t.kind = ?').get(acct(id, 'chequing'), kind);
  return { app, cls, users, get, post, advance, jumpTo, wid, acct, bal, grant, stubs, kinds, audit, close: () => app.db.close() };
}

test('a life at the edge of Stage C: CPP early and on time, OAS deferred, draws in plan order with a shortfall, every month paid once in a 12-month advance, the year-end tax', async () => {
  const w = await world({ n: 4 });
  const [a, b, c, d] = w.users;
  try {
    w.stubs(a.id, 39);                                                   // the maximum
    w.stubs(b.id, 13);                                                   // a third of it
    w.stubs(d.id, 39);
    assert.throws(() => w.post('retirement', '/rrif', {}, a), (e) => e.status === 409, 'a RRIF from 55 only');
    // d takes CPP at 60
    w.jumpTo(monthOfAge(60) - 1);                                                 // age 59
    assert.throws(() => w.post('retirement', '/cpp', { age: 59 }, d), (e) => e.status === 400);
    assert.equal(w.post('retirement', '/cpp', { age: 60 }, d).cpp.age, 60);
    w.advance();                                                                  // month 457, age 60
    const idx = w.app.world.priceIndex();
    const dCpp = Math.round((cppBase(390000, 60) * idx) / 10000);
    assert.equal(w.kinds(d.id, 'retirement.cpp').n, 1);
    const row = w.app.db.prepare('SELECT * FROM retirement_income WHERE player_id = ? AND world_id = ?').get(d.id, w.wid());
    assert.equal(row.cpp_cents, dCpp, 'CPP at 60: 64% of the maximum, x the price index');
    assert.equal(row.withheld_cents, pensionWithholding(dCpp));
    assert.equal(w.kinds(d.id, 'retirement.cpp').cents, dCpp - row.withheld_cents, 'net to chequing');
    assert.equal(w.kinds(a.id, 'retirement.cpp').n, 0, 'nothing before the chosen age');
    assert.throws(() => w.post('retirement', '/cpp', { age: 65 }, d), (e) => e.status === 409, 'started: it can no longer change');

    // a, b, c at 64: plans. a: RRIF + a large RRSP/TFSA; b: CPP at 70 and only a small HISA; c: OAS at 70, TFSA only.
    w.jumpTo(monthOfAge(65) - 1);
    w.post('retirement', '/rrif', {}, a);
    assert.throws(() => w.post('retirement', '/rrif', {}, a), (e) => e.status === 409);
    w.grant(a.id, 'rrsp', 40_000_000); w.grant(a.id, 'tfsa', 10_000_000);
    w.post('exchange', '/order', { ticker: 'DAAX', account: 'rrsp', side: 'buy', type: 'market', cents: 20_000_000 }, a);   // half the RRSP in the index fund
    w.post('retirement', '/plan', { monthly_cents: 1_000_000, order: ['rrsp', 'invest', 'hisa', 'tfsa'] }, a);              // $10,000 a month: over the OAS threshold
    assert.equal(w.post('retirement', '/cpp', { age: 70 }, b).cpp.age, 70);
    w.grant(b.id, 'hisa', 300_000);
    w.post('retirement', '/plan', { monthly_cents: 200_000, order: ['hisa', 'rrsp', 'invest', 'tfsa'] }, b);
    assert.equal(w.post('retirement', '/oas', { age: 70 }, c).oas.age, 70);
    assert.throws(() => w.post('retirement', '/oas', { age: 64 }, c), (e) => e.status === 400);
    w.grant(c.id, 'tfsa', 1_000_000);
    w.post('retirement', '/plan', { monthly_cents: 100_000, order: ['tfsa', 'rrsp', 'invest', 'hisa'] }, c);
    for (const bad of [{ monthly_cents: -1, order: ['rrsp', 'invest', 'hisa', 'tfsa'] }, { monthly_cents: 1, order: ['rrsp', 'rrsp', 'hisa', 'tfsa'] }, { monthly_cents: 1, order: ['rrsp'] }, { monthly_cents: 1, order: 'rrsp' }]) {
      assert.throws(() => w.post('retirement', '/plan', bad, c), (e) => e.status === 400, JSON.stringify(bad));
    }

    w.advance();                                                                  // month 517: age 65, everyone retires (the default age)
    const m = w.app.world.current().month, idx2 = w.app.world.priceIndex();
    const inc = (u, at = m) => w.app.db.prepare('SELECT * FROM retirement_income WHERE player_id = ? AND world_id = ? AND month = ?').get(u.id, w.wid(), at);
    assert.equal(inc(a).cpp_cents, Math.round((CPP_MAX_65_CENTS * idx2) / 10000));
    assert.equal(inc(a).oas_cents, Math.round((OAS_65_CENTS * idx2) / 10000));
    assert.equal(inc(b).cpp_cents, 0, 'b deferred CPP to 70');
    assert.equal(inc(c).oas_cents, 0, 'c deferred OAS to 70');
    assert.equal(inc(c).cpp_cents, Math.round((cpp65(0) * idx2) / 10000), 'no contributions: no CPP');
    assert.equal(inc(a).draw_cents, 1_000_000, 'the plan, from the RRIF first');
    assert.ok(inc(a).draw_withheld_cents > 0, 'RRIF draws are withheld at source');
    assert.equal(inc(b).draw_cents, 200_000);
    assert.equal(inc(c).draw_cents, 100_000);
    assert.equal(inc(c).draw_withheld_cents, 0, 'TFSA draws: no tax');
    assert.equal(w.bal(c.id, 'tfsa'), 900_000);
    assert.equal(w.app.db.prepare('SELECT withdrawn_cents FROM exchange_tfsa WHERE player_id = ? AND world_id = ?').get(c.id, w.wid()).withdrawn_cents, 100_000, 'TFSA room comes back next year');

    const left = w.bal(b.id, 'hisa');                                             // about $1,000 (and a month's interest) of the $2,000 plan
    w.advance();
    assert.ok(left > 100_000 && left < 101_000);
    assert.equal(inc(b, m + 1).draw_cents, left);
    assert.equal(inc(b, m + 1).short_cents, 200_000 - left, 'the shortfall is recorded');
    assert.equal(w.bal(b.id, 'hisa'), 0, 'never below zero');

    // a 12-month class day: every month paid exactly once; the year-end settlement taxes CPP + OAS + RRIF draws through annualIncomeTax, with the OAS recovery tax
    w.app.world.setSettings({ months_per_day: 12 });
    const from = w.app.world.current().month;
    w.advance();
    const to = w.app.world.current().month;
    assert.equal(to, from + 12);
    for (const u of [a, b, c]) assert.equal(w.app.db.prepare('SELECT COUNT(*) AS n FROM retirement_income WHERE player_id = ? AND world_id = ? AND month > ? AND month <= ?').get(u.id, w.wid(), from, to).n, 12, u.username);
    assert.equal(w.kinds(a.id, 'retirement.cpp').n, to - m + 1, 'one CPP payment a month');
    const year = Math.floor((m - 1) / 12) + 1;
    const slip = w.app.db.prepare('SELECT * FROM exchange_settlements WHERE player_id = ? AND world_id = ? AND year = ?').get(a.id, w.wid(), year);
    assert.ok(slip, 'a settled the retirement year');
    const y = w.app.db.prepare('SELECT * FROM retirement_income WHERE player_id = ? AND world_id = ? AND month >= ? AND month < ?').all(a.id, w.wid(), m, m + 12);
    const P = y.reduce((t, r) => t + r.cpp_cents + r.oas_cents, 0), O = y.reduce((t, r) => t + r.oas_cents, 0), W = y.reduce((t, r) => t + r.draw_cents, 0);
    const H = y.reduce((t, r) => t + r.withheld_cents + r.draw_withheld_cents, 0);
    assert.equal(slip.p_cents, P);
    assert.equal(slip.w_cents, W);
    assert.equal(slip.h_cents, H);
    const thr = Math.round((OAS_RECOVERY_THRESHOLD * w.app.world.priceIndex()) / 10000);
    assert.equal(slip.clawback_cents, oasRecoveryTax(W + P, O, thr));
    assert.ok(slip.clawback_cents > 0, '$120,000 of RRIF draws: over the threshold');
    assert.equal(slip.tax_after_cents, annualIncomeTax(W + P, 0) + slip.clawback_cents);
    assert.equal(slip.refund_cents - slip.owing_cents, H - slip.tax_after_cents);
    const cs = w.app.db.prepare('SELECT * FROM exchange_settlements WHERE player_id = ? AND world_id = ? AND year = ?').get(c.id, w.wid(), year);
    assert.equal(cs, undefined, 'c: no CPP (no contributions), OAS deferred, TFSA draws only: no taxable income, nothing to settle');

    // health: the coverage part replaced the debt load; the teacher table; the Today facts
    const snap = JSON.parse(w.app.db.prepare('SELECT parts FROM leaderboards_snapshots WHERE world_id = ? AND player_id = ? ORDER BY month DESC LIMIT 1').get(w.wid(), a.id).parts);
    assert.ok('coverage' in snap && !('load' in snap), JSON.stringify(snap));
    const facts = w.app.modules.kernel('today').modules.call('retirement', 'todayFacts', { playerId: b.id });
    assert.equal(typeof facts.covered, 'boolean');
    assert.ok(Number.isSafeInteger(facts.lastsUntilAge));
    const st = w.get('retirement', '/state', a);
    assert.equal(st.retired, true);
    assert.equal(st.check.lasts_until_age, w.app.modules.kernel('today').modules.call('retirement', 'todayFacts', { playerId: a.id }).lastsUntilAge, 'the same projection');
  } finally { w.close(); }
});

test('work stops and pensions begin: the last pay at 65, CPP from the same month (the stubs counted), no wages after; never twice in a month', async () => {
  const w = await world({ n: 1 });
  try {
    const [u] = w.users;
    w.stubs(u.id, 39);
    w.jumpTo(monthOfAge(65) - 2);
    const job = w.app.db.prepare('SELECT id FROM jobs_catalogue WHERE active = 1 ORDER BY id LIMIT 1').get().id;
    w.post('jobs', '/pick', { job_id: job }, u);
    w.advance(); w.advance();                                                     // 516 (64): paid; 517 (65): the last pay, then CPP and OAS
    const at = (kind) => w.app.db.prepare('SELECT t.meta FROM entries e JOIN txns t ON t.id = e.txn_id WHERE e.account_id = ? AND t.kind = ? ORDER BY t.id').all(w.acct(u.id, 'chequing'), kind).map((r) => JSON.parse(r.meta).month);
    assert.deepEqual(at('jobs.pay'), [516, 517]);
    assert.deepEqual(at('retirement.cpp'), [517]);
    assert.deepEqual(at('retirement.oas'), [517]);
    assert.throws(() => w.post('jobs', '/pick', { job_id: job }, u), (e) => e.status === 409, 'retired: no new job');
    w.advance(3);
    assert.deepEqual(at('jobs.pay'), [516, 517], 'no wages after retirement');
    assert.deepEqual(at('retirement.cpp'), [517, 518, 519, 520]);
    assert.equal(w.app.db.prepare('SELECT cpp_base_cents FROM retirement_plan WHERE player_id = ?').get(u.id).cpp_base_cents, CPP_MAX_65_CENTS, '39 years + the real stubs: still the maximum');
    const yi = w.app.db.prepare('SELECT year, index_bp FROM jobs_year_index WHERE world_id = ? ORDER BY year').all(w.wid());
    assert.deepEqual(yi.map((r) => r.year), [43, 44], 'jobs records the index at each paying year\'s first payday (review 5)');
    assert.ok(kcall(w, 'jobs', 'cppHistory', { playerId: u.id }).years.find((y) => y.year === 44).ympe_cents === Math.round((YMPE * yi[1].index_bp) / 10000));
  } finally { w.close(); }
});

test('bots: a CPP age 60-70, a RRIF and a plan once retired, TFSA last; no account goes negative', async () => {
  const w = await world({ n: 6 });
  try {
    for (const u of w.users) { w.stubs(u.id, 30); w.grant(u.id, 'tfsa', 5_000_000); w.grant(u.id, 'rrsp', 5_000_000); }
    w.jumpTo(monthOfAge(55));
    const bots = w.users.map((u) => ({ id: u.id, class_id: u.class_id, course_id: 'fintech10' }));
    w.app.modules.simulate({ month: w.app.world.current().month, students: bots });
    const ages = w.app.db.prepare('SELECT cpp_age FROM retirement_plan WHERE world_id = ? ORDER BY player_id').all(w.wid()).map((r) => r.cpp_age);
    assert.equal(ages.length, 6);
    assert.ok(ages.every((a) => a >= 60 && a <= 70), JSON.stringify(ages));
    w.jumpTo(monthOfAge(70) - 13);                                                // 69: everyone is retired (bots' life ages are 60-70; these have the default 65)
    for (let i = 0; i < 12; i++) { w.app.modules.simulate({ month: w.app.world.current().month, students: bots }); w.advance(); }
    for (const u of w.users) {
      const p = w.app.db.prepare('SELECT * FROM retirement_plan WHERE player_id = ? AND world_id = ?').get(u.id, w.wid());
      assert.equal(p.rrif, 1);
      assert.equal(JSON.parse(p.draw_order).at(-1), 'tfsa');
      assert.ok(w.app.db.prepare('SELECT COUNT(*) AS n FROM retirement_income WHERE player_id = ? AND draw_cents > 0').get(u.id).n > 0, 'the RRIF minimum at least');
    }
    assert.equal(w.app.db.prepare("SELECT COUNT(*) AS n FROM accounts WHERE owner_type = 'player' AND kind IN ('chequing', 'hisa', 'tfsa', 'rrsp', 'invest') AND balance_cents < 0").get().n, 0);
  } finally { w.close(); }
});

test('routes and the finale: a teacher sees only their own classes; Best Retirement and retirement_short at the close; the season close carries nothing', async () => {
  const w = await world({ n: 2 });
  try {
    const teacher = { id: 0, username: 'nobody', role: 'teacher', world_teacher: 0 };
    assert.deepEqual(w.get('retirement', '/teach', teacher).classes, [], 'a teacher with no classes reads nothing');
    assert.throws(() => w.post('retirement', '/cpp', { age: 71 }, w.users[0]), (e) => e.status === 400);
    assert.throws(() => w.post('retirement', '/oas', { age: 64 }, w.users[0]), (e) => e.status === 400);
    // billed, no savings, no CPP record: the projection runs out at the retirement age
    for (const u of w.users) w.app.db.prepare('INSERT OR REPLACE INTO bills_start (player_id, world_id, start_month) VALUES (?, ?, 1)').run(u.id, w.wid());
    w.jumpTo(monthOfAge(56));
    w.advance(); w.advance();
    const st = w.app.db.prepare('SELECT * FROM retirement_status WHERE world_id = ? ORDER BY player_id').all(w.wid());
    assert.equal(st.length, 2, 'Stage C: a check per student');
    assert.ok(st.every((s) => s.bills_cents > 0 && s.lasts_age === 65 && s.coverage_pct < 100), JSON.stringify(st));
    const old = w.wid();
    w.app.world.close();
    assert.equal(w.app.db.prepare("SELECT COUNT(*) AS n FROM leaderboards_awards WHERE world_id = ? AND award = 'retirement'").get(old).n, 1, 'Best Retirement');
    assert.equal(w.app.db.prepare("SELECT COUNT(*) AS n FROM leaderboards_flags WHERE world_id = ? AND key = 'retirement_short'").get(old).n, 2);
    w.app.world.create();
    for (const t of ['retirement_plan', 'retirement_income', 'retirement_status']) assert.equal(w.app.db.prepare(`SELECT COUNT(*) AS n FROM ${t} WHERE world_id = ?`).get(w.wid()).n, 0, t);
    assert.notEqual(old, w.wid());
    w.audit();
  } finally { w.close(); }
});

// ---- fix round 1 (review) ----
const kcall = (w, mod, name, args) => w.app.modules.kernel('today').modules.call(mod, name, args);
const bill = (w, ids) => { for (const id of ids) w.app.db.prepare('INSERT OR REPLACE INTO bills_start (player_id, world_id, start_month) VALUES (?, ?, 1)').run(id, w.wid()); };

test('review 1: mortgages and a classmate unit\'s rent count as bills (housing debits them outside Bills), so homeowners and tenants need more to be covered', async () => {
  const w = await world({ n: 3 });
  try {
    const [plain, owner, tenant] = w.users;
    bill(w, w.users.map((u) => u.id));
    w.jumpTo(monthOfAge(56));
    const home = (role, payment) => {
      const id = Number(w.app.db.prepare(`INSERT INTO housing_homes (player_id, world_id, price_cents, down_cents, premium_cents, loan_cents, rate_bp, amort_months, amort_left, term_months, term_start,
        payment_cents, value_cents, bought_month, role) VALUES (?, ?, 40000000, 8000000, 0, 32000000, 500, 300, 200, 60, ?, ?, 40000000, 1, ?)`).run(owner.id, w.wid(), monthOfAge(56), payment, role).lastInsertRowid);
      const m = w.app.ledger.openAccount({ ownerType: 'player', ownerId: owner.id, kind: role === 'rental' ? `mortgage:${id}` : 'mortgage', allowNegative: true });
      w.app.ledger.post({ kind: 'test.loan', legs: [{ account: m, cents: -20_000_000 }, { account: w.app.ledger.system('mint'), cents: 20_000_000 }] });
      return id;
    };
    home('primary', 180_000);
    const unit = home('rental', 120_000);
    w.app.db.prepare('INSERT INTO housing_listings (home_id, world_id, rent_cents, tenant_id, since_month) VALUES (?, ?, 140000, ?, ?)').run(unit, w.wid(), tenant.id, monthOfAge(56));
    w.app.db.prepare('INSERT INTO housing_tenure (player_id, world_id, tenure, since_month) VALUES (?, ?, ?, ?)').run(tenant.id, w.wid(), `unit:${unit}`, monthOfAge(56));
    assert.deepEqual(kcall(w, 'housing', 'monthCosts', { playerId: owner.id }), { mortgageCents: 300_000, rentCents: 0 });
    assert.deepEqual(kcall(w, 'housing', 'monthCosts', { playerId: tenant.id }), { mortgageCents: 0, rentCents: 140_000 });
    assert.deepEqual(kcall(w, 'housing', 'monthCosts', { playerId: plain.id }), { mortgageCents: 0, rentCents: 0 });
    w.advance();
    const st = (u) => w.get('retirement', '/state', u).check;
    const lines = (u) => kcall(w, 'bills', 'monthBills', { playerId: u.id }).cents;
    assert.equal(st(owner).bills_cents, lines(owner) + 300_000, 'both mortgage payments');
    assert.equal(st(tenant).bills_cents, lines(tenant) + 140_000, "the classmate's rent");
    assert.equal(st(plain).bills_cents, lines(plain));
    const before = lines(plain), m = kcall(w, 'bills', 'monthBills', { playerId: plain.id }).month;
    w.app.db.prepare("INSERT INTO bills_due (player_id, world_id, bill_id, name, category, amount, due_month) VALUES (?, ?, 'housing-nsf', 'NSF fee', 'fees', 4500, ?)").run(plain.id, w.wid(), m);
    assert.equal(lines(plain), before, 'fees (an NSF fee, late fees) are not bills');
    assert.ok(st(owner).coverage_pct < st(plain).coverage_pct && st(tenant).coverage_pct <= st(plain).coverage_pct, JSON.stringify([st(owner).coverage_pct, st(tenant).coverage_pct, st(plain).coverage_pct]));
    assert.ok(st(owner).shortfall_cents >= st(plain).shortfall_cents + 300_000 - 1);
  } finally { w.close(); }
});

test('review 3 and 7: a draw an account cannot pay (holdings reserved, or trading frozen) passes to the next account; the RRIF minimum stays RRSP-only and carries', async () => {
  const w = await world({ n: 2 });
  try {
    const [a, b] = w.users;
    w.jumpTo(monthOfAge(65) - 1);
    // a: the RRSP holds only DAAX, all of it reserved by a sell limit; $50,000 in the HISA; a $2,000 plan, RRSP first
    const buyDown = (u, n) => { for (let i = 0; i < n; i++) w.post('exchange', '/order', { ticker: 'DAAX', account: 'rrsp', side: 'buy', type: 'market', cents: Math.floor(w.bal(u.id, 'rrsp') / 2) }, u); };   // halve the cash each time (one order: 50% at most)
    w.grant(a.id, 'rrsp', 1_000_000); w.grant(a.id, 'hisa', 5_000_000);
    buyDown(a, 4);                                                                // $625 of cash left
    const units = w.app.db.prepare("SELECT units_micro FROM exchange_holdings WHERE player_id = ? AND account = 'rrsp'").get(a.id).units_micro;
    w.post('exchange', '/order', { ticker: 'DAAX', account: 'rrsp', side: 'sell', type: 'limit', units_micro: units, limit_cents: 9_999_999 }, a);
    w.post('retirement', '/plan', { monthly_cents: 200_000, order: ['rrsp', 'invest', 'hisa', 'tfsa'] }, a);
    w.advance();
    const inc = (u) => w.app.db.prepare('SELECT * FROM retirement_income WHERE player_id = ? AND world_id = ? AND month = ?').get(u.id, w.wid(), w.app.world.current().month);
    assert.equal(inc(a).draw_cents, 200_000, 'the whole plan: what the RRSP could not pay came from the HISA');
    assert.equal(inc(a).short_cents, 0);
    assert.equal(w.kinds(a.id, 'retirement.draw').cents, 200_000 - 62_500, 'the RRSP cash first ($625), the rest from the HISA');
    assert.match(inc(a).note, /could not be sold/);
    // b: a RRIF whose holdings are free, but the teacher froze trading; nothing else to draw from
    w.grant(b.id, 'rrsp', 100_000_000);
    buyDown(b, 9);                                                                // about $1,950 of cash, under the RRIF minimum (about $3,300 a month)
    w.post('retirement', '/rrif', {}, b);
    w.post('retirement', '/plan', { monthly_cents: 200_000, order: ['rrsp', 'invest', 'hisa', 'tfsa'] }, b);
    w.app.db.prepare('INSERT OR REPLACE INTO exchange_settings (world_id, frozen) VALUES (?, 1)').run(w.wid());
    const bUnits = () => w.app.db.prepare("SELECT units_micro FROM exchange_holdings WHERE player_id = ? AND account = 'rrsp'").get(b.id).units_micro, b0 = bUnits();
    w.advance();
    assert.equal(bUnits(), b0, 'frozen: nothing sold');
    assert.ok(inc(b).draw_cents > 0 && inc(b).draw_cents < 200_000);
    assert.equal(inc(b).short_cents, 200_000 - inc(b).draw_cents);
    assert.match(inc(b).note, /trading frozen/);
    const carry = w.app.db.prepare('SELECT rrif_carry_cents FROM retirement_plan WHERE player_id = ?').get(b.id).rrif_carry_cents;
    assert.ok(carry > 0, 'the unpaid RRIF minimum is carried');
    w.app.db.prepare('UPDATE exchange_settings SET frozen = 0 WHERE world_id = ?').run(w.wid());
    w.app.db.prepare('UPDATE exchange_prices SET halted = 0 WHERE world_id = ?').run(w.wid());   // the seeded series may have tripped the breaker: not this test's subject
    w.advance();
    assert.ok(inc(b).draw_cents >= 200_000, 'unfrozen: the plan is paid, which covers this month\'s minimum and the carry');
    assert.equal(w.app.db.prepare('SELECT rrif_carry_cents FROM retirement_plan WHERE player_id = ?').get(b.id).rrif_carry_cents, 0);
  } finally { w.close(); }
});

test('review 4: a plan counts in the check only up to what the accounts could pay every month until 90 (no 100 coverage from a huge plan)', async () => {
  const w = await world({ n: 1 });
  try {
    const [u] = w.users;
    bill(w, [u.id]);
    w.jumpTo(monthOfAge(55));
    w.grant(u.id, 'tfsa', 5_000_000);
    w.advance();
    const before = w.get('retirement', '/state', u).check;
    w.post('retirement', '/plan', { monthly_cents: 10_000_000, order: ['tfsa', 'rrsp', 'invest', 'hisa'] }, u);
    const c = w.get('retirement', '/state', u).check;
    const months = (90 - 55) * 12 - ((w.app.world.current().month - 1) % 12);
    assert.equal(c.plan_counted_cents, Math.floor(5_000_000 / months));
    assert.ok(c.coverage_pct < 100 && c.coverage_pct - before.coverage_pct <= Math.ceil((100 * c.plan_counted_cents) / c.bills_cents) + 1, JSON.stringify([before.coverage_pct, c.coverage_pct]));
    w.advance();
    const snap = JSON.parse(w.app.db.prepare('SELECT parts FROM leaderboards_snapshots WHERE player_id = ? ORDER BY month DESC LIMIT 1').get(u.id).parts);
    assert.ok(snap.coverage < 100, 'the health part too');
  } finally { w.close(); }
});

test('review 6 and 8: Best Retirement ranks how long savings last, not net worth; coverage replaces the debt load from 55 whatever the start age', async () => {
  const w = await world({ n: 2 });
  try {
    const cls2 = w.app.players.createClass({ name: 'Block 2', course: 'fintech10' });
    const more = await w.app.players.createStudents({ classId: cls2.id, count: 2, hash: false });
    for (const s of more) w.app.modules.onLogin({ ...s, class_id: cls2.id }, 'fintech10');
    bill(w, [...w.users.map((u) => u.id), ...more.map((s) => s.id)]);
    w.jumpTo(monthOfAge(56));
    for (const u of w.users) w.grant(u.id, 'tfsa', 60_000_000);          // Block 1: savings that last past 90
    for (const s of more) w.grant(s.id, 'chequing', 200_000_000);        // Block 2: richer, but nothing in a drawable account
    w.advance(); w.advance();
    const old = w.wid();
    w.app.world.close();
    const award = w.app.db.prepare("SELECT class_name, value FROM leaderboards_awards WHERE world_id = ? AND award = 'retirement'").get(old);
    assert.deepEqual({ ...award }, { class_name: 'Block 1', value: 90 });
    const wolf = w.app.db.prepare("SELECT class_name FROM leaderboards_awards WHERE world_id = ? AND award = 'wolf'").get(old);
    assert.equal(wolf.class_name, 'Block 2', 'the net-worth award goes the other way');
  } finally { w.close(); }
  const w2 = await world({ n: 1, config: { ...CONFIG, options: { ...CONFIG.options, life: { startAge: 30 } } } });
  try {
    w2.jumpTo(monthOfAge(55, 30));                                         // month 301: age 55 with a start age of 30 (leaderboards' own stage months say B)
    w2.advance();
    const parts = JSON.parse(w2.app.db.prepare('SELECT parts FROM leaderboards_snapshots ORDER BY month DESC LIMIT 1').get().parts);
    assert.ok('coverage' in parts && !('load' in parts), JSON.stringify(parts));
  } finally { w2.close(); }
});
