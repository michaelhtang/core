// Bill Dash in the browser: the canvas drawing, the input and the fixed-step loop around billdash-core.js. Every sprite is drawn here from
// rects and small pixel maps, so there are no image or font files. The core decides everything that counts; this file only shows it and
// records the inputs as a change list [[tick, mask], ...] for the server to replay.
import { C, KINDS, PAY, SALE, createGame, step, score, yOf } from '/m/arcade/games/billdash-core.js?v=__V__';

export const W = 160, H = 120;
const LANE_X = 32, LANE_W = 24, ITEM = 12, PLAYER_Y = 108;
const STEP_MS = 1000 / C.TPS;

export const COLOR = { bg: '#0b1330', lane: '#122046', laneAlt: '#16294f', zone: 'rgba(245,196,81,0.13)', edge: '#f5c451', late: '#ff5a4a', hud: '#0e1a3d', ink: '#f4f7ff', dim: '#8ea3c2',
  cash: '#5ee08a', gold: '#f5c451', calm: '#5aa0ff', warn: '#f5a623', hot: '#ff5a4a', paper: '#f4f1e6', dark: '#1a2238' };

// 3x5 pixel font, 15 bits per glyph, rows top to bottom, 3 bits a row.
const GLYPHS = {
  A: '010101111101101', B: '110101110101110', C: '011100100100011', D: '110101101101110', E: '111100110100111', F: '111100110100100', G: '011100101101011',
  H: '101101111101101', I: '111010010010111', J: '001001001101010', K: '101101110101101', L: '100100100100111', M: '101111111101101', N: '110101101101101',
  O: '010101101101010', P: '110101110100100', Q: '010101101111011', R: '110101110101101', S: '011100010001110', T: '111010010010010', U: '101101101101111',
  V: '101101101101010', W: '101101111111101', X: '101101010101101', Y: '101101010010010', Z: '111001010100111',
  0: '111101101101111', 1: '010110010010111', 2: '110001010100111', 3: '110001010001110', 4: '101101111001001', 5: '111100110001110', 6: '011100111101111',
  7: '111001010010010', 8: '111101111101111', 9: '111101111001110', $: '011110010011110', '-': '000000111000000', '!': '010010010000010', '.': '000000000000010',
  ':': '000010000010000', '+': '000010111010000', '%': '101001010100101', ' ': '000000000000000',
};
export function text(ctx, str, x, y, color, size = 1) {
  ctx.fillStyle = color;
  let cx = x;
  for (const ch of String(str).toUpperCase()) {
    const g = GLYPHS[ch] ?? GLYPHS[' '];
    for (let i = 0; i < 15; i++) if (g[i] === '1') ctx.fillRect(cx + (i % 3) * size, y + Math.trunc(i / 3) * size, size, size);
    cx += 4 * size;
  }
  return cx - x - size;                                   // width drawn
}
const textW = (str, size = 1) => String(str).length * 4 * size - size;

// 8x8 icons ('#' = ink). Drawn inside a 12x12 item.
const ICON = {
  rent: ['...##...', '..####..', '.######.', '########', '.######.', '.##..##.', '.##..##.', '.##..##.'],
  phone: ['.######.', '.#....#.', '.#....#.', '.#....#.', '.#....#.', '.######.', '.##..##.', '.######.'],
  card: ['........', '########', '#......#', '########', '#......#', '#.###..#', '########', '........'],
  ins: ['########', '########', '###..###', '##....##', '.##..##.', '..####..', '...##...', '........'],
  pay: ['...##...', '.######.', '##.##...', '.#####..', '...#####', '...##.##', '.######.', '...##...'],
  sale: ['##...#..', '##..#...', '...#....', '..#.....', '.#..##..', '#...##..', '........', '........'],
};
const icon = (ctx, name, x, y, color) => {
  ctx.fillStyle = color;
  ICON[name].forEach((row, r) => { for (let c = 0; c < 8; c++) if (row[c] === '#') ctx.fillRect(x + c, y + r, 1, 1); });
};

