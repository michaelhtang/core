// credit: the Credit Bureau and the card desk (docs/phase2.md Wave 2a, docs/credit.md).
// Inputs arrive ONLY as events (this module reads no other module's tables): module.jobs.paid (gross, for the card limit),
// module.bills.paid / module.bills.late and module.housing.payment (payment history), module.rates.changed (card APR).
// Everything is kept per world (season). A "file" opens with the first credit product; before that the score is null.
//
// The card is a ledger account of kind 'card' opened through k.ledger.openAccount({ ..., allowNegative: true }); the kernel facade passes
// that option straight through, so no core change was needed. A negative balance is money owed. The limit is enforced here and by
// whoever spends on the card (bills, later Outfitters); module.credit.limit announces the limit so they can.
//
// Tick order, per card holder: (1) autopay first: 'full' pays everything owed now (the last statement included), 'min' the last statement's
// minimum, (2) that statement is judged: unpaid minimum = $29 late fee and a late mark, interest on the whole statement balance if it was
// not paid in full, (3) a new statement for what is owed after autopay, (4) the score is recomputed and announced. Autopay goes first on
// purpose, so autopay-full never pays interest and autopay-min is never late. Credit ticks BEFORE bills (config order): what bills charges
// to the card after this tick lands in the next statement, and autopay-full clears it at the next tick.
// Multi-month advances: a statement issued during this advance (month > onTick's startMonth) is not judged yet, and no new statement replaces
// it: (2) and (3) wait for the next advance, so the student always gets a live month to pay. Autopay still runs every tick.
import { defineModule } from '../../lib/modules.js';
import { money, dice, ok } from '../../lib/kernel.js';
import { CARD_APR_BP, LATE_FEE_CENTS, LIMIT, INQUIRY_WINDOW } from './constants.js';
import { bandOf } from './constants.js';
import { computeScore, minimumPayment, statementInterest, payoff, decideCard } from './score.js';

const ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="6" width="18" height="12" rx="2"/><path d="M3 10h18M6 15h4"/></svg>';

const world = (k) => k.world.current();
const aprBp = (k, worldId) => k.db.prepare('SELECT apr_bp FROM credit_rates WHERE world_id = ?').get(worldId)?.apr_bp ?? CARD_APR_BP;
const cardOf = (k, playerId, worldId) => k.db.prepare('SELECT * FROM credit_cards WHERE player_id = ? AND world_id = ?').get(playerId, worldId);
const owedOn = (k, card) => Math.max(0, -k.ledger.balance(card.account_id));

function mark(k, playerId, worldId, source, ref, month, outcome) {
  k.db.prepare('INSERT OR IGNORE INTO credit_history (player_id, world_id, month, source, ref, outcome) VALUES (?, ?, ?, ?, ?, ?)').run(playerId, worldId, month, source, String(ref).slice(0, 40), outcome);
}
const openFile = (k, playerId, worldId, month) => k.db.prepare('INSERT OR IGNORE INTO credit_files (player_id, world_id, opened_month) VALUES (?, ?, ?)').run(playerId, worldId, month);

// The score for one student right now, from their own tables. null = no file.
function scoreOf(k, w, month, playerId) {
  const file = k.db.prepare('SELECT * FROM credit_files WHERE player_id = ? AND world_id = ?').get(playerId, w.id);
  if (!file) return null;
  const card = cardOf(k, playerId, w.id);
  return computeScore({
    month,
    file: { openedMonth: file.opened_month, products: (card ? 1 : 0) + file.mortgage, inquiryMonths: k.db.prepare('SELECT month FROM credit_inquiries WHERE player_id = ? AND world_id = ?').all(playerId, w.id).map((r) => r.month) },
    history: k.db.prepare('SELECT month, outcome, COUNT(*) AS n FROM credit_history WHERE player_id = ? AND world_id = ? GROUP BY month, outcome').all(playerId, w.id),
    card: card ? { owedCents: owedOn(k, card), limitCents: card.limit_cents } : null,
  });
}

