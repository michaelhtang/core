// "View as student": a teacher sees what a student of a course sees, without a student existing in the real database. The preview
// runs on a SANDBOX app of its own (data/preview/vdaa.db: own world, own preview teacher, class and student per course, own streams),
// so nothing it does can reach a real student, real money, a league, a leaderboard or a roster (docs/teachers-seasons.md).
// The teacher stays signed in as themselves (cookie sid); a second cookie, pv, holds the sandbox student's session. server.js asks
// divert() for every request: a teacher with a valid pv gets the sandbox's app, state, user and route for any route that is not
// teacher-only. Teacher-only routes always run on the real app.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { createApp } from './app.js';
import { HttpError } from './errors.js';
import { createThrottle } from './throttle.js';
import { createStreams, subscribe } from './streams.js';
import { compile, withModules, enterWorld } from './routes.js';
import { str } from './input.js';
import { SESSION_DAYS, clearCookies, previewCookie, previewCookieOf } from './http.js';

const TEACHER_NAME = 'preview-teacher';
const ID_FLOOR = 1_000_000_000;                                       // sandbox player ids start here, so they can never equal a real id
// Routes that always run on the real app, even for a teacher with a sandbox session: sign-in, sign-out and joining.
const REAL_ONLY = new Set(['/api/login', '/api/setup', '/api/teach/join']);
const diverts = (r) => r.role !== 'teacher' && !REAL_ONLY.has(r.pattern) && r.pattern !== '/api/logout' && (!r.public || r.pattern === '/api/me');

