// The road's geometry, no DOM (so a test can import it). Each level gets one row ROW tall; the node sits at a fixed slot across the row.
// x is a percentage of the road's width scaled to `width`; slot percentages are the only ones learn.css has classes for (ln-x<pct>).
export const ROW = 140;
// The wide slots are a sine wave's samples (small steps near the edges, big ones through the middle), so the road swings instead of zigzagging.
export const SLOTS = { wide: [20, 29, 50, 71, 80], narrow: [22, 50, 78] };
// Slot order: a wave that visits each slot and turns back, so the road winds left-right without jumping.
const order = (k, i) => { const m = 2 * (k - 1), t = i % m; return t <= k - 1 ? t : m - t; };

export function roadPoints(n, width = 100, { narrow = false } = {}) {
  const slots = narrow ? SLOTS.narrow : SLOTS.wide;
  const points = Array.from({ length: n }, (_, i) => {
    const pct = slots[order(slots.length, i)];
    return { pct, x: Math.round(pct * width) / 100, y: ROW * i + ROW / 2 };
  });
  return { points, height: ROW * n, d: pathTo(points, n - 1, ROW * n) };
}

// The path from the top edge through points[0..upto] (upto = -1: nothing). `end` closes it at the bottom edge when given.
// One smooth line: at each node the road leans the way its two neighbours lie (a Catmull-Rom spline), so a run of levels in one
// direction is a single sweep and only a turn-around stands upright. The lean is read from the whole road, never from 0..upto,
// so the lit part (the glow) lies exactly on the road. The first and last nodes stand upright to meet the straight ends.
export function pathTo(points, upto, end) {
  if (upto < 0 || !points.length) return '';
  const r = (v) => Math.round(v * 100) / 100;
  const lean = (i) => (i > 0 && i < points.length - 1 ? (points[i + 1].x - points[i - 1].x) / 6 : 0);
  let d = `M${points[0].x} 0 L${points[0].x} ${points[0].y}`;
  for (let i = 1; i <= upto; i++) {
    const a = points[i - 1], b = points[i], t = (b.y - a.y) / 3;
    d += ` C${r(a.x + lean(i - 1))} ${r(a.y + t)} ${r(b.x - lean(i))} ${r(b.y - t)} ${b.x} ${b.y}`;
  }
  if (end !== undefined) d += ` L${points[upto].x} ${end}`;
  return d;
}
