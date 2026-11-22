// A bare app on a hand-set clock for the 6a tests (feed, scenarios): the real config, a world teacher with class 1, a second teacher with class 2,
// students logged in once. Not a test file (the runner only takes *.test.js).
import fs from 'node:fs';
import { createApp } from '../lib/app.js';
import { createClock } from '../lib/clock.js';
import { tmpDir } from './helpers.js';

export const CONFIG = JSON.parse(fs.readFileSync(new URL('../config/vdaa.json', import.meta.url), 'utf8'));
export const PASS = 'another long passphrase';
const made = [];
export const cleanupWorlds = () => { for (const d of made) fs.rmSync(d, { recursive: true, force: true }); };

// n students in class 1 (teacher A, the world teacher); with second: m students in class 2 (teacher B, not the world teacher).
export async function world({ n = 1, second = 0, config = CONFIG, modulesDir } = {}) {
  const dataDir = tmpDir();
  made.push(dataDir);
  let t = Date.parse('2026-11-02T15:00:00Z');
  const app = await createApp({ dataDir, config, clock: createClock({ now: () => t }), ...(modulesDir && { modulesDir }) });
  app.world.create();
  const aId = await app.players.createTeacher({ username: 'teacherA', passphrase: PASS });
  const teacherA = { id: aId, username: 'teacherA', role: 'teacher', world_teacher: 1 };
  const cls = app.players.createClass({ name: 'Block 1', course: 'fintech10', teacherId: aId });
  const make = async (classId, count) => {
    const ids = await app.players.createStudents({ classId, count, hash: false });
    for (const s of ids) app.modules.onLogin({ ...s, class_id: classId }, 'fintech10');
    return ids.map((s) => ({ id: s.id, username: s.username, role: 'student', class_id: classId }));
  };
  const users = await make(cls.id, n);
  let cls2 = null, teacherB = null, users2 = [];
  if (second) {
    const bId = await app.players.joinTeacher({ token: app.players.createInvite(aId), username: 'teacherB', passphrase: PASS });
    teacherB = { id: bId, username: 'teacherB', role: 'teacher', world_teacher: 0 };
    cls2 = app.players.createClass({ name: 'Block 2', course: 'fintech10', teacherId: bId });
    users2 = await make(cls2.id, second);
  }
  const handler = (mod, method, p) => app.modules.routes().find((r) => r.module === mod && r.method === method && r.path === p).handler;
  const get = (mod, p, user, url = 'http://t/') => handler(mod, 'GET', p)({ user, body: {}, params: {}, url: new URL(url) });
  const post = (mod, p, body, user) => handler(mod, 'POST', p)({ user, body, params: {}, url: new URL('http://t/') });
  const advance = (months) => { t += 60_000; return app.world.advance(months === undefined ? {} : { months }); };
  const jumpTo = (month) => app.db.prepare('UPDATE worlds SET month = ? WHERE id = ?').run(month, app.world.current().id);   // skip ahead without ticks
  const k = (id) => app.modules.kernel(id);
  const status = (fn) => { try { fn(); return 200; } catch (e) { return e.status ?? 500; } };
  const feedRows = () => app.db.prepare('SELECT * FROM feed_items ORDER BY id').all();
  return { app, cls, cls2, users, users2, teacherA, teacherB, get, post, advance, jumpTo, k, status, feedRows, close: () => app.db.close() };
}
