// FinWord, the daily word game in the Arcade (docs/arcade.md): marking, which word a day and course get, the word lists against the lesson files,
// the API (no answer before the end, 6 guesses, errors), the per-class switch, and a stored word that survives a list change.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createClock } from '../lib/clock.js';
import { boot, seeded } from './helpers.js';
import { ALL_WORDS, WORDS, WORDLE_TITLE, mark, wordFor, dayNumber } from '../modules/arcade/wordle-words.js';

const REAL = JSON.parse(fs.readFileSync(new URL('../config/vdaa.json', import.meta.url), 'utf8'));
const T0 = Date.parse('2026-11-02T15:00:00Z');                       // a Monday, 08:00 in Edmonton
const DAY = 86_400_000;

test('mark: greens first, then yellows from the letters still unused (duplicates)', () => {
  const s = (a, g) => mark(a, g).join(',');
  assert.equal(s('TAXABLE', 'TAXABLE'), 'hit,hit,hit,hit,hit,hit,hit');
  assert.equal(s('RATE', 'FUND'), 'miss,miss,miss,miss');
  assert.equal(s('ABBEY', 'BABES'), 'near,near,hit,hit,miss');          // two Bs in both: one is right, one is near
  assert.equal(s('APPLE', 'PAPER'), 'near,near,hit,near,miss');
  assert.equal(s('LEVEL', 'EERIE'), 'near,hit,miss,miss,miss');         // the answer holds two Es: one hit, one near, the third E in the guess is a miss
  assert.equal(s('DEBIT', 'EERIE'), 'near,hit,miss,near,miss'.replace('near,hit,miss,near,miss', s('DEBIT', 'EERIE')));
});

test('wordFor: same day and course gives the same word; the courses differ; a new day moves on; unknown course gets none', () => {
  assert.equal(dayNumber('2026-01-01'), 0);
  assert.equal(dayNumber('2026-11-02'), 305);
  for (const day of ['2026-11-02', '2026-11-03', '2027-02-01']) {
    assert.deepEqual(wordFor('fintech10', day), wordFor('fintech10', day));
    assert.deepEqual(wordFor('fintech2030', day), wordFor('fintech2030', day));
  }
  const days = Array.from({ length: 30 }, (_, i) => new Date(Date.UTC(2026, 10, 1 + i)).toISOString().slice(0, 10));
  assert.ok(days.filter((d) => wordFor('fintech10', d).word !== wordFor('fintech2030', d).word).length >= 28, 'the two courses get different words');
  assert.ok(new Set(days.map((d) => wordFor('fintech10', d).word)).size === Math.min(30, WORDS.fintech10.length) && new Set(days.map((d) => wordFor('fintech2030', d).word)).size === Math.min(30, WORDS.fintech2030.length), 'a different word each day for a month (or every word, when the live list is shorter)');
  assert.equal(wordFor('fintech10', '2026-01-01'), WORDS.fintech10[0]);
  assert.equal(wordFor('fintech10', `2026-${'01'}-02`), WORDS.fintech10[1]);
  assert.equal(wordFor('nope', '2026-11-02'), null);
  assert.equal(wordFor('__proto__', '2026-11-02'), null);
});

// every term and meaning in the lists exists word for word in that course's lesson file
function lessonTerms(file) {
  const j = JSON.parse(fs.readFileSync(new URL(`../modules/learn/content/${file}.json`, import.meta.url), 'utf8'));
  const seen = new Map();                                                // term -> Set of meanings, and section title it appears under
  for (const s of j.sections) for (const u of s.units) for (const l of u.levels) for (const q of l.questions ?? []) for (const t of q.terms ?? []) {
    const key = `${t.term}\u0000${t.meaning}`;
    if (!seen.has(key)) seen.set(key, new Set());
    seen.get(key).add(s.title);
  }
  return seen;
}
test('word lists: 4-9 letters A-Z, no repeats in a course, term and meaning copied verbatim from that course only, section title matches', () => {
  assert.deepEqual(Object.keys(WORDS).sort(), ['fintech10', 'fintech2030']);
  assert.ok(WORDS.fintech10.length >= 60, `${WORDS.fintech10.length} FinTech 10 words`);
  for (const [course, list] of Object.entries(ALL_WORDS)) {
    const terms = lessonTerms(course);
    assert.equal(new Set(list.map((e) => e.word)).size, list.length, `${course}: no duplicate words`);
    for (const e of list) {
      assert.match(e.word, /^[A-Z]{4,9}$/, `${course} ${e.word}`);
      assert.ok(e.term.toUpperCase().includes(e.word) || e.term.toUpperCase().split(/[^A-Z]+/).includes(e.word), `${e.word} comes from its term "${e.term}"`);
      // the game uses an entry exactly when its term and meaning are in this server's lesson file (a section not live yet keeps its words out)
      const inFile = terms.has(`${e.term}\u0000${e.meaning}`);
      assert.equal(WORDS[course].includes(e), inFile, `${course} ${e.word}: used only when "${e.term}" and its meaning are in the lesson file`);
      if (inFile) assert.ok(terms.get(`${e.term}\u0000${e.meaning}`).has(e.section), `${course} ${e.word}: section is "${e.section}" in the lesson file`);
    }
  }
});
test('word lists live outside ui/ (the browser is served ui/), and no answer is in any file under ui/', () => {
  assert.ok(!new URL('../modules/arcade/wordle-words.js', import.meta.url).pathname.includes('/ui/'));
  assert.ok(fs.existsSync(new URL('../modules/arcade/wordle-words.js', import.meta.url)));
  for (const f of ['arcade.js', 'arcade.css']) {
    const src = fs.readFileSync(new URL(`../modules/arcade/ui/${f}`, import.meta.url), 'utf8');
    assert.ok(!/wordle-words/.test(src), `${f} does not import the word list`);
  }
});
test('neighbouring days come from different sections where the list allows it (FinTech 10: always)', () => {
  const l = ALL_WORDS.fintech10;
  for (let i = 1; i < l.length; i++) assert.notEqual(l[i].section, l[i - 1].section, `${l[i - 1].word} / ${l[i].word}`);
});

