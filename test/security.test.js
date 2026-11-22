import { test } from 'node:test';
import assert from 'node:assert/strict';
import { boot, seeded } from './helpers.js';

const WRONG = '000000';
const cf = (ip) => ({ 'cf-connecting-ip': ip });

test('login throttle: 150 parallel guesses (wrong, then the right PIN) cannot all be judged; at most the limit gets through', async () => {
  const srv = await boot();
  try {
    const { students } = await seeded(srv, 1);
    const [s] = students;
    const attempts = [
      ...Array.from({ length: 100 }, () => srv.client().post('/api/login', { username: s.username, secret: WRONG })),
      ...Array.from({ length: 50 }, () => srv.client().post('/api/login', { username: s.username, secret: s.pin })),
    ];
    const results = await Promise.all(attempts);
    const judged = results.filter((r) => r.status !== 429);
    assert.ok(judged.length <= 5, `${judged.length} attempts were judged, limit is 5`);
    assert.ok(results.filter((r) => r.status === 429).length >= 145);
    assert.ok(results.filter((r) => r.status === 200).length <= 5);
    assert.ok(results.every((r) => [200, 401, 429].includes(r.status)));
  } finally { await srv.cleanup(); }
});

test('login throttle: the per-IP limit also holds under a parallel burst across many usernames', async () => {
  const srv = await boot({ limits: { ip: 6 } });
  try {
    const results = await Promise.all(Array.from({ length: 60 }, (_, i) => srv.client().post('/api/login', { username: `nobody${i}`, secret: WRONG })));
    assert.equal(results.filter((r) => r.status === 401).length, 6);
    assert.equal(results.filter((r) => r.status === 429).length, 54);
  } finally { await srv.cleanup(); }
});

// A hand-driven clock for the throttle: tests move time instead of sleeping.
const fakeClock = (start = 1e12) => { let t = start; return { now: () => t, tick: (ms) => { t += ms; } }; };

test('login throttle is a short backoff, not a lock: it lifts by itself, and a success gives its slot back', async () => {
  const clock = fakeClock();
  const srv = await boot({ limits: { userWindowMs: 400, now: clock.now } });
  try {
    const { students } = await seeded(srv, 1);
    const [s] = students;
    const c = srv.client();
    for (let i = 0; i < 5; i++) assert.equal((await c.post('/api/login', { username: s.username, secret: WRONG })).status, 401);
    const blocked = await c.post('/api/login', { username: s.username, secret: s.pin });
    assert.equal(blocked.status, 429);
    assert.match(blocked.json.error, /Wait \d+ second/);
    clock.tick(399);
    assert.equal((await c.post('/api/login', { username: s.username, secret: s.pin })).status, 429);   // the edge of the window is exact
    clock.tick(1);
    assert.equal((await c.post('/api/login', { username: s.username, secret: s.pin })).status, 200);
    // successes do not use up the allowance: 12 good logins in a row are fine
    for (let i = 0; i < 12; i++) assert.equal((await srv.client().post('/api/login', { username: s.username, secret: s.pin })).status, 200);
  } finally { await srv.cleanup(); }
});

test('someone else guessing a username cannot lock a student out for long, and the teacher can unlock at once', async () => {
  const srv = await boot();
  try {
    const { teacher, cls, students } = await seeded(srv, 2);
    const [victim] = students;
    for (let i = 0; i < 5; i++) await srv.client().post('/api/login', { username: victim.username, secret: WRONG });
    assert.equal((await srv.client().post('/api/login', { username: victim.username, secret: victim.pin })).status, 429);
    const row = (await teacher.get(`/api/teach/classes/${cls.id}/students`)).json.students.find((x) => x.id === victim.id);
    assert.equal(row.locked, true);
    assert.equal((await teacher.post(`/api/teach/players/${victim.id}/unlock`)).status, 200);
    assert.equal((await teacher.get(`/api/teach/classes/${cls.id}/students`)).json.students.find((x) => x.id === victim.id).locked, false);
    assert.equal((await srv.client().post('/api/login', { username: victim.username, secret: victim.pin })).status, 200);
    assert.equal(srv.app.db.prepare("SELECT COUNT(*) AS n FROM audit_log WHERE action = 'login.unlock'").get().n, 1);
    assert.equal((await students[1].client.post(`/api/teach/players/${victim.id}/unlock`)).status, 403);
  } finally { await srv.cleanup(); }
});

