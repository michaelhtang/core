// ventures: student businesses on Venture Row (docs/phase4.md, wave 4a). FT20/30 founding teams register a company (the teacher approves it),
// agree an equity split, capitalise a business treasury from chequing, make up to 3 products from their sector's cost table, sell them to the
// town (simulated NPC demand) and to classmates (storefronts), and publish monthly statements. Payroll, tax and loans are 4b; private share
// sales, the IPO and dividends are 4c (ventures_shares is the cap table they will build on).
//
// MONEY. One business ledger account per company: owner_type 'business', owner_id = the company id, kind 'treasury'. Kinds (stored as
// ventures.<kind>): capital (founder chequing -> treasury), production (treasury -> sink: materials and time bought outside town),
// npc_sale (mint -> treasury: town customers are outside the town's money), store_sale (a classmate's chequing or card -> treasury),
// payout (treasury -> shareholders' chequing, pro rata, when a company is dissolved). Inventory is not money: units and their cost live in
// ventures_products (weighted average cost), and the cost of what is sold or spoils is the cost of goods sold.
//
// THE MONTH. The tick into month m: (1) town customers buy month m-1's demand from what is on hand, at today's prices; (2) part of what is left
// spoils; (3) month m-1's statements are written; (4) month m's production is paid from the treasury (a product whose run the treasury cannot
// pay is skipped that month). So the units made at the start of a month are on the shelf, for classmates and then the town, during it.
// Flows (revenue, cost of goods sold, spoilage, production, capital, payouts) are counted per company, product and month in ventures_flows;
// the statements are built from those and the treasury balance, and the balance sheet must balance (cash + inventory = capital + retained).
//
// NPC demand: Q = max(0, a - b x P) per product type (demand.js), split among the companies selling that type, weighted by price and
// reputation, times a +-10% draw seeded from a per-world secret (ventures_secrets, never sent to a browser).
//
// Net worth: a holder's stake = their share of (treasury + inventory at cost), at book value. module.ventures.value { playerId, worldId,
// stake, companyValue, company } after every tick and after capital, a sale or a dissolution; leaderboards adds `stake` to net worth.
// seasonAssets returns the same stakes at season close (so the treasury reaches the founders' season results pro rata before the core
// resets every account), and seasonClose marks the companies wound up.
// Events out: module.ventures.value (in the tick; after commit elsewhere), module.ventures.changed { classId } (after commit); 6c: .hired and
// .laid_off (after commit), .payroll_missed (inside jobs' payday, once per company and month). Payloads: docs/events.md section 12.
// Events in: module.credit.limit (the card limit, as outfitters keeps it). Services used: outfitters grantItem (if loaded).
//
// FILES (this folder): constants.js, demand.js (the pure maths), ui/ (browser panels), and, bottom layer first:
//   reads.js (small reads, validation, 4b liability reads), finance.js (statements, GST, loan payments, tax), founding.js (founding, treasury,
//   dissolve), market.js (products, storefront, the tick), staff.js (payroll, hiring), bank.js (borrow, resolve a default), views.js (what the
//   browser sees), bots.js (simulation bots). This file keeps the migrations, services, events, panels and routes.
import { defineModule } from '../../lib/modules.js';
import { money, ok } from '../../lib/kernel.js';
import {
  SECTORS, MIN_CAPITAL_CENTS, PLAN_MAX, MAX_QUANTITY, SETTING_MIN_BP, SETTING_MAX_BP, UNPAID_REMOVE_MONTHS, MAX_SLOTS,
} from './constants.js';
import { share } from './demand.js';
import { LIVE, inList, MAX_CENTS, q1, qa, company, members, holders, nameOf, capitalBy, changed, needWorld, townSize, note, nameProblem, mustBe, openLoan, worldCfg } from './reads.js';
import { settleDebts } from './finance.js';
import { register, dropMember, memberOf, respond, setSplit, confirmSplit, cancel, decide, capitalise, stakes, announce, dissolve, afterDissolve, founderOf } from './founding.js';
import { setProduct, dropProduct, buy, tick } from './market.js';
import { payroll, postJob, closeJob, openings, applyJob, hireNow, decideHire, layoff } from './staff.js';
import { borrow, resolveLoan } from './bank.js';
import { publicView, fullView, state, teacherCompany, teachView } from './views.js';
import { bots } from './bots.js';

