// learn: the course content loader and its boot-time check (docs/learn.md "Content format"). One file per course in content/<course id>.json.
// checkCourse throws an Error naming the file and the exact path of the first bad item, so a typo in a lesson fails boot, never a student's screen.
// The answers, `why` lines and `working` live here and are stripped by publicQuestion() before anything is sent to a browser.
import fs from 'node:fs';

const ART = new URL('../../public/art/learn/', import.meta.url);   // card and unit pictures: `image.src` is relative to this folder

export const TYPES = ['choice', 'point', 'number'];
export const FIGURES = ['line', 'bars', 'table', 'paystub'];
const KEY = /^[a-z][a-z0-9-]{1,60}$/;
const UNITS = ['$', '%', 'hours'];
const isStr = (v, max, min = 1) => typeof v === 'string' && v.trim().length >= min && v.length <= max;
const ok = Number.isSafeInteger;

// figure -> throws a plain string problem (the caller adds the path)
function checkFigure(f) {
  if (!f || typeof f !== 'object' || !FIGURES.includes(f.kind)) return `figure.kind must be one of ${FIGURES.join(', ')}`;
  if (!isStr(f.title, 80)) return 'figure.title must be 1-80 characters';
  if (f.kind === 'table') {
    if (!Array.isArray(f.columns) || f.columns.length < 2 || f.columns.length > 5 || !f.columns.every((c) => isStr(c, 40))) return 'figure.columns must be 2-5 short strings';
    if (!Array.isArray(f.rows) || !f.rows.length || f.rows.length > 12) return 'figure.rows must be 1-12 rows';
    if (!f.rows.every((r) => Array.isArray(r) && r.length === f.columns.length && r.every((c) => isStr(c, 60, 0)))) return 'every figure row must be as long as figure.columns, with short strings';
  } else if (f.kind === 'paystub') {
    if (!Array.isArray(f.lines) || f.lines.length < 3 || f.lines.length > 10) return 'figure.lines must be 3-10 lines';
    if (!f.lines.every((l) => l && isStr(l.label, 50) && ok(l.cents) && ['earn', 'deduct', 'net'].includes(l.role) && (l.ytd === undefined || ok(l.ytd)))) return 'every paystub line is { label, cents (integer), role: earn | deduct | net, ytd? (integer) }';
  } else {
    if (!['$', '%', 'hours'].includes(f.unit)) return `figure.unit must be one of ${UNITS.join(', ')}`;
    const pts = f.kind === 'line' ? f.points : f.bars;
    if (!Array.isArray(pts) || pts.length < 2 || pts.length > 8) return `figure.${f.kind === 'line' ? 'points' : 'bars'} must be 2-8 items`;
    if (!pts.every((p) => p && isStr(p.label, 30) && Number.isFinite(p.value) && p.value >= 0)) return 'every chart item is { label (short), value (a number, 0 or more) }';
  }
  return null;
}

// image -> a plain string problem, or null. The file must exist so a typo fails boot, not a student's screen.
function checkImage(im, art) {
  if (!im || typeof im !== 'object') return 'image must be { src, alt }';
  if (typeof im.src !== 'string' || !/^[a-z0-9-]+\/[a-z0-9-]+\.webp$/.test(im.src)) return 'image.src must look like "folder/name.webp" (lowercase letters, digits, -)';
  if (!fs.existsSync(new URL(im.src, art))) return `image.src "${im.src}" is not a file under public/art/learn/`;
  if (!isStr(im.alt, 120, 5)) return 'image.alt is required: 5-120 characters saying what is pictured';
  return null;
}

