import { h, api, fmt, when, pillBar, confirmAction } from '/ui.js?v=__V__';
import { createClientSync } from '/sync.js?v=__V__';
import { startDaylight } from '/daylight.js?v=__V__';
import { menuOf, viewOf } from '/teach-menu.js?v=__V__';

startDaylight(document.querySelector('.scene'));

const root = document.getElementById('app');
let me = null;
let st = null;            // /api/teach/state
let audit = null;         // /api/teach/audit
let trouble = [];         // /api/teach/login-trouble
let blocked = [];         // the same reply: network addresses at the IP ceiling (world teacher only)
let log = null;           // { rows, next }: /api/teach/log, newest page plus any older pages. Reloaded after the teacher's own actions, not on live updates
let cards = null;         // [{ className, students: [{ username, pin }], printed }]: one batch per Generate or Reset PIN, appended, never replaced. PINs live only in this page, never on the server
const open = new Map();   // class id -> student list, for the classes that are expanded
let notice = '';
let inviteUrl = null;      // the invite link just made; the server keeps only its hash, so this page is the one place it is ever shown
let invite = new URLSearchParams(location.search).get('invite');   // /teach?invite=<token>: a second teacher joining

// Keeping `me` fresh (stream, refetch on open/reconnect, debounce, sequence numbers, login view when the session is gone) is sync.js.
// Here a refetch of /api/me is followed by a refetch of the console data and a redraw.
const live = createClientSync({
  fetchMe: () => api('/api/me'),
  async show(next) {                                      // the signed-in user changed (or first paint)
    if (next.preview) { await api('/api/preview/exit', {}).catch(() => {}); return location.reload(); }   // opening the console ends a "view as student" preview
    me = next;
    drawn = null;
    cards = null; st = null; log = null; inviteUrl = null;   // PINs, invite links and console data belong to the previous user
    panels.clear(); refreshers.clear();                   // another user may get other panels
    panelOffs.forEach((off) => off()); panelOffs.clear();
    document.querySelector('.pills')?.remove();
    document.body.append(pillBar(...(me.user ? [h('button', { class: 'pill', type: 'button', onclick: () => logout(false) }, 'Log out'),
      ...(me.user.role === 'teacher' ? [h('button', { class: 'pill', type: 'button', title: 'Use this on a shared computer: the next person is not treated as you', onclick: () => logout(true) }, 'Log out and forget this device'),
        h('button', { class: 'pill', type: 'button', title: 'Ends your sessions on every device; trusted devices are kept', onclick: () => logout(false, true) }, 'Log out everywhere')] : [])] : [])));
    if (me.user?.role === 'teacher') await refresh().catch(() => draw()); else draw();
  },
  async update(next) { me = next; await refresh().catch(() => {}); },
  offline(on) {                                           // the very first /api/me failed: say so; sync.js keeps retrying and calls show() when it works
    if (!on) return;
    drawn = null;
    root.replaceChildren(h('section', { class: 'glass panel' }, h('h1', { class: 'display' }, h('span', { class: 'wordmark' }, 'core')), h('p', { role: 'status' }, 'Can\'t reach core. Retrying…')));
  },
  eventNames: ['ledger', 'month', 'world', 'console'],
});

const unprinted = () => !!cards?.some((b) => !b.printed);
const unprintedWarning = 'There are PIN cards on screen that have not been printed. PINs can never be shown again once they are gone.';
window.addEventListener('beforeprint', () => cards?.forEach((b) => { b.printed = true; }));   // the cards print from any view (app.css shows #cards in print even when its view is hidden)
window.addEventListener('beforeunload', (e) => { if (unprinted()) e.preventDefault(); });

async function logout(forget = false, everywhere = false) {
  if (unprinted() && !confirmAction(`${unprintedWarning} Log out anyway?`)) return;
  await api('/api/logout', { forget, everywhere }).catch(() => {});
  cards = null; inviteUrl = null;
  live.sync();
}

// Refreshes never overlap: at most one runs and one more waits (a poke that lands mid-run makes the run go round once more, so the
// screen ends on data fetched after the poke). Pokes alone are also kept MIN_GAP_MS apart; the teacher's own actions (reloadLog) are not delayed.
const MIN_GAP_MS = 1000;
let running = null, again = false, wantLog = false, lastRun = 0;
function refresh(reloadLog = false) {
  wantLog ||= reloadLog;
  if (running) { again = true; return running; }
  running = (async () => {
    try {
      do {
        const wait = lastRun + MIN_GAP_MS - Date.now();
        if (wait > 0 && !wantLog) await new Promise((r) => setTimeout(r, wait));
        again = false;                                    // pokes that landed while waiting are covered by the fetch that follows
        const withLog = wantLog; wantLog = false;
        lastRun = Date.now();
        await loadConsole(withLog);
      } while (again);
    } finally { running = null; }
  })();
  return running;
}

async function loadConsole(reloadLog) {
  [st, audit, { trouble, blocked }] = await Promise.all([api('/api/teach/state'), api('/api/teach/audit'), api('/api/teach/login-trouble')]);   // audit: the stored result, cheap
  if (reloadLog || !log) { const r = await api('/api/teach/log'); log = { rows: r.log, next: r.next ?? null }; }
  const ids = [...open.keys()];
  (await Promise.all(ids.map((id) => api(`/api/teach/classes/${id}/students`)))).forEach((r, i) => open.set(ids[i], r.students));
  draw(!reloadLog);
  const kept = snapFields();
  await Promise.allSettled([...refreshers].filter(([, box]) => !box.hidden).map(([fn]) => fn()));   // the module panel on screen refreshes its own live parts; a hidden one catches up when it is opened (hashchange below)
  restoreFields(kept);
}

