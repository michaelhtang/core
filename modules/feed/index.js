// feed: "Around town" (docs/phase6-roles.md 1.2). A short, public-ish log of what classmates and the town did: a job taken, a promotion, a card opened, a home bought
// or sold, a move, a big trade, a rate announcement, a town event. Rows are written by listeners on other modules' events (never the other way round) and read by two routes
// and a home card. Usernames only (pseudonyms). A class sees its own rows and the town's (class_id NULL); a teacher sees only the classes they read (k.players.classesFor).
// Amounts live in `cents` and the text carries the token {$}: the reader swaps in the money, or "$•••" when leaderboards hides amounts for students.
// A listener here never throws into its emitter (an item is a nicety; a failure must not roll back a payday, a purchase or an advance): errors are logged and dropped.
// 500 rows are kept per class (and for the town), pruned in the month tick.
import { defineModule } from '../../lib/modules.js';
import { createHints, pushAll } from '../../lib/live.js';

const KEEP = 500, CLASS_LAST = 30, TEACH_LAST = 100, CARD_LAST = 8, BIG_TRADE_CENTS = 200000;
const ok = Number.isSafeInteger;
const pct = (bp) => `${(bp / 100).toFixed(2)}%`;
const money = (c) => (c / 100).toLocaleString('en-CA', { style: 'currency', currency: 'CAD', maximumFractionDigits: c % 100 === 0 ? 0 : 2 });
const clip = (s, n = 60) => String(s ?? '').replace(/[\u0000-\u001f\u007f]+/g, ' ').trim().slice(0, n);

// Live: a new item tells the class's students "feed.new" (no payload; the card refetches its own copy). Marked after the writing transaction commits,
// coalesced to one push per class per 500 ms (docs/live.md); a town item (class_id NULL) marks '*' = every class. Nothing here reads or sends an amount.
const hints = new WeakMap();
const hintsOf = (k) => {
  if (!hints.has(k)) hints.set(k, createHints((keys) => {
    const classes = keys.includes('*') ? k.players.classes().map((c) => c.id) : keys;
    for (const id of classes) pushAll(k, k.players.inClass(id).map((s) => s.id), 'feed.new', {}, { skippable: true });
  }));
  return hints.get(k);
};

