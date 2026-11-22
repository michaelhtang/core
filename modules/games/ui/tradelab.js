import { h } from '/ui.js?v=__V__';
import { gameGrid, loadGames } from '/m/games/list.js?v=__V__';

// The TradeLab door: Mr. Tang's stock market sim on its own site, used for investing in every course.
export async function render(el) {
  el.replaceChildren(h('p', { class: 'muted' }, 'Loading...'));
  const list = await loadGames();
  if (!list?.tradelab) { el.replaceChildren(h('p', { class: 'error' }, 'TradeLab could not load. Try again in a moment.')); return; }
  el.replaceChildren(
    h('h2', {}, 'TradeLab'),
    h('p', { class: 'muted' }, 'TradeLab opens in a new tab and has its own login, so use the one your teacher gives you there. Nothing you do there changes your money in core.'),
    gameGrid([list.tradelab]));
}
