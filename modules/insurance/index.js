// insurance: policies and town events (docs/phase2.md Wave 2b).
// Policies: tenant ($20/mo, $500 deductible) and phone protection ($12/mo, $100) are bought and cancelled by the student and take effect NEXT month.
// Auto and condo-unit cover are automatic: auto when the student chose the car in Bills (module.bills.choices; the premium is bills' own "Car insurance"
// line), condo when they own a home (module.housing.value; housing's costs already include the premium). Neither is billed twice.
// Premiums are bills lines: every tick, BEFORE bills (config order: ... housing, insurance, credit, bills ...), insurance emits
// module.insurance.costs { playerId, month, lines } and bills turns them into due lines 'insurance-<key>' (one month late, never reversed, if misordered).
// Town events: the world teacher triggers one from the catalogue for a class or the whole town; it lands at the next tick. An optional random monthly
// draw (config.randomEvents, default off). Fairness caps: at most 1 event per student per 3 world months, and a per-student dollar cap per season.
// An expense emits module.insurance.expense { playerId, month, eventId, eventKey, name, amount, insuredBy } (eventId is an addition to the phase2
// payload: bills keys its due line `event-<eventId>` by it). If a held policy covers it, insurance posts a claim in the same tick (kind 'claim',
// mint -> chequing, amount minus the deductible, never negative); the student sees the full bill AND the claim. A windfall credits chequing
// from the mint (kind 'windfall'). Only students bills has announced (module.bills.choices, at their first billed tick) are eligible, so nobody
// receives a claim for a bill that was never issued.
// Waiting period: a bought policy pays a claim only if it was in force for the whole month before the event lands (start_month < event month): bought in m,
// it starts (and is billed) from m+1 and pays for events landing from m+2, so a teacher trigger queued in the month you buy is not covered. Same rule for random events,
// and for auto and condo cover: auto starts the month after the student switches to the car (module.bills.choices), condo the month after they buy (module.housing.value).
// Random events are drawn from an HMAC keyed by a per-world secret kept only in insurance_secrets (never in a route response), so the code and a student's id
// are not enough to predict them; the same world and secret always give the same draws.
import { createHmac, randomBytes } from 'node:crypto';
import { defineModule } from '../../lib/modules.js';
import { money, dice, ok } from '../../lib/kernel.js';
import { POLICIES, EVENTS, CHECKED, MIN_GAP_MONTHS, SEASON_CAP_CENTS, RANDOM_CHANCE_PCT } from './constants.js';

const ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3l8 3v6c0 4.5-3.2 8-8 9-4.8-1-8-4.5-8-9V6z"/><path d="M8.5 12l2.5 2.5 4.5-5"/></svg>';
// A random-event draw, 0..99, from the world's secret (randomBytes(16) hex, made on first use, like exchange's price secret).
function secretOf(k, worldId) {
  const row = k.db.prepare('SELECT secret FROM insurance_secrets WHERE world_id = ?').get(worldId);
  if (row) return row.secret;
  const secret = randomBytes(16).toString('hex');
  k.db.prepare('INSERT INTO insurance_secrets (world_id, secret) VALUES (?, ?)').run(worldId, secret);
  return secret;
}
const draw = (secret, worldId, id, month, salt) => createHmac('sha256', secret).update(`${worldId}:${id}:${month}:${salt}`).digest().readUInt32BE(0) % 100;
const policyOf = (key) => POLICIES.find((p) => p.key === key);

const amountOf = (k, ev) => (ok(k.config.eventAmounts?.[ev.key]) && k.config.eventAmounts[ev.key] > 0 ? k.config.eventAmounts[ev.key] : ev.amountCents);
const gap = (k) => (ok(k.config.minGapMonths) && k.config.minGapMonths > 0 ? k.config.minGapMonths : MIN_GAP_MONTHS);
const seasonCap = (k) => (ok(k.config.seasonCapCents) && k.config.seasonCapCents >= 0 ? k.config.seasonCapCents : SEASON_CAP_CENTS);

// When auto and condo cover started in this world (null when the student has none here).
const autoStart = (p, worldId) => (p?.auto_cents > 0 && p.auto_world === worldId ? p.auto_start : null);
const condoStart = (p, worldId) => (p?.owner_world === worldId ? p.condo_start : null);
const playerRow = (k, playerId) => k.db.prepare('SELECT auto_cents, auto_world, auto_start, owner_world, condo_start FROM insurance_players WHERE player_id = ?').get(playerId);

