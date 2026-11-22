import { h, api, fmt, confirmAction } from '/ui.js?v=__V__';

// Teacher panel for housing: where each student lives, owners' mortgages and arrears (a warning at 3 missed in a row), each class's student rentals
// (6b: landlord, rent against the going NPC rent, tenant, unpaid rent, evictions), and the market event lever (world teacher only): every home in the
// world moves by 5 to 15 percent, up or down.
export async function render(el, ctx) {
  const msg = h('p', { role: 'status' });
  const say = (text, bad) => { msg.className = bad ? 'error' : 'ok'; msg.textContent = text; };
  const warn = h('div', { class: 'stack' }), box = h('div', { class: 'stack' }), market = h('div', { class: 'stack' });
  const pct = (bp) => `${(bp / 100).toFixed(2)}%`;
  const amount = h('input', { name: 'pct', inputmode: 'numeric', placeholder: '10', 'aria-label': 'Percent change (5 to 15)' });
  const dir = h('select', { 'aria-label': 'Direction' }, h('option', { value: '1' }, 'Prices rise'), h('option', { value: '-1' }, 'Prices fall'));

  // A class's student rentals (6b): rent against the NPC tier the same kind of apartment rents for, tenant, unpaid rent, evictions.
  const rentals = (c) => (!c.listings?.length ? h('p', { class: 'muted small' }, 'No student rentals in this class.') : h('div', { class: 'stack' },
    h('p', { class: 'small' }, `Student rentals: ${c.listings.length}, let: ${c.listings.filter((l) => l.tenant).length}, evictions this season: ${c.evictions}.`),
    h('div', { class: 'table-wrap' }, h('table', {},
      h('thead', {}, h('tr', {}, h('th', {}, 'Landlord'), h('th', {}, 'Place'), h('th', { class: 'num' }, 'Rent'), h('th', { class: 'num' }, 'Going rent'), h('th', { class: 'num' }, 'Rent vs going'), h('th', {}, 'Tenant'), h('th', { class: 'num' }, 'Unpaid rent'), h('th', { class: 'num' }, 'Empty for'), h('th', { class: 'num' }, 'Evictions'), h('th', { class: 'num' }, 'Mortgage owed'), h('th', { class: 'num' }, 'Mortgage arrears'))),
      h('tbody', {}, c.listings.map((l) => h('tr', {}, h('td', {}, l.landlord), h('td', {}, l.property_name),
        h('td', { class: 'num' }, l.listed ? `${fmt(l.rent_cents)}${l.pending_rent_cents ? ` (${fmt(l.pending_rent_cents)} from month ${l.rent_from})` : ''}` : 'Not listed'), h('td', { class: 'num' }, fmt(l.npc_cents)),
        h('td', { class: 'num' }, l.listed ? `${Math.round((100 * l.rent_cents) / l.npc_cents)}%` : ''), h('td', {}, l.tenant ? `${l.tenant}${l.notice_month ? ` (leaves month ${l.notice_month})` : ''}` : l.listed ? 'Vacant' : ''),
        h('td', { class: 'num' }, l.arrears_cents ? `${fmt(l.arrears_cents)} (${l.missed_streak} missed)` : ''), h('td', { class: 'num' }, l.listed && !l.tenant ? `${l.months_vacant} mo` : ''), h('td', { class: 'num' }, l.evictions ? String(l.evictions) : ''),
        h('td', { class: 'num' }, fmt(l.mortgage_cents)), h('td', { class: 'num' }, l.mortgage_arrears_cents ? `${fmt(l.mortgage_arrears_cents)} (${l.mortgage_missed_streak} missed)` : ''))))))));

  async function load() {
    const v = await api('/api/housing/teach');
    warn.replaceChildren(...(v.warnings.length ? [h('p', { class: 'error' }, `${v.warnings.length} student${v.warnings.length === 1 ? ' is' : 's are'} ${v.warn_after} or more mortgage payments behind in a row (on any home they own):`),
      ...v.warnings.map((w) => h('p', { class: 'small' }, `${w.username} (${w.class}): ${w.missed_streak} missed in a row, ${fmt(w.arrears_cents)} in arrears.`))] : []));
    box.replaceChildren(...(v.classes.length ? v.classes.map((c) => h('div', { class: 'stack' },
      h('p', { class: 'label' }, c.name),
      h('p', { class: 'small' }, `${c.owners} owner${c.owners === 1 ? '' : 's'}, ${c.renters} renting or living with parents, ${c.students.length - c.owners - c.renters} in a shared room.${c.warnings ? ` ${c.warnings} with a warning.` : ''}`),
      h('div', { class: 'table-wrap' }, h('table', {},
        h('thead', {}, h('tr', {}, h('th', {}, 'Student'), h('th', {}, 'Lives in'), h('th', { class: 'num' }, 'Value'), h('th', { class: 'num' }, 'Owes'), h('th', { class: 'num' }, 'Payment'), h('th', { class: 'num' }, 'Rate'), h('th', {}, 'Renews'), h('th', { class: 'num' }, 'Arrears'), h('th', { class: 'num' }, 'Missed in a row'))),
        h('tbody', {}, c.students.map((s) => h('tr', {}, h('td', {}, s.username), h('td', {}, s.pending ? `${s.tenure} (moving to ${s.pending})` : s.tenure),
          h('td', { class: 'num' }, s.owner ? fmt(s.value_cents) : ''), h('td', { class: 'num' }, s.owner ? fmt(s.balance_cents) : ''), h('td', { class: 'num' }, s.owner ? fmt(s.payment_cents) : ''), h('td', { class: 'num' }, s.owner ? pct(s.rate_bp) : ''),
          h('td', {}, s.owner ? `Month ${s.renewal_month}` : ''), h('td', { class: 'num' }, s.owner && s.arrears_cents ? fmt(s.arrears_cents) : ''), h('td', { class: 'num' }, s.owner ? `${s.missed_streak}${s.warning ? ' (warning)' : ''}` : '')))))),
      rentals(c))) : [h('p', { class: 'muted' }, 'Create a class first.')]));
    market.replaceChildren(
      h('p', { class: 'label' }, 'Housing market'),
      h('p', { class: 'muted small' }, `Home values drift ${(v.drift_bp / 100).toFixed(2)}% a month. A market event is town-wide: it moves every home in the world at once, in every class, ${v.event_min_pct} to ${v.event_max_pct} percent.`),
      v.can_event ? h('div', { class: 'row' }, h('label', {}, 'Direction', dir), h('label', {}, 'Percent', amount),
        h('button', { type: 'button', onclick: async () => {
          const n = Number(amount.value);
          if (!Number.isInteger(n) || n < v.event_min_pct || n > v.event_max_pct) return say(`Enter a whole number from ${v.event_min_pct} to ${v.event_max_pct}`, true);
          if (!confirmAction(`Every home in the whole town, in every class, ${Number(dir.value) > 0 ? 'rises' : 'falls'} ${n} percent right now. This can't be undone. Go ahead?`)) return;
          try { const r = await api('/api/housing/market', { pct: n * Number(dir.value) }); say(`Done. ${r.homes} home${r.homes === 1 ? '' : 's'} moved ${r.pct > 0 ? '+' : ''}${r.pct}%.`); amount.value = ''; await load(); } catch (e) { say(e.message, true); }
        } }, 'Trigger market event')) : h('p', { class: 'muted small' }, 'Only the world teacher can trigger a market event.'),
      h('p', { class: 'small' }, v.events.length ? `Town-wide market events so far (they moved every home in the whole town, in every class): ${v.events.map((e) => `month ${e.month} ${e.pct > 0 ? '+' : ''}${e.pct}%`).join(', ')}.` : 'No market events yet.'));
  }

  el.append(h('h2', {}, 'Housing'), warn, market, msg, box);
  ctx?.onRefresh(() => load().catch(() => {}));
  await load();
}
