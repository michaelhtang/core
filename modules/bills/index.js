// bills: every world month each student is billed rent, utilities, groceries and the optional plans they chose. Pay one by one,
// "Pay all", or turn on autopay. A bill still unpaid at the next month tick is marked late, gets a row in bills_history (which a later
// credit-score phase reads) and adds a "Late fee: <bill>" due line for the current month (greater of $25 or 5% of the bill). The fee line
// is paid like any bill and can itself go late, but never earns a fee of its own. Tick order: new bills, late marks and fee lines, THEN autopay.
// BILLS OWED: a bill is a debt from the tick it is issued (accounts payable). Every new due line (fee lines too) is posted to the student's
// ledger account 'payable' (allow_negative): payable -total / sink +total, kind bills.owed, one txn per student per tick (meta.dueIds), once per
// row (bills_due.owed_month). Paying a row is chequing (or the card) -> payable, so the sink receives each bill once, at issue. Net worth sums
// every player account, so unpaid bills count against it whether late or not. "Overdue" is the late, unpaid rows (computed, not an account).
// MULTI-MONTH ADVANCES: a line is judged late only if it was due by the month the advance started (onTick's startMonth), so students always get
// at least one live month to pay; lines issued during a 2+ month advance are judged at the next advance.
// Net pay for the Budget tab arrives as the event module.jobs.paid (emitted by jobs inside the payday transaction), so bills needs neither
// jobs' tables nor its load order, and works with jobs absent ("No pay yet").
// STAGE COSTS (docs/stagecosts.md): catalogue rows with from_age/to_age bill only while the world's age (life.age, read once per tick) is inside them, so
// nothing changes in Stage A or without life; tenure 'own'/'rent' picks home upkeep or renter extras (an owner = this month's housing lines have the primary
// home's property tax). They are ordinary lines after that: owed, autopay, late fees, monthBills.
// Billing starts the month AFTER a student's first pay (config startAfter 'pay'), or after their first login ('login', the default, for
// worlds without jobs), so nobody is late before they could have been paid.
// Money: payment = chequing -> sink, never an overdraft; or (student setting pay_from = 'card', only when they have a card account) card -> sink,
// refused past the card limit (manual pay: the student chooses). AUTOPAY from the card falls back to chequing for a bill the card has no room for,
// so nobody is marked late while they have money. The limit is not ours to read: credit emits module.credit.limit { playerId, worldId, limitCents }
// on approval and we keep the latest per (player, world) in bills_limits; without one for the current world card payment is unavailable.
// Events out (inside the same transaction as the write): module.bills.paid { playerId, worldId, month, dueMonth, billId, onTime, amount } for every payment
// (onTime = the line was never marked late; dueMonth = the month it was due, so listeners can credit the month the bill belongs to; fee lines
// too; billId is the bill's id string, e.g. 'rent', 'late-fee-12', 'housing-mortgage'), module.bills.late { playerId, worldId, month, billId, monthsLate }
// every tick a bill is still late, module.bills.choices { playerId, options, autoPremiumCents } at a student's first billed tick and whenever they change
// a plan (options = every slot's effective option, e.g. { transport: 'car' }; insurance listens). Events in: module.housing.costs { playerId, month, lines }
// becomes due lines 'housing-<key>'; its `housed` flag (6b) says whether the student's home replaces that month's catalogue rent line (an owner, an NPC
// rental, a classmate's unit: yes; a landlord living in the shared room: no; an older payload without the flag: any housing line); module.insurance.costs the same with 'insurance-<key>' (no rent
// replacement); module.insurance.expense { playerId, month, eventId, name, amount } becomes one due line 'event-<eventId>'. Housing and insurance load
// before bills; lines arriving after bills' tick apply next month, never a reversal.
// FILE MAP: index.js (this header + defineModule: hooks, services, routes), migrations.js (schema), pay.js (paying, card limit, autopay/pay-from settings),
// reads.js (catalogue, stage-cost and choice helpers, the /state payload), month.js (the month's bills, the tick, accepting other modules' lines).
import { defineModule } from '../../lib/modules.js';
import { ITEMS, SLOT_LABELS, forAge } from './catalogue.js';
import { migrations } from './migrations.js';
import { source, refusal, payDue, unpaid, payAll, setPayFrom, setAutopay } from './pay.js';
import { catalogue, ageNow, STAGE_AGES, ownerOf, defaultOptions, billsFor, choicesPayload, state } from './reads.js';
import { startsAfter, setStart, tick, acceptLines } from './month.js';

