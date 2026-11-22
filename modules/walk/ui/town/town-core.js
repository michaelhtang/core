// Town Walk: the whole walking game as a pure integer state machine (docs/walk.md). The browser runs it to walk around and records its inputs;
// the server replays those inputs through THIS file with a seed it chose, and counts the items collected itself. So this file must stay
// deterministic: no imports, no Math.random, no Date, no floats and no division (shifts and % only), and every random draw comes from the
// seeded generator below. Drawing, keys and the 30 ticks/s loop live in town.js, not here: the server must not need a canvas.
//
// Time: fixed 30 ticks a second, a visit is at most MAX_TICKS = 5400 (3 minutes). Input mask bits: 1 up, 2 down, 4 left, 8 right.
// Space: integer pixels, 8 px tiles, a 64 x 48 tile map (512 x 384 px). The player is a 4 x 4 px box at the feet; (x, y) is its top-left.

export const C = Object.freeze({
  TPS: 30, MAX_TICKS: 5400, TILE: 8, SHIFT: 3,       // SHIFT: px >> 3 = tile
  HB: 4,                                             // the feet box, px
  NUDGE: 3,                                          // a blocked move slides the other axis by 1 px if a gap is within 3 px (door and corner assist)
  PICK_R: 6,                                         // an item is collected when the box centre is within 6 px of the item centre
  ITEMS: 6, MIN_GAP: 6,                              // items per visit; tiles apart (largest of |dx|, |dy|), also from the spawn
  MAX_INPUTS: 2000,
});

// The town. One character per tile; read it as a picture.
//   .  grass    ,  path    :  plaza stone (all walkable)         T tree   H hedge   ~ water   F fountain   # building (solid)
//   a-o  the door tile of a building: walkable, in the bottom row of its 5 x 4 footprint, facing south onto a street (letter = DOOR_KEYS order)
export const MAP = Object.freeze([
  'TTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTT',
  'TTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTT',
  'TT..........................T......T..........................TT',
  'TT..#####..#####..#####..................#####..#####..#####..TT',
  'TT..#####..#####..#####..................#####..#####..#####..TT',
  'TT..#####..#####..#####..................#####..#####..#####..TT',
  'TT..##d##..##e##..##f##..................##g##..##h##..##i##..TT',
  'TT,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,TT',
  'TT,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,TT',
  'TT,,..........................,,,...........................,,TT',
  'TT,,..........................,,,...........................,,TT',
  'TT,,........T......T..........,,,.........T.T...............,,TT',
  'TT,,...TT.TTT.T.T...T....#####,,,#####..........TT..........,,TT',
  'TT,,..T.............T....#####,,,#####...T.T.....T..........,,TT',
  'TT,,...........T.........#####,,,#####.....T...T..T.T...T...,,TT',
  'TT,,...T.................##a##,,,##c##..................T...,,TT',
  'TT,,....................:::::::::::::::...T...........TTT...,,TT',
  'TT,,.........#####...T..H:::::::::::::H......#####.......T..,,TT',
  'TT,,.........#####......H:::::::::::::H..TT..#####..........,,TT',
  'TT,,.........#####......:::::::::::::::......#####..........,,TT',
  'TT,,.........##b##......:::::::::::::::......##o##..........,,TT',
  'TT,,,,,,,,,,,,,,,,,,,,,,::::::FFF::::::,,,,,,,,,,,,,,,,,,,,,,,TT',
  'TT,,,,,,,,,,,,,,,,,,,,,,::::::F~F::::::,,,,,,,,,,,,,,,,,,,,,,,TT',
  'TT,,,,,,,,,,,,,,,,,,,,,,::::::FFF::::::,,,,,,,,,,,,,,,,,,,,,,,TT',
  'TT,,....................:::::::::::::::.....................,,TT',
  'TT,,....................:::::::::::::::.....................,,TT',
  'TT,,........T...........H:::::::::::::H.........T...........,,TT',
  'TT,,.....T....T.........H:::::::::::::H........T.....T......,,TT',
  'TT,,.........T.T........HHHHH:::::HHHHH..............TTT....,,TT',
  'TT,,........T.....T...........,,,.............TT.......TT...,,TT',
  'TT,,..........................,,,...........................,,TT',
  'TT,,......................TT..,,,...TTT................T....,,TT',
  'TT,,#####..#####..#####...T...,,,...TT...#####..#####.......,,TT',
  'TT,,#####..#####..#####.......,,,........#####..#####...T...,,TT',
  'TT,,#####..#####..#####.......,,,........#####..#####.......,,TT',
  'TT,,##j##..##k##..##l##.......,,,........##m##..##n##.......,,TT',
  'TT,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,TT',
  'TT,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,TT',
  'TT............................,,,.............................TT',
  'TT............................,,,.............................TT',
  'TT..........T.....T.T.T..T....,,,.~~~~~....................T..TT',
  'TT..T.........T...........TT..,,,.~~~~~....T......T..T..T.....TT',
  'TTT.................T.....TTT.,,,.~~~~~........T......T.T.....TT',
  'TT..............T.........T...,,,.~~~~~.............T.......T.TT',
  'TT....T........T...T.T....T...,,,.............T.T...........T.TT',
  'TT......T..T.......T.......T.......................T..........TT',
  'TTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTT',
  'TTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTT',
]);
export const DOOR_KEYS = Object.freeze(['job', 'bank', 'bank-of-daa', 'housing', 'insurance', 'credit', 'bills', 'outfitters', 'exchange', 'networth', 'venture-row', 'amphitheatre', 'life', 'retirement', 'arcade']);
export const KINDS = Object.freeze(['receipt', 'paystub', 'statement', 't4', 'coupon', 'bill', 'keycard', 'coin-purse']);   // the client maps each to a sprite and a fact
export const BUILD_W = 5, BUILD_H = 4;
export const W = MAP[0].length, H = MAP.length, PX_W = W << C.SHIFT, PX_H = H << C.SHIFT;
if (W !== 64 || MAP.some((r) => r.length !== W)) throw new Error('the map must be 64 tiles wide: tile indexes use ty * 64 + tx so no division is needed');
export const SPAWN = Object.freeze({ x: (31 << C.SHIFT) + 2, y: (26 << C.SHIFT) + 2 });   // on the plaza, south of the fountain

