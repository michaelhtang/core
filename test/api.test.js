import { test } from 'node:test';
import assert from 'node:assert/strict';
import { boot, seeded, noTransferLimit } from './helpers.js';

test('setup creates the teacher once; classes and PIN-card students follow', async () => {
  const srv = await boot();
  try {
    const t = srv.client();
    assert.equal((await t.get('/api/me')).json.needsSetup, true);
    assert.equal((await t.post('/api/setup', { username: 'teacher', passphrase: 'short' })).status, 400);
    assert.equal((await t.post('/api/setup', { username: 'teacher', passphrase: 'correct horse battery' })).status, 200);
    assert.equal((await srv.client().post('/api/setup', { username: 'second', passphrase: 'another long phrase' })).status, 409);
    const me = (await t.get('/api/me')).json;
    assert.equal(me.user.role, 'teacher');
    assert.equal(me.needsSetup, false);
    assert.equal((await t.post('/api/teach/classes', { name: 'Block 2', course: 'nope' })).status, 400);
    const cls = (await t.post('/api/teach/classes', { name: 'Block 2', course: 'fintech2030' })).json;
    const { students } = (await t.post(`/api/teach/classes/${cls.id}/students`, { count: 60 })).json;
    assert.equal(students.length, 60);
    assert.equal(new Set(students.map((s) => s.username.toLowerCase())).size, 60);
    for (const s of students) {
      assert.match(s.username, /^[A-Z][a-z]+[A-Z][a-z]+\d{2}$/);
      assert.match(s.pin, /^\d{6}$/);
    }
    assert.equal((await t.post(`/api/teach/classes/${cls.id}/students`, { count: 61 })).status, 400);
    // PINs are stored hashed, never in clear text
    const hashes = srv.app.db.prepare("SELECT pin_hash FROM players WHERE role = 'student'").all();
    // Every stored value has the exact scrypt$<16-byte salt>$<32-byte hash> shape, which a plaintext PIN (alone or embedded) cannot have,
    // and no PIN is a segment of one. (Hex hash segments are random, so a bare substring check would flag ~2% of 6-digit PINs by chance.)
    assert.ok(hashes.every((r) => /^scrypt\$[0-9a-f]{32}\$[0-9a-f]{64}$/.test(r.pin_hash)));
    assert.ok(hashes.every((r) => !students.some((s) => r.pin_hash.split('$').includes(s.pin))));
  } finally { await srv.cleanup(); }
});

test('login works, a wrong PIN fails, the cookie is HttpOnly + SameSite=Lax (+ Secure behind https)', async () => {
  const srv = await boot();
  try {
    const { students } = await seeded(srv, 2);
    const [s] = students;
    const bad = srv.client();
    assert.equal((await bad.post('/api/login', { username: s.username, secret: '000000' })).status, 401);
    assert.equal((await bad.get('/api/me')).json.user, null);
    const ok = srv.client();
    const res = await ok.post('/api/login', { username: s.username.toLowerCase(), secret: s.pin });
    assert.equal(res.status, 200);
    const cookie = res.headers.get('set-cookie');
    assert.match(cookie, /HttpOnly/);
    assert.match(cookie, /SameSite=Lax/);
    assert.doesNotMatch(cookie, /Secure/);
    const me = (await ok.get('/api/me')).json;
    assert.equal(me.user.username, s.username);
    assert.equal(me.user.class.name, 'Block 1');
    assert.equal(me.world.month, 1);
    assert.equal(me.accounts.find((a) => a.kind === 'chequing').balance_cents, 50000);
    assert.equal(me.panels[0].building.key, 'bank');
    const https = await srv.client().post('/api/login', { username: s.username, secret: s.pin }, { 'x-forwarded-proto': 'https' });
    assert.match(https.headers.get('set-cookie'), /Secure/);
    await ok.post('/api/logout');
    assert.equal((await ok.get('/api/me')).json.user, null);
  } finally { await srv.cleanup(); }
});

