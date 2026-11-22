import { h, api, fmt, confirmAction } from '/ui.js?v=__V__';

// Teacher panel for Life: where the world is in the life (month, age, stage), the pace plan (view, edit, lock), the class-day calculator,
// the scenario picker, the stage events (move or skip), and each of your students' retirement ages (read only; your own classes only).
// A refresh redraws the panel in three parts (top, events and classes) but never while you are typing in one of them, and the scenario picker is built once.
const dayAfter = (d) => new Date(Date.parse(`${d}T12:00:00Z`) + 864e5).toISOString().slice(0, 10);
// School days from today to season_end, from the world's no-school list (the one in force, from /api/teach/state). Mon-Fri, not listed.
function schoolDaysLeft(today, end, noSchool) {
  const listed = (d) => noSchool.some((e) => { const [a, b = a] = e.split(' to '); return d >= a && d <= b; });
  let n = 0;
  for (let d = today; d < end; d = dayAfter(d)) { const dow = new Date(`${d}T12:00:00Z`).getUTCDay(); if (dow >= 1 && dow <= 5 && !listed(d)) n++; }
  return n;
}

export async function render(el, ctx) {
  const msg = h('p', { role: 'status' });
  const say = (text, bad) => { msg.className = bad ? 'error' : 'ok'; msg.textContent = text; };
  const box = h('div', { class: 'stack' }), rest = h('div', { class: 'stack' });
  const busy = (part) => part.contains(document.activeElement) && /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.tagName);   // a live refresh must not eat what you are typing
  const days = h('input', { type: 'number', min: '0', max: '1000', 'aria-label': 'Class days left in the season' });
  let calendar = null;
  const act = async (path, body, ok) => { try { await api(path, body); say(ok); } catch (e) { say(e.message, true); } await load(); };

  // The scenario picker: built once (the select and the month field keep their values across refreshes); only the blurb and the dated list are redrawn.
  const pick = h('select', { 'aria-label': 'Scenario' });
  const from = h('input', { type: 'number', min: '1', inputmode: 'numeric', 'aria-label': 'Start the scenario from world month' });
  const blurb = h('p', { class: 'muted small' }), preview = h('div', { class: 'table-wrap' }), note = h('p', { class: 'muted small' });
  const applyBtn = h('button', { type: 'button', 'aria-label': 'Use this scenario' }, 'Use this scenario');
  let last = null;
  function paintScenario() {
    const v = last, sc = v?.scenarios.find((x) => x.id === pick.value);
    if (!sc) return;
    const start = from.value === '' ? v.world.month : Number(from.value);
    const unfired = v.events.filter((e) => e.fired_month === null).length;
    blurb.textContent = sc.blurb;
    note.textContent = `Replaces the ${unfired} stage event${unfired === 1 ? '' : 's'} that ${unfired === 1 ? 'has' : 'have'} not happened yet. Events that already happened stay. Months count from world month ${start}.`;
    preview.replaceChildren(sc.events.length ? h('table', {},
      h('thead', {}, h('tr', {}, h('th', {}, 'Month'), h('th', {}, 'Age'), h('th', {}, 'Event'))),
      h('tbody', {}, sc.events.map((e) => {
        const month = start + e.offset, out = !Number.isSafeInteger(month) || month < 2 || month >= v.end_month;
        return h('tr', {}, h('td', {}, out ? `${month} (skipped)` : String(month)), h('td', {}, out ? '' : String(v.start_age + Math.floor((month - 1) / 12))), h('td', {}, e.headline));
      }))) : h('p', { class: 'muted' }, 'No shocks: every stage event that has not happened yet is cleared.'));
    applyBtn.disabled = !v.can_edit || !Number.isSafeInteger(start) || start < v.world.month;
  }
  pick.addEventListener('change', paintScenario);
  from.addEventListener('input', paintScenario);
  applyBtn.addEventListener('click', async () => {
    const sc = last?.scenarios.find((x) => x.id === pick.value);
    if (!sc || !confirmAction(`Replace the stage events that have not happened yet with "${sc.name}"?`)) return;
    const body = { id: sc.id };
    if (from.value !== '') body.from_month = Number(from.value);
    try { const r = await api('/api/life/scenario', body); say(`${sc.name}: ${r.inserted} event${r.inserted === 1 ? '' : 's'} set${r.skipped ? `, ${r.skipped} skipped (outside the life)` : ''}; ${r.removed} replaced.`); } catch (e) { say(e.message, true); }
    await load();
  });
  const scenarioCard = h('div', { class: 'class-card' }, h('b', {}, 'Scenario'),
    h('p', { class: 'muted small' }, 'A scenario sets a run of shocks (markets, rates, home prices, inflation, town events) as stage events, so the class lives through a period of history. You can still move or skip each event below.'),
    h('div', { class: 'row' }, h('label', {}, 'Scenario ', pick), h('label', {}, 'From world month ', from), applyBtn), blurb, preview, note);

  async function load() {
    if (calendar === null) {
      try {
        const st = await api('/api/teach/state');
        const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Edmonton' });
        calendar = st.world ? schoolDaysLeft(today, st.world.season_end, st.world.no_school ?? []) : 0;
        if (!days.value) days.value = String(calendar);
      } catch { calendar = undefined; }
    }
    const v = await api(`/api/life/teach${days.value ? `?days=${encodeURIComponent(days.value)}` : ''}`);
    if (!v.world) { box.replaceChildren(h('p', { class: 'muted' }, 'No season yet.')); rest.replaceChildren(); scenarioCard.hidden = true; return; }
    scenarioCard.hidden = false;
    last = v;
    if ([...pick.options].map((o) => o.value).join() !== v.scenarios.map((x) => x.id).join()) pick.replaceChildren(...v.scenarios.map((x) => h('option', { value: x.id }, x.name)));
    if (!from.placeholder || from.placeholder !== String(v.world.month)) from.placeholder = String(v.world.month);
    paintScenario();
    const c = v.calc;
    const plan = h('textarea', { rows: '5', spellcheck: 'false', 'aria-label': 'Pace plan (JSON)', class: 'td-file' }, JSON.stringify(v.plan));
    const top = [
      h('p', {}, h('strong', {}, `World month ${v.world.month}: age ${v.age}, Stage ${v.stage}.`), ` ${v.world.months_per_day} month${v.world.months_per_day === 1 ? '' : 's'} per class day; auto-advance ${v.world.auto_advance}. The life ends at month ${v.end_month} (age 70).`),
      h('div', { class: 'class-card' }, h('b', {}, 'Pace plan and class days'),
        h('p', { class: 'muted small' }, 'At each segment boundary Life sets the months per class day. Lock the pace to keep your own setting. Each segment must be a whole number of class days.'),
        h('div', { class: 'row' }, h('label', {}, 'Class days left ', days), h('button', { type: 'button', class: 'ghost', onclick: () => load().catch((e) => say(e.message, true)) }, 'Calculate'),
          calendar !== undefined && calendar !== null ? h('span', { class: 'muted small' }, `The calendar says ${calendar} school days until the season end (${v.world.season_end}).`) : ''),
        h('div', { class: 'table-wrap' }, h('table', {},
          h('thead', {}, h('tr', {}, h('th', {}, 'Months'), h('th', {}, 'Ages'), h('th', {}, 'Stage'), h('th', { class: 'num' }, 'Months/day'), h('th', { class: 'num' }, 'Class days'), h('th', { class: 'num' }, 'Still needed'))),
          h('tbody', {}, c.rows.map((r) => h('tr', { class: r.current ? 'ok' : '' }, h('td', {}, `${r.from_month}-${r.to_month}`), h('td', {}, `${r.from_age}-${r.to_age}`), h('td', {}, r.stages),
            h('td', { class: 'num' }, String(r.months_per_day)), h('td', { class: 'num' }, String(r.days)), h('td', { class: 'num' }, String(r.days_left))))),
          h('tfoot', {}, h('tr', {}, h('td', { colspan: '4' }, h('strong', {}, 'Total')), h('td', { class: 'num' }, String(c.total_days)), h('td', { class: 'num' }, h('strong', {}, String(c.days_needed))))))),
        c.spare_days === null ? '' : h('p', { class: c.spare_days < 0 ? 'error' : 'ok' }, c.spare_days < 0 ? `Short by ${-c.spare_days} class days: speed up a segment.` : `Fits, with ${c.spare_days} class day${c.spare_days === 1 ? '' : 's'} to spare.`),
        v.can_edit ? h('div', { class: 'stack' },
          h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: v.locked, onchange: (e) => act('/api/life/lock', { locked: e.currentTarget.checked }, e.currentTarget.checked ? 'Pace locked: Life will not change months per day.' : 'Pace unlocked: Life sets it at the next boundary.') }), 'Lock the pace'),
          plan, h('button', { type: 'button', onclick: () => { let p; try { p = JSON.parse(plan.value); } catch { return say('That is not valid JSON.', true); } act('/api/life/plan', { plan: p }, 'Plan saved. It applies at the next segment boundary.'); } }, 'Save plan'))
          : h('p', { class: 'muted small' }, `${v.locked ? 'The pace is locked. ' : ''}Only the world teacher can change the plan.`)),
    ];
    const costs = v.stage_costs ?? [];
    const bottom = [
      costs.length ? h('div', { class: 'class-card' }, h('b', {}, 'Stage costs (Bills)'),
        h('p', { class: 'muted small' }, 'Bill lines that start with age, at today\'s prices (season-start amounts x the price index). Required lines are billed to everyone in the age range (home upkeep to owners, renter extras to everyone else); an optional line bills its default until a student picks another option or None in Bills, Plans. Amounts are set in modules/bills/catalogue.js (or config options.bills.amounts). Read only.'),
        h('div', { class: 'table-wrap' }, h('table', {},
          h('thead', {}, h('tr', {}, h('th', {}, 'Line'), h('th', {}, 'Ages'), h('th', {}, 'Who'), h('th', { class: 'num' }, 'A month now'))),
          h('tbody', {}, costs.map((l) => h('tr', {}, h('td', {}, l.name), h('td', {}, `${l.from_age}-${l.to_age >= 70 ? 70 : l.to_age}`),
            h('td', {}, l.required ? (l.tenure === 'own' ? 'Owners' : l.tenure === 'rent' ? 'Renters' : 'Everyone') : l.default ? 'Default option' : 'If chosen'), h('td', { class: 'num' }, fmt(l.amount_cents)))))))) : '',
      h('div', { class: 'class-card' }, h('b', {}, 'Stage events'), h('p', { class: 'muted small' }, 'Each fires once, in the tick of its month. Move one to a later month or skip it before it happens.'),
        h('div', { class: 'table-wrap' }, h('table', {},
          h('thead', {}, h('tr', {}, h('th', {}, 'Month'), h('th', {}, 'Age'), h('th', {}, 'Event'), h('th', {}, 'Status'))),
          h('tbody', {}, v.events.map((e) => {
            const open = v.can_edit && e.fired_month === null;
            const month = h('input', { type: 'number', min: String(v.world.month + 1), max: String(v.end_month - 1), value: String(e.month), 'aria-label': `Month for ${e.headline}` });
            return h('tr', {}, h('td', {}, open ? h('div', { class: 'row' }, month, h('button', { type: 'button', class: 'ghost', onclick: () => act('/api/life/event', { id: e.id, month: Number(month.value) }, 'Event moved.') }, 'Move')) : String(e.month)),
              h('td', {}, String(e.age)), h('td', {}, e.headline),
              h('td', {}, e.fired_month !== null ? `${e.result} (month ${e.fired_month})` : open ? h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: e.skip, onchange: (ev) => act('/api/life/event', { id: e.id, skip: ev.currentTarget.checked }, ev.currentTarget.checked ? 'Event skipped.' : 'Event back on.') }), 'Skip') : e.skip ? 'Skipped' : 'Waiting'));
          }))))),
      ...v.classes.map((cl) => h('div', { class: 'class-card' }, h('b', {}, `${cl.name}: retirement ages`),
        cl.students.length ? h('div', { class: 'table-wrap' }, h('table', {},
          h('thead', {}, h('tr', {}, h('th', {}, 'Student'), h('th', { class: 'num' }, 'Retire at'), h('th', {}, ''))),
          h('tbody', {}, cl.students.map((s) => h('tr', {}, h('td', {}, s.username), h('td', { class: 'num' }, String(s.retire_age)), h('td', {}, s.retired ? 'Retired' : s.set ? 'Chosen' : 'Default')))))) : h('p', { class: 'muted' }, 'No students yet.'))),
    ];
    if (!busy(box)) box.replaceChildren(...top);
    if (!busy(rest)) rest.replaceChildren(...bottom);
  }

  el.append(h('h2', {}, 'Life'), box, scenarioCard, rest, msg);
  ctx?.onRefresh(() => load().catch(() => {}));
  await load();
}
