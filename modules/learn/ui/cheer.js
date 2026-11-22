// The Wolf's cheers (docs/learn.md "Wolf cheers"). Pure: no DOM, no clock, no Math.random. Mr. Tang can reword any line below; keep each under 8 words,
// warm, plain English, Canadian spelling, no money promises. test/learn-cheer.test.js checks the length.
export const LINES = {
  streak3: ['Three in a row. Nice work.', 'That is three right. Keep going.', 'You are on a roll.', 'Three straight. I knew you had it.', 'Good rhythm. Keep it up.'],
  streak5: ['Five in a row. Great focus.', 'Five straight. I am impressed.', 'You are really in the zone.', 'Five right, no misses. Well done.', 'That is a strong run.'],
  fixed: ['You fixed it. That is learning.', 'Got it this time. Well done.', 'I knew you could fix that.', 'Mistakes help us learn. Nice fix.', 'Good thinking. You worked it out.'],
  half: ['Halfway there. Keep going.', 'You are halfway through this level.', 'Nice pace. Halfway done.', 'Half done. You are doing well.', 'Halfway. I am right here with you.'],
  last: ['Last question. You can do it.', 'One more to go.', 'Almost there. Finish strong.', 'Final question. Take your time.', 'The last one. I believe in you.'],
  checkpoint: ['Bonus reached. Nice work.', 'You hit a checkpoint. Great job.', 'Another checkpoint. Keep it going.', 'Strong round so far.', 'You are making progress. Well done.'],
  climb: ['You reached a new level.', 'Level up. Great climbing.', 'Higher already. Nice work.', 'A new level. Keep climbing.', 'Good climb. Keep going.'],
};

// Small stable hash (FNV-1a) of text -> non-negative integer.
export function hash(text) {
  let x = 2166136261;
  for (let i = 0; i < text.length; i++) { x ^= text.charCodeAt(i); x = Math.imul(x, 16777619) >>> 0; }
  return x >>> 0;
}

export const pickLine = (trigger, levelId, index) => {
  const lines = LINES[trigger];
  return lines[hash(`${levelId}|${index}|${trigger}`) % lines.length];
};

// Decide whether to cheer. event:
//   phase    'ask' (a question has just been shown) or 'result' (an answer has just been checked)
//   levelId, index (the 0-based count of questions shown so far in this session), total (questions in a level, 0 if open ended),
//   pos (ask: the question's 0-based place in the level; default index)
//   lastCheer  the index of the question that last had a cheer, or -1/null
//   ask:     retry (true in the "fix the ones you missed" round)
//   result:  correct, streak (first-try right answers in a row, counting this one), fixed (right after missing this same question),
//            checkpoint (a timed-round checkpoint was just reached), climbLevel (an XP Climb level was just reached)
// Returns { trigger, text } or null. At most one cheer per question, and never on two questions in a row.
export function cheerFor(e) {
  if (!e || (e.lastCheer != null && e.lastCheer >= e.index - 1 && e.lastCheer >= 0)) return null;
  let trigger = null;
  if (e.phase === 'ask') {
    if (e.retry || !e.total) return null;
    const pos = e.pos ?? e.index;
    if (pos === e.total - 1 && e.total >= 2) trigger = 'last';
    else if (e.total >= 4 && pos === Math.floor(e.total / 2)) trigger = 'half';
  } else if (e.phase === 'result' && e.correct) {
    if (e.climbLevel) trigger = 'climb';
    else if (e.checkpoint) trigger = 'checkpoint';
    else if (e.fixed) trigger = 'fixed';
    else if (e.streak === 5) trigger = 'streak5';
    else if (e.streak === 3) trigger = 'streak3';
  }
  return trigger ? { trigger, text: pickLine(trigger, e.levelId, e.index) } : null;
}