// The player: a small wolf in a blue shirt, 12x12.
const WOLF = ['.dd......dd.', '.dgd....dgd.', '.dggggggggd.', '..gwegggewg.', '..gggnnnggg.', '..gwwwwwwwg.', '..bbbbbbbb..', '.gbbbbbbbbg.', '.gbbbbbbbbg.', '..bbbbbbbb..', '..dd....dd..', '..dd....dd..'];
const WOLF_COLOR = { d: '#2a3550', g: '#8ea3c2', w: '#f4f7ff', e: '#0b1020', n: '#0b1020', b: '#338fbf' };
export function wolf(ctx, x, y) {
  WOLF.forEach((row, r) => { for (let c = 0; c < 12; c++) { const col = WOLF_COLOR[row[c]]; if (col) { ctx.fillStyle = col; ctx.fillRect(x + c, y + r, 1, 1); } } });
}

const heart = (ctx, x, y, color) => {
  ctx.fillStyle = color;
  ['.##.##.', '#######', '#######', '.#####.', '..###..', '...#...'].forEach((row, r) => { for (let c = 0; c < 7; c++) if (row[c] === '#') ctx.fillRect(x + c, y + r, 1, 1); });
};

// calm -> urgent by how far down it has fallen
const urgency = (y) => (y < 36 ? COLOR.calm : y < 56 ? COLOR.warn : y < C.PAY_TOP + 14 ? '#ff8a3d' : COLOR.hot);

function item(ctx, it, tick) {
  const y = yOf(it);
  tile(ctx, it.kind, LANE_X + it.lane * LANE_W + (LANE_W - ITEM) / 2, y, tick, urgency(y));
}

// One 12x12 item with its top-left corner at x, y. edge: a bill's border colour (urgency in the game, a fixed one in the legend).
export function tile(ctx, kind, x, y, tick, edge) {
  const k = KINDS[kind];
  if (kind === PAY) {
    ctx.fillStyle = '#1f7a45'; ctx.fillRect(x, y, ITEM, ITEM);
    ctx.fillStyle = COLOR.cash; ctx.fillRect(x + 1, y + 1, ITEM - 2, ITEM - 2);
    icon(ctx, 'pay', x + 2, y + 2, '#0d3b21');
  } else if (kind === SALE) {
    const blink = (tick >> 2) & 1;
    ctx.fillStyle = blink ? '#ff3da6' : '#c2187a'; ctx.fillRect(x, y, ITEM, ITEM);
    ctx.fillStyle = blink ? '#ffe14d' : '#fff'; ctx.fillRect(x + 1, y + 1, ITEM - 2, ITEM - 2);
    icon(ctx, 'sale', x + 2, y + 2, '#c2187a');
    ctx.fillStyle = '#c2187a'; ctx.fillRect(x + 4, y, 4, 1);   // a hanging-tag notch
  } else {
    ctx.fillStyle = edge; ctx.fillRect(x, y, ITEM, ITEM);
    ctx.fillStyle = COLOR.paper; ctx.fillRect(x + 1, y + 1, ITEM - 2, ITEM - 2);
    icon(ctx, k.id, x + 2, y + 2, COLOR.dark);
    // the price underneath is too small to read at 160 px wide, so a bar shows it: one pip per $15
    ctx.fillStyle = edge;
    for (let i = 0; i < (k.cost + 14) / 15; i++) ctx.fillRect(x + 1 + i * 2, y + ITEM - 2, 1, 1);
  }
}

// A 14x14 legend picture for arcade.js, drawn with the same code and colours as the game screen so the two always match.
// name: an item id from KINDS ('pay', 'sale', 'rent', 'phone', 'card', 'ins'), or 'zone', 'late', 'you', 'heart'. edge: 'calm', 'warn' or 'hot' (bills only).
export const SWATCH = 14;
export function swatch(ctx, name, edge = 'calm') {
  ctx.fillStyle = COLOR.bg; ctx.fillRect(0, 0, SWATCH, SWATCH);
  const kind = KINDS.findIndex((k) => k.id === name);
  if (kind >= 0) { tile(ctx, kind, 1, 1, 0, COLOR[edge] ?? COLOR.calm); return; }
  if (name === 'heart') { heart(ctx, 3, 4, '#ff4d6d'); return; }
  ctx.fillStyle = COLOR.lane; ctx.fillRect(0, 0, SWATCH, SWATCH);
  if (name === 'zone') {
    ctx.fillStyle = COLOR.zone; ctx.fillRect(0, 4, SWATCH, 10);
    ctx.fillStyle = COLOR.edge; for (let x = 0; x < SWATCH; x += 4) ctx.fillRect(x, 4, 2, 1);
  } else if (name === 'late') {
    ctx.fillStyle = COLOR.zone; ctx.fillRect(0, 0, SWATCH, 7);
    ctx.fillStyle = COLOR.late; ctx.fillRect(0, 7, SWATCH, 1);
  } else if (name === 'you') {
    ctx.fillStyle = 'rgba(245,196,81,0.28)'; ctx.fillRect(0, 0, SWATCH, SWATCH);
    wolf(ctx, 1, 2);
  }
}

