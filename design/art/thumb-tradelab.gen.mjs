// Writes three 480x300 TradeLab tile SVGs into the dir given as argv[2].
import { writeFileSync } from 'node:fs';
const out = process.argv[2];
const W = 480, H = 300;
const FONT = `font-family="'Helvetica Neue', Helvetica, Arial, sans-serif"`;

const grid = (stroke) => {
  let s = '';
  for (let x = 0; x <= W; x += 40) s += `<line x1="${x}" y1="0" x2="${x}" y2="${H}"/>`;
  for (let y = 20; y <= H; y += 40) s += `<line x1="0" y1="${y}" x2="${W}" y2="${y}"/>`;
  return `<g stroke="${stroke}" stroke-width="1">${s}</g>`;
};

// Wordmark: "Trade" white + "Lab" accent, on a soft dark plate so it reads at 180 px wide.
const word = (x, y, accent, size = 62, plate = true) => `
  ${plate ? `<rect x="${x - 16}" y="${y - size * 0.86}" width="${size * 4.6}" height="${size * 1.18}" rx="14" fill="#06122b" fill-opacity="0.72"/>` : ''}
  <text x="${x}" y="${y}" ${FONT} font-size="${size}" font-weight="800" letter-spacing="-1.5" fill="#ffffff">Trade<tspan fill="${accent}">Lab</tspan></text>`;

const svg = (body) => `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">${body}</svg>\n`;
const bg = (a, b) => `<defs><linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${a}"/><stop offset="1" stop-color="${b}"/></linearGradient></defs><rect width="${W}" height="${H}" fill="url(#bg)"/>`;

// A: candlesticks ranging under a resistance line, then a breakout.
{
  // [open, close, high, low] in chart units (bigger = higher price)
  const c = [[40,52,56,36],[52,46,58,42],[46,60,64,44],[60,55,66,50],[55,64,68,52],[64,58,70,55],[58,66,69,54],[66,60,70,57],
             [60,67,70,58],[67,63,70,60],[63,69,71,61],[69,84,88,67],[84,96,100,82],[96,92,102,88],[92,108,112,90],[108,120,126,105]];
  const y = (v) => 305 - v * 2.15, cw = 14, gap = 27, x0 = 30;
  let candles = '';
  c.forEach(([o, cl, hi, lo], i) => {
    const x = x0 + i * gap, up = cl >= o, col = up ? '#22c55e' : '#ef4444';
    candles += `<line x1="${x + cw / 2}" y1="${y(hi)}" x2="${x + cw / 2}" y2="${y(lo)}" stroke="${col}" stroke-width="2"/>`;
    candles += `<rect x="${x}" y="${y(Math.max(o, cl))}" width="${cw}" height="${Math.max(2, Math.abs(cl - o) * 2.15)}" rx="2" fill="${col}"/>`;
  });
  const res = y(71);
  writeFileSync(`${out}/thumb-tradelab-a.svg`, svg(`${bg('#0b1d45', '#122c6b')}${grid('#ffffff10')}
  <line x1="20" y1="${res}" x2="345" y2="${res}" stroke="#facc15" stroke-width="2.5" stroke-dasharray="8 6"/>
  <text x="24" y="${res - 8}" ${FONT} font-size="13" font-weight="700" fill="#facc15">RESISTANCE</text>
  ${candles}
  <path d="M330 ${y(70)} Q 390 ${y(90)} 452 ${y(128)}" fill="none" stroke="#facc15" stroke-width="4" stroke-linecap="round"/>
  <path d="M440 ${y(134)} L 462 ${y(132)} L 452 ${y(121)} Z" fill="#facc15"/>
  ${word(36, 92, '#facc15')}`));
}

// B: inverse head and shoulders, neckline break (a bullish reversal pattern).
{
  const pts = [[20,125],[60,170],[95,222],[130,170],[175,155],[215,262],[255,155],[300,170],[335,222],[370,158],[410,112],[456,62]];
  const line = pts.map(([x, yy], i) => `${i ? 'L' : 'M'}${x} ${yy}`).join(' ');
  const area = `${line} L460 ${H} L20 ${H} Z`;
  const lbl = (x, yy, t) => `<text x="${x}" y="${yy}" ${FONT} font-size="12" font-weight="700" fill="#93c5fd" text-anchor="middle">${t}</text>`;
  writeFileSync(`${out}/thumb-tradelab-b.svg`, svg(`${bg('#071a3a', '#0e3a5c')}${grid('#ffffff10')}
  <defs><linearGradient id="ar" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#38bdf8" stop-opacity="0.45"/><stop offset="1" stop-color="#38bdf8" stop-opacity="0"/></linearGradient></defs>
  <path d="${area}" fill="url(#ar)"/>
  <line x1="40" y1="158" x2="470" y2="158" stroke="#facc15" stroke-width="2.5" stroke-dasharray="8 6"/>
  <text x="466" y="150" ${FONT} font-size="13" font-weight="700" fill="#facc15" text-anchor="end">NECKLINE</text>
  <path d="${line}" fill="none" stroke="#38bdf8" stroke-width="4" stroke-linejoin="round" stroke-linecap="round"/>
  ${lbl(95, 242, 'SHOULDER')}${lbl(215, 284, 'HEAD')}${lbl(335, 242, 'SHOULDER')}
  <circle cx="370" cy="158" r="7" fill="#facc15"/>
  <path d="M444 56 L466 54 L462 76 Z" fill="#38bdf8"/>
  ${word(36, 88, '#38bdf8')}`));
}

// C: one simple rising arrow, wordmark front and centre.
{
  writeFileSync(`${out}/thumb-tradelab-c.svg`, svg(`${bg('#0b3b2e', '#14614b')}${grid('#ffffff12')}
  <path d="M30 272 L140 215 L200 238 L300 165 L350 188 L432 118" fill="none" stroke="#ffffff" stroke-opacity="0.18" stroke-width="22" stroke-linejoin="round" stroke-linecap="round"/>
  <path d="M30 272 L140 215 L200 238 L300 165 L350 188 L432 118" fill="none" stroke="#4ade80" stroke-width="10" stroke-linejoin="round" stroke-linecap="round"/>
  <path d="M402 108 L454 92 L442 146 Z" fill="#4ade80" stroke="#4ade80" stroke-width="6" stroke-linejoin="round"/>
  ${word(36, 96, '#4ade80', 66, false)}`));
}
