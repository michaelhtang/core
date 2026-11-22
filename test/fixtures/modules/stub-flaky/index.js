// Failure-isolation fixture (test/advance-failures.test.js): per-player tick work that throws for one chosen student, a module-wide throw,
// and a listener that throws inside the tick's transaction. The test flips `control` between advances.
import { defineModule } from '../../../../lib/modules.js';

export const control = { bad: null, wide: false, listenerThrows: false, beforeListen: null };   // beforeListen(): run inside the listener first (a test hook)

export default defineModule({
  id: 'stub-flaky',
  requires: ['bank-basic'],
  migrations: [{ id: '001_rows', sql: `
CREATE TABLE flaky_rows (player_id INTEGER, month INTEGER NOT NULL, step TEXT NOT NULL);
CREATE TABLE flaky_heard (player_id INTEGER, month INTEGER NOT NULL)` }],

  events: {
    'module.stub-flaky.ping'(k, { playerId, month }) {
      control.beforeListen?.();
      k.db.prepare('INSERT INTO flaky_heard (player_id, month) VALUES (?, ?)').run(playerId, month);
      if (control.listenerThrows) throw new Error('listener broke');
    },
  },

  onTick(k, { month, classes }) {
    if (control.wide) throw new Error('module-wide failure');
    const ids = classes.flatMap((c) => c.studentIds);
    const row = k.db.prepare('INSERT INTO flaky_rows (player_id, month, step) VALUES (?, ?, ?)');
    k.forEachPlayer(ids, (id) => {
      row.run(id, month, 'tip');
      k.ledger.post({ kind: 'tip', legs: [{ account: k.ledger.system('mint'), cents: -100 }, { account: k.ledger.accountId('player', id, 'chequing'), cents: 100 }] });
      if (id === control.bad) throw new Error(`bad data for player ${id}`);
    });
    row.run(null, month, 'before-ping');
    k.events.emit('ping', { playerId: ids[0], month });     // inside the tick: the listener runs in its own savepoint
    row.run(null, month, 'after-ping');
  },
});
