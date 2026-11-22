// The kernel facade `k` (docs/modules.md section 3): what a module gets instead of `app`. One per module, built at load.
import { HttpError } from './errors.js';
import { LedgerError } from './ledger.js';
import { withTxn, logAudit, afterCommit } from './db.js';
import { str, int, bool, idParam } from './input.js';

const BARE_KIND = /^[a-z][a-z0-9_]*$/;
const PUSH_EVENT = /^[a-z][a-z0-9.-]{1,40}$/, PUSH_MAX_BYTES = 4096, PUSH_MAX_PLAYERS = 200;

// One-liners every module had its own copy of (k.money, k.dice, k.ok; modules may also import them from here).
export const money = (c) => `$${(c / 100).toFixed(2)}`;
export const dice = (id, month, salt) => Math.abs(Math.imul(id * 31 + month * 17 + salt, 2654435761) >>> 8) % 100;   // bots only: deterministic, not secret
export const ok = (n) => Number.isSafeInteger(n);

function deepFreeze(o) {
  if (o && typeof o === 'object') { Object.values(o).forEach(deepFreeze); Object.freeze(o); }
  return o;
}

// The ledger as one module sees it. Kinds are namespaced so one module can neither forge nor count another's transactions:
// a bare kind ('payday') is stored as '<id>.payday'; anything with a '.' is refused; reverse() only touches this module's own txns.
export function moduleLedger(ledger, id) {
  const prefix = `${id}.`;
  const kind = (k) => {
    if (typeof k !== 'string' || !k) throw new LedgerError('A transaction needs a kind', 'BAD_KIND');
    if (k.includes('.')) throw new LedgerError(`Kind "${k}" must be a bare name; the kernel stores it as "${prefix}${k}"`, 'BAD_KIND');
    if (!BARE_KIND.test(k)) throw new LedgerError(`Kind "${k}" must match ${BARE_KIND}`, 'BAD_KIND');
    return prefix + k;
  };
  const { openAccount, accountId, accountsOf, account, balance, statement, isReversed, system } = ledger;
  return {
    openAccount, accountId, accountsOf, account, balance, statement, isReversed, system,
    post: (args) => ledger.post({ ...args, kind: kind(args?.kind) }),
    transfer: (args) => ledger.transfer({ ...args, kind: kind(args?.kind) }),   // no default kind: the old 'transfer' would be ambiguous
    reverse(txnId, opts) {
      const own = ledger.kindOf(Number.isSafeInteger(txnId) ? txnId : -1);
      if (own !== undefined && !own.startsWith(prefix)) throw new LedgerError(`Transaction ${txnId} was not posted by "${id}", so it cannot be reversed here`, 'NOT_REVERSIBLE');
      return ledger.reverse(txnId, opts);                                        // unknown id: the core throws NOT_FOUND
    },
    sumByKind: (args) => ledger.sumByKind({ ...args, kind: kind(args?.kind) }),
    txnsByKind: (args) => ledger.txnsByKind({ ...args, kind: kind(args?.kind) }),
  };
}

// A failure an advance (or a student's request) survived: logged, and kept in tick_failures (migration 012) for the world teacher's
// console. source = 'advance' while world.advance runs its ticks, else 'request' (a listener failing inside a student's payment, say).
// Written in the caller's transaction, after its savepoint was rolled back, so it commits with it (and goes with it on a rollback).
const failureInsert = new WeakMap();   // db -> prepared INSERT
export function recordFailure(app, module, playerId, e, what = 'onTick') {
  console.error(`[${module}] ${what} failed${Number.isSafeInteger(playerId) ? ` for player ${playerId}` : ''} (rolled back to its savepoint)`, e);
  const w = app.world.current();
  if (!w) return;
  let ins = failureInsert.get(app.db);
  if (!ins) failureInsert.set(app.db, ins = app.db.prepare('INSERT INTO tick_failures (world_id, month, module, player_id, error, source, created) VALUES (?, ?, ?, ?, ?, ?, ?)'));
  ins.run(w.id, w.month, module, Number.isSafeInteger(playerId) ? playerId : null, `${what === 'onTick' ? '' : `${what}: `}${e?.message ?? e}`.slice(0, 500),
    app.world.isAdvancing?.() ? 'advance' : 'request', app.clock.now());
}

