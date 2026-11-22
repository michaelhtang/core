// today: paying and completing errands (reward, streak, live hint), catching a student up to the current day, and the events that finish errands.
import { createHints, pushAll } from '../../lib/live.js';
import { RECENT_DAYS, TEMPLATES, BY_ID, LEDGER_KINDS, holds, selectErrands, secretOf, currentDay, stateOf, capOf, maxReward, indexed, openErrands, factsOf } from './catalogue.js';

// ---- money: minted from the town into chequing, one balanced txn ----
export function reward(k, w, playerId, cents, kind, meta, memo) {
  const chq = cents > 0 ? k.ledger.accountId('player', playerId, 'chequing') : undefined;
  if (!chq) return null;
  return k.ledger.post({ kind, actor: 'system', meta: { ...meta, worldId: w.id }, legs: [{ account: k.ledger.system('mint'), cents: -cents, memo }, { account: chq, cents, memo }] });
}

// The streak counts days (advances) with at least one errand or quest done; energy goes up by the reward, never past the cap.
export function credit(k, w, playerId, dayNo, energy, cap) {
  const st = stateOf(k, playerId, w.id);
  const streak = st.last_day_done === dayNo ? st.streak : st.last_day_done === dayNo - 1 ? st.streak + 1 : 1;
  k.db.prepare('UPDATE today_state SET streak = ?, last_day_done = ?, energy = MIN(?, energy + ?) WHERE player_id = ? AND world_id = ?').run(streak, dayNo, cap, energy, playerId, w.id);
  // TODO(grantItem): streak cosmetics at 5, 10 and 20 days (Outfitters grantItem, achievement-style) once that service lands. Not called yet.
}

// Live: a finished errand or quest tells that one student "today.done" (no payload), so the Today card flips even when no money moved (a reward of 0, or
// the cap). Marked after commit, one push per 500 ms window for everyone marked meanwhile (docs/live.md).
const hints = new WeakMap();
export const hintsOf = (k) => {
  if (!hints.has(k)) hints.set(k, createHints((ids) => pushAll(k, ids, 'today.done', {}, { skippable: true })));
  return hints.get(k);
};

export function completeErrand(k, w, e, cap) {
  const t = BY_ID.get(e.template);
  return k.db.txn(() => {
    if (!k.db.prepare("UPDATE today_errands SET status = 'done', done_month = ? WHERE id = ? AND status = 'open'").run(w.month, e.id).changes) return false;   // already done
    const cents = t ? indexed(k, w, t.reward_cents, maxReward(k)) : 0;
    const txn = reward(k, w, e.player_id, cents, 'errand', { errand: e.id, template: e.template, day: e.day_no }, `Errand: ${t?.title ?? e.template}`);
    k.db.prepare('UPDATE today_errands SET reward_cents = ?, txn_id = ? WHERE id = ?').run(txn ? cents : 0, txn, e.id);
    credit(k, w, e.player_id, e.day_no, t?.energy ?? 0, cap);
    k.db.afterCommit(() => hintsOf(k).mark(e.player_id));
    return true;
  });
}

// Catch a student up to the current day (idempotent: a second call the same day only reads). Returns { day, st, facts? }.
export function ensureDay(k, w, playerId, classId = k.players.classOf(playerId)?.id) {
  const day = currentDay(k, w);
  const st = stateOf(k, playerId, w.id);
  if (st && st.day_no === day.day_no) return { day, st };
  return k.db.txn(() => {
    // A real day-0 row the first time anyone looks before the first advance: its month stays put, so a tick's events (month + 1) never match it.
    if (day.day_no === 0) k.db.prepare('INSERT OR IGNORE INTO today_days (world_id, day_no, at, month) VALUES (?, 0, ?, ?)').run(w.id, day.at, day.month);
    const cap = capOf(k, classId);
    const facts = factsOf(k, w, playerId);
    if (!st) {
      k.db.prepare('INSERT INTO today_state (player_id, world_id, day_no, energy, streak, last_day_done) VALUES (?, ?, ?, ?, 0, NULL)').run(playerId, w.id, day.day_no, cap);
    } else {
      // The last day this student was caught up to: its errands that are done by a fact count for that day (the "fact check at the next
      // advance", however many days later they look); every other open one expires.
      for (const e of openErrands(k, playerId, w.id, st.day_no)) {
        const t = BY_ID.get(e.template);
        if (t?.done.facts?.every((c) => holds(facts, c))) completeErrand(k, w, e, cap);
      }
      k.db.prepare("UPDATE today_errands SET status = 'expired' WHERE player_id = ? AND world_id = ? AND day_no < ? AND status = 'open'").run(playerId, w.id, day.day_no);
      const now = stateOf(k, playerId, w.id);
      const streak = now.last_day_done !== null && now.last_day_done >= day.day_no - 1 ? now.streak : 0;   // a missed class day resets it
      k.db.prepare('UPDATE today_state SET day_no = ?, energy = ?, streak = ? WHERE player_id = ? AND world_id = ?').run(day.day_no, cap, streak, playerId, w.id);
    }
    const recent = new Set(k.db.prepare("SELECT template FROM today_errands WHERE player_id = ? AND world_id = ? AND status = 'done' AND day_no >= ?").all(playerId, w.id, day.day_no - RECENT_DAYS).map((r) => r.template));
    const picks = selectErrands({ templates: TEMPLATES.filter((t) => k.modules.has(t.module)), facts, secret: secretOf(k, w.id), worldId: w.id, playerId, dayNo: day.day_no, recent });
    const ins = k.db.prepare('INSERT OR IGNORE INTO today_errands (player_id, world_id, day_no, template) VALUES (?, ?, ?, ?)');
    for (const t of picks) ins.run(playerId, w.id, day.day_no, t.id);
    return { day, st: stateOf(k, playerId, w.id), facts };
  });
}

// ---- events: the errands whose `done` names an event (built from the catalogue) ----
export function onEvent(k, type, p) {
  const w = k.world.current();
  if (w?.status !== 'active' || !p) return;
  let ids;
  if (type === 'ledger.posted') {
    if (!LEDGER_KINDS.has(p.kind) || typeof p.actor !== 'string') return;
    ids = (p.owners ?? []).filter((o) => o.type === 'player' && p.actor === `player:${o.id}`).map((o) => o.id);   // the student's own action, not a tick
  } else {
    if (!Number.isSafeInteger(p.playerId) || (Number.isSafeInteger(p.worldId) && p.worldId !== w.id)) return;
    ids = [p.playerId];
  }
  for (const playerId of ids) {
    if (!stateOf(k, playerId, w.id)) continue;                                     // never opened Today (or today is off for their course)
    const day = currentDay(k, w);
    if (type !== 'ledger.posted' && Number.isSafeInteger(p.month) && p.month !== day.month) continue;   // emitted by a tick, not today's play
    if (type === 'ledger.posted' && !(k.db.prepare('SELECT created FROM txns WHERE id = ?').get(p.txnId)?.created > day.at)) continue;
    const { day: d } = ensureDay(k, w, playerId);
    const cap = capOf(k, k.players.classOf(playerId)?.id);
    for (const e of openErrands(k, playerId, w.id, d.day_no)) {
      const done = BY_ID.get(e.template)?.done;
      if (done?.event !== type) continue;
      if (type === 'ledger.posted' && (done.kind !== p.kind || (done.into && !p.legs.some((l) => l.cents > 0 && k.ledger.account(l.account)?.kind === done.into)))) continue;
      completeErrand(k, w, e, cap);
    }
  }
}
