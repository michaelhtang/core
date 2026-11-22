// The TFSA and RRSP dollar limits over a 48-year life (docs/phase5-life.md 5b, "As built (5b deps)"): with the life module and rates loaded, each world
// year's limits are the base x the price index at the start of that year (TFSA to the nearest $500, RRSP to the nearest $10), frozen at the year's first tick.
// Without life nothing changes. A fake `life` module (no hooks) stands in for the real one; income reaches the exchange as module.jobs.paid.
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { ROOT } from '../lib/app.js';
import { boot, seeded, tmpDir } from './helpers.js';
import { tfsaRoom, rrspRoom, indexedTfsa, indexedRrsp } from '../modules/exchange/orders.js';

const MODULES_URL = pathToFileURL(path.join(ROOT, 'lib', 'modules.js')).href;
const made = [];
after(() => { for (const d of made) fs.rmSync(d, { recursive: true, force: true }); });

test('indexed limits, pure: year 1 is today\'s $7,000 / $33,810; after 24 years of 2.1% the limits are larger by the index; per-year limits feed the room', () => {
  assert.equal(indexedTfsa(10000), 700000); assert.equal(indexedRrsp(10000), 3381000);
  let idx = 10000;
  for (let y = 2; y <= 25; y++) idx = Math.round((idx * 10210) / 10000);                 // rates steps the index once a world year, rounded to a basis point
  assert.equal(idx, 16468);
  assert.equal(indexedTfsa(idx), 1150000);                                               // 7,000 x 1.6468 = 11,527.60 -> $11,500
  assert.equal(indexedRrsp(idx), 5568000);                                               // 33,810 x 1.6468 = 55,678.31 -> $55,680
  // the number form still works, and a function gives each year its own limit
  assert.equal(tfsaRoom(3, []), 2100000);
  assert.equal(tfsaRoom(3, [], (y) => [0, 700000, 750000, 800000][y]), 2250000);
  assert.equal(rrspRoom(3, { 1: 30000000, 2: 30000000 }, 0, (y) => [0, 0, 3381000, 3500000][y]), 6881000);
});

async function world({ life = true, inflationBp = 1000 } = {}) {
  const d = tmpDir(); made.push(d);
  const mods = ['bank-basic', 'rates', 'exchange', ...(life ? ['life'] : [])];
  for (const id of ['bank-basic', 'rates', 'exchange']) fs.symlinkSync(path.join(ROOT, 'modules', id), path.join(d, id));
  if (life) { fs.mkdirSync(path.join(d, 'life')); fs.writeFileSync(path.join(d, 'life', 'index.js'), `import { defineModule } from '${MODULES_URL}';\nexport default defineModule({ id: 'life' });`); }
  const config = { courses: { fintech10: { label: 'x', modules: mods }, fintech2030: { label: 'y', modules: mods } }, options: { 'bank-basic': { startCents: 10_000_000 }, rates: { inflationBp } } };
  const srv = await boot({ config, modulesDir: d });
  const t = await seeded(srv, 1, { transfers: false });
  const { app } = srv;
  const [s] = t.students;
  const st = async () => (await s.client.get('/api/exchange/state')).json;
  const put = (account, cents) => s.client.post('/api/exchange/contribute', { account, cents });
  const year = (y, gross) => { for (let m = 1; m <= 12; m++) app.events.emit('module.jobs.paid', { playerId: s.id, worldId: app.world.current().id, month: (y - 1) * 12 + m, gross, net: gross }); };
  return { srv, app, s, st, put, year, toMonth: (m) => { while (app.world.current().month < m) app.world.advance({ months: Math.min(12, m - app.world.current().month) }); } };
}

test('with life: each year\'s limits follow the index at its start and are frozen there; carried-forward room keeps the old years\' limits', async () => {
  const w = await world();
  try {
    let x = await w.st();
    assert.deepEqual([x.tfsa.limit_cents, x.tfsa.room_cents, x.tfsa.indexed, x.rrsp.limit_cents], [700000, 700000, true, 3381000], 'year 1: today\'s numbers');
    assert.equal((await w.put('tfsa', 200000)).status, 200);
    w.year(1, 3_000_000);                                                                 // $360,000 of pay in year 1: 18% is over any cap
    w.toMonth(13);                                                                        // year 2: the index stepped 10% at this tick
    assert.equal(w.app.world.priceIndex(), 11000);
    x = await w.st();
    assert.equal(x.tfsa.limit_cents, 750000);                                             // 7,700 -> nearest $500
    assert.equal(x.tfsa.room_cents, 700000 + 750000 - 200000);
    assert.equal(x.tfsa.limits_total_cents, 1450000);
    assert.equal(x.rrsp.limit_cents, 3719000);                                            // 37,191 -> nearest $10
    assert.equal(x.rrsp.room_cents, 3719000, 'year 2 room: 18% of year 1 pay, up to YEAR 2\'s indexed cap');
    // frozen: a mid-year change to the index (it only moves at year ends) does not move this year's limits
    w.app.db.prepare('UPDATE price_index SET index_bp = 20000 WHERE world_id = ?').run(w.app.world.current().id);
    w.toMonth(20);
    assert.equal((await w.st()).tfsa.limit_cents, 750000);
    w.app.db.prepare('UPDATE price_index SET index_bp = 11000 WHERE world_id = ?').run(w.app.world.current().id);
    assert.equal((await w.put('tfsa', 100000)).status, 200);
    w.toMonth(25);                                                                        // year 3: index 12100
    x = await w.st();
    assert.equal(x.tfsa.limit_cents, 850000);                                             // 8,470 -> $8,500
    assert.equal(x.tfsa.room_cents, 700000 + 750000 + 850000 - 300000, 'years 1 and 2 keep the limits they were frozen at');
    assert.deepEqual(w.app.db.prepare('SELECT year, tfsa_cents, rrsp_cents, index_bp FROM exchange_limits ORDER BY year').all().map((r) => ({ ...r })),
      [{ year: 2, tfsa_cents: 750000, rrsp_cents: 3719000, index_bp: 11000 }, { year: 3, tfsa_cents: 850000, rrsp_cents: 4091000, index_bp: 12100 }]);
    const over = await w.put('tfsa', x.tfsa.room_cents + 1);
    assert.equal(over.status, 400); assert.match(over.json.error, /TFSA room/);
    assert.equal((await w.put('tfsa', x.tfsa.room_cents)).status, 200);
    assert.equal((await w.st()).tfsa.room_cents, 0);
  } finally { await w.srv.cleanup(); }
});

test('without life: the limits stay $7,000 and $33,810 whatever the index, and nothing is frozen', async () => {
  const w = await world({ life: false });
  try {
    w.year(1, 3_000_000);
    w.toMonth(25);
    assert.equal(w.app.world.priceIndex(), 12100);
    const x = await w.st();
    assert.deepEqual([x.tfsa.limit_cents, x.tfsa.room_cents, x.tfsa.indexed, x.rrsp.limit_cents, x.rrsp.room_cents], [700000, 2100000, false, 3381000, 3381000]);
    assert.equal(w.app.db.prepare('SELECT COUNT(*) AS n FROM exchange_limits').get().n, 0);
  } finally { await w.srv.cleanup(); }
});
