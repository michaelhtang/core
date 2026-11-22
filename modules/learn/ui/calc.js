import { h } from '/ui.js?v=__V__';
import { calculate, formatResult, keyAction } from '/m/learn/calcmath.js?v=__V__';

// The Learning Road's built-in calculator (docs/learn.md): a slim tab on the right edge that slides a calculator in. It lives on <body> (so it also
// shows over a full-screen lesson) and goes away when the building does. Typing in the lesson's own answer box is never captured.
const KEYS = [['C', 'clear'], ['(', '('], [')', ')'], ['⌫', 'back'],
  ['7', '7'], ['8', '8'], ['9', '9'], ['÷', '/'],
  ['4', '4'], ['5', '5'], ['6', '6'], ['×', '*'],
  ['1', '1'], ['2', '2'], ['3', '3'], ['−', '-'],
  ['0', '0'], ['.', '.'], ['%', '%'], ['+', '+']];
const SHOW = { '/': '÷', '*': '×', '-': '−' };
const NAMES = { clear: 'Clear', back: 'Backspace', '/': 'Divide', '*': 'Multiply', '-': 'Minus', '+': 'Plus', '%': 'Percent', '(': 'Open bracket', ')': 'Close bracket', '.': 'Point' };
const NS = 'http://www.w3.org/2000/svg';
function icon() {
  const s = document.createElementNS(NS, 'svg');
  for (const [k, v] of Object.entries({ viewBox: '0 0 24 24', width: '20', height: '20', 'aria-hidden': 'true', class: 'lc-icon' })) s.setAttribute(k, v);
  const add = (tag, a) => { const e = document.createElementNS(NS, tag); for (const k in a) e.setAttribute(k, a[k]); s.append(e); };
  add('rect', { x: 4, y: 2.5, width: 16, height: 19, rx: 2.5, fill: 'none', stroke: 'currentColor', 'stroke-width': 2 });
  add('rect', { x: 7, y: 5.5, width: 10, height: 4, rx: 1, fill: 'currentColor' });
  for (const [x, y] of [[8, 13], [12, 13], [16, 13], [8, 17], [12, 17], [16, 17]]) add('circle', { cx: x, cy: y, r: 1.2, fill: 'currentColor' });
  return s;
}

function ensureCalcCss() {
  if (!document.querySelector('link[data-learn-calc]')) document.head.append(h('link', { rel: 'stylesheet', href: '/m/learn/calc.css?v=__V__', 'data-learn-calc': '' }));
}

let mounted = null, owner = null;                                    // the building element that owns it; a re-render of the building hands it over
export function mountCalculator(el) {
  owner = el;
  if (mounted?.isConnected) return;
  ensureCalcCss();
  let open = false, expr = '', fresh = false, last = null;
  try { open = sessionStorage.getItem('ln-calc') === '1'; } catch {}
  const save = () => { try { sessionStorage.setItem('ln-calc', open ? '1' : '0'); } catch {} };

  const exprEl = h('div', { class: 'lc-expr' });
  const resEl = h('div', { class: 'lc-result', 'aria-live': 'polite', 'aria-atomic': 'true' });
  const screen = h('div', { class: 'lc-screen', tabindex: '0', role: 'group', 'aria-label': 'Calculator display' }, exprEl, resEl);
  const use = h('button', { type: 'button', class: 'lc-use', hidden: true, onclick: useIt }, 'Use this');
  const close = h('button', { type: 'button', class: 'lc-close', 'aria-label': 'Hide calculator', onclick: () => set(false, true) }, '×');
  const keys = h('div', { class: 'lc-keys' }, KEYS.map(([label, k]) => h('button', { type: 'button', class: `lc-key ${/[\d.]/.test(k) ? 'num' : k === 'clear' || k === 'back' ? 'fn' : 'op'}`, 'aria-label': NAMES[k] || label, onclick: (e) => tap(e, k) }, label)),
    h('button', { type: 'button', class: 'lc-key eq', 'aria-label': 'Equals', onclick: (e) => tap(e, '=') }, '='));
  const panel = h('div', { class: 'lc-panel', id: 'lc-panel', role: 'dialog', 'aria-label': 'Calculator' }, h('div', { class: 'lc-head' }, h('span', { class: 'lc-title' }, 'Calculator'), close), screen, keys, use);
  const handle = h('button', { type: 'button', class: 'lc-handle', 'aria-expanded': 'false', 'aria-controls': 'lc-panel', onclick: () => set(!open, true) }, icon(), h('span', { class: 'lc-sr' }, 'Calculator'));
  const root = h('div', { class: 'lc-root' }, panel, handle);
  mounted = root; document.body.append(root);

  const numberBox = () => document.querySelector('input.ln-input');
  function paint() {
    exprEl.textContent = expr.replace(/[*/-]/g, (c) => SHOW[c]) || '0';
    use.hidden = !(last != null && numberBox());
  }
  function tap(e, k) {                                             // a mouse or touch tap (detail > 0) hands focus back to the display, so typed keys and Enter carry on there
    press(k);
    if (e.detail) screen.focus({ preventScroll: true });
  }
  function press(k) {
    if (k === 'clear') { expr = ''; resEl.textContent = ''; last = null; fresh = false; }
    else if (k === 'back') { expr = fresh ? '' : expr.slice(0, -1); fresh = false; }
    else if (k === '=') {
      const r = calculate(expr);
      if (r.error) { resEl.textContent = r.error; last = null; }
      else { last = r.value; const t = formatResult(r.value); resEl.textContent = `= ${t}`; expr = t; fresh = true; }
    } else {
      if (fresh && /[\d.(]/.test(k)) expr = '';                      // typing a number after "=" starts over; an operator carries on from the result
      fresh = false; resEl.textContent = ''; last = null;
      if (expr.length < 100) expr += k;
    }
    paint();
  }
  function useIt() {
    const box = numberBox(); if (!box || last == null) return;
    const dollars = box.closest('.ln-answer')?.querySelector('.ln-unit')?.textContent.trim() === '$';
    box.value = dollars ? String(Math.round(last * 100) / 100) : formatResult(last);
    box.dispatchEvent(new Event('input', { bubbles: true }));
    box.focus();
  }
  function set(v, focus) {
    open = v; save();
    root.classList.toggle('open', v); handle.setAttribute('aria-expanded', String(v));
    panel.inert = !v; panel.setAttribute('aria-hidden', String(!v));
    if (v) { paint(); if (focus) screen.focus({ preventScroll: true }); } else if (focus) handle.focus({ preventScroll: true });
  }
  panel.addEventListener('keydown', (e) => {
    e.stopPropagation();                                           // the lesson's own shortcuts (1-4 pick an answer, Enter checks) must not fire from here
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const btn = e.target.closest?.('button');
    const act = keyAction(e.key, btn ? (btn.classList.contains('lc-key') ? 'key' : 'button') : 'other');
    if (!act) return;
    e.preventDefault();
    if (act === 'close') set(false, true); else press(act);
  });
  // The "Use this" button follows the lesson: it appears only while a number box is on screen. The building closing removes the calculator.
  const watch = setInterval(() => {
    if (!owner?.isConnected) { clearInterval(watch); root.remove(); mounted = null; return; }
    if (open) use.hidden = !(last != null && numberBox());
  }, 500);
  set(open, false);
}
