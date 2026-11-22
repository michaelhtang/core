// ventures: small reads, validation and the 4b liability reads (the bottom layer: nothing here calls another ventures file).
import { randomBytes } from 'node:crypto';
import { HttpError } from '../../lib/errors.js';
import { ok } from '../../lib/kernel.js';
import {
  NAME_RE, BLOCK_WORDS, BLOCK_ROOTS, RENT_CENTS, TOWN_SIZE, STORE_PER_COMPANY_CENTS, STORE_PER_MONTH_CENTS, MAX_WAGE_CENTS, LOAN_SPREAD_BP,
} from './constants.js';
import { unitCost, curve, mulDiv } from './demand.js';
import { MIN_WAGE_CENTS } from '../jobs/catalogue.js';
import { POLICY_BP } from '../rates/constants.js';

export const LIVE = ['approved', 'active', 'frozen'];             // a company with a treasury and books
export const TEAM = ['forming', 'pending', 'approved', 'active', 'frozen', 'dissolved', 'wound_up'];   // statuses that make you a founding team this season
export const inList = (xs) => `(${xs.map((x) => `'${x}'`).join(', ')})`;   // literals from this file only
export const MAX_CENTS = 100_000_000;

// ---- small reads ----
export const q1 = (k, sql, ...a) => k.db.prepare(sql).get(...a);
export const qa = (k, sql, ...a) => k.db.prepare(sql).all(...a);
export const company = (k, id) => q1(k, 'SELECT * FROM ventures_companies WHERE id = ?', id);
export const members = (k, id) => qa(k, "SELECT player_id, status, units_micro, confirmed, dissolve_vote, seq FROM ventures_members WHERE company_id = ? AND status <> 'declined' ORDER BY seq", id);
export const holders = (k, id) => qa(k, 'SELECT player_id, units_micro FROM ventures_shares WHERE company_id = ? AND units_micro > 0 ORDER BY player_id', id);
export const products = (k, id, all = false) => qa(k, `SELECT * FROM ventures_products WHERE company_id = ? ${all ? '' : 'AND active = 1'} ORDER BY id`, id);
export const treasuryOf = (k, id) => k.ledger.openAccount({ ownerType: 'business', ownerId: id, kind: 'treasury' });
export const cashOf = (k, id) => { const a = k.ledger.accountId('business', id, 'treasury'); return a ? k.ledger.balance(a) : 0; };
export const inventoryOf = (k, id) => q1(k, 'SELECT COALESCE(SUM(inventory_cost_cents), 0) AS n FROM ventures_products WHERE company_id = ?', id).n;
export const valueOf = (k, id) => cashOf(k, id) + inventoryOf(k, id) - liabilitiesOf(k, id);   // book value (equity): 4b takes off the loan and taxes owed
export const nameOf = (k, pid) => k.players.get(pid)?.username ?? 'unknown';
export const capitalBy = (k, id, pid) => q1(k, 'SELECT COALESCE(SUM(cents), 0) AS n FROM ventures_capital WHERE company_id = ? AND player_id = ?', id, pid).n;
export const chequing = (k, pid) => k.ledger.accountId('player', pid, 'chequing') ?? k.ledger.openAccount({ ownerType: 'player', ownerId: pid, kind: 'chequing' });
// The company this student founded (or is founding) this season, if any: an accepted member of a company that is or was a founding team.
export const teamOf = (k, wid, pid) => q1(k, `SELECT c.* FROM ventures_members m JOIN ventures_companies c ON c.id = m.company_id
  WHERE m.player_id = ? AND m.status = 'accepted' AND c.world_id = ? AND c.status IN ${inList(TEAM)} ORDER BY c.id DESC LIMIT 1`, pid, wid);
