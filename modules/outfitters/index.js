// outfitters: a store for wardrobe and home items (docs/outfitters.md). COSMETIC ONLY: nothing here gives money, a rate, a score or any advantage.
// Buying: price (catalogue x the world price index) + 5% GST = total, paid from chequing (kind 'purchase', chequing -> sink) or the credit card, within
// this season's limit (module.credit.limit, kept per player and world like bills does). Every item shows what that total would grow to in 5 years if
// invested instead (the opportunity-cost lesson). Selling: the mint pays the current value, price paid (before GST) x (1 - depreciation)^months owned,
// floored to the cent (kind 'resale'); an item bought on the card is refunded to the card first, up to what it owes, the rest to chequing.
// An item is owned once per student per world; equip one item per slot. Everything is per world (season).
// Achievement items are not for sale: they unlock from EVENTS only (no other module's tables):
//   credit750  module.credit.score >= 750            firstkeys  first module.housing.value with homeValue > 0
//   ontime     6 world months in a row with a bill paid on time and no late bill (module.bills.paid booked on its dueMonth / .late; judged at
//              our tick up to startMonth, so a bill left unpaid at month end, which bills flags late at the next tick, cannot slip through)
//   promoted   module.jobs.promoted                  emergency   module.savings.snapshot hisa >= 3 x monthly bills
//              (monthly bills = the largest month of module.bills.paid amounts in the last 3 months; with no bills yet, last net pay from module.jobs.paid)
// Class goals: when 80% of a class meets a goal in a world month (checked at our tick), the class unlocks a Wolf outfit (an art key; plain wolf until the art exists).
// Events out: module.outfitters.bought { playerId, itemId, category, cents }, .sold { playerId, itemId, cents }, .refund { playerId, worldId, cents, boughtMonth } (in the sale's
// transaction), .unlocked { playerId, key, itemId }, .changed { classId }.
import { defineModule } from '../../lib/modules.js';
import { money, dice, ok } from '../../lib/kernel.js';
import { itemRows } from './constants.js';
import {
  GST_BP, GST_URL, PROJECTION_BP, PROJECTION_YEARS, PROJECTION_URL, STREAK_MONTHS, EMERGENCY_MONTHS, SCORE_GOAL, GOAL_SHARE_PCT, GOAL_MEDIAN_SCORE, GOALS, ACHIEVEMENTS, VENTURE_ITEMS,
  seedSql, gstOf, growTo, resaleValue,
} from './constants.js';

const median = (xs) => { const s = [...xs].sort((a, b) => a - b), m = s.length >> 1; return s.length % 2 ? s[m] : Math.floor((s[m - 1] + s[m]) / 2); };

// ---- prices ----
const projectionBp = (k) => (ok(k.config.projectionBp) && k.config.projectionBp >= 0 && k.config.projectionBp <= 2000 ? k.config.projectionBp : PROJECTION_BP);
// The price today: the catalogue price (or the deployment's override) x the world price index.
const priceOf = (k, worldId, item) => {
  const over = k.config.prices?.[item.id];
  return Math.round(((ok(over) && over > 0 ? over : item.price_cents) * k.world.priceIndex(worldId)) / 10000);
};
const quote = (k, worldId, item) => {
  const price = priceOf(k, worldId, item), gst = gstOf(price), total = price + gst;
  return { price_cents: price, gst_cents: gst, total_cents: total, grow_cents: growTo(total, projectionBp(k), PROJECTION_YEARS) };
};
const itemRow = (k, id) => k.db.prepare('SELECT * FROM outfitters_items WHERE id = ?').get(id);   // retired rows too: owned items still join it
const storeOpen = (k, worldId) => k.db.prepare('SELECT open FROM outfitters_store WHERE world_id = ?').get(worldId)?.open !== 0;

// ---- per (player, world) facts learned from events ----
const FACT = new Set(['score', 'hisa', 'net', 'streak']);
function setFact(k, playerId, worldId, col, value) {
  if (!FACT.has(col)) throw new Error(`unknown fact ${col}`);
  k.db.prepare(`INSERT INTO outfitters_facts (player_id, world_id, ${col}) VALUES (?, ?, ?) ON CONFLICT (player_id, world_id) DO UPDATE SET ${col} = excluded.${col}`).run(playerId, worldId, value);
}
const facts = (k, playerId, worldId) => k.db.prepare('SELECT * FROM outfitters_facts WHERE player_id = ? AND world_id = ?').get(playerId, worldId) ?? {};

// Monthly bills as far as we can tell: the largest month of bill payments in the last 3 months, else the last net pay.
const billsBase = (k, playerId, worldId, month) => {
  const m = k.db.prepare('SELECT MAX(paid_cents) AS c FROM outfitters_bills WHERE player_id = ? AND world_id = ? AND month > ?').get(playerId, worldId, month - 3)?.c;
  return m > 0 ? { cents: m, from: 'bills' } : (facts(k, playerId, worldId).net > 0 ? { cents: facts(k, playerId, worldId).net, from: 'pay' } : { cents: 0, from: null });
};

