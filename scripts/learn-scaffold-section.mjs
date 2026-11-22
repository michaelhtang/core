// node scripts/learn-scaffold-section.mjs <section.json> [course id, default fintech10]   Run from the repo root. Appends a section of empty units to the course file
// (refuses if the id exists). The file: { id, title, blurb, units: [[id, title, blurb], ...] }. Empty units show as "soon" and block nothing.
import fs from 'node:fs';
const [file, course = 'fintech10'] = process.argv.slice(2), wt = process.cwd();
const p = `${wt}/modules/learn/content/${course}.json`, c = JSON.parse(fs.readFileSync(p, 'utf8')), s = JSON.parse(fs.readFileSync(file, 'utf8'));
if (c.sections.some((x) => x.id === s.id)) throw new Error(`section ${s.id} already exists`);
c.sections.push({ id: s.id, title: s.title, blurb: s.blurb, units: s.units.map(([id, title, blurb]) => ({ id, title, blurb, outcome_codes: [], levels: [] })) });
fs.writeFileSync(p, JSON.stringify(c, null, 2) + '\n');
const { checkCourse } = await import(`${wt}/modules/learn/content.js`);
checkCourse(JSON.parse(fs.readFileSync(p, 'utf8')), `${course}.json`);
console.log('added', s.id, s.units.length, 'units; checkCourse ok');
