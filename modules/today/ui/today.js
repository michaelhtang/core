import { h, api, fmt, guard } from '/ui.js?v=__V__';

// The Today card (the homeCards hook): what happened since the last class day, today's quest, three errands, energy and streak.
// ctx.card.data comes with /api/me; on open it is fetched fresh (GET /api/today/state) so a job picked a minute ago already shows as done.
const GROUPS = [['start', 'Starting money'], ['pay', 'Pay received'], ['bills', 'Bills, rent and card'], ['interest', 'Interest and dividends'], ['rewards', 'Errands and quests'], ['other', 'Purchases and other moves']];
const TASKS = { paid_bill: 'Pay a bill', moved_to_account: 'Move money into your', opened_registered_account: 'Open a registered account', bought_security: 'Buy a security', read_panel: 'Open the' };
const NAMES = { hisa: 'HISA', gic: 'GIC', tfsa: 'TFSA', rrsp: 'RRSP', invest: 'investment account' };
const mark = (done) => h('span', { class: 'td-mark', role: 'img', 'aria-label': done ? 'Done' : 'To do' }, done ? '✓' : '○');
const taskText = (t) => `${TASKS[t.kind] ?? t.kind}${t.check ? ` ${NAMES[t.check] ?? t.check}` : ''}`;

// A link to a building: tell the server first (panel tours and read_panel tasks count the visit), then open it.
const go = (building) => guard(async () => {
  await api('/api/today/visit', { building }).catch(() => {});
  location.hash = `#${building}`;
});

export function renderCard(el, ctx) {
  if (!document.querySelector('link[data-today]')) document.head.append(h('link', { rel: 'stylesheet', href: '/m/today/today.css?v=__V__', 'data-today': '' }));
  const msg = h('p', { role: 'status' });
  const say = (text, bad) => { msg.className = bad ? 'error' : 'ok'; msg.textContent = text; };
  const answer = h('textarea', { 'aria-label': 'Your answer (one to three sentences)', maxlength: '500' });
  let data = ctx.card.data;

  function paint() {
    const d = data;
    const rows = GROUPS.filter(([key]) => d.digest.groups[key]).map(([key, label]) => h('tr', {}, h('td', {}, label), h('td', {}, fmt(d.digest.groups[key]))));
    const q = d.quest;
    el.replaceChildren(...[
      h('div', { class: 'td-meta' },
        h('span', { class: 'chip' }, `Class day ${d.day}`),
        h('span', { class: 'chip', title: 'Energy refills at every class day. It does not carry over.' }, `Energy ${d.energy}/${d.energy_cap}`),
        h('span', { class: 'chip', title: 'Class days in a row with at least one errand or quest done' }, `Errand streak ${d.streak}`),
        d.savings ? h('span', { class: 'chip' }, `HISA ${fmt(d.savings.hisa_cents)}`) : null,
        d.savings ? h('span', { class: 'chip' }, `Net worth ${fmt(d.savings.net_worth_cents)}`) : null),
      h('div', {}, h('p', { class: 'label' }, 'Since last class'),
        rows.length ? h('table', { class: 'td-digest' }, h('tbody', {}, rows, h('tr', {}, h('td', {}, h('b', {}, 'Change in your accounts')), h('td', {}, h('b', {}, fmt(d.digest.total)))))) : h('p', { class: 'muted small' }, 'Nothing has moved in your accounts yet.'),
        d.due?.n ? h('p', { class: 'small' }, `Bills now due: ${d.due.n} (${fmt(d.due.cents)})`) : null),
      q ? h('div', { class: 'td-quest' },
        h('p', { class: 'label' }, 'Lesson quest'), h('b', {}, q.title), h('p', { class: 'small' }, q.brief),
        h('ul', { class: 'td-list' }, q.tasks.map((t) => h('li', { class: `td-row${t.done ? ' td-done' : ''}` }, mark(t.done),
          h('span', { class: 'td-what' }, taskText(t)),
          t.kind === 'read_panel' && !t.done ? h('button', { type: 'button', class: 'ghost', 'aria-label': `Go: ${taskText(t)}`, onclick: go(t.check) }, 'Go') : null))),
        q.done ? h('p', { class: 'ok' }, `Quest done${q.reward_cents ? `: ${fmt(q.reward_cents)} paid to chequing` : ''}.`)
          : q.justify && q.tasks.every((t) => t.done) ? h('form', { onsubmit: guard(async (e) => {
            e.preventDefault();
            try { await api('/api/today/answer', { id: q.id, answer: answer.value }); answer.value = ''; say('Answer sent to your teacher.'); await load(); } catch (ex) { say(ex.message, true); }
          }) }, h('label', {}, 'Choose and justify: explain your choice in one to three sentences. Only your teacher sees it.', answer), h('button', { type: 'submit' }, 'Send answer'))
          : h('p', { class: 'muted small' }, q.justify ? 'Finish the tasks, then explain your choice.' : `Reward ${fmt(q.reward_cents)} when every task is done.`)) : null,
      h('div', {}, h('p', { class: 'label' }, 'Errands'),
        d.errands.length ? h('ul', { class: 'td-list' }, d.errands.map((e) => h('li', { class: `td-row${e.status === 'done' ? ' td-done' : ''}` },
          mark(e.status === 'done'),
          h('span', { class: 'td-what' }, e.title, h('br'), h('span', { class: 'muted small' }, e.status === 'done' ? `Done: ${fmt(e.reward_cents)}` : `${fmt(e.reward_cents)} and ${e.energy} energy`)),
          e.status !== 'done' && e.building ? h('button', { type: 'button', class: 'ghost', 'aria-label': `Go: ${e.title}`, onclick: go(e.building) }, 'Go') : null)))
          : h('p', { class: 'muted small' }, 'No errands today. New ones come with the next class day.')),
      msg].filter(Boolean));
  }

  async function load() { data = await api('/api/today/state'); paint(); }
  paint();
  ctx.onRefresh(() => { data = ctx.card.data; paint(); });   // a live /api/me update carries a fresh copy
  load().catch(() => {});
}
