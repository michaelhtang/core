// In-process pub/sub. Synchronous; a throwing listener is logged and never affects the emitter or other listeners, except an error
// marked toEmitter (a module listener whose transaction SQLite aborted, lib/modules.js), which is thrown to the emitter.
// on('*', fn) hears everything; listeners get (payload, type). Exact-type listeners run before '*' ones.
export function createEvents({ log = console } = {}) {
  const listeners = new Map();
  return {
    on(type, fn) {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type).add(fn);
      return () => listeners.get(type)?.delete(fn);
    },
    emit(type, payload) {
      for (const fn of [...(listeners.get(type) ?? []), ...(listeners.get('*') ?? [])]) {
        try { fn(payload, type); } catch (e) { if (e?.toEmitter) throw e; log.error(`[events] listener for ${type} failed`, e); }
      }
    },
    listenerCount: (type) => listeners.get(type)?.size ?? 0,
  };
}
