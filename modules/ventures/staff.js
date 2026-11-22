// ventures: payroll and hiring (the service jobs calls, postings, applications, layoffs).
import { HttpError } from '../../lib/errors.js';
import { money, ok } from '../../lib/kernel.js';
import {
  REP_MIN_BP, REP_MISSED_PAYROLL_BP, MAX_POSTINGS, MAX_STAFF, MAX_SLOTS,
} from './constants.js';
import { BUSINESS_MIN_HOURS, BUSINESS_MAX_HOURS } from '../jobs/catalogue.js';
import { LIVE, q1, qa, company, treasuryOf, nameOf, chequing, changed, needWorld, minWageOf, maxWageOf, bump, note, blocked, mustBe, liabilitiesOf, worldCfg, staffOf, filledOf } from './reads.js';
import { announce, founderOf } from './founding.js';

// ---- payroll: the service jobs' payday calls (and its layoff with pay in lieu of notice). Gross + the employer's CPP and EI come from the
// treasury: net to the employee's chequing, deductions and employer contributions to the sink. Nothing is minted. A short treasury pays
// nothing (jobs skips the pay, the student is told) and costs reputation. Wages paid at the tick into month m are for the work of month m-1, so
// they go on month m-1's books (written later in the same tick) unless those books are already closed.
export function payroll(k, { businessId, playerId, grossCents, netCents, employerCppCents, employerEiCents, month, kind = 'pay' }) {
  for (const n of [businessId, playerId, grossCents, netCents, employerCppCents, employerEiCents, month]) if (!ok(n) || n < 0) throw new HttpError(400, 'payroll: whole, non-negative numbers only');
  if (netCents > grossCents || !['pay', 'severance'].includes(kind)) throw new HttpError(400, 'payroll: bad amounts or kind');
  const c = company(k, businessId);
  if (!c || !LIVE.includes(c.status)) return { paid: false, reason: 'the company is closed' };
  const employer = employerCppCents + employerEiCents, total = grossCents + employer, acct = treasuryOf(k, c.id);
  const book = kind === 'severance' || q1(k, 'SELECT 1 FROM ventures_statements WHERE company_id = ? AND month = ?', c.id, month - 1) ? month : month - 1;
  const cash = k.ledger.balance(acct);
  // review 6c-1: an owner (an accepted founder or a shareholder) is paid only from equity, the treasury cash above what the company owes the
  // Venture Bank and the CRA; otherwise founders could borrow, hire themselves and walk off with the loan (the season close writes it off)
  const owner = !!q1(k, "SELECT 1 FROM ventures_members WHERE company_id = ? AND player_id = ? AND status = 'accepted' UNION SELECT 1 FROM ventures_shares WHERE company_id = ? AND player_id = ? AND units_micro > 0", c.id, playerId, c.id, playerId);
  const owed = owner ? liabilitiesOf(k, c.id) : 0;
  if (cash < total || (owner && cash - total < owed)) {
    k.db.prepare('UPDATE ventures_companies SET rep_bp = MAX(?, rep_bp + ?), missed_paydays = missed_paydays + 1, missed_month = ? WHERE id = ?').run(REP_MIN_BP, REP_MISSED_PAYROLL_BP, month, c.id);
    note(k, c.id, 0, book, cash >= total
      ? `Payroll missed: ${nameOf(k, playerId)} owns part of the company, and an owner is paid only from equity: the treasury had ${money(cash)}, the company owes ${money(owed)} (loan and taxes), and the pay needs ${money(total)}`
      : `Payroll missed: ${nameOf(k, playerId)}'s pay needs ${money(total)} (gross + employer CPP and EI) and the treasury had ${money(cash)}`);
    // module.ventures.payroll_missed, inside the payday (the feed's class item): once per company and month, however many staff went unpaid
    if (kind === 'pay' && c.missed_month !== month) k.events.emit('payroll_missed', { businessId: c.id, month, worldId: c.world_id, classId: c.class_id, company: c.name });
    return { paid: false, reason: cash >= total ? `an owner is paid only from equity: the treasury has ${money(cash)} and the company owes ${money(owed)}` : `needs ${money(total)}, the treasury has ${money(cash)}` };
  }
  const txnId = k.ledger.post({ kind: kind === 'pay' ? 'payroll' : 'severance', actor: 'system', meta: { company: c.id, player: playerId, month, gross: grossCents, employer },
    legs: [{ account: acct, cents: -total, memo: `${kind === 'pay' ? 'Payroll' : 'Pay in lieu of notice'}: ${nameOf(k, playerId)} (month ${month})` },
      ...(netCents ? [{ account: chequing(k, playerId), cents: netCents, memo: `Pay from ${c.name}` }] : []),
      ...(total - netCents ? [{ account: k.ledger.system('sink'), cents: total - netCents, memo: 'Source deductions + employer CPP and EI (to the CRA)' }] : [])] });
  bump(k, c.id, 0, book, { wages_cents: grossCents, employer_cents: employer });
  if (kind === 'pay') k.db.prepare('UPDATE ventures_companies SET paydays = paydays + 1 WHERE id = ?').run(c.id);
  return { paid: true, txnId, employer: c.name };
}