const ROWS = MAP;
export const tileAt = (tx, ty) => (tx < 0 || ty < 0 || tx >= W || ty >= H ? 'T' : ROWS[ty][tx]);
export const isSolid = (tx, ty) => { const c = tileAt(tx, ty); return c === 'T' || c === 'H' || c === '~' || c === 'F' || c === '#'; };
export const isDoorTile = (tx, ty) => { const c = tileAt(tx, ty); return c >= 'a' && c <= 'o'; };

export const DOORS = [];                             // [{ key, x, y }] door tile coordinates, in DOOR_KEYS order
export const BUILDINGS = [];                         // [{ key, x, y, w, h }] footprints in tiles (top-left corner)
for (let ty = 0; ty < H; ty++) for (let tx = 0; tx < W; tx++) {
  if (isDoorTile(tx, ty)) DOORS.push({ key: DOOR_KEYS[tileAt(tx, ty).charCodeAt(0) - 97], x: tx, y: ty });
}
DOORS.sort((a, b) => DOOR_KEYS.indexOf(a.key) - DOOR_KEYS.indexOf(b.key));
for (const d of DOORS) BUILDINGS.push({ key: d.key, x: d.x - 2, y: d.y - (BUILD_H - 1), w: BUILD_W, h: BUILD_H });
Object.freeze(DOORS); Object.freeze(BUILDINGS);

// FNV-1a over the char codes, then mulberry32 kept as a raw uint32 stream (no division to a float). Same as the arcade core.
export function hash32(text) {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) { h ^= text.charCodeAt(i) & 255; h = Math.imul(h, 0x01000193) >>> 0; }
  return h >>> 0;
}
function next(s) {
  s.rng = (s.rng + 0x6d2b79f5) >>> 0;
  let t = s.rng;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return (t ^ (t >>> 14)) >>> 0;
}
const draw = (s, n) => next(s) % n;

// Breadth-first distance in tiles from (gx, gy) over walkable tiles, 4-way; -1 where unreachable. A 4 px box fits any walkable tile and any two
// neighbouring ones, so this is exact for the walker, not just conservative.
export function distField(gx, gy) {
  const d = new Int16Array(W * H).fill(-1);
  if (gx < 0 || gy < 0 || gx >= W || gy >= H || isSolid(gx, gy)) return d;
  const q = new Int32Array(W * H);
  let head = 0, tail = 0;
  d[gy * W + gx] = 0; q[tail++] = gy * W + gx;
  while (head < tail) {
    const i = q[head++], x = i & 63, y = i >> 6, n = d[i] + 1;
    for (let k = 0; k < 4; k++) {
      const nx = x + (k === 2 ? -1 : k === 3 ? 1 : 0), ny = y + (k === 0 ? -1 : k === 1 ? 1 : 0);
      if (nx < 0 || ny < 0 || nx >= W || ny >= H || isSolid(nx, ny) || d[ny * W + nx] >= 0) continue;
      d[ny * W + nx] = n; q[tail++] = ny * W + nx;
    }
  }
  return d;
}
const SPAWN_TX = SPAWN.x >> C.SHIFT, SPAWN_TY = SPAWN.y >> C.SHIFT;
const FROM_SPAWN = distField(SPAWN_TX, SPAWN_TY);
export const reachableFromSpawn = (tx, ty) => tx >= 0 && ty >= 0 && tx < W && ty < H && FROM_SPAWN[ty * W + tx] >= 0;

