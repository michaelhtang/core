import { h, api } from '/ui.js?v=__V__';
import { play } from '/m/learn/player.js?v=__V__';
import { shownUnits, unitLine } from '/m/learn/teachmath.js?v=__V__';

// Teacher panel for the Learning Road, one class at a time: a line per unit (who finished it, level finishes, the level with the lowest first try),
// which opens to that unit's levels and the three questions the class missed most on the first try. Read only. Your own classes only (the server
// decides). Students are shown by their game usernames. The long parts (the units checklist, the student table, each unit's levels) are folded.
// "Units open to this class": tick the units students may play. Saved with POST /api/learn/open-units; the server decides who may. Folded to one
// line that says how many are open; `onSaved` runs after a save so the unit list below can follow.
function openPicker(c, onSaved) {
  if (!c.open_sections?.length) return '';
  const status = h('span', { role: 'status', class: 'muted small' }), summary = h('span', { class: 'muted' });
  const all = c.open_sections.flatMap((sec) => sec.units.map((u) => u.id)), boxes = new Map();
  const ticked = () => all.filter((id) => boxes.get(id).checked);
  const say = (text, bad) => { status.className = bad ? 'error small' : 'muted small'; status.textContent = text; };
  const count = () => { summary.textContent = c.open_units === null ? 'every unit is open' : `${c.open_units.length} of ${all.length} units ${c.open_units.length === 1 ? 'is' : 'are'} open`; };
  const sections = c.open_sections.map((sec) => {
    const set = (on) => { for (const u of sec.units) boxes.get(u.id).checked = on; };
    // each unit is one label that wraps its checkbox, so the box and its name sit on one line and the whole line is the target
    return h('fieldset', { class: 'ln-openset' }, h('legend', {}, sec.title),
      h('div', { class: 'ln-opengrid' }, sec.units.map((u) => { const box = h('input', { type: 'checkbox' }); box.checked = c.open_units === null || c.open_units.includes(u.id); boxes.set(u.id, box); return h('label', { class: 'ln-openitem' }, box, h('span', {}, u.title)); })),
      h('div', { class: 'ln-openbtns' }, h('button', { type: 'button', class: 'ghost', 'aria-label': `Open all units in ${sec.title}`, onclick: () => set(true) }, 'Open all'),
        h('button', { type: 'button', class: 'ghost', 'aria-label': `Close all units in ${sec.title}`, onclick: () => set(false) }, 'Close all')));
  });
  const send = async (body, done) => {
    saveBtn.disabled = clearBtn.disabled = true; say('Saving…');
    try { const r = await api('/api/learn/open-units', { class_id: c.id, ...body }); c.open_units = r.open_units; count(); say(done); onSaved(); }
    catch (e) { say(e.message, true); }
    saveBtn.disabled = clearBtn.disabled = false;
  };
  const saveBtn = h('button', { type: 'button', onclick: () => send({ units: ticked() }, 'Saved.') }, 'Save');
  const clearBtn = h('button', { type: 'button', class: 'ghost', onclick: async () => { await send({ all: true }, 'Saved. Every unit is open.'); if (c.open_units === null) for (const b of boxes.values()) b.checked = true; } }, 'Open everything (clear this setting)');
  count();
  return h('details', { class: 'ln-fold' }, h('summary', {}, 'Units open to this class: ', summary), h('div', { class: 'stack' },
    h('p', { class: 'muted small' }, 'Students of this class can play only the units you tick. Ticked units still unlock in order. You can change this at any time; progress is kept.'),
    ...sections, h('div', { class: 'spread' }, saveBtn, clearBtn, status)));
}

