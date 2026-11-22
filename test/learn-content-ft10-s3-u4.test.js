// Content check for the Learning Road unit "Quick cash, real cost" (ft10-s3-u4): every number answer is recomputed, the game's emergency loan figures come
// from modules/housing/mortgage.js and the constants in modules/stress/index.js, every figure quoted from Mr. Tang's Lesson 23 outline is pinned to a cited line, and the shape is checked.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { schedule, payment } from '../modules/housing/mortgage.js';
import { HISA_BP } from '../modules/savings/constants.js';

const course = JSON.parse(fs.readFileSync(new URL('../modules/learn/content/fintech10.json', import.meta.url), 'utf8'));
const unit = course.sections.flatMap((s) => s.units).find((u) => u.id === 'ft10-s3-u4');
const Q = new Map(unit.levels.flatMap((l) => l.questions).map((q) => [q.id, q]));
const ALL = JSON.stringify(unit);
const OUT = 'slide-studio/courses/fintech10/context/claude-project/docs/claude_Lesson 23 Slide Outline Oct 14.md';
const OUT_FILE = `/Users/michaeltang/claude-workspace/${OUT}`;

// ---- the stress module keeps its constants private, so read them from the source line (the same file the game runs)
const src = fs.readFileSync(new URL('../modules/stress/index.js', import.meta.url), 'utf8');
const grab = (name) => Number(new RegExp(`\\b${name} = (\\d+)`).exec(src)?.[1]);
const G = { TERM: grab('TERM'), FEE: grab('FEE_CENTS'), FLOOR: grab('FLOOR_CENTS'), AUTO_AT: grab('AUTO_AT'), ASK_FROM: grab('ASK_FROM'), APR_BP: grab('APR_BP') };
const principalFor = (netCents, index = 1) => Math.round(Math.max(Math.round(G.FLOOR * index), netCents) / 100) * 100;   // modules/stress/index.js principalFor, at price index 1.00

// ---- figures from the outline: [value, cite line, text the line must contain]
const OUTLINE = {
  scenario: { value: [300, 14], line: 106, has: ['$300', '14 days'] },
  cap: { value: { per100: 15, dollars: 100 }, line: 144, has: ['$15 for every $100', 'maximum'] },
  payday300: { value: 4500, line: 144, has: ['forty-five dollars', 'three hundred', 'two weeks'] },
  fifteenPct: { value: 15, line: 144, has: ['15 percent in two weeks'] },
  yearly: { value: 390, line: 144, has: ['390 percent'] },
  yearlyNote: { value: [15, 26], line: 148, has: ['15% × 26 two-week periods = 390%', 'annualized comparison'] },
  exampleRates: { value: { cashAdvancePct: 23, feeCents: 500, locPct: 10 }, line: 148, has: ['23% plus a $5 fee', '10%'] },
  aboutOne: { value: 'about a dollar', line: 144, has: ['The line of credit is about a dollar'] },
  aboutEight: { value: 'about eight', line: 144, has: ['The cash advance is about eight'] },
  noCost: { value: 'A and B cost nothing', line: 144, has: ['A and B cost nothing'] },
  taskFive: { value: 500, line: 158, has: ['$500', '$15 per $100'] },
  answers8: { value: { fee: 7500, back: 57500, thirteen: 97500 }, line: 165, has: ['$75', '$575', '$975 (13 × $75)', 'almost double the original $500'] },
  payIn4: { value: { payments: 4, each: 3000, price: 12000 }, line: 177, has: ['Four payments of $30', '$120 hoodie', 'no interest'] },
  missed: { value: 'late fee, bounced payment, collections, return', line: 177, has: ['late fee', 'bounced', 'collections', 'credit score', 'returning the hoodie'] },
  noFee: { value: 'no late fee figure', line: 179, has: ['Providers set their own late fees'] },
  rule: { value: 'two checks', line: 190, has: ['Would I buy it if I had to pay all of it today? Can I cover every payment?'] },
  friend: { value: 'a parent or friend can cost the relationship', line: 134, has: ['A can cost something else, like the relationship', 'B only works if the shop takes cards'] },
  noLoc: { value: 'a line of credit may not be offered', line: 23, has: ['likely won\'t be offered a line of credit'] },
  capFlag: { value: 'verify the cap', line: 22, has: ['Check the Alberta payday cap'] },
};

