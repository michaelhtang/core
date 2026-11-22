import { h, api, fmt } from '/ui.js?v=__V__';

// Teacher panel for Outfitters: per class, spending on wants vs needs, items sold back, achievement counts and class-goal progress;
// the world teacher can open or close the store for everyone.
export async function render(el, ctx) {
  const msg = h('p', { role: 'status' });
  const head = h('div', { class: 'spread' });
  const box = h('div', { class: 'stack' });
  const say = (text, bad) => { msg.className = bad ? 'error' : 'ok'; msg.textContent = text; };
  async function load() {
    const v = await api('/api/outfitters/overview');
    head.replaceChildren(h('p', {}, `The store is ${v.open ? 'open' : 'closed'} for the whole world. `, h('span', { class: 'muted' }, `World month ${v.month}.`)),
      v.can_toggle ? h('button', { type: 'button', class: v.open ? 'ghost' : '', onclick: async () => { try { await api('/api/outfitters/store', { open: !v.open }); say(v.open ? 'Store closed.' : 'Store open.'); } catch (e) { say(e.message, true); } await load(); } }, v.open ? 'Close the store' : 'Open the store')
        : h('span', { class: 'muted small' }, 'Only the world teacher can open or close it.'));
    box.replaceChildren(...(v.classes.length ? v.classes.map((c) => h('div', { class: 'class-card' },
      h('p', {}, h('strong', {}, c.name), ` · ${c.students} students`, c.outfit ? ` · outfit: ${c.outfit.name}` : ' · plain wolf'),
      h('div', { class: 'stats' },
        h('div', { class: 'stat' }, 'Needs bought', h('b', {}, fmt(c.needs.cents)), `${c.needs.items} items`),
        h('div', { class: 'stat' }, 'Wants bought', h('b', {}, fmt(c.wants.cents)), `${c.wants.items} items`),
        h('div', { class: 'stat' }, 'Sold back', h('b', {}, fmt(c.sold.cents)), `${c.sold.items} items`)),
      h('p', { class: 'label' }, 'Class goals'),
      h('ul', { class: 'small' }, c.goals.map((g) => h('li', {}, `${g.name}: ${g.unlocked ? `unlocked in month ${g.unlocked_month} (${g.outfit_name})` : g.key === 'credit' ? `${g.pct}% have a score${g.median ? `, median ${g.median}` : ''} (needs 80% and median 700)` : `${g.pct}% on time (needs 80%)`}`))),
      h('p', { class: 'label' }, 'Achievements unlocked'),
      h('p', { class: 'small' }, c.achievements.map((a) => `${a.name}: ${a.count}`).join(' · ')))) : [h('p', { class: 'muted' }, 'No classes yet.')]));
  }
  el.append(h('h2', {}, 'Outfitters'), head, msg, box);
  ctx?.onRefresh(() => load().catch(() => {}));
  await load();
}
