// The daily word search (docs/arcade.md, "Word search"): the puzzle builder and the line check. Server only, NOT under ui/, because the placements are the answers.
// Words come from FinWord's live-lesson list (wordle-words.js WORDS) and each clue is that word's lesson meaning, blanked the way FinWord blanks its last hint.
// A puzzle depends only on course, day and level: a seeded generator (FNV-1a hash of the three, then mulberry32), no Math.random, no Date. The server stores the
// puzzle in the row at the first find or hint, so a later list edit never changes a puzzle in progress.
import { WORDS, wordFor, hintTexts } from './wordle-words.js';

export const WORDSEARCH_TITLE = 'FinFind';   // working name, Mr. Tang to choose (one line)
const ALL8 = [[0, 1], [1, 0], [1, 1], [-1, 1], [0, -1], [-1, 0], [-1, -1], [1, -1]];
export const LEVELS = {
  easy: { size: 9, count: 6, dirs: [[0, 1], [1, 0]], label: 'Easy' },   // across and down, never backwards
  hard: { size: 10, count: 8, dirs: ALL8, label: 'Hard' },               // all 8 directions, so some words read backwards; 10 columns is about the most a 375 px phone fits
};
// Accidental words to keep out of the filler (a hit fully inside one placed word, like ASS in ASSET, is fine).
const BLOCK = ['FUCK', 'FUK', 'SHIT', 'CUNT', 'DICK', 'COCK', 'PISS', 'SLUT', 'TWAT', 'FAG', 'NIG', 'ASS', 'SEX', 'CUM', 'TIT', 'KKK', 'NAZI', 'PORN', 'RAPE', 'HOE', 'WTF', 'POO', 'PEE', 'BUTT'];

const hash = (s) => { let x = 0x811c9dc5; for (const ch of s) x = Math.imul(x ^ ch.charCodeAt(0), 0x01000193) >>> 0; return x; };
const rng = (seed) => () => {                                          // mulberry32: an integer in [0, 2^32)
  seed = (seed + 0x6d2b79f5) >>> 0;
  let t = Math.imul(seed ^ (seed >>> 15), seed | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return (t ^ (t >>> 14)) >>> 0;
};
const below = (r, n) => r() % n;                                       // ponytail: modulo bias, under 1e-7 for n < 400; harmless for a puzzle
const shuffle = (r, a) => { a = [...a]; for (let i = a.length - 1; i > 0; i--) { const j = below(r, i + 1); [a[i], a[j]] = [a[j], a[i]]; } return a; };
const rev = (s) => [...s].reverse().join('');
const clueOf = (course, e) => hintTexts(course, e).find((x) => x.level === 3)?.text ?? null;   // the blanked meaning; null when blanking leaves too little

// Every straight line of the grid (rows, columns, both diagonals) as { s, cells }; reading a line backwards covers the other 4 directions.
function lines(grid) {
  const n = grid.length, out = [];
  for (const [dr, dc] of [[0, 1], [1, 0], [1, 1], [-1, 1]]) {
    for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) {
      const pr = r - dr, pc = c - dc;
      if (pr >= 0 && pr < n && pc >= 0 && pc < n) continue;            // not the start of a line
      const cells = [];
      for (let i = r, j = c; i >= 0 && i < n && j >= 0 && j < n; i += dr, j += dc) cells.push([i, j]);
      out.push({ s: cells.map(([i, j]) => grid[i][j]).join(''), cells });
    }
  }
  return out;
}
const hits = (ls, w) => ls.flatMap(({ s, cells }) => [w, rev(w)].filter((x, i) => i === 0 || x !== w).flatMap((x) => {
  const at = []; for (let i = s.indexOf(x); i >= 0; i = s.indexOf(x, i + 1)) at.push(cells.slice(i, i + x.length)); return at;
}));
const cellsOf = (p) => Array.from({ length: p.word.length }, (_, i) => [p.r + p.dr * i, p.c + p.dc * i]);

// The candidates for a day: the course's live words that fit the grid, have a clue, are not today's FinWord answer, and are not palindromes.
export function candidates(course, day, level) {
  const L = LEVELS[level], skip = wordFor(course, day)?.word;
  return (Object.hasOwn(WORDS, course) ? WORDS[course] : []).filter((e) => e.word.length <= L.size && e.word !== skip && e.word !== rev(e.word) && clueOf(course, e));
}

