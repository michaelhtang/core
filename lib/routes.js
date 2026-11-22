// The core API routes (everything under /api/ that is not a module's): me, setup, login, logout, the stream, statements and the
// teacher console. Loading this file fills `core`; server.js adds the modules' routes after it.
import crypto from 'node:crypto';
import { sha, MAX_BATCH } from './players.js';
import { HttpError } from './errors.js';
import { logAudit } from './db.js';
import { str, int, idParam } from './input.js';
import { readLog } from './audit-log.js';
import { SESSION_DAYS, clientIp, isHttps, cookieOf, clearCookies, deviceCookie, sessionCookie, sleep } from './http.js';

export const STREAM = Symbol('stream'); // a handler returns this after taking over the response

// ---------- routes ----------
export function compile(method, pattern, handler, opts = {}) {
  const names = [];
  const re = new RegExp(`^${pattern.replace(/:(\w+)/g, (_, n) => { names.push(n); return '([^/]+)'; })}$`);
  return { method, pattern, re, names, handler, ...opts };
}
export const core = [];
// Core routes plus this app's module routes (access picks the check: student/teacher = that role, any = logged in, public = nobody needed;
// a module's handler only sees { user, body, params, url } with a sanitized user). Used for the real app and the preview sandbox alike.
const plain = (u) => u && { id: u.id, username: u.username, role: u.role, class_id: u.class_id, world_teacher: u.world_teacher };
export const withModules = (app) => [...core, ...app.modules.routes().map((r) => compile(r.method, r.fullPath,
  ({ user, body, params, url }) => r.handler({ user: plain(user), body, params, url }),
  { role: r.access === 'student' || r.access === 'teacher' ? r.access : undefined, public: r.access === 'public', module: r.module }))];
const route = (method, pattern, handler, opts) => core.push(compile(method, pattern, handler, opts));
const TEACHER = { role: 'teacher' };

// A student's first sight of an active world: POST /api/login, or /api/me on a session that outlived the last season. The onLogin
// hooks (each idempotent per world) run, then seen_world_id records it so /api/me does not run them again. A hook that threw leaves it
// unset, so the next /api/me tries again.
export function enterWorld(app, player, course) {
  const w = app.world.current();
  if (w?.status !== 'active') return;
  if (app.modules.onLogin(player, course)) app.db.prepare('UPDATE players SET seen_world_id = ? WHERE id = ?').run(w.id, player.id);
}
export const SEASON_CLOSED = 'The season is closed. Your teacher will start the next one soon.';

const worldView = (w) => w && { name: w.name, month: w.month, months_per_day: w.months_per_day, season_start: w.season_start, season_end: w.season_end, auto_advance: w.auto_advance, status: w.status };
// The teacher console's copy also carries the no-school days and whether auto-advance has stopped at season_end (docs/clock.md).
const teachWorldView = (app, w) => w && { ...worldView(w), no_school: app.world.noSchool(w), season_over: app.clock.today() >= w.season_end };

route('GET', '/api/me', ({ app, state, user }) => {
  const setup = !app.db.prepare("SELECT 1 FROM players WHERE role = 'teacher'").get();
  const out = { user: null, world: null, needsSetup: setup, setupTokenRequired: setup && !!process.env.VDAA_SETUP_TOKEN };
  if (!user) return out;
  if (state.previewMeta) out.preview = state.previewMeta(user);                     // only the preview sandbox's state has it
  out.user = { id: user.id, username: user.username, role: user.role, class: user.class_id ? { id: user.class_id, name: user.class_name, course_id: user.course_id } : null };
  const w = app.world.current();
  out.world = worldView(w);
  if (user.role === 'student') {
    if (w?.status === 'active' && user.seen_world_id !== w.id) enterWorld(app, user, user.course_id);
    out.homeCards = app.modules.homeCardsFor(user, user.course_id, state.version);   // before the balances: a card may pay a reward (today's errands)
    out.accounts = app.ledger.accountsOf('player', user.id);
    out.panels = app.modules.panelsFor(user.course_id, state.version);
    out.badges = app.modules.badgesFor(user, user.course_id);
  } else {
    out.user.world_teacher = user.world_teacher === 1;
    // Panels of modules enabled for a course this teacher has a class in. The world teacher with no classes yet sees every loaded
    // module's panels, so a fresh install is not empty.
    const courses = app.db.prepare('SELECT DISTINCT c.course_id FROM classes c JOIN class_teachers ct ON ct.class_id = c.id WHERE ct.teacher_id = ? AND c.archived IS NULL').all(user.id).map((r) => r.course_id);
    out.teacherPanels = app.modules.teacherPanels(state.version, user.world_teacher === 1 && !courses.length ? undefined : courses);
  }
  return out;
}, { public: true });

