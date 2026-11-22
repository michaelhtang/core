// games (modules/games): Mr. Tang's games on their own sites. STAX North, Money Month and Tax Desk are links in the Arcade; TradeLab is a door of
// its own in every course. Links only. Checks: the door in /api/me, the list per course (Tax Desk only for FinTech 20/30), the UI files served,
// the Arcade asking for the list, access and module off.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { boot, seeded } from './helpers.js';
import { GAMES, TRADELAB, gamesFor } from '../modules/games/index.js';

const REAL = JSON.parse(fs.readFileSync(new URL('../config/vdaa.json', import.meta.url), 'utf8'));

async function studentIn(srv, teacher, course) {
  const cls = (await teacher.post('/api/teach/classes', { name: `Block ${course}`, course })).json;
  const [s] = (await teacher.post(`/api/teach/classes/${cls.id}/students`, { count: 1 })).json.students;
  const c = srv.client();
  assert.equal((await c.post('/api/login', { username: s.username, secret: s.pin })).status, 200);
  return c;
}

test('gamesFor: everyone gets STAX North and Money Month; Tax Desk is FinTech 20/30 only; TradeLab is not an Arcade link', () => {
  assert.deepEqual(gamesFor('fintech10').map((g) => g.id), ['stax', 'payday']);
  assert.deepEqual(gamesFor('fintech2030').map((g) => g.id), ['stax', 'payday', 'taxdesk']);
  for (const g of [...GAMES, TRADELAB]) assert.match(g.url, /^https:\/\/([a-z]+\.)?michaelhtang\.com\//, g.id);
  assert.ok(gamesFor('fintech2030').every((g) => !('courses' in g)), 'the course list stays on the server');
});

test('both courses: a TradeLab door, the list per course, the UI files served', async () => {
  for (const course of ['fintech10', 'fintech2030']) assert.ok(REAL.courses[course].modules.includes('games'), course);
  const srv = await boot({ config: REAL });
  try {
    const { teacher } = await seeded(srv, 1);
    for (const [course, ids] of [['fintech10', ['stax', 'payday']], ['fintech2030', ['stax', 'payday', 'taxdesk']]]) {
      const c = await studentIn(srv, teacher, course);
      const me = (await c.get('/api/me')).json;
      const mine = me.panels.filter((p) => p.module === 'games');
      assert.deepEqual(mine.map((p) => [p.building.key, p.building.name]), [['tradelab', 'TradeLab']], course);
      const list = await c.get('/api/games/list');
      assert.equal(list.status, 200);
      assert.deepEqual(list.json.games.map((g) => g.id), ids, course);
      assert.equal(list.json.tradelab.url, 'https://tradelab.michaelhtang.com/');
      for (const p of mine) {
        const res = await fetch(srv.base + p.src);
        assert.equal(res.status, 200, p.src);
        assert.doesNotMatch(await res.text(), /__V__/);
      }
    }
    const list = await fetch(`${srv.base}/m/games/list.js`);
    assert.equal(list.status, 200);
    for (const g of [...GAMES, TRADELAB]) {
      const pic = await fetch(`${srv.base}/m/games/thumbs/${g.id}.jpg`);
      assert.equal(pic.status, 200, `thumbnail for ${g.id}`);
      assert.equal(pic.headers.get('content-type'), 'image/jpeg');
    }
    assert.equal((await fetch(`${srv.base}/m/games/games.css`)).status, 200);
    const arcade = await (await fetch(`${srv.base}/m/arcade/arcade.js`)).text();
    assert.match(arcade, /import\('\/m\/games\/list\.js\?v=[^_]/, 'the Arcade loads the links (with the cache token filled in)');
    assert.equal((await srv.client().get('/api/games/list')).status, 401, 'not signed in');
  } finally { await srv.cleanup(); }
});

test('module off for a course: no doors and no list there', async () => {
  const config = structuredClone(REAL);
  config.courses.fintech10.modules = config.courses.fintech10.modules.filter((m) => m !== 'games');
  const srv = await boot({ config });
  try {
    const { teacher } = await seeded(srv, 1);
    const c = await studentIn(srv, teacher, 'fintech10');
    assert.ok(!(await c.get('/api/me')).json.panels.some((p) => p.module === 'games'));
    assert.equal((await c.get('/api/games/list')).status, 404);
  } finally { await srv.cleanup(); }
});
