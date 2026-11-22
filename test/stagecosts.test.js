// Stage costs (docs/stagecosts.md): bill lines that start with age (Stage B at 36: household, vehicle, home upkeep or renter extras; Stage C at 55: health
// and care stepping up at 60 and 65, travel). A world jumped to the edges of the stages: nothing before month 169, the defaults from it (no choice is written:
// a slot's default is its first option), a tier change applying from the next bill, the price index, the age steps, a retired student still billed,
// a late stage line through the late-fee and stress path, the ledger audit after every advance, retirement's check and projection counting the lines,
// and an idle student short where a saver is covered.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createApp } from '../lib/app.js';
import { createClock } from '../lib/clock.js';
import { tmpDir } from './helpers.js';
import { monthOfAge } from '../modules/life/stages.js';
import { YMPE, CPP_EXEMPTION_ANNUAL } from '../modules/jobs/payroll.js';
import { lastsUntil } from '../modules/retirement/calc.js';
import { ITEMS, forAge } from '../modules/bills/catalogue.js';
import billsDef from '../modules/bills/index.js';

const CONFIG = JSON.parse(fs.readFileSync(new URL('../config/vdaa.json', import.meta.url), 'utf8'));
const made = [];
after(() => { for (const d of made) fs.rmSync(d, { recursive: true, force: true }); });
const STAGE = new Set(ITEMS.filter((i) => i.from_age > 0).map((i) => i.id));
const base = (id) => ITEMS.find((i) => i.id === id).amount_cents;

async function world(n) {
  const dataDir = tmpDir();
  made.push(dataDir);
  let t = Date.parse('2026-11-02T15:00:00Z');
  const app = await createApp({ dataDir, config: CONFIG, clock: createClock({ now: () => t }) });
  app.world.create();
  const cls = app.players.createClass({ name: 'Block 1', course: 'fintech10' });
  const ids = await app.players.createStudents({ classId: cls.id, count: n, hash: false });
  for (const s of ids) app.modules.onLogin({ ...s, class_id: cls.id }, 'fintech10');
  const users = ids.map((s) => ({ id: s.id, username: s.username, role: 'student', class_id: cls.id }));
  const wid = () => app.world.current().id;
  // billed from month 1 (the config bills from the month after the first pay; these students have no job)
  for (const u of users) app.db.prepare('INSERT OR REPLACE INTO bills_start (player_id, world_id, start_month) VALUES (?, ?, 1)').run(u.id, wid());
  const handler = (mod, method, p) => app.modules.routes().find((r) => r.module === mod && r.method === method && r.path === p).handler;
  const get = (mod, p, user) => handler(mod, 'GET', p)({ user, body: {}, params: {}, url: new URL('http://t/') });
  const post = (mod, p, body, user) => handler(mod, 'POST', p)({ user, body, params: {}, url: new URL('http://t/') });
  const advance = () => { t += 60_000; app.world.advance({ months: 1 }); const r = app.ledger.audit(); assert.equal(r.ok, true, JSON.stringify(r.problems)); };
  const jumpTo = (month) => app.db.prepare('UPDATE worlds SET month = ? WHERE id = ?').run(month, wid());
  const acct = (id, kind) => app.ledger.openAccount({ ownerType: 'player', ownerId: id, kind });
  const grant = (id, kind, cents) => app.ledger.post({ kind: 'test.grant', legs: [{ account: app.ledger.system('mint'), cents: -cents }, { account: acct(id, kind), cents }] });
  const due = (id, month) => app.db.prepare('SELECT * FROM bills_due WHERE player_id = ? AND world_id = ? AND due_month = ? ORDER BY id').all(id, wid(), month);
  const stage = (id, month) => due(id, month).filter((d) => STAGE.has(d.bill_id)).map((d) => d.bill_id).sort();
  const autopay = (id, on) => app.db.prepare('UPDATE bills_settings SET autopay = ?, bot_decided = 1 WHERE player_id = ?').run(on ? 1 : 0, id);
  return { app, users, get, post, advance, jumpTo, grant, due, stage, autopay, wid, close: () => app.db.close() };
}

