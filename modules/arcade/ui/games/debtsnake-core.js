// Debt Snake: the whole game, as a pure integer state machine. The browser plays it and the server replays the recorded inputs through the very
// same file (docs/debtsnake.md), so this file must stay deterministic: no imports, no Math.random, no Date, no floats and no division operator
// (shifts, % and idiv() below only), and every random draw comes from the seeded streams below, in a fixed order. No canvas here.
//
// Fixed 30 ticks a second, ROUND = 5400 ticks. Input mask: 1 up, 2 down, 4 left, 8 right. Directions are 0 up, 1 down, 2 left, 3 right (bit n of the
// mask is direction n). A turn is queued on the rising edge of a bit (at most 2 queued, one taken per move); a turn that repeats or reverses the
// previous direction is ignored.
//
// STATE (plain object; tests may set any of these between steps):
//   seed, opts (parseOptions result), m ({modeKey: true}), w, h, stepTicks (ticks per move), ncoins (coin groups on the board at once; set 0 to stop spawns)
//   wrap (noborders), dark (fineprint), tick, prog (ticks since the last move, 0..stepTicks-1), over, prev (last mask), queue ([dir, ...], max 2)
//   spawned (coins made so far; round-robin among etransfer, bigpurchase, paperwork), moves (moves made), mleft (moves until interest, counts 60 down to 1), month (months completed)
//   debt (segments owed; the snake's length is debt + 2 plus pending changes), savings (segments saved, after debt), bonus (1 once the debt-free bonus paid)
//   score (never below 0), shield (0|1 held emergency fund), stall (0|1 crash grace used: the first blocked move only waits one move, no turn lost
//   from the snake's direction; a second blocked move in a row crashes as usual. Cleared by any real move or crash handling)
//   snakes: [{ cells: [[x,y], ... head first], prev: same one move ago, dir, pend }]   pend > 0 = segments still to grow (one per move), < 0 = still to drop
//   items: [{ kind, x, y, ... }] kinds coin|crate|key|mailbox|skull|fund|arrow|tunnel. Coin and crate carry { locked, pair (0 = none), len (1 or 3), dir (0
//          across, 1 down; only for len 3), fade (moves left, 0 = never expires), age (months) }; arrow { dir }; tunnel { pair }
//   walls [[x,y]], stones [[x,y]] (oldest first), fees [{ x, y, zx, zy }] hidden fee squares and the top-left of their 3x3 zone, marker [x,y] | null
//   (the next late-fee wall square), gate null | { x, y0, y1, open }, events (what happened this tick), stats { payments, max_debt, fees, traps }
//   r: three seeded streams { c: coins, w: walks, m: everything else }.
// The move runs on the tick when prog reaches stepTicks: turn, crash check, then move/grow/drop, item effects, timers, interest, gate, new coins.

export const C = Object.freeze({
  TPS: 30, ROUND: 5400, MAX_INPUTS: 4000, MASK_MAX: 15,
  START_LEN: 12, MONTH: 60, WARN: 8, PAY: 10, BONUS: 200,
  TRAP_SEGS: 3, TRAP_COST: 20, FEE_SEGS: 2, FEE_COST: 10, LATE_SEGS: 1, FADE: 40, MAX_FEES: 4, MAX_STONES: 25, ARROWS: 6, BIG: 3,
  CROSS_NEAR: 4, FAR: 99, ZONE: 3,
});
export const MODE_KEYS = Object.freeze(['classic', 'latefees', 'etransfer', 'partial', 'noborders', 'transfer', 'payday', 'cosigner', 'pin', 'paperwork',
  'predatory', 'expiring', 'hiddenfees', 'record', 'fineprint', 'emergency', 'autopay', 'bigpurchase', 'directdeposit', 'creditcheck', 'tunnel', 'practice']);
export const SPEEDS = Object.freeze({ slow: 7, normal: 5, fast: 3 });
export const BOARDS = Object.freeze({ small: Object.freeze([10, 9]), normal: Object.freeze([15, 13]), large: Object.freeze([21, 17]) });
export const COIN_COUNTS = Object.freeze([1, 3, 5]);
const DX = [0, 0, -1, 1], DY = [-1, 1, 0, 0], RIGHT = [3, 2, 0, 1], LEFT = [2, 3, 1, 0];
const ONE = [[0, 0]];

