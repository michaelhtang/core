// ventures: what the browser sees: company, state and teacher views.
import {
  SECTORS, FOUNDING_COURSES, MIN_CAPITAL_CENTS, FOUNDER_UNITS, MAX_PRODUCTS, PRICE_CAP_X, PRODUCTS, productType, SPOILAGE_BP, ELASTICITY, COST_URL, MINUTE_CENTS, SETTING_MIN_BP, SETTING_MAX_BP, bandOf, JOURNAL, UNIT, INCUMBENT_REF_BP, UNPAID_REMOVE_MONTHS, TAX_RATE_BP, GST_THRESHOLD_CENTS,
} from './constants.js';
import { demandAt, incumbentPrice } from './demand.js';
import { LIVE, q1, qa, company, members, holders, products, cashOf, inventoryOf, valueOf, nameOf, capitalBy, teamOf, settingOf, curveOf, costOf, rentOf, capsOf, townSize, note, mustBe, loanOwed, openLoan, flowSum, taxOwed, worldCfg, spreadOf, policyOf, staffOf } from './reads.js';
import { finance, financeView } from './finance.js';
import { spentBy, limitOf } from './market.js';

// ---- views ----
export const pct = (units) => Math.round((units * 10000) / FOUNDER_UNITS);   // bp of the founder shares
export function sectorView(k, w, sector, n) {
  const s = settingOf(k, w.id, sector);
  const rivals = new Map(qa(k, "SELECT p.type_key, COUNT(*) AS n FROM ventures_products p JOIN ventures_companies c ON c.id = p.company_id WHERE c.world_id = ? AND c.status = 'active' AND p.active = 1 AND c.sector = ? GROUP BY p.type_key", w.id, sector).map((r) => [r.type_key, r.n]));
  return {
    sector, a_bp: s.a_bp, b_bp: s.b_bp, spoilage_bp: SPOILAGE_BP[sector] ?? 0, elasticity: ELASTICITY[sector] ?? 'average',
    products: PRODUCTS.filter((t) => t.sector === sector).map((t) => {
      const cv = curveOf(k, w, t, n), cost = costOf(k, w, t);
      return { key: t.key, name: t.name, materials_cents: Math.round((t.materials_cents * k.world.priceIndex(w.id)) / 10000), minutes: t.minutes, unit_cost_cents: cost, cap_cents: cost * PRICE_CAP_X,
        a: Math.round(cv.a * 100) / 100, b: Math.round(cv.b * 10000) / 10000, choke_cents: cv.choke_cents, best_cents: Math.min(cv.best_cents, cost * PRICE_CAP_X), shop_cents: incumbentPrice(cv, INCUMBENT_REF_BP), sellers: rivals.get(t.key) ?? 0 };
    }),
  };
}
export const lastStatement = (k, id) => { const r = q1(k, 'SELECT data FROM ventures_statements WHERE company_id = ? ORDER BY month DESC LIMIT 1', id); return r ? JSON.parse(r.data) : null; };
export const publicView = (k, c) => {
  const st = lastStatement(k, c.id);
  return { id: c.id, name: c.name, sector: c.sector, status: c.status, since_month: c.active_month ?? c.approved_month, revenue_band: st ? bandOf(st.income.revenue_cents) : 'New',
    profitable: st ? st.income.net_cents > 0 : null, statement_month: st?.month ?? null };
};
// Everything about one company: for its founders and for a teacher who may read it.
export function fullView(k, w, c) {
  const ms = qa(k, 'SELECT * FROM ventures_members WHERE company_id = ? ORDER BY seq', c.id);
  const shares = new Map(holders(k, c.id).map((h) => [h.player_id, h.units_micro]));
  const acct = k.ledger.accountId('business', c.id, 'treasury');
  const last = lastStatement(k, c.id);
  const t0 = last?.month ?? null;
  const n = townSize(k);
  return {
    ...publicView(k, c), plan: c.plan, class_id: c.class_id, rep_bp: c.rep_bp, created_month: c.created_month, approved_month: c.approved_month, ended_month: c.ended_month, note: c.note,
    founder: nameOf(k, c.founder_id), min_capital_cents: MIN_CAPITAL_CENTS, wound_up_cents: c.wound_up_cents, rent_cents: rentOf(k, w), rent_missed: c.rent_missed,
    can_leave: ['forming', 'pending', 'approved'].includes(c.status), remove_from_month: c.status === 'approved' ? c.approved_month + UNPAID_REMOVE_MONTHS : null,
    members: ms.map((m) => ({ username: nameOf(k, m.player_id), player_id: m.player_id, status: m.status, share_bp: pct(m.units_micro), confirmed: !!m.confirmed, capital_cents: capitalBy(k, c.id, m.player_id), dissolve_vote: !!m.dissolve_vote, registrant: m.player_id === c.founder_id })),
    cap_table: [...shares].map(([pid, units]) => ({ username: nameOf(k, pid), units_micro: units, shares: units / UNIT, share_bp: pct(units) })),
    treasury_cents: cashOf(k, c.id), inventory_cents: inventoryOf(k, c.id), value_cents: valueOf(k, c.id),
    products: products(k, c.id).map((p) => {
      const t = productType(p.type_key), cost = costOf(k, w, t), cv = curveOf(k, w, t, n);
      const lm = t0 === null ? null : q1(k, 'SELECT * FROM ventures_flows WHERE product_id = ? AND month = ?', p.id, t0);
      const nm = q1(k, 'SELECT note FROM ventures_flows WHERE product_id = ? AND month = ?', p.id, w.month)?.note ?? null;
      return { id: p.id, key: p.type_key, name: t.name, price_cents: p.price_cents, quantity: p.quantity, inventory_units: p.inventory_units, inventory_cost_cents: p.inventory_cost_cents,
        unit_cost_cents: cost, cap_cents: cost * PRICE_CAP_X, next_run_cents: cost * p.quantity, a: cv.a, b: cv.b, choke_cents: cv.choke_cents, best_cents: cv.best_cents, shop_cents: incumbentPrice(cv, INCUMBENT_REF_BP),
        demand_at_price: Math.floor(demandAt(cv, p.price_cents)), note: nm,
        last: lm && { month: t0, demand_units: lm.demand_units, sold_units: lm.npc_units + lm.store_units, revenue_cents: lm.npc_cents + lm.store_cents, cost_cents: lm.cogs_cents + lm.spoilage_cents, margin_cents: lm.npc_cents + lm.store_cents - lm.cogs_cents - lm.spoilage_cents } };
    }),
    next_run_cents: products(k, c.id).reduce((t, p) => t + p.quantity * costOf(k, w, productType(p.type_key)), 0) + (c.status === 'active' ? rentOf(k, w) : 0),
    statements: qa(k, 'SELECT data FROM ventures_statements WHERE company_id = ? ORDER BY month DESC LIMIT 12', c.id).map((r) => JSON.parse(r.data)),
    journal: acct ? k.ledger.statement(acct, { limit: 100 }).map((e) => ({ id: e.id, txn_id: e.txn_id, kind: e.kind, memo: e.memo, cents: e.amount_cents, balance_cents: e.balance_cents, ...(JOURNAL[e.kind] ?? { debit: e.amount_cents > 0 ? 'Cash' : '', credit: e.amount_cents < 0 ? 'Cash' : '' }) })) : [],
    sector_view: sectorView(k, w, c.sector, n),
    finance: LIVE.includes(c.status) || c.status === 'dissolved' ? financeView(k, w, c) : null,   // 4b
  };
}

