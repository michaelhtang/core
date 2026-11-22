// games: Mr. Tang's games that live on their own sites. STAX North, Money Month and Wolf Pack Returns (his "Tax Season") show as tiles in the Arcade grid, after our own games; TradeLab
// (the stock market sim every course uses for investing) is a door of its own in the town menu. Links only: nothing here moves money, keeps a
// score or stores anything about a student. Each game has its own login on its own site.
// ui/thumbs/<id>.jpg: a 480 x 300 picture of each game (STAX North and Money Month: rendered in the lesson-art style, design/art/thumb-stax-402 and thumb-payday-401, scaled from 1280 x 800; Wolf Pack Returns: a screenshot of the start screen, 2026-11-19; TradeLab: design/art/thumb-tradelab-c.svg, his pick of three, 2026-11-19); a new game needs one.
// `courses` limits who sees a game (a course id from config/vdaa.json); no list means every course that has this module.
import { defineModule } from '../../lib/modules.js';

export const GAMES = Object.freeze([
  { id: 'stax', title: 'STAX North', url: 'https://stax.michaelhtang.com/',
    blurb: 'Invest through 20 years of real Canadian market history, one month at a time. Play solo or as a class.' },
  { id: 'payday', title: 'Money Month', url: 'https://michaelhtang.com/payday/',
    blurb: 'A quick money board game for 2 to 5 players on one screen.' },
  { id: 'taxdesk', title: 'Wolf Pack Returns', url: 'https://michaelhtang.com/fintech-tax/', courses: ['fintech2030'],
    blurb: 'Tax season practice: a Canadian tax filing game.' },
].map((g) => Object.freeze(g)));

export const TRADELAB = Object.freeze({ id: 'tradelab', title: 'TradeLab', url: 'https://tradelab.michaelhtang.com/',
  blurb: 'Trade real stocks and crypto at live prices with virtual cash. Your teacher sets up the game.' });

// The Arcade links a student in `course` sees, without the course list.
export const gamesFor = (course) => GAMES.filter((g) => !g.courses || g.courses.includes(course)).map(({ courses, ...g }) => g);

const TRADELAB_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="4"/><path d="M6 16l4-4 3 2 5-6"/></svg>';

export default defineModule({
  id: 'games',
  panels: [{ id: 'tradelab', building: { key: 'tradelab', name: 'TradeLab', icon: TRADELAB_ICON }, src: 'tradelab.js' }],
  routes: [
    {
      // A game the teacher turned off for this class in the Arcade's teacher panel is left out (TradeLab has no switch: it is its own door).
      method: 'GET', path: '/list', access: 'student', handler(k, { user }) {
        const off = k.modules.has('arcade') ? k.modules.call('arcade', 'offFor', { classId: user.class_id }) : [];
        return { games: gamesFor(k.players.classOf(user.id)?.course_id).filter((g) => !off.includes(g.id)), tradelab: TRADELAB };
      },
    },
  ],
  services: {
    // The Arcade's teacher panel: the linked games a class of `course` sees, so it can show a switch for each.
    arcadeLinks: (k, { course }) => gamesFor(course).map(({ id, title }) => ({ id, title })),
  },
});