test('the catalogue: Stage A rows bill at every age; stage rows only inside their ages; one row per tenure for home upkeep', () => {
  const ids = (age, owner) => forAge(ITEMS, age, owner).filter((i) => STAGE.has(i.id)).map((i) => i.id).sort();
  assert.deepEqual(ids(null, false), [], 'no life module: nothing but Stage A');
  assert.deepEqual(ids(35, false), []);
  assert.deepEqual(ids(36, false), ['household-full', 'household-modest', 'renter-extras', 'vehicle-new', 'vehicle-used']);
  assert.deepEqual(ids(36, true), ['home-upkeep', 'household-full', 'household-modest', 'vehicle-new', 'vehicle-used']);
  assert.deepEqual(ids(55, false), ['health-55', 'renter-extras', 'travel-full', 'travel-modest']);
  assert.deepEqual(ids(64, false), ['health-60', 'renter-extras', 'travel-full', 'travel-modest']);
  assert.deepEqual(ids(70, false), ['health-65', 'renter-extras', 'travel-full', 'travel-modest']);
  assert.equal(forAge(ITEMS, 70, false).filter((i) => !STAGE.has(i.id)).length, ITEMS.filter((i) => !STAGE.has(i.id)).length, 'Stage A rows at 70 too');
  for (const i of ITEMS.filter((x) => STAGE.has(x.id))) assert.ok(i.source_note && i.illustrative === 1 && i.checked === '2026-10-30', i.id);
});