export function state(k, user) {
  const w = k.world.current();
  mustBe(w, 409, 'There is no active world');
  const cls = k.players.classOf(user.id), n = townSize(k);
  const mine = teamOf(k, w.id, user.id);
  const invites = qa(k, "SELECT c.* FROM ventures_members m JOIN ventures_companies c ON c.id = m.company_id WHERE m.player_id = ? AND m.status = 'invited' AND c.status = 'forming' AND c.world_id = ? ORDER BY c.id", user.id, w.id);
  const board = qa(k, "SELECT * FROM ventures_companies WHERE world_id = ? AND status IN ('active', 'frozen') ORDER BY name", w.id);
  const chq = k.ledger.accountId('player', user.id, 'chequing'), card = k.ledger.accountId('player', user.id, 'card'), limit = card ? limitOf(k, user.id, w.id) : undefined;
  const caps = capsOf(k), spent = spentBy(k, user.id, w);
  return {
    month: w.month, open: w.status === 'active', town_size: n, can_found: w.status === 'active' && !!cls && FOUNDING_COURSES.includes(cls.course_id) && !mine,
    founding_course: !!cls && FOUNDING_COURSES.includes(cls.course_id), min_capital_cents: MIN_CAPITAL_CENTS, max_products: MAX_PRODUCTS, price_cap_x: PRICE_CAP_X,
    minute_cents: MINUTE_CENTS, cost_url: COST_URL, sectors: SECTORS,
    mine: mine ? fullView(k, w, mine) : null,
    last_declined: mine ? null : (() => { const d = q1(k, "SELECT c.name, c.status, c.note FROM ventures_members m JOIN ventures_companies c ON c.id = m.company_id WHERE m.player_id = ? AND c.world_id = ? AND c.status IN ('declined', 'cancelled') ORDER BY c.id DESC LIMIT 1", user.id, w.id); return d ?? null; })(),
    invites: invites.map((c) => ({ id: c.id, name: c.name, sector: c.sector, plan: c.plan, founder: nameOf(k, c.founder_id), members: members(k, c.id).map((m) => ({ username: nameOf(k, m.player_id), status: m.status, share_bp: pct(m.units_micro) })) })),
    board: board.map((c) => ({ ...publicView(k, c), mine: mine?.id === c.id,
      allowance_cents: Math.max(0, Math.min(caps.company - spentBy(k, user.id, w, c.id).company, caps.month - spent.month)),
      products: c.status === 'active' ? products(k, c.id).map((p) => ({ id: p.id, name: productType(p.type_key).name, price_cents: p.price_cents, in_stock: p.inventory_units > 0 })) : [] })),
    sector_views: SECTORS.map((s) => sectorView(k, w, s, n)),
    pay: { chequing_cents: chq ? k.ledger.balance(chq) : 0, card_available_cents: card && limit !== undefined ? Math.max(0, k.ledger.balance(card) + limit) : null,
      cap_company_cents: caps.company, cap_month_cents: caps.month, left_month_cents: Math.max(0, caps.month - spent.month) },
    rent_cents: rentOf(k, w),
    receipts: qa(k, 'SELECT r.month, r.cents, r.source, r.item_name, p.type_key, c.name AS company FROM ventures_purchases r JOIN ventures_products p ON p.id = r.product_id JOIN ventures_companies c ON c.id = r.company_id WHERE r.player_id = ? AND r.world_id = ? ORDER BY r.id DESC LIMIT 20', user.id, w.id)
      .map((r) => ({ month: r.month, cents: r.cents, source: r.source, item: r.item_name, product: productType(r.type_key)?.name ?? r.type_key, company: r.company })),
  };
}

