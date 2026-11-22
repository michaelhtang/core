// ventures: founding a company, its treasury (capital, stakes, dissolve) and the founder check.
import { money, ok } from '../../lib/kernel.js';
import {
  SECTORS, FOUNDING_COURSES, MIN_COFOUNDERS, MAX_COFOUNDERS, MIN_CAPITAL_CENTS, FOUNDER_UNITS, PLAN_MIN, REP_START_BP,
} from './constants.js';
import { share, splitUnits, proRata } from './demand.js';
import { LIVE, q1, company, members, holders, products, treasuryOf, cashOf, valueOf, nameOf, capitalBy, chequing, teamOf, changed, needWorld, neverActive, bump, note, takeUnits, nameProblem, mustBe, staffOf } from './reads.js';
import { writeStatement, settleDebts } from './finance.js';

// ---- founding ----
export function register(k, user, { name, sector, plan, cofounders }) {
  const w = needWorld(k);
  const cls = k.players.classOf(user.id);
  mustBe(cls && FOUNDING_COURSES.includes(cls.course_id), 403, 'Founding a company is for FinTech 20/30 students. You can still buy from the storefronts on Venture Row.');
  return k.db.txn((tx) => {
    mustBe(!teamOf(k, w.id, user.id), 409, 'You are already on a founding team this season');
    const why = nameProblem(k, name.trim(), w.id);
    mustBe(!why, 400, why);
    mustBe(SECTORS.includes(sector), 400, `Pick a sector: ${SECTORS.join(', ')}`);
    mustBe(plan.trim().length >= PLAN_MIN, 400, `Write a one-paragraph plan (at least ${PLAN_MIN} characters): what you sell, to whom, at what price, and your break-even`);
    const names = [...new Map(cofounders.split(/[\s,;]+/).map((s) => s.trim()).filter(Boolean).map((n) => [n.toLowerCase(), n])).values()];   // usernames ignore case
    mustBe(names.length >= MIN_COFOUNDERS && names.length <= MAX_COFOUNDERS, 400, `Invite ${MIN_COFOUNDERS} to ${MAX_COFOUNDERS} co-founders by username`);
    const mates = new Map(k.players.inClass(cls.id).map((s) => [s.username.toLowerCase(), s]));
    const team = names.map((n) => {
      const s = mates.get(n.toLowerCase());
      mustBe(s, 400, `${n} is not a student in your class`);
      mustBe(s.id !== user.id, 400, 'You are already on your own team: invite your co-founders');
      mustBe(!teamOf(k, w.id, s.id), 409, `${s.username} is already on a founding team this season`);
      return s;
    });
    const id = Number(k.db.prepare(`INSERT INTO ventures_companies (world_id, class_id, name, sector, plan, status, founder_id, rep_bp, created_month, created)
      VALUES (?, ?, ?, ?, ?, 'forming', ?, ?, ?, ?)`).run(w.id, cls.id, name.trim(), sector, plan.trim(), user.id, REP_START_BP, w.month, k.clock.now()).lastInsertRowid);
    const units = splitUnits(FOUNDER_UNITS, team.length + 1);
    const ins = k.db.prepare('INSERT INTO ventures_members (company_id, player_id, status, units_micro, confirmed, seq) VALUES (?, ?, ?, ?, ?, ?)');
    ins.run(id, user.id, 'accepted', units[0], 1, 0);
    team.forEach((s, i) => ins.run(id, s.id, 'invited', units[i + 1], 0, i + 1));
    k.audit('register', { id, worldId: w.id, name: name.trim(), sector, by: user.id, invited: team.map((s) => s.id) }, `player:${user.id}`);
    changed(k, tx, cls.id);
    return { ok: true, id };
  });
}

