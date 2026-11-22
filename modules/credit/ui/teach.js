import { h, api, fmt } from '/ui.js?v=__V__';

// Teacher panel for credit: per class, how scores are spread, who holds a card, how much of their limit they use, and who has paid late.
export async function render(el, ctx) {
  const box = h('div', { class: 'stack' });
  const pct = (x) => (x === null ? 'No cards' : `${Math.round(x * 100)}%`);

  async function load() {
    const v = await api('/api/credit/teach');
    box.replaceChildren(...(v.classes.length ? v.classes.map((c) => h('div', { class: 'stack' },
      h('p', { class: 'label' }, c.name),
      h('p', { class: 'small' }, `${c.card_holders} of ${c.students.length} have a card. Average use of limit: ${pct(c.avg_utilization)}. ${c.late_students} student${c.late_students === 1 ? '' : 's'} with a late payment in the last 6 months (${c.late_marks} mark${c.late_marks === 1 ? '' : 's'}).`),
      h('div', { class: 'table-wrap' }, h('table', {},
        h('thead', {}, h('tr', {}, c.distribution.map((d) => h('th', { class: 'num' }, d.band)))),
        h('tbody', {}, h('tr', {}, c.distribution.map((d) => h('td', { class: 'num' }, String(d.count))))))),
      h('div', { class: 'table-wrap' }, h('table', {},
        h('thead', {}, h('tr', {}, h('th', {}, 'Student'), h('th', { class: 'num' }, 'Score'), h('th', {}, 'Band'), h('th', { class: 'num' }, 'Limit'), h('th', { class: 'num' }, 'Owed'), h('th', { class: 'num' }, 'Use'), h('th', { class: 'num' }, 'Late (6 mo)'))),
        h('tbody', {}, c.students.map((s) => h('tr', {}, h('td', {}, s.username), h('td', { class: 'num' }, s.score === null ? 'No file' : String(s.score)), h('td', {}, s.band ?? ''),
          h('td', { class: 'num' }, s.card ? fmt(s.limit_cents) : ''), h('td', { class: 'num' }, s.card ? fmt(s.owed_cents) : ''), h('td', { class: 'num' }, s.card ? pct(s.utilization) : ''), h('td', { class: 'num' }, String(s.late_6m))))))))) : [h('p', { class: 'muted' }, 'Create a class first.')]));
  }

  el.append(h('h2', {}, 'Credit'),
    h('p', { class: 'muted small' }, 'Scores run 300 to 900 and appear once a student has a card. Bands: Poor under 600, Fair 600 to 649, Good 650 to 699, Very good 700 to 749, Excellent 750 and up.'),
    box);
  ctx?.onRefresh(() => load().catch(() => {}));
  await load();
}