// A module panel redraws its own parts when its data lands, which can detach the field the teacher is typing in. Before the
// panels refresh, note every focused or edited field (panel + tag + name/label/placeholder as its key); afterwards put the text,
// the focus and the caret back into the same element, or into its rebuilt successor.
const fieldKey = (box, el) => [box.dataset.panel, el.tagName, el.type, el.name || el.getAttribute('aria-label') || el.placeholder || [...box.querySelectorAll(el.tagName)].indexOf(el)].join('|');
function snapFields() {
  const out = [];
  for (const box of panels.values()) for (const el of box.querySelectorAll('input, select, textarea')) {
    if (el.type === 'password') continue;                 // never carry a secret
    const focus = el === document.activeElement;
    if (focus || (el.type !== 'checkbox' && el.type !== 'radio' && el.value !== el.defaultValue)) out.push({ el, box, key: fieldKey(box, el), focus, dirty: el.value !== el.defaultValue });
  }
  return out;
}
function restoreFields(snap) {
  for (const f of snap) {
    let el = f.el;
    if (!el.isConnected) el = [...f.box.querySelectorAll(f.el.tagName)].find((x) => fieldKey(f.box, x) === f.key);   // rebuilt: find its successor
    if (!el) continue;
    if (el !== f.el && f.dirty && el.value === el.defaultValue && el.defaultValue === f.el.defaultValue) el.value = f.el.value;   // a detached input keeps what was typed
    if (f.focus && (!document.activeElement || document.activeElement === document.body)) {   // focus was lost in the redraw (not moved on purpose)
      el.focus({ preventScroll: true });
      try { el.setSelectionRange(f.el.selectionStart, f.el.selectionEnd); } catch { /* select and number inputs have no caret */ }
    }
  }
}

// Runs an action, reports errors in the notice line, and redraws. `ask` is an optional confirm text for irreversible actions.
// One action at a time: the clicked button is disabled and further clicks are ignored until the request and redraw finish (a
// redraw mid-flight rebuilds the buttons, so the flag, not the disabled state, is what stops a double-click).
let busy = false;
const act = (fn, ask) => async (e) => {
  if (busy || (ask && !confirmAction(ask))) return false;            // false: nothing was sent
  busy = true;
  const btn = e?.currentTarget;
  if (btn) btn.disabled = true;
  try { notice = ''; await fn(); } catch (ex) { notice = ex.message; }
  try { await refresh(true).catch(() => draw()); } finally { busy = false; if (btn) btn.disabled = false; }
};

// Typed-but-unsent input survives a redraw: every core input carries data-keep="<stable key>"; before the tree is rebuilt the
// values that differ from their defaults (and the focused field with its caret) are noted, and put back into the new inputs.
function noteInputs() {
  const kept = new Map();
  for (const el of root.querySelectorAll('[data-keep]')) {
    if (el.type === 'password') continue;                 // never carry a secret across a redraw
    if (el.value !== el.defaultValue || el.tagName === 'SELECT') kept.set(el.dataset.keep, el.value);
  }
  const f = document.activeElement;
  return { kept, focus: root.contains(f) && f.dataset.keep ? { key: f.dataset.keep, from: f.selectionStart, to: f.selectionEnd } : null };
}
function restoreInputs({ kept, focus }) {
  for (const el of root.querySelectorAll('[data-keep]')) {
    if (!kept.has(el.dataset.keep)) continue;
    el.value = kept.get(el.dataset.keep);
    el.dispatchEvent(new Event('input'));                 // lets a field that gates a button (the season confirm) re-check
  }
  const el = focus && root.querySelector(`[data-keep="${focus.key}"]`);
  if (!el) return;
  el.focus();
  try { el.setSelectionRange(focus.from, focus.to); } catch { /* number and select inputs have no caret */ }
}

// The page is built fresh, compared with what is already on screen, and only touched when it differs (module panels count by name: their
// own element is kept). Changed parts are swapped in place: a module panel is never detached, so focus inside it survives.
// `soft` (a live refresh, not the teacher's own action) waits while the pointer is over a core table, so rows do not move under it.
let drawn = null, deferred = false;
function draw(soft = false) {
  if (!soft) deferred = false;                            // a full draw replaces whatever was being held back
  const typed = noteInputs();
  const out = [];                                          // not a DocumentFragment: appending a module panel to one would detach it from the page
  out.append = (...kids) => out.push(...kids);
  const put = () => {
    const nodes = out;
    const sig = nodes.map((n) => (n.dataset.panel ? `#${n.dataset.panel}` : n.outerHTML)).join('\n');
    if (sig === drawn) return;
    if (soft && root.querySelector('section:not([data-panel]) .table-wrap:hover')) {
      deferred = true;                                    // redrawn when the pointer leaves the table (listener below) or by the next full draw
      return;
    }
    drawn = sig;
    const keep = new Set(nodes);
    for (const c of [...root.children]) if (!keep.has(c)) c.remove();
    nodes.forEach((n, i) => { if (root.children[i] !== n) root.insertBefore(n, root.children[i] ?? null); });
    restoreInputs(typed);
  };
  if (!me.user) { out.append(me.needsSetup ? setupView() : invite ? joinView() : loginView()); return put(); }
  if (me.user.role !== 'teacher') { out.append(h('section', { class: 'glass panel' }, h('h1', { class: 'display' }, 'Teachers only'), h('a', { href: '/' }, 'Back to the student app'))); return put(); }
  if (!st) { out.append(h('section', { class: 'glass panel' }, h('p', { class: 'error', role: 'alert' }, notice || 'The console could not load. It will retry on the next update, or reload the page.'))); return put(); }
  // One view at a time (public/teach-menu.js). Every core view is built and stays in the page, hidden unless it is the chosen one, so
  // typed text survives a change of view and the PIN cards can print from anywhere. A module panel is loaded the first time its view
  // is opened and is kept, hidden, from then on.
  const menu = menuOf(me.teacherPanels), view = viewOf(location.hash, menu);
  const core = {
    dashboard: dashboardPanels(), classes: [classesPanel(), cards ? cardsPanel() : null], logins: [troublePanel()],
    world: [worldPanel(), problemsPanel(), seasonPanel()], audit: [auditPanel()], log: [logPanel()], account: [teachersPanel(), accountPanel()],
  };
  const shown = (id, nodes) => nodes.filter(Boolean).map((n) => { n.hidden = id !== view; return n; });
  out.append(
    h('header', {}, h('p', { class: 'label' }, 'Teacher console'), h('h1', { class: 'display' }, h('span', { class: 'wordmark' }, 'core'))),
    viewAsStudent(),
    menuNav(menu, view),
    ...[notice ? h('p', { class: 'error', role: 'alert' }, notice) : null].filter(Boolean),
    ...Object.entries(core).flatMap(([id, nodes]) => shown(id, nodes)),
    ...me.teacherPanels.flatMap((p) => { const id = `${p.module}/${p.id}`; return id === view || panels.has(id) ? shown(id, [modulePanel(p)]) : []; }));
  const railTop = root.querySelector(':scope > .menu')?.scrollTop ?? 0;
  put();
  const rail = root.querySelector(':scope > .menu');
  if (rail) rail.scrollTop = railTop;                     // a menu that did change (a new count, another view) keeps its place
}