// Write one item for a student (class resolved through the kernel) or the town (playerId null, classId null). Never throws.
function add(k, { kind, playerId = null, classId, text, cents = null, month, worldId }) {
  try {
    const w = k.world.current();
    const wid = ok(worldId) ? worldId : w?.id;
    if (!ok(wid)) return;
    const p = playerId === null ? null : k.players.student(playerId);
    if (playerId !== null && !p) return;
    k.db.prepare('INSERT INTO feed_items (world_id, class_id, month, at, kind, player_id, text, cents) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .run(wid, p ? p.class_id ?? null : classId ?? null, ok(month) ? month : w?.month ?? 0, k.clock.now(), kind, playerId, text.replace('{name}', () => p?.username ?? ''), ok(cents) ? cents : null);
    const cid = p ? p.class_id ?? null : classId ?? null;
    k.db.afterCommit(() => hintsOf(k).mark(cid ?? '*'));
  } catch (e) { k.log.warn(`feed item (${kind}) dropped: ${e?.message ?? e}`); }
}
// A listener wrapper: swallow and log anything, including a bad payload.
const on = (fn) => (k, p) => { try { fn(k, p ?? {}); } catch (e) { k.log.warn(`feed listener failed: ${e?.message ?? e}`); } };

// What a reader sees. `hidden`: amounts are replaced by $••• (students, when leaderboards hides amounts).
const show = (r, hidden, me) => ({ id: r.id, class_id: r.class_id, month: r.month, at: r.at, kind: r.kind, mine: me !== undefined && r.player_id === me, town: r.class_id === null,
  text: r.text.replace('{$}', () => (r.cents === null || hidden ? '$•••' : money(r.cents))) });
// leaderboards.settings answers { hide_amounts } and the feed honours it; without leaderboards, amounts are shown.
function amountsHidden(k, worldId) {
  if (!k.modules.has('leaderboards')) return false;
  try { return k.modules.call('leaderboards', 'settings', { worldId })?.hide_amounts === true; } catch { return false; }
}

const SQL = 'SELECT id, class_id, month, at, kind, player_id, text, cents FROM feed_items';
function forClass(k, user, limit) {
  const w = k.world.current();
  if (!w) return [];
  const hidden = amountsHidden(k, w.id);
  return k.db.prepare(`${SQL} WHERE world_id = ? AND (class_id = ? OR class_id IS NULL) ORDER BY id DESC LIMIT ?`).all(w.id, user.class_id, limit).map((r) => show(r, hidden, user.id));
}

export default defineModule({
  id: 'feed',
  requires: ['bank-basic'],

  migrations: [{ id: '001_feed', sql: `
CREATE TABLE feed_items (          -- class_id NULL = a town item; text may hold {$}, replaced by cents when shown
  id INTEGER PRIMARY KEY, world_id INTEGER NOT NULL REFERENCES worlds(id), class_id INTEGER, month INTEGER NOT NULL, at INTEGER NOT NULL,
  kind TEXT NOT NULL, player_id INTEGER, text TEXT NOT NULL, cents INTEGER
);
CREATE INDEX feed_items_class ON feed_items (class_id, id)` }],

  // Every source is a listener on another module's event; payload shapes are in docs/phase6-roles.md "As built (6a feed + scenarios)".
  events: {
    'app.closing': (k) => hintsOf(k).stop(),
    'module.jobs.hired': on((k, e) => add(k, { kind: 'job', playerId: e.playerId, text: `{name} took a job: ${clip(e.title)} at ${clip(e.employer)}` })),
    'module.jobs.promoted': on((k, e) => add(k, { kind: 'promotion', playerId: e.playerId, month: e.month, worldId: e.worldId, text: `{name} was promoted to ${clip(e.title)}` })),
    'module.credit.limit': on((k, e) => add(k, { kind: 'card', playerId: e.playerId, worldId: e.worldId, cents: e.limitCents, text: `{name} got a credit card, {$} limit${ok(e.aprBp) ? ` at ${pct(e.aprBp)}` : ''}` })),
    'module.housing.moved': on((k, e) => add(k, { kind: 'move', playerId: e.playerId, month: e.month, worldId: e.worldId, text: `{name} moved into ${clip(e.name ?? 'a new place')}` })),
    // 6b landlords: a listing, an announced rent change, an eviction (the tenant's item), a town-wide market move
    'module.housing.listed': on((k, e) => add(k, { kind: 'rent', playerId: e.playerId, month: e.month, worldId: e.worldId, cents: e.rentCents, text: '{name} listed a condo for rent at {$}' })),
    'module.housing.rent_changed': on((k, e) => add(k, { kind: 'rent', playerId: e.playerId, month: e.month, worldId: e.worldId, cents: e.rentCents, text: `{name} ${ok(e.oldCents) && e.rentCents < e.oldCents ? 'lowered' : 'raised'} the rent on their condo to {$}` })),
    'module.housing.evicted': on((k, e) => add(k, { kind: 'evicted', playerId: e.playerId, month: e.month, worldId: e.worldId, text: '{name} was evicted' })),
    'module.housing.market': on((k, e) => { if (ok(e.pct)) add(k, { kind: 'town', month: e.month, worldId: e.worldId, text: `Housing: homes moved ${e.pct > 0 ? '+' : ''}${e.pct}%` }); }),
    // After commit, and the payload has no meta: the price comes from the txn row (a core table, read only).
    'ledger.posted': on((k, e) => {
      const kind = e.kind;
      if (kind !== 'housing.purchase' && kind !== 'housing.sale' && kind !== 'exchange.buy' && kind !== 'exchange.sell') return;   // the hot path: nothing else costs a read
      const me = e.owners?.find((o) => o.type === 'player');
      if (!me || !Array.isArray(e.legs)) return;
      const row = k.db.prepare('SELECT meta FROM txns WHERE id = ? AND kind = ?').get(e.txnId, kind);
      if (!row) return;
      const meta = JSON.parse(row.meta);
      if (kind === 'housing.purchase' && ok(meta.price)) return add(k, { kind: 'home', playerId: me.id, cents: meta.price, text: meta.role === 'rental' ? '{name} bought a rental condo for {$}' : '{name} bought a home for {$}' });
      if (kind === 'housing.sale' && ok(meta.value)) return add(k, { kind: 'home', playerId: me.id, cents: meta.value, text: '{name} sold their home for {$}' });
      if (kind.startsWith('housing.')) return;
      const cents = Math.max(...e.legs.map((l) => Math.abs(l.cents)));
      if (cents < BIG_TRADE_CENTS || !/^[A-Z]{2,6}$/.test(meta.ticker ?? '')) return;
      add(k, { kind: 'trade', playerId: me.id, cents, text: `{name} ${kind === 'exchange.buy' ? 'bought' : 'sold'} {$} of ${meta.ticker}` });
    }),
    // 6c student employers (ventures). Company names passed ventures' name rule (3-40 letters, digits, spaces, & ' . , ! -) and are clipped again
    // here; usernames are pseudonyms. A hire is the hirer's class item, and the employee's too when they are in another class (the board is town-wide).
    'module.ventures.hired': on((k, e) => {
      const hirer = k.players.student(e.hirerId), hired = k.players.student(e.playerId);
      if (!hired) return;
      const text = `${hirer ? hirer.username : clip(e.company, 40)} hired ${hired.username} at {$}/h`;
      const base = { kind: 'hire', month: e.month, worldId: e.worldId, cents: e.wageCents, text };
      add(k, { ...base, playerId: hirer ? hirer.id : hired.id });
      if (hirer && hirer.class_id !== hired.class_id) add(k, { ...base, playerId: hired.id });
    }),
    'module.ventures.payroll_missed': on((k, e) => { if (ok(e.classId)) add(k, { kind: 'payroll', classId: e.classId, month: e.month, worldId: e.worldId, text: `Missed payroll at ${clip(e.company, 40)}` }); }),
    'module.ventures.laid_off': on((k, e) => add(k, { kind: 'laid_off', playerId: e.playerId, month: e.month, worldId: e.worldId, text: `{name} was laid off from ${clip(e.company, 40)}` })),
    // stress (6a): module.stress.loan { playerId, worldId, cents, aprBp } (no month: add() takes the world's current one).
    'module.stress.loan': on((k, e) => add(k, { kind: 'loan', playerId: e.playerId, month: e.month, worldId: e.worldId, cents: e.cents, text: `{name} took an emergency loan, {$}${ok(e.aprBp) ? ` at ${pct(e.aprBp)}` : ''}` })),
    // Town items (class_id NULL), except an insurance event aimed at one class.
    // Stage B and C bring new bill lines (bills' stage costs, docs/stagecosts.md): say so, and where to change them.
    'module.life.stage': on((k, e) => add(k, { kind: 'town', month: e.month, worldId: e.worldId, text: `Town: everyone is now ${ok(e.age) ? `${e.age}, ` : ''}Stage ${clip(e.stage, 2)} of life${(e.stage === 'B' || e.stage === 'C') && k.modules.has('bills') ? '. New life costs start on this month\'s bills: see Life, and change them in Bills, Plans' : ''}` })),
    'module.rates.pending': on((k, e) => { if (ok(e.pendingBp)) add(k, { kind: 'town', worldId: e.worldId, text: `Rates: the Bank of DAA will move to ${pct(e.pendingBp)} next month` }); }),
    'module.insurance.triggered': on((k, e) => add(k, { kind: 'town', classId: ok(e.classId) ? e.classId : null, text: `Town event next month: ${clip(e.name ?? 'something unexpected')}${ok(e.classId) ? ' (this class)' : ''}` })),
  },

  // Prune: 500 per class and for the town, newest kept (ids only grow). Nothing else runs per student.
  onTick(k, { classes, world }) {
    const del = k.db.prepare(`DELETE FROM feed_items WHERE world_id = ? AND class_id IS ? AND id <= (SELECT id FROM feed_items WHERE world_id = ? AND class_id IS ? ORDER BY id DESC LIMIT 1 OFFSET ?)`);
    for (const cid of [null, ...classes.map((c) => c.id)]) del.run(world.id, cid, world.id, cid, KEEP);
  },

  cards: [{ id: 'feed', src: 'feed.js' }],
  // "Around town": the newest 8 of the class's and the town's items, the student's own first (stable, so newest first within each group).
  homeCards(k, user) {
    const w = k.world.current();
    if (w?.status !== 'active') return [];
    const items = forClass(k, user, CARD_LAST);
    return [{ id: 'feed', title: 'Around town', data: { items: [...items.filter((i) => i.mine), ...items.filter((i) => !i.mine)] } }];
  },

  teacherPanels: [{ id: 'feed-teach', title: 'Around town', src: 'teach.js' }],

  routes: [
    // A student: their class and the town, the newest 30.
    { method: 'GET', path: '/class', access: 'student', handler: (k, { user }) => ({ month: k.world.current()?.month ?? 0, items: forClass(k, user, CLASS_LAST) }) },
    // A teacher: the classes they read (and the town), the newest 100; ?class_id= narrows to one of them, ?since=<id> returns only newer rows.
    {
      method: 'GET', path: '/teach', access: 'teacher',
      handler(k, { user, url }) {
        const mine = k.players.classesFor(user);
        const num = (name) => { const v = url?.searchParams?.get(name); if (v === null || v === undefined || v === '') return undefined; const n = Number(v); if (!Number.isSafeInteger(n) || n < 0) throw new k.HttpError(400, `${name} must be a whole number`); return n; };
        const classId = num('class_id'), since = num('since') ?? 0;
        if (classId !== undefined && !mine.some((c) => c.id === classId)) throw new k.HttpError(404, 'Class not found');
        const classes = mine.map((c) => ({ id: c.id, name: c.name }));
        const w = k.world.current();
        if (!w) return { month: 0, classes, items: [], last_id: since };
        const ids = JSON.stringify(classId === undefined ? mine.map((c) => c.id) : [classId]);
        const items = k.db.prepare(`${SQL} WHERE world_id = ? AND id > ? AND (class_id IN (SELECT value FROM json_each(?)) OR class_id IS NULL) ORDER BY id DESC LIMIT ?`)
          .all(w.id, since, ids, TEACH_LAST).map((r) => ({ ...show(r, false), username: r.player_id === null ? null : k.players.get(r.player_id)?.username ?? null }));
        return { month: w.month, classes, items, last_id: items[0]?.id ?? since };
      },
    },
  ],
});
