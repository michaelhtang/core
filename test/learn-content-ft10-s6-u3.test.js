// Content check for FinTech 10 section 6, ft10-s6-u3 "The plan on paper". No outline exists for this section: every figure and key is recomputed from the example
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
    100, C.SUPPLY.cadCentsPerUsd, 150,                                         // the rate US$1 = C$1.40, and the example move to C$1.50
    200,                                                                         // made-up: flour at $2.00 a bag (a word problem, not a company figure)
  ]);
  for (const n of [40, 50, 60]) { ok.add(n * C.PRICE.round1); ok.add(C.fixedCents + n * C.unitCostCents); ok.add(Math.abs(n * C.PRICE.round1 - C.fixedCents - n * C.unitCostCents)); }
  const b = C.balanceSheet(0); ok.add(b.cash); ok.add(b.capital);
  for (const u of [U3, U4]) {
    const seen = [...text(u).matchAll(/\$([\d,]+(?:\.\d\d)?)/g)].map((x) => Math.round(parseFloat(x[1].replace(/,/g, '')) * 100));
    for (const c of seen) assert.ok(ok.has(c), `${u.id}: $${c / 100} is not a figure of the company file`);
  }
});

test('unit 3 level 1: sections, description, org chart, memo and e-mail', () => {
  const L = U3.levels[0];
  assert.deepEqual(L.cards[0].figure.rows, C.PLAN_SECTIONS.map((s, i) => [String(i + 1), s]));
  assert.equal(right('ft10-s6-u3-l1-q2'), C.PLAN_SECTIONS[0]);
  assert.equal(right('ft10-s6-u3-l1-q8'), C.PLAN_SECTIONS[3]);
  assert.deepEqual(L.cards[3].figure.rows, P.map((p) => [p.name, p.role]));
  assert.equal(right('ft10-s6-u3-l1-q4'), role('Finance lead'));
  assert.deepEqual(L.cards[1].figure.rows.map((r) => r[0]), ['Name', 'Form', 'Product', 'Designs', 'Market']);
  assert.equal(L.cards[1].figure.rows[0][1], C.COMPANY.name);
  assert.equal(L.cards[1].figure.rows[3][1], C.COMPANY.designs.join(' and '));
  assert.ok(L.cards[1].text.includes(C.GLOSSARY.partnership.replace(/^A business/, 'a business')));
  assert.ok(L.cards[0].text.includes(C.GLOSSARY['business plan'].replace(/^A /, 'a ')));
  assert.deepEqual(L.cards[4].figure.rows.map((r) => r[0]), ['To', 'From', 'Date', 'Subject', 'Message']);
  assert.deepEqual(L.cards[5].figure.rows.map((r) => r[0]), ['Subject line', 'Greeting', 'Message', 'Name']);
  assert.ok(L.cards[4].figure.rows[4][1].includes(`${C.SUPPLY.units} pins`) && L.cards[4].figure.rows[4][1].startsWith(role('Production lead')));
  assert.equal(right('ft10-s6-u3-l1-q6'), 'Subject');
  assert.equal(right('ft10-s6-u3-l1-q5'), 'A memo');
  assert.ok(Q.get('ft10-s6-u3-l1-q9').options[Q.get('ft10-s6-u3-l1-q9').answer].text.includes(`${C.SUPPLY.units} pins`));
});

test('unit 3 level 2: the 4 Ps, the competitor bars, the markup, the supplier letter', () => {
  const L = U3.levels[1];
  assert.deepEqual(L.cards[1].figure.rows.map((r) => r[0]), ['Product', 'Price', 'Place', 'Promotion']);
  assert.equal(L.cards[1].figure.rows[1][1], `${C.money(C.PRICE.round1)} a pin`);
  const bars = L.cards[2].figure.bars;
  assert.deepEqual(bars.map((b) => [b.label, b.value]), [...C.COMPETITORS.map((c) => [c.name, c.cents]), ['North Star Pins', C.PRICE.round1]]);
  assert.equal(L.cards[2].figure.unit, '$');
  const low = Q.get('ft10-s6-u3-l2-q4');
  assert.equal(bars[low.answer].value, Math.min(...C.COMPETITORS.map((c) => c.cents)));
  assert.deepEqual(low.figure, L.cards[2].figure);
  assert.equal(num('ft10-s6-u3-l2-q3'), C.markupCents);
  assert.equal(C.markupCents, C.PRICE.round1 - C.unitCostCents);
  const cents = (n) => C.COMPETITORS.find((c) => c.name === n).cents;
  assert.equal(num('ft10-s6-u3-l2-q9'), cents('Online pin shop') - cents('Sticker table'));
  assert.deepEqual(L.cards[5].figure.rows.map((r) => r[0]), ['Date', 'Receiver', 'Greeting', 'Opening', 'Body', 'Closing', 'Signature']);
  assert.equal(right('ft10-s6-u3-l2-q7'), 'Body');
  assert.match(L.cards[4].text, /sell products or services, request information, answer inquiries or complaints, build goodwill, or keep a record/);
  assert.equal(right('ft10-s6-u3-l2-q5'), 'Request information');
  assert.equal(right('ft10-s6-u3-l2-q2'), 'Place');
});

test('unit 3 level 3: promotion costs, revising, proofreading, the draft beside the plan', () => {
  const L = U3.levels[2], posters = fixed('Posters'), board = fixed('Display board and signs');
  assert.deepEqual(L.cards[1].figure.rows, [['Posters', 'Where students walk', C.money(posters)], ['Display board and signs', 'At the market table', C.money(board)]]);
  assert.equal(num('ft10-s6-u3-l3-q3'), posters + board);
  assert.deepEqual(Q.get('ft10-s6-u3-l3-q3').figure.rows, [['Posters', C.money(posters)], ['Display board and signs', C.money(board)]]);
  assert.ok(Q.get('ft10-s6-u3-l3-q4').prompt.includes(`$${(posters / 100).toFixed(2)}`));
  assert.equal(right('ft10-s6-u3-l3-q4'), 'A fixed cost');
  assert.deepEqual(L.cards[4].figure.rows, [['Pins to order', '20', String(C.SUPPLY.units)], ['Price', C.money(500), C.money(C.PRICE.round1)], ['Finance lead', role('Production lead'), role('Finance lead')]]);
  assert.equal(right('ft10-s6-u3-l3-q8'), 'Finance lead');
  assert.equal(num('ft10-s6-u3-l3-q9'), C.PRICE.round1 - 500);
  assert.ok(Q.get('ft10-s6-u3-l3-q9').prompt.includes('$5.00') && Q.get('ft10-s6-u3-l3-q9').prompt.includes(`$${(C.PRICE.round1 / 100).toFixed(2)}`));
  assert.match(L.cards[3].text, /First check facts, dates, names and figures\. Then check structure, grammar, spelling, punctuation and format\./);
  assert.equal(right('ft10-s6-u3-l3-q7'), 'Facts, dates, names and figures');
});

test('definitions use the company glossary wording', () => {
  const t3 = text(U3), t4 = text(U4);
  const low = (s) => s[0].toLowerCase() + s.slice(1);
  for (const [t, k] of [[t3, 'target market'], [t3, 'business letter'], [t3, 'promotion'], [t3, 'fixed cost'], [t4, 'tariff'], [t4, 'landed cost'], [t4, 'start-up money'], [t4, 'break-even point'], [t4, 'variable cost'], [t4, 'import']]) {
    assert.ok(t.includes(low(C.GLOSSARY[k])), k);
  }
});

