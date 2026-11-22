// Content check for the Learning Road unit "Exchange rates" (ft10-s4-u2). The game has no foreign money (searched modules/ and docs/), so every rate here is a
// class example from Mr. Tang's Lesson 31 outline or a round made-up one. Figures quoted from the outline are pinned to cited lines; every number answer is recomputed.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const course = JSON.parse(fs.readFileSync(new URL('../modules/learn/content/fintech10.json', import.meta.url), 'utf8'));
const unit = course.sections.flatMap((s) => s.units).find((u) => u.id === 'ft10-s4-u2');
const Q = new Map(unit.levels.flatMap((l) => l.questions).map((q) => [q.id, q]));
const text = (l) => unit.levels[l - 1].cards.map((c) => c.text).join(' ');
const c = (d) => Math.round(d * 100 + 1e-6);
const fx = (d) => d.toLocaleString('en-CA', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const OUT = 'slide-studio/courses/fintech10/context/outlines/2026-10-27 Lesson 31.md';

// Figures quoted from the Lesson 31 outline (all made-up class examples). Line numbers are lines of that file.
const OUTLINE = {
  rate: { value: 1.40, cite: `${OUT} line 106 (slide 9: "Example rate (made up): US$1 = C$1.40"), line 28 (flag 3)` },
  rate2: { value: 1.50, cite: `${OUT} line 124 (slide 12: the board moves to US$1 = C$1.50), line 184` },
  slide9: { game: 60, canadian: 84, back: 140, usBack: 100, cite: `${OUT} lines 106 and 108 (60 x 1.40 = 84; 140 / 1.40 = 100)` },
  peso: { before: 10, after: 12, phone: 100, pesosBefore: 1000, pesosAfter: 1200, buys: [120, 100], cite: `${OUT} lines 118 and 120 (peg 10 then 12 pesos; 1,000 and 1,200 pesos; 1,200 buys US$120 then US$100)` },
  conversions: { c1: 28, c2: 50, c3: 30, more: 2, cite: `${OUT} lines 124 and 126 (20 x 1.40 = 28; 70 / 1.40 = 50; 20 x 1.50 = 30; up 2)` },
  codes: { cite: `${OUT} line 7 (FIN1010 2.3 and MAM3030 2.8.3)` },
};

test('shape: 3 levels, 4-6 cards, 7-10 questions, ids, outcome codes, no go button, no pictures yet', () => {
  assert.ok(unit, 'unit ft10-s4-u2 is in fintech10.json');
  assert.equal(unit.title, 'Exchange rates');
  assert.equal(unit.blurb, 'What a Canadian dollar is worth in another money, and why that changes.');
  assert.deepEqual(unit.outcome_codes, ['FIN1010 2.3', 'MAM3030 2.8.3']);
  assert.equal(unit.levels.length, 3);
  unit.levels.forEach((l, i) => {
    assert.equal(l.id, `ft10-s4-u2-l${i + 1}`);
    assert.ok(l.cards.length >= 4 && l.cards.length <= 6, `${l.id}: ${l.cards.length} cards`);
    assert.ok(l.questions.length >= 7 && l.questions.length <= 10, `${l.id}: ${l.questions.length} questions`);
    assert.ok(l.questions.filter((q) => q.type === 'number').length >= 2, `${l.id}: at least 2 number questions`);
    assert.ok(l.questions.some((q) => q.figure), `${l.id}: a question with a figure`);
    assert.equal(l.go, undefined, 'the game has no foreign money, so no game level');
    l.questions.forEach((q, k) => assert.equal(q.id, `${l.id}-q${k + 1}`));
  });
  assert.ok(!JSON.stringify(unit).includes('"image"'));
});

test('the game has no foreign money (so no go button) and its Exchange is a stock exchange', () => {
  const root = new URL('..', import.meta.url).pathname;
  const hits = [], FINWORD = ['modules/arcade/wordle-words.js', 'modules/arcade/REVIEW-wordle.md'];   // verbatim lesson glossary text, not a game mechanic
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = `${d}/${e.name}`;
      if (e.isDirectory()) { if (e.name !== 'node_modules') walk(p); }
      else if (/\.(js|md)$/.test(e.name) && /exchange rate|foreign currency|\bUSD\b/i.test(fs.readFileSync(p, 'utf8'))) hits.push(p.slice(root.length));
    }
  };
  walk(`${root}modules`); walk(`${root}docs`);
  assert.deepEqual(hits.filter((p) => !p.startsWith('modules/learn/') && p !== 'docs/learn.md' && !FINWORD.includes(p)), [], 'a module or doc now mentions an exchange rate: this unit may need a game level');
  assert.ok(/stock|fund/i.test(fs.readFileSync(new URL('../modules/exchange/constants.js', import.meta.url), 'utf8')), 'the Exchange building trades funds and stocks');
  assert.ok(text(1).includes('stock exchange') && text(1).includes('no foreign money'));
});

