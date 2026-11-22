// Shared by the POST fuzz files (fuzz.test.js, fuzz-student.test.js, fuzz-teacher.test.js): one file per role, so the three sweeps run in
// parallel processes and each stays well under its timeout on a loaded box.
import assert from 'node:assert/strict';
import { boot, seeded } from './helpers.js';

// A well-formed body for every route, then each key replaced in turn by each crafted value, plus whole-body junk.
export const BASE = {
  username: 'someone', secret: '123456', passphrase: 'short', token: 't', name: 'Block', course: 'fintech10', count: 1,
  guess: 'ABCDE',
  months: 1, months_per_day: 1, auto_advance: 'manual', class_id: 1, enabled: false, per_transfer_cents: 100, daily_cents: 200, to: 'x', cents: 1, current: 'x', next: 'y',
  // the fields the modules read (credit, bills, jobs, rates, savings, insurance): crafted values must reach their parsing too. fuzz.test.js checks this list against the source.
  mode: 'min', source: 'chequing', slot: 'phone', option: 'none', id: 1, job_id: 1, player_id: 1, reflection: 'I learned the till and I am ready', approve: true, term_months: 1, direction: 'in',
  balance_cents: 100000, apr_bp: 2099, policy_bp: 225, inflation_bp: 210, hisa_bp: 100, policy: 'tenant', event: 'dental', scope: 'town',   // insurance
  tenure: 'apt1', property: 'average', down_cents: 1010000, amort_years: 25, pct: 10, home_id: 1, role: 'rental',   // housing (home_id, role: 6b landlords)
  game: 'billdash', session: 'abc123', presence: true,   // arcade, walk: a game name and a session id the fuzz can never match, so the routes' 4xx paths run; presence: the walk's per-class switch (class_id is shared)
  level_id: 'ft10-s1-u2-l1', question_id: 'ft10-s1-u2-l1-q1', value: 0,   // learn (value is a choice index or a typed number)
  term_id: 't0', meaning_id: 'm0',                                              // learn practice word match (ids are positions in each shuffled column)
  units: ['ft10-s1-u2'], all: false,   // learn: the units open to a class
  item: 'tee', open: true,   // outfitters
  ticker: 'DAAX', account: 'tfsa', side: 'buy', type: 'market', units_micro: 1000000, limit_cents: 9000, drip: true, frozen: false, kind: 'rally',   // exchange (id and cents are shared)
  hide_amounts: true, freeze: false,   // leaderboards
  building: 'job', answer: 'I chose the HISA because I need the money soon.', date: '2026-11-02', title: 'Quest', brief: 'Do it', justify: false, reward_cents: 100, energy: 1, energy_cap: 5,   // today
  age: 65, monthly_cents: 100000, order: ['rrsp', 'invest', 'hisa', 'tfsa'],   // retirement (5c)
  retire_age: 65, locked: false, skip: false, month: 300, plan: [{ from_month: 1, months_per_day: 1 }], from_month: 30,   // life (id is shared: a scenario id is text, so the base body is refused with a 400)
  sector: 'Food and drink', cofounders: 'someone', split: '50,50', accept: true, product: 'coffee', quantity: 10, a_bp: 10000, b_bp: 10000, note: 'ok',   // ventures (plan is life's: one key reaches both parsers)
  posting_id: 1, application_id: 1, hourly_cents: 1600, hours: 40, slots: 1, business_id: 1, term: 12, action: 'forgive', loan_spread_bp: 300, hire_approval: false,   // ventures 4b (title is today's 'Quest')
  price_cents: 20200000, rate_bp: 420, rent_cents: 129000, condo_fee_cents: 40000, heating_cents: 6000, insurance_cents: 3500, years: 5, drift_bp: 25, invest_bp: 275,   // housing calculator (read through a local helper)
};
const VALUES = [null, true, 0, -1, 1.5, 1e308, 2 ** 53, '', 'x'.repeat(5000), '1e3', [], [1], {}, { toString: 1 }, { valueOf: 1, toString: 1 }, { length: 1 }, { a: { b: { c: { d: 1 } } } }];
const KEYS = [...Object.keys(BASE), '__proto__', 'constructor'];
const WHOLE = ['null', '[]', '"s"', '1', 'true', '{bad', '', '{"a":', '[[[[[[[[[[1]]]]]]]]]]', '{"__proto__":{"admin":true}}', '{"toString":1}'];

export const bodies = [
  ...KEYS.flatMap((k) => VALUES.map((v) => JSON.stringify({ ...BASE, [k]: v }))),
  ...WHOLE,
];

// Every POST route, read from the server's live route table (core and module routes alike), so a new route is fuzzed automatically.
// No hard-coded total: the list IS the live table, so a module's new route is swept with no test edit. What is checked: the core routes
// are there, nothing is listed twice, and every POST route of every loaded module is among them.
export const postRoutes = (srv) => srv.routes.filter((r) => r.method === 'POST').map((r) => r.pattern.replace(/:\w+/g, '1'));

export async function sweep(srv, label, cookie, paths) {
  const jobs = paths.flatMap((p) => bodies.map((b) => ({ p, b })));
  const bad = [];
  for (let i = 0; i < jobs.length; i += 25) {
    await Promise.all(jobs.slice(i, i + 25).map(async ({ p, b }) => {
      const res = await fetch(srv.base + p, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(cookie ? { cookie } : {}), 'cf-connecting-ip': `198.51.100.${1 + (i % 200)}` }, body: b });
      const text = await res.text();
      let json = null;
      try { json = JSON.parse(text); } catch { /* checked below */ }
      if (res.status >= 500 || !json) bad.push(`${label} ${p} ${res.status} ${b.slice(0, 80)} -> ${text.slice(0, 100)}`);
    }));
  }
  assert.deepEqual(bad.slice(0, 5), [], `${bad.length} bad responses`);
  return jobs.length;
}

// A server with the limits off, the class seeded, and the live POST route table checked; then `role`'s sweep. Returns the request count.
export async function fuzzAs(role) {
  const srv = await boot({ limits: { failDelayStepMs: 1, failDelayMaxMs: 1, ip: 1e9, user: 1e9, userHourly: 1e9 } });
  try {
    const { students } = await seeded(srv, 2);
    const paths = postRoutes(srv);
    assert.equal(new Set(paths).size, paths.length, 'no route listed twice');
    for (const r of srv.app.modules.routes().filter((m) => m.method === 'POST')) assert.ok(paths.includes(r.fullPath.replace(/:\w+/g, '1')), r.fullPath);
    for (const expected of ['/api/setup', '/api/login', '/api/teach/passphrase', '/api/bank-basic/transfer', '/api/bank-basic/settings', '/api/bank-basic/transfers/1/reverse', '/api/teach/audit/run']) assert.ok(paths.includes(expected), expected);
    const cookie = role === 'anonymous' ? ''
      : role === 'student' ? `sid=${srv.app.players.startSession(students[0].id, 1)}`
      : (await srv.client().post('/api/login', { username: 'teacher', secret: 'correct horse battery' })).headers.get('set-cookie').split(';')[0];
    const total = await sweep(srv, role, cookie, paths);
    assert.equal((await srv.client().get('/api/me')).status, 200);               // still alive
    assert.equal(srv.app.ledger.audit().ok, true);
    return total;
  } finally { await srv.cleanup(); }
}
