// Content check for ft10-s5-u2 "Rules and accounts": every figure is recomputed from the running company
// (modules/learn/companies/kirans-bike-repair.js). Section 5 has no lesson outlines, so no outline figure is quoted (see REVIEW-ft10-s5-u2.md).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { ACCOUNTS, OPENING, JUNE, JULY, balances, equation, money, account } from '../modules/learn/companies/kirans-bike-repair.js';

const course = JSON.parse(fs.readFileSync(new URL('../modules/learn/content/fintech10.json', import.meta.url), 'utf8'));
const unit = course.sections.flatMap((s) => s.units).find((u) => u.id === 'ft10-s5-u2');
const Q = new Map(unit.levels.flatMap((l) => l.questions).map((q) => [q.id, q]));
const B0 = balances([]), Q0 = equation(B0), BJ = balances(JUNE), QJ = equation(BJ);
const allText = JSON.stringify(unit);
const dollarsIn = (s) => [...s.matchAll(/\$\d{1,3}(?:,\d{3})*(?:\.\d\d)?/g)].map((m) => m[0]);
const by = (d) => JUNE.find((e) => e.date === d);
const amt = (e) => e.lines[0].debit;
const kind = (e) => { const t = e.lines.map((l) => account(l.account).type); return t.includes('revenue') ? 'Revenue' : t.includes('expense') ? 'Expense' : 'Neither'; };
const n = (id) => { const q = Q.get(id); assert.equal(q.type, 'number', id); assert.equal(q.unit, '$'); assert.equal(q.tolerance, 0); return q; };
const right = (id) => { const q = Q.get(id); return q.options[q.answer].text; };

