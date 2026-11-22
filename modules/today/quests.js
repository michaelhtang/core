// today: lesson quests (read, judge, finish, settle), the ledger digest, the Today card, and the teacher's quest input.
import { CHECKS, MOVE_INTO, KEY, MAX_CAP, BY_ID, holds, dayStart, stateOf, capOf, maxReward, maxQuestReward, indexed, openErrands, factsOf } from './catalogue.js';
import { reward, credit, hintsOf, completeErrand, ensureDay } from './errands.js';

// ---- lesson quests ----
export const questToday = (k, w) => {
  const row = k.db.prepare('SELECT * FROM today_quests WHERE world_id = ? AND date = ?').get(w.id, k.clock.today());
  return row ? { ...row, body: JSON.parse(row.body) } : null;
};
// One task, judged from the ledger (actions the student took since the day began), their accounts, or their building visits today.
export function taskDone(k, w, playerId, day, task) {
  const actor = `player:${playerId}`;
  const mine = "SELECT id FROM accounts WHERE owner_type = 'player' AND owner_id = ?";
  switch (task.kind) {
    case 'paid_bill':
      return !!k.db.prepare(`SELECT 1 FROM entries e JOIN txns t ON t.id = e.txn_id WHERE e.account_id IN (${mine}) AND e.created > ? AND t.kind = 'bills.payment' AND t.actor = ? LIMIT 1`).get(playerId, day.at, actor);
    case 'moved_to_account':
      return !!k.db.prepare(`SELECT 1 FROM entries e JOIN txns t ON t.id = e.txn_id JOIN accounts a ON a.id = e.account_id WHERE e.account_id IN (${mine}) AND e.created > ? AND e.amount_cents > 0 AND t.actor = ?
        AND (a.kind = ? OR (? = 'gic' AND a.kind LIKE 'gic:%')) LIMIT 1`).get(playerId, day.at, actor, task.check, task.check);
    case 'opened_registered_account':   // the student contributed to a TFSA/RRSP themselves today (a contribution only: selling inside an account, or an account that already holds money, does not count)
      return !!k.db.prepare(`SELECT 1 FROM entries e JOIN txns t ON t.id = e.txn_id JOIN accounts a ON a.id = e.account_id WHERE e.account_id IN (${mine}) AND e.created > ? AND e.amount_cents > 0 AND t.actor = ? AND t.kind = 'exchange.contribute'
        AND a.kind IN (SELECT value FROM json_each(?)) LIMIT 1`).get(playerId, day.at, actor, JSON.stringify(task.check ? [task.check] : ['tfsa', 'rrsp']));
    case 'bought_security':   // the student's own buy today: a market buy, or placing a limit buy (exchange.hold); a fill in a tick alone never counts
      return !!k.db.prepare(`SELECT 1 FROM entries e JOIN txns t ON t.id = e.txn_id WHERE e.account_id IN (${mine}) AND e.created > ? AND t.actor = ? AND t.kind IN ('exchange.buy', 'exchange.hold')
        AND (? IS NULL OR json_extract(t.meta, '$.ticker') = ?) LIMIT 1`).get(playerId, day.at, actor, task.check ?? null, task.check ?? null);
    case 'read_panel':
      return !!k.db.prepare('SELECT 1 FROM today_visits WHERE player_id = ? AND world_id = ? AND day_no = ? AND building = ?').get(playerId, w.id, day.day_no, task.check);
    default: return false;
  }
}
export const questDone = (k, questId, playerId) => k.db.prepare('SELECT * FROM today_quest_done WHERE quest_id = ? AND player_id = ?').get(questId, playerId);
export function finishQuest(k, w, q, playerId, day, cap, answer = null) {
  return k.db.txn(() => {
    if (questDone(k, q.id, playerId)) return false;
    const cents = Math.min(q.body.reward_cents, maxQuestReward(k));   // fixed amount, set by the teacher (not indexed)
    k.db.prepare('INSERT INTO today_quest_done (quest_id, player_id, world_id, done_month, answer, reward_cents, created) VALUES (?, ?, ?, ?, ?, ?, ?)').run(q.id, playerId, w.id, w.month, answer, cents, k.clock.now());
    reward(k, w, playerId, cents, 'quest', { quest: q.id, day: day.day_no }, `Quest: ${q.body.title}`);
    credit(k, w, playerId, day.day_no, q.body.energy, cap);
    k.db.afterCommit(() => hintsOf(k).mark(playerId));
    return true;
  });
}

// Mark done whatever is done now: open errands whose done-facts hold, and today's quest when its tasks are done and it needs no answer.
export function settle(k, w, user) {
  const { day, facts: known } = ensureDay(k, w, user.id, user.class_id);
  const cap = capOf(k, user.class_id);
  const open = openErrands(k, user.id, w.id, day.day_no).filter((e) => BY_ID.get(e.template)?.done.facts);
  if (open.length) {
    const facts = known ?? factsOf(k, w, user.id);
    for (const e of open) if (BY_ID.get(e.template).done.facts.every((c) => holds(facts, c))) completeErrand(k, w, e, cap);
  }
  const q = questToday(k, w);
  if (q && !q.body.justify && !questDone(k, q.id, user.id) && q.body.tasks.every((t) => taskDone(k, w, user.id, day, t))) finishQuest(k, w, q, user.id, day, cap);
  return day;
}

// ---- the digest: the student's ledger since the previous advance, by txns.kind (read time; nothing stored) ----
const GROUPS = [['start', (kd) => kd === 'bank-basic.welcome'], ['pay', (kd) => kd.startsWith('jobs.') || kd === 'retirement.cpp' || kd === 'retirement.oas'], ['bills', (kd) => /^(bills|housing|insurance|credit)\./.test(kd)],
  ['interest', (kd) => ['savings.interest', 'savings.gic_maturity', 'exchange.dividend', 'exchange.rrsp_refund'].includes(kd)], ['rewards', (kd) => kd.startsWith('today.')]];