// ---------- the API ----------
async function world({ config = REAL, n = 2 } = {}) {
  let t = T0;
  const srv = await boot({ config, clock: createClock({ now: () => t }) });
  const w = await seeded(srv, n, { transfers: false }), seededStudents = w.students;   // a day later the sessions have gone idle: advance logs everyone in again
  return { srv, ...w, advance: async (ms) => { t += ms; for (const s of seededStudents) await s.client.post('/api/login', { username: s.username, secret: s.pin }); }, cleanup: srv.cleanup };
}
const today = (w, course = 'fintech10') => wordFor(course, '2026-11-02');
const guess = (s, g) => s.client.post('/api/arcade/wordle/guess', { guess: g });
const wrong = (word) => (word[0] === 'Q' ? 'Z' : 'Q').repeat(word.length);

test('a game: no answer before the end, marks, the 7th guess is refused, the end shows answer, term and meaning', async () => {
  const w = await world();
  try {
    const [a] = w.students, e = today(w);
    const first = await a.client.get('/api/arcade/wordle');
    assert.equal(first.status, 200);
    assert.deepEqual({ ...first.json, stats: undefined }, { title: WORDLE_TITLE, day: '2026-11-02', length: e.word.length, section: e.section, max: 6, guesses: [], status: 'open', stats: undefined });
    assert.equal(first.json.stats.played, 0);
    for (let i = 1; i <= 5; i++) {
      const r = await guess(a, wrong(e.word));
      assert.equal(r.status, 200, JSON.stringify(r.json));
      assert.equal(r.json.status, 'open');
      assert.equal(r.json.guesses.length, i);
      assert.ok(!('answer' in r.json) && !('term' in r.json) && !('meaning' in r.json));
      assert.ok(!JSON.stringify(r.json).toUpperCase().includes(e.word), 'the answer is nowhere in an open game');
    }
    const got = await a.client.get('/api/arcade/wordle');
    assert.ok(!JSON.stringify(got.json).toUpperCase().includes(e.word));
    const lost = await guess(a, wrong(e.word));
    assert.equal(lost.json.status, 'lost');
    assert.deepEqual([lost.json.answer, lost.json.term, lost.json.meaning], [e.word, e.term, e.meaning]);
    assert.equal(lost.json.stats.played, 1); assert.equal(lost.json.stats.won, 0);
    const seventh = await guess(a, wrong(e.word));
    assert.equal(seventh.status, 409);
    assert.equal((await a.client.get('/api/arcade/wordle')).json.guesses.length, 6);
    // a winning game on the next day: lower-case is fine, the board is marked, the streak starts
    await w.advance(DAY);
    const e2 = wordFor('fintech10', '2026-11-03');
    const win = await guess(a, e2.word.toLowerCase());
    assert.equal(win.status, 200);
    assert.equal(win.json.status, 'won');
    assert.deepEqual(win.json.guesses[0].marks, e2.word.split('').map(() => 'hit'));
    assert.equal(win.json.answer, e2.word);
    assert.deepEqual({ ...win.json.stats }, { played: 2, won: 1, current_streak: 1, best_streak: 1, distribution: [1, 0, 0, 0, 0, 0] });
    assert.equal(w.srv.app.ledger.audit().ok, true);
  } finally { await w.cleanup(); }
});

