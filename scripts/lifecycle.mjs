// Life-cycle profiles (docs/stagecosts.md): one world lived month by month from 1 to 577 (age 22 to 70) with scripted bots in five profiles, to check that
// doing nothing is clearly worse than saving and investing. Every module ticks; the bots act only through the real route handlers and jobs' own bot (a job,
// promotions). Reported at 55, 65 and 70: net worth / annual net pay, the retirement check (coverage, covered share, "lasts to"), and bills / pay.
//   node scripts/lifecycle.mjs [--per=40] [--to=577] [--seed=<market seed>] [--dump=<file>]   (about 10-18 minutes for 40 per profile)
//   idle      one job, autopay, nothing else: cash stays in chequing, renting (the shared room), CPP at 65, no draw plan
//   spender   idle, but picks the dearest option in every Plans slot (the never-saved renter)
//   modest    idle + 5% of net pay into the TFSA index fund (RRSP once the TFSA is full), a draw plan at retirement
//   diligent  15% of net pay: RRSP while there is room, then TFSA, then non-registered, all in the index fund; a draw plan at retirement
//   mortgage  diligent, but first saves in chequing for a condo (20% down) and buys it; invests 15% after
// Retirement for the savers: at 65 and each world year after, a RRIF and a plan of (bills - net pensions) x 1.1, RRSP, non-registered, HISA, TFSA (the
// retirement module's own bot rule, without its random CPP age, so every profile starts CPP at 65).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createApp } from '../lib/app.js';
import { createClock } from '../lib/clock.js';
import { withTxn } from '../lib/db.js';
import jobsDef from '../modules/jobs/index.js';
import { median } from './sim.mjs';

