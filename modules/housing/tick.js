// housing: student-unit tenancy (leaving, dropping, monthly rent) and the monthly tick (pending moves, deposits, mortgage and rent debits).
import { NSF_FEE_CENTS, EVICT_AFTER_MISSED } from './constants.js';
import { payment, interestFor } from './mortgage.js';
import { world, rental, px, depositFor, driftBp, rentBand, mortgageBp, tenureRow, chequingOf, mortAcct, debtOf, depositOf, unitIdOf, listingOf, nameOf, unitName, ownLines } from './reads.js';

// ---- student units (6b) ----
export const setShared = (k, playerId, worldId, month) => k.db.prepare("UPDATE housing_tenure SET tenure = 'shared', pending_tenure = NULL, pending_from = NULL, since_month = ? WHERE player_id = ? AND world_id = ?").run(month, playerId, worldId);

// The tenant leaves the unit (moved, notice, sale, buying a home, a cancelled reservation): arrears are collected from their chequing, all of it or
// what is there (never below zero), and the rest written off (the landlord's loss: rent never received, nothing to reverse). An eviction writes all
// of it off (the spec). The unit stays listed, vacant from this month, and an announced rent change takes effect at once (a vacant unit's rent
// changes at once; the notice was for the tenant who is leaving, never for the next one). Returns the cents written off.
export function leaveUnit(k, l, month, how) {
  let written = l.arrears_cents;
  if (l.arrears_cents > 0 && how !== 'evicted') {
    const chq = chequingOf(k, l.tenant_id), take = chq ? Math.min(l.arrears_cents, Math.max(0, k.ledger.balance(chq))) : 0;
    if (take > 0) k.ledger.post({ kind: 'rent', actor: 'system', meta: { month, homeId: l.home_id, tenantId: l.tenant_id, landlordId: l.landlord_id, rent: 0, arrears: take },
      legs: [{ account: chq, cents: -take, memo: 'Rent arrears' }, { account: chequingOf(k, l.landlord_id), cents: take, memo: 'Rent arrears received' }] });
    written -= take;
  }
  k.db.prepare(`UPDATE housing_listings SET tenant_id = NULL, since_month = ?, arrears_cents = 0, missed_streak = 0, notice_month = NULL, written_off_cents = written_off_cents + ?, evictions = evictions + ?,
    rent_cents = COALESCE(pending_rent_cents, rent_cents), pending_rent_cents = NULL, rent_from = NULL WHERE home_id = ?`).run(month, written, how === 'evicted' ? 1 : 0, l.home_id);
  return written;
}

// The unit's tenant (living there, or only reserved for next month) is put out: the resident goes to the shared room now, a reservation is cancelled.
export function dropTenant(k, l, worldId, month, how) {
  const t = tenureRow(k, l.tenant_id, worldId), unit = `unit:${l.home_id}`;
  if (t?.tenure === unit) k.db.prepare("UPDATE housing_tenure SET tenure = 'shared', since_month = ? WHERE player_id = ? AND world_id = ?").run(month, l.tenant_id, worldId);   // a planned move elsewhere stays
  else if (t?.pending_tenure === unit) k.db.prepare('UPDATE housing_tenure SET pending_tenure = NULL, pending_from = NULL WHERE player_id = ? AND world_id = ?').run(l.tenant_id, worldId);
  return leaveUnit(k, l, month, how);
}

