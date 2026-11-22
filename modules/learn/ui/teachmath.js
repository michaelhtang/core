// The teacher panel's unit list: which units a class is shown, and one line of numbers for each. No DOM here, so test/learn-teachmath.test.js
// can read it. `c` is one class of GET /api/learn/teach and `u` one of its units.

// A unit is listed when it is open to the class, or when anyone in the class has results in it (a unit closed after students played it keeps its row).
export const shownUnits = (c) => c.units.filter((u) => c.open_units === null || c.open_units.includes(u.id) || u.levels.some((l) => l.finished) || u.hardest.length > 0);

// done: students who finished every level (levels unlock in order, so the least-finished level counts them). finished / total: level finishes out
// of levels x students. lowest: the level with the lowest median first try (the earliest one on a tie), or null when nobody has finished a level.
export function unitLine(u, students) {
  const played = u.levels.filter((l) => l.median_first_try_pct !== null);
  return {
    done: Math.min(...u.levels.map((l) => l.finished)),
    finished: u.levels.reduce((n, l) => n + l.finished, 0),
    total: u.levels.length * students,
    lowest: played.length ? played.reduce((a, b) => (b.median_first_try_pct < a.median_first_try_pct ? b : a)) : null,
  };
}
