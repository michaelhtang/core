import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { boot, seeded } from './helpers.js';

// This file tests savings on its own: other money modules (bills, jobs) would move chequing balances under it.
const savingsOnly = () => { const c = JSON.parse(readFileSync(new URL('../config/vdaa.json', import.meta.url), 'utf8')); for (const k of Object.keys(c.courses)) c.courses[k].modules = ['bank-basic', 'savings']; return c; };
import { monthlyInterest, maturityValue } from '../modules/savings/index.js';

const advance = async (teacher, n) => {
  const w = (await teacher.get('/api/teach/state')).json.world;
  const r = await teacher.post('/api/teach/world/advance', { months: n, from: w.month });
  assert.equal(r.status, 200, JSON.stringify(r.json));
};

test('interest and GIC maths: floor once, exact integers', () => {
  assert.equal(monthlyInterest(100000, 275), 229);        // 1,000.00 x 2.75% / 12 = 2.2916 -> 2.29
  assert.equal(monthlyInterest(10, 275), 0);
  assert.equal(maturityValue(100000, 370, 12), 103700);   // $1,000 at 3.70%, 1 year
  assert.equal(maturityValue(123456, 380, 36), 138071);   // compounding annually, 3 years
  assert.equal(maturityValue(100000, 390, 60), 121081);   // 1000 x 1.039^5 = 1210.81...
});

test('HISA interest, a 12-month GIC to maturity, snapshots, teacher rate lever, permissions', async () => {
  const srv = await boot({ config: savingsOnly() });
  try {
    const { teacher, students: [s, other] } = await seeded(srv, 2);
    const hisaOf = async (c) => (await c.get('/api/savings/status')).json;
    assert.equal((await s.client.post('/api/savings/move', { direction: 'to_hisa', cents: 600000 })).status, 400);   // only $500 on hand
    assert.equal((await s.client.post('/api/savings/move', { direction: 'sideways', cents: 100 })).status, 400);
    assert.equal((await s.client.post('/api/savings/move', { direction: 'to_hisa', cents: 20000 })).status, 200);    // $200
    assert.equal((await s.client.post('/api/savings/gic', { term_months: 12, cents: 9999 })).status, 400);           // under $100
    assert.equal((await s.client.post('/api/savings/gic', { term_months: 7, cents: 10000 })).status, 400);
    assert.equal((await s.client.post('/api/savings/gic', { term_months: 12, cents: 30000 })).status, 200);          // $300 GIC, $0 left in chequing
    assert.equal((await s.client.post('/api/savings/gic', { term_months: 12, cents: 10000 })).status, 400);
    let st = await hisaOf(s.client);
    assert.deepEqual([st.chequing_cents, st.hisa_cents, st.gics.length], [0, 20000, 1]);
    assert.equal(st.gics[0].maturity_cents, 31110);                                   // 300 x 1.037
    const me = (await s.client.get('/api/me')).json;
    assert.ok(me.accounts.some((a) => a.kind === 'gic:1'));

    await advance(teacher, 1);
    st = await hisaOf(s.client);
    assert.equal(st.hisa_cents, 20000 + 45);                                           // floor(200.00 x 2.75% / 12) = 45 cents
    assert.equal(st.snapshots.at(-1).net_worth_cents, 50045);

    // the teacher lever: students and non-world teachers cannot; it applies from the next tick
    assert.equal((await s.client.post('/api/savings/rate', { hisa_bp: 500 })).status, 403);
    assert.equal((await teacher.post('/api/savings/rate', { hisa_bp: 99999 })).status, 400);
    assert.equal((await teacher.post('/api/savings/rate', { hisa_bp: 600 })).status, 200);
    assert.equal((await hisaOf(s.client)).hisa_rate_bp, 600);
    await advance(teacher, 1);
    st = await hisaOf(s.client);
    assert.equal(st.hisa_cents, 20045 + Math.floor(20045 * 600 / 120000));

    await advance(teacher, 10);                                                        // bought in month 1, so it matures in month 13
    st = await hisaOf(s.client);
    assert.equal(st.gics[0].matured_month, 13);
    assert.equal(st.chequing_cents, 31110);                                            // $300 principal + $11.10 interest, paid once
    assert.equal(st.snapshots.length, 12);
    await advance(teacher, 1);
    assert.equal((await hisaOf(s.client)).chequing_cents, 31110);                      // never paid twice
    assert.equal((await hisaOf(other.client)).hisa_cents, 0);

    const view = (await teacher.get('/api/savings/teach')).json;
    assert.equal(view.classes[0].saved_cents, 50000);
    assert.equal(view.can_set_rate, true);
    assert.equal(srv.app.ledger.audit().ok, true);
  } finally { await srv.cleanup(); }
});
