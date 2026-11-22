// Debt Snake in the browser: the canvas drawing, the input and the fixed-step loop around debtsnake-core.js (docs/debtsnake.md). The core decides
// everything that counts; this file only shows it and records the presses as a change list [[tick, mask], ...] for the server to replay.
// The canvas is drawn at RES x its logical size so the snake can glide between squares with round corners; the pixel font, walls and
// items stay blocky like the rest of the Arcade. Every picture in the legend and the mode picker is drawn by this same code.
import { C, MODE_KEYS, SPEEDS as CORE_STEPS, cellsOf, create, step, score, view } from '/m/arcade/games/debtsnake-core.js?v=__V__';
import { text } from '/m/arcade/games/billdash.js?v=__V__';

export const RES = 4, W = 168, HUD = 30, AREA = 144, FOOT = 10, H = HUD + AREA + FOOT;
const STEP_MS = 1000 / C.TPS, STEPS = CORE_STEPS, MONTH = C.MONTH, WARN = C.WARN;
export const size = () => ({ W, H, RES, width: W * RES, height: H * RES });

export const COL = {
  bg: '#0b0f17', hud: '#111827', cellA: '#1b2332', cellB: '#182030', wall: '#5d6f8f', wallDark: '#33425e', wallHi: '#8397ba', ink: '#f4f7ff', dim: '#8ea3c2',
  teal: '#1fb8a6', tealDark: '#0b524d', tealLite: '#6ff0dc', gold: '#f5c451', goldDark: '#a8761f', red: '#ff6b5b', redDark: '#8a2b24', paper: '#f4f1e6', crate: '#b9824a', crateDark: '#6e4824',
  skull: '#ff4f7a', purple: '#9b7bff', stone: '#8d96a8', green: '#5ee08a',
};

// The modes, in the core's order (the test pins MODE_KEYS to these keys). name: the table in the spec; rule: one line a student can read.
export const MODES = [
  { key: 'classic', name: 'Pay It Down', rule: 'Eat coins to pay your debt down. Every month interest grows your tail.' },
  { key: 'latefees', name: 'Late Fees', rule: 'Every month interest also drops a wall block. A faint marker shows where the next one goes.' },
  { key: 'etransfer', name: 'E-Transfer', rule: 'Coins come in pairs. Go into one and you pop out of the other. One payment clears both.' },
  { key: 'partial', name: 'Partial Payments', rule: 'Every other body segment is a gap you can slip through.' },
  { key: 'noborders', name: 'No Borders', rule: 'There is no outer wall. Leave one edge and come back on the other.' },
  { key: 'transfer', name: 'Balance Transfer', rule: 'After every payment the snake flips, and you steer from the old tail.' },
  { key: 'payday', name: 'Chasing Payday', rule: 'Each coin moves one square every 2 moves.' },
  { key: 'cosigner', name: 'Co-signer', rule: 'A second snake mirrors you. Payments and interest are shared. If either crashes, the round ends.' },
  { key: 'pin', name: 'PIN Unlock', rule: 'Coins start locked. Take the key and the nearest locked coin opens.' },
  { key: 'paperwork', name: 'Push the Paperwork', rule: 'Coins are crates. Push one onto the mailbox square to pay.' },
  { key: 'predatory', name: 'Payday Loan Trap', rule: 'A skull "quick cash" offer adds 3 segments of debt and costs 20 points. It moves every month.' },
  { key: 'expiring', name: 'Expiring Offer', rule: 'A coin fades after 40 moves. A missed coin is a late payment and adds 1 segment.' },
  { key: 'hiddenfees', name: 'Hidden Fees', rule: 'Fees hide inside dashed zones. Stepping on one adds 2 segments and costs 10 points.' },
  { key: 'record', name: 'Credit Record', rule: 'Each payment leaves a stone behind. At most 25 stones, oldest first.' },
  { key: 'fineprint', name: 'Fine Print', rule: 'The board is dark. You only see a little around your head and each coin.' },
  { key: 'emergency', name: 'Emergency Fund', rule: 'Every 2 months a fund appears. Hold one and a crash turns you around instead of ending the round.' },
  { key: 'autopay', name: 'Autopay', rule: 'Six arrow tiles. Step on one and it turns you its way.' },
  { key: 'bigpurchase', name: 'Big Purchase', rule: 'Coins are 3 squares long, like a car loan. Eating one pays 3 segments.' },
  { key: 'directdeposit', name: 'Direct Deposit', rule: 'Coins close to you slide one square toward your head every 2 moves.' },
  { key: 'creditcheck', name: 'Credit Check', rule: 'A gate in the middle wall is open in even months and shut in odd months.' },
  { key: 'tunnel', name: 'Tunnels', rule: 'Two pairs of tunnel holes. Go into one and come out of its partner.' },
  { key: 'practice', name: 'Practice Budget', rule: 'Crashes do not end the round. The move is skipped and the snake turns.' },
];
export const modeName = (key) => MODES.find((m) => m.key === key)?.name ?? key;

