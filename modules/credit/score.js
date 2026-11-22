// Pure credit maths: no I/O, so every rule here is unit-tested (test/credit.test.js). Integer cents; factors are 0..1.
import { WEIGHTS, SCORE_MIN, SCORE_MAX, PAYMENT, UTILIZATION_CURVE, LENGTH_FULL_MONTHS, NEW_CREDIT, INQUIRY_WINDOW, MIX, MIN_PAYMENT, LIMIT, SCORE_DECLINE_BELOW, MAX_INQUIRIES, limitPct } from './constants.js';

const clamp = (x, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, x));
const interp = (curve, x) => {
  if (x <= curve[0][0]) return curve[0][1];
  for (let i = 1; i < curve.length; i++) {
    const [x1, y1] = curve[i];
    if (x <= x1) { const [x0, y0] = curve[i - 1]; return y0 + ((x - x0) / (x1 - x0)) * (y1 - y0); }
  }
  return curve.at(-1)[1];
};
const pct = (x) => `${Math.round(x * 100)}%`;
const money = (c) => `$${(c / 100).toLocaleString('en-CA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

// history: [{ month, outcome: 'ontime'|'late', n }] (n = how many marks that month). Returns the 0..1 factor plus what it saw.
export function paymentFactor(history, month) {
  const onMonths = new Set(history.filter((h) => h.outcome === 'ontime' && h.n > 0).map((h) => h.month)).size;
  let lateWeight = 0, lates = 0;
  for (const h of history) {
    if (h.outcome !== 'late' || h.n <= 0) continue;
    const marks = Math.min(h.n, PAYMENT.maxMarksPerMonth);
    lates += marks;
    lateWeight += marks * Math.max(0, 1 - (month - h.month) / PAYMENT.decayMonths);
  }
  const base = history.length ? Math.min(1, PAYMENT.thin + PAYMENT.buildPerMonth * onMonths) : PAYMENT.thin;
  return { sub: Math.round(clamp(base - PAYMENT.latePenalty * lateWeight) * 1e6) / 1e6, onMonths, lates, lateWeight };
}

// file: { openedMonth, inquiryMonths: number[], products: number }; card: { owedCents, limitCents } | null.
// Returns null with no file ("No credit history yet"), else { score, factors: [{ key, label, weight, sub, points, maxPoints, detail, tip }] }.
export function computeScore({ month, file, history = [], card = null }) {
  if (!file) return null;
  const pay = paymentFactor(history, month);
  const util = card && card.limitCents > 0 ? Math.max(0, card.owedCents) / card.limitCents : null;
  const age = Math.max(0, month - file.openedMonth);
  const apps = file.inquiryMonths.filter((m) => month - m < INQUIRY_WINDOW).length;
  const products = Math.min(file.products, MIX.length - 1);
  const f = [
    { key: 'payment', label: 'Payment history', sub: pay.sub,
      detail: pay.lates ? `${pay.lates} late payment${pay.lates === 1 ? '' : 's'} on file; each fades away over ${PAYMENT.decayMonths} months.` : history.length ? `No late payments. ${pay.onMonths} month${pay.onMonths === 1 ? '' : 's'} of on-time payments.` : 'Too little history yet to show a pattern.',
      tip: pay.lates ? 'Pay every bill and the card minimum before the next month. A late mark fades with time, but only if you stop adding new ones.' : 'Keep paying everything on time. Autopay on bills and the card makes this the easiest 35% to protect.' },
    { key: 'utilization', label: 'Card balance vs limit', sub: util === null ? 0.5 : interp(UTILIZATION_CURVE, util),
      detail: util === null ? 'No card yet, so this part is neutral.' : `You owe ${money(card.owedCents)} of a ${money(card.limitCents)} limit (${pct(util)}).`,
      tip: util === null || util <= 0.3 ? 'Keep your balance under 30% of the limit and you keep most of these points.' : 'Pay the balance down. Under 30% of your limit is the usual goal; under 10% is best.' },
    { key: 'length', label: 'Length of credit history', sub: clamp(age / LENGTH_FULL_MONTHS),
      detail: `Your file is ${age} month${age === 1 ? '' : 's'} old (full marks at ${LENGTH_FULL_MONTHS}).`,
      tip: 'This one only grows with time. Do not close your oldest account.' },
    { key: 'new', label: 'New credit', sub: NEW_CREDIT[Math.min(apps, NEW_CREDIT.length - 1)],
      detail: `${apps} application${apps === 1 ? '' : 's'} in the last ${INQUIRY_WINDOW} months.`,
      tip: 'Each application leaves a hard inquiry. Apply only when you need to; the mark fades after a year.' },
    { key: 'mix', label: 'Mix of credit', sub: MIX[products],
      detail: `${products} type${products === 1 ? '' : 's'} of credit (card, mortgage, line of credit).`,
      tip: 'A card plus an instalment loan such as a mortgage looks better than a card alone. Never borrow just for this.' },
  ].map((x) => ({ ...x, weight: WEIGHTS[x.key], maxPoints: Math.round(WEIGHTS[x.key] * (SCORE_MAX - SCORE_MIN)), points: Math.round(WEIGHTS[x.key] * x.sub * (SCORE_MAX - SCORE_MIN)) }));
  const total = f.reduce((s, x) => s + x.weight * x.sub, 0);
  return { score: SCORE_MIN + Math.round(total * (SCORE_MAX - SCORE_MIN)), factors: f };
}

// Statement maths. Statement balance is what is owed; minimum = max($10, 3%) rounded up to the cent, never more than the balance.
export const minimumPayment = (balanceCents) => (balanceCents <= 0 ? 0 : Math.min(balanceCents, Math.max(MIN_PAYMENT.floorCents, Math.ceil((balanceCents * MIN_PAYMENT.pct) / 100))));
// Interest on an unpaid statement balance: floor(balance x APR / 12), integer cents.
export const statementInterest = (balanceCents, aprBp) => Math.floor((balanceCents * aprBp) / 120000);

// Minimum payments only, no new spending: how many months and how much interest. Same order as the tick: pay the minimum on the
// statement, then interest on that whole statement balance is added, then the next statement. months = null if it never ends.
export function payoff({ balanceCents, aprBp, maxMonths = 1200 }) {
  let bal = balanceCents, months = 0, interest = 0, paid = 0;
  while (bal > 0 && months < maxMonths) {
    const min = minimumPayment(bal), i = statementInterest(bal, aprBp);
    bal = bal - min + i; interest += i; paid += min; months++;
  }
  return bal > 0 ? { months: null, totalInterestCents: interest, totalPaidCents: paid } : { months, totalInterestCents: interest, totalPaidCents: paid };
}

// The application decision. avgGrossCents is the average monthly gross of the last LIMIT.windowMonths months (months without pay count as 0).
export function decideCard({ avgGrossCents, score, inquiries12 }) {
  const reasons = [];
  if (avgGrossCents < LIMIT.minAvgGrossCents) reasons.push(`Income: your pay over the last ${LIMIT.windowMonths} months averages ${money(avgGrossCents)} a month before deductions; the card needs at least ${money(LIMIT.minAvgGrossCents)}. Get paid for a few months, then apply again.`);
  if (score !== null && score < SCORE_DECLINE_BELOW) reasons.push(`Score: ${score} is under the ${SCORE_DECLINE_BELOW} this card requires. Pay everything on time and let late marks fade.`);
  if (inquiries12 >= MAX_INQUIRIES) reasons.push(`Too many recent applications: ${inquiries12} in the last ${INQUIRY_WINDOW} months.`);
  if (reasons.length) return { approved: false, limitCents: 0, reasons };
  const raw = Math.floor((avgGrossCents * limitPct(score)) / LIMIT.stepCents) * LIMIT.stepCents;
  return { approved: true, limitCents: clamp(raw, LIMIT.minCents, LIMIT.maxCents), reasons: [] };
}
