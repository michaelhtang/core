import { h, fmt } from '/ui.js?v=__V__';
import { svg, picture } from '/m/learn/figures.js?v=__V__';
import { roadPoints, pathTo } from '/m/learn/roadmath.js?v=__V__';

// The road: the current unit's banner, a road drawn in SVG that winds down the unit with a level node ON it for every level (done, next, locked),
// the level card as a popover under (or over) the node you open, and the units still to come. Nodes are real buttons. No inline styles: a node sits
// at one of a few fixed slots (ln-x<percent>, see roadmath.js) in a row exactly ROW px tall (learn.css), and the SVG is drawn with the same numbers.
const TICK = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.500l4.500 4.500L19 7.500"/></svg>';
const LOCK = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" aria-hidden="true"><rect x="6" y="11" width="12" height="9" rx="2"/><path d="M8.500 11V8a3.500 3.500 0 0 1 7 0v3"/></svg>';
const STAR = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3l2.600 6 6.400.600-4.800 4.300 1.400 6.300L12 16.800 6.400 20.200l1.400-6.300L3 9.600 9.400 9z"/></svg>';
const glyph = (svgText) => { const span = h('span', { class: 'ln-glyph' }); span.append(new DOMParser().parseFromString(svgText, 'image/svg+xml').documentElement); return span; };
const FLAME = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" aria-hidden="true"><path class="ln-fl-out" d="M13 2c0 3 4.500 5.500 4.500 11.500 0 4.100-2.500 7.500-5.500 7.500s-5.500-2.800-5.500-6.500c0-2.500 1.300-4.300 2.700-5.500 0 1.600.700 2.600 1.600 2.800C10.200 8.200 11 4.400 13 2z"/><path class="ln-fl-in" d="M12 21c-1.700 0-2.800-1.400-2.800-3.200 0-1.800 1.400-2.800 2.400-4.600 1.600 1.400 3.200 2.800 3.200 4.800 0 1.700-1.200 3-2.800 3z"/></svg>';
const FLAKE = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v18M4.200 7.500l15.600 9M19.800 7.500l-15.600 9M9.500 4.500L12 7l2.500-2.500M9.500 19.500L12 17l2.500 2.500"/></svg>';
const money = (c) => fmt(c);
const LETTERS = ['M', 'T', 'W', 'T', 'F', 'S', 'S'], STATE_WORD = { kept: 'kept', frozen: 'covered by a freeze', missed: 'missed', today: 'today, not kept yet', future: 'still to come', none: 'before you started' };

// The streak chip, the freezes, the week strip and the league chip (the review and Practice rows live on the Review tab, the table on Leagues). Read from /state `daily`; nothing here is a number the browser works out for itself.
function dailyBlock(d, rank, goLeagues) {
  return h('section', { class: 'ln-daily', 'aria-label': 'Your daily streak' },
    h('div', { class: 'ln-chips' },
      h('span', { class: `ln-streakchip${d.kept_today ? ' kept' : ''}` }, glyph(FLAME), h('b', {}, String(d.streak)), h('span', {}, ' day streak')),
      d.freezes > 0 ? h('span', { class: 'ln-freezechip', title: 'A streak freeze covers one missed day on its own.' }, glyph(FLAKE), h('b', {}, `× ${d.freezes}`), h('span', { class: 'sr' }, ` streak freeze${d.freezes === 1 ? '' : 's'}`)) : '',
      h('span', { class: 'muted small' }, `${d.xp_today} XP today`),
      rank ? h('button', { type: 'button', class: 'ln-rankchip', onclick: goLeagues }, `#${rank} in your league`) : ''),
    h('ol', { class: 'ln-week', 'aria-label': 'This week' }, d.week.map((x, i) => h('li', { class: `ln-wd ln-wd-${x.state}` }, h('span', { class: 'ln-dot-day' }), h('span', { 'aria-hidden': 'true' }, LETTERS[i]), h('span', { class: 'sr' }, `${x.day}: ${STATE_WORD[x.state]}`)))),
    d.at_risk ? h('p', { class: 'ln-risk' }, 'Keep your streak: finish a level or today’s review.') : '');
}

const STATUS_WORD = { closed: 'Closed', soon: 'Coming soon', done: 'Done', locked: 'Locked', current: 'Open' };
const urow = (title, chip, blurb, status) => h('li', { class: `ln-urow ln-u-${status}` }, h('span', {}, title), h('span', { class: 'chip' }, chip), h('span', { class: 'muted small' }, blurb));