// ---------- drawing ----------
const DIR = [[0, -1], [0, 1], [-1, 0], [1, 0]];                      // up, down, left, right (the core's dir)
const geoFor = (w, h) => { const cell = Math.max(4, Math.floor(W / w)); return { cell, bx: (W - cell * w) >> 1, by: HUD + ((AREA - cell * h) >> 1), w, h }; };
const px = (geo, x) => geo.bx + x * geo.cell, py = (geo, y) => geo.by + y * geo.cell;
const rr = (g, x, y, w, h, r, fill) => { g.beginPath(); g.roundRect(x, y, w, h, r); g.fillStyle = fill; g.fill(); };
const dot = (g, x, y, r, fill) => { g.beginPath(); g.arc(x, y, r, 0, 6.2832); g.fillStyle = fill; g.fill(); };
const MAPS = {                                                       // 8x8 pictures ('#' ink)
  skull: ['..####..', '.######.', '##.##.##', '########', '.######.', '..#..#..', '..####..', '........'],
  key: ['..###...', '.#...#..', '.#...#..', '..###...', '...#....', '...##...', '...#....', '...##...'],
  shield: ['########', '#######.', '###..###', '##....##', '###..###', '.######.', '..####..', '...##...'],
  flag: ['.#......', '.###....', '.#####..', '.######.', '.#......', '.#......', '.#......', '.#......'],
  lock: ['..####..', '.#....#.', '.#....#.', '########', '###..###', '###..###', '########', '........'],
};
const pix = (g, name, x, y, s, fill) => { g.fillStyle = fill; MAPS[name].forEach((row, r) => { for (let c = 0; c < 8; c++) if (row[c] === '#') g.fillRect(x + c * s, y + r * s, s, s); }); };

function coinFace(g, cx, cy, r, it, tick) {
  const pulse = 1 + 0.05 * Math.sin(tick / 4);
  if (it.locked) {
    dot(g, cx, cy, r * pulse, '#566079'); dot(g, cx, cy, r * 0.8, '#3a4358');
    pix(g, 'lock', cx - r * 0.5, cy - r * 0.5, r / 8, '#c9d3e8');
    return;
  }
  const paired = it.pair > 0, ring = paired ? COL.purple : COL.goldDark;
  dot(g, cx, cy, r * pulse, ring); dot(g, cx, cy, r * 0.82 * pulse, COL.gold);
  if (paired) {                    // a linked pair: two small arrows
    g.fillStyle = COL.goldDark;
    const a = r * 0.16;
    g.fillRect(cx - r * 0.5, cy - a * 1.6, r, a); g.fillRect(cx - r * 0.5, cy + a * 0.6, r, a);
    g.fillRect(cx + r * 0.3, cy - a * 2.6, a, a * 2); g.fillRect(cx - r * 0.5, cy + a * 0.6, a, a * 2);
  } else text(g, '$', cx - r * 0.3, cy - r * 0.5, COL.goldDark, r / 5);
}

// One item of view(s).items. geo: board geometry; tick: for pulsing and blinking.
export function drawItem(g, it, geo, tick) {
  const c = geo.cell, x0 = px(geo, it.x), y0 = py(geo, it.y), cx = x0 + c / 2, cy = y0 + c / 2, r = c * 0.4;
  switch (it.kind) {
    case 'coin': {
      const len = it.len ?? 1;
      if (len > 1) {                                                // a car loan: one long coin across several squares
        const down = it.dir === 1, w = (down ? 1 : len) * c, h = (down ? len : 1) * c;       // core: dir 0 across, 1 down
        rr(g, x0 + 1, y0 + 1, w - 2, h - 2, c * 0.4, COL.goldDark); rr(g, x0 + 2, y0 + 2, w - 4, h - 4, c * 0.35, COL.gold);
        for (const [cx2, cy2] of cellsOf(it)) text(g, '$', px(geo, cx2) + c * 0.35, py(geo, cy2) + c * 0.28, COL.goldDark, c / 10);
        return;
      }
      const fade = it.fade;
      g.save();
      if (fade > 0) g.globalAlpha = fade <= 8 ? (tick & 2 ? 0.35 : 0.8) : fade <= 16 ? 0.8 : 1;
      coinFace(g, cx, cy, r, it, tick);
      g.restore();
      return;
    }
    case 'key': g.fillStyle = 'rgba(245,196,81,0.18)'; g.fillRect(x0 + 1, y0 + 1, c - 2, c - 2); pix(g, 'key', x0 + c * 0.1, y0 + c * 0.1, c * 0.1, COL.gold); return;
    case 'crate':
      rr(g, x0 + 1, y0 + 1, c - 2, c - 2, 2, COL.crateDark); rr(g, x0 + 2, y0 + 2, c - 4, c - 4, 1.5, COL.crate);
      g.fillStyle = COL.paper; g.fillRect(x0 + c * 0.42, y0 + 2, c * 0.16, c - 4); g.fillRect(x0 + 2, y0 + c * 0.42, c - 4, c * 0.16); return;
    case 'mailbox': {
      g.strokeStyle = COL.tealLite; g.lineWidth = 1; g.setLineDash([2, 2]); g.strokeRect(x0 + 1.5, y0 + 1.5, c - 3, c - 3); g.setLineDash([]);
      rr(g, x0 + c * 0.22, y0 + c * 0.32, c * 0.56, c * 0.4, c * 0.12, COL.tealLite); g.fillStyle = COL.tealDark; g.fillRect(x0 + c * 0.32, y0 + c * 0.45, c * 0.36, c * 0.06);
      g.fillStyle = COL.gold; g.fillRect(x0 + c * 0.72, y0 + c * 0.18, c * 0.08, c * 0.26); return;
    }
    case 'skull': dot(g, cx, cy, r * 1.05, '#4a1626'); pix(g, 'skull', x0 + c * 0.1, y0 + c * 0.1, c * 0.1, COL.skull); return;
    case 'fund': dot(g, cx, cy, r * 1.05, '#0d3b21'); pix(g, 'shield', x0 + c * 0.1, y0 + c * 0.1, c * 0.1, COL.green); return;
    case 'arrow': {
      rr(g, x0 + 1, y0 + 1, c - 2, c - 2, 2, '#14343a'); g.save(); g.translate(cx, cy); g.rotate([-Math.PI / 2, Math.PI / 2, Math.PI, 0][it.dir ?? 3]);
      g.fillStyle = COL.gold; g.beginPath(); g.moveTo(r * 0.8, 0); g.lineTo(-r * 0.2, -r * 0.7); g.lineTo(-r * 0.2, -r * 0.25); g.lineTo(-r * 0.8, -r * 0.25); g.lineTo(-r * 0.8, r * 0.25); g.lineTo(-r * 0.2, r * 0.25); g.lineTo(-r * 0.2, r * 0.7); g.closePath(); g.fill(); g.restore(); return;
    }
    case 'tunnel': {
      const ring = (it.pair & 1) ? COL.purple : COL.tealLite;
      dot(g, cx, cy, r * 1.05, ring); dot(g, cx, cy, r * 0.8, '#05070b'); dot(g, cx, cy, r * 0.4, '#1d2540'); return;
    }
    case 'zone': {                                                  // a dashed 3 x 3 zone (x, y is its top-left square) with a flag; the fee itself is hidden
      g.strokeStyle = COL.red; g.lineWidth = 0.8; g.setLineDash([2, 2]); g.strokeRect(x0 + 0.5, y0 + 0.5, c * 3 - 1, c * 3 - 1); g.setLineDash([]);
      g.fillStyle = 'rgba(255,107,91,0.07)'; g.fillRect(x0, y0, c * 3, c * 3); pix(g, 'flag', x0 + c * 1.15, y0 + c * 1.1, c * 0.09, COL.red); return;
    }
    case 'marker': g.strokeStyle = 'rgba(141,160,200,0.55)'; g.lineWidth = 0.8; g.setLineDash([1.5, 1.5]); g.strokeRect(x0 + 1.5, y0 + 1.5, c - 3, c - 3); g.setLineDash([]); return;
    default:
  }
}

