// Quick Cash Counter in the browser: the DOM screen, the input and the fixed-step loop around quickcash-core.js (docs/quickcash.md). The core decides everything
// that counts; this file only shows it and records the inputs as a change list [[tick, mask], ...] for the server to replay. No canvas: a customer card, a wait bar
// and four big offer buttons, so a phone gets large tap targets.
import { h } from '/ui.js?v=__V__';
import { C, KINDS, createGame, step, score, offers, customerOf, money } from '/m/arcade/games/quickcash-core.js?v=__V__';

const STEP_MS = 1000 / C.TPS;
const LETTERS = 'ABCD';
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
export const termText = (kind, term) => plural(term, KINDS[kind].unit);
const offerText = (o) => `${KINDS[o.kind].name}, ${termText(o.kind, o.term)}, ${money(o.cents)}`;

// The how-to steps, written from the core's constants.
export const steps = () => [
  `You work the loan counter at a made-up lender. ${C.CUSTOMERS} customers walk up one at a time. Each one is short some money.`,
  'Each customer is shown the same four ways to borrow, A to D, each for its own length of time. The order is different for every customer.',
  'Pick the offer that costs the customer the most. That is what the counter earns. There is no calculator, so work it out in your head.',
  `Press 1 to 4 (or A to D), or tap a button. You have ${C.WAIT / C.TPS} seconds for each customer. If the bar runs out, the customer leaves and the counter earns $0.`,
  'Interest is worked out on the amount borrowed, for the days it is owed. A year is 365 days.',
  'After each pick you see what the counter earned, and whether it was the most expensive of the four.',
  `After ${C.CUSTOMERS} customers the round is over. Your score is the whole dollars the counter earned. Then you see what every customer really paid, and what was cheapest for them.`,
];
export const tip = 'Tip: the highest rate is not always the most expensive offer. How long the money is owed matters too.';

// The four kinds and their rule, in one line each (the card on the game's page).
export function kindsLegend() {
  return h('div', { class: 'arc-legend' },
    h('p', { class: 'label' }, 'The four kinds of borrowing'),
    h('ul', { class: 'arc-qc-kinds' }, KINDS.map((k) => h('li', {}, h('b', {}, `${k.name}. `), k.rule))),
    h('p', { class: 'muted small' }, 'Quick Cash Counter is built from Mr. Tang\'s lesson, "Quick cash, real cost". The customers and amounts are made up.'));
}

// The end card: a row for each customer, then the total and the sentence. `r` is the server's report (core report()).
export function endCard(r) {
  return h('div', { class: 'stack' },
    h('p', { class: 'label' }, 'What each customer really paid'),
    h('ul', { class: 'arc-qc-rows', 'aria-label': 'Each customer' }, r.rows.map((row) => h('li', {},
      h('b', {}, `${row.name}: ${row.why}, $${row.amount}`),
      h('span', {}, row.pick ? `Your pick: ${KINDS[row.pick.kind].name}, ${termText(row.pick.kind, row.pick.term)}. They paid ${money(row.paid)}.${row.wasTop ? ' The most expensive of the four.' : ''}` : 'They left before you picked. They paid $0.00.'),
      h('span', { class: 'small muted' }, `Most expensive: ${offerText(row.top)}.`),
      h('span', { class: 'small muted' }, `Cheapest: ${offerText(row.low)}.`)))),
    h('p', {}, `The counter earned ${money(r.total)}. ${r.topCount} of ${C.CUSTOMERS} picks were the most expensive offer.`),
    h('p', { class: 'arc-lesson' }, r.lesson));
}

