// Content check for the Learning Road unit "Starting early and asset classes" (ft2030-s3-u1): growth figures are recomputed here with the
// closed-form annuity formula (the generator worked month by month), game figures come from modules/exchange/constants.js.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { EVENTS, FUNDS } from '../modules/exchange/constants.js';

const course = JSON.parse(fs.readFileSync(new URL('../modules/learn/content/fintech2030.json', import.meta.url), 'utf8'));
const unit = course.sections.flatMap((s) => s.units).find((u) => u.id === 'ft2030-s3-u1');
const Q = new Map(unit.levels.flatMap((l) => l.questions).map((q) => [q.id, q]));
const text = (l) => unit.levels[l - 1].cards.map((c) => c.text).join(' ');
const dump = JSON.stringify(unit);

// $200 at the end of each month for n months, then tail months with no deposit, interest rate/12 a month (closed form)
const fv = (n, tail, rate = 0.07) => { const r = rate / 12; return (200 * ((1 + r) ** n - 1)) / r * (1 + r) ** tail; };
const d = Math.round, cents = (x) => x * 100;
const ALIA = d(fv(120, 396)), RAVI = d(fv(396, 0)), ALIA32 = d(fv(120, 0)), ALIA5 = d(fv(120, 396, 0.05)), RAVI5 = d(fv(396, 0, 0.05));
const START = [22, 27, 32, 37, 42].map((a) => ({ a, put: 200 * 12 * (65 - a), val: d(fv((65 - a) * 12, 0)) }));
const STEP = START.slice(1).map((s, i) => START[i].val - s.val);
const LINE = [32, 40, 48, 56, 65].map((a) => d(fv(120, (a - 32) * 12)));
const crash = EVENTS.crash;
const afterEq = (x) => (x * (100 + crash.equityPct)) / 100, afterBond = (x) => (x * (100 + crash.bondPct)) / 100;
const usd = (x) => `$${x.toLocaleString('en-CA')}`;

// Mr. Tang's outlines (slide-studio/courses/fintech2030/context/outlines/), line numbers of the version read on 2026-11-17
const OUTLINE = {
  'Lesson 12 line 101-103: $200 a month, Alia 22 to 32, Ben 32 to 65': { monthly: 200, aliaFrom: 22, aliaTo: 32, benTo: 65 },
  'Lesson 12 line 105: 7% a year': { rate: 7 },
  'Lesson 12 line 113: total contributed $24,000 and $79,200': { alia: 24000, ben: 79200 },
  'Lesson 12 line 116 and 125: Ben put in $55,200 more': { more: 55200 },
  'Lesson 12 line 123: value at 65 $322,815 (Alia) and $308,813 (Ben)': { alia: 322815, ben: 308813 },
  'Lesson 12 line 125: Alia $14,000 ahead': { ahead: 14000 },
};

test('shape: id, title, blurb kept; 3 levels, 4-6 cards, 7-10 questions, no pictures, go only on the last level', () => {
  assert.equal(unit.title, 'Starting early and asset classes');
  assert.equal(unit.blurb, 'The cost of waiting, the four kinds of assets and a mix that fits a timeline.');
  assert.deepEqual(unit.outcome_codes, ['FIN3080 1.1', 'FIN3090 3.10']);
  assert.equal(unit.levels.length, 3);
  for (const l of unit.levels) { assert.ok(l.cards.length >= 4 && l.cards.length <= 6); assert.ok(l.questions.length >= 7 && l.questions.length <= 10); }
  assert.equal(unit.levels.flatMap((l) => l.cards).length, 18);
  assert.equal(Q.size, 30);
  assert.ok(!/"image"/.test(dump) && !dump.includes('!'));
  assert.equal(unit.levels[0].go, undefined);
  assert.equal(unit.levels[1].go, undefined);
  assert.deepEqual(unit.levels[2].go, { building: 'exchange', label: 'Look at the Exchange' });
  for (const l of unit.levels) assert.ok(l.questions.some((q) => q.figure || q.type === 'number'));
});

