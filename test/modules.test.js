// Module contract v2 (docs/modules.md section 7). Fixture modules live in test/fixtures/modules; a test assembles the modules
// directory it needs (symlinks to real modules and fixtures, plus modules written from source) and boots it through createApp/start.
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { ROOT, createApp } from '../lib/app.js';
import { defineModule } from '../lib/modules.js';
import { openDb, migrate, coreMigrations } from '../lib/db.js';
import { boot, seeded, tmpDir } from './helpers.js';

const FIXTURES = path.join(ROOT, 'test', 'fixtures', 'modules');
const MODULES_URL = pathToFileURL(path.join(ROOT, 'lib', 'modules.js')).href;
const made = [];
after(() => { for (const d of made) fs.rmSync(d, { recursive: true, force: true }); });
const dir = () => { const d = tmpDir(); made.push(d); return d; };

// link: ids of real modules or fixtures to symlink in; src: { id: source text } written as modules/<id>/index.js.
function modulesDir({ link = [], src = {} } = {}) {
  const d = dir();
  for (const id of link) fs.symlinkSync(fs.existsSync(path.join(ROOT, 'modules', id)) ? path.join(ROOT, 'modules', id) : path.join(FIXTURES, id), path.join(d, id));
  for (const [id, code] of Object.entries(src)) {
    fs.mkdirSync(path.join(d, id));
    fs.writeFileSync(path.join(d, id, 'index.js'), `import { defineModule } from '${MODULES_URL}';\n${code}`);
  }
  return d;
}
const cfg = (courses, options = { 'bank-basic': { startCents: 50000, transfersPer10Min: 1e6 } }) =>
  ({ courses: Object.fromEntries(Object.entries(courses).map(([c, modules]) => [c, { label: c, modules }])), options });
const mod = (id, extra = '') => `export default defineModule({ id: '${id}', ${extra} });`;
const bootFails = (config, modulesDir, message) => assert.rejects(createApp({ dataDir: dir(), config, modulesDir }), message);

// ---------- 1. shape rules ----------

test('every shape rule fails with a message naming the module and the field', () => {
  const ok = { id: 'm1' };
  const route = { method: 'GET', path: '/x', access: 'student', handler() {} };
  const panel = { id: 'p', building: { key: 'shop', name: 'Shop', icon: 'job' }, src: 'p.js' };
  const mig = { id: '001_a', sql: 'SELECT 1' };
  const cases = [
    [{ id: 'Bad' }, 'module "Bad": id: must match /^[a-z][a-z0-9-]{1,30}$/'],
    [{ id: 'a' }, 'module "a": id: must match /^[a-z][a-z0-9-]{1,30}$/'],
    [{}, 'module "?": id: must match /^[a-z][a-z0-9-]{1,30}$/'],
    [{ ...ok, route: [] }, 'module "m1": route: unknown field'],
    [{ ...ok, requires: 'bank-basic' }, 'module "m1": requires: must be an array'],
    [{ ...ok, requires: ['Bank'] }, 'module "m1": requires[0]: must be a module id'],
    [{ ...ok, migrations: ['CREATE TABLE x (a)'] }, 'module "m1": migrations[0]: must be an object'],
    [{ ...ok, migrations: [{ id: '1_a', sql: 'SELECT 1' }] }, 'module "m1": migrations[0].id: must look like 001_name (/^\\d{3}_[a-z0-9_]+$/)'],
    [{ ...ok, migrations: [{ id: '001_a' }] }, 'module "m1": migrations[0].sql: must be a non-empty string'],
    [{ ...ok, migrations: [mig, { ...mig, sql: 'SELECT 2' }] }, 'module "m1": migrations[1].id: duplicate migration "001_a"'],
    [{ ...ok, routes: [{ ...route, method: 'PUT' }] }, 'module "m1": routes[0].method: must be GET or POST'],
    [{ ...ok, routes: [{ ...route, path: 'x' }] }, /^module "m1": routes\[0\]\.path: /],
    [{ ...ok, routes: [{ ...route, path: '/a.*' }] }, /^module "m1": routes\[0\]\.path: /],
    [{ ...ok, routes: [{ ...route, path: '/a/(b|c)' }] }, /^module "m1": routes\[0\]\.path: /],
    [{ ...ok, routes: [{ ...route, path: '/a/:' }] }, /^module "m1": routes\[0\]\.path: /],
    [{ ...ok, routes: [{ ...route, access: undefined }] }, 'module "m1": routes[0].access: is required: one of student | teacher | any | public'],
    [{ ...ok, routes: [{ ...route, access: 'everyone' }] }, 'module "m1": routes[0].access: is required: one of student | teacher | any | public'],
    [{ ...ok, routes: [{ ...route, handler: 'nope' }] }, 'module "m1": routes[0].handler: must be a function'],
    [{ ...ok, routes: [route, route] }, 'module "m1": routes[1]: duplicate route GET /x'],
    [{ ...ok, panels: [{ ...panel, building: undefined }] }, 'module "m1": panels[0].building: must be an object'],
    [{ ...ok, panels: [{ ...panel, building: { ...panel.building, key: 'Shop Door' } }] }, /^module "m1": panels\[0\]\.building\.key: /],
    [{ ...ok, panels: [{ ...panel, building: { ...panel.building, name: '' } }] }, 'module "m1": panels[0].building.name: must be a non-empty string'],
    [{ ...ok, panels: [{ ...panel, building: { ...panel.building, icon: 'Not An Icon' } }] }, /^module "m1": panels\[0\]\.building\.icon: /],
    [{ ...ok, panels: [{ ...panel, building: { ...panel.building, icon: '<svg onload="x()"></svg>' } }] }, /^module "m1": panels\[0\]\.building\.icon: /],
    [{ ...ok, panels: [{ ...panel, building: { ...panel.building, icon: '<svg><script>x()</script></svg>' } }] }, /^module "m1": panels\[0\]\.building\.icon: /],
    [{ ...ok, panels: [{ ...panel, src: '../x.js' }] }, 'module "m1": panels[0].src: must be a file name under modules/<id>/ui/'],
    [{ ...ok, teacherPanels: [{ id: 't', src: 't.js' }] }, 'module "m1": teacherPanels[0].title: must be a non-empty string'],
    [{ ...ok, onTick: 'x' }, 'module "m1": onTick: must be a function'],
    [{ ...ok, onLogin: {} }, 'module "m1": onLogin: must be a function'],
    [{ ...ok, events: { 'ledger.posted': 1 } }, 'module "m1": events.ledger.posted: must be a function'],
    [{ ...ok, events: [] }, 'module "m1": events: must be an object'],
    [{ ...ok, needs: 'world.setPace' }, 'module "m1": needs: must be an array'],
    [{ ...ok, needs: ['world.setSettings'] }, 'module "m1": needs[0]: must be one of world.setPace'],
  ];
  for (const [spec, want] of cases) {
    assert.throws(() => defineModule(spec), (e) => (want instanceof RegExp ? want.test(e.message) : e.message === want), JSON.stringify(spec).slice(0, 80));
  }
  const good = defineModule({ ...ok, routes: [route], panels: [panel, { ...panel, id: 'q', building: { ...panel.building, key: 'other', icon: '<svg viewBox="0 0 1 1"><path d="M0 0"/></svg>' } }] });
  assert.ok(Object.isFrozen(good) && Object.isFrozen(good.routes) && Object.isFrozen(good.panels[0].building));
});

