// housing: where a student lives and what it costs (docs/phase2.md Wave 2b). Tenure options: a shared room (the bills default: housing adds nothing),
// a 1- or 2-bedroom apartment (with a one-month damage deposit held in an account kind 'deposit', refunded on move-out), a condo bought with a mortgage,
// or (wave 6b) a classmate's rental unit, tenure 'unit:<homeId>'.
//
// Events out: module.housing.costs { playerId, month, lines, housed } every tick for every student who rents, owns or lives in a classmate's unit, BEFORE
// bills in config order (bills turns the lines into due lines; `housed` true = this student's home replaces bills' own rent line this month);
// module.housing.value { playerId, worldId, homeValue, mortgageBalance } for owners, the SUM over every home they own and the sum of those homes' debts
// (savings adds it to net worth); module.housing.payment { playerId, worldId, month, onTime, amount, kind } for each mortgage debit (kind 'mortgage',
// with homeId, role and total = this month's payments over all their homes) and each student-unit rent month (kind 'rent': playerId = the tenant,
// with homeId, landlordId, rentCents, npcCents); 6b: module.housing.evicted, .listed, .rent_changed, .market (docs/events.md).
// Events in: module.jobs.paid (gross: the last 3 months are the income lenders see), module.rates.changed (the 5-year fixed rate), module.rates.pending
// (an announced policy rate: until it applies, quotes and NEW mortgages use its 5-year rate, mortgage5yBp, as real lenders price in an announcement;
// renewals and existing mortgages keep the rate in force), module.credit.statement (the card's minimum payment, for TDS), world.closed (season close,
// below). This module reads no other module's tables.
//
// The mortgage is NOT a bill: housing debits it itself at its tick (pre-authorized debit, kind mortgage_payment: chequing -payment, mortgage +principal,
// sink +interest), ahead of credit and bills, so a mortgage payment is never crowded out by a card or a bill the same month. If chequing cannot cover it
// the payment is missed: the interest that month is added to the debt, the payment is added to arrears, a $45 NSF fee line goes to bills (as a fees line,
// never a bounced overdraft), and the credit bureau hears onTime: false. Arrears are cleared by the next debit that can cover them, or by /catch-up.
// Three misses in a row are a teacher warning. There is no foreclosure in the pilot.
//
// TWO HOMES (6b). A student may own one 'primary' and one 'rental' (unique per role). Each home has its own mortgage account: the primary keeps the
// account kind 'mortgage' (old data), a rental uses 'mortgage:<homeId>'. Every owned home ticks every month whatever the owner's tenure (a landlord who
// sold the primary still pays the rental's mortgage and owner lines). A rental's lines carry the key suffix '-rental' so they never collide with the
// primary's in bills.
//
// STUDENT RENT (6b). A rental may be listed for rent in the landlord's class. A tenant asks with POST /tenure { tenure: 'unit:<id>' }: the unit is
// reserved at once (one tenant per unit) and the move applies next month, as any move. Each tick, before the homes, housing posts the rent itself:
// tenant chequing -> landlord chequing, kind rent, one txn (not a bill). Short: arrears + a $45 NSF fee (to the sink when chequing has it, else added
// to the arrears), payment onTime:false; three misses in a row: eviction to the shared room and the arrears are written off (the landlord's loss).
//
// SEASONS. Everything here is per world (world_id): tenure rows, homes and listings belong to the season they were made in. Season close resets every player
// account to zero as core.season_reset, including the mortgages and the deposit; a home that survived that would be an owned home with no debt. So the
// world.closed listener ends the season's homes (status 'ended'), and a new world starts everyone with no tenure row (a shared room) and no home. A home
// isn't money, so the core's season result (ledger balances, mortgage included as a negative) doesn't see it: the seasonAssets hook hands the core each
// owner's home value during the close.
//
// FILE MAP (modules/housing/): index.js (this file: services, events, routes, bots), reads.js (shared reads, helpers, quote), tick.js (student units and the monthly tick),
// actions.js (tenure, buy, sell, catch-up, landlord routes), views.js (read models, market move), migrations.js (the SQL migrations), constants.js, mortgage.js, ui/.
import { defineModule } from '../../lib/modules.js';
import { dice, ok } from '../../lib/kernel.js';
import { RENTALS, MAX_PRICE_CENTS, AMORT_DEFAULT_YEARS, AMORT_LONG_YEARS, LEGAL_FEE_CENTS, COMMISSION_PCT, WARN_MISSED_IN_A_ROW, MARKET_EVENT_MIN_PCT, MARKET_EVENT_MAX_PCT, EVICT_AFTER_MISSED } from './constants.js';
import { rentVsBuy, minDown } from './mortgage.js';
import { world, PROPERTIES, propOf, roleOf, property, driftBp, rentBand, tenureRow, homesOf, homeAs, chequingOf, debtOf, avgGross, unitIdOf, listingOf, nameOf, quote } from './reads.js';
import { tick } from './tick.js';
import { studentRentOn, setTenure, buy, sell, catchUp, list, unlist, changeRent, endTenancy } from './actions.js';
import { listingView, market, state, marketMove, todayFacts, vacantByClass } from './views.js';
import { migrations } from './migrations.js';

const ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 11l9-7 9 7"/><path d="M5 10v10h14V10"/><rect x="10" y="14" width="4" height="6"/></svg>';

export default defineModule({
  id: 'housing',
  // marketEvent { pct }: the life module's scheduled housing shock (docs/phase5-life.md 5b), through k.modules.call only. Same as the teacher's POST /market.
  services: {
    todayFacts, marketEvent: (k, args) => marketMove(k, args?.pct, null),
    // What housing takes straight from chequing each month, outside the Bills lines (retirement's live check, docs/phase5-life.md 5c): the regular mortgage
    // payment of every home with a balance left (not arrears) and the rent of a classmate's unit the student lives in. Read-only: { mortgageCents, rentCents }.
    monthCosts(k, { playerId } = {}) {
      if (!Number.isSafeInteger(playerId)) throw new k.HttpError(400, 'playerId must be a whole number');
      const w = k.world.current();
      if (!w) return { mortgageCents: 0, rentCents: 0 };
      const mortgageCents = homesOf(k, playerId, w.id).reduce((t, h) => t + (h.payment_cents > 0 && debtOf(k, h) > 0 ? h.payment_cents : 0), 0);
      const unit = unitIdOf(tenureRow(k, playerId, w.id)?.tenure), l = unit === null ? null : listingOf(k, unit);
      return { mortgageCents, rentCents: l && l.tenant_id === playerId ? l.rent_cents : 0 };
    },
  },
  options: { condoPriceCents: 'cents', starterPriceCents: 'cents', condoFeeCents: 'cents/month', starterFeeCents: 'cents/month', heatingCents: 'cents/month', insuranceCents: 'cents/month', termMonths: 'mortgage term, world months', driftBp: 'monthly home value drift, bp' },
  requires: ['bank-basic'],

  migrations,

  events: {
    'module.jobs.paid'(k, { playerId, worldId, month, gross }) {
      if (!ok(playerId) || !ok(worldId) || !ok(month) || !ok(gross)) return;
      k.db.prepare('INSERT INTO housing_income (player_id, world_id, month, gross_cents) VALUES (?, ?, ?, ?) ON CONFLICT (player_id, world_id, month) DO UPDATE SET gross_cents = gross_cents + excluded.gross_cents').run(playerId, worldId, month, gross);
    },
    'module.rates.changed'(k, { worldId, mortgage5yBp }) {
      if (ok(worldId) && ok(mortgage5yBp) && mortgage5yBp >= 0 && mortgage5yBp <= 10000) k.db.prepare('INSERT INTO housing_rates (world_id, mortgage5y_bp) VALUES (?, ?) ON CONFLICT (world_id) DO UPDATE SET mortgage5y_bp = excluded.mortgage5y_bp').run(worldId, mortgage5yBp);
    },
    'module.rates.pending'(k, { worldId, pendingBp: bp, effectiveMonth, mortgage5yBp }) {
      if (!ok(worldId)) return;
      if (bp === null || !ok(mortgage5yBp) || mortgage5yBp < 0 || mortgage5yBp > 10000) k.db.prepare('DELETE FROM housing_rates_pending WHERE world_id = ?').run(worldId);   // cancelled or applied
      else k.db.prepare('INSERT INTO housing_rates_pending (world_id, mortgage5y_bp, effective_month) VALUES (?, ?, ?) ON CONFLICT (world_id) DO UPDATE SET mortgage5y_bp = excluded.mortgage5y_bp, effective_month = excluded.effective_month')
        .run(worldId, mortgage5yBp, ok(effectiveMonth) ? effectiveMonth : null);
    },
    'module.credit.statement'(k, { playerId, worldId, month, minimum }) {
      if (ok(playerId) && ok(worldId) && ok(month) && ok(minimum) && minimum >= 0) k.db.prepare('INSERT INTO housing_card (player_id, world_id, minimum_cents, month) VALUES (?, ?, ?, ?) ON CONFLICT (player_id, world_id) DO UPDATE SET minimum_cents = excluded.minimum_cents, month = excluded.month').run(playerId, worldId, minimum, month);
    },
    // Season close: the core has just zeroed every account (mortgages and deposit included), so the season's homes, listings and tenancies end too.
    'world.closed'(k, { worldId }) {
      k.db.prepare("UPDATE housing_homes SET status = 'ended' WHERE world_id = ? AND status = 'owned'").run(worldId);
      k.db.prepare('UPDATE housing_listings SET listed = 0, tenant_id = NULL, notice_month = NULL WHERE world_id = ?').run(worldId);
    },
  },

  // Season close asks for assets that aren't money: each owned home, at its current value (a landlord gets a row per home).
  seasonAssets: (k, { worldId }) => k.db.prepare("SELECT player_id AS playerId, value_cents AS cents FROM housing_homes WHERE world_id = ? AND status = 'owned'").all(worldId),

  panels: [{ id: 'housing', building: { key: 'housing', name: 'Housing', icon: ICON }, src: 'housing.js' }],
  teacherPanels: [{ id: 'housing-teach', title: 'Housing', src: 'teach.js' }],

  onTick: tick,

  // Bots choose where to live: ~15% stay with their parents (they save fastest), ~30% take the 2-bedroom with a roommate, the rest keep the shared room
  // (bills' default rent). A move that the deposit can't cover is retried next month. From month 24 the 20% with the most cash and savings try to buy:
  // the average condo if they qualify for it, else the older starter condo; they must qualify like anyone else. They draw the down payment and closing
  // costs from HISA into chequing only after the offer qualifies.
  // 6b: from month 30 a bot that owns its home, has no rental and is in its class's top quarter by cash and savings buys a rental with a 10% roll a month
  // (the starter first: cheaper), and lists it at the NPC rent. A renter bot (shared room or an NPC apartment, owning nothing) looks once a year (its own
  // month of the year) and with a 30% roll moves to the cheapest vacant unit in its class, if the rent is at most 40% of its gross pay. Hash dice only.
  simulate(k, { month, students }) {
    const w = world(k);
    const units = new Set(k.db.prepare("SELECT player_id FROM housing_tenure WHERE world_id = ? AND (tenure LIKE 'unit:%' OR pending_tenure LIKE 'unit:%')").all(w.id).map((r) => r.player_id));
    for (const s of students) {
      const d = dice(s.id, 0, 7), want = d < 15 ? 'parents' : d < 45 ? 'apt2-roommate' : null;
      if (!want || units.has(s.id) || homeAs(k, s.id, w.id, 'primary')) continue;
      const row = tenureRow(k, s.id, w.id);
      if ((row?.tenure ?? 'shared') !== want && row?.pending_tenure !== want) { try { setTenure(k, { id: s.id, class_id: s.class_id ?? null }, want); } catch { /* not enough for the deposit yet */ } }
    }
    if (month < 24) return;
    const worth = (id) => k.ledger.accountsOf('player', id).filter((a) => a.kind === 'chequing' || a.kind === 'hisa' || a.kind.startsWith('gic:')).reduce((t, a) => t + a.balance_cents, 0);
    const ranked = students.map((s) => ({ id: s.id, class_id: s.class_id, w: worth(s.id) })).sort((a, b) => b.w - a.w || a.id - b.id);
    // Draw the down payment and closing costs from HISA, then buy (the same route code as a student).
    const purchase = (id, role, props, downOf) => {
      const chq = chequingOf(k, id), hisa = k.ledger.accountId('player', id, 'hisa');
      const cash = k.ledger.balance(chq) + (hisa ? k.ledger.balance(hisa) : 0);
      const buffer = 300000;                                           // keep $3,000 for the first bills
      for (const prop of props) {
        const first = quote(k, id, 0, AMORT_DEFAULT_YEARS * 12, prop.id, role);
        const down = downOf(first, cash, buffer);
        const q = quote(k, id, down, AMORT_DEFAULT_YEARS * 12, prop.id, role);
        if (!q.ok || cash < q.cashNeededCents + buffer) continue;
        const short = q.cashNeededCents + buffer - k.ledger.balance(chq);
        if (short > 0) k.ledger.transfer({ kind: 'sim_move', from: hisa, to: chq, cents: short, memo: 'To chequing for a down payment' });
        return buy(k, { id, class_id: null }, down, AMORT_DEFAULT_YEARS * 12, prop.id, role);
      }
      return null;
    };
    for (const { id } of ranked.slice(0, Math.ceil(students.length * 0.2))) {
      if (homeAs(k, id, w.id, 'primary') || units.has(id)) continue;
      purchase(id, 'primary', PROPERTIES(k), (first, cash, buffer) => Math.max(first.minDownCents, Math.min(Math.ceil(first.priceCents / 5), cash - buffer - 200000)));
    }
    if (month < 30) return;
    // Landlords: the top quarter of each class.
    const byClass = new Map();
    for (const r of ranked) (byClass.get(r.class_id) ?? byClass.set(r.class_id, []).get(r.class_id)).push(r);
    for (const group of byClass.values()) {
      for (const { id } of group.slice(0, Math.ceil(group.length / 4))) {
        if (dice(id, month, 61) >= 10 || !homeAs(k, id, w.id, 'primary') || homeAs(k, id, w.id, 'rental') || !studentRentOn(k, k.players.classOf(id)?.id)) continue;
        const r = purchase(id, 'rental', [...PROPERTIES(k)].reverse(), (first) => first.rentalMinDownCents);
        if (r) list(k, { id, class_id: null }, r.home_id, rentBand(k, homeAs(k, id, w.id, 'rental').property).tierCents);
      }
    }
    // Renters: once a year each, 30%, the cheapest vacant unit in the class they can afford (rent at most 40% of gross: under the lenders' 44% TDS).
    const vacant = vacantByClass(k, w);
    for (const s of students) {
      if (month % 12 !== s.id % 12 || dice(s.id, month, 83) >= 30 || units.has(s.id) || homesOf(k, s.id, w.id).length) continue;
      const t = tenureRow(k, s.id, w.id)?.tenure ?? 'shared';
      if (t !== 'shared' && !['apt1', 'apt2', 'apt2-roommate'].includes(t)) continue;
      const gross = avgGross(k, s.id, w.id, month), cls = k.players.classOf(s.id)?.id, options = vacant.get(cls) ?? [];
      const i = options.findIndex((l) => l.landlord_id !== s.id && l.rent_cents * 10 <= gross * 4);
      if (i < 0) continue;
      try { setTenure(k, { id: s.id, class_id: cls }, `unit:${options[i].home_id}`); options.splice(i, 1); } catch { /* taken or not allowed: try next year */ }
    }
  },

  routes: [
    { method: 'GET', path: '/state', access: 'student', handler: (k, { user }) => state(k, user) },
    { method: 'GET', path: '/market', access: 'student', handler: (k, { user }) => market(k, user) },
    { method: 'POST', path: '/tenure', access: 'student', handler: (k, { user, body }) => setTenure(k, user, k.input.str(body, 'tenure', { max: 30 })) },
    {
      method: 'POST', path: '/qualify', access: 'student',   // what-if: pure maths on the student's own income, nothing is saved
      handler(k, { user, body }) {
        const down = k.input.int(body, 'down_cents', { min: 0, max: MAX_PRICE_CENTS });
        const years = k.input.int(body, 'amort_years', { min: AMORT_DEFAULT_YEARS, max: AMORT_LONG_YEARS });
        if (years !== AMORT_DEFAULT_YEARS && years !== AMORT_LONG_YEARS) throw new k.HttpError(400, 'amort_years must be 25 or 30');
        return quote(k, user.id, down, years * 12, propOf(k, body), roleOf(k, body));
      },
    },
    {
      method: 'POST', path: '/buy', access: 'student',
      handler(k, { user, body }) {
        const years = k.input.int(body, 'amort_years', { min: AMORT_DEFAULT_YEARS, max: AMORT_LONG_YEARS });
        if (years !== AMORT_DEFAULT_YEARS && years !== AMORT_LONG_YEARS) throw new k.HttpError(400, 'amort_years must be 25 or 30');
        return buy(k, user, k.input.int(body, 'down_cents', { min: 1, max: MAX_PRICE_CENTS }), years * 12, propOf(k, body), roleOf(k, body));
      },
    },
    { method: 'POST', path: '/sell', access: 'student', handler: (k, { user, body }) => sell(k, user, k.input.int(body ?? {}, 'home_id', { min: 1, optional: true })) },
    { method: 'POST', path: '/catch-up', access: 'student', handler: (k, { user, body }) => catchUp(k, user, k.input.int(body ?? {}, 'home_id', { min: 1, optional: true })) },
    // 6b landlord routes: only the student's own rental (404 otherwise)
    { method: 'POST', path: '/list', access: 'student', handler: (k, { user, body }) => list(k, user, k.input.int(body, 'home_id', { min: 1 }), k.input.int(body, 'rent_cents', { min: 1, max: 10000000 })) },
    { method: 'POST', path: '/unlist', access: 'student', handler: (k, { user, body }) => unlist(k, user, k.input.int(body, 'home_id', { min: 1 })) },
    { method: 'POST', path: '/rent', access: 'student', handler: (k, { user, body }) => changeRent(k, user, k.input.int(body, 'home_id', { min: 1 }), k.input.int(body, 'rent_cents', { min: 1, max: 10000000 })) },
    { method: 'POST', path: '/end-tenancy', access: 'student', handler: (k, { user, body }) => endTenancy(k, user, k.input.int(body, 'home_id', { min: 1 })) },
    {
      method: 'POST', path: '/calc', access: 'student',   // the rent-vs-buy calculator: pure maths on whatever the student types
      handler(k, { body }) {
        const n = (key, min, max) => k.input.int(body, key, { min, max });
        const price = n('price_cents', 1000000, MAX_PRICE_CENTS);
        const down = n('down_cents', 0, price - 1);
        const years = n('amort_years', 1, 30);
        const r = rentVsBuy({
          priceCents: price, downCents: down, contractBp: n('rate_bp', 0, 2000), amortMonths: years * 12, rentCents: n('rent_cents', 0, 10000000),
          condoFeeCents: n('condo_fee_cents', 0, 500000), heatingCents: n('heating_cents', 0, 100000), insuranceCents: n('insurance_cents', 0, 100000),
          years: n('years', 1, 30), driftBp: n('drift_bp', -200, 200), investBp: n('invest_bp', 0, 2000), legalCents: LEGAL_FEE_CENTS, commissionPct: COMMISSION_PCT,
        });
        return { ...r, min_down_cents: minDown(price), down_ok: down >= minDown(price) };
      },
    },

    // ---- teacher ----
    {
      method: 'GET', path: '/teach', access: 'teacher',
      handler(k, { user }) {
        const w = world(k), month = w.month;
        const classes = k.players.classesFor(user);
        const names = Object.fromEntries(RENTALS.map((r) => [r.id, r.name]));
        const place = (t) => (unitIdOf(t) !== null ? `Rents from ${(() => { const l = listingOf(k, unitIdOf(t)); return l ? nameOf(k, l.landlord_id) : 'a classmate'; })()}` : names[t] ?? 'Shared room');
        const out = classes.map((c) => {
          const mates = k.players.inClass(c.id);
          const students = mates.map((s) => {
            const row = tenureRow(k, s.id, w.id), hs = homesOf(k, s.id, w.id), h = hs.find((x) => x.role === 'primary'), rh = hs.find((x) => x.role === 'rental');
            // the warning looks at every home the student owns (a rental's missed mortgage payments too)
            const worst = hs.reduce((m, x) => Math.max(m, x.missed_streak), 0), behind = hs.reduce((t, x) => t + x.arrears_cents, 0);
            const base = { id: s.id, username: s.username, tenure: h ? 'Owns a condo' : row ? place(row.tenure) : 'Shared room', pending: row?.pending_tenure ? place(row.pending_tenure) : null, landlord: !!rh,
              all_missed_streak: worst, all_arrears_cents: behind, warning: worst >= WARN_MISSED_IN_A_ROW };
            if (!h) return { ...base, owner: false };
            const debt = debtOf(k, h);
            return { ...base, owner: true, value_cents: h.value_cents, balance_cents: debt, equity_cents: h.value_cents - debt, payment_cents: h.payment_cents, rate_bp: h.rate_bp, renewal_month: h.term_start + h.term_months,
              arrears_cents: h.arrears_cents, missed_streak: h.missed_streak, missed_total: h.missed_total };
          });
          // 6b: the class's rentals, listed or not: rent against the NPC tier, tenant, arrears, evictions
          const listings = k.db.prepare(`SELECT l.*, h.id AS home_id, h.player_id AS landlord_id, h.property, h.value_cents, h.payment_cents AS mortgage_payment_cents, h.arrears_cents AS mortgage_arrears_cents, h.missed_streak AS mortgage_missed_streak FROM housing_homes h LEFT JOIN housing_listings l ON l.home_id = h.id
            WHERE h.world_id = ? AND h.status = 'owned' AND h.role = 'rental' AND h.player_id IN (SELECT value FROM json_each(?)) ORDER BY h.id`).all(w.id, JSON.stringify(mates.map((s) => s.id)))
            .map((r) => ({ home_id: r.home_id, landlord: nameOf(k, r.landlord_id), property_name: property(k, r.property)?.name ?? 'Condo', value_cents: r.value_cents, mortgage_cents: debtOf(k, { id: r.home_id, role: 'rental', player_id: r.landlord_id }),
              mortgage_payment_cents: r.mortgage_payment_cents, mortgage_arrears_cents: r.mortgage_arrears_cents, mortgage_missed_streak: r.mortgage_missed_streak,
              ...(r.rent_cents == null ? { listed: false, rent_cents: null, npc_cents: rentBand(k, r.property).tierCents, tenant: null } : listingView(k, r, month)) }));
          const evictions = k.db.prepare('SELECT COALESCE(SUM(l.evictions), 0) AS n FROM housing_listings l JOIN housing_homes h ON h.id = l.home_id WHERE l.world_id = ? AND h.player_id IN (SELECT value FROM json_each(?))').get(w.id, JSON.stringify(mates.map((s) => s.id))).n;
          return { id: c.id, name: c.name, students, listings, evictions, renters: students.filter((s) => !s.owner && s.tenure !== 'Shared room').length, owners: students.filter((s) => s.owner).length, warnings: students.filter((s) => s.warning).length };
        });
        return {
          month, classes: out, warnings: out.flatMap((c) => c.students.filter((s) => s.warning).map((s) => ({ class: c.name, username: s.username, missed_streak: s.all_missed_streak, arrears_cents: s.all_arrears_cents }))),
          can_event: k.policy.can(user, 'world.settings'), event_min_pct: MARKET_EVENT_MIN_PCT, event_max_pct: MARKET_EVENT_MAX_PCT, drift_bp: driftBp(k), warn_after: WARN_MISSED_IN_A_ROW, evict_after: EVICT_AFTER_MISSED,
          events: k.db.prepare('SELECT month, pct FROM housing_market WHERE world_id = ? ORDER BY id DESC LIMIT 10').all(w.id),
        };
      },
    },
    {
      method: 'POST', path: '/market', access: 'teacher',   // a housing market event: every home in the world moves by -15..-5% or +5..+15%
      handler(k, { user, body }) {
        k.policy.assert(user, 'world.settings');           // the market is the whole world's
        const pct = k.input.int(body, 'pct', { min: -MARKET_EVENT_MAX_PCT, max: MARKET_EVENT_MAX_PCT });
        return { ok: true, ...marketMove(k, pct, user.id, user.class_id) };
      },
    },
  ],
});

