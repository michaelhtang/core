import { h, api, fmt, icon, buildingIcon, pillBar } from '/ui.js?v=__V__';
import { createClientSync } from '/sync.js?v=__V__';
import { startDaylight } from '/daylight.js?v=__V__';

const root = document.getElementById('app');
startDaylight(document.getElementById('scene'));
const scene = document.getElementById('scene');
let me = null;
const refreshers = new Set(); // panel callbacks, cleared whenever the view changes

const panelOffs = new Set(); // unsubscribe functions of the open panel's on() listeners, called whenever the view changes

const chequing = () => me.accounts?.find((a) => a.kind === 'chequing');

// Everything about keeping `me` fresh (stream, refetch on open/reconnect, debounce, sequence numbers, login view when the
// session is gone) lives in sync.js. This file only draws.
const live = createClientSync({
  fetchMe: () => api('/api/me'),
  show(next) {                                           // the signed-in user changed (or first paint): full draw
    me = next;
    document.querySelector('.pills')?.remove();
    document.body.append(pillBar(...(me.user ? [h('button', { class: 'pill', type: 'button', onclick: () => logout() }, 'Log out'),
      h('button', { class: 'pill', type: 'button', title: 'Also signs you out on every other device', onclick: () => logout(true) }, 'Log out everywhere')] : [])));
    show();
  },
  offline(on) {                                          // the very first /api/me failed: say so (sync.js keeps retrying and calls show() when it works)
    if (!on) return;
    scene.dataset.zone = 'gate';
    root.replaceChildren(h('section', { class: 'glass panel' }, h('h1', { class: 'display' }, h('span', { class: 'wordmark' }, 'core')), h('p', { role: 'status' }, 'Can\'t reach core. Retrying…')));
  },
  update(next) {                                         // same user: touch only the live parts
    const flipped = me.world?.status !== next.world?.status;   // a season closed or a new one began: redraw everything
    me = next;
    if (flipped) return show();
    document.querySelectorAll('[data-balance]').forEach((el) => { el.textContent = fmt(chequing()?.balance_cents ?? 0); });
    document.querySelectorAll('[data-month]').forEach((el) => { el.textContent = `World month ${me.world?.month}`; });
    document.querySelectorAll('[data-status]').forEach((el) => { el.querySelectorAll('[data-badge]').forEach((b) => b.remove()); el.append(...badgeChips()); });   // a rank can change with the month
    refreshers.forEach((fn) => fn());
  },
  events: {
    balance() {},
    world() {},                                          // a season closed or began: just re-sync
    'feed.new'() {},                                     // pushed by the feed module (coalesced per class, no payload): re-sync redraws the chips, the Around town and Today cards
    'today.done'() {},                                   // pushed by the today module to the student whose errand or quest just finished
    month(ev) {                                          // the event carries the month: no need to wait for the refetch
      const { month } = JSON.parse(ev.data);
      document.querySelectorAll('[data-month]').forEach((el) => { el.textContent = `World month ${month}`; });
    },
  },
  broadcast: ['month', 'feed.new'],                       // class-wide hints get the random extra wait, so a whole class does not refetch in the same instant
});

async function logout(everywhere = false) {
  await api('/api/logout', { everywhere }).catch(() => {});          // idempotent on the server; if it is unreachable the next sync shows the truth
  location.hash = '';
  live.sync();
}

function show() {
  refreshers.clear();
  panelOffs.forEach((off) => off());
  panelOffs.clear();
  root.replaceChildren(...(me.preview ? [previewBar()] : []));   // a teacher's "view as student" (lib/preview.js): the bar tops every view
  const zone = me.user?.role === 'student' ? me.panels.find((p) => `#${p.building.key}` === location.hash) : null;
  scene.dataset.zone = !me.user ? 'gate' : zone ? zone.building.key : 'town';   // the login screen is the school's front entrance
  if (!me.user) return root.append(loginView());
  if (me.user.role === 'teacher') {
    return root.append(h('section', { class: 'glass panel' }, h('h1', { class: 'display' }, 'Hello, teacher'), h('p', {}, 'This is the student app. '), h('a', { href: '/teach' }, 'Open the teacher console'), previewPicks()));
  }
  if (me.world?.status !== 'active') return root.append(heading(), closedView());   // between seasons: no town, no buildings
  root.append(heading(), zone ? panelView(zone) : homeView());
}

// Teacher preview (lib/preview.js): the bar on every student view, and the buttons that start one.
const previewGo = (path, body, to) => api(path, body).then(() => { if (to) location.href = to; else { location.hash = ''; location.reload(); } }).catch(() => {});
function previewBar() {
  return h('div', { class: 'preview-bar', role: 'status' },
    h('span', {}, `Teacher preview: you are seeing what a ${me.preview.title} student sees. Nothing here changes real students.`),
    h('button', { type: 'button', class: 'ghost', onclick: () => previewGo('/api/preview/reset', { course: me.preview.course_id }) }, 'Start over'),
    h('button', { type: 'button', onclick: () => previewGo('/api/preview/exit', {}, '/teach') }, 'Exit preview'));
}
function previewPicks() {
  const box = h('div', { class: 'preview-picks' });
  api('/api/preview').then(({ courses }) => box.append(...courses.map((c) => h('button', { type: 'button', onclick: () => previewGo('/api/preview/start', { course: c.id }) }, `View as ${c.title} student`)))).catch(() => {});
  return box;
}