test('outline: the quoted figures match the cited lines of the outline (skipped when the outline file is not on this machine)', (t) => {
  if (!fs.existsSync(OUT_FILE)) return t.skip(`outline not found: ${OUT}`);
  const lines = fs.readFileSync(OUT_FILE, 'utf8').split('\n');
  for (const [name, o] of Object.entries(OUTLINE)) for (const s of o.has) assert.ok(lines[o.line - 1].includes(s), `${name}: line ${o.line} of ${OUT} should contain "${s}"`);
});

test('shape: 4 levels, 4-6 cards, 7-10 questions, ids, outcome codes, one go button, no pictures yet', () => {
  assert.ok(unit, 'unit ft10-s3-u4 is in fintech10.json');
  assert.equal(unit.title, 'Quick cash, real cost');
  assert.equal(unit.blurb, 'Fast ways to borrow, ranked by what they cost.');
  assert.deepEqual(unit.outcome_codes, ['FIN1010 3.3', 'FIN1010 2.3']);
  assert.equal(unit.levels.length, 4);
  unit.levels.forEach((l, i) => {
    assert.equal(l.id, `ft10-s3-u4-l${i + 1}`);
    assert.ok(l.cards.length >= 4 && l.cards.length <= 6, `${l.id}: ${l.cards.length} cards`);
    assert.ok(l.questions.length >= 7 && l.questions.length <= 10, `${l.id}: ${l.questions.length} questions`);
    assert.ok(l.questions.filter((q) => q.type === 'number').length >= 2, `${l.id}: at least 2 number questions`);
    assert.ok(l.questions.some((q) => q.figure), `${l.id}: at least 1 question with a figure`);
    l.questions.forEach((q, k) => assert.equal(q.id, `${l.id}-q${k + 1}`));
  });
  assert.ok(!ALL.includes('"image"'), 'no image fields yet');
  assert.deepEqual(unit.levels[3].go, { building: 'networth', label: 'Open Net Worth' });
  assert.ok(unit.levels.every((l, i) => i === 3 || !l.go));
  assert.ok(!/replica|Slide Studio|\bAI\b|Claude/i.test(ALL), 'no tool is named');
  assert.ok(!/Pay in 4|Blooket|CBC|Queen/.test(ALL), 'no product or outside source is named');
});

test('arithmetic: every number answer is recomputed', () => {
  const day = 365;
  const partYear = (cents, pct, d) => Math.round((cents * pct * d) / (100 * day));
  const sch = schedule(100000, G.APR_BP, G.TERM);
  const paid = sch.reduce((t, r) => t + r.payment, 0);
  const fee = (loanDollars) => (loanDollars / 100) * OUTLINE.cap.value.per100 * 100;
  const want = {
    'ft10-s3-u4-l1-q7': Math.round(30000 * 0.1),
    'ft10-s3-u4-l1-q8': 40000 + Math.round(40000 * 0.15),
    'ft10-s3-u4-l2-q1': fee(200),
    'ft10-s3-u4-l2-q2': fee(500),
    'ft10-s3-u4-l2-q3': 50000 + fee(500),
    'ft10-s3-u4-l2-q4': (20 / 250) * 100,
    'ft10-s3-u4-l2-q5': ((fee(300) / 30000) * 100) * (52 / 2),
    'ft10-s3-u4-l2-q8': Math.round(30000 * 0.21),
    'ft10-s3-u4-l3-q4': partYear(30000, 10, 14),
    'ft10-s3-u4-l3-q5': partYear(30000, 23, 14) + 500,
    'ft10-s3-u4-l3-q6': 13 * fee(500),
    'ft10-s3-u4-l3-q7': 80000 / 4,
    'ft10-s3-u4-l3-q8': 3000 + 4500 + 2500 - 8000,
    'ft10-s3-u4-l4-q3': principalFor(138642),
    'ft10-s3-u4-l4-q5': paid - 100000,
    'ft10-s3-u4-l4-q6': 100000 + sch[0].interest + G.FEE,
  };
  for (const [id, v] of Object.entries(want)) {
    const q = Q.get(id);
    assert.ok(q && q.type === 'number', `${id} is a number question`);
    assert.equal(q.answer, v, `${id} answer`);
  }
  const numbers = [...Q.values()].filter((q) => q.type === 'number');
  assert.equal(numbers.length, Object.keys(want).length, 'every number question is checked');
  // the outline's own worked answers
  assert.equal(fee(500), OUTLINE.answers8.value.fee);
  assert.equal(50000 + fee(500), OUTLINE.answers8.value.back);
  assert.equal(13 * fee(500), OUTLINE.answers8.value.thirteen);
  assert.equal(fee(300), OUTLINE.payday300.value);
  assert.equal(fee(300) / 30000 * 100, OUTLINE.fifteenPct.value);
  assert.equal(OUTLINE.fifteenPct.value * OUTLINE.yearlyNote.value[1], OUTLINE.yearly.value);
  assert.equal(OUTLINE.payIn4.value.payments * OUTLINE.payIn4.value.each, OUTLINE.payIn4.value.price);
  // the 'about a dollar' and 'about eight' of the slide, against the recomputed 1.15 and 7.65
  assert.deepEqual([partYear(30000, 10, 14), partYear(30000, 23, 14) + 500], [115, 765]);
  // right answers in the tests that are choices or points
  assert.equal(Q.get('ft10-s3-u4-l4-q4').options[Q.get('ft10-s3-u4-l4-q4').answer].text, '$1,000');
  assert.equal(principalFor(64000), 100000);
  assert.equal(Q.get('ft10-s3-u4-l3-q3').answer, 3);   // the cash advance bar, second tallest
  const bars = Q.get('ft10-s3-u4-l3-q3').figure.bars.map((b) => b.value);
  assert.deepEqual(bars, [0, 0, 115, 765, 4500]);
  const rates = Q.get('ft10-s3-u4-l2-q10').figure.bars.map((b) => b.value);
  assert.deepEqual(rates, [390, 21, 312]);
  assert.equal(Q.get('ft10-s3-u4-l2-q10').answer, rates.indexOf(Math.max(...rates)));
});

