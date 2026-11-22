import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { tmpDir, boot } from './helpers.js';
import { createApp, ROOT } from '../lib/app.js';
import { createClock } from '../lib/clock.js';

// A clock you set by hand. Edmonton is UTC-6 in summer (MDT), so 08:00 local is 14:00Z.
const fake = (iso) => { let t = Date.parse(iso); const c = createClock({ now: () => t }); c.set = (v) => { t = Date.parse(v); }; return c; };
const WED_8AM = '2026-06-10T14:00:00Z';

test('today() is the Edmonton date: 23:30 MDT is already the next day in UTC', () => {
  const c = fake('2026-06-11T05:30:00Z');
  assert.equal(c.today(), '2026-06-10');
  assert.equal(c.hour(), 23);
  assert.equal(new Date(c.now()).toISOString().slice(0, 10), '2026-06-11');
});

test('isSchoolDay: Mon to Fri, minus the noSchool list', () => {
  const c = createClock({ noSchool: ['2026-06-10'] });
  assert.deepEqual(['2026-06-08', '2026-06-09', '2026-06-10', '2026-06-12', '2026-06-13', '2026-06-14'].map(c.isSchoolDay), [true, true, false, true, false, false]);
});

test('world.create uses the local date for the season, 150 days long', async () => {
  const dir = tmpDir();
  const app = await createApp({ dataDir: dir, clock: fake('2026-06-11T05:30:00Z') });
  try {
    const w = app.world.create();
    assert.equal(w.season_start, '2026-06-10');
    assert.equal(w.season_end, '2026-11-07');
    assert.equal(w.auto_advance, 'manual');
  } finally { app.db.close(); fs.rmSync(dir, { recursive: true, force: true }); }
});

test('auto-advance: once per school day, after 07:00, never on weekends, survives restarts, yields to a manual advance', async () => {
  const dir = tmpDir();
  const clock = fake('2026-06-10T12:30:00Z');                                  // Wed 06:30 local
  let app = await createApp({ dataDir: dir, clock });
  try {
    app.world.create();
    assert.equal(app.world.autoAdvance(), null);                               // off by default
    app.world.setSettings({ auto_advance: 'school_days' });
    assert.equal(app.world.autoAdvance(), null);                               // before 07:00
    clock.set(WED_8AM);
    assert.equal(app.world.autoAdvance().month, 2);
    assert.equal(app.world.autoAdvance(), null);                               // second tick, same day
    assert.equal(app.world.current().last_advanced_day, '2026-06-10');

    app.db.close();                                                            // restart on the same database, same day
    app = await createApp({ dataDir: dir, clock });
    assert.equal(app.world.autoAdvance(), null);
    assert.equal(app.world.current().month, 2);

    clock.set('2026-06-13T16:00:00Z');                                         // Saturday 10:00
    assert.equal(app.world.autoAdvance(), null);

    clock.set('2026-06-15T14:00:00Z');                                         // Monday: the teacher advances by hand first
    app.world.advance({});
    assert.equal(app.world.autoAdvance(), null);
    assert.equal(app.world.current().month, 3);

    clock.set('2026-06-16T14:00:00Z');                                         // Tuesday: auto works again
    assert.equal(app.world.autoAdvance().month, 4);
    assert.ok(app.db.prepare("SELECT 1 FROM audit_log WHERE action = 'world.advance' AND actor = 'system:auto'").get());
  } finally { app.db.close(); fs.rmSync(dir, { recursive: true, force: true }); }
});

test('the server timer and the teacher console setting', async () => {
  const clock = fake(WED_8AM);
  const srv = await boot({ clock });
  try {
    const teacher = srv.client();
    assert.equal((await teacher.post('/api/setup', { username: 'teacher', passphrase: 'correct horse battery' })).status, 200);
    const post = (b) => teacher.post('/api/teach/world/settings', b);
    assert.equal((await post({})).status, 400);                                // at least one
    assert.equal((await post({ auto_advance: 'daily' })).status, 400);
    assert.equal((await post({ months_per_day: 2 })).json.auto_advance, 'manual');
    const on = await post({ auto_advance: 'school_days' });
    assert.deepEqual([on.status, on.json.auto_advance, on.json.months_per_day], [200, 'school_days', 2]);
    srv.ticks.autoAdvance(); srv.ticks.autoAdvance();
    assert.equal(srv.app.world.current().month, 3);                            // 1 + months_per_day, once
    assert.equal((await teacher.get('/api/me')).json.world.auto_advance, 'school_days');
  } finally { await srv.cleanup(); }
});

test('no Date.now( in lib/ or modules/ except lib/clock.js', () => {
  const hits = [];
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (/\.(js|mjs)$/.test(e.name) && p !== path.join(ROOT, 'lib', 'clock.js') && fs.readFileSync(p, 'utf8').includes('Date.now(')) hits.push(path.relative(ROOT, p));
    }
  };
  walk(path.join(ROOT, 'lib')); walk(path.join(ROOT, 'modules'));
  assert.deepEqual(hits, []);
});
