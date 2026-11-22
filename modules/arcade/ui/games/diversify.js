// Diversify in the browser: the canvas drawing, the input and the fixed-step loop around diversify-core.js. Every sprite is drawn here from rects,
// so there are no image or font files; the pixel font and the wolf come from billdash.js. The core decides everything that counts; this file only
// shows it and records the inputs as a change list [[tick, mask], ...] for the server to replay.
import { C, BUCKETS, EVENTS, createGame, step, score, totalOf, percents } from '/m/arcade/games/diversify-core.js?v=__V__';
import { text, wolf, W, H } from '/m/arcade/games/billdash.js?v=__V__';

export { W, H };
const STEP_MS = 1000 / C.TPS;
const X0 = 3, BW = 36, BGAP = 3, TOP = 72, BOTTOM = 104;         // basket columns: x = 3 + 39 i, 36 wide; a bar fills TOP..BOTTOM
const FILL = ['#5ee08a', '#5aa0ff', '#f5c451', '#d46bff'];
const COLOR = { bg: '#0b1330', hud: '#0e1a3d', ink: '#f4f7ff', dim: '#8ea3c2', gold: '#f5c451', up: '#5ee08a', down: '#ff5a4a', wall: '#2a3a6a', well: '#122046' };
const textW = (str, size = 1) => String(str).length * 4 * size - size;
export const money = (c) => `$${Math.floor(c / 100)}.${String(Math.abs(c) % 100).padStart(2, '0')}`;
const colX = (b) => X0 + b * (BW + BGAP);

function bucket(ctx, s, b, scale, flash) {
  const x = colX(b), here = s.lane === b;
  ctx.fillStyle = COLOR.well; ctx.fillRect(x, TOP, BW, BOTTOM - TOP);
  const hgt = Math.min(BOTTOM - TOP, Math.round((s.v[b] * (BOTTOM - TOP)) / scale));
  ctx.fillStyle = FILL[b]; ctx.fillRect(x + 2, BOTTOM - hgt, BW - 4, hgt);
  ctx.fillStyle = 'rgba(255,255,255,0.22)'; ctx.fillRect(x + 2, BOTTOM - hgt, BW - 4, 1);
  ctx.fillStyle = flash ?? (here ? COLOR.gold : COLOR.wall);                                     // walls: gold under the dropper, red or green in a headline's flash
  ctx.fillRect(x, TOP - 2, 2, BOTTOM - TOP + 3); ctx.fillRect(x + BW - 2, TOP - 2, 2, BOTTOM - TOP + 3); ctx.fillRect(x, BOTTOM, BW, 2);
}

export function draw(ctx, s, { best = 0, label = '' } = {}) {
  ctx.fillStyle = COLOR.bg; ctx.fillRect(0, 0, W, H);
  // top bar: total, time left, live score
  ctx.fillStyle = COLOR.hud; ctx.fillRect(0, 0, W, 10);
  text(ctx, 'TOTAL', 2, 2, COLOR.dim); text(ctx, money(totalOf(s)), 23, 2, COLOR.up);
  const left = Math.max(0, C.ROUND - s.tick), secs = Math.ceil(left / C.TPS);
  text(ctx, 'TIME', 66, 2, COLOR.dim); text(ctx, String(secs), 86, 2, left < 300 ? COLOR.down : COLOR.ink);
  text(ctx, 'SCORE', 104, 2, COLOR.dim); text(ctx, String(score(s)), 127, 2, COLOR.gold);
  // headline strip: the news that just hit
  const ev = s.head >= 0 && s.headTtl > 0 ? EVENTS[s.head] : null, good = ev && ev.hit.some((p) => p > 0) && !ev.hit.some((p) => p < 0 && -p > 4);
  ctx.fillStyle = !ev ? COLOR.hud : s.headTtl > C.EV_TTL - 8 ? '#fff' : good ? '#14532d' : '#5b1a1a'; ctx.fillRect(0, 11, W, 10);
  const head = ev ? ev.head : s.tick < C.EV_FIRST ? 'MARKETS OPEN' : 'QUIET MARKET';
  text(ctx, head, (W - textW(head)) >> 1, 14, !ev ? COLOR.dim : s.headTtl > C.EV_TTL - 8 ? '#0b1330' : good ? COLOR.up : '#ff9a8a');
  // rebalance meter
  const ready = s.rebCd === 0;
  text(ctx, 'REBAL', 2, 24, ready ? COLOR.gold : COLOR.dim);
  ctx.fillStyle = '#243766'; ctx.fillRect(24, 25, 132, 3);
  ctx.fillStyle = ready ? COLOR.gold : COLOR.dim; ctx.fillRect(24, 25, Math.round((132 * (C.REBAL_CD - s.rebCd)) / C.REBAL_CD), 3);
  // baskets
  const peak = Math.max(...s.v), scale = Math.max(3000, peak + (peak >> 3));
  const fxOf = (b) => s.fx.find((f) => f.b === b);
  for (let b = 0; b < C.LANES; b++) { const f = fxOf(b); bucket(ctx, s, b, scale, f && f.ttl > 26 ? (f.pct > 0 ? COLOR.up : COLOR.down) : null); }
  // the dropper's lane, the held coin, the coins in the air
  const cx = colX(s.lane) + (BW >> 1);
  ctx.fillStyle = 'rgba(245,196,81,0.05)'; ctx.fillRect(colX(s.lane), 46, BW, TOP - 48);
  wolf(ctx, cx - 6, 30);
  const coin = (x, y) => { ctx.fillStyle = '#b8860b'; ctx.fillRect(x, y, 7, 7); ctx.fillStyle = COLOR.gold; ctx.fillRect(x + 1, y + 1, 5, 5); ctx.fillStyle = '#fff3b0'; ctx.fillRect(x + 2, y + 2, 1, 2); };
  if (s.held) {
    coin(cx - 3, 42);
    ctx.fillStyle = '#243766'; ctx.fillRect(cx - 8, 50, 16, 2); ctx.fillStyle = COLOR.gold; ctx.fillRect(cx - 8, 50, Math.round((16 * (C.HOLD - s.held.age)) / C.HOLD), 2);
  }
  for (const d of s.falling) coin(colX(d.lane) + (BW >> 1) - 3, 44 + Math.round(((s.tick - d.from) * (TOP - 51)) / C.FALL));
  // each basket's name, and its share of the money
  const sh = percents(s.v);
  for (let b = 0; b < C.LANES; b++) {
    const lab = BUCKETS[b].label, x = colX(b) + ((BW - textW(lab)) >> 1);
    text(ctx, lab, x, 107, s.lane === b ? COLOR.gold : COLOR.ink);
    const p = `${sh[b]}%`;
    text(ctx, p, colX(b) + ((BW - textW(p)) >> 1), 114, COLOR.dim);
  }
  for (const f of s.fx) {                                                                          // the headline's hit, floating up from each basket it touched
    const str = `${f.pct > 0 ? '+' : ''}${f.pct}%`;
    text(ctx, str, colX(f.b) + ((BW - textW(str)) >> 1), TOP - 8 - ((36 - f.ttl) >> 2), f.pct > 0 ? COLOR.up : COLOR.down);
  }
  if (label) {
    ctx.fillStyle = 'rgba(11,19,48,0.78)'; ctx.fillRect(0, 54, W, 20);
    text(ctx, label, (W - textW(label, 2)) >> 1, 60, COLOR.gold, 2);
  }
}

