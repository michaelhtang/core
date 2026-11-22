// ventures: the simulation bots (scripts/sim.mjs), including the 4b hiring and borrowing bots.
import { dice } from '../../lib/kernel.js';
import {
  SECTORS, FOUNDING_COURSES, MIN_CAPITAL_CENTS, MAX_QUANTITY, PRICE_CAP_X, PRODUCTS, productType, SPOILAGE_BP, INCUMBENT_REF_BP, LOAN_MIN_CENTS,
} from './constants.js';
import { demandAt, bestAgainstShop } from './demand.js';
import { BUSINESS_MIN_HOURS, BUSINESS_MAX_HOURS } from '../jobs/catalogue.js';
import { q1, qa, company, members, products, cashOf, nameOf, chequing, teamOf, curveOf, costOf, rentOf, townSize, minWageOf, openLoan, staffOf } from './reads.js';
import { loanOffer } from './finance.js';
import { register, respond, decide, capitalise } from './founding.js';
import { setProduct, buy } from './market.js';
import { postJob, closeJob, applyJob, decideHire, layoff } from './staff.js';
import { borrow } from './bank.js';

// ---- 4b bots ----
// Cash a bot company keeps back from production: next month's payroll (gross + about 8% employer costs) and the loan payment.
export const reserveOf = (k, c) => staffOf(k, c.id).reduce((t, s) => t + Math.ceil(s.hourlyCents * s.hoursPerMonth * 1.08), 0) + (openLoan(k, c.id)?.status === 'active' ? openLoan(k, c.id).payment_cents : 0);
// A bot company with 3 statements: losing money -> one month's notice to its newest hire; profitable -> a third of them borrow once (up to $2,000
// over 24 months), and it hires 1 to 3 staff at $16.00/h (or the minimum x the price index, if higher) for the hours 60% of its average net income
// pays (10 to 40 h, part-time on top of the bot's catalogue job), while the treasury holds 3 months of payroll. 60% of FinTech 10 bots accept such
// a job (apply; the bot founder approves), once a season; jobs' bots quit it when the company misses 2 pays. Slots and MAX_STAFF hold (hireNow).
export const BOT_WAGE = 1600;
export function bots4b(k, w, month, students, tryIt) {
  if (!k.modules.has('jobs')) return;
  const asUser = (id) => ({ id, username: nameOf(k, id), class_id: k.players.get(id)?.class_id });
  const comps = qa(k, "SELECT * FROM ventures_companies WHERE world_id = ? AND status = 'active' AND name LIKE 'Bot Venture %' ORDER BY id", w.id);
  const busy = new Set(comps.flatMap((c) => staffOf(k, c.id).map((s) => s.playerId)));
  for (const c of comps) for (const m of members(k, c.id)) busy.add(m.player_id);
  for (const r of qa(k, "SELECT a.player_id FROM ventures_applications a JOIN ventures_companies c ON c.id = a.company_id WHERE c.world_id = ? AND a.status = 'hired'", w.id)) busy.add(r.player_id);   // a bot tries a company job once a season
  const takers = students.filter((s) => k.players.classOf(s.id)?.course_id === 'fintech10' && dice(s.id, 0, 41) < 60);
  for (const c of comps) {
    const st = qa(k, 'SELECT net_cents FROM ventures_statements WHERE company_id = ? ORDER BY month DESC LIMIT 3', c.id);
    if (st.length < 3) continue;
    const avg = st.reduce((t, r) => t + r.net_cents, 0) / 3, staff = staffOf(k, c.id), lead = asUser(c.founder_id);
    if (avg < 0) {
      const last = staff.filter((x) => x.endsMonth === null).at(-1);
      if (last) tryIt(() => layoff(k, lead, c.id, last.playerId, 'notice'));
      continue;
    }
    if (c.id % 3 === 0 && !q1(k, 'SELECT 1 FROM ventures_loans WHERE company_id = ?', c.id)) {   // a third of them (k.dice is correlated with the founding draw)
      const max = loanOffer(k, w, c).max_cents;
      if (max >= LOAN_MIN_CENTS) tryIt(() => borrow(k, lead, c.id, Math.min(max, 200000), 24));
    }
    const wage = Math.max(BOT_WAGE, minWageOf(k, w.id)), hours = Math.min(BUSINESS_MAX_HOURS, Math.floor((avg * 0.6) / (wage * 1.08)));
    if (staff.length >= 3 || hours < BUSINESS_MIN_HOURS || cashOf(k, c.id) < 3 * (reserveOf(k, c) + hours * wage * 1.08)) continue;
    const pick = takers.filter((s) => !busy.has(s.id));
    if (!pick.length) continue;
    const who = pick[dice(c.id, month, 45) % pick.length];
    // review 6c-2: postings under today's wage or at other hours are closed first (their applicants are told), so a stale one never blocks hiring
    for (const p of qa(k, 'SELECT id FROM ventures_postings WHERE company_id = ? AND open = 1 AND (hourly_cents < ? OR hours <> ?)', c.id, wage, hours)) tryIt(() => closeJob(k, lead, c.id, p.id));
    const posting = q1(k, 'SELECT id FROM ventures_postings WHERE company_id = ? AND open = 1 AND hours = ? AND hourly_cents >= ? LIMIT 1', c.id, hours, wage)?.id ?? tryIt(() => postJob(k, lead, c.id, 'Shop assistant', wage, hours))?.posting_id;
    const a = posting && tryIt(() => applyJob(k, asUser(who.id), posting));
    if (a && tryIt(() => decideHire(k, lead, c.id, a.application_id, true))) busy.add(who.id);   // one place: the posting closed itself
  }
}