test('the outline figures: used ones match, the one that differs is not used', () => {
  const o = OUTLINE;
  assert.equal(200 * 12 * 10, o['Lesson 12 line 113: total contributed $24,000 and $79,200'].alia);
  assert.equal(200 * 12 * 33, o['Lesson 12 line 113: total contributed $24,000 and $79,200'].ben);
  assert.equal(200 * 12 * 33 - 200 * 12 * 10, o['Lesson 12 line 116 and 125: Ben put in $55,200 more'].more);
  assert.equal(RAVI, o['Lesson 12 line 123: value at 65 $322,815 (Alia) and $308,813 (Ben)'].ben);
  // Alia's value differs from the outline: ours is 33 years of growth after 32, the outline's is about 32
  assert.notEqual(ALIA, o['Lesson 12 line 123: value at 65 $322,815 (Alia) and $308,813 (Ben)'].alia);
  assert.ok(Math.abs(d(fv(120, 384)) - 322815) < 300, 'the outline figure is about 32 years of growth');
  assert.ok(!dump.includes('322,815') && !dump.includes('14,000'));
  const t1 = text(1);
  for (const s of ['$200.00', 'age 22 to 32', 'until he is 65', '7% a year', '$55,200', '$24,000', '$79,200', usd(RAVI)]) assert.ok(JSON.stringify(unit.levels[0]).includes(s), s);
  assert.ok(t1.includes('43 years until 65') && t1.includes('has 33'));
});

test('every number answer is recomputed', () => {
  const want = {
    'ft2030-s3-u1-l1-q1': cents(150 * 12 * 40),
    'ft2030-s3-u1-l1-q2': cents(START[0].put - START[3].put),
    'ft2030-s3-u1-l1-q4': cents(RAVI5 - ALIA5),
    'ft2030-s3-u1-l1-q5': cents(START[1].val - START[1].put),
    'ft2030-s3-u1-l1-q8': cents(START[1].val - START[3].val),
    'ft2030-s3-u1-l2-q5': cents(2400 * 0.05),
    'ft2030-s3-u1-l2-q6': cents(250 * 1.04),
    'ft2030-s3-u1-l2-q7': cents(12000 - 7500 - 800),
    'ft2030-s3-u1-l3-q3': 100 - (25 + 35 + 5),
    'ft2030-s3-u1-l3-q4': 20 + 35,
    'ft2030-s3-u1-l3-q7': cents(afterEq(4000) + afterBond(6000)),
  };
  for (const [id, v] of Object.entries(want)) { assert.ok(Q.has(id), id); assert.equal(Q.get(id).type, 'number'); assert.equal(Q.get(id).answer, v, id); assert.equal(Q.get(id).tolerance, 0, id); }
  assert.equal(Object.keys(want).length, [...Q.values()].filter((q) => q.type === 'number').length);
  assert.equal(ALIA - RAVI, 37600);
  assert.equal(afterEq(4000) + afterBond(6000), 8700);
});

test('level 1 figures: put in, balances, start ages, steps, the line', () => {
  const L = unit.levels[0].cards;
  assert.deepEqual(L[1].figure.rows, [['Years saving', '10', '33'], ['Deposits of $200', '120', '396'], ['Total put in', '$24,000', '$79,200']]);
  assert.deepEqual(L[2].figure.rows, [['Put in', '$24,000', '$79,200'], ['Balance at 65', usd(ALIA), usd(RAVI)], ['Growth', usd(ALIA - 24000), usd(RAVI - 79200)]]);
  assert.deepEqual(L[3].figure.points.map((p) => p.value), LINE.map(cents));
  assert.deepEqual(L[3].figure.points.map((p) => p.label), ['Age 32', 'Age 40', 'Age 48', 'Age 56', 'Age 65']);
  assert.ok(L[3].text.includes(usd(ALIA32)) && L[3].text.includes(usd(ALIA)));
  assert.ok(Math.round(ALIA / ALIA32) === 10, 'about 10 times');
  assert.deepEqual(L[4].figure.rows, START.map((s) => [String(s.a), usd(s.put), usd(s.val)]));
  assert.ok(L[4].text.includes(usd(RAVI5)) && L[4].text.includes(usd(ALIA5)) && RAVI5 > ALIA5 && ALIA > RAVI);
  assert.deepEqual(L[5].figure.bars.map((b) => b.value), STEP.map(cents));
  assert.ok(STEP.every((s, i) => i === 0 || s < STEP[i - 1]), 'each five-year wait costs less than the one before');
  assert.ok(L[5].text.includes(usd(STEP[0])) && L[5].text.includes(usd(STEP[1])));
  const q7 = Q.get('ft2030-s3-u1-l1-q7'); assert.equal(q7.answer, LINE.findIndex((v) => v > 100000)); assert.equal(q7.answer, 2); assert.ok(LINE[1] < 100000);
  const q9 = Q.get('ft2030-s3-u1-l1-q9'); assert.equal(q9.answer, STEP.indexOf(Math.max(...STEP)));
  // the start-age row for 32 is Ravi's balance
  assert.equal(START[2].val, RAVI);
});

