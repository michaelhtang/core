// ventures: the books: statements, GST, loan offer/payment/settlement, small business tax.
import { money } from '../../lib/kernel.js';
import {
  productType, REP_MIN_BP, MAX_SLOTS, TAX_FEDERAL_BP, TAX_ALBERTA_BP, TAX_RATE_BP, TAX_URL, GST_BP, GST_THRESHOLD_CENTS, GST_URL, LOAN_MIN_CENTS, LOAN_NEW_CENTS, LOAN_REVENUE_X, LOAN_MIN_TERM, LOAN_MAX_TERM, LOAN_LATE_FEE_CENTS, LOAN_DEFAULT_MISSES, REP_LATE_LOAN_BP,
} from './constants.js';
import { loanDue, yearTax, gstOf } from './demand.js';
import { BUSINESS_MIN_HOURS, BUSINESS_MAX_HOURS } from '../jobs/catalogue.js';
import { q1, qa, company, products, treasuryOf, cashOf, inventoryOf, nameOf, minWageOf, bump, note, loanAcct, loanOwed, openLoan, flowSum, gstAccrued, gstFiledOwed, taxOwed, liabilitiesOf, gstOn, worldCfg, spreadOf, policyOf, staffOf, yearOfMonth, filledOf } from './reads.js';

// ---- statements ----
export const FLOW_COLS = ['demand_units', 'npc_units', 'npc_cents', 'store_units', 'store_cents', 'cogs_cents', 'spoiled_units', 'spoilage_cents', 'produced_units', 'production_cents', 'rent_cents', 'capital_cents', 'refund_cents', 'payout_cents',
  'wages_cents', 'employer_cents', 'loan_in_cents', 'principal_cents', 'interest_cents', 'interest_paid_cents', 'fee_cents', 'forgiven_cents', 'tax_cents', 'tax_paid_cents', 'gst_collected_cents', 'gst_itc_cents', 'gst_remitted_cents'];
