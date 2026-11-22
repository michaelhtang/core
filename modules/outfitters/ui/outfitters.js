import { h, api, fmt, buildingIcon, guard } from '/ui.js?v=__V__';

// Outfitters: a shop (price + GST + total, need or want, and what that money would grow to if invested), "My look" and "My place" (what you own,
// what you paid against what it is worth now, equip one per slot, sell back), and achievements with class goals. Cosmetic only: nothing here changes
// your money, rates or score. Item icons are the module's own inline SVG, re-checked by buildingIcon (public/svg-allow.js) before they are inserted.
const SLOTS = { wardrobe: [['head', 'Head'], ['top', 'Top'], ['bottom', 'Bottom'], ['shoes', 'Shoes'], ['accessory', 'Accessory']], home: [['couch', 'Couch'], ['bed', 'Bed'], ['desk', 'Desk'], ['tech', 'Tech'], ['decor', 'Decor']] };
const TABS = [['shop', 'Shop'], ['look', 'My look'], ['place', 'My place'], ['earned', 'Achievements']];
const pct = (bp) => `${(bp / 100).toFixed(bp % 100 ? 1 : 0)}%`;

export async function render(el, ctx) {
  if (!document.querySelector('link[data-outfitters]')) document.head.append(h('link', { rel: 'stylesheet', href: new URL('outfitters.css', import.meta.url).href, 'data-outfitters': '' }));
  let s = null, last = '', tab = 'shop', group = 'all', confirming = null, timer = null;
  const payWith = new Map();                                                       // item id -> 'chequing' | 'card', survives redraws
  const msg = h('p', { role: 'status' });
  const wallet = h('div', { class: 'of-wallet' });
  const banner = h('div', { class: 'stack' });
  const body = h('div', { class: 'stack' });
  const say = (text, bad) => { msg.className = bad ? 'error' : 'ok'; msg.textContent = text; };
  const act = async (path, data, ok) => { try { const r = await api(path, data); say(typeof ok === 'function' ? ok(r) : ok); } catch (e) { say(e.message, true); } await load(); };
  const ico = (svg, cls = '') => h('span', { class: `of-ico ${cls}` }, buildingIcon(svg));
  const tag = (c) => h('span', { class: `of-tag of-${c}` }, c === 'need' ? 'Need' : 'Want');

  function shopCard(i) {
    const mode = payWith.get(i.id) ?? 'chequing';
    const sel = s.card ? h('select', { 'aria-label': `Pay for ${i.name} with`, onchange: (e) => payWith.set(i.id, e.target.value) },
      h('option', { value: 'chequing', selected: mode === 'chequing' }, `Chequing (${fmt(s.balance_cents)})`),
      h('option', { value: 'card', selected: mode === 'card' }, s.card.available_cents === null ? 'Credit card (limit not known yet)' : `Credit card (${fmt(s.card.available_cents)} available)`)) : null;
    return h('article', { class: 'of-card' },
      h('div', { class: 'of-head' }, ico(i.icon), h('h3', {}, i.name), tag(i.category)),
      h('table', { class: 'of-lines' }, h('tbody', {},
        h('tr', {}, h('td', {}, 'Price'), h('td', {}, fmt(i.price_cents))),
        h('tr', {}, h('td', {}, 'GST (5%)'), h('td', {}, fmt(i.gst_cents))),
        h('tr', { class: 'of-total' }, h('td', {}, 'Total'), h('td', {}, fmt(i.total_cents))))),
      h('p', { class: 'of-grow' }, `This ${fmt(i.total_cents)} = `, h('b', {}, fmt(i.grow_cents)), ` in ${s.projection.years} years if invested instead.`),
      h('div', { class: 'of-buy' }, sel,
        h('button', { type: 'button', disabled: i.owned || !s.open, onclick: guard(() => act('/api/outfitters/buy', { item: i.id, source: sel?.value ?? 'chequing' }, `You bought ${i.name} for ${fmt(i.total_cents)}.`)) },
          i.owned ? 'You own this' : s.open ? `Buy for ${fmt(i.total_cents)}` : 'Store closed')),
      i.illustrative ? null : h('p', { class: 'muted small' }, `Price read from a Canadian retail page. `, i.source_url ? h('a', { href: i.source_url, target: '_blank', rel: 'noopener' }, 'source') : null));
  }

  function shopView() {
    const items = s.items.filter((i) => group === 'all' || i.grp === group);
    return [
      h('div', { class: 'of-tabs of-filter', role: 'group', 'aria-label': 'Show' }, [['all', 'Everything'], ['wardrobe', 'Wardrobe'], ['home', 'Home']].map(([g, label]) =>
        h('button', { type: 'button', class: 'ghost', 'aria-pressed': String(group === g), onclick: () => { group = g; draw(); } }, label))),
      h('p', { class: 'muted small' }, `A need keeps you warm, fed or working. A want is nice to have. Prices include inflation${s.index_bp === 10000 ? '' : ` (x${(s.index_bp / 10000).toFixed(4)})`}; Alberta has no PST, only 5% GST. `,
        `"Grows to" uses ${pct(s.projection.bp)} a year, FP Canada's 2026 planning rate for Canadian stocks (a projection, not a promise). `,
        h('a', { href: s.projection.url, target: '_blank', rel: 'noopener' }, 'source'), s.open ? '' : ' The store is closed right now.'),
      h('div', { class: 'of-grid' }, items.map(shopCard)),
    ];
  }

  function ownedCard(o) {
    const worth = o.earned ? h('p', { class: 'small' }, o.venture ? 'Bought from a student company on Venture Row: it cannot be sold back here.' : 'Earned, not bought: it cannot be sold.')
      : h('p', { class: 'small' }, `You paid ${fmt(o.paid_cents)} (with GST). It is worth ${fmt(o.value_cents)} now`, o.months_owned > 0 ? ` after ${o.months_owned} month${o.months_owned === 1 ? '' : 's'}.` : ': you just bought it.');
    return h('article', { class: 'of-card' },
      h('div', { class: 'of-head' }, ico(o.icon), h('h3', {}, o.name), o.earned ? h('span', { class: 'of-tag of-need' }, o.venture ? 'Venture Row' : 'Earned') : tag(o.category)),
      worth,
      h('div', { class: 'of-buy' },
        h('button', { type: 'button', class: o.equipped ? 'ghost' : '', onclick: guard(() => act(o.equipped ? '/api/outfitters/unequip' : '/api/outfitters/equip', { id: o.id }, o.equipped ? `${o.name} taken off.` : `You are wearing ${o.name}.`)) },
          o.equipped ? (o.grp === 'home' ? 'Remove' : 'Take off') : (o.grp === 'home' ? 'Put in place' : 'Wear')),
        o.earned ? null : h('button', { type: 'button', class: 'ghost', disabled: !s.open || o.value_cents <= 0, onclick: guard(() => {
          if (confirming !== o.id) { confirming = o.id; clearTimeout(timer); timer = setTimeout(() => { confirming = null; draw(); }, 5000); draw(); return; }
          confirming = null; return act('/api/outfitters/sell', { id: o.id }, (r) => `Sold ${o.name} for ${fmt(r.value_cents)}. You paid ${fmt(r.paid_cents)} before GST.`);
        }) }, confirming === o.id ? `Sell for ${fmt(o.value_cents)}?` : `Sell for ${fmt(o.value_cents)}`)));
  }

  function ownedView(grp) {
    const mine = s.owned.filter((o) => o.grp === grp), by = new Map(mine.filter((o) => o.equipped).map((o) => [o.slot, o]));
    return [
      h('div', { class: 'of-slots' }, SLOTS[grp].map(([slot, label]) => by.has(slot)
        ? h('div', { class: 'of-slot' }, ico(by.get(slot).icon), h('b', {}, label), h('span', {}, by.get(slot).name))
        : h('div', { class: 'of-slot of-empty' }, h('b', {}, label), h('span', {}, 'Empty')))),
      mine.length ? h('div', { class: 'of-grid' }, mine.map(ownedCard)) : h('p', { class: 'muted' }, grp === 'home' ? 'Nothing in your place yet. Check the Shop.' : 'Nothing in your wardrobe yet. Check the Shop.'),
      h('p', { class: 'muted small' }, 'Things lose value the day you buy them. Clothes lose the most, then electronics, then furniture. Resale pays the current value, never the GST back.'),
    ];
  }

  function earnedView() {
    const bar = (p) => { const i = h('i'); i.style.width = `${p}%`; return h('div', { class: 'of-bar', role: 'img', 'aria-label': `${p}%` }, i); };   // CSSOM, not a style attribute (the page's CSP)
    const c = s.class;
    return [
      h('div', { class: 'of-grid' }, s.achievements.map((a) => h('article', { class: `of-card${a.unlocked ? '' : ' of-locked'}` },
        h('div', { class: 'of-head' }, ico(a.icon), h('h3', {}, a.name), a.unlocked ? h('span', { class: 'of-done' }, 'Unlocked') : null),
        h('p', { class: 'small' }, a.how),
        a.unlocked ? h('p', { class: 'small of-done' }, `Unlocked in world month ${a.unlocked_month}. Find it in ${s.owned.find((o) => o.item_id === a.item_id)?.grp === 'home' ? 'My place' : 'My look'}.`)
          : [bar(a.pct), h('p', { class: 'small muted' }, a.text)]))),
      c ? h('div', { class: 'stack' },
        h('p', { class: 'label' }, 'Class goals'),
        h('p', { class: 'muted small' }, 'When 80% of your class meets a goal, the whole class unlocks a Wolf outfit for the corner mascot. Nobody can do it alone.'),
        c.outfit ? h('p', { class: 'of-done' }, `Your class has unlocked: ${c.outfit.name}.`) : null,
        h('div', { class: 'of-grid' }, c.goals.map((g) => h('article', { class: 'of-card' },
          h('div', { class: 'of-head' }, h('h3', {}, g.name), g.unlocked ? h('span', { class: 'of-done' }, 'Unlocked') : null),
          h('p', { class: 'small' }, g.how),
          bar(Math.min(100, Math.floor((g.pct * 100) / 80))),
          h('p', { class: 'small muted' }, g.key === 'credit' ? `${g.pct}% of the class has a score${g.median ? `; the median is ${g.median}` : ''} (goal: 80% with a score, median 700).` : `${g.pct}% of the class on time (goal: 80%).`),
          g.unlocked ? h('p', { class: 'small of-done' }, `Outfit: ${g.outfit_name}.`) : null)))) : null,
    ];
  }

  function draw() {
    const owedWallet = [h('span', { class: 'chip' }, `Chequing ${fmt(s.balance_cents)}`), s.card ? h('span', { class: 'chip' }, s.card.available_cents === null ? 'Credit card: limit not known yet' : `Card available ${fmt(s.card.available_cents)}`) : null];
    wallet.replaceChildren(...owedWallet.filter(Boolean));
    banner.replaceChildren(...(s.announce.length ? [h('p', { class: 'of-banner', role: 'status' }, `Unlocked: ${s.announce.join(', ')}`)] : []));
    for (const b of el.querySelectorAll('.of-tabs[data-main] button')) b.setAttribute('aria-pressed', String(b.dataset.tab === tab));
    body.replaceChildren(...(tab === 'shop' ? shopView() : tab === 'look' ? ownedView('wardrobe') : tab === 'place' ? ownedView('home') : earnedView()).flat().filter(Boolean));
  }

  async function load() {
    s = await api('/api/outfitters/state');
    const key = JSON.stringify(s);
    if (key !== last) { last = key; draw(); }
    if (s.class?.outfit) {                                                          // class mascot: only once its art exists, else the plain wolf stays
      const url = `/art/wolf-${s.class.outfit.key}.png?v=__V__`, img = new Image();
      img.onload = () => document.documentElement.style.setProperty('--mascot-image', `url('${url}')`);
      img.src = url;
    }
    if (s.announce.length) api('/api/outfitters/seen', {}).catch(() => {});         // announced once
  }

  const tabs = h('div', { class: 'of-tabs', 'data-main': '', role: 'group', 'aria-label': 'Outfitters sections' }, TABS.map(([id, label]) =>
    h('button', { type: 'button', 'data-tab': id, 'aria-pressed': String(id === tab), onclick: () => { tab = id; draw(); } }, label)));
  el.append(h('h2', {}, 'Outfitters'),
    h('p', { class: 'muted small' }, 'Wardrobe and home items. They are only for show: nothing you buy changes your money, rates or credit score. The best items are earned, not bought.'),
    wallet, banner, tabs, msg, body);
  ctx.onRefresh(() => load().catch(() => {}));
  await load();
}
