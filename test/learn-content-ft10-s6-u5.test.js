// Content check for the Learning Road unit "Sales round one" (ft10-s6-u5). No outline exists for section 6: every figure is recomputed
// from the example business (modules/learn/companies/north-star-pins.js), never typed. The lessons only READ the results of the first
// market day; they say nothing about how a round is run.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as C from '../modules/learn/companies/north-star-pins.js';

const course = JSON.parse(fs.readFileSync(new URL('../modules/learn/content/fintech10.json', import.meta.url), 'utf8'));
const unit = course.sections.flatMap((s) => s.units).find((u) => u.id === 'ft10-s6-u5');
const Q = new Map(unit.levels.flatMap((l) => l.questions).map((q) => [q.id, q]));
const num = (id) => Q.get(id).answer;
const right = (id) => { const q = Q.get(id); return q.options[q.answer].text; };
const { money: M } = C;

// ---- independent recomputation from the company file's inputs ----
const P = C.PRICE.round1, UC = C.unitCostCents;
const pins = C.ROUNDS[0].pins, sold = pins.Aurora + pins.Bison;
const sales = sold * P, cogs = sold * UC, gross = sales - cogs;
const exp = C.ROUNDS[0].expenses, expTotal = exp.reduce((s, e) => s + e.cents, 0), net = gross - expTotal;
const fPins = C.FORECAST.round1Pins, fSales = fPins * P, fCogs = fPins * UC, fGross = fSales - fCogs, fNet = fGross - expTotal;
const left = C.SUPPLY.units - sold, inv = left * UC, be = C.fixedCents / (P - UC);

test('shape: 2 levels, 4-6 cards, 7-10 questions, ids, outcome codes, no pictures yet, no go button', () => {
  assert.equal(unit.title, 'Sales round one');
  assert.equal(unit.blurb, 'Read the first market day, and turn it into an income statement.');
  assert.deepEqual(unit.outcome_codes, ['FIN1910 3.1', 'FIN1910 3.2', 'FIN1910 4.1.3', 'FIN1015 1.3', 'FIN1910 2.1.1']);
  assert.equal(unit.levels.length, 2);
  unit.levels.forEach((l, i) => {
    assert.equal(l.id, `ft10-s6-u5-l${i + 1}`);
    assert.ok(l.cards.length >= 4 && l.cards.length <= 6, `${l.id}: ${l.cards.length} cards`);
    assert.ok(l.questions.length >= 7 && l.questions.length <= 10, `${l.id}: ${l.questions.length} questions`);
    assert.ok(l.questions.some((q) => q.figure) && l.questions.filter((q) => q.type === 'number').length >= 2);
    l.questions.forEach((q, k) => assert.equal(q.id, `${l.id}-q${k + 1}`));
    assert.equal(l.go, undefined);
    for (const c of l.cards) if (c.figure?.kind === 'table') assert.ok(c.figure.columns.length <= 4);
  });
  assert.ok(!JSON.stringify(unit).includes('"image"'));
});

test('level 1: the first market day, read from the company file', () => {
  const L = unit.levels[0], rows = (i) => L.cards[i].figure.rows;
  assert.deepEqual(rows(0), [['Aurora', `${pins.Aurora}`, M(P), M(pins.Aurora * P)], ['Bison', `${pins.Bison}`, M(P), M(pins.Bison * P)], ['Total', `${sold}`, '', M(sales)]]);
  assert.deepEqual(rows(1), [['Forecast', `${fPins}`], ['Sold', `${sold}`], ['More than forecast', `${sold - fPins}`]]);
  assert.deepEqual(rows(3), [['Sold (cost of goods sold)', `${sold}`, M(cogs)], ['Left (inventory)', `${left}`, M(inv)], ['Bought', `${C.SUPPLY.units}`, M(C.inventoryCostCents)]]);
  assert.equal(cogs + inv, C.inventoryCostCents);
  assert.equal(be, 50);
  assert.deepEqual(L.cards[4].figure.bars.map((b) => b.value), [be * P, fSales, sales]);
  assert.ok(L.cards[4].text.includes(`${be} pins`) && L.cards[4].text.includes(M(C.fixedCents)));
  assert.equal(L.cards[2].text.includes(M(cogs)), true);
  assert.equal(num('ft10-s6-u5-l1-q2'), pins.Aurora * P);
  assert.equal(num('ft10-s6-u5-l1-q3'), sales);
  assert.equal(num('ft10-s6-u5-l1-q5'), cogs);
  assert.equal(num('ft10-s6-u5-l1-q7'), inv);
  assert.equal(right('ft10-s6-u5-l1-q1'), `${sold} pins`);
  assert.equal(right('ft10-s6-u5-l1-q4'), `${sold - fPins} pins`);
  assert.equal(right('ft10-s6-u5-l1-q6'), `${left} pins`);
  assert.equal(right('ft10-s6-u5-l1-q8'), `${sold - be} pins`);
  assert.equal(right('ft10-s6-u5-l1-q10'), 'Inventory, counted at cost');
  const pt = Q.get('ft10-s6-u5-l1-q9');
  assert.deepEqual(pt.figure.bars.map((b) => b.value), [be * P, fSales, sales]);
  assert.equal(pt.answer, 0);
  // the function and the hand arithmetic agree
  const r = C.round(1);
  assert.deepEqual([r.pinsSold, r.sales, r.cogs, r.grossProfit, r.expensesTotal, r.netIncome], [sold, sales, cogs, gross, expTotal, net]);
  assert.equal(C.balanceSheet(1).pinsLeft, left);
  assert.equal(C.balanceSheet(1).inventory, inv);
});

