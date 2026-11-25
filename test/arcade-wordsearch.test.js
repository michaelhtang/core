// The daily word search in the Arcade (docs/arcade.md, "Word search"): the seeded puzzle builder (same inputs, same puzzle; every word exactly once;
// the level's directions; never today's FinWord answer), the line check, and the API (no word before it is found or asked for, finds, hints, stars,
// the stored puzzle, errors, the per-class switch, no money).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createClock } from '../lib/clock.js';
import { boot, seeded } from './helpers.js';
import { wordFor } from '../modules/arcade/wordle-words.js';
import { LEVELS, makePuzzle, readLine, findIndex, placedCells, stars, WORDSEARCH_TITLE } from '../modules/arcade/wordsearch.js';

const REAL = JSON.parse(fs.readFileSync(new URL('../config/vdaa.json', import.meta.url), 'utf8'));
const T0 = Date.parse('2026-11-02T15:00:00Z');                       // a Monday, 08:00 in Edmonton
const DAY = 86_400_000;
const days = (n) => Array.from({ length: n }, (_, i) => new Date(Date.UTC(2026, 10, 1 + i)).toISOString().slice(0, 10));
const rev = (s) => [...s].reverse().join('');
const lines = (grid) => {                                             // every row, column and diagonal, both ways
  const n = grid.length, out = [];
  for (const [dr, dc] of [[0, 1], [1, 0], [1, 1], [-1, 1]]) for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) {
    if (r - dr >= 0 && r - dr < n && c - dc >= 0 && c - dc < n) continue;
    let s = ''; for (let i = r, j = c; i >= 0 && i < n && j >= 0 && j < n; i += dr, j += dc) s += grid[i][j];
    out.push(s, rev(s));
  }
  return out;
};
const count = (grid, w) => lines(grid).reduce((a, s) => { let n = 0; for (let i = s.indexOf(w); i >= 0; i = s.indexOf(w, i + 1)) n++; return a + n; }, 0);

test('makePuzzle: same course, day and level give the same puzzle; levels and courses differ; every word fits its level and is there exactly once', () => {
  for (const course of ['fintech10', 'fintech2030']) for (const level of Object.keys(LEVELS)) for (const day of days(40)) {
    const p = makePuzzle(course, day, level), L = LEVELS[level];
    assert.deepEqual(p, makePuzzle(course, day, level), `${course} ${day} ${level} is reproducible`);
    assert.equal(p.size, L.size); assert.equal(p.grid.length, L.size);
    assert.ok(p.grid.every((row) => new RegExp(`^[A-Z]{${L.size}}$`).test(row)));
    assert.equal(p.words.length, L.count);
    assert.equal(new Set(p.words.map((w) => w.word)).size, L.count);
    assert.ok(!p.words.some((w) => w.word === wordFor(course, day).word), "never today's FinWord answer");
    for (const w of p.words) {
      assert.ok(L.dirs.some(([dr, dc]) => dr === w.dr && dc === w.dc), `${w.word} runs a ${level} direction`);
      assert.equal(placedCells(w).map(([r, c]) => p.grid[r][c]).join(''), w.word, `${w.word} is where it says`);
      assert.equal(count(p.grid, w.word), 1, `${w.word} appears exactly once (${course} ${day} ${level})`);
      assert.ok(w.clue && !w.clue.toUpperCase().includes(w.word) && !w.section.toUpperCase().includes(w.word), `${w.word}: the clue and section do not hold the word`);
      assert.ok(w.term && w.meaning && w.section);
      for (const o of p.words) assert.ok(!`${w.clue} ${w.section}`.toUpperCase().includes(o.word), `${w.word}'s clue does not name ${o.word}`);
    }
    const letters = new Set(p.words.map((w) => w.word).join(''));
    assert.ok([...p.grid.join('')].every((ch) => letters.has(ch)), 'filler letters come from the puzzle words');
  }
  assert.notDeepEqual(makePuzzle('fintech10', '2026-11-02', 'easy').grid, makePuzzle('fintech10', '2026-11-03', 'easy').grid);
  assert.notDeepEqual(makePuzzle('fintech10', '2026-11-02', 'easy').grid, makePuzzle('fintech2030', '2026-11-02', 'easy').grid);
  assert.equal(makePuzzle('nope', '2026-11-02', 'easy'), null);
  assert.equal(makePuzzle('__proto__', '2026-11-02', 'easy'), null);
  assert.equal(makePuzzle('fintech10', '2026-11-02', 'huge'), null);
  assert.ok(days(60).some((d) => makePuzzle('fintech10', d, 'hard').words.some((w) => w.dr < 0 || w.dc < 0)), 'Hard has backwards words');
});

