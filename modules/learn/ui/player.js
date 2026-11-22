import { h, api, fmt } from '/ui.js?v=__V__';
import { figure, picture } from '/m/learn/figures.js?v=__V__';
import { cheerFor } from '/m/learn/cheer.js?v=__V__';

// The full-screen frame of a lesson: top bar (exit button and a progress bar, or `center`), the middle that scrolls, and the bottom bar. The body class, the key
// listener and the watcher all go in release(). `sh.handler` is the keyboard handler of the screen on show. `onLeave(result)` is called by sh.leave.
export function shell(root, { total = 1, center = null, confirmText, onLeave, tag = '', exitLabel = 'Exit lesson' }) {
  const sh = { handler: null };
  // The listener lives on document, so it must go when the student leaves by any route (Back to town, a hash change, a season flip), not only through leave().
  const body = document.body;
  let watch = null, cheerTimer = null;
  const release = () => { body.classList.remove('ln-full'); document.removeEventListener('keydown', onKey); window.removeEventListener('hashchange', release); clearInterval(watch); clearTimeout(cheerTimer); };
  const onKey = (e) => { if (!root.isConnected) return release(); if (sh.handler && !e.ctrlKey && !e.metaKey && !e.altKey) sh.handler(e); };
  document.addEventListener('keydown', onKey);
  window.addEventListener('hashchange', release);
  watch = setInterval(() => { if (!root.isConnected) release(); }, 400);        // a season flip redraws the page without a key press or a hash change
  body.classList.add('ln-full');
  const leave = (result) => { release(); onLeave(result); };
  const bar = h('div', { class: 'ln-bar-fill' });
  const track = h('div', { class: 'ln-progress', role: 'progressbar', 'aria-label': 'Lesson progress', 'aria-valuemin': '0', 'aria-valuemax': String(total) }, bar);
  const setProgress = (n, of = total) => {
    track.setAttribute('aria-valuemax', String(of));
    track.setAttribute('aria-valuenow', String(n));
    bar.className = `ln-bar-fill ln-w${Math.round((20 * n) / of) * 5}`;     // 0..100 in steps of 5: a class, because inline styles are not allowed
  };
  const exit = h('button', { type: 'button', class: 'ghost ln-exit', 'aria-label': exitLabel, onclick: () => { if (window.confirm(confirmText)) leave(null); } }, '×');
  const stage = h('div', { class: 'ln-stage' });
  const foot = h('div', { class: 'ln-bottom-in' });
  // The Wolf's cheer: one polite live region above the feedback, always on the page (a live region must exist before its text changes). Shown ~2.5 s, then the Wolf slides back out. CSS puts it beside the choices on desktop and above the feedback elsewhere.
  const cheerBox = h('div', { class: 'ln-cheer', role: 'status', 'aria-live': 'polite', 'aria-atomic': 'true' });
  const cheerClear = () => { clearTimeout(cheerTimer); cheerBox.replaceChildren(); };
  const cheer = (text) => {
    cheerClear();
    const pop = h('div', { class: 'ln-cheer-pop' }, h('img', { class: 'ln-cheer-wolf', src: '/art/wolf.png?v=__V__', alt: '', width: '87', height: '190' }), h('div', { class: 'ln-cheer-bubble' }, text));
    cheerBox.replaceChildren(pop);
    cheerTimer = setTimeout(() => { pop.classList.add('out'); cheerTimer = setTimeout(cheerClear, 400); }, 2500);
  };
  const bottom = h('div', { class: 'ln-bottom' }, cheerBox, foot);
  const player = h('div', { class: 'ln-player' }, h('div', { class: 'ln-top' }, exit, center ?? track, tag ? h('span', { class: 'label ln-previewtag' }, tag) : ''), stage, bottom);
  root.replaceChildren(player);
  // One screen: the middle (scrolls) and the bottom bar's content.
  function screen(mid, bottomKids) {
    stage.replaceChildren(h('div', { class: 'ln-mid' }, mid));
    stage.scrollTop = 0;
    cheerClear();
    bottom.className = 'ln-bottom';
    foot.replaceChildren(...bottomKids);
  }
  return Object.assign(sh, { release, leave, cheer, cheerClear, setProgress, stage, foot, bottom, player, screen, track,
    focusFirst: () => player.querySelector('[data-autofocus]')?.focus(), hintKeys: (text) => h('span', { class: 'ln-enterhint', 'aria-hidden': 'true' }, text) });
}

