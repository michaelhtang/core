import test from 'node:test';
import assert from 'node:assert/strict';
import { createPoke, createSequencer, createClientSync, jitterMs, backoffMs, DEBOUNCE_MS, JITTER_MS, RETRY_MS } from '../public/sync.js';

// Hand-driven timers: setTimer records { at, fn }; run(upTo) fires what is due, in order.
function fakeTimers() {
  let now = 0;
  const q = [];
  let id = 0;
  return {
    setTimer: (fn, ms) => { const t = { id: ++id, at: now + ms, fn }; q.push(t); return t; },
    clearTimer: (t) => { const i = q.indexOf(t); if (i >= 0) q.splice(i, 1); },
    pending: () => q.length,
    run(ms) { const end = now + ms; for (;;) { q.sort((a, b) => a.at - b.at); if (!q.length || q[0].at > end) break; const t = q.shift(); now = t.at; t.fn(); } now = end; },
  };
}

test('poke: a burst of pokes is one call, 150 ms after the last one', () => {
  const tm = fakeTimers();
  let calls = 0;
  const poke = createPoke(() => calls++, tm);
  poke(); tm.run(100); poke(); tm.run(100); poke();
  tm.run(DEBOUNCE_MS - 1);
  assert.equal(calls, 0);
  tm.run(1);
  assert.equal(calls, 1);
  tm.run(1000);
  assert.equal(calls, 1);
});

test('jitter: 0 to 300 ms, inclusive at both ends', () => {
  assert.equal(jitterMs(() => 0), 0);
  assert.equal(jitterMs(() => 1), JITTER_MS);
  assert.equal(jitterMs(() => 0.5), 150);
});

test('30 clients poked by one month broadcast refetch spread over at least 300 ms; a plain event is not jittered', () => {
  // each client draws its own random number; here they are evenly spread over [0, 1] (a real Math.random run is below)
  const fired = [];
  const tm = fakeTimers();
  for (let i = 0; i < 30; i++) {
    const poke = createPoke(() => fired.push(i), { ...tm, rand: () => i / 29 });
    poke(true);
  }
  const when = [];
  for (let ms = 1; ms <= DEBOUNCE_MS + JITTER_MS; ms++) { const before = fired.length; tm.run(1); for (let k = before; k < fired.length; k++) when.push(ms); }
  assert.equal(fired.length, 30);
  assert.ok(Math.max(...when) - Math.min(...when) >= 300, `spread ${Math.max(...when) - Math.min(...when)} ms`);
  assert.ok(Math.min(...when) >= DEBOUNCE_MS);

  const plain = fakeTimers();
  const seen = [];
  for (let i = 0; i < 30; i++) createPoke(() => seen.push(1), { ...plain, rand: () => Math.random() })(false);
  plain.run(DEBOUNCE_MS);
  assert.equal(seen.length, 30);                                       // all at exactly 150 ms

  // and with the real Math.random every client lands inside the window and they do not all coincide
  const real = fakeTimers();
  const delays = [];
  for (let i = 0; i < 30; i++) createPoke(() => {}, { setTimer: (fn, ms) => { delays.push(ms); return real.setTimer(fn, ms); }, clearTimer: real.clearTimer })(true);
  assert.ok(delays.every((d) => d >= DEBOUNCE_MS && d <= DEBOUNCE_MS + JITTER_MS));
  assert.ok(new Set(delays).size > 10);
});

test('sequencer: an older response never overwrites a newer one', () => {
  const s = createSequencer();
  const a = s.start(); const b = s.start(); const c = s.start();
  assert.equal(s.accept(b), true);
  assert.equal(s.accept(a), false);                                    // older than what was applied
  assert.equal(s.accept(c), true);
  assert.equal(s.accept(c), false);
});

