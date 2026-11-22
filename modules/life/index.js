// life: age, stages, the stage-paced clock, retirement, stage events and the Life Review snapshots (docs/phase5-life.md 5b).
// Every student in a world shares its month, so age is a function of it (stages.js). The pace plan is per world (life_pace): when an advance
// crosses a segment boundary, life sets the world's months per class day (k.world.setPace, the one power this module declares); when it crosses
// the end of the plan (age 70) it switches auto-advance to manual once. Work stops at the retirement age: the payday at that age (module.jobs.paid)
// is the last, then jobs.endHolding ends the job. Stage events call other modules' services through callIf, which skips (and logs once) what is not
// there. Snapshots of net worth (savings' figure, the one leaderboards and season close use) are taken at 25, 35, 55, 65 and 70.
// All state is keyed by world_id, so nothing carries into the next season. Per-student work in a tick is inside k.forEachPlayer (snapshots);
// a student's own row (life_state) exists only once they (or a bot) set a retirement age; without one the default (65) applies.
import fs from 'node:fs';
import { defineModule } from '../../lib/modules.js';
// Constants files only (no module code): the bounds below are the services' own, so a scenario row can never be one a service would refuse and jam the tick.
import { MAX_POLICY_BP, MAX_INFLATION_BP } from '../rates/constants.js';
import { MARKET_EVENT_MIN_PCT, MARKET_EVENT_MAX_PCT } from '../housing/constants.js';
import { STOCKS } from '../exchange/constants.js';
import { EVENTS as TOWN_EVENTS } from '../insurance/constants.js';
import {
  START_AGE, END_AGE, RETIRE_MIN, RETIRE_MAX, RETIRE_DEFAULT, SNAPSHOT_AGES, STAGES, DEFAULT_PLAN,
  ageAt, stageOf, stageNo, monthOfAge, endMonth, checkPlan, segmentAt, crossed, paceTable,
} from './stages.js';

const ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 3h12M6 21h12M7 3c0 6 10 8 10 18M17 3c0 6-10 8-10 18"/></svg>';   // an hourglass
// kind -> [module, service]. The market kinds all go to exchange.stageEvent ({ kind, ticker?, headline }); scandal and boom hit one town company, so they need its ticker.
const MARKET = new Set(['crash', 'correction', 'rally', 'scandal', 'boom']);
const KINDS = {
  crash: ['exchange', 'stageEvent'], correction: ['exchange', 'stageEvent'], rally: ['exchange', 'stageEvent'], scandal: ['exchange', 'stageEvent'], boom: ['exchange', 'stageEvent'],
  rate: ['rates', 'queueRate'], housing: ['housing', 'marketEvent'], inflation: ['rates', 'setInflation'], insurance: ['insurance', 'triggerEvent'],
};
// The scenario picker's list (scenarios.json: [{ id, name, blurb, events: [{ offset, kind, args, headline }] }]), read once; checked by checkEvent when applied.
export const SCENARIOS = Object.freeze(JSON.parse(fs.readFileSync(new URL('./scenarios.json', import.meta.url), 'utf8')));
// The defaults: a rate shock at 42, a housing shock at 46, a market crash at 50 (the Phase 3 crash row, lived).
export const DEFAULT_EVENTS = Object.freeze([
  { month: 241, kind: 'rate', rate_bp: 600, headline: 'Rate shock: the Bank of DAA raises its policy rate to 6%' },
  { month: 289, kind: 'housing', pct: -15, headline: 'Housing shock: home prices in town fall 15%' },
  { month: 337, kind: 'crash', headline: 'Market crash: stocks and funds fall sharply' },
]);

const startAge = (k) => (Number.isSafeInteger(k.config.startAge) && k.config.startAge >= 16 && k.config.startAge <= 59 ? k.config.startAge : START_AGE);
const said = new Set();
const once = (k, key, msg) => { if (!said.has(key)) { said.add(key); k.log.warn(msg); } };

