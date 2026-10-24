import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createEnv } from './helpers.js';
import { detectImage } from '../src/services/photos.js';

describe('reports', () => {
  let env, alice, bob, staff, admin;
  before(async () => {
    env = createEnv();
    alice = await env.makeUser('student', 'Alice');
    bob = await env.makeUser('student', 'Bob');
    staff = await env.makeUser('staff', 'Stella');
    admin = await env.makeUser('admin', 'Adam');
  });
  after(() => env.cleanup());

  test('creates a lost report with history and returns private fields only to the owner', async () => {
    const res = await env.call('POST', '/api/lost', { token: alice.token, body: env.lostBody() });
    assert.equal(res.status, 201);
    assert.equal(res.body.status, 'open');
    assert.equal(res.body.history.length, 1);
    assert.ok(res.body.private.distinguishing_details.includes('cat'));
    const asBob = await env.call('GET', `/api/lost/${res.body.id}`, { token: bob.token });
    assert.equal(asBob.status, 200);
    assert.equal(asBob.body.private, undefined, 'other students must not see distinguishing details');
    assert.equal(asBob.body.history, undefined);
    assert.equal(asBob.body.reporter, undefined, 'reporter identity is staff-only');
    const asStaff = await env.call('GET', `/api/lost/${res.body.id}`, { token: staff.token });
    assert.ok(asStaff.body.private && asStaff.body.reporter.email);
  });

  test('validation: bad/future dates, short text, unknown category/location, malformed data', async () => {
    const t = alice.token;
    const bad = async (o) => (await env.call('POST', '/api/lost', { token: t, body: env.lostBody(o) }));
    assert.equal((await bad({ last_seen_date: '2999-01-01' })).status, 422);
    assert.equal((await bad({ last_seen_date: '2026-02-31' })).status, 422);
    assert.equal((await bad({ last_seen_date: 'yesterday' })).status, 422);
    assert.equal((await bad({ title: 'ab' })).status, 422);
    assert.equal((await bad({ description: 'short' })).status, 422);
    assert.equal((await bad({ category_id: 9999 })).status, 422);
    assert.equal((await bad({ location_id: 'abc' })).status, 422);
    assert.equal((await bad({ contact_preference: 'pigeon' })).status, 422);
    assert.equal((await bad({ title: 'bad\u0000title' })).status, 422);
    const res = await bad({ last_seen_date: '2026-02-31' });
    assert.ok(res.body.error.fields.last_seen_date);
    assert.equal((await env.call('POST', '/api/lost', { token: t, body: [] })).status, 400);
  });

  test('ownership: only the owner can edit; others get 404 (existence not revealed)', async () => {
    const r = await env.call('POST', '/api/lost', { token: alice.token, body: env.lostBody({ title: 'Blue umbrella' }) });
    const id = r.body.id;
    const hacked = await env.call('PATCH', `/api/lost/${id}`, { token: bob.token, body: { title: 'Hacked title' } });
    assert.equal(hacked.status, 404);
    const mine = await env.call('PATCH', `/api/lost/${id}`, { token: alice.token, body: { title: 'Navy umbrella' } });
    assert.equal(mine.status, 200);
    assert.equal(mine.body.title, 'Navy umbrella');
    assert.equal((await env.call('PATCH', `/api/lost/${id}`, { token: alice.token, body: {} })).status, 400);
    assert.equal((await env.call('PATCH', `/api/lost/${id}`, { token: alice.token, body: { last_seen_date: '2999-01-01' } })).status, 422);
    assert.equal((await env.call('POST', `/api/lost/${id}/status`, { token: bob.token, body: { to: 'withdrawn' } })).status, 404);
  });

  test('lost status machine: allowed and rejected transitions, with history', async () => {
    const r = await env.call('POST', '/api/lost', { token: alice.token, body: env.lostBody({ title: 'Green notebook' }) });
    const id = r.body.id;
    const w = await env.call('POST', `/api/lost/${id}/status`, { token: alice.token, body: { to: 'withdrawn', note: 'found it' } });
    assert.equal(w.body.status, 'withdrawn');
    assert.equal((await env.call('POST', `/api/lost/${id}/status`, { token: alice.token, body: { to: 'resolved' } })).status, 409);
    assert.equal((await env.call('POST', `/api/lost/${id}/status`, { token: alice.token, body: { to: 'nonsense' } })).status, 409);
    const reopened = await env.call('POST', `/api/lost/${id}/status`, { token: alice.token, body: { to: 'open' } });
    assert.equal(reopened.body.status, 'open');
    await env.call('POST', `/api/lost/${id}/status`, { token: alice.token, body: { to: 'resolved' } });
    assert.equal((await env.call('POST', `/api/lost/${id}/status`, { token: alice.token, body: { to: 'open' } })).status, 409, 'resolved is terminal');
    const detail = await env.call('GET', `/api/lost/${id}`, { token: alice.token });
    assert.deepEqual(detail.body.history.map((h) => h.to_status), ['open', 'withdrawn', 'open', 'resolved']);
    assert.equal((await env.call('PATCH', `/api/lost/${id}`, { token: alice.token, body: { title: 'Cannot edit closed' } })).status, 403);
  });

  test('found status machine: invalid transitions rejected; claim_pending/returned cannot be set by hand', async () => {
    const f = await env.call('POST', '/api/found', { token: bob.token, body: env.foundBody({ title: 'Silver keys' }) });
    const id = f.body.id;
    assert.equal(f.body.status, 'reported');
    // finder (student) may only retract
    assert.equal((await env.call('POST', `/api/found/${id}/status`, { token: bob.token, body: { to: 'stored' } })).status, 403);
    const s = await env.call('POST', `/api/found/${id}/status`, { token: staff.token, body: { to: 'stored' } });
    assert.equal(s.body.status, 'stored');
    assert.equal((await env.call('POST', `/api/found/${id}/status`, { token: staff.token, body: { to: 'returned' } })).status, 409);
    assert.equal((await env.call('POST', `/api/found/${id}/status`, { token: staff.token, body: { to: 'claim_pending' } })).status, 403);
    assert.equal((await env.call('POST', `/api/found/${id}/status`, { token: staff.token, body: { to: 'reported' } })).status, 409);
    await env.call('POST', `/api/found/${id}/status`, { token: staff.token, body: { to: 'archived' } });
    assert.equal((await env.call('POST', `/api/found/${id}/status`, { token: staff.token, body: { to: 'stored' } })).status, 409, 'archived is terminal');
  });

  test('found report private details are hidden from other students but visible to the finder and staff', async () => {
    const f = await env.call('POST', '/api/found', { token: bob.token, body: env.foundBody({ title: 'Brown wallet', distinguishing_details: 'Contains photo of a dog named Rex' }) });
    const id = f.body.id;
    const asAlice = await env.call('GET', `/api/found/${id}`, { token: alice.token });
    assert.equal(asAlice.body.private, undefined);
    assert.equal(JSON.stringify(asAlice.body).includes('Rex'), false);
    assert.ok((await env.call('GET', `/api/found/${id}`, { token: bob.token })).body.private);
    assert.ok((await env.call('GET', `/api/found/${id}`, { token: staff.token })).body.private);
    assert.equal(JSON.stringify((await env.call('GET', '/api/reports', { token: alice.token, query: { q: 'wallet' } })).body).includes('Rex'), false, 'private details never appear in search results');
  });

  test('search: keyword, type, category, location, date range, status, sort, pagination', async () => {
    const e2 = createEnv();
    const u = await e2.makeUser('student');
    const mk = (type, o) => e2.call('POST', `/api/${type}`, { token: u.token, body: type === 'lost' ? e2.lostBody(o) : e2.foundBody(o) });
    await mk('lost', { title: 'Red backpack', category_id: e2.cat('Bags & Backpacks'), location_id: e2.loc('Cafeteria'), last_seen_date: '2026-01-10', description: 'Red backpack with laptop sleeve' });
    await mk('lost', { title: 'Blue water bottle', category_id: e2.cat('Water Bottles'), location_id: e2.loc('Sports Complex'), last_seen_date: '2026-02-20', description: 'Steel blue bottle with dents' });
    await mk('found', { title: 'Calculus textbook', category_id: e2.cat('Books & Stationery'), location_id: e2.loc('Main Library'), found_date: '2026-03-05', description: 'Calculus textbook with highlighted pages' });
    const q = async (query) => (await e2.call('GET', '/api/reports', { token: u.token, query })).body;
    assert.equal((await q({})).total, 3);
    assert.equal((await q({ type: 'lost' })).total, 2);
    assert.equal((await q({ type: 'found' })).total, 1);
    assert.deepEqual((await q({ q: 'backpack' })).items.map((i) => i.title), ['Red backpack']);
    assert.equal((await q({ q: 'red laptop' })).total, 1, 'all words must match');
    assert.equal((await q({ q: 'red bottle' })).total, 0);
    assert.equal((await q({ category_id: e2.cat('Water Bottles') })).total, 1);
    assert.equal((await q({ location_id: e2.loc('Main Library') })).total, 1);
    assert.equal((await q({ date_from: '2026-02-01', date_to: '2026-03-31' })).total, 2);
    assert.equal((await q({ status: 'reported' })).total, 1);
    assert.deepEqual((await q({ sort: 'title' })).items.map((i) => i.title), ['Blue water bottle', 'Calculus textbook', 'Red backpack']);
    assert.deepEqual((await q({ sort: 'event_oldest' })).items.map((i) => i.title)[0], 'Red backpack');
    const p = await q({ page_size: 2, page: 2 });
    assert.equal(p.items.length, 1); assert.equal(p.total_pages, 2);
    assert.equal((await q({ q: '%' })).total, 0, 'LIKE wildcards are escaped');
    assert.equal((await q({ q: "x' OR 1=1 --" })).total, 0, 'SQL injection text is just text');
    assert.equal((await e2.call('GET', '/api/reports', { token: u.token, query: { sort: 'id; DROP TABLE users' } })).status, 422);
    assert.equal((await e2.call('GET', '/api/reports', { token: u.token, query: { date_from: '2026-05-01', date_to: '2026-01-01' } })).status, 422);
    assert.equal((await q({})).items[0].is_mine, true);
    e2.cleanup();
  });

  test('empty search returns zero results (empty state data), not an error', async () => {
    const e2 = createEnv();
    const u = await e2.makeUser();
    const res = await e2.call('GET', '/api/reports', { token: u.token, query: { q: 'anything' } });
    assert.equal(res.status, 200);
    assert.deepEqual([res.body.total, res.body.items.length, res.body.total_pages], [0, 0, 1]);
    e2.cleanup();
  });

  test('flagging and admin moderation hide reports from everyone except owner/staff', async () => {
    const r = await env.call('POST', '/api/lost', { token: alice.token, body: env.lostBody({ title: 'Spam report here' }) });
    const id = r.body.id;
    assert.equal((await env.call('POST', `/api/lost/${id}/flag`, { token: alice.token, body: { reason: 'no' } })).status, 422);
    assert.equal((await env.call('POST', `/api/lost/${id}/flag`, { token: alice.token, body: { reason: 'my own report' } })).status, 409);
    assert.equal((await env.call('POST', `/api/lost/${id}/flag`, { token: bob.token, body: { reason: 'looks like spam' } })).status, 201);
    assert.equal((await env.call('POST', `/api/lost/${id}/flag`, { token: bob.token, body: { reason: 'looks like spam' } })).status, 409);
    assert.equal((await env.call('POST', `/api/admin/reports/lost/${id}/moderation`, { token: staff.token, body: { hidden: true, reason: 'spam' } })).status, 403);
    assert.equal((await env.call('POST', `/api/admin/reports/lost/${id}/moderation`, { token: admin.token, body: { hidden: true } })).status, 422);
    assert.equal((await env.call('POST', `/api/admin/reports/lost/${id}/moderation`, { token: admin.token, body: { hidden: true, reason: 'spam' } })).status, 200);
    assert.equal((await env.call('GET', `/api/lost/${id}`, { token: bob.token })).status, 404);
    assert.equal((await env.call('GET', `/api/lost/${id}`, { token: alice.token })).status, 200);
    assert.equal((await env.call('GET', '/api/reports', { token: bob.token, query: { q: 'Spam report' } })).body.total, 0);
    assert.equal((await env.call('GET', '/api/admin/moderation', { token: admin.token, query: { q: 'Spam report' } })).body.reports.total, 1);
    assert.ok(env.db.get("SELECT 1 x FROM audit_logs WHERE action = 'report.hide'"));
    await env.call('POST', `/api/admin/reports/lost/${id}/moderation`, { token: admin.token, body: { hidden: false } });
    assert.equal((await env.call('GET', `/api/lost/${id}`, { token: bob.token })).status, 200);
  });

  test('photo upload: validates magic bytes and size, random names, owner-only, hidden-report photos protected', async () => {
    const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64)]);
    const r = await env.call('POST', '/api/lost', { token: alice.token, body: env.lostBody({ title: 'Photo test item' }) });
    const id = r.body.id;
    assert.equal((await env.call('POST', `/api/lost/${id}/photo`, { token: alice.token, file: Buffer.from('<?php echo 1; ?> not an image at all') })).status, 415);
    assert.equal((await env.call('POST', `/api/lost/${id}/photo`, { token: alice.token, file: Buffer.concat([Buffer.from('MZ'), Buffer.alloc(40)]) })).status, 415, 'executables rejected');
    assert.equal((await env.call('POST', `/api/lost/${id}/photo`, { token: alice.token })).status, 400);
    assert.equal((await env.call('POST', `/api/lost/${id}/photo`, { token: bob.token, file: png })).status, 404);
    const big = Buffer.concat([png, Buffer.alloc(env.config.maxUploadBytes)]);
    assert.equal((await env.call('POST', `/api/lost/${id}/photo`, { token: alice.token, file: big })).status, 413);
    const ok = await env.call('POST', `/api/lost/${id}/photo`, { token: alice.token, file: png });
    assert.equal(ok.status, 201);
    assert.match(ok.body.photo_url, /^\/uploads\/[0-9a-f]{32}\.png$/);
    const name = ok.body.photo_url.split('/').pop();
    const served = await env.call('GET', `/uploads/${name}`, { token: bob.token });
    assert.equal(served.body.__binary.mime, 'image/png');
    assert.equal((await env.call('GET', `/uploads/${name}`)).status, 401);
    assert.equal((await env.call('GET', '/uploads/..%2F..%2Fetc%2Fpasswd', { token: bob.token })).status, 404);
    // replacing removes the old file
    const second = await env.call('POST', `/api/lost/${id}/photo`, { token: alice.token, file: png });
    assert.notEqual(second.body.photo_url, ok.body.photo_url);
    assert.equal(env.db.get('SELECT COUNT(*) n FROM item_photos WHERE lost_report_id = ?', id).n, 1);
    await assert.rejects(() => env.storage.read(name));
    // hidden report photo
    const newName = second.body.photo_url.split('/').pop();
    await env.call('POST', `/api/admin/reports/lost/${id}/moderation`, { token: admin.token, body: { hidden: true, reason: 'test' } });
    assert.equal((await env.call('GET', `/uploads/${newName}`, { token: bob.token })).status, 404);
    assert.equal((await env.call('GET', `/uploads/${newName}`, { token: alice.token })).status, 200);
  });

  test('detectImage recognises jpeg/png/webp only', () => {
    assert.equal(detectImage(Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(20)])).mime, 'image/jpeg');
    assert.equal(detectImage(Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WEBP'), Buffer.alloc(8)])).mime, 'image/webp');
    assert.equal(detectImage(Buffer.from('GIF89a......')), null);
    assert.equal(detectImage(Buffer.alloc(3)), null);
  });
});
