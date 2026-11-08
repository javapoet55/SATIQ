import {test, expect, type Page} from '@playwright/test';
import {randomUUID} from 'node:crypto';
import {PostgresStore} from '../../server/database.mjs';
import {newToken, tokenHash} from '../../server/auth.mjs';

const email = () => `e2e-${randomUUID()}@example.com`;
async function fillSignUp(page: Page, address: string, password: string, confirm = password, name = 'Alex Morgan') {
  await page.getByLabel('Full name').fill(name);
  await page.getByLabel('Email').fill(address);
  await page.getByLabel('Password', {exact:true}).fill(password);
  await page.getByLabel('Confirm password').fill(confirm);
  await page.getByLabel('I’m 13 or older and I agree to the community guidelines.').check();
}
async function signUp(page: Page, address: string, password = 'study hard every day') {
  await page.goto('./#signup');
  await expect(page.getByRole('heading', {name:'Join Prep Orbit.'})).toBeVisible();
  await fillSignUp(page, address, password);
  await page.getByRole('button', {name:'Create account'}).click();
  await expect(page.getByRole('button', {name:'Sign out'})).toBeVisible();
}
test('new visitors must sign in; sign up opens the study space and progress survives sign out/in', async ({page}) => {
  await page.goto('./#practice');
  await expect(page.getByRole('heading', {name:'Welcome back.'})).toBeVisible();
  const address = email();
  await signUp(page, address);
  await expect(page.getByText(address)).toBeVisible();
  await page.goto('./#practice');
  await page.getByRole('radio', {name:'B. 6 days', exact:true}).check();
  await page.getByRole('button', {name:'Check answer'}).click();
  await expect(page.locator('footer')).toContainText('Progress saved');
  await page.getByRole('button', {name:'Sign out'}).click();
  await expect(page.getByRole('heading', {name:'Welcome back.'})).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem('waypoint-server-cache-v1'))).toBeNull();
  await page.getByLabel('Email').fill(address.toUpperCase());
  await page.getByLabel('Password', {exact:true}).fill('wrong password here');
  await page.getByRole('button', {name:'Sign in'}).click();
  await expect(page.getByRole('alert')).toHaveText('That email and password do not match.');
  await page.getByLabel('Password', {exact:true}).fill('study hard every day');
  await page.getByRole('button', {name:'Sign in'}).click();
  await page.goto('./#practice');
  await expect(page.getByText('First attempt saved.')).toBeVisible();
});
test('sign up checks matching passwords and duplicate emails', async ({page}) => {
  const address = email();
  await signUp(page, address);
  await page.getByRole('button', {name:'Sign out'}).click();
  await page.goto('./#signup');
  await fillSignUp(page, address, 'another password', 'different password');
  await page.getByRole('button', {name:'Create account'}).click();
  await expect(page.getByRole('alert')).toHaveText('The two passwords don’t match.');
  await page.getByLabel('Confirm password').fill('another password');
  await page.getByRole('button', {name:'Create account'}).click();
  await expect(page.getByRole('alert')).toContainText('already exists');
});
test('forgot password gives a neutral answer and a reset link signs the student in with the new password', async ({page}) => {
  const address = email();
  await signUp(page, address, 'original password');
  await page.getByRole('button', {name:'Sign out'}).click();
  await page.getByRole('button', {name:'Forgot password?'}).click();
  await page.getByLabel('Email').fill(address);
  await page.getByRole('button', {name:'Send reset link'}).click();
  await expect(page.getByRole('status')).toContainText('If an account uses that email');
  // The emailed link carries a random token; create one directly so the test needs no inbox.
  const db = new PostgresStore(process.env.DATABASE_URL);
  const user = await db.findUserByEmail(address);
  const token = newToken();
  await db.createPasswordReset(tokenHash(token), user.id, Date.now() + 3600000); await db.close();
  await page.goto(`./#reset=${token}`);
  await expect(page.getByRole('heading', {name:'Choose a new password.'})).toBeVisible();
  await page.getByLabel('New password').fill('my new password');
  await page.getByLabel('Confirm password').fill('my new password');
  await page.getByRole('button', {name:'Save new password'}).click();
  await expect(page.getByRole('button', {name:'Sign out'})).toBeVisible();
  expect(new URL(page.url()).hash).not.toContain('reset');
  await page.getByRole('button', {name:'Sign out'}).click();
  await expect(page.getByRole('heading', {name:'Welcome back.'})).toBeVisible();
  await page.goto(`./#reset=${token}`);
  await page.getByLabel('New password').fill('yet another one');
  await page.getByLabel('Confirm password').fill('yet another one');
  await page.getByRole('button', {name:'Save new password'}).click();
  await expect(page.getByRole('alert')).toContainText('expired or was already used');
});
for (const width of [1440, 390, 320]) test(`auth screens fit at ${width}px without horizontal scrolling`, async ({page}) => {
  await page.setViewportSize({width, height:800});
  for (const open of [async () => {}, async () => page.getByRole('button', {name:'Create an account'}).click(), async () => page.getByRole('button', {name:'Forgot password?'}).click()]) {
    await page.goto('about:blank'); await page.goto('./#signin'); await page.getByRole('heading', {name:'Welcome back.'}).waitFor(); await open();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.screenshot({path:`test-results-auth/screenshots/auth-${width}-${await page.title()}.png`.replace(/[^\w./-]+/g, '_'), fullPage:true});
  }
});
for (const width of [1440, 834, 390, 320]) test(`signed-in study screens fit at ${width}px with the account controls`, async ({page}) => {
  await page.setViewportSize({width, height:800});
  await signUp(page, email());
  for (const route of ['dashboard', 'practice', 'plan']) {
    await page.goto(`./#${route}`); await page.getByRole('button', {name:'Sign out'}).waitFor();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.screenshot({path:`test-results-auth/screenshots/app-${width}-${route}.png`});
  }
});

