// Coalesced "something changed" hints for live screens (docs/live.md). A module marks a key (a class id, a player id) AFTER the
// emitting transaction commits (k.db.afterCommit, which drops the mark if the transaction or savepoint rolls back); one timer per window
// then calls flush(keys) once with every key marked meanwhile. A month tick marks thousands of times and still costs one Set add each
// and one timer, nothing else. The timer is unref'd and stop() clears it (modules call it on app.closing).
export const LIVE_MS = 500;

export function createHints(flush, ms = LIVE_MS) {
  const keys = new Set();
  let timer = null;
  return {
    mark(key) {
      keys.add(key);
      if (timer) return;
      timer = setTimeout(() => {
        timer = null;
        const batch = [...keys];
        keys.clear();
        try { flush(batch); } catch (e) { console.error('[live] flush failed', e); }
      }, ms);
      timer.unref();
    },
    stop() { clearTimeout(timer); timer = null; keys.clear(); },
  };
}

// k.push takes at most 200 players: send a long list in pieces.
export function pushAll(k, ids, event, data, opts) {
  for (let i = 0; i < ids.length; i += 200) k.push(ids.slice(i, i + 200), event, data, opts);
}
