import { h, api, fmt, guard, dollarsToCents } from '/ui.js?v=__V__';

// The Retirement building (docs/phase5-life.md 5c): when CPP and OAS start (sliders with the amount live), the RRSP -> RRIF switch, the draw plan
// (a monthly amount and the order of accounts), and the live check: retirement income against your bills, and how long your savings last.
const pct = (bp) => `${(bp / 100).toFixed(1)}%`;

export async function render(el, ctx) {
  const msg = h('p', { role: 'status' });
  const say = (text, bad) => { msg.className = bad ? 'error' : 'ok'; msg.textContent = text; };
  const box = h('div', { class: 'stack' });
  const post = (path, body, ok) => guard(async () => { try { await api(path, body()); say(ok); await load(); } catch (e) { say(e.message, true); } });   // body() is read at the click

  // A start-age slider: the amount follows it as it moves (the factor per month before or after 65), then Save.
  function startAge(which, p, label, factorBp) {
    if (p.started) return h('p', {}, `Your ${label} started at ${p.age}: ${fmt(p.monthly_cents)} a month, rising with prices.`);
    const out = h('output', {}, '');
    const slider = h('input', { type: 'range', min: String(p.min), max: String(p.max), step: '1', value: String(Math.max(p.min, p.age)), 'aria-label': `${label} start age` });
    const show = () => { const a = Number(slider.value); out.textContent = `Start at ${a}: about ${fmt(Math.round((p.at65_cents * factorBp(a)) / 10000))} a month (today's prices)`; };
    slider.addEventListener('input', show);
    show();
    return h('div', { class: 'stack' },
      h('p', {}, p.set ? `You chose ${p.age}.` : `You have not chosen, so it starts at ${p.age}.`),
      slider, out,
      h('button', { type: 'button', onclick: post(`/api/retirement/${which}`, () => ({ age: Number(slider.value) }), `${label} start age saved.`) }, `Save ${label} age`));
  }

  function planEditor(v) {
    const p = v.plan;
    let order = [...p.order];
    const amount = h('input', { type: 'text', inputmode: 'decimal', value: (p.monthly_cents / 100).toFixed(2), 'aria-label': 'Monthly draw in dollars' });
    const list = h('ol', {});
    const paint = () => list.replaceChildren(...order.map((a, i) => h('li', { class: 'row' }, h('span', {}, p.labels[a]),
      h('button', { type: 'button', disabled: i === 0, 'aria-label': `Move ${p.labels[a]} up`, onclick: () => { [order[i - 1], order[i]] = [order[i], order[i - 1]]; paint(); } }, 'Up'),
      h('button', { type: 'button', disabled: i === order.length - 1, 'aria-label': `Move ${p.labels[a]} down`, onclick: () => { [order[i + 1], order[i]] = [order[i], order[i + 1]]; paint(); } }, 'Down'))));
    paint();
    const save = guard(async () => {
      const cents = dollarsToCents(amount.value);
      if (cents === null) { say('Enter a dollar amount, like 1500 or 1500.00', true); return; }
      try { await api('/api/retirement/plan', { monthly_cents: cents, order }); say('Draw plan saved.'); await load(); } catch (e) { say(e.message, true); }
    });
    return h('div', { class: 'stack' },
      h('p', { class: 'muted small' }, 'Once you retire, this amount moves to chequing each payday, taken from the accounts in this order (each until it runs out). Holdings are sold at the bid when an account\'s cash runs short. RRSP/RRIF draws are taxed (tax is held back now and settled at year end); TFSA draws are not. A GIC pays out on its own when it matures.'),
      h('label', {}, 'Each month ', amount), list,
      h('button', { type: 'button', onclick: save }, 'Save draw plan'),
      p.rrif ? h('p', {}, `Your RRSP is a RRIF: at least ${fmt(v.check?.rrif_min_cents ?? 0)} comes out this month (its value / (90 - your age), a twelfth a month).`)
        : p.can_convert ? h('div', { class: 'stack' }, h('p', { class: 'muted small' }, 'A RRIF must pay you a minimum each year (1 / (90 - age) of its value). In real life the RRSP must become a RRIF by the end of the year you turn 71.'),
          h('button', { type: 'button', onclick: post('/api/retirement/rrif', () => ({}), 'Your RRSP is now a RRIF.') }, 'Convert my RRSP to a RRIF'))
          : h('p', { class: 'muted small' }, `You can convert your RRSP to a RRIF from age ${p.rrif_from_age}.`));
  }

  function checkCard(v) {
    const c = v.check;
    if (!c) return h('p', { class: 'muted' }, `The retirement check opens at age ${v.open_age}.`);
    const row = (label, cents) => h('tr', {}, h('td', {}, label), h('td', { class: 'num' }, fmt(cents)));
    return h('div', { class: 'stack' },
      h('p', {}, h('strong', { class: c.covered ? 'ok' : 'error' }, c.covered ? 'Covered' : `Short by ${fmt(c.shortfall_cents)} a month`),
        ` (${c.coverage_pct}% of your bills)${v.retired ? '' : ', if you were retired today with your plan'}.`),
      h('div', { class: 'table-wrap' }, h('table', {}, h('tbody', {},
        row('CPP + OAS', c.pension_cents), row('Draws', c.draw_cents), row('Tax (estimate)', -c.tax_cents), row('Income after tax', c.income_cents), row('Your bills this month', c.bills_cents)))),
      h('p', {}, c.lasts_until_age >= 100 ? 'Your savings last past age 100 on this plan.' : `Your savings last until age ${c.lasts_until_age}.`,
        c.lasts_until_age < c.short_before ? h('span', { class: 'error' }, ` That is before ${c.short_before}.`) : ''),
      h('p', { class: 'muted small' }, `A projection, not a promise: your balances now, your plan (or what your bills need beyond your pensions, if more), prices rising ${pct(v.inflation_bp)} a year, and each account growing at its own expected rate. No market luck either way.`));
  }

  async function load() {
    const v = await api('/api/retirement/state');
    const hist = v.history.length ? h('div', { class: 'table-wrap' }, h('table', {},
      h('thead', {}, h('tr', {}, h('th', {}, 'Month'), h('th', { class: 'num' }, 'CPP'), h('th', { class: 'num' }, 'OAS'), h('th', { class: 'num' }, 'Draws'), h('th', { class: 'num' }, 'Tax held'), h('th', { class: 'num' }, 'Short'))),
      h('tbody', {}, v.history.map((r) => h('tr', {}, h('td', {}, String(r.month)), h('td', { class: 'num' }, fmt(r.cpp_cents)), h('td', { class: 'num' }, fmt(r.oas_cents)),
        h('td', { class: 'num' }, fmt(r.draw_cents)), h('td', { class: 'num' }, fmt(r.withheld_cents + r.draw_withheld_cents)), h('td', { class: 'num' }, [r.short_cents ? fmt(r.short_cents) : '', r.note ? ` (${r.note})` : ''].join(''))))))) : null;
    box.replaceChildren(
      h('p', {}, h('strong', {}, `Age ${v.age} · Stage ${v.stage}`), v.retired ? ` · retired (at ${v.retire_age})` : ` · retiring at ${v.retire_age}`),
      h('div', { class: 'class-card' }, h('b', {}, 'Is my retirement covered?'), checkCard(v)),
      h('div', { class: 'class-card' }, h('b', {}, 'CPP (Canada Pension Plan)'),
        h('p', { class: 'muted small' }, `From your own pay stubs: ${(v.cpp.contributed_years_bp / 10000).toFixed(1)} years of full contributions out of ${v.cpp.full_years} for the maximum (${fmt(v.cpp.max_65_cents)} a month at 65). Each month before 65 takes off ${pct(v.cpp.early_bp)}; each month after adds ${pct(v.cpp.late_bp)}.`),
        startAge('cpp', v.cpp, 'CPP', (a) => 10000 + (a < 65 ? -v.cpp.early_bp : v.cpp.late_bp) * 12 * Math.abs(a - 65))),
      h('div', { class: 'class-card' }, h('b', {}, 'OAS (Old Age Security)'),
        h('p', { class: 'muted small' }, `From 65, or later for more: ${pct(v.oas.late_bp)} for each month you wait, up to 70. Paid back (15% of income above a threshold) when your income is high.`),
        startAge('oas', v.oas, 'OAS', (a) => 10000 + v.oas.late_bp * 12 * Math.max(0, a - 65))),
      v.open ? h('div', { class: 'class-card' }, h('b', {}, 'Draw plan'), planEditor(v)) : '',
      hist ? h('div', { class: 'class-card' }, h('b', {}, 'Retirement income so far'), hist) : '',
    );
  }

  el.append(h('h2', {}, 'Retirement'), box, msg);
  ctx?.onRefresh?.(() => load().catch(() => {}));
  await load();
}