test('boot refuses: v1 exports, a default that is not defineModule, an id that is not the folder name, a missing file, a reserved id, a duplicate door', async () => {
  const bad = (src, config) => createApp({ dataDir: dir(), config: config ?? cfg({ fintech10: [Object.keys(src)[0]] }), modulesDir: modulesDir({ src }) });
  await assert.rejects(bad({ old: 'export const id = "old"; export const routes = []; export const panels = [];' }), /module "old": uses the v1 export shape \(export id, routes, panels\).*docs\/modules\.md/);
  await assert.rejects(bad({ plain: 'export default { id: "plain" };' }), /module "plain": default export must be the result of defineModule\(\)/);
  await assert.rejects(bad({ 'folder-a': mod('other') }), /module "folder-a": id: "other" must equal the folder name/);
  await assert.rejects(bad({}, cfg({ fintech10: ['ghost'] })), /module "ghost": no such file/);
  await assert.rejects(bad({ teach: mod('teach') }), /module "teach": id: reserved by core/);
  const door = (id) => mod(id, `panels: [{ id: 'p', building: { key: 'same', name: 'Same', icon: 'job' }, src: 'p.js' }]`);
  await assert.rejects(bad({ d1: door('d1'), d2: door('d2') }, cfg({ fintech10: ['d1', 'd2'] })), /module "d2": panels\[0\]\.building\.key: "same" is already used by module "d1"/);
});

// ---------- 2. requires ----------

test('requires: dependencies load first (migrations too); a missing dependency or a cycle fails boot naming the modules', async () => {
  const mig = (n) => `migrations: [{ id: '001_t', sql: 'CREATE TABLE t_${n} (a)' }]`;
  const src = { 'ma': mod('ma', `requires: ['mb'], ${mig('a')}`), 'mb': mod('mb', `requires: ['mc'], ${mig('b')}`), 'mc': mod('mc', mig('c')) };
  const app = await createApp({ dataDir: dir(), config: cfg({ fintech10: ['ma', 'mb', 'mc'] }), modulesDir: modulesDir({ src }) });
  assert.deepEqual(app.modules.ids, ['mc', 'mb', 'ma']);
  assert.deepEqual(app.db.prepare("SELECT id FROM schema_migrations WHERE id LIKE 'mod:%' ORDER BY rowid").all().map((r) => r.id), ['mod:mc:001_t', 'mod:mb:001_t', 'mod:ma:001_t']);
  app.db.close();

  await bootFails(cfg({ fintech10: ['ma'] }), modulesDir({ src }), /module "ma": requires: "mb" is not loaded/);
  const loop = { xx: mod('xx', `requires: ['yy']`), yy: mod('yy', `requires: ['xx']`) };
  await bootFails(cfg({ fintech10: ['xx', 'yy'] }), modulesDir({ src: loop }), /module "xx": requires: dependency cycle xx -> yy -> xx/);
  await bootFails(cfg({ fintech10: ['xx'] }), modulesDir({ src: { xx: mod('xx', `requires: ['xx']`) } }), /dependency cycle xx -> xx/);
});

// ---------- 3. migrations by name ----------

test('migrations are keyed by name: an added one runs alone, an edited one only warns, a duplicate name fails boot', async (t) => {
  const dataDir = dir();
  const mods = (...items) => modulesDir({ src: { mm: mod('mm', `migrations: ${JSON.stringify(items.map(([id, sql]) => ({ id, sql })))}`) } });
  const a = ['001_a', 'CREATE TABLE ma (x)'];
  const b = ['002_b', 'CREATE TABLE mb (x)'];
  const open = async (d) => createApp({ dataDir, config: cfg({ fintech10: ['mm'] }), modulesDir: d });
  const names = (app) => app.db.prepare("SELECT id FROM schema_migrations WHERE id LIKE 'mod:mm:%' ORDER BY rowid").all().map((r) => r.id);

  let app = await open(mods(a, b));
  assert.deepEqual(names(app), ['mod:mm:001_a', 'mod:mm:002_b']);
  app.db.close();

  app = await open(mods(a, b, ['003_c', 'CREATE TABLE mc (x)']));          // 001 and 002 would fail if they ran again: the tables exist
  assert.deepEqual(names(app), ['mod:mm:001_a', 'mod:mm:002_b', 'mod:mm:003_c']);
  app.db.prepare('SELECT * FROM mc').all();
  app.db.close();

  const warn = t.mock.method(console, 'warn', () => {});
  app = await open(mods(a, ['002_b', 'CREATE TABLE mb (x, y)'], ['003_c', 'CREATE TABLE mc (x)']));
  assert.ok(warn.mock.calls.some((c) => /migration mod:mm:002_b changed since it was applied/.test(c.arguments[0])));
  assert.deepEqual(app.db.prepare("SELECT name FROM pragma_table_info('mb')").all().map((r) => r.name), ['x']);   // not re-run
  assert.deepEqual(names(app), ['mod:mm:001_a', 'mod:mm:002_b', 'mod:mm:003_c']);
  app.db.close();

  await bootFails(cfg({ fintech10: ['mm'] }), mods(a, ['001_a', 'SELECT 2']), /module "mm": migrations\[1\]\.id: duplicate migration "001_a"$/);
});

// ---------- 4. access ----------

test('a route without access fails boot', async () => {
  const src = { rr: mod('rr', `routes: [{ method: 'GET', path: '/x', handler() { return {}; } }]`) };
  await bootFails(cfg({ fintech10: ['rr'] }), modulesDir({ src }), /module "rr": routes\[0\]\.access: is required/);
});

