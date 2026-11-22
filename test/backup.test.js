import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import { bareApp, tmpDir } from './helpers.js';
import { createApp } from '../lib/app.js';
import { backup } from '../scripts/backup.mjs';

const LIB = new URL('../lib/app.js', import.meta.url).href;
// A second process that keeps posting transfers into the same database, so the backup really runs against a live WAL.
const writer = (dataDir, a, b) => spawn(process.execPath, ['--input-type=module', '-e', `
  import { createApp } from ${JSON.stringify(LIB)};
  const app = await createApp({ dataDir: ${JSON.stringify(dataDir)} });
  console.log('ready');
  for (let i = 0; ; i++) app.ledger.transfer({ from: ${a}, to: ${b}, cents: 1 + (i % 7), kind: 'transfer', actor: 'test' });
`], { stdio: ['ignore', 'pipe', 'inherit'] });

test('backup: a copy taken while another process writes opens and passes the ledger audit; pruning keeps the newest N, mode 0600', async () => {
  const { app, cls, dataDir, cleanup } = await bareApp();
  const [p, q] = await app.players.createStudents({ classId: cls.id, count: 2, hash: false });
  for (const s of [p, q]) app.modules.onLogin(s, 'fintech10');
  const a = app.ledger.accountId('player', p.id, 'chequing');
  const b = app.ledger.accountId('player', q.id, 'chequing');
  const w = writer(dataDir, a, b);
  const out = tmpDir();
  try {
    await new Promise((resolve, reject) => { w.stdout.on('data', (d) => /ready/.test(d) && resolve()); w.on('exit', () => reject(new Error('writer died'))); });
    const before = app.db.prepare('SELECT COUNT(*) AS n FROM entries').get().n;
    let last;
    for (let i = 0; i < 4; i++) {
      last = backup({ dbFile: path.join(dataDir, 'vdaa.db'), dir: out, keep: 3, now: new Date(Date.UTC(2026, 9, 22, 3, i)) });
      await new Promise((r) => setTimeout(r, 30));
    }
    assert.equal(last.kept, 3);
    assert.equal(last.pruned, 1);
    const names = fs.readdirSync(out).sort();
    assert.deepEqual(names, ['vdaa-2026-10-22-030100.db', 'vdaa-2026-10-22-030200.db', 'vdaa-2026-10-22-030300.db']);   // the oldest went, no stray temp file
    for (const n of names) assert.equal(fs.statSync(path.join(out, n)).mode & 0o777, 0o600);
    // restore the newest into a fresh data dir exactly as scripts/restore.md says, and audit it
    const restored = tmpDir();
    fs.copyFileSync(path.join(out, names[2]), path.join(restored, 'vdaa.db'));
    const r = await createApp({ dataDir: restored });
    try {
      const audit = r.ledger.audit();
      assert.equal(audit.ok, true, JSON.stringify(audit.problems));
      assert.ok(r.db.prepare('SELECT COUNT(*) AS n FROM entries').get().n >= before);
    } finally { r.db.close(); fs.rmSync(restored, { recursive: true, force: true }); }
  } finally {
    w.kill();
    await new Promise((r) => w.once('exit', r));
    fs.rmSync(out, { recursive: true, force: true });
    cleanup();
  }
});

test('backup: a failed copy leaves no temp file, and stray temp files older than a day are pruned', () => {
  const out = tmpDir();
  try {
    const junk = path.join(out, 'not-a-db.db');
    fs.writeFileSync(junk, 'this is not a database');
    assert.throws(() => backup({ dbFile: junk, dir: out, keep: 3 }));
    assert.deepEqual(fs.readdirSync(out).filter((n) => n.endsWith('.tmp')), []);
    const old = path.join(out, '.vdaa-111.tmp');
    const young = path.join(out, '.vdaa-222.tmp');
    fs.writeFileSync(old, 'x'); fs.writeFileSync(young, 'x');
    const twoDays = new Date(Date.now() - 2 * 864e5);
    fs.utimesSync(old, twoDays, twoDays);
    const good = path.join(out, 'good.db');
    new DatabaseSync(good).exec('CREATE TABLE t (a)');
    backup({ dbFile: good, dir: out, keep: 3 });
    assert.equal(fs.existsSync(old), false);
    assert.equal(fs.existsSync(young), true);                                       // might belong to a run that is still going
  } finally { fs.rmSync(out, { recursive: true, force: true }); }
});

test('backup: a second series (pre-deploy) is pruned on its own, and an existing name is never overwritten', () => {
  const out = tmpDir();
  try {
    const good = path.join(out, 'good.db');
    new DatabaseSync(good).exec('CREATE TABLE t (a)');
    const at = (sec) => new Date(Date.UTC(2026, 9, 22, 3, 0, sec));
    for (let i = 0; i < 3; i++) backup({ dbFile: good, dir: out, keep: 14, now: at(i) });
    for (let i = 0; i < 7; i++) backup({ dbFile: good, dir: out, keep: 5, prefix: 'vdaa-predeploy', now: at(10 + i) });
    const names = fs.readdirSync(out).filter((n) => n.startsWith('vdaa-')).sort();
    assert.equal(names.filter((n) => n.startsWith('vdaa-predeploy-')).length, 5);     // five kept, the two oldest pruned
    assert.deepEqual(names.filter((n) => !n.startsWith('vdaa-predeploy-')), ['vdaa-2026-10-22-030000.db', 'vdaa-2026-10-22-030001.db', 'vdaa-2026-10-22-030002.db']);
    assert.throws(() => backup({ dbFile: good, dir: out, keep: 14, now: at(0) }), /already exists/);   // same second: refused, the first stays
  } finally { fs.rmSync(out, { recursive: true, force: true }); }
});