// Every member accepted and agreed to the split, and a team of 2+: the registration goes to the teacher.
export function maybeSubmit(k, c) {
  const ms = members(k, c.id);
  if (c.status === 'forming' && ms.length >= 2 && ms.every((m) => m.status === 'accepted' && m.confirmed)) k.db.prepare("UPDATE ventures_companies SET status = 'pending' WHERE id = ?").run(c.id);
}
// A member left (declined, left or was removed): the split goes back to equal for those still in, and the others confirm it again.
// The registrant's role passes to the next member if it was them. Fewer than 2 left: the registration is cancelled.
export function resplit(k, c, why = 'Every co-founder declined') {
  const ms = members(k, c.id);
  if (ms.length < 2) { k.db.prepare("UPDATE ventures_companies SET status = 'cancelled', note = ? WHERE id = ?").run(why, c.id); return false; }
  const lead = ms.some((m) => m.player_id === c.founder_id) ? c.founder_id : ms[0].player_id;
  if (lead !== c.founder_id) k.db.prepare('UPDATE ventures_companies SET founder_id = ? WHERE id = ?').run(lead, c.id);
  const units = splitUnits(FOUNDER_UNITS, ms.length);
  ms.forEach((m, i) => k.db.prepare('UPDATE ventures_members SET units_micro = ?, confirmed = ? WHERE company_id = ? AND player_id = ?').run(units[i], m.player_id === lead ? 1 : 0, c.id, m.player_id));
  return true;
}

// Give a founder back exactly the capital they paid in (net of anything already returned): treasury -> their chequing.
export function refundCapital(k, c, pid, actor, month) {
  const net = capitalBy(k, c.id, pid);
  if (net <= 0) return 0;
  const txn = k.ledger.post({ kind: 'refund', actor, meta: { company: c.id, month }, legs: [{ account: treasuryOf(k, c.id), cents: -net, memo: `Capital returned to ${nameOf(k, pid)}` }, { account: chequing(k, pid), cents: net, memo: `Your capital back from ${c.name}` }] });
  k.db.prepare('INSERT INTO ventures_capital (company_id, player_id, month, cents, txn_id) VALUES (?, ?, ?, ?, ?)').run(c.id, pid, month, -net, txn);
  bump(k, c.id, 0, month, { refund_cents: net });
  return net;
}

// A founder leaves (or is removed) before the company has ever been active. Forming or pending: the split goes back to equal and the team
// confirms again. Approved: their capital comes back to them, the cap table is re-split equally among the rest, and the company opens if
// everyone left has paid in. After the company is active, leaving is selling your shares (wave 4c), not this.
export function dropMember(k, c, pid, actor, why) {
  const w = needWorld(k);
  mustBe(['forming', 'pending', 'approved'].includes(c.status), 409, 'Once the company has opened, leaving means selling your shares (coming in a later wave)');
  k.db.prepare("UPDATE ventures_members SET status = 'declined', confirmed = 0, units_micro = 0, dissolve_vote = 0 WHERE company_id = ? AND player_id = ?").run(c.id, pid);
  if (c.status !== 'approved') {
    if (resplit(k, c, why) && c.status === 'pending') k.db.prepare("UPDATE ventures_companies SET status = 'forming' WHERE id = ?").run(c.id);
    maybeSubmit(k, company(k, c.id));
    return;
  }
  refundCapital(k, c, pid, actor, w.month);
  k.db.prepare('DELETE FROM ventures_shares WHERE company_id = ? AND player_id = ?').run(c.id, pid);
  const ms = members(k, c.id);
  if (ms.length < 2) { dissolve(k, company(k, c.id), actor, why); return; }
  resplit(k, c, why);
  const units = splitUnits(FOUNDER_UNITS, ms.length);
  ms.forEach((m, i) => { k.db.prepare('UPDATE ventures_shares SET units_micro = ? WHERE company_id = ? AND player_id = ?').run(units[i], c.id, m.player_id); k.db.prepare('UPDATE ventures_members SET confirmed = 1 WHERE company_id = ? AND player_id = ?').run(c.id, m.player_id); });
  maybeOpen(k, company(k, c.id), w.month);
}
// Approved and every founder in for the minimum: open for business.
export function maybeOpen(k, c, month) {
  if (c.status === 'approved' && members(k, c.id).every((x) => capitalBy(k, c.id, x.player_id) >= MIN_CAPITAL_CENTS)) k.db.prepare("UPDATE ventures_companies SET status = 'active', active_month = ? WHERE id = ?").run(month, c.id);
}