// "View as student": one button per course; the student app then shows what that course's student sees (lib/preview.js, a sandbox).
function viewAsStudent() {
  return h('div', { class: 'preview-picks' }, h('span', { class: 'muted small' }, 'Preview as a student:'),
    ...st.courses.map((c) => h('button', { type: 'button', class: 'ghost', onclick: async () => {
      try { await api('/api/preview/start', { course: c.id }); location.href = '/'; } catch (e) { notice = e.message; draw(); }
    } }, `View as ${c.label} student`)));
}

// The menu: a rail of links on a wide screen and one select on a narrow one (app.css shows one or the other). A link is a plain
// "#/<view>" hash, so Back, reload and bookmarks work. A count beside a link says something there wants attention.
const openGroups = new Set();   // the folded groups the teacher has opened; kept across redraws
function menuNav(menu, view) {
  const flags = { classes: unprinted() ? 'Print' : 0, logins: trouble.length + blocked.length, world: st.problems ? st.problems.failures.length + (st.problems.auto_stopped ? 1 : 0) : 0, audit: audit.ok ? 0 : '!' };
  const link = (i) => h('a', { href: `#/${i.id}`, 'aria-current': i.id === view ? 'page' : null }, i.title, flags[i.id] ? h('span', { class: 'chip' }, String(flags[i.id])) : null);
  const rail = menu.map((g) => {
    if (!g.fold) return h('div', {}, g.group ? h('p', { class: 'menu-head' }, g.group) : null, g.items.map(link));
    const box = h('details', { ontoggle: () => { if (box.open) openGroups.add(g.group); else openGroups.delete(g.group); } }, h('summary', {}, g.group, h('span', { class: 'muted' }, String(g.items.length))), g.items.map(link));
    box.open = openGroups.has(g.group) || g.items.some((i) => i.id === view);
    return box;
  });
  const pick = h('select', { 'aria-label': 'Console section', onchange: (e) => { location.hash = `#/${e.currentTarget.value}`; } }, menu.map((g) => {
    const opts = g.items.map((i) => h('option', { value: i.id, selected: i.id === view }, i.title));
    return g.group ? h('optgroup', { label: g.group }, opts) : opts;
  }));
  const fresh = h('nav', { class: 'menu glass', 'aria-label': 'Teacher console sections' }, h('label', { class: 'menu-pick' }, 'Go to', pick), h('div', { class: 'menu-rail' }, rail));
  // The menu on screen is kept while a fresh one would read the same: a live refresh swaps every other core part, and swapping the
  // menu too would drop its focus, close an open select and scroll the rail back to the top under the teacher.
  const now = root.querySelector(':scope > .menu');
  return now && now.outerHTML === fresh.outerHTML ? now : fresh;
}
window.addEventListener('hashchange', () => {
  if (me?.user?.role !== 'teacher' || !st) return;         // the sign-in views have no menu
  draw();
  window.scrollTo(0, 0);
  [...root.querySelectorAll('.menu [aria-current], .menu select')].find((el) => el.offsetParent)?.focus({ preventScroll: true });   // the menu was rebuilt: put focus back on the chosen item
  refresh().catch(() => {});                              // a module panel that was hidden catches up
});

// The first screen: what the console already knows, at a glance, with a link to the view that deals with each thing. No request of its own.
function dashboardPanels() {
  const w = st.world, p = st.problems;
  const n = (count, one, many = `${one}s`) => `${count} ${count === 1 ? one : many}`;
  const locked = trouble.filter((t) => t.locked).length;
  const todo = [
    p?.auto_stopped && ['world', 'Auto-advance has stopped'],
    p?.failures.length && ['world', `${n(p.failures.length, 'problem')} in recent advances`],
    w.status === 'closed' && ['world', me.user.world_teacher ? `${w.name} is closed. Start the next season when you are ready.` : `${w.name} is closed`],
    !st.classes.length && ['classes', 'No classes yet. Create your first class.'],
    unprinted() && ['classes', 'PIN cards are waiting to be printed'],
    trouble.length && ['logins', `${n(trouble.length, 'student')} with login trouble${locked ? ` (${locked} locked)` : ''}`],
    blocked.length && ['logins', `${n(blocked.length, 'network address', 'network addresses')} blocked`],
    !audit.ok && ['audit', 'The ledger audit failed'],
  ].filter(Boolean);
  const recent = (log?.rows ?? []).slice(0, 5);
  return [
    h('section', { class: 'glass panel' },
      h('h2', {}, 'Dashboard'),
      h('div', { class: 'stats' },
        h('div', { class: 'stat' }, h('span', { class: 'label' }, 'Season'), h('b', {}, w.name), h('span', { class: 'small muted' }, `${w.season_start} to ${w.season_end}`)),
        stat('World month', String(w.month)),
        stat('Classes', String(st.classes.length)),
        stat('Students', String(st.classes.reduce((sum, c) => sum + c.students, 0))),
        h('div', { class: 'stat' }, h('span', { class: 'label' }, 'Ledger audit'), h('b', { class: audit.ok ? '' : 'error' }, audit.ok ? 'OK' : 'Failed'), h('span', { class: 'small muted' }, `Checked ${ago(audit.at)}`)))),
    h('section', { class: 'glass panel' },
      h('h2', {}, 'Needs attention'),
      todo.length ? h('ul', { class: 'todo' }, todo.map(([id, text]) => h('li', {}, h('a', { href: `#/${id}` }, text)))) : h('p', { class: 'muted' }, 'Nothing needs your attention.')),
    h('section', { class: 'glass panel' },
      h('div', { class: 'spread' }, h('h2', {}, 'Classes'), h('a', { href: '#/classes' }, 'Manage classes')),
      st.classes.length ? h('div', { class: 'table-wrap' }, h('table', {},
        h('thead', {}, h('tr', {}, h('th', {}, 'Class'), h('th', {}, 'Course'), h('th', { class: 'num' }, 'Students'))),
        h('tbody', {}, st.classes.map((c) => h('tr', {}, h('td', {}, c.name), h('td', {}, st.courses.find((x) => x.id === c.course_id)?.label || c.course_id), h('td', { class: 'num' }, String(c.students)))))))
        : h('p', { class: 'muted' }, 'No classes yet.')),
    h('section', { class: 'glass panel' },
      h('div', { class: 'spread' }, h('h2', {}, 'Recent activity'), h('a', { href: '#/log' }, 'Full activity log')),
      recent.length ? h('div', { class: 'table-wrap' }, h('table', {},
        h('thead', {}, h('tr', {}, h('th', {}, 'When'), h('th', {}, 'Who'), h('th', {}, 'Action'))),
        h('tbody', {}, recent.map((r) => h('tr', {}, h('td', {}, when(r.at)), h('td', {}, r.actor_name || r.actor), h('td', {}, r.action))))))
        : h('p', { class: 'muted' }, 'Nothing logged yet.')),
  ];
}

