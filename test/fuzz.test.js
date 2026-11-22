import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from '../lib/app.js';
import { boot } from './helpers.js';
import { moduleSource } from './module-source.js';
import { BASE, bodies, sweep, fuzzAs } from './fuzz-common.js';

test(`fuzz: ${bodies.length} crafted bodies on every POST route never produce a 500 (anonymous; student and teacher are their own files)`, { timeout: 180000 }, async () => {
  const fresh = await boot({ limits: { failDelayStepMs: 1, failDelayMaxMs: 1, ip: 1e9, user: 1e9, userHourly: 1e9 } });
  try {
    // setup exercised on an empty database first (BASE passphrase is too short, so it never actually creates the teacher)
    await sweep(fresh, 'fresh', '', ['/api/setup', '/api/login', '/api/logout']);
    assert.equal(fresh.app.db.prepare("SELECT COUNT(*) AS n FROM players WHERE role = 'teacher'").get().n, 0);
  } finally { await fresh.cleanup(); }
  assert.ok(await fuzzAs('anonymous') > 3000);
});

test('the fuzz bodies include every field name the modules read from a request body', () => {
  const names = new Set();
  for (const m of fs.readdirSync(path.join(ROOT, 'modules'))) {
    const file = path.join(ROOT, 'modules', m, 'index.js');
    if (fs.existsSync(file)) for (const [, name] of moduleSource(m).matchAll(/k\.input\.(?:str|int|bool)\(body, '(\w+)'/g)) names.add(name);
  }
  assert.ok(names.size >= 15, `found ${names.size} names`);
  assert.deepEqual([...names].filter((n) => !(n in BASE)), []);
});

test('the validated readers: wrong types are 400s with a plain message', async () => {
  const { str, int, bool, idParam } = await import('../lib/input.js');
  const status = (fn) => { try { fn(); return 200; } catch (e) { return e.status ?? 'crash'; } };
  assert.equal(str({ a: 'hi' }, 'a'), 'hi');
  assert.equal(str({}, 'a'), '');
  assert.equal(status(() => str({ a: { toString: 1 } }, 'a')), 400);
  assert.equal(status(() => str({ a: 5 }, 'a')), 400);
  assert.equal(status(() => str({ a: 'x'.repeat(11) }, 'a', { max: 10 })), 400);
  assert.equal(status(() => str(JSON.parse('{"constructor":"x"}'), 'constructor')), 200);
  assert.equal(status(() => str({}, 'constructor')), 200);                       // inherited properties are not input
  assert.equal(int({ n: 5 }, 'n', { min: 1, max: 9 }), 5);
  for (const bad of ['5', 5.5, NaN, Infinity, {}, [], true, 2 ** 60]) assert.equal(status(() => int({ n: bad }, 'n')), 400, String(bad));
  assert.equal(status(() => int({ n: 10 }, 'n', { max: 9 })), 400);
  assert.equal(status(() => int({}, 'n')), 400);
  assert.equal(int({}, 'n', { optional: true }), undefined);
  assert.equal(bool({ b: false }, 'b'), false);
  assert.equal(status(() => bool({ b: 'true' }, 'b')), 400);
  assert.equal(idParam('42'), 42);
  for (const bad of ['abc', '-1', '1.5', '', '1e3', '9'.repeat(16)]) assert.equal(status(() => idParam(bad)), 404, bad);
});
