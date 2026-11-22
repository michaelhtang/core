import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { boot, tmpDir, seeded } from './helpers.js';
import { createApp, ROOT } from '../lib/app.js';
import { openDb, migrate } from '../lib/db.js';

test('a throwing timer body is logged, not thrown', async () => {
  const srv = await boot();
  const err = mock.method(console, 'error', () => {});
  try {
    srv.app.players.purgeSessions = () => { throw new Error('boom'); };
    assert.doesNotThrow(() => srv.ticks.purgeSessions());
    assert.equal(err.mock.calls.length, 1);
    assert.doesNotThrow(() => { srv.ticks.ping(); srv.ticks.sweep(); });
  } finally { err.mock.restore(); await srv.cleanup(); }
});

test('two createApp on one data dir at the same time both succeed', async () => {
  const dir = tmpDir();
  const [a, b] = await Promise.all([createApp({ dataDir: dir }), createApp({ dataDir: dir })]);
  const n = (app) => app.db.prepare('SELECT COUNT(*) AS n FROM schema_migrations').get().n;
  assert.equal(n(a), n(b));
  a.db.close(); b.db.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

test('migrate() adds the checksum column to old databases and warns only on real drift', () => {
  const dir = tmpDir();
  const db = openDb(`${dir}/m.db`);
  db.exec("CREATE TABLE schema_migrations (id TEXT PRIMARY KEY, applied INTEGER NOT NULL); INSERT INTO schema_migrations VALUES ('x/001', 1)");
  const warn = mock.method(console, 'warn', () => {});
  try {
    migrate(db, [{ id: 'x/001', sql: 'SELECT 1' }, { id: 'x/002', sql: 'CREATE TABLE t (a)' }]);
    assert.equal(warn.mock.calls.length, 0);                                     // NULL checksum = unknown, no warning
    assert.equal(db.prepare("SELECT checksum FROM schema_migrations WHERE id = 'x/001'").get().checksum, null);
    assert.equal(db.prepare("SELECT length(checksum) AS n FROM schema_migrations WHERE id = 'x/002'").get().n, 64);
    migrate(db, [{ id: 'x/002', sql: 'CREATE TABLE t (b)' }]);                   // drift: warn, do not fail
    assert.equal(warn.mock.calls.length, 1);
  } finally { warn.mock.restore(); db.close(); fs.rmSync(dir, { recursive: true, force: true }); }
});

test('static files come from memory: gzip when accepted, per-encoding ETags, 304, Vary', async () => {
  const srv = await boot();
  try {
    const gz = await fetch(`${srv.base}/theme.css`, { headers: { 'accept-encoding': 'gzip' } });
    assert.equal(gz.headers.get('content-encoding'), 'gzip');
    assert.equal(gz.headers.get('vary'), 'Accept-Encoding');
    const css = await gz.text();
    const plain = await fetch(`${srv.base}/theme.css`, { headers: { 'accept-encoding': 'identity' } });
    assert.equal(plain.headers.get('content-encoding'), null);
    assert.equal(await plain.text(), css);
    assert.notEqual(plain.headers.get('etag'), gz.headers.get('etag'));
    for (const r of [gz, plain]) {
      const enc = r === gz ? 'gzip' : 'identity';
      const again = await fetch(`${srv.base}/theme.css`, { headers: { 'accept-encoding': enc, 'if-none-match': r.headers.get('etag') } });
      assert.equal(again.status, 304);
    }
    assert.equal((await fetch(`${srv.base}/fonts/Barlow-600.woff2`, { headers: { 'accept-encoding': 'gzip' } })).headers.get('content-encoding'), null);
    assert.equal((await fetch(`${srv.base}/..%2fserver.js`)).status, 404);
    assert.equal((await fetch(`${srv.base}/m/bank-basic/..%2findex.js`)).status, 404);
  } finally { await srv.cleanup(); }
});

test('two advances carrying the same `from` give one 200 and one 409', async () => {
  const srv = await boot();
  try {
    const { teacher } = await seeded(srv, 1);
    const from = (await teacher.get('/api/teach/state')).json.world.month;
    const rs = await Promise.all([teacher.post('/api/teach/world/advance', { from }), teacher.post('/api/teach/world/advance', { from })]);
    assert.deepEqual(rs.map((r) => r.status).sort(), [200, 409]);
    assert.equal((await teacher.get('/api/teach/state')).json.world.month, from + 1);
    assert.equal((await teacher.post('/api/teach/world/advance', {})).status, 200);   // `from` stays optional
  } finally { await srv.cleanup(); }
});

test("a course called 'constructor' is an unknown course", async () => {
  const srv = await boot();
  try {
    const { teacher } = await seeded(srv, 1);
    for (const course of ['constructor', '__proto__', 'toString']) assert.equal((await teacher.post('/api/teach/classes', { name: 'X', course })).status, 400);
  } finally { await srv.cleanup(); }
});

const rawPost = (srv, p, chunks, headers = {}) => new Promise((resolve, reject) => {
  const req = http.request({ port: srv.port, host: '127.0.0.1', path: p, method: 'POST', headers: { 'Content-Type': 'application/json', ...headers } }, (res) => {
    let data = '';
    res.on('data', (c) => { data += c; });
    res.on('end', () => resolve({ status: res.statusCode, json: JSON.parse(data || 'null') }));
  });
  req.on('error', reject);
  (async () => { for (const c of chunks) { req.write(c); await new Promise((r) => setTimeout(r, 40)); } req.end(); })();
});

test('a multibyte UTF-8 character split across two writes round-trips', async () => {
  const srv = await boot();
  try {
    const passphrase = 'pässphräse-€-ok-12';
    const bytes = Buffer.from(JSON.stringify({ username: 'teacher', passphrase }));
    const cut = bytes.indexOf(0xc3) + 1;                                               // between the two bytes of 'ä'
    assert.equal((await rawPost(srv, '/api/setup', [bytes.subarray(0, cut), bytes.subarray(cut)])).status, 200);
    assert.equal((await srv.client().post('/api/login', { username: 'teacher', secret: passphrase })).status, 200);
  } finally { await srv.cleanup(); }
});

test('a body whose Content-Length is over 100 kB is refused as 413 before it is read', async () => {
  const srv = await boot();
  try {
    assert.equal((await rawPost(srv, '/api/login', [], { 'Content-Length': '200000' })).status, 413);
  } finally { await srv.cleanup(); }
});

test('a module hook gets the player without pin_hash', async () => {
  const modulesDir = path.join(ROOT, 'test', 'fixtures', 'modules');
  const config = { ...JSON.parse(fs.readFileSync(path.join(ROOT, 'config', 'vdaa.json'), 'utf8')), courses: { fintech10: { label: 'Stub', modules: ['stub'] } } };
  const srv = await boot({ config, modulesDir });
  try {
    await seeded(srv, 1, { transfers: false });
    const { seen } = await import(path.join(modulesDir, 'stub', 'index.js'));
    assert.ok(seen.length >= 1);
    for (const p of seen) assert.deepEqual(Object.keys(p).sort(), ['class_id', 'id', 'role', 'username']);
  } finally { await srv.cleanup(); }
});
