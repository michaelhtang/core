import { h, api, fmt } from '/ui.js?v=__V__';

// Insurance panel: your policies (premium, deductible, what they cover, buy / cancel from next month), what town events have cost you and what
// insurance paid back, and the comparison "what it would have cost with no insurance". The page is redrawn only when the data changed.
export async function render(el, ctx) {
  let s = null, last = '';
  const msg = h('p', { role: 'status' });
  const policies = h('div', { class: 'stack' });
  const summary = h('div', { class: 'stack' });
  const history = h('div', { class: 'stack' });
  const put = (box, ...kids) => box.replaceChildren(...kids.filter((x) => x != null));   // replaceChildren would print a null as the text "null"
  const say = (text, bad) => { msg.className = bad ? 'error' : 'ok'; msg.textContent = text; };
  const act = async (path, data, ok) => { try { await api(path, data); say(ok); } catch (e) { say(e.message, true); } await load(); };

  function policyCard(p) {
    const status = p.held ? (p.cancelling ? 'Covered until the end of this month' : 'Covered') : p.starts_next_month ? 'Starts next month' : 'Not covered';
    const premium = p.billed_by === 'bills' ? (p.premium_cents ? `${fmt(p.premium_cents)} a month (your Car insurance bill)` : 'Premium is the Car insurance bill')
      : p.billed_by === 'housing' ? `${fmt(p.premium_cents)} a month (in your housing costs)` : `${fmt(p.premium_cents)} a month`;
    return h('div', { class: 'class-card' },
      h('div', { class: 'spread' }, h('h3', {}, p.name), h('span', { class: p.held ? 'badge' : 'muted' }, status)),
      h('p', {}, `${premium} · Deductible ${fmt(p.deductible_cents)}`),
      p.claims_from_month > s.month ? h('p', { class: 'small' }, `${p.key === 'auto' ? 'Car cover pays' : p.key === 'condo' ? 'Condo cover pays' : 'Pays'} claims for events from world month ${p.claims_from_month}.`) : null,
      p.covers.length ? h('p', { class: 'small' }, `Pays toward: ${p.covers.join(', ')}.`) : null,
      h('p', { class: 'muted small' }, p.note),
      p.buyable ? ((p.held && !p.cancelling) || p.starts_next_month
        ? h('button', { class: 'ghost', type: 'button', onclick: () => act('/api/insurance/cancel', { policy: p.key }, `${p.name} ends after this month.`) }, p.starts_next_month ? 'Do not start it' : 'Cancel from next month')
        : h('button', { type: 'button', onclick: () => act('/api/insurance/buy', { policy: p.key }, `${p.name} starts next month.`) }, `Buy for ${fmt(p.premium_cents)} a month`)) : null);
  }

  function draw() {
    policies.replaceChildren(...s.policies.map(policyCard));
    const m = s.summary;
    put(summary, 
      h('p', { class: 'label' }, 'What insurance did for you this season'),
      m.expenses_cents || m.premiums_cents ? h('table', {}, h('tbody', {},
        h('tr', {}, h('td', {}, 'Town events cost you, with no insurance'), h('td', { class: 'num' }, fmt(m.uninsured_cost_cents))),
        h('tr', {}, h('td', {}, 'Insurance paid back (claims)'), h('td', { class: 'num' }, `-${fmt(m.claims_cents)}`)),
        h('tr', {}, h('td', {}, 'Premiums you paid'), h('td', { class: 'num' }, fmt(m.premiums_cents))),
        h('tr', {}, h('td', {}, h('strong', {}, 'What it cost you with insurance')), h('td', { class: 'num' }, h('strong', {}, fmt(m.insured_cost_cents)))))) : h('p', { class: 'muted' }, 'Nothing has happened yet. Insurance only pays off when something goes wrong, and you do not know when.'),
      m.expenses_cents ? h('p', { class: 'muted small' }, m.insured_cost_cents < m.uninsured_cost_cents ? `Insurance saved you ${fmt(m.uninsured_cost_cents - m.insured_cost_cents)} so far.` : `Premiums cost you ${fmt(m.insured_cost_cents - m.uninsured_cost_cents)} more than the events did so far. That is the price of knowing a big bill will not wreck your month.`) : null,
      h('p', { class: 'muted small' }, `The town does not hit you more than once in ${s.gap_months} months. Changes you make here start next month. Cover starts the month after you buy (your first premium); claims are paid for events from the month after that.`));
    put(history, 
      h('p', { class: 'label' }, 'Events and claims'),
      s.events.length ? h('div', { class: 'table-wrap' }, h('table', {},
        h('thead', {}, h('tr', {}, ['Month', 'Event', 'Bill', 'Covered by', 'Deductible', 'Claim paid', 'You paid'].map((t, i) => h('th', { class: i > 1 && i !== 3 ? 'num' : '' }, t)))),
        h('tbody', {}, s.events.map((e) => e.kind === 'windfall'
          ? h('tr', {}, h('td', {}, String(e.month)), h('td', {}, e.name), h('td', {}, ''), h('td', {}, 'Windfall'), h('td', {}, ''), h('td', { class: 'num' }, fmt(e.amount)), h('td', {}, ''))
          : h('tr', {}, h('td', {}, String(e.month)), h('td', {}, e.name), h('td', { class: 'num' }, fmt(e.amount)), h('td', {}, e.insured_by ? s.policies.find((p) => p.key === e.insured_by).name : 'Nothing: no policy'),
            h('td', { class: 'num' }, e.insured_by ? fmt(e.deductible) : ''), h('td', { class: 'num' }, e.claim_cents ? fmt(e.claim_cents) : ''), h('td', { class: 'num' }, fmt(e.net_cents))))))) : h('p', { class: 'muted' }, 'No events yet.'),
      s.premium_history.length ? h('div', { class: 'table-wrap' }, h('p', { class: 'label' }, 'Premiums'), h('table', {},
        h('thead', {}, h('tr', {}, h('th', {}, 'Month'), h('th', {}, 'Policy'), h('th', { class: 'num' }, 'Premium'))),
        h('tbody', {}, s.premium_history.map((r) => h('tr', {}, h('td', {}, String(r.month)), h('td', {}, s.policies.find((p) => p.key === r.key)?.name ?? r.key), h('td', { class: 'num' }, fmt(r.amount))))))) : null);
  }

  async function load() {
    s = await api('/api/insurance/state');
    const key = JSON.stringify(s);
    if (key !== last) { last = key; draw(); }
  }

  el.append(h('h2', {}, 'Insurance'),
    h('p', { class: 'muted small' }, 'Bad luck happens: a cracked phone, a burst pipe. A policy costs a little every month, and when something goes wrong the insurer pays the bill minus your deductible. Premiums arrive as bills.'),
    msg, policies, summary, history);
  ctx.onRefresh(() => load().catch(() => {}));
  await load();
}
