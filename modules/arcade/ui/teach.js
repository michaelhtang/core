import { h, api } from '/ui.js?v=__V__';

// Teacher panel for the Arcade: per class this season and for each game, the verified finishes, the rejected ones (and why), who has played, the best score and the last 10 rounds.
// Results are read only. The switches at the top of each class turn a game on or off for that class (POST /api/arcade/switch). Your own classes only
// (the server decides); names are the pseudonyms you see everywhere else.
const REASONS = { fast: 'too fast to be played' };
const said = (c) => `${c.finished} finished · ${c.players} player${c.players === 1 ? '' : 's'}`;               // no best here: the games score on different scales
const bestOf = (c) => (c.best ? ` · best ${c.best.score} by ${c.best.username}` : '');
const why = (c) => (c.rejected ? h('p', { class: 'muted small' }, `${c.rejected} rejected: ${Object.entries(c.rejected_by).map(([k, n]) => `${n} ${REASONS[k] ?? k}`).join(', ')}`) : '');
const when = (ms) => new Date(ms).toLocaleString('en-CA', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });

export async function render(el, ctx) {
  const box = h('div', { class: 'stack' });
  const msg = h('p', { role: 'status' });
  const say = (text, bad) => { msg.className = bad ? 'error' : 'ok'; msg.textContent = text; };
  // One checkbox per game for this class: the Arcade's own games, then Mr. Tang's linked games (marked "link"). A change saves at once.
  const switches = (c) => h('div', { class: 'stack' },
    h('p', { class: 'label' }, 'Games on for this class'),
    ...(c.switches ?? []).map((g) => {
      const cb = h('input', { type: 'checkbox', checked: g.on, onchange: async () => {
        cb.disabled = true;
        try { await api('/api/arcade/switch', { class_id: c.id, game: g.key, enabled: cb.checked }); say(`${g.title}: ${cb.checked ? 'on' : 'off'} for ${c.name}.`); }
        catch (e) { cb.checked = !cb.checked; say(e.message, true); }
        cb.disabled = false;
      } });
      return h('label', { class: 'check' }, cb, g.linked ? `${g.title} (link to its own site)` : g.title);
    }));
  async function load() {
    const { classes, season } = await api('/api/arcade/teach');
    msg.textContent = '';
    box.replaceChildren(...(classes.length ? classes.map((c) => h('div', { class: 'class-card' },
      h('p', {}, h('strong', {}, c.name), ` · all games: ${said(c)}`),
      switches(c),
      ...c.games.map((g) => h('div', { class: 'stack' },
        h('p', {}, h('b', {}, g.title), ` · ${said(g)}${bestOf(g)}`),
        why(g),
        g.recent.length ? h('div', { class: 'table-wrap' }, h('table', { 'aria-label': `${c.name}: ${g.title}, recent rounds` },
          h('thead', {}, h('tr', {}, h('th', {}, 'Student'), h('th', { class: 'num' }, 'Score'), h('th', {}, 'When'))),
          h('tbody', {}, g.recent.map((r) => h('tr', {}, h('td', {}, r.username ?? ''), h('td', { class: 'num' }, String(r.score)), h('td', {}, when(r.at))))))) : h('p', { class: 'muted' }, season ? 'No finished rounds yet.' : 'No season is running.'))))) : [h('p', { class: 'muted' }, 'Create a class first.')]));
  }
  el.append(h('div', { class: 'spread' }, h('h2', {}, 'Arcade'), h('button', { class: 'ghost', type: 'button', onclick: () => load().catch((e) => { msg.className = 'error'; msg.textContent = e.message; }) }, 'Refresh')),
    h('p', { class: 'muted small' }, 'Turn a game off for a class and that class no longer sees it in the Arcade and cannot start it. For Bill Dash and Diversify, the Today errand to play it stops being offered from the next class day (an errand already handed out today stays on the list). Below the switches: Bill Dash and Diversify rounds this season. The server replays every round, so a score here is verified; a round that ends faster than it can be played is rejected.'), box, msg);
  ctx?.onRefresh(() => load().catch(() => {}));
  await load();
}
