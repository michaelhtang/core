// Content check for "Rights and responsibilities" (ft2030-s1-u4). Every real fact is recomputed from modules/learn/companies/tax-facts.js
// (a draft read 2026-11-15 that awaits Mr. Tang's confirmation); nothing is retyped except made-up people's dates.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { RIGHTS, FILING } from '../modules/learn/companies/tax-facts.js';

const course = JSON.parse(fs.readFileSync(new URL('../modules/learn/content/fintech2030.json', import.meta.url), 'utf8'));
const unit = course.sections.flatMap((s) => s.units).find((u) => u.id === 'ft2030-s1-u4');
const [L1, L2] = unit.levels;
const Q = new Map(unit.levels.flatMap((l) => l.questions).map((q) => [q.id, q]));
const right = (id) => { const q = Q.get(id); return q.options[q.answer].text; };
const days = (a, b) => Math.round((Date.parse(b) - Date.parse(a)) / 864e5);
const titles = RIGHTS.list.map((r) => r.value);
const fmt = (iso) => new Date(iso + 'T12:00:00Z').toLocaleDateString('en-CA', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' });

test('shape and counts', () => {
  assert.equal(unit.title, 'Rights and responsibilities');
  assert.deepEqual(unit.outcome_codes, ['FIN2060 1.6']);
  assert.equal(unit.levels.length, 2);
  unit.levels.forEach((l, i) => {
    assert.equal(l.id, `ft2030-s1-u4-l${i + 1}`);
    assert.ok(l.cards.length >= 4 && l.cards.length <= 6 && l.questions.length >= 7 && l.questions.length <= 10);
    l.questions.forEach((q, k) => assert.equal(q.id, `${l.id}-q${k + 1}`));
    assert.equal(l.go, undefined);
    for (const c of l.cards) if (c.figure?.kind === 'table') assert.ok(c.figure.columns.length <= 4);
  });
  assert.ok(!/\d{3}[ -]?\d{3}[ -]?\d{3}/.test(JSON.stringify(unit)));
});

test('level 1: 16 rights, every quoted title is a title in tax-facts.js', () => {
  assert.equal(RIGHTS.list.length, 16);
  assert.equal(RIGHTS.count.value, 16);
  assert.equal(right('ft2030-s1-u4-l1-q1'), '16');
  const quoted = L1.cards.flatMap((c) => [...c.text.matchAll(/"([^"]+)"/g)].map((m) => m[1]));
  assert.ok(quoted.length >= 10);
  for (const t of quoted) assert.ok(titles.includes(t), `not a right title: ${t}`);
  for (const q of L1.questions.slice(1, 9)) for (const o of q.options) assert.ok(titles.includes(o.text), `option is not a right title: ${o.text}`);
  const key = { 2: 1, 3: 3, 4: 2, 5: 11, 6: 14, 7: 15, 8: 6, 9: 7 };
  for (const [n, i] of Object.entries(key)) assert.equal(right(`ft2030-s1-u4-l1-q${n}`), titles[i]);
});

test('level 2: dates and responsibilities from tax-facts.js', () => {
  const FD = FILING.deadline2025Return.value, FS = FILING.deadlineSelfEmployed2025Return.value, FP = FILING.paymentDeadline2025.value;
  assert.deepEqual([FD, FS, FP], ['2026-04-30', '2026-06-15', '2026-04-30']);
  assert.deepEqual(L2.cards[1].figure.rows, [['File (most people)', fmt(FD)], ['File (self-employed)', fmt(FS)], ['Pay tax owing', fmt(FP)]]);
  assert.equal(right('ft2030-s1-u4-l2-q1'), 'April 30, 2026');
  assert.equal(right('ft2030-s1-u4-l2-q2'), 'June 15, 2026');
  assert.equal(right('ft2030-s1-u4-l2-q3'), `${days('2026-04-12', FD)} days`);
  assert.equal(days('2026-04-12', FD), 18);
  assert.equal(right('ft2030-s1-u4-l2-q4'), `${days(FP, '2026-05-06')} days`);
  assert.equal(days(FP, '2026-05-06'), 6);
  assert.ok(RIGHTS.lateBalance.quote.includes('compound daily interest as of May 1'));
  assert.equal(right('ft2030-s1-u4-l2-q5'), 'May 1');
  const r = RIGHTS.responsibilities.map((x) => x.value);
  assert.equal(r.length, 5);
  assert.equal(right('ft2030-s1-u4-l2-q7'), r[3]);
  assert.equal(right('ft2030-s1-u4-l2-q8'), r[4]);
  assert.equal(right('ft2030-s1-u4-l2-q9'), r[1]);
  assert.equal(right('ft2030-s1-u4-l2-q10'), r[2]);
  assert.ok(!titles.includes(r[2]));
  assert.ok(RIGHTS.responsibilities[4].quote.includes('address'));
});
