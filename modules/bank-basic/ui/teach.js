import { h, api, fmt, dollarsToCents, when, confirmAction } from '/ui.js?v=__V__';

// Teacher panel for bank-basic: per-class switch and limits for student-to-student transfers, and the transfers feed with Reverse.
// Rendered once; ctx.onRefresh keeps the feed live. The settings rows are rebuilt only when the saved values change, so
// half-typed limits survive a refresh.
export async function render(el, ctx) {
  const msg = h('p', { role: 'status' });
  const settingsBox = h('div', { class: 'stack' });
  const feedBox = h('div', { class: 'table-wrap' });
  let first = [], older = [], olderNext = null;   // the newest page (reloaded on every refresh) and the older pages fetched with "Older" (kept)
  let firstNext = null;
  const say = (text, bad) => { msg.className = bad ? 'error' : 'ok'; msg.textContent = text; };
  const cents = (v) => (v / 100).toFixed(2);

  let shown = null;
  async function load() {
    const [{ classes }, page] = await Promise.all([api('/api/bank-basic/settings'), api('/api/bank-basic/transfers')]);
    first = page.transfers; firstNext = page.next ?? null;
    const key = JSON.stringify(classes);
    if (key !== shown) {
      shown = key;
      settingsBox.replaceChildren(...(classes.length ? classes.map(classRow) : [h('p', { class: 'muted' }, 'Create a class first.')]));
    }
    drawFeed();
  }

  // The newest page plus any older pages; a refresh can shift the newest page onto rows already fetched, so ids are de-duplicated.
  function drawFeed() {
    const seen = new Set(first.map((r) => r.id));
    const rows = [...first, ...older.filter((r) => !seen.has(r.id))];
    const next = older.length ? olderNext : firstNext;
    // replaceChildren() would print a null as the text "null", so the Older button is added only when there is one.
    feedBox.replaceChildren(rows.length ? feed(rows) : h('p', { class: 'muted' }, 'No transfers yet.'));
    if (next) feedBox.append(h('button', { class: 'ghost', type: 'button', onclick: async () => {
      try { const page = await api(`/api/bank-basic/transfers?before=${next}`); older.push(...page.transfers); olderNext = page.next ?? null; drawFeed(); } catch (e) { say(e.message, true); }
    } }, 'Older'));
  }

  function classRow(c) {
    const on = h('input', { type: 'checkbox', checked: !!c.transfers_enabled });
    const per = h('input', { value: cents(c.per_transfer_cents), inputmode: 'decimal' });
    const daily = h('input', { value: cents(c.daily_cents), inputmode: 'decimal' });
    return h('div', { class: 'class-card' },
      h('label', { class: 'check' }, on, h('strong', {}, `${c.name}: let students send money to each other`)),
      h('div', { class: 'row' },
        h('label', { class: 'grow' }, 'Limit per transfer ($)', per),
        h('label', { class: 'grow' }, 'Limit per 24 hours ($)', daily),
        h('button', { type: 'button', onclick: async () => {
          const p = dollarsToCents(per.value), d = dollarsToCents(daily.value);
          if (!p || !d) return say('Enter the limits as dollars, like 50 or 12.50', true);
          try { await api('/api/bank-basic/settings', { class_id: c.id, enabled: on.checked, per_transfer_cents: p, daily_cents: d }); say(`Saved for ${c.name}.`); await load(); } catch (e) { say(e.message, true); }
        } }, 'Save')));
  }

  function feed(rows) {
    return h('table', {},
      h('thead', {}, h('tr', {}, ['When', 'Class', 'From', 'To', 'Amount', ''].map((t, i) => h('th', { class: i === 4 ? 'num' : '' }, t)))),
      h('tbody', {}, rows.map((r) => h('tr', {},
        h('td', {}, when(r.created)), h('td', {}, r.class_name || ''), h('td', {}, r.from_name), h('td', {}, r.to_name),
        h('td', { class: 'num' }, fmt(r.cents)),
        h('td', {}, r.reversed ? h('span', { class: 'muted' }, 'Reversed') : h('button', { class: 'danger', type: 'button', onclick: async () => {
          if (!confirmAction(`Reverse this transfer? ${r.from_name} sent ${fmt(r.cents)} to ${r.to_name} (${r.class_name || 'class'}, ${when(r.created)}). The money goes back.`)) return;
          try { await api(`/api/bank-basic/transfers/${r.id}/reverse`, {}); r.reversed = 1; say('Reversed. The money went back.'); } catch (e) { say(e.message, true); }
          await load();
        } }, 'Reverse'))))));
  }

  el.append(
    h('div', { class: 'spread' }, h('h2', {}, 'Bank: transfers'), h('button', { class: 'ghost', type: 'button', onclick: () => load().catch((e) => say(e.message, true)) }, 'Refresh')),
    h('p', { class: 'muted small' }, 'Transfers are off by default. When on, they stay inside one class, and every one is logged. Reverse posts an opposite entry; nothing is ever deleted.'),
    settingsBox, msg,
    h('p', { class: 'label' }, 'Transfers'), feedBox);
  ctx?.onRefresh(() => load().catch(() => {}));
  await load();
}