// ---- bots (scripts/sim.mjs) ----
// 30% of FT20/30 bots form teams of 2-3 in their class at their first month, the bot teacher approves, each puts in $150, and they sell 1 to 3
// products priced near the revenue-maximising price against the town shop (+-15%), making about what they expect to sell (last month's demand +15%, within the
// treasury less two months of rent). 20% of all bots buy a unit from another company now and then, from chequing, keeping a cushion.
export function bots(k, { month, students }) {
  const w = k.world.current();
  if (!w || w.status !== 'active') return;
  const tryIt = (fn) => { try { return fn(); } catch (e) { if (!(e instanceof k.HttpError)) throw e; return null; } };
  const byClass = new Map();
  for (const s of students) {
    const cls = k.players.classOf(s.id);
    if (!cls || !FOUNDING_COURSES.includes(cls.course_id) || dice(s.id, 0, 21) >= 30 || teamOf(k, w.id, s.id)) continue;
    if (q1(k, 'SELECT 1 FROM ventures_members m JOIN ventures_companies c ON c.id = m.company_id WHERE m.player_id = ? AND c.world_id = ?', s.id, w.id)) continue;   // tried before
    (byClass.get(s.class_id) ?? byClass.set(s.class_id, []).get(s.class_id)).push(s);
  }
  const n = townSize(k), user = (s) => ({ id: s.id, username: nameOf(k, s.id), class_id: s.class_id });
  for (const list of byClass.values()) {
    for (let i = 0; list.length - i >= 2;) {
      const left = list.length - i, size = left === 4 ? 2 : Math.min(3, left);   // teams of 2 or 3: 4 -> 2 + 2, 5 -> 3 + 2
      const team = list.slice(i, i += size), lead = team[0];
      const sector = SECTORS[dice(lead.id, 0, 23) % SECTORS.length];
      const r = tryIt(() => register(k, user(lead), { name: `Bot Venture ${lead.id}`, sector, plan: 'We make one thing well, price it near what the town will pay, and grow from our own sales.', cofounders: team.slice(1).map((s) => nameOf(k, s.id)).join(' ') }));
      if (!r) continue;
      for (const s of team.slice(1)) tryIt(() => respond(k, user(s), r.id, true));
      const c = company(k, r.id);
      if (c.status !== 'pending') continue;
      k.db.txn(() => decide(k, c, true, 'Approved by the bot teacher', 'system:sim'));
      for (const s of team) tryIt(() => capitalise(k, user(s), r.id, Math.min(15000, Math.max(MIN_CAPITAL_CENTS, k.ledger.balance(chequing(k, s.id)) - 20000))));
      const types = PRODUCTS.filter((t) => t.sector === sector), count = 1 + (dice(lead.id, 0, 25) % 3);
      for (const t of types.slice(0, count)) {
        const cost = costOf(k, w, t), best = bestAgainstShop(curveOf(k, w, t, n), cost + 1, cost * PRICE_CAP_X, INCUMBENT_REF_BP), price = Math.max(cost + 1, Math.min(cost * PRICE_CAP_X, Math.round((best * (85 + (dice(lead.id, t.key.length, 27) % 31))) / 100)));
        tryIt(() => setProduct(k, user(lead), r.id, t.key, price, 0));
      }
    }
  }
  // production plans: what the town wanted last month (or the curve at our price, shared with rivals), +15%, less what should be left over, within the treasury
  for (const c of qa(k, "SELECT * FROM ventures_companies WHERE world_id = ? AND status = 'active' AND name LIKE 'Bot Venture %'", w.id)) {
    const ps = products(k, c.id), plan = [];
    for (const p of ps) {
      const t = productType(p.type_key), last = q1(k, 'SELECT demand_units FROM ventures_flows WHERE product_id = ? AND month = ?', p.id, month - 1)?.demand_units;
      const rivals = q1(k, "SELECT COUNT(*) AS n FROM ventures_products x JOIN ventures_companies y ON y.id = x.company_id WHERE y.world_id = ? AND y.status = 'active' AND x.active = 1 AND x.type_key = ?", w.id, p.type_key).n;
      const want = last ?? demandAt(curveOf(k, w, t, n), p.price_cents) / Math.max(1, rivals);
      const leftover = Math.floor((Math.max(0, p.inventory_units - want) * (10000 - (SPOILAGE_BP[c.sector] ?? 0))) / 10000);
      plan.push({ p, cost: costOf(k, w, t), units: Math.max(0, Math.ceil(want * 1.15) - leftover) });   // +15%: demand moves +-10% a month, and a stockout costs reputation
    }
    const total = plan.reduce((s, x) => s + x.units * x.cost, 0), cash = Math.max(0, cashOf(k, c.id) - 2 * rentOf(k, w) - reserveOf(k, c)), scale = total > cash ? cash / total : 1;   // keep two months of rent, next payroll and the loan payment back
    for (const x of plan) {
      const qty = Math.min(MAX_QUANTITY, Math.floor(x.units * scale));
      if (qty !== x.p.quantity) k.db.prepare('UPDATE ventures_products SET quantity = ? WHERE id = ?').run(qty, x.p.id);
    }
  }
  bots4b(k, w, month, students, tryIt);
  // classmates buying
  const shelf = qa(k, "SELECT p.id, p.company_id, p.price_cents FROM ventures_products p JOIN ventures_companies c ON c.id = p.company_id WHERE c.world_id = ? AND c.status = 'active' AND p.active = 1 AND p.inventory_units > 0 ORDER BY p.id", w.id);
  if (!shelf.length) return;
  for (const s of students) {
    if (dice(s.id, 0, 29) >= 20 || (month + s.id) % 4 !== 0) continue;
    const pick = shelf[dice(s.id, month, 31) % shelf.length];
    if (k.ledger.balance(chequing(k, s.id)) < pick.price_cents + 150000) continue;
    tryIt(() => buy(k, { id: s.id, class_id: s.class_id }, pick.id, 'chequing'));
  }
}
