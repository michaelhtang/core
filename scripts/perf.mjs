// Perf harness for the ledger hot paths. Seeds a temp DB (10 classes x 30 bots, 60k txns of mixed kinds with ~2% reversals,
// one account with 3,000 entries) and times the paths that grow with history.
//   node scripts/perf.mjs [sentSince=5] [feed=5] [stmt50=2] [stmt500=10] [dupReverse=1] [console=10] [audit=<ms>] [payday=<ms>] [month300=<ms>] [retire517=<ms>] [stagec=<ms>]
// Each name=ms argument is a ceiling; the script exits 1 if any measured median is above it. No arguments: just print.
// It drives the real code (bank-basic route handlers, ledger.statement/reverse/audit), so it runs on any commit.
//
// BEFORE Step 1 (v0-core, 60,000 txns, 120,000 entries; the big account has 3,001 entries incl. its welcome grant; median ms):
//   sentSince    5342.97   (teacher-free student /status: 24h sent total, 1,500 rows in window)
//   feed          342.95   (teacher transfers list, LIMIT 100)
//   stmt50         16.74
//   stmt500       154.21
//   dupReverse      2.96   (ledger.reverse on an already-reversed txn)
//   audit          71.29
// console = what a teacher's console load reads: their class list with student counts + the student list (balances) of the biggest class.
// audit = the full ledger.audit() calculation; the console itself reads the stored result (audit_runs), so this is the nightly/button cost.
// AFTER Step 1 (migration 003): sentSince 0.82, feed 0.50, stmt50 0.07, stmt500 0.43, dupReverse 0.04, audit 75.29.
// payday = the jobs module's payday for all 300 students in one world month (the T4127 pay stub, one ledger txn and one stub row each),
// timed as world.advance({ months: 1 }) with a job for every bot minus the same advance with no jobs held, so only the jobs hook is counted.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createApp } from '../lib/app.js';
import { withTxn } from '../lib/db.js';

const limits = Object.fromEntries(process.argv.slice(2).map((a) => a.split('=')).map(([k, v]) => [k, Number(v)]));
let seed = 12345;
const rnd = (n) => (seed = (seed * 1103515245 + 12345) % 2147483648) % n;

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vdaa-perf-'));
const app = await createApp({ dataDir });
const { db, ledger } = app;
app.world.create({ name: 'Perf' });

const classes = [];
for (let c = 0; c < 10; c++) {
  const cls = app.players.createClass({ name: `Block ${c + 1}`, course: 'fintech10' });
  const bots = await app.players.createStudents({ classId: cls.id, count: 30, hash: false });
  for (const b of bots) { app.modules.onLogin({ ...b, class_id: cls.id }, 'fintech10'); b.acct = ledger.accountId('player', b.id, 'chequing'); }
  classes.push({ cls, bots });
}

const TOTAL = 60_000 - 300, BIG = 3000, REVERSALS = 1200;   // 300 welcome grants already posted, so 60k txns in all
const transferIds = [];
const t0 = performance.now();
withTxn(db, () => {
  const mint = ledger.system('mint');
  const big = classes[0].bots[0], peers = classes[0].bots.slice(1);
  const meta = (a, b) => ({ from: a.id, to: b.id, fromName: a.username, toName: b.username });
  // the 3,000-entry account: 1,500 sends and 1,500 receives of $1 against rotating peers
  for (let i = 0; i < BIG / 2; i++) {
    const p = peers[i % peers.length];
    transferIds.push(ledger.post({ kind: 'bank-basic.transfer', actor: `player:${big.id}`, meta: meta(big, p), legs: [{ account: big.acct, cents: -100 }, { account: p.acct, cents: 100 }] }));
    ledger.post({ kind: 'bank-basic.transfer', actor: `player:${p.id}`, meta: meta(p, big), legs: [{ account: p.acct, cents: -100 }, { account: big.acct, cents: 100 }] });
  }
  for (let n = BIG; n < TOTAL - REVERSALS; n++) {
    const bots = classes[rnd(10)].bots.filter((x) => x !== big);   // the big account stays at exactly 3,000 entries
    const a = bots[rnd(bots.length)], b = bots[(bots.indexOf(a) + 1 + rnd(bots.length - 1)) % bots.length];
    const r = rnd(100);
    if (r < 70) {
      const cents = 100 + rnd(400);
      try { transferIds.push(ledger.post({ kind: 'bank-basic.transfer', actor: `player:${a.id}`, meta: meta(a, b), legs: [{ account: a.acct, cents: -cents }, { account: b.acct, cents }] })); continue; } catch { /* overdrawn: fall through to a grant */ }
    }
    const kind = r < 85 ? 'grant' : 'payday';
    ledger.post({ kind, meta: { reason: 'perf' }, legs: [{ account: mint, cents: -1000 }, { account: a.acct, cents: 1000 }] });
  }
  let done = 0;
  for (let i = 0; done < REVERSALS && i < transferIds.length * 3; i++) {
    const id = transferIds[BIG / 2 + rnd(transferIds.length - BIG / 2)];
    try { ledger.reverse(id); done++; } catch { /* already reversed or recipient spent it */ }
  }
});
const counts = db.prepare("SELECT COUNT(*) AS n, SUM(kind = 'core.reversal') AS r FROM txns").get();
console.log(`seeded ${counts.n} txns (${counts.r} reversals), ${db.prepare('SELECT COUNT(*) AS n FROM entries').get().n} entries in ${((performance.now() - t0) / 1000).toFixed(1)}s`);