const arg = (n, d) => process.argv.find((a) => a.startsWith(`--${n}=`))?.split('=')[1] ?? d;
const PER = Number(arg('per', 40)), TO = Number(arg('to', 577)), DUMP = arg('dump', null), SEED = arg('seed', 'lifecycle-1');
const PROFILES = ['idle', 'spender', 'modest', 'diligent', 'mortgage'];
const AT = { 169: 36, 397: 55, 521: 65, 577: 70 };   // 65: month 521, after the savers' plan set at 517 has run
const PAY_AT = [168, 180, 240, 300, 380, 396, 420, 480, 516];   // bills / net pay (working months)

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vdaa-life-'));
let t = Date.parse('2026-11-02T15:00:00Z');
const app = await createApp({ dataDir, clock: createClock({ now: () => t }) });
const started = performance.now();
try {
  app.world.create({ name: 'Lifecycle' });
  // the exchange's price series is seeded by a random per-world secret: pin it (--seed) so runs before and after a change see the same market
  const wid0 = app.world.current().id;
  app.db.prepare('INSERT OR REPLACE INTO exchange_secrets (world_id, secret) VALUES (?, ?)').run(wid0, SEED);
  app.db.prepare('DELETE FROM exchange_prices WHERE world_id = ?').run(wid0);
  const bots = [];
  for (const profile of PROFILES) {
    const cls = app.players.createClass({ name: profile, course: 'fintech10' });
    for (const s of await app.players.createStudents({ classId: cls.id, count: PER, hash: false })) {
      app.modules.onLogin({ id: s.id, username: s.username, class_id: cls.id }, 'fintech10');
      bots.push({ id: s.id, class_id: cls.id, profile, user: { id: s.id, username: s.username, role: 'student', class_id: cls.id } });
    }
  }
  const handler = (mod, method, p) => app.modules.routes().find((r) => r.module === mod && r.method === method && r.path === p).handler;
  const call = (mod, method, p, user, body = {}) => handler(mod, method, p)({ user, body, params: {}, url: new URL('http://life/') });
  const tryCall = (...a) => { try { return call(...a); } catch (e) { if (e?.status) return null; throw e; } };
  const bal = (id, kind) => { const a = app.ledger.accountId('player', id, kind); return a ? app.ledger.balance(a) : 0; };
  const svc = (mod, name, args) => app.modules.kernel('life').modules.call(mod, name, args);
  const lastNet = new Map();
  const out = { per: PER, ages: {}, billsPay: {}, retireBillsIncome: {}, audit: [], late: {}, negative: 0 };

  const invest = (b, cents) => {
    // RRSP (diligent, mortgage) or TFSA first, then the other, then non-registered; each contribution bought into the index fund
    const order = b.profile === 'modest' ? ['tfsa', 'rrsp', 'invest'] : ['rrsp', 'tfsa', 'invest'];
    for (const account of order) {
      if (cents < 1000) return;
      if (!tryCall('exchange', 'POST', '/contribute', b.user, { account, cents })) continue;
      tryCall('exchange', 'POST', '/order', b.user, { ticker: 'DAAX', account, side: 'buy', type: 'market', cents: bal(b.id, account) });
      return;
    }
  };
  const buyHome = (b) => {
    for (const property of ['average', 'starter']) {
      const q0 = tryCall('housing', 'POST', '/qualify', b.user, { down_cents: 0, amort_years: 25, property });
      if (!q0) continue;
      const down = Math.max(q0.minDownCents ?? 0, Math.ceil(q0.priceCents / 5));
      const q = tryCall('housing', 'POST', '/qualify', b.user, { down_cents: down, amort_years: 25, property });
      if (!q?.ok || bal(b.id, 'chequing') < q.cashNeededCents + 300000) continue;
      if (tryCall('housing', 'POST', '/buy', b.user, { down_cents: down, amort_years: 25, property })) return true;
    }
    return false;
  };

  for (let month = 1; month < TO; month++) {
    const age = svc('life', 'age', {}).age;
    // jobs' own bot (a job, promotions) until 65: life ends the job at the payday at 65, so no rehire after
    if (age < 65) jobsDef.simulate(app.modules.kernel('jobs'), { month, students: bots.map((b) => ({ id: b.id, class_id: b.class_id })) });
    withTxn(app.db, () => {
      for (const b of bots) {
        const net = app.db.prepare('SELECT net_cents FROM bills_pay WHERE player_id = ? AND world_id = ? AND month = ?').get(b.id, app.world.current().id, month)?.net_cents ?? 0;
        if (net > 0) lastNet.set(b.id, net);
        if (b.profile === 'spender') {
          for (const sl of call('bills', 'GET', '/state', b.user).slots) {
            const top = sl.options.reduce((a, o) => (o.amount > a.amount ? o : a));
            if (top.option !== sl.current) tryCall('bills', 'POST', '/choice', b.user, { slot: sl.slot, option: top.option });
          }
        }
        const pct = { modest: 5, diligent: 15, mortgage: 15 }[b.profile];
        if (b.profile === 'mortgage' && !b.owns && month >= 36 && age < 65) b.owns = buyHome(b);
        if (pct && net > 0 && (b.profile !== 'mortgage' || b.owns)) invest(b, Math.min(Math.floor((net * pct) / 100), bal(b.id, 'chequing')));
        // the savers' retirement: at 65 and each world year after, a RRIF and a plan sized to the gap (+10%)
        if (pct && age >= 65 && (month - 1) % 12 === 0) {
          const v = call('retirement', 'GET', '/state', b.user);
          if (v.check) {
            const gap = Math.max(0, v.check.bills_cents - (v.check.pension_cents - v.check.tax_cents));
            call('retirement', 'POST', '/plan', b.user, { monthly_cents: Math.min(10_000_000, Math.round(gap * 1.1)), order: ['rrsp', 'invest', 'hisa', 'tfsa'] });
            if (v.plan.can_convert) tryCall('retirement', 'POST', '/rrif', b.user);
          }
        }
      }
    });
    app.world.advance({ months: 1 });
    t += 864e5;
    const m = app.world.current().month, wid = app.world.current().id;
    if (PAY_AT.includes(m)) {
      out.billsPay[m] = {};
      for (const p of PROFILES) {
        const r = bots.filter((b) => b.profile === p).map((b) => {
          const net = app.db.prepare('SELECT net_cents FROM bills_pay WHERE player_id = ? AND world_id = ? AND month = ?').get(b.id, wid, m)?.net_cents ?? 0;
          const bills = svc('bills', 'monthBills', { playerId: b.id }).cents + Object.values(svc('housing', 'monthCosts', { playerId: b.id })).reduce((x, y) => x + y, 0);
          return net > 0 ? bills / net : null;
        }).filter((x) => x !== null);
        out.billsPay[m][p] = r.length ? median(r) : null;
      }
    }
    if ([529, 541, 565].includes(m)) {
      out.retireBillsIncome[m] = {};
      for (const p of PROFILES) {
        const r = bots.filter((b) => b.profile === p).map((b) => app.db.prepare('SELECT income_cents, bills_cents FROM retirement_status WHERE player_id = ? AND world_id = ?').get(b.id, wid)).filter((x) => x && x.income_cents > 0);
        out.retireBillsIncome[m][p] = r.length ? median(r.map((x) => x.bills_cents / x.income_cents)) : null;
      }
    }
    if (AT[m]) {
      const a = app.ledger.audit();
      out.audit.push({ month: m, ok: a.ok });
      out.ages[AT[m]] = { month: m, index: app.world.priceIndex(wid) };
      for (const p of PROFILES) {
        const rows = bots.filter((b) => b.profile === p).map((b) => {
          const nw = svc('savings', 'todayFacts', { playerId: b.id }).netWorthCents;
          const st = app.db.prepare('SELECT coverage_pct, shortfall_cents, lasts_age, income_cents, bills_cents FROM retirement_status WHERE player_id = ? AND world_id = ?').get(b.id, wid);
          return { nw, mult: nw / (12 * (lastNet.get(b.id) || 1)), chq: bal(b.id, 'chequing'), cov: st?.coverage_pct ?? null, covered: st ? st.shortfall_cents === 0 : null, lasts: st?.lasts_age ?? null, bills: st?.bills_cents ?? null, income: st?.income_cents ?? null, annualNet: 12 * (lastNet.get(b.id) ?? 0) };
        });
        const md = (f) => median(rows.map(f).filter((x) => x !== null));
        out.ages[AT[m]][p] = { nw: md((r) => r.nw), annualNet: md((r) => r.annualNet), mult: md((r) => r.mult), multP25: (() => { const x = rows.map((r) => r.mult).sort((u, v) => u - v); return x[Math.floor(x.length / 4)]; })(),
          chq: md((r) => r.chq), cov: md((r) => r.cov), coveredShare: rows.filter((r) => r.covered).length / rows.length, under90: rows.filter((r) => r.cov !== null && r.cov < 90).length / rows.length,
          lasts: md((r) => r.lasts), bills: md((r) => r.bills), income: md((r) => r.income),
          owners: p === 'mortgage' ? bots.filter((b) => b.profile === p && b.owns).length : null,
          mortgageLeft: p === 'mortgage' ? bots.filter((b) => b.profile === p && svc('housing', 'monthCosts', { playerId: b.id }).mortgageCents > 0).length : null };
      }
      out.negative += app.db.prepare("SELECT COUNT(*) AS n FROM accounts WHERE owner_type = 'player' AND kind IN ('chequing','hisa','tfsa','rrsp','invest') AND balance_cents < 0").get().n;
      const lines = app.db.prepare("SELECT COUNT(*) AS n, COALESCE(SUM(late), 0) AS late FROM bills_due WHERE world_id = ? AND due_month > ? AND due_month <= ? AND category <> 'fees'").get(wid, m - 120, m);
      out.late[m] = lines.n ? lines.late / lines.n : 0;
      console.error(`month ${m} (age ${AT[m]}) done at ${((performance.now() - started) / 1000).toFixed(0)} s`);
    }
  }
  out.seconds = Math.round((performance.now() - started) / 1000);
  const $ = (c) => (c == null ? 'n/a' : `$${Math.round(c / 100).toLocaleString('en-CA')}`);
  const pc = (x) => (x == null ? 'n/a' : `${Math.round(100 * x)}%`);
  console.log(`${PER} bots per profile, months 1-${TO}, market seed ${SEED}, DAAX at the end ${app.db.prepare("SELECT price_micro FROM exchange_prices WHERE world_id = ? AND ticker = 'DAAX' ORDER BY month DESC LIMIT 1").get(app.world.current().id)?.price_micro / 1e6}, ${out.seconds} s; audits ${out.audit.map((a) => `${a.month} ${a.ok ? 'OK' : 'FAIL'}`).join(', ')}; negative accounts ${out.negative}`);
  console.log('age | profile | median net worth (x annual net pay, p25) | annual net | chequing | coverage % | covered | coverage < 90% | lasts to | bills | income');
  for (const [age, r] of Object.entries(out.ages)) for (const p of PROFILES) {
    const x = r[p];
    if (p === 'mortgage') console.log(`${age} | mortgage: ${x.owners} of ${PER} own a home, ${x.mortgageLeft} still paying a mortgage`);
    console.log(`${age} | ${p.padEnd(8)} | ${$(x.nw)} (${x.mult.toFixed(1)}x, p25 ${x.multP25.toFixed(1)}x) | ${$(x.annualNet)} | ${$(x.chq)} | ${x.cov ?? 'n/a'} | ${pc(x.coveredShare)} | ${pc(x.under90)} | ${x.lasts ?? 'n/a'} | ${$(x.bills)} | ${$(x.income)}`);
  }
  console.log(`bills / net pay (median): ${Object.entries(out.billsPay).map(([m, r]) => `m${m} ${PROFILES.map((p) => `${p} ${pc(r[p])}`).join(' ')}`).join(' | ')}`);
  console.log(`retirement bills / income (median): ${Object.entries(out.retireBillsIncome).map(([m, r]) => `m${m} ${PROFILES.map((p) => `${p} ${pc(r[p])}`).join(' ')}`).join(' | ')}`);
  console.log(`late lines (share of the last 120 months' lines): ${Object.entries(out.late).map(([m, v]) => `m${m} ${pc(v)}`).join(', ')}`);
  if (DUMP) fs.writeFileSync(DUMP, JSON.stringify(out, null, 1));
} finally {
  app.db.close();
  fs.rmSync(dataDir, { recursive: true, force: true });
}
