import { h, api, fmt, guard } from '/ui.js?v=__V__';
import * as billdash from '/m/arcade/games/billdash.js?v=__V__';
import * as diversify from '/m/arcade/games/diversify.js?v=__V__';
import * as debtsnake from '/m/arcade/games/debtsnake.js?v=__V__';
import { optionKey, parseOptions } from '/m/arcade/games/debtsnake-core.js?v=__V__';
import { BUCKETS, EVENTS, score as diversifyScore } from '/m/arcade/games/diversify-core.js?v=__V__';

// The Arcade building: a card for each game, its canvas with keyboard and touch controls, and the verified result. The round is played here,
// but the score shown at the end is the server's: it replays the recorded inputs with the seed it chose at /start (docs/arcade.md).
// pads: [label, mask bit, css class]; the bits are the game core's own input mask.
const UI = {
  billdash: {
    mod: billdash, local: (st) => Math.max(0, st.score), errand: 'Play a round of Bill Dash', alt: 'Bill Dash game screen',
    // The numbers here are the game's own (billdash-core.js C and KINDS): change them there first, then here.
    steps: [
      'Paycheques, bills and SALE tags fall down four lanes. You are the wolf at the bottom.',
      'Move left and right with the arrow keys (or A and D). On a phone, tap Left and Right.',
      'When something in your lane reaches the yellow pay zone, press Space (or tap Pay) to stamp it.',
      'Stamp a paycheque to add $60 to your cash. You can hold up to $150.',
      'Stamp a bill to pay it. The bill\'s amount comes out of your cash and goes onto your score. Pay it as soon as it enters the zone for 25% extra.',
      'Do not let a bill cross the red line. A late bill costs 20 points and 1 of your 3 hearts.',
      'Let SALE tags fall. They cost nothing if you leave them, but stamping one wastes $20 of your cash.',
      'Not enough cash for a bill? You lose 3 points, freeze for a moment and the bill keeps falling. Catch a paycheque first.',
      'The round lasts 45 seconds, or until your hearts run out. Things fall faster as time goes on.',
    ],
    tip: 'Tip: keep some cash on hand. Rent is $60, so a bill can be bigger than what you have.',
    legend: true,
    pads: [['Left', 1, 'arc-l'], ['Pay', 4, 'arc-a'], ['Right', 2, 'arc-r']],
  },
  diversify: {
    mod: diversify, local: diversifyScore, errand: 'Play a round of Diversify', alt: 'Diversify game screen',
    how: 'Arrows or A and D to move the wolf over a basket, Space to drop the paycheque (it drops by itself after a moment), R or Shift to rebalance: a quarter of the biggest basket moves to the smallest, every 3 seconds. On a phone use the buttons under the game. News changes the baskets, and your score rewards a steady, spread-out total.',
    pads: [['Left', 1, 'arc-l'], ['Right', 2, 'arc-r'], ['Drop', 4, 'arc-a'], ['Rebalance', 8, 'arc-b']],
  },
  debtsnake: {
    mod: debtsnake, local: (st) => debtsnake.score(st), errand: 'Play a round of Debt Snake', alt: 'Debt Snake game screen', dyn: true, legendFn: () => snakeLegend(),
    // The numbers here are the game's own (debtsnake-core.js and docs/debtsnake.md): change them there first, then here.
    steps: [
      'You are a long snake, and your length is your loan. Every segment after the first two is $100 of debt. You start with 12 segments, so $1,000 of debt.',
      'Steer with the arrow keys or W, A, S and D. On a phone, swipe on the board or use the buttons. The snake keeps moving by itself.',
      'Eat a payment coin to pay down your debt: -$100, +10 points, and your tail loses a segment. The next coin appears right away.',
      'Every month (60 moves) the bank charges interest and your tail grows: 1 segment while you owe up to $1,000, 2 segments up to $2,000, and so on. The month bar fills up and flashes red for the last 8 moves.',
      'Crash into a wall, a stone or your own body and the round is over. A long snake is clumsy, so paying down debt gives you room to move.',
      'Get your debt to $0 and you are debt free: +200 points, once. After that each coin is savings: +10 points and the snake grows by 1.',
      'Interest then works for you. Each month you get 1 more segment and 10 points for every full $1,000 you have saved.',
      'A round lasts 3 minutes at most. Speed is how often the snake moves (slow, normal or fast). The board is small (10 by 9), normal (15 by 13) or large (21 by 17). You can have 1, 3 or 5 coins on the board at once.',
      'Pick a mode. Each one adds a money rule. Mix puts several together, and "?" picks three for you. Your best score and the class board are kept for each mode. Speed, board and coins do not split the boards.',
    ],
    tip: 'Tip: pay early. The shorter you are, the easier it is to turn. After a crash, press Space to play again.',
    legend: true, padClass: 'arc-dpad',
    pads: [['Up', 1, 'arc-u'], ['Left', 4, 'arc-l'], ['Down', 2, 'arc-d'], ['Right', 8, 'arc-r']],
  },
  wordle: { errand: "Play today's FinWord" },                        // a daily word game with its own view (wordle() below), not a canvas round
};
const WORDLE_STEPS = [
  'There is one secret word each day. The hint above the board is the part of the course it comes from.',
  'Type a word with that many letters and press Enter. You get 6 guesses. Any letters work, it does not have to be a real word.',
  'Green: the right letter in the right spot. Yellow: the letter is in the word, but in another spot. Grey: the letter is not in the word.',
];
const MARK_TEXT = { hit: 'right spot', near: 'in the word, wrong spot', miss: 'not in the word' };
const KEY_ROWS = ['QWERTYUIOP', 'ASDFGHJKL', 'ZXCVBNM'];