export function memberOf(k, user, id, statuses) {
  const c = company(k, id);
  const m = c && q1(k, 'SELECT * FROM ventures_members WHERE company_id = ? AND player_id = ?', id, user.id);
  mustBe(c && m && c.world_id === k.world.current()?.id, 404, 'Company not found');
  mustBe(!statuses || statuses.includes(c.status), 409, `That company is ${c.status}`);
  return { c, m };
}

export function respond(k, user, id, accept) {
  needWorld(k);
  return k.db.txn((tx) => {
    const { c, m } = memberOf(k, user, id, ['forming']);
    mustBe(m.status === 'invited', 409, 'You already answered that invitation');
    if (accept) {
      mustBe(!teamOf(k, c.world_id, user.id), 409, 'You are already on a founding team this season');
      k.db.prepare("UPDATE ventures_members SET status = 'accepted', confirmed = 1 WHERE company_id = ? AND player_id = ?").run(id, user.id);
      maybeSubmit(k, c);
    } else {
      k.db.prepare("UPDATE ventures_members SET status = 'declined', confirmed = 0, units_micro = 0 WHERE company_id = ? AND player_id = ?").run(id, user.id);
      resplit(k, c);
    }
    k.audit(accept ? 'accept' : 'decline', { id, playerId: user.id }, `player:${user.id}`);
    changed(k, tx, c.class_id);
    return { ok: true, status: company(k, id).status };
  });
}

// The registrant proposes the split: whole percents in team order ("50,30,20"), or '' / 'equal'. Everyone else confirms it again.
export function setSplit(k, user, id, text) {
  needWorld(k);
  return k.db.txn((tx) => {
    const { c } = memberOf(k, user, id, ['forming']);
    mustBe(c.founder_id === user.id, 403, 'Only the student who registered the company proposes the split');
    const ms = members(k, id);
    let units;
    if (!text.trim() || text.trim().toLowerCase() === 'equal') units = splitUnits(FOUNDER_UNITS, ms.length);
    else {
      const pct = text.split(/[\s,;]+/).filter(Boolean).map(Number);
      mustBe(pct.length === ms.length && pct.every((p) => Number.isInteger(p) && p >= 1 && p <= 99) && pct.reduce((t, p) => t + p, 0) === 100, 400,
        `Give ${ms.length} whole percents in team order (${ms.map((m) => nameOf(k, m.player_id)).join(', ')}) that add up to 100, or "equal"`);
      units = splitUnits(FOUNDER_UNITS, ms.length, pct.map((p) => p * 100));
    }
    ms.forEach((m, i) => k.db.prepare('UPDATE ventures_members SET units_micro = ?, confirmed = ? WHERE company_id = ? AND player_id = ?').run(units[i], m.player_id === user.id ? 1 : 0, id, m.player_id));
    k.audit('split', { id, units }, `player:${user.id}`);
    changed(k, tx, c.class_id);
    return { ok: true };
  });
}

export function confirmSplit(k, user, id) {
  needWorld(k);
  return k.db.txn((tx) => {
    const { c, m } = memberOf(k, user, id, ['forming']);
    mustBe(m.status === 'accepted', 409, 'Accept the invitation first');
    k.db.prepare('UPDATE ventures_members SET confirmed = 1 WHERE company_id = ? AND player_id = ?').run(id, user.id);
    maybeSubmit(k, c);
    changed(k, tx, c.class_id);
    return { ok: true, status: company(k, id).status };
  });
}

export function cancel(k, user, id) {
  needWorld(k);
  return k.db.txn((tx) => {
    const { c } = memberOf(k, user, id, ['forming', 'pending']);
    mustBe(c.founder_id === user.id, 403, 'Only the student who registered the company can withdraw it');
    k.db.prepare("UPDATE ventures_companies SET status = 'cancelled', note = 'Withdrawn by the founders', ended_month = ? WHERE id = ?").run(k.world.current().month, id);
    k.audit('cancel', { id }, `player:${user.id}`);
    changed(k, tx, c.class_id);
    return { ok: true };
  });
}