// Another module's service if it is there: { ok: true, value } or { ok: false } (module not loaded, or no such service: logged once).
// Any other error is the service's own and reaches the caller.
export function callIf(k, module, service, args) {
  if (k.modules.has(module)) {
    try { return { ok: true, value: k.modules.call(module, service, args) }; } catch (e) {
      if (!String(e?.message ?? '').includes(`has no service "${service}"`)) throw e;
    }
  }
  once(k, `${module}.${service}`, `${module}.${service} is not available; skipped`);
  return { ok: false };
}

function configPlan(k) {
  if (k.config.plan === undefined) return DEFAULT_PLAN.map((s) => ({ ...s }));
  try { return checkPlan(k.config.plan, startAge(k)); } catch (e) { once(k, 'plan', `options.life.plan: ${e.message}; using the default plan`); return DEFAULT_PLAN.map((s) => ({ ...s })); }
}
// One stage event, checked: { month, kind, headline, rate_bp (rate), pct (housing), inflation_bp (inflation), event (insurance), ticker (scandal, boom) }
// -> { month, kind, headline, args }. Throws Error(message). Every bound is the service's own (imported from its constants), checked at config / scenario time.
export function checkEvent(e, end) {
  if (!e || typeof e !== 'object' || Array.isArray(e)) throw new Error('an event is { month, kind, headline, ... }');
  if (!Number.isSafeInteger(e.month) || e.month < 2 || e.month >= end) throw new Error(`month must be 2 to ${end - 1}`);
  if (!Object.hasOwn(KINDS, e.kind)) throw new Error(`kind must be one of ${Object.keys(KINDS).join(', ')}`);
  // exchange.stageEvent turns control characters into spaces and then refuses an empty headline, so one made of them would fail the tick
  if (typeof e.headline !== 'string' || !e.headline.trim() || e.headline.length > 120 || /[\u0000-\u001f\u007f]/.test(e.headline)) throw new Error('headline must be 1-120 characters, no control characters');
  const out = { month: e.month, kind: e.kind, headline: e.headline.trim(), args: {} };
  if (e.kind === 'rate') {
    if (!Number.isSafeInteger(e.rate_bp) || e.rate_bp < 0 || e.rate_bp > MAX_POLICY_BP) throw new Error(`a rate event needs rate_bp 0-${MAX_POLICY_BP}`);
    out.args = { rate_bp: e.rate_bp };
  } else if (e.kind === 'housing') {
    if (!Number.isSafeInteger(e.pct) || Math.abs(e.pct) < MARKET_EVENT_MIN_PCT || Math.abs(e.pct) > MARKET_EVENT_MAX_PCT) throw new Error(`a housing event needs pct ${MARKET_EVENT_MIN_PCT}..${MARKET_EVENT_MAX_PCT} or -${MARKET_EVENT_MAX_PCT}..-${MARKET_EVENT_MIN_PCT}`);
    out.args = { pct: e.pct };
  } else if (e.kind === 'inflation') {
    if (!Number.isSafeInteger(e.inflation_bp) || e.inflation_bp < 0 || e.inflation_bp > MAX_INFLATION_BP) throw new Error(`an inflation event needs inflation_bp 0-${MAX_INFLATION_BP}`);
    out.args = { inflation_bp: e.inflation_bp };
  } else if (e.kind === 'insurance') {
    if (!TOWN_EVENTS.some((t) => t.key === e.event)) throw new Error(`an insurance event needs event: ${TOWN_EVENTS.map((t) => t.key).join(', ')}`);
    out.args = { event: e.event, scope: 'town' };
  } else if (e.kind === 'scandal' || e.kind === 'boom') {
    // a town company only (exchange also takes listed businesses, which cannot be known when a plan is written)
    if (!STOCKS.some((t) => t.ticker === e.ticker)) throw new Error(`a ${e.kind} needs ticker: ${STOCKS.map((t) => t.ticker).join(', ')}`);
    out.args = { ticker: e.ticker };
  }
  return out;
}
function configEvents(k) {
  const list = Array.isArray(k.config.events) ? k.config.events : DEFAULT_EVENTS;
  return list.flatMap((e, i) => { try { return [checkEvent(e, endMonth(startAge(k)))]; } catch (err) { once(k, `event${i}`, `options.life.events[${i}]: ${err.message}; skipped`); return []; } });
}