test('rate limiting: repeated wrong PINs lock the username, even for the right PIN, until the teacher resets it', async () => {
  const srv = await boot();
  try {
    const { teacher, students } = await seeded(srv, 2);
    const [a, b] = students;
    const c = srv.client();
    for (let i = 0; i < 5; i++) assert.equal((await c.post('/api/login', { username: a.username, secret: '000000' })).status, 401);
    const locked = await c.post('/api/login', { username: a.username, secret: a.pin });
    assert.equal(locked.status, 429);
    assert.match(locked.json.error, /Too many/);
    // another student on the same machine is unaffected
    assert.equal((await srv.client().post('/api/login', { username: b.username, secret: b.pin })).status, 200);
    const reset = (await teacher.post(`/api/teach/players/${a.id}/reset-pin`)).json;
    assert.match(reset.students[0].pin, /^\d{6}$/);
    assert.equal((await c.post('/api/login', { username: a.username, secret: a.pin })).status, 401); // old PIN is dead
    assert.equal((await c.post('/api/login', { username: a.username, secret: reset.students[0].pin })).status, 200);
  } finally { await srv.cleanup(); }
});

test('rate limiting: a per-IP limit stops guessing across many usernames', async () => {
  const srv = await boot({ limits: { ip: 4 } });
  try {
    const c = srv.client();
    for (let i = 0; i < 4; i++) assert.equal((await c.post('/api/login', { username: `nobody${i}`, secret: '123456' })).status, 401);
    assert.equal((await c.post('/api/login', { username: 'nobody9', secret: '123456' })).status, 429);
  } finally { await srv.cleanup(); }
});

test('a student cannot call teacher routes; anonymous callers get 401', async () => {
  const srv = await boot();
  try {
    const { students } = await seeded(srv, 2);
    const s = students[0].client;
    for (const [method, path] of [['get', '/api/teach/state'], ['get', '/api/teach/audit'], ['post', '/api/teach/audit/run'], ['get', '/api/teach/classes/1/students'],
      ['post', '/api/teach/classes'], ['post', '/api/teach/classes/1/students'], ['post', `/api/teach/players/${students[1].id}/reset-pin`],
      ['post', '/api/teach/world/advance'], ['post', '/api/teach/world/settings'], ['post', `/api/teach/players/${students[1].id}/unlock`],
      ['get', '/api/bank-basic/settings'], ['post', '/api/bank-basic/settings'], ['get', '/api/bank-basic/transfers'], ['post', '/api/bank-basic/transfers/1/reverse']]) {
      assert.equal((await s[method](path)).status, 403, `${method} ${path}`);
      assert.equal((await srv.client()[method](path)).status, 401, `anon ${method} ${path}`);
    }
    assert.equal(srv.app.world.current().month, 1);
  } finally { await srv.cleanup(); }
});

test('a student can read their own statement but not another student\'s; the teacher can read any', async () => {
  const srv = await boot();
  try {
    const { teacher, students } = await seeded(srv, 2);
    const [a, b] = students;
    const own = await a.client.get(`/api/accounts/${a.chequing.id}/statement`);
    assert.equal(own.status, 200);
    assert.equal(own.json.entries[0].kind, 'bank-basic.welcome');
    assert.equal((await a.client.get(`/api/accounts/${b.chequing.id}/statement`)).status, 403);
    assert.equal((await a.client.get('/api/accounts/1/statement')).status, 403);      // the mint
    assert.equal((await a.client.get('/api/accounts/99999/statement')).status, 403);
    assert.equal((await srv.client().get(`/api/accounts/${a.chequing.id}/statement`)).status, 401);
    assert.equal((await teacher.get(`/api/accounts/${b.chequing.id}/statement`)).status, 200);
  } finally { await srv.cleanup(); }
});

test('transfer route validates input; students cannot send negative amounts or write the ledger any other way', async () => {
  const srv = await boot();
  try {
    const { teacher, students } = await seeded(srv, 2);
    const [a, b] = students;
    const send = (body, who = a.client) => who.post('/api/bank-basic/transfer', body);
    assert.equal((await send({ to: b.username, cents: -500 })).status, 400);
    assert.equal((await send({ to: b.username, cents: 1.5 })).status, 400);
    assert.equal((await send({ to: b.username, cents: '500' })).status, 400);
    assert.equal((await send({ to: a.username, cents: 500 })).status, 400);
    assert.equal((await send({ to: 'NoSuchPerson99', cents: 500 })).status, 404);
    assert.equal((await send({ to: 'teacher', cents: 500 })).status, 404);
    assert.equal((await send({ to: b.username, cents: 50001 })).json.error, 'Insufficient funds');
    assert.equal((await send({ to: b.username, cents: 500 }, teacher)).status, 403);
    assert.equal((await send({ to: b.username, cents: 2500 })).json.balance_cents, 47500);
    const st = (await b.client.get(`/api/accounts/${b.chequing.id}/statement`)).json;
    assert.equal(st.balance_cents, 52500);
    assert.equal(st.entries[0].memo, `Received from ${a.username}`);
    assert.equal(srv.app.ledger.audit().ok, true);
  } finally { await srv.cleanup(); }
});

