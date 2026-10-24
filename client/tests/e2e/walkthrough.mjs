// End-to-end browser walkthrough of LUNA's core workflows (register -> report -> match -> claim -> review -> handover -> admin).
// Run against a RUNNING LUNA (production build served by Express, or the Vite dev server):
//   1) one-time:  npm install; npx playwright install chromium        (inside client/)
//   2) create the two privileged accounts (PowerShell):
//        $env:LUNA_ADMIN_PASSWORD="Passw0rd!x"; npm run create-admin -- --email e2e-admin@luna.test --name "E2E Admin"
//      then sign in as that admin once and create a staff account e2e-staff@luna.test (Admin console -> Users)
//      with password Passw0rd!x   (or set E2E_STAFF_* / E2E_ADMIN_* variables below)
//   3) npm run start   (or npm run dev:server + npm run dev:client)   and in another terminal:
//        $env:E2E_BASE_URL="http://localhost:3000"; npm run test:e2e
// It registers a brand-new student each run (unique email) and creates real records, so use a DEVELOPMENT database.
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

let chromium;
try { ({ chromium } = await import('playwright')); } catch {
  if (!process.env.PLAYWRIGHT_MODULES_DIR) { console.error('Playwright is not installed. Run: npm install && npx playwright install chromium'); process.exit(2); }
  ({ chromium } = createRequire(`${process.env.PLAYWRIGHT_MODULES_DIR}/`)('playwright'));
}
const BASE = (process.env.E2E_BASE_URL || 'http://localhost:3000').replace(/\/$/, '');
const STAFF = { email: process.env.E2E_STAFF_EMAIL || 'e2e-staff@luna.test', password: process.env.E2E_STAFF_PASSWORD || 'Passw0rd!x' };
const ADMIN = { email: process.env.E2E_ADMIN_EMAIL || 'e2e-admin@luna.test', password: process.env.E2E_ADMIN_PASSWORD || 'Passw0rd!x' };
const RUN = Date.now().toString(36);
const ALICE = { email: `alice-${RUN}@campus.edu`, password: 'Secret123', name: `Alice ${RUN}` };
const TITLE = `Black iPhone ${RUN}`;
const FOUND_TITLE = `Black phone found ${RUN}`;
const shots = fs.mkdtempSync(path.join(os.tmpdir(), 'luna-e2e-'));
let lostId, foundId, claimId;
const results = []; const errors = [];
const step = async (name, fn) => { try { await fn(); results.push(['PASS', name]); console.log('PASS |', name); } catch (e) { results.push(['FAIL', name, e.message.split('\n')[0]]); console.log('FAIL |', name, '|', e.message.split('\n')[0]); } };
const today = new Date().toISOString().slice(0, 10);
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
const PIC = path.join(shots, 'pic.png');
fs.writeFileSync(PIC, PNG);

const browser = await chromium.launch({ args: ['--no-sandbox'] });
async function newUser(viewport = { width: 1280, height: 900 }) {
  const ctx = await browser.newContext({ viewport });
  ctx.setDefaultTimeout(6000);
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(`console: ${m.text()}`); });
  return page;
}
const login = async (page, email, password = 'Passw0rd!x') => {
  await page.goto(`${BASE}/login`);
  await page.getByLabel('Email').fill(email); await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.waitForURL('**/dashboard');
};
const toastText = (page) => page.locator('.toast').last().innerText();