// One month of a tenant in a classmate's unit (the tick, before any home). Returns true when they still live there this month (housed), false when the
// landlord's notice ended the tenancy (they are in the shared room from this month).
export function rentMonth(k, w, month, tenantId, homeId) {
  const l = listingOf(k, homeId);
  if (!l || l.tenant_id !== tenantId || l.status !== 'owned') { setShared(k, tenantId, w.id, month); return false; }   // cannot happen: a sale or end releases the tenant
  if (l.notice_month !== null && l.notice_month <= month) {
    dropTenant(k, l, w.id, month, 'notice');
    k.events.emit('moved', { playerId: tenantId, worldId: w.id, month, tenure: 'shared', name: 'a shared room' });
    return false;
  }
  if (k.db.prepare('SELECT 1 FROM housing_rent WHERE home_id = ? AND month = ?').get(homeId, month)) return true;   // charged already (never twice a month)
  const rent = l.rent_cents, npc = rentBand(k, l.property).tierCents;
  const chq = chequingOf(k, tenantId), cash = chq ? k.ledger.balance(chq) : 0;
  const base = { playerId: tenantId, worldId: w.id, month, amount: rent, kind: 'rent', homeId, landlordId: l.landlord_id, rentCents: rent, npcCents: npc };
  if (cash >= rent) {
    const cure = cash >= rent + l.arrears_cents ? l.arrears_cents : 0;
    k.ledger.post({ kind: 'rent', actor: 'system', meta: { month, homeId, tenantId, landlordId: l.landlord_id, rent, arrears: cure },
      legs: [{ account: chq, cents: -(rent + cure), memo: `Rent: ${unitName(k, l)}${cure ? ' + arrears' : ''}` }, { account: chequingOf(k, l.landlord_id), cents: rent + cure, memo: `Rent from ${nameOf(k, tenantId)}` }] });
    k.db.prepare('UPDATE housing_listings SET arrears_cents = arrears_cents - ?, missed_streak = 0 WHERE home_id = ?').run(cure, homeId);
    k.db.prepare("INSERT INTO housing_rent (home_id, world_id, month, tenant_id, rent_cents, status) VALUES (?, ?, ?, ?, ?, 'paid')").run(homeId, w.id, month, tenantId, rent);
    k.events.emit('payment', { ...base, onTime: true });
    return true;
  }
  // Short: no partial rent. The $45 NSF fee goes to the sink when chequing has it, else it is added to what is owed the landlord.
  const nsfPaid = chq && cash >= NSF_FEE_CENTS;
  if (nsfPaid) k.ledger.post({ kind: 'rent_nsf', actor: 'system', meta: { month, homeId }, legs: [{ account: chq, cents: -NSF_FEE_CENTS, memo: 'NSF fee: rent payment bounced' }, { account: k.ledger.system('sink'), cents: NSF_FEE_CENTS, memo: 'NSF fee' }] });
  k.db.prepare('UPDATE housing_listings SET arrears_cents = arrears_cents + ?, missed_streak = missed_streak + 1 WHERE home_id = ?').run(rent + (nsfPaid ? 0 : NSF_FEE_CENTS), homeId);
  k.db.prepare("INSERT INTO housing_rent (home_id, world_id, month, tenant_id, rent_cents, status) VALUES (?, ?, ?, ?, ?, 'missed')").run(homeId, w.id, month, tenantId, rent);
  k.events.emit('payment', { ...base, onTime: false });
  if (l.missed_streak + 1 >= EVICT_AFTER_MISSED) {
    const written = dropTenant(k, listingOf(k, homeId), w.id, month, 'evicted');
    k.audit('evicted', { playerId: tenantId, homeId, landlordId: l.landlord_id, writtenOff: written }, 'system');
    k.events.emit('evicted', { playerId: tenantId, worldId: w.id, month, homeId, landlordId: l.landlord_id, writtenOffCents: written });
  }
  return true;                                                                    // lived there this month (evicted at its end)
}

// ---- tick ----
export function applyPending(k, row, month) {
  const from = row.tenure;
  let target = row.pending_tenure;
  const into = unitIdOf(target);
  if (into !== null) {                                                            // the reservation must still hold (a sale or an end cancels it)
    const l = listingOf(k, into);
    if (l && l.tenant_id === row.player_id && l.status === 'owned' && l.listed) k.db.prepare('UPDATE housing_listings SET since_month = ? WHERE home_id = ?').run(month, into);
    else target = 'shared';
  }
  const out = unitIdOf(from);
  if (out !== null && from !== target) { const l = listingOf(k, out); if (l?.tenant_id === row.player_id) leaveUnit(k, l, month, 'moved'); }
  k.db.prepare('UPDATE housing_tenure SET tenure = ?, pending_tenure = NULL, pending_from = NULL, since_month = ? WHERE player_id = ? AND world_id = ?').run(target, month, row.player_id, row.world_id);
  // module.housing.moved { playerId, worldId, month, tenure, name }: the move took effect (inside the tick; the feed's "moved into ...")
  const name = target === 'shared' ? 'a shared room' : unitIdOf(target) !== null ? unitName(k, listingOf(k, unitIdOf(target))) : rental(target)?.name ?? target;
  k.events.emit('moved', { playerId: row.player_id, worldId: row.world_id, month, tenure: target, name });
  return target;
}

