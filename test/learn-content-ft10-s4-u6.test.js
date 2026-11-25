// Content check for the Learning Road unit "Coins, engines and risk" (ft10-s4-u6). The game has no crypto (searched below), so there is no game module to
// recompute from: every number answer is recomputed here from its own arithmetic, and every figure quoted from Mr. Tang's Lesson 36 outline is pinned to a cited line.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = new URL('..', import.meta.url).pathname;
const course = JSON.parse(fs.readFileSync(path.join(root, 'modules/learn/content/fintech10.json'), 'utf8'));
const unit = course.sections.flatMap((s) => s.units).find((u) => u.id === 'ft10-s4-u6');
const Q = new Map(unit.levels.flatMap((l) => l.questions).map((q) => [q.id, q]));
const text = (l) => unit.levels[l - 1].cards.map((c) => c.text).join(' ');
const cents = (d) => Math.round(d * 100 + 1e-6);
const n = (x) => x.toLocaleString('en-CA');
const OUT = 'slide-studio/courses/fintech10/context/outlines/2026-11-03 Lesson 36 (v2).md';

// Figures quoted from the Lesson 36 outline. Line numbers are lines of that file.
const OUTLINE = {
  guesses: { gh: 3, perSecond: 3_000_000_000, cite: `${OUT} lines 212-214 (slide 4: about 50 graphics cards, 3,000,000,000 guesses a second, about 3 GH/s), 534-535 (C10 = 3, C11 = 3,000,000,000)` },
  stakes: { values: [50, 30, 15, 5, 0], total: 100, foxPct: 50, cite: `${OUT} lines 235 (slide 5: Fox 50 · Owl 30 · Bear 15 · Wolf 5 · Hawk 0 = 100, Fox 50%), 546-548 (C15:C20)` },
  wolf: { copies: [1, 1, 1, 10, 1], stillOne: 4, cite: `${OUT} lines 119-120 (flag 8), 557-563 (C24:G24 and C25 = 4)` },
  cap: { value: 21_000_000, cite: `${OUT} lines 249 and 267 (capped at 21,000,000), 580 (K11), 818 (source notes)` },
  merge: { date: 'Sept 15, 2022', cite: `${OUT} lines 232 and 252 (Ethereum since Sept 15, 2022), 91 (flag 5, source notes)` },
  candy: { start: 1, rate: 0.1, bars: [100, 110, 121, 133, 146], cite: `${OUT} line 271 (slide 7: Year 0 $1.00 ... Year 4 $1.46), 618-621 (C9:C12), 820 (1.331 rounds to 1.33; 1.4641 to 1.46)` },
  hundredK: { date: 'Dec 5, 2024', cite: `${OUT} lines 101 (flag 5) and 282 (slide 8: the coin that first hit $100,000, Dec 5, 2024)` },
  rise40: { pct: 40, cite: `${OUT} line 643 (4 Risk C5: a coin went up 40% this month); the unit uses 30% in its own question and 40% only for a made-up holding` },
  codes: { values: ['FIN1010 3.8.7', 'FIN1010 2.3', 'FIN1010 2.6', 'FIN1010 2.6.4', 'FIN1010 2.2', 'FIN1010 1.2', 'FIN1010 5.1.3'], cite: `${OUT} lines 19-25 (Objectives)` },
};