// First-run setup. With no VDAA_SETUP_TOKEN configured the first stranger to arrive would become the world teacher, so setup is
// refused outright unless the server was started open for local use (VDAA_DEV=1, or start({ openSetup: true }) in tests and the demo).
// With a token, guesses are throttled like logins (reserve, before the slow work; the right token gives its slot back) and the
// comparison is constant-time: both sides are hashed to equal-length buffers first, so the length is not leaked either.
const sha256 = (v) => crypto.createHash('sha256').update(String(v)).digest();
route('POST', '/api/setup', async ({ app, state, req, res, body }) => {
  const required = process.env.VDAA_SETUP_TOKEN;
  if (required) {
    const release = state.throttle.reserve(clientIp(req), '', { setup: true });          // its own bucket: 5 wrong tokens a minute per address, no account lock
    if (!crypto.timingSafeEqual(sha256(str(body, 'token', { max: 256 })), sha256(required))) throw new HttpError(403, 'Setup token required');
    release();                                                                         // only wrong tokens stay counted
  } else if (!state.openSetup) {
    throw new HttpError(403, 'Setup is closed: the server has no VDAA_SETUP_TOKEN. Set one in the service environment and restart.');
  }
  const id = await app.players.createTeacher({ username: str(body, 'username', { max: 64 }).trim(), passphrase: str(body, 'passphrase') });
  res.setHeader('Set-Cookie', [sessionCookie(req, app.players.startSession(id, SESSION_DAYS)), deviceCookie(req, app.players.createTrustedDevice(id))]);
  return { ok: true };
}, { public: true });

route('POST', '/api/login', async ({ app, state, req, res, body }) => {
  const username = str(body, 'username', { max: 64 }).trim();
  const secret = str(body, 'secret');
  const found = app.players.byUsername(username);
  const teacher = found?.role === 'teacher';
  const trusted = teacher && app.players.isTrustedDevice(cookieOf(req, 'td'), found.id);   // this browser has signed this teacher in before
  const release = state.throttle.reserve(clientIp(req), username, { teacher, trusted });   // synchronous, before any await
  const p = await app.players.authenticate(username, secret);
  if (!p) {
    await sleep(state.throttle.failed(username));                                  // the same progressive delay for every name (teacher, student, unknown), never a lock
    throw new HttpError(401, 'Wrong username, PIN or passphrase');
  }
  release();
  state.throttle.succeeded(username);
  if (trusted) app.players.touchTrustedDevice(cookieOf(req, 'td'));
  const sid = app.players.startSessionIfUnchanged(p, SESSION_DAYS);               // null if the PIN was reset while we were checking it
  if (!sid) throw new HttpError(401, 'Wrong username, PIN or passphrase');
  const old = cookieOf(req, 'sid');
  if (old) app.players.endSession(old);                                            // logging in over a session ends it (whoever's it was)
  if (p.role === 'student') {                                                      // first login funds the account (idempotent); only for a login that stands
    const course = app.db.prepare('SELECT course_id FROM classes WHERE id = ?').get(p.class_id)?.course_id;
    enterWorld(app, p, course);
  }
  res.setHeader('Set-Cookie', p.role === 'teacher' && !trusted ? [sessionCookie(req, sid), deviceCookie(req, app.players.createTrustedDevice(p.id))] : sessionCookie(req, sid));
  return { ok: true, role: p.role };
}, { public: true });

