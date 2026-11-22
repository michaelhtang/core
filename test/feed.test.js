// feed (docs/phase6-roles.md 1.2, "As built (6a feed + scenarios)"): each source writes one row scoped to the right class (or the town), a student sees
// only their class and the town, a teacher only the classes they read, amounts follow leaderboards' hide_amounts, a listener never throws into its emitter,
// and 500 rows are kept per class. A bare app on a hand-set clock with the real config; the sources are driven through the real routes where one exists.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { ROOT } from '../lib/app.js';
import { tmpDir } from './helpers.js';
import { CONFIG, world, cleanupWorlds } from './app-world.js';

const made = [];
after(() => { cleanupWorlds(); for (const d of made) fs.rmSync(d, { recursive: true, force: true }); });
const cash = { ...CONFIG, options: { ...CONFIG.options, 'bank-basic': { startCents: 1000000 } } };   // enough for a deposit and the big ledger posts below
const texts = (w) => w.feedRows().map((r) => r.text);

test('a job picked or assigned is a class item; taking the job you already hold is not', async () => {
  const w = await world({ n: 2, config: cash });
  const [a, b] = w.users;
  w.post('jobs', '/pick', { job_id: 1 }, a);
  const rows = w.feedRows();
  assert.equal(rows.length, 1);
  assert.deepEqual([rows[0].class_id, rows[0].kind, rows[0].player_id, rows[0].cents], [w.cls.id, 'job', a.id, null]);
  assert.match(rows[0].text, new RegExp(`^${a.username} took a job: .+ at .+$`));
  w.post('jobs', '/pick', { job_id: 1 }, a);                        // same job again: nothing changed, nothing announced
  assert.equal(w.feedRows().length, 1);
  w.post('jobs', '/assign', { player_id: b.id, job_id: 2 }, w.teacherA);
  assert.equal(w.feedRows().length, 2);
  assert.match(texts(w)[1], new RegExp(`^${b.username} took a job:`));
  w.post('jobs', '/assign', { player_id: b.id, job_id: 2 }, w.teacherA);   // already holds it
  assert.equal(w.feedRows().length, 2);
  w.close();
});

test('a promotion is a class item with the new title', async () => {
  const w = await world({ n: 1, config: cash });
  const [a] = w.users;
  w.post('jobs', '/pick', { job_id: 1 }, a);
  w.post('jobs', '/promote', { player_id: a.id }, w.teacherA);
  const last = w.feedRows().at(-1);
  assert.equal(last.kind, 'promotion');
  assert.match(last.text, new RegExp(`^${a.username} was promoted to .+`));
  assert.equal(last.class_id, w.cls.id);
  w.close();
});

test('card, move, home, trade: synthetic and real events each write one row for the right class; small trades and other kinds write none', async () => {
  const w = await world({ n: 1, second: 1, config: cash });
  const [a] = w.users, [b] = w.users2;
  w.app.events.emit('module.credit.limit', { playerId: a.id, worldId: 1, limitCents: 150000, aprBp: 2099 });
  assert.equal(texts(w).at(-1), `${a.username} got a credit card, {$} limit at 20.99%`);
  assert.equal(w.feedRows().at(-1).cents, 150000);
  w.app.events.emit('module.stress.loan', { playerId: a.id, worldId: 1, cents: 100000, aprBp: 1999 });
  assert.equal(texts(w).at(-1), `${a.username} took an emergency loan, {$} at 19.99%`);
  // a real move: the tenure takes effect at the next tick (apt1 needs its deposit: the config above gives $10,000)
  w.post('housing', '/tenure', { tenure: 'apt1' }, b);
  assert.equal(w.feedRows().length, 2, 'asking to move is not the move');   // (the card and the loan)
  w.advance(1);
  const moved = w.feedRows().find((r) => r.kind === 'move');
  assert.equal(moved.text, `${b.username} moved into 1-bedroom apartment`);
  assert.equal(moved.class_id, w.cls2.id);
  // ledger kinds, through the real ledger: the price comes from the txn's meta
  const chq = (u) => w.app.ledger.accountId('player', u.id, 'chequing');
  const sink = w.app.ledger.system('sink'), mint = w.app.ledger.system('mint');
  const post = (kind, u, meta, cents) => w.app.ledger.post({ kind, actor: `player:${u.id}`, meta, legs: [{ account: chq(u), cents: -cents }, { account: sink, cents }] });
  const before = w.feedRows().length;
  post('housing.purchase', a, { price: 15000000 }, 100000);
  post('exchange.buy', a, { ticker: 'DAAX' }, 250000);
  post('exchange.buy', a, { ticker: 'DAAX' }, 150000);                       // under $2,000: not news
  post('bank-basic.transfer', a, {}, 100);                                   // not a feed kind
  w.app.ledger.post({ kind: 'exchange.sell', actor: `player:${a.id}`, meta: { ticker: 'KEYS' }, legs: [{ account: mint, cents: -300000 }, { account: chq(a), cents: 300000 }] });
  w.app.ledger.post({ kind: 'housing.sale', actor: `player:${a.id}`, meta: { value: 16000000 }, legs: [{ account: mint, cents: -500 }, { account: chq(a), cents: 500 }] });
  const fresh = w.feedRows().slice(before);
  assert.deepEqual(fresh.map((r) => [r.kind, r.text, r.cents, r.class_id]), [
    ['home', `${a.username} bought a home for {$}`, 15000000, w.cls.id],
    ['trade', `${a.username} bought {$} of DAAX`, 250000, w.cls.id],
    ['trade', `${a.username} sold {$} of KEYS`, 300000, w.cls.id],
    ['home', `${a.username} sold their home for {$}`, 16000000, w.cls.id],
  ]);
  w.close();
});

