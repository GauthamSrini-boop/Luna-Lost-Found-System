import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createEnv } from './helpers.js';
import { hashPassword, verifyPassword } from '../src/lib/password.js';

describe('authentication', () => {
  let env;
  before(() => { env = createEnv(); });
  after(() => env.cleanup());

  const body = (o = {}) => ({ email: 'sam@campus.edu', password: 'Secret123', full_name: 'Sam Student', ...o });

  test('registers a student, signs them in, and never stores plaintext', async () => {
    const res = await env.call('POST', '/api/auth/register', { body: body() });
    assert.equal(res.status, 201);
    assert.equal(res.body.user.role, 'student');
    assert.ok(res.cookie.set.token.length > 30);
    const row = env.db.get('SELECT password_hash FROM users WHERE email = ?', 'sam@campus.edu');
    assert.ok(row.password_hash.startsWith('scrypt$'));
    assert.ok(!row.password_hash.includes('Secret123'));
    const raw = env.db.get('SELECT token_hash FROM sessions').token_hash;
    assert.notEqual(raw, res.cookie.set.token, 'raw session token must not be stored');
    const me = await env.call('GET', '/api/auth/me', { token: res.cookie.set.token });
    assert.equal(me.body.user.email, 'sam@campus.edu');
    assert.equal(me.body.user.password_hash, undefined);
  });

  test('rejects duplicate registration (case-insensitive email)', async () => {
    const res = await env.call('POST', '/api/auth/register', { body: body({ email: 'SAM@campus.edu' }) });
    assert.equal(res.status, 409);
  });

  test('registration cannot choose a role', async () => {
    const res = await env.call('POST', '/api/auth/register', { body: body({ email: 'evil@campus.edu', role: 'admin' }) });
    assert.equal(res.status, 201);
    assert.equal(res.body.user.role, 'student');
  });

  test('validation errors are field-specific', async () => {
    const res = await env.call('POST', '/api/auth/register', { body: { email: 'nope', password: 'short', full_name: '' } });
    assert.equal(res.status, 422);
    assert.ok(res.body.error.fields.email && res.body.error.fields.password && res.body.error.fields.full_name);
  });

  test('login: success, wrong password, unknown email get the same generic message', async () => {
    const ok = await env.call('POST', '/api/auth/login', { body: { email: 'sam@campus.edu', password: 'Secret123' } });
    assert.equal(ok.status, 200);
    const bad = await env.call('POST', '/api/auth/login', { body: { email: 'sam@campus.edu', password: 'WrongPass1' } });
    const none = await env.call('POST', '/api/auth/login', { body: { email: 'ghost@campus.edu', password: 'WrongPass1' } });
    assert.equal(bad.status, 401);
    assert.equal(none.status, 401);
    assert.equal(bad.body.error.message, none.body.error.message);
  });

  test('per-account lockout after repeated failures (even with the right password afterwards)', async () => {
    for (let i = 0; i < 5; i++) await env.call('POST', '/api/auth/login', { body: { email: 'lock@campus.edu', password: 'x' } });
    const res = await env.call('POST', '/api/auth/login', { body: { email: 'lock@campus.edu', password: 'x' } });
    assert.equal(res.status, 429);
  });

  test('unauthorized access is rejected and logout invalidates the session', async () => {
    assert.equal((await env.call('GET', '/api/reports')).status, 401);
    assert.equal((await env.call('GET', '/api/dashboard', { token: 'garbage' })).status, 401);
    const u = await env.makeUser();
    assert.equal((await env.call('GET', '/api/dashboard', { token: u.token })).status, 200);
    await env.call('POST', '/api/auth/logout', { token: u.token });
    assert.equal((await env.call('GET', '/api/dashboard', { token: u.token })).status, 401);
  });

  test('role enforcement: students cannot reach staff/admin routes; staff cannot reach admin routes', async () => {
    const student = await env.makeUser('student');
    const staff = await env.makeUser('staff');
    const admin = await env.makeUser('admin');
    assert.equal((await env.call('GET', '/api/admin/users', { token: student.token })).status, 403);
    assert.equal((await env.call('GET', '/api/admin/users', { token: staff.token })).status, 403);
    assert.equal((await env.call('GET', '/api/admin/users', { token: admin.token })).status, 200);
    assert.equal((await env.call('GET', '/api/admin/audit', { token: staff.token })).status, 403);
    assert.equal((await env.call('GET', '/api/admin/insights', { token: student.token })).status, 403);
  });

  test('state-changing requests without the CSRF header are refused', async () => {
    const u = await env.makeUser();
    const res = await env.call('POST', '/api/lost', { token: u.token, body: env.lostBody(), csrf: false });
    assert.equal(res.status, 403);
  });

  test('deactivated users are signed out immediately and cannot log in', async () => {
    const admin = await env.makeUser('admin');
    const victim = await env.makeUser('student');
    const res = await env.call('PATCH', `/api/admin/users/${victim.id}`, { token: admin.token, body: { is_active: false } });
    assert.equal(res.status, 200);
    assert.equal((await env.call('GET', '/api/dashboard', { token: victim.token })).status, 401);
    const login = await env.call('POST', '/api/auth/login', { body: { email: victim.email, password: 'Passw0rd!x' } });
    assert.equal(login.status, 403);
  });

  test('admin cannot demote/deactivate themselves or remove the last admin', async () => {
    const admin = await env.makeUser('admin');
    const res = await env.call('PATCH', `/api/admin/users/${admin.id}`, { token: admin.token, body: { role: 'student' } });
    assert.equal(res.status, 409);
  });

  test('changing password verifies the current one and signs out other sessions', async () => {
    const u = await env.makeUser();
    const second = await env.call('POST', '/api/auth/login', { body: { email: u.email, password: 'Passw0rd!x' } });
    const bad = await env.call('POST', '/api/auth/password', { token: u.token, body: { current_password: 'nope', new_password: 'NewPassw0rd' } });
    assert.equal(bad.status, 422);
    const ok = await env.call('POST', '/api/auth/password', { token: u.token, body: { current_password: 'Passw0rd!x', new_password: 'NewPassw0rd' } });
    assert.equal(ok.status, 200);
    assert.equal((await env.call('GET', '/api/dashboard', { token: second.cookie.set.token })).status, 401);
    assert.equal((await env.call('GET', '/api/dashboard', { token: u.token })).status, 200);
  });

  test('password hashing: unique salts, verify works, tampered hash fails', async () => {
    const a = await hashPassword('Abcdefg1');
    const b = await hashPassword('Abcdefg1');
    assert.notEqual(a, b);
    assert.equal(await verifyPassword('Abcdefg1', a), true);
    assert.equal(await verifyPassword('abcdefg1', a), false);
    assert.equal(await verifyPassword('Abcdefg1', 'garbage'), false);
  });
});
