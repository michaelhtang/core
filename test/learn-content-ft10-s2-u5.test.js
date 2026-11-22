// Content check for the Learning Road unit "Stocks, funds and strategy" (ft10-s2-u5): Exchange facts and number answers are recomputed from
// modules/exchange (constants.js, orders.js), outline-derived claims are pinned to a cited table, every other number answer is recomputed from its prompt,
// and the shape of the unit is checked.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { STOCKS, FUNDS, SPREAD_BP, LIMIT_EXPIRY_MONTHS, DIVIDEND_MONTHS, PRICE_SCALE, UNIT } from '../modules/exchange/constants.js';
import { sides, costCents, proceedsCents, dividendCents } from '../modules/exchange/orders.js';
import { CATALOGUE } from '../modules/jobs/catalogue.js';

const course = JSON.parse(fs.readFileSync(new URL('../modules/learn/content/fintech10.json', import.meta.url), 'utf8'));
const unit = course.sections.flatMap((s) => s.units).find((u) => u.id === 'ft10-s2-u5');
const Q = new Map(unit.levels.flatMap((l) => l.questions).map((q) => [q.id, q]));
const text = (l) => unit.levels[l - 1].cards.map((c) => c.text).join(' ');
const all = JSON.stringify(unit);
const c = (d) => Math.round(d * 100);
const micro = (d) => Math.round(d * 100) * PRICE_SCALE;      // dollars -> micro-cents
const ans = (id) => Q.get(`ft10-s2-u5-${id}`).answer;
const r1 = (x) => Math.round(x * 10) / 10;

// What the lessons take from Mr. Tang's outlines (slide-studio/courses/fintech10/context/claude-project/docs/). Ideas only: no dollar figure of the outlines is used.
const OUTLINE = {
  ticker: 'Lesson 13 outline lines 104-107 (public company; ticker symbol; a brand is not always the company)',
  quote: 'Lesson 13 outline lines 127-130 (reading a quote: high and low, dividend)',
  charts: 'Lesson 17 outline lines 72-82 (look at more than one timeframe; is a price cheap or expensive against its own 52-week range)',
  threeQuestions: 'Lesson 21 outline lines 72-112 (profit, growth, price against profit), taught there with made-up companies',
  goal: 'Lesson 13 outline lines 5 and 148 (the three elements of a goal; pick two, ban one) and Lesson 34 outline line 11',
  watchlist: 'Lesson 13 outline line 198 (a "we would sell if" line needs a number or an event, not "if it goes down")',
  ranking: 'Lesson 14 outline lines 68-71 (ranking or strategy), 75-80 (two strategies as an experiment) and 151-153 (record the start)',
  loan: 'Lesson 14 outline lines 192-193 (borrowing makes gains and losses bigger; the interest is owed either way)',
  funds: 'Lesson 18 outline lines 87-89 (one purchase that holds many companies)',
};
// Dollar figures that appear in those outlines and must NOT be used here (they belong to an outside program or class example).
const FORBIDDEN = ['$25 fee', '$25 per', '$462', '$87.40', '$18.48', '$27.37', 'XIU', 'VFV', 'MPLC', 'Polar Pizza', 'Rocket Rides', 'Moonshot', 'Google', 'TSX', 'NASDAQ', 'NYSE', 'STAX', 'JA '];

test('shape: 8 levels, 4-6 cards, 7-10 questions, ids, outcome codes, one go button, no pictures yet', () => {
  assert.ok(unit, 'unit ft10-s2-u5 is in fintech10.json');
  assert.equal(unit.title, 'Stocks, funds and strategy');
  assert.equal(unit.blurb, 'Read a stock, read a chart, set a goal and stick to a rule.');
  assert.deepEqual(unit.outcome_codes, ['FIN1010 3.8.3', 'FIN1010 3.6', 'FIN1010 4.1']);
  assert.equal(unit.levels.length, 8);
  unit.levels.forEach((l, i) => {
    assert.equal(l.id, `ft10-s2-u5-l${i + 1}`);
    assert.ok(l.cards.length >= 4 && l.cards.length <= 6, `${l.id}: ${l.cards.length} cards`);
    assert.ok(l.questions.length >= 7 && l.questions.length <= 10, `${l.id}: ${l.questions.length} questions`);
    assert.ok(l.questions.filter((q) => q.type === 'number').length >= 2, `${l.id}: at least 2 number questions`);
    assert.ok(l.questions.some((q) => q.figure || q.type === 'point'), `${l.id}: at least 1 question with a figure`);
    l.questions.forEach((q, k) => assert.equal(q.id, `${l.id}-q${k + 1}`));
  });
  assert.deepEqual(unit.levels[7].go, { building: 'exchange', label: 'Open the Exchange' });
  assert.ok(unit.levels.every((l, i) => i === 7 || !l.go));
  assert.ok(!all.includes('"image"'), 'no image fields until the pictures are made');
});

