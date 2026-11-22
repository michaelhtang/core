// Content check for the Learning Road unit "What money is" (ft10-s4-u1): every number answer is recomputed, the game's rates, gaps, savings interest and
// mortgage payment come from modules/rates, modules/savings and modules/housing, figures from Mr. Tang's Lesson 30 outline are pinned to cited lines,
// and the shape of the unit is checked. The OUTLINE table below carries the cited lines (checked by hand against the outline when the unit was written).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import rates, { derive } from '../modules/rates/index.js';
import { POLICY_BP, SPREADS, CARD_APR_BP, ANNOUNCE_MONTHS } from '../modules/rates/constants.js';
import { monthlyInterest } from '../modules/savings/index.js';
import { payment } from '../modules/housing/mortgage.js';
import { TERM_MONTHS } from '../modules/housing/constants.js';

const course = JSON.parse(fs.readFileSync(new URL('../modules/learn/content/fintech10.json', import.meta.url), 'utf8'));
const units = course.sections.flatMap((s) => s.units);
const unit = units.find((u) => u.id === 'ft10-s4-u1');
const Q = new Map(unit.levels.flatMap((l) => l.questions).map((q) => [q.id, q]));
const q = (l, n) => Q.get(`ft10-s4-u1-l${l}-q${n}`);
const text = (l) => unit.levels[l - 1].cards.map((c) => c.text).join(' ');
const m = (c) => `$${(c / 100).toLocaleString('en-CA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const pc = (bp) => `${(bp / 100).toFixed(2)}%`;
const D = (bp) => derive({ config: {} }, bp);
const OUT = 'slide-studio/courses/fintech10/context/outlines/2026-10-26 Lesson 30.md';

// Figures and facts quoted from the Lesson 30 outline (class examples, never current facts).
const OUTLINE = {
  island: { rows: [[1000, 100, 10], [2000, 100, 20], [2000, 200, 10], [1000, 80, 12.5]], cite: `${OUT} lines 230-233 (pizza island scenarios) and 327-330 (walkthrough steps 6-9)` },
  snack: { start: 5, years: 10, rows: [[1, 5.52, 90.53], [2, 6.09, 82.03], [6, 8.95, 55.84]], doubling6: 12, cite: `${OUT} lines 258-260 (record box), 266 (check values) and 400 (exit slip: 6% doubles in 12 years)` },
  facts: { cite: `${OUT} lines 28-32 (flag 2: notes and coins, no gold, bank deposits and loans, policy rate to slow inflation, target) and 308-317 (walkthrough Part 1)` },
  hurt: { cite: `${OUT} lines 138 and 140 (slide 7: drawer or debt; why not zero)` },
  loop: { cite: `${OUT} lines 116-120 (slide 5: the loop and the brake)` },
};

test('shape: 5 levels, 4-6 cards, 7-10 questions, ids, outcome codes, one go button, no pictures yet', () => {
  assert.ok(unit, 'unit ft10-s4-u1 is in fintech10.json');
  assert.equal(unit.title, 'What money is');
  assert.equal(unit.blurb, 'Why money exists, who creates it, and where higher prices come from.');
  assert.deepEqual(unit.outcome_codes, ['FIN1010 2.2', 'FIN1010 2.3', 'FIN1010 2.5']);
  assert.equal(unit.levels.length, 5);
  unit.levels.forEach((l, i) => {
    assert.equal(l.id, `ft10-s4-u1-l${i + 1}`);
    assert.ok(l.cards.length >= 4 && l.cards.length <= 6, `${l.id}: ${l.cards.length} cards`);
    assert.ok(l.questions.length >= 7 && l.questions.length <= 10, `${l.id}: ${l.questions.length} questions`);
    assert.ok(l.questions.filter((x) => x.type === 'number').length >= 2, `${l.id}: at least 2 number questions`);
    assert.ok(l.questions.some((x) => x.figure) || l.cards.some((c) => c.figure), `${l.id}: a figure`);
    l.questions.forEach((x, k) => assert.equal(x.id, `${l.id}-q${k + 1}`));
  });
  assert.ok(!JSON.stringify(unit).includes('"image"'));
  assert.deepEqual(unit.levels[4].go, { building: 'bank-of-daa', label: 'Open the Bank of DAA' });
  assert.ok(unit.levels.every((l, i) => i === 4 || !l.go));
  assert.ok(!/\bTim Hortons\b|Robux|Bitcoin|Canva|Money Machine/.test(JSON.stringify(unit)), 'no brand, no later-unit topic, no outside tool');
});

test('the Bank of DAA is the building the go button opens and its screen shows what level 5 says', () => {
  assert.equal(rates.panels.find((p) => p.building.key === 'bank-of-daa').building.name, 'Bank of DAA');
  const ui = fs.readFileSync(new URL('../modules/rates/ui/rates.js', import.meta.url), 'utf8');
  for (const s of ['The policy rate', 'Next announcement: world month', 'A new policy rate of', 'fixed: it does not follow the policy rate', 'Since the last change', '5-year fixed mortgage', 'Credit card APR', 'High-interest savings (HISA)', 'Line of credit']) assert.ok(ui.includes(s), s);
  const t = text(5);
  assert.ok(t.includes('The screen shows when') && t.includes('policy rate, a chart of past rates, and a table of your rates'));
});

test('game constants: the starting rate, the gaps, the card rate and the announcement months (level 5)', () => {
  assert.equal(POLICY_BP, 225);
  assert.deepEqual(SPREADS, { prime: 220, hisa: 50, mortgage5y: 195, mortgageVar: -50, loc: 300 });
  assert.equal(CARD_APR_BP, 2099);
  assert.deepEqual(ANNOUNCE_MONTHS, [1, 3, 4, 6, 7, 9, 10, 12]);
  assert.equal(TERM_MONTHS, 60);
  const t = text(5);
  assert.ok(t.includes(`starts at ${pc(POLICY_BP)}`) && t.includes(`starts the credit card at ${pc(CARD_APR_BP)}`));
  assert.ok(t.includes('months 1, 3, 4, 6, 7, 9, 10 and 12') && t.includes('The game lists 8 a year') && t.includes('set a rate in any month'));
  const d1 = D(POLICY_BP), d2 = D(POLICY_BP + 50);
  const fig = unit.levels[4].cards[2].figure;
  assert.deepEqual(fig.rows, [
    ['Policy rate', '-', pc(d1.policyBp), pc(d2.policyBp)],
    ['Savings (HISA)', 'policy + 0.50', pc(d1.hisaBp), pc(d2.hisaBp)],
    ['Prime', 'policy + 2.20', pc(d1.primeBp), pc(d2.primeBp)],
    ['5-year fixed mortgage', 'policy + 1.95', pc(d1.mortgage5yBp), pc(d2.mortgage5yBp)],
    ['Line of credit', 'prime + 3.00', pc(d1.locBp), pc(d2.locBp)],
    ['Credit card', 'fixed', pc(d1.cardAprBp), pc(d2.cardAprBp)]]);
  assert.equal(d1.hisaBp, 275); assert.equal(d1.mortgage5yBp, 420); assert.equal(d2.hisaBp, 325); assert.equal(d2.mortgage5yBp, 470);
  assert.equal(d1.cardAprBp, d2.cardAprBp);
});

test('level 5 worked examples: Mika\'s savings interest and Rafa\'s payment come from the game\'s functions', () => {
  const d1 = D(POLICY_BP), d2 = D(POLICY_BP + 50);
  const mi1 = monthlyInterest(400000, d1.hisaBp), mi2 = monthlyInterest(400000, d2.hisaBp);
  assert.deepEqual([mi1, mi2], [916, 1083]);
  const t = text(5);
  assert.ok(t.includes(`Mika has $4,000.00`) && t.includes(`she earns ${m(mi1)} the first month`) && t.includes(`she earns ${m(mi2)} the first month.`));
  const pay1 = payment(24000000, d1.mortgage5yBp, 240), pay2 = payment(24000000, d2.mortgage5yBp, 240);
  assert.deepEqual([pay1, pay2], [147514, 153846]);
  const fig = unit.levels[4].cards[4].figure;
  assert.deepEqual(fig.rows, [[pc(POLICY_BP), '4.20%', m(pay1)], [pc(POLICY_BP + 50), '4.70%', m(pay2)]]);
  assert.equal(q(5, 5).answer, pay2 - pay1);
  assert.deepEqual(q(5, 5).figure, fig);
});

test('level 5 number questions are recomputed from the game', () => {
  const d3 = D(300);
  assert.equal(q(5, 1).answer, d3.hisaBp / 100);
  assert.equal(q(5, 2).answer, d3.mortgage5yBp / 100);
  assert.equal(q(5, 3).answer, d3.locBp / 100);
  assert.equal(d3.primeBp, 520);
  const ana = monthlyInterest(500000, D(325).hisaBp);
  assert.equal(D(325).hisaBp, 375);
  assert.equal(q(5, 4).answer, ana);
  assert.equal(q(5, 4).traps[0].value, ana + 1, 'the rounded-up trap');
  assert.ok(q(5, 4).prompt.includes('3.75%'));
  // the point question: the 5-year fixed rate at four policy rates, the first above 5%
  const bars = q(5, 6).figure.bars;
  assert.deepEqual(bars.map((b) => b.value), [125, 225, 325, 425].map((p) => D(p).mortgage5yBp / 100));
  assert.equal(bars.findIndex((b) => b.value > 5), q(5, 6).answer);
  assert.equal(q(5, 7).options[q(5, 7).answer].text, 'It does not change');
  assert.ok(q(5, 7).prompt.includes(pc(CARD_APR_BP)));
});

test('level 1 and 2: price and loan arithmetic', () => {
  assert.equal(q(1, 6).answer, 9000 - 4000);
  assert.equal(q(1, 7).answer, 1500 + 6500);
  assert.deepEqual(q(1, 6).figure.rows, [['Hoodie', '$40.00'], ['Jacket', '$90.00'], ['Cap', '$15.00'], ['Backpack', '$65.00']]);
  assert.equal(q(1, 6).traps[0].value, 9000 + 4000);
  assert.equal(q(2, 6).answer, 15000 + 300000);
  assert.equal(q(2, 6).traps[0].value, 300000);
  assert.deepEqual(unit.levels[1].cards[4].figure.rows[0], ['Kai\'s account', m(20000), m(520000)]);
  assert.equal(q(2, 7).answer, 8000000 + 1200000);
  assert.deepEqual(q(2, 7).figure.bars.map((b) => b.value), [8000000, 1200000]);
});

test('level 3: the pizza island and the snack table (class example) are recomputed', () => {
  const rows = unit.levels[2].cards[1].figure.rows;
  assert.deepEqual(rows.map((r) => [Number(r[1].replace(/[$,]/g, '')), Number(r[2]), Number(r[3].replace(/[$,]/g, ''))]), OUTLINE.island.rows);
  for (const [money, pizzas, price] of OUTLINE.island.rows) assert.equal(money / pizzas, price);
  assert.ok(text(3).includes('$1,000 chasing 100 pizzas makes each pizza $10') && text(3).includes('$1,000 chases 80 pizzas and each costs $12.50') && text(3).includes('keep 100 pizzas, and the price doubles to $20'));
  assert.equal(q(3, 1).answer, (1200 / 60) * 100);
  assert.equal(q(3, 2).answer, (1800 / 60) * 100);
  assert.equal(q(3, 4).answer, (1200 / (60 - 12)) * 100);
  assert.equal(q(3, 4).traps[0].value, (1200 / 60) * 100);
  assert.equal(2000 / 200, 10);                              // q3 right option: it stays $10.00
  assert.equal(q(3, 3).options[q(3, 3).answer].text, 'It stays at $10.00');
  const snack = (r) => Math.round(OUTLINE.snack.start * 100 * (1 + r / 100) ** OUTLINE.snack.years);
  const buys = (r) => Math.round(10000 / (1 + r / 100) ** OUTLINE.snack.years);
  const fig = unit.levels[2].cards[4].figure;
  OUTLINE.snack.rows.forEach(([r, s, b], i) => {
    assert.equal(snack(r), Math.round(s * 100)); assert.equal(buys(r), Math.round(b * 100));
    assert.deepEqual(fig.rows[i], [`${r}%`, m(snack(r)), m(buys(r))]);
  });
  assert.ok(text(3).includes('At 2%, a $100 bill buys what $82.03 buys today'));
  assert.equal(q(3, 6).answer, snack(6) - 500);
  assert.equal(q(3, 7).answer, 10000 - buys(6));
  assert.ok(q(3, 7).prompt.includes(m(buys(6))));
  assert.deepEqual(q(3, 6).figure, fig);
  assert.equal(72 / 6, OUTLINE.snack.doubling6);
  assert.equal(q(3, 8).options[q(3, 8).answer].text, '12 years');
});

test('level 4: interest arithmetic and the target as the Inflation unit states it', () => {
  assert.equal(q(4, 3).answer, 900000 * 4 / 100);
  assert.equal(q(4, 3).traps[0].value, 900000 * 4);
  assert.equal(q(4, 4).answer, 900000 * 5 / 100 - 900000 * 4 / 100);
  assert.equal(q(4, 5).answer, 500000 * 3 / 100 - 500000 * 2 / 100);
  const fig = unit.levels[3].cards[2].figure;
  assert.deepEqual(fig.rows, [['Dana (borrows $12,000)', '5%', m(1200000 * 5 / 100), '6%', m(1200000 * 6 / 100)], ['Noor (saves $8,000)', '2%', m(800000 * 2 / 100), '3%', m(800000 * 3 / 100)]]);
  assert.ok(text(4).includes('Dana pays $120 more a year. Noor earns $80 more.'));
  assert.equal(1200000 * 6 / 100 - 1200000 * 5 / 100, 12000);
  assert.equal(800000 * 3 / 100 - 800000 * 2 / 100, 8000);
  const inflation = units.find((u) => u.id === 'ft10-s2-u3');
  const target = 'The Bank of Canada aims to keep inflation near 2%, inside a range of 1% to 3%.';
  assert.ok(inflation.levels[0].cards.some((c) => c.text.includes(target)), 'the Inflation unit states the target this way');
  assert.ok(text(4).includes(target));
});

test('outline facts: quoted as written (the cited lines are in OUTLINE above)', () => {
  assert.ok(text(1).includes('Trading without money, thing for thing, is called barter'));
  assert.ok(text(2).includes('The Canadian dollar is not backed by gold') && text(2).includes('Fiat means "by order"') && text(2).includes('It types new money into the borrower\'s account'));
  assert.ok(text(2).includes('Bank of Canada. It makes the bank notes. The Royal Canadian Mint makes the coins'));
  assert.ok(text(4).includes('To slow rising prices, the Bank raises it') && text(4).includes('That can stall the economy'));
  assert.ok(OUTLINE.facts.cite && OUTLINE.hurt.cite && OUTLINE.loop.cite);
});
