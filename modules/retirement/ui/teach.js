import { h, api, fmt } from '/ui.js?v=__V__';

// Teacher panel for Retirement (docs/phase5-life.md 5c): who is short in Stage C, per class (your own classes only). Each row is the student's latest live
// check, written in the month's tick: income after tax against bills, coverage, and the age the projection says their savings last until. Short first.
export async function render(el, ctx) {
  const box = h('div', { class: 'stack' }), msg = h('p', { role: 'status' });
  async function load() {
    const v = await api('/api/retirement/teach');
    if (!v.world) { box.replaceChildren(h('p', { class: 'muted' }, 'No world yet.')); return; }
    box.replaceChildren(
      h('p', {}, `World month ${v.world.month}, age ${v.age}. `, v.stage_c ? `Short = bills not covered, or savings projected to run out before ${v.short_before}.` : 'Retirement checks start in Stage C (age 55).'),
      ...v.classes.map((cl) => {
        const short = cl.students.filter((s) => s.short).length;
        return h('div', { class: 'class-card' }, h('b', {}, `${cl.name}: ${short} short`),
          cl.students.length ? h('div', { class: 'table-wrap' }, h('table', {},
            h('thead', {}, h('tr', {}, h('th', {}, 'Student'), h('th', { class: 'num' }, 'Income'), h('th', { class: 'num' }, 'Bills'), h('th', { class: 'num' }, 'Coverage'), h('th', { class: 'num' }, 'Short by'), h('th', { class: 'num' }, 'Lasts to'), h('th', { class: 'num' }, 'CPP at'), h('th', {}, 'RRIF'))),
            h('tbody', {}, cl.students.map((s) => h('tr', {}, h('td', {}, s.short ? h('strong', { class: 'error' }, s.username) : s.username),
              ...(s.checked ? [h('td', { class: 'num' }, fmt(s.income_cents)), h('td', { class: 'num' }, fmt(s.bills_cents)), h('td', { class: 'num' }, `${s.coverage_pct}%`),
                h('td', { class: 'num' }, s.shortfall_cents ? fmt(s.shortfall_cents) : ''), h('td', { class: 'num' }, s.lasts_age >= 100 ? '100+' : String(s.lasts_age))]
                : [h('td', { class: 'muted', colspan: '5' }, 'Not checked yet')]),
              h('td', { class: 'num' }, String(s.cpp_age)), h('td', {}, s.rrif ? 'Yes' : '')))))) : h('p', { class: 'muted' }, 'No students yet.'));
      }),
    );
  }
  el.append(h('h2', {}, 'Retirement'), box, msg);
  ctx?.onRefresh(() => load().catch((e) => { msg.textContent = e.message; }));
  await load();
}
