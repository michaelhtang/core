// jobs: the promotion path and the holding (standing, promote, hire, leave, apply, decide) plus the Today facts and retirement.
import { money as dollars } from '../../lib/kernel.js';
import { promoMonths, reapplyMonths, autoStep, px, holdOf, bizOf, nextStepOf } from './reads.js';

// Where this student stands on the promotion path at `month`.
export function standing(k, h, month) {
  const next = nextStepOf(k, h);
  const inStep = month - (h.step_since ?? h.since_month);
  const pending = k.db.prepare("SELECT id, month, reflection FROM jobs_applications WHERE player_id = ? AND status = 'pending'").get(h.player_id) ?? null;
  const denied = k.db.prepare("SELECT MAX(decided_month) AS m FROM jobs_applications WHERE player_id = ? AND status = 'denied' AND job_id = ? AND from_step = ?").get(h.player_id, h.job_id, h.step).m;
  const auto = !!next && autoStep(k, h);
  const eligibleMonth = Math.max((h.step_since ?? h.since_month) + promoMonths(k), denied === null || auto ? 0 : denied + reapplyMonths(k));
  return {
    next: next ? { step: next.step, title: next.title, hourly_cents: px(k, next.hourly_cents), hours_per_month: next.hours_per_month } : null, auto,
    months_in_step: inStep, eligible_month: next ? eligibleMonth : null, pending,
    can_apply: !!next && !pending && month >= eligibleMonth,
    next_raise_month: h.raise_since != null ? h.raise_since + 12 : h.since_month + 13,
  };
}

// Move to the next step now; the new wage is paid from the next payday on. Never lowers the wage a raise has already earned.
export function promote(k, h, month) {
  const next = nextStepOf(k, h);
  if (!next) return null;
  const stepWage = px(k, next.hourly_cents), wage = Math.max(h.hourly_cents, stepWage);
  k.db.prepare('UPDATE jobs_holdings SET step = ?, wage_cents = ?, step_since = ?, raise_since = ?, note = ? WHERE player_id = ?')
    .run(next.step, wage === next.hourly_cents ? null : wage, month, month, `Promotion: you are now ${next.title}, ${dollars(wage)} an hour.`, h.player_id);
  // module.jobs.promoted, after the surrounding transaction commits (outfitters unlocks the "Promoted" blazer).
  k.db.txn((tx) => tx.onCommit(() => k.events.emit('promoted', { playerId: h.player_id, worldId: k.world.current().id, month, title: next.title })));
  return next;
}

