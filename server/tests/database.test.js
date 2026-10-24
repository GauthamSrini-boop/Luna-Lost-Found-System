import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createEnv } from './helpers.js';
import { Db } from '../src/lib/db.js';
import { migrate, migrationStatus } from '../src/db/migrate.js';
import { createReport } from '../src/services/reports.js';
import { insights } from '../src/services/insights.js';
import { dashboardFor } from '../src/services/dashboard.js';

describe('database behaviour', () => {
  let env, alice, bob, staff;
  before(async () => { env = createEnv(); alice = await env.makeUser('student', 'Alice'); bob = await env.makeUser('student', 'Bob'); staff = await env.makeUser('staff', 'Stella'); });
  after(() => env.cleanup());

  test('migrations are idempotent, tracked, and tamper-evident', () => {
    assert.deepEqual(migrate(env.db), []);
    assert.ok(migrationStatus(env.db).every((m) => m.applied));
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mig-'));
    fs.writeFileSync(path.join(dir, '001_a.sql'), 'CREATE TABLE a (id INTEGER);');
    const db = new Db(':memory:');
    migrate(db, dir);
    fs.writeFileSync(path.join(dir, '001_a.sql'), 'CREATE TABLE a (id INTEGER, x TEXT);');
    assert.throws(() => migrate(db, dir), /modified after being applied/);
    db.close(); fs.rmSync(dir, { recursive: true });
  });

  test('foreign keys are enforced', () => {
    assert.throws(() => env.db.run("INSERT INTO lost_reports (user_id, title, category_id, description, last_seen_date, location_id) VALUES (99999, 'Ghost', 1, 'Some long description', '2026-01-01', 1)"), /FOREIGN KEY constraint failed/);
  });

  test('CHECK, NOT NULL and UNIQUE constraints reject bad data at the database level', async () => {
    const r = await env.call('POST', '/api/lost', { token: alice.token, body: env.lostBody() });
    assert.throws(() => env.db.run("UPDATE lost_reports SET status = 'banana' WHERE id = ?", r.body.id), /CHECK constraint failed/);
    assert.throws(() => env.db.run("UPDATE lost_reports SET last_seen_date = '2026-02-30' WHERE id = ?", r.body.id), /CHECK constraint failed/);
    assert.throws(() => env.db.run("UPDATE lost_reports SET title = NULL WHERE id = ?", r.body.id), /NOT NULL constraint failed/);
    assert.throws(() => env.db.run("INSERT INTO categories (name) VALUES ('electronics')"), /UNIQUE constraint failed/);   // case-insensitive
    assert.throws(() => env.db.run("INSERT INTO users (email, password_hash, full_name) VALUES ('not-an-email', 'x', 'Bad Email')"), /CHECK constraint failed/);
    assert.throws(() => env.db.run("INSERT INTO item_photos (stored_name, mime_type, size_bytes, uploaded_by) VALUES ('0123456789abcdef0123456789abcdef.png', 'image/png', 5, 1)"), /CHECK constraint failed/, 'photo must belong to exactly one report');
    // users with reports cannot be hard-deleted (RESTRICT): deactivate instead
    assert.throws(() => env.db.run('DELETE FROM users WHERE id = ?', alice.id), /FOREIGN KEY constraint failed/);
  });

  test('updated_at trigger maintains timestamps', async () => {
    const r = await env.call('POST', '/api/lost', { token: bob.token, body: env.lostBody({ title: 'Trigger test item' }) });
    env.db.run("UPDATE lost_reports SET updated_at = '2000-01-01T00:00:00.000Z' WHERE id = ?", r.body.id);
    env.db.run("UPDATE lost_reports SET title = 'Trigger test item 2' WHERE id = ?", r.body.id);
    assert.ok(env.db.get('SELECT updated_at u FROM lost_reports WHERE id = ?', r.body.id).u > '2020');
  });

  test('transactions roll back: a failure midway leaves NO partial data (report, history, matches)', async () => {
    const before = { r: env.db.get('SELECT COUNT(*) n FROM lost_reports').n, h: env.db.get('SELECT COUNT(*) n FROM report_status_history').n };
    // sabotage: make the history insert fail after the report insert succeeded
    env.db.exec('CREATE TEMP TRIGGER boom BEFORE INSERT ON report_status_history BEGIN SELECT RAISE(ABORT, \'forced failure\'); END');
    assert.throws(() => createReport(env.db, { id: alice.id, role: 'student' }, 'lost', env.lostBody({ title: 'Should roll back' })), /forced failure/);
    env.db.exec('DROP TRIGGER boom');
    assert.equal(env.db.get('SELECT COUNT(*) n FROM lost_reports').n, before.r);
    assert.equal(env.db.get('SELECT COUNT(*) n FROM report_status_history').n, before.h);
    assert.equal(env.db.depth, 0, 'transaction depth is reset after rollback');
    // nested transactions use savepoints: inner failure rolls back only the inner work
    env.db.tx(() => {
      env.db.run("INSERT INTO categories (name) VALUES ('Outer ok')");
      assert.throws(() => env.db.tx(() => { env.db.run("INSERT INTO categories (name) VALUES ('Inner bad')"); throw new Error('inner'); }), /inner/);
    });
    assert.ok(env.db.get("SELECT 1 x FROM categories WHERE name = 'Outer ok'"));
    assert.equal(env.db.get("SELECT 1 x FROM categories WHERE name = 'Inner bad'"), undefined);
  });

  test('data persists across a server restart (close + reopen the same file)', async () => {
    const r = await env.call('POST', '/api/found', { token: alice.token, body: env.foundBody({ title: 'Persistent wallet' }) });
    env.db.close();
    const reopened = new Db(env.config.databasePath);
    const row = reopened.get('SELECT title, status FROM found_reports WHERE id = ?', r.body.id);
    assert.deepEqual({ ...row }, { title: 'Persistent wallet', status: 'reported' });
    assert.ok(reopened.get('SELECT COUNT(*) n FROM sessions').n > 0, 'sessions persist too');
    reopened.close();
    env.db.raw = new Db(env.config.databasePath).raw; // restore handle for later tests/cleanup
    env.db.cache.clear();
  });

  test('user data isolation: my reports/claims/notifications/matches only include my own rows', async () => {
    const a = await env.call('GET', '/api/my/reports', { token: alice.token });
    const b = await env.call('GET', '/api/my/reports', { token: bob.token });
    assert.ok(a.body.lost.every((x) => env.db.get('SELECT user_id u FROM lost_reports WHERE id = ?', x.id).u === alice.id));
    assert.ok(b.body.lost.every((x) => env.db.get('SELECT user_id u FROM lost_reports WHERE id = ?', x.id).u === bob.id));
    env.db.run("INSERT INTO notifications (user_id, message) VALUES (?, 'only for alice')", alice.id);
    const nb = await env.call('GET', '/api/notifications', { token: bob.token });
    assert.equal(nb.body.items.some((n) => n.message === 'only for alice'), false);
    const nid = env.db.get("SELECT id FROM notifications WHERE message = 'only for alice'").id;
    await env.call('POST', `/api/notifications/${nid}/read`, { token: bob.token });
    assert.equal(env.db.get('SELECT is_read r FROM notifications WHERE id = ?', nid).r, 0, "bob cannot mark alice's notification as read");
  });

  test('separate test database: development DB path is untouched', () => {
    assert.ok(env.config.databasePath.startsWith(os.tmpdir()));
    assert.notEqual(env.config.databasePath, path.resolve('server/data/luna.db'));
  });
});

