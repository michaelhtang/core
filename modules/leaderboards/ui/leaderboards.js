import { h, api } from '/ui.js?v=__V__';

// Amphitheatre: net worth and health boards (your class and the town), class vs class, Hall of Fame, and last season's Life Review.
// Built from h() and textContent only: pseudonyms come from the server and never touch innerHTML.
const whole = (c) => (c / 100).toLocaleString('en-CA', { style: 'currency', currency: 'CAD', maximumFractionDigits: 0 });
const exact = (c) => (c / 100).toLocaleString('en-CA', { style: 'currency', currency: 'CAD' });
export const PARTS = [['cushion', 'Savings cushion'], ['on_time', 'On time'], ['credit', 'Credit'], ['load', 'Debt load'], ['coverage', 'Retirement coverage'], ['calm', 'Calm']];   // coverage (5c) replaces load in Stage C
const partsOf = (parts) => PARTS.filter(([key]) => parts[key] != null);   // calm (6a) only where the stress module scored it; older snapshots have four
// replaceChildren would print a null child as the text "null", so optional children go through here.
const fill = (box, ...kids) => box.replaceChildren(...kids.flat().filter((x) => x != null && x !== false));
const TABS = [['net', 'Net worth'], ['health', 'Health'], ['classes', 'Classes'], ['hall', 'Hall of Fame']];

export const tierChip = (name, tiers = []) => h('span', { class: `lb-tier t${Math.max(0, tiers.indexOf(name))}` }, name);
export function delta(d) {
  if (d == null) return h('span', { class: 'lb-delta', title: 'New on the board' }, 'new');
  if (d > 0) return h('span', { class: 'lb-delta up', 'aria-label': `up ${d} places` }, `▲${d}`);
  if (d < 0) return h('span', { class: 'lb-delta down', 'aria-label': `down ${-d} places` }, `▼${-d}`);
  return h('span', { class: 'lb-delta', 'aria-label': 'no change' }, '–');
}
const value = (r, metric) => (metric === 'net' ? (r.net_worth_cents == null ? '' : whole(r.net_worth_cents)) : `${r.health}/100`);
const rowEl = (r, metric, tiers, label) => h('li', { class: `lb-row${r.mine ? ' mine' : ''}` },
  h('span', { class: 'lb-rank' }, `#${r.rank}`),
  h('span', { class: 'lb-who' }, h('b', {}, label ? `You (${r.name})` : r.name), tierChip(r.tier, tiers)),
  delta(r.delta), h('span', { class: 'lb-val' }, value(r, metric)));

function bar(label, score) {
  const fill = h('span', {});
  fill.style.width = `${score}%`;   // CSSOM, not a style attribute: the CSP allows it
  return h('div', { class: 'lb-bar', role: 'img', 'aria-label': `${label} ${score} out of 100` }, fill);
}

export function boardList(b, metric, tiers, scopeName) {
  if (!b.size) return h('p', { class: 'lb-note' }, 'Nobody is on this board yet.');
  return h('div', { class: 'stack' },
    h('ol', { class: 'lb-list', 'aria-label': `${scopeName} top ${b.top.length}` }, b.top.map((r) => rowEl(r, metric, tiers))),
    b.me ? h('ol', { class: 'lb-list', 'aria-label': 'Your row' }, rowEl(b.me, metric, tiers, true)) : null,
    b.me ? h('p', { class: 'lb-note' }, `You: #${b.me.rank} of ${b.size}${b.me.delta ? `, ${b.me.delta > 0 ? '▲' : '▼'}${Math.abs(b.me.delta)}` : ''}${metric === 'net' && b.me.net_worth_cents != null ? `, ${whole(b.me.net_worth_cents)}` : ''}`) : null);
}

export function partsView(me) {
  return h('div', { class: 'lb-card' },
    h('div', { class: 'spread' }, h('h3', {}, 'Your financial health'), h('span', { class: 'lb-health', 'aria-label': `Health score ${me.health} out of 100` }, `${me.health}`)),
    h('div', { class: 'lb-parts' }, partsOf(me.parts).map(([key, label]) => h('div', { class: `lb-part${key === me.tip.part ? ' weak' : ''}` }, h('span', {}, label), bar(label, me.parts[key]), h('b', {}, `${me.parts[key]}`)))),
    h('p', { class: 'lb-note' }, h('b', {}, `Work on: ${me.tip.name}. `), me.tip.text));
}

