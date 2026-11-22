// SQLite (node:sqlite) in WAL mode, numbered SQL migrations, and the one transaction helper.
import { DatabaseSync } from 'node:sqlite';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { createClock } from './clock.js';

// A handle's clock for audit stamps (createApp sets it). Handles opened without one use the wall clock.
const clocks = new WeakMap();
const wall = createClock();
export const useClock = (db, clock) => clocks.set(db, clock);

export function openDb(file) {
  const db = new DatabaseSync(file);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
  return db;
}

// BEGIN IMMEDIATE takes the write lock up front. Called inside a transaction it becomes a SAVEPOINT,
// so a ledger post inside a bigger operation (create players, tick the world) rolls back with it.
// Each handle keeps a stack of frames { name, callbacks }: frame 0 is the outer transaction, later ones are savepoints (sp<depth>).
// tx.onCommit(cb) queues cb on the top frame. A nested success hands its callbacks to the parent, a nested failure drops them,
// and the outermost COMMIT runs them in order. Callback errors are logged, never thrown.
const frames = new WeakMap();

const runCallback = (cb) => { try { cb(); } catch (e) { console.error('[onCommit]', e); } };

export function withTxn(db, fn) {
  let stack = frames.get(db);
  if (!stack) frames.set(db, stack = []);
  const nested = db.isTransaction;
  const frame = { name: nested ? `sp${stack.length}` : null, callbacks: [], done: false };
  const tx = {
    onCommit(cb) {
      if (frame.done) throw new Error('onCommit called outside its transaction');
      stack.at(-1).callbacks.push(cb);
    },
  };
  db.exec(nested ? `SAVEPOINT ${frame.name}` : 'BEGIN IMMEDIATE');
  stack.push(frame);
  let result;
  try {
    result = fn(tx);
    if (result instanceof Promise) throw new Error('withTxn callback must be synchronous');
    db.exec(nested ? `RELEASE ${frame.name}` : 'COMMIT');
  } catch (e) {
    stack.pop();
    frame.done = true;
    try { db.exec(nested ? `ROLLBACK TO ${frame.name}; RELEASE ${frame.name}` : 'ROLLBACK'); }
    catch (rb) { console.error('[withTxn] rollback failed', rb); }   // keep the original error, which says what went wrong
    throw e;
  }
  stack.pop();
  frame.done = true;
  const parent = nested && stack.at(-1);
  if (parent) parent.callbacks.push(...frame.callbacks);
  else frame.callbacks.forEach(runCallback);
  return result;
}

// For code that does not own the transaction (ledger.post inside someone else's withTxn): run cb after the outermost commit,
// or right now when no transaction is open.
export function afterCommit(db, cb) {
  const top = db.isTransaction ? frames.get(db)?.at(-1) : null;
  if (top) top.callbacks.push(cb);
  else runCallback(cb);
}

// items: [{ id, sql }]. Applied in order, each once, recorded in schema_migrations with a sha256 of the sql. Safe to run on every start.
// The "already applied?" check runs inside the same BEGIN IMMEDIATE as the apply, so two booters on one database cannot both apply.
// A changed checksum on an applied id only warns (NULL = recorded before checksums existed); it never fails boot.
export function migrate(db, items, now = wall.now) {
  withTxn(db, () => {
    db.exec('CREATE TABLE IF NOT EXISTS schema_migrations (id TEXT PRIMARY KEY, applied INTEGER NOT NULL, checksum TEXT)');
    if (!db.prepare('PRAGMA table_info(schema_migrations)').all().some((c) => c.name === 'checksum')) db.exec('ALTER TABLE schema_migrations ADD COLUMN checksum TEXT');
  });
  for (const m of items) {
    const checksum = crypto.createHash('sha256').update(m.sql).digest('hex');
    withTxn(db, () => {
      const row = db.prepare('SELECT checksum FROM schema_migrations WHERE id = ?').get(m.id);
      if (row) {
        if (row.checksum && row.checksum !== checksum) console.warn(`migration ${m.id} changed since it was applied (checksum differs)`);
        return;
      }
      db.exec(m.sql);
      db.prepare('INSERT INTO schema_migrations (id, applied, checksum) VALUES (?, ?, ?)').run(m.id, now(), checksum);
    });
  }
}

export function coreMigrations(dir) {
  return fs.readdirSync(dir).filter((f) => /^\d+_.*\.sql$/.test(f)).sort()
    .map((f) => ({ id: `core/${f}`, sql: fs.readFileSync(path.join(dir, f), 'utf8') }));
}

export function logAudit(db, actor, action, detail = {}) {
  db.prepare('INSERT INTO audit_log (at, actor, action, detail) VALUES (?, ?, ?, ?)').run((clocks.get(db) ?? wall).now(), actor, action, JSON.stringify(detail));
}
