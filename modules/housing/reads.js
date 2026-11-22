// housing: small shared reads and helpers (world, config, properties, tenure/home/ledger lookups, quote) the other housing files build on.
import { RENTALS, STARTER_PRICE_CENTS, STARTER_FEE_CENTS, STARTER_HEATING_CENTS, CONDO_PRICE_CENTS, MAX_PRICE_CENTS, CONDO_FEE_CENTS, HOME_INSURANCE_CENTS, HEATING_CENTS, AMORT_DEFAULT_YEARS, TERM_MONTHS, INCOME_WINDOW_MONTHS, LEGAL_FEE_CENTS, DRIFT_BP, DEFAULT_MORTGAGE_BP, RENTAL_DOWN_PCT, RENT_INCOME_PCT, RENT_MIN_PCT, RENT_MAX_PCT, RENT_TIER } from './constants.js';
import { qualify, closingCosts, propertyTaxMonthly } from './mortgage.js';

export const world = (k) => k.world.current();
export const rental = (id) => RENTALS.find((r) => r.id === id);
export const cfg = (k, key, dflt) => (Number.isSafeInteger(k.config[key]) && k.config[key] > 0 ? k.config[key] : dflt);
// The world price index (k.world.priceIndex(); 10000 = none, also when rates is not loaded). Rents, the parents' contribution, condo fees,
// heating, home insurance and NEW purchase prices follow it; a home already bought keeps its own value (drift), and the damage deposit stays at the base rent.
export const px = (k, cents) => Math.round((cents * k.world.priceIndex()) / 10000);
export const depositFor = (id) => { const r = rental(id); return r ? r.depositCents ?? r.rentCents : 0; };   // parents: none; a roommate: one month of your half; a classmate's unit: none
// The two properties for sale. condoPriceCents / condoFeeCents / heatingCents set the average condo; starterPriceCents / starterFeeCents the older 1-bedroom.
export const PROPERTIES = (k) => [
  { id: 'average', name: 'Average Edmonton condo', note: 'The 2026 Edmonton average condo sale price.', priceCents: Math.min(px(k, cfg(k, 'condoPriceCents', CONDO_PRICE_CENTS)), MAX_PRICE_CENTS), feeCents: px(k, cfg(k, 'condoFeeCents', CONDO_FEE_CENTS)), heatingCents: px(k, cfg(k, 'heatingCents', HEATING_CENTS)) },
  { id: 'starter', name: 'Older 1-bedroom condo (starter)', note: 'An older Edmonton 1-bedroom: lower price, higher condo fee (it includes heat, water and power).', priceCents: Math.min(px(k, cfg(k, 'starterPriceCents', STARTER_PRICE_CENTS)), MAX_PRICE_CENTS), feeCents: px(k, cfg(k, 'starterFeeCents', STARTER_FEE_CENTS)), heatingCents: px(k, STARTER_HEATING_CENTS) },
];
export const propOf = (k, body) => (body?.property === undefined ? 'average' : k.input.str(body, 'property', { max: 20 }));
export const roleOf = (k, body) => { const r = body?.role === undefined ? 'primary' : k.input.str(body, 'role', { max: 10 }); if (r !== 'primary' && r !== 'rental') throw new k.HttpError(400, "role must be 'primary' or 'rental'"); return r; };
export const property = (k, id) => PROPERTIES(k).find((p) => p.id === id);
export const termMonths = (k) => cfg(k, 'termMonths', TERM_MONTHS);
export const driftBp = (k) => (Number.isSafeInteger(k.config.driftBp) && k.config.driftBp >= -1000 && k.config.driftBp <= 1000 ? k.config.driftBp : DRIFT_BP);

// The NPC rent a property compares with (starter -> 1-bedroom, average -> 2-bedroom) at today's prices, and the 60-150% band a student's rent must sit in.
// The one definition: the routes and the bots both use it.
export const rentBand = (k, propId) => {
  const tier = px(k, rental(RENT_TIER[propId] ?? 'apt2').rentCents);
  return { tierCents: tier, minCents: Math.ceil((tier * RENT_MIN_PCT) / 100), maxCents: Math.floor((tier * RENT_MAX_PCT) / 100) };
};