export function classesView(rows) {
  return h('div', { class: 'stack' },
    h('p', { class: 'lb-note' }, 'Ranked by median net worth, then median health. Medians, not averages, so one rich student cannot carry a class.'),
    h('ol', { class: 'lb-list' }, rows.map((c) => h('li', { class: `lb-class${c.mine ? ' mine' : ''}` },
      h('span', { class: 'lb-rank' }, `#${c.rank_net}`),
      h('span', {}, h('b', {}, c.name), h('small', {}, `${c.size} students${c.mine ? ', your class' : ''}, health rank #${c.rank_health}`)),
      h('span', { class: 'lb-val' }, c.median_net_worth_cents == null ? '' : whole(c.median_net_worth_cents)),
      h('span', { class: 'lb-val' }, `${c.median_health}/100`)))));
}

export function hallView(seasons) {
  if (!seasons.length) return h('p', { class: 'lb-note' }, 'No season has finished yet. The awards from every past season will be kept here.');
  const line = (a) => (a.value == null ? null : a.award === 'wolf' || a.award === 'founder' ? whole(a.value) : a.award === 'comeback' ? `${a.value} places up` : a.award === 'employer' ? `${a.value} staff` : `health ${a.value}/100`);
  return h('div', { class: 'stack' }, seasons.map((s) => h('div', { class: 'lb-card' }, h('h3', {}, s.season),
    h('div', { class: 'lb-awards' }, s.awards.map((a) => h('div', { class: 'lb-award' },
      h('b', {}, a.title), h('span', {}, a.name ?? a.class_name ?? ''), a.name && a.class_name ? h('small', { class: 'lb-note' }, a.class_name) : null,
      line(a) ? h('small', { class: 'lb-note' }, line(a)) : null))))));
}

// "Your life in snapshots" (wave 5b): net worth at each age, and the allocation at 25 and 65 as one stacked bar each with the same numbers as text.
const ALLOC = [['equities', 'Equities'], ['bonds', 'Bonds'], ['cash', 'Cash'], ['other', 'Other']];
function allocRow({ age, parts }) {
  const total = ALLOC.reduce((t, [key]) => t + parts[key], 0);
  const shares = ALLOC.map(([key, label]) => ({ key, label, pct: total ? Math.round((parts[key] * 100) / total) : 0 })).filter((x) => x.pct > 0);
  const text = total ? shares.map((x) => `${x.label} ${x.pct}%`).join(', ') : 'Nothing invested';
  const bar = h('div', { class: 'lb-stack', role: 'img', 'aria-label': `Age ${age}: ${text}` }, shares.map((x) => { const seg = h('span', { class: x.key }); seg.style.width = `${x.pct}%`; return seg; }));
  return h('div', { class: 'lb-alloc' }, h('span', {}, `Age ${age}`), bar, h('small', { class: 'lb-note' }, `${text}${total ? ` of ${whole(total)}` : ''}`));
}
function lifeView(life) {
  const nets = life.net_worth.filter((n) => n.net_worth_cents != null), allocs = life.allocation.filter((a) => a.parts);
  return h('div', { class: 'stack' },
    h('p', { class: 'label' }, 'Your life in snapshots'),
    nets.length ? h('div', { class: 'lb-facts' }, nets.map((n) => h('div', {}, h('span', { class: 'lb-note' }, `Net worth at ${n.age}`), h('b', {}, whole(n.net_worth_cents))))) : null,
    allocs.length ? h('div', { class: 'lb-parts' }, allocs.map(allocRow)) : null);
}

// Pattern flags (6a): each with the number behind it. Also used by the teacher panel.
export const flagList = (fl) => h('ul', { class: 'lb-flags' }, fl.map((f) => h('li', {}, h('b', {}, f.text), h('span', { class: 'lb-note' }, ` ${f.detail}`))));

function review(last, tiers) {
  const best = last.best_month;
  return h('div', { class: 'lb-card' },
    h('p', { class: 'label' }, `Last season: ${last.season}`), h('h3', {}, 'Your Life Review'),
    h('div', { class: 'lb-facts' },
      h('div', {}, h('span', { class: 'lb-note' }, 'Final net worth'), h('b', {}, exact(last.net_worth_cents))),
      h('div', {}, h('span', { class: 'lb-note' }, 'Wolf rank'), tierChip(last.tier, tiers)),
      h('div', {}, h('span', { class: 'lb-note' }, 'Finished'), h('b', {}, `#${last.rank_town} of ${last.of_town}`))),
    best ? h('p', {}, `Best month: month ${best.month}, ${best.gain_cents >= 0 ? '+' : '-'}${exact(Math.abs(best.gain_cents))}.`) : null,
    h('div', { class: 'lb-parts' }, partsOf(last.parts).map(([key, label]) => h('div', { class: 'lb-part' }, h('span', {}, label), bar(label, last.parts[key]), h('b', {}, `${last.parts[key]}`)))),
    last.life ? lifeView(last.life) : null,
    last.flags?.length ? h('div', {}, h('p', { class: 'label' }, 'What the numbers say'), flagList(last.flags)) : null);
}

