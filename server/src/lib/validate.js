// Small, dependency-free server-side validation. Every rule returns a cleaned value or throws a FieldError.
import { HttpError } from './errors.js';
import { todayUtc, addDays } from './time.js';

class FieldError extends Error {}
const fail = (m) => { throw new FieldError(m); };
const CONTROL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/;
const isEmpty = (v) => v === undefined || v === null || (typeof v === 'string' && v.trim() === '');

export const v = {
  str({ min = 1, max = 1000, optional = false } = {}) {
    return (val) => {
      if (isEmpty(val)) return optional ? null : fail('This field is required');
      if (typeof val !== 'string') fail('Must be text');
      const s = val.trim();
      if (CONTROL.test(s)) fail('Contains invalid characters');
      if (s.length < min) fail(`Must be at least ${min} characters`);
      if (s.length > max) fail(`Must be at most ${max} characters`);
      return s;
    };
  },
  int({ min = -Infinity, max = Infinity, optional = false } = {}) {
    return (val) => {
      if (isEmpty(val)) return optional ? null : fail('This field is required');
      const n = typeof val === 'number' ? val : /^-?\d+$/.test(String(val).trim()) ? Number(val) : NaN;
      if (!Number.isInteger(n)) fail('Must be a whole number');
      if (n < min || n > max) fail(`Must be between ${min} and ${max}`);
      return n;
    };
  },
  id: (opts = {}) => v.int({ min: 1, ...opts }),
  oneOf(list, { optional = false, fallback } = {}) {
    return (val) => {
      if (isEmpty(val)) {
        if (fallback !== undefined) return fallback;
        return optional ? null : fail('This field is required');
      }
      if (!list.includes(val)) fail(`Must be one of: ${list.join(', ')}`);
      return val;
    };
  },
  bool({ optional = false } = {}) {
    return (val) => {
      if (val === undefined || val === null) return optional ? null : fail('This field is required');
      if (typeof val !== 'boolean') fail('Must be true or false');
      return val;
    };
  },
  // Calendar date YYYY-MM-DD. noFuture allows "today" in any timezone (UTC today + 1 day tolerance).
  date({ noFuture = false, optional = false } = {}) {
    return (val) => {
      if (isEmpty(val)) return optional ? null : fail('This field is required');
      if (typeof val !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(val)) fail('Use the format YYYY-MM-DD');
      const d = new Date(`${val}T00:00:00Z`);
      if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== val) fail('Not a valid calendar date');
      if (val < '2000-01-01') fail('Date is too far in the past');
      if (noFuture && val > addDays(todayUtc(), 1)) fail('Date cannot be in the future');
      return val;
    };
  },
  email() {
    return (val) => {
      const s = v.str({ min: 5, max: 254 })(val).toLowerCase();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(s)) fail('Enter a valid email address');
      return s;
    };
  },
  password() {
    return (val) => {
      if (typeof val !== 'string' || val.length === 0) fail('This field is required');
      if (val.length < 8) fail('Must be at least 8 characters');
      if (val.length > 128) fail('Must be at most 128 characters');
      if (!/[A-Za-z]/.test(val) || !/\d/.test(val)) fail('Must contain at least one letter and one number');
      return val;
    };
  },
};

/** Validate `body` against `schema` ({field: rule}). partial=true only checks keys present in body. */
export function validate(body, schema, { partial = false } = {}) {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) throw new HttpError(400, 'Invalid request body');
  const out = {};
  const errors = {};
  for (const [key, rule] of Object.entries(schema)) {
    if (partial && !(key in body)) continue;
    try {
      out[key] = rule(body[key]);
    } catch (e) {
      if (e instanceof FieldError) errors[key] = e.message;
      else throw e;
    }
  }
  if (Object.keys(errors).length) throw new HttpError(422, 'Please correct the highlighted fields', errors);
  return out;
}

/** Escape LIKE wildcards so user text is matched literally (use with ESCAPE '\'). */
export const likeEscape = (s) => s.replace(/[\\%_]/g, (c) => `\\${c}`);
