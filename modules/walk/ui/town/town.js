// Town Walk in the browser: the camera, the input and the fixed-step loop around town-core.js. The core decides everything that counts (where the
// wolf is, which items it picked up); this file only shows it and records the inputs as a change list [[tick, mask], ...] for the server to replay.
// Tap to move and the door prompt are client-side: tap to move just emits the same 4-bit masks every tick, so what is recorded is what is replayed.
import { C, PX_W, PX_H, DOORS, BUILDINGS, createWalk, step, isOver, doorAt, distField, autoMask, nearestWalkable } from '/m/walk/town/town-core.js?v=__V__';
import { VW, VH, buildWorld, wolf, itemSprite } from '/m/walk/town/art.js?v=__V__';
import { text, textW, label } from '/m/walk/town/pixfont.js?v=__V__';
import { SIGNS, FACTS } from '/m/walk/town/facts.js?v=__V__';

export { VW, VH };
const STEP_MS = 1000 / C.TPS, ENTER_TICKS = 12, MAX_STEPS = 4;           // 0.4 s on a door before it opens; at most 4 catch-up ticks a frame
const EMOTE_KEYS = { Digit1: 1, Digit2: 2, Digit3: 3, Numpad1: 1, Numpad2: 2, Numpad3: 3 };   // presence emotes (cosmetic, not recorded)
const KEYS = { ArrowUp: 1, KeyW: 1, ArrowDown: 2, KeyS: 2, ArrowLeft: 4, KeyA: 4, ArrowRight: 8, KeyD: 8 };
const doorByKey = new Map(DOORS.map((d) => [d.key, d]));

