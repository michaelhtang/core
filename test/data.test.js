// Catalogues upserted at boot, no-school days and season_end for auto-advance, declared module options (docs/modules.md, docs/clock.md).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { tmpDir, boot } from './helpers.js';
import { createApp, ROOT } from '../lib/app.js';
import { createClock } from '../lib/clock.js';
import { CATALOGUE, PATHS } from '../modules/jobs/catalogue.js';
import { ITEMS as BILLS } from '../modules/bills/catalogue.js';
import { ALL_ITEMS as GOODS } from '../modules/outfitters/constants.js';

const realConfig = () => JSON.parse(fs.readFileSync(path.join(ROOT, 'config', 'vdaa.json'), 'utf8'));
const fake = (iso) => { let t = Date.parse(iso); const c = createClock({ now: () => t }); c.set = (v) => { t = Date.parse(v); }; return c; };

test('catalogue edits reach an existing database on restart; holdings and owned items keep working; removed rows stay', async () => {
  const dir = tmpDir();
  const cashier = CATALOGUE[0], step = PATHS[0], rent = BILLS.find((b) => b.id === 'rent'), tee = GOODS.find((g) => g.id === 'tee');
  const before = { wage: cashier.hourly_cents, step: step.hourly_cents, rent: rent.amount_cents, tee: tee.price_cents };
  let app = await createApp({ dataDir: dir });
  try {
    app.world.create();
    const cls = app.players.createClass({ name: 'Block 1', course: 'fintech10' });
    const [s] = await app.players.createStudents({ classId: cls.id, count: 1, hash: false });
    app.modules.onLogin({ id: s.id, username: s.username, class_id: cls.id }, 'fintech10');
    app.db.prepare('INSERT INTO jobs_holdings (player_id, job_id, since_month) VALUES (?, 1, 1)').run(s.id);      // cashier, on the catalogue wage
    app.db.prepare("INSERT INTO outfitters_owned (player_id, world_id, item_id, price_cents, gst_cents, month_bought, via) VALUES (?, ?, 'tee', 2000, 100, 1, 'achievement')").run(s.id, app.world.current().id);
    app.db.close();

    // "Edit catalogue.js": a raise for cashiers and their first step, rent up, the tee cheaper, and the landscaper row removed.
    cashier.hourly_cents += 100; step.hourly_cents += 50; rent.amount_cents += 2500; tee.price_cents -= 500;
    const removed = CATALOGUE.pop();
    try {
      app = await createApp({ dataDir: dir });
    } finally {
      CATALOGUE.push(removed);
      Object.assign(cashier, { hourly_cents: before.wage }); Object.assign(step, { hourly_cents: before.step });
      Object.assign(rent, { amount_cents: before.rent }); Object.assign(tee, { price_cents: before.tee });
    }
    const one = (sql, ...a) => app.db.prepare(sql).get(...a);
    assert.equal(one('SELECT hourly_cents FROM jobs_catalogue WHERE id = 1').hourly_cents, before.wage + 100);
    assert.equal(one('SELECT hourly_cents FROM jobs_steps WHERE job_id = ? AND step = ?', step.job_id, step.step).hourly_cents, before.step + 50);
    assert.equal(one("SELECT amount_cents FROM bills_catalogue WHERE id = 'rent'").amount_cents, before.rent + 2500);
    assert.equal(one("SELECT price_cents FROM outfitters_items WHERE id = 'tee'").price_cents, before.tee - 500);
    assert.equal(one('SELECT title FROM jobs_catalogue WHERE id = ?', removed.id).title, removed.title);       // never deleted

    // The cashier is paid the new catalogue wage at the next payday; the owned tee still joins its item.
    app.world.advance({ months: 1 });
    assert.equal(one('SELECT hourly_cents FROM jobs_paystubs WHERE player_id = ?', s.id).hourly_cents, before.wage + 100);
    assert.equal(one('SELECT i.name FROM outfitters_owned o JOIN outfitters_items i ON i.id = o.item_id WHERE o.player_id = ?', s.id).name, tee.name);
    app.db.close();

    app = await createApp({ dataDir: dir });                                                        // back to the file's values
    assert.equal(one('SELECT hourly_cents FROM jobs_catalogue WHERE id = 1').hourly_cents, before.wage);
  } finally { app.db.close(); fs.rmSync(dir, { recursive: true, force: true }); }
});

test('housing_catalogue (never read) is gone', async () => {
  const dir = tmpDir();
  const app = await createApp({ dataDir: dir });
  try { assert.equal(app.db.prepare("SELECT 1 FROM sqlite_master WHERE name = 'housing_catalogue'").get(), undefined); }
  finally { app.db.close(); fs.rmSync(dir, { recursive: true, force: true }); }
});