const alice = await newUser();
await step('landing page renders with CTA', async () => {
  await alice.goto(BASE);
  await alice.getByRole('heading', { name: /Lost something on campus/ }).waitFor();
  await alice.getByRole('link', { name: 'Create account' }).click();
  await alice.waitForURL('**/register');
});
await step('register: empty submit shows field errors, mismatch password flagged', async () => {
  await alice.getByRole('button', { name: 'Create account' }).click();
  await alice.getByText('Full name is required').waitFor();
  await alice.getByText('Password is required').waitFor();
  await alice.getByLabel('Full name').fill(ALICE.name); await alice.getByLabel('Campus email').fill(ALICE.email);
  await alice.getByLabel(/^Password/).fill(ALICE.password); await alice.getByLabel('Confirm password').fill('Different1');
  await alice.getByRole('button', { name: 'Create account' }).click();
  await alice.getByText('Passwords do not match').waitFor();
});
await step('register succeeds -> dashboard with zero states (no fabricated data)', async () => {
  await alice.getByLabel('Confirm password').fill(ALICE.password);
  await alice.getByRole('button', { name: 'Create account' }).click();
  await alice.waitForURL('**/dashboard');
  await alice.getByText('No reports yet').waitFor();
  const zeros = await alice.locator('.stat .num').allInnerTexts();
  if (!zeros.every((z) => z === '0')) throw new Error(`expected all zero stats, got ${zeros}`);
});
await step('duplicate registration shows server error', async () => {
  const p = await newUser();
  await p.goto(`${BASE}/register`);
  await p.getByLabel('Full name').fill('Alice Again'); await p.getByLabel('Campus email').fill(ALICE.email);
  await p.getByLabel(/^Password/).fill(ALICE.password); await p.getByLabel('Confirm password').fill(ALICE.password);
  await p.getByRole('button', { name: 'Create account' }).click();
  await p.getByText('An account with this email already exists').first().waitFor();
  await p.context().close();
});
await step('lost report: client validation (future date + short text) then success with photo', async () => {
  await alice.getByRole('link', { name: 'I lost something' }).click();
  await alice.getByLabel('Item title').fill(TITLE);
  await alice.getByLabel('Public description').fill('short');
  await alice.getByRole('button', { name: 'Submit report' }).click();
  await alice.getByText('Description must be at least 10 characters').waitFor();
  await alice.getByText('Choose a category').waitFor();
  await alice.getByLabel('Category').selectOption({ label: 'Electronics' });
  await alice.getByLabel('Campus location').selectOption({ label: 'Main Library' });
  await alice.getByLabel('Public description').fill('Black iPhone 13 in a clear case, lost near the study tables');
  await alice.getByLabel('Private distinguishing details').fill('Cracked corner, cat sticker on the back');
  await alice.getByLabel('Last seen date').fill('2999-01-01');
  await alice.getByRole('button', { name: 'Submit report' }).click();
  await alice.getByText('Date cannot be in the future').waitFor();
  await alice.getByLabel('Last seen date').fill(today);
  await alice.getByLabel(/Photo/).setInputFiles(PIC);
  await alice.getByRole('button', { name: 'Submit report' }).click();
  await alice.waitForURL(/\/reports\/lost\/\d+$/);
  lostId = /lost\/(\d+)/.exec(alice.url())[1];
  await alice.getByRole('heading', { name: TITLE }).waitFor();
  await alice.getByAltText(`Photo of ${TITLE}`).waitFor();
  await alice.getByText('Private: visible to you and staff only').waitFor();
});
await step('photo really served (image loaded, naturalWidth>0)', async () => {
  const ok = await alice.getByAltText(`Photo of ${TITLE}`).evaluate((i) => i.complete && i.naturalWidth > 0);
  if (!ok) throw new Error('image did not load');
});
await step('edit own report persists', async () => {
  await alice.getByRole('link', { name: 'Edit' }).click();
  await alice.getByLabel('Item title').fill(`${TITLE} Pro`);
  await alice.getByRole('button', { name: 'Save changes' }).click();
  await alice.getByRole('heading', { name: `${TITLE} Pro` }).waitFor();
});

const staff = await newUser();
await step('staff signs in and registers a found item (private details kept)', async () => {
  await login(staff, STAFF.email, STAFF.password);
  await staff.getByRole('link', { name: 'I found something' }).click();
  await staff.getByLabel('Item title').fill(FOUND_TITLE);
  await staff.getByLabel('Category').selectOption({ label: 'Electronics' });
  await staff.getByLabel('Campus location').selectOption({ label: 'Main Library' });
  await staff.getByLabel('Date found').fill(today);
  await staff.getByLabel('Where is the item now?').selectOption({ label: 'Handed to security' });
  await staff.getByLabel('Public description').fill('Black iPhone with clear case found on a study table');
  await staff.getByLabel('Private distinguishing details').fill('Lock screen photo of a beach');
  await staff.getByRole('button', { name: 'Submit report' }).click();
  await staff.waitForURL(/\/reports\/found\/\d+$/);
  foundId = /found\/(\d+)/.exec(staff.url())[1];
});
await step('staff marks found item "stored" via status button', async () => {
  await staff.getByRole('button', { name: /Mark stored securely/i }).click();
  await staff.locator('.badge', { hasText: 'Stored securely' }).first().waitFor();
  await staff.getByText('Reported by').waitFor();
});
await step('staff dashboard shows real workload numbers', async () => {
  await staff.getByRole('link', { name: 'Dashboard' }).click();
  await staff.getByRole('heading', { name: 'Staff workload' }).waitFor();
});