test('Stage B: nothing at month 168, the defaults at 169 (no choice written) with one feed note; a tier change applies from the next bill; owners pay home upkeep', async () => {
  const w = await world(3);
  const [a, b, owner] = w.users;
  try {
    for (const u of w.users) w.grant(u.id, 'chequing', 10_000_000);
    w.jumpTo(monthOfAge(36) - 2);
    w.advance();                                                                    // month 168, age 35
    assert.equal(w.app.world.current().month, 168);
    for (const u of w.users) assert.deepEqual(w.stage(u.id, 168), [], 'no stage line before 36');
    assert.throws(() => w.post('bills', '/choice', { slot: 'household', option: 'full' }, a), (e) => e.status === 400, 'a stage slot is not offered before its age');
    assert.ok(!w.get('bills', '/state', a).slots.some((s) => s.slot === 'household'), 'Plans shows no Stage B slot at 35');
    // the owner's housing lines for month 169 (as housing emits them): a primary home's property tax
    w.app.db.prepare("INSERT INTO bills_lines (player_id, world_id, month, bill_id, name, amount, category) VALUES (?, ?, 169, 'housing-property-tax', 'Property tax', 20000, 'needs')").run(owner.id, w.wid());
    w.advance();                                                                    // month 169, age 36: Stage B
    const idx = w.app.world.priceIndex();
    assert.deepEqual(w.stage(a.id, 169), ['household-modest', 'renter-extras', 'vehicle-used']);
    assert.deepEqual(w.stage(owner.id, 169), ['home-upkeep', 'household-modest', 'vehicle-used'], 'an owner: home upkeep, not renter extras');
    const hh = w.due(a.id, 169).find((d) => d.bill_id === 'household-modest');
    assert.equal(hh.amount, Math.round((base('household-modest') * idx) / 10000), 'season-start amount x the price index');
    assert.equal(w.app.db.prepare('SELECT COUNT(*) AS n FROM bills_choices').get().n, 0, 'the default is the slot\'s first option: nothing is written');
    const notes = w.app.db.prepare("SELECT text FROM feed_items WHERE world_id = ? AND kind = 'town' AND text LIKE '%Stage B%'").all(w.wid());
    assert.equal(notes.length, 1);
    assert.match(notes[0].text, /New life costs start on this month's bills/);
    const s = w.get('bills', '/state', a);
    assert.equal(s.slots.find((x) => x.slot === 'household').current, 'modest', 'Plans shows the new slot at its default');
    assert.ok(s.catalogue.some((c) => c.id === 'renter-extras') && !s.catalogue.some((c) => c.id === 'home-upkeep'), 'a renter\'s price list');
    assert.ok(w.get('bills', '/state', owner).catalogue.some((c) => c.id === 'home-upkeep'), 'an owner\'s price list');
    // b changes tiers in month 169: from month 170
    w.post('bills', '/choice', { slot: 'household', option: 'full' }, b);
    w.post('bills', '/choice', { slot: 'vehicle', option: 'none' }, b);
    w.advance();                                                                    // month 170
    assert.deepEqual(w.stage(b.id, 169), ['household-modest', 'renter-extras', 'vehicle-used'], 'this month\'s bill is already issued');
    assert.deepEqual(w.stage(b.id, 170), ['household-full', 'renter-extras']);
    assert.deepEqual(w.stage(a.id, 170), ['household-modest', 'renter-extras', 'vehicle-used'], 'the default again, every month');
    assert.equal(w.app.db.prepare("SELECT COUNT(*) AS n FROM feed_items WHERE world_id = ? AND text LIKE '%Stage B%'").get(w.wid()).n, 1, 'one note');
    // the Life panel lists them with the student's choice
    const life = w.get('life', '/state', b);
    assert.equal(life.stage_costs.choices.household, 'full');
    assert.ok(life.stage_costs.lines.some((l) => l.id === 'health-65' && l.from_age === 65));
    assert.ok(w.get('life', '/teach', { id: 0, role: 'teacher', username: 't', world_teacher: 1 }).stage_costs.length >= STAGE.size, 'the teacher table');
  } finally { w.close(); }
});

test('a stage line unpaid goes late like any bill: a fee line, the late event, stress; monthBills counts the line and not the fee', async () => {
  const w = await world(2);
  const [late, payer] = w.users;
  try {
    w.autopay(late.id, false);
    w.grant(payer.id, 'chequing', 10_000_000);
    const seen = [];
    w.app.events.on('module.bills.late', (p) => seen.push(p));
    w.jumpTo(monthOfAge(36) - 1);
    w.advance();                                                                    // 169: issued, nobody pays for `late`
    w.advance();                                                                    // 170: month 169's lines are late
    const hh = w.due(late.id, 169).find((d) => d.bill_id === 'household-modest');
    assert.equal(hh.late, 1);
    const fee = w.due(late.id, 170).find((d) => d.bill_id === `late-fee-${hh.id}`);
    assert.ok(fee && fee.category === 'fees' && fee.amount === Math.max(2500, Math.round(hh.amount * 0.05)));
    assert.ok(seen.some((e) => e.playerId === late.id && e.billId === 'household-modest' && e.first === true));
    const score = (id) => w.app.db.prepare('SELECT score FROM stress_state WHERE player_id = ? AND world_id = ?').get(id, w.wid())?.score ?? 0;
    assert.ok(score(late.id) > score(payer.id), `stress ${score(late.id)} vs ${score(payer.id)}`);
    const mb = w.app.modules.kernel('life').modules.call('bills', 'monthBills', { playerId: late.id });
    const lines = w.due(late.id, 170).filter((d) => d.category !== 'fees');
    assert.equal(mb.cents, lines.reduce((t, d) => t + d.amount, 0));
    assert.ok(lines.some((d) => d.bill_id === 'household-modest'));
    assert.deepEqual(w.due(payer.id, 169).filter((d) => d.paid_txn === null), [], 'autopay paid the stage lines too');
    // the sim's bots (bills' simulate): one behind on a bill cuts its optional stage lines to None; one who is not keeps the defaults
    billsDef.simulate(w.app.modules.kernel('bills'), { month: 170, students: w.users.map((u) => ({ id: u.id, class_id: u.class_id })) });
    const choices = (id) => Object.fromEntries(w.app.db.prepare('SELECT slot, option FROM bills_choices WHERE player_id = ?').all(id).map((r) => [r.slot, r.option]));
    assert.deepEqual(choices(late.id), { household: 'none', vehicle: 'none' });
    assert.deepEqual(choices(payer.id), {});
  } finally { w.close(); }
});

test('Stage C: health and travel from 55, health steps at 60 and 65, nothing of Stage B left; a retired student is still billed; the check and the projection count them', async () => {
  const w = await world(1);
  const [u] = w.users;
  try {
    w.grant(u.id, 'chequing', 50_000_000);
    w.jumpTo(monthOfAge(55) - 1);
    w.advance();                                                                    // 397, age 55
    assert.deepEqual(w.stage(u.id, 397), ['health-55', 'renter-extras', 'travel-modest']);
    w.jumpTo(monthOfAge(60) - 1);
    w.advance();                                                                    // 457, age 60
    assert.deepEqual(w.stage(u.id, 457), ['health-60', 'renter-extras', 'travel-modest']);
    const h60 = w.due(u.id, 457).find((d) => d.bill_id === 'health-60').amount;
    assert.equal(h60, Math.round((base('health-60') * w.app.world.priceIndex()) / 10000));
    w.jumpTo(monthOfAge(66) - 1);
    w.advance();                                                                    // 529, age 66: retired at the default 65
    assert.equal(w.app.modules.kernel('life').modules.call('life', 'retired', { playerId: u.id }).retired, true);
    assert.deepEqual(w.stage(u.id, 529), ['health-65', 'renter-extras', 'travel-modest'], 'retired, still billed');
    const v = w.get('retirement', '/state', u);
    const billed = w.due(u.id, 529).filter((d) => d.category !== 'fees').reduce((t, d) => t + d.amount, 0);
    assert.equal(v.check.bills_cents, billed, 'the check\'s bills are the month\'s lines, stage lines included');
    // the projection's steps: at 59 the health line steps up at 60 and 65
    const sc = w.app.modules.kernel('life').modules.call('bills', 'stageCosts', { playerId: u.id, baseAge: 59 });
    assert.deepEqual(sc.steps.map((s) => s.age), [59, 60, 65]);
    assert.ok(sc.steps[1].cents > sc.steps[0].cents && sc.steps[2].cents > sc.steps[1].cents, JSON.stringify(sc.steps));
  } finally { w.close(); }
});

test('the projection counts the age steps: the same savings run out sooner when health care steps up', () => {
  const args = { age: 58, offset: 0, retireAge: 60, cppAge: 65, oasAge: 65, cpp: 80000, oas: 76000, planCents: 0, billsCents: 250000, order: ['rrsp', 'invest', 'hisa', 'tfsa'],
    pots: { rrsp: { cents: 30_000_000, rate_bp: 400 }, invest: { cents: 0, rate_bp: 0 }, hisa: { cents: 0, rate_bp: 0 }, tfsa: { cents: 0, rate_bp: 0 } } };
  const flat = lastsUntil(args);
  const stepped = lastsUntil({ ...args, steps: [{ age: 58, cents: 50000 }, { age: 60, cents: 60000 }, { age: 65, cents: 80000 }] });
  assert.ok(stepped < flat, `${stepped} < ${flat}`);
  assert.equal(lastsUntil({ ...args, steps: [{ age: 58, cents: 50000 }] }), flat, 'no step after today: the same as before');
});

test('directions at 65: an idle student (pensions only) is short; a saver with a draw plan is covered', async () => {
  const w = await world(2);
  const [idle, saver] = w.users;
  try {
    // 33 years at 60% of the pensionable range (a typical record in the life-cycle runs), both
    const job = w.app.db.prepare('SELECT id FROM jobs_catalogue ORDER BY id LIMIT 1').get().id, txn = w.app.db.prepare('SELECT id FROM txns ORDER BY id LIMIT 1').get().id;
    const ins = w.app.db.prepare("INSERT INTO jobs_paystubs (player_id, world_id, month, job_id, gross, cpp, cpp2, ei, federal_tax, alberta_tax, net, ytd_json, txn_id) VALUES (?, ?, ?, ?, ?, 1, 0, 0, 0, 0, 0, '{}', ?)");
    for (const u of w.users) for (let y = 1; y <= 33; y++) ins.run(u.id, w.wid(), 12 * y, job, Math.round(CPP_EXEMPTION_ANNUAL + 0.6 * (YMPE - CPP_EXEMPTION_ANNUAL)), txn);
    w.grant(idle.id, 'chequing', 30_000_000);                                      // $300,000 in chequing: not a retirement plan
    w.grant(saver.id, 'chequing', 1_000_000);
    w.grant(saver.id, 'rrsp', 30_000_000);
    w.grant(saver.id, 'tfsa', 20_000_000);
    w.jumpTo(monthOfAge(65) - 1);
    w.advance(); w.advance();                                                       // 517-518: retired; the bills now hold Stage C lines
    const gap = (v) => Math.max(0, v.check.bills_cents - (v.check.pension_cents - v.check.tax_cents));
    w.post('retirement', '/plan', { monthly_cents: Math.round(gap(w.get('retirement', '/state', saver)) * 1.3), order: ['rrsp', 'invest', 'hisa', 'tfsa'] }, saver);   // x1.3: room for the RRSP withholding
    w.advance(); w.advance();
    const i = w.get('retirement', '/state', idle).check, s = w.get('retirement', '/state', saver).check;
    assert.ok(i.coverage_pct < 90 && !i.covered, `idle: ${i.coverage_pct}%`);
    assert.ok(s.covered && s.coverage_pct === 100, `saver: ${s.coverage_pct}%, short ${s.shortfall_cents}`);
  } finally { w.close(); }
});