export const settingOf = (k, wid, sector) => q1(k, 'SELECT a_bp, b_bp FROM ventures_settings WHERE world_id = ? AND sector = ?', wid, sector) ?? { a_bp: 10000, b_bp: 10000 };
export const curveOf = (k, w, t, n = townSize(k)) => { const s = settingOf(k, w.id, t.sector); return curve(t, n, s.a_bp, s.b_bp, k.world.priceIndex(w.id)); };
export const costOf = (k, w, t) => unitCost(t, k.world.priceIndex(w.id));
export const changed = (k, tx, classId) => tx.onCommit(() => k.events.emit('changed', { classId: classId ?? null }));
export const needWorld = (k) => k.world.active();
// A whole-cents option from config.options.ventures, within [min, max], else the default.
export const opt = (k, key, dflt, min, max) => (ok(k.config[key]) && k.config[key] >= min && k.config[key] <= max ? k.config[key] : dflt);
export const rentOf = (k, w) => Math.round((opt(k, 'rentCents', RENT_CENTS, 0, 1_000_000) * k.world.priceIndex(w.id)) / 10000);
export const capsOf = (k) => ({ company: opt(k, 'storePerCompanyCents', STORE_PER_COMPANY_CENTS, 0, MAX_CENTS), month: opt(k, 'storePerMonthCents', STORE_PER_MONTH_CENTS, 0, MAX_CENTS) });
export const townSize = (k) => opt(k, 'townSize', TOWN_SIZE, 10, 100000);   // the simulated town's residents (town demand), not the school
// cents x the world price index (as jobs' px does for catalogue wages)
export const px = (k, cents, wid) => Math.round((cents * k.world.priceIndex(wid)) / 10000);
// 6c: the wage floor for a posting: Alberta's $15.00/h minimum (options.ventures.minWageCents, never below it) x the price index, to the cent.
export const minWageOf = (k, wid) => px(k, opt(k, 'minWageCents', MIN_WAGE_CENTS, MIN_WAGE_CENTS, 100000), wid);
// review 6c-1: and a ceiling, $150.00/h (options.ventures.maxWageCents) x the price index, so no posting is a way to move a treasury out
export const maxWageOf = (k, wid) => Math.max(minWageOf(k, wid), px(k, opt(k, 'maxWageCents', MAX_WAGE_CENTS, MIN_WAGE_CENTS, 1_000_000), wid));
export const neverActive = (c) => c.active_month === null || c.active_month === undefined;

export function secretOf(k, worldId) {
  const row = q1(k, 'SELECT secret FROM ventures_secrets WHERE world_id = ?', worldId);
  if (row) return row.secret;
  const secret = randomBytes(16).toString('hex');
  k.db.prepare('INSERT INTO ventures_secrets (world_id, secret) VALUES (?, ?)').run(worldId, secret);
  return secret;
}

// Counted flows, per company, product (0 = the company itself: capital, payouts) and month. Column names are literals in this file.
export function bump(k, companyId, productId, month, patch) {
  const cols = Object.keys(patch);
  k.db.prepare(`INSERT INTO ventures_flows (company_id, product_id, month, ${cols.join(', ')}) VALUES (?, ?, ?, ${cols.map(() => '?').join(', ')})
    ON CONFLICT (company_id, product_id, month) DO UPDATE SET ${cols.map((c) => `${c} = ${c} + excluded.${c}`).join(', ')}`).run(companyId, productId, month, ...Object.values(patch));
}
export const note = (k, companyId, productId, month, text) => k.db.prepare(`INSERT INTO ventures_flows (company_id, product_id, month, note) VALUES (?, ?, ?, ?)
  ON CONFLICT (company_id, product_id, month) DO UPDATE SET note = excluded.note`).run(companyId, productId, month, text);

// Take units out of a product's inventory at its average cost; returns that cost (the last unit carries the rounding, so cost leaves exactly).
export function takeUnits(k, p, units) {
  const cost = units >= p.inventory_units ? p.inventory_cost_cents : mulDiv(p.inventory_cost_cents, units, p.inventory_units);
  k.db.prepare('UPDATE ventures_products SET inventory_units = inventory_units - ?, inventory_cost_cents = inventory_cost_cents - ? WHERE id = ?').run(units, cost, p.id);
  p.inventory_units -= units; p.inventory_cost_cents -= cost;
  return cost;
}