// Build the puzzle: { size, grid: [row strings], words: [{ word, r, c, dr, dc, clue, term, meaning, section }] } (in clue order), or null when the course has too few words.
export function makePuzzle(course, day, level) {
  const L = LEVELS[level];
  if (!L) return null;
  const pool = candidates(course, day, level);
  for (let attempt = 0; attempt < 60; attempt++) {
    const r = rng(hash(`${course}|${day}|${level}|${attempt}`));
    const picked = [];
    const shown = (e) => `${clueOf(course, e)} ${e.section}`.toUpperCase();   // what the browser sees of a word before it is found
    for (const e of shuffle(r, pool)) {                                 // no word inside another (SAVING and SAVINGS would both match), and no clue naming another word
      if (picked.length === L.count) break;
      if (!picked.some((p) => p.word.includes(e.word) || e.word.includes(p.word) || shown(p).includes(e.word) || shown(e).includes(p.word))) picked.push(e);
    }
    if (picked.length < Math.min(L.count, 3)) return null;
    const grid = Array.from({ length: L.size }, () => Array(L.size).fill(''));
    const placed = [];
    for (const e of [...picked].sort((a, b) => b.word.length - a.word.length)) {   // longest first
      let spot = null;
      for (let tries = 0; tries < 300 && !spot; tries++) {
        const [dr, dc] = L.dirs[below(r, L.dirs.length)], row = below(r, L.size), col = below(r, L.size);
        const p = { word: e.word, r: row, c: col, dr, dc };
        const cells = cellsOf(p);
        if (cells.every(([i, j], k) => i >= 0 && i < L.size && j >= 0 && j < L.size && (grid[i][j] === '' || grid[i][j] === e.word[k]))) spot = p;
      }
      if (!spot) break;
      cellsOf(spot).forEach(([i, j], k) => { grid[i][j] = e.word[k]; });
      placed.push(spot);
    }
    if (placed.length !== picked.length) continue;
    const letters = picked.map((e) => e.word).join('');                 // filler drawn from the puzzle's own letters, so a stray Q or Z gives nothing away
    for (const row of grid) for (let j = 0; j < row.length; j++) if (row[j] === '') row[j] = letters[below(r, letters.length)];
    const rows = grid.map((row) => row.join('')), ls = lines(rows);
    if (!placed.every((p) => hits(ls, p.word).length === 1)) continue;  // each word exactly once, so a find has one answer
    const inside = (cells) => placed.some((p) => { const own = new Set(cellsOf(p).map(String)); return cells.every((x) => own.has(String(x))); });
    if (BLOCK.some((b) => hits(ls, b).some((cells) => !inside(cells)))) continue;
    // each word carries its own clue, term, meaning and section (blanked like the clue: "Investing Foundations" would give INVESTING away), so the stored puzzle needs nothing from the list later
    return { size: L.size, grid: rows, words: picked.map((e) => ({ ...placed.find((p) => p.word === e.word), clue: clueOf(course, e), term: e.term, meaning: e.meaning, section: hintTexts(course, e).find((x) => x.level === 1)?.text ?? '' })) };
  }
  return null;
}

// The word a selection from [r1, c1] to [r2, c2] spells, read from the first cell to the last, or null for a line that is not straight or leaves the grid.
export function readLine(puzzle, [r1, c1], [r2, c2]) {
  const n = puzzle.size, dr = Math.sign(r2 - r1), dc = Math.sign(c2 - c1), len = Math.max(Math.abs(r2 - r1), Math.abs(c2 - c1)) + 1;
  if (![r1, c1, r2, c2].every((x) => Number.isInteger(x) && x >= 0 && x < n)) return null;
  if (r1 + dr * (len - 1) !== r2 || c1 + dc * (len - 1) !== c2) return null;   // not across, down or a 45-degree diagonal
  return Array.from({ length: len }, (_, i) => puzzle.grid[r1 + dr * i][c1 + dc * i]).join('');
}
// Which placed word a selection finds: the index of the word it spells forwards or backwards (dragging from the last letter is fine), or -1.
export function findIndex(puzzle, from, to) {
  const s = readLine(puzzle, from, to);
  return s && s.length > 1 ? puzzle.words.findIndex((p) => p.word === s || p.word === rev(s)) : -1;
}
export const placedCells = cellsOf;
// Stars go by hints only, never speed: 3 with none, 2 with up to 2, 1 with more.
export const stars = (hintsUsed) => (hintsUsed === 0 ? 3 : hintsUsed <= 2 ? 2 : 1);