// A module's teacher panel is an ES module from modules/<id>/ui that exports render(el, { me, onRefresh, on(eventName, fn) }), like a student panel.
// Each panel's box is created and rendered once; later draws re-attach the same element, so its own state and typed input stay.
const panels = new Map();   // panel id -> its box
const refreshers = new Map();   // a panel's refresh function -> its box
const panelOffs = new Set();   // unsubscribe functions of the panels' on() listeners; cleared with the panels when the user changes
function modulePanel(p) {
  const key = `${p.module}/${p.id}`;
  let box = panels.get(key);
  if (!box) {
    box = h('section', { class: 'glass panel', 'data-panel': key }, h('p', { class: 'muted' }, 'Loading...'));
    panels.set(key, box);
    import(p.src).then((m) => { box.replaceChildren(); return m.render(box, { get me() { return me; }, onRefresh: (fn) => refreshers.set(fn, box), on: (name, fn) => { const off = live.on(name, fn); panelOffs.add(off); return off; } }); })
      .catch(() => box.replaceChildren(h('p', { class: 'error' }, `The ${p.title} panel could not load.`)));
  }
  return box;
}

function authForm({ title, intro, fields, button, onSubmit }) {
  const err = h('p', { class: 'error', role: 'alert' });
  const form = h('form', { class: 'glass panel', onsubmit: async (e) => {
    e.preventDefault();
    err.textContent = '';
    try { await onSubmit(form); await live.sync(); } catch (ex) { err.textContent = ex.message; }
  } }, h('h1', { class: 'display' }, title), h('p', { class: 'muted' }, intro), ...fields, h('button', { type: 'submit' }, button), err);
  return form;
}
const field = (label, name, attrs = {}) => h('label', {}, label, h('input', { name, 'data-keep': name, required: true, autocapitalize: 'none', spellcheck: 'false', ...attrs }));

function setupView() {
  return authForm({
    title: 'First-time setup',
    intro: 'Create the teacher account. Choose a username that is not your real name; no names or emails are stored anywhere in core.',
    fields: [field('Username', 'username', { autocomplete: 'username' }), field('Passphrase (12+ characters)', 'passphrase', { type: 'password', minlength: '12', autocomplete: 'new-password' }),
      me.setupTokenRequired ? field('Setup token', 'token', { type: 'password' }) : null],
    button: 'Create teacher account',
    onSubmit: (f) => api('/api/setup', { username: f.username.value.trim(), passphrase: f.passphrase.value, token: f.token?.value }),
  });
}

function loginView() {
  return authForm({
    title: 'Teacher login', intro: 'Sign in to manage classes and the world clock.',
    fields: [field('Username', 'username', { autocomplete: 'username' }), field('Passphrase', 'passphrase', { type: 'password', autocomplete: 'current-password' })],
    button: 'Log in',
    onSubmit: (f) => api('/api/login', { username: f.username.value.trim(), secret: f.passphrase.value }),
  });
}

// A second teacher arrives here from the link the world teacher made. Same rules as setup: a pseudonym and a 12+ character passphrase.
function joinView() {
  return authForm({
    title: 'Join as a teacher',
    intro: 'You were invited to teach in this copy of core. Choose a username that is not your real name; no names or emails are stored anywhere in core. You will see and manage only your own classes.',
    fields: [field('Username', 'username', { autocomplete: 'username' }), field('Passphrase (12+ characters)', 'passphrase', { type: 'password', minlength: '12', autocomplete: 'new-password' }),
      field('Passphrase again', 'again', { type: 'password', minlength: '12', autocomplete: 'new-password' })],
    button: 'Create my teacher account',
    onSubmit: async (f) => {
      if (f.passphrase.value !== f.again.value) throw new Error('The two passphrases do not match.');
      await api('/api/teach/join', { token: invite, username: f.username.value.trim(), passphrase: f.passphrase.value });
      invite = null;                                      // spent: a later logout on this page shows the login form, not the join form
      history.replaceState(null, '', '/teach');           // and keep the link out of the address bar and history
    },
  });
}