export function digest(k, w, playerId, day) {
  const since = dayStart(k, w, day.day_no - 1);
  const rows = k.db.prepare(`SELECT t.kind, SUM(e.amount_cents) AS cents FROM entries e JOIN txns t ON t.id = e.txn_id
    WHERE e.account_id IN (SELECT id FROM accounts WHERE owner_type = 'player' AND owner_id = ? AND kind <> 'payable') AND e.created > ? GROUP BY t.kind`).all(playerId, since);
  const groups = { start: 0, pay: 0, bills: 0, interest: 0, rewards: 0, other: 0 };
  for (const r of rows) groups[GROUPS.find(([, f]) => f(r.kind))?.[0] ?? 'other'] += r.cents;
  const total = rows.reduce((s, r) => s + r.cents, 0);
  return { since, groups, total, kinds: rows.filter((r) => r.cents).sort((a, b) => Math.abs(b.cents) - Math.abs(a.cents)).slice(0, 6) };
}

// What the card shows (also GET /state). Small and plain: it travels in /api/me.
export function card(k, w, user) {
  const day = settle(k, w, user);
  const st = stateOf(k, user.id, w.id);
  const errands = k.db.prepare('SELECT id, template, status, reward_cents FROM today_errands WHERE player_id = ? AND world_id = ? AND day_no = ? ORDER BY id').all(user.id, w.id, day.day_no)
    .map((e) => { const t = BY_ID.get(e.template); return { id: e.id, title: t?.title ?? e.template, building: t?.building ?? null, status: e.status, reward_cents: e.status === 'done' ? e.reward_cents : t ? indexed(k, w, t.reward_cents, maxReward(k)) : 0, energy: t?.energy ?? 0 }; });
  const q = questToday(k, w);
  const done = q && questDone(k, q.id, user.id);
  const facts = k.modules.has('savings') ? k.modules.call('savings', 'todayFacts', { playerId: user.id }) : null;
  const dg = digest(k, w, user.id, day);
  return {
    day: day.day_no, month: w.month, energy: st.energy, energy_cap: capOf(k, user.class_id), streak: st.streak,
    errands,
    quest: q && { id: q.id, title: q.body.title, brief: q.body.brief, justify: q.body.justify, reward_cents: Math.min(q.body.reward_cents, maxQuestReward(k)), done: !!done,
      tasks: q.body.tasks.map((t) => ({ kind: t.kind, check: t.check ?? null, done: !!done || taskDone(k, w, user.id, day, t) })) },
    digest: { groups: dg.groups, total: dg.total, kinds: dg.kinds },
    due: k.modules.has('bills') ? k.db.prepare('SELECT COUNT(*) AS n, COALESCE(SUM(amount), 0) AS cents FROM bills_due WHERE player_id = ? AND world_id = ? AND paid_txn IS NULL').get(user.id, w.id) : null,
    savings: facts && { hisa_cents: facts.hisaCents, net_worth_cents: facts.netWorthCents },
  };
}

// ---- quest input (teacher upload): every field validated, sizes capped ----
export function parseQuest(k, body) {
  const id = k.input.str(body, 'id', { max: 60 }).trim();
  const date = k.input.str(body, 'date', { max: 10 });
  const title = k.input.str(body, 'title', { max: 80 }).trim();
  const brief = k.input.str(body, 'brief', { max: 600 }).trim();
  if (!/^[\w-]{1,60}$/.test(id)) throw new k.HttpError(400, 'id must be 1-60 letters, digits, - or _');
  const [y, m, d] = date.split('-').map(Number);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || new Date(Date.UTC(y, m - 1, d)).toISOString().slice(0, 10) !== date) throw new k.HttpError(400, 'date must be a real date, YYYY-MM-DD');
  if (!title) throw new k.HttpError(400, 'title is required');
  if (!brief) throw new k.HttpError(400, 'brief is required');
  const justify = k.input.bool(body, 'justify');
  const rewardCents = k.input.int(body, 'reward_cents', { min: 0, max: maxQuestReward(k) });
  const energy = k.input.int(body, 'energy', { min: 0, max: MAX_CAP });
  const raw = Object.hasOwn(body, 'tasks') ? body.tasks : undefined;
  if (!Array.isArray(raw) || raw.length < 1 || raw.length > 5) throw new k.HttpError(400, 'tasks must be a list of 1-5 tasks');
  const tasks = raw.map((t, i) => {
    if (!t || typeof t !== 'object' || Array.isArray(t) || !CHECKS.includes(t.kind)) throw new k.HttpError(400, `tasks[${i}].kind must be one of ${CHECKS.join(', ')}`);
    const c = t.check ?? null;
    const okCheck = { paid_bill: c === null, moved_to_account: MOVE_INTO.includes(c), opened_registered_account: c === null || c === 'tfsa' || c === 'rrsp',
      bought_security: c === null || (typeof c === 'string' && /^[A-Z]{2,5}$/.test(c)), read_panel: typeof c === 'string' && KEY.test(c) }[t.kind];
    if (!okCheck) throw new k.HttpError(400, `tasks[${i}].check does not fit ${t.kind} (moved_to_account: ${MOVE_INTO.join('/')}; opened_registered_account: tfsa/rrsp or none; bought_security: a ticker or none; read_panel: a building key; paid_bill: none)`);
    return c === null ? { kind: t.kind } : { kind: t.kind, check: c };
  });
  return { id, date, title, brief, tasks, justify, reward_cents: rewardCents, energy };
}