export function createPreview({ app, state, dataDir, modulesDir, limits }) {
  const courses = Object.entries(app.config.courses).map(([id, c]) => ({ id, title: c.label || id }));
  const titleOf = (id) => courses.find((c) => c.id === id)?.title ?? id;
  const className = (id) => `Preview – ${titleOf(id)}`;
  const dir = dataDir && path.join(dataDir, 'preview');
  let building = null;                                                // the promise of the one sandbox, once made

  async function build() {
    const sapp = await createApp({ dataDir: dir, config: app.config, modulesDir, clock: app.clock });
    const sstate = {
      modulesDir, openSetup: false, static: state.static, version: state.version, trusted: state.trusted, legacyUntil: state.legacyUntil,
      streams: createStreams(), throttle: createThrottle({ now: app.clock.now, ...limits }),
      previewMeta: (u) => (u?.role === 'student' ? { course_id: u.course_id, title: titleOf(u.course_id) } : undefined),
    };
    const unsubscribe = subscribe(sapp, sstate.streams);
    const sb = { app: sapp, state: sstate, routes: withModules(sapp), unsubscribe };
    await setup(sb);                                                  // no server timers: nothing ticks, advances or audits in the sandbox (a module's own, like walk's presence, stops on app.closing)
    return sb;
  }
  // Idempotent: whatever is missing is made. Ids first: a placeholder row at ID_FLOOR makes every later player id larger (players
  // is INTEGER PRIMARY KEY, so the next id is the largest + 1). It is a student with no class, which no list ever shows.
  async function setup({ app: a }) {
    if (!a.db.prepare('SELECT 1 FROM players WHERE id >= ?').get(ID_FLOOR)) {
      a.db.prepare("INSERT INTO players (id, username, pin_hash, role, created) VALUES (?, 'preview-anchor', '!', 'student', ?)").run(ID_FLOOR, a.clock.now());
    }
    if (!a.players.byUsername(TEACHER_NAME)) await a.players.createTeacher({ username: TEACHER_NAME, passphrase: crypto.randomBytes(24).toString('hex') });   // never shown or stored
    if (!a.world.current()) a.world.create();
    const teacherId = a.players.byUsername(TEACHER_NAME).id;
    for (const { id } of courses) {
      if (!classOf(a, id)) a.players.createClass({ name: className(id), course: id, teacherId, actor: 'system' });
    }
  }
  const classOf = (a, course) => a.db.prepare('SELECT id FROM classes WHERE course_id = ? AND name = ? AND archived IS NULL').get(course, className(course))?.id;
  const latest = (a, classId) => a.db.prepare("SELECT id, username, class_id FROM players WHERE class_id = ? AND role = 'student' ORDER BY id DESC LIMIT 1").get(classId);

  // create: make the sandbox if it does not exist. Without it, an app that never previewed anything gets no preview folder at all.
  async function ensure(create) {
    if (!dir) throw new HttpError(503, 'Preview is not available here');
    if (!building) {
      if (!create && !fs.existsSync(path.join(dir, 'vdaa.db'))) return null;
      building = build().catch((e) => { building = null; throw e; });
    }
    return building;
  }
  const newStudent = async (a, course) => (await a.players.createStudents({ classId: classOf(a, course), count: 1, hash: false, actor: 'system' }))[0];   // hash: false = can never log in

  async function open(req, res, sb, course, student) {
    const a = sb.app, old = previewCookieOf(req);
    if (old) a.players.endSession(old);                               // only this browser's old preview: two teachers on one course keep their own sessions
    enterWorld(a, student, course);                                   // the first-login funding, exactly as a new student's login does
    res.setHeader('Set-Cookie', previewCookie(req, a.players.startSession(student.id, SESSION_DAYS)));
    return { ok: true, course };
  }
  const courseOf = (body) => {
    const c = str(body, 'course', { max: 40 });
    if (!courses.some((x) => x.id === c)) throw new HttpError(400, 'Unknown course');
    return c;
  };

  const route = (m, p, fn) => compile(m, p, fn, { role: 'teacher' });
  const routes = [
    route('GET', '/api/preview', async ({ req }) => {
      const sb = await ensure(false), t = previewCookieOf(req);
      const u = sb && t ? sb.app.players.sessionUser(t) : null;
      return { courses, active: u?.role === 'student' ? u.course_id : null };
    }),
    route('POST', '/api/preview/start', async ({ req, res, body }) => {
      const course = courseOf(body), sb = await ensure(true);
      return open(req, res, sb, course, latest(sb.app, classOf(sb.app, course)) ?? await newStudent(sb.app, course));
    }),
    route('POST', '/api/preview/reset', async ({ req, res, body }) => {       // "Start over": a new student; the old one just stays unused in the sandbox
      const course = courseOf(body), sb = await ensure(true);
      return open(req, res, sb, course, await newStudent(sb.app, course));
    }),
    route('POST', '/api/preview/exit', async ({ req, res }) => {
      const t = previewCookieOf(req), sb = t && await ensure(false);
      if (sb) sb.app.players.endSession(t);
      res.setHeader('Set-Cookie', clearCookies(req, 'pv'));
      return { ok: true };
    }),
  ];

  return {
    routes,
    // For one request, after the real route r matched and the real user is known. Returns null (run as usual) or the sandbox's
    // { app, state, user, route }. Sets req.pvClear (Set-Cookie lines for server.js to add) when the pv cookie must go.
    async divert(req, r, user) {
      const token = previewCookieOf(req);
      if (!token) return null;
      const clear = () => { req.pvClear = clearCookies(req, 'pv'); };
      if (user?.role !== 'teacher') return clear(), null;               // a student, or nobody, never reaches the sandbox: a stolen pv is dropped
      if (r.pattern === '/api/logout') {
        clear();
        (await ensure(false))?.app.players.endSession(token);
        return null;
      }
      if (!diverts(r)) return null;
      const sb = await ensure(false), su = sb?.app.players.sessionUser(token);
      if (su?.role !== 'student') return clear(), null;
      const route = sb.routes.find((x) => x.method === r.method && x.pattern === r.pattern);
      if (!route) return null;
      req.pvToken = token;
      return { app: sb.app, state: sb.state, user: su, route };
    },
    async close() {
      const sb = building && await building.catch(() => null);
      if (!sb) return;
      sb.app.events.emit('app.closing', {});
      sb.unsubscribe();
      for (const c of [...sb.state.streams.all()]) sb.state.streams.drop(c);
      sb.app.db.close();
    },
  };
}
