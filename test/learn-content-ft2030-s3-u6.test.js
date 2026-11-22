// Content check for the Learning Road unit "Growth, inflation and real return" (ft2030-s3-u6). Growth figures are recomputed here month by month
// and year by year (the generator used closed forms); the game's own defaults come from modules/rates/constants.js.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { POLICY_BP, SPREADS, INFLATION_BP } from '../modules/rates/constants.js';

const course = JSON.parse(fs.readFileSync(new URL('../modules/learn/content/fintech2030.json', import.meta.url), 'utf8'));
const unit = course.sections.flatMap((s) => s.units).find((u) => u.id === 'ft2030-s3-u6');
const Q = new Map(unit.levels.flatMap((l) => l.questions).map((q) => [q.id, q]));
const cardsText = (l) => unit.levels[l - 1].cards.map((c) => c.text).join(' ');
const dump = JSON.stringify(unit);
const d = Math.round, cents = (x) => d(x * 100);
const usd = (x, dp = 0) => `$${x.toLocaleString('en-CA', { minimumFractionDigits: dp, maximumFractionDigits: dp })}`;

// independent growth routines (loops, not closed forms)
const yearly = (p, r, n) => { let b = p; for (let i = 0; i < n; i++) b *= 1 + r; return b; };
const monthlyLump = (p, r, months) => { let b = p; for (let i = 0; i < months; i++) b *= 1 + r / 12; return b; };
const deposits = (dep, r, months) => { let b = 0; for (let i = 0; i < months; i++) { b *= 1 + r / 12; b += dep; } return b; };   // deposit at the END of each month
const doubleYears = (r) => { let n = 0, b = 1; while (b < 2) { b *= 1 + r; n++; } return n - 1 + (2 - b / (1 + r)) / (b - b / (1 + r)); };   // linear inside the year: only to check to 1 dp
const exactDouble = (r) => Math.log(2) / Math.log(1 + r);
const real = (n, i) => (1 + n) / (1 + i) - 1;
const one = (x) => (d(x * 10) / 10).toFixed(1);

// Mr. Tang's outlines (slide-studio/courses/fintech2030/context/outlines/), line numbers of the versions read on 2026-11-17
const OUTLINE = {
  'Lesson 26 (v3) line 111 and 142: 6% gives 72/6 = 12 years; $10,000 at 6% paid every 30 days for 12 years is $20,508': { rule6: 12, monthly: 20508 },
  'Lesson 26 (v3) line 33: exact doubling time of that monthly example is 11.58 years': { monthlyExact: 11.58 },
  'Lesson 26 (v3) line 197: exact years 6% 11.90, 1% 69.66, 24% 3.22 (rule: 12, 72, 3)': { x6: 11.9, x1: 69.66, x24: 3.22 },
  'Lesson 26 (v3) line 189: exact doubling times 3%, 6%, 9%, 12% are 23.45 / 11.90 / 8.04 / 6.12': { x3: 23.45, x9: 8.04, x12: 6.12 },
  'Lesson 31 line 258 and 124: $3,000 of bills, 2%, 33 years is x1.92 (outline $5,766.70, ours $5,766.69)': { factor: 1.92, outlineBills: 5766.7 },
  'Lesson 31 line 259: try-it table at 1% and 3% (outline $4,166.07 and $7,957.00; ours $4,166.07 and $7,957.01)': { one: 4166.07, three: 7957.0 },
  'Lesson 31 line 50: the target is 2%, the midpoint of a 1-3% range': { target: 2, low: 1, high: 3 },
  'Lesson 37 line 164 and 323: 3% GIC, 3% inflation, 10 years, $200,000 becomes $268,783; buys $200,000': { stmt: 268783, buys: 200000 },
  'Lesson 37 line 325 and 327: 2% inflation buys $220,496 (1.0%); 5% inflation buys $165,010 (-1.9%)': { two: 220496, five: 165010 },
  'Lesson 26 (v3) line 124 and 181: 6% fund minus 2% inflation doubles buying power in about 18 years, not 12': { years: 18, nominal: 12 },
};

