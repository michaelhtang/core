// Content check for the Learning Road unit "Mortgages" (ft10-s3-u6): every number answer is recomputed from the game's own
// modules/housing/mortgage.js, every figure quoted from Mr. Tang's Lesson 26 outline is pinned to a cited table, and the shape is checked.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { payment, schedule, insurance, minDown } from '../modules/housing/mortgage.js';
import { CONDO_PRICE_CENTS, STARTER_PRICE_CENTS } from '../modules/housing/constants.js';
import { POLICY_BP, SPREADS } from '../modules/rates/constants.js';

const course = JSON.parse(fs.readFileSync(new URL('../modules/learn/content/fintech10.json', import.meta.url), 'utf8'));
const unit = course.sections.flatMap((s) => s.units).find((u) => u.id === 'ft10-s3-u6');
const Q = new Map(unit.levels.flatMap((l) => l.questions).map((q) => [q.id, q]));
const money = (c) => `$${(c / 100).toLocaleString('en-CA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const money0 = (c) => `$${Math.round(c / 100).toLocaleString('en-CA')}`;
const text = (l) => unit.levels[l - 1].cards.map((c) => c.text).join(' ');
const ans = (id) => Q.get(id).answer;

// Figures in Mr. Tang's Lesson 26 outline (slide-studio/courses/fintech10/context/outlines/2026-10-20 Lesson 26.md). The outline rounds ("about").
const OUTLINE = {
  price: { value: 400000, cite: 'line 89: a $400,000 home' }, down: { value: 80000, cite: 'line 89: $80,000 up front' }, loan: { value: 320000, cite: 'line 89: the bank lends $320,000' },
  a: { pay: 1861, interest: 238000, total: 558000, cite: 'line 157: A about $1,861/month, about $238,000 interest, about $558,000 paid' },
  b: { pay: 1708, interest: 295000, cite: 'line 158: B about $1,708/month, about $295,000 interest' },
  c: { pay: 2047, interest: 294000, cite: 'line 159: C about $2,047/month, about $294,000 interest' },
  year5: { paid: 111700, owed: 283000, newPay: 2017, cite: 'lines 172-173: about $111,700 paid, about $283,000 owed; 6% over 20 years about $2,017/month' },
  split: { saves: 153, extra: 56000, cite: 'line 163: thirty years saves about $153 a month and costs about $56,000 more' },
};

const LOAN = 32000000;
const payA = payment(LOAN, 500, 300), payB = payment(LOAN, 500, 360), payC = payment(LOAN, 600, 300);
const totA = payA * 300, totB = payB * 360, totC = payC * 300;
const intA = totA - LOAN, intB = totB - LOAN, intC = totC - LOAN;
const sA = schedule(LOAN, 500, 300);
const near = (cents, dollars, tol) => assert.ok(Math.abs(cents / 100 - dollars) <= tol, `${cents / 100} is not within ${tol} of ${dollars}`);

test('shape: 6 levels, 4-6 cards, 7-10 questions, ids, outcome codes, a go button', () => {
  assert.ok(unit, 'unit ft10-s3-u6 is in fintech10.json');
  assert.equal(unit.title, 'Mortgages');
  assert.equal(unit.blurb, 'The biggest loan most people take: the words, the payment, and what you pay back.');
  assert.deepEqual(unit.outcome_codes, ['FIN1010 3.2', 'FIN1010 2.3', 'FIN1010 3.3']);
  assert.equal(unit.levels.length, 6);
  unit.levels.forEach((l, i) => {
    assert.equal(l.id, `ft10-s3-u6-l${i + 1}`);
    assert.ok(l.cards.length >= 4 && l.cards.length <= 6, `${l.id}: ${l.cards.length} cards`);
    assert.ok(l.questions.length >= 7 && l.questions.length <= 10, `${l.id}: ${l.questions.length} questions`);
    assert.ok(l.questions.filter((q) => q.type === 'number').length >= 2, `${l.id}: at least 2 number questions`);
    assert.ok(l.questions.some((q) => q.figure), `${l.id}: at least 1 question with a figure`);
    l.questions.forEach((q, j) => assert.equal(q.id, `${l.id}-q${j + 1}`));
    assert.ok(!JSON.stringify(l).includes('"image"'), `${l.id}: no image fields`);
  });
  assert.deepEqual(unit.levels[5].go, { building: 'housing', label: 'Open Housing' });
});

test('the game\'s figures agree with the outline (it rounds)', () => {
  near(LOAN, OUTLINE.loan.value, 0);
  near(payA, OUTLINE.a.pay, 0.5); near(intA, OUTLINE.a.interest, 400); near(totA, OUTLINE.a.total, 400);
  near(payB, OUTLINE.b.pay, 0.5); near(intB, OUTLINE.b.interest, 400);
  near(payC, OUTLINE.c.pay, 0.5); near(intC, OUTLINE.c.interest, 400);
  near(payA - payB, OUTLINE.split.saves, 0.5); near(intB - intA, OUTLINE.split.extra, 500);
  const bal5 = sA[59].balance;
  near(payA * 60, OUTLINE.year5.paid, 50); near(bal5, OUTLINE.year5.owed, 250);
  near(payment(bal5, 600, 240), OUTLINE.year5.newPay, 0.5);
});

test('level 1: price tag numbers', () => {
  assert.equal(ans('ft10-s3-u6-l1-q2'), 24000000);
  assert.equal(ans('ft10-s3-u6-l1-q3'), 60000 / 300000 * 100);
  assert.equal(ans('ft10-s3-u6-l1-q5'), 25000 / 250000 * 100);
  assert.equal(ans('ft10-s3-u6-l1-q6'), totA);
  assert.equal(ans('ft10-s3-u6-l1-q7'), intA);
  const t = text(1);
  for (const s of [money(payA), money(totA), money(intA), money(totA + 8000000)]) assert.ok(t.includes(s), `level 1 cards quote ${s}`);
  const bars = unit.levels[0].cards.find((c) => c.figure?.kind === 'bars').figure.bars;
  assert.deepEqual(bars.map((b) => b.value), [40000000, 8000000, LOAN, totA]);
  assert.equal(unit.levels[0].questions[7].answer, 3);
});

test('level 2: the six words', () => {
  assert.equal(ans('ft10-s3-u6-l2-q9'), 500000 * 100 * 0.2);
  assert.equal(ans('ft10-s3-u6-l2-q10'), (500000 - 100000) * 100);
  const words = ['down payment', 'principal', 'interest rate', 'amortization', 'term', 'renewal'];
  for (const w of words) assert.ok(text(2).toLowerCase().includes(w), `level 2 names "${w}"`);
});

test('level 3: first payment', () => {
  const r1 = sA[0];
  assert.equal(ans('ft10-s3-u6-l3-q2'), payA - r1.interest);
  assert.ok(Math.abs(ans('ft10-s3-u6-l3-q1') - r1.interest) <= 50);
  assert.ok(Math.abs(32000000 * 0.004124 - ans('ft10-s3-u6-l3-q1')) <= 50);
  assert.equal(ans('ft10-s3-u6-l3-q3'), Math.round((r1.principal / payA) * 100));
  assert.equal(ans('ft10-s3-u6-l3-q5'), sA[239].principal);
  assert.equal(ans('ft10-s3-u6-l3-q6'), LOAN - sA[11].balance);
  const first = sA.findIndex((r) => r.principal > r.interest) + 1;
  assert.equal(first, 133);
  assert.ok(text(3).includes('payment 133'));
  const pts = Q.get('ft10-s3-u6-l3-q8').figure.points;
  const n = pts.map((p) => Number(p.label.slice(1)));
  pts.forEach((p, i) => assert.equal(p.value, sA[n[i] - 1].interest));
  assert.equal(pts.findIndex((p) => p.value < 100000), ans('ft10-s3-u6-l3-q8'));
  const tbl = Q.get('ft10-s3-u6-l3-q5').figure.rows;
  tbl.forEach((row) => { const r = sA[Number(row[0]) - 1]; assert.deepEqual(row.slice(1), [money(r.interest), money(r.principal), money(r.balance)]); });
  assert.ok(text(3).includes('0.4124%'));
  assert.equal((1 + 0.05 / 2) ** (1 / 6) - 1 > 0.004123 && (1 + 0.05 / 2) ** (1 / 6) - 1 < 0.004125, true);
});

test('level 4: three mortgages', () => {
  assert.equal(ans('ft10-s3-u6-l4-q3'), payA - payB);
  assert.equal(ans('ft10-s3-u6-l4-q4'), intB - intA);
  assert.equal(ans('ft10-s3-u6-l4-q5'), payC - payA);
  assert.equal(ans('ft10-s3-u6-l4-q6'), intC - intA);
  assert.equal(ans('ft10-s3-u6-l4-q10'), Math.round((intA / LOAN) * 1000) / 10);
  const rows = Q.get('ft10-s3-u6-l4-q1').figure.rows;
  assert.deepEqual(rows.map((r) => [r[3], r[4]]), [[money(payA), money(intA)], [money(payB), money(intB)], [money(payC), money(intC)]]);
  assert.ok(intA < intC && intC < intB && payB < payA && payA < payC);
  const bars = Q.get('ft10-s3-u6-l4-q9').figure.bars.map((b) => b.value);
  assert.deepEqual(bars, [payA, payB, payC]);
  assert.equal(ans('ft10-s3-u6-l4-q9'), bars.indexOf(Math.max(...bars)));
});

test('level 5: year five', () => {
  const bal5 = sA[59].balance, paid5 = payA * 60;
  assert.equal(ans('ft10-s3-u6-l5-q2'), paid5);
  assert.equal(ans('ft10-s3-u6-l5-q3'), LOAN - bal5);
  assert.equal(ans('ft10-s3-u6-l5-q4'), Math.round(((LOAN - bal5) / paid5) * 100));
  const newPay = payment(bal5, 600, 240), pay4 = payment(bal5, 400, 240);
  assert.equal(ans('ft10-s3-u6-l5-q7'), (newPay - payA) * 12);
  const t = text(5);
  for (const s of [money(paid5), money(bal5), money(LOAN - bal5), money(newPay), money(newPay - payA)]) assert.ok(t.includes(s), `level 5 cards quote ${s}`);
  const rows = Q.get('ft10-s3-u6-l5-q6').figure.rows;
  assert.deepEqual(rows.map((r) => r[1]), [money(pay4), money(newPay)]);
  assert.ok(pay4 < payA && newPay > payA);
  const bars = Q.get('ft10-s3-u6-l5-q9').figure.bars.map((b) => b.value);
  assert.deepEqual(bars, [LOAN, paid5, bal5]);
});

test('level 6: the game\'s mortgage (Jordan)', () => {
  const price = STARTER_PRICE_CENTS, down = 1500000;
  assert.equal(price, 15000000);
  assert.equal(CONDO_PRICE_CENTS, 20200000);
  assert.ok(unit.levels[5].cards[0].text.includes('$202,000') && unit.levels[5].cards[0].text.includes('$150,000'));
  assert.equal(ans('ft10-s3-u6-l6-q1'), minDown(price));
  assert.equal(minDown(price), Math.round(price * 0.05));
  const ins = insurance(price, down, 300);
  assert.equal(ins.insured, true); assert.equal(ins.premiumBp, 310);
  assert.equal(ans('ft10-s3-u6-l6-q2'), ins.premiumCents);
  const loan = price - down + ins.premiumCents;
  assert.equal(ans('ft10-s3-u6-l6-q3'), loan);
  const bp = POLICY_BP + SPREADS.mortgage5y;
  assert.equal(bp, 420);
  assert.equal(ans('ft10-s3-u6-l6-q5'), bp / 100);
  const s = schedule(loan, bp, 300), pay = payment(loan, bp, 300);
  assert.equal(ans('ft10-s3-u6-l6-q4'), s[0].principal);
  const bal = s[59].balance, newPay = payment(bal, bp + 100, 240);
  assert.equal(ans('ft10-s3-u6-l6-q9'), newPay - pay);
  const t = text(6);
  for (const x of [money(minDown(price)), money(ins.premiumCents), money(bal), money(newPay), money(pay)]) assert.ok(t.includes(x), `level 6 cards quote ${x}`);
  assert.deepEqual(Q.get('ft10-s3-u6-l6-q4').figure.rows.map((r) => r[1]), [money(loan), money(pay), money(s[0].interest), '4.20%']);
  assert.ok(t.includes('Rent or buy'));
  // a 30-year amortization on an insured mortgage adds 20 bp (the game's rule, stated on no card as a number)
  assert.equal(insurance(price, down, 360).premiumBp, 330);
});

test('quoted dollar figures in the cards are the computed ones', () => {
  const all = unit.levels.flatMap((l) => l.cards.map((c) => c.text)).join(' ');
  for (const s of [money0(400000 * 100), money0(8000000), money0(LOAN)]) assert.ok(all.includes(s));
  assert.equal(OUTLINE.price.value * 100 - OUTLINE.down.value * 100, LOAN);
});