test('shape: 3 levels, 4-6 cards, 7-10 questions, ids, outcome codes, no pictures yet, no go button', () => {
  assert.ok(unit);
  assert.equal(unit.title, 'Rules and accounts');
  assert.equal(unit.blurb, 'Shared rules for the books, revenue and expenses, and the chart of accounts.');
  assert.deepEqual(unit.outcome_codes, ['FIN1015 1.2', 'FIN1015 2.4', 'FIN1015 2.5']);
  assert.equal(unit.levels.length, 3);
  unit.levels.forEach((l, i) => {
    assert.equal(l.id, `ft10-s5-u2-l${i + 1}`);
    assert.ok(l.cards.length >= 4 && l.cards.length <= 6 && l.cards.every((c) => c.text.length <= 320), `${l.id} cards`);
    assert.ok(l.questions.length >= 7 && l.questions.length <= 10, `${l.id} questions`);
    assert.ok(!l.go);
    l.questions.forEach((q, k) => { assert.equal(q.id, `${l.id}-q${k + 1}`); assert.ok(q.hint); });
    assert.ok(new Set(l.questions.filter((q) => q.type === 'choice').map((q) => q.answer)).size >= 2);
    for (const f of [...l.cards.map((c) => c.figure), ...l.questions.map((q) => q.figure)].filter(Boolean)) {
      assert.ok(f.columns.length <= 4 && f.rows.length <= 12); f.rows.forEach((r) => r.forEach((c) => assert.ok(c.length <= 60)));
    }
  });
  // pictures: the unit has a banner, and every card has a figure or a picture, never both (the boot check proves each file exists)
  assert.equal(unit.image?.src, 'ft10-s5-u2/banner.webp');
  for (const l of unit.levels) for (const c of l.cards) assert.ok(!!c.figure !== !!c.image, `${l.id}: a card has a figure or a picture, not both`);
  for (const l of unit.levels) for (const c of l.cards) if (c.image) assert.ok(fs.existsSync(new URL(`../public/art/learn/${c.image.src}`, import.meta.url)) && c.image.alt.length >= 5, c.image.src);
  assert.ok(!/debit|credit|!/i.test(allText.replace(/\\"/g, '')), 'nothing is called a debit or a credit yet, no exclamation marks');
  assert.ok(!/trial balance|depreciation|GST|payroll|interest|closing/i.test(allText), 'out of scope');
  assert.ok(!/FASB|IFRS|Canada|conservatism|matching|going concern|cost principle|revenue recognition|accrual/i.test(allText), 'level 1 names no principle, no rule-maker, no rule book');
});

test('every dollar figure is from the company file or a listed made-up amount', () => {
  const ok = new Set(); const add = (c) => ok.add(money(Math.abs(c)));
  for (const e of [OPENING, ...JUNE, ...JULY]) for (const l of e.lines) add(l.debit || l.credit);
  for (let k = 0; k <= JUNE.length; k++) { const b = balances(JUNE.slice(0, k)); Object.values(b).forEach(add); const q = equation(b); [q.assets, q.liabilities, q.equity, q.revenue, q.expenses, q.netIncome].forEach(add); }
  // made-up and derived, each written out where used (level 1): $50 grocery bill, $300 personal bill, $2,500 hoped-for tool value, $200 bike stand,
  // derived: June net income with the wrong $50 ($20), with the wrong $300 (-$230 -> $230), $370 and $980 (wrong options), $8,100 total assets, $700 more. Level 2: a made-up month: $500, $560, $60, $1,060.
  const wrongExp = QJ.expenses + 5000, big = QJ.expenses + 30000;
  const madeUp = new Set(['$50', '$300', '$2,500', '$200', '$500', '$560', '$60', '$1,060', money(QJ.revenue - wrongExp), money(Math.abs(QJ.revenue - big)), money(QJ.revenue - QJ.expenses + 30000), money(big), money(QJ.expenses + 5000), money(Q0.assets - B0.Tools + 250000), money(250000 - B0.Tools)]);
  const bad = dollarsIn(allText).filter((d) => !ok.has(d) && !madeUp.has(d));
  assert.deepEqual([...new Set(bad)], []);
  assert.equal(money(500 * 100 - 560 * 100 + 6000), '$0');
});

test('level 1: the June figures and the effect of each broken rule', () => {
  const rev = QJ.revenue, exp = QJ.expenses;
  assert.equal(rev, 75000); assert.equal(exp, 68000); assert.equal(QJ.netIncome, 7000);
  assert.equal(n('ft10-s5-u2-l1-q3').answer, rev - (exp + 5000)); assert.equal(rev - (exp + 5000), 2000);
  assert.equal(n('ft10-s5-u2-l1-q3').traps[0].value, QJ.netIncome); assert.equal(n('ft10-s5-u2-l1-q3').traps[1].value, QJ.netIncome + 5000);
  // a $300 personal bill counted as an expense: a net loss of $230
  assert.equal(rev - (exp + 30000), -23000);
  assert.equal(right('ft10-s5-u2-l1-q4'), 'A net loss of $230');
  assert.ok(Q.get('ft10-s5-u2-l1-q4').options.some((o) => o.text === `Net income of ${money(rev - exp + 30000)}`));
  // a tool written at $2,500 instead of $1,800: assets $8,100
  assert.equal(n('ft10-s5-u2-l1-q6').answer, Q0.assets - B0.Tools + 250000); assert.equal(Q0.assets - B0.Tools + 250000, 810000);
  assert.equal(n('ft10-s5-u2-l1-q6').traps[0].value, Q0.assets);
  assert.ok(unit.levels[0].cards[2].figure.rows.every((r, i) => r[1] === money([rev, exp, QJ.netIncome][i])));
  assert.equal(right('ft10-s5-u2-l1-q7'), 'Their net incomes differ by $200 for the same work');
  assert.ok(unit.levels[0].cards[4].text.includes(money(B0.Tools)));
});

test('level 2: revenue, expenses, net income, drawings, the sort of the ten transactions', () => {
  assert.equal(n('ft10-s5-u2-l2-q2').answer, amt(by('Jun 5')) + amt(by('Jun 8'))); assert.equal(n('ft10-s5-u2-l2-q2').answer, QJ.revenue);
  assert.equal(n('ft10-s5-u2-l2-q2').traps[0].value, amt(by('Jun 5')));
  assert.equal(n('ft10-s5-u2-l2-q3').answer, amt(by('Jun 2')) + amt(by('Jun 12'))); assert.equal(n('ft10-s5-u2-l2-q3').answer, QJ.expenses);
  assert.equal(n('ft10-s5-u2-l2-q3').traps[0].value, QJ.expenses + QJ.drawings);
  assert.equal(n('ft10-s5-u2-l2-q4').answer, QJ.revenue - QJ.expenses);
  assert.equal(n('ft10-s5-u2-l2-q4').traps[0].value, QJ.revenue + QJ.expenses);
  assert.equal(n('ft10-s5-u2-l2-q9').answer, Q0.equity + QJ.netIncome - QJ.drawings); assert.equal(n('ft10-s5-u2-l2-q9').answer, QJ.equity);
  assert.equal(QJ.equity, 482000);
  assert.deepEqual(n('ft10-s5-u2-l2-q9').traps.map((t) => t.value), [Q0.equity + QJ.netIncome, Q0.equity + QJ.netIncome + QJ.drawings]);
  // the sort: two revenue, two expense, six neither
  assert.deepEqual(JUNE.map(kind), ['Expense', 'Neither', 'Revenue', 'Revenue', 'Neither', 'Expense', 'Neither', 'Neither', 'Neither', 'Neither']);
  assert.equal(kind(by('Jun 15')), 'Neither'); assert.equal(kind(by('Jun 20')), 'Neither'); assert.equal(kind(by('Jun 28')), 'Neither');
  assert.equal(by('Jun 20').lines[0].account, 'Kiran, Drawings'); assert.equal(by('Jun 25').lines[0].account, 'Bank Loan'); assert.equal(amt(by('Jun 25')), 10000);
  assert.equal(by('Jun 28').lines[0].account, 'Tools'); assert.equal(by('Jun 15').lines[1].account, 'Accounts Receivable');
  const ten = Q.get('ft10-s5-u2-l2-q5').figure;
  assert.equal(ten.rows.length, 10); ten.rows.forEach((r, i) => assert.deepEqual(r, [JUNE[i].date, JUNE[i].what, money(amt(JUNE[i]))]));
  // the income statement card
  const st = unit.levels[1].cards[2].figure;
  assert.equal(st.title, "Kiran's Bike Repair, Income Statement, For the Month Ended June 30");
  assert.deepEqual(st.rows.map((r) => r[1]), [money(QJ.revenue), money(BJ['Rent Expense']), money(BJ['Advertising Expense']), money(QJ.expenses), money(QJ.netIncome)]);
  assert.equal(BJ['Utilities Expense'], 0, 'no utilities expense in June');
  assert.equal(right('ft10-s5-u2-l2-q10'), 'A net loss of $60'); assert.equal(500 - 560, -60);
  assert.equal(Q.get('ft10-s5-u2-l2-q10').options.find((o) => /1,060/.test(o.text)) !== undefined, true); assert.equal(500 + 560, 1060);
});

test('level 3: the chart (hundreds, kinds), the opening balances, and the sums', () => {
  const hundred = { asset: 1, liability: 2, equity: 3, revenue: 4, expense: 5 };
  for (const a of ACCOUNTS) assert.equal(Math.floor(a.no / 100), hundred[a.type], a.name);
  assert.ok(unit.levels[2].cards[0].text.includes(`uses ${ACCOUNTS.length}.`));
  const cardRows = [...unit.levels[2].cards[2].figure.rows, ...unit.levels[2].cards[3].figure.rows];
  assert.deepEqual(cardRows.map((r) => [Number(r[0]), r[1]]), ACCOUNTS.map((a) => [a.no, a.name]), 'the two tables are the chart in order');
  const hundreds = (h) => ACCOUNTS.filter((a) => Math.floor(a.no / 100) === h).reduce((s, a) => s + B0[a.name], 0);
  assert.equal(n('ft10-s5-u2-l3-q9').answer, hundreds(1)); assert.equal(hundreds(1), Q0.assets);
  assert.equal(n('ft10-s5-u2-l3-q9').traps[0].value, hundreds(1) + hundreds(2));
  assert.equal(n('ft10-s5-u2-l3-q10').answer, hundreds(1) - hundreds(2)); assert.equal(n('ft10-s5-u2-l3-q10').answer, B0['Kiran, Capital']);
  const fig = Q.get('ft10-s5-u2-l3-q9').figure;
  assert.deepEqual(fig.rows, ACCOUNTS.filter((a) => B0[a.name] > 0).map((a) => [String(a.no), a.name, money(B0[a.name])]));
  assert.equal(account('Advertising Expense').no, 502); assert.equal(account('Kiran, Drawings').type, 'equity'); assert.equal(account('Bank Loan').type, 'liability');
  assert.equal(right('ft10-s5-u2-l3-q4'), 'Advertising Expense'); assert.equal(Math.floor(account('Advertising Expense').no / 100), 5);
  assert.equal(right('ft10-s5-u2-l3-q3'), '4'); assert.equal(String(account('Repair Revenue').no)[0], '4');
  // no invented account number: the text names no number that is not in the chart, apart from the ones the questions quote
  const nums = new Set(ACCOUNTS.map((a) => String(a.no)));
  for (const m of allText.matchAll(/(?<![$\d,])\b([1-5]\d\d)\b(?![,\d])/g)) assert.ok(nums.has(m[1]) || ['100', '200', '300', '400', '500'].includes(m[1]), `number ${m[1]}`);
});