export async function render(el, ctx) {
  if (!document.querySelector('link[data-arcade]')) document.head.append(h('link', { rel: 'stylesheet', href: '/m/arcade/arcade.css?v=__V__', 'data-arcade': '' }));
  const view = h('div', { class: 'stack' });
  const msg = h('p', { role: 'status' });
  const say = (text, bad) => { msg.className = bad ? 'error' : 'ok'; msg.textContent = text; };
  let current = null;                                               // the round being played, so leaving or starting another stops it
  el.append(h('h2', {}, 'Arcade'), view, msg);

  const board = (rows) => (rows.length ? h('ol', { class: 'arc-board', 'aria-label': 'Class leaderboard' }, rows.map((r) => h('li', { class: r.mine ? 'arc-mine' : '' },
    h('span', { class: 'arc-rank' }, String(r.rank)), h('span', { class: 'arc-name' }, r.username), h('b', {}, String(r.best))))) : h('p', { class: 'muted small' }, 'No scores yet. Be the first on the board.'));

  // The in-app games, one line each. A tile may carry its own go() (e.g. to set location.hash for a game with its own page); by default it opens
  // that game's detail view here. Title, blurb and Best come from /api/arcade/state, which already leaves out games the teacher switched off.
  const TILES = [{ key: 'billdash' }, { key: 'diversify' }, { key: 'debtsnake' }, { key: 'wordle', go: () => wordle() }];

  const bestOf = (g) => (g.modes ? Object.values(g.modes).reduce((m, x) => Math.max(m, x.best ?? -1), -1) : g.best ?? -1);   // Debt Snake: its best in any mode; -1 means none
  const tile = (t) => h('button', { type: 'button', class: 'arc-tile', 'data-tile': t.key, onclick: t.go },
    h('img', { src: `/m/arcade/thumbs/${t.key}.jpg?v=__V__`, alt: '', width: '480', height: '300', loading: 'lazy' }),
    h('span', { class: 'arc-tile-text' }, h('b', {}, t.title), h('span', { class: 'small' }, t.blurb),
      h('span', { class: 'chip' }, t.kind === 'daily' ? ({ new: 'New word today', open: 'In progress', won: 'Solved today', lost: 'Played today' })[t.today] : bestOf(t) < 0 ? 'No score yet' : `Best ${bestOf(t)}`)));

  // The grid: our own games first, then Mr. Tang's linked games (modules/games, when that module is on and the list loads).
  async function home(focusKey) {
    msg.textContent = '';
    let st;
    try { st = await api('/api/arcade/state'); } catch (e) { view.replaceChildren(h('p', { class: 'error' }, e.message), h('button', { type: 'button', onclick: guard(() => home()) }, 'Try again')); return; }
    const grid = h('div', { class: 'arc-grid' }, TILES.flatMap((d) => {
      const g = st.games.find((x) => x.key === d.key);
      return g && UI[g.key] ? [tile({ go: () => detail(st, g), ...g, ...d })] : [];
    }));
    view.replaceChildren(grid);
    grid.querySelector(`[data-tile="${focusKey}"]`)?.focus();
    const m = await import('/m/games/list.js?v=__V__').catch(() => null);
    const list = m && await m.loadGames();
    if (!list?.games?.length || !grid.isConnected) return;
    const tiles = m.gameGrid(list.games).children;                     // gameGrid also loads games.css, which styles these tiles
    const css = document.querySelector('link[data-games]');
    if (css && !css.sheet) await new Promise((done) => { css.onload = css.onerror = done; });   // show them styled, not as bare links for a moment
    if (!grid.isConnected) return;
    grid.append(...tiles);
    view.append(h('p', { class: 'muted small' }, `Games marked "Opens in a new tab" run on Mr. Tang's own sites. ${m.SAME_LOGIN_NOTE}`));
  }

  // FinWord: today's word for this course. The server marks every guess and sends the answer only once the game is over (docs/arcade.md).
  async function wordle() {
    msg.textContent = '';
    let st, typed = '', busy = false, errand = null;
    try { st = await api('/api/arcade/wordle'); } catch (e) { say(e.message, true); return; }
    const board = h('div', { class: 'arc-wl-board', role: 'group', 'aria-label': 'Your guesses' });
    const keys = h('div', { class: 'arc-wl-keys', 'aria-label': 'Keyboard' });
    const status = h('p', { role: 'status', class: 'arc-wl-status' });
    const after = h('div', { class: 'stack' });
    const over = () => st.status !== 'open';
    const keyState = () => {                                         // best known state of each letter: hit beats near beats miss
      const rank = { miss: 1, near: 2, hit: 3 }, best = {};
      for (const g of st.guesses) [...g.guess].forEach((ch, i) => { if (!best[ch] || rank[g.marks[i]] > rank[best[ch]]) best[ch] = g.marks[i]; });
      return best;
    };
    function draw() {
      board.style.setProperty('--n', String(st.length));
      board.replaceChildren(...Array.from({ length: st.max }, (_, r) => {
        const g = st.guesses[r], live = !g && r === st.guesses.length && !over();
        return h('div', { class: 'arc-wl-row' }, Array.from({ length: st.length }, (_, i) => {
          const ch = g ? g.guess[i] : live ? typed[i] : undefined, m = g?.marks[i];
          return h('span', { class: `arc-wl-tile${m ? ` arc-wl-${m}` : ch ? ' arc-wl-typed' : ''}`, 'aria-label': ch ? `${ch}, ${m ? MARK_TEXT[m] : 'typed'}` : 'empty' }, ch ?? '');
        }));
      }));
      const best = keyState();
      const key = (label, act, cls = '') => h('button', { type: 'button', class: `arc-wl-key ${cls}`, 'aria-label': label.length > 1 ? label : `${label}${best[label] ? `, ${MARK_TEXT[best[label]]}` : ''}`, disabled: over() || busy, onclick: () => act() }, label);
      keys.replaceChildren(...KEY_ROWS.map((row, n) => h('div', { class: 'arc-wl-keyrow' },
        n === 2 ? key('Enter', send, 'arc-wl-wide') : null,
        ...[...row].map((c) => key(c, () => type(c), best[c] ? `arc-wl-${best[c]}` : '')),
        n === 2 ? key('Back', back, 'arc-wl-wide') : null)));
      status.className = 'arc-wl-status';
      status.textContent = over() ? (st.status === 'won' ? `You got it in ${st.guesses.length} ${st.guesses.length === 1 ? 'guess' : 'guesses'}.` : 'Out of guesses.')
        : `Guess ${st.guesses.length + 1} of ${st.max}. ${st.length} letters.`;
      after.replaceChildren(...(over() ? [endCard()] : []), stats());
    }
    const endCard = () => h('div', { class: 'arc-card' },
      h('p', { class: 'label' }, 'The word was'),
      h('p', { class: 'arc-score' }, st.answer),
      h('p', {}, h('b', {}, st.term), st.meaning ? `: ${st.meaning}` : ''),
      errand ? h('p', { class: 'ok' }, `Today's errand is done: ${UI.wordle.errand}${errand.reward_cents ? ` (${fmt(errand.reward_cents)})` : ''}.`) : h('span', {}),
      h('p', { class: 'muted small' }, 'A new word comes tomorrow.'));
    const stats = () => {
      const s = st.stats, top = Math.max(1, ...s.distribution);
      return h('div', { class: 'arc-card', 'aria-label': 'Your stats' },
        h('p', { class: 'label' }, 'Your stats'),
        h('div', { class: 'arc-wl-stats' }, [['Played', s.played], ['Won', s.won], ['Streak', s.current_streak], ['Best streak', s.best_streak]].map(([l, v]) => h('div', {}, h('b', {}, String(v)), h('span', { class: 'small muted' }, l)))),
        h('ol', { class: 'arc-wl-dist', 'aria-label': 'Games won by number of guesses' }, s.distribution.map((n, i) => h('li', {}, h('span', {}, String(i + 1)),
          h('progress', { max: String(top), value: String(n), 'aria-label': `Won in ${i + 1}: ${n}` }), h('b', {}, String(n))))));
    };
    const type = (c) => { if (!over() && !busy && typed.length < st.length) { typed += c; draw(); } };
    const back = () => { if (!over() && !busy && typed) { typed = typed.slice(0, -1); draw(); } };
    async function send() {
      if (over() || busy) return;
      if (typed.length !== st.length) { say(`Type ${st.length} letters first.`, true); return; }
      busy = true; msg.textContent = '';
      try {
        st = await api('/api/arcade/wordle/guess', { guess: typed }); typed = '';
        if (over()) { try { errand = (await api('/api/today/state')).errands.find((x) => x.title === UI.wordle.errand && x.status === 'done') ?? null; } catch { /* today is off: no note */ } }
      } catch (e) { say(e.message, true); }
      busy = false; draw();
    }
    const onKey = (e) => {
      if (!board.isConnected) { document.removeEventListener('keydown', onKey); return; }
      if (e.ctrlKey || e.metaKey || e.altKey || /^(INPUT|TEXTAREA|SELECT)$/.test(e.target?.tagName ?? '')) return;
      if (e.key === 'Enter' && e.target?.tagName === 'BUTTON') return;                    // a focused button handles its own Enter
      if (/^[a-zA-Z]$/.test(e.key)) { e.preventDefault(); type(e.key.toUpperCase()); }
      else if (e.key === 'Backspace') { e.preventDefault(); back(); }
      else if (e.key === 'Enter') { e.preventDefault(); guard(send)(); }
    };
    document.addEventListener('keydown', onKey);
    const backBtn = h('button', { type: 'button', class: 'ghost arc-back', onclick: guard(() => home('wordle')) }, 'Back to all games');
    view.replaceChildren(backBtn, h('div', { class: 'arc-card' },
      h('div', { class: 'spread' }, h('b', {}, st.title), h('span', { class: 'chip' }, st.day)),
      st.section ? h('p', {}, h('b', {}, 'Hint: '), `this word comes from "${st.section}".`) : null,
      h('details', { class: 'arc-how', open: !st.stats.played }, h('summary', {}, 'How to play'), h('ol', { class: 'arc-steps' }, WORDLE_STEPS.map((t) => h('li', {}, t)))),
      board, status, keys), after);
    draw();
  }

  // One game: its card (blurb, how to play, Play) and its class leaderboard, with a way back to the grid.
  function detail(st, g) {
    msg.textContent = '';
    if (g.key === 'debtsnake') { snakeDetail(st, g); return; }
    const back = h('button', { type: 'button', class: 'ghost arc-back', onclick: guard(() => home(g.key)) }, 'Back to all games');
    view.replaceChildren(back,
      h('div', { class: 'arc-card' },
        h('div', { class: 'spread' }, h('b', {}, g.title), h('span', { class: 'chip' }, g.best == null ? 'No score yet' : `Best ${g.best}`)),
        h('p', {}, g.blurb),
        UI[g.key].steps ? howTo(UI[g.key], !g.plays) : h('p', { class: 'muted small' }, UI[g.key].how),
        h('button', { type: 'button', disabled: !st.world_active, onclick: guard(() => begin(g.key, g.best ?? 0)) }, st.world_active ? `Play ${g.title}` : 'The season is closed')),
      h('div', {}, h('p', { class: 'label' }, `${g.title}: your class`), board(g.leaderboard ?? [])));
    back.focus();
  }

  // One round: start (the server picks the seed), play, then send only the inputs.
  async function begin(game, best, opts) {
    const ui = UI[game];
    current?.stop();
    msg.textContent = '';
    let round;
    try { round = await api('/api/arcade/start', opts ? { game, opts } : { game }); } catch (e) { say(e.message, true); return; }
    document.activeElement?.blur?.();
    const { play } = ui.mod;
    const { W, H, width = W, height = H } = ui.dyn ? ui.mod.size(round.opts) : ui.mod;   // Debt Snake draws at 4x so the snake can glide: attributes are the big size, the CSS size is W x H times the scale
    const canvas = h('canvas', { class: `arc-canvas${ui.dyn ? ' arc-smooth' : ''}`, width: String(width), height: String(height), role: 'img', 'aria-label': ui.alt });
    const fit = () => {                                              // the largest whole-number scale that fits the panel (CSS class arc-x1 .. arc-x4); Debt Snake may use a fraction
      const wide = ui.legend && layout.clientWidth >= LEGEND_AT;           // the legend takes a column beside the game
      const space = wide ? layout.clientWidth - LEGEND_W - 4 : (el.clientWidth || 320) - 4;   // 4 = the canvas border
      const tall = (innerHeight - 220) / H;                              // leave room for the heading and the buttons
      if (ui.dyn) { const k = Math.max(1, Math.min(4, space / W, tall)); canvas.style.width = `${Math.floor(W * k)}px`; canvas.style.height = `${Math.floor(H * k)}px`; return; }
      canvas.className = `arc-canvas arc-x${Math.max(1, Math.min(4, Math.floor(space / W), Math.floor(tall)))}`;
    };
    const pad = ([label, bit, cls]) => {
      const b = h('button', { type: 'button', class: `arc-pad ${cls}`, 'aria-label': label }, label);
      const set = (down) => (e) => { e.preventDefault(); if (down) { try { b.setPointerCapture(e.pointerId); } catch { /* a synthetic or already-ended pointer: fine */ } } current?.press(bit, down); b.classList.toggle('arc-down', down); };
      b.addEventListener('pointerdown', set(true)); b.addEventListener('pointerup', set(false)); b.addEventListener('pointercancel', set(false)); b.addEventListener('contextmenu', (e) => e.preventDefault());
      return b;
    };
    // With a legend, a wide panel puts it in a column beside the game; a narrow one (a phone) puts it under the buttons (arcade.css).
    const layout = h('div', { class: `arc-play${ui.legend ? ' arc-with-legend' : ''}` },
      h('div', { class: 'arc-main' }, h('div', { class: 'arc-stage' }, canvas),
        h('div', { class: ui.padClass ?? `arc-pads arc-pads${ui.pads.length}`, 'aria-label': 'Touch controls' }, ui.pads.map(pad)),
        h('button', { type: 'button', class: 'ghost arc-quit', onclick: () => current?.stop() }, 'Quit round')),
      ui.legend ? (ui.legendFn ?? legend)() : null);
    view.replaceChildren(h('div', { class: 'arc-wrap' }, layout));
    fit();
    canvas.scrollIntoView?.({ block: 'nearest' });                   // the Play button can sit below a long how-to: bring the game on screen
    const onResize = () => (canvas.isConnected ? fit() : window.removeEventListener('resize', onResize));
    window.addEventListener('resize', onResize);
    const run = play(canvas, round.seed, ui.dyn ? { best, opts: round.opts } : { best });
    current = run;
    const { inputs, state, aborted } = await run.done;
    current = null;
    if (aborted) { view.replaceChildren(h('p', {}, 'The round stopped early, so it does not count.'), h('button', { type: 'button', onclick: guard(() => begin(game, best, opts)) }, 'Play again'), h('button', { type: 'button', class: 'ghost', onclick: guard(() => (ui.dyn ? reopen(game) : home())) }, ui.dyn ? 'Change mode' : 'Back')); return; }
    await submit(game, round.session, inputs, ui.local(state), best, opts);
  }

  // Send the recorded inputs. A dropped connection keeps them for a retry (the server accepts a round once).
  async function submit(game, session, inputs, local, best, opts) {
    view.replaceChildren(h('p', {}, `Round over. Checking your score with the server… (you made about ${local})`));
    let res;
    try { res = await api('/api/arcade/finish', { session, game, inputs }); } catch (e) {
      const final = e.status !== undefined && e.status !== 429 && e.status < 500;     // a refusal from the server is final; a network failure is retried
      view.replaceChildren(h('p', { class: 'error' }, e.message), ...(final ? [h('button', { type: 'button', onclick: guard(() => begin(game, best, opts)) }, 'Play again')]
        : [h('button', { type: 'button', onclick: guard(() => submit(game, session, inputs, local, best, opts)) }, 'Try sending again')]),
      h('button', { type: 'button', class: 'ghost', onclick: guard(() => (opts ? reopen(game) : home())) }, opts ? 'Change mode' : 'Back'));
      return;
    }
    if (game === 'debtsnake') { await snakeResult(res, opts, best); return; }
    let errand = null;                                                // Today's errand, if today is on and it is done
    try { errand = (await api('/api/today/state')).errands.find((x) => x.title === UI[game].errand && x.status === 'done') ?? null; } catch { /* today is off or closed: no note */ }
    view.replaceChildren(
      h('div', { class: 'arc-card' },
        h('p', { class: 'label' }, 'Verified by the server'),
        h('p', { class: 'arc-score' }, String(res.score)),
        res.new_best ? h('p', { class: 'ok' }, 'New personal best!') : h('p', { class: 'muted' }, `Your best: ${res.best}`),
        game === 'diversify' ? debrief(res.stats) : h('p', { class: 'muted small' }, billdashLine(res)),
        errand ? h('p', { class: 'ok' }, `Today's errand is done: ${UI[game].errand}${errand.reward_cents ? ` (${fmt(errand.reward_cents)})` : ''}.`) : h('span', {})),
      h('div', {}, h('p', { class: 'label' }, 'Your class'), board(res.leaderboard)),
      h('div', { class: 'arc-actions' }, h('button', { type: 'button', onclick: guard(() => begin(game, res.best ?? best)) }, 'Play again'), h('button', { type: 'button', class: 'ghost', onclick: guard(home) }, 'Back')));
  }

  const billdashLine = (res) => { const s = res.stats; return `${s.paid} bills paid, ${s.late} late, ${s.deposits} paycheques banked, ${s.nsf} short of cash, ${s.impulse} impulse buys. ${res.hearts > 0 ? 'You made it to the end.' : 'You ran out of hearts.'}`; };

  // Diversify's teaching moment: where the money ended up, the worst drop, the score parts and one sentence chosen by rules (the numbers are the server's replay).
  const dollars = (c) => `$${Math.floor(c / 100)}.${String(c % 100).padStart(2, '0')}`;
  function debrief(r) {
    const w = r.worst, ev = EVENTS.find((e) => e.id === w.ev), g = r.parts.gain;
    return h('div', { class: 'stack' },
      h('p', { class: 'label' }, 'Where your money ended up'),
      h('ul', { class: 'arc-split', 'aria-label': 'Share of your money in each basket' }, BUCKETS.map((b, i) => h('li', {},
        h('span', { class: `arc-key arc-k${i}` }, b.name), h('progress', { max: '100', value: String(r.pct[i]), 'aria-label': `${b.name} ${r.pct[i]}%` }), h('b', {}, `${r.pct[i]}%`)))),
      h('p', { class: 'muted small' }, `You put in ${dollars(r.invested)} and it ended worth ${dollars(r.total)}, counting buying power. The same paycheques in cash alone ended at ${dollars(r.cashEnd)}; an even split ended at ${dollars(r.evenEnd)}.`),
      h('p', { class: 'muted small' }, `Largest drop: ${w.ddPct}% from the peak (${dollars(w.loss)})${ev && w.ddPct >= 3 ? `, around "${ev.head.toLowerCase()}"` : ''}.`),
      h('p', { class: 'muted small' }, `Score: ${r.parts.floor} to start, ${g < 0 ? '-' : '+'}${Math.abs(g)} for ending ${g < 0 ? 'below' : 'above'} cash alone, +${r.parts.bonus} for spreading your money, -${r.parts.penalty} for your worst drop. ${r.rebalances} rebalance${r.rebalances === 1 ? '' : 's'}.`),
      h('p', { class: 'arc-lesson' }, r.lesson));
  }

  // Bill Dash's how-to: numbered steps, then the legend. Open until the student has played a round.
  function howTo(ui, open) {
    return h('details', { class: 'arc-how', open },
      h('summary', {}, 'How to play, and what everything means'),
      h('div', { class: 'arc-how-body' },
        h('div', { class: 'arc-how-steps' }, h('ol', { class: 'arc-steps' }, ui.steps.map((t) => h('li', {}, t))), h('p', { class: 'arc-tip' }, ui.tip)),
        (ui.legendFn ?? legend)()));
  }

  // ---- Debt Snake: the mode picker, its options, the board for the chosen mode, and its result ----
  // `picked` survives Play again and Back: one mode, a Mix of several, or three random ones ("?", rolled here in the browser before /start, a choice of game and never a reward).
  const picked = { modes: ['classic'], mix: false, rolled: false, speed: 'normal', board: 'small', coins: 1 };
  const OPTION_ROWS = [['speed', 'Speed', [['slow', 'Slow'], ['normal', 'Normal'], ['fast', 'Fast']]], ['board', 'Board', [['small', 'Small'], ['normal', 'Normal'], ['large', 'Large']]], ['coins', 'Coins', [[1, '1'], [3, '3'], [5, '5']]]];
  const snakeOpts = () => ({ modes: picked.modes.length ? picked.modes : ['classic'], speed: picked.speed, board: picked.board, coins: picked.coins });
  const snakeKey = () => { try { return optionKey(parseOptions(snakeOpts())); } catch { return 'classic'; } };
  const snakeName = (modes) => modes.map(debtsnake.modeName).join(' + ');
  const reopen = async (game) => {                                  // back to the game's card, with fresh bests
    let st;
    try { st = await api('/api/arcade/state'); } catch (e) { say(e.message, true); return; }
    const g = st.games.find((x) => x.key === game);
    if (g) detail(st, g); else await home();
  };
  const icon = (key) => { const c = h('canvas', { class: 'arc-pic arc-pic-smooth', width: String(debtsnake.SW * 2), height: String(debtsnake.SW * 2), 'aria-hidden': 'true' }); debtsnake.modeIcon(c.getContext('2d'), key); return c; };

  function snakeDetail(st, g) {
    const back = h('button', { type: 'button', class: 'ghost arc-back', onclick: guard(() => home(g.key)) }, 'Back to all games');
    const plays = Object.values(g.modes ?? {}).reduce((n, m) => n + m.plays, 0);
    const bests = g.modes ?? {};
    const grid = h('div', { class: 'arc-modes', role: 'group', 'aria-label': 'Mode' });
    const opts = h('div', { class: 'arc-opts' });
    const sum = h('p', { class: 'arc-pick', role: 'status' });
    const boardBox = h('div', { class: 'stack' });
    const play = h('button', { type: 'button', disabled: !st.world_active }, st.world_active ? 'Play Debt Snake' : 'The season is closed');
    let seq = 0, modeBest = null;
    const toggle = (key) => {
      picked.rolled = false;
      if (key === 'classic' || !picked.mix) picked.modes = [key];
      else picked.modes = picked.modes.includes(key) ? picked.modes.filter((k) => k !== key) : [...picked.modes, key];
      if (key === 'classic') picked.mix = false;
      draw();
    };
    const roll = () => {                                              // three different modes, not classic
      const pool = debtsnake.MODES.map((m) => m.key).filter((k) => k !== 'classic');
      for (let i = pool.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [pool[i], pool[j]] = [pool[j], pool[i]]; }
      picked.modes = pool.slice(0, 3); picked.mix = false; picked.rolled = true; draw();
    };
    const mixSwitch = () => { picked.mix = !picked.mix; picked.rolled = false; if (picked.mix) picked.modes = picked.modes.filter((k) => k !== 'classic'); else if (picked.modes.length > 1) picked.modes = picked.modes.slice(0, 1); if (!picked.modes.length && !picked.mix) picked.modes = ['classic']; draw(); };
    const modeBtn = (m) => {
      const on = picked.modes.includes(m.key);
      const b = bests[m.key]?.best;
      return h('button', { type: 'button', class: `arc-mode${on ? ' arc-on' : ''}`, 'aria-pressed': String(on), 'data-mode': m.key, onclick: () => toggle(m.key) },
        icon(m.key), h('span', { class: 'arc-mode-text' }, h('b', {}, m.name), h('span', { class: 'small' }, m.rule)), b == null ? h('span', {}) : h('span', { class: 'chip' }, `Best ${b}`));
    };
    function draw() {
      grid.replaceChildren(...debtsnake.MODES.map(modeBtn),
        h('button', { type: 'button', class: `arc-mode arc-extra${picked.mix ? ' arc-on' : ''}`, 'aria-pressed': String(picked.mix), 'data-mode': 'mix', onclick: mixSwitch },
          h('span', { class: 'arc-glyph' }, '+'), h('span', { class: 'arc-mode-text' }, h('b', {}, 'Mix'), h('span', { class: 'small' }, picked.mix ? 'On: tap several modes to mix them. Tap Mix again to turn it off.' : 'Pick several modes and play them together.'))),
        h('button', { type: 'button', class: `arc-mode arc-extra${picked.rolled ? ' arc-on' : ''}`, 'aria-pressed': String(picked.rolled), 'data-mode': 'random', onclick: roll },
          h('span', { class: 'arc-glyph' }, '?'), h('span', { class: 'arc-mode-text' }, h('b', {}, 'Surprise me'), h('span', { class: 'small' }, 'Three random modes, mixed. Tap again to roll again.'))));
      opts.replaceChildren(...OPTION_ROWS.map(([name, label, choices]) => h('fieldset', { class: 'arc-opt' }, h('legend', { class: 'label' }, label),
        h('div', { class: 'arc-seg' }, choices.map(([val, text]) => h('button', { type: 'button', 'aria-pressed': String(picked[name] === val), class: picked[name] === val ? 'arc-on' : '', onclick: () => { picked[name] = val; draw(); } }, text))))));
      const empty = picked.mix && !picked.modes.length;
      sum.textContent = empty ? 'Mix is on. Tap two or more modes to play them together.' : `Playing: ${snakeName(picked.modes.length ? picked.modes : ['classic'])}.`;
      play.disabled = !st.world_active || empty;
      showBoard();
    }
    async function showBoard() {                                      // the best and the class board for the chosen mode only
      const key = snakeKey(), mine = ++seq;
      boardBox.replaceChildren(h('p', { class: 'muted small' }, 'Loading the board…'));
      let res;
      try { res = await api(`/api/arcade/board?game=debtsnake&mode=${encodeURIComponent(key)}`); } catch (e) { if (mine === seq) boardBox.replaceChildren(h('p', { class: 'error' }, e.message)); return; }
      if (mine !== seq || !boardBox.isConnected) return;
      modeBest = res.best;
      boardBox.replaceChildren(h('p', { class: 'label' }, `${snakeName(picked.modes.length ? picked.modes : ['classic'])}: your class`),
        h('p', { class: 'muted small' }, res.best == null ? 'You have not finished a round in this mode yet.' : `Your best in this mode: ${res.best} (${res.plays} round${res.plays === 1 ? '' : 's'}).`), board(res.leaderboard));
    }
    play.onclick = guard(() => begin('debtsnake', modeBest ?? 0, snakeOpts()));
    view.replaceChildren(back,
      h('div', { class: 'arc-card' },
        h('div', { class: 'spread' }, h('b', {}, g.title), h('span', { class: 'chip' }, bestOf(g) < 0 ? 'No score yet' : `Best ${bestOf(g)}`)),
        h('p', {}, g.blurb),
        howTo(UI.debtsnake, !plays),
        h('p', { class: 'label' }, 'Pick a mode'), grid, opts, sum, play),
      boardBox);
    draw();
    back.focus();
  }

  // The verified result of a Debt Snake round: the server's score, what happened in the round, and the board for that mode. Space plays again.
  async function snakeResult(res, opts, best) {
    let errand = null;
    try { errand = (await api('/api/today/state')).errands.find((x) => x.title === UI.debtsnake.errand && x.status === 'done') ?? null; } catch { /* today is off or closed: no note */ }
    const s = res.stats ?? {}, name = snakeName(opts.modes);
    const again = () => begin('debtsnake', res.best ?? best, opts);
    const onKey = (e) => {
      if (!view.querySelector('.arc-again')) { document.removeEventListener('keydown', onKey); return; }
      if (e.code === 'Space' && e.target?.tagName !== 'BUTTON') { e.preventDefault(); document.removeEventListener('keydown', onKey); guard(again)(); }
    };
    document.addEventListener('keydown', onKey);
    view.replaceChildren(
      h('div', { class: 'arc-card' },
        h('p', { class: 'label' }, `Verified by the server: ${name}`),
        h('p', { class: 'arc-score' }, String(res.score)),
        res.new_best ? h('p', { class: 'ok' }, 'New personal best in this mode!') : h('p', { class: 'muted' }, `Your best in this mode: ${res.best}`),
        h('p', { class: 'muted small' }, snakeLine(s)),
        errand ? h('p', { class: 'ok' }, `Today's errand is done: ${UI.debtsnake.errand}${errand.reward_cents ? ` (${fmt(errand.reward_cents)})` : ''}.`) : h('span', {})),
      h('div', {}, h('p', { class: 'label' }, `${name}: your class`), board(res.leaderboard)),
      h('div', { class: 'arc-actions' }, h('button', { type: 'button', class: 'arc-again', onclick: guard(again) }, 'Play again (Space)'), h('button', { type: 'button', class: 'ghost', onclick: guard(() => reopen('debtsnake')) }, 'Change mode')));
    view.querySelector('.arc-again')?.focus();
  }

  await home();
}

