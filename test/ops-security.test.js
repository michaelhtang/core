// Operations hardening: setup token (A6c) and the login limits on a shared school address (A11).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { boot, seeded, bareApp } from './helpers.js';
import { ipKey } from '../lib/throttle.js';

const WRONG = '000000';
const fakeClock = (start = 1e12) => { let t = start; return { now: () => t, tick: (ms) => { t += ms; } }; };
const from = (ip) => ({ 'cf-connecting-ip': ip });                                // the local test client is a trusted proxy

test('ipKey: IPv4 as is, IPv4-mapped IPv6 as IPv4, IPv6 by its /64', () => {
  assert.equal(ipKey('203.0.113.5'), '203.0.113.5');
  assert.equal(ipKey('::ffff:203.0.113.5'), '203.0.113.5');
  assert.equal(ipKey('2001:db8:1:2:aaaa:bbbb:cccc:dddd'), '2001:0db8:0001:0002::/64');
  assert.equal(ipKey('2001:DB8:1:2::9'), '2001:0db8:0001:0002::/64');
  assert.equal(ipKey('2001:db8::1'), '2001:0db8:0000:0000::/64');
  assert.equal(ipKey('::1'), '0000:0000:0000:0000::/64');
  assert.equal(ipKey('p17'), 'p17');                                               // the bank module's own keys pass through
});


const tdOf = (res) => res.headers.getSetCookie().find((c) => c.startsWith('td='));
const sidOf = (client) => /sid=[0-9a-f]+/.exec(client.cookie())[0];
const tdValue = (client) => /td=[0-9a-f]+/.exec(client.cookie())[0];

test('A11: a student spraying one classmate is stopped by the per-pair limit and does not block the rest of the class; the target locks at 30 an hour', async () => {
  const clock = fakeClock();
  const srv = await boot({ limits: { now: clock.now } });
  try {
    const { teacher, cls, students } = await seeded(srv, 4);
    const [victim, ...others] = students;
    const school = from('203.0.113.7');
    for (let minute = 0; minute < 7; minute++) {
      const burst = await Promise.all(Array.from({ length: 200 }, () => srv.client().post('/api/login', { username: victim.username, secret: WRONG }, school)));
      assert.equal(burst.filter((r) => r.status === 401).length, minute < 6 ? 5 : 0);   // 5 judged a minute, 30 an hour in all
      for (const o of others) assert.equal((await srv.client().post('/api/login', { username: o.username, secret: o.pin }, school)).status, 200);
      clock.tick(61_000);
    }
    const locked = await srv.client().post('/api/login', { username: victim.username, secret: victim.pin }, from('198.51.100.9'));
    assert.equal(locked.status, 429);
    assert.match(locked.json.error, /unlock/i);
    assert.equal((await teacher.get(`/api/teach/classes/${cls.id}/students`)).json.students.find((s) => s.id === victim.id).locked, true);
    assert.equal((await teacher.post(`/api/teach/players/${victim.id}/unlock`)).status, 200);
    assert.equal((await srv.client().post('/api/login', { username: victim.username, secret: victim.pin }, school)).status, 200);
  } finally { await srv.cleanup(); }
});