// Public and idempotent: logging out when the session is already gone (revoked, expired) is not an error; the cookie is cleared either way.
// { forget: true } also forgets this browser as a teacher's trusted device (for a shared computer); a plain logout keeps it.
// { everywhere: true } ends every session of this player (other browsers, a lost phone); trusted devices stay unless forget is set too.
route('POST', '/api/logout', ({ app, req, res, user, body }) => {
  const t = cookieOf(req, 'sid');
  if (body.everywhere === true && user) app.players.endAllSessions(user.id);
  else if (t) app.players.endSession(t);
  const forget = body.forget === true;
  if (forget) app.players.forgetTrustedDevice(cookieOf(req, 'td'));
  res.setHeader('Set-Cookie', forget ? clearCookies(req, 'sid', 'td') : clearCookies(req, 'sid'));
  return { ok: true };
}, { public: true });

route('GET', '/api/stream', ({ req, res, state, user }) => {
  res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', 'X-Accel-Buffering': 'no' });
  const stream = { res, playerId: user.id, role: user.role, tokenHash: sha(req.pvToken ?? cookieOf(req, 'sid')) };   // req.pvToken: the sandbox session of a teacher's preview (lib/preview.js)
  try { res.write('retry: 5000\n\n'); } catch { return STREAM; }
  state.streams.add(stream);
  req.on('close', () => state.streams.drop(stream));
  return STREAM;
});

// A student reads only their own accounts; the teacher reads any.
route('GET', '/api/accounts/:id/statement', ({ app, user, params, url }) => {
  const acct = app.ledger.account(/^\d{1,15}$/.test(params.id) ? Number(params.id) : 0);
  if (user.role === 'student' && !(acct && acct.owner_type === 'player' && acct.owner_id === user.id)) throw new HttpError(403, 'Not your account');
  if (!acct) throw new HttpError(404, 'Account not found');
  // A teacher reads accounts of students in their own classes only; system and business accounts are the world teacher's.
  if (user.role === 'teacher' && !(acct.owner_type === 'player' ? app.policy.can(user, 'player.manage', { playerId: acct.owner_id }) : user.world_teacher === 1)) {
    throw new HttpError(404, 'Account not found');
  }
  const limit = Number(url.searchParams.get('limit')) || 100;
  return { account: { id: acct.id, kind: acct.kind, currency: acct.currency }, balance_cents: acct.balance_cents, entries: app.ledger.statement(acct.id, { limit }) };
});

// ---- teacher console ----
// Teachers see and act on their own classes only (lib/policy.js: 404 for anyone else's). The world teacher alone moves the clock.
route('GET', '/api/teach/state', ({ app, user }) => ({
  world: teachWorldView(app, app.world.current()),
  courses: Object.entries(app.config.courses).map(([id, c]) => ({ id, label: c.label || id })),
  classes: app.players.teacherClasses(user.id),
  ...(user.world_teacher === 1 && { problems: advanceProblems(app) }),
}), TEACHER);

// World teacher only: what recent advances skipped (tick_failures, newest 50 of this season) and why auto-advance stopped, if it did.
function advanceProblems(app) {
  const w = app.world.current();
  if (!w) return { auto_stopped: null, failures: [] };
  return {
    auto_stopped: w.auto_stopped ?? null,
    failures: app.db.prepare(`SELECT f.month, f.module, f.error, f.source, f.created, p.username FROM tick_failures f LEFT JOIN players p ON p.id = f.player_id
      WHERE f.world_id = ? ORDER BY f.id DESC LIMIT 50`).all(w.id),
  };
}