function worldPanel() {
  const w = st.world;
  if (!me.user.world_teacher) {                           // only the world teacher moves the clock; everyone else just reads it
    return h('section', { class: 'glass panel' },
      h('h2', {}, 'World clock'),
      h('div', { class: 'stats' },
        h('div', { class: 'stat' }, h('span', { class: 'label' }, 'Season'), h('b', {}, w.name), h('span', { class: 'small muted' }, `${w.season_start} to ${w.season_end}`)),
        h('div', { class: 'stat' }, h('span', { class: 'label' }, 'World month'), h('b', {}, String(w.month)))),
      h('p', { class: 'muted small' }, w.status === 'closed' ? 'This season is closed. The world teacher will start the next one.' : 'The world teacher advances the clock and closes seasons.'));
  }
  const mpd = h('input', { 'data-keep': 'months-per-day', type: 'number', min: '1', max: '12', value: String(w.months_per_day) });
  return h('section', { class: 'glass panel' },
    h('h2', {}, 'World clock'),
    h('div', { class: 'stats' },
      h('div', { class: 'stat' }, h('span', { class: 'label' }, 'Season'), h('b', {}, w.name), h('span', { class: 'small muted' }, `${w.season_start} to ${w.season_end}`)),
      h('div', { class: 'stat' }, h('span', { class: 'label' }, 'World month'), h('b', {}, String(w.month)))),
    h('div', { class: 'row' },
      h('label', {}, 'Months per class day', mpd),
      h('button', { class: 'ghost', type: 'button', onclick: act(() => api('/api/teach/world/settings', { months_per_day: Number(mpd.value) })) }, 'Save'),
      h('button', { type: 'button', disabled: w.status === 'closed', onclick: act(() => api('/api/teach/world/advance', { from: w.month }), `Advance ${w.months_per_day} month${w.months_per_day === 1 ? '' : 's'}? Payday and bills run for every class.`) }, w.months_per_day === 1 ? 'Advance month' : `Advance ${w.months_per_day} months`)),
    h('label', { class: 'row small' },
      h('input', { type: 'checkbox', checked: w.auto_advance === 'school_days', onchange: async (e) => { const box = e.currentTarget; let ok = false; await act(async () => { await api('/api/teach/world/settings', { auto_advance: box.checked ? 'school_days' : 'manual' }); ok = true; })(); if (!ok) box.checked = !box.checked; } }),
      'Advance automatically each school day after 7:00 (Mon to Fri, Edmonton time)'),
    calendarRow(w));
}

// No-school days (one date or "from to to" range per line) that auto-advance skips, and the season_end stop. World teacher only.
let calendarOpen = false;                                 // survives redraws, like data-keep does for typed text
function calendarRow(w) {
  const days = h('textarea', { 'data-keep': 'no-school', rows: 4, 'aria-label': 'No-school days, one per line', placeholder: '2027-02-15\n2027-03-29 to 2027-04-02' });
  days.value = days.defaultValue = (w.no_school ?? []).join('\n');
  const box = h('details', { class: 'small', ontoggle: () => { calendarOpen = box.open; } },
    h('summary', {}, `No-school days (${(w.no_school ?? []).length}) and season end`),
    h('p', { class: 'muted small' }, w.season_over && w.auto_advance === 'school_days'
      ? `The season reached its end date (${w.season_end}): auto-advance has stopped. You can still advance by hand.`
      : `Auto-advance skips these days and stops on ${w.season_end}, the season's end date. You can always advance by hand.`),
    days,
    h('button', { class: 'ghost', type: 'button', onclick: act(() => api('/api/teach/world/settings', { no_school: days.value.split('\n').map((l) => l.trim()).filter(Boolean) })) }, 'Save no-school days'));
  box.open = calendarOpen;
  return box;
}

// World teacher only, and only when there is something to show: why auto-advance stopped, and the students an advance skipped in one
// module (that part of their month did not happen; the rest of the advance did), or a listener that failed during a student's own
// action. /api/teach/state's problems.
function problemsPanel() {
  const p = st.problems;
  if (!p || (!p.auto_stopped && !p.failures.length)) return null;
  return h('section', { class: 'glass panel' },
    h('h2', {}, 'Problems in recent advances'),
    p.auto_stopped ? h('div', {},
      h('p', { class: 'error', role: 'alert' }, `Auto-advance stopped: ${p.auto_stopped}`),
      h('p', { class: 'muted small' }, 'It will not try again until you advance by hand or resume it.'),
      h('button', { class: 'ghost', type: 'button', onclick: act(() => api('/api/teach/world/settings', { auto_advance: st.world.auto_advance })) }, 'Resume auto-advance')) : null,   // re-saves the current setting
    p.failures.length ? h('div', { class: 'table-wrap' }, h('table', {},
      h('thead', {}, h('tr', {}, h('th', {}, 'Module'), h('th', {}, 'Student'), h('th', { class: 'num' }, 'Month'), h('th', {}, 'When'), h('th', {}, 'Error'))),
      h('tbody', {}, p.failures.map((f) => h('tr', {}, h('td', {}, f.module), h('td', {}, f.username ?? '-'), h('td', { class: 'num' }, String(f.month)),
        h('td', {}, f.source === 'request' ? "During a student's action" : 'Skipped in the advance'), h('td', { class: 'small' }, f.error)))))) : null,
    p.failures.length ? h('p', { class: 'muted small' }, 'A row skipped in the advance is one student skipped by one module in one month (for example, no bills issued that month); everyone else, and every other module, went ahead. That student\'s month is only partly consistent across modules (if jobs failed, bills still billed them; if bills failed, insurance still recorded a premium with no bill line) and nothing is reconciled, so check that student.') : null);
}

