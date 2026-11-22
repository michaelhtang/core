// Content check for ft10-s5-u1 "The books and the equation": every figure is recomputed from the running company
// (modules/learn/companies/kirans-bike-repair.js). Section 5 has no lesson outlines, so no outline figure is quoted (see REVIEW-ft10-s5-u1.md).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { COMPANY, GLOSSARY, ACCOUNTS, OPENING, JUNE, JULY, balances, equation, money } from '../modules/learn/companies/kirans-bike-repair.js';

const course = JSON.parse(fs.readFileSync(new URL('../modules/learn/content/fintech10.json', import.meta.url), 'utf8'));
const unit = course.sections.flatMap((s) => s.units).find((u) => u.id === 'ft10-s5-u1');
const Q = new Map(unit.levels.flatMap((l) => l.questions).map((q) => [q.id, q]));
const E = (n) => equation(balances(JUNE.slice(0, n)));
const B0 = balances([]), Q0 = equation(B0);
const sum = (names) => names.reduce((s, n) => s + B0[n], 0);
const assets = ['Cash', 'Supplies', 'Tools', 'Equipment'], liabs = ['Accounts Payable', 'Bank Loan'];
const allText = JSON.stringify(unit);
const dollarsIn = (s) => [...s.matchAll(/\$\d{1,3}(?:,\d{3})*(?:\.\d\d)?/g)].map((m) => m[0]);