route('POST', '/api/teach/classes', ({ app, user, body }) => app.players.createClass({ name: str(body, 'name', { max: 40 }), course: str(body, 'course', { max: 40 }), actor: `player:${user.id}`, teacherId: user.id }), TEACHER);

route('GET', '/api/teach/classes/:id/students', ({ app, state, user, params }) => {
  const classId = idParam(params.id);
  app.policy.assert(user, 'class.read', { classId });
  return {
    students: app.players.classStudents(classId)
      .map((s) => ({ ...s, active: s.active === 1, locked: state.throttle.status(s.username).locked })),   // active: has logged in (lib/players.js)
  };
}, TEACHER);

route('POST', '/api/teach/players/:id/unlock', ({ app, state, user, params }) => {
  const playerId = idParam(params.id);
  app.policy.assert(user, 'player.manage', { playerId });
  const p = app.players.get(playerId);
  if (!p || p.role !== 'student') throw new HttpError(404, 'Student not found');
  state.throttle.clear(p.username);
  logAudit(app.db, `player:${user.id}`, 'login.unlock', { player: p.id });
  return { ok: true };
}, TEACHER);

// Students with several recent wrong tries (a forgotten PIN, or someone guessing), newest first.
route('GET', '/api/teach/login-trouble', ({ app, state, user }) => ({
  blocked: user.world_teacher === 1 ? state.throttle.blockedAddresses() : [],   // network addresses at the IP ceiling (world teacher only)
  trouble: state.throttle.trouble(3).flatMap((t) => {
    const p = app.players.byUsername(t.username);
    return p && p.role === 'student' && app.policy.can(user, 'player.manage', { playerId: p.id }) ? [{ id: p.id, username: p.username, failures: t.failures, last: t.last, locked: t.locked }] : [];
  }),
}), TEACHER);

// World teacher only: forget one blocked network address (a student or script that filled the school's shared IP budget).
route('POST', '/api/teach/blocked-ips/unblock', ({ app, state, user, body }) => {
  if (user.world_teacher !== 1) throw new HttpError(403, 'Only the world teacher can unblock an address');
  const ip = str(body, 'ip', { max: 64 });
  if (!state.throttle.clearAddress(ip)) throw new HttpError(404, 'That address is not blocked');
  logAudit(app.db, `player:${user.id}`, 'login.unblock-ip', { ip });
  return { ok: true };
}, TEACHER);

route('POST', '/api/teach/classes/:id/students', async ({ app, user, params, body }) => {
  const classId = idParam(params.id);
  app.policy.assert(user, 'class.manage', { classId });
  const cls = app.db.prepare('SELECT name, course_id FROM classes WHERE id = ?').get(classId);
  if (!cls) throw new HttpError(404, 'Class not found');
  const students = await app.players.createStudents({ classId, count: int(body, 'count', { min: 1, max: 60 }), actor: `player:${user.id}` });
  return { className: cls.name, students: students.map(({ username, pin }) => ({ username, pin })) };
}, TEACHER);

// Class management. Every route is class.manage (404 for anyone else's class); nothing is deleted (lib/players.js detach).
// ids: a list of 1 to 200 student ids of this class, duplicates ignored.
const idList = (body) => {
  const v = Object.hasOwn(body, 'ids') ? body.ids : undefined;
  if (!Array.isArray(v) || v.length < 1 || v.length > MAX_BATCH || !v.every(Number.isSafeInteger)) throw new HttpError(400, `ids must be a list of 1 to ${MAX_BATCH} student ids`);
  return [...new Set(v)];
};
const managed = (app, user, params) => { const classId = idParam(params.id); app.policy.assert(user, 'class.manage', { classId }); return classId; };

route('POST', '/api/teach/classes/:id/rename', ({ app, user, params, body }) => {
  const classId = managed(app, user, params);
  return app.players.renameClass({ classId, name: str(body, 'name', { max: 40 }), actor: `player:${user.id}` });
}, TEACHER);

