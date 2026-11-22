// Native replaceChildren/append/prepend print a null, undefined or false argument as that word ("null" showed under the Retirement and Credit screens).
// Only h() filters them out. This reads every browser script and flags a call argument that is, or can end in, null/undefined/false; use '' or a spread filter.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const root = new URL('..', import.meta.url).pathname.replace(/\/$/, '');
const files = [...fs.readdirSync(root + '/public').filter((f) => f.endsWith('.js')).map((f) => `public/${f}`),
  ...fs.readdirSync(root + '/modules').flatMap((m) => fs.existsSync(`${root}/modules/${m}/ui`) ? fs.readdirSync(`${root}/modules/${m}/ui`).filter((f) => f.endsWith('.js')).map((f) => `modules/${m}/ui/${f}`) : [])];
// walk from an opening bracket; returns top-level args (split on depth-0 commas) and the end index. Skips strings, templates, comments, regex-free assumption.
function args(s, i) {
  const out = []; let depth = 0, start = i + 1, j = i;
  const skipStr = (q) => { for (j++; j < s.length; j++) { if (s[j] === '\\') j++; else if (q === '`' && s[j] === '$' && s[j + 1] === '{') { let d = 0; for (j += 1; j < s.length; j++) { if (s[j] === '{') d++; else if (s[j] === '}' && --d === 0) break; else if (s[j] === '"' || s[j] === "'" || s[j] === '`') skipStr(s[j]); } } else if (s[j] === q) return; } };
  for (; j < s.length; j++) {
    const c = s[j];
    if (c === '"' || c === "'" || c === '`') { skipStr(c); continue; }
    if (c === '/' && s[j + 1] === '/') { while (s[j] !== '\n') j++; continue; }
    if ('([{'.includes(c)) depth++;
    else if (')]}'.includes(c)) { depth--; if (depth === 0) { out.push(s.slice(start, j)); return out; } }
    else if (c === ',' && depth === 1) { out.push(s.slice(start, j)); start = j + 1; }
  }
  return out;
}
// depth-0 view of an arg: replace nested bracket/string contents with spaces
function top(a) { let o = '', d = 0; for (let j = 0; j < a.length; j++) { const c = a[j]; if (c === '"' || c === "'" || c === '`') { const q = c; o += ' '; for (j++; j < a.length && a[j] !== q; j++) { if (a[j] === '\\') j++; if (q === '`' && a[j] === '$' && a[j+1] === '{') { let dd = 0; for (j++; j < a.length; j++) { if (a[j] === '{') dd++; else if (a[j] === '}' && --dd === 0) break; } } } o += ' '; continue; } if ('([{'.includes(c)) { d++; o += d === 1 ? c : ' '; continue; } if (')]}'.includes(c)) { o += d === 1 ? c : ' '; d--; continue; } o += d === 0 ? c : ' '; } return o; }
const hits = [];
for (const f of files) {
  const s = fs.readFileSync(`${root}/${f}`, 'utf8');
  for (const m of s.matchAll(/\.(replaceChildren|append|prepend)\(/g)) {
    const open = m.index + m[0].length - 1;
    const line = s.slice(0, open).split('\n').length;
    for (const a of args(s, open)) {
      const t = top(a).trim(); if (!t || t.startsWith('...')) continue;
      if (/^(null|undefined|false)$/.test(t) || /(^|[^?.]):\s*(null|undefined|false)$|\?\s*(null|undefined|false)\s*:/.test(t.replace(/\s+/g, ' ')) || /&&[^&|?]*$/.test(t) && !/\?/.test(t)) hits.push(`${f}:${line} ${m[1]} arg: ${a.trim().slice(0, 70).replace(/\s+/g, ' ')} … ${a.trim().slice(-50).replace(/\s+/g, ' ')}`);
    }
  }
}

test('no native DOM insert is handed a null, undefined or false', () => {
  assert.ok(files.length >= 20, `found ${files.length} files`);
  assert.deepEqual(hits, []);
});