test('level 2: the income statement, the forecast, and the gap', () => {
  const L = unit.levels[1], rows = (i) => L.cards[i].figure.rows;
  const stmt = [['Sales', M(sales)], ['Cost of goods sold', M(cogs)], ['Gross profit', M(gross)], ...exp.map((e) => [e.name, M(e.cents)]), ['Total other expenses', M(expTotal)], ['Net income', M(net)]];
  assert.deepEqual(rows(2), stmt);
  assert.equal(L.cards[2].figure.title, 'Income Statement / For the first market day');
  assert.deepEqual(rows(1), [...exp.map((e) => [e.name, M(e.cents)]), ['Total other expenses', M(expTotal)]]);
  assert.deepEqual(rows(3), [['Sales', M(fSales)], ['Cost of goods sold', M(fCogs)], ['Gross profit', M(fGross)], ['Total other expenses', M(expTotal)], ['Net income', M(fNet)]]);
  assert.equal(L.cards[3].figure.title, 'Income Statement / Forecast for the first market day');
  assert.deepEqual(rows(4), [['Pins sold', `${fPins}`, `${sold}`, `${sold - fPins}`], ['Sales', M(fSales), M(sales), M(sales - fSales)], ['Cost of goods sold', M(fCogs), M(cogs), M(cogs - fCogs)], ['Gross profit', M(fGross), M(gross), M(gross - fGross)], ['Other expenses', M(expTotal), M(expTotal), M(0)], ['Net income', M(fNet), M(net), M(net - fNet)]]);
  assert.equal(sold - fPins, 10);   // card 6 says "ten more pins"
  assert.ok(L.cards[5].text.includes('ten more pins'));
  assert.equal(num('ft10-s6-u5-l2-q2'), gross);
  assert.equal(num('ft10-s6-u5-l2-q3'), expTotal);
  assert.deepEqual(Q.get('ft10-s6-u5-l2-q3').figure.rows, exp.map((e) => [e.name, M(e.cents)]));
  assert.equal(num('ft10-s6-u5-l2-q4'), net);
  assert.equal(num('ft10-s6-u5-l2-q6'), fSales);
  assert.equal(num('ft10-s6-u5-l2-q7'), fNet);
  assert.equal(num('ft10-s6-u5-l2-q8'), net - fNet);
  assert.equal(right('ft10-s6-u5-l2-q9'), `Section 5, ${C.PLAN_SECTIONS[4]}`);
  assert.equal(C.PLAN_SECTIONS[4], 'Forecast');
  assert.equal(C.PLAN_SECTIONS[3], 'Financial plan');
  assert.equal(Q.get('ft10-s6-u5-l2-q5').prompt.includes(M(exp[0].cents)), true);
});

test('every dollar amount in the unit is one the company file produces; no words outside the scope', () => {
  const allowed = new Set([P, UC, P - UC, pins.Aurora * P, pins.Bison * P, pins.Aurora * UC, sales, cogs, gross, expTotal, net, fSales, fCogs, fGross, fNet, sales - fSales, cogs - fCogs, net - fNet, inv, left * P, C.inventoryCostCents, C.fixedCents, ...exp.map((e) => e.cents), be * P, expTotal - exp[3].cents, expTotal + gross, gross + expTotal, net + fNet, 0].map(M));
  const text = JSON.stringify(unit);
  for (const m of text.match(/\$\d{1,3}(?:,\d{3})*(?:\.\d\d)?/g)) assert.ok(allowed.has(m), `${m} is not produced by the company file`);
  for (const w of ['GST', 'sales tax', 'income tax', 'wage', 'interest', 'simulat', 'depreciation']) assert.ok(!text.toLowerCase().includes(w.toLowerCase()), w);
  assert.ok(!/\b(Canada|China|Japan|Mexico|Germany|Korea|Vietnam|India|Taiwan)\b/.test(text.replace(/Canadian/g, '')));
  assert.ok(unit.levels[0].cards[0].text.includes('Your class will read its own business'));
});