// Play one visit. opts: { seed, items (from /start), open: Set of building keys that are open, markers: Set of keys with an open errand,
//   onHud({ collected, left }), onCollect(item), presence (optional, ui/town/presence.js: classmates and emotes; never part of the recording) }.
//   Returns { stop(reason), press(bit, down), done }. done resolves
//   { inputs, ticks, state, reason, door } when the visit ends: 'time', 'leave', 'enter' (door = the key), 'hidden' or 'closed'.
export function play(canvas, opts) {
  const ctx = canvas.getContext('2d');
  const s = createWalk(opts.seed);
  const world = buildWorld(opts.open);
  const inputs = [];
  const floats = [];                                                       // "+RECEIPT" labels: { text, x, y, ttl }
  let held = 0, pending = 0, lastMask = 0, acc = 0, last = 0, raf = 0, stopped = false;
  let target = null, still = 0, lastX = s.x, lastY = s.y, doorKey = null, dwell = 0, seen = 0, lastHud = '';
  let finish;
  const done = new Promise((r) => { finish = r; });
  const cancelTarget = () => { target = null; };

  // Input: a held bit set, plus a one-tick pulse so a very short tap still moves. Any manual input cancels tap-to-move.
  const press = (bit, down) => { if (down) { held |= bit; pending |= bit; cancelTarget(); } else held &= ~bit; };
  const key = (down) => (e) => {
    if (down && !e.repeat && EMOTE_KEYS[e.code] && opts.presence && !e.ctrlKey && !e.metaKey && !e.altKey) { e.preventDefault(); opts.presence.emote(EMOTE_KEYS[e.code]); return; }
    const bit = KEYS[e.code];
    if (!bit || e.ctrlKey || e.metaKey || e.altKey) return;
    e.preventDefault();
    if (!e.repeat) press(bit, down);
  };
  const kd = key(true), ku = key(false);
  const blur = () => { held = 0; };
  const tap = (e) => {
    if (e.button > 0) return;
    e.preventDefault();
    const r = canvas.getBoundingClientRect(), w = canvas.clientWidth || VW, h = canvas.clientHeight || VH;
    const lx = ((e.clientX - r.left - canvas.clientLeft) * VW) / w, ly = ((e.clientY - r.top - canvas.clientTop) * VH) / h;
    const { cx, cy } = camera();
    let tx = Math.floor((cx + lx) / C.TILE), ty = Math.floor((cy + ly) / C.TILE);
    const b = BUILDINGS.find((q) => tx >= q.x && tx < q.x + q.w && ty >= q.y && ty < q.y + q.h);
    if (b) { const d = doorByKey.get(b.key); tx = d.x; ty = d.y; }         // tapping a building walks to its door
    const g = nearestWalkable(tx, ty);
    if (!g) return;
    target = { x: g.x, y: g.y, field: distField(g.x, g.y) }; still = 0;
  };
  canvas.addEventListener('pointerdown', tap);
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());

  const camera = () => ({ cx: Math.max(0, Math.min(PX_W - VW, s.x + 2 - (VW >> 1))), cy: Math.max(0, Math.min(PX_H - VH, s.y + 2 - (VH >> 1))) });

  const end = (reason, door = null) => {
    if (stopped) return;
    stopped = true;
    cancelAnimationFrame(raf);
    window.removeEventListener('keydown', kd); window.removeEventListener('keyup', ku); window.removeEventListener('blur', blur);
    document.removeEventListener('visibilitychange', hide); canvas.removeEventListener('pointerdown', tap);
    render(reason === 'time' ? 'TIME UP' : '');
    finish({ inputs, ticks: s.tick, state: s, reason, door });
  };
  const hide = () => { if (document.hidden) end('hidden'); };           // a hidden tab would freeze the visit: it ends, and what you collected still counts
  window.addEventListener('keydown', kd); window.addEventListener('keyup', ku); window.addEventListener('blur', blur); document.addEventListener('visibilitychange', hide);

  function oneTick() {
    let mask = (held | pending) & 15;
    pending = 0;
    if (mask === 0 && target) {                                            // tap to move steers with the very same core, one mask a tick
      mask = autoMask(s, target.field);
      still = s.x === lastX && s.y === lastY && mask !== 0 ? still + 1 : 0;
      if (mask === 0 || still > 20) target = null;                          // arrived, or stuck against something
    }
    lastX = s.x; lastY = s.y;
    if (mask !== lastMask) { inputs.push([s.tick, mask]); lastMask = mask; }
    step(s, mask);
    while (seen < s.collected.length) {                                     // new pickups since the last tick
      const id = s.collected[seen++], it = s.items.find((q) => q.id === id);
      floats.push({ text: `+${FACTS[it.kind].label}`, x: it.x, y: it.y - 8, ttl: 40 });
      opts.onCollect?.(it);
    }
    const k = doorAt(s);                                                    // standing on a door: a short prompt, then it opens
    if (k !== doorKey) { doorKey = k; dwell = 0; } else if (k) dwell++;
    if (k && opts.open.has(k) && dwell >= ENTER_TICKS) end('enter', k);
  }

  function render(banner) {
    const { cx, cy } = camera(), t = s.tick;
    ctx.drawImage(world, cx, cy, VW, VH, 0, 0, VW, VH);
    for (const d of DOORS) {                                               // lit doors pulse; a pending errand gets a bobbing "!"
      const x = d.x * C.TILE - cx, y = d.y * C.TILE - cy;
      if (x < -16 || y < -40 || x > VW || y > VH) continue;
      if (opts.open.has(d.key)) {
        ctx.fillStyle = (t >> 3) & 1 ? 'rgba(255,226,120,0.55)' : 'rgba(255,226,120,0.25)';
        ctx.fillRect(x, y, C.TILE, 1); ctx.fillRect(x, y + 1, 1, 6); ctx.fillRect(x + 7, y + 1, 1, 6);
      }
      if (opts.markers?.has(d.key)) label(ctx, '!', x + 2, y - 30 - (((t >> 3) & 1) ? 1 : 0), '#ffd94d', 1);
    }
    if (target) {                                                           // where a tap sent you
      const x = target.x * C.TILE - cx, y = target.y * C.TILE - cy;
      ctx.fillStyle = (t >> 2) & 1 ? '#ffffff' : '#ffd94d';
      ctx.fillRect(x + 3, y + 1, 2, 1); ctx.fillRect(x + 3, y + 6, 2, 1); ctx.fillRect(x + 1, y + 3, 1, 2); ctx.fillRect(x + 6, y + 3, 1, 2);
    }
    for (let i = 0; i < 3; i++) { ctx.fillStyle = (t + i * 5) % 12 < 6 ? '#ffffff' : '#bfe6ff'; ctx.fillRect(31 * C.TILE + 2 + i * 2 - cx, 22 * C.TILE - 2 - (((t >> 2) + i) & 3) - cy, 1, 1); }   // fountain spray
    for (const it of s.items) if (!s.collected.includes(it.id)) itemSprite(ctx, it, t, cx, cy);
    opts.presence?.draw(ctx, cx, cy);                                       // classmates first, so you are always on top
    wolf(ctx, { ...s, x: s.x - cx, y: s.y - cy });
    opts.presence?.drawSelf(ctx, s.x - cx, s.y - cy);
    for (const f of floats) { const w = textW(f.text); label(ctx, f.text, Math.max(1, Math.min(VW - w - 1, f.x - cx - (w >> 1))), f.y - cy - (40 - f.ttl >> 1), '#ffffff'); }
    if (doorKey) {                                                          // the prompt above the wolf
      const open = opts.open.has(doorKey), msg = open ? `ENTER ${SIGNS[doorKey]}` : `${SIGNS[doorKey]} CLOSED`, w = textW(msg);
      const x = Math.max(2, Math.min(VW - w - 6, s.x + 2 - cx - (w >> 1) - 2)), y = Math.max(2, s.y - 20 - cy);
      ctx.fillStyle = 'rgba(20,26,48,0.85)'; ctx.fillRect(x, y, w + 4, 9);
      text(ctx, msg, x + 2, y + 2, open ? '#ffd94d' : '#c9cfdb');
      if (open) { ctx.fillStyle = '#ffd94d'; ctx.fillRect(x, y + 9, Math.min(w + 4, ((w + 4) * dwell) / ENTER_TICKS | 0), 1); }
    }
    if (banner) { ctx.fillStyle = 'rgba(20,26,48,0.75)'; ctx.fillRect(0, 50, VW, 20); text(ctx, banner, (VW - textW(banner, 2)) >> 1, 56, '#ffd94d', 2); }
  }

  const frame = (now) => {
    if (stopped) return;
    if (!canvas.isConnected) { end('closed'); return; }                    // the panel was closed mid-visit
    acc += Math.min(now - last, 100); last = now;
    let n = 0;
    while (acc >= STEP_MS && n++ < MAX_STEPS && !isOver(s) && !stopped) { acc -= STEP_MS; oneTick(); }
    if (acc > STEP_MS) acc = STEP_MS;                                       // a slow device runs slower than real time; it never skips ahead
    if (stopped) return;
    for (const f of floats) f.ttl--;
    while (floats.length && floats[0].ttl <= 0) floats.shift();
    const left = Math.max(0, C.MAX_TICKS - s.tick), secs = (left + C.TPS - 1) / C.TPS | 0;
    const hud = `${secs}/${s.collected.length}`;
    if (hud !== lastHud) { lastHud = hud; opts.onHud?.({ collected: s.collected.length, left: secs }); }
    opts.presence?.frame(s.x, s.y, s.face);                                 // after the ticks, outside the step loop: at most one small POST per 250 ms
    render('');
    if (isOver(s)) { end('time'); return; }
    raf = requestAnimationFrame(frame);
  };
  render('');
  opts.onHud?.({ collected: 0, left: (C.MAX_TICKS / C.TPS) | 0 });
  raf = requestAnimationFrame((t) => { last = t; frame(t); });
  return { stop: (reason = 'leave') => end(reason), press, done };
}