// module.jobs.hired { playerId, jobId, title, employer }, after commit: a student took (or was assigned) a job they did not hold (the feed's "took a job").
export function announceHire(k, tx, playerId, jobId) {
  const j = k.db.prepare('SELECT title, employer FROM jobs_catalogue WHERE id = ?').get(jobId);
  tx.onCommit(() => k.events.emit('hired', { playerId, jobId, title: j.title, employer: j.employer }));
}
const clearHolding = (k, playerId) => k.db.prepare("UPDATE jobs_applications SET status = 'void' WHERE player_id = ? AND status = 'pending'").run(playerId);
// Leave the job held now (switch, quit, or the teacher removes it), remembering the wage, step and clocks (jobs_past) so a return within
// REHIRE_MONTHS is a returning employee, not a new hire (review B17). Returns false when there was no job.
const REHIRE_MONTHS = 12;
// The catalogue job only: business jobs are on top of it and are left with POST /quit-business (or end with retirement, a layoff, a dissolution).
export function leave(k, playerId, month) {
  const h = holdOf(k, playerId);
  if (!h) return false;
  k.db.prepare('INSERT OR REPLACE INTO jobs_past (player_id, job_id, left_month, since_month, step, wage_cents, step_since, raise_since) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    .run(playerId, h.job_id, month, h.since_month, h.step, h.hourly_cents, h.step_since, h.raise_since);
  k.db.prepare('DELETE FROM jobs_holdings WHERE player_id = ?').run(playerId);
  clearHolding(k, playerId);
  return true;
}
// Take (or switch to) a job. Re-taking the job you already hold changes nothing, so a teacher's second click never wipes a student's progress.
// A new hire starts at catalogue x price index. Back in a job left within REHIRE_MONTHS: the previous wage and step, with every clock moved
// on by the time away (the raise and promotion clocks pause, they don't run while gone), so switching away and back within 12 months never beats
// keeping the job. Two edges, only when the teacher sets inflation above the yearly raise (docs/jobs.md): a return after more than 12 months is
// a new hire and can out-earn the stayer, and a return inside the window can earn less than a new hire would.
export function hold(k, playerId, jobId, month) {
  if (holdOf(k, playerId)?.job_id === jobId) return;
  leave(k, playerId, month);
  const p = k.db.prepare('SELECT * FROM jobs_past WHERE player_id = ? AND job_id = ? AND left_month >= ?').get(playerId, jobId, month - REHIRE_MONTHS);
  if (p) {
    const away = month - p.left_month, on = (m) => (m === null ? null : m + away);
    k.db.prepare('INSERT INTO jobs_holdings (player_id, job_id, since_month, step, wage_cents, step_since, raise_since) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(playerId, jobId, p.since_month + away, p.step, p.wage_cents, on(p.step_since), on(p.raise_since));
    return;
  }
  const base = k.db.prepare('SELECT hourly_cents FROM jobs_catalogue WHERE id = ?').get(jobId).hourly_cents, wage = px(k, base);
  k.db.prepare('INSERT INTO jobs_holdings (player_id, job_id, since_month, wage_cents) VALUES (?, ?, ?, ?)').run(playerId, jobId, month, wage === base ? null : wage);   // NULL = the catalogue wage itself
}

// A promotion application (POST /apply; bots in the sim too). Returns the application id. On an automatic step (autoStep) the application is recorded
// as approved (auto = 1) and the promotion happens now, so the teacher's list of recent promotions shows it.
export function applyFor(k, user, reflection, month) {
  const h = holdOf(k, user.id);
  if (!h) throw new k.HttpError(409, 'You do not have a job');
  const st = standing(k, h, month);
  if (!st.next) throw new k.HttpError(409, 'You are already at the top of this path');
  if (st.pending) throw new k.HttpError(409, 'You already have an application waiting for your teacher');
  if (!st.can_apply) throw new k.HttpError(409, `You can apply from world month ${st.eligible_month}`);
  return k.db.txn((tx) => {
    if (st.auto) {
      const id = Number(k.db.prepare("INSERT INTO jobs_applications (player_id, job_id, from_step, month, reflection, status, decided_month, auto) VALUES (?, ?, ?, ?, ?, 'approved', ?, 1)").run(user.id, h.job_id, h.step, month, reflection, month).lastInsertRowid);
      promote(k, h, month);
      k.audit('auto_promote', { application: id, job: h.job_id, from: h.step, to: st.next.title }, `player:${user.id}`);
      tx.onCommit(() => k.events.emit('assigned', { playerId: user.id }));
      return id;
    }
    const id = Number(k.db.prepare('INSERT INTO jobs_applications (player_id, job_id, from_step, month, reflection) VALUES (?, ?, ?, ?, ?)').run(user.id, h.job_id, h.step, month, reflection).lastInsertRowid);
    k.audit('apply', { job: h.job_id, to: st.next.title }, `player:${user.id}`);
    tx.onCommit(() => k.events.emit('assigned', { playerId: user.id }));
    return id;
  });
}

// Approve or deny a pending application `a` (POST /decide; the sim's bots too). A stale one (job or step changed since) is voided.
export function decide(k, a, approve, month, actor) {
  if (a.status !== 'pending') return;                                    // already decided (an automatic promotion is approved when it is made)
  k.db.txn((tx) => {
    const h = holdOf(k, a.player_id);
    const stale = !h || h.job_id !== a.job_id || h.step !== a.from_step;
    const result = stale ? 'void' : approve ? 'approved' : 'denied';
    if (result === 'approved') promote(k, h, month);
    k.db.prepare('UPDATE jobs_applications SET status = ?, decided_month = ? WHERE id = ?').run(result, month, a.id);
    k.audit('decide', { application: a.id, player: a.player_id, result }, actor);
    tx.onCommit(() => k.events.emit('assigned', { playerId: a.player_id }));
  });
}

// The Today card's facts (modules/today, docs/phase5-life.md 5a): read-only, flat numbers and booleans about one student.
// review 6c-6: hasJob = the catalogue job OR a part-time company job (stress's "no job", the pick-a-job errand); hasCompanyJob on its own.
export function todayFacts(k, { playerId }) {
  const h = holdOf(k, playerId), hasCompanyJob = !!k.db.prepare('SELECT 1 FROM jobs_business WHERE player_id = ?').get(playerId);
  if (!h) return { hasJob: hasCompanyJob, hasCompanyJob, promotionEligible: false, applicationPending: false, monthsInStep: 0 };
  const st = standing(k, h, k.world.current()?.month ?? 0);
  return { hasJob: true, hasCompanyJob, promotionEligible: st.can_apply, applicationPending: !!st.pending, monthsInStep: st.months_in_step };
}

// End a student's job for a reason (life's retirement, docs/phase5-life.md 5b): the same leave() as quitting, so jobs_past keeps the rejoin
// rule (back in the same job within 12 months keeps the wage), and the reason goes on this month's pay stubs when there are any (life calls it
// right after payday, so they are the last pay). 6c: every business job ends too, at once with no pay in lieu (retirement is the student's
// own end of work, not a layoff); `businessIds` lists them. Idempotent: no job (or already ended) changes nothing and returns ended: false.
export function endHolding(k, { playerId, reason } = {}) {
  if (!Number.isSafeInteger(playerId)) throw new k.HttpError(400, 'playerId must be a whole number');
  const why = typeof reason === 'string' ? reason.replace(/[\u0000-\u001f\u007f]+/g, ' ').trim().slice(0, 200) : '';
  const w = k.world.current();
  const month = w?.month ?? 0;
  return k.db.txn((tx) => {
    const h = holdOf(k, playerId), businessIds = bizOf(k, playerId).map((b) => b.business_id);
    if (!h && !businessIds.length) return { playerId, ended: false, jobId: null, businessIds, month, reason: why };
    leave(k, playerId, month);
    k.db.prepare('DELETE FROM jobs_business WHERE player_id = ?').run(playerId);
    if (why && w) k.db.prepare("UPDATE jobs_paystubs SET note = TRIM(note || ' ' || ?) WHERE player_id = ? AND world_id = ? AND month = ?").run(why, playerId, w.id, month);
    k.audit('end', { player: playerId, job: h?.job_id ?? null, businesses: businessIds, reason: why });
    tx.onCommit(() => k.events.emit('assigned', { playerId }));
    return { playerId, ended: true, jobId: h?.job_id ?? null, businessIds, month, reason: why };
  });
}
