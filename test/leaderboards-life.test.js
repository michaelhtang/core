// leaderboards with the life module (docs/phase5-life.md 5b, "As built (5b deps)"): the Life Review's "Your life in snapshots" from life's `snapshots`
// service, and the Wolf rank cutoffs scaled by life stage. A fake `life` module stands in for the real one; without it everything is as before.
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { ROOT } from '../lib/app.js';
import { boot, seeded, tmpDir } from './helpers.js';

const MODULES_URL = pathToFileURL(path.join(ROOT, 'lib', 'modules.js')).href;
const made = [];
after(() => { for (const d of made) fs.rmSync(d, { recursive: true, force: true }); });

// mode 'ok': six snapshots for every student (ages 22-70; age 35 has a broken allocation); 'throw': the service throws; 'junk': it answers a non-array;
// 'none': life is loaded but has no snapshots service.
const fakeLife = (mode) => `import { defineModule } from '${MODULES_URL}';
const rows = (p) => [
  { age: 22, net_worth_cents: 50000 }, { age: 25, net_worth_cents: 1200000 + p, allocation: { equities: 600000, bonds: 200000, cash: 200000, other: 0 } },
  { age: 35, net_worth_cents: 9000000, allocation: { equities: -1 } }, { age: 55, net_worth_cents: 45000000 }, { age: 65, net_worth_cents: 80000000, allocation: { equities: 30000000, bonds: 30000000, cash: 10000000 } },
  { age: 70, net_worth_cents: 70000000 }];
export const seen = [];
export default defineModule({ id: 'life', ${mode === 'none' ? '' : `services: { snapshots(k, args) { seen.push(args); ${mode === 'throw' ? "throw new Error('no snapshots yet');" : mode === 'junk' ? "return { not: 'an array' };" : 'return rows(args.playerId);'} } }`} });`;

async function world({ life, options = {} } = {}) {
  const d = tmpDir(); made.push(d);
  const mods = ['bank-basic', 'savings', 'leaderboards', ...(life ? ['life'] : [])];
  for (const id of ['bank-basic', 'savings', 'leaderboards']) fs.symlinkSync(path.join(ROOT, 'modules', id), path.join(d, id));
  if (life) { fs.mkdirSync(path.join(d, 'life')); fs.writeFileSync(path.join(d, 'life', 'index.js'), fakeLife(life)); }
  const config = { courses: { fintech10: { label: 'x', modules: mods }, fintech2030: { label: 'y', modules: mods } }, options: { 'bank-basic': { startCents: 50000 }, leaderboards: options } };
  const srv = await boot({ config, modulesDir: d });
  const t = await seeded(srv, 2, { transfers: false });
  const board = async (s) => (await s.client.get('/api/leaderboards/board')).json;
  const give = (s, cents) => srv.app.ledger.post({ kind: 'test.grant', legs: [{ account: srv.app.ledger.system('mint'), cents: -cents }, { account: s.chequing.id, cents }] });
  return { srv, app: srv.app, ...t, board, give, life: life ? await import(pathToFileURL(path.join(d, 'life', 'index.js')).href) : null };
}

test('Life Review: "Your life in snapshots" (net worth at 25/35/55/65/70, allocation at 25 and 65) from life.snapshots, frozen at season close', async () => {
  const w = await world({ life: 'ok' });
  try {
    const [a, b] = w.students;
    w.app.world.advance({ months: 2 });
    assert.equal((await w.teacher.post('/api/teach/world/close')).status, 200);
    const r = (await w.board(a)).last_season;
    assert.deepEqual(r.life, {
      net_worth: [{ age: 25, net_worth_cents: 1200000 + a.id }, { age: 35, net_worth_cents: 9000000 }, { age: 55, net_worth_cents: 45000000 }, { age: 65, net_worth_cents: 80000000 }, { age: 70, net_worth_cents: 70000000 }],
      allocation: [{ age: 25, parts: { equities: 600000, bonds: 200000, cash: 200000, other: 0 } }, { age: 65, parts: { equities: 30000000, bonds: 30000000, cash: 10000000, other: 0 } }],
    });
    assert.equal((await w.board(b)).last_season.life.net_worth[0].net_worth_cents, 1200000 + b.id, 'each student their own');
    assert.deepEqual(w.life.seen.map((x) => x.playerId).sort(), [a.id, b.id].sort());
    assert.ok(w.life.seen.every((x) => x.worldId === w.app.world.current().id));
    // the rest of the review is what it always was
    assert.deepEqual(Object.keys(r).sort(), ['best_month', 'flags', 'health', 'life', 'net_worth_cents', 'of_town', 'parts', 'rank_class', 'rank_town', 'season', 'tier']);
  } finally { await w.srv.cleanup(); }
});