export function renderRoad(el, st, { start, highlight, goLeagues }) {
  el.lnOff?.();                                                                // a previous draw's media listener
  if (!st.course) return el.replaceChildren(h('p', { class: 'muted' }, 'There are no lessons for your course yet.'));
  if (!st.world_active) return el.replaceChildren(h('p', { class: 'muted' }, 'The season is closed. The road opens again when the next one starts.'));
  const units = st.sections.flatMap((s) => s.units.map((u) => ({ ...u, section: s })));
  const playable = units.filter((u) => u.levels.length && u.status !== 'closed');
  if (units.some((u) => u.levels.length) && !playable.length) return el.replaceChildren(h('p', { class: 'muted' }, 'No units are open for your class yet.'));
  const current = playable.find((u) => u.status === 'current') ?? playable.at(-1);
  const others = units.filter((u) => u !== current);
  const levels = current.levels;
  const mq = window.matchMedia('(max-width: 600px)');
  const nodes = new Map();                                                     // level id -> { node, row }
  let open = null;                                                             // { id, pop, off }

  const wrap = h('div', { class: 'ln-roadwrap' });
  function draw() {
    closePop(false);
    nodes.clear();
    const { points, height, d } = roadPoints(levels.length, 100, { narrow: mq.matches });
    const nextIdx = levels.findIndex((l) => l.status === 'next');
    const reached = nextIdx < 0 ? levels.length - 1 : nextIdx;
    const art = svg('svg', { class: 'ln-roadsvg', viewBox: `0 0 100 ${height}`, preserveAspectRatio: 'none', width: '100%', height, 'aria-hidden': 'true', focusable: 'false' },
      ...['ln-road-edge', 'ln-road-bed'].map((c) => svg('path', { class: c, d, 'vector-effect': 'non-scaling-stroke' })),
      reached >= 0 ? svg('path', { class: 'ln-road-glow', d: pathTo(points, reached), 'vector-effect': 'non-scaling-stroke' }) : '',
      svg('path', { class: 'ln-road-dash', d, 'vector-effect': 'non-scaling-stroke' }));
    const rows = h('ol', { class: 'ln-rows', 'aria-label': `Levels in ${current.title}` }, levels.map((l, i) => {
      const p = points[i], isNext = l.status === 'next';
      const label = `Level ${l.n}: ${l.title}. ${l.status === 'done' ? 'Done.' : isNext ? 'Next.' : 'Locked.'}`;
      const node = h('button', { type: 'button', class: `ln-node ln-${l.status}`, 'aria-label': label, 'aria-expanded': 'false', 'aria-haspopup': 'dialog', onclick: () => (open?.id === l.id ? closePop(true) : openPop(l, i, p.pct)) },
        glyph(l.status === 'done' ? TICK : l.status === 'locked' ? LOCK : STAR));
      const row = h('li', { class: 'ln-row', onkeydown: (e) => { if (e.key === 'Escape' && open?.id === l.id) { e.preventDefault(); closePop(true); } } },
        h('div', { class: `ln-pin ln-x${p.pct}` }, node, h('span', { class: 'ln-node-title' }, h('span', {}, l.title), isNext ? h('span', { class: 'ln-tag' }, l.n === 1 ? 'Start here' : 'Continue') : ''),
          isNext ? h('img', { class: `ln-roadwolf ${p.pct < 50 ? 'ln-wolf-r' : 'ln-wolf-l'}`, src: '/art/wolf.png?v=__V__', alt: '', width: '64', height: '64' }) : ''));
      nodes.set(l.id, { node, row });
      return row;
    }));
    wrap.replaceChildren(art, rows);
  }

  function levelCard(l) {
    const done = l.status === 'done', locked = l.status === 'locked';
    return h('div', { class: 'ln-levelcard' },
      h('button', { type: 'button', class: 'ghost ln-pop-close', 'aria-label': 'Close level card', onclick: () => closePop(true) }, '×'),
      h('p', { class: 'label' }, `Level ${l.n} of ${l.of}`),
      h('h3', {}, l.title),
      h('ul', { class: 'ln-learn' }, l.learn.map((t) => h('li', {}, t))),
      h('p', { class: 'muted small' }, `${l.cards} cards · ${l.questions} questions`),
      locked ? h('p', { class: 'muted' }, l.after ? `Finish “${l.after}” first.` : 'Finish the earlier unit first.')
        : done ? h('p', { class: 'muted small' }, `Done: ${l.first_try}/${l.questions} first try, ${money(l.paid_cents)} earned. Practising again pays nothing.`)
          : h('p', { class: 'ln-reward' }, `Reward: up to ${money(l.max_reward_cents)}, paid once`),
      locked ? '' : h('button', { type: 'button', class: 'ln-primary', 'data-autofocus': true, onclick: () => start(l.id) }, done ? 'Practise again — no reward' : l.status === 'next' && l.n > 1 ? 'Continue' : 'Start'));
  }

  function openPop(l, i, pct) {
    closePop(false);
    const { node, row } = nodes.get(l.id);
    const up = levels.length > 3 && i >= levels.length - 2;                    // near the bottom of the road: open upward
    const pop = h('div', { class: `ln-pop ${up ? 'ln-pop-up' : 'ln-pop-down'} ${pct < 40 ? 'ln-pop-l' : pct > 60 ? 'ln-pop-r' : 'ln-pop-c'}`, role: 'dialog', 'aria-label': `Level ${l.n} of ${l.of}: ${l.title}` }, levelCard(l));
    // Outside click closes; the listener goes when the card closes or the road has left the page.
    const onDoc = (e) => { if (!el.isConnected || !pop.isConnected) return document.removeEventListener('click', onDoc); if (!pop.contains(e.target) && !node.contains(e.target)) closePop(false); };
    document.addEventListener('click', onDoc);
    row.append(pop);
    node.setAttribute('aria-expanded', 'true'); node.classList.add('open');
    open = { id: l.id, pop, off: () => document.removeEventListener('click', onDoc) };
    (pop.querySelector('[data-autofocus]') ?? pop.querySelector('.ln-pop-close')).focus({ preventScroll: true });
    pop.scrollIntoView({ block: 'nearest' });
  }
  function closePop(refocus) {
    if (!open) return;
    const { id, pop, off } = open; open = null; off(); pop.remove();
    const e = nodes.get(id);
    if (e) { e.node.setAttribute('aria-expanded', 'false'); e.node.classList.remove('open'); if (refocus) e.node.focus(); }
  }

  draw();
  // The media listener goes on the next draw, and when the student leaves the building (the hash changes and the road is gone).
  const off = () => { mq.removeEventListener('change', onMq); window.removeEventListener('hashchange', gone); };
  const gone = () => setTimeout(() => { if (!el.isConnected) off(); }, 0);
  const onMq = () => { if (!el.isConnected) return off(); draw(); };
  mq.addEventListener('change', onMq);
  window.addEventListener('hashchange', gone);
  el.lnOff = off;

  const pct = current.levels_total ? Math.round((100 * current.levels_done) / current.levels_total) : 0;
  const banner = h('header', { class: `ln-unitbanner${current.image ? '' : ' ln-noimg'}` },   // no picture yet: a plain header, not an empty frame
    current.image ? picture(current.image, 'ln-banner-img') : '',
    h('div', { class: 'ln-banner-text' },
      h('p', { class: 'label' }, `${current.section.title} · ${current.title}`),
      h('p', { class: 'ln-banner-blurb' }, current.blurb),
      h('div', { class: 'ln-unitbar', role: 'img', 'aria-label': `${current.levels_done} of ${current.levels_total} levels done` }, h('div', { class: `ln-bar-fill ln-w${Math.round(pct / 5) * 5}` })),
      h('p', { class: 'small' }, `${current.levels_done} of ${current.levels_total} levels · ${money(st.totals.cents_earned)} earned`)));
  el.replaceChildren(st.daily ? dailyBlock(st.daily, st.league?.my_rank, goLeagues) : '', banner, wrap,
    others.length ? h('div', { class: 'ln-more' }, h('p', { class: 'label' }, 'Also on your road'),
      h('ul', { class: 'ln-units' },
        // this section's other units one by one; every other section as a single row, so a long course stays a short list
        ...others.filter((u) => u.section.id === current.section.id).map((u) => urow(u.title, STATUS_WORD[u.status], u.blurb, u.status)),
        ...st.sections.filter((s) => s.id !== current.section.id).map((s) => {
          const withLevels = s.units.filter((u) => u.levels.length), status = !withLevels.length ? 'soon' : withLevels.every((u) => u.status === 'closed') ? 'closed' : withLevels.every((u) => u.status === 'done') ? 'done' : 'locked';
          return urow(s.title, STATUS_WORD[status], `${s.units.length} unit${s.units.length === 1 ? '' : 's'}. ${s.blurb}`, status);
        }))) : '');
  const target = highlight && nodes.get(highlight);                            // back from a lesson: the node to carry on from
  if (target) { target.node.focus({ preventScroll: true }); target.node.scrollIntoView({ block: 'center' }); }
}