// Scenarios (scenarios.json) are checked once at load by the same checkEvent the config events pass, so a bad file fails boot, not a teacher's click.
for (const sc of SCENARIOS) {
  if (!/^[a-z0-9-]{1,32}$/.test(sc.id ?? '') || typeof sc.name !== 'string' || typeof sc.blurb !== 'string' || !Array.isArray(sc.events)) throw new Error(`module "life": scenarios.json: scenario ${JSON.stringify(sc.id)} needs id, name, blurb, events`);
  for (const ev of sc.events) {
    if (!Number.isSafeInteger(ev.offset) || ev.offset < 1) throw new Error(`module "life": scenarios.json: ${sc.id}: offset must be a whole number of months, at least 1`);
    try { checkEvent({ month: 100 + ev.offset, kind: ev.kind, headline: ev.headline, ...ev.args }, endMonth(START_AGE)); } catch (e) { throw new Error(`module "life": scenarios.json: ${sc.id}: ${e.message}`); }
  }
}
// Replace the world's unfired stage events with a scenario's, offsets counted from `fromMonth`. Fired rows stay as history. A row whose month falls before 2 or at the end
// of the life is skipped. Returns { removed, inserted, skipped }.
function applyScenario(k, w, sc, fromMonth) {
  const end = endMonth(startAge(k));
  const rows = [];
  let skipped = 0;
  for (const ev of sc.events) {
    const month = fromMonth + ev.offset;
    if (month < 2 || month >= end) { skipped++; continue; }
    rows.push(checkEvent({ month, kind: ev.kind, headline: ev.headline, ...ev.args }, end));
  }
  return k.db.txn(() => {
    let id = k.db.prepare('SELECT COALESCE(MAX(id), 0) AS id FROM life_events WHERE world_id = ?').get(w.id).id;   // before the delete: an id is never reused
    const removed = Number(k.db.prepare('DELETE FROM life_events WHERE world_id = ? AND fired_month IS NULL').run(w.id).changes);
    const ins = k.db.prepare('INSERT INTO life_events (world_id, id, month, kind, args, headline) VALUES (?, ?, ?, ?, ?, ?)');
    for (const r of rows) ins.run(w.id, ++id, r.month, r.kind, JSON.stringify(r.args), r.headline);
    return { removed, inserted: rows.length, skipped };
  });
}

