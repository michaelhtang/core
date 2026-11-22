// Content check for "The CRA and you" (ft2030-s1-u2). Every real figure is recomputed from modules/learn/companies/tax-facts.js
// (a draft that awaits Mr. Tang's confirmation); nothing is retyped.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { SPENDING as S, HISTORY as H, SIN, CRA_ROLE } from '../modules/learn/companies/tax-facts.js';

const course = JSON.parse(fs.readFileSync(new URL('../modules/learn/content/fintech2030.json', import.meta.url), 'utf8'));
const unit = course.sections.flatMap((s) => s.units).find((u) => u.id === 'ft2030-s1-u2');
const Q = new Map(unit.levels.flatMap((l) => l.questions).map((q) => [q.id, q]));
const right = (id) => { const q = Q.get(id); return q.options[q.answer].text; };
const V = (k) => S[k].value;
const mm = (n) => `$${n.toLocaleString('en-CA')} million`;
const bn = (n) => `$${(n / 1000).toFixed(1)} billion`;
const rev = V('totalRevenues'), exp = V('totalExpenses'), pit = V('personalIncomeTax'), gst = V('gstRevenue');
const year1917 = H.incomeTax1917.value.year;
const ORDER = ['otherDirectExpenses', 'otherTransferPayments', 'oldAgeSecurity', 'healthAndSocialTransfers', 'fiscalArrangements', 'publicDebtCharges', 'childrensBenefits', 'employmentInsurance'];
const sum8 = ORDER.reduce((s, k) => s + V(k), 0);
// a name is the quote's own words in order, with words cut and none added
const cut = (name, quote) => { const w = quote.split(' '); let i = 0; return name.split(' ').every((x) => { i = w.indexOf(x, i) + 1; return i > 0; }); };
const pct1 = (k) => Math.round((V(k) / exp) * 1000) / 10;

test('shape', () => {
  assert.equal(unit.title, 'The CRA and you');
  assert.deepEqual(unit.outcome_codes, ['FIN2060 1.2', 'FIN2060 1.3', 'FIN2060 1.4', 'FIN2060 1.5']);
  assert.equal(unit.levels.length, 3);
  unit.levels.forEach((l, i) => {
    assert.equal(l.id, `ft2030-s1-u2-l${i + 1}`);
    assert.ok(l.cards.length >= 4 && l.cards.length <= 6 && l.questions.length >= 7 && l.questions.length <= 10);
    l.questions.forEach((q, k) => assert.equal(q.id, `${l.id}-q${k + 1}`));
    assert.equal(l.go, undefined);
    for (const c of l.cards) if (c.figure?.kind === 'table') assert.ok(c.figure.columns.length <= 4);
  });
});

test('privacy: nothing shaped like a SIN', () => {
  assert.ok(!/\d{3}[ -]?\d{3}[ -]?\d{3}/.test(JSON.stringify(unit)));
});

test('level 1: CRA facts and the quarterly-payment sum', () => {
  assert.ok(CRA_ROLE.cgeb.value.includes('GST/HST credit') && CRA_ROLE.cgeb.quote.includes('every three months'));
  assert.equal(Q.get('ft2030-s1-u2-l1-q4').answer, 18000 * (12 / 3));
  assert.equal(right('ft2030-s1-u2-l1-q6'), 'The GST/HST credit');
  assert.ok(/continue to receive benefit and credit payments/.test(CRA_ROLE.filingKeepsBenefits.quote) && /filing their income tax and benefit return/.test(CRA_ROLE.filingKeepsBenefits.quote));
  assert.equal(right('ft2030-s1-u2-l1-q7'), 'File his income tax and benefit return');
  assert.equal(right('ft2030-s1-u2-l1-q8'), 'It collects taxes and runs benefit programs through the tax system');
  assert.ok(!JSON.stringify(unit.levels[0]).includes('2016'));
});

test('level 2: SIN facts', () => {
  assert.equal(SIN.issuer.value, 'Service Canada');
  assert.equal(right('ft2030-s1-u2-l2-q2'), SIN.issuer.value);
  assert.ok(/12 years or older/.test(SIN.whoCanApply.quote) && SIN.fee.value === 'no fee');
  assert.deepEqual(SIN.howToApply.value, ['online', 'by mail', 'in person']);
  assert.equal(right('ft2030-s1-u2-l2-q4'), 'By mail');
});

test('level 3: history and spending, recomputed', () => {
  const L = unit.levels[2], tab = (i) => L.cards[i].figure.rows;
  assert.equal(year1917, 1917);
  assert.equal(right('ft2030-s1-u2-l3-q1'), `${year1917}`);
  assert.equal(right('ft2030-s1-u2-l3-q3'), `The ${H.incomeTax1917.value.act}`);
  assert.ok(!/First World|\b20\d\d, that was|years ago/.test(JSON.stringify(L.cards)) && H.originallyTemporary.quote.includes('the war'));
  for (const [r, k] of tab(3).slice(0, 8).map((r, i) => [r[0], ORDER[i]])) assert.ok(cut(r, S[k].quote), `row name is not the quote's words, cut shorter: ${r}`);
  assert.deepEqual(tab(2), [['Personal income tax', mm(pit)], ['GST', mm(gst)], ['Total revenues', mm(rev)]]);
  assert.deepEqual(tab(3).map((r) => r[1]), [...ORDER.map((k) => mm(V(k))), mm(exp)]);
  assert.ok(L.cards[3].text.includes(bn(exp)) && L.cards[3].text.includes(bn(sum8)) && sum8 < exp);
  const bars = L.cards[4].figure.bars;
  assert.deepEqual(bars.map((b) => b.value), ['otherDirectExpenses', 'otherTransferPayments', 'oldAgeSecurity', 'healthAndSocialTransfers', 'publicDebtCharges'].map(pct1));
  assert.equal(Q.get('ft2030-s1-u2-l3-q5').answer, Math.round((pit / rev) * 100));
  assert.equal(Q.get('ft2030-s1-u2-l3-q6').answer, Math.round((V('oldAgeSecurity') / exp) * 100));
  const pt = Q.get('ft2030-s1-u2-l3-q7');
  assert.equal(pt.figure.bars[pt.answer].label, 'Public debt charges');
  assert.ok(cut(pt.figure.bars[pt.answer].label, S.publicDebtCharges.quote));
  assert.equal(pt.figure.bars[pt.answer].value, pct1('publicDebtCharges'));
  assert.equal(ORDER.reduce((a, b) => (V(b) > V(a) ? b : a)), 'otherDirectExpenses');
  assert.equal(right('ft2030-s1-u2-l3-q8'), 'Other direct program expenses');
  assert.equal(right('ft2030-s1-u2-l3-q10'), bn(exp - rev));
});
