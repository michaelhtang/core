// Measures input lag in the Arcade, in headless Chromium, with the games' own play() (modules/arcade/ui/games/):
//   - Debt Snake: time from a key press or a swipe to the frame where the snake turns, at each speed
//   - Bill Dash: time from a key press to the lane change on the canvas
//   - Bill Dash: two quick taps at set gaps (80-200 ms): did both moves happen?
//   - frame intervals, and the JS cost of drawing one Debt Snake frame
// An optional CPU throttle (1 = none, 6 = six times slower) stands in for a slow Chromebook.
// Needs a running server (VDAA_DEV=1 npm start) and Playwright from the machine (NODE_PATH or a global install).
// Usage: node scripts/arcade-lag.mjs http://127.0.0.1:3021 [throttle ...] [--json]     (default throttles: 1 6; env N = samples per case, default 25)
import { createRequire } from 'node:module';
const { chromium } = createRequire(import.meta.url)('playwright');   // not a dependency of the app

const args = process.argv.slice(2), asJson = args.includes('--json'), rest = args.filter((a) => a !== '--json');
const base = rest[0], throttles = (rest.length > 1 ? rest.slice(1) : ['1', '6']).map(Number), N = Number(process.env.N || 25);
if (!base) { console.error('Usage: node scripts/arcade-lag.mjs <base url> [throttle ...] [--json]'); process.exit(2); }
const browser = await chromium.launch();
const out = {};
for (const rate of throttles) {
  const page = await browser.newPage({ viewport: { width: 800, height: 900 } });
  const cdp = await page.context().newCDPSession(page);
  await page.goto(`${base}/`);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate });
  out[rate] = await page.evaluate(async (N) => {
    const ds = await import('/m/arcade/games/debtsnake.js'), bd = await import('/m/arcade/games/billdash.js');
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    let seed = 7; const rnd = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296);
    const stats = (a) => { a = a.filter((x) => x != null).sort((x, y) => x - y); const q = (p) => Math.round(a[Math.min(a.length - 1, Math.floor(p * a.length))]); return a.length ? { n: a.length, min: q(0), median: q(0.5), p90: q(0.9), max: Math.round(a[a.length - 1]), mean: Math.round(a.reduce((x, y) => x + y, 0) / a.length) } : { n: 0 }; };
    // frame-interval watcher
    const frames = (stopAt) => new Promise((res) => { const iv = []; let p = 0; const f = (t) => { if (p) iv.push(t - p); p = t; if (performance.now() < stopAt) requestAnimationFrame(f); else res(iv); }; requestAnimationFrame(f); });
    const waitUntil = (cond, t0, limit = 1500) => new Promise((res) => { const f = () => { if (cond()) return res(performance.now() - t0); if (performance.now() - t0 > limit) return res(null); requestAnimationFrame(f); }; requestAnimationFrame(f); });
    const R = {};
    // ---- Debt Snake
    for (const speed of ['slow', 'normal', 'fast']) for (const how of ['key', 'swipe']) {
      const cv = document.createElement('canvas'); const sz = ds.size(); cv.width = sz.width; cv.height = sz.height; cv.style.width = '336px'; cv.style.height = '368px'; document.body.replaceChildren(cv);
      const run = ds.play(cv, 12345, { opts: { modes: ['noborders', 'practice'], speed, board: 'normal' } });
      await sleep(1100);                                       // READY countdown
      const lat = [], fromThreshold = [];
      const fi = frames(performance.now() + 4000);
      for (let i = 0; i < N; i++) {
        await sleep(350 + rnd() * 400);
        const v = cv.__view(); if (v.over) break;
        const sn = v.snakes[0], [hx, hy] = sn.cells[0], d = sn.dir;
        const target = d === 3 ? (i & 2 ? 1 : 0) : 3;   // a staircase to the right on a wrapping board: never runs into itself
        const t0 = performance.now();
        if (how === 'key') {
          const code = ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'][target];
          window.dispatchEvent(new KeyboardEvent('keydown', { code, key: code, bubbles: true }));
          window.dispatchEvent(new KeyboardEvent('keyup', { code, key: code, bubbles: true }));
          lat.push(await waitUntil(() => cv.__view().snakes[0].dir === target, t0));
        } else {                                               // a finger moving about 0.5 px per ms, events each 16 ms
          const [dx, dy] = [[0, -1], [0, 1], [-1, 0], [1, 0]][target]; const r = cv.getBoundingClientRect(), x0 = r.left + 168, y0 = r.top + 184;
          const ev = (type, k) => cv.dispatchEvent(new PointerEvent(type, { clientX: x0 + dx * k, clientY: y0 + dy * k, pointerId: 1, pointerType: 'touch', bubbles: true }));
          ev('pointerdown', 0); let tThr = null;
          const p = waitUntil(() => cv.__view().snakes[0].dir === target, t0);
          for (let k = 8; k <= 40; k += 8) { await sleep(16); ev('pointermove', k); if (k >= 22 && tThr == null) tThr = performance.now(); }
          ev('pointerup', 40);
          const L = await p; lat.push(L); fromThreshold.push(L == null ? null : L - (tThr - t0));
        }
      }
      const iv = await fi; run.stop();
      R[`debtsnake ${speed} ${how}`] = { fromPress: stats(lat), ...(how === 'swipe' ? { fromSwipeRecognised: stats(fromThreshold) } : {}), missed: lat.filter((x) => x == null).length, frameMs: stats(iv), slowFrames: iv.filter((x) => x > 25).length + '/' + iv.length };
    }
    // ---- Bill Dash: read the highlighted lane off the canvas
    {
      const cv = document.createElement('canvas'); cv.width = 160; cv.height = 120; cv.style.width = '480px'; cv.style.height = '360px'; document.body.replaceChildren(cv);
      const g = cv.getContext('2d', { willReadFrequently: true });
      let run, over; const start = async () => { over = false; run = bd.play(cv, 999); run.done.then(() => { over = true; }); await sleep(1500); }; await start();
      // find the lane x centers by scanning a row in the pay zone for the brightest band
      const laneOf = () => { const row = g.getImageData(0, 102, 160, 1).data; let best = -1, bl = 0; for (let l = 0; l < 4; l++) { const x = 32 + 24 * l + 3, s = row[x * 4] + row[x * 4 + 1]; if (s > best) { best = s; bl = l; } } return bl; };
      const lat = []; const fi = frames(performance.now() + 4000);
      for (let i = 0; i < N; i++) {
        await sleep(250 + rnd() * 300); if (over) await start();
        const before = laneOf(), code = i & 1 ? 'ArrowRight' : 'ArrowLeft';
        const t0 = performance.now();
        window.dispatchEvent(new KeyboardEvent('keydown', { code, key: code }));
        const L = await waitUntil(() => laneOf() !== before, t0, 600);
        window.dispatchEvent(new KeyboardEvent('keyup', { code, key: code }));
        lat.push(L);
      }
      // double tap: two presses (key down 40 ms each) at a set gap; did both moves happen?
      const dbl = {};
      for (const gap of [80, 110, 140, 170, 200]) { let ok = 0;
        for (let i = 0; i < 8; i++) {
          await sleep(350); if (over) await start(); const before = laneOf(), code = before >= 2 ? 'ArrowLeft' : 'ArrowRight';
          for (let k = 0; k < 2; k++) { window.dispatchEvent(new KeyboardEvent('keydown', { code, key: code })); await sleep(40); window.dispatchEvent(new KeyboardEvent('keyup', { code, key: code })); if (!k) await sleep(gap - 40); }
          await sleep(200); if (Math.abs(laneOf() - before) === 2) ok++;
        }
        dbl[gap + 'ms'] = ok + '/8'; }
      const iv = await fi; run.stop();
      R['billdash key'] = { fromPress: stats(lat), missed: lat.filter((x) => x == null).length, frameMs: stats(iv), slowFrames: iv.filter((x) => x > 25).length + '/' + iv.length, doubleTapBothMoved: dbl };
    }
    // raw draw cost of one Debt Snake frame (the 4x canvas)
    {
      const cv = document.createElement('canvas'); const sz = ds.size(); cv.width = sz.width; cv.height = sz.height; document.body.replaceChildren(cv);
      const run = ds.play(cv, 5, { opts: { modes: ['classic'], speed: 'normal', board: 'normal', coins: 5 } }); await sleep(1500);
      const t = []; for (let i = 0; i < 30; i++) { await new Promise((r) => requestAnimationFrame(r)); const a = performance.now(); ds.draw?.(cv.getContext('2d'), cv.__view(), { step: 5 }); t.push(performance.now() - a); }
      run.stop(); R['debtsnake draw cost (JS only)'] = ds.draw ? stats(t) : 'draw not exported';
    }
    return R;
  }, N);
  await page.close();
}
await browser.close();
if (asJson) console.log(JSON.stringify(out, null, 1));
else for (const [rate, R] of Object.entries(out)) {
  console.log(`\nCPU throttle x${rate}   (ms: median / 90th percentile / max; N=${N} per case)`);
  const line = (label, s) => s && s.n ? `${label.padEnd(34)} ${String(s.median).padStart(4)} ${String(s.p90).padStart(4)} ${String(s.max).padStart(4)}` : `${label.padEnd(34)} ${typeof s === 'string' ? s : 'no samples'}`;
  for (const [name, r] of Object.entries(R)) {
    if (!r.fromPress) { console.log(line(name, r)); continue; }
    console.log(line(name, r.fromPress) + `   missed ${r.missed}`);
    if (r.fromSwipeRecognised) console.log(line('  (from swipe recognised)', r.fromSwipeRecognised));
    console.log(line('  frame interval', r.frameMs) + `   slow frames (>25 ms) ${r.slowFrames}`);
    if (r.doubleTapBothMoved) console.log('  double tap, both moves happened: ' + Object.entries(r.doubleTapBothMoved).map(([g, v]) => `${g} ${v}`).join('  '));
  }
}
