// Client resync logic, shared by the student app and the teacher console. No DOM and no globals except EventSource and timers,
// so node:test can drive it (test/sync.test.js). The SSE stream is only a hint channel: whenever something might have been missed
// (stream opened or reopened, an event arrived, the stream died) the page refetches /api/me and redraws from that.

export const DEBOUNCE_MS = 150;    // trailing debounce: a burst of pokes becomes one refetch
export const JITTER_MS = 300;      // extra random wait for broadcast events, so a whole class does not refetch in the same instant
export const RETRY_MS = 5000;      // after a stream dies for good (HTTP error), try to reopen it this much later if still logged in
const CLOSED = 2;                  // EventSource.CLOSED

// Wait before retry number `attempt` (0, 1, 2...) of a failed first load: 1, 2, 4... seconds, never more than 30.
export const backoffMs = (attempt) => Math.min(30000, 1000 * 2 ** attempt);

// The page's default for a stream the server replaced (see connect()): a quiet pill; clicking it, or coming back to the tab, calls
// resume(). Without a document (node tests) it does nothing; tests pass their own `replaced`.
function parkedNotice(resume) {
  const d = globalThis.document;
  if (!d?.body) return;
  d.getElementById('vdaa-parked')?.remove();
  const pill = Object.assign(d.createElement('button'), { id: 'vdaa-parked', type: 'button', className: 'pill', textContent: 'Open in another tab — click to use here' });
  Object.assign(pill.style, { position: 'fixed', bottom: '1rem', left: '50%', transform: 'translateX(-50%)', zIndex: 50 });
  const go = () => { pill.remove(); globalThis.removeEventListener('focus', go); resume(); };
  pill.addEventListener('click', go);
  globalThis.addEventListener('focus', go);
  d.body.append(pill);
}

// 0..JITTER_MS inclusive; rand() is in [0, 1].
export const jitterMs = (rand = Math.random) => Math.round(rand() * JITTER_MS);

// poke(broadcast) schedules fn after DEBOUNCE_MS (+ jitter if broadcast); a new poke restarts the wait.
export function createPoke(fn, { rand = Math.random, setTimer = setTimeout, clearTimer = clearTimeout } = {}) {
  let t = null;
  const poke = (broadcast = false) => {
    clearTimer(t);
    t = setTimer(() => { t = null; fn(); }, DEBOUNCE_MS + (broadcast ? jitterMs(rand) : 0));
  };
  poke.cancel = () => { clearTimer(t); t = null; };
  return poke;
}

// Request sequence: start() before each fetch, accept(n) when it returns. An older response never overwrites a newer one.
export function createSequencer() {
  let issued = 0;
  let applied = 0;
  return { start: () => ++issued, accept: (n) => (n > applied ? ((applied = n), true) : false) };
}

