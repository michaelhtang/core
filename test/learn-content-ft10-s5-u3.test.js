// Content check for the Learning Road unit "Debits and credits" (ft10-s5-u3). There is no outline for section 5: every figure and every
// "which account, which side" key is recomputed from the running company (modules/learn/companies/kirans-bike-repair.js).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { ACCOUNTS, OPENING, JUNE, JULY, COMPARE, account, balances, equation, ledgerAccount, money } from '../modules/learn/companies/kirans-bike-repair.js';

const course = JSON.parse(fs.readFileSync(new URL('../modules/learn/content/fintech10.json', import.meta.url), 'utf8'));
const unit = course.sections.flatMap((s) => s.units).find((u) => u.id === 'ft10-s5-u3');
const Q = new Map(unit.levels.flatMap((l) => l.questions).map((q) => [q.id, q]));
const right = (id) => { const q = Q.get(id); return q.options[q.answer].text; };
const june = (d) => JUNE.find((e) => e.date === d);
const debited = (e) => e.lines.filter((l) => l.debit).map((l) => l.account);
const credited = (e) => e.lines.filter((l) => l.credit).map((l) => l.account);
const total = (e, side) => e.lines.reduce((s, l) => s + l[side], 0);

test('shape: 3 levels, 4-6 cards, 7-10 questions, ids, outcome codes, no pictures yet, no go button', () => {
  assert.equal(unit.title, 'Debits and credits');
  assert.equal(unit.blurb, 'Two sides to every entry, the opening entry, and the ledger.');
  assert.deepEqual(unit.outcome_codes, ['FIN1015 2.3', 'FIN1015 2.6', 'FIN1015 2.7']);
  assert.equal(unit.levels.length, 3);
  unit.levels.forEach((l, i) => {
    assert.equal(l.id, `ft10-s5-u3-l${i + 1}`);
    assert.ok(l.cards.length >= 4 && l.cards.length <= 6, `${l.id}: ${l.cards.length} cards`);
    assert.ok(l.questions.length >= 7 && l.questions.length <= 10, `${l.id}: ${l.questions.length} questions`);
    assert.ok(l.questions.some((q) => q.figure), `${l.id}: a question with a figure`);
    l.questions.forEach((q, k) => assert.equal(q.id, `${l.id}-q${k + 1}`));
    assert.equal(l.go, undefined);
  });
  // pictures: the unit has a banner, and every card has a figure or a picture, never both (the boot check proves each file exists)
  assert.equal(unit.image?.src, 'ft10-s5-u3/banner.webp');
  for (const l of unit.levels) for (const c of l.cards) assert.ok(!!c.figure !== !!c.image, `${l.id}: a card has a figure or a picture, not both`);
  for (const l of unit.levels) for (const c of l.cards) if (c.image) assert.ok(fs.existsSync(new URL(`../public/art/learn/${c.image.src}`, import.meta.url)) && c.image.alt.length >= 5, c.image.src);
});

test('the sides: normal sides come from the chart, and "debit is not good" is said once', () => {
  const normal = (n) => account(n).normal;
  assert.equal(normal('Cash'), 'debit');
  assert.equal(normal('Repair Revenue'), 'credit');
  assert.match(right('ft10-s5-u3-l1-q2'), /^The debit side/);
  assert.match(right('ft10-s5-u3-l1-q3'), /^The credit side/);
  const q4 = Q.get('ft10-s5-u3-l1-q4');
  assert.deepEqual(q4.options.filter((o) => normal(o.text) === 'debit').map((o) => o.text), [right('ft10-s5-u3-l1-q4')]);
  // the kind table on card 2 agrees with the chart
  const kinds = { Asset: 'asset', Expense: 'expense', Liability: 'liability', Revenue: 'revenue' };
  for (const [kind, side, name] of unit.levels[0].cards[1].figure.rows) {
    assert.equal(side.toLowerCase(), normal(name), name);
    if (kinds[kind]) assert.equal(account(name).type, kinds[kind]);
  }
  assert.equal(JSON.stringify(unit).match(/not good/g).length, 1);
});

test('level 1: the June entries named in the questions', () => {
  const j3 = june('Jun 3'), j8 = june('Jun 8'), j10 = june('Jun 10'), j12 = june('Jun 12');
  assert.equal(right('ft10-s5-u3-l1-q5'), debited(j3)[0]);
  assert.equal(right('ft10-s5-u3-l1-q6'), credited(j8)[0]);
  assert.ok(debited(j10).includes('Accounts Payable') && account('Accounts Payable').type === 'liability');
  assert.equal(Q.get('ft10-s5-u3-l1-q8').answer, total(j10, 'credit'));
  assert.equal(Q.get('ft10-s5-u3-l1-q9').answer, j12.lines.find((l) => l.credit).credit);
  assert.match(Q.get('ft10-s5-u3-l1-q5').prompt, new RegExp(j3.what));
  assert.match(Q.get('ft10-s5-u3-l1-q6').prompt, new RegExp(j8.what));
});