// FNV-1a over the char codes, then mulberry32 kept as a raw uint32 stream (no division to a float).
export function hash32(text) {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) { h ^= text.charCodeAt(i) & 255; h = Math.imul(h, 0x01000193) >>> 0; }
  return h >>> 0;
}
function next(r) {
  r.x = (r.x + 0x6d2b79f5) >>> 0;
  let t = r.x;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return (t ^ (t >>> 14)) >>> 0;
}
const draw = (r, n) => next(r) % n;
// floor(a / b) for 0 <= a < 2^31 and b > 0, by shift and subtract (the core has no division operator).
export function idiv(a, b) {
  let q = 0, r = 0;
  for (let i = 30; i >= 0; i--) { r = (r << 1) | ((a >> i) & 1); if (r >= b) { r -= b; q |= 1 << i; } }
  return q;
}

export function parseOptions(obj) {
  if (obj === undefined || obj === null) obj = {};
  if (typeof obj !== 'object' || Array.isArray(obj)) throw new Error('options must be an object');
  const out = { modes: ['classic'], speed: 'normal', board: 'small', coins: 1 };
  if (obj.modes !== undefined) {
    const m = obj.modes;
    if (!Array.isArray(m) || m.length < 1) throw new Error('modes must be a non-empty list');
    for (const k of m) if (typeof k !== 'string' || !MODE_KEYS.includes(k)) throw new Error('unknown mode');
    if (new Set(m).size !== m.length) throw new Error('duplicate mode');
    if (m.length > 1 && m.includes('classic')) throw new Error('classic cannot be mixed');
    out.modes = m.slice().sort();
  }
  if (obj.speed !== undefined) {
    if (typeof obj.speed !== 'string' || !Object.prototype.hasOwnProperty.call(SPEEDS, obj.speed)) throw new Error('bad speed');
    out.speed = obj.speed;
  }
  if (obj.board !== undefined) {
    if (typeof obj.board !== 'string' || !Object.prototype.hasOwnProperty.call(BOARDS, obj.board)) throw new Error('bad board');
    out.board = obj.board;
  }
  if (obj.coins !== undefined) {
    if (!COIN_COUNTS.includes(obj.coins)) throw new Error('bad coins');
    out.coins = obj.coins;
  }
  return out;
}
export function optionKey(opts) {
  const m = opts && Array.isArray(opts.modes) && opts.modes.length ? opts.modes : ['classic'];
  return m.slice().sort().join('+');
}

// ---------- geometry helpers ----------
export function cellsOf(it) {
  if (it.len > 1) {
    const r = [];
    for (let i = 0; i < it.len; i++) r.push(it.dir === 1 ? [it.x, it.y + i] : [it.x + i, it.y]);
    return r;
  }
  return [[it.x, it.y]];
}
const isCoin = (it) => it.kind === 'coin' || it.kind === 'crate';
const abs = (n) => (n < 0 ? -n : n);
const sign = (n) => (n > 0 ? 1 : n < 0 ? -1 : 0);
const ev = (s, kind, x, y, n = 0) => { s.events.push({ kind, x, y, n }); };
const addScore = (s, n) => { s.score = Math.max(0, s.score + n); };