// One question, as the lesson shows it: figure, prompt, words, hint, the answer, Check, the feedback bar. `answer(value)` asks the server and returns its reply;
// `onResult(r)` runs once the reply is known; `nextText(r)` is the button's label after checking; `onNext()` runs on Continue; `extra(r, ui)` adds feedback lines; `more` adds buttons beside Check.
export function askQuestion(sh, q, { label, answer, onResult, nextText, onNext, extra, more = [] }) {
  const { bottom, hintKeys } = sh;
  let picked = null, checked = false, result = null;
  const feedback = h('div', { class: 'ln-feedback', role: 'status', 'aria-live': 'polite' });
  const primary = h('button', { type: 'button', class: 'ln-primary', disabled: true, 'data-autofocus': true }, 'Check answer');
  const keysHint = hintKeys('Enter to check');
  const isChart = q.type === 'point';
  let input = null, optionBtns = [], figEl = null;
  const mark = {};

  const refreshChart = () => {
    if (!isChart) return;
    const fresh = figure(q.figure, { pick: choose, picked, locked: checked, mark });
    figEl.replaceWith(fresh); figEl = fresh;
    if (!checked && picked !== null) fresh.querySelector('.ln-pt.picked')?.focus?.();
  };
  function choose(i) {
    if (checked) return;
    picked = i;
    optionBtns.forEach((b, j) => { b.classList.toggle('picked', j === i); b.setAttribute('aria-pressed', j === i ? 'true' : 'false'); });
    primary.disabled = false;
    refreshChart();
  }

  let body;
  if (q.type === 'choice') {
    optionBtns = q.options.map((text, i) => h('button', { type: 'button', class: 'ln-option', 'aria-pressed': 'false', onclick: () => choose(i) }, h('span', { class: 'ln-key', 'aria-hidden': 'true' }, String(i + 1)), h('span', {}, text)));
    body = h('div', { class: 'ln-options', role: 'group', 'aria-label': 'Answers' }, optionBtns);
  } else if (q.type === 'number') {
    input = h('input', { class: 'ln-input', type: 'text', inputmode: 'decimal', autocomplete: 'off', 'aria-label': `Your answer in ${q.unit === '$' ? 'dollars' : q.unit === '%' ? 'percent' : q.unit}`, placeholder: '0' });
    input.addEventListener('input', () => { primary.disabled = checked || !input.value.trim(); });
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); if (!primary.disabled) primary.click(); } });
    body = h('label', { class: 'ln-answer' }, h('span', { class: 'sr' }, 'Your answer'), q.unit === '$' ? h('span', { class: 'ln-unit' }, '$') : '', input, q.unit !== '$' ? h('span', { class: 'ln-unit' }, q.unit === '%' ? '%' : 'hours') : '');
  } else {
    body = h('p', { class: 'muted small' }, 'Tap a bar or a dot on the chart. You can also press its number.');
  }

  const hint = h('p', { class: 'ln-hint', hidden: true }, q.hint);
  const hintBtn = h('button', { type: 'button', class: 'ghost ln-small', 'aria-expanded': 'false', onclick: () => { hint.hidden = !hint.hidden; hintBtn.setAttribute('aria-expanded', String(!hint.hidden)); } }, 'Hint');
  const terms = q.terms?.length ? h('details', { class: 'ln-terms' }, h('summary', {}, 'Words in this question'), h('dl', {}, q.terms.flatMap((t) => [h('dt', {}, t.term), h('dd', {}, t.meaning)]))) : '';
  figEl = q.figure ? figure(q.figure, isChart ? { pick: choose, picked, locked: false, mark } : undefined) : null;

  async function check() {
    primary.disabled = true;
    const value = q.type === 'number' ? input.value : picked;
    let r;
    try { r = await answer(value); } catch (e) {
      feedback.replaceChildren(h('p', { class: 'error' }, e.message));
      primary.disabled = false;
      if (e.status === 429) setTimeout(() => { feedback.replaceChildren(); }, 1500);
      return;
    }
    checked = true; result = r;
    if (!r.correct) sh.cheerClear();                                // a cheer from the start of the question must not sit above the explanation
    if (q.type === 'choice') { optionBtns[picked].classList.add(r.correct ? 'right' : 'wrong'); optionBtns.forEach((b) => { b.disabled = true; b.classList.toggle('dim', !b.classList.contains('right') && !b.classList.contains('wrong')); }); }
    if (isChart) { mark[picked] = r.correct ? 'right' : 'wrong'; refreshChart(); }
    if (input) { input.disabled = true; input.classList.add(r.correct ? 'right' : 'wrong'); }
    onResult(r);
    feedback.className = `ln-feedback ${r.correct ? 'right' : 'wrong'}`;
    bottom.classList.add(r.correct ? 'right' : 'wrong');
    keysHint.textContent = 'Enter to continue';
    feedback.replaceChildren(
      h('p', { class: 'ln-verdict' }, r.correct ? 'That’s right' : 'Not quite'),
      h('p', {}, r.why),
      r.working ? h('p', { class: 'ln-working' }, r.working) : '',
      ...(extra ? extra(r, ui) : []));
    primary.textContent = nextText(r);
    primary.disabled = false; primary.focus();
  }
  const ui = { primary };
  primary.addEventListener('click', () => (checked ? onNext() : check()));

  const prompt = h('h3', { class: 'ln-prompt', tabindex: '-1' }, q.prompt);   // focusable, so a new question is announced and Enter cannot land on a stale button
  sh.screen([
    h('p', { class: 'label' }, label),
    h('div', { class: q.figure ? 'ln-cols' : 'ln-single' }, figEl ?? '', h('div', { class: 'ln-q' }, prompt, terms, h('div', { class: 'ln-hintrow' }, hintBtn, hint), body))],
  [feedback, h('div', { class: 'ln-actions' }, ...more, keysHint, primary)]);
  sh.handler = (e) => {
    if (/^[1-9]$/.test(e.key) && !checked) {
      const i = Number(e.key) - 1;
      if (!(e.target instanceof HTMLInputElement) && i < (q.type === 'choice' ? q.options.length : isChart ? (q.figure.points ?? q.figure.bars).length : 0)) { e.preventDefault(); choose(i); primary.focus(); }
    } else if (e.key === 'Enter' && !(e.target instanceof HTMLButtonElement || e.target instanceof HTMLInputElement || e.target?.tagName === 'SUMMARY')) {
      e.preventDefault(); if (!primary.disabled) primary.click();
    } else if (e.key === 'Enter' && e.target?.classList?.contains('ln-option')) {   // Enter on a focused option picks that option; Enter again (focus is then on Check) submits it
      e.preventDefault(); if (checked) return;
      const i = optionBtns ? optionBtns.indexOf(e.target) : -1;
      if (i >= 0 && picked !== i) { choose(i); primary.focus(); } else if (picked !== null) primary.click();
    }
  };
  if (input) input.focus(); else prompt.focus({ preventScroll: true });   // Check is disabled until an answer is picked, so it cannot take focus
}