// World teacher only. Closing zeroes every balance (each student's net worth is kept), so it asks for the season's name first.
function seasonPanel() {
  if (!me.user.world_teacher) return null;
  const w = st.world;
  if (w.status === 'closed') {
    const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Edmonton' });
    const end = new Date(Date.parse(`${today}T12:00:00Z`) + 150 * 864e5).toISOString().slice(0, 10);
    const name = h('input', { 'data-keep': 'season-name', placeholder: 'Season 2', maxlength: '60' });
    const start = h('input', { 'data-keep': 'season-start', type: 'date', value: today });
    const stop = h('input', { 'data-keep': 'season-end', type: 'date', value: end });
    return h('section', { class: 'glass panel' },
      h('h2', {}, 'Season'),
      h('p', {}, `${w.name} is closed. Every balance is zero; students keep their username, PIN and class.`),
      h('div', { class: 'row' },
        h('label', { class: 'grow' }, 'New season name', name), h('label', {}, 'Starts', start), h('label', {}, 'Ends', stop),
        h('button', { type: 'button', onclick: act(() => api('/api/teach/world/create', { name: name.value.trim() || 'Season', season_start: start.value, season_end: stop.value })) }, 'Start new season')),
      h('p', { class: 'muted small' }, 'Each returning student gets a new welcome grant the next time they log in.'));
  }
  const typed = h('input', { 'data-keep': 'season-confirm', autocomplete: 'off', placeholder: w.name });
  const go = h('button', { class: 'danger', type: 'button', disabled: true, onclick: act(() => api('/api/teach/world/close', {})) }, 'Close season');
  typed.oninput = () => { go.disabled = typed.value.trim() !== w.name; };
  go.disabled = typed.value.trim() !== w.name;
  return h('section', { class: 'glass panel' },
    h('h2', {}, 'Season'),
    h('p', {}, `${w.name}: ${w.season_start} to ${w.season_end}.`),
    h('p', { class: 'muted small' }, 'Closing the season sets every student balance to zero (each student\'s net worth is saved first) and stops the world clock. Students keep their username, PIN and class. It cannot be undone.'),
    h('div', { class: 'row' }, h('label', { class: 'grow' }, `To confirm, type the season name (${w.name})`, typed), go));
}

// World teacher only: a single-use link (7 days) that lets another teacher create an account. They manage only their own classes.
function teachersPanel() {
  if (!me.user.world_teacher) return null;
  const url = inviteUrl && h('input', { readonly: true, value: inviteUrl, 'aria-label': 'Invite link', onfocus: (e) => e.currentTarget.select() });
  return h('section', { class: 'glass panel' },
    h('h2', {}, 'Teachers'),
    h('p', { class: 'muted small' }, 'Invite another teacher with a link. It works once and expires in 7 days. They see and manage only their own classes; you keep the world clock.'),
    h('div', { class: 'row' }, h('button', { type: 'button', onclick: act(async () => { inviteUrl = (await api('/api/teach/invites', {})).url; }) }, 'Create invite link')),
    inviteUrl ? h('div', { class: 'stack' },
      h('p', { class: 'small' }, 'Copy this link now. It is shown only this once.'),
      h('div', { class: 'row' }, h('label', { class: 'grow' }, 'Invite link', url),
        h('button', { class: 'ghost', type: 'button', onclick: async (e) => { try { await navigator.clipboard.writeText(inviteUrl); e.currentTarget.textContent = 'Copied'; } catch { url.select(); } } }, 'Copy'),
        h('button', { class: 'ghost', type: 'button', onclick: () => { inviteUrl = null; draw(); } }, 'Hide'))) : null);
}

function classesPanel() {
  const name = h('input', { 'data-keep': 'class-name', placeholder: 'Block 3', maxlength: '40' });
  const course = h('select', { 'data-keep': 'class-course' }, st.courses.map((c) => h('option', { value: c.id }, c.label)));
  return h('section', { class: 'glass panel' },
    h('h2', {}, 'Classes'),
    h('div', { class: 'row' },
      h('label', { class: 'grow' }, 'Block name', name),
      h('label', { class: 'grow' }, 'Course', course),
      h('button', { type: 'button', onclick: act(async () => { await api('/api/teach/classes', { name: name.value, course: course.value }); }) }, 'Create class')),
    st.classes.length ? st.classes.map(classCard) : h('p', { class: 'muted' }, 'No classes yet.'));
}

const picked = new Map();   // class id -> Set of ticked student ids (kept across redraws; cleared when the list is closed or reloaded)
const pickedOf = (id) => { if (!picked.has(id)) picked.set(id, new Set()); return picked.get(id); };
const reload = async (id) => { picked.delete(id); open.set(id, (await api(`/api/teach/classes/${id}/students`)).students); };
const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;

