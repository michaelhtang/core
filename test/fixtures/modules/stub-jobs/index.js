// Contract fixture: a "jobs" module written only against the kernel facade. Pays a fixed payday every world month to the students of
// the classes whose course enables it, has a building (door), a teacher panel, one route per access level and a transfer of its own kind.
import { defineModule } from '../../../../lib/modules.js';

export const PAY = 1000;

export default defineModule({
  id: 'stub-jobs',
  requires: ['bank-basic'],

  migrations: [{ id: '001_log', sql: `
CREATE TABLE stubjobs_ticks (month INTEGER NOT NULL, from_month INTEGER NOT NULL, class_id INTEGER NOT NULL, students INTEGER NOT NULL);
CREATE TABLE stubjobs_enabled (class_id INTEGER PRIMARY KEY, at INTEGER NOT NULL)` }],

  panels: [{ id: 'jobs', building: { key: 'job', name: 'Job Centre', icon: 'job' }, src: 'jobs.js' }],
  teacherPanels: [{ id: 'jobs-teach', title: 'Jobs', src: 'teach.js' }],

  routes: [
    { method: 'GET', path: '/offers', access: 'student', handler: () => ({ offers: [{ title: 'Barista', cents: PAY }] }) },
    { method: 'GET', path: '/admin', access: 'teacher', handler: () => ({ ok: true }) },
    { method: 'GET', path: '/whoami', access: 'any', handler: (k, { user }) => ({ user }) },
    { method: 'GET', path: '/ping', access: 'public', handler: () => ({ ok: true }) },
    {
      // Student to classmate, kind 'gift' (stored stub-jobs.gift): must not count toward the bank's transfer cap.
      method: 'POST', path: '/gift', access: 'student',
      handler(k, { user, body }) {
        const to = k.players.inClass(user.class_id).find((p) => p.username === k.input.str(body, 'to', { max: 64 }));
        if (!to) throw new k.HttpError(404, 'No such classmate');
        const txn = k.ledger.transfer({
          kind: 'gift', actor: `player:${user.id}`, cents: k.input.int(body, 'cents', { min: 1, max: 1e6 }),
          from: k.ledger.accountId('player', user.id, 'chequing'), to: k.ledger.accountId('player', to.id, 'chequing'),
        });
        return { txn };
      },
    },
  ],

  onEnable(k, { classIds }) {
    const ins = k.db.prepare('INSERT INTO stubjobs_enabled (class_id, at) VALUES (?, ?)');   // twice for one class would be a primary key error
    for (const id of classIds) ins.run(id, k.clock.now());
  },

  onTick(k, { month, from, classes }) {
    for (const c of classes) {
      k.db.prepare('INSERT INTO stubjobs_ticks (month, from_month, class_id, students) VALUES (?, ?, ?, ?)').run(month, from, c.id, c.studentIds.length);
      for (const id of c.studentIds) {
        const to = k.ledger.accountId('player', id, 'chequing');
        if (to) k.ledger.transfer({ kind: 'payday', from: k.ledger.system('mint'), to, cents: PAY, memo: 'Payday' });
      }
    }
  },
});
