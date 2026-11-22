// HTTP request helpers for server.js and lib/routes.js: reading a JSON body, our two cookies (session and trusted device), the client
// address behind the proxy, the same-origin check for POSTs, and sending a JSON reply.
import net from 'node:net';
import zlib from 'node:zlib';
import { DEVICE_DAYS } from './players.js';
import { HttpError } from './errors.js';

export const SESSION_DAYS = 14;

// ---------- http helpers ----------
const BODY_LIMIT = 1e5;
export function readBody(req) {
  return new Promise((resolve, reject) => {
    if (Number(req.headers['content-length']) > BODY_LIMIT) return reject(new HttpError(413, 'Body too large'));
    const chunks = [];
    let size = 0;
    req.on('data', (c) => { size += c.length; chunks.push(c); if (size > BODY_LIMIT) { reject(new HttpError(413, 'Body too large')); req.destroy(); } });
    req.on('end', () => {
      try {
        const data = Buffer.concat(chunks).toString('utf8');
        const v = data ? JSON.parse(data) : {};
        if (v === null || typeof v !== 'object' || Array.isArray(v)) throw new Error('not an object');
        resolve(v);
      } catch { reject(new HttpError(400, 'Body must be a JSON object')); }
    });
  });
}
// Parsed once per request. A value that does not decode is skipped, never an error: the browser also sends cookies set by sibling
// *.michaelhtang.com apps, and only ours (sid, td) matter here. Names are compared raw, never decoded: the browser applies the __Host-
// rules to the literal name, so a sibling's %5F%5FHost-sid (Domain=.michaelhtang.com) must not count as our __Host-sid. A name sent
// more than once (our host cookie plus a sibling's Domain cookie of the same name) is ambiguous, so it counts as absent: no session
// from it, rather than whichever came last.
function cookies(req) {
  if (req.jar) return req.jar;
  const out = Object.create(null);
  const twice = new Set(), seen = new Set();
  for (const part of (req.headers.cookie || '').split(';')) {
    const i = part.indexOf('=');
    if (i < 1) continue;
    const name = part.slice(0, i).replace(/^[ \t]+|[ \t]+$/g, '');   // only space and tab: String#trim would also strip NBSP (U+00A0)
    if (!/^[!#-+\--:<-[\]-~]+$/.test(name)) continue;                    // a cookie name is printable ASCII with no separators; anything else is not ours
    if (seen.has(name)) { twice.add(name); delete out[name]; continue; }   // sent twice (even if a copy didn't decode): neither counts
    seen.add(name);
    if (twice.has(name)) continue;
    try { out[name] = decodeURIComponent(part.slice(i + 1).replace(/^[ \t]+|[ \t]+$/g, '')); } catch { /* not ours */ }
  }
  return (req.jar = out);
}

// req.fromProxy is set per request: true only when the socket peer is a trusted proxy (the local nginx, by default).
// Forwarded headers (Cloudflare's CF-Connecting-IP, X-Forwarded-*) are believed only then; otherwise the socket address is used.
export function clientIp(req) {
  if (req.fromProxy) {
    const cf = String(req.headers['cf-connecting-ip'] || '').trim();
    if (net.isIP(cf)) return cf.toLowerCase();
    const xff = String(req.headers['x-forwarded-for'] || '').split(',').map((x) => x.trim()).filter((x) => net.isIP(x));
    if (xff.length) return xff[xff.length - 1].toLowerCase();
  }
  return req.socket.remoteAddress;
}
export const isHttps = (req) => req.fromProxy && req.headers['x-forwarded-proto'] === 'https';
const cookieFlags = (req) => `HttpOnly; SameSite=Lax; Path=/${isHttps(req) ? '; Secure' : ''}`;
// Our two cookies: the session (sid) and a teacher's long-lived "trusted device" (td, see lib/throttle.js). Over https they are named
// __Host-sid / __Host-td, which the browser accepts only with Secure, Path=/ and no Domain, so a sibling *.michaelhtang.com app can
// neither set nor shadow them. Over http (local dev, tests) the plain names. Migration: over https a legacy plain cookie is still read
// when its __Host- twin is absent, and send() moves it to the new name (same value) and clears the old one. Only until a cutoff
// (req.acceptLegacy, see legacyUntil()): a sibling's Domain=.michaelhtang.com `sid` cannot be cleared by us, so after the cutoff the plain
// names are ignored over https for good.
const MAX_AGE = { sid: SESSION_DAYS * 86400, td: DEVICE_DAYS * 86400, pv: SESSION_DAYS * 86400 };   // pv: a teacher's preview-as-student session (lib/preview.js)
const nameOf = (req, base) => (isHttps(req) ? `__Host-${base}` : base);
export function cookieOf(req, base) {
  const jar = cookies(req);
  if (jar[nameOf(req, base)] || !isHttps(req) || !req.acceptLegacy || !/^[0-9a-f]{64}$/.test(jar[base] ?? '')) return jar[nameOf(req, base)];   // ours are 64 hex characters
  (req.legacy ??= new Set()).add(base);
  return jar[base];
}
const setCookie = (req, base, value, maxAge = MAX_AGE[base]) => `${nameOf(req, base)}=${value}; Max-Age=${maxAge}; ${cookieFlags(req)}`;
export const clearCookies = (req, ...bases) => bases.flatMap((b) => [setCookie(req, b, '', 0), ...(isHttps(req) ? [`${b}=; Max-Age=0; ${cookieFlags(req)}`] : [])]);
export const deviceCookie = (req, token) => setCookie(req, 'td', token);
export const sessionCookie = (req, sid) => setCookie(req, 'sid', sid);
export const previewCookie = (req, token) => setCookie(req, 'pv', token);
export const previewCookieOf = (req) => cookies(req)[nameOf(req, 'pv')];   // no legacy plain-name fallback: pv is new, it never had one
// Until when legacy plain cookies are read over https: VDAA_LEGACY_COOKIES_UNTIL (a date), else 14 days (one whole session lifetime)
// after the first boot that ran migration 012 (the rename shipped with it; schema_migrations.applied is that boot's time).
export function legacyUntil(app) {
  if (process.env.VDAA_LEGACY_COOKIES_UNTIL) return Date.parse(process.env.VDAA_LEGACY_COOKIES_UNTIL) || 0;
  const applied = app.db.prepare("SELECT applied FROM schema_migrations WHERE id = 'core/012_session_last_seen.sql'").get()?.applied ?? 0;
  return applied + SESSION_DAYS * 864e5;
}
// The legacy cookies this request was read with, moved to their __Host- names, unless the handler already set (or cleared) that name.
function moveLegacy(req, res) {
  const set = [].concat(res.getHeader('Set-Cookie') ?? []);
  for (const base of req.legacy ?? []) {
    if (!set.some((c) => c.startsWith(`${nameOf(req, base)}=`))) res.appendHeader('Set-Cookie', setCookie(req, base, cookies(req)[base]));
    if (!set.some((c) => c.startsWith(`${base}=`))) res.appendHeader('Set-Cookie', `${base}=; Max-Age=0; ${cookieFlags(req)}`);
  }
}

// POSTs must come from our own origin. Browsers always send Origin (and Sec-Fetch-Site) on cross-site POSTs.
export function sameOrigin(req) {
  const site = req.headers['sec-fetch-site'];
  if (site && site !== 'same-origin' && site !== 'none') return false;
  const origin = req.headers.origin;
  if (!origin) return true; // not a browser
  try {
    const host = (req.fromProxy && req.headers['x-forwarded-host']) || req.headers.host;
    return new URL(origin).host === host || origin === process.env.PUBLIC_ORIGIN;
  } catch { return false; }
}

export function send(req, res, status, obj) {
  let body = Buffer.from(JSON.stringify(obj));
  const headers = { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' };
  moveLegacy(req, res);
  if (body.length > 1024 && /\bgzip\b/.test(req.headers['accept-encoding'] || '')) {
    body = zlib.gzipSync(body);
    headers['Content-Encoding'] = 'gzip';
    headers.Vary = 'Accept-Encoding';
  }
  res.writeHead(status, headers);
  res.end(body);
}

export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
