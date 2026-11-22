// bills: building the month's bills (lines other modules ask us to bill), the month tick, and accepting those lines.
import { forAge } from './catalogue.js';
import { catalogue, ageNow, defaultOptions, billsFor, lateFee, choicesPayload } from './reads.js';
import { payAll, payableOf } from './pay.js';

// Lines other modules asked us to bill for a month (stored by the costs / expense listeners): housing-<key>, insurance-<key>, event-<id>.
// When a student has any housing line, it replaces the catalogue rent line.
const extraLines = (k, playerId, worldId, month) => k.db.prepare('SELECT bill_id, name, amount, category FROM bills_lines WHERE player_id = ? AND world_id = ? AND month = ? ORDER BY rowid').all(playerId, worldId, month);
const issueLines = (k, playerId, worldId, month, lines) => {
  for (const l of lines) k.db.prepare('INSERT OR IGNORE INTO bills_due (player_id, world_id, bill_id, name, category, amount, due_month) VALUES (?, ?, ?, ?, ?, ?, ?)').run(playerId, worldId, l.bill_id, l.name, l.category, l.amount, month);
};

export const startsAfter = (k) => (k.config.startAfter === 'pay' ? 'pay' : 'login');
// Per season: a new world starts every student's billing clock again (from their first pay or login in that season).
export const setStart = (k, playerId, month) => { const w = k.world.current(); if (w) k.db.prepare('INSERT OR IGNORE INTO bills_start (player_id, world_id, start_month) VALUES (?, ?, ?)').run(playerId, w.id, month + 1); };

export function tick(k, { month, startMonth, classes }) {
  const w = k.world.current();
  const ids = classes.flatMap((c) => c.studentIds);
  if (!ids.length) return;
  const items = catalogue(k);
  const defaults = defaultOptions(items);
  const age = ageNow(k), byTenure = [forAge(items, age, false), forAge(items, age, true)];   // the rows billed this month, for a renter and an owner
  const choices = new Map();
  for (const r of k.db.prepare('SELECT player_id, slot, option FROM bills_choices').all()) (choices.get(r.player_id) ?? choices.set(r.player_id, {}).get(r.player_id))[r.slot] = r.option;
  const autopay = new Set(k.db.prepare('SELECT player_id FROM bills_settings WHERE autopay = 1').all().map((r) => r.player_id));
  const late = k.db.prepare('SELECT * FROM bills_due WHERE player_id = ? AND world_id = ? AND paid_txn IS NULL AND due_month <= ? ORDER BY due_month, id');
  const markLate = k.db.prepare('UPDATE bills_due SET late = 1, late_month = ?, late_fee_cents = ? WHERE id = ?');
  const notOwed = k.db.prepare('SELECT id, name, amount FROM bills_due WHERE player_id = ? AND world_id = ? AND paid_txn IS NULL AND owed_month IS NULL ORDER BY id');
  const markOwed = k.db.prepare('UPDATE bills_due SET owed_month = ? WHERE id = ?');
  const history = k.db.prepare(`INSERT INTO bills_history (player_id, world_id, due_id, bill_id, name, due_month, months_late, fee_cents)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT (due_id) DO UPDATE SET months_late = excluded.months_late`);
  const issue = k.db.prepare('INSERT OR IGNORE INTO bills_due (player_id, world_id, bill_id, name, category, amount, due_month) VALUES (?, ?, ?, ?, ?, ?, ?)');
  const known = k.db.prepare('INSERT OR IGNORE INTO bills_known (player_id, world_id) VALUES (?, ?)');   // changes = 1 the first time: announce this student's plans
  const housedFlag = k.db.prepare('SELECT housed FROM bills_housed WHERE player_id = ? AND world_id = ? AND month = ?');
  const started = new Set(k.db.prepare('SELECT player_id FROM bills_start WHERE world_id = ? AND start_month <= ?').all(k.world.current().id, month).map((r) => r.player_id));

  k.forEachPlayer(ids, (id) => {                                             // each student in its own savepoint (docs/modules.md section 5)
    if (!started.has(id) || !k.ledger.accountId('player', id, 'chequing')) return;
    // 1. This month's bills.
    const xl = extraLines(k, id, w.id, month);
    issueLines(k, id, w.id, month, xl);
    const flag = housedFlag.get(id, w.id, month)?.housed;                    // 6b: housing says so (a student-unit tenant has no housing line at all)
    const housed = flag === undefined ? xl.some((l) => l.bill_id.startsWith('housing-')) : flag === 1;
    const owner = xl.some((l) => l.bill_id === 'housing-property-tax');
    for (const b of billsFor(byTenure[owner ? 1 : 0], choices.get(id) ?? {}, defaults)) if (!(housed && b.id === 'rent')) issue.run(id, w.id, b.id, b.name, b.category, b.amount_cents, month);
    if (known.run(id, w.id).changes) k.events.emit('choices', choicesPayload(k, byTenure[0], id, choices.get(id) ?? {}));   // the slots that apply at this age
    // 2. Anything still unpaid that was due by the month this advance started is late. A bill earns one fee line, once (the late flag);
    //    a fee line earns none. The history row grows by a month each tick.
    for (const d of late.all(id, w.id, startMonth)) {
      let fee = 0;
      const first = !d.late;                                                 // this tick marks it late for the first time (stress counts a repeat at half weight)
      if (!d.late) {
        fee = d.category === 'fees' ? 0 : lateFee(k, d.amount);
        if (fee > 0) issue.run(id, w.id, `late-fee-${d.id}`, `Late fee: ${d.name}`, 'fees', fee, month);
        markLate.run(month, fee, d.id);
      }
      history.run(id, w.id, d.id, d.bill_id, d.name, d.due_month, month - d.due_month, d.late ? d.late_fee_cents : fee);
      k.events.emit('late', { playerId: id, worldId: w.id, month, billId: d.bill_id, monthsLate: month - d.due_month, first });
    }
    // 3. Everything issued this tick (bills and fee lines; also unpaid rows from before migration 008) is now owed: one txn per student.
    const fresh = notOwed.all(id, w.id);
    if (fresh.length) {
      const total = fresh.reduce((t, d) => t + d.amount, 0);
      const memo = `Billed: ${fresh.map((d) => d.name).join(', ')}`.slice(0, 500);
      k.ledger.post({ kind: 'owed', meta: { month, dueIds: fresh.map((d) => d.id) }, legs: [
        { account: payableOf(k, id), cents: -total, memo }, { account: k.ledger.system('sink'), cents: total, memo }] });
      for (const d of fresh) markOwed.run(month, d.id);
    }
    // 4. Autopay, last, so it can pay the fee lines too: oldest first.
    if (autopay.has(id)) payAll(k, id, w.id, month, true);
  });
}