export const sumFlows = (k, id, month) => q1(k, `SELECT ${FLOW_COLS.map((c) => `COALESCE(SUM(${c}), 0) AS ${c}`).join(', ')} FROM ventures_flows WHERE company_id = ? AND month = ?`, id, month);
// Income statement, balance sheet and cash flow for one month, from the flows, the treasury and the inventory. Stored, so the books of a
// month never change afterwards. `balanced` and `reconciled` are checked by a test: they must always be true.
export function writeStatement(k, c, month, final = false) {
  const f = sumFlows(k, c.id, month);
  const revenue = f.npc_cents + f.store_cents, gross = revenue - f.cogs_cents - f.spoilage_cents;
  // 4a rent; 4b: wages and the employer's CPP and EI, loan interest and late fees, a forgiven or written-off loan (a gain), and income tax
  const pretax = gross - f.rent_cents - f.wages_cents - f.employer_cents - f.interest_cents - f.fee_cents + f.forgiven_cents, net = pretax - f.tax_cents;
  const prev = q1(k, 'SELECT data FROM ventures_statements WHERE company_id = ? AND month < ? ORDER BY month DESC LIMIT 1', c.id, month);
  const before = prev ? JSON.parse(prev.data) : null;
  const cash = cashOf(k, c.id), inventory = inventoryOf(k, c.id);
  const capital = (before?.balance.share_capital_cents ?? 0) + f.capital_cents - f.refund_cents;   // capital returned to a founder who left leaves share capital
  const retained = (before?.balance.retained_cents ?? 0) + net, distributions = (before?.balance.distributions_cents ?? 0) + f.payout_cents;
  const equity = capital + retained - distributions, opening = before?.balance.cash_cents ?? 0;
  const loans = loanOwed(k, c.id);
  const gstPayable = (before?.balance.gst_payable_cents ?? 0) + f.gst_collected_cents - f.gst_itc_cents - f.gst_remitted_cents;
  const taxDue = (before?.balance.tax_owed_cents ?? 0) + f.tax_cents - f.tax_paid_cents, liabilities = loans + gstPayable + taxDue;
  const operating = revenue + f.gst_collected_cents - f.production_cents - f.gst_itc_cents - f.rent_cents - f.wages_cents - f.employer_cents - f.interest_paid_cents - f.tax_paid_cents - f.gst_remitted_cents;
  const financing = f.capital_cents - f.refund_cents - f.payout_cents + f.loan_in_cents - f.principal_cents;
  const lines = qa(k, 'SELECT f.*, p.type_key, p.price_cents FROM ventures_flows f JOIN ventures_products p ON p.id = f.product_id WHERE f.company_id = ? AND f.month = ? ORDER BY p.id', c.id, month).map((r) => ({
    product: productType(r.type_key)?.name ?? r.type_key, key: r.type_key, demand_units: r.demand_units, npc_units: r.npc_units, store_units: r.store_units,
    revenue_cents: r.npc_cents + r.store_cents, cogs_cents: r.cogs_cents, spoilage_cents: r.spoilage_cents, margin_cents: r.npc_cents + r.store_cents - r.cogs_cents - r.spoilage_cents,
    produced_units: r.produced_units, production_cents: r.production_cents, spoiled_units: r.spoiled_units, note: r.note,
  }));
  const data = {
    month, final,
    income: { revenue_cents: revenue, npc_cents: f.npc_cents, store_cents: f.store_cents, cogs_cents: f.cogs_cents, spoilage_cents: f.spoilage_cents, gross_cents: gross, rent_cents: f.rent_cents,
      wages_cents: f.wages_cents, employer_cents: f.employer_cents, interest_cents: f.interest_cents, fees_cents: f.fee_cents, forgiven_cents: f.forgiven_cents, pretax_cents: pretax, tax_cents: f.tax_cents, net_cents: net },
    balance: { cash_cents: cash, inventory_cents: inventory, assets_cents: cash + inventory, loans_cents: loans, gst_payable_cents: gstPayable, tax_owed_cents: taxDue, liabilities_cents: liabilities,
      share_capital_cents: capital, retained_cents: retained, distributions_cents: distributions, equity_cents: equity, balanced: cash + inventory === liabilities + equity },
    cashflow: { opening_cents: opening, operating_cents: operating, financing_cents: financing, closing_cents: cash, reconciled: opening + operating + financing === cash },
    products: lines,
    note: q1(k, 'SELECT note FROM ventures_flows WHERE company_id = ? AND product_id = 0 AND month = ?', c.id, month)?.note ?? null,
  };
  if (!data.balance.balanced || !data.cashflow.reconciled) k.log.error(`statement for company ${c.id} month ${month} does not balance`, data.balance, data.cashflow);
  k.db.prepare('INSERT OR REPLACE INTO ventures_statements (company_id, month, data, revenue_cents, net_cents) VALUES (?, ?, ?, ?, ?)').run(c.id, month, JSON.stringify(data), revenue, net);
  return data;
}


// ---- GST: charged on sales once registered (town sales here; classmate sales in buy()), input tax credits on production, filed quarterly ----
export function gstOnSales(k, c, from) {
  if (!gstOn(c, from)) return;
  const gst = gstOf(flowSum(k, c.id, 'npc_cents', 'AND month = ?', from), GST_BP);
  if (gst <= 0) return;
  k.ledger.post({ kind: 'gst_collected', actor: 'system', meta: { company: c.id, month: from }, legs: [{ account: k.ledger.system('mint'), cents: -gst, memo: 'GST paid by town customers' }, { account: treasuryOf(k, c.id), cents: gst, memo: `GST collected on town sales (month ${from})` }] });
  bump(k, c.id, 0, from, { gst_collected_cents: gst });
}
export function gstOnProduction(k, c, month) {
  if (!gstOn(c, month)) return;
  const gst = gstOf(flowSum(k, c.id, 'production_cents', 'AND month = ?', month), GST_BP), acct = treasuryOf(k, c.id);
  if (gst <= 0) return;
  if (k.ledger.balance(acct) < gst) { note(k, c.id, 0, month, `GST on this month's production (${money(gst)}) could not be paid, so there is no input tax credit for it`); return; }
  k.ledger.post({ kind: 'gst_paid', actor: 'system', meta: { company: c.id, month }, legs: [{ account: acct, cents: -gst, memo: `GST on production (month ${month}): an input tax credit` }, { account: k.ledger.system('sink'), cents: gst, memo: 'GST on supplies' }] });
  bump(k, c.id, 0, month, { gst_itc_cents: gst });
}

