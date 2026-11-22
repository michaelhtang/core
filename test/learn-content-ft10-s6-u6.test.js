// Content check for the Learning Road unit "Round two and the wrap" (ft10-s6-u6). No outline exists for section 6: every figure is
// recomputed from the example business (modules/learn/companies/north-star-pins.js), never typed. The lessons only READ the results of
// the first and second market days; they say nothing about how a round is run.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as C from '../modules/learn/companies/north-star-pins.js';

const course = JSON.parse(fs.readFileSync(new URL('../modules/learn/content/fintech10.json', import.meta.url), 'utf8'));
const unit = course.sections.flatMap((s) => s.units).find((u) => u.id === 'ft10-s6-u6');
const Q = new Map(unit.levels.flatMap((l) => l.questions).map((q) => [q.id, q]));
const num = (id) => Q.get(id).answer;
const right = (id) => { const q = Q.get(id); return q.options[q.answer].text; };
const { money: M } = C;

// ---- independent recomputation from the company file's inputs ----
const UC = C.unitCostCents, P1 = C.PRICE.round1, P2 = C.PRICE.round2, XP = C.EXTRA_PROMOTION_CENTS;
const [R1, R2] = C.ROUNDS;
const day = (R) => { const pinsSold = Object.values(R.pins).reduce((s, n) => s + n, 0), sales = pinsSold * R.priceCents, cogs = pinsSold * UC, expenses = R.expenses.reduce((s, e) => s + e.cents, 0); return { pinsSold, sales, cogs, gross: sales - cogs, expenses, net: sales - cogs - expenses }; };
const a = day(R1), b = day(R2), both = Object.fromEntries(Object.keys(a).map((k) => [k, a[k] + b[k]]));
const each1 = P1 - UC, each2 = P2 - UC, fixed2 = C.fixedCents + XP, be1 = C.fixedCents / each1, be2 = fixed2 / each2;
const left1 = C.SUPPLY.units - a.pinsSold, left2 = C.SUPPLY.units - both.pinsSold;
const bs0 = { cash: C.startUpCents, assets: C.startUpCents, capital: C.partnerCapitalCents };
const bs1 = { cash: C.startUpCents - C.inventoryCostCents + a.sales - a.expenses, inv: left1 * UC }; bs1.assets = bs1.cash + bs1.inv; bs1.capital = bs0.capital + a.net;
const bs2 = { cash: bs1.cash + b.sales - b.expenses, inv: left2 * UC }; bs2.assets = bs2.cash + bs2.inv; bs2.capital = bs1.capital + b.net;
const loan = C.START.loanCents, share = both.net / C.START.partners;

test('shape: 3 levels, 4-6 cards, 7-10 questions, ids, outcome codes, no pictures yet, no go button', () => {
  assert.equal(unit.title, 'Round two and the wrap');
  assert.equal(unit.blurb, 'Change the plan, compare the two rounds, and name the risks.');
  assert.deepEqual(unit.outcome_codes, ['FIN1910 3.2', 'FIN1910 3.3', 'FIN1910 3.4', 'FIN1910 4.1.3', 'FIN1910 4.1.4', 'FIN1910 2.2', 'FIN1015 1.3', 'FIN1015 1.4', 'MAM3030 4.3']);
  assert.equal(unit.levels.length, 3);
  unit.levels.forEach((l, i) => {
    assert.equal(l.id, `ft10-s6-u6-l${i + 1}`);
    assert.ok(l.cards.length >= 4 && l.cards.length <= 6, `${l.id}: ${l.cards.length} cards`);
    assert.ok(l.questions.length >= 7 && l.questions.length <= 10, `${l.id}: ${l.questions.length} questions`);
    assert.ok(l.questions.some((q) => q.figure) && l.questions.filter((q) => q.type === 'number').length >= 2);
    l.questions.forEach((q, k) => assert.equal(q.id, `${l.id}-q${k + 1}`));
    assert.equal(l.go, undefined);
    for (const c of l.cards) if (c.figure?.kind === 'table') { assert.ok(c.figure.columns.length <= 4); assert.ok(c.figure.rows.length <= 12); }
  });
  assert.ok(!JSON.stringify(unit).includes('"image"'));
});