// Everything a new thing may not be placed on: walls, stones, the gate squares, snakes, items (all their squares), hidden fees and the wall marker.
function occ(s, skip) {
  const w = s.w, g = new Uint8Array(w * s.h);
  const put = (x, y) => { if (x >= 0 && y >= 0 && x < w && y < s.h) g[y * w + x] = 1; };
  for (const c of s.walls) put(c[0], c[1]);
  for (const c of s.stones) put(c[0], c[1]);
  if (s.gate) for (let y = s.gate.y0; y <= s.gate.y1; y++) put(s.gate.x, y);
  for (const sn of s.snakes) for (const c of sn.cells) put(c[0], c[1]);
  for (const it of s.items) if (it !== skip) for (const c of cellsOf(it)) put(c[0], c[1]);
  for (const f of s.fees) put(f.x, f.y);
  if (s.marker) put(s.marker[0], s.marker[1]);
  return g;
}
function fits(g, w, h, x, y, shape) {
  for (const o of shape) {
    const cx = x + o[0], cy = y + o[1];
    if (cx < 0 || cy < 0 || cx >= w || cy >= h || g[cy * w + cx]) return false;
  }
  return true;
}
// Two draws (x then y), then the first free fit scanning along the rows from there. Null when the board has no room.
function place(s, r, shape) {
  const g = occ(s), w = s.w, h = s.h;
  let x = draw(r, w), y = draw(r, h);
  for (let i = 0; i < w * h; i++) {
    if (fits(g, w, h, x, y, shape)) return [x, y];
    x++;
    if (x === w) { x = 0; y++; if (y === h) y = 0; }
  }
  return null;
}
const snakeAt = (s, x, y) => s.snakes.some((sn) => sn.cells.some((c) => c[0] === x && c[1] === y));
function itemAt(s, x, y) {
  for (const it of s.items) {
    if (it.kind === 'mailbox') continue;
    for (const c of cellsOf(it)) if (c[0] === x && c[1] === y) return it;
  }
  return null;
}
const wrapXY = (s, x, y) => [(x + s.w) % s.w, (y + s.h) % s.h];

// ---------- creation ----------
function startSnake(w, h, row, mirror) {
  const hx = Math.min(11, w - 3), cells = [];
  for (let x = hx; x >= 0; x--) cells.push([x, row]);
  for (let y = row + 1; cells.length < C.START_LEN; y++) cells.push([0, y]);
  const out = mirror ? cells.map((c) => [w - 1 - c[0], h - 1 - c[1]]) : cells;
  return { cells: out, prev: out.slice(), dir: mirror ? 2 : 3, pend: 0 };
}
export function create(seed, optsIn) {
  const opts = parseOptions(optsIn);
  const [w, h] = BOARDS[opts.board], m = {};
  for (const k of opts.modes) m[k] = true;
  const sd = seed >>> 0, mid = h >> 1;
  const s = {
    seed: sd, opts, m, w, h, stepTicks: SPEEDS[opts.speed], ncoins: opts.coins, wrap: !!m.noborders, dark: !!m.fineprint,
    tick: 0, spawned: 0, prog: 0, over: false, prev: 0, queue: [], moves: 0, mleft: C.MONTH, month: 0,
    debt: C.START_LEN - 2, savings: 0, bonus: 0, score: 0, shield: 0, stall: 0,
    snakes: [], items: [], walls: [], stones: [], fees: [], marker: null, gate: null, nextPair: 1, events: [],
    stats: { payments: 0, max_debt: C.START_LEN - 2, fees: 0, traps: 0 },
    r: { c: { x: hash32(`debtsnake:coin:${sd}`) }, w: { x: hash32(`debtsnake:walk:${sd}`) }, m: { x: hash32(`debtsnake:misc:${sd}`) } },
  };
  if (m.cosigner) { s.snakes.push(startSnake(w, h, mid - 1, false)); s.snakes.push(startSnake(w, h, mid - 1, true)); }
  else s.snakes.push(startSnake(w, h, mid, false));
  if (m.creditcheck) {
    const x = w >> 1, y0 = mid - 1, y1 = mid + 1;
    for (let y = 0; y < h; y++) if (y < y0 || y > y1) s.walls.push([x, y]);
    s.gate = { x, y0, y1, open: true };
  }
  if (m.paperwork) { const p = place(s, s.r.m, ONE); if (p) s.items.push({ kind: 'mailbox', x: p[0], y: p[1] }); }
  if (m.autopay) for (let i = 0; i < C.ARROWS; i++) {
    const p = place(s, s.r.m, ONE), d = draw(s.r.m, 4);
    if (p) s.items.push({ kind: 'arrow', x: p[0], y: p[1], dir: d });
  }
  if (m.tunnel) for (let k = 0; k < 2; k++) {
    const pair = s.nextPair++;
    for (let j = 0; j < 2; j++) { const p = place(s, s.r.m, ONE); if (p) s.items.push({ kind: 'tunnel', x: p[0], y: p[1], pair }); }
  }
  if (m.latefees) s.marker = place(s, s.r.m, ONE);
  if (m.hiddenfees) addFee(s);
  refill(s);
  return s;
}