// ---- the Venture Bank: one loan at a time, amortised monthly from the treasury ----
export function loanOffer(k, w, c) {
  const st = qa(k, 'SELECT revenue_cents FROM ventures_statements WHERE company_id = ? ORDER BY month DESC LIMIT 3', c.id);
  const fresh = st.length < 3, trailing = st.reduce((t, r) => t + r.revenue_cents, 0);   // 3 x the 3-month average = the 3 months' sum
  const max = Math.max(fresh ? LOAN_NEW_CENTS : 0, Math.round((trailing / Math.max(1, st.length)) * LOAN_REVENUE_X));
  return { max_cents: max, new_company: fresh, policy_bp: policyOf(k, w.id), spread_bp: spreadOf(k, w.id), rate_bp: policyOf(k, w.id) + spreadOf(k, w.id), min_cents: LOAN_MIN_CENTS, min_term: LOAN_MIN_TERM, max_term: LOAN_MAX_TERM, late_fee_cents: LOAN_LATE_FEE_CENTS, default_misses: LOAN_DEFAULT_MISSES };
}

// This month's payment on the loan (the tick into month m pays month m-1's instalment). A treasury that cannot pay it: the month's interest and
// a late fee are added to the loan, reputation drops; the third miss is a default and the company is frozen until the teacher resolves it.
export function loanMonth(k, c, from) {
  const l = openLoan(k, c.id);
  if (!l || l.status !== 'active' || l.start_month > from) return;   // borrowed this month: the first instalment is at the next tick
  const owed = loanOwed(k, c.id);
  if (owed <= 0) { k.db.prepare("UPDATE ventures_loans SET status = 'paid', ended_month = ? WHERE id = ?").run(from + 1, l.id); return; }
  const d = loanDue(owed, l.rate_bp, l.payment_cents, l.months_paid + 1 >= l.term_months), acct = treasuryOf(k, c.id), loan = loanAcct(k, c.id);
  if (k.ledger.balance(acct) >= d.due) {
    k.ledger.post({ kind: 'loan_payment', actor: 'system', meta: { company: c.id, loan: l.id, month: from, interest: d.interest, principal: d.principal },
      legs: [{ account: acct, cents: -d.due, memo: `Loan payment (month ${from})` }, ...(d.principal ? [{ account: loan, cents: d.principal, memo: 'Principal' }] : []), ...(d.interest ? [{ account: k.ledger.system('sink'), cents: d.interest, memo: 'Loan interest (Venture Bank)' }] : [])] });
    bump(k, c.id, 0, from, { principal_cents: d.principal, interest_cents: d.interest, interest_paid_cents: d.interest });
    const done = owed - d.principal <= 0;
    k.db.prepare(`UPDATE ventures_loans SET months_paid = months_paid + 1${done ? ", status = 'paid', ended_month = ?" : ''} WHERE id = ?`).run(...(done ? [from + 1] : []), l.id);
    return;
  }
  const add = d.interest + LOAN_LATE_FEE_CENTS, misses = l.misses + 1;
  k.ledger.post({ kind: 'loan_late', actor: 'system', meta: { company: c.id, loan: l.id, month: from }, legs: [{ account: loan, cents: -add, memo: `Missed payment: interest ${money(d.interest)} + late fee ${money(LOAN_LATE_FEE_CENTS)} added` }, { account: k.ledger.system('sink'), cents: add, memo: 'Loan interest and late fee' }] });
  bump(k, c.id, 0, from, { interest_cents: d.interest, fee_cents: LOAN_LATE_FEE_CENTS });
  k.db.prepare('UPDATE ventures_companies SET rep_bp = MAX(?, rep_bp + ?) WHERE id = ?').run(REP_MIN_BP, REP_LATE_LOAN_BP, c.id);
  const dflt = misses >= LOAN_DEFAULT_MISSES;
  k.db.prepare(`UPDATE ventures_loans SET misses = ?${dflt ? ", status = 'default', defaulted_month = ?" : ''} WHERE id = ?`).run(misses, ...(dflt ? [from + 1] : []), l.id);
  note(k, c.id, 0, from, `Loan payment of ${money(d.due)} missed (${misses} of ${LOAN_DEFAULT_MISSES})${dflt ? ': the loan is in default and the company is frozen until your teacher resolves it' : ''}`);
  if (dflt && c.status === 'active') { k.db.prepare("UPDATE ventures_companies SET status = 'frozen', note = 'Frozen: the Venture Bank loan is in default. Your teacher resolves it (forgive, restructure or dissolve).' WHERE id = ?").run(c.id); c.status = 'frozen'; }
}
// Pay the loan (and taxes owed) from the treasury as far as it goes. writeOff: the rest of the loan is written off (a dissolution).
export function settleDebts(k, c, month, actor, writeOff) {
  const acct = treasuryOf(k, c.id);
  const owed = loanOwed(k, c.id), pay = Math.min(owed, k.ledger.balance(acct));
  if (pay > 0) { k.ledger.post({ kind: 'loan_settle', actor, meta: { company: c.id, month }, legs: [{ account: acct, cents: -pay, memo: 'Loan settled from the treasury' }, { account: loanAcct(k, c.id), cents: pay, memo: 'Loan settled' }] }); bump(k, c.id, 0, month, { principal_cents: pay }); }
  for (const [due, kind, col, memo] of [[gstAccrued(k, c.id), 'gst_remit', 'gst_remitted_cents', 'GST remitted'], [taxOwed(k, c.id), 'tax', 'tax_paid_cents', 'Income tax paid']]) {
    const amt = Math.min(due, k.ledger.balance(acct));
    if (amt > 0) { k.ledger.post({ kind, actor, meta: { company: c.id, month }, legs: [{ account: acct, cents: -amt, memo }, { account: k.ledger.system('sink'), cents: amt, memo: `${memo} (to the CRA)` }] }); bump(k, c.id, 0, month, { [col]: amt }); }
  }
  const rest = loanOwed(k, c.id);
  if (writeOff && rest > 0) {
    k.ledger.post({ kind: 'loan_writeoff', actor, meta: { company: c.id, month }, legs: [{ account: loanAcct(k, c.id), cents: rest, memo: 'Written off by the Venture Bank: the company is a separate legal entity' }, { account: k.ledger.system('mint'), cents: -rest, memo: 'Loan written off' }] });
    bump(k, c.id, 0, month, { forgiven_cents: rest });
  }
  k.db.prepare(`UPDATE ventures_loans SET status = ?, ended_month = ? WHERE company_id = ? AND status IN ('active', 'default')`).run(rest > 0 && writeOff ? 'written_off' : 'settled', month, c.id);
}