route('POST', '/api/teach/classes/:id/remove-students', ({ app, user, params, body }) => {
  const classId = managed(app, user, params);
  return app.players.removeStudents({ classId, ids: idList(body), actor: `player:${user.id}` });
}, TEACHER);

route('POST', '/api/teach/classes/:id/delete', ({ app, user, params, body }) => {
  const classId = managed(app, user, params);
  return app.players.deleteClass({ classId, confirm: str(body, 'confirm', { max: 40 }), actor: `player:${user.id}` });
}, TEACHER);

// ids omitted: every student of the class.
route('POST', '/api/teach/classes/:id/reset-pins', async ({ app, state, user, params, body }) => {
  const classId = managed(app, user, params);
  const cards = await app.players.resetPins({ classId, ids: Object.hasOwn(body, 'ids') ? idList(body) : undefined, actor: `player:${user.id}` });
  for (const c of cards) state.throttle.clear(c.username);
  return { cards };
}, TEACHER);

route('POST', '/api/teach/players/:id/reset-pin', async ({ app, state, user, params }) => {
  const playerId = idParam(params.id);
  app.policy.assert(user, 'player.manage', { playerId });
  const r = await app.players.resetPin(playerId, `player:${user.id}`);
  state.throttle.clear(r.username);
  const cls = app.db.prepare('SELECT c.name FROM players p JOIN classes c ON c.id = p.class_id WHERE p.id = ?').get(r.id);
  return { className: cls?.name || '', students: [{ username: r.username, pin: r.pin }] };
}, TEACHER);

route('POST', '/api/teach/passphrase', async ({ app, state, req, res, user, body }) => {
  const current = str(body, 'current');
  const next = str(body, 'next');
  app.players.checkPassphrase(next);                                               // 12+ characters, before any slow work
  // Guesses at the current passphrase: always capped per session; a session that is not on a trusted device also shares the login budget.
  const ip = clientIp(req);
  const releaseSession = state.throttle.reserve(ip, sha(cookieOf(req, 'sid')), { session: true });
  let releaseBudget = () => {};
  if (!app.players.isTrustedDevice(cookieOf(req, 'td'), user.id)) {
    try { releaseBudget = state.throttle.reserve(ip, user.username, { teacher: true }); } catch (e) { releaseSession(); throw e; }   // a refused try uses no session slot
  }
  const verified = await app.players.authenticate(user.username, current);
  if (!verified) {
    await sleep(state.throttle.failed(user.username));
    throw new HttpError(401, 'Current passphrase is wrong');
  }
  releaseSession();
  releaseBudget();
  state.throttle.succeeded(user.username);
  await app.players.setPassphrase(user.id, next, `player:${user.id}`, verified);  // also ends every other session and forgets every trusted device; 401 if it changed meanwhile
  state.throttle.passphraseChanged(user.username);
  res.setHeader('Set-Cookie', [sessionCookie(req, app.players.startSession(user.id, SESSION_DAYS)), deviceCookie(req, app.players.createTrustedDevice(user.id))]);   // this browser stays trusted
  return { ok: true };
}, TEACHER);

route('POST', '/api/teach/world/advance', ({ app, user, body }) => {
  app.policy.assert(user, 'world.advance');
  return worldView(app.world.advance({
    months: int(body, 'months', { min: 1, max: 12, optional: true }), from: int(body, 'from', { min: 0, max: 1e9, optional: true }), actor: `player:${user.id}`,
  }));
}, TEACHER);

route('POST', '/api/teach/world/settings', ({ app, user, body }) => {
  app.policy.assert(user, 'world.settings');
  const months_per_day = int(body, 'months_per_day', { min: 1, max: 12, optional: true });
  const { auto_advance, no_school } = body;
  if (months_per_day === undefined && auto_advance === undefined && no_school === undefined) throw new HttpError(400, 'Send months_per_day, auto_advance or no_school');
  return teachWorldView(app, app.world.setSettings({ months_per_day, auto_advance, no_school }, `player:${user.id}`));   // validates auto_advance and no_school
}, TEACHER);