// ---------- items that come and go ----------
function groupCount(s) {
  let singles = 0, paired = 0;
  for (const it of s.items) if (isCoin(it)) { if (it.pair) paired++; else singles++; }
  return singles + (paired >> 1);
}
const coinItem = (s, kind, p, extra) => ({ kind, x: p[0], y: p[1], locked: !!s.m.pin, pair: 0, len: 1, dir: 0, fade: s.m.expiring ? C.FADE : 0, age: 0, ...extra });
function spawnCoin(s) {
  // with two or more of etransfer, bigpurchase and paperwork on, each new coin takes the next of them in that order (s.spawned counts spawns)
  const act = ['etransfer', 'bigpurchase', 'paperwork'].filter((k) => s.m[k]);
  const pick = act.length ? act[s.spawned++ % act.length] : '';
  const kind = pick === 'paperwork' ? 'crate' : 'coin', r = s.r.c;
  if (pick === 'etransfer') {
    const a = place(s, r, ONE);
    if (!a) return false;
    const pair = s.nextPair++;
    s.items.push(coinItem(s, kind, a, { pair }));
    const b = place(s, r, ONE);
    if (!b) { s.items.pop(); return false; }
    s.items.push(coinItem(s, kind, b, { pair }));
    return true;
  }
  if (pick === 'bigpurchase') {
    const dir = draw(r, 2), shape = [];
    for (let i = 0; i < C.BIG; i++) shape.push(dir === 1 ? [0, i] : [i, 0]);
    const p = place(s, r, shape);
    if (!p) return false;
    s.items.push(coinItem(s, kind, p, { len: C.BIG, dir }));
    return true;
  }
  const p = place(s, r, ONE);
  if (!p) return false;
  s.items.push(coinItem(s, kind, p, {}));
  return true;
}
function spawnSimple(s, kind) {
  const p = place(s, s.r.m, ONE);
  if (p) s.items.push({ kind, x: p[0], y: p[1] });
}
function refill(s) {
  let guard = 0;
  while (groupCount(s) < s.ncoins && guard++ < 8) if (!spawnCoin(s)) break;
  if (s.m.predatory && !s.items.some((it) => it.kind === 'skull')) spawnSimple(s, 'skull');
  if (s.m.pin && s.items.some((it) => isCoin(it) && it.locked) && !s.items.some((it) => it.kind === 'key')) spawnSimple(s, 'key');
}
function addFee(s) {
  const p = place(s, s.r.m, ONE), ox = draw(s.r.m, 3), oy = draw(s.r.m, 3);
  if (!p) return;
  s.fees.push({ x: p[0], y: p[1], zx: Math.max(0, Math.min(s.w - 3, p[0] - ox)), zy: Math.max(0, Math.min(s.h - 3, p[1] - oy)) });
}
function removeItem(s, it) { const i = s.items.indexOf(it); if (i >= 0) s.items.splice(i, 1); }

// ---------- money ----------
function addDebt(s, n) {
  s.debt += n;
  if (s.debt > s.stats.max_debt) s.stats.max_debt = s.debt;
  for (const sn of s.snakes) sn.pend += n;
}
function flipSnake(s, sn) {
  sn.cells = sn.cells.slice().reverse();
  sn.prev = sn.prev.slice().reverse();
  let dx = sn.cells[0][0] - sn.cells[1][0], dy = sn.cells[0][1] - sn.cells[1][1];
  if (dx > 1) dx = -1; else if (dx < -1) dx = 1;
  if (dy > 1) dy = -1; else if (dy < -1) dy = 1;
  sn.dir = dx > 0 ? 3 : dx < 0 ? 2 : dy > 0 ? 1 : 0;
}
function pay(s, units, x, y) {
  let paid = 0, saved = 0, free = false;
  for (let u = 0; u < units; u++) {
    if (s.debt > 0) {
      s.debt--; paid++; s.stats.payments++; addScore(s, C.PAY);
      for (const sn of s.snakes) sn.pend--;
      if (s.debt === 0 && !s.bonus) { s.bonus = 1; addScore(s, C.BONUS); free = true; }
    } else {
      s.savings++; saved++; addScore(s, C.PAY);
      for (const sn of s.snakes) sn.pend++;
    }
  }
  if (paid) ev(s, 'pay', x, y, paid);
  if (saved) ev(s, 'save', x, y, saved);
  if (free) ev(s, 'debtfree', x, y, C.BONUS);
  if (paid && s.m.transfer) {
    for (const sn of s.snakes) flipSnake(s, sn);
    s.queue.length = 0;
    ev(s, 'flip', s.snakes[0].cells[0][0], s.snakes[0].cells[0][1]);
  }
}

