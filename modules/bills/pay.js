// bills: paying a due row (card limit, pay source, refusals), pay all, and the autopay / pay-from settings.
import { money } from '../../lib/kernel.js';

// The card limit for this season (credit announced it for this world), or undefined.
export const limitOf = (k, userId) => k.db.prepare('SELECT limit_cents FROM bills_limits WHERE player_id = ? AND world_id = ?').get(userId, k.world.current().id)?.limit_cents;

// Where this student pays from: chequing, or the card when they chose it and have one (and `chequingOnly` is off). avail = what can still be spent.
export function source(k, userId, chequingOnly = false) {
  const pf = k.db.prepare('SELECT pay_from FROM bills_settings WHERE player_id = ?').get(userId)?.pay_from;
  const card = pf === 'card' && !chequingOnly ? k.ledger.accountId('player', userId, 'card') : undefined;
  const lim = card ? limitOf(k, userId) : undefined;
  if (card && lim !== undefined) return { kind: 'card', account: card, avail: k.ledger.balance(card) + lim };
  // No card, or the card's limit isn't known yet: chequing (so autopay never silently pays nothing).
  const chq = k.ledger.accountId('player', userId, 'chequing');
  return { kind: 'chequing', account: chq, avail: chq ? k.ledger.balance(chq) : 0 };
}
export const refusal = (src, what, amount) => src.kind === 'card'
  ? (src.avail === null ? 'Card payments are unavailable: your card limit is not known yet.' : `Not enough room on your card: ${what} is ${money(amount)} and you have ${money(Math.max(0, src.avail))} available.`)
  : `Not enough in chequing: ${what} is ${money(amount)} and you have ${money(src.avail)}.`;

// Pays one due row from the student's chosen source. Returns null when paid, else the reason it was refused.
// auto (autopay only): a card with no room for this bill pays it from chequing instead.
// A row already owed pays off the payable account (the sink was paid at issue). A row from before migration 008 that has not been through a
// tick yet (owed_month NULL) pays the sink, as before.
export function payDue(k, userId, due, month, auto = false) {
  let src = source(k, userId);
  if (auto && src.kind === 'card' && src.avail < due.amount) src = source(k, userId, true);
  if (!src.account || src.avail === null || src.avail < due.amount) return refusal(src, due.name, due.amount);
  const owed = due.owed_month !== null;
  return k.db.txn(() => {
    const txn = k.ledger.post({
      kind: 'payment', actor: `player:${userId}`, meta: { dueId: due.id, bill: due.bill_id, month: due.due_month, from: src.kind, ...(!owed && { direct: true }) },
      legs: [{ account: src.account, cents: -due.amount, memo: `Paid ${due.name}` },
        { account: owed ? k.ledger.accountId('player', userId, 'payable') : k.ledger.system('sink'), cents: due.amount, memo: `Paid ${due.name}` }],
    });
    k.db.prepare('UPDATE bills_due SET paid_txn = ?, paid_month = ? WHERE id = ? AND paid_txn IS NULL').run(txn, month, due.id);
    k.db.prepare('UPDATE bills_history SET paid_month = ? WHERE due_id = ?').run(month, due.id);
    // On time = never judged late. Comparing paid month to due month would call a bill issued during a multi-month advance and paid in the
    // next live month late, though bills never marked it (lateness is judged only up to startMonth).
    k.events.emit('paid', { playerId: userId, worldId: due.world_id, month, dueMonth: due.due_month, billId: due.bill_id, onTime: !due.late, amount: due.amount });
    return null;
  });
}

export const payableOf = (k, playerId) => k.ledger.openAccount({ ownerType: 'player', ownerId: playerId, kind: 'payable', allowNegative: true });

export const unpaid = (k, playerId, worldId) => k.db.prepare('SELECT * FROM bills_due WHERE player_id = ? AND world_id = ? AND paid_txn IS NULL ORDER BY due_month, id').all(playerId, worldId);

// In bill order (oldest first, rent first), pays what the source covers. Returns { paid, left } counts.
export function payAll(k, userId, worldId, month, auto = false) {
  let paid = 0;
  const rows = unpaid(k, userId, worldId);
  for (const d of rows) if (payDue(k, userId, d, month, auto) === null) paid++;
  return { paid, left: rows.length - paid };
}

export const setPayFrom = (k, playerId, from) => k.db.prepare('INSERT INTO bills_settings (player_id, pay_from) VALUES (?, ?) ON CONFLICT (player_id) DO UPDATE SET pay_from = excluded.pay_from').run(playerId, from);
export const setAutopay = (k, playerId, on) => k.db.prepare('INSERT INTO bills_settings (player_id, autopay) VALUES (?, ?) ON CONFLICT (player_id) DO UPDATE SET autopay = excluded.autopay').run(playerId, on ? 1 : 0);