test('level 1: the two changes, the new break-even, the second market day', () => {
  const L = unit.levels[0], rows = (i) => L.cards[i].figure.rows;
  assert.deepEqual([P1, P2, XP, each1, each2, fixed2, be1, be2], [600, 500, 2000, 300, 200, 17000, 50, 85]);
  assert.equal(be2, C.breakEven(P2, C.fixedCents + XP));
  assert.deepEqual(rows(0), [['Price of a pin', M(P1), M(P2)], ['Extra posters', M(0), M(XP)]]);
  assert.deepEqual(rows(2), [['Left on each pin', M(each1), M(each2)], ['Fixed costs', M(C.fixedCents), M(fixed2)], ['Break-even point', `${be1} pins`, `${be2} pins`]]);
  assert.deepEqual(rows(3), [['Aurora', `${R2.pins.Aurora}`, M(P2), M(R2.pins.Aurora * P2)], ['Bison', `${R2.pins.Bison}`, M(P2), M(R2.pins.Bison * P2)], ['Total', `${b.pinsSold}`, '', M(b.sales)]]);
  assert.deepEqual(rows(4), [['Pins sold', `${a.pinsSold}`, `${b.pinsSold}`, `+${b.pinsSold - a.pinsSold}`], ['Sales', M(a.sales), M(b.sales), `+${M(b.sales - a.sales)}`], ['Cost of goods sold', M(a.cogs), M(b.cogs), `+${M(b.cogs - a.cogs)}`], ['Gross profit', M(a.gross), M(b.gross), `+${M(b.gross - a.gross)}`]]);
  assert.deepEqual(Q.get('ft10-s6-u6-l1-q3').figure.rows, [...C.FIXED.map((f) => [f.name, M(f.cents)]), ['More posters', M(XP)]]);
  assert.equal(num('ft10-s6-u6-l1-q2'), each2);
  assert.equal(num('ft10-s6-u6-l1-q3'), fixed2);
  assert.equal(right('ft10-s6-u6-l1-q4'), `${be2} pins`);
  assert.equal(num('ft10-s6-u6-l1-q5'), b.sales);
  assert.equal(num('ft10-s6-u6-l1-q6'), b.cogs);
  assert.equal(num('ft10-s6-u6-l1-q7'), b.gross);
  assert.equal(right('ft10-s6-u6-l1-q9'), `${b.pinsSold - be2} pins`);
  assert.ok(b.gross - a.gross < b.sales - a.sales && each2 < each1);   // the point of the level
  assert.ok(L.cards[0].text.includes('Your class will read its own second day'));
  // the file's own functions agree
  const r = C.round(2);
  assert.deepEqual([r.pinsSold, r.sales, r.cogs, r.grossProfit, r.expensesTotal, r.netIncome], [b.pinsSold, b.sales, b.cogs, b.gross, b.expenses, b.net]);
});

test('level 2: the balance sheet after each day, the two days side by side', () => {
  const L = unit.levels[1], rows = (i) => L.cards[i].figure.rows;
  const sheet = (x, inv) => [['Cash', M(x.cash)], ...(inv ? [['Inventory', M(x.inv)]] : []), ['Total assets', M(x.assets)], ['Loan', M(loan)], ['Total liabilities', M(loan)], ["Partners' Capital", M(x.capital)], ['Total liabilities and equity', M(loan + x.capital)]];
  assert.deepEqual(rows(0), sheet(bs0, false));
  assert.deepEqual(rows(1), sheet(bs1, true));
  assert.deepEqual(rows(3), sheet(bs2, true));
  assert.equal(L.cards[0].figure.title, 'Balance Sheet / The day the money is collected');
  assert.equal(L.cards[1].figure.title, 'Balance Sheet / After the first market day');
  assert.equal(L.cards[3].figure.title, 'Balance Sheet / After the second market day');
  for (const x of [bs0, bs1, bs2]) assert.equal(x.assets, loan + x.capital);   // assets = liabilities + equity
  assert.deepEqual([bs0, bs1, bs2].map((x) => [x.cash, x.inv ?? 0, x.assets, x.capital]), [0, 1, 2].map((n) => { const s = C.balanceSheet(n); return [s.cash, s.inventory, s.assets, s.capital]; }));
  assert.deepEqual(rows(4), [['Pins sold', `${a.pinsSold}`, `${b.pinsSold}`, `${both.pinsSold}`], ['Sales', M(a.sales), M(b.sales), M(both.sales)], ['Gross profit', M(a.gross), M(b.gross), M(both.gross)], ['Other expenses', M(a.expenses), M(b.expenses), M(both.expenses)], ['Net income', M(a.net), M(b.net), M(both.net)]]);
  const t = C.total(); assert.deepEqual([t.pinsSold, t.sales, t.grossProfit, t.expensesTotal, t.netIncome], [both.pinsSold, both.sales, both.gross, both.expenses, both.net]);
  assert.equal(num('ft10-s6-u6-l2-q1'), bs1.assets);
  assert.equal(num('ft10-s6-u6-l2-q2'), bs1.capital);
  assert.equal(num('ft10-s6-u6-l2-q3'), bs2.capital);
  assert.equal(bs2.assets - loan, bs2.capital);
  assert.equal(right('ft10-s6-u6-l2-q4'), `${left2} pins`);
  assert.equal(num('ft10-s6-u6-l2-q5'), bs2.inv);
  assert.equal(num('ft10-s6-u6-l2-q6'), both.net);
  assert.equal(num('ft10-s6-u6-l2-q7'), a.expenses - b.expenses);
  assert.equal(b.net - a.net - (b.gross - a.gross), a.expenses - b.expenses);   // net income rose more than gross profit because expenses fell
  assert.ok(a.expenses > b.expenses);
  const pt = Q.get('ft10-s6-u6-l2-q9');
  assert.deepEqual(pt.figure.bars.map((x) => x.value), [a.net, b.net, both.net]);
  assert.equal(pt.answer, 2);
  assert.equal(Q.get('ft10-s6-u6-l2-q10').prompt.includes(M(bs1.capital)) && Q.get('ft10-s6-u6-l2-q10').prompt.includes(M(bs2.capital)), true);
  assert.equal(bs2.capital - bs1.capital, b.net);
});

