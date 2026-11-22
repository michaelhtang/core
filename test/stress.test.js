// stress (wave 6a, docs/phase6-roles.md §1.1): the score from each input, the levels and chip, the emergency loan (automatic at 80, on request from 50),
// its payment schedule on the ledger, a missed payment, credit's late mark, and the season close. Real jobs, credit and stress; a fake `life` whose
// `retired` answer the test sets. Bills are not loaded: the test emits module.bills.late and module.housing.payment itself, as bills and housing do.
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { ROOT } from '../lib/app.js';
import { boot, seeded, tmpDir } from './helpers.js';
import { schedule, payment } from '../modules/housing/mortgage.js';

const MODULES_URL = pathToFileURL(path.join(ROOT, 'lib', 'modules.js')).href;
const made = [];
after(() => { for (const d of made) fs.rmSync(d, { recursive: true, force: true }); });

async function world(count = 4, options = {}) {
  const d = tmpDir(); made.push(d);
  for (const id of ['bank-basic', 'jobs', 'credit', 'stress']) fs.symlinkSync(path.join(ROOT, 'modules', id), path.join(d, id));
  fs.mkdirSync(path.join(d, 'life'));
  fs.writeFileSync(path.join(d, 'life', 'index.js'), `import { defineModule } from '${MODULES_URL}';
export const retiredIds = new Set();
export default defineModule({ id: 'life', services: { retired: (k, { playerId }) => ({ retired: retiredIds.has(playerId) }) } });`);
  const mods = ['bank-basic', 'jobs', 'credit', 'stress', 'life'];
  const config = { courses: { fintech10: { label: 'x', modules: mods }, fintech2030: { label: 'y', modules: mods } }, options: { 'bank-basic': { startCents: 50000 }, stress: options } };
  const srv = await boot({ config, modulesDir: d });
  const t = await seeded(srv, count, { transfers: false });
  const app = srv.app;
  const life = await import(pathToFileURL(path.join(d, 'life', 'index.js')).href);
  const seen = [];
  for (const type of ['module.stress.loan', 'module.stress.loan_closed', 'module.stress.payment', 'module.stress.score']) app.events.on(type, (p) => seen.push({ type, ...p }));
  const wid = () => app.world.current().id;
  const next = () => app.world.current().month + 1;
  const state = (s) => app.db.prepare('SELECT * FROM stress_state WHERE player_id = ? AND world_id = ?').get(s.id, wid());
  const loan = (s) => app.db.prepare("SELECT * FROM stress_loans WHERE player_id = ? AND world_id = ? ORDER BY id DESC LIMIT 1").get(s.id, wid());
  const chq = (s) => app.ledger.balance(s.chequing.id);
  const owed = (s) => 0 - app.ledger.balance(app.ledger.accountId('player', s.id, 'loan'));
  const late = (s, n, month = next()) => { for (let i = 0; i < n; i++) app.events.emit('module.bills.late', { playerId: s.id, worldId: wid(), month, billId: `bill-${i}`, monthsLate: 1 }); };
  const advance = (months = 1) => { app.world.advance({ months }); assert.equal(app.ledger.audit().ok, true, `audit after month ${app.world.current().month}`); };
  const give = (s, cents) => app.ledger.post({ kind: 'test.grant', legs: [{ account: app.ledger.system('mint'), cents: -cents }, { account: s.chequing.id, cents }] });
  const drain = (s) => { const c = chq(s); if (c > 0) app.ledger.post({ kind: 'test.drain', legs: [{ account: s.chequing.id, cents: -c }, { account: app.ledger.system('sink'), cents: c }] }); };
  const me = async (s) => (await s.client.get('/api/me')).json;
  return { srv, app, ...t, life, seen, state, loan, chq, owed, late, advance, give, drain, me, wid };
}

