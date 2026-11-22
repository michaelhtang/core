// retirement: Stage C income and decumulation (docs/phase5-life.md 5c). CPP from the student's own contributions (jobs' cppHistory) at a start age they choose
// (60-70), OAS from 65 (deferrable to 70), RRSP -> RRIF with the minimum withdrawal, a draw plan (a monthly amount and the order of accounts), and the live check
// (retirement income vs bills, "your savings last until age N").
//
// WHY A MODULE OF ITS OWN, AND WHY HERE IN CONFIG: income must arrive at the payday moment, before housing debits rent and mortgage and bills runs autopay, or
// every retiree would be marked late at the next advance (bills judges lines before autopay). `life` ticks after leaderboards, too late; so this module sits
// right after `jobs` (test/db.test.js). It requires only bank-basic and degrades softly: without `life` it does nothing (no ages); without `exchange` there is no
// RRSP/TFSA draw and no year-end settlement (the withholding is final); without `bills` the bills line is 0; without `jobs` the CPP is 0.
//
// MONEY (all in the tick, per student in k.forEachPlayer, once per month: retirement_income's key):
//   retirement.cpp / retirement.oas   mint -> chequing (net) + sink (tax withheld at source: the annual tax on twelve such months, a twelfth), gross x price index.
//                                     The gross and withholding go to the exchange's year (recordRetirementIncome): its year-end RRSP settlement taxes all of it
//                                     through annualIncomeTax with wages and RRSP/RRIF withdrawals, plus the OAS recovery tax. No tax code here.
//   draws (retired students only; the RRIF minimum also before)  rrsp / tfsa / invest through exchange.drawForRetirement (sells at the bid when the cash is short;
//                                     kinds exchange.draw_sell, exchange.draw: the exchange's own withdrawal rules, withholding and TFSA room), the HISA here as
//                                     retirement.draw (hisa -> chequing). Never more than an account holds; what the plan wanted and could not draw is short_cents.
// Events out (inside the tick): module.retirement.coverage { playerId, worldId, month, coverage, shortfallCents, lastsUntilAge } for each student in Stage C
// (leaderboards' health part, the Best Retirement award and the retirement_short flag).
import { defineModule } from '../../lib/modules.js';
import {
  CPP_MIN_AGE, CPP_MAX_AGE, OAS_MIN_AGE, OAS_MAX_AGE, PENSION_AGE, CPP_EARLY_BP, CPP_LATE_BP, OAS_LATE_BP, CPP_FULL_YEARS, CPP_MAX_65_CENTS, OAS_65_CENTS,
  RRIF_FROM_AGE, OPEN_AGE, STAGE_C_AGE, DRAWABLE, LABELS, MAX_DRAW_CENTS, INFLATION_BP, SHORT_BEFORE_AGE,
} from './constants.js';
import { contributedBp, cppBase, oasBase, indexed, rrifMonthlyMin, pensionWithholding, check, lastsUntil, cppFactorBp } from './calc.js';

const ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 18h18"/><path d="M6 18a6 6 0 0 1 12 0"/><path d="M12 6V3M5 9 3 7M19 9l2-2"/></svg>';   // a sunset

const has = (k, m) => k.modules.has(m);
const lifeAge = (k) => k.modules.call('life', 'age', {});
const retiredOf = (k, playerId) => k.modules.call('life', 'retired', { playerId });
const ROW = { cpp_age: null, oas_age: null, monthly_cents: 0, draw_order: null, rrif: 0, rrif_month: null, cpp_base_cents: null, oas_base_cents: null, cpp_month: null, oas_month: null, rrif_carry_cents: 0 };
const planOf = (k, playerId, wid) => {
  const r = k.db.prepare('SELECT * FROM retirement_plan WHERE player_id = ? AND world_id = ?').get(playerId, wid) ?? ROW;
  return { ...r, order: r.draw_order ? JSON.parse(r.draw_order) : [...DRAWABLE], cppAge: r.cpp_age ?? PENSION_AGE, oasAge: r.oas_age ?? PENSION_AGE };
};
// Upsert some columns of the student's plan row (column names are literals in this file, never data).
function setPlan(k, playerId, wid, patch) {
  const cols = Object.keys(patch);
  k.db.prepare(`INSERT INTO retirement_plan (player_id, world_id, ${cols.join(', ')}) VALUES (?, ?, ${cols.map(() => '?').join(', ')})
    ON CONFLICT (player_id, world_id) DO UPDATE SET ${cols.map((c) => `${c} = excluded.${c}`).join(', ')}`).run(playerId, wid, ...Object.values(patch));
}

