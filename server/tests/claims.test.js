import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createEnv } from './helpers.js';

const here = path.dirname(fileURLToPath(import.meta.url));

describe('claims and returns', () => {
  let env, finder, owner, rival, staff, staff2, admin, foundId;
  const act = (token, id, body) => env.call('POST', `/api/claims/${id}/action`, { token, body });
  const claim = async (token, id = foundId, explanation = 'It has a cat sticker and a cracked corner') =>
    env.call('POST', `/api/found/${id}/claims`, { token, body: { explanation } });
  const fresh = async () => {
    const f = await env.call('POST', '/api/found', { token: finder.token, body: env.foundBody() });
    await env.call('POST', `/api/found/${f.body.id}/status`, { token: staff.token, body: { to: 'stored' } });
    return f.body.id;
  };

  before(async () => {
    env = createEnv();
    finder = await env.makeUser('student', 'Finder'); owner = await env.makeUser('student', 'Owner'); rival = await env.makeUser('student', 'Rival');
    staff = await env.makeUser('staff', 'Stella'); staff2 = await env.makeUser('staff', 'Sven'); admin = await env.makeUser('admin', 'Adam');
    foundId = await fresh();
  });
  after(() => env.cleanup());

  test('submitting a claim: validation, rules, status history and found item becomes claim_pending', async () => {
    assert.equal((await claim(owner.token, foundId, 'short')).status, 422);
    assert.equal((await claim(finder.token)).status, 409, 'finder cannot claim own item');
    const res = await claim(owner.token);
    assert.equal(res.status, 201);
    assert.equal(res.body.status, 'submitted');
    assert.deepEqual(res.body.allowed_actions, ['withdraw']);
    assert.equal(env.db.get('SELECT status FROM found_reports WHERE id = ?', foundId).status, 'claim_pending');
    assert.equal((await claim(owner.token)).status, 409, 'one live claim per claimant');
    assert.equal((await claim(owner.token, 999999)).status, 404);
  });

  test('claimant explanation is private: unrelated users, the finder and other claimants get 404', async () => {
    const id = env.db.get('SELECT id FROM claims').id;
    for (const u of [finder, rival]) assert.equal((await env.call('GET', `/api/claims/${id}`, { token: u.token })).status, 404);
    assert.equal((await env.call('GET', `/api/claims/${id}`, { token: owner.token })).status, 200);
    const s = await env.call('GET', `/api/claims/${id}`, { token: staff.token });
    assert.ok(s.body.explanation.includes('cat sticker'));
    assert.ok(s.body.found_private_details, 'staff can compare with the finder private details');
    assert.equal((await env.call('POST', `/api/claims/${id}/action`, { token: rival.token, body: { action: 'withdraw' } })).status, 404);
    // the public found report never shows claims or explanations
    const pub = await env.call('GET', `/api/found/${foundId}`, { token: rival.token });
    assert.equal(JSON.stringify(pub.body).includes('cat sticker'), false);
    // lists are scoped
    assert.equal((await env.call('GET', '/api/claims', { token: rival.token })).body.total, 0);
    assert.equal((await env.call('GET', '/api/claims', { token: owner.token })).body.total, 1);
    assert.equal((await env.call('GET', '/api/claims', { token: staff.token })).body.total, 1);
  });

  test('students cannot perform staff actions; invalid transitions are rejected', async () => {
    const id = env.db.get('SELECT id FROM claims').id;
    assert.equal((await act(owner.token, id, { action: 'approve' })).status, 403);
    assert.equal((await act(owner.token, id, { action: 'start_review' })).status, 403);
    assert.equal((await act(staff.token, id, { action: 'approve' })).status, 409, 'cannot approve before review');
    assert.equal((await act(staff.token, id, { action: 'handover' })).status, 409, 'cannot hand over before approval');
    assert.equal((await act(staff.token, id, { action: 'respond', message: 'hello there' })).status, 403, 'only claimant responds');
    assert.equal((await act(staff.token, id, { action: 'explode' })).status, 422);
  });

  test('request info -> claimant responds -> review continues', async () => {
    const id = env.db.get('SELECT id FROM claims').id;
    assert.equal((await act(staff.token, id, { action: 'start_review' })).body.status, 'under_review');
    assert.equal((await act(staff.token, id, { action: 'request_info' })).status, 422, 'message required');
    const r = await act(staff.token, id, { action: 'request_info', message: 'What is on the lock screen?' });
    assert.equal(r.body.status, 'info_requested');
    const claimantView = await env.call('GET', `/api/claims/${id}`, { token: owner.token });
    assert.ok(claimantView.body.allowed_actions.includes('respond'));
    assert.equal(claimantView.body.verification_request, 'What is on the lock screen?');
    assert.deepEqual(r.body.allowed_actions, ['reject'], 'staff view: cannot act until the claimant responds');
    const resp = await act(owner.token, id, { action: 'respond', message: 'A photo of a beach' });
    assert.equal(resp.body.status, 'under_review');
    assert.equal(resp.body.verification_response, 'A photo of a beach');
  });

  test('rejection requires a recorded reason; rejecting the only claim releases the item back to stored', async () => {
    const id2 = await fresh();
    const c = await claim(rival.token, id2, 'I think this is mine, it is black');
    await act(staff.token, c.body.id, { action: 'start_review' });
    assert.equal((await act(staff.token, c.body.id, { action: 'reject' })).status, 422);
    const rej = await act(staff.token, c.body.id, { action: 'reject', reason: 'Could not describe contents' });
    assert.equal(rej.body.status, 'rejected');
    assert.equal(rej.body.decision_reason, 'Could not describe contents');
    assert.equal(env.db.get('SELECT status FROM found_reports WHERE id = ?', id2).status, 'stored');
    assert.equal((await act(staff.token, c.body.id, { action: 'approve' })).status, 409, 'rejected is terminal');
    // can claim again after rejection
    assert.equal((await claim(rival.token, id2)).status, 201);
  });

  test('withdraw by claimant works and releases the item; others cannot withdraw', async () => {
    const id2 = await fresh();
    const c = await claim(rival.token, id2);
    const w = await act(rival.token, c.body.id, { action: 'withdraw' });
    assert.equal(w.body.status, 'withdrawn');
    assert.equal(env.db.get('SELECT status FROM found_reports WHERE id = ?', id2).status, 'stored');
  });

  test('conflicting claims: only ONE can be approved; the second approval is rejected with 409', async () => {
    const id2 = await fresh();
    const a = (await claim(owner.token, id2)).body.id;
    const b = (await claim(rival.token, id2, 'Looks like my phone, black case')).body.id;
    await act(staff.token, a, { action: 'start_review' });
    await act(staff.token, b, { action: 'start_review' });
    const first = await act(staff.token, a, { action: 'approve', reason: 'Verified lock screen' });
    assert.equal(first.status, 200);
    const second = await act(staff2.token, b, { action: 'approve' });
    assert.equal(second.status, 409);
    assert.equal(env.db.get("SELECT COUNT(*) n FROM claims WHERE found_report_id = ? AND status = 'approved'", id2).n, 1);
  });

  test('simultaneous approvals (Promise.all) produce exactly one winner', async () => {
    const id2 = await fresh();
    const a = (await claim(owner.token, id2)).body.id;
    const b = (await claim(rival.token, id2, 'Looks like my phone, black case')).body.id;
    await act(staff.token, a, { action: 'start_review' });
    await act(staff.token, b, { action: 'start_review' });
    const results = await Promise.all([act(staff.token, a, { action: 'approve' }), act(staff2.token, b, { action: 'approve' })]);
    assert.deepEqual(results.map((r) => r.status).sort(), [200, 409]);
    assert.equal(env.db.get("SELECT COUNT(*) n FROM claims WHERE found_report_id = ? AND status IN ('approved','completed')", id2).n, 1);
  });

  test('DATABASE backstop: raw SQL cannot create two winners even if application logic is bypassed', async () => {
    const id2 = await fresh();
    const a = (await claim(owner.token, id2)).body.id;
    const b = (await claim(rival.token, id2, 'Looks like my phone, black case')).body.id;
    env.db.run("UPDATE claims SET status = 'approved' WHERE id = ?", a);
    assert.throws(() => env.db.run("UPDATE claims SET status = 'approved' WHERE id = ?", b), /UNIQUE constraint failed/);
  });

  test('REAL concurrency: two separate processes approve different claims at the same moment', async () => {
    const id2 = await fresh();
    const a = (await claim(owner.token, id2)).body.id;
    const b = (await claim(rival.token, id2, 'Looks like my phone, black case')).body.id;
    await act(staff.token, a, { action: 'start_review' });
    await act(staff.token, b, { action: 'start_review' });
    const run = (claimId, userId) => new Promise((resolve) => {
      execFile(process.execPath, ['--no-warnings', path.join(here, 'concurrency-worker.js'), env.config.databasePath, String(claimId), String(userId)], (err, stdout, stderr) => resolve({ err, out: stdout.trim(), stderr }));
    });
    const [r1, r2] = await Promise.all([run(a, staff.id), run(b, staff2.id)]);
    const codes = [r1.out, r2.out].sort();
    assert.deepEqual(codes, ['200', '409'], `unexpected worker output: ${JSON.stringify([r1, r2])}`);
    assert.equal(env.db.get("SELECT COUNT(*) n FROM claims WHERE found_report_id = ? AND status = 'approved'", id2).n, 1);
  });

  test('handover: records the return once, completes the claim, returns the item, closes competing claims, resolves linked lost report', async () => {
    const id2 = await fresh();
    const lost = await env.call('POST', '/api/lost', { token: owner.token, body: env.lostBody() });
    const a = await env.call('POST', `/api/found/${id2}/claims`, { token: owner.token, body: { explanation: 'It is my black iPhone with a cat sticker', lost_report_id: lost.body.id } });
    const b = (await claim(rival.token, id2, 'Looks like my phone, black case')).body.id;
    await act(staff.token, a.body.id, { action: 'start_review' });
    await act(staff.token, a.body.id, { action: 'approve', reason: 'Verified' });
    assert.equal((await act(owner.token, a.body.id, { action: 'handover' })).status, 403);
    const done = await act(staff.token, a.body.id, { action: 'handover', recipient_name: 'Owner Person', notes: 'ID checked' });
    assert.equal(done.status, 200);
    assert.equal(done.body.status, 'completed');
    assert.equal(done.body.handover.recipient_name, 'Owner Person');
    assert.equal(env.db.get('SELECT status FROM found_reports WHERE id = ?', id2).status, 'returned');
    assert.equal(env.db.get('SELECT status FROM claims WHERE id = ?', b).status, 'rejected');
    assert.equal(env.db.get('SELECT status FROM lost_reports WHERE id = ?', lost.body.id).status, 'resolved');
    assert.equal(env.db.get('SELECT COUNT(*) n FROM handovers WHERE found_report_id = ?', id2).n, 1);
    assert.equal((await act(staff.token, a.body.id, { action: 'handover' })).status, 409, 'cannot return twice');
    assert.equal((await claim(rival.token, id2)).status, 409, 'returned items cannot be claimed');
    // the item can no longer be approved for the other claim either
    assert.equal((await act(staff.token, b, { action: 'approve' })).status, 409);
    // DB-level: a second handover row for the same item is impossible
    assert.throws(() => env.db.run('INSERT INTO handovers (claim_id, found_report_id, handed_by, recipient_name) VALUES (?, ?, ?, ?)', b, id2, staff.id, 'Someone'), /UNIQUE|constraint/);
    const hist = (await env.call('GET', `/api/claims/${a.body.id}`, { token: staff.token })).body.history.map((h) => h.to_status);
    assert.deepEqual(hist, ['submitted', 'under_review', 'approved', 'completed']);
    assert.ok(env.db.get("SELECT 1 x FROM audit_logs WHERE action = 'claim.handover'"));
  });

  test('admin can also perform staff actions; claims on hidden found reports are refused', async () => {
    const id2 = await fresh();
    const c = (await claim(owner.token, id2)).body.id;
    assert.equal((await act(admin.token, c, { action: 'start_review' })).status, 200);
    await env.call('POST', `/api/admin/reports/found/${id2}/moderation`, { token: admin.token, body: { hidden: true, reason: 'dup' } });
    assert.equal((await claim(rival.token, id2)).status, 404);
  });

  test('claim lists filter by status and paginate; staff see claimant names, students do not see others', async () => {
    const mine = await env.call('GET', '/api/claims', { token: staff.token, query: { status: 'active', page_size: 2 } });
    assert.ok(mine.body.items.length <= 2);
    assert.ok(mine.body.items.every((i) => ['submitted', 'under_review', 'info_requested', 'approved'].includes(i.status)));
    assert.ok(mine.body.items[0].claimant_name);
    const student = await env.call('GET', '/api/claims', { token: owner.token });
    assert.equal(student.body.items.every((i) => i.claimant_name === undefined), true);
  });
});
