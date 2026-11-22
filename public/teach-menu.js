// The teacher console's menu: which views there are and the heading each sits under. No DOM here, so test/teach-menu.test.js can read it.
// A view is one screen of the console. The core views are fixed; every module teacher panel is a view of its own, named
// "<module>/<panel id>" (a core view has no slash, so the two can never collide).

// Which heading a module's panels sit under. A module that is not listed lands under "Other", so a new module is never unreachable.
const MODULE_GROUP = {
  learn: 'Lessons',
  'bank-basic': 'Money', savings: 'Money', credit: 'Money', retirement: 'Money', exchange: 'Money', rates: 'Money',
  today: 'Town life', jobs: 'Town life', bills: 'Town life', housing: 'Town life', insurance: 'Town life', life: 'Town life', stress: 'Town life', outfitters: 'Town life', ventures: 'Town life',
  arcade: 'Community', walk: 'Community', feed: 'Community', leaderboards: 'Community',
};
const FOLDED = ['Money', 'Town life', 'Community', 'Other'];   // long lists: closed in the rail until opened

// panels: me.teacherPanels ([{ module, id, title }]). Returns [{ group, fold, items: [{ id, title }] }] in menu order, empty groups left out.
export function menuOf(panels) {
  const by = new Map(['Lessons', ...FOLDED].map((g) => [g, []]));
  for (const p of panels) by.get(MODULE_GROUP[p.module] ?? 'Other').push({ id: `${p.module}/${p.id}`, title: p.title });
  const group = (name) => ({ group: name, fold: FOLDED.includes(name), items: by.get(name) });
  return [
    { group: null, fold: false, items: [{ id: 'dashboard', title: 'Dashboard' }] },
    { group: 'Class', fold: false, items: [{ id: 'classes', title: 'Classes and PINs' }, { id: 'logins', title: 'Login trouble' }] },
    group('Lessons'),
    { group: 'World', fold: false, items: [{ id: 'world', title: 'Clock and season' }] },
    ...FOLDED.map(group),
    { group: 'Records', fold: false, items: [{ id: 'audit', title: 'Ledger audit' }, { id: 'log', title: 'Activity log' }] },
    { group: 'Account', fold: false, items: [{ id: 'account', title: 'Account' }] },
  ].filter((g) => g.items.length);
}

// The view a URL hash names ("#/classes"), or the dashboard when it names none of this teacher's views.
export function viewOf(hash, menu) {
  const id = String(hash).replace(/^#\/?/, '');
  return menu.some((g) => g.items.some((i) => i.id === id)) ? id : 'dashboard';
}
