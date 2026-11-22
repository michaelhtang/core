// Content check for the Learning Road unit "Inflation" (ft10-s2-u3): the game's inflation constants and index steps are recomputed from modules/rates,
// the raise default is read from modules/jobs, every figure quoted from Mr. Tang's Lesson 10 outline is pinned to a cited line, every number answer is
// recomputed from its prompt, and the shape of the unit is checked.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { moduleSource } from './module-source.js';
import { INFLATION_BP, INDEX_BASE_BP } from '../modules/rates/constants.js';
import rates from '../modules/rates/index.js';

const course = JSON.parse(fs.readFileSync(new URL('../modules/learn/content/fintech10.json', import.meta.url), 'utf8'));
const unit = course.sections.flatMap((s) => s.units).find((u) => u.id === 'ft10-s2-u3');
const Q = new Map(unit.levels.flatMap((l) => l.questions).map((q) => [q.id, q]));
const text = (l) => unit.levels[l - 1].cards.map((c) => c.text).join(' ');
const c = (d) => Math.round(d * 100);
const OUT = 'slide-studio/courses/fintech10/context/claude-project/docs/claude_Lesson 10 Slide Outline Sept 18.md';

// Figures quoted from the Lesson 10 outline. They are class examples, never current facts; the cards say "example" or "class example".
const OUTLINE = {
  target: { value: '2%', range: '1% to 3%', cite: `${OUT} line 246 (Sources: "Inflation target 2%, range 1-3%")` },
  slide12: { account: 1.5, inflation: 3, halving: 48, cite: `${OUT} lines 207-209 (slide 12: savings 1.5%, inflation 3%, 72 / 1.5 = 48 years)` },
  slide11: { inflation: 3, doubling: 24, cite: `${OUT} lines 200-203 (slide 11: 3% gives 24 years)` },
};

test('shape: 4 levels, 4-6 cards, 7-10 questions, ids, outcome codes, one go button, no pictures yet', () => {
  assert.ok(unit, 'unit ft10-s2-u3 is in fintech10.json');
  assert.equal(unit.title, 'Inflation');
  assert.equal(unit.blurb, 'Prices rise a little every year, so a dollar that sits still buys less.');
  assert.deepEqual(unit.outcome_codes, ['FIN1010 2.3', 'FIN1010 2.4']);
  assert.equal(unit.levels.length, 4);
  unit.levels.forEach((l, i) => {
    assert.equal(l.id, `ft10-s2-u3-l${i + 1}`);
    assert.ok(l.cards.length >= 4 && l.cards.length <= 6, `${l.id}: ${l.cards.length} cards`);
    assert.ok(l.questions.length >= 7 && l.questions.length <= 10, `${l.id}: ${l.questions.length} questions`);
    assert.ok(l.questions.filter((q) => q.type === 'number').length >= 2);
    assert.ok(l.questions.some((q) => q.figure));
    l.questions.forEach((q, k) => assert.equal(q.id, `${l.id}-q${k + 1}`));
  });
  assert.ok(!JSON.stringify(unit).includes('"image"'));
  assert.deepEqual(unit.levels[3].go, { building: 'bank-of-daa', label: 'Open the Bank of DAA' });
  assert.ok(unit.levels.every((l, i) => i === 3 || !l.go));
});

test('the Bank of DAA is the building the go button opens, and its screen shows the rate and the rise since the start', () => {
  assert.equal(rates.panels.find((p) => p.building.key === 'bank-of-daa').building.name, 'Bank of DAA');
  const ui = fs.readFileSync(new URL('../modules/rates/ui/rates.js', import.meta.url), 'utf8');
  assert.ok(ui.includes('Prices rise ${pct(v.inflation_bp)} a year') && ui.includes('higher than at the start of the season'));
});

test('game constants: the starting rate and the index steps (level 4 table)', () => {
  assert.equal(INFLATION_BP, 210);
  assert.equal(INDEX_BASE_BP, 10000);
  assert.ok(text(4).includes('2.1% a year') && text(4).includes('1.0000'));
  const step = (bp) => Math.round((bp * (10000 + INFLATION_BP)) / 10000);   // the formula in modules/rates/index.js onTick
  const idx = [INDEX_BASE_BP]; while (idx.length < 5) idx.push(step(idx.at(-1)));
  assert.deepEqual(idx, [10000, 10210, 10424, 10643, 10867]);
  const fig = unit.levels[3].cards[1].figure;
  assert.deepEqual(fig.rows.map((r) => r[1]), idx.map((bp) => (bp / 10000).toFixed(4)));
  assert.deepEqual(fig.rows.map((r) => r[2]), idx.map((bp) => `+${((bp - 10000) / 100).toFixed(2)}%`));
  assert.deepEqual(Q.get('ft10-s2-u3-l4-q2').figure, fig);
  const src = moduleSource('jobs');
  assert.equal(Number(/RAISE_BP = (\d+)/.exec(src)[1]), 300, 'level 4 card 4 says the game starts at a 3% raise');
  assert.ok(/PROMO_MONTHS = 12/.test(src), 'a raise comes after 12 months in a job');
});

