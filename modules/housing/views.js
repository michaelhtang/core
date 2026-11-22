// housing: read models (home, listing, market, state views), the market move, and the today/bot read helpers.
import { RENTALS, AMORT_DEFAULT_YEARS, AMORT_LONG_YEARS, COMMISSION_PCT, MARKET_EVENT_MIN_PCT, MARKET_EVENT_MAX_PCT, SOURCES_CHECKED, RENTAL_DOWN_PCT, RENT_INCOME_PCT, EVICT_AFTER_MISSED } from './constants.js';
import { interestFor, schedule } from './mortgage.js';
import { world, px, PROPERTIES, property, termMonths, rentBand, mortgageBp, tenureRow, homesOf, chequingOf, debtOf, depositOf, firstTime, unitIdOf, listingOf, nameOf, announce, ownCosts, quote } from './reads.js';
import { studentRentOn, sale } from './actions.js';

// ---- read models ----
export function homeView(k, user, w, h) {
  const debt = debtOf(k, h);
  const interest = interestFor(debt, h.rate_bp);
  const nextPay = Math.min(h.payment_cents, debt + interest);
  const rows = schedule(debt, h.rate_bp, Math.max(1, h.amort_left), h.payment_cents).map((r) => [r.n, r.interest, r.principal, r.balance]);
  const renewals = k.db.prepare('SELECT month, old_bp, new_bp, old_payment, new_payment, balance_cents FROM housing_renewals WHERE home_id = ? ORDER BY id').all(h.id);
  const s = sale(k, h);
  return {
    id: h.id, role: h.role, price_cents: h.price_cents, down_cents: h.down_cents, premium_cents: h.premium_cents, original_loan_cents: h.loan_cents, value_cents: h.value_cents, balance_cents: debt,
    equity_cents: h.value_cents - debt, rate_bp: h.rate_bp, payment_cents: h.payment_cents, next_interest_cents: interest, next_principal_cents: Math.max(0, nextPay - interest),
    amort_months: h.amort_months, amort_left: h.amort_left, bought_month: h.bought_month, term_start: h.term_start, term_months: h.term_months, renewal_month: h.term_start + h.term_months,
    arrears_cents: h.arrears_cents, missed_streak: h.missed_streak, missed_total: h.missed_total, costs: ownCosts(k, h.value_cents, h.property), property: h.property, property_name: property(k, h.property)?.name ?? 'Condo',
    schedule: rows, renewals, last_renewal: renewals.at(-1) ?? null,
    payments: k.db.prepare('SELECT month, interest_cents, principal_cents, arrears_paid_cents, balance_cents, status FROM housing_payments WHERE home_id = ? ORDER BY month DESC LIMIT 12').all(h.id),
    sale: { value_cents: s.valueCents, commission_cents: s.commissionCents, legal_cents: s.legalCents, debt_cents: s.debtCents, net_cents: s.netCents, commission_pct: COMMISSION_PCT },
  };
}

// Landlord reputation (this world): rent months received on time minus months missed, over every unit the landlord has let.
export const reputation = (k, landlordId, worldId) => k.db.prepare(`SELECT COALESCE(SUM(CASE r.status WHEN 'paid' THEN 1 ELSE -1 END), 0) AS n FROM housing_rent r JOIN housing_homes h ON h.id = r.home_id
  WHERE h.player_id = ? AND r.world_id = ?`).get(landlordId, worldId).n;

export function listingView(k, l, month) {
  const band = rentBand(k, l.property);
  const tenant = l.tenant_id === null ? null : nameOf(k, l.tenant_id);
  return { home_id: l.home_id, listed: !!l.listed, rent_cents: l.rent_cents, npc_cents: band.tierCents, min_cents: band.minCents, max_cents: band.maxCents, pending_rent_cents: l.pending_rent_cents, rent_from: l.rent_from,
    tenant, moving_in: l.tenant_id !== null && l.since_month > month, arrears_cents: l.arrears_cents, missed_streak: l.missed_streak, notice_month: l.notice_month,
    months_vacant: l.tenant_id === null ? Math.max(0, month - l.since_month) : 0, evictions: l.evictions, written_off_cents: l.written_off_cents };
}