function classCard(c) {
  const count = h('input', { 'data-keep': `count-${c.id}`, type: 'number', min: '1', max: '60', value: '30' });
  const students = open.get(c.id);
  const label = st.courses.find((x) => x.id === c.course_id)?.label || c.course_id;
  const sel = pickedOf(c.id);
  const ids = [...sel];
  const noneTicked = () => { if (sel.size) return false; notice = 'Tick at least one student first.'; draw(); return true; };
  const toggle = (list, on) => { list.forEach((s) => (on ? sel.add(s.id) : sel.delete(s.id))); draw(); };
  // Students created in the same minute are one batch (one Generate click).
  const batches = new Map();
  for (const s of students || []) { const k = Math.floor((s.created || 0) / 60000); batches.set(k, [...(batches.get(k) || []), s]); }
  const never = (students || []).filter((s) => !s.active);
  return h('div', { class: 'class-card' },
    h('div', { class: 'spread' }, h('strong', {}, `${c.name} · ${label}`), h('span', { class: 'chip' }, `${c.students} students`)),
    h('div', { class: 'row' },
      h('label', {}, 'How many new students', count),
      h('button', { type: 'button', onclick: (e) => act(async () => { cards = [...(cards || []), await api(`/api/teach/classes/${c.id}/students`, { count: Number(count.value) })]; open.set(c.id, null); },
        c.students ? `This class already has ${plural(c.students, 'student')}. Add ${Number(count.value)} more new students?` : '')(e) }, 'Generate accounts and PIN cards'),
      h('button', { class: 'ghost', type: 'button', onclick: act(async () => { if (open.has(c.id)) { open.delete(c.id); picked.delete(c.id); } else await reload(c.id); }) }, students ? 'Hide students' : 'Show students'),
      h('button', { class: 'ghost', type: 'button', onclick: act(async () => { const n = prompt(`New name for ${c.name}`, c.name)?.trim(); if (n && n !== c.name) await api(`/api/teach/classes/${c.id}/rename`, { name: n }); }) }, 'Rename'),
      h('button', { class: 'ghost', type: 'button', onclick: act(async () => {
        const list = (await api(`/api/teach/classes/${c.id}/students`)).students;
        const live = list.filter((s) => s.active).length;
        const typed = prompt(`${c.name} has ${plural(list.length, 'student')}, ${live} of them active. A class with active students can't be deleted. Deleting closes every account and PIN card, and can't be undone.\n\nType the class name to delete it:`);
        if (typed === null) return;
        await api(`/api/teach/classes/${c.id}/delete`, { confirm: typed });
        open.delete(c.id); picked.delete(c.id);
      }) }, 'Delete class')),
    students ? h('div', { class: 'stack' },
      h('div', { class: 'row' },
        h('button', { class: 'ghost', type: 'button', onclick: () => toggle(never, never.some((s) => !sel.has(s.id))) }, 'Select all never logged in'),
        batches.size > 1 ? h('span', { class: 'small muted' }, 'Select by batch:') : null,
        batches.size > 1 ? [...batches.entries()].map(([k, list]) => h('label', { class: 'small' },
          h('input', { type: 'checkbox', checked: list.every((s) => sel.has(s.id)), onchange: (e) => toggle(list, e.currentTarget.checked) }),
          ` ${when(k * 60000)} (${list.length})`)) : null),
      h('div', { class: 'row' },
        h('button', { type: 'button', onclick: (e) => noneTicked() || act(async () => { await api(`/api/teach/classes/${c.id}/remove-students`, { ids }); await reload(c.id); },
          `Remove ${plural(ids.length, 'student')}? Their accounts are closed, their in-game money goes back to the bank, and their PIN cards stop working. This can't be undone.`)(e) }, 'Remove selected'),
        h('button', { class: 'ghost', type: 'button', onclick: (e) => noneTicked() || act(async () => {
          const r = await api(`/api/teach/classes/${c.id}/reset-pins`, { ids });
          cards = [...(cards || []), { className: c.name, students: r.cards.map(({ username, pin }) => ({ username, pin })) }];
        }, `Reissue PIN cards for ${plural(ids.length, 'student')}? Their old cards stop working.`)(e) }, 'Reissue PIN cards for selected'),
        h('span', { class: 'small muted' }, `${sel.size} selected`)),
      h('div', { class: 'table-wrap' }, h('table', {},
        h('thead', {}, h('tr', {}, h('th', {}, ''), h('th', {}, 'Username'), h('th', {}, 'Status'), h('th', {}, 'Created'), h('th', { class: 'num' }, 'Balance'), h('th', {}, ''))),
        h('tbody', {}, students.map((s) => h('tr', {},
          h('td', {}, h('input', { type: 'checkbox', 'aria-label': `Select ${s.username}`, checked: sel.has(s.id), onchange: (e) => { if (e.currentTarget.checked) sel.add(s.id); else sel.delete(s.id); draw(); } })),
          h('td', {}, s.username), h('td', {}, s.active ? 'Active' : 'Never logged in'), h('td', {}, s.created ? when(s.created) : ''), h('td', { class: 'num' }, fmt(s.balance_cents)),
          h('td', { class: 'row' },
            s.locked ? h('button', { class: 'ghost', type: 'button', onclick: act(() => api(`/api/teach/players/${s.id}/unlock`, {})) }, 'Unlock login') : null,
            h('button', { class: 'ghost', type: 'button', onclick: act(async () => { cards = [...(cards || []), await api(`/api/teach/players/${s.id}/reset-pin`, {})]; }, `Reset the PIN for ${s.username}? Their old PIN stops working.`) }, 'Reset PIN')))))))) : null);
}

// Eight cards per sheet; the print rules in app.css lay each sheet out as one Letter page.
function cardsPanel() {
  const sheets = [];
  for (const b of cards) for (let i = 0; i < b.students.length; i += 8) {
    sheets.push(h('div', { class: 'sheet' }, b.students.slice(i, i + 8).map((s) => h('div', { class: 'card' },
      h('div', { class: 'brand' }, `core · ${b.className}`),
      h('div', { class: 'small' }, 'Username'), h('div', { class: 'who' }, s.username),
      h('div', { class: 'small' }, 'PIN'), h('div', { class: 'pin' }, s.pin),
      h('div', { class: 'where' }, location.origin)))));
  }
  return h('section', { class: 'glass panel', id: 'cards' },
    h('div', { class: 'spread noprint' },
      h('h2', {}, 'PIN cards'),
      h('div', { class: 'row' },
        h('button', { type: 'button', onclick: () => window.print() }, 'Print cards'),
        h('button', { class: 'ghost', type: 'button', onclick: () => { if (unprinted() && !confirmAction(`${unprintedWarning} Clear them anyway?`)) return; cards = null; draw(); } }, 'Clear from screen'))),
    h('p', { class: 'muted small noprint' }, 'PINs are stored hashed, so this is the only time they can be shown. Print them now (new batches are added below, nothing here is replaced). To issue a new PIN later, use Reset PIN.'),
    sheets);
}

