// Content check for the Learning Road unit "Net worth" (ft10-s3-u8). The mortgage figures come from modules/housing/mortgage.js; the game's net worth
// rule is checked against the real savings module (a kernel with bank-basic and savings, ledger accounts, and the housing and exchange value events).
// Figures quoted from Mr. Tang's Lesson 26 and 28 outlines are pinned to cited lines. Every number answer and table is recomputed here.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { boot, seeded } from './helpers.js';
import { payment, schedule } from '../modules/housing/mortgage.js';
import { roundNet } from '../modules/leaderboards/health.js';

const course = JSON.parse(fs.readFileSync(new URL('../modules/learn/content/fintech10.json', import.meta.url), 'utf8'));
const unit = course.sections.flatMap((s) => s.units).find((u) => u.id === 'ft10-s3-u8');
const Q = new Map(unit.levels.flatMap((l) => l.questions).map((q) => [q.id, q]));
const q = (l, n) => Q.get(`ft10-s3-u8-l${l}-q${n}`);
const D = (n) => `$${Math.round(Math.abs(n)).toLocaleString('en-CA')}`;
const is = (l, n, dollars) => assert.equal(q(l, n).answer, Math.round(dollars * 100), `${q(l, n).id}: stored ${q(l, n).answer}, recomputed ${dollars * 100}`);
const trap = (l, n, ...dollars) => assert.deepEqual(q(l, n).traps.map((t) => t.value), dollars.map((d) => Math.round(d * 100)), `${q(l, n).id} traps`);

const OUT = 'slide-studio/courses/fintech10/context/outlines';
const OUTLINE = {
  who: { value: { truck: [45000, 2000, 50000], car: [4000, 6000, 0] }, nw: [-3000, 10000], cite: `${OUT}/2026-10-22 Lesson 28.md line 62 and speaker note line 64` },
  home: { value: [400000, 80000, 320000, 0.05, 25], cite: `${OUT}/2026-10-22 Lesson 28.md line 74; 2026-10-20 Lesson 26.md line 89` },
  yr5: { value: { owing: 283224, paid: 111668, down: 36776, interest: 74892, equity: 116776, drop10: 76776 }, cite: `${OUT}/2026-10-22 Lesson 28.md lines 25 and 198` },
  first: { value: { pay: 1861, interest: 1320, principal: 541 }, cite: `${OUT}/2026-10-22 Lesson 28.md line 275-276` },
  future: { value: { assets: 17000, debts: 21400, nw: -4400, car: [16000, 9000, 11000] }, cite: `${OUT}/2026-10-22 Lesson 28.md lines 148-163` },
  whatifs: { value: { A: -4400, B: -5900, C: -2000, D: -4200 }, cite: `${OUT}/2026-10-22 Lesson 28.md line 180` },
};

test('shape: 5 levels, 4-6 cards, 7-10 questions, ids, codes, no pictures, one go button on the last level', () => {
  assert.equal(unit.title, 'Net worth');
  assert.equal(unit.blurb, 'What you own minus what you owe, and the moves that raise it.');
  assert.deepEqual(unit.outcome_codes, ['FIN1010 4.2', 'FIN1010 3.5']);
  assert.equal(unit.levels.length, 5);
  unit.levels.forEach((l, i) => {
    assert.equal(l.id, `ft10-s3-u8-l${i + 1}`);
    assert.ok(l.cards.length >= 4 && l.cards.length <= 6, `${l.id}: ${l.cards.length} cards`);
    assert.ok(l.questions.length >= 7 && l.questions.length <= 10, `${l.id}: ${l.questions.length} questions`);
    assert.ok(l.questions.filter((x) => x.type === 'number').length >= 2, `${l.id}: 2 number questions`);
    assert.ok(l.questions.some((x) => x.figure), `${l.id}: a question with a figure`);
    l.questions.forEach((x, k) => assert.equal(x.id, `${l.id}-q${k + 1}`));
  });
  assert.deepEqual(unit.levels[4].go, { building: 'networth', label: 'Open Net Worth' });
  assert.ok(unit.levels.slice(0, 4).every((l) => !l.go));
  assert.ok(!JSON.stringify(unit).includes('"image"'), 'no image fields yet');
  assert.ok(!/replica|Slide Studio|\bAI\b|Claude/i.test(JSON.stringify(unit)), 'no tool is named');
});

test('level 1: the outline hook (truck and car) recomputed, and the practice people', () => {
  const [truck, car] = [OUTLINE.who.value.truck, OUTLINE.who.value.car].map(([v, a, o]) => v + a - o);
  assert.deepEqual([truck, car], OUTLINE.who.nw);
  const rows = unit.levels[0].cards[3].figure.rows;
  assert.deepEqual(rows[1], ['Vehicle (what it could sell for)', '$45,000', '$4,000']);
  assert.deepEqual(rows[2], ['Money in accounts', '$2,000', '$6,000']);
  assert.deepEqual(rows[3], ['Owed on the vehicle', '$50,000', '$0']);
  assert.match(unit.levels[0].cards[3].text, /net worth is −\$3,000/);
  assert.match(unit.levels[0].cards[3].text, /hers is \$10,000/);
  is(1, 3, 9000 - 1000); is(1, 4, 26000 - 20000); is(1, 7, 12500 - 4300);
  trap(1, 3, 10000); trap(1, 4, 46000); trap(1, 7, 16800);
});

