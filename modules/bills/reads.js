// bills: catalogue reads, stage-cost helpers, choices, late fee, and the student's /state payload.
import { ITEMS, LATE_FEE, TARGETS, SLOT_LABELS, forAge } from './catalogue.js';
import { source, limitOf } from './pay.js';

// The world's price index (k.world.priceIndex(); 10000 = no inflation, also when rates is not loaded). Bills issued from now on cost catalogue x index.
// The rows only change at boot (the catalogue upsert), so they are read once per database.
const rowsOf = new WeakMap();
export const catalogue = (k) => {
  const over = k.config.amounts ?? {}, idx = k.world.priceIndex();
  if (!rowsOf.has(k.db)) rowsOf.set(k.db, k.db.prepare('SELECT * FROM bills_catalogue WHERE active = 1 ORDER BY sort').all());   // retired rows are not billed again
  return rowsOf.get(k.db).map((r) => { const base = Number.isSafeInteger(over[r.id]) && over[r.id] > 0 ? over[r.id] : r.amount_cents; return { ...r, amount_cents: Math.round((base * idx) / 10000) }; });
};
// Stage costs (docs/stagecosts.md): the world's age from life (everyone shares it), or null without life (then only the Stage A rows apply, as before).
export const ageNow = (k) => (k.modules.has('life') ? k.modules.call('life', 'age', {}).age : null);
export const STAGE_AGES = [...new Set(ITEMS.flatMap((r) => (r.from_age > 0 ? [r.from_age, r.to_age + 1] : [])))].sort((a, b) => a - b);   // where a stage line starts or stops
// An owner (for the home-upkeep line): their latest housing lines have the primary home's property tax.
export const ownerOf = (k, playerId, worldId) => !!k.db.prepare("SELECT 1 FROM bills_lines WHERE player_id = ? AND world_id = ? AND bill_id = 'housing-property-tax' AND month = (SELECT MAX(month) FROM bills_lines WHERE player_id = ? AND world_id = ?)").get(playerId, worldId, playerId, worldId);
export const defaultOptions = (items) => { const d = {}; for (const r of items) if (!r.required && !(r.slot in d)) d[r.slot] = r.option; return d; };
// A choice whose option was retired from the catalogue falls back to the slot's default, so the student is not silently unbilled.
export const pickOf = (items, choices, defaults, slot) => (items.some((r) => r.slot === slot && r.option === choices[slot]) ? choices[slot] : choices[slot] === 'none' ? 'none' : defaults[slot]);
export const billsFor = (items, choices, defaults) => items.filter((r) => r.required || pickOf(items, choices, defaults, r.slot) === r.option);
export const lateFee = (k, amount) => Math.max(k.config.lateFeeCents ?? LATE_FEE.cents, Math.round(amount * (k.config.lateFeePct ?? LATE_FEE.pct) / 100));

// Every slot's effective option for a student (their choice, else the slot default), for module.bills.choices.
export const optionsOf = (items, choices) => ({ ...defaultOptions(items), ...choices });
export const choicesPayload = (k, items, playerId, choices) => ({ playerId, options: optionsOf(items, choices), autoPremiumCents: items.find((r) => r.id === 'car-insurance')?.amount_cents ?? 0 });

const cardInfo = (k, playerId) => {
  const acct = k.ledger.accountId('player', playerId, 'card');
  if (!acct) return null;
  const lim = limitOf(k, playerId) ?? null;
  const balance_cents = k.ledger.balance(acct);
  return { balance_cents, limit_cents: lim, available_cents: lim === null ? null : Math.max(0, balance_cents + lim) };
};

export const state = (k, user) => {
  const w = k.world.current();
  const month = w.month;
  const chq = k.ledger.accountId('player', user.id, 'chequing');
  const all = catalogue(k), items = forAge(all, ageNow(k), ownerOf(k, user.id, w.id));   // the rows that apply to this student at the world's age now
  const defaults = defaultOptions(all);
  const mine = Object.fromEntries(k.db.prepare('SELECT slot, option FROM bills_choices WHERE player_id = ?').all(user.id).map((r) => [r.slot, r.option]));
  const rows = k.db.prepare('SELECT * FROM bills_due WHERE player_id = ? AND world_id = ? AND (paid_txn IS NULL OR due_month = ?) ORDER BY due_month, id').all(user.id, w.id, month);
  const bills = rows.map((d) => ({ id: d.id, bill_id: d.bill_id, name: d.name, category: d.category, amount: d.amount, due_month: d.due_month, paid: d.paid_txn !== null, paid_month: d.paid_month, late: !!d.late, late_fee_cents: d.late_fee_cents }));
  const thisMonth = rows.filter((d) => d.due_month === month);
  const sum = (f) => thisMonth.filter(f).reduce((s, d) => s + d.amount, 0);
  const net = k.db.prepare('SELECT net_cents FROM bills_pay WHERE player_id = ? AND world_id = ? AND month = ?').get(user.id, w.id, month)?.net_cents ?? 0;
  const needs = sum((d) => d.category === 'needs'), wants = sum((d) => d.category === 'wants'), fees = sum((d) => d.category === 'fees');
  const left = net - needs - wants - fees;
  const slots = [...new Set(items.filter((r) => !r.required).map((r) => r.slot))].map((slot) => {
    const options = [...new Map(items.filter((r) => r.slot === slot).map((r) => [r.option, r.option_label])).entries()].map(([option, label]) => ({
      option, label, amount: items.filter((r) => r.slot === slot && r.option === option).reduce((s, r) => s + r.amount_cents, 0),
    }));
    return { slot, label: SLOT_LABELS[slot] ?? slot, current: pickOf(items, mine, defaults, slot), options: [...options, { option: 'none', label: 'None', amount: 0 }] };
  });
  return {
    month, balance_cents: k.ledger.balance(chq), card: cardInfo(k, user.id),
    owed_cents: ((a) => (a ? 0 - k.ledger.balance(a) : 0))(k.ledger.accountId('player', user.id, 'payable')),   // every unpaid bill (the ledger's payable account)
    overdue_cents: k.db.prepare('SELECT COALESCE(SUM(amount), 0) AS n FROM bills_due WHERE player_id = ? AND world_id = ? AND paid_txn IS NULL AND late = 1').get(user.id, w.id).n,   // the late part of it
    pay_from: k.db.prepare('SELECT pay_from FROM bills_settings WHERE player_id = ?').get(user.id)?.pay_from ?? 'chequing',   // the student's choice
    paying_from: source(k, user.id).kind,                                                                                        // what actually pays (chequing until a card's limit is known)
    autopay: !!k.db.prepare('SELECT autopay FROM bills_settings WHERE player_id = ?').get(user.id)?.autopay,
    bills, slots,
    budget: { net_pay: net, needs, wants, fees, left, targets: TARGETS, pct: net > 0 ? { needs: Math.round(needs * 100 / net), wants: Math.round(wants * 100 / net), savings: Math.round(Math.max(0, left) * 100 / net) } : null },
    history: k.db.prepare('SELECT name, due_month, months_late, fee_cents, paid_month FROM bills_history WHERE player_id = ? AND world_id = ? ORDER BY id DESC LIMIT 20').all(user.id, w.id),
    catalogue: items.map((r) => ({ id: r.id, name: r.name, amount_cents: r.amount_cents, required: !!r.required, source_note: r.source_note, source_url: r.source_url, checked: r.checked, illustrative: !!r.illustrative })),
    late_fee: { cents: k.config.lateFeeCents ?? LATE_FEE.cents, pct: k.config.lateFeePct ?? LATE_FEE.pct },
  };
};
