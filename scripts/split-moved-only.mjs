// node scripts/split-moved-only.mjs <base ref> <path>...   Run from the repo root. Proves a split moved code without changing it.
// Each <path> is a folder (every .js/.mjs file under it) or a single file. The lines of those files at <base ref> are compared, as a multiset,
// with their lines in the working tree. Ignored on both sides: blank lines, import statements, `export { ... }` lines, and a leading `export `.
// A clean split prints no REMOVED lines, and only comment lines under ADDED.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const [base, ...targets] = process.argv.slice(2);
if (!base || !targets.length) { console.error('usage: node scripts/split-moved-only.mjs <base ref> <path>...'); process.exit(2); }
const isCode = (f) => /\.(js|mjs)$/.test(f);
const git = (...a) => execFileSync('git', a, { encoding: 'utf8', maxBuffer: 1 << 28 });

function lines(text, file) {
  const out = []; let inImport = false;
  for (const raw of text.split('\n')) {
    const l = raw.trimEnd(), t = l.trim();
    if (inImport) { if (/from\s+['"][^'"]+['"]/.test(t)) inImport = false; continue; }   // the closing line: anything may follow the source (`with { type: 'json' }`, a comment)
    if (!t) continue;
    if (/^import\s/.test(t)) { if (!/from\s+['"][^'"]+['"]/.test(t) && !/^import\s+['"]/.test(t)) inImport = true; continue; }
    if (/^export\s*\{[^}]*\}(\s*from\s+['"][^'"]+['"])?;?$/.test(t)) continue;
    out.push(l.replace(/^export (?!default)/, ''));
  }
  if (inImport) throw new Error(`${file}: an import statement never closed, so the rest of the file was not compared. Fix lines() in this script.`);
  return out;
}

const count = (m, l, d) => m.set(l, (m.get(l) ?? 0) + d);
const bag = new Map(); let oldFiles = 0, newFiles = 0;
for (const t of targets) {
  for (const f of git('ls-tree', '-r', '--name-only', base, '--', t).split('\n').filter((f) => f && isCode(f))) { oldFiles++; for (const l of lines(git('show', `${base}:${f}`), `${base}:${f}`)) count(bag, l, -1); }
  const walk = (p) => (fs.statSync(p).isDirectory() ? fs.readdirSync(p).flatMap((e) => walk(path.join(p, e))) : [p]);
  for (const f of (fs.existsSync(t) ? walk(t) : []).filter(isCode)) { newFiles++; for (const l of lines(fs.readFileSync(f, 'utf8'), f)) count(bag, l, 1); }
}
const removed = [], added = [];
for (const [l, n] of bag) { for (let i = 0; i < -n; i++) removed.push(l); for (let i = 0; i < n; i++) added.push(l); }
const code = added.filter((l) => !/^\s*\/\//.test(l));
console.log(`${oldFiles} files at ${base}, ${newFiles} files now`);
console.log(`REMOVED (${removed.length}):`); removed.forEach((l) => console.log(`  - ${l.slice(0, 200)}`));
console.log(`ADDED (${added.length}, of which ${code.length} are not comments):`); added.forEach((l) => console.log(`  + ${l.slice(0, 200)}`));
process.exit(removed.length || code.length ? 1 : 0);