test('readLine and findIndex: straight lines only, either end first, inside the grid', () => {
  const p = makePuzzle('fintech10', '2026-11-02', 'hard');
  p.words.forEach((w, i) => {
    const cells = placedCells(w), a = cells[0], z = cells[cells.length - 1];
    assert.equal(readLine(p, a, z), w.word);
    assert.equal(findIndex(p, a, z), i);
    assert.equal(findIndex(p, z, a), i, 'dragging from the last letter finds it too');
    if (cells.length > 2) assert.equal(findIndex(p, a, cells[cells.length - 2]), -1, 'one letter short is not the word');
  });
  assert.equal(readLine(p, [0, 0], [1, 2]), null, 'a knight move is not a line');
  assert.equal(readLine(p, [0, 0], [0, 10]), null);
  assert.equal(readLine(p, [-1, 0], [0, 0]), null);
  assert.equal(findIndex(p, [3, 3], [3, 3]), -1, 'a single letter finds nothing');
  assert.deepEqual([stars(0), stars(1), stars(2), stars(3), stars(9)], [3, 2, 2, 1, 1]);
});

// ---------- the API ----------
async function world() {
  let t = T0;
  const srv = await boot({ config: REAL, clock: createClock({ now: () => t }) });
  const w = await seeded(srv, 2, { transfers: false }), list = w.students;
  return { srv, ...w, advance: async (ms) => { t += ms; for (const s of list) await s.client.post('/api/login', { username: s.username, secret: s.pin }); }, cleanup: srv.cleanup };
}
const ends = (w) => { const c = placedCells(w); return [c[0], c[c.length - 1]]; };
const find = (s, level, [from, to]) => s.client.post('/api/arcade/wordsearch/find', { level, from, to });
const words = (p) => p.words.map((w) => w.word);
const leaks = (json, p, except = []) => words(p).filter((x) => !except.includes(x)).filter((x) => JSON.stringify({ ...json, grid: undefined }).toUpperCase().includes(x));

test('a puzzle: no word before it is found, a miss writes nothing, finds in either direction, done with 3 stars, then 409', async () => {
  const w = await world();
  try {
    const [a] = w.students, p = makePuzzle('fintech10', '2026-11-02', 'easy');
    const g = await a.client.get('/api/arcade/wordsearch');
    assert.equal(g.status, 200);
    assert.equal(g.json.title, WORDSEARCH_TITLE); assert.equal(g.json.level, 'easy'); assert.equal(g.json.day, '2026-11-02');
    assert.deepEqual(g.json.grid, p.grid);
    assert.deepEqual(g.json.levels, { easy: 'new', hard: 'new' });
    assert.deepEqual(leaks(g.json, p), [], 'no word outside the grid letters');
    assert.deepEqual(g.json.clues.map((c) => [c.length, c.clue, c.found]), p.words.map((x) => [x.word.length, x.clue, false]));
    const miss = await find(a, 'easy', [[0, 0], [0, 1]]);
    assert.equal(miss.status, 200); assert.equal(miss.json.hit, null);
    assert.equal(w.srv.app.db.prepare('SELECT COUNT(*) AS n FROM arcade_wordsearch').get().n, 0, 'a miss writes nothing');
    for (const [i, x] of p.words.entries()) {
      const [s, e] = ends(x), r = await find(a, 'easy', i % 2 ? [e, s] : [s, e]);
      assert.equal(r.status, 200, JSON.stringify(r.json));
      assert.equal(r.json.hit, i);
      assert.deepEqual(r.json.clues[i].cells, placedCells(x));
      assert.equal(r.json.clues[i].word, x.word); assert.equal(r.json.clues[i].meaning, x.meaning);
      assert.deepEqual(leaks(r.json, p, words(p).slice(0, i + 1)), [], 'only found words are sent');
      if (i < p.words.length - 1) assert.equal(r.json.status, 'open');
      if (i === 0) assert.equal((await find(a, 'easy', ends(x))).json.again, true, 'finding it twice says so and changes nothing');
    }
    const done = await a.client.get('/api/arcade/wordsearch?level=easy');
    assert.equal(done.json.status, 'done'); assert.equal(done.json.stars, 3); assert.equal(done.json.hints_used, 0);
    assert.deepEqual(done.json.levels, { easy: 'done', hard: 'new' });
    assert.deepEqual(done.json.stats, { done: 1, current_streak: 1, best_streak: 1 });
    assert.equal((await find(a, 'easy', ends(p.words[0]))).status, 409);
    const st = (await a.client.get('/api/arcade/state')).json.games.find((x) => x.key === 'wordsearch');
    assert.deepEqual([st.kind, st.today, st.title], ['daily', 'done', WORDSEARCH_TITLE]);
    // the other student's puzzle is the same and untouched
    const b = (await w.students[1].client.get('/api/arcade/wordsearch')).json;
    assert.deepEqual([b.grid, b.status, b.clues.filter((c) => c.found).length], [p.grid, 'open', 0]);
    // Hard is its own puzzle, and a new day is a new one; a skipped day breaks the streak
    assert.deepEqual((await a.client.get('/api/arcade/wordsearch?level=hard')).json.grid, makePuzzle('fintech10', '2026-11-02', 'hard').grid);
    await w.advance(2 * DAY);
    const d4 = (await a.client.get('/api/arcade/wordsearch')).json;
    assert.deepEqual(d4.grid, makePuzzle('fintech10', '2026-11-04', 'easy').grid);
    assert.deepEqual(d4.stats, { done: 1, current_streak: 0, best_streak: 1 });
  } finally { await w.cleanup(); }
});