export const mortgageBp = (k, worldId) => k.db.prepare('SELECT mortgage5y_bp FROM housing_rates WHERE world_id = ?').get(worldId)?.mortgage5y_bp ?? DEFAULT_MORTGAGE_BP;
// The 5-year rate a lender offers on a NEW mortgage: the announced (pending) rate when there is one, else the rate in force.
export const pendingBp = (k, worldId) => k.db.prepare('SELECT mortgage5y_bp FROM housing_rates_pending WHERE world_id = ?').get(worldId)?.mortgage5y_bp;
export const offerBp = (k, worldId) => pendingBp(k, worldId) ?? mortgageBp(k, worldId);
export const tenureRow = (k, playerId, worldId) => k.db.prepare('SELECT * FROM housing_tenure WHERE player_id = ? AND world_id = ?').get(playerId, worldId);
// Owned homes, primary first. homeAs: the one home of a role (the unique index allows one each).
export const homesOf = (k, playerId, worldId) => k.db.prepare("SELECT * FROM housing_homes WHERE player_id = ? AND world_id = ? AND status = 'owned' ORDER BY role = 'rental', id").all(playerId, worldId);
export const homeAs = (k, playerId, worldId, role) => k.db.prepare("SELECT * FROM housing_homes WHERE player_id = ? AND world_id = ? AND status = 'owned' AND role = ?").get(playerId, worldId, role);
export const chequingOf = (k, playerId) => k.ledger.accountId('player', playerId, 'chequing');
// Each home's own mortgage account: the primary keeps 'mortgage' (data from before 6b), a rental 'mortgage:<homeId>' (prefix-matched like 'gic:').
export const mortKind = (h) => (h.role === 'rental' ? `mortgage:${h.id}` : 'mortgage');
export const mortAcct = (k, h) => k.ledger.accountId('player', h.player_id, mortKind(h));
export const debtOf = (k, h) => { const a = mortAcct(k, h); return a ? Math.max(0, -k.ledger.balance(a)) : 0; };
export const depositOf = (k, playerId) => { const a = k.ledger.accountId('player', playerId, 'deposit'); return a ? k.ledger.balance(a) : 0; };
export const cardMinimum = (k, playerId, worldId) => k.db.prepare('SELECT minimum_cents FROM housing_card WHERE player_id = ? AND world_id = ?').get(playerId, worldId)?.minimum_cents ?? 0;
export const avgGross = (k, playerId, worldId, month) => Math.floor(k.db.prepare('SELECT COALESCE(SUM(gross_cents), 0) AS n FROM housing_income WHERE player_id = ? AND world_id = ? AND month > ? AND month <= ?')
  .get(playerId, worldId, month - INCOME_WINDOW_MONTHS, month).n / INCOME_WINDOW_MONTHS);
export const firstTime = (k, playerId, worldId) => !k.db.prepare('SELECT 1 FROM housing_homes WHERE player_id = ? AND world_id = ?').get(playerId, worldId);
// A classmate's unit: tenure 'unit:<homeId>'.
export const unitIdOf = (t) => (typeof t === 'string' && /^unit:\d{1,12}$/.test(t) ? Number(t.slice(5)) : null);
export const listingOf = (k, homeId) => k.db.prepare('SELECT l.*, h.player_id AS landlord_id, h.property, h.status FROM housing_listings l JOIN housing_homes h ON h.id = l.home_id WHERE l.home_id = ?').get(homeId);
export const nameOf = (k, playerId) => k.players.get(playerId)?.username ?? 'a classmate';
export const unitName = (k, l) => `${nameOf(k, l.landlord_id)}'s condo`;

// The value announcement: the sum over every home the student owns, and the sum of their debts (one emit, so "latest per player" listeners stay right).
export function announce(k, playerId, worldId) {
  const hs = homesOf(k, playerId, worldId);
  k.events.emit('value', { playerId, worldId, homeValue: hs.reduce((t, h) => t + h.value_cents, 0), mortgageBalance: hs.reduce((t, h) => t + debtOf(k, h), 0) });
}

