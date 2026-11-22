import { h, api, guard } from '/ui.js?v=__V__';
import { play, VW, VH } from '/m/walk/town/town.js?v=__V__';
import { DOORS, C } from '/m/walk/town/town-core.js?v=__V__';
import { FACTS, SIGNS } from '/m/walk/town/facts.js?v=__V__';
import { createPresence } from '/m/walk/town/presence.js?v=__V__';
import { emoteIcon } from '/m/walk/town/art.js?v=__V__';

// The Town Walk building: an intro card, then a top-down town. You walk (keys, d-pad or a tap on the map), pick up six items and walk into lit doors to
// open the buildings. What you collected is counted by the server, which replays your recorded inputs with the seed it chose at /start (docs/walk.md).
const ERRAND = 'Take a stroll through town and collect 3 items';
const doorKeys = new Set(DOORS.map((d) => d.key));
const EMOTE_NAMES = [null, 'Wave', 'Thumbs up', 'Star'];
// A POST that still goes out while the page is closing (keepalive: the browser finishes it after the page is gone). Same origin, same cookie, JSON.
// Used for the finish (every path, so a tab closed mid-visit, whether visibilitychange or pagehide comes first, sends exactly one) and for presence's leave.
const post = (path, body) => fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), keepalive: true, signal: AbortSignal.timeout(90000) });   // 90 s like api(): a hung finish must not leave the summary stuck
const bye = (path, body) => { try { post(path, body).catch(() => {}); } catch { /* nothing to do */ } };
const clock = (secs) => `${secs / 60 | 0}:${String(secs % 60).padStart(2, '0')}`;

