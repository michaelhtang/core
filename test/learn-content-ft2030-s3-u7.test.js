// Content check for the Learning Road unit "Investing with values" (ft2030-s3-u7): the eight made-up companies are pinned in a table here,
// every number answer is recomputed from it, no number answer is copied from a card of its level, and the game's Exchange notes are read from the module.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { FUNDS, STOCKS } from '../modules/exchange/constants.js';

const course = JSON.parse(fs.readFileSync(new URL('../modules/learn/content/fintech2030.json', import.meta.url), 'utf8'));
const unit = course.sections.flatMap((s) => s.units).find((u) => u.id === 'ft2030-s3-u7');
const Q = new Map(unit.levels.flatMap((l) => l.questions).map((q) => [q.id, q]));
const money = (c) => `$${(c / 100).toLocaleString('en-CA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const money0 = (c) => `$${(c / 100).toLocaleString('en-CA', { maximumFractionDigits: 0 })}`;
const cardsText = (l) => unit.levels[l - 1].cards.map((c) => c.text + JSON.stringify(c.figure ?? '')).join(' ');
const whole = JSON.stringify(unit);

// The made-up companies: name, kind, tests on animals, share of waste sent to landfill %, score. Made up for this unit (not from the outline, not the game's town stocks).
const CO = [
  ['Glimmer Lane Cosmetics', 'Beauty', true, 22, 41],
  ['Fernhill Soap Works', 'Beauty', false, 12, 78],
  ['Northcote Pharmacy Labs', 'Health', true, 13, 60],
  ['Willow Clinic Supplies', 'Health', false, 14, 64],
  ['Alder Stitch Apparel', 'Clothing', false, 40, 48],
  ['Birchmoor Outfitters', 'Clothing', false, 20, 66],
  ['Riverbend Printing', 'Paper', false, 6, 72],
  ['Cedarline Paper', 'Paper', false, 28, 52],
].map(([name, kind, tests, waste, score]) => ({ name, kind, tests, waste, score }));
const MONEY = 1200000;
const keepTest = (c) => !c.tests, keepLim = (p) => (c) => c.waste <= p, keepBoth = (p) => (c) => !c.tests && c.waste <= p;
const bestIn = (c) => c.score === Math.max(...CO.filter((d) => d.kind === c.kind).map((d) => d.score));
const kinds = (l) => new Set(l.map((c) => c.kind)).size;

const OUTLINE = 'slide-studio/courses/fintech2030/context/outlines/2026-11-04 Lesson 36 (v3).md';
const CITES = {
  threeWays: `${OUTLINE} lines 190-202 (Slide 5): exclude, best in class, own and vote; "Whose values? The client's." (line 195)`,
  whoGetsMoney: `${OUTLINE} lines 226-236 (Slide 8): the buyer pays the investor who sold; the company got money once, when it first sold the share`,
  whoItTouches: `${OUTLINE} lines 238-248 (Slide 9): a pick touches people; owners vote; price can fall and new money can get harder ("can")`,
  noEarnClaim: `${OUTLINE} line 87 and line 687 (exit slip Q7): no claim that screened funds earn more or less`,
  noRealFund: `${OUTLINE} line 86: no real fund is named; Part 4 is not used`,
};

test('shape: 3 levels, 4-6 cards, 7-10 questions, ids, outcome codes, one go button, no pictures yet', () => {
  assert.ok(unit, 'unit ft2030-s3-u7 is in fintech2030.json');
  assert.equal(unit.title, 'Investing with values');
  assert.equal(unit.blurb, 'Three ways to invest by your values, and who a choice affects.');
  assert.deepEqual(unit.outcome_codes, ['FIN3090 3.5', 'FIN3080 1.18']);
  assert.equal(unit.levels.length, 3);
  unit.levels.forEach((l, i) => {
    assert.equal(l.id, `ft2030-s3-u7-l${i + 1}`);
    assert.ok(l.cards.length >= 4 && l.cards.length <= 6, `${l.id}: ${l.cards.length} cards`);
    assert.ok(l.questions.length >= 7 && l.questions.length <= 10, `${l.id}: ${l.questions.length} questions`);
    assert.ok(l.questions.some((q) => q.figure), `${l.id}: at least 1 question with a figure`);
    l.questions.forEach((q, k) => assert.equal(q.id, `${l.id}-q${k + 1}`));
  });
  assert.ok(!whole.includes('"image"'), 'no image fields yet');
  assert.deepEqual(unit.levels[2].go, { building: 'exchange', label: 'Open the Exchange' });
  assert.ok(unit.levels.every((l, i) => i === 2 || !l.go));
});

test('the table figures match the pinned made-up companies', () => {
  const rows = (l, k) => unit.levels[l - 1].cards[k - 1].figure.rows;
  assert.deepEqual(rows(1, 6), CO.map((c) => [c.name, c.kind, c.tests ? 'Yes' : 'No', String(c.score)]));
  assert.deepEqual(rows(2, 3), CO.map((c) => [c.name, c.tests ? 'Yes' : 'No', `${c.waste}%`]));
  assert.deepEqual(rows(3, 1), CO.map((c) => [c.name, c.kind, `${c.waste}%`, String(c.score)]));
  assert.equal(MONEY / CO.length, 150000, '$1,500 in each of eight');
});

test('every figure value is a clean number (no floating-point tails)', () => {
  const vals = [];
  for (const l of unit.levels) {
    for (const f of [...l.cards.map((c) => c.figure), ...l.questions.map((q) => q.figure)].filter(Boolean)) {
      if (f.bars) vals.push(...f.bars.map((b) => b.value));
      if (f.points) vals.push(...f.points.map((b) => b.value));
    }
  }
  assert.ok(vals.length >= 8);
  for (const v of vals) assert.ok(Number.isFinite(v) && Math.round(v * 100) / 100 === v, `figure value ${v} is not clean`);
  for (const q of Q.values()) if (q.type === 'number') assert.ok(Math.round(q.answer * 100) / 100 === q.answer, `${q.id} answer`);
});

test('arithmetic: every number answer is recomputed', () => {
  const t25 = CO.filter(keepBoth(25)), t15 = CO.filter(keepBoth(15)), l15 = CO.filter(keepLim(15)), rinaL = CO.filter(keepTest);
  assert.deepEqual([CO.filter(keepLim(25)).length, l15.length, t25.length, t15.length, rinaL.length], [6, 4, 4, 3, 6]);
  const want = {
    'ft2030-s3-u7-l1-q6': { unit: '%', v: (2 / 8) * 100 },
    'ft2030-s3-u7-l1-q7': { unit: '$', v: 1800000 / 5 },
    'ft2030-s3-u7-l2-q4': { unit: '$', v: MONEY / l15.length - MONEY / rinaL.length },
    'ft2030-s3-u7-l3-q1': { unit: '$', v: MONEY / t25.length },
    'ft2030-s3-u7-l3-q2': { unit: '$', v: MONEY / t15.length },
    'ft2030-s3-u7-l3-q3': { unit: '%', v: (((CO.length - l15.length) * (MONEY / 8)) / MONEY) * 100 },
  };
  assert.deepEqual([want['ft2030-s3-u7-l2-q4'].v, want['ft2030-s3-u7-l3-q1'].v, want['ft2030-s3-u7-l3-q2'].v, want['ft2030-s3-u7-l3-q3'].v], [100000, 300000, 400000, 50]);
  for (const [id, w] of Object.entries(want)) {
    const q = Q.get(id);
    assert.ok(q, id);
    assert.equal(q.type, 'number');
    assert.equal(q.unit, w.unit, `${id} unit`);
    assert.equal(q.answer, w.v, `${id} answer`);
    assert.ok(q.working.includes(w.unit === '$' ? money(w.v) : `${w.v}%`), `${id} working shows the answer`);
  }
  assert.equal([...Q.values()].filter((q) => q.type === 'number').length, Object.keys(want).length, 'every number question is checked');
  const t3 = cardsText(3);
  assert.ok(t3.includes(`${money0(MONEY / CO.filter(keepLim(25)).length)} in each, up from ${money0(MONEY / 8)}`));
  assert.ok(!/five|three kinds|four kinds/i.test(t3), 'level 3 cards do not state the counts the questions ask for');
});

test('no copied answers: a number answer is not written on a card (or card figure) of its level', () => {
  for (const [id, q] of Q) {
    if (q.type !== 'number') continue;
    const lvl = Number(id.match(/-l(\d)-/)[1]);
    const shown = q.unit === '$' ? [money(q.answer), money0(q.answer)] : [`${q.answer}%`];
    for (const s of shown) assert.ok(!cardsText(lvl).includes(s), `${id}: answer ${s} is written on a card of level ${lvl}`);
  }
});

test('choice and point answers follow from the pinned companies', () => {
  const opt = (id) => { const q = Q.get(id); return q.options[q.answer].text; };
  assert.deepEqual(CO.filter((c) => !keepTest(c)).map((c) => c.name), ['Glimmer Lane Cosmetics', 'Northcote Pharmacy Labs']);
  assert.equal(opt('ft2030-s3-u7-l1-q8'), 'Glimmer Lane Cosmetics');
  const q8 = Q.get('ft2030-s3-u7-l1-q8').options.map((o) => CO.find((c) => c.name === o.text));
  assert.equal(q8.filter((c) => c.tests).length, 1, 'only one option tests on animals');
  const p1 = Q.get('ft2030-s3-u7-l1-q5');
  const over = p1.figure.bars.map((b, i) => [b, i]).filter(([b]) => b.value > 25);
  assert.equal(over.length, 1);
  assert.equal(p1.answer, over[0][1]);
  p1.figure.bars.forEach((b) => assert.equal(b.value, CO.find((c) => c.name.startsWith(b.label)).waste));
  const p3 = Q.get('ft2030-s3-u7-l3-q5');
  assert.deepEqual(p3.figure.bars.map((b) => b.value), [CO.filter(keepLim(25)), CO.filter(keepBoth(25)), CO.filter(keepLim(15)), CO.filter(keepBoth(15))].map((l) => MONEY / l.length));
  assert.equal(p3.answer, p3.figure.bars.map((b) => b.value).indexOf(Math.max(...p3.figure.bars.map((b) => b.value))));
  const best = CO.filter(bestIn);
  assert.deepEqual(best.map((c) => c.name), ['Fernhill Soap Works', 'Willow Clinic Supplies', 'Birchmoor Outfitters', 'Riverbend Printing']);
  assert.equal(kinds(best), 4);
  assert.equal(kinds(CO.filter(keepBoth(15))), 3);
  assert.equal(CO.filter(keepLim(15)).filter((c) => c.kind === 'Clothing').length, 0, 'no clothing company passes 15%');
  assert.equal(opt('ft2030-s3-u7-l3-q4'), '3');
  assert.equal(opt('ft2030-s3-u7-l3-q6'), 'Best in class keeps 4; exclusion keeps 3');
  assert.equal(CO.find((c) => c.name === 'Fernhill Soap Works').tests, false);
  assert.equal(CO.find((c) => c.name === 'Riverbend Printing').waste, 6);
});

test('the game: the Exchange notes are quoted only as the module has them, and none mentions a values screen', () => {
  const notes = [...FUNDS, ...STOCKS].map((s) => s.note);
  assert.ok(notes.length >= 11);
  for (const n of notes) assert.ok(!/values|ethic|esg|screen|responsible/i.test(n), `a note mentions a values screen: ${n}`);
  assert.ok(/None of those notes mentions a values screen/.test(cardsText(3)));
  assert.ok(/every fund and stock has a short note/.test(cardsText(3)));
  const cfg = JSON.parse(fs.readFileSync(new URL('../config/vdaa.json', import.meta.url), 'utf8'));
  assert.ok(cfg.courses.fintech2030.modules.includes('exchange'));
  // no company name is close to a town stock's name
  const town = STOCKS.map((s) => s.name.toLowerCase());
  for (const c of CO) for (const t of town) assert.ok(!c.name.toLowerCase().split(' ').some((w) => w.length > 4 && t.split(' ').includes(w)), `${c.name} shares a word with ${t}`);
});

test('the outline: three ways and the cited mechanics; no real fund, no earnings claim, no outline setup or figure', () => {
  assert.ok(CITES.threeWays && CITES.whoGetsMoney && CITES.whoItTouches && CITES.noEarnClaim && CITES.noRealFund);
  for (const w of ['Exclude', 'Best in class', 'Own and vote']) assert.ok(cardsText(1).includes(w), w);
  assert.ok(/not the company/i.test(cardsText(2)) && /first sold the share/.test(cardsText(2)), 'who gets the money (line 226-236)');
  assert.ok(/can fall/.test(cardsText(2)) && /can get harder/.test(cardsText(2)), 'worded with "can" (line 87)');
  assert.ok(!/\b(XIU|XEQT|XIC|VFV|VAB|VGRO|ESG)\b/.test(whole), 'no real fund or ticker');
  assert.ok(!/earn (more|less)|outperform|underperform|beat the market/i.test(whole), 'no claim that screened funds earn more or less');
  assert.ok(!/\$10,000|\$50\b|Fort McMurray|Bitumen|Halvard|Tamarack|Willowmere|Prairie|Corner Basket|tobacco|fossil|oil sands|workers/i.test(whole), 'none of the outline’s companies, family, rule data or figures');
  assert.ok(!/\bshould (buy|sell|invest)\b|you should\b/i.test(whole), 'no advice');
});
