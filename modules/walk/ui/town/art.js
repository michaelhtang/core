// Town Walk art: every tile, building, sprite and item is drawn here from rects and small pixel maps (no image or font files).
// The static town is drawn once onto an offscreen canvas; town.js copies the camera window out of it every frame and draws the moving things on top.
import { C, MAP, W, H, PX_W, PX_H, BUILDINGS, tileAt, hash32 } from '/m/walk/town/town-core.js?v=__V__';
import { text, textW } from '/m/walk/town/pixfont.js?v=__V__';
import { SIGNS } from '/m/walk/town/facts.js?v=__V__';

export const VW = 160, VH = 120;
const T = C.TILE;
const px = (ctx, x, y, w, h, color) => { ctx.fillStyle = color; ctx.fillRect(x, y, w, h); };
const noise = (x, y, k) => Math.imul(x * 73856093 ^ y * 19349663 ^ k * 83492791, 0x9e3779b1) >>> 0;   // art only: never touches the game state

// A pixel map: rows of chars, each char looked up in a palette ('.' is empty).
function paint(ctx, rows, pal, x, y, flip = false) {
  rows.forEach((row, r) => {
    for (let c = 0; c < row.length; c++) {
      const col = pal[row[flip ? row.length - 1 - c : c]];
      if (col) { ctx.fillStyle = col; ctx.fillRect(x + c, y + r, 1, 1); }
    }
  });
}

// ---- ground tiles ----
const GRASS = ['#5aa44c', '#4e9443', '#68b257'], PATH = ['#d6bd8c', '#c7ad7b', '#e0c99c'], STONE = ['#cfd2dc', '#bdc1ce'];
function grass(ctx, tx, ty) {
  const x = tx * T, y = ty * T;
  px(ctx, x, y, T, T, GRASS[0]);
  const n = noise(tx, ty, 1);
  px(ctx, x + (n & 7), y + ((n >> 3) & 7), 1, 1, GRASS[1]);
  px(ctx, x + ((n >> 6) & 7), y + ((n >> 9) & 7), 1, 1, GRASS[2]);
  if (((n >> 12) & 15) === 0) { px(ctx, x + 3, y + 4, 1, 1, '#f4f1e6'); px(ctx, x + 4, y + 3, 1, 1, '#f5c451'); }   // a tiny flower now and then
}
function path(ctx, tx, ty) {
  const x = tx * T, y = ty * T, n = noise(tx, ty, 2);
  px(ctx, x, y, T, T, PATH[0]);
  px(ctx, x + (n & 7), y + ((n >> 3) & 7), 1, 1, PATH[1]);
  px(ctx, x + ((n >> 6) & 7), y + ((n >> 9) & 7), 1, 1, PATH[2]);
}
function stone(ctx, tx, ty) {
  const x = tx * T, y = ty * T;
  px(ctx, x, y, T, T, STONE[(tx + ty) & 1]);
  px(ctx, x, y, T, 1, '#e6e8ef'); px(ctx, x, y, 1, T, '#e6e8ef');
}
const TREE = ['..gggg..', '.ggGggg.', 'gGgggggg', 'gggGgggg', 'gggggGgg', '.gggggg.', '..gttg..', '...tt...'];
function tree(ctx, tx, ty) {
  grass(ctx, tx, ty);
  px(ctx, tx * T + 1, ty * T + 7, 6, 1, 'rgba(0,0,0,0.18)');
  paint(ctx, TREE, { g: '#2f7d3a', G: '#47a352', t: '#6b4a2b' }, tx * T, ty * T);
}
function hedge(ctx, tx, ty) {
  grass(ctx, tx, ty);
  const x = tx * T, y = ty * T;
  px(ctx, x, y + 1, T, 6, '#2a6e34'); px(ctx, x, y + 1, T, 1, '#3f9a4b'); px(ctx, x + 2, y + 3, 1, 1, '#3f9a4b'); px(ctx, x + 5, y + 4, 1, 1, '#3f9a4b');
  px(ctx, x, y + 7, T, 1, 'rgba(0,0,0,0.18)');
}
function water(ctx, tx, ty) {
  const x = tx * T, y = ty * T, n = noise(tx, ty, 3);
  px(ctx, x, y, T, T, '#3b82c4');
  px(ctx, x + (n & 3), y + ((n >> 2) & 7), 3, 1, '#6db3e8');
  px(ctx, x + 4 + ((n >> 5) & 1), y + ((n >> 6) & 7), 2, 1, '#2c68a3');
}
function fountainStone(ctx, tx, ty) {
  const x = tx * T, y = ty * T;
  stone(ctx, tx, ty);
  px(ctx, x, y, T, T, '#a9aebd'); px(ctx, x + 1, y + 1, T - 2, T - 2, '#c5c9d6');
}