export function checkCourse(c, file = 'content', art = ART) {
  const bad = (path, why) => { throw new Error(`${file}: ${path}: ${why}`); };
  if (!c || typeof c !== 'object') bad('course', 'must be an object');
  if (!KEY.test(c.id ?? '')) bad('id', 'must be a lowercase name');
  if (!isStr(c.title, 80)) bad('title', 'must be 1-80 characters');
  if (!Array.isArray(c.sections) || !c.sections.length) bad('sections', 'must be a non-empty list');
  const ids = new Set(), qids = new Set();
  const uniq = (path, id) => { if (!KEY.test(id ?? '')) bad(`${path}.id`, 'must be a lowercase name (letters, digits, -)'); if (ids.has(id)) bad(`${path}.id`, `"${id}" is used twice`); ids.add(id); };
  c.sections.forEach((s, si) => {
    const sp = `sections[${si}]`;
    uniq(sp, s?.id);
    if (!isStr(s.title, 80)) bad(`${sp}.title`, 'must be 1-80 characters');
    if (!isStr(s.blurb, 240)) bad(`${sp}.blurb`, 'must be 1-240 characters');
    if (!Array.isArray(s.units)) bad(`${sp}.units`, 'must be a list');
    s.units.forEach((u, ui) => {
      const up = `${sp}.units[${ui}]`;
      uniq(up, u?.id);
      if (!isStr(u.title, 80)) bad(`${up}.title`, 'must be 1-80 characters');
      if (!isStr(u.blurb, 240)) bad(`${up}.blurb`, 'must be 1-240 characters');
      if (u.image !== undefined) { const why = checkImage(u.image, art); if (why) bad(`${up}`, why); }
      if (!Array.isArray(u.outcome_codes) || !u.outcome_codes.every((o) => isStr(o, 40))) bad(`${up}.outcome_codes`, 'must be a list of short strings');
      if (!Array.isArray(u.levels)) bad(`${up}.levels`, 'must be a list (empty for a unit that is still to come)');
      u.levels.forEach((l, li) => checkLevel(l, `${up}.levels[${li}]`, bad, uniq, qids, art));
    });
  });
  return c;
}

function checkLevel(l, p, bad, uniq, qids, art) {
  uniq(p, l?.id);
  if (!isStr(l.title, 80)) bad(`${p}.title`, 'must be 1-80 characters');
  if (l.kind !== 'lesson') bad(`${p}.kind`, 'must be "lesson" (wave 1)');
  if (!Array.isArray(l.learn) || l.learn.length !== 2 || !l.learn.every((x) => isStr(x, 160))) bad(`${p}.learn`, 'must be exactly 2 short lines');
  if (l.go !== undefined && !(l.go && /^[a-z][a-z0-9-]{1,30}$/.test(l.go.building ?? '') && isStr(l.go.label, 50))) bad(`${p}.go`, 'must be { building: "<building key>", label }');
  if (!Array.isArray(l.cards) || l.cards.length < 4 || l.cards.length > 6) bad(`${p}.cards`, 'must be 4-6 cards');
  l.cards.forEach((card, i) => {
    if (!isStr(card?.text, 320)) bad(`${p}.cards[${i}].text`, 'must be 1-320 characters');
    if (card.figure !== undefined) { const why = checkFigure(card.figure); if (why) bad(`${p}.cards[${i}]`, why); }
    if (card.image !== undefined) {
      if (card.figure !== undefined) bad(`${p}.cards[${i}]`, 'a card has a figure or an image, not both');
      const why = checkImage(card.image, art); if (why) bad(`${p}.cards[${i}]`, why);
    }
  });
  if (!Array.isArray(l.questions) || l.questions.length < 7 || l.questions.length > 10) bad(`${p}.questions`, 'must be 7-10 questions');
  l.questions.forEach((q, i) => checkQuestion(q, `${p}.questions[${i}]`, bad, qids));
  const choiceAnswers = l.questions.filter((q) => q.type === 'choice').map((q) => q.answer);
  if (choiceAnswers.length >= 4 && new Set(choiceAnswers).size < 2) bad(`${p}.questions`, 'the right choice sits in the same position every time');
}