// The policy keys a student holds in this month: bought ones that have started (by `since`) and not ended, auto (car chosen) and condo (owns a home).
// A claim asks with since = month - 1: the waiting period.
function held(k, playerId, worldId, month, since = month) {
  const keys = new Set(k.db.prepare('SELECT key FROM insurance_policies WHERE player_id = ? AND world_id = ? AND start_month <= ? AND (end_month IS NULL OR ? < end_month)').all(playerId, worldId, since, month).map((r) => r.key));
  const p = playerRow(k, playerId);
  if ((autoStart(p, worldId) ?? Infinity) <= since) keys.add('auto');
  if ((condoStart(p, worldId) ?? Infinity) <= since) keys.add('condo');
  return keys;
}

// One event for one student: caps first, then the expense (and claim) or the windfall. Returns 'applied' | 'recent' | 'cap'.
function applyEvent(k, w, month, playerId, ev, triggerId) {
  if (k.db.prepare('SELECT 1 FROM insurance_events WHERE player_id = ? AND world_id = ? AND month > ?').get(playerId, w.id, month - gap(k))) return 'recent';
  const amount = amountOf(k, ev);
  if (ev.kind === 'expense') {
    const so = k.db.prepare("SELECT COALESCE(SUM(amount), 0) AS n FROM insurance_events WHERE player_id = ? AND world_id = ? AND kind = 'expense'").get(playerId, w.id).n;
    if (so + amount > seasonCap(k)) return 'cap';
  }
  const chq = k.ledger.accountId('player', playerId, 'chequing');
  if (ev.kind === 'windfall') {
    const txn = k.ledger.post({ kind: 'windfall', meta: { event: ev.key, month }, legs: [{ account: k.ledger.system('mint'), cents: -amount, memo: ev.name }, { account: chq, cents: amount, memo: ev.name }] });
    k.db.prepare('INSERT INTO insurance_events (world_id, trigger_id, player_id, month, event_key, name, kind, amount, claim_txn) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)').run(w.id, triggerId, playerId, month, ev.key, ev.name, 'windfall', amount, txn);
    return 'applied';
  }
  const mine = held(k, playerId, w.id, month, month - 1);            // in force for the whole month before this one
  const by = ev.covers.find((key) => mine.has(key)) ?? null;
  const deductible = by ? policyOf(by).deductibleCents : 0;
  const claim = by ? Math.max(0, amount - deductible) : 0;
  const id = Number(k.db.prepare('INSERT INTO insurance_events (world_id, trigger_id, player_id, month, event_key, name, kind, amount, insured_by, deductible, claim_cents) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .run(w.id, triggerId, playerId, month, ev.key, ev.name, 'expense', amount, by, deductible, claim).lastInsertRowid);
  k.events.emit('expense', { playerId, month, eventId: id, eventKey: ev.key, name: ev.name, amount, insuredBy: by });
  if (claim > 0) {
    const txn = k.ledger.post({ kind: 'claim', meta: { event: ev.key, policy: by, month, eventId: id }, legs: [{ account: k.ledger.system('mint'), cents: -claim, memo: `Claim: ${ev.name}` }, { account: chq, cents: claim, memo: `${policyOf(by).name} claim: ${ev.name}, minus your deductible` }] });
    k.db.prepare('UPDATE insurance_events SET claim_txn = ? WHERE id = ?').run(txn, id);
  }
  return 'applied';
}

// Premiums follow the world price index (10000 = none; also when rates is not loaded).
const premium = (k, worldId, cents) => Math.round((cents * k.world.priceIndex(worldId)) / 10000);

function tick(k, { month, classes }) {
  const w = k.world.current();
  const known = new Set(k.db.prepare('SELECT player_id FROM insurance_known WHERE world_id = ?').all(w.id).map((r) => r.player_id));
  const byClass = classes.map((c) => ({ id: c.id, ids: c.studentIds.filter((id) => known.has(id) && k.ledger.accountId('player', id, 'chequing')) })).filter((c) => c.ids.length);
  const eligible = byClass.flatMap((c) => c.ids);
  if (!eligible.length) { k.db.prepare('UPDATE insurance_triggers SET processed_month = ? WHERE world_id = ? AND processed_month IS NULL').run(month, w.id); return; }

  // 1. Premiums, before bills' tick (config order).
  const prem = k.db.prepare('INSERT OR REPLACE INTO insurance_premiums (player_id, world_id, month, key, amount) VALUES (?, ?, ?, ?, ?)');
  k.forEachPlayer(eligible, (id) => {                                            // each student in its own savepoint
    const mine = held(k, id, w.id, month), lines = [];
    for (const p of POLICIES) {
      if (!mine.has(p.key) || p.billedBy === 'housing') continue;
      const cents = p.billedBy === 'bills' ? k.db.prepare('SELECT auto_cents FROM insurance_players WHERE player_id = ?').get(id).auto_cents : premium(k, w.id, p.premiumCents);
      prem.run(id, w.id, month, p.key, cents);
      if (p.billedBy === 'insurance') lines.push({ key: p.key, name: p.name, amount: cents, category: p.category });
    }
    if (lines.length) k.events.emit('costs', { playerId: id, month, lines });
  });

  // 2. Town events the world teacher asked for since the last tick, then the optional random draw.
  const count = k.db.prepare('UPDATE insurance_triggers SET processed_month = ?, applied = ?, skipped_recent = ?, skipped_cap = ? WHERE id = ?');
  for (const t of k.db.prepare('SELECT * FROM insurance_triggers WHERE world_id = ? AND processed_month IS NULL ORDER BY id').all(w.id)) {
    const ev = EVENTS.find((e) => e.key === t.event_key);
    const n = { applied: 0, recent: 0, cap: 0 };
    k.forEachPlayer(t.scope === 'town' ? eligible : (byClass.find((c) => c.id === t.class_id)?.ids ?? []), (id) => { n[applyEvent(k, w, month, id, ev, t.id)]++; });
    count.run(month, n.applied, n.recent, n.cap, t.id);
  }
  if (k.config.randomEvents === true) {
    const chance = ok(k.config.randomChancePct) ? k.config.randomChancePct : RANDOM_CHANCE_PCT;
    const secret = secretOf(k, w.id);
    k.forEachPlayer(eligible, (id) => { if (draw(secret, w.id, id, month, 1) < chance) applyEvent(k, w, month, id, EVENTS[draw(secret, w.id, id, month, 2) % EVENTS.length], null); });
  }
}


// Queue a town event for the next tick (the teacher's POST /trigger and the triggerEvent service). by: the teacher's player id, or null for a service call
// (stored as 0; nothing reads it). The service call announces `triggered` at once, inside the caller's transaction (like rates.queueRate's `pending`), the route after commit.
function queueTrigger(k, w, ev, scope, classId, by) {
  return k.db.txn((tx) => {
    const id = Number(k.db.prepare('INSERT INTO insurance_triggers (world_id, event_key, scope, class_id, created_month, by_player) VALUES (?, ?, ?, ?, ?, ?)').run(w.id, ev.key, scope, classId, w.month, by ?? 0).lastInsertRowid);
    k.audit('trigger', { id, event: ev.key, scope, classId }, by == null ? 'system' : `player:${by}`);
    const announce = () => k.events.emit('triggered', { id, event: ev.key, name: ev.name, scope, classId });
    if (by == null) announce(); else tx.onCommit(announce);
    return id;
  });
}

// What a student sees: policies (premium, deductible, held, pending change), the claim history and "what it would have cost uninsured".
function state(k, user) {
  const w = k.world.current(), month = w.month;
  const mine = held(k, user.id, w.id, month);
  const open = new Map(k.db.prepare('SELECT * FROM insurance_policies WHERE player_id = ? AND world_id = ? AND (end_month IS NULL OR end_month > ?)').all(user.id, w.id, month).map((r) => [r.key, r]));
  const p = playerRow(k, user.id);
  const auto = autoStart(p, w.id), condo = condoStart(p, w.id);
  const policies = POLICIES.map((d) => {
    const row = open.get(d.key);
    const start = d.key === 'auto' ? auto : d.key === 'condo' ? condo : row?.start_month ?? null;
    return {
      key: d.key, name: d.name, deductible_cents: d.deductibleCents, buyable: d.buyable, note: d.note, billed_by: d.billedBy,
      premium_cents: d.billedBy === 'bills' ? (p?.auto_cents || null) : premium(k, w.id, d.premiumCents),
      held: mine.has(d.key), claims_from_month: start === null ? null : start + 1, starts_next_month: start !== null && start > month && (d.buyable ? row.end_month === null : true), cancelling: !!row && row.end_month !== null,
      covers: EVENTS.filter((e) => e.covers.includes(d.key)).map((e) => e.name),
    };
  });
  const events = k.db.prepare('SELECT id, month, event_key, name, kind, amount, insured_by, deductible, claim_cents FROM insurance_events WHERE player_id = ? AND world_id = ? ORDER BY id DESC LIMIT 30').all(user.id, w.id)
    .map((e) => ({ ...e, net_cents: e.kind === 'windfall' ? -e.amount : e.amount - e.claim_cents }));
  const sum = (sql) => k.db.prepare(sql).get(user.id, w.id).n;
  const expenses = sum("SELECT COALESCE(SUM(amount), 0) AS n FROM insurance_events WHERE player_id = ? AND world_id = ? AND kind = 'expense'");
  const claims = sum('SELECT COALESCE(SUM(claim_cents), 0) AS n FROM insurance_events WHERE player_id = ? AND world_id = ?');
  const premiums = sum('SELECT COALESCE(SUM(amount), 0) AS n FROM insurance_premiums WHERE player_id = ? AND world_id = ?');
  return {
    month, policies, events,
    premium_history: k.db.prepare('SELECT month, key, amount FROM insurance_premiums WHERE player_id = ? AND world_id = ? ORDER BY month DESC, key LIMIT 24').all(user.id, w.id),
    // The comparison: the events' full cost with no insurance at all, against what insurance actually cost (premiums) plus what the events cost after claims.
    summary: { expenses_cents: expenses, claims_cents: claims, premiums_cents: premiums,
      uninsured_cost_cents: expenses, insured_cost_cents: expenses - claims + premiums },
    gap_months: gap(k),
  };
}

function buy(k, user, key) {
  const d = policyOf(key);
  if (!d?.buyable) throw new k.HttpError(400, 'That policy is not one you can buy: auto and condo cover come with the car and the condo');
  const w = k.world.current();
  return k.db.txn((tx) => {
    const row = k.db.prepare('SELECT * FROM insurance_policies WHERE player_id = ? AND world_id = ? AND key = ? ORDER BY id DESC LIMIT 1').get(user.id, w.id, key);
    if (row && row.end_month === null) throw new k.HttpError(409, `You already have ${d.name}`);
    if (row && row.end_month > w.month) k.db.prepare('UPDATE insurance_policies SET end_month = NULL WHERE id = ?').run(row.id);   // changed their mind before it ended
    else k.db.prepare('INSERT INTO insurance_policies (player_id, world_id, key, start_month) VALUES (?, ?, ?, ?)').run(user.id, w.id, key, w.month + 1);
    tx.onCommit(() => k.events.emit('changed', { classId: user.class_id }));
    return { ok: true, applies: 'next month' };
  });
}

function cancel(k, user, key) {
  const d = policyOf(key);
  if (!d?.buyable) throw new k.HttpError(400, 'That policy is not one you can cancel');
  const w = k.world.current();
  return k.db.txn((tx) => {
    const row = k.db.prepare('SELECT * FROM insurance_policies WHERE player_id = ? AND world_id = ? AND key = ? AND end_month IS NULL').get(user.id, w.id, key);
    if (!row) throw new k.HttpError(409, `You do not have ${d.name}`);
    if (row.start_month > w.month) k.db.prepare('DELETE FROM insurance_policies WHERE id = ?').run(row.id);   // never started: nothing was billed
    else k.db.prepare('UPDATE insurance_policies SET end_month = ? WHERE id = ?').run(w.month + 1, row.id);
    tx.onCommit(() => k.events.emit('changed', { classId: user.class_id }));
    return { ok: true, applies: 'next month' };
  });
}

export default defineModule({
  id: 'insurance',
  options: { eventAmounts: '{ <event key>: cents }', seasonCapCents: 'per-student cap per season, cents', minGapMonths: 'months between events', randomEvents: 'true turns random events on', randomChancePct: 'random event chance, percent' },
  requires: ['bank-basic'],

  migrations: [{ id: '001_insurance', sql: `
CREATE TABLE insurance_players (   -- what other modules told us about a student: auto_cents > 0 = chose the car (the premium bills charges); owner_world = the world they were last seen owning a home in
  player_id INTEGER PRIMARY KEY REFERENCES players(id), auto_cents INTEGER NOT NULL DEFAULT 0, owner_world INTEGER
);
CREATE TABLE insurance_known (player_id INTEGER NOT NULL REFERENCES players(id), world_id INTEGER NOT NULL, PRIMARY KEY (player_id, world_id));   -- billed students (bills announced them)
CREATE TABLE insurance_policies (
  id INTEGER PRIMARY KEY, player_id INTEGER NOT NULL REFERENCES players(id), world_id INTEGER NOT NULL, key TEXT NOT NULL,
  start_month INTEGER NOT NULL, end_month INTEGER                      -- covered in months m with start_month <= m < end_month (end NULL = until cancelled)
);
CREATE UNIQUE INDEX insurance_policies_open ON insurance_policies(player_id, world_id, key) WHERE end_month IS NULL;
CREATE TABLE insurance_premiums (player_id INTEGER NOT NULL REFERENCES players(id), world_id INTEGER NOT NULL, month INTEGER NOT NULL, key TEXT NOT NULL, amount INTEGER NOT NULL, PRIMARY KEY (player_id, world_id, month, key));
CREATE TABLE insurance_triggers (
  id INTEGER PRIMARY KEY, world_id INTEGER NOT NULL, event_key TEXT NOT NULL, scope TEXT NOT NULL CHECK (scope IN ('town','class')), class_id INTEGER,
  created_month INTEGER NOT NULL, by_player INTEGER NOT NULL, processed_month INTEGER,
  applied INTEGER NOT NULL DEFAULT 0, skipped_recent INTEGER NOT NULL DEFAULT 0, skipped_cap INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE insurance_events (
  id INTEGER PRIMARY KEY, world_id INTEGER NOT NULL, trigger_id INTEGER, player_id INTEGER NOT NULL REFERENCES players(id), month INTEGER NOT NULL,
  event_key TEXT NOT NULL, name TEXT NOT NULL, kind TEXT NOT NULL CHECK (kind IN ('expense','windfall')), amount INTEGER NOT NULL,
  insured_by TEXT, deductible INTEGER NOT NULL DEFAULT 0, claim_cents INTEGER NOT NULL DEFAULT 0, claim_txn INTEGER REFERENCES txns(id)
);
CREATE INDEX insurance_events_player ON insurance_events(player_id, world_id, month);` }, { id: '002_index', sql: `
-- the world price index from module.rates.changed (priceIndexBp), per world
CREATE TABLE insurance_index (world_id INTEGER PRIMARY KEY, index_bp INTEGER NOT NULL);` },
  { id: '003_secrets', sql: `CREATE TABLE insurance_secrets (world_id INTEGER PRIMARY KEY, secret TEXT NOT NULL)   -- the per-world random-event seed: never sent to a browser` },
  { id: '004_cover_start', sql: `
-- when automatic cover started: auto in auto_world from auto_start (the month after the switch to the car), condo from condo_start (the month after the purchase)
ALTER TABLE insurance_players ADD COLUMN auto_world INTEGER;
ALTER TABLE insurance_players ADD COLUMN auto_start INTEGER;
ALTER TABLE insurance_players ADD COLUMN condo_start INTEGER` },
  { id: '005_cover_backfill', sql: `
-- rows from before 004: a driver or an owner already had cover, so it counts from month 0 (in force); a driver's world is the latest one bills announced them in
UPDATE insurance_players SET auto_world = (SELECT MAX(world_id) FROM insurance_known k WHERE k.player_id = insurance_players.player_id), auto_start = 0 WHERE auto_cents > 0 AND auto_world IS NULL;
UPDATE insurance_players SET condo_start = 0 WHERE owner_world IS NOT NULL AND condo_start IS NULL` }],

  events: {
    // bills: a student's effective plans, at their first billed tick and whenever they change one.
    'module.bills.choices'(k, { playerId, options, autoPremiumCents }) {
      const w = k.world.current();
      if (!w || !ok(playerId)) return;
      const car = options?.transport === 'car' && ok(autoPremiumCents) && autoPremiumCents > 0 ? autoPremiumCents : 0;
      // bills announces a student first at their first billed tick (bills already charges the car's insurance that month), then after each plan change
      const first = !k.db.prepare('SELECT 1 FROM insurance_known WHERE player_id = ? AND world_id = ?').get(playerId, w.id);
      k.db.txn(() => {
        // a switch to the car starts cover next month; a car already chosen at the first billed tick, this month; still the car keeps the start; anything else ends it
        k.db.prepare(`INSERT INTO insurance_players (player_id, auto_cents, auto_world, auto_start) VALUES (?, ?, ?, ?) ON CONFLICT (player_id) DO UPDATE SET
          auto_start = CASE WHEN excluded.auto_cents = 0 THEN NULL WHEN insurance_players.auto_cents > 0 AND insurance_players.auto_world IS excluded.auto_world THEN insurance_players.auto_start ELSE excluded.auto_start END,
          auto_world = excluded.auto_world, auto_cents = excluded.auto_cents`).run(playerId, car, car ? w.id : null, car ? w.month + (first ? 0 : 1) : null);
        k.db.prepare('INSERT OR IGNORE INTO insurance_known (player_id, world_id) VALUES (?, ?)').run(playerId, w.id);
      });
    },
    // housing: a student who owns a home (value > 0) has condo cover from the month after they are first seen owning it here; selling announces 0.
    'module.housing.value'(k, { playerId, worldId, homeValue }) {
      const w = k.world.current();
      if (!w || !ok(playerId)) return;
      const wid = ok(worldId) ? worldId : w.id, owns = ok(homeValue) && homeValue > 0;
      k.db.prepare(`INSERT INTO insurance_players (player_id, owner_world, condo_start) VALUES (?, ?, ?) ON CONFLICT (player_id) DO UPDATE SET
        condo_start = CASE WHEN excluded.owner_world IS NULL THEN NULL WHEN insurance_players.owner_world IS excluded.owner_world THEN COALESCE(insurance_players.condo_start, 0) ELSE excluded.condo_start END,
        owner_world = excluded.owner_world`).run(playerId, owns ? wid : null, owns ? w.month + 1 : null);
    },
  },

  panels: [{ id: 'insurance', building: { key: 'insurance', name: 'Insurance', icon: ICON }, src: 'insurance.js' }],
  teacherPanels: [{ id: 'insurance-teach', title: 'Insurance and town events', src: 'teach.js' }],

  onTick: tick,

  // triggerEvent { event, scope: 'town' }: a town event queued for the next tick, as the teacher's POST /trigger does (the life module's scenarios, docs/phase6-roles.md 1.4;
  // k.modules.call only). Idempotent per (world, event, month): the same call again in a world month returns the trigger already queued (already: true).
  services: {
    triggerEvent(k, args) {
      const ev = EVENTS.find((e) => e.key === args?.event);
      if (!ev) throw new k.HttpError(400, `triggerEvent: event must be one of ${EVENTS.map((e) => e.key).join(', ')}`);
      if (args.scope !== 'town') throw new k.HttpError(400, "triggerEvent: scope must be 'town'");
      const w = k.world.active();
      const have = k.db.prepare("SELECT id FROM insurance_triggers WHERE world_id = ? AND event_key = ? AND scope = 'town' AND by_player = 0 AND created_month = ?").get(w.id, ev.key, w.month);
      if (have) return { id: have.id, event: ev.key, applies_from_month: w.month + 1, already: true };
      return { id: queueTrigger(k, w, ev, 'town', null, null), event: ev.key, applies_from_month: w.month + 1, already: false };
    },
  },

  // Bots: half of them (decided by a fixed hash of their id) buy tenant insurance in their first month.
  simulate(k, { students }) {
    const w = k.world.current();
    for (const s of students) {
      if (dice(s.id, 0, 7) >= 50 || k.db.prepare("SELECT 1 FROM insurance_policies WHERE player_id = ? AND world_id = ? AND key = 'tenant'").get(s.id, w.id)) continue;
      buy(k, s, 'tenant');   // the same path as POST /buy: cover from next month
    }
  },

  routes: [
    { method: 'GET', path: '/state', access: 'student', handler: (k, { user }) => state(k, user) },
    { method: 'POST', path: '/buy', access: 'student', handler: (k, { user, body }) => buy(k, user, k.input.str(body, 'policy', { max: 16 })) },
    { method: 'POST', path: '/cancel', access: 'student', handler: (k, { user, body }) => cancel(k, user, k.input.str(body, 'policy', { max: 16 })) },

    // ---- teacher ----
    {
      method: 'POST', path: '/trigger', access: 'teacher',
      handler(k, { user, body }) {
        k.policy.assert(user, 'world.settings');                              // the world teacher only
        const ev = EVENTS.find((e) => e.key === k.input.str(body, 'event', { max: 32 }));
        if (!ev) throw new k.HttpError(400, 'Pick an event from the list');
        const scope = k.input.str(body, 'scope', { max: 8 });
        if (scope !== 'town' && scope !== 'class') throw new k.HttpError(400, 'Scope is town or class');
        const classId = scope === 'class' ? k.input.int(body, 'class_id', { min: 1 }) : null;
        if (classId !== null && !k.players.classes().some((c) => c.id === classId)) throw new k.HttpError(404, 'Class not found');
        const w = k.world.active();   // 409 between seasons: a closed world never ticks again, so this would be lost
        queueTrigger(k, w, ev, scope, classId, user.id);
        return { ok: true, applies_from_month: w.month + 1 };
      },
    },
    {
      method: 'GET', path: '/overview', access: 'teacher',
      handler(k, { user }) {
        const w = k.world.current();
        const classes = k.players.classesFor(user);
        const students = new Map(classes.flatMap((c) => k.players.inClass(c.id).map((s) => [s.id, { username: s.username, class: c.name }])));
        const ids = JSON.stringify([...students.keys()]);
        const rows = k.db.prepare('SELECT * FROM insurance_events WHERE world_id = ? AND player_id IN (SELECT value FROM json_each(?)) ORDER BY id DESC LIMIT 200').all(w.id, ids);
        const events = rows.map((e) => ({ id: e.id, month: e.month, student: students.get(e.player_id).username, class: students.get(e.player_id).class, name: e.name, kind: e.kind, amount_cents: e.amount, insured_by: e.insured_by, insured_by_name: e.insured_by ? policyOf(e.insured_by).name : null, deductible_cents: e.deductible, claim_cents: e.claim_cents, net_cents: e.kind === 'windfall' ? -e.amount : e.amount - e.claim_cents }));
        const t = k.db.prepare(`SELECT COALESCE(SUM(CASE WHEN kind = 'expense' THEN amount END), 0) AS expenses, COALESCE(SUM(claim_cents), 0) AS claims,
          COALESCE(SUM(CASE WHEN kind = 'windfall' THEN amount END), 0) AS windfalls, COUNT(CASE WHEN kind = 'expense' AND insured_by IS NOT NULL THEN 1 END) AS insured,
          COUNT(CASE WHEN kind = 'expense' AND insured_by IS NULL THEN 1 END) AS uninsured FROM insurance_events WHERE world_id = ? AND player_id IN (SELECT value FROM json_each(?))`).get(w.id, ids);
        const holders = Object.fromEntries(['tenant', 'phone'].map((key) => [key, k.db.prepare('SELECT COUNT(DISTINCT player_id) AS n FROM insurance_policies WHERE world_id = ? AND key = ? AND end_month IS NULL AND player_id IN (SELECT value FROM json_each(?))').get(w.id, key, ids).n]));
        return {
          month: w.month, can_trigger: k.policy.can(user, 'world.settings'), students: students.size,
          classes: classes.map((c) => ({ id: c.id, name: c.name })),
          catalogue: EVENTS.map((e) => ({ key: e.key, name: e.name, amount_cents: amountOf(k, e), kind: e.kind, covered_by: e.covers.map((c) => policyOf(c).name) })),
          caps: { gap_months: gap(k), season_cap_cents: seasonCap(k), random: k.config.randomEvents === true },
          triggers: k.db.prepare('SELECT * FROM insurance_triggers WHERE world_id = ? ORDER BY id DESC LIMIT 10').all(w.id).map((r) => ({
            id: r.id, name: EVENTS.find((e) => e.key === r.event_key)?.name ?? r.event_key, scope: r.scope, class: classes.find((c) => c.id === r.class_id)?.name ?? null,
            created_month: r.created_month, processed_month: r.processed_month, applied: r.applied, skipped_recent: r.skipped_recent, skipped_cap: r.skipped_cap })),
          totals: { expenses_cents: t.expenses, claims_cents: t.claims, windfalls_cents: t.windfalls, insured_events: t.insured, uninsured_events: t.uninsured, holders },
          events,
        };
      },
    },
  ],
});