export function drawWall(g, geo, x, y) {
  const c = geo.cell, x0 = px(geo, x), y0 = py(geo, y);
  g.fillStyle = COL.wallDark; g.fillRect(x0, y0, c, c); g.fillStyle = COL.wall; g.fillRect(x0 + 0.5, y0 + 0.5, c - 1.5, c - 1.5);
  g.fillStyle = COL.wallHi; g.fillRect(x0 + 0.5, y0 + 0.5, c - 1.5, 1); g.fillStyle = COL.wallDark; g.fillRect(x0 + 0.5, y0 + c * 0.5, c - 1.5, 0.6); g.fillRect(x0 + c * 0.5, y0 + 0.5, 0.6, c * 0.5);
}

// A snake as one smooth body: from[i] to cells[i] at t (0 to 1), so a move glides and the tail slides in or out when it shrinks or grows.
export function drawSnake(g, sn, geo, t, o) {
  const cells = sn.cells, prev = sn.prev?.length ? sn.prev : cells, c = geo.cell, n = Math.max(cells.length, prev.length);
  const pts = [];
  for (let i = 0; i < n; i++) {
    const to = cells[Math.min(i, cells.length - 1)], from = prev[Math.min(i, prev.length - 1)];
    const f = Math.abs(to[0] - from[0]) + Math.abs(to[1] - from[1]) > 1 ? 1 : t;      // a wrap, tunnel or flip jumps
    pts.push([px(geo, from[0] + (to[0] - from[0]) * f + 0.5), py(geo, from[1] + (to[1] - from[1]) * f + 0.5)]);
  }
  const width = (i) => c * (0.82 - 0.42 * (n > 1 ? i / (n - 1) : 0)) * (i >= cells.length ? 1 - t : 1);
  const gap = (i) => (sn.solid ? sn.solid[i] === false : false);
  const body = o.second ? COL.gold : COL.teal, edge = o.second ? COL.goldDark : COL.tealDark, spot = o.second ? COL.tealLite : COL.gold;
  g.lineCap = 'round'; g.lineJoin = 'round';
  const link = (i, w, col, a = 1) => {
    if (i + 1 >= n || gap(i) || gap(i + 1)) return;
    if (Math.hypot(pts[i][0] - pts[i + 1][0], pts[i][1] - pts[i + 1][1]) > c * 1.6) return;      // across a wrap: no bridge
    g.globalAlpha = a; g.strokeStyle = col; g.lineWidth = w; g.beginPath(); g.moveTo(pts[i][0], pts[i][1]); g.lineTo(pts[i + 1][0], pts[i + 1][1]); g.stroke();
  };
  for (let i = n - 1; i >= 0; i--) {
    if (gap(i)) { g.globalAlpha = 0.4; dot(g, pts[i][0], pts[i][1], width(i) * 0.3, body); g.globalAlpha = 1; continue; }
    link(i, width(i) + 1.4, edge); dot(g, pts[i][0], pts[i][1], width(i) / 2 + 0.7, edge);
  }
  for (let i = n - 1; i >= 0; i--) {
    if (gap(i)) continue;
    const red = flashing(o, i, n);
    link(i, width(i), red ? COL.red : body); dot(g, pts[i][0], pts[i][1], width(i) / 2, red ? COL.red : body);
  }
  for (let i = 2; i < n - 1; i += 3) if (!gap(i)) dot(g, pts[i][0], pts[i][1], width(i) * 0.14, flashing(o, i, n) ? COL.red : spot);
  g.globalAlpha = 1;
  // the head: gold (teal for the second snake), eyes, and a mouth that opens when a coin is close
  const [hx, hy] = pts[0], R = width(0) * 0.62, [dx, dy] = DIR[sn.dir ?? 3], pxv = -dy, pyv = dx;
  dot(g, hx, hy, R + 0.8, edge); dot(g, hx, hy, R, o.second ? COL.teal : COL.gold);
  const open = o.near <= 2 ? 0.35 + 0.22 * (2 - o.near) : 0;
  if (open) { g.fillStyle = '#2a0b12'; g.beginPath(); g.moveTo(hx, hy); g.lineTo(hx + dx * R * 1.15 + pxv * R * open * 1.5, hy + dy * R * 1.15 + pyv * R * open * 1.5); g.lineTo(hx + dx * R * 1.15 - pxv * R * open * 1.5, hy + dy * R * 1.15 - pyv * R * open * 1.5); g.closePath(); g.fill(); }
  for (const s of [-1, 1]) {
    const ex = hx + dx * R * 0.1 + pxv * R * 0.5 * s, ey = hy + dy * R * 0.1 + pyv * R * 0.5 * s;
    dot(g, ex, ey, R * 0.22, COL.paper); dot(g, ex + dx * R * 0.08, ey + dy * R * 0.08, R * 0.11, '#0b0f17');
  }
  if (o.shield) { g.strokeStyle = COL.green; g.lineWidth = 0.9; g.beginPath(); g.arc(hx, hy, R + 2.4, 0, 6.2832); g.stroke(); }
}
const flashing = (o, i, n) => o.warn && i >= n - 4 && (o.tick >> 2) & 1;

