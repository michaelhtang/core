// The whole road on the REAL content (default content dir): one student plays every level of every unit that has levels, in road order.
// Passes with one unit or twenty; the engine tests use test/learn-fixture.js instead.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createClock } from '../lib/clock.js';
import { boot, seeded } from './helpers.js';
import { rewardFor } from '../modules/learn/index.js';

const COURSE = JSON.parse(fs.readFileSync(new URL('../modules/learn/content/fintech10.json', import.meta.url), 'utf8'));
const right = (q) => (q.type === 'number' ? (q.unit === '$' ? (q.answer / 100).toFixed(2) : String(q.answer)) : q.answer);
const ROAD = COURSE.sections.flatMap((s) => s.units.flatMap((u) => u.levels));

test('the whole road: every level in order, each locked until the one before is finished, each first completion pays rewardFor', async () => {
  let t = Date.parse('2026-11-02T15:00:00Z');
  const modules = ['bank-basic', 'learn'];
  const srv = await boot({ config: { courses: { fintech10: { label: 'x', modules }, fintech2030: { label: 'y', modules } } }, clock: createClock({ now: () => t }) });
  try {
    const { students: [s] } = await seeded(srv, 1, { transfers: false });
    const post = (p, body) => { t += 400; return s.client.post(p, body); };
    assert.ok(ROAD.length > 0);
    for (const [i, level] of ROAD.entries()) {
      const st = (await s.client.get('/api/learn/state')).json;
      assert.equal(st.next.level_id, level.id, `level ${i} is next`);
      assert.equal(st.totals.levels_done, i);
      if (ROAD[i + 1]) assert.equal((await post('/api/learn/start', { level_id: ROAD[i + 1].id })).status, 403, `${ROAD[i + 1].id} is locked`);
      assert.equal((await post('/api/learn/start', { level_id: level.id })).status, 200);
      for (const q of level.questions) {
        const r = await post('/api/learn/answer', { level_id: level.id, question_id: q.id, value: right(q) });
        assert.equal(r.json.correct, true, `${q.id}: ${JSON.stringify(r.json)}`);
      }
      const fin = (await post('/api/learn/finish', { level_id: level.id })).json;
      assert.equal(fin.reward_cents, rewardFor(fin.first_try, fin.reward.index_bp).cents, level.id);
      assert.equal(fin.first_try, level.questions.length, `${level.id}: all right first try`);
      if (ROAD[i + 1]) assert.equal(fin.next.level_id, ROAD[i + 1].id);
      else assert.equal(fin.next, null);
    }
    const end = (await s.client.get('/api/learn/state')).json;
    assert.equal(end.totals.levels_done, end.totals.levels_total);
    assert.equal(end.totals.levels_total, ROAD.length);
  } finally { await srv.cleanup(); }
});