// Play one round in `host`. Returns { stop(), press(bit, down), done } where done resolves { inputs, state, aborted } when the round ends (or is abandoned).
// Keys 1 to 4 or A to D pick; a tap on a button is the same press. A hidden tab or a closed page abandons the round (it does not count), like the other games.
export function play(host, seed) {
  const s = createGame(seed);
  const inputs = [];
  let held = 0, pending = 0, lastMask = 0, acc = 0, last = 0, raf = 0, stopped = false, ready = 30, shown = -1, shownPhase = -1;
  let finish;
  const done = new Promise((r) => { finish = r; });
  const press = (bit, down) => { if (down) { held |= bit; pending |= bit; } else held &= ~bit; };

  const head = h('p', { class: 'label', 'aria-live': 'off' });
  const who = h('p', { class: 'arc-qc-who' });
  const bar = h('progress', { class: 'arc-qc-bar', max: String(C.WAIT), value: '0', 'aria-label': 'Time before the customer leaves' });
  const left = h('p', { class: 'muted small' });
  const flash = h('p', { class: 'arc-qc-flash', role: 'status', 'aria-live': 'polite' });
  const btns = LETTERS.split('').map((ch, i) => {
    const b = h('button', { type: 'button', class: 'arc-qc-offer', 'data-slot': String(i) });
    const set = (down) => (e) => { e.preventDefault(); if (down) { try { b.setPointerCapture(e.pointerId); } catch { /* a synthetic or ended pointer: fine */ } } press(1 << i, down); };
    b.addEventListener('pointerdown', set(true)); b.addEventListener('pointerup', set(false)); b.addEventListener('pointercancel', set(false)); b.addEventListener('contextmenu', (e) => e.preventDefault());
    return b;
  });
  const quit = h('button', { type: 'button', class: 'ghost arc-quit', onclick: () => end(true) }, 'Quit round');
  host.replaceChildren(h('div', { class: 'arc-qc' }, head, who, bar, left, h('div', { class: 'arc-qc-offers', 'aria-label': 'Offers' }, btns), flash, quit));

  const paintCustomer = () => {
    const i = Math.min(s.ci, C.CUSTOMERS - 1), c = customerOf(s, i), o = offers(s, i);
    head.textContent = `Customer ${i + 1} of ${C.CUSTOMERS}`;
    who.textContent = `${c.n} needs $${c.a} for ${c.w}.`;
    btns.forEach((b, k) => {
      b.replaceChildren(h('span', { class: 'arc-qc-key' }, `${LETTERS[k]} (${k + 1})`), h('b', {}, KINDS[o[k].kind].name), h('span', {}, KINDS[o[k].kind].short), h('span', { class: 'arc-qc-term' }, termText(o[k].kind, o[k].term)));
      b.setAttribute('aria-label', `${LETTERS[k]}: ${KINDS[o[k].kind].name}, ${KINDS[o[k].kind].short}, ${termText(o[k].kind, o[k].term)}`);
    });
  };
  const paint = () => {
    if (s.ci !== shown) { shown = s.ci; paintCustomer(); }
    const inFlash = s.phase === 1 && !s.over;
    if (inFlash !== (shownPhase === 1) || shownPhase < 0) {
      shownPhase = inFlash ? 1 : 0;
      btns.forEach((b, k) => { b.disabled = inFlash; b.classList.toggle('arc-picked', inFlash && s.last.slot === k); });
      const l = s.last;
      flash.textContent = inFlash ? (l.slot < 0 ? `${customerOf(s, l.ci).n} left. The counter earned $0.00.` : `+${money(l.cents)}. ${l.top ? 'The most expensive of the four!' : 'Not the most expensive of the four.'}`) : '';
      flash.classList.toggle('arc-qc-top', inFlash && l.top);
    }
    const t = s.phase === 0 ? s.t : C.WAIT;
    bar.value = t;
    bar.classList.toggle('arc-qc-low', t >= C.WAIT - 150);
    const secs = Math.max(0, Math.ceil((C.WAIT - t) / C.TPS));
    left.textContent = s.phase === 0 ? `${secs} second${secs === 1 ? '' : 's'} left` : '';
  };

  const KEYS = { Digit1: 1, Numpad1: 1, KeyA: 1, Digit2: 2, Numpad2: 2, KeyB: 2, Digit3: 4, Numpad3: 4, KeyC: 4, Digit4: 8, Numpad4: 8, KeyD: 8 };
  const key = (down) => (e) => { const bit = KEYS[e.code]; if (!bit || e.ctrlKey || e.metaKey || e.altKey) return; e.preventDefault(); if (!e.repeat) press(bit, down); };
  const kd = key(true), ku = key(false);
  const end = (aborted) => {
    if (stopped) return;
    stopped = true;
    cancelAnimationFrame(raf);
    window.removeEventListener('keydown', kd); window.removeEventListener('keyup', ku); document.removeEventListener('visibilitychange', hide); window.removeEventListener('pagehide', gone);
    finish({ inputs, state: s, aborted });
  };
  const hide = () => { if (document.hidden) end(true); };    // a hidden tab would freeze the round: it ends, and does not count
  const gone = () => end(true);
  window.addEventListener('keydown', kd); window.addEventListener('keyup', ku); document.addEventListener('visibilitychange', hide); window.addEventListener('pagehide', gone);

  const frame = (now) => {
    if (stopped) return;
    if (!host.isConnected) { end(true); return; }                                    // the panel was closed mid-round
    acc += Math.min(now - last, 250); last = now;
    let n = 0;
    while (acc >= STEP_MS && n++ < 8 && !s.over) {
      acc -= STEP_MS;
      if (ready > 0) { ready--; pending = 0; continue; }                             // 30 ticks (1 s) of "get ready" first: the bar does not move
      const mask = (held | pending) & C.MASK_MAX;
      pending = 0;
      if (mask !== lastMask) { inputs.push([s.tick, mask]); lastMask = mask; }
      step(s, mask);
    }
    if (ready > 0) { flash.textContent = 'Get ready.'; shownPhase = -1; } else paint();
    if (s.over) { end(false); return; }
    raf = requestAnimationFrame(frame);
  };
  paint();
  btns.forEach((b) => { b.disabled = true; });
  flash.textContent = 'Get ready.';
  raf = requestAnimationFrame((t) => { last = t; frame(t); });
  return { stop: () => end(true), press, done };
}

export { score };
