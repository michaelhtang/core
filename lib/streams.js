// Server-Sent Events (/api/stream): the hub of open streams, and the subscriber that turns app events into hints for them.
import { afterCommit } from './db.js';

// ---------- server-sent events ----------
// A subscriber of app.events: streams are indexed by playerId and (for teachers) kept in a set. Every write carries an
// id: line from one process-wide counter and is safe, a stream whose socket throws is dropped.
const LEDGER_HINT_MS = 500;
const STREAMS_PER_PLAYER = 3;                                                        // a 4th tab or device closes that player's oldest stream
const HINTS = new Set(['balance', 'ledger', 'console', 'ping']);                     // skippable: a slow client just re-syncs on a later one
export function createStreams() {
  const byPlayer = new Map();
  const teachers = new Set();
  let eventId = 0;
  const hub = {
    teachers,
    all: function* () { for (const set of byPlayer.values()) yield* set; },
    of: (playerId) => byPlayer.get(playerId) ?? [],
    add(stream) {
      if (!byPlayer.has(stream.playerId)) byPlayer.set(stream.playerId, new Set());
      const set = byPlayer.get(stream.playerId).add(stream);
      if (stream.role === 'teacher') teachers.add(stream);
      if (set.size > STREAMS_PER_PLAYER) {                                            // a Set keeps insertion order: the first is the oldest
        const oldest = set.values().next().value;
        hub.write(oldest, 'replaced');                                                // tells that tab not to reconnect by itself (public/sync.js)
        hub.drop(oldest);
      }
    },
    drop(stream) {
      const set = byPlayer.get(stream.playerId);
      set?.delete(stream);
      if (set?.size === 0) byPlayer.delete(stream.playerId);
      teachers.delete(stream);
      try { stream.res.end(); } catch { /* socket already gone */ }
    },
    // Backpressure: once a write is buffered (write() returned false) the stream skips hints until its socket drains.
    write(stream, event, data = {}, skippable = false) {
      if (stream.full && (skippable || HINTS.has(event))) return;
      try {
        if (!stream.res.write(`id: ${++eventId}\nevent: ${event}\ndata: ${JSON.stringify(data)}\n\n`) && !stream.full) {
          stream.full = true;
          stream.res.once('drain', () => { stream.full = false; });
        }
      } catch { hub.drop(stream); }
    },
    send(streams, event, data, skippable) { for (const c of [...streams]) hub.write(c, event, data, skippable); },
  };
  return hub;
}

export function subscribe(app, hub) {
  let hintTimer = null;
  // module.* events become one coalesced `console` hint per 500 ms, sent after the emitting transaction commits (none if it rolls back).
  // A tick emits tens of thousands of them inside its transaction; each queues the same flush on the open transaction (afterCommit), and
  // only the first flush after a commit does anything. A copy queued in a savepoint that rolls back is dropped with it.
  let consoleTimer = null, consoleDirty = false;
  const flushConsole = () => {
    if (!consoleDirty) return;
    consoleDirty = false;
    if (consoleTimer || !hub.teachers.size) return;
    consoleTimer = setTimeout(() => { consoleTimer = null; hub.send(hub.teachers, 'console'); }, LEDGER_HINT_MS);
    consoleTimer.unref();
  };
  const offs = [
    app.events.on('ledger.posted', ({ owners }) => {
      // A business account (Phase 4) has no stream of its own: the module that owns it maps it to its students (modules' ownersOf hook).
      const to = new Set(owners.flatMap((o) => (o.type === 'player' ? [o.id] : app.modules.ownersOf(o))));
      for (const id of to) hub.send(hub.of(id), 'balance');
      if (!hintTimer && hub.teachers.size) {                                          // trailing throttle: one hint per 500 ms
        hintTimer = setTimeout(() => { hintTimer = null; hub.send(hub.teachers, 'ledger'); }, LEDGER_HINT_MS);
        hintTimer.unref();
      }
    }),
    app.events.on('world.month', ({ month }) => hub.send([...hub.all()], 'month', { month })),
    app.events.on('world.settings', () => hub.send(hub.teachers, 'world')),
    // A new or closed season: every stream re-syncs (students get the closed screen, or the new world and its welcome grant).
    app.events.on('world.closed', ({ worldId }) => hub.send([...hub.all()], 'world', { worldId })),
    app.events.on('world.created', ({ worldId }) => hub.send([...hub.all()], 'world', { worldId })),
    app.events.on('session.revoked', ({ playerId, tokenHash }) => {
      for (const c of [...hub.of(playerId)]) if (!tokenHash || c.tokenHash === tokenHash) hub.drop(c);
    }),
    // k.push (lib/kernel.js): a module's own SSE event for exactly the listed players. Not a module.* event, so no console hint.
    app.events.on('stream.push', ({ to, event, data, skippable }) => hub.send(to.flatMap((id) => [...hub.of(id)]), event, data, skippable)),
    app.events.on('class.created', () => hub.send(hub.teachers, 'console')),
    app.events.on('players.created', () => hub.send(hub.teachers, 'console')),
    app.events.on('*', (_, type) => { if (type.startsWith('module.')) { consoleDirty = true; afterCommit(app.db, flushConsole); } }),
  ];
  return () => { offs.forEach((off) => off()); clearTimeout(hintTimer); clearTimeout(consoleTimer); };
}
