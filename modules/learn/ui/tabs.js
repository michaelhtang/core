import { h } from '/ui.js?v=__V__';
import { badgeSvg, BADGES } from '/m/learn/badges.js?v=__V__';
import { MODES } from '/m/learn/practice.js?v=__V__';

// The Learning Road's four tabs (docs/learn.md "Tabs"): Learn, Quests, Leagues, Review. UI only: every number here comes from /state.
const icon = (inner) => { const span = h('span', { class: 'ln-tabicon' }); span.append(new DOMParser().parseFromString(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" aria-hidden="true">${inner}</svg>`, 'image/svg+xml').documentElement); return span; };
export const TABS = [
  { id: 'learn', label: 'Learn', icon: '<path d="M8 21l3-18M16 21L13 3M12 7v2M12 12v2M12 17v2"/>' },                       // a road running away
  { id: 'quests', label: 'Quests', icon: '<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="4"/><path d="M12 12l6-6"/>' },   // a target
  { id: 'leagues', label: 'Leagues', icon: '<path d="M12 3l7 3v5.500c0 4.500-3 8-7 9.500-4-1.500-7-5-7-9.500V6z"/><path d="M9 12l2.200 2.200L15.500 10"/>' },   // a shield
  { id: 'review', label: 'Review', icon: '<path d="M19.500 12a7.500 7.500 0 0 1-13 5M4.500 12a7.500 7.500 0 0 1 13-5"/><path d="M17 3v4.500h-4.500M7 21v-4.500h4.500"/>' },     // a loop
];
export const isTab = (id) => TABS.some((t) => t.id === id);

// The tab bar: real buttons in a tablist; arrow keys, Home and End move (and select) like a native tab strip. `pick(id)` changes the tab.
export function tabBar(pick) {
  const btns = new Map(TABS.map((t) => [t.id, h('button', { type: 'button', role: 'tab', class: 'ln-tab', id: `ln-tab-${t.id}`, 'aria-controls': 'ln-tabpanel', 'aria-selected': 'false', tabindex: '-1', onclick: () => pick(t.id) }, icon(t.icon), h('span', { class: 'ln-tablabel' }, t.label))]));
  const bar = h('div', { class: 'ln-tabbar', role: 'tablist', 'aria-label': 'Learning Road sections', onkeydown: (e) => {
    const i = TABS.findIndex((t) => btns.get(t.id) === document.activeElement);
    if (i < 0) return;
    const j = e.key === 'ArrowRight' ? (i + 1) % TABS.length : e.key === 'ArrowLeft' ? (i + TABS.length - 1) % TABS.length : e.key === 'Home' ? 0 : e.key === 'End' ? TABS.length - 1 : -1;
    if (j < 0) return;
    e.preventDefault(); pick(TABS[j].id); btns.get(TABS[j].id).focus();
  } }, [...btns.values()]);
  bar.select = (id) => { for (const [k, b] of btns) { b.setAttribute('aria-selected', String(k === id)); b.tabIndex = k === id ? 0 : -1; } };
  return bar;
}

export const questsPanel = () => h('section', { class: 'ln-soon', 'aria-label': 'Quests' }, h('h3', {}, 'Quests are coming soon.'), h('p', { class: 'muted' }, 'Daily goals and weekly challenges will show up here.'));

// ---- Leagues ----
const TIERS = Object.entries(BADGES).map(([id, b]) => ({ id, name: b.name }));                 // lowest rank first, the server's order
const badge = (id, size, cls) => { const span = h('span', { class: `ln-badge ${cls}` }); span.append(new DOMParser().parseFromString(badgeSvg(id, size), 'image/svg+xml').documentElement); return span; };   // not .ln-glyph: that one strips fills
const lock = () => { const span = h('span', { class: 'ln-lock', 'aria-hidden': 'true' }); span.append(new DOMParser().parseFromString('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/></svg>', 'image/svg+xml').documentElement); return span; };
const DAY = 86400000, utc = (s) => Date.UTC(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10));
// The league week ends Sunday midnight: from Monday that is 7 days, on Sunday it is 1. Both dates come from the server (Edmonton days).
export const daysLeft = (weekStart, today) => Math.max(1, Math.min(7, 7 - Math.round((utc(today) - utc(weekStart)) / DAY)));
const ZONE = { up2: ['▲▲', 'moves up two ranks'], up: ['▲', 'moves up'], down: ['▼', 'drops down'] };
const MEDAL = { 1: 'gold', 2: 'silver', 3: 'bronze' };

export function leaguesPanel(st) {
  const lg = st.league;
  if (!lg) return h('p', { class: 'muted' }, 'Leagues are for students.');
  const lr = lg.last_result, left = daysLeft(lg.week_start, st.daily?.today ?? lg.week_start);
  const mine = TIERS.findIndex((t) => t.id === lg.tier.id);
  const strip = h('ol', { class: 'ln-ranks', 'aria-label': 'League ranks' }, TIERS.map((t, i) => h('li', { class: `ln-rankitem ${i === mine ? 'now' : i < mine ? 'past' : 'locked'}`, 'aria-current': i === mine ? 'true' : null },
    badge(t.id, i === mine ? 96 : 52, i === mine ? 'ln-bd-now' : 'ln-bd'),
    i > mine ? lock() : '',
    h('span', { class: 'ln-rankname' }, t.name, i > mine ? h('span', { class: 'sr' }, ' (locked)') : ''))));
  // centre the student's rank in the strip once it is on the page
  requestAnimationFrame(() => { const cur = strip.children[mine]; if (cur && strip.isConnected) strip.scrollLeft = cur.offsetLeft - (strip.clientWidth - cur.offsetWidth) / 2; });
  const top = mine === TIERS.length - 1, bottom = mine === 0;
  const items = [];
  // the podium line shows only where it differs from the promotion line and two ranks up exist (from Grandmasters a jump of two is a move of one)
  let pod = !lg.podium_line || lg.podium_line >= lg.promote_line || mine > TIERS.length - 3, up = !lg.promote_line || top, down = !lg.demote_line || bottom;
  lg.rows.forEach((r, i) => {
    if (!pod && r.rank > lg.podium_line) { pod = true; if (i > 0) items.push(h('li', { class: 'ln-divider ln-div-up2', 'aria-label': 'Up two ranks above this line' }, h('span', {}, '▲▲ Up two ranks'))); }
    if (!up && r.rank > lg.promote_line) { up = true; if (i > 0) items.push(h('li', { class: 'ln-divider ln-div-up', 'aria-label': 'Promotion zone above this line' }, h('span', {}, '▲ Promotion zone'))); }
    if (!down && r.rank >= lg.demote_line) { down = true; items.push(h('li', { class: 'ln-divider ln-div-down', 'aria-label': 'Demotion zone below this line' }, h('span', {}, '▼ Demotion zone'))); }
    const medal = MEDAL[r.rank];
    items.push(h('li', { class: `${r.me ? 'me ' : ''}ln-z-${r.zone}`, value: r.rank },
      medal ? h('span', { class: `ln-rk ln-medal ln-medal-${medal}` }, String(r.rank), h('span', { class: 'sr' }, ` ${medal} medal`)) : h('span', { class: 'ln-rk' }, String(r.rank)),
      h('span', { class: 'ln-who' }, r.username, r.me ? h('span', { class: 'sr' }, ' (you)') : ''),
      ZONE[r.zone] ? h('span', { class: 'ln-zone', title: ZONE[r.zone][1] }, h('span', { 'aria-hidden': 'true' }, ZONE[r.zone][0]), h('span', { class: 'sr' }, ZONE[r.zone][1])) : '',
      h('b', {}, `${r.xp} XP`)));
  });
  return h('section', { class: 'ln-league', 'aria-label': `${lg.tier.name} league` },
    h('div', { class: 'ln-leaguehead' }, h('h3', {}, `${lg.tier.name} League`), h('p', { class: 'ln-daysleft muted' }, `${left} day${left === 1 ? '' : 's'} left`)),
    lr && lr.moved !== 'stay' ? h('p', { class: `ln-moved ln-moved-${lr.moved}` }, lr.moved === 'up' ? (lr.steps > 1 ? `You jumped up two ranks to ${lr.to.name}` : `You moved up to ${lr.to.name}`) : `You dropped to ${lr.to.name}`) : '',
    strip,
    h('ol', { class: 'ln-rank' }, items),
    h('p', { class: 'muted small' }, 'How leagues work: each league group has up to 30 students from all of Mr. Tang\'s classes. Every week the top 3 move up two ranks, the rest of the top 10 move up one, and the bottom 5 move down (a group smaller than 20 moves fewer). You earn league XP from lessons and Practice. You need some XP to move up.'));
}

// ---- Review: the daily review and Practice ----
export function reviewPanel(st, { start, practice }) {
  const d = st.daily;
  if (!d) return h('p', { class: 'muted' }, 'Review and Practice are for students.');
  const rv = d.review, pr = st.practice, weak = st.weak ?? [];
  const finished = !st.next && st.totals.levels_done > 0 && !!pr;
  const mode = pr ? MODES[pr.next_mode] : null;
  return h('div', { class: 'stack ln-reviewpanel' },
    finished ? h('section', { class: 'ln-donecall', 'aria-label': 'You have finished the road' },
      h('h3', {}, 'You’ve finished the road.'),
      h('p', {}, 'Keep sharp with Practice. It picks the questions you find hardest, so you can keep learning when you like.'),
      pr.state === 'ready' ? h('button', { type: 'button', class: 'ln-primary', onclick: practice }, `Keep sharp with Practice: ${mode.name}`) : '') : '',
    h('section', { class: 'ln-daily', 'aria-label': 'Daily review' },
      h('div', { class: 'ln-reviewrow' },
        h('div', {}, h('b', {}, 'Daily review'), h('p', { class: 'muted small' }, 'Questions you met before, five a day.')),
        rv.state === 'ready' ? h('button', { type: 'button', class: 'ln-primary', onclick: () => start('review') }, `Review ${rv.count} questions`)
          : rv.state === 'done' ? h('button', { type: 'button', disabled: true }, 'Done for today')
            : h('p', { class: 'muted small' }, 'Finish a level to unlock the daily review'))),
    pr ? h('section', { class: 'ln-daily', 'aria-label': 'Practice' },
      h('div', { class: 'ln-reviewrow ln-practicerow' },
        h('div', {}, h('b', {}, 'Practice'),
          pr.state === 'ready' ? h('p', { class: 'muted small' }, `Practice your weak spots: ${weak.join(', ')}`) : h('p', { class: 'muted small' }, 'Finish a level to unlock Practice'),
          pr.state === 'ready' ? h('p', { class: 'muted small' }, `${pr.open ? 'Your session is waiting' : 'Next'}: ${mode.name}. ${mode.rule}`) : '',
          pr.state === 'ready' ? h('p', { class: 'muted small' }, `${pr.xp_today} of ${pr.cap} Practice XP today`) : ''),
        pr.state === 'ready' ? h('button', { type: 'button', class: 'ln-primary', onclick: practice }, `${pr.open ? 'Carry on' : 'Start'}: ${mode.name}`) : '')) : '');
}