// Unlocks an achievement once per (player, world): the row, the free item, the event. Returns true the first time.
function unlock(k, playerId, worldId, key, month) {
  const a = ACHIEVEMENTS.find((x) => x.key === key);
  if (!a || !k.db.prepare('INSERT OR IGNORE INTO outfitters_unlocks (player_id, world_id, key, month) VALUES (?, ?, ?, ?)').run(playerId, worldId, key, month ?? 0).changes) return false;
  k.db.prepare("INSERT OR IGNORE INTO outfitters_owned (player_id, world_id, item_id, price_cents, gst_cents, month_bought, via) VALUES (?, ?, ?, 0, 0, ?, 'achievement')").run(playerId, worldId, a.item.id, month ?? 0);
  k.events.emit('unlocked', { playerId, key, itemId: a.item.id });
  return true;
}

// grantItem with a `sector` (docs/modules.md "Services"): the ventures module gives a storefront buyer the Venture Row item for the company's sector.
// Free here (the buyer paid the company), never resold to the mint, owned once per student and season: a second purchase from the same
// sector is only a receipt line (granted: false). Stored like an achievement item (via 'achievement': no price, no resale value).
function grantVentureItem(k, args) {
  const { playerId, worldId, sector } = args ?? {};
  const item = typeof sector === 'string' && Object.hasOwn(VENTURE_ITEMS, sector) ? VENTURE_ITEMS[sector] : null;
  if (!ok(playerId) || !k.players.student(playerId) || !item) throw new k.HttpError(400, 'grantItem: needs a student playerId and a town sector');
  const w = k.world.current(), wid = ok(worldId) ? worldId : w?.id;
  const r = k.db.prepare("INSERT OR IGNORE INTO outfitters_owned (player_id, world_id, item_id, price_cents, gst_cents, month_bought, via) VALUES (?, ?, ?, 0, 0, ?, 'achievement')").run(playerId, wid, item.id, w?.month ?? 0);
  return { itemId: item.id, name: item.name, granted: r.changes > 0 };
}

// ---- buying and selling ----
const limitOf = (k, playerId, worldId) => k.db.prepare('SELECT limit_cents FROM outfitters_limits WHERE player_id = ? AND world_id = ?').get(playerId, worldId)?.limit_cents;
function cardOf(k, playerId, worldId) {
  const account = k.ledger.accountId('player', playerId, 'card');
  const limit = account ? limitOf(k, playerId, worldId) : undefined;
  return account ? { account, limit, available: limit === undefined ? null : Math.max(0, k.ledger.balance(account) + limit) } : null;
}

