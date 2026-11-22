// Seeds a running local server with a demo teacher, one class with transfers on, and 6 students. Credentials are generated here
// and written to a file only you can read (the OS temp dir, or --out); nothing real is used. The server URL is required, so the
// production port is never seeded by accident. Run once on an empty data dir, against a server started with VDAA_DEV=1 (setup is
// refused without a token otherwise):
//   VDAA_DEV=1 PORT=3021 DATA_DIR=/tmp/vdaa-demo npm start   then   node scripts/demo-seed.mjs --url http://127.0.0.1:3021 [--out file]
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { parseArgs } from 'node:util';

const { values: args } = parseArgs({ options: { url: { type: 'string' }, out: { type: 'string' } } });
if (!args.url) { console.error('Usage: node scripts/demo-seed.mjs --url http://127.0.0.1:<port> [--out credentials.txt]'); process.exit(2); }
const base = args.url.replace(/\/$/, '');
const out = args.out ?? path.join(os.tmpdir(), `vdaa-demo-credentials-${crypto.randomBytes(4).toString('hex')}.txt`);
let cookie = '';
async function call(method, p, body) {
  const r = await fetch(base + p, { method, headers: { 'content-type': 'application/json', ...(cookie && { cookie }) }, body: body && JSON.stringify(body) });
  const set = r.headers.get('set-cookie'); if (set) cookie = set.split(';')[0];
  const j = await r.json().catch(() => null);
  if (!r.ok) throw new Error(`${method} ${p}: ${r.status} ${JSON.stringify(j)}`);
  return j;
}

const teacher = { username: 'demo-teacher', passphrase: `demo-${crypto.randomBytes(6).toString('hex')}` };
await call('POST', '/api/setup', teacher);
const cls = await call('POST', '/api/teach/classes', { name: 'Block 1 (demo)', course: 'fintech10' });
await call('POST', '/api/bank-basic/settings', { class_id: cls.id, enabled: true, per_transfer_cents: 5000, daily_cents: 10000 });
const { students } = await call('POST', `/api/teach/classes/${cls.id}/students`, { count: 6 });

fs.rmSync(out, { force: true });                                                  // a fresh file: an old one may be open elsewhere or owned by someone else
fs.writeFileSync(out, [
  `Teacher console: ${base}/teach`, `  username: ${teacher.username}`, `  passphrase: ${teacher.passphrase}`, '',
  `Students: ${base}/`, ...students.map((s) => `  ${s.username}  PIN ${s.pin}`), '',
].join('\n'), { mode: 0o600, flag: 'wx' });
console.log(`Seeded: 1 teacher, class ${cls.id}, ${students.length} students. Credentials in ${out}`);
