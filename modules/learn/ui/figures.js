import { h, fmt } from '/ui.js?v=__V__';
import { numberColumn } from '/m/learn/tablemath.js?v=__V__';

// The Learning Road's small figure vocabulary (docs/learn.md): table and paystub are real tables; bars and line are inline SVG built with DOM calls
// (attributes only: the page's CSP forbids inline styles, so every colour comes from learn.css classes). A chart used by a `point` question is
// interactive: each bar or dot is a focusable button.
export function ensureCss() {
  if (!document.querySelector('link[data-learn]')) document.head.append(h('link', { rel: 'stylesheet', href: '/m/learn/learn.css?v=__V__', 'data-learn': '' }));
}

// A picture that keeps its space while it loads and disappears (class) if it fails.
export function picture(image, cls, w = 1200, ht = 675) {
  const img = h('img', { class: cls, src: `/art/learn/${image.src}`, alt: image.alt, width: String(w), height: String(ht), loading: 'lazy', decoding: 'async' });
  img.addEventListener('error', () => img.classList.add('ln-img-failed'));
  return img;
}

const NS = 'http://www.w3.org/2000/svg';
export function svg(tag, attrs = {}, ...kids) {
  const el = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) if (v !== false && v != null) el.setAttribute(k, String(v));
  for (const kid of kids.flat()) if (kid) el.append(kid);
  return el;
}

const show = (unit, v) => (unit === '$' ? fmt(v) : unit === '%' ? `${v}%` : `${v} h`);

function table(f) {
  const num = f.columns.map((_, i) => numberColumn(f.rows, i));
  return h('div', { class: 'table-wrap' }, h('table', { class: 'ln-table' }, h('caption', {}, f.title),
    h('thead', {}, h('tr', {}, f.columns.map((c, i) => h('th', { scope: 'col', class: num[i] ? 'num' : '' }, c)))),
    h('tbody', {}, f.rows.map((r) => h('tr', {}, r.map((c, i) => (i ? h('td', { class: num[i] ? 'num' : '' }, c) : h('th', { scope: 'row' }, c))))))));
}

function paystub(f) {
  const ytd = f.lines.some((l) => l.ytd !== undefined);
  return h('div', { class: 'table-wrap' }, h('table', { class: 'ln-table ln-stub' }, h('caption', {}, f.title),
    h('thead', {}, h('tr', {}, h('th', { scope: 'col' }, 'Line'), h('th', { scope: 'col', class: 'num' }, 'This pay'), ytd ? h('th', { scope: 'col', class: 'num' }, 'Year to date') : '')),
    h('tbody', {}, f.lines.map((l) => h('tr', { class: `ln-stub-${l.role}` }, h('th', { scope: 'row' }, l.label),
      h('td', { class: 'num' }, `${l.role === 'deduct' ? '-' : ''}${fmt(l.cents)}`), ytd ? h('td', { class: 'num' }, l.ytd === undefined ? '' : fmt(l.ytd)) : '')))));
}

// bars and line. opts: { pick(i) (makes the points buttons), picked (index), locked (no more taps), mark: { i: 'right' | 'wrong' } }
function chart(f, opts = {}) {
  const items = f.kind === 'line' ? f.points : f.bars;
  // A label too long for its slot (about 6 px a character at 11 px bold) wraps onto two lines, at the space nearest its middle; the bottom margin grows to fit.
  const n = items.length, fits = (t) => t.length * 6 <= (320 - 24) / n;
  const lines = items.map((p) => { const t = String(p.label); if (fits(t) || !t.includes(' ')) return [t]; const sp = [...t].map((c, i) => (c === ' ' ? i : -1)).filter((i) => i > 0); const k = sp.reduce((a, b) => (Math.abs(b - t.length / 2) < Math.abs(a - t.length / 2) ? b : a)); return [t.slice(0, k), t.slice(k + 1)]; });
  const W = 320, H = 190, L = 12, R = 12, T = 26, B = lines.some((l) => l.length > 1) ? 52 : 40;
  const max = Math.max(...items.map((p) => p.value), 1) * 1.1;
  const y = (v) => T + (H - T - B) * (1 - v / max);
  const slot = (W - L - R) / n, cx = (i) => L + slot * (i + 0.5);
  const summary = `${f.title}. ${items.map((p) => `${p.label}: ${show(f.unit, p.value)}`).join('; ')}.`;
  const root = svg('svg', { viewBox: `0 0 ${W} ${H}`, class: `ln-chart ln-${f.kind}`, role: opts.pick ? 'group' : 'img', 'aria-label': opts.pick ? `${f.title}. Choose one.` : summary, focusable: 'false' });
  root.append(svg('line', { class: 'ln-axis', x1: L, x2: W - R, y1: H - B, y2: H - B }));
  if (f.kind === 'line') root.append(svg('polyline', { class: 'ln-path', points: items.map((p, i) => `${cx(i)},${y(p.value)}`).join(' ') }));
  items.forEach((p, i) => {
    const state = opts.mark?.[i] ?? (opts.picked === i ? 'picked' : '');
    const g = svg('g', { class: `ln-pt ${state}`, ...(opts.pick ? { role: 'button', tabindex: opts.locked ? '-1' : '0', 'aria-label': `Choice ${i + 1}: ${p.label}, ${show(f.unit, p.value)}`, 'aria-pressed': opts.picked === i ? 'true' : 'false', ...(opts.locked ? { 'aria-disabled': 'true' } : {}) } : {}) });
    if (f.kind === 'bars') g.append(svg('rect', { class: 'ln-bar', x: cx(i) - slot * 0.32, y: y(p.value), width: slot * 0.64, height: H - B - y(p.value), rx: 3 }));
    else g.append(svg('circle', { class: 'ln-dot', cx: cx(i), cy: y(p.value), r: 6 }));
    g.append(svg('rect', { class: 'ln-hit', x: cx(i) - slot / 2, y: T - 6, width: slot, height: H - T - B + 6 }));
    const val = svg('text', { class: 'ln-val', x: cx(i), y: y(p.value) - 8, 'text-anchor': 'middle' }); val.textContent = show(f.unit, p.value);
    const lab = svg('text', { class: 'ln-lab', x: cx(i), y: H - B + 16, 'text-anchor': 'middle' });
    lines[i].forEach((t, j) => { const ts = svg('tspan', { x: cx(i), dy: j ? 12 : 0 }); ts.textContent = t; lab.append(ts); });
    g.append(val, lab);
    if (opts.pick) {
      const num = svg('text', { class: 'ln-num', x: cx(i), y: H - 6, 'text-anchor': 'middle' }); num.textContent = String(i + 1);
      g.append(num);
      if (!opts.locked) {
        g.addEventListener('click', () => opts.pick(i));
        g.addEventListener('keydown', (e) => { if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); opts.pick(i); } });
      }
    }
    root.append(g);
  });
  return h('figure', { class: 'ln-fig' }, h('figcaption', {}, f.title), root);
}

export function figure(f, opts) {
  const body = f.kind === 'table' ? table(f) : f.kind === 'paystub' ? paystub(f) : chart(f, opts);
  return f.kind === 'table' || f.kind === 'paystub' ? h('div', { class: 'ln-fig' }, body) : body;
}