// services: { call(id, name, args), has(id) } from lib/modules.js (the caller's id is bound here).
// needs: the facade powers this module declared (defineModule `needs`); only those are added to its k.
export function createKernel(app, id, services, needs = []) {
  const { db } = app;
  const say = (level) => (...a) => console[level](`[${id}]`, ...a);
  // k.db.prepare is cached per kernel: ticks prepare the same SQL for every student every month. A cached statement is shared, so a
  // module must not change its flags (setReadBigInts and friends). ponytail: cleared at 1,000 texts, in case SQL is ever built from data.
  const cache = new Map();
  const prepare = (sql) => {
    let st = cache.get(sql);
    if (!st) { if (cache.size >= 1000) cache.clear(); cache.set(sql, st = db.prepare(sql)); }
    return st;
  };
  const all = (sql, ...a) => prepare(sql).all(...a);
  const courseList = (courses) => JSON.stringify(Array.isArray(courses) ? courses : []);
  const classes = ({ courses } = {}) => (courses === undefined
    ? all('SELECT id, name, course_id FROM classes WHERE archived IS NULL ORDER BY id')
    : all('SELECT id, name, course_id FROM classes WHERE archived IS NULL AND course_id IN (SELECT value FROM json_each(?)) ORDER BY id', courseList(courses)));

  return Object.freeze({
    id,
    money, dice, ok,
    log: Object.freeze({ info: say('log'), warn: say('warn'), error: say('error') }),
    config: deepFreeze(structuredClone(app.config.options?.[id] ?? {})),
    clock: Object.freeze({ now: app.clock.now, today: app.clock.today, month: () => app.world.current()?.month }),   // wall time, local day, world month
    events: Object.freeze({ emit: (name, payload) => app.events.emit(`module.${id}.${name}`, payload) }),
    // Push one custom SSE event to the open streams of these players only (docs/modules.md "Pushing live data"). Not a module.* event, so it never
    // pokes the teacher console; teachers get it only if their id is listed. Fire and forget: not transactional, nothing is stored, a player with
    // no open stream just misses it. skippable: dropped (not queued) while a stream's socket is backed up, like the core balance hint.
    push(playerIds, event, data, { skippable = false } = {}) {
      if (typeof event !== 'string' || !PUSH_EVENT.test(event) || !event.startsWith(`${id}.`) || event.length === id.length + 1) throw new Error(`k.push: event must match ${PUSH_EVENT} and start with "${id}."`);
      if (!Array.isArray(playerIds) || playerIds.length > PUSH_MAX_PLAYERS || !playerIds.every(ok)) throw new Error(`k.push: playerIds must be a list of at most ${PUSH_MAX_PLAYERS} whole numbers`);
      const json = JSON.stringify(data);
      if (json === undefined || Buffer.byteLength(json) > PUSH_MAX_BYTES) throw new Error(`k.push: data must be JSON of at most ${PUSH_MAX_BYTES} bytes`);
      if (playerIds.length) app.events.emit('stream.push', { to: playerIds, event, data: JSON.parse(json), skippable: skippable === true });   // the bytes that were measured, not a toJSON that answers twice
    },
    HttpError, LedgerError,
    input: Object.freeze({ str, int, bool, idParam }),
    // afterCommit(cb): cb runs after the outermost commit (at once when no transaction is open); a savepoint that rolls back drops it. Cheaper than txn(tx => tx.onCommit) in a hot loop.
    db: Object.freeze({ prepare, txn: (fn) => withTxn(db, fn), afterCommit: (cb) => afterCommit(db, cb) }),   // your own tables only (documented, not enforced)
    // Another module's services (docs/modules.md "Services"): call runs it now, in this transaction, with that module's k; has() lets a caller degrade.
    modules: Object.freeze({ call: (module, name, args) => services.call(id, module, name, args), has: services.has }),
    // Per-player work in onTick: fn(item) for each item of list (an array), each in its own savepoint. A throw rolls back that one
    // player's part (their writes, and the events and onCommit callbacks queued inside it), is recorded in tick_failures and the loop
    // goes on, so one student's bad data cannot roll back every class's month. idOf(item) names the player (default: the item is the id).
    // A failure that hits most of the school is a bug, not one student's data: world.advance checks each month and rolls back (world.js).
    forEachPlayer(list, fn, idOf = (x) => x) {
      const outer = db.isTransaction;
      for (const item of list) {
        try { withTxn(db, () => fn(item)); } catch (e) {
          if (outer && !db.isTransaction) throw e;                                  // SQLite aborted the whole transaction: nothing left to isolate
          recordFailure(app, id, idOf(item), e);
        }
      }
    },
    audit: (action, detail, actor = 'system') => logAudit(db, actor, `${id}.${action}`, detail),
    ledger: Object.freeze(moduleLedger(app.ledger, id)),
    players: Object.freeze({
      get: (playerId) => app.players.get(playerId) ?? null,
      student: (playerId) => { const p = app.players.get(playerId); return p?.role === 'student' && p.class_id !== null ? p : null; },   // a removed student (no class) is no one
      inClass: (classId) => all("SELECT id, username FROM players WHERE class_id = ? AND role = 'student' ORDER BY username", classId),
      classes,
      classesFor: (user) => classes().filter((c) => app.policy.can(user, 'class.read', { classId: c.id })),   // the classes this teacher reads (none for a student)
      classOf: (playerId) => db.prepare('SELECT c.id, c.name, c.course_id FROM players p JOIN classes c ON c.id = p.class_id WHERE p.id = ?').get(playerId) ?? null,
    }),
    // active(): the current world, or 409 while the season is closed (teacher actions that change per-player game state between seasons).
    world: Object.freeze({
      current: () => app.world.current(),
      priceIndex: (worldId) => app.world.priceIndex(worldId),   // the world price index in bp (10000 = season start, also without rates)
      active() { const w = app.world.current(); if (w?.status !== 'active') throw new HttpError(409, 'The season is closed. Start the next one first.'); return w; },
      // needs: ['world.setPace'] only (life's stage-paced clock): months_per_day and/or auto_advance, nothing else, through world.setSettings.
      // Passing only months_per_day leaves auto_stopped alone (setSettings clears it only when auto_advance is passed).
      ...(needs.includes('world.setPace') && { setPace: ({ months_per_day, auto_advance } = {}) => app.world.setSettings({ months_per_day, auto_advance }, `system:${id}`) }),
    }),
    policy: Object.freeze({ can: app.policy.can, assert: app.policy.assert }),   // assert(user, action, resource): 404 for class/player resources, 403 for world actions
  });
}
