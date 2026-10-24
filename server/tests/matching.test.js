import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createEnv } from './helpers.js';
import { scorePair, tokenize, MIN_SCORE } from '../src/services/matching.js';

const side = (o = {}) => ({ title: 'Black wallet', description: 'Leather wallet with cards', category_id: 1, category_name: 'Wallets & Cards', location_id: 1, location_name: 'Library', zone: 'core', date: '2026-05-10', ...o });

describe('match scoring (pure function)', () => {
  test('perfect-ish pair scores high with transparent reasons', () => {
    const r = scorePair(side(), side({ title: 'Black leather wallet', date: '2026-05-11' }));
    assert.equal(r.compatible, true);
    assert.ok(r.score >= 90);
    assert.ok(r.reasons.some((x) => x.startsWith('Same category')));
    assert.ok(r.reasons.some((x) => x.startsWith('Shared keywords')));
    assert.ok(r.reasons.some((x) => x.startsWith('Same location')));
    assert.ok(r.reasons.some((x) => x.startsWith('Matching colour')));
  });
  test('found before last seen is incompatible', () => {
    const r = scorePair(side({ date: '2026-05-10' }), side({ date: '2026-05-09' }));
    assert.equal(r.compatible, false);
  });
  test('more than 30 days apart is incompatible', () => {
    assert.equal(scorePair(side({ date: '2026-01-01' }), side({ date: '2026-03-01' })).compatible, false);
  });
  test('nearby zone gives partial location credit; different everything scores below threshold', () => {
    const near = scorePair(side(), side({ location_id: 2, location_name: 'Annex' }));
    assert.ok(near.reasons.some((x) => x.startsWith('Nearby location')));
    const far = scorePair(side(), side({ title: 'Umbrella', description: 'folding umbrella', category_id: 9, location_id: 3, zone: 'sports', date: '2026-05-25' }));
    assert.ok(far.score < MIN_SCORE);
  });
  test('tokenize drops stopwords, short words and colours; matching is case-insensitive', () => {
    assert.deepEqual(tokenize('The BLACK Wallet near the Library!'), ['wallet', 'library']);
  });
  test('score never exceeds 100', () => {
    assert.ok(scorePair(side(), side()).score <= 100);
  });
});

