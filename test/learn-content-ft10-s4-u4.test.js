// Content check for the Learning Road unit "Payments technology" (ft10-s4-u4). Dollar figures about real payment methods are class examples from Mr. Tang's Lesson 33
// outline (pinned below to its lines); every number answer is recomputed; the game's transfer limits are recomputed by running the Bank module.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { boot, seeded } from './helpers.js';

const course = JSON.parse(fs.readFileSync(new URL('../modules/learn/content/fintech10.json', import.meta.url), 'utf8'));
const unit = course.sections.flatMap((s) => s.units).find((u) => u.id === 'ft10-s4-u4');
const Q = new Map(unit.levels.flatMap((l) => l.questions).map((q) => [q.id, q]));
const text = (l) => unit.levels[l - 1].cards.map((c) => c.text).join(' ');
const c = (d) => Math.round(d * 100 + 1e-6);
const fx = (d) => d.toLocaleString('en-CA', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const OUT = 'slide-studio/courses/fintech10/context/outlines/2026-10-29 Lesson 33.md';

// Figures quoted from the Lesson 33 outline (all made-up class examples, flag 4). Line numbers are lines of that file.
const OUTLINE = {
  plan: { price: 400, each: 100, weeks: [0, 2, 4, 6], cite: `${OUT} lines 99 and 101 (slide 5: $400 sneakers, four $100 payments, 400 / 4 = 100; "0% interest if every payment is on time")` },
  stack: { plans: [[400, 0], [240, 2], [160, 4]], have: 150, fee: 10, total: 800, dues: [100, 160, 200, 200, 100, 40], shorts: [0, 10, 50, 50, 0, 0], shortTotal: 110, shortDays: 3, fees: 30, need: 200, cite: `${OUT} lines 196-228 (tab 2: B3 = 150, B4 = 10, rows 6-8, check values) and 134-137 (slide 9: 100, 160, 200, 200, 100, 40; 110 in all; 30; 800; 200)` },
  accounts: { monthly: 16.95, atm: 3, a: 203.40, b2: 72, b6: 216, b5: 180, cite: `${OUT} lines 231-250 (tab 3: $16.95, $3; 203.40, 72.00, 216.00, 180.00) and 36 (flag 4: made-up examples)` },
  codes: { cite: `${OUT} line 7 (FIN1010 3.8.1, 3.8.2, 3.8.7)` },
};

test('shape: 4 levels, 4-6 cards, 7-10 questions, ids, outcome codes, a Bank button, no pictures yet', () => {
  assert.ok(unit, 'unit ft10-s4-u4 is in fintech10.json');
  assert.equal(unit.title, 'Payments technology');
  assert.equal(unit.blurb, 'How money moves when you tap, send or pay later, and when it really leaves.');
  assert.deepEqual(unit.outcome_codes, ['FIN1010 3.8.1', 'FIN1010 3.8.2', 'FIN1010 3.8.7']);
  assert.equal(unit.levels.length, 4);
  unit.levels.forEach((l, i) => {
    assert.equal(l.id, `ft10-s4-u4-l${i + 1}`);
    assert.ok(l.cards.length >= 4 && l.cards.length <= 6, `${l.id}: ${l.cards.length} cards`);
    assert.ok(l.questions.length >= 7 && l.questions.length <= 10, `${l.id}: ${l.questions.length} questions`);
    assert.ok(l.questions.some((q) => q.figure) || l.cards.some((x) => x.figure), `${l.id}: a figure`);
    l.questions.forEach((q, k) => assert.equal(q.id, `${l.id}-q${k + 1}`));
    if (i < 3) assert.equal(l.go, undefined);
  });
  assert.deepEqual(unit.levels[3].go, { building: 'bank', label: 'Open the Bank' });
  assert.ok(!JSON.stringify(unit).includes('"image"'));
});

test('outline figures: the class example plan, the stacked plans and the two accounts', () => {
  const p = OUTLINE.plan; assert.equal(p.price / 4, p.each);
  assert.ok(text(3).includes('$400 sneakers') && text(3).includes('$400 / 4 = $100') && /class example/.test(text(3)));
  const s = OUTLINE.stack;
  const due = (w) => s.plans.filter(([, st]) => w >= st && w <= st + 6 && (w - st) % 2 === 0).reduce((a, [pr]) => a + pr / 4, 0);
  const W = [0, 2, 4, 6, 8, 10];
  assert.deepEqual(W.map(due), s.dues);
  assert.deepEqual(W.map((w) => Math.max(0, due(w) - s.have)), s.shorts);
  assert.equal(s.shorts.reduce((a, b) => a + b, 0), s.shortTotal); assert.equal(s.shorts.filter((x) => x > 0).length * s.fee, s.fees);
  assert.equal(s.plans.reduce((a, [pr]) => a + pr, 0), s.total); assert.equal(Math.max(...s.dues), s.need);
  const t = unit.levels[2].cards[3].figure.rows;
  assert.deepEqual(t.map((r) => r.slice(1)), W.map((w, i) => [`$${s.dues[i]}`, `$${s.have}`, `$${s.shorts[i]}`]));
  assert.deepEqual(unit.levels[2].cards[2].figure.rows, [['Sneakers', '$400', 'Week 0', '$100'], ['Headphones', '$240', 'Week 2', '$60'], ['Jacket', '$160', 'Week 4', '$40']]);
  assert.ok(text(3).includes('$800 in all') && text(3).includes('3 x $10 = $30') && text(3).includes('$110') && text(3).includes('$200 each payday'));
  assert.ok(/not a real price/.test(text(3)) && /Real plans pick their own dates/.test(text(3)));
  const a = OUTLINE.accounts;
  assert.equal(c(a.monthly * 12), c(a.a)); assert.equal(a.atm * 2 * 12, a.b2); assert.equal(a.atm * 6 * 12, a.b6); assert.equal(a.atm * 5 * 12, a.b5);
  assert.deepEqual(unit.levels[3].cards[2].figure.rows, [['0', `$${fx(a.a)}`, '$0.00'], ['2', `$${fx(a.a)}`, `$${fx(a.b2)}`], ['6', `$${fx(a.a)}`, `$${fx(a.b6)}`]]);
  assert.ok(text(4).includes('$16.95') && text(4).includes('made-up prices') && text(4).includes('no-fee student accounts'));
});

test('arithmetic: every number answer is recomputed from its prompt', () => {
  const s = OUTLINE.stack, a = OUTLINE.accounts;
  const leo = [[300, 0], [200, 2], [120, 4]].filter(([, st]) => 4 >= st && (4 - st) % 2 === 0 && 4 <= st + 6).reduce((x, [pr]) => x + pr / 4, 0);
  const want = {
    'ft10-s4-u4-l1-q7': c(240 - 18.5), 'ft10-s4-u4-l1-q9': c(32 + 45.5 + 12.25),
    'ft10-s4-u4-l2-q8': c(140), 'ft10-s4-u4-l2-q10': c(3 * 12),
    'ft10-s4-u4-l3-q2': c(280 / 4), 'ft10-s4-u4-l3-q5': c(200 - s.have), 'ft10-s4-u4-l3-q6': c(10 + 50 + 50), 'ft10-s4-u4-l3-q7': c(s.shortDays * s.fee), 'ft10-s4-u4-l3-q8': c(s.need), 'ft10-s4-u4-l3-q9': c(leo),
    'ft10-s4-u4-l4-q4': c(4 * a.atm * 12), 'ft10-s4-u4-l4-q5': c(a.a - 5 * a.atm * 12), 'ft10-s4-u4-l4-q9': c(Math.min(50, 100 - 70)),
  };
  const numbers = [...Q.values()].filter((q) => q.type === 'number').map((q) => q.id);
  assert.deepEqual(Object.keys(want).sort(), numbers.sort(), 'every number question is covered by this test');
  for (const [id, v] of Object.entries(want)) assert.ok(Math.abs(Q.get(id).answer - v) <= Q.get(id).tolerance + 1e-6 && Math.abs(Q.get(id).answer - v) < 1e-6, `${id}: stored ${Q.get(id).answer}, recomputed ${v}`);
  assert.equal(leo, 155); assert.equal(want['ft10-s4-u4-l4-q5'], 2340);
  for (const q of Q.values()) for (const t of q.traps ?? []) assert.notEqual(t.value, q.answer, `${q.id}: a trap equals the answer`);
  // each prompt names the amounts it uses
  assert.ok(Q.get('ft10-s4-u4-l1-q7').prompt.includes('$240.00') && Q.get('ft10-s4-u4-l1-q7').prompt.includes('$18.50'));
  assert.ok(Q.get('ft10-s4-u4-l3-q9').prompt.includes('$300') && Q.get('ft10-s4-u4-l3-q9').prompt.includes('$120'));
  assert.ok(Q.get('ft10-s4-u4-l4-q9').prompt.includes('$50') && Q.get('ft10-s4-u4-l4-q9').prompt.includes('$100') && Q.get('ft10-s4-u4-l4-q9').prompt.includes('$70'));
  // the point question: the first bar above $150 is week 2
  const pq = Q.get('ft10-s4-u4-l3-q4');
  assert.deepEqual(pq.figure.bars.map((b) => b.value), s.dues.map((d) => d * 100));
  assert.equal(pq.answer, pq.figure.bars.findIndex((b) => b.value > s.have * 100));
  // the table-of-six count (level 1 q6): three rows say Yes
  assert.equal(Q.get('ft10-s4-u4-l1-q6').figure.rows.filter((r) => r[2] === 'Yes').length, 3);
  assert.equal(Q.get('ft10-s4-u4-l1-q6').options[Q.get('ft10-s4-u4-l1-q6').answer].text, 'Three');
});

test('the game: transfers start off with $50 / $100 limits, a $1.00 minimum, and the daily limit is rolling (recomputed by running the Bank)', async () => {
  const srv = await boot();
  try {
    const { teacher, cls, students } = await seeded(srv, 2, { transfers: false });
    const [a, b] = students;
    const send = (cents) => a.client.post('/api/bank-basic/transfer', { to: b.username, cents });
    assert.deepEqual((await a.client.get('/api/bank-basic/status')).json, { enabled: false, per_transfer_cents: 5000, daily_cents: 10000, sent_24h_cents: 0 });
    assert.equal((await send(100)).status, 403);                                   // level 4 card 4 and q8: off until the teacher turns it on
    await teacher.post('/api/bank-basic/settings', { class_id: cls.id, enabled: true, per_transfer_cents: 5000, daily_cents: 10000 });
    assert.equal((await send(99)).status, 400);                                    // the smallest transfer is $1.00
    assert.equal((await send(5100)).status, 400);                                  // $50 per transfer
    assert.equal((await send(5000)).status, 200);
    assert.equal((await send(2000)).status, 200);                                  // $70 sent in the last 24 hours
    assert.equal((await a.client.get('/api/bank-basic/status')).json.sent_24h_cents, 7000);
    assert.equal((await send(3100)).status, 400);                                  // $31 is over what is left
    assert.equal((await send(3000)).status, 200);                                  // level 4 q9: the most she can send is $30
  } finally { await srv.cleanup(); }
  const src = fs.readFileSync(new URL('../modules/bank-basic/index.js', import.meta.url), 'utf8');
  assert.ok(/same class only/.test(src) && /reversible by the teacher/.test(src) && /MIN_CENTS = 100/.test(src));
  assert.ok(/panels: \[\{ id: 'bank', building: \{ key: 'bank'/.test(src), 'the go button opens the building key "bank"');
  const ui = fs.readFileSync(new URL('../modules/bank-basic/ui/bank.js', import.meta.url), 'utf8');
  assert.ok(ui.includes('Send to a classmate') && ui.includes('in any 24 hours'), 'the Bank screen shows the transfer form and the 24 hour room left');
});

test('the game: card autopay is off / minimum / full statement and pays only if chequing covers it; Bills has an autopay switch', () => {
  const credit = fs.readFileSync(new URL('../modules/credit/index.js', import.meta.url), 'utf8');
  assert.ok(credit.includes("['off', 'min', 'full'].includes(mode)"));
  assert.ok(credit.includes('autopay, all or nothing, never an overdraft'));
  assert.ok(credit.includes('if (need > 0 && k.ledger.balance(chq) >= need) payCard('), 'autopay pays the whole amount or nothing');
  assert.ok(fs.readFileSync(new URL('../modules/bills/ui/bills.js', import.meta.url), 'utf8').includes("'Autopay'"));
  assert.ok(/all or nothing/.test(Q.get('ft10-s4-u4-l4-q10').options.map((o) => o.text).join(' ')));
});

test('no brands or real payment names, no student named, no exclamation marks', () => {
  const all = JSON.stringify(unit);
  assert.ok(!/interac|apple pay|google pay|afterpay|klarna|affirm|tangerine|simplii|eq bank|koho|marketplace|!/i.test(all));
});
