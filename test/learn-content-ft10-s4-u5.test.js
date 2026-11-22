// Content check for the Learning Road unit "Blockchain and crypto" (ft10-s4-u5). The game has no cryptocurrency (searched modules/ and docs/), so there is no game number to recompute.
// Every dollar and figure quoted from Mr. Tang's Lesson 35 outline is pinned to a cited line; the made-up ledger, majorities and toy fingerprints are recomputed from the cards.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const course = JSON.parse(fs.readFileSync(new URL('../modules/learn/content/fintech10.json', import.meta.url), 'utf8'));
const unit = course.sections.flatMap((s) => s.units).find((u) => u.id === 'ft10-s4-u5');
const Q = new Map(unit.levels.flatMap((l) => l.questions).map((q) => [q.id, q]));
const text = (l) => unit.levels[l - 1].cards.map((c) => c.text).join(' ');
const fig = (l, k) => unit.levels[l - 1].cards[k - 1].figure;
const money = (c) => `$${(c / 100).toLocaleString('en-CA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const OUT = 'slide-studio/courses/fintech10/context/outlines/2026-11-02 Lesson 35 (v2).md';

// Figures quoted from the Lesson 35 outline (history, not current facts). Line numbers are lines of that file.
const OUTLINE = {
  pizza: { date: 'May 22, 2010', coins: 10000, usd: 41, cite: `${OUT} line 309 (slide 6) and line 375 (slide 10)` },
  milestone: { date: 'Dec 5, 2024', price: 100000, total: 1000000000, cite: `${OUT} lines 310-312 (slide 6), line 435 (slide 14), flag 12 (line 158)` },
  paper: { date: 'Oct 31, 2008', pages: 'nine', cite: `${OUT} lines 359-361 (slide 9)` },
  ethereum: { date: 'July 30, 2015', cite: `${OUT} lines 389-390 (slide 11)` },
  payments: { date: 'Oct 21, 2020', coins: 4, cite: `${OUT} line 406 (slide 12) and line 939 (Sources)` },
  etf: { date: 'Jan 10, 2024', cite: `${OUT} lines 420-422 (slide 13)` },
  cards: { about: 50, cite: `${OUT} slide 3 (the "about 50 graphics cards" line) and line 261 (speaker note)` },
  codes: { cite: `${OUT} line 28 (FIN1010 3.8.7, "my judgement", flag 9 at line 140); 3.2 and 5.1.3 are in the same Objectives list` },
};

test('shape: 5 levels, 4-6 cards, 7-10 questions, ids, outcome codes, no go button, no pictures yet', () => {
  assert.ok(unit, 'unit ft10-s4-u5 is in fintech10.json');
  assert.equal(unit.title, 'Blockchain and crypto');
  assert.equal(unit.blurb, 'A ledger nobody owns: what a cryptocurrency is and how a blockchain keeps the list.');
  assert.deepEqual(unit.outcome_codes, ['FIN1010 3.8.7', 'FIN1010 3.2', 'FIN1010 5.1.3']);
  assert.equal(unit.levels.length, 5);
  unit.levels.forEach((l, i) => {
    assert.equal(l.id, `ft10-s4-u5-l${i + 1}`);
    assert.ok(l.cards.length >= 4 && l.cards.length <= 6, `${l.id}: ${l.cards.length} cards`);
    assert.ok(l.questions.length >= 7 && l.questions.length <= 10, `${l.id}: ${l.questions.length} questions`);
    assert.equal(l.go, undefined, 'the game has no cryptocurrency, so no game level');
    l.questions.forEach((q, k) => assert.equal(q.id, `${l.id}-q${k + 1}`));
  });
  assert.ok(!JSON.stringify(unit).includes('"image"'));
});

test('the game has no cryptocurrency or blockchain (so no go button)', () => {
  const root = new URL('..', import.meta.url).pathname;
  const hits = [];
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = `${d}/${e.name}`;
      if (e.isDirectory()) { if (!['node_modules', '.worktrees', 'replica'].includes(e.name)) walk(p); }
      else if (/\.(js|md)$/.test(e.name)) {
        // node:crypto (hashing, random bytes) is not a cryptocurrency: look for the money words only
        if (/blockchain|bitcoin|ethereum|cryptocurrenc|cryptography/i.test(fs.readFileSync(p, 'utf8'))) hits.push(p.slice(root.length));
      }
    }
  };
  walk(`${root}modules`); walk(`${root}docs`); walk(`${root}lib`);
  assert.deepEqual(hits.filter((p) => !p.startsWith('modules/learn/') && !p.startsWith('docs/learn.md')), [], 'a module or doc now mentions crypto: this unit may need a game level');
});

test('the game sentence matches the code and docs: money moves only through one ledger kept by the game', () => {
  assert.match(fs.readFileSync(new URL('../lib/ledger.js', import.meta.url), 'utf8'), /THE ONLY WAY MONEY MOVES/);
  assert.match(fs.readFileSync(new URL('../docs/engagement-review.md', import.meta.url), 'utf8'), /Double-entry ledger/);
  assert.ok(text(3).includes('ledger that the game itself keeps') && text(3).includes('one keeper'));
});

test('outline history: dates, names and figures are quoted as written and told as history', () => {
  const t2 = text(2);
  for (const s of [OUTLINE.paper.date, OUTLINE.pizza.date, OUTLINE.ethereum.date, OUTLINE.payments.date, OUTLINE.etf.date, OUTLINE.milestone.date]) assert.ok(t2.includes(s), s);
  assert.ok(t2.includes('10,000 bitcoin') && t2.includes('US$41') && t2.includes('nine-page'));
  assert.ok(t2.includes('four cryptocurrencies'));
  assert.equal(OUTLINE.milestone.price * OUTLINE.pizza.coins, OUTLINE.milestone.total);
  assert.ok(t2.includes('10,000 x US$100,000 = US$1,000,000,000'));
  assert.ok(text(1).includes('about 50 graphics cards'));
  // no company, app, person or other coin is named, and no year of Mr. Tang's mining
  const all = JSON.stringify(unit);
  for (const bad of ['PayPal', 'Tesla', 'Satoshi', 'Nakamoto', 'Hanyecz', 'Buterin', 'Litecoin', 'Bitcoin Cash', 'XIU', 'Hollow Creek', '2017', '2018', '2019', '21 million', 'GH/s', '6,454']) assert.ok(!all.includes(bad), `must not mention ${bad}`);
  // no price is stated as current and none is predicted
  assert.ok(!/\b(will rise|will fall|going to|should buy|should sell|you should|today's price is)\b/i.test(all));
  assert.ok(all.includes('Prices change every minute, so this lesson uses dates'));
});

test('level 2 numbers recompute (made-up coin, Maya\'s 6 coins; the pizza worth is a choice)', () => {
  const prices = fig(2, 1) ?? Q.get('ft10-s4-u5-l2-q7').figure;
  const day = (r) => Number(prices.rows[r][1].replace(/[^0-9]/g, ''));
  assert.deepEqual([day(0), day(1), day(2)], [12000, 20000, 16000]);
  assert.equal(Q.get('ft10-s4-u5-l2-q7').answer, 6 * day(1) * 100);
  assert.equal(Q.get('ft10-s4-u5-l2-q9').answer, 6 * (Math.max(day(0), day(1), day(2)) - Math.min(day(0), day(1), day(2))) * 100);
  const pz = Q.get('ft10-s4-u5-l2-q8');
  assert.equal(pz.options[pz.answer].text, `US$${(OUTLINE.pizza.coins * OUTLINE.milestone.price).toLocaleString('en-US')}`);
  assert.equal(pz.options.filter((o) => o.text === `US$${OUTLINE.milestone.total.toLocaleString('en-US')}`).length, 1);
});

test('level 3: the ledger, every balance and the total recompute from the table', () => {
  const t = fig(3, 2);
  const rows = t.rows.map(([, f, to, a]) => [f, to, Math.round(Number(a.replace(/[$,]/g, '')) * 100)]);
  const bal = (who, upto = rows.length) => rows.slice(0, upto).reduce((b, [f, to, a]) => b + (to === who ? a : 0) - (f === who ? a : 0), 2000);
  const names = ['Amira', 'Ben', 'Chloe', 'Dev'];
  assert.equal(Q.get('ft10-s4-u5-l3-q3').answer, bal('Amira'));
  assert.equal(Q.get('ft10-s4-u5-l3-q4').answer, bal('Dev'));
  assert.equal(Q.get('ft10-s4-u5-l3-q5').answer, bal('Ben'));
  assert.equal(Q.get('ft10-s4-u5-l3-q7').answer, names.reduce((s, n) => s + bal(n), 0));
  assert.equal(Q.get('ft10-s4-u5-l3-q7').answer, 8000);
  const q6 = Q.get('ft10-s4-u5-l3-q6');
  const richest = names.reduce((a, b) => (bal(b) > bal(a) ? b : a));
  assert.equal(q6.options[q6.answer].text, richest);
  assert.equal(names.filter((n) => bal(n) === bal(richest)).length, 1, 'one richest person');
  assert.ok(text(3).includes(`= ${money(bal('Ben', 2))}`), 'worked example: Ben after row 2');
  assert.equal(bal('Ben', 2), 1700);
  // rejected payment and double spend: Dev has less than $10.00, and then nothing after row 7
  assert.ok(bal('Dev') < 1000);
  assert.ok(Q.get('ft10-s4-u5-l3-q8').prompt.includes(money(bal('Dev'))) && Q.get('ft10-s4-u5-l3-q9').prompt.includes(money(bal('Dev'))));
  for (const id of ['ft10-s4-u5-l3-q3', 'ft10-s4-u5-l3-q4', 'ft10-s4-u5-l3-q5']) assert.ok(Q.get(id).working.includes(money(Q.get(id).answer)), id);
});

test('level 4: majorities (more than half) recompute, and the prompts are consistent', () => {
  const maj = (n) => Math.floor(n / 2) + 1;
  const pick = (id) => { const q = Q.get(id); return q.options[q.answer].text; };
  assert.equal(pick('ft10-s4-u5-l4-q3'), String(maj(13)));
  assert.equal(pick('ft10-s4-u5-l4-q4'), String(maj(8)));
  assert.equal(pick('ft10-s4-u5-l4-q5'), String(maj(10)));
  assert.ok(text(4).includes(`a majority is ${maj(15)}`) && text(4).includes(`a majority is ${maj(6)}`));
  assert.equal([maj(13), maj(8), maj(10), maj(15), maj(6)].join(), '7,5,6,8,4');
  assert.match(Q.get('ft10-s4-u5-l4-q6').prompt, /13 copies/);
  assert.ok(Q.get('ft10-s4-u5-l4-q6').prompt.includes('other 12 copies'));
  assert.ok(text(4).includes('Real Bitcoin goes by computing power, not by counting copies'));
});

test('level 5: the toy fingerprints and every table recompute', () => {
  const fp = (prev, a, b) => prev + 2 * a + b;
  const dollars = (s) => Number(s.replace(/[^0-9]/g, ''));
  const pays = (cell) => cell.split(', ').map(dollars);
  const check = (t, { start = true } = {}) => t.rows.map(([n, p, before, own]) => { const [a, b] = pays(p); return { n: Number(n), a, b, before: Number(before), own: Number(own), calc: fp(Number(before), a, b) }; });
  // the intact chain (card 3): every fingerprint follows the rule and every link matches
  const c = check(fig(5, 3));
  c.forEach((r, i) => { assert.equal(r.own, r.calc, `block ${r.n}`); if (i) assert.equal(r.before, c[i - 1].own, `link ${r.n}`); });
  assert.equal(c[0].before, 0);
  assert.deepEqual(c.map((r) => r.own), [29, 49, 70, 86]);
  // card 4: block 2's second payment changes from $4 to $14; block 3 still holds the old fingerprint
  const t = fig(5, 4).rows;
  assert.equal(Number(t[1][3]), fp(29, 8, 14)); assert.equal(Number(t[1][3]), 59);
  assert.ok(text(5).includes('changes to 59') && text(5).includes('the old one, 49'));
  assert.equal(Number(t[2][2]), 49); assert.notEqual(Number(t[2][2]), Number(t[1][3]));
  assert.ok(t[3][4].startsWith('Yes'));
  // q4: block 5 holds $5 and $7 after block 4 (86)
  const q4 = Q.get('ft10-s4-u5-l5-q4'); assert.equal(q4.options[q4.answer].text, String(fp(86, 5, 7))); assert.equal(fp(86, 5, 7), 103);
  assert.equal(new Set(q4.options.map((o) => o.text)).size, 4);
  // q5: block 3's first payment changed to $16; block 4 notices
  const f5 = check(Q.get('ft10-s4-u5-l5-q5').figure);
  assert.equal(f5[2].own, fp(49, 16, 9)); assert.equal(f5[2].own, 90);
  const broken = f5.filter((r, i) => i && r.before !== f5[i - 1].own).map((r) => r.n);
  assert.deepEqual(broken, [4]);
  const q5 = Q.get('ft10-s4-u5-l5-q5'); assert.equal(q5.options[q5.answer].text, 'Block 4');
  // q6: block 2 changed and block 3 rewritten to match; block 4 notices
  const f6 = check(Q.get('ft10-s4-u5-l5-q6').figure);
  assert.equal(f6[1].own, 59); assert.equal(f6[2].before, 59); assert.equal(f6[2].own, fp(59, 6, 9)); assert.equal(f6[2].own, 80);
  assert.deepEqual(f6.filter((r, i) => i && r.before !== f6[i - 1].own).map((r) => r.n), [4]);
  const q6 = Q.get('ft10-s4-u5-l5-q6'); assert.equal(q6.options[q6.answer].text, 'Block 4');
  // q7 and q8
  assert.equal(Q.get('ft10-s4-u5-l5-q7').answer, (6 + 9 + 3 + 10) * 100);
  assert.equal(Q.get('ft10-s4-u5-l5-q7').traps[0].value, (70 + 86) * 100);
  assert.equal(Q.get('ft10-s4-u5-l5-q8').answer, (14 - 4) * 100);
});

test('level 5 trade-offs table follows the outline\'s comparison table and says neither side is better', () => {
  const tb = fig(5, 6);
  assert.deepEqual(tb.rows.map((r) => r[0]), ['Who keeps the record', 'Forgot your password or lost your key', 'Protection', 'Someone changes an old payment']);
  assert.equal(tb.rows[2][1], 'CDIC, up to a limit'); assert.equal(tb.rows[2][2], 'Not CDIC');
  assert.ok(text(5).includes('Neither column is better'));
  assert.ok(!/\b21 million\b/.test(JSON.stringify(unit)), 'the fixed supply is left to the next unit');
  assert.ok(text(5).includes('The next unit shows how new blocks are made'));
});

test('every question: answers in range, hints do not repeat the answer, labels and whys exist', () => {
  for (const q of Q.values()) {
    if (q.type === 'choice') { assert.ok(q.answer >= 0 && q.answer < q.options.length); assert.ok(!q.hint.includes(q.options[q.answer].text), `${q.id}: hint repeats the answer`); }
    if (q.type === 'number') { assert.equal(q.unit, '$'); assert.ok(Number.isSafeInteger(q.answer) && q.answer < 1e9 * 100, `${q.id}: typed dollars take at most 9 digits`); }
  }
  assert.ok(unit.levels.every((l) => l.questions.some((q) => q.figure)), 'a figure in every level');
});