test('outline figures: the class examples are quoted as written and called examples', () => {
  assert.ok(text(1).includes(`near ${OUTLINE.target.value}`) && text(1).includes(`range of ${OUTLINE.target.range}`) && /examples from class/.test(text(1)));
  assert.ok(/class example/.test(text(3)) && text(3).includes('1.5%') && text(3).includes('3%'));
  assert.equal(72 / OUTLINE.slide12.account, OUTLINE.slide12.halving);
  assert.ok(text(3).includes(`72 / 1.5 = ${OUTLINE.slide12.halving} years`));
  assert.equal(72 / OUTLINE.slide11.inflation, OUTLINE.slide11.doubling);
  assert.ok(text(2).includes('72 / 3 = 24 years'));
});

test('arithmetic: every number answer is recomputed from its prompt', () => {
  const idx1 = 1.021, idx2 = 1.0424;
  const want = {
    'ft10-s2-u3-l1-q3': ((20.6 - 20) / 20) * 100,
    'ft10-s2-u3-l1-q4': c(80 * 1.03),
    'ft10-s2-u3-l1-q5': ((84 - 80) / 80) * 100,
    'ft10-s2-u3-l1-q7': c(150 * 0.04),
    'ft10-s2-u3-l2-q2': c(200 * 1.03 * 1.03),
    'ft10-s2-u3-l2-q3': c(500 * 1.02 ** 3),
    'ft10-s2-u3-l2-q6': (1 / 2) * 100,
    'ft10-s2-u3-l2-q7': 72 / 9,
    'ft10-s2-u3-l3-q2': c(1000 * 1.015),
    'ft10-s2-u3-l3-q3': c(1030 - 1015),
    'ft10-s2-u3-l3-q4': 3.5 - 1,
    'ft10-s2-u3-l3-q8': c(2030 / 1.03),
    'ft10-s2-u3-l4-q2': c(400 * idx1),
    'ft10-s2-u3-l4-q3': c(400 * idx2),
    'ft10-s2-u3-l4-q5': c(2000 * 1.03),
    'ft10-s2-u3-l4-q6': c(2000 * 1.03) - (c(900 * idx1) + c(400 * idx1)),
  };
  const numbers = [...Q.values()].filter((q) => q.type === 'number').map((q) => q.id);
  assert.deepEqual(Object.keys(want).sort(), numbers.sort(), 'every number question is covered by this test');
  for (const [id, v] of Object.entries(want)) assert.ok(Math.abs(Q.get(id).answer - v) < 1e-6, `${id}: stored ${Q.get(id).answer}, recomputed ${v}`);
  // the rent and bills in card 3 and the example in card 5 of level 4
  assert.equal(c(900 * idx1), 91890); assert.equal(c(400 * idx1), 40840); assert.equal(c(900 * idx1) + c(400 * idx1), 132730);
  assert.equal(c(2000 * idx1), 204200); assert.equal(204200 - 132730, 71470); assert.ok(Math.abs(71470 - c(700 * idx1)) < 1e-6);
  assert.ok(text(4).includes('$714.70') && text(4).includes('$1,327.30') && text(4).includes('$2,042.00'));
});

test('tables and bars: the growth figures recompute', () => {
  const fix = (x) => `$${x.toLocaleString('en-CA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  for (const [yrs, shown] of unit.levels[1].cards[1].figure.rows) assert.equal(shown, fix(Math.round(100 * 1.03 ** Number(yrs) * 100) / 100), `year ${yrs}`);
  for (const [rate, yrs, shown] of unit.levels[1].cards[4].figure.rows) {
    const r = parseInt(rate); assert.equal(Number(yrs), 72 / r);
    assert.equal(shown, `$${Math.round(100 * (1 + r / 100) ** (72 / r))}`);
  }
  const bars = Q.get('ft10-s2-u3-l2-q8').figure.bars;
  bars.forEach((b, i) => assert.equal(b.value, Math.round(100 * 1.03 ** (i * 6) * 100)));
  assert.equal(Q.get('ft10-s2-u3-l2-q8').answer, bars.findIndex((b) => b.value > 20000));
  const gap = Q.get('ft10-s2-u3-l3-q9').figure.rows;
  const n = (s) => Math.round(parseFloat(s.replace(/[$,]/g, '')) * 100);
  gap.forEach(([y, basket, bal, g]) => {
    assert.equal(basket, fix(Math.round(1000 * 1.03 ** y * 100 + 1e-6) / 100));   // + 1e-6: float noise on an exact half cent
    assert.equal(bal, fix(Math.round(1000 * 1.015 ** y * 100 + 1e-6) / 100));
    assert.equal(n(g), n(basket) - n(bal));
  });
  assert.ok(gap.every((r, i) => i === 0 || n(r[3]) > n(gap[i - 1][3])));
  const b1 = Q.get('ft10-s2-u3-l1-q6'); assert.equal(b1.figure.bars[b1.answer].value, Math.max(...b1.figure.bars.map((b) => b.value)));
  assert.equal(Math.round((1 - 1.015 / 1.03) * 10000) / 100, 1.46);
  assert.equal(c(12.3 - 12), 30);
});
