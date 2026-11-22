import { h, api, fmt } from '/ui.js?v=__V__';

// Job Centre: your job, the board of jobs (hourly wage, hours, monthly pay before deductions), and your pay stubs.
// A pay stub is laid out like a Canadian one: earnings, each deduction with its year-to-date, and net pay.
export async function render(el, ctx) {
  const msg = h('p', { role: 'status' });
  const mine = h('div', { class: 'stack' });
  const board = h('div', { class: 'table-wrap' });
  const stubList = h('div', { class: 'stack' });
  const stubView = h('div', { class: 'stack' });
  let openStub = null, last = '';
  // One textarea for the whole visit: the promotion box is redrawn when the data changes, but what the student typed stays in this element.
  const reflection = h('textarea', { rows: 3, maxlength: 500, 'aria-label': 'Why you are ready for the next step', placeholder: 'In a sentence or two: what have you learned in this job, and why are you ready for the next step?' });
  const say = (text, bad) => { msg.className = bad ? 'error' : 'ok'; msg.textContent = text; };

  async function load() {
    // student companies' jobs (Venture Row), listed beside the catalogue; none when ventures is not enabled
    const [cat, { stubs }, biz] = await Promise.all([api('/api/jobs/catalogue'), api('/api/jobs/stubs'), api('/api/ventures/openings').catch(() => ({ openings: [] }))]);
    const key = JSON.stringify([cat, stubs, biz]);
    if (key === last) return;                               // nothing changed: leave the page (and anything half-typed) alone
    last = key;
    const typing = document.activeElement === reflection, caret = [reflection.selectionStart, reflection.selectionEnd];
    const job = cat.current, room = cat.business_room;
    const mainJob = job
      ? h('div', { class: 'class-card' },
        h('p', { class: 'label' }, 'Your job'),
        h('h3', {}, `${job.title} at ${job.employer}`),
        h('p', {}, `${fmt(job.hourly_cents)} an hour, ${job.hours_per_month} hours a month: ${fmt(job.gross_cents)} before deductions.`),
        job.pending_note ? h('p', { class: 'ok' }, `${job.pending_note} It shows on your next pay stub.`) : null,
        pathView(cat),
        h('p', { class: 'muted small' }, 'You are paid on payday, when the teacher moves the world to the next month. A change you make now starts at your next payday.'),
        h('button', { class: 'ghost', type: 'button', 'aria-label': `Quit your job as ${job.title} at ${job.employer}`, onclick: () => act('/api/jobs/quit', {}, 'You quit. You will not be paid at the next payday.') }, 'Quit this job'))
      : h('div', { class: 'class-card' }, h('p', { class: 'label' }, 'Your job'), h('p', {}, cat.mine ? 'This job is no longer on the board, but you keep it until you pick another.' : 'You do not have a job yet. Pick one below.'));
    // part-time jobs at student companies, on top of the job above (each paid from its company's treasury, with its own pay stub)
    const partTime = cat.business.map((b) => h('div', { class: 'class-card' },
      h('p', { class: 'label' }, 'Part-time, at a student company'),
      h('h3', {}, `${b.title} at ${b.employer}`),
      h('p', {}, `${fmt(b.hourly_cents)} an hour, ${b.hours_per_month} hours a month: ${fmt(b.gross_cents)} before deductions, paid from the company's treasury on top of your job.`),
      b.note ? h('p', { class: b.missed ? 'error' : 'ok' }, b.note) : null,
      b.ends_month ? h('p', { class: 'muted' }, `You were given notice: your last pay from ${b.employer} is at the month ${b.ends_month} payday.`) : null,
      b.missed ? h('p', { class: 'small' }, `Paydays this company missed: ${b.missed}.`) : null,
      h('button', { class: b.unpaid_warning ? '' : 'ghost', type: 'button', 'aria-label': `Quit your part-time job at ${b.employer}`,
        onclick: () => act('/api/jobs/quit-business', { business_id: b.business_id }, `You quit your part-time job at ${b.employer}. Your other job is not affected.`) }, 'Quit this part-time job')));
    mine.replaceChildren(mainJob, ...partTime);
    board.replaceChildren(h('table', {},
      h('thead', {}, h('tr', {}, ['Job', 'Employer', 'Per hour', 'Hours / month', 'Gross / month', ''].map((t, i) => h('th', { class: i > 1 && i < 5 ? 'num' : '' }, t)))),
      h('tbody', {}, ...biz.openings.map((o) => h('tr', {},
        h('td', {}, o.title, h('br'), h('span', { class: 'muted small' }, `Part-time at a student company (${o.sector})${o.slots > 1 ? `, ${o.slots - o.filled} of ${o.slots} places left` : ''}`)),
        h('td', {}, o.company),
        h('td', { class: 'num' }, fmt(o.hourly_cents)),
        h('td', { class: 'num' }, String(o.hours_per_month)),
        h('td', { class: 'num' }, fmt(o.gross_cents)),
        h('td', {}, cat.business.some((b) => b.business_id === o.company_id) ? h('span', { class: 'badge' }, 'Your employer') : o.applied ? h('span', { class: 'badge' }, o.applied === 'approved' ? 'Waiting for the teacher' : 'Applied')
          : room.jobs_left === 0 || o.hours_per_month > room.hours_left ? h('span', { class: 'muted small' }, `Over your ${room.max_hours} part-time hours`)
          : h('button', { type: 'button', 'aria-label': `Apply for ${o.title} at ${o.company}`, onclick: () => act('/api/ventures/apply', { posting_id: o.posting_id }, `Applied to ${o.company}. A founder decides; it is part-time, on top of your job.`) }, 'Apply')))),
      cat.jobs.map((j) => h('tr', {},
        h('td', {}, j.title, h('br'), h('a', { class: 'small', href: j.alis_url, target: '_blank', rel: 'noopener noreferrer' }, 'Wage source: ALIS'), j.requires_note ? h('span', { class: 'muted small' }, ` (${j.requires_note})`) : null),
        h('td', {}, j.employer),
        h('td', { class: 'num' }, fmt(j.hourly_cents)),
        h('td', { class: 'num' }, String(j.hours_per_month)),
        h('td', { class: 'num' }, fmt(j.gross_cents)),
        h('td', {}, j.id === cat.mine?.job_id ? h('span', { class: 'badge' }, 'Your job') : h('button', { type: 'button', onclick: () => act('/api/jobs/pick', { job_id: j.id }, `You took the ${j.title} job. It starts at your next payday.`) }, cat.mine ? 'Switch to this' : 'Take this job')))))));
    stubList.replaceChildren(stubs.length
      ? h('div', { class: 'table-wrap' }, h('table', {},
        h('thead', {}, h('tr', {}, h('th', {}, 'Pay period'), h('th', {}, 'Job'), h('th', { class: 'num' }, 'Gross'), h('th', { class: 'num' }, 'Net'), h('th', {}, ''))),
        h('tbody', {}, stubs.map((s) => h('tr', {},
          h('td', {}, `Month ${s.month}`), h('td', {}, s.title, s.kind === 'severance' ? h('span', { class: 'badge' }, 'Pay in lieu of notice') : s.note ? h('span', { class: 'badge' }, s.note.startsWith('Promotion') ? 'Promotion' : /raise/i.test(s.note) ? 'Raise' : 'Note') : null), h('td', { class: 'num' }, fmt(s.gross)), h('td', { class: 'num' }, fmt(s.net)),
          h('td', {}, h('button', { class: 'ghost', type: 'button', onclick: () => show(s.id) }, 'Open')))))))
      : h('p', { class: 'muted' }, 'No pay stubs yet. Your first one arrives at your next payday.'));
    if (typing && reflection.isConnected) { reflection.focus(); reflection.setSelectionRange(...caret); }   // the box was re-attached by the redraw: give the cursor back
    if (openStub === null && stubs.length) await show(stubs[0].id);
  }

  // The promotion path: where you are, what each step pays, and when you can apply. The teacher decides.
  function pathView(cat) {
    const p = cat.promotion, cur = cat.current;
    return h('div', { class: 'stack' },
      h('p', { class: 'label' }, 'Your path'),
      h('ol', {}, cat.path.map((st) => h('li', { class: st.step === cur.step ? 'ok' : st.step < cur.step ? 'muted' : '' },
        `${st.title}: ${fmt(st.hourly_cents)} an hour, ${st.hours_per_month} hours a month `,
        st.step === cur.step ? h('span', { class: 'badge' }, 'You are here') : null, ' ',
        h('a', { class: 'small', href: st.alis_url, target: '_blank', rel: 'noopener noreferrer' }, 'ALIS'),
        st.note ? h('span', { class: 'muted small' }, ` (${st.note})`) : null))),
      h('p', { class: 'muted small' }, `Raise: about ${(p.raise_bp / 100).toFixed(p.raise_bp % 100 ? 2 : 0)}% after every ${12} months in the same job or step (next one at world month ${p.next_raise_month}). Your wage today may include raises, so it can be above the step's listed wage.`),
      !p.next ? h('p', { class: 'muted' }, 'You are at the top of this path.')
        : p.pending ? h('p', {}, `Your application for ${p.next.title} is waiting for your teacher.`)
        : p.can_apply ? h('div', { class: 'stack' }, h('p', {}, `You can apply for ${p.next.title} (${fmt(p.next.hourly_cents)} an hour).`), reflection,
          p.auto ? h('p', { class: 'muted small' }, 'This step is automatic: apply with your reflection and you are promoted at once. Your teacher sees it.') : null,
          h('button', { type: 'button', onclick: () => act('/api/jobs/apply', { reflection: reflection.value }, p.auto ? `Promoted: you are now ${p.next.title}. The new wage starts at the next payday.` : 'Application sent. Your teacher will decide.').then(() => { if (msg.className === 'ok') reflection.value = ''; }) }, p.auto ? 'Apply and get promoted' : 'Apply for promotion'))
        : h('p', { class: 'muted' }, `Next step: ${p.next.title}. You can apply from world month ${p.eligible_month} (${p.months_in_step} of ${p.months_needed} months in this step so far).`));
  }

  async function act(path, body, ok) {
    try { await api(path, body); say(ok); await load(); } catch (e) { say(e.message, true); }
  }

  async function show(id) {
    openStub = id;
    try { stubView.replaceChildren(stub(await api(`/api/jobs/stubs/${id}`))); } catch (e) { say(e.message, true); }
  }

  function stub(s) {
    const row = (label, now, ytd, cls = '') => h('tr', { class: cls }, h('td', {}, label), h('td', { class: 'num' }, now), h('td', { class: 'num' }, ytd));
    const y = s.ytd;
    const ytdDeductions = y.cpp + y.cpp2 + y.ei + y.federalTax + y.albertaTax;
    return h('div', { class: 'class-card', role: 'group', 'aria-label': `Pay stub, month ${s.month}` },
      h('div', { class: 'spread' }, h('strong', {}, s.job.employer), h('span', { class: 'label' }, 'Earnings statement')),
      h('p', { class: 'muted small' }, `Employee: ${s.employee}. Job: ${s.job.title}. Pay period: month ${s.period} of 12, year ${s.year} (world month ${s.month}). Paid monthly.`),
      s.note ? h('p', { class: 'ok' }, s.note) : null,
      h('div', { class: 'table-wrap' }, h('table', {},
        h('thead', {}, h('tr', {}, h('th', {}, ''), h('th', { class: 'num' }, 'This period'), h('th', { class: 'num' }, 'Year to date'))),
        h('tbody', {},
          row(`Regular earnings (${s.job.hours} h at ${fmt(s.job.hourly_cents)})`, fmt(s.gross), fmt(y.gross)),
          row('Canada Pension Plan (CPP)', fmt(s.cpp), fmt(y.cpp)),
          row('CPP second additional (CPP2)', fmt(s.cpp2), fmt(y.cpp2)),
          row('Employment Insurance (EI)', fmt(s.ei), fmt(y.ei)),
          row('Federal income tax', fmt(s.federal_tax), fmt(y.federalTax)),
          row('Alberta income tax', fmt(s.alberta_tax), fmt(y.albertaTax)),
          row('Total deductions', fmt(s.deductions), fmt(ytdDeductions), 'muted'),
          row('Net pay (deposited to chequing)', fmt(s.net), fmt(y.net), 'ok')))));
  }

  el.append(
    h('h2', {}, 'Job Centre'), mine, msg,
    h('p', { class: 'label' }, 'Jobs on the board'), board,
    h('p', { class: 'muted small' }, 'Jobs at student companies (Venture Row) are part-time, on top of your job: up to 2 of them and 40 hours a month in all, each paid from the company\'s treasury with its own pay stub. If a company cannot make payroll you are not paid for those hours that month; you can quit a part-time job at any time.'),
    h('p', { class: 'muted small' }, 'Wages are from the Government of Alberta\'s ALIS wage and salary survey for people starting in each occupation; a note beside a job says when the wage comes from a related profile or is only an illustration.'),
    h('p', { class: 'label' }, 'Pay stubs'), stubList, stubView);
  ctx.onRefresh(() => load().catch(() => {}));
  await load();
}