test('outline ideas only: no outside program, company, ticker or dollar figure is used; the outline term for a fund appears once', () => {
  assert.ok(Object.keys(OUTLINE).length === 9);
  for (const f of FORBIDDEN) assert.ok(!all.includes(f), `"${f}" must not appear`);
  assert.equal((all.match(/\bETF\b/g) ?? []).length, 1, 'ETF is mentioned once');
  assert.ok(!/!/.test(all), 'no exclamation marks');
});

test('the Exchange: tickers, sectors, yields, spreads, limit expiry and dividend months come from modules/exchange', () => {
  // level 1: the town companies are the Job Centre employers, and the table lists every one
  const employers = new Set(CATALOGUE.map((x) => x.employer));
  assert.equal(STOCKS.length, 8);
  assert.ok(STOCKS.every((s) => employers.has(s.name)), 'every town company is named after a Job Centre employer');
  assert.ok(employers.has('Corner Mart'));
  assert.deepEqual(unit.levels[0].cards[5].figure.rows, STOCKS.map((s) => [s.ticker, s.name, s.sector]));
  assert.deepEqual(Q.get('ft10-s2-u5-l1-q8').figure.rows, STOCKS.map((s) => [s.ticker, s.name, s.sector]));
  const corner = STOCKS.find((s) => s.name === 'Corner Mart');
  const q8 = Q.get('ft10-s2-u5-l1-q8');
  assert.equal(q8.options[q8.answer].text, corner.ticker);
  assert.deepEqual(FUNDS.map((f) => f.ticker), ['DAAX', 'DAAB', 'DAAG']);
  assert.equal(FUNDS.length, 3);
  const own = Q.get('ft10-s2-u5-l2-q9');
  assert.equal(own.options[own.answer].text, STOCKS.find((x) => x.ticker === 'SPRK').name);
  // level 2: the yields bars are the starting yields in constants
  const bars = Q.get('ft10-s2-u5-l2-q10').figure.bars;
  assert.deepEqual(bars.map((b) => b.label), ['AGRA', 'BEAC', 'CORN', 'MAPL', 'SPRK']);
  assert.deepEqual(bars.map((b) => b.value), bars.map((b) => STOCKS.find((s) => s.ticker === b.label).yieldBp / 100));
  assert.equal(bars[Q.get('ft10-s2-u5-l2-q10').answer].label, 'CORN');
  assert.equal(Math.max(...bars.map((b) => b.value)), STOCKS.find((s) => s.ticker === 'CORN').yieldBp / 100);
  // level 5: spreads, ask and bid of the $40.00 example, limit expiry and dividend months
  assert.equal(SPREAD_BP.stock, 100);
  assert.equal(SPREAD_BP.fund, 20);
  const ex = sides(micro(40), SPREAD_BP.stock);
  assert.equal(ex.ask, micro(40.2));
  assert.equal(ex.bid, micro(39.8));
  assert.ok(text(5).includes('1% for a company and 0.2% for a fund'));
  assert.ok(text(5).includes('$40.20') && text(5).includes('$39.80') && text(5).includes('$402.00') && text(5).includes('$398.00'));
  assert.equal(costCents(10 * UNIT, ex.ask), 40200);
  assert.equal(proceedsCents(10 * UNIT, ex.bid), 39800);
  assert.equal(LIMIT_EXPIRY_MONTHS, 3);
  assert.ok(text(5).includes(`${LIMIT_EXPIRY_MONTHS} world months`));
  assert.deepEqual(DIVIDEND_MONTHS, [3, 6, 9, 12]);
  assert.ok(text(5).includes('months 3, 6, 9 and 12'));
  const bar5 = Q.get('ft10-s2-u5-l5-q9').figure.bars;
  assert.deepEqual(bar5.map((b) => b.value), [c(1000 * SPREAD_BP.fund / 10000), c(1000 * SPREAD_BP.stock / 10000)]);
  assert.equal(Q.get('ft10-s2-u5-l5-q9').answer, 1);
  // level 8: Jun's watchlist uses the notes and yields in constants
  const rows = unit.levels[7].cards[4].figure.rows;
  for (const [ticker, sector, reason] of rows) {
    const s = STOCKS.find((x) => x.ticker === ticker);
    assert.equal(sector, s.sector);
    assert.ok(reason.includes(`${s.yieldBp / 100}%`), `${ticker}: yield in the reason`);
  }
  assert.ok(new Set(rows.map((r) => r[1])).size === rows.length, 'three different sectors');
  assert.equal(STOCKS.find((s) => s.ticker === 'CORN').note.includes('moves less'), true);
  assert.equal(STOCKS.find((s) => s.ticker === 'BEAC').yieldBp, 300);   // the 3.0% yield in l8-q6
});

