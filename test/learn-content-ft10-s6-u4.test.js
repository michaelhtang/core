// Content check for FinTech 10 section 6, ft10-s6-u4 "Making it and paying for it". No outline exists for this section: every figure and key is recomputed from the example
// business (modules/learn/companies/north-star-pins.js).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as C from '../modules/learn/companies/north-star-pins.js';

const course = JSON.parse(fs.readFileSync(new URL('../modules/learn/content/fintech10.json', import.meta.url), 'utf8'));
const units = course.sections.flatMap((s) => s.units);
const U3 = units.find((u) => u.id === 'ft10-s6-u3'), U4 = units.find((u) => u.id === 'ft10-s6-u4');
const Q = new Map([...U3.levels, ...U4.levels].flatMap((l) => l.questions).map((q) => [q.id, q]));
const right = (id) => { const q = Q.get(id); return q.options[q.answer].text; };
const num = (id) => Q.get(id).answer;
const fixed = (n) => C.FIXED.find((f) => f.name === n).cents;
const P = C.COMPANY.partners, role = (r) => P.find((p) => p.role === r).name;
const text = (u) => JSON.stringify(u);

test('shape: level counts, 4-6 cards, 7-10 questions, ids, no pictures, no go button', () => {
  assert.equal(U3.levels.length, 3);
  assert.equal(U4.levels.length, 2);
  assert.equal(U3.title, 'The plan on paper');
  assert.equal(U4.title, 'Making it and paying for it');
  for (const u of [U3, U4]) {
    u.levels.forEach((l, i) => {
      assert.equal(l.id, `${u.id}-l${i + 1}`);
      assert.ok(l.cards.length >= 4 && l.cards.length <= 6, `${l.id}: ${l.cards.length} cards`);
      assert.ok(l.questions.length >= 7 && l.questions.length <= 10, `${l.id}: ${l.questions.length} questions`);
      assert.ok(l.questions.some((q) => q.figure), `${l.id}: a question with a figure`);
      l.questions.forEach((q, k) => assert.equal(q.id, `${l.id}-q${k + 1}`));
      assert.equal(l.go, undefined);
      for (const c of [...l.cards.map((c) => c.figure), ...l.questions.map((q) => q.figure)].filter((f) => f?.kind === 'table')) {
        assert.ok(c.columns.length <= 4, `${l.id}: ${c.title} has ${c.columns.length} columns`);
      }
    });
    assert.ok(!text(u).includes('"image"'));
    assert.ok(u.levels.every((l) => l.questions.filter((q) => q.type === 'number').length >= 0));
  }
  assert.ok(U4.levels.every((l) => l.questions.filter((q) => q.type === 'number').length >= 2));
});

test('scope: no GST, wages, interest, depreciation, real rates, trade agreements or country names', () => {
  const all = text(U3) + text(U4);
  assert.doesNotMatch(all, /\bGST\b|sales tax|income tax|wage|salary|interest|depreciation|NAFTA|CUSMA|\bUSMCA\b|China|Mexico|Japan|Korea|Vietnam|India|Europe|Germany|Taiwan/i);
  assert.doesNotMatch(all, /@|https?:|www\./);
  assert.doesNotMatch(all, /!/);
});