// "Preview a lesson": any level of any course, played as a student sees it (the player's preview mode). Nothing is saved or paid, and it needs no class and no
// season. The lesson is mounted in `stage`, outside the class cards, so a refresh of the cards cannot wipe a lesson in progress.
function previewPicker(courses, stage) {
  const groups = new Map(), byId = new Map();
  for (const c of courses) for (const u of c.units) {
    const g = courses.length > 1 ? `${c.title}: ${u.section}` : u.section;
    if (!groups.has(g)) groups.set(g, []);
    groups.get(g).push(u); byId.set(u.id, u);
  }
  if (!byId.size) return h('p', { class: 'muted' }, 'There are no lessons to preview yet.');
  const unitSel = h('select', { 'aria-label': 'Unit to preview' }, [...groups].map(([g, us]) => h('optgroup', { label: g }, us.map((u) => h('option', { value: u.id }, u.title)))));
  const levelSel = h('select', { 'aria-label': 'Level to preview' });
  const fill = () => levelSel.replaceChildren(...byId.get(unitSel.value).levels.map((l) => h('option', { value: l.id }, `${l.n}. ${l.title}`)));
  unitSel.addEventListener('change', fill);
  fill();
  const go = h('button', { type: 'button', onclick: () => {
    go.disabled = true;
    // Choosing another console view (a hash change) ends the preview: the player lets go of the keyboard and the full screen on a hash change,
    // and what it leaves behind is cleared here so the panel is ready for the next preview.
    const close = () => { window.removeEventListener('hashchange', close); stage.replaceChildren(); go.disabled = false; };
    window.addEventListener('hashchange', close);
    play(stage, { levelId: levelSel.value, preview: true, onDone: (r) => {
      close();
      if (r && levelSel.selectedIndex < levelSel.options.length - 1) levelSel.selectedIndex += 1;   // finished: line up the next level of the unit
      go.focus();
    } });
  } }, 'Preview this level');
  return h('div', { class: 'stack' }, h('h3', {}, 'Preview a lesson'),
    h('p', { class: 'muted small' }, 'Play any level the way a student sees it. Nothing is saved, nobody is paid, and it works without a class or a season.'),
    h('div', { class: 'row ln-previewrow' }, unitSel, levelSel, go));
}

