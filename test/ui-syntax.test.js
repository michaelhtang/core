// Every browser script parses. 5b shipped a Jobs teacher panel with an unescaped apostrophe that took the whole panel down; nothing but a browser noticed.
// `node --check` parses a file as the module it is (the package is "type": "module") without running it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const root = new URL('..', import.meta.url).pathname;
const files = [
  ...fs.readdirSync(path.join(root, 'public')).filter((f) => f.endsWith('.js')).map((f) => path.join(root, 'public', f)),
  ...fs.readdirSync(path.join(root, 'modules')).flatMap((m) => {
    const dir = path.join(root, 'modules', m, 'ui');
    return fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => f.endsWith('.js')).map((f) => path.join(dir, f)) : [];
  }),
];

test('every public/*.js and modules/*/ui/*.js parses', () => {
  assert.ok(files.length >= 20, `found ${files.length} files`);
  assert.ok(files.some((f) => f.endsWith(path.join('feed', 'ui', 'teach.js'))) && files.some((f) => f.endsWith(path.join('life', 'ui', 'teach.js'))));
  const bad = [];
  for (const f of files) {
    try { execFileSync(process.execPath, ['--check', f], { stdio: 'pipe' }); } catch (e) { bad.push(`${path.relative(root, f)}: ${String(e.stderr).split('\n').find((l) => /Error/.test(l)) ?? e.message}`); }
  }
  assert.deepEqual(bad, []);
});