// Money from chequing to the card. Counts toward the open statement.
function payCard(k, playerId, w, cents, { autopay = false } = {}) {
  const card = cardOf(k, playerId, w.id);
  return k.db.txn(() => {
    const txn = k.ledger.post({
      kind: 'payment', actor: autopay ? 'system' : `player:${playerId}`, meta: { month: w.month, autopay },
      legs: [{ account: k.ledger.accountId('player', playerId, 'chequing'), cents: -cents, memo: 'Credit card payment' }, { account: card.account_id, cents, memo: 'Payment received' }],
    });
    k.db.prepare('UPDATE credit_statements SET paid_cents = paid_cents + ? WHERE player_id = ? AND world_id = ? AND settled = 0').run(cents, playerId, w.id);
    return txn;
  });
}

const openStatement = (k, playerId, worldId) => k.db.prepare('SELECT * FROM credit_statements WHERE player_id = ? AND world_id = ? AND settled = 0 ORDER BY id DESC LIMIT 1').get(playerId, worldId);
const charge = (k, card, kind, cents, memo, meta) => k.ledger.post({ kind, meta, legs: [{ account: card.account_id, cents: -cents, memo }, { account: k.ledger.system('sink'), cents, memo }] });

// What is still due toward the minimum: nothing once payments and on-statement refunds cover the statement's balance.
const minLeft = (st) => (st.paid_cents + st.refund_cents >= st.balance_cents ? 0 : Math.max(0, st.minimum_cents - st.paid_cents));

function tickCard(k, w, month, startMonth, playerId, card) {
  const apr = aprBp(k, w.id);
  const chq = k.ledger.accountId('player', playerId, 'chequing');
  // (1) autopay, all or nothing, never an overdraft. 'full' pays everything owed NOW (the last statement and any charge since);
  // 'min' pays the last statement's minimum. Whatever is charged after this tick (bills ticks after credit) lands in the next statement.
  let st = openStatement(k, playerId, w.id);
  if (card.autopay !== 'off' && chq) {
    const left = card.autopay === 'full' ? Infinity : st ? minLeft(st) : 0;
    const need = Math.min(left, owedOn(k, card));
    if (need > 0 && k.ledger.balance(chq) >= need) payCard(k, playerId, w, need, { autopay: true });
  }
  if (st && st.month > startMonth) return;                                         // issued during this advance: judged at the next one
  if (st) {
    st = openStatement(k, playerId, w.id);
    // A store refund (refund_cents) is a credit, not a payment: by itself it never meets the minimum, but with payments it can settle the statement balance it was on.
    const fullPaid = st.paid_cents + st.refund_cents >= st.balance_cents, minPaid = st.paid_cents >= st.minimum_cents || fullPaid;
    const interest = fullPaid ? 0 : statementInterest(st.balance_cents, apr);   // (2) judge the last statement
    const fee = minPaid ? 0 : LATE_FEE_CENTS;
    if (interest > 0) charge(k, card, 'interest', interest, `Interest at ${apr / 100}% on statement balance`, { month, apr });
    if (fee > 0) charge(k, card, 'late_fee', fee, 'Late fee: minimum payment missed', { month });
    mark(k, playerId, w.id, 'card', 'statement', month, minPaid ? 'ontime' : 'late');
    k.db.prepare('UPDATE credit_statements SET settled = 1, interest_cents = ?, fee_cents = ? WHERE id = ?').run(interest, fee, st.id);
  }
  const owed = owedOn(k, card);                                                    // (3) the new statement: what is owed after autopay
  if (owed > 0) k.db.prepare('INSERT OR IGNORE INTO credit_statements (player_id, world_id, month, balance_cents, minimum_cents, due_month) VALUES (?, ?, ?, ?, ?, ?)').run(playerId, w.id, month, owed, minimumPayment(owed), month + 1);
  // module.credit.statement: housing's TDS needs the card's minimum payment. Also sent with 0 / 0 when nothing is owed, so a paid-off card clears it.
  k.events.emit('statement', { playerId, worldId: w.id, month, balance: owed, minimum: owed > 0 ? minimumPayment(owed) : 0 });
}

