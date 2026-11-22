import { h, api } from '/ui.js?v=__V__';
import { tierChip, delta, hallView, classesView, flagList } from '/m/leaderboards/leaderboards.js?v=__V__';

// Teacher panel for the Amphitheatre: every board of your classes, the town board (pseudonyms only), award leaders, the amounts and freeze switches.
const whole = (c) => (c / 100).toLocaleString('en-CA', { style: 'currency', currency: 'CAD', maximumFractionDigits: 0 });
const TIERS = ['Pup', 'Scout', 'Hunter', 'Pack Leader', 'Alpha'];

export async function render(el, ctx) {
  if (!document.querySelector('link[data-lb]')) document.head.append(h('link', { rel: 'stylesheet', href: '/m/leaderboards/leaderboards.css?v=__V__', 'data-lb': '' }));
  const msg = h('p', { role: 'status' }), box = h('div', { class: 'stack' });
  const say = (text, bad) => { msg.className = bad ? 'error' : 'ok'; msg.textContent = text; };
  const act = (fn) => async () => { try { await fn(); await load(); } catch (e) { say(e.message, true); } };

  // Pattern flags for a debrief: fetched on demand (live, the same rules the season close stores).
  const flagsBox = (c) => {
    const out = h('div', { class: 'stack' });
    const show = async () => {
      let f;
      try { f = await api(`/api/leaderboards/flags?class_id=${encodeURIComponent(c.id)}`); } catch (e) { say(e.message, true); return; }
      const rows = f.students.filter((s) => s.flags.length);
      out.replaceChildren(rows.length ? h('div', { class: 'table-wrap' }, h('table', { 'aria-label': `${c.name}: pattern flags` },
        h('thead', {}, h('tr', {}, h('th', {}, 'Student'), h('th', {}, 'What the numbers say'))),
        h('tbody', {}, rows.map((s) => h('tr', {}, h('td', {}, s.username), h('td', {}, flagList(s.flags))))))) : h('p', { class: 'muted' }, 'No pattern flags for this class yet.'));
    };
    return h('div', {}, h('button', { class: 'ghost', type: 'button', 'aria-label': `Show pattern flags for ${c.name}`, onclick: () => show() }, 'Pattern flags'), out);
  };
  const classList = (c) => h('div', { class: 'class-card' }, h('b', {}, c.name), flagsBox(c),
    c.rows.length ? h('div', { class: 'lb-wide' }, h('ol', { class: 'lb-list' },
      h('li', { class: 'lb-row' }, ...['Rank', 'Pseudonym', 'Wolf rank', 'Change', 'Net worth', 'Health'].map((t) => h('b', { class: 'muted small' }, t))),
      c.rows.map((r) => h('li', { class: 'lb-row' }, h('span', { class: 'lb-rank' }, `#${r.rank}`), h('b', {}, r.name), tierChip(r.tier, TIERS), delta(r.delta),
        h('span', { class: 'lb-val' }, whole(r.net_worth_cents)), h('span', { class: 'lb-val' }, `${r.health} (#${r.health_rank})`))))) : h('p', { class: 'muted' }, 'No snapshot for this class yet.'));

  async function load() {
    const v = await api('/api/leaderboards/teach');
    box.replaceChildren(...[
      h('div', { class: 'row' },
        h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: v.hidden, disabled: !v.can_set, onchange: (e) => act(() => api('/api/leaderboards/hide', { hide_amounts: e.currentTarget.checked }))() }), 'Hide dollar amounts from students'),
        h('button', { class: 'ghost', type: 'button', disabled: !v.can_set, onclick: act(() => api('/api/leaderboards/freeze', { freeze: !v.frozen })) }, v.frozen ? 'Unfreeze boards' : 'Freeze boards (test week)')),
      v.can_set ? null : h('p', { class: 'muted small' }, 'Only the world teacher can change these.'),
      v.frozen ? h('p', { class: 'muted' }, `Boards are frozen at world month ${v.month}. Students see that snapshot until you unfreeze.`) : null,
      v.month == null ? h('p', { class: 'muted' }, 'The boards start after the first world month.') : h('p', { class: 'muted small' }, `Snapshot of world month ${v.month}. Amounts are rounded to $1,000.`),
      v.leaders.length ? h('div', { class: 'lb-card' }, h('h3', {}, 'Award leaders now'), h('div', { class: 'lb-awards' }, v.leaders.map((a) => h('div', { class: 'lb-award' },
        h('b', {}, a.title), h('span', {}, a.name ?? a.class_name ?? ''), h('small', { class: 'lb-note' }, a.award === 'wolf' || a.award === 'founder' ? `${whole(a.value)} ${a.unit}` : `${a.value} ${a.unit}`))))) : null,
      v.classes.map(classList),
      v.town.length ? h('div', { class: 'class-card' }, h('b', {}, 'Town top 10 (pseudonyms only)'), h('ol', { class: 'lb-list' }, v.town.map((r) => h('li', { class: 'lb-row' },
        h('span', { class: 'lb-rank' }, `#${r.rank}`), h('span', { class: 'lb-who' }, h('b', {}, r.name), tierChip(r.tier, TIERS)), delta(r.delta), h('span', {}))))) : null,
      v.class_table.length ? h('div', { class: 'class-card' }, h('b', {}, 'Class vs class'), classesView(v.class_table)) : null,
      v.hall.length ? h('div', { class: 'class-card' }, h('b', {}, 'Hall of Fame'), hallView(v.hall)) : null].flat().filter(Boolean));
  }

  el.append(h('h2', {}, 'Amphitheatre'),
    h('p', { class: 'muted small' }, 'Boards rank net worth and financial health from the last world month. Students see only ranks, Wolf ranks, health and amounts rounded to $1,000.'),
    box, msg);
  ctx?.onRefresh(() => load().catch(() => {}));
  await load();
}