function buy(k, user, itemId, source) {
  const w = k.world.current();
  if (!w) throw new k.HttpError(409, 'There is no active world');
  if (!storeOpen(k, w.id)) throw new k.HttpError(409, 'The store is closed right now');
  const item = itemRow(k, itemId);
  if (!item || item.unlock || !item.active) throw new k.HttpError(400, 'That is not an item you can buy');
  if (source !== 'chequing' && source !== 'card') throw new k.HttpError(400, 'Pay from chequing or card');
  const q = quote(k, w.id, item);
  let account, why = null;
  if (source === 'card') {
    const card = cardOf(k, user.id, w.id);
    if (!card) throw new k.HttpError(400, 'You do not have a credit card yet');
    if (card.available === null) throw new k.HttpError(400, 'Card payments are unavailable: your card limit for this season is not known yet.');
    account = card.account;
    if (card.available < q.total_cents) why = `Not enough room on your card: ${item.name} is ${money(q.total_cents)} and you have ${money(card.available)} available.`;
  } else {
    account = k.ledger.accountId('player', user.id, 'chequing');
    if (!account) throw new k.HttpError(400, 'You have no chequing account');
    if (k.ledger.balance(account) < q.total_cents) why = `Not enough in chequing: ${item.name} is ${money(q.total_cents)} and you have ${money(k.ledger.balance(account))}.`;
  }
  if (why) throw new k.HttpError(400, why);
  return k.db.txn((tx) => {
    if (k.db.prepare('SELECT 1 FROM outfitters_owned WHERE player_id = ? AND world_id = ? AND item_id = ? AND sold_month IS NULL').get(user.id, w.id, item.id)) throw new k.HttpError(409, 'You already own that');
    const txn = k.ledger.post({
      kind: 'purchase', actor: `player:${user.id}`, meta: { item: item.id, price: q.price_cents, gst: q.gst_cents, month: w.month, from: source },
      legs: [{ account, cents: -q.total_cents, memo: `${item.name} (incl. GST)` }, { account: k.ledger.system('sink'), cents: q.total_cents, memo: `${item.name} (incl. GST)` }],
    });
    k.db.prepare('INSERT INTO outfitters_owned (player_id, world_id, item_id, price_cents, gst_cents, month_bought, via, txn) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .run(user.id, w.id, item.id, q.price_cents, q.gst_cents, w.month, source, txn);
    tx.onCommit(() => {
      k.events.emit('bought', { playerId: user.id, itemId: item.id, category: item.category, cents: q.total_cents });
      k.events.emit('changed', { classId: user.class_id });
    });
    return { ok: true, ...q, source };
  });
}

const ownedValue = (o, w) => resaleValue(o.price_cents, o.dep_bp, w.month - o.month_bought);

function sell(k, user, ownedId) {
  const w = k.world.current();
  if (!w) throw new k.HttpError(409, 'There is no active world');
  if (!storeOpen(k, w.id)) throw new k.HttpError(409, 'The store is closed right now');
  return k.db.txn((tx) => {
    const o = k.db.prepare('SELECT o.*, i.dep_bp, i.name, i.unlock FROM outfitters_owned o JOIN outfitters_items i ON i.id = o.item_id WHERE o.id = ? AND o.player_id = ? AND o.world_id = ?').get(ownedId, user.id, w.id);
    if (!o || o.sold_month !== null) throw new k.HttpError(404, 'You do not own that');
    if (o.via === 'achievement') throw new k.HttpError(400, o.unlock === 'venture' ? 'You bought that on Venture Row: it cannot be sold back here' : 'You earned that one: it cannot be sold');
    const value = ownedValue(o, w);
    if (value <= 0) throw new k.HttpError(400, 'That is worth nothing now');
    const chq = k.ledger.accountId('player', user.id, 'chequing');
    // Bought on the card: the money goes back to the card first (a store refunds to the original payment method), up to what the card
    // owes now; only what is left (the card was already paid) reaches chequing. Without this, buy on the card + resell = a cash advance (B16).
    const card = o.via === 'card' ? k.ledger.accountId('player', user.id, 'card') : null;
    const toCard = card ? Math.min(value, Math.max(0, -k.ledger.balance(card))) : 0;
    const txn = k.ledger.post({
      kind: 'resale', actor: `player:${user.id}`, meta: { item: o.item_id, paid: o.price_cents, months: w.month - o.month_bought, month: w.month, ...(toCard && { to_card: toCard }) },
      legs: [{ account: k.ledger.system('mint'), cents: -value, memo: `Sold ${o.name}` },
        ...(toCard ? [{ account: card, cents: toCard, memo: `Refund: ${o.name}` }] : []), ...(value > toCard ? [{ account: chq, cents: value - toCard, memo: `Sold ${o.name}` }] : [])],
    });
    // module.outfitters.refund, inside this transaction: a credit to the card, not a payment. boughtMonth tells credit whether the purchase was on
    // the open statement (bought before the tick that issued it), so the refund settles that statement's balance or only the next one's.
    if (toCard) k.events.emit('refund', { playerId: user.id, worldId: w.id, cents: toCard, boughtMonth: o.month_bought });
    k.db.prepare('UPDATE outfitters_owned SET sold_month = ?, sold_cents = ?, sold_txn = ?, equipped = 0 WHERE id = ?').run(w.month, value, txn, o.id);
    tx.onCommit(() => { k.events.emit('sold', { playerId: user.id, itemId: o.item_id, cents: value }); k.events.emit('changed', { classId: user.class_id }); });
    return { ok: true, paid_cents: o.price_cents, value_cents: value, to_card_cents: toCard };
  });
}

function equip(k, user, ownedId, on) {
  const w = k.world.current();
  return k.db.txn(() => {
    const o = k.db.prepare('SELECT o.id, i.slot FROM outfitters_owned o JOIN outfitters_items i ON i.id = o.item_id WHERE o.id = ? AND o.player_id = ? AND o.world_id = ? AND o.sold_month IS NULL').get(ownedId, user.id, w.id);
    if (!o) throw new k.HttpError(404, 'You do not own that');
    if (on) k.db.prepare('UPDATE outfitters_owned SET equipped = 0 WHERE player_id = ? AND world_id = ? AND equipped = 1 AND item_id IN (SELECT id FROM outfitters_items WHERE slot = ?)').run(user.id, w.id, o.slot);
    k.db.prepare('UPDATE outfitters_owned SET equipped = ? WHERE id = ?').run(on ? 1 : 0, o.id);
    return { ok: true };
  });
}

// ---- class goals ----
function goalProgress(k, classId, worldId) {
  const ids = k.players.inClass(classId).map((s) => s.id);
  const rows = ids.length ? k.db.prepare('SELECT streak, score FROM outfitters_facts WHERE world_id = ? AND player_id IN (SELECT value FROM json_each(?))').all(worldId, JSON.stringify(ids)) : [];
  const done = new Map(k.db.prepare('SELECT goal, month FROM outfitters_goals WHERE class_id = ? AND world_id = ?').all(classId, worldId).map((r) => [r.goal, r.month]));
  const scores = rows.map((r) => r.score).filter((s) => ok(s));
  const onTime = rows.filter((r) => r.streak >= 1).length;
  const share = (n) => (ids.length ? Math.floor((n * 100) / ids.length) : 0);
  const by = {
    ontime: { pct: share(onTime), met: ids.length > 0 && onTime * 100 >= GOAL_SHARE_PCT * ids.length },
    credit: { pct: share(scores.length), median: scores.length ? median(scores) : null, met: ids.length > 0 && scores.length * 100 >= GOAL_SHARE_PCT * ids.length && median(scores) >= GOAL_MEDIAN_SCORE },
  };
  const goals = GOALS.map((g) => ({ key: g.key, name: g.name, how: g.how, outfit: g.outfit, outfit_name: g.outfitName, ...by[g.key], unlocked: done.has(g.key), unlocked_month: done.get(g.key) ?? null }));
  const last = [...done.entries()].sort((a, b) => b[1] - a[1]).map(([key]) => GOALS.find((g) => g.key === key)).find(Boolean);
  return { students: ids.length, goals, outfit: last ? { key: last.outfit, name: last.outfitName } : null };
}

// ---- tick: the "on time" streak, then the class goals ----
// Streak = consecutive settled months (up to startMonth, the last month students had live; bills judges lateness only that far) each with an
// on-time payment booked on it and no bad mark, and no late flag at any tick of this advance. Payments are booked on the bill's due month, so
// a month's bills paid by hand in a later live month count for that month, exactly like autopay at its tick. Months issued during a multi-month
// advance are judged at the next advance (same rule as bills). In a 1-month advance startMonth = month - 1: judged one month late, as before.
function tick(k, { month, startMonth = month - 1, classes }) {
  const w = k.world.current();
  const have = new Set(k.db.prepare("SELECT player_id FROM outfitters_unlocks WHERE world_id = ? AND key = 'ontime'").all(w.id).map((r) => r.player_id));
  const rowsIn = k.db.prepare('SELECT player_id, month, ok, bad FROM outfitters_bm WHERE world_id = ? AND month BETWEEN ? AND ? AND player_id IN (SELECT value FROM json_each(?))');
  for (const c of classes) {
    if (!c.studentIds.length) continue;
    const by = new Map();
    for (const r of rowsIn.all(w.id, startMonth - STREAK_MONTHS + 1, month, JSON.stringify(c.studentIds))) (by.get(r.player_id) ?? by.set(r.player_id, new Map()).get(r.player_id)).set(r.month, r);
    k.forEachPlayer(c.studentIds, (id) => {                                      // each student in its own savepoint; the class goals below are class-wide
      const m = by.get(id);
      let s = 0, lateNow = false;
      for (let j = startMonth + 1; j <= month; j++) if (m?.get(j)?.bad) lateNow = true;
      if (m && !lateNow) for (let j = startMonth; j > startMonth - STREAK_MONTHS; j--) { const r = m.get(j); if (r && r.ok > 0 && !r.bad) s++; else break; }
      setFact(k, id, w.id, 'streak', s);
      if (s >= STREAK_MONTHS && !have.has(id)) unlock(k, id, w.id, 'ontime', month);
    });
    const p = goalProgress(k, c.id, w.id);
    for (const g of p.goals) {
      if (g.unlocked || !g.met) continue;
      k.db.prepare('INSERT OR IGNORE INTO outfitters_goals (class_id, world_id, goal, month) VALUES (?, ?, ?, ?)').run(c.id, w.id, g.key, month);
      k.events.emit('goal', { classId: c.id, goal: g.key, outfit: g.outfit, month });
    }
  }
}

// ---- what a student sees ----
const itemView = (k, w, i, owned) => ({ id: i.id, grp: i.grp, slot: i.slot, name: i.name, category: i.category, icon: i.icon, dep_bp: i.dep_bp, owned: owned.has(i.id), ...quote(k, w.id, i),
  note: i.source_note, source_url: i.source_url, illustrative: !!i.illustrative });

function state(k, user) {
  const w = k.world.current();
  const chq = k.ledger.accountId('player', user.id, 'chequing');
  const owned = k.db.prepare('SELECT o.*, i.grp, i.slot, i.name, i.icon, i.category, i.dep_bp, i.unlock FROM outfitters_owned o JOIN outfitters_items i ON i.id = o.item_id WHERE o.player_id = ? AND o.world_id = ? AND o.sold_month IS NULL ORDER BY o.id').all(user.id, w.id);
  const mine = new Set(owned.map((o) => o.item_id));
  const card = cardOf(k, user.id, w.id);
  const f = facts(k, user.id, w.id);
  const un = new Map(k.db.prepare('SELECT key, month, seen FROM outfitters_unlocks WHERE player_id = ? AND world_id = ?').all(user.id, w.id).map((r) => [r.key, r]));
  const base = billsBase(k, user.id, w.id, w.month);
  const homeKnown = un.has('firstkeys');
  const progress = {
    credit750: { text: f.score ? `Your score: ${f.score} of ${SCORE_GOAL}` : 'No credit score yet', pct: f.score ? Math.min(99, Math.floor((Math.max(0, f.score - 300) * 100) / (SCORE_GOAL - 300))) : 0 },
    firstkeys: { text: homeKnown ? 'You own a home' : 'No home yet', pct: 0 },
    ontime: { text: `${Math.min(f.streak ?? 0, STREAK_MONTHS)} of ${STREAK_MONTHS} months`, pct: Math.floor((Math.min(f.streak ?? 0, STREAK_MONTHS) * 100) / STREAK_MONTHS) },
    promoted: { text: 'No promotion yet', pct: 0 },
    emergency: base.cents > 0 ? { text: `${money(f.hisa ?? 0)} of ${money(EMERGENCY_MONTHS * base.cents)} (3 x ${base.from === 'bills' ? 'your monthly bills' : 'your last pay'})`, pct: Math.min(99, Math.floor(((f.hisa ?? 0) * 100) / (EMERGENCY_MONTHS * base.cents))) } : { text: 'Not enough history yet', pct: 0 },
  };
  const cls = user.class_id ? goalProgress(k, user.class_id, w.id) : null;
  const unseen = ACHIEVEMENTS.filter((a) => un.get(a.key)?.seen === 0);
  return {
    month: w.month, open: storeOpen(k, w.id), index_bp: k.world.priceIndex(w.id), balance_cents: chq ? k.ledger.balance(chq) : 0,
    card: card ? { limit_cents: card.limit ?? null, available_cents: card.available } : null,
    gst: { bp: GST_BP, label: 'GST 5% (Alberta has no PST)', url: GST_URL },
    projection: { bp: projectionBp(k), years: PROJECTION_YEARS, url: PROJECTION_URL, source: 'FP Canada / IQPF 2026 Projection Assumption Guidelines: Canadian equities' },
    items: k.db.prepare('SELECT * FROM outfitters_items WHERE unlock IS NULL AND active = 1 ORDER BY sort').all().map((i) => itemView(k, w, i, mine)),
    owned: owned.map((o) => ({ id: o.id, item_id: o.item_id, grp: o.grp, slot: o.slot, name: o.name, icon: o.icon, category: o.category, equipped: !!o.equipped, earned: o.via === 'achievement', venture: o.unlock === 'venture',
      paid_cents: o.price_cents + o.gst_cents, price_cents: o.price_cents, gst_cents: o.gst_cents, months_owned: w.month - o.month_bought, value_cents: o.via === 'achievement' ? 0 : ownedValue(o, w), dep_bp: o.dep_bp })),
    achievements: ACHIEVEMENTS.map((a) => ({ key: a.key, name: a.item.name, how: a.how, icon: a.item.icon, item_id: a.item.id, unlocked: un.has(a.key), unlocked_month: un.get(a.key)?.month ?? null, ...progress[a.key] })),
    announce: unseen.map((a) => a.item.name),
    class: cls ? { outfit: cls.outfit, goals: cls.goals, students: cls.students } : null,
  };
}

export default defineModule({
  id: 'outfitters',
  options: { prices: '{ <item id>: cents } overrides', projectionBp: 'planning return, bp' },
  catalogues: [{ table: 'outfitters_items', key: ['id'], rows: itemRows }],   // upserted at boot (docs/modules.md "Catalogues")
  requires: ['bank-basic'],

  migrations: [{ id: '001_outfitters', sql: `
CREATE TABLE outfitters_items (
  id TEXT PRIMARY KEY, grp TEXT NOT NULL CHECK (grp IN ('wardrobe','home')), slot TEXT NOT NULL, name TEXT NOT NULL,
  price_cents INTEGER NOT NULL CHECK (price_cents >= 0), category TEXT NOT NULL CHECK (category IN ('need','want')),
  dep_bp INTEGER NOT NULL CHECK (dep_bp >= 0 AND dep_bp < 10000), icon TEXT NOT NULL, unlock TEXT, sort INTEGER NOT NULL,
  source_note TEXT NOT NULL, source_url TEXT NOT NULL, checked TEXT NOT NULL, illustrative INTEGER NOT NULL
);
CREATE TABLE outfitters_owned (
  id INTEGER PRIMARY KEY, player_id INTEGER NOT NULL REFERENCES players(id), world_id INTEGER NOT NULL, item_id TEXT NOT NULL REFERENCES outfitters_items(id),
  price_cents INTEGER NOT NULL, gst_cents INTEGER NOT NULL, month_bought INTEGER NOT NULL, via TEXT NOT NULL CHECK (via IN ('chequing','card','achievement')),
  equipped INTEGER NOT NULL DEFAULT 0, txn INTEGER REFERENCES txns(id), sold_month INTEGER, sold_cents INTEGER, sold_txn INTEGER REFERENCES txns(id)
);
CREATE UNIQUE INDEX outfitters_owned_once ON outfitters_owned(player_id, world_id, item_id) WHERE sold_month IS NULL;
CREATE INDEX outfitters_owned_world ON outfitters_owned(world_id, player_id);
CREATE TABLE outfitters_unlocks (player_id INTEGER NOT NULL REFERENCES players(id), world_id INTEGER NOT NULL, key TEXT NOT NULL, month INTEGER NOT NULL, seen INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (player_id, world_id, key));
CREATE TABLE outfitters_goals (class_id INTEGER NOT NULL, world_id INTEGER NOT NULL, goal TEXT NOT NULL, month INTEGER NOT NULL, PRIMARY KEY (class_id, world_id, goal));
CREATE TABLE outfitters_store (world_id INTEGER PRIMARY KEY, open INTEGER NOT NULL);
-- kept from events (outfitters never reads another module's tables)
CREATE TABLE outfitters_index (world_id INTEGER PRIMARY KEY, index_bp INTEGER NOT NULL);
CREATE TABLE outfitters_limits (player_id INTEGER NOT NULL REFERENCES players(id), world_id INTEGER NOT NULL, limit_cents INTEGER NOT NULL, PRIMARY KEY (player_id, world_id));
CREATE TABLE outfitters_facts (player_id INTEGER NOT NULL REFERENCES players(id), world_id INTEGER NOT NULL, score INTEGER, hisa INTEGER, net INTEGER, streak INTEGER, PRIMARY KEY (player_id, world_id));
CREATE TABLE outfitters_bm (player_id INTEGER NOT NULL REFERENCES players(id), world_id INTEGER NOT NULL, month INTEGER NOT NULL, ok INTEGER NOT NULL DEFAULT 0, bad INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (player_id, world_id, month));
CREATE TABLE outfitters_bills (player_id INTEGER NOT NULL REFERENCES players(id), world_id INTEGER NOT NULL, month INTEGER NOT NULL, paid_cents INTEGER NOT NULL, PRIMARY KEY (player_id, world_id, month));
${seedSql()}` }, { id: '002_active', sql: `
-- 0 = retired from constants.js (set at boot): no longer for sale; owned items keep working
ALTER TABLE outfitters_items ADD COLUMN active INTEGER NOT NULL DEFAULT 1;` }],

  events: {
    'module.credit.limit'(k, { playerId, worldId, limitCents }) {
      if (ok(playerId) && ok(worldId) && ok(limitCents) && limitCents >= 0) k.db.prepare('INSERT INTO outfitters_limits (player_id, world_id, limit_cents) VALUES (?, ?, ?) ON CONFLICT (player_id, world_id) DO UPDATE SET limit_cents = excluded.limit_cents').run(playerId, worldId, limitCents);
    },
    'module.credit.score'(k, { playerId, worldId, month, score }) {
      const w = k.world.current(), wid = ok(worldId) ? worldId : w?.id;
      if (!ok(wid) || !ok(playerId) || !ok(score)) return;
      setFact(k, playerId, wid, 'score', score);
      if (score >= SCORE_GOAL) unlock(k, playerId, wid, 'credit750', month);
    },
    'module.housing.value'(k, { playerId, worldId, homeValue }) {
      const w = k.world.current();
      if (w && ok(playerId) && ok(homeValue) && homeValue > 0) unlock(k, playerId, ok(worldId) ? worldId : w.id, 'firstkeys', w.month);
    },
    // Booked on the bill's due month (dueMonth; the paid month for an older payload): a hand-payer who pays two months of bills in the live month
    // after a 2-month advance gets the same months (and the same "monthly bills") as an autopayer who paid each at its tick.
    'module.bills.paid'(k, { playerId, worldId, month, dueMonth, onTime, amount }) {
      const wid = ok(worldId) ? worldId : k.world.current()?.id, m = ok(dueMonth) ? dueMonth : month;
      if (!ok(wid) || !ok(playerId) || !ok(m) || !ok(amount)) return;
      k.db.prepare(`INSERT INTO outfitters_bm (player_id, world_id, month, ok, bad) VALUES (?, ?, ?, ?, ?) ON CONFLICT (player_id, world_id, month) DO UPDATE SET ok = ok + excluded.ok, bad = MAX(bad, excluded.bad)`).run(playerId, wid, m, onTime ? 1 : 0, onTime ? 0 : 1);
      k.db.prepare('INSERT INTO outfitters_bills (player_id, world_id, month, paid_cents) VALUES (?, ?, ?, ?) ON CONFLICT (player_id, world_id, month) DO UPDATE SET paid_cents = paid_cents + excluded.paid_cents').run(playerId, wid, m, amount);
    },
    'module.bills.late'(k, { playerId, worldId, month }) {
      const wid = ok(worldId) ? worldId : k.world.current()?.id;
      if (ok(wid) && ok(playerId) && ok(month)) k.db.prepare('INSERT INTO outfitters_bm (player_id, world_id, month, ok, bad) VALUES (?, ?, ?, 0, 1) ON CONFLICT (player_id, world_id, month) DO UPDATE SET bad = 1').run(playerId, wid, month);
    },
    'module.jobs.promoted'(k, { playerId, worldId, month }) {
      if (ok(playerId) && ok(worldId)) unlock(k, playerId, worldId, 'promoted', month);
    },
    'module.jobs.paid'(k, { playerId, worldId, net }) {
      if (ok(playerId) && ok(worldId) && ok(net)) setFact(k, playerId, worldId, 'net', net);
    },
    'module.savings.snapshot'(k, { playerId, worldId, month, hisa }) {
      if (!ok(playerId) || !ok(worldId) || !ok(month) || !ok(hisa)) return;
      setFact(k, playerId, worldId, 'hisa', hisa);
      const base = billsBase(k, playerId, worldId, month);
      if (base.cents > 0 && hisa >= EMERGENCY_MONTHS * base.cents) unlock(k, playerId, worldId, 'emergency', month);
    },
  },

  panels: [{ id: 'outfitters', building: { key: 'outfitters', name: 'Outfitters', icon: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 3L3 6l2 4 3-1v11h8V9l3 1 2-4-5-3c-.5 1.500-2 2.500-4 2.500S8.500 4.500 8 3z"/><path d="M10 14h4"/></svg>' }, src: 'outfitters.js' }],
  teacherPanels: [{ id: 'outfitters-teach', title: 'Outfitters', src: 'teach.js' }],

  onTick: tick,

  // k.modules.call('outfitters', 'grantItem', { playerId, itemId }): another module (the Today quests, say) hands a student one of the five earned items
  // (ACHIEVEMENTS: bomber-750, first-keys, on-time-watch, promoted-blazer, emergency-umbrella) in the current world. Catalogue items for sale are NOT
  // grantable (nothing here gives away a purchase), and the Wolf outfits are class goals, not items, so neither is accepted. Same path as an earned
  // unlock: row, owned item, 'unlocked' event, "Unlocked:" banner. Idempotent: a second call returns the same result and changes nothing.
  // Callers guard with k.modules.has('outfitters'): the module may not be enabled for any course.
  services: {
    grantItem(k, args = {}) {
      if (args?.sector !== undefined) return grantVentureItem(k, args);   // ventures: { playerId, worldId, sector } -> { itemId, name, granted }
      const { playerId, itemId } = args ?? {};
      if (!Number.isSafeInteger(playerId) || !k.db.prepare("SELECT 1 FROM players WHERE id = ? AND role = 'student'").get(playerId)) throw new k.HttpError(404, 'grantItem: unknown player');
      const a = ACHIEVEMENTS.find((x) => x.item.id === itemId);
      if (!a) throw new k.HttpError(400, `grantItem: "${String(itemId).slice(0, 40)}" is not a grantable item`);
      const w = k.world.active();
      unlock(k, playerId, w.id, a.key, w.month);
      const row = k.db.prepare('SELECT month FROM outfitters_unlocks WHERE player_id = ? AND world_id = ? AND key = ?').get(playerId, w.id, a.key);
      return { playerId, itemId, key: a.key, worldId: w.id, month: row.month };
    },
  },

  // Bots: one "need" every few months (the cheapest they lack, from chequing, keeping a buffer); 30% buy a "want" when chequing is over 2 months of bills;
  // 10% sell something at least a year old.
  simulate(k, { month, students }) {
    const w = k.world.current();
    const items = k.db.prepare('SELECT * FROM outfitters_items WHERE unlock IS NULL AND active = 1 ORDER BY sort').all();
    const lack = k.db.prepare('SELECT 1 FROM outfitters_owned WHERE player_id = ? AND world_id = ? AND item_id = ? AND sold_month IS NULL');
    for (const s of students) {
      const chq = k.ledger.accountId('player', s.id, 'chequing');
      if (!chq) continue;
      const user = { id: s.id, class_id: s.class_id };
      const bal = k.ledger.balance(chq), bills = billsBase(k, s.id, w.id, month).cents || 138500;
      const tryBuy = (i) => { try { buy(k, user, i.id, 'chequing'); return true; } catch { return false; } };
      if (dice(s.id, 0, 11) < 10) {
        const old = k.db.prepare("SELECT id FROM outfitters_owned WHERE player_id = ? AND world_id = ? AND sold_month IS NULL AND via != 'achievement' AND ? - month_bought >= 12 ORDER BY month_bought, id LIMIT 1").get(s.id, w.id, month);
        if (old) try { sell(k, user, old.id); } catch { /* closed store or worthless: fine */ }
      }
      if ((month + s.id) % 4 === 0) {
        const need = items.filter((i) => i.category === 'need' && !lack.get(s.id, w.id, i.id)).sort((a, b) => priceOf(k, w.id, a) - priceOf(k, w.id, b))[0];
        if (need && bal >= quote(k, w.id, need).total_cents + bills) tryBuy(need);
      }
      if (dice(s.id, 0, 5) < 30 && bal > 2 * bills && (month + s.id) % 3 === 0) {
        const wants = items.filter((i) => i.category === 'want' && !lack.get(s.id, w.id, i.id) && quote(k, w.id, i).total_cents <= bal - 2 * bills);
        if (wants.length) tryBuy(wants[dice(s.id, month, 3) % wants.length]);
      }
    }
  },

  routes: [
    { method: 'GET', path: '/state', access: 'student', handler: (k, { user }) => state(k, user) },
    { method: 'POST', path: '/buy', access: 'student', handler: (k, { user, body }) => buy(k, user, k.input.str(body, 'item', { max: 40 }), k.input.str(body, 'source', { max: 16 }) || 'chequing') },
    { method: 'POST', path: '/sell', access: 'student', handler: (k, { user, body }) => sell(k, user, k.input.int(body, 'id', { min: 1 })) },
    { method: 'POST', path: '/equip', access: 'student', handler: (k, { user, body }) => equip(k, user, k.input.int(body, 'id', { min: 1 }), true) },
    { method: 'POST', path: '/unequip', access: 'student', handler: (k, { user, body }) => equip(k, user, k.input.int(body, 'id', { min: 1 }), false) },
    {   // the student has seen the "Unlocked: ..." banner, so it is not shown again
      method: 'POST', path: '/seen', access: 'student',
      handler(k, { user }) { k.db.prepare('UPDATE outfitters_unlocks SET seen = 1 WHERE player_id = ? AND world_id = ? AND seen = 0').run(user.id, k.world.current().id); return { ok: true }; },
    },

    // ---- teacher ----
    {
      method: 'GET', path: '/overview', access: 'teacher',
      handler(k, { user }) {
        const w = k.world.current();
        const classes = k.players.classesFor(user);
        return {
          month: w.month, open: storeOpen(k, w.id), can_toggle: k.policy.can(user, 'world.settings'),
          classes: classes.map((c) => {
            const ids = JSON.stringify(k.players.inClass(c.id).map((s) => s.id));
            const spend = Object.fromEntries(k.db.prepare(`SELECT i.category, COUNT(*) AS n, SUM(o.price_cents + o.gst_cents) AS cents FROM outfitters_owned o JOIN outfitters_items i ON i.id = o.item_id
              WHERE o.world_id = ? AND o.via != 'achievement' AND o.player_id IN (SELECT value FROM json_each(?)) GROUP BY i.category`).all(w.id, ids).map((r) => [r.category, r]));
            const sold = k.db.prepare("SELECT COUNT(*) AS n, COALESCE(SUM(sold_cents), 0) AS cents FROM outfitters_owned WHERE world_id = ? AND sold_month IS NOT NULL AND player_id IN (SELECT value FROM json_each(?))").get(w.id, ids);
            const unlocked = Object.fromEntries(k.db.prepare('SELECT key, COUNT(*) AS n FROM outfitters_unlocks WHERE world_id = ? AND player_id IN (SELECT value FROM json_each(?)) GROUP BY key').all(w.id, ids).map((r) => [r.key, r.n]));
            const p = goalProgress(k, c.id, w.id);
            return {
              id: c.id, name: c.name, students: p.students, outfit: p.outfit, goals: p.goals,
              needs: { items: spend.need?.n ?? 0, cents: spend.need?.cents ?? 0 }, wants: { items: spend.want?.n ?? 0, cents: spend.want?.cents ?? 0 },
              sold: { items: sold.n, cents: sold.cents },
              achievements: ACHIEVEMENTS.map((a) => ({ key: a.key, name: a.item.name, count: unlocked[a.key] ?? 0 })),
            };
          }),
        };
      },
    },
    {
      method: 'POST', path: '/store', access: 'teacher',   // open or close the store for the whole world
      handler(k, { user, body }) {
        k.policy.assert(user, 'world.settings');
        const open = k.input.bool(body, 'open'), w = k.world.active();   // 409 between seasons: a closed world never ticks again, so this would be lost
        k.db.txn((tx) => {
          k.db.prepare('INSERT INTO outfitters_store (world_id, open) VALUES (?, ?) ON CONFLICT (world_id) DO UPDATE SET open = excluded.open').run(w.id, open ? 1 : 0);
          k.audit('store', { worldId: w.id, open }, `player:${user.id}`);
          tx.onCommit(() => k.events.emit('changed', { classId: user.class_id }));
        });
        return { ok: true, open };
      },
    },
  ],
});