// A renter holds exactly one month's rent as a damage deposit; anyone not renting holds none. Tops up or refunds to match (at the tick a move takes effect).
export function settleDeposit(k, playerId, tenure) {
  const want = depositFor(tenure), have = depositOf(k, playerId);
  if (have === want) return;
  const chq = chequingOf(k, playerId), dep = k.ledger.openAccount({ ownerType: 'player', ownerId: playerId, kind: 'deposit' });
  if (have > want) k.ledger.post({ kind: 'deposit_refund', legs: [{ account: dep, cents: -(have - want), memo: 'Damage deposit returned' }, { account: chq, cents: have - want, memo: 'Damage deposit returned' }] });
  else if (k.ledger.balance(chq) >= want - have) k.ledger.post({ kind: 'deposit', legs: [{ account: chq, cents: -(want - have), memo: 'Damage deposit' }, { account: dep, cents: want - have, memo: 'Damage deposit' }] });
}

// One home's month: market drift, renewal if the term is up, the pre-authorized mortgage debit. Returns { lines, value, debt }: the caller emits one
// costs and one value event per student. otherPay = this month's payments on the student's other homes (for the payment event's `total`).
export function tickHome(k, w, month, h, otherPay) {
  const playerId = h.player_id;
  const lines = [];
  const value = Math.round((h.value_cents * (10000 + driftBp(k))) / 10000);
  k.db.prepare('UPDATE housing_homes SET value_cents = ? WHERE id = ?').run(value, h.id);
  h = { ...h, value_cents: value };

  let debt = debtOf(k, h);
  if (debt > 0 && month - h.term_start >= h.term_months) {            // renewal at the end of the term: today's 5-year fixed rate, payment recalculated
    const newBp = mortgageBp(k, w.id), left = Math.max(1, h.amort_left);
    const newPay = payment(debt, newBp, left);
    k.db.prepare('INSERT INTO housing_renewals (home_id, month, old_bp, new_bp, old_payment, new_payment, balance_cents) VALUES (?, ?, ?, ?, ?, ?, ?)').run(h.id, month, h.rate_bp, newBp, h.payment_cents, newPay, debt);
    k.db.prepare('UPDATE housing_homes SET rate_bp = ?, payment_cents = ?, term_start = ? WHERE id = ?').run(newBp, newPay, month, h.id);
    h = { ...h, rate_bp: newBp, payment_cents: newPay, term_start: month };
  }

  if (debt > 0 && h.payment_cents > 0) {
    const interest = interestFor(debt, h.rate_bp);
    const regular = debt + interest <= h.payment_cents ? debt + interest : h.payment_cents;   // the last payment clears what is left
    const chq = chequingOf(k, playerId), mort = mortAcct(k, h), sink = k.ledger.system('sink');
    const cash = k.ledger.balance(chq);
    const ev = { playerId, worldId: w.id, month, amount: regular, kind: 'mortgage', homeId: h.id, role: h.role, total: otherPay + regular };
    if (cash >= regular) {
      const cure = cash >= regular + h.arrears_cents ? h.arrears_cents : 0;                  // clear arrears too when the account can carry both
      const principal = regular - interest;
      k.ledger.post({
        kind: 'mortgage_payment', actor: 'system', meta: { month, interest, principal, arrears: cure, homeId: h.id },
        legs: [{ account: chq, cents: -(regular + cure), memo: `${h.role === 'rental' ? 'Rental mortgage' : 'Mortgage'} payment${cure ? ' + arrears' : ''}` }, { account: mort, cents: principal + cure, memo: 'Principal' }, ...(interest > 0 ? [{ account: sink, cents: interest, memo: 'Mortgage interest' }] : [])],
      });
      debt -= principal + cure;
      k.db.prepare('UPDATE housing_homes SET arrears_cents = arrears_cents - ?, missed_streak = 0, payment_cents = ? WHERE id = ?').run(cure, debt <= 0 ? 0 : h.payment_cents, h.id);
      k.db.prepare('INSERT OR REPLACE INTO housing_payments (home_id, month, interest_cents, principal_cents, arrears_paid_cents, balance_cents, status) VALUES (?, ?, ?, ?, ?, ?, ?)').run(h.id, month, interest, principal, cure, debt, 'paid');
      k.events.emit('payment', { ...ev, onTime: true });
    } else {
      if (interest > 0) k.ledger.post({ kind: 'mortgage_interest', actor: 'system', meta: { month, homeId: h.id }, legs: [{ account: mort, cents: -interest, memo: 'Interest added: payment missed' }, { account: sink, cents: interest, memo: 'Mortgage interest' }] });
      debt += interest;
      k.db.prepare('UPDATE housing_homes SET arrears_cents = arrears_cents + ?, missed_streak = missed_streak + 1, missed_total = missed_total + 1 WHERE id = ?').run(regular, h.id);
      k.db.prepare('INSERT OR REPLACE INTO housing_payments (home_id, month, interest_cents, principal_cents, arrears_paid_cents, balance_cents, status) VALUES (?, ?, ?, ?, ?, ?, ?)').run(h.id, month, interest, 0, 0, debt, 'missed');
      lines.push({ key: h.role === 'rental' ? 'nsf-rental' : 'nsf', name: `NSF fee: ${h.role === 'rental' ? 'rental ' : ''}mortgage payment bounced`, amount: NSF_FEE_CENTS, category: 'fees' });
      k.events.emit('payment', { ...ev, onTime: false });
    }
  }
  k.db.prepare('UPDATE housing_homes SET amort_left = MAX(0, amort_left - 1) WHERE id = ?').run(h.id);
  return { lines: [...ownLines(k, value, h.property, h.role), ...lines], value, debt };
}