test('signing up as a tutor opens the tutor profile', async ({page}) => {
  await page.goto('./#signup-tutor');
  await expect(page.getByRole('radio', {name:/I’m a tutor/})).toBeChecked();
  await fillSignUp(page, email(), 'tutor password ok', 'tutor password ok', 'Priya Sharma');
  await page.getByRole('button', {name:'Create account'}).click();
  await expect(page.getByRole('heading', {name:'Set up your tutoring profile.'})).toBeVisible();
});
test('sign up needs a first and last name and the guidelines', async ({page}) => {
  await page.goto('./#signup');
  await page.getByLabel('Full name').fill('Madonna');
  await page.getByLabel('Email').fill(email());
  await page.getByLabel('Password', {exact:true}).fill('long enough password');
  await page.getByLabel('Confirm password').fill('long enough password');
  await page.getByRole('button', {name:'Create account'}).click();
  await expect(page.getByRole('alert')).toContainText('first and last name');
  await page.getByLabel('Full name').fill('Madonna Ciccone');
  await page.getByRole('button', {name:'Create account'}).click();
  await expect(page.getByRole('alert')).toContainText('community guidelines');
});

async function profile(page: Page, fields: Record<string, string>) {
  for (const [label, value] of Object.entries(fields)) { const field = page.getByLabel(label, {exact:false}).first(); if ((await field.evaluate(el => el.tagName)) === 'SELECT') await field.selectOption(value); else await field.fill(value); }
}
test('a student asks a nearby tutor, the tutor accepts, hours are confirmed and an admin issues a certificate', async ({browser}) => {
  test.setTimeout(120000);
  const tutorEmail = email(), studentEmail = email(), adminEmail = 'admin-e2e@example.com';
  const cleanup = new PostgresStore(process.env.DATABASE_URL);
  try { await cleanup.pool.query("DELETE FROM waypoint_users WHERE email LIKE 'e2e-%@example.com'"); } finally { await cleanup.close(); }
  const tutor = await (await browser.newContext()).newPage(), student = await (await browser.newContext()).newPage();
  // Tutor signs up and completes the profile.
  await tutor.goto('./#signup-tutor');
  await fillSignUp(tutor, tutorEmail, 'tutor password ok', 'tutor password ok', 'Priya Sharma');
  await tutor.getByRole('button', {name:'Create account'}).click();
  await expect(tutor.getByRole('heading', {name:'Set up your tutoring profile.'})).toBeVisible();
  await profile(tutor, {'ZIP code':'94105', 'LinkedIn profile':'https://www.linkedin.com/in/priya-sharma-e2e', 'School or university':'Stanford University', 'About you':'Stanford sophomore who loves explaining algebra and geometry.'});
  await tutor.getByLabel('SAT Math').check();
  await tutor.screenshot({path:'test-results-auth/screenshots/profile.png', fullPage:true});
  await tutor.getByRole('button', {name:'Save profile'}).click();
  await expect(tutor.getByRole('heading', {name:'Teaching hours.'})).toBeVisible();
  // Student signs up and searches. They see only the first name and last initial, and a distance band.
  await student.goto('./#signup');
  await fillSignUp(student, studentEmail, 'student password ok', 'student password ok', 'Alex Morgan');
  await student.getByRole('button', {name:'Create account'}).click();
  await expect(student.getByRole('button', {name:'Sign out'})).toBeVisible();
  await student.goto('./#tutorprofile');
  await profile(student, {'ZIP code':'94105', 'Grade':'11th grade'});
  await student.getByRole('button', {name:'Save profile'}).click();
  await expect(student.getByRole('heading', {name:'Find a tutor near you.'})).toBeVisible();
  const card = student.locator('article.tutor-card', {hasText:'Priya S.'});
  await expect(card).toBeVisible();
  await expect(card).toContainText(/Within \d+ miles/);
  await expect(student.locator('body')).not.toContainText('Sharma');
  await expect(student.locator('body')).not.toContainText('94105');
  await student.screenshot({path:'test-results-auth/screenshots/find-tutor.png', fullPage:true});
  await card.getByRole('button', {name:/Ask Priya for help/}).click();
  await card.getByLabel(/Your note to Priya/).fill('I need help with linear equations before my SAT.');
  await card.getByRole('button', {name:'Send request'}).click();
  await expect(card.getByText('Request sent')).toBeVisible();
  // Tutor sees the student's first name and initial only until accepting.
  await tutor.goto('./#connections');
  const request = tutor.locator('article.connection-card', {hasText:'Alex M.'});
  await expect(request).toContainText('linear equations');
  await expect(tutor.locator('body')).not.toContainText('Morgan');
  await expect(tutor.locator('body')).not.toContainText(studentEmail);
  await request.getByRole('button', {name:'Accept'}).click();
  await expect(tutor.getByText(studentEmail)).toBeVisible();
  await tutor.screenshot({path:'test-results-auth/screenshots/connections.png', fullPage:true});
  await expect(tutor.getByRole('heading', {name:'Alex Morgan'})).toBeVisible();
  // Tutor logs a session; the student confirms it.
  await tutor.goto('./#teaching');
  await tutor.getByLabel('What did you work on?').fill('Linear equations and word problems');
  await tutor.getByRole('button', {name:'Log session'}).click();
  await expect(tutor.getByText('Waiting for student', {exact:true})).toBeVisible();
  await student.goto('./#teaching');
  await student.getByRole('button', {name:'Confirm', exact:true}).click();
  await expect(student.getByText('Confirmed. Thank you!')).toBeVisible();
  await tutor.reload();
  await expect(tutor.getByText('✓ Confirmed')).toBeVisible();
  // Give the tutor exactly 100 confirmed hours (a 60 minute session plus 5,940 seeded minutes), then an admin issues the certificate.
  const db = new PostgresStore(process.env.DATABASE_URL);
  let code = '';
  try {
    const t = await db.findUserByEmail(tutorEmail), connection = (await db.pool.query('SELECT id, student_id FROM waypoint_connections WHERE tutor_id = $1', [t.id])).rows[0];
    const insert = (days: number, minutes: number) => db.pool.query("INSERT INTO waypoint_hours (id, connection_id, tutor_id, student_id, session_date, minutes, note, status, decided_at) VALUES (gen_random_uuid(), $1, $2, $3, CURRENT_DATE - $4::int, $5, 'seeded', 'confirmed', NOW())", [connection.id, t.id, connection.student_id, days, minutes]);
    // 25 counted hours with this student (60 minutes logged above + 24 more), then three other students at 25 hours each.
    for (let i = 0; i < 24; i++) await insert(i + 2, 60);
    for (const n of [1, 2, 3]) {
      const u = await db.createUser(`e2e-extra${n}-${Date.now()}@example.com`, 'x', 'student');
      const cid = (await db.pool.query("INSERT INTO waypoint_connections (id, student_id, tutor_id, status, subject, message, responded_at) VALUES (gen_random_uuid(), $1, $2, 'accepted', 'SAT Math', 'seeded', NOW() - INTERVAL '90 days') RETURNING id", [u.id, t.id])).rows[0].id;
      for (let i = 0; i < 10; i++) await db.pool.query("INSERT INTO waypoint_hours (id, connection_id, tutor_id, student_id, session_date, minutes, note, status, decided_at, created_at) VALUES (gen_random_uuid(), $1, $2, $3, CURRENT_DATE - $4::int, 150, $5, 'confirmed', NOW(), NOW())", [cid, t.id, u.id, i * 3 + n, `Seeded session ${n}-${i}`]);
    }
    await db.pool.query('DELETE FROM waypoint_users WHERE email = $1', [adminEmail]);
  } finally { await db.close(); }
  await tutor.reload();
  await expect(tutor.getByText('100 hours reached')).toBeVisible();
  await tutor.screenshot({path:'test-results-auth/screenshots/teaching.png', fullPage:true});
  const admin = await (await browser.newContext()).newPage();
  await admin.goto('./#signup');
  await fillSignUp(admin, adminEmail, 'admin password ok', 'admin password ok', 'Site Admin');
  await admin.getByRole('button', {name:'Create account'}).click();
  await admin.goto('./#admin');
  await admin.getByRole('button', {name:'Tutoring', exact:true}).click();
  const row = admin.locator('article.admin-row', {hasText:'Priya S'});
  await expect(row).toContainText('100 / 100 hours count');
  admin.on('dialog', dialog => dialog.type() === 'prompt' ? dialog.accept('Emailed all four students; they confirmed.') : dialog.accept());
  await row.getByRole('button', {name:'Generate certificate'}).click();
  await expect(admin.getByText('Certificate issued.')).toBeVisible();
  await admin.screenshot({path:'test-results-auth/screenshots/admin-tutoring.png', fullPage:true});
  const check = new PostgresStore(process.env.DATABASE_URL);
  try { code = (await check.pool.query('SELECT code FROM waypoint_certificates ORDER BY issued_at DESC LIMIT 1')).rows[0].code; } finally { await check.close(); }
  // Anyone can verify the certificate, signed in or not.
  const visitor = await (await browser.newContext()).newPage();
  await visitor.goto(`./#verify/${code}`);
  await expect(visitor.getByText('Verified. This certificate was issued by Prep Orbit AI.')).toBeVisible();
  await expect(visitor.getByRole('heading', {name:'Priya Sharma'})).toBeVisible();
  await expect(visitor.getByText(/volunteered 100 hours/)).toBeVisible();
  await expect(visitor.getByText(/does not guarantee college admission/)).toBeVisible();
  await visitor.screenshot({path:'test-results-auth/screenshots/certificate.png', fullPage:true});
  await visitor.goto('./#verify/ZZZZZZZZZZZZ');
  await expect(visitor.getByRole('heading', {name:'We couldn’t verify this certificate.'})).toBeVisible();
  // The student never saw the tutor's email or full name, and the tutor sees the certificate link.
  await tutor.reload();
  await expect(tutor.getByRole('link', {name:/View, print or save your certificate/})).toBeVisible();
});