test('per-IP limit is keyed on CF-Connecting-IP when the request comes from the trusted local proxy', async () => {
  const srv = await boot({ limits: { ip: 3 } });                                  // trusted proxies default to 127.0.0.1 / ::1
  try {
    const c = srv.client();
    const fail = (ip, n) => c.post('/api/login', { username: `nobody${n}`, secret: WRONG }, { 'cf-connecting-ip': ip });
    for (let i = 0; i < 3; i++) assert.equal((await fail('203.0.113.5', i)).status, 401);
    assert.equal((await fail('203.0.113.5', 9)).status, 429);
    assert.equal((await fail('203.0.113.6', 10)).status, 401);                    // a different visitor is unaffected
    assert.equal((await c.post('/api/login', { username: 'x', secret: WRONG }, { 'cf-connecting-ip': 'not-an-ip' })).status, 401);   // garbage falls back to the socket address
  } finally { await srv.cleanup(); }
});

test('CF-Connecting-IP is ignored when the peer is not a trusted proxy (cannot be used to dodge the limit)', async () => {
  const srv = await boot({ limits: { ip: 3 }, trustedProxies: ['10.9.9.9'] });
  try {
    const c = srv.client();
    for (let i = 0; i < 3; i++) assert.equal((await c.post('/api/login', { username: `nobody${i}`, secret: WRONG }, { 'cf-connecting-ip': `203.0.113.${i}` })).status, 401);
    assert.equal((await c.post('/api/login', { username: 'nobody9', secret: WRONG }, { 'cf-connecting-ip': '198.51.100.77' })).status, 429);
    // and forwarded headers do not mark the cookie Secure or change the origin check either
    const login = await c.post('/api/setup', { username: 'ab', passphrase: 'x' }, { 'x-forwarded-proto': 'https' });
    assert.ok(!(login.headers.get('set-cookie') || '').includes('Secure'));
  } finally { await srv.cleanup(); }
});

test('bad bodies are 400 and malformed cookies are ignored, never 500', async () => {
  const srv = await boot();
  try {
    const raw = (body, headers = {}) => fetch(`${srv.base}/api/login`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body });
    for (const body of ['null', '[]', '"text"', '123', 'true', '{bad json', '[1,2']) assert.equal((await raw(body)).status, 400, body);
    assert.equal((await raw('{}')).status, 401);
    assert.equal((await raw('')).status, 401);
    const c = srv.client();
    assert.equal((await c.get('/api/me', { cookie: 'sid=%E0%A4%A' })).json.user, null);   // B12: skipped, not a 400
    assert.equal((await c.get('/api/me', { cookie: '%ZZ=1' })).status, 200);
    assert.equal((await c.post('/api/logout', {}, { cookie: 'sid=%' })).status, 200);
    assert.equal((await c.get('/api/me', { cookie: 'sid=abc; =x; ;;novalue; a=b=c' })).status, 200);
    assert.equal((await c.get('/api/me', { cookie: 'sid=zzzz' })).json.user, null);
    assert.equal((await c.post('/api/setup', null)).status, 400);
  } finally { await srv.cleanup(); }
});