// One server with bank-basic + stub-jobs for fintech10 and bank-basic only for fintech2030.
async function jobsServer() {
  const config = cfg({ fintech10: ['bank-basic', 'stub-jobs'], fintech2030: ['bank-basic'] });
  const srv = await boot({ config, modulesDir: modulesDir({ link: ['bank-basic', 'stub-jobs'] }) });
  const { teacher, cls, students } = await seeded(srv, 2, { transfers: false });
  const other = (await teacher.post('/api/teach/classes', { name: 'Block 9', course: 'fintech2030' })).json;
  const made = (await teacher.post(`/api/teach/classes/${other.id}/students`, { count: 1 })).json.students[0];
  const stranger = srv.client();
  assert.equal((await stranger.post('/api/login', { username: made.username, secret: made.pin })).status, 200);
  return { srv, teacher, cls, other, students, stranger, made };
}

test('access: teacher routes are 403 for students; student routes need the module on the student\'s course; any needs a login; public needs nothing; handlers get a sanitized user', async () => {
  const { srv, teacher, students: [a], stranger } = await jobsServer();
  try {
    assert.equal((await a.client.get('/api/stub-jobs/admin')).status, 403);
    assert.equal((await teacher.get('/api/stub-jobs/admin')).status, 200);
    assert.equal((await a.client.get('/api/stub-jobs/offers')).status, 200);
    assert.equal((await teacher.get('/api/stub-jobs/offers')).status, 403);          // student-only
    assert.equal((await stranger.get('/api/stub-jobs/offers')).status, 404);         // fintech2030 does not enable the module
    assert.equal((await stranger.get('/api/stub-jobs/whoami')).status, 404);
    assert.equal((await srv.client().get('/api/stub-jobs/whoami')).status, 401);
    const me = (await a.client.get('/api/stub-jobs/whoami')).json.user;
    assert.deepEqual(Object.keys(me).sort(), ['class_id', 'id', 'role', 'username', 'world_teacher']);
    assert.equal((await teacher.get('/api/stub-jobs/whoami')).json.user.role, 'teacher');
    assert.equal((await srv.client().get('/api/stub-jobs/ping')).status, 200);
  } finally { await srv.cleanup(); }
});

// ---------- 5. ledger namespacing ----------

test('ledger wrapper: bare kinds are prefixed, dotted or missing kinds refused, other modules\' txns cannot be reversed; a jobs transfer is not a bank transfer', async () => {
  const { srv, teacher, students: [a, b] } = await jobsServer();
  try {
    const jobs = srv.app.modules.kernel('stub-jobs');
    const bank = srv.app.modules.kernel('bank-basic');
    const [from, to] = [a.chequing.id, b.chequing.id];
    const legs = [{ account: from, cents: -100 }, { account: to, cents: 100 }];
    for (const kind of ['bank-basic.x', 'core.reversal', 'x.y', 'Upper', '', undefined, 7]) {
      assert.throws(() => jobs.ledger.post({ kind, legs }), { name: 'LedgerError', code: 'BAD_KIND' }, String(kind));
    }
    assert.throws(() => jobs.ledger.transfer({ from, to, cents: 100 }), { code: 'BAD_KIND' });            // no default kind
    assert.throws(() => jobs.ledger.sumByKind({ account: from, kind: 'bank-basic.transfer' }), { code: 'BAD_KIND' });
    assert.throws(() => jobs.ledger.txnsByKind({ kind: 'bank-basic.transfer' }), { code: 'BAD_KIND' });
    assert.equal(srv.app.db.prepare("SELECT COUNT(*) AS n FROM txns WHERE kind NOT LIKE 'bank-basic.%'").get().n, 0);   // nothing was posted

    // the bank's cap: a $50/$100 class, and a jobs gift moves money without touching the cap
    await teacher.post('/api/bank-basic/settings', { class_id: a.client && (await a.client.get('/api/me')).json.user.class.id, enabled: true, per_transfer_cents: 5000, daily_cents: 10000 });
    const gift = (await a.client.post('/api/stub-jobs/gift', { to: b.username, cents: 3000 })).json.txn;
    assert.equal(srv.app.db.prepare('SELECT kind FROM txns WHERE id = ?').get(gift).kind, 'stub-jobs.gift');
    assert.equal((await a.client.get('/api/bank-basic/status')).json.sent_24h_cents, 0);
    assert.equal((await a.client.post('/api/bank-basic/transfer', { to: b.username, cents: 5000 })).status, 200);
    assert.equal((await a.client.get('/api/bank-basic/status')).json.sent_24h_cents, 5000);
    assert.equal(jobs.ledger.sumByKind({ account: from, kind: 'gift', dir: 'out' }), 3000);
    assert.equal(bank.ledger.sumByKind({ account: from, kind: 'transfer', dir: 'out' }), 5000);
    assert.deepEqual(jobs.ledger.txnsByKind({ kind: 'gift' }).map((t) => t.id), [gift]);
    assert.deepEqual(bank.ledger.txnsByKind({ kind: 'gift' }), []);

    // reversing: not through the bank's route, not through the bank's kernel; the owner can
    assert.equal((await teacher.post(`/api/bank-basic/transfers/${gift}/reverse`)).status, 404);
    assert.throws(() => bank.ledger.reverse(gift), { name: 'LedgerError', code: 'NOT_REVERSIBLE' });
    assert.throws(() => bank.ledger.reverse(999999), { code: 'NOT_FOUND' });
    const reversal = jobs.ledger.reverse(gift, { actor: 'test' });
    assert.equal(srv.app.db.prepare('SELECT kind FROM txns WHERE id = ?').get(reversal).kind, 'core.reversal');
    assert.throws(() => jobs.ledger.reverse(gift), { code: 'ALREADY_REVERSED', message: 'Already reversed' });
    assert.throws(() => jobs.ledger.reverse(reversal), { code: 'NOT_REVERSIBLE' });                       // a core.reversal belongs to nobody
    assert.throws(() => srv.app.ledger.reverse(reversal), { code: 'NOT_REVERSIBLE', message: 'A reversal cannot be reversed' });
    assert.throws(() => jobs.ledger.transfer({ kind: 'gift', from, to, cents: 1e9 }), { code: 'INSUFFICIENT_FUNDS', message: 'Insufficient funds' });
    assert.throws(() => jobs.ledger.transfer({ kind: 'gift', from, to: 123456, cents: 1 }), { code: 'UNKNOWN_ACCOUNT' });
    assert.throws(() => jobs.ledger.post({ kind: 'gift', legs: [{ account: from, cents: -100 }, { account: to, cents: 99 }] }), { code: 'BAD_LEGS' });
    assert.equal(srv.app.ledger.audit().ok, true);
  } finally { await srv.cleanup(); }
});

