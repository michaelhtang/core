import { h, api, fmt, dollarsToCents, guard, confirmAction } from '/ui.js?v=__V__';

// Venture Row: found a company (FT20/30), run it (capital, products with their demand curve and break-even, statements, the journal), and buy
// from the other companies' storefronts. Every SVG is built node by node; nothing from the server goes through innerHTML.
const NS = 'http://www.w3.org/2000/svg';
const svg = (tag, attrs = {}, ...kids) => { const el = document.createElementNS(NS, tag); for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v)); el.append(...kids); return el; };
const TABS = [['company', 'My company'], ['shops', 'Storefronts'], ['sectors', 'Sectors and costs']];
const pc = (bp) => `${(bp / 100).toFixed(bp % 100 ? 2 : 0)}%`;
const STATUS = { forming: 'Forming: waiting for the team', pending: 'Waiting for your teacher', approved: 'Approved: put in your capital', active: 'Open for business', frozen: 'Frozen by your teacher', dissolved: 'Dissolved', wound_up: 'Wound up at season close' };

// Q = a - bP from 0 to the choke price, with the team's price, the revenue-maximising price and the price cap marked.
function demandChart(p) {
  const W = 320, H = 170, L = 38, B = 24, maxP = Math.max(p.choke_cents, p.cap_cents, p.price_cents) / 100 || 1, maxQ = p.a || 1;
  const x = (P) => L + (P / maxP) * (W - L - 8), y = (Q) => H - B - (Q / maxQ) * (H - B - 8);
  const q = (P) => Math.max(0, p.a - p.b * P);
  const mark = (P, cls, label) => [svg('line', { x1: x(P), x2: x(P), y1: y(0), y2: 8, class: cls }), svg('text', { x: x(P) + 3, y: 16, class: cls }, label)];
  return svg('svg', { class: 'vr-chart', viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': `Demand for ${p.name}: about ${Math.floor(q(p.price_cents / 100))} a month at your price` },
    svg('line', { x1: L, x2: W - 8, y1: y(0), y2: y(0), class: 'vr-axis' }), svg('line', { x1: L, x2: L, y1: 8, y2: y(0), class: 'vr-axis' }),
    svg('text', { x: L, y: H - 6 }, '$0'), svg('text', { x: W - 60, y: H - 6 }, `price ${fmt(maxP * 100)}`), svg('text', { x: 2, y: 14 }, String(Math.round(maxQ))),
    svg('line', { x1: x(0), y1: y(q(0)), x2: x(Math.min(maxP, p.choke_cents / 100)), y2: y(q(Math.min(maxP, p.choke_cents / 100))), class: 'vr-curve' }),
    ...mark(p.shop_cents / 100, 'vr-shop', 'shop'), ...mark(p.best_cents / 100, 'vr-best', 'best'), ...mark(p.cap_cents / 100, 'vr-cap', 'cap'), ...mark(p.price_cents / 100, 'vr-you', 'you'));
}

export async function render(el, ctx) {
  if (!document.querySelector('link[data-vr]')) document.head.append(h('link', { rel: 'stylesheet', href: new URL('ventures.css', import.meta.url).href, 'data-vr': '' }));
  let s = null, last = '', tab = 'company', stMonth = null;
  const msg = h('p', { role: 'status' }), body = h('div', { class: 'stack' }), tabs = h('div', { class: 'vr-tabs', role: 'tablist' });
  const say = (text, bad) => { msg.className = bad ? 'error' : 'ok'; msg.textContent = text; };
  const act = guard(async (path, data, ok) => { try { const r = await api(`/api/ventures${path}`, data); say(typeof ok === 'function' ? ok(r) : ok); last = ''; await load(); } catch (e) { say(e.message, true); } });
  const btn = (label, path, data, ok, cls, aria) => h('button', { type: 'button', class: cls, 'aria-label': aria, onclick: () => act(path, data, ok) }, label);

  async function load() {
    const next = await api('/api/ventures/state');
    const key = JSON.stringify(next);
    if (key === last) return;
    last = key; s = next;
    draw();
  }
  function draw() {
    tabs.replaceChildren(...TABS.map(([k, label]) => h('button', { type: 'button', role: 'tab', class: tab === k ? '' : 'ghost', 'aria-selected': String(tab === k), onclick: () => { tab = k; draw(); } }, label)));
    body.replaceChildren(...(tab === 'company' ? companyTab() : tab === 'shops' ? shopsTab() : sectorsTab()).flat().filter(Boolean));
  }

  // ---- my company ----
  function companyTab() {
    const c = s.mine;
    if (!c) return [invites(), s.can_found ? registerForm() : h('p', { class: 'muted' }, s.founding_course ? 'You are on a founding team this season already.' : 'Founding a company is for FinTech 20/30 students. You can buy from the storefronts, and later work for a company.'),
      s.last_declined ? h('p', { class: 'muted small' }, `${s.last_declined.name}: ${s.last_declined.status}. ${s.last_declined.note ?? ''}`) : null];
    const head = h('div', { class: 'class-card' }, h('p', { class: 'label' }, `${c.sector} · ${STATUS[c.status] ?? c.status}`), h('h3', {}, c.name), h('p', { class: 'small' }, c.plan),
      c.note ? h('p', { class: 'muted small' }, c.note) : null);
    const team = h('div', { class: 'table-wrap' }, h('table', {}, h('thead', {}, h('tr', {}, ['Founder', 'Status', 'Share', 'Agreed', 'Capital in'].map((t) => h('th', {}, t)))),
      h('tbody', {}, c.members.map((m) => h('tr', {}, h('td', {}, m.username, m.registrant ? ' (registered it)' : ''), h('td', {}, m.status), h('td', { class: 'num' }, pc(m.share_bp)), h('td', {}, m.confirmed ? 'yes' : 'not yet'), h('td', { class: 'num' }, fmt(m.capital_cents)))))));
    if (c.status === 'forming' || c.status === 'pending') return [head, team, formingTools(c)];
    if (c.status === 'dissolved' || c.status === 'wound_up') return [head, team, c.wound_up_cents != null ? h('p', {}, `Value at season close: ${fmt(c.wound_up_cents)}, paid into the founders' season results by share.`) : null, statementsView(c)];
    return [head, money(c), team, c.status === 'approved' ? leaveTools(c) : null, capitalForm(c), productsView(c), c.finance ? [staffView(c), taxView(c), bankView(c)] : null, statementsView(c), journalView(c), dissolveBox(c)];
  }
  function invites() {
    if (!s.invites.length) return null;
    return h('div', { class: 'stack' }, h('p', { class: 'label' }, 'Invitations'), s.invites.map((i) => h('div', { class: 'class-card' },
      h('h3', {}, `${i.name} (${i.sector})`), h('p', { class: 'small' }, `From ${i.founder}: ${i.plan}`),
      h('p', { class: 'small' }, `Team and split: ${i.members.map((m) => `${m.username} ${pc(m.share_bp)} (${m.status})`).join(', ')}`),
      btn('Accept and agree to the split', '/respond', { id: i.id, accept: true }, 'You joined the founding team.'), ' ', btn('Decline', '/respond', { id: i.id, accept: false }, 'Declined.', 'ghost'))));
  }
  function registerForm() {
    const name = h('input', { maxlength: 40, 'aria-label': 'Company name' }), plan = h('textarea', { rows: 4, maxlength: 800, 'aria-label': 'Business plan', placeholder: 'What you sell, to whom, at what price, and your break-even.' });
    const sector = h('select', { 'aria-label': 'Sector' }, s.sectors.map((x) => h('option', { value: x }, x))), mates = h('input', { 'aria-label': 'Co-founders', placeholder: 'usernames, separated by commas' });
    const go = guard(async (e) => { e.preventDefault(); await act('/register', { name: name.value, sector: sector.value, plan: plan.value, cofounders: mates.value }, 'Registered. Your co-founders accept in their own Venture Row panel; then your teacher approves.'); });
    return h('form', { class: 'class-card stack', onsubmit: go }, h('h3', {}, 'Found a company'),
      h('p', { class: 'muted small' }, `A team of 2 to 4 from your class. Pick a pseudonymous name (3 to 40 characters). Each founder puts in at least ${fmt(s.min_capital_cents)} from chequing once your teacher approves.`),
      h('label', {}, 'Name ', name), h('label', {}, 'Sector ', sector), h('label', {}, 'Plan ', plan), h('label', {}, 'Co-founders ', mates), h('button', { type: 'submit' }, 'Register'));
  }
  function formingTools(c) {
    const mine = c.members.find((m) => m.player_id === ctx.me?.user?.id) ?? null;
    const isReg = c.members.find((m) => m.registrant)?.player_id === ctx.me?.user?.id;
    const split = h('input', { 'aria-label': 'Split in percents, team order', placeholder: c.members.map(() => Math.floor(100 / c.members.length)).join(',') });
    return h('div', { class: 'stack' },
      c.status === 'pending' ? h('p', {}, 'Everyone has agreed. Your teacher will approve or decline the registration.') : h('p', { class: 'small' }, 'Waiting until every co-founder has accepted and agreed to the split.'),
      isReg && c.status === 'forming' ? h('div', { class: 'stack' }, h('p', { class: 'small' }, 'Propose a split: whole percents in team order, or "equal". Everyone else agrees to it again.'), split, btn('Propose split', '/split', { id: c.id, get split() { return split.value; } }, 'Split proposed.')) : null,
      mine && !mine.confirmed && c.status === 'forming' ? btn('Agree to this split', '/confirm', { id: c.id }, 'Agreed.') : null,
      isReg ? btn('Withdraw the registration', '/cancel', { id: c.id }, 'Withdrawn.', 'ghost') : null,
      mine?.status === 'accepted' ? btn('Leave this team', '/leave', { id: c.id }, 'You left the team.', 'ghost') : null);
  }
  // Before the company opens: anyone may leave (capital back); founders who paid in may remove one who has not, from remove_from_month.
  function leaveTools(c) {
    const me = c.members.find((m) => m.player_id === ctx.me?.user?.id), unpaid = c.members.filter((m) => m.status === 'accepted' && m.capital_cents < c.min_capital_cents && m.player_id !== me?.player_id);
    return h('div', { class: 'class-card stack' }, h('p', { class: 'small' }, `Until the company opens, any founder may leave and gets their capital back. A founder who has not paid in ${fmt(c.min_capital_cents)} by world month ${c.remove_from_month} can be removed by those who have.`),
      h('div', {}, btn('Leave this team', '/leave', { id: c.id }, 'You left: your capital is back in chequing.', 'ghost'), ' ',
        me && me.capital_cents >= c.min_capital_cents ? unpaid.map((m) => btn(`Remove ${m.username}`, '/remove', { id: c.id, username: m.username }, `${m.username} was removed.`, 'ghost')) : null));
  }
  const money = (c) => h('div', { class: 'vr-grid' }, [['Treasury (cash)', fmt(c.treasury_cents)], ['Inventory at cost', fmt(c.inventory_cents)], ['Company value (book)', fmt(c.value_cents)], ['Reputation', pc(c.rep_bp)], ['Rent a month', fmt(c.rent_cents)], ['Next month start (rent + production)', fmt(c.next_run_cents)]]
    .map(([k, v]) => h('div', { class: 'class-card' }, h('p', { class: 'label' }, k), h('strong', {}, v))),
  c.next_run_cents > c.treasury_cents ? h('p', { class: 'error' }, 'The treasury cannot pay the next month start: rent comes first (two unpaid months freeze the company), then a production run it cannot pay is skipped.') : null,
  c.rent_missed ? h('p', { class: 'error' }, `Rent unpaid ${c.rent_missed} month(s) in a row.`) : null);
  function capitalForm(c) {
    const amt = h('input', { inputmode: 'decimal', 'aria-label': 'Capital (CAD)', placeholder: (c.min_capital_cents / 100).toFixed(2) });
    return h('form', { class: 'class-card', onsubmit: guard(async (e) => { e.preventDefault(); const cents = dollarsToCents(amt.value); if (cents === null) return say('Enter dollars, like 100', true); await act('/capital', { id: c.id, cents }, (r) => `Capital in. Treasury: ${fmt(r.treasury_cents)}.`); }) },
      h('p', { class: 'label' }, 'Put capital in from chequing'), h('p', { class: 'muted small' }, `Equity, recorded on the cap table: ${c.cap_table.map((x) => `${x.username} ${x.shares.toFixed(2)} shares (${pc(x.share_bp)})`).join(', ') || 'written when your teacher approves'}.`), amt, ' ', h('button', { type: 'submit' }, 'Put in'));
  }
  function productsView(c) {
    const sv = c.sector_view;
    return h('div', { class: 'stack' }, h('p', { class: 'label' }, `Products (up to ${s.max_products})`),
      sv.products.map((t) => {
        const p = c.products.find((x) => x.key === t.key);
        const price = h('input', { inputmode: 'decimal', 'aria-label': `${t.name} price`, value: p ? (p.price_cents / 100).toFixed(2) : (t.best_cents / 100).toFixed(2) });
        const qty = h('input', { inputmode: 'numeric', 'aria-label': `${t.name} units a month`, value: String(p?.quantity ?? 0) });
        const fixed = h('input', { inputmode: 'decimal', 'aria-label': 'Fixed costs a month', value: '0' }), out = h('p', { class: 'small', 'aria-live': 'polite' });
        const be = () => { const P = dollarsToCents(price.value), F = dollarsToCents(fixed.value) ?? 0; const m = P === null ? null : P - t.unit_cost_cents;
          out.textContent = m === null ? '' : m <= 0 ? 'At this price every unit loses money: no break-even.' : `Margin ${fmt(m)} a unit. Break-even: ${Math.ceil(F / m)} units a month to cover ${fmt(F)} of fixed costs; ${Math.ceil(c.treasury_cents / m)} units to earn back today's treasury.`; };
        price.addEventListener('input', be); fixed.addEventListener('input', be); be();
        const chart = demandChart({ ...t, a: t.a, b: t.b, price_cents: p?.price_cents ?? t.best_cents, name: t.name });
        return h('div', { class: 'class-card stack' }, h('h3', {}, t.name, p ? ' (selling)' : ''),
          h('p', { class: 'small' }, `Unit cost ${fmt(t.unit_cost_cents)} (materials ${fmt(t.materials_cents)} + ${t.minutes} min at the minimum wage). Price cap ${fmt(t.cap_cents)}. Town demand: Q = ${t.a} - ${t.b} x P; nobody buys above ${fmt(t.choke_cents)}; revenue peaks at ${fmt(t.best_cents)}. The town's own shop sells it at ${fmt(t.shop_cents)}: price under it to win customers. ${t.sellers} compan${t.sellers === 1 ? 'y sells' : 'ies sell'} it.`),
          chart,
          p ? h('p', { class: 'small' }, `In stock: ${p.inventory_units} (${fmt(p.inventory_cost_cents)} at cost). At your price the whole town would buy about ${p.demand_at_price} a month.`) : null,
          p?.last ? h('p', { class: 'small' }, `Month ${p.last.month}: town demand ${p.last.demand_units}, sold ${p.last.sold_units}, revenue ${fmt(p.last.revenue_cents)}, cost ${fmt(p.last.cost_cents)}, margin ${fmt(p.last.margin_cents)}.`) : null,
          p?.note ? h('p', { class: 'error small' }, p.note) : null,
          h('div', {}, h('label', {}, 'Price $ ', price), ' ', h('label', {}, 'Make a month ', qty), ' ',
            h('button', { type: 'button', onclick: () => { const cents = dollarsToCents(price.value), q = Number(qty.value); if (cents === null || !Number.isInteger(q)) return say('Enter a price in dollars and a whole number of units', true); return act('/product', { id: c.id, product: t.key, price_cents: cents, quantity: q }, (r) => `Saved. Next month's run costs ${fmt(r.monthly_cost_cents)}.`); } }, p ? 'Update' : 'Start selling'),
            p ? [' ', btn('Drop', '/drop', { id: c.id, product: t.key }, 'Dropped: what was in stock was written off.', 'ghost')] : null),
          h('details', {}, h('summary', {}, 'Break-even calculator'), h('label', {}, 'Fixed costs a month $ ', fixed), out));
      }));
  }
  function statementsView(c) {
    if (!c.statements.length) return h('p', { class: 'muted' }, 'Statements start after your first world month.');
    const st = c.statements.find((x) => x.month === stMonth) ?? c.statements[0];
    const pick = h('select', { 'aria-label': 'Statement month', onchange: (e) => { stMonth = Number(e.target.value); draw(); } }, c.statements.map((x) => h('option', { value: String(x.month), selected: x.month === st.month }, `Month ${x.month}${x.final ? ' (final)' : ''}`)));
    const row = (k, v, cls = '') => h('tr', { class: cls }, h('td', {}, k), h('td', { class: 'num' }, fmt(v || 0)));   // || 0: no "-$0.00"
    const t = (title, rows) => h('div', { class: 'class-card' }, h('p', { class: 'label' }, title), h('table', {}, h('tbody', {}, rows)));
    const i = st.income, b = st.balance, f = st.cashflow;
    return h('div', { class: 'stack' }, h('div', { class: 'spread' }, h('p', { class: 'label' }, 'Statements'), pick), h('div', { class: 'vr-grid' },
      t('Income statement', [row('Revenue: town', i.npc_cents), row('Revenue: classmates', i.store_cents), row('Cost of goods sold', -i.cogs_cents), row('Spoilage and write-offs', -i.spoilage_cents), row('Rent', -(i.rent_cents ?? 0)), row('Wages', -i.wages_cents), row('Employer CPP and EI', -(i.employer_cents ?? 0)),
        row('Interest', -i.interest_cents), row('Late fees', -(i.fees_cents ?? 0)), i.forgiven_cents ? row('Loan forgiven (a gain)', i.forgiven_cents) : null, row('Income before tax', i.pretax_cents ?? i.net_cents, 'muted'), row('Income tax', -i.tax_cents), row('Net income', i.net_cents, 'ok')]),
      t(`Balance sheet${b.balanced ? '' : ' (DOES NOT BALANCE)'}`, [row('Cash', b.cash_cents), row('Inventory at cost', b.inventory_cents), row('Total assets', b.assets_cents, 'muted'), row('Loan (Venture Bank)', b.loans_cents), row('GST payable', b.gst_payable_cents ?? 0), row('Income tax owed', b.tax_owed_cents ?? 0),
        row('Share capital', b.share_capital_cents), row('Retained earnings', b.retained_cents), row('Distributions', -b.distributions_cents), row('Total liabilities and equity', (b.liabilities_cents ?? b.loans_cents) + b.equity_cents, 'muted')]),
      t('Cash flow', [row('Opening cash', f.opening_cents), row('Operating (sales and GST less production, rent, wages, interest and taxes paid)', f.operating_cents), row('Financing (capital and loans in, less refunds, repayments and payouts)', f.financing_cents), row('Closing cash', f.closing_cents, 'ok')])),
      st.products.length ? h('div', { class: 'table-wrap' }, h('table', {}, h('thead', {}, h('tr', {}, ['Product', 'Demand', 'Sold (town + class)', 'Revenue', 'Cost', 'Margin', 'Made', 'Spoiled'].map((x) => h('th', {}, x)))),
        h('tbody', {}, st.products.map((p) => h('tr', {}, h('td', {}, p.product), h('td', { class: 'num' }, String(p.demand_units)), h('td', { class: 'num' }, `${p.npc_units} + ${p.store_units}`), h('td', { class: 'num' }, fmt(p.revenue_cents)),
          h('td', { class: 'num' }, fmt(p.cogs_cents + p.spoilage_cents)), h('td', { class: 'num' }, fmt(p.margin_cents)), h('td', { class: 'num' }, String(p.produced_units)), h('td', { class: 'num' }, String(p.spoiled_units))))))) : null);
  }
  // ---- 4b: staff and hiring, GST and the T2 slip, the Venture Bank ----
  function staffView(c) {
    const f = c.finance, title = h('input', { maxlength: 60, 'aria-label': 'Job title', placeholder: 'Shop assistant' });
    const wage = h('input', { inputmode: 'decimal', 'aria-label': 'Hourly wage (CAD)', value: (f.min_wage_cents / 100).toFixed(2) }), hours = h('input', { inputmode: 'numeric', 'aria-label': 'Hours a month', value: '20' });
    const slots = h('select', { 'aria-label': 'Places to fill' }, Array.from({ length: f.max_slots }, (_, i) => h('option', { value: String(i + 1) }, String(i + 1))));
    const post = () => { const cents = dollarsToCents(wage.value), n = Number(hours.value); if (cents === null || !Number.isInteger(n)) return say('Enter a wage in dollars and whole hours', true); return act('/post-job', { id: c.id, title: title.value, hourly_cents: cents, hours: n, slots: Number(slots.value) }, 'Posted: students see it on the Job Centre board.'); };
    return h('div', { class: 'class-card stack' }, h('p', { class: 'label' }, `Staff and payroll (${f.paydays} pays on time, ${f.missed_paydays} missed)`),
      h('p', { class: 'muted small' }, `Company jobs are part-time, on top of each student's own job: ${f.min_hours} to ${f.max_hours} hours a month. Wages come from the treasury at payday, plus the employer's share: CPP equal to the employee's and EI at 1.4 x theirs. If the treasury cannot cover a pay, that person is not paid and your reputation drops. Minimum wage ${fmt(f.min_wage_cents)} an hour (Alberta's $15.00 at today's prices). A posting closes when its places are filled.${f.hire_approval ? ' Your teacher approves each hire after you.' : ''}`),
      f.staff.length ? h('div', { class: 'table-wrap' }, h('table', {}, h('thead', {}, h('tr', {}, ['Employee', 'Job', 'Per hour', 'Hours', 'Since', ''].map((x) => h('th', {}, x)))),
        h('tbody', {}, f.staff.map((m) => h('tr', {}, h('td', {}, m.username), h('td', {}, m.title), h('td', { class: 'num' }, fmt(m.hourlyCents)), h('td', { class: 'num' }, String(m.hoursPerMonth)), h('td', {}, `month ${m.sinceMonth}${m.missed ? `, ${m.missed} missed` : ''}`),
          h('td', {}, m.endsMonth ? `Leaves after the month ${m.endsMonth} payday` : [btn('Give notice', '/layoff', { id: c.id, player_id: m.playerId, mode: 'notice' }, 'One month\'s notice given.', 'ghost', `Give ${m.username} one month's notice`), ' ',
            h('button', { type: 'button', class: 'ghost', 'aria-label': `Lay off ${m.username} now with one month's pay`, onclick: () => confirmAction(`Lay off ${m.username} now and pay one month's wages from the treasury?`) && act('/layoff', { id: c.id, player_id: m.playerId, mode: 'severance' }, 'Laid off with one month\'s pay.') }, 'Lay off now')])))))) : h('p', { class: 'muted small' }, 'No staff yet.'),
      f.postings.map((p) => h('div', { class: 'class-card' }, h('strong', {}, `${p.title}: ${fmt(p.hourly_cents)} an hour, ${p.hours} h a month, ${p.filled} of ${p.slots} place${p.slots === 1 ? '' : 's'} filled`), ' ', btn('Close', '/close-job', { id: c.id, posting_id: p.id }, 'Posting closed.', 'ghost', `Close the ${p.title} posting`),
        p.applications.length ? h('ul', {}, p.applications.map((a) => h('li', {}, `${a.username} (month ${a.month}) `, a.status === 'approved' ? h('span', { class: 'badge' }, 'waiting for the teacher')
          : [btn('Hire', '/hire', { id: c.id, application_id: a.id, approve: true }, (r) => (r.status === 'hired' ? `${a.username} is hired: their pay starts at the next payday.` : 'Sent to your teacher.'), undefined, `Hire ${a.username} as ${p.title}`), ' ',
            btn('Decline', '/hire', { id: c.id, application_id: a.id, approve: false }, 'Declined.', 'ghost', `Decline ${a.username}`)]))) : h('p', { class: 'muted small' }, 'No applications yet.'))),
      c.status === 'active' ? h('div', {}, h('label', {}, 'Title ', title), ' ', h('label', {}, '$/h ', wage), ' ', h('label', {}, 'Hours a month ', hours), ' ', h('label', {}, 'Places ', slots), ' ', h('button', { type: 'button', onclick: post }, 'Post a job')) : null);
  }
  function taxView(c) {
    const g = c.finance.gst, t = c.finance.tax, slip = t.slips[0];
    const line = (k, v) => h('tr', {}, h('td', {}, k), h('td', { class: 'num' }, fmt(v || 0)));
    return h('div', { class: 'class-card stack' }, h('p', { class: 'label' }, 'Small business tax and GST'),
      h('p', { class: 'small' }, `Income tax: ${pc(t.rate_bp)} of net income (federal ${pc(t.federal_bp)} + Alberta ${pc(t.alberta_bp)}), at the start of each world year; a loss is carried forward against later years. Loss carried forward now: ${fmt(t.loss_cf_cents)}. Owed: ${fmt(t.owed_cents)}. `, h('a', { href: t.url, target: '_blank', rel: 'noopener noreferrer' }, 'CRA rates')),
      h('p', { class: 'small' }, g.registered ? `GST registered${g.mandatory ? ' (required: sales passed the threshold)' : ''}, charging ${pc(g.rate_bp)} from month ${g.since}. ${g.accrued_cents >= 0 ? `GST you hold now for the CRA: ${fmt(g.accrued_cents)}.` : `Your input tax credits are ahead of the GST you collected: the CRA owes you ${fmt(-g.accrued_cents)} (refunded when the quarter is filed).`}`
        : `Not registered for GST. Sales over the last 12 months: ${fmt(g.sales_12m_cents)} of the ${fmt(g.threshold_cents)} small-supplier threshold; past it, registration is required. `, g.registered ? null : h('a', { href: g.url, target: '_blank', rel: 'noopener noreferrer' }, 'CRA: when to register')),
      g.registered ? null : btn('Register for GST now', '/gst', { id: c.id }, (r) => `Registered: you charge GST and claim input tax credits from month ${r.since}.`, 'ghost'),
      g.returns.length ? h('div', { class: 'table-wrap' }, h('table', {}, h('thead', {}, h('tr', {}, ['GST return', 'Sales', 'GST collected', 'Input tax credits', 'Net', 'Remitted'].map((x) => h('th', {}, x)))),
        h('tbody', {}, g.returns.map((r) => h('tr', {}, h('td', {}, `Quarter ${r.quarter} (to month ${r.month})`), ...[r.sales_cents, r.collected_cents, r.itc_cents, r.net_cents, r.remitted_cents].map((v) => h('td', { class: 'num' }, fmt(v || 0)))))))) : null,
      slip ? h('div', {}, h('p', { class: 'label' }, `T2 (short form), world year ${slip.year}`), h('table', {}, h('tbody', {}, line('Net income', slip.net_income_cents), line('Losses carried in', slip.loss_before_cents), line('Losses applied', -slip.losses_applied_cents), line('Taxable income', slip.taxable_cents),
        line(`Tax (${pc(t.rate_bp)})`, slip.tax_cents), line('Loss carried forward', slip.loss_cf_cents), line('GST collected', slip.gst_collected_cents), line('Input tax credits', -slip.gst_itc_cents), line('GST remitted', slip.gst_remitted_cents)))) : h('p', { class: 'muted small' }, 'Your first T2 comes at the start of the next world year.'));
  }
  function bankView(c) {
    const o = c.finance.loan_offer, l = c.finance.loan;
    const amt = h('input', { inputmode: 'decimal', 'aria-label': 'Loan amount (CAD)', placeholder: (o.max_cents / 100).toFixed(2) }), term = h('input', { inputmode: 'numeric', 'aria-label': 'Term in months', value: '24' });
    const open = l && ['active', 'default'].includes(l.status);
    return h('div', { class: 'class-card stack' }, h('p', { class: 'label' }, 'The Venture Bank'),
      h('p', { class: 'muted small' }, `It lends to the company, not to you: payments come from the treasury, and your own credit is never touched. Rate: the Bank of DAA policy rate ${pc(o.policy_bp)} + ${pc(o.spread_bp)} = ${pc(o.rate_bp)} a year, paid monthly over ${o.min_term} to ${o.max_term} months. A missed payment adds the month's interest and a ${fmt(o.late_fee_cents)} late fee to the loan; ${o.default_misses} misses are a default and the company is frozen until your teacher resolves it.`),
      l ? h('p', { class: l.status === 'default' ? 'error' : 'small' }, `Loan of ${fmt(l.principal_cents)} at ${pc(l.rate_bp)} over ${l.term_months} months (from month ${l.start_month}): ${l.status}. Owed ${fmt(l.owed_cents)}; payment ${fmt(l.payment_cents)}; ${l.months_paid} paid, ${l.misses} missed.`) : null,
      open && l.schedule.length ? h('details', {}, h('summary', {}, 'The next 12 payments'), h('table', {}, h('thead', {}, h('tr', {}, ['#', 'Interest', 'Principal', 'Payment', 'Owed after'].map((x) => h('th', {}, x)))),
        h('tbody', {}, l.schedule.map((r) => h('tr', {}, h('td', {}, String(r.n)), ...[r.interest, r.principal, r.due, r.balance_cents].map((v) => h('td', { class: 'num' }, fmt(v)))))))) : null,
      !open && c.status === 'active' ? h('div', {}, h('p', { class: 'small' }, `You can borrow ${fmt(o.min_cents)} to ${fmt(o.max_cents)} (${o.new_company ? 'a new company with an approved plan' : '3 x your average monthly revenue, last 3 months'}).`),
        h('label', {}, 'Amount $ ', amt), ' ', h('label', {}, 'Months ', term), ' ',
        h('button', { type: 'button', onclick: () => { const cents = dollarsToCents(amt.value), n = Number(term.value); if (cents === null || !Number.isInteger(n)) return say('Enter an amount in dollars and whole months', true); return act('/borrow', { id: c.id, cents, term: n }, (r) => `Borrowed. Payment ${fmt(r.payment_cents)} a month at ${pc(r.rate_bp)}.`); } }, 'Borrow')) : null);
  }
  const journalView = (c) => h('details', {}, h('summary', {}, `Journal (${c.journal.length} postings)`), h('div', { class: 'table-wrap' }, h('table', {},
    h('thead', {}, h('tr', {}, ['Kind', 'Debit', 'Credit', 'Memo', 'Amount', 'Cash after'].map((x) => h('th', {}, x)))),
    h('tbody', {}, c.journal.map((e) => h('tr', {}, h('td', {}, e.kind.replace('ventures.', '')), h('td', {}, e.debit), h('td', {}, e.credit), h('td', { class: 'small' }, e.memo ?? ''), h('td', { class: 'num' }, fmt(e.cents)), h('td', { class: 'num' }, fmt(e.balance_cents))))))),
  h('p', { class: 'muted small' }, 'Inventory moves (units sold or spoiled, at cost) are not cash, so they are in the statements, not in this cash journal.'));
  function dissolveBox(c) {
    const me = c.members.find((m) => m.player_id === ctx.me?.user?.id);
    return h('details', {}, h('summary', {}, 'Dissolve the company'), h('p', { class: 'small' }, 'If every founder votes to dissolve, the treasury is paid to the shareholders by share and the stock is written off. You cannot found another company this season.'),
      h('p', { class: 'small' }, `Votes: ${c.members.filter((m) => m.dissolve_vote).length} of ${c.members.length}.`),
      me?.dissolve_vote ? btn('Take my vote back', '/vote-dissolve', { id: c.id, approve: false }, 'Vote taken back.', 'ghost') : btn('Vote to dissolve', '/vote-dissolve', { id: c.id, approve: true }, (r) => (r.dissolved ? 'Dissolved: your share is in chequing.' : 'Vote recorded.'), 'ghost'));
  }

  // ---- storefronts ----
  function shopsTab() {
    const src = h('select', { 'aria-label': 'Pay from' }, h('option', { value: 'chequing' }, `Chequing (${fmt(s.pay.chequing_cents)})`), s.pay.card_available_cents != null ? h('option', { value: 'card' }, `Card (${fmt(s.pay.card_available_cents)} available)`) : null);
    return [h('p', { class: 'muted small' }, 'Student companies in town. What you buy is a real payment to the company\'s treasury, and comes with a cosmetic item at Outfitters (once per kind of shop each season).'),
      h('label', {}, 'Pay from ', src), h('p', { class: 'small' }, `You can spend ${fmt(s.pay.cap_company_cents)} a world month at one company and ${fmt(s.pay.cap_month_cents)} on Venture Row in all: ${fmt(s.pay.left_month_cents)} left this month.`),
      s.board.length ? h('div', { class: 'vr-grid' }, s.board.map((b) => h('div', { class: 'class-card stack' }, h('h3', {}, b.name, b.mine ? ' (yours)' : ''), b.mine ? null : h('p', { class: 'muted small' }, `${fmt(b.allowance_cents)} left to spend here this month`), h('p', { class: 'label' }, `${b.sector} · ${b.revenue_band}${b.profitable === null ? '' : b.profitable ? ' · profitable' : ' · not yet profitable'}`),
        b.status === 'frozen' ? h('p', { class: 'muted' }, 'Closed for now.') : b.products.map((p) => h('p', {}, `${p.name}: ${fmt(p.price_cents)} (${p.in_stock ? 'in stock' : 'sold out'}) `,
          b.mine ? null : h('button', { type: 'button', disabled: !p.in_stock || p.price_cents > b.allowance_cents, onclick: () => act('/buy', { id: p.id, source: src.value }, (r) => `Bought: ${r.receipt}.${r.item ? ` ${r.item} is waiting at Outfitters.` : ''}`) }, 'Buy one')))))) : h('p', { class: 'muted' }, 'No companies are open yet.'),
      s.receipts.length ? h('div', { class: 'stack' }, h('p', { class: 'label' }, 'Your receipts'), h('ul', {}, s.receipts.map((r) => h('li', {}, `Month ${r.month}: ${r.product} from ${r.company}, ${fmt(r.cents)} (${r.source})${r.item ? ` + ${r.item}` : ''}`)))) : null];
  }
  // ---- sectors ----
  const sectorsTab = () => [h('p', { class: 'muted small' }, `Town customers: a simulated town of ${s.town_size} residents (more student companies split the same town). Unit cost = materials + time at Alberta's $15.00/h minimum wage. Materials, demand and spoilage are illustrative teaching figures.`),
    ...s.sector_views.map((v) => h('div', { class: 'class-card' }, h('h3', {}, v.sector), h('p', { class: 'small' }, `Unsold stock lost each month: ${pc(v.spoilage_bp)}. Customers are ${v.elasticity === 'elastic' ? 'price-sensitive (elastic)' : v.elasticity === 'inelastic' ? 'not very price-sensitive (inelastic)' : 'average'}.`),
      h('div', { class: 'table-wrap' }, h('table', {}, h('thead', {}, h('tr', {}, ['Product', 'Unit cost', 'Cap', 'a', 'b', 'Nobody buys above', 'Revenue peaks at', 'Town shop price', 'Sellers'].map((x) => h('th', {}, x)))),
        h('tbody', {}, v.products.map((p) => h('tr', {}, h('td', {}, p.name), h('td', { class: 'num' }, fmt(p.unit_cost_cents)), h('td', { class: 'num' }, fmt(p.cap_cents)), h('td', { class: 'num' }, String(p.a)), h('td', { class: 'num' }, String(p.b)),
          h('td', { class: 'num' }, fmt(p.choke_cents)), h('td', { class: 'num' }, fmt(p.best_cents)), h('td', { class: 'num' }, fmt(p.shop_cents)), h('td', { class: 'num' }, String(p.sellers))))))))) ];

  el.append(h('h2', {}, 'Venture Row'), tabs, msg, body);
  ctx.onRefresh(() => load().catch(() => {}));
  await load();
}