const money = (segments) => `$${segments * 100}`;

// The whole screen for one view. x: effects and labels from play(); a fresh object is fine.
export function draw(g, v, x = {}) {
  g.setTransform(RES, 0, 0, RES, 0, 0);
  g.fillStyle = COL.bg; g.fillRect(0, 0, W, H);
  const geo = geoFor(v.w, v.h), c = geo.cell, tick = v.tick ?? 0, t = Math.min(1, ((v.progress ?? 0) + (x.frac ?? 0)) / (x.step ?? 5));
  // HUD
  g.fillStyle = COL.hud; g.fillRect(0, 0, W, HUD);
  const inDebt = v.debt > 0, warn = inDebt && v.month_moves_left <= WARN && !v.over;
  text(g, 'DEBT', 3, 3, COL.dim); text(g, money(v.debt), 3, 9, inDebt ? COL.red : COL.tealLite, 2);
  text(g, 'SAVED', 64, 3, COL.dim); text(g, money(v.savings), 64, 9, v.savings ? COL.gold : COL.dim, 2);
  const sc = String(v.score);
  text(g, 'SCORE', W - 3 - 19, 3, COL.dim); text(g, sc, W - 3 - (sc.length * 8 - 2), 9, COL.gold, 2);
  const frac = Math.max(0, Math.min(1, (MONTH - v.month_moves_left) / MONTH));
  text(g, warn ? 'INTEREST' : `MONTH ${v.month + 1}`, 3, 22, warn && (tick >> 2) & 1 ? COL.paper : warn ? COL.red : COL.dim);
  g.fillStyle = '#243049'; g.fillRect(44, 22, W - 47, 5); g.fillStyle = warn ? ((tick >> 2) & 1 ? COL.red : '#c2483b') : COL.teal; g.fillRect(44, 22, Math.round((W - 47) * frac), 5);
  if (v.shield) { pix(g, 'shield', 118, 2, 1.2, COL.green); }
  // board
  g.fillStyle = COL.wallDark; g.fillRect(geo.bx - 2, geo.by - 2, c * v.w + 4, c * v.h + 4);
  for (let yy = 0; yy < v.h; yy++) for (let xx = 0; xx < v.w; xx++) { g.fillStyle = (xx + yy) & 1 ? COL.cellA : COL.cellB; g.fillRect(px(geo, xx), py(geo, yy), c, c); }
  if (v.wrap) { g.strokeStyle = COL.teal; g.lineWidth = 1; g.setLineDash([3, 3]); g.strokeRect(geo.bx - 1.5, geo.by - 1.5, c * v.w + 3, c * v.h + 3); g.setLineDash([]); }
  else { g.strokeStyle = COL.wall; g.lineWidth = 1; g.strokeRect(geo.bx - 1.5, geo.by - 1.5, c * v.w + 3, c * v.h + 3); }
  for (const [wx, wy] of v.walls) drawWall(g, geo, wx, wy);
  for (const [sx, sy] of v.stones) { dot(g, px(geo, sx + 0.5), py(geo, sy + 0.5), c * 0.38, '#3b4252'); dot(g, px(geo, sx + 0.5) - 0.3, py(geo, sy + 0.5) - 0.3, c * 0.32, COL.stone); }
  if (v.gate) {
    for (let gy = v.gate.y0; gy <= v.gate.y1; gy++) {
      const x0 = px(geo, v.gate.x), y0 = py(geo, gy), blink = v.gate.warn && (tick >> 2) & 1;
      if (v.gate.open) { g.fillStyle = blink ? 'rgba(255,107,91,0.55)' : 'rgba(111,240,220,0.14)'; g.fillRect(x0, y0, c, c); g.strokeStyle = blink ? COL.red : COL.tealLite; g.lineWidth = 0.7; g.setLineDash([1.5, 1.5]); g.strokeRect(x0 + 0.5, y0 + 0.5, c - 1, c - 1); g.setLineDash([]); }
      else { g.fillStyle = '#7a5a12'; g.fillRect(x0, y0, c, c); g.fillStyle = COL.gold; for (let k = -c; k < c; k += 4) { g.beginPath(); g.moveTo(x0 + k, y0 + c); g.lineTo(x0 + k + 2, y0 + c); g.lineTo(x0 + k + c + 2, y0); g.lineTo(x0 + k + c, y0); g.fill(); } }
    }
  }
  for (const it of v.items.filter((i) => i.kind === 'zone' || i.kind === 'marker')) drawItem(g, it, geo, tick);
  for (const it of v.items) if (it.kind !== 'zone' && it.kind !== 'marker') drawItem(g, it, geo, tick);
  v.snakes.forEach((sn, i) => drawSnake(g, sn, geo, t, { tick, near: v.near, warn, shield: v.shield && i === 0, second: i > 0 }));
  if (v.dark) {                                                     // Fine Print: 2 squares around the head, 1 around each item
    const lit = new Set(), mark = (cx0, cy0, rad) => { for (let yy = cy0 - rad; yy <= cy0 + rad; yy++) for (let xx = cx0 - rad; xx <= cx0 + rad; xx++) lit.add(`${xx},${yy}`); };
    for (const sn of v.snakes) mark(sn.cells[0][0], sn.cells[0][1], 2);
    for (const it of v.items) {
      if (it.kind === 'zone') { mark(it.x + 1, it.y + 1, 2); continue; }
      for (const [ix, iy] of cellsOf(it)) mark(ix, iy, 1);
    }
    g.fillStyle = 'rgba(3,5,9,0.93)';
    for (let yy = 0; yy < v.h; yy++) for (let xx = 0; xx < v.w; xx++) if (!lit.has(`${xx},${yy}`)) g.fillRect(px(geo, xx), py(geo, yy), c, c);
  }
  for (const p of x.parts ?? []) { g.globalAlpha = Math.max(0, p.life / 16); g.fillStyle = p.col; g.fillRect(p.x - 0.7, p.y - 0.7, 1.4, 1.4); }
  g.globalAlpha = 1;
  for (const f of x.floats ?? []) { const w = String(f.text).length * 4 - 1; text(g, f.text, Math.max(1, Math.min(W - w - 1, f.x - w / 2)), f.y, f.col); }
  if (x.flash && x.flash.ttl > 0) { g.globalAlpha = Math.min(0.5, x.flash.ttl / x.flash.max * 0.5); g.fillStyle = x.flash.col; g.fillRect(0, HUD, W, AREA); g.globalAlpha = 1; }
  // footer: the mode and the best
  g.fillStyle = COL.hud; g.fillRect(0, HUD + AREA, W, FOOT);
  if (x.mode) text(g, x.mode.slice(0, 28), 3, HUD + AREA + 3, COL.dim);
  if (x.best !== undefined) { const b = `BEST ${Math.max(x.best, v.score)}`; text(g, b, W - 3 - (b.length * 4 - 1), HUD + AREA + 3, COL.gold); }
  if (x.label) {
    g.fillStyle = 'rgba(11,15,23,0.78)'; const lw = x.label.length * 8 - 2; g.fillRect(((W - lw) >> 1) - 5, HUD + (AREA >> 1) - 10, lw + 10, 20);
    text(g, x.label, (W - lw) >> 1, HUD + (AREA >> 1) - 5, x.labelCol ?? COL.gold, 2);
  }
}

