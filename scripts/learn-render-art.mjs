// node scripts/learn-render-art.mjs <seed> <unit id>...   Renders every picture of each unit's design/art/<unit>-prompts.tsv on the ComfyUI gateway,
// one after another, skipping pictures that already exist. Run from the repo's main checkout (tools/comfy-gen.mjs writes into ITS
// design/art whatever branch you are on; the PNGs there are not tracked).
import fs from 'node:fs'; import { execFileSync } from 'node:child_process';
const [seed, ...units] = process.argv.slice(2);
const todo = [];
for (const id of units) for (const l of fs.readFileSync(`design/art/${id}-prompts.tsv`, 'utf8').split('\n').filter(Boolean)) {
  const [name, prompt] = l.split('\t'); if (!fs.existsSync(`design/art/${id}-${name}-${seed}.png`)) todo.push({ id, name, prompt });
}
console.log(`${todo.length} pictures to render at seed ${seed}`);
let done = 0, failed = [];
for (const [i, t] of todo.entries()) {
  const last = i === todo.length - 1;
  try {
    execFileSync('node', ['tools/comfy-gen.mjs', 'art', `${t.id}-${t.name}`, '--prompt', t.prompt, '--seed', seed, ...(last ? [] : ['--keep-loaded'])], { stdio: ['ignore', 'pipe', 'pipe'], timeout: 600000 });
    done++; console.log(`${done}/${todo.length} ${t.id}-${t.name}`);
  } catch (e) { failed.push(`${t.id}-${t.name}`); console.log(`FAILED ${t.id}-${t.name}: ${String(e.stderr || e.message).slice(0, 200)}`); }
}
console.log(`rendered ${done}, failed ${failed.length}${failed.length ? ': ' + failed.join(', ') : ''}`);
