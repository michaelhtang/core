// learn (docs/learn.md): content format and boot check, answers that never leave the server early, the road's locks, the retry rule, the one-time reward,
// first-try counting, the Today errand, the home card, the teacher panel and its class isolation, bots, and the lesson numbers against payroll.js.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createClock } from '../lib/clock.js';
import { boot, seeded } from './helpers.js';
import { learnFixture, PAY_UNIT } from './learn-fixture.js';
import { checkCourse, loadCourses } from '../modules/learn/content.js';
import { rewardFor } from '../modules/learn/index.js';
import { roadPoints, pathTo } from '../modules/learn/ui/roadmath.js';
import { payStub, cppFor, eiFor, employerShare, CPP_MAX, YMPE, CPP_EXEMPTION_ANNUAL } from '../modules/jobs/payroll.js';

const url = (f) => new URL(f, import.meta.url);
const COURSE = JSON.parse(fs.readFileSync(url('../modules/learn/content/fintech10.json'), 'utf8'));
const COURSE2030 = JSON.parse(fs.readFileSync(url('../modules/learn/content/fintech2030.json'), 'utf8'));
const UNIT = COURSE.sections[0].units.find((u) => u.id === PAY_UNIT);
const FIX = learnFixture();   // engine tests boot on the real course cut down to the pay unit
const LEVELS = UNIT.levels, L1 = LEVELS[0].id, L2 = LEVELS[1].id, L3 = LEVELS[2].id;
const QUESTIONS = new Map(LEVELS.flatMap((l) => l.questions.map((q) => [q.id, q])));
const PAYROLL_SRC = fs.readFileSync(url('../modules/jobs/payroll.js'), 'utf8');
const T0 = Date.parse('2026-11-02T15:00:00Z');
const MODULES = ['bank-basic', 'learn', 'today'];
const config = (extra = {}, modules = MODULES) => ({ courses: { fintech10: { label: 'x', modules }, fintech2030: { label: 'y', modules } }, ...extra, options: { ...extra.options, learn: { contentDir: FIX.dir, ...extra.options?.learn } } });
const NO_TODAY = config({}, ['bank-basic', 'learn']);   // no Today errand: balances move by the level reward alone

// the typed or tapped value that is right / wrong for a question
const right = (q) => (q.type === 'number' ? (q.unit === '$' ? (q.answer / 100).toFixed(2) : String(q.answer)) : q.answer);
const wrong = (q) => (q.type === 'number' ? (q.unit === '$' ? ((q.answer + q.tolerance + 777) / 100).toFixed(2) : String(q.answer + q.tolerance + 7))
  : q.type === 'choice' ? (q.answer + 1) % q.options.length : (q.answer + 1) % (q.figure.points ?? q.figure.bars).length);

async function world({ n = 3, cfg = config(), withTeacher = false } = {}) {
  let t = T0;
  const srv = await boot({ config: cfg, clock: createClock({ now: () => t }) });
  const w = await seeded(srv, n, { transfers: false });
  const rows = (sql, ...a) => srv.app.db.prepare(sql).all(...a);
  const advance = (ms) => { t += ms; };
  // every call waits out the 300 ms answer gap first, as a person would
  const post = (s, p, body) => { advance(400); return s.client.post(p, body); };
  const play = async (s, levelId, { miss = [] } = {}) => {
    const start = await post(s, '/api/learn/start', { level_id: levelId });
    assert.equal(start.status, 200, JSON.stringify(start.json));
    const level = LEVELS.find((l) => l.id === levelId);
    for (const [i, q] of level.questions.entries()) {
      if (miss.includes(i)) assert.equal((await post(s, '/api/learn/answer', { level_id: levelId, question_id: q.id, value: wrong(q) })).json.correct, false);
      const r = await post(s, '/api/learn/answer', { level_id: levelId, question_id: q.id, value: right(q) });
      assert.equal(r.json.correct, true, `${q.id}: ${JSON.stringify(r.json)}`);
    }
    return post(s, '/api/learn/finish', { level_id: levelId });
  };
  return { srv, ...w, rows, advance, post, play, balance: (s) => srv.app.ledger.balance(s.chequing.id), cleanup: srv.cleanup };
}

// ---------- content ----------
test('content: the FinTech 10 course validates and has the shape the brief asks for', () => {
  checkCourse(structuredClone(COURSE), 'fintech10.json');
  assert.equal(LEVELS.length, 8);
  for (const l of LEVELS) {
    assert.ok(l.cards.length >= 4 && l.cards.length <= 6, l.id);
    assert.ok(l.questions.length >= 7 && l.questions.length <= 10, l.id);
    assert.ok(l.questions.filter((q) => q.type === 'number').length >= 2, `${l.id}: two number questions`);
    assert.ok(l.questions.some((q) => q.figure), `${l.id}: a figure question`);
    assert.ok(l.cards.every((c) => c.text.length <= 320));
    for (const q of l.questions.filter((x) => x.type === 'choice')) assert.ok(q.options.every((o) => o.why), q.id);
  }
  assert.ok(LEVELS[5].questions.some((q) => q.figure?.kind === 'paystub') && LEVELS[6].questions.some((q) => q.figure?.kind === 'paystub'), 'paystub figures in levels 6 and 7');
  assert.equal(LEVELS[6].go.building, 'job');
  assert.match(JSON.stringify(LEVELS[6]), /Open the Job Centre and find the CPP line on your own pay stub/);
  const ids = [...LEVELS.map((l) => l.id), ...QUESTIONS.keys()];
  assert.equal(new Set(ids).size, ids.length);
  assert.equal(QUESTIONS.size, LEVELS.reduce((n, l) => n + l.questions.length, 0));
});