test('the score: grace months, jobless, late bills (capped, fee lines ignored), missed housing payment, eviction, calm months, retirement, clamp; levels, chip and card', async () => {
  const w = await world(4);
  try {
    const [job, idle, ret, hit] = w.students;
    assert.equal((await job.client.post('/api/jobs/pick', { job_id: 1 })).status, 200);
    w.life.retiredIds.add(ret.id);
    assert.deepEqual((await w.me(idle)).homeCards?.filter((c) => c.module === 'stress') ?? [], [], 'no card before the first tick');
    w.advance();                                                                              // month 2: inside the grace months
    assert.deepEqual([job, idle, ret, hit].map((s) => w.state(s).score), [0, 0, 0, 0]);
    assert.deepEqual(JSON.parse(w.state(idle).why), [{ text: 'A calm month', points: -5 }]);
    assert.deepEqual(JSON.parse(w.state(job).why), [{ text: 'A calm month with a job', points: -10 }]);
    w.advance();                                                                              // month 3: jobless counts now, retired does not
    assert.deepEqual([job, idle, ret, hit].map((s) => w.state(s).score), [0, 15, 0, 15]);
    // month 4: hit gets 4 late bills (capped at +30) and a late-fee line (ignored), a missed mortgage payment (+20) and an eviction (+25)
    w.late(hit, 4);
    w.app.events.emit('module.bills.late', { playerId: hit.id, worldId: w.wid(), month: 4, billId: 'late-fee-9', monthsLate: 1 });
    w.app.events.emit('module.housing.payment', { playerId: hit.id, worldId: w.wid(), month: 4, onTime: false, amount: 100000, kind: 'mortgage' });
    w.app.events.emit('module.housing.payment', { playerId: job.id, worldId: w.wid(), month: 4, onTime: true, amount: 100000, kind: 'mortgage' });
    w.app.events.emit('module.housing.evicted', { playerId: hit.id, worldId: w.wid(), month: 4 });
    w.late(job, 1);
    w.advance();
    assert.equal(w.state(hit).score, 100, '15 + 15 + 30 + 20 + 25 = 105, clamped at 100');
    assert.deepEqual(JSON.parse(w.state(hit).why).map((x) => x.points), [15, 30, 20, 25]);
    assert.equal(w.state(job).score, 10, 'a late bill with a job: +10, no calm-month credit');
    assert.equal(w.state(ret).score, 0);
    const lvl = (await import('../modules/stress/index.js')).levelOf;
    assert.deepEqual([0, 24, 25, 49, 50, 79, 80, 100].map(lvl), ['Calm', 'Calm', 'Tight', 'Tight', 'Strained', 'Strained', 'Crisis', 'Crisis']);
    // the chip and the card read the stored row
    const m = await w.me(idle);
    const chip = m.badges.find((b) => b.text.startsWith('Stress'));
    assert.equal(chip.text, 'Stress 30 · Tight');
    assert.match(chip.title, /\+15 no job/);
    const card = m.homeCards.find((c) => c.module === 'stress');
    assert.equal(card.title, 'Stress');
    assert.equal(card.data.score, 30); assert.equal(card.data.can_ask, false);
    // a multi-month advance scores each month on its own events: late bills in month 6 only
    w.late(job, 2, 6);
    w.advance(3);                                                                             // months 5, 6, 7
    assert.equal(w.state(job).score, Math.max(0, 10 - 10) + 20 - 10);
    assert.equal(w.app.db.prepare('SELECT COUNT(*) AS n FROM stress_marks').get().n, 0, 'every month\'s marks were read and cleared');
    const scores = w.seen.filter((e) => e.type === 'module.stress.score' && e.playerId === job.id).map((e) => [e.month, e.score]);
    assert.deepEqual(scores.slice(-3), [[5, 0], [6, 20], [7, 10]]);
  } finally { await w.srv.cleanup(); }
});

