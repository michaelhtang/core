// today: the errand catalogue (validated at boot), the pure selection of three, and the small reads (day, state, caps, facts) every other file builds on.
import { createHmac, randomBytes } from 'node:crypto';
import ERRANDS from './errands.json' with { type: 'json' };

const OPS = { '==': (a, b) => a === b, '!=': (a, b) => a !== b, '<': (a, b) => a < b, '<=': (a, b) => a <= b, '>': (a, b) => a > b, '>=': (a, b) => a >= b };
const FACT_MODULES = ['jobs', 'savings', 'credit', 'exchange', 'housing', 'life', 'retirement', 'learn', 'arcade'];   // modules with a todayFacts service; bills is read here (below)
export const PER_DAY = 3, RECENT_DAYS = 3;
export const DEFAULT_CAP = 10, MAX_CAP = 20;
export const REWARD_CEILING = 500, QUEST_REWARD_CEILING = 1000;                     // hard ceilings; options.today.max*RewardCents can only lower them
export const CHECKS = ['paid_bill', 'moved_to_account', 'opened_registered_account', 'bought_security', 'read_panel'];
export const MOVE_INTO = ['hisa', 'gic', 'tfsa', 'rrsp', 'invest'];
export const KEY = /^[a-z][a-z0-9-]{0,30}$/;
const FACT = /^[a-z][a-z0-9-]*\.[A-Za-z]+$/;

// ---- the errand catalogue (data, validated at boot: a bad template fails boot naming it) ----
const conds = (list, where) => {
  if (!Array.isArray(list)) throw new Error(`${where} must be a list`);
  for (const c of list) {
    if (!c || !FACT.test(c.fact) || !Object.hasOwn(OPS, c.op) || !['number', 'boolean'].includes(typeof c.value)) throw new Error(`${where}: each condition is { fact: "<module>.<name>", op: ${Object.keys(OPS).join(' ')}, value: number | boolean }`);
  }
  return list;
};
export function checkCatalogue(list) {
  const seen = new Set();
  for (const t of list) {
    const where = `modules/today/errands.json "${t?.id}"`;
    if (!t || !KEY.test(t.id) || seen.has(t.id)) throw new Error(`${where}: id must be a unique lowercase name`);
    seen.add(t.id);
    if (typeof t.title !== 'string' || !t.title || t.title.length > 80) throw new Error(`${where}: title must be 1-80 characters`);
    if (!KEY.test(t.module) || !KEY.test(t.building)) throw new Error(`${where}: module and building must be lowercase names`);
    if (!Number.isSafeInteger(t.priority) || t.priority < 0 || t.priority > 99) throw new Error(`${where}: priority must be 0-99`);
    if (!Number.isSafeInteger(t.reward_cents) || t.reward_cents < 0 || t.reward_cents > REWARD_CEILING) throw new Error(`${where}: reward_cents must be 0-${REWARD_CEILING}`);
    if (!Number.isSafeInteger(t.energy) || t.energy < 0 || t.energy > 3) throw new Error(`${where}: energy must be 0-3`);
    if (t.stage !== undefined && !['A', 'B', 'C'].includes(t.stage)) throw new Error(`${where}: stage must be A, B or C`);
    conds(t.when, `${where}: when`);
    const d = t.done ?? {};
    const forms = ['facts', 'event', 'visit'].filter((f) => d[f] !== undefined);
    if (forms.length !== 1) throw new Error(`${where}: done must be exactly one of { facts }, { event }, { visit }`);
    if (d.facts) conds(d.facts, `${where}: done.facts`);
    if (d.event !== undefined && (typeof d.event !== 'string' || !/^(module\.[a-z-]+\.[a-z_]+|ledger\.posted)$/.test(d.event))) throw new Error(`${where}: done.event must be module.<id>.<name> or ledger.posted`);
    if (d.event === 'ledger.posted' && (typeof d.kind !== 'string' || !/^[a-z-]+\.[a-z_]+$/.test(d.kind) || (d.into !== undefined && !MOVE_INTO.includes(d.into)))) throw new Error(`${where}: ledger.posted needs kind "<module>.<kind>" and an optional into (${MOVE_INTO.join(', ')})`);
    if (d.visit !== undefined && !KEY.test(d.visit)) throw new Error(`${where}: done.visit must be a building key`);
  }
  return list;
}
export const TEMPLATES = checkCatalogue(ERRANDS);
export const BY_ID = new Map(TEMPLATES.map((t) => [t.id, t]));
export const EVENT_TYPES = [...new Set(TEMPLATES.map((t) => t.done.event).filter(Boolean))];
export const LEDGER_KINDS = new Set(TEMPLATES.filter((t) => t.done.event === 'ledger.posted').map((t) => t.done.kind));

