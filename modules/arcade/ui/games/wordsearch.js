// The daily word search (docs/arcade.md, "Word search"). The browser only draws: the server sends the letters and the clues, checks every
// selection against the placements it keeps, and sends a word only once it is found or asked for. A miss costs nothing.
const STEPS = [
  'Each clue is a meaning from your lessons with the word blanked out. Work out the word, then find it in the grid.',
  'Drag across the letters, or tap the first letter and then the last. On Easy, words run across and down. On Hard they run any way, even backwards.',
  'Stuck? "Show word" tells you the word, and a second tap lights up its first letter. Fewer hints, more stars.',
];
const FOUND_COLOURS = 8;                                             // arc-ws-f0 .. arc-ws-f7 in wordsearch.css

export async function play(view, { h, api, say, guard, back, msg }) {
  if (!document.querySelector('link[data-wordsearch]')) document.head.append(h('link', { rel: 'stylesheet', href: '/m/arcade/wordsearch.css?v=__V__', 'data-wordsearch': '' }));
  let level = 'easy', st, busy = false, focus = [0, 0], pending = null, drag = null;
  const key = (r, c) => `${r},${c}`;
  try { st = await api(`/api/arcade/wordsearch?level=${level}`); } catch (e) { say(e.message, true); return; }
  if (st.levels.easy === 'done' && st.levels.hard !== 'done') { try { st = await api('/api/arcade/wordsearch?level=hard'); level = 'hard'; } catch { /* stay on Easy */ } }   // Easy done today: open on Hard

  const levelBar = h('div', { class: 'arc-ws-levels', role: 'group', 'aria-label': 'Puzzle size' });
  const grid = h('div', { class: 'arc-ws-grid', role: 'grid', 'aria-label': 'Letter grid' });
  const status = h('p', { role: 'status', class: 'arc-ws-status' });
  const clues = h('ol', { class: 'arc-ws-clues', 'aria-label': 'Clues' });
  const after = h('div', { class: 'stack' });

  // cell -> index of the found word that covers it (the latest wins), and the start cells lit by a hint
  const paint = () => {
    const owner = new Map(), lit = new Set();
    st.clues.forEach((c) => { c.cells?.forEach(([r, q]) => owner.set(key(r, q), c.n)); if (c.start) lit.add(key(...c.start)); });
    const sel = new Set((drag?.cells ?? (pending ? [pending] : [])).map((x) => key(...x)));
    for (const b of grid.querySelectorAll('.arc-ws-cell')) {
      const k = key(+b.dataset.r, +b.dataset.c), o = owner.get(k);
      b.className = `arc-ws-cell${o !== undefined ? ` arc-ws-f${o % FOUND_COLOURS}` : ''}${lit.has(k) ? ' arc-ws-start' : ''}${sel.has(k) ? ' arc-ws-sel' : ''}`;
      b.tabIndex = k === key(...focus) ? 0 : -1;
    }
  };
  function drawGrid() {
    grid.style.setProperty('--n', String(st.size));
    grid.replaceChildren(...st.grid.map((row, r) => h('div', { role: 'row', class: 'arc-ws-row' }, [...row].map((ch, c) =>
      h('button', { type: 'button', role: 'gridcell', class: 'arc-ws-cell', 'data-r': String(r), 'data-c': String(c), 'aria-label': `${ch}, row ${r + 1}, column ${c + 1}` }, ch)))));
    paint();
  }
  function draw() {
    levelBar.replaceChildren(...Object.entries({ easy: 'Easy', hard: 'Hard' }).map(([l, label]) => h('button', {
      type: 'button', 'aria-pressed': String(l === level), disabled: busy,
      onclick: guard(async () => { if (l === level || busy) return; busy = true; draw(); try { st = await api(`/api/arcade/wordsearch?level=${l}`); level = l; pending = null; focus = [0, 0]; msg.textContent = ''; } catch (e) { say(e.message, true); } busy = false; drawGrid(); draw(); }),
    }, `${label}${st.levels[l] === 'done' ? ' ✓' : ''}`)));
    const left = st.clues.filter((c) => !c.found).length;
    status.textContent = st.status === 'done' ? `All ${st.clues.length} words found.` : `${st.clues.length - left} of ${st.clues.length} found.${pending ? ' Now tap the last letter.' : ''}`;
    clues.replaceChildren(...st.clues.map((c) => h('li', { class: `arc-ws-clue${c.found ? ` arc-ws-got arc-ws-f${c.n % FOUND_COLOURS}` : ''}` },
      h('p', { class: 'small muted' }, `${c.length} letters · ${c.section}`),
      c.found ? h('p', {}, h('b', {}, `${c.word} ✓ `), c.meaning) : h('p', {}, c.clue),
      !c.found && c.word ? h('p', { class: 'arc-ws-word' }, c.hints >= 2 ? `${c.word}: its first letter is lit up in the grid.` : c.word) : null,
      !c.found && c.hints < 2 ? h('button', { type: 'button', class: 'ghost small', disabled: busy, onclick: guard(() => hint(c.n)) }, c.hints ? 'Show first letter' : 'Show word') : null)));
    after.replaceChildren(...(st.status === 'done' ? [endCard()] : []), stats());
    paint();
  }
  const endCard = () => h('div', { class: 'arc-card' },
    h('p', { class: 'label' }, 'Puzzle done'),
    h('p', { class: 'arc-score', 'aria-label': `${st.stars} of 3 stars` }, '★'.repeat(st.stars) + '☆'.repeat(3 - st.stars)),
    h('p', {}, st.hints_used ? `You used ${st.hints_used} ${st.hints_used === 1 ? 'hint' : 'hints'}.` : 'No hints used.'),
    h('p', { class: 'muted small' }, level === 'easy' && st.levels.hard !== 'done' ? 'Try Hard for more words in every direction. A new puzzle comes tomorrow.' : 'A new puzzle comes tomorrow.'));
  const stats = () => h('div', { class: 'arc-card', 'aria-label': 'Your stats' },
    h('p', { class: 'label' }, 'Your stats'),
    h('div', { class: 'arc-wl-stats' }, [['Puzzles done', st.stats.done], ['Streak', st.stats.current_streak], ['Best streak', st.stats.best_streak]].map(([l, v]) => h('div', {}, h('b', {}, String(v)), h('span', { class: 'small muted' }, l)))));

  async function send(from, to) {
    if (busy || st.status === 'done') return;
    busy = true; draw();                                                // the level and hint buttons are off until the answer is in
    try {
      st = await api('/api/arcade/wordsearch/find', { level, from, to });
      if (st.hit != null) say(`Found ${st.clues[st.hit].word}!`);
      else { say(st.again ? 'You found that one already.' : 'That is not one of the words. Try again.', true); grid.classList.remove('arc-ws-miss'); void grid.offsetWidth; grid.classList.add('arc-ws-miss'); }
    } catch (e) { say(e.message, true); }
    busy = false; draw();
  }
  async function hint(n) {
    if (busy) return;
    busy = true; draw();
    try { st = await api('/api/arcade/wordsearch/hint', { level, clue: n }); msg.textContent = ''; } catch (e) { say(e.message, true); }
    busy = false; draw();
  }

  // Selection. A drag snaps to the nearest of the 8 directions from the first cell; a tap (or Enter on a focused cell) picks the first letter, the next one the last.
  const cellAt = (x, y) => document.elementFromPoint(x, y)?.closest?.('.arc-ws-cell');
  const rc = (b) => [+b.dataset.r, +b.dataset.c];
  const line = ([r0, c0], [r, c]) => {
    const dy = r - r0, dx = c - c0;
    if (!dy && !dx) return [[r0, c0]];
    const a = Math.round(Math.atan2(dy, dx) / (Math.PI / 4)), dr = Math.round(Math.sin(a * Math.PI / 4)), dc = Math.round(Math.cos(a * Math.PI / 4));
    let len = dr && dc ? Math.round((dy * dr + dx * dc) / 2) : Math.abs(dr ? dy : dx);
    while (len > 0 && !(r0 + dr * len >= 0 && r0 + dr * len < st.size && c0 + dc * len >= 0 && c0 + dc * len < st.size)) len--;
    return Array.from({ length: Math.max(0, len) + 1 }, (_, i) => [r0 + dr * i, c0 + dc * i]);
  };
  const straight = ([r0, c0], [r, c]) => r === r0 || c === c0 || Math.abs(r - r0) === Math.abs(c - c0);
  function tap(cell) {
    if (busy || st.status === 'done') return;
    if (!pending) pending = cell;
    else if (key(...pending) === key(...cell)) pending = null;
    else if (!straight(pending, cell)) { pending = cell; say('Pick a last letter in a straight line from the first: across, down or diagonal.', true); }
    else { const from = pending; pending = null; send(from, cell); }
    draw();
  }
  grid.addEventListener('pointerdown', (e) => {
    const b = e.target.closest?.('.arc-ws-cell');
    if (!b || e.button > 0 || busy || st.status === 'done') return;
    e.preventDefault();
    try { grid.setPointerCapture(e.pointerId); } catch { /* no live pointer (a synthetic event): moves still reach the grid */ }
    drag = { start: rc(b), cells: [rc(b)], moved: false };
    focus = rc(b); paint();
  });
  grid.addEventListener('pointermove', (e) => {
    if (!drag) return;
    const b = cellAt(e.clientX, e.clientY);
    if (!b || !grid.contains(b)) return;
    drag.cells = line(drag.start, rc(b));
    if (drag.cells.length > 1) drag.moved = true;
    paint();
  });
  const end = () => {
    if (!drag) return;
    const d = drag; drag = null;
    if (d.moved && d.cells.length > 1) { pending = null; send(d.cells[0], d.cells[d.cells.length - 1]); paint(); }
    else if (d.moved) paint();                                          // dragged away and back: nothing picked
    else tap(d.start);
  };
  grid.addEventListener('pointerup', end);
  grid.addEventListener('pointercancel', () => { drag = null; paint(); });
  grid.addEventListener('click', (e) => { const b = e.target.closest?.('.arc-ws-cell'); if (b && e.detail === 0) tap(rc(b)); });   // Enter or Space on a focused cell (a pointer tap is handled above)
  grid.addEventListener('focusin', (e) => { const b = e.target.closest?.('.arc-ws-cell'); if (b) focus = rc(b); });   // arrows move on from whichever cell has focus
  grid.addEventListener('keydown', (e) => {
    const d = { ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] }[e.key];
    if (!d) { if (e.key === 'Escape' && pending) { pending = null; draw(); } return; }
    e.preventDefault();
    focus = [Math.min(st.size - 1, Math.max(0, focus[0] + d[0])), Math.min(st.size - 1, Math.max(0, focus[1] + d[1]))];
    paint();
    grid.querySelector(`[data-r="${focus[0]}"][data-c="${focus[1]}"]`)?.focus();
  });

  const backBtn = h('button', { type: 'button', class: 'ghost arc-back', onclick: guard(back) }, 'Back to all games');
  view.replaceChildren(backBtn, h('div', { class: 'arc-card' },
    h('div', { class: 'spread' }, h('b', {}, st.title), h('span', { class: 'chip' }, st.day)),
    h('details', { class: 'arc-how', open: !st.stats.done }, h('summary', {}, 'How to play'), h('ol', { class: 'arc-steps' }, STEPS.map((t) => h('li', {}, t)))),
    levelBar, grid, status, clues), after);
  drawGrid(); draw();
}