// The teacher's decision. Approval writes the cap table from the agreed split and opens the treasury; founders then capitalise it.
export function decide(k, c, approve, noteText, actor) {
  mustBe(c.status === 'pending', 409, c.status === 'forming' ? 'The team has not finished forming yet' : `That company is ${c.status}`);
  const w = needWorld(k);
  if (approve) {
    const ms = members(k, c.id);
    const ins = k.db.prepare('INSERT INTO ventures_shares (company_id, player_id, units_micro) VALUES (?, ?, ?)');
    for (const m of ms) ins.run(c.id, m.player_id, m.units_micro);
    treasuryOf(k, c.id);
    k.db.prepare("UPDATE ventures_companies SET status = 'approved', approved_month = ?, decided_by = ?, note = ? WHERE id = ?").run(w.month, actor, noteText || null, c.id);
  } else {
    k.db.prepare("UPDATE ventures_companies SET status = 'declined', ended_month = ?, decided_by = ?, note = ? WHERE id = ?").run(w.month, actor, noteText || 'Declined by your teacher', c.id);
  }
  k.audit(approve ? 'approve' : 'decline_registration', { id: c.id, note: noteText || null }, actor);
}

// ---- the treasury ----
export function capitalise(k, user, id, cents) {
  const w = needWorld(k);
  return k.db.txn((tx) => {
    const { c, m } = memberOf(k, user, id, ['approved', 'active']);
    mustBe(m.status === 'accepted', 403, 'Only a founder can put capital in');
    const before = capitalBy(k, id, user.id);
    mustBe(before + cents >= MIN_CAPITAL_CENTS, 400, `Each founder puts in at least ${money(MIN_CAPITAL_CENTS)} in all`);
    const chq = chequing(k, user.id);
    mustBe(k.ledger.balance(chq) >= cents, 400, `Not enough in chequing: you have ${money(k.ledger.balance(chq))}`);
    const txn = k.ledger.post({ kind: 'capital', actor: `player:${user.id}`, meta: { company: id, month: w.month },
      legs: [{ account: chq, cents: -cents, memo: `Capital into ${c.name}` }, { account: treasuryOf(k, id), cents, memo: `Capital from ${user.username ?? nameOf(k, user.id)} (month ${w.month})` }] });
    k.db.prepare('INSERT INTO ventures_capital (company_id, player_id, month, cents, txn_id) VALUES (?, ?, ?, ?, ?)').run(id, user.id, w.month, cents, txn);
    bump(k, id, 0, w.month, { capital_cents: cents });
    maybeOpen(k, c, w.month);
    k.audit('capital', { id, playerId: user.id, cents }, `player:${user.id}`);
    tx.onCommit(() => announce(k, w, id));
    changed(k, tx, c.class_id);
    return { ok: true, status: company(k, id).status, treasury_cents: cashOf(k, id) };
  });
}

// What each holder's stake is worth now (book value: their share of treasury + inventory at cost, split exactly as a dissolution would pay it).
// A company that has never been active is only its founders' capital, so each founder's stake is what they paid in.
export function stakes(k, id) {
  const c = company(k, id), hs = holders(k, id), value = Math.max(0, valueOf(k, id));   // limited liability (4b): never below 0
  if (neverActive(c)) return { value, rows: hs.map((h) => ({ playerId: h.player_id, units: h.units_micro, cents: Math.max(0, capitalBy(k, id, h.player_id)) })) };
  const split = proRata(value, hs.map((h) => ({ units: h.units_micro })));
  return { value, rows: hs.map((h, i) => ({ playerId: h.player_id, units: h.units_micro, cents: split[i] })) };
}
export function announce(k, w, id, zero = false) {
  const c = company(k, id), s = stakes(k, id), staff = s.rows.length ? staffOf(k, id).length : 0;   // staff: for leaderboards' Best Employer
  for (const r of s.rows) {
    const cents = zero ? 0 : r.cents;
    k.db.prepare('INSERT INTO ventures_valued (player_id, world_id, cents) VALUES (?, ?, ?) ON CONFLICT (player_id, world_id) DO UPDATE SET cents = excluded.cents').run(r.playerId, w.id, cents);
    k.events.emit('value', { playerId: r.playerId, worldId: w.id, stake: cents, companyValue: zero ? 0 : s.value, company: c.name, staff: zero ? 0 : staff, paydays: c.paydays, missedPaydays: c.missed_paydays });
  }
}