test('D2: spraying many (fake) usernames from the school address does not block a classmate until 600; then the trusted-device teacher gets in, unblocks the address, and the class can log in again', async () => {
  const srv = await boot();
  try {
    const { teacher, students: [mate] } = await seeded(srv, 1);                      // the seeded teacher client holds a trusted-device cookie from setup
    const school = from('203.0.113.9');
    const spray = async (from0, n) => {
      for (let i = from0; i < from0 + n; i += 50) await Promise.all(Array.from({ length: Math.min(50, from0 + n - i) }, (_, j) => srv.client().post('/api/login', { username: `ghost${i + j}`, secret: WRONG }, school)));
    };
    await spray(0, 300);                                                             // the old ceiling was 150: this already blocked the class
    assert.equal((await srv.client().post('/api/login', { username: mate.username, secret: mate.pin }, school)).status, 200);
    await spray(300, 320);                                                           // past the new ceiling of 600
    const blocked = await srv.client().post('/api/login', { username: mate.username, secret: mate.pin }, school);
    assert.equal(blocked.status, 429);
    assert.equal((await srv.client().post('/api/login', { username: 'teacher', secret: 'correct horse battery' }, school)).status, 429);   // a teacher on a new browser waits too
    assert.equal((await teacher.post('/api/login', { username: 'teacher', secret: 'correct horse battery' }, school)).status, 200);          // a known browser does not
    const listed = (await teacher.get('/api/teach/login-trouble')).json.blocked;
    assert.equal(listed.length, 1);
    assert.equal(listed[0].ip, '203.0.113.9');
    assert.ok(listed[0].count >= 600 && listed[0].frees > Date.now() - 1000);
    // only the world teacher may unblock
    const invite = (await teacher.post('/api/teach/invites')).json.url.split('invite=')[1];
    const second = srv.client();
    assert.equal((await second.post('/api/teach/join', { token: invite, username: 'teacher2', passphrase: 'another long phrase' }, from('198.51.100.20'))).status, 200);
    assert.deepEqual((await second.get('/api/teach/login-trouble')).json.blocked, []);
    assert.equal((await second.post('/api/teach/blocked-ips/unblock', { ip: '203.0.113.9' })).status, 403);
    assert.equal((await teacher.post('/api/teach/blocked-ips/unblock', { ip: '203.0.113.200' })).status, 404);
    assert.equal((await teacher.post('/api/teach/blocked-ips/unblock', { ip: '203.0.113.9' })).status, 200);
    assert.equal((await srv.client().post('/api/login', { username: mate.username, secret: mate.pin }, school)).status, 200);
    assert.deepEqual((await teacher.get('/api/teach/login-trouble')).json.blocked, []);
    assert.equal(srv.app.db.prepare("SELECT COUNT(*) AS n FROM audit_log WHERE action = 'login.unblock-ip'").get().n, 1);
  } finally { await srv.cleanup(); }
});


test('A11: the pure-IP ceiling is high (a full class), and an IPv6 address is counted by its /64', async () => {
  const srv = await boot({ limits: { ip: 3 } });
  try {
    const c = srv.client();
    for (let i = 0; i < 3; i++) assert.equal((await c.post('/api/login', { username: `nobody${i}`, secret: WRONG }, from(`2001:db8:5:6:${i}::1`))).status, 401);
    assert.equal((await c.post('/api/login', { username: 'nobody9', secret: WRONG }, from('2001:db8:5:6:ffff::9'))).status, 429);   // same /64
    assert.equal((await c.post('/api/login', { username: 'nobody9', secret: WRONG }, from('2001:db8:5:7::9'))).status, 401);        // another /64
  } finally { await srv.cleanup(); }
  const { DEFAULT_LIMITS } = await import('../lib/throttle.js');
  assert.ok(DEFAULT_LIMITS.ip >= 600);
});

