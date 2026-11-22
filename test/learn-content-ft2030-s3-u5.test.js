// Content check for the Learning Road unit "Diversification and the mix" (ft2030-s3-u5): every number answer is recomputed here
// (from the formulas, and from modules/exchange/constants.js for the game's Balanced fund) and every figure quoted from Mr. Tang's outlines is pinned to its file and line.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { FUNDS } from '../modules/exchange/constants.js';

const course = JSON.parse(fs.readFileSync(new URL('../modules/learn/content/fintech2030.json', import.meta.url), 'utf8'));
const unit = course.sections.flatMap((s) => s.units).find((u) => u.id === 'ft2030-s3-u5');
const cfg = JSON.parse(fs.readFileSync(new URL('../config/vdaa.json', import.meta.url), 'utf8'));
const Q = new Map(unit.levels.flatMap((l) => l.questions).map((q) => [q.id, q]));
const cards = (l) => unit.levels[l - 1].cards;
const text = (l) => cards(l).map((c) => c.text).join(' ');
const near = (a, b) => Math.abs(a - b) < 1e-9;

// Outline figures, all in /Users/michaeltang/claude-workspace/slide-studio/courses/fintech2030/context/outlines/ (made-up teaching numbers in the outlines themselves)
const OUTLINE = {
  // 2026-10-20 Lesson 25.md, line 88 (Q1: 20 companies, one bankrupt), line 90 (Q2: 50 Canadian, Canada falls 20%), line 274 (image manifest: loss by number of companies and by % in Canada, $10,000 equal amounts)
  l25_byCount: { 1: 10000, 5: 2000, 10: 1000, 20: 500, 50: 200 },
  l25_byCanada: { 100: 2000, 60: 1200, 30: 600, 0: 0 },
  // 2026-10-26 Lesson 29 (v2).md, lines 154-157 (two jars: $8,000 at 8%, $2,000 at 3%, $640 + $60 = $700, 7%) and line 496 (exit slip: 80% at 8% and 20% at 4% is 7.2%)
  l29_jars: { stocks: 8000, stocksRate: 8, cash: 2000, cashRate: 3, earned: 700, rate: 7, notMiddle: 5.5 },
  l29_exit: { w: 80, r1: 8, r2: 4, blended: 7.2 },
  // 2026-10-27 Lesson 30 (v5).md, lines 114-115 (Investor A 80/20, C 30/70, $100,000), line 129 (stocks -30%, GICs and bonds 0%), lines 135-141 (bars 30, 24, 15, 9, 0), lines 307-311 (A: $56,000 + $20,000 = $76,000, 24%; 50%: 15%; 30%: 9%; D24:D29 30, 24, 18, 15, 9, 0)
  l30: { total: 100000, a: 80, c: 30, crash: 30, aAfter: 76000, aStocks: 56000, aFall: 24, cFall: 9, halfFall: 15, row: [30, 24, 18, 15, 9, 0] },
};

test('shape: 5 levels, 4-6 cards, 7-10 questions, outcome codes, no pictures, one go button', () => {
  assert.equal(unit.id, 'ft2030-s3-u5');
  assert.equal(unit.title, 'Diversification and the mix');
  assert.deepEqual(unit.outcome_codes, ['FIN3080 1.21', 'FIN3080 1.22', 'FIN3080 1.23', 'FIN3090 3.3']);
  assert.equal(unit.levels.length, 5);
  for (const l of unit.levels) {
    assert.ok(l.cards.length >= 4 && l.cards.length <= 6, l.id);
    assert.ok(l.questions.length >= 7 && l.questions.length <= 10, l.id);
    assert.ok(l.cards.every((c) => c.image === undefined), l.id);
  }
  assert.equal(unit.image, undefined);
  assert.equal(unit.levels.flatMap((l) => l.cards).length, 30);
  assert.equal(Q.size, 46);
  assert.deepEqual(unit.levels.map((l) => l.go?.building ?? null), [null, null, null, null, 'exchange']);
  assert.ok(cfg.courses.fintech2030.modules.includes('exchange'), 'the Exchange is open to FinTech 20/30');
});