test('odd input never produces a 500 on teacher or student routes', async () => {
  const srv = await boot();
  try {
    const { teacher, students } = await seeded(srv, 2);
    const bodies = [{}, { count: null }, { count: 'x' }, { name: {}, course: [] }, { cents: {} }, { to: [], cents: 1 }, { months: '3' }, { months_per_day: [] }, { class_id: 'x' }, { enabled: {}, class_id: 1 }, { username: {}, secret: {} }];
    const posts = ['/api/teach/classes', '/api/teach/classes/abc/students', '/api/teach/classes/1/students', '/api/teach/players/abc/reset-pin', '/api/teach/players/abc/unlock',
      '/api/teach/world/advance', '/api/teach/world/settings', '/api/bank-basic/settings', '/api/bank-basic/transfers/abc/reverse', '/api/login', '/api/setup'];
    for (const p of posts) for (const b of bodies) assert.notEqual((await teacher.post(p, b)).status, 500, `${p} ${JSON.stringify(b)}`);
    for (const b of bodies) assert.notEqual((await students[0].client.post('/api/bank-basic/transfer', b)).status, 500, JSON.stringify(b));
    const gets = ['/api/accounts/abc/statement', '/api/accounts/-1/statement', '/api/accounts/1e99/statement', '/api/accounts/%00/statement', '/api/accounts/1/statement?limit=abc',
      '/api/teach/classes/abc/students', '/api/teach/classes/9e99/students', '/api/teach/audit', '/api/bank-basic/transfers', '/api/bank-basic/status'];
    for (const g of gets) {
      assert.notEqual((await teacher.get(g)).status, 500, g);
      assert.notEqual((await students[0].client.get(g)).status, 500, g);
    }
  } finally { await srv.cleanup(); }
});

test('a persistent poller at one IP cannot keep a classmate at another IP out (a guess every 20 ms for 30 s of simulated time)', async () => {
  const clock = fakeClock();
  const srv = await boot({ limits: { now: clock.now } });
  try {
    const { students } = await seeded(srv, 1);
    const [victim] = students;
    const seen = { 401: 0, 429: 0, other: 0 };
    let tries = 0;
    let ok = 0;
    for (let ms = 0; ms < 30000; ms += 20) {
      const r = await srv.client().post('/api/login', { username: victim.username, secret: WRONG }, cf('198.51.100.7'));
      seen[r.status === 401 || r.status === 429 ? r.status : 'other']++;
      if (ms % 500 === 0) {
        const v = await srv.client().post('/api/login', { username: victim.username, secret: victim.pin }, cf('203.0.113.9'));
        tries++;
        if (v.status === 200) ok++;
      }
      clock.tick(20);
    }
    assert.ok(tries >= 50);
    assert.equal(ok, tries, 'the victim must get in every time');
    assert.ok(seen[401] <= 5, `the attacker had ${seen[401]} guesses judged in 30 s, limit is 5 per minute`);
    assert.ok(seen[429] > 500 && seen.other === 0);
    assert.equal(srv.app.ledger.audit().ok, true);
  } finally { await srv.cleanup(); }
});