test('hints: the first shows the word, the second its first cell, a third adds nothing; stars go by hints', async () => {
  const w = await world();
  try {
    const [a] = w.students, p = makePuzzle('fintech10', '2026-11-02', 'hard'), x = p.words[2];
    const hint = (n) => a.client.post('/api/arcade/wordsearch/hint', { level: 'hard', clue: n });
    let r = await hint(2);
    assert.equal(r.status, 200);
    assert.equal(r.json.clues[2].word, x.word); assert.equal(r.json.clues[2].start, undefined); assert.equal(r.json.hints_used, 1);
    assert.deepEqual(leaks(r.json, p, [x.word]), []);
    r = await hint(2);
    assert.deepEqual(r.json.clues[2].start, [x.r, x.c]); assert.equal(r.json.hints_used, 2);
    r = await hint(2);
    assert.equal(r.json.hints_used, 2, 'nothing more to show, no hint used');
    for (const y of p.words) await find(a, 'hard', ends(y));
    r = await a.client.get('/api/arcade/wordsearch?level=hard');
    assert.deepEqual([r.json.status, r.json.stars, r.json.clues[2].start], ['done', 2, undefined]);
    assert.equal((await hint(0)).status, 409);
    for (const bad of [{ level: 'hard' }, { level: 'hard', clue: 99 }, { level: 'hard', clue: -1 }, { level: 'mega', clue: 0 }, { level: ['hard'], clue: 0 }, { level: 5, clue: 0 }]) assert.equal((await a.client.post('/api/arcade/wordsearch/hint', bad)).status, 400, JSON.stringify(bad));
  } finally { await w.cleanup(); }
});

test('the stored puzzle is kept once started, even if the builder would now make another', async () => {
  const w = await world();
  try {
    const [a] = w.students, p = makePuzzle('fintech10', '2026-11-02', 'easy');
    await find(a, 'easy', ends(p.words[0]));
    const row = w.srv.app.db.prepare('SELECT puzzle FROM arcade_wordsearch WHERE player_id = ?').get(a.id);
    const stored = JSON.parse(row.puzzle);
    stored.grid[0] = 'Q'.repeat(stored.size);                       // stand-in for a list edit: the row, not the builder, is what plays
    w.srv.app.db.prepare('UPDATE arcade_wordsearch SET puzzle = ? WHERE player_id = ?').run(JSON.stringify(stored), a.id);
    assert.equal((await a.client.get('/api/arcade/wordsearch')).json.grid[0], 'Q'.repeat(stored.size));
  } finally { await w.cleanup(); }
});

test('errors: bad level or cells are 400, a teacher 403, nobody 401; switched off is 403 and leaves the grid; no money moves', async () => {
  const w = await world();
  try {
    const [a] = w.students, before = JSON.stringify((await a.client.get('/api/me')).json.accounts);
    assert.equal((await a.client.get('/api/arcade/wordsearch?level=mega')).status, 400);
    for (const bad of [{ level: 'easy' }, { level: 'easy', from: [0], to: [0, 1] }, { level: 'easy', from: [0, 'a'], to: [0, 1] }, { level: 'easy', from: [0, 0], to: [0, 1.5] }, { level: 'easy', from: [0, 0], to: [0, 99] }, { level: ['easy'], from: [0, 0], to: [0, 1] }])
      assert.equal((await a.client.post('/api/arcade/wordsearch/find', bad)).status, 400, JSON.stringify(bad));
    assert.equal((await w.teacher.get('/api/arcade/wordsearch')).status, 403);
    assert.equal((await w.srv.client().get('/api/arcade/wordsearch')).status, 401);
    const p = makePuzzle('fintech10', '2026-11-02', 'easy');
    for (const x of p.words) await find(a, 'easy', ends(x));
    assert.equal(JSON.stringify((await a.client.get('/api/me')).json.accounts), before, 'finishing pays nothing');
    assert.equal(w.srv.app.ledger.audit().ok, true);
    assert.equal((await w.teacher.post('/api/arcade/switch', { class_id: w.cls.id, game: 'wordsearch', enabled: false })).status, 200);
    assert.equal((await a.client.get('/api/arcade/wordsearch')).status, 403);
    assert.equal((await find(a, 'hard', ends(p.words[0]))).status, 403);
    assert.ok(!(await a.client.get('/api/arcade/state')).json.games.some((x) => x.key === 'wordsearch'));
  } finally { await w.cleanup(); }
});