// Dissolve: whatever is in the treasury goes to the shareholders pro rata, inventory is written off, the final statement is written.
// A company that never opened is cancelled instead: each founder gets back exactly the capital they paid in (not their share of everyone's).
export function dissolve(k, c, actor, why) {
  const w = needWorld(k);
  if (!LIVE.includes(c.status)) {
    mustBe(['forming', 'pending'].includes(c.status), 409, `That company is already ${c.status}`);
    k.db.prepare("UPDATE ventures_companies SET status = 'cancelled', note = ?, ended_month = ? WHERE id = ?").run(why, w.month, c.id);
    return { paid: [] };
  }
  if (neverActive(c)) {
    const paid = holders(k, c.id).map((h) => ({ playerId: h.player_id, cents: refundCapital(k, c, h.player_id, actor, w.month) }));
    k.db.prepare("UPDATE ventures_companies SET status = 'cancelled', ended_month = ?, note = ? WHERE id = ?").run(w.month, `${why}: it never opened, so every founder got their capital back`, c.id);
    writeStatement(k, company(k, c.id), w.month, true);
    k.audit('dissolve', { id: c.id, refunded: paid, by: actor }, actor);
    return { paid };
  }
  for (const p of products(k, c.id, true)) {
    if (p.inventory_units > 0) bump(k, c.id, p.id, w.month, { spoiled_units: p.inventory_units, spoilage_cents: takeUnits(k, p, p.inventory_units) });
    k.db.prepare('UPDATE ventures_products SET active = 0, quantity = 0 WHERE id = ?').run(p.id);
  }
  // 4b: the staff's jobs end, postings close, the loan and taxes owed are paid from the treasury first (what the treasury cannot pay of the
  // loan is written off: the founders owe nothing), then shareholders get what is left
  for (const st of staffOf(k, c.id)) k.modules.call('jobs', 'endBusinessJob', { playerId: st.playerId, businessId: c.id, mode: 'now', month: w.month });
  k.db.prepare('UPDATE ventures_postings SET open = 0 WHERE company_id = ?').run(c.id);
  k.db.prepare("UPDATE ventures_applications SET status = 'withdrawn', decided_month = ? WHERE company_id = ? AND status IN ('pending', 'approved')").run(w.month, c.id);
  settleDebts(k, c, w.month, actor, true);
  const cash = cashOf(k, c.id), hs = holders(k, c.id), split = proRata(cash, hs.map((h) => ({ units: h.units_micro })));
  const legs = hs.map((h, i) => ({ account: chequing(k, h.player_id), cents: split[i], memo: `${c.name} dissolved: your share` })).filter((l) => l.cents > 0);
  if (cash > 0) k.ledger.post({ kind: 'payout', actor, meta: { company: c.id, month: w.month }, legs: [{ account: treasuryOf(k, c.id), cents: -cash, memo: 'Dissolved: paid out to shareholders' }, ...legs] });
  bump(k, c.id, 0, w.month, { payout_cents: cash });
  k.db.prepare("UPDATE ventures_companies SET status = 'dissolved', ended_month = ?, note = ? WHERE id = ?").run(w.month, why, c.id);
  writeStatement(k, company(k, c.id), w.month, true);
  k.audit('dissolve', { id: c.id, cash, by: actor }, actor);
  return { paid: hs.map((h, i) => ({ playerId: h.player_id, cents: split[i] })) };
}
export const afterDissolve = (k, tx, w, c) => { tx.onCommit(() => { if (LIVE.includes(c.status)) announce(k, w, c.id, true); }); changed(k, tx, c.class_id); };


export const founderOf = (k, user, id, statuses = ['active', 'frozen']) => { const r = memberOf(k, user, id, statuses); mustBe(r.m.status === 'accepted', 403, 'Only a founder can do that'); return r; };