function ground(ctx, tx, ty) {
  const c = tileAt(tx, ty);
  if (c === 'T') tree(ctx, tx, ty);
  else if (c === 'H') hedge(ctx, tx, ty);
  else if (c === '~') water(ctx, tx, ty);
  else if (c === 'F') fountainStone(ctx, tx, ty);
  else if (c === ':') stone(ctx, tx, ty);
  else if (c === ',' || (c >= 'a' && c <= 'o') || c === '#') path(ctx, tx, ty);   // doors and building footprints sit on a path tile; the building is drawn over them
  else grass(ctx, tx, ty);
}

// ---- buildings: 5 x 4 tiles = 40 x 32 px; roof, sign plate with the pixel-font name, wall with windows and the door tile ----
const STYLE = {
  job: ['#c0392b', '#e8d9b5'], bank: ['#2f5d8c', '#dfe6ee'], 'bank-of-daa': ['#1f3f66', '#e9e3cf'], housing: ['#8b4a2b', '#f0d9b5'], insurance: ['#2e8b57', '#e3efe6'],
  credit: ['#7d3c98', '#e8dff0'], bills: ['#c99a17', '#f3ead0'], outfitters: ['#d9731c', '#f4e4cf'], exchange: ['#169c85', '#dff1ee'], networth: ['#3d5166', '#dde3ea'],
  'venture-row': ['#b5155a', '#f0dde6'], amphitheatre: ['#9a5a34', '#ead9c4'], life: ['#2f8fd1', '#e0eef8'], retirement: ['#7c8a8d', '#efe9db'], arcade: ['#6c3fc5', '#2b2b4a'],
};
const shade = (hex, k) => { const n = parseInt(hex.slice(1), 16); const f = (v) => Math.max(0, Math.min(255, v + k)); return `rgb(${f(n >> 16)},${f((n >> 8) & 255)},${f(n & 255)})`; };
// one small distinguishing shape per building, drawn on its roof
const ACCENT = {
  job: (c, x, y) => { px(c, x + 17, y + 3, 6, 5, '#f4f1e6'); px(c, x + 18, y + 4, 4, 1, '#c0392b'); px(c, x + 18, y + 6, 3, 1, '#c0392b'); },                       // a notice board
  bank: (c, x, y) => { for (let i = 0; i < 4; i++) px(c, x + 12 + i * 5, y + 3, 2, 8, '#f4f7ff'); px(c, x + 10, y + 2, 20, 1, '#f4f7ff'); },                       // columns
  'bank-of-daa': (c, x, y) => { px(c, x + 14, y + 2, 12, 2, '#f5c451'); px(c, x + 17, y + 4, 6, 6, '#f5c451'); px(c, x + 19, y + 5, 2, 4, '#1f3f66'); },           // gold coin plaque
  housing: (c, x, y) => { px(c, x + 29, y + 1, 4, 7, '#7a3d22'); px(c, x + 28, y + 1, 6, 1, '#5a2d19'); },                                                         // chimney
  insurance: (c, x, y) => { px(c, x + 16, y + 2, 8, 6, '#f4f7ff'); px(c, x + 17, y + 8, 6, 1, '#f4f7ff'); px(c, x + 18, y + 9, 4, 1, '#f4f7ff'); px(c, x + 19, y + 4, 2, 3, '#2e8b57'); },   // a shield
  credit: (c, x, y) => { px(c, x + 15, y + 3, 10, 6, '#f4f7ff'); px(c, x + 15, y + 5, 10, 1, '#7d3c98'); px(c, x + 16, y + 7, 3, 1, '#7d3c98'); },               // a card
  bills: (c, x, y) => { px(c, x + 16, y + 3, 8, 6, '#f4f1e6'); px(c, x + 17, y + 4, 6, 1, '#c99a17'); px(c, x + 17, y + 6, 4, 1, '#c99a17'); },                  // an invoice
  outfitters: (c, x, y) => { for (let i = 0; i < 8; i++) px(c, x + 4 + i * 4, y + 9, 2, 4, '#f4f1e6'); },                                                           // awning stripes
  exchange: (c, x, y) => { px(c, x + 19, y + 1, 1, 9, '#f4f7ff'); px(c, x + 20, y + 1, 7, 4, '#169c85'); px(c, x + 21, y + 2, 3, 2, '#f4f7ff'); },              // a flag
  networth: (c, x, y) => { px(c, x + 14, y + 7, 3, 3, '#f4f7ff'); px(c, x + 19, y + 4, 3, 6, '#f4f7ff'); px(c, x + 24, y + 1, 3, 9, '#f4f7ff'); },             // bars
  'venture-row': (c, x, y) => { px(c, x + 18, y + 6, 4, 4, '#f4f7ff'); px(c, x + 19, y + 3, 2, 3, '#f4f7ff'); px(c, x + 19, y + 1, 2, 2, '#f5c451'); },          // a rocket
  amphitheatre: (c, x, y) => { for (let i = 0; i < 3; i++) { px(c, x + 12 + i * 6, y + 5, 4, 5, '#6b3a1e'); px(c, x + 13 + i * 6, y + 4, 2, 1, '#6b3a1e'); } },   // arches
  life: (c, x, y) => { px(c, x + 16, y + 6, 3, 3, '#f4f7ff'); px(c, x + 17, y + 3, 1, 3, '#f4f7ff'); px(c, x + 21, y + 4, 3, 5, '#f4f7ff'); },                  // a person and a plant
  retirement: (c, x, y) => { px(c, x + 15, y + 6, 10, 3, '#f4f7ff'); px(c, x + 17, y + 3, 6, 3, '#f5c451'); },                                                     // a deck chair and sun
  arcade: (c, x, y) => { for (let i = 0; i < 9; i++) px(c, x + 3 + i * 4, y + 11, 2, 2, i & 1 ? '#f5c451' : '#ff5ea8'); },                                         // marquee bulbs
};
const SHUT = '#6b6f7a';
export function building(ctx, b, open) {
  const x = b.x * T, y = b.y * T, [roof, wall] = STYLE[b.key] ?? ['#888', '#ddd'];
  px(ctx, x + 1, y + 31, 40, 2, 'rgba(0,0,0,0.16)');                                // a soft shadow along the front
  px(ctx, x, y, 40, 14, roof);
  for (let i = 3; i < 13; i += 3) px(ctx, x, y + i, 40, 1, shade(roof, -22));
  px(ctx, x, y, 40, 1, shade(roof, 40)); px(ctx, x, y + 13, 40, 1, shade(roof, -60));
  ACCENT[b.key]?.(ctx, x, y);
  px(ctx, x, y + 14, 40, 8, '#2b2f3a');                                              // the sign plate
  px(ctx, x, y + 14, 40, 1, '#4b5163'); px(ctx, x + 1, y + 21, 38, 1, '#4b5163');
  const name = SIGNS[b.key] ?? b.key.toUpperCase();
  text(ctx, name, x + ((40 - textW(name)) >> 1), y + 16, open ? '#f6efd8' : '#98a0ae');
  px(ctx, x, y + 22, 40, 10, wall);                                                   // the wall
  px(ctx, x, y + 22, 40, 1, shade(wall, -40));
  for (const wx of [4, 30]) { px(ctx, x + wx, y + 24, 6, 5, '#53606f'); px(ctx, x + wx + 1, y + 25, 4, 3, '#a9d6f0'); px(ctx, x + wx + 1, y + 25, 4, 1, '#d4ecf9'); }
  const dx = x + 16, dy = y + 24;                                                     // the door tile (8 x 8)
  px(ctx, dx, dy, 8, 8, '#d6bd8c');
  px(ctx, dx + 1, dy, 6, 7, '#3b2a20');
  px(ctx, dx + 2, dy + 1, 4, 6, open ? '#ffcf5a' : SHUT);
  if (open) px(ctx, dx + 2, dy + 1, 4, 1, '#fff0b0'); else { px(ctx, dx + 2, dy + 3, 4, 1, '#454955'); px(ctx, dx + 2, dy + 5, 4, 1, '#454955'); }
  px(ctx, dx + 5, dy + 4, 1, 1, open ? '#7a4a1e' : '#454955');
  px(ctx, dx, dy + 7, 8, 1, '#a89472');                                              // threshold
}

