import { h, api, fmt } from '/ui.js?v=__V__';

// Teacher panel for savings: class totals, the average savings rate, and the HISA rate lever (world teacher only).
export async function render(el, ctx) {
  const msg = h('p', { role: 'status' });
  const box = h('div', { class: 'table-wrap' });
  const rateBox = h('div', { class: 'stack' });
  const say = (text, bad) => { msg.className = bad ? 'error' : 'ok'; msg.textContent = text; };
  const input = h('input', { inputmode: 'decimal', 'aria-label': 'HISA rate (percent a year)' });
  let shownRate = null;

  async function load() {
    const v = await api('/api/savings/teach');
    if (shownRate !== v.hisa_rate_bp) { shownRate = v.hisa_rate_bp; input.value = (v.hisa_rate_bp / 100).toFixed(2); }
    rateBox.replaceChildren(
      h('p', { class: 'label' }, 'HISA rate (the policy rate)'),
      v.rates_managed ? h('p', { class: 'muted' }, `The HISA rate is ${(v.hisa_rate_bp / 100).toFixed(2)}% and follows the Bank of DAA policy rate. Change it in the Bank of DAA panel.`) : h('div', { class: 'row' },
        h('label', { class: 'grow' }, 'Percent a year', input),
        v.can_set_rate ? h('button', { type: 'button', onclick: async () => {
          const pctValue = Number(input.value);
          const bp = Math.round(pctValue * 100);
          if (!/^\d{1,2}(\.\d{1,2})?$/.test(input.value.trim()) || bp > v.max_rate_bp) return say(`Enter a rate from 0 to ${v.max_rate_bp / 100}, like 2.75`, true);
          try { const r = await api('/api/savings/rate', { hisa_bp: bp }); say(`Saved. It applies from world month ${r.applies_from_month}.`); await load(); } catch (e) { say(e.message, true); }
        } }, 'Save rate') : h('p', { class: 'muted' }, 'Only the world teacher can change it.')));
    box.replaceChildren(v.classes.length ? h('table', {},
      h('thead', {}, h('tr', {}, h('th', {}, 'Class'), h('th', { class: 'num' }, 'Total savings'), h('th', { class: 'num' }, 'Saved'), h('th', { class: 'num' }, 'Net pay'), h('th', { class: 'num' }, 'Savings rate'))),
      h('tbody', {}, v.classes.map((c) => h('tr', {}, h('td', {}, c.name), h('td', { class: 'num' }, fmt(c.total_savings_cents)), h('td', { class: 'num' }, fmt(c.saved_cents)),
        h('td', { class: 'num' }, fmt(c.net_pay_cents)), h('td', { class: 'num' }, c.savings_rate === null ? 'No pay yet' : `${(c.savings_rate * 100).toFixed(1)}%`))))) : h('p', { class: 'muted' }, 'Create a class first.'));
  }

  el.append(
    h('h2', {}, 'Savings'),
    h('p', { class: 'muted small' }, 'Total savings is HISA plus GIC principal. Savings rate is money put into HISA and GICs divided by net pay, since the season began. A new rate applies from the next world month.'),
    box, rateBox, msg);
  ctx?.onRefresh(() => load().catch(() => {}));
  await load();
}
