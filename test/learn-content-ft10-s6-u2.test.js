// Content check for the Learning Road unit "The marketing mix" (ft10-s6-u2). No outline exists for section 6: every figure is recomputed from
// the running company (modules/learn/companies/north-star-pins.js); nothing is typed twice.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as C from '../modules/learn/companies/north-star-pins.js';

const course = JSON.parse(fs.readFileSync(new URL('../modules/learn/content/fintech10.json', import.meta.url), 'utf8'));
const unit = course.sections.flatMap((s) => s.units).find((u) => u.id === 'ft10-s6-u2');
const Q = new Map(unit.levels.flatMap((l) => l.questions).map((q) => [q.id, q]));
const right = (id) => { const q = Q.get(id); return q.options[q.answer].text; };
const num = (id) => Q.get(id).answer;
const { money: m, buyersAt, PRICE, COMPETITORS: K, SURVEY, FIXED, SUPPLY, COMPANY, unitCostCents: cost, markupCents } = C;
const prices = SURVEY.most.map((x) => x.cents);
const kind = (n) => K.find((k) => k.name === n).cents;
const fixed = (n) => FIXED.find((f) => f.name === n).cents;
const gp = (p, n = buyersAt(p)) => n * (p - cost);
const online = kind('Online pin shop');

test('shape: 3 levels, 4-6 cards, 7-10 questions, ids, outcome codes, no pictures yet, no go button', () => {
  assert.equal(unit.title, 'The marketing mix');
  assert.equal(unit.blurb, 'Product, price, place and promotion, and the pitch that sells the idea.');
  assert.deepEqual(unit.outcome_codes, ['FIN1910 2.1.5', 'FIN1910 2.1.6', 'FIN1910 4.1.3', 'FIN1910 2.4', 'MAM1030 2.1', 'MAM1030 2.2', 'MAM1030 2.3']);
  assert.equal(unit.levels.length, 3);
  unit.levels.forEach((l, i) => {
    assert.equal(l.id, `ft10-s6-u2-l${i + 1}`);
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
  const p = (n) => buyersAt(n) * n;
  const allowed = new Set([...K.map((k) => k.cents), ...prices, PRICE.round1, PRICE.round2, cost, markupCents, 3 * PRICE.round1, online - cost, prices[2] - cost, prices[0] - cost,
    ...FIXED.map((f) => f.cents), fixed('Posters') + fixed('Display board and signs'), C.inventoryCostCents, C.fixedCents, C.startUpCents,
    ...prices.map((x) => gp(x)), gp(500), p(500), buyersAt(500) * cost]);
  const found = JSON.stringify(unit).match(/\$[\d,]+(?:\.\d\d)?/g) ?? [];
  assert.ok(found.length > 60);
  for (const f of found) assert.ok(allowed.has(Math.round(parseFloat(f.slice(1).replace(/,/g, '')) * 100)), `${f} is not from the company file`);
});

test('level 1: the 4 Ps table, the two mixes, the posters', () => {
  const L = unit.levels[0], d = COMPANY.designs;
  assert.deepEqual(L.cards[1].figure.rows, [['Product', `Enamel pins in two designs, ${d[0]} and ${d[1]}`], ['Price', `${m(PRICE.round1)} a pin`], ['Place', 'A table at the school winter market'], ['Promotion', 'Posters and announcements']]);
  assert.deepEqual(L.cards[4].figure.rows[1], ['Price', m(PRICE.round1), m(online)]);
  assert.ok(L.cards[3].text.includes(`The posters cost ${m(fixed('Posters'))}`));
  assert.equal(right('ft10-s6-u2-l1-q6'), `${fixed('Posters') / PRICE.round1} pins`);
  assert.equal(fixed('Posters') % PRICE.round1, 0);
  assert.equal(num('ft10-s6-u2-l1-q7'), 3 * PRICE.round1);
  assert.equal(num('ft10-s6-u2-l1-q8'), (buyersAt(PRICE.round1) * 100) / SURVEY.asked);
  assert.ok(Q.get('ft10-s6-u2-l1-q8').prompt.includes(`${buyersAt(PRICE.round1)} of the ${SURVEY.asked}`));
  assert.deepEqual(['q2', 'q3', 'q4', 'q5', 'q9'].map((k) => right(`ft10-s6-u2-l1-${k}`)), ['Place', 'Promotion', 'Product', 'Place', 'Price']);
  assert.equal(right('ft10-s6-u2-l1-q1'), 'Product, price, place, promotion');
  assert.match(L.cards[0].text, /product, price, place and promotion/);
});

test('level 2: markup, cost-plus, the bars, gross profit at each price', () => {
  const L = unit.levels[1];
  assert.deepEqual(L.cards[1].figure.rows, [[m(cost), m(markupCents), m(PRICE.round1)]]);
  assert.equal(markupCents, PRICE.round1 - cost);
  assert.ok(L.cards[1].text.includes(`${(markupCents * 100) / cost}%`));
  assert.equal(num('ft10-s6-u2-l2-q2'), online - cost);
  assert.equal(num('ft10-s6-u2-l2-q3'), ((online - cost) * 100) / cost);
  assert.equal(num('ft10-s6-u2-l2-q4'), cost + (prices[2] - cost));
  assert.equal(prices[2], 800);
  const f = Q.get('ft10-s6-u2-l2-q5').figure;
  assert.equal(f.unit, '$');
  assert.deepEqual(f.bars.map((b) => b.value), [kind('Button stand'), kind('Sticker table'), PRICE.round1, online]);
  assert.deepEqual(f.bars.map((b, i) => [i, b.value < cost]).filter((x) => x[1]).map((x) => x[0]), [num('ft10-s6-u2-l2-q5')], 'exactly one price is below the cost');
  assert.deepEqual(L.cards[3].figure.rows, prices.map((p) => [m(p), String(buyersAt(p)), m(gp(p))]));
  assert.equal(num('ft10-s6-u2-l2-q7'), gp(500));
  assert.equal(buyersAt(500), 18);
  assert.ok(Q.get('ft10-s6-u2-l2-q7').prompt.includes(`${buyersAt(500)} of the ${SURVEY.asked}`));
  const best = prices.reduce((a, p) => (gp(p) > gp(a) ? p : a));
  assert.equal(right('ft10-s6-u2-l2-q8'), m(best));
  assert.equal(best, PRICE.round1);
  assert.ok(gp(prices[0]) < gp(best) && buyersAt(prices[0]) > buyersAt(best), 'the $4 price has the most buyers and less gross profit');
  assert.equal(right('ft10-s6-u2-l2-q10'), `Each pin leaves only ${m(prices[0] - cost)} after its cost`);
  assert.deepEqual(COMPANY.designs.length, 2);
  assert.match(L.cards[0].text, /what one item costs the business to get ready to sell/i);
});

test('level 3: start-up money, the team and the parts of the pitch', () => {
  const L = unit.levels[2];
  const rows = [[`${SUPPLY.units} pins ready to sell`, m(C.inventoryCostCents)], ...FIXED.map((f) => [f.name, m(f.cents)])];
  assert.deepEqual(L.cards[2].figure.rows, [...rows, ['Total', m(C.startUpCents)]]);
  assert.deepEqual(Q.get('ft10-s6-u2-l3-q3').figure.rows, rows);
  assert.equal(num('ft10-s6-u2-l3-q3'), [C.inventoryCostCents, ...FIXED.map((f) => f.cents)].reduce((s, x) => s + x, 0));
  assert.equal(num('ft10-s6-u2-l3-q3'), C.startUpCents);
  assert.ok(L.cards[2].text.includes(`${m(C.startUpCents)}: ${m(C.inventoryCostCents)} for the pins and ${m(C.fixedCents)} for the market costs`));
  assert.equal(num('ft10-s6-u2-l3-q4'), fixed('Display board and signs') + fixed('Posters'));
  assert.deepEqual(L.cards[3].figure.rows, COMPANY.partners.map((x) => [x.name, x.role]));
  const mei = COMPANY.partners.find((x) => x.role === 'Production lead');
  assert.equal(right('ft10-s6-u2-l3-q6'), mei.name);
  assert.equal(right('ft10-s6-u2-l3-q9'), `"Hello, I'm ${mei.name}, the ${mei.role.toLowerCase()}."`);
  assert.deepEqual(L.cards[1].figure.rows.map((r) => r[0]), ['The idea', 'The target market', 'The 4 Ps', 'The money needed', 'The team']);
  assert.ok(Q.get('ft10-s6-u2-l3-q5').prompt.includes(m(PRICE.round1)));
  assert.equal(C.GLOSSARY.pitch, 'A short talk that asks someone to back a business idea.');
  assert.ok(L.cards[0].text.startsWith('A pitch is a short talk that asks someone to back a business idea.'));
});

test('scope: no tax, wages, interest, real country or exchange rate, and no show name', () => {
  const t = JSON.stringify(unit);
  for (const w of [/GST/, /sales tax/i, /wage/i, /interest/i, /Canada/, /Shark/i, /!/]) assert.doesNotMatch(t, w);
});
