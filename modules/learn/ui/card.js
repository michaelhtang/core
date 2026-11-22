import { h } from '/ui.js?v=__V__';
import { ensureCss, picture } from '/m/learn/figures.js?v=__V__';

// The home card (homeCards hook, declared lead: true so it comes first). Small and read from /api/me: no request of its own.
const streakLine = (d) => { const n = d.daily?.streak ?? 0; return h('p', { class: `small ln-streakline${d.daily && !d.daily.kept_today ? ' at-risk' : ''}` }, d.daily?.kept_today ? `${n} day streak` : n > 0 ? `Keep your streak: ${n} day${n === 1 ? '' : 's'}` : 'Keep your streak: finish a level today'); };

export function renderCard(el, ctx) {
  ensureCss();
  const draw = () => {
    const d = ctx.card.data;
    const go = () => { location.hash = '#learn'; };
    if (!d.next) {
      el.replaceChildren(h('div', { class: 'ln-homecard' }, h('img', { class: 'ln-wolf', src: '/art/wolf.png?v=__V__', alt: '' }),
        h('div', {}, h('p', {}, d.levels_total && d.levels_done >= d.levels_total ? 'You have finished every level on the road for now. More are coming.' : 'There is nothing open on the road yet.'),
          streakLine(d), h('button', { type: 'button', class: 'ghost', onclick: go }, 'Open the Learning Road'))));
      return;
    }
    const pct = d.unit_total ? Math.round((100 * d.unit_done) / d.unit_total) : 0;
    el.replaceChildren(h('div', { class: 'ln-homecard' }, h('img', { class: 'ln-wolf', src: '/art/wolf.png?v=__V__', alt: '' }),
      h('div', { class: 'stack' },
        h('p', { class: 'label' }, `${d.next.section_title} · ${d.next.unit_title}`),
        h('p', { class: 'ln-next' }, `Next: ${d.next.title}`),
        h('div', { class: 'ln-unitbar', role: 'img', 'aria-label': `${d.unit_done} of ${d.unit_total} levels done in this unit` }, h('div', { class: `ln-bar-fill ln-w${Math.round(pct / 5) * 5}` })),
        h('p', { class: 'muted small' }, `${d.unit_done} of ${d.unit_total} levels done in this unit`),
        streakLine(d),
        h('button', { type: 'button', class: 'ln-big', onclick: go }, d.unit_done ? 'Continue' : 'Start')),
      d.image ? picture(d.image, 'ln-thumb') : ''));
  };
  draw();
  ctx.onRefresh(draw);
}