// ---- hiring: a founder posts a job (1-5 places, the wage at least the minimum x the price index, 10-40 h/month); students apply from the Job
// Centre board (GET /openings, town-wide: jobs_class_off does not apply); a founder approves (and the teacher, when the world teacher turned hire
// approval on); jobs' hireForBusiness adds the part-time job ON TOP of the student's catalogue job (2 at most, 40 h in all). A retired student
// cannot apply or be hired. module.ventures.hired / .laid_off after commit (the feed).

export function postJob(k, user, id, title, hourly, hours, slots = 1) {
  const w = needWorld(k);
  return k.db.txn((tx) => {
    const { c } = founderOf(k, user, id, ['active']);
    mustBe(k.modules.has('jobs'), 409, 'The Job Centre is not open in this course');
    title = title.replace(/[\u0000-\u001f\u007f]+/g, ' ').trim().slice(0, 60);   // review 6c-4: shown town-wide
    mustBe(title.length >= 3, 400, 'Give the job a title (3 to 60 characters)');
    mustBe(!blocked(title), 400, 'Pick a different job title: that one is not allowed at school');
    const floor = minWageOf(k, w.id), ceiling = maxWageOf(k, w.id);
    mustBe(hourly >= floor, 400, `The wage must be at least the minimum wage, ${money(floor)} an hour (Alberta's $15.00 at today's prices)`);
    mustBe(hourly <= ceiling, 400, `A part-time company job pays at most ${money(ceiling)} an hour`);
    mustBe(hours >= BUSINESS_MIN_HOURS && hours <= BUSINESS_MAX_HOURS, 400, `A part-time company job is ${BUSINESS_MIN_HOURS} to ${BUSINESS_MAX_HOURS} hours a month`);
    mustBe(Number.isSafeInteger(slots) && slots >= 1 && slots <= MAX_SLOTS, 400, `A posting has 1 to ${MAX_SLOTS} places`);
    mustBe(q1(k, 'SELECT COUNT(*) AS n FROM ventures_postings WHERE company_id = ? AND open = 1', id).n < MAX_POSTINGS, 409, `At most ${MAX_POSTINGS} open postings`);
    const pid = Number(k.db.prepare('INSERT INTO ventures_postings (company_id, title, hourly_cents, hours, created_month, slots) VALUES (?, ?, ?, ?, ?, ?)').run(id, title, hourly, hours, w.month, slots).lastInsertRowid);
    k.audit('post_job', { id, posting: pid, title, hourly, hours, slots }, `player:${user.id}`);
    changed(k, tx, c.class_id);
    return { ok: true, posting_id: pid };
  });
}
export function closeJob(k, user, id, postingId) {
  needWorld(k);
  return k.db.txn((tx) => {
    const { c } = founderOf(k, user, id);
    mustBe(k.db.prepare('UPDATE ventures_postings SET open = 0 WHERE id = ? AND company_id = ? AND open = 1').run(postingId, id).changes, 404, 'No such open posting');
    k.db.prepare("UPDATE ventures_applications SET status = 'withdrawn', decided_month = ? WHERE posting_id = ? AND status IN ('pending', 'approved')").run(k.world.current().month, postingId);
    changed(k, tx, c.class_id);
    return { ok: true };
  });
}

