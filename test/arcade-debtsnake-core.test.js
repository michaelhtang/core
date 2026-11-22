// Debt Snake core (docs/debtsnake.md): determinism, option parsing, the money rules and one focused scenario per mode.
// Scenarios build a state with create(), clear what the seed put on the board, place things through the state, step and assert.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import {
  C, MODE_KEYS, SPEEDS, BOARDS, parseOptions, optionKey, create, step, replay, score, report, view, idiv,
} from '../modules/arcade/ui/games/debtsnake-core.js';

const CORE_URL = new URL('../modules/arcade/ui/games/debtsnake-core.js', import.meta.url);
const CORE_SRC = fs.readFileSync(CORE_URL, 'utf8');

const STEP = SPEEDS.normal;
// One move: press dir (0 up, 1 down, 2 left, 3 right; null = none) on the first tick, then let go until the move happens.
function mv(s, dir = null) {
  step(s, dir === null ? 0 : 1 << dir);
  for (let i = 1; i < s.stepTicks; i++) step(s, 0);
}
// A state with the seed's items cleared and no new coins unless a test asks. Default snake (small board): head (7,4) heading right, 12 long.
function bare(modes = ['classic'], extra = {}) {
  const s = create(1, { modes, ...extra });
  s.items.length = 0; s.fees.length = 0; s.marker = null; s.ncoins = 0;
  return s;
}
const coin = (x, y, o = {}) => ({ kind: 'coin', x, y, locked: false, pair: 0, len: 1, dir: 0, fade: 0, age: 0, ...o });
const head = (s, i = 0) => s.snakes[i].cells[0];
function put(s, cells, dir, i = 0) { s.snakes[i].cells = cells; s.snakes[i].prev = cells.slice(); s.snakes[i].dir = dir; }