// ---------- one move ----------
function ctxOf(s) {
  const w = s.w, solid = new Uint8Array(w * s.h), pops = [];
  const put = (x, y) => { if (x >= 0 && y >= 0 && x < w && y < s.h) solid[y * w + x] = 1; };
  for (const c of s.walls) put(c[0], c[1]);
  for (const c of s.stones) put(c[0], c[1]);
  if (s.gate && !s.gate.open) for (let y = s.gate.y0; y <= s.gate.y1; y++) put(s.gate.x, y);
  for (const sn of s.snakes) {
    const len = sn.cells.length, p = Math.min(sn.pend > 0 ? 0 : sn.pend < 0 ? 2 : 1, len - 1);
    pops.push(p);
    // the squares the tail leaves on this move do not count; with partial payments segment i (head = 0) is solid when i % 4 is 0 or 1, a gap when 2 or 3
    for (let i = 0; i < len - p; i++) if (!s.m.partial || (i & 3) < 2) put(sn.cells[i][0], sn.cells[i][1]);
  }
  for (const it of s.items) if (isCoin(it) && it.locked) for (const c of cellsOf(it)) put(c[0], c[1]);
  const mb = s.items.find((it) => it.kind === 'mailbox');
  return { solid, pops, og: s.m.paperwork ? occ(s) : null, mb };
}
function anyCrash(s, c, d0) {
  const seen = [];
  for (let i = 0; i < s.snakes.length; i++) {
    const d = i === 0 ? d0 : d0 ^ 1, hd = s.snakes[i].cells[0];
    let x = hd[0] + DX[d], y = hd[1] + DY[d];
    if (s.wrap) { const q = wrapXY(s, x, y); x = q[0]; y = q[1]; } else if (x < 0 || y < 0 || x >= s.w || y >= s.h) return true;
    const idx = y * s.w + x;
    if (c.solid[idx] || seen.includes(idx)) return true;
    seen.push(idx);
    if (c.og) {
      const cr = s.items.find((it) => it.kind === 'crate' && it.x === x && it.y === y);
      if (cr) {
        let bx = x + DX[d], by = y + DY[d];
        if (s.wrap) { const q = wrapXY(s, bx, by); bx = q[0]; by = q[1]; } else if (bx < 0 || by < 0 || bx >= s.w || by >= s.h) return true;
        if (c.og[by * s.w + bx] && !(c.mb && c.mb.x === bx && c.mb.y === by)) return true;
      }
    }
  }
  return false;
}
function onCrash(s, c, d0) {
  const hd = s.snakes[0].cells[0];
  s.stall = 0;
  if (s.shield) {
    s.shield = 0;
    for (const sn of s.snakes) flipSnake(s, sn);
    s.queue.length = 0;
    ev(s, 'shield', hd[0], hd[1]);
    return;
  }
  if (s.m.practice) {
    let nd = RIGHT[d0];
    if (anyCrash(s, c, nd) && !anyCrash(s, c, LEFT[d0])) nd = LEFT[d0];
    s.snakes.forEach((sn, i) => { sn.dir = i === 0 ? nd : nd ^ 1; sn.prev = sn.cells.slice(); });
    s.queue.length = 0;
    return;
  }
  s.over = true;
  ev(s, 'crash', hd[0], hd[1]);
}
function interact(s, i, x, y, d) {
  const sn = s.snakes[i], it = itemAt(s, x, y);
  if (it) {
    if (it.kind === 'coin') {
      if (it.pair) {
        const other = s.items.find((o) => o !== it && o.pair === it.pair);
        removeItem(s, it);
        if (other) { removeItem(s, other); sn.cells[0] = [other.x, other.y]; ev(s, 'teleport', other.x, other.y); }
        pay(s, 1, x, y);
      } else { removeItem(s, it); pay(s, it.len > 1 ? C.BIG : 1, x, y); }
    } else if (it.kind === 'crate') {
      let bx = x + DX[d], by = y + DY[d];
      if (s.wrap) { const q = wrapXY(s, bx, by); bx = q[0]; by = q[1]; }
      const mb = s.items.find((o) => o.kind === 'mailbox');
      if (mb && mb.x === bx && mb.y === by) { removeItem(s, it); pay(s, 1, bx, by); } else { it.x = bx; it.y = by; }
    } else if (it.kind === 'key') {
      removeItem(s, it);
      let best = null, bd = 0;
      for (const o of s.items) if (isCoin(o) && o.locked) { const dd = abs(o.x - x) + abs(o.y - y); if (!best || dd < bd) { best = o; bd = dd; } }
      if (best) best.locked = false;
      ev(s, 'key', x, y);
    } else if (it.kind === 'skull') {
      removeItem(s, it);
      addDebt(s, C.TRAP_SEGS); addScore(s, -C.TRAP_COST); s.stats.traps++;
      ev(s, 'trap', x, y, C.TRAP_SEGS);
    } else if (it.kind === 'fund') {
      removeItem(s, it); s.shield = 1; ev(s, 'shield', x, y, 1);
    } else if (it.kind === 'arrow') {
      if (i === 0 && it.dir !== (d ^ 1)) { sn.dir = it.dir; s.queue.length = 0; }
    } else if (it.kind === 'tunnel') {
      const other = s.items.find((o) => o !== it && o.kind === 'tunnel' && o.pair === it.pair);
      if (other) { sn.cells[0] = [other.x, other.y]; ev(s, 'teleport', other.x, other.y); }
    }
  }
  const hx = sn.cells[0][0], hy = sn.cells[0][1], f = s.fees.findIndex((q) => q.x === hx && q.y === hy);
  if (f >= 0) {
    s.fees.splice(f, 1);
    addDebt(s, C.FEE_SEGS); addScore(s, -C.FEE_COST); s.stats.fees++;
    ev(s, 'fee', hx, hy, C.FEE_SEGS);
  }
}
// Moves a coin one square if every square of its new place is free (it does not block itself). Stays inside the board even with wrap.
function slide(s, it, dx, dy) {
  const g = occ(s, it), nx = it.x + dx, ny = it.y + dy;
  if (!fits(g, s.w, s.h, nx, ny, cellsOf(it).map((c) => [c[0] - it.x, c[1] - it.y]))) return false;
  it.x = nx; it.y = ny;
  return true;
}
function expireCoins(s) {
  for (const it of s.items.slice()) {
    if (!isCoin(it) || it.fade <= 0 || !s.items.includes(it)) continue;
    if (--it.fade > 0) continue;
    const other = it.pair ? s.items.find((o) => o !== it && o.pair === it.pair) : null;
    removeItem(s, it);
    if (other) removeItem(s, other);
    addDebt(s, C.LATE_SEGS);
    ev(s, 'expire', it.x, it.y, C.LATE_SEGS);
  }
}
function monthEnd(s) {
  s.mleft = C.MONTH; s.month++;
  const tail = s.snakes[0].cells[s.snakes[0].cells.length - 1];
  if (s.debt > 0) {
    const n = 1 + idiv(s.debt - 1, 10);
    addDebt(s, n);
    ev(s, 'interest', tail[0], tail[1], n);
  } else {
    const k = idiv(s.savings, 10);
    if (k > 0) {
      s.savings += k; addScore(s, C.PAY * k);
      for (const sn of s.snakes) sn.pend += k;
      ev(s, 'interest', tail[0], tail[1], k);
    }
  }
  if (s.m.latefees) {
    const mk = s.marker;
    s.marker = null;
    if (mk && !occ(s)[mk[1] * s.w + mk[0]]) s.walls.push([mk[0], mk[1]]);
    s.marker = place(s, s.r.m, ONE);
  }
  if (s.m.hiddenfees && s.fees.length < C.MAX_FEES) addFee(s);
  if (s.m.predatory) {
    const sk = s.items.find((it) => it.kind === 'skull');
    if (sk) removeItem(s, sk);
    spawnSimple(s, 'skull');
  }
  if (s.m.paperwork) {
    for (const it of s.items.slice()) {
      if (it.kind !== 'crate' || ++it.age < 2) continue;
      removeItem(s, it);
      const p = place(s, s.r.m, ONE);
      if (p) { it.x = p[0]; it.y = p[1]; it.age = 0; }
      s.items.push(it);
    }
  }
  if (s.m.emergency && (s.month & 1) === 0 && !s.shield && !s.items.some((it) => it.kind === 'fund')) spawnSimple(s, 'fund');
}
function updateGate(s) {
  const g = s.gate;
  if (!g) return;
  const wantOpen = (s.month & 1) === 0;
  let inside = false;
  for (const sn of s.snakes) for (const c of sn.cells) if (c[0] === g.x && c[1] >= g.y0 && c[1] <= g.y1) inside = true;
  g.open = wantOpen || inside;
}
function doMove(s) {
  let d0 = s.snakes[0].dir;
  while (s.queue.length) { const d = s.queue.shift(); if (d !== d0 && d !== (d0 ^ 1)) { d0 = d; break; } }
  const c = ctxOf(s);
  if (anyCrash(s, c, d0)) {
    if (!s.stall) {                                     // crash grace: wait one move period, the player may turn meanwhile
      s.stall = 1;
      for (const sn of s.snakes) sn.prev = sn.cells.slice();
      ev(s, 'bump', s.snakes[0].cells[0][0], s.snakes[0].cells[0][1]);
      return;
    }
    onCrash(s, c, d0);
    return;
  }
  s.stall = 0;
  const heads = [], drops = [];
  for (let i = 0; i < s.snakes.length; i++) {
    const sn = s.snakes[i], d = i === 0 ? d0 : d0 ^ 1, hd = sn.cells[0];
    let x = hd[0] + DX[d], y = hd[1] + DY[d];
    if (s.wrap) { const q = wrapXY(s, x, y); x = q[0]; y = q[1]; }
    const tailEnd = sn.cells[sn.cells.length - 1], dropped = sn.pend < 0;
    sn.prev = sn.cells;
    sn.cells = sn.cells.slice();
    sn.cells.unshift([x, y]);
    for (let k = 0; k < c.pops[i]; k++) sn.cells.pop();
    if (sn.pend > 0) sn.pend--; else if (sn.pend < 0) sn.pend++;
    sn.dir = d;
    if (dropped) drops.push(tailEnd);
    heads.push([x, y, d]);
  }
  for (const t of drops) {
    if (!s.m.record || snakeAt(s, t[0], t[1])) continue;
    s.stones.push([t[0], t[1]]);
    if (s.stones.length > C.MAX_STONES) s.stones.shift();
  }
  for (let i = 0; i < heads.length; i++) interact(s, i, heads[i][0], heads[i][1], heads[i][2]);
  s.moves++; s.mleft--;
  if (s.m.expiring) expireCoins(s);
  if ((s.moves & 1) === 0) {
    if (s.m.payday) for (const it of s.items.slice()) {
      if (!isCoin(it)) continue;
      const d = draw(s.r.w, 4);
      for (let k = 0; k < 4; k++) { const dd = (d + k) & 3; if (slide(s, it, DX[dd], DY[dd])) break; }
    }
    if (s.m.directdeposit) for (const it of s.items.slice()) {
      if (!isCoin(it)) continue;
      let best = null, bd = 0;
      for (const sn of s.snakes) { const hd = sn.cells[0], dd = abs(hd[0] - it.x) + abs(hd[1] - it.y); if (!best || dd < bd) { best = hd; bd = dd; } }
      if (!best || bd > C.CROSS_NEAR || bd === 0) continue;
      const dx = sign(best[0] - it.x), dy = sign(best[1] - it.y), ax = abs(best[0] - it.x), ay = abs(best[1] - it.y);
      if (ax >= ay) { if (!(dx && slide(s, it, dx, 0)) && dy) slide(s, it, 0, dy); } else if (!(dy && slide(s, it, 0, dy)) && dx) slide(s, it, dx, 0);
    }
  }
  if (s.mleft === 0) monthEnd(s);
  updateGate(s);
  refill(s);
}