// ---------- effects from the core's events ----------
function effects() {
  const fx = { parts: [], floats: [], flash: null, shake: 0, label: '', labelTtl: 0, seed: 12345 };
  const rnd = () => { fx.seed = (Math.imul(fx.seed, 1664525) + 1013904223) >>> 0; return fx.seed / 4294967296; };
  const burst = (x, y, col, n) => { for (let i = 0; i < n; i++) { const a = rnd() * 6.283, sp = 0.3 + rnd() * 0.9; fx.parts.push({ x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 0.3, life: 10 + (rnd() * 6 | 0), col }); } };
  const float = (x, y, textStr, col) => fx.floats.push({ x, y, text: textStr, col, ttl: 30 });
  fx.event = (e, geo) => {
    const cx = px(geo, e.x + 0.5), cy = py(geo, e.y + 0.5);
    switch (e.kind) {
      case 'pay': burst(cx, cy, COL.gold, 12); float(cx, cy - 4, `-${money(e.n || 1)}`, COL.tealLite); break;
      case 'save': burst(cx, cy, COL.gold, 10); float(cx, cy - 4, `+${10 * (e.n || 1)}`, COL.gold); break;
      case 'interest': float(cx, cy - 2, e.debt ? `+${money(e.n || 1)}` : `+${10 * (e.n || 1)}`, e.debt ? COL.red : COL.gold); break;
      case 'debtfree': fx.flash = { col: COL.gold, ttl: 24, max: 24 }; fx.label = 'DEBT FREE'; fx.labelTtl = 50; break;
      case 'crash': fx.flash = { col: COL.red, ttl: 14, max: 14 }; fx.shake = 10; burst(cx, cy, COL.red, 14); break;
      case 'fee': float(cx, cy - 4, '-10', COL.red); burst(cx, cy, COL.red, 8); break;
      case 'trap': float(cx, cy - 4, `+${money(e.n ?? 3)}`, COL.red); burst(cx, cy, COL.skull, 10); break;
      case 'key': float(cx, cy - 4, 'KEY', COL.gold); break;
      case 'shield': float(cx, cy - 4, 'SAFE', COL.green); burst(cx, cy, COL.green, 8); break;
      case 'flip': burst(cx, cy, COL.tealLite, 8); break;
      case 'teleport': burst(cx, cy, COL.purple, 6); break;
      case 'expire': float(cx, cy - 4, '+$100', COL.red); break;
      default:
    }
  };
  fx.tick = () => {
    for (const p of fx.parts) { p.x += p.vx; p.y += p.vy; p.life--; }
    fx.parts = fx.parts.filter((p) => p.life > 0);
    for (const f of fx.floats) { f.y -= 0.35; f.ttl--; }
    fx.floats = fx.floats.filter((f) => f.ttl > 0);
    if (fx.flash) fx.flash.ttl--;
    if (fx.shake > 0) fx.shake--;
    if (fx.labelTtl > 0 && --fx.labelTtl === 0) fx.label = '';
  };
  return fx;
}

