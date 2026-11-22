// Content check for the Learning Road unit "Posting and comparing" (ft10-s5-u4). No outline exists for section 5: every figure and every
// "which account, which side" key is recomputed from the running company (modules/learn/companies/kirans-bike-repair.js).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { ACCOUNTS, OPENING, JUNE, JULY, COMPARE, account, balances, equation, ledgerAccount, money } from '../modules/learn/companies/kirans-bike-repair.js';

const course = JSON.parse(fs.readFileSync(new URL('../modules/learn/content/fintech10.json', import.meta.url), 'utf8'));
const unit = course.sections.flatMap((s) => s.units).find((u) => u.id === 'ft10-s5-u4');
const Q = new Map(unit.levels.flatMap((l) => l.questions).map((q) => [q.id, q]));
const right = (id) => { const q = Q.get(id); return q.options[q.answer].text; };
const num = (id) => Q.get(id).answer;
const by = (d) => JUNE.find((e) => e.date === d), jy = (d) => JULY.find((e) => e.date === d);
const upTo = (d) => JUNE.slice(0, JUNE.findIndex((e) => e.date === d) + 1);
const debited = (e) => e.lines.filter((l) => l.debit).map((l) => l.account);
const credited = (e) => e.lines.filter((l) => l.credit).map((l) => l.account);
const total = (e, side) => e.lines.reduce((s, l) => s + l[side], 0);
const cell = (c) => (c ? money(c) : '');

test('shape: 3 levels, 4-6 cards, 7-10 questions, ids, outcome codes, no pictures yet, no go button', () => {
  assert.equal(unit.title, 'Posting and comparing');
  assert.equal(unit.blurb, 'Post a month of transactions, compare three kinds of business, and check your work.');
  assert.deepEqual(unit.outcome_codes, ['FIN1015 2.7', 'FIN1015 1.3']);
  assert.equal(unit.levels.length, 3);
  unit.levels.forEach((l, i) => {
    assert.equal(l.id, `ft10-s5-u4-l${i + 1}`);
    assert.ok(l.cards.length >= 4 && l.cards.length <= 6, `${l.id}: ${l.cards.length} cards`);
    assert.ok(l.questions.length >= 7 && l.questions.length <= 10, `${l.id}: ${l.questions.length} questions`);
    assert.ok(l.questions.some((q) => q.figure), `${l.id}: a question with a figure`);
    assert.ok(l.questions.filter((q) => q.type === 'number').length >= 2);
    l.questions.forEach((q, k) => assert.equal(q.id, `${l.id}-q${k + 1}`));
    assert.equal(l.go, undefined);
  });
  // pictures: the unit has a banner, and every card has a figure or a picture, never both (the boot check proves each file exists)
  assert.equal(unit.image?.src, 'ft10-s5-u4/banner.webp');
  for (const l of unit.levels) for (const c of l.cards) assert.ok(!!c.figure !== !!c.image, `${l.id}: a card has a figure or a picture, not both`);
  for (const l of unit.levels) for (const c of l.cards) if (c.image) assert.ok(fs.existsSync(new URL(`../public/art/learn/${c.image.src}`, import.meta.url)) && c.image.alt.length >= 5, c.image.src);
});

test('level 1: posting June, balances after the first few transactions, the equation after June', () => {
  const cash = ledgerAccount('Cash', JUNE), L = unit.levels[0];
  // the Cash page on card 2 is the file's ledger account
  const rows = L.cards[1].figure.rows;
  assert.equal(rows.length, cash.rows.length + 1);
  cash.rows.forEach((r, i) => assert.deepEqual(rows[i], [r.date, cell(r.debit), cell(r.credit)]));
  assert.deepEqual(rows.at(-1), ['Balance', money(cash.balance), '']);
  assert.ok(L.cards[2].text.includes(money(cash.debits)) && L.cards[2].text.includes(money(cash.credits)) && L.cards[2].text.includes(money(cash.balance)));
  const ar = ledgerAccount('Accounts Receivable', JUNE), ap = ledgerAccount('Accounts Payable', JUNE);
  assert.deepEqual(L.cards[3].figure.rows.at(-1), ['Balance', money(ar.balance), '']);
  assert.equal(ar.balance, 0);
  assert.deepEqual(L.cards[4].figure.rows.at(-1), ['Balance', '', money(ap.balance)]);
  assert.equal(num('ft10-s5-u4-l1-q8'), ap.balance);
  // balances after the first n transactions
  const b = (n) => balances(JUNE.slice(0, n));
  assert.equal(num('ft10-s5-u4-l1-q5'), b(1).Cash);
  assert.equal(num('ft10-s5-u4-l1-q6'), b(3).Cash);
  assert.equal(num('ft10-s5-u4-l1-q7'), b(2).Supplies);
  assert.equal(Q.get('ft10-s5-u4-l1-q5').prompt.includes(money(balances().Cash)), true);
  assert.equal(Q.get('ft10-s5-u4-l1-q6').prompt.includes(money(b(1).Cash)), true);
  assert.equal(balances(upTo('Jun 15'))['Accounts Receivable'], 0);
  assert.equal(right('ft10-s5-u4-l1-q9'), `${money(0)}, because the club paid in full`);
  const q = equation(balances(JUNE));
  assert.equal(num('ft10-s5-u4-l1-q10'), q.assets);
  assert.ok(q.balanced);
  assert.ok(L.cards[5].text.includes(`${money(q.assets)}`) && L.cards[5].text.includes(money(q.liabilities)) && L.cards[5].text.includes(money(q.equity)));
  // which account, which side
  assert.equal(right('ft10-s5-u4-l1-q2').startsWith('The credit side'), true);
  assert.ok(credited(by('Jun 15')).includes('Accounts Receivable'));
  assert.equal(right('ft10-s5-u4-l1-q3'), debited(by('Jun 12'))[0]);
  assert.equal(right('ft10-s5-u4-l1-q4'), credited(by('Jun 28'))[0]);
  for (const [id, d] of [['q2', 'Jun 15'], ['q3', 'Jun 12'], ['q4', 'Jun 28']]) assert.ok(Q.get(`ft10-s5-u4-l1-${id}`).prompt.includes(by(d).what), d);
  assert.equal(Q.get('ft10-s5-u4-l1-q3').prompt.includes(money(total(by('Jun 12'), 'debit'))), true);
});

