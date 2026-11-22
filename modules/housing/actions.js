// housing: student actions (set tenure, buy, sell, catch up) and the landlord routes (list, unlist, change rent, end tenancy).
import { money } from '../../lib/kernel.js';
import { LEGAL_FEE_CENTS, COMMISSION_PCT, RENT_MIN_PCT, RENT_MAX_PCT, RENT_NOTICE_MONTHS, END_NOTICE_MONTHS } from './constants.js';
import { payment, qualify } from './mortgage.js';
import { world, rental, depositFor, property, termMonths, rentBand, tenureRow, homesOf, homeAs, chequingOf, mortKind, mortAcct, debtOf, depositOf, unitIdOf, listingOf, announce, quote } from './reads.js';
import { leaveUnit, dropTenant } from './tick.js';

// ---- actions ----
// Student rent moves money between classmates, so it follows the class's bank-basic switch for transfers (the 60-150% band is the cap otherwise).
export const RENT_OFF = 'Payments between classmates are turned off for your class (Bank settings), so renting to or from a classmate is closed. Ask your teacher.';
export const studentRentOn = (k, classId) => !k.modules.has('bank-basic') || k.modules.call('bank-basic', 'transfersEnabled', { classId }).enabled === true;
export const changed = (k, tx, user) => tx.onCommit(() => k.events.emit('changed', { classId: user.class_id }));

export function setTenure(k, user, target) {
  const w = world(k);
  if (homeAs(k, user.id, w.id, 'primary')) throw new k.HttpError(409, 'You own a home. Sell it first, then you can move.');
  const unit = unitIdOf(target);
  if (unit === null && target !== 'shared' && !rental(target)) throw new k.HttpError(400, 'Choose living with your parents, a shared room, an apartment (with or without a roommate), a classmate\'s unit, or buy from the Buy tab');
  return k.db.txn((tx) => {
    const row = tenureRow(k, user.id, w.id);
    const current = row?.tenure ?? 'shared';
    if (current === target && !row?.pending_tenure) throw new k.HttpError(400, 'You already live there');
    if (unit !== null && current === target && listingOf(k, unit)?.notice_month != null) throw new k.HttpError(409, 'Your landlord has ended your tenancy: you move out at the end of the notice.');
    // A reservation this request replaces is released first (Y -> Z, or Y -> anything else), as a vacancy: an announced rent change applies at once.
    const was = unitIdOf(row?.pending_tenure);
    if (was !== null && row.pending_tenure !== target) { const l = listingOf(k, was); if (l?.tenant_id === user.id) leaveUnit(k, l, w.month, 'cancelled'); }
    if (unit !== null && current !== target && row?.pending_tenure !== target) {   // a new reservation: one tenant per unit
      if (homesOf(k, user.id, w.id).length) throw new k.HttpError(409, 'You own a home, so you cannot rent a classmate\'s unit.');
      const l = listingOf(k, unit);
      if (!l || l.world_id !== w.id || l.status !== 'owned' || !l.listed || k.players.classOf(l.landlord_id)?.id !== k.players.classOf(user.id)?.id) throw new k.HttpError(404, 'That unit is not for rent');
      if (l.landlord_id === user.id) throw new k.HttpError(400, 'You cannot rent your own unit');
      if (l.tenant_id !== null) throw new k.HttpError(409, 'Someone has already rented that unit');
      if (!studentRentOn(k, k.players.classOf(user.id)?.id)) throw new k.HttpError(409, RENT_OFF);
      // A tenant may hold the unit they live in (left at pending_from) and one reservation; nothing else (a code check: the index allows the two).
      const held = k.db.prepare('SELECT home_id FROM housing_listings WHERE world_id = ? AND tenant_id = ?').all(w.id, user.id).map((r) => r.home_id).filter((id) => `unit:${id}` !== current);
      if (held.length) throw new k.HttpError(409, 'You already hold another unit');
      k.db.prepare('UPDATE housing_listings SET tenant_id = ?, since_month = ? WHERE home_id = ? AND tenant_id IS NULL').run(user.id, w.month + 1, unit);
    }
    const need = depositFor(target) - depositOf(k, user.id);
    if (need > 0) {
      const chq = chequingOf(k, user.id), bal = k.ledger.balance(chq);
      if (bal < need) throw new k.HttpError(400, `Not enough in chequing for the damage deposit: it is ${money(need)} and you have ${money(bal)}. The deposit is refunded when you move out.`);
      const dep = k.ledger.openAccount({ ownerType: 'player', ownerId: user.id, kind: 'deposit' });
      k.ledger.post({ kind: 'deposit', actor: `player:${user.id}`, legs: [{ account: chq, cents: -need, memo: 'Damage deposit' }, { account: dep, cents: need, memo: 'Damage deposit' }] });
    }
    if (current === target) {            // changed their mind: cancel the pending move
      k.db.prepare('UPDATE housing_tenure SET pending_tenure = NULL, pending_from = NULL WHERE player_id = ? AND world_id = ?').run(user.id, w.id);
    } else {
      k.db.prepare(`INSERT INTO housing_tenure (player_id, world_id, tenure, pending_tenure, pending_from, since_month) VALUES (?, ?, 'shared', ?, ?, ?)
        ON CONFLICT (player_id, world_id) DO UPDATE SET pending_tenure = excluded.pending_tenure, pending_from = excluded.pending_from`).run(user.id, w.id, target, w.month + 1, w.month);
    }
    changed(k, tx, user);
    return { ok: true, tenure: target, starts_month: w.month + 1 };
  });
}