// Bill Dash's legend. Every picture is drawn by the game's own drawing code, so it looks exactly like the screen.
const LEGEND_AT = 660, LEGEND_W = 250;                              // keep in step with arcade.css: the container width and legend column (+ gap)
const pic = (name, edge) => { const c = h('canvas', { class: 'arc-pic', width: String(billdash.SWATCH), height: String(billdash.SWATCH), 'aria-hidden': 'true' }); billdash.swatch(c.getContext('2d'), name, edge); return c; };
const row = (p, name, text) => h('li', {}, p, h('span', {}, name ? h('b', {}, name) : null, name ? ' ' : null, text));
const word = (w, cls, text) => h('li', {}, h('span', { class: `arc-word arc-w-${cls}` }, w), h('span', {}, text));
function legend() {
  return h('aside', { class: 'arc-legend', 'aria-label': 'Bill Dash legend' },
    h('p', { class: 'label' }, 'What falls'),
    h('ul', { class: 'arc-leg' },
      row(pic('pay'), 'Paycheque:', 'stamp it. +$60 cash.'),
      row(pic('sale'), 'SALE tag:', 'let it fall. Stamping it wastes $20.'),
      row(pic('phone'), 'Phone bill:', '$15'),
      row(pic('card'), 'Credit card bill:', '$25'),
      row(pic('ins'), 'Insurance bill:', '$35'),
      row(pic('rent'), 'Rent:', '$60')),
    h('p', { class: 'muted small' }, 'The dots along the bottom of a bill show its size. More dots, bigger bill.'),
    h('p', { class: 'label' }, 'Bill border colour'),
    h('ul', { class: 'arc-leg' },
      row(pic('phone', 'calm'), 'Blue:', 'lots of time.'),
      row(pic('phone', 'warn'), 'Orange:', 'almost at the pay zone.'),
      row(pic('phone', 'hot'), 'Red:', 'about to be late. Pay it now!')),
    h('p', { class: 'label' }, 'On the screen'),
    h('ul', { class: 'arc-leg' },
      row(pic('zone'), 'Yellow zone:', 'the only place you can stamp.'),
      row(pic('late'), 'Red line:', 'a bill past it is late. -20 points and -1 heart.'),
      row(pic('you'), 'You:', 'the wolf. Your lane glows yellow.'),
      row(pic('heart'), 'Hearts:', 'you start with 3. Lose them all and the round ends.')),
    h('p', { class: 'label' }, 'Pop-up words'),
    h('ul', { class: 'arc-leg' },
      word('+18', 'pts', 'points for a bill you paid'),
      word('+$60', 'cash', 'cash from a paycheque'),
      word('LATE', 'bad', 'a bill crossed the red line'),
      word('NSF', 'bad', '"non-sufficient funds": not enough cash to pay'),
      word('-$20', 'sale', 'cash wasted on a SALE tag')),
    h('p', { class: 'label' }, 'Side panels'),
    h('p', { class: 'muted small' }, 'Left: your CASH (and a green bar), your hearts, and the TIME left. Right: your SCORE, your BEST, how many bills you PAID and how many went LATE.'));
}