test('level 2: the two comparison businesses, from COMPARE only', () => {
  const R = COMPARE.retail, C = COMPARE.corporation, rb = R.balance, cb = C.balance;
  const gross = R.income.sales - R.income.costOfGoodsSold, net = gross - R.income.expenses;
  const rAssets = rb.cash + rb.inventory + rb.equipment, cLiab = cb.accountsPayable + cb.bankLoan, cEq = cb.shareCapital + cb.retainedEarnings;
  const cAssets = cb.cash + cb.inventory + cb.equipment;
  assert.equal(num('ft10-s5-u4-l2-q4'), gross);
  assert.equal(num('ft10-s5-u4-l2-q5'), net);
  assert.equal(num('ft10-s5-u4-l2-q6'), rAssets);
  assert.equal(num('ft10-s5-u4-l2-q8'), cEq);
  assert.equal(num('ft10-s5-u4-l2-q9'), cLiab);
  assert.equal(cAssets, cLiab + cEq);
  assert.equal(rAssets, rb.accountsPayable + rb.capital);
  const L = unit.levels[1];
  assert.deepEqual(L.cards[2].figure.rows, [['Sales', money(R.income.sales)], ['Cost of goods sold', money(R.income.costOfGoodsSold)], ['Gross profit', money(gross)], ['Other expenses', money(R.income.expenses)], ['Net income', money(net)]]);
  assert.deepEqual(L.cards[3].figure.rows, [['Cash', money(rb.cash)], ['Inventory', money(rb.inventory)], ['Equipment', money(rb.equipment)], ['Total assets', money(rAssets)], ['Accounts Payable', money(rb.accountsPayable)], [R.equityLines[0], money(rb.capital)], ['Total liabilities and equity', money(rb.accountsPayable + rb.capital)]]);
  assert.deepEqual(L.cards[4].figure.rows, [['Cash', money(cb.cash)], ['Inventory', money(cb.inventory)], ['Equipment', money(cb.equipment)], ['Total assets', money(cAssets)], ['Accounts Payable', money(cb.accountsPayable)], ['Bank Loan', money(cb.bankLoan)], ['Total liabilities', money(cLiab)], [C.equityLines[0], money(cb.shareCapital)], [C.equityLines[1], money(cb.retainedEarnings)], ['Total liabilities and equity', money(cLiab + cEq)]]);
  assert.equal(right('ft10-s5-u4-l2-q7'), `${C.equityLines[0]} and ${C.equityLines[1]}`);
  assert.ok(Q.get('ft10-s5-u4-l2-q4').prompt.includes(R.name) && Q.get('ft10-s5-u4-l2-q8').prompt.includes(C.name));
  assert.ok(L.cards[0].text.startsWith(COMPARE.service.name) && /sells work/.test(L.cards[0].text) && COMPARE.service.sells.includes('work'));
  assert.ok(R.sells.includes('resell') && C.kind.includes('shareholders'));
  assert.deepEqual(L.cards[5].figure, undefined);
  assert.ok(L.cards[5].text.includes(`${money(rAssets)} = ${money(rb.accountsPayable)} + ${money(rb.capital)}`) && L.cards[5].text.includes(`${money(cAssets)} = ${money(cLiab)} + ${money(cEq)}`));
  assert.ok(!/\b(tax|taxed|law|incorporat|shares? price|dividend)/i.test(JSON.stringify(unit.levels[1])), 'nothing about law, tax or forming a corporation');
});

