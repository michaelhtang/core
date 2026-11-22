// Content check for the Learning Road unit "What lenders look for" (ft10-s3-u1): every number answer is recomputed, every game figure comes from
// modules/credit, every figure quoted from Mr. Tang's Lesson 15 outline is pinned to a cited line, and the shape is checked.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { computeScore, decideCard } from '../modules/credit/score.js';
import { WEIGHTS, SCORE_MIN, SCORE_MAX, UTILIZATION_CURVE, limitPct, LIMIT, SCORE_DECLINE_BELOW, MAX_INQUIRIES, PAYMENT, INQUIRY_WINDOW, LENGTH_FULL_MONTHS } from '../modules/credit/constants.js';

const course = JSON.parse(fs.readFileSync(new URL('../modules/learn/content/fintech10.json', import.meta.url), 'utf8'));
const unit = course.sections.flatMap((s) => s.units).find((u) => u.id === 'ft10-s3-u1');
const Q = new Map(unit.levels.flatMap((l) => l.questions).map((q) => [q.id, q]));
const text = (l) => unit.levels[l - 1].cards.map((c) => c.text).join(' ');
const OUT = 'slide-studio/courses/fintech10/context/claude-project/docs/claude_Lesson 15 Slide Outline Sept 29.md';
const interest = (cents, rate) => Math.round(cents * rate);

// Figures quoted from the outline (the lesson quotes them as the class's example, REVIEW items 1 to 5).
const OUTLINE = {
  range: { value: [300, 900], cite: `${OUT} lines 199 and 278 ("300 to 900")` },
  rates: { value: [6, 12, 20], cite: `${OUT} line 132 ("lend at 6%, 12%, 20%, or Deny")` },
  biggest: { value: 'paying on time', cite: `${OUT} line 199 ("The biggest box is the first one: paying on time.")` },
  notInScore: { value: ['income', 'job', 'age'], cite: `${OUT} line 197 ("Income, job, age")` },
};

test('shape: 5 levels, 4-6 cards, 7-10 questions, ids, outcome codes, one go button, no pictures yet', () => {
  assert.ok(unit, 'unit ft10-s3-u1 is in fintech10.json');
  assert.equal(unit.title, 'What lenders look for');
  assert.equal(unit.blurb, 'Think like the lender: who gets a loan, and what a credit history shows.');
  assert.deepEqual(unit.outcome_codes, ['FIN1010 3.3', 'FIN1010 3.1']);
  assert.equal(unit.levels.length, 5);
  unit.levels.forEach((l, i) => {
    assert.equal(l.id, `ft10-s3-u1-l${i + 1}`);
    assert.ok(l.cards.length >= 4 && l.cards.length <= 6, `${l.id}: ${l.cards.length} cards`);
    assert.ok(l.questions.length >= 7 && l.questions.length <= 10, `${l.id}: ${l.questions.length} questions`);
    assert.ok(l.questions.filter((q) => q.type === 'number').length >= 2, `${l.id}: at least 2 number questions`);
    assert.ok(l.questions.some((q) => q.figure), `${l.id}: at least 1 question with a figure`);
    l.questions.forEach((q, k) => assert.equal(q.id, `${l.id}-q${k + 1}`));
  });
  assert.ok(!JSON.stringify(unit).includes('"image"'), 'no image fields yet');
  assert.deepEqual(unit.levels[4].go, { building: 'credit', label: 'Open the Credit Bureau' });
  assert.ok(unit.levels.every((l, i) => i === 4 || !l.go));
  assert.ok(!/Equifax|TransUnion|Hardbacon|ClearScore|FICO/i.test(JSON.stringify(unit)), 'no real bureau or product is named');
  assert.ok(!/replica|Slide Studio|\bAI\b|Claude/i.test(JSON.stringify(unit)), 'no tool is named');
});

