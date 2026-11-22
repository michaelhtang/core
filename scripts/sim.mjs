// Bot simulator: a temp world with bots spread over classes, N world months of every enabled module's ticks,
// and per-month money stats. Later phases use this to balance faucets and sinks before real students log in.
//   node scripts/sim.mjs [--bots=300] [--classes=10] [--months=12] [--condo=202000] [--starter=150000] [--opt=module.key=value ...] [--events] [--events-random]
//   --skip-worlds=N runs in world N+1 instead of world 1 (prices are seeded by world id, so each world is a different market)
//   --opt sets any config option for a run, e.g. --opt=rates.inflationBp=250 --opt=jobs.raiseBp=200 (numbers only); the balance table (months 12, 24, ... 60) prints at the end
//   the last column is the median spent at Outfitters per student so far (price + GST); --events prints how many domain events of each type fired; --events-random turns on insurance's random monthly town events (off by default)
//   --dump=<file> writes every row as JSON (with the whole deflated net worth distribution at months 60, 168, 396 and 576, for tuning Wolf cutoffs offline)
//   --teacher runs the world teacher's actions (TEACHER_PLAN below) through the real route handlers, then a season close and a new world, and checks nothing carried over
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from '../lib/app.js';
import { createClock } from '../lib/clock.js';
import { RENTALS, RENT_TIER } from '../modules/housing/constants.js';   // the NPC rent tiers, for "average rent vs NPC" (constants only)

export function gini(values) {
  const x = [...values].sort((a, b) => a - b);
  const n = x.length;
  const total = x.reduce((s, v) => s + v, 0);
  if (!n || total <= 0) return 0;
  return (2 * x.reduce((s, v, i) => s + (i + 1) * v, 0)) / (n * total) - (n + 1) / n;
}

export function median(values) {
  const x = [...values].sort((a, b) => a - b);
  const mid = x.length >> 1;
  return x.length % 2 ? x[mid] : (x[mid - 1] + x[mid]) / 2;
}

// The balance table: the Phase 2 economy targets (docs/phase2.md "Balance (Phase 2)") at months 12, 24, 36, 48, 60. The CLI prints it; test/economy.test.js asserts on it.
export const balanceTable = (rows, bots) => [12, 24, 36, 48, 60].map((m) => rows.find((r) => r.month === m)).filter((r) => r?.netPay).map((r) => ({
  month: r.month, netPay: r.netPay, bills: r.bills, billsPay: r.bills / r.netPay, owners: r.owners ?? null, ownersShare: (r.owners ?? 0) / bots,
  inArrears: r.inArrears ?? null, medScore: r.medScore ?? null, gini: r.gini,
}));

// The world teacher's levers (teacher: true / --teacher), each at the start of its world month, before the bots act. t.post / t.get call the module's
// own route handler (what the teacher console calls), so the checks, queueing and audit are the real ones.
const TEACHER_PLAN = [
  [18, 'policy +100', (t) => t.post('rates', '/policy', { policy_bp: t.get('rates', '/current').policy_bp + 100 })],
  [19, 'promotions', (t) => t.promotions(3)],
  [24, 'insurance trigger', (t) => t.post('insurance', '/trigger', { event: 'laptop-theft', scope: 'town' })],
  [26, 'venture demand +20%', (t) => t.post('ventures', '/sector', { sector: 'Food and drink', a_bp: 12000, b_bp: 10000 })],
  [30, 'housing market -10%', (t) => t.post('housing', '/market', { pct: -10 })],
  [31, 'promotions', (t) => t.promotions(3)],
  [36, 'exchange crash', (t) => t.post('exchange', '/event', { kind: 'crash' })],
  [40, 'policy -50', (t) => t.post('rates', '/policy', { policy_bp: t.get('rates', '/current').policy_bp - 50 })],
  [43, 'promotions', (t) => t.promotions(3)],
];
// What must not survive a season close, per module: rows of the new world that should not exist before anyone plays in it.
const CARRIED = {
  exchange: [['holdings', 'SELECT COUNT(*) AS n FROM exchange_holdings WHERE world_id = ?'], ['orders', 'SELECT COUNT(*) AS n FROM exchange_orders WHERE world_id = ?'], ['pending rate', 'SELECT COUNT(*) AS n FROM exchange_rate_pending WHERE world_id = ?']],
  credit: [['cards', 'SELECT COUNT(*) AS n FROM credit_cards WHERE world_id = ?'], ['statements', 'SELECT COUNT(*) AS n FROM credit_statements WHERE world_id = ?']],
  savings: [['GICs', 'SELECT COUNT(*) AS n FROM savings_gics WHERE world_id = ?']],
  insurance: [['policies', 'SELECT COUNT(*) AS n FROM insurance_policies WHERE world_id = ?']],
  rates: [['pending policy rate', 'SELECT COUNT(*) AS n FROM rates_policy WHERE world_id = ? AND (pending_bp IS NOT NULL OR pending_inflation_bp IS NOT NULL)']],
  housing: [['homes', 'SELECT COUNT(*) AS n FROM housing_homes WHERE world_id = ?'], ['pending mortgage rate', 'SELECT COUNT(*) AS n FROM housing_rates_pending WHERE world_id = ?'],
    ['listings', 'SELECT COUNT(*) AS n FROM housing_listings WHERE world_id = ?'], ['student rent', 'SELECT COUNT(*) AS n FROM housing_rent WHERE world_id = ?'], ['unit tenancies', "SELECT COUNT(*) AS n FROM housing_tenure WHERE world_id = ? AND (tenure LIKE 'unit:%' OR pending_tenure LIKE 'unit:%')"]],
  bills: [['bills due', 'SELECT COUNT(*) AS n FROM bills_due WHERE world_id = ?']],
  retirement: [['plans', 'SELECT COUNT(*) AS n FROM retirement_plan WHERE world_id = ?'], ['income', 'SELECT COUNT(*) AS n FROM retirement_income WHERE world_id = ?'], ['checks', 'SELECT COUNT(*) AS n FROM retirement_status WHERE world_id = ?']],
  stress: [['scores', 'SELECT COUNT(*) AS n FROM stress_state WHERE world_id = ?'], ['loans', 'SELECT COUNT(*) AS n FROM stress_loans WHERE world_id = ?']],
  feed: [['items', 'SELECT COUNT(*) AS n FROM feed_items WHERE world_id = ?']],
  today: [['errands', 'SELECT COUNT(*) AS n FROM today_errands WHERE world_id = ?'], ['days', 'SELECT COUNT(*) AS n FROM today_days WHERE world_id = ?']],
  ventures: [['companies', 'SELECT COUNT(*) AS n FROM ventures_companies WHERE world_id = ?'], ['business money', "SELECT COUNT(*) AS n FROM accounts WHERE owner_type = 'business' AND balance_cents <> 0"]],
  // jobs_holdings and jobs_past are not per world: every holding back on the entry wage, no remembered past job
  jobs: [['holdings not reset', 'SELECT COUNT(*) AS n FROM jobs_holdings WHERE step <> 0 OR wage_cents IS NOT NULL OR since_month <> 1 OR step_since IS NOT NULL OR raise_since IS NOT NULL'],
    ['past jobs', 'SELECT COUNT(*) AS n FROM jobs_past'], ['company jobs', 'SELECT COUNT(*) AS n FROM jobs_business']],   // jobs_business is not per world either
};