function tick(k, { month, startMonth, classes }) {
  const w = world(k);
  const ids = classes.flatMap((c) => c.studentIds);
  if (!ids.length) return;
  const files = k.db.prepare('SELECT player_id FROM credit_files WHERE world_id = ? AND player_id IN (SELECT value FROM json_each(?)) ORDER BY player_id').all(w.id, JSON.stringify(ids));
  const save = k.db.prepare('INSERT OR REPLACE INTO credit_scores (player_id, world_id, month, score) VALUES (?, ?, ?, ?)');
  k.forEachPlayer(files.map((f) => f.player_id), (id) => {                       // each student in its own savepoint
    const card = cardOf(k, id, w.id);
    if (card) tickCard(k, w, month, startMonth, id, card);
    const s = scoreOf(k, w, month, id);                                            // (4)
    save.run(id, w.id, month, s.score);
    k.events.emit('score', { playerId: id, worldId: w.id, month, score: s.score });
  });
}

function apply(k, user) {
  const w = world(k), month = w.month;
  return k.db.txn((tx) => {
    if (cardOf(k, user.id, w.id)) throw new k.HttpError(409, 'You already have a card');
    const avg = Math.floor(k.db.prepare('SELECT COALESCE(SUM(gross_cents), 0) AS n FROM credit_income WHERE player_id = ? AND world_id = ? AND month > ? AND month <= ?').get(user.id, w.id, month - LIMIT.windowMonths, month).n / LIMIT.windowMonths);
    const before = scoreOf(k, w, month, user.id)?.score ?? null;
    const inquiries12 = k.db.prepare('SELECT COUNT(*) AS n FROM credit_inquiries WHERE player_id = ? AND world_id = ? AND month > ?').get(user.id, w.id, month - INQUIRY_WINDOW).n;
    const d = decideCard({ avgGrossCents: avg, score: before, inquiries12 });
    k.db.prepare('INSERT INTO credit_inquiries (player_id, world_id, month, approved, limit_cents, reasons) VALUES (?, ?, ?, ?, ?, ?)').run(user.id, w.id, month, d.approved ? 1 : 0, d.limitCents, JSON.stringify(d.reasons));
    if (d.approved) {
      const account = k.ledger.openAccount({ ownerType: 'player', ownerId: user.id, kind: 'card', allowNegative: true });
      openFile(k, user.id, w.id, month);
      k.db.prepare('INSERT INTO credit_cards (player_id, world_id, account_id, limit_cents, opened_month) VALUES (?, ?, ?, ?, ?)').run(user.id, w.id, account, d.limitCents, month);
      k.audit('card_approved', { playerId: user.id, limit: d.limitCents }, `player:${user.id}`);
      tx.onCommit(() => k.events.emit('limit', { playerId: user.id, worldId: w.id, limitCents: d.limitCents, aprBp: aprBp(k, w.id) }));   // module.credit.limit: bills (and later Outfitters) learn the card's limit from here
    }
    tx.onCommit(() => k.events.emit('changed', { classId: user.class_id }));
    return { approved: d.approved, limit_cents: d.limitCents, reasons: d.reasons, avg_gross_cents: avg, score_before: before };
  });
}

const lastApplication = (k, playerId, worldId) => {
  const r = k.db.prepare('SELECT month, approved, limit_cents, reasons FROM credit_inquiries WHERE player_id = ? AND world_id = ? ORDER BY id DESC LIMIT 1').get(playerId, worldId);
  return r && { ...r, approved: !!r.approved, reasons: JSON.parse(r.reasons) };
};