test('arithmetic: every number answer is recomputed from its prompt or from the game', () => {
  const pct = (a, b) => (a / b) * 100;
  const limitOf = (avg, score) => decideCard({ avgGrossCents: avg * 100, score, inquiries12: 0 }).limitCents;
  const want = {
    'ft10-s3-u1-l1-q3': interest(150000, 0.08),
    'ft10-s3-u1-l1-q4': 240000 + interest(240000, 0.05),
    'ft10-s3-u1-l1-q8': pct(1100 - 1000, 1000),
    'ft10-s3-u1-l2-q2': pct(240, 4800),
    'ft10-s3-u1-l2-q3': pct(180, 900),
    'ft10-s3-u1-l2-q7': 90000 - 18000,
    'ft10-s3-u1-l2-q8': interest(300000, 0.06),
    'ft10-s3-u1-l3-q5': interest(200000, 0.2) - interest(200000, 0.06),
    'ft10-s3-u1-l3-q7': pct(180, 3600),
    'ft10-s3-u1-l4-q7': pct(150, 1500),
    'ft10-s3-u1-l4-q9': Math.round(200000 * 0.3),
    'ft10-s3-u1-l5-q3': pct(600, 1500),
    'ft10-s3-u1-l5-q4': UTILIZATION_CURVE.find(([u]) => u === 0.75)[1] * 100,
    'ft10-s3-u1-l5-q5': limitOf(2150, 680),          // the game's own decision: 2150 x 65% = 1397.50, rounded down to 1300
    'ft10-s3-u1-l5-q6': limitOf(3000, 800),          // 3000 x 100% = 3000, capped at 2500
  };
  const numbers = [...Q.values()].filter((q) => q.type === 'number').map((q) => q.id);
  assert.deepEqual(Object.keys(want).sort(), numbers.sort(), 'every number question is covered by this test');
  for (const [id, v] of Object.entries(want)) assert.ok(Math.abs(Q.get(id).answer - v) < 1e-6, `${id}: stored ${Q.get(id).answer}, recomputed ${v}`);
  assert.equal(Q.get('ft10-s3-u1-l5-q5').answer, 130000);
  assert.equal(Q.get('ft10-s3-u1-l5-q6').answer, 250000);
  // the 2,150 case is not on a $100 boundary, so float noise cannot change the floor
  assert.ok(Math.abs(215000 * limitPct(680) - 139750) < 1e-6);
});

test('traps: each trap value is the result of the mistake its why names', () => {
  const trap = (id) => Q.get(id).traps.map((t) => t.value);
  assert.deepEqual(trap('ft10-s3-u1-l1-q3'), [Math.round(150000 * 0.008)]);
  assert.deepEqual(trap('ft10-s3-u1-l1-q4'), [interest(240000, 0.05)]);
  assert.deepEqual(trap('ft10-s3-u1-l2-q2'), [4800 / 240]);
  assert.deepEqual(trap('ft10-s3-u1-l2-q3'), [100 - 20]);
  assert.deepEqual(trap('ft10-s3-u1-l2-q7'), [90000 + 18000]);
  assert.deepEqual(trap('ft10-s3-u1-l3-q5'), [interest(200000, 0.2)]);
  assert.deepEqual(trap('ft10-s3-u1-l4-q7'), [100 - 10]);
  assert.deepEqual(trap('ft10-s3-u1-l4-q9'), [200000 - 60000]);
  assert.deepEqual(trap('ft10-s3-u1-l5-q3'), [100 - 40]);
  assert.deepEqual(trap('ft10-s3-u1-l5-q4'), [75]);
  assert.deepEqual(trap('ft10-s3-u1-l5-q5'), [215000]);
  assert.deepEqual(trap('ft10-s3-u1-l5-q6'), [300000]);
});