test('every dollar amount in the units is one the company file produces (or a listed made-up one)', () => {
  const ok = new Set([
    C.orderUsdCents, C.orderCadCents, C.tariffCents, C.landedCents, C.landedCentsPerPin, C.unitCostCents, C.inventoryCostCents, C.fixedCents, C.startUpCents,
    C.markupCents, C.PRICE.round1, C.PRICE.round2, C.partnerCapitalCents, C.START.eachCents, C.START.loanCents,
    C.SUPPLY.usdCentsPerPin, C.SUPPLY.shippingCents, C.SUPPLY.packagingCentsPerPin, ...C.FIXED.map((f) => f.cents),
    ...C.COMPETITORS.map((c) => c.cents),
    fixed('Posters') + fixed('Display board and signs'),                       // card sum
    fixed('Display board and signs') - fixed('Posters'),
    C.COMPETITORS.find((c) => c.name === 'Online pin shop').cents - C.COMPETITORS.find((c) => c.name === 'Sticker table').cents,
    (C.orderUsdCents * 150) / 100, (C.orderUsdCents * 150) / 100 - C.orderCadCents,   // the rate-moves example
    (C.orderUsdCents * C.SUPPLY.tariffBp) / 10000,                              // the trap: 10% of the US dollar amount
    C.orderCadCents + C.tariffCents, C.orderCadCents + C.SUPPLY.shippingCents,    // the two landed-cost traps
    C.breakEven(C.PRICE.round1) * C.PRICE.round1, C.breakEven(C.PRICE.round1) * C.unitCostCents, // sales at break-even and its trap
    C.PRICE.round1 + C.unitCostCents,                                           // markup trap
    C.PRICE.round2 - C.unitCostCents,                                           // what a $5 pin leaves
    C.PRICE.round1 - C.PRICE.round2,                                            // the draft-price error
    100, C.SUPPLY.cadCentsPerUsd, C.SUPPLY.usdCentsPerPin,                    // the rate US$1 = C$1.40, and the supplier's US$1.50 a pin
  ]);
  for (const n of [40, 50, 60]) { ok.add(n * C.PRICE.round1); ok.add(C.fixedCents + n * C.unitCostCents); ok.add(Math.abs(n * C.PRICE.round1 - C.fixedCents - n * C.unitCostCents)); }
  const b = C.balanceSheet(0); ok.add(b.cash); ok.add(b.capital);
  for (const u of [U3, U4]) {
    const seen = [...text(u).matchAll(/\$([\d,]+(?:\.\d\d)?)/g)].map((x) => Math.round(parseFloat(x[1].replace(/,/g, '')) * 100));
    for (const c of seen) assert.ok(ok.has(c), `${u.id}: $${c / 100} is not a figure of the company file`);
  }
});

test('unit 4 level 1: from US$300.00 to a cost of $3.00 a pin', () => {
  const S = C.SUPPLY, L = U4.levels[0];
  assert.equal(S.units * S.usdCentsPerPin, 30000);
  assert.equal(num('ft10-s6-u4-l1-q2'), Math.round(30000 * S.cadCentsPerUsd / 100));
  assert.equal(num('ft10-s6-u4-l1-q2'), C.orderCadCents);
  assert.equal(num('ft10-s6-u4-l1-q3'), C.orderCadCents * S.tariffBp / 10000);
  assert.equal(num('ft10-s6-u4-l1-q3'), C.tariffCents);
  assert.equal(num('ft10-s6-u4-l1-q4'), C.orderCadCents + C.tariffCents + S.shippingCents);
  assert.equal(num('ft10-s6-u4-l1-q4'), C.landedCents);
  assert.equal(num('ft10-s6-u4-l1-q5'), C.landedCents / S.units);
  assert.equal(num('ft10-s6-u4-l1-q7'), C.landedCentsPerPin + S.packagingCentsPerPin);
  assert.equal(num('ft10-s6-u4-l1-q7'), C.unitCostCents);
  { const q8 = L.questions.find((x) => x.id === 'ft10-s6-u4-l1-q8'); assert.equal(q8.type, 'choice'); assert.equal(q8.options[q8.answer].text, 'It goes up'); }   // no second rate: the direction only
  assert.ok(!/1\.50 ?=|C\$1\.50|450/.test(JSON.stringify(U4)), 'no invented second exchange rate');
  assert.deepEqual(L.cards[2].figure.rows.map((r) => r[1]), [C.money(C.orderCadCents), C.money(C.tariffCents), C.money(S.shippingCents), C.money(C.landedCents)]);
  const bars = L.cards[3].figure.bars;
  assert.equal(L.cards[3].figure.unit, '$');
  assert.deepEqual(bars.map((b) => b.value), [C.orderCadCents / S.units, C.tariffCents / S.units, S.shippingCents / S.units, S.packagingCentsPerPin]);
  assert.equal(bars.reduce((s, b) => s + b.value, 0), C.unitCostCents);
  assert.equal(bars[Q.get('ft10-s6-u4-l1-q6').answer].label, 'Shipping');
  assert.equal(bars[Q.get('ft10-s6-u4-l1-q6').answer].value, Math.min(...bars.map((b) => b.value)));
  assert.equal(right('ft10-s6-u4-l1-q10'), role('Production lead'));
  assert.match(L.cards[1].text, /US\$1 = C\$1\.40, a made-up rate, only an example/);
  assert.match(L.cards[2].text, /A tariff is a tax on goods that come in from another country\./);
  assert.match(L.cards[2].text, /example/);
  assert.match(L.cards[0].text, /prices in US dollars/);
});

