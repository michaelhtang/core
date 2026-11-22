// Content check for the Learning Road unit "Risk and the market cycle" (ft2030-s3-u2): every number answer and figure is recomputed here
// with its own arithmetic (whole cents, one move at a time), the outline figures are checked against the table below (outline file and line),
// the Exchange facts the unit states are read from the module's own files, and no number answer is copied from a card of its level.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const course = JSON.parse(fs.readFileSync(new URL('../modules/learn/content/fintech2030.json', import.meta.url), 'utf8'));
const unit = course.sections.flatMap((s) => s.units).find((u) => u.id === 'ft2030-s3-u2');
const Q = new Map(unit.levels.flatMap((l) => l.questions).map((q) => [q.id, q]));
const q = (id) => Q.get(`ft2030-s3-u2-${id}`);
const allText = JSON.stringify(unit);

// ---- independent arithmetic: values in whole cents, a percent move applied to the CURRENT value, rounded to the cent ----
const move = (cents, pct) => Math.round((cents * (100 + pct)) / 100);
const run = (startDollars, ...pcts) => pcts.reduce((c, p) => move(c, p), Math.round(startDollars * 100));
const riseToRecover = (fallPct) => Math.round(((fallPct / (100 - fallPct)) * 100) * 10) / 10;       // one decimal place
const fallFromPeak = (peak, now) => Math.round(((peak - now) / peak) * 1000) / 10;                    // one decimal place
const m = (c) => `$${(c / 100).toLocaleString('en-CA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

// ---- the outline figures and rules this unit uses (outline file and line) ----
const DOCS = '/Users/michaeltang/claude-workspace/slide-studio/courses/fintech2030/context/claude-project/docs/';
const L14 = 'claude_Fintech 2030 Lesson 14 - Thursday Oct 1.md';
const L15 = 'claude_Fintech 2030 Lesson 15 - Friday Oct 2.md';
const OUTLINE = [
  { file: L14, line: 91, what: 'Worked example: $100 -> -20% -> $80 -> +10% -> $88, not $90 (a percent of the current value)', check: () => run(100, -20) === 8000 && run(100, -20, 10) === 8800, text: '$100 → −20% → $80 → +10% → $88' },
  { file: L15, line: 161, what: 'Convention table: a fall of around 5% is called a pullback', check: () => true, text: 'around 5%' },
  { file: L15, line: 162, what: 'Convention table: 10% or more is a correction', check: () => true, text: '10% or more' },
  { file: L15, line: 163, what: 'Convention table: 20% or more is a bear market', check: () => true, text: '20% or more' },
  { file: L15, line: 165, what: 'These are market convention, not law. Nobody enforces them', check: () => true, text: 'market convention, not law' },
  { file: L15, line: 169, what: 'Measured from the peak, not from where you bought', check: () => true, text: 'measured from the peak, not from where you bought' },
];

test('shape: 5 levels, 4-6 cards, 7-10 questions, id, title, blurb, outcome codes, go button, no pictures yet', () => {
  assert.equal(unit.id, 'ft2030-s3-u2');
  assert.equal(unit.title, 'Risk and the market cycle');
  assert.equal(unit.blurb, 'Risk tolerance, gains and losses in percent, bull and bear markets, and advice.');
  assert.deepEqual(unit.outcome_codes, ['FIN3080 1.2', 'FIN3080 1.3', 'FIN3080 1.4']);
  assert.equal(unit.levels.length, 5);
  for (const l of unit.levels) { assert.ok(l.cards.length >= 4 && l.cards.length <= 6, l.id); assert.ok(l.questions.length >= 7 && l.questions.length <= 10, l.id); assert.equal(l.learn.length, 2); }
  assert.equal(unit.levels.flatMap((l) => l.cards).length, 30);
  assert.equal(Q.size, 45);
  const by = (t) => [...Q.values()].filter((x) => x.type === t).length;
  assert.deepEqual([by('choice'), by('number'), by('point')], [28, 13, 4]);
  assert.ok(!/"image"/.test(allText));
  assert.deepEqual(unit.levels[4].go, { building: 'exchange', label: 'See the price lines' });
  for (const i of [0, 1, 2, 3]) assert.equal(unit.levels[i].go, undefined);
  for (const l of unit.levels) { const pos = l.questions.filter((x) => x.type === 'choice').map((x) => x.answer); if (pos.length >= 4) assert.ok(new Set(pos).size >= 2, l.id); }
  // every level with numbers has at least 2 number questions and one question with a figure (level 4 is about ideas: no numbers)
  for (const i of [0, 1, 2, 4]) { const l = unit.levels[i]; assert.ok(l.questions.filter((x) => x.type === 'number').length >= 2, l.id); assert.ok(l.questions.some((x) => x.figure), l.id); }
});

test('outline figures: each one is recomputed, and the outline line says what the unit says (when the outline file is on this machine)', () => {
  for (const o of OUTLINE) {
    assert.ok(o.check(), `${o.file}:${o.line} ${o.what}`);
    if (fs.existsSync(DOCS + o.file)) {
      const lines = fs.readFileSync(DOCS + o.file, 'utf8').split('\n');
      assert.ok(lines[o.line - 1].includes(o.text), `${o.file}:${o.line} should contain "${o.text}"`);
    }
  }
  // the card worked example is the outline's own, and the two thresholds in the table are the outline's 10% and 20%
  const l2 = JSON.stringify(unit.levels[1].cards[0]);
  assert.ok(l2.includes('$100.00') && l2.includes('$80.00') && l2.includes('$88.00') && l2.includes('$90.00'));
  const conv = unit.levels[2].cards[3].figure.rows;
  assert.deepEqual(conv, [['Around 5%', 'A pullback'], ['10% or more, under 20%', 'A correction'], ['20% or more', 'A bear market']]);
  assert.match(unit.levels[2].cards[3].text, /habit, not a law/);
  assert.match(unit.levels[2].cards[3].text, /measured from the peak, not from the price you paid/);
  // nothing from the class games' own figures appears
  for (const bad of ['$161.29', '$105.04', '8.6%', '58.2%', '$72.77', '$59.77', '$85.17', '$86.23', '+23%']) assert.ok(!allText.includes(bad), bad);
});

test('level 1: dollars lost, percent lost, a limit in percent, and the bars against a limit', () => {
  assert.equal(q('l1-q6').answer, Math.round(2500 * 100 * 0.12));
  assert.equal(q('l1-q7').answer, ((1800 - 1656) / 1800) * 100);
  assert.equal(q('l1-q8').answer, (750 / 5000) * 100);
  const f = q('l1-q9').figure;
  assert.equal(f.unit, '$');
  const vals = f.bars.map((b) => b.value);
  assert.deepEqual(vals, [98000, 86000, 64000]);
  const past = vals.map((v) => ((100000 - v) / 100000) * 100).map((p) => p > 20);
  assert.deepEqual(past, [false, false, true]);
  assert.equal(q('l1-q9').answer, 2);
  assert.equal(q('l1-q6').unit, '$'); assert.equal(q('l1-q7').unit, '%'); assert.equal(q('l1-q8').unit, '%');
});

test('level 2: moves are applied to the current value, one at a time; the recovery rises and the tables', () => {
  assert.equal(q('l2-q2').answer, run(200, -30, 10)); assert.equal(q('l2-q2').answer, 15400);
  assert.equal(q('l2-q3').answer, run(400, -10, -10)); assert.equal(q('l2-q3').answer, 32400);
  assert.equal(q('l2-q4').answer, riseToRecover(40)); assert.equal(q('l2-q4').answer, 66.7);
  assert.equal(q('l2-q5').answer, riseToRecover(60)); assert.equal(q('l2-q5').answer, 150);
  // a rise of the recovery size really gets back to the start (to the cent)
  assert.equal(run(100, -40, (100 / 60 - 1) * 100), 10000);
  // wrong answers named as traps are the real wrong paths
  const t2 = q('l2-q2').traps.map((t) => t.value); assert.ok(t2.includes(Math.round(20000 * (1 - 0.3 + 0.1))) && t2.includes(run(200, -30)));
  assert.equal(q('l2-q3').traps[0].value, Math.round(40000 * 0.8));
  // the bars: start $1,000.00, +10%, -30%, +20%
  const bars = q('l2-q8').figure.bars.map((b) => b.value);
  assert.deepEqual(bars, [100000, run(1000, 10), run(1000, 10, -30), run(1000, 10, -30, 20)]);
  assert.deepEqual(bars, [100000, 110000, 77000, 92400]);
  assert.deepEqual(q('l2-q9').figure.bars.map((b) => b.value), bars);
  assert.equal(bars.indexOf(Math.min(...bars)), q('l2-q8').answer);
  assert.equal(q('l2-q9').answer, Math.round(((100000 - 92400) / 100000) * 1000) / 10); assert.equal(q('l2-q9').answer, 7.6);
  // card 2 table (the outline's worked case) and card 5 table (rise needed after each fall)
  assert.deepEqual(unit.levels[1].cards[1].figure.rows, [['Start', 'none', '$100.00'], ['After the fall', '-20%', m(run(100, -20))], ['After the rise', '+10%', m(run(100, -20, 10))]]);
  const rows = unit.levels[1].cards[4].figure.rows;
  assert.deepEqual(rows, [10, 20, 50, 75].map((f) => [`${f}%`, m(10000 - f * 100), `${riseToRecover(f)}%`]));
  // card 3 and card 6 worked figures
  const c3 = unit.levels[1].cards[2].text;
  assert.ok(c3.includes(m(run(100, -25))) && c3.includes(m(run(100, -25, 25) - run(100, -25))) && c3.includes(m(run(100, -25, 25))));
  const c6 = unit.levels[1].cards[5].text;
  assert.ok(c6.includes(m(run(100, -10))) && c6.includes(m(run(100, -10, -10))));
  // the stacked-falls question: 20% then 10% leaves 72%, a fall of 28%, below 29%
  assert.equal(run(100, -20, -10), 7200);
  assert.ok(q('l2-q7').options[q('l2-q7').answer].text.includes('28%') && q('l2-q7').options[q('l2-q7').answer].text.includes('29%'));
});

test('level 3: falls from the peak, the price where a bear market begins, the trough, and the labels', () => {
  assert.equal(q('l3-q5').answer, fallFromPeak(80, 68)); assert.equal(q('l3-q5').answer, 15);
  assert.equal(q('l3-q7').answer, Math.round(15000 * 0.8)); assert.equal(q('l3-q7').answer, 12000);
  assert.equal(q('l3-q10').answer, riseToRecover(25)); assert.equal(q('l3-q10').answer, 33.3);
  assert.equal(fallFromPeak(50, 42), 16);                                                 // the card's example, a correction
  assert.ok(unit.levels[2].cards[4].text.includes('16%') && unit.levels[2].cards[4].text.includes('correction'));
  const label = (f) => (f >= 20 ? 'A bear market' : f >= 10 ? 'A correction' : 'A pullback');
  assert.equal(label(fallFromPeak(50, 42)), 'A correction');
  assert.equal(q('l3-q6').options[q('l3-q6').answer].text, label(24));
  assert.ok(q('l3-q6').prompt.includes('24%'));
  assert.equal(label(15), 'A correction');
  const line = q('l3-q1').figure.points.map((p) => p.value);
  assert.equal(q('l3-q1').answer, line.indexOf(Math.min(...line)));
  assert.equal(line.indexOf(Math.max(...line)), 3);                                       // the peak comes before the trough
  assert.ok(line.indexOf(Math.max(...line)) < q('l3-q1').answer);
  // clear cases only: the keyed labels use falls well inside a band, never the 5% "around" row
  assert.ok(!/pullback/i.test(q('l3-q6').options[q('l3-q6').answer].text));
});

test('level 4: six sources and who pays them; no real names, no follower counts, no ranking', () => {
  const rows = unit.levels[3].cards[1].figure.rows;
  assert.equal(rows.length, 6);
  assert.deepEqual(rows.map((r) => r[0]), ['Adviser at a bank', 'Fee-only planner', 'Discount brokerage app', 'Finance influencer', 'A company\'s own news release', 'A friend with a tip']);
  assert.ok(unit.levels[3].questions.every((x) => x.type === 'choice'));
  assert.ok(!/\d{3},?\d{3}|\bk followers\b|400k/i.test(JSON.stringify(unit.levels[3])));
});

test('level 5: the coin-flip lines are recomputed flip by flip, and the answers that follow from them', () => {
  const walk = (startDollars, pct, flips) => { const out = [Math.round(startDollars * 100)]; for (const f of flips) out.push(move(out[out.length - 1], f === 'H' ? pct : -pct)); return out; };
  const card = unit.levels[4].cards[2].figure;
  assert.equal(card.unit, '$');
  assert.deepEqual(card.points.map((p) => p.value), walk(40, 5, ['H', 'H', 'T', 'H', 'H', 'H', 'T']));
  assert.deepEqual(card.points.map((p) => p.value), [4000, 4200, 4410, 4190, 4400, 4620, 4851, 4608]);
  const qw = walk(50, 4, ['H', 'H', 'H', 'T', 'T', 'H', 'H']);
  const f = q('l5-q8').figure;
  assert.deepEqual(f.points.map((p) => p.value), qw);
  const first = qw.findIndex((v, i) => i > 0 && v < qw[i - 1]);
  assert.equal(q('l5-q8').answer, first); assert.equal(first, 4);
  assert.equal(q('l5-q6').answer, run(100, 10, -10)); assert.equal(q('l5-q6').answer, 9900);
  assert.equal(q('l5-q7').answer, run(50, -20, -20)); assert.equal(q('l5-q7').answer, 3200);
  assert.equal(q('l5-q7').traps[0].value, Math.round(5000 * 0.6));
});

test('the Exchange facts the unit states are true of the module and the config', () => {
  const ui = fs.readFileSync(new URL('../modules/exchange/ui/exchange.js', import.meta.url), 'utf8');
  assert.ok(ui.includes('Price over the last 12 months'), 'each card has a 12-month line');
  assert.ok(ui.includes('Exchange news'), 'the Exchange has a news strip');
  const cfg = JSON.parse(fs.readFileSync(new URL('../config/vdaa.json', import.meta.url), 'utf8'));
  for (const mod of ['exchange', 'learn']) assert.ok(cfg.courses.fintech2030.modules.includes(mod), mod);
  const c6 = unit.levels[4].cards[5].text;
  assert.match(c6, /12-month line on each card of its funds and town companies/);
});

test('no copied answers: no number answer\'s text appears on a card or card figure of its level', () => {
  const fig = (f) => {
    if (!f) return '';
    if (f.kind === 'table') return [f.title, ...f.columns, ...f.rows.flat()].join(' | ');
    const items = f.kind === 'line' ? f.points : f.bars;
    return [f.title, ...items.map((p) => `${p.label} ${f.unit === '$' ? m(p.value) : `${p.value}%`}`)].join(' | ');
  };
  const has = (text, s) => new RegExp(`(?<![\\d.,])${s.replace(/[$.]/g, '\\$&')}(?![\\d]|\\.\\d|,\\d)`).test(text);
  for (const l of unit.levels) {
    const cardText = l.cards.map((c) => `${c.text} | ${fig(c.figure)}`).join(' || ');
    for (const x of l.questions.filter((z) => z.type === 'number')) {
      const forms = x.unit === '$' ? [m(x.answer), `$${(x.answer / 100).toLocaleString('en-CA', { maximumFractionDigits: 0 })}`] : [`${x.answer}%`];
      for (const s of forms) assert.ok(!has(cardText, s), `${x.id} answer ${s} is written on a card of its level`);
    }
  }
});

test('hints, miss lines and why lines: nothing hands over a number answer in the hint', () => {
  for (const x of Q.values()) {
    assert.ok(x.hint.length <= 240);
    if (x.type === 'number') {
      const ans = x.unit === '$' ? m(x.answer) : `${x.answer}%`;
      assert.ok(!x.hint.includes(ans) && !x.miss.includes(ans), `${x.id}: hint or miss shows the answer`);
    }
  }
});

test('voice: no exclamation marks, no brand or real-market names, no advice or prediction wording', () => {
  assert.ok(!allText.includes('!'));
  assert.ok(!/\b(S&P|TSX|Dow|Nasdaq|Bitcoin|Tesla|RRSP|TFSA|ETF)\b/.test(allText));
  assert.ok(!/\byou should\b|\bshould buy\b|\bwill (rise|fall|go up|go down)\b/i.test(allText));
});