test('shape: id, title, blurb kept; 5 levels, 4-6 cards, 7-10 questions, no pictures, go only on the last level', () => {
  assert.equal(unit.title, 'Growth, inflation and real return');
  assert.equal(unit.blurb, 'The Rule of 72, growing prices and what your money really earns.');
  assert.deepEqual(unit.outcome_codes, ['FIN3080 2.1.7', 'FIN3090 3.2', 'FIN3090 3.4']);
  assert.equal(unit.levels.length, 5);
  for (const l of unit.levels) { assert.ok(l.cards.length >= 4 && l.cards.length <= 6); assert.ok(l.questions.length >= 7 && l.questions.length <= 10); }
  assert.equal(unit.levels.flatMap((l) => l.cards).length, 23);
  assert.equal(Q.size, 41);
  assert.ok(!/"image"/.test(dump) && !dump.includes('!'));
  for (const l of [...unit.levels.slice(0, 3), unit.levels[4]]) assert.equal(l.go, undefined);
  assert.deepEqual(unit.levels[3].go, { building: 'bank-of-daa', label: 'See the live rates' });
  for (const l of unit.levels) { assert.ok(l.questions.some((q) => q.figure), l.id); assert.ok(l.questions.filter((q) => q.type === 'number').length >= 2, l.id); }
});

test('the outline figures: used ones match, the ones that differ are listed', () => {
  const o = OUTLINE;
  assert.equal(72 / 6, o['Lesson 26 (v3) line 111 and 142: 6% gives 72/6 = 12 years; $10,000 at 6% paid every 30 days for 12 years is $20,508'].rule6);
  assert.equal(d(monthlyLump(10000, 0.06, 144)), o['Lesson 26 (v3) line 111 and 142: 6% gives 72/6 = 12 years; $10,000 at 6% paid every 30 days for 12 years is $20,508'].monthly);
  const m = Math.log(2) / (12 * Math.log(1 + 0.06 / 12));
  assert.equal(m.toFixed(2), String(o['Lesson 26 (v3) line 33: exact doubling time of that monthly example is 11.58 years'].monthlyExact));
  const x = o['Lesson 26 (v3) line 197: exact years 6% 11.90, 1% 69.66, 24% 3.22 (rule: 12, 72, 3)'];
  assert.equal(exactDouble(0.06).toFixed(2), x.x6.toFixed(2)); assert.equal(exactDouble(0.01).toFixed(2), String(x.x1)); assert.equal(exactDouble(0.24).toFixed(2), String(x.x24));
  const y = o['Lesson 26 (v3) line 189: exact doubling times 3%, 6%, 9%, 12% are 23.45 / 11.90 / 8.04 / 6.12'];
  assert.equal(exactDouble(0.03).toFixed(2), String(y.x3)); assert.equal(exactDouble(0.09).toFixed(2), String(y.x9)); assert.equal(exactDouble(0.12).toFixed(2), String(y.x12));
  // outline 3,000 x 1.02^33: $5,766.70 on the outline, $5,766.69 here (1.02^33 x 3000 = 5766.694...); 1% matches; 3% is one cent more here
  const f = yearly(1, 0.02, 33);
  assert.equal(f.toFixed(2), String(o['Lesson 31 line 258 and 124: $3,000 of bills, 2%, 33 years is x1.92 (outline $5,766.70, ours $5,766.69)'].factor));
  assert.equal((3000 * f).toFixed(2), '5766.69'); assert.notEqual(5766.69, o['Lesson 31 line 258 and 124: $3,000 of bills, 2%, 33 years is x1.92 (outline $5,766.70, ours $5,766.69)'].outlineBills);
  const t = o['Lesson 31 line 259: try-it table at 1% and 3% (outline $4,166.07 and $7,957.00; ours $4,166.07 and $7,957.01)'];
  assert.equal((3000 * yearly(1, 0.01, 33)).toFixed(2), t.one.toFixed(2)); assert.equal((3000 * yearly(1, 0.03, 33)).toFixed(2), '7957.01'); assert.notEqual(7957.01, t.three);
  assert.equal(o['Lesson 31 line 50: the target is 2%, the midpoint of a 1-3% range'].target, (1 + 3) / 2);
  const s = o['Lesson 37 line 164 and 323: 3% GIC, 3% inflation, 10 years, $200,000 becomes $268,783; buys $200,000'];
  assert.equal(d(yearly(200000, 0.03, 10)), s.stmt); assert.equal(d(yearly(200000, 0.03, 10) / yearly(1, 0.03, 10)), s.buys);
  const e = o['Lesson 37 line 325 and 327: 2% inflation buys $220,496 (1.0%); 5% inflation buys $165,010 (-1.9%)'];
  assert.equal(d(yearly(200000, 0.03, 10) / yearly(1, 0.02, 10)), e.two); assert.equal(d(yearly(200000, 0.03, 10) / yearly(1, 0.05, 10)), e.five);
  assert.equal(one(real(0.03, 0.02) * 100), '1.0'); assert.equal(one(real(0.03, 0.05) * 100), '-1.9');
  assert.equal(72 / 4, o['Lesson 26 (v3) line 124 and 181: 6% fund minus 2% inflation doubles buying power in about 18 years, not 12'].years);
  const t1 = cardsText(1) + cardsText(3) + cardsText(4);
  assert.ok(t1.includes('midpoint of a range from 1% to 3%') && t1.includes('268,783') && t1.includes('72 / 4 = 18'));
  assert.ok(!dump.includes('5,766.70') && !dump.includes('7,957.00'));
});