export default defineModule({
  id: 'ventures',
  requires: ['bank-basic'],
  options: { townSize: 'the size of the simulated town (its NPC residents, who make town demand), not the school (default 300)', rentCents: 'monthly storefront rent per company, cents (default 5000)', storePerCompanyCents: 'what one buyer may spend at one company a world month (default 10000)', storePerMonthCents: 'what one buyer may spend on Venture Row a world month (default 25000)', loanSpreadBp: 'Venture Bank spread over the policy rate, bp (default 300)' },

  migrations: [{ id: '001_ventures', sql: `
CREATE TABLE ventures_companies (     -- one row per registration; the business id of its ledger account (owner_type 'business')
  id INTEGER PRIMARY KEY, world_id INTEGER NOT NULL REFERENCES worlds(id), class_id INTEGER NOT NULL REFERENCES classes(id),
  name TEXT NOT NULL, sector TEXT NOT NULL, plan TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('forming','pending','approved','active','frozen','declined','cancelled','dissolved','wound_up')),
  founder_id INTEGER NOT NULL REFERENCES players(id),       -- the student who registered it (proposes the split, can withdraw it)
  rep_bp INTEGER NOT NULL DEFAULT 10000,                    -- reputation: weights its share of town demand (5000..15000)
  created_month INTEGER NOT NULL, approved_month INTEGER, active_month INTEGER, ended_month INTEGER,
  decided_by TEXT, note TEXT, wound_up_cents INTEGER,       -- wound_up_cents: what its holders' stakes were worth at season close
  created INTEGER NOT NULL
);
CREATE INDEX ventures_companies_world ON ventures_companies(world_id, status);
CREATE TABLE ventures_members (       -- the founding team: invited -> accepted (or declined); units_micro = the proposed founder shares
  company_id INTEGER NOT NULL REFERENCES ventures_companies(id), player_id INTEGER NOT NULL REFERENCES players(id),
  status TEXT NOT NULL CHECK (status IN ('invited','accepted','declined')), units_micro INTEGER NOT NULL DEFAULT 0,
  confirmed INTEGER NOT NULL DEFAULT 0,                     -- agreed to the current split
  dissolve_vote INTEGER NOT NULL DEFAULT 0, seq INTEGER NOT NULL,
  PRIMARY KEY (company_id, player_id)
);
CREATE INDEX ventures_members_player ON ventures_members(player_id, status);
CREATE TABLE ventures_shares (        -- the cap table: written from the agreed split at approval (4c adds private sales and the IPO)
  company_id INTEGER NOT NULL REFERENCES ventures_companies(id), player_id INTEGER NOT NULL REFERENCES players(id),
  units_micro INTEGER NOT NULL CHECK (units_micro >= 0), PRIMARY KEY (company_id, player_id)
);
CREATE TABLE ventures_capital (id INTEGER PRIMARY KEY, company_id INTEGER NOT NULL REFERENCES ventures_companies(id), player_id INTEGER NOT NULL REFERENCES players(id),
  month INTEGER NOT NULL, cents INTEGER NOT NULL, txn_id INTEGER REFERENCES txns(id));
CREATE TABLE ventures_products (      -- up to 3 active per company; inventory at weighted average cost
  id INTEGER PRIMARY KEY, company_id INTEGER NOT NULL REFERENCES ventures_companies(id), type_key TEXT NOT NULL,
  price_cents INTEGER NOT NULL, quantity INTEGER NOT NULL DEFAULT 0, inventory_units INTEGER NOT NULL DEFAULT 0 CHECK (inventory_units >= 0),
  inventory_cost_cents INTEGER NOT NULL DEFAULT 0 CHECK (inventory_cost_cents >= 0), active INTEGER NOT NULL DEFAULT 1, created_month INTEGER NOT NULL,
  UNIQUE (company_id, type_key)
);
CREATE TABLE ventures_flows (         -- what happened, per company, product (0 = the company: capital, payouts) and month; statements are built from it
  company_id INTEGER NOT NULL, product_id INTEGER NOT NULL, month INTEGER NOT NULL,
  demand_units INTEGER NOT NULL DEFAULT 0, npc_units INTEGER NOT NULL DEFAULT 0, npc_cents INTEGER NOT NULL DEFAULT 0,
  store_units INTEGER NOT NULL DEFAULT 0, store_cents INTEGER NOT NULL DEFAULT 0, cogs_cents INTEGER NOT NULL DEFAULT 0,
  spoiled_units INTEGER NOT NULL DEFAULT 0, spoilage_cents INTEGER NOT NULL DEFAULT 0, produced_units INTEGER NOT NULL DEFAULT 0, production_cents INTEGER NOT NULL DEFAULT 0,
  capital_cents INTEGER NOT NULL DEFAULT 0, payout_cents INTEGER NOT NULL DEFAULT 0, note TEXT,
  PRIMARY KEY (company_id, product_id, month)
);
CREATE INDEX ventures_flows_product ON ventures_flows(product_id, month);
CREATE TABLE ventures_statements (company_id INTEGER NOT NULL REFERENCES ventures_companies(id), month INTEGER NOT NULL, data TEXT NOT NULL,
  revenue_cents INTEGER NOT NULL, net_cents INTEGER NOT NULL, PRIMARY KEY (company_id, month));
CREATE TABLE ventures_purchases (     -- classmate storefront receipts (item_id: the Outfitters item granted, if any)
  id INTEGER PRIMARY KEY, world_id INTEGER NOT NULL, player_id INTEGER NOT NULL REFERENCES players(id), company_id INTEGER NOT NULL REFERENCES ventures_companies(id),
  product_id INTEGER NOT NULL REFERENCES ventures_products(id), month INTEGER NOT NULL, cents INTEGER NOT NULL, source TEXT NOT NULL,
  txn_id INTEGER REFERENCES txns(id), item_id TEXT, item_name TEXT, created INTEGER NOT NULL
);
CREATE INDEX ventures_purchases_player ON ventures_purchases(player_id, world_id);
CREATE TABLE ventures_settings (world_id INTEGER NOT NULL REFERENCES worlds(id), sector TEXT NOT NULL, a_bp INTEGER NOT NULL, b_bp INTEGER NOT NULL, PRIMARY KEY (world_id, sector));   -- the world teacher's demand multipliers
CREATE TABLE ventures_secrets (world_id INTEGER PRIMARY KEY, secret TEXT NOT NULL);   -- the per-world demand noise seed: never sent to a browser
CREATE TABLE ventures_limits (player_id INTEGER NOT NULL, world_id INTEGER NOT NULL, limit_cents INTEGER NOT NULL, PRIMARY KEY (player_id, world_id));   -- from module.credit.limit
CREATE TABLE ventures_valued (player_id INTEGER NOT NULL, world_id INTEGER NOT NULL, cents INTEGER NOT NULL, PRIMARY KEY (player_id, world_id))   -- the last stake announced` },
    { id: '002_rent_refunds', sql: `
-- rent_cents: storefront rent paid at the month start; refund_cents: capital returned to a founder who left before the company opened;
-- rent_missed: months in a row the rent went unpaid (comments stay off the ALTER lines: SQLite copies them into the table's schema text)
ALTER TABLE ventures_flows ADD COLUMN rent_cents INTEGER NOT NULL DEFAULT 0;
ALTER TABLE ventures_flows ADD COLUMN refund_cents INTEGER NOT NULL DEFAULT 0;
ALTER TABLE ventures_companies ADD COLUMN rent_missed INTEGER NOT NULL DEFAULT 0;` },
    { id: '003_payroll_tax_loans', sql: `
-- wave 4b: flows for payroll, the loan, income tax and GST (statements are built from them)
ALTER TABLE ventures_flows ADD COLUMN wages_cents INTEGER NOT NULL DEFAULT 0;           -- gross wages (incl. pay in lieu of notice)
ALTER TABLE ventures_flows ADD COLUMN employer_cents INTEGER NOT NULL DEFAULT 0;        -- the employer's CPP (= employee's) and EI (1.4 x)
ALTER TABLE ventures_flows ADD COLUMN loan_in_cents INTEGER NOT NULL DEFAULT 0;
ALTER TABLE ventures_flows ADD COLUMN principal_cents INTEGER NOT NULL DEFAULT 0;       -- principal repaid in cash
ALTER TABLE ventures_flows ADD COLUMN interest_cents INTEGER NOT NULL DEFAULT 0;        -- interest expense (paid, or added to the loan on a missed payment)
ALTER TABLE ventures_flows ADD COLUMN interest_paid_cents INTEGER NOT NULL DEFAULT 0;
ALTER TABLE ventures_flows ADD COLUMN fee_cents INTEGER NOT NULL DEFAULT 0;             -- late fees (added to the loan)
ALTER TABLE ventures_flows ADD COLUMN forgiven_cents INTEGER NOT NULL DEFAULT 0;        -- a loan forgiven or written off: a gain
ALTER TABLE ventures_flows ADD COLUMN tax_cents INTEGER NOT NULL DEFAULT 0;             -- income tax assessed at year end
ALTER TABLE ventures_flows ADD COLUMN tax_paid_cents INTEGER NOT NULL DEFAULT 0;
ALTER TABLE ventures_flows ADD COLUMN gst_collected_cents INTEGER NOT NULL DEFAULT 0;
ALTER TABLE ventures_flows ADD COLUMN gst_itc_cents INTEGER NOT NULL DEFAULT 0;         -- GST paid on production: input tax credits
ALTER TABLE ventures_flows ADD COLUMN gst_remitted_cents INTEGER NOT NULL DEFAULT 0;    -- negative: a refund
ALTER TABLE ventures_companies ADD COLUMN gst_registered INTEGER NOT NULL DEFAULT 0;
ALTER TABLE ventures_companies ADD COLUMN gst_since INTEGER;                          -- the first month GST is charged
ALTER TABLE ventures_companies ADD COLUMN gst_mandatory INTEGER NOT NULL DEFAULT 0;
ALTER TABLE ventures_companies ADD COLUMN loss_cf_cents INTEGER NOT NULL DEFAULT 0;    -- non-capital losses carried forward
ALTER TABLE ventures_companies ADD COLUMN paydays INTEGER NOT NULL DEFAULT 0;          -- pays made on time
ALTER TABLE ventures_companies ADD COLUMN missed_paydays INTEGER NOT NULL DEFAULT 0;
ALTER TABLE ventures_companies ADD COLUMN missed_month INTEGER;                        -- 6c: the last month payroll was missed (one feed item a month)
CREATE TABLE ventures_postings (id INTEGER PRIMARY KEY, company_id INTEGER NOT NULL REFERENCES ventures_companies(id), title TEXT NOT NULL,
  hourly_cents INTEGER NOT NULL CHECK (hourly_cents >= 1500), hours INTEGER NOT NULL, open INTEGER NOT NULL DEFAULT 1, created_month INTEGER NOT NULL,
  slots INTEGER NOT NULL DEFAULT 1 CHECK (slots BETWEEN 1 AND 5));   -- 6c: places; the posting closes when that many are hired
CREATE TABLE ventures_applications (id INTEGER PRIMARY KEY, posting_id INTEGER NOT NULL REFERENCES ventures_postings(id), company_id INTEGER NOT NULL REFERENCES ventures_companies(id),
  player_id INTEGER NOT NULL REFERENCES players(id), status TEXT NOT NULL CHECK (status IN ('pending', 'approved', 'hired', 'declined', 'withdrawn')),   -- approved: the founders said yes, the teacher has not yet
  month INTEGER NOT NULL, decided_month INTEGER);
CREATE INDEX ventures_applications_company ON ventures_applications(company_id, status);
CREATE TABLE ventures_loans (id INTEGER PRIMARY KEY, company_id INTEGER NOT NULL REFERENCES ventures_companies(id), principal_cents INTEGER NOT NULL, rate_bp INTEGER NOT NULL,
  term_months INTEGER NOT NULL, payment_cents INTEGER NOT NULL, start_month INTEGER NOT NULL, months_paid INTEGER NOT NULL DEFAULT 0, misses INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL CHECK (status IN ('active', 'default', 'paid', 'forgiven', 'settled', 'written_off')), defaulted_month INTEGER, restructured INTEGER NOT NULL DEFAULT 0, ended_month INTEGER);
CREATE INDEX ventures_loans_company ON ventures_loans(company_id, status);
CREATE TABLE ventures_tax (company_id INTEGER NOT NULL REFERENCES ventures_companies(id), year INTEGER NOT NULL, month INTEGER NOT NULL,   -- the mini T2: one row per world year
  income_cents INTEGER NOT NULL, loss_before_cents INTEGER NOT NULL, loss_applied_cents INTEGER NOT NULL, taxable_cents INTEGER NOT NULL, tax_cents INTEGER NOT NULL, loss_cf_cents INTEGER NOT NULL,
  PRIMARY KEY (company_id, year));
CREATE TABLE ventures_gst (company_id INTEGER NOT NULL REFERENCES ventures_companies(id), quarter INTEGER NOT NULL, month INTEGER NOT NULL,   -- the quarterly GST return
  sales_cents INTEGER NOT NULL, collected_cents INTEGER NOT NULL, itc_cents INTEGER NOT NULL, net_cents INTEGER NOT NULL, PRIMARY KEY (company_id, quarter));
CREATE TABLE ventures_policy (world_id INTEGER PRIMARY KEY, policy_bp INTEGER NOT NULL);   -- from module.rates.changed
CREATE TABLE ventures_world (world_id INTEGER PRIMARY KEY, loan_spread_bp INTEGER, hire_approval INTEGER NOT NULL DEFAULT 0)   -- the world teacher's 4b settings` }],

  // 4b: jobs' payday (and a layoff with pay in lieu of notice) asks the company to pay one employee from its treasury.
  services: { payroll },

  events: {
    'module.rates.changed'(k, { worldId, policyBp }) {
      if (ok(worldId) && ok(policyBp) && policyBp >= 0 && policyBp <= 5000) k.db.prepare('INSERT INTO ventures_policy (world_id, policy_bp) VALUES (?, ?) ON CONFLICT (world_id) DO UPDATE SET policy_bp = excluded.policy_bp').run(worldId, policyBp);
    },
    'module.credit.limit'(k, { playerId, worldId, limitCents }) {
      if (ok(playerId) && ok(worldId) && ok(limitCents) && limitCents >= 0) k.db.prepare('INSERT INTO ventures_limits (player_id, world_id, limit_cents) VALUES (?, ?, ?) ON CONFLICT (player_id, world_id) DO UPDATE SET limit_cents = excluded.limit_cents').run(playerId, worldId, limitCents);
    },
  },

  // A business account's people: its founding team and its shareholders get the balance hint (server.js).
  ownersOf(k, { type, id }) {
    if (type !== 'business' || !ok(id)) return [];
    return [...new Set([...qa(k, "SELECT player_id FROM ventures_members WHERE company_id = ? AND status = 'accepted'", id), ...holders(k, id)].map((r) => r.player_id))];
  },

  // Stakes at book value (share of treasury + inventory at cost), before the core resets the treasuries. This is how the treasury reaches the
  // founders' season results pro rata; seasonClose then marks the companies wound up. (It also records each company's value for the history.)
  seasonAssets(k, { worldId }) {
    const out = [];
    for (const c of qa(k, `SELECT * FROM ventures_companies WHERE world_id = ? AND status IN ${inList(LIVE)}`, worldId)) {
      const s = stakes(k, c.id);   // book value net of the loan and taxes owed
      // 4b: open loans and taxes are settled from the treasury before the pay-out (the reset takes the rest); review 6c-1: what the treasury
      // cannot pay of the loan is written off (status written_off, forgiven_cents), not recorded as settled
      settleDebts(k, c, c.ended_month ?? k.world.current()?.month ?? 0, 'system', true);
      k.db.prepare('UPDATE ventures_companies SET wound_up_cents = ? WHERE id = ?').run(s.value, c.id);
      for (const r of s.rows) if (r.cents > 0) out.push({ playerId: r.playerId, cents: r.cents });
    }
    return out;
  },
  seasonClose(k, { world }) {
    k.db.prepare(`UPDATE ventures_companies SET status = 'wound_up', ended_month = ?, note = 'Wound up at season close: the stakes were paid into the season results' WHERE world_id = ? AND status IN ${inList(LIVE)}`).run(world.month, world.id);
    k.db.prepare("UPDATE ventures_companies SET status = 'cancelled', ended_month = ?, note = 'The season closed before approval' WHERE world_id = ? AND status IN ('forming', 'pending')").run(world.month, world.id);
    k.db.prepare('UPDATE ventures_products SET inventory_units = 0, inventory_cost_cents = 0, quantity = 0, active = 0 WHERE company_id IN (SELECT id FROM ventures_companies WHERE world_id = ?)').run(world.id);
    // 6c: the job board closes with the season (jobs' own seasonClose ends the part-time jobs themselves)
    k.db.prepare('UPDATE ventures_postings SET open = 0 WHERE company_id IN (SELECT id FROM ventures_companies WHERE world_id = ?)').run(world.id);
    k.db.prepare("UPDATE ventures_applications SET status = 'withdrawn', decided_month = ? WHERE status IN ('pending', 'approved') AND company_id IN (SELECT id FROM ventures_companies WHERE world_id = ?)").run(world.month, world.id);
  },

  panels: [{ id: 'ventures', building: { key: 'venture-row', name: 'Venture Row', icon: 'registry' }, src: 'ventures.js' }],
  teacherPanels: [{ id: 'ventures-teach', title: 'Venture Row', src: 'teach.js' }],

  onTick: tick,
  simulate: bots,

  routes: [
    { method: 'GET', path: '/state', access: 'student', handler: (k, { user }) => state(k, user) },
    {
      method: 'POST', path: '/register', access: 'student',
      handler: (k, { user, body }) => register(k, user, { name: k.input.str(body, 'name', { max: 60 }), sector: k.input.str(body, 'sector', { max: 40 }), plan: k.input.str(body, 'plan', { max: PLAN_MAX }), cofounders: k.input.str(body, 'cofounders', { max: 200 }) }),
    },
    { method: 'POST', path: '/respond', access: 'student', handler: (k, { user, body }) => respond(k, user, k.input.int(body, 'id', { min: 1 }), k.input.bool(body, 'accept')) },
    { method: 'POST', path: '/split', access: 'student', handler: (k, { user, body }) => setSplit(k, user, k.input.int(body, 'id', { min: 1 }), k.input.str(body, 'split', { max: 40 })) },
    { method: 'POST', path: '/confirm', access: 'student', handler: (k, { user, body }) => confirmSplit(k, user, k.input.int(body, 'id', { min: 1 })) },
    { method: 'POST', path: '/cancel', access: 'student', handler: (k, { user, body }) => cancel(k, user, k.input.int(body, 'id', { min: 1 })) },
    { method: 'POST', path: '/capital', access: 'student', handler: (k, { user, body }) => capitalise(k, user, k.input.int(body, 'id', { min: 1 }), k.input.int(body, 'cents', { min: 1, max: MAX_CENTS })) },
    {
      method: 'POST', path: '/product', access: 'student',
      handler: (k, { user, body }) => setProduct(k, user, k.input.int(body, 'id', { min: 1 }), k.input.str(body, 'product', { max: 20 }), k.input.int(body, 'price_cents', { min: 1, max: MAX_CENTS }), k.input.int(body, 'quantity', { min: 0, max: MAX_QUANTITY })),
    },
    { method: 'POST', path: '/drop', access: 'student', handler: (k, { user, body }) => dropProduct(k, user, k.input.int(body, 'id', { min: 1 }), k.input.str(body, 'product', { max: 20 })) },
    { method: 'POST', path: '/buy', access: 'student', handler: (k, { user, body }) => buy(k, user, k.input.int(body, 'id', { min: 1 }), k.input.str(body, 'source', { max: 16 }) || 'chequing') },
    {
      method: 'POST', path: '/leave', access: 'student',   // before the company opens, any founder may leave: capital back, the shares re-split equally
      handler(k, { user, body }) {
        const id = k.input.int(body, 'id', { min: 1 });
        needWorld(k);
        return k.db.txn((tx) => {
          const { c, m } = memberOf(k, user, id);
          mustBe(m.status === 'accepted', 409, 'You are not on that team');
          dropMember(k, c, user.id, `player:${user.id}`, `${nameOf(k, user.id)} left`);
          k.audit('leave', { id, playerId: user.id }, `player:${user.id}`);
          tx.onCommit(() => { const now = company(k, id); if (LIVE.includes(now.status)) announce(k, k.world.current(), id); });
          changed(k, tx, c.class_id);
          return { ok: true, status: company(k, id).status };
        });
      },
    },
    {
      method: 'POST', path: '/remove', access: 'student',   // founders who have paid in remove one who has not, 2+ world months after approval
      handler(k, { user, body }) {
        const id = k.input.int(body, 'id', { min: 1 }), who = k.input.str(body, 'username', { max: 40 }).trim().toLowerCase(), w = needWorld(k);
        return k.db.txn((tx) => {
          const { c, m } = memberOf(k, user, id, ['approved']);
          mustBe(m.status === 'accepted' && capitalBy(k, id, user.id) >= MIN_CAPITAL_CENTS, 403, `Only a founder who has paid in ${money(MIN_CAPITAL_CENTS)} can remove one who has not`);
          const t = members(k, id).find((x) => nameOf(k, x.player_id).toLowerCase() === who && x.status === 'accepted');
          mustBe(t && t.player_id !== user.id, 404, 'No such founder on your team');
          mustBe(capitalBy(k, id, t.player_id) < MIN_CAPITAL_CENTS, 409, `${nameOf(k, t.player_id)} has paid in`);
          mustBe(w.month >= c.approved_month + UNPAID_REMOVE_MONTHS, 409, `A founder has until world month ${c.approved_month + UNPAID_REMOVE_MONTHS} to pay in`);
          dropMember(k, c, t.player_id, `player:${user.id}`, `${nameOf(k, t.player_id)} was removed: no capital paid in`);
          k.audit('remove', { id, playerId: t.player_id }, `player:${user.id}`);
          tx.onCommit(() => { const now = company(k, id); if (LIVE.includes(now.status)) announce(k, k.world.current(), id); });
          changed(k, tx, c.class_id);
          return { ok: true, status: company(k, id).status };
        });
      },
    },
    {
      method: 'POST', path: '/vote-dissolve', access: 'student',   // unanimous founders dissolve the company; approve: false takes a vote back
      handler(k, { user, body }) {
        const id = k.input.int(body, 'id', { min: 1 }), yes = k.input.bool(body, 'approve'), w = needWorld(k);
        return k.db.txn((tx) => {
          const { c, m } = memberOf(k, user, id, LIVE);
          mustBe(m.status === 'accepted', 403, 'Only a founder can vote');
          k.db.prepare('UPDATE ventures_members SET dissolve_vote = ? WHERE company_id = ? AND player_id = ?').run(yes ? 1 : 0, id, user.id);
          const all = members(k, id).every((x) => x.dissolve_vote);
          if (yes && all) { dissolve(k, c, `player:${user.id}`, 'Dissolved by its founders (unanimous)'); afterDissolve(k, tx, w, c); } else changed(k, tx, c.class_id);
          return { ok: true, dissolved: yes && all };
        });
      },
    },

    // ---- 4b: hiring, payroll, GST, the Venture Bank ----
    { method: 'GET', path: '/openings', access: 'student', handler: (k, { user }) => openings(k, user) },   // the Job Centre lists these beside the catalogue
    { method: 'POST', path: '/apply', access: 'student', handler: (k, { user, body }) => applyJob(k, user, k.input.int(body, 'posting_id', { min: 1 })) },
    {
      method: 'POST', path: '/withdraw', access: 'student',
      handler(k, { user, body }) {
        const id = k.input.int(body, 'application_id', { min: 1 });
        needWorld(k);
        return k.db.txn(() => {
          mustBe(k.db.prepare("UPDATE ventures_applications SET status = 'withdrawn', decided_month = ? WHERE id = ? AND player_id = ? AND status IN ('pending', 'approved')").run(k.world.current().month, id, user.id).changes, 404, 'No such waiting application');
          return { ok: true };
        });
      },
    },
    {
      method: 'POST', path: '/post-job', access: 'student',
      handler: (k, { user, body }) => postJob(k, user, k.input.int(body, 'id', { min: 1 }), k.input.str(body, 'title', { max: 60 }), k.input.int(body, 'hourly_cents', { min: 1, max: 100000 }), k.input.int(body, 'hours', { min: 1, max: 1000 }),
        k.input.int(body, 'slots', { min: 1, max: MAX_SLOTS, optional: true }) ?? 1),
    },
    { method: 'POST', path: '/close-job', access: 'student', handler: (k, { user, body }) => closeJob(k, user, k.input.int(body, 'id', { min: 1 }), k.input.int(body, 'posting_id', { min: 1 })) },
    { method: 'POST', path: '/hire', access: 'student', handler: (k, { user, body }) => decideHire(k, user, k.input.int(body, 'id', { min: 1 }), k.input.int(body, 'application_id', { min: 1 }), k.input.bool(body, 'approve')) },
    { method: 'POST', path: '/layoff', access: 'student', handler: (k, { user, body }) => layoff(k, user, k.input.int(body, 'id', { min: 1 }), k.input.int(body, 'player_id', { min: 1 }), k.input.str(body, 'mode', { max: 16 })) },
    {
      method: 'POST', path: '/gst', access: 'student',   // register for GST voluntarily (it starts next month; there is no deregistering this season)
      handler(k, { user, body }) {
        const id = k.input.int(body, 'id', { min: 1 }), w = needWorld(k);
        return k.db.txn((tx) => {
          const { c } = founderOf(k, user, id, ['active', 'frozen']);
          mustBe(!c.gst_registered, 409, 'Already registered for GST');
          k.db.prepare('UPDATE ventures_companies SET gst_registered = 1, gst_since = ? WHERE id = ?').run(w.month + 1, id);
          k.audit('gst', { id, since: w.month + 1 }, `player:${user.id}`);
          changed(k, tx, c.class_id);
          return { ok: true, since: w.month + 1 };
        });
      },
    },
    { method: 'POST', path: '/borrow', access: 'student', handler: (k, { user, body }) => borrow(k, user, k.input.int(body, 'id', { min: 1 }), k.input.int(body, 'cents', { min: 1, max: MAX_CENTS }), k.input.int(body, 'term', { min: 1, max: 120 })) },

    // ---- teacher ----
    { method: 'GET', path: '/teach', access: 'teacher', handler: (k, { user }) => teachView(k, user) },
    {
      method: 'POST', path: '/hire-approve', access: 'teacher',   // when hire approval is on: the teacher's yes (or no) after the founders'
      handler(k, { user, body }) {
        const id = k.input.int(body, 'application_id', { min: 1 }), approve = k.input.bool(body, 'approve');
        needWorld(k);
        return k.db.txn((tx) => {
          const a = q1(k, "SELECT * FROM ventures_applications WHERE id = ? AND status = 'approved'", id);
          mustBe(a, 404, 'No such application waiting for you');
          const c = teacherCompany(k, user, a.company_id);
          if (approve) hireNow(k, a, `player:${user.id}`);   // the hirer in the feed: the registrant
          else k.db.prepare("UPDATE ventures_applications SET status = 'declined', decided_month = ? WHERE id = ?").run(k.world.current().month, id);
          changed(k, tx, c.class_id);
          return { ok: true, status: approve ? 'hired' : 'declined' };
        });
      },
    },
    {
      method: 'POST', path: '/resolve', access: 'teacher',   // a loan in default: forgive, restructure (term_months) or dissolve
      handler(k, { user, body }) {
        const id = k.input.int(body, 'id', { min: 1 }), action = k.input.str(body, 'action', { max: 16 }), term = k.input.int(body, 'term_months', { min: 1, max: 120, optional: true }), w = needWorld(k);
        return k.db.txn((tx) => {
          const c = teacherCompany(k, user, id);
          const r = resolveLoan(k, c, action, term, `player:${user.id}`);
          if (action === 'dissolve') afterDissolve(k, tx, w, c); else { tx.onCommit(() => announce(k, w, id)); changed(k, tx, c.class_id); }
          return { ok: true, paid: r.paid ?? [] };
        });
      },
    },
    {
      method: 'POST', path: '/finance-settings', access: 'teacher',   // the world teacher: the Venture Bank's spread, and whether hires need a teacher's approval
      handler(k, { user, body }) {
        k.policy.assert(user, 'world.settings');
        const spread = k.input.int(body, 'loan_spread_bp', { min: 0, max: 2000, optional: true }), approval = body.hire_approval === undefined ? undefined : k.input.bool(body, 'hire_approval');
        const w = needWorld(k), cur = worldCfg(k, w.id);
        k.db.txn((tx) => {
          k.db.prepare('INSERT INTO ventures_world (world_id, loan_spread_bp, hire_approval) VALUES (?, ?, ?) ON CONFLICT (world_id) DO UPDATE SET loan_spread_bp = excluded.loan_spread_bp, hire_approval = excluded.hire_approval')
            .run(w.id, spread ?? cur.loan_spread_bp, approval === undefined ? cur.hire_approval : approval ? 1 : 0);
          k.audit('finance_settings', { worldId: w.id, loan_spread_bp: spread ?? null, hire_approval: approval ?? null }, `player:${user.id}`);
          changed(k, tx, null);
        });
        return { ok: true, ...worldCfg(k, w.id) };
      },
    },
    {
      method: 'GET', path: '/company/:id', access: 'any',   // full books: the founders, or a teacher who may act on it; anyone else sees the public summary
      handler(k, { user, params }) {
        const w = k.world.current(), c = company(k, k.input.idParam(params.id));
        mustBe(w && c && c.world_id === w.id && c.status !== 'cancelled', 404, 'Not found');
        const founder = user.role === 'student' && q1(k, "SELECT 1 FROM ventures_members WHERE company_id = ? AND player_id = ? AND status = 'accepted'", c.id, user.id);
        const teacher = user.role === 'teacher' && (k.policy.can(user, 'world.settings') || k.policy.can(user, 'class.read', { classId: c.class_id }));
        if (founder || teacher) return fullView(k, w, c);
        mustBe(['active', 'frozen'].includes(c.status), 404, 'Not found');
        return publicView(k, c);
      },
    },
    {
      method: 'POST', path: '/approve', access: 'teacher',
      handler(k, { user, body }) {
        const id = k.input.int(body, 'id', { min: 1 }), approve = k.input.bool(body, 'approve'), text = k.input.str(body, 'note', { max: 200 }).trim();
        return k.db.txn((tx) => { const c = teacherCompany(k, user, id); decide(k, c, approve, text, `player:${user.id}`); changed(k, tx, c.class_id); return { ok: true, status: company(k, id).status }; });
      },
    },
    {
      method: 'POST', path: '/rename', access: 'teacher',
      handler(k, { user, body }) {
        const id = k.input.int(body, 'id', { min: 1 }), name = k.input.str(body, 'name', { max: 60 }).trim();
        return k.db.txn((tx) => {
          const c = teacherCompany(k, user, id);
          mustBe(!['cancelled', 'declined', 'dissolved', 'wound_up'].includes(c.status), 409, `That company is ${c.status}`);
          const why = nameProblem(k, name, c.world_id, c.id);
          mustBe(!why, 400, why);
          k.db.prepare('UPDATE ventures_companies SET name = ? WHERE id = ?').run(name, id);
          k.audit('rename', { id, from: c.name, to: name }, `player:${user.id}`);
          changed(k, tx, c.class_id);
          return { ok: true, name };
        });
      },
    },
    {
      method: 'POST', path: '/freeze', access: 'teacher',   // frozen: no production, no sales; the books are still written
      handler(k, { user, body }) {
        const id = k.input.int(body, 'id', { min: 1 }), frozen = k.input.bool(body, 'frozen');
        needWorld(k);
        return k.db.txn((tx) => {
          const c = teacherCompany(k, user, id);
          mustBe(frozen ? c.status === 'active' : c.status === 'frozen', 409, frozen ? 'Only an active company can be frozen' : 'That company is not frozen');
          mustBe(frozen || openLoan(k, id)?.status !== 'default', 409, 'Its Venture Bank loan is in default: resolve the loan (forgive, restructure or dissolve) to reopen it');
          k.db.prepare('UPDATE ventures_companies SET status = ?, rent_missed = 0 WHERE id = ?').run(frozen ? 'frozen' : 'active', id);
          k.audit(frozen ? 'freeze' : 'unfreeze', { id }, `player:${user.id}`);
          changed(k, tx, c.class_id);
          return { ok: true, status: frozen ? 'frozen' : 'active' };
        });
      },
    },
    {
      method: 'POST', path: '/dissolve', access: 'teacher',
      handler(k, { user, body }) {
        const id = k.input.int(body, 'id', { min: 1 }), w = needWorld(k);
        return k.db.txn((tx) => {
          const c = teacherCompany(k, user, id);
          const r = dissolve(k, c, `player:${user.id}`, 'Dissolved by your teacher');
          afterDissolve(k, tx, w, c);
          return { ok: true, paid: r.paid };
        });
      },
    },
    {
      method: 'POST', path: '/sector', access: 'teacher',   // the world teacher's demand settings for one sector (multipliers of a and b, from the next tick)
      handler(k, { user, body }) {
        k.policy.assert(user, 'world.settings');
        const sector = k.input.str(body, 'sector', { max: 40 }), a = k.input.int(body, 'a_bp', { min: SETTING_MIN_BP, max: SETTING_MAX_BP }), b = k.input.int(body, 'b_bp', { min: SETTING_MIN_BP, max: SETTING_MAX_BP });
        mustBe(SECTORS.includes(sector), 400, `Pick a sector: ${SECTORS.join(', ')}`);
        const w = needWorld(k);
        k.db.txn((tx) => {
          k.db.prepare('INSERT INTO ventures_settings (world_id, sector, a_bp, b_bp) VALUES (?, ?, ?, ?) ON CONFLICT (world_id, sector) DO UPDATE SET a_bp = excluded.a_bp, b_bp = excluded.b_bp').run(w.id, sector, a, b);
          k.audit('sector', { worldId: w.id, sector, a_bp: a, b_bp: b }, `player:${user.id}`);
          changed(k, tx, null);
        });
        return { ok: true, sector, a_bp: a, b_bp: b };
      },
    },
  ],
});