// Play one round. Returns { stop(), press(bit, down), done } where done resolves { inputs, state, aborted } when the round ends (or is abandoned).
// Keyboard: arrows or A/D move, Space drops, R or Shift rebalances. press() is what the touch buttons call. A hidden tab or a closed page abandons the
// round (it does not count), exactly like Bill Dash.
export function play(canvas, seed, { best = 0 } = {}) {
  const ctx = canvas.getContext('2d');
  const s = createGame(seed);
  const inputs = [];
  let held = 0, pending = 0, lastMask = 0, acc = 0, last = 0, raf = 0, stopped = false, ready = 36;     // 36 ticks (1.2 s) of "READY" first
  let finish;
  const done = new Promise((r) => { finish = r; });
  const press = (bit, down) => { if (down) { held |= bit; pending |= bit; } else held &= ~bit; };
  const KEYS = { ArrowLeft: 1, KeyA: 1, ArrowRight: 2, KeyD: 2, Space: 4, Enter: 4, ArrowDown: 4, KeyS: 4, KeyR: 8, ShiftLeft: 8, ShiftRight: 8 };
  const key = (down) => (e) => { const bit = KEYS[e.code]; if (!bit) return; e.preventDefault(); if (!e.repeat) press(bit, down); };
  const kd = key(true), ku = key(false);
  const end = (aborted) => {
    if (stopped) return;
    stopped = true;
    cancelAnimationFrame(raf);
    window.removeEventListener('keydown', kd); window.removeEventListener('keyup', ku); document.removeEventListener('visibilitychange', hide); window.removeEventListener('pagehide', gone);
    draw(ctx, s, { best, label: aborted ? 'STOPPED' : 'TIME UP' });
    finish({ inputs, state: s, aborted });
  };
  const hide = () => { if (document.hidden) end(true); };    // a hidden tab would freeze the round: it ends, and does not count
  const gone = () => end(true);
  window.addEventListener('keydown', kd); window.addEventListener('keyup', ku); document.addEventListener('visibilitychange', hide); window.addEventListener('pagehide', gone);
  const frame = (now) => {
    if (stopped) return;
    if (!canvas.isConnected) { end(true); return; }                                  // the panel was closed mid-round
    acc += Math.min(now - last, 250); last = now;
    let n = 0;
    while (acc >= STEP_MS && n++ < 8 && !s.over) {
      acc -= STEP_MS;
      if (ready > 0) { ready--; continue; }
      const mask = (held | pending) & C.MASK_MAX;
      pending = 0;
      if (mask !== lastMask) { inputs.push([s.tick, mask]); lastMask = mask; }
      step(s, mask);
    }
    if (ready > 0) draw(ctx, s, { best, label: ready > 12 ? 'READY' : 'GO!' }); else draw(ctx, s, { best });
    if (s.over) { end(false); return; }
    raf = requestAnimationFrame(frame);
  };
  draw(ctx, s, { best, label: 'READY' });
  raf = requestAnimationFrame((t) => { last = t; frame(t); });
  return { stop: () => end(true), press, done };
}
