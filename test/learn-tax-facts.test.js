// The pinned tax facts (modules/learn/companies/tax-facts.js): every fact has its source, and the key numbers are pinned as literals.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as TF from '../modules/learn/companies/tax-facts.js';

const GROUPS = ['KINDS', 'SALES', 'CAPITAL_GAINS', 'INHERITANCE', 'CRA_ROLE', 'SIN', 'HISTORY', 'SPENDING', 'RIGHTS', 'SLIPS', 'T1_LINES', 'FILING', 'YEAR'];
const leaves = [];
const walk = (o, path) => {
  if (o && typeof o === 'object') {
    if ('quote' in o) leaves.push([path, o]);
    else for (const [k, v] of Object.entries(o)) walk(v, `${path}.${k}`);
  }
};
for (const g of GROUPS) walk(TF[g], g);

test('every fact has value, say, quote, official https url and read date', () => {
  assert.ok(leaves.length >= 130);
  for (const [path, x] of leaves) {
    assert.notEqual(x.value, undefined, path);
    assert.ok(x.say.length > 0 && x.say.length <= 220, `${path} say length`);
    assert.ok(!x.say.includes('!'), `${path} say has !`);
    const words = x.quote.trim().split(/\s+/).length;
    assert.ok(words > 0 && words <= 25, `${path} quote has ${words} words`);
    const u = new URL(x.url);
    assert.equal(u.protocol, 'https:', path);
    assert.ok(/(^|\.)(canada|alberta)\.ca$/.test(u.hostname), `${path} host ${u.hostname}`);
    assert.equal(x.read, '2026-11-15', path);
  }
});

test('MISSING and CONFLICTS are lists; each MISSING item says what was tried', () => {
  assert.ok(Array.isArray(TF.CONFLICTS));
  assert.ok(TF.MISSING.length > 0);
  for (const m of TF.MISSING) assert.ok(m.fact && m.tried);
});

test('sales taxes', () => {
  assert.equal(TF.SALES.gstRate.value, 5);
  assert.equal(TF.SALES.albertaPstRate.value, 0);
  assert.deepEqual(Object.fromEntries(Object.entries(TF.SALES.hst).map(([k, v]) => [k, v.value])), { NB: 15, NL: 15, NS: 14, ON: 13, PE: 15 });
  assert.deepEqual(Object.fromEntries(Object.entries(TF.SALES.pst).map(([k, v]) => [k, v.value])), { BC: 7, MB: 7, QC: 9.975, SK: 6 });
});

test('capital gains', () => {
  assert.equal(TF.CAPITAL_GAINS.inclusionRate2025.value, 0.5);
  assert.equal(TF.CAPITAL_GAINS.inclusionRate2025.year, 2025);
});

test('taxpayer bill of rights has 16 rights and 5 responsibilities', () => {
  assert.equal(TF.RIGHTS.count.value, 16);
  assert.equal(TF.RIGHTS.list.length, 16);
  assert.equal(TF.RIGHTS.responsibilities.length, 5);
});

test('history', () => {
  assert.deepEqual(TF.HISTORY.incomeTax1917.value, { year: 1917, act: 'Income War Tax Act' });
});

test('slip boxes', () => {
  const t4 = TF.SLIPS.T4;
  assert.deepEqual(Object.entries(t4).map(([k, v]) => [k, v.value.box]), [['box14', 14], ['box16', 16], ['box16A', '16A'], ['box18', 18], ['box22', 22], ['box24', 24], ['box26', 26]]);
  assert.equal(TF.SLIPS.T5.box13.value.box, 13);
  assert.equal(TF.SLIPS.T4A.box028.value.box, '028');
  assert.equal(TF.SLIPS.T4A.box105.value.box, 105);
  assert.equal(TF.SLIPS.T4A.box105.value.line, 13010);
});

test('T1 line numbers', () => {
  const lines = Object.fromEntries(Object.entries(TF.T1_LINES).filter(([, v]) => v.value && v.value.line).map(([k, v]) => [k, v.value.line]));
  assert.deepEqual(lines, { line10100: 10100, line12100: 12100, line15000: 15000, line20800: 20800, line22215: 22215, line23600: 23600, line26000: 26000, line30000: 30000, line30800: 30800, line31200: 31200, line31260: 31260, line42000: 42000, line43700: 43700, line48400: 48400, line48500: 48500 });
});

test('deadlines and filing window', () => {
  assert.equal(TF.FILING.deadline2025Return.value, '2026-04-30');
  assert.equal(TF.FILING.deadlineSelfEmployed2025Return.value, '2026-06-15');
  assert.equal(TF.FILING.paymentDeadline2025.value, '2026-04-30');
  assert.equal(TF.FILING.deadlineMost.value, 'April 30');
  assert.deepEqual(TF.YEAR.netfileWindow.value, { from: '2026-02-23', until: '2027-01-29' });
  assert.equal(TF.YEAR.taxYearsFileable.value.latest, 2025);
});

test('federal spending 2025-26 in $ millions', () => {
  const S = TF.SPENDING;
  assert.equal(S.year, '2025-26');
  assert.deepEqual([S.totalRevenues.value, S.totalExpenses.value, S.oldAgeSecurity.value, S.personalIncomeTax.value], [526412, 565728, 82741, 247735]);
});