function state(k, user) {
  const w = world(k), month = w.month;
  const s = scoreOf(k, w, month, user.id);
  const prev = k.db.prepare('SELECT score FROM credit_scores WHERE player_id = ? AND world_id = ? AND month < ? ORDER BY month DESC LIMIT 1').get(user.id, w.id, month)?.score ?? null;
  const card = cardOf(k, user.id, w.id);
  const apr = aprBp(k, w.id);
  const chq = k.ledger.accountId('player', user.id, 'chequing');
  const avg = Math.floor(k.db.prepare('SELECT COALESCE(SUM(gross_cents), 0) AS n FROM credit_income WHERE player_id = ? AND world_id = ? AND month > ? AND month <= ?').get(user.id, w.id, month - LIMIT.windowMonths, month).n / LIMIT.windowMonths);
  const owed = card ? owedOn(k, card) : 0;
  const stmt = card ? openStatement(k, user.id, w.id) : null;
  return {
    month, chequing_cents: chq ? k.ledger.balance(chq) : 0,
    score: s ? { score: s.score, band: bandOf(s.score), previous: prev, factors: s.factors } : null,
    no_file_message: s ? null : 'No credit history yet. Your file opens when you get your first credit product, such as the card.',
    apply: card ? null : { avg_gross_cents: avg, min_avg_gross_cents: LIMIT.minAvgGrossCents, limit_range: [LIMIT.minCents, LIMIT.maxCents], last: lastApplication(k, user.id, w.id) },
    card: card ? {
      limit_cents: card.limit_cents, owed_cents: owed, available_cents: Math.max(0, card.limit_cents - owed), apr_bp: apr, autopay: card.autopay,
      utilization: card.limit_cents ? owed / card.limit_cents : 0, late_fee_cents: LATE_FEE_CENTS,
      statement: stmt && { month: stmt.month, balance_cents: stmt.balance_cents, minimum_cents: stmt.minimum_cents, due_month: stmt.due_month, paid_cents: stmt.paid_cents, refund_cents: stmt.refund_cents, minimum_left_cents: minLeft(stmt) },
      statements: k.db.prepare('SELECT month, balance_cents, minimum_cents, paid_cents, refund_cents, interest_cents, fee_cents FROM credit_statements WHERE player_id = ? AND world_id = ? AND settled = 1 ORDER BY id DESC LIMIT 6').all(user.id, w.id),
    } : null,
    inquiries: k.db.prepare('SELECT month, approved FROM credit_inquiries WHERE player_id = ? AND world_id = ? ORDER BY id DESC LIMIT 5').all(user.id, w.id),
    default_apr_bp: apr,
  };
}

// The Today card's facts (modules/today): read-only. minimumDueCents = what is still due toward the open statement's minimum.
function todayFacts(k, { playerId }) {
  const w = k.world.current();
  const st = openStatement(k, playerId, w.id);
  return {
    hasCard: !!k.db.prepare('SELECT 1 FROM credit_cards WHERE player_id = ? AND world_id = ?').get(playerId, w.id),
    inquiries: k.db.prepare('SELECT COUNT(*) AS n FROM credit_inquiries WHERE player_id = ? AND world_id = ?').get(playerId, w.id).n,
    minimumDueCents: st ? minLeft(st) : 0,
  };
}

