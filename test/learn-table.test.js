// Which columns of a lesson table are right-aligned as numbers (modules/learn/ui/tablemath.js, used by ui/figures.js).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { numberColumn } from '../modules/learn/ui/tablemath.js';

const cols = (rows) => rows[0].map((_, i) => numberColumn(rows, i));

test('a journal: the account names read left, the debit and credit amounts are numbers, empty cells and the first column do not count', () => {
  assert.deepEqual(cols([['Jun 2', 'Rent Expense', '$600', ''], ['', 'Cash', '', '$600']]), [false, false, true, true]);
});

test('a column of phrases that mention a number reads left; short amounts, signed amounts, US and Canadian dollars and counts are numbers', () => {
  assert.deepEqual(cols([['Supplier is late', 'No pins on market day', 'Order early'], ['Rate rises', '1 cent adds $3, before tariff', 'Keep spare cash'], ['Tariff', '1 point (1%) adds $4.20', 'Check it']]), [false, false, false]);
  assert.deepEqual(cols([['Sales', '$420', '+$130', 'US$300.00'], ['Pins', '70', '+40', 'C$420.00'], ['Left', '- $291.66', '−$5', '45%']]), [false, true, true, true]);
  assert.deepEqual(cols([['Pay', '$2,400.00 a month'], ['Pay', '$27,000.00 a year']]), [false, false], 'a phrase is not an amount');
});

test('a "?" or a dash is a blank; one label among amounts keeps the column a number column; a column of mostly words does not become one', () => {
  assert.deepEqual(cols([['Assets', '$7,400'], ['Liabilities', '$2,400'], ['Equity', '?'], ['Total', '—']]), [false, true]);
  assert.deepEqual(cols([['', 'Ages 18 to 28'], ['Years', '10'], ['Saved', '$24,000'], ['Age', '47']]), [false, true]);
  assert.deepEqual(cols([['A', '$3,600'], ['B', 'None right now'], ['C', 'It depends'], ['D', '$4,800']]), [false, false]);
});

test('in the real course every journal table keeps its filled Debit and Credit columns as numbers and Account as words', () => {
  const course = JSON.parse(fs.readFileSync(new URL('../modules/learn/content/fintech10.json', import.meta.url), 'utf8'));
  let journals = 0;
  const walk = (o) => {
    if (Array.isArray(o)) return o.forEach(walk);
    if (!o || typeof o !== 'object') return;
    if (o.kind === 'table' && o.columns.join('|') === 'Date|Account|Debit|Credit') {
      journals++;
      const filled = (i) => o.rows.some((r) => String(r[i] ?? '').trim());   // a card may show only the debit line: an empty column has nothing to align
      assert.deepEqual(o.columns.map((_, i) => numberColumn(o.rows, i)), [false, false, filled(2), filled(3)], o.title);
    }
    Object.values(o).forEach(walk);
  };
  walk(course);
  assert.ok(journals >= 5, `${journals} journal tables`);
});
