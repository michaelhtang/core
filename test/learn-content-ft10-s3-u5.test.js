// Content check for the Learning Road unit "Loans: payment and total cost" (ft10-s3-u5): every number answer, trap and table is recomputed
// from an ordinary monthly-payment loan (interest = balance x rate / 12), figures quoted from Mr. Tang's Lesson 24 outline are pinned to cited lines.
// modules/housing/mortgage.js is NOT used: it compounds semi-annually (a Canadian mortgage rule), which is not the ordinary loan taught here.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const course = JSON.parse(fs.readFileSync(new URL('../modules/learn/content/fintech10.json', import.meta.url), 'utf8'));
const unit = course.sections.flatMap((s) => s.units).find((u) => u.id === 'ft10-s3-u5');
const Q = new Map(unit.levels.flatMap((l) => l.questions).map((q) => [q.id, q]));
const q = (l, n) => Q.get(`ft10-s3-u5-l${l}-q${n}`);

// Independent loan maths (integer cents): payment = P i / (1 - (1+i)^-n) rounded to the cent, interest each month rounded to the cent,
// the last payment clears the balance. extra = a fixed extra amount added to every payment.
const pmt = (P, apr, n) => { const i = apr / 12; return Math.round((P * i) / (1 - (1 + i) ** -n)); };
function loan(P, apr, n, extra = 0) {
  const pay = pmt(P, apr, n); let bal = P, paid = 0, interest = 0, k = 0; const rows = [];
  while (bal > 0) {
    k++; const i = Math.round((bal * apr) / 12); let due = pay + extra;
    if ((extra === 0 && k === n) || bal + i <= due) due = bal + i;
    bal -= due - i; paid += due; interest += i; rows.push({ k, i, p: due - i, due, bal });
  }
  return { pay, count: k, paid, interest, rows };
}
const d0 = (c) => Math.round(c / 100) * 100;
const m = (c) => `$${(c / 100).toLocaleString('en-CA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const m0 = (c) => `$${Math.round(c / 100).toLocaleString('en-CA')}`;
const near = (id, v, tolOk = true) => { const x = Q.get(id); assert.ok(Math.abs(x.answer - v) <= (tolOk ? x.tolerance : 0) , `${id}: stored ${x.answer}, recomputed ${v}`); };

const OUT = 'slide-studio/courses/fintech10/context/claude-project/docs/claude_Lesson 24 Slide Outline Oct 15.md';
// Outline figures (the lesson quotes the loan as the class's example, REVIEW items 1 to 3).
const OUTLINE = {
  loan: { value: [2000000, 0.08, [3, 5, 7]], cite: `${OUT} line 78 ("A $20,000 car. 8% interest ... 3 years, 5 years, or 7 years")` },
  slide: { value: { 36: [627, 2562], 60: [406, 4332], 84: [312, 6185] }, cite: `${OUT} line 107 ("3 years: $627 a month, $2,562 interest ... 7 years: $312 a month, $6,185 interest")` },
  clocks: { value: 'no interest while you study full-time, plus 12 months after', cite: `${OUT} line 121` },
};

test('shape: 4 levels, 4-6 cards, 7-10 questions, ids, codes, no pictures, no game button', () => {
  assert.equal(unit.title, 'Loans: payment and total cost');
  assert.equal(unit.blurb, 'A longer loan means a smaller payment and a bigger total.');
  assert.deepEqual(unit.outcome_codes, ['FIN1010 3.3', 'FIN1010 2.3']);
  assert.equal(unit.levels.length, 4);
  unit.levels.forEach((l, i) => {
    assert.equal(l.id, `ft10-s3-u5-l${i + 1}`);
    assert.ok(l.cards.length >= 4 && l.cards.length <= 6, `${l.id}: ${l.cards.length} cards`);
    assert.ok(l.questions.length >= 7 && l.questions.length <= 10, `${l.id}: ${l.questions.length} questions`);
    assert.ok(l.questions.filter((x) => x.type === 'number').length >= 2, `${l.id}: 2 number questions`);
    assert.ok(l.questions.some((x) => x.figure), `${l.id}: a question with a figure`);
    assert.ok(!l.go, 'the game has no ordinary loan, so no go button');
    l.questions.forEach((x, k) => assert.equal(x.id, `${l.id}-q${k + 1}`));
  });
  assert.ok(!JSON.stringify(unit).includes('"image"'), 'no image fields yet');
  assert.ok(!/replica|Slide Studio|\bAI\b|Claude|loanscanada/i.test(JSON.stringify(unit)), 'no tool or outside site is named');
});

test('outline loan: the three terms match the slide to the dollar, and the stored table is the recomputed one', () => {
  assert.deepEqual(OUTLINE.loan.value.slice(0, 2), [2000000, 0.08]);
  const tab = unit.levels[2].cards[1].figure.rows;
  OUTLINE.loan.value[2].forEach((y, i) => {
    const L = loan(2000000, 0.08, y * 12), [slidePay, slideInt] = OUTLINE.slide.value[y * 12];
    assert.equal(Math.round(L.pay / 100), slidePay, `${y} years: payment vs slide`);
    assert.equal(Math.round(L.interest / 100), slideInt, `${y} years: interest vs slide`);
    assert.deepEqual(tab[i], [`${y} years`, String(y * 12), m(L.pay), m0(L.paid), m0(d0(L.paid) - 2000000)]);
    assert.ok(Math.abs(d0(L.pay * y * 12) - d0(L.paid)) <= 100, 'payment x payments agrees with the schedule to a dollar');
  });
});

test('level 1: fixed-payment loan arithmetic', () => {
  const noor = loan(240000, 0.12, 12), sam = loan(600000, 0.09, 24), kai = loan(120000, 0.09, 48);
  assert.equal(noor.pay, 21324);
  assert.deepEqual(unit.levels[0].cards[1].figure.rows[3], ['Payment each month', m(noor.pay)]);
  near('ft10-s3-u5-l1-q4', d0(noor.pay * 12)); near('ft10-s3-u5-l1-q4', d0(noor.paid));
  near('ft10-s3-u5-l1-q5', d0(noor.pay * 12) - 240000); near('ft10-s3-u5-l1-q5', d0(noor.paid) - 240000);
  near('ft10-s3-u5-l1-q6', d0(sam.pay * 24)); assert.equal(sam.pay, 27411);
  near('ft10-s3-u5-l1-q8', d0(kai.pay * 48) - 120000); assert.equal(kai.pay, 2986);
  assert.deepEqual(q(1, 5).traps.map((t) => t.value), [28800]);       // 12% of $2,400 for a full year
  assert.deepEqual(q(1, 4).traps.map((t) => t.value), [noor.pay]);
  assert.deepEqual(q(1, 6).traps.map((t) => t.value), [sam.pay * 2]);
  assert.deepEqual(q(1, 8).traps.map((t) => t.value), [kai.pay * 48]);
  assert.ok(noor.interest < 28800, 'a monthly loan costs less interest than a full year on the principal');
  const dev = unit.levels[0].questions[2].figure.rows; assert.deepEqual(dev[2], ['Term', '3 years']);
  assert.equal(q(1, 3).options[q(1, 3).answer].text, '36');
});

test('level 2: interest and principal in each payment', () => {
  const zoe = loan(600000, 0.12, 36), z = zoe.rows, L = loan(2000000, 0.08, 60), r = L.rows;
  assert.equal(zoe.pay, 19929);
  near('ft10-s3-u5-l2-q1', 600000 * 0.12 / 12, false); near('ft10-s3-u5-l2-q1', z[0].i, false);
  near('ft10-s3-u5-l2-q2', z[0].p, false); assert.equal(z[0].p, 19929 - 6000);
  near('ft10-s3-u5-l2-q3', z[0].bal, false);
  near('ft10-s3-u5-l2-q4', z[1].i); assert.equal(Math.round(z[0].bal * 0.12 / 12), z[1].i);
  near('ft10-s3-u5-l2-q8', Math.round((r[0].i / L.pay) * 100)); assert.equal(Math.round((r[0].i / L.pay) * 100), 33);
  near('ft10-s3-u5-l2-q9', r[2].i); assert.equal(Math.round(r[1].bal * 0.08 / 12), r[2].i);
  assert.deepEqual(q(2, 1).traps.map((t) => t.value), [72000]);
  assert.deepEqual(q(2, 3).traps.map((t) => t.value), [600000 - zoe.pay]);
  assert.deepEqual(q(2, 8).traps.map((t) => t.value), [67]);
  // the table card and the bars card
  const rows = unit.levels[1].cards[2].figure.rows;
  [1, 2, 3, 12, 24, 36, 48, 60].forEach((k, i) => assert.deepEqual(rows[i], [String(k), m(r[k - 1].due), m(r[k - 1].i), m(r[k - 1].p), m(r[k - 1].bal)]));
  assert.equal(r[59].bal, 0); assert.equal(r[0].due, L.pay);
  const bars = q(2, 5).figure.bars; const ks = [1, 12, 24, 36, 48, 60];
  assert.deepEqual(bars.map((b) => b.value), ks.map((k) => r[k - 1].i));
  assert.equal(q(2, 5).answer, bars.findIndex((b) => b.value < 10000)); assert.equal(q(2, 5).answer, 2);
  assert.ok(r.every((x, i) => i === 0 || x.i < r[i - 1].i), 'interest falls every month');
});

test('level 3: shorter or longer', () => {
  const A = loan(2000000, 0.08, 36), B = loan(2000000, 0.08, 60), C = loan(2000000, 0.08, 84);
  const ti = (x) => d0(x.paid) - 2000000;
  near('ft10-s3-u5-l3-q3', ti(C) - ti(A)); near('ft10-s3-u5-l3-q3', C.interest - A.interest);
  near('ft10-s3-u5-l3-q4', ti(B) - ti(A)); near('ft10-s3-u5-l3-q4', B.interest - A.interest);
  near('ft10-s3-u5-l3-q5', A.pay - C.pay, false);
  near('ft10-s3-u5-l3-q7', d0(B.pay * 60));
  assert.deepEqual(q(3, 7).traps.map((t) => t.value), [B.pay * 5]);
  assert.deepEqual(q(3, 3).traps.map((t) => t.value), [ti(C)]);
  const pick = (id) => q(3, id).options[q(3, id).answer].text;
  assert.equal(pick(1), '7 years'); assert.ok(C.pay < B.pay && B.pay < A.pay);
  assert.equal(pick(2), '7 years'); assert.ok(C.paid > B.paid && B.paid > A.paid);
  assert.equal(pick(6), '60');
  assert.match(unit.levels[2].cards[2].text, new RegExp(`${Math.round((A.rows[0].i / A.pay) * 100)}% of the 3-year payment and ${Math.round((C.rows[0].i / C.pay) * 100)}% of the 7-year`));
  assert.ok(C.pay * 2 < A.pay * 1.0 + 20000 && C.interest > 2 * A.interest, 'about half the payment, more than twice the interest');
  assert.match(unit.levels[2].cards[4].text, /no interest while the borrower studies full-time and for 12 months after/);
  assert.match(OUTLINE.clocks.value, /12 months after/);
});

test('level 4: levers, extra payments and aims', () => {
  const base = loan(1200000, 0.09, 48), less = loan(1000000, 0.09, 48), rate = loan(1200000, 0.06, 48), shrt = loan(1200000, 0.09, 36), lng = loan(1200000, 0.09, 60), x50 = loan(1200000, 0.09, 48, 5000);
  const ti = (x) => d0(x.paid) - x.rows.reduce((a, r) => a + r.p, 0);        // total interest in whole dollars
  const lev = unit.levels[3].cards[0].figure.rows;
  [['Sol\'s loan', base], ['Borrow less', less], ['Lower rate', rate], ['Shorter term', shrt]].forEach(([t, x], i) => assert.deepEqual([lev[i][0], lev[i][2], lev[i][3]], [t, m(x.pay), m0(ti(x))]));
  near('ft10-s3-u5-l4-q2', ti(base) - ti(rate)); near('ft10-s3-u5-l4-q2', base.interest - rate.interest);
  near('ft10-s3-u5-l4-q3', base.pay - less.pay, false);
  near('ft10-s3-u5-l4-q4', ti(base) - ti(x50)); near('ft10-s3-u5-l4-q4', base.interest - x50.interest);
  assert.equal(x50.count, 40); assert.equal(Number(q(4, 5).options[q(4, 5).answer].text), base.count - x50.count);
  near('ft10-s3-u5-l4-q9', d0(lng.pay * 60)); near('ft10-s3-u5-l4-q9', d0(lng.paid));
  assert.deepEqual(q(4, 9).traps.map((t) => t.value), [lng.pay * 5]);
  assert.deepEqual(q(4, 3).traps.map((t) => t.value), [200000]);
  // the claims of card 2 and the level 4 question 1
  assert.ok(less.pay < base.pay && less.interest < base.interest && rate.pay < base.pay && rate.interest < base.interest);
  assert.ok(shrt.pay > base.pay && shrt.interest < base.interest && lng.pay < base.pay && lng.interest > base.interest);
  assert.equal(q(4, 1).options[q(4, 1).answer].text, 'A shorter term');
  // aims: P (36) has the lowest total interest, R (60) has the lowest payment, each exactly once
  const aim = unit.levels[3].cards[3].figure.rows; assert.deepEqual(aim.map((r) => r[1]), ['36 months', '48 months', '60 months']);
  assert.equal(q(4, 7).options[q(4, 7).answer].text, 'Loan R'); assert.equal(q(4, 8).options[q(4, 8).answer].text, 'Loan P');
  const pays = [shrt, base, lng].map((x) => x.pay), ints = [shrt, base, lng].map((x) => x.interest);
  assert.equal(pays.indexOf(Math.min(...pays)), 2); assert.equal(ints.indexOf(Math.min(...ints)), 0);
  const extra = unit.levels[3].cards[2].figure.rows; assert.deepEqual(extra[1], ['Plus $50.00 extra each month', m(base.pay + 5000), '40', m0(ti(x50))]);
});
