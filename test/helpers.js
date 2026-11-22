import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { start } from '../server.js';
import { createApp } from '../lib/app.js';

// config/vdaa.json with the per-player transfer rate limit raised, for tests that fire hundreds of transfers from one student.
export const noTransferLimit = () => {
  const c = JSON.parse(fs.readFileSync(new URL('../config/vdaa.json', import.meta.url), 'utf8'));
  c.options['bank-basic'].transfersPer10Min = 1e6;
  return { config: c };
};

export const tmpDir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'vdaa-test-'));

// A bare app (no HTTP) on a temp database, with a world and one class.
export async function bareApp() {
  const dataDir = tmpDir();
  const app = await createApp({ dataDir });
  app.world.create();
  const cls = app.players.createClass({ name: 'Block 1', course: 'fintech10' });
  return { app, cls, dataDir, cleanup() { app.db.close(); fs.rmSync(dataDir, { recursive: true, force: true }); } };
}

// A running server on a random port. client() is a fetch wrapper with its own cookie jar.
export async function boot(opts = {}) {
  const dataDir = tmpDir();
  const s = await start({ port: 0, dataDir, openSetup: true, ...opts });
  const base = `http://127.0.0.1:${s.port}`;
  const client = () => {
    const jar = new Map();                                                         // name -> value: the session cookie and a teacher's trusted-device cookie
    let cookie = '';
    const call = async (method, p, body, headers = {}) => {
      const res = await fetch(base + p, {
        method,
        headers: { ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(cookie ? { cookie } : {}), ...headers },
        body: body !== undefined ? JSON.stringify(body) : undefined,
      });
      for (const set of res.headers.getSetCookie()) {
        const [name, ...value] = set.split(';')[0].split('=');
        jar.set(name, value.join('='));
        cookie = [...jar].map(([k, v]) => `${k}=${v}`).join('; ');
      }
      return { status: res.status, headers: res.headers, json: await res.json().catch(() => null) };
    };
    return { get: (p, h) => call('GET', p, undefined, h), post: (p, b = {}, h) => call('POST', p, b, h), cookie: () => cookie };
  };
  return { ...s, base, client, async cleanup() { await s.close(); fs.rmSync(dataDir, { recursive: true, force: true }); } };
}

// Teacher setup + one class with `count` students, each with a logged-in client. Returns everything tests need.
// transfers: true turns student-to-student transfers on for the class with generous limits ($1,000 each, $100,000 a day).
// bills now gives every NEW student autopay on. The suite's bills tests were written for "off" (a student pays by hand), so seeded and addClass
// turn it off again unless a test asks for the real default with { autopay: true }.
const manualBills = (srv, ids) => {
  if (!srv.app.db.prepare("SELECT 1 FROM sqlite_master WHERE name = 'bills_settings'").get()) return;
  for (const id of ids) srv.app.db.prepare('UPDATE bills_settings SET autopay = 0 WHERE player_id = ?').run(id);
};

export async function seeded(srv, count = 4, { transfers = true, autopay = false } = {}) {
  const teacher = srv.client();
  const setup = await teacher.post('/api/setup', { username: 'teacher', passphrase: 'correct horse battery' });
  if (setup.status !== 200) throw new Error(`setup failed: ${JSON.stringify(setup.json)}`);
  const cls = (await teacher.post('/api/teach/classes', { name: 'Block 1', course: 'fintech10' })).json;
  if (transfers) await teacher.post('/api/bank-basic/settings', { class_id: cls.id, enabled: true, per_transfer_cents: 100000, daily_cents: 10000000 });
  const made = (await teacher.post(`/api/teach/classes/${cls.id}/students`, { count })).json.students;
  const students = [];
  for (const s of made) {
    const c = srv.client();
    const login = await c.post('/api/login', { username: s.username, secret: s.pin });
    if (login.status !== 200) throw new Error(`login failed for ${s.username}`);
    const me = (await c.get('/api/me')).json;
    students.push({ ...s, client: c, id: me.user.id, chequing: me.accounts.find((a) => a.kind === 'chequing') });
  }
  if (!autopay) manualBills(srv, students.map((s) => s.id));
  return { teacher, cls, students };
}

// Another class in the same world, with logged-in students.
export async function addClass(srv, teacher, name, count = 2, { autopay = false } = {}) {
  const cls = (await teacher.post('/api/teach/classes', { name, course: 'fintech10' })).json;
  const made = (await teacher.post(`/api/teach/classes/${cls.id}/students`, { count })).json.students;
  const students = [];
  for (const s of made) {
    const c = srv.client();
    await c.post('/api/login', { username: s.username, secret: s.pin });
    const me = (await c.get('/api/me')).json;
    students.push({ ...s, client: c, id: me.user.id, chequing: me.accounts.find((a) => a.kind === 'chequing') });
  }
  if (!autopay) manualBills(srv, students.map((s) => s.id));
  return { cls, students };
}