test('200 parallel transfers from one account: exactly the affordable ones succeed, nothing goes negative, audit stays OK', async () => {
  const srv = await boot(noTransferLimit());
  try {
    const { students } = await seeded(srv, 2);
    const [a, b] = students;
    // $5 each against $500: 100 can succeed, 100 must be refused
    const results = await Promise.all(Array.from({ length: 200 }, () => a.client.post('/api/bank-basic/transfer', { to: b.username, cents: 500 })));
    const okCount = results.filter((r) => r.status === 200).length;
    const refused = results.filter((r) => r.status === 400 && r.json.error === 'Insufficient funds').length;
    assert.equal(okCount, 100);
    assert.equal(refused, 100);
    const ledger = srv.app.ledger;
    assert.equal(ledger.balance(a.chequing.id), 0);
    assert.equal(ledger.balance(b.chequing.id), 100000);
    const audit = ledger.audit();
    assert.equal(audit.ok, true, JSON.stringify(audit.problems));
    assert.equal(audit.moneySupply, 100000);
  } finally { await srv.cleanup(); }
});

test('200 parallel transfers around a ring of students: total conserved, no negatives, audit OK', async () => {
  const srv = await boot(noTransferLimit());
  try {
    const { students } = await seeded(srv, 5);
    const calls = Array.from({ length: 200 }, (_, i) => {
      const from = students[i % 5];
      const to = students[(i + 1 + (i % 3)) % 5];
      const cents = 100 + ((i * 7919) % 9000);
      return from.client.post('/api/bank-basic/transfer', { to: to.username, cents });
    });
    const results = await Promise.all(calls);
    assert.ok(results.every((r) => r.status === 200 || (r.status === 400 && r.json.error === 'Insufficient funds')));
    assert.ok(results.some((r) => r.status === 200));
    const ledger = srv.app.ledger;
    const balances = students.map((s) => ledger.balance(s.chequing.id));
    assert.ok(balances.every((v) => v >= 0));
    assert.equal(balances.reduce((x, y) => x + y, 0), 5 * 50000);
    assert.equal(ledger.audit().ok, true);
  } finally { await srv.cleanup(); }
});

test('POSTs from another origin are blocked; same-origin and non-browser POSTs are fine', async () => {
  const srv = await boot();
  try {
    const c = srv.client();
    const body = { username: 'x', secret: '123456' };
    assert.equal((await c.post('/api/login', body, { origin: 'https://evil.example' })).status, 403);
    assert.equal((await c.post('/api/login', body, { origin: 'null' })).status, 403);
    assert.equal((await c.post('/api/login', body, { 'sec-fetch-site': 'cross-site' })).status, 403);
    assert.equal((await c.post('/api/login', body, { origin: srv.base, 'sec-fetch-site': 'same-origin' })).status, 401);
    assert.equal((await c.post('/api/login', body)).status, 401);
  } finally { await srv.cleanup(); }
});

test('the teacher advances the world month; students see it and are told over the event stream', async () => {
  const srv = await boot();
  try {
    const { teacher, students } = await seeded(srv, 1);
    const s = students[0];
    const stream = await fetch(`${srv.base}/api/stream`, { headers: { cookie: `sid=${(await srv.app.players.startSession(s.id, 1))}` } });
    assert.equal(stream.headers.get('content-type'), 'text/event-stream');
    const reader = stream.body.getReader();
    const w = (await teacher.post('/api/teach/world/advance')).json;
    assert.equal(w.month, 2);
    let text = '';
    const decoder = new TextDecoder();
    while (!text.includes('event: month')) text += decoder.decode((await reader.read()).value);
    assert.match(text, /"month":2/);
    await reader.cancel();
    assert.equal((await s.client.get('/api/me')).json.world.month, 2);
    assert.equal((await teacher.post('/api/teach/world/settings', { months_per_day: 3 })).json.months_per_day, 3);
    assert.equal((await teacher.post('/api/teach/world/advance')).json.month, 5);
    assert.equal((await teacher.post('/api/teach/world/advance', { months: 99 })).status, 400);
    const audit = (await teacher.post('/api/teach/audit/run')).json;
    assert.equal(audit.ok, true);
    assert.equal(audit.moneySupply, 50000);
    assert.equal((await srv.client().get('/api/stream')).status, 401);
  } finally { await srv.cleanup(); }
});