// One listener body for every module that hands us lines: validated, stored per month as '<prefix>-<key>', applied this month or (when this
// month was already issued) next month.
// housed (housing only, 6b): true/false = whether this student's home replaces the catalogue rent line that month; kept with the same one-month shift as the lines.
export function acceptLines(k, playerId, month, lines, prefix, housed) {
  const w = k.world.current();
  const ok = (Array.isArray(lines) ? lines : []).filter((l) => l && typeof l.key === 'string' && l.key && Number.isSafeInteger(l.amount) && l.amount > 0)
    .map((l) => ({ bill_id: `${prefix}-${l.key}`, name: String(l.name ?? l.key), amount: l.amount, category: ['needs', 'wants', 'fees'].includes(l.category) ? l.category : 'needs' }));
  const flag = typeof housed === 'boolean';
  if (!w || (!ok.length && !flag) || !Number.isSafeInteger(month) || !Number.isSafeInteger(playerId)) return;
  const issued = k.db.prepare("SELECT 1 FROM bills_due WHERE player_id = ? AND world_id = ? AND bill_id = 'utilities' AND due_month = ?").get(playerId, w.id, month);   // utilities is required: issued with every month
  const forMonth = issued ? month + 1 : month;
  if (issued && ok.length) k.log.warn(`${prefix} lines for month ${month} arrived after bills issued it; applying from month ${forMonth} (load ${prefix} before bills)`);
  k.db.txn(() => {
    if (flag) k.db.prepare('INSERT OR REPLACE INTO bills_housed (player_id, world_id, month, housed) VALUES (?, ?, ?, ?)').run(playerId, w.id, forMonth, housed ? 1 : 0);
    for (const l of ok) k.db.prepare('INSERT OR REPLACE INTO bills_lines (player_id, world_id, month, bill_id, name, amount, category) VALUES (?, ?, ?, ?, ?, ?, ?)').run(playerId, w.id, forMonth, l.bill_id, l.name, l.amount, l.category);
  });
}
