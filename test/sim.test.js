import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runSim, gini, median } from '../scripts/sim.mjs';
import { bankOnly } from './helpers.js';

test('sim: 300 bots across 10 classes, bank-basic only, is flat and the ledger audits clean', async () => {
  const rows = await runSim({ bots: 300, classes: 10, months: 6, config: bankOnly() });
  assert.equal(rows.length, 7);
  assert.deepEqual([rows[0].supply, rows[0].avg, rows[0].gini], [300 * 50000, 50000, 0]);   // month 0: grants only
  rows.forEach((r, i) => {
    assert.equal(r.auditOk, true);
    assert.equal(r.supply, 300 * 50000);                 // bank-basic alone has no faucet after the welcome grant
  });
  assert.equal(rows.at(-1).month, 7);
});

test('sim: savings interest is a faucet: with bank-basic + savings the supply only grows', async () => {
  const config = bankOnly();
  for (const k of Object.keys(config.courses)) config.courses[k].modules = ['bank-basic', 'savings'];
  const rows = await runSim({ bots: 120, classes: 4, months: 6, config });
  rows.forEach((r, i) => { assert.equal(r.auditOk, true); if (i) assert.ok(r.supply >= rows[i - 1].supply); });
  assert.ok(rows.at(-1).supply > rows[0].supply, 'HISA interest grew the supply');
});

test('gini and median behave', () => {
  assert.equal(gini([5, 5, 5, 5]).toFixed(6), '0.000000');
  assert.equal(gini([0, 0, 0, 100]).toFixed(2), '0.75');
  assert.equal(median([1, 9, 3]), 3);
  assert.equal(median([1, 3, 5, 9]), 4);
});

test('sim: the default config (jobs, bills, savings) reports Phase 1 economy columns; bills start after the first pay, so nobody is late before month 4', async () => {
  const rows = await runSim({ bots: 60, classes: 3, months: 5 });
  rows.forEach((r) => assert.equal(r.auditOk, true));
  const byMonth = Object.fromEntries(rows.map((r) => [r.month, r]));
  assert.equal(byMonth[2].bills, null);                       // first payday: bots are paid, not yet billed
  assert.ok(byMonth[2].netPay > 0);
  assert.ok(byMonth[3].bills > 0 && byMonth[3].bills < byMonth[3].netPay);
  assert.equal(byMonth[3].lateNow, 0);
  assert.ok(byMonth[6].savings > 0);
});

test('sim: insurance random town events are off unless eventsRandom is passed; with them on the ledger still audits clean', async () => {
  const count = async (eventsRandom) => {
    let n = 0;
    const rows = await runSim({ bots: 30, classes: 2, months: 12, eventsRandom, onEvent: (t) => { if (t === 'module.insurance.expense') n++; } });
    assert.ok(rows.every((r) => r.auditOk));
    return n;
  };
  assert.equal(await count(false), 0);
  assert.ok(await count(true) > 0);
});