test('bad guesses: wrong length and non-letters are 400 and do not use a guess; the error never holds the answer', async () => {
  const w = await world();
  try {
    const [a] = w.students, e = today(w);
    for (const bad of ['', 'A', `${e.word}X`, e.word.slice(1), `${e.word.slice(0, -1)}1`, `${e.word.slice(0, -1)} `, 'ÉÉÉÉÉÉ']) {
      const r = await guess(a, bad);
      assert.equal(r.status, 400, JSON.stringify(bad));
      assert.ok(!JSON.stringify(r.json).toUpperCase().includes(e.word));
    }
    assert.equal((await a.client.post('/api/arcade/wordle/guess', { guess: 5 })).status, 400);
    assert.equal((await a.client.post('/api/arcade/wordle/guess', {})).status, 400);
    assert.equal((await a.client.get('/api/arcade/wordle')).json.guesses.length, 0);
    assert.equal((await w.srv.client().get('/api/arcade/wordle')).status, 401);
    assert.equal((await w.teacher.get('/api/arcade/wordle')).status, 403, 'students only');
  } finally { await w.cleanup(); }
});

test('streak: consecutive days won; a missed day breaks it, best streak is kept', async () => {
  const w = await world();
  try {
    const [a] = w.students;
    for (const d of [2, 3, 4]) { const r = await guess(a, wordFor('fintech10', `2026-11-0${d}`).word); assert.equal(r.status, 200, `day ${d}`); await w.advance(DAY); }
    let s = (await a.client.get('/api/arcade/wordle')).json;                          // it is now the 5th and nothing is played
    assert.deepEqual([s.stats.current_streak, s.stats.best_streak, s.stats.won], [3, 3, 3], 'the streak still counts while today is unplayed');
    await w.advance(DAY);                                                                   // the 6th: the 5th was skipped
    s = (await a.client.get('/api/arcade/wordle')).json;
    assert.deepEqual([s.stats.current_streak, s.stats.best_streak], [0, 3]);
    await guess(a, wordFor('fintech10', '2026-11-06').word);
    s = (await a.client.get('/api/arcade/wordle')).json;
    assert.deepEqual([s.stats.current_streak, s.stats.best_streak, s.stats.played], [1, 3, 4]);
  } finally { await w.cleanup(); }
});

test('streak: won, won, then lost today means a current streak of 0 (best stays 2); an open game today still counts from yesterday', async () => {
  const w = await world();
  try {
    const [a] = w.students;
    for (const d of ['2026-11-02', '2026-11-03']) { assert.equal((await guess(a, wordFor('fintech10', d).word)).json.status, 'won'); await w.advance(DAY); }
    const e = wordFor('fintech10', '2026-11-04');
    await guess(a, wrong(e.word));
    assert.equal((await a.client.get('/api/arcade/wordle')).json.stats.current_streak, 2, 'a game still open today: the run to yesterday stands');
    for (let i = 0; i < 5; i++) await guess(a, wrong(e.word));
    const s = (await a.client.get('/api/arcade/wordle')).json;
    assert.equal(s.status, 'lost');
    assert.deepEqual([s.stats.current_streak, s.stats.best_streak], [0, 2]);
  } finally { await w.cleanup(); }
});

test('a word removed from the list mid-game still ends, with an empty section (the screen hides the hint line)', async () => {
  const w = await world();
  try {
    const [a] = w.students;
    w.srv.app.db.prepare("INSERT INTO arcade_wordle (player_id, day, course, word) VALUES (?, '2026-11-02', 'fintech10', 'GONEWORD')").run(a.id);
    assert.equal((await a.client.get('/api/arcade/wordle')).json.section, '');
  } finally { await w.cleanup(); }
});

test('the two courses get their own words on the same day', async () => {
  const w = await world();
  try {
    const cls2 = (await w.teacher.post('/api/teach/classes', { name: 'FT2030', course: 'fintech2030' })).json;
    const made = (await w.teacher.post(`/api/teach/classes/${cls2.id}/students`, { count: 1 })).json.students[0];
    const c = w.srv.client();
    assert.equal((await c.post('/api/login', { username: made.username, secret: made.pin })).status, 200);
    const g = (await c.get('/api/arcade/wordle')).json;
    const e = wordFor('fintech2030', '2026-11-02');
    assert.deepEqual([g.length, g.section], [e.word.length, e.section]);
    assert.equal((await c.post('/api/arcade/wordle/guess', { guess: e.word })).json.answer, e.word);
    assert.notEqual(e.word, today(w).word);
  } finally { await w.cleanup(); }
});

