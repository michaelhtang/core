import { h, api, fmt } from '/ui.js?v=__V__';

// Teacher panel for Stress: per class, each student's stress score, level and emergency loan (what is left). Your own classes only.
export async function render(el, ctx) {
  const box = h('div', { class: 'stack' });
  const msg = h('p', { role: 'status' });
  async function load() {
    const { month, classes } = await api('/api/stress/teach');
    box.replaceChildren(...(classes.length ? classes.map((c) => h('div', { class: 'class-card' },
      h('p', {}, h('strong', {}, c.name), ` · month ${month} · ${c.students.filter((s) => s.loan_left_cents != null).length} emergency loan(s) · ${c.students.filter((s) => s.level === 'Crisis').length} in crisis`),
      c.students.length ? h('div', { class: 'table-wrap' }, h('table', { 'aria-label': `${c.name}: stress` },
        h('thead', {}, h('tr', {}, h('th', {}, 'Student'), h('th', { class: 'num' }, 'Score'), h('th', {}, 'Level'), h('th', { class: 'num' }, 'Loan left'))),
        h('tbody', {}, c.students.map((s) => h('tr', {},
          h('td', {}, s.username), h('td', { class: 'num' }, String(s.score)), h('td', {}, s.level === 'Crisis' ? h('span', { class: 'error' }, s.level) : s.level),
          h('td', { class: 'num' }, s.loan_left_cents == null ? '–' : `${fmt(s.loan_left_cents)}${s.loan_missed ? ` (${s.loan_missed} missed)` : ''}`)))))) : h('p', { class: 'muted' }, 'No students yet.'))) : [h('p', { class: 'muted' }, 'Create a class first.')]));
  }
  el.append(h('div', { class: 'spread' }, h('h2', {}, 'Stress'), h('button', { class: 'ghost', type: 'button', onclick: () => load().catch((e) => { msg.className = 'error'; msg.textContent = e.message; }) }, 'Refresh')),
    h('p', { class: 'muted small' }, 'Stress rises with no job, late bills and missed housing or loan payments, and falls in calm months. At 80 the bank makes an automatic emergency loan; a student may ask for one from 50.'), box, msg);
  ctx?.onRefresh(() => load().catch(() => {}));
  await load();
}