// A fake EventSource: instances are collected so a test can open, fail and close them by hand.
function fakeES() {
  const all = [];
  class ES {
    constructor(url) { this.url = url; this.readyState = 0; this.l = {}; all.push(this); }
    addEventListener(n, f) { (this.l[n] ??= []).push(f); }
    fire(n, data) { (this.l[n] ?? []).forEach((f) => f({ type: n, data })); }
    open() { this.readyState = 1; this.fire('open'); }
    drop() { this.readyState = 0; this.fire('error'); }               // connection lost, the browser will retry by itself
    die() { this.readyState = 2; this.fire('error'); }                // HTTP error: the browser gives up
    close() { this.readyState = 2; }
  }
  return { ES, all };
}
const flush = () => new Promise((r) => setImmediate(r));
const anon = { user: null, world: null };
const student = (id = 1, month = 1) => ({ user: { id }, world: { month } });

function harness(meQueue) {
  const tm = fakeTimers();
  const { ES, all } = fakeES();
  const log = { shows: [], updates: [], fetches: 0, events: [], offline: [] };
  const live = createClientSync({
    fetchMe: async () => { log.fetches++; const v = typeof meQueue === 'function' ? meQueue() : meQueue; return v; },
    show: (me) => log.shows.push(me.user?.id ?? null),
    update: (me) => log.updates.push(me.world.month),
    offline: (on) => log.offline.push(on),
    events: { month: (ev) => log.events.push(JSON.parse(ev.data).month), balance: () => {} },
    EventSource: ES, ...tm,
  });
  return { live, tm, all, log };
}

test('sync: opening the stream refetches, and so does every reconnect (a server restart)', async () => {
  const h = harness(() => student());
  await h.live.sync();
  assert.deepEqual(h.log.shows, [1]);
  assert.equal(h.all.length, 1);                                       // signed in: a stream is open
  const fetchesBefore = h.log.fetches;
  h.all[0].open();
  await flush();
  assert.equal(h.log.fetches, fetchesBefore + 1);                      // open -> refetch
  h.all[0].drop();                                                     // server went away: browser reconnects by itself
  await flush();
  assert.equal(h.log.fetches, fetchesBefore + 1);                      // nothing to fetch from a dead server, and no new EventSource
  assert.equal(h.all.length, 1);
  h.all[0].open();                                                     // it is back
  await flush();
  assert.equal(h.log.fetches, fetchesBefore + 2);                      // reconnect -> refetch
  assert.equal(h.log.updates.length, 2);
});

test('sync: a stream that dies for good (401 after a revoke) shows the login view; a later login reconnects without a reload', async () => {
  let who = student();
  const h = harness(() => who);
  await h.live.sync();
  h.all[0].open();
  await flush();
  who = anon;                                                          // the server revoked the session
  h.all[0].die();                                                      // reconnect got 401
  await flush();
  assert.deepEqual(h.log.shows, [1, null]);                            // login view
  assert.equal(h.live.connected, false);
  h.tm.run(RETRY_MS * 3);
  assert.equal(h.all.length, 1);                                       // anonymous: no retry timer left
  who = student(1);                                                    // the student logs in again (the login form calls sync())
  await h.live.sync();
  assert.deepEqual(h.log.shows, [1, null, 1]);
  assert.equal(h.all.length, 2);                                       // a new stream, same page
  assert.equal(h.live.connected, true);
});

test('sync: a stream that dies while still signed in retries after RETRY_MS, not in a tight loop', async () => {
  const h = harness(() => student());
  await h.live.sync();
  h.all[0].die();
  await flush();
  assert.equal(h.all.length, 1);                                       // sync() did not reopen it at once
  assert.ok(h.log.fetches >= 2);                                       // but the page refetched
  h.tm.run(RETRY_MS - 1);
  assert.equal(h.all.length, 1);
  h.tm.run(1);
  assert.equal(h.all.length, 2);
});

test('sync: an anonymous /api/me on a signed-in page shows the login view, it never reaches update()', async () => {
  let who = student(1, 4);
  const h = harness(() => who);
  await h.live.sync();
  who = anon;
  await h.live.sync();
  assert.deepEqual(h.log.shows, [1, null]);
  assert.deepEqual(h.log.updates, []);
  assert.equal(h.live.connected, false);
  await h.live.sync();                                                 // still anonymous: nothing is redrawn under someone typing
  assert.deepEqual(h.log.shows, [1, null]);
});

