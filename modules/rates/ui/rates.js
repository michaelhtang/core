import { h, api } from '/ui.js?v=__V__';

// Bank of DAA building: the policy rate over time, and what the latest rates mean for you. SVG built node by node (no innerHTML).
const NS = 'http://www.w3.org/2000/svg';
const svg = (tag, attrs = {}, ...kids) => {
  const el = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
  el.append(...kids);
  return el;
};
export const pct = (bp) => `${(bp / 100).toFixed(2)}%`;

// A step chart: the policy rate holds until the next change. Points are [month, bp], oldest first; `last` is the current month.
export function policyChart(points, last) {
  const W = 360, H = 170, L = 34, R = 8, T = 14, B = 26;
  const chart = svg('svg', { viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': 'Policy rate history', width: '100%' });
  if (!points.length) { chart.append(svg('text', { x: W / 2, y: H / 2, 'text-anchor': 'middle', fill: 'currentColor' }, 'The first rate is announced at the next world month.')); return chart; }
  const m0 = points[0][0], m1 = Math.max(last, points.at(-1)[0], m0 + 1);
  const lo = Math.min(...points.map((p) => p[1])), hi = Math.max(...points.map((p) => p[1]));
  const top = Math.max(hi, lo + 100), bot = Math.max(0, Math.min(lo, top - 100));
  const x = (m) => L + ((m - m0) / (m1 - m0)) * (W - L - R);
  const y = (bp) => H - B - ((bp - bot) / (top - bot)) * (H - B - T);
  const path = points.map(([m, bp], i) => `${i ? `${x(m).toFixed(1)},${y(points[i - 1][1]).toFixed(1)} ` : ''}${x(m).toFixed(1)},${y(bp).toFixed(1)}`).join(' ') + ` ${x(m1).toFixed(1)},${y(points.at(-1)[1]).toFixed(1)}`;
  chart.append(
    svg('line', { x1: L, y1: H - B, x2: W - R, y2: H - B, stroke: 'currentColor', 'stroke-opacity': 0.4 }),
    svg('polyline', { points: path, fill: 'none', stroke: 'currentColor', 'stroke-width': 2.5, 'stroke-linejoin': 'round' }),
    ...points.map(([m, bp]) => svg('circle', { cx: x(m).toFixed(1), cy: y(bp).toFixed(1), r: 3, fill: 'currentColor' })),
    svg('text', { x: L, y: H - 8, 'font-size': 11, fill: 'currentColor' }, `Month ${m0}`),
    svg('text', { x: W - R, y: H - 8, 'font-size': 11, 'text-anchor': 'end', fill: 'currentColor' }, `Month ${m1}`),
    svg('text', { x: L - 4, y: y(top) + 4, 'font-size': 11, 'text-anchor': 'end', fill: 'currentColor' }, pct(top)),
    svg('text', { x: L - 4, y: y(bot) + 4, 'font-size': 11, 'text-anchor': 'end', fill: 'currentColor' }, pct(bot)));
  return chart;
}

// The rates a student feels, with the change since the last policy move.
export const ROWS = [
  ['High-interest savings (HISA)', 'hisa_bp', 'what you earn on savings'],
  ['Prime rate', 'prime_bp', 'what banks charge their best borrowers'],
  ['Credit card APR', 'card_apr_bp', 'fixed: it does not follow the policy rate'],
  ['5-year fixed mortgage', 'mortgage5y_bp', 'what a new fixed mortgage costs'],
  ['Line of credit', 'loc_bp', 'prime plus a spread'],
];
export const delta = (now, prev) => (prev === null || prev === undefined || now === prev ? '' : `${now > prev ? 'up' : 'down'} ${pct(Math.abs(now - prev))}`);

export async function render(el, ctx) {
  const hero = h('div', { class: 'hero' });
  const note = h('p', { class: 'muted' });
  const chart = h('div', {});
  const table = h('div', { class: 'table-wrap' });
  const prices = h('p', { class: 'muted' });
  async function load() {
    const v = await api('/api/rates/current');
    hero.replaceChildren(pct(v.policy_bp));
    note.textContent = v.pending_bp === null ? `Next announcement: world month ${v.next_announcement_month}.`
      : `A new policy rate of ${pct(v.pending_bp)} starts in world month ${v.pending_from_month}. Next scheduled announcement: month ${v.next_announcement_month}.`;
    prices.textContent = `Prices rise ${pct(v.inflation_bp)} a year, on the first month of each world year. Prices are ${((v.price_index_bp - 10000) / 100).toFixed(2)}% higher than at the start of the season.`;
    chart.replaceChildren(policyChart(v.history.map((p) => [p.month, p.policy_bp]), v.month));
    table.replaceChildren(h('table', {},
      h('thead', {}, h('tr', {}, h('th', {}, 'Rate'), h('th', { class: 'num' }, 'Now'), h('th', {}, 'Since the last change'), h('th', {}, 'What it means'))),
      h('tbody', {}, ROWS.map(([name, key, means]) => h('tr', {}, h('td', {}, name), h('td', { class: 'num' }, pct(v[key])), h('td', {}, delta(v[key], v.previous?.[key])), h('td', {}, means))))));
  }
  el.append(
    h('h2', {}, 'Bank of DAA'),
    h('p', { class: 'label' }, 'The policy rate'), hero, note, chart,
    h('p', { class: 'label' }, 'What this means for you'), table, h('p', { class: 'label' }, 'Inflation'), prices);
  ctx?.onRefresh(() => load().catch(() => {}));
  await load();
}