test('every number answer is recomputed', () => {
  const P = (l, n) => `ft2030-s3-u6-l${l}-q${n}`;
  const find = (l, prompt) => unit.levels[l - 1].questions.find((q) => q.prompt.includes(prompt));
  const want = [
    [find(1, 'doubled its money in about 4 years'), 72 / 4, 0],
    [find(1, 'Sam puts $5,000'), cents(d(yearly(5000, 0.12, 6))), 50],
    [find(1, 'a made-up account pays 6%') ?? find(1, 'A made-up account pays 6%'), cents(d(monthlyLump(4000, 0.06, 180))), 50],
    [find(2, 'Mel deposits $50'), cents(Number(deposits(50, 0.06, 3).toFixed(2))), 1],
    [find(2, 'Lee deposits $250'), cents(250 * 12 * 20), 0],
    [find(2, 'Pat deposits $200'), cents(d(deposits(200, 0.06, 120)) - 200 * 120), 0],
    [find(2, 'Rin deposits $75'), cents(d(deposits(75, 0.06, 180))), 50],
    [find(2, 'Ana starts with $5,000'), cents(d(monthlyLump(5000, 0.06, 180) + deposits(100, 0.06, 180))), 50],
    [find(3, 'Kai pays $2,000'), cents(Number((2000 * yearly(1, 0.03, 10)).toFixed(2))), 1],
    [find(3, 'Noor pays $2,400'), cents(Number((2400 * yearly(1, 0.03, 25)).toFixed(2))), 1],
    [find(3, 'By what percent are they higher after 5 years'), Number(((yearly(1, 0.04, 5) - 1) * 100).toFixed(1)), 0.05],
    [find(3, 'Rae’s bills are $3,200'), cents(Number((3200 * yearly(1, 0.02, 30)).toFixed(2))), 1],
    [find(4, 'A GIC pays 6% and prices rise 3.5%'), Number((real(0.06, 0.035) * 100).toFixed(1)), 0.05],
    [find(4, 'A GIC pays 2% and prices rise 6%'), Number((-real(0.02, 0.06) * 100).toFixed(1)), 0.05],
    [find(4, 'Oren puts $50,000'), cents(d(yearly(50000, 0.04, 10))), 50],
    [find(4, 'statement shows $74,012.21'), cents(d(74012.21 / yearly(1, 0.03, 10))), 50],
    [find(5, 'goes from $80.00 to $92.00'), (92 - 80) / 80 * 100, 0],
    [find(5, 'fallen by week 4'), (40 - 32) / 40 * 100, 0],
    [find(5, 'of $200.00 rises 15%'), cents(200 * 1.15), 0],
    [find(5, 'rises 10%, then falls 10%'), cents(100 * 1.1 * 0.9), 0],
  ];
  for (const [q, v, tol] of want) { assert.ok(q, 'question found'); assert.equal(q.type, 'number'); assert.equal(q.answer, v, q.id); assert.equal(q.tolerance, tol, q.id); }
  assert.equal(want.length, [...Q.values()].filter((q) => q.type === 'number').length);
  assert.equal(Q.size, [1, 2, 3, 4, 5].reduce((s, l) => s + unit.levels[l - 1].questions.length, 0));
  assert.ok(P(1, 1));
  // the figures quoted in the prompts agree with the shown balances
  assert.equal(d(deposits(200, 0.06, 120)), 32776); assert.equal(d(yearly(50000, 0.04, 10) * 100) / 100, 74012.21);
});