// "2 minutes ago", for the stored audit. Redrawn with every refresh; the stored result itself is only replaced by the button or the nightly run.
function ago(ms) {
  const m = Math.floor((Date.now() - ms) / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m} minute${m === 1 ? '' : 's'} ago`;
  const hrs = Math.floor(m / 60);
  return hrs < 48 ? `${hrs} hour${hrs === 1 ? '' : 's'} ago` : `${Math.floor(hrs / 24)} days ago`;
}

function auditPanel() {
  const ok = audit.ok;
  return h('section', { class: 'glass panel' },
    h('div', { class: 'spread' }, h('h2', {}, 'Ledger audit'), h('span', { class: `badge ${ok ? 'ok' : 'error'}` }, ok ? 'Audit OK' : 'Audit FAILED')),
    h('p', { class: 'muted small' }, `Checked ${ago(audit.at)}. The ledger is checked every night, and whenever you press the button.`),
    h('div', { class: 'stats' },
      stat('Money supply', fmt(audit.moneySupply)),
      stat('In circulation', fmt(audit.circulating)),
      stat('Collected by sinks', fmt(audit.sink)),
      stat('Accounts', String(audit.accounts)),
      stat('Ledger entries', String(audit.entries))),
    audit.problems.length ? h('ul', { class: 'error' }, audit.problems.map((p) => h('li', {}, JSON.stringify(p)))) : null,
    h('div', { class: 'row' }, h('button', { class: 'ghost', type: 'button', onclick: act(async () => { audit = await api('/api/teach/audit/run', {}); }) }, 'Run audit now')));
}
// What teachers did (and what students did with money), newest first. The world teacher sees all of it; other teachers see rows about their own classes.
function logPanel() {
  const detail = (d) => Object.entries(d).map(([k, v]) => `${k}: ${typeof v === 'object' ? JSON.stringify(v) : v}`).join(', ');
  return h('section', { class: 'glass panel' },
    h('div', { class: 'spread' }, h('h2', {}, 'Activity log'), h('button', { class: 'ghost', type: 'button', onclick: act(async () => {}) }, 'Refresh')),
    log.rows.length
      ? h('div', { class: 'table-wrap' }, h('table', {},
        h('thead', {}, h('tr', {}, h('th', {}, 'When'), h('th', {}, 'Who'), h('th', {}, 'Action'), h('th', {}, 'Details'))),
        h('tbody', {}, log.rows.map((r) => h('tr', {}, h('td', {}, when(r.at)), h('td', {}, r.actor_name || r.actor), h('td', {}, r.action), h('td', { class: 'small muted' }, detail(r.detail)))))))
      : h('p', { class: 'muted' }, 'Nothing logged yet.'),
    log.next ? h('div', { class: 'row' }, h('button', { class: 'ghost', type: 'button', onclick: async () => {
      try { const r = await api(`/api/teach/log?before=${log.next}`); log.rows.push(...r.log); log.next = r.next ?? null; } catch (e) { notice = e.message; }
      draw();
    } }, 'Older')) : null);
}

// Students with several recent wrong tries: a forgotten PIN, or someone guessing. Unlock clears all their counters.
function troublePanel() {
  return h('section', { class: 'glass panel' },
    h('h2', {}, 'Login trouble'),
    trouble.length
      ? h('div', { class: 'table-wrap' }, h('table', {},
        h('thead', {}, h('tr', {}, h('th', {}, 'Username'), h('th', { class: 'num' }, 'Wrong tries (last hour)'), h('th', {}, 'Last try'), h('th', {}, ''))),
        h('tbody', {}, trouble.map((t) => h('tr', {},
          h('td', {}, t.username, t.locked ? h('span', { class: 'error' }, '  locked') : null),
          h('td', { class: 'num' }, String(t.failures)), h('td', {}, when(t.last)),
          h('td', {}, h('button', { class: 'ghost', type: 'button', onclick: act(() => api(`/api/teach/players/${t.id}/unlock`, {})) }, 'Unlock')))))))
      : h('p', { class: 'muted' }, 'No trouble. A student shows up here after three wrong tries.'),
    h('p', { class: 'muted small' }, 'After 5 wrong tries in a minute a student waits briefly; after 30 in an hour the account is locked until you unlock it. Your own account is never locked: a browser you have signed in on before always gets in.'),
    blocked.length ? h('div', {},
      h('h3', {}, 'Blocked network addresses'),
      h('p', { class: 'muted small' }, 'Everyone behind one of these addresses (a whole class sharing the school connection) is refused until it frees by itself or you unblock it. Something there made 600 wrong tries in 15 minutes.'),
      h('div', { class: 'table-wrap' }, h('table', {},
        h('thead', {}, h('tr', {}, h('th', {}, 'Address'), h('th', { class: 'num' }, 'Wrong tries'), h('th', {}, 'Frees by itself'), h('th', {}, ''))),
        h('tbody', {}, blocked.map((b) => h('tr', {},
          h('td', {}, b.ip), h('td', { class: 'num' }, String(b.count)), h('td', {}, when(b.frees)),
          h('td', {}, h('button', { class: 'ghost', type: 'button', onclick: act(() => api('/api/teach/blocked-ips/unblock', { ip: b.ip })) }, 'Unblock')))))))) : null);
}

// The result lives outside the form: a live update may redraw the console while the change is in flight, so the handler must
// not write into the form it was submitted from (it may be detached by then). Password fields are never kept across redraws.
let accountMsg = null;   // { ok, text }
function accountPanel() {
  const msg = h('p', { role: 'status', class: accountMsg ? (accountMsg.ok ? 'ok' : 'error') : '' }, accountMsg?.text ?? '');
  const form = h('form', { class: 'glass panel', onsubmit: async (e) => {
    e.preventDefault();
    const current = form.current.value, next = form.next.value, again = form.again.value;
    form.reset();                                         // clear the secrets from the screen right away
    if (next !== again) accountMsg = { ok: false, text: 'The two new passphrases do not match.' };
    else {
      try { await api('/api/teach/passphrase', { current, next }); accountMsg = { ok: true, text: 'Passphrase changed. Other devices were signed out.' }; }
      catch (ex) { accountMsg = { ok: false, text: ex.message }; }
    }
    draw();
  } },
  h('h2', {}, 'Your passphrase'),
  h('div', { class: 'row' },
    field('Current passphrase', 'current', { type: 'password', autocomplete: 'current-password' }),
    field('New passphrase (12+ characters)', 'next', { type: 'password', minlength: '12', autocomplete: 'new-password' }),
    field('New passphrase again', 'again', { type: 'password', minlength: '12', autocomplete: 'new-password' }),
    h('button', { type: 'submit' }, 'Change passphrase')),
  msg);
  return form;
}

// One listener on the stable root, not on the table that is about to be replaced: leaving any core table releases a held-back redraw.
root.addEventListener('pointerout', (e) => { if (deferred && !e.relatedTarget?.closest?.('section:not([data-panel]) .table-wrap')) draw(); });

const stat = (label, value) => h('div', { class: 'stat' }, h('span', { class: 'label' }, label), h('b', {}, value));

live.sync();
