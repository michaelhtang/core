import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { boot, seeded } from './helpers.js';
import { nextAnnouncement } from '../modules/rates/index.js';

const withModules = (mods) => { const c = JSON.parse(readFileSync(new URL('../config/vdaa.json', import.meta.url), 'utf8')); for (const k of Object.keys(c.courses)) c.courses[k].modules = mods; return c; };
const advance = async (teacher, n) => {
  const w = (await teacher.get('/api/teach/state')).json.world;
  assert.equal((await teacher.post('/api/teach/world/advance', { months: n, from: w.month })).status, 200);
};

test('announcement schedule: 8 months of each world year', () => {
  assert.deepEqual([0, 1, 2, 4, 10, 12].map(nextAnnouncement), [1, 3, 3, 6, 12, 13]);
});

test('rates + savings: first-tick event, teacher policy lever, savings follows the HISA rate and its own lever is refused', async () => {
  const srv = await boot({ config: withModules(['bank-basic', 'rates', 'savings']) });
  try {
    const seen = [];
    srv.app.events.on('module.rates.changed', (p) => seen.push(p));
    const { teacher, students: [s] } = await seeded(srv, 1);
    const cur = async (c = s.client) => (await c.get('/api/rates/current')).json;

    let v = await cur();
    assert.deepEqual([v.policy_bp, v.prime_bp, v.hisa_bp, v.mortgage5y_bp, v.loc_bp, v.card_apr_bp, v.history.length], [225, 445, 275, 420, 745, 2099, 0]);
    assert.equal(v.can_set, false);

    await advance(teacher, 1);
    assert.deepEqual(seen.map((p) => [p.month, p.policyBp, p.primeBp, p.hisaBp, p.mortgage5yBp, p.mortgageVarBp, p.locBp, p.cardAprBp]), [[2, 225, 445, 275, 420, 395, 745, 2099]]);
    assert.equal(typeof seen[0].worldId, 'number');
    v = await cur();
    assert.deepEqual(v.history, [{ month: 2, policy_bp: 225 }]);
    assert.equal(v.next_announcement_month, 3);
    let st = (await s.client.get('/api/savings/status')).json;
    assert.deepEqual([st.hisa_rate_bp, st.rates_managed], [275, true]);

    await advance(teacher, 1);
    assert.equal(seen.length, 1, 'no change, no event');

    // permissions and validation
    assert.equal((await s.client.post('/api/rates/policy', { policy_bp: 300 })).status, 403);
    assert.equal((await teacher.post('/api/rates/policy', { policy_bp: 1001 })).status, 400);
    assert.equal((await teacher.post('/api/rates/policy', { policy_bp: -1 })).status, 400);
    const r = await teacher.post('/api/rates/policy', { policy_bp: 300 });
    assert.equal(r.status, 200);
    assert.equal(r.json.applies_from_month, 4);
    v = await cur(teacher);
    assert.deepEqual([v.policy_bp, v.pending_bp, v.pending_from_month, v.can_set], [225, 300, 4, true]);

    const before = (await s.client.get('/api/savings/status')).json;
    await s.client.post('/api/savings/move', { direction: 'to_hisa', cents: 20000 });
    await advance(teacher, 1);                                                        // month 4: 3.00% policy -> 3.50% HISA
    assert.equal(seen.length, 2);
    assert.deepEqual([seen[1].month, seen[1].policyBp, seen[1].hisaBp, seen[1].primeBp], [4, 300, 350, 520]);
    st = (await s.client.get('/api/savings/status')).json;
    assert.equal(st.hisa_rate_bp, 350);
    assert.equal(st.hisa_cents, 20000 + Math.floor(20000 * 350 / 120000));            // month 4 interest already uses the new rate
    assert.equal(before.hisa_cents, 0);
    v = await cur();
    assert.deepEqual(v.previous.policy_bp, 225);
    assert.deepEqual(v.history.map((h) => h.policy_bp), [225, 300]);

    // savings' own lever is refused with a clear message, and its teacher view says so
    const lever = await teacher.post('/api/savings/rate', { hisa_bp: 100 });
    assert.equal(lever.status, 403);
    assert.match(lever.json.error, /Bank of DAA/);
    const view = (await teacher.get('/api/savings/teach')).json;
    assert.deepEqual([view.rates_managed, view.can_set_rate, view.hisa_rate_bp], [true, false, 350]);
  } finally { await srv.cleanup(); }
});

test('savings without rates: its own lever works and nothing is managed', async () => {
  const srv = await boot({ config: withModules(['bank-basic', 'savings']) });
  try {
    const { teacher, students: [s] } = await seeded(srv, 1);
    assert.equal((await s.client.get('/api/rates/current')).status, 404);
    await advance(teacher, 1);
    assert.equal((await teacher.post('/api/savings/rate', { hisa_bp: 600 })).status, 200);
    const st = (await s.client.get('/api/savings/status')).json;
    assert.deepEqual([st.hisa_rate_bp, st.rates_managed], [600, false]);
    assert.equal((await teacher.get('/api/savings/teach')).json.can_set_rate, true);
  } finally { await srv.cleanup(); }
});