// The seed posts straight through the ledger, so record each transfer's class the way the bank's /transfer route does, and
// measure the feed as a teacher who teaches all ten classes.
db.exec(`INSERT OR IGNORE INTO bank_transfers (txn_id, class_id)
  SELECT t.id, p.class_id FROM txns t JOIN players p ON p.id = json_extract(t.meta, '$.from') WHERE t.kind = 'bank-basic.transfer'`);
const teacherId = Number(db.prepare("INSERT INTO players (username, pin_hash, role, created) VALUES ('perf-teacher', '!', 'teacher', 0)").run().lastInsertRowid);
for (const { cls } of classes) db.prepare('INSERT OR IGNORE INTO class_teachers (class_id, teacher_id) VALUES (?, ?)').run(cls.id, teacherId);
const teacher = { id: teacherId, role: 'teacher', world_teacher: 0, username: 'perf-teacher' };

// ---- measure ----
const bigBot = classes[0].bots[0];
const user = { id: bigBot.id, class_id: classes[0].cls.id, username: bigBot.username };
const route = (m, p) => app.modules.routes().find((r) => r.module === 'bank-basic' && r.method === m && r.path === p).handler;
const status = route('GET', '/status'), feed = route('GET', '/transfers');
const reversed = db.prepare("SELECT id, json_extract(meta, '$.reverses') AS orig FROM txns WHERE kind = 'core.reversal' LIMIT 1").get();

const time = (fn, runs = 5) => {
  const ts = [];
  for (let i = 0; i < runs; i++) { const s = performance.now(); fn(); ts.push(performance.now() - s); }
  return ts.sort((a, b) => a - b)[runs >> 1];
};
const dupReverse = () => { try { ledger.reverse(reversed.orig); } catch (e) { if (e.message !== 'Already reversed') throw e; return; } throw new Error('duplicate reversal was not refused'); };