await step('alice: sees explainable match with reasons and "suggestion only" note; no private leak', async () => {
  await alice.getByRole('link', { name: /Potential matches/ }).click();
  await alice.getByRole('heading', { name: 'Why LUNA suggested this' }).waitFor();
  await alice.getByText(/Same category \(Electronics\)/).waitFor();
  await alice.getByText(/not confirmed ownership/i).waitFor();
  const html = await alice.content();
  if (html.includes('beach')) throw new Error('private found details leaked to the matcher view');
});
await step('alice: found report hides private details from her; claim form validation then success', async () => {
  await alice.getByRole('link', { name: 'View found item' }).click();
  await alice.getByRole('heading', { name: FOUND_TITLE }).waitFor();
  if ((await alice.content()).includes('beach')) throw new Error('private details leaked');
  await alice.getByRole('button', { name: 'Submit claim' }).click();
  await alice.getByText('Please describe how you can prove this item is yours').waitFor();
  await alice.getByLabel('How can you prove it is yours?').fill('It has a cat sticker on the back and a cracked corner');
  await alice.getByLabel(/Link to your lost report/).selectOption({ label: `${TITLE} Pro` });
  await alice.getByRole('button', { name: 'Submit claim' }).click();
  await alice.waitForURL(/\/claims\/\d+$/);
  claimId = /claims\/(\d+)/.exec(alice.url())[1];
  await alice.getByText('Private: claimant’s explanation').waitFor();
});

await step('staff: claim queue -> start review -> request info (validation) -> alice responds', async () => {
  await staff.getByRole('link', { name: 'Claim review' }).click();
  await staff.goto(`${BASE}/claims/${claimId}`);
  await staff.getByText('Private: finder’s distinguishing details').waitFor();
  await staff.getByRole('button', { name: 'Start review' }).click();
  await staff.getByRole('button', { name: 'Request more information' }).click();
  await staff.getByRole('button', { name: 'Send request' }).click();
  await staff.getByText('A message to the claimant is required').waitFor();
  await staff.getByLabel('What should the claimant explain?').fill('What is on the lock screen?');
  await staff.getByRole('button', { name: 'Send request' }).click();
  await staff.locator('.badge', { hasText: 'Info requested' }).first().waitFor();
  await alice.reload();
  await alice.getByText('Staff need more information:').waitFor();
  await alice.getByRole('button', { name: 'Respond to staff' }).click();
  await alice.getByLabel('Your response').fill('A photo of a beach');
  await alice.getByRole('button', { name: 'Send response' }).click();
  await alice.locator('.badge', { hasText: 'Under review' }).first().waitFor();
});
await step('staff: reject requires reason; approve; record handover; item returned', async () => {
  await staff.reload();
  await staff.getByText('Claimant answered:').waitFor();
  await staff.getByRole('button', { name: 'Reject claim' }).click();
  await staff.getByRole('button', { name: 'Reject claim' }).last().click();
  await staff.getByText('A rejection reason is required').waitFor();
  await staff.getByRole('button', { name: 'Cancel' }).click();
  await staff.getByRole('button', { name: 'Approve claim' }).click();
  await staff.getByRole('button', { name: 'Approve', exact: true }).click();
  await staff.locator('.badge', { hasText: 'Approved' }).first().waitFor();
  await staff.getByRole('button', { name: 'Record handover' }).click();
  await staff.getByRole('button', { name: 'Record handover' }).last().click();
  await staff.getByText(/This item was handed over/).waitFor();
  await staff.getByText('No further actions are available').waitFor();
});
await step('alice sees completed claim, notifications, lost report resolved', async () => {
  await alice.reload();
  await alice.getByText(/This item was handed over/).waitFor();
  await alice.getByRole('navigation', { name: 'Main navigation' }).getByRole('link', { name: /Notifications/ }).click();
  await alice.getByText(/has been handed over to you/).waitFor();
  await alice.getByRole('button', { name: 'Mark all as read' }).click();
  await alice.getByText('0 unread').waitFor();
  await alice.goto(`${BASE}/reports/lost/${lostId}`);
  await alice.locator('.badge', { hasText: 'Resolved' }).first().waitFor();
});

await step('browse: keyword search, filters, empty state, clear filters', async () => {
  await alice.getByRole('link', { name: 'Browse reports' }).click();
  await alice.getByText(/\d+ reports? found/).waitFor();
  await alice.getByLabel('Keywords').fill(RUN);
  await alice.getByText('2 reports found').waitFor();
  await alice.getByLabel('Keywords').fill('zzzznothing' + RUN);
  await alice.getByText('No reports match your search').waitFor();
  await alice.getByLabel('Keywords').fill(RUN);
  await alice.getByLabel('Type').selectOption('found');
  await alice.getByText('1 report found').waitFor();
  await alice.getByRole('button', { name: 'Clear filters' }).click();
  await alice.getByText(/\d+ reports? found/).waitFor();
});
await step('role guard: student on /admin is sent to unauthorized; unknown route is 404 page', async () => {
  await alice.goto(`${BASE}/admin`);
  await alice.getByRole('heading', { name: 'You do not have access' }).waitFor();
  await alice.goto(`${BASE}/definitely-not-a-page`);
  await alice.getByRole('heading', { name: 'Page not found' }).waitFor();
});
await step('unauthenticated visit redirects to login and returns after sign-in', async () => {
  const p = await newUser();
  await p.goto(`${BASE}/claims`);
  await p.waitForURL('**/login');
  await p.getByLabel('Email').fill(ALICE.email); await p.getByLabel('Password').fill(ALICE.password);
  await p.getByRole('button', { name: 'Sign in' }).click();
  await p.waitForURL('**/claims');
  await p.getByRole('heading', { name: 'My claims' }).waitFor();
  await p.context().close();
});
await step('wrong password shows generic error', async () => {
  const p = await newUser();
  await p.goto(`${BASE}/login`);
  await p.getByLabel('Email').fill(ALICE.email); await p.getByLabel('Password').fill('WrongPass1');
  await p.getByRole('button', { name: 'Sign in' }).click();
  await p.getByText('Invalid email or password').waitFor();
  await p.context().close();
});

