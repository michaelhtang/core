// node scripts/learn-copy-units.mjs <from course.json> <to course.json> <unit id>...   Copies whole units (by id) from one course file into another, in place.
import fs from 'node:fs';
const [from, to, ...ids] = process.argv.slice(2);
const a = JSON.parse(fs.readFileSync(from, 'utf8')), b = JSON.parse(fs.readFileSync(to, 'utf8'));
for (const id of ids) {
  const src = a.sections.flatMap((s) => s.units).find((u) => u.id === id); if (!src) throw new Error(`no unit ${id} in ${from}`);
  let done = false;
  for (const s of b.sections) { const i = s.units.findIndex((u) => u.id === id); if (i >= 0) { s.units[i] = src; done = true; } }
  if (!done) throw new Error(`no unit ${id} in ${to}`);
  console.log(`copied ${id}: ${src.levels.length} levels, ${src.levels.reduce((n, l) => n + l.questions.length, 0)} questions`);
}
fs.writeFileSync(to, JSON.stringify(b, null, 2) + '\n');
