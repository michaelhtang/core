import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BADGE_GRID, BADGES, badgeSvg } from '../modules/learn/ui/badges.js';
import { TIERS } from '../modules/learn/tiers.js';

test('every tier has a badge, and only tiers do', () => {
  for (const t of TIERS) assert.ok(BADGES[t.id], `badge for ${t.id}`);
  assert.deepEqual(Object.keys(BADGES).sort(), TIERS.map((t) => t.id).sort());
});

test('grids are BADGE_GRID square and use only palette chars', () => {
  for (const [id, b] of Object.entries(BADGES)) {
    assert.equal(b.rows.length, BADGE_GRID, `${id} rows`);
    for (const row of b.rows) {
      assert.equal(row.length, BADGE_GRID, `${id} row width`);
      for (const ch of row) if (ch !== '.') assert.ok(Object.hasOwn(b.palette, ch), `${id} char ${ch} in palette`);
    }
    for (const hex of Object.values(b.palette)) assert.match(hex, /^#[0-9a-f]{6}$/i);
  }
});

test('every badge is left-right symmetric', () => {
  for (const [id, b] of Object.entries(BADGES)) {
    for (const row of b.rows) assert.equal(row, [...row].reverse().join(''), `${id} symmetric`);
  }
});

test('badgeSvg returns an accessible SVG of rects only', () => {
  for (const t of TIERS) {
    const svg = badgeSvg(t.id, 48);
    assert.ok(svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg"'));
    assert.ok(svg.endsWith('</svg>'));
    assert.ok(svg.includes(`viewBox="0 0 ${BADGE_GRID} ${BADGE_GRID}"`));
    assert.ok(svg.includes('width="48" height="48"'));
    assert.ok(svg.includes('shape-rendering="crispEdges"'));
    assert.ok(svg.includes('role="img"'));
    assert.ok(svg.includes(`aria-label="${t.name} rank badge"`));
    const inner = svg.slice(svg.indexOf('>') + 1, -'</svg>'.length);
    assert.match(inner, /^(<rect [^<>]*\/>)+$/);
    assert.ok(!/<(?!rect |\/svg|svg )/.test(inner));
  }
});

test('badges grow in grandeur: each rank has more pixels than the one below', () => {
  const area = (id) => BADGES[id].rows.join('').replace(/[.L]/g, '').length;
  for (let i = 1; i < TIERS.length; i++) assert.ok(area(TIERS[i].id) > area(TIERS[i - 1].id), TIERS[i].id);
});

test('unknown tier id falls back to iron', () => {
  assert.equal(badgeSvg('nope'), badgeSvg('iron'));
  assert.equal(badgeSvg(undefined, 32), badgeSvg('iron', 32));
  assert.match(badgeSvg('nope'), /aria-label="Iron rank badge"/);
});