export async function render(el, ctx) {
  if (!document.querySelector('link[data-lb]')) document.head.append(h('link', { rel: 'stylesheet', href: '/m/leaderboards/leaderboards.css?v=__V__', 'data-lb': '' }));
  let data = null, hall = null, tab = 'net', scope = 'class';
  const news = h('div', {}), top = h('div', { class: 'stack' }), tabs = h('div', { class: 'lb-tabs', role: 'tablist', 'aria-label': 'Boards' });
  const scopes = h('div', { class: 'lb-scope', role: 'group', 'aria-label': 'Which board' }), body = h('div', { class: 'stack', role: 'tabpanel' }), msg = h('p', { role: 'status', class: 'error' });

  function paint() {
    const d = data;
    fill(tabs, ...TABS.map(([key, label]) => h('button', { type: 'button', role: 'tab', 'aria-selected': String(key === tab), onclick: () => open(key) }, label)));
    fill(scopes, ...(tab === 'net' || tab === 'health' ? [['class', 'My class'], ['town', 'Town']].map(([key, label]) => h('button', { type: 'button', 'aria-pressed': String(key === scope), onclick: () => { scope = key; paint(); } }, label)) : []));
    fill(news, d.me?.rank_up ? h('div', { class: 'lb-card news', role: 'status' }, h('h3', {}, `You ranked up to ${d.me.rank_up}!`), h('p', {}, 'Your net worth crossed a new line. Keep going.'),
      h('div', {}, h('button', { type: 'button', onclick: async () => { try { await api('/api/leaderboards/ack', {}); await load(); } catch (e) { msg.textContent = e.message; } } }, 'Nice!'))) : null);
    fill(top, 
      d.frozen ? h('p', { class: 'lb-note' }, `The boards are frozen for a test. They show world month ${d.month}.`) : null,
      d.hidden ? h('p', { class: 'lb-note' }, 'Your teacher is hiding dollar amounts for now. Ranks and Wolf ranks still count.') : null,
      d.last_season ? review(d.last_season, d.tiers) : null);
    if (d.empty) { fill(body, h('p', { class: 'lb-note' }, 'The boards open after the first world month. Your Wolf rank starts at Pup.')); return; }
    if (tab === 'net' || tab === 'health') {
      const next = d.me?.next;
      fill(body, 
        tab === 'health' && d.me ? partsView(d.me) : null,
        tab === 'net' && d.me ? h('p', { class: 'lb-note' }, next ? (next.at_cents == null ? `Next Wolf rank: ${next.name}.` : `Next Wolf rank: ${next.name} at ${whole(next.at_cents)} (the line rises with prices).`) : 'You are an Alpha. Hold the pack.') : null,
        h('p', { class: 'label' }, `${scope === 'class' ? 'My class' : 'The whole town'}, ${tab === 'net' ? 'net worth' : 'financial health'}`),
        d.me ? null : h('p', { class: 'lb-note' }, 'You will appear on the boards after the next world month.'),
        boardList(d[tab][scope], tab, d.tiers, scope === 'class' ? 'Class' : 'Town'));
    } else if (tab === 'classes') fill(body, classesView(d.classes));
    else fill(body, hall ? hallView(hall) : h('p', { class: 'lb-note' }, 'Loading...'));
  }
  async function loadHall() { try { hall = (await api('/api/leaderboards/hall')).seasons; paint(); } catch (e) { msg.textContent = e.message; } }
  function open(key) { tab = key; paint(); if (key === 'hall') loadHall(); }
  async function load() {
    try {
      data = await api('/api/leaderboards/board');
      msg.textContent = '';
      paint();
      if (tab === 'hall') loadHall();
    } catch (e) { msg.textContent = e.message; }
  }
  el.append(h('div', { class: 'lb' },
    h('h2', {}, 'Amphitheatre'), h('p', { class: 'label' }, 'Highest net worth wins. Health and class count too.'),
    news, top, tabs, scopes, body, msg));
  ctx.onRefresh(() => load());
  await load();
}
