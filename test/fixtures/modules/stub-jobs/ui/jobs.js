import { h, api } from '/ui.js?v=__V__';

export async function render(el, ctx) {
  const { offers } = await api('/api/stub-jobs/offers');
  el.append(h('h2', {}, 'Job Centre'), h('ul', {}, offers.map((o) => h('li', {}, o.title))));
  ctx.on('month', () => {});
}