test('town items: rates, a town event, life stage; an insurance event aimed at one class is that class\'s', async () => {
  const w = await world({ n: 1, second: 1, config: cash });
  w.post('rates', '/policy', { policy_bp: 600 }, w.teacherA);
  w.post('insurance', '/trigger', { event: 'dental', scope: 'town' }, w.teacherA);
  w.post('insurance', '/trigger', { event: 'laptop-theft', scope: 'class', class_id: w.cls2.id }, w.teacherA);
  const [r, t, c] = w.feedRows();
  assert.deepEqual([r.class_id, r.kind, r.text], [null, 'town', 'Rates: the Bank of DAA will move to 6.00% next month']);
  assert.deepEqual([t.class_id, t.text], [null, 'Town event next month: Dental emergency']);
  assert.deepEqual([c.class_id, c.text], [w.cls2.id, 'Town event next month: Laptop stolen (this class)']);
  w.post('rates', '/policy', { policy_bp: 225 }, w.teacherA);                  // back to the rate in force: cancelled, no "will move" item
  assert.equal(w.feedRows().length, 3);
  // a stage change: month 168 -> 169 is age 36, Stage B
  w.jumpTo(168);
  w.advance(1);
  const stage = w.feedRows().find((x) => /Stage B/.test(x.text));
  assert.equal(stage.class_id, null);
  assert.equal(stage.text, "Town: everyone is now 36, Stage B of life. New life costs start on this month's bills: see Life, and change them in Bills, Plans");   // stage costs (docs/stagecosts.md)
  w.close();
});

test('a student sees their class and the town, newest first, never another class; amounts render as money; own items are flagged', async () => {
  const w = await world({ n: 2, second: 1, config: cash });
  const [a, a2] = w.users, [b] = w.users2;
  w.post('jobs', '/pick', { job_id: 1 }, a);
  w.post('jobs', '/pick', { job_id: 1 }, a2);
  w.post('jobs', '/pick', { job_id: 2 }, b);
  w.app.events.emit('module.credit.limit', { playerId: a.id, worldId: 1, limitCents: 150000, aprBp: 2099 });
  w.post('insurance', '/trigger', { event: 'dental', scope: 'town' }, w.teacherA);
  const mine = w.get('feed', '/class', a);
  assert.deepEqual(mine.items.map((i) => i.id), mine.items.map((i) => i.id).sort((x, y) => y - x), 'newest first');
  assert.equal(mine.items.length, 4);
  assert.ok(mine.items.every((i) => i.class_id === w.cls.id || i.class_id === null));
  assert.ok(!mine.items.some((i) => i.text.includes(b.username)), "no classmate of another class appears");
  assert.ok(mine.items.every((i) => !('player_id' in i) && !('cents' in i)));
  assert.equal(mine.items.find((i) => i.kind === 'card').text, `${a.username} got a credit card, $1,500 limit at 20.99%`);
  assert.deepEqual(mine.items.filter((i) => i.mine).map((i) => i.kind).sort(), ['card', 'job']);
  const theirs = w.get('feed', '/class', b);
  assert.deepEqual(theirs.items.map((i) => i.kind).sort(), ['job', 'town']);
  w.close();
});