// The CPP record: the sum of yearly contribution ratios (bp of a full year) from jobs' pay stubs, and the last full-or-partial year's ratio.
function cppRecord(k, playerId, wid) {
  if (!has(k, 'jobs')) return { sumBp: 0, lastBp: 0, years: 0 };
  const h = k.modules.call('jobs', 'cppHistory', { playerId, worldId: wid });
  return { sumBp: contributedBp(h.years), lastBp: h.years.length ? contributedBp(h.years.slice(-1)) : 0, years: h.years.length };
}
// The CPP base (season-start dollars) for a start age: fixed once it has started; before, the record so far plus, while still working, the last year's
// ratio for each year left until the pension starts (or work stops), an estimate.
function cppBaseOf(k, playerId, wid, plan, age, retireAge) {
  if (plan.cpp_base_cents !== null) return plan.cpp_base_cents;
  const r = cppRecord(k, playerId, wid);
  const more = Math.max(0, Math.min(retireAge, plan.cppAge) - age);
  return cppBase(r.sumBp + more * r.lastBp, plan.cppAge);
}
const oasBaseOf = (plan) => plan.oas_base_cents ?? oasBase(plan.oasAge);

// The accounts a plan draws from: the exchange's three (cash + holdings at the bid, their own expected return) and the HISA (its balance and rate).
function potsOf(k, playerId) {
  const pots = Object.fromEntries(DRAWABLE.map((a) => [a, { cents: 0, rate_bp: 0 }]));
  if (has(k, 'exchange')) Object.assign(pots, k.modules.call('exchange', 'retirementPots', { playerId }));
  const hisa = k.ledger.accountId('player', playerId, 'hisa');
  pots.hisa = { cents: hisa ? k.ledger.balance(hisa) : 0, rate_bp: has(k, 'savings') ? k.modules.call('savings', 'hisaRate', {}).bp : 0 };
  return pots;
}
// The month's bills: the Bills lines plus what housing debits directly (mortgage payments, a classmate's unit rent), which never become Bills lines.
// month = the month those Bills lines were issued for (null: none yet).
function billsOf(k, playerId) {
  const b = has(k, 'bills') ? k.modules.call('bills', 'monthBills', { playerId }) : { month: null, cents: 0 };
  const h = has(k, 'housing') ? k.modules.call('housing', 'monthCosts', { playerId }) : { mortgageCents: 0, rentCents: 0 };
  return { cents: b.cents + h.mortgageCents + h.rentCents, month: b.month };
}

// The live check and the projection, for the panel, the Today facts, the tick's coverage event and the bots.
function liveCheck(k, w, playerId, age, plan = planOf(k, playerId, w.id)) {
  const idx = k.world.priceIndex(w.id), r = retiredOf(k, playerId);
  const pots = potsOf(k, playerId), billed = billsOf(k, playerId), bills = billed.cents;
  const cpp = indexed(cppBaseOf(k, playerId, w.id, plan, age, r.retire_age), idx), oas = indexed(oasBaseOf(plan), idx);
  const now = { cpp: age >= plan.cppAge ? cpp : 0, oas: age >= plan.oasAge ? oas : 0 };
  // The plan counts in the check only up to what the pots could pay every month until 90 (so a huge plan, before retirement or one that empties the accounts,
  // cannot buy a full coverage score).
  const monthsTo90 = Math.max(1, (SHORT_BEFORE_AGE - age) * 12 - ((w.month - 1) % 12));
  const sustainable = Math.floor(Object.values(pots).reduce((t, p) => t + p.cents, 0) / monthsTo90);
  const c = check({ cpp: r.retired ? now.cpp : cpp, oas: r.retired ? now.oas : oas, planCents: Math.min(plan.monthly_cents, sustainable), billsCents: bills, pots, order: plan.order,
    rrifMinCents: plan.rrif ? rrifMonthlyMin(pots.rrsp.cents, age) + plan.rrif_carry_cents : 0 });
  // the stage cost lines' age steps (docs/stagecosts.md), from the age of the month billed (the tick runs before this month's bills)
  const baseAge = billed.month === null ? age : age - Math.floor((w.month - 1) / 12) + Math.floor((billed.month - 1) / 12);
  const steps = has(k, 'bills') ? k.modules.call('bills', 'stageCosts', { playerId, baseAge }).steps ?? [] : [];
  const lasts = lastsUntil({ age, offset: (w.month - 1) % 12, retireAge: r.retire_age, cppAge: plan.cppAge, oasAge: plan.oasAge, cpp, oas, planCents: plan.monthly_cents, billsCents: bills, pots, order: plan.order, steps });
  return { ...c, lasts_until_age: lasts, retired: r.retired, retire_age: r.retire_age, cpp_cents: cpp, oas_cents: oas, pots };
}

