import { h, api } from '/ui.js?v=__V__';
import { shell, askQuestion } from '/m/learn/player.js?v=__V__';
import { cheerFor } from '/m/learn/cheer.js?v=__V__';

// Practice (docs/learn.md "Practice"): three kinds of session on the student's weakest units, in turn. The server owns everything: which questions or word pairs,
// whether a pick or an answer is right, the clock and the XP. This file draws what the server sends and holds no answer. No money here, only XP.
// The shell (full screen frame) and the question screen are the lesson player's own (player.js).
export const MODES = {
  match: { name: 'Word match', rule: 'Tap a word, then its meaning. Match every pair.' },
  climb: { name: 'XP Climb', rule: 'Climb nine steps. Answer both questions of a step right first time to bank its XP. A wrong answer ends the climb, and you keep what you banked.' },
  timed: { name: 'Timed round', rule: 'Answer as many questions as you can before the clock runs out. Right answers earn bonus XP.' },
};
const clock = (ms) => { const s = Math.ceil(ms / 1000); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
// The XP Climb staircase: one connected row of nine bars rising left to right, three levels of three steps. Heights are classes (ln-sh0..8), never inline styles.
// `banked` steps are lit, `step` is the current bar (unless the climb is over), the rest are dimmed. Every bar has a text equivalent for screen readers.
export function staircase(v, { big = false, banked = v.banked, step = v.step, over = v.over } = {}) {
  const per = v.per_level;
  const lvl = (li) => h('li', { class: 'ln-lv' },
    h('ol', { class: 'ln-lvbars', 'aria-label': `Level ${li + 1}` }, v.xp_steps[li].map((xp, j) => {
      const i = li * per + j, st = i < banked ? 'done' : i === step && !over ? 'now' : 'todo';
      return h('li', { class: `ln-sb ln-sh${i} ${st}`, ...(st === 'now' ? { 'aria-current': 'step' } : {}) }, h('span', { 'aria-hidden': 'true' }, `+${xp}`),
        h('span', { class: 'sr' }, `Step ${i + 1} of ${v.levels * per}, +${xp} XP: ${st === 'done' ? 'banked' : st === 'now' ? 'you are here' : 'still to come'}`));
    })),
    h('span', { class: 'ln-lvname', 'aria-hidden': 'true' }, `Level ${li + 1}`));
  return h('ol', { class: `ln-stairs${big ? ' big' : ''}`, 'aria-label': 'XP Climb' }, v.xp_steps.map((_, li) => lvl(li)));
}
// "You climbed to Level 2, step 1: +8 XP"
export function climbLine(banked, total, per, xp) {
  if (banked >= total) return `You climbed to the top: +${xp} XP`;
  if (banked === 0) return 'You did not bank a step this time: +0 XP';
  const at = banked - 1;
  return `You climbed to Level ${Math.floor(at / per) + 1}, step ${(at % per) + 1}: +${xp} XP`;
}
const w5 = (n, of) => `ln-w${Math.round((20 * Math.min(n, of)) / of) * 5}`;     // 0..100 in steps of 5: a class, because inline styles are not allowed

// `onDone(result | null)`: the student is back on the road (null when they left without finishing). `again()` starts the next session.
export async function playPractice(root, { onDone, again }) {
  let view;
  try { view = await api('/api/learn/practice/start', {}); } catch (e) { root.replaceChildren(h('p', { class: 'error', role: 'alert' }, e.message), h('button', { type: 'button', onclick: () => onDone(null) }, 'Back to the road')); return; }
  const mode = view.mode, name = MODES[mode].name;
  let tick = null, over = false, seq = 0, lastCheer = -1;       // seq and lastCheer: the Wolf's cheers (cheer.js)
  const stop = () => clearInterval(tick);

  // ---- the top bar: the climb's staircase, or the clock and the bonus checkpoints, or the plain progress bar (match) ----
  let center = null;
  const pyr = mode === 'climb' ? h('div', { class: 'ln-climbtop' }) : null;
  const timeEl = h('span', { class: 'ln-clock' }, '0:00'), cpFill = h('div', { class: 'ln-bar-fill ln-w0' });
  const cpTrack = h('div', { class: 'ln-progress ln-cptrack', role: 'progressbar', 'aria-label': 'Right answers toward the bonuses', 'aria-valuemin': '0' }, cpFill);
  const cpList = h('ol', { class: 'ln-cp', 'aria-label': 'Bonus XP' });
  if (mode === 'climb') center = pyr;
  if (mode === 'timed') center = h('div', { class: 'ln-timed', role: 'timer', 'aria-label': 'Time left' }, timeEl, h('div', { class: 'ln-cpwrap' }, cpTrack, cpList));
  const drawClimb = (v) => pyr.replaceChildren(staircase(v));
  const drawTimed = (v) => {
    const top = v.checkpoints.at(-1).right;
    cpFill.className = `ln-bar-fill ${w5(v.right, top)}`;
    cpTrack.setAttribute('aria-valuemax', String(top)); cpTrack.setAttribute('aria-valuenow', String(Math.min(v.right, top)));
    cpList.replaceChildren(...v.checkpoints.map((c) => h('li', { class: c.reached ? 'reached' : '' }, `${c.right} right: +${c.xp} XP`, c.reached ? h('span', { class: 'sr' }, ' (reached)') : '')));
  };
  if (pyr) drawClimb(view);
  if (mode === 'timed') drawTimed(view);

  const sh = shell(root, { total: view.pairs ?? 1, center, tag: mode === 'climb' ? '' : name, exitLabel: 'Leave Practice',
    confirmText: mode === 'timed' ? 'Leave Practice? The clock keeps running while you are away.' : 'Leave Practice? You can pick this session up again from the road.',
    onLeave: (r) => { stop(); onDone(r); } });
  const { screen, hintKeys } = sh;

  // ---- the end: XP, the daily limit, what is next ----
  async function finish(heading = 'Practice done') {
    if (over) return;
    over = true; stop(); sh.handler = null;
    if (mode === 'timed') timeEl.textContent = 'Done';
    screen([h('p', { role: 'status' }, 'Counting up…')], []);
    let r;
    try { r = await api('/api/learn/practice/finish', {}); } catch (e) {
      over = false;
      screen([h('p', { class: 'error', role: 'alert' }, e.message)], [h('div', { class: 'ln-actions' }, h('button', { type: 'button', class: 'ghost', onclick: () => sh.leave(null) }, 'Back to the road'), h('button', { type: 'button', class: 'ln-primary', 'data-autofocus': true, onclick: () => finish(heading) }, 'Try again'))]);
      sh.focusFirst();
      return;
    }
    const stat = (label, value) => h('div', { class: 'stat' }, h('b', {}, value), h('span', { class: 'muted small' }, label));
    const mine = r.mode === 'match' ? stat('Wrong picks', String(r.wrong)) : r.mode === 'climb' ? stat('Steps banked', `${r.banked}/${r.steps}`) : stat('Right answers', `${r.right}/${r.answered}`);
    const cont = h('button', { type: 'button', class: 'ln-primary', 'data-autofocus': true, onclick: () => { sh.release(); stop(); again(); } }, `Practise again: ${MODES[r.next_mode].name}`);
    screen([h('div', { class: 'ln-finish' },
      h('img', { class: 'ln-wolf', src: '/art/wolf.png?v=__V__', alt: '' }),
      h('h2', { class: 'display ln-complete' }, heading),
      h('p', { class: 'muted' }, MODES[r.mode].name),
      r.mode === 'climb' ? [staircase(view, { big: true, banked: r.banked, over: true }), h('p', { class: 'ln-climbline', role: 'status' }, climbLine(r.banked, r.steps, view.per_level, r.xp))] : '',
      h('div', { class: 'ln-stats' }, stat('XP earned', String(r.xp)), mine, stat('Practice XP today', `${r.xp_today}/${r.cap}`)),
      r.capped ? h('p', { class: 'ln-capline' }, r.xp_added > 0 ? `You hit today’s Practice limit of ${r.cap} XP. ${r.xp_added} of your ${r.xp} XP counted.` : `You have already earned the most Practice XP for today (${r.cap}). This ${r.xp} XP did not count. Come back tomorrow.`) : '',
      r.xp === 0 ? h('p', { class: 'muted small' }, 'No XP this time. A game you leave unfinished earns nothing.') : '',
      r.day_kept ? h('p', { class: 'ln-kept' }, 'Streak kept') : '',
      h('p', { class: 'muted small' }, `Next time: ${MODES[r.next_mode].name}. ${MODES[r.next_mode].rule}`))],
    [h('div', { class: 'ln-actions' }, h('button', { type: 'button', class: 'ghost', onclick: () => sh.leave(r) }, 'Back to the road'), hintKeys('Enter to continue'), cont)]);
    sh.handler = (e) => { if (e.key === 'Enter' && !(e.target instanceof HTMLButtonElement)) { e.preventDefault(); cont.click(); } };
    cont.focus();
  }
  const endBtn = (text, confirmText) => h('button', { type: 'button', class: 'ghost', onclick: () => { if (window.confirm(confirmText)) finish('Practice ended'); } }, text);

  // ---- match: two columns, a word then its meaning; the server says whether the pair is right ----
  function match(v) {
    let sel = null, busy = false, flash = [];
    const termBtns = new Map(), meanBtns = new Map(), done = new Set(v.matched.map((m) => m.term_id)), doneM = new Set(v.matched.map((m) => m.meaning_id));
    const status = h('p', { class: 'muted', role: 'status', 'aria-live': 'polite' }, 'Tap a word.');
    const finishBtn = h('button', { type: 'button', class: 'ln-primary', disabled: !v.done, onclick: () => finish() }, 'Finish');
    const paint = () => {
      for (const [id, b] of termBtns) { b.classList.toggle('picked', id === sel); b.setAttribute('aria-pressed', String(id === sel)); b.disabled = done.has(id); b.classList.toggle('right', done.has(id)); }
      for (const [id, b] of meanBtns) { b.disabled = doneM.has(id); b.classList.toggle('right', doneM.has(id)); }
      sh.setProgress(done.size, v.pairs);
      finishBtn.disabled = done.size < v.pairs;
    };
    const clearFlash = () => { for (const b of flash) b.classList.remove('wrong'); flash = []; };
    async function pick(mid) {
      if (busy) return;
      if (!sel) { status.textContent = 'Tap a word first, then its meaning.'; return; }
      busy = true; clearFlash();
      const tid = sel, tb = termBtns.get(tid), mb = meanBtns.get(mid);
      let r;
      try { r = await api('/api/learn/practice/pick', { term_id: tid, meaning_id: mid }); } catch (e) { status.textContent = e.message; busy = false; return; }
      busy = false; sel = null;
      if (r.correct) { done.add(tid); doneM.add(mid); status.textContent = r.done ? 'All matched. Well done.' : 'Matched. Tap the next word.'; }
      else { flash = [tb, mb]; for (const b of flash) b.classList.add('wrong'); status.textContent = 'Not a match. Pick a word and try again.'; }
      paint();
      if (r.done) { finishBtn.focus(); } else (r.correct ? [...termBtns.values()].find((b) => !b.disabled) : tb)?.focus();
    }
    for (const t of v.terms) termBtns.set(t.id, h('button', { type: 'button', class: 'ln-option', 'aria-pressed': 'false', onclick: () => { clearFlash(); sel = t.id; status.textContent = 'Now tap its meaning.'; paint(); } }, h('span', {}, t.term)));
    for (const m of v.meanings) meanBtns.set(m.id, h('button', { type: 'button', class: 'ln-option ln-mean', onclick: () => pick(m.id) }, h('span', {}, m.meaning)));
    screen([h('p', { class: 'label' }, 'Practice'), h('h3', { class: 'ln-prompt' }, 'Match each word with its meaning'),
      h('div', { class: 'ln-match' },
        h('div', {}, h('p', { class: 'label' }, 'Words'), h('div', { class: 'ln-col', role: 'group', 'aria-label': 'Words' }, [...termBtns.values()])),
        h('div', {}, h('p', { class: 'label' }, 'Meanings'), h('div', { class: 'ln-col', role: 'group', 'aria-label': 'Meanings' }, [...meanBtns.values()]))),
      status],
    [h('div', { class: 'ln-actions' }, endBtn('End game', 'End this game? You earn no XP for a game you do not finish.'), finishBtn)]);
    paint();
    sh.handler = null;
    (termBtns.values().next().value)?.focus();
  }

  // ---- the XP Climb intro: the big staircase and the rule, before the first question ----
  function intro(v) {
    const go = h('button', { type: 'button', class: 'ln-primary', 'data-autofocus': true, onclick: () => ask(v, true) }, 'Start the climb');
    const max = v.xp_steps.flat().reduce((a, b) => a + b, 0);
    screen([h('div', { class: 'ln-climbintro' }, h('h2', { class: 'display ln-complete' }, 'XP Climb'), staircase(v, { big: true }), h('p', { class: 'ln-climbline' }, `Bank every step for up to ${max} XP.`), h('p', { class: 'muted' }, MODES.climb.rule))],
      [h('div', { class: 'ln-actions' }, endBtn('Not now', 'Leave without climbing? You earn no XP.'), hintKeys('Enter to start'), go)]);
    sh.handler = (e) => { if (e.key === 'Enter' && !(e.target instanceof HTMLButtonElement)) { e.preventDefault(); go.click(); } };
    go.focus();
  }

  // ---- climb and timed: one question at a time, in the lesson's own question screen ----
  function ask(v, started = false) {
    if (over) return;
    if (mode === 'climb' && !started && v.step === 0 && v.position === 0 && !v.over) return intro(v);
    if (mode === 'timed') { sync(v); drawTimed(v); }
    if (v.over || !(mode === 'timed' ? v.question : v.questions[0])) return finish(mode === 'timed' ? 'Time’s up' : v.banked === v.levels * v.per_level ? 'You reached the top' : 'Practice done');
    const q = mode === 'timed' ? v.question : v.questions[0];
    let last = v;
    const index = seq++;
    askQuestion(sh, q, {
      label: mode === 'timed' ? `Practice · ${name} · ${v.right} right so far · ${q.from}` : `Practice · ${name} · Step ${v.step + 1} of ${v.levels * v.per_level}, +${v.xp_steps[Math.floor(v.step / v.per_level)][v.step % v.per_level]} XP · Question ${v.position + 1} of ${v.size} · ${q.from}`,
      answer: (value) => api('/api/learn/practice/answer', { question_id: q.id, value }),
      onResult: (r) => {
        const checkpoint = mode === 'timed' && r.checkpoints.filter((c) => c.reached).length > v.checkpoints.filter((c) => c.reached).length;
        const climbLevel = mode === 'climb' && r.correct && r.banked > v.banked && r.banked % v.per_level === 0 && r.banked < v.levels * v.per_level;
        const c = cheerFor({ phase: 'result', correct: r.correct, levelId: `practice-${mode}`, index, lastCheer, checkpoint, climbLevel });
        if (c) { lastCheer = index; sh.cheer(c.text); }
        last = r; if (mode === 'climb') drawClimb(r); else { sync(r); drawTimed(r); } },
      nextText: (r) => (r.over ? 'See my result' : 'Next question'),
      onNext: () => ask(last),
      extra: (r) => {
        if (mode === 'timed') return [r.correct ? '' : h('p', { class: 'muted small' }, 'It may come back in your daily review.')];
        const stepDone = r.banked > v.banked;
        return [r.correct ? (stepDone ? h('p', { class: 'ln-kept' }, r.ended === 'complete' ? 'You reached the top of the climb.' : `Step ${v.step + 1} banked: +${v.xp_steps[Math.floor(v.step / v.per_level)][v.step % v.per_level]} XP.`) : '')
          : h('p', { class: 'muted small' }, 'That ends the climb. The steps you banked keep their XP.'),
        r.over && r.ended === 'pool' ? h('p', { class: 'muted small' }, 'There are no more questions in your set.') : ''];
      },
      more: [endBtn('End session', mode === 'timed' ? 'End this round now? Your bonus XP so far is kept.' : 'End this session now? Your XP for the steps you banked is kept.')],
    });
  }

  // ---- the clock: the server's end time, carried by the browser's own steady clock from the moment the server told us ----
  let ends = 0, serverNow = 0, t0 = 0;
  function sync(v) { ends = v.ends_at; serverNow = v.server_now; t0 = performance.now(); }
  if (mode === 'timed') {
    sync(view);
    const left = () => Math.max(0, ends - (serverNow + (performance.now() - t0)));
    const paintClock = () => { const ms = left(); timeEl.textContent = clock(ms); timeEl.classList.toggle('low', ms <= 10000); return ms; };
    paintClock();
    tick = setInterval(() => { if (!root.isConnected) return stop(); if (paintClock() <= 0) finish('Time’s up'); }, 250);
  }

  if (mode === 'match') match(view); else ask(view);
}
