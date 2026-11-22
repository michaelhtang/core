// Town Walk presence (docs/walk.md "As built (presence)"): the other students of your class who are on this screen right now. Cosmetic only.
// It sends where you stand (a few times a second, only when it changed, plus a heartbeat), listens for `walk.presence` snapshots on the page's
// event stream, and draws the others with a pseudonym tag. Nothing here is recorded or replayed: it never touches the 30 ticks/s loop, which only
// calls frame() and draw(). Every failure is silent; after one the posts back off for 5 s.
import { hash32 } from '/m/walk/town/town-core.js?v=__V__';
import { wolf, matePal, emoteIcon, VW } from '/m/walk/town/art.js?v=__V__';
import { label, textW } from '/m/walk/town/pixfont.js?v=__V__';

export const SEND_MS = 250, BEAT_MS = 2000, BACKOFF_MS = 5000, LERP_MS = 500, EMOTE_MS = 2500, STALE_MS = 10000, MAX_MATES = 40, TAG_CHARS = 10;
const lerp = (a, b, f) => a + (b - a) * f;

// post(path, body) -> Promise of the JSON reply; leave() (optional) says goodbye in a way that survives a closing page; on(name, fn) -> off; onCount(n) hears how many classmates are here; now() is a ms clock.
export function createPresence({ post, leave, on, onCount = () => {}, now = () => performance.now() }) {
  const mates = new Map();                                          // username -> { fromX, fromY, toX, toY, t0, dir, e, emoteUntil, lastSeen, pal, tag }
  let stopped = false, busy = false, nextAt = 0, sentAt = -1e9, pending = 0, ownE = 0, ownUntil = 0;
  let sx = -1, sy = -1, sd = -1;                                    // what the server was last told

  const at = (m, t) => { const f = Math.min(1, (t - m.t0) / LERP_MS); return { x: lerp(m.fromX, m.toX, f), y: lerp(m.fromY, m.toY, f) }; };
  const num = (v, lo, hi) => Number.isFinite(v) && v >= lo && v <= hi;

  function snapshot(ev) {
    let d;
    try { d = JSON.parse(ev.data); } catch { return; }
    if (stopped || !Array.isArray(d?.players)) return;
    const t = now(), seen = new Set();
    for (const p of d.players.slice(0, MAX_MATES)) {
      if (typeof p?.u !== 'string' || !p.u || !num(p.x, 0, 511) || !num(p.y, 0, 383) || !num(p.d, 0, 3) || !num(p.e, 0, 3)) continue;
      const u = p.u.slice(0, 32);
      seen.add(u);
      let m = mates.get(u);
      if (!m) mates.set(u, m = { fromX: p.x, fromY: p.y, toX: p.x, toY: p.y, t0: t, e: 0, emoteUntil: 0, pal: matePal(hash32(u)), tag: u.slice(0, TAG_CHARS) });
      else { const c = at(m, t); m.fromX = c.x; m.fromY = c.y; m.toX = p.x; m.toY = p.y; m.t0 = t; }
      m.dir = p.d | 0;
      if (p.e && p.e !== m.e) m.emoteUntil = t + EMOTE_MS;          // a new emote starts its 2.5 s; the same one still on the server does not restart
      else if (!p.e) m.emoteUntil = 0;
      m.e = p.e | 0;
      m.lastSeen = t;
    }
    for (const u of [...mates.keys()]) if (!seen.has(u)) mates.delete(u);   // a snapshot is the whole list: whoever is missing has left
    onCount(mates.size);
  }
  const offs = [on('walk.presence', snapshot), on('walk.presence.off', () => stop(false))];   // the second: a teacher turned presence off for this class, hide everyone and stop posting
  onCount(0);

  // Called once a frame with the core's position (integers). Posts at most every 250 ms, only when something changed or 2 s passed.
  function frame(x, y, dir) {
    if (stopped || busy) return;
    const t = now();
    if (t < nextAt) return;
    if (x === sx && y === sy && dir === sd && !pending && t - sentAt < BEAT_MS) return;
    busy = true; sentAt = t; nextAt = t + SEND_MS; sx = x; sy = y; sd = dir;
    const body = { x, y, dir }, mine = pending;
    if (mine) body.emote = mine;
    Promise.resolve().then(() => post('/api/walk/pos', body)).then((r) => {
      if (r?.presence === false) { stop(false); return; }           // the teacher turned it off
      if (r?.dropped) sx = -1;                                      // the server skipped it: send again next time
      else if (pending === mine) pending = 0;
    }).catch(() => { nextAt = now() + BACKOFF_MS; sx = -1; }).finally(() => { busy = false; });
  }

  // Draw the classmates (before your own sprite). cx, cy: the camera. Skips anyone outside the view.
  function draw(ctx, cx, cy) {
    const t = now();
    for (const [u, m] of mates) if (t - m.lastSeen > STALE_MS) mates.delete(u);
    const near = [];
    for (const m of mates.values()) {
      const p = at(m, t), x = Math.round(p.x - cx), y = Math.round(p.y - cy);
      if (x < -12 || x > VW + 8 || y < -30 || y > 130) continue;
      near.push({ m, x, y });
    }
    near.sort((a, b) => a.y - b.y);                                 // lower on the map is drawn on top
    for (const { m, x, y } of near) {
      const moving = m.t0 + LERP_MS > t && (m.fromX !== m.toX || m.fromY !== m.toY);
      wolf(ctx, { x, y, face: m.dir, anim: moving ? (t / 33) | 0 : 0 }, m.pal);
      label(ctx, m.tag, Math.max(1, Math.min(VW - textW(m.tag) - 1, x + 2 - (textW(m.tag) >> 1))), y - 15, '#ffffff');
      if (m.e && t < m.emoteUntil) emoteIcon(ctx, m.e, x - 2, y - 27, (t / 250 | 0) & 1);
    }
  }
  function drawSelf(ctx, x, y) {                                    // your own emote, shown at once (x, y: your box on screen)
    if (ownE && now() < ownUntil) emoteIcon(ctx, ownE, x - 2, y - 19, (now() / 250 | 0) & 1);
  }
  function emote(n) {
    if (stopped || !(n >= 1 && n <= 3)) return;
    ownE = n; ownUntil = now() + EMOTE_MS; pending = n; nextAt = Math.min(nextAt, now());
  }
  function stop(tell = true) {
    if (stopped) return;
    stopped = true;
    offs.forEach((off) => off());
    mates.clear();
    onCount(0);
    if (tell) Promise.resolve().then(() => (leave ? leave() : post('/api/walk/leave', {}))).catch(() => {});
  }
  return { frame, draw, drawSelf, emote, stop, count: () => mates.size };
}
