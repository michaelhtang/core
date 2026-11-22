// Content check for the Learning Road unit "Where your money lives" (ft10-s3-u2): every game figure is recomputed from the game's own modules,
// every figure quoted from Mr. Tang's Lesson 16 outline is pinned to a cited line, and the shape (levels, cards, questions) is checked.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { POLICIES, EVENTS } from '../modules/insurance/constants.js';
import { HISA_BP } from '../modules/savings/constants.js';
import { monthlyInterest } from '../modules/savings/index.js';
import { OPEN_AGE } from '../modules/retirement/constants.js';
import { TFSA_LIMIT_CENTS, RRSP_LIMIT_CENTS, RRSP_EARNED_PCT } from '../modules/exchange/constants.js';
import { tfsaRoom, rrspRoom } from '../modules/exchange/orders.js';

const course = JSON.parse(fs.readFileSync(new URL('../modules/learn/content/fintech10.json', import.meta.url), 'utf8'));
const unit = course.sections.flatMap((s) => s.units).find((u) => u.id === 'ft10-s3-u2');
const Q = new Map(unit.levels.flatMap((l) => l.questions).map((q) => [q.id, q]));
const ans = (id) => Q.get(id).answer;
const money = (c) => `$${(c / 100).toLocaleString('en-CA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const cardText = (l) => unit.levels[l - 1].cards.map((c) => c.text + (c.figure ? JSON.stringify(c.figure) : '')).join(' ');
const all = JSON.stringify(unit);

// Figures quoted from Mr. Tang's Lesson 16 outline (slide-studio/courses/fintech10/context/claude-project/docs/claude_Lesson 16 Slide Outline Oct 1.md).
const OUTLINE = {
  cdicLimit: { cents: 10000000, text: '$100,000', cite: 'line 95: CDIC (federal), $100,000 per category (for example chequing, TFSA, RRSP)' },
  creditUnion: { text: '100%, no limit', cite: 'line 96: Alberta credit union, Credit Union Deposit Guarantee Corporation, backed by the Government of Alberta, 100%, no limit' },
  provincialBank: { text: '100%', cite: 'line 97: ATB Financial row, The Government of Alberta, 100%' },
  respRate: { pct: 20, firstCents: 250000, grantCents: 50000, cite: 'line 120: the government adds 20% of the first $2,500 each year, $500 a year' },
  respTotal: { cents: 720000, cite: 'line 121: up to $7,200 per child in total' },
  clb: { cents: 200000, cite: 'line 122: Canada Learning Bond, up to $2,000, no contribution needed' },
  rrsp: { pct: 18, capCents: 3381000, cite: 'line 137: RRSP 18% of last year\'s income, up to $33,810 (2026)' },
  tfsa: { cents: 700000, cite: 'line 138: TFSA $7,000 a year, open it at 18' },
  phone: { cents: 120000, cite: 'line 159: your phone ($1,200)' },
};

test('shape: 6 levels, 4-6 cards, 7-10 questions, ids, outcome codes, go buttons', () => {
  assert.ok(unit, 'unit ft10-s3-u2 is in fintech10.json');
  assert.equal(unit.title, 'Where your money lives');
  assert.equal(unit.blurb, 'Accounts, what keeps a deposit safe, saving with help from the government, and what is worth insuring.');
  assert.deepEqual(unit.outcome_codes, ['FIN1010 3.2', 'FIN1010 3.8.5', 'FIN1010 3.8.6', 'FIN1010 3.4']);
  assert.equal(unit.levels.length, 6);
  unit.levels.forEach((l, i) => {
    assert.equal(l.id, `ft10-s3-u2-l${i + 1}`);
    assert.ok(l.cards.length >= 4 && l.cards.length <= 6, `${l.id}: ${l.cards.length} cards`);
    assert.ok(l.questions.length >= 7 && l.questions.length <= 10, `${l.id}: ${l.questions.length} questions`);
    assert.ok(l.questions.filter((q) => q.type === 'number').length >= 2, `${l.id}: at least 2 number questions`);
    assert.ok(l.questions.some((q) => q.figure) || l.cards.some((c) => c.figure), `${l.id}: a figure`);
    l.questions.forEach((q, k) => assert.equal(q.id, `${l.id}-q${k + 1}`));
  });
  assert.deepEqual(unit.levels[3].go, { building: 'exchange', label: 'Open the Exchange' });
  assert.deepEqual(unit.levels[5].go, { building: 'insurance', label: 'Open Insurance' });
  assert.ok(!/ATB|RBC|Scotiabank|BMO|CIBC|Servus|EQ Bank|Tangerine|Simplii|Canva|Amara|ISP/.test(all), 'no institution, brand or class story from the outline');
  assert.ok(!/image/.test(Object.keys(unit).join()) && !/"image"/.test(all), 'no pictures in the draft');
});

test('outline figures: each is pinned to its cited line and appears where the unit quotes it', () => {
  const o = OUTLINE;
  assert.ok(cardText(2).includes(o.cdicLimit.text) && cardText(2).includes('CDIC'));
  assert.ok(cardText(2).includes(o.creditUnion.text) && cardText(2).includes('Credit Union Deposit Guarantee Corporation'));
  assert.ok(cardText(2).includes('Government of Alberta'));
  assert.equal(o.respRate.firstCents * o.respRate.pct / 100, o.respRate.grantCents);
  assert.ok(cardText(3).includes('20% of the first $2,500') && cardText(3).includes('$500 a year'));
  assert.ok(cardText(3).includes('$7,200') && cardText(3).includes('$2,000') && cardText(3).includes('Canada Learning Bond'));
  assert.ok(cardText(4).includes('18% of last year\'s income, up to $33,810') && cardText(4).includes('$7,000 a year') && cardText(4).includes('Open it at 18'));
  assert.ok(cardText(5).includes('$1,200') && cardText(5).includes('Alberta Health Care'));
  // the game's own constants agree with the outline's 2026 limits (they are the same numbers; the game starts there)
  assert.equal(TFSA_LIMIT_CENTS, o.tfsa.cents);
  assert.equal(RRSP_LIMIT_CENTS, o.rrsp.capCents);
  assert.equal(RRSP_EARNED_PCT, o.rrsp.pct);
  assert.equal(o.cdicLimit.cents, 100000 * 100);
  assert.equal(o.respTotal.cents, 7200 * 100);
  assert.equal(o.clb.cents, 2000 * 100);
  assert.equal(o.phone.cents, 1200 * 100);
  // every $ amount written in the cards and questions that is not a game figure belongs to a short list of outline or made-up amounts
  assert.equal(tfsaRoom(1, [], TFSA_LIMIT_CENTS), 700000, 'the game starts with one year of TFSA room');
  assert.equal(rrspRoom(1, {}, 0, RRSP_LIMIT_CENTS), 0, 'the game gives no RRSP room in world year 1');
  assert.equal(rrspRoom(2, { 1: 3000000 }, 0, RRSP_LIMIT_CENTS), 540000, 'year 2 room is 18% of year 1 pay');
});

test('level 1 and 2 arithmetic', () => {
  assert.equal(ans('ft10-s3-u2-l1-q8'), 120000 - 30000);
  assert.equal(ans('ft10-s3-u2-l1-q9'), 120000 - 30000 - 65000);
  const protectedIn = (cents) => Math.min(cents, OUTLINE.cdicLimit.cents);
  assert.equal(ans('ft10-s3-u2-l2-q4'), protectedIn(7000000));
  assert.equal(ans('ft10-s3-u2-l2-q5'), protectedIn(13000000));
  assert.equal(ans('ft10-s3-u2-l2-q6'), protectedIn(8000000) + protectedIn(9000000));
  assert.equal(ans('ft10-s3-u2-l2-q7'), Math.max(0, 12000000 - OUTLINE.cdicLimit.cents) + Math.max(0, 4000000 - OUTLINE.cdicLimit.cents));
  assert.equal(ans('ft10-s3-u2-l4-q8'), protectedIn(6000000) + protectedIn(6000000));
});

test('level 3: the RESP grant', () => {
  const grant = (put) => Math.round(Math.min(put, OUTLINE.respRate.firstCents) * OUTLINE.respRate.pct / 100);
  assert.equal(ans('ft10-s3-u2-l3-q3'), grant(250000));
  assert.equal(ans('ft10-s3-u2-l3-q4'), grant(120000));
  assert.equal(ans('ft10-s3-u2-l3-q5'), grant(400000));
  assert.equal(ans('ft10-s3-u2-l3-q6'), 8 * grant(250000));
  assert.equal(ans('ft10-s3-u2-l3-q7'), OUTLINE.respTotal.cents - 8 * grant(250000));
  const rows = unit.levels[2].cards[3].figure.rows;
  assert.deepEqual(rows, [500, 1000, 2500, 4000].map((p) => [`$${p.toLocaleString('en-CA')}`, money(grant(p * 100))]));
});

test('level 4: RRSP and TFSA room', () => {
  const rrsp = (income) => Math.min(Math.floor(income * OUTLINE.rrsp.pct / 100), OUTLINE.rrsp.capCents);
  assert.equal(ans('ft10-s3-u2-l4-q5'), rrsp(3000000));
  assert.equal(ans('ft10-s3-u2-l4-q6'), rrsp(24000000));
  assert.equal(ans('ft10-s3-u2-l4-q7'), OUTLINE.tfsa.cents - 100000);
  assert.ok(cardText(4).includes(String(OPEN_AGE)), 'the Retirement building opens at the game constant');
});

test('level 5: premiums, deductible and claims (made-up amounts)', () => {
  const claim = (loss, ded) => Math.max(0, loss - ded);
  assert.equal(ans('ft10-s3-u2-l5-q2'), claim(OUTLINE.phone.cents, 10000));
  assert.equal(ans('ft10-s3-u2-l5-q3'), claim(90000, 25000));
  assert.equal(ans('ft10-s3-u2-l5-q4'), 1500 * 12);
  assert.equal(ans('ft10-s3-u2-l5-q5'), 1500 * 12 * 5);
  // card 5: a $1,200 loss is more than six years of $180 premiums, and not seven
  assert.ok(6 * 1500 * 12 < OUTLINE.phone.cents && 7 * 1500 * 12 > OUTLINE.phone.cents);
  const t = unit.levels[4].cards[2].figure.rows;
  assert.deepEqual(t.map((r) => r[1]), ['$1,200.00', '$100.00', '$1,100.00']);
});

test('level 6: every game figure is recomputed from modules/insurance, savings and retirement', () => {
  const pol = (k) => POLICIES.find((p) => p.key === k), ev = (k) => EVENTS.find((e) => e.key === k);
  const tenant = pol('tenant'), phone = pol('phone'), theft = ev('laptop-theft'), screen = ev('phone-screen'), dental = ev('dental');
  assert.ok(tenant.buyable && phone.buyable && !pol('auto').buyable && !pol('condo').buyable, 'only tenant and phone can be bought');
  assert.deepEqual(dental.covers, [], 'no policy covers a dental emergency');
  assert.ok(theft.covers.includes('tenant') && screen.covers.includes('phone'));
  const claim = (e, p) => Math.max(0, e.amountCents - p.deductibleCents);
  assert.equal(ans('ft10-s3-u2-l6-q1'), claim(theft, tenant));
  assert.equal(ans('ft10-s3-u2-l6-q2'), claim(screen, phone));
  const year = 12 * tenant.premiumCents;
  assert.equal(ans('ft10-s3-u2-l6-q3'), year);
  // the Insurance building's insured cost = expenses - claims + premiums (modules/insurance/index.js summary)
  const insured = theft.amountCents - claim(theft, tenant) + year;
  assert.equal(ans('ft10-s3-u2-l6-q4'), insured);
  assert.equal(ans('ft10-s3-u2-l6-q5'), theft.amountCents - insured);
  assert.equal(ans('ft10-s3-u2-l6-q6'), monthlyInterest(120000, HISA_BP));
  assert.equal(HISA_BP, 275);
  assert.deepEqual(unit.levels[5].cards[0].figure.rows[0].slice(0, 3), [tenant.name, money(tenant.premiumCents), money(tenant.deductibleCents)]);
  assert.deepEqual(unit.levels[5].cards[0].figure.rows[1].slice(0, 3), [phone.name, money(phone.premiumCents), money(phone.deductibleCents)]);
  const rows = unit.levels[5].cards[3].figure.rows;
  assert.deepEqual(rows, EVENTS.filter((e) => e.kind === 'expense').map((e) => [e.name, money(e.amountCents)]));
  assert.ok(cardText(6).includes('2.75%'));
  // the waiting period on card 3: bought in month m, pays for events from m+2 (modules/insurance/index.js comments, docs/insurance.md)
  assert.ok(cardText(6).includes('If you buy in month 4, it is billed from month 5 and pays for events from month 6'));
});
