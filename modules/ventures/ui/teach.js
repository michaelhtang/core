import { h, api, fmt, confirmAction } from '/ui.js?v=__V__';

// Teacher panel for Venture Row: registrations to approve, each class's companies (revenue, net, treasury, the books), rename / freeze / dissolve,
// and the world teacher's demand settings per sector.
const pc = (bp) => `${(bp / 100).toFixed(bp % 100 ? 2 : 0)}%`;
export async function render(el, ctx) {
  const box = h('div', { class: 'stack' }), msg = h('p', { role: 'status' }), books = h('div', { class: 'stack' });
  const say = (text, bad) => { msg.className = bad ? 'error' : 'ok'; msg.textContent = text; };
  let shown = null;
  const act = async (path, body, ok) => { try { await api(`/api/ventures${path}`, body); say(ok); shown = null; await load(); } catch (e) { say(e.message, true); } };

  async function load() {
    const v = await api('/api/ventures/teach');
    const key = JSON.stringify(v);
    if (key === shown) return;
    shown = key;
    box.replaceChildren(settings(v), financeSettings(v), ...(v.classes.length ? v.classes.map(classCard) : [h('p', { class: 'muted' }, 'Create a class first.')]));
  }

  function settings(v) {
    const rows = v.settings.map((s) => {
      const a = h('input', { inputmode: 'numeric', value: String(s.a_bp / 100), 'aria-label': `${s.sector} town demand %`, disabled: !v.can_settings });
      const b = h('input', { inputmode: 'numeric', value: String(s.b_bp / 100), 'aria-label': `${s.sector} price sensitivity %`, disabled: !v.can_settings });
      return h('tr', {}, h('td', {}, s.sector), h('td', {}, a, '%'), h('td', {}, b, '%'), h('td', { class: 'num' }, pc(s.spoilage_bp)),
        h('td', {}, v.can_settings ? h('button', { class: 'ghost', type: 'button', onclick: () => act('/sector', { sector: s.sector, a_bp: Math.round(Number(a.value) * 100), b_bp: Math.round(Number(b.value) * 100) }, `${s.sector}: saved, from the next month.`) }, 'Save') : ''));
    });
    return h('details', { class: 'class-card' }, h('summary', {}, `Town demand settings (${v.town_companies} companies open, a simulated town of ${v.town_size} residents)`),
      h('p', { class: 'muted small' }, `Demand per product is Q = a - b x P. "Town demand" scales a (more customers at every price), "price sensitivity" scales b (customers walk away sooner). ${v.min_bp / 100}% to ${v.max_bp / 100}%. ${v.can_settings ? '' : 'Only the world teacher changes these.'} Every open company pays ${fmt(v.rent_cents)} rent a month; each buyer may spend ${fmt(v.caps.company)} a month at one company and ${fmt(v.caps.month)} on Venture Row (config options.ventures).`),
      h('div', { class: 'table-wrap' }, h('table', {}, h('thead', {}, h('tr', {}, ['Sector', 'Town demand', 'Price sensitivity', 'Spoilage', ''].map((t) => h('th', {}, t)))), h('tbody', {}, rows))));
  }

  // 4b: the Venture Bank's spread over the policy rate, and whether hires wait for a teacher (world teacher)
  function financeSettings(v) {
    const f = v.finance, spread = h('input', { inputmode: 'decimal', value: String(f.loan_spread_bp / 100), 'aria-label': 'Venture Bank spread %', disabled: !v.can_settings });
    const approval = h('input', { type: 'checkbox', checked: f.hire_approval, disabled: !v.can_settings, 'aria-label': 'Hires need a teacher\'s approval' });
    return h('details', { class: 'class-card' }, h('summary', {}, `Payroll, tax and loans (loans at ${pc(f.policy_bp)} + ${pc(f.loan_spread_bp)})`),
      h('p', { class: 'muted small' }, `Companies pay small business tax at ${pc(f.tax_rate_bp)} at the start of each world year and must register for GST past ${fmt(f.gst_threshold_cents)} of sales in 4 quarters. ${v.can_settings ? '' : 'Only the world teacher changes these settings.'}`),
      h('label', {}, 'Venture Bank spread over the policy rate ', spread, '%'), ' ', h('label', {}, approval, ' Hires need a teacher\'s approval'), ' ',
      v.can_settings ? h('button', { class: 'ghost', type: 'button', onclick: () => act('/finance-settings', { loan_spread_bp: Math.round(Number(spread.value) * 100), hire_approval: approval.checked }, 'Saved.') }, 'Save') : null);
  }

  // 6c: one row per company: staff, payroll made and missed, the loan, tax (the debrief view), then each company's card
  function classTable(c) {
    const rows = c.companies.filter((q) => q.paydays !== undefined && !['forming', 'pending', 'declined'].includes(q.status));
    if (!rows.length) return null;
    return h('div', { class: 'table-wrap' }, h('table', {}, h('caption', { class: 'muted small' }, `${c.name}: employers`),
      h('thead', {}, h('tr', {}, ['Company', 'Status', 'Staff', 'Pays made', 'Pays missed', 'Loan owed', 'Tax paid', 'Tax owed'].map((t, i) => h('th', { class: i > 1 ? 'num' : '' }, t)))),
      h('tbody', {}, rows.map((q) => h('tr', {}, h('td', {}, q.name), h('td', {}, q.loan_status === 'default' ? 'loan in default' : q.status),
        h('td', { class: 'num' }, String(q.staff)), h('td', { class: 'num' }, String(q.paydays)), h('td', { class: q.missed_paydays ? 'num error' : 'num' }, String(q.missed_paydays)),
        h('td', { class: 'num' }, fmt(q.loans_cents)), h('td', { class: 'num' }, fmt(q.tax_cents)), h('td', { class: 'num' }, fmt(q.tax_owed_cents ?? 0)))))));
  }
  function classCard(c) {
    return h('div', { class: 'class-card stack' }, h('strong', {}, c.name), classTable(c),
      c.companies.length ? h('div', { class: 'stack' }, c.companies.map((q) => company(q))) : h('p', { class: 'muted small' }, c.course_id === 'fintech2030' ? 'No registrations yet.' : 'FinTech 10 students buy from the storefronts; founding is for FinTech 20/30.'));
  }
  function company(q) {
    const name = h('input', { value: q.name, maxlength: 40, 'aria-label': `New name for ${q.name}` }), note = h('input', { maxlength: 200, 'aria-label': 'Note to the team', placeholder: 'note (optional)' });
    const live = ['approved', 'active', 'frozen'].includes(q.status);
    return h('div', { class: 'class-card' },
      h('div', { class: 'spread' }, h('strong', {}, `${q.name} (${q.sector})`), h('span', { class: 'badge' }, q.status)),
      h('p', { class: 'small' }, q.plan),
      h('p', { class: 'small' }, `Founders: ${q.founders.map((f) => `${f.username} ${pc(f.share_bp)}${f.status === 'accepted' ? '' : ` (${f.status})`}${q.status === 'forming' && !f.confirmed ? ', split not agreed' : ''}, capital ${fmt(f.capital_cents)}`).join('; ')}`),
      live ? h('p', { class: 'small' }, `Treasury ${fmt(q.treasury_cents)}, inventory ${fmt(q.inventory_cents)}, ${q.products} product(s), reputation ${pc(q.rep_bp)}. ${q.statement_month === null ? 'No statements yet.' : `Month ${q.statement_month}: revenue ${fmt(q.revenue_cents)}, net ${fmt(q.net_cents)}${q.balanced ? '' : ' (BOOKS DO NOT BALANCE)'}.`} Staff ${q.staff}; payroll ${q.payroll}; loans ${fmt(q.loans_cents)}; tax ${fmt(q.tax_cents)}.${q.rent_missed ? ` Rent unpaid ${q.rent_missed} month(s).` : ''}`) : null,
      q.note ? h('p', { class: 'muted small' }, q.note) : null,
      (q.hires ?? []).map((a) => h('p', { class: 'small' }, `Hire waiting for you: ${a.username} as ${a.title} (part-time, on top of their job). `, h('button', { type: 'button', 'aria-label': `Approve hiring ${a.username} at ${q.name}`, onclick: () => act('/hire-approve', { application_id: a.id, approve: true }, `${a.username} hired.`) }, 'Approve'), ' ',
        h('button', { type: 'button', class: 'ghost', 'aria-label': `Decline hiring ${a.username} at ${q.name}`, onclick: () => act('/hire-approve', { application_id: a.id, approve: false }, 'Declined.') }, 'Decline'))),
      q.loan_status === 'default' ? (() => {
        const term = h('input', { inputmode: 'numeric', value: '24', 'aria-label': 'New term in months' });
        return h('div', { class: 'stack' }, h('p', { class: 'error small' }, `The Venture Bank loan is in default (${fmt(q.loans_cents)} owed): the company is frozen until you resolve it.`),
          h('div', {}, h('button', { type: 'button', onclick: () => act('/resolve', { id: q.id, action: 'restructure', term_months: Number(term.value) }, 'Restructured: the company is open again.') }, 'Restructure over'), ' ', term, ' months ',
            h('button', { type: 'button', class: 'ghost', onclick: () => confirmAction(`Forgive ${fmt(q.loans_cents)}?`) && act('/resolve', { id: q.id, action: 'forgive' }, 'Forgiven: the company is open again.') }, 'Forgive'), ' ',
            h('button', { type: 'button', class: 'ghost', onclick: () => confirmAction(`Dissolve ${q.name}? The treasury pays the loan first; the rest of the loan is written off.`) && act('/resolve', { id: q.id, action: 'dissolve' }, `${q.name} dissolved.`) }, 'Dissolve')));
      })() : null,
      q.status === 'pending' ? h('div', {}, note, ' ', h('button', { type: 'button', onclick: () => act('/approve', { id: q.id, approve: true, note: note.value }, `${q.name} approved. The founders now put in their capital.`) }, 'Approve'), ' ',
        h('button', { type: 'button', class: 'ghost', onclick: () => act('/approve', { id: q.id, approve: false, note: note.value }, `${q.name} declined.`) }, 'Decline')) : null,
      !['declined', 'dissolved', 'wound_up'].includes(q.status) ? h('div', {}, name, ' ', h('button', { type: 'button', class: 'ghost', onclick: () => act('/rename', { id: q.id, name: name.value }, 'Renamed.') }, 'Rename'), ' ',
        q.status === 'active' ? h('button', { type: 'button', class: 'ghost', onclick: () => act('/freeze', { id: q.id, frozen: true }, `${q.name} is frozen: no production or sales.`) }, 'Freeze') : null,
        q.status === 'frozen' ? h('button', { type: 'button', class: 'ghost', onclick: () => act('/freeze', { id: q.id, frozen: false }, `${q.name} is open again.`) }, 'Unfreeze') : null, ' ',
        h('button', { type: 'button', class: 'ghost', onclick: () => confirmAction(`Dissolve ${q.name}? The treasury is paid to its shareholders and its stock written off. This cannot be undone.`) && act('/dissolve', { id: q.id }, `${q.name} dissolved.`) }, 'Dissolve')) : null,
      live || q.status === 'dissolved' ? h('button', { type: 'button', class: 'ghost', onclick: () => open(q.id) }, 'Open the books') : null);
  }
  async function open(id) {
    try {
      const c = await api(`/api/ventures/company/${id}`), st = c.statements[0];
      const line = (k, v) => h('tr', {}, h('td', {}, k), h('td', { class: 'num' }, fmt(v)));
      books.replaceChildren(h('div', { class: 'class-card stack' }, h('h3', {}, `${c.name}: the books`),
        h('p', { class: 'small' }, `Cap table: ${c.cap_table.map((x) => `${x.username} ${x.shares.toFixed(2)} shares (${pc(x.share_bp)})`).join(', ')}.`),
        st ? h('table', {}, h('tbody', {}, line(`Revenue (month ${st.month})`, st.income.revenue_cents), line('Cost of goods sold + spoilage', st.income.cogs_cents + st.income.spoilage_cents), line('Net income', st.income.net_cents),
          line('Cash', st.balance.cash_cents), line('Inventory', st.balance.inventory_cents), line('Equity', st.balance.equity_cents))) : h('p', { class: 'muted' }, 'No statements yet.'),
        st ? h('p', { class: st.balance.balanced ? 'ok small' : 'error small' }, st.balance.balanced ? 'The balance sheet balances.' : 'The balance sheet does not balance: report this.') : null,
        h('details', {}, h('summary', {}, `Journal (${c.journal.length})`), h('ul', {}, c.journal.map((e) => h('li', { class: 'small' }, `${e.kind.replace('ventures.', '')}: ${e.debit} / ${e.credit}, ${fmt(e.cents)} (${e.memo ?? ''})`))))));
    } catch (e) { say(e.message, true); }
  }

  el.append(h('div', { class: 'spread' }, h('h2', {}, 'Venture Row'), h('button', { class: 'ghost', type: 'button', onclick: () => { shown = null; load().catch((e) => say(e.message, true)); } }, 'Refresh')),
    h('p', { class: 'muted small' }, 'FinTech 20/30 teams register a company; you approve it here. Founders split the shares, each puts at least $100 into the company treasury, and sell to the town and to classmates. Statements are written each world month. Companies can hire students part-time on top of their own jobs (10 to 40 hours a month, paid from the treasury; the job board is town-wide, so class job settings do not apply), pay small business tax and GST, and borrow from the Venture Bank.'),
    msg, box, books);
  ctx?.onRefresh(() => load().catch(() => {}));
  await load();
}