// Between seasons: the message, and this season's result from the Amphitheatre's Life Review when leaderboards is on.
function closedView() {
  const box = h('section', { class: 'glass panel' },
    h('h1', { class: 'display' }, 'Season closed'),
    h('p', {}, 'The season is closed. Your teacher will start the next one soon.'));
  if (me.panels?.some((p) => p.module === 'leaderboards')) {
    api('/api/leaderboards/board').then((b) => {
      const r = b.last_season;
      if (r) box.append(h('p', { class: 'label' }, r.season), h('div', { class: 'hero' }, icon('coin'), fmt(r.net_worth_cents)), h('p', { class: 'muted small' }, `Final net worth. Wolf rank: ${r.tier}`));
    }).catch(() => {});
  }
  return box;
}

function loginView() {
  const err = h('p', { class: 'error', role: 'alert' });
  const form = h('form', { class: 'glass panel', onsubmit: async (e) => {
    e.preventDefault();
    err.textContent = '';
    try {
      await api('/api/login', { username: form.username.value.trim(), secret: form.pin.value.trim() });
      await live.sync();
    } catch (ex) { err.textContent = ex.message; }
  } },
  h('h1', { class: 'display' }, 'Welcome to ', h('span', { class: 'wordmark' }, 'core')),
  h('p', { class: 'muted' }, 'Use the username and PIN on your card.'),
  h('label', {}, 'Username', h('input', { name: 'username', autocomplete: 'username', autocapitalize: 'none', spellcheck: 'false', required: true })),
  h('label', {}, 'PIN', h('input', { name: 'pin', type: 'password', inputmode: 'numeric', pattern: '[0-9]{6}', maxlength: '6', autocomplete: 'current-password', required: true })),
  h('button', { type: 'submit' }, 'Log in'),
  err);
  return form;
}

// Module badges beside the name, e.g. a Wolf rank; redrawn on every live update.
const badgeChips = () => (me.badges ?? []).map((b) => h('span', { class: 'chip', 'data-badge': true, title: b.title ?? null }, b.text));

function heading() {
  const cls = me.user.class;
  return h('header', {},
    h('p', { class: 'label' }, cls ? `${cls.name}` : 'Student'),
    h('h1', { class: 'display' }, `Hey, ${me.user.username}!`),
    h('div', { class: 'status', 'data-status': true }, h('span', { class: 'chip', 'data-month': true }, `World month ${me.world.month}`), badgeChips()));
}

function homeView() {
  // One door per panel of an enabled module: the town only shows buildings that are really open.
  const doors = me.panels.map((p) => h('button', { class: 'door', type: 'button', onclick: () => { location.hash = `#${p.building.key}`; } },
    buildingIcon(p.building.icon), p.building.name));
  const cards = me.homeCards ?? [];
  return h('div', { class: 'stack' },
    ...cards.filter((c) => c.lead).map(homeCard),                                   // a card that declares lead: true comes first, above the balance (docs/modules.md "Home cards")
    h('section', { class: 'glass balance' },
      h('p', { class: 'label' }, 'Chequing balance'),
      h('div', { class: 'hero' }, icon('coin'), h('span', { 'data-balance': true }, fmt(chequing()?.balance_cents ?? 0))),
      h('p', { class: 'muted small' }, 'Canadian dollars (CAD)')),
    ...cards.filter((c) => !c.lead).map(homeCard),
    h('nav', { class: 'doors', 'aria-label': 'Town buildings' }, doors));
}

// A module's home card (the homeCards hook): its renderer is an ES module from modules/<id>/ui that exports
// renderCard(el, { card, me, onRefresh, on }); `card` always reads the latest copy from me.homeCards. A renderer that fails leaves the title only.
function homeCard(c) {
  const body = h('div', {});
  const ctx = {
    get card() { return me.homeCards?.find((x) => x.module === c.module && x.id === c.id) ?? c; },
    get me() { return me; },
    onRefresh: (fn) => refreshers.add(fn),
    on: (name, fn) => { const off = live.on(name, fn); panelOffs.add(off); return off; },
  };
  import(c.src).then((m) => m.renderCard(body, ctx)).catch(() => body.replaceChildren());
  return h('section', { class: 'glass panel', 'data-card': `${c.module}/${c.id}` }, h('h2', {}, c.title), body);
}

// A building's panel is an ES module from modules/<id>/ui: export render(el, { me, onRefresh, on(eventName, fn) }).
function panelView(p) {
  const box = h('section', { class: 'glass panel' }, h('p', { class: 'muted' }, 'Opening...'));
  import(p.src)
    .then((m) => { box.replaceChildren(); return m.render(box, { get me() { return me; }, onRefresh: (fn) => refreshers.add(fn), on: (name, fn) => { const off = live.on(name, fn); panelOffs.add(off); return off; } }); })
    .catch(() => box.replaceChildren(h('p', { class: 'error' }, 'This building could not open.')));
  return h('div', { class: 'stack' }, h('p', {}, h('a', { href: '#', class: 'back' }, '← Back to town')), box);
}

window.addEventListener('hashchange', () => me?.user && show());    // the login view is never rebuilt under someone typing in it
live.sync();
