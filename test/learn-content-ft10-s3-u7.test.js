// Content check for the Learning Road unit "Rent or buy" (ft10-s3-u7): the mortgage figures are recomputed from modules/housing (the game's
// own payment, schedule and rentVsBuy), the level-4 table from an independent month-by-month sum written here, every figure quoted from
// Mr. Tang's outlines is pinned to a cited table, and the shape (levels, cards, questions, art prompts) is checked.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { payment, schedule, rentVsBuy } from '../modules/housing/mortgage.js';
import { LEGAL_FEE_CENTS, COMMISSION_PCT } from '../modules/housing/constants.js';

const course = JSON.parse(fs.readFileSync(new URL('../modules/learn/content/fintech10.json', import.meta.url), 'utf8'));
const unit = course.sections.flatMap((s) => s.units).find((u) => u.id === 'ft10-s3-u7');
const Q = new Map(unit.levels.flatMap((l) => l.questions).map((q) => [q.id, q]));
const money = (c) => `$${(c / 100).toLocaleString('en-CA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const text = (l) => unit.levels[l - 1].cards.map((c) => c.text).join(' ');
const q = (l, n) => Q.get(`ft10-s3-u7-l${l}-q${n}`);
const rows = (l, c) => unit.levels[l - 1].cards[c - 1].figure.rows;

// Figures quoted from Mr. Tang's outlines (slide-studio/courses/fintech10/context/outlines/).
const OUTLINE = {
  price: { value: 40000000, cite: 'Lesson 26 outline line 89 ("A $400,000 home")' },
  down: { value: 8000000, cite: 'Lesson 26 outline line 89 ("You pay $80,000 up front")' },
  loan: { value: 32000000, cite: 'Lesson 26 outline line 89 ("lends you $320,000")' },
  rateBp: { value: 500, cite: 'Lesson 26 outline line 89 (5%)' },
  years: { value: 25, cite: 'Lesson 26 outline line 89 (25 years)' },
  paymentApprox: { value: 1861, cite: 'Lesson 26 outline line 163 ($1,861.14 x 300) and Lesson 27 outline lines 143 and 335 ($1,861.13); the game gives $1,861.14' },
  repairsPct: { value: 1, cite: 'Lesson 27 outline lines 120 and 261 (repairs about 1% of the price per year; the class assumption)' },
  repairsMonthApprox: { value: 333, cite: 'Lesson 27 outline line 125 ($333 = 1% of $400,000 / 12)' },
  savePerMonth: { value: 50000, cite: 'Lesson 27 outline line 291 (save $500 a month)' },
  downForSaving: { value: 8000000, cite: 'Lesson 27 outline line 291 ($80,000 takes about 13 years)' },
  months: { value: 160, cite: 'Lesson 27 outline line 335 ($80,000 / $500 = 160 months)' },
  downOn350: { value: 7000000, cite: 'Lesson 27 outline line 224 and 20% of $350,000 = $70,000 (speaker note)' },
  balance5Approx: { value: 283000, cite: 'Lesson 26 outline line 172 (about $283,000 still owed after five years)' },
  paid5Approx: { value: 111700, cite: 'Lesson 26 outline line 172 (about $111,700 paid)' },
};

const PRICE = OUTLINE.price.value, DOWN = OUTLINE.down.value, LOAN = PRICE - DOWN, BP = OUTLINE.rateBp.value, N = OUTLINE.years.value * 12;
const PAY = payment(LOAN, BP, N), SCH = schedule(LOAN, BP, N);

test('every figure from the outlines is pinned (and the game agrees with the outline where it states a figure)', () => {
  assert.equal(LOAN, OUTLINE.loan.value);
  assert.equal(Math.floor(PAY / 100), OUTLINE.paymentApprox.value);
  assert.equal(Math.round(SCH[59].balance / 100000) * 1000, OUTLINE.balance5Approx.value);
  assert.equal(Math.round((PAY * 60) / 10000) * 100, OUTLINE.paid5Approx.value);
  assert.equal(Math.round(PRICE * OUTLINE.repairsPct.value / 100 / 12 / 100), OUTLINE.repairsMonthApprox.value);
  assert.equal(OUTLINE.downForSaving.value / OUTLINE.savePerMonth.value, OUTLINE.months.value);
  assert.equal(Math.floor(OUTLINE.months.value / 12), 13);
  assert.equal(35000000 * 0.2, OUTLINE.downOn350.value);
  for (const [k, v] of Object.entries(OUTLINE)) assert.ok(v.cite && Number.isFinite(v.value), k);
});

test('shape: 5 levels, 4-6 cards, 7-10 questions, no pictures, stable ids, go button', () => {
  assert.equal(unit.levels.length, 5);
  assert.deepEqual(unit.outcome_codes, ['FIN1010 3.2', 'FIN1010 2.3', 'FIN1010 3.5']);
  unit.levels.forEach((l, i) => {
    assert.equal(l.id, `ft10-s3-u7-l${i + 1}`);
    assert.ok(l.cards.length >= 4 && l.cards.length <= 6, `${l.id}: ${l.cards.length} cards`);
    assert.ok(l.questions.length >= 7 && l.questions.length <= 10, `${l.id}: ${l.questions.length} questions`);
    assert.ok(l.questions.filter((x) => x.type === 'number').length >= 2, `${l.id}: needs 2 number questions`);
    assert.ok(l.questions.some((x) => x.figure), `${l.id}: needs a question with a figure`);
    l.questions.forEach((x, j) => assert.equal(x.id, `${l.id}-q${j + 1}`));
  });
  assert.deepEqual(unit.levels[4].go, { building: 'housing', label: 'Open Housing' });
  assert.ok(!JSON.stringify(unit).includes('"image"'));
});

test('art prompts: banner plus one line per card without a figure', () => {
  const tsv = fs.readFileSync(new URL('../design/art/ft10-s3-u7-prompts.tsv', import.meta.url), 'utf8').trim().split('\n').map((l) => l.split('\t'));
  const want = ['banner', ...unit.levels.flatMap((l, i) => l.cards.map((c, j) => (c.figure ? null : `l${i + 1}c${j + 1}`)).filter(Boolean))];
  assert.deepEqual(tsv.map((r) => r[0]), want);
  const alts = tsv.map((r) => r[2]);
  assert.equal(new Set(alts).size, alts.length);
  for (const [, p, a] of tsv) { const w = p.split(/\s+/).length; assert.ok(w >= 10 && w <= 30, p); assert.ok(a.length >= 5 && a.length <= 120, a); assert.ok(!/\b(no|without|coin)\b/i.test(p), p); }
});

test('level 1: the Mortgages house from the game\'s payment', () => {
  assert.ok(text(1).includes(money(PAY)));
  assert.equal(q(1, 4).answer, LOAN);
  assert.equal(q(1, 5).answer, PAY * 12);
  assert.equal(q(1, 6).answer, 250000 * 12);
  const bars = q(1, 7).figure.bars;
  assert.deepEqual(bars.map((b) => b.value), [250000, PAY]);
  assert.equal(q(1, 7).answer, 0);
});

const TAX_YR = 390000, REP_MO = Math.round(PRICE / 100 / 12);
const OWN = PAY + TAX_YR / 12 + REP_MO;
test('level 2: hidden costs', () => {
  const t = text(2);
  for (const s of [money(PAY), money(TAX_YR), money(TAX_YR / 12), '$4,000.00', money(REP_MO), money(OWN)]) assert.ok(t.includes(s), s);
  assert.equal(rows(2, 6)[3][1], money(OWN));
  assert.equal(q(2, 2).answer, 480000 / 12);
  assert.equal(q(2, 3).answer, Math.round((35000000 / 100 / 12)), 'repairs on $350,000');
  assert.equal(q(2, 4).answer, TAX_YR / 12 + REP_MO);
  const thLoan = 30000000 - 6000000, thPay = payment(thLoan, BP, N);
  const th = q(2, 5).figure.rows;
  assert.equal(th[0][1], money(thPay));
  assert.equal(q(2, 5).answer, thPay + 22500 + 31000 + 25000);
  assert.equal(th[1][1], money(2700 * 100 / 12));
  assert.equal(th[3][1], money(30000000 / 100 / 12));
});

test('level 3: gone and kept, from the game\'s schedule', () => {
  const t = text(3);
  const bal5 = SCH[59].balance, paid5 = PAY * 60, prin5 = LOAN - bal5, int5 = SCH.slice(0, 60).reduce((a, r) => a + r.interest, 0);
  assert.equal(int5, paid5 - prin5);
  for (const s of [money(SCH[0].interest), money(SCH[0].principal), money(paid5), money(bal5), money(prin5), money(int5)]) assert.ok(t.includes(s), s);
  assert.equal(SCH[0].interest + SCH[0].principal, PAY);
  assert.equal(q(3, 3).answer, SCH[0].principal);
  assert.equal(q(3, 4).answer, PRICE - bal5);
  assert.equal(q(3, 5).answer, prin5);
  assert.equal(q(3, 6).answer, int5);
  const y1 = SCH.slice(0, 12), i1 = y1.reduce((a, r) => a + r.interest, 0), p1 = y1.reduce((a, r) => a + r.principal, 0);
  const f = rows(3, 6);
  assert.equal(f[0][1], money(i1)); assert.equal(f[3][1], money(p1)); assert.equal(f[4][1], money(250000 * 12));
  assert.equal(q(3, 7).answer, i1 + TAX_YR + PRICE / 100);
  assert.equal(q(3, 8).answer, 250000 * 12 - (i1 + TAX_YR + PRICE / 100));
  assert.deepEqual(q(3, 9).figure.bars.map((b) => b.value), [i1, TAX_YR, PRICE / 100, p1]);
  assert.equal(q(3, 9).answer, 3);
});

// Independent month-by-month: savings earn 3%/12 on the pot (rounded to the cent), then the month's difference is added.
test('level 4: the renter\'s pot and the owner\'s position, recomputed', () => {
  const diff = OWN - 250000;
  let pot = DOWN; const res = {};
  for (let mo = 1; mo <= 120; mo++) { pot = Math.round(pot * (1 + 0.03 / 12)) + diff; if (mo % 12 === 0) res[mo / 12] = { renter: pot, owner: PRICE - SCH[mo - 1].balance - 2400000, bal: SCH[mo - 1].balance }; }
  const f = rows(4, 5);
  for (const r of f) { const y = Number(r[0].split(' ')[1]); assert.equal(r[1], money(res[y].renter), r[0]); assert.equal(r[2], money(res[y].owner), r[0]); }
  assert.equal(q(4, 2).answer, diff);
  assert.equal(q(4, 3).answer, res[3].owner);
  assert.ok(text(4).includes(money(res[5].owner)) && text(4).includes(money(SCH[59].balance)));
  assert.ok(res[2].renter > res[2].owner && res[8].owner > res[8].renter);
  const first = Object.keys(res).map(Number).find((y) => res[y].owner > res[y].renter);
  assert.equal(first, 6);
  assert.equal(q(4, 6).options[q(4, 6).answer].text, 'Year 6');
  assert.ok(res[5].renter > res[5].owner && res[4].renter > res[4].owner);
  for (let y = 6; y < 10; y++) assert.ok(res[y + 1].owner - res[y + 1].renter > res[y].owner - res[y].renter, 'the lead keeps growing (level 5 card 3)');
  const bars = q(4, 7).figure.bars;
  assert.deepEqual(bars.map((b) => b.value), [1, 2, 3, 4, 5, 6, 7, 8].map((y) => res[y].owner));
  assert.equal(q(4, 7).answer, bars.findIndex((b) => b.value > 10000000));
  assert.equal(q(4, 8).answer, res[10].owner - res[10].renter);
  assert.ok(res[1].bal === SCH[11].balance && PRICE - res[1].bal - 2400000 < DOWN);
  assert.ok(SCH.slice(0, 12).reduce((a, r) => a + r.principal, 0) < 2400000, 'year-1 principal is less than the one-time costs (q9)');
});

test('level 5: the game\'s own calculator on Nia\'s condo', () => {
  const base = { priceCents: 24000000, downCents: 4800000, contractBp: 500, amortMonths: 300, rentCents: 150000, condoFeeCents: 35000, heatingCents: 6000, insuranceCents: 3500, driftBp: 25, investBp: 275, legalCents: LEGAL_FEE_CENTS, commissionPct: COMMISSION_PCT };
  assert.equal(LEGAL_FEE_CENTS, 150000); assert.equal(COMMISSION_PCT, 4);
  const g = (years) => rentVsBuy({ ...base, years });
  const f = rows(5, 6);
  const want = { 'Year 1': 1, 'Year 2': 2, 'Year 3': 3, 'Year 5': 5, 'Year 10': 10 };
  for (const r of f) { const x = g(want[r[0]]); assert.equal(r[1], money(x.renterWealthCents), r[0]); assert.equal(r[2], money(x.buyerWealthCents), r[0]); }
  assert.equal(g(1).cheaper, 'rent'); assert.equal(g(3).cheaper, 'buy'); assert.equal(g(2).cheaper, 'rent');
  assert.ok(text(5).includes(money(g(1).monthlyOwnCents)));
  assert.equal(q(5, 3).answer, 7000000);
  assert.equal(q(5, 8).answer, g(10).buyerWealthCents - g(10).renterWealthCents);
  assert.equal(q(5, 6).options[q(5, 6).answer].text, 'The renter');
  assert.equal(q(5, 7).options[q(5, 7).answer].text, 'The buyer');
  assert.equal(q(5, 2).options[q(5, 2).answer].text, 'About 13 years');
});
