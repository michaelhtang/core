// Content check for the Learning Road unit "A plan for a lifetime" (ft2030-s3-u8). Every number answer is recomputed here by loops and
// bisection (the generator used closed forms), and the outline figures are pinned to the outline file and line they came from.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const course = JSON.parse(fs.readFileSync(new URL('../modules/learn/content/fintech2030.json', import.meta.url), 'utf8'));
const section = course.sections.find((s) => s.id === 'ft2030-s3');
const unit = section.units.find((u) => u.id === 'ft2030-s3-u8');
const draft = JSON.parse(fs.readFileSync(new URL('../modules/learn/draft/ft2030-s3-u8.json', import.meta.url), 'utf8'));
const Q = new Map(unit.levels.flatMap((l) => l.questions).map((q) => [q.id, q]));
const dump = JSON.stringify(unit);
const d = Math.round, cents = (x) => d(x * 100), c2 = (x) => d(x * 100) / 100;
const usd = (x, dp = 2) => `$${x.toLocaleString('en-CA', { minimumFractionDigits: dp, maximumFractionDigits: dp })}`;
const find = (l, text) => { const q = unit.levels[l - 1].questions.find((x) => x.prompt.includes(text)); assert.ok(q, `question with "${text}" in level ${l}`); return q; };
const cardsText = (l) => unit.levels[l - 1].cards.map((c) => c.text + JSON.stringify(c.figure ?? '')).join(' ');

// ---- independent routines (loops and bisection, not closed forms) ----
// balance of a loan after n months of paying `pay` at the end of each month at yearly rate `annual`
const loanBalance = (P, annual, n, pay) => { let b = P; for (let i = 0; i < n; i++) b = b * (1 + annual / 12) - pay; return b; };
const solve = (f, lo, hi) => { for (let i = 0; i < 200; i++) { const mid = (lo + hi) / 2; if (f(mid) > 0) lo = mid; else hi = mid; } return (lo + hi) / 2; };
const loanPayment = (P, annual, n) => solve((pay) => loanBalance(P, annual, n, pay), 0, P);              // balance still owing is positive while pay is too small
// savings balance after n monthly deposits at the end of each month
const savedBalance = (dep, annual, n) => { let b = 0; for (let i = 0; i < n; i++) b = b * (1 + annual / 12) + dep; return b; };
const goalDeposit = (G, annual, n) => solve((dep) => G - savedBalance(dep, annual, n), 0, G);              // goal not yet reached while the deposit is too small
const yearly = (p, r, n) => { let b = p; for (let i = 0; i < n; i++) b *= 1 + r; return b; };
const one = (x) => (d(x * 10) / 10).toString();

// Mr. Tang's outlines (slide-studio/courses/fintech2030/context/), line numbers of the versions read on 2026-11-24
const OUTLINE = {
  'Lesson 21 (claude-project/docs, Tue Oct 13) line 134 and 140: $20,000 at 6% for 10 years is $222.04 a month; $222.04 x 120 = $26,644.92 (nearly $26,645), $6,645 of interest': { P: 20000, rate: 0.06, n: 120, pay: 222.04, total: 26644.92, interest: 6645 },
  'Lesson 21 line 138: change the 10 years to 5 (60 months) and the payment jumps': { n: 60 },
  'Lesson 20 (claude-project/docs, Fri Oct 9) line 149: an emergency fund goal of 3 to 6 months of expenses': { low: 3, high: 6 },
  'Lesson 35 (v4) lines 239 and 339: $9,600 emergency fund over $2,400 monthly expenses is 4.0 months': { fund: 9600, exp: 2400, months: 4 },
  'Lesson 35 (v4) lines 241, 255 and 338: $120,000 less 15% is a paper loss of $18,000': { port: 120000, crash: 0.15, loss: 18000 },
  'Lesson 35 (v4) lines 286 and 571: the made-up plan goes 80% then 60% then 30% in equities': { eq: [80, 60, 30] },
  'Lesson 27 line 291 and 367, Lesson 35 (v4) lines 293 and 346: earned $60,000 last year, RRSP room 18% is $10,800 if under the maximum': { income: 60000, rate: 0.18, room: 10800 },
  'Lesson 28 (v2) lines 118 and 214: a savings account at 2% to 4% doubles in 18 to 36 years (72 / rate)': { lo: 2, hi: 4, yrsLo: 18, yrsHi: 36 },
  'Lesson 28 (v2) lines 121 and 123: under 6 years gets "past, not promised" (Mr. Tang’s own threshold, above 12% a year)': { years: 6 },
};
const O = (prefix) => OUTLINE[Object.keys(OUTLINE).find((k) => k.startsWith(prefix))];