export function draw(ctx, s, { best = 0, label = '' } = {}) {
  ctx.fillStyle = COLOR.bg; ctx.fillRect(0, 0, W, H);
  // lanes and the pay zone
  for (let l = 0; l < C.LANES; l++) { ctx.fillStyle = l & 1 ? COLOR.laneAlt : COLOR.lane; ctx.fillRect(LANE_X + l * LANE_W, 0, LANE_W, PLAYER_Y); }
  ctx.fillStyle = COLOR.zone; ctx.fillRect(LANE_X, C.PAY_TOP, LANE_W * C.LANES, C.LATE_Y - C.PAY_TOP);
  ctx.fillStyle = COLOR.edge; for (let x = LANE_X; x < LANE_X + LANE_W * C.LANES; x += 4) ctx.fillRect(x, C.PAY_TOP, 2, 1);
  ctx.fillStyle = COLOR.late; ctx.fillRect(LANE_X, C.LATE_Y, LANE_W * C.LANES, 1);
  ctx.fillStyle = '#1b2b57'; ctx.fillRect(LANE_X, PLAYER_Y, LANE_W * C.LANES, H - PLAYER_Y);
  // items, effects, player
  for (const it of s.items) item(ctx, it, s.tick);
  const px = LANE_X + s.lane * LANE_W + (LANE_W - ITEM) / 2;
  ctx.fillStyle = 'rgba(245,196,81,0.28)'; ctx.fillRect(LANE_X + s.lane * LANE_W, C.PAY_TOP, LANE_W, PLAYER_Y - C.PAY_TOP);
  wolf(ctx, px, PLAYER_Y);
  if (s.actCd > 1) { ctx.fillStyle = COLOR.gold; ctx.fillRect(px + 4, PLAYER_Y - 4, 4, 3); ctx.fillRect(px + 5, PLAYER_Y - 6, 2, 2); }
  for (const f of s.fx) {
    const x = LANE_X + f.lane * LANE_W + 2, y = f.y - (14 - f.ttl);
    const [str, col] = f.kind === 'paid' ? [`+${f.v}`, COLOR.cash] : f.kind === 'cash' ? [`+$${f.v}`, COLOR.gold] : f.kind === 'late' ? ['LATE', COLOR.hot] : f.kind === 'nsf' ? ['NSF', COLOR.hot] : [`-$${f.v}`, '#ff3da6'];
    text(ctx, str, Math.max(LANE_X, Math.min(x, LANE_X + LANE_W * C.LANES - textW(str))), Math.max(1, y), col);
  }
  // HUD, left: cash, hearts, time left
  ctx.fillStyle = COLOR.hud; ctx.fillRect(0, 0, LANE_X, H); ctx.fillRect(LANE_X + LANE_W * C.LANES, 0, W - LANE_X - LANE_W * C.LANES, H);
  text(ctx, 'CASH', 3, 4, COLOR.dim); text(ctx, `$${s.cash}`, 3, 11, COLOR.cash, s.cash > 99 ? 1 : 2);
  ctx.fillStyle = '#243766'; ctx.fillRect(3, 24, 26, 3); ctx.fillStyle = COLOR.cash; ctx.fillRect(3, 24, (26 * s.cash) >> 7, 3);
  for (let i = 0; i < C.LIVES; i++) heart(ctx, 2 + i * 10, 33, i < s.lives ? '#ff4d6d' : '#2a3550');
  const left = Math.max(0, C.ROUND - s.tick);
  text(ctx, 'TIME', 3, 46, COLOR.dim); text(ctx, String((left + C.TPS - 1) / C.TPS | 0), 3, 53, left < 300 ? COLOR.hot : COLOR.ink, 2);
  ctx.fillStyle = '#243766'; ctx.fillRect(3, 66, 26, 3); ctx.fillStyle = COLOR.calm; ctx.fillRect(3, 66, (26 * left) / C.ROUND | 0, 3);
  text(ctx, 'ARROWS', 3, 84, COLOR.dim); text(ctx, 'MOVE', 3, 91, COLOR.dim); text(ctx, 'SPACE', 3, 100, COLOR.gold); text(ctx, 'PAY', 3, 107, COLOR.gold);
  // right: score, best
  const rx = LANE_X + LANE_W * C.LANES + 4;
  text(ctx, 'SCORE', rx, 4, COLOR.dim); text(ctx, String(score(s)), rx, 11, COLOR.gold, score(s) > 999 ? 1 : 2);
  text(ctx, 'BEST', rx, 28, COLOR.dim); text(ctx, String(Math.max(best, score(s))), rx, 35, COLOR.ink);
  text(ctx, 'PAID', rx, 48, COLOR.dim); text(ctx, String(s.stats.paid), rx, 55, COLOR.ink);
  text(ctx, 'LATE', rx, 66, COLOR.dim); text(ctx, String(s.stats.late), rx, 73, s.stats.late ? COLOR.hot : COLOR.ink);
  if (label) {
    ctx.fillStyle = 'rgba(11,19,48,0.72)'; ctx.fillRect(LANE_X, 44, LANE_W * C.LANES, 24);
    text(ctx, label, LANE_X + ((LANE_W * C.LANES - textW(label, 2)) >> 1), 52, COLOR.gold, 2);
  }
}

