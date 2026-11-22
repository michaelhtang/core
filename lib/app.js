// Assembles the app: database, ledger, world clock, players, modules. Shared by the server, tests and the simulator.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDb, migrate, coreMigrations, useClock } from './db.js';
import { createClock } from './clock.js';
import { createEvents } from './events.js';
import { createLedger } from './ledger.js';
import { createAuditRuns } from './audit-runs.js';
import { createWorld } from './world.js';
import { createPlayers } from './players.js';
import { createPolicy } from './policy.js';
import { loadModules } from './modules.js';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export async function createApp({ dataDir, config, modulesDir = path.join(ROOT, 'modules'), clock } = {}) {
  config ??= JSON.parse(fs.readFileSync(path.join(ROOT, 'config', 'vdaa.json'), 'utf8'));
  clock ??= createClock({ noSchool: config.calendar?.noSchool });   // tests and the sim pass a fake
  fs.mkdirSync(dataDir, { recursive: true });
  const db = openDb(path.join(dataDir, 'vdaa.db'));
  useClock(db, clock);
  migrate(db, coreMigrations(path.join(ROOT, 'migrations')), clock.now);
  // Owner-only data whatever the umask (the systemd unit sets UMask=0077; this covers other launches). The -wal/-shm files exist once
  // WAL mode has written, and SQLite gives files it creates later the database file's mode.
  fs.chmodSync(dataDir, 0o700);
  for (const f of ['vdaa.db', 'vdaa.db-wal', 'vdaa.db-shm']) if (fs.existsSync(path.join(dataDir, f))) fs.chmodSync(path.join(dataDir, f), 0o600);

  const app = { db, config, clock };
  app.events = createEvents();
  app.ledger = createLedger(db, app.events, clock);
  app.audits = createAuditRuns(app);
  app.world = createWorld(db, app);
  app.policy = createPolicy(db);
  app.players = createPlayers(app);
  app.modules = await loadModules(app, modulesDir);
  return app;
}
