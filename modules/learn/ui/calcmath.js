// The Learning Road calculator's arithmetic (docs/learn.md): a small recursive-descent parser, pure and DOM-free, so Node tests can run it.
// No eval, no Function. Grammar:  expr = term (('+'|'-') term)*;  term = unary (('*'|'/') unary)*;  unary = '-' unary | postfix;
// postfix = primary '%'*;  primary = number | '(' expr ')'.
// Percent rule (kept simple): a trailing % divides the number or bracket before it by 100, wherever it sits.
// "50%" = 0.5, "200 + 10%" = 200.1, "200 * 10%" = 20. Results are rounded to 10 significant digits.
export const MAX_LEN = 120;
export const DIV0 = "Can't divide by 0";

function tokenize(src) {
  const out = []; let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (c === ' ') { i++; continue; }
    if (/[0-9.]/.test(c)) {
      let j = i; while (j < src.length && /[0-9.]/.test(src[j])) j++;
      const t = src.slice(i, j);
      if (!/^(\d+\.?\d*|\.\d+)$/.test(t)) return null;
      out.push({ n: Number(t) }); i = j; continue;
    }
    const op = { '+': '+', '-': '-', '−': '-', '*': '*', '×': '*', '/': '/', '÷': '/', '(': '(', ')': ')', '%': '%' }[c];
    if (!op) return null;
    out.push({ op }); i++;
  }
  return out;
}

export function calculate(expr) {
  if (typeof expr !== 'string') return { error: 'Not a calculation' };
  if (expr.length > MAX_LEN) return { error: 'Too long' };
  if (!expr.trim()) return { error: 'Type a calculation' };
  const toks = tokenize(expr);
  if (!toks) return { error: 'Not a calculation' };
  let p = 0, depth = 0;
  const bad = new Error('bad'), zero = new Error('zero');
  const peek = () => toks[p]?.op;
  function expression() {
    let v = term();
    while (peek() === '+' || peek() === '-') { const o = toks[p++].op; const r = term(); v = o === '+' ? v + r : v - r; }
    return v;
  }
  function term() {
    let v = unary();
    while (peek() === '*' || peek() === '/') {
      const o = toks[p++].op; const r = unary();
      if (o === '/') { if (r === 0) throw zero; v /= r; } else v *= r;
    }
    return v;
  }
  function unary() {
    if (peek() === '-') { p++; if (++depth > 50) throw bad; const v = -unary(); depth--; return v; }
    let v = primary();
    while (peek() === '%') { p++; v /= 100; }
    return v;
  }
  function primary() {
    const t = toks[p];
    if (!t) throw bad;
    if (t.n !== undefined) { p++; return t.n; }
    if (t.op === '(') {
      p++; if (++depth > 50) throw bad;
      const v = expression();
      if (peek() !== ')') throw bad;
      p++; depth--; return v;
    }
    throw bad;
  }
  try {
    const v = expression();
    if (p !== toks.length) return { error: 'Not a calculation' };
    if (!Number.isFinite(v)) return { error: 'Too big' };
    return { value: Number(v.toPrecision(10)) };
  } catch (e) {
    return { error: e === zero ? DIV0 : 'Not a calculation' };
  }
}

// A result as digits: at most 10 significant digits, trailing zeros trimmed, no separators, no exponent for everyday sizes.
export function formatResult(v) {
  if (!Number.isFinite(v)) return '';
  const r = Number(v.toPrecision(10));
  if (r === 0) return '0';
  const a = Math.abs(r);
  if (a >= 1e15 || a < 1e-9) return String(r);
  return r.toFixed(Math.max(0, 9 - Math.floor(Math.log10(a)))).replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, '');
}

// What a key typed while the calculator has focus does: a calculator key ('7', '+', '=', 'back', 'clear'), 'close', or null (left to the browser).
// on: what has focus, 'key' (one of the calculator's own keys), 'button' (Hide or "Use this") or 'other' (the display).
// Enter is always "=" on the calculator's own keys. A mouse click leaves focus on the last key clicked, and the browser's own "Enter presses the
// focused button" pressed that key again: C then 25+25 then Enter showed 0, and clicking 2 5 + 2 5 then Enter gave 25+255. Space still presses a
// focused key, so a keyboard-only user can Tab to a key and use it.
export function keyAction(key, on = 'other') {
  if (key === 'Escape') return 'close';
  if (/^[0-9.+\-*/()%]$/.test(key)) return key;
  if (key === 'x' || key === 'X') return '*';
  if (key === '=') return '=';
  if (key === 'Enter') return on === 'button' ? null : '=';
  if (key === 'Backspace') return 'back';
  if (key === 'Delete') return 'clear';
  return null;
}