// The months a 576-month life is reported at: the end of the 60-month season, then the end of each stage (A 1-168, B 169-396, C 397-576; docs/phase5-life.md 5b).
export const KEEP = [60, 168, 396, 576];

export async function runSim({ bots = 300, classes = 10, months = 12, log = () => {}, onEvent, config, eventsRandom = false, skipWorlds = 0, teacher = false } = {}) {
  if (eventsRandom) {
    config = structuredClone(config ?? JSON.parse(fs.readFileSync(fileURLToPath(new URL('../config/vdaa.json', import.meta.url)), 'utf8')));
    (config.options ??= {}).insurance = { ...config.options.insurance, randomEvents: true };
  }
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vdaa-sim-'));
  let t = Date.now();                                  // a fake clock: one class day passes per world month
  const app = await createApp({ dataDir, config, clock: createClock({ now: () => t }) });
  if (onEvent) app.events.on('*', (_, type) => onEvent(type));
  try {
    for (let i = 0; i < skipWorlds; i++) { app.world.create({ name: 'Skipped' }); app.world.close(); }
    app.world.create({ name: 'Simulation' });
    // the world teacher (teacher: true), who teaches every class, so the class-scoped routes (/decide) let them act
    const teacherId = teacher ? await app.players.createTeacher({ username: 'simteacher', passphrase: 'the sim teacher passphrase' }) : null;
    const courses = Object.keys(app.config.courses);
    const botList = [];
    for (let i = 0; i < classes; i++) {
      const cls = app.players.createClass({ name: `Block ${i + 1}`, course: courses[i % courses.length], ...(teacherId && { actor: `player:${teacherId}` }) });
      // The teacher has turned on payments between classmates (bank-basic, default off), which student rent (6b) needs. No bot sends transfers.
      if (app.modules.has('bank-basic')) app.db.prepare('INSERT INTO bank_class_settings (class_id, transfers_enabled, per_transfer_cents, daily_cents) VALUES (?, 1, 5000, 10000)').run(cls.id);
      const n = Math.floor(bots / classes) + (i < bots % classes ? 1 : 0);
      if (!n) continue;
      const students = await app.players.createStudents({ classId: cls.id, count: n, hash: false });
      for (const b of students) {
        app.modules.onLogin({ id: b.id, username: b.username, class_id: cls.id }, cls.course_id); // each bot "logs in" once
        botList.push({ id: b.id, class_id: cls.id, course_id: cls.course_id });
      }
    }

    // Phase 1 economy check columns, from the module tables (a module that is not loaded leaves its columns null).
    const hasBills = app.modules.has('bills'), hasSavings = app.modules.has('savings');
    // Net worth = every account (a mortgage is negative) + the home's value when housing is loaded (savings keeps it per world).
    const hasHousing = app.modules.has('housing'), hasCredit = app.modules.has('credit');
    // ... and the exchange's holdings (at the bid, as announced in module.exchange.value) when it is loaded.
    const hasExchange = app.modules.has('exchange');
    // ... and founders' stakes in their companies (book value, as announced in module.ventures.value) when ventures is loaded.
    const hasVentures = app.modules.has('ventures');
    const worth = app.db.prepare(`SELECT SUM(balance_cents)${hasHousing && hasSavings ? ' + COALESCE((SELECT home_value FROM savings_home h WHERE h.player_id = owner_id AND h.world_id = (SELECT MAX(id) FROM worlds)), 0)' : ''}${hasExchange ? ' + COALESCE((SELECT cents FROM exchange_valued v WHERE v.player_id = owner_id AND v.world_id = (SELECT MAX(id) FROM worlds)), 0)' : ''}${hasVentures ? ' + COALESCE((SELECT cents FROM ventures_valued v WHERE v.player_id = owner_id AND v.world_id = (SELECT MAX(id) FROM worlds)), 0)' : ''} AS c FROM accounts WHERE owner_type = 'player' GROUP BY owner_id`);
    const med = (rows) => (rows.length ? median(rows.map((r) => r.c)) : null);
    const savings = () => app.db.prepare("SELECT SUM(balance_cents) AS c FROM accounts WHERE owner_type = 'player' AND (kind = 'hisa' OR kind LIKE 'gic:%') GROUP BY owner_id");
    const netPay = () => app.db.prepare('SELECT net_cents AS c FROM bills_pay WHERE month = ?');
    const billsDue = () => app.db.prepare("SELECT player_id AS p, SUM(amount) AS c FROM bills_due WHERE due_month = ? AND category != 'fees' GROUP BY player_id");
    // 6b: a tenant of a classmate's unit pays rent through housing (ledger kind housing.rent), not as a bill: it counts as a bill-equivalent here
    const studentRent = () => app.db.prepare("SELECT json_extract(meta, '$.tenantId') AS p, SUM(json_extract(meta, '$.rent')) AS c FROM txns WHERE kind = 'housing.rent' AND json_extract(meta, '$.month') = ? GROUP BY p");
    const lateNow = () => app.db.prepare('SELECT COUNT(DISTINCT player_id) AS n FROM bills_due WHERE paid_txn IS NULL AND late = 1');
    const lateEver = () => app.db.prepare('SELECT COUNT(DISTINCT player_id) AS n FROM bills_due WHERE late = 1 AND late_month > 3');
    const snapshot = () => {
      const balances = worth.all().map((r) => r.c);
      const a = app.ledger.audit();
      const month = app.world.current().month;
      const rest = {};
      if (hasBills) {
        const due = new Map(billsDue().all(month).map((r) => [r.p, r.c]));
        if (hasHousing) for (const r of studentRent().all(month)) due.set(r.p, (due.get(r.p) ?? 0) + r.c);
        rest.netPay = med(netPay().all(month)); rest.bills = med([...due.values()].map((c) => ({ c })));
        rest.lateNow = lateNow().get().n / botList.length; rest.lateEver = lateEver().get().n / botList.length;
      }
      // jobs: median gross pay this month (the raises and promotions show up here)
      if (app.modules.has('jobs')) { const g = app.db.prepare('SELECT gross AS c FROM jobs_paystubs WHERE month = ? AND business_id IS NULL').all(month); if (g.length) rest.medGross = median(g.map((r) => r.c)); }
      // outfitters: median spent per student so far (price + GST of everything bought; achievement items are free)
      if (app.modules.has('outfitters')) {
        const spent = new Map(app.db.prepare("SELECT player_id, SUM(price_cents + gst_cents) AS c FROM outfitters_owned WHERE via != 'achievement' AND world_id = (SELECT MAX(id) FROM worlds) GROUP BY player_id").all().map((r) => [r.player_id, r.c]));
        rest.outfitters = median(botList.map((b) => spent.get(b.id) ?? 0));
      }
      if (hasSavings) { const have = savings().all().map((r) => r.c); rest.savings = median([...have, ...Array(Math.max(0, botList.length - have.length)).fill(0)]); }
      if (hasHousing) {
        const owners = app.db.prepare("SELECT h.id, h.player_id, h.role, h.payment_cents, h.arrears_cents, h.missed_streak, (SELECT COALESCE(SUM(gross_cents), 0) / 3.0 FROM housing_income i WHERE i.player_id = h.player_id AND i.world_id = h.world_id AND i.month > ? - 3 AND i.month <= ?) AS gross FROM housing_homes h WHERE h.status = 'owned'").all(month, month);
        // 6b: a landlord owns two homes, so homeowners are distinct students (COUNT(DISTINCT player_id)), and one in arrears on either home counts once
        const who = new Set(owners.map((o) => o.player_id)), behind = new Set(owners.filter((o) => o.arrears_cents > 0).map((o) => o.player_id));
        rest.owners = who.size; rest.ownersShare = who.size / botList.length; rest.inArrears = who.size ? behind.size / who.size : null;
        rest.payToGross = owners.length ? median(owners.filter((o) => o.gross > 0 && o.role === 'primary').map((o) => o.payment_cents / o.gross)) : null;
        // 6b rentals: owned, listed, let; evictions and tenant-months this season; average rent against the NPC tier it compares with
        const wid = app.world.current().id, idx = app.world.priceIndex(wid);
        const rentals = app.db.prepare("SELECT h.player_id, h.property, l.rent_cents, l.listed, l.tenant_id, l.since_month FROM housing_homes h LEFT JOIN housing_listings l ON l.home_id = h.id WHERE h.world_id = ? AND h.status = 'owned' AND h.role = 'rental'").all(wid);
        const listed = rentals.filter((r) => r.listed);
        const tm = app.db.prepare('SELECT COUNT(*) AS n FROM housing_rent WHERE world_id = ?').get(wid).n;
        rest.rentals = rentals.length; rest.rentalShare = new Set(rentals.map((r) => r.player_id)).size / botList.length; rest.listings = listed.length;
        rest.tenanted = listed.filter((r) => r.tenant_id !== null && r.since_month <= month).length; rest.tenantMonths = tm;
        rest.evictions = app.db.prepare('SELECT COALESCE(SUM(evictions), 0) AS n FROM housing_listings WHERE world_id = ?').get(wid).n;
        rest.evictionsPerTenantYear = tm ? rest.evictions / (tm / 12) : null;
        rest.rentVsNpc = listed.length ? listed.reduce((t, r) => t + r.rent_cents / ((RENTALS.find((x) => x.id === RENT_TIER[r.property]).rentCents * idx) / 10000), 0) / listed.length : null;
      }
      if (hasCredit) {
        const sc = app.db.prepare('SELECT score FROM credit_scores WHERE world_id = (SELECT MAX(id) FROM worlds) AND month = ?').all(month).map((r) => r.score);
        const cards = app.db.prepare('SELECT player_id FROM credit_cards WHERE world_id = (SELECT MAX(id) FROM worlds)').all();
        const owedNow = app.db.prepare("SELECT -a.balance_cents AS c FROM credit_cards c JOIN accounts a ON a.id = c.account_id WHERE c.world_id = (SELECT MAX(id) FROM worlds)").all().map((r) => r.c);
        // paying in full = no interest charged at this tick (it judges the statement issued last month). A card with no statement to judge,
        // because its balance was paid off, pays in full: it used to drop out of the denominator, which biased the share low.
        const charged = new Set(app.db.prepare('SELECT player_id FROM credit_statements WHERE world_id = (SELECT MAX(id) FROM worlds) AND month = ? AND settled = 1 AND interest_cents > 0').all(month - 1).map((r) => r.player_id));
        rest.medScore = sc.length ? median(sc) : null; rest.cardShare = cards.length / botList.length; rest.cardBalance = owedNow.length ? median(owedNow) : null;
        rest.payFull = cards.length ? cards.filter((c) => !charged.has(c.player_id)).length / cards.length : null;
      }
      if (hasExchange) {   // investing: a student counts as investing with any holding or any cash in an investment account; a portfolio = holdings at the bid + that cash
        const wid = app.world.current().id;
        const cash = new Map(app.db.prepare("SELECT owner_id, SUM(balance_cents) AS c, SUM(CASE WHEN kind = 'tfsa' THEN 1 ELSE 0 END) AS tfsa, SUM(CASE WHEN kind = 'rrsp' THEN 1 ELSE 0 END) AS rrsp FROM accounts WHERE owner_type = 'player' AND kind IN ('invest', 'tfsa', 'rrsp', 'xhold') GROUP BY owner_id").all().map((r) => [r.owner_id, r]));
        const held = new Map(app.db.prepare('SELECT player_id, cents FROM exchange_valued WHERE world_id = ?').all(wid).map((r) => [r.player_id, r.cents]));
        const tf = new Set(app.db.prepare("SELECT DISTINCT player_id FROM exchange_holdings WHERE world_id = ? AND account = 'tfsa' AND units_micro > 0").all(wid).map((r) => r.player_id));
        const investors = botList.filter((b) => (held.get(b.id) ?? 0) > 0 || (cash.get(b.id)?.c ?? 0) > 0);
        const rr = new Set(app.db.prepare("SELECT DISTINCT player_id FROM exchange_holdings WHERE world_id = ? AND account = 'rrsp' AND units_micro > 0").all(wid).map((r) => r.player_id));
        rest.rrspShare = investors.length ? investors.filter((b) => rr.has(b.id) || (cash.get(b.id)?.rrsp ?? 0) > 0).length / investors.length : null;
        // the latest year-end settlement so far (the first is at month 13, but world year 1 has no room, so the first refunds come at month 25)
        const ref = app.db.prepare('SELECT refund_cents AS c FROM exchange_settlements WHERE world_id = ? AND refund_cents > 0 AND year = (SELECT MAX(year) FROM exchange_settlements WHERE world_id = ? AND month <= ?)').all(wid, wid, month);
        rest.rrspRefund = ref.length ? median(ref.map((r) => r.c)) : null; rest.rrspRefunded = ref.length;
        rest.investing = investors.length / botList.length;
        rest.tfsaShare = investors.length ? investors.filter((b) => tf.has(b.id) || (cash.get(b.id)?.tfsa ?? 0) > 0).length / investors.length : null;
        rest.portfolio = investors.length ? median(investors.map((b) => (held.get(b.id) ?? 0) + (cash.get(b.id)?.c ?? 0))) : null;
        rest.daax = app.db.prepare("SELECT price_micro FROM exchange_prices WHERE world_id = ? AND ticker = 'DAAX' AND month = ?").get(wid, month)?.price_micro ?? null;
      }
      if (hasVentures) {   // companies on Venture Row: how many are active, and last month's statements (written at this tick)
        const wid = app.world.current().id;
        const st = app.db.prepare("SELECT s.revenue_cents, s.net_cents FROM ventures_statements s JOIN ventures_companies c ON c.id = s.company_id WHERE c.world_id = ? AND s.month = ?").all(wid, month - 1);
        rest.companies = app.db.prepare("SELECT COUNT(*) AS n FROM ventures_companies WHERE world_id = ? AND status = 'active'").get(wid).n;
        rest.founders = app.db.prepare("SELECT COUNT(DISTINCT s.player_id) AS n FROM ventures_shares s JOIN ventures_companies c ON c.id = s.company_id WHERE c.world_id = ? AND c.status = 'active'").get(wid).n;
        const sold = st.filter((r) => r.revenue_cents > 0);
        rest.ventureRevenue = st.reduce((t, r) => t + r.revenue_cents, 0);
        rest.medMargin = sold.length ? median(sold.map((r) => r.net_cents / r.revenue_cents)) : null;
        // the Town board (leaderboards' net worth ranking this month): how many of its top 10 are founders
        if (app.modules.has('leaderboards')) rest.topFounders = app.db.prepare("SELECT COUNT(*) AS n FROM (SELECT player_id FROM leaderboards_snapshots WHERE world_id = ? AND month = ? ORDER BY net_worth DESC, player_id LIMIT 10) t WHERE t.player_id IN (SELECT s.player_id FROM ventures_shares s JOIN ventures_companies c ON c.id = s.company_id WHERE c.world_id = ?)").get(wid, month, wid).n;
        // 4b: employed by companies (now), pays missed and loans defaulted (season so far), loans taken, income tax and GST paid to the CRA (season so far)
        const one = (sql) => app.db.prepare(sql).get(wid).n;
        rest.employed = app.modules.has('jobs') ? app.db.prepare('SELECT COUNT(DISTINCT player_id) AS n FROM jobs_business').get().n : 0;   // part-time, on top of a catalogue job (6c)
        rest.missedPays = one('SELECT COALESCE(SUM(missed_paydays), 0) AS n FROM ventures_companies WHERE world_id = ?');
        rest.paidPays = one('SELECT COALESCE(SUM(paydays), 0) AS n FROM ventures_companies WHERE world_id = ?');
        rest.loans = one('SELECT COUNT(*) AS n FROM ventures_loans l JOIN ventures_companies c ON c.id = l.company_id WHERE c.world_id = ?');
        rest.defaults = one('SELECT COUNT(*) AS n FROM ventures_loans l JOIN ventures_companies c ON c.id = l.company_id WHERE c.world_id = ? AND l.defaulted_month IS NOT NULL');
        rest.taxPaid = one('SELECT COALESCE(SUM(f.tax_paid_cents), 0) AS n FROM ventures_flows f JOIN ventures_companies c ON c.id = f.company_id WHERE c.world_id = ?');
        rest.gstPaid = one('SELECT COALESCE(SUM(f.gst_remitted_cents), 0) AS n FROM ventures_flows f JOIN ventures_companies c ON c.id = f.company_id WHERE c.world_id = ?');
        rest.unbalanced = app.db.prepare("SELECT COUNT(*) AS n FROM ventures_statements s JOIN ventures_companies c ON c.id = s.company_id WHERE c.world_id = ? AND (json_extract(s.data, '$.balance.balanced') = 0 OR json_extract(s.data, '$.cashflow.reconciled') = 0)").get(wid).n;
      }
      if (app.modules.has('leaderboards')) {   // Wolf ranks and health, from the module's own snapshots (a script may read them); net worth is also shown at season-start prices
        const wid = app.world.current().id;
        const lb = app.db.prepare('SELECT net_worth, health, tier FROM leaderboards_snapshots WHERE world_id = ? AND month = ?').all(wid, month);
        const idx = app.world.priceIndex(wid);
        if (lb.length) {
          const nw = lb.map((r) => r.net_worth).sort((x, y) => x - y);
          const q = (p) => nw[Math.min(nw.length - 1, Math.floor(p * nw.length))] * 10000 / idx;   // p-quantile, deflated by the price index
          rest.medHealth = median(lb.map((r) => r.health)); rest.tiers = [0, 1, 2, 3, 4].map((t) => lb.filter((r) => r.tier === t).length);
          rest.nwQ = { p25: q(0.25), p50: q(0.5), p70: q(0.7), p90: q(0.9) }; rest.index = idx;
          if (KEEP.includes(month)) rest.nwAll = nw.map((v) => Math.round((v * 10000) / idx));   // the whole deflated distribution at the stage ends, for tuning cutoffs offline (--dump)
        }
      }
      if (app.modules.has('retirement') && month >= 397) {   // Stage C (5c): this month's live checks (written in the tick), pensions and draws
        const wid = app.world.current().id;
        const st = app.db.prepare('SELECT coverage_pct, shortfall_cents, lasts_age FROM retirement_status WHERE world_id = ? AND month = ?').all(wid, month);
        const inc = app.db.prepare('SELECT COALESCE(SUM(cpp_cents + oas_cents), 0) AS pension, COALESCE(SUM(draw_cents), 0) AS draws, COALESCE(SUM(short_cents), 0) AS short, COUNT(*) AS n FROM retirement_income WHERE world_id = ? AND month = ?').get(wid, month);
        if (st.length) rest.retire = { n: st.length, covered: st.filter((r) => r.shortfall_cents === 0).length / st.length, before90: st.filter((r) => r.lasts_age < 90).length / st.length,
          medCoverage: median(st.map((r) => r.coverage_pct)), pension: inc.pension, draws: inc.draws, short: inc.short, paid: inc.n };
      }
      if (app.modules.has('stress')) {   // stress (6a): the score, and emergency loans this season (open now, taken so far, total principal lent)
        const wid = app.world.current().id;
        const sc = app.db.prepare('SELECT score FROM stress_state WHERE world_id = ? AND updated_month IS NOT NULL').all(wid).map((r) => r.score);
        const l = app.db.prepare("SELECT COALESCE(SUM(status = 'open'), 0) AS open, COUNT(*) AS taken, COALESCE(SUM(principal_cents), 0) AS borrowed FROM stress_loans WHERE world_id = ?").get(wid);
        rest.medStress = sc.length ? median(sc) : null; rest.crisis = sc.filter((x) => x >= 80).length / botList.length;
        rest.loansOpen = l.open; rest.openLoanShare = l.open / botList.length; rest.loansTaken = l.taken; rest.borrowed = l.borrowed;
      }
      return {
        month, supply: a.moneySupply, circulating: a.circulating,
        avg: balances.reduce((s, v) => s + v, 0) / balances.length, median: median(balances),
        gini: Math.round(gini(balances) * 1e4) / 1e4, auditOk: a.ok, ...rest,
      };
    };

    // teacher: the route handlers, called as the teacher console (or a student's browser) would; a refusal throws, which fails the run
    const T = teacherId && (() => {
      const user = { id: teacherId, username: 'simteacher', role: 'teacher', class_id: null, world_teacher: 1 };
      const route = (mod, method, p) => app.modules.routes().find((r) => r.module === mod && r.method === method && r.path === p).handler;
      const api = {
        get: (mod, p, as = user) => route(mod, 'GET', p)({ user: as, body: {}, params: {}, url: new URL('http://sim/') }),
        post: (mod, p, body, as = user) => route(mod, 'POST', p)({ user: as, body, params: {}, url: new URL('http://sim/') }),
        // up to n bots who may apply: each applies (the student route), the teacher approves it (POST /decide)
        promotions(n) {
          let count = 0;
          for (const b of botList) {
            if (count >= n) break;
            const student = { id: b.id, username: `bot${b.id}`, role: 'student', class_id: b.class_id };
            if (!api.get('jobs', '/catalogue', student).promotion?.can_apply) continue;
            api.post('jobs', '/apply', { reflection: 'I trained two new hires this year and I am ready to lead a shift.' }, student);
            const pending = app.db.prepare("SELECT id FROM jobs_applications WHERE player_id = ? AND status = 'pending'").get(b.id);   // none when autoPromote granted it on the spot
            if (pending) api.post('jobs', '/decide', { id: pending.id, approve: true });
            count++;
          }
          return { count };
        },
      };
      return api;
    })();
    const done = [];

    const rows = [snapshot()];
    log(rows[0]);
    for (let i = 0; i < months; i++) {
      const month = app.world.current().month;
      if (T) for (const [m, action, fn] of TEACHER_PLAN) if (m === month) done.push({ month, action, count: fn(T).count });
      app.modules.simulate({ month, students: botList });   // bots act (pick jobs, pay bills, save)
      app.world.advance({ months: 1 });
      t += 864e5;
      rows.push(snapshot());
      log(rows.at(-1));
    }
    // today (docs/phase5-life.md 5a): lifetime errand and quest cash against lifetime net pay, both into chequing this season. Must stay under 1%.
    if (app.modules.has('today')) {
      const into = (kinds) => app.db.prepare(`SELECT COALESCE(SUM(e.amount_cents), 0) AS c FROM entries e JOIN txns t ON t.id = e.txn_id JOIN accounts a ON a.id = e.account_id
        WHERE a.owner_type = 'player' AND a.kind = 'chequing' AND e.amount_cents > 0 AND t.kind IN (SELECT value FROM json_each(?)) AND e.created >= ?`).get(JSON.stringify(kinds), app.world.current().created).c;
      const errand = into(['today.errand', 'today.quest']), learn = into(['learn.reward']), pay = into(['jobs.pay']);   // learn: the Learning Road's level rewards (docs/learn.md), counted with errands against the 1% guard
      rows.today = { errandCents: errand, learnCents: learn, payCents: pay, pct: pay ? (100 * (errand + learn)) / pay : null, done: app.db.prepare("SELECT COUNT(*) AS n FROM today_errands WHERE status = 'done'").get().n, days: app.db.prepare('SELECT COUNT(*) AS n FROM today_days WHERE day_no > 0').get().n };
    }
    // History reads after the run (docs/phase5-life.md "Performance"): the student with the most chequing entries, median of 5 reads, in ms.
    {
      const big = app.db.prepare("SELECT a.id, a.owner_id, (SELECT COUNT(*) FROM entries e WHERE e.account_id = a.id) AS n FROM accounts a WHERE a.owner_type = 'player' AND a.kind = 'chequing' ORDER BY n DESC LIMIT 1").get();
      const bot = botList.find((b) => b.id === big.owner_id);
      const time = (fn) => { const ts = []; for (let i = 0; i < 5; i++) { const s = performance.now(); fn(); ts.push(performance.now() - s); } return ts.sort((a, b) => a - b)[2]; };
      const user = { id: bot.id, username: `bot${bot.id}`, role: 'student', class_id: bot.class_id };
      rows.history = {
        entries: app.db.prepare('SELECT COUNT(*) AS n FROM entries').get().n, txns: app.db.prepare('SELECT COUNT(*) AS n FROM txns').get().n,
        playerEntries: app.db.prepare("SELECT COUNT(*) AS n FROM entries e JOIN accounts a ON a.id = e.account_id WHERE a.owner_type = 'player' AND a.owner_id = ?").get(bot.id).n, chequingEntries: big.n,
        dbBytes: ['vdaa.db', 'vdaa.db-wal'].reduce((t, f) => t + (fs.existsSync(path.join(dataDir, f)) ? fs.statSync(path.join(dataDir, f)).size : 0), 0),
        stmt50: time(() => app.ledger.statement(big.id, { limit: 50 })), stmt500: time(() => app.ledger.statement(big.id, { limit: 500 })),
        homeCards: time(() => app.modules.homeCardsFor(user, bot.course_id, 'v')),
        audit: time(() => app.ledger.audit()),
      };
    }
    if (T) {
      // the season close and the next world, through the same app.world functions the close/create routes call; every bot comes back
      app.world.close({ actor: `player:${teacherId}` });
      t += 864e5;
      app.world.create({ name: 'Simulation 2', actor: `player:${teacherId}` });
      const w2 = app.world.current().id;
      const carried = {};
      const money = app.db.prepare("SELECT COUNT(*) AS n FROM accounts WHERE owner_type = 'player' AND balance_cents <> 0").get().n;
      if (money) carried['player accounts not zero'] = money;
      for (const b of botList) app.modules.onLogin({ id: b.id, username: `bot${b.id}`, class_id: b.class_id }, b.course_id);
      for (const [mod, checks] of Object.entries(CARRIED)) {
        if (!app.modules.has(mod)) continue;
        for (const [what, sql] of checks) { const n = app.db.prepare(sql).get(...(sql.includes('?') ? [w2] : [])).n; if (n) carried[`${mod} ${what}`] = n; }
      }
      rows.teacher = { done, newWorld: { worldId: w2, carried, auditOk: app.ledger.audit().ok } };
    }
    return rows;
  } finally {
    app.db.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const arg = (name, dflt) => Number(process.argv.find((a) => a.startsWith(`--${name}=`))?.split('=')[1] ?? dflt);
  const bots = arg('bots', 300), classes = arg('classes', 10), months = arg('months', 12);
  const money = (c) => (c / 100).toFixed(2).padStart(12);
  console.log(`${bots} bots, ${classes} classes, ${months} months\nmonth        supply  circulating         avg      median    gini  audit     net pay       bills  bills/pay     savings  late now  late ever  outfitters`);
  const counts = {};
  // --condo=<dollars>: sets options.housing.condoPriceCents (the default $202,000 condo needs about $4,250 a month of gross income at 10% down,
  // more than any catalogue job pays, so no bot qualifies; a cheaper condo shows buyers, arrears and renewals in the economy check).
  // --starter=<dollars>: sets options.housing.starterPriceCents (the older 1-bedroom condo; default $150,000). Bots buy the average condo when they
  // qualify for it, else the starter.
  const flag = (n) => process.argv.find((a) => a.startsWith(`--${n}=`))?.split('=')[1];
  const condo = flag('condo'), starter = flag('starter');
  const opts = process.argv.filter((a) => a.startsWith('--opt=')).map((a) => a.slice(6).split(/[.=]/));
  const config = condo || starter || opts.length ? (() => {
    const c = JSON.parse(fs.readFileSync(new URL('../config/vdaa.json', import.meta.url), 'utf8'));
    if (condo || starter) c.options.housing = { ...(condo && { condoPriceCents: Math.round(Number(condo) * 100) }), ...(starter && { starterPriceCents: Math.round(Number(starter) * 100) }) };
    for (const [mod, key, value] of opts) ((c.options[mod] ??= {}))[key] = Number(value);
    return c;
  })() : undefined;
  const rows = await runSim({
    bots, classes, months, config, skipWorlds: arg('skip-worlds', 0), eventsRandom: process.argv.includes('--events-random'), teacher: process.argv.includes('--teacher'),
    onEvent: process.argv.includes('--events') ? (type) => { counts[type] = (counts[type] ?? 0) + 1; } : undefined,
    log: (r) => console.log(`${String(r.month).padStart(5)} ${money(r.supply)} ${money(r.circulating)} ${money(r.avg)} ${money(r.median)} ${r.gini.toFixed(4)}  ${r.auditOk ? 'OK' : 'FAIL'} ${r.netPay == null ? ''.padStart(11) : money(r.netPay).padStart(11)} ${r.bills == null ? ''.padStart(11) : money(r.bills).padStart(11)} ${(r.netPay ? `${(100 * r.bills / r.netPay).toFixed(0)}%` : '').padStart(10)} ${r.savings == null ? ''.padStart(11) : money(r.savings).padStart(11)} ${r.lateNow == null ? ''.padStart(9) : `${(100 * r.lateNow).toFixed(1)}%`.padStart(9)} ${r.lateEver == null ? ''.padStart(10) : `${(100 * r.lateEver).toFixed(1)}%`.padStart(10)} ${r.outfitters == null ? ''.padStart(11) : money(r.outfitters).padStart(11)}`),
  });
  const last = rows.at(-1);
  // The balance table: the Phase 2 economy targets (docs/phase2.md "Balance (Phase 2)") at months 12, 24, 36, 48, 60.
  const at = balanceTable(rows, bots);
  if (at.length) {
    const pc = (v, d = 1) => (v == null ? 'n/a' : `${(100 * v).toFixed(d)}%`);
    console.log('balance table: month | net pay | bills | bills/pay | homeowners | owners in arrears | median score | Gini');
    for (const r of at) console.log(`  ${String(r.month).padStart(3)} | ${(r.netPay / 100).toFixed(2)} | ${(r.bills / 100).toFixed(2)} | ${pc(r.billsPay, 0)} | ${r.owners ?? 'n/a'} (${pc(r.ownersShare, 0)}) | ${pc(r.inArrears)} | ${r.medScore ?? 'n/a'} | ${r.gini.toFixed(3)}`);
  }
  const lbRows = [12, 24, 36, 48, 60].map((m) => rows.find((r) => r.month === m)).filter((r) => r?.tiers);
  if (lbRows.length) {
    console.log('leaderboards: month | median health | Pup/Scout/Hunter/Pack Leader/Alpha | net worth p25 / p50 / p70 / p90 at season-start prices | price index');
    for (const r of lbRows) console.log(`  ${String(r.month).padStart(3)} | ${r.medHealth} | ${r.tiers.join('/')} | ${['p25', 'p50', 'p70', 'p90'].map((p) => (r.nwQ[p] / 100).toFixed(0)).join(' / ')} | ${r.index}`);
  }
  const exRows = [12, 24, 36, 48, 60].map((m) => rows.find((r) => r.month === m)).filter((r) => r?.investing !== undefined);
  if (exRows.length) {
    console.log('exchange: month | share investing | TFSA share of investors | median portfolio (investors) | DAAX price');
    for (const r of exRows) console.log(`  ${String(r.month).padStart(3)} | ${(100 * r.investing).toFixed(1)}% | ${r.tfsaShare == null ? 'n/a' : `${(100 * r.tfsaShare).toFixed(1)}%`} | ${r.portfolio == null ? 'n/a' : (r.portfolio / 100).toFixed(2)} | ${r.daax == null ? 'n/a' : (r.daax / 1e6).toFixed(2)}`);
  }
  const rrRows = [24, 36, 48, 60].map((m) => rows.find((r) => r.month === m)).filter((r) => r?.rrspShare !== undefined);
  if (rrRows.length) {
    console.log('rrsp: month | RRSP share of investors | median refund at the latest year-end (students refunded)');
    for (const r of rrRows) console.log(`  ${String(r.month).padStart(3)} | ${r.rrspShare == null ? 'n/a' : `${(100 * r.rrspShare).toFixed(1)}%`} | ${r.rrspRefund == null ? 'n/a' : (r.rrspRefund / 100).toFixed(2)} (${r.rrspRefunded})`);
  }
  const stRows = [12, 24, 36, 48, 60].map((m) => rows.find((r) => r.month === m)).filter((r) => r?.loansTaken !== undefined);
  if (stRows.length) {
    console.log('stress: month | median stress | in crisis (80+) | open emergency loans (share) | loans taken so far | total borrowed');
    for (const r of stRows) console.log(`  ${String(r.month).padStart(3)} | ${r.medStress ?? 'n/a'} | ${(100 * r.crisis).toFixed(1)}% | ${r.loansOpen} (${(100 * r.openLoanShare).toFixed(1)}%) | ${r.loansTaken} | ${(r.borrowed / 100).toFixed(2)}`);
  }
  const llRows = [36, 48, 60].map((m) => rows.find((r) => r.month === m)).filter((r) => r?.rentals !== undefined);
  if (llRows.length) {
    console.log('landlords: month | rentals owned (share of students) | listed | let | tenant-months so far | evictions so far (per tenant-year) | average rent / NPC tier');
    for (const r of llRows) console.log(`  ${String(r.month).padStart(3)} | ${r.rentals} (${(100 * r.rentalShare).toFixed(1)}%) | ${r.listings} | ${r.tenanted} | ${r.tenantMonths} | ${r.evictions} (${r.evictionsPerTenantYear == null ? 'n/a' : r.evictionsPerTenantYear.toFixed(3)}) | ${r.rentVsNpc == null ? 'n/a' : `${(100 * r.rentVsNpc).toFixed(0)}%`}`);
  }
  const vRows = [12, 24, 36, 48, 60].map((m) => rows.find((r) => r.month === m)).filter((r) => r?.companies !== undefined);
  if (vRows.length) {
    console.log('ventures: month | active companies (founders) | median margin | revenue (all companies, last month) | Gini (change since the last row) | founders in the Town board top 10 | statements not balancing');
    vRows.forEach((r, i) => console.log(`  ${String(r.month).padStart(3)} | ${r.companies} (${r.founders}) | ${r.medMargin == null ? 'n/a' : `${(100 * r.medMargin).toFixed(1)}%`} | ${(r.ventureRevenue / 100).toFixed(2)} | ${r.gini.toFixed(3)} (${i ? `${r.gini - vRows[i - 1].gini >= 0 ? '+' : ''}${(r.gini - vRows[i - 1].gini).toFixed(3)}` : 'first row'}) | ${r.topFounders ?? 'n/a'} | ${r.unbalanced}`));
    console.log('ventures 4b/6c: month | part-time at companies (share of bots) | pays made / missed | loans (defaults) | income tax paid | GST remitted');
    vRows.forEach((r) => console.log(`  ${String(r.month).padStart(3)} | ${r.employed} (${(100 * r.employed / bots).toFixed(1)}%) | ${r.paidPays} / ${r.missedPays} | ${r.loans} (${r.defaults}) | ${(r.taxPaid / 100).toFixed(2)} | ${(r.gstPaid / 100).toFixed(2)}`));
    if (rows.some((r) => r.unbalanced)) process.exitCode = 1;
  }
  const gross = [12, 24, 36, 60].filter((m) => rows[m]?.medGross).map((m) => `month ${m} $${(rows[m].medGross / 100).toFixed(2)}`);
  if (gross.length) console.log(`median gross pay: ${gross.join(', ')}`);
  // The economy check at the end of the run, and (a run past 60 months) at months 60, 168, 396 and 576 too.
  for (const r of [...new Set([...KEEP.filter((m) => m < last.month).map((m) => rows.find((x) => x.month === m)), last])].filter(Boolean)) {
    if (r.owners === undefined && r.medScore === undefined) continue;
    const p = (x, f = (v) => `${(100 * v).toFixed(1)}%`) => (x == null ? 'n/a' : f(x));
    console.log(`economy check (month ${r.month}): median score ${r.medScore ?? 'n/a'}, cards ${p(r.cardShare)}, median card balance ${p(r.cardBalance, (v) => (v / 100).toFixed(2))}, paying in full ${p(r.payFull)}, ` +
      `homeowners ${r.owners ?? 'n/a'} (${p(r.ownersShare)}), median mortgage payment / gross ${p(r.payToGross)}, owners in arrears ${p(r.inArrears)}, bills/pay ${r.netPay ? p(r.bills / r.netPay) : 'n/a'}, Gini ${r.gini.toFixed(3)}`);
  }
  const stageRows = [168, 396, 576].map((m) => rows.find((r) => r.month === m)).filter((r) => r?.tiers);
  if (stageRows.length) {
    console.log('wolf ranks at the stage ends: month | Pup/Scout/Hunter/Pack Leader/Alpha (the thresholds in force) | net worth p25 / p50 / p70 / p90 at season-start prices | price index');
    for (const r of stageRows) console.log(`  ${String(r.month).padStart(3)} | ${r.tiers.join('/')} | ${['p25', 'p50', 'p70', 'p90'].map((q) => (r.nwQ[q] / 100).toFixed(0)).join(' / ')} | ${r.index}`);
  }
  const stageC = [397, 457, 517, 576].map((m) => rows.find((r) => r.month === m)).filter((r) => r?.retire);
  if (stageC.length) {
    console.log('Stage C (retirement): month | students checked | covered | savings last < 90 | median coverage % | paid this month: CPP + OAS / draws / short (all students)');
    for (const r of stageC) { const x = r.retire; console.log(`  ${String(r.month).padStart(3)} | ${x.n} | ${(100 * x.covered).toFixed(0)}% | ${(100 * x.before90).toFixed(0)}% | ${x.medCoverage} | $${(x.pension / 100).toFixed(0)} / $${(x.draws / 100).toFixed(0)} / $${(x.short / 100).toFixed(0)} (${x.paid} paid)`); }
  }
  if (rows.history) {
    const hs = rows.history;
    console.log(`history after ${last.month - 1} months: ${hs.txns} txns, ${hs.entries} entries, database ${(hs.dbBytes / 1e6).toFixed(1)} MB; the busiest student has ${hs.playerEntries} entries (${hs.chequingEntries} on chequing). ` +
      `Median ms: statement 50 rows ${hs.stmt50.toFixed(2)}, statement 500 rows ${hs.stmt500.toFixed(2)}, home cards (today digest) ${hs.homeCards.toFixed(2)}, ledger audit ${hs.audit.toFixed(0)}`);
  }
  const dump = flag('dump');
  if (dump) fs.writeFileSync(dump, JSON.stringify({ rows, history: rows.history ?? null }));
  if (rows.today) {
    const td = rows.today;
    console.log(`today: ${td.days} class days, ${td.done} errands done, errand + quest + learn cash $${((td.errandCents + td.learnCents) / 100).toFixed(2)} (errands and quests $${(td.errandCents / 100).toFixed(2)}, Learning Road $${(td.learnCents / 100).toFixed(2)}) = ${td.pct == null ? 'n/a' : `${td.pct.toFixed(3)}%`} of lifetime net pay $${(td.payCents / 100).toFixed(2)} (must stay under 1%)`);
    if (td.pct != null && td.pct >= 1) process.exitCode = 1;
  }
  if (rows.teacher) {
    console.log(`teacher actions: ${rows.teacher.done.map((a) => `month ${a.month} ${a.action}${a.count === undefined ? '' : ` (${a.count})`}`).join(', ')}`);
    const c = Object.entries(rows.teacher.newWorld.carried);
    console.log(`season close + new world: ${c.length ? `CARRIED ${c.map(([what, n]) => `${what} ${n}`).join(', ')}` : 'starts clean'}, audit ${rows.teacher.newWorld.auditOk ? 'OK' : 'FAIL'}`);
    if (c.length || !rows.teacher.newWorld.auditOk) process.exitCode = 1;
  }
  if (process.argv.includes('--events')) {
    console.log('events:');
    for (const [type, n] of Object.entries(counts).sort()) console.log(`  ${type.padEnd(16)} ${n}`);
  }
  if (rows.some((r) => !r.auditOk)) process.exitCode = 1;
}
