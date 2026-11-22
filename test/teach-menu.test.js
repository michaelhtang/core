// The teacher console menu (public/teach-menu.js): every teacher panel of every module is reachable from exactly one menu item.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { menuOf, viewOf } from '../public/teach-menu.js';

const dir = new URL('../modules/', import.meta.url);
const panels = [];
for (const id of fs.readdirSync(dir)) {
  if (!fs.existsSync(new URL(`${id}/index.js`, dir))) continue;
  const def = (await import(new URL(`${id}/index.js`, dir))).default;
  for (const p of def.teacherPanels ?? []) panels.push({ module: def.id, id: p.id, title: p.title });
}

test('every module teacher panel, and one from a module the menu has never heard of, is in the menu exactly once', () => {
  assert.ok(panels.length >= 15, `found ${panels.length} teacher panels`);
  const all = [...panels, { module: 'brand-new', id: 'x-teach', title: 'Brand new' }];
  const menu = menuOf(all);
  const ids = menu.flatMap((g) => g.items.map((i) => i.id));
  assert.equal(new Set(ids).size, ids.length, 'no view is listed twice');
  for (const p of all) assert.equal(ids.filter((id) => id === `${p.module}/${p.id}`).length, 1, `${p.module}/${p.id}`);
  assert.deepEqual(menu.find((g) => g.group === 'Other').items, [{ id: 'brand-new/x-teach', title: 'Brand new' }]);
  assert.equal(menu[0].items[0].id, 'dashboard');
  assert.ok(menu.every((g) => g.items.length), 'no empty group');
  assert.ok(!menuOf([]).some((g) => g.fold), 'with no module panels only the core views are left');
});

test('a hash names a view of this menu, or falls back to the dashboard', () => {
  const menu = menuOf(panels);
  assert.equal(viewOf('#/classes', menu), 'classes');
  assert.equal(viewOf('#/learn/learn-teach', menu), 'learn/learn-teach');
  // none of these is a view of a teacher who has no module panels
  for (const h of ['', '#', '#/', '#/nope', '#cards', '#/learn/learn-teach', '#/account/x']) assert.equal(viewOf(h, menuOf([])), 'dashboard', h);
});
