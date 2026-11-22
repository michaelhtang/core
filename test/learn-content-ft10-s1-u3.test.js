// Content check for the Learning Road unit "Careers and pathways" (ft10-s1-u3): every number that comes from the game is recomputed from
// modules/jobs/catalogue.js and payroll.js, every figure quoted from Mr. Tang's outlines is checked against a cited table, and the shape is pinned.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { CATALOGUE, PATHS } from '../modules/jobs/catalogue.js';
import { payStub } from '../modules/jobs/payroll.js';

const course = JSON.parse(fs.readFileSync(new URL('../modules/learn/content/fintech10.json', import.meta.url), 'utf8'));
const unit = course.sections.flatMap((s) => s.units).find((u) => u.id === 'ft10-s1-u3');
const Q = new Map(unit.levels.flatMap((l) => l.questions).map((q) => [q.id, q]));
const money = (c) => `$${(c / 100).toLocaleString('en-CA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

// Figures quoted from Mr. Tang's outlines (folder slide-studio/courses/fintech10/context/claude-project/docs/). The test pins each to its file and line.
const OUTLINE = {
  modestMonthCents: { value: 250300, cite: 'claude_Lesson 3 Slide Outline Sept 8.md line 55 ("set it against $2,503"); claude_Lesson 5 Slide Outline Sept 10.md line 57 ("the $2,503 cost of a modest Edmonton life")' },
  fullTimeHoursPerWeek: { value: 40, cite: 'claude_Lesson 3 Slide Outline Sept 8.md line 64 (table row "General minimum wage, 40 h/wk")' },
};

// The game's own rows, found by title so a renumbered catalogue fails loudly.
const job = (title) => CATALOGUE.find((j) => j.title === title);
const step = (title, n) => PATHS.find((p) => p.job_id === job(title).id && p.step === n);
const gross = (r) => r.hourly_cents * r.hours_per_month;
const net = (g) => payStub({ grossCents: g, period: 1 }).net;
const MONTH = OUTLINE.modestMonthCents.value;
const pct = (a, b) => Math.round((a / b) * 1000) / 10;
const weekly = (hours) => Math.round(((hours * 12) / 52) * 10) / 10;

const cash = job('Cashier'), cook = job('Line cook'), bar = job('Barista'), life = job('Lifeguard'), ware = job('Warehouse associate'), day = job('Daycare assistant'),
  app = job('Apprentice electrician (1st period)'), adm = job('Administrative assistant'), bk = job('Junior bookkeeper'), csr = job('Customer service rep'), retail = job('Retail associate');

test('shape: 6 levels, 4-6 cards, 7-10 questions, ids, outcome codes, a go button into the Job Centre', () => {
  assert.ok(unit, 'unit ft10-s1-u3 is in fintech10.json');
  assert.equal(unit.title, 'Careers and pathways');
  assert.equal(unit.levels.length, 6);
  assert.ok(unit.outcome_codes.includes('FIN1010 6.1') && unit.outcome_codes.includes('FIN1010 6.2'));
  unit.levels.forEach((l, i) => {
    assert.equal(l.id, `ft10-s1-u3-l${i + 1}`);
    assert.ok(l.cards.length >= 4 && l.cards.length <= 6, `${l.id}: ${l.cards.length} cards`);
    assert.ok(l.questions.length >= 7 && l.questions.length <= 10, `${l.id}: ${l.questions.length} questions`);
    assert.ok(l.questions.filter((q) => q.type === 'number').length >= 2, `${l.id}: at least 2 number questions`);
    assert.ok(l.questions.some((q) => q.figure), `${l.id}: at least 1 question with a figure`);
    l.questions.forEach((q, k) => assert.equal(q.id, `${l.id}-q${k + 1}`));
  });
  assert.deepEqual(unit.levels[5].go, { building: 'job', label: 'Open the Job Centre' });
});

test('outline figures: the $2,503.00 month is quoted exactly and is the amount used in level 6', () => {
  assert.equal(OUTLINE.modestMonthCents.value, 250300);
  const l6 = unit.levels[5];
  assert.ok(l6.cards[0].text.includes('$2,503.00'));
  assert.equal(Q.get('ft10-s1-u3-l6-q2').answer, MONTH - net(gross(cook)));
  assert.equal(Q.get('ft10-s1-u3-l2-q7').answer, weekly(cash.hours_per_month));
  assert.ok(unit.levels[1].cards[4].text.includes(`${OUTLINE.fullTimeHoursPerWeek.value} hours`));
});

test('game numbers: every number answer is recomputed from catalogue.js and payroll.js', () => {
  const want = {
    'ft10-s1-u3-l1-q4': 90000 - 24000,
    'ft10-s1-u3-l1-q6': 142000 + 38000 + 900 + 26000,
    'ft10-s1-u3-l2-q2': gross(cash),
    'ft10-s1-u3-l2-q3': gross(cook),
    'ft10-s1-u3-l2-q6': gross(day) - gross(retail),
    'ft10-s1-u3-l2-q7': weekly(cash.hours_per_month),
    'ft10-s1-u3-l2-q8': bar.hourly_cents * 7,
    'ft10-s1-u3-l3-q3': step('Administrative assistant', 1).hourly_cents - adm.hourly_cents,
    'ft10-s1-u3-l3-q4': step('Junior bookkeeper', 2).hourly_cents - bk.hourly_cents,
    'ft10-s1-u3-l3-q6': (step('Warehouse associate', 1).hourly_cents - ware.hourly_cents) * ware.hours_per_month,
    'ft10-s1-u3-l3-q8': gross(adm),
    'ft10-s1-u3-l4-q3': Math.round(3358 / 2),
    'ft10-s1-u3-l4-q4': gross(app),
    'ft10-s1-u3-l4-q5': step('Apprentice electrician (1st period)', 1).hourly_cents,
    'ft10-s1-u3-l4-q7': step('Apprentice electrician (1st period)', 3).hourly_cents - app.hourly_cents,
    'ft10-s1-u3-l5-q1': step('Barista', 1).hourly_cents - bar.hourly_cents,
    'ft10-s1-u3-l5-q2': gross(step('Line cook', 1)) - gross(cook),
    'ft10-s1-u3-l5-q3': pct(step('Barista', 1).hourly_cents - bar.hourly_cents, bar.hourly_cents),
    'ft10-s1-u3-l5-q6': step('Cashier', 2).hourly_cents - cash.hourly_cents,
    'ft10-s1-u3-l5-q7': gross(step('Lifeguard', 1)) - gross(life),
    'ft10-s1-u3-l6-q2': MONTH - net(gross(cook)),
    'ft10-s1-u3-l6-q3': net(gross(day)),
    'ft10-s1-u3-l6-q4': MONTH - net(gross(day)),
    'ft10-s1-u3-l6-q5': pct(net(gross(adm)), gross(adm)),
    'ft10-s1-u3-l6-q8': net(gross(step('Line cook', 1))) - net(gross(cook)),
    'ft10-s1-u3-l6-q9': net(gross(step('Daycare assistant', 1))) - MONTH,
  };
  const numbers = [...Q.values()].filter((q) => q.type === 'number').map((q) => q.id);
  assert.deepEqual(Object.keys(want).sort(), numbers.sort(), 'every number question is covered by this test');
  for (const [id, v] of Object.entries(want)) assert.equal(Q.get(id).answer, v, `${id}: stored answer equals the recomputed value`);
  assert.equal(step('Apprentice electrician (1st period)', 1).hourly_cents, Math.round(3358 * 0.6), 'the 2nd period is 60% of $33.58');
});

test('game numbers: point answers, figures and the numbers written in cards agree with the game', () => {
  const bars = (id) => Q.get(id).figure.bars;
  const top = (id) => bars(id).reduce((b, x, i, a) => (x.value > a[b].value ? i : b), 0);
  const low = (id) => bars(id).reduce((b, x, i, a) => (x.value < a[b].value ? i : b), 0);
  const jobsL2 = [cash, cook, day, ware, life];
  assert.deepEqual(bars('ft10-s1-u3-l2-q5').map((b) => b.value), jobsL2.map(gross));
  assert.equal(Q.get('ft10-s1-u3-l2-q5').answer, top('ft10-s1-u3-l2-q5'));
  assert.equal(Q.get('ft10-s1-u3-l1-q5').answer, low('ft10-s1-u3-l1-q5'));
  assert.deepEqual(bars('ft10-s1-u3-l3-q5').map((b) => b.value), [csr.hourly_cents, step('Customer service rep', 1).hourly_cents, step('Customer service rep', 2).hourly_cents]);
  assert.deepEqual(bars('ft10-s1-u3-l4-q6').map((b) => b.value), [app.hourly_cents, ...[1, 2, 3].map((n) => step('Apprentice electrician (1st period)', n).hourly_cents)]);
  assert.equal(bars('ft10-s1-u3-l4-q6')[Q.get('ft10-s1-u3-l4-q6').answer].value, 2351);
  const firsts = [cash, cook, bar, life, ware];
  assert.deepEqual(bars('ft10-s1-u3-l5-q5').map((b) => b.value), firsts.map((j) => gross(step(j.title, 1)) - gross(j)));
  assert.equal(Q.get('ft10-s1-u3-l5-q5').answer, top('ft10-s1-u3-l5-q5'));
  const l6 = [cash, cook, day, app, csr];
  assert.deepEqual(bars('ft10-s1-u3-l6-q6').map((b) => b.value), l6.map((j) => net(gross(j))));
  const clearing = bars('ft10-s1-u3-l6-q6').map((b, i) => (b.value >= MONTH ? i : -1)).filter((i) => i >= 0);
  assert.deepEqual(clearing, [Q.get('ft10-s1-u3-l6-q6').answer], 'exactly one bar clears the month and it is the keyed one');
  // card claims in level 6: three entry jobs clear the month, the other nine do not
  const clears = CATALOGUE.filter((j) => net(gross(j)) >= MONTH).map((j) => j.title).sort();
  assert.deepEqual(clears, ['Administrative assistant', 'Customer service rep', 'Junior bookkeeper']);
  const t = unit.levels[5].cards.map((c) => c.text);
  assert.ok(t[1].includes(money(gross(cash))) && t[1].includes(money(net(gross(cash)))) && t[1].includes(money(MONTH - net(gross(cash)))));
  assert.ok(t[2].includes(`${pct(net(gross(cash)), gross(cash))}%`) && t[2].includes(`${pct(net(gross(adm)), gross(adm))}%`));
  const sup = step('Cashier', 1);
  assert.ok(t[4].includes(money(net(gross(sup)))) && t[4].includes(money(MONTH - net(gross(sup)))) && t[4].includes(`${sup.hours_per_month} hours`));
  // the pay stub figure on level 6 card 2 is the real stub
  const s = payStub({ grossCents: gross(cash), period: 1 }), f = unit.levels[5].cards[1].figure;
  assert.deepEqual(f.lines.map((l) => l.cents), [s.gross, s.cpp, s.ei, s.federalTax, s.albertaTax, s.net]);
  // level 5 card figures and text
  const c = unit.levels[4].cards;
  assert.deepEqual(c[1].figure.rows.map((r) => r[3]), [cash, sup, step('Cashier', 2)].map((r) => money(gross(r))));
  assert.ok(c[2].text.includes(`${money(sup.hourly_cents - cash.hourly_cents)} an hour`) && c[2].text.includes(`${money(gross(sup) - gross(cash))} a month`) && c[2].text.includes(`${pct(sup.hourly_cents - cash.hourly_cents, cash.hourly_cents)}%`));
  // level 3 card 4 and level 2 figures
  const w = [ware, step('Warehouse associate', 1), step('Warehouse associate', 2)].map((r) => r.hourly_cents);
  assert.deepEqual(unit.levels[2].cards[3].figure.bars.map((b) => b.value), w);
  for (const r of unit.levels[1].cards[1].figure.rows) { const j = CATALOGUE.find((x) => x.title === r[0]); assert.deepEqual(r.slice(1), [j.employer, `${money(j.hourly_cents)} an hour`, String(j.hours_per_month)]); }
  assert.ok(unit.levels[1].cards[3].text.includes(money(gross(retail))) && unit.levels[1].cards[3].text.includes(money(gross(day))));
  // level 4: the apprentice periods pay 50, 60, 70 and 80 percent of the $33.58 in the catalogue note
  assert.match(app.requires_note, /\$33\.58/);
  [50, 60, 70, 80].forEach((p, i) => assert.equal([app, ...PATHS.filter((x) => x.job_id === app.id)][i].hourly_cents, Math.round((3358 * p) / 100)));
});

test('choice questions: the Job Centre rules written in level 5 match docs/jobs.md', () => {
  const doc = fs.readFileSync(new URL('../docs/jobs.md', import.meta.url), 'utf8');
  assert.match(doc, /12 months in the step/);
  assert.match(doc, /3 months/);
  const q = Q.get('ft10-s1-u3-l5-q8');
  assert.equal(q.options[q.answer].text, '12 months');
  const hq = Q.get('ft10-s1-u3-l5-q9');
  assert.ok(hq.prompt.includes(money(gross(step('Barista', 1)) - gross(bar))));
  assert.ok(hq.options[hq.answer].text.includes(`${bar.hours_per_month} to ${step('Barista', 1).hours_per_month}`));
});