// The world's plan and events, written the first time life sees the world. An event already in the past then is marked as such, never fired late.
function ensureWorld(k, w) {
  const get = () => k.db.prepare('SELECT * FROM life_pace WHERE world_id = ?').get(w.id);
  const row = get();
  if (row) return row;
  k.db.txn(() => {
    k.db.prepare('INSERT OR IGNORE INTO life_pace (world_id, plan, locked) VALUES (?, ?, 0)').run(w.id, JSON.stringify(configPlan(k)));
    const ins = k.db.prepare('INSERT OR IGNORE INTO life_events (world_id, id, month, kind, args, headline, fired_month, result) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
    configEvents(k).forEach((e, i) => ins.run(w.id, i + 1, e.month, e.kind, JSON.stringify(e.args), e.headline, e.month <= w.month ? w.month : null, e.month <= w.month ? 'already past when life began' : null));
  });
  return get();
}

// After an advance from -> month (or a new world, from 0): only when a plan boundary was crossed, set the pace of the segment the world is in now
// (unless the teacher locked the pace, or it already is that); when the end of the plan was crossed, stop auto-advance once.
function applyPace(k, w, from, month) {
  const row = ensureWorld(k, w);
  const plan = JSON.parse(row.plan);
  const end = endMonth(startAge(k));
  if (!row.locked && month < end && crossed(from, month, plan.map((s) => s.from_month)).length) {
    const pace = segmentAt(plan, month).months_per_day;
    if (w.months_per_day !== pace) k.world.setPace({ months_per_day: pace });
  }
  // The last class day must land on `end`: a manual odd advance (24 -> 25 -> 26) shifts the world off its segment grid, and a full step past `end` is refused
  // by onTick (the whole advance rolls back and auto-advance stops at 566 with no way on but a hand-sized advance). Shorten that one day to the gap instead,
  // locked or not: it is always 1..11 months, so a valid pace.
  const pace = k.world.current().months_per_day;
  if (month < end && month + pace > end) k.world.setPace({ months_per_day: end - month });
  if (crossed(from, month, [end]).length && k.world.current().auto_advance !== 'manual') k.world.setPace({ auto_advance: 'manual' });
}

const retireRow = (k, playerId, worldId) => k.db.prepare('SELECT retire_age FROM life_state WHERE player_id = ? AND world_id = ?').get(playerId, worldId);
const retireAgeOf = (k, playerId, worldId) => retireRow(k, playerId, worldId)?.retire_age ?? RETIRE_DEFAULT;
const retireNote = (ra) => `You reached your retirement age (${ra}): this is your last pay. Work stops here.`;

// The student's choice, checked: 60-70, from Stage B, not below their age now, and only until they reach the age already chosen.
function setRetire(k, w, playerId, retireAge) {
  const age = ageAt(w.month, startAge(k));
  if (!Number.isSafeInteger(retireAge) || retireAge < RETIRE_MIN || retireAge > RETIRE_MAX) throw new k.HttpError(400, `Pick a retirement age from ${RETIRE_MIN} to ${RETIRE_MAX}`);
  if (stageOf(age) === 'A') throw new k.HttpError(409, 'You can plan your retirement from Stage B (age 36)');
  const now = retireAgeOf(k, playerId, w.id);
  if (age >= now) throw new k.HttpError(409, `You reached your retirement age (${now}), so it can no longer change`);
  if (retireAge < age) throw new k.HttpError(400, `Pick an age of at least ${age} (your age now)`);
  k.db.prepare('INSERT INTO life_state (player_id, world_id, retire_age) VALUES (?, ?, ?) ON CONFLICT (player_id, world_id) DO UPDATE SET retire_age = excluded.retire_age').run(playerId, w.id, retireAge);
  return retireAge;
}

// Net worth the way leaderboards and season close count it: savings' figure (ledger balances + the home and holdings values), else the ledger alone.
const netWorth = (k, playerId) => (k.modules.has('savings') ? k.modules.call('savings', 'todayFacts', { playerId }).netWorthCents
  : k.ledger.accountsOf('player', playerId).reduce((t, a) => t + a.balance_cents, 0));

// The snapshot for the age window this month is in (25-34 -> 25, ..., 70): for every student who has none yet, once.
function snapshot(k, world, month, age, classes) {
  const i = SNAPSHOT_AGES.findLastIndex((a) => age >= a);
  if (i < 0) return;
  const target = SNAPSHOT_AGES[i];
  const have = new Set(k.db.prepare('SELECT player_id FROM life_snapshots WHERE world_id = ? AND age = ?').all(world.id, target).map((r) => r.player_id));
  const ins = k.db.prepare('INSERT OR IGNORE INTO life_snapshots (player_id, world_id, age, month, net_worth_cents, allocation) VALUES (?, ?, ?, ?, ?, ?)');
  k.forEachPlayer(classes.flatMap((c) => c.studentIds).filter((id) => !have.has(id)), (id) => {
    const a = callIf(k, 'exchange', 'allocation', { playerId: id });
    ins.run(id, world.id, target, month, netWorth(k, id), JSON.stringify(a.ok && a.value && typeof a.value === 'object' && !Array.isArray(a.value) ? a.value : {}));
  });
}

// Stage events due by this month (fired once; a skipped one never fires). A service that throws fails the advance (a module-wide step):
// the teacher can skip the event in the console and advance again.
function fireEvents(k, world, month) {
  for (const e of k.db.prepare('SELECT * FROM life_events WHERE world_id = ? AND fired_month IS NULL AND skip = 0 AND month <= ? ORDER BY month, id').all(world.id, month)) {
    const [mod, svc] = KINDS[e.kind];
    const args = JSON.parse(e.args);
    const r = callIf(k, mod, svc, MARKET.has(e.kind) ? { kind: e.kind, headline: e.headline, ...args } : args);
    k.db.prepare('UPDATE life_events SET fired_month = ?, result = ? WHERE world_id = ? AND id = ?').run(month, r.ok ? 'done' : `${mod}.${svc} not available`, world.id, e.id);
  }
}

const snapshotsOf = (k, playerId, worldId) => k.db.prepare('SELECT age, month, net_worth_cents, allocation FROM life_snapshots WHERE player_id = ? AND world_id = ? ORDER BY age').all(playerId, worldId)
  .map((r) => ({ age: r.age, stage: stageOf(r.age), month: r.month, net_worth_cents: r.net_worth_cents, allocation: JSON.parse(r.allocation) }));

// What the Life panel shows.
function view(k, w, user) {
  const sa = startAge(k), end = endMonth(sa), age = ageAt(w.month, sa), stage = stageOf(age);
  const ra = retireAgeOf(k, user.id, w.id);
  return {
    month: w.month, age, stage, start_age: sa, end_month: end, review_ready: w.month >= end,
    stages: STAGES.map((s) => ({ ...s, from_age: Math.max(s.from_age, sa), from_month: Math.max(1, monthOfAge(s.from_age, sa)), to_month: monthOfAge(s.to_age + 1, sa) - 1 })).filter((s) => s.to_month >= s.from_month),
    retire: { age: ra, set: !!retireRow(k, user.id, w.id), min: Math.max(RETIRE_MIN, age), max: RETIRE_MAX, default: RETIRE_DEFAULT, open: stage !== 'A', reached: age >= ra, can_change: stage !== 'A' && age < ra },
    snapshots: snapshotsOf(k, user.id, w.id).map(({ allocation, ...s }) => s),
    events: k.db.prepare("SELECT month, headline FROM life_events WHERE world_id = ? AND result = 'done' ORDER BY fired_month, id").all(w.id).map((e) => ({ month: e.month, age: ageAt(e.month, sa), headline: e.headline })),
    stage_costs: stageCosts(k, user.id),
  };
}
// Bills' stage cost lines (docs/stagecosts.md) for the panel: every line at today's prices, the student's own choices and whether they own their home. null without bills.
function stageCosts(k, playerId) {
  const r = callIf(k, 'bills', 'stageCosts', { playerId });
  if (!r.ok) return null;
  const { lines, choices = {}, owner = false } = r.value;
  return { lines: lines.map(({ source_note, ...l }) => l), choices, owner };
}

export default defineModule({
  id: 'life',
  requires: ['bank-basic'],
  needs: ['world.setPace'],
  options: { startAge: `age at world month 1 (default ${START_AGE})`, plan: 'the pace plan [{ from_month, months_per_day }] (default in stages.js)', events: 'stage events [{ month, kind: crash | correction | rally | scandal | boom | rate | housing | inflation | insurance, headline, rate_bp?, pct?, inflation_bp?, event?, ticker? }]' },

  migrations: [{ id: '001_life', sql: `
CREATE TABLE life_pace (world_id INTEGER PRIMARY KEY REFERENCES worlds(id), plan TEXT NOT NULL, locked INTEGER NOT NULL DEFAULT 0);   -- plan JSON [{ from_month, months_per_day }]
CREATE TABLE life_state (          -- a row once a retirement age is chosen; cpp/oas start ages are for wave 5c
  player_id INTEGER NOT NULL REFERENCES players(id), world_id INTEGER NOT NULL REFERENCES worlds(id),
  retire_age INTEGER CHECK (retire_age BETWEEN ${RETIRE_MIN} AND ${RETIRE_MAX}), cpp_start_age INTEGER, oas_start_age INTEGER, PRIMARY KEY (player_id, world_id)
);
CREATE TABLE life_snapshots (      -- net worth (and allocation JSON, when the exchange gives one) at ages 25, 35, 55, 65 and 70
  player_id INTEGER NOT NULL REFERENCES players(id), world_id INTEGER NOT NULL REFERENCES worlds(id), age INTEGER NOT NULL, month INTEGER NOT NULL,
  net_worth_cents INTEGER NOT NULL, allocation TEXT NOT NULL DEFAULT '{}', PRIMARY KEY (player_id, world_id, age)
);
CREATE TABLE life_events (         -- the world's stage events (from options.life.events or the defaults); the teacher moves or skips them
  world_id INTEGER NOT NULL REFERENCES worlds(id), id INTEGER NOT NULL, month INTEGER NOT NULL, kind TEXT NOT NULL, args TEXT NOT NULL, headline TEXT NOT NULL,
  skip INTEGER NOT NULL DEFAULT 0, fired_month INTEGER, result TEXT, PRIMARY KEY (world_id, id)
)` }],

  events: {
    // after commit (core events): the pace for the new month, or month 1's at a new world
    'world.created': (k, { worldId }) => { const w = k.world.current(); if (w?.id === worldId && w.status === 'active') applyPace(k, w, 0, w.month); },
    'world.month': (k, { from, month, worldId }) => { const w = k.world.current(); if (w?.id === worldId && w.status === 'active') applyPace(k, w, from, month); },
    // Inside the payday's savepoint: the first payday at the retirement age is the last one.
    'module.jobs.paid': (k, p) => {
      const sa = startAge(k);
      if (!Number.isSafeInteger(p?.month) || !Number.isSafeInteger(p.playerId) || ageAt(p.month, sa) < RETIRE_MIN) return;
      const ra = retireAgeOf(k, p.playerId, Number.isSafeInteger(p.worldId) ? p.worldId : k.world.current().id);
      if (ageAt(p.month, sa) >= ra) k.modules.call('jobs', 'endHolding', { playerId: p.playerId, reason: retireNote(ra) });
    },
  },

  onTick(k, { month, world, classes }) {
    const sa = startAge(k), end = endMonth(sa);
    // ponytail: refusing the tick is the simplest stop past age 70; it reads as a 500 naming life in the console, a 409 would need a core hook.
    if (month > end) throw new k.HttpError(409, `The life ended at age ${END_AGE} (month ${end}). Close the season for the Life Review, then start the next one.`);
    ensureWorld(k, world);
    const age = ageAt(month, sa);
    if (month > 1 && stageOf(age) !== stageOf(ageAt(month - 1, sa))) k.events.emit('stage', { worldId: world.id, month, age, stage: stageOf(age) });
    fireEvents(k, world, month);
    snapshot(k, world, month, age, classes);
  },

  // Header chips: "Age 31 · Stage A", and "Life Review ready" once the life is over.
  badges(k) {
    const w = k.world.current();
    if (w?.status !== 'active') return [];
    const sa = startAge(k), age = ageAt(w.month, sa);
    return [{ text: `Age ${age} · Stage ${stageOf(age)}`, title: 'Your age and life stage: everyone in town shares the world month.' },
      ...(w.month >= endMonth(sa) ? [{ text: 'Life Review ready', title: 'Your life is complete. Your teacher closes the season for the Life Review.' }] : [])];
  },

  services: {
    // The Today card's facts: stage 1/2/3, age, whether a retirement age is chosen, and the years until it.
    todayFacts(k, { playerId }) {
      const w = k.world.current();
      const age = ageAt(w.month, startAge(k)), ra = retireAgeOf(k, playerId, w.id);
      return { stage: stageNo(stageOf(age)), age, retireSet: !!retireRow(k, playerId, w.id), yearsToRetire: Math.max(0, ra - age) };
    },
    // For the Life Review (leaderboards): [{ age, stage, net_worth_cents, allocation }] in the current world, by age.
    snapshots: (k, { playerId, worldId }) => snapshotsOf(k, playerId, worldId ?? k.world.current()?.id ?? -1).map(({ month, ...s }) => s),
    // Where the world is in the life (everyone shares it): { month, age, stage } (retirement, 5c, reads its ages here).
    age(k) { const w = k.world.current(); const age = ageAt(w?.month ?? 1, startAge(k)); return { month: w?.month ?? 1, age, stage: stageOf(age) }; },
    // Whether work has stopped for this student (for a jobs check on picking a job after retirement).
    retired(k, { playerId }) {
      const w = k.world.current();
      const age = ageAt(w.month, startAge(k)), ra = retireAgeOf(k, playerId, w.id);
      return { retired: age >= ra, age, retire_age: ra };
    },
  },

  panels: [{ id: 'life', building: { key: 'life', name: 'Life', icon: ICON }, src: 'life.js' }],
  teacherPanels: [{ id: 'life-teach', title: 'Life', src: 'teach.js' }],

  // Bots: a retirement age from 60 to 70 (a deterministic spread) when they reach Stage B; after it, the job jobs' bots take again is ended
  // before the advance, so a retired bot is never paid.
  simulate(k, { month, students }) {
    const w = k.world.current();
    if (w?.status !== 'active') return;
    const age = ageAt(month, startAge(k));
    if (stageOf(age) === 'A') return;
    k.db.txn(() => {
      const set = new Set(k.db.prepare('SELECT player_id FROM life_state WHERE world_id = ? AND retire_age IS NOT NULL').all(w.id).map((r) => r.player_id));
      for (const s of students) {
        const ra = RETIRE_MIN + (k.dice(s.id, 0, 11) % (RETIRE_MAX - RETIRE_MIN + 1));
        if (!set.has(s.id) && ra > age) setRetire(k, w, s.id, ra);
      }
      if (age < RETIRE_MIN || !k.modules.has('jobs')) return;
      for (const s of students) {
        const ra = retireAgeOf(k, s.id, w.id);
        if (age >= ra) k.modules.call('jobs', 'endHolding', { playerId: s.id, reason: retireNote(ra) });
      }
    });
  },

  routes: [
    { method: 'GET', path: '/state', access: 'student', handler: (k, { user }) => view(k, k.world.active(), user) },
    {
      method: 'POST', path: '/retire', access: 'student',
      handler(k, { user, body }) {
        const w = k.world.active();
        const retireAge = k.input.int(body, 'retire_age', { min: RETIRE_MIN, max: RETIRE_MAX });
        k.db.txn(() => { setRetire(k, w, user.id, retireAge); k.audit('retire', { retire_age: retireAge }, `player:${user.id}`); });
        return view(k, w, user);
      },
    },

    // ---- teacher ----
    {
      method: 'GET', path: '/teach', access: 'teacher',
      handler(k, { user, url }) {
        const w = k.world.current();
        if (!w) return { world: null, classes: [] };
        const raw = url?.searchParams?.get('days');
        const daysLeft = raw === null || raw === undefined || raw === '' ? undefined : Number(raw);
        if (daysLeft !== undefined && (!Number.isSafeInteger(daysLeft) || daysLeft < 0 || daysLeft > 1000)) throw new k.HttpError(400, 'days must be a whole number from 0 to 1000');
        const row = ensureWorld(k, w);
        const sa = startAge(k), age = ageAt(w.month, sa), plan = JSON.parse(row.plan);
        const mine = k.players.classesFor(user);
        const rows = k.db.prepare(`SELECT p.id, p.username, p.class_id, s.retire_age FROM players p LEFT JOIN life_state s ON s.player_id = p.id AND s.world_id = ?
          WHERE p.role = 'student' AND p.class_id IN (SELECT value FROM json_each(?)) ORDER BY p.class_id, p.username`).all(w.id, JSON.stringify(mine.map((c) => c.id)));
        return {
          world: { month: w.month, months_per_day: w.months_per_day, auto_advance: w.auto_advance, season_end: w.season_end, status: w.status },
          age, stage: stageOf(age), start_age: sa, end_month: endMonth(sa), plan, locked: !!row.locked, can_edit: k.policy.can(user, 'world.settings'),
          calc: paceTable(plan, { startAge: sa, month: w.month, currentPace: w.months_per_day, locked: !!row.locked, daysLeft }),
          scenarios: SCENARIOS,
          stage_costs: stageCosts(k)?.lines ?? [],
          events: k.db.prepare('SELECT id, month, kind, args, headline, skip, fired_month, result FROM life_events WHERE world_id = ? ORDER BY month, id').all(w.id)
            .map((e) => ({ id: e.id, month: e.month, age: ageAt(e.month, sa), kind: e.kind, args: JSON.parse(e.args), headline: e.headline, skip: !!e.skip, fired_month: e.fired_month, result: e.result })),
          classes: mine.map((c) => ({ id: c.id, name: c.name, students: rows.filter((r) => r.class_id === c.id).map((r) => ({ id: r.id, username: r.username, retire_age: r.retire_age ?? RETIRE_DEFAULT, set: r.retire_age !== null, retired: age >= (r.retire_age ?? RETIRE_DEFAULT) })) })),
        };
      },
    },
    {
      method: 'POST', path: '/plan', access: 'teacher',
      handler(k, { user, body }) {
        k.policy.assert(user, 'world.settings');
        const w = k.world.active();
        let plan;
        try { plan = checkPlan(Object.hasOwn(body, 'plan') ? body.plan : undefined, startAge(k)); } catch (e) { throw new k.HttpError(400, e.message); }
        ensureWorld(k, w);
        k.db.txn((tx) => {
          k.db.prepare('UPDATE life_pace SET plan = ? WHERE world_id = ?').run(JSON.stringify(plan), w.id);
          k.audit('plan', { worldId: w.id, plan }, `player:${user.id}`);
          tx.onCommit(() => k.events.emit('changed', { classId: null }));
        });
        return { ok: true, plan, applies: 'at the next segment boundary' };
      },
    },
    {
      method: 'POST', path: '/lock', access: 'teacher',
      handler(k, { user, body }) {
        k.policy.assert(user, 'world.settings');
        const w = k.world.active();
        const locked = k.input.bool(body, 'locked');
        ensureWorld(k, w);
        k.db.txn((tx) => {
          k.db.prepare('UPDATE life_pace SET locked = ? WHERE world_id = ?').run(locked ? 1 : 0, w.id);
          k.audit('lock', { worldId: w.id, locked }, `player:${user.id}`);
          tx.onCommit(() => k.events.emit('changed', { classId: null }));
        });
        return { ok: true, locked };
      },
    },
    {
      // Pick a scenario: its events replace every stage event that has not fired yet (fired ones stay), counted from `from_month` (default: this month).
      method: 'POST', path: '/scenario', access: 'teacher',
      handler(k, { user, body }) {
        k.policy.assert(user, 'world.settings');
        const w = k.world.active();
        ensureWorld(k, w);
        const sc = SCENARIOS.find((x) => x.id === k.input.str(body, 'id', { max: 32 }));
        if (!sc) throw new k.HttpError(404, 'No such scenario');
        const from = k.input.int(body, 'from_month', { min: w.month, max: endMonth(startAge(k)) - 1, optional: true }) ?? w.month;
        const r = k.db.txn((tx) => {
          const out = applyScenario(k, w, sc, from);
          k.audit('scenario', { worldId: w.id, id: sc.id, from_month: from, ...out }, `player:${user.id}`);
          tx.onCommit(() => k.events.emit('changed', { classId: null }));
          return out;
        });
        return { ok: true, scenario: sc.id, from_month: from, ...r };
      },
    },
    {
      // Skip or un-skip a stage event, or move it to a later month. Only before it fires.
      method: 'POST', path: '/event', access: 'teacher',
      handler(k, { user, body }) {
        k.policy.assert(user, 'world.settings');
        const w = k.world.active();
        ensureWorld(k, w);
        const id = k.input.int(body, 'id', { min: 1 });
        const end = endMonth(startAge(k));
        const skip = Object.hasOwn(body, 'skip') ? k.input.bool(body, 'skip') : undefined;
        const month = k.input.int(body, 'month', { min: w.month + 1, max: end - 1, optional: true });
        if (skip === undefined && month === undefined) throw new k.HttpError(400, 'Send skip and/or month');
        const e = k.db.prepare('SELECT * FROM life_events WHERE world_id = ? AND id = ?').get(w.id, id);
        if (!e) throw new k.HttpError(404, 'No such stage event');
        if (e.fired_month !== null) throw new k.HttpError(409, 'That event already happened');
        k.db.txn((tx) => {
          k.db.prepare('UPDATE life_events SET skip = COALESCE(?, skip), month = COALESCE(?, month) WHERE world_id = ? AND id = ?').run(skip === undefined ? null : skip ? 1 : 0, month ?? null, w.id, id);
          k.audit('event', { worldId: w.id, id, ...(skip !== undefined && { skip }), ...(month !== undefined && { month }) }, `player:${user.id}`);
          tx.onCommit(() => k.events.emit('changed', { classId: null }));
        });
        return { ok: true };
      },
    },
  ],
});
