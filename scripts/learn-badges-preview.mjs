// learn: writes data/badges-preview.html, a contact sheet of the ten league badges (32, 64, 128 px; dark and light). Run: node scripts/learn-badges-preview.mjs
import fs from 'node:fs';
import { badgeSvg } from '../modules/learn/ui/badges.js';
import { TIERS } from '../modules/learn/tiers.js';

const row = (bg, fg) => `<section style="background:${bg};color:${fg}"><div class="grid">${TIERS.map((t) => `<figure><div class="sizes">${[32, 64, 128].map((s) => badgeSvg(t.id, s)).join('')}</div><figcaption>${t.name}</figcaption></figure>`).join('')}</div></section>`;
const html = `<!doctype html><meta charset="utf-8"><title>League badges</title>
<style>body{margin:0;font:14px system-ui,sans-serif}section{padding:16px}.grid{display:grid;grid-template-columns:repeat(5,1fr);gap:16px}figure{margin:0;text-align:center}.sizes{display:flex;gap:8px;align-items:flex-end;justify-content:center}figcaption{margin-top:6px;font-weight:600}</style>
${row('#1b1f2a', '#e8ecf4')}${row('#f4f1ea', '#222')}`;
fs.mkdirSync(new URL('../data/', import.meta.url), { recursive: true });
fs.writeFileSync(new URL('../data/badges-preview.html', import.meta.url), html);
console.log('wrote data/badges-preview.html');
