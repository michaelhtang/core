// Content writers' tool for the Learning Road (docs/learn.md).
//   node scripts/learn-unit.mjs check  <unit.json> [--course <file>]   splice the unit into an in-memory copy of the course, run checkCourse, print counts (writes nothing)
//   node scripts/learn-unit.mjs splice <unit.json> [--course <file>]   the same, then write the course file back (2-space JSON)
// <unit.json> is one unit { id, title, blurb, outcome_codes, levels, image? }; it replaces the unit with the same id. The course comes from the id prefix (ft10- -> fintech10, ft2030- -> fintech2030).
import fs from 'node:fs';
import { checkCourse } from '../modules/learn/content.js';

const COURSE_OF = { 'ft10-': 'fintech10', 'ft2030-': 'fintech2030' };
const [cmd, unitFile, ...rest] = process.argv.slice(2);
const flag = rest.indexOf('--course');
const fail = (m) => { console.error(m); process.exit(1); };
if (!['check', 'splice'].includes(cmd) || !unitFile) fail('usage: node scripts/learn-unit.mjs check|splice <unit.json> [--course <file>]');

try {
  const unit = JSON.parse(fs.readFileSync(unitFile, 'utf8'));
  const prefix = Object.keys(COURSE_OF).find((p) => String(unit.id).startsWith(p));
  if (!prefix) throw new Error(`${unitFile}: unit id "${unit.id}" has no known course prefix (${Object.keys(COURSE_OF).join(', ')})`);
  const file = flag >= 0 ? rest[flag + 1] : new URL(`../modules/learn/content/${COURSE_OF[prefix]}.json`, import.meta.url).pathname;
  const course = JSON.parse(fs.readFileSync(file, 'utf8'));
  let hit = false;
  for (const s of course.sections) s.units = s.units.map((u) => (u.id === unit.id ? (hit = true, unit) : u));
  if (!hit) throw new Error(`no unit with id "${unit.id}" in ${file}`);
  checkCourse(structuredClone(course), `${COURSE_OF[prefix]}.json`);
  const cards = unit.levels.flatMap((l) => l.cards), qs = unit.levels.flatMap((l) => l.questions);
  const by = (t) => qs.filter((q) => q.type === t).length;
  const figures = cards.filter((c) => c.figure).length + qs.filter((q) => q.figure).length;
  if (cmd === 'splice') fs.writeFileSync(file, `${JSON.stringify(course, null, 2)}\n`);
  console.log(`${cmd === 'splice' ? 'spliced' : 'ok'} ${unit.id}: ${unit.levels.length} levels, ${cards.length} cards, ${qs.length} questions (choice ${by('choice')}, point ${by('point')}, number ${by('number')}), ${figures} figures`);
} catch (e) { fail(e.message); }