test('level 2: the opening entry, its totals and the entry with a mistake', () => {
  const dr = total(OPENING, 'debit'), cr = total(OPENING, 'credit');
  assert.equal(dr, cr);
  assert.equal(Q.get('ft10-s5-u3-l2-q5').answer, dr);
  const cap = OPENING.lines.find((l) => l.account === 'Kiran, Capital').credit;
  assert.equal(Q.get('ft10-s5-u3-l2-q6').answer, cap);
  assert.equal(OPENING.lines.find((l) => l.credit && l.account === 'Bank Loan').credit, 200000);
  for (const a of ['Cash']) assert.ok(OPENING.lines.find((l) => l.account === a).debit > 0);
  const cn = OPENING.lines.filter((l) => l.credit).map((l) => l.account);
  assert.equal(right('ft10-s5-u3-l2-q7'), `${cn.slice(0, -1).join(', ')} and ${cn.at(-1)}`);
  assert.match(right('ft10-s5-u3-l2-q3'), /debit/);
  assert.match(right('ft10-s5-u3-l2-q4'), /^The credit side/);
  // the mistaken entry: Tools (an asset, debited in the real entry) moved to the credit column
  const f = Q.get('ft10-s5-u3-l2-q8').figure, tools = OPENING.lines.find((l) => l.account === 'Tools').debit;
  const row = f.rows.find((r) => r[1] === 'Tools');
  assert.deepEqual([row[2], row[3]], ['', money(tools)]);
  const wantDr = dr - tools, wantCr = cr + tools;
  assert.deepEqual(f.rows.at(-1), ['', 'Totals', money(wantDr), money(wantCr)]);
  assert.equal(Q.get('ft10-s5-u3-l2-q9').answer, wantCr - wantDr);
  assert.match(right('ft10-s5-u3-l2-q8'), /^Tools is an asset/);
  // every other line of the mistaken table is exactly the real entry
  for (const l of OPENING.lines.filter((x) => x.account !== 'Tools')) {
    const r = f.rows.find((x) => x[1] === l.account);
    assert.deepEqual([r[2], r[3]], [l.debit ? money(l.debit) : '', l.credit ? money(l.credit) : '']);
  }
});

test('level 3: ledger pages, balances, empty accounts', () => {
  const L = unit.levels[2];
  assert.ok(L.cards[1].text.includes(`${ACCOUNTS.length} accounts`) && L.cards[1].text.includes('101 Cash') && L.cards[1].text.includes('503 Utilities Expense'));
  const cap = ledgerAccount('Kiran, Capital');
  assert.equal(right('ft10-s5-u3-l3-q4'), `${money(cap.balance)} on the credit side`);
  assert.equal(account('Kiran, Capital').normal, 'credit');
  assert.equal(Q.get('ft10-s5-u3-l3-q5').answer, ledgerAccount('Tools').balance);
  const debitSide = ACCOUNTS.filter((a) => a.normal === 'debit').reduce((s, a) => s + ledgerAccount(a.name).balance, 0);
  const creditSide = ACCOUNTS.filter((a) => a.normal === 'credit').reduce((s, a) => s + ledgerAccount(a.name).balance, 0);
  assert.equal(debitSide, creditSide);
  assert.equal(Q.get('ft10-s5-u3-l3-q7').answer, debitSide);
  assert.equal(Q.get('ft10-s5-u3-l3-q8').answer, creditSide);
  assert.equal(right('ft10-s5-u3-l3-q3'), 'The credit side');
  assert.ok(OPENING.lines.find((l) => l.credit && l.account === 'Bank Loan'));
  assert.ok(OPENING.lines.find((l) => l.debit && l.account === 'Equipment'));
  assert.match(right('ft10-s5-u3-l3-q9'), /^Equipment was debited/);
  // accounts that start empty are exactly the ones the card lists
  const empty = ACCOUNTS.filter((a) => ledgerAccount(a.name).rows.length === 0).map((a) => a.name);
  assert.deepEqual(empty, ['Accounts Receivable', 'Kiran, Drawings', 'Repair Revenue', 'Rent Expense', 'Advertising Expense', 'Utilities Expense']);
  for (const n of empty) assert.ok(L.cards[4].text.includes(n), n);
  assert.ok(L.cards[4].text.includes(money(0)));
  // ledger figures equal the file's ledgerAccount
  for (const [ci, name] of [[2, 'Cash'], [3, 'Bank Loan']]) {
    const a = ledgerAccount(name), rows = L.cards[ci].figure.rows;
    assert.deepEqual(rows[0], [a.rows[0].date, a.rows[0].debit ? money(a.rows[0].debit) : '', a.rows[0].credit ? money(a.rows[0].credit) : '']);
    assert.deepEqual(rows.at(-1), ['Balance', a.account.normal === 'debit' ? money(a.balance) : '', a.account.normal === 'credit' ? money(a.balance) : '']);
  }
});

// Every dollar amount written anywhere in the unit must be a number the company file produces (a line, a balance at some point, a total, a gap).
test('every dollar figure in the unit comes from the company file', () => {
  const ok = new Set([0]);
  const all = [OPENING, ...JUNE, ...JULY];
  for (const e of all) for (const l of e.lines) { ok.add(l.debit); ok.add(l.credit); }
  for (let n = 0; n <= JUNE.length + JULY.length; n++) {
    const b = balances([...JUNE, ...JULY].slice(0, n));
    Object.values(b).forEach((v) => ok.add(v));
    const q = equation(b); [q.assets, q.liabilities, q.equity].forEach((v) => ok.add(v));
  }
  const dr = total(OPENING, 'debit'); ok.add(dr);
  const tools = OPENING.lines.find((l) => l.account === 'Tools').debit; ok.add(dr - tools); ok.add(dr + tools); ok.add(2 * tools);
  const liab = OPENING.lines.filter((l) => account(l.account).type === 'liability').reduce((s, l) => s + l.credit, 0); ok.add(liab);
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

test('scope: nothing out of scope and no named rule books', () => {
  const t = JSON.stringify(unit);
  assert.ok(!/trial balance|adjusting|closing entr|depreciation|GST|payroll|interest|GAAP|IFRS|ASPE|FASB/i.test(t));
});
