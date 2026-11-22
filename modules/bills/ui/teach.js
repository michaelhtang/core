import { h, api, fmt } from '/ui.js?v=__V__';

// Teacher panel for bills: per class, who has paid, who is late, who is on autopay. Redrawn on refresh (it has no inputs).
export async function render(el, ctx) {
  const box = h('div', { class: 'stack' });
  const msg = h('p', { role: 'status' });
  async function load() {
    const { month, classes } = await api('/api/bills/overview');
    box.replaceChildren(...(classes.length ? classes.map((c) => h('div', { class: 'class-card' },
      h('p', {}, h('strong', {}, c.name), ` · month ${month} · ${c.students.filter((s) => s.autopay).length} of ${c.students.length} on autopay · ${c.students.filter((s) => s.late).length} late`),
      c.students.length ? h('div', { class: 'table-wrap' }, h('table', {},
        h('thead', {}, h('tr', {}, ['Student', 'Status', 'Unpaid', 'Owed', 'Autopay', 'Late ever'].map((t, i) => h('th', { class: i === 3 ? 'num' : '' }, t)))),
        h('tbody', {}, c.students.map((s) => h('tr', {},
          h('td', {}, s.username),
          h('td', {}, s.late ? h('span', { class: 'error' }, 'Late') : s.open ? 'Bills due' : 'Paid up'),
          h('td', {}, String(s.open)), h('td', { class: 'num' }, fmt(s.owed_cents)), h('td', {}, s.autopay ? 'On' : 'Off'), h('td', {}, String(s.late_ever))))))) : h('p', { class: 'muted' }, 'No students yet.'))) : [h('p', { class: 'muted' }, 'Create a class first.')]));
  }
  el.append(h('div', { class: 'spread' }, h('h2', {}, 'Bills'), h('button', { class: 'ghost', type: 'button', onclick: () => load().catch((e) => { msg.className = 'error'; msg.textContent = e.message; }) }, 'Refresh')), box, msg);
  ctx?.onRefresh(() => load().catch(() => {}));
  await load();
}