// Debt Snake's debrief line from the core's report(): debt and savings are in segments of $100.
const seg$ = (n) => `$${Number(n) * 100}`;
function snakeLine(s) {
  const bits = [`${s.payments} payment${s.payments === 1 ? '' : 's'} over ${s.months} month${s.months === 1 ? '' : 's'}.`,
    s.debt_free ? `You got debt free${s.savings ? ` and saved ${seg$(s.savings)}` : ''}.` : `You still owed ${seg$(s.debt)} at the end.`, `Your debt peaked at ${seg$(s.max_debt)}.`];
  if (s.fees) bits.push(`Hidden fees hit you ${s.fees} time${s.fees === 1 ? '' : 's'}.`);
  if (s.traps) bits.push(`You took the loan trap ${s.traps} time${s.traps === 1 ? '' : 's'}.`);
  return bits.join(' ');
}

// Debt Snake's legend: every item on the board, the top bar and the pop-up words. Pictures come from debtsnake.js (the game's own drawing code).
const snakePic = (name) => { const c = h('canvas', { class: 'arc-pic arc-pic-smooth', width: String(debtsnake.SW * 2), height: String(debtsnake.SW * 2), 'aria-hidden': 'true' }); debtsnake.swatch(c.getContext('2d'), name); return c; };
function snakeLegend() {
  return h('aside', { class: 'arc-legend', 'aria-label': 'Debt Snake legend' },
    h('p', { class: 'label' }, 'You'),
    h('ul', { class: 'arc-leg' },
      row(snakePic('snake'), 'Your snake:', 'gold head, teal body. Every segment after the first two is $100 of debt.'),
      row(snakePic('second'), 'Second snake:', 'Co-signer mode only. It mirrors you and shares your debt.')),
    h('p', { class: 'label' }, 'Coins and offers'),
    h('ul', { class: 'arc-leg' },
      row(snakePic('coin'), 'Payment coin:', 'eat it. -$100 of debt and +10 points. Once you are debt free it is savings: +10 points and you grow.'),
      row(snakePic('pair'), 'Linked coins (E-Transfer):', 'go into one and you come out of the other. One payment clears both.'),
      row(snakePic('locked'), 'Locked coin (PIN Unlock):', 'solid until you take the key.'),
      row(snakePic('key'), 'Key:', 'worth no points. It opens the nearest locked coin.'),
      row(snakePic('big'), 'Long coin (Big Purchase):', 'eat any part. -$300 and +30 points.'),
      row(snakePic('fading'), 'Blinking coin (Expiring Offer):', 'about to vanish. A missed coin adds $100 of debt.'),
      row(snakePic('crate'), 'Crate (Push the Paperwork):', 'push it onto the mailbox to pay.'),
      row(snakePic('mailbox'), 'Mailbox:', 'where the crate goes.'),
      row(snakePic('skull'), 'Skull (Payday Loan Trap):', 'quick cash that adds $300 of debt and costs 20 points. Skip it.')),
    h('p', { class: 'label' }, 'Other things on the board'),
    h('ul', { class: 'arc-leg' },
      row(snakePic('wall'), 'Wall:', 'crash and the round is over.'),
      row(snakePic('marker'), 'Faint square (Late Fees):', 'a wall block lands here next month.'),
      row(snakePic('stone'), 'Stone (Credit Record):', 'left behind by a payment. You crash into it.'),
      row(snakePic('zone'), 'Dashed zone with a flag (Hidden Fees):', 'one square inside hides a fee: +$200 of debt and -10 points.'),
      row(snakePic('fund'), 'Fund (Emergency Fund):', 'hold one and a crash turns you around instead.'),
      row(snakePic('arrow'), 'Arrow tile (Autopay):', 'it turns you its way.'),
      row(snakePic('tunnel'), 'Tunnel hole:', 'go in and come out of its partner.'),
      row(snakePic('gate'), 'Open gate (Credit Check):', 'open in even months.'),
      row(snakePic('gateshut'), 'Shut gate:', 'a wall in odd months. It flashes before it shuts.')),
    h('p', { class: 'label' }, 'The top bar'),
    h('ul', { class: 'arc-leg' },
      row(snakePic('bar'), 'Month bar:', 'fills for 60 moves. Then interest is charged.'),
      row(snakePic('warn'), 'Red and flashing:', 'interest comes in 8 moves. The tail flashes red too.')),
    h('p', { class: 'muted small' }, 'DEBT is what you owe in dollars. SAVED is what you have saved after you are debt free. Below the board: the mode and your best.'),
    h('p', { class: 'label' }, 'Pop-up words'),
    h('ul', { class: 'arc-leg' },
      word('-$100', 'pts', 'a payment: your debt went down'),
      word('+10', 'cash', 'points for savings'),
      word('+$100', 'bad', 'interest: new segments on your tail'),
      word('-10', 'bad', 'a hidden fee'),
      word('SAFE', 'pts', 'you picked up an emergency fund'),
      word('LATE', 'bad', 'an expiring coin was missed')));
}
