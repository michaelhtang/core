// scripts/learn-unit.mjs: check prints counts and writes nothing; splice writes the course file. Always on a temp copy.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const REAL = new URL('../modules/learn/content/fintech10.json', import.meta.url);
const CLI = new URL('../scripts/learn-unit.mjs', import.meta.url).pathname;

test('learn-unit: check reports counts and writes nothing; splice rewrites the file; a bad unit or unknown id fails', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'learn-unit-'));
  try {
    const raw = fs.readFileSync(REAL, 'utf8'), course = JSON.parse(raw);
    const file = path.join(dir, 'fintech10.json'), unitFile = path.join(dir, 'unit.json');
    fs.writeFileSync(file, raw);
    const pay = course.sections[0].units.find((u) => u.id === 'ft10-s1-u2');
    const run = (cmd, u = unitFile) => spawnSync(process.execPath, [CLI, cmd, u, '--course', file], { encoding: 'utf8' });
    const put = (u) => fs.writeFileSync(unitFile, JSON.stringify(u));

    put(pay);
    const c = run('check');
    assert.equal(c.status, 0, c.stderr);
    assert.match(c.stdout, /ft10-s1-u2: 8 levels, 40 cards, 72 questions \(choice \d+, point \d+, number \d+\), \d+ figures/);
    assert.equal(fs.readFileSync(file, 'utf8'), raw, 'check writes nothing');

    const bad = structuredClone(pay); bad.levels[0].questions[0].answer = 9;
    put(bad);
    const b = run('check');
    assert.equal(b.status, 1);
    assert.match(b.stderr, /fintech10\.json: sections\[0\]\.units\[1\]\.levels\[0\]\.questions\[0\]\.answer/);
    assert.equal(run('splice').status, 1);
    assert.equal(fs.readFileSync(file, 'utf8'), raw, 'a failed splice writes nothing');

    put({ ...pay, id: 'ft10-s9-u9' });
    assert.match(run('check').stderr, /no unit with id "ft10-s9-u9"/);

    const edited = structuredClone(pay); edited.blurb = 'A different blurb for the splice test.';
    put(edited);
    assert.equal(run('splice').status, 0);
    const out = JSON.parse(fs.readFileSync(file, 'utf8'));
    assert.equal(out.sections[0].units[1].blurb, edited.blurb);
    assert.equal(fs.readFileSync(file, 'utf8'), `${JSON.stringify(out, null, 2)}\n`);
    put(pay);
    assert.equal(run('splice').status, 0);
    assert.equal(fs.readFileSync(file, 'utf8'), raw, 'splicing the unchanged unit reproduces the real file byte for byte');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