// ---------- 6. isolation ----------

test('a throwing onLogin does not block login, and the modules after it still run', async () => {
  const config = cfg({ fintech10: ['stub-badlogin', 'bank-basic'] });
  const srv = await boot({ config, modulesDir: modulesDir({ link: ['bank-basic', 'stub-badlogin'] }) });
  const errors = [];
  const orig = console.error;
  console.error = (...a) => errors.push(a);
  try {
    const { students: [s] } = await seeded(srv, 1, { transfers: false });
    const me = (await s.client.get('/api/me')).json;
    assert.equal(me.accounts.find((x) => x.kind === 'chequing').balance_cents, 50000);   // bank-basic's welcome grant still arrived
    assert.ok(errors.some((e) => e[0] === '[stub-badlogin]' && /onLogin failed/.test(e[1])));
  } finally { console.error = orig; await srv.cleanup(); }
});

test('a throwing onPlayer fails student creation (nothing is left behind); a throwing onTick rolls the advance back; both name the module', async () => {
  const src = {
    badplayer: mod('badplayer', `onPlayer() { throw new Error('nope'); }`),
    badtick: mod('badtick', `onTick() { throw new Error('tick boom'); }`),
  };
  const orig = console.error;
  console.error = () => {};
  try {
    for (const id of ['badplayer', 'badtick']) {
      const app = await createApp({ dataDir: dir(), config: cfg({ fintech10: [id] }), modulesDir: modulesDir({ src }) });
      app.world.create();
      const c = app.players.createClass({ name: 'B', course: 'fintech10' });
      if (id === 'badplayer') {
        await assert.rejects(app.players.createStudents({ classId: c.id, count: 2, hash: false }), /module "badplayer": onPlayer failed: nope/);
        assert.equal(app.db.prepare('SELECT COUNT(*) AS n FROM players').get().n, 0);
      } else {
        assert.throws(() => app.world.advance({ months: 1 }), /module "badtick": onTick failed: tick boom/);
        assert.equal(app.world.current().month, 1);
        assert.equal(app.db.prepare("SELECT COUNT(*) AS n FROM audit_log WHERE action = 'world.advance'").get().n, 0);
      }
      app.db.close();
    }
  } finally { console.error = orig; }
});

test('event listeners get (k, payload); a throwing listener is logged with the module id and never reaches the emitter', async () => {
  const src = {
    evt: `export const seen = [];
export default defineModule({ id: 'evt', events: {
  'class.created': (k, p) => { seen.push([k.id, p.classId]); },
  'players.created': () => { throw new Error('listener boom'); },
} });`,
  };
  const d = modulesDir({ src });
  const app = await createApp({ dataDir: dir(), config: cfg({ fintech10: ['evt'] }), modulesDir: d });
  const errors = [];
  const orig = console.error;
  console.error = (...a) => errors.push(a);
  try {
    app.world.create();
    const c = app.players.createClass({ name: 'B', course: 'fintech10' });
    const students = await app.players.createStudents({ classId: c.id, count: 1, hash: false });   // the failing listener fires after commit
    assert.equal(students.length, 1);
    const { seen } = await import(pathToFileURL(path.join(d, 'evt', 'index.js')));
    assert.deepEqual(seen, [['evt', c.id]]);
    assert.ok(errors.some((e) => e[0] === '[evt]' && /listener for players\.created failed/.test(e[1])));
  } finally { console.error = orig; app.db.close(); }
});

// ---------- 7. the stub-jobs fixture ----------

test('stub-jobs: payday only for its course\'s classes; a door in /api/me in load order; a teacher panel; the module files are served', async () => {
  const { srv, teacher, cls, other, students: [a, b], stranger } = await jobsServer();
  try {
    const me = (await a.client.get('/api/me')).json;
    assert.deepEqual(me.panels.map((p) => [p.module, p.id, p.building]), [
      ['bank-basic', 'bank', { key: 'bank', name: 'Bank', icon: 'bank' }],
      ['stub-jobs', 'jobs', { key: 'job', name: 'Job Centre', icon: 'job' }],
    ]);
    assert.match(me.panels[1].src, /^\/m\/stub-jobs\/jobs\.js\?v=/);
    assert.deepEqual((await stranger.get('/api/me')).json.panels.map((p) => p.id), ['bank']);          // the other course has no Job Centre
    assert.deepEqual((await teacher.get('/api/me')).json.teacherPanels.map((p) => [p.module, p.id, p.title]), [['bank-basic', 'bank-teach', 'Bank'], ['stub-jobs', 'jobs-teach', 'Jobs']]);
    for (const p of [...me.panels, ...(await teacher.get('/api/me')).json.teacherPanels]) {
      const res = await fetch(srv.base + p.src);
      assert.equal(res.status, 200, p.src);
    }

    const bal = async (c) => (await c.get('/api/me')).json.accounts.find((x) => x.kind === 'chequing').balance_cents;
    assert.deepEqual([await bal(a.client), await bal(stranger)], [50000, 50000]);
    assert.equal((await teacher.post('/api/teach/world/advance', { months: 2 })).status, 200);
    assert.deepEqual([await bal(a.client), await bal(b.client), await bal(stranger)], [52000, 52000, 50000]);
    assert.deepEqual(srv.app.db.prepare('SELECT month, from_month, class_id, students FROM stubjobs_ticks ORDER BY month').all().map((r) => ({ ...r })),
      [{ month: 2, from_month: 1, class_id: cls.id, students: 2 }, { month: 3, from_month: 2, class_id: cls.id, students: 2 }]);   // never the fintech2030 class
    assert.equal(srv.app.db.prepare("SELECT COUNT(*) AS n FROM txns WHERE kind = 'stub-jobs.payday'").get().n, 4);
    assert.equal(srv.app.ledger.audit().ok, true);
    assert.ok(other.id);
  } finally { await srv.cleanup(); }
});