test('D1: strangers cannot keep the teacher out for ever: a trusted browser signs in whatever the budget says, a new one waits with a clear message', async () => {
  const clock = fakeClock();
  const srv = await boot({ limits: { now: clock.now, failDelayStepMs: 1 } });
  try {
    const { teacher } = await seeded(srv, 1);                                        // setup left this client a trusted-device cookie
    const wrong = (i) => srv.client().post('/api/login', { username: 'teacher', secret: 'not the passphrase' }, from(`2001:db8:${i}::1`));
    for (let i = 0; i < 20; i++) { assert.equal((await wrong(i)).status, 401); if (i < 19) clock.tick(45_000); }   // fill the budget over 14 minutes
    for (let i = 0; i < 12; i++) { clock.tick(45_000); await wrong(100 + i); }       // then one wrong guess each time a slot frees, for 9 more minutes
    const fresh = await srv.client().post('/api/login', { username: 'teacher', secret: 'correct horse battery' }, from('2001:db8:aaaa::1'));
    assert.equal(fresh.status, 429);
    assert.match(fresh.json.error, /device you've used before, or wait \d+ minutes?/);
    assert.equal((await teacher.post('/api/login', { username: 'teacher', secret: 'correct horse battery' }, from('2001:db8:bbbb::1'))).status, 200);
    // the trusted browser's own typos neither use up the budget nor get past 5 a minute from one address
    const home = from('192.0.2.50');
    for (let i = 0; i < 5; i++) assert.equal((await teacher.post('/api/login', { username: 'teacher', secret: WRONG }, home)).status, 401);
    assert.equal((await teacher.post('/api/login', { username: 'teacher', secret: 'correct horse battery' }, home)).status, 429);
    assert.equal((await teacher.post('/api/login', { username: 'teacher', secret: 'correct horse battery' }, from('192.0.2.51'))).status, 200);
    // a budget that really ages out lets a new browser in, and that browser is then trusted too
    clock.tick(15 * 60_000 + 1000);
    const again = srv.client();
    const ok = await again.post('/api/login', { username: 'teacher', secret: 'correct horse battery' }, from('2001:db8:cccc::1'));
    assert.equal(ok.status, 200);
    assert.match(tdOf(ok), /^td=[0-9a-f]{64}; Max-Age=\d+; HttpOnly; SameSite=Lax; Path=\/$/);
    const https = await srv.client().post('/api/login', { username: 'teacher', secret: 'correct horse battery' }, { ...from('2001:db8:dddd::1'), 'x-forwarded-proto': 'https' });
    assert.match(https.headers.getSetCookie().find((c) => c.startsWith('__Host-td=')), /; Secure/);
  } finally { await srv.cleanup(); }
});

test('D1: a successful login gives its budget slot back (19 strangers\' misses + five right logins from new browsers, all in one instant)', async () => {
  const clock = fakeClock();
  const srv = await boot({ limits: { now: clock.now, failDelayStepMs: 1 } });
  try {
    await seeded(srv, 1);
    for (let i = 0; i < 19; i++) assert.equal((await srv.client().post('/api/login', { username: 'teacher', secret: 'not the passphrase' }, from(`2001:db8:${i}::1`))).status, 401);
    for (let i = 0; i < 5; i++) assert.equal((await srv.client().post('/api/login', { username: 'teacher', secret: 'correct horse battery' }, from(`2001:db8:f${i}::1`))).status, 200);
    assert.equal((await srv.client().post('/api/login', { username: 'teacher', secret: 'not the passphrase' }, from('2001:db8:e::1'))).status, 401);   // the 20th miss
    assert.equal((await srv.client().post('/api/login', { username: 'teacher', secret: 'not the passphrase' }, from('2001:db8:e1::1'))).status, 429);
  } finally { await srv.cleanup(); }
});

test('D1: the passphrase change has a per-session cap (10 an hour) even on a trusted browser, shares the budget on a stolen session, and revokes trusted devices', async () => {
  const srv = await boot({ limits: { failDelayStepMs: 1 } });
  try {
    const { teacher } = await seeded(srv, 1);
    const stolen = { cookie: sidOf(teacher) };                                       // the session without the trusted-device cookie
    const change = (c, current, h) => c.post('/api/teach/passphrase', { current, next: 'a brand new passphrase' }, h);
    for (let i = 0; i < 20; i++) await srv.client().post('/api/login', { username: 'teacher', secret: 'not the passphrase' }, from(`2001:db8:${i}::1`));
    assert.equal((await change(srv.client(), 'correct horse battery', stolen)).status, 429);   // stolen session: the stranger-filled budget applies
    for (let i = 0; i < 10; i++) assert.equal((await change(teacher, 'wrong wrong wrong')).status, 401);   // trusted browser: only the session cap
    assert.equal((await change(teacher, 'correct horse battery')).status, 429);
    assert.match((await change(teacher, 'correct horse battery')).json.error, /session/);
  } finally { await srv.cleanup(); }
  const srv2 = await boot({ limits: { failDelayStepMs: 1 } });
  try {
    const { teacher } = await seeded(srv2, 1);
    const oldTd = tdValue(teacher);
    assert.equal((await teacher.post('/api/teach/passphrase', { current: 'correct horse battery', next: 'a brand new passphrase' })).status, 200);
    assert.notEqual(tdValue(teacher), oldTd);                                        // this browser got a new one
    assert.equal(srv2.app.db.prepare('SELECT COUNT(*) AS n FROM trusted_devices').get().n, 1);
    for (let i = 0; i < 20; i++) await srv2.client().post('/api/login', { username: 'teacher', secret: 'not the passphrase' }, from(`2001:db8:${i}::1`));
    const login = (td) => srv2.client().post('/api/login', { username: 'teacher', secret: 'a brand new passphrase' }, { cookie: td });
    assert.equal((await login(oldTd)).status, 429);                                  // the old device was forgotten
    assert.equal((await login(tdValue(teacher))).status, 200);
  } finally { await srv2.cleanup(); }
});

test('A6c/D3: setup is closed without a token (unless open for dev); wrong tokens are limited to 5 a minute per address with no account lock; the right token always gets in', async () => {
  const saved = process.env.VDAA_SETUP_TOKEN;
  const clock = fakeClock();
  const srv = await boot({ openSetup: false, limits: { now: clock.now } });
  const setup = (token) => srv.client().post('/api/setup', { username: 'teacher', passphrase: 'correct horse battery', ...(token && { token }) });
  try {
    delete process.env.VDAA_SETUP_TOKEN;
    const closed = await setup();
    assert.equal(closed.status, 403);
    assert.match(closed.json.error, /VDAA_SETUP_TOKEN/);
    assert.equal(srv.app.db.prepare("SELECT COUNT(*) AS n FROM players WHERE role = 'teacher'").get().n, 0);

    process.env.VDAA_SETUP_TOKEN = 'a-long-random-setup-token';
    for (let i = 0; i < 5; i++) assert.equal((await setup(`guess-${i}`)).status, 403);
    const limited = await setup('guess-5');
    assert.equal(limited.status, 429);
    assert.equal(limited.json.error, 'Too many wrong setup tokens. Wait a minute and try again.');
    assert.equal((await setup('a-long-random-setup-token')).status, 429);            // even the right token waits out the minute
    // join has its own key: the same words as a join token are not touched by setup's misses
    assert.equal((await srv.client().post('/api/teach/join', { token: '  setup ', username: 'x-teacher', passphrase: 'another long phrase' })).status, 404);
    for (let minute = 0; minute < 8; minute++) {                                     // 40+ wrong tokens over an hour: setup never locks for good
      clock.tick(61_000);
      for (let i = 0; i < 5; i++) assert.equal((await setup(`again-${minute}-${i}`)).status, 403);
    }
    clock.tick(61_000);
    assert.equal((await setup('a-long-random-setup-token-plus')).status, 403);      // a longer token is simply wrong (equal-length hashes compared)
    const ok = await setup('a-long-random-setup-token');
    assert.equal(ok.status, 200);
    assert.ok(tdOf(ok), 'the first teacher gets a trusted-device cookie');
    assert.equal((await setup('a-long-random-setup-token')).status, 409);           // only one world teacher
  } finally {
    if (saved === undefined) delete process.env.VDAA_SETUP_TOKEN; else process.env.VDAA_SETUP_TOKEN = saved;
    await srv.cleanup();
  }
});

test('R2: a copied trusted-device cookie is capped at 20 wrong tries per 15 minutes per username across many /64s, and changing the passphrase ends it', async () => {
  const srv = await boot({ limits: { failDelayStepMs: 1 } });
  try {
    const { teacher } = await seeded(srv, 1);
    const td = tdValue(teacher);                                                     // what a thief copies from a shared computer
    const thief = (i, secret = 'nope nope nope') => srv.client().post('/api/login', { username: 'teacher', secret }, { ...from(`2001:db8:${i}::1`), cookie: td });
    for (let i = 0; i < 20; i++) assert.equal((await thief(i)).status, 401);          // 40 /64s would have given 200 judged guesses a minute before
    const capped = await thief(21);
    assert.equal(capped.status, 429);
    assert.match(capped.json.error, /Wait \d+ minutes?/);
    assert.equal((await thief(22, 'correct horse battery')).status, 429);
    // the real teacher shares that budget on this cookie, but their open session can change the passphrase, which forgets the cookie
    assert.equal((await teacher.post('/api/teach/passphrase', { current: 'correct horse battery', next: 'a brand new passphrase' })).status, 200);
    const id = srv.app.players.byUsername('teacher').id;
    assert.equal(srv.app.players.isTrustedDevice(td.slice(3), id), false);
    assert.equal(srv.app.players.isTrustedDevice(tdValue(teacher).slice(3), id), true);
    // and the thief's spent budget is gone with it: the new trusted browser logs straight back in
    assert.equal((await teacher.post('/api/logout', {})).status, 200);
    assert.equal((await teacher.post('/api/login', { username: 'teacher', secret: 'a brand new passphrase' }, from('192.0.2.9'))).status, 200);
  } finally { await srv.cleanup(); }
});

test('R2: "forget this device" at logout deletes the trusted device and clears the cookie; a plain logout keeps it', async () => {
  const srv = await boot({ limits: { failDelayStepMs: 1 } });
  try {
    await seeded(srv, 1);
    const count = () => srv.app.db.prepare('SELECT COUNT(*) AS n FROM trusted_devices').get().n;
    const c = srv.client();
    assert.equal((await c.post('/api/login', { username: 'teacher', secret: 'correct horse battery' }, from('192.0.2.1'))).status, 200);
    assert.equal(count(), 2);                                                        // setup's browser and this one
    assert.equal((await c.post('/api/logout', {})).status, 200);
    assert.equal(count(), 2);                                                        // plain logout keeps the device
    const td = tdValue(c);
    const out = await c.post('/api/logout', { forget: true });
    assert.ok(out.headers.getSetCookie().some((x) => /^td=; Max-Age=0/.test(x)));
    assert.equal(count(), 1);
    assert.equal(srv.app.players.isTrustedDevice(td.slice(3), srv.app.players.byUsername('teacher').id), false);
    assert.equal((await srv.client().post('/api/logout', { forget: 'yes' })).status, 200);   // junk is ignored, never an error
  } finally { await srv.cleanup(); }
});

test('R2: a trusted device expires 180 days after its last use, not after it was made; the purge drops expired ones', async () => {
  const { app, cleanup } = await bareApp();
  try {
    const id = await app.players.createTeacher({ username: 'teacherx', passphrase: 'twelve chars here' });
    const token = app.players.createTrustedDevice(id);
    const day = 864e5;
    const set = (created, used) => app.db.prepare('UPDATE trusted_devices SET created = ?, last_used = ?').run(app.clock.now() - created * day, app.clock.now() - used * day);
    set(400, 179);
    assert.equal(app.players.isTrustedDevice(token, id), true);                      // made 400 days ago, used 179 days ago
    app.players.touchTrustedDevice(token);
    assert.ok(app.db.prepare('SELECT last_used FROM trusted_devices').get().last_used >= app.clock.now() - 1000);
    set(400, 181);
    assert.equal(app.players.isTrustedDevice(token, id), false);
    app.players.purgeSessions();
    assert.equal(app.db.prepare('SELECT COUNT(*) AS n FROM trusted_devices').get().n, 0);
  } finally { cleanup(); }
});