test('outline figures: the class rates and examples are quoted as written and called examples', () => {
  assert.equal(OUTLINE.rate.value, 1.4); assert.equal(OUTLINE.rate2.value, 1.5);
  assert.ok(/made-up rate: US\$1 = C\$1\.40/.test(text(1)) && /only an example/.test(text(1)));
  assert.equal(OUTLINE.slide9.game * OUTLINE.rate.value, OUTLINE.slide9.canadian);
  assert.equal(OUTLINE.slide9.back / OUTLINE.rate.value, OUTLINE.slide9.usBack);
  assert.ok(text(1).includes('US$60 game costs 60 x 1.40 = C$84.00') && text(1).includes('C$140.00 / 1.40 = US$100.00'));
  const p = OUTLINE.peso;
  assert.equal(p.phone * p.before, p.pesosBefore); assert.equal(p.phone * p.after, p.pesosAfter);
  assert.deepEqual([p.pesosAfter / p.before, p.pesosAfter / p.after], p.buys);
  assert.ok(text(3).includes('US$1 = 10 pesos') && text(3).includes('US$1 = 12 pesos') && text(3).includes('1,000') && text(3).includes('1,200') && /made-up money/.test(text(3)));
  const k = OUTLINE.conversions;
  assert.equal(20 * 1.40, k.c1); assert.equal(70 / 1.40, k.c2); assert.equal(20 * 1.50, k.c3); assert.equal(k.c3 - k.c1, k.more);
  assert.equal(Math.round(((1200 - 1000) / 1000) * 100), 20);               // "your trip just got 20% more expensive" (outline line 120)
  assert.ok(Math.abs(((100 - 120) / 120) * 100 - -16.7) < 0.05);
});

test('arithmetic: every number answer is recomputed from its prompt', () => {
  const R = 1.4, R2 = 1.5;
  const want = {
    'ft10-s4-u2-l1-q3': c(25 * R), 'ft10-s4-u2-l1-q4': c(98 / R), 'ft10-s4-u2-l1-q5': c(80 * R), 'ft10-s4-u2-l1-q9': c(140 / R - 85),
    'ft10-s4-u2-l2-q6': c(1200 / R2), 'ft10-s4-u2-l2-q8': c(2000 * R2 - 2000 * R),
    'ft10-s4-u2-l3-q3': c(2400 / 12), 'ft10-s4-u2-l3-q4': ((1200 - 1000) / 1000) * 100, 'ft10-s4-u2-l3-q5': Math.round(((240 - 200) / 240) * 1000) / 10,
    'ft10-s4-u2-l3-q8': c(20 * R), 'ft10-s4-u2-l3-q9': c(70 / R), 'ft10-s4-u2-l3-q10': c(20 * R2 - 20 * R),
  };
  const numbers = [...Q.values()].filter((q) => q.type === 'number').map((q) => q.id);
  assert.deepEqual(Object.keys(want).sort(), numbers.sort(), 'every number question is covered by this test');
  for (const [id, v] of Object.entries(want)) assert.ok(Math.abs(Q.get(id).answer - v) <= 1e-6, `${id}: stored ${Q.get(id).answer}, recomputed ${v}`);
  assert.equal(want['ft10-s4-u2-l3-q8'], 2800); assert.equal(want['ft10-s4-u2-l3-q9'], 5000); assert.equal(want['ft10-s4-u2-l3-q10'], 200);
  // the percent answer is the exact value rounded to one decimal, and the tolerance accepts that rounding
  const sf = Q.get('ft10-s4-u2-l3-q5');
  assert.ok(Math.abs((40 / 240) * 100 - sf.answer) <= sf.tolerance);
  // each prompt names the amounts it uses
  assert.ok(Q.get('ft10-s4-u2-l1-q3').prompt.includes('US$25') && Q.get('ft10-s4-u2-l1-q4').prompt.includes('C$98.00') && Q.get('ft10-s4-u2-l1-q9').prompt.includes('US$85.00'));
  assert.ok(Q.get('ft10-s4-u2-l2-q6').prompt.includes('C$1,200.00') && Q.get('ft10-s4-u2-l2-q8').prompt.includes('US$2,000.00'));
  assert.ok(Q.get('ft10-s4-u2-l3-q3').prompt.includes('2,400 pesos'));
});

test('tables, bars and cards: the figures recompute', () => {
  for (const [us, ca] of unit.levels[0].cards[2].figure.rows) assert.equal(ca, `C$${fx(parseFloat(us.replace(/[^0-9.]/g, '')) * 1.4)}`);
  const t = unit.levels[1].cards[4].figure.rows;
  assert.deepEqual(t[0].slice(1), [`US$${fx(1050 / 1.4)}`, `US$${fx(1050 / 1.5)}`]);
  assert.deepEqual(t[1].slice(1), [`C$${fx(50 * 1.4)}`, `C$${fx(50 * 1.5)}`]);
  assert.deepEqual(t[2].slice(1), [`C$${fx(1000 * 1.4)}`, `C$${fx(1000 * 1.5)}`]);
  const b = Q.get('ft10-s4-u2-l2-q7');
  b.figure.bars.forEach((x, i) => assert.equal(x.value, c(1050 / [1.3, 1.4, 1.5, 1.6][i])));
  assert.equal(b.answer, b.figure.bars.findIndex((x) => x.value === Math.min(...b.figure.bars.map((y) => y.value))));
  const r = Q.get('ft10-s4-u2-l3-q5').figure.bars;
  assert.deepEqual(r.map((x) => x.value), [c(2400 / 10), c(2400 / 12)]);
  const peso = unit.levels[2].cards[1].figure.rows;
  assert.deepEqual(peso, [['US$1 = 10 pesos', '1,000 pesos', 'US$120.00'], ['US$1 = 12 pesos', '1,200 pesos', 'US$100.00']]);
  assert.ok(unit.levels[0].cards[1].text.includes('US$0.71')); assert.equal((1 / 1.4).toFixed(2), '0.71');
  assert.ok(Q.get('ft10-s4-u2-l1-q6').prompt.includes(`C$${fx(30 / 1.4)}`));
  assert.equal(Q.get('ft10-s4-u2-l3-q4').traps[0].value, Math.round(((200 / 1200) * 1000)) / 10);
});