export async function render(el, ctx) {
  if (!document.querySelector('link[data-walk]')) document.head.append(h('link', { rel: 'stylesheet', href: '/m/walk/walk.css?v=__V__', 'data-walk': '' }));
  const view = h('div', { class: 'stack' });
  const msg = h('p', { role: 'status' });
  const say = (text, bad) => { msg.className = bad ? 'error' : 'ok'; msg.textContent = text; };
  let current = null;                                               // the visit being walked, so leaving or starting another stops it
  let presenceOn = false;                                           // from /state: the teacher's config switch (options.walk.presence)
  el.append(h('h2', {}, 'Town Walk'), view, msg);
  const openKeys = () => new Set((ctx.me.panels ?? []).map((p) => p.building.key).filter((k) => doorKeys.has(k)));

  async function home() {
    msg.textContent = '';
    let st;
    try { st = await api('/api/walk/state'); } catch (e) { view.replaceChildren(h('p', { class: 'error' }, e.message), h('button', { type: 'button', onclick: guard(home) }, 'Try again')); return; }
    presenceOn = st.presence === true;
    view.replaceChildren(h('div', { class: 'walk-card' },
      h('div', { class: 'spread' }, h('b', {}, 'Take a walk'), h('span', { class: 'chip' }, st.my_best == null ? 'No visits yet' : `Best ${st.my_best}/${st.items}`)),
      h('p', {}, `Stroll around town and pick up ${st.items} items. Each one is a small money fact. Lit doors open the buildings. You have 3 minutes.`),
      h('p', { class: 'muted small' }, 'Arrows or WASD to walk, or tap the map to go there. On a phone use the arrow buttons under the map. Walk onto a lit door to go inside.'),
      presenceOn ? h('p', { class: 'muted small' }, 'Classmates who are on this screen too show up as little wolves with a name tag. Press 1, 2 or 3 (or the buttons) to wave, give a thumbs-up or send a star. There is no chat.') : h('span', {}),
      h('button', { type: 'button', disabled: !st.world_active, onclick: guard(() => begin()) }, st.world_active ? 'Play' : 'The season is closed')));
  }

  // One visit: start (the server picks the seed), walk, then send only the inputs.
  async function begin() {
    current?.stop();
    msg.textContent = '';
    let round;
    try { round = await api('/api/walk/start', {}); } catch (e) { say(e.message, true); return; }
    document.activeElement?.blur?.();
    let markers = new Set();                                         // doors with an open errand today (read only; today may be off)
    try { markers = new Set((await api('/api/today/state')).errands.filter((x) => x.status === 'open' && x.building && doorKeys.has(x.building)).map((x) => x.building)); } catch { /* no markers */ }
    const canvas = h('canvas', { class: 'walk-canvas', width: String(VW), height: String(VH), role: 'img', 'aria-label': 'Top-down map of the town. Use the arrow keys or the buttons to walk.' });
    const fit = () => {                                              // the largest whole-number scale that fits the panel (walk-x1 .. walk-x4)
      const room = Math.floor(((el.clientWidth || 320) - 4) / VW);
      const tall = Math.floor((innerHeight - 260) / VH);
      canvas.className = `walk-canvas walk-x${Math.max(1, Math.min(4, room, tall))}`;
    };
    const count = h('b', {}, `0/${C.ITEMS}`), time = h('b', {}, clock(C.MAX_TICKS / C.TPS | 0));
    const fact = h('div', { class: 'walk-fact', role: 'status', 'aria-live': 'polite' }, h('span', { class: 'muted small' }, 'Pick up the sparkling items. Each one has a money fact.'));
    const pad = (label, sym, bit, cls) => {
      const b = h('button', { type: 'button', class: `walk-pad ${cls}`, 'aria-label': label }, sym);
      const set = (down) => (e) => { e.preventDefault(); if (down) { try { b.setPointerCapture(e.pointerId); } catch { /* a synthetic or already-ended pointer: fine */ } } current?.press(bit, down); b.classList.toggle('walk-down', down); };
      b.addEventListener('pointerdown', set(true)); b.addEventListener('pointerup', set(false)); b.addEventListener('pointercancel', set(false)); b.addEventListener('contextmenu', (e) => e.preventDefault());
      return b;
    };
    const leave = h('button', { type: 'button', class: 'ghost walk-leave', onclick: () => current?.stop('leave') }, 'Leave');
    const here = h('span', { class: 'walk-here', role: 'status' }, '');
    const pres = presenceOn ? createPresence({
      post: (path, body) => api(path, body), leave: () => bye('/api/walk/leave', {}), on: ctx.on,
      onCount: (n) => { here.textContent = `${n} classmate${n === 1 ? '' : 's'} here`; },
    }) : null;
    const emoteBtn = (n) => {                                        // 48 px or more to tap; the icon is the same pixel art the others see
      const icon = h('canvas', { class: 'walk-emoji', width: '10', height: '10', 'aria-hidden': 'true' });
      emoteIcon(icon.getContext('2d'), n, 1, 1, 0);
      return h('button', { type: 'button', class: 'ghost walk-emote', 'aria-label': `${EMOTE_NAMES[n]} (key ${n})`, onclick: () => pres?.emote(n) }, icon, h('span', { class: 'small' }, String(n)));
    };
    view.replaceChildren(
      h('div', { class: 'walk-hud' }, h('span', {}, 'Items ', count), h('span', {}, 'Time ', time), leave),
      h('div', { class: 'walk-stage' }, canvas),
      pres ? h('div', { class: 'walk-social' }, here, h('div', { class: 'walk-emotes', role: 'group', 'aria-label': 'Emotes' }, emoteBtn(1), emoteBtn(2), emoteBtn(3))) : h('span', {}),
      fact,
      h('div', { class: 'walk-pads', 'aria-label': 'Touch controls' }, pad('Up', '↑', 1, 'walk-u'), pad('Left', '←', 4, 'walk-l'), pad('Down', '↓', 2, 'walk-d'), pad('Right', '→', 8, 'walk-r')));
    fit();
    const onResize = () => fit();
    window.addEventListener('resize', onResize);
    const run = play(canvas, {
      seed: round.seed, open: openKeys(), markers, presence: pres,
      onHud: ({ collected, left }) => { count.textContent = `${collected}/${C.ITEMS}`; time.textContent = clock(left); },
      onCollect: (it) => { const f = FACTS[it.kind]; fact.replaceChildren(h('b', {}, `${f.name}. `), f.fact); },
    });
    current = run;
    // Closing the tab or navigating away mid-visit: end the visit now. The finish it sends is a keepalive request (send below), so it survives the unload.
    // A tab that goes hidden first (the usual order) has already ended the visit; this is then a no-op.
    const onHide = () => run.stop('closed');
    window.addEventListener('pagehide', onHide);
    const end = await run.done;
    current = null;
    window.removeEventListener('pagehide', onHide);
    window.removeEventListener('resize', onResize);
    pres?.stop();                                                    // leaves the class's presence list and stops listening
    if (end.ticks === 0) { if (end.reason !== 'closed') await home(); return; }   // left before the first tick: nothing to count, cancel quietly (no finish call, no error)
    if (end.reason === 'enter') {                                    // count what was collected first, then go in (a slow network does not hold the door shut)
      const sent = send(round.session, end);
      await Promise.race([sent.catch(() => null), new Promise((r) => setTimeout(r, 2500))]);
      location.hash = `#${end.door}`;
      return;
    }
    if (end.reason === 'closed') { send(round.session, end).catch(() => null); return; }   // the panel is gone: just record the visit
    await finishView(round, end);
  }

  // Same as api() (same errors and .status) but keepalive, so a finish started while the page is closing still arrives. 2000 inputs is about 20 KB, under the 64 KB keepalive limit.
  async function send(session, end) {
    const res = await post('/api/walk/finish', { session, ticks: end.ticks, inputs: end.inputs }).catch(() => { throw new Error('Could not reach core. Check your connection and try again.'); });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw Object.assign(new Error(data.error || 'Something went wrong'), { status: res.status });
    return data;
  }

  // Send the recorded inputs. A dropped connection keeps them for a retry (the server accepts a visit once).
  async function finishView(round, end) {
    view.replaceChildren(h('p', {}, 'Visit over. Checking what you collected with the server…'));
    let res;
    try { res = await send(round.session, end); } catch (e) {
      const final = e.status !== undefined && e.status !== 429 && e.status < 500;     // a refusal from the server is final; a network failure is retried
      view.replaceChildren(h('p', { class: 'error' }, e.message), ...(final ? [h('button', { type: 'button', onclick: guard(() => begin()) }, 'Walk again')]
        : [h('button', { type: 'button', onclick: guard(() => finishView(round, end)) }, 'Try sending again')]),
      h('button', { type: 'button', class: 'ghost', onclick: guard(home) }, 'Back'));
      return;
    }
    let errand = null;                                               // Today's errand, if today is on and it is done
    try { errand = (await api('/api/today/state')).errands.find((x) => x.title === ERRAND && x.status === 'done') ?? null; } catch { /* today is off or closed: no note */ }
    const byId = new Map(round.items.map((it) => [it.id, it]));
    const got = res.items.map((id) => byId.get(id)).filter(Boolean);
    view.replaceChildren(
      h('div', { class: 'walk-card' },
        h('p', { class: 'label' }, 'Verified by the server'),
        h('p', { class: 'walk-score' }, `${res.collected}/${C.ITEMS}`),
        res.new_best && res.collected > 0 ? h('p', { class: 'ok' }, 'A new personal best!') : h('p', { class: 'muted' }, `Your best: ${res.best}/${C.ITEMS}`),
        errand ? h('p', { class: 'ok' }, `Today's errand is done: ${ERRAND}.`) : h('span', {}),
        res.collected < 3 ? h('p', { class: 'muted small' }, 'Collect 3 items in one walk to finish the errand.') : h('span', {})),
      got.length ? h('div', { class: 'stack' }, h('p', { class: 'label' }, 'What you picked up'),
        ...got.map((it) => h('div', { class: 'walk-learned' }, h('b', {}, FACTS[it.kind].name), h('p', { class: 'small' }, FACTS[it.kind].fact)))) : h('p', { class: 'muted' }, 'You did not pick anything up this time.'),
      h('div', { class: 'walk-actions' }, h('button', { type: 'button', onclick: guard(() => begin()) }, 'Play again'), h('button', { type: 'button', class: 'ghost', onclick: guard(home) }, 'Back')));
  }

  await home();
}