test('unit 4 level 2: start-up money, fixed and variable costs, break-even, the opening balance sheet', () => {
  const L = U4.levels[1], b = C.balanceSheet(0);
  assert.equal(num('ft10-s6-u4-l2-q1'), C.inventoryCostCents + C.fixedCents);
  assert.equal(num('ft10-s6-u4-l2-q1'), C.startUpCents);
  assert.equal(num('ft10-s6-u4-l2-q2'), C.SUPPLY.units * C.unitCostCents);
  assert.equal(num('ft10-s6-u4-l2-q3'), C.START.partners * C.START.eachCents);
  assert.equal(C.partnerCapitalCents + C.START.loanCents, C.startUpCents);
  assert.equal(num('ft10-s6-u4-l2-q5'), C.PRICE.round1 - C.unitCostCents);
  assert.deepEqual(L.cards[2].figure.rows, [...C.FIXED.map((f) => [f.name, C.money(f.cents)]), ['Total fixed costs', C.money(C.fixedCents)]]);
  const be = C.breakEven(C.PRICE.round1);
  assert.equal(be, C.fixedCents / (C.PRICE.round1 - C.unitCostCents));
  assert.equal(right('ft10-s6-u4-l2-q6'), `${be} pins`);
  assert.equal(right('ft10-s6-u4-l2-q7'), `${C.breakEven(C.PRICE.round2)} pins`);
  assert.equal(C.breakEven(C.PRICE.round2), 75);
  assert.equal(num('ft10-s6-u4-l2-q8'), be * C.PRICE.round1);
  for (const row of L.cards[4].figure.rows) {
    const n = Number(row[0]), sales = n * C.PRICE.round1, costs = C.fixedCents + n * C.unitCostCents;
    assert.deepEqual(row.slice(1, 3), [C.money(sales), C.money(costs)]);
    assert.equal(row[3], sales === costs ? 'Even' : sales > costs ? `${C.money(sales - costs)} profit` : `${C.money(costs - sales)} short`);
  }
  assert.deepEqual(L.cards[4].figure.rows.map((r) => r[0]), [String(be - 10), String(be), String(be + 10)]);
  assert.deepEqual(L.cards[5].figure.rows, [['Cash', C.money(b.cash)], ['Total assets', C.money(b.assets)], ['Loan', C.money(b.loan)], ['Total liabilities', C.money(b.loan)], ["Partners' Capital", C.money(b.capital)], ['Total liabilities and equity', C.money(b.loan + b.capital)]]);
  assert.ok(b.balanced && b.assets === b.loan + b.capital);
  assert.equal(num('ft10-s6-u4-l2-q10'), b.assets - b.loan);
  assert.equal(right('ft10-s6-u4-l2-q9'), 'Loan');
  assert.deepEqual(L.cards[0].figure.rows.map((r) => r[1]), [C.money(C.inventoryCostCents), C.money(C.fixedCents), C.money(C.startUpCents)]);
  assert.deepEqual(L.cards[1].figure.rows.map((r) => r[1]), [C.money(C.partnerCapitalCents), C.money(C.START.loanCents), C.money(C.startUpCents)]);
});

test('definitions use the company glossary wording', () => {
  const t3 = text(U3), t4 = text(U4);
  const low = (s) => s[0].toLowerCase() + s.slice(1);
  for (const [t, k] of [[t3, 'target market'], [t3, 'business letter'], [t3, 'promotion'], [t3, 'fixed cost'], [t4, 'tariff'], [t4, 'landed cost'], [t4, 'start-up money'], [t4, 'break-even point'], [t4, 'variable cost'], [t4, 'import']]) {
    assert.ok(t.includes(low(C.GLOSSARY[k])), k);
  }
});