test('level 3: July transactions, the sides, balances, the equation', () => {
  const state = (n) => balances([...JUNE, ...JULY.slice(0, n)]);
  JULY.forEach((e, i) => {
    const id = `ft10-s5-u4-l3-q${i + 1}`;
    assert.equal(right(id), `Debit ${debited(e)[0]}, credit ${credited(e)[0]}`, id);
    assert.ok(Q.get(id).prompt.includes(e.what) && Q.get(id).prompt.startsWith(e.date), id);
    assert.equal(debited(e).length, 1); assert.equal(credited(e).length, 1);
  });
  assert.equal(num('ft10-s5-u4-l3-q6'), state(1).Cash);
  const q = equation(state(JULY.length));
  assert.equal(num('ft10-s5-u4-l3-q7'), q.assets);
  assert.ok(q.balanced);
  assert.ok(Q.get('ft10-s5-u4-l3-q7').prompt.includes(money(q.liabilities)) && Q.get('ft10-s5-u4-l3-q7').prompt.includes(money(q.equity)));
  assert.equal(account(right('ft10-s5-u4-l3-q8')).type, 'liability');
  assert.deepEqual(Q.get('ft10-s5-u4-l3-q8').options.filter((o) => account(o.text).type === 'liability').length, 1);
  // Jul 4 raises owner's equity by its amount
  assert.equal(equation(state(2)).equity - equation(state(1)).equity, jy('Jul 4').lines[0].debit);
  assert.match(right('ft10-s5-u4-l3-q9'), /^It raises it/);
  const open = OPENING.lines.filter((l) => account(l.account).type === 'liability').reduce((s, l) => s + l.credit, 0);
  assert.equal(num('ft10-s5-u4-l3-q10'), open);
  const cards = unit.levels[2].cards;
  assert.deepEqual(cards[3].figure.rows, JULY.map((e) => [e.date, e.what, money(total(e, 'debit'))]));
  assert.equal(cards[2].figure.rows.at(-1)[1], money(total(OPENING, 'credit')));
});

test('every dollar figure in the unit comes from the company file', () => {
  const ok = new Set([0]);
  for (const e of [OPENING, ...JUNE, ...JULY]) for (const l of e.lines) { ok.add(l.debit); ok.add(l.credit); }
  const all = [...JUNE, ...JULY];
  for (let n = 0; n <= all.length; n++) {
    const b = balances(all.slice(0, n)); Object.values(b).forEach((v) => ok.add(v));
    const q = equation(b); [q.assets, q.liabilities, q.equity].forEach((v) => ok.add(v));
  }
  for (const a of ACCOUNTS) { const l = ledgerAccount(a.name, JUNE); ok.add(l.debits); ok.add(l.credits); ok.add(l.balance); }
  const R = COMPARE.retail, C = COMPARE.corporation.balance;
  Object.values(R.income).forEach((v) => ok.add(v)); Object.values(R.balance).forEach((v) => ok.add(v)); Object.values(C).forEach((v) => ok.add(v));
  const gross = R.income.sales - R.income.costOfGoodsSold; ok.add(gross); ok.add(gross - R.income.expenses);
  ok.add(R.balance.cash + R.balance.inventory + R.balance.equipment);
  ok.add(C.cash + C.inventory + C.equipment); ok.add(C.accountsPayable + C.bankLoan); ok.add(C.shareCapital + C.retainedEarnings);
  ok.add(OPENING.lines.filter((l) => l.debit).reduce((s, l) => s + l.debit, 0));
  ok.add(OPENING.lines.filter((l) => account(l.account).type === 'liability').reduce((s, l) => s + l.credit, 0));
  const seen = [];
  const walk = (v) => { if (typeof v === 'string') seen.push(v); else if (Array.isArray(v)) v.forEach(walk); else if (v && typeof v === 'object') Object.values(v).forEach(walk); };
  const strip = (q) => { const { answer, tolerance, traps, ...rest } = q; return rest; };
  unit.levels.forEach((l) => { walk(l.cards); l.questions.forEach((q) => walk(strip(q))); });
  for (const s of seen) for (const m of s.matchAll(/\$(\d[\d,]*)/g)) {
    const cents = Number(m[1].replace(/,/g, '')) * 100;
    assert.ok(ok.has(cents), `${m[0]} in "${s.slice(0, 70)}" is not a figure from the company file`);
  }
  for (const q of Q.values()) for (const t of q.traps ?? []) assert.ok(Number.isSafeInteger(t.value) && t.value !== q.answer);
});

test('scope: nothing out of scope, no named rule books, no game button', () => {
  const t = JSON.stringify(unit);
  assert.ok(!/trial balance|adjusting|closing entr|depreciation|GST|payroll|interest|GAAP|IFRS|ASPE|FASB|Venture Row/i.test(t));
});
