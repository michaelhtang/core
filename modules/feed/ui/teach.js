import { h, api } from '/ui.js?v=__V__';

// Teacher panel for the feed: what your classes and the town have been up to, newest first, with a class filter. Only classes you read (and the town) are
// listed. The filter is built once, so a live refresh (any module event) redraws the list without touching what you chose.
export async function render(el, ctx) {
  if (!document.querySelector('link[data-feed]')) document.head.append(h('link', { rel: 'stylesheet', href: '/m/feed/feed.css?v=__V__', 'data-feed': '' }));
  const msg = h('p', { role: 'status' });
  const list = h('div', { class: 'stack' });
  const pick = h('select', { 'aria-label': 'Show one class' }, h('option', { value: '' }, 'All my classes'));
  let known = '';

  async function load() {
    const v = await api(`/api/feed/teach${pick.value ? `?class_id=${encodeURIComponent(pick.value)}` : ''}`);
    const ids = v.classes.map((c) => c.id).join();
    if (ids !== known) {
      const keep = pick.value;
      known = ids;
      pick.replaceChildren(h('option', { value: '' }, 'All my classes'), ...v.classes.map((c) => h('option', { value: String(c.id) }, c.name)));
      pick.value = v.classes.some((c) => String(c.id) === keep) ? keep : '';
    }
    const name = new Map(v.classes.map((c) => [c.id, c.name]));
    list.replaceChildren(v.items.length
      ? h('div', { class: 'table-wrap' }, h('table', {},
        h('thead', {}, h('tr', {}, h('th', {}, 'Month'), h('th', {}, 'Where'), h('th', {}, 'What'))),
        h('tbody', {}, v.items.map((i) => h('tr', {}, h('td', {}, String(i.month)), h('td', {}, i.town ? 'Town' : name.get(i.class_id) ?? ''), h('td', { class: 'fd-wrap' }, i.text))))))
      : h('p', { class: 'muted' }, 'Nothing yet. Items appear as students take jobs, move, buy and trade, and as rates and town events change.'));
  }

  pick.addEventListener('change', () => load().catch((e) => { msg.className = 'error'; msg.textContent = e.message; }));
  el.append(h('h2', {}, 'Around town'), h('div', { class: 'row' }, h('label', {}, 'Class ', pick)), list, msg);
  ctx?.onRefresh(() => load().catch(() => {}));
  await load();
}