export async function render(el, ctx) {
  if (!document.querySelector('link[data-learn]')) document.head.append(h('link', { rel: 'stylesheet', href: '/m/learn/learn.css?v=__V__', 'data-learn': '' }));   // the checklist's styles
  const box = h('div', { class: 'stack' });
  const msg = h('p', { role: 'status' });
  const picker = h('div', {}), stage = h('div', {});
  // What the teacher chose survives a refresh: the class, the units that are opened, the student table, and each class's units checklist
  // (kept as the same element, so ticks that are not saved yet are not lost).
  let data = null, drawn = '', chosen = null, rosterOpen = false, closedOpen = false;
  const openUnits = new Set(), pickers = new Map();   // "<class id>/<unit id>"; class id -> { c, el }
  const reload = () => load().catch((e) => { msg.className = 'error'; msg.textContent = e.message; });
  const openKey = (c) => JSON.stringify([c.open_units, c.open_sections]);
  const num = (text) => h('span', { class: 'ln-unitnum' }, text);

  function unitRow(c, u, season) {
    const key = `${c.id}/${u.id}`, line = unitLine(u, c.students);
    const d = h('details', { class: 'ln-unit', ontoggle: () => { if (d.open) openUnits.add(key); else openUnits.delete(key); } },
      h('summary', {}, h('span', { class: 'ln-unitname' }, u.title), num(`${line.done} / ${c.students}`), num(`${line.finished} / ${line.total}`), num(line.lowest ? `${line.lowest.median_first_try_pct}%` : '–')),
      h('div', { class: 'ln-unitbody' },
        h('div', { class: 'table-wrap' }, h('table', { 'aria-label': `${c.name}: ${u.title}, levels finished` },
          h('thead', {}, h('tr', {}, h('th', {}, 'Level'), h('th', { class: 'num' }, 'Finished'), h('th', { class: 'num' }, 'Median first try'))),
          h('tbody', {}, u.levels.map((l) => h('tr', {}, h('td', {}, `${l.n}. ${l.title}`), h('td', { class: 'num' }, `${l.finished} / ${c.students}`), h('td', { class: 'num' }, l.median_first_try_pct === null ? '–' : `${l.median_first_try_pct}%`)))))),
        u.hardest.length ? h('div', {}, h('p', { class: 'muted small' }, 'Questions missed most on the first try'),
          h('ol', {}, u.hardest.map((x) => h('li', {}, `${x.prompt} — ${x.first_try_pct}% right first try (${x.answered} answered, ${x.level})`)))) : h('p', { class: 'muted small' }, season ? 'No finished levels yet.' : 'No season is running.')));
    d.open = openUnits.has(key);
    return d;
  }

  function draw() {
    const { classes, season } = data;
    if (!classes.length) return box.replaceChildren(h('p', { class: 'muted' }, 'Create a class first.'));
    const c = classes.find((x) => String(x.id) === chosen) ?? classes[0];
    chosen = String(c.id);
    const classSel = classes.length > 1 ? h('label', {}, 'Class', h('select', { onchange: (e) => { chosen = e.currentTarget.value; draw(); box.querySelector('label > select')?.focus(); } },   // the picker is redrawn with the class: keep the keyboard on it
      classes.map((x) => h('option', { value: String(x.id), selected: x === c }, `${x.name} (${x.students})`)))) : null;
    let p = pickers.get(c.id);
    if (!p || openKey(p.c) !== openKey(c)) { p = { c, el: c.open_sections?.length ? openPicker(c, reload) : null }; pickers.set(c.id, p); }   // rebuilt only when the setting changed somewhere else
    const roster = c.roster?.length ? h('details', { class: 'ln-fold', ontoggle: () => { rosterOpen = roster.open; } }, h('summary', {}, 'Students: streaks and XP ', h('span', { class: 'muted' }, String(c.roster.length))),
      h('div', { class: 'table-wrap' }, h('table', { 'aria-label': `${c.name}: streaks` },
        h('thead', {}, h('tr', {}, h('th', {}, 'Student'), h('th', { class: 'num' }, 'Streak'), h('th', { class: 'num' }, 'Best'), h('th', { class: 'num' }, 'Kept in 7 days'), h('th', { class: 'num' }, 'XP this week'))),
        h('tbody', {}, c.roster.map((s) => h('tr', {}, h('td', {}, s.username), h('td', { class: 'num' }, String(s.streak)), h('td', { class: 'num' }, String(s.best)), h('td', { class: 'num' }, `${s.kept_7} / 7`), h('td', { class: 'num' }, String(s.xp_week)))))))) : null;
    if (roster) roster.open = rosterOpen;
    // Open units first. A unit that was closed after students played it keeps its results, folded away under the open ones.
    const units = shownUnits(c), unlisted = c.units.length - units.length, isOpen = (u) => c.open_units === null || c.open_units.includes(u.id);
    const rows = (list) => [...new Set(list.map((u) => u.section))].flatMap((sec) => [h('p', { class: 'label ln-unitsec' }, sec), ...list.filter((u) => u.section === sec).map((u) => unitRow(c, u, season))]);
    const open = units.filter(isOpen), shut = units.filter((u) => !isOpen(u));
    const closed = shut.length ? h('details', { class: 'ln-fold', ontoggle: () => { closedOpen = closed.open; } }, h('summary', {}, 'Closed units with results ', h('span', { class: 'muted' }, String(shut.length))), rows(shut)) : null;
    if (closed) closed.open = closedOpen;
    box.replaceChildren(...[classSel, h('div', { class: 'class-card' },
      h('p', {}, h('strong', {}, c.name), ` · ${c.students} student${c.students === 1 ? '' : 's'}`),
      p.el, roster,
      !c.units.length ? h('p', { class: 'muted' }, 'This class’s course has no lessons yet.')
        : h('div', { class: 'ln-unitlist' },
            h('p', { class: 'muted small' }, 'Choose a unit to see its levels and the questions missed most. Finished unit: students who finished every level. Levels finished: out of every level for every student. Lowest first try: the level with the lowest median.'),
            h('div', { class: 'ln-unithead', 'aria-hidden': 'true' }, h('span', {}, 'Unit'), h('span', {}, 'Finished unit'), h('span', {}, 'Levels finished'), h('span', {}, 'Lowest first try')),
            open.length ? rows(open) : h('p', { class: 'muted ln-unitsec' }, 'No unit is open to this class. Open some units above.'),
            closed,
            unlisted ? h('p', { class: 'muted small' }, `${unlisted} closed unit${unlisted === 1 ? ' has' : 's have'} no results and ${unlisted === 1 ? 'is' : 'are'} not listed.`) : null))].filter(Boolean));
  }

  async function load() {
    const next = await api('/api/learn/teach');
    msg.textContent = '';
    if (!picker.firstChild) picker.append(previewPicker(next.courses, stage));     // built once: a refresh must not reset the unit and level you chose
    data = next;
    const sig = JSON.stringify([next.classes, next.season]);
    if (sig !== drawn) { drawn = sig; draw(); }                                    // nothing new: leave the page as the teacher has it
  }
  el.append(h('div', { class: 'spread' }, h('h2', {}, 'Learning Road'), h('button', { class: 'ghost', type: 'button', onclick: reload }, 'Refresh')),
    h('p', { class: 'muted small' }, 'Levels finished this season, and where the first try went wrong. The first try is the first answer to each question on the first time a student finishes a level.'), picker, stage, box, msg);
  ctx?.onRefresh(() => load().catch(() => {}));
  // Students' XP and streaks send the teacher no live hint: re-read every minute while the panel is on screen (load() redraws only when something changed).
  const poll = setInterval(() => { if (!el.isConnected) clearInterval(poll); else if (document.visibilityState === 'visible') load().catch(() => {}); }, 60000);
  await load();
}
