import { h, api, guard } from '/ui.js?v=__V__';

// Teacher panel for Town Walk: per class this season's visits and what students collected, who is on the map right now (live: the server pushes walk.roster
// when someone joins or leaves, no polling) and the presence switch (off hides classmates for that class at once). Your own classes only.
export async function render(el, ctx) {
  const box = h('div', { class: 'stack' });
  const msg = h('p', { role: 'status' });
  const roster = new Map();                                         // class id -> the <p> that shows who is on the map
  const sayWho = (p, players) => { p.textContent = players.length ? `On the map now (${players.length}): ${players.join(', ')}` : 'Nobody is on the map right now.'; };
  const fail = (e) => { msg.className = 'error'; msg.textContent = e.message; };

  async function load() {
    const { classes } = await api('/api/walk/teach');
    msg.textContent = '';
    roster.clear();
    box.replaceChildren(...(classes.length ? classes.map((c) => {
      const who = h('p', { class: 'small', role: 'status' });
      sayWho(who, c.presence ? c.on_map.players : []);
      if (!c.presence) who.textContent = 'Classmate presence is off for this class.';
      roster.set(c.id, { who, on: c.presence });
      return h('div', { class: 'class-card' },
        h('div', { class: 'spread' },
          h('p', {}, h('strong', {}, c.name), ` · ${c.visits} visit${c.visits === 1 ? '' : 's'} · ${c.players} player${c.players === 1 ? '' : 's'}${c.rejected ? ` · ${c.rejected} rejected` : ''}`),
          h('button', { type: 'button', class: 'ghost', 'aria-pressed': String(c.presence), onclick: guard(async () => {
            try { await api('/api/walk/settings', { class_id: c.id, presence: !c.presence }); await load(); } catch (e) { fail(e); }
          }) }, c.presence ? 'Presence: on (turn off)' : 'Presence: off (turn on)')),
        h('p', { class: 'muted small' }, `Items collected per visit: ${Object.entries(c.items).map(([range, n]) => `${range}: ${n}`).join(' · ')}`),
        who);
    }) : [h('p', { class: 'muted' }, 'Create a class first.')]));
  }

  el.append(h('div', { class: 'spread' }, h('h2', {}, 'Town Walk'), h('button', { class: 'ghost', type: 'button', onclick: () => load().catch(fail) }, 'Refresh')),
    h('p', { class: 'muted small' }, 'Visits this season. Presence lets students on the map see classmates as little wolves with a name tag; turn it off for a class and their maps hide everyone at once.'), box, msg);
  ctx?.on('walk.roster', (ev) => {                                    // pushed to you when a student of your class joins or leaves the map
    let d;
    try { d = JSON.parse(ev.data); } catch { return; }
    const r = roster.get(d?.class_id);
    if (r?.on && Array.isArray(d.players)) sayWho(r.who, d.players);
  });
  ctx?.onRefresh(() => load().catch(() => {}));
  await load();
}