// Season: close it (balances go to zero, net worth is kept), then start the next one. World teacher only.
route('POST', '/api/teach/world/close', ({ app, user }) => {
  app.policy.assert(user, 'world.close');
  return worldView(app.world.close({ actor: `player:${user.id}` }));
}, TEACHER);

const DATE = /^\d{4}-\d{2}-\d{2}$/;
route('POST', '/api/teach/world/create', ({ app, user, body }) => {
  app.policy.assert(user, 'world.close');
  const seasonStart = str(body, 'season_start', { max: 10 });
  const seasonEnd = str(body, 'season_end', { max: 10 });
  if (!DATE.test(seasonStart) || !DATE.test(seasonEnd) || Number.isNaN(Date.parse(seasonStart)) || Number.isNaN(Date.parse(seasonEnd))) throw new HttpError(400, 'Dates look like 2027-02-01');
  if (seasonEnd < seasonStart) throw new HttpError(400, 'The season cannot end before it starts');
  return worldView(app.world.create({ name: str(body, 'name', { max: 60 }).trim() || 'Season', seasonStart, seasonEnd, actor: `player:${user.id}` }));
}, TEACHER);

// A second teacher: the world teacher makes a single-use link (7 days); the new teacher joins from it and owns only their own classes.
route('POST', '/api/teach/invites', ({ app, user, req }) => {
  app.policy.assert(user, 'teacher.invite');
  const host = (req.fromProxy && req.headers['x-forwarded-host']) || req.headers.host;
  const origin = process.env.PUBLIC_ORIGIN || `${isHttps(req) ? 'https' : 'http'}://${host}`;
  return { url: `${origin}/teach?invite=${app.players.createInvite(user.id)}` };
}, TEACHER);

// Public, throttled like login with the token as the key; the slow hash comes after the throttle, and a successful join gives its slot back.
route('POST', '/api/teach/join', async ({ app, state, req, res, body }) => {
  const token = str(body, 'token', { max: 128 }).trim();
  const release = state.throttle.reserve(clientIp(req), `join:${token}`);               // its own key, never shared with setup
  const id = await app.players.joinTeacher({ token, username: str(body, 'username', { max: 64 }).trim(), passphrase: str(body, 'passphrase') });
  release();
  if (cookieOf(req, 'sid')) app.players.endSession(cookieOf(req, 'sid'));          // like login: the session this browser had is over
  res.setHeader('Set-Cookie', [sessionCookie(req, app.players.startSession(id, SESSION_DAYS)), deviceCookie(req, app.players.createTrustedDevice(id))]);
  return { ok: true };
}, { public: true });

// The last stored audit (run once if there is none yet); POST runs a fresh one, at most once per 30 s per process (lib/audit-runs.js).
route('GET', '/api/teach/audit', ({ app, user }) => {
  app.policy.assert(user, 'audit.read');
  return app.audits.latest();
}, TEACHER);

route('POST', '/api/teach/audit/run', ({ app, user }) => {
  app.policy.assert(user, 'audit.read');
  return app.audits.run();
}, TEACHER);

// Activity log: audit_log newest first, 50 a page, ?before=<id> for older. The world teacher reads all of it; others only rows about
// their own classes and students (lib/audit-log.js).
route('GET', '/api/teach/log', ({ app, user, url }) => {
  app.policy.assert(user, 'audit.read');
  const before = url.searchParams.get('before');
  if (before !== null && !/^\d{1,15}$/.test(before)) throw new HttpError(400, 'before must be a log id');
  return readLog(app.db, user, before === null ? {} : { before: Number(before) });
}, TEACHER);