test('static files: pages carry the credit, assets are cached for a year when versioned, traversal is blocked', async () => {
  const srv = await boot();
  try {
    const page = await fetch(`${srv.base}/`);
    const html = await page.text();
    assert.match(html, /made by Mr\. Tang/);
    assert.doesNotMatch(html, /__V__/);
    assert.equal(page.headers.get('cache-control'), 'no-cache');
    const csp = page.headers.get('content-security-policy');
    assert.match(csp, /default-src 'self'/);
    assert.doesNotMatch(csp, /https?:/);                                   // no third-party origin is allowed at all
    const teach = await (await fetch(`${srv.base}/teach`)).text();
    assert.match(teach, /made by Mr\. Tang/);
    const version = html.match(/theme\.css\?v=(\w+)/)[1];
    const css = await fetch(`${srv.base}/theme.css?v=${version}`);
    assert.match(css.headers.get('cache-control'), /max-age=31536000, immutable/);
    const etag = (await fetch(`${srv.base}/theme.css`)).headers.get('etag');
    assert.equal((await fetch(`${srv.base}/theme.css`, { headers: { 'if-none-match': etag } })).status, 304);
    // every font the stylesheet names is served from this origin as woff2, with its licence text beside it
    const fonts = [...(await (await fetch(`${srv.base}/theme.css`)).text()).matchAll(/url\('(\/fonts\/([A-Za-z]+)-[^']+\.woff2)'\)/g)];
    assert.ok(fonts.length >= 2, 'the theme declares its fonts');
    for (const [, url, family] of fonts) {
      const font = await fetch(srv.base + url);
      assert.equal(font.status, 200, url);
      assert.equal(font.headers.get('content-type'), 'font/woff2');
      assert.equal(Buffer.from(await font.arrayBuffer()).toString('latin1', 0, 4), 'wOF2');
      assert.equal((await fetch(`${srv.base}/fonts/OFL-${family}.txt`)).status, 200, `licence text for ${family}`);
    }
    for (const zone of ['gate', 'council', 'archive', 'amphitheatre', 'arena']) for (const part of ['night', 'day']) {
      assert.equal((await fetch(`${srv.base}/art/scenes/${zone}-${part}.webp`)).headers.get('content-type'), 'image/webp', `${zone}-${part}`);
    }
    // every scene the stylesheet names exists
    const themeCss = await (await fetch(`${srv.base}/theme.css`)).text();
    for (const [, url] of themeCss.matchAll(/url\('(\/art\/scenes\/[^']+)'\)/g)) assert.equal((await fetch(srv.base + url)).status, 200, url);
    assert.equal((await fetch(`${srv.base}/m/bank-basic/bank.js`)).status, 200);
    assert.equal((await fetch(`${srv.base}/m/nope/bank.js`)).status, 404);
    assert.equal((await fetch(`${srv.base}/..%2Fserver.js`)).status, 404);
    assert.equal((await fetch(`${srv.base}/%2e%2e/server.js`)).status, 404);
    assert.equal((await fetch(`${srv.base}/nothing-here`)).status, 404);
  } finally { await srv.cleanup(); }
});

test('privacy: nothing the browser loads names a third-party host', async () => {
  const fs = await import('node:fs');
  const path = await import('node:path');
  const dirs = ['public', 'modules/bank-basic/ui'].map((d) => path.join(import.meta.dirname, '..', d));
  const files = dirs.flatMap((d) => fs.readdirSync(d, { recursive: true }).map((f) => path.join(d, f)).filter((f) => /\.(css|html|js)$/.test(f)));
  assert.ok(files.length >= 8);
  for (const f of files) assert.doesNotMatch(fs.readFileSync(f, 'utf8'), /https?:\/\/(?!www\.w3\.org)/, f);
});
