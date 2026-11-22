// live town (docs/live.md): the student home screen refreshes by itself. Server side: feed.new (class-wide, coalesced to one push per class per 500 ms, only
// after commit, never on a rollback, no payload), today.done (the one student), and the month event for the ticker and news. Client side: the page subscribes to
// those events and its cards redraw from the refetch. Real HTTP and real streams, the real config.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { withTxn } from '../lib/db.js';
import { boot, seeded, addClass, openStream } from './helpers.js';

const WINDOW = 900;                                                  // a bit more than the 500 ms coalescing window
const nap = (ms) => new Promise((r) => setTimeout(r, ms));
const count = (stream, name) => stream.events.filter((e) => e.event === name).length;
const hired = (app, p) => app.events.emit('module.jobs.hired', { playerId: p.id, title: 'Barista', employer: 'Cafe' });

async function town() {
  const srv = await boot();
  const a = await seeded(srv, 2, { transfers: false });
  const b = await addClass(srv, a.teacher, 'Block 2', 2);
  const streams = [];
  const open = async (client) => { const s = await openStream(srv, client); streams.push(s); return s; };
  const sa = await Promise.all(a.students.map((s) => open(s.client)));
  const sb = await Promise.all(b.students.map((s) => open(s.client)));
  const st = await open(a.teacher);
  return { srv, a, b, sa, sb, st, async cleanup() { streams.forEach((s) => s.close()); await srv.cleanup(); } };
}

test('feed.new: a class item reaches that class\'s students once, with no payload; another class and the teacher get nothing', async () => {
  const t = await town();
  try {
    hired(t.srv.app, t.a.students[0]);
    for (const s of t.sa) assert.deepEqual((await s.next('feed.new', 2000))?.data, {}, 'both students of the class');
    await nap(WINDOW);
    for (const s of t.sb) assert.equal(count(s, 'feed.new'), 0, 'the other class hears nothing');
    assert.equal(count(t.st, 'feed.new'), 0, 'no teacher push');
    assert.deepEqual(t.sa.map((s) => count(s, 'feed.new')), [1, 1]);
  } finally { await t.cleanup(); }
});

test('feed.new: a burst of 1000 items in one transaction is one push per student, sent after the commit', async () => {
  const t = await town();
  try {
    const { app } = t.srv;
    withTxn(app.db, () => { for (let i = 0; i < 1000; i++) hired(app, t.a.students[i % 2]); });
    assert.equal(app.db.prepare('SELECT COUNT(*) AS n FROM feed_items').get().n, 1000);
    await t.sa[0].next('feed.new', 2000);
    await nap(WINDOW);
    assert.deepEqual(t.sa.map((s) => count(s, 'feed.new')), [1, 1], 'one event per student for the whole burst');
    assert.equal(t.sb.reduce((n, s) => n + count(s, 'feed.new'), 0), 0);
    for (let i = 0; i < 1000; i++) hired(app, t.a.students[0]);       // no transaction: each item is its own commit
    await nap(WINDOW + 400);
    const n = count(t.sa[1], 'feed.new');
    assert.ok(n >= 2 && n <= 3, `1000 single commits are one or two windows, not 1000 (got ${n - 1} more)`);
  } finally { await t.cleanup(); }
});

test('feed.new: nothing is sent when the transaction rolls back, nor for a savepoint that rolled back', async () => {
  const t = await town();
  try {
    const { app } = t.srv;
    assert.throws(() => withTxn(app.db, () => { hired(app, t.a.students[0]); throw new Error('no'); }), /no/);
    withTxn(app.db, () => { try { withTxn(app.db, () => { hired(app, t.a.students[0]); throw new Error('inner'); }); } catch { /* the savepoint only */ } });
    assert.equal(app.db.prepare('SELECT COUNT(*) AS n FROM feed_items').get().n, 0);
    await nap(WINDOW);
    assert.deepEqual(t.sa.map((s) => count(s, 'feed.new')), [0, 0]);
    withTxn(app.db, () => hired(app, t.a.students[0]));
    assert.ok(await t.sa[0].next('feed.new', 2000), 'a committed one still goes out');
  } finally { await t.cleanup(); }
});

test('feed.new: a town item (no class) goes to every class, still not to a teacher', async () => {
  const t = await town();
  try {
    t.srv.app.events.emit('module.housing.market', { pct: 3, month: 1 });
    for (const s of [...t.sa, ...t.sb]) assert.ok(await s.next('feed.new', 2000), 'every student');
    await nap(WINDOW);
    assert.equal(count(t.st, 'feed.new'), 0);
    assert.ok([...t.sa, ...t.sb].every((s) => count(s, 'feed.new') === 1));
  } finally { await t.cleanup(); }
});

