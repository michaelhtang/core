import { h, api, fmt, dollarsToCents, when, guard } from '/ui.js?v=__V__';

// Bank panel, laid out like a bank app: an account card (balance, money in and out this month, last direct deposit), then the
// transaction history grouped by world month with a running balance and filters, then (only if the teacher turned it on for this
// class) sending money to a classmate. Everything here is read from GET /api/bank-basic/history; nothing on this screen moves money
// except the send form, which posts to /api/bank-basic/transfer as before. Re-renders only the live parts, so a half-typed form is never wiped.
if (!document.querySelector('link[data-bank]')) document.head.append(h('link', { rel: 'stylesheet', href: new URL('bank.css', import.meta.url).href, 'data-bank': '' }));

const SVG = 'http://www.w3.org/2000/svg';
const GLYPH = {               // small line icons, one per category (static paths, built with createElementNS)
  pay: 'M3 7h18v10H3zM12 9.500a2.500 2.500 0 1 0 0 5 2.500 2.500 0 0 0 0-5M6 10v4M18 10v4',
  bills: 'M6 3h12v18l-3-2-3 2-3-2-3 2zM9 8h6M9 12h6M9 16h3',
  shopping: 'M5 8h14l-1 12H6zM9 8V6a3 3 0 0 1 6 0v2',
  loans: 'M4 10l8-5 8 5M6 10v8M10 10v8M14 10v8M18 10v8M4 20h16',
  savings: 'M4 19h16M6 15l4-4 3 3 5-6M15 8h3v3',
  transfers: 'M4 8h14l-3-3M20 16H6l3 3',
  rewards: 'M12 3l2.600 5.400 5.900.800-4.300 4.100 1 5.800L12 16.300 6.800 19.100l1-5.800L3.500 9.200l5.900-.800z',
  other: 'M5 12h.01M12 12h.01M19 12h.01',
};
function glyph(cat) {
  const svg = document.createElementNS(SVG, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  const p = document.createElementNS(SVG, 'path');
  p.setAttribute('d', GLYPH[cat] ?? GLYPH.other);
  svg.append(p);
  return h('span', { class: `bk-glyph bk-${cat}` }, svg);
}

const signed = (c) => `${c > 0 ? '+' : c < 0 ? '−' : ''}${fmt(Math.abs(c))}`;
const monthName = (m, now) => `Month ${m} (year ${Math.floor((m - 1) / 12) + 1}, month ${((m - 1) % 12) + 1} of 12)${m === now ? ', this month' : ''}`;

export async function render(el, ctx) {
  let kind = 'chequing';
  let data = null;            // the first page; older pages are appended to `rows`
  let rows = [];
  let next;
  let filter = 'all';

  const tabs = h('div', { class: 'bk-tabs', role: 'group', 'aria-label': 'Account' });
  const card = h('section', { class: 'bk-card', 'aria-label': 'Account summary' });
  const sendBox = h('div', {});
  const msg = h('p', { role: 'status' });
  const filters = h('div', { class: 'bk-filters', role: 'group', 'aria-label': 'Show' });
  const list = h('div', { class: 'bk-history' });
  const more = h('div', {});

  async function load() {
    const [d, status] = await Promise.all([api(`/api/bank-basic/history?account=${kind}`), kind === 'chequing' ? api('/api/bank-basic/status') : null]);
    data = d; rows = d.entries; next = d.next;
    paint();
    if (status) showSend(status); else { shown = null; sendBox.replaceChildren(); }
  }
  async function older() {
    const d = await api(`/api/bank-basic/history?account=${kind}&before=${next}`);
    rows = rows.concat(d.entries); next = d.next;
    paintList();
  }

  function paint() {
    tabs.replaceChildren(...(data.accounts.length > 1 ? data.accounts.map((a) => h('button', {
      type: 'button', class: 'bk-tab', 'aria-pressed': String(a.kind === kind),
      onclick: guard(async () => { if (a.kind === kind) return; kind = a.kind; filter = 'all'; await load(); }),
    }, h('span', {}, a.label), h('b', {}, fmt(a.balance_cents)))) : []));

    const t = data.this_month, l = data.last_month, m = data.month;
    card.replaceChildren(
      h('p', { class: 'bk-acct' }, `${data.account.label} · account ending ${data.account.ending}`),
      h('p', { class: 'bk-bal' }, fmt(data.account.balance_cents)),
      h('p', { class: 'muted small' }, kind === 'chequing' ? 'Available balance' : 'Balance'),
      h('div', { class: 'bk-stats' },
        h('div', {}, h('span', {}, `Money in, month ${m}`), h('b', { class: 'plus' }, signed(t.in_cents)), l ? h('small', {}, `Last month ${signed(l.in_cents)}`) : null),
        h('div', {}, h('span', {}, `Money out, month ${m}`), h('b', {}, t.out_cents ? signed(-t.out_cents) : fmt(0)), l ? h('small', {}, `Last month ${l.out_cents ? signed(-l.out_cents) : fmt(0)}`) : null),
        kind === 'chequing' ? h('div', {}, h('span', {}, 'Last direct deposit'),
          data.last_pay ? h('b', { class: 'plus' }, signed(data.last_pay.cents)) : h('b', {}, 'None yet'),
          h('small', {}, data.last_pay ? `Payday, month ${data.last_pay.month}` : 'Your pay arrives here on payday once you have a job')) : null));
    paintList();
  }

  const FIXED = { all: 'All', in: 'Money in', out: 'Money out' };
  const keep = (e) => filter === 'all' || (filter === 'in' ? e.amount_cents > 0 : filter === 'out' ? e.amount_cents < 0 : e.category === filter);
  function paintList() {
    const present = Object.keys(data.categories).filter((c) => rows.some((e) => e.category === c));
    if (filter !== 'all' && !FIXED[filter] && !present.includes(filter)) filter = 'all';
    const chip = (key, label) => h('button', { type: 'button', class: 'bk-chip', 'aria-pressed': String(filter === key), onclick() { filter = key; paintList(); } }, label);
    filters.replaceChildren(...Object.entries(FIXED).map(([k, v]) => chip(k, v)), ...present.map((c) => chip(c, data.categories[c])));

    const groups = [];
    for (const e of rows) (groups.at(-1)?.month === e.month ? groups.at(-1) : groups[groups.push({ month: e.month, rows: [] }) - 1]).rows.push(e);
    const shownGroups = groups.map((g) => ({ ...g, shown: g.rows.filter(keep) })).filter((g) => g.shown.length);
    if (!rows.length) list.replaceChildren(h('p', { class: 'muted' }, 'No transactions yet this season.'));
    else if (!shownGroups.length) list.replaceChildren(h('p', { class: 'muted' }, 'Nothing to show for this filter yet.'));
    else list.replaceChildren(...shownGroups.map((g) => {
      const inn = g.rows.reduce((s, e) => s + Math.max(0, e.amount_cents), 0), out = g.rows.reduce((s, e) => s + Math.max(0, -e.amount_cents), 0);
      return h('section', { class: 'bk-month' },
        h('header', {}, h('h3', {}, monthName(g.month, data.month)), h('span', { class: 'muted small' }, `In ${signed(inn)} · Out ${out ? signed(-out) : fmt(0)}`)),
        h('ul', { class: 'bk-list' }, g.shown.map((e) => h('li', { class: 'bk-row', title: `Posted ${when(e.created)}` },
          glyph(e.category),
          h('div', { class: 'bk-what' }, h('b', {}, e.title), h('small', {}, data.categories[e.category])),
          h('div', { class: 'bk-amt' }, h('b', { class: e.amount_cents > 0 ? 'plus' : '' }, signed(e.amount_cents)), h('small', {}, `Balance ${fmt(e.balance_cents)}`))))));
    }));
    more.replaceChildren(next ? h('button', { type: 'button', class: 'ghost', onclick: guard(older) }, 'Show older transactions') : rows.length ? h('p', { class: 'muted small' }, 'That is everything this season.') : '');
  }

  let shown = null;
  function showSend(status) {
    const key = JSON.stringify([status.enabled, status.per_transfer_cents, status.daily_cents, status.sent_24h_cents]);
    if (key === shown) return;
    shown = key;
    if (!status.enabled) {
      sendBox.replaceChildren(h('p', { class: 'muted small' }, 'Sending money to classmates is turned off for your class.'));
      return;
    }
    const left = Math.max(0, status.daily_cents - status.sent_24h_cents);
    const form = h('form', { onsubmit: guard(async (ev) => {
      ev.preventDefault();
      msg.className = 'error';
      const cents = dollarsToCents(form.amount.value);
      if (!cents) { msg.textContent = 'Enter an amount like 12.50'; return; }
      try {
        await api('/api/bank-basic/transfer', { to: form.to.value.trim(), cents });
        msg.className = 'ok';
        msg.textContent = `Sent ${fmt(cents)} to ${form.to.value.trim()}.`;
        form.reset();
      } catch (ex) { msg.textContent = ex.message; }
    }) },
    h('p', { class: 'label' }, 'Send to a classmate'),
    h('p', { class: 'muted small' }, `Up to ${fmt(status.per_transfer_cents)} per transfer and ${fmt(status.daily_cents)} in any 24 hours (${fmt(left)} left in the last 24 hours).`),
    h('div', { class: 'row' },
      h('label', { class: 'grow' }, 'Their username', h('input', { name: 'to', autocapitalize: 'none', spellcheck: 'false', required: true })),
      h('label', { class: 'grow' }, 'Amount (CAD)', h('input', { name: 'amount', inputmode: 'decimal', placeholder: '0.00', required: true })),
      h('button', { type: 'submit' }, 'Send')));
    sendBox.replaceChildren(form);
  }

  el.append(
    h('h2', {}, 'Bank'),
    tabs, card,
    sendBox, msg,
    h('p', { class: 'label' }, 'Transactions'),
    h('p', { class: 'muted small' }, 'Every dollar in and out of this account, newest first. Pay arrives by direct deposit on payday, at the start of each month.'),
    filters, list, more);
  ctx.onRefresh(() => load().catch(() => {}));
  await load();
}
