import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { validateReport, validateLogin, validateRegister, validateClaim, validateImage, validDate, isoToday } from '../../src/lib/validate.js';
import { statusLabel, statusTone, toQuery, errorMessage, timeAgo, formatDate } from '../../src/lib/format.js';

const good = { title: 'Black wallet', category_id: '1', description: 'Black leather wallet with cards', last_seen_date: '2026-05-01', location_id: '2' };

describe('client form validation', () => {
  test('valid lost report passes; missing fields are flagged', () => {
    assert.deepEqual(validateReport(good, 'lost', '2026-06-01'), {});
    const e = validateReport({}, 'lost', '2026-06-01');
    for (const f of ['title', 'category_id', 'description', 'last_seen_date', 'location_id']) assert.ok(e[f], `${f} should be flagged`);
  });
  test('dates: future, impossible and malformed are rejected; found uses found_date', () => {
    assert.match(validateReport({ ...good, last_seen_date: '2026-07-01' }, 'lost', '2026-06-01').last_seen_date, /future/);
    assert.match(validateReport({ ...good, last_seen_date: '2026-02-31' }, 'lost', '2026-06-01').last_seen_date, /valid date/);
    assert.ok(validateReport({ ...good, last_seen_date: 'tomorrow' }, 'lost').last_seen_date);
    const found = { ...good, found_date: '2026-05-01' }; delete found.last_seen_date;
    assert.deepEqual(validateReport(found, 'found', '2026-06-01'), {});
    assert.ok(validateReport({ ...found, found_date: '' }, 'found').found_date);
  });
  test('length limits', () => {
    assert.ok(validateReport({ ...good, title: 'ab' }, 'lost', '2026-06-01').title);
    assert.ok(validateReport({ ...good, description: 'too short' }, 'lost', '2026-06-01').description);
    assert.ok(validateReport({ ...good, title: 'x'.repeat(121) }, 'lost', '2026-06-01').title);
  });
  test('login and registration', () => {
    assert.deepEqual(validateLogin({ email: 'a@b.co', password: 'x' }), {});
    assert.ok(validateLogin({}).email && validateLogin({}).password);
    const ok = { full_name: 'Sam S', email: 'sam@campus.edu', password: 'Secret123', confirm: 'Secret123' };
    assert.deepEqual(validateRegister(ok), {});
    assert.ok(validateRegister({ ...ok, email: 'nope' }).email);
    assert.ok(validateRegister({ ...ok, password: 'short1', confirm: 'short1' }).password);
    assert.ok(validateRegister({ ...ok, password: 'allletters', confirm: 'allletters' }).password);
    assert.ok(validateRegister({ ...ok, confirm: 'Different1' }).confirm);
  });
  test('claim explanation and image validation', () => {
    assert.ok(validateClaim({ explanation: '' }).explanation);
    assert.ok(validateClaim({ explanation: 'short' }).explanation);
    assert.deepEqual(validateClaim({ explanation: 'It has my initials on the inside' }), {});
    assert.equal(validateImage(null), null);
    assert.equal(validateImage({ type: 'image/png', size: 1000 }), null);
    assert.ok(validateImage({ type: 'application/pdf', size: 1000 }));
    assert.ok(validateImage({ type: 'image/png', size: 3 * 1024 * 1024 }));
  });
  test('helpers', () => {
    assert.equal(validDate('2024-02-29'), true);
    assert.equal(validDate('2025-02-29'), false);
    assert.match(isoToday(new Date(2026, 0, 5)), /^2026-01-05$/);
  });
});

describe('client formatting helpers', () => {
  test('status labels and tones always give text + a tone', () => {
    assert.equal(statusLabel('claim_pending'), 'Claim pending');
    assert.equal(statusLabel('weird_new_status'), 'weird new status');
    assert.equal(statusTone('returned'), 'teal');
    assert.equal(statusTone('rejected'), 'red');
    assert.equal(statusTone('archived'), 'muted');
  });
  test('toQuery skips empty values and encodes', () => {
    assert.equal(toQuery({ q: 'red bag', type: '', page: 2, x: undefined }), '?q=red+bag&page=2');
    assert.equal(toQuery({}), '');
  });
  test('errorMessage handles network, rate-limit, server and validation errors', () => {
    assert.match(errorMessage({ status: 0 }), /Cannot reach/);
    assert.match(errorMessage({ status: 500, message: 'x' }), /our side/);
    assert.equal(errorMessage({ status: 422, message: 'Fix fields' }), 'Fix fields');
    assert.equal(errorMessage(null), '');
  });
  test('timeAgo and formatDate', () => {
    const now = Date.parse('2026-06-01T12:00:00Z');
    assert.equal(timeAgo('2026-06-01T11:59:50Z', now), 'just now');
    assert.equal(timeAgo('2026-06-01T11:30:00Z', now), '30 min ago');
    assert.equal(timeAgo('2026-06-01T09:00:00Z', now), '3 h ago');
    assert.equal(timeAgo('2026-05-29T12:00:00Z', now), '3 d ago');
    assert.equal(formatDate(''), '');
    assert.ok(formatDate('2026-05-01').includes('2026'));
  });
});
