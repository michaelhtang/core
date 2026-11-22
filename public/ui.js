// Shared helpers for the student app, the teacher console and module panels.
import { SVG_ELEMENTS, SVG_ATTRIBUTES, safeSvgValue, svgSourceProblem } from '/svg-allow.js?v=__V__';

// h('div', { class: 'x', onclick: fn }, child, ...) builds DOM with textContent only, so nothing here can inject HTML.
export function h(tag, attrs, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (v === true) el.setAttribute(k, '');
    else if (v !== false && v != null) el.setAttribute(k, v);
  }
  el.append(...kids.flat().filter((x) => x != null && x !== false));
  return el;
}

// One place for "are you sure?" on irreversible teacher actions (the native dialog: no modal to build, and it blocks the live refresh while open).
export const confirmAction = (text) => window.confirm(text);

// A request that never answers would otherwise leave the teacher console's one-action-at-a-time flag stuck until a reload. 90 s stays
// under Cloudflare's 100 s origin timeout and above a 12-month advance on a slow VM; the server may still finish the work.
const API_TIMEOUT_MS = 90000;
export async function api(path, body) {
  const signal = AbortSignal.timeout(API_TIMEOUT_MS);
  const res = await fetch(path, body === undefined ? { signal } : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal })
    .catch((e) => { throw new Error(e.name === 'TimeoutError' ? 'The server did not answer in time. Refresh to see whether it went through.' : 'Could not reach core. Check your connection and try again.'); });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(data.error || 'Something went wrong'), { status: res.status });
  return data;
}

// Student-side double-tap guard for any handler that posts money: wrap the onclick/onsubmit handler and its button is disabled while
// the request is in flight, and a second tap is ignored even if the panel redraws the button meanwhile. The handler must return its promise.
export function guard(fn) {
  let running = false;
  return async (e) => {
    if (running) { e?.preventDefault?.(); return undefined; }
    running = true;
    const btn = e?.submitter ?? e?.currentTarget;            // read now: currentTarget is gone after the first await
    const el = btn?.tagName === 'BUTTON' ? btn : null;
    // If the panel sets `disabled` itself while the request runs (nothing left to pay, store closed...), that wins: only a button
    // nobody else touched is released. The observer sees every write to the attribute; our own is taken back at once.
    let touched = false;
    const watch = el && new MutationObserver(() => { touched = true; });
    if (el) { watch.observe(el, { attributes: true, attributeFilter: ['disabled'] }); el.disabled = true; watch.takeRecords(); }
    try { return await fn(e); } finally {
      running = false;
      if (el) { if (watch.takeRecords().length) touched = true; watch.disconnect(); if (!touched) el.disabled = false; }
    }
  };
}

// Money is integer cents everywhere; this is the only place it becomes dollars. Always real CAD.
export const fmt = (cents) => (cents / 100).toLocaleString('en-CA', { style: 'currency', currency: 'CAD' });

// "12.5" -> 1250. Returns null for anything that isn't dollars and at most two decimals.
export function dollarsToCents(text) {
  const m = /^\s*\$?(\d{1,7})(?:\.(\d{1,2}))?\s*$/.exec(text);
  return m ? Number(m[1]) * 100 + Number((m[2] || '').padEnd(2, '0')) : null;
}

export const when = (ms) => new Date(ms).toLocaleString('en-CA', { dateStyle: 'medium', timeStyle: 'short' });

