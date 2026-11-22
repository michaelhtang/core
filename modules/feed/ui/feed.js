import { h } from '/ui.js?v=__V__';

// The "Around town" card (the homeCards hook): the newest things classmates and the town did, yours first. ctx.card.data comes with /api/me, so a live update
// (which runs the onRefresh callbacks) redraws it. Text is set with textContent only; usernames are pseudonyms.
export function renderCard(el, ctx) {
  if (!document.querySelector('link[data-feed]')) document.head.append(h('link', { rel: 'stylesheet', href: '/m/feed/feed.css?v=__V__', 'data-feed': '' }));
  function paint() {
    const items = ctx.card.data?.items ?? [];
    el.replaceChildren(items.length
      ? h('ul', { class: 'fd-list', 'aria-label': 'Recent news around town' }, items.map((i) => h('li', { class: `fd-row${i.mine ? ' fd-mine' : ''}`, ...(i.mine ? { title: 'This one is yours' } : {}) },
        h('span', { class: 'chip', title: 'World month' }, `M${i.month}`), h('span', { class: 'fd-text' }, i.text))))
      : h('p', { class: 'muted small' }, 'Nothing yet. News appears here when classmates take jobs, buy homes or open cards, and when the town changes.'));
  }
  paint();
  ctx.onRefresh(paint);
}