test('the kernel facade: frozen config, prefixed audit and events, players read API', async () => {
  const { srv, cls, other, students: [a] } = await jobsServer();
  try {
    const k = srv.app.modules.kernel('bank-basic');
    assert.equal(k.id, 'bank-basic');
    assert.deepEqual({ ...k.config }, { startCents: 50000, transfersPer10Min: 1e6 });
    assert.ok(Object.isFrozen(k) && Object.isFrozen(k.config) && Object.isFrozen(k.ledger));
    assert.equal(typeof k.clock.now(), 'number');
    const heard = [];
    srv.app.events.on('module.bank-basic.hello', (p) => heard.push(p));
    k.events.emit('hello', { x: 1 });
    assert.deepEqual(heard, [{ x: 1 }]);
    k.audit('note', { a: 1 }, 'player:9');
    assert.deepEqual({ ...srv.app.db.prepare("SELECT actor, detail FROM audit_log WHERE action = 'bank-basic.note'").get() }, { actor: 'player:9', detail: '{"a":1}' });

    assert.deepEqual(Object.keys(k.players.get(a.id)).sort(), ['class_id', 'id', 'role', 'username']);
    assert.equal(k.players.student(a.id).username, a.username);
    assert.equal(k.players.student(1), null);                                         // the teacher is not a student
    assert.equal(k.players.get(99999), null);
    assert.deepEqual(k.players.inClass(cls.id).map((p) => Object.keys(p).sort().join()), ['id,username', 'id,username']);
    assert.deepEqual(k.players.classes({ courses: ['fintech2030'] }).map((c) => ({ ...c })), [{ id: other.id, name: 'Block 9', course_id: 'fintech2030' }]);
    assert.equal(k.players.classes().length, 2);
    assert.deepEqual({ ...k.players.classOf(a.id) }, { id: cls.id, name: 'Block 1', course_id: 'fintech10' });
    assert.equal(k.players.classOf(1), null);
    assert.equal(k.world.current().month, 1);
  } finally { await srv.cleanup(); }
});

// ---------- 8. onEnable ----------

test('onEnable runs once per class: backfill at boot, new classes as they are created, never again after a restart', async () => {
  const dataDir = dir();
  const mods = modulesDir({ link: ['bank-basic', 'stub-jobs'] });
  const before = cfg({ fintech10: ['bank-basic'] });
  const after = cfg({ fintech10: ['bank-basic', 'stub-jobs'], fintech2030: ['bank-basic'] });
  const enabled = (app) => app.db.prepare('SELECT class_id FROM stubjobs_enabled ORDER BY class_id').all().map((r) => r.class_id);
  const rows = (app, m) => app.db.prepare('SELECT class_id FROM module_enabled WHERE module_id = ? ORDER BY class_id').all(m).map((r) => r.class_id);

  let app = await createApp({ dataDir, config: before, modulesDir: mods });
  app.world.create();
  const a = app.players.createClass({ name: 'A', course: 'fintech10' }).id;        // existed before the module was switched on
  app.db.close();

  app = await createApp({ dataDir, config: after, modulesDir: mods });
  assert.deepEqual(enabled(app), [a]);                                              // backfilled at boot
  const b = app.players.createClass({ name: 'B', course: 'fintech10' }).id;        // created later: hook runs when the class is created
  app.players.createClass({ name: 'C', course: 'fintech2030' });                    // a course that does not enable it: never
  assert.deepEqual(enabled(app), [a, b]);
  assert.deepEqual(rows(app, 'stub-jobs'), [a, b]);
  app.db.close();

  app = await createApp({ dataDir, config: after, modulesDir: mods });              // restart: nothing runs again (a second insert would throw)
  assert.deepEqual(enabled(app), [a, b]);
  assert.deepEqual(rows(app, 'stub-jobs'), [a, b]);
  app.db.close();
});

test('onEnable: a failure is logged, boot continues, and the class is passed again at the next boot, then recorded', async (t) => {
  const dataDir = dir();
  const mods = modulesDir({ src: { flaky: `export const attempts = [];
export default defineModule({ id: 'flaky', onEnable(k, { classIds }) { attempts.push(classIds); if (attempts.length === 1) throw new Error('first try fails'); } });` } });
  const config = cfg({ fintech10: ['flaky'] });
  t.mock.method(console, 'error', () => {});
  let app = await createApp({ dataDir, config, modulesDir: mods });
  app.world.create();
  const f = app.players.createClass({ name: 'F', course: 'fintech10' }).id;         // attempt 1 throws inside class.created
  assert.equal(app.db.prepare('SELECT COUNT(*) AS n FROM module_enabled').get().n, 0);
  app.db.close();
  app = await createApp({ dataDir, config, modulesDir: mods });                     // attempt 2 at boot
  assert.deepEqual(app.db.prepare('SELECT module_id, class_id FROM module_enabled').all().map((r) => ({ ...r })), [{ module_id: 'flaky', class_id: f }]);
  const { attempts } = await import(pathToFileURL(path.join(mods, 'flaky', 'index.js')));
  assert.deepEqual(attempts, [[f], [f]]);
  app.db.close();
  app = await createApp({ dataDir, config, modulesDir: mods });                     // attempt 3 never happens
  assert.equal(attempts.length, 2);
  app.db.close();
});

// ---------- upgrade safety (migration 004) ----------