test('shape: 5 levels, 4-6 cards, 7-10 questions, stable ids, outcome codes, no go button, no pictures yet', () => {
  assert.ok(unit, 'unit ft10-s4-u6 is in fintech10.json');
  assert.equal(unit.title, 'Coins, engines and risk');
  assert.equal(unit.blurb, 'How coins are made and secured, the kinds of coin, and the risks of a coin.');
  assert.deepEqual(unit.outcome_codes, OUTLINE.codes.values);
  assert.equal(unit.levels.length, 5);
  assert.equal(unit.image, undefined);
  unit.levels.forEach((l, i) => {
    assert.equal(l.id, `ft10-s4-u6-l${i + 1}`);
    assert.ok(l.cards.length >= 4 && l.cards.length <= 6, `${l.id}: ${l.cards.length} cards`);
    assert.ok(l.questions.length >= 7 && l.questions.length <= 10, `${l.id}: ${l.questions.length} questions`);
    assert.equal(l.go, undefined, 'the game has no crypto, so no go button');
    assert.ok(l.cards.every((c) => c.image === undefined));
    assert.ok(l.questions.some((q) => q.figure) || l.cards.some((c) => c.figure), `${l.id}: a figure`);
    l.questions.forEach((q, k) => assert.equal(q.id, `${l.id}-q${k + 1}`));
  });
  assert.ok(unit.levels[4].cards.at(-1).text.split(/[.!?]\s/).length === 1, 'the section ends in one sentence');
});

test('the game has no crypto: nothing in modules/ or docs/ (other than lesson content and its tests) names it', () => {
  const hits = [];
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) { if (!['node_modules', 'content', 'draft'].includes(e.name) || d.endsWith('docs')) walk(p); continue; }
      if (!/\.(js|mjs|md|json|html)$/.test(e.name) || p.includes('modules/learn/') || p.endsWith(path.join('docs', 'learn.md')) || p.endsWith(path.join('arcade', 'REVIEW-wordle.md'))) continue;   // FinWord's review quotes lesson titles verbatim   // docs/learn.md lists the lesson units by name
      if (/bitcoin|blockchain|cryptocurrenc|crypto coin|ethereum/i.test(fs.readFileSync(p, 'utf8'))) hits.push(p);
    }
  };
  walk(path.join(root, 'modules')); walk(path.join(root, 'docs'));
  assert.deepEqual(hits, []);
});

test('outline figures: pinned to the Lesson 36 outline lines cited above', () => {
  assert.equal(OUTLINE.guesses.gh * 1_000_000_000, OUTLINE.guesses.perSecond);
  assert.ok(text(1).includes('about 3 GH/s') && text(1).includes('about 50 graphics cards'));
  assert.ok(unit.levels[0].cards[2].figure.rows.some((r) => r[1] === `3 x 1,000,000,000 = ${n(OUTLINE.guesses.perSecond)}`));
  const { values, total } = OUTLINE.stakes;
  assert.equal(values.reduce((a, b) => a + b, 0), total);
  assert.deepEqual(unit.levels[1].cards[1].figure.rows.map((r) => Number(r[1])), values);
  assert.deepEqual(unit.levels[1].cards[1].figure.rows.map((r) => r[2]), values.map((v) => `${v} / ${total} = ${(v / total) * 100}%`));
  assert.equal(values[0] / total * 100, OUTLINE.stakes.foxPct);
  assert.equal(OUTLINE.wolf.copies.filter((c) => c === 1).length, OUTLINE.wolf.stillOne);
  assert.ok(text(1).includes('from 1 to 10') && text(1).includes('four copies still say 1'));
  assert.ok(text(3).includes(n(OUTLINE.cap.value)) && text(4).includes(n(OUTLINE.cap.value)));
  assert.ok(text(2).includes(OUTLINE.merge.date) && text(3).includes(OUTLINE.merge.date));
  const bars = unit.levels[3].cards[1].figure.bars.map((b) => b.value);
  assert.deepEqual(bars, [0, 1, 2, 3, 4].map((y) => cents(OUTLINE.candy.start * (1 + OUTLINE.candy.rate) ** y)));
  assert.deepEqual(bars, OUTLINE.candy.bars);
  assert.ok(text(4).includes('$1.331') && text(4).includes('$1.4641'));
  assert.ok(text(5).includes(OUTLINE.hundredK.date) && text(5).includes('$100,000'));
  assert.ok(unit.levels[4].cards[1].text.includes('rises 40%'));
});

