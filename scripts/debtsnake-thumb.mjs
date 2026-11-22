// Renders the Arcade tile picture for Debt Snake (480 x 300 JPEG) with the game's own drawing code (ui/games/debtsnake.js), in headless Chromium.
// Needs a running server (VDAA_DEV=1 npm start) and Playwright: node scripts/debtsnake-thumb.mjs http://127.0.0.1:3021 [out.jpg]
import fs from 'node:fs';
import { createRequire } from 'node:module';
const { chromium } = createRequire(import.meta.url)('playwright');   // Playwright is not a dependency of the app: it comes from the machine (NODE_PATH or a global install)

const base = process.argv[2], out = process.argv[3] ?? 'modules/arcade/ui/thumbs/debtsnake.jpg';
if (!base) { console.error('Usage: node scripts/debtsnake-thumb.mjs <base url> [out.jpg]'); process.exit(2); }
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 600, height: 400 } });
await page.goto(`${base}/`);
const url = await page.evaluate(async () => {
  const m = await import('/m/arcade/games/debtsnake.js');
  const { text } = await import('/m/arcade/games/billdash.js');
  const { COL, drawItem, drawSnake, drawWall } = m;
  const cv = document.createElement('canvas'); cv.width = 480; cv.height = 300;
  const g = cv.getContext('2d'), geo = { cell: 30, bx: 0, by: 0, w: 16, h: 10 };
  for (let y = 0; y < 10; y++) for (let x = 0; x < 16; x++) { g.fillStyle = (x + y) & 1 ? COL.cellA : COL.cellB; g.fillRect(x * 30, y * 30, 30, 30); }
  for (const [x, y] of [[13, 7], [14, 7], [15, 7], [15, 6], [0, 0], [1, 0], [0, 1], [15, 0], [15, 1], [14, 0], [0, 9], [1, 9], [2, 9]]) drawWall(g, geo, x, y);
  for (const [x, y] of [[1, 8], [11, 8]]) { g.fillStyle = '#3b4252'; g.beginPath(); g.arc(x * 30 + 15, y * 30 + 15, 11, 0, 7); g.fill(); g.fillStyle = COL.stone; g.beginPath(); g.arc(x * 30 + 15, y * 30 + 14, 9.5, 0, 7); g.fill(); }
  const items = [{ kind: 'coin', x: 12, y: 6 }, { kind: 'coin', x: 13, y: 3 }, { kind: 'coin', x: 2, y: 5 }, { kind: 'coin', x: 10, y: 3, fade: 30 }, { kind: 'skull', x: 14, y: 8 }, { kind: 'key', x: 6, y: 6 },
    { kind: 'coin', x: 3, y: 3, len: 3, dir: 0 }, { kind: 'arrow', x: 11, y: 4, dir: 3 }];
  for (const it of items) drawItem(g, it, geo, 0);
  const cells = [[10, 6], [9, 6], [8, 6], [8, 5], [8, 4], [7, 4], [6, 4], [5, 4], [5, 5], [5, 6], [5, 7], [4, 7], [3, 7], [3, 8], [4, 8], [5, 8], [6, 8], [7, 8], [8, 8]];
  drawSnake(g, { cells, prev: cells, dir: 3, solid: cells.map(() => true) }, geo, 1, { tick: 0, near: 2, warn: false });
  g.fillStyle = 'rgba(11,15,23,0.85)'; g.fillRect(120, 10, 240, 64); g.strokeStyle = COL.gold; g.lineWidth = 2; g.strokeRect(120, 10, 240, 64);
  text(g, 'DEBT', 140, 22, COL.gold, 5); text(g, 'SNAKE', 240, 22, COL.tealLite, 5); text(g, 'PAY IT DOWN', 197, 54, COL.dim, 2);
  text(g, '-$100', 330, 175, COL.tealLite, 3);
  return cv.toDataURL('image/jpeg', 0.9);
});
fs.writeFileSync(out, Buffer.from(url.split(',')[1], 'base64'));
await browser.close();
console.log(`wrote ${out}`);