test('upgrade: a database written before step 5 (old kinds, old bank migration record) keeps working: kinds renamed, audit clean, cap still counts, no second welcome grant', async (t) => {
  const dataDir = dir();
  const oldBankSql = `
CREATE TABLE bank_class_settings (
  class_id           INTEGER PRIMARY KEY REFERENCES classes(id),
  transfers_enabled  INTEGER NOT NULL DEFAULT 0,
  per_transfer_cents INTEGER NOT NULL DEFAULT 5000,
  daily_cents        INTEGER NOT NULL DEFAULT 10000
)`;
  const old = openDb(path.join(dataDir, 'vdaa.db'));
  migrate(old, coreMigrations(path.join(ROOT, 'migrations')).filter((m) => /\/00[123]_/.test(m.id)));      // the schema step 4 shipped
  migrate(old, [{ id: 'mod:bank-basic:001', sql: oldBankSql }]);                                          // as the old loader recorded it
  old.prepare("INSERT INTO worlds (name, season_start, season_end, created) VALUES ('S', '2026-01-01', '2026-06-01', 0)").run();
  old.prepare("INSERT INTO classes (world_id, name, course_id, created) VALUES (1, 'Block 1', 'fintech10', 0)").run();
  old.prepare('INSERT INTO bank_class_settings (class_id, transfers_enabled, per_transfer_cents, daily_cents) VALUES (1, 1, 7000, 9000)').run();
  const player = (name) => Number(old.prepare("INSERT INTO players (username, pin_hash, class_id, role, created) VALUES (?, '!', 1, 'student', 0)").run(name).lastInsertRowid);
  const [A, B] = [player('Alpha11'), player('Beta22')];
  const acct = (id) => Number(old.prepare("INSERT INTO accounts (owner_type, owner_id, kind, created) VALUES ('player', ?, 'chequing', 0)").run(id).lastInsertRowid);
  const [accA, accB] = [acct(A), acct(B)];
  const mint = old.prepare("SELECT id FROM accounts WHERE kind = 'system:mint'").get().id;
  // Old kinds, written the way the pre-step-5 ledger did (no wrapper): raise the ledger lock by hand, post, lower it.
  const now = Date.now();
  old.exec('UPDATE ledger_lock SET open = 1');
  const bal = new Map();
  const txn = (kind, meta, legs, reverses = null) => {
    const id = Number(old.prepare('INSERT INTO txns (kind, actor, created, meta, reverses) VALUES (?, ?, ?, ?, ?)').run(kind, 'system', now, JSON.stringify(meta), reverses).lastInsertRowid);
    for (const [acc, c] of legs) {
      old.prepare('UPDATE accounts SET balance_cents = balance_cents + ? WHERE id = ?').run(c, acc);
      bal.set(acc, (bal.get(acc) ?? 0) + c);
      old.prepare('INSERT INTO entries (txn_id, account_id, amount_cents, created, balance_after_cents) VALUES (?, ?, ?, ?, ?)').run(id, acc, c, now, bal.get(acc));
    }
    return id;
  };
  txn('grant', { reason: 'welcome' }, [[mint, -50000], [accA, 50000]]);
  txn('grant', { reason: 'welcome' }, [[mint, -50000], [accB, 50000]]);
  txn('grant', { reason: 'bonus' }, [[mint, -100], [accB, 100]]);                                         // another grant: must stay 'grant'
  const t1 = txn('transfer', { from: A, to: B, fromName: 'Alpha11', toName: 'Beta22' }, [[accA, -1000], [accB, 1000]]);
  const t2 = txn('transfer', { from: A, to: B, fromName: 'Alpha11', toName: 'Beta22' }, [[accA, -2000], [accB, 2000]]);
  txn('reversal', { reverses: t1 }, [[accA, 1000], [accB, -1000]], t1);
  old.exec('UPDATE ledger_lock SET open = 0');
  old.prepare("INSERT INTO audit_log (at, actor, action, detail) VALUES (0, 'player:1', 'bank.transfer', '{}'), (0, 'player:1', 'bank.settings', '{}'), (0, 'player:1', 'world.advance', '{}')").run();
  old.close();

  const warn = t.mock.method(console, 'warn', () => {});
  const app = await createApp({ dataDir });                                                               // the real config: bank-basic for fintech10
  try {
    const { db, ledger } = app;
    const kinds = Object.fromEntries(db.prepare('SELECT kind, COUNT(*) AS n FROM txns GROUP BY kind').all().map((r) => [r.kind, r.n]));
    assert.deepEqual(kinds, { 'bank-basic.welcome': 2, 'grant': 1, 'bank-basic.transfer': 2, 'core.reversal': 1 });
    assert.equal(ledger.audit().ok, true, JSON.stringify(ledger.audit().problems));
    assert.deepEqual(db.prepare('SELECT action FROM audit_log ORDER BY id').all().map((r) => r.action), ['bank-basic.transfer', 'bank-basic.settings', 'world.advance']);
    // every guard trigger from 002 (and the append-only ones from 001) is still there and still bites
    const triggers = db.prepare("SELECT name FROM sqlite_master WHERE type = 'trigger'").all().map((r) => r.name).sort();
    assert.deepEqual(triggers, ['accounts_balance_guard', 'accounts_start_at_zero', 'entries_guard', 'entries_no_delete', 'entries_no_update', 'txns_guard']);
    assert.throws(() => db.exec('UPDATE entries SET amount_cents = 5'), /append-only/);
    assert.throws(() => db.exec("INSERT INTO txns (kind, actor, created) VALUES ('x', 'y', 0)"), /through lib\/ledger\.js/);
    // the old positional bank migration is recognised under its new name: not re-run, settings kept, no checksum warning
    const ids = db.prepare("SELECT id FROM schema_migrations WHERE id LIKE 'mod:bank-basic:%'").all().map((r) => r.id);
    assert.deepEqual(ids, ['mod:bank-basic:001_settings', 'mod:bank-basic:002_transfer_class']);
    // 002 backfilled the feed index from the old transfers: both of them, under the sender's class
    assert.deepEqual(db.prepare('SELECT class_id, COUNT(*) AS n FROM bank_transfers GROUP BY class_id').all().map((r) => [r.class_id, r.n]), [[1, 2]]);
    assert.ok(!warn.mock.calls.some((c) => /changed since it was applied/.test(c.arguments[0])));
    assert.equal(db.prepare('SELECT per_transfer_cents FROM bank_class_settings WHERE class_id = 1').get().per_transfer_cents, 7000);

    // bank behaviour on old data: the cap counts the old transfers (minus the reversed one); a reversal of one is refused, the other works
    const route = (m, p) => app.modules.routes().find((r) => r.module === 'bank-basic' && r.method === m && r.path === p).handler;
    const userA = { id: A, username: 'Alpha11', role: 'student', class_id: 1 };
    assert.equal(route('GET', '/status')({ user: userA }).sent_24h_cents, 2000);
    // the migration gave the pre-existing teacher every class; here the teacher is added by hand, as an upgraded database would have it
    const teacher = { id: Number(db.prepare("INSERT INTO players (username, pin_hash, role, world_teacher, created) VALUES ('t', '!', 'teacher', 1, 0)").run().lastInsertRowid), username: 't', role: 'teacher', class_id: null };
    db.prepare('INSERT INTO class_teachers (class_id, teacher_id) VALUES (1, ?)').run(teacher.id);
    assert.equal(route('GET', '/transfers')({ user: teacher }).transfers.length, 2);
    const reverse = route('POST', '/transfers/:id/reverse');
    assert.throws(() => reverse({ user: teacher, params: { id: String(t1) } }), { code: 'ALREADY_REVERSED' });
    assert.equal(reverse({ user: teacher, params: { id: String(t2) } }).ok, true);
    assert.equal(route('GET', '/status')({ user: userA }).sent_24h_cents, 0);
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM txns WHERE kind = 'core.reversal'").get().n, 2);
    // the welcome grant paid before the upgrade counts: logging in again pays nothing
    const txns = db.prepare('SELECT COUNT(*) AS n FROM txns').get().n;
    app.modules.onLogin({ id: A, username: 'Alpha11', class_id: 1 }, 'fintech10');
    app.modules.onLogin({ id: B, username: 'Beta22', class_id: 1 }, 'fintech10');
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM txns').get().n, txns);
    assert.equal(ledger.audit().ok, true);
  } finally { app.db.close(); }
});