test('teacher scoping: a teacher reads only their classes and the town; another class is a 404; since returns only newer rows', async () => {
  const w = await world({ n: 1, second: 1, config: cash });
  const [a] = w.users, [b] = w.users2;
  w.post('jobs', '/pick', { job_id: 1 }, a);
  w.post('jobs', '/pick', { job_id: 2 }, b);
  w.post('insurance', '/trigger', { event: 'dental', scope: 'town' }, w.teacherA);
  const ta = w.get('feed', '/teach', w.teacherA), tb = w.get('feed', '/teach', w.teacherB);
  assert.deepEqual(ta.classes.map((c) => c.name), ['Block 1']);
  assert.deepEqual(tb.classes.map((c) => c.name), ['Block 2']);
  assert.deepEqual(ta.items.map((i) => i.kind).sort(), ['job', 'town']);
  assert.ok(ta.items.some((i) => i.username === a.username) && !ta.items.some((i) => i.username === b.username));
  assert.ok(tb.items.some((i) => i.username === b.username) && !tb.items.some((i) => i.username === a.username));
  assert.equal(w.status(() => w.get('feed', '/teach', w.teacherB, `http://t/?class_id=${w.cls.id}`)), 404);
  assert.equal(w.status(() => w.get('feed', '/teach', w.teacherA, `http://t/?class_id=${w.cls2.id}`)), 404);
  assert.equal(w.status(() => w.get('feed', '/teach', w.teacherA, 'http://t/?class_id=x')), 400);
  assert.deepEqual(w.get('feed', '/teach', w.teacherA, `http://t/?class_id=${w.cls.id}`).items.map((i) => i.kind).sort(), ['job', 'town']);
  const cursor = ta.last_id;
  assert.equal(cursor, Math.max(...ta.items.map((i) => i.id)));
  assert.deepEqual(w.get('feed', '/teach', w.teacherA, `http://t/?since=${cursor}`).items, []);
  w.post('jobs', '/assign', { player_id: a.id, job_id: 3 }, w.teacherA);
  const newer = w.get('feed', '/teach', w.teacherA, `http://t/?since=${cursor}`);
  assert.equal(newer.items.length, 1);
  assert.ok(newer.last_id > cursor);
  w.close();
});

test('the home card: "Around town", at most 8, the student\'s own items first', async () => {
  const w = await world({ n: 2, config: cash });
  const [a, a2] = w.users;
  for (let i = 0; i < 6; i++) w.app.events.emit('module.jobs.promoted', { playerId: a2.id, worldId: 1, month: 1, title: `Rank ${i}` });
  w.post('jobs', '/pick', { job_id: 1 }, a);
  for (let i = 6; i < 12; i++) w.app.events.emit('module.jobs.promoted', { playerId: a2.id, worldId: 1, month: 1, title: `Rank ${i}` });
  const cards = w.app.modules.homeCardsFor(a, 'fintech10', 'v').filter((c) => c.module === 'feed');
  assert.equal(cards.length, 1);
  assert.equal(cards[0].title, 'Around town');
  assert.equal(cards[0].src, '/m/feed/feed.js?v=v');
  const items = cards[0].data.items;
  assert.equal(items.length, 8);
  assert.equal(items[0].mine, true, 'the picked job is out of the newest 8 by recency but... it is among them, first');
  assert.ok(items.slice(1).every((i) => !i.mine));
  assert.equal(w.app.modules.homeCardsFor(a2, 'fintech10', 'v').find((c) => c.module === 'feed').data.items.filter((i) => i.mine).length, 7);
  w.close();
});

test('hide_amounts: with a leaderboards `settings` service saying hidden, students see $••• and teachers still see money; without the service amounts show', async () => {
  const d = tmpDir();
  made.push(d);
  for (const id of ['bank-basic', 'feed']) fs.symlinkSync(path.join(ROOT, 'modules', id), path.join(d, id));
  fs.mkdirSync(path.join(d, 'leaderboards'));
  const lib = pathToFileURL(path.join(ROOT, 'lib', 'modules.js')).href;
  fs.writeFileSync(path.join(d, 'leaderboards', 'index.js'), `import { defineModule } from '${lib}';\nexport default defineModule({ id: 'leaderboards', services: { settings: (k, { worldId }) => ({ hide_amounts: globalThis.hideAmounts === true, worldId }) } });\n`);
  const config = { courses: { fintech10: { label: 'FT10', modules: ['bank-basic', 'leaderboards', 'feed'] } }, options: { 'bank-basic': { startCents: 50000 } } };
  const w = await world({ n: 1, config, modulesDir: d });
  const [a] = w.users;
  w.app.events.emit('module.credit.limit', { playerId: a.id, worldId: 1, limitCents: 150000, aprBp: 2099 });
  globalThis.hideAmounts = false;
  assert.match(w.get('feed', '/class', a).items[0].text, /\$1,500 limit/);
  globalThis.hideAmounts = true;
  assert.match(w.get('feed', '/class', a).items[0].text, /\$••• limit/);
  assert.match(w.app.modules.homeCardsFor(a, 'fintech10', 'v')[0].data.items[0].text, /\$••• limit/);
  assert.match(w.get('feed', '/teach', w.teacherA).items[0].text, /\$1,500 limit/);
  delete globalThis.hideAmounts;
  w.close();
});