test('a student is capped at 30 failed tries per hour across all IPs; Login trouble shows it; Unlock clears every counter', async () => {
  const srv = await boot();
  try {
    const { teacher, cls, students } = await seeded(srv, 3);
    const [victim, annoyed, fine] = students;
    // 40 guesses, each from a different IP: all pass the per-(student, IP) limit, but only 30 are ever judged
    const statuses = [];
    for (let i = 1; i <= 40; i++) statuses.push((await srv.client().post('/api/login', { username: victim.username, secret: WRONG }, cf(`203.0.113.${i}`))).status);
    assert.equal(statuses.filter((s) => s === 401).length, 30);
    assert.equal(statuses.filter((s) => s === 429).length, 10);
    const blocked = await srv.client().post('/api/login', { username: victim.username, secret: victim.pin }, cf('192.0.2.200'));
    assert.equal(blocked.status, 429);
    assert.match(blocked.json.error, /ask your teacher/i);
    // the teacher's "Login trouble" list: 3+ wrong tries, real students only
    for (let i = 0; i < 3; i++) await srv.client().post('/api/login', { username: annoyed.username, secret: WRONG });
    for (let i = 0; i < 2; i++) await srv.client().post('/api/login', { username: fine.username, secret: WRONG });
    for (let i = 0; i < 4; i++) await srv.client().post('/api/login', { username: 'NobodyHere99', secret: WRONG }, cf('198.51.100.50'));
    const { trouble } = (await teacher.get('/api/teach/login-trouble')).json;
    assert.deepEqual(trouble.map((t) => [t.username, t.failures, t.locked]), [[annoyed.username, 3, false], [victim.username, 30, true]]);
    assert.ok(trouble.every((t) => Math.abs(t.last - Date.now()) < 60000));
    assert.equal((await students[1].client.get('/api/teach/login-trouble')).status, 403);
    const listed = (await teacher.get(`/api/teach/classes/${cls.id}/students`)).json.students;
    assert.equal(listed.find((s) => s.id === victim.id).locked, true);
    assert.equal(listed.find((s) => s.id === fine.id).locked, false);
    // Unlock clears the hourly count AND the per-(student, IP) buckets
    for (let i = 0; i < 5; i++) await srv.client().post('/api/login', { username: annoyed.username, secret: WRONG });
    assert.equal((await srv.client().post('/api/login', { username: annoyed.username, secret: annoyed.pin })).status, 429);
    assert.equal((await teacher.post(`/api/teach/players/${victim.id}/unlock`)).status, 200);
    assert.equal((await teacher.post(`/api/teach/players/${annoyed.id}/unlock`)).status, 200);
    assert.equal((await srv.client().post('/api/login', { username: victim.username, secret: victim.pin }, cf('192.0.2.200'))).status, 200);
    assert.equal((await srv.client().post('/api/login', { username: annoyed.username, secret: annoyed.pin })).status, 200);
    assert.deepEqual((await teacher.get('/api/teach/login-trouble')).json.trouble, []);
  } finally { await srv.cleanup(); }
});

