import test from 'node:test';
import assert from 'node:assert/strict';
import { start } from '../server.js';
import { sha } from '../lib/players.js';
import { boot, bareApp, seeded, openStream, tmpDir, fetchEventSource, noTransferLimit } from './helpers.js';
import { createClientSync } from '../public/sync.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (fn, ms = 3000) => { const end = Date.now() + ms; while (Date.now() < end) { if (await fn()) return true; await sleep(10); } return false; };

// ---- session.revoked payloads (the Step 3 verification gaps) ----

test('session.revoked payloads: endSession and purgeSessions carry tokenHash, setPassphrase and resetPin carry the player only', async () => {
  const { app, cls, cleanup } = await bareApp();
  try {
    const seen = [];
    app.events.on('session.revoked', (p) => seen.push(p));
    const teacher = await app.players.createTeacher({ username: 'teacher', passphrase: 'twelve chars' });
    const [s] = await app.players.createStudents({ classId: cls.id, count: 1 });

    const t1 = app.players.startSession(teacher, 1);
    app.players.endSession(t1);
    assert.deepEqual(seen.splice(0), [{ playerId: teacher, tokenHash: sha(t1) }]);
    app.players.endSession('no-such-token');                              // nothing to revoke, nothing emitted
    assert.deepEqual(seen, []);

    await app.players.setPassphrase(teacher, 'another twelve chars');
    assert.deepEqual(seen.splice(0), [{ playerId: teacher }]);
    await app.players.resetPin(s.id);
    assert.deepEqual(seen.splice(0), [{ playerId: s.id }]);

    const old1 = app.players.startSession(s.id, -1);                      // already expired
    const old2 = app.players.startSession(teacher, -1);
    const live = app.players.startSession(teacher, 1);
    app.players.purgeSessions();
    assert.deepEqual(seen.sort((a, b) => a.playerId - b.playerId), [{ playerId: teacher, tokenHash: sha(old2) }, { playerId: s.id, tokenHash: sha(old1) }].sort((a, b) => a.playerId - b.playerId));
    assert.ok(app.players.sessionUser(live));                              // the unexpired one survived
    seen.length = 0;
    app.players.purgeSessions();                                           // nothing left to purge: silent
    assert.deepEqual(seen, []);
  } finally { cleanup(); }
});

test('module.bank-basic.settings carries { classId }, once per save', async () => {
  const srv = await boot();
  try {
    const { teacher, cls } = await seeded(srv, 1, { transfers: false });
    const seen = [];
    srv.app.events.on('module.bank-basic.settings', (p) => seen.push(p));
    assert.equal((await teacher.post('/api/bank-basic/settings', { class_id: cls.id, enabled: true, per_transfer_cents: 500, daily_cents: 1000 })).status, 200);
    assert.deepEqual(seen, [{ classId: cls.id }]);
  } finally { await srv.cleanup(); }
});

// ---- streams close when their session ends ----

test('a logged-out student stream is closed by the server, and so is a PIN-reset one, within one event', async () => {
  const srv = await boot();
  try {
    const { teacher, students: [a, b] } = await seeded(srv, 2);
    const [sa, sb] = await Promise.all([openStream(srv, a.client), openStream(srv, b.client)]);
    assert.equal(await sa.ended(150), false);                              // open streams stay open
    await a.client.post('/api/logout');
    assert.equal(await sa.ended(), true);
    assert.equal(await sb.ended(150), false);
    assert.equal((await teacher.post(`/api/teach/players/${b.id}/reset-pin`, {})).status, 200);
    assert.equal(await sb.ended(), true);
    assert.equal((await srv.client().get('/api/stream', { cookie: a.client.cookie() })).status, 401);   // and a reconnect is refused
  } finally { await srv.cleanup(); }
});

test('a passphrase change closes every stream of that player, the changing session\'s included (the page reopens one on its next resync)', async () => {
  const srv = await boot({ limits: { failDelayStepMs: 1 } });
  try {
    const t1 = srv.client();
    await t1.post('/api/setup', { username: 'teacher', passphrase: 'twelve chars' });
    const t2 = srv.client();
    await t2.post('/api/login', { username: 'teacher', secret: 'twelve chars' });
    const [s1, s2] = await Promise.all([openStream(srv, t1), openStream(srv, t2)]);
    assert.equal((await t1.post('/api/teach/passphrase', { current: 'twelve chars', next: 'a much longer passphrase' })).status, 200);
    assert.equal(await s1.ended(), true);
    assert.equal(await s2.ended(), true);
  } finally { await srv.cleanup(); }
});