test('auto-advance skips no-school days (config default and the teacher\'s own list) and stops at season_end; manual advance still works', async () => {
  const dir = tmpDir();
  const clock = fake('2027-02-15T15:00:00Z');                                  // Mon 08:00 MST: Family Day in the EPSB default list
  const app = await createApp({ dataDir: dir, clock });
  try {
    app.world.create({ seasonStart: '2027-02-01', seasonEnd: '2027-06-30' });
    app.world.setSettings({ auto_advance: 'school_days' });
    assert.ok(app.world.noSchool().includes('2027-02-15'));
    assert.equal(app.world.autoAdvance(), null);
    clock.set('2027-02-16T15:00:00Z');
    assert.equal(app.world.autoAdvance().month, 2);

    app.world.setSettings({ no_school: ['2027-02-17 to 2027-02-18'] });           // the teacher's list replaces the default
    clock.set('2027-02-17T15:00:00Z'); assert.equal(app.world.autoAdvance(), null);
    clock.set('2027-02-18T15:00:00Z'); assert.equal(app.world.autoAdvance(), null);
    clock.set('2027-02-19T15:00:00Z'); assert.equal(app.world.autoAdvance().month, 3);
    clock.set('2027-02-25T15:00:00Z'); assert.equal(app.world.autoAdvance().month, 4);   // Teachers' Convention is no longer on the list
    app.world.setSettings({ no_school: null });                                    // back to the config default
    clock.set('2027-02-26T15:00:00Z'); assert.equal(app.world.autoAdvance(), null);

    clock.set('2027-06-30T14:00:00Z');                                           // Wed 08:00 MDT, the season's last day
    assert.equal(app.world.autoAdvance(), null);
    clock.set('2027-07-02T14:00:00Z');                                           // a weekday after it
    assert.equal(app.world.autoAdvance(), null);
    assert.equal(app.world.advance({}).month, 5);                                 // the teacher can still advance by hand
  } finally { app.db.close(); fs.rmSync(dir, { recursive: true, force: true }); }
});

test('no-school days: the console route validates them and teach/state shows them with the season-end stop', async () => {
  const srv = await boot({ clock: fake('2027-03-01T15:00:00Z') });
  try {
    const t = srv.client();
    await t.post('/api/setup', { username: 'teacher', passphrase: 'correct horse battery' });
    const post = (no_school) => t.post('/api/teach/world/settings', { no_school });
    for (const bad of [['2027-02-30'], ['2027-13-01'], ['Feb 15'], ['2027-03-05 to 2027-03-01'], ['2027-03-01 to'], [5], '2027-03-01', Array(201).fill('2027-03-01')]) {
      assert.equal((await post(bad)).status, 400, JSON.stringify(bad).slice(0, 40));
    }
    const ok = await post([' 2027-03-03 ', '2027-03-10 to 2027-03-12', '2027-03-15 to 2027-03-15']);
    assert.equal(ok.status, 200);
    assert.deepEqual(ok.json.no_school, ['2027-03-03', '2027-03-10 to 2027-03-12', '2027-03-15']);
    const st = (await t.get('/api/teach/state')).json.world;
    assert.deepEqual([st.no_school, st.season_over], [ok.json.no_school, false]);
  } finally { await srv.cleanup(); }
});

