import { h, api, fmt } from '/ui.js?v=__V__';

// Bills panel with four tabs: Bills (pay one, pay all, autopay), Budget (net pay, bills, what is left, 50/30/20),
// Plans (optional choices, apply next month, with where each price came from), History (late payments).
// The tab and data are kept across refreshes; only the visible parts are redrawn.
export async function render(el, ctx) {
  let s = null, tab = 'bills';
  const msg = h('p', { role: 'status' });
  const body = h('div', { class: 'stack' });
  const tabs = h('div', { class: 'row', role: 'tablist' });
  const say = (text, bad) => { msg.className = bad ? 'error' : 'ok'; msg.textContent = text; };
  const act = async (path, data, ok) => { try { await api(path, data); if (ok) say(ok); } catch (e) { say(e.message, true); } await load(); };
  const monthLabel = (m) => `month ${m}`;

  function billsTab() {
    const open = s.bills.filter((b) => !b.paid);
    return h('div', { class: 'stack' },
      h('div', { class: 'spread' },
        h('p', {}, h('strong', {}, `Chequing ${fmt(s.balance_cents)}`), ` · Bills owed: ${fmt(s.owed_cents)}`, s.overdue_cents ? h('span', { class: 'error' }, ` (overdue: ${fmt(s.overdue_cents)})`) : ''),
        h('div', { class: 'row' },
          ...(s.card ? [h('label', {}, 'Pay from ', h('select', { onchange: (ev) => act('/api/bills/pay-from', { source: ev.target.value }, `Paying from ${ev.target.value}.`) },
            h('option', { value: 'chequing', selected: s.pay_from === 'chequing' }, 'Chequing'),
            h('option', { value: 'card', selected: s.pay_from === 'card' }, `Card (${s.card.available_cents === null ? 'limit not known' : `${fmt(s.card.available_cents)} available`})`)))] : []),
          h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: s.autopay, onchange: (ev) => act('/api/bills/autopay', { enabled: ev.target.checked }, ev.target.checked ? 'Autopay is on.' : 'Autopay is off.') }), 'Autopay'),
          h('button', { type: 'button', disabled: !open.length, onclick: () => act('/api/bills/pay-all', {}, 'Paid what your chequing covers.') }, 'Pay all'))),
      h('p', { class: 'muted small' }, `Autopay pays every bill right after payday if your chequing covers it, rent first. A bill unpaid at the next month adds a late-fee bill: ${fmt(s.late_fee.cents)} or ${s.late_fee.pct}% of the bill, whichever is more. Pay it like any other bill. A bill is money you owe from the day it arrives: it counts against your net worth until you pay it.`),
      s.bills.length ? h('div', { class: 'table-wrap' }, h('table', {},
        h('thead', {}, h('tr', {}, h('th', {}, 'Bill'), h('th', {}, 'Due'), h('th', { class: 'num' }, 'Amount'), h('th', {}, 'Status'), h('th', {}, ''))),
        h('tbody', {}, s.bills.map((b) => h('tr', {},
          h('td', {}, b.name), h('td', {}, monthLabel(b.due_month)), h('td', { class: 'num' }, fmt(b.amount)),
          h('td', {}, b.paid ? `Paid (${monthLabel(b.paid_month)})` : b.late ? h('span', { class: 'error' }, `Late${b.late_fee_cents ? ` (fee ${fmt(b.late_fee_cents)})` : ''}`) : 'Due'),
          h('td', {}, b.paid ? '' : h('button', { type: 'button', onclick: () => act('/api/bills/pay', { id: b.id }, `Paid ${b.name}.`) }, 'Pay'))))))) : h('p', { class: 'muted' }, 'No bills yet. They arrive when the world month moves on.'));
  }

  function budgetTab() {
    const b = s.budget;
    // The CSP has no style-src, so a style="" attribute would be blocked; widths and colours are set through the CSSOM instead.
    const COLORS = { needs: 'var(--ice)', wants: 'var(--gold)', savings: 'var(--lime)' };
    const bar = (label, p) => {
      const track = h('div', {});
      Object.assign(track.style, { display: 'flex', gap: '2px', borderRadius: '6px', overflow: 'hidden' });
      for (const [key, name] of [['needs', 'Needs'], ['wants', 'Wants'], ['savings', 'Savings']]) {
        const cell = h('div', { title: `${name} ${p[key]}%` }, p[key] >= 10 ? `${name} ${p[key]}%` : '');
        Object.assign(cell.style, { flex: String(Math.max(p[key], 0.0001)), background: COLORS[key], color: 'var(--night)', padding: '4px 2px', minWidth: '0', overflow: 'hidden', whiteSpace: 'nowrap', textAlign: 'center', fontSize: '.8rem' });
        track.append(cell);
      }
      return h('div', { class: 'stack' }, h('p', { class: 'label' }, label), track, h('p', { class: 'muted small' }, `Needs ${p.needs}% · Wants ${p.wants}% · Savings ${p.savings}%`));
    };
    const line = (t, c, strong) => h('tr', {}, h('td', {}, strong ? h('strong', {}, t) : t), h('td', { class: `num ${c < 0 ? 'minus' : ''}` }, strong ? h('strong', {}, fmt(c)) : fmt(c)));
    return h('div', { class: 'stack' },
      h('table', {}, h('tbody', {},
        line('Net pay this month', b.net_pay),
        line('Needs (rent, food, utilities, phone, getting around, life-stage costs)', -b.needs),
        line('Wants (internet, travel, a new car)', -b.wants),
        ...(b.fees ? [line('Late fees', -b.fees)] : []),
        line('What is left', b.left, true))),
      b.pct ? bar('You', b.pct) : h('p', { class: 'muted' }, 'No pay this month, so there is no budget to compare. Get a job at the Job Centre.'),
      bar('The 50/30/20 rule of thumb', b.targets),
      h('p', { class: 'muted small' }, 'Aim to keep needs near 50% of take-home pay, wants near 30%, and put 20% into savings.'));
  }

  function plansTab() {
    return h('div', { class: 'stack' },
      h('p', { class: 'muted small' }, 'Rent, utilities and groceries are always billed, and so are the life-stage lines that come with age (home upkeep or renter extras from 36, health and care from 55; see Life). Your choices below start with next month\'s bills. New choices appear here at the stage they start (36 and 55), set to the default until you change them.'),
      ...s.slots.map((sl) => h('label', {}, sl.label,
        h('select', { onchange: (ev) => act('/api/bills/choice', { slot: sl.slot, option: ev.target.value }, `${sl.label} changes next month.`) },
          sl.options.map((o) => h('option', { value: o.option, selected: o.option === sl.current }, `${o.label} (${fmt(o.amount)})`))))),
      h('p', { class: 'label' }, 'Where the prices come from'),
      h('ul', { class: 'small' }, s.catalogue.map((c) => h('li', {},
        h('strong', {}, `${c.name} ${fmt(c.amount_cents)}`), c.illustrative ? ' (illustrative) ' : ' ', c.source_note, ' ',
        c.source_url ? h('a', { href: c.source_url, target: '_blank', rel: 'noopener noreferrer' }, 'source') : '', ` Checked ${c.checked}.`))));
  }

  function historyTab() {
    return s.history.length ? h('div', { class: 'table-wrap' }, h('table', {},
      h('thead', {}, h('tr', {}, ['Bill', 'Due', 'Months late', 'Fee', 'Paid'].map((t) => h('th', {}, t)))),
      h('tbody', {}, s.history.map((r) => h('tr', {}, h('td', {}, r.name), h('td', {}, monthLabel(r.due_month)), h('td', {}, String(r.months_late)), h('td', {}, fmt(r.fee_cents)), h('td', {}, r.paid_month ? monthLabel(r.paid_month) : 'Not yet')))))
    ) : h('p', { class: 'muted' }, 'No late payments. Paying on time keeps your record clean, and lenders will look at it later.');
  }

  function draw() {
    tabs.replaceChildren(...[['bills', 'Bills'], ['budget', 'Budget'], ['plans', 'Plans'], ['history', 'History']].map(([key, name]) =>
      h('button', { type: 'button', class: key === tab ? '' : 'ghost', role: 'tab', 'aria-selected': String(key === tab), onclick: () => { tab = key; draw(); } }, name)));
    // The Plans tab holds selects: do not rebuild it under the student's hand on a background refresh.
    body.replaceChildren({ bills: billsTab, budget: budgetTab, plans: plansTab, history: historyTab }[tab]());
  }

  let last = '';
  async function load() {
    s = await api('/api/bills/state');
    const key = tab + JSON.stringify(s);
    if (key !== last) { last = key; draw(); }
  }

  el.append(h('h2', {}, 'Bills'), tabs, msg, body);
  ctx.onRefresh(() => load().catch(() => {}));
  await load();
}