// ---- validation ----
// The school blocklist (whole words, and roots that are never part of an innocent word): company names and job titles.
export const blocked = (text) => { const low = text.toLowerCase(); return low.split(/[^a-z]+/).some((w) => BLOCK_WORDS.has(w)) || BLOCK_ROOTS.some((r) => low.replace(/[^a-z]/g, '').includes(r)); };
export function nameProblem(k, name, worldId, exceptId = 0) {
  if (!NAME_RE.test(name)) return 'A company name is 3 to 40 characters: letters, numbers, spaces and & \' . , ! -';
  if (blocked(name)) return 'Pick a different name: that one is not allowed at school';
  if (q1(k, "SELECT 1 FROM ventures_companies WHERE world_id = ? AND lower(name) = ? AND id <> ? AND status NOT IN ('cancelled', 'declined')", worldId, name.toLowerCase(), exceptId)) return 'Another company already uses that name this season';
  return null;
}
export const mustBe = (cond, status, text) => { if (!cond) throw new HttpError(status, text); };   // k.HttpError is this same class


// ======== wave 4b: payroll, small business tax, the Venture Bank ========
// Each is its own step: the tick calls finance() (before the month's statement) and gstOnProduction() (after production); payroll is the
// service jobs calls at payday. Liabilities on the balance sheet: the loan (the business 'loan' account, allow_negative, so the ledger carries
// it), GST payable (collected - input tax credits - remitted) and income tax owed (assessed - paid).
export const loanAcct = (k, id) => k.ledger.openAccount({ ownerType: 'business', ownerId: id, kind: 'loan' });
export const loanOwed = (k, id) => { const a = k.ledger.accountId('business', id, 'loan'); return a ? Math.max(0, -k.ledger.balance(a)) : 0; };
export const openLoan = (k, id) => q1(k, "SELECT * FROM ventures_loans WHERE company_id = ? AND status IN ('active', 'default') ORDER BY id DESC LIMIT 1", id);
export const flowSum = (k, id, col, where = '', ...a) => q1(k, `SELECT COALESCE(SUM(${col}), 0) AS n FROM ventures_flows WHERE company_id = ? ${where}`, id, ...a).n;   // col: literals in this file
export const gstAccrued = (k, id) => flowSum(k, id, 'gst_collected_cents - gst_itc_cents - gst_remitted_cents');
export const gstFiledOwed = (k, id) => q1(k, 'SELECT COALESCE(SUM(net_cents), 0) AS n FROM ventures_gst WHERE company_id = ?', id).n - flowSum(k, id, 'gst_remitted_cents');
export const taxOwed = (k, id) => q1(k, 'SELECT COALESCE(SUM(tax_cents), 0) AS n FROM ventures_tax WHERE company_id = ?', id).n - flowSum(k, id, 'tax_paid_cents');
export const liabilitiesOf = (k, id) => loanOwed(k, id) + gstAccrued(k, id) + taxOwed(k, id);
export const gstOn = (c, month) => !!c.gst_registered && c.gst_since !== null && c.gst_since <= month;
export const worldCfg = (k, wid) => q1(k, 'SELECT loan_spread_bp, hire_approval FROM ventures_world WHERE world_id = ?', wid) ?? { loan_spread_bp: null, hire_approval: 0 };
export const spreadOf = (k, wid) => worldCfg(k, wid).loan_spread_bp ?? (Number.isSafeInteger(k.config.loanSpreadBp) && k.config.loanSpreadBp >= 0 && k.config.loanSpreadBp <= 2000 ? k.config.loanSpreadBp : LOAN_SPREAD_BP);
export const policyOf = (k, wid) => q1(k, 'SELECT policy_bp FROM ventures_policy WHERE world_id = ?', wid)?.policy_bp ?? POLICY_BP;
export const staffOf = (k, id) => (k.modules.has('jobs') ? k.modules.call('jobs', 'staffOf', { businessId: id }) : []);
export const yearOfMonth = (m) => Math.ceil(m / 12);

export const filledOf = (k, postingId) => q1(k, "SELECT COUNT(*) AS n FROM ventures_applications WHERE posting_id = ? AND status = 'hired'", postingId).n;
