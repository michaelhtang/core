// Nightly backup of the vDAA database. A WAL-safe copy: VACUUM INTO reads one consistent snapshot while the server keeps writing
// (a plain `cp` of vdaa.db would miss everything still in the -wal file). The copy is a single self-contained file, no -wal/-shm.
//   node scripts/backup.mjs [db-file] [backup-dir]       defaults: $VDAA_DB or $DATA_DIR/vdaa.db, and $BACKUP_DIR or <db dir>/backups
// Keeps the newest $BACKUP_KEEP copies (default 14) named <prefix>-YYYY-MM-DD-HHMMSS.db (UTC, so names sort by time), mode 0600.
// $BACKUP_PREFIX (default "vdaa") keeps another series apart: deploy-vdaa.sh uses "vdaa-predeploy" with its own keep count, so frequent
// deploys never push the nightly backups out. A name that already exists is never overwritten.
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const series = (prefix) => new RegExp(`^${prefix}-\\d{4}-\\d{2}-\\d{2}-\\d{6}\\.db$`);

// Returns { file, kept, pruned }. Throws if the copy is not a healthy database; the previous backups are never touched in that case.
export function backup({ dbFile, dir, keep = 14, prefix = 'vdaa', now = new Date() }) {
  if (!/^[a-z][a-z-]*$/.test(prefix)) throw new Error('prefix must be lowercase letters and dashes');
  if (!Number.isInteger(keep) || keep < 1) throw new Error('keep must be a whole number of at least 1');
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const stamp = now.toISOString().slice(0, 19).replace('T', '-').replaceAll(':', '');  // 2026-10-22-030000
  const file = path.join(dir, `${prefix}-${stamp}.db`);
  if (fs.existsSync(file)) throw new Error(`${file} already exists; not overwriting`);
  const tmp = path.join(dir, `.vdaa-${process.pid}.tmp`);
  fs.rmSync(tmp, { force: true });
  try {                                                                                  // whatever fails, no half-made file is left behind
    const src = new DatabaseSync(dbFile);
    try {
      src.exec('PRAGMA busy_timeout = 10000');
      src.prepare('VACUUM INTO ?').run(tmp);
    } finally { src.close(); }
    fs.chmodSync(tmp, 0o600);
    const copy = new DatabaseSync(tmp, { readOnly: true });
    try {
      const check = copy.prepare('PRAGMA integrity_check').all().map((r) => r.integrity_check);
      if (check.length !== 1 || check[0] !== 'ok') throw new Error(`backup failed integrity_check: ${check.join('; ')}`);
    } finally { copy.close(); }
    fs.linkSync(tmp, file);                                                              // a half-written file never carries a backup name; link fails if
                                                                                         // the name exists, so two runs in the same second can't overwrite
  } finally { fs.rmSync(tmp, { force: true }); }
  for (const n of fs.readdirSync(dir)) {                                                 // leftovers of a run that was killed mid-copy
    const stray = path.join(dir, n);
    if (/^\.vdaa-\d+\.tmp$/.test(n) && Date.now() - fs.statSync(stray).mtimeMs > 864e5) fs.rmSync(stray, { force: true });
  }
  const names = fs.readdirSync(dir).filter((n) => series(prefix).test(n)).sort().reverse();
  const pruned = names.slice(keep);
  for (const n of pruned) fs.rmSync(path.join(dir, n));
  return { file, kept: names.slice(0, keep).length, pruned: pruned.length };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  process.umask(0o077);
  const dbFile = process.argv[2] || process.env.VDAA_DB || path.join(process.env.DATA_DIR || 'data', 'vdaa.db');
  const dir = process.argv[3] || process.env.BACKUP_DIR || path.join(path.dirname(dbFile), 'backups');
  if (!fs.existsSync(dbFile)) { console.error(`no database at ${dbFile}`); process.exit(1); }
  try {
    const r = backup({ dbFile, dir, keep: Number(process.env.BACKUP_KEEP || 14), prefix: process.env.BACKUP_PREFIX || 'vdaa' });
    console.log(`backup ${r.file} (${r.kept} kept, ${r.pruned} pruned)`);
  } catch (e) { console.error(e.message); process.exit(1); }
}
