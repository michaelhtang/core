import { h, api, fmt, confirmAction } from '/ui.js?v=__V__';

// Teacher panel for insurance and town events: trigger an event for a class or the whole town (world teacher), who was hit and who was insured, totals.
export async function render(el, ctx) {
  const msg = h('p', { role: 'status' });
  const form = h('div', { class: 'stack' });
  const totals = h('div', { class: 'stack' });
  const triggers = h('div', { class: 'stack' });
  const events = h('div', { class: 'table-wrap' });
  const say = (text, bad) => { msg.className = bad ? 'error' : 'ok'; msg.textContent = text; };
  let shown = '';
  const eventSel = h('select', { 'aria-label': 'Event' }), scopeSel = h('select', { 'aria-label': 'Who' });

  async function load() {
    const v = await api('/api/insurance/overview');
    const key = JSON.stringify([v.catalogue, v.classes, v.can_trigger]);
    if (key !== shown) {                                                      // keep the selects as the teacher left them
      shown = key;
      eventSel.replaceChildren(...v.catalogue.map((e) => h('option', { value: e.key }, `${e.name} (${fmt(e.amount_cents)}${e.kind === 'windfall' ? ', pays the student' : ''})`)));
      scopeSel.replaceChildren(h('option', { value: 'town' }, 'Whole town'), ...v.classes.map((c) => h('option', { value: `class:${c.id}` }, c.name)));
      form.replaceChildren(v.can_trigger ? h('div', { class: 'row' },
        h('label', { class: 'grow' }, 'Event', eventSel), h('label', {}, 'For', scopeSel),
        h('button', { type: 'button', onclick: async () => {
          const [scope, id] = scopeSel.value.split(':');
          const who = scope === 'town' ? 'the WHOLE TOWN (every student in every class, not just yours)' : `the class ${scopeSel.selectedOptions[0].textContent}`;
          if (!confirmAction(`Trigger "${eventSel.selectedOptions[0].textContent}" for ${who}? It lands at the next world tick and can't be undone.`)) return;
          try { const r = await api('/api/insurance/trigger', { event: eventSel.value, scope, ...(id ? { class_id: Number(id) } : {}) }); say(`It lands at world month ${r.applies_from_month}, with the next tick.`); await load(); } catch (e) { say(e.message, true); }
        } }, 'Trigger event')) : h('p', { class: 'muted' }, 'Only the world teacher can trigger events.'),
      h('ul', { class: 'small' }, v.catalogue.map((e) => h('li', {}, `${e.name} ${fmt(e.amount_cents)}: ${e.kind === 'windfall' ? 'a windfall paid from the mint' : e.covered_by.length ? `covered by ${e.covered_by.join(' or ')}` : 'not covered by any policy'}.`))),
      h('p', { class: 'muted small' }, `Fairness: at most one event per student every ${v.caps.gap_months} months, and at most ${fmt(v.caps.season_cap_cents)} of expenses per student per season. Random monthly events: ${v.caps.random ? 'on' : 'off'}. All amounts are illustrative.`));
    }
    const t = v.totals;
    totals.replaceChildren(h('p', {}, `${v.students} students · expenses ${fmt(t.expenses_cents)} · claims paid ${fmt(t.claims_cents)} · windfalls ${fmt(t.windfalls_cents)} · insured events ${t.insured_events}, uninsured ${t.uninsured_events} · tenant policies ${t.holders.tenant}, phone ${t.holders.phone}`));
    triggers.replaceChildren(v.triggers.length ? h('div', { class: 'table-wrap' }, h('table', {},
      h('thead', {}, h('tr', {}, ['Event', 'For', 'Asked in month', 'Landed', 'Hit', 'Skipped: too soon', 'Skipped: season cap'].map((x) => h('th', {}, x)))),
      h('tbody', {}, v.triggers.map((r) => h('tr', {}, h('td', {}, r.name), h('td', {}, r.class ?? 'Whole town'), h('td', {}, String(r.created_month)), h('td', {}, r.processed_month ? `Month ${r.processed_month}` : 'Next tick'),
        h('td', {}, String(r.applied)), h('td', {}, String(r.skipped_recent)), h('td', {}, String(r.skipped_cap))))))) : h('p', { class: 'muted' }, 'No events triggered yet.'));
    events.replaceChildren(v.events.length ? h('table', {},
      h('thead', {}, h('tr', {}, ['Month', 'Student', 'Class', 'Event', 'Bill', 'Insured by', 'Claim', 'Student paid'].map((x, i) => h('th', { class: i > 3 && i !== 5 ? 'num' : '' }, x)))),
      h('tbody', {}, v.events.map((e) => h('tr', {}, h('td', {}, String(e.month)), h('td', {}, e.student), h('td', {}, e.class), h('td', {}, e.name),
        h('td', { class: 'num' }, fmt(e.amount_cents)), h('td', {}, e.kind === 'windfall' ? 'Windfall' : e.insured_by_name ?? 'Nobody'), h('td', { class: 'num' }, e.claim_cents ? fmt(e.claim_cents) : ''), h('td', { class: 'num' }, fmt(e.net_cents)))))) : h('p', { class: 'muted' }, 'No events have hit anyone yet.'));
  }
  el.append(h('h2', {}, 'Insurance and town events'), form, msg, totals, h('p', { class: 'label' }, 'Triggered events'), triggers, h('p', { class: 'label' }, 'Who was hit'), events);
  ctx?.onRefresh(() => load().catch(() => {}));
  await load();
}