test('level 2: Jordan (the outline\'s "Future you at 24" page) recomputed', () => {
  const own = [1200, 3500, 2000, 9000, 1300], owe = [1800, 11000, 8000, 600];
  const A = own.reduce((a, b) => a + b), L = owe.reduce((a, b) => a + b);
  assert.deepEqual([A, L, A - L], [OUTLINE.future.value.assets, OUTLINE.future.value.debts, OUTLINE.future.value.nw]);
  const rows = unit.levels[1].cards[3].figure.rows;
  assert.deepEqual(rows.map((r) => r[1]), [...own, ...owe].map(D));
  is(2, 4, A); is(2, 5, L); is(2, 6, L - A); is(2, 7, 11000 - 9000); is(2, 8, 300 - 120);
  trap(2, 4, A - 9000 + 16000); trap(2, 5, L - 600); trap(2, 6, L + A); trap(2, 7, 16000 - 9000); trap(2, 8, 420);
  assert.deepEqual(OUTLINE.future.value.car, [16000, 9000, 11000]);
  const bars = q(2, 9).figure.bars.map((b) => b.value / 100);
  assert.equal(bars.indexOf(Math.max(...bars)), q(2, 9).answer);
});

test('level 3: the home, from the game\'s mortgage module', () => {
  const [price, down, loan, rate, years] = OUTLINE.home.value;
  assert.equal(price - down, loan);
  const bp = rate * 10000, n = years * 12, pay = payment(loan * 100, bp, n), sch = schedule(loan * 100, bp, n, pay);
  assert.equal(pay, 186114);                                                    // the outline's $1,861.14
  assert.equal(Math.round(pay / 100), OUTLINE.first.value.pay);
  const bal5 = Math.round(sch[59].balance / 100), paid5 = Math.round(sch.slice(0, 60).reduce((t, x) => t + x.payment, 0) / 100);
  const down5 = loan - bal5, int5 = paid5 - down5, eq5 = price - bal5, eq10 = price * 0.9 - bal5;
  const O = OUTLINE.yr5.value;
  assert.deepEqual({ owing: bal5, paid: paid5, down: down5, interest: int5, equity: eq5, drop10: eq10 }, O);
  assert.equal(Math.round(sch[0].interest / 100 / 10) * 10, OUTLINE.first.value.interest);
  assert.equal(Math.round(sch[0].principal / 100), OUTLINE.first.value.principal);
  const t = unit.levels[2].cards[2];
  assert.ok(t.text.includes('$1,861.14') && t.text.includes(D(bal5)));
  assert.deepEqual(t.figure.rows, [['Home value', D(price), D(price)], ['Mortgage still owed', D(loan), D(bal5)], ['Paid in 60 payments', '$0', D(paid5)]]);
  is(3, 1, 300000 - 240000); is(3, 2, eq5); is(3, 3, down5); is(3, 4, int5); is(3, 5, eq10);
  trap(3, 1, 540000); trap(3, 2, down); trap(3, 3, paid5); trap(3, 4, down5); trap(3, 5, eq5);
  assert.ok(price * 0.7 - bal5 < 0, 'the 30% case is negative equity');
  assert.deepEqual(q(3, 8).figure.bars.map((b) => b.value / 100), [down, eq5, eq10]);
  assert.equal(q(3, 8).answer, 1);
});

test('level 4: the outline\'s four what-ifs and the card-versus-savings arithmetic', () => {
  const A0 = 17000, D0 = 21400, W = OUTLINE.whatifs.value;
  const mv = { A: [A0 - 1800, D0 - 1800], B: [A0 - 1500, D0], C: [A0 + 2400, D0], D: [A0 + 200, D0] };
  for (const k of 'ABCD') assert.equal(mv[k][0] - mv[k][1], W[k], k);
  const rows = unit.levels[3].cards[1].figure.rows;
  ['A', 'B', 'C', 'D'].forEach((k, i) => assert.deepEqual(rows[i + 1].slice(1), [D(mv[k][0]), D(mv[k][1]), (W[k] < 0 ? '−' : '') + D(W[k])]));
  const monthly = (bal, bp) => Math.floor((bal * 100 * bp) / 120000) / 100;       // the game's card rule: floor(balance x rate / 12), cents
  assert.equal(monthly(1800, 2000), 30); assert.equal(monthly(1800, 300), 4.5);
  assert.ok(unit.levels[3].cards[2].text.includes('$30.00') && unit.levels[3].cards[2].text.includes('$4.50'));
  is(4, 2, 150 * 12); is(4, 3, monthly(2400, 2000)); is(4, 4, monthly(2400, 2000) - monthly(2400, 300)); is(4, 5, 3000 * 0.1);
  trap(4, 2, 150); trap(4, 3, 480); trap(4, 4, monthly(2400, 300)); trap(4, 5, 3300);
  assert.equal(20000 - 14000, 6000); assert.equal(9000 - 11000, -2000);
  assert.equal(q(4, 9).options[q(4, 9).answer].text, 'B: the car is worth less');
});