test('sync: events are coalesced (150 ms trailing), month jitters, and the month is read from the event at once', async () => {
  const h = harness(() => student());
  await h.live.sync();
  const base = h.log.fetches;
  const es = h.all[0];
  es.fire('balance'); es.fire('balance'); es.fire('balance');
  assert.deepEqual(h.log.events, []);
  h.tm.run(DEBOUNCE_MS);
  await flush();
  assert.equal(h.log.fetches, base + 1);                               // three pokes, one fetch
  es.fire('month', JSON.stringify({ month: 7 }));
  assert.deepEqual(h.log.events, [7]);                                 // no waiting for the refetch
  h.tm.run(DEBOUNCE_MS + JITTER_MS);
  await flush();
  assert.equal(h.log.fetches, base + 2);
});

test('sync: responses landing out of order never put older data on screen', async () => {
  const waiting = [];
  const tm = fakeTimers();
  const { ES } = fakeES();
  const updates = [];
  const live = createClientSync({
    fetchMe: () => new Promise((r) => waiting.push(r)),
    show: () => {}, update: (me) => updates.push(me.world.month), EventSource: ES, ...tm,
  });
  const first = live.sync();
  waiting[0](student(1, 1));
  await first;                                                         // drawn once
  const older = live.sync();
  const newer = live.sync();
  waiting[2](student(1, 9));                                           // the newer request answers first
  await newer;
  waiting[1](student(1, 3));                                           // the older one straggles in
  assert.equal(await older, false);
  assert.deepEqual(updates, [9]);
  assert.equal(live.me.world.month, 9);
});

test('sync: on(name, fn) hears any stream event, before or after the stream opens, across reconnects, without a refetch; off stops it', async () => {
  const h = harness(() => student());
  const early = [];
  h.live.on('custom', (ev) => early.push(ev.data));                    // subscribed before the first stream exists
  await h.live.sync();
  const late = [];
  const off = h.live.on('other', (ev) => late.push(ev.data));          // and one subscribed while it is open
  const base = h.log.fetches;
  h.all[0].fire('custom', 'a');
  h.all[0].fire('other', 'b');
  h.all[0].fire('other', 'b2');
  h.tm.run(1000);
  await flush();
  assert.deepEqual(early, ['a']);
  assert.deepEqual(late, ['b', 'b2']);
  assert.equal(h.log.fetches, base);                                   // a panel listener does not trigger a refetch by itself
  off();
  h.all[0].fire('other', 'c');
  assert.deepEqual(late, ['b', 'b2']);
  h.all[0].die();                                                      // stream dies for good; after RETRY_MS a new one opens and still delivers
  h.tm.run(RETRY_MS);
  await flush();
  assert.equal(h.all.length, 2);
  h.all[1].fire('custom', 'd');
  assert.deepEqual(early, ['a', 'd']);
});

test('sync: a failed first /api/me says so, retries with backoff 1, 2, 4... up to 30 s, then opens the stream', async () => {
  assert.deepEqual([0, 1, 2, 3, 4, 5, 6, 9].map(backoffMs), [1000, 2000, 4000, 8000, 16000, 30000, 30000, 30000]);
  let down = 3;
  const h = harness(() => { if (down-- > 0) throw new Error('offline'); return student(); });
  await h.live.sync();
  assert.deepEqual(h.log.offline, [true]);                             // "Can't reach core. Retrying…" is on screen once
  assert.equal(h.all.length, 0);                                       // no stream yet
  h.tm.run(999);
  assert.equal(h.log.fetches, 1);
  h.tm.run(1);                                                         // 1 s: second try fails
  await flush();
  assert.equal(h.log.fetches, 2);
  h.tm.run(1999);
  assert.equal(h.log.fetches, 2);
  h.tm.run(1);                                                         // 2 s later: third try fails
  await flush();
  assert.equal(h.log.fetches, 3);
  h.tm.run(4000);                                                      // 4 s later: it works
  await flush();
  assert.equal(h.log.fetches, 4);
  assert.deepEqual(h.log.shows, [1]);
  assert.deepEqual(h.log.offline, [true, false]);
  assert.equal(h.all.length, 1);                                       // and the stream is open
});