test('the emergency loan: automatic when the score first reaches 80, 12 payments that sum to the principal exactly, closed, no second automatic loan without a new crossing', async () => {
  const w = await world(2);
  try {
    const [s, other] = w.students;
    w.advance(2);                                                                             // months 2-3: 15
    w.late(s, 3); w.advance();                                                                // month 4: +15 +30 = 60
    assert.equal(w.state(s).score, 60);
    assert.equal(w.loan(s), undefined);
    const before = w.chq(s);
    w.late(s, 1); w.advance();                                                                // month 5: +15 +10 = 85, crosses 80
    const L = w.loan(s);
    assert.equal(w.state(s).score, 85);
    assert.equal(L.how, 'auto'); assert.equal(L.principal_cents, 100000); assert.equal(L.apr_bp, 1999); assert.equal(L.opened_month, 5);
    assert.equal(L.payment_cents, payment(100000, 1999, 12));
    assert.equal(w.chq(s) - before, 100000); assert.equal(w.owed(s), 100000);
    assert.deepEqual(w.seen.filter((e) => e.type === 'module.stress.loan').map(({ type, ...p }) => p), [{ playerId: s.id, worldId: w.wid(), cents: 100000, aprBp: 1999 }]);
    assert.equal((await s.client.post('/api/stress/loan')).status, 409, 'one open loan at a time');
    const card = (await w.me(s)).homeCards.find((c) => c.module === 'stress').data;
    assert.equal(card.loan.left_cents, 100000); assert.equal(card.can_ask, false);
    w.give(s, 500000);
    const rows = schedule(100000, 1999, 12);
    for (let i = 0; i < 12; i++) { w.advance(); assert.equal(w.owed(s), rows[i].balance, `balance after payment ${i + 1}`); }
    const paid = w.app.db.prepare("SELECT t.meta FROM txns t WHERE t.kind = 'stress.loan_payment' AND t.id IN (SELECT txn_id FROM entries WHERE account_id = ?)").all(s.chequing.id).map((r) => JSON.parse(r.meta));
    assert.equal(paid.length, 12);
    assert.equal(paid.reduce((t, p) => t + p.principal, 0), 100000, 'principal parts sum to the principal exactly');
    assert.deepEqual(paid.map((p) => p.interest + p.principal), rows.map((r) => r.payment), 'each payment is the housing schedule row; the last absorbs the rounding');
    assert.equal(w.loan(s).status, 'closed'); assert.equal(w.loan(s).closed_month, 17);
    assert.equal(w.seen.filter((e) => e.type === 'module.stress.loan_closed').length, 1);
    assert.equal(w.seen.filter((e) => e.type === 'module.stress.payment' && e.playerId === s.id && e.onTime).length, 12);
    assert.equal(w.app.db.prepare("SELECT COUNT(*) AS n FROM credit_history WHERE player_id = ? AND source = 'loan' AND outcome = 'ontime'").get(s.id).n, 12);
    // still at 100 (jobless every month) but no new crossing: no second automatic loan
    w.advance(2);
    assert.equal(w.state(s).score, 100);
    assert.equal(w.app.db.prepare('SELECT COUNT(*) AS n FROM stress_loans WHERE player_id = ?').get(s.id).n, 1);
    assert.equal(w.loan(other)?.how ?? null, 'auto', 'the jobless classmate crossed 80 too (15 a month)');
  } finally { await w.srv.cleanup(); }
});

test('asking for the loan: refused below 50, granted from 50 (max of $1,000 and the last net pay), a missed payment adds interest and a $25 fee, +10 stress and a credit late mark', async () => {
  const w = await world(2, { loanAprBp: 2400 });
  try {
    const [s, pay] = w.students;
    assert.equal((await pay.client.post('/api/jobs/pick', { job_id: 1 })).status, 200);
    w.advance(3);                                                                             // months 2-4: s is jobless from month 3 = 30
    const low = await s.client.post('/api/stress/loan');
    assert.equal(low.status, 409); assert.match(low.json.error, /stress is 30.*opens at 50/);
    w.late(s, 1); w.advance();                                                                // month 5: +15 +10 = 55
    const r = await s.client.post('/api/stress/loan');
    assert.equal(r.status, 200, JSON.stringify(r.json));
    assert.equal(r.json.loan.principal_cents, 100000); assert.equal(r.json.loan.apr_bp, 2400); assert.equal(w.loan(s).how, 'asked');
    assert.equal((await s.client.post('/api/stress/loan')).status, 409, 'one open loan at a time');
    // the working student: net pay above $1,000 sets the size (rounded to the dollar)
    const net = w.app.db.prepare('SELECT net_cents FROM stress_state WHERE player_id = ?').get(pay.id).net_cents;
    assert.ok(net > 100000, `net pay ${net}`);
    w.late(pay, 3, 6); w.late(pay, 3, 7);                                                     // 30 + 30 -> 60 by month 7 (with a job: no jobless points)
    w.advance(2);
    assert.equal(w.state(pay).score, 60);
    const rp = await pay.client.post('/api/stress/loan');
    assert.equal(rp.status, 200);
    assert.equal(rp.json.loan.principal_cents, Math.round(w.app.db.prepare('SELECT net_cents FROM stress_state WHERE player_id = ?').get(pay.id).net_cents / 100) * 100);
    // s misses month 8: chequing emptied (the month 6 and 7 payments were made)
    assert.equal(w.loan(s).paid_n, 2);
    const owedBefore = w.owed(s), scoreBefore = w.state(s).score;
    w.drain(s);
    w.advance();
    const interest = Math.round(owedBefore * ((1 + 2400 / 20000) ** (1 / 6) - 1));
    assert.equal(w.owed(s), owedBefore + interest + 2500, 'interest and the $25 fee added to the debt');
    assert.equal(w.loan(s).missed_n, 1); assert.equal(w.loan(s).paid_n, 2);
    assert.equal(w.state(s).score, Math.min(100, scoreBefore + 15 + 10));
    assert.ok(JSON.parse(w.state(s).why).some((x) => x.text === 'Missed an emergency loan payment' && x.points === 10));
    assert.ok(w.seen.some((e) => e.type === 'module.stress.payment' && e.playerId === s.id && e.onTime === false && e.month === 8));
    assert.equal(w.app.db.prepare("SELECT COUNT(*) AS n FROM credit_history WHERE player_id = ? AND source = 'loan' AND outcome = 'late' AND month = 8").get(s.id).n, 1, 'credit marks it late');
    assert.deepEqual(w.app.modules.kernel('stress').modules.call('stress', 'todayFacts', { playerId: s.id }), { score: w.state(s).score, level: 'Crisis', hasLoan: true });
    // the term stretches by the missed month; the 12th payment made clears everything
    w.give(s, 1000000);
    w.advance(12);
    assert.equal(w.loan(s).status, 'closed'); assert.ok(w.loan(s).paid_n >= 12, 'the missed month stretched the term by about a payment'); assert.equal(w.owed(s), 0);
    // the teacher panel
    const t = (await w.teacher.get('/api/stress/teach')).json;
    assert.deepEqual(t.classes[0].students.map((x) => Object.keys(x).sort()), t.classes[0].students.map(() => ['level', 'loan_left_cents', 'loan_missed', 'score', 'username']));
    assert.equal((await s.client.get('/api/stress/teach')).status, 403);
  } finally { await w.srv.cleanup(); }
});