// Where an item may lie: a plain walkable tile (no door) the walker can reach, at least MIN_GAP tiles from the spawn.
const CANDS = [];
for (let ty = 0; ty < H; ty++) for (let tx = 0; tx < W; tx++) {
  if (isSolid(tx, ty) || isDoorTile(tx, ty) || FROM_SPAWN[ty * W + tx] < 0) continue;
  if (Math.max(Math.abs(tx - SPAWN_TX), Math.abs(ty - SPAWN_TY)) < C.MIN_GAP) continue;
  CANDS.push(ty * W + tx);
}

// The six pickups for a seed: [{ id, kind, x, y }] with (x, y) the tile centre in px. Pure function of the seed.
export function placeItems(seed) {
  const r = { rng: hash32(`walkitems:${seed >>> 0}`) };
  const kinds = KINDS.slice();
  for (let i = kinds.length - 1; i > 0; i--) { const j = draw(r, i + 1), t = kinds[i]; kinds[i] = kinds[j]; kinds[j] = t; }
  const tiles = [];
  const apart = (i) => tiles.every((t) => Math.max(Math.abs((t & 63) - (i & 63)), Math.abs((t >> 6) - (i >> 6))) >= C.MIN_GAP);
  for (let tries = 0; tries < 800 && tiles.length < C.ITEMS; tries++) { const i = CANDS[draw(r, CANDS.length)]; if (apart(i)) tiles.push(i); }
  for (let k = 0; k < CANDS.length && tiles.length < C.ITEMS; k++) if (apart(CANDS[k])) tiles.push(CANDS[k]);   // never reached on this map; keeps the count honest
  return tiles.map((i, n) => { const tx = i & 63, ty = i >> 6; return { id: n + 1, kind: kinds[n], x: (tx << C.SHIFT) + 4, y: (ty << C.SHIFT) + 4 }; });
}

export function createWalk(seed) {
  return { seed: seed >>> 0, tick: 0, x: SPAWN.x, y: SPAWN.y, face: 0, anim: 0, items: placeItems(seed), collected: [] };   // face: 0 down 1 up 2 left 3 right
}
export const score = (s) => s.collected.length;
export const isOver = (s) => s.tick >= C.MAX_TICKS;

// Is the 4 x 4 box with top-left (x, y) clear? Four corners suffice because the box is smaller than a tile.
function free(x, y) {
  const x2 = x + C.HB - 1, y2 = y + C.HB - 1;
  if (x < 0 || y < 0 || x2 >= PX_W || y2 >= PX_H) return false;
  return !(isSolid(x >> C.SHIFT, y >> C.SHIFT) || isSolid(x2 >> C.SHIFT, y >> C.SHIFT) || isSolid(x >> C.SHIFT, y2 >> C.SHIFT) || isSolid(x2 >> C.SHIFT, y2 >> C.SHIFT));
}

// Move one px along an axis (dx or dy is +-1). Blocked: if a gap opens within NUDGE px sideways, slide one px toward it (so a door or a corner
// is not a pixel-exact target). Returns true when the box moved.
function move(s, dx, dy, assist) {
  if (free(s.x + dx, s.y + dy)) { s.x += dx; s.y += dy; return true; }
  if (!assist) return false;
  const ux = dx !== 0 ? 0 : 1, uy = dx !== 0 ? 1 : 0;   // the other axis
  for (let k = 1; k <= C.NUDGE; k++) {
    if (free(s.x + dx - ux * k, s.y + dy - uy * k)) { s.x -= ux; s.y -= uy; return true; }
    if (free(s.x + dx + ux * k, s.y + dy + uy * k)) { s.x += ux; s.y += uy; return true; }
  }
  return false;
}