// The rent market: the NPC tiers, and classmates' vacant listed units (same class only: a teacher sees every class in the teacher panel).
export function market(k, user) {
  const w = world(k);
  const mates = k.players.classOf(user.id) ? k.players.inClass(k.players.classOf(user.id).id).map((s) => s.id) : [];
  const tiers = RENTALS.map((r) => ({ id: r.id, name: r.name, rent_cents: px(k, r.rentCents), deposit_cents: r.depositCents ?? r.rentCents }));
  const listings = k.db.prepare(`SELECT l.*, h.player_id AS landlord_id, h.property, h.status FROM housing_listings l JOIN housing_homes h ON h.id = l.home_id
    WHERE l.world_id = ? AND l.listed = 1 AND l.tenant_id IS NULL AND h.status = 'owned' AND h.player_id <> ? AND h.player_id IN (SELECT value FROM json_each(?)) ORDER BY l.rent_cents, l.home_id`)
    .all(w.id, user.id, JSON.stringify(mates))
    .map((l) => ({ home_id: l.home_id, tenure: `unit:${l.home_id}`, landlord: nameOf(k, l.landlord_id), property_name: property(k, l.property)?.name ?? 'Condo', rent_cents: l.rent_cents, npc_cents: rentBand(k, l.property).tierCents,
      months_vacant: Math.max(0, w.month - l.since_month), reputation: reputation(k, l.landlord_id, w.id) }));
  return { month: w.month, tiers, listings };
}

export function state(k, user) {
  const w = world(k), month = w.month;
  const row = tenureRow(k, user.id, w.id);
  const homes = homesOf(k, user.id, w.id);
  const h = homes.find((x) => x.role === 'primary'), rh = homes.find((x) => x.role === 'rental');
  const chq = chequingOf(k, user.id);
  const entry = (r) => ({ id: r.id, name: r.name, rent_cents: px(k, r.rentCents), deposit_cents: r.depositCents ?? r.rentCents, note: r.note });
  const cat = [...RENTALS.filter((r) => r.id === 'parents').map(entry), { id: 'shared', name: 'Shared room', rent_cents: 0, deposit_cents: 0, note: 'The bills default: your rent is the shared-room line in Bills.' },
    ...RENTALS.filter((r) => r.id !== 'parents').map(entry)];
  const offer = (p, role = 'primary') => {
    const min = role === 'rental' ? Math.ceil((p.priceCents * RENTAL_DOWN_PCT) / 100) : quote(k, user.id, 0, AMORT_DEFAULT_YEARS * 12, p.id).minDownCents;
    const q = quote(k, user.id, min, AMORT_DEFAULT_YEARS * 12, p.id, role);
    return { id: p.id, name: p.name, note: p.note, price_cents: q.priceCents, min_down_cents: min, first_time: q.firstTime, long_amort_allowed: q.longAmortAllowed, gross_monthly_cents: q.grossMonthlyCents, card_minimum_cents: q.otherDebtCents,
      mortgage_bp: q.contractBp, qualifying_bp: q.qualifyingBp, property_tax_cents: q.propertyTaxCents, heating_cents: q.heatingCents, condo_fee_cents: q.condoFeeCents, insurance_cents: ownCosts(k, q.priceCents, p.id).insuranceCents,
      quote: q, amort_options: [AMORT_DEFAULT_YEARS * 12, AMORT_LONG_YEARS * 12], ...(role === 'rental' && { npc_rent_cents: rentBand(k, p.id).tierCents }) };
  };
  const properties = h ? [] : PROPERTIES(k).map((p) => offer(p));
  const tenure = h ? 'own' : row?.tenure ?? 'shared';
  const unitId = unitIdOf(tenure) ?? unitIdOf(row?.pending_tenure);
  const u = unitId !== null ? listingOf(k, unitId) : null;
  const canRental = !rh && !firstTime(k, user.id, w.id) && unitId === null;
  return {
    month, chequing_cents: chq ? k.ledger.balance(chq) : 0, tenure, pending_tenure: row?.pending_tenure ?? null, pending_from: row?.pending_from ?? null,
    deposit_cents: depositOf(k, user.id), catalogue: cat, home: h ? homeView(k, user, w, h) : null,
    buy: h ? null : { ...properties[0], properties },          // top level = the average condo (kept for old clients); `properties` lists both
    // 6b: the rental and its listing; a classmate's unit the student rents (or has reserved); the rental offers when they may buy one
    rental: rh ? { ...homeView(k, user, w, rh), listing: (() => { const l = listingOf(k, rh.id); return l ? listingView(k, l, month) : null; })(), band: rentBand(k, rh.property) } : null,
    unit: u && u.tenant_id === user.id ? { home_id: u.home_id, tenure: `unit:${u.home_id}`, landlord: nameOf(k, u.landlord_id), property_name: property(k, u.property)?.name ?? 'Condo', rent_cents: u.rent_cents,
      pending_rent_cents: u.pending_rent_cents, rent_from: u.rent_from, arrears_cents: u.arrears_cents, missed_streak: u.missed_streak, evict_after: EVICT_AFTER_MISSED, notice_month: u.notice_month, moving_in: unitIdOf(tenure) === null } : null,
    student_rent: studentRentOn(k, k.players.classOf(user.id)?.id),   // the class allows rent between classmates (bank-basic transfers on)
    buy_rental: canRental ? { properties: PROPERTIES(k).map((p) => offer(p, 'rental')), down_pct: RENTAL_DOWN_PCT, rent_income_pct: RENT_INCOME_PCT } : null,
    mortgage_bp: mortgageBp(k, w.id), term_months: termMonths(k), checked: SOURCES_CHECKED,
    past_homes: k.db.prepare("SELECT price_cents, bought_month, sold_month, sold_net_cents, role FROM housing_homes WHERE player_id = ? AND world_id = ? AND status = 'sold' ORDER BY id").all(user.id, w.id),
  };
}