test('simulate: must be a function; the sim calls it only with the bots of courses that enable the module, as { id, class_id }', async () => {
  assert.throws(() => defineModule({ id: 'simbad', simulate: 5 }), /simulate: must be a function/);
  const src = { simmod: mod('simmod', `simulate(k, { month, students }) { (globalThis.__simSeen ??= []).push({ month, students }); },`) };
  const app = await createApp({ dataDir: dir(), config: cfg({ fintech10: ['bank-basic', 'simmod'], fintech2030: ['bank-basic'] }), modulesDir: modulesDir({ link: ['bank-basic'], src }) });
  try {
    app.world.create();
    const bots = [];
    for (const course of ['fintech10', 'fintech2030']) {
      const cls = app.players.createClass({ name: course, course });
      for (const b of await app.players.createStudents({ classId: cls.id, count: 2, hash: false })) bots.push({ id: b.id, class_id: cls.id, course_id: cls.course_id });
    }
    app.modules.simulate({ month: 3, students: bots });
    assert.deepEqual(globalThis.__simSeen, [{ month: 3, students: bots.filter((b) => b.course_id === 'fintech10').map(({ id, class_id }) => ({ id, class_id })) }]);
    app.modules.simulate({ month: 4, students: bots.filter((b) => b.course_id === 'fintech2030') });
    assert.equal(globalThis.__simSeen.length, 1, 'no bot of an enabling course: not called at all');
  } finally { delete globalThis.__simSeen; app.db.close(); }
});

test('seasonAssets: must be a function; a bad row fails the close with a 500 naming the module, and nothing is reset', async () => {
  assert.throws(() => defineModule({ id: 'assetbad', seasonAssets: 1 }), /seasonAssets: must be a function/);
  const src = { badasset: mod('badasset', `seasonAssets(k, { worldId }) { return [{ playerId: 'nobody', cents: 100 }]; },`) };
  const srv = await boot({ config: cfg({ fintech10: ['bank-basic', 'badasset'] }), modulesDir: modulesDir({ link: ['bank-basic'], src }) });
  try {
    const { app } = srv;
    const { teacher, students: [s] } = await seeded(srv, 1, { transfers: false });
    const res = await teacher.post('/api/teach/world/close');
    assert.equal(res.status, 500);
    assert.match(res.json.error, /^module "badasset": seasonAssets must return \[\{ playerId, cents \}\]/);
    assert.equal(app.world.current().status, 'active');
    assert.equal(app.db.prepare('SELECT COUNT(*) AS n FROM season_results').get().n, 0);
    assert.equal(app.db.prepare("SELECT COUNT(*) AS n FROM txns WHERE kind = 'core.season_reset'").get().n, 0);
    assert.equal((await s.client.get('/api/me')).json.accounts.find((a) => a.kind === 'chequing').balance_cents, 50000);
  } finally { await srv.cleanup(); }
});

test('seasonClose: runs inside the close transaction after the reset (world closed, results written, accounts zeroed); a throw fails the close naming the module and rolls everything back', async () => {
  assert.throws(() => defineModule({ id: 'closebad', seasonClose: 1 }), /seasonClose: must be a function/);
  const src = {
    peek: mod('peek', `migrations: [{ id: '001_seen', sql: 'CREATE TABLE peek_seen (world_id INTEGER, status TEXT, results INTEGER, nonzero INTEGER)' }],
  seasonClose(k, { world }) {
    k.db.prepare('INSERT INTO peek_seen VALUES (?, ?, (SELECT COUNT(*) FROM season_results WHERE world_id = ?), (SELECT COUNT(*) FROM accounts WHERE owner_type = ? AND balance_cents <> 0))')
      .run(world.id, world.status, world.id, 'player');
  },`),
    boom: mod('boom', `seasonClose() { throw new Error('close boom'); }`),
  };
  const run = async (mods) => {
    const srv = await boot({ config: cfg({ fintech10: mods }), modulesDir: modulesDir({ link: ['bank-basic', 'jobs'], src }) });
    const { teacher, students } = await seeded(srv, 2, { transfers: false });
    srv.app.db.prepare('INSERT INTO jobs_holdings (player_id, job_id, since_month, step, wage_cents) VALUES (?, 1, 1, 2, 99999)').run(students[0].id);
    return { srv, teacher, students, res: await teacher.post('/api/teach/world/close') };
  };
  const orig = console.error;
  console.error = () => {};
  let x;
  try {
    // jobs (before boom) has already reset its holdings when boom throws: the rollback must undo that too
    x = await run(['bank-basic', 'jobs', 'boom']);
    const { app } = x.srv;
    assert.equal(x.res.status, 500);
    assert.match(x.res.json.error, /module "boom": seasonClose failed: close boom/);
    assert.equal(app.world.current().status, 'active');
    assert.equal(app.db.prepare('SELECT COUNT(*) AS n FROM season_results').get().n, 0);
    assert.equal(app.db.prepare("SELECT COUNT(*) AS n FROM txns WHERE kind = 'core.season_reset'").get().n, 0);
    assert.equal((await x.students[0].client.get('/api/me')).json.accounts.find((a) => a.kind === 'chequing').balance_cents, 50000);
    assert.deepEqual({ ...app.db.prepare('SELECT step, wage_cents FROM jobs_holdings WHERE player_id = ?').get(x.students[0].id) }, { step: 2, wage_cents: 99999 });
    await x.srv.cleanup();

    x = await run(['bank-basic', 'jobs', 'peek']);
    assert.equal(x.res.status, 200);
    const w = x.srv.app.db.prepare('SELECT id FROM worlds').get().id;
    assert.deepEqual({ ...x.srv.app.db.prepare('SELECT * FROM peek_seen').get() }, { world_id: w, status: 'closed', results: 2, nonzero: 0 });
    assert.deepEqual({ ...x.srv.app.db.prepare('SELECT step, wage_cents FROM jobs_holdings WHERE player_id = ?').get(x.students[0].id) }, { step: 0, wage_cents: null });
  } finally { console.error = orig; await x?.srv.cleanup(); }
});