export default defineModule({
  id: 'bills',
  options: { amounts: '{ <bill id>: cents } overrides', lateFeeCents: 'minimum late fee, cents', lateFeePct: 'late fee, percent of the bill', startAfter: "'pay' or 'login': when billing starts" },
  catalogues: [{ table: 'bills_catalogue', key: ['id'], rows: () => ITEMS }],   // upserted at boot (docs/modules.md "Catalogues")

  migrations,

  // jobs emits this inside the payday transaction, so the row is written (and rolled back) with the pay itself.
  events: {
    'module.jobs.paid'(k, { playerId, month, net }) {
      const w = k.world.current();
      k.db.prepare('INSERT INTO bills_pay (player_id, world_id, month, net_cents) VALUES (?, ?, ?, ?) ON CONFLICT (player_id, world_id, month) DO UPDATE SET net_cents = net_cents + excluded.net_cents').run(playerId, w.id, month, net);
      if (startsAfter(k) === 'pay') setStart(k, playerId, month);
    },
    'module.credit.limit'(k, { playerId, worldId, limitCents }) {
      if (!Number.isSafeInteger(playerId) || !Number.isSafeInteger(worldId) || !Number.isSafeInteger(limitCents) || limitCents < 0) return;
      k.db.prepare('INSERT INTO bills_limits (player_id, world_id, limit_cents) VALUES (?, ?, ?) ON CONFLICT (player_id, world_id) DO UPDATE SET limit_cents = excluded.limit_cents').run(playerId, worldId, limitCents);
    },
    // Housing and insurance load before bills (config order), so their lines for a month arrive before bills' tick issues that month.
    // If the config is misordered and the lines arrive after this month's bills were already issued, they are kept for NEXT month instead:
    // a one-month lag, never a reversal (reversing a paid bill would show credit a payment that didn't stand).
    'module.housing.costs'(k, { playerId, month, lines, housed }) { acceptLines(k, playerId, month, lines, 'housing', housed); },
    'module.insurance.costs'(k, { playerId, month, lines }) { acceptLines(k, playerId, month, lines, 'insurance'); },
    'module.insurance.expense'(k, { playerId, month, eventId, name, amount }) {
      if (Number.isSafeInteger(eventId) && eventId > 0) acceptLines(k, playerId, month, [{ key: String(eventId), name, amount, category: 'needs' }], 'event');
    },
  },

  // New students start with autopay ON (existing players keep what they have: no row = off, as before). Idempotent.
  onPlayer(k, player) { k.db.prepare('INSERT OR IGNORE INTO bills_settings (player_id, autopay) VALUES (?, 1)').run(player.id); },

  onLogin(k, player) { if (startsAfter(k) === 'login') setStart(k, player.id, k.world.current()?.month ?? 0); },

  panels: [{ id: 'bills', building: { key: 'bills', name: 'Bills', icon: '<svg viewBox="0 0 24 24"><path d="M6 3h12v18l-3-2-3 2-3-2-3 2zM9 8h6M9 12h6M9 16h3"/></svg>' }, src: 'bills.js' }],
  teacherPanels: [{ id: 'bills-teach', title: 'Bills', src: 'teach.js' }],

  onTick: tick,
  services: {
    // The student's regular bills for the latest month billed (retirement's live check, docs/phase5-life.md 5c): every line issued for that month (rent or the
    // housing lines, utilities, groceries, plans, insurance premiums) except fees (late fees, a bounced-payment NSF fee) and one-off event expenses. Read-only: { month, cents } (month null: none yet).
    monthBills(k, { playerId } = {}) {
      if (!Number.isSafeInteger(playerId)) throw new k.HttpError(400, 'playerId must be a whole number');
      const wid = k.world.current()?.id ?? -1;
      const m = k.db.prepare('SELECT MAX(due_month) AS m FROM bills_due WHERE player_id = ? AND world_id = ?').get(playerId, wid).m;
      if (m === null) return { month: null, cents: 0 };
      const cents = k.db.prepare("SELECT COALESCE(SUM(amount), 0) AS n FROM bills_due WHERE player_id = ? AND world_id = ? AND due_month = ? AND category <> 'fees' AND bill_id NOT LIKE 'event-%'").get(playerId, wid, m).n;
      return { month: m, cents };
    },
    // Stage costs (docs/stagecosts.md), read-only, for the Life panel, its teacher table and retirement's projection. lines: every stage row at today's
    // prices (default = the slot's default option). With playerId, steps: [{ age, cents }] = what the student's stage lines (their choices, their tenure now)
    // total at their age now and at each later age where a line starts, stops or steps, up to 70, at today's prices.
    // baseAge (optional): steps[0] is at that age instead of now (retirement passes the age of the latest month billed).
    stageCosts(k, { playerId, baseAge } = {}) {
      const items = catalogue(k), defaults = defaultOptions(items), age = ageNow(k);
      const lines = items.filter((r) => r.from_age > 0).map((r) => ({ id: r.id, slot: r.slot, option: r.option, option_label: r.option_label, name: r.name, label: SLOT_LABELS[r.slot] ?? r.option_label,
        from_age: r.from_age, to_age: r.to_age, tenure: r.tenure, required: !!r.required, category: r.category, amount_cents: r.amount_cents, default: !r.required && defaults[r.slot] === r.option, source_note: r.source_note, illustrative: !!r.illustrative }));
      if (!Number.isSafeInteger(playerId) || age === null) return { age, lines };
      const w = k.world.current(), owner = ownerOf(k, playerId, w.id);
      const choices = Object.fromEntries(k.db.prepare('SELECT slot, option FROM bills_choices WHERE player_id = ?').all(playerId).map((r) => [r.slot, r.option]));
      const total = (a) => billsFor(forAge(items, a, owner), choices, defaults).filter((r) => r.from_age > 0).reduce((t, r) => t + r.amount_cents, 0);
      const base = Number.isSafeInteger(baseAge) && baseAge <= age ? baseAge : age;
      return { age, lines, owner, choices, steps: [base, ...STAGE_AGES.filter((a) => a > base && a <= 70)].map((a) => ({ age: a, cents: total(a) })) };
    },
  },

  // Bots: 80% keep autopay on, 20% turn it off (decided once; bot_decided); the rest pay everything they can afford with a 70% chance each month.
  simulate(k, { students }) {
    const w = k.world.current();
    for (const s of students) {
      let row = k.db.prepare('SELECT autopay, bot_decided FROM bills_settings WHERE player_id = ?').get(s.id);
      if (!row?.bot_decided) {   // onPlayer's default row (autopay on) is not the bot's decision: roll once, then remember it
        setAutopay(k, s.id, Math.random() < 0.8);
        k.db.prepare('UPDATE bills_settings SET bot_decided = 1 WHERE player_id = ?').run(s.id);
        row = k.db.prepare('SELECT autopay FROM bills_settings WHERE player_id = ?').get(s.id);
      }
      if (!row.autopay && Math.random() < 0.7) payAll(k, s.id, w.id, w.month);
    }
    // Stage costs (docs/stagecosts.md): from 36, a bot with a late bill it has not paid cuts every optional stage line it can to None, as a student
    // who cannot keep up would. Nothing before 36, so Stage A runs as before.
    const age = ageNow(k);
    if (age === null || age < 36) return;
    const slots = [...new Set(forAge(catalogue(k), age).filter((r) => r.from_age > 0 && !r.required).map((r) => r.slot))];
    const behind = new Set(k.db.prepare('SELECT DISTINCT player_id FROM bills_due WHERE world_id = ? AND paid_txn IS NULL AND late = 1').all(w.id).map((r) => r.player_id));
    const none = k.db.prepare("INSERT INTO bills_choices (player_id, slot, option) VALUES (?, ?, 'none') ON CONFLICT (player_id, slot) DO UPDATE SET option = 'none'");
    for (const s of students) if (behind.has(s.id)) for (const slot of slots) none.run(s.id, slot);
  },

  routes: [
    { method: 'GET', path: '/state', access: 'student', handler: (k, { user }) => state(k, user) },
    {
      method: 'POST', path: '/pay', access: 'student',
      handler(k, { user, body }) {
        const d = k.db.prepare('SELECT * FROM bills_due WHERE id = ? AND player_id = ? AND world_id = ?').get(k.input.int(body, 'id', { min: 1 }), user.id, k.world.current().id);
        if (!d) throw new k.HttpError(404, 'Bill not found');
        if (d.paid_txn !== null) throw new k.HttpError(409, 'That bill is already paid');
        const why = payDue(k, user.id, d, k.world.current().month);
        if (why) throw new k.HttpError(400, why);
        return { ok: true };
      },
    },
    {
      method: 'POST', path: '/pay-all', access: 'student',
      handler(k, { user }) {
        const w = k.world.current();
        const open = unpaid(k, user.id, w.id);
        if (!open.length) throw new k.HttpError(400, 'Nothing to pay');
        const r = payAll(k, user.id, w.id, w.month);
        if (!r.paid) throw new k.HttpError(400, refusal(source(k, user.id), 'the cheapest bill', Math.min(...open.map((d) => d.amount))));
        return { ok: true, ...r };
      },
    },
    {
      method: 'POST', path: '/autopay', access: 'student',
      handler(k, { user, body }) {
        const on = k.input.bool(body, 'enabled');
        k.db.txn((tx) => { setAutopay(k, user.id, on); tx.onCommit(() => k.events.emit('changed', { classId: user.class_id })); });
        return { ok: true, autopay: on };
      },
    },
    {
      method: 'POST', path: '/pay-from', access: 'student',
      handler(k, { user, body }) {
        const from = k.input.str(body, 'source', { max: 16 });
        if (from !== 'chequing' && from !== 'card') throw new k.HttpError(400, 'Pay from chequing or card');
        if (from === 'card' && !k.ledger.accountId('player', user.id, 'card')) throw new k.HttpError(400, 'You do not have a credit card yet');
        k.db.txn((tx) => { setPayFrom(k, user.id, from); tx.onCommit(() => k.events.emit('changed', { classId: user.class_id })); });
        return { ok: true, pay_from: from };
      },
    },
    {
      method: 'POST', path: '/choice', access: 'student',
      handler(k, { user, body }) {
        const slot = k.input.str(body, 'slot', { max: 32 }), option = k.input.str(body, 'option', { max: 32 });
        const items = forAge(catalogue(k), ageNow(k)).filter((r) => !r.required && r.slot === slot);   // a stage slot from its first age
        if (!items.length) throw new k.HttpError(400, 'That is not a choice you can make');
        if (option !== 'none' && !items.some((r) => r.option === option)) throw new k.HttpError(400, 'Pick one of the listed options');
        k.db.txn((tx) => {
          k.db.prepare('INSERT INTO bills_choices (player_id, slot, option) VALUES (?, ?, ?) ON CONFLICT (player_id, slot) DO UPDATE SET option = excluded.option').run(user.id, slot, option);
          tx.onCommit(() => {
            k.events.emit('changed', { classId: user.class_id });
            if (k.db.prepare('SELECT 1 FROM bills_known WHERE player_id = ? AND world_id = ?').get(user.id, k.world.current().id)) k.events.emit('choices', choicesPayload(k, forAge(catalogue(k), ageNow(k)), user.id, Object.fromEntries(k.db.prepare('SELECT slot, option FROM bills_choices WHERE player_id = ?').all(user.id).map((r) => [r.slot, r.option]))));
          });
        });
        return { ok: true, applies: 'next month' };
      },
    },

    // ---- teacher ----
    {
      method: 'GET', path: '/overview', access: 'teacher',
      handler(k, { user }) {
        const w = k.world.current();
        const classes = k.players.classesFor(user);
        return {
          month: w.month,
          classes: classes.map((c) => {
            const students = k.players.inClass(c.id);
            const ids = JSON.stringify(students.map((s) => s.id));
            const by = new Map(k.db.prepare(`SELECT player_id, COUNT(*) AS open, COALESCE(SUM(late), 0) AS late, SUM(amount) AS owed
              FROM bills_due WHERE world_id = ? AND paid_txn IS NULL AND player_id IN (SELECT value FROM json_each(?)) GROUP BY player_id`).all(w.id, ids).map((r) => [r.player_id, r]));
            const ever = new Map(k.db.prepare('SELECT player_id, COUNT(*) AS n FROM bills_history WHERE world_id = ? AND player_id IN (SELECT value FROM json_each(?)) GROUP BY player_id').all(w.id, ids).map((r) => [r.player_id, r.n]));
            const auto = new Set(k.db.prepare('SELECT player_id FROM bills_settings WHERE autopay = 1 AND player_id IN (SELECT value FROM json_each(?))').all(ids).map((r) => r.player_id));
            return {
              id: c.id, name: c.name,
              students: students.map((s) => ({ id: s.id, username: s.username, autopay: auto.has(s.id), open: by.get(s.id)?.open ?? 0, late: by.get(s.id)?.late ?? 0, owed_cents: by.get(s.id)?.owed ?? 0, late_ever: ever.get(s.id) ?? 0 })),
            };
          }),
        };
      },
    },
  ],
});
