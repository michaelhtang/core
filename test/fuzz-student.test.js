// The POST fuzz as a signed-in student (test/fuzz-common.js; split from fuzz.test.js so each role's sweep runs in its own process).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bodies, fuzzAs } from './fuzz-common.js';

test(`fuzz: ${bodies.length} crafted bodies on every POST route never produce a 500 (student)`, { timeout: 180000 }, async () => {
  assert.ok(await fuzzAs('student') > 3000);
});
