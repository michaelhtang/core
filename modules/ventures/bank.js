// ventures: the Venture Bank: borrowing and the teacher's answer to a default.
import { money, ok } from '../../lib/kernel.js';
import {
  LOAN_MIN_CENTS, LOAN_MIN_TERM, LOAN_MAX_TERM,
} from './constants.js';
import { loanPayment } from './demand.js';
import { company, treasuryOf, changed, needWorld, bump, mustBe, loanAcct, loanOwed, openLoan, spreadOf, policyOf } from './reads.js';
import { loanOffer } from './finance.js';
import { announce, dissolve, founderOf } from './founding.js';

export function borrow(k, user, id, cents, term) {
  const w = needWorld(k);
  return k.db.txn((tx) => {
    const { c } = founderOf(k, user, id, ['active']);
    mustBe(!openLoan(k, id), 409, 'Pay off your loan first: the Venture Bank lends one loan at a time');
    mustBe(term >= LOAN_MIN_TERM && term <= LOAN_MAX_TERM, 400, `The term is ${LOAN_MIN_TERM} to ${LOAN_MAX_TERM} months`);
    const offer = loanOffer(k, w, c);
    mustBe(cents >= LOAN_MIN_CENTS && cents <= offer.max_cents, 400, `The Venture Bank lends ${money(LOAN_MIN_CENTS)} to ${money(offer.max_cents)} (${offer.new_company ? 'a new company with an approved plan: up to $5,000' : '3 x your average monthly revenue over the last 3 months'})`);
    const pay = loanPayment(cents, offer.rate_bp, term);
    const lid = Number(k.db.prepare("INSERT INTO ventures_loans (company_id, principal_cents, rate_bp, term_months, payment_cents, start_month, status) VALUES (?, ?, ?, ?, ?, ?, 'active')").run(id, cents, offer.rate_bp, term, pay, w.month).lastInsertRowid);
    k.ledger.post({ kind: 'loan_in', actor: `player:${user.id}`, meta: { company: id, loan: lid, month: w.month }, legs: [{ account: loanAcct(k, id), cents: -cents, memo: `Venture Bank loan: ${term} months at ${(offer.rate_bp / 100).toFixed(2)}%` }, { account: treasuryOf(k, id), cents, memo: 'Venture Bank loan' }] });
    bump(k, id, 0, w.month, { loan_in_cents: cents });
    k.audit('borrow', { id, loan: lid, cents, term, rate_bp: offer.rate_bp }, `player:${user.id}`);
    tx.onCommit(() => announce(k, w, id));
    changed(k, tx, c.class_id);
    return { ok: true, loan_id: lid, payment_cents: pay, rate_bp: offer.rate_bp };
  });
}

// The teacher's answer to a default: forgive (written off, a gain), restructure (a new term on what is owed now), or dissolve.
export function resolveLoan(k, c, action, term, actor) {
  const w = needWorld(k), l = openLoan(k, c.id);
  mustBe(l && l.status === 'default', 409, 'That company has no loan in default');
  if (action === 'dissolve') return dissolve(k, c, actor, 'Dissolved by your teacher after a loan default');
  const owed = loanOwed(k, c.id);
  if (action === 'forgive') {
    if (owed > 0) k.ledger.post({ kind: 'loan_writeoff', actor, meta: { company: c.id, loan: l.id, month: w.month }, legs: [{ account: loanAcct(k, c.id), cents: owed, memo: 'Forgiven by the Venture Bank' }, { account: k.ledger.system('mint'), cents: -owed, memo: 'Loan forgiven' }] });
    bump(k, c.id, 0, w.month, { forgiven_cents: owed });
    k.db.prepare("UPDATE ventures_loans SET status = 'forgiven', ended_month = ? WHERE id = ?").run(w.month, l.id);
  } else {
    mustBe(action === 'restructure', 400, 'action is forgive, restructure or dissolve');
    mustBe(term >= LOAN_MIN_TERM && term <= LOAN_MAX_TERM, 400, `The new term is ${LOAN_MIN_TERM} to ${LOAN_MAX_TERM} months`);
    const rate = policyOf(k, w.id) + spreadOf(k, w.id);
    k.db.prepare("UPDATE ventures_loans SET status = 'active', misses = 0, principal_cents = ?, rate_bp = ?, term_months = ?, payment_cents = ?, start_month = ?, months_paid = 0, restructured = restructured + 1 WHERE id = ?")
      .run(owed, rate, term, loanPayment(owed, rate, term), w.month, l.id);
  }
  if (c.status === 'frozen') k.db.prepare("UPDATE ventures_companies SET status = 'active', note = ? WHERE id = ?").run(action === 'forgive' ? 'Your teacher forgave the Venture Bank loan.' : `Your teacher restructured the loan over ${term} months.`, c.id);
  k.audit('resolve_loan', { id: c.id, loan: l.id, action, term: term ?? null, owed }, actor);
  return { paid: [] };
}
