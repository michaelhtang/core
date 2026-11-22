// vDAA server. Zero dependencies: node:http + node:sqlite. Run with `node server.js` (PORT, DATA_DIR).
// Serves public/, a JSON API under /api/, and Server-Sent Events at /api/stream.
// This file starts the server and dispatches each request. Its parts live in lib/: http.js (request helpers and cookies), streams.js
// (Server-Sent Events), routes.js (the core API routes) and static.js (static files).
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp, ROOT } from './lib/app.js';
import { HttpError } from './lib/errors.js';
import { createThrottle } from './lib/throttle.js';
import { readBody, isHttps, cookieOf, legacyUntil, sameOrigin, send } from './lib/http.js';
import { createStreams, subscribe } from './lib/streams.js';
import { withModules, STREAM, SEASON_CLOSED } from './lib/routes.js';
import { createPreview } from './lib/preview.js';
import { VDAA_DEV, buildStatic, serveStatic } from './lib/static.js';

export { createStreams } from './lib/streams.js';

const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'same-origin',
  'X-Frame-Options': 'DENY',
  // Everything (fonts included) is served from this origin; no third party is ever contacted.
  'Content-Security-Policy': "default-src 'self'; img-src 'self' data:; base-uri 'none'; form-action 'self'; frame-ancestors 'none'",
};

// ---------- start ----------
export async function start({ port = 3020, host = '127.0.0.1', dataDir, config, modulesDir = path.join(ROOT, 'modules'), limits, clock, openSetup = VDAA_DEV, trustedProxies = (process.env.TRUSTED_PROXIES || '127.0.0.1,::1').split(',') } = {}) {
  const app = await createApp({ dataDir, config, modulesDir, clock });
  const state = {
    modulesDir,
    openSetup,                                                                       // /api/setup without a VDAA_SETUP_TOKEN (dev, tests, demo)
    static: buildStatic(modulesDir),
    streams: createStreams(),
    trusted: new Set(trustedProxies.map((a) => a.trim().replace(/^::ffff:/, ''))),
    throttle: createThrottle({ now: app.clock.now, ...limits }),
    legacyUntil: legacyUntil(app),
  };
  state.version = state.static.version;
  const unsubscribe = subscribe(app, state.streams);
  // Module routes are added by withModules (lib/routes.js). "View as student" (lib/preview.js) has a sandbox app of its own and four routes.
  const preview = createPreview({ app, state, dataDir, modulesDir, limits });
  const routes = [...withModules(app), ...preview.routes];

  const server = http.createServer(async (req, res) => {
    for (const [k, v] of Object.entries(SECURITY_HEADERS)) res.setHeader(k, v);
    req.fromProxy = state.trusted.has(String(req.socket.remoteAddress).replace(/^::ffff:/, ''));
    if (isHttps(req)) res.setHeader('Strict-Transport-Security', 'max-age=31536000');
    req.acceptLegacy = app.clock.now() < state.legacyUntil;
    const url = new URL(req.url, 'http://localhost');
    if (!url.pathname.startsWith('/api/')) return serveStatic(req, res, url, state, app);
    try {
      if (req.method === 'POST' && !sameOrigin(req)) throw new HttpError(403, 'Cross-origin request blocked');
      for (const r of routes) {
        const m = r.method === req.method && r.re.exec(url.pathname);
        if (!m) continue;
        const t = cookieOf(req, 'sid');
        const user = (t && app.players.sessionUser(t)) || null;   // also refreshes the idle clock (lib/players.js)
        // A teacher with a preview session runs student routes on the sandbox instead (lib/preview.js): its app, state, user and route.
        const sb = await preview.divert(req, r, user);
        const A = sb?.app ?? app, S = sb?.state ?? state, U = sb?.user ?? user, R = sb?.route ?? r;
        if (!R.public && !U) throw new HttpError(401, 'Please log in');
        if (R.role && U.role !== R.role) throw new HttpError(403, r.role === 'teacher' ? 'Teachers only' : 'Students only');
        if (R.module && !R.public && U?.role === 'student' && !A.modules.enabledFor(U.course_id).includes(R.module)) throw new HttpError(404, 'Not found');
        const body = req.method === 'POST' ? await readBody(req) : {};
        // Between seasons a student can look but not act: every student POST except core login/logout/setup/join (docs/teachers-seasons.md).
        // Checked after the last await, so the (synchronous) handler runs in the world this saw.
        if (req.method === 'POST' && U?.role === 'student' && (R.module || !R.public) && A.world.current()?.status !== 'active') throw new HttpError(409, SEASON_CLOSED);
        const params = Object.fromEntries(r.names.map((n, i) => [n, m[i + 1]]));
        const out = await R.handler({ app: A, state: S, user: U, body, params, url, req, res });
        if (out === STREAM) return;
        if (req.pvClear) res.appendHeader('Set-Cookie', req.pvClear);
        return send(req, res, 200, out);
      }
      throw new HttpError(404, 'Not found');
    } catch (e) {
      if (!(e instanceof HttpError)) console.error(e);
      send(req, res, e.status || 500, { error: e instanceof HttpError ? e.message : 'Server error' });
    }
  });

  // Timer bodies catch and log: an interval callback that throws would otherwise be an uncaught exception and kill the process.
  const safe = (name, fn) => () => { try { fn(); } catch (e) { console.error(`timer ${name} failed`, e); } };
  const ticks = {
    purgeSessions: safe('purgeSessions', () => app.players.purgeSessions()),
    ping: safe('ping', () => state.streams.send([...state.streams.all()], 'ping')),                          // keeps proxies from closing idle streams
    sweep: safe('sweep', () => state.throttle.sweep()),                             // drop stale throttle entries
    autoAdvance: safe('autoAdvance', () => app.world.autoAdvance()),                // school-day auto-advance, if the teacher turned it on
    nightlyAudit: safe('nightlyAudit', () => app.audits.nightly()),                 // one stored ledger audit per local day, after 02:00
  };
  const timers = [setInterval(ticks.purgeSessions, 3600e3), setInterval(ticks.ping, 25e3), setInterval(ticks.sweep, 60e3), setInterval(ticks.autoAdvance, 5 * 60e3), setInterval(ticks.nightlyAudit, 10 * 60e3)];
  timers.forEach((t) => t.unref());
  ticks.purgeSessions();

  await new Promise((resolve) => server.listen(port, host, resolve));
  return {
    app, server, ticks, port: server.address().port,
    routes: routes.map(({ method, pattern, module }) => ({ method, pattern, module })),   // the live route table (the fuzz test reads it)
    close() {
      app.events.emit('app.closing', {});                                            // modules with their own timers stop them (docs/modules.md)
      timers.forEach(clearInterval);
      unsubscribe();
      for (const c of [...state.streams.all()]) state.streams.drop(c);
      server.closeAllConnections();
      return new Promise((resolve) => server.close(() => preview.close().then(() => { app.db.close(); resolve(); })));
    },
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  // Log, then die: a process in an unknown state must not keep serving. systemd restarts it cleanly.
  for (const ev of ['uncaughtException', 'unhandledRejection']) process.on(ev, (e) => { console.error(ev, e); process.exit(1); });
  const s = await start({ port: Number(process.env.PORT || 3020), dataDir: process.env.DATA_DIR || path.join(ROOT, 'data') });
  console.log(`vDAA listening on http://127.0.0.1:${s.port}`);
  for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => s.close().then(() => process.exit(0)));
}