// ---------- play ----------
// Returns { stop(), press(bit, down), done }: done resolves { inputs, state, aborted } when the round ends (or is abandoned).
// Masks: 1 up, 2 down, 4 left, 8 right. Each press becomes its own one-tick pulse (a gap tick between two of the same key), in the order made,
// so the core, which turns on a rising edge, sees exactly what was pressed and the log replays the same.
export function play(canvas, seed, { best = 0, opts } = {}) {
  const g = canvas.getContext('2d');
  const s = create(seed, opts), geoOf = (v) => geoFor(v.w, v.h);
  const stepTicks = STEPS[opts?.speed] ?? 5, label = (opts?.modes ?? ['classic']).map((m) => modeName(m)).join(' + ').toUpperCase();
  const footer = label.length > 28 ? `${opts.modes.length} MODES MIXED` : label;
  const inputs = [], queue = [], fx = effects();
  let tick = 0, lastMask = 0, acc = 0, last = 0, raf = 0, stopped = false, ready = 24, end = '', crashed = false, v = view(s);
  let finish;
  const done = new Promise((r) => { finish = r; });
  const press = (bit, down) => { if (down && queue.length < 3 && ready >= 0) queue.push(bit); };
  const KEYS = { ArrowUp: 1, KeyW: 1, ArrowDown: 2, KeyS: 2, ArrowLeft: 4, KeyA: 4, ArrowRight: 8, KeyD: 8 };
  const kd = (e) => { if (e.code === 'Space') { e.preventDefault(); return; } const bit = KEYS[e.code]; if (!bit || e.ctrlKey || e.metaKey || e.altKey) return; e.preventDefault(); if (!e.repeat) press(bit, true); };
  // swipe: a drag of about 22 px picks a direction (the longer way), and the next swipe starts from where this one ended
  let sx = 0, sy = 0, swiping = false;
  const pd = (e) => { swiping = true; sx = e.clientX; sy = e.clientY; };
  const pm = (e) => {
    if (!swiping) return;
    const dx = e.clientX - sx, dy = e.clientY - sy;
    if (Math.max(Math.abs(dx), Math.abs(dy)) < 22) return;
    press(Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 8 : 4) : (dy > 0 ? 2 : 1), true); sx = e.clientX; sy = e.clientY;
  };
  const pu = () => { swiping = false; };
  const stopEnd = (aborted) => {
    if (stopped) return;
    stopped = true;
    cancelAnimationFrame(raf);
    window.removeEventListener('keydown', kd); document.removeEventListener('visibilitychange', hide);
    canvas.removeEventListener('pointerdown', pd); canvas.removeEventListener('pointermove', pm); canvas.removeEventListener('pointerup', pu); canvas.removeEventListener('pointercancel', pu);
    v = view(s); draw(g, v, { best, mode: footer, step: stepTicks, parts: fx.parts, floats: fx.floats, label: aborted ? 'STOPPED' : end, labelCol: end === 'CRASH' ? COL.red : COL.gold });
    finish({ inputs, state: s, aborted });
  };
  const hide = () => { if (document.hidden) stopEnd(true); };   // a hidden tab would freeze the round: it ends, and does not count
  window.addEventListener('keydown', kd); document.addEventListener('visibilitychange', hide);
  canvas.addEventListener('pointerdown', pd); canvas.addEventListener('pointermove', pm); canvas.addEventListener('pointerup', pu); canvas.addEventListener('pointercancel', pu);
  canvas.__view = () => v;                                           // read-only peek at the latest view (a scripted browser check uses it; nothing hidden is in it)
  const render = (extra = {}) => {
    const shaken = fx.shake > 0;
    if (shaken) { g.save(); g.translate(((fx.shake & 1) ? 1 : -1) * 0.6 * RES, 0); }
    draw(g, v, { best, mode: footer, step: stepTicks, frac: Math.min(acc / STEP_MS, 0.99), parts: fx.parts, floats: fx.floats, flash: fx.flash, label: fx.label, ...extra });
    if (shaken) g.restore();
  };
  const frame = (now) => {
    if (stopped) return;
    if (!canvas.isConnected) { stopEnd(true); return; }                                // the panel was closed mid-round
    acc += Math.min(now - last, 250); last = now;
    let n = 0;
    while (acc >= STEP_MS && n++ < 8 && !v.over) {
      acc -= STEP_MS;
      if (ready > 0) { ready--; continue; }
      let mask = 0;
      const full = inputs.length >= C.MAX_INPUTS - 2;                      // the log is full: no new press is taken, so local play and the server replay stay identical
      if (full) { queue.length = 0; mask = lastMask; }
      else if (queue.length) { if (queue[0] & lastMask) mask = 0; else mask = queue.shift(); }
      if (mask !== lastMask) { inputs.push([tick, mask]); lastMask = mask; }
      step(s, mask);
      v = view(s); tick = v.tick;
      const geo = geoOf(v);
      crashed = false;
      for (const e of v.events ?? []) { fx.event({ ...e, debt: v.debt > 0 }, geo); if (e.kind === 'crash') crashed = true; }
      fx.tick();
    }
    if (v.over) end = crashed ? 'CRASH' : 'TIME UP';
    render(ready > 0 ? { label: ready > 8 ? 'READY' : 'GO!' } : {});
    if (v.over) { stopEnd(false); return; }
    raf = requestAnimationFrame(frame);
  };
  render({ label: 'READY' });
  raf = requestAnimationFrame((t) => { last = t; frame(t); });
  return { stop: () => stopEnd(true), press, done };
}
export { score };

