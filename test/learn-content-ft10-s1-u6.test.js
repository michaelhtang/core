// Content check for the Learning Road unit "Build your budget" (ft10-s1-u6): every pay number is recomputed from modules/jobs (payroll.js, catalogue.js),
// every number of the game's own month from modules/bills/catalogue.js and modules/housing/constants.js, every class figure is pinned to a cited outline line,
// and the shape (levels, cards, questions) is checked.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { payStub } from '../modules/jobs/payroll.js';
import { CATALOGUE, PATHS } from '../modules/jobs/catalogue.js';
import { RENTALS } from '../modules/housing/constants.js';
import { ITEMS } from '../modules/bills/catalogue.js';

const course = JSON.parse(fs.readFileSync(new URL('../modules/learn/content/fintech10.json', import.meta.url), 'utf8'));
const unit = course.sections.flatMap((s) => s.units).find((u) => u.id === 'ft10-s1-u6');
const Q = new Map(unit.levels.flatMap((l) => l.questions).map((q) => [q.id, q]));
const ans = (id) => Q.get(`ft10-s1-u6-${id}`).answer;
const money = (c) => `$${(c / 100).toLocaleString('en-CA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const pct1 = (a, b) => Math.round((a / b) * 1000) / 10;
const share = (net, p) => Math.round((net * p) / 100);
const month = (weeklyCents) => Math.round((weeklyCents * 52) / 12);
const text = (l) => unit.levels[l - 1].cards.map((c) => c.text).join(' ');
const everything = JSON.stringify(unit);

// Figures quoted from Mr. Tang's outlines (slide-studio/courses/fintech10/context/claude-project/docs/).
const L7 = 'claude_Lesson 7 Slide Outline Sept 15.md', S14 = 'claude_Lesson 6 Slide Outline Sept 14.md';
const OUTLINE = {
  oneBed: { cents: 129800, cite: `${S14} line 69 (table row "Rent a 1-bedroom alone", $1,298) and ${L7} line 126` },
  twoBed: { cents: 158100, cite: `${S14} line 74 (two-bedroom averages $1,581) and ${L7} line 126` },
  utilities: { cents: [28000, 46000], cite: `${L7} line 126 (utilities $280-$460)` },
  phone: { cents: [4000, 8000], cite: `${L7} line 126 (phone $40-$80)` },
  groceries: { cents: [37000, 49000], cite: `${L7} line 134 (groceries $370-$490)` },
  bus: { cents: 10500, cite: `${S14} line 90 and ${L7} line 130 (bus pass $105)` },
  car: { cents: [68000, 115000], cite: `${S14} line 90 and ${L7} line 130 (car $680-$1,150 all in)` },
  weeklyGroceries: { cents: 40000, correct: 43333, cite: `${L7} line 109 ("$100 a week of groceries is $433 a month, not $400"; the unit uses the unrounded $433.33)` },
};

const job = (id) => CATALOGUE.find((c) => c.id === id);
const step = (jobId, n) => PATHS.find((p) => p.job_id === jobId && p.step === n);
const pay = (wage, hours) => payStub({ grossCents: wage * hours, period: 1 });

test('shape: 7 levels, 4-6 cards, 7-10 questions, ids, outcome codes, one go button', () => {
  assert.ok(unit, 'unit ft10-s1-u6 is in fintech10.json');
  assert.equal(unit.title, 'Build your budget');
  assert.equal(unit.blurb, 'Build a monthly budget on the net pay of a career you chose.');
  assert.deepEqual(unit.outcome_codes, ['FIN1010 4.3', 'FIN1010 6.2', 'FIN1010 3.5.5']);
  assert.equal(unit.levels.length, 7);
  unit.levels.forEach((l, i) => {
    assert.equal(l.id, `ft10-s1-u6-l${i + 1}`);
    assert.ok(l.cards.length >= 4 && l.cards.length <= 6, `${l.id}: ${l.cards.length} cards`);
    assert.ok(l.questions.length >= 7 && l.questions.length <= 10, `${l.id}: ${l.questions.length} questions`);
    assert.ok(l.questions.filter((q) => q.type === 'number').length >= 2, `${l.id}: at least 2 number questions`);
    assert.ok(l.questions.some((q) => q.figure), `${l.id}: at least 1 question with a figure`);
    l.questions.forEach((q, k) => assert.equal(q.id, `${l.id}-q${k + 1}`));
  });
  assert.deepEqual(unit.levels[6].go, { building: 'bills', label: 'Open Bills' });
  assert.ok(unit.levels.every((l, i) => i === 6 || !l.go));
});

test('the slides\' simplified example is not used, and no loan dollar figure appears', () => {
  assert.ok(!/78,000|\$4,800|4,800|3,874/.test(everything), 'the outline\'s dental hygienist figures are not quoted');
  assert.ok(!/Hygienist|hygienist/.test(everything));
  assert.ok(!/loans? line[^.]{0,30}\$(?!0\.00)\d|loan payment[^.]{0,20}\$\d/.test(JSON.stringify(unit.levels[4])), 'level 5 gives no loan payment figure');
});

test('pay: every wage, hours, gross and net comes from the Job Centre catalogue and payroll.js', () => {
  const hs = step(1, 1);                                   // Hana: Retail supervisor
  assert.deepEqual([hs.title, hs.hourly_cents, hs.hours_per_month], ['Retail supervisor', 1912, 151]);
  const H = pay(hs.hourly_cents, hs.hours_per_month);
  assert.equal(H.gross, 288712); assert.equal(H.net, 245603);
  assert.equal(ans('l1-q3'), hs.hourly_cents * hs.hours_per_month);
  assert.equal(ans('l1-q4'), H.gross - H.net);
  assert.equal(H.cpp + H.ei + H.federalTax + H.albertaTax, H.gross - H.net);
  const cj = job(1), C = pay(cj.hourly_cents, cj.hours_per_month);   // Cashier, as in unit 3
  assert.equal(C.gross, 180304); assert.equal(ans('l1-q5'), C.net); assert.equal(C.net, 165745);
  for (const f of [unit.levels[0].cards[2].figure, Q.get('ft10-s1-u6-l1-q2').figure, Q.get('ft10-s1-u6-l1-q4').figure]) {
    assert.deepEqual(f.lines.map((l) => l.cents), [H.gross, H.cpp, H.ei, H.federalTax, H.albertaTax, H.net]);
  }
  assert.deepEqual(Q.get('ft10-s1-u6-l1-q8').figure.bars.map((b) => b.value), [H.gross, H.gross - H.net, H.net]);
  assert.equal(Q.get('ft10-s1-u6-l1-q8').answer, 2);
  const t1 = text(1);
  for (const s of [money(H.gross), money(H.net), '$19.12', '151 hours']) assert.ok(t1.includes(s), s);
  // Omar: Line cook, then the Cook step
  const ol = job(2), oc = step(2, 1);
  assert.deepEqual([ol.title, oc.title], ['Line cook', 'Cook']);
  const O = pay(ol.hourly_cents, ol.hours_per_month), OC = pay(oc.hourly_cents, oc.hours_per_month);
  assert.equal(OC.net - O.net, ans('l6-q4'));
  // Jasper: Retail associate
  const jj = job(4), J = pay(jj.hourly_cents, jj.hours_per_month);
  assert.equal(J.gross, 225192); assert.equal(ans('l6-q8'), J.net);
  assert.equal(J.cpp + J.ei + J.federalTax + J.albertaTax, J.gross - J.net);
  const jp = Q.get('ft10-s1-u6-l6-q8').prompt;
  for (const c of [J.gross, J.cpp, J.ei, J.federalTax, J.albertaTax]) assert.ok(jp.includes(money(c)), money(c));
  const jt = Q.get('ft10-s1-u6-l6-q7').figure.rows[0];
  assert.deepEqual(jt, ['Income', money(J.gross), `${jj.hours_per_month} hours at ${money(jj.hourly_cents)}`]);
  // the check fields (stub -> field) match payroll.js
  for (const id of ['l1-q4', 'l1-q5', 'l6-q8']) {
    const q = Q.get(`ft10-s1-u6-${id}`), s = payStub({ grossCents: q.check.stub, period: 1 });
    assert.equal(q.check.field === 'deductions' ? s.gross - s.net : s[q.check.field], q.answer, id);
  }
});

test("Hana's month: savings, home, getting around, food and discretionary add up as the cards say", () => {
  const hs = step(1, 1), H = pay(hs.hourly_cents, hs.hours_per_month), net = H.net;
  const sav = share(net, 15), rent = OUTLINE.twoBed.cents / 2, util = 33500, phone = 5500, inet = 3500;
  const groc = month(9500), dine = 4 * 1650, bus = OUTLINE.bus.cents, disc = 5500 + 2 * 1199 + 2800 + 3900;
  const home = rent + util + phone + inet, move = bus + groc + dine, before = sav + home + move, room = net - before;
  assert.equal(rent, 79050);
  assert.ok(util >= OUTLINE.utilities.cents[0] && util <= OUTLINE.utilities.cents[1], 'utilities inside the class range');
  assert.ok(phone >= OUTLINE.phone.cents[0] && phone <= OUTLINE.phone.cents[1], 'phone inside the class range');
  assert.ok(groc >= OUTLINE.groceries.cents[0] && groc <= OUTLINE.groceries.cents[1], 'groceries inside the class range');
  // level 2
  assert.equal(ans('l2-q2'), share(net, 20)); assert.equal(ans('l2-q3'), share(net, 10));
  assert.equal(ans('l2-q4'), net - sav); assert.equal(ans('l2-q5'), sav * 12);
  const bars2 = Q.get('ft10-s1-u6-l2-q6').figure.bars;
  assert.deepEqual(bars2.map((b) => b.value), [5, 10, 15, 20].map((p) => net - share(net, p)));
  assert.equal(Q.get('ft10-s1-u6-l2-q6').answer, 2);
  assert.deepEqual(unit.levels[1].cards[2].figure.rows.map((r) => r.slice(1)), [5, 10, 15, 20].map((p) => [money(share(net, p)), money(net - share(net, p))]));
  for (const s of [money(share(net, 20)), money(sav), money(sav * 12)]) assert.ok(text(2).includes(s), s);
  // level 1 groceries
  assert.equal(ans('l1-q6'), groc);
  // level 3
  assert.equal(ans('l3-q1'), rent); assert.equal(ans('l3-q2'), home);
  assert.equal(ans('l3-q5'), pct1(rent, net)); assert.equal(ans('l3-q6'), pct1(OUTLINE.oneBed.cents, net));
  assert.deepEqual(unit.levels[2].cards[3].figure.rows.map((r) => r[1]), [rent, util, phone, inet, home].map(money));
  assert.deepEqual(Q.get('ft10-s1-u6-l3-q8').figure.bars.map((b) => b.value), [rent, util, phone, inet]);
  // level 4
  const theo = [31000, 36000, 12000, 5000, 1500], car = theo.reduce((a, b) => a + b, 0);
  assert.ok(car >= OUTLINE.car.cents[0] && car <= OUTLINE.car.cents[1], 'the car is inside the class all-in range');
  assert.equal(ans('l4-q1'), car); assert.equal(ans('l4-q2'), car - OUTLINE.bus.cents);
  assert.equal(ans('l4-q3'), month(10500)); assert.equal(ans('l4-q4'), 3 * 1850); assert.equal(ans('l4-q5'), move);
  assert.deepEqual(unit.levels[3].cards[1].figure.rows.map((r) => r[1]), theo.map(money));
  assert.deepEqual(unit.levels[3].cards[4].figure.rows.map((r) => r[1]), [bus, groc, dine, move].map(money));
  assert.equal(Q.get('ft10-s1-u6-l4-q8').figure.bars[2].value, car);
  // level 5
  assert.equal(ans('l5-q3'), 2 * 1199); assert.equal(ans('l5-q4'), disc);
  assert.equal(ans('l5-q5'), room); assert.equal(ans('l5-q6'), room - disc);
  assert.deepEqual(unit.levels[4].cards[3].figure.rows.map((r) => r[1]), [5500, 2 * 1199, 2800, 3900, disc].map(money));
  for (const s of [money(net), money(before), money(room)]) assert.ok(text(5).includes(s), s);
  assert.ok(text(4).includes(money(groc)) && text(4).includes(money(car)) && text(4).includes(money(dine)));
  assert.equal(Q.get('ft10-s1-u6-l5-q8').figure.bars.reduce((b, x, i, a) => (x.value > a[b].value ? i : b), 0), Q.get('ft10-s1-u6-l5-q8').answer);
});

test("Omar's month and the level 6 mistakes", () => {
  const ol = job(2), oc = step(2, 1), O = pay(ol.hourly_cents, ol.hours_per_month), OC = pay(oc.hourly_cents, oc.hours_per_month);
  const sav = share(O.net, 10), home = 79050 + 33800 + 4700 + 2800, move = 10500 + month(9800) + 3 * 1500, disc = 10400;
  const total = sav + home + move + 0 + disc;
  assert.equal(ans('l6-q1'), total); assert.equal(ans('l6-q2'), total - O.net);
  assert.ok(total > O.net, 'Omar is short');
  assert.equal(ans('l6-q5'), OC.net - total); assert.ok(OC.net > total, 'the Cook step clears the month');
  assert.deepEqual(unit.levels[5].cards[2].figure.rows.map((r) => r[1]), [O.net, sav, home, move, 0, disc, total].map(money).concat(`Short by ${money(total - O.net)}`));
  const t = text(6);
  for (const s of [money(total - O.net), money(O.net), money(OC.net), money(OC.net - O.net)]) assert.ok(t.includes(s), s);
  assert.equal(ans('l6-q9'), OUTLINE.weeklyGroceries.correct);
  assert.equal(month(10000), OUTLINE.weeklyGroceries.correct);
  assert.equal(OUTLINE.weeklyGroceries.cents, 40000);
  assert.ok(text(6).includes('$433.33') && text(1).includes('$433.33') && text(1).includes('$400.00'));
});

test("the game's own month: rent from housing/constants.js, the other lines from bills/catalogue.js (starting plans)", () => {
  const start = ITEMS.filter((i) => i.from_age === 0);
  const first = (slot) => start.filter((i) => i.slot === slot).sort((a, b) => a.sort - b.sort)[0];
  const apt1 = RENTALS.find((r) => r.id === 'apt1').rentCents, room = RENTALS.find((r) => r.id === 'apt2-roommate').rentCents;
  const L = { utilities: first('utilities').amount_cents, groceries: first('groceries').amount_cents, phone: first('phone').amount_cents, internet: first('internet').amount_cents, transit: first('transport').amount_cents };
  assert.deepEqual([apt1, room, L.utilities, L.groceries, L.phone, L.internet, L.transit], [129000, 81750, 12000, 36600, 2400, 2500, 10000]);
  assert.equal(first('phone').id, 'phone-lite'); assert.equal(first('transport').id, 'transit');
  const rest = Object.values(L).reduce((a, b) => a + b, 0), shared = start.find((i) => i.id === 'rent').amount_cents;
  const net = payStub({ grossCents: job(1).hourly_cents * job(1).hours_per_month, period: 1 }).net;
  assert.equal(ans('l7-q6'), apt1 + rest - net); assert.equal(ans('l7-q7'), net - (room + rest));
  assert.deepEqual(Q.get('ft10-s1-u6-l7-q9').figure.bars.map((b) => b.value), [shared + rest, room + rest, apt1 + rest]);
  assert.equal(Q.get('ft10-s1-u6-l7-q9').answer, 1);
  const gt = unit.levels[6].cards[3].figure.rows;
  assert.deepEqual(gt.map((r) => r[1]), [apt1, room, L.utilities, L.groceries, L.phone, L.internet, L.transit].map(money));
  const p6 = Q.get('ft10-s1-u6-l7-q6'), p7 = Q.get('ft10-s1-u6-l7-q7');
  assert.ok(p6.prompt.includes(money(net)) && p6.prompt.includes(money(apt1 + rest)));
  assert.ok(p7.prompt.includes(money(room)) && p7.prompt.includes(money(room + rest)) && p7.prompt.includes(money(net)));
  assert.deepEqual(p6.figure.rows.map((r) => r[1]), [apt1, L.utilities, L.groceries, L.phone, L.internet, L.transit].map(money));
  // the other numbers of level 7
  assert.equal(ans('l7-q3'), 30000 + 90000 + 50000 + 45000 - 200000);
  assert.equal(ans('l7-q4'), month(2600));
  assert.ok(text(7).includes('$420.33') && Math.round((9700 * 52) / 12) === 42033, '$97.00 a week x 52 / 12 is $420.33');
});

test('class figures: each one is quoted as written in the cited outline line', () => {
  assert.equal(OUTLINE.twoBed.cents / 2, 79050);
  const t3 = text(3);
  for (const s of ['$1,298.00', '$1,581.00', '$790.50', '$280.00 to $460.00', '$40.00 to $80.00']) assert.ok(t3.includes(s), s);
  const t4 = text(4);
  for (const s of ['$105.00', '$680.00 to $1,150.00', '$370.00 to $490.00']) assert.ok(t4.includes(s), s);
  const t7 = unit.levels[6].cards.map((c) => c.text + JSON.stringify(c.figure ?? '')).join(' ');
  for (const s of ['$1,298.00', '$790.50', '$105.00', '$280.00 to $460.00', '$40.00 to $80.00', '$370.00 to $490.00']) assert.ok(t7.includes(s), s);
  assert.deepEqual(Q.get('ft10-s1-u6-l4-q8').figure.bars.map((b) => b.value).filter((v, i) => i !== 2), [OUTLINE.bus.cents, OUTLINE.car.cents[0], OUTLINE.car.cents[1]]);
  assert.equal(Q.get('ft10-s1-u6-l3-q3').options[Q.get('ft10-s1-u6-l3-q3').answer].text, '$335.00');
  assert.ok(335_00 >= OUTLINE.utilities.cents[0] && 335_00 <= OUTLINE.utilities.cents[1]);
  for (const [k, v] of Object.entries(OUTLINE)) assert.ok(v.cite && v.cite.includes('Slide Outline') , k);
});