test('outline figures: level 1 tables and bars match the Lesson 25 numbers, recomputed', () => {
  const P = 10000;
  for (const [n, loss] of Object.entries(OUTLINE.l25_byCount)) assert.equal(P / n, loss);
  for (const [pct, loss] of Object.entries(OUTLINE.l25_byCanada)) assert.ok(near(P * (pct / 100) * 0.2, loss));
  const money = (n) => `$${n.toLocaleString('en-CA')}`;
  assert.deepEqual(cards(1)[0].figure.rows, Object.entries(OUTLINE.l25_byCount).map(([n, loss]) => [n, money(loss), money(loss)]));
  assert.deepEqual(cards(1)[3].figure.bars.map((b) => b.value), [100, 60, 30, 0].map((pct) => OUTLINE.l25_byCanada[pct] * 100));
  assert.equal(Q.get('ft2030-s3-u5-l1-q3').figure.bars[Q.get('ft2030-s3-u5-l1-q3').answer].value, 60000);
  assert.ok(text(1).includes('$2,000') && text(1).includes('$10,000'));
});

test('outline figures: level 4 two jars and the exit-slip mix', () => {
  const j = OUTLINE.l29_jars;
  const earns = j.stocks * (j.stocksRate / 100) + j.cash * (j.cashRate / 100);
  assert.equal(earns, j.earned);
  assert.ok(near((earns / (j.stocks + j.cash)) * 100, j.rate));
  assert.ok(near((j.stocksRate + j.cashRate) / 2, j.notMiddle));
  assert.deepEqual(cards(4)[1].figure.rows, [['Stocks', '$8,000', '8%', '$640'], ['Cash', '$2,000', '3%', '$60'], ['Whole mix', '$10,000', '7%', '$700']]);
  assert.ok(text(4).includes('5.5%') && text(4).includes('$640 + $60 = $700'));
  const e = OUTLINE.l29_exit;
  assert.ok(near((e.w * e.r1 + (100 - e.w) * e.r2) / 100, e.blended));
});

test('outline figures: level 5 crash on the mix', () => {
  const o = OUTLINE.l30;
  const after = (stockPct) => o.total * (stockPct / 100) * (1 - o.crash / 100) + o.total * (1 - stockPct / 100);
  assert.ok(near(after(o.a), o.aAfter) && near(o.total * (o.a / 100) * (1 - o.crash / 100), o.aStocks));
  assert.ok(near((o.a * o.crash) / 100, o.aFall) && near((o.c * o.crash) / 100, o.cFall) && near((50 * o.crash) / 100, o.halfFall));
  assert.deepEqual([100, 80, 60, 50, 30, 0].map((s) => (s * o.crash) / 100), o.row);
  assert.deepEqual(cards(5)[3].figure.bars.map((b) => b.value), [30, 24, 15, 9, 0]);
  assert.deepEqual(cards(5)[1].figure.rows, [['A (80% stocks)', '$56,000', '$20,000', '24%'], ['C (30% stocks)', '$21,000', '$70,000', '9%']]);
});

test('every number answer is recomputed', () => {
  const c = (d) => Math.round(d * 100);   // dollars -> cents
  const want = {
    'ft2030-s3-u5-l1-q2': c(4500 / 15),
    'ft2030-s3-u5-l1-q4': c(8000 * 0.2),
    'ft2030-s3-u5-l1-q7': c(10000 * 0.4 * 0.2),
    'ft2030-s3-u5-l2-q4': (4 * 2000 * 100) / 10000,
    'ft2030-s3-u5-l2-q5': (2 * 2000 * 100) / 10000,
    'ft2030-s3-u5-l2-q7': c(4 * 2000 * 0.2),
    'ft2030-s3-u5-l3-q1': c(5000 * 0.97 * 0.2),
    'ft2030-s3-u5-l3-q5': Math.round((20 * 97 + 80 * 3) / 10) / 10,
    'ft2030-s3-u5-l3-q6': c(8000 * 0.25),
    'ft2030-s3-u5-l4-q2': c(6000 * 0.08),
    'ft2030-s3-u5-l4-q3': Math.round((60 * 97 + 40 * 3) / 10) / 10,
    'ft2030-s3-u5-l4-q4': ((7000 * 0.08 + 3000 * 0.03) / 10000) * 100,
    'ft2030-s3-u5-l4-q5': (80 * 8 + 20 * 4) / 100,
    'ft2030-s3-u5-l4-q7': (40 * 8 + 30 * 4 + 30 * 6) / 100,
    'ft2030-s3-u5-l4-q9': 5 + -3,
    'ft2030-s3-u5-l5-q2': c(60000 * 0.7 + 40000),
    'ft2030-s3-u5-l5-q3': (20 * 30) / 100,
    'ft2030-s3-u5-l5-q4': c(240000 * 0.5 * 0.3),
    'ft2030-s3-u5-l5-q8': (30 * 8 + 70 * 3) / 100,
  };
  for (const [id, v] of Object.entries(want)) { assert.ok(Q.has(id), id); assert.ok(near(Q.get(id).answer, v), `${id}: ${Q.get(id).answer} vs ${v}`); }
  // the game's Balanced fund: its weights come from the Exchange constants
  const dd = FUNDS.find((f) => f.ticker === 'DAAG');
  assert.deepEqual(dd.blend, { DAAX: 60, DAAB: 40 });
  assert.ok(near(Q.get('ft2030-s3-u5-l5-q6').answer, (dd.blend.DAAX * 30) / 100));
  assert.ok(Q.get('ft2030-s3-u5-l5-q6').prompt.includes(dd.name) && cards(5)[5].text.includes(dd.name));
  assert.ok(cards(5)[5].text.includes(`${dd.blend.DAAX}%`) && cards(5)[5].text.includes(`${dd.blend.DAAB}%`));
  assert.equal(Object.keys(want).length + 1, [...Q.values()].filter((q) => q.type === 'number').length);
});