test('the game: the emergency loan on the cards and in the table is what the code does', () => {
  assert.deepEqual([G.TERM, G.FEE, G.FLOOR, G.AUTO_AT, G.ASK_FROM, G.APR_BP], [12, 2500, 100000, 80, 50, 1999]);
  const sch = schedule(100000, G.APR_BP, G.TERM), pay = payment(100000, G.APR_BP, G.TERM);
  assert.equal(sch.length, 12);
  assert.equal(sch[0].payment, pay);
  const paid = sch.reduce((t, r) => t + r.payment, 0);
  const m = (c) => `$${(c / 100).toLocaleString('en-CA', { minimumFractionDigits: 2 })}`;
  const l4 = unit.levels[3];
  const table = l4.cards[2].figure.rows.map((r) => r.join('|'));
  assert.deepEqual(table, ['Loan|$1,000.00', 'Yearly rate|19.99%', 'Number of payments|12', `Monthly payment|${m(pay)}`, `Interest in month 1|${m(sch[0].interest)}`, `Paid back in all|${m(paid)}`]);
  assert.notEqual(sch[0].interest, Math.round((100000 * G.APR_BP) / 120000), 'the game does not use rate / 12, and the card says so');
  const text = (n) => l4.cards[n - 1].text;
  assert.ok(text(2).includes('50 or more') && text(2).includes('crosses 80') && text(2).includes('$1,000'));
  assert.ok(text(3).includes('19.99%') && text(3).includes('12 months'));
  assert.ok(text(4).includes('$25') && text(4).includes('10 points') && text(4).includes('one month longer'));
  // the module's own statements: a miss adds that month's interest and the fee, stress + 10, credit marks late, one month longer
  assert.match(src, /interest \+ FEE_CENTS/);
  assert.match(src, /loanMissed: 10/);
  assert.match(src, /missed_n = missed_n \+ 1/);
  assert.ok(fs.readFileSync(new URL('../modules/credit/index.js', import.meta.url), 'utf8').includes("'module.stress.payment'"), 'credit marks the loan payment');
  // the game's card has no cash advance, so the lesson never says the game does
  assert.ok(!/cash.?advance/i.test(fs.readFileSync(new URL('../modules/credit/index.js', import.meta.url), 'utf8')));
  assert.ok(!/game\W+s? cash advance|cash advance in the game/i.test(ALL));
  assert.equal(HISA_BP, 275);
  assert.ok(text(5).includes('2.75%'));
});

test('cards quote the outline figures the way the outline states them', () => {
  const t = (l) => unit.levels[l - 1].cards.map((c) => c.text).join(' ');
  assert.ok(t(2).includes('$15 for every $100') && t(2).includes('390%') && t(2).includes('26') && t(2).includes('$45'));
  assert.ok(t(3).includes('$120') && t(3).includes('4 x $30') && t(3).includes('$975') && t(3).includes('13 times') && t(3).includes('$575'));
  assert.ok(t(3).includes('no figure is given here'), 'no instalment late-fee figure');
  assert.ok(!/late fee of \$|\$\d+ late fee/.test(ALL), 'no invented late-fee amount');
});
