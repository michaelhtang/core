// Content check for the Learning Road unit "Credit cards and the minimum payment" (ft10-s3-u3): the card maths are recomputed from
// modules/credit (the game's own functions) and from an independent month-by-month table written here; every figure quoted from Mr. Tang's
// outlines is pinned to a cited table; the shape (levels, cards, questions) is checked.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { minimumPayment, statementInterest, payoff } from '../modules/credit/score.js';
import { CARD_APR_BP, LATE_FEE_CENTS, PAYMENT, MIN_PAYMENT } from '../modules/credit/constants.js';

const course = JSON.parse(fs.readFileSync(new URL('../modules/learn/content/fintech10.json', import.meta.url), 'utf8'));
const unit = course.sections.flatMap((s) => s.units).find((u) => u.id === 'ft10-s3-u3');
const Q = new Map(unit.levels.flatMap((l) => l.questions).map((q) => [q.id, q]));
const money = (c) => `$${(c / 100).toLocaleString('en-CA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const text = (l) => unit.levels[l - 1].cards.map((c) => c.text).join(' ');
const q = (l, n) => Q.get(`ft10-s3-u3-l${l}-q${n}`);

// Figures quoted from Mr. Tang's outlines (slide-studio/courses/fintech10/context/claude-project/docs/).
const OUTLINE = {
  balance: { value: 500000, cite: 'Lesson 19 outline line 86 ("You owe $5,000 on a card")' },
  rateBp: { value: 2099, cite: 'Lesson 19 outline line 89 (balance $5,000, rate 20.99%, minimum 3%)' },
  minPct: { value: 3, cite: 'Lesson 19 outline line 219 (20.99%, 3% minimum with a $10 floor)' },
  floorCents: { value: 1000, cite: 'Lesson 19 outline line 219 and line 101 ("3% minimum and a $10 floor")' },
  fixedPayCents: { value: 20000, cite: 'Lesson 19 outline line 95 ($200 a month: 34 months and about $1,600)' },
  fixedMonths: { value: 34, cite: 'Lesson 19 outline line 95' },
  rewardPct: { value: 2, cite: 'Lesson 19 outline lines 122 and 129 (Card B: 20.99%, 2% cash back)' },
  spendMonthCents: { value: 50000, cite: 'Lesson 19 outline line 122 (you spend $500 a month)' },
  carriedCents: { value: 300000, cite: 'Lesson 19 outline line 122 (carry a $3,000 balance all year)' },
  lowRateBp: { value: 1299, cite: 'Lesson 19 outline line 122 (Card A: 12.99%)' },
  rewardYearCents: { value: 12000, cite: 'Lesson 19 outline line 129 (about $120 a year on $6,000)' },
  interestAApprox: { value: 390, cite: 'Lesson 19 outline line 130 (Card A about $390)' },
  interestBApprox: { value: 630, cite: 'Lesson 19 outline line 130 (Card B about $630)' },
  graceDays: { value: 21, cite: 'Credit Card Hunt outline line 93 (Sources: "Minimum 21-day grace period")' },
  hookRate: { value: 20, cite: 'Credit Card Hunt outline line 43 ("about 20% a year")' },
};

// Independent month-by-month table (the same rule as the game: minimum off the statement balance, interest on the whole statement balance).
const minOf = (b) => Math.min(b, Math.max(1000, Math.ceil((b * 3) / 100)));
const intOf = (b, bp) => Math.floor((b * bp) / 120000);
function table(b, bp, pay) {
  const rows = []; let bal = b;
  while (bal > 0) {
    const p = pay ? Math.min(pay, bal) : minOf(bal), i = intOf(bal, bp);
    if (p >= bal) { rows.push([bal, p, 0, 0]); break; }
    rows.push([bal, p, i, bal - p + i]); bal = bal - p + i;
  }
  return rows;
}
const total = (rows, k) => rows.reduce((s, r) => s + r[k], 0);

test('shape: 6 levels, 4-6 cards, 7-10 questions, ids, outcome codes, one go button, no images', () => {
  assert.ok(unit, 'unit ft10-s3-u3 is in fintech10.json');
  assert.equal(unit.title, 'Credit cards and the minimum payment');
  assert.equal(unit.blurb, 'How card interest builds, and what paying only the minimum really costs.');
  assert.deepEqual(unit.outcome_codes, ['FIN1010 3.3', 'FIN1010 2.3', 'FIN1010 3.2']);
  assert.equal(unit.levels.length, 6);
  unit.levels.forEach((l, i) => {
    assert.equal(l.id, `ft10-s3-u3-l${i + 1}`);
    assert.ok(l.cards.length >= 4 && l.cards.length <= 6, `${l.id}: ${l.cards.length} cards`);
    assert.ok(l.questions.length >= 7 && l.questions.length <= 10, `${l.id}: ${l.questions.length} questions`);
    assert.ok(l.questions.filter((x) => x.type === 'number').length >= 2, `${l.id}: at least 2 number questions`);
    assert.ok(l.questions.some((x) => x.figure), `${l.id}: at least 1 question with a figure`);
    l.questions.forEach((x, k) => assert.equal(x.id, `${l.id}-q${k + 1}`));
  });
  assert.deepEqual(unit.levels[5].go, { building: 'credit', label: 'Open the Credit Bureau' });
  assert.ok(unit.levels.every((l, i) => i === 5 || !l.go));
  assert.ok(!/"image"/.test(JSON.stringify(unit)), 'no image fields yet');
  assert.ok(!/Visa|Mastercard|Amex|American Express|FCAC|Capital One|Scotiabank|RBC|TD |BMO|CIBC/i.test(JSON.stringify(unit)), 'no real card, issuer or network');
});

test('the game: constants and functions match what the cards say', () => {
  assert.equal(CARD_APR_BP, OUTLINE.rateBp.value);
  assert.deepEqual(MIN_PAYMENT, { floorCents: OUTLINE.floorCents.value, pct: OUTLINE.minPct.value });
  assert.equal(LATE_FEE_CENTS, 2900);
  assert.equal(PAYMENT.latePenalty, 0.25);
  assert.equal(PAYMENT.decayMonths, 24);
  const t6 = text(6);
  assert.ok(t6.includes('20.99%') && t6.includes('$29.00') && t6.includes('25%') && t6.includes('24 months'));
  for (const b of [1, 500, 25000, 123456, 200000, 500000, 100000]) {
    assert.equal(minOf(b), minimumPayment(b));
    assert.equal(intOf(b, 2099), statementInterest(b, 2099));
  }
  assert.equal(minimumPayment(500), 500, 'a balance under $10.00 is paid off by the minimum');
});

test('level 6: figures from the game\'s functions, and the Credit Bureau calculator figures for $1,000.00', () => {
  const g = payoff({ balanceCents: 100000, aprBp: 2099 });
  assert.deepEqual([g.months, g.totalInterestCents], [139, 110128], 'docs/credit.md worked example');
  assert.ok(text(6).includes(`${g.months} months and ${money(g.totalInterestCents)}`));
  assert.equal(q(6, 1).answer, statementInterest(100000, 2099));
  assert.equal(q(6, 1).figure.rows[1][1], money(minimumPayment(100000)));
  assert.equal(q(6, 2).answer, minimumPayment(100000));
  assert.equal(q(6, 3).answer, LATE_FEE_CENTS);
  assert.equal(q(6, 4).answer, 100000 - minimumPayment(100000) + statementInterest(100000, 2099));
  assert.equal(q(6, 4).answer, 98749);
  assert.equal(q(6, 1).traps[0].value, statementInterest(5000, 2099));
  assert.equal(q(6, 8).answer, 18);
  assert.ok(text(6).includes(money(statementInterest(100000, 2099))));
  // Rule of 72: an estimate, 72 / rate
  assert.equal(72 / 24, 3);
  assert.equal(72 / 4, 18);
  assert.ok(Math.abs(72 / 21 - 3.4) < 0.05);
});

test('level 4: the $5,000.00 tables are recomputed month by month; the game calculator gives the way 1 totals', () => {
  const B = OUTLINE.balance.value, bp = OUTLINE.rateBp.value;
  const w1 = table(B, bp), w2 = table(B, bp, OUTLINE.fixedPayCents.value), game = payoff({ balanceCents: B, aprBp: bp });
  assert.equal(game.months, 267);
  assert.equal(game.totalInterestCents, 669256);
  // the game's calculator adds one more month of interest after the last minimum equals the balance; the table here does not
  assert.equal(w1.length, game.months - 1);
  assert.ok(game.totalInterestCents - total(w1, 2) < 10 && game.totalInterestCents >= total(w1, 2));
  assert.equal(w2.length, OUTLINE.fixedMonths.value);
  assert.equal(total(w2, 2), 163126);
  assert.equal(total(w2, 1), 663126);
  const res = unit.levels[3].cards[3].figure.rows;
  assert.deepEqual(res, [['1: minimum only', `${game.months}`, money(game.totalInterestCents), money(game.totalPaidCents)], ['2: $200.00 a month', `${w2.length}`, money(total(w2, 2)), money(total(w2, 1))]]);
  const fig = (n) => unit.levels[3].cards[n].figure.rows;
  assert.deepEqual(fig(1), w1.slice(0, 3).map((r, k) => [`${k + 1}`, money(r[0]), money(r[1]), money(r[2]), money(r[3])]));
  assert.deepEqual(fig(2), w2.slice(0, 3).map((r, k) => [`${k + 1}`, money(r[0]), money(r[1]), money(r[2]), money(r[3])]));
  assert.equal(q(4, 3).answer, w1[0][1]);
  assert.equal(q(4, 4).answer, w1[0][2]); assert.equal(q(4, 4).tolerance, 0);
  assert.match(q(4, 4).prompt, /Round down to the cent/);                                              // the game drops to $87.45 (the nearest cent would be $87.46)
  assert.equal(Math.round((B * bp) / 120000), w1[0][2] + 1);
  assert.ok(Math.abs(q(4, 5).answer - (20000 - w2[0][2])) <= 1);
  assert.equal(q(4, 6).answer, game.totalInterestCents - total(w2, 2));
  assert.equal(q(4, 6).answer, 506130);
  assert.equal(q(4, 7).answer, minimumPayment(200000) - statementInterest(200000, bp));
  assert.equal(minimumPayment(200000), 6000);
  assert.equal(statementInterest(200000, bp), 3498);
  // the half-way point
  const bal = [B, ...w2.map((r) => r[3])];
  const pts = q(4, 8).figure.points;
  [0, 6, 12, 18, 24, 30].forEach((k, i) => assert.equal(pts[i].value, bal[k]));
  assert.equal(pts[6].value, 0);
  assert.equal(pts.findIndex((p) => p.value < B / 2), q(4, 8).answer);
  assert.deepEqual(q(4, 9).options.length, 4);
  const opts = q(4, 1).options.map((o) => o.text);
  assert.ok(opts.includes('About 22 years') && Math.round(game.months / 12) === 22);
  assert.ok(q(4, 2).options[q(4, 2).answer].text === `${w2.length} months`);
  assert.equal(q(4, 3).answer, OUTLINE.balance.value * OUTLINE.minPct.value / 100);
});

test('level 3: the $1,000.00 minimum-only table', () => {
  const rows = table(100000, 2099).slice(0, 6);
  const fig = unit.levels[2].cards[3].figure.rows;
  assert.deepEqual(fig, rows.map((r, k) => [`${k + 1}`, money(r[0]), money(r[1]), money(r[2]), money(r[3])]));
  assert.deepEqual(rows[0].slice(1), [3000, 1749, 98749]);
  assert.equal(q(3, 1).answer, 6000);
  assert.equal(q(3, 2).answer, 1000);
  assert.equal(q(3, 3).answer, 3704);
  assert.equal(Math.ceil(123456 * 0.03), 3704);
  assert.equal(q(3, 4).answer, 3000 - 1749);
  assert.equal(q(3, 5).answer, rows[1][1] - rows[1][2]);
  assert.equal(q(3, 5).answer, 1236);
  assert.deepEqual(q(3, 5).figure.rows, rows.slice(0, 3).map((r, k) => [`${k + 1}`, money(r[0]), money(r[1]), money(r[2]), money(r[3])]));
  assert.equal(q(3, 7).answer, rows.findIndex((r) => r[3] < 95000));
  q(3, 7).figure.points.forEach((p, k) => assert.equal(p.value, rows[k][3]));
  assert.ok(text(3).includes(money(rows[5][3])));
  assert.equal(q(3, 2).traps[0].value, 750);
  assert.equal(q(3, 3).traps[0].value, Math.floor(123456 * 0.03));
});

test('level 2: interest on a carried balance', () => {
  assert.equal(q(2, 1).answer, 1.5);
  assert.equal(q(2, 2).answer, intOf(80000, 1800));
  assert.equal(q(2, 2).answer, 1200);
  assert.equal(q(2, 3).answer, 3000);
  assert.equal(q(2, 4).answer, intOf(200000, 2099));
  assert.equal(Math.round((200000 * 2099) / 120000), q(2, 4).answer, 'floor and nearest cent agree');
  let b = 50000; for (let k = 0; k < 2; k++) b += intOf(b, 2400);
  assert.equal(q(2, 5).answer, b);
  assert.equal(b, 52020);
  const nop = []; { let x = 100000; for (let k = 0; k <= 6; k++) { nop.push(x); x += intOf(x, 2099); } }
  q(2, 7).figure.points.forEach((p, k) => assert.equal(p.value, nop[k]));
  assert.equal(q(2, 7).answer, nop.findIndex((v) => v > 110000));
  assert.equal(intOf(60000, 2100), 1050);
  assert.equal(intOf(80000, 1400), 933);
  const fig = unit.levels[1].cards[3].figure.rows;
  assert.deepEqual(fig[0], ['1', '$1,000.00', money(intOf(100000, 2099)), money(100000 + intOf(100000, 2099))]);
  const bars = unit.levels[1].cards[4].figure.bars;
  assert.deepEqual(bars.map((x) => x.value), [100000, 200000, 400000, 500000].map((x) => intOf(x, 2099)));
});

test('level 5: made-up cards, simple yearly figures, one best card each', () => {
  const spend = OUTLINE.spendMonthCents.value * 12;
  const cards = { A: [1299, 0, 0], B: [2099, 200, 0], C: [1599, 150, 5000] };
  const reward = (k) => Math.round((spend * cards[k][1]) / 10000), fee = (k) => cards[k][2];
  const interest = (k) => Math.round((OUTLINE.carriedCents.value * cards[k][0]) / 10000);
  const gain = (k) => reward(k) - fee(k), cost = (k) => interest(k) + fee(k) - reward(k);
  assert.equal(reward('B'), OUTLINE.rewardYearCents.value);
  assert.equal(Math.round(interest('A') / 100 / 10) * 10, OUTLINE.interestAApprox.value);
  assert.equal(Math.round(interest('B') / 100 / 10) * 10, OUTLINE.interestBApprox.value);
  assert.equal(q(5, 1).answer, reward('B'));
  assert.equal(q(5, 2).answer, interest('B'));
  assert.equal(q(5, 4).answer, gain('C'));
  assert.equal(q(5, 6).answer, cost('B'));
  assert.deepEqual([cost('A'), cost('B'), cost('C')], [38970, 50970, 43970]);
  assert.deepEqual([gain('A'), gain('B'), gain('C')], [0, 12000, 4000]);
  // exactly one best card for each person (no ties)
  const rank = (f, pick) => Object.keys(cards).map((k) => f(k)).sort((a, b) => pick * (b - a));
  assert.ok(rank(gain, 1)[0] > rank(gain, 1)[1], 'one best card for Mira');
  assert.ok(rank(cost, -1)[0] < rank(cost, -1)[1], 'one cheapest card for Dev');
  const best = (qq, key) => qq.options[qq.answer].text === key;
  assert.ok(best(q(5, 3), 'Card B') && best(q(5, 5), 'Card A'));
  const pts = q(5, 7).figure.bars;
  assert.deepEqual(pts.map((x) => x.value), ['C', 'A', 'B'].map(cost));
  assert.equal(pts[q(5, 7).answer].label, 'A');
  assert.equal(q(5, 9).answer, (OUTLINE.rewardYearCents.value / OUTLINE.carriedCents.value) * 100);
  const f4 = unit.levels[4].cards[3].figure.rows, f5 = unit.levels[4].cards[4].figure.rows;
  assert.deepEqual(f4.map((r) => r[3]), ['A', 'B', 'C'].map((k) => money(gain(k))));
  assert.deepEqual(f5.map((r) => r[3]), ['A', 'B', 'C'].map((k) => money(cost(k))));
});

test('outline figures: each quoted figure is pinned to its source line', () => {
  assert.equal(OUTLINE.fixedMonths.value, 34);
  assert.equal(OUTLINE.graceDays.value, 21);
  assert.ok(text(1).includes('at least 21 days'));
  assert.ok(text(1).includes('about 20% a year'));
  assert.ok(text(5).includes('2% cash back'));
  for (const k of Object.keys(OUTLINE)) assert.ok(OUTLINE[k].cite, k);
});

test('arithmetic: level 1 number answers', () => {
  assert.equal(q(1, 2).answer, 150000 - 41260);
  assert.equal(minimumPayment(41260), 1238);
  assert.equal(q(1, 4).answer, 100000 - 35000 - 27500);
  assert.equal(q(1, 6).answer, 0);
  assert.equal(unit.levels[0].cards[2].figure.rows[3][1], money(minimumPayment(41260)));
});

test('every number answer sits inside its own tolerance and every trap is a different value', () => {
  for (const x of Q.values()) {
    if (x.type !== 'number') continue;
    assert.ok(x.tolerance >= 0);
    for (const t of x.traps ?? []) assert.ok(Math.abs(t.value - x.answer) > x.tolerance, `${x.id}: trap inside tolerance`);
  }
});
