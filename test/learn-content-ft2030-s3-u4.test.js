// Content check for the Learning Road unit "Funds and fees" (ft2030-s3-u4): every number answer and figure is recomputed year by year,
// every outline figure is checked against the table below (outline file and line), and every Exchange fact is read from modules/exchange/constants.js.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { FUNDS, STOCKS, MER_BP } from '../modules/exchange/constants.js';

const course = JSON.parse(fs.readFileSync(new URL('../modules/learn/content/fintech2030.json', import.meta.url), 'utf8'));
const unit = course.sections.flatMap((s) => s.units).find((u) => u.id === 'ft2030-s3-u4');
const Q = new Map(unit.levels.flatMap((l) => l.questions).map((q) => [q.id, q]));
const q = (id) => Q.get(`ft2030-s3-u4-${id}`);
const textOf = (l) => unit.levels[l - 1].cards.map((c) => c.text).join(' ');
const allText = JSON.stringify(unit);

// ---- independent arithmetic (rates in percent, a year at a time) ----
const compound = (startDollars, ratePct, years) => { let v = startDollars; for (let y = 0; y < years; y++) v = v * (1 + ratePct / 100); return v; };
const MARKET = 6, FEES = { A: 0.25, B: 1.0, C: 2.25 };
const keep = (f) => MARKET - FEES[f];
const shown = (v) => Math.round(v);
const finals = { none: shown(compound(10000, MARKET, 30)), A: shown(compound(10000, keep('A'), 30)), B: shown(compound(10000, keep('B'), 30)), C: shown(compound(10000, keep('C'), 30)) };
const m = (n) => `$${n.toLocaleString('en-CA')}`;
const m2 = (n) => `$${n.toLocaleString('en-CA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const cents = (d) => Math.round(d * 100);
const lost = (a, b) => Math.round(((a - b) / a) * 1000) / 10;

// ---- the outline figures this unit uses as the class example (outline file and line) ----
const L23 = 'claude_Fintech 2030 Lesson 23 - Thursday Oct 15.md';
const L26 = '2026-10-21 Lesson 26 (v3).md';
const OUTLINE = [
  { file: L23, line: 104, what: '$10,000 invested once, 30 years, market earns 6% a year, Fund C charges 2.25%', check: () => true },
  { file: L23, line: 118, what: 'Fund C keeps $30,175 against $57,435 with no fee; fees take 47.5%', check: () => finals.C === 30175 && finals.none === 57435 && lost(finals.none, finals.C) === 47.5 },
  { file: L23, line: 119, what: 'At 10 years Fund C loses 19.3%', check: () => lost(shown(compound(10000, MARKET, 10)), shown(compound(10000, keep('C'), 10))) === 19.3 },
  { file: L23, line: 120, what: 'At a 3% market Fund C nets 0.75% and ends at $12,513 against $24,273 with no fee', check: () => shown(compound(10000, 3 - FEES.C, 30)) === 12513 && shown(compound(10000, 3, 30)) === 24273 },
  { file: L23, line: 128, what: 'Fund A 0.25%, Fund B 1.00%, Fund C 2.25%; values $57,435 / $53,507 / $43,219 / $30,175', check: () => finals.A === 53507 && finals.B === 43219 },
  { file: L23, line: 132, what: 'Fund A against Fund C: $53,507 against $30,175, a gap of $23,332', check: () => finals.A - finals.C === 23332 },
  { file: L26, line: 124, what: 'A 6% fund minus a 2% fee is 4%, so 18 years instead of 12 (Rule of 72)', check: () => 72 / 6 === 12 && 72 / (6 - 2) === 18 },
];

test('shape: 4 levels, 4-6 cards, 7-10 questions, outcome codes, go buttons, no pictures yet', () => {
  assert.equal(unit.levels.length, 4);
  assert.deepEqual(unit.outcome_codes, ['FIN3080 1.17', 'FIN3080 1.18', 'FIN3080 4.4']);
  assert.equal(unit.title, 'Funds and fees');
  for (const l of unit.levels) { assert.ok(l.cards.length >= 4 && l.cards.length <= 6, l.id); assert.ok(l.questions.length >= 7 && l.questions.length <= 10, l.id); assert.equal(l.learn.length, 2); }
  assert.equal(unit.levels.flatMap((l) => l.cards).length, 24);
  assert.equal(Q.size, 39);
  const by = (t) => [...Q.values()].filter((x) => x.type === t).length;
  assert.deepEqual([by('choice'), by('number'), by('point')], [19, 17, 3]);
  assert.ok(!/"image"/.test(allText));
  assert.deepEqual(unit.levels[1].go, { building: 'exchange', label: 'Open the Exchange' });
  assert.deepEqual(unit.levels[3].go, { building: 'exchange', label: 'See the fund fees' });
  assert.equal(unit.levels[0].go, undefined); assert.equal(unit.levels[2].go, undefined);
  for (const l of unit.levels) { const pos = l.questions.filter((x) => x.type === 'choice').map((x) => x.answer); if (pos.length >= 4) assert.ok(new Set(pos).size >= 2, l.id); }
});

test('every outline figure matches its outline line and recomputes', () => {
  for (const o of OUTLINE) assert.ok(o.check(), `${o.file}:${o.line} ${o.what}`);
  // the outline's own dollar figures appear in the unit exactly as the outline prints them
  const t4 = textOf(4);
  for (const s of ['$30,175', '$57,435', '$53,507', '$43,219', '$12,513', '$24,273']) assert.ok(t4.includes(s) || allText.includes(s), s);
  assert.ok(t4.includes('18 years') && t4.includes('12 years') && t4.includes('Rule of 72'));
  // where this unit differs from the outline: the gap is not called what the fund company keeps, and the 3% share is not given
  assert.equal(finals.none - finals.C, 27260);
  assert.ok(!/fund company keeps|fee takers|keeps the difference/i.test(allText));
});

test('year-by-year growth: the cards, the table, the bars and the line', () => {
  const t4 = textOf(4);
  const c1 = compound(10000, keep('C'), 1), c2 = compound(10000, keep('C'), 2);
  assert.equal(m2(c1), '$10,375.00'); assert.equal(m2(c2), '$10,764.06');
  assert.ok(t4.includes(m2(c1)) && t4.includes(m2(c2)) && t4.includes('1.0375'));
  const cards = unit.levels[3].cards;
  const table = cards[1].figure;
  assert.deepEqual(table.columns, ['Year', 'No fee', 'Fund C']);
  assert.deepEqual(table.rows, [0, 5, 10, 15, 20, 25, 30].map((y) => [`Year ${y}`, m(shown(compound(10000, MARKET, y))), m(shown(compound(10000, keep('C'), y)))]));
  const bars = cards[2].figure;
  assert.equal(bars.unit, '$');
  assert.deepEqual(bars.bars.map((b) => b.value), [finals.none, finals.A, finals.B, finals.C].map((v) => v * 100));
  assert.ok(cards[2].text.includes(m(finals.none)) && cards[2].text.includes(m(finals.A)) && cards[2].text.includes(m(finals.B)) && cards[2].text.includes(m(finals.C)));
  assert.ok(cards[2].text.includes(m(finals.none - finals.C)) && cards[2].text.includes('47.5%'));
  assert.ok(cards[3].text.includes(m(shown(compound(10000, keep('C'), 10)))) && cards[3].text.includes(m(shown(compound(10000, MARKET, 10)))) && cards[3].text.includes('19.3%'));
  assert.ok(cards[4].text.includes('$12,513') && cards[4].text.includes('$24,273') && cards[4].text.includes('0.75%') && cards[4].text.includes('37.5%'));
  assert.equal(2.25 / 6 * 100, 37.5); assert.equal(2.25 / 3 * 100, 75);
  const line = q('l4-q10').figure;
  const years = [0, 5, 10, 15, 20, 25, 30];
  assert.deepEqual(line.points.map((p) => p.value), years.map((y) => shown(compound(10000, keep('C'), y)) * 100));
  const first = years.findIndex((y) => compound(10000, keep('C'), y) > 20000);
  assert.equal(q('l4-q10').answer, first); assert.equal(years[first], 20);
  assert.equal(q('l4-q3').answer, 3); assert.ok(finals.C < finals.B && finals.C < finals.A && finals.C < finals.none);
});

test('every number answer is recomputed', () => {
  const rebal = (() => { const up = Math.round(6000 * 1.1), total = up + 4000, target = total * 0.6; return { total, up, moved: up - target }; })();
  const want = {
    'l1-q6': cents(2400 / 80),
    'l1-q7': 0.6,
    'l1-q8': cents(600 * 0.3 - (600 / 50) * 0.3),   // to the cent: $176.40
    'l2-q8': cents(5000 * 0.6),
    'l2-q9': cents(rebal.moved),
    'l2-q10': cents(1600 / 40),
    'l3-q3': cents(4000 * 0.0175),
    'l3-q4': cents(10000 * (1.5 - 0.1) / 100),
    'l3-q5': 8 - 0.5,
    'l3-q6': 5 - 1,
    'l3-q10': cents(10000 * MER_BP.DAAG / 10000),
    'l4-q1': cents(compound(8000, 5, 1)),
    'l4-q2': cents(Math.round(compound(10000, keep('B'), 2) * 100) / 100),
    'l4-q4': cents(finals.A - finals.C),
    'l4-q5': lost(finals.none, finals.B),
    'l4-q6': lost(shown(compound(10000, MARKET, 20)), shown(compound(10000, keep('C'), 20))),
    'l4-q8': 2.25 / 5 * 100,
  };
  for (const [id, v] of Object.entries(want)) { assert.ok(q(id), id); assert.equal(q(id).type, 'number', id); assert.ok(Math.abs(q(id).answer - v) < 1e-9, `${id}: ${q(id).answer} vs ${v}`); }
  assert.equal(Object.keys(want).length, [...Q.values()].filter((x) => x.type === 'number').length);
  assert.equal(rebal.up, 6600); assert.equal(rebal.total, 10600); assert.ok(Math.abs(rebal.moved - 240) < 1e-9);
  // the percent answers must round the same from the exact amounts as from the dollars the student sees
  assert.equal(Math.round(((compound(10000, 6, 30) - compound(10000, keep('B'), 30)) / compound(10000, 6, 30)) * 1000) / 10, 24.8);
  assert.equal(Math.round(((compound(10000, 6, 20) - compound(10000, keep('C'), 20)) / compound(10000, 6, 20)) * 1000) / 10, 34.9);
  assert.equal(Math.round(((compound(10000, 6, 30) - compound(10000, keep('C'), 30)) / compound(10000, 6, 30)) * 1000) / 10, 47.5);
  assert.equal(Math.round(((compound(10000, 6, 10) - compound(10000, keep('C'), 10)) / compound(10000, 6, 10)) * 1000) / 10, 19.3);
  // Rule of 72 choices: the keyed option is 72 / 4 = 18
  const dbl = q('l4-q9'); assert.equal(dbl.options[dbl.answer].text, `About ${72 / (6 - 2)} years`);
  // dollars in prompts
  assert.ok(q('l3-q3').prompt.includes('1.75%') && q('l3-q3').prompt.includes('$4,000'));
  assert.equal(q('l4-q2').answer, 1102500); assert.ok(q('l4-q2').prompt.includes('$10,500.00'));
  assert.ok(q('l4-q5').prompt.includes(m(finals.none)));
  // no number question repeats an answer written on a card of its level
  for (const [i, l] of unit.levels.entries()) for (const x of l.questions.filter((y) => y.type === 'number')) {
    const shownAns = x.unit === '$' ? m2(x.answer / 100) : `${x.answer}%`;
    assert.ok(!textOf(i + 1).includes(shownAns), `${x.id} answer ${shownAns} is on a card`);
  }
});

test('the Exchange facts: three funds, their kinds, the MERs, the town stock', () => {
  assert.deepEqual(FUNDS.map((f) => f.ticker), ['DAAX', 'DAAB', 'DAAG']);
  assert.deepEqual(FUNDS.map((f) => f.type), ['equity', 'bond', 'blend']);
  assert.match(FUNDS[0].note, /Every company in town/);
  assert.deepEqual(FUNDS[2].blend, { DAAX: 60, DAAB: 40 });
  assert.deepEqual(MER_BP, { DAAX: 6, DAAB: 10, DAAG: 20 });
  const t3 = textOf(3);
  for (const [t, p] of [['DAAX', '0.06%'], ['DAAB', '0.10%'], ['DAAG', '0.20%']]) assert.ok(t3.includes(`${p} a year for ${t}`) || t3.includes(`${p} for ${t}`), t);
  assert.ok(textOf(2).includes('DAAX holds every company in town') && textOf(2).includes('DAAG is 60% DAAX and 40% DAAB') && textOf(2).includes('rebalanced every month') && textOf(2).includes('no money market fund'));
  assert.equal(FUNDS.some((f) => /money market/i.test(f.name + f.note)), false);
  const corn = STOCKS.find((s) => s.ticker === 'CORN');
  assert.equal(corn.name, 'Corner Mart'); assert.equal(corn.kind, 'stock');
  assert.equal(q('l1-q9').options[q('l1-q9').answer].text, 'CORN');
  assert.equal(q('l2-q6').options[q('l2-q6').answer].text, 'DAAG');
  assert.ok(textOf(1).includes('prices move once a world month'));
  const ui = fs.readFileSync(new URL('../modules/exchange/ui/exchange.js', import.meta.url), 'utf8');
  assert.ok(ui.includes("'Fund fee (MER)'"));   // the card line the unit names
  const cfg = JSON.parse(fs.readFileSync(new URL('../config/vdaa.json', import.meta.url), 'utf8'));
  assert.ok(cfg.courses.fintech2030.modules.includes('exchange'));
});

test('no real ticker, fund company, index or brand; no advice; no stray figures', () => {
  assert.ok(!/\b(XIU|XEQT|VFV|VAB|VGRO|XIC|XBB|VCN|iShares|Vanguard|BMO|BlackRock|Fidelity|TSX|S&P|Nasdaq|Dow|FP Canada|Cboe)\b/.test(allText));
  assert.ok(!/\byou should (buy|sell|hold)\b|\bwe recommend\b/i.test(allText));
  assert.ok(!/!/.test(allText));
  assert.ok(!/\bFIN3080 [0-9.]+\b.*INF2080/.test(allText) && !/INF2080/.test(allText));
  // a past return is not promised, and the fee is the number you can read ahead
  assert.ok(textOf(3).includes('does not promise'));
  for (const l of unit.levels) for (const x of l.questions) {
    assert.ok(x.hint && x.hint.length <= 240);
    if (x.type === 'choice') for (const o of x.options) assert.ok(o.why.length >= 10, x.id);
  }
});
