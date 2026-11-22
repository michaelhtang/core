// B11 (rest), B12, B13 and the data-file / demo-seed items of section C (docs/system-review.md).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import fs from 'node:fs';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { execFileSync, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createClientSync } from '../public/sync.js';
import { boot, seeded, addClass, openStream, tmpDir } from './helpers.js';
import { moduleSource } from './module-source.js';
import { createStreams } from '../server.js';
import { createApp } from '../lib/app.js';
import { createClock } from '../lib/clock.js';
import { createThrottle } from '../lib/throttle.js';
import { IDLE_MS } from '../lib/players.js';

const WRONG = '000000';
const from = (ip) => ({ 'cf-connecting-ip': ip });                                // the local test client is a trusted proxy
const https = { 'x-forwarded-proto': 'https' };
const median = (xs) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];

test('B11a: every failed login gets the same delay schedule and the same first 429, whether the name is a teacher, a student or nobody', async () => {
  let t = 1e12;
  const th = createThrottle({ now: () => t });
  const steps = (name) => Array.from({ length: 10 }, () => { t += 1000; return th.failed(name); });
  const teacher = steps('teacher');
  assert.deepEqual(steps('BraveOtter12'), teacher);
  assert.deepEqual(steps('nobody-at-all'), teacher);
  assert.deepEqual(teacher.slice(0, 3), [250, 500, 750]);
  assert.equal(teacher.at(-1), 2000);

  const srv = await boot({ limits: { failDelayStepMs: 200, failDelayMaxMs: 1000 } });
  try {
    const { students: [s] } = await seeded(srv, 1);
    const names = ['teacher', s.username, 'GhostWalrus77'];
    const times = new Map(names.map((n) => [n, []]));
    for (let round = 0; round < 5; round++) {
      for (const n of names) {                                                       // interleaved, so drift hits every name alike
        const at = Date.now();
        assert.equal((await srv.client().post('/api/login', { username: n, secret: 'not it at all' }, from(`198.51.100.${round + 1}`))).status, 401);
        times.get(n).push(Date.now() - at);
      }
    }
    const meds = names.map((n) => median(times.get(n)));
    assert.ok(meds.every((m) => m >= 590), `every name waits the 3rd step (600 ms): ${meds}`);   // before the fix only the teacher did
    assert.ok(Math.max(...meds) - Math.min(...meds) < 150, `medians ${meds} are within 150 ms (before the fix: ~600 ms apart)`);
  } finally { await srv.cleanup(); }

  const srv2 = await boot({ limits: { failDelayStepMs: 1 } });
  try {
    const { students: [s] } = await seeded(srv2, 1);
    const statuses = async (n) => { const out = []; for (let i = 0; i < 6; i++) out.push((await srv2.client().post('/api/login', { username: n, secret: 'not it at all' }, from('203.0.113.40'))).status); return out; };
    const want = [401, 401, 401, 401, 401, 429];
    for (const n of ['teacher', s.username, 'GhostWalrus77']) assert.deepEqual(await statuses(n), want, n);
  } finally { await srv2.cleanup(); }
});

test('B11b: a session ends after 8 idle hours (student) or 12 (teacher); requests keep it alive; last_seen is written at most once a minute; the purge drops idle ones', async () => {
  let t = Date.parse('2026-10-01T15:00:00Z');
  const srv = await boot({ clock: createClock({ now: () => t }) });
  try {
    const { teacher, students: [s, s2] } = await seeded(srv, 2);
    const who = async (c) => (await c.get('/api/me')).json.user?.role ?? null;
    const seen = () => srv.app.db.prepare('SELECT last_seen FROM sessions s JOIN players p ON p.id = s.player_id WHERE p.username = ?').get(s.username).last_seen;
    const start = seen();
    t += 30e3; await who(s.client);
    assert.equal(seen(), start);                                                     // under a minute: no write
    t += 31e3; await who(s.client);
    assert.equal(seen(), t);
    t += IDLE_MS.student - 1000;
    assert.equal(await who(s.client), 'student');                                    // just inside: alive, and refreshed
    assert.equal(await who(teacher), 'teacher');
    t += IDLE_MS.student - 1000;
    assert.equal(await who(s.client), 'student');                                    // 16 h after login, but never 8 h idle
    t += IDLE_MS.student + 1;
    assert.equal(await who(s.client), null);
    assert.equal(await who(s2.client), null);
    assert.equal(await who(teacher), null);                                          // 8 h + 8 h idle > 12 h
    const t2 = srv.client();
    assert.equal((await t2.post('/api/login', { username: 'teacher', secret: 'correct horse battery' })).status, 200);
    t += IDLE_MS.teacher - 1000;
    assert.equal(await who(t2), 'teacher');
    t += IDLE_MS.teacher + 1;
    assert.equal(await who(t2), null);
    srv.app.players.purgeSessions();
    assert.equal(srv.app.db.prepare('SELECT COUNT(*) AS n FROM sessions').get().n, 0);
  } finally { await srv.cleanup(); }
});

