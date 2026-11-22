import { h, api, fmt } from '/ui.js?v=__V__';

// The Life panel: age and stage, the three stages as a timeline, the retirement plan (Stage B and C), the Life Review snapshots so far,
// and the town's stage events that already happened.
const NAMES = { A: 'Starting out', B: 'Building', C: 'Winding down' };

export async function render(el, ctx) {
  const msg = h('p', { role: 'status' });
  const say = (text, bad) => { msg.className = bad ? 'error' : 'ok'; msg.textContent = text; };
  const box = h('div', { class: 'stack' });

  function timeline(v) {
    // The CSP has no style-src, so widths go through the CSSOM (as bills' budget bar does).
    const track = h('div', { role: 'img', 'aria-label': `Month ${v.month} of ${v.end_month - 1}` });
    Object.assign(track.style, { display: 'flex', gap: '2px', borderRadius: '6px', overflow: 'hidden' });
    for (const s of v.stages) {
      const cell = h('div', { title: `Stage ${s.stage}: ages ${s.from_age}-${s.to_age}` }, `${s.stage} · ${s.from_age}-${s.to_age}`);
      Object.assign(cell.style, { flex: String(s.to_month - s.from_month + 1), background: s.stage === v.stage ? 'var(--gold)' : 'var(--ice)', color: 'var(--night)', padding: '4px 2px', textAlign: 'center', fontSize: '.8rem', whiteSpace: 'nowrap', overflow: 'hidden' });
      track.append(cell);
    }
    return track;
  }

  function retirement(v) {
    const r = v.retire;
    if (!r.open) return h('p', { class: 'muted' }, 'From Stage B (age 36) you can choose your retirement age here.');
    if (r.reached) return h('p', {}, `You retired at ${r.age}. Your job ended at the payday you reached it.`);
    const input = h('input', { type: 'number', min: String(r.min), max: String(r.max), value: String(r.age), 'aria-label': 'Retirement age' });
    return h('div', { class: 'stack' },
      h('p', {}, r.set ? `Your retirement age: ${r.age}.` : `You have not chosen yet, so it is ${r.default}.`),
      h('p', { class: 'muted small' }, `Pick ${r.min} to ${r.max}. Work stops at your retirement age: your job ends at the first payday at that age. You can change it until you reach it.`),
      h('div', { class: 'row' }, h('label', {}, 'Retire at ', input), h('button', { type: 'button', onclick: async () => {
        try { await api('/api/life/retire', { retire_age: Number(input.value) }); say(`Retirement age saved: ${input.value}.`); await load(); } catch (e) { say(e.message, true); }
      } }, 'Save')));
  }

  // Stage costs (bills, docs/stagecosts.md): the lines of this stage and the next, at today's prices, with the student's choice (or the default).
  const NEXT = { A: 'B', B: 'C', C: null };
  function costs(v) {
    const c = v.stage_costs;
    if (!c || !c.lines.length) return '';
    const pick = (slot) => c.choices[slot] ?? c.lines.find((x) => x.slot === slot && x.default)?.option;
    const mineOf = (l) => (l.required ? 'Always billed' : pick(l.slot) === l.option ? (c.choices[l.slot] ? 'Your choice' : 'Default') : '');
    const fits = (l) => !l.tenure || (l.tenure === 'own') === c.owner;
    const rows = (list) => h('div', { class: 'table-wrap' }, h('table', {},
      h('thead', {}, h('tr', {}, h('th', {}, 'Cost'), h('th', {}, 'Ages'), h('th', { class: 'num' }, 'A month now'), h('th', {}, ''))),
      h('tbody', {}, list.map((l) => h('tr', {}, h('td', {}, l.name), h('td', {}, l.to_age >= 70 ? `${l.from_age}+` : `${l.from_age}-${l.to_age}`), h('td', { class: 'num' }, fmt(l.amount_cents)), h('td', {}, mineOf(l)))))));
    const now = c.lines.filter((l) => fits(l) && l.from_age <= v.age && v.age <= l.to_age);
    const soon = c.lines.filter((l) => fits(l) && l.from_age > v.age && [v.stage, NEXT[v.stage]].includes(stageOfAge(l.from_age)));
    return h('div', { class: 'class-card' }, h('b', {}, 'Costs that come with age'),
      h('p', { class: 'muted small' }, 'As life goes on, new costs arrive: a bigger household and a car to replace in Stage B, health care and the travel you plan for in Stage C. They are added to your bills automatically from the age they start, and rise with prices like every bill. Optional ones start at the default; you can change them, or choose None, in Bills, Plans.'),
      now.length ? h('div', { class: 'stack' }, h('p', { class: 'label' }, `Stage ${v.stage}: on your bills now`), rows(now)) : h('p', { class: 'muted' }, 'No life-stage costs yet: they start at age 36.'),
      soon.length ? h('div', { class: 'stack' }, h('p', { class: 'label' }, `Coming later (from age ${Math.min(...soon.map((l) => l.from_age))})`), rows(soon)) : '');
  }
  const stageOfAge = (a) => (a < 36 ? 'A' : a < 55 ? 'B' : 'C');

  async function load() {
    const v = await api('/api/life/state');
    box.replaceChildren(
      h('p', {}, h('strong', {}, `Age ${v.age} · Stage ${v.stage}`), ` (${NAMES[v.stage]}), world month ${v.month}.`),
      v.review_ready ? h('p', { class: 'ok' }, 'Life Review ready: your life is complete. Your teacher closes the season.') : '',
      timeline(v),
      costs(v),
      h('div', { class: 'class-card' }, h('b', {}, 'Retirement plan'), retirement(v)),
      h('div', { class: 'class-card' }, h('b', {}, 'Life Review so far'),
        v.snapshots.length ? h('table', {}, h('thead', {}, h('tr', {}, h('th', {}, 'Age'), h('th', {}, 'Stage'), h('th', { class: 'num' }, 'Net worth'))),
          h('tbody', {}, v.snapshots.map((s) => h('tr', {}, h('td', {}, String(s.age)), h('td', {}, s.stage), h('td', { class: 'num' }, fmt(s.net_worth_cents))))))
          : h('p', { class: 'muted' }, 'Your net worth is recorded at ages 25, 35, 55, 65 and 70.')),
      v.events.length ? h('div', { class: 'class-card' }, h('b', {}, 'What happened in town'), h('ul', {}, v.events.map((e) => h('li', {}, `Age ${e.age}: ${e.headline}`)))) : '',
    );
  }

  el.append(h('h2', {}, 'Life'), box, msg);
  ctx?.onRefresh?.(() => load().catch(() => {}));
  await load();
}
