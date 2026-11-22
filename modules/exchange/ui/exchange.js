import { h, api, fmt, dollarsToCents, guard } from '/ui.js?v=__V__';

// The Exchange: a news strip, the market (price, 12-month sparkline, change, dividend yield, MER, Rule of 72), a trade ticket with a live preview of what an order costs
// including the spread, your portfolio by account with an allocation pie, open orders, the TFSA box and the RRSP (room, withholding, the year-end tax slip, TFSA vs RRSP). Forms are built once and only the data parts are redrawn, so half-typed
// numbers survive a refresh. All SVG is built node by node; nothing from the server goes through innerHTML.
const NS = 'http://www.w3.org/2000/svg';
const svg = (tag, attrs = {}, ...kids) => {
  const el = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
  el.append(...kids);
  return el;
};
const TABS = [['markets', 'Markets'], ['trade', 'Trade'], ['portfolio', 'Portfolio'], ['orders', 'Orders'], ['tfsa', 'TFSA'], ['rrsp', 'RRSP']];
const ACCOUNT = { invest: 'Non-registered', tfsa: 'TFSA', rrsp: 'RRSP' };
const pct = (bp, signed = false) => `${signed && bp > 0 ? '+' : ''}${(bp / 100).toFixed(bp % 10 ? 2 : 1)}%`;
const units = (micro) => (micro / 1e6).toFixed(4).replace(/\.?0+$/, '');
// "12.5" -> 12500000 micro-units (at most 4 decimals); null if it is not a plain number
const parseUnits = (text) => { const m = /^\s*(\d{1,7})(?:\.(\d{1,4}))?\s*$/.exec(text); return m ? Number(m[1]) * 1e6 + Number((m[2] ?? '').padEnd(4, '0')) * 100 : null; };
const cls = (n) => (n > 0 ? 'ex-up' : n < 0 ? 'ex-down' : '');

export function sparkline(points, up) {
  const W = 240, H = 54, pad = 3;
  const chart = svg('svg', { class: `ex-spark ${up ? 'ex-up' : 'ex-down'}`, viewBox: `0 0 ${W} ${H}`, role: 'img', preserveAspectRatio: 'none', 'aria-label': 'Price over the last 12 months' });
  if (points.length < 2) { chart.append(svg('text', { x: 4, y: H / 2 + 4 }, 'Prices start after the first month.')); return chart; }
  const lo = Math.min(...points), hi = Math.max(...points), span = hi - lo || 1;
  const x = (i) => pad + (i / (points.length - 1)) * (W - 2 * pad), y = (v) => H - pad - ((v - lo) / span) * (H - 2 * pad);
  const line = points.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
  chart.append(svg('polygon', { class: 'ex-area', points: `${x(0).toFixed(1)},${H} ${line} ${x(points.length - 1).toFixed(1)},${H}` }), svg('polyline', { points: line }));
  return chart;
}

function pie(slices) {
  const total = slices.reduce((t, s) => t + s.cents, 0);
  const chart = svg('svg', { class: 'ex-pie', viewBox: '-1 -1 2 2', role: 'img', 'aria-label': 'How your investments are split' });
  if (!total) return chart;
  if (slices.length === 1) { chart.append(svg('circle', { cx: 0, cy: 0, r: 1, class: 'ex-c0' })); return chart; }
  let a0 = -Math.PI / 2;
  slices.forEach((s, i) => {
    const a1 = a0 + (s.cents / total) * 2 * Math.PI, big = a1 - a0 > Math.PI ? 1 : 0;
    chart.append(svg('path', { class: `ex-c${i % 11}`, d: `M0 0 L${Math.cos(a0).toFixed(4)} ${Math.sin(a0).toFixed(4)} A1 1 0 ${big} 1 ${Math.cos(a1).toFixed(4)} ${Math.sin(a1).toFixed(4)} Z` }));
    a0 = a1;
  });
  return chart;
}

