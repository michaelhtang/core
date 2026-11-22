// The 60-month economy guard: 100 bots, the default config, the sim's teacher actions on (a policy-rate rise and cut, a town insurance
// event, a housing market drop, an exchange crash, teacher-approved promotions, then a season close and a new world). About 35 s on an idle
// machine, up to ~150 s alongside the rest of the suite on a loaded one; VDAA_SKIP_ECONOMY=1 (or true) skips it. The figures come from the sim's own balance table (scripts/sim.mjs balanceTable), not recomputed here.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runSim, balanceTable } from '../scripts/sim.mjs';

const BOTS = 100;

test('economy guard: 60 months, 100 bots, teacher actions: audits clean every month and stays inside the Phase 2 targets', { skip: ['1', 'true'].includes(process.env.VDAA_SKIP_ECONOMY) ? 'VDAA_SKIP_ECONOMY is set' : false, timeout: 240000 }, async () => {
  const rows = await runSim({ bots: BOTS, months: 60, teacher: true });
  assert.deepEqual(rows.filter((r) => !r.auditOk).map((r) => r.month), [], 'ledger audit failed in these months');
  assert.deepEqual(rows.teacher.done.map((a) => a.action), ['policy +100', 'promotions', 'insurance trigger', 'venture demand +20%', 'housing market -10%', 'promotions', 'exchange crash', 'policy -50', 'promotions'], JSON.stringify(rows.teacher.done));
  assert.ok(rows.teacher.done.filter((a) => a.action === 'promotions').reduce((n, a) => n + a.count, 0) > 0, 'some promotions approved');
  const table = balanceTable(rows, BOTS);
  assert.deepEqual(table.map((r) => r.month), [12, 24, 36, 48, 60]);
  for (const r of table) {
    assert.ok(r.billsPay >= 0.5 && r.billsPay <= 0.75, `month ${r.month}: bills/pay ${r.billsPay}`);
    assert.ok(r.gini < 0.4, `month ${r.month}: Gini ${r.gini}`);
  }
  const end = table.at(-1);
  assert.ok(end.ownersShare >= 0.2 && end.ownersShare <= 0.5, `month 60: homeowners ${end.ownersShare}`);
  assert.ok(end.inArrears < 0.1, `month 60: owners in arrears ${end.inArrears}`);
  // stress (6a): students with an open emergency loan at month 60 stay under 15%
  const m60 = rows.find((r) => r.month === 60);
  if (m60?.openLoanShare !== undefined) assert.ok(m60.openLoanShare < 0.15, `month 60: open emergency loans ${m60.openLoanShare}`);
  // landlords (6b): rental owners stay under a tenth of the students, and evictions under 0.2 per tenant-year (0 in the sims so far: vacuous there, covered by test/landlords.test.js)
  if (m60?.rentalShare !== undefined) {
    assert.ok(m60.rentalShare < 0.10, `month 60: rental owners ${m60.rentalShare}`);   // observed ~2%
    if (m60.evictionsPerTenantYear !== null) assert.ok(m60.evictionsPerTenantYear < 0.2, `month 60: evictions per tenant-year ${m60.evictionsPerTenantYear}`);
  }
  // today (5a): errand and quest cash stays tiny, under 1% of lifetime net pay
  if (rows.today) assert.ok(rows.today.pct < 1, `errand cash ${rows.today.pct}% of pay`);
  // the season close and the next world: nothing carried over, and the ledger still balances
  assert.deepEqual(rows.teacher.newWorld.carried, {}, 'carried into the new world');
  assert.equal(rows.teacher.newWorld.auditOk, true);
});