test('shape: 4 levels, 4-6 cards, 7-10 questions, no pictures, no go, outline codes', () => {
  assert.deepEqual(draft, unit, 'the draft file and the course file hold the same unit');
  assert.equal(unit.title, 'A plan for a lifetime');
  assert.deepEqual(unit.outcome_codes, ['FIN3090 3.6', 'FIN3090 3.7', 'FIN3090 3.9', 'FIN3090 3.11', 'FIN3090 4.4.1', 'FIN3090 4.4.2', 'FIN3090 4.7']);
  assert.ok(!unit.outcome_codes.some((c) => c.startsWith('INF')) && !unit.outcome_codes.includes('FIN3090 3.6.4'));
  assert.equal(section.units.at(-1).id, 'ft2030-s3-u8', 'eighth and last unit of The Investor');
  assert.equal(section.units.length, 8);
  assert.deepEqual(unit.levels.map((l) => l.title), ['Two goals, two plans', 'The payment that gets you there', 'Registered accounts and tax', 'Does that number smell right?']);
  for (const [i, l] of unit.levels.entries()) {
    assert.equal(l.id, `ft2030-s3-u8-l${i + 1}`);
    assert.ok(l.cards.length >= 4 && l.cards.length <= 6); assert.ok(l.questions.length >= 7 && l.questions.length <= 10);
    assert.equal(l.go, undefined);
    assert.ok(l.questions.some((q) => q.figure) || l.cards.some((c) => c.figure), l.id);
    assert.ok(l.questions.filter((q) => q.type === 'number').length >= 2, l.id);
    assert.ok(l.questions.filter((q) => q.type === 'point').length >= 1, l.id);
    const pos = l.questions.filter((q) => q.type === 'choice').map((q) => q.answer);
    assert.ok(new Set(pos).size >= 2, `${l.id} choice answers vary in position`);
  }
  assert.equal(unit.levels.flatMap((l) => l.cards).length, 24);
  assert.equal(Q.size, 36);
  const by = (t) => [...Q.values()].filter((q) => q.type === t).length;
  assert.deepEqual([by('choice'), by('point'), by('number')], [18, 4, 14]);
  assert.ok(!/"image"/.test(dump) && !dump.includes('!'));
  assert.ok(!/\b(AI|artificial|spreadsheet function|=PMT|PMT\()/i.test(dump.replace(/payment function/g, '')), 'no tool or syntax named');
});

test('the outline figures: used ones match what the outline says', () => {
  const loan = O('Lesson 21 (claude-project');
  assert.equal(c2(loanPayment(loan.P, loan.rate, loan.n)), loan.pay);
  assert.equal(c2(loan.pay * loan.n), 26644.8);              // 120 payments of the rounded $222.04; the outline's $26,644.92 uses the unrounded payment
  assert.equal(c2(loanPayment(loan.P, loan.rate, loan.n) * loan.n), loan.total);
  assert.equal(d(loan.total), 26645); assert.equal(d(loan.total) - loan.P, loan.interest);
  assert.equal(c2(loanPayment(loan.P, loan.rate, O('Lesson 21 line 138').n)), 386.66);
  const ef = O('Lesson 20 '); assert.deepEqual([ef.low, ef.high], [3, 6]);
  const e = O('Lesson 35 (v4) lines 239'); assert.equal(e.fund / e.exp, e.months);
  const cr = O('Lesson 35 (v4) lines 241'); assert.equal(d(cr.port * cr.crash), cr.loss);
  const mix = O('Lesson 35 (v4) lines 286'); assert.deepEqual(mix.eq, [80, 60, 30]);
  const rm = O('Lesson 27 line 291'); assert.equal(d(rm.income * rm.rate), rm.room);
  const sn = O('Lesson 28 (v2) lines 118'); assert.equal(72 / sn.hi, sn.yrsLo); assert.equal(72 / sn.lo, sn.yrsHi);
  assert.equal(72 / 12, O('Lesson 28 (v2) lines 121').years);
  // the cards say what the outline says
  const t1 = cardsText(1), t2 = cardsText(2), t3 = cardsText(3), t4 = cardsText(4);
  assert.ok(t1.includes('3 to 6 months') && t1.includes('$2,400.00') && t1.includes('$9,600.00') && t1.includes('= 4.0 months') && t1.includes('$120,000.00') && t1.includes('15%') && t1.includes('$18,000.00'));
  assert.deepEqual(unit.levels[0].cards[5].figure.rows, mix.eq.map((p, i) => [['Early years', 'Middle years', 'Late years'][i], `${p}%`]));
  assert.ok(t2.includes('$20,000.00') && t2.includes('$222.04') && t2.includes('about $26,645') && t2.includes('about $6,645') && t2.includes('$386.66'));
  assert.ok(t3.includes('18% of last year’s earned income') && t3.includes('$60,000.00') && t3.includes('$10,800.00') && t3.includes('maximum'));
  assert.ok(t4.includes('2% to 4%') && t4.includes('18 to 36 years') && t4.includes('under 6 years') && t4.includes('12%'));
});

test('level 1 figures and arithmetic on the cards', () => {
  const L = unit.levels[0].cards;
  assert.ok(L[3].text.includes('9,600 / 2,400 = 4.0 months') && 9600 / 2400 === 4);
  assert.ok(L[4].text.includes(usd(120000 * 0.15)) && 120000 * 0.15 === 18000);
});

test('level 2 figures: loan table, interest on the loan, the goal deposit, the three waits', () => {
  const C = unit.levels[1].cards;
  assert.deepEqual(C[1].figure.rows, [['10 years', '120', usd(c2(loanPayment(20000, 0.06, 120)))], ['5 years', '60', usd(c2(loanPayment(20000, 0.06, 60)))]]);
  assert.ok(C[1].text.includes('6% / 12 = 0.5%') && C[3].text.includes('1.005^-120') && C[3].text.includes('= $222.04'));
  assert.ok(C[2].text.includes('about $26,645') && C[2].text.includes('about $6,645'));
  // the hand formulas agree with the loops
  assert.ok(Math.abs(20000 * 0.005 / (1 - 1.005 ** -120) - loanPayment(20000, 0.06, 120)) < 1e-6);
  assert.ok(Math.abs(6000 * 0.0025 / (1.0025 ** 36 - 1) - goalDeposit(6000, 0.03, 36)) < 1e-6);
  assert.ok(C[4].text.includes(`${usd(c2(goalDeposit(6000, 0.03, 36)))} a month`) && C[4].text.includes('0.25%'));
  const rows = [2, 3, 5].map((y) => { const p = c2(goalDeposit(6000, 0.03, 12 * y)); const paid = c2(p * 12 * y); return [String(y), usd(p), usd(paid), usd(c2(6000 - paid))]; });
  assert.deepEqual(C[5].figure.rows, rows);
  // a longer wait gives a smaller deposit
  const dep = [2, 3, 5].map((y) => goalDeposit(6000, 0.03, 12 * y)); assert.ok(dep[0] > dep[1] && dep[1] > dep[2]);
  // the deposit really reaches the goal when run month by month
  assert.ok(Math.abs(savedBalance(goalDeposit(6000, 0.03, 36), 0.03, 36) - 6000) < 1e-6);
});

test('level 3 figures: the room, the deduction, the tax-timing table', () => {
  const C = unit.levels[2].cards;
  assert.ok(C[1].text.includes(usd(60000 * 0.18)) && 60000 * 0.18 === 10800);
  assert.ok(C[2].text.includes('$5,000.00') && C[2].text.includes('$48,000.00') && C[2].text.includes(usd(48000 - 5000)) && 48000 - 5000 === 43000);
  assert.deepEqual(C[4].figure.rows, [
    ['Interest', 'Every year', 'When cashed in', 'Not taxed'],
    ['Dividends', 'Year received', 'When cashed in', 'Not taxed'],
    ['Capital gain', 'When sold', 'When cashed in', 'Not taxed']]);
  assert.ok(C[2].text.includes('not given back') && C[5].text.includes('January 1 of the next year'));
});

test('level 4 figures: doubling times and the range', () => {
  const C = unit.levels[3].cards;
  assert.ok(C[1].text.includes(`${72 / 4} to ${72 / 2} years`));
  const rows = [0.4, 3, 30].map((r) => { const t = Math.round((72 / r) * 100) / 100; return [`${r}%`, `${t} years`, t >= 18 && t <= 36 ? 'Inside' : 'Outside: check']; });
  assert.deepEqual(C[2].figure.rows, rows);
  assert.deepEqual(rows.map((r) => r[2]), ['Outside: check', 'Inside', 'Outside: check']);
  assert.ok(C[3].text.includes('0.4% per month') && 72 / 0.4 === 180 && C[3].text.includes('180 years') && C[3].text.includes('monthly rate x 12'));
  assert.ok(72 / 12 === 6 && C[5].text.includes('72 / 12 = 6'));
});

test('every number answer is recomputed', () => {
  const want = [
    [find(1, 'Hal spends'), cents(2375 * 6), 0],
    [find(1, 'paper loss'), cents(84000 * 0.15), 0],
    [find(1, 'On $90,000.00'), cents(90000 * (1 - 0.3)), 0],
    [find(2, 'What monthly rate'), 4.8 / 12, 1e-9],
    [find(2, '5 years (60 months'), cents(c2(loanPayment(12000, 0.06, 60))), 2],
    [find(2, 'wants $9,000.00 in 4 years'), cents(c2(goalDeposit(9000, 0.03, 48))), 2],
    [find(2, 'How many dollars of interest does'), cents(c2(c2(loanPayment(10000, 0.06, 36)) * 36 - 10000)), 0],
    [find(2, 'puts $250.00 a month'), cents(c2(c2(savedBalance(250, 0.03, 36)) - 250 * 36)), 0],
    [find(3, 'earned income last year was $52,500.00'), cents(52500 * 0.18), 0],
    [find(3, 'What income is left to be taxed'), cents(46000 - 3200), 0],
    [find(3, 'takes $8,000.00 out'), cents(8000 + 39500), 0],
    [find(4, 'doubling in 16 years'), 72 / 16, 0],
    [find(4, '0.35% per month'), c2(0.35 * 12), 0.05],
    [find(4, 'Multiply $5,000.00 by 1.12 five times'), cents(d(yearly(5000, 0.12, 5))), 50],
  ];
  for (const [q, v, tol] of want) {
    assert.equal(q.type, 'number');
    if (tol === 1e-9) assert.ok(Math.abs(q.answer - v) < 1e-9, q.id); else { assert.equal(q.answer, v, q.id); assert.equal(q.tolerance, tol, q.id); }
  }
  assert.equal(want.length, [...Q.values()].filter((q) => q.type === 'number').length);
  // the figures printed in the prompts agree with the loops
  assert.equal(c2(loanPayment(10000, 0.06, 36)), 304.22); assert.equal(c2(savedBalance(250, 0.03, 36)), 9405.14);
  assert.ok(find(2, 'puts $250.00 a month').prompt.includes('$9,405.14') && find(2, 'How many dollars of interest does').prompt.includes('$304.22'));
  // a hand rounding of the payment stays inside the tolerance
  assert.ok(Math.abs(c2(loanPayment(12000, 0.06, 60)) - 231.99) < 1e-9);
  assert.ok(Math.abs(c2(goalDeposit(9000, 0.03, 48)) - 176.71) < 1e-9);
  assert.equal(c2(yearly(5000, 0.12, 5)), 8811.71);
});

test('traps and choice keys', () => {
  const trapVals = (q) => (q.traps ?? []).map((t) => t.value);
  assert.ok(trapVals(find(2, '5 years (60 months')).includes(cents(12000 / 60)));
  assert.ok(trapVals(find(2, 'wants $9,000.00 in 4 years')).includes(cents(9000 / 48)));
  assert.ok(trapVals(find(2, 'How many dollars of interest does')).includes(cents(304.22 * 36)));
  assert.ok(trapVals(find(1, 'paper loss')).includes(cents(84000 * 0.85)));
  assert.ok(trapVals(find(3, 'earned income last year was $52,500.00')).includes(cents(52500 * 0.1)));
  assert.ok(trapVals(find(4, 'Multiply $5,000.00 by 1.12 five times')).includes(cents(5000 * (1 + 0.12 * 5))));
  // months covered
  const q4 = find(1, 'Kit spends'); assert.equal(q4.options[q4.answer].text, `${9000 / 2000} months`);
  // four friends: the most months is not the biggest fund
  const q7 = find(1, 'Four friends');
  const exp = { Eve: 1500, Bo: 2500, Max: 2000, Di: 1000 };
  assert.ok(q7.prompt.includes('Eve $1,500.00') && q7.prompt.includes('Bo $2,500.00') && q7.prompt.includes('Max $2,000.00') && q7.prompt.includes('Di $1,000.00'));
  const m = q7.figure.bars.map((b) => b.value / 100 / exp[b.label]);
  assert.equal(q7.answer, m.indexOf(Math.max(...m)));
  assert.notEqual(q7.answer, q7.figure.bars.map((b) => b.value).indexOf(Math.max(...q7.figure.bars.map((b) => b.value))));
  assert.equal(new Set(m).size, m.length);
  // Toni: shortest plan she can afford
  const q6 = find(2, 'Toni'); const bars = q6.figure.bars;
  assert.deepEqual(bars.map((b) => b.value), [2, 3, 4, 5].map((y) => cents(goalDeposit(10000, 0.03, 12 * y))));
  assert.equal(q6.answer, bars.findIndex((b) => b.value <= 20000)); assert.ok(q6.answer > 0 && bars[q6.answer - 1].value > 20000);
  // RRSP room closest to $8,000.00
  const q9 = find(3, 'closest to $8,000.00'); const room = q9.figure.bars.map((b) => Math.abs(b.value * 0.18 - 800000));
  assert.deepEqual(q9.figure.bars.map((b) => b.value), [36000, 44000, 52000, 62000].map((v) => v * 100));
  assert.equal(q9.answer, room.indexOf(Math.min(...room)));
  // the sniff test: exactly one bar falls outside 18 to 36 years
  const q7b = find(4, 'falls outside that range'); const yrs = q7b.figure.bars.map((b) => 72 / b.value);
  assert.deepEqual(q7b.figure.bars.map((b) => b.value), [3.2, 0.4, 2.1, 3.8]);
  assert.equal(yrs.filter((y) => y < 18 || y > 36).length, 1); assert.equal(q7b.answer, yrs.findIndex((y) => y < 18 || y > 36));
  // doubling time of 0.5%
  const q2 = find(4, '0.5% a year'); assert.equal(q2.options[q2.answer].text, `About ${72 / 0.5} years`);
  assert.ok(find(4, 'Ina’s sheet shows 144 years') && 72 / 0.5 === 144);
  // a doubling in 4 years is about 18% a year
  const q8 = find(4, 'doubled in 4 years'); assert.ok(q8.options[q8.answer].text.includes('18%') && 72 / 4 === 18 && 4 < 6);
  // RRSP room: first year none; over the maximum the maximum applies
  assert.ok(find(3, 'first job').options[find(3, 'first job').answer].text.startsWith('None yet'));
  assert.ok(find(3, 'more than the yearly maximum').options[find(3, 'more than the yearly maximum').answer].text.startsWith('The yearly maximum'));
});

test('wording: no real names, no flagged figures, no advice, no class games or projects', () => {
  assert.ok(!/\b(TSX|S&P|Nasdaq|ETF|iShares|Vanguard|bitcoin|Tesla|Wealthsimple|FP Canada|Statistics Canada|CPI|PDOC|ALIS)\b/i.test(dump));
  assert.ok(!/\b(Life Cycle|Wealth Architect|workbook|spreadsheet function|Marketplace|stock-watch|client case|Investment Library)\b/i.test(dump));
  assert.ok(!/\b(you should|buy now|best choice)\b/i.test(dump));
  // flagged figures never appear: RRSP and TFSA dollar limits, tax rates, inclusion rate, the 70/30 content rule, past market returns
  assert.ok(!/70% (Canadian|foreign|of)|70\/30|Canadian content|foreign content|inclusion|2005|2008|2020|2022/.test(dump));
  assert.ok(!/tax rate of \d|taxed at \d|\d+% tax/i.test(dump));
  assert.ok(/TFSA/.test(dump) && !/TFSA (limit|room) (is|of) \$/.test(dump));
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