describe('dashboards and insights use real data (and show zeros when empty)', () => {
  test('empty database -> zero states, no fabricated numbers', async () => {
    const env = createEnv();
    const admin = await env.makeUser('admin');
    const d = dashboardFor(env.db, { id: admin.id, role: 'admin' });
    assert.equal(d.student.lost_reports, 0);
    assert.equal(d.staff.pending_claims, 0);
    assert.equal(d.admin.lost_total, 0);
    assert.equal(d.admin.returned_items, 0);
    assert.equal(d.admin.active_users, 1);
    assert.equal(d.admin.monthly.length, 12);
    assert.ok(d.admin.monthly.every((m) => m.lost === 0 && m.found === 0 && m.returned === 0));
    const ins = insights(env.db);
    assert.equal(ins.return_rate.found_total, 0);
    assert.equal(ins.return_rate.rate_percent, null);
    env.cleanup();
  });

  test('statistics match the underlying rows after real activity', async () => {
    const env = createEnv();
    const a = await env.makeUser('student'); const b = await env.makeUser('student'); const s = await env.makeUser('staff'); const adm = await env.makeUser('admin');
    await env.call('POST', '/api/lost', { token: a.token, body: env.lostBody() });
    await env.call('POST', '/api/lost', { token: a.token, body: env.lostBody({ title: 'Blue umbrella', category_id: env.cat('Other'), description: 'Large blue umbrella with wooden handle' }) });
    const f = await env.call('POST', '/api/found', { token: b.token, body: env.foundBody() });
    await env.call('POST', `/api/found/${f.body.id}/status`, { token: s.token, body: { to: 'stored' } });
    const c = await env.call('POST', `/api/found/${f.body.id}/claims`, { token: a.token, body: { explanation: 'It has a cracked corner and a cat sticker' } });
    const sd = await env.call('GET', '/api/dashboard', { token: a.token });
    assert.equal(sd.body.student.lost_reports, 2);
    assert.equal(sd.body.student.active_claims, 1);
    assert.equal(sd.body.student.potential_matches, 1);
    const st = await env.call('GET', '/api/dashboard', { token: s.token });
    assert.equal(st.body.staff.pending_claims, 1);
    assert.equal(st.body.staff.unreviewed_claims, 1);
    for (const action of [{ action: 'start_review' }, { action: 'approve' }, { action: 'handover' }]) await env.call('POST', `/api/claims/${c.body.id}/action`, { token: s.token, body: action });
    const ad = await env.call('GET', '/api/dashboard', { token: adm.token });
    assert.equal(ad.body.admin.returned_items, 1);
    assert.equal(ad.body.admin.lost_total, 2);
    assert.equal(ad.body.admin.found_total, 1);
    assert.equal(ad.body.admin.open_claims, 0);
    const thisMonth = ad.body.admin.monthly.at(-1);
    assert.deepEqual([thisMonth.lost, thisMonth.found, thisMonth.returned], [2, 1, 1]);
    const ins = (await env.call('GET', '/api/admin/insights', { token: adm.token })).body;
    assert.equal(ins.return_rate.rate_percent, 100);
    assert.equal(ins.by_category_status.reduce((n, r) => n + r.n, 0), 3);
    assert.equal(ins.top_categories[0].reports >= 1, true);
    env.cleanup();
  });

  test('overdue queries find old unresolved items', async () => {
    const env = createEnv();
    const a = await env.makeUser('student'); const adm = await env.makeUser('admin');
    const f = await env.call('POST', '/api/found', { token: a.token, body: env.foundBody() });
    env.db.run("UPDATE found_reports SET created_at = strftime('%Y-%m-%dT%H:%M:%fZ','now','-10 days') WHERE id = ?", f.body.id);
    const ins = (await env.call('GET', '/api/admin/insights', { token: adm.token })).body;
    assert.equal(ins.overdue.found_unprocessed.length, 1);
    env.cleanup();
  });

  test('admin catalogue management: add, rename, deactivate categories/locations; inactive ones cannot be used', async () => {
    const env = createEnv();
    const a = await env.makeUser('student'); const adm = await env.makeUser('admin');
    const created = await env.call('POST', '/api/admin/categories', { token: adm.token, body: { name: 'Musical Instruments' } });
    assert.equal(created.status, 201);
    assert.equal((await env.call('POST', '/api/admin/categories', { token: adm.token, body: { name: 'musical instruments' } })).status, 409);
    assert.equal((await env.call('POST', '/api/admin/categories', { token: a.token, body: { name: 'Nope nope' } })).status, 403);
    const loc = await env.call('POST', '/api/admin/locations', { token: adm.token, body: { name: 'New Annex', zone: 'central' } });
    assert.equal(loc.status, 201);
    await env.call('PATCH', `/api/admin/categories/${created.body.id}`, { token: adm.token, body: { is_active: false } });
    const meta = await env.call('GET', '/api/meta');
    assert.equal(meta.body.categories.some((c) => c.name === 'Musical Instruments'), false);
    const res = await env.call('POST', '/api/lost', { token: a.token, body: env.lostBody({ category_id: created.body.id }) });
    assert.equal(res.status, 422);
    assert.ok(env.db.get("SELECT 1 x FROM audit_logs WHERE action = 'categories.create'"));
    env.cleanup();
  });
});

test('migrate:status on a fresh database is read-only and does not break a later migrate', async () => {
  const { Db } = await import('../src/lib/db.js');
  const { migrate, migrationStatus } = await import('../src/db/migrate.js');
  const os = await import('node:os'); const fs = await import('node:fs'); const path = await import('node:path');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'luna-mig-'));
  const db = new Db(path.join(dir, 't.db'));
  try {
    assert.ok(migrationStatus(db).every((m) => !m.applied));
    assert.equal(db.get("SELECT 1 x FROM sqlite_master WHERE name='schema_migrations'"), undefined);
    assert.ok(migrate(db).length >= 3);
    assert.ok(migrationStatus(db).every((m) => m.applied));
    assert.deepEqual(migrate(db), []);
  } finally { db.close(); fs.rmSync(dir, { recursive: true, force: true }); }
});