function checkQuestion(q, p, bad, qids) {
  if (!KEY.test(q?.id ?? '') || qids.has(q.id)) bad(`${p}.id`, `must be a unique lowercase name${q?.id ? ` ("${q.id}" repeats)` : ''}`);
  qids.add(q.id);
  const words = (q.label ?? '').trim().split(/\s+/).filter(Boolean).length;
  if (!isStr(q.label, 40) || words < 2 || words > 4) bad(`${p}.label`, 'must be 2-4 words');
  if (!isStr(q.prompt, 400)) bad(`${p}.prompt`, 'must be 1-400 characters');
  if (!TYPES.includes(q.type)) bad(`${p}.type`, `must be one of ${TYPES.join(', ')}`);
  if (!isStr(q.hint, 240)) bad(`${p}.hint`, 'must be 1-240 characters');
  if (q.figure !== undefined) { const why = checkFigure(q.figure); if (why) bad(`${p}`, why); }
  if (q.terms !== undefined && !(Array.isArray(q.terms) && q.terms.length <= 3 && q.terms.every((t) => t && isStr(t.term, 40) && isStr(t.meaning, 200)))) bad(`${p}.terms`, 'must be up to 3 { term, meaning }');
  if (q.type === 'choice') {
    if (!Array.isArray(q.options) || q.options.length < 3 || q.options.length > 4) bad(`${p}.options`, 'must be 3-4 options');
    q.options.forEach((o, i) => {
      if (!isStr(o?.text, 120)) bad(`${p}.options[${i}].text`, 'must be 1-120 characters');
      if (!isStr(o.why, 300)) bad(`${p}.options[${i}].why`, 'every option needs a why of 1-300 characters');
      if (/\ball of the above\b|\bnone of the above\b/i.test(o.text)) bad(`${p}.options[${i}].text`, '"all/none of the above" is not allowed');
    });
    if (!ok(q.answer) || q.answer < 0 || q.answer >= q.options.length) bad(`${p}.answer`, 'must be the index of an option');
    const lens = q.options.map((o) => o.text.length);
    if (Math.max(...lens) > 2 * Math.min(...lens) + 20) bad(`${p}.options`, `option lengths ${lens.join('/')} give the answer away: the longest must be at most 2 x the shortest + 20`);
    if (new Set(q.options.map((o) => o.text)).size !== q.options.length) bad(`${p}.options`, 'two options read the same');
  } else if (q.type === 'point') {
    if (!q.figure || !['line', 'bars'].includes(q.figure.kind)) bad(`${p}.figure`, 'a point question needs a line or bars figure');
    const n = q.figure.kind === 'line' ? q.figure.points?.length : q.figure.bars?.length;
    if (!ok(q.answer) || q.answer < 0 || q.answer >= n) bad(`${p}.answer`, 'must be the index of a point on the figure');
    if (!isStr(q.why, 300)) bad(`${p}.why`, 'must be 1-300 characters (shown when the student is right)');
    if (!isStr(q.miss, 300)) bad(`${p}.miss`, 'must be 1-300 characters (shown on a wrong tap; it must not give the answer away)');
  } else {
    if (!UNITS.includes(q.unit)) bad(`${p}.unit`, `must be one of ${UNITS.join(', ')}`);
    if (!Number.isFinite(q.answer) || (q.unit === '$' && !ok(q.answer))) bad(`${p}.answer`, q.unit === '$' ? 'must be a whole number of cents' : 'must be a number');
    if (!Number.isFinite(q.tolerance) || q.tolerance < 0) bad(`${p}.tolerance`, 'must be a number, 0 or more');
    if (!isStr(q.why, 300)) bad(`${p}.why`, 'must be 1-300 characters (shown when the student is right)');
    if (!isStr(q.miss, 300)) bad(`${p}.miss`, 'must be 1-300 characters (shown on a wrong answer; it must not give the answer away)');
    if (!isStr(q.working, 300)) bad(`${p}.working`, 'must be 1-300 characters (the calculation shown after answering)');
    if (q.traps !== undefined && !(Array.isArray(q.traps) && q.traps.length <= 2 && q.traps.every((t) => t && Number.isFinite(t.value) && isStr(t.why, 300)))) bad(`${p}.traps`, 'must be up to 2 { value, why }');
    if (q.check !== undefined && !(q.check && typeof q.check === 'object')) bad(`${p}.check`, 'must be an object (see docs/learn.md)');
  }
}

// What a browser may see before it answers: no answer, why, working, traps or check. Figures, hints and terms are part of the question.
export function publicQuestion(q) {
  const out = { id: q.id, label: q.label, prompt: q.prompt, type: q.type, hint: q.hint };
  if (q.figure) out.figure = q.figure;
  if (q.terms) out.terms = q.terms;
  if (q.type === 'choice') out.options = q.options.map((o) => o.text);
  if (q.type === 'number') out.unit = q.unit;
  return out;
}

export function loadCourses(dir = new URL('./content/', import.meta.url)) {
  const out = new Map();
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.json')).sort()) {
    const course = checkCourse(JSON.parse(fs.readFileSync(new URL(f, dir), 'utf8')), `modules/learn/content/${f}`);
    if (`${course.id}.json` !== f) throw new Error(`modules/learn/content/${f}: id "${course.id}" must match the file name`);
    out.set(course.id, index(course));
  }
  return out;
}

// A lookup built once: levels in road order (empty units are teasers and not in the order), each with its unit and section.
export function index(course) {
  const levels = [], byLevel = new Map(), units = [];
  for (const s of course.sections) for (const u of s.units) {
    units.push({ section: s, unit: u });
    u.levels.forEach((l, i) => { const e = { level: l, unit: u, section: s, n: i + 1, of: u.levels.length, order: levels.length }; levels.push(e); byLevel.set(l.id, e); });
  }
  const questions = new Map();
  for (const e of levels) for (const q of e.level.questions) questions.set(q.id, q);
  return { course, levels, byLevel, units, questions };
}