test('season close: the loan account is zeroed with the rest and the new season starts with no stress rows', async () => {
  const w = await world(2);
  try {
    const [s] = w.students;
    w.advance(6);                                                                             // jobless 15 a month: 75 at month 7
    w.late(s, 1); w.advance();                                                                // 90: automatic loan
    assert.equal(w.loan(s).status, 'open');
    assert.equal((await w.teacher.post('/api/teach/world/close')).status, 200);
    assert.equal(w.app.ledger.balance(w.app.ledger.accountId('player', s.id, 'loan')), 0);
    assert.equal(w.app.ledger.audit().ok, true);
    assert.equal(w.loan(s).status, 'closed', 'the season close closes the open loan row (the next world reuses the ledger account)');
    assert.equal((await w.teacher.post('/api/teach/world/create', { name: 'Season 2', season_start: '2027-02-01', season_end: '2027-06-30' })).status, 200);
    for (const t of ['stress_state', 'stress_marks', 'stress_loans']) assert.equal(w.app.db.prepare(`SELECT COUNT(*) AS n FROM ${t} WHERE world_id = ?`).get(w.wid()).n, 0, t);
    assert.equal((await s.client.post('/api/stress/loan')).status, 409);
  } finally { await w.srv.cleanup(); }
});

test('late bills: a first late month counts in full, a repeat (bills re-emits each tick) counts half; fee lines never count', async () => {
  const w = await world(1);
  try {
    const [s] = w.students;
    w.advance(2);                                                                             // month 3: jobless since month 3 = +15
    const base = w.state(s).score;
    w.late(s, 1); w.app.events.emit('module.bills.late', { playerId: s.id, worldId: w.wid(), month: w.app.world.current().month + 1, billId: 'bill-9', monthsLate: 2, first: false });
    w.advance();
    assert.equal(w.state(s).score, base + 15 + 10 + 5, 'jobless 15, one new late bill 10, one repeat 5');
    assert.ok(JSON.parse(w.state(s).why).some((x) => x.text === '2 bills late' && x.points === 15));
  } finally { await w.srv.cleanup(); }
});

test('after a missed loan payment the term stretches at the regular payment: no balloon of the added interest and fees on the last payment', async () => {
  const w = await world(1, { loanAprBp: 2400 });
  try {
    const [s] = w.students;
    w.advance(6); w.late(s, 1); w.advance();                                                  // automatic loan at 90
    const L = w.loan(s);
    w.drain(s);
    for (let i = 0; i < 4; i++) { w.advance(); w.drain(s); }                                  // four misses
    assert.equal(w.loan(s).missed_n, 4);
    // a modest income: just above the regular payment, far below the debt left
    w.give(s, L.payment_cents * 3);
    const before = w.loan(s).paid_n;
    w.advance();
    assert.equal(w.loan(s).paid_n, before + 1, 'paid the regular payment, not a balloon the chequing cannot meet');
    assert.ok(w.owed(s) > 0 && w.loan(s).status === 'open');
    w.give(s, 10000000);
    w.advance(12); w.advance(4);                                                              // four misses added ~$280 on top: about 14 regular payments in all
    assert.equal(w.loan(s).status, 'closed'); assert.equal(w.owed(s), 0);
  } finally { await w.srv.cleanup(); }
});