// The one place the page decides what is on screen.
//   fetchMe()      -> the /api/me payload (may throw; the page keeps what it has)
//   show(me)       -> full draw, called when the signed-in user changes (including to nobody: the login view)
//   update(me)     -> light refresh for the same user (balances, panels)
//   offline(on)    -> optional: the first /api/me failed (on = true: show "Can't reach core. Retrying…") or finally worked (false); sync retries by itself with backoff
//   events         -> { name: (messageEvent) => void } handlers that run at once for each event (the month chip), before the refetch
//   broadcast      -> event names that get jitter
// on(name, fn) -> off: panels listen to any SSE event name on the same stream (no refetch is triggered by it); it works before and
// after the stream opens and survives reconnects. The returned function unsubscribes.
// A stream is open exactly while someone is signed in. An anonymous /api/me (session revoked or expired) closes it and shows the
// login view; the next login opens a new one. No reload needed.
export function createClientSync({ fetchMe, show, update = () => {}, offline = () => {}, replaced = parkedNotice, events = {}, eventNames = Object.keys(events), broadcast = ['month'], url = '/api/stream',
  EventSource: ES = globalThis.EventSource, rand, setTimer = setTimeout, clearTimer = clearTimeout }) {
  const seq = createSequencer();
  let me = null;
  let shown;                       // id of the user the current view was built for; null = login view; undefined = nothing drawn yet
  let es = null;
  let retry = null;
  let waiting = false;             // a dead stream is waiting out RETRY_MS: sync() must not reopen it at once
  let tries = 0;                   // failed first loads so far: nothing is on screen until one works, so it is retried here, with backoff
  let firstRetry = null;
  const subs = new Map();          // event name -> Set of panel listeners
  const wired = new WeakMap();     // stream -> names it already dispatches to subs

  async function sync() {
    const n = seq.start();
    let next;
    try { next = await fetchMe(); } catch {
      if (shown === undefined && !firstRetry) {                        // first paint failed: say so and keep trying
        if (!tries) offline(true);
        firstRetry = setTimer(() => { firstRetry = null; sync(); }, backoffMs(tries++));
      }
      return false;
    }
    if (!seq.accept(n)) return false;                                  // a newer fetch already landed
    if (tries) { tries = 0; clearTimer(firstRetry); firstRetry = null; offline(false); }
    me = next;
    const who = me.user?.id ?? null;
    if (who === null) disconnect(); else if (!waiting) connect();
    if (who !== shown) { shown = who; await show(me); } else if (who !== null) await update(me);
    return true;
  }

  function wire(source, name) {
    const names = wired.get(source) ?? wired.set(source, new Set()).get(source);
    if (names.has(name)) return;
    names.add(name);
    source.addEventListener(name, (ev) => { for (const fn of [...(subs.get(name) ?? [])]) fn(ev); });
  }

  function on(name, fn) {
    if (!subs.has(name)) subs.set(name, new Set());
    subs.get(name).add(fn);
    if (es) wire(es, name);
    return () => subs.get(name)?.delete(fn);
  }

  const poke = createPoke(() => sync(), { rand, setTimer, clearTimer });

  function connect() {
    if (es) return;
    globalThis.document?.getElementById('vdaa-parked')?.remove();      // connected again some other way (e.g. signed in again): drop a stale notice
    const mine = es = new ES(url);
    mine.addEventListener('open', () => { sync(); });                  // first open and every reconnect: we may have missed events
    mine.addEventListener('error', () => {
      if (mine.readyState !== CLOSED || es !== mine) return;           // CONNECTING: the browser is retrying by itself
      es = null;                                                       // dead for good (401 after revoke, 5xx, wrong content type)
      waiting = true;
      clearTimer(retry);
      retry = setTimer(() => { waiting = false; if (me?.user) connect(); }, RETRY_MS);
      sync();                                                          // anonymous -> login view (and the timer is cancelled); else just refresh
    });
    // The server closed this stream because the same player opened a newer one (3 at most): stay off until this tab is used again,
    // instead of reconnecting and closing another tab's stream in turn. `waiting` keeps sync() from reopening it meanwhile.
    mine.addEventListener('replaced', () => {
      if (es !== mine) return;
      mine.close();
      es = null;
      waiting = true;
      clearTimer(retry);
      const resume = async () => {                                     // sync() reopens the stream if still signed in
        if (!waiting || es) return;
        waiting = false;
        if (!(await sync())) { waiting = true; replaced(resume); }      // a network blip: park again, so the next click or focus retries
      };
      replaced(resume);
    });
    for (const name of eventNames) {
      mine.addEventListener(name, (ev) => { events[name]?.(ev); poke(broadcast.includes(name)); });
    }
    for (const name of subs.keys()) wire(mine, name);
  }

  function disconnect() {
    es?.close();
    es = null;
    waiting = false;
    clearTimer(retry);
    poke.cancel();
  }

  return { sync, poke, on, get me() { return me; }, get connected() { return !!es; }, disconnect };
}