test('a bad config.calendar.noSchool entry fails boot', async () => {
  const dir = tmpDir();
  const config = realConfig();
  config.calendar.noSchool = ['2027-02-29'];
  try { await assert.rejects(createApp({ dataDir: dir, config }), /2027-02-29/); }
  finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('module options: the shipped config uses only declared keys; an unknown key warns, naming it', async (t) => {
  const warn = t.mock.method(console, 'warn', () => {});
  const run = async (config) => { const dir = tmpDir(); const app = await createApp({ dataDir: dir, config }); app.db.close(); fs.rmSync(dir, { recursive: true, force: true }); };
  await run(realConfig());
  assert.deepEqual(warn.mock.calls.map((c) => c.arguments[0]).filter((m) => /^config:/.test(m)), []);
  const config = realConfig();
  config.options.jobs = { raiseBP: 500 };                                       // typo of raiseBp
  config.options.nope = { x: 1 };
  await run(config);
  const msgs = warn.mock.calls.map((c) => c.arguments[0]);
  assert.ok(msgs.some((m) => /options\.jobs\.raiseBP is not an option of module "jobs"/.test(m)), msgs.join('\n'));
  assert.ok(msgs.some((m) => /options\.nope: there is no module "nope"/.test(m)));
});

const handler = (app, method, p) => app.modules.routes().find((r) => r.method === method && r.fullPath === p).handler;

test('a row removed from a catalogue is retired: not billed, not for sale, not on the job board; owned items and holders keep working; back in the file = active again', async () => {
  const dir = tmpDir();
  let app = await createApp({ dataDir: dir });
  const one = (sql, ...a) => app.db.prepare(sql).get(...a);
  const without = async (fn) => {                                     // reboot with internet, tee and the landscaper removed from the files
    const i = BILLS.findIndex((b) => b.id === 'internet'), g = GOODS.findIndex((x) => x.id === 'tee'), j = CATALOGUE.findIndex((c) => c.id === 12);
    const [bill] = BILLS.splice(i, 1), [good] = GOODS.splice(g, 1), [job] = CATALOGUE.splice(j, 1);
    try { app.db.close(); app = await createApp({ dataDir: dir }); } finally { BILLS.splice(i, 0, bill); GOODS.splice(g, 0, good); CATALOGUE.splice(j, 0, job); }
    return fn();
  };
  try {
    app.world.create();
    const cls = app.players.createClass({ name: 'Block 1', course: 'fintech10' });
    const [s] = await app.players.createStudents({ classId: cls.id, count: 1, hash: false });
    const user = { id: s.id, username: s.username, role: 'student', class_id: cls.id };
    app.modules.onLogin(user, 'fintech10');
    app.db.prepare('INSERT INTO jobs_holdings (player_id, job_id, since_month) VALUES (?, 12, 1)').run(s.id);   // the landscaper, about to be retired
    handler(app, 'POST', '/api/outfitters/buy')({ user, body: { item: 'tee' } });

    await without(() => {});
    assert.deepEqual([one("SELECT active FROM bills_catalogue WHERE id = 'internet'").active, one("SELECT active FROM outfitters_items WHERE id = 'tee'").active, one('SELECT active FROM jobs_catalogue WHERE id = 12').active], [0, 0, 0]);
    const state = handler(app, 'GET', '/api/outfitters/state')({ user });
    assert.ok(!state.items.some((i) => i.id === 'tee'));                                  // not for sale
    assert.deepEqual(state.owned.map((o) => o.item_id), ['tee']);                         // still owned, still joins its row
    assert.throws(() => handler(app, 'POST', '/api/outfitters/buy')({ user, body: { item: 'tee' } }), /not an item you can buy/);
    assert.ok(!handler(app, 'GET', '/api/jobs/catalogue')({ user }).jobs.some((j) => j.id === 12));   // off the board
    app.world.advance({ months: 3 });                                                     // pay at 2, bills from 3
    const billed = app.db.prepare('SELECT DISTINCT bill_id FROM bills_due WHERE player_id = ?').all(s.id).map((r) => r.bill_id);
    assert.ok(billed.includes('rent') && !billed.includes('internet'), billed.join());
    assert.ok(one('SELECT 1 FROM jobs_paystubs WHERE player_id = ? AND job_id = 12', s.id));   // the holder is still paid

    app.db.close();
    app = await createApp({ dataDir: dir });                                              // back in the files
    assert.deepEqual([one("SELECT active FROM bills_catalogue WHERE id = 'internet'").active, one("SELECT active FROM outfitters_items WHERE id = 'tee'").active, one('SELECT active FROM jobs_catalogue WHERE id = 12').active], [1, 1, 1]);
    app.world.advance({ months: 1 });
    assert.ok(one("SELECT 1 FROM bills_due WHERE player_id = ? AND bill_id = 'internet'", s.id));
  } finally { app.db.close(); fs.rmSync(dir, { recursive: true, force: true }); }
});

test('catalogue rows with different keys fail boot, naming the module, table and row', async () => {
  const dir = tmpDir();
  const row = BILLS.find((b) => b.id === 'transit');
  row.extra = 1;
  try { await assert.rejects(createApp({ dataDir: dir }), /module "bills": catalogue bills_catalogue: row \d+ \(transit\) has columns/); }
  finally { delete row.extra; fs.rmSync(dir, { recursive: true, force: true }); }
});

test('the default no-school list covers the fall too (EPSB 2026-27): Remembrance Day week and winter break are skipped', async () => {
  const dir = tmpDir();
  const clock = fake('2026-11-11T15:00:00Z');                                  // Wed 08:00 MST
  const app = await createApp({ dataDir: dir, clock });
  try {
    app.world.create({ seasonStart: '2026-09-01', seasonEnd: '2027-01-31' });
    app.world.setSettings({ auto_advance: 'school_days' });
    for (const d of ['2026-11-11', '2026-11-12', '2026-11-13', '2026-11-16', '2026-12-21', '2026-12-31', '2027-01-01', '2027-01-29']) {
      clock.set(`${d}T15:00:00Z`);
      assert.equal(app.world.autoAdvance(), null, d);
    }
    clock.set('2026-11-17T15:00:00Z');
    assert.equal(app.world.autoAdvance().month, 2);
  } finally { app.db.close(); fs.rmSync(dir, { recursive: true, force: true }); }
});

test('a new season keeps the teacher\'s no-school list (and the default stays the default)', async () => {
  const dir = tmpDir();
  const app = await createApp({ dataDir: dir, clock: fake('2027-03-01T15:00:00Z') });
  try {
    app.world.create();
    app.world.close();
    app.world.create();
    assert.equal(app.world.current().no_school, null);
    app.world.setSettings({ no_school: ['2027-03-03'] });
    app.world.close();
    app.world.create();
    assert.deepEqual(app.world.noSchool(), ['2027-03-03']);
  } finally { app.db.close(); fs.rmSync(dir, { recursive: true, force: true }); }
});
