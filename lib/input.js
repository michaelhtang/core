// Validated readers for JSON request bodies and URL params. Every handler reads input through these, never String(body.x) or
// Number(body.x): those throw a TypeError on a crafted object like {"toString":1}, which would be a 500. A wrong type or an
// out-of-range value is a 400 with a plain message.
import { HttpError } from './errors.js';

const own = (body, key) => (Object.hasOwn(body, key) ? body[key] : undefined);
const bad = (key, what) => new HttpError(400, `${key} must be ${what}`);

// Text. A missing value reads as '' (so the caller's own "is required" check gives the friendly message); a non-string is a 400.
export function str(body, key, { max = 200 } = {}) {
  const v = own(body, key);
  if (v === undefined || v === null) return '';
  if (typeof v !== 'string') throw bad(key, 'text');
  if (v.length > max) throw bad(key, `at most ${max} characters`);
  return v;
}

// A whole number (a JSON number with no fraction, never a numeric string). optional: a missing value reads as undefined.
export function int(body, key, { min = -(2 ** 31), max = 2 ** 31, optional = false } = {}) {
  const v = own(body, key);
  if (v === undefined || v === null) {
    if (optional) return undefined;
    throw bad(key, 'a whole number');
  }
  if (!Number.isSafeInteger(v)) throw bad(key, 'a whole number');
  if (v < min || v > max) throw bad(key, `between ${min} and ${max}`);
  return v;
}

export function bool(body, key) {
  const v = own(body, key);
  if (typeof v !== 'boolean') throw bad(key, 'true or false');
  return v;
}

// :id in a URL path. Anything that is not a plain number is simply "not found".
export function idParam(value) {
  if (!/^\d{1,15}$/.test(String(value))) throw new HttpError(404, 'Not found');
  return Number(value);
}