test('the teacher is never locked out: a browser that has signed in before gets in however many strangers guess from anywhere; a new browser waits', async () => {
  const srv = await boot({ limits: { failDelayStepMs: 5, failDelayMaxMs: 20 } });
  try {
    const { teacher } = await seeded(srv, 1);                                      // setup left this browser a trusted-device cookie
    for (let i = 0; i < 40; i++) assert.equal((await srv.client().post('/api/login', { username: 'Teacher', secret: 'nope nope nope' }, cf(`203.0.113.${i + 1}`))).status, i < 20 ? 401 : 429);
    const stranger = await srv.client().post('/api/login', { username: 'teacher', secret: 'correct horse battery' }, cf('192.0.2.77'));
    assert.equal(stranger.status, 429);                                            // right passphrase, unknown browser, budget full
    assert.match(stranger.json.error, /device you've used before/);
    assert.equal((await teacher.post('/api/login', { username: 'teacher', secret: 'correct horse battery' }, cf('192.0.2.78'))).status, 200);
    assert.equal((await teacher.get('/api/me')).json.user.role, 'teacher');
    assert.equal((await teacher.get('/api/teach/state')).status, 200);
  } finally { await srv.cleanup(); }
});

// The delay schedule itself, on the throttle's injectable clock: exact, no wall time involved.
test('failed-login delay schedule (every name): one step per recent failure, capped, forgotten on success and after the window', async () => {
  const { createThrottle } = await import('../lib/throttle.js');
  let now = 1e12;
  const th = createThrottle({ now: () => now, failDelayStepMs: 100, failDelayMaxMs: 250 });
  assert.deepEqual([1, 2, 3, 4].map(() => th.failed('Teacher')), [100, 200, 250, 250]);
  assert.equal(th.failed('someone-else'), 100, 'per username');
  th.succeeded('teacher');                                                       // case-insensitive, like the login
  assert.equal(th.failed('teacher'), 100, 'a success forgets the failures');
  now += 24 * 3600e3;
  assert.equal(th.failed('someone-else'), 100, 'old failures age out of the window');
});

// Over HTTP: only what a slow box cannot break. A sleep is never shorter than asked (lower bounds), and the right passphrase is never
// stalled, so it is faster than a capped wrong try (ordering, not absolute milliseconds: one failed at 253 ms vs < 250 under load).
test('teacher logins get a progressive delay on each failed try (capped), and the right passphrase is never delayed', async () => {
  const srv = await boot({ limits: { failDelayStepMs: 100, failDelayMaxMs: 250 } });
  try {
    await seeded(srv, 1);
    const timed = async (secret) => { const t = performance.now(); const r = await srv.client().post('/api/login', { username: 'teacher', secret }); return [r.status, performance.now() - t]; };
    const [s1, d1] = await timed(WRONG);
    const [, d2] = await timed(WRONG);
    const [, d3] = await timed(WRONG);
    assert.equal(s1, 401);
    assert.ok(d1 >= 99 && d2 >= 199 && d3 >= 249, `at least one step per failure: ${d1} ${d2} ${d3}`);
    const [ok, dOk] = await timed('correct horse battery');
    assert.equal(ok, 200);
    assert.ok(dOk < d3, `the right passphrase (${dOk} ms) is not stalled like a capped wrong try (${d3} ms)`);
  } finally { await srv.cleanup(); }
});

test('teacher logins still honour the per-IP limit', async () => {
  const srv = await boot({ limits: { ip: 3, failDelayStepMs: 1 } });
  try {
    await srv.client().post('/api/setup', { username: 'teacher', passphrase: 'correct horse battery' });
    const attempt = (secret, ip) => srv.client().post('/api/login', { username: 'teacher', secret }, cf(ip));
    for (let i = 0; i < 3; i++) assert.equal((await attempt(WRONG, '203.0.113.5')).status, 401);
    assert.equal((await attempt('correct horse battery', '203.0.113.5')).status, 429);
    assert.equal((await attempt('correct horse battery', '203.0.113.6')).status, 200);
  } finally { await srv.cleanup(); }
});

test('teacher passphrase needs 12+ characters at setup and on change; a change ends other sessions and is logged', async () => {
  const srv = await boot({ limits: { failDelayStepMs: 1 } });
  try {
    const t = srv.client();
    assert.equal((await t.post('/api/setup', { username: 'teacher', passphrase: 'elevenchars' })).status, 400);
    assert.equal((await t.post('/api/setup', { username: 'teacher', passphrase: 'twelve chars' })).status, 200);
    const second = srv.client();
    await second.post('/api/login', { username: 'teacher', secret: 'twelve chars' });
    assert.equal((await t.post('/api/teach/passphrase', { current: 'twelve chars', next: 'short one' })).status, 400);
    assert.equal((await t.post('/api/teach/passphrase', { current: 'wrong wrong wrong', next: 'a much longer passphrase' })).status, 401);
    assert.equal((await t.post('/api/teach/passphrase', { current: {}, next: 'a much longer passphrase' })).status, 400);
    assert.equal((await t.post('/api/teach/passphrase', { current: 'twelve chars', next: 'a much longer passphrase' })).status, 200);
    assert.equal((await t.get('/api/me')).json.user.role, 'teacher');          // this session continues
    assert.equal((await second.get('/api/me')).json.user, null);                // the other one is ended
    assert.equal((await srv.client().post('/api/login', { username: 'teacher', secret: 'twelve chars' })).status, 401);
    assert.equal((await srv.client().post('/api/login', { username: 'teacher', secret: 'a much longer passphrase' })).status, 200);
    assert.equal(srv.app.db.prepare("SELECT COUNT(*) AS n FROM audit_log WHERE action = 'passphrase.change'").get().n, 1);
    const { students } = await (async () => { const c = (await t.post('/api/teach/classes', { name: 'B', course: 'fintech10' })).json; const st = (await t.post(`/api/teach/classes/${c.id}/students`, { count: 1 })).json.students[0]; const sc = srv.client(); await sc.post('/api/login', { username: st.username, secret: st.pin }); return { students: [sc] }; })();
    assert.equal((await students[0].post('/api/teach/passphrase', { current: 'x', next: 'a much longer passphrase' })).status, 403);
  } finally { await srv.cleanup(); }
});