test('B11c: logging in over an existing session ends it (and closes its stream)', async () => {
  const srv = await boot();
  try {
    const { students: [s, other] } = await seeded(srv, 2);
    const oldCookie = s.client.cookie();
    const stream = await openStream(srv, s.client);
    assert.equal((await s.client.post('/api/login', { username: s.username, secret: s.pin })).status, 200);
    assert.notEqual(s.client.cookie(), oldCookie);
    assert.equal((await srv.client().get('/api/me', { cookie: oldCookie })).json.user, null);
    assert.equal(await stream.ended(1000), true);
    assert.equal((await s.client.get('/api/me')).json.user.username, s.username);
    // someone else's login on this browser ends the previous user's session too
    const before = other.client.cookie();
    assert.equal((await other.client.post('/api/login', { username: s.username, secret: s.pin })).status, 200);
    assert.equal((await srv.client().get('/api/me', { cookie: before })).json.user, null);
    assert.equal((await other.client.get('/api/me')).json.user.username, s.username);
    // a failed login ends nothing
    const kept = s.client.cookie();
    assert.equal((await s.client.post('/api/login', { username: s.username, secret: WRONG })).status, 401);
    assert.equal((await srv.client().get('/api/me', { cookie: kept })).json.user.username, s.username);
  } finally { await srv.cleanup(); }
});

test('B11d: log out everywhere ends every session of that player only, keeps trusted devices unless forget is set too', async () => {
  const srv = await boot({ limits: { failDelayStepMs: 1 } });
  try {
    const { teacher, students: [s, mate] } = await seeded(srv, 2);
    const phone = srv.client();
    assert.equal((await phone.post('/api/login', { username: s.username, secret: s.pin })).status, 200);
    const stream = await openStream(srv, phone);
    assert.equal((await s.client.post('/api/logout', { everywhere: true })).status, 200);
    for (const c of [s.client, phone]) assert.equal((await c.get('/api/me')).json.user, null);
    assert.equal(await stream.ended(1000), true);
    assert.equal((await mate.client.get('/api/me')).json.user.username, mate.username);   // classmates untouched
    assert.equal((await srv.client().post('/api/logout', { everywhere: true })).status, 200);   // nobody signed in: fine
    // teacher: both browsers end, both stay trusted; with forget, this one is forgotten
    const devices = () => srv.app.db.prepare('SELECT COUNT(*) AS n FROM trusted_devices').get().n;
    const laptop = srv.client();
    assert.equal((await laptop.post('/api/login', { username: 'teacher', secret: 'correct horse battery' })).status, 200);
    assert.equal(devices(), 2);
    assert.equal((await laptop.post('/api/logout', { everywhere: true })).status, 200);
    assert.equal((await teacher.get('/api/me')).json.user, null);
    assert.equal(devices(), 2);
    assert.equal((await laptop.post('/api/login', { username: 'teacher', secret: 'correct horse battery' })).status, 200);
    assert.equal((await laptop.post('/api/logout', { everywhere: true, forget: true })).status, 200);
    assert.equal(devices(), 1);
    assert.equal(srv.app.db.prepare('SELECT COUNT(*) AS n FROM sessions WHERE player_id = ?').get(srv.app.players.byUsername('teacher').id).n, 0);
  } finally { await srv.cleanup(); }
});