test('a throwing onLogin leaves the world unentered: /api/me retries on every call and the hook pays once it stops throwing', async () => {
  const src = {
    flaky: mod('flaky', `migrations: [{ id: '001_paid', sql: 'CREATE TABLE flaky_paid (player_id INTEGER, world_id INTEGER, PRIMARY KEY (player_id, world_id))' }],
  onLogin(k, p) {
    globalThis.__flakyCalls = (globalThis.__flakyCalls ?? 0) + 1;
    if (globalThis.__flakyThrow) throw new Error('flaky');
    k.db.prepare('INSERT OR IGNORE INTO flaky_paid VALUES (?, ?)').run(p.id, k.world.current().id);
  },`),
  };
  const srv = await boot({ config: cfg({ fintech10: ['bank-basic', 'flaky'] }), modulesDir: modulesDir({ link: ['bank-basic'], src }) });
  const orig = console.error;
  console.error = () => {};
  try {
    const { app } = srv;
    const { teacher, students: [s] } = await seeded(srv, 1, { transfers: false });
    const seen = () => app.db.prepare('SELECT seen_world_id FROM players WHERE id = ?').get(s.id).seen_world_id;
    const paid = (w) => app.db.prepare('SELECT COUNT(*) AS n FROM flaky_paid WHERE world_id = ?').get(w).n;
    const w1 = app.world.current().id;
    assert.deepEqual([seen(), paid(w1)], [w1, 1]);
    assert.equal((await teacher.post('/api/teach/world/close')).status, 200);
    globalThis.__flakyThrow = true;
    assert.equal((await teacher.post('/api/teach/world/create', { name: 'S2', season_start: '2026-09-01', season_end: '2027-01-01' })).status, 200);
    const w2 = app.world.current().id;
    const calls = globalThis.__flakyCalls;
    for (let i = 1; i <= 2; i++) {
      assert.equal((await s.client.get('/api/me')).status, 200);
      assert.equal(globalThis.__flakyCalls, calls + i, 'retried on every /api/me');
      assert.deepEqual([seen(), paid(w2)], [w1, 0]);
    }
    globalThis.__flakyThrow = false;
    assert.equal((await s.client.get('/api/me')).status, 200);
    assert.deepEqual([seen(), paid(w2)], [w2, 1]);
    assert.equal((await s.client.get('/api/me')).status, 200);
    assert.equal(globalThis.__flakyCalls, calls + 3, 'entered: no more calls');
    assert.equal(app.db.prepare("SELECT COUNT(*) AS n FROM txns WHERE kind = 'bank-basic.welcome' AND json_extract(meta, '$.worldId') = ?").get(w2).n, 1);
  } finally { console.error = orig; delete globalThis.__flakyThrow; delete globalThis.__flakyCalls; await srv.cleanup(); }
});

test('homeCards: declared cards only, a throwing module or an oversized card is skipped, at most 2 per module; never breaks /api/me', async () => {
  assert.throws(() => defineModule({ id: 'cardbad', homeCards: 'x' }), /homeCards: must be a function/);
  assert.throws(() => defineModule({ id: 'cardbad', cards: [{ id: 'c', src: 'c.js' }] }), /cards: needs a homeCards hook/);
  assert.throws(() => defineModule({ id: 'cardbad', cards: [{ id: 'c', src: '../c.js' }], homeCards() { return []; } }), /cards\[0\]\.src: must be a file name/);
  const src = {
    cardboom: mod('cardboom', `cards: [{ id: 'a', src: 'a.js' }], homeCards() { throw new Error('card boom'); },`),
    cardbig: mod('cardbig', `cards: [{ id: 'a', src: 'a.js' }], homeCards() { return [{ id: 'a', title: 'Big', data: { s: 'x'.repeat(9000) } }]; },`),
    cardmix: mod('cardmix', `cards: [{ id: 'a', src: 'a.js' }, { id: 'b', src: 'b.js' }],
      homeCards(k, user) { return [{ id: 'a', title: 'Hello', data: { n: 1, who: user.id } }, { id: 'nope', title: 'Undeclared', data: {} }, { id: 'b', title: 'Third', data: {} }]; },`),
    cardok: mod('cardok', `cards: [{ id: 'z', src: 'z.js' }], homeCards() { return [{ id: 'z', title: 'x'.repeat(61), data: {} }, { id: 'z', title: 'Fine', data: [1, 2] }]; },`),
  };
  const srv = await boot({ config: cfg({ fintech10: ['bank-basic', 'cardboom', 'cardbig', 'cardmix', 'cardok'] }), modulesDir: modulesDir({ link: ['bank-basic'], src }) });
  const orig = console.error;
  console.error = () => {};
  try {
    const { students: [s] } = await seeded(srv, 1, { transfers: false });
    const me = await s.client.get('/api/me');
    assert.equal(me.status, 200);
    const v = me.json.homeCards.map((c) => ({ ...c, src: c.src.replace(/\?v=.*/, '') }));
    assert.deepEqual(v, [   // cardmix: 'nope' is undeclared and 'b' is the third row (2 per module); cardok: the 61-character title is dropped
      { module: 'cardmix', id: 'a', title: 'Hello', data: { n: 1, who: s.id }, src: '/m/cardmix/a.js' },
      { module: 'cardok', id: 'z', title: 'Fine', data: [1, 2], src: '/m/cardok/z.js' },
    ]);
  } finally { console.error = orig; await srv.cleanup(); }
});

test('badges: must be a function; a throwing module never breaks /api/me and the other modules\' chips still show', async () => {
  assert.throws(() => defineModule({ id: 'badgebad', badges: 'x' }), /badges: must be a function/);
  const src = {
    badgeboom: mod('badgeboom', `badges() { throw new Error('badge boom'); },`),
    badgeok: mod('badgeok', `badges(k, user) { return [{ text: 'Alpha', title: 'Top of the pack' }, { text: 'x'.repeat(41) }]; },`),
  };
  const srv = await boot({ config: cfg({ fintech10: ['bank-basic', 'badgeboom', 'badgeok'] }), modulesDir: modulesDir({ link: ['bank-basic'], src }) });
  const orig = console.error;
  console.error = () => {};
  try {
    const { students: [s] } = await seeded(srv, 1, { transfers: false });
    const me = await s.client.get('/api/me');
    assert.equal(me.status, 200);
    assert.deepEqual(me.json.badges, [{ module: 'badgeok', text: 'Alpha', title: 'Top of the pack' }]);   // the over-long chip is dropped too
  } finally { console.error = orig; await srv.cleanup(); }
});