test('tables and bars: every figure value equals the recomputed one', () => {
  const m = (c) => `$${(c / 100).toLocaleString('en-CA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const d0 = (n) => `$${n.toLocaleString('en-CA')}`;
  unit.levels[0].cards[2].figure.rows.forEach(([p, r, i, t]) => {
    const prin = Number(p.replace(/[$,]/g, '')) * 100, rate = Number.parseInt(r, 10) / 100;
    assert.equal(i, m(interest(prin, rate)));
    assert.equal(t, m(prin + interest(prin, rate)));
  });
  assert.deepEqual(Q.get('ft10-s3-u1-l2-q6').figure.bars.map((b) => b.value), [216 / 36, 180 / 9, 300 / 12, 240 / 48]);
  // level 1 q6: the winner is Omar
  const loans = { Ravi: [400000, 0.04], Tess: [200000, 0.1], Omar: [120000, 0.2] };
  const paid = Object.entries(loans).map(([n, [p, r]]) => [n, interest(p, r)]).sort((a, b) => b[1] - a[1]);
  assert.equal(paid[0][0], 'Omar');
  assert.equal(Q.get('ft10-s3-u1-l1-q6').options[Q.get('ft10-s3-u1-l1-q6').answer].text, 'Omar');
  // level 2 point answer is the biggest bar
  const bars = Q.get('ft10-s3-u1-l2-q6').figure.bars.map((b) => b.value);
  assert.equal(Q.get('ft10-s3-u1-l2-q6').answer, bars.indexOf(Math.max(...bars)));
  // level 5 tables come from the game's constants
  const W = unit.levels[4].cards[1].figure.rows;
  assert.deepEqual(W.map((r) => r[1]), ['payment', 'utilization', 'length', 'new', 'mix'].map((k) => `${Math.round(WEIGHTS[k] * 100)}%`));
  assert.deepEqual(W.map((r) => r[2]), ['payment', 'utilization', 'length', 'new', 'mix'].map((k) => String(Math.round(WEIGHTS[k] * (SCORE_MAX - SCORE_MIN)))));
  assert.equal(W.reduce((s, r) => s + Number(r[2]), 0), SCORE_MAX - SCORE_MIN);
  const U = unit.levels[4].cards[3].figure.rows;
  assert.deepEqual(U, UTILIZATION_CURVE.slice(1).map(([u, f]) => [u === 0.1 ? 'Up to 10%' : `${Math.round(u * 100)}%`, `${Math.round(f * 100)}%`]));
  const L = unit.levels[4].cards[5].figure.rows;
  assert.deepEqual(L, [560, 620, 680, 740, 800].map((s) => [String(s), `${+(limitPct(s) * 100).toFixed(1)}%`]));
  assert.deepEqual(L.map((r) => r[1]), ['30%', '47.5%', '65%', '82.5%', '100%']);
  void d0;
});

test('game: the level 5 cards state the credit module\'s own constants', () => {
  const t = text(5);
  assert.ok(t.includes(`${SCORE_MIN} to ${SCORE_MAX}`));
  assert.ok(t.includes(`${PAYMENT.thin * 100}%`) && t.includes(`${PAYMENT.buildPerMonth * 100}%`) && t.includes(`${PAYMENT.latePenalty * 100}%`) && t.includes(`${PAYMENT.decayMonths} game months`));
  assert.ok(t.includes(`${LENGTH_FULL_MONTHS} months`) && t.includes(`last ${INQUIRY_WINDOW} months`));
  assert.ok(t.includes(`last ${LIMIT.windowMonths} months`) && t.includes('$1,000 a month') && LIMIT.minAvgGrossCents === 100000);
  assert.ok(t.includes(`at least ${SCORE_DECLINE_BELOW}`) && t.includes(`fewer than ${MAX_INQUIRIES} applications`));
  assert.ok(t.includes('$500') && t.includes('$2,500') && LIMIT.minCents === 50000 && LIMIT.maxCents === 250000 && LIMIT.stepCents === 10000);
  assert.ok(t.includes('180 points'));
  assert.equal(Math.round(WEIGHTS.utilization * (SCORE_MAX - SCORE_MIN)), 180);
});

test('game: level 5 q7 (who is declined) and q8 (Dev and Rae) follow decideCard and computeScore', () => {
  const rows = unit.levels[4].questions[6].figure.rows;
  const results = rows.map(([name, avg, score, apps]) => [name, decideCard({ avgGrossCents: Number(avg.replace(/[$,]/g, '')) * 100, score: Number(score), inquiries12: Number(apps) }).approved]);
  assert.deepEqual(results.filter(([, ok]) => !ok).map(([n]) => n), ['Bea']);
  const q7 = Q.get('ft10-s3-u1-l5-q7');
  assert.equal(q7.options[q7.answer].text, 'Bea');
  const game = (owed) => computeScore({ month: 4, file: { openedMonth: 0, inquiryMonths: [0], products: 1 }, history: [1, 2, 3, 4].map((month) => ({ month, outcome: 'ontime', n: 1 })), card: { owedCents: owed, limitCents: 100000 } }).score;
  const dev = game(10000), rae = game(90000);
  assert.ok(dev > rae, `Dev ${dev} should beat Rae ${rae}`);
  const q8 = Q.get('ft10-s3-u1-l5-q8');
  assert.equal(q8.options[q8.answer].text, 'Dev');
  // pay is not a factor of the score: the five factors are the five weights
  assert.deepEqual(Object.keys(WEIGHTS).sort(), ['length', 'mix', 'new', 'payment', 'utilization']);
  assert.equal(computeScore({ month: 1, file: null }), null, 'no file, no score');
});

test('outline figures: quoted as written', () => {
  assert.deepEqual(OUTLINE.range.value, [SCORE_MIN, SCORE_MAX], 'the outline range is the game range too');
  assert.ok(text(4).includes('300 to 900'));
  assert.ok(text(3).includes(OUTLINE.rates.value.map((r, i, a) => (i === a.length - 1 ? `and ${r}%` : `${r}%`)).join(', ').replace('%, and', '% and')));
  assert.ok(text(4).includes(`${OUTLINE.biggest.value[0].toUpperCase()}${OUTLINE.biggest.value.slice(1)} is the biggest of the five`));
  assert.ok(text(4).includes('Your income, your job and your age are not in the score'));
  assert.ok(Object.values(OUTLINE).every((o) => o.cite.includes('Lesson 15')));
  // the class rates are used only as example rates in the level 3 what-if (6% and 20%)
  assert.equal(Q.get('ft10-s3-u1-l3-q5').answer, interest(200000, 0.2) - interest(200000, 0.06));
});