// ---- small business tax: GST returns each quarter, income tax at year end (the tick into the first month of a world year), then whatever is
// owed is paid from the treasury as far as it goes (the rest stays owed, a liability, and is paid at later ticks).
export function taxes(k, c, from, month) {
  if (from % 3 === 0) {
    const q = from / 3, months = [from - 2, from];
    const collected = flowSum(k, c.id, 'gst_collected_cents', 'AND month BETWEEN ? AND ?', ...months), itc = flowSum(k, c.id, 'gst_itc_cents', 'AND month BETWEEN ? AND ?', ...months);
    const sales = flowSum(k, c.id, 'npc_cents + store_cents', 'AND month BETWEEN ? AND ?', ...months);
    if (c.gst_registered) k.db.prepare('INSERT OR REPLACE INTO ventures_gst (company_id, quarter, month, sales_cents, collected_cents, itc_cents, net_cents) VALUES (?, ?, ?, ?, ?, ?, ?)').run(c.id, q, from, sales, collected, itc, collected - itc);
    const year = flowSum(k, c.id, 'npc_cents + store_cents', 'AND month BETWEEN ? AND ?', from - 11, from);
    if (!c.gst_registered && year > GST_THRESHOLD_CENTS) {
      k.db.prepare('UPDATE ventures_companies SET gst_registered = 1, gst_since = ?, gst_mandatory = 1 WHERE id = ?').run(month + 1, c.id);
      Object.assign(c, { gst_registered: 1, gst_since: month + 1 });
      note(k, c.id, 0, from, `Sales over the last 4 quarters (${money(year)}) passed the ${money(GST_THRESHOLD_CENTS)} small-supplier threshold: GST registration is mandatory from month ${month + 1}`);
    }
  }
  if ((month - 1) % 12 === 0 && month > 1) {
    const y = yearOfMonth(from), first = from - 11;
    if (!q1(k, 'SELECT 1 FROM ventures_tax WHERE company_id = ? AND year = ?', c.id, y)) {
      const income = flowSum(k, c.id, 'npc_cents + store_cents - cogs_cents - spoilage_cents - rent_cents - wages_cents - employer_cents - interest_cents - fee_cents + forgiven_cents', 'AND month BETWEEN ? AND ?', first, from);
      const t = yearTax(income, c.loss_cf_cents, TAX_RATE_BP);
      k.db.prepare('INSERT INTO ventures_tax (company_id, year, month, income_cents, loss_before_cents, loss_applied_cents, taxable_cents, tax_cents, loss_cf_cents) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)').run(c.id, y, from, income, c.loss_cf_cents, t.applied, t.taxable, t.tax, t.lossAfter);
      k.db.prepare('UPDATE ventures_companies SET loss_cf_cents = ? WHERE id = ?').run(t.lossAfter, c.id);
      c.loss_cf_cents = t.lossAfter;
      if (t.tax) bump(k, c.id, 0, from, { tax_cents: t.tax });
    }
  }
  const acct = treasuryOf(k, c.id), gst = gstFiledOwed(k, c.id);
  if (gst < 0) {
    k.ledger.post({ kind: 'gst_refund', actor: 'system', meta: { company: c.id, month: from }, legs: [{ account: k.ledger.system('mint'), cents: gst, memo: 'GST refund (more input tax credits than GST collected)' }, { account: acct, cents: -gst, memo: 'GST refund from the CRA' }] });
    bump(k, c.id, 0, from, { gst_remitted_cents: gst });
  }
  for (const [due, kind, col, memo] of [[gst, 'gst_remit', 'gst_remitted_cents', 'GST remitted'], [taxOwed(k, c.id), 'tax', 'tax_paid_cents', 'Small business income tax']]) {
    const amt = Math.min(due, k.ledger.balance(acct));
    if (amt > 0) { k.ledger.post({ kind, actor: 'system', meta: { company: c.id, month: from }, legs: [{ account: acct, cents: -amt, memo: `${memo} (month ${from})` }, { account: k.ledger.system('sink'), cents: amt, memo: `${memo} (to the CRA)` }] }); bump(k, c.id, 0, from, { [col]: amt }); }
  }
}
// The 4b part of the month, for one company, before its statement for `from` is written.
export function finance(k, c, from, month) {
  if (c.approved_month === null || c.approved_month > from) return;
  gstOnSales(k, c, from);
  loanMonth(k, c, from);
  taxes(k, c, from, month);
}
// For the panel and the teacher: staff, postings and applications, the loan and its offer, GST and the T2 slips.
export function financeView(k, w, c) {
  const l = openLoan(k, c.id) ?? q1(k, 'SELECT * FROM ventures_loans WHERE company_id = ? ORDER BY id DESC LIMIT 1', c.id);
  const owed = loanOwed(k, c.id);
  let bal = owed;
  const next = l && ['active', 'default'].includes(l.status) ? Array.from({ length: 12 }, (_, i) => { if (bal <= 0) return null; const d = loanDue(bal, l.rate_bp, l.payment_cents, l.months_paid + i + 1 >= l.term_months); bal -= d.principal; return { n: i + 1, ...d, balance_cents: bal }; }).filter(Boolean) : [];
  const year = flowSum(k, c.id, 'npc_cents + store_cents', 'AND month BETWEEN ? AND ?', w.month - 12, w.month - 1);
  return {
    staff: staffOf(k, c.id).map((s) => ({ ...s, username: nameOf(k, s.playerId) })),
    postings: qa(k, 'SELECT * FROM ventures_postings WHERE company_id = ? AND open = 1 ORDER BY id', c.id).map((p) => ({ id: p.id, title: p.title, hourly_cents: p.hourly_cents, hours: p.hours, slots: p.slots, filled: filledOf(k, p.id),
      applications: qa(k, "SELECT id, player_id, status, month FROM ventures_applications WHERE posting_id = ? AND status IN ('pending', 'approved') ORDER BY id", p.id).map((a) => ({ ...a, username: nameOf(k, a.player_id) })) })),
    paydays: c.paydays, missed_paydays: c.missed_paydays, hire_approval: !!worldCfg(k, w.id).hire_approval, min_wage_cents: minWageOf(k, w.id), min_hours: BUSINESS_MIN_HOURS, max_hours: BUSINESS_MAX_HOURS, max_slots: MAX_SLOTS,
    loan: l ? { id: l.id, status: l.status, principal_cents: l.principal_cents, rate_bp: l.rate_bp, term_months: l.term_months, payment_cents: l.payment_cents, start_month: l.start_month, months_paid: l.months_paid, misses: l.misses, owed_cents: owed, schedule: next } : null,
    loan_offer: loanOffer(k, w, c),
    gst: { registered: !!c.gst_registered, since: c.gst_since, mandatory: !!c.gst_mandatory, rate_bp: GST_BP, threshold_cents: GST_THRESHOLD_CENTS, sales_12m_cents: year, accrued_cents: gstAccrued(k, c.id), owed_filed_cents: gstFiledOwed(k, c.id), url: GST_URL,
      returns: qa(k, 'SELECT quarter, month, sales_cents, collected_cents, itc_cents, net_cents FROM ventures_gst WHERE company_id = ? ORDER BY quarter DESC LIMIT 8', c.id)
        .map((r) => ({ ...r, remitted_cents: flowSum(k, c.id, 'gst_remitted_cents', 'AND month BETWEEN ? AND ?', r.month - 2, w.month) })) },
    tax: { rate_bp: TAX_RATE_BP, federal_bp: TAX_FEDERAL_BP, alberta_bp: TAX_ALBERTA_BP, url: TAX_URL, loss_cf_cents: c.loss_cf_cents, owed_cents: taxOwed(k, c.id), paid_cents: flowSum(k, c.id, 'tax_paid_cents'),
      slips: qa(k, 'SELECT * FROM ventures_tax WHERE company_id = ? ORDER BY year DESC', c.id).map((t) => {
        const ms = [t.month - 11, t.month], g = (col) => flowSum(k, c.id, col, 'AND month BETWEEN ? AND ?', ...ms);
        return { year: t.year, net_income_cents: t.income_cents, loss_before_cents: t.loss_before_cents, losses_applied_cents: t.loss_applied_cents, taxable_cents: t.taxable_cents, tax_cents: t.tax_cents, loss_cf_cents: t.loss_cf_cents,
          gst_collected_cents: g('gst_collected_cents'), gst_itc_cents: g('gst_itc_cents'), gst_remitted_cents: g('gst_remitted_cents') };
      }) },
    liabilities_cents: liabilitiesOf(k, c.id),
  };
}