test('a listener never throws into its emitter: junk payloads, unknown players and even a missing table are swallowed', async () => {
  const w = await world({ n: 1, config: cash });
  const [a] = w.users;
  // events only the feed hears take any junk; the shared ones (other modules destructure their payload, and log when it is not an object) get junk objects
  const junk = [{}, { playerId: 'x', owners: 5, legs: 5, kind: 5 }, { playerId: 99999, title: {}, owners: [{ type: 'player', id: 99999 }], legs: [], kind: 'exchange.buy', txnId: 1e9, pendingBp: 'x', limitCents: 'x' },
    { playerId: a.id, title: 7, employer: [], name: {}, stage: {}, age: 'x', owners: [{ type: 'player', id: a.id }], legs: [{ cents: 1 }], kind: 'housing.sale', txnId: 'zz', pendingBp: 1e99 }];
  for (const type of ['module.jobs.hired', 'module.housing.moved', 'module.life.stage', 'module.insurance.triggered']) for (const p of [undefined, null, 5, 'x', ...junk]) assert.doesNotThrow(() => w.app.events.emit(type, p), `${type} ${JSON.stringify(p)}`);
  for (const type of ['module.jobs.promoted', 'module.credit.limit', 'ledger.posted', 'module.rates.pending']) for (const p of junk) assert.doesNotThrow(() => w.app.events.emit(type, p), `${type} ${JSON.stringify(p)}`);
  assert.equal(w.feedRows().filter((r) => r.player_id === 99999).length, 0);
  assert.equal(w.feedRows().filter((r) => r.kind === 'home').length, 0, 'a junk ledger post is not a sale');
  w.app.db.exec('DROP TABLE feed_items');
  assert.doesNotThrow(() => w.app.events.emit('module.jobs.hired', { playerId: a.id, jobId: 1, title: 'T', employer: 'E' }));
  assert.equal(w.status(() => w.post('jobs', '/pick', { job_id: 1 }, a)), 200, 'a payment-side action still succeeds with the feed broken');
  w.close();
});

test('500 rows are kept per class and for the town, pruned in the month tick; other classes and worlds are untouched', async () => {
  const w = await world({ n: 1, second: 1, config: cash });
  const wid = w.app.world.current().id;
  const ins = w.app.db.prepare("INSERT INTO feed_items (world_id, class_id, month, at, kind, player_id, text) VALUES (?, ?, 1, 0, 'town', NULL, ?)");
  for (let i = 0; i < 520; i++) ins.run(wid, w.cls.id, `a${i}`);
  for (let i = 0; i < 510; i++) ins.run(wid, null, `t${i}`);
  for (let i = 0; i < 40; i++) ins.run(wid, w.cls2.id, `b${i}`);
  const count = (c) => w.app.db.prepare('SELECT COUNT(*) AS n FROM feed_items WHERE world_id = ? AND class_id IS ?').get(wid, c).n;
  w.advance(1);
  assert.deepEqual([count(w.cls.id), count(null), count(w.cls2.id)], [500, 500, 40]);
  const oldest = (c) => w.app.db.prepare('SELECT text FROM feed_items WHERE world_id = ? AND class_id IS ? ORDER BY id LIMIT 1').get(wid, c).text;
  assert.deepEqual([oldest(w.cls.id), oldest(null)], ['a20', 't10']);          // the newest 500 stay
  assert.equal(w.get('feed', '/class', w.users[0]).items.length, 30);
  assert.equal(w.get('feed', '/teach', w.teacherA).items.length, 100);
  w.close();
});

test('the feed is a module of both courses, last in the list', () => {
  for (const [course, c] of Object.entries(CONFIG.courses)) assert.equal(c.modules.at(-1), 'feed', course);
});