// A housing market event: every home in the world moves by pct (-15..-5 or +5..+15) at once (the teacher's POST /market and the marketEvent service).
// module.housing.value for each owner (the sum of their homes) and module.housing.market once: after the teacher's commit, or (by: null, a service call
// that may run inside an advance) at once, inside the caller's transaction, so a later tick's value is never overwritten by this one after commit.
export function marketMove(k, pct, by, classId = null) {
  if (!Number.isSafeInteger(pct) || Math.abs(pct) < MARKET_EVENT_MIN_PCT || Math.abs(pct) > MARKET_EVENT_MAX_PCT) throw new k.HttpError(400, `A market event moves prices by ${MARKET_EVENT_MIN_PCT} to ${MARKET_EVENT_MAX_PCT} percent, up or down`);
  const w = k.world.active();   // 409 between seasons: the season's homes have ended
  return k.db.txn((tx) => {
    const later = by == null ? (fn) => fn() : (fn) => tx.onCommit(fn);
    const homes = k.db.prepare("SELECT id, player_id, value_cents FROM housing_homes WHERE world_id = ? AND status = 'owned'").all(w.id);
    for (const h of homes) k.db.prepare('UPDATE housing_homes SET value_cents = ? WHERE id = ?').run(Math.round((h.value_cents * (100 + pct)) / 100), h.id);
    for (const pid of new Set(homes.map((h) => h.player_id))) later(() => announce(k, pid, w.id));
    k.db.prepare('INSERT INTO housing_market (world_id, month, pct, by_player, created) VALUES (?, ?, ?, ?, ?)').run(w.id, w.month, pct, by, k.clock.now());
    k.audit('market', { worldId: w.id, pct, homes: homes.length }, by == null ? 'system' : `player:${by}`);
    later(() => k.events.emit('market', { worldId: w.id, month: w.month, pct }));
    tx.onCommit(() => k.events.emit('changed', { classId }));
    return { pct, homes: homes.length, month: w.month };
  });
}

// The Today card's facts (modules/today): read-only.
export const todayFacts = (k, { playerId }) => ({ owns: homesOf(k, playerId, k.world.current().id).length > 0 });

// Bots (scripts/sim.mjs): the cheapest vacant unit in each class, for the renter bots.
export function vacantByClass(k, w) {
  const out = new Map();
  for (const l of k.db.prepare(`SELECT l.home_id, l.rent_cents, h.player_id AS landlord_id FROM housing_listings l JOIN housing_homes h ON h.id = l.home_id
    WHERE l.world_id = ? AND l.listed = 1 AND l.tenant_id IS NULL AND h.status = 'owned' ORDER BY l.rent_cents, l.home_id`).all(w.id)) {
    const c = k.players.classOf(l.landlord_id)?.id;
    if (c !== undefined) (out.get(c) ?? out.set(c, []).get(c)).push(l);
  }
  return out;
}
