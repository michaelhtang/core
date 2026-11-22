// stress: a 0-100 stress score per student per season, and the emergency loan (docs/phase6-roles.md §1.1, "As built (6a stress + flags)").
// Reads no other module's tables. Inputs: jobs.todayFacts (jobless), life.retired, module.bills.late (late bills), module.housing.payment
// (a missed mortgage or rent payment), module.housing.evicted (6b; nothing emits it yet), module.jobs.paid (the last net pay, for the loan size).
// Listeners count into stress_marks keyed by the event's own month, so a 12-month advance scores each month on that month's events only.
// Config order: after bills (this month's late bills are known), before leaderboards (its health board reads module.stress.score).
//
// The loan is the mortgage pattern: an account of kind 'loan' (negative = owed), disbursed as one txn loan -P / chequing +P, repaid at each tick
// as one txn chequing -due / loan +principal / sink +interest (housing/mortgage.js maths). A short chequing is a missed payment: that month's
// interest and a $25 fee are added to the debt (loan -x / sink +x, one txn), stress +10, and module.stress.payment { onTime: false } (credit marks it late).
// Missed months do not count as payments, so the term stretches by one month per miss; the 12th payment made clears whatever is left.
import { defineModule } from '../../lib/modules.js';
import { money, ok } from '../../lib/kernel.js';
import { payment, interestFor } from '../housing/mortgage.js';

const ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 12h4l2-6 4 12 2-6h6"/></svg>';
const TERM = 12, FEE_CENTS = 2500, FLOOR_CENTS = 100000, AUTO_AT = 80, ASK_FROM = 50, GRACE_MONTHS = 2, APR_BP = 1999;
const POINTS = { jobless: 15, late: 10, lateAgain: 5, lateCap: 30, missed: 20, evicted: 25, loanMissed: 10, calmJob: -10, calm: -5 };
const LEVELS = [[80, 'Crisis'], [50, 'Strained'], [25, 'Tight'], [0, 'Calm']];
export const levelOf = (score) => LEVELS.find(([min]) => score >= min)[1];

const aprBp = (k) => (Number.isSafeInteger(k.config.loanAprBp) && k.config.loanAprBp >= 500 && k.config.loanAprBp <= 3000 ? k.config.loanAprBp : APR_BP);
const stateOf = (k, playerId, worldId) => k.db.prepare('SELECT * FROM stress_state WHERE player_id = ? AND world_id = ?').get(playerId, worldId);
const loanOf = (k, playerId, worldId) => k.db.prepare("SELECT * FROM stress_loans WHERE player_id = ? AND world_id = ? AND status = 'open'").get(playerId, worldId);
const owed = (k, loan) => Math.max(0, -k.ledger.balance(loan.account_id));
// max($1,000 at today's prices, the last net pay), to the dollar
const principalFor = (k, worldId, st) => Math.round(Math.max(Math.round((FLOOR_CENTS * k.world.priceIndex(worldId)) / 10000), st?.net_cents ?? 0) / 100) * 100;

function bump(k, p, col) {   // col is a literal in this file
  if (!ok(p?.playerId)) return;
  const w = ok(p.worldId) ? p.worldId : k.world.current()?.id, month = ok(p.month) ? p.month : k.world.current()?.month;
  if (!ok(w) || !ok(month)) return;
  k.db.prepare(`INSERT INTO stress_marks (player_id, world_id, month, ${col}) VALUES (?, ?, ?, 1) ON CONFLICT (player_id, world_id, month) DO UPDATE SET ${col} = ${col} + 1`).run(p.playerId, w, month);
}