// Play one round. Returns { stop(), press(bit, down), done } where done resolves { inputs, state, aborted } when the round ends (or is abandoned).
// Keyboard: arrows or A/D move, Space (or Enter/W/Up) stamps. press() is what the touch buttons call.
export function play(canvas, seed, { best = 0 } = {}) {
  const ctx = canvas.getContext('2d');
  const s = createGame(seed);
  const inputs = [];
  let held = 0, pending = 0, lastMask = 0, buf = 0, acc = 0, last = 0, raf = 0, stopped = false, ready = 36;     // 36 ticks (1.2 s) of "READY" first
  let finish;
  const done = new Promise((r) => { finish = r; });
  const press = (bit, down) => { if (down) { held |= bit; pending |= bit; } else held &= ~bit; };
  const KEYS = { ArrowLeft: 1, KeyA: 1, ArrowRight: 2, KeyD: 2, Space: 4, Enter: 4, ArrowUp: 4, KeyW: 4 };
  const key = (down) => (e) => { const bit = KEYS[e.code]; if (!bit) return; e.preventDefault(); if (!e.repeat) press(bit, down); };
  const kd = key(true), ku = key(false);
  const end = (aborted) => {
    if (stopped) return;
    stopped = true;
    cancelAnimationFrame(raf);
    window.removeEventListener('keydown', kd); window.removeEventListener('keyup', ku); document.removeEventListener('visibilitychange', hide);
    draw(ctx, s, { best, label: aborted ? 'STOPPED' : 'TIME UP' });
    finish({ inputs, state: s, aborted });
  };
  const hide = () => { if (document.hidden) end(true); };    // a hidden tab would freeze the round: it ends, and does not count
  window.addEventListener('keydown', kd); window.addEventListener('keyup', ku); document.addEventListener('visibilitychange', hide);
  const frame = (now) => {
    if (stopped) return;
    if (!canvas.isConnected) { end(true); return; }                                  // the panel was closed mid-round
    acc += Math.min(now - last, 250); last = now;
    let n = 0;
    while (acc >= STEP_MS && n++ < 8 && !s.over) {
      acc -= STEP_MS;
      if (ready > 0) { ready--; continue; }
      let mask = (held | pending) & 7;
      // a lane tap inside the move cooldown would be dropped by the core: hold it (latest wins, bit kept low) and send it on the first tick the core takes it
      if (pending & 3) buf = pending & 3;
      if (buf) { if (s.moveCd > 1 || (lastMask & buf)) mask &= ~buf; else { mask |= buf; buf = 0; } }   // still high from before: one low tick makes a fresh press
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