export function buy(k, user, downCents, amortMonths, propId = 'average', role = 'primary') {
  const w = world(k);
  if (homeAs(k, user.id, w.id, role)) throw new k.HttpError(409, role === 'rental' ? 'You already own a rental' : 'You already own a home');
  const row = tenureRow(k, user.id, w.id);
  if (role === 'rental' && (unitIdOf(row?.tenure) !== null || unitIdOf(row?.pending_tenure) !== null)) throw new k.HttpError(409, 'You rent a classmate\'s unit: move out first, then you can buy a rental.');
  const q = quote(k, user.id, downCents, amortMonths, propId, role);
  if (!q.ok) throw new k.HttpError(400, `You do not qualify yet: ${q.reasons.join(' ')}`);
  // A tenant who buys their own home leaves the unit now: rent arrears are paid first, so the purchase cannot leave them unpaid.
  const units = role === 'primary' ? [row?.tenure, row?.pending_tenure].map(unitIdOf).filter((u) => u !== null).map((u) => listingOf(k, u)).filter((l) => l?.tenant_id === user.id) : [];
  const arrears = units.reduce((t, l) => t + l.arrears_cents, 0);
  const chq = chequingOf(k, user.id), bal = k.ledger.balance(chq);
  if (bal < q.cashNeededCents + arrears) throw new k.HttpError(400, `Not enough in chequing: the down payment and closing costs are ${money(q.cashNeededCents)}${arrears ? ` and you owe ${money(arrears)} in rent` : ''}, and you have ${money(bal)}.`);
  return k.db.txn((tx) => {
    for (const l of units) leaveUnit(k, l, w.month, 'moved');                    // collects the arrears in full (checked above)
    const home = Number(k.db.prepare(`INSERT INTO housing_homes (player_id, world_id, price_cents, down_cents, premium_cents, loan_cents, rate_bp, amort_months, amort_left, term_months, term_start, payment_cents, value_cents, bought_month, first_time, property, role)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(user.id, w.id, q.priceCents, downCents, q.premiumCents, q.loanCents, q.contractBp, amortMonths, amortMonths, termMonths(k), w.month, q.paymentCents, q.priceCents, w.month, q.firstTime ? 1 : 0, propId, role).lastInsertRowid);
    const mort = k.ledger.openAccount({ ownerType: 'player', ownerId: user.id, kind: mortKind({ id: home, role }), allowNegative: true });
    // The seller, the lawyer and the insurer are outside the town: the whole price, premium and closing costs go to the sink.
    k.ledger.post({
      kind: 'purchase', actor: `player:${user.id}`, meta: { price: q.priceCents, down: downCents, loan: q.loanCents, premium: q.premiumCents, closing: q.closingCents, homeId: home, role },
      legs: [{ account: chq, cents: -q.cashNeededCents, memo: 'Down payment and closing costs' }, { account: mort, cents: -q.loanCents, memo: 'New mortgage' }, { account: k.ledger.system('sink'), cents: q.cashNeededCents + q.loanCents, memo: role === 'rental' ? 'Rental condo purchase' : 'Condo purchase' }],
    });
    if (role === 'primary') {                                                   // a classmate's unit was left above (now, or a reservation cancelled)
      k.db.prepare(`INSERT INTO housing_tenure (player_id, world_id, tenure, since_month) VALUES (?, ?, 'own', ?)
        ON CONFLICT (player_id, world_id) DO UPDATE SET tenure = 'own', pending_tenure = NULL, pending_from = NULL, since_month = excluded.since_month`).run(user.id, w.id, w.month);
    }
    k.audit('buy', { playerId: user.id, property: propId, price: q.priceCents, loan: q.loanCents, role }, `player:${user.id}`);
    tx.onCommit(() => announce(k, user.id, w.id));
    changed(k, tx, user);
    return { ok: true, home_id: home, role, payment_cents: q.paymentCents, loan_cents: q.loanCents, first_payment_month: w.month + 1 };
  });
}

// The sale: the buyer is outside the town, so proceeds come from the mint (as pay does) and the commission and legal fees never enter it.
export function sale(k, h) {
  const commission = Math.round((h.value_cents * COMMISSION_PCT) / 100), legal = LEGAL_FEE_CENTS;
  const debt = debtOf(k, h);
  const net = h.value_cents - commission - legal - debt;
  return { valueCents: h.value_cents, commissionCents: commission, legalCents: legal, debtCents: debt, netCents: net };
}

// The student's own owned home: by id when given (404 when it is not theirs), else the primary (old clients), else their only home.
export function ownHome(k, user, w, homeId) {
  if (homeId !== undefined) {
    const h = k.db.prepare("SELECT * FROM housing_homes WHERE id = ? AND player_id = ? AND world_id = ? AND status = 'owned'").get(homeId, user.id, w.id);
    if (!h) throw new k.HttpError(404, 'Home not found');
    return h;
  }
  return homesOf(k, user.id, w.id)[0];
}

export function sell(k, user, homeId) {
  const w = world(k);
  const h = ownHome(k, user, w, homeId);
  if (!h) throw new k.HttpError(400, 'You do not own a home');
  const s = sale(k, h);
  const chq = chequingOf(k, user.id);
  if (s.netCents < 0 && k.ledger.balance(chq) < -s.netCents) throw new k.HttpError(400, `The sale would leave you owing ${money(-s.netCents)} on the mortgage and you only have ${money(k.ledger.balance(chq))} in chequing.`);
  return k.db.txn((tx) => {
    const mort = mortAcct(k, h);
    const proceeds = s.valueCents - s.commissionCents - s.legalCents;
    k.ledger.post({
      kind: 'sale', actor: `player:${user.id}`, meta: { value: s.valueCents, commission: s.commissionCents, legal: s.legalCents, debt: s.debtCents, homeId: h.id, role: h.role },
      legs: [{ account: k.ledger.system('mint'), cents: -proceeds, memo: 'Condo sold' }, ...(s.debtCents > 0 ? [{ account: mort, cents: s.debtCents, memo: 'Mortgage paid out' }] : []), { account: chq, cents: s.netCents, memo: 'Sale proceeds after commission, legal fees and the mortgage' }].filter((l) => l.cents !== 0),
    });
    k.db.prepare("UPDATE housing_homes SET status = 'sold', sold_month = ?, sold_net_cents = ?, payment_cents = 0, arrears_cents = 0, missed_streak = 0 WHERE id = ?").run(w.month, s.netCents, h.id);
    if (h.role === 'primary') k.db.prepare("UPDATE housing_tenure SET tenure = 'shared', pending_tenure = NULL, pending_from = NULL, since_month = ? WHERE player_id = ? AND world_id = ?").run(w.month, user.id, w.id);
    else {                                                                         // a rental: the tenancy ends at the sale, the listing comes down
      const l = listingOf(k, h.id);
      if (l?.tenant_id) {
        const tenant = l.tenant_id, lived = tenureRow(k, tenant, w.id)?.tenure === `unit:${h.id}`;
        dropTenant(k, l, w.id, w.month, 'sold');
        if (lived) tx.onCommit(() => k.events.emit('moved', { playerId: tenant, worldId: w.id, month: w.month, tenure: 'shared', name: 'a shared room' }));
      }
      if (l) k.db.prepare('UPDATE housing_listings SET listed = 0 WHERE home_id = ?').run(h.id);
    }
    k.audit('sell', { playerId: user.id, net: s.netCents, homeId: h.id, role: h.role }, `player:${user.id}`);
    tx.onCommit(() => announce(k, user.id, w.id));
    changed(k, tx, user);
    return { ok: true, home_id: h.id, role: h.role, ...Object.fromEntries(Object.entries(s).map(([a, b]) => [a.replace(/Cents$/, '_cents'), b])) };
  });
}

export function catchUp(k, user, homeId) {
  const w = world(k);
  const h = homeId !== undefined ? ownHome(k, user, w, homeId) : homesOf(k, user.id, w.id).find((x) => x.arrears_cents > 0);
  if (!h || h.arrears_cents <= 0) throw new k.HttpError(400, 'You are not behind on your mortgage');
  const chq = chequingOf(k, user.id), bal = k.ledger.balance(chq);
  if (bal < h.arrears_cents) throw new k.HttpError(400, `Not enough in chequing: you owe ${money(h.arrears_cents)} in arrears and have ${money(bal)}.`);
  return k.db.txn((tx) => {
    // The interest for the missed months was already added to the debt, so catching up is all principal.
    k.ledger.post({ kind: 'mortgage_payment', actor: `player:${user.id}`, meta: { month: w.month, arrears: h.arrears_cents, homeId: h.id },
      legs: [{ account: chq, cents: -h.arrears_cents, memo: 'Mortgage arrears' }, { account: mortAcct(k, h), cents: h.arrears_cents, memo: 'Mortgage arrears' }] });
    k.db.prepare('UPDATE housing_homes SET arrears_cents = 0 WHERE id = ?').run(h.id);
    changed(k, tx, user);
    return { ok: true, paid_cents: h.arrears_cents };
  });
}

// ---- landlord routes (6b) ----
// The student's own rental (404 for anyone else's home, a primary, or a sold one), with its listing if there is one.
export function myRental(k, user, homeId) {
  const w = k.world.active();
  const h = k.db.prepare("SELECT * FROM housing_homes WHERE id = ? AND player_id = ? AND world_id = ? AND status = 'owned' AND role = 'rental'").get(homeId, user.id, w.id);
  if (!h) throw new k.HttpError(404, 'Rental not found');
  return { w, h, l: listingOf(k, homeId) };
}
export function checkRent(k, propId, cents) {
  const b = rentBand(k, propId);
  if (cents < b.minCents || cents > b.maxCents) throw new k.HttpError(400, `Rent must be between ${money(b.minCents)} and ${money(b.maxCents)} a month (${RENT_MIN_PCT}% to ${RENT_MAX_PCT}% of the ${money(b.tierCents)} the same kind of apartment rents for).`);
}

export function list(k, user, homeId, cents) {
  const { w, h, l } = myRental(k, user, homeId);
  if (l?.listed) throw new k.HttpError(409, 'It is already listed: change the rent instead');
  if (!studentRentOn(k, k.players.classOf(user.id)?.id)) throw new k.HttpError(409, RENT_OFF);
  checkRent(k, h.property, cents);
  return k.db.txn((tx) => {
    k.db.prepare(`INSERT INTO housing_listings (home_id, world_id, rent_cents, listed, since_month) VALUES (?, ?, ?, 1, ?)
      ON CONFLICT (home_id) DO UPDATE SET listed = 1, rent_cents = excluded.rent_cents, pending_rent_cents = NULL, rent_from = NULL, since_month = CASE WHEN tenant_id IS NULL THEN excluded.since_month ELSE since_month END`).run(h.id, w.id, cents, w.month);
    k.audit('list', { playerId: user.id, homeId: h.id, rent: cents }, `player:${user.id}`);
    tx.onCommit(() => k.events.emit('listed', { playerId: user.id, worldId: w.id, month: w.month, homeId: h.id, rentCents: cents }));
    changed(k, tx, user);
    return { ok: true, home_id: h.id, rent_cents: cents };
  });
}

export function unlist(k, user, homeId) {
  const { h, l } = myRental(k, user, homeId);
  if (!l?.listed) throw new k.HttpError(400, 'It is not listed');
  if (l.tenant_id !== null) throw new k.HttpError(409, 'Someone rents it: end the tenancy first');
  return k.db.txn((tx) => {
    k.db.prepare('UPDATE housing_listings SET listed = 0 WHERE home_id = ?').run(h.id);
    changed(k, tx, user);
    return { ok: true, home_id: h.id };
  });
}

// A new rent: at once while the unit is empty, with two months' notice when someone lives there (or has reserved it).
export function changeRent(k, user, homeId, cents) {
  const { w, h, l } = myRental(k, user, homeId);
  if (!l?.listed) throw new k.HttpError(400, 'List it first');
  checkRent(k, h.property, cents);
  if (cents === (l.pending_rent_cents ?? l.rent_cents)) throw new k.HttpError(400, 'That is already the rent');
  const from = l.tenant_id === null ? w.month : w.month + RENT_NOTICE_MONTHS;
  return k.db.txn((tx) => {
    if (l.tenant_id === null) k.db.prepare('UPDATE housing_listings SET rent_cents = ?, pending_rent_cents = NULL, rent_from = NULL WHERE home_id = ?').run(cents, h.id);
    else k.db.prepare('UPDATE housing_listings SET pending_rent_cents = ?, rent_from = ? WHERE home_id = ?').run(cents, from, h.id);
    k.audit('rent', { playerId: user.id, homeId: h.id, rent: cents, from }, `player:${user.id}`);
    tx.onCommit(() => k.events.emit('rent_changed', { playerId: user.id, worldId: w.id, month: w.month, homeId: h.id, rentCents: cents, oldCents: l.rent_cents, fromMonth: from, tenanted: l.tenant_id !== null }));
    changed(k, tx, user);
    return { ok: true, home_id: h.id, rent_cents: cents, from_month: from };
  });
}

// One month's notice to a tenant who lives there; a reservation (not moved in yet) is cancelled at once.
export function endTenancy(k, user, homeId) {
  const { w, h, l } = myRental(k, user, homeId);
  if (!l?.tenant_id) throw new k.HttpError(400, 'Nobody rents it');
  if (l.notice_month !== null) throw new k.HttpError(409, `Notice already given: they move out in world month ${l.notice_month}`);
  return k.db.txn((tx) => {
    const lives = tenureRow(k, l.tenant_id, w.id)?.tenure === `unit:${h.id}`;
    if (lives) k.db.prepare('UPDATE housing_listings SET notice_month = ? WHERE home_id = ?').run(w.month + END_NOTICE_MONTHS, h.id);
    else dropTenant(k, l, w.id, w.month, 'cancelled');
    k.audit('end_tenancy', { playerId: user.id, homeId: h.id, tenantId: l.tenant_id }, `player:${user.id}`);
    changed(k, tx, user);
    return { ok: true, home_id: h.id, moves_out_month: lives ? w.month + END_NOTICE_MONTHS : w.month };
  });
}