// ---------- pictures for the legend and the mode picker (same drawing code as the game) ----------
export const SW = 24;
function swatchBoard(g, w, h) {
  g.setTransform(2, 0, 0, 2, 0, 0);
  g.fillStyle = COL.bg; g.fillRect(0, 0, SW, SW);
  g.fillStyle = COL.cellA; g.fillRect(2, 2, 20, 20);
  return { cell: 20, bx: 2, by: 2, w, h };
}
// name: an item kind ('coin', 'locked', 'pair', 'big', 'key', 'crate', 'mailbox', 'skull', 'fund', 'arrow', 'tunnel', 'zone', 'marker', 'fading'), or 'wall', 'stone', 'gate', 'gateshut', 'snake', 'second', 'head', 'bar', 'warn'.
export function swatch(g, name) {
  const geo = swatchBoard(g, 1, 1), tick = 0;
  const sn = (pts, dir, second) => drawSnake(g, { cells: pts, prev: pts, dir, gaps: false }, { ...geo, cell: 8, bx: 4, by: 4 }, 1, { tick: 0, near: 9, warn: false, second });
  switch (name) {
    case 'coin': drawItem(g, { kind: 'coin', x: 0, y: 0 }, geo, tick); break;
    case 'locked': drawItem(g, { kind: 'coin', x: 0, y: 0, locked: true }, geo, tick); break;
    case 'pair': drawItem(g, { kind: 'coin', x: 0, y: 0, pair: 1 }, geo, tick); break;
    case 'fading': drawItem(g, { kind: 'coin', x: 0, y: 0, fade: 6 }, geo, 2); break;
    case 'big': { const o = { cell: 6, bx: 3, by: 9, w: 3, h: 1 }; drawItem(g, { kind: 'coin', x: 0, y: 0, len: 3, dir: 3 }, o, tick); break; }
    case 'wall': drawWall(g, geo, 0, 0); break;
    case 'stone': dot(g, 12, 12, 7.6, '#3b4252'); dot(g, 11.7, 11.7, 6.4, COL.stone); break;
    case 'gate': g.fillStyle = 'rgba(111,240,220,0.14)'; g.fillRect(2, 2, 20, 20); g.strokeStyle = COL.tealLite; g.lineWidth = 0.7; g.setLineDash([1.5, 1.5]); g.strokeRect(2.5, 2.5, 19, 19); g.setLineDash([]); break;
    case 'gateshut': g.fillStyle = '#7a5a12'; g.fillRect(2, 2, 20, 20); g.fillStyle = COL.gold; for (let k = -20; k < 20; k += 4) { g.beginPath(); g.moveTo(2 + k, 22); g.lineTo(4 + k, 22); g.lineTo(24 + k, 2); g.lineTo(22 + k, 2); g.fill(); } break;
    case 'snake': g.fillStyle = COL.bg; g.fillRect(0, 0, SW, SW); sn([[2, 2], [1, 2], [0, 2], [0, 1]], 3, false); break;
    case 'second': g.fillStyle = COL.bg; g.fillRect(0, 0, SW, SW); sn([[2, 2], [1, 2], [0, 2], [0, 1]], 2, true); break;
    case 'bar': g.fillStyle = COL.hud; g.fillRect(0, 0, SW, SW); g.fillStyle = '#243049'; g.fillRect(2, 10, 20, 5); g.fillStyle = COL.teal; g.fillRect(2, 10, 12, 5); break;
    case 'warn': g.fillStyle = COL.hud; g.fillRect(0, 0, SW, SW); g.fillStyle = '#243049'; g.fillRect(2, 10, 20, 5); g.fillStyle = COL.red; g.fillRect(2, 10, 19, 5); break;
    case 'zone': { const o = { cell: 7, bx: 1.5, by: 1.5, w: 3, h: 3 }; drawItem(g, { kind: 'zone', x: 0, y: 0 }, o, tick); break; }
    default: drawItem(g, { kind: name, x: 0, y: 0, dir: 3, pair: 0 }, geo, tick);
  }
}