export async function render(el, ctx) {
  if (!document.querySelector('link[data-exchange]')) document.head.append(h('link', { rel: 'stylesheet', href: new URL('exchange.css', import.meta.url).href, 'data-exchange': '' }));
  let s = null, last = '', tab = 'markets', timer = null;
  const t = { ticker: 'DAAX', account: 'tfsa', side: 'buy', type: 'market', mode: 'dollars' };    // the ticket
  const msg = h('p', { role: 'status' });
  const say = (text, bad) => { msg.className = bad ? 'error' : 'ok'; msg.textContent = text; };
  const act = async (path, data, ok) => { try { const r = await api(path, data); say(typeof ok === 'function' ? ok(r) : ok); } catch (e) { say(e.message, true); } await load(); };
  const wallet = h('div', { class: 'ex-wallet' }), banner = h('div', { class: 'stack' }), news = h('div', { class: 'ex-newswrap' }), body = h('div', { class: 'stack' });
  const sec = (ticker) => s.securities.find((q) => q.ticker === ticker);

  // ---- the trade ticket (built once) ----
  const pick = h('select', { 'aria-label': 'Security', onchange: (e) => { t.ticker = e.target.value; sync(); preview(); } });
  const acctSel = h('select', { 'aria-label': 'Account', onchange: (e) => { t.account = e.target.value; preview(); } });
  const amount = h('input', { name: 'amount', inputmode: 'decimal', autocomplete: 'off', 'aria-label': 'Amount', oninput: () => preview() });
  const amountLabel = h('span'), limitLabel = h('span');
  const modeSel = h('select', { 'aria-label': 'Order by', onchange: (e) => { t.mode = e.target.value; sync(); preview(); } });
  const limitIn = h('input', { name: 'limit', inputmode: 'decimal', autocomplete: 'off', placeholder: '0.00', 'aria-label': 'Limit price (CAD)', oninput: () => preview() });
  const limitBox = h('label', { hidden: true }, limitLabel, limitIn);
  const preview_ = h('div', { class: 'ex-preview', role: 'status', 'aria-live': 'polite' });
  const submit = h('button', { type: 'submit' }, 'Place order');
  const seg = (key, opts) => h('div', { class: 'ex-seg', role: 'group' }, opts.map(([v, label]) => h('button', { type: 'button', class: 'ghost', 'data-v': v, 'aria-pressed': String(t[key] === v), onclick: () => { t[key] = v; sync(); preview(); } }, label)));
  const sideSeg = seg('side', [['buy', 'Buy'], ['sell', 'Sell']]), typeSeg = seg('type', [['market', 'Market order'], ['limit', 'Limit order']]);
  const placeOrder = guard(async (e) => { e.preventDefault(); await place(); });
  const ticket = h('form', { class: 'ex-ticket', onsubmit: async (e) => { await placeOrder(e); sync(); } },   // sync() after the guard lets go: it decides whether Place order is disabled
    sideSeg, typeSeg,
    h('div', { class: 'ex-fields' }, h('label', {}, 'Security', pick), h('label', {}, 'Account', acctSel)),
    h('div', { class: 'ex-fields' }, h('label', {}, 'Order by', modeSel), h('label', {}, amountLabel, amount), limitBox),
    preview_, submit);

  function orderBody() {
    const q = sec(t.ticker), b = { ticker: t.ticker, account: t.account, side: t.side, type: t.type };
    if (!q) return null;
    if (t.type === 'limit') { const c = dollarsToCents(limitIn.value); if (c === null) return { error: 'Enter the limit price in dollars, like 41.50' }; b.limit_cents = c; }
    if (t.mode === 'dollars') { const c = dollarsToCents(amount.value); if (c === null) return { error: 'Enter how many dollars to spend, like 250' }; b.cents = c; }
    else { const u = q.kind === 'stock' && amount.value.includes('.') ? null : parseUnits(amount.value); if (u === null) return { error: q.kind === 'stock' ? 'Enter a whole number of shares' : 'Enter the units, up to 4 decimals' }; b.units_micro = u; }
    return b;
  }
  let pTimer = null, pSeq = 0;
  function preview() {
    clearTimeout(pTimer);
    pTimer = setTimeout(async () => {
      const b = orderBody(), seq = ++pSeq;
      if (!b) return;
      if (b.error || !amount.value.trim()) { preview_.replaceChildren(h('span', { class: 'muted' }, b?.error && amount.value.trim() ? b.error : 'Enter an amount to see what it would cost.')); return; }
      try {
        const r = await api('/api/exchange/preview', b);
        if (seq !== pSeq) return;
        const q = sec(t.ticker), buy = t.side === 'buy', limit = r.type === 'limit';
        if (r.problem) { preview_.replaceChildren(h('span', { class: 'error' }, r.problem)); return; }
        preview_.replaceChildren(
          h('span', {}, `${buy ? 'Buy' : 'Sell'} ${units(r.units_micro)} ${q.ticker} at ${limit ? 'your limit of ' : 'the market maker\'s '}${fmt(r.price_cents)}`),
          h('span', {}, limit ? (buy ? ['Held from your account: ', h('span', { class: 'num' }, fmt(r.hold_cents)), ` until it fills (at that price or better) or ${s.caps.limit_expiry_months} world months pass.`] : `It waits until the bid reaches ${fmt(r.price_cents)} (up to ${s.caps.limit_expiry_months} world months).`)
            : [buy ? 'You pay ' : 'You receive ', h('span', { class: 'num' }, fmt(r.cents)), `. The spread costs about ${fmt(r.spread_cents)}.`]),
          r.note ? h('span', {}, r.note) : '',
          h('span', { class: 'muted small' }, `Order ${r.orders_used + 1} of ${s.caps.orders_max} this world month.`));
      } catch (e) { if (seq === pSeq) preview_.replaceChildren(h('span', { class: 'error' }, e.message)); }
    }, 220);
  }
  async function place() {
    const b = orderBody();
    if (!b || b.error) return say(b?.error ?? 'Pick a security', true);
    try {
      const r = await api('/api/exchange/order', b);
      say((r.note ? `${r.note} ` : '') + (r.status === 'open' ? `Limit order placed. ${fmt(r.hold_cents)} is held until it fills or expires.` : `Done: ${t.side === 'buy' ? 'bought' : 'sold'} ${units(r.units_micro)} ${t.ticker} for ${fmt(r.cents)}.`));
      amount.value = '';
    } catch (e) { say(e.message, true); }
    await load(); preview();
  }
  function sync() {                                  // the ticket's labels and choices follow the security, side and type
    if (!s) return;
    const q = sec(t.ticker);
    pick.replaceChildren(h('optgroup', { label: 'Index funds' }, s.securities.filter((x) => x.kind === 'fund').map((x) => h('option', { value: x.ticker, selected: x.ticker === t.ticker }, `${x.ticker}  ${x.name}`))),
      h('optgroup', { label: 'Town companies' }, s.securities.filter((x) => x.kind === 'stock').map((x) => h('option', { value: x.ticker, selected: x.ticker === t.ticker }, `${x.ticker}  ${x.name}`))));
    acctSel.replaceChildren(...['tfsa', 'rrsp', 'invest'].map((a) => h('option', { value: a, selected: a === t.account }, `${ACCOUNT[a]} (cash ${fmt(s.accounts[`${a}_cents`])})`)));
    if (t.side === 'sell' || q.kind === 'stock') t.mode = 'units';
    else if (!['dollars', 'units'].includes(t.mode)) t.mode = 'dollars';
    modeSel.replaceChildren(...(t.side === 'buy' && q.kind === 'fund' ? [['dollars', 'Dollars to spend'], ['units', 'Units']] : [['units', q.kind === 'stock' ? 'Shares' : 'Units']]).map(([v, l]) => h('option', { value: v, selected: v === t.mode }, l)));
    amountLabel.textContent = t.mode === 'dollars' ? 'Dollars (CAD)' : q.kind === 'stock' ? 'Shares (whole)' : 'Units (up to 4 decimals)';
    amount.placeholder = t.mode === 'dollars' ? '250.00' : q.kind === 'stock' ? '5' : '1.2500';
    limitLabel.textContent = t.side === 'buy' ? 'Buy at or below (CAD)' : 'Sell at or above (CAD)';
    limitBox.hidden = t.type !== 'limit';
    for (const [grp, key] of [[sideSeg, 'side'], [typeSeg, 'type']]) for (const bt of grp.children) bt.setAttribute('aria-pressed', String(t[key] === bt.dataset.v));
    submit.textContent = t.type === 'limit' ? 'Place limit order' : t.side === 'buy' ? 'Buy now' : 'Sell now';
    submit.disabled = !s.open || s.frozen;
  }
  const goTrade = (ticker, side = 'buy', account) => { t.ticker = ticker; t.side = side; if (account) t.account = account; tab = 'trade'; sync(); draw(); preview(); };

  // ---- views ----
  function marketCard(q) {
    const up = (q.change_bp ?? 0) >= 0;
    const facts = [['Buy at (ask)', fmt(q.ask_cents)], ['Sell at (bid)', fmt(q.bid_cents)], ['Spread', pct(q.spread_bp)],
      q.kind === 'stock' ? ['Dividend yield', q.yield_bp ? `${pct(q.yield_bp)} a year, paid quarterly` : 'none'] : ['Fund fee (MER)', `${pct(q.mer_bp)} a year`],
      q.volatility_bp ? ['Ups and downs', `about ${pct(q.volatility_bp)} a year`] : null,
      ['Expected growth', `${pct(q.expected_bp)} a year`],
      q.doubling_years ? ['Rule of 72', `doubles in about ${q.doubling_years.toFixed(1)} years`] : null,
      q.duration_years ? ['Rates link', `falls about ${q.duration_years}% if the policy rate rises 1 point`] : null].filter(Boolean);
    return h('article', { class: `ex-card${q.halted || q.paused ? ' ex-halted' : ''}` },
      h('div', { class: 'ex-head' }, h('span', { class: 'ex-tick' }, q.ticker), h('h3', {}, q.name), q.halted || q.paused ? h('span', { class: 'ex-tag ex-pause', title: q.paused ?? `It moved more than ${s.caps.breaker_pct}% in one step` }, 'Paused') : null),
      q.paused ? h('p', { class: 'small', role: 'status' }, q.paused) : null,
      h('div', { class: 'ex-price' }, h('b', {}, fmt(q.price_cents)), h('span', { class: `ex-chg ${cls(q.change_bp ?? 0)}` }, q.change_bp === null ? 'new' : `${up ? '▲' : '▼'} ${pct(Math.abs(q.change_bp))}`)),
      sparkline(q.spark, up),
      h('p', { class: 'muted small' }, q.sector ? `${q.sector}. ${q.note}` : q.note),
      h('dl', { class: 'ex-facts' }, facts.flatMap(([a, b]) => [h('dt', {}, a), h('dd', {}, b)])),
      h('div', { class: 'ex-actions' }, h('button', { type: 'button', onclick: () => goTrade(q.ticker, 'buy') }, 'Buy'), h('button', { type: 'button', class: 'ghost', onclick: () => goTrade(q.ticker, 'sell') }, 'Sell')));
  }
  const marketsView = () => [
    h('p', { class: 'muted small' }, `Funds trade at 0.2% spread, companies at 1%: you buy at the ask and sell at the bid, and the difference is a cost. Prices move once per world month. Expected growth uses FP Canada's 2026 planning rates (a projection, not a promise), checked ${s.checked}. `,
      h('a', { href: s.guidelines_url, target: '_blank', rel: 'noopener' }, 'source')),
    h('div', { class: 'ex-grid' }, s.securities.map(marketCard)),
  ];

  const tradeView = () => [
    s.frozen ? h('p', { class: 'ex-banner', role: 'status' }, 'Your teacher has paused trading. You can still move cash and cancel orders.') : null,
    h('p', { class: 'muted small' }, `At most ${s.caps.orders_max} orders a world month (${s.caps.orders_used} used), and one buy can use at most ${s.caps.order_share_pct}% of your investable cash (right now ${fmt(s.caps.max_order_cents)}). `,
      'A market order fills now at the ask (buy) or the bid (sell). A limit order waits until the market reaches your price.'),
    ticket,
  ];

  function holdingRow(x) {
    const q = sec(x.ticker);
    return h('div', { class: 'ex-row' },
      h('div', {}, h('b', {}, `${x.ticker} `), x.name, h('small', {}, `${ACCOUNT[x.account]}${x.reserved_micro ? `, ${units(x.reserved_micro)} reserved by a sell limit` : ''}`)),
      h('div', { class: 'num' }, `${units(x.units_micro)}`, h('small', {}, 'held')),
      h('div', { class: 'num' }, fmt(x.value_cents), h('small', {}, `cost ${fmt(x.cost_cents)} (avg ${fmt(x.avg_cents)})`)),
      h('div', { class: `num ${cls(x.gain_cents)}` }, `${x.gain_cents > 0 ? '+' : ''}${fmt(x.gain_cents)}`, h('small', {}, x.cost_cents ? `${x.gain_cents >= 0 ? '+' : ''}${((x.gain_cents * 100) / x.cost_cents).toFixed(1)}%` : '')),
      h('div', { class: 'ex-actions' },
        h('button', { type: 'button', class: 'ghost', onclick: () => goTrade(x.ticker, 'sell', x.account) }, 'Sell'),
        q?.yield_bp ? h('label', { class: 'check', title: 'Reinvest this holding\'s dividends in more shares (DRIP) instead of taking cash' }, h('input', { type: 'checkbox', checked: x.drip, onchange: (e) => act('/api/exchange/drip', { account: x.account, ticker: x.ticker, drip: e.target.checked }, e.target.checked ? `Dividends from ${x.ticker} will be reinvested.` : `Dividends from ${x.ticker} will arrive as cash.`) }), 'DRIP') : null));
  }
  function portfolioView() {
    const slices = s.allocation;
    const gain = s.portfolio_cents - s.cost_cents;
    return [
      h('p', {}, `Holdings are worth ${fmt(s.portfolio_cents)} at today's bid (you paid ${fmt(s.cost_cents)}`, s.holdings.length ? h('span', { class: cls(gain) }, `, ${gain >= 0 ? '+' : ''}${fmt(gain)}`) : null, '). They count toward your net worth.'),
      slices.length ? h('div', { class: 'ex-folio' }, pie(slices), h('ul', { class: 'ex-legend' }, slices.map((x, i) => h('li', {}, h('i', { class: `ex-c${i % 11}` }), h('span', {}, x.label), h('span', {}, fmt(x.cents)))))) : h('p', { class: 'muted' }, 'Nothing invested yet. Contribute from chequing on the TFSA or RRSP tab, then buy on the Trade tab.'),
      s.holdings.length ? h('div', { class: 'ex-list' }, s.holdings.map(holdingRow)) : null,
      h('p', { class: 'muted small' }, 'Dividends paid inside the non-registered account would be taxable in real life ("taxable, not modelled" here). Inside the TFSA and the RRSP they are not taxed while they stay in.'),
      activityView(),
    ];
  }

  // The student's own activity log: every buy, sale and dividend, newest first, grouped by world month (town time moves only when the teacher starts the next month).
  const monthName = (m) => `Month ${m} (year ${Math.floor((m - 1) / 12) + 1}, month ${((m - 1) % 12) + 1} of 12${m === s.month ? ', this month' : ''})`;
  const shareWord = (x) => (x.kind === 'stock' ? 'shares' : 'units');
  const signed = (c) => `${c > 0 ? '+' : c < 0 ? '-' : ''}${fmt(Math.abs(c))}`;
  const HOW = { market: 'market order', limit: 'limit order filled', draw: 'sold for your retirement draw', drip: 'dividend reinvested (DRIP)' };
  const TAX = { invest: 'taxable in real life (not modelled)', tfsa: 'tax-free', rrsp: 'not taxed inside the RRSP' };
  function activityRow(a) {
    if (a.type === 'dividend') {
      const r = a.reinvested;
      return h('div', { class: 'ex-row' },
        h('div', {}, h('b', {}, `Dividend: ${a.ticker} `), a.name, h('small', {}, `${ACCOUNT[a.account]}: ${TAX[a.account]}`)),
        h('div', { class: 'num' }, units(a.units_micro), h('small', {}, `${shareWord(a)} held`)),
        h('div', { class: 'num' }, r ? units(r.units_micro) : '', h('small', {}, r ? `${shareWord(a)} bought at ${fmt(r.price_cents)}` : '')),
        h('div', { class: 'num ex-up' }, `+${fmt(a.cents)}`, h('small', {}, 'received')),
        h('div', {}, a.drip ? (r ? `Reinvested (DRIP)${a.cents - r.cents > 0 ? `, ${fmt(a.cents - r.cents)} kept as cash` : ''}` : 'DRIP on, too small to buy more: kept as cash') : 'Paid as cash'));
    }
    const buy = a.type === 'buy';
    return h('div', { class: `ex-row${a.undone ? ' ex-undone' : ''}` },
      h('div', {}, h('b', {}, `${buy ? 'Bought' : 'Sold'} ${a.ticker} `), a.name, h('small', {}, `${ACCOUNT[a.account]}, ${HOW[a.via] ?? a.via}`)),
      h('div', { class: 'num' }, units(a.units_micro), h('small', {}, shareWord(a))),
      h('div', { class: 'num' }, fmt(a.price_cents), h('small', {}, `${buy ? 'ask' : 'bid'} price each`)),
      h('div', { class: 'num' }, buy ? `-${fmt(a.cents)}` : `+${fmt(a.cents)}`, h('small', {}, buy ? 'paid' : 'received')),
      h('div', {}, a.undone ? 'Undone by your teacher' : !buy && a.gain_cents !== null ? h('span', { class: cls(a.gain_cents) }, `${a.gain_cents >= 0 ? 'Gain' : 'Loss'} ${signed(a.gain_cents)}`, h('small', {}, 'vs. what you paid')) : ''));
  }
  function activityView() {
    const intro = h('p', { class: 'muted small' }, `It is now month ${s.month} (year ${s.year}). Town time moves only when your teacher starts the next month: that is when prices change, limit orders fill and dividends are paid (months 3, 6, 9 and 12 of each year).`);
    if (!s.activity.length) return h('div', { class: 'stack' }, h('p', { class: 'label' }, 'Your activity'), intro, h('p', { class: 'muted' }, 'No trades or dividends yet. Your buys, sales and dividends will be listed here.'));
    const groups = [];
    for (const a of s.activity) (groups.at(-1)?.month === a.month ? groups.at(-1) : groups[groups.push({ month: a.month, rows: [] }) - 1]).rows.push(a);
    return h('div', { class: 'stack ex-activity' }, h('p', { class: 'label' }, 'Your activity'), intro,
      groups.map((g) => h('div', { class: 'stack' }, h('p', { class: 'ex-month' }, monthName(g.month)), h('div', { class: 'ex-list' }, g.rows.map(activityRow)))),
      s.activity.length >= s.activity_max ? h('p', { class: 'muted small' }, `Showing your latest ${s.activity_max}.`) : null);
  }

  function ordersView() {
    const open = s.orders.filter((o) => o.status === 'open'), done = s.orders.filter((o) => o.status !== 'open').slice(0, 8);
    const line = (o) => h('div', { class: 'ex-row' },
      h('div', {}, h('b', {}, `${o.side === 'buy' ? 'Buy' : 'Sell'} ${o.ticker} `), `${o.type}`, h('small', {}, `${ACCOUNT[o.account]}, placed month ${o.placed_month}`)),
      h('div', { class: 'num' }, units(o.units_micro), h('small', {}, 'units')),
      h('div', { class: 'num' }, o.limit_cents ? fmt(o.limit_cents) : 'market', h('small', {}, o.limit_cents ? 'limit' : '')),
      h('div', { class: 'num' }, o.status === 'open' ? (o.side === 'buy' ? fmt(o.hold_cents) : 'shares reserved') : o.status, h('small', {}, o.status === 'open' ? `until month ${o.expires_month}` : o.filled_month ? `month ${o.filled_month}` : '')),
      h('div', { class: 'ex-actions' }, o.status === 'open' ? h('button', { type: 'button', class: 'ghost', onclick: guard(() => act('/api/exchange/cancel', { id: o.id }, 'Order cancelled. Any held money is back in your account.')) }, 'Cancel') : null));
    return [
      h('p', { class: 'muted small' }, 'A limit order is the order book idea: you name a price and wait. The market maker is always the other side. Money for a buy limit is held (not spent) and comes back if you cancel or it expires.'),
      open.length ? h('div', { class: 'ex-list' }, open.map(line)) : h('p', { class: 'muted' }, 'No open orders.'),
      done.length ? h('div', { class: 'stack' }, h('p', { class: 'label' }, 'Recent orders'), h('div', { class: 'ex-list' }, done.map(line))) : null,
    ];
  }

  // ---- the TFSA tab: forms built once ----
  const money = (name, label) => h('input', { name, inputmode: 'decimal', autocomplete: 'off', placeholder: '100.00', 'aria-label': label });
  const cIn = money('contribute', 'Dollars to put in'), wIn = money('withdraw', 'Dollars to take out');
  const opts = () => ['tfsa', 'rrsp', 'invest'].map((a) => h('option', { value: a }, ACCOUNT[a])), cAcc = h('select', { 'aria-label': 'Account to contribute to' }, opts()), wAcc = h('select', { 'aria-label': 'Account to withdraw from' }, opts());
  const money$ = (inp, path, ok) => () => { const c = dollarsToCents(inp.value); if (c === null || c <= 0) return say('Enter dollars, like 250 or 99.50', true); const account = inp === cIn ? cAcc.value : wAcc.value; inp.value = ''; return act(path, { account, cents: c }, (r) => ok(c, account, r)); };
  const contributeForm = h('form', { class: 'ex-form', onsubmit: guard((e) => { e.preventDefault(); return money$(cIn, '/api/exchange/contribute', (c, a) => `${fmt(c)} moved from chequing to your ${ACCOUNT[a]} account.`)(); }) }, h('p', { class: 'label' }, 'Put money in (from chequing)'), h('label', {}, 'Account', cAcc), h('label', {}, 'Dollars', cIn), h('button', { type: 'submit' }, 'Contribute'));
  const withdrawForm = h('form', { class: 'ex-form', onsubmit: guard((e) => { e.preventDefault(); return money$(wIn, '/api/exchange/withdraw', (c, a, r) => (r.withheld_cents ? `${fmt(c)} taken out of your RRSP: ${fmt(r.withheld_cents)} was withheld as tax at source and ${fmt(r.net_cents)} reached chequing. The withholding is not necessarily the whole tax: see your tax slip at year end.` : `${fmt(c)} moved from your ${ACCOUNT[a]} account to chequing.`))(); }) }, h('p', { class: 'label' }, 'Take cash out (to chequing)'), h('label', {}, 'Account', wAcc), h('label', {}, 'Dollars', wIn), h('button', { type: 'submit', class: 'ghost' }, 'Withdraw'));
  const tfsaData = h('div', { class: 'stack' });
  function tfsaDraw() {
    const f = s.tfsa, all = f.limits_total_cents ?? f.limit_cents * s.year, used = Math.min(100, Math.round(((all - f.room_cents) * 100) / Math.max(1, all)));
    const bar = h('i'); bar.style.width = `${100 - used}%`;
    tfsaData.replaceChildren(...[
      h('p', { class: 'ex-box' }, h('b', {}, 'A TFSA is a box, not an investment. '), 'Money, funds and shares can all sit inside it. Growth and withdrawals are never taxed, but you can only put in so much.'),
      h('div', { class: 'stats' }, h('div', { class: 'stat' }, 'Room left', h('b', {}, fmt(f.room_cents))), h('div', { class: 'stat' }, 'Cash in TFSA', h('b', {}, fmt(s.accounts.tfsa_cents))), h('div', { class: 'stat' }, 'Put in this season', h('b', {}, fmt(f.contributed_cents)))),
      h('div', { class: 'ex-meter', role: 'img', 'aria-label': `${100 - used}% of your TFSA room is still free` }, bar),
      h('p', { class: 'muted small' }, `${f.indexed ? `This world year's limit is ${fmt(f.limit_cents)}: like the real one, it rises with prices (CRA's 2026 limit is $7,000)` : `CRA's 2026 limit is ${fmt(f.limit_cents)} a year`} (world year ${s.year}). Room you do not use carries forward. A withdrawal does NOT free up room this year: it comes back on January 1 of the next one (the start of the next world year). Putting in too much costs 1% a month in real life; here the game stops you first. `,
        h('a', { href: s.tfsa_url, target: '_blank', rel: 'noopener' }, 'CRA source')),
      f.withdrawn_cents ? h('p', { class: 'small' }, `You took out ${fmt(f.withdrawn_cents)} so far; that comes back as room next world year.`) : null,
      h('div', { class: 'stack' }, h('p', { class: 'label' }, 'Rule of 72'), h('p', { class: 'muted small' }, 'Divide 72 by the yearly percent to guess how many years it takes to double. Fees shrink the percent:'),
        h('div', { class: 'ex-list' }, s.securities.filter((q) => q.kind === 'fund').map((q) => h('div', { class: 'ex-row' }, h('div', {}, h('b', {}, `${q.ticker} `), q.name), h('div', { class: 'num' }, pct(q.expected_bp), h('small', {}, 'after fee')), h('div', { class: 'num' }, `72 / ${(q.expected_bp / 100).toFixed(2)} = ${q.doubling_years.toFixed(1)}`, h('small', {}, 'years to double')), h('div', { class: 'num' }, pct(q.mer_bp), h('small', {}, 'fee a year')), h('div')))))].filter(Boolean));
  }
  const tfsaView = () => { tfsaDraw(); return [tfsaData, h('div', { class: 'ex-forms' }, contributeForm, withdrawForm)]; };

  // ---- the RRSP tab ----
  const rows = (pairs) => h('dl', { class: 'ex-facts' }, pairs.filter(Boolean).flatMap(([a, b]) => [h('dt', {}, a), h('dd', {}, b)]));
  const settleText = (net) => (net >= 0 ? `Refund ${fmt(net)}` : `Owing ${fmt(-net)}`);
  const rrspData = h('div', { class: 'stack' });
  function rrspDraw() {
    const r = s.rrsp, f = r.if_year_ended, l = r.last;
    const band = (b) => h('tr', {}, h('td', {}, b.up_to_cents === null ? `over ${fmt(b.from_cents)}` : b.from_cents ? `over ${fmt(b.from_cents)}, up to ${fmt(b.up_to_cents)}` : `up to ${fmt(b.up_to_cents)}`), h('td', { class: 'num' }, `${b.pct}%`));
    rrspData.replaceChildren(...[
      h('p', { class: 'ex-box' }, h('b', {}, 'An RRSP gives you a tax break now and taxes the money later. '), 'What you put in is deducted from your income, so you get a refund. Growth inside is not taxed, but every dollar you take out is added to that year\'s income.'),
      h('div', { class: 'stats' }, h('div', { class: 'stat' }, 'Room left', h('b', {}, fmt(r.room_cents))), h('div', { class: 'stat' }, 'Cash in RRSP', h('b', {}, fmt(s.accounts.rrsp_cents))),
        h('div', { class: 'stat' }, 'Put in this world year', h('b', {}, fmt(r.contributed_cents))), h('div', { class: 'stat' }, 'If the year ended today', h('b', {}, settleText(f.net_cents)))),
      h('p', { class: 'muted small' }, s.year === 1 ? 'World year 1 has no RRSP room: room comes from last year\'s pay, and there is no last year yet. Next year it will be 18% of what you earn this year.'
        : `Your room for this world year is 18% of last year's pay (${fmt(r.last_year_income_cents)}), up to the ${fmt(r.limit_cents)} limit, plus any room you did not use before. A withdrawal does NOT give room back (unlike a TFSA). `),
      h('a', { href: r.url, target: '_blank', rel: 'noopener' }, 'CRA source for the limit'),
      h('p', { class: 'muted small' }, `Pay so far this world year: ${fmt(r.income_cents)}. If the year ended today: tax on that pay is ${fmt(f.tax_before)}; with your ${fmt(f.c)} put in${f.w ? ` and ${fmt(f.w)} taken out` : ''}${f.p ? ` and ${fmt(f.p)} of CPP and OAS` : ''} it is ${fmt(f.tax_after)}${f.clawback ? ` (with ${fmt(f.clawback)} of OAS paid back)` : ''}${f.h ? `, and ${fmt(f.h)} was already withheld` : ''}${f.carry_cents ? `, and you still owe ${fmt(f.carry_cents)} from last year` : ''}. That is a ${f.net_cents >= 0 ? 'refund' : 'balance owing'} of ${fmt(Math.abs(f.net_cents))}. Your refund or balance is settled when the next world year starts.`),
      h('div', { class: 'stack' }, h('p', { class: 'label' }, 'Tax withheld when you take money out (outside Quebec)'),
        h('div', { class: 'table-wrap' }, h('table', {}, h('thead', {}, h('tr', {}, h('th', {}, 'One withdrawal of'), h('th', { class: 'num' }, 'Withheld'))), h('tbody', {}, r.bands.map(band)))),
        h('p', { class: 'muted small' }, 'The rate depends on the size of that one withdrawal. Withholding is a down payment, not the whole tax: at year end your tax slip adds the withdrawal to your income and settles the difference, so you can still owe.')),
      l ? h('div', { class: 'stack' }, h('p', { class: 'label' }, `Your tax slip for world year ${l.year}`),
        rows([['Pay (G)', fmt(l.g_cents)], ['Put into RRSP (C)', fmt(l.c_cents)], ['Taken out (W)', fmt(l.w_cents)], l.p_cents ? ['CPP and OAS (P)', fmt(l.p_cents)] : null, l.clawback_cents ? ['OAS paid back (in tax after)', fmt(l.clawback_cents)] : null, ['Tax before the RRSP', fmt(l.tax_before_cents)], ['Tax after the RRSP', fmt(l.tax_after_cents)], ['Already withheld (H)', fmt(l.h_cents)],
          l.carry_cents ? ['Owing from the year before', fmt(l.carry_cents)] : null, [l.refund_cents ? 'Refund' : 'Owing', fmt(l.refund_cents || l.owing_cents)], l.unpaid_cents ? ['Not paid yet (carried to next year)', fmt(l.unpaid_cents)] : null]),
        h('p', { class: 'muted small' }, 'Refund = tax before - tax after + withheld. Your pay stubs already took tax off each cheque; the game only settles the RRSP difference.')) : null,
      h('div', { class: 'stack' }, h('p', { class: 'label' }, `TFSA or RRSP? ${fmt(r.compare.cents)} for ${r.compare.years} years at ${pct(r.compare.expected_bp)} a year (the index fund's expected growth)`),
        h('div', { class: 'table-wrap' }, h('table', {}, h('thead', {}, h('tr', {}, h('th', {}, 'If you retire at'), h('th', { class: 'num' }, 'TFSA'), h('th', { class: 'num' }, 'RRSP + refund invested'))),
          h('tbody', {}, r.compare.rows.map((c) => h('tr', {}, h('td', {}, `${c.label} (${pct(c.retire_bp)})`), h('td', { class: 'num' }, fmt(c.tfsa)), h('td', { class: 'num' }, fmt(c.rrsp))))))),
        h('p', { class: 'muted small' }, `Both boxes grow untaxed. The RRSP gives a refund now (about ${pct(r.compare.marginal_bp)} of what you put in at your tax rate), which you invest too, and is taxed when it comes out. So the RRSP wins when your tax rate is higher now than it will be in retirement, and the TFSA wins when it is lower. The lower and higher rates are illustrations.`)),
      h('p', { class: 'muted small' }, 'Your RRSP counts toward your net worth at face value, before tax. Some of it will go to tax when you take it out.')].filter(Boolean));
  }
  const rrspView = () => { rrspDraw(); return [rrspData, h('div', { class: 'ex-forms' }, contributeForm, withdrawForm)]; };

  // ---- draw ----
  function draw() {
    wallet.replaceChildren(...[h('span', { class: 'chip' }, `Chequing ${fmt(s.accounts.chequing_cents)}`), h('span', { class: 'chip' }, `TFSA cash ${fmt(s.accounts.tfsa_cents)}`), h('span', { class: 'chip' }, `RRSP cash ${fmt(s.accounts.rrsp_cents)}`), h('span', { class: 'chip' }, `Non-registered cash ${fmt(s.accounts.invest_cents)}`),
      h('span', { class: 'chip' }, `Holdings ${fmt(s.portfolio_cents)}`), s.accounts.hold_cents ? h('span', { class: 'chip', title: 'Cash held for your open buy limits' }, `Held ${fmt(s.accounts.hold_cents)}`) : null].filter(Boolean));
    banner.replaceChildren(...(s.frozen ? [h('p', { class: 'ex-banner', role: 'status' }, 'Your teacher has paused trading.')] : []), ...(!s.open ? [h('p', { class: 'ex-banner', role: 'status' }, 'The season is closed.')] : []));
    const items = s.news.slice(0, 8);
    news.replaceChildren(items.length ? h('div', { class: 'ex-news', role: 'region', 'aria-label': 'Exchange news', tabindex: '0' }, h('div', { class: 'ex-track' }, items.map((n) => h('span', {}, `Month ${n.month}: ${n.text}`)), items.map((n) => h('span', { 'aria-hidden': 'true' }, `Month ${n.month}: ${n.text}`)))) : h('p', { class: 'muted small' }, 'News appears after the first world month.'));
    for (const b of el.querySelectorAll('.ex-tabs button')) b.setAttribute('aria-pressed', String(b.dataset.tab === tab));
    if (tab !== 'trade') ticket.remove();
    body.replaceChildren(...(tab === 'markets' ? marketsView() : tab === 'trade' ? tradeView() : tab === 'portfolio' ? portfolioView() : tab === 'orders' ? ordersView() : tab === 'tfsa' ? tfsaView() : rrspView()).flat().filter(Boolean));
  }

  async function load() {
    s = await api('/api/exchange/state');
    const key = JSON.stringify(s);
    if (key !== last) { last = key; if (!sec(t.ticker)) t.ticker = s.securities[0].ticker; sync(); draw(); if (tab === 'trade') preview(); }
  }

  el.append(h('h2', {}, 'Exchange'),
    h('p', { class: 'muted small' }, 'Buy index funds and shares of the town\'s companies. Prices move once per world month, the same for every student, and nobody can predict or rig them. Investing means your money can go down as well as up. That is the lesson.'),
    wallet, banner, news,
    h('div', { class: 'ex-tabs', role: 'group', 'aria-label': 'Exchange sections' }, TABS.map(([id, label]) => h('button', { type: 'button', 'data-tab': id, 'aria-pressed': String(id === tab), onclick: () => { tab = id; if (id === 'rrsp') cAcc.value = wAcc.value = 'rrsp'; else if (id === 'tfsa') cAcc.value = wAcc.value = 'tfsa'; draw(); if (id === 'trade') preview(); } }, label))),
    msg, body);
  ctx.onRefresh(() => load().catch(() => {}));
  await load();
}
