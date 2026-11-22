// learn, the teacher preview (docs/learn.md "Teacher preview"): a teacher plays any level through /api/learn/preview/*, judged exactly as a student's
// answer is, and nothing at all is saved or paid. It must work before the teacher has made a class.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { boot, seeded } from './helpers.js';
import { learnFixture, PAY_UNIT } from './learn-fixture.js';

const FIX = learnFixture();
const LEVELS = FIX.course.sections.flatMap((s) => s.units).find((u) => u.id === PAY_UNIT).levels;
const MODS = ['bank-basic', 'learn', 'today'];
const cfg = { courses: { fintech10: { label: 'x', modules: MODS }, fintech2030: { label: 'y', modules: MODS } }, options: { learn: { contentDir: FIX.dir } } };
const right = (q) => (q.type === 'number' ? (q.unit === '$' ? (q.answer / 100).toFixed(2) : String(q.answer)) : q.answer);
const wrong = (q) => (q.type === 'number' ? String(q.answer + q.tolerance + 7) : q.type === 'choice' ? (q.answer + 1) % q.options.length : (q.answer + 1) % (q.figure.points ?? q.figure.bars).length);
const TABLES = ['learn_progress', 'learn_attempts', 'learn_answers', 'learn_review', 'learn_days', 'learn_streak', 'txns', 'entries'];

test('a teacher with no class previews a level: same questions, same judging, no answers leaked', async () => {
  const srv = await boot({ config: cfg });
  try {
    const t = srv.client();
    assert.equal((await t.post('/api/setup', { username: 'teacher', passphrase: 'correct horse battery' })).status, 200);
    const list = (await t.get('/api/learn/teach')).json;
    assert.deepEqual(list.classes, []);
    assert.deepEqual(list.courses.flatMap((c) => c.units).map((u) => u.id), [PAY_UNIT]);              // only units that have levels
    assert.deepEqual(list.courses[0].units[0].levels.map((l) => l.id), LEVELS.map((l) => l.id));
    for (const l of LEVELS) {
      const s = (await t.post('/api/learn/preview/start', { level_id: l.id })).json;
      assert.equal(s.preview, true);
      assert.equal(s.cards.length, l.cards.length);
      assert.deepEqual(s.questions.map((q) => q.id), l.questions.map((q) => q.id));
      assert.doesNotMatch(JSON.stringify(s.questions), /"(answer|why|working|miss|traps)"/);
      for (const q of l.questions) {
        const bad = (await t.post('/api/learn/preview/answer', { level_id: l.id, question_id: q.id, value: wrong(q) })).json;
        assert.equal(bad.correct, false, q.id);
        assert.deepEqual(Object.keys(bad).sort(), ['correct', 'why']);                              // a wrong answer never brings the right one back
        const ok = (await t.post('/api/learn/preview/answer', { level_id: l.id, question_id: q.id, value: right(q) })).json;
        assert.equal(ok.correct, true, q.id);
        assert.equal(ok.why, q.type === 'choice' ? q.options[q.answer].why : q.why);
        assert.equal(ok.working, q.type === 'number' ? q.working : undefined);
      }
    }
    assert.equal((await t.post('/api/learn/preview/start', { level_id: 'nope' })).status, 404);
    assert.equal((await t.post('/api/learn/preview/answer', { level_id: LEVELS[0].id, question_id: 'nope', value: 0 })).status, 404);
    assert.equal((await t.post('/api/learn/preview/answer', { level_id: LEVELS[0].id, question_id: LEVELS[0].questions[0].id, value: 'x'.repeat(40) })).status, 400);
  } finally { await srv.cleanup(); }
});

test('a whole preview writes nothing, and students cannot use the preview routes', async () => {
  const srv = await boot({ config: cfg });
  try {
    const w = await seeded(srv, 1, { transfers: false });
    const snap = () => JSON.stringify(TABLES.map((x) => srv.app.db.prepare(`SELECT * FROM ${x} ORDER BY rowid`).all()));
    const before = snap(), l = LEVELS[0];
    assert.equal((await w.teacher.post('/api/learn/preview/start', { level_id: l.id })).status, 200);
    for (const q of l.questions) for (const v of [wrong(q), right(q)]) assert.equal((await w.teacher.post('/api/learn/preview/answer', { level_id: l.id, question_id: q.id, value: v })).status, 200);
    const s = w.students[0].client;
    assert.equal((await s.post('/api/learn/preview/start', { level_id: l.id })).status, 403);
    assert.equal((await s.post('/api/learn/preview/answer', { level_id: l.id, question_id: l.questions[0].id, value: right(l.questions[0]) })).status, 403);
    assert.equal(snap(), before);
    // and the student's own first try at the level is untouched by the teacher's preview answers
    assert.equal((await s.post('/api/learn/start', { level_id: l.id })).json.solved.length, 0);
  } finally { await srv.cleanup(); }
});