// A small picture for each mode: a six-by-six board corner showing what that mode changes. 24 x 24, drawn on a canvas scaled 2x.
export function modeIcon(g, key) {
  g.setTransform(2, 0, 0, 2, 0, 0);
  g.fillStyle = '#131a28'; g.fillRect(0, 0, SW, SW);
  const q = (x, y, w, h, col) => { g.fillStyle = col; g.fillRect(x, y, w, h); };
  const seg = (pts, col = COL.teal) => { pts.forEach(([x, y], i) => { rr(g, x * 4 + 1, y * 4 + 1, 4, 4, 1.5, col); if (i === 0) q(x * 4 + 3, y * 4 + 2, 1, 1, '#0b0f17'); }); };
  const coin = (x, y, col = COL.gold) => { dot(g, x * 4 + 3, y * 4 + 3, 2.4, COL.goldDark); dot(g, x * 4 + 3, y * 4 + 3, 1.8, col); };
  const arrow = (x, y, dx, dy, col = COL.gold) => { g.save(); g.translate(x, y); g.rotate(Math.atan2(dy, dx)); g.fillStyle = col; g.beginPath(); g.moveTo(3, 0); g.lineTo(-1, -2.5); g.lineTo(-1, 2.5); g.fill(); g.restore(); };
  const head = (x, y, col = COL.gold) => { dot(g, x * 4 + 3, y * 4 + 3, 2.6, col); };
  switch (key) {
    case 'classic': seg([[2, 4], [1, 4], [0, 4], [0, 3]]); head(3, 4); coin(5, 1); break;
    case 'latefees': q(1, 1, 5, 5, COL.wall); q(1, 1, 5, 1, COL.wallHi); g.strokeStyle = COL.dim; g.setLineDash([1.5, 1.5]); g.lineWidth = 0.8; g.strokeRect(13.5, 4.5, 6, 6); g.setLineDash([]); seg([[2, 4], [1, 4], [0, 4]]); head(3, 4); break;
    case 'etransfer': coin(0, 1, COL.purple); coin(4, 4, COL.purple); arrow(11, 11, 1, 1, COL.tealLite); seg([[0, 5], [1, 5]]); break;
    case 'partial': head(0, 2); seg([[1, 2]]); seg([[3, 2]]); seg([[5, 2]]); coin(5, 5); break;
    case 'noborders': g.strokeStyle = COL.tealLite; g.lineWidth = 1; g.setLineDash([2, 2]); g.strokeRect(1.5, 1.5, 21, 21); g.setLineDash([]); seg([[1, 2], [0, 2]]); head(2, 2); arrow(22, 12, 1, 0, COL.gold); break;
    case 'transfer': seg([[1, 3], [2, 3], [3, 3]]); head(0, 3); arrow(12, 6, 1, 0, COL.gold); arrow(12, 18, -1, 0, COL.gold); break;
    case 'payday': coin(3, 2); q(1, 11, 4, 1, COL.dim); q(0, 14, 6, 1, COL.dim); q(2, 17, 4, 1, COL.dim); seg([[0, 5], [1, 5], [2, 5]]); break;
    case 'cosigner': seg([[2, 1], [1, 1], [0, 1]]); head(3, 1); seg([[3, 4], [4, 4], [5, 4]], COL.gold); head(2, 4, COL.teal); break;
    case 'pin': coin(1, 2); g.fillStyle = 'rgba(0,0,0,0.0)'; pix(g, 'lock', 3, 6, 0.9, '#c9d3e8'); pix(g, 'key', 13, 11, 1, COL.gold); break;
    case 'paperwork': drawItem(g, { kind: 'crate', x: 0, y: 0 }, { cell: 10, bx: 1, by: 6, w: 1, h: 1 }, 0); drawItem(g, { kind: 'mailbox', x: 0, y: 0 }, { cell: 10, bx: 13, by: 6, w: 1, h: 1 }, 0); arrow(12, 11, 1, 0, COL.tealLite); break;
    case 'predatory': drawItem(g, { kind: 'skull', x: 0, y: 0 }, { cell: 18, bx: 3, by: 3, w: 1, h: 1 }, 0); break;
    case 'expiring': g.globalAlpha = 0.5; coin(1, 1); g.globalAlpha = 1; dot(g, 14, 13, 6, COL.paper); g.strokeStyle = '#0b0f17'; g.lineWidth = 1; g.beginPath(); g.moveTo(14, 13); g.lineTo(14, 9); g.moveTo(14, 13); g.lineTo(17, 14); g.stroke(); break;
    case 'hiddenfees': g.strokeStyle = COL.red; g.setLineDash([2, 2]); g.lineWidth = 1; g.strokeRect(3.5, 3.5, 17, 17); g.setLineDash([]); pix(g, 'flag', 8, 7, 1, COL.red); break;
    case 'record': dot(g, 6, 18, 3.2, COL.stone); dot(g, 12, 12, 3.2, COL.stone); dot(g, 18, 6, 3.2, COL.stone); seg([[4, 5], [5, 5]]); head(3, 5); break;
    case 'fineprint': q(0, 0, 24, 24, '#04060a'); dot(g, 12, 12, 8, '#1b2332'); seg([[2, 3], [3, 3]]); head(4, 3); coin(3, 3); q(0, 0, 24, 3, '#04060a'); break;
    case 'emergency': drawItem(g, { kind: 'fund', x: 0, y: 0 }, { cell: 18, bx: 3, by: 3, w: 1, h: 1 }, 0); break;
    case 'autopay': drawItem(g, { kind: 'arrow', x: 0, y: 0, dir: 3 }, { cell: 11, bx: 1, by: 1, w: 1, h: 1 }, 0); drawItem(g, { kind: 'arrow', x: 0, y: 0, dir: 1 }, { cell: 11, bx: 12, by: 1, w: 1, h: 1 }, 0); drawItem(g, { kind: 'arrow', x: 0, y: 0, dir: 0 }, { cell: 11, bx: 1, by: 12, w: 1, h: 1 }, 0); drawItem(g, { kind: 'arrow', x: 0, y: 0, dir: 2 }, { cell: 11, bx: 12, by: 12, w: 1, h: 1 }, 0); break;
    case 'bigpurchase': drawItem(g, { kind: 'coin', x: 0, y: 0, len: 3, dir: 3 }, { cell: 7, bx: 1.5, by: 8, w: 3, h: 1 }, 0); seg([[0, 5], [1, 5]]); break;
    case 'directdeposit': seg([[0, 1], [1, 1]]); head(2, 1); coin(5, 4); coin(4, 5); arrow(16, 12, -1, -1, COL.tealLite); break;
    case 'creditcheck': q(10, 0, 4, 24, COL.wall); q(10, 8, 4, 8, '#131a28'); g.strokeStyle = COL.tealLite; g.setLineDash([1.5, 1.5]); g.lineWidth = 0.8; g.strokeRect(10.5, 8.5, 3, 7); g.setLineDash([]); seg([[0, 3], [1, 3]]); head(2, 3); break;
    case 'tunnel': drawItem(g, { kind: 'tunnel', x: 0, y: 0, pair: 0 }, { cell: 10, bx: 1, by: 2, w: 1, h: 1 }, 0); drawItem(g, { kind: 'tunnel', x: 0, y: 0, pair: 0 }, { cell: 10, bx: 13, by: 12, w: 1, h: 1 }, 0); arrow(12, 11, 1, 1, COL.tealLite); break;
    case 'practice': seg([[0, 4], [1, 4], [2, 4]]); head(3, 4); g.strokeStyle = COL.green; g.lineWidth = 1.2; g.beginPath(); g.arc(17, 12, 4.5, 3.6, 6.1); g.stroke(); arrow(21.5, 12.5, 0, 1, COL.green); break;
    default: coin(2, 2);
  }
}
export { MODE_KEYS };