// Opens /api/stream as `client` (needs client.cookie()). events(): the SSE events received so far, as [{ id, event, data }].
// next(name, ms): resolves with the first not-yet-consumed event of that name, or null after ms.
// ended(ms): resolves true if the SERVER ended the stream within ms, false if it is still open.
export async function openStream(srv, client) {
  const ctl = new AbortController();
  const res = await fetch(`${srv.base}/api/stream`, { headers: { cookie: client.cookie() }, signal: ctl.signal });
  const events = [];
  let consumed = 0;
  let buf = '';
  const waiters = new Set();
  let over = false;
  (async () => {
    const dec = new TextDecoder();
    try {
      for await (const chunk of res.body) {
        buf += dec.decode(chunk, { stream: true });
        let i;
        while ((i = buf.indexOf('\n\n')) >= 0) {
          const block = buf.slice(0, i); buf = buf.slice(i + 2);
          const f = Object.fromEntries(block.split('\n').map((l) => [l.slice(0, l.indexOf(':')), l.slice(l.indexOf(':') + 1).trim()]));
          if (f.event) events.push({ id: Number(f.id), event: f.event, data: JSON.parse(f.data) });
        }
        waiters.forEach((w) => w());
      }
    } catch { /* aborted */ }
    over = true;
    waiters.forEach((w) => w());
  })();
  return {
    status: res.status, events,
    async ended(ms = 1000) {
      const end = Date.now() + ms;
      while (!over && Date.now() < end) await new Promise((r) => { const w = () => { waiters.delete(w); r(); }; waiters.add(w); setTimeout(w, 20); });
      return over;
    },
    async next(name, ms = 2000) {
      const end = Date.now() + ms;
      for (;;) {
        const at = events.findIndex((e, i) => i >= consumed && e.event === name);
        if (at >= 0) { consumed = at + 1; return events[at]; }
        if (Date.now() >= end) return null;
        await new Promise((r) => { const w = () => { waiters.delete(w); r(); }; waiters.add(w); setTimeout(w, 50); });
      }
    },
    close: () => ctl.abort(),
  };
}

// The smallest EventSource that works in node, over fetch, for driving public/sync.js against a real server.
// readyState follows the browser: 0 connecting, 1 open, 2 closed. A dropped connection retries after retryMs; a non-200 is final.
export function fetchEventSource(base, cookie, retryMs = 20) {
  return class FetchEventSource {
    constructor(url) { this.url = url; this.readyState = 0; this.listeners = {}; this.ctl = new AbortController(); this.run(); }
    addEventListener(name, fn) { (this.listeners[name] ??= []).push(fn); }
    emit(type, data) { for (const fn of this.listeners[type] ?? []) fn({ type, data }); }
    close() { this.readyState = 2; this.ctl.abort(); }
    async run() {
      while (this.readyState !== 2) {
        try {
          const res = await fetch(base + this.url, { headers: { cookie: cookie() }, signal: this.ctl.signal });
          if (res.status !== 200) { this.readyState = 2; this.emit('error'); return; }
          this.readyState = 1;
          this.emit('open');
          let buf = '';
          const dec = new TextDecoder();
          for await (const chunk of res.body) {
            buf += dec.decode(chunk, { stream: true });
            let i;
            while ((i = buf.indexOf('\n\n')) >= 0) {
              const block = buf.slice(0, i); buf = buf.slice(i + 2);
              const f = Object.fromEntries(block.split('\n').map((l) => [l.slice(0, l.indexOf(':')), l.slice(l.indexOf(':') + 1).trim()]));
              if (f.event) this.emit(f.event, f.data);
            }
          }
        } catch { if (this.readyState === 2) return; }
        if (this.readyState === 2) return;
        this.readyState = 0;
        this.emit('error');
        await new Promise((r) => setTimeout(r, retryMs));
      }
    }
  };
}

// The real config with only bank-basic enabled, for tests that pin the bank-only economy (flat supply, no payday).
export const bankOnly = () => {
  const c = JSON.parse(fs.readFileSync(new URL('../config/vdaa.json', import.meta.url), 'utf8'));
  for (const course of Object.values(c.courses)) course.modules = ['bank-basic'];
  return c;
};