test('B12a: a cookie that does not decode (a sibling app\'s) is ignored; our session still works', async () => {
  const srv = await boot();
  try {
    const { students: [s] } = await seeded(srv, 1);
    for (const junk of ['theme=%E0%A4%A', '%ZZ=1', 'prefs=%']) {
      const r = await srv.client().get('/api/me', { cookie: `${junk}; ${s.client.cookie()}` });
      assert.equal(r.status, 200);
      assert.equal(r.json.user.username, s.username);
    }
  } finally { await srv.cleanup(); }
});

test('B12b/c: over https the cookies are __Host-sid / __Host-td and HSTS is sent; a legacy sid or td is accepted and moved; http keeps plain names and no HSTS', async () => {
  const srv = await boot();
  try {
    const t = srv.client();
    const setup = await t.post('/api/setup', { username: 'teacher', passphrase: 'correct horse battery' }, https);
    const set = setup.headers.getSetCookie();
    assert.match(set.find((c) => c.startsWith('__Host-sid=')), /^__Host-sid=[0-9a-f]{64}; Max-Age=\d+; HttpOnly; SameSite=Lax; Path=\/; Secure$/);
    assert.match(set.find((c) => c.startsWith('__Host-td=')), /^__Host-td=[0-9a-f]{64}; Max-Age=\d+; HttpOnly; SameSite=Lax; Path=\/; Secure$/);
    assert.ok(set.every((c) => !/domain=/i.test(c)));
    assert.equal(setup.headers.get('strict-transport-security'), 'max-age=31536000');
    const me = await t.get('/api/me', https);
    assert.equal(me.json.user.role, 'teacher');
    assert.equal(me.headers.getSetCookie().length, 0);                               // nothing to move
    assert.equal((await fetch(`${srv.base}/`, { headers: https })).headers.get('strict-transport-security'), 'max-age=31536000');   // static too
    assert.equal((await fetch(`${srv.base}/`)).headers.get('strict-transport-security'), null);
    assert.equal((await t.get('/api/me')).headers.get('strict-transport-security'), null);

    // legacy sid (set before the rename): read once, moved to __Host-sid with the same value, the old one cleared
    const id = srv.app.players.byUsername('teacher').id;
    const token = srv.app.players.startSession(id, 14);
    const moved = await srv.client().get('/api/me', { ...https, cookie: `sid=${token}` });
    assert.equal(moved.json.user.role, 'teacher');
    const mc = moved.headers.getSetCookie();
    assert.ok(mc.includes(`__Host-sid=${token}; Max-Age=${14 * 86400}; HttpOnly; SameSite=Lax; Path=/; Secure`), mc.join(' | '));
    assert.ok(mc.includes('sid=; Max-Age=0; HttpOnly; SameSite=Lax; Path=/; Secure'));
    assert.equal((await srv.client().get('/api/me', { ...https, cookie: `__Host-sid=${token}` })).json.user.role, 'teacher');
    assert.equal((await srv.client().get('/api/me', { ...https, cookie: `__Host-sid=${token}; sid=${token}` })).headers.getSetCookie().length, 0);   // the new name wins
    assert.equal((await srv.client().get('/api/me', { ...https, cookie: 'sid=not-ours' })).headers.getSetCookie().length, 0);   // junk is never echoed back

    // legacy td: the login is trusted (no new device), and td moves to __Host-td
    const td = srv.app.players.createTrustedDevice(id);
    const devices = () => srv.app.db.prepare('SELECT COUNT(*) AS n FROM trusted_devices').get().n;
    const before = devices();
    const login = await srv.client().post('/api/login', { username: 'teacher', secret: 'correct horse battery' }, { ...https, cookie: `td=${td}` });
    assert.equal(login.status, 200);
    assert.equal(devices(), before);
    const lc = login.headers.getSetCookie();
    assert.ok(lc.some((c) => c.startsWith('__Host-sid=')));
    assert.ok(lc.includes(`__Host-td=${td}; Max-Age=${180 * 86400}; HttpOnly; SameSite=Lax; Path=/; Secure`), lc.join(' | '));
    assert.ok(lc.includes('td=; Max-Age=0; HttpOnly; SameSite=Lax; Path=/; Secure'));
    // logout over https clears both names
    const out = (await t.post('/api/logout', { forget: true }, https)).headers.getSetCookie();
    for (const n of ['__Host-sid', 'sid', '__Host-td', 'td']) assert.ok(out.some((c) => c.startsWith(`${n}=; Max-Age=0`)), n);

    // plain http: plain names, no Secure
    const plain = await srv.client().post('/api/login', { username: 'teacher', secret: 'correct horse battery' });
    assert.ok(plain.headers.getSetCookie().every((c) => /^(sid|td)=/.test(c) && !c.includes('Secure')));
  } finally { await srv.cleanup(); }
});

