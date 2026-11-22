import test from 'node:test';
import assert from 'node:assert/strict';
import { boot, seeded } from './helpers.js';

// Holds every authenticate() result until release() is called, so a test can change the secret between "verified" and "session started".
function holdAuth(srv) {
  const real = srv.app.players.authenticate.bind(srv.app.players);
  let gate = null;
  srv.app.players.authenticate = async (...a) => {
    const user = await real(...a);
    const g = gate;
    if (g) { gate = null; g.reached(); await g.wait; }
    return user;
  };
  return () => {                                                         // arm the gate for the next authenticate() call
    let release; let reached;
    const reachedP = new Promise((r) => { reached = r; });
    gate = { wait: new Promise((r) => { release = r; }), reached };
    return { reached: reachedP, release };
  };
}

test('login race: a PIN reset between the scrypt check and the session start gives 401, 20 of 20 runs, and no session survives', async () => {
  const srv = await boot();
  try {
    const { teacher, students: [s] } = await seeded(srv, 1);
    const arm = holdAuth(srv);
    let pin = s.pin;
    const sessionsOf = () => srv.app.db.prepare('SELECT COUNT(*) AS n FROM sessions WHERE player_id = ?').get(s.id).n;
    for (let run = 0; run < 20; run++) {
      const h = arm();
      const login = srv.client().post('/api/login', { username: s.username, secret: pin });
      await h.reached;                                                   // the old PIN has been verified; the session is not started yet
      const reset = await teacher.post(`/api/teach/players/${s.id}/reset-pin`, {});
      assert.equal(reset.status, 200);
      h.release();
      const r = await login;
      assert.equal(r.status, 401, `run ${run}`);
      assert.equal(sessionsOf(), 0, `run ${run}: no session may exist for the old PIN`);
      pin = reset.json.students[0].pin;
    }
    assert.equal((await srv.client().post('/api/login', { username: s.username, secret: pin })).status, 200);   // the new PIN works
  } finally { await srv.cleanup(); }
});

test('passphrase change race: a change authorised by the old passphrase is refused (401) if it was changed meanwhile', async () => {
  const srv = await boot({ limits: { failDelayStepMs: 1 } });
  try {
    const t1 = srv.client();
    await t1.post('/api/setup', { username: 'teacher', passphrase: 'first passphrase here' });
    const t2 = srv.client();
    await t2.post('/api/login', { username: 'teacher', secret: 'first passphrase here' });
    const arm = holdAuth(srv);
    const h = arm();
    const slow = t1.post('/api/teach/passphrase', { current: 'first passphrase here', next: 'slow change of passphrase' });
    await h.reached;
    assert.equal((await t2.post('/api/teach/passphrase', { current: 'first passphrase here', next: 'fast change of passphrase' })).status, 200);
    h.release();
    assert.equal((await slow).status, 401);
    assert.equal((await srv.client().post('/api/login', { username: 'teacher', secret: 'fast change of passphrase' })).status, 200);
    assert.equal((await srv.client().post('/api/login', { username: 'teacher', secret: 'slow change of passphrase' })).status, 401);
  } finally { await srv.cleanup(); }
});

test('logout is public and idempotent: no cookie, a revoked session and a repeat all give 200 and clear the cookie', async () => {
  const srv = await boot();
  try {
    const { students: [s] } = await seeded(srv, 1);
    const anon = srv.client();
    const r0 = await anon.post('/api/logout');
    assert.equal(r0.status, 200);
    assert.match(r0.headers.get('set-cookie'), /sid=; Max-Age=0/);
    assert.equal((await s.client.post('/api/logout')).status, 200);
    const again = await s.client.post('/api/logout');                    // the session is already gone
    assert.equal(again.status, 200);
    assert.match(again.headers.get('set-cookie'), /sid=; Max-Age=0/);
    assert.equal((await srv.client().post('/api/logout', {}, { cookie: 'sid=notasession' })).status, 200);
  } finally { await srv.cleanup(); }
});
