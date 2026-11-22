import { h, api, fmt, confirmAction } from '/ui.js?v=__V__';

// Teacher panel for the Exchange: per class, what students hold by asset type, the most-held tickers, TFSA and RRSP use and trades this month; and the world teacher's controls:
// pause trading, queue a market event (it lands at the next tick, with a headline), undo one trade at its original price.
const units = (micro) => (micro / 1e6).toFixed(4).replace(/\.?0+$/, '');
// What each event does, for the confirm. The stock events name the company.
const effects = { crash: 'stocks fall 25% and bonds 5%, and the stocks and index fund pause for the month', correction: 'stocks fall 10%', rally: 'stocks rise 10%', scandal: (s) => `${s} falls 35%`, boom: (s) => `${s} rises 25%` };
const kinds = { crash: 'Crash (-25% stocks, -5% bonds)', correction: 'Correction (-10% stocks)', rally: 'Rally (+10% stocks)', scandal: 'Company scandal (-35% one stock)', boom: 'Company boom (+25% one stock)' };

export async function render(el, ctx) {
  const msg = h('p', { role: 'status' });
  const say = (text, bad) => { msg.className = bad ? 'error' : 'ok'; msg.textContent = text; };
  const controls = h('div', { class: 'stack' }), box = h('div', { class: 'stack' }), log = h('div', { class: 'stack' });
  const run = async (path, body, ok) => { try { await api(path, body); say(ok); } catch (e) { say(e.message, true); } await load(); };
  const kindSel = h('select', { 'aria-label': 'Market event' }, Object.entries(kinds).map(([k, l]) => h('option', { value: k }, l)));
  const tickerSel = h('select', { 'aria-label': 'Company' });
  let v = null, shown = '';

  function controlsView() {
    if (!v.can_control) return [h('p', { class: 'label' }, 'Market controls'), h('p', { class: 'muted small' }, 'Only the world teacher can pause trading, trigger market events or undo a trade. You can see everything your classes hold below.')];
    const stockEvent = () => kindSel.value === 'scandal' || kindSel.value === 'boom';
    return [
      h('p', { class: 'label' }, 'Market controls (whole town)'),
      h('div', { class: 'row' },
        h('button', { type: 'button', class: v.frozen ? 'danger' : 'ghost', onclick: () => run('/api/exchange/freeze', { frozen: !v.frozen }, v.frozen ? 'Trading is open again.' : 'Trading is paused for every class. Prices still move at the next tick.') }, v.frozen ? 'Trading is PAUSED: resume' : 'Pause trading')),
      h('div', { class: 'row' }, h('label', {}, 'Market event', kindSel), h('label', {}, 'Company (for scandal or boom)', tickerSel),
        h('button', { type: 'button', onclick: () => {
          const s = v.stocks.find((x) => x.ticker === tickerSel.value), what = stockEvent() ? effects[kindSel.value](s ? `${s.name} (${s.ticker})` : tickerSel.value) : `${effects[kindSel.value]} (the whole town, every class)`;
          if (!confirmAction(`${kinds[kindSel.value].split(' (')[0]}: ${what} at the next world month. This can't be undone. Queue it?`)) return;
          run('/api/exchange/event', { kind: kindSel.value, ...(stockEvent() ? { ticker: tickerSel.value } : {}) }, 'Queued. It lands at the next world tick, on top of that month\'s normal move, and makes a headline.');
        } }, 'Queue event')),
      h('p', { class: 'muted small' }, 'A crash also pauses the stocks and the index fund for the month (the circuit breaker\'s one exception); other events move prices without pausing. Events cannot be taken back once the tick applies them.'),
      v.queued.length ? h('p', { class: 'small' }, `Recent events: ${v.queued.map((e) => `${e.kind}${e.ticker ? ` ${e.ticker}` : ''} (${e.applied_month ? `applied month ${e.applied_month}` : 'waiting for the next tick'})`).join(', ')}.`) : null,
    ];
  }

  function classView(c) {
    return h('div', { class: 'class-card' },
      h('p', { class: 'label' }, c.name),
      h('div', { class: 'stats' },
        h('div', { class: 'stat' }, 'Investing', h('b', {}, `${c.investors} of ${c.students}`)), h('div', { class: 'stat' }, 'In funds', h('b', {}, fmt(c.funds_cents))), h('div', { class: 'stat' }, 'In company shares', h('b', {}, fmt(c.stocks_cents))),
        h('div', { class: 'stat' }, 'Uninvested cash', h('b', {}, fmt(c.cash_cents))), h('div', { class: 'stat' }, 'Using a TFSA', h('b', {}, `${c.tfsa_users} (${fmt(c.tfsa_contributed_cents)} put in)`)), h('div', { class: 'stat' }, 'Using an RRSP', h('b', {}, `${c.rrsp_users} of ${c.students} (${fmt(c.rrsp_contributed_cents)} put in)`)), h('div', { class: 'stat' }, 'RRSP refunds paid', h('b', {}, fmt(c.rrsp_refund_cents))), h('div', { class: 'stat' }, 'Trades this month', h('b', {}, String(c.trades_this_month)))),
      c.top.length ? h('div', { class: 'table-wrap' }, h('table', {}, h('thead', {}, h('tr', {}, h('th', {}, 'Most held'), h('th', {}, 'Name'), h('th', { class: 'num' }, 'Students'), h('th', { class: 'num' }, 'Value'))),
        h('tbody', {}, c.top.map((t) => h('tr', {}, h('td', {}, t.ticker), h('td', {}, t.name), h('td', { class: 'num' }, String(t.holders)), h('td', { class: 'num' }, fmt(t.value_cents))))))) : h('p', { class: 'muted small' }, 'Nobody holds anything yet.'));
  }

  function tradesView() {
    if (!v.trades.length) return [h('p', { class: 'muted small' }, 'No trades yet.')];
    return [h('p', { class: 'label' }, v.can_control ? 'Recent trades (undo puts the cash and the shares back at the original price)' : 'Recent trades'),
      h('div', { class: 'table-wrap' }, h('table', {}, h('thead', {}, h('tr', {}, ['Student', 'Month', 'Trade', 'Account', 'Amount', ''].map((x, i) => h('th', { class: i === 4 ? 'num' : '' }, x)))),
        h('tbody', {}, v.trades.map((t) => h('tr', {}, h('td', {}, `${t.student} (${t.class})`), h('td', {}, String(t.month)), h('td', {}, `${t.side === 'buy' ? 'Bought' : 'Sold'} ${units(t.units_micro)} ${t.ticker}${t.via === 'limit' ? ' (limit)' : ''}`), h('td', {}, t.account === 'tfsa' ? 'TFSA' : t.account === 'rrsp' ? 'RRSP' : 'Non-reg.'), h('td', { class: 'num' }, fmt(t.cents)),
          h('td', {}, t.undone ? 'undone' : v.can_control ? h('button', { type: 'button', class: 'ghost', onclick: () => confirmAction(`Undo this trade? ${t.student} (${t.class}): ${t.side === 'buy' ? 'bought' : 'sold'} ${units(t.units_micro)} ${t.ticker} for ${fmt(t.cents)}, month ${t.month}. The cash and shares go back at the original price.`) && run('/api/exchange/undo', { id: t.id }, 'Trade undone.') }, 'Undo') : '')))))),
      v.news.length ? h('p', { class: 'small muted' }, `Latest headlines: ${v.news.map((n) => n.text).join(' / ')}`) : null];
  }

  async function load() {
    v = await api('/api/exchange/teach');
    // Rebuilt only when it changed, so a student's trade does not close the teacher's open dropdown or reset the chosen company.
    const key = JSON.stringify([v.can_control, v.frozen, v.stocks.map((s) => [s.ticker, s.name]), v.queued]);
    if (key !== shown) {
      shown = key;
      const keep = tickerSel.value;
      tickerSel.replaceChildren(...v.stocks.map((s) => h('option', { value: s.ticker }, `${s.ticker}  ${s.name}`)));
      if (v.stocks.some((s) => s.ticker === keep)) tickerSel.value = keep;
      controls.replaceChildren(...controlsView().filter(Boolean));
    }
    box.replaceChildren(...(v.classes.length ? v.classes.map(classView) : [h('p', { class: 'muted' }, 'Create a class first.')]));
    log.replaceChildren(...tradesView().filter(Boolean));
  }

  el.append(h('h2', {}, 'Exchange'), h('p', { class: 'muted small' }, 'Prices are the same for every class and are drawn from a seed the server owns. Students may place at most 10 orders a world month; one buy is capped at half their investable cash.'), controls, msg, box, log);
  ctx?.onRefresh(() => load().catch(() => {}));
  await load();
}