// ---- the whole static town ----
export function buildWorld(openKeys) {
  const cv = document.createElement('canvas');
  cv.width = PX_W; cv.height = PX_H;
  const ctx = cv.getContext('2d');
  for (let ty = 0; ty < H; ty++) for (let tx = 0; tx < W; tx++) ground(ctx, tx, ty);
  // the fountain: a stone rim round water, with a pedestal in the middle
  px(ctx, 30 * T + 1, 21 * T + 1, 22, 22, '#3b82c4'); px(ctx, 30 * T + 3, 21 * T + 3, 18, 18, '#6db3e8'); px(ctx, 30 * T + 9, 21 * T + 9, 6, 6, '#a9aebd'); px(ctx, 30 * T + 10, 21 * T + 10, 4, 4, '#dfe3ee');
  for (const b of BUILDINGS) building(ctx, b, openKeys.has(b.key));
  return cv;
}

// ---- the wolf: 12 x 12, four facings, two walking frames ----
const FRONT = ['.dd......dd.', '.dgd....dgd.', '.dggggggggd.', '..gwegggewg.', '..gggnnnggg.', '..gwwwwwwwg.', '..bbbbbbbb..', '.gbbbbbbbbg.', '.gbbbbbbbbg.', '..bbbbbbbb..'];
const BACK = ['.dd......dd.', '.dgd....dgd.', '.dggggggggd.', '..gggggggg..', '..gggggggg..', '..gggggggg..', '..bbbbbbbb..', '.gbbbbbbbbg.', '.gbbbbbbbbg.', '..bbbbbbbb..'];
const SIDE = ['....dd......', '....dgd.....', '...dggggd...', '...ggggwegn.', '...gggggggnn', '...gwwwwwg..', '...bbbbbb...', '.ggbbbbbbg..', '..gbbbbbbg..', '...bbbbbb...'];
const LEGS = { front: [['..dd....dd..', '..dd........'], ['..dd....dd..', '........dd..']], back: [['..dd....dd..', '..dd........'], ['..dd....dd..', '........dd..']], side: [['...dd..dd...', '...dd.......'], ['...dd..dd...', '.......dd...']] };
const WOLF = { d: '#2a3550', g: '#8ea3c2', w: '#f4f7ff', e: '#0b1020', n: '#0b1020', b: '#338fbf' };
// face: 0 down 1 up 2 left 3 right. The sprite's feet sit on the 4 x 4 box: draw it at (box x - 4, box y - 8).
export function wolf(ctx, s, pal = WOLF) {
  const kind = s.face === 0 ? 'front' : s.face === 1 ? 'back' : 'side', body = kind === 'front' ? FRONT : kind === 'back' ? BACK : SIDE;
  const frame = (s.anim >> 3) & 1, x = s.x - 4, y = s.y - 8;
  px(ctx, x + 2, y + 10, 8, 2, 'rgba(0,0,0,0.22)');
  paint(ctx, [...body, ...LEGS[kind][frame]], pal, x, y, s.face === 2);
}