for (const mode of [null, 'throw', 'junk', 'none']) {
  test(`Life Review without usable snapshots (${mode ?? 'no life module'}): the season closes and the review has no life section`, async () => {
    const w = await world({ life: mode });
    try {
      const [a] = w.students;
      w.app.world.advance({ months: 2 });
      assert.equal((await w.teacher.post('/api/teach/world/close')).status, 200);
      const r = (await w.board(a)).last_season;
      assert.equal(r.season, 'Season 1');
      assert.equal('life' in r, false);
      assert.equal(w.app.ledger.audit().ok, true);
    } finally { await w.srv.cleanup(); }
  });
}

test('Wolf cutoffs by life stage, pure: the stage of each boundary month, and the factor on top of the price index', async () => {
  const { STAGE_FACTORS, stageOfMonth, DEFAULT_THRESHOLDS } = await import('../modules/leaderboards/constants.js');
  const { thresholds } = await import('../modules/leaderboards/health.js');
  assert.deepEqual([1, 168, 169, 396, 397, 576].map(stageOfMonth), ['A', 'A', 'B', 'B', 'C', 'C']);
  assert.equal(STAGE_FACTORS.A, 1);
  assert.ok(STAGE_FACTORS.A < STAGE_FACTORS.B && STAGE_FACTORS.B < STAGE_FACTORS.C);
  assert.deepEqual(thresholds({}, 10000, 1), thresholds({}, 10000), 'factor 1 is today');
  assert.equal(thresholds({}, 12000, STAGE_FACTORS.B)[0], Math.round(DEFAULT_THRESHOLDS.scout * 1.2 * STAGE_FACTORS.B));
});

for (const life of ['ok', null]) {
  test(`Wolf cutoffs ${life ? 'with life: stage A as today, then the stage B factor from month 169' : 'without life: the same cutoffs at every month'}`, async () => {
    const { STAGE_FACTORS, DEFAULT_THRESHOLDS } = await import('../modules/leaderboards/constants.js');
    const w = await world({ life });
    try {
      const [a] = w.students;
      w.give(a, 4000000 - 50000);                                                       // $40,000: Pack Leader at today's cutoffs ($35,000)
      w.app.db.prepare('UPDATE worlds SET month = 167').run();
      w.app.world.advance({ months: 1 });                                               // month 168: the end of stage A
      let me = (await w.board(a)).me;
      assert.equal(me.tier, 'Pack Leader');
      assert.equal(me.next.at_cents, Math.round(DEFAULT_THRESHOLDS.alpha / 100000) * 100000);
      w.app.world.advance({ months: 1 });                                               // month 169: stage B
      me = (await w.board(a)).me;
      const f = life ? STAGE_FACTORS.B : 1;
      const cut = [DEFAULT_THRESHOLDS.scout, DEFAULT_THRESHOLDS.hunter, DEFAULT_THRESHOLDS.packLeader, DEFAULT_THRESHOLDS.alpha].map((c) => c * f);
      const tier = cut.filter((c) => 4000000 >= c).length;
      assert.equal(me.tier_index, tier);
      if (life) assert.ok(tier < 3, 'the same savings rank lower in stage B');
      assert.equal(me.next.at_cents, Math.round(cut[tier] / 100000) * 100000);
      const ups = w.app.db.prepare('SELECT COUNT(*) AS n FROM leaderboards_rankups WHERE player_id = ?').get(a.id).n;
      w.app.world.advance({ months: 1 });
      assert.equal(w.app.db.prepare('SELECT COUNT(*) AS n FROM leaderboards_rankups WHERE player_id = ?').get(a.id).n, ups, 'a stage change is no rank-up');
    } finally { await w.srv.cleanup(); }
  });
}