export default defineModule({
  id: 'credit',
  services: { todayFacts },
  requires: ['bank-basic'],

  migrations: [{ id: '001_credit', sql: `
CREATE TABLE credit_files (   -- a file opens with the first credit product; no row = no score
  player_id INTEGER NOT NULL REFERENCES players(id), world_id INTEGER NOT NULL, opened_month INTEGER NOT NULL, mortgage INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (player_id, world_id)
);
CREATE TABLE credit_inquiries (   -- every application, approved or not
  id INTEGER PRIMARY KEY, player_id INTEGER NOT NULL REFERENCES players(id), world_id INTEGER NOT NULL, month INTEGER NOT NULL,
  approved INTEGER NOT NULL, limit_cents INTEGER NOT NULL, reasons TEXT NOT NULL
);
CREATE INDEX credit_inquiries_player ON credit_inquiries(player_id, world_id);
CREATE TABLE credit_cards (
  player_id INTEGER NOT NULL REFERENCES players(id), world_id INTEGER NOT NULL, account_id INTEGER NOT NULL REFERENCES accounts(id),
  limit_cents INTEGER NOT NULL, opened_month INTEGER NOT NULL, autopay TEXT NOT NULL DEFAULT 'off' CHECK (autopay IN ('off','min','full')),
  PRIMARY KEY (player_id, world_id)
);
CREATE TABLE credit_statements (
  id INTEGER PRIMARY KEY, player_id INTEGER NOT NULL REFERENCES players(id), world_id INTEGER NOT NULL, month INTEGER NOT NULL,
  balance_cents INTEGER NOT NULL, minimum_cents INTEGER NOT NULL, due_month INTEGER NOT NULL, paid_cents INTEGER NOT NULL DEFAULT 0,
  settled INTEGER NOT NULL DEFAULT 0, interest_cents INTEGER NOT NULL DEFAULT 0, fee_cents INTEGER NOT NULL DEFAULT 0,
  UNIQUE (player_id, world_id, month)
);
CREATE INDEX credit_statements_open ON credit_statements(player_id, world_id) WHERE settled = 0;
CREATE TABLE credit_history (   -- payment history fed by events: source bill | housing | card
  id INTEGER PRIMARY KEY, player_id INTEGER NOT NULL REFERENCES players(id), world_id INTEGER NOT NULL, month INTEGER NOT NULL,
  source TEXT NOT NULL, ref TEXT NOT NULL, outcome TEXT NOT NULL CHECK (outcome IN ('ontime','late')),
  UNIQUE (player_id, world_id, source, ref, month, outcome)
);
CREATE INDEX credit_history_player ON credit_history(player_id, world_id);
CREATE TABLE credit_income (player_id INTEGER NOT NULL REFERENCES players(id), world_id INTEGER NOT NULL, month INTEGER NOT NULL, gross_cents INTEGER NOT NULL, PRIMARY KEY (player_id, world_id, month));
CREATE TABLE credit_rates (world_id INTEGER PRIMARY KEY, apr_bp INTEGER NOT NULL);
CREATE TABLE credit_scores (player_id INTEGER NOT NULL REFERENCES players(id), world_id INTEGER NOT NULL, month INTEGER NOT NULL, score INTEGER NOT NULL, PRIMARY KEY (player_id, world_id, month));` },
  { id: '002_refunds', sql: `
-- store refunds of purchases that were on this statement: they settle its balance (no interest on them) but are not payments (no minimum, no on-time mark)
ALTER TABLE credit_statements ADD COLUMN refund_cents INTEGER NOT NULL DEFAULT 0` }],

  events: {
    'module.jobs.paid'(k, { playerId, worldId, month, gross }) {
      if (!ok(playerId) || !ok(worldId) || !ok(month) || !ok(gross)) return;
      k.db.prepare('INSERT INTO credit_income (player_id, world_id, month, gross_cents) VALUES (?, ?, ?, ?) ON CONFLICT (player_id, world_id, month) DO UPDATE SET gross_cents = gross_cents + excluded.gross_cents').run(playerId, worldId, month, gross);
    },
    // A late bill emits `late` at the tick that marks it, before it can be paid late, so `paid` with onTime false adds nothing new.
    // The on-time mark goes on the bill's due month (dueMonth; the paid month for an older payload), so a bill paid at the tick (autopay) and
    // one paid by hand in the live month after a multi-month advance count the same on-time months.
    'module.bills.paid'(k, { playerId, worldId, month, dueMonth, billId, onTime }) {
      const m = ok(dueMonth) ? dueMonth : month;
      if (ok(playerId) && ok(m) && onTime === true) mark(k, playerId, ok(worldId) ? worldId : world(k).id, 'bill', billId, m, 'ontime');
    },
    'module.bills.late'(k, { playerId, worldId, month, billId }) {
      if (ok(playerId) && ok(month)) mark(k, playerId, ok(worldId) ? worldId : world(k).id, 'bill', billId, month, 'late');
    },
    // housing.payment has no product field in docs/phase2.md; an optional `kind: 'mortgage'` also opens the file and counts toward the mix.
    'module.housing.payment'(k, { playerId, worldId, month, onTime, kind }) {
      if (!ok(playerId) || !ok(month)) return;
      const wid = ok(worldId) ? worldId : world(k).id;
      mark(k, playerId, wid, 'housing', kind ?? 'payment', month, onTime === false ? 'late' : 'ontime');
      if (kind === 'mortgage') { openFile(k, playerId, wid, month); k.db.prepare('UPDATE credit_files SET mortgage = 1 WHERE player_id = ? AND world_id = ?').run(playerId, wid); }
    },
    // The stress module's emergency loan (6a): each payment is on the history like a mortgage payment. A loan does not open a file by itself.
    'module.stress.payment'(k, { playerId, worldId, month, onTime }) {
      if (ok(playerId) && ok(month)) mark(k, playerId, ok(worldId) ? worldId : world(k).id, 'loan', 'emergency', month, onTime === false ? 'late' : 'ontime');
    },
    // A store refund to the card (outfitters resale of a card purchase) lowers the balance but is not a payment (real cards): it never counts
    // toward the minimum or an on-time mark. It counts toward paying the open statement in full only when the purchase was on that statement
    // (bought before the tick that issued it, month < statement month); a refund of a later purchase just lowers the next statement.
    'module.outfitters.refund'(k, { playerId, worldId, cents, boughtMonth }) {
      if (ok(playerId) && ok(worldId) && ok(cents) && cents > 0 && ok(boughtMonth)) k.db.prepare('UPDATE credit_statements SET refund_cents = refund_cents + ? WHERE player_id = ? AND world_id = ? AND settled = 0 AND month > ?').run(cents, playerId, worldId, boughtMonth);
    },
    'module.rates.changed'(k, { worldId, cardAprBp }) {
      if (ok(worldId) && ok(cardAprBp) && cardAprBp >= 0 && cardAprBp <= 10000) k.db.prepare('INSERT INTO credit_rates (world_id, apr_bp) VALUES (?, ?) ON CONFLICT (world_id) DO UPDATE SET apr_bp = excluded.apr_bp').run(worldId, cardAprBp);
    },
  },

  panels: [{ id: 'credit', building: { key: 'credit', name: 'Credit Bureau', icon: ICON }, src: 'credit.js' }],
  teacherPanels: [{ id: 'credit-teach', title: 'Credit', src: 'teach.js' }],

  onTick: tick,

  // Bots: 70% apply (once, from month 4, when three months of pay exist). Cardholders spend 10-40% of the limit a month (bills do not charge
  // the card yet in 2a, so without this utilization would stay 0), then 60% pay in full, 30% the minimum, 10% pick at random each month.
  simulate(k, { month, students }) {
    const w = world(k);
    for (const { id } of students) {
      if (!cardOf(k, id, w.id)) {
        if (month >= 4 && dice(id, 0, 7) < 70 && !k.db.prepare('SELECT 1 FROM credit_inquiries WHERE player_id = ? AND world_id = ?').get(id, w.id)) apply(k, { id, class_id: null });
        continue;
      }
      const card = cardOf(k, id, w.id);
      const room = card.limit_cents - owedOn(k, card);
      const spend = Math.min(room, Math.floor((card.limit_cents * (10 + dice(id, month, 3) * 0.3)) / 100));
      if (spend > 0) k.ledger.post({ kind: 'sim_purchase', legs: [{ account: card.account_id, cents: -spend }, { account: k.ledger.system('sink'), cents: spend }] });
      const kind = dice(id, 0, 11), st = openStatement(k, id, w.id);
      const mode = kind < 60 ? 'full' : kind < 90 ? 'min' : ['full', 'min', 'none'][dice(id, month, 5) % 3];
      const chq = k.ledger.balance(k.ledger.accountId('player', id, 'chequing'));
      const want = mode === 'full' ? owedOn(k, card) : mode === 'min' && st ? minLeft(st) : 0;
      const pay = Math.min(want, chq, owedOn(k, card));
      if (pay > 0) payCard(k, id, w, pay);
    }
  },

  routes: [
    { method: 'GET', path: '/state', access: 'student', handler: (k, { user }) => state(k, user) },
    { method: 'POST', path: '/apply', access: 'student', handler: (k, { user }) => apply(k, user) },
    {
      method: 'POST', path: '/pay', access: 'student',
      handler(k, { user, body }) {
        const w = world(k), card = cardOf(k, user.id, w.id);
        if (!card) throw new k.HttpError(400, 'You do not have a card yet');
        const mode = k.input.str(body, 'mode', { max: 10 });
        const owed = owedOn(k, card), st = openStatement(k, user.id, w.id);
        let cents;
        if (mode === 'min') {
          cents = st ? Math.min(minLeft(st), owed) : 0;
          if (cents <= 0) throw new k.HttpError(400, 'There is no minimum payment left to make');
        } else if (mode === 'full') {
          cents = owed;
          if (cents <= 0) throw new k.HttpError(400, 'You do not owe anything on the card');
        } else if (mode === 'amount') {
          cents = k.input.int(body, 'cents', { min: 1, max: 100_000_000_000 });
          if (cents > owed) throw new k.HttpError(400, `You only owe ${money(owed)} on the card`);
        } else throw new k.HttpError(400, 'mode must be min, full or amount');
        const bal = k.ledger.balance(k.ledger.accountId('player', user.id, 'chequing'));
        if (bal < cents) throw new k.HttpError(400, `Not enough in chequing: the payment is ${money(cents)} and you have ${money(bal)}.`);
        payCard(k, user.id, w, cents);
        return { ok: true, paid_cents: cents };
      },
    },
    {
      method: 'POST', path: '/autopay', access: 'student',
      handler(k, { user, body }) {
        const mode = k.input.str(body, 'mode', { max: 10 });
        if (!['off', 'min', 'full'].includes(mode)) throw new k.HttpError(400, 'mode must be off, min or full');
        const w = world(k);
        if (!cardOf(k, user.id, w.id)) throw new k.HttpError(400, 'You do not have a card yet');
        k.db.txn((tx) => {
          k.db.prepare('UPDATE credit_cards SET autopay = ? WHERE player_id = ? AND world_id = ?').run(mode, user.id, w.id);
          tx.onCommit(() => k.events.emit('changed', { classId: user.class_id }));
        });
        return { ok: true, autopay: mode };
      },
    },
    {
      method: 'POST', path: '/payoff', access: 'student',   // the FIN1010 calculator: pure maths on whatever the student types
      handler(k, { body }) {
        const balanceCents = k.input.int(body, 'balance_cents', { min: 1, max: 100_000_000 });
        const aprBpIn = k.input.int(body, 'apr_bp', { min: 0, max: 10000 });
        return { ...payoff({ balanceCents, aprBp: aprBpIn }), first_minimum_cents: minimumPayment(balanceCents), first_interest_cents: statementInterest(balanceCents, aprBpIn) };
      },
    },

    // ---- teacher ----
    {
      method: 'GET', path: '/teach', access: 'teacher',
      handler(k, { user }) {
        const w = world(k), month = w.month;
        const classes = k.players.classesFor(user);
        return {
          month,
          classes: classes.map((c) => {
            const students = k.players.inClass(c.id).map((s) => {
              const sc = scoreOf(k, w, month, s.id), card = cardOf(k, s.id, w.id);
              const lates = k.db.prepare("SELECT COUNT(*) AS n FROM credit_history WHERE player_id = ? AND world_id = ? AND outcome = 'late' AND month > ?").get(s.id, w.id, month - 6).n;
              const owed = card ? owedOn(k, card) : 0;
              return { id: s.id, username: s.username, score: sc?.score ?? null, band: sc ? bandOf(sc.score) : null, card: !!card, limit_cents: card?.limit_cents ?? 0, owed_cents: owed, utilization: card?.limit_cents ? owed / card.limit_cents : null, late_6m: lates };
            });
            const holders = students.filter((s) => s.card);
            const bands = ['No file', 'Poor', 'Fair', 'Good', 'Very good', 'Excellent'];
            const count = Object.fromEntries(bands.map((b) => [b, 0]));
            for (const s of students) count[s.band ?? 'No file']++;
            return {
              id: c.id, name: c.name, students,
              distribution: bands.map((band) => ({ band, count: count[band] })),
              card_holders: holders.length,
              avg_utilization: holders.length ? holders.reduce((t, s) => t + s.utilization, 0) / holders.length : null,
              late_students: students.filter((s) => s.late_6m > 0).length, late_marks: students.reduce((t, s) => t + s.late_6m, 0),
            };
          }),
        };
      },
    },
  ],
});