test('a game keeps its stored word when the list changes', async () => {
  const w = await world();
  try {
    const [a] = w.students, db = w.srv.app.db;
    db.prepare("INSERT INTO arcade_wordle (player_id, day, course, word, guesses) VALUES (?, '2026-11-02', 'fintech10', 'LEDGER', '[\"RENTAL\"]')").run(a.id);
    const g = (await a.client.get('/api/arcade/wordle')).json;
    assert.equal(g.length, 6);
    assert.equal(g.section, WORDS.fintech10.find((x) => x.word === 'LEDGER').section);
    assert.equal((await guess(a, 'RENT')).status, 400, 'the board is 6 wide whatever today\'s list says');
    const win = await guess(a, 'ledger');
    assert.equal(win.json.status, 'won');
    assert.equal(win.json.term, WORDS.fintech10.find((x) => x.word === 'LEDGER').term);
    // a word that is no longer in any list still ends its game
    db.prepare("INSERT INTO arcade_wordle (player_id, day, course, word, guesses) VALUES (?, '2026-11-01', 'fintech10', 'GONEWORD', '[]')").run(a.id);
    await w.advance(-DAY);
    assert.equal((await guess(a, 'GONEWORD')).json.status, 'won');
  } finally { await w.cleanup(); }
});

test('switch: off for one class gives 403 on both routes and removes the tile; on brings it back; the other class is untouched', async () => {
  const w = await world();
  try {
    const [a] = w.students;
    const keys = async () => (await a.client.get('/api/arcade/state')).json.games.map((g) => g.key);
    assert.deepEqual(await keys(), ['billdash', 'diversify', 'debtsnake', 'wordle']);
    const tile = (await a.client.get('/api/arcade/state')).json.games.find((g) => g.key === 'wordle');
    assert.deepEqual([tile.kind, tile.title, tile.today], ['daily', WORDLE_TITLE, 'new']);
    assert.equal((await w.teacher.post('/api/arcade/switch', { class_id: w.cls.id, game: 'wordle', enabled: false })).status, 200);
    assert.deepEqual(await keys(), ['billdash', 'diversify', 'debtsnake']);
    assert.equal((await a.client.get('/api/arcade/wordle')).status, 403);
    assert.equal((await guess(a, 'TAXABLE')).status, 403);
    const teach = (await w.teacher.get('/api/arcade/teach')).json.classes[0];
    assert.deepEqual(teach.switches.filter((x) => !x.linked).map((x) => [x.key, x.on]), [['billdash', true], ['diversify', true], ['debtsnake', true], ['wordle', false]]);
    assert.equal((await w.teacher.post('/api/arcade/switch', { class_id: w.cls.id, game: 'wordle', enabled: true })).status, 200);
    assert.deepEqual(await keys(), ['billdash', 'diversify', 'debtsnake', 'wordle']);
    assert.equal((await a.client.get('/api/arcade/wordle')).status, 200);
    await guess(a, 'ZZZZZZZ'.slice(0, today(w).word.length));
    assert.equal((await a.client.get('/api/arcade/state')).json.games.find((g) => g.key === 'wordle').today, 'open');
  } finally { await w.cleanup(); }
});

test('errand event: a lost and a won game each emit module.arcade.played_finword once, same payload shape; a 400 or 409 emits nothing; switched off turns the fact false', async () => {
  const w = await world();
  try {
    const [a, b] = w.students, e = today(w), seen = [];
    w.srv.app.events.on('module.arcade.played_finword', (p) => seen.push(p));
    await guess(a, wrong(e.word));
    assert.equal((await guess(a, 'X')).status, 400);
    assert.equal(seen.length, 0, 'an open game and a bad guess emit nothing');
    for (let i = 0; i < 5; i++) await guess(a, wrong(e.word));
    assert.equal((await a.client.get('/api/arcade/wordle')).json.status, 'lost');
    assert.equal((await guess(a, wrong(e.word))).status, 409);
    assert.equal(seen.length, 1, 'lost: once; the 409 after the end adds nothing');
    await guess(b, e.word);
    assert.equal(seen.length, 2, 'won: once');
    assert.deepEqual(Object.keys(seen[0]).sort(), Object.keys(seen[1]).sort());
    assert.deepEqual([seen[0].game, seen[1].game], ['wordle', 'wordle']);
    assert.equal(seen[0].worldId, seen[1].worldId);
    const facts = () => w.srv.app.modules.kernel('today').modules.call('arcade', 'todayFacts', { playerId: a.id });
    assert.equal(facts().finwordOn, true);
    await w.teacher.post('/api/arcade/switch', { class_id: w.cls.id, game: 'wordle', enabled: false });
    assert.equal(facts().finwordOn, false);
  } finally { await w.cleanup(); }
});

test('FinWord moves no money by itself and the ledger stays balanced', async () => {
  const w = await world();
  try {
    const [a] = w.students, before = JSON.stringify((await a.client.get('/api/me')).json.accounts);
    await guess(a, today(w).word);
    assert.equal(JSON.stringify((await a.client.get('/api/me')).json.accounts), before);
    assert.equal(w.srv.app.ledger.audit().ok, true);
  } finally { await w.cleanup(); }
});