test('game arithmetic: costs and dividends are recomputed with modules/exchange/orders.js', () => {
  assert.equal(ans('l5-q3'), costCents(15 * UNIT, micro(20.1)));                                           // ask and bid 1% apart around $20.00, the game's company spread
  assert.equal(ans('l5-q4'), costCents(15 * UNIT, micro(20.1)) - proceedsCents(15 * UNIT, micro(19.9)));
  assert.equal(ans('l2-q6'), costCents(6 * UNIT, micro(20.5)));
  assert.equal(ans('l2-q8'), dividendCents(30 * UNIT, micro(60), 200));   // 2% a year on $60.00, a quarter paid, 30 shares
  assert.equal(ans('l2-q8'), 900);
  assert.equal(dividendCents(1 * UNIT, micro(50), 400), 50);              // the card's example: $50.00 at 4% pays $0.50 a quarter
  assert.ok(text(2).includes('$2.00 a year') && text(2).includes('$0.50 each quarter'));
});

test('arithmetic: every other number answer is recomputed from its prompt', () => {
  const P = [20, 23, 26, 30, 33, 31, 29, 27];
  const pc = (a, b) => ((b - a) / a) * 100;
  const want = {
    'l1-q5': (50 / 2000) * 100, 'l1-q6': c(90000 / 3000), 'l1-q7': c((50000 / 1000) * 20),
    'l2-q4': pc(60, 63), 'l2-q5': -pc(25, 24), 'l2-q7': c(80 * 0.03),
    'l3-q3': pc(P[0], P[7]), 'l3-q4': r1(-pc(P[4], P[7])), 'l3-q5': r1(pc(P[1], P[3])),
    'l4-q2': c(4000 * 12.5), 'l4-q4': pc(8, 10), 'l4-q5': ((54 - 40) / (60 - 40)) * 100, 'l4-q9': c(60 / 4),
    'l5-q6': c(5000 * 0.002), 'l5-q7': c(3000 * 0.005), 'l6-q9': (1200 / 2400) * 100,
    'l6-q5': c(2700 / 18), 'l6-q6': c(3000 - 75 * 36),
    'l7-q3': r1(pc(10300, 11000)), 'l7-q6': pc(4000, 4160), 'l7-q8': c(4 * 0.01 * 2500),
    'l8-q3': c((2000 + 2000) * 0.1), 'l8-q4': c(2000 * 0.05), 'l8-q5': c((2000 + 2000) * 0.9 - 2000 - 2000 * 0.05),
  };
  for (const [id, v] of Object.entries(want)) assert.ok(Math.abs(ans(id) - v) < 1e-6, `${id}: ${ans(id)} vs ${v}`);
  // tolerances: a right answer rounded as the prompt says is accepted, every listed trap is not
  for (const q of Q.values()) if (q.type === 'number') for (const t of q.traps ?? []) assert.ok(Math.abs(t.value - q.answer) > q.tolerance, `${q.id}: trap ${t.value} would be accepted`);
  // percent answers that are not whole numbers say how to round
  for (const id of ['l3-q4', 'l3-q5', 'l7-q3']) assert.ok(/one decimal place/.test(Q.get(`ft10-s2-u5-${id}`).prompt), id);
  // the chart levels: the eight prices and the card's two percentages
  const f = unit.levels[2].cards[1].figure.points;
  assert.deepEqual(f.map((p) => p.value), P.map(c));
  assert.deepEqual(unit.levels[2].cards[2].figure.points.map((p) => p.value), P.slice(4).map(c));
  assert.ok(text(3).includes(`${r1(pc(23, 33))}%`) && text(3).includes(`${r1(-pc(31, 27))}%`));
  assert.equal(Q.get('ft10-s2-u5-l3-q1').answer, P.indexOf(Math.max(...P)));
  assert.equal(Q.get('ft10-s2-u5-l3-q2').answer, P.findIndex((v, i) => i > 0 && v < P[i - 1]));
  // level 4 card figures and the question's worths
  assert.deepEqual(unit.levels[3].cards[0].figure.rows.map((r) => r[3]), ['$100,000.00', '$50,000.00']);
  const q3 = Q.get('ft10-s2-u5-l4-q3');
  assert.equal(q3.options[q3.answer].text, 'Ridge Co., 3,000 shares at $40.00');
  assert.ok(3000 * 40 > 10000 * 9);
  const pe = Q.get('ft10-s2-u5-l4-q10');
  assert.deepEqual(pe.figure.bars.map((b) => b.value), [12, 45, 18, 30].map(c));
  assert.equal(pe.answer, 1);
  assert.ok(text(4).includes('P/E of 15') && 60 / 4 === 15);
  // level 6: Noor, Eli and Zara
  assert.ok(2400 / 24 === 100 && 100 * 60 === 6000);
  const z = Q.get('ft10-s2-u5-l6-q10');
  assert.deepEqual(z.figure.points.map((p) => p.value), [1, 2, 3, 4, 5, 6].map((n) => c(100 * n)));
  assert.equal(z.answer, z.figure.points.findIndex((p) => p.value === c(400)));
  // level 7: Kai's number on the card, the experiment table and Plan A's weekly values
  assert.ok(text(7).includes(`${r1(pc(10500, 12000))}%`));
  assert.deepEqual(unit.levels[6].cards[3].figure.rows.map((r) => [r[2], r[3]]), [['$5,000.00', '$5,150.00'], ['$5,000.00', '$4,900.00']]);
  const wk = Q.get('ft10-s2-u5-l7-q9');
  assert.equal(wk.answer, wk.figure.points.findIndex((p) => p.value === Math.min(...wk.figure.points.map((x) => x.value))));
  // level 8: Mia's table
  const t = unit.levels[7].cards[1].figure.rows;
  const own = 1000, loan = 1000, interest = loan * 0.08, inv = own + loan;
  assert.deepEqual(t.map((r) => r[1]), ['+$100.00', '$0.00', '+$100.00', '-$100.00', '-$100.00']);
  assert.deepEqual(t.map((r) => r[2]), [`+$${inv * 0.1}.00`, `-$${interest}.00`, `+$${inv * 0.1 - interest}.00`, `-$${inv * 0.1}.00`, `-$${inv * 0.1 + interest}.00`]);
  assert.ok(text(8).includes(`$${inv * 0.9 - loan - interest}.00 of her own`));
  const ben = Q.get('ft10-s2-u5-l8-q5').figure.bars;
  assert.deepEqual(ben.map((b) => b.value), [c(3600), c(2100)]);
});

test('questions: every choice has one keyed option with a why on each, every number has hint, miss and working', () => {
  for (const q of Q.values()) {
    assert.ok(q.hint && q.hint.length <= 240, `${q.id}: hint`);
    if (q.type === 'choice') { assert.ok(q.options.length >= 3 && q.options.length <= 4); q.options.forEach((o) => assert.ok(o.why)); }
    if (q.type === 'number') { assert.ok(q.miss && q.working && q.why, q.id); assert.ok(!q.miss.includes(String(q.answer / (q.unit === '$' ? 100 : 1))) || q.answer === 0, `${q.id}: miss does not hand over the answer`); }
    if (q.type === 'point') assert.ok(q.miss && q.why, q.id);
  }
});
