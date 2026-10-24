// Test harness: runs the REAL route table (same authorize() + CSRF check as Express) against a fresh temp SQLite DB.
// Express itself is not involved (it could not be installed), so HTTP-transport concerns are listed as unverified.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Db } from '../src/lib/db.js';
import { migrate } from '../src/db/migrate.js';
import { makeConfig } from '../src/config.js';
import { defineRoutes } from '../src/routes/index.js';
import { authorize, checkCsrf } from '../src/lib/access.js';
import { getSessionUser } from '../src/services/sessions.js';
import { LocalDiskStorage } from '../src/services/photos.js';
import { HttpError } from '../src/lib/errors.js';
import { hashPassword } from '../src/lib/password.js';

const ROUTES = defineRoutes().map((r) => {
  const keys = [];
  const re = new RegExp(`^${r.path.replace(/:([a-zA-Z]+)/g, (_, k) => { keys.push(k); return '([^/]+)'; })}/?$`);
  return { ...r, re, keys };
});

export function createEnv(overrides = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'luna-test-'));
  const config = makeConfig({ databasePath: path.join(dir, 'test.db'), uploadDir: path.join(dir, 'uploads'), sessionSecret: 'test-secret-test-secret-test-secret!!', loginMaxAttempts: 5, ...overrides });
  const db = new Db(config.databasePath);
  migrate(db);
  const storage = new LocalDiskStorage(config.uploadDir);
  let counter = 0;

  async function call(method, url, { token, body, query, file, headers = {}, csrf = true } = {}) {
    const route = ROUTES.find((r) => r.method === method && r.re.test(url));
    if (!route) return { status: 404, body: { error: { message: 'Not found' } } };
    const m = route.re.exec(url);
    const params = Object.fromEntries(route.keys.map((k, i) => [k, decodeURIComponent(m[i + 1])]));
    const ctx = { db, config, storage, user: null, token, ip: '127.0.0.1', params, query: query || {}, body: body ?? {}, file, status: 200, cookie: null };
    try {
      checkCsrf(method, csrf ? { 'x-requested-with': 'LUNA', ...headers } : headers);
      ctx.user = getSessionUser(db, config, token);
      authorize(route.access, ctx.user);
      const out = await route.handler(ctx);
      return { status: ctx.status, body: out, cookie: ctx.cookie };
    } catch (e) {
      if (e instanceof HttpError) return { status: e.status, body: { error: { message: e.message, fields: e.fields } } };
      throw e;
    }
  }

  /** Create a user directly (any role) and sign in through the real login route; returns {id, token, email}. */
  async function makeUser(role = 'student', name) {
    counter += 1;
    name = name || `User ${counter}`;
    const email = `u${counter}-${role}@example.edu`;
    const id = Number(db.run('INSERT INTO users (email, password_hash, full_name, role) VALUES (?, ?, ?, ?)', email, await hashPassword('Passw0rd!x'), name, role).lastInsertRowid);
    const res = await call('POST', '/api/auth/login', { body: { email, password: 'Passw0rd!x' } });
    return { id, email, token: res.cookie.set.token, name };
  }
  const cat = (name = 'Electronics') => db.get('SELECT id FROM categories WHERE name = ?', name).id;
  const loc = (name = 'Main Library') => db.get('SELECT id FROM campus_locations WHERE name = ?', name).id;
  const today = () => new Date().toISOString().slice(0, 10);
  const lostBody = (o = {}) => ({ title: 'Black iPhone 13', category_id: cat(), description: 'Black iPhone 13 in a clear case, lost near the study tables', last_seen_date: today(), location_id: loc(), contact_preference: 'email', distinguishing_details: 'Cracked corner, sticker of a cat on the back', ...o });
  const foundBody = (o = {}) => ({ title: 'Black phone found', category_id: cat(), description: 'Black iPhone with clear case found on a study table', found_date: today(), location_id: loc(), distinguishing_details: 'Lock screen photo of a beach', storage_status: 'handed_to_security', ...o });
  const cleanup = () => { try { db.close(); } catch { /* already closed */ } fs.rmSync(dir, { recursive: true, force: true }); };
  return { db, config, storage, call, makeUser, cat, loc, lostBody, foundBody, today, cleanup, dir };
}