test('point questions and level 2 and 3 tables', () => {
  const mix = cards(2)[4].figure.rows;
  assert.equal(mix.length, 5);
  assert.equal(mix.filter((r) => r[3] === 'Canada').length, 4);
  assert.equal(mix.filter((r) => r[1] === 'Consumer').length, 2);
  assert.equal(mix.filter((r) => r[2] === 'Large').length, 4);
  const q6 = Q.get('ft2030-s3-u5-l2-q6');
  assert.deepEqual(q6.figure.bars.map((b) => b.label), ['Interest sensitive', 'Consumer', 'Industrial', 'Resources']);
  assert.deepEqual(q6.figure.bars.map((b) => b.value), [20, 40, 20, 20]);
  assert.equal(q6.figure.bars[q6.answer].label, 'Consumer');
  const funds = cards(3)[1].figure.rows;
  assert.deepEqual(funds.map((r) => r[3]), ['97%', '3%', '60%']);
  const q4 = Q.get('ft2030-s3-u5-l3-q4');
  assert.deepEqual(q4.figure.bars.map((b) => b.value), [97, 3, 60]);
  assert.equal(q4.figure.bars[q4.answer].label, 'Fund S');
  // blends in the choice question: only 30/70 is below half
  const ca = (a) => (a * 97 + (100 - a) * 3) / 100;
  const opts = Q.get('ft2030-s3-u5-l3-q9').options;
  assert.equal(opts[Q.get('ft2030-s3-u5-l3-q9').answer].text, '30% in Fund R and 70% in Fund S');
  assert.deepEqual([30, 50, 60, 90].filter((a) => ca(a) < 50), [30]);
  const q6b = Q.get('ft2030-s3-u5-l4-q6');
  assert.deepEqual(q6b.figure.bars.map((b) => b.value), [3, 5.5, 7, 8]);
  assert.equal(q6b.figure.bars[q6b.answer].value, 7);
  const q5 = Q.get('ft2030-s3-u5-l5-q5');
  assert.equal(q5.figure.bars[q5.answer].label, '30% in stocks');
  assert.equal(q5.figure.bars[q5.answer].value, 9);
});

test('no real company, fund, index, ticker or brand; no fees taught; no market figures', () => {
  const dump = JSON.stringify(unit);
  for (const bad of ['XIU', 'XIC', 'VFV', 'VGRO', 'XEQT', 'VAB', 'RioCan', 'iShares', 'Vanguard', 'S&P', 'TSX', 'TFSA', 'RRSP', ' MER', 'management fee', '2008', '2020', '2022', 'Bank of Canada']) assert.ok(!dump.includes(bad), bad);
  assert.ok(!/\bfee/i.test(dump.replace(/Tillbrook/g, '')) , 'fees belong to the Funds and fees unit');
});

test('no copied answers: no number answer appears on a card or card figure of its own level', () => {
  const fmt = (q) => {
    if (q.unit === '$') { const d = q.answer / 100; return `$${d.toLocaleString('en-CA', { minimumFractionDigits: Number.isInteger(d) ? 0 : 2, maximumFractionDigits: 2 })}`; }
    return `${q.answer}%`;
  };
  for (const l of unit.levels) {
    const where = JSON.stringify(l.cards.map((c) => [c.text, c.figure]));
    for (const q of l.questions.filter((x) => x.type === 'number')) {
      const s = fmt(q).replace(/[$.]/g, '\\$&');
      assert.ok(!new RegExp(`(?<![\\d.,])${s}(?![\\d])`).test(where), `${q.id} answer ${fmt(q)} is on a card of its level`);
    }
  }
});