// Static inline SVG (no user data), so innerHTML is safe here. Colours come from CSS.
const ICONS = {
  coin: '<svg class="coin" viewBox="0 0 48 48" aria-hidden="true"><circle class="face" cx="24" cy="24" r="21"/><circle class="rim" cx="24" cy="24" r="21"/><circle class="rim" cx="24" cy="24" r="15"/><path class="shine" d="M13 17a13 13 0 0 1 8-6"/><text class="mark" x="24" y="32" text-anchor="middle" font-size="24">$</text></svg>',
  bank: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 9l9-5 9 5M5 9v9M9.500 9v9M14.500 9v9M19 9v9M3 20h18"/></svg>',
  job: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="7" width="18" height="13" rx="2"/><path d="M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2M3 13h18"/></svg>',
  housing: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 11l9-7 9 7M5 10v10h14V10M10 20v-6h4v6"/></svg>',
  exchange: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 20h18M6 16l4-5 3 3 5-7M15 7h3v3"/></svg>',
  registry: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 10l1.500-5h13L20 10M4 10v10h16V10M4 10c0 2 3 2 4 0 1 2 3 2 4 0 1 2 3 2 4 0 1 2 4 2 4 0M10 20v-5h4v5"/></svg>',
  building: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 21V9l8-5 8 5v12M4 21h16M9 21v-6h6v6"/></svg>',
  sound: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9v6h4l5 4V5L8 9zM16.500 9a4 4 0 0 1 0 6M19 6.500a8 8 0 0 1 0 11"/></svg>',
  mute: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9v6h4l5 4V5L8 9zM17 9l5 6M22 9l-5 6"/></svg>',
  expand: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/></svg>',
};
export function icon(name) {
  const span = document.createElement('span');
  span.className = 'icon';
  span.innerHTML = ICONS[name] ?? ICONS.building;
  return span;
}

// A building's icon from a module: a core icon name, or the module's own inline SVG. The SVG is parsed as XML and imported node by
// node (never innerHTML), and refused (generic icon instead) if it holds a <script>, a <foreignObject>, an on* attribute or a javascript: link.
export function buildingIcon(spec) {
  if (typeof spec !== 'string' || !spec.startsWith('<svg')) return icon(spec);
  if (svgSourceProblem(spec)) return icon('building');
  // Without the SVG namespace the parsed elements are inert XML and render blank, so add it when the module left it out.
  const src = /^<svg[^>]*\sxmlns\s*=/.test(spec) ? spec : spec.replace(/^<svg/, '<svg xmlns="http://www.w3.org/2000/svg"');
  const doc = new DOMParser().parseFromString(src, 'image/svg+xml');
  const root = doc.documentElement;
  const SVG_NS = 'http://www.w3.org/2000/svg';
  // Allowlist, checked again on the parsed tree: every element in the SVG namespace and on the list, every attribute on the list
  // with a safe value, and no node types other than elements, text and comments.
  const ok = root.localName === 'svg' && !doc.querySelector('parsererror') &&
    [root, ...root.querySelectorAll('*')].every((el) => el.namespaceURI === SVG_NS && SVG_ELEMENTS.has(el.localName) &&
      [...el.attributes].every((a) => SVG_ATTRIBUTES.has(a.name) && (a.name === 'xmlns' || safeSvgValue(a.value)))) &&
    !doc.evaluate('//processing-instruction()', doc, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue;
  if (!ok) return icon('building');
  const span = document.createElement('span');
  span.className = 'icon';
  span.append(document.importNode(root, true));
  return span;
}

// Top-right pill bar: sound toggle (no audio yet; it only remembers the choice) and full screen.
export function pillBar(...extra) {
  const get = () => { try { return localStorage.getItem('vdaa.sound') !== 'off'; } catch { return true; } };
  let on = get();
  const sound = h('button', { class: 'pill', type: 'button', 'aria-pressed': String(on), onclick() {
    on = !on;
    try { localStorage.setItem('vdaa.sound', on ? 'on' : 'off'); } catch { /* private window: fine */ }
    paint();
    window.dispatchEvent(new CustomEvent('vdaa:sound', { detail: { on } }));
  } });
  const paint = () => {
    sound.setAttribute('aria-pressed', String(on));
    sound.replaceChildren(icon(on ? 'sound' : 'mute'), on ? 'Sound on' : 'Sound off');
  };
  paint();
  const bar = h('nav', { class: 'pills', 'aria-label': 'Display options' }, sound);
  if (document.fullscreenEnabled) {
    const full = h('button', { class: 'pill', type: 'button', onclick: () => (document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen()) }, icon('expand'), 'Full screen');
    bar.append(full);
  }
  bar.append(...extra);
  return bar;
}