test('B12d: a 4th stream for one player closes that player\'s oldest; other players keep theirs', async () => {
  const srv = await boot();
  try {
    const { students: [s, mate] } = await seeded(srv, 2);
    const theirs = await openStream(srv, mate.client);
    const mine = [];
    for (let i = 0; i < 3; i++) mine.push(await openStream(srv, s.client));
    assert.equal(await mine[0].ended(150), false);
    mine.push(await openStream(srv, s.client));
    assert.equal(await mine[0].ended(1000), true);
    assert.equal(mine[0].events.at(-1).event, 'replaced');                           // N3: told why, so the tab does not reconnect
    assert.ok(mine.slice(1).every((st) => !st.events.some((e) => e.event === 'replaced')));
    for (const st of [...mine.slice(1), theirs]) assert.equal(await st.ended(150), false);
    mine.forEach((st) => st.close()); theirs.close();
  } finally { await srv.cleanup(); }
});

test('B12d: a stream whose socket is backed up skips hints until it drains, but still gets month/world', () => {
  const hub = createStreams();
  const res = Object.assign(new EventEmitter(), { sent: [], full: true, write(chunk) { this.sent.push(/event: (\w+)/.exec(chunk)[1]); return !this.full; }, end() {} });
  const stream = { res, playerId: 1, role: 'student' };
  hub.add(stream);
  hub.write(stream, 'balance');                                                      // buffered: write() said false
  hub.write(stream, 'balance');
  hub.write(stream, 'ping');
  hub.write(stream, 'month', { month: 3 });
  assert.deepEqual(res.sent, ['balance', 'month']);
  assert.equal(res.listenerCount('drain'), 1);                                       // one drain listener, however many writes
  res.full = false;
  res.emit('drain');
  hub.write(stream, 'balance');
  assert.deepEqual(res.sent, ['balance', 'month', 'balance']);
});

