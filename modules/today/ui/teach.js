import { h, api, fmt } from '/ui.js?v=__V__';

// Teacher panel for Today: push a lesson quest (the quests/<date>.json file Slide Studio writes), the quest list, each class's energy cap,
// who did their errands, and the quest answers (only for your own classes; students never see each other's).
export async function render(el, ctx) {
  if (!document.querySelector('link[data-today]')) document.head.append(h('link', { rel: 'stylesheet', href: '/m/today/today.css?v=__V__', 'data-today': '' }));
  const msg = h('p', { role: 'status' });
  const say = (text, bad) => { msg.className = bad ? 'error' : 'ok'; msg.textContent = text; };
  const box = h('div', { class: 'stack' });
  const file = h('textarea', { 'aria-label': 'Quest file (JSON)', rows: '8', spellcheck: 'false', class: 'td-file', placeholder: '{ "id": "budget-1", "date": "2026-11-02", "title": "...", "brief": "...", "tasks": [{ "kind": "paid_bill" }], "justify": true, "reward_cents": 300, "energy": 2 }' });
  const pick = h('input', { type: 'file', accept: '.json,application/json', 'aria-label': 'Choose a quest file', onchange: async (e) => { const f = e.currentTarget.files?.[0]; if (f) file.value = await f.text(); } });

  async function push() {
    let body;
    try { body = JSON.parse(file.value); } catch { return say('That is not valid JSON.', true); }
    try { const r = await api('/api/today/quest', body); say(`Quest saved for ${r.date}.`); file.value = ''; await load(); } catch (e) { say(e.message, true); }
  }

  async function load() {
    const v = await api('/api/today/teach');
    const byClass = (id) => v.students.filter((s) => s.class_id === id);
    box.replaceChildren(...[
      h('p', { class: 'muted small' }, `Class day ${v.day ?? 0}. Today is ${v.today}. Errands refresh once per class day (each advance), never on the clock.`),
      v.can_push ? h('div', { class: 'class-card' }, h('b', {}, 'Push a lesson quest'),
        h('p', { class: 'muted small' }, `Tasks: ${v.checks.join(', ')}. Reward at most ${fmt(v.max_reward_cents)}. A quest shows on its date; pushing the same date again replaces it.`),
        pick, file, h('button', { type: 'button', onclick: push }, 'Push quest')) : h('p', { class: 'muted small' }, 'Only the world teacher can push quests.'),
      h('div', { class: 'class-card' }, h('b', {}, 'Quests'), v.quests.length ? h('div', { class: 'table-wrap' }, h('table', {},
        h('thead', {}, h('tr', {}, h('th', {}, 'Date'), h('th', {}, 'Title'), h('th', {}, 'Tasks'), h('th', {}, 'Answer'), h('th', { class: 'num' }, 'Reward'))),
        h('tbody', {}, v.quests.map((q) => h('tr', {}, h('td', {}, q.date), h('td', {}, q.title), h('td', {}, q.tasks.map((t) => (t.check ? `${t.kind} (${t.check})` : t.kind)).join(', ')),
          h('td', {}, q.justify ? 'yes' : 'no'), h('td', { class: 'num' }, fmt(q.reward_cents))))))) : h('p', { class: 'muted' }, 'No quests yet. A day with no quest shows only errands.')),
      ...v.classes.map((c) => {
        const cap = h('input', { type: 'number', min: '0', max: '20', value: String(c.energy_cap), 'aria-label': `Energy cap for ${c.name}`, class: 'td-cap' });
        const kids = byClass(c.id);
        return h('div', { class: 'class-card' },
          h('div', { class: 'spread' }, h('b', {}, c.name),
            c.can_manage ? h('div', { class: 'row' }, h('label', {}, 'Energy cap', cap), h('button', { type: 'button', class: 'ghost', onclick: async () => {
              try { await api('/api/today/cap', { class_id: c.id, energy_cap: Number(cap.value) }); say(`Energy cap for ${c.name} saved. It applies from the next class day.`); await load(); } catch (e) { say(e.message, true); }
            } }, 'Save')) : h('span', { class: 'muted small' }, `Energy cap ${c.energy_cap}`)),
          kids.length ? h('div', { class: 'table-wrap' }, h('table', {},
            h('thead', {}, h('tr', {}, h('th', {}, 'Student'), h('th', {}, 'Today\'s quest'), h('th', { class: 'num' }, 'Errands today'), h('th', { class: 'num' }, 'Errands done'), h('th', { class: 'num' }, 'Streak'), h('th', { class: 'num' }, 'Errand cash'))),
            h('tbody', {}, kids.map((s) => h('tr', {}, h('td', {}, s.username), h('td', {}, !v.quest_today ? 'No quest today' : s.quest_done ? 'Done' : 'Not yet'), h('td', { class: 'num' }, String(s.done_today)), h('td', { class: 'num' }, String(s.errands_done)),
              h('td', { class: 'num' }, String(s.streak)), h('td', { class: 'num' }, fmt(s.errand_cents))))))) : h('p', { class: 'muted' }, 'No students yet.'));
      }),
      h('div', { class: 'class-card' }, h('b', {}, 'Quest completions and answers'), h('p', { class: 'muted small' }, 'Every student who finished a quest, with their answer when the quest asked for one. Only you (and the class\'s other teachers) see these.'),
        v.answers.length ? h('div', { class: 'table-wrap' }, h('table', {},
          h('thead', {}, h('tr', {}, h('th', {}, 'Date'), h('th', {}, 'Student'), h('th', { class: 'num' }, 'World month'), h('th', {}, 'Answer'))),
          h('tbody', {}, v.answers.map((a) => h('tr', {}, h('td', {}, a.date), h('td', {}, a.username), h('td', { class: 'num' }, String(a.done_month)),
            h('td', { class: 'td-wrap' }, a.answer ?? h('span', { class: 'muted' }, 'Done (no answer needed)'))))))) : h('p', { class: 'muted' }, 'No one has finished a quest yet.')),
    ]);
  }

  el.append(h('h2', {}, 'Today'), box, msg);
  ctx?.onRefresh(() => load().catch(() => {}));
  await load();
}