// One student's month. Tenants of student units run first (see tick), so the rent is in the landlord's chequing before any mortgage debit.
export function monthFor(k, w, month, row, homes) {
  const playerId = row.player_id;
  let tenure = row.tenure;
  if (row.pending_tenure && row.pending_from <= month) tenure = applyPending(k, row, month);
  settleDeposit(k, playerId, tenure);
  const unit = unitIdOf(tenure);
  const inUnit = unit !== null && rentMonth(k, w, month, playerId, unit);
  const lines = [];
  const r = rental(tenure);
  if (r) lines.push({ key: 'rent', name: r.lineName ?? `Rent: ${r.name}`, amount: px(k, r.rentCents), category: 'needs' });
  const mine = homes.get(playerId) ?? [];
  let value = 0, debt = 0;
  const pays = mine.reduce((t, h) => t + h.payment_cents, 0);
  for (const h of mine) {
    if (h.bought_month < month) { const t = tickHome(k, w, month, h, pays - h.payment_cents); lines.push(...t.lines); value += t.value; debt += t.debt; } else { value += h.value_cents; debt += debtOf(k, h); }
  }
  // housed: this student's home replaces bills' own (shared-room) rent line this month: an owner living in their home, an NPC rental, or a classmate's unit.
  // A landlord who lives in the shared room is not housed: bills still charges the shared room, plus the rental's owner lines.
  const housed = tenure === 'own' || !!r || inUnit;
  if ((lines.length || housed) && chequingOf(k, playerId)) k.events.emit('costs', { playerId, month, lines, housed });
  if (mine.length) k.events.emit('value', { playerId, worldId: w.id, homeValue: value, mortgageBalance: debt });
}

export function tick(k, { month, classes }) {
  const w = world(k);
  const ids = classes.flatMap((c) => c.studentIds);
  if (!ids.length) return;
  // An announced rent change starts this month (module-wide: one statement).
  k.db.prepare('UPDATE housing_listings SET rent_cents = pending_rent_cents, pending_rent_cents = NULL, rent_from = NULL WHERE world_id = ? AND rent_from <= ?').run(w.id, month);
  const rows = k.db.prepare('SELECT * FROM housing_tenure WHERE world_id = ? AND player_id IN (SELECT value FROM json_each(?)) ORDER BY player_id').all(w.id, JSON.stringify(ids));
  const homes = new Map();
  for (const h of k.db.prepare("SELECT * FROM housing_homes WHERE world_id = ? AND status = 'owned' ORDER BY role = 'rental', id").all(w.id)) (homes.get(h.player_id) ?? homes.set(h.player_id, []).get(h.player_id)).push(h);
  // Students living in (or moving into or out of) a classmate's unit first: their rent reaches the landlord before the landlord's own mortgage debit.
  const unitish = (r) => unitIdOf(r.tenure) !== null || (unitIdOf(r.pending_tenure) !== null && r.pending_from <= month);
  const first = rows.filter(unitish), rest = rows.filter((r) => !unitish(r));
  for (const pass of [first, rest]) k.forEachPlayer(pass, (row) => monthFor(k, w, month, row, homes), (row) => row.player_id);   // each student in its own savepoint
}

