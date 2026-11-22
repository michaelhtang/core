import { h, api, fmt, dollarsToCents, guard } from '/ui.js?v=__V__';

// Net Worth building: what you own, move money to HISA, buy a GIC, the 12-month line, the Rule of 72.
// The forms are built once; only the data parts are redrawn on updates, so a half-typed amount survives.
const NS = 'http://www.w3.org/2000/svg';
const svg = (tag, attrs = {}, ...kids) => {   // SVG built node by node with setAttribute/textContent: data never goes through innerHTML
  const el = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
  el.append(...kids);
  return el;
};
const pct = (bp) => `${(bp / 100).toFixed(2)}%`;

// A 12-point line chart. Points are [month, cents].
export function lineChart(points) {
  const W = 360, H = 170, L = 8, R = 8, T = 14, B = 26;
  const chart = svg('svg', { viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': 'Net worth by month, last 12 months', class: 'networth-chart', width: '100%' });
  if (points.length < 2) { chart.append(svg('text', { x: W / 2, y: H / 2, 'text-anchor': 'middle', fill: 'currentColor' }, 'Your line appears after two months.')); return chart; }
  const lo = Math.min(...points.map((p) => p[1])), hi = Math.max(...points.map((p) => p[1]));
  const m0 = points[0][0], m1 = points.at(-1)[0];
  const x = (m) => L + ((m - m0) / (m1 - m0)) * (W - L - R);
  const y = (c) => (hi === lo ? (T + H - B) / 2 : H - B - ((c - lo) / (hi - lo)) * (H - B - T));
  chart.append(
    svg('line', { x1: L, y1: H - B, x2: W - R, y2: H - B, stroke: 'currentColor', 'stroke-opacity': 0.4 }),
    svg('polyline', { points: points.map(([m, c]) => `${x(m).toFixed(1)},${y(c).toFixed(1)}`).join(' '), fill: 'none', stroke: 'currentColor', 'stroke-width': 2.5, 'stroke-linejoin': 'round' }),
    ...points.map(([m, c]) => svg('circle', { cx: x(m).toFixed(1), cy: y(c).toFixed(1), r: 3, fill: 'currentColor' })),
    svg('text', { x: L, y: H - 8, 'font-size': 11, fill: 'currentColor' }, `Month ${m0}`),
    svg('text', { x: W - R, y: H - 8, 'font-size': 11, 'text-anchor': 'end', fill: 'currentColor' }, `Month ${m1}`),
    svg('text', { x: L, y: 10, 'font-size': 11, fill: 'currentColor' }, `High ${fmt(hi)}`),
    ...(hi === lo ? [] : [svg('text', { x: W - R, y: 10, 'font-size': 11, 'text-anchor': 'end', fill: 'currentColor' }, `Low ${fmt(lo)}`)]));
  return chart;
}

export async function render(el, ctx) {
  const msg = h('p', { role: 'status' });
  const say = (text, bad) => { msg.className = bad ? 'error' : 'ok'; msg.textContent = text; };
  const hero = h('div', { class: 'hero' });
  const accounts = h('div', { class: 'table-wrap' });
  const chart = h('div', {});
  const months = h('div', { class: 'table-wrap' });
  const rule = h('p', { class: 'muted' });
  const gicRate = h('p', { class: 'muted small' });
  let status = null;

  const move = (direction, input) => async () => {
    const cents = dollarsToCents(input.value);
    if (!cents) return say('Enter an amount like 25 or 12.50', true);
    try { await api('/api/savings/move', { direction, cents }); input.value = ''; say(direction === 'to_hisa' ? `Moved ${fmt(cents)} to savings.` : `Moved ${fmt(cents)} to chequing.`); await load(); } catch (e) { say(e.message, true); }
  };
  const amount = h('input', { name: 'amount', inputmode: 'decimal', placeholder: '0.00', 'aria-label': 'Amount to move (CAD)' });
  const gicAmount = h('input', { name: 'gic', inputmode: 'decimal', placeholder: '100.00', 'aria-label': 'GIC amount (CAD)' });
  const term = h('select', { 'aria-label': 'GIC term', onchange: () => paintRate() });

  function paintRate() {
    const t = status?.gic_rates.find((r) => String(r.term_months) === term.value);
    gicRate.textContent = t ? `${t.term_months / 12}-year GIC at ${pct(t.rate_bp)}, compounded yearly, paid when it matures. Locked: you cannot take it out early. Minimum ${fmt(status.gic_min_cents)}.` : '';
  }

  async function load() {
    status = await api('/api/savings/status');
    const s = status;
    hero.replaceChildren(fmt(s.net_worth_cents));
    accounts.replaceChildren(h('table', {},
      h('thead', {}, h('tr', {}, h('th', {}, 'Account'), h('th', {}, 'Details'), h('th', { class: 'num' }, 'Balance'))),
      h('tbody', {},
        h('tr', {}, h('td', {}, 'Chequing'), h('td', {}, ''), h('td', { class: 'num' }, fmt(s.chequing_cents))),
        h('tr', {}, h('td', {}, 'High-interest savings'), h('td', {}, `${pct(s.hisa_rate_bp)} a year, paid monthly`), h('td', { class: 'num' }, fmt(s.hisa_cents))),
        s.gics.map((g) => h('tr', {}, h('td', {}, `GIC #${g.account_id}`),
          h('td', {}, g.matured_month ? `Matured in month ${g.matured_month}` : `${pct(g.rate_bp)}, ${g.term_months} months, matures month ${g.matures_month}: ${fmt(g.maturity_cents)}`),
          h('td', { class: 'num' }, g.matured_month ? fmt(0) : fmt(g.principal_cents)))),
        s.home_value_cents ? h('tr', {}, h('td', {}, 'Home'), h('td', {}, 'Its value, not money you can spend'), h('td', { class: 'num' }, fmt(s.home_value_cents))) : null,
        s.mortgage_cents ? h('tr', {}, h('td', {}, 'Mortgage'), h('td', {}, 'What you still owe'), h('td', { class: 'num' }, fmt(s.mortgage_cents))) : null,
        s.bills_owed_cents ? h('tr', {}, h('td', {}, 'Bills owed'), h('td', {}, 'Bills you have not paid yet'), h('td', { class: 'num' }, fmt(s.bills_owed_cents))) : null)));
    const points = s.snapshots.map((p) => [p.month, p.net_worth_cents]);
    chart.replaceChildren(lineChart(points));
    months.replaceChildren(h('table', {},
      h('thead', {}, h('tr', {}, h('th', {}, 'Month'), h('th', { class: 'num' }, 'Net worth'))),
      h('tbody', {}, [...s.snapshots].reverse().map((p) => h('tr', {}, h('td', {}, `Month ${p.month}`), h('td', { class: 'num' }, fmt(p.net_worth_cents)))))));
    rule.textContent = s.hisa_rate_bp > 0
      ? `Rule of 72: at ${pct(s.hisa_rate_bp)}, money in HISA doubles in about ${(7200 / s.hisa_rate_bp).toFixed(1)} years (72 ÷ ${(s.hisa_rate_bp / 100).toFixed(2)}).`
      : 'Rule of 72: at 0% your savings never double.';
    if (!term.options.length) term.replaceChildren(...s.gic_rates.map((r) => h('option', { value: r.term_months }, `${r.term_months} months`)));
    paintRate();
  }

  el.append(
    h('h2', {}, 'Net Worth'),
    h('p', { class: 'label' }, 'Everything you own, minus what you owe'),
    hero, accounts,
    h('p', { class: 'label' }, 'Move money between chequing and savings'),
    h('div', { class: 'row' }, h('label', { class: 'grow' }, 'Amount (CAD)', amount),
      h('button', { type: 'button', onclick: guard(move('to_hisa', amount)) }, 'To savings'),
      h('button', { class: 'ghost', type: 'button', onclick: guard(move('to_chequing', amount)) }, 'To chequing')),
    rule,
    h('p', { class: 'label' }, 'Buy a GIC'),
    h('div', { class: 'row' }, h('label', {}, 'Term', term), h('label', { class: 'grow' }, 'Amount (CAD)', gicAmount),
      h('button', { type: 'button', onclick: guard(async () => {
        const cents = dollarsToCents(gicAmount.value);
        if (!cents) return say('Enter an amount like 250', true);
        try { await api('/api/savings/gic', { term_months: Number(term.value), cents }); gicAmount.value = ''; say(`GIC bought for ${fmt(cents)}.`); await load(); } catch (e) { say(e.message, true); }
      }) }, 'Buy GIC')),
    gicRate, msg,
    h('p', { class: 'label' }, 'Net worth, last 12 months'), chart, months);
  ctx.onRefresh(() => load().catch(() => {}));
  await load();
}