test('number answers: every one is recomputed from its own arithmetic', () => {
  const a = (id) => Q.get(`ft10-s4-u6-${id}`).answer;
  const bill = 0.35 * 24 * 30;
  assert.equal(a('l1-q6'), cents(bill)); assert.equal(a('l1-q6'), 25200);
  assert.equal(a('l1-q7'), cents(bill - 180)); assert.equal(a('l1-q7'), 7200);
  assert.equal(Q.get('ft10-s4-u6-l1-q7').prompt.includes('$252.00'), true);
  assert.equal(a('l2-q4'), Math.round(15 / (25 + 15 + 10) * 100));
  assert.equal(a('l2-q5'), Math.round(10 / (30 + 20 + 10) * 100));
  assert.equal(a('l4-q3'), cents(5 * 1.1 * 1.1));
  assert.equal(a('l4-q4'), cents(20 * 1.1 ** 3));
  assert.equal(a('l4-q5'), Math.round((1.46 - 1.0) / 1.0 * 100));
  assert.equal(a('l4-q8'), cents(100 * 1.1 * 1.1 - 100));
  assert.equal(a('l5-q1'), cents(400 * 1.4));
  assert.equal(a('l5-q2'), cents(560 * 0.75));
  assert.equal(a('l5-q3'), Math.round((420 - 400) / 400 * 100));
  assert.equal(a('l5-q4'), Math.round((1000 - 500) / 500 * 100));
  assert.equal(a('l5-q5'), Math.round((500 - 400) / 400 * 100));
});

test('point answers and the figures behind them', () => {
  const rig = Q.get('ft10-s4-u6-l1-q8'); assert.equal(rig.figure.bars[rig.answer].label, 'Rig C');
  assert.equal(Math.max(...rig.figure.bars.map((b) => b.value)), rig.figure.bars[rig.answer].value);
  const twice = Q.get('ft10-s4-u6-l2-q6'); const ben = twice.figure.bars.find((b) => b.label === 'Ben').value;
  assert.deepEqual(twice.figure.bars.filter((b) => b.value === 2 * ben).map((b) => b.label), [twice.figure.bars[twice.answer].label]);
  assert.equal(twice.figure.bars.reduce((s, b) => s + b.value, 0), 100);
  const candy = Q.get('ft10-s4-u6-l4-q6'); assert.equal(candy.figure.bars.findIndex((b) => b.value > 130), candy.answer);
  const pri = Q.get('ft10-s4-u6-l5-q10'); assert.equal(Math.max(...pri.figure.points.map((p) => p.value)), pri.figure.points[pri.answer].value);
  assert.deepEqual(pri.figure.points.map((p) => p.value), [40000, 56000, 42000]);
});

test('choice answers: the keyed option exists, and the numeric ones match the arithmetic', () => {
  const q = (id) => Q.get(`ft10-s4-u6-${id}`);
  assert.equal(q('l1-q3').options[q('l1-q3').answer].text, n(3_000_000_000));
  assert.equal(q('l1-q4').options[q('l1-q4').answer].text, n(3_000_000_000 * 60));
  assert.equal(q('l1-q9').options[q('l1-q9').answer].text, 'Six');
  for (const x of Q.values()) if (x.type === 'choice') { assert.ok(x.options[x.answer]); assert.equal(new Set(x.options.map((o) => o.text)).size, x.options.length); }
});

test('wording rules: no named coins or companies beyond the two best known, no advice, no exclamation marks', () => {
  const all = JSON.stringify(unit);
  assert.ok(!/Litecoin|XRP|Chainlink|Tether|Coinbase|Binance|PayPal|Christie|Buterin|ETF|Money Moves/i.test(all));
  assert.ok(!/you should (buy|sell|hold|avoid)|is a good (buy|investment)|will (rise|fall) (next|soon)/i.test(all));
  assert.ok(!/!/.test(all));
  assert.ok(!/stablecoin|\$69 million|1970s|99\.9/i.test(all), 'facts the outline flags as unchecked are left out');
});
