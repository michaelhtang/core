// The Learning Road calculator's pure arithmetic (docs/learn.md, "Calculator").
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { calculate, formatResult, keyAction, DIV0 } from '../modules/learn/ui/calcmath.js';

const v = (s) => calculate(s).value;
test('order of operations, brackets, unary minus', () => {
  assert.equal(v('2+3*4'), 14); assert.equal(v('(2+3)*4'), 20); assert.equal(v('10-4-3'), 3); assert.equal(v('2×3÷4'), 1.5);
  assert.equal(v('-5+2'), -3); assert.equal(v('3*-2'), -6); assert.equal(v('--4'), 4); assert.equal(v('-(2+3)'), -5); assert.equal(v('520/12'), 43.33333333);
});
test('decimals shown cleanly', () => {
  assert.equal(v('0.1+0.2'), 0.3); assert.equal(formatResult(v('0.1+0.2')), '0.3'); assert.equal(v('.5+.5'), 1);
  assert.equal(formatResult(v('1/3')), '0.3333333333'); assert.equal(formatResult(v('2.50*2')), '5'); assert.equal(formatResult(v('1000000*3')), '3000000');
});
test('percent divides the number before it by 100', () => {
  assert.equal(v('50%'), 0.5); assert.equal(v('200+10%'), 200.1); assert.equal(v('200*10%'), 20); assert.equal(v('(20+30)%'), 0.5);
});
test('divide by zero and bad input give errors, never throws', () => {
  assert.equal(calculate('5/0').error, DIV0); assert.equal(calculate('1/(2-2)').error, DIV0);
  for (const bad of ['5++', '(', ')', '', '   ', '2 3', '1.2.3', '5*', '*5', '%', 'abc', '2(3)', '()', '5)', null, undefined, 42]) {
    const r = calculate(bad); assert.ok(r.error, `error for ${bad}`); assert.equal(r.value, undefined);
  }
});
test('very long or deeply nested input is rejected', () => {
  assert.ok(calculate('1+'.repeat(100) + '1').error);
  assert.ok(calculate('('.repeat(60) + '1' + ')'.repeat(60)).error);
  assert.ok(calculate('-'.repeat(100)).error);
});
test('no eval or Function in the calculator files', () => {
  for (const f of ['calc.js', 'calcmath.js']) {
    const src = fs.readFileSync(new URL(`../modules/learn/ui/${f}`, import.meta.url), 'utf8');
    assert.ok(!/\beval\s*\(/.test(src) && !/\bFunction\s*\(/.test(src) && !/new Function/.test(src), f);
  }
});

test('Enter is "=" even when a calculator key has focus (C then 25+25 then Enter gave 0)', () => {
  for (const on of ['other', 'key']) assert.equal(keyAction('Enter', on), '=', on);
  assert.equal(keyAction('Enter', 'button'), null);                  // Enter on Hide or "Use this" does that button's job
  assert.equal(keyAction(' ', 'key'), null);                         // Space still presses a focused key, for keyboard-only users
  const typed = [...'25+25'].map((k) => keyAction(k, 'key'));
  assert.deepEqual(typed, ['2', '5', '+', '2', '5']);
  assert.equal(v(typed.join('')), 50);
  assert.equal(keyAction('x'), '*'); assert.equal(keyAction('='), '='); assert.equal(keyAction('Escape', 'key'), 'close');
  assert.equal(keyAction('Backspace'), 'back'); assert.equal(keyAction('Delete'), 'clear'); assert.equal(keyAction('a'), null);
});

test('a mouse or touch tap on a key hands focus back to the display', () => {
  const src = fs.readFileSync(new URL('../modules/learn/ui/calc.js', import.meta.url), 'utf8');
  assert.match(src, /if \(e\.detail\) screen\.focus\(/);
  assert.doesNotMatch(src, /onclick: \(\) => press\(/);
});