test('traps and choice keys', () => {
  const find = (l, prompt) => unit.levels[l - 1].questions.find((q) => q.prompt.includes(prompt));
  const trapVals = (q) => (q.traps ?? []).map((t) => t.value);
  assert.ok(trapVals(find(1, 'Sam puts')).includes(cents(5000 * (1 + 0.12 * 6))));
  assert.ok(trapVals(find(1, 'a made-up account') ?? find(1, 'A made-up account')).includes(cents(d(yearly(4000, 0.06, 15)))));
  assert.ok(trapVals(find(3, 'Kai pays')).includes(cents(2000 * 1.3)));
  assert.ok(trapVals(find(4, 'A GIC pays 6%')).includes(2.5));
  // choice keys
  const q4 = find(1, 'biggest gap');
  const gaps = [2, 4, 8, 18].map((r) => Math.abs(72 / r - Number(one(exactDouble(r / 100)))));
  assert.equal(q4.options[q4.answer].text, `${[2, 4, 8, 18][gaps.indexOf(Math.max(...gaps))]}%`);
  assert.deepEqual(q4.figure.rows.map((r) => r[2]), [2, 4, 8, 18].map((r) => one(exactDouble(r / 100))));
  const bars = find(1, 'furthest below $20,000').figure.bars;
  assert.deepEqual(bars.map((b) => b.value), [[3, 24], [6, 12], [9, 8], [12, 6]].map(([r, n]) => cents(d(yearly(10000, r / 100, n)))));
  const short = bars.map((b) => 2000000 - b.value);
  assert.equal(find(1, 'furthest below $20,000').answer, short.indexOf(Math.max(...short)));
  const b30 = find(2, 'biggest balance').figure.bars;
  assert.deepEqual(b30.map((b) => b.value), [deposits(100, 0.06, 360), deposits(120, 0.06, 360), deposits(100, 0.08, 360)].map((x) => cents(d(x))));
  assert.equal(find(2, 'biggest balance').answer, b30.findIndex((b) => b.value === Math.max(...b30.map((x) => x.value))));
  const b20 = find(3, 'lowest rate that takes it past $1,800').figure.bars;
  assert.deepEqual(b20.map((b) => b.value), [1, 2, 3, 4].map((r) => cents(1000 * yearly(1, r / 100, 20))));
  assert.equal(find(3, 'lowest rate that takes it past $1,800').answer, b20.findIndex((b) => b.value > 180000));
  assert.equal(find(3, 'multiply prices to get them 20 years').options.find((o, i) => i === find(3, 'multiply prices to get them 20 years').answer).text, `About ${yearly(1, 0.02, 20).toFixed(2)}`);
  assert.ok(find(3, 'Does her income cover').options[find(3, 'Does her income cover').answer].text.startsWith('No') && 3200 * yearly(1, 0.02, 30) > 5500 && 3200 * 1.6 < 5500);
  assert.equal(find(2, 'one month?').options[find(2, 'one month?').answer].text, `${9 / 12}%`);
  assert.equal(find(3, 'prices double?').options[find(3, 'prices double?').answer].text, `About ${72 / 4} years`);
  assert.equal(find(4, 'doubles?').options[find(4, 'doubles?').answer].text, `About ${72 / 6} years`);
  assert.ok(3000 * yearly(1, 0.02, 33) > 4500);
  const g3 = find(4, 'only one whose buying power falls'); assert.equal(g3.options[g3.answer].text, 'GIC A'); assert.ok(0.02 < 0.03 && 0.04 > 0.03);
  assert.ok(find(1, 'within about 0.1') === undefined && cardsText(1).includes('within about 0.1 of a year'));
});