// A teacher may act on a company in a class they teach, and the world teacher on any (lib/policy.js); anyone else gets a 404.
export function teacherCompany(k, user, id) {
  const c = company(k, id);
  mustBe(c && c.world_id === k.world.current()?.id, 404, 'Not found');
  if (!k.policy.can(user, 'world.settings')) k.policy.assert(user, 'class.manage', { classId: c.class_id });
  return c;
}
export function teachView(k, user) {
  const w = k.world.current();
  mustBe(w, 409, 'There is no active world');
  const classes = k.players.classesFor(user), n = townSize(k);
  return {
    month: w.month, can_settings: k.policy.can(user, 'world.settings'), town_size: n, min_bp: SETTING_MIN_BP, max_bp: SETTING_MAX_BP, rent_cents: rentOf(k, w), caps: capsOf(k),
    finance: { loan_spread_bp: spreadOf(k, w.id), policy_bp: policyOf(k, w.id), hire_approval: !!worldCfg(k, w.id).hire_approval, tax_rate_bp: TAX_RATE_BP, gst_threshold_cents: GST_THRESHOLD_CENTS },   // 4b
    town_companies: q1(k, "SELECT COUNT(*) AS n FROM ventures_companies WHERE world_id = ? AND status = 'active'", w.id).n,
    settings: SECTORS.map((s) => ({ sector: s, ...settingOf(k, w.id, s), spoilage_bp: SPOILAGE_BP[s] ?? 0 })),
    classes: classes.map((cl) => ({ id: cl.id, name: cl.name, course_id: cl.course_id,
      companies: qa(k, "SELECT * FROM ventures_companies WHERE world_id = ? AND class_id = ? AND status <> 'cancelled' ORDER BY (status = 'pending') DESC, id", w.id, cl.id).map((c) => {
        const st = lastStatement(k, c.id);
        return { id: c.id, name: c.name, sector: c.sector, status: c.status, plan: c.plan, note: c.note, rep_bp: c.rep_bp, created_month: c.created_month, rent_missed: c.rent_missed,
          founders: members(k, c.id).map((m) => ({ username: nameOf(k, m.player_id), status: m.status, share_bp: pct(m.units_micro), confirmed: !!m.confirmed, capital_cents: capitalBy(k, c.id, m.player_id) })),
          treasury_cents: cashOf(k, c.id), inventory_cents: inventoryOf(k, c.id), products: products(k, c.id).length,
          revenue_cents: st?.income.revenue_cents ?? null, net_cents: st?.income.net_cents ?? null, statement_month: st?.month ?? null, balanced: st ? st.balance.balanced : null,
          ...(() => {   // 4b
            const l = openLoan(k, c.id), live = LIVE.includes(c.status);
            return { staff: live ? staffOf(k, c.id).length : 0, payroll: c.missed_paydays ? `${c.missed_paydays} missed, ${c.paydays} paid` : c.paydays ? `on time (${c.paydays} paid)` : 'no payroll yet',
              paydays: c.paydays, missed_paydays: c.missed_paydays, loans_cents: loanOwed(k, c.id), loan_status: l?.status ?? null, loan_misses: l?.misses ?? 0,
              tax_cents: flowSum(k, c.id, 'tax_paid_cents'), tax_owed_cents: taxOwed(k, c.id), gst_registered: !!c.gst_registered,
              hires: qa(k, "SELECT a.id, a.player_id, p.title FROM ventures_applications a JOIN ventures_postings p ON p.id = a.posting_id WHERE a.company_id = ? AND a.status = 'approved' ORDER BY a.id", c.id).map((a) => ({ id: a.id, username: nameOf(k, a.player_id), title: a.title })) };
          })() };
      }) })),
  };
}
