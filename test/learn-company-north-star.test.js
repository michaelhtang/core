// The example business of FinTech 10 section 6 (modules/learn/companies/north-star-pins.js): the figures the lessons of that section
// read, pinned here so a change to the file is a change someone meant to make.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as C from '../modules/learn/companies/north-star-pins.js';

test('sourcing: US$300 of pins at the class rate is C$420; the example tariff, shipping and packaging make each pin cost $3', () => {
  assert.deepEqual([C.orderUsdCents, C.orderCadCents, C.tariffCents, C.landedCents, C.landedCentsPerPin, C.unitCostCents, C.inventoryCostCents], [30000, 42000, 4200, 50000, 250, 300, 60000]);
  // the rate is the one section 4 teaches, in the same words
  const course = JSON.parse(fs.readFileSync(new URL('../modules/learn/content/fintech10.json', import.meta.url), 'utf8'));
  const cards = course.sections.flatMap((s) => s.units).find((u) => u.id === 'ft10-s4-u2').levels[0].cards.map((c) => c.text).join(' ');
  assert.match(cards, /US\$1 = C\$1\.40/);
  assert.equal(C.SUPPLY.cadCentsPerUsd, 140);
});

test('price, start-up money and break-even: $6 a pin, $750 to start, 50 pins to break even (85 at $5 with $20 more promotion)', () => {
  assert.deepEqual([C.PRICE.round1, C.PRICE.round2, C.markupCents, C.fixedCents, C.partnerCapitalCents, C.startUpCents], [600, 500, 300, 15000, 60000, 75000]);
  assert.equal(C.startUpCents, C.inventoryCostCents + C.fixedCents);
  assert.equal(C.breakEven(C.PRICE.round1), 50);
  assert.equal(C.breakEven(C.PRICE.round2, C.fixedCents + C.EXTRA_PROMOTION_CENTS), 85);
  assert.throws(() => C.breakEven(700), /whole number/);
});

test('the survey: 40 students; 24, 18 and 6 would buy at $4, $6 and $8; $6 brings the most sales from them', () => {
  assert.deepEqual([C.buyersAt(400), C.buyersAt(600), C.buyersAt(800), C.buyersAt(900)], [24, 18, 6, 0]);
  const sales = [400, 600, 800].map((p) => C.buyersAt(p) * p);
  assert.deepEqual(sales, [9600, 10800, 4800]);
  assert.equal(C.COMPETITORS.length, 3);
});

test('the two rounds: 70 pins and $90 of net income, then 110 pins and $170; $260 in all, $65 a partner', () => {
  const a = C.round(1), b = C.round(2), t = C.total();
  assert.deepEqual([a.pinsSold, a.sales, a.cogs, a.grossProfit, a.expensesTotal, a.netIncome], [70, 42000, 21000, 21000, 12000, 9000]);
  assert.deepEqual([b.pinsSold, b.sales, b.cogs, b.grossProfit, b.expensesTotal, b.netIncome], [110, 55000, 33000, 22000, 5000, 17000]);
  assert.deepEqual([t.pinsSold, t.sales, t.grossProfit, t.netIncome, C.shareEachCents()], [180, 97000, 43000, 26000, 6500]);
  assert.ok(a.pinsSold > C.FORECAST.round1Pins, 'the first day beat the forecast');
});

test('the balance sheet balances at the start and after each round', () => {
  assert.deepEqual([0, 1, 2].map((n) => { const b = C.balanceSheet(n); return [b.cash, b.inventory, b.assets, b.loan, b.capital, b.balanced]; }),
    [[75000, 0, 75000, 15000, 60000, true], [45000, 39000, 84000, 15000, 69000, true], [95000, 6000, 101000, 15000, 86000, true]]);
});

test('money, the plan sections and the words', () => {
  assert.deepEqual([C.money(42000), C.money(250), C.money(101000)], ['$420', '$2.50', '$1,010']);
  assert.deepEqual(C.PLAN_SECTIONS, ['Business description and mission', 'Marketing plan', 'Production and operations', 'Financial plan', 'Forecast', 'Risks and conclusions']);
  assert.equal(C.GLOSSARY.tariff, 'A tax on goods that come in from another country.');
  assert.equal(C.GLOSSARY['gross profit'], 'Sales minus cost of goods sold.');
  for (const [w, d] of Object.entries(C.GLOSSARY)) assert.ok(d.length <= 160 && /\.$/.test(d), w);
});
