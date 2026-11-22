// Static files: everything under public/ and modules/*/ui, read once at startup and served by exact path.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { ROOT } from './app.js';

const PUBLIC = path.join(ROOT, 'public');
export const VDAA_DEV = process.env.VDAA_DEV === '1';
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.ico': 'image/x-icon', '.woff2': 'font/woff2',
};

// ---------- static files ----------
// Every file under public/ and modules/*/ui is read once at startup (VDAA_DEV=1: on every request). HTML and JS may contain
// __V__, replaced by the asset version. A request carrying ?v= is cached for a year (the version changes whenever any file does);
// everything else revalidates with an ETag. Text types are gzipped once, up front.
const GZIP_TYPES = new Set(['.js', '.css', '.html', '.svg']);
const etagOf = (buf) => `"${crypto.createHash('sha1').update(buf).digest('hex').slice(0, 16)}"`;

export function buildStatic(modulesDir) {
  const files = [];                                                                // [{ key, path, ext, raw }]
  const walk = (dir, prefix) => {
    if (!fs.existsSync(dir)) return;
    for (const f of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const p = path.join(dir, f.name);
      if (f.isDirectory()) walk(p, `${prefix}${f.name}/`);
      else files.push({ key: `${prefix}${f.name}`, path: p, ext: path.extname(f.name), raw: fs.readFileSync(p), hidden: prefix.split('/').concat(f.name).some((s) => s.startsWith('.')) });
    }
  };
  walk(PUBLIC, '/');
  for (const m of fs.readdirSync(modulesDir)) walk(path.join(modulesDir, m, 'ui'), `/m/${m}/`);
  const hash = crypto.createHash('sha1');
  for (const f of files) hash.update(f.path).update(f.raw);
  const version = hash.digest('hex').slice(0, 10);
  const map = new Map();
  for (const f of files) {
    if (f.hidden) continue;
    const body = f.ext === '.html' || f.ext === '.js' ? Buffer.from(f.raw.toString('utf8').replaceAll('__V__', version)) : f.raw;
    const gzipBody = GZIP_TYPES.has(f.ext) ? zlib.gzipSync(body) : null;
    map.set(f.key, { body, gzipBody, etag: etagOf(body), gzipEtag: gzipBody && etagOf(gzipBody), type: MIME[f.ext] || 'application/octet-stream', ext: f.ext });
  }
  return { version, map };
}

export function serveStatic(req, res, url, state, app) {
  if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405).end(); return; }
  let rel;
  try { rel = decodeURIComponent(url.pathname); } catch { res.writeHead(400).end(); return; }
  if (rel === '/') rel = '/index.html';
  if (rel === '/teach') rel = '/teach.html';
  const m = /^\/m\/([\w-]+)\//.exec(rel);
  if (m && !app.modules.has(m[1])) { res.writeHead(404).end(); return; }
  // Only exact keys of the prebuilt map are served, so there is nothing for ../ or a dotfile to reach.
  const e = (VDAA_DEV ? buildStatic(state.modulesDir) : state.static).map.get(rel);
  if (!e) { res.writeHead(404).end(); return; }
  const cache = url.searchParams.has('v') ? 'public, max-age=31536000, immutable' : ['.html', '.js', '.css'].includes(e.ext) ? 'no-cache' : 'public, max-age=604800';
  const gz = e.gzipBody && /\bgzip\b/.test(req.headers['accept-encoding'] || '');
  const etag = gz ? e.gzipEtag : e.etag;
  const headers = { 'Cache-Control': cache, ETag: etag, ...(e.gzipBody ? { Vary: 'Accept-Encoding' } : {}) };
  if (req.headers['if-none-match'] === etag) { res.writeHead(304, headers).end(); return; }
  res.writeHead(200, { ...headers, 'Content-Type': e.type, ...(gz ? { 'Content-Encoding': 'gzip' } : {}) });
  res.end(req.method === 'HEAD' ? undefined : gz ? e.gzipBody : e.body);
}