// One tick. mask: what is held right now (bits 1 up, 2 down, 4 left, 8 right).
export function step(s, mask) {
  if (s.tick >= C.MAX_TICKS) return s;
  mask &= 15;
  const dy = (mask & 2 ? 1 : 0) - (mask & 1 ? 1 : 0), dx = (mask & 8 ? 1 : 0) - (mask & 4 ? 1 : 0);
  if (dx !== 0 || dy !== 0) {
    if (dx !== 0 && dy === 0) s.face = dx < 0 ? 2 : 3;
    else if (dy !== 0 && dx === 0) s.face = dy < 0 ? 1 : 0;
    else if (!(s.face === 0 && dy > 0) && !(s.face === 1 && dy < 0) && !(s.face === 2 && dx < 0) && !(s.face === 3 && dx > 0)) s.face = dy < 0 ? 1 : 0;
    const diagonal = dx !== 0 && dy !== 0;
    if (!diagonal || (s.tick & 3) !== 3) {            // a diagonal moves 3 ticks in 4: about 1.06 px/tick along the diagonal, never 1.41
      let moved = false;
      if (dx !== 0) moved = move(s, dx, 0, !diagonal) || moved;
      if (dy !== 0) moved = move(s, 0, dy, !diagonal) || moved;
      if (moved) s.anim++;
    }
  }
  const cx = s.x + 2, cy = s.y + 2;
  for (const it of s.items) {
    if (s.collected.includes(it.id)) continue;
    const ex = it.x - cx, ey = it.y - cy;
    if (ex * ex + ey * ey <= C.PICK_R * C.PICK_R) s.collected.push(it.id);
  }
  s.tick++;
  return s;
}

// The door the box centre stands on, or null.
export function doorAt(s) {
  const tx = (s.x + 2) >> C.SHIFT, ty = (s.y + 2) >> C.SHIFT;
  return isDoorTile(tx, ty) ? DOOR_KEYS[tileAt(tx, ty).charCodeAt(0) - 97] : null;
}

// The shared replay: inputs is a change list [[tick, mask], ...] sorted by tick; a mask holds from its tick until the next entry. Plays `ticks` ticks.
export function replay(seed, inputs, ticks = C.MAX_TICKS) {
  const s = createWalk(seed);
  let i = 0, mask = 0;
  while (s.tick < ticks && s.tick < C.MAX_TICKS) {
    while (i < inputs.length && inputs[i][0] <= s.tick) mask = inputs[i++][1];
    step(s, mask);
  }
  return s;
}

// Tap to move: the mask that walks the box toward the goal of a distField. It goes tile to tile, centring on the lane before it turns, and
// returns 0 once it is on the goal tile's centre (or the goal cannot be reached). The client records the masks it returns, like any other input.
export function autoMask(s, field) {
  const cx = s.x + 2, cy = s.y + 2, tx = cx >> C.SHIFT, ty = cy >> C.SHIFT, d = field[ty * W + tx];
  if (d < 0) return 0;
  let gx = (tx << C.SHIFT) + 4, gy = (ty << C.SHIFT) + 4, alongX = false;
  if (d > 0) {
    for (let k = 0; k < 4; k++) {
      const nx = tx + (k === 2 ? -1 : k === 3 ? 1 : 0), ny = ty + (k === 0 ? -1 : k === 1 ? 1 : 0);
      if (nx < 0 || ny < 0 || nx >= W || ny >= H || field[ny * W + nx] !== d - 1) continue;
      gx = (nx << C.SHIFT) + 4; gy = (ny << C.SHIFT) + 4; alongX = nx !== tx;
      break;
    }
  }
  const ex = gx - cx, ey = gy - cy;
  const xm = ex < 0 ? 4 : 8, ym = ey < 0 ? 1 : 2, ax = Math.abs(ex), ay = Math.abs(ey);
  if (d === 0) return ax <= 1 && ay <= 1 ? 0 : ax >= ay ? xm : ym;
  return alongX ? (ay > 1 ? ym : xm) : (ax > 1 ? xm : ym);
}

// The nearest walkable tile to (tx, ty) within 6 tiles (the tile itself when it is walkable), or null. For a tap that lands on a tree.
export function nearestWalkable(tx, ty) {
  let best = null, bd = 1 << 30;
  for (let dy = -6; dy <= 6; dy++) for (let dx = -6; dx <= 6; dx++) {
    const x = tx + dx, y = ty + dy;
    if (x < 0 || y < 0 || x >= W || y >= H || isSolid(x, y)) continue;
    const dd = dx * dx + dy * dy;
    if (dd < bd) { bd = dd; best = { x, y }; }
  }
  return best;
}