export const retired = (k, pid) => k.modules.has('life') && k.modules.call('life', 'retired', { playerId: pid }).retired === true;
export function openings(k, user) {
  const w = k.world.current();
  mustBe(w, 409, 'There is no active world');
  const mine = new Map(qa(k, "SELECT posting_id, status FROM ventures_applications WHERE player_id = ? AND status IN ('pending', 'approved') ", user.id).map((r) => [r.posting_id, r.status]));
  return { min_wage_cents: minWageOf(k, w.id), retired: retired(k, user.id), openings: retired(k, user.id) ? [] : qa(k, "SELECT p.*, c.name, c.sector FROM ventures_postings p JOIN ventures_companies c ON c.id = p.company_id WHERE c.world_id = ? AND c.status = 'active' AND p.open = 1 ORDER BY p.id", w.id)
    .map((p) => ({ posting_id: p.id, company_id: p.company_id, company: p.name, sector: p.sector, title: p.title, hourly_cents: p.hourly_cents, hours_per_month: p.hours, gross_cents: p.hourly_cents * p.hours,
      slots: p.slots, filled: filledOf(k, p.id), applied: mine.get(p.id) ?? null })) };
}
export function applyJob(k, user, postingId) {
  const w = needWorld(k);
  mustBe(!retired(k, user.id), 409, 'You are retired: work stopped at your retirement age');
  return k.db.txn((tx) => {
    const p = q1(k, "SELECT p.*, c.world_id, c.status AS cstatus, c.class_id FROM ventures_postings p JOIN ventures_companies c ON c.id = p.company_id WHERE p.id = ? AND p.open = 1", postingId);
    mustBe(p && p.world_id === w.id && p.cstatus === 'active', 404, 'That job is not open');
    mustBe(!staffOf(k, p.company_id).some((s) => s.playerId === user.id), 409, 'You already work there');
    mustBe(!q1(k, "SELECT 1 FROM ventures_applications WHERE posting_id = ? AND player_id = ? AND status IN ('pending', 'approved')", postingId, user.id), 409, 'You already applied for this job');
    const aid = Number(k.db.prepare("INSERT INTO ventures_applications (posting_id, company_id, player_id, status, month) VALUES (?, ?, ?, 'pending', ?)").run(postingId, p.company_id, user.id, w.month).lastInsertRowid);
    k.audit('apply_job', { posting: postingId, application: aid }, `player:${user.id}`);
    changed(k, tx, p.class_id);
    return { ok: true, application_id: aid };
  });
}
// The hire itself (a founder's yes, or the teacher's after it). hirerId: the founder who said yes (the registrant when a teacher approved).
export function hireNow(k, a, actor, hirerId) {
  const p = q1(k, 'SELECT * FROM ventures_postings WHERE id = ?', a.posting_id), c = company(k, a.company_id), w = needWorld(k);
  mustBe(p.open && c.status === 'active', 409, 'That posting or company is no longer open');
  const filled = filledOf(k, p.id);
  mustBe(filled < p.slots, 409, 'Every place on that posting is filled');
  mustBe(staffOf(k, c.id).length < MAX_STAFF, 409, `A company employs at most ${MAX_STAFF} people`);
  const floor = minWageOf(k, w.id);
  mustBe(p.hourly_cents >= floor, 409, `Prices have risen: that posting's wage is under today's minimum of ${money(floor)} an hour. Close it and post the job again.`);
  k.modules.call('jobs', 'hireForBusiness', { playerId: a.player_id, businessId: c.id, employer: c.name, title: p.title, hourlyCents: p.hourly_cents, hoursPerMonth: p.hours, month: w.month });
  k.db.prepare("UPDATE ventures_applications SET status = 'hired', decided_month = ? WHERE id = ?").run(w.month, a.id);
  if (filled + 1 >= p.slots) {   // the last place: the posting closes and the other applicants are told
    k.db.prepare('UPDATE ventures_postings SET open = 0 WHERE id = ?').run(p.id);
    k.db.prepare("UPDATE ventures_applications SET status = 'withdrawn', decided_month = ? WHERE posting_id = ? AND status IN ('pending', 'approved')").run(w.month, p.id);
  }
  k.audit('hire', { company: c.id, application: a.id, player: a.player_id, posting: p.id }, actor);
  const e = { playerId: a.player_id, businessId: c.id, title: p.title, wageCents: p.hourly_cents, hoursPerMonth: p.hours, hirerId: hirerId ?? c.founder_id, company: c.name, classId: c.class_id, worldId: w.id, month: w.month };
  k.db.txn((t) => t.onCommit(() => k.events.emit('hired', e)));   // module.ventures.hired, after the caller's transaction commits
}
// A founder's decision on an application: hired now, or (hire approval on) waiting for the teacher.
export function decideHire(k, user, id, appId, approve) {
  const w = needWorld(k);
  return k.db.txn((tx) => {
    const { c } = founderOf(k, user, id, ['active']);
    const a = q1(k, "SELECT * FROM ventures_applications WHERE id = ? AND company_id = ? AND status = 'pending'", appId, id);
    mustBe(a, 404, 'No such waiting application');
    let status = 'declined';
    if (!approve) k.db.prepare("UPDATE ventures_applications SET status = 'declined', decided_month = ? WHERE id = ?").run(w.month, a.id);
    else if (worldCfg(k, w.id).hire_approval) { k.db.prepare("UPDATE ventures_applications SET status = 'approved' WHERE id = ?").run(a.id); status = 'approved'; }
    else { hireNow(k, a, `player:${user.id}`, user.id); status = 'hired'; }
    changed(k, tx, c.class_id);
    return { ok: true, status };
  });
}
// Layoff: one month's notice (the next payday is the last), or now with one month's wages as pay in lieu of notice from the treasury.
export function layoff(k, user, id, playerId, mode) {
  const w = needWorld(k);
  return k.db.txn((tx) => {
    const { c } = founderOf(k, user, id);
    mustBe(['notice', 'severance'].includes(mode), 400, 'Choose notice (one month) or severance (now, one month\'s wages)');
    const r = k.modules.call('jobs', 'endBusinessJob', { playerId, businessId: c.id, mode, month: w.month });
    k.audit('layoff', { id, playerId, mode }, `player:${user.id}`);
    tx.onCommit(() => { announce(k, w, id); k.events.emit('laid_off', { playerId, businessId: c.id, mode, endsMonth: r.endsMonth, company: c.name, classId: c.class_id, worldId: w.id, month: w.month }); });
    changed(k, tx, c.class_id);
    return { ok: true, ends_month: r.endsMonth };
  });
}