export const ownCosts = (k, valueCents, propId = 'average') => {
  const p = property(k, propId) ?? property(k, 'average');
  return { propertyTaxCents: propertyTaxMonthly(valueCents), condoFeeCents: p.feeCents, heatingCents: p.heatingCents, insuranceCents: px(k, cfg(k, 'insuranceCents', HOME_INSURANCE_CENTS)) };
};
// A rental's lines get the key suffix '-rental' (bills keys due lines by key, so two homes must never share one) and a "Rental condo:" name.
export const ownLines = (k, valueCents, propId, role = 'primary') => {
  const c = ownCosts(k, valueCents, propId);
  const [sfx, pre] = role === 'rental' ? ['-rental', 'Rental condo: '] : ['', ''];
  return [
    { key: `property-tax${sfx}`, name: `${pre}Property tax (Edmonton 2026)`, amount: c.propertyTaxCents, category: 'needs' },
    { key: `condo-fees${sfx}`, name: `${pre}Condo fees`, amount: c.condoFeeCents, category: 'needs' },
    { key: `heating${sfx}`, name: `${pre}Heating`, amount: c.heatingCents, category: 'needs' },
    { key: `home-insurance${sfx}`, name: `${pre}Home insurance (condo unit)`, amount: c.insuranceCents, category: 'needs' },
  ].filter((l) => l.amount > 0);
};

// What a purchase offer looks like for this student right now: the pure qualify() plus the rules that depend on who they are.
// role 'rental' (6b): not a first home, 20% down (uninsured), TDS counts the primary's mortgage payment and half the NPC rent for that property as income
// (nothing is listed before the purchase, so the expected rent is the NPC tier the student would list at by default).
export function quote(k, playerId, downCents, amortMonths, propId = 'average', role = 'primary') {
  const w = world(k);
  const prop = property(k, propId);
  if (!prop) throw new k.HttpError(400, 'Choose the average condo or the older 1-bedroom starter condo');
  const price = prop.priceCents;
  const first = firstTime(k, playerId, w.id);
  const costs = ownCosts(k, price, propId);
  const isRental = role === 'rental';
  // The student's other home: its mortgage payment is a debt either way (a landlord who sold the primary and buys again pays the rental too). Half the
  // rent counts as income: for a rental being bought, of the NPC tier; for a primary bought while a rental is let, of the rent it is let at.
  const other = homeAs(k, playerId, w.id, isRental ? 'primary' : 'rental');
  const primaryPay = other?.payment_cents ?? 0;
  const let_ = !isRental && other ? k.db.prepare('SELECT rent_cents FROM housing_listings WHERE home_id = ? AND listed = 1 AND tenant_id IS NOT NULL').get(other.id) : null;
  const rentIncome = Math.floor(((isRental ? rentBand(k, propId).tierCents : let_?.rent_cents ?? 0) * RENT_INCOME_PCT) / 100);
  const q = qualify({
    priceCents: price, downCents, contractBp: offerBp(k, w.id), amortMonths, grossMonthlyCents: avgGross(k, playerId, w.id, w.month) + rentIncome,
    heatingCents: costs.heatingCents, condoFeeCents: costs.condoFeeCents, otherDebtCents: cardMinimum(k, playerId, w.id) + primaryPay,
  });
  if (isRental) {
    if (first) q.reasons.push('A rental cannot be your first home: buy a home to live in first.');
    if (homeAs(k, playerId, w.id, 'rental')) q.reasons.push('You already own a rental.');
    if (downCents * 100 < price * RENTAL_DOWN_PCT) q.reasons.push(`A rental needs at least ${RENTAL_DOWN_PCT}% down: mortgage insurance only covers a home you live in.`);
    q.ok = q.reasons.length === 0;
  }
  const longOk = first || !q.insured;               // 30 years: first-time buyers on an insured purchase (Dept of Finance, Dec 15 2024); lenders allow it uninsured
  if (amortMonths > AMORT_DEFAULT_YEARS * 12 && !longOk) { q.reasons.push('A 30-year amortization on an insured mortgage is only for first-time buyers. Choose 25 years or put 20% down.'); q.ok = false; }
  const closing = closingCosts(price, q.loanCents, LEGAL_FEE_CENTS);
  const pricedIn = pendingBp(k, w.id) !== undefined;
  return { ...q, pricedIn, rateNote: pricedIn ? `Lenders have already priced in the Bank of DAA's announced rate: new mortgages are ${(q.contractBp / 100).toFixed(2)}% (the rate in force until next month is ${(mortgageBp(k, w.id) / 100).toFixed(2)}%).` : null,
    property: propId, propertyName: prop.name, priceCents: price, firstTime: first, longAmortAllowed: longOk, closingCents: closing, cashNeededCents: downCents + closing, amortMonths,
    role, rentalMinDownCents: isRental ? Math.ceil((price * RENTAL_DOWN_PCT) / 100) : null, rentIncomeCents: rentIncome, primaryPaymentCents: primaryPay };
}
