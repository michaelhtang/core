import { h, api, fmt, dollarsToCents, guard, confirmAction } from '/ui.js?v=__V__';

// Housing: where you live (rent tiers, deposit, classmates' units for rent), buying a condo (the lender's test shown ratio by ratio), your mortgage
// statement with an amortization chart, renewal and selling, a rental of your own to let to classmates (6b), and a rent-vs-buy calculator. Forms are built once and only the data parts are redrawn, so half-typed
// numbers survive a refresh. SVG is built node by node: data never goes through innerHTML.
const NS = 'http://www.w3.org/2000/svg';
const svg = (tag, attrs = {}, ...kids) => {
  const el = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
  el.append(...kids);
  return el;
};
const pct = (bp) => `${(bp / 100).toFixed(2)}%`;
const ratio = (x) => (x === null || x === undefined ? 'n/a' : `${(x * 100).toFixed(1)}%`);

// The balance owed month by month. rows: [n, interest, principal, balance]; `from` is the first month shown on the x axis.
export function amortChart(rows, from) {
  const W = 360, H = 170, L = 52, R = 8, T = 12, B = 26;
  const chart = svg('svg', { viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': 'Mortgage balance over the amortization', width: '100%' });
  if (!rows.length) { chart.append(svg('text', { x: W / 2, y: H / 2, 'text-anchor': 'middle', fill: 'currentColor' }, 'Nothing left to pay.')); return chart; }
  const top = Math.max(...rows.map((r) => r[3])) || 1, n = rows.length;
  const x = (i) => L + (i / Math.max(1, n - 1)) * (W - L - R), y = (v) => H - B - (v / top) * (H - B - T);
  const points = [`${x(0).toFixed(1)},${y(rows[0][3] + rows[0][2]).toFixed(1)}`, ...rows.map((r, i) => `${x(i).toFixed(1)},${y(r[3]).toFixed(1)}`)].join(' ');
  chart.append(
    svg('line', { x1: L, y1: H - B, x2: W - R, y2: H - B, stroke: 'currentColor', 'stroke-opacity': 0.4 }),
    svg('polyline', { points, fill: 'none', stroke: 'currentColor', 'stroke-width': 2.5, 'stroke-linejoin': 'round' }),
    svg('text', { x: L, y: H - 8, 'font-size': 11, fill: 'currentColor' }, `Month ${from}`),
    svg('text', { x: W - R, y: H - 8, 'font-size': 11, 'text-anchor': 'end', fill: 'currentColor' }, `Month ${from + n - 1}`),
    svg('text', { x: L - 4, y: y(top) + 4, 'font-size': 11, 'text-anchor': 'end', fill: 'currentColor' }, fmt(top).replace(/\.00$/, '')),
    svg('text', { x: L - 4, y: y(0) + 4, 'font-size': 11, 'text-anchor': 'end', fill: 'currentColor' }, '$0'));
  return chart;
}

const row = (label, value, note) => h('tr', {}, h('td', {}, label), h('td', { class: 'num' }, value), h('td', { class: 'muted small' }, note ?? ''));

export async function render(el, ctx) {
  let s = null, m = null;
  const msg = h('p', { role: 'status' });
  const say = (text, bad) => { msg.className = bad ? 'error' : 'ok'; msg.textContent = text; };
  const act = async (path, data, ok) => { try { const r = await api(path, data); if (ok) say(typeof ok === 'function' ? ok(r) : ok); } catch (e) { say(e.message, true); } await load(); };

  const liveBox = h('div', { class: 'stack' }), buyBox = h('div', { class: 'stack' }), homeBox = h('div', { class: 'stack' });
  const down = h('input', { name: 'down', inputmode: 'decimal', placeholder: '10100.00', 'aria-label': 'Down payment (CAD)' });
  const amort = h('select', { 'aria-label': 'Amortization', onchange: () => check() }, h('option', { value: '25' }, '25 years'), h('option', { value: '30' }, '30 years'));
  const verdict = h('div', { class: 'stack' });
  const propSel = h('select', { 'aria-label': 'Which condo', onchange: () => { const p = pick(); if (p) { down.value = (p.min_down_cents / 100).toFixed(2); calcIn.price.value = String(p.price_cents / 100); calcIn.down.value = String(p.min_down_cents / 100); calcIn.fee.value = String(p.condo_fee_cents / 100); calcIn.heat.value = String(p.heating_cents / 100); load(); } } });
  const buyTop = h('div', { class: 'stack' });
  const pick = () => s?.buy?.properties.find((p) => p.id === propSel.value) ?? s?.buy;
  let seeded = false, quoteTimer = null, quoted = '', lastState = '';
  const buyNow = guard(async () => {
    const cents = dollarsToCents(down.value), p = pick();
    if (!cents) return say('Enter your down payment, like 10100', true);
    if (!confirmAction(`Buy ${p.name} for ${fmt(p.price_cents)} with ${fmt(cents)} down? You take on a mortgage, and selling later costs commission and legal fees.`)) return undefined;
    return act('/api/housing/buy', { down_cents: cents, amort_years: Number(amort.value), property: propSel.value || 'average' }, (r) => `You bought it! Your payment is ${fmt(r.payment_cents)} a month, taken from chequing from world month ${r.first_payment_month}.`);
  });
  buyBox.append(
    h('p', { class: 'label' }, 'Buy a condo'),
    h('div', { class: 'row' }, h('label', { class: 'grow' }, 'Which condo', propSel)),
    buyTop,
    h('div', { class: 'row' }, h('label', { class: 'grow' }, 'Down payment (CAD)', down), h('label', {}, 'Amortization', amort),
      h('button', { type: 'button', class: 'ghost', onclick: () => check(true) }, 'Check'),
      h('button', { type: 'button', onclick: buyNow }, 'Buy this condo')),
    verdict);

  // ---- calculator inputs (built once) ----
  const calcFields = [
    ['price', 'Price (CAD)', '202000'], ['down', 'Down payment (CAD)', '10100'], ['rate', 'Mortgage rate (% a year)', '4.20'], ['years', 'Amortization (years)', '25'],
    ['rent', 'Rent you would pay (CAD a month)', '1290'], ['fee', 'Condo fees (CAD a month)', '400'], ['heat', 'Heating (CAD a month)', '60'], ['ins', 'Home insurance (CAD a month)', '35'],
    ['span', 'Compare over (years)', '5'], ['drift', 'Home value change (% a month)', '0.25'], ['invest', 'What savings earn (% a year)', '2.75'],
  ];
  const calcIn = Object.fromEntries(calcFields.map(([key, label, v]) => [key, h('input', { name: `calc-${key}`, inputmode: 'decimal', value: v, 'aria-label': label })]));
  const calcOut = h('div', { class: 'stack', role: 'status' });

  function tenureView() {
    const pending = s.pending_tenure ? s.catalogue.find((c) => c.id === s.pending_tenure) : null;
    const now = s.tenure === 'own' ? null : s.catalogue.find((c) => c.id === s.tenure);
    const u = s.unit, inUnit = u && !u.moving_in;
    const pendingName = pending?.name ?? (u?.moving_in ? `${u.landlord}'s condo` : s.pending_tenure ? 'a shared room' : null);
    return h('div', { class: 'stack' },
      h('p', { class: 'label' }, 'Where you live'),
      s.tenure === 'own' ? h('p', {}, 'You own your condo. To move to a rental, sell it first.')
        : h('p', {}, `You live in: ${inUnit ? `${u.landlord}'s condo (${u.property_name}), ${fmt(u.rent_cents)} a month` : now?.name ?? 'Shared room'}. `, pendingName ? h('strong', {}, `Moving to ${pendingName} from world month ${s.pending_from}.`) : ''),
      inUnit ? unitView(u) : null,
      s.deposit_cents ? h('p', { class: 'small' }, `Damage deposit held for you: ${fmt(s.deposit_cents)}. It is refunded when you move out.`) : null,
      s.tenure === 'own' ? null : h('div', { class: 'table-wrap' }, h('table', {},
        h('thead', {}, h('tr', {}, h('th', {}, 'Place'), h('th', { class: 'num' }, 'Rent a month'), h('th', { class: 'num' }, 'Deposit'), h('th', {}, ''), h('th', {}, 'Source'))),
        h('tbody', {}, s.catalogue.map((c) => h('tr', {}, h('td', {}, c.name), h('td', { class: 'num' }, c.rent_cents ? fmt(c.rent_cents) : 'in Bills'), h('td', { class: 'num' }, c.deposit_cents ? fmt(c.deposit_cents) : 'none'),
          h('td', {}, c.id === s.tenure && !pending ? h('span', { class: 'muted' }, 'You live here')
            : h('button', { type: 'button', class: 'ghost', onclick: () => act('/api/housing/tenure', { tenure: c.id }, (r) => `Done. Your move starts in world month ${r.starts_month}.`) }, 'Move here next month')),
          h('td', { class: 'muted small' }, c.note)))))),
      h('p', { class: 'muted small' }, 'A move takes effect next month. A rental holds one month of your rent as a damage deposit, taken now and refunded when you leave; living with your parents has no deposit. The rent or household contribution replaces the shared-room line in Bills.'));
  }

  // 6b: renting a classmate's unit. Rent leaves chequing at the month tick, before bills; three missed months in a row is an eviction.
  function unitView(u) {
    return h('div', { class: 'stack' },
      h('p', { class: 'small' }, `Your rent goes straight from your chequing to ${u.landlord} at each month tick (it is not a bill). No deposit. Keep at least ${fmt(u.rent_cents)} in chequing.`),
      u.pending_rent_cents ? h('p', { class: 'small' }, `Your landlord changed the rent to ${fmt(u.pending_rent_cents)} from world month ${u.rent_from}.`) : null,
      u.notice_month ? h('p', { class: 'error' }, `Your landlord ended your tenancy: you move to a shared room in world month ${u.notice_month}.`) : null,
      u.arrears_cents ? h('p', { class: 'error' }, `You owe ${fmt(u.arrears_cents)} in unpaid rent (${u.missed_streak} missed in a row; ${u.evict_after} in a row is an eviction). It is paid with your next rent when chequing covers both.`) : null);
  }

  // The rent market: classmates' empty units (same class only), with a Rent button each.
  function marketView() {
    if (!m) return null;
    const owner = s.tenure === 'own' || !!s.rental;
    return h('div', { class: 'stack' },
      h('p', { class: 'label' }, "Classmates' units for rent"),
      !m.listings.length ? h('p', { class: 'muted small' }, 'No classmate has an empty unit listed right now.')
        : h('div', { class: 'table-wrap' }, h('table', {},
          h('thead', {}, h('tr', {}, h('th', {}, 'Landlord'), h('th', {}, 'Place'), h('th', { class: 'num' }, 'Rent a month'), h('th', { class: 'num' }, 'vs the going rent'), h('th', { class: 'num' }, 'Empty for'), h('th', { class: 'num' }, 'Landlord reputation'), h('th', {}, ''))),
          h('tbody', {}, m.listings.map((l) => h('tr', {}, h('td', {}, l.landlord), h('td', {}, l.property_name), h('td', { class: 'num' }, fmt(l.rent_cents)),
            h('td', { class: 'num' }, `${Math.round((100 * l.rent_cents) / l.npc_cents)}% of ${fmt(l.npc_cents)}`), h('td', { class: 'num' }, `${l.months_vacant} mo`), h('td', { class: 'num' }, String(l.reputation)),
            h('td', {}, owner || !s.student_rent ? '' : h('button', { type: 'button', class: 'ghost', 'aria-label': `Rent ${l.landlord}'s condo for ${fmt(l.rent_cents)} a month`, onclick: () => {
              if (!confirmAction(`Rent ${l.landlord}'s condo for ${fmt(l.rent_cents)} a month from next month? The rent leaves your chequing at every month tick. Three missed months in a row is an eviction.`)) return;
              act('/api/housing/tenure', { tenure: l.tenure }, (r) => `Done. You move into ${l.landlord}'s condo in world month ${r.starts_month}.`);
            } }, 'Rent'))))))),
      s.student_rent ? null : h('p', { class: 'small' }, 'Payments between classmates are turned off for your class, so classmates\' units cannot be rented or listed right now.'),
      h('p', { class: 'muted small' }, owner ? 'You own a home, so you cannot rent a classmate\'s unit.' : 'Reputation is the rent months the landlord has been paid on time minus the months missed, this season. No deposit for a classmate\'s unit.'));
  }

  // 6b: your rental. Built once: the rent box keeps what you typed across a refresh; only the facts and the buttons' visibility change.
  const rentIn = h('input', { name: 'rent', inputmode: 'decimal', 'aria-label': 'Monthly rent (CAD)' });
  const llFacts = h('div', { class: 'stack' });
  const rentId = () => s.rental.id;
  const listBtn = h('button', { type: 'button', 'aria-label': 'List your rental for rent', onclick: () => {
    const c = dollarsToCents(rentIn.value);
    if (!c) return say('Enter a rent, like 1290', true);
    if (!confirmAction(`List your rental for ${fmt(c)} a month? Classmates can rent it from next month.`)) return;
    act('/api/housing/list', { home_id: rentId(), rent_cents: c }, 'Listed. Classmates can now rent it.');
  } }, 'List for rent');
  const rentBtn = h('button', { type: 'button', class: 'ghost', 'aria-label': 'Change the rent', onclick: () => {
    const c = dollarsToCents(rentIn.value), l = s.rental.listing;
    if (!c) return say('Enter the new rent, like 1400', true);
    if (!confirmAction(l.tenant ? `Change the rent to ${fmt(c)}? ${l.tenant} gets two months' notice: it applies from world month ${s.month + 2}.` : `Change the asking rent to ${fmt(c)}?`)) return;
    act('/api/housing/rent', { home_id: rentId(), rent_cents: c }, (r) => `The rent is ${fmt(r.rent_cents)} from world month ${r.from_month}.`);
  } }, 'Change rent');
  const unlistBtn = h('button', { type: 'button', class: 'ghost', 'aria-label': 'Take your rental off the market', onclick: () => act('/api/housing/unlist', { home_id: rentId() }, 'Taken off the market.') }, 'Unlist');
  const endBtn = h('button', { type: 'button', class: 'ghost', 'aria-label': 'End the tenancy', onclick: () => {
    const l = s.rental.listing;
    if (!confirmAction(`End ${l.tenant}'s tenancy? They get one month's notice and move to a shared room.`)) return;
    act('/api/housing/end-tenancy', { home_id: rentId() }, (r) => `Notice given: they move out in world month ${r.moves_out_month}.`);
  } }, 'End tenancy');
  const sellRentalBtn = h('button', { type: 'button', class: 'ghost', 'aria-label': 'Sell your rental', onclick: () => {
    const r = s.rental;
    if (!confirmAction(`Sell your rental now? ${r.listing?.tenant ? `${r.listing.tenant}'s tenancy ends today. ` : ''}You would ${r.sale.net_cents >= 0 ? `receive ${fmt(r.sale.net_cents)}` : `pay ${fmt(-r.sale.net_cents)}`} after commission, legal fees and the mortgage.`)) return;
    act('/api/housing/sell', { home_id: rentId() }, (x) => (x.net_cents >= 0 ? `Sold. ${fmt(x.net_cents)} went to chequing.` : `Sold. ${fmt(-x.net_cents)} came out of chequing.`));
  } }, 'Sell my rental');
  const catchRentalBtn = h('button', { type: 'button', 'aria-label': 'Pay the rental mortgage arrears', onclick: () => act('/api/housing/catch-up', { home_id: rentId() }, (r) => `Caught up: ${fmt(r.paid_cents)} paid.`) }, 'Pay the arrears now');
  const landlordBox = h('div', { class: 'stack' }, h('p', { class: 'label' }, 'Your rental'), llFacts,
    h('div', { class: 'row' }, h('label', { class: 'grow' }, 'Rent a month (CAD)', rentIn), listBtn, rentBtn, unlistBtn, endBtn),
    h('div', { class: 'row' }, catchRentalBtn, sellRentalBtn));
  function paintLandlord() {
    landlordBox.hidden = !s.rental;
    if (!s.rental) return;
    const r = s.rental, l = r.listing, b = r.band;
    if (!rentIn.value) rentIn.value = ((l?.rent_cents ?? b.tierCents) / 100).toFixed(2);
    listBtn.hidden = !!l?.listed || !s.student_rent; rentBtn.hidden = !l?.listed; unlistBtn.hidden = !l?.listed || !!l.tenant; endBtn.hidden = !l?.tenant || !!l.notice_month;
    catchRentalBtn.hidden = !r.arrears_cents;
    llFacts.replaceChildren(
      h('div', { class: 'table-wrap' }, h('table', {}, h('tbody', {},
        row('Place', r.property_name), row('Value', fmt(r.value_cents), `bought for ${fmt(r.price_cents)}`), row('Mortgage owed', fmt(r.balance_cents), `${pct(r.rate_bp)}, renews month ${r.renewal_month}`),
        row('Mortgage payment', fmt(r.payment_cents), 'taken from chequing at the month tick, tenant or not'),
        row('Owner costs', fmt(r.costs.propertyTaxCents + r.costs.condoFeeCents + r.costs.heatingCents + r.costs.insuranceCents), 'tax, condo fee, heating and insurance: billed every month, empty or not'),
        row('Rent', l?.listed ? fmt(l.rent_cents) : 'Not listed', l?.pending_rent_cents ? `${fmt(l.pending_rent_cents)} from month ${l.rent_from}` : `the going rent is ${fmt(b.tierCents)}; you may ask ${fmt(b.minCents)} to ${fmt(b.maxCents)}`),
        row('Tenant', l?.tenant ? `${l.tenant}${l.moving_in ? ' (moving in next month)' : ''}` : 'Vacant', l?.notice_month ? `moves out in month ${l.notice_month}` : l && !l.tenant ? `empty for ${l.months_vacant} month${l.months_vacant === 1 ? '' : 's'}` : ''),
        row('Unpaid rent', l?.arrears_cents ? fmt(l.arrears_cents) : '$0.00', l?.missed_streak ? `${l.missed_streak} missed in a row` : ''),
        l?.evictions ? row('Evictions', String(l.evictions), `${fmt(l.written_off_cents)} of rent never received`) : null))),
      r.arrears_cents ? h('p', { class: 'error' }, `You are behind on the rental's mortgage: ${fmt(r.arrears_cents)} in arrears.`) : '');   // replaceChildren would print null
  }

  // 6b: buying a rental. 20% down, no mortgage insurance; the lender counts your home's payment and half the going rent.
  const rProp = h('select', { 'aria-label': 'Which condo to buy as a rental', onchange: () => { const p = rPick(); if (p) rDown.value = (p.min_down_cents / 100).toFixed(2); } });
  const rDown = h('input', { name: 'rental-down', inputmode: 'decimal', 'aria-label': 'Rental down payment (CAD)' });
  const rVerdict = h('div', { class: 'stack' }), rTop = h('div', { class: 'stack' });
  const rPick = () => s?.buy_rental?.properties.find((p) => p.id === rProp.value) ?? s?.buy_rental?.properties[0];
  const rBody = () => ({ down_cents: dollarsToCents(rDown.value), amort_years: 25, property: rProp.value || 'starter', role: 'rental' });
  const rentalBuyBox = h('div', { class: 'stack' }, h('p', { class: 'label' }, 'Buy a rental'), rTop,
    h('div', { class: 'row' }, h('label', { class: 'grow' }, 'Which condo', rProp), h('label', { class: 'grow' }, 'Down payment (CAD)', rDown),
      h('button', { type: 'button', class: 'ghost', 'aria-label': 'Check the rental with the lender', onclick: async () => {
        if (!rBody().down_cents) return say('Enter your down payment, like 30000', true);
        try { rVerdict.replaceChildren(...verdictView(await api('/api/housing/qualify', rBody()))); } catch (e) { say(e.message, true); }
      } }, 'Check'),
      h('button', { type: 'button', 'aria-label': 'Buy this condo as a rental', onclick: guard(async () => {
        const b = rBody(), p = rPick();
        if (!b.down_cents) return say('Enter your down payment, like 30000', true);
        if (!confirmAction(`Buy ${p.name} as a rental for ${fmt(p.price_cents)} with ${fmt(b.down_cents)} down? You pay its mortgage and owner costs every month, rented or empty.`)) return undefined;
        return act('/api/housing/buy', b, (r) => `You bought a rental. Its payment is ${fmt(r.payment_cents)} a month. List it below to find a tenant.`);
      }) }, 'Buy as a rental')),
    rVerdict);
  function paintRentalBuy() {
    rentalBuyBox.hidden = !s.buy_rental;
    if (!s.buy_rental) return;
    if (!rProp.options.length) for (const p of s.buy_rental.properties) rProp.append(h('option', { value: p.id }, `${p.name}: ${fmt(p.price_cents)}`));
    if (!rDown.value) rDown.value = (rPick().min_down_cents / 100).toFixed(2);
    const p = rPick();
    rTop.replaceChildren(h('p', { class: 'small' }, `A second home to rent to classmates. It needs ${s.buy_rental.down_pct}% down (${fmt(p.min_down_cents)}) because mortgage insurance only covers a home you live in. The lender counts your home's mortgage payment as a debt and ${s.buy_rental.rent_income_pct}% of the going rent (${fmt(p.npc_rent_cents)}) as income.`));
  }

  function verdictView(q) {
    const bar = (label, value, max) => h('tr', {}, h('td', {}, label), h('td', { class: 'num' }, ratio(value)), h('td', {}, value !== null && value <= max ? 'OK' : 'Too high'), h('td', { class: 'muted small' }, `limit ${ratio(max)}`));
    return [
      h('div', { class: 'table-wrap' }, h('table', {}, h('tbody', {},
        row('Price', fmt(q.priceCents)), row('Down payment', fmt(q.priceCents - q.loanBeforePremiumCents), `at least ${fmt(q.minDownCents)}`),
        row('Mortgage insurance (CMHC)', q.insured ? fmt(q.premiumCents) : 'none', q.insured ? `${pct(q.premiumBp)} of the loan, added to it` : '20% down or more'),
        row('Mortgage', fmt(q.loanCents), `${pct(q.contractBp)} fixed, ${q.amortMonths / 12} years`), row('Payment each month', fmt(q.paymentCents), 'what you will really pay'),
        row('Closing costs', fmt(q.closingCents), 'legal fees and Alberta Land Titles'), row('Cash you need today', fmt(q.cashNeededCents), 'down payment + closing costs')))),
      q.rateNote ? h('p', { class: 'small' }, q.rateNote) : null,
      h('p', { class: 'label' }, 'The lender\'s test'),
      h('p', { class: 'small' }, `Lenders test you at a higher "stress" rate: ${pct(q.qualifyingBp)} (the greater of your rate + 2% and 5.25%), so a payment at that rate is ${fmt(q.qualifyingPaymentCents)}. Your income is the average of your last 3 months of gross pay: ${fmt(q.grossMonthlyCents)} a month.`),
      h('div', { class: 'table-wrap' }, h('table', {}, h('tbody', {},
        row('Payment at the stress rate', fmt(q.qualifyingPaymentCents)), row('Property tax', fmt(q.propertyTaxCents), '1.03637% a year, billed monthly'),
        row('Heating', fmt(q.heatingCents)), row('Half the condo fee', fmt(q.condoFeeCountedCents), `the fee is ${fmt(q.condoFeeCents)}`), row('Housing costs (for GDS)', fmt(q.gdsCostsCents)),
        row('Your card minimum', fmt(q.otherDebtCents), 'counts toward TDS')))),
      h('div', { class: 'table-wrap' }, h('table', {}, h('tbody', {}, bar('GDS: housing costs ÷ gross income', q.gds, q.gdsMax), bar('TDS: housing costs + card ÷ gross income', q.tds, q.tdsMax)))),
      q.ok ? h('p', { class: 'ok' }, 'You qualify.') : h('div', { class: 'stack' }, h('p', { class: 'error' }, 'You do not qualify yet:'), ...q.reasons.map((r) => h('p', { class: 'small' }, r)),
        q.grossNeededCents ? h('p', { class: 'muted small' }, `At these numbers a lender would want about ${fmt(q.grossNeededCents)} a month of gross income.`) : null),
    ].filter(Boolean);                                       // spread into replaceChildren, which would print a null
  }

  // Asks the lender's test only when its inputs changed (or Check was pressed): not on every refresh.
  async function check(force) {
    if (!s || s.home) return;
    const cents = dollarsToCents(down.value);
    if (cents === null) { quoted = ''; verdict.replaceChildren(h('p', { class: 'muted' }, 'Enter your down payment, like 10100 or 20200.50')); return; }
    const key = [cents, amort.value, propSel.value, s.month, s.buy?.mortgage_bp].join('|');
    if (key === quoted && force !== true) return;
    quoted = key;
    try { verdict.replaceChildren(...verdictView(await api('/api/housing/qualify', { down_cents: cents, amort_years: Number(amort.value), property: propSel.value || 'average' }))); } catch (e) { quoted = ''; say(e.message, true); }
  }

  // The buy form is built once (below) so the condo picker and the down-payment box are never detached (focus and the phone keyboard
  // survive a refresh); only the text above the form is redrawn.
  function paintBuy() {
    buyBox.hidden = !s.buy;
    if (!s.buy) return;
    if (!propSel.options.length) for (const p of s.buy.properties) propSel.append(h('option', { value: p.id }, `${p.name}: ${fmt(p.price_cents)}`));
    const b = pick();
    buyTop.replaceChildren(
      h('p', {}, `${b.name} lists at ${fmt(b.price_cents)}. ${b.note} Condo fee ${fmt(b.condo_fee_cents)} a month${b.heating_cents ? `, heating ${fmt(b.heating_cents)}` : ' (heating included)'}. The least you can put down is ${fmt(b.min_down_cents)} (5% of the first $500,000). Under 20% down, mortgage default insurance is added to your loan. The 5-year fixed rate today is ${pct(b.mortgage_bp)}.`),
      b.quote?.rateNote ? h('p', { class: 'muted small' }, b.quote.rateNote) : '',
      b.first_time ? h('p', { class: 'muted small' }, 'As a first-time buyer with an insured mortgage you may choose a 30-year amortization (lower payment, much more interest, and a 0.20% higher insurance premium).') : '');
  }

  function homeView() {
    const hm = s.home;
    if (!hm) return h('div', {});
    const shock = hm.last_renewal;
    const left = hm.renewal_month - s.month;
    return h('div', { class: 'stack' },
      h('p', { class: 'label' }, `Your condo: ${hm.property_name}`),
      hm.missed_streak > 0 || hm.arrears_cents > 0 ? h('div', { class: 'stack' },
        h('p', { class: 'error' }, `You are behind on your mortgage: ${fmt(hm.arrears_cents)} in arrears (${hm.missed_streak} missed in a row). A missed payment adds interest to your debt, costs a $45 NSF fee and hurts your credit score.`),
        h('div', { class: 'row' }, h('button', { type: 'button', disabled: !hm.arrears_cents, onclick: () => act('/api/housing/catch-up', { home_id: hm.id }, (r) => `Caught up: ${fmt(r.paid_cents)} paid.`) }, 'Pay the arrears now'))) : null,
      h('div', { class: 'table-wrap' }, h('table', {}, h('tbody', {},
        row('Home value', fmt(hm.value_cents), `bought for ${fmt(hm.price_cents)}; the market moves it`), row('You owe', fmt(hm.balance_cents), `borrowed ${fmt(hm.original_loan_cents)} including ${fmt(hm.premium_cents)} insurance`),
        row('Equity', fmt(hm.equity_cents), 'value minus what you owe'), row('Rate', pct(hm.rate_bp), 'fixed for the term; compounds twice a year'),
        row('Payment each month', fmt(hm.payment_cents), 'taken from chequing at the month tick, before bills'),
        row('Next payment: interest', fmt(hm.next_interest_cents)), row('Next payment: principal', fmt(hm.next_principal_cents), 'the part that lowers what you owe'),
        row('Years left to pay it off', (hm.amort_left / 12).toFixed(1)),
        row('Renewal', `month ${hm.renewal_month}`, left > 0 ? `in ${left} month${left === 1 ? '' : 's'}: the rate then is the 5-year fixed rate (now ${pct(s.mortgage_bp)})` : 'this month')))),
      shock ? h('p', { class: 'small' }, `Last renewal (month ${shock.month}): the rate went from ${pct(shock.old_bp)} to ${pct(shock.new_bp)} and your payment from ${fmt(shock.old_payment)} to ${fmt(shock.new_payment)}.`) : null,
      h('p', { class: 'label' }, 'What you owe over time'), amortChart(hm.schedule, s.month + 1),
      hm.payments.length ? h('div', { class: 'table-wrap' }, h('table', {},
        h('thead', {}, h('tr', {}, h('th', {}, 'Month'), h('th', { class: 'num' }, 'Interest'), h('th', { class: 'num' }, 'Principal'), h('th', { class: 'num' }, 'You owe after'), h('th', {}, ''))),
        h('tbody', {}, hm.payments.map((p) => h('tr', {}, h('td', {}, `Month ${p.month}`), h('td', { class: 'num' }, fmt(p.interest_cents)), h('td', { class: 'num' }, fmt(p.principal_cents)), h('td', { class: 'num' }, fmt(p.balance_cents)), h('td', {}, p.status === 'missed' ? 'Missed' : ''))))) ) : h('p', { class: 'muted small' }, 'Your first payment comes at the next month tick.'),
      h('p', { class: 'label' }, 'Sell'),
      h('p', { class: 'small' }, `Selling today: value ${fmt(hm.sale.value_cents)} minus ${hm.sale.commission_pct}% commission (${fmt(hm.sale.commission_cents)}) and legal fees (${fmt(hm.sale.legal_cents)}), then the mortgage (${fmt(hm.sale.debt_cents)}) is paid out: ${hm.sale.net_cents >= 0 ? `you receive ${fmt(hm.sale.net_cents)}` : `you would have to pay ${fmt(-hm.sale.net_cents)} out of chequing, because the sale does not cover the mortgage`}.`),
      h('div', { class: 'row' }, h('button', { type: 'button', class: 'ghost', onclick: () => { if (confirmAction('Sell your condo now?')) act('/api/housing/sell', { home_id: hm.id }, (r) => (r.net_cents >= 0 ? `Sold. ${fmt(r.net_cents)} went to chequing.` : `Sold. ${fmt(-r.net_cents)} came out of chequing to clear the mortgage.`)); } }, 'Sell my condo')));
  }

  async function load() {
    [s, m] = await Promise.all([api('/api/housing/state'), api('/api/housing/market').catch(() => null)]);
    const key = JSON.stringify([s, m]);
    if (key === lastState) return;                          // nothing changed: leave the page alone
    lastState = key;
    liveBox.replaceChildren(tenureView(), marketView() ?? '');
    paintBuy();
    homeBox.replaceChildren(homeView());
    paintLandlord();
    paintRentalBuy();
    if (s.buy && !seeded) { seeded = true; down.value = (s.buy.min_down_cents / 100).toFixed(2); calcIn.price.value = String(s.buy.price_cents / 100); calcIn.down.value = String(s.buy.min_down_cents / 100); calcIn.rate.value = (s.buy.mortgage_bp / 100).toFixed(2); calcIn.heat.value = String(s.buy.heating_cents / 100); calcIn.fee.value = String(s.buy.condo_fee_cents / 100); calcIn.ins.value = String(s.buy.insurance_cents / 100); }
    if (s.buy) { clearTimeout(quoteTimer); quoteTimer = setTimeout(check, 0); }
  }

  async function calc() {
    const n = (k) => Number(calcIn[k].value);
    const body = {
      price_cents: dollarsToCents(calcIn.price.value), down_cents: dollarsToCents(calcIn.down.value), rate_bp: Math.round(n('rate') * 100), amort_years: Math.round(n('years')),
      rent_cents: dollarsToCents(calcIn.rent.value), condo_fee_cents: dollarsToCents(calcIn.fee.value), heating_cents: dollarsToCents(calcIn.heat.value), insurance_cents: dollarsToCents(calcIn.ins.value),
      years: Math.round(n('span')), drift_bp: Math.round(n('drift') * 100), invest_bp: Math.round(n('invest') * 100),
    };
    if (Object.values(body).some((v) => v === null || !Number.isFinite(v))) return say('Fill every box with a number, like 202000 or 4.20', true);
    try {
      const r = await api('/api/housing/calc', body);
      calcOut.replaceChildren(
        h('div', { class: 'table-wrap' }, h('table', {},
          h('thead', {}, h('tr', {}, h('th', {}, ''), h('th', { class: 'num' }, 'Rent'), h('th', { class: 'num' }, 'Buy'))),
          h('tbody', {},
            h('tr', {}, h('td', {}, 'Per month'), h('td', { class: 'num' }, fmt(r.monthlyRentCents)), h('td', { class: 'num' }, fmt(r.monthlyOwnCents))),
            h('tr', {}, h('td', {}, `Spent over ${r.months / 12} years`), h('td', { class: 'num' }, fmt(r.rentSpentCents)), h('td', { class: 'num' }, fmt(r.ownSpentCents))),
            h('tr', {}, h('td', {}, 'What you have at the end'), h('td', { class: 'num' }, fmt(r.renterWealthCents)), h('td', { class: 'num' }, fmt(r.buyerWealthCents)))))),
        h('p', {}, r.cheaper === 'same' ? 'A tie.' : r.cheaper === 'buy' ? 'Buying comes out ahead on these numbers.' : 'Renting and investing comes out ahead on these numbers.'),
        h('p', { class: 'muted small' }, `Buying: the mortgage is ${fmt(r.loanCents)} (${fmt(r.premiumCents)} of it insurance) at ${fmt(r.paymentCents)} a month, and you pay ${fmt(r.upfrontCents)} up front. At the end the home is worth ${fmt(r.homeValueCents)}; selling costs ${fmt(r.saleCostsCents)} and the mortgage is ${fmt(r.balanceCents)}, so your equity is ${fmt(r.equityCents)}. Renting: you invest the same up-front money and every month whatever owning would cost beyond the rent.`),
        h('p', { class: 'error small' }, r.down_ok ? '' : `That down payment is under the minimum for this price (${fmt(r.min_down_cents)}): a lender would not allow it.`));
    } catch (e) { say(e.message, true); }
  }

  el.append(
    h('h2', {}, 'Housing'), liveBox, msg, buyBox, homeBox, landlordBox, rentalBuyBox,
    h('p', { class: 'label' }, 'Rent or buy? A calculator'),
    h('p', { class: 'muted small' }, 'Same budget both ways: the renter invests the down payment and the extra monthly cost. Change any number.'),
    h('div', { class: 'stack' }, ...calcFields.map(([key, label]) => h('label', {}, label, calcIn[key])), h('div', { class: 'row' }, h('button', { type: 'button', onclick: calc }, 'Compare'))),
    calcOut);
  ctx.onRefresh(() => load().catch(() => {}));
  await load();
}