// ---- selection: pure, so a test can show the same inputs give the same three ----
export const holds = (facts, c) => Object.hasOwn(facts, c.fact) && OPS[c.op](facts[c.fact], c.value);   // an absent fact (module not loaded) never holds
export const tag = (secret, worldId, playerId, dayNo, templateId) => createHmac('sha256', secret).update(`${worldId}:${playerId}:${dayNo}:${templateId}`).digest('hex');
export function selectErrands({ templates = TEMPLATES, facts, secret, worldId, playerId, dayNo, recent = new Set() }) {
  const cands = templates.filter((t) => !recent.has(t.id) && (t.stage === undefined || facts['life.stage'] === t.stage) && t.when.every((c) => holds(facts, c))
    && !(t.done.facts && t.done.facts.every((c) => holds(facts, c))));                     // already done: no free reward
  const alone = cands.find((t) => t.alone);                                                 // the jobless nudge: "Pick a job" and nothing else
  if (alone) return [alone];
  return cands.map((t) => ({ t, h: tag(secret, worldId, playerId, dayNo, t.id) }))
    .sort((a, b) => a.t.priority - b.t.priority || (a.h < b.h ? -1 : a.h > b.h ? 1 : 0)).slice(0, PER_DAY).map((x) => x.t);
}

// ---- small reads ----
export const secretOf = (k, worldId) => {
  const row = k.db.prepare('SELECT secret FROM today_secrets WHERE world_id = ?').get(worldId);
  if (row) return row.secret;
  const secret = randomBytes(16).toString('hex');
  k.db.prepare('INSERT INTO today_secrets (world_id, secret) VALUES (?, ?)').run(worldId, secret);
  return secret;
};
export const lastDay = (k, w) => k.db.prepare('SELECT day_no, at, month FROM today_days WHERE world_id = ? ORDER BY day_no DESC LIMIT 1').get(w.id);
// The day students are playing now. Day 0 is the time before this world's first advance (since the world began).
export const currentDay = (k, w) => lastDay(k, w) ?? { day_no: 0, at: w.created, month: w.month };
export const dayStart = (k, w, dayNo) => (dayNo <= 0 ? w.created : k.db.prepare('SELECT at FROM today_days WHERE world_id = ? AND day_no = ?').get(w.id, dayNo)?.at ?? w.created);
export const stateOf = (k, playerId, worldId) => k.db.prepare('SELECT * FROM today_state WHERE player_id = ? AND world_id = ?').get(playerId, worldId);
const capDefault = (k) => (Number.isSafeInteger(k.config.energyCap) && k.config.energyCap >= 0 && k.config.energyCap <= MAX_CAP ? k.config.energyCap : DEFAULT_CAP);
export const capOf = (k, classId) => k.db.prepare('SELECT energy_cap FROM today_class WHERE class_id = ?').get(classId ?? -1)?.energy_cap ?? capDefault(k);
export const maxReward = (k) => (Number.isSafeInteger(k.config.maxRewardCents) && k.config.maxRewardCents >= 0 ? Math.min(k.config.maxRewardCents, REWARD_CEILING) : REWARD_CEILING);
export const maxQuestReward = (k) => (Number.isSafeInteger(k.config.maxQuestRewardCents) && k.config.maxQuestRewardCents >= 0 ? Math.min(k.config.maxQuestRewardCents, QUEST_REWARD_CEILING) : QUEST_REWARD_CEILING);
export const indexed = (k, w, cents, cap) => Math.min(cap, Math.round((cents * k.world.priceIndex(w.id)) / 10000));
export const openErrands = (k, playerId, worldId, dayNo) => k.db.prepare("SELECT * FROM today_errands WHERE player_id = ? AND world_id = ? AND day_no = ? AND status = 'open' ORDER BY id").all(playerId, worldId, dayNo);

// Every fact about one student, flat: '<module>.<name>'. Bills has no service, so its four are read from its own tables here (read only).
export function factsOf(k, w, playerId) {
  const out = {};
  for (const m of FACT_MODULES) {
    if (!k.modules.has(m)) continue;
    for (const [name, v] of Object.entries(k.modules.call(m, 'todayFacts', { playerId }) ?? {})) if (typeof v === 'number' || typeof v === 'boolean') out[`${m}.${name}`] = v;
  }
  if (k.modules.has('bills')) {
    const due = k.db.prepare('SELECT COUNT(*) AS n, COALESCE(SUM(amount), 0) AS cents, COALESCE(SUM(late), 0) AS late FROM bills_due WHERE player_id = ? AND world_id = ? AND paid_txn IS NULL').get(playerId, w.id);
    Object.assign(out, { 'bills.dueCount': due.n, 'bills.dueCents': due.cents, 'bills.overdueCount': due.late,
      'bills.autopay': !!k.db.prepare('SELECT autopay FROM bills_settings WHERE player_id = ?').get(playerId)?.autopay });
  }
  return out;
}