// The lesson player: cards first, then the questions, then a retry round for the ones missed. Every answer is checked by the server (POST /api/learn/answer);
// this file holds no answers. `onDone(result | null)` is called when the student leaves (null) or finishes (the /finish result).
// Keys: 1-9 choose, Enter checks and continues. The feedback bar is an aria-live region.
// The lesson is full screen: body gets the class ln-full while it plays (learn.css hides the page behind it). Three regions: the top bar, the middle
// (scrolls) and the bottom bar (feedback and the action button). The class, the key listener and the watcher all go in release().
// `preview` (the teacher console): the same lesson through /api/learn/preview, which saves nothing. The retry list and the first-try count are kept here,
// there is no /finish call, and the end screen says that nothing was saved or paid.
export async function play(root, { levelId, me, onDone, preview = false }) {
  const API = preview ? '/api/learn/preview' : '/api/learn', backLabel = preview ? 'Close preview' : 'Back to the road';
  const first = new Map();                                          // question id -> was its first answer right (only read in a preview)
  let lesson;
  try { lesson = await api(`${API}/start`, { level_id: levelId }); } catch (e) { root.replaceChildren(h('p', { class: 'error', role: 'alert' }, e.message), h('button', { type: 'button', onclick: () => onDone(null) }, backLabel)); return; }
  const qs = new Map(lesson.questions.map((q) => [q.id, q]));
  const review = !!lesson.level.review;
  const total = lesson.cards.length + lesson.questions.length;
  const solved = new Set(lesson.solved);
  const main = lesson.questions.filter((q) => !solved.has(q.id) && !lesson.queue.includes(q.id)).map((q) => q.id);
  let retry = lesson.queue.slice();                                 // wrong first answers still to fix, in the order they were missed
  let cardsSeen = solved.size || lesson.queue.length ? lesson.cards.length : 0;
  const sh = shell(root, { total, confirmText: preview ? 'Leave this preview? Nothing is saved.' : 'Leave this lesson? Your answers are kept, and you can pick it up where you left off.', onLeave: onDone, tag: preview ? 'Preview' : '' });
  const { screen, stage, foot, bottom, hintKeys, focusFirst, leave } = sh;
  let seq = 0, lastCheer = -1, streak = 0;                          // the Wolf's cheers (cheer.js): questions shown, the one last cheered, first-try rights in a row
  const setProgress = () => sh.setProgress(Math.min(total, cardsSeen + solved.size));

  // ---- cards ----
  function showCards(i, { back } = {}) {
    const c = lesson.cards[i], last = i === lesson.cards.length - 1;
    const next = h('button', { type: 'button', class: 'ln-primary', 'data-autofocus': true, onclick: () => (last ? (back ? back() : startQuestions()) : showCards(i + 1, { back })) }, last ? (back ? 'Back to the question' : 'Start the questions') : 'Next');
    const dots = h('ol', { class: 'ln-dots', 'aria-label': `Card ${i + 1} of ${lesson.cards.length}` }, lesson.cards.map((_, j) => h('li', { class: j === i ? 'on' : '', ...(j === i ? { 'aria-current': 'step' } : {}) }, h('span', { class: 'sr' }, `Card ${j + 1}`))));
    const media = c.figure ? figure(c.figure) : c.image ? h('div', { class: 'ln-picwrap' }, picture(c.image, 'ln-pic', 640, 640)) : null;
    screen([h('p', { class: 'label' }, `${lesson.level.title} · Card ${i + 1} of ${lesson.cards.length}`),
      h('div', { class: media ? 'ln-cols' : 'ln-single' }, media ?? '', h('p', { class: `ln-card-text${media ? '' : ' big'}` }, c.text)), dots],
    [h('div', { class: 'ln-actions' }, i > 0 ? h('button', { type: 'button', class: 'ghost', onclick: () => showCards(i - 1, { back }) }, 'Back') : '', hintKeys('Enter to continue'), next)]);
    if (!back) { cardsSeen = Math.max(cardsSeen, i + 1); setProgress(); }
    sh.handler = (e) => { if (e.key === 'Enter' && !(e.target instanceof HTMLButtonElement)) { e.preventDefault(); next.click(); } };
    focusFirst();
  }
  function startQuestions() { ask(); }

  // ---- questions ----
  function ask() {
    const fromMain = main.length > 0;
    const id = fromMain ? main.shift() : retry.shift();
    if (!id) return complete();
    question(qs.get(id), !fromMain);
  }

  function question(q, inRetry) {
    const n = lesson.questions.findIndex((x) => x.id === q.id) + 1, left = retry.length + 1;
    // The cards again, then back to this question exactly as it was (a choice already picked stays picked). Nothing is sent: no answer, progress, XP or pay changes.
    const reread = () => {
      const saved = [...stage.childNodes], savedFoot = [...foot.childNodes], savedClass = bottom.className, savedHandler = sh.handler;
      showCards(0, { back: () => { stage.replaceChildren(...saved); foot.replaceChildren(...savedFoot); bottom.className = savedClass; sh.handler = savedHandler; foot.querySelector('.ln-primary')?.focus(); } });
    };
    const canReread = !review && lesson.cards.length > 0;
    const index = seq++, pos = n - 1, total = lesson.questions.length, say = (e) => {
      const c = cheerFor({ levelId, index, pos, total, lastCheer, ...e });
      if (c) { lastCheer = index; sh.cheer(c.text); }
    };
    askQuestion(sh, q, {
      label: `${review ? `Daily review · ${q.from}` : q.label} · ${inRetry ? `Fix the ones you missed · ${left} left` : `Question ${n} of ${lesson.questions.length}`}`,
      answer: (value) => api(`${API}/answer`, { level_id: levelId, question_id: q.id, value }),
      onResult: (r) => {
        const fixed = r.correct && (inRetry || first.get(q.id) === false);
        if (!first.has(q.id)) first.set(q.id, r.correct);
        if (!inRetry) streak = r.correct ? streak + 1 : 0;
        if (r.correct) say({ phase: 'result', correct: true, fixed, streak: inRetry ? 0 : streak });
        if (r.correct) { solved.add(q.id); setProgress(); } else if (!retry.includes(q.id)) retry.push(q.id);
      },
      nextText: () => (retry.length || main.length ? 'Continue' : review ? 'Finish review' : 'Finish level'),
      onNext: ask,
      extra: (r) => [r.correct ? '' : h('p', { class: 'muted small' }, 'This one comes back at the end.'),
        r.correct || !canReread ? '' : h('button', { type: 'button', class: 'ghost ln-small', onclick: reread }, 'Read the cards again')],
      more: canReread ? [h('button', { type: 'button', class: 'ghost ln-reread', onclick: reread }, 'Review the cards')] : [],
    });
    say({ phase: 'ask', retry: inRetry });
  }

  // ---- done ----
  async function complete() {
    sh.handler = null;
    screen([h('p', { role: 'status' }, 'Counting up…')], []);
    let r;
    try {
      r = preview ? { first_try: [...first.values()].filter(Boolean).length, questions: lesson.questions.length, words: [...new Map(lesson.questions.flatMap((q) => q.terms ?? []).map((t) => [t.term, t])).values()] }
        : await api('/api/learn/finish', { level_id: levelId });
    } catch (e) {
      screen([h('p', { class: 'error', role: 'alert' }, e.message)], [h('div', { class: 'ln-actions' }, h('button', { type: 'button', class: 'ghost', onclick: () => leave(null) }, backLabel), h('button', { type: 'button', class: 'ln-primary', onclick: () => complete() }, 'Try again'))]);
      return;
    }
    cardsSeen = lesson.cards.length; setProgress();
    const stat = (label, value) => h('div', { class: 'stat' }, h('b', {}, value), h('span', { class: 'muted small' }, label));
    const goBtn = lesson.level.go ? h('button', { type: 'button', class: 'ghost', onclick: () => { leave(r); location.hash = `#${lesson.level.go.building}`; } }, lesson.level.go.label) : '';
    const cont = h('button', { type: 'button', class: 'ln-primary', 'data-autofocus': true, onclick: () => leave(r) }, preview ? 'Close preview' : 'Continue');
    screen([h('div', { class: 'ln-finish' },
      h('img', { class: 'ln-wolf', src: '/art/wolf.png?v=__V__', alt: '' }),
      h('h2', { class: 'display ln-complete' }, preview ? 'Preview done' : review ? 'Review done' : r.practice ? 'Practice done' : 'Level complete'),
      h('p', { class: 'muted' }, lesson.level.title),
      h('div', { class: 'ln-stats' }, review || preview ? '' : stat('Cash earned', r.paid ? fmt(r.reward_cents) : '$0.00'), preview ? '' : stat('XP', String(r.xp)), stat('First try', `${r.first_try}/${r.questions}`), preview ? '' : stat('Day streak', String(r.daily.streak))),
      r.day_kept ? h('p', { class: 'ln-kept' }, 'Streak kept') : '',
      r.freeze_earned ? h('p', { class: 'muted small' }, 'You earned a streak freeze. It covers one missed day.') : '',
      preview ? h('p', { class: 'muted' }, 'This was a preview. Nothing was saved, and no cash or XP was paid.')
        : review ? '' : r.practice ? h('p', { class: 'muted' }, 'You have already finished this level, so there is no reward. Practice still counts as learning.')
        : h('p', { class: 'muted small' }, r.reward ? `Reward: ${fmt(r.reward.base)} for finishing + ${fmt(r.reward.bonus)} for ${r.first_try} first-try answer${r.first_try === 1 ? '' : 's'}${r.reward.capped ? ' (capped at $2.00)' : ''}, adjusted to this season’s prices. Paid once for this level.` : ''),
      r.words.length ? h('div', {}, h('p', { class: 'label' }, 'New words'), h('dl', { class: 'ln-words' }, r.words.flatMap((t) => [h('dt', {}, t.term), h('dd', {}, t.meaning)]))) : '',
      )], [h('div', { class: 'ln-actions' }, goBtn, hintKeys('Enter to continue'), cont)]);
    sh.handler = (e) => { if (e.key === 'Enter' && !(e.target instanceof HTMLButtonElement)) { e.preventDefault(); cont.click(); } };
    cont.focus();
  }

  setProgress();
  if (cardsSeen || !lesson.cards.length) ask(); else showCards(0);
}