// The loan, opened inside the caller's transaction (the tick, or the student's request). The event goes out at once, inside it.
function openLoan(k, w, playerId, month, how) {
  const cents = principalFor(k, w.id, stateOf(k, playerId, w.id)), apr = aprBp(k), pay = payment(cents, apr, TERM);
  const account = k.ledger.openAccount({ ownerType: 'player', ownerId: playerId, kind: 'loan' });
  k.ledger.post({
    kind: 'loan', actor: how === 'asked' ? `player:${playerId}` : 'system', meta: { month, aprBp: apr, paymentCents: pay, how },
    legs: [{ account, cents: -cents, memo: 'Emergency loan' }, { account: k.ledger.accountId('player', playerId, 'chequing'), cents, memo: 'Emergency loan' }],
  });
  k.db.prepare('INSERT INTO stress_loans (player_id, world_id, account_id, principal_cents, apr_bp, payment_cents, opened_month, how) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(playerId, w.id, account, cents, apr, pay, month, how);
  k.audit('loan', { playerId, cents, aprBp: apr, how }, how === 'asked' ? `player:${playerId}` : 'system');
  k.events.emit('loan', { playerId, worldId: w.id, cents, aprBp: apr });
}

// One month's payment. Returns false when it was missed.
function payLoan(k, w, playerId, month, loan) {
  const debt = owed(k, loan);
  const close = () => {
    k.db.prepare("UPDATE stress_loans SET status = 'closed', closed_month = ? WHERE id = ?").run(month, loan.id);
    k.events.emit('loan_closed', { playerId, worldId: w.id, cents: loan.principal_cents, aprBp: loan.apr_bp });
  };
  if (debt <= 0) { close(); return true; }
  const interest = interestFor(debt, loan.apr_bp);
  // the 12th payment clears what is left, but only when nothing was missed: after a miss the term simply stretches at the regular payment (a one-shot balloon of
  // the added interest and fees could stay out of reach and every month would be another miss)
  const due = (loan.paid_n + 1 >= TERM && loan.missed_n === 0) || debt + interest <= loan.payment_cents ? debt + interest : loan.payment_cents;
  const chq = k.ledger.accountId('player', playerId, 'chequing'), sink = k.ledger.system('sink');
  if (chq && k.ledger.balance(chq) >= due) {
    const principal = due - interest;
    k.ledger.post({
      kind: 'loan_payment', actor: 'system', meta: { month, loanId: loan.id, interest, principal },
      legs: [{ account: chq, cents: -due, memo: 'Emergency loan payment' }, { account: loan.account_id, cents: principal, memo: 'Principal' }, { account: sink, cents: interest, memo: 'Loan interest' }].filter((l) => l.cents !== 0),
    });
    k.db.prepare('UPDATE stress_loans SET paid_n = paid_n + 1 WHERE id = ?').run(loan.id);
    k.events.emit('payment', { playerId, worldId: w.id, month, onTime: true, amount: due, kind: 'loan' });
    if (debt - principal <= 0) close();
    return true;
  }
  k.ledger.post({
    kind: 'loan_missed', actor: 'system', meta: { month, loanId: loan.id, interest, fee: FEE_CENTS },
    legs: [{ account: loan.account_id, cents: -(interest + FEE_CENTS), memo: `Payment missed: interest${interest ? '' : ' (none)'} and a ${money(FEE_CENTS)} fee added` }, { account: sink, cents: interest + FEE_CENTS, memo: 'Loan interest and missed-payment fee' }],
  });
  k.db.prepare('UPDATE stress_loans SET missed_n = missed_n + 1 WHERE id = ?').run(loan.id);
  k.events.emit('payment', { playerId, worldId: w.id, month, onTime: false, amount: due, kind: 'loan' });
  return false;
}

function tickOne(k, w, month, id) {
  const st = stateOf(k, id, w.id);
  if (st?.updated_month >= month) return;
  const marks = k.db.prepare('SELECT late, late_again, missed, evicted FROM stress_marks WHERE player_id = ? AND world_id = ? AND month = ?').get(id, w.id, month) ?? { late: 0, late_again: 0, missed: 0, evicted: 0 };
  k.db.prepare('DELETE FROM stress_marks WHERE player_id = ? AND world_id = ? AND month <= ?').run(id, w.id, month);
  const why = [];
  const add = (text, points) => why.push({ text, points });
  let loan = loanOf(k, id, w.id);
  if (loan && loan.opened_month < month && !payLoan(k, w, id, month, loan)) add('Missed an emergency loan payment', POINTS.loanMissed);
  const hasJob = k.modules.has('jobs') ? k.modules.call('jobs', 'todayFacts', { playerId: id }).hasJob === true : null;
  if (hasJob === false && month > GRACE_MONTHS && !(k.modules.has('life') && k.modules.call('life', 'retired', { playerId: id }).retired)) add('No job', POINTS.jobless);
  const lates = marks.late + marks.late_again;
  if (lates) add(`${lates} bill${lates === 1 ? '' : 's'} late`, Math.min(POINTS.lateCap, POINTS.late * marks.late + POINTS.lateAgain * marks.late_again));
  if (marks.missed) add(`Missed ${marks.missed === 1 ? 'a housing payment' : `${marks.missed} housing payments`}`, POINTS.missed * marks.missed);
  if (marks.evicted) add('Evicted', POINTS.evicted * marks.evicted);
  if (!why.length) add(hasJob ? 'A calm month with a job' : 'A calm month', hasJob ? POINTS.calmJob : POINTS.calm);
  const prev = st?.score ?? 0;
  const score = Math.max(0, Math.min(100, prev + why.reduce((t, x) => t + x.points, 0)));
  k.db.prepare(`INSERT INTO stress_state (player_id, world_id, score, updated_month, why) VALUES (?, ?, ?, ?, ?)
    ON CONFLICT (player_id, world_id) DO UPDATE SET score = excluded.score, updated_month = excluded.updated_month, why = excluded.why`).run(id, w.id, score, month, JSON.stringify(why));
  loan = loanOf(k, id, w.id);
  if (prev < AUTO_AT && score >= AUTO_AT && !loan) openLoan(k, w, id, month, 'auto');
  k.events.emit('score', { playerId: id, worldId: w.id, month, score });
}

function tick(k, { month, classes }) {
  const w = k.world.current();
  k.forEachPlayer(classes.flatMap((c) => c.studentIds), (id) => tickOne(k, w, month, id));
}

const whyText = (why) => why.map((x) => `${x.points > 0 ? '+' : '−'}${Math.abs(x.points)} ${x.text.toLowerCase()}`).join(', ');

function loanView(k, loan) {
  return loan && { left_cents: owed(k, loan), payment_cents: loan.payment_cents, apr_bp: loan.apr_bp, principal_cents: loan.principal_cents, paid: loan.paid_n, of: TERM, missed: loan.missed_n, opened_month: loan.opened_month };
}

function card(k, w, playerId) {
  const st = stateOf(k, playerId, w.id), loan = loanOf(k, playerId, w.id), score = st?.score ?? 0;
  return {
    score, level: levelOf(score), month: st?.updated_month ?? null, why: JSON.parse(st?.why ?? '[]'), loan: loanView(k, loan),
    can_ask: !loan && score >= ASK_FROM, ask_from: ASK_FROM, auto_at: AUTO_AT, offer_cents: loan ? null : principalFor(k, w.id, st), apr_bp: aprBp(k), term: TERM, fee_cents: FEE_CENTS,
  };
}

export default defineModule({
  id: 'stress',
  requires: ['bank-basic'],
  options: { loanAprBp: 'emergency loan APR in basis points, 500-3000 (default 1999)' },

  migrations: [{ id: '001_stress', sql: `
CREATE TABLE stress_state (       -- one row per student per season, written at each tick
  player_id INTEGER NOT NULL REFERENCES players(id), world_id INTEGER NOT NULL REFERENCES worlds(id),
  score INTEGER NOT NULL DEFAULT 0 CHECK (score BETWEEN 0 AND 100), updated_month INTEGER,
  why TEXT NOT NULL DEFAULT '[]',   -- what moved it at the last tick: [{ text, points }]
  net_cents INTEGER, pay_month INTEGER,   -- module.jobs.paid: the last net pay (the loan size)
  PRIMARY KEY (player_id, world_id)
);
CREATE TABLE stress_marks (       -- events counted for one world month, read and deleted by that month's tick
  player_id INTEGER NOT NULL REFERENCES players(id), world_id INTEGER NOT NULL, month INTEGER NOT NULL,
  late INTEGER NOT NULL DEFAULT 0, missed INTEGER NOT NULL DEFAULT 0, evicted INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (player_id, world_id, month)
);
CREATE TABLE stress_loans (
  id INTEGER PRIMARY KEY, player_id INTEGER NOT NULL REFERENCES players(id), world_id INTEGER NOT NULL REFERENCES worlds(id),
  account_id INTEGER NOT NULL REFERENCES accounts(id), principal_cents INTEGER NOT NULL, apr_bp INTEGER NOT NULL, payment_cents INTEGER NOT NULL,
  opened_month INTEGER NOT NULL, paid_n INTEGER NOT NULL DEFAULT 0, missed_n INTEGER NOT NULL DEFAULT 0, how TEXT NOT NULL CHECK (how IN ('auto','asked')),
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','closed')), closed_month INTEGER
);
CREATE UNIQUE INDEX stress_one_loan ON stress_loans(player_id, world_id) WHERE status = 'open';` },
  { id: '002_late_again', sql: `ALTER TABLE stress_marks ADD COLUMN late_again INTEGER NOT NULL DEFAULT 0;` }],

  events: {
    // a fee line is a consequence, not a bill; a bill's first late month counts in full, each later month it stays unpaid (bills re-emits it every tick) counts half,
    // so a 12-month advance cannot push a student into an automatic loan for one forgotten bill
    'module.bills.late': (k, p) => { if (!String(p?.billId).startsWith('late-fee-')) bump(k, p, p?.first === false ? 'late_again' : 'late'); },
    'module.housing.payment': (k, p) => { if (p?.onTime === false) bump(k, p, 'missed'); },
    'module.housing.evicted': (k, p) => bump(k, p, 'evicted'),   // 6b
    'module.jobs.paid'(k, p) {
      if (!ok(p?.playerId) || !ok(p.net) || !ok(p.month)) return;
      const w = ok(p.worldId) ? p.worldId : k.world.current()?.id;
      if (ok(w)) k.db.prepare(`INSERT INTO stress_state (player_id, world_id, net_cents, pay_month) VALUES (?, ?, ?, ?)
        ON CONFLICT (player_id, world_id) DO UPDATE SET net_cents = excluded.net_cents, pay_month = excluded.pay_month`).run(p.playerId, w, p.net, p.month);
    },
  },

  onTick: tick,

  services: {
    todayFacts(k, { playerId, worldId } = {}) {
      const w = ok(worldId) ? worldId : k.world.current()?.id;
      const score = stateOf(k, playerId, w)?.score ?? 0;
      return { score, level: levelOf(score), hasLoan: !!loanOf(k, playerId, w) };
    },
  },

  // the loan account is zeroed by the core season reset; close the rows so the next world (which reuses the same ledger account) starts clean
  seasonClose: (k, { world }) => { k.db.prepare("UPDATE stress_loans SET status = 'closed', closed_month = ? WHERE world_id = ? AND status = 'open'").run(world.month, world.id); },

  badges(k, user) {
    const w = k.world.current();
    const st = w && stateOf(k, user.id, w.id);
    if (!st || st.updated_month == null) return [];
    const why = JSON.parse(st.why);
    return [{ text: `Stress ${st.score} · ${levelOf(st.score)}`, title: `Stress, 0 to 100. This month: ${whyText(why) || 'no change'}.` }];
  },

  cards: [{ id: 'stress', src: 'stress.js' }],
  homeCards(k, user) {
    const w = k.world.current();
    if (w?.status !== 'active' || !stateOf(k, user.id, w.id)?.updated_month) return [];
    return [{ id: 'stress', title: 'Stress', data: card(k, w, user.id) }];
  },

  teacherPanels: [{ id: 'stress-teach', title: 'Stress', src: 'teach.js' }],

  routes: [
    {
      method: 'POST', path: '/loan', access: 'student',   // ask for the emergency loan: from a score of 50, one at a time
      handler(k, { user }) {
        const w = k.world.active();
        return k.db.txn(() => {
          const score = stateOf(k, user.id, w.id)?.score ?? 0;
          if (loanOf(k, user.id, w.id)) throw new k.HttpError(409, 'You already have an emergency loan. Pay it off first.');
          if (score < ASK_FROM) throw new k.HttpError(409, `Your stress is ${score}. The emergency loan opens at ${ASK_FROM}.`);
          openLoan(k, w, user.id, w.month, 'asked');
          return card(k, w, user.id);
        });
      },
    },
    {
      method: 'GET', path: '/teach', access: 'teacher',
      handler(k, { user }) {
        const w = k.world.current();
        return {
          month: w?.month ?? null,
          classes: k.players.classesFor(user).map((c) => ({
            id: c.id, name: c.name,
            students: k.players.inClass(c.id).map((s) => {
              const st = w && stateOf(k, s.id, w.id), loan = w && loanOf(k, s.id, w.id), score = st?.score ?? 0;
              return { username: s.username, score, level: levelOf(score), loan_left_cents: loan ? owed(k, loan) : null, loan_missed: loan?.missed_n ?? 0 };
            }),
          })),
        };
      },
    },
  ],
});