test('level 1 figures: balances by year and the rule against the exact time', () => {
  const L = unit.levels[0].cards;
  assert.deepEqual(L[1].figure.rows, [10, 11, 12].map((n) => [String(n), usd(d(yearly(10000, 0.06, n)))]));
  assert.ok(yearly(10000, 0.06, 11) < 20000 && yearly(10000, 0.06, 12) > 20000);
  assert.deepEqual(L[2].figure.rows, [1, 3, 6, 9, 12, 24].map((r) => [`${r}%`, String(72 / r), one(exactDouble(r / 100))]));
  assert.ok(L[3].text.includes('69.7') && L[3].text.includes('3.2') && Number(one(exactDouble(0.01))) > 69 && 72 > exactDouble(0.01) && 3 < exactDouble(0.24));
  for (const r of [0.06, 0.09, 0.12]) assert.ok(Math.abs(72 / (r * 100) - exactDouble(r)) < 0.125, `within 0.1 of a year at ${r}`);
  assert.ok(L[4].text.includes(usd(d(monthlyLump(10000, 0.06, 144)))) && L[4].text.includes('11.6') && one(Math.log(2) / (12 * Math.log(1.005))) === '11.6');
  assert.ok(doubleYears(0.06) > 11.5 && doubleYears(0.06) < 12);   // a second look at 11.9
});

test('level 2: the first months, the table by years, the pieces that add, the three plans', () => {
  const L = unit.levels[1].cards;
  let b = 0; const rows = [];
  for (let m = 1; m <= 3; m++) { const i = b * 0.005; b = b + i + 100; rows.push([String(m), usd(d(i * 100) / 100, 2), '$100.00', usd(d(b * 100) / 100, 2)]); }
  assert.deepEqual(L[0].figure.rows, rows);
  assert.deepEqual(L[1].figure.rows, [10, 20, 30, 40].map((n) => [String(n), usd(100 * 12 * n), usd(d(deposits(100, 0.06, 12 * n))), usd(d(deposits(100, 0.06, 12 * n)) - 100 * 12 * n)]));
  // the shortcut formula agrees with the month-by-month run
  assert.ok(Math.abs(100 * ((1.005 ** 120 - 1) / 0.005) - deposits(100, 0.06, 120)) < 1e-6);
  assert.ok(L[2].text.includes('(1.005^n - 1) / 0.005'));
  const lump = d(monthlyLump(10000, 0.06, 144)), dep = d(deposits(100, 0.06, 144)), both = d(monthlyLump(10000, 0.06, 144) + deposits(100, 0.06, 144));
  assert.deepEqual(L[3].figure.rows, [['$10,000 lump', usd(lump)], ['$100 a month', usd(dep)], ['Together', usd(both)]]);
  assert.equal(lump + dep, both);
  assert.deepEqual(L[4].figure.rows, [['$100 a month at 6%', usd(d(deposits(100, 0.06, 240)))], ['$125 a month at 6%', usd(d(deposits(125, 0.06, 240)))], ['$100 a month at 8%', usd(d(deposits(100, 0.08, 240)))]]);
  // with deposits $10,000 reaches $20,000 sooner than the rule's 12 years
  let bal = 10000, n = 0; while (bal < 20000) { bal = bal * 1.005 + 100; n++; }
  assert.ok(n < 12 * 12 && n === 58);
});

