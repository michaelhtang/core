import { h, api } from '/ui.js?v=__V__';

// Mr. Tang's games on their own sites, drawn as small tiles in a grid: a picture of the game's start screen (thumbs/<id>.jpg), its name and
// one line. The whole tile is a link that opens the game's site in a new tab.
const css = () => { if (!document.querySelector('link[data-games]')) document.head.append(h('link', { rel: 'stylesheet', href: '/m/games/games.css?v=__V__', 'data-games': '' })); };

export const gameTile = (g) => h('a', { class: 'gm-tile', 'data-game': g.id, href: g.url, target: '_blank', rel: 'noopener noreferrer', title: `Open ${g.title} in a new tab` },
  h('img', { src: `/m/games/thumbs/${g.id}.jpg?v=__V__`, alt: '', width: '480', height: '300', loading: 'lazy' }),
  h('span', { class: 'gm-text' }, h('b', {}, g.title), h('span', { class: 'small' }, g.blurb), h('span', { class: 'gm-open' }, 'Opens in a new tab ↗')));

export const gameGrid = (games) => { css(); return h('div', { class: 'gm-grid' }, ...games.map(gameTile)); };

// The games from /api/games/list, or null when the module is off or the list cannot load (the caller then shows nothing).
export const loadGames = () => api('/api/games/list').catch(() => null);

// Shown by the Arcade grid under a line saying these games open in a new tab.
export const SAME_LOGIN_NOTE = 'Each has its own login, so use the one your teacher gives you there. Nothing you do there changes your money in core.';