// One tick. mask: what is held right now (0..15).
export function step(s, mask) {
  if (s.over) return;
  mask &= C.MASK_MAX;
  const press = mask & ~s.prev;
  s.prev = mask;
  s.events = [];
  for (let d = 0; d < 4; d++) {
    if (!(press & (1 << d))) continue;
    const ref = s.queue.length ? s.queue[s.queue.length - 1] : s.snakes[0].dir;
    if (d !== ref && d !== (ref ^ 1) && s.queue.length < 2) s.queue.push(d);
  }
  if (++s.prog >= s.stepTicks) { s.prog = 0; doMove(s); }
  s.tick++;
  if (s.tick >= C.ROUND) s.over = true;
}

// The shared replay: inputs is a change list [[tick, mask], ...] sorted by tick; a mask holds from its tick until the next entry.
export function replay(seed, inputs, opts) {
  const s = create(seed, opts);
  let i = 0, mask = 0;
  while (!s.over) {
    while (i < inputs.length && inputs[i][0] <= s.tick) mask = inputs[i++][1];
    step(s, mask);
  }
  return s;
}
export const score = (s) => Math.max(0, s.score);
export const isOver = (s) => s.over;
export function report(s) {
  return { payments: s.stats.payments, debt_free: s.bonus ? 1 : 0, debt: s.debt, savings: s.savings, months: s.month, max_debt: s.stats.max_debt, fees: s.stats.fees, traps: s.stats.traps };
}
function nearest(s) {
  const hd = s.snakes[0].cells[0];
  let best = C.FAR;
  for (const it of s.items) if (isCoin(it) && !it.locked) for (const c of cellsOf(it)) { const d = abs(c[0] - hd[0]) + abs(c[1] - hd[1]); if (d < best) best = d; }
  return best;
}
export function view(s) {
  const items = [];
  for (const it of s.items) {
    if (isCoin(it)) items.push({ kind: it.kind, x: it.x, y: it.y, locked: !!it.locked, pair: it.pair, len: it.len, dir: it.dir, fade: it.fade });
    else if (it.kind === 'arrow') items.push({ kind: 'arrow', x: it.x, y: it.y, dir: it.dir });
    else if (it.kind === 'tunnel') items.push({ kind: 'tunnel', x: it.x, y: it.y, pair: it.pair });
    else items.push({ kind: it.kind, x: it.x, y: it.y });
  }
  for (const f of s.fees) items.push({ kind: 'zone', x: f.zx, y: f.zy, w: C.ZONE, h: C.ZONE });
  if (s.marker) items.push({ kind: 'marker', x: s.marker[0], y: s.marker[1], for: 'wall' });
  return {
    w: s.w, h: s.h, tick: s.tick, over: s.over, debt: s.debt, savings: s.savings, score: score(s), month: s.month, month_moves_left: s.mleft,
    progress: s.prog,
    snakes: s.snakes.map((sn) => ({ cells: sn.cells.map((c) => [c[0], c[1]]), prev: sn.prev.map((c) => [c[0], c[1]]), dir: sn.dir, gaps: !!s.m.partial, solid: sn.cells.map((c, i) => !s.m.partial || (i & 3) < 2) })),
    items,
    walls: s.walls.map((c) => [c[0], c[1]]), stones: s.stones.map((c) => [c[0], c[1]]),
    gate: s.gate ? { x: s.gate.x, y0: s.gate.y0, y1: s.gate.y1, open: s.gate.open, warn: (s.month & 1) === 0 && s.mleft <= C.WARN } : null,
    dark: s.dark, wrap: s.wrap, shield: s.shield ? 1 : 0, near: nearest(s),
    events: s.events.map((e) => ({ ...e })),
  };
}