test('the teacher ledger hint is throttled: several rapid transfers give fewer hints than transfers', async () => {
  const srv = await boot(noTransferLimit());
  try {
    const { teacher, students: [a, b] } = await seeded(srv, 2);
    const ts = await openStream(srv, teacher);
    const N = 6;
    for (let i = 0; i < N; i++) assert.equal((await a.client.post('/api/bank-basic/transfer', { to: b.username, cents: 100 })).status, 200);
    await sleep(900);                                                      // let the trailing 500 ms hint fire
    const hints = ts.events.filter((e) => e.event === 'ledger').length;
    assert.ok(hints >= 1 && hints < N, `${hints} ledger hints for ${N} transfers`);
    ts.close();
  } finally { await srv.cleanup(); }
});

// ---- the client logic against a real server ----

test('client sync: a server restart on the same data dir leads to a refetch; a PIN reset leads to the login view, and a later login reconnects', async () => {
  const dataDir = tmpDir();
  let srv = await start({ port: 0, dataDir, openSetup: true });
  const port = srv.port;
  const base = `http://127.0.0.1:${port}`;
  const mk = () => {
    let cookie = '';
    return {
      cookie: () => cookie,
      async call(method, p, body) {
        const res = await fetch(base + p, { method, headers: { 'Content-Type': 'application/json', ...(cookie ? { cookie } : {}) }, body: body ? JSON.stringify(body) : undefined });
        const set = res.headers.get('set-cookie');
        if (set) cookie = set.split(';')[0];
        return { status: res.status, json: await res.json().catch(() => null) };
      },
    };
  };
  try {
    const teacher = mk();
    await teacher.call('POST', '/api/setup', { username: 'teacher', passphrase: 'correct horse battery' });
    const cls = (await teacher.call('POST', '/api/teach/classes', { name: 'B1', course: 'fintech10' })).json;
    const [stu] = (await teacher.call('POST', `/api/teach/classes/${cls.id}/students`, { count: 1 })).json.students;
    const page = mk();                                                     // the student's browser
    assert.equal((await page.call('POST', '/api/login', { username: stu.username, secret: stu.pin })).status, 200);
    const studentId = (await page.call('GET', '/api/me')).json.user.id;

    const drawn = [];
    let fetches = 0;
    const live = createClientSync({
      fetchMe: async () => { fetches++; return (await page.call('GET', '/api/me')).json; },
      show: (me) => drawn.push(me.user?.username ?? null),
      EventSource: fetchEventSource(base, page.cookie, 30),
      eventNames: ['balance', 'month'],
    });
    await live.sync();
    assert.deepEqual(drawn, [stu.username]);
    assert.ok(await until(() => fetches >= 2), 'opening the stream refetches');

    // restart: same data dir, same port. The stream drops, the client reconnects by itself and refetches on open.
    const before = fetches;
    await srv.close();
    await sleep(100);
    srv = await start({ port, dataDir, openSetup: true });
    assert.ok(await until(() => fetches > before), 'reconnect after a restart refetches');
    assert.equal(live.connected, true);
    assert.deepEqual(drawn, [stu.username]);                               // same user: no full redraw

    // the teacher resets the PIN: the server ends the stream, the reconnect gets 401, the page falls back to the login view
    const reset = (await teacher.call('POST', `/api/teach/players/${studentId}/reset-pin`, {}));
    assert.equal(reset.status, 200);
    assert.ok(await until(() => drawn.at(-1) === null), 'login view after the session is gone');
    assert.equal(live.connected, false);

    // logging in again (the login form then calls sync()) reconnects without a reload
    const newPin = reset.json.students[0].pin;
    assert.equal((await page.call('POST', '/api/login', { username: stu.username, secret: newPin })).status, 200);
    await live.sync();
    assert.deepEqual(drawn, [stu.username, null, stu.username]);
    assert.equal(live.connected, true);
    live.disconnect();
  } finally { await srv.close().catch(() => {}); }
});
