// Content check for the Learning Road unit "The business idea" (ft10-s6-u1). No outline exists for section 6: every figure is recomputed from
// the running company (modules/learn/companies/north-star-pins.js); nothing is typed twice.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as C from '../modules/learn/companies/north-star-pins.js';

const course = JSON.parse(fs.readFileSync(new URL('../modules/learn/content/fintech10.json', import.meta.url), 'utf8'));
const unit = course.sections.flatMap((s) => s.units).find((u) => u.id === 'ft10-s6-u1');
const Q = new Map(unit.levels.flatMap((l) => l.questions).map((q) => [q.id, q]));
const right = (id) => { const q = Q.get(id); return q.options[q.answer].text; };
const num = (id) => Q.get(id).answer;
const { money: m, buyersAt, PRICE, COMPETITORS: K, SURVEY, unitCostCents: cost } = C;
const prices = SURVEY.most.map((x) => x.cents);
const kind = (n) => K.find((k) => k.name === n).cents;

test('shape: 2 levels, 4-6 cards, 7-10 questions, ids, outcome codes, no pictures yet, no go button', () => {
  assert.equal(unit.title, 'The business idea');
  assert.equal(unit.blurb, 'What a business is, and who will buy from yours.');
  assert.deepEqual(unit.outcome_codes, ['FIN1910 1', 'FIN1910 2.1.2', 'FIN1910 2.1.3', 'FIN1910 2.1.5', 'FIN1910 4.1.2', 'FIN1910 4.1.3']);
  assert.equal(unit.levels.length, 2);
  unit.levels.forEach((l, i) => {
    assert.equal(l.id, `ft10-s6-u1-l${i + 1}`);
    assert.ok(l.cards.length >= 4 && l.cards.length <= 6, `${l.id}: ${l.cards.length} cards`);
    assert.ok(l.questions.length >= 7 && l.questions.length <= 10, `${l.id}: ${l.questions.length} questions`);
    assert.ok(l.questions.some((q) => q.figure), `${l.id}: a question with a figure`);
    assert.ok(l.questions.filter((q) => q.type === 'number').length >= 2);
    l.questions.forEach((q, k) => assert.equal(q.id, `${l.id}-q${k + 1}`));
    assert.equal(l.go, undefined);
    for (const f of [...l.cards, ...l.questions].map((x) => x.figure).filter(Boolean)) if (f.kind === 'table') assert.ok(f.columns.length <= 4);
  });
  assert.ok(!JSON.stringify(unit).includes('"image"'));
});

test('every dollar amount in the unit is one the company file produces', () => {
  const allowed = new Set([...K.map((k) => k.cents), ...prices, PRICE.round1, PRICE.round2, cost, 10 * PRICE.round1, 10 * cost, 10 * (PRICE.round1 - cost),
    ...prices.map((p) => buyersAt(p) * p), kind('Online pin shop') - PRICE.round1, buyersAt(600) * 600 - buyersAt(400) * 400]);
  const found = JSON.stringify(unit).match(/\$[\d,]+(?:\.\d\d)?/g) ?? [];
  assert.ok(found.length > 40);
  for (const f of found) assert.ok(allowed.has(Math.round(parseFloat(f.slice(1).replace(/,/g, '')) * 100)), `${f} is not from the company file`);
});

test('level 1: the sales and profit of ten pins, the partners, the tests', () => {
  assert.equal(num('ft10-s6-u1-l1-q5'), 10 * PRICE.round1);
  assert.equal(num('ft10-s6-u1-l1-q6'), 10 * PRICE.round1 - 10 * cost);
  assert.equal(Q.get('ft10-s6-u1-l1-q6').prompt.includes(m(cost)), true);
  assert.ok(Q.get('ft10-s6-u1-l1-q7').prompt.includes(m(kind('Button stand'))));
  assert.ok(kind('Button stand') < cost, 'the case price is below the cost per unit');
  assert.equal(C.COMPANY.partners.length, 4);
  assert.match(unit.levels[0].cards[3].text, /two or more people, called partners/);
  assert.equal(right('ft10-s6-u1-l1-q3'), 'A partnership');
  const tests = unit.levels[0].cards[4].figure.rows;
  assert.deepEqual(tests[1], ['A price above the cost', `${m(PRICE.round1)} a pin, and a pin costs ${m(cost)}`]);
  // definitions repeat the glossary
  const t3 = unit.levels[0].cards[2].text;
  assert.ok(t3.includes('sells a product or a service to earn a profit') && t3.includes('taken away from the sales'));
  assert.ok(t3.includes('A service is work it does for a customer, such as a repair'));
});

test('level 2: the competitor tables and the survey come from COMPETITORS and SURVEY', () => {
  const L = unit.levels[1];
  assert.deepEqual(L.cards[1].figure.rows, K.map((k) => [k.name, k.sells, m(k.cents)]));
  assert.deepEqual(L.cards[2].figure.rows, K.map((k) => [k.name, k.strength, k.weakness]));
  assert.deepEqual(L.cards[3].figure.rows, [...SURVEY.most.map((x) => [m(x.cents), String(x.students)]), ['Would not buy', String(SURVEY.wouldNotBuy)], ['Students asked', String(SURVEY.asked)]]);
  assert.deepEqual(L.cards[4].figure.rows, prices.map((p) => [m(p), String(buyersAt(p)), m(buyersAt(p) * p)]));
  assert.equal(num('ft10-s6-u1-l2-q3'), kind('Online pin shop') - PRICE.round1);
  assert.equal(right('ft10-s6-u1-l2-q5'), `${buyersAt(500)} students`);
  assert.equal(buyersAt(500), 18);
  assert.equal(num('ft10-s6-u1-l2-q6'), (buyersAt(400) * 100) / SURVEY.asked);
  assert.ok(Q.get('ft10-s6-u1-l2-q6').prompt.includes(`${buyersAt(400)} of the ${SURVEY.asked}`));
  const f = Q.get('ft10-s6-u1-l2-q7').figure;
  assert.deepEqual(f.bars.map((b) => b.value), prices.map((p) => buyersAt(p) * p));
  assert.equal(f.unit, '$');
  assert.equal(num('ft10-s6-u1-l2-q7'), f.bars.indexOf(f.bars.reduce((a, b) => (b.value > a.value ? b : a))));
  assert.equal(num('ft10-s6-u1-l2-q8'), buyersAt(600) * 600 - buyersAt(400) * 400);
  assert.equal(right('ft10-s6-u1-l2-q4'), 'The online pin shop');
  assert.equal(K.find((k) => k.sells === 'enamel pins').name, 'Online pin shop');
});

test('scope: no tax, wages, interest, real country or exchange rate, and no show name', () => {
  const t = JSON.stringify(unit);
  for (const w of [/GST/, /sales tax/i, /wage/i, /interest/i, /Canada/, /Shark/i, /!/]) assert.doesNotMatch(t, w);
});