const inWindow = db.prepare("SELECT COUNT(*) AS n FROM entries e JOIN txns t ON t.id = e.txn_id WHERE e.account_id = ? AND e.amount_cents < 0 AND t.kind = 'bank-basic.transfer'").get(bigBot.acct).n;
const results = {
  sentSince: time(() => status({ user })),
  feed: time(() => { if (feed({ user: teacher }).transfers.length !== 100) throw new Error('feed did not return 100 rows'); }),
  stmt50: time(() => ledger.statement(bigBot.acct, { limit: 50 })),
  stmt500: time(() => ledger.statement(bigBot.acct, { limit: 500 })),
  dupReverse: time(dupReverse),
  console: time(() => {
    const mine = app.players.teacherClasses(teacher.id);
    const biggest = mine.reduce((a, c) => (c.students > a.students ? c : a));
    if (mine.length !== 10 || app.players.classStudents(biggest.id).length !== 30) throw new Error('console read the wrong rows');
  }),
  audit: time(() => ledger.audit(), 3),
};
console.log(`big account: ${db.prepare('SELECT COUNT(*) AS n FROM entries WHERE account_id = ?').get(bigBot.acct).n} entries, ${inWindow} sends in window`);
// payday: every bot takes a job (the catalogue in rotation); the advance with no jobs held is the baseline to subtract.
const baseline = time(() => app.world.advance({ months: 1 }), 3);
const holds = db.prepare('INSERT INTO jobs_holdings (player_id, job_id, since_month) VALUES (?, ?, ?)');
withTxn(db, () => classes.flatMap(({ bots }) => bots).forEach((b, i) => holds.run(b.id, (i % 12) + 1, 1)));
const before = db.prepare('SELECT COUNT(*) AS n FROM jobs_paystubs').get().n;
results.payday = Math.max(0, time(() => app.world.advance({ months: 1 }), 3) - baseline);
if (db.prepare('SELECT COUNT(*) AS n FROM jobs_paystubs').get().n - before !== 900) throw new Error('payday did not pay 300 students in each of 3 months');
// month300: one whole world month for the 300 students with every module ticking and the exchange in play: the bots take their turns for three months first
// (jobs, bills, savings and the exchange's dollar-cost-averagers, stock holders and chasers all trade), then the advance is timed.
if (app.modules.has('exchange')) {
  const botList = classes.flatMap(({ cls, bots }) => bots.map((b) => ({ id: b.id, class_id: cls.id, course_id: 'fintech10' })));
  for (let i = 0; i < 3; i++) { app.modules.simulate({ month: app.world.current().month, students: botList }); app.world.advance({ months: 1 }); }
  const investing = db.prepare('SELECT COUNT(DISTINCT player_id) AS n FROM exchange_holdings WHERE units_micro > 0').get().n;
  results.month300 = time(() => app.world.advance({ months: 1 }), 3);
  console.log(`month300: ${investing} of 300 students hold something, ${db.prepare('SELECT COUNT(*) AS n FROM exchange_trades').get().n} trades so far`);
}
// Stage C (docs/phase5-life.md 5c): the 300 students jumped to age 64 with 515 months of price history, a CPP record (a stub a month), $300,000 in RRSP, TFSA
// and non-registered accounts (half of each in the index fund) and a $3,000 draw plan, non-registered first. retire517 = the month they turn 65 (work stops,
// CPP and OAS start, the first draws, sales at the bid); stagec = the median of the next three months (pensions, draws and the live check for everyone).
if (app.modules.has('retirement') && app.modules.has('life')) {
  const w = app.world.current(), from = w.month;
  const users = classes.flatMap(({ cls, bots }) => bots.map((b) => ({ id: b.id, username: b.username, role: 'student', class_id: cls.id })));
  const route = (mod, p) => app.modules.routes().find((r) => r.module === mod && r.method === 'POST' && r.path === p).handler;
  const post = (mod, p, body, user) => route(mod, p)({ user, body, params: {}, url: new URL('http://perf/') });
  const job = db.prepare('SELECT id FROM jobs_catalogue ORDER BY id LIMIT 1').get().id, txn = db.prepare('SELECT id FROM txns ORDER BY id LIMIT 1').get().id;
  withTxn(db, () => {
    const last = db.prepare('SELECT ticker, price_micro FROM exchange_prices p WHERE world_id = ? AND month = (SELECT MAX(month) FROM exchange_prices WHERE world_id = p.world_id AND ticker = p.ticker)').all(w.id);
    const price = db.prepare('INSERT OR IGNORE INTO exchange_prices (world_id, ticker, month, price_micro, halted) VALUES (?, ?, ?, ?, 0)');
    for (let m = from; m <= 515; m++) for (const x of last) price.run(w.id, x.ticker, m, x.price_micro);
    const stub = db.prepare("INSERT OR IGNORE INTO jobs_paystubs (player_id, world_id, month, job_id, gross, cpp, cpp2, ei, federal_tax, alberta_tax, net, ytd_json, txn_id) VALUES (?, ?, ?, ?, 500000, 25000, 0, 0, 0, 0, 0, '{}', ?)");
    const mint = ledger.system('mint');
    for (const u of users) {
      for (let m = from; m <= 515; m++) stub.run(u.id, w.id, m, job, txn);
      for (const a of ['rrsp', 'tfsa', 'invest']) ledger.post({ kind: 'perf.grant', legs: [{ account: mint, cents: -10_000_000 }, { account: ledger.openAccount({ ownerType: 'player', ownerId: u.id, kind: a }), cents: 10_000_000 }] });
    }
    db.prepare('UPDATE worlds SET month = 515 WHERE id = ?').run(w.id);
  });
  for (const u of users) {
    for (const a of ['rrsp', 'tfsa', 'invest']) post('exchange', '/order', { ticker: 'DAAX', account: a, side: 'buy', type: 'market', cents: 5_000_000 }, u);
    post('retirement', '/plan', { monthly_cents: 300_000, order: ['invest', 'rrsp', 'hisa', 'tfsa'] }, u);
  }
  app.world.advance({ months: 1 });                                                                // 516: age 64, the last month before the pensions
  results.retire517 = time(() => app.world.advance({ months: 1 }), 1);
  results.stagec = time(() => app.world.advance({ months: 1 }), 3);
  const paid = db.prepare('SELECT COUNT(*) AS n, SUM(draw_cents) AS d FROM retirement_income WHERE world_id = ? AND month = ?').get(w.id, app.world.current().month);
  console.log(`stagec: month ${app.world.current().month}, ${paid.n} students paid, draws $${(paid.d / 100).toFixed(0)}, audit ${ledger.audit().ok ? 'OK' : 'FAIL'}`);
}
console.log('path'.padEnd(12), 'median ms'.padStart(10), 'limit'.padStart(8));
let failed = false;
for (const [k, v] of Object.entries(results)) {
  const over = k in limits && v > limits[k];
  failed ||= over;
  console.log(k.padEnd(12), v.toFixed(2).padStart(10), (k in limits ? String(limits[k]) : '-').padStart(8), over ? ' FAIL' : '');
}

app.db.close();
fs.rmSync(dataDir, { recursive: true, force: true });
process.exit(failed ? 1 : 0);
