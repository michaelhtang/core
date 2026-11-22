import { h, api } from '/ui.js?v=__V__';
import { ensureCss } from '/m/learn/figures.js?v=__V__';
import { renderRoad } from '/m/learn/road.js?v=__V__';
import { play } from '/m/learn/player.js?v=__V__';
import { playPractice } from '/m/learn/practice.js?v=__V__';
import { mountCalculator } from '/m/learn/calc.js?v=__V__';
import { tabBar, isTab, questsPanel, leaguesPanel, reviewPanel } from '/m/learn/tabs.js?v=__V__';

// The tab you were on survives a trip to a lesson or another building: a module variable, and sessionStorage when the browser lets us (it may throw).
const LEAGUE_POLL_MS = 60000;
let lastTab = null;
function readTab() { if (lastTab) return lastTab; try { const t = sessionStorage.getItem('ln-tab'); if (isTab(t)) return t; } catch {} return 'learn'; }
function saveTab(t) { lastTab = t; try { sessionStorage.setItem('ln-tab', t); } catch {} }

// The Learning Road building: the road, and the lesson player when a level is open (docs/learn.md). Answers are checked by the server only.
export async function render(el, ctx) {
  ensureCss();
  mountCalculator(el);                                               // the side calculator (ui/calc.js), available everywhere in this building
  const box = h('div', { class: 'ln-tabpanel', id: 'ln-tabpanel', role: 'tabpanel', tabindex: '-1' });
  const bar = tabBar((id) => pick(id));
  const root = h('div', { class: 'stack ln-root' }, bar, box);
  el.append(h('h2', {}, 'Learning Road'), root);
  let playing = false, tab = readTab(), st = null, highlight = null;
  box.setAttribute('aria-labelledby', `ln-tab-${tab}`);

  // Draws the current tab from the last /state. Learn is the road; the others are small panels. The tab bar goes while a lesson plays.
  function draw() {
    box.lnOff?.(); box.lnOff = null;                                  // the road's media listener, when we leave it
    box.setAttribute('aria-labelledby', `ln-tab-${tab}`);
    bar.select(tab);
    const usable = st.course && st.world_active;
    bar.hidden = !usable;
    if (!usable || tab === 'learn') { renderRoad(box, st, { highlight, start, goLeagues: () => pick('leagues', true) }); highlight = null; }
    else box.replaceChildren(tab === 'quests' ? questsPanel() : tab === 'leagues' ? leaguesPanel(st) : reviewPanel(st, { start, practice }));
  }
  function pick(id, focusPanel) {
    if (playing || !st || id === tab) return;
    tab = id; saveTab(id); draw();
    if (id === 'leagues') road().catch(() => {});                   // the league table is fresh each time the tab is opened, not as it was at page load
    el.querySelector('h2')?.scrollIntoView({ block: 'start' });
    if (focusPanel) box.focus({ preventScroll: true });
  }

  // `playing` is true from the first click on Start until the lesson calls onDone. A road fetch that was already in flight
  // (a live refresh) must not draw over a lesson that started meanwhile: that would leave the page full screen with no exit.
  async function road(hl) {
    try { st = await api('/api/learn/state'); } catch (e) { if (!playing) box.replaceChildren(h('p', { class: 'error', role: 'alert' }, e.message), h('button', { type: 'button', onclick: () => road() }, 'Try again')); return; }
    if (playing) return;
    highlight = hl; bar.hidden = false; draw();
  }
  async function start(levelId) {
    if (playing) return;                                             // a double click on Start must not mount two players
    playing = true; bar.hidden = true;
    await play(box, { levelId, me: ctx.me, onDone: (result) => { playing = false; road(result?.next?.level_id ?? levelId); } });
  }
  // A Practice session: the same guard, and "Practise again" starts the next one.
  async function practice() {
    if (playing) return;
    playing = true; bar.hidden = true;
    await playPractice(box, { onDone: () => { playing = false; road(); }, again: () => { playing = false; practice(); } });
  }
  // A live update redraws the road, never a lesson in progress and never while a level card is open (it would vanish under the student).
  ctx.onRefresh(() => { if (!playing && !box.querySelector('.ln-pop')) road().catch(() => {}); });
  // Classmates' XP sends no live hint, so while the Leagues tab is on screen it re-reads /state every LEAGUE_POLL_MS. Stops when the building closes.
  const poll = setInterval(() => {
    if (!el.isConnected) { clearInterval(poll); return; }
    if (tab === 'leagues' && !playing && document.visibilityState === 'visible') road().catch(() => {});
  }, LEAGUE_POLL_MS);
  await road();
}
