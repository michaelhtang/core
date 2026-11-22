import { h, api, fmt } from '/ui.js?v=__V__';

// Teacher panel for jobs: per class, who has which job and their last net pay (assign or remove a job), and which jobs are on the class's board.
export async function render(el, ctx) {
  const box = h('div', { class: 'stack' });
  const msg = h('p', { role: 'status' });
  const say = (text, bad) => { msg.className = bad ? 'error' : 'ok'; msg.textContent = text; };
  let shown = null;

  async function load() {
    const data = await api('/api/jobs/overview');
    const key = JSON.stringify(data);
    if (key === shown) return;                 // unchanged: keep half-made choices in the drop-downs
    shown = key;
    box.replaceChildren(...(data.classes.length ? data.classes.map((c) => classCard(c, data.catalogue, data)) : [h('p', { class: 'muted' }, 'Create a class first.')]));
  }

  const act = async (path, body, ok) => { try { await api(path, body); say(ok); shown = null; await load(); } catch (e) { say(e.message, true); } };

  function classCard(c, catalogue, data) {
    return h('div', { class: 'class-card' },
      h('strong', {}, c.name),
      c.applications.length ? h('div', { class: 'stack' }, h('p', { class: 'label' }, 'Promotion applications waiting'),
        ...c.applications.map((a) => h('div', { class: 'class-card' },
          h('p', {}, h('strong', {}, a.username), `: ${a.from} to ${a.to} (applied in month ${a.month})`),
          h('p', {}, `"${a.reflection}"`),
          h('button', { type: 'button', onclick: () => act('/api/jobs/decide', { id: a.id, approve: true }, `Approved for ${a.username}. It starts at the next payday.`) }, 'Approve'), ' ',
          h('button', { class: 'ghost', type: 'button', onclick: () => act('/api/jobs/decide', { id: a.id, approve: false }, `Denied for ${a.username}. They can apply again in a few months.`) }, 'Deny')))) : null,
      c.promotions?.length ? h('div', { class: 'stack' }, h('p', { class: 'label' }, 'Recent promotions'),
        ...c.promotions.map((a) => h('div', { class: 'class-card' },
          h('p', {}, h('strong', {}, a.username), `: ${a.from} to ${a.to} (month ${a.month}) `, h('span', { class: 'badge' }, a.auto ? 'Automatic: no approval needed' : 'Approved by a teacher')),
          h('p', { class: 'muted small' }, `"${a.reflection}"`)))) : null,
      h('div', { class: 'table-wrap' }, h('table', {},
        h('thead', {}, h('tr', {}, h('th', {}, 'Student'), h('th', {}, 'Job'), h('th', {}, 'Path'), h('th', { class: 'num' }, 'Wage'), h('th', { class: 'num' }, 'Last net pay'), h('th', {}, 'Assign'), h('th', {}, 'Grant'))),
        h('tbody', {}, c.students.map((s) => {
          const pick = h('select', { 'aria-label': `Job for ${s.username}` }, h('option', { value: '' }, 'No job'), ...catalogue.map((j) => h('option', { value: String(j.id), selected: j.id === s.job_id }, j.title)),
            // a held job that has since been retired from the catalogue stays selectable, so "Set" never removes it by accident
            ...(s.job_id !== null && !catalogue.some((j) => j.id === s.job_id) ? [h('option', { value: String(s.job_id), selected: true }, `${s.title ?? 'Current job'} (retired)`)] : []));
          return h('tr', {},
            h('td', {}, s.username), h('td', {}, s.title ?? h('span', { class: 'muted' }, 'none'), ...(s.business ?? []).map((b) => h('span', { class: 'muted small' }, h('br'), `+ part-time: ${b}`))),
            h('td', {}, s.job_id === null ? '' : s.next ? `Step ${s.step}; ${s.months_in_step} of ${data.months_needed} months; next: ${s.next}${s.pending ? ' (applied)' : s.eligible_month <= data.month ? ' (can apply)' : ` (from month ${s.eligible_month})`}` : `Step ${s.step}: top of the path`),
            h('td', { class: 'num' }, s.hourly_cents === null ? '' : `${fmt(s.hourly_cents)}/h`),
            h('td', { class: 'num' }, s.last_net === null ? '' : `${fmt(s.last_net)} (month ${s.last_month})`),
            h('td', {}, pick, ' ', h('button', { class: 'ghost', type: 'button', onclick: () => act('/api/jobs/assign', { player_id: s.id, job_id: pick.value ? Number(pick.value) : null }, `Saved for ${s.username}.`) }, 'Set')),
            h('td', {}, s.job_id === null ? '' : [
              s.next ? h('button', { class: 'ghost', type: 'button', onclick: () => act('/api/jobs/promote', { player_id: s.id }, `${s.username} is promoted to ${s.next}. It starts at the next payday.`) }, 'Promote') : null, ' ',
              h('button', { class: 'ghost', type: 'button', onclick: () => act('/api/jobs/raise', { player_id: s.id }, `${s.username} gets a ${(data.raise_bp / 100).toFixed(data.raise_bp % 100 ? 2 : 0)}% raise at the next payday.`) }, 'Raise')]));
        })))),
      h('p', { class: 'label' }, 'Jobs on this class\'s board'),
      h('div', { class: 'stack' }, catalogue.map((j) => {
        const on = h('input', { type: 'checkbox', checked: !c.off.includes(j.id), onchange: () => act('/api/jobs/catalogue', { class_id: c.id, job_id: j.id, enabled: on.checked }, `${j.title}: ${on.checked ? 'on' : 'off'} for ${c.name}.`) });
        return h('label', { class: 'check' }, on, `${j.title} (${fmt(j.hourly_cents)}/h, ${j.hours_per_month} h)`);
      })));
  }

  el.append(
    h('div', { class: 'spread' }, h('h2', {}, 'Jobs'), h('button', { class: 'ghost', type: 'button', onclick: () => { shown = null; load().catch((e) => say(e.message, true)); } }, 'Refresh')),
    h('p', { class: 'muted small' }, 'Students pick a job in the Job Centre; payday happens when you advance the world. Pay rises on its own after every 12 months in a job or step; students apply for a promotion after 12 months in a step, and you approve or deny it (or promote or give a raise yourself with the buttons). When automatic promotions are on, you decide each student\'s first promotion in a job and the later steps are granted when they apply; they are listed under Recent promotions. A job you turn off cannot be picked in that class, and anyone already in it keeps it until you remove or change it.'),
    box, msg);
  ctx?.onRefresh(() => load().catch(() => {}));
  await load();
}