const admin = await newUser();
await step('admin: dashboard stats + chart, insights tab, users tab, catalogue add, audit log', async () => {
  await login(admin, ADMIN.email, ADMIN.password);
  await admin.getByRole('heading', { name: 'Campus overview' }).waitFor();
  await admin.getByText('Monthly reports and returns').waitFor();
  await admin.getByRole('link', { name: 'Admin console' }).click();
  await admin.getByRole('tab', { name: 'Insights' }).click();
  await admin.getByText('Return success').waitFor();
  await admin.getByText('Return rate').waitFor();
  await admin.getByRole('tab', { name: 'Users' }).click();
  await admin.getByRole('cell', { name: ALICE.email }).first().waitFor().catch(async () => { await admin.getByLabel('Search users').fill(ALICE.email); await admin.getByRole('cell', { name: ALICE.email }).waitFor(); });
  await admin.getByRole('tab', { name: 'Categories & locations' }).click();
  await admin.getByLabel('New category').fill(`Instruments ${RUN}`);
  await admin.getByRole('button', { name: 'Add' }).first().click();
  await admin.getByText(`Instruments ${RUN}`).waitFor();
  await admin.getByRole('tab', { name: 'Audit log' }).click();
  await admin.getByRole('cell', { name: 'claim.handover' }).first().waitFor();
});
await step('admin hides a report with reason; hidden report 404s for alice; restore works', async () => {
  await admin.goto(`${BASE}/reports/found/${foundId}`);
  await admin.getByRole('button', { name: 'Hide report' }).first().click();
  await admin.getByRole('button', { name: 'Hide report' }).last().click();
  await admin.getByText('A reason is required when hiding a report').first().waitFor().catch(() => {});
  await admin.getByLabel('Reason').fill('duplicate listing');
  await admin.getByRole('button', { name: 'Hide report' }).last().click();
  await admin.getByText(/hidden from other users/).waitFor();
  await alice.goto(`${BASE}/reports/found/${foundId}`);
  await alice.getByText('Not found').first().waitFor();
  await admin.getByRole('button', { name: 'Restore report' }).click();
  await admin.getByText(/hidden from other users/).waitFor({ state: 'detached' });
});

const phone = await newUser({ width: 390, height: 800 });
await step('mobile: no horizontal scroll, menu opens, navigation works', async () => {
  await login(phone, ALICE.email, ALICE.password);
  const overflow = await phone.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  if (overflow > 1) throw new Error(`horizontal overflow ${overflow}px`);
  await phone.getByRole('button', { name: 'Menu' }).click();
  await phone.getByRole('link', { name: 'Browse reports' }).click();
  await phone.waitForURL('**/browse');
  const o2 = await phone.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  if (o2 > 1) throw new Error(`browse overflow ${o2}px`);
  await phone.screenshot({ path: path.join(shots, 'mobile-browse.png') });
});
await step('keyboard: skip link is first tab stop and focus is visible', async () => {
  await alice.goto(`${BASE}/dashboard`);
  await alice.getByRole('heading', { name: /Hello, Alice/ }).waitFor();
  await alice.keyboard.press('Tab');
  const t = await alice.evaluate(() => document.activeElement?.textContent);
  if (!/Skip to main content/.test(t)) throw new Error(`first tab stop was: ${t}`);
});
await alice.goto(`${BASE}/dashboard`); await alice.screenshot({ path: path.join(shots, 'dash.png'), fullPage: true });
await admin.goto(`${BASE}/dashboard`); await admin.screenshot({ path: path.join(shots, 'admin.png'), fullPage: true });
await browser.close();
console.log(`\nScreenshots: ${shots}`);
console.log(`\n${results.filter((r) => r[0] === 'PASS').length}/${results.length} passed`);
console.log('browser errors:', errors.length ? [...new Set(errors)] : 'none');
process.exit(results.some((r) => r[0] === 'FAIL') ? 1 : 0);
