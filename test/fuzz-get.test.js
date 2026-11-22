// GET query fuzz (split from fuzz.test.js to keep each file under its timeout): every GET route in the live table, each paging/filter
// query param the server or a module reads (?before, ?limit, ?since) set to each crafted value, as anonymous, student and teacher. Never a 500.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { boot, seeded } from './helpers.js';

const PARAMS = ['before', 'limit', 'since'];
const VALUES = ['', '0', '-1', '1.5', '1e3', '1e308', '9'.repeat(400), 'NaN', 'Infinity', 'null', 'abc', '[]', '{}', '__proto__', '%00', 'x'.repeat(5000)];
const queries = ['', ...PARAMS.flatMap((p) => VALUES.map((v) => `?${p}=${encodeURIComponent(v)}`)), `?${PARAMS.map((p) => `${p}=-1`).join('&')}`, '?limit=1&limit=2'];

async function sweep(srv, label, cookie, paths) {
  const jobs = paths.flatMap((p) => queries.map((q) => p + q));
  const bad = [];
  for (let i = 0; i < jobs.length; i += 25) {
    await Promise.all(jobs.slice(i, i + 25).map(async (u) => {
      const res = await fetch(srv.base + u, { headers: cookie ? { cookie } : {} });
      const text = await res.text();
      let json = null;
      try { json = JSON.parse(text); } catch { /* checked below */ }
      if (res.status >= 500 || !json) bad.push(`${label} GET ${u.slice(0, 80)} ${res.status} -> ${text.slice(0, 100)}`);
    }));
  }
  assert.deepEqual(bad.slice(0, 5), [], `${bad.length} bad responses`);
  return jobs.length;
}

test('fuzz: crafted ?before / ?limit / ?since on every GET route never produce a 500 (anonymous, student and teacher)', { timeout: 180000 }, async () => {
  const srv = await boot({ limits: { failDelayStepMs: 1, failDelayMaxMs: 1, ip: 1e9, user: 1e9, userHourly: 1e9 } });
  try {
    const { teacher, students } = await seeded(srv, 2);
    await students[0].client.post('/api/bank-basic/transfer', { to: students[1].username, cents: 100 });   // a row for ?before to page past
    const paths = srv.routes.filter((r) => r.method === 'GET' && r.pattern !== '/api/stream').map((r) => r.pattern.replace(/:\w+/g, '1'));
    for (const expected of ['/api/teach/log', '/api/accounts/1/statement', '/api/bank-basic/transfers']) assert.ok(paths.includes(expected), expected);
    let total = 0;
    total += await sweep(srv, 'anonymous', '', paths);
    total += await sweep(srv, 'student', students[0].client.cookie(), paths);
    total += await sweep(srv, 'teacher', teacher.cookie(), paths);
    assert.ok(total > 1000, `${total}`);
    assert.equal(srv.app.ledger.audit().ok, true);
  } finally { await srv.cleanup(); }
});