// One student's month in the tick: pensions, draws, the coverage event. Idempotent per month (retirement_income's key; nothing paid = no row, nothing to repeat).
function monthFor(k, w, month, age, idx, playerId) {
  if (k.db.prepare('SELECT 1 FROM retirement_income WHERE player_id = ? AND world_id = ? AND month = ?').get(playerId, w.id, month)) return;
  const chq = k.ledger.accountId('player', playerId, 'chequing');
  if (!chq) return;
  let plan = planOf(k, playerId, w.id);
  const r = retiredOf(k, playerId);
  // Pensions start at their ages; the base (season-start dollars) is fixed at the start, then paid x the price index.
  const start = {};
  if (age >= plan.cppAge && plan.cpp_base_cents === null) Object.assign(start, { cpp_age: plan.cppAge, cpp_base_cents: cppBaseOf(k, playerId, w.id, plan, age, r.retire_age), cpp_month: month });
  if (age >= plan.oasAge && plan.oas_base_cents === null) Object.assign(start, { oas_age: plan.oasAge, oas_base_cents: oasBase(plan.oasAge), oas_month: month });
  if (Object.keys(start).length) { setPlan(k, playerId, w.id, start); plan = planOf(k, playerId, w.id); }
  const cpp = plan.cpp_base_cents !== null ? indexed(plan.cpp_base_cents, idx) : 0, oas = plan.oas_base_cents !== null ? indexed(plan.oas_base_cents, idx) : 0;
  const withheld = pensionWithholding(cpp + oas), whCpp = cpp + oas > 0 ? Math.round((withheld * cpp) / (cpp + oas)) : 0;
  const pay = (kind, cents, wh, memo) => {
    if (cents <= 0) return;
    k.ledger.post({ kind, actor: 'system', meta: { month, worldId: w.id, withheld: wh }, legs: [
      { account: k.ledger.system('mint'), cents: -cents, memo }, { account: chq, cents: cents - wh, memo },
      ...(wh > 0 ? [{ account: k.ledger.system('sink'), cents: wh, memo: `Tax withheld at source: ${memo}` }] : [])] });
  };
  pay('cpp', cpp, whCpp, `CPP retirement pension, month ${month}`);
  pay('oas', oas, withheld - whCpp, `Old Age Security, month ${month}`);
  if (cpp + oas > 0 && has(k, 'exchange')) k.modules.call('exchange', 'recordRetirementIncome', { playerId, month, cents: cpp + oas, withheldCents: withheld, oasCents: oas });

  // Draws: the plan once retired; the RRIF minimum whenever converted. Never more than an account holds.
  // Draws: the plan once retired, asked of each account in order with what is STILL needed (an account that cannot pay in full, because it is empty or its
  // holdings cannot be sold this month, passes the rest to the next); the RRIF minimum whenever converted, from the RRSP only: what a blocked sale leaves
  // unpaid of it (not what the RRIF does not hold) is carried to next month's minimum. Never more than an account holds.
  let need = r.retired ? plan.monthly_cents : 0, drawn = 0, drawWh = 0;
  const notes = new Set();
  const want = need;
  let rrifMin = 0, rrifGot = 0;
  if (need > 0 || plan.rrif) {
    const pots = potsOf(k, playerId);
    if (plan.rrif) rrifMin = Math.min(rrifMonthlyMin(pots.rrsp.cents, age) + plan.rrif_carry_cents, pots.rrsp.cents);
    for (const a of plan.order) {
      const ask = a === 'rrsp' ? Math.max(need, rrifMin) : need;
      if (ask <= 0) continue;
      let got = 0;
      if (a === 'hisa') {
        const hisa = k.ledger.accountId('player', playerId, 'hisa');
        got = Math.min(ask, hisa ? k.ledger.balance(hisa) : 0);
        if (got > 0) k.ledger.post({ kind: 'draw', actor: 'system', meta: { month, account: 'hisa' }, legs: [{ account: hisa, cents: -got, memo: 'Retirement draw to chequing' }, { account: chq, cents: got, memo: 'Retirement draw from your HISA' }] });
      } else if (has(k, 'exchange')) {
        const d = k.modules.call('exchange', 'drawForRetirement', { playerId, account: a, cents: ask });
        got = d.cents; drawWh += d.withheld_cents;
        if (d.note) notes.add(d.note);
      }
      if (a === 'rrsp') rrifGot = got;
      drawn += got;
      need -= Math.min(need, got);
    }
    if (plan.rrif && Math.max(0, rrifMin - rrifGot) !== plan.rrif_carry_cents) setPlan(k, playerId, w.id, { rrif_carry_cents: Math.max(0, rrifMin - rrifGot) });
  }
  const short = Math.max(0, need);
  if (cpp + oas + drawn > 0 || short > 0 || want > 0) {
    k.db.prepare('INSERT INTO retirement_income (player_id, world_id, month, cpp_cents, oas_cents, withheld_cents, draw_cents, draw_withheld_cents, short_cents, note) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run(playerId, w.id, month, cpp, oas, withheld, drawn, drawWh, short, [...notes].join('; '));
  }
  if (age >= STAGE_C_AGE) {
    const c = liveCheck(k, w, playerId, age, plan);
    k.db.prepare(`INSERT INTO retirement_status (player_id, world_id, month, income_cents, bills_cents, coverage_pct, shortfall_cents, lasts_age) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT (player_id, world_id) DO UPDATE SET month = excluded.month, income_cents = excluded.income_cents, bills_cents = excluded.bills_cents, coverage_pct = excluded.coverage_pct,
      shortfall_cents = excluded.shortfall_cents, lasts_age = excluded.lasts_age`).run(playerId, w.id, month, c.income_cents, c.bills_cents, c.coverage_pct, c.shortfall_cents, c.lasts_until_age);
    k.events.emit('coverage', { playerId, worldId: w.id, month, coverage: c.coverage_pct, ratioBp: c.ratio_bp, shortfallCents: c.shortfall_cents, lastsUntilAge: c.lasts_until_age });
  }
}

// What the panel shows.
function view(k, w, user) {
  const { age, stage } = lifeAge(k);
  const plan = planOf(k, user.id, w.id), r = retiredOf(k, user.id), idx = k.world.priceIndex(w.id);
  const rec = cppRecord(k, user.id, w.id);
  const base = cppBaseOf(k, user.id, w.id, plan, age, r.retire_age);
  const est65 = Math.round((base * 10000) / cppFactorBp(plan.cppAge));   // the same record at 65
  const open = age >= OPEN_AGE;
  const c = open ? liveCheck(k, w, user.id, age, plan) : null;
  return {
    month: w.month, age, stage, open, open_age: OPEN_AGE, retired: r.retired, retire_age: r.retire_age, index_bp: idx, inflation_bp: INFLATION_BP,
    cpp: {
      age: plan.cppAge, set: plan.cpp_age !== null, started: plan.cpp_base_cents !== null, monthly_cents: indexed(base, idx), at65_cents: indexed(est65, idx),
      min: Math.max(CPP_MIN_AGE, Math.min(age, CPP_MAX_AGE)), max: CPP_MAX_AGE, early_bp: CPP_EARLY_BP, late_bp: CPP_LATE_BP, full_years: CPP_FULL_YEARS,
      contributed_years_bp: rec.sumBp, max_65_cents: indexed(CPP_MAX_65_CENTS, idx), can_change: plan.cpp_base_cents === null && age <= CPP_MAX_AGE,
    },
    oas: {
      age: plan.oasAge, set: plan.oas_age !== null, started: plan.oas_base_cents !== null, monthly_cents: indexed(oasBaseOf(plan), idx), at65_cents: indexed(OAS_65_CENTS, idx),
      min: Math.max(OAS_MIN_AGE, Math.min(age, OAS_MAX_AGE)), max: OAS_MAX_AGE, late_bp: OAS_LATE_BP, can_change: plan.oas_base_cents === null && age <= OAS_MAX_AGE,
    },
    plan: { set: !!k.db.prepare('SELECT 1 FROM retirement_plan WHERE player_id = ? AND world_id = ? AND draw_order IS NOT NULL').get(user.id, w.id), monthly_cents: plan.monthly_cents,
      order: plan.order, labels: LABELS, rrif: !!plan.rrif, rrif_from_age: RRIF_FROM_AGE, can_convert: !plan.rrif && age >= RRIF_FROM_AGE && has(k, 'exchange'), max_cents: MAX_DRAW_CENTS },
    check: c && { income_cents: c.income_cents, pension_cents: c.pension_cents, draw_cents: c.draw_cents, tax_cents: c.tax_cents, bills_cents: c.bills_cents, covered: c.covered,
      shortfall_cents: c.shortfall_cents, coverage_pct: c.coverage_pct, lasts_until_age: c.lasts_until_age, short_before: SHORT_BEFORE_AGE,
      pots: Object.fromEntries(DRAWABLE.map((a) => [a, c.pots[a].cents])), rrif_min_cents: plan.rrif ? rrifMonthlyMin(c.pots.rrsp.cents, age) + plan.rrif_carry_cents : 0, plan_counted_cents: c.plan_counted_cents },
    history: k.db.prepare('SELECT month, cpp_cents, oas_cents, withheld_cents, draw_cents, draw_withheld_cents, short_cents, note FROM retirement_income WHERE player_id = ? AND world_id = ? ORDER BY month DESC LIMIT 12').all(user.id, w.id),
  };
}

// The student's choices, checked. A start age can change until that pension starts, and never to an age already passed.
function setStartAge(k, w, playerId, which, startAge) {
  const [min, max, label] = which === 'cpp' ? [CPP_MIN_AGE, CPP_MAX_AGE, 'CPP'] : [OAS_MIN_AGE, OAS_MAX_AGE, 'OAS'];
  const { age } = lifeAge(k), plan = planOf(k, playerId, w.id);
  if ((which === 'cpp' ? plan.cpp_base_cents : plan.oas_base_cents) !== null) throw new k.HttpError(409, `Your ${label} has started, so its start age can no longer change`);
  if (startAge < age) throw new k.HttpError(400, `Pick an age of at least ${age} (your age now)`);
  setPlan(k, playerId, w.id, { [`${which}_age`]: startAge });
  k.audit(which, { [`${which}_age`]: startAge }, `player:${playerId}`);
  return startAge;
}

export default defineModule({
  id: 'retirement',
  requires: ['bank-basic'],

  migrations: [{ id: '001_retirement', sql: `
CREATE TABLE retirement_plan (       -- a row once the student (or a bot) chooses something, or a pension starts; no row = the defaults (65, 65, nothing drawn, TFSA last)
  player_id INTEGER NOT NULL REFERENCES players(id), world_id INTEGER NOT NULL REFERENCES worlds(id),
  cpp_age INTEGER CHECK (cpp_age BETWEEN ${CPP_MIN_AGE} AND ${CPP_MAX_AGE}), oas_age INTEGER CHECK (oas_age BETWEEN ${OAS_MIN_AGE} AND ${OAS_MAX_AGE}),
  monthly_cents INTEGER NOT NULL DEFAULT 0 CHECK (monthly_cents >= 0), draw_order TEXT,            -- JSON list of the four drawable accounts
  rrif INTEGER NOT NULL DEFAULT 0, rrif_month INTEGER,
  cpp_base_cents INTEGER, cpp_month INTEGER, oas_base_cents INTEGER, oas_month INTEGER,              -- fixed when each pension starts (season-start dollars)
  PRIMARY KEY (player_id, world_id)
);
CREATE TABLE retirement_income (     -- one row per student and month in which anything was paid or drawn (or a draw fell short): the once-a-month key
  player_id INTEGER NOT NULL REFERENCES players(id), world_id INTEGER NOT NULL REFERENCES worlds(id), month INTEGER NOT NULL,
  cpp_cents INTEGER NOT NULL, oas_cents INTEGER NOT NULL, withheld_cents INTEGER NOT NULL, draw_cents INTEGER NOT NULL, draw_withheld_cents INTEGER NOT NULL, short_cents INTEGER NOT NULL,
  PRIMARY KEY (player_id, world_id, month)
);
CREATE TABLE retirement_status (     -- the latest live check of each student in Stage C (the teacher's "who is short" table)
  player_id INTEGER NOT NULL REFERENCES players(id), world_id INTEGER NOT NULL REFERENCES worlds(id), month INTEGER NOT NULL,
  income_cents INTEGER NOT NULL, bills_cents INTEGER NOT NULL, coverage_pct INTEGER NOT NULL, shortfall_cents INTEGER NOT NULL, lasts_age INTEGER NOT NULL,
  PRIMARY KEY (player_id, world_id)
)` }, { id: '002_review', sql: `
-- fix round 1: the RRIF minimum a blocked sale left unpaid (added to next month's), and why a draw fell short (e.g. trading frozen)
ALTER TABLE retirement_plan ADD COLUMN rrif_carry_cents INTEGER NOT NULL DEFAULT 0;
ALTER TABLE retirement_income ADD COLUMN note TEXT NOT NULL DEFAULT ''` }],

  onTick(k, { month, world, classes }) {
    if (!has(k, 'life')) return;
    const { age } = lifeAge(k);
    if (age < STAGE_C_AGE) return;                                       // nothing before Stage C (CPP starts at 60 at the earliest)
    const idx = k.world.priceIndex(world.id);
    k.forEachPlayer(classes.flatMap((c) => c.studentIds), (id) => monthFor(k, world, month, age, idx, id));
  },

  services: {
    // The Today card's facts: whether the CPP age was chosen (and can still be), whether a draw plan was saved, and from 50 the live check.
    todayFacts(k, { playerId }) {
      const w = k.world.current();
      if (!w || !has(k, 'life')) return { cppSet: false, cppOpen: false, planSet: false, covered: false, shortfallCents: 0, lastsUntilAge: 0 };
      const { age } = lifeAge(k), plan = planOf(k, playerId, w.id);
      const out = { cppSet: plan.cpp_age !== null, cppOpen: plan.cpp_base_cents === null, planSet: plan.draw_order !== null, covered: false, shortfallCents: 0, lastsUntilAge: 0 };
      if (age < OPEN_AGE) return out;
      const c = liveCheck(k, w, playerId, age, plan);
      return { ...out, covered: c.covered, shortfallCents: c.shortfall_cents, lastsUntilAge: c.lasts_until_age };
    },
  },

  panels: [{ id: 'retirement', building: { key: 'retirement', name: 'Retirement', icon: ICON }, src: 'retirement.js' }],
  teacherPanels: [{ id: 'retirement-teach', title: 'Retirement', src: 'teach.js' }],

  // Bots: a CPP age from 60 to 70 (a deterministic spread) in Stage C; once retired, a RRIF and a plan drawing what the bills need beyond the pensions
  // (+10%), RRIF first, TFSA last, reset at each world year.
  simulate(k, { month, students }) {
    const w = k.world.current();
    if (w?.status !== 'active' || !has(k, 'life')) return;
    const { age } = lifeAge(k);
    if (age < STAGE_C_AGE) return;
    k.db.txn(() => {
      for (const s of students) {
        const plan = planOf(k, s.id, w.id);
        if (plan.cpp_age === null && plan.cpp_base_cents === null) setPlan(k, s.id, w.id, { cpp_age: Math.max(age, CPP_MIN_AGE + (k.dice(s.id, 0, 23) % (CPP_MAX_AGE - CPP_MIN_AGE + 1))) });
        if (!retiredOf(k, s.id).retired || (plan.draw_order !== null && (month - 1) % 12 !== 0)) continue;
        const c = liveCheck(k, w, s.id, age, planOf(k, s.id, w.id));
        const gap = Math.max(0, c.bills_cents - (c.pension_cents - Math.round(c.tax_cents)));
        setPlan(k, s.id, w.id, { monthly_cents: Math.min(MAX_DRAW_CENTS, Math.round(gap * 1.1)), draw_order: JSON.stringify(['rrsp', 'invest', 'hisa', 'tfsa']), ...(has(k, 'exchange') && !plan.rrif && { rrif: 1, rrif_month: month }) });
      }
    });
  },

  routes: [
    { method: 'GET', path: '/state', access: 'student', handler: (k, { user }) => { if (!has(k, 'life')) throw new k.HttpError(409, 'Retirement needs the Life module'); return view(k, k.world.active(), user); } },
    {
      method: 'POST', path: '/cpp', access: 'student',
      handler(k, { user, body }) {
        const w = k.world.active();
        const a = k.input.int(body, 'age', { min: CPP_MIN_AGE, max: CPP_MAX_AGE });
        k.db.txn(() => setStartAge(k, w, user.id, 'cpp', a));
        return view(k, w, user);
      },
    },
    {
      method: 'POST', path: '/oas', access: 'student',
      handler(k, { user, body }) {
        const w = k.world.active();
        const a = k.input.int(body, 'age', { min: OAS_MIN_AGE, max: OAS_MAX_AGE });
        k.db.txn(() => setStartAge(k, w, user.id, 'oas', a));
        return view(k, w, user);
      },
    },
    {
      // The draw plan: a monthly amount (0 = none) and the order of the four drawable accounts (each exactly once).
      method: 'POST', path: '/plan', access: 'student',
      handler(k, { user, body }) {
        const w = k.world.active();
        const monthly = k.input.int(body, 'monthly_cents', { min: 0, max: MAX_DRAW_CENTS });
        const order = body?.order;
        if (!Array.isArray(order) || order.length !== DRAWABLE.length || !DRAWABLE.every((a) => order.includes(a))) throw new k.HttpError(400, `order must list each of ${DRAWABLE.join(', ')} once`);
        k.db.txn(() => { setPlan(k, user.id, w.id, { monthly_cents: monthly, draw_order: JSON.stringify(order) }); k.audit('plan', { monthly_cents: monthly, order }, `player:${user.id}`); });
        return view(k, w, user);
      },
    },
    {
      // Convert the RRSP to a RRIF (from Stage C; it cannot be undone): from then on at least the minimum is drawn every month.
      method: 'POST', path: '/rrif', access: 'student',
      handler(k, { user }) {
        const w = k.world.active();
        if (!has(k, 'exchange')) throw new k.HttpError(409, 'There is no RRSP to convert: the Exchange is not open');
        const { age } = lifeAge(k);
        if (age < RRIF_FROM_AGE) throw new k.HttpError(409, `You can convert your RRSP to a RRIF from age ${RRIF_FROM_AGE}`);
        if (planOf(k, user.id, w.id).rrif) throw new k.HttpError(409, 'Your RRSP is already a RRIF');
        k.db.txn(() => { setPlan(k, user.id, w.id, { rrif: 1, rrif_month: w.month }); k.audit('rrif', {}, `player:${user.id}`); });
        return view(k, w, user);
      },
    },

    // ---- teacher: who is short in Stage C (your own classes only) ----
    {
      method: 'GET', path: '/teach', access: 'teacher',
      handler(k, { user }) {
        const w = k.world.current();
        if (!w || !has(k, 'life')) return { world: null, classes: [] };
        const { age } = lifeAge(k);
        const mine = k.players.classesFor(user);
        const rows = k.db.prepare(`SELECT p.id, p.username, p.class_id, s.month, s.income_cents, s.bills_cents, s.coverage_pct, s.shortfall_cents, s.lasts_age, r.cpp_age, r.monthly_cents, r.rrif
          FROM players p LEFT JOIN retirement_status s ON s.player_id = p.id AND s.world_id = ? LEFT JOIN retirement_plan r ON r.player_id = p.id AND r.world_id = ?
          WHERE p.role = 'student' AND p.class_id IN (SELECT value FROM json_each(?)) ORDER BY p.class_id, COALESCE(s.shortfall_cents, 0) DESC, p.username`).all(w.id, w.id, JSON.stringify(mine.map((c) => c.id)));
        return {
          world: { month: w.month }, age, stage_c: age >= STAGE_C_AGE, short_before: SHORT_BEFORE_AGE,
          classes: mine.map((c) => ({ id: c.id, name: c.name, students: rows.filter((r) => r.class_id === c.id).map((r) => ({
            id: r.id, username: r.username, checked: r.month !== null, income_cents: r.income_cents, bills_cents: r.bills_cents, coverage_pct: r.coverage_pct, shortfall_cents: r.shortfall_cents,
            lasts_age: r.lasts_age, cpp_age: r.cpp_age ?? PENSION_AGE, monthly_cents: r.monthly_cents ?? 0, rrif: !!r.rrif, short: r.month !== null && (r.shortfall_cents > 0 || r.lasts_age < SHORT_BEFORE_AGE),
          })) })),
        };
      },
    },
  ],
});

