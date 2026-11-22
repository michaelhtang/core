// "View as student" (lib/preview.js): a teacher sees a course's student view from a sandbox database, and nothing reaches the real one.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { boot, seeded } from './helpers.js';

// Row count of every table of the real database (sqlite internals left out). No table is excluded: a preview must change none of them.
const counts = (db) => Object.fromEntries(db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all()
  .map(({ name }) => [name, db.prepare(`SELECT COUNT(*) AS n FROM "${name}"`).get().n]));

test('a teacher previews each course; the real database does not change; teacher routes, exit, students, reset', async () => {
  const srv = await boot();
  try {
    const { teacher, students: [real] } = await seeded(srv, 1);
    const me = async (c) => (await c.get('/api/me')).json;
    const pvCookie = () => teacher.cookie().split('; ').find((c) => c.startsWith('pv='));
    assert.equal((await me(teacher)).preview, undefined, 'no preview flag on the real app');
    assert.deepEqual((await teacher.get('/api/preview')).json.courses.map((c) => c.id), ['fintech10', 'fintech2030']);
    assert.equal((await teacher.get('/api/preview')).json.active, null);

    // Both courses: the sandbox student's class is that course, and the flag says so.
    const ids = {};
    for (const [course, title] of [['fintech10', 'FinTech 10'], ['fintech2030', 'FinTech 20/30']]) {
      assert.equal((await teacher.post('/api/preview/start', { course })).status, 200);
      const m = await me(teacher);
      assert.equal(m.user.role, 'student');
      assert.equal(m.user.class.course_id, course);
      assert.deepEqual(m.preview, { course_id: course, title });
      assert.ok(m.user.id >= 1_000_000_000, 'sandbox ids start far above real ones');
      assert.ok(m.accounts.find((a) => a.kind === 'chequing').balance_cents > 0, 'funded like a new student');
      ids[course] = m.user.id;
      assert.equal((await teacher.get('/api/preview')).json.active, course);
    }
    assert.notEqual(ids.fintech10, ids.fintech2030);

    // A student action that moves money in the sandbox works, and the real database is untouched.
    await teacher.post('/api/preview/start', { course: 'fintech10' });
    const before = counts(srv.app.db);
    const hisaBefore = (await teacher.get('/api/savings/status')).json.hisa_cents;
    { const r = await teacher.post('/api/savings/move', { direction: 'to_hisa', cents: 20000 }); assert.equal(r.status, 200, JSON.stringify(r.json)); }
    assert.equal((await teacher.get('/api/savings/status')).json.hisa_cents, hisaBefore + 20000);
    assert.equal((await teacher.get('/api/learn/state')).status, 200);
    assert.deepEqual(counts(srv.app.db), before, 'every real table has the same row count');
    assert.equal(srv.app.db.prepare("SELECT COUNT(*) AS n FROM players WHERE id >= 1000000000").get().n, 0, 'no sandbox player in the real database');

    // Teacher-only routes still answer as the teacher while pv is set.
    assert.equal((await teacher.get('/api/learn/teach')).status, 200);
    assert.equal((await teacher.get('/api/teach/state')).json.classes.length, 1);

    // Reset gives a different student, then exit clears it.
    const old = (await me(teacher)).user.id;
    assert.equal((await teacher.post('/api/preview/reset', { course: 'fintech10' })).status, 200);
    assert.notEqual((await me(teacher)).user.id, old);
    assert.equal((await teacher.post('/api/preview/exit')).status, 200);
    assert.ok(!pvCookie() || pvCookie() === 'pv=', 'pv is cleared');
    const after = await me(teacher);
    assert.equal(after.user.role, 'teacher');
    assert.equal(after.preview, undefined);
    assert.deepEqual(counts(srv.app.db), before);

    // Bad course; a real student cannot start a preview, and a stolen pv does nothing for them.
    assert.equal((await teacher.post('/api/preview/start', { course: 'nope' })).status, 400);
    assert.equal((await real.client.post('/api/preview/start', { course: 'fintech10' })).status, 403);
    await teacher.post('/api/preview/start', { course: 'fintech10' });
    const stolen = pvCookie();
    const own = await real.client.get('/api/me', { cookie: `${real.client.cookie()}; ${stolen}` });
    assert.equal(own.json.user.id, real.id);
    assert.equal(own.json.preview, undefined);
    assert.match(own.headers.getSetCookie().join(';'), /pv=;/, 'the stolen cookie is cleared');

    // Logging out while previewing ends the sandbox session too.
    const token = stolen.slice(3);
    assert.equal((await teacher.post('/api/logout')).status, 200);
    const again = await srv.client().get('/api/me', { cookie: `pv=${token}` });
    assert.equal(again.json.user, null);
  } finally { await srv.cleanup(); }
});