test('today.done: a finished errand tells that student only', async () => {
  const t = await town();
  try {
    const [s1, s2] = t.a.students;
    const errand = (await s1.client.get('/api/today/state')).json.errands.find((e) => e.status === 'open' && e.building === 'job');
    assert.ok(errand, 'the "Pick a job" errand is among today\'s on a fresh class');
    await nap(100);
    const before = count(t.sa[0], 'today.done');
    assert.equal((await s1.client.post('/api/jobs/pick', { job_id: 1 })).status, 200);       // a fact errand: it is settled the next time the card is built (and the pick writes a class feed item)
    assert.ok(await t.sa[0].next('feed.new', 2000), 'the class item makes every open page refetch, which builds the card');
    await s1.client.get('/api/me');                                                          // what that refetch does
    assert.ok(await t.sa[0].next('today.done', 2000), 'the student who finished it');
    await nap(WINDOW);
    assert.equal(count(t.sa[0], 'today.done') - before, 1);
    assert.deepEqual(t.sa[0].events.find((e) => e.event === 'today.done').data, {});
    assert.equal(count(t.sa[1], 'today.done'), 0, 'not the classmate');
    assert.equal(count(t.sb[0], 'today.done') + count(t.st, 'today.done'), 0);
    assert.ok(count(t.sa[1], 'feed.new') >= 1, 'the classmate does hear the class item');
    assert.equal((await s1.client.get('/api/today/state')).json.errands.find((e) => e.id === errand.id).status, 'done');
    assert.equal(typeof s2.id, 'number');
  } finally { await t.cleanup(); }
});

test('the ticker and news chips ride on the month event: every stream hears it, and /api/me then carries the new chips', async () => {
  const t = await town();
  try {
    const chips = async (c) => (await c.get('/api/me')).json.badges.map((x) => x.text);
    const before = await chips(t.a.students[0].client);
    assert.ok(!before.some((x) => x.startsWith('DAAX')), 'no price yet in a brand-new season');
    assert.equal((await t.a.teacher.post('/api/teach/world/advance')).status, 200);
    for (const s of [...t.sa, ...t.sb]) assert.ok(await s.next('month', 2000), 'every student hears the month');
    const after = await chips(t.a.students[0].client);
    assert.ok(after.some((x) => /^DAAX \$[\d.,]+ [+-]\d/.test(x)), 'the ticker chip appears with the month: no reload, no extra push');
    assert.ok(after.some((x) => x.startsWith('Wolf')), 'so does the Wolf rank chip');
  } finally { await t.cleanup(); }
});

test('the push carries no private data: only `{}` goes out, and a class item never mentions money or ids', async () => {
  const t = await town();
  try {
    const rich = t.a.students[0];
    t.srv.app.events.emit('module.credit.limit', { playerId: rich.id, worldId: 1, limitCents: 987654, aprBp: 2099 });
    await t.sb[0].next('feed.new', 300);
    await t.sa[1].next('feed.new', 2000);
    await nap(WINDOW);
    for (const s of [...t.sa, ...t.sb, t.st]) for (const e of s.events.filter((x) => ['feed.new', 'today.done'].includes(x.event))) assert.deepEqual(e.data, {});
    assert.equal(count(t.sb[0], 'feed.new'), 0, 'the other class never hears a classmate\'s card');
  } finally { await t.cleanup(); }
});

test('the page redraws from these events: student.js listens for them, and the Around town and Today cards refresh from the refetch', () => {
  const read = (p) => fs.readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
  const student = read('public/student.js'), feed = read('modules/feed/ui/feed.js'), today = read('modules/today/ui/today.js');
  assert.match(student, /'feed\.new'\(\) \{\}/);
  assert.match(student, /'today\.done'\(\) \{\}/);
  assert.match(student, /broadcast: \['month', 'feed\.new'\]/, 'a class-wide hint gets the jitter');
  assert.match(student, /document\.querySelectorAll\('\[data-status\]'\)[^\n]*badgeChips/, 'the header chips are rebuilt on every update');
  assert.match(student, /refreshers\.forEach\(\(fn\) => fn\(\)\)/);
  assert.match(feed, /ctx\.onRefresh\(paint\)/);
  assert.match(today, /ctx\.onRefresh\(/);
  assert.match(today, /td-done/, 'the errand row flips to done');
});

test('lib/live: marks inside one window become one flush with every key; stop() drops what is pending', async () => {
  const { createHints } = await import('../lib/live.js');
  const got = [];
  const h = createHints((keys) => got.push(keys), 30);
  for (let i = 0; i < 1000; i++) h.mark(i % 3);
  await nap(80);
  assert.deepEqual(got, [[0, 1, 2]]);
  h.mark(9); h.stop();
  await nap(80);
  assert.equal(got.length, 1);
});