test('content: a bad item is refused with the file and the exact path', () => {
  const mutate = (fn) => { const c = structuredClone(COURSE); fn(c.sections[0].units[1].levels[0], c); return c; };
  const L = 'sections[0].units[1].levels[0]';
  const cases = [
    [(l) => { delete l.questions[0].options[1].why; }, `${L}.questions[0].options[1].why`],
    [(l) => { l.questions[0].answer = 9; }, `${L}.questions[0].answer`],
    [(l) => { l.cards.pop(); l.cards.pop(); }, `${L}.cards: must be 4-6 cards`],
    [(l) => { l.questions[1].id = l.questions[0].id; }, 'repeats'],
    [(l) => { l.questions[0].options[0].text = 'All of the above'; }, 'all/none of the above'],
    [(l) => { l.questions[0].options[0].text = 'x'.repeat(100); }, 'give the answer away'],
    [(l) => { l.questions[0].label = 'Gross'; }, `${L}.questions[0].label`],
    [(l) => { l.questions[0].type = 'essay'; }, `${L}.questions[0].type`],
    [(l) => { l.questions[1].figure = { kind: 'pie', title: 't' }; }, 'figure.kind'],
    [(l) => { const p = l.questions.find((q) => q.type === 'point'); p.figure = { kind: 'table', title: 't', columns: ['a', 'b'], rows: [['1', '2']] }; }, 'a point question needs a line or bars figure'],
    [(l) => { const n = l.questions.find((q) => q.type === 'number'); delete n.working; }, 'working'],
    [(l) => { const n = l.questions.find((q) => q.type === 'number'); n.answer = 1.5; n.unit = '$'; }, 'whole number of cents'],
    [(l) => { l.questions[0].hint = ''; }, 'hint'],
    [(l) => { l.learn = ['one']; }, 'exactly 2 short lines'],
    [(l) => { l.cards[0].text = 'y'.repeat(321); }, `${L}.cards[0].text`],
    [(l) => { l.cards[0].image.src = 'ft10-s1-u2/L1C1.png'; }, `${L}.cards[0]: image.src must look like`],
    [(l) => { l.cards[0].image.src = 'ft10-s1-u2/nope.webp'; }, `${L}.cards[0]: image.src "ft10-s1-u2/nope.webp" is not a file`],
    [(l) => { delete l.cards[0].image.alt; }, `${L}.cards[0]: image.alt is required`],
    [(l) => { l.cards[0].image.alt = 'pic'; }, 'image.alt is required'],
    [(l) => { l.cards[0].figure = { kind: 'table', title: 't', columns: ['a', 'b'], rows: [['1', '2']] }; }, 'a figure or an image, not both'],
    [(l, c) => { c.sections[0].units[1].image = { src: 'ft10-s1-u2/gone.webp', alt: 'A banner picture' }; }, 'sections[0].units[1]: image.src "ft10-s1-u2/gone.webp"'],
  ];
  for (const [fn, expect] of cases) assert.throws(() => checkCourse(mutate(fn), 'fintech10.json'), (e) => e.message.startsWith('fintech10.json: ') && e.message.includes(expect), expect);
  assert.throws(() => checkCourse(null, 'x.json'), /x\.json: course: must be an object/);
  // a file on disk: the message names the file; its id must match its name
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'learn-content-'));
  try {
    fs.writeFileSync(path.join(dir, 'fintech10.json'), JSON.stringify({ ...COURSE, id: 'other' }));
    assert.throws(() => loadCourses(new URL(`file://${dir}/`)), /fintech10\.json: id "other" must match the file name/);
    fs.writeFileSync(path.join(dir, 'fintech10.json'), JSON.stringify(mutate((l) => { l.questions[0].answer = 7; })));
    assert.throws(() => loadCourses(new URL(`file://${dir}/`)), /fintech10\.json: sections\[0\]\.units\[1\]\.levels\[0\]\.questions\[0\]\.answer/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

// ---------- the lesson numbers agree with the game's pay stub ----------
const recompute = (c) => {
  if (c.constant) return { TC: 1645200, TCP: 2276900 }[c.constant];
  const s = payStub({ grossCents: c.stub, period: 1 });
  switch (c.field) {
    case 'cpp': case 'ei': case 'federalTax': case 'albertaTax': case 'net': return s[c.field];
    case 'tax': return s.federalTax + s.albertaTax;
    case 'deductions': return s.gross - s.net;
    case 'keepPct': return Math.round((s.net * 1000) / s.gross) / 10;
    case 'employerCpp': return employerShare(s).cpp;
    case 'employerEi': return employerShare(s).ei;
    case 'ytdCpp3': { let acc = { ytd: {} }; for (let i = 1; i <= 3; i++) acc = payStub({ grossCents: c.stub, period: i, ytd: acc.ytd }); return acc.ytd.cpp; }
    default: throw new Error(`unknown check ${JSON.stringify(c)}`);
  }
};

test('content: every pay-stub number question is recomputed with payroll.js, and the rates and thresholds the cards state are the ones in payroll.js', () => {
  const checked = [...QUESTIONS.values()].filter((q) => q.check);
  assert.ok(checked.length >= 15, `${checked.length} questions carry a check`);
  for (const q of checked) assert.equal(recompute(q.check), q.answer, `${q.id}: the stored answer is the payroll.js answer`);
  for (const q of QUESTIONS.values()) if (q.type === 'number') assert.ok(Number.isFinite(q.answer) && q.tolerance >= 0, q.id);
  // pay-stub figures: every line is what payStub says for that gross
  for (const q of QUESTIONS.values()) for (const f of [q.figure].filter((x) => x?.kind === 'paystub')) {
    const gross = f.lines.find((l) => l.label === 'Regular earnings').cents, s = payStub({ grossCents: gross, period: 1 });
    const by = Object.fromEntries(f.lines.map((l) => [l.label, l.cents]));
    assert.equal(by['Canada Pension Plan (CPP)'], s.cpp, q.id);
    assert.equal(by['Employment Insurance (EI)'], s.ei, q.id);
    assert.equal(by['Federal income tax'], s.federalTax, q.id);
    assert.equal(by['Alberta income tax'], s.albertaTax, q.id);
    if ('Net pay' in by && q.id !== `${LEVELS[6].id}-q7`) assert.equal(by['Net pay'], s.net, q.id);
  }
  // constants the lessons quote
  assert.equal(CPP_MAX, 423045); assert.equal(YMPE, 7460000); assert.equal(CPP_EXEMPTION_ANNUAL, 350000);
  assert.equal(eiFor(10 ** 9, 0), 112307, 'EI maximum $1,123.07');
  assert.equal(cppFor(29166 + 100000, 0), 5950, 'CPP is 5.95% above the monthly exemption of $291.66');
  assert.equal(eiFor(100000, 0), 1630, 'EI is 1.63% of all gross');
  for (const needle of ['const CPP_RATE = 595', 'const EI_RATE = 163', 'const TC = 1645200', 'const TCP = 2276900', '[5852300, 2050', '[6120000, 1000', '[0, 1400, 0]', '[0, 800, 0]', 'const EI_MAX = 112307']) assert.ok(PAYROLL_SRC.includes(needle), needle);
  const text = JSON.stringify(COURSE);
  for (const s of ['5.95%', '1.63%', '$3,500', '$291.66', '$4,230.45', '$1,123.07', '$68,900', '$16,452', '$22,769', '$58,523', '$61,200', '14%', '8%', '20.5%']) assert.ok(text.includes(s), `the cards state ${s}`);
});

test('content/REVIEW.md lists facts Mr. Tang must confirm, and every question id it names exists', () => {
  const md = fs.readFileSync(url('../modules/learn/content/REVIEW.md'), 'utf8');
  assert.match(md, /^# Facts Mr\. Tang must confirm/);
  const all = new Set(COURSE.sections.flatMap((s) => s.units.flatMap((u) => u.levels.flatMap((l) => l.questions.map((q) => q.id)))));
  const dir = url('../modules/learn/content/');
  let named = 0;
  for (const f of fs.readdirSync(dir).filter((x) => /^REVIEW.*\.md$/.test(x))) {
    for (const [id] of fs.readFileSync(new URL(f, dir), 'utf8').matchAll(/ft10-s\d+-u\d+-l\d+-q\d+/g)) { named++; assert.ok(all.has(id), `${f}: ${id} exists`); }
  }
  assert.ok(named >= 5);
});

test('the Learning Road UI files use no inline styles (the CSP forbids them) and set no style attribute', () => {
  const dir = new URL('../modules/learn/ui/', import.meta.url);
  const files = fs.readdirSync(dir).filter((x) => x.endsWith('.js'));
  assert.ok(files.includes('roadmath.js') && files.includes('road.js') && files.includes('player.js'));
  for (const f of files) {
    const src = fs.readFileSync(new URL(f, dir), 'utf8');
    assert.doesNotMatch(src, /['"]style['"]\s*:|\.style\b|\.style\.|\.cssText|setAttribute\(\s*['"]style|\bstyle\s*=|innerHTML|<script/, f);
  }
  assert.doesNotMatch(fs.readFileSync(new URL('learn.css', dir), 'utf8'), /@import|url\(\s*['"]?https?:/);
});

test('the Learning Road has four tabs: Learn, Quests, Leagues, Review; Quests says coming soon; the tab bar is a tablist of real buttons', () => {
  const dir = new URL('../modules/learn/ui/', import.meta.url), tabs = fs.readFileSync(new URL('tabs.js', dir), 'utf8'), learn = fs.readFileSync(new URL('learn.js', dir), 'utf8'), road = fs.readFileSync(new URL('road.js', dir), 'utf8');
  for (const label of ['Learn', 'Quests', 'Leagues', 'Review']) assert.match(tabs, new RegExp(`label: '${label}'`));
  assert.match(tabs, /Quests are coming soon\./);
  assert.match(tabs, /role: 'tablist'/); assert.match(tabs, /role: 'tab'/); assert.match(tabs, /aria-selected/); assert.match(tabs, /ArrowRight/);
  assert.match(learn, /sessionStorage/); assert.match(learn, /tabs\.js/);
  assert.doesNotMatch(road, /Daily review|Keep sharp|ln-league|practiceRow/, 'the road keeps only the Learn tab');
});

test('the course pictures: the unit banner and every card without a figure that has a file; each file exists and has its own alt', () => {
  assert.equal(UNIT.image.src, 'ft10-s1-u2/banner.webp');
  const cards = LEVELS.flatMap((l) => l.cards);
  const withImage = cards.filter((c) => c.image);
  assert.equal(withImage.length, 32);
  assert.ok(withImage.every((c) => !c.figure));
  assert.equal(new Set(withImage.map((c) => c.image.src)).size, 32);
  assert.equal(new Set(withImage.map((c) => c.image.alt)).size, 32);
});

test('a $ chart holds cents: no bar or point equals a dollar amount quoted beside it (460 beside "$460" would draw as $4.60)', () => {
  for (const u of COURSE.sections.flatMap((s) => s.units)) for (const l of u.levels) for (const x of [...l.cards.map((c) => [c.figure, c.text]), ...l.questions.map((q) => [q.figure, q.prompt])]) {
    const [f, text] = x;
    if (!f || !['bars', 'line'].includes(f.kind) || f.unit !== '$') continue;
    const quoted = new Set([...String(text).matchAll(/\$([\d,]+)(?:\.\d\d)?/g)].map((m) => Number(m[1].replace(/,/g, ''))).filter((n) => n >= 100));
    // one coincidence is possible ($20.00 of interest is 2000 cents beside "$2,000"), so: two values that match, or one match in a figure whose values are all under 1000
    const vals = (f.bars ?? f.points).map((p) => p.value), hits = [...new Set(vals.filter((v) => quoted.has(v)))];
    assert.ok(!(hits.length >= 2 || (hits.length === 1 && Math.max(...vals) < 1000)), `${l.id} "${f.title}": ${hits.join(', ')} look like dollars, a $ figure takes cents`);
  }
});

test('pictures in every unit: a banner, a picture on every card that has no figure (and on none that has one), files named by level and card, alts unique in the unit', () => {
  for (const u of [COURSE, COURSE2030].flatMap((c) => c.sections.flatMap((s) => s.units)).filter((x) => x.levels.length && x.image)) {
    assert.equal(u.image.src, `${u.id}/banner.webp`);
    const alts = [];
    u.levels.forEach((l, li) => l.cards.forEach((c, ci) => {
      const name = `${u.id} level ${li + 1} card ${ci + 1}`;
      if (u.id !== UNIT.id) assert.equal(!!c.image, !c.figure, `${name}: a picture exactly when there is no figure`);   // the pay unit keeps a few plain cards
      if (!c.image) return;
      assert.ok(!c.figure, name);
      assert.equal(c.image.src, `${u.id}/l${li + 1}c${ci + 1}.webp`, name);
      assert.ok(fs.existsSync(url(`../public/art/learn/${c.image.src}`)), `${name}: the file exists`);
      alts.push(c.image.alt);
    }));
    assert.equal(new Set(alts).size, alts.length, `${u.id}: every picture has its own alt`);
  }
});

test('roadPoints: one point per level, inside the width, strictly increasing y, same x as the slot class', () => {
  for (const narrow of [false, true]) for (const n of [1, 8, 11]) for (const width of [100, 343, 940]) {
    const r = roadPoints(n, width, { narrow });
    assert.equal(r.points.length, n);
    r.points.forEach((p, i) => {
      assert.ok(p.x > 0 && p.x < width, `x ${p.x} inside ${width}`);
      assert.equal(p.x, Math.round(p.pct * width) / 100);
      if (i) assert.ok(p.y > r.points[i - 1].y);
    });
    assert.ok(r.points.at(-1).y < r.height);
    assert.match(r.d, /^M[\d.]+ 0 L/);
    assert.equal(r.d.split('C').length - 1, n - 1);
  }
  const wide = roadPoints(8, 100), narrow = roadPoints(8, 100, { narrow: true });
  assert.ok(Math.max(...narrow.points.map((p) => p.pct)) - Math.min(...narrow.points.map((p) => p.pct)) < Math.max(...wide.points.map((p) => p.pct)) - Math.min(...wide.points.map((p) => p.pct)), 'a phone gets a narrower swing');
  assert.equal(pathTo(wide.points, -1), '');
  assert.equal(pathTo(wide.points, 0), `M${wide.points[0].x} 0 L${wide.points[0].x} ${wide.points[0].y}`);
  // every slot percentage has a learn.css class
  const css = fs.readFileSync(url('../modules/learn/ui/learn.css'), 'utf8');
  for (const p of [...wide.points, ...narrow.points]) assert.match(css, new RegExp(`\\.ln-x${p.pct}\\b`));
});

test('reward: 100 cents + 10 per first-try answer, at most 200, times the price index', () => {
  assert.deepEqual([0, 5, 9, 10, 12].map((n) => rewardFor(n, 10000).cents), [100, 150, 190, 200, 200]);
  assert.equal(rewardFor(9, 10300).cents, 196);
  assert.equal(rewardFor(12, 10300).cents, 206);
  assert.equal(rewardFor(12, 10000).capped, true);
});

// ---------- the API ----------
const FORBIDDEN = new Set(['answer', 'why', 'working', 'miss', 'traps', 'tolerance', 'check', '_right', '_wrongs']);
const keysOf = (v, out = new Set()) => { if (Array.isArray(v)) v.forEach((x) => keysOf(x, out)); else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) { out.add(k); keysOf(x, out); } return out; };

test('/state and /start never carry an answer, a why, a working or a trap; the road is open at level 1 only', async () => {
  const w = await world({ n: 1 });
  try {
    const [a] = w.students;
    const st = (await a.client.get('/api/learn/state')).json;
    const start = await w.post(a, '/api/learn/start', { level_id: L1 });
    assert.equal(start.status, 200);
    for (const [name, body] of [['state', st], ['start', start.json]]) {
      const bad = [...keysOf(body)].filter((k) => FORBIDDEN.has(k));
      assert.deepEqual(bad, [], `${name} has forbidden keys`);
      const text = JSON.stringify(body);
      for (const q of LEVELS[0].questions) {
        for (const o of q.options ?? []) assert.ok(!text.includes(o.why), `${name} leaks an option's why`);
        if (q.working) assert.ok(!text.includes(q.working));
        if (q.type !== 'choice') assert.ok(!text.includes(q.why) && !text.includes(q.miss), `${name} leaks a why`);
      }
    }
    assert.equal(st.course.id, 'fintech10');
    assert.equal(st.next.level_id, L1);
    const unit = st.sections[0].units.find((u) => u.id === UNIT.id);
    assert.deepEqual(unit.levels.map((l) => l.status), ['next', ...Array(7).fill('locked')]);
    assert.equal(unit.status, 'current');
    assert.deepEqual(st.sections[0].units.filter((u) => u.levels.length === 0).map((u) => u.status), Array(5).fill('soon'));
    assert.equal(unit.levels[0].max_reward_cents, 190);
    assert.deepEqual(start.json.questions.map((q) => q.id), LEVELS[0].questions.map((q) => q.id));
    assert.equal(start.json.cards.length, LEVELS[0].cards.length);
    assert.deepEqual(start.json.cards.map((c) => c.image ?? null), LEVELS[0].cards.map((c) => c.image ?? null), '/start carries each card picture');
    assert.deepEqual(unit.image, UNIT.image, '/state carries the unit picture');
    assert.equal(st.sections[0].units.find((u) => u.id !== UNIT.id).image, null);
    assert.ok(start.json.questions.filter((q) => q.type === 'choice').every((q) => q.options.every((o) => typeof o === 'string')));
    assert.deepEqual(start.json.questions.find((q) => q.type === 'number'), { id: LEVELS[0].questions.find((q) => q.type === 'number').id, label: 'Weekly to monthly', prompt: LEVELS[0].questions.find((q) => q.type === 'number').prompt, type: 'number', hint: LEVELS[0].questions.find((q) => q.type === 'number').hint, unit: '$' });
  } finally { await w.cleanup(); }
});

test('a locked level is refused; an answer needs a started level; unknown level, question and value are plain errors', async () => {
  const w = await world({ n: 1 });
  try {
    const [a] = w.students;
    for (const id of [L2, L3, LEVELS[7].id]) { const r = await w.post(a, '/api/learn/start', { level_id: id }); assert.equal(r.status, 403, id); }
    assert.match((await w.post(a, '/api/learn/start', { level_id: L2 })).json.error, /Finish .Wages and salary. first/);
    assert.equal((await w.post(a, '/api/learn/start', { level_id: 'nope' })).status, 404);
    assert.equal((await w.post(a, '/api/learn/start', {})).status, 404, 'a missing id is not a level');
    assert.equal((await w.post(a, '/api/learn/answer', { level_id: L1, question_id: LEVELS[0].questions[0].id, value: 0 })).status, 409, 'not started');
    assert.equal((await w.post(a, '/api/learn/finish', { level_id: L1 })).status, 409);
    assert.equal((await w.post(a, '/api/learn/start', { level_id: L1 })).status, 200);
    assert.equal((await w.post(a, '/api/learn/answer', { level_id: L1, question_id: 'zzz', value: 0 })).status, 404);
    assert.equal((await w.post(a, '/api/learn/answer', { level_id: L1, question_id: LEVELS[1].questions[0].id, value: 0 })).status, 404, 'a question of another level');
    const q = LEVELS[0].questions[0];
    for (const value of [-1, 99, 1.5, '1', null, {}]) assert.equal((await w.post(a, '/api/learn/answer', { level_id: L1, question_id: q.id, value })).status, 400, JSON.stringify(value));
    const num = LEVELS[0].questions.find((x) => x.type === 'number');
    for (const value of ['abc', '', '1e3', '12.345', 'x'.repeat(40)]) assert.equal((await w.post(a, '/api/learn/answer', { level_id: L1, question_id: num.id, value })).status, 400, value);
    assert.equal((await a.client.get('/api/learn/state')).json.sections[0].units[1].levels[1].status, 'locked');
  } finally { await w.cleanup(); }
});

test('a wrong answer queues a retry with the why of the chosen option and no answer; finish waits until every question is right', async () => {
  const w = await world({ n: 1 });
  try {
    const [a] = w.students;
    await w.post(a, '/api/learn/start', { level_id: L1 });
    const qs = LEVELS[0].questions, q1 = qs[0];
    const bad = await w.post(a, '/api/learn/answer', { level_id: L1, question_id: q1.id, value: wrong(q1) });
    assert.equal(bad.json.correct, false);
    assert.equal(bad.json.why, q1.options[wrong(q1)].why);
    assert.equal(bad.json.queued, true);
    assert.equal(bad.json.left, 9);
    assert.ok(!('correct_value' in bad.json) && !('answer' in bad.json) && !('working' in bad.json));
    assert.ok(!JSON.stringify(bad.json).includes(q1.options[q1.answer].why), "the right option's why stays on the server");
    // a number question: wrong gives the miss line (or a named trap), never the working or the answer
    const num = qs.find((q) => q.type === 'number');
    const nbad = await w.post(a, '/api/learn/answer', { level_id: L1, question_id: num.id, value: wrong(num) });
    assert.deepEqual([nbad.json.correct, nbad.json.why], [false, num.miss]);
    const trap = await w.post(a, '/api/learn/answer', { level_id: L1, question_id: num.id, value: (num.traps[0].value / 100).toFixed(2) });
    assert.equal(trap.json.why, num.traps[0].why);
    assert.ok(!('working' in trap.json));
    for (const q of qs.filter((x) => x.id !== q1.id)) assert.equal((await w.post(a, '/api/learn/answer', { level_id: L1, question_id: q.id, value: right(q) })).json.correct, true);
    const early = await w.post(a, '/api/learn/finish', { level_id: L1 });
    assert.equal(early.status, 409);
    assert.match(early.json.error, /1 question still to get right/);
    const good = await w.post(a, '/api/learn/answer', { level_id: L1, question_id: q1.id, value: right(q1) });
    assert.deepEqual([good.json.correct, good.json.correct_value, good.json.left], [true, q1.answer, 0]);
    const done = await w.post(a, '/api/learn/finish', { level_id: L1 });
    assert.equal(done.status, 200, JSON.stringify(done.json));
    assert.equal(done.json.first_try, 7, 'q1 and the number question were missed first');
    assert.equal(done.json.reward_cents, 100 + 70);
    assert.ok(done.json.words.length >= 3 && done.json.words.every((t) => t.term && t.meaning));
    assert.equal(done.json.next.level_id, L2);
  } finally { await w.cleanup(); }
});

test('the reward is paid once per level per world: one learn.reward txn, the ledger audit is clean, and a replay pays nothing', async () => {
  const w = await world({ n: 1, cfg: NO_TODAY });
  try {
    const [a] = w.students;
    const before = w.balance(a);
    const first = await w.play(a, L1, { miss: [0] });
    assert.equal(first.status, 200);
    assert.deepEqual([first.json.first_try, first.json.reward_cents, first.json.paid], [8, 180, true]);
    assert.equal(w.balance(a) - before, 180);
    const txns = w.rows("SELECT id, kind, meta FROM txns WHERE kind = 'learn.reward'");
    assert.equal(txns.length, 1);
    assert.deepEqual([JSON.parse(txns[0].meta).level, JSON.parse(txns[0].meta).firstTry], [L1, 8]);
    assert.equal(w.srv.app.ledger.audit().ok, true);
    assert.equal((await w.post(a, '/api/learn/finish', { level_id: L1 })).status, 409, 'finishing twice');
    // the next level opens; the finished one can be practised
    assert.equal((await a.client.get('/api/learn/state')).json.next.level_id, L2);
    const replay = await w.play(a, L1);
    assert.deepEqual([replay.json.paid, replay.json.reward_cents, replay.json.practice], [false, 0, true]);
    assert.equal(w.balance(a) - before, 180, 'nothing more paid');
    assert.equal(w.rows("SELECT COUNT(*) AS n FROM txns WHERE kind = 'learn.reward'")[0].n, 1);
    const row = w.rows('SELECT * FROM learn_progress WHERE player_id = ?', a.id);
    assert.equal(row.length, 1);
    assert.deepEqual([row[0].first_try, row[0].best_first_try, row[0].questions, row[0].paid_cents], [8, 9, 9, 180], 'the first completion stands; the best is kept');
    assert.equal(w.rows('SELECT COUNT(*) AS n FROM learn_answers WHERE player_id = ?', a.id)[0].n, 9);
    assert.equal(w.rows("SELECT first_correct FROM learn_answers WHERE question_id = ? AND player_id = ?", LEVELS[0].questions[0].id, a.id)[0].first_correct, 0, 'the replay did not overwrite the first answer');
    // a perfect first run pays the full 190
    const second = await w.play(a, L2);
    assert.deepEqual([second.json.first_try, second.json.reward_cents], [LEVELS[1].questions.length, 100 + 10 * LEVELS[1].questions.length]);
    assert.equal(w.srv.app.ledger.audit().ok, true);
  } finally { await w.cleanup(); }
});

test('first-try counting cannot be raised by leaving and coming back, by answering out of order, or by re-answering', async () => {
  const w = await world({ n: 1 });
  try {
    const [a] = w.students;
    const qs = LEVELS[0].questions;
    const s1 = await w.post(a, '/api/learn/start', { level_id: L1 });
    const missed = qs[2];
    await w.post(a, '/api/learn/answer', { level_id: L1, question_id: missed.id, value: wrong(missed) });
    // leave and start again: the same attempt resumes, with what is solved and what is queued
    const s2 = await w.post(a, '/api/learn/start', { level_id: L1 });
    assert.deepEqual([s2.json.solved, s2.json.queue], [[], [missed.id]]);
    // answer the rest in reverse order, then the missed one; answer one of them again afterwards
    for (const q of [...qs].reverse()) await w.post(a, '/api/learn/answer', { level_id: L1, question_id: q.id, value: right(q) });
    const again = await w.post(a, '/api/learn/answer', { level_id: L1, question_id: qs[0].id, value: wrong(qs[0]) });
    assert.deepEqual([again.json.correct, again.json.already], [true, true], 'a solved question is not re-judged');
    const done = await w.post(a, '/api/learn/finish', { level_id: L1 });
    assert.equal(done.json.first_try, 8);
    assert.equal(s1.json.questions.length, 9);
    // a replay with every answer right does not touch the stored first try
    await w.play(a, L1);
    assert.deepEqual({ ...w.rows('SELECT first_try, best_first_try FROM learn_progress')[0] }, { first_try: 8, best_first_try: 9 });
  } finally { await w.cleanup(); }
});

test("one student's attempt cannot be answered or finished by another, and attempts do not mix", async () => {
  const w = await world({ n: 2 });
  try {
    const [a, b] = w.students;
    const q = LEVELS[0].questions[0];
    await w.post(a, '/api/learn/start', { level_id: L1 });
    await w.post(a, '/api/learn/answer', { level_id: L1, question_id: q.id, value: right(q) });
    assert.equal((await w.post(b, '/api/learn/answer', { level_id: L1, question_id: q.id, value: right(q) })).status, 409, "b has not started: a's attempt is not b's");
    assert.equal((await w.post(b, '/api/learn/finish', { level_id: L1 })).status, 409);
    const sb = await w.post(b, '/api/learn/start', { level_id: L1 });
    assert.deepEqual([sb.json.solved, sb.json.queue], [[], []], "b starts with a clean attempt");
    assert.equal((await w.post(b, '/api/learn/answer', { level_id: L1, question_id: q.id, value: wrong(q) })).json.correct, false);
    const sa = await w.post(a, '/api/learn/start', { level_id: L1 });
    assert.deepEqual([sa.json.solved, sa.json.queue], [[q.id], []], "a's attempt is unchanged by b");
    assert.equal(w.rows('SELECT COUNT(*) AS n FROM learn_attempts WHERE finished_at IS NULL')[0].n, 2);
    assert.equal((await w.srv.client().get('/api/learn/state')).status, 401, 'nobody: 401');
  } finally { await w.cleanup(); }
});

test('answers are spaced at least 300 ms apart per student; a closed season refuses a start', async () => {
  const w = await world({ n: 1 });
  try {
    const [a] = w.students;
    const q = LEVELS[0].questions;
    await w.post(a, '/api/learn/start', { level_id: L1 });
    w.advance(400);
    assert.equal((await a.client.post('/api/learn/answer', { level_id: L1, question_id: q[0].id, value: right(q[0]) })).status, 200);
    w.advance(100);
    assert.equal((await a.client.post('/api/learn/answer', { level_id: L1, question_id: q[1].id, value: right(q[1]) })).status, 429);
    w.advance(250);
    assert.equal((await a.client.post('/api/learn/answer', { level_id: L1, question_id: q[1].id, value: right(q[1]) })).status, 200);
    assert.equal((await w.srv.app.db.prepare("SELECT COUNT(*) AS n FROM learn_attempts").get()).n, 1);
    const closed = await w.teacher.post('/api/teach/world/close', {});
    assert.equal(closed.status, 200, JSON.stringify(closed.json));
    assert.equal((await w.post(a, '/api/learn/start', { level_id: L1 })).status, 409);
    const st = (await a.client.get('/api/learn/state')).json;
    assert.equal(st.world_active, false);
  } finally { await w.cleanup(); }
});

test('the event fires after commit and Today\'s "Finish a level on the Learning Road" completes once, for 50 cents x the price index', async () => {
  const w = await world({ n: 2 });
  try {
    const [a, b] = w.students;
    const events = [];
    w.srv.app.events.on('module.learn.completed', (p) => events.push(p));
    const errand = async (s) => (await s.client.get('/api/today/state')).json.errands.find((e) => e.title === 'Finish a level on the Learning Road');
    assert.equal((await errand(a)).status, 'open');
    assert.equal((await errand(b)).status, 'open');
    const before = w.balance(a);
    const fin = await w.play(a, L1);
    assert.equal(fin.status, 200);
    const done = await errand(a);
    assert.equal(done.status, 'done');
    assert.equal(done.reward_cents, 50);
    assert.equal(w.balance(a) - before, fin.json.reward_cents + 50);
    assert.equal((await errand(b)).status, 'open', 'only the student who finished');
    await w.play(a, L2);
    assert.equal(w.rows("SELECT COUNT(*) AS n FROM txns WHERE kind = 'today.errand' AND json_extract(meta, '$.template') = 'learn-level'")[0].n, 1, 'paid once');
    assert.equal(events.length, 2, 'one event per first completion');
    assert.deepEqual(Object.keys(events[0]).sort(), ['firstTry', 'levelId', 'playerId', 'questions', 'worldId']);
    assert.equal(w.srv.app.ledger.audit().ok, true);
  } finally { await w.cleanup(); }
});

test('the home card leads, names the next level and the unit progress; learn.home = false takes the lead flag off', async () => {
  const w = await world({ n: 1 });
  try {
    const [a] = w.students;
    const card = async (c) => (await c.client.get('/api/me')).json.homeCards.find((x) => x.module === 'learn');
    let c = await card(a);
    assert.deepEqual([c.id, c.title, c.lead, c.data.next.level_id, c.data.unit_done, c.data.unit_total], ['road', 'Learning Road', true, L1, 0, 8]);
    assert.equal(c.data.next.unit_title, 'Gross pay to net pay');
    assert.deepEqual(c.data.image, UNIT.image);
    assert.match(c.src, /^\/m\/learn\/card\.js\?v=/);
    assert.equal((await a.client.get('/api/me')).json.panels.find((p) => p.module === 'learn').building.key, 'learn');
    await w.play(a, L1);
    c = await card(a);
    assert.deepEqual([c.data.next.level_id, c.data.unit_done, c.data.levels_done], [L2, 1, 1]);
  } finally { await w.cleanup(); }
  const off = await world({ n: 1, cfg: config({ options: { learn: { home: false } } }) });
  try { assert.equal(((await off.students[0].client.get('/api/me')).json.homeCards.find((x) => x.module === 'learn')).lead, undefined); } finally { await off.cleanup(); }
});

test('a course with no content has no card, an empty state, and refuses a start', async () => {
  const w = await world({ n: 1 });
  try {
    const cls = (await w.teacher.post('/api/teach/classes', { name: 'FT20', course: 'fintech2030' })).json;
    const made = (await w.teacher.post(`/api/teach/classes/${cls.id}/students`, { count: 1 })).json.students[0];
    const c = w.srv.client();
    await c.post('/api/login', { username: made.username, secret: made.pin });
    const me = (await c.get('/api/me')).json;
    assert.equal(me.homeCards.some((x) => x.module === 'learn'), false);
    assert.deepEqual((await c.get('/api/learn/state')).json.sections, []);
    assert.equal((await c.post('/api/learn/start', { level_id: L1 })).status, 404);
  } finally { await w.cleanup(); }
});

// ---------- teacher ----------
test('teacher panel: finished counts, median first-try percent and the three hardest questions, from this class only; another teacher sees only theirs', async () => {
  const w = await world({ n: 3 });
  try {
    const [s1, s2] = w.students;                                    // the third student never finishes
    await w.play(s1, L1);                                           // 9/9
    await w.play(s2, L1, { miss: [0, 1] });                         // 7/9
    const panel = async (c) => (await c.get('/api/learn/teach')).json;
    const mine = (await panel(w.teacher)).classes;
    assert.equal(mine.length, 1);
    const c = mine[0];
    assert.deepEqual([c.name, c.students, c.units.length], ['Block 1', 3, 1]);
    const lv = c.units[0].levels;
    assert.deepEqual([lv[0].finished, lv[0].median_first_try_pct, lv[1].finished, lv[1].median_first_try_pct], [2, 89, 0, null]);
    const hard = c.units[0].hardest;
    assert.equal(hard.length, 3);
    assert.deepEqual(hard.slice(0, 2).map((x) => [x.question_id, x.first_try_pct, x.answered]), [[LEVELS[0].questions[0].id, 50, 2], [LEVELS[0].questions[1].id, 50, 2]]);
    assert.equal(hard[0].prompt, LEVELS[0].questions[0].prompt);
    assert.ok(!JSON.stringify({ ...c, roster: undefined }).includes(s1.username), 'no student names outside the streak roster (which shows game usernames only)');
    // a student gets 403; a second teacher with a second class sees none of this
    assert.equal((await s1.client.get('/api/learn/teach')).status, 403);
    const invite = new URL((await w.teacher.post('/api/teach/invites')).json.url).searchParams.get('invite');
    const b = w.srv.client();
    assert.equal((await b.post('/api/teach/join', { token: invite, username: 'teacherB', passphrase: 'another long passphrase' })).status, 200);
    const bc = (await b.post('/api/teach/classes', { name: 'B block', course: 'fintech10' })).json;
    const bs = (await b.post(`/api/teach/classes/${bc.id}/students`, { count: 2 })).json.students;
    const bclients = [];
    for (const m of bs) { const cl = w.srv.client(); await cl.post('/api/login', { username: m.username, secret: m.pin }); const me = (await cl.get('/api/me')).json; bclients.push({ client: cl, id: me.user.id, chequing: me.accounts.find((x) => x.kind === 'chequing') }); }
    await w.play(bclients[0], L1, { miss: [4] });
    const bPanel = (await panel(b)).classes;
    assert.deepEqual(bPanel.map((x) => x.name), ['B block'], "B reads only B's class");
    assert.deepEqual([bPanel[0].units[0].levels[0].finished, bPanel[0].students], [1, 2]);
    assert.equal(bPanel[0].units[0].hardest[0].question_id, LEVELS[0].questions[4].id);
    assert.ok(!JSON.stringify(bPanel).includes(LEVELS[0].questions[0].id + '"') || bPanel[0].units[0].hardest.every((x) => x.first_try_pct === 100 || x.question_id === LEVELS[0].questions[4].id), 'B sees none of the other class\'s misses');
    const aAfter = (await panel(w.teacher)).classes;
    assert.deepEqual(aAfter.map((x) => x.name), ['Block 1'], "A reads only A's class");
    assert.equal(aAfter[0].units[0].levels[0].finished, 2, "B's finish is not counted in A's class");
  } finally { await w.cleanup(); }
});

// ---------- bots ----------
test('simulate: bots finish 0-2 open levels a class day through the same functions, the reward is paid once per level and the audit is clean', async () => {
  const w = await world({ n: 4, cfg: NO_TODAY });
  try {
    const bots = w.students.map((s) => ({ id: s.id, class_id: w.cls.id, course_id: 'fintech10' }));
    for (let month = 1; month <= 12; month++) w.srv.app.modules.simulate({ month, students: bots });
    const done = w.rows('SELECT player_id, COUNT(*) AS n FROM learn_progress GROUP BY player_id');
    assert.ok(done.length >= 3 && done.every((r) => r.n <= 8), JSON.stringify(done));
    const paid = w.rows('SELECT SUM(paid_cents) AS c FROM learn_progress')[0].c;
    assert.equal(w.rows("SELECT SUM(e.amount_cents) AS c FROM entries e JOIN txns t ON t.id = e.txn_id JOIN accounts a ON a.id = e.account_id WHERE t.kind = 'learn.reward' AND a.kind = 'chequing'")[0].c, paid);
    assert.equal(w.rows("SELECT COUNT(*) AS n FROM txns WHERE kind = 'learn.reward'")[0].n, w.rows('SELECT COUNT(*) AS n FROM learn_progress')[0].n, 'one txn per finished level');
    assert.equal(w.rows('SELECT COUNT(*) AS n FROM learn_attempts WHERE finished_at IS NULL')[0].n, 0);
    assert.equal(w.srv.app.ledger.audit().ok, true);
  } finally { await w.cleanup(); }
});