test('level 3: risks and conclusions, the loan and the profit share', () => {
  const L = unit.levels[2], rows = (i) => L.cards[i].figure.rows;
  assert.deepEqual(rows(0), C.PLAN_SECTIONS.map((s, i) => [`${i + 1}`, s]));
  assert.equal(C.PLAN_SECTIONS[5], 'Risks and conclusions');
  // one cent on the rate moves the order by US$300 x C$0.01; one point of tariff is 1% of C$420
  const rateCent = C.orderUsdCents / 100, tariffPoint = C.orderCadCents / 100;
  assert.equal(C.SUPPLY.units * C.SUPPLY.usdCentsPerPin * 1 / 100, rateCent);
  assert.equal(C.orderCadCents * 0.01, tariffPoint);
  assert.deepEqual([rateCent, tariffPoint], [300, 420]);
  assert.equal(rows(1)[1][1], `1 cent adds ${M(rateCent)}, before tariff`);
  assert.equal(rows(1)[2][1], `1 point (1%) adds ${M(tariffPoint)}`);
  assert.equal(rows(2)[0][1], `${left2} pins, ${M(bs2.inv)}, still held`);
  assert.deepEqual(rows(3), [['Pins, first day', `${C.FORECAST.round1Pins}`, `${a.pinsSold}`], ['Net income, first day', M(C.FORECAST.round1Pins * (P1 - UC) - a.expenses), M(a.net)], ['Pins ordered, then sold', `${C.SUPPLY.units}`, `${both.pinsSold}`]]);
  assert.ok(L.cards[5].text.includes(M(loan)) && L.cards[5].text.includes(M(both.net)) && L.cards[5].text.includes(M(share)));
  assert.equal(share, C.shareEachCents());
  assert.equal(share, 6500);
  assert.ok(/followed from its first idea to its last number\.$/.test(L.cards[5].text));
  assert.equal(num('ft10-s6-u6-l3-q4'), 2 * tariffPoint);
  assert.equal(num('ft10-s6-u6-l3-q5'), 3 * rateCent);
  assert.equal(right('ft10-s6-u6-l3-q6'), `${left2} pins`);
  assert.equal(right('ft10-s6-u6-l3-q8'), `The first day sold ${a.pinsSold - C.FORECAST.round1Pins} more pins than forecast`);
  assert.equal(num('ft10-s6-u6-l3-q9'), share);
  assert.deepEqual(Q.get('ft10-s6-u6-l3-q9').figure.rows, [['First day', M(a.net)], ['Second day', M(b.net)], ['Both days', M(both.net)]]);
  assert.ok(L.cards[4].text.includes(`${b.pinsSold - a.pinsSold} more pins`) && L.cards[4].text.includes(M(each1 - each2)) && L.cards[4].text.includes(M(b.gross - a.gross)));
  assert.equal(right('ft10-s6-u6-l3-q1'), 'Section 6');
  assert.equal(C.PLAN_SECTIONS[4], 'Forecast'); assert.equal(C.PLAN_SECTIONS[2], 'Production and operations');
});

test('every dollar amount in the unit is one the company file produces; no words outside the scope', () => {
  const ok = [P1, P2, UC, XP, each1, each2, each1 - each2, fixed2, C.fixedCents, C.inventoryCostCents, C.partnerCapitalCents, C.startUpCents, loan, 0, share,
    R2.pins.Aurora * P2, R2.pins.Bison * P2, b.sales, b.cogs, b.gross, b.expenses, b.net, a.sales, a.cogs, a.gross, a.expenses, a.net, both.sales, both.gross, both.expenses, both.net,
    b.sales - a.sales, b.cogs - a.cogs, b.gross - a.gross, b.net - a.net, a.expenses - b.expenses, b.pinsSold * P1, bs0.cash, bs1.cash, bs1.inv, bs1.assets, bs1.capital, bs2.cash, bs2.inv, bs2.assets, bs2.capital, bs2.assets + loan,
    left2 * P2, C.orderUsdCents / 100, C.orderCadCents / 100, 2 * C.orderCadCents / 100, 3 * C.orderUsdCents / 100, C.FORECAST.round1Pins * (P1 - UC) - a.expenses, ...C.FIXED.map((f) => f.cents)].map(M);
  const allowed = new Set(ok);
  const text = JSON.stringify(unit);
  for (const m of text.match(/\$\d{1,3}(?:,\d{3})*(?:\.\d\d)?/g)) assert.ok(allowed.has(m), `${m} is not produced by the company file`);
  for (const w of ['GST', 'sales tax', 'income tax', 'wage', 'interest', 'simulat', 'depreciation']) assert.ok(!text.toLowerCase().includes(w.toLowerCase()), w);
  assert.ok(!/\b(Canada|China|Japan|Mexico|Germany|Korea|Vietnam|India|Taiwan)\b/.test(text.replace(/Canadian/g, '')));
});
