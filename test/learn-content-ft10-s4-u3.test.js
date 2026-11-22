// Content check for the Learning Road unit "Global trade" (ft10-s4-u3). The game has no trade, so every figure comes from Mr. Tang's
// Lesson 32 outline (pinned below with its line) or is made-up arithmetic recomputed here from scratch; the shape is checked too.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const course = JSON.parse(fs.readFileSync(new URL('../modules/learn/content/fintech10.json', import.meta.url), 'utf8'));
const unit = course.sections.flatMap((s) => s.units).find((u) => u.id === 'ft10-s4-u3');
const Q = new Map(unit.levels.flatMap((l) => l.questions).map((q) => [q.id, q]));
const q = (l, n) => Q.get(`ft10-s4-u3-l${l}-q${n}`);
const text = (l) => unit.levels[l - 1].cards.map((c) => c.text).join(' ');
const rows = (l, c) => unit.levels[l - 1].cards[c - 1].figure.rows.flat().join(' | ');
const cents = (d) => Math.round(d * 100);

// Figures from the outline `2026-10-28 Lesson 32.md` (slide-studio/courses/fintech10/context/outlines/).
const OUT = {
  islandsPerWorker: { value: [6, 2, 2, 6], cite: 'tab 1 lines 162-163 (Maple 6 hoodies or 2 crates; Sun 2 or 6)' },
  workers: { value: 10, cite: 'tab 1 line 164 (10 workers each)' },
  noTradeTotals: { value: [40, 40], cite: 'tab 1 line 180 (D9 = 40, D10 = 40 at 5 and 5)' },
  specialisedTotals: { value: [60, 60], cite: 'tab 1 line 180 (60 and 60)' },
  swap: { value: 25, cite: 'tab 1 line 180 (25-for-25 trade)' },
  afterTrade: { value: [35, 25, 25, 35], cite: 'tab 1 line 180 (Maple 35 hoodies 25 fruit; Sun 25 and 35)' },
  bikes: { value: [400, 460], cite: 'slide 4 line 87 and tab 2 lines 186-187 ($400 import, $460 Canadian)' },
  tariffs: { value: [10, 25], cite: 'slide 4 line 88 (25%) and tab 2 line 202 (10% gives $440)' },
  breakEven: { value: 15, cite: 'tab 2 line 202 ((460 - 400) / 400 = 0.15)' },
  steel: { value: [800, 600, 700], cite: 'slide 5 line 93 and tab 3 lines 208-210 ($800 home, $600 Canada, $700 cost)' },
  dumpingGap: { value: 200, cite: 'tab 3 line 220 (800 - 600 = 200)' },
  millLoss: { value: 100, cite: 'tab 3 line 220 (700 - 600 = 100)' },
  rate: { value: 1.4, cite: 'the Exchange rates unit class rate US$1 = C$1.40 (named in the task brief, not in this outline)' },
  years: { value: { wto: 1995, ftaCa: 1989, nafta: 1994, cusma: 2020, ceta: 2017, cptpp: 2018 }, cite: 'slide 6 line 99 and tab 4 lines 228-233 (flag 2, lines 29-33: general knowledge, to be checked)' },
};

test('outline figures: the outline agrees with itself and with the lesson arithmetic', () => {
  const [mh, mf, sh, sf] = OUT.islandsPerWorker.value, W = OUT.workers.value;
  assert.deepEqual([5 * mh + 5 * sh, 5 * mf + 5 * sf], OUT.noTradeTotals.value);
  assert.deepEqual([W * mh + 0, W * sf], OUT.specialisedTotals.value);
  const s = OUT.swap.value;
  assert.deepEqual([W * mh - s, s, s, W * sf - s], OUT.afterTrade.value);
  const [imp, can] = OUT.bikes.value;
  assert.equal(imp * 110 / 100, 440); assert.equal(imp * 125 / 100, 500);
  assert.equal((can - imp) / imp * 100, OUT.breakEven.value);
  const [home, ca, cost] = OUT.steel.value;
  assert.equal(home - ca, OUT.dumpingGap.value); assert.equal(cost - ca, OUT.millLoss.value);
  for (const [k, v] of Object.entries(OUT)) assert.ok(v.cite && v.value !== undefined, k);
});

test('shape: 4 levels, 4-6 cards, 7-10 questions, no pictures, stable ids, no game button', () => {
  assert.equal(unit.levels.length, 4);
  assert.deepEqual(unit.outcome_codes, ['MAM3030 1.1', 'MAM3030 2.3', 'MAM3030 2.4', 'MAM3030 2.5.1', 'MAM3030 2.5.2', 'FIN1010 2.3', 'MAM3030 5.1.3']);
  unit.levels.forEach((l, i) => {
    assert.equal(l.id, `ft10-s4-u3-l${i + 1}`);
    assert.ok(l.cards.length >= 4 && l.cards.length <= 6, l.id);
    assert.ok(l.questions.length >= 7 && l.questions.length <= 10, l.id);
    assert.ok(l.questions.some((x) => x.figure), `${l.id}: a question with a figure`);
    assert.equal(l.go, undefined);
    l.questions.forEach((x, j) => assert.equal(x.id, `${l.id}-q${j + 1}`));
  });
  assert.ok(!JSON.stringify(unit).includes('"image"'));
});