test('level 3 and 4 figures', () => {
  const L3 = unit.levels[2].cards;
  assert.deepEqual(L3[2].figure.rows, [1, 2, 3].map((r) => [`${r}%`, `x ${yearly(1, r / 100, 33).toFixed(2)}`, usd(Number((3000 * yearly(1, r / 100, 33)).toFixed(2)), 2)]));
  assert.ok(L3[1].text.includes('$5,766.69') && L3[1].text.includes('$4,980.00') && 3000 * 1.66 === 4980);
  assert.ok(L3[4].text.includes('$1,266.69') && d((3000 * yearly(1, 0.02, 33) - 4500) * 100) === 126669);
  assert.ok(L3[0].text.includes('$3,060.00') && 3000 * 1.02 === 3060);
  const L4 = unit.levels[3].cards, L5 = unit.levels[4].cards;
  assert.ok(L4[0].text.includes('$268,783'));
  assert.deepEqual(L4[1].figure.rows, [2, 3, 5].map((i) => [`${i}%`, `${one(real(0.03, i / 100) * 100)}%`, usd(d(yearly(200000, 0.03, 10) / yearly(1, i / 100, 10)))]));
  assert.ok(L4[2].text.includes('-1.9%') && L4[2].text.includes('3.0%') && L4[2].text.includes(`${one(real(0.08, 0.05) * 100)}%`) && one(real(0.08, 0.05) * 100) === '2.9');
  assert.ok(L4[3].text.includes('72 / 4 = 18') && 72 / 6 === 12);
  assert.ok(L5[0].text.includes('12%') && (56 - 50) / 50 === 0.12);
  assert.ok(L5[1].text.includes('$66.00') && L5[1].text.includes('$54.00') && L5[1].text.includes('$59.40') && 66 * 0.9 === 59.4 || Math.abs(66 * 0.9 - 59.4) < 1e-9);
  assert.ok(L5[2].text.includes('30%') && (1300 - 1000) / 1000 === 0.3);
  assert.ok(L5[3].text.includes('from the start'));
  assert.deepEqual(L5[3].figure.rows.map((r) => r[2]), ['start', '+8.0%', '-5.0%', '+4.0%']);
  assert.deepEqual([54, 47.5, 52].map((p) => (p - 50) / 50 * 100), [8, -5, 4]);
  const wk = Q.get('ft2030-s3-u6-l5-q3').figure.rows;
  assert.deepEqual(wk, [['0', '$40.00'], ['2', '$44.00'], ['4', '$32.00'], ['6', '$42.00']]);
});

test('level 4 game tie-in: the game’s starting rates', () => {
  const hisa = POLICY_BP + SPREADS.hisa;
  assert.equal(hisa, 275); assert.equal(INFLATION_BP, 210);
  assert.ok(unit.levels[3].cards[2].text.includes('The game starts at 2.75% and 2.1%'));
  assert.ok(unit.levels[3].cards[2].text.includes('the teacher can change them'));
  // not used in any number answer (the real return at the game's defaults changes whenever a teacher changes a rate)
  assert.ok(!dump.includes('0.6%') && !dump.includes('0.64'));
});

test('wording: no real names, no market figures, no advice, nothing from the flagged outline lines', () => {
  assert.ok(!/\b(TSX|S&P|Nasdaq|ETF|RRSP|TFSA|iShares|Vanguard|bitcoin|Tesla|VGRO|VAB|FP Canada|Statistics Canada|CPI)\b/i.test(dump));
  assert.ok(!/\b(you should|buy now|best choice)\b/i.test(dump));
  assert.ok(!/(?<![\d,.$])(2008|2009|2020|2022|1976)(?![\d,])/.test(dump), 'no flagged history figure');
  assert.ok(!/\b(Maya|Dev|Priya|Ben|Amara|Alia|Ravi|Sami|Hana|Lars)\b/.test(dump));
});

test('no number answer is printed on a card or card figure of its level', () => {
  const dollars = (c) => [`$${(c / 100).toLocaleString('en-CA')}`, `$${(c / 100).toLocaleString('en-CA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`];
  for (const l of unit.levels) {
    const cardText = l.cards.map((k) => k.text + JSON.stringify(k.figure ?? '')).join(' ');
    for (const q of l.questions.filter((x) => x.type === 'number')) {
      const forms = q.unit === '$' ? dollars(q.answer) : [`${q.answer}%`, `${q.answer.toFixed(1)}%`];
      for (const t of forms) assert.ok(!cardText.includes(t), `${q.id} answer ${t} is on a card`);
    }
  }
});
