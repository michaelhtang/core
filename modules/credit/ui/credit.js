import { h, api, fmt, dollarsToCents, guard } from '/ui.js?v=__V__';

// Credit Bureau: your score (a dial), why it is what it is (five factors with tips), the card (apply, statement, pay, autopay)
// and the payoff calculator. Forms are built once; only the data parts are redrawn, so a half-typed amount survives a refresh.
const NS = 'http://www.w3.org/2000/svg';
const svg = (tag, attrs = {}, ...kids) => {   // SVG built node by node: data never goes through innerHTML
  const el = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
  el.append(...kids);
  return el;
};
const pct = (bp) => `${(bp / 100).toFixed(2)}%`;
const MIN = 300, MAX = 900;

// A half-circle dial from 300 to 900. score === null draws the empty track and "No credit history yet".
export function dial(score, band) {
  const W = 260, H = 160, cx = 130, cy = 135, r = 100;
  const at = (s) => { const a = Math.PI * (1 - (s - MIN) / (MAX - MIN)); return [cx + r * Math.cos(a), cy - r * Math.sin(a)]; };
  const arc = (from, to) => { const [x0, y0] = at(from), [x1, y1] = at(to); return `M${x0.toFixed(1)} ${y0.toFixed(1)} A${r} ${r} 0 0 1 ${x1.toFixed(1)} ${y1.toFixed(1)}`; };
  const d = svg('svg', { viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': score === null ? 'Credit score: no credit history yet' : `Credit score ${score}, ${band}`, width: '100%', class: 'credit-dial' });
  d.append(svg('path', { d: arc(MIN, MAX), fill: 'none', stroke: 'currentColor', 'stroke-opacity': 0.2, 'stroke-width': 16, 'stroke-linecap': 'round' }));
  if (score !== null) {
    d.append(svg('path', { d: arc(MIN, Math.max(MIN + 1, score)), fill: 'none', stroke: 'currentColor', 'stroke-width': 16, 'stroke-linecap': 'round' }));
    d.append(svg('text', { x: cx, y: cy - 28, 'text-anchor': 'middle', 'font-size': 44, 'font-weight': 700, fill: 'currentColor' }, String(score)));
    d.append(svg('text', { x: cx, y: cy - 6, 'text-anchor': 'middle', 'font-size': 14, fill: 'currentColor' }, band));
  } else {
    d.append(svg('text', { x: cx, y: cy - 14, 'text-anchor': 'middle', 'font-size': 15, fill: 'currentColor' }, 'No credit history yet'));
  }
  d.append(svg('text', { x: cx - r, y: H - 2, 'text-anchor': 'middle', 'font-size': 11, fill: 'currentColor' }, String(MIN)),
    svg('text', { x: cx + r, y: H - 2, 'text-anchor': 'middle', 'font-size': 11, fill: 'currentColor' }, String(MAX)));
  return d;
}

export async function render(el, ctx) {
  let s = null;
  const msg = h('p', { role: 'status' });
  const say = (text, bad) => { msg.className = bad ? 'error' : 'ok'; msg.textContent = text; };
  const act = async (path, data, ok) => { try { const r = await api(path, data); if (ok) say(typeof ok === 'function' ? ok(r) : ok); } catch (e) { say(e.message, true); } await load(); };
  const dialBox = h('div', {}), factors = h('div', { class: 'stack' }), cardInfo = h('div', { class: 'stack' }), history = h('div', { class: 'table-wrap' });
  const payAmount = h('input', { name: 'pay', inputmode: 'decimal', placeholder: '0.00', 'aria-label': 'Amount to pay on the card (CAD)' });
  // The pay row and the autopay row are built once and only updated in place, so the amount box keeps focus (and the phone keyboard) through a refresh.
  const payLabel = h('p', { class: 'label' });
  const minBtn = h('button', { type: 'button', onclick: guard(() => act('/api/credit/pay', { mode: 'min' }, (r) => `Paid ${fmt(r.paid_cents)}.`)) }, 'Pay minimum');
  const fullBtn = h('button', { type: 'button', onclick: guard(() => act('/api/credit/pay', { mode: 'full' }, (r) => `Paid ${fmt(r.paid_cents)}.`)) }, 'Pay in full');
  const payBtn = h('button', { class: 'ghost', type: 'button', onclick: guard(() => {
    const cents = dollarsToCents(payAmount.value);
    if (!cents) return say('Enter an amount like 25 or 12.50', true);
    payAmount.value = '';
    return act('/api/credit/pay', { mode: 'amount', cents }, (r) => `Paid ${fmt(r.paid_cents)}.`);
  }) }, 'Pay');
  const autopay = h('select', { 'aria-label': 'Card autopay', onchange: async (ev) => {
      const mode = ev.target.value;
      try { await act('/api/credit/autopay', { mode }, mode === 'off' ? 'Card autopay is off.' : `Autopay will pay the ${mode === 'min' ? 'minimum' : 'full statement'} each month.`); }
      finally { if (s?.card) autopay.value = s.card.autopay; }   // a refused change must not leave the rejected choice showing
    } },
    h('option', { value: 'off' }, 'Off'), h('option', { value: 'min' }, 'Pay the minimum'), h('option', { value: 'full' }, 'Pay the full statement'));
  const payBox = h('div', { class: 'stack', hidden: true }, payLabel,
    h('div', { class: 'row' }, minBtn, fullBtn, h('label', { class: 'grow' }, 'Another amount (CAD)', payAmount), payBtn),
    h('div', { class: 'row' }, h('label', {}, 'Autopay (runs at the month tick, before lateness is judged)', autopay)));
  const cardBox = h('div', { class: 'stack' }, cardInfo, payBox);
  let lastKey = '';
  const calcBalance = h('input', { name: 'calc-balance', inputmode: 'decimal', placeholder: '1000.00', 'aria-label': 'Balance (CAD)' });
  const calcApr = h('input', { name: 'calc-apr', inputmode: 'decimal', placeholder: '20.99', 'aria-label': 'Interest rate (percent a year)' });
  const calcOut = h('p', { class: 'muted', role: 'status' });
  let calcSeeded = false;

  function factorRow(f) {
    const track = h('div', { role: 'img', 'aria-label': `${f.label}: ${f.points} of ${f.maxPoints} points` });
    Object.assign(track.style, { height: '10px', borderRadius: '5px', background: 'var(--line, rgba(128,128,128,.25))', overflow: 'hidden' });
    const fill = h('div', {});
    Object.assign(fill.style, { height: '100%', width: `${Math.round(f.sub * 100)}%`, background: 'var(--ice, currentColor)' });
    track.append(fill);
    return h('div', { class: 'stack' },
      h('div', { class: 'spread' }, h('strong', {}, `${f.label} (${Math.round(f.weight * 100)}%)`), h('span', { class: 'num' }, `${f.points} / ${f.maxPoints} points`)),
      track, h('p', { class: 'small' }, f.detail), h('p', { class: 'muted small' }, `Tip: ${f.tip}`));
  }

  function cardView() {
    payBox.hidden = !s.card;
    if (!s.card) {
      const a = s.apply, last = a.last;
      return h('div', { class: 'stack' },
        h('p', { class: 'label' }, 'Credit card'),
        h('p', {}, `A starter card has a limit from ${fmt(a.limit_range[0])} to ${fmt(a.limit_range[1])}, set by your pay over the last 3 months and your score. Your pay averages ${fmt(a.avg_gross_cents)} a month before deductions; the card needs ${fmt(a.min_avg_gross_cents)}.`),
        h('p', { class: 'muted small' }, 'Applying leaves one hard inquiry on your file whether or not you are approved. It fades after 12 months.'),
        last && !last.approved ? h('div', { class: 'stack' }, h('p', { class: 'error' }, `Declined in month ${last.month}:`), ...last.reasons.map((r) => h('p', { class: 'small' }, r))) : null,
        h('div', { class: 'row' }, h('button', { type: 'button', onclick: guard(() => act('/api/credit/apply', {}, (r) => (r.approved ? `Approved! Your limit is ${fmt(r.limit_cents)}.` : 'Declined. The reasons are below.'))) }, 'Apply for a card')));
    }
    const c = s.card, st = c.statement;
    payLabel.textContent = `Pay from chequing (you have ${fmt(s.chequing_cents)})`;
    minBtn.disabled = !st || !st.minimum_left_cents;
    fullBtn.disabled = !c.owed_cents;
    autopay.value = c.autopay;
    return h('div', { class: 'stack' },
      h('p', { class: 'label' }, 'Your card'),
      h('table', {}, h('tbody', {},
        h('tr', {}, h('td', {}, 'You owe'), h('td', { class: 'num' }, fmt(c.owed_cents))),
        h('tr', {}, h('td', {}, 'Limit'), h('td', { class: 'num' }, fmt(c.limit_cents))),
        h('tr', {}, h('td', {}, 'Available'), h('td', { class: 'num' }, fmt(c.available_cents))),
        h('tr', {}, h('td', {}, 'Using'), h('td', { class: 'num' }, `${Math.round(c.utilization * 100)}% of your limit`)),
        h('tr', {}, h('td', {}, 'Interest rate'), h('td', { class: 'num' }, `${pct(c.apr_bp)} a year`)))),
      st ? h('div', { class: 'stack' },
        h('p', { class: 'label' }, `Statement (month ${st.month})`),
        h('p', {}, `Statement balance ${fmt(st.balance_cents)}. Minimum payment ${fmt(st.minimum_cents)}, due by month ${st.due_month}. Paid so far: ${fmt(st.paid_cents)}${st.refund_cents ? `, store refunds ${fmt(st.refund_cents)}` : ''}.`),
        h('p', { class: 'muted small' }, `Miss the minimum and you pay a ${fmt(c.late_fee_cents)} late fee and get a late mark. Pay less than the full statement and you pay interest on all of it.`))
        : h('p', { class: 'muted' }, 'No statement yet. One is issued each month if you owe anything.'));
  }

  async function load() {
    s = await api('/api/credit/state');
    const key = JSON.stringify(s);
    if (key === lastKey) return;                            // nothing changed: leave the page alone
    lastKey = key;
    dialBox.replaceChildren(dial(s.score?.score ?? null, s.score?.band),
      s.score && s.score.previous !== null ? h('p', { class: 'muted small' }, s.score.score === s.score.previous ? `Unchanged from last month (${s.score.previous}).` : `${s.score.score > s.score.previous ? 'Up' : 'Down'} ${Math.abs(s.score.score - s.score.previous)} since last month (was ${s.score.previous}).`) : '',
      s.score ? '' : h('p', { class: 'muted' }, s.no_file_message));
    factors.replaceChildren(...(s.score ? [h('p', { class: 'label' }, 'Why your score is what it is'), ...s.score.factors.map(factorRow)] : []));
    cardInfo.replaceChildren(cardView());
    history.replaceChildren(s.card?.statements.length ? h('table', {},
      h('thead', {}, h('tr', {}, h('th', {}, 'Statement'), h('th', { class: 'num' }, 'Balance'), h('th', { class: 'num' }, 'Minimum'), h('th', { class: 'num' }, 'Paid + refunds'), h('th', { class: 'num' }, 'Interest'), h('th', { class: 'num' }, 'Late fee'))),
      h('tbody', {}, s.card.statements.map((t) => h('tr', {}, h('td', {}, `Month ${t.month}`), h('td', { class: 'num' }, fmt(t.balance_cents)), h('td', { class: 'num' }, fmt(t.minimum_cents)),
        h('td', { class: 'num' }, fmt(t.paid_cents + (t.refund_cents ?? 0))), h('td', { class: 'num' }, fmt(t.interest_cents)), h('td', { class: 'num' }, fmt(t.fee_cents)))))) : h('p', { class: 'muted small' }, ''));
    if (!calcSeeded) { calcSeeded = true; calcBalance.value = ((s.card?.owed_cents || 100000) / 100).toFixed(2); calcApr.value = (s.default_apr_bp / 100).toFixed(2); }
  }

  async function calc() {
    const balance = dollarsToCents(calcBalance.value), apr = Math.round(Number(calcApr.value) * 100);
    if (!balance || !Number.isFinite(apr) || apr < 0 || apr > 10000) return say('Enter a balance like 1000 and a rate like 20.99', true);
    try {
      const r = await api('/api/credit/payoff', { balance_cents: balance, apr_bp: apr });
      calcOut.textContent = r.months === null
        ? `At the minimum payment alone you would never pay this off: interest grows as fast as the minimum shrinks it.`
        : `Paying only the minimum, ${fmt(balance)} at ${pct(apr)} takes ${r.months} months (${(r.months / 12).toFixed(1)} years) and costs ${fmt(r.totalInterestCents)} in interest. You pay back ${fmt(r.totalPaidCents)} in total. Your first minimum is ${fmt(r.first_minimum_cents)}.`;
    } catch (e) { say(e.message, true); }
  }

  el.append(
    h('h2', {}, 'Credit Bureau'),
    h('p', { class: 'label' }, 'Your credit score'), dialBox, factors,
    cardBox, msg, history,
    h('p', { class: 'label' }, 'Payoff calculator'),
    h('p', { class: 'muted small' }, 'What if you only ever paid the minimum and never charged anything else?'),
    h('div', { class: 'row' }, h('label', { class: 'grow' }, 'Balance (CAD)', calcBalance), h('label', {}, 'Rate (% a year)', calcApr), h('button', { type: 'button', onclick: calc }, 'Calculate')),
    calcOut);
  ctx.onRefresh(() => load().catch(() => {}));
  await load();
}
