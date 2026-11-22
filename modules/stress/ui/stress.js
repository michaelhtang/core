import { h, api, fmt, guard, confirmAction } from '/ui.js?v=__V__';

// The Stress home card (the homeCards hook): the score and level, what moved it at the last world month, the emergency loan if there is one,
// and the button to ask for one from a score of 50. Built from h() and textContent only.
const pct = (bp) => `${(bp / 100).toFixed(2)}%`;

export function renderCard(el, ctx) {
  const msg = h('p', { role: 'status' });
  let data = ctx.card.data;

  function paint() {
    const d = data, loan = d.loan;
    el.replaceChildren(...[
      h('div', { class: 'spread' }, h('b', {}, `${d.score} · ${d.level}`), h('span', { class: 'muted small' }, 'Stress runs from 0 (calm) to 100 (crisis)')),
      h('meter', { min: '0', max: '100', low: '25', high: '50', optimum: '0', value: String(d.score), 'aria-label': `Stress ${d.score} out of 100, ${d.level}` }),
      d.why.length ? h('div', {}, h('p', { class: 'label' }, d.month == null ? 'Last month' : `World month ${d.month}`),
        h('ul', { class: 'small' }, d.why.map((x) => h('li', {}, `${x.points > 0 ? '+' : '−'}${Math.abs(x.points)}: ${x.text}`)))) : null,
      loan ? h('p', {}, h('b', {}, 'Emergency loan: '), `${fmt(loan.left_cents)} left, ${fmt(loan.payment_cents)}/month, ${pct(loan.apr_bp)}. Payment ${loan.paid} of ${loan.of}${loan.missed ? `; ${loan.missed} missed (each adds that month's interest and a fee)` : ''}.`)
        : h('p', { class: 'muted small' }, `At ${d.auto_at} the bank lends you ${fmt(d.offer_cents)} automatically, at ${pct(d.apr_bp)} over ${d.term} months. Paying bills on time and keeping a job brings stress down.`),
      d.can_ask ? h('button', { type: 'button', 'aria-label': `Ask for an emergency loan of ${fmt(d.offer_cents)}`, onclick: guard(async () => {
        if (!confirmAction(`Borrow ${fmt(d.offer_cents)} at ${pct(d.apr_bp)}, paid back over ${d.term} months?`)) return;
        try { data = await api('/api/stress/loan', {}); paint(); msg.className = 'ok'; msg.textContent = 'Loan paid into chequing. Payments start next month.'; }
        catch (e) { msg.className = 'error'; msg.textContent = e.message; }
      }) }, 'Ask for an emergency loan') : null,
      msg].filter(Boolean));
  }
  paint();
  ctx.onRefresh(() => { data = ctx.card.data; paint(); });
}