describe('match suggestions (database)', () => {
  let env, alice, bob, staff;
  before(async () => { env = createEnv(); alice = await env.makeUser('student', 'Alice'); bob = await env.makeUser('student', 'Bob'); staff = await env.makeUser('staff', 'Stella'); });
  after(() => env.cleanup());

  test('a found report creates suggestions for compatible lost reports and notifies the owner', async () => {
    await env.call('POST', '/api/lost', { token: alice.token, body: env.lostBody({ title: 'Silver laptop', category_id: env.cat(), description: 'Silver laptop with stickers on lid', last_seen_date: env.today() }) });
    await env.call('POST', '/api/found', { token: bob.token, body: env.foundBody({ title: 'Silver laptop found', description: 'Silver laptop with stickers on the lid' }) });
    const m = await env.call('GET', '/api/matches', { token: alice.token });
    assert.equal(m.body.total, 1);
    assert.ok(m.body.items[0].score >= MIN_SCORE);
    assert.ok(m.body.items[0].reasons.length >= 2);
    assert.match(m.body.items[0].note, /not confirmed/i);
    const n = await env.call('GET', '/api/notifications', { token: alice.token });
    assert.ok(n.body.items.some((x) => /possible match/i.test(x.message)));
  });

  test('match listing never leaks private details', async () => {
    const m = await env.call('GET', '/api/matches', { token: alice.token });
    const text = JSON.stringify(m.body);
    assert.equal(text.includes('beach'), false);          // found private details
    assert.equal(text.includes('Lock screen'), false);
  });

  test('no duplicate suggestions when reports are edited or refreshed', async () => {
    const lost = env.db.get('SELECT id FROM lost_reports LIMIT 1');
    await env.call('PATCH', `/api/lost/${lost.id}`, { token: alice.token, body: { description: 'Silver laptop with many stickers on the lid' } });
    await env.call('POST', `/api/lost/${lost.id}/refresh-matches`, { token: alice.token });
    await env.call('POST', `/api/lost/${lost.id}/refresh-matches`, { token: alice.token });
    assert.equal(env.db.get('SELECT COUNT(*) n FROM match_suggestions').n, 1);
  });

  test('own found items and closed/hidden/incompatible reports are excluded', async () => {
    const e2 = createEnv();
    const a = await e2.makeUser(); const b = await e2.makeUser();
    await e2.call('POST', '/api/lost', { token: a.token, body: e2.lostBody() });
    await e2.call('POST', '/api/found', { token: a.token, body: e2.foundBody() });           // same person: excluded
    assert.equal(e2.db.get('SELECT COUNT(*) n FROM match_suggestions').n, 0);
    const old = await e2.call('POST', '/api/found', { token: b.token, body: e2.foundBody({ found_date: '2020-01-01' }) });  // before last seen: excluded
    assert.equal(e2.db.get('SELECT COUNT(*) n FROM match_suggestions').n, 0);
    const ok = await e2.call('POST', '/api/found', { token: b.token, body: e2.foundBody() });
    assert.equal(e2.db.get('SELECT COUNT(*) n FROM match_suggestions').n, 1);
    // owner withdraws the lost report: stale suggestion disappears
    const lostId = e2.db.get('SELECT id FROM lost_reports').id;
    await e2.call('POST', `/api/lost/${lostId}/status`, { token: a.token, body: { to: 'withdrawn' } });
    assert.equal(e2.db.get('SELECT COUNT(*) n FROM match_suggestions').n, 0);
    void old; void ok;
    e2.cleanup();
  });

  test('review outcomes: owner can review/dismiss, only staff can confirm, invalid transitions rejected, outcomes persist', async () => {
    const e2 = createEnv();
    const a = await e2.makeUser(); const b = await e2.makeUser(); const s = await e2.makeUser('staff'); const stranger = await e2.makeUser();
    await e2.call('POST', '/api/lost', { token: a.token, body: e2.lostBody() });
    await e2.call('POST', '/api/found', { token: b.token, body: e2.foundBody() });
    const id = e2.db.get('SELECT id FROM match_suggestions').id;
    assert.equal((await e2.call('POST', `/api/matches/${id}/review`, { token: stranger.token, body: { action: 'reviewed' } })).status, 404);
    assert.equal((await e2.call('POST', `/api/matches/${id}/review`, { token: a.token, body: { action: 'confirmed' } })).status, 403);
    assert.equal((await e2.call('POST', `/api/matches/${id}/review`, { token: a.token, body: { action: 'reviewed' } })).status, 200);
    assert.equal((await e2.call('POST', `/api/matches/${id}/review`, { token: a.token, body: { action: 'reviewed' } })).status, 409);
    assert.equal((await e2.call('POST', `/api/matches/${id}/review`, { token: s.token, body: { action: 'confirmed' } })).status, 200);
    assert.equal((await e2.call('POST', `/api/matches/${id}/review`, { token: a.token, body: { action: 'dismissed' } })).status, 409, 'confirmed is final');
    assert.equal(e2.db.get('SELECT status FROM match_suggestions WHERE id = ?', id).status, 'confirmed');
    // a refresh must not resurrect or overwrite a decided suggestion
    const lostId = e2.db.get('SELECT id FROM lost_reports').id;
    await e2.call('POST', `/api/lost/${lostId}/refresh-matches`, { token: a.token });
    assert.equal(e2.db.get('SELECT status FROM match_suggestions WHERE id = ?', id).status, 'confirmed');
    // confirming a match does NOT create or approve any claim
    assert.equal(e2.db.get('SELECT COUNT(*) n FROM claims').n, 0);
    e2.cleanup();
  });

  test('dismissed suggestions stay dismissed after report edits', async () => {
    const e2 = createEnv();
    const a = await e2.makeUser(); const b = await e2.makeUser();
    await e2.call('POST', '/api/lost', { token: a.token, body: e2.lostBody() });
    await e2.call('POST', '/api/found', { token: b.token, body: e2.foundBody() });
    const id = e2.db.get('SELECT id FROM match_suggestions').id;
    await e2.call('POST', `/api/matches/${id}/review`, { token: a.token, body: { action: 'dismissed' } });
    const lostId = e2.db.get('SELECT id FROM lost_reports').id;
    await e2.call('PATCH', `/api/lost/${lostId}`, { token: a.token, body: { title: 'Black iPhone 13 (edited)' } });
    assert.equal(e2.db.get('SELECT status FROM match_suggestions WHERE id = ?', id).status, 'dismissed');
    assert.equal(e2.db.get('SELECT COUNT(*) n FROM match_suggestions').n, 1);
    assert.equal((await e2.call('GET', '/api/matches', { token: a.token })).body.total, 0, 'dismissed hidden by default');
    e2.cleanup();
  });
});