test('B13: no module filters k.players.classes() by policy by hand; they call k.players.classesFor(user)', () => {
  const dir = new URL('../modules/', import.meta.url);
  let uses = 0;
  for (const m of fs.readdirSync(dir)) {
    if (!fs.existsSync(new URL(`${m}/index.js`, dir))) continue;
    const src = moduleSource(m);   // every server-side file of the module, not only index.js
    assert.doesNotMatch(src, /\.filter\(\s*\(?\w+\)?\s*=>\s*k\.policy\.can\([^)]*'class\.read'/, `${m} filters classes by policy by hand`);
    uses += (src.match(/k\.players\.classesFor\(user\)/g) ?? []).length;
  }
  assert.equal(uses, 21);   // 11 + learn /teach + today (5a) + life (5b) + stress /teach and leaderboards /flags + feed (6a) + ventures (Phase 4) + retirement /teach (5c) + arcade /teach + walk /teach
});

test('B13: with amounts hidden, a teacher\'s leaderboards view hides other classes\' medians and another class\'s Wolf value, but not their own', async () => {
  const c = JSON.parse(fs.readFileSync(new URL('../config/vdaa.json', import.meta.url), 'utf8'));
  for (const course of Object.values(c.courses)) course.modules = ['bank-basic', 'savings', 'leaderboards'];
  const srv = await boot({ config: c });
  try {
    const { teacher, students: [rich] } = await seeded(srv, 2);
    const invite = new URL((await teacher.post('/api/teach/invites')).json.url).searchParams.get('invite');
    const b = srv.client();
    assert.equal((await b.post('/api/teach/join', { token: invite, username: 'teacherB', passphrase: 'another long passphrase' })).status, 200);
    const bClass = (await b.post('/api/teach/classes', { name: 'B block', course: 'fintech10' })).json;
    for (const m of (await b.post(`/api/teach/classes/${bClass.id}/students`, { count: 2 })).json.students) await srv.client().post('/api/login', { username: m.username, secret: m.pin });
    srv.app.ledger.post({ kind: 'test.grant', legs: [{ account: srv.app.ledger.system('mint'), cents: -900000 }, { account: rich.chequing.id, cents: 900000 }] });   // the Wolf is in A's class
    const w = (await teacher.get('/api/teach/state')).json.world;
    assert.equal((await teacher.post('/api/teach/world/advance', { months: 1, from: w.month })).status, 200);
    const view = async (c2) => (await c2.get('/api/leaderboards/teach')).json;
    const medians = (v) => Object.fromEntries(v.class_table.map((r) => [r.name, r.median_net_worth_cents]));
    const wolf = (v) => v.leaders.find((a) => a.award === 'wolf').value;
    let bv = await view(b);
    assert.ok(Object.values(medians(bv)).every((x) => typeof x === 'number'));       // amounts shown: everything visible
    assert.equal(typeof wolf(bv), 'number');
    assert.equal((await teacher.post('/api/leaderboards/hide', { hide_amounts: true })).status, 200);
    bv = await view(b);
    assert.deepEqual(Object.keys(medians(bv)).sort(), ['B block', 'Block 1']);
    assert.equal(medians(bv)['Block 1'], null);                                      // A's class, as students see it
    assert.equal(typeof medians(bv)['B block'], 'number');                           // B's own
    assert.equal(wolf(bv), null);
    assert.ok(bv.classes[0].rows.every((r) => typeof r.net_worth_cents === 'number'));
    const av = await view(teacher);
    assert.equal(typeof medians(av)['Block 1'], 'number');
    assert.equal(medians(av)['B block'], null);
    assert.equal(typeof wolf(av), 'number');
    // classesFor through the kernel facade: B reads only B block, a student reads nothing
    const k = srv.app.modules.kernel('leaderboards');
    assert.deepEqual(k.players.classesFor({ ...srv.app.players.byUsername('teacherB'), world_teacher: 0 }).map((x) => x.name), ['B block']);
    assert.deepEqual(k.players.classesFor(srv.app.players.get(rich.id)), []);
  } finally { await srv.cleanup(); }
});

test('C: the data dir is 0700 and the database files 0600 after boot, whatever the umask', async () => {
  const dataDir = path.join(tmpDir(), 'data');
  const old = process.umask(0o022);
  let app;
  try {
    fs.mkdirSync(dataDir, { mode: 0o755 });
    app = await createApp({ dataDir });
    app.world.create();
    const mode = (f) => fs.statSync(path.join(dataDir, f)).mode & 0o777;
    assert.equal(mode('.'), 0o700);
    assert.equal(mode('vdaa.db'), 0o600);
    for (const f of ['vdaa.db-wal', 'vdaa.db-shm']) if (fs.existsSync(path.join(dataDir, f))) assert.equal(mode(f), 0o600, f);
    assert.ok(fs.existsSync(path.join(dataDir, 'vdaa.db-wal')));
  } finally {
    process.umask(old);
    app?.db.close();
    fs.rmSync(path.dirname(dataDir), { recursive: true, force: true });
  }
});

test('C: demo-seed refuses to run without --url (no default port)', () => {
  const script = new URL('../scripts/demo-seed.mjs', import.meta.url).pathname;
  assert.throws(() => execFileSync(process.execPath, [script], { stdio: 'pipe' }), (e) => e.status === 2 && /--url/.test(String(e.stderr)));
});

test('N1: cookie names are never URL-decoded and a name sent twice counts as absent (no __Host- bypass from a sibling domain)', async () => {
  const srv = await boot();
  try {
    const t = srv.client();
    await t.post('/api/setup', { username: 'teacher', passphrase: 'correct horse battery' }, https);
    const victim = /__Host-sid=([0-9a-f]+)/.exec(t.cookie())[1];
    const { cls } = { cls: (await t.post('/api/teach/classes', { name: 'B', course: 'fintech10' }, https)).json };
    const [st] = (await t.post(`/api/teach/classes/${cls.id}/students`, { count: 1 }, https)).json.students;
    const attacker = srv.app.players.startSession(srv.app.players.byUsername(st.username).id, 14);
    const who = async (cookie, h = https) => (await srv.client().get('/api/me', { ...h, cookie })).json.user?.role ?? null;
    assert.equal(await who(`__Host-sid=${victim}; %5F%5FHost-sid=${attacker}`), 'teacher');   // the probe: was 'student'
    assert.equal(await who(`__Host-sid=${victim}; __Host%2Dsid=${attacker}`), 'teacher');
    assert.equal(await who(`%5F%5FHost-sid=${attacker}; __Host-sid=${victim}`), 'teacher');
    assert.equal(await who(`%5F%5FHost-sid=${attacker}`), null);
    assert.equal(await who(`__Host-sid=${victim}; __Host-sid=${attacker}`), null);           // duplicates: no session from either
    assert.equal(await who(`__Host-sid=${attacker}; __Host-sid=${victim}; __Host-sid=${victim}`), null);
    assert.equal(await who(`sid=${victim}; sid=${attacker}`, {}), null);                      // the same over http
    assert.equal(await who(`sid=${victim}`, {}), 'teacher');
  } finally { await srv.cleanup(); }
});

test('N2: legacy sid/td are read over https only until the cutoff (14 days after the first boot with migration 012, or VDAA_LEGACY_COOKIES_UNTIL), and only with no __Host-sid at all', async () => {
  let t = Date.parse('2026-10-01T15:00:00Z');
  const srv = await boot({ clock: createClock({ now: () => t }) });
  try {
    await srv.client().post('/api/setup', { username: 'teacher', passphrase: 'correct horse battery' });
    const id = srv.app.players.byUsername('teacher').id;
    const me = (cookie) => srv.client().get('/api/me', { ...https, cookie });
    t += 13 * 864e5;
    let token = srv.app.players.startSession(id, 14);
    let r = await me(`sid=${token}`);
    assert.equal(r.json.user.role, 'teacher');                                       // inside the window: read and moved
    assert.ok(r.headers.getSetCookie().some((c) => c.startsWith(`__Host-sid=${token}`)));
    assert.equal((await me(`__Host-sid=${'0'.repeat(64)}; sid=${token}`)).json.user, null);   // a (dead) __Host-sid: the legacy one is not consulted
    t += 2 * 864e5;                                                                  // day 15: past the cutoff
    token = srv.app.players.startSession(id, 14);
    r = await me(`sid=${token}`);
    assert.equal(r.json.user, null);
    assert.equal(r.headers.getSetCookie().length, 0);
    assert.equal((await me(`__Host-sid=${token}`)).json.user.role, 'teacher');
    const td = srv.app.players.createTrustedDevice(id);
    const before = srv.app.db.prepare('SELECT COUNT(*) AS n FROM trusted_devices').get().n;
    assert.equal((await srv.client().post('/api/login', { username: 'teacher', secret: 'correct horse battery' }, { ...https, cookie: `td=${td}` })).status, 200);
    assert.equal(srv.app.db.prepare('SELECT COUNT(*) AS n FROM trusted_devices').get().n, before + 1);   // legacy td ignored: a new device
    assert.equal((await srv.client().get('/api/me', { cookie: `sid=${token}` })).json.user.role, 'teacher');   // plain http keeps plain names
  } finally { await srv.cleanup(); }
  const saved = process.env.VDAA_LEGACY_COOKIES_UNTIL;
  process.env.VDAA_LEGACY_COOKIES_UNTIL = '2000-01-01';
  const srv2 = await boot();
  try {
    await srv2.client().post('/api/setup', { username: 'teacher', passphrase: 'correct horse battery' });
    const token = srv2.app.players.startSession(srv2.app.players.byUsername('teacher').id, 14);
    assert.equal((await srv2.client().get('/api/me', { ...https, cookie: `sid=${token}` })).json.user, null);
  } finally {
    if (saved === undefined) delete process.env.VDAA_LEGACY_COOKIES_UNTIL; else process.env.VDAA_LEGACY_COOKIES_UNTIL = saved;
    await srv2.cleanup();
  }
});

test('N3: a tab whose stream was replaced stays off (no reconnect, no retry) until it is used again', async () => {
  const all = [];
  class ES {
    constructor() { this.readyState = 0; this.l = {}; all.push(this); }
    addEventListener(n, f) { (this.l[n] ??= []).push(f); }
    fire(n) { (this.l[n] ?? []).forEach((f) => f({ type: n, data: '{}' })); }
    close() { this.readyState = 2; }
  }
  const timers = [];
  let resume = null;
  const live = createClientSync({
    fetchMe: async () => ({ user: { id: 1 }, world: { month: 1 } }), show() {}, replaced: (fn) => { resume = fn; },
    EventSource: ES, setTimer: (fn) => { timers.push(fn); return fn; }, clearTimer() {},
  });
  const flush = () => new Promise((r) => setImmediate(r));
  await live.sync();
  assert.equal(all.length, 1);
  all[0].fire('replaced');
  assert.equal(all[0].readyState, 2);
  assert.equal(live.connected, false);
  await live.sync();                                                               // a refetch (another event, the login form) does not reopen it
  timers.splice(0).forEach((fn) => fn());
  await flush();
  assert.equal(all.length, 1);
  resume();                                                                        // click or focus
  await flush();
  assert.equal(all.length, 2);
  assert.equal(live.connected, true);
});

test('N5: demo-seed --out to an existing file leaves it 0600', async () => {
  const srv = await boot();
  const dir = tmpDir();
  try {
    const out = path.join(dir, 'creds.txt');
    fs.writeFileSync(out, 'old', { mode: 0o644 });
    fs.chmodSync(out, 0o644);
    const { stdout } = await promisify(execFile)(process.execPath, [new URL('../scripts/demo-seed.mjs', import.meta.url).pathname, '--url', srv.base, '--out', out]);
    assert.match(stdout, new RegExp(`Credentials in ${out}`));
    assert.equal(fs.statSync(out).mode & 0o777, 0o600);
    assert.match(fs.readFileSync(out, 'utf8'), /demo-teacher/);
  } finally { await srv.cleanup(); fs.rmSync(dir, { recursive: true, force: true }); }
});

const raw = (port, cookie) => new Promise((res) => {
  const s = net.connect(port, '127.0.0.1', () => s.write(Buffer.concat([Buffer.from('GET /api/me HTTP/1.1\r\nHost: localhost\r\nX-Forwarded-Proto: https\r\nCookie: ', 'latin1'), cookie, Buffer.from('\r\nConnection: close\r\n\r\n')])));
  let b = ''; s.on('data', (d) => { b += d; }); s.on('end', () => res(b));
});
test('cookie names: an NBSP-prefixed and undecodable-duplicate cookie names give no session', async () => {
  const srv = await boot();
  try {
    const { students: [s] } = await seeded(srv, 1);
    const tok = s.client.cookie().split('=')[1];
    const port = new URL(srv.base).port;
    const ok = await raw(port, Buffer.from(`__Host-sid=${tok}`));
    assert.doesNotMatch(ok, /"user":null/);   // control: the plain name works
    const r1 = await raw(port, Buffer.concat([Buffer.from([0xa0]), Buffer.from(`__Host-sid=${tok}`)]));
    assert.match(r1, /"user":null/);
    const r2 = await raw(port, Buffer.from(`__Host-sid=%zz; __Host-sid=${tok}`));
    assert.match(r2, /"user":null/);
  } finally { await srv.cleanup(); }
});
