// node scripts/split-shape.mjs <repo root>   Run it on a checkout from before a change and on the current one, then compare the two outputs. Prints a fingerprint of each module definition: migrations (id + sql), routes, services, events, panels, options.
import path from 'node:path'; import fs from 'node:fs'; import crypto from 'node:crypto'; import { pathToFileURL } from 'node:url';
const root = path.resolve(process.argv[2]);
const h = (s) => crypto.createHash('sha1').update(String(s)).digest('hex').slice(0, 10);
const out = {};
for (const m of fs.readdirSync(path.join(root, 'modules')).sort()) {
  const f = path.join(root, 'modules', m, 'index.js'); if (!fs.existsSync(f)) continue;
  const def = (await import(pathToFileURL(f).href)).default;
  const fn = (v) => (typeof v === 'function' ? `fn:${h(v.toString())}` : v);
  out[m] = {
    keys: Object.keys(def).sort().join(','),
    migrations: (def.migrations ?? []).map((x) => `${x.id}:${h(x.sql)}`),
    routes: (def.routes ?? []).map((r) => `${r.method} ${r.path} ${r.access} ${fn(r.handler)}`),
    services: Object.entries(def.services ?? {}).map(([k, v]) => `${k}:${fn(v)}`),
    events: Object.entries(def.events ?? {}).map(([k, v]) => `${k}:${fn(v)}`),
    hooks: Object.entries(def).filter(([, v]) => typeof v === 'function').map(([k, v]) => `${k}:${fn(v)}`),
    panels: JSON.stringify([def.panels, def.teacherPanels, def.cards, def.options, def.requires, def.needs, def.catalogues?.length]),
  };
}
console.log(JSON.stringify(out, null, 1));