test('art prompts: banner plus one line per card without a figure', () => {
  const tsv = fs.readFileSync(new URL('../design/art/ft10-s4-u3-prompts.tsv', import.meta.url), 'utf8').trim().split('\n').map((l) => l.split('\t'));
  const want = ['banner', ...unit.levels.flatMap((l, i) => l.cards.map((c, j) => (c.figure ? null : `l${i + 1}c${j + 1}`)).filter(Boolean))];
  assert.deepEqual(tsv.map((r) => r[0]), want);
  const alts = tsv.map((r) => r[2]);
  assert.equal(new Set(alts).size, alts.length);
  for (const [, p, a] of tsv) { const w = p.split(/\s+/).length; assert.ok(w >= 10 && w <= 30, p); assert.ok(a.length >= 5 && a.length <= 120, a); assert.ok(!/\b(no|without|coin|face)\b/i.test(p), p); }
});

test('level 1: islands tables and answers', () => {
  assert.ok(rows(1, 3).includes('30 | 10 | 40') && rows(1, 3).includes('10 | 30 | 40'));
  assert.ok(rows(1, 4).includes('60 | 0 | 60') && rows(1, 4).includes('0 | 60 | 60'));
  assert.ok(rows(1, 5).includes('35 | 30 | 25 | 10') && rows(1, 5).includes('25 | 10 | 35 | 30'));
  const right = (x) => x.options[x.answer].text;
  assert.equal(right(q(1, 3)), `${5 * 6} hoodies`);
  assert.equal(right(q(1, 4)), `${5 * 6 + 5 * 2} hoodies`);
  assert.equal(right(q(1, 5)), `${10 * 6} hoodies`);
  assert.equal(right(q(1, 6)), '20 more');
  assert.equal(right(q(1, 7)), `${60 - 25} crates`);
  assert.equal(right(q(1, 8)), '5 more hoodies and 15 more crates');
});

test('level 2: bike tariff arithmetic', () => {
  assert.ok(rows(2, 3).includes('$440') && rows(2, 3).includes('$500'));
  assert.equal(q(2, 3).answer, cents(400 * 0.10));
  assert.equal(q(2, 4).answer, cents(200 + 200 * 0.10));
  assert.equal(q(2, 5).options[q(2, 5).answer].text, 'The imported bike');
  assert.deepEqual(q(2, 6).figure.bars.map((b) => b.value), [40000, 44000, 46000, 50000]);   // a $ figure holds cents
  assert.equal(q(2, 6).answer, 3);
  assert.equal(q(2, 7).answer, cents(400 * 1.25 - 460));
  assert.equal(q(2, 8).answer, (300 - 250) / 250 * 100);
  assert.ok(text(2).includes('15%'));
});

test('level 3: steel, pipe and the deals table', () => {
  assert.equal(q(3, 3).answer, cents(700 - 600));
  assert.equal(q(3, 4).answer, cents(800 - 600));
  assert.equal(q(3, 5).answer, cents(420 + (500 - 420)));
  const t = rows(3, 4);
  for (const [name, yr] of [['WTO', 1995], ['Canada-US Free Trade Agreement', 1989], ['NAFTA', '1994 (replaced in 2020)'], ['CUSMA', 2020], ['CETA', 2017], ['CPTPP', 2018]]) assert.ok(t.includes(name) && t.includes(String(yr)), name);
  const right = (x) => x.options[x.answer].text;
  assert.equal(right(q(3, 7)), 'The WTO'); assert.equal(right(q(3, 8)), 'CPTPP'); assert.equal(right(q(3, 9)), 'CETA'); assert.equal(right(q(3, 10)), 'CUSMA');
});

test('level 4: bike winners, tariff collected, exchange-rate hoodie', () => {
  assert.deepEqual(q(4, 5).figure.bars.map((b) => b.value), [40000, 50000, 46000]);
  assert.equal(q(4, 5).answer, 2);
  assert.equal(q(4, 3).answer, cents(100 * 30));
  assert.equal(q(4, 4).answer, cents(460 - 400));
  assert.equal(q(4, 8).answer, cents(50 * 1.40));
  assert.equal(q(4, 9).answer, cents(50 * 1.40 * 1.20));
  assert.equal(q(4, 10).answer, cents(50 * 1.50));
  assert.ok(text(4).includes('C$70.00') && text(4).includes('C$14.00'));
});