// ---- classmates (presence): the same wolf in one of 8 palettes, picked from a hash of the username so a classmate always looks the same ----
// g = fur, b = vest, d = ears and paws. Your own wolf keeps the school blue vest; none of these use it.
const FUR_VEST = [['#c9a77a', '#d4402a'], ['#b9b9c4', '#3f9a4b'], ['#8a6a4a', '#f5c451'], ['#e6dccb', '#7b4bb8'], ['#a8c0a0', '#e0407f'], ['#d2d6e0', '#e08a2a'], ['#9d8f86', '#1f9d8f'], ['#c7b38f', '#6b4a2b']];
export const MATE_PALS = FUR_VEST.map(([g, b]) => ({ ...WOLF, g, b, d: '#2a3550' }));
export const matePal = (hash) => MATE_PALS[hash & 7];

// ---- emotes: 8 x 8 icons shown above a sprite for a moment (1 wave, 2 thumbs-up, 3 star) ----
export const EMOTES = [null,
  { pal: { '#': '#3b3b4f', s: '#f2c28b' }, rows: ['.#.#.#..', '#s#s#s#.', '#sssss#.', '#ssssss#', '.#sssss#', '..#ssss#', '...#sss#', '....###.'] },     // 1 wave: an open hand
  { pal: { '#': '#3b3b4f', s: '#f2c28b' }, rows: ['...##...', '..#ss#..', '..#ss#..', '###ss###', '#ssssss#', '#ssssss#', '#ssssss#', '########'] },     // 2 thumbs-up
  { pal: { y: '#ffd94d', w: '#fff7c2' }, rows: ['...yy...', '...yw...', 'yyyyyyyy', '.yyyyyy.', '..yyyy..', '.yyyyyy.', '.yy..yy.', 'yy....yy'] }];       // 3 star
