// node scripts/learn-wire-art.mjs [--from <dir of rendered PNGs>] <unit id>...   Run from the repo root. Converts the picked PNGs
// (<dir>/<unit>-<name>-<seed>.png, default dir design/art; seed from design/art/<unit>-picks.json, else 300) to
// public/art/learn/<unit>/<name>.webp (needs cwebp) and writes the image fields into the course file. Stops on any mismatch:
// a missing picture, a card that already has a figure, or a card left with neither a figure nor a picture.
import fs from 'node:fs'; import { execFileSync } from 'node:child_process';
const args = process.argv.slice(2), wt = process.cwd();
const SRC = args[0] === '--from' ? args.splice(0, 2)[1] : `${wt}/design/art`;
const units = args;
const COURSE_OF = { 'ft10-': 'fintech10', 'ft2030-': 'fintech2030' };
const courseNames = [...new Set(units.map((id) => { const p = Object.keys(COURSE_OF).find((k) => id.startsWith(k)); if (!p) throw new Error(`unit ${id}: no known course prefix`); return COURSE_OF[p]; }))];
if (courseNames.length !== 1) throw new Error('wire units of one course at a time');
const courseFile = `${wt}/modules/learn/content/${courseNames[0]}.json`, course = JSON.parse(fs.readFileSync(courseFile, 'utf8'));
for (const id of units) {
  const unit = course.sections.flatMap((s) => s.units).find((u) => u.id === id); if (!unit) throw new Error(`no unit ${id}`);
  const rows = fs.readFileSync(`${wt}/design/art/${id}-prompts.tsv`, 'utf8').split('\n').filter(Boolean).map((l) => l.split('\t'));
  const picksFile = `${wt}/design/art/${id}-picks.json`, picks = fs.existsSync(picksFile) ? JSON.parse(fs.readFileSync(picksFile, 'utf8')) : {};
  const outDir = `${wt}/public/art/learn/${id}`; fs.mkdirSync(outDir, { recursive: true });
  const used = {}; let n = 0;
  for (const [name, , alt] of rows) {
    if (!alt || alt.length < 5 || alt.length > 120) throw new Error(`${id} ${name}: alt must be 5-120 characters ("${alt}")`);
    const seed = picks[name] ?? 300, png = `${SRC}/${id}-${name}-${seed}.png`;
    if (!fs.existsSync(png)) throw new Error(`missing ${png}`);
    const size = name === 'banner' ? '1200' : '640';
    execFileSync('cwebp', ['-quiet', '-q', '80', '-resize', size, size, png, '-o', `${outDir}/${name}.webp`]);
    const image = { src: `${id}/${name}.webp`, alt };
    if (name === 'banner') unit.image = image;
    else {
      const m = /^l(\d+)c(\d+)$/.exec(name); if (!m) throw new Error(`${id}: bad name ${name}`);
      const card = unit.levels[m[1] - 1]?.cards[m[2] - 1]; if (!card) throw new Error(`${id} ${name}: no such card`);
      if (card.figure) throw new Error(`${id} ${name}: the card has a figure, it cannot also have a picture`);
      card.image = image;
    }
    used[name] = seed; n++;
  }
  const bare = unit.levels.flatMap((l, li) => l.cards.map((c, ci) => (!c.figure && !c.image ? `l${li + 1}c${ci + 1}` : null))).filter(Boolean);
  if (bare.length) throw new Error(`${id}: cards with neither a figure nor a picture: ${bare.join(', ')}`);
  fs.writeFileSync(picksFile, JSON.stringify(used, null, 1) + '\n');
  const kb = Math.round(fs.readdirSync(outDir).reduce((s, f) => s + fs.statSync(`${outDir}/${f}`).size, 0) / 1024);
  console.log(`${id}: ${n} pictures, ${kb} KB`);
}
fs.writeFileSync(courseFile, JSON.stringify(course, null, 2) + '\n');
const { checkCourse } = await import(`${wt}/modules/learn/content.js`);
checkCourse(JSON.parse(fs.readFileSync(courseFile, 'utf8')), `${courseNames[0]}.json`);
console.log('checkCourse ok');