test('compounding: the closed form agrees with a month-by-month run', () => {
  const run = (n, tail) => { let b = 0; for (let i = 0; i < n + tail; i++) { b *= 1 + 0.07 / 12; if (i < n) b += 200; } return b; };
  assert.equal(d(run(120, 396)), ALIA);
  assert.equal(d(run(396, 0)), RAVI);
  assert.ok(text(1).includes('7% divided by 12') && text(1).includes('end of a month') && text(1).includes('nearest dollar'));
});

test('level 2: class table, worked amounts, the bars', () => {
  const t = text(2);
  assert.ok(t.includes('$206.00') && 200 * 1.03 === 206);
  assert.ok(t.includes('$50.00') && 1000 * 0.05 === 50);
  assert.ok(t.includes('$8,000') && t.includes('$5,000') && t.includes('$500') && t.includes('$2,500') && 8000 - 5000 - 500 === 2500);
  const q9 = Q.get('ft2030-s3-u1-l2-q9');
  assert.deepEqual(q9.figure.bars.map((b) => b.value), [900000, 550000, 70000, 280000]);
  assert.equal(9000 - 5500 - 700, 2800);
  assert.equal(q9.figure.bars[q9.answer].label, 'Left');
  assert.deepEqual(unit.levels[1].cards[0].figure.rows.map((r) => r[0]), ['Cash and equivalents', 'Fixed income', 'Equities', 'Real assets, alternatives']);
});

test('level 3: game constants (crash sizes, balanced fund) and the 100-point mixes', () => {
  assert.equal(crash.equityPct, -25); assert.equal(crash.bondPct, -5);
  const bal = FUNDS.find((f) => f.ticker === 'DAAG').blend; assert.deepEqual(bal, { DAAX: 60, DAAB: 40 });
  const L = unit.levels[2].cards;
  assert.ok(L[2].text.includes('25% off equity funds') && L[2].text.includes('5% off bond funds'));
  assert.deepEqual(L[2].figure.rows, [['Cash', '$1,000.00'], ['Fixed income (bond fund)', '$950.00'], ['Equities (equity fund)', '$750.00']]);
  assert.ok(L[5].text.includes('60 parts equity fund and 40 parts bond fund'));
  const q8 = Q.get('ft2030-s3-u1-l3-q8'); assert.deepEqual(q8.figure.bars.map((b) => b.value), [100000, afterBond(1000) * 100, afterEq(1000) * 100]); assert.equal(q8.answer, 2);
  assert.ok(L[0].text.includes('20 points in cash, 30 in fixed income, 45 in equities and 5') && 20 + 30 + 45 + 5 === 100);
  // the mixes in the choice options each add to 100, and the keyed ones follow the rule (most equities for the longest timeline, least for the shortest)
  const mix = (o) => o.text.match(/\d+/g).map(Number);
  const eqShare = (q) => q.options.map((o) => mix(o)[2]);
  for (const id of ['ft2030-s3-u1-l3-q5', 'ft2030-s3-u1-l3-q6']) for (const o of Q.get(id).options) assert.equal(mix(o).reduce((a, b) => a + b, 0), 100, o.text);
  const q5 = Q.get('ft2030-s3-u1-l3-q5'), q6 = Q.get('ft2030-s3-u1-l3-q6');
  assert.equal(q5.answer, eqShare(q5).indexOf(Math.max(...eqShare(q5))));
  assert.equal(q6.answer, eqShare(q6).indexOf(Math.min(...eqShare(q6))));
  // Sami's 10 months is shorter than 2 years; the keyed answer of q2 is Sami
  assert.ok(10 < 2 * 12 && Q.get('ft2030-s3-u1-l3-q2').options[Q.get('ft2030-s3-u1-l3-q2').answer].text.startsWith('Sami'));
});

test('wording: no real names, no market figures, no advice', () => {
  assert.ok(!/\b(TSX|S&P|Nasdaq|ETF|RRSP|TFSA|iShares|Vanguard|bitcoin|Tesla)\b/i.test(dump));
  assert.ok(!/\b(you should|buy now|best choice)\b/i.test(dump));
  for (const name of ['Maya', 'Dev', 'Priya', 'Ben ', 'Amara']) assert.ok(!dump.includes(name), name);
});

test('no dollar number answer is printed on a card or card figure of its level', () => {
  const fmt = (c) => [`$${(c / 100).toLocaleString('en-CA')}`, `$${(c / 100).toLocaleString('en-CA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`];
  for (const l of unit.levels) {
    const cardText = l.cards.map((k) => k.text + JSON.stringify(k.figure ?? '')).join(' ');
    for (const q of l.questions.filter((x) => x.type === 'number' && x.unit === '$')) for (const t of fmt(q.answer)) assert.ok(!cardText.includes(t), `${q.id} answer ${t} is on a card`);
  }
});