test('shape: 3 levels, 4-6 cards, 7-10 questions, ids, outcome codes, no pictures yet', () => {
  assert.ok(unit);
  assert.equal(unit.title, 'The books and the equation');
  assert.equal(unit.blurb, 'Why a business keeps books, what it owns and owes, and its first balance sheet.');
  assert.deepEqual(unit.outcome_codes, ['FIN1015 1.1', 'FIN1015 1.4', 'FIN1015 2.1', 'FIN1015 2.2']);
  assert.equal(unit.levels.length, 3);
  unit.levels.forEach((l, i) => {
    assert.equal(l.id, `ft10-s5-u1-l${i + 1}`);
    assert.ok(l.cards.length >= 4 && l.cards.length <= 6, `${l.id} cards`);
    assert.ok(l.questions.length >= 7 && l.questions.length <= 10, `${l.id} questions`);
    l.questions.forEach((q, k) => assert.equal(q.id, `${l.id}-q${k + 1}`));
  });
  assert.deepEqual(unit.levels[2].go, { building: 'networth', label: 'Open Net Worth' });
  assert.ok(!unit.levels[0].go && !unit.levels[1].go);
  // pictures: the unit has a banner, and every card has a figure or a picture, never both (the boot check proves each file exists)
  assert.equal(unit.image?.src, 'ft10-s5-u1/banner.webp');
  for (const l of unit.levels) for (const c of l.cards) assert.ok(!!c.figure !== !!c.image, `${l.id}: a card has a figure or a picture, not both`);
  for (const l of unit.levels) for (const c of l.cards) if (c.image) assert.ok(fs.existsSync(new URL(`../public/art/learn/${c.image.src}`, import.meta.url)) && c.image.alt.length >= 5, c.image.src);
  assert.ok(!/debit|credit|!/i.test(allText.replace(/\\"/g, '')), 'nothing is called a debit or a credit yet, and no exclamation marks');
  assert.ok(!/trial balance|depreciation|GST|payroll|interest|closing/i.test(allText), 'out of scope words');
});

test('every dollar figure is from the company file or a listed made-up amount', () => {
  const ok = new Set();
  const add = (c) => { ok.add(money(Math.abs(c))); };
  for (const e of [OPENING, ...JUNE, ...JULY]) for (const l of e.lines) add(l.debit || l.credit);
  for (let n = 0; n <= JUNE.length; n++) { Object.values(balances(JUNE.slice(0, n))).forEach(add); const q = equation(balances(JUNE.slice(0, n))); [q.assets, q.liabilities, q.equity, q.revenue, q.expenses, q.netIncome].forEach(add); }
  // made-up arithmetic, written out where it is used: l2-q5 (a made-up shop: 9,000 - 5,500 = 3,500, and the trap 9,000 + 5,500), l3 "A day later" ($3,000 cash, $600 rent, $2,400 and $3,600 as wrong options),
  // l2 supplies/rent/repairs questions quote $150, $600 and $450 from the file
  const madeUp = new Set(['$9,000', '$5,500', '$3,500', '$14,500', '$3,600', '$2,400', '$7,000']);
  const bad = dollarsIn(allText).filter((d) => !ok.has(d) && !madeUp.has(d));
  assert.deepEqual([...new Set(bad)], [], 'dollar amounts not in the company file');
  assert.equal(money(3500 * 100), '$3,500');
  assert.equal(900000 - 550000, 350000); assert.equal(900000 + 550000, 1450000);
  assert.equal(B0.Cash - 60000, 240000); assert.equal(B0.Cash + 60000, 360000);
  assert.equal(Q0.assets - 40000, 700000);   // the wrong "Total assets" on the sheet to check
});

test('the opening numbers and the equation', () => {
  assert.equal(Q0.assets, sum(assets)); assert.equal(Q0.liabilities, sum(liabs)); assert.equal(Q0.equity, B0['Kiran, Capital']);
  assert.ok(Q0.balanced);
  assert.equal(Q0.assets, 740000); assert.equal(Q0.liabilities, 240000); assert.equal(Q0.equity, 500000);
  assert.equal(assets.reduce((m, n) => (B0[n] > B0[m] ? n : m)), 'Cash', 'the biggest asset on the card is Cash');
  assert.equal(COMPANY.what, 'Kiran repairs and tunes bikes in a small rented shop in town.');
  assert.ok(unit.levels[0].cards[4].text.includes(COMPANY.what));
  for (const t of ['asset', 'liability', "owner's equity", 'accounting equation', 'on account', 'accounts payable', 'balance sheet', 'income statement']) assert.ok(GLOSSARY[t], t);
});

test('number answers are recomputed from the file', () => {
  const n = (id) => { const q = Q.get(id); assert.equal(q.type, 'number', id); assert.equal(q.unit, '$'); return q.answer; };
  assert.equal(n('ft10-s5-u1-l2-q3'), sum(assets));
  assert.equal(n('ft10-s5-u1-l2-q4'), E(2).assets - E(2).liabilities);
  assert.equal(E(2).equity, E(2).assets - E(2).liabilities);
  assert.equal(n('ft10-s5-u1-l2-q5'), 900000 - 550000);
  assert.equal(n('ft10-s5-u1-l2-q6'), E(3).liabilities + E(3).equity);
  assert.equal(E(3).assets, E(3).liabilities + E(3).equity);
  assert.equal(n('ft10-s5-u1-l3-q3'), sum(liabs));
  assert.equal(n('ft10-s5-u1-l3-q4'), Q0.assets - Q0.liabilities);
  assert.equal(n('ft10-s5-u1-l3-q7'), sum(assets));
  // traps are the results of the mistakes their why lines name
  assert.equal(Q.get('ft10-s5-u1-l2-q3').traps[0].value, Q0.assets + Q0.liabilities);
  assert.equal(Q.get('ft10-s5-u1-l2-q4').traps[0].value, E(2).assets + E(2).liabilities);
  assert.equal(Q.get('ft10-s5-u1-l2-q6').traps[0].value, E(3).equity - E(3).liabilities);
  assert.equal(Q.get('ft10-s5-u1-l3-q3').traps[0].value, B0['Bank Loan']);
  assert.equal(Q.get('ft10-s5-u1-l3-q4').traps[0].value, Q0.assets + Q0.liabilities);
  assert.equal(Q.get('ft10-s5-u1-l3-q7').traps[0].value, Q0.assets - 40000);
  for (const q of Q.values()) if (q.type === 'number') assert.equal(q.tolerance, 0);
});

test('the June running table (level 2 card 5) is the file\'s totals after the first four transactions', () => {
  const t = unit.levels[1].cards[4].figure;
  assert.deepEqual(t.columns, ['After', 'Assets', 'Liabilities', 'Equity']);
  const want = [[Q0.assets, Q0.liabilities, Q0.equity], ...[1, 2, 3, 4].map((k) => [E(k).assets, E(k).liabilities, E(k).equity])];
  t.rows.forEach((r, i) => assert.deepEqual(r.slice(1), want[i].map((c) => money(c)), `row ${i}`));
  assert.equal(t.rows.length, 5);
  assert.deepEqual(want[1], [680000, 240000, 440000]); assert.deepEqual(want[4], [770000, 255000, 515000]);
  // what each transaction did, as the choices say
  assert.equal(JUNE[1].lines[1].account, 'Accounts Payable');   // l2-q7: Jun 3 supplies on account
});

test('the transactions the choice questions describe are the file\'s own', () => {
  const by = (d) => JUNE.find((e) => e.date === d);
  assert.equal(by('Jun 2').what, 'Paid the month’s rent in cash'); assert.equal(by('Jun 2').lines[0].debit, 60000);
  assert.equal(by('Jun 3').what, 'Bought supplies on account'); assert.equal(by('Jun 3').lines[0].debit, 15000);
  assert.equal(by('Jun 5').what, 'Repaired bikes for cash'); assert.equal(by('Jun 5').lines[0].debit, 45000);
  assert.equal(by('Jun 8').lines[0].account, 'Accounts Receivable');
  assert.equal(E(1).equity - Q0.equity, -60000);                       // rent: equity down
  assert.equal(E(2).liabilities - E(1).liabilities, 15000);             // supplies on account: liabilities up
  assert.equal(E(3).equity - E(2).equity, 45000);                       // repairs for cash: equity up
});

test('balance sheet figures (level 3) are the opening entry', () => {
  const fig = (c) => unit.levels[2].cards[c].figure;
  const rows = fig(3).rows;
  assert.deepEqual(rows.map((r) => r[0]), ['Cash', 'Supplies', 'Tools', 'Equipment', 'Total assets', 'Accounts Payable', 'Bank Loan', 'Total liabilities', 'Kiran, Capital', 'Total liabilities and equity']);
  assert.deepEqual(rows.map((r) => r[1]), [B0.Cash, B0.Supplies, B0.Tools, B0.Equipment, Q0.assets, B0['Accounts Payable'], B0['Bank Loan'], Q0.liabilities, B0['Kiran, Capital'], Q0.liabilities + Q0.equity].map((c) => money(c)));
  assert.equal(fig(3).title, "Kiran's Bike Repair, Balance Sheet, As at June 1");
  assert.equal(Q0.assets, Q0.liabilities + Q0.equity);
  assert.equal(fig(1).rows.length, 5); assert.equal(fig(2).rows.length, 8);
  // the sheet with a loan among the assets: every amount right, one item in the wrong block
  const wb = Q.get('ft10-s5-u1-l3-q6').figure;
  assert.deepEqual(wb.rows.filter((r) => r[0] === 'Assets').map((r) => r[1]), ['Cash', 'Supplies', 'Tools', 'Equipment', 'Bank Loan']);
  assert.ok(wb.rows.every((r) => r[2] === money(B0[r[1]])));
  const answer = Q.get('ft10-s5-u1-l3-q6'); assert.equal(answer.options[answer.answer].text, 'Bank Loan');
  // the sheet with one wrong total: the items are right, Total assets is not
  const wt = Q.get('ft10-s5-u1-l3-q7').figure;
  assert.equal(wt.rows.find((r) => r[0] === 'Total assets')[1], money(Q0.assets - 40000));
  assert.notEqual(Q0.assets - 40000, sum(assets));
  const big = Q.get('ft10-s5-u1-l3-q5'); assert.equal(big.options[big.answer].text, 'Cash');
});

test('the items table (level 2 card 2) and readers table (level 1 card 3)', () => {
  const items = unit.levels[1].cards[1].figure.rows;
  assert.deepEqual(items.map((r) => [r[0], r[1]]), [['Cash', 'Asset'], ['Supplies', 'Asset'], ['Tools', 'Asset'], ['Equipment', 'Asset'], ['Accounts Payable', 'Liability'], ['Bank Loan', 'Liability']]);
  items.forEach((r) => assert.equal(r[2], money(B0[r[0]])));
  const readers = unit.levels[0].cards[2].figure;
  assert.equal(readers.rows.length, 5); assert.equal(readers.columns.length, 2);
});

test('every table fits a phone: at most 4 columns, 12 rows, short cells; every question has hint and terms are 3 or fewer', () => {
  for (const l of unit.levels) {
    const figs = [...l.cards.map((c) => c.figure), ...l.questions.map((q) => q.figure)].filter(Boolean);
    for (const f of figs) { assert.equal(f.kind, 'table'); assert.ok(f.columns.length <= 4 && f.rows.length <= 12); f.rows.forEach((r) => r.forEach((c) => assert.ok(c.length <= 60))); }
    l.questions.forEach((q) => { assert.ok(q.hint); assert.ok(!q.terms || q.terms.length <= 3); });
    assert.ok(l.cards.every((c) => c.text.length <= 320));
  }
  const choiceAnswers = (l) => l.questions.filter((q) => q.type === 'choice').map((q) => q.answer);
  unit.levels.forEach((l) => assert.ok(new Set(choiceAnswers(l)).size >= 2));
});
