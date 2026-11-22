import { h, api } from '/ui.js?v=__V__';

// Teacher panel for rates: the current rates, the policy rate lever (world teacher only), and the history.
export async function render(el, ctx) {
  const msg = h('p', { role: 'status' });
  const info = h('div', { class: 'stack' });
  const history = h('div', { class: 'table-wrap' });
  const say = (text, bad) => { msg.className = bad ? 'error' : 'ok'; msg.textContent = text; };
  const pct = (bp) => `${(bp / 100).toFixed(2)}%`;
  const input = h('input', { inputmode: 'decimal', 'aria-label': 'Policy rate (percent a year)' });
  const inflInput = h('input', { inputmode: 'decimal', 'aria-label': 'Inflation (percent a year)' });
  let shown = null, shownInfl = null, last = '';

  async function load() {
    const v = await api('/api/rates/current');
    const key = JSON.stringify(v);
    if (key === last) return;                               // nothing changed: leave the form (and a half-typed rate) alone
    last = key;
    if (shown !== v.policy_bp) { shown = v.policy_bp; input.value = (v.policy_bp / 100).toFixed(2); }
    if (shownInfl !== v.inflation_bp) { shownInfl = v.inflation_bp; inflInput.value = (v.inflation_bp / 100).toFixed(2); }
    info.replaceChildren(
      h('p', {}, `Policy rate ${pct(v.policy_bp)}. HISA ${pct(v.hisa_bp)}, prime ${pct(v.prime_bp)}, 5-year fixed ${pct(v.mortgage5y_bp)}, line of credit ${pct(v.loc_bp)}, card ${pct(v.card_apr_bp)}.`),
      h('p', { class: 'muted' }, v.pending_bp === null ? `Next scheduled announcement: world month ${v.next_announcement_month}.` : `Queued: ${pct(v.pending_bp)} from world month ${v.pending_from_month}. Until then the bond fund (DAAB) and the balanced fund (DAAG) are paused on the Exchange. Announce ${pct(v.policy_bp)} again to cancel it. Next scheduled announcement: month ${v.next_announcement_month}.`),
      v.can_set ? h('div', { class: 'row' },
        h('label', { class: 'grow' }, 'New policy rate (percent a year)', input),
        h('button', { type: 'button', onclick: async () => {
          const bp = Math.round(Number(input.value) * 100);
          if (!/^\d{1,2}(\.\d{1,2})?$/.test(input.value.trim()) || bp > v.max_policy_bp) return say(`Enter a rate from 0 to ${v.max_policy_bp / 100}, like 2.25`, true);
          try { const r = await api('/api/rates/policy', { policy_bp: bp }); say(r.cancelled ? 'No change queued: that is the rate in force.' : `Saved. It applies from world month ${r.applies_from_month}.`); await load(); } catch (e) { say(e.message, true); }
        } }, 'Announce rate')) : h('p', { class: 'muted' }, 'Only the world teacher can change it.'),
      h('p', {}, `Inflation ${pct(v.inflation_bp)} a year. Prices are ${((v.price_index_bp - 10000) / 100).toFixed(2)}% above the season start; they step up on the first month of each world year (13, 25, ...).`),
      h('p', { class: 'muted' }, v.pending_inflation_bp === null ? 'Rents, bills, wages for new hires and new home prices follow it.' : `Queued: ${pct(v.pending_inflation_bp)}, used from the next world month.`),
      v.can_set ? h('div', { class: 'row' },
        h('label', { class: 'grow' }, 'New inflation (percent a year)', inflInput),
        h('button', { type: 'button', onclick: async () => {
          const bp = Math.round(Number(inflInput.value) * 100);
          if (!/^\d{1,2}(\.\d{1,2})?$/.test(inflInput.value.trim()) || bp > v.max_inflation_bp) return say(`Enter an inflation rate from 0 to ${v.max_inflation_bp / 100}, like 2.1`, true);
          try { const r = await api('/api/rates/inflation', { inflation_bp: bp }); say(`Saved. It applies from world month ${r.applies_from_month}.`); await load(); } catch (e) { say(e.message, true); }
        } }, 'Set inflation')) : '');
    history.replaceChildren(v.history.length ? h('table', {},
      h('thead', {}, h('tr', {}, h('th', {}, 'From month'), h('th', { class: 'num' }, 'Policy rate'))),
      h('tbody', {}, [...v.history].reverse().map((p) => h('tr', {}, h('td', {}, `Month ${p.month}`), h('td', { class: 'num' }, pct(p.policy_bp)))))) : h('p', { class: 'muted' }, 'No rate yet: it is announced at the next world month.'));
  }
  el.append(h('h2', {}, 'Bank of DAA'),
    h('p', { class: 'muted small' }, 'Every other rate follows the policy rate: HISA, prime, mortgages and the line of credit. A new rate applies from the next world month. Savings follows the HISA rate while this module is on.'),
    info, msg, history);
  ctx?.onRefresh(() => load().catch(() => {}));
  await load();
}