test('level 5: Sasha and Leo are worked by the game\'s own net worth rule (savings module, real ledger)', async () => {
  const savingsOnly = () => { const c = JSON.parse(fs.readFileSync(new URL('../config/vdaa.json', import.meta.url), 'utf8')); for (const k of Object.keys(c.courses)) c.courses[k].modules = ['bank-basic', 'savings']; return c; };
  const srv = await boot({ config: savingsOnly() });
  try {
    const { students: [s, leo] } = await seeded(srv, 2);
    const L = srv.app.ledger, mint = L.system('mint'), sink = L.system('sink');
    const acct = (id, kind, neg) => L.openAccount({ ownerType: 'player', ownerId: id, kind, ...(neg ? { allowNegative: true } : {}) });
    const give = (to, cents) => L.post({ kind: 'test', legs: [{ account: mint, cents: -cents }, { account: to, cents }] });
    const owe = (account, cents) => L.post({ kind: 'test', legs: [{ account, cents: -cents }, { account: sink, cents }] });
    const net = async (c) => (await c.get('/api/savings/status')).json.net_worth_cents;
    const chq = (id) => L.accountId('player', id, 'chequing');
    const setChq = (id, cents) => { const have = L.balance(chq(id)); if (cents > have) give(chq(id), cents - have); else L.post({ kind: 'test', legs: [{ account: chq(id), cents: -(have - cents) }, { account: sink, cents: have - cents }] }); };

    // Sasha: chequing 1,850, HISA 2,400, one GIC 1,000, holdings at the bid 1,200; card 650, emergency loan 500, unpaid bills 420
    setChq(s.id, 185000 + 240000 + 100000); await s.client.post('/api/savings/move', { direction: 'to_hisa', cents: 240000 });
    assert.equal((await s.client.post('/api/savings/gic', { term_months: 12, cents: 100000 })).status, 200);
    srv.app.events.emit('module.exchange.value', { playerId: s.id, worldId: srv.app.world.current().id, holdings: 120000 });
    owe(acct(s.id, 'card', true), 65000); owe(acct(s.id, 'loan', true), 50000); owe(acct(s.id, 'payable', true), 42000);
    const sasha = unit.levels[4].cards[4].figure.rows.map((r) => Number(r[1].replace(/[$,]/g, '')));
    const A = sasha.slice(0, 4).reduce((a, b) => a + b), Ldebt = sasha.slice(4).reduce((a, b) => a + b);
    assert.deepEqual([A, Ldebt], [6450, 1570]);
    // the card, loan and bills are posted against the sink (money already spent), so only the negative balance is on the page
    assert.equal(await net(s.client), (A - Ldebt) * 100, 'the game\'s net worth equals assets minus debts');
    is(5, 1, A); is(5, 2, Ldebt); is(5, 3, A - Ldebt);
    trap(5, 1, A - 1200); trap(5, 2, Ldebt - 420); trap(5, 3, A + Ldebt);
    // paying the card from chequing and taking a loan into chequing leave net worth where it was
    const before = await net(s.client);
    L.post({ kind: 'test', legs: [{ account: chq(s.id), cents: -65000 }, { account: L.accountId('player', s.id, 'card'), cents: 65000 }] });
    assert.equal(await net(s.client), before);
    L.post({ kind: 'test', legs: [{ account: L.accountId('player', s.id, 'loan'), cents: -30000 }, { account: chq(s.id), cents: 30000 }] });
    assert.equal(await net(s.client), before);

    // Leo: chequing 2,000, HISA 1,000, home 400,000 (value event), mortgage 283,224 (negative account)
    const bal5 = Math.round(schedule(32000000, 500, 300)[59].balance / 100);
    setChq(leo.id, 300000); await leo.client.post('/api/savings/move', { direction: 'to_hisa', cents: 100000 });
    srv.app.events.emit('module.housing.value', { playerId: leo.id, worldId: srv.app.world.current().id, homeValue: 40000000, mortgageBalance: bal5 * 100 });
    owe(acct(leo.id, 'mortgage', true), bal5 * 100);
    is(5, 7, 2000 + 1000 + 400000 - bal5);
    assert.equal(await net(leo.client), (2000 + 1000 + 400000 - bal5) * 100);
    assert.equal(srv.app.ledger.audit().ok, true);
  } finally { await srv.cleanup(); }
  is(5, 8, 5000); assert.equal(roundNet(488000), 500000); trap(5, 8, 4000);
});