export function emoteIcon(ctx, kind, x, y, bob = 0) {
  const ic = EMOTES[kind];
  if (!ic) return;
  px(ctx, x - 1, y - 1 - bob, 10, 10, 'rgba(20,26,48,0.8)');
  paint(ctx, ic.rows, ic.pal, x, y - bob);
}

// ---- items: 8 x 8 icons, bobbing, with a sparkle ----
const ICONS = {
  receipt: { pal: { '#': '#3b3b4f', p: '#f4f1e6', a: '#9aa3b5' }, rows: ['.######.', '#pppppp#', '#paaaap#', '#pppppp#', '#paaaap#', '#pppppp#', '#p#pp#p#', '.#.##.#.'] },
  paystub: { pal: { '#': '#3b3b4f', p: '#f4f1e6', a: '#3f9a4b' }, rows: ['.######.', '#pppppp#', '#paaaap#', '#pppppp#', '#p####p#', '#pppppp#', '#paapaa#', '.######.'] },
  statement: { pal: { '#': '#3b3b4f', p: '#f4f1e6', a: '#338fbf' }, rows: ['.###....', '#aaa####', '#aaaaaa#', '#pppppp#', '#p####p#', '#pppppp#', '#p####p#', '.######.'] },
  t4: { pal: { '#': '#3b3b4f', p: '#fff3c4', a: '#c0392b' }, rows: ['.######.', '#pppppp#', '#paaaap#', '#pp##pp#', '#pp##pp#', '#pp##pp#', '#pppppp#', '.######.'] },
  coupon: { pal: { '#': '#3b3b4f', p: '#ffe6f0', a: '#e0407f' }, rows: ['........', '########', '#paapaa#', '#p.pp.p#', '#paapaa#', '#p.pp.p#', '########', '........'] },
  bill: { pal: { '#': '#3b3b4f', p: '#f4f1e6', a: '#d4402a' }, rows: ['........', '########', '#pp##pp#', '#p#pp#p#', '#paaaap#', '#pppppp#', '########', '........'] },
  keycard: { pal: { '#': '#3b3b4f', p: '#338fbf', a: '#f5c451' }, rows: ['........', '########', '#pppppp#', '#paapppp#', '#paapppp#', '#pppp##p#', '########', '........'] },
  'coin-purse': { pal: { '#': '#3b3b4f', p: '#b57a3d', a: '#f5c451' }, rows: ['..####..', '...##...', '.#pppp#.', '#pppppp#', '#ppaapp#', '#pppppp#', '.#pppp#.', '..####..'] },
};
export function itemSprite(ctx, it, tick, camX, camY) {
  const x = it.x - 4 - camX, y = it.y - 4 - camY;
  if (x < -8 || y < -10 || x > VW || y > VH) return;
  const bob = (tick >> 3) & 1;
  px(ctx, x + 1, y + 8, 6, 1, 'rgba(0,0,0,0.25)');
  const ic = ICONS[it.kind];
  if (ic) paint(ctx, ic.rows, ic.pal, x, y - bob);
  const sp = (tick >> 2) & 3;                                                         // a sparkle that walks round the corners
  const [sx, sy] = [[-1, -2], [8, -1], [8, 6], [-1, 6]][sp];
  px(ctx, x + sx, y + sy - bob, 1, 1, '#fff7c2');
}
