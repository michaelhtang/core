// Adds the two hint columns to the tables in modules/arcade/REVIEW-wordle.md, from the game's own code (so the text is exactly what a student sees).
// Run: node scripts/wordle-hints-review.mjs   (safe to run again)
import { readFileSync, writeFileSync } from 'node:fs';
import { ALL_WORDS, hintTexts, unitTitle } from '../modules/arcade/wordle-words.js';
const file = new URL('../modules/arcade/REVIEW-wordle.md', import.meta.url);
let course = null;
const cell = (t) => (t ?? '(none)').replace(/\|/g, '\\|');
const out = readFileSync(file, 'utf8').split('\n').map((line) => {
  if (line.startsWith('## FinTech 10')) course = 'fintech10'; else if (line.startsWith('## FinTech 20/30')) course = 'fintech2030';
  if (!course || !line.startsWith('|')) return line;
  const c = line.split(/(?<!\\)\|/).slice(1, -1).map((x) => x.trim()).slice(0, 6);
  if (c[0] === '#') return `${line.split(/(?<!\\)\|/).slice(0, 7).join('|')}| Lesson hint (after 2 misses) | Meaning hint (after 4 misses) |`;
  if (/^-+$/.test(c[0])) return '|---|---|---|---|---|---|---|---|';
  const e = ALL_WORDS[course].find((x) => x.word === c[1]);
  const h = hintTexts(course, e);
  return `| ${c.join(' | ')} | ${cell(h.find((x) => x.level === 2)?.text ?? (unitTitle(course, e) ? '(skipped: too little left after blanking)' : '(lesson not live yet)'))} | ${cell(h.find((x) => x.level === 3)?.text)} |`;
});
writeFileSync(file, out.join('\n'));
