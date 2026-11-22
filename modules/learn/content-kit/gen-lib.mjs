// Helpers for generating modules/learn/content/fintech10.json. Every number answer is computed from payroll.js, never typed.
import { MISS } from './miss.mjs';
const WT = '/Users/michaeltang/claude-workspace/vdaa/.worktrees/p13-learn';
export const { payStub, cppFor, eiFor, employerShare } = await import(`${WT}/modules/jobs/payroll.js`);

export const m = (c) => `$${(c / 100).toLocaleString('en-CA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
export const m0 = (c) => `$${(c / 100).toLocaleString('en-CA', { maximumFractionDigits: 0 })}`;
const hash = (s) => [...s].reduce((a, ch) => (a * 31 + ch.charCodeAt(0)) >>> 0, 7);
export const stub = (g) => payStub({ grossCents: g, period: 1 });
export const tax = (s) => s.federalTax + s.albertaTax;
export const dollars = (c) => c / 100;

export const choice = (id, label, prompt, right, wrongs, hint, extra = {}) => {
  return { id, label, prompt, type: 'choice', ...extra, hint, _right: right, _wrongs: wrongs };
};
export const num = (id, label, prompt, { unit, answer, tol, why, working, hint, traps, check, figure, terms }) =>
  ({ id, label, prompt, type: 'number', ...(figure ? { figure } : {}), ...(terms ? { terms } : {}), hint, unit, answer, tolerance: tol, why, working, ...(traps ? { traps } : {}), ...(check ? { check } : {}) });
export const pt = (id, label, prompt, figure, answer, why, hint, terms) => ({ id, label, prompt, type: 'point', figure, ...(terms ? { terms } : {}), hint, answer, why });
export const T = (term, meaning) => ({ term, meaning });
export const tbl = (title, columns, rows) => ({ kind: 'table', title, columns, rows });
export const bars = (title, unit, items) => ({ kind: 'bars', title, unit, bars: items.map(([label, value]) => ({ label, value })) });
export const line = (title, unit, items) => ({ kind: 'line', title, unit, points: items.map(([label, value]) => ({ label, value })) });
export const stubFig = (title, g, { ytd = false, wrongNet = false } = {}) => {
  const s = stub(g);
  const L = (label, cents, role, y) => ({ label, cents, role, ...(ytd ? { ytd: y } : {}) });
  return { kind: 'paystub', title, lines: [
    L('Regular earnings', s.gross, 'earn', s.ytd.gross), L('Canada Pension Plan (CPP)', s.cpp, 'deduct', s.ytd.cpp), L('Employment Insurance (EI)', s.ei, 'deduct', s.ytd.ei),
    L('Federal income tax', s.federalTax, 'deduct', s.ytd.federalTax), L('Alberta income tax', s.albertaTax, 'deduct', s.ytd.albertaTax),
    L('Net pay', wrongNet ? s.gross : s.net, 'net', wrongNet ? s.ytd.gross : s.ytd.net)] };
};
export const GROSS = T('gross pay', 'Your pay before anything is taken off.');
export const NET = T('net pay', 'What is left after every deduction. It lands in your chequing.');
export const DED = T('deduction', 'An amount taken off your gross pay, such as CPP, EI or tax.');
export const CPP = T('CPP', 'Canada Pension Plan. You and your employer pay in, and it becomes a pension later.');
export const EI = T('EI', 'Employment Insurance. It pays you for a while if you lose a job through no fault of your own.');
export const WAGE = T('wage', 'A set rate of pay for each hour you work.');
export const SAL = T('salary', 'A set amount for the year, paid in equal parts.');
export const BPA = T('basic personal amount', 'The part of your yearly income that is free of income tax.');
export const BRK = T('bracket', 'A slice of income taxed at one rate.');
export const STUBT = T('pay stub', 'The slip that shows your gross pay, deductions and net pay.');
export const YTD = T('year to date', 'The running total since January 1.');
export const OT = T('overtime', 'Extra pay (or time off) for working more than the legal limit.');
export const VAC = T('vacation pay', 'A share of your earnings that is set aside for time off.');
export const MINW = T('minimum wage', 'The lowest hourly pay an employer is allowed to pay.');
export const EXEMPT = T('exemption', 'A first part of pay that this deduction does not charge.');
export const PREM = T('premium', 'The amount you pay into an insurance plan, here from each pay.');

// the right option is placed by a spread that varies with the question (positions 0..n-1 all occur), never by hand
let spin = 0;
const place = (x, i, n) => {
  if (x.type !== 'choice') {
    const miss = MISS[`${n}:${x.label}`];
    if (!miss) throw new Error(`no miss line for ${n}:${x.label}`);
    return { ...x, miss };
  }
  const { _right, _wrongs, ...rest } = x;
  const options = _wrongs.map(([text, why]) => ({ text, why }));
  const at = (spin++ * 3 + 1) % (options.length + 1);
  options.splice(at, 0, { text: _right[0], why: _right[1] });
  return { ...rest, options, answer: at };
};
export const U = 'ft10-s1-u2';
export const levels = [];
export const level = (n, title, learn, cards, questions, extra = {}) => {
  const id = `${U}-l${n}`;
  levels.push({ id, title, kind: 'lesson', learn, cards: cards.map((c) => (typeof c === 'string' ? { text: c } : c)), questions: questions.map((x, i) => place({ ...x, id: `${id}-q${i + 1}` }, i, n)), ...extra });
};