// ---------- source scan ----------
test('core: import-free and integer-only (no imports, no Math.random, no Date, no float or division)', () => {
  const code = CORE_SRC.split('\n').map((l) => l.replace(/\/\/.*$/, '')).join('\n');
  assert.doesNotMatch(code, /\bimport\b|\brequire\b/);
  assert.doesNotMatch(code, /Math\.random|\bDate\b|performance\.|Math\.(sin|cos|tan|sqrt|floor|ceil|round|pow|exp|log|trunc|hypot)/);
  assert.deepEqual([...new Set(code.match(/Math\.\w+/g))].sort(), ['Math.imul', 'Math.max', 'Math.min']);
  assert.doesNotMatch(code, /\d\.\d/, 'no float literals');
  assert.doesNotMatch(code.replace(/`[^`]*`/g, ''), /[^/*\s]\s*\/\s*[^/*\s]/, 'no division');
  execFileSync(process.execPath, ['--check', path.join(CORE_URL.pathname)], { stdio: 'pipe' });
});

test('idiv matches floor division', () => {
  for (const [a, b] of [[0, 10], [9, 10], [10, 10], [199, 10], [123456, 7], [2147483647, 3]]) assert.equal(idiv(a, b), Math.floor(a / b));
});

// ---------- determinism ----------
const SCRIPT = [];
for (let t = 0; t < C.ROUND; t += 17) SCRIPT.push([t, 1 << ((t >> 4) & 3)], [t + 3, 0]);

test('same seed, inputs and options give the same state; different seeds give different boards', () => {
  const o = { modes: ['payday', 'latefees'], board: 'normal', coins: 3 };
  const a = replay(77, SCRIPT, o), b = replay(77, SCRIPT, o);
  assert.equal(score(a), score(b));
  assert.deepEqual(view(a), view(b));
  assert.deepEqual(report(a), report(b));
  const boards = new Set();
  for (let sd = 1; sd <= 8; sd++) boards.add(JSON.stringify(view(create(sd, { board: 'normal', coins: 5 })).items));
  assert.ok(boards.size >= 7, `got ${boards.size} distinct boards`);
  const scores = new Set();
  for (let sd = 1; sd <= 12; sd++) scores.add(JSON.stringify([score(replay(sd, SCRIPT, { modes: ['practice'], coins: 5 })), report(replay(sd, SCRIPT, { modes: ['practice'], coins: 5 }))]));
  assert.ok(scores.size > 1, 'other seeds change the result');
});

test('a coin never spawns on the snake, a wall, a stone or another item', () => {
  for (const modes of [['classic'], ['latefees', 'record', 'creditcheck', 'tunnel', 'autopay', 'hiddenfees']]) {
    for (let sd = 1; sd <= 20; sd++) {
      const s = create(sd, { modes, coins: 5 });
      const seen = new Set();
      const mark = (c) => { const k = `${c[0]},${c[1]}`; assert.ok(!seen.has(k), `overlap at ${k}`); seen.add(k); };
      s.snakes.forEach((sn) => sn.cells.forEach(mark));
      s.walls.forEach(mark);
      s.items.forEach((it) => mark([it.x, it.y]));
      s.fees.forEach((f) => mark([f.x, f.y]));
      if (s.marker) mark(s.marker);
    }
  }
});

// ---------- options ----------
test('parseOptions: defaults, accepted values and every rejection', () => {
  assert.deepEqual(parseOptions({}), { modes: ['classic'], speed: 'normal', board: 'small', coins: 1 });
  assert.deepEqual(parseOptions(undefined), parseOptions({}));
  assert.deepEqual(parseOptions({ modes: ['record', 'latefees'], speed: 'fast', board: 'large', coins: 5 }), { modes: ['latefees', 'record'], speed: 'fast', board: 'large', coins: 5 });
  for (const k of MODE_KEYS) assert.deepEqual(parseOptions({ modes: [k] }).modes, [k]);
  assert.deepEqual(parseOptions({ modes: MODE_KEYS.slice(1) }).modes, MODE_KEYS.slice(1).sort());
  for (const bad of [
    { modes: [] }, { modes: 'classic' }, { modes: ['nope'] }, { modes: ['latefees', 'latefees'] }, { modes: ['classic', 'latefees'] }, { modes: [3] },
    { speed: 'turbo' }, { speed: 5 }, { board: 'huge' }, { board: null }, { coins: 2 }, { coins: '3' }, { coins: 0 }, { coins: 3.5 }, 'x', [],
  ]) assert.throws(() => parseOptions(bad), Error, JSON.stringify(bad));
  assert.throws(() => create(1, { modes: ['nope'] }));
});

test('optionKey sorts the modes and ignores speed, board and coins', () => {
  assert.equal(optionKey(parseOptions({})), 'classic');
  assert.equal(optionKey({ modes: ['latefees'] }), 'latefees');
  assert.equal(optionKey({ modes: ['record', 'etransfer', 'latefees'] }), 'etransfer+latefees+record');
  assert.equal(optionKey(parseOptions({ modes: ['record', 'etransfer'], speed: 'fast', board: 'large', coins: 5 })), optionKey({ modes: ['etransfer', 'record'] }));
});

test('boards, speeds and the start: 12 long, middle row, heading right, debt 10', () => {
  for (const [name, [w, h]] of Object.entries(BOARDS)) {
    for (const sp of Object.keys(SPEEDS)) {
      const s = create(3, { board: name, speed: sp });
      assert.deepEqual([s.w, s.h, s.stepTicks], [w, h, SPEEDS[sp]]);
      assert.equal(s.snakes[0].cells.length, 12);
      assert.deepEqual(head(s), [Math.min(11, w - 3), h >> 1]);
      assert.equal(s.snakes[0].dir, 3);
      assert.equal(s.debt, 10);
      assert.equal(view(s).items.length, 1);
    }
  }
});

// ---------- classic money rules ----------
test('classic payment: +10, debt down, the snake shrinks by one over the next move', () => {
  const s = bare();
  s.items.push(coin(8, 4));
  mv(s);
  assert.deepEqual([s.score, s.debt, s.snakes[0].cells.length], [10, 9, 12]);
  assert.deepEqual(s.events.map((e) => e.kind), ['pay']);
  mv(s);
  assert.equal(s.snakes[0].cells.length, 11);
  assert.deepEqual(report(s).payments, 1);
});

test('the next coin appears on the same tick, never on the snake', () => {
  const s = create(9, { coins: 1 });
  s.items.length = 0; s.items.push(coin(8, 4));
  mv(s);
  assert.equal(s.items.filter((i) => i.kind === 'coin').length, 1);
  const c = s.items[0];
  assert.ok(!s.snakes[0].cells.some((p) => p[0] === c.x && p[1] === c.y));
});

test('interest at the end of a month adds 1 + floor((debt - 1) / 10) segments', () => {
  for (const [debt, add] of [[1, 1], [10, 1], [11, 2], [20, 2], [21, 3], [30, 3], [31, 4]]) {
    const s = bare();
    s.debt = debt; s.mleft = 1;
    mv(s);
    assert.equal(s.debt - debt, add, `debt ${debt}`);
    assert.equal(s.snakes[0].pend, add);
    assert.equal(s.mleft, C.MONTH);
    assert.equal(s.month, 1);
    assert.equal(s.events.find((e) => e.kind === 'interest').n, add);
  }
  const s = bare(); s.debt = 5; s.mleft = 2;
  mv(s);
  assert.equal(s.debt, 5, 'not yet');
  assert.equal(view(s).month_moves_left, 1);
});

test('debt free: +200 once, then coins are savings that grow the snake and savings earn interest', () => {
  const s = bare();
  s.debt = 1;
  s.items.push(coin(8, 4), coin(9, 4));
  mv(s);
  assert.deepEqual([s.score, s.debt, s.bonus], [210, 0, 1]);
  assert.ok(s.events.some((e) => e.kind === 'debtfree'));
  assert.equal(report(s).debt_free, 1);
  mv(s);
  assert.equal(s.score, 220, 'second coin: +10 only, no second bonus');
  assert.equal(s.savings, 1);
  assert.ok(s.events.some((e) => e.kind === 'save'));
  const len = s.snakes[0].cells.length;
  put(s, [[3, 1], [2, 1], [1, 1], [0, 1], [0, 0]], 3);
  s.snakes[0].pend = 0;
  s.items.push(coin(4, 1));
  mv(s);
  mv(s);
  assert.equal(s.snakes[0].cells.length, 5 + 1 - 0, 'grows by one after a saving coin');
  assert.ok(len >= 11);
  const t = bare();
  t.debt = 0; t.bonus = 1; t.savings = 25; t.mleft = 1; t.score = 5;
  mv(t);
  assert.deepEqual([t.savings, t.score, t.snakes[0].pend], [27, 25, 2], '2 per full 10 saved: +2 segments, +20 points');
});

test('crash into a wall ends the round; so does your own body', () => {
  const s = bare();
  put(s, [[9, 4], [8, 4], [7, 4]], 3);
  mv(s);
  assert.equal(s.over, true);
  assert.ok(s.events.some((e) => e.kind === 'crash'));
  const before = s.tick;
  step(s, 0);
  assert.equal(s.tick, before, 'a finished round no longer moves');
  const t = bare();
  put(t, [[3, 3], [3, 4], [4, 4], [5, 4], [5, 3], [4, 3]], 0);
  t.snakes[0].pend = 1;
  mv(t, 3);   // right into (4,3), a body square that stays because the snake is growing
  assert.equal(t.over, true);
});

test('the tail square that moves away this step does not count as a crash; a growing tail does', () => {
  const loop = () => [[2, 2], [2, 3], [1, 3], [1, 2]];
  const a = bare(); put(a, loop(), 0);
  mv(a, 2);   // into (1,2): the tail leaves it this move
  assert.equal(a.over, false);
  assert.deepEqual(head(a), [1, 2]);
  const b = bare(); put(b, loop(), 0); b.snakes[0].pend = 1;
  mv(b, 2);   // growing: the tail stays, so the head hits it
  assert.equal(b.over, true);
});

test('turns: 2-turn queue (one per move), rising edge only, reverse into the neck ignored', () => {
  const s = bare();
  step(s, 1); step(s, 0); step(s, 4); step(s, 0); step(s, 0);   // up, then left, both pressed before the first move
  assert.deepEqual(head(s), [7, 3]);
  for (let i = 0; i < STEP; i++) step(s, 0);
  assert.deepEqual(head(s), [6, 3]);
  const r = bare();
  mv(r, 2);   // left while heading right is the neck: ignored
  assert.deepEqual(head(r), [8, 4]);
  const h = bare();
  for (let i = 0; i < STEP; i++) step(h, 1);   // holding up is one press
  assert.deepEqual(head(h), [7, 3]);
  for (let i = 0; i < STEP; i++) step(h, 1);
  assert.deepEqual(head(h), [7, 2], 'still up: no new turn while held');
  const q = bare();
  step(q, 1); step(q, 4); step(q, 2);   // a third press while two are queued is dropped
  assert.equal(q.queue.length, 2);
  const both = bare();
  step(both, 1 | 2);   // up and down together: down is the reverse of up so only up goes in
  assert.deepEqual(both.queue, [0]);
});

test('speeds move every 7, 5 or 3 ticks; the round is 5400 ticks and a full replay stays under 50 ms', () => {
  for (const [name, n] of Object.entries(SPEEDS)) {
    const s = create(1, { speed: name });
    for (let i = 0; i < n - 1; i++) step(s, 0);
    assert.equal(s.moves, 0);
    step(s, 0);
    assert.equal(s.moves, 1);
  }
  const o = { modes: ['practice', 'noborders', 'latefees', 'payday'], board: 'large', coins: 5, speed: 'fast' };
  replay(1, SCRIPT, o);
  const t0 = process.hrtime.bigint();
  const s = replay(5, SCRIPT, o);
  const ms = Number(process.hrtime.bigint() - t0) / 1e6;
  assert.equal(s.tick, C.ROUND);
  assert.equal(s.over, true);
  assert.ok(ms < 50, `replay took ${ms.toFixed(1)} ms`);
});

// ---------- one scenario per mode ----------
test('latefees: every month a wall drops on the marked square and the next square is marked', () => {
  const s = bare(['latefees']);
  s.marker = [3, 2]; s.mleft = 1;
  mv(s);
  assert.deepEqual(s.walls, [[3, 2]]);
  assert.ok(s.marker && !(s.marker[0] === 3 && s.marker[1] === 2));
  const v = view(s);
  assert.deepEqual(v.walls, [[3, 2]]);
  assert.equal(v.items.filter((i) => i.kind === 'marker' && i.for === 'wall').length, 1);
  put(s, [[2, 3], [1, 3], [0, 3]], 3);
  put(s, [[3, 3], [3, 4], [3, 5]], 0);
  mv(s);
  assert.equal(s.over, true, 'a wall block is solid');
});

test('etransfer: coins come in linked pairs; entering one pops the head out of the other, one payment', () => {
  const s = create(4, { modes: ['etransfer'], coins: 3 });
  assert.equal(view(s).items.length, 6);
  const pairs = {};
  for (const it of view(s).items) pairs[it.pair] = (pairs[it.pair] || 0) + 1;
  assert.deepEqual(Object.values(pairs), [2, 2, 2]);
  const t = bare(['etransfer']);
  t.items.push(coin(8, 4, { pair: 1 }), coin(2, 0, { pair: 1 }));
  mv(t);
  assert.deepEqual(head(t), [2, 0]);
  assert.equal(t.items.length, 0);
  assert.deepEqual([t.score, t.debt], [10, 9]);
  assert.ok(t.events.some((e) => e.kind === 'teleport'));
});

test('partial: segment i is solid when i % 4 is 0 or 1; the head passes segment 3 and crashes into segment 5', () => {
  const body = () => [[4, 4], [4, 5], [3, 5], [3, 4], [3, 3], [2, 3]];   // segment 3 is (3,4), left of the head
  const s = bare(['partial']); put(s, body(), 0);
  mv(s, 2);
  assert.equal(s.over, false, 'segment 3 is a gap');
  const c = bare(); put(c, body(), 0);
  mv(c, 2);
  assert.equal(c.over, true, 'classic: the same move is a crash');
  const t = bare(['partial']); put(t, [[4, 4], [4, 5], [6, 5], [6, 6], [6, 7], [5, 4], [5, 3]], 0);   // segment 5 is (5,4), right of the head
  mv(t, 3);
  assert.equal(t.over, true, 'segment 5 is solid');
  const u = bare(['partial']); put(u, [[4, 4], [4, 5], [3, 5], [3, 4], [3, 3], [2, 3]], 0);
  const v = view(u).snakes[0];
  assert.equal(v.gaps, true);
  assert.deepEqual(v.solid, [true, true, false, false, true, true]);
  assert.deepEqual(view(bare()).snakes[0].solid.every(Boolean), true);
});

test('noborders: leaving one edge comes back on the other', () => {
  const s = bare(['noborders']);
  put(s, [[9, 4], [8, 4], [7, 4]], 3);
  mv(s);
  assert.deepEqual(head(s), [0, 4]);
  assert.equal(s.over, false);
  assert.equal(view(s).wrap, true);
  put(s, [[0, 0], [0, 1], [0, 2]], 0);
  mv(s);
  assert.deepEqual(head(s), [0, 8]);
});

test('transfer: after a payment the snake flips and you steer from the old tail', () => {
  const s = bare(['transfer']);
  s.items.push(coin(8, 4));
  mv(s);
  assert.deepEqual(head(s), [0, 7]);
  assert.equal(s.snakes[0].dir, 1);
  assert.ok(s.events.some((e) => e.kind === 'flip'));
  mv(s);
  assert.deepEqual(head(s), [0, 8], 'it now moves from the old tail');
});

test('payday: coins move one square every second move', () => {
  const s = bare(['payday']);
  s.items.push(coin(5, 1));
  mv(s);
  assert.deepEqual([s.items[0].x, s.items[0].y], [5, 1]);
  mv(s);
  const d = Math.abs(s.items[0].x - 5) + Math.abs(s.items[0].y - 1);
  assert.equal(d, 1);
  const t = bare(['payday']);
  t.items.push(coin(0, 0));
  for (let i = 0; i < 20; i++) { mv(t, i === 0 ? 0 : null); if (t.over) break; }
  const it = t.items[0];
  assert.ok(it.x >= 0 && it.y >= 0 && it.x < t.w && it.y < t.h);
});

test('cosigner: a mirrored second snake, shared debt, either crash ends the round', () => {
  const s = create(2, { modes: ['cosigner'] });
  const [a, b] = s.snakes;
  assert.equal(b.dir, 2);
  a.cells.forEach((c, i) => assert.deepEqual(b.cells[i], [s.w - 1 - c[0], s.h - 1 - c[1]]));
  assert.equal(view(s).snakes.length, 2);
  s.items.length = 0; s.ncoins = 0;
  s.items.push(coin(8, 3));
  mv(s);
  assert.deepEqual([s.score, s.debt], [10, 9]);
  assert.deepEqual([a.pend, b.pend], [-1, -1], 'both shrink');
  assert.equal(head(s, 1)[0], 1, 'the second snake moved the mirror way');
  s.debt = 3; s.mleft = 1;
  mv(s);
  assert.deepEqual([s.debt, a.pend, b.pend], [4, 1, 1], 'interest grows both');
  const t = create(2, { modes: ['cosigner'] });
  t.items.length = 0; t.ncoins = 0;
  put(t, [[0, 1], [1, 1]], 2, 1);
  mv(t);
  assert.equal(t.over, true);
});

test('pin: locked coins are solid until a key opens the nearest one (no points)', () => {
  const s = bare(['pin']);
  s.items.push(coin(8, 4, { locked: true }));
  mv(s);
  assert.equal(s.over, true);
  const t = bare(['pin']);
  t.items.push({ kind: 'key', x: 8, y: 4 }, coin(5, 0, { locked: true }), coin(2, 7, { locked: true }));
  mv(t);
  assert.equal(t.score, 0);
  assert.deepEqual(t.items.filter((i) => i.kind === 'coin').map((i) => i.locked), [false, true]);
  assert.ok(t.events.some((e) => e.kind === 'key'));
  const u = create(3, { modes: ['pin'] });
  assert.ok(u.items.some((i) => i.kind === 'coin' && i.locked) && u.items.some((i) => i.kind === 'key'));
  assert.equal(view(u).near, 99, 'a locked coin is not edible');
});

test('paperwork: push the crate, deliver it to the mailbox for the payment; a blocked push is a crash', () => {
  const crate = (x, y, o = {}) => ({ kind: 'crate', x, y, locked: false, pair: 0, len: 1, dir: 0, fade: 0, age: 0, ...o });
  const s = bare(['paperwork']);
  s.items.push({ kind: 'mailbox', x: 0, y: 0 }, crate(8, 4));
  mv(s);
  assert.deepEqual([s.items[1].x, head(s)[0]], [9, 8]);
  mv(s);
  assert.equal(s.over, true, 'the wall is behind the crate');
  const t = bare(['paperwork']);
  t.items.push({ kind: 'mailbox', x: 9, y: 4 }, crate(8, 4));
  mv(t);
  assert.deepEqual([t.score, t.debt, t.items.filter((i) => i.kind === 'crate').length], [10, 9, 0]);
  const u = bare(['paperwork']);
  u.items.push({ kind: 'mailbox', x: 0, y: 0 }, crate(8, 4)); u.stones.push([9, 4]);
  mv(u);
  assert.equal(u.over, true);
  const v = bare(['paperwork']);
  v.items.push({ kind: 'mailbox', x: 0, y: 0 }, crate(3, 0, { age: 1 })); v.mleft = 1;
  mv(v);
  assert.equal(v.items.find((i) => i.kind === 'crate').age, 0, 'two months undelivered: moved to a fresh square');
  const w = create(5, { modes: ['paperwork'] });
  assert.ok(w.items.some((i) => i.kind === 'mailbox') && w.items.some((i) => i.kind === 'crate'));
});

test('predatory: the skull adds 3 segments of debt and -20 points (floor 0) and a new one appears', () => {
  const s = bare(['predatory']);
  s.score = 5; s.items.push({ kind: 'skull', x: 8, y: 4 });
  mv(s);
  assert.deepEqual([s.debt, s.score, s.snakes[0].pend, report(s).traps], [13, 0, 3, 1]);
  assert.equal(s.items.filter((i) => i.kind === 'skull').length, 1);
  const t = bare(['predatory']);
  t.score = 50; t.items.push({ kind: 'skull', x: 8, y: 4 });
  mv(t);
  assert.equal(t.score, 30);
  const u = bare(['predatory']);
  u.items.push({ kind: 'skull', x: 3, y: 0 }); u.mleft = 1;
  mv(u);
  assert.equal(u.items.filter((i) => i.kind === 'skull').length, 1, 'it moves every month');
});

test('expiring: a coin fades after 40 moves; a missed coin adds a segment and a new coin appears', () => {
  const s = create(6, { modes: ['expiring'] });
  assert.equal(s.items[0].fade, 40);
  s.items.length = 0; s.items.push(coin(3, 0, { fade: 2 }));
  mv(s, null);
  assert.equal(s.items[0].fade, 1);
  mv(s);
  assert.equal(s.debt, 11);
  assert.equal(s.snakes[0].pend, 1);
  assert.ok(s.events.some((e) => e.kind === 'expire'));
  assert.deepEqual(s.items.map((i) => [i.kind, i.fade]), [['coin', 40]]);
});

test('hiddenfees: a fee under a hidden square costs 2 segments and 10 points and its zone clears; a new zone each month, at most 4', () => {
  const s = bare(['hiddenfees']);
  s.score = 15; s.fees.push({ x: 8, y: 4, zx: 7, zy: 3 });
  assert.deepEqual(view(s).items, [{ kind: 'zone', x: 7, y: 3, w: 3, h: 3 }]);
  mv(s);
  assert.deepEqual([s.debt, s.score, s.fees.length, report(s).fees], [12, 5, 0, 1]);
  assert.ok(s.events.some((e) => e.kind === 'fee'));
  const t = bare(['hiddenfees']);
  for (let i = 0; i < 6; i++) { t.mleft = 1; mv(t); if (t.over) break; put(t, [[7, 4], [6, 4]], 3); }
  assert.ok(t.fees.length <= 4 && t.fees.length >= 1);
  for (const f of t.fees) assert.ok(f.x >= f.zx && f.x < f.zx + 3 && f.y >= f.zy && f.y < f.zy + 3);
});

test('record: each payment leaves a stone where the tail was; at most 25, oldest first', () => {
  const s = bare(['record']);
  s.items.push(coin(8, 4));
  mv(s); mv(s);
  assert.deepEqual(s.stones, [[0, 7]]);
  assert.deepEqual(view(s).stones, [[0, 7]]);
  const t = bare(['record']);
  for (let i = 0; i < 25; i++) t.stones.push([0, 0]);
  t.stones[0] = [9, 0];
  put(t, [[5, 4], [4, 4], [3, 4], [2, 4]], 3);
  t.snakes[0].pend = -1;
  mv(t);
  assert.equal(t.stones.length, 25);
  assert.deepEqual(t.stones[24], [2, 4]);
  assert.notDeepEqual(t.stones[0], [9, 0]);
});

test('fineprint: the board is flagged dark and nothing else changes', () => {
  assert.equal(view(create(1, { modes: ['fineprint'] })).dark, true);
  assert.equal(view(create(1)).dark, false);
  const a = replay(8, SCRIPT, { modes: ['fineprint'], coins: 3 }), b = replay(8, SCRIPT, { coins: 3 });
  assert.equal(score(a), score(b));
});

test('emergency: a held fund turns a crash into a flip once; a pickup appears every second month', () => {
  const s = bare(['emergency']);
  s.shield = 1;
  put(s, [[9, 4], [8, 4], [7, 4]], 3);
  mv(s);
  assert.equal(s.over, false);
  assert.deepEqual([s.shield, view(s).shield], [0, 0]);
  assert.deepEqual(head(s), [7, 4]);
  assert.equal(s.snakes[0].dir, 2);
  assert.ok(s.events.some((e) => e.kind === 'shield'));
  put(s, [[0, 4], [1, 4], [2, 4]], 2);
  mv(s);
  assert.equal(s.over, true, 'used up');
  const t = bare(['emergency']);
  t.items.push({ kind: 'fund', x: 8, y: 4 });
  mv(t);
  assert.equal(view(t).shield, 1);
  const u = bare(['emergency']);
  u.month = 1; u.mleft = 1;
  mv(u);
  assert.equal(u.items.filter((i) => i.kind === 'fund').length, 1);
  u.items.length = 0; u.shield = 1; u.month = 3; u.mleft = 1;
  put(u, [[3, 1], [2, 1]], 3);
  mv(u);
  assert.equal(u.items.length, 0, 'at most one held, none offered');
});

test('autopay: entering an arrow turns you to it and clears queued turns', () => {
  const s = bare(['autopay']);
  s.items.push({ kind: 'arrow', x: 8, y: 4, dir: 1 });
  step(s, 1); step(s, 0); step(s, 0); step(s, 0); step(s, 0);
  assert.deepEqual(head(s), [7, 3], 'the up turn happened');
  put(s, [[7, 4], [6, 4], [5, 4]], 3);
  mv(s);
  assert.deepEqual(head(s), [8, 4]);
  assert.equal(s.snakes[0].dir, 1);
  assert.deepEqual(s.queue, []);
  mv(s);
  assert.deepEqual(head(s), [8, 5]);
  assert.equal(create(1, { modes: ['autopay'] }).items.filter((i) => i.kind === 'arrow').length, 6);
});

test('bigpurchase: coins are 3 squares long; any part pays all three', () => {
  const s = bare(['bigpurchase']);
  s.items.push(coin(8, 3, { len: 3, dir: 1 }));
  mv(s);
  assert.deepEqual([s.score, s.debt, s.snakes[0].pend], [30, 7, -3]);
  const t = create(3, { modes: ['bigpurchase'] });
  assert.equal(view(t).items[0].len, 3);
  const cells = t.items[0].dir === 1 ? 'y' : 'x';
  assert.ok(t.items[0][cells] >= 0);
  const u = bare(['bigpurchase']);
  u.debt = 2;
  u.items.push(coin(8, 4, { len: 3, dir: 0 }));
  mv(u);
  assert.deepEqual([u.debt, u.savings, u.bonus, u.score], [0, 1, 1, 230]);
});

test('directdeposit: coins within 4 squares slide toward your head every second move', () => {
  const s = bare(['directdeposit']);
  s.moves = 1;
  s.items.push(coin(8, 0), coin(0, 0));
  mv(s);   // head now (8,4); the coin at (8,0) is 4 away
  assert.deepEqual([s.items[0].x, s.items[0].y], [8, 1]);
  assert.deepEqual([s.items[1].x, s.items[1].y], [0, 0], 'too far');
  const t = bare(['directdeposit']);
  t.items.push(coin(8, 0));
  mv(t);   // moves is odd: nothing yet
  assert.deepEqual([t.items[0].x, t.items[0].y], [8, 0]);
});

test('creditcheck: the gate is open in even months, shut in odd months, flashes first, and stays open around the snake', () => {
  const s = bare(['creditcheck']);
  const g = view(s).gate;
  assert.deepEqual([g.x, g.y0, g.y1, g.open, g.warn], [5, 3, 5, true, false]);
  assert.ok(s.walls.length > 0 && s.walls.every((c) => c[0] === 5 && (c[1] < 3 || c[1] > 5)));
  s.mleft = 8;
  assert.equal(view(s).gate.warn, true);
  s.mleft = 9;
  assert.equal(view(s).gate.warn, false);
  s.month = 1; put(s, [[7, 4], [6, 4]], 3);
  mv(s);
  assert.equal(s.gate.open, false, 'the snake is out of the gate now');
  put(s, [[3, 4], [2, 4], [1, 4]], 3);
  s.month = 1;
  mv(s);
  assert.equal(s.gate.open, false);
  mv(s);
  assert.equal(s.over, true, 'a shut gate is a wall');
  const t = bare(['creditcheck']);
  t.month = 1; t.mleft = 3; put(t, [[6, 4], [5, 4], [4, 4]], 3);
  t.snakes[0].pend = 3;
  mv(t);
  assert.equal(t.gate.open, true, 'still in the gate');
  const u = bare(['creditcheck']);
  u.month = 2;
  put(u, [[3, 4], [2, 4], [1, 4]], 3);
  mv(u); mv(u);
  assert.equal(u.over, false);
  assert.deepEqual(head(u), [5, 4]);
});

test('tunnel: entering one hole puts the head out of its partner', () => {
  const s = bare(['tunnel']);
  s.items.push({ kind: 'tunnel', x: 8, y: 4, pair: 1 }, { kind: 'tunnel', x: 2, y: 0, pair: 1 });
  mv(s);
  assert.deepEqual(head(s), [2, 0]);
  mv(s);
  assert.deepEqual(head(s), [3, 0], 'it carries on in the same direction');
  assert.equal(create(2, { modes: ['tunnel'] }).items.filter((i) => i.kind === 'tunnel').length, 4);
});

test('practice: a crash skips the move and turns right (or left when right is blocked); the round goes on', () => {
  const s = bare(['practice']);
  put(s, [[9, 4], [8, 4], [7, 4]], 3);
  mv(s);
  assert.equal(s.over, false);
  assert.deepEqual(head(s), [9, 4]);
  assert.equal(s.snakes[0].dir, 1);
  const t = bare(['practice']);
  put(t, [[9, 4], [8, 4], [7, 4]], 3); t.stones.push([9, 5]);
  mv(t);
  assert.equal(t.snakes[0].dir, 0);
  assert.equal(t.over, false);
});

// ---------- every mode alone and in a Mix ----------
const VIEW_KEYS = ['w', 'h', 'tick', 'over', 'debt', 'savings', 'score', 'month', 'month_moves_left', 'progress', 'snakes', 'items', 'walls', 'stones', 'gate', 'dark', 'wrap', 'shield', 'near', 'events'].sort();
function lcgInputs(seed) {
  let r = seed >>> 0; const out = []; let mask = 0;
  for (let t = 0; t < C.ROUND; t++) {
    r = (Math.imul(r, 1103515245) + 12345) >>> 0;
    const v = (r >>> 16) % 11;
    const m = v < 4 ? 1 << v : v === 4 ? 0 : mask;
    if (m !== mask) { out.push([t, m]); mask = m; }
  }
  return out;
}
test('every mode key works alone and all of them mixed, on every board, speed and coin count; view() keeps its shape', () => {
  const sets = [...MODE_KEYS.map((k) => [k]), MODE_KEYS.slice(1), ['cosigner', 'transfer', 'pin', 'paperwork', 'etransfer'], ['practice', 'cosigner', 'creditcheck', 'noborders']];
  for (const modes of sets) {
    for (const [board, speed, coins] of [['small', 'fast', 5], ['normal', 'normal', 3], ['large', 'slow', 1]]) {
      for (let sd = 1; sd <= 3; sd++) {
        const o = { modes, board, speed, coins }, inputs = lcgInputs(sd * 31 + modes.length);
        const a = replay(sd, inputs, o);
        assert.equal(a.over, true);
        assert.ok(a.tick >= 1 && a.tick <= C.ROUND);
        assert.deepEqual(Object.keys(view(a)).sort(), VIEW_KEYS);
        assert.equal(score(replay(sd, inputs, o)), score(a));
        const r = report(a);
        assert.deepEqual(Object.keys(r).sort(), ['debt', 'debt_free', 'fees', 'max_debt', 'months', 'payments', 'savings', 'traps']);
        assert.ok(score(a) >= 0 && a.debt >= 0);
      }
    }
  }
  // invariants along a run: snakes stay on the board and nothing overlaps a wall or stone
  for (const modes of [['latefees', 'record', 'hiddenfees', 'predatory', 'practice'], ['noborders', 'directdeposit', 'payday', 'tunnel', 'autopay', 'practice']]) {
    const s = create(11, { modes, board: 'normal', coins: 5, speed: 'fast' });
    const inputs = lcgInputs(5); let i = 0, mask = 0;
    while (!s.over) {
      while (i < inputs.length && inputs[i][0] <= s.tick) mask = inputs[i++][1];
      step(s, mask);
      for (const sn of s.snakes) for (const c of sn.cells) assert.ok(c[0] >= 0 && c[1] >= 0 && c[0] < s.w && c[1] < s.h);
      for (const sn of s.snakes) for (const c of sn.cells) assert.ok(!s.walls.some((q) => q[0] === c[0] && q[1] === c[1]), 'snake in a wall');
      for (const it of s.items) assert.ok(it.x >= 0 && it.y >= 0 && it.x < s.w && it.y < s.h);
    }
  }
});

test('view(): progress counts ticks since the last move, month fields count down, prev is one move back', () => {
  const s = bare();
  const first = view(s);
  assert.equal(first.progress, 0);
  assert.equal(first.month_moves_left, 60);
  step(s, 0); step(s, 0);
  assert.equal(view(s).progress, 2);
  for (let i = 2; i < STEP; i++) step(s, 0);
  const v = view(s);
  assert.equal(v.progress, 0);
  assert.equal(v.month_moves_left, 59);
  assert.deepEqual(v.snakes[0].prev[0], [7, 4]);
  assert.deepEqual(v.snakes[0].cells[0], [8, 4]);
  assert.equal(v.snakes[0].dir, 3);
  assert.equal(v.near, 99);
  s.items.push(coin(10, 4));
  assert.equal(view(s).near, 2);
  for (const k of ['w', 'h']) assert.ok(Number.isInteger(v[k]));
});

test('Mix of etransfer, bigpurchase and paperwork: each pair of them shapes coins in turn', () => {
  const kinds = (modes) => {
    const v = create(5, { modes, coins: 5 }).items.filter((it) => it.kind === 'coin' || it.kind === 'crate');
    return { pair: v.some((it) => it.pair), big: v.some((it) => it.len === 3), crate: v.some((it) => it.kind === 'crate'), mailbox: create(5, { modes }).items.some((it) => it.kind === 'mailbox') };
  };
  const a = kinds(['bigpurchase', 'etransfer']);
  assert.deepEqual([a.pair, a.big], [true, true]);
  const b = kinds(['bigpurchase', 'paperwork']);
  assert.deepEqual([b.big, b.crate, b.mailbox], [true, true, true]);
  const c = kinds(['etransfer', 'paperwork']);
  assert.deepEqual([c.pair, c.crate, c.mailbox], [true, true, true]);
  const d = kinds(['etransfer', 'bigpurchase', 'paperwork']);
  assert.deepEqual([d.pair, d.big, d.crate], [true, true, true]);
  const s = create(5, { modes: ['bigpurchase', 'etransfer'], coins: 3 });
  assert.deepEqual(s.items.map((i) => [i.pair > 0, i.len]), [[true, 1], [true, 1], [false, 3], [true, 1], [true, 1]], 'a pair, a 3-long coin, a pair');
  assert.equal(replay(3, SCRIPT, { modes: ['etransfer', 'bigpurchase', 'paperwork'], coins: 5 }).over, true);
});
