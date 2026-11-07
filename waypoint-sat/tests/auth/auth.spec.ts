import {test, expect, type Page} from '@playwright/test';
import {randomUUID} from 'node:crypto';
import {PostgresStore} from '../../server/database.mjs';
import {newToken, tokenHash} from '../../server/auth.mjs';

const email = () => `e2e-${randomUUID()}@example.com`;
async function signUp(page: Page, address: string, password = 'study hard every day') {
  await page.goto('/');
  await page.getByRole('button', {name:'Create an account'}).click();
  await expect(page.getByRole('heading', {name:'Create your study account.'})).toBeFocused();
  await page.getByLabel('Email').fill(address);
  await page.getByLabel('Password', {exact:true}).fill(password);
  await page.getByLabel('Confirm password').fill(password);
  await page.getByRole('button', {name:'Create account'}).click();
  await expect(page.getByRole('button', {name:'Sign out'})).toBeVisible();
}
test('new visitors must sign in; sign up opens the study space and progress survives sign out/in', async ({page}) => {
  await page.goto('/#practice');
  await expect(page.getByRole('heading', {name:'Welcome back.'})).toBeVisible();
  const address = email();
  await signUp(page, address);
  await expect(page.getByText(address)).toBeVisible();
  await page.goto('/#practice');
  await page.getByRole('radio', {name:'B. 6 days', exact:true}).check();
  await page.getByRole('button', {name:'Check answer'}).click();
  await expect(page.locator('footer')).toContainText('Saved to Railway database');
  await page.getByRole('button', {name:'Sign out'}).click();
  await expect(page.getByRole('heading', {name:'Welcome back.'})).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem('waypoint-server-cache-v1'))).toBeNull();
  await page.getByLabel('Email').fill(address.toUpperCase());
  await page.getByLabel('Password', {exact:true}).fill('wrong password here');
  await page.getByRole('button', {name:'Sign in'}).click();
  await expect(page.getByRole('alert')).toHaveText('That email and password do not match.');
  await page.getByLabel('Password', {exact:true}).fill('study hard every day');
  await page.getByRole('button', {name:'Sign in'}).click();
  await page.goto('/#practice');
  await expect(page.getByText('First attempt saved.')).toBeVisible();
});
test('sign up checks matching passwords and duplicate emails', async ({page}) => {
  const address = email();
  await signUp(page, address);
  await page.getByRole('button', {name:'Sign out'}).click();
  await page.getByRole('button', {name:'Create an account'}).click();
  await page.getByLabel('Email').fill(address);
  await page.getByLabel('Password', {exact:true}).fill('another password');
  await page.getByLabel('Confirm password').fill('different password');
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
  await page.goto(`/#reset=${token}`);
  await expect(page.getByRole('heading', {name:'Choose a new password.'})).toBeVisible();
  await page.getByLabel('New password').fill('my new password');
  await page.getByLabel('Confirm password').fill('my new password');
  await page.getByRole('button', {name:'Save new password'}).click();
  await expect(page.getByRole('button', {name:'Sign out'})).toBeVisible();
  expect(new URL(page.url()).hash).not.toContain('reset');
  await page.getByRole('button', {name:'Sign out'}).click();
  await expect(page.getByRole('heading', {name:'Welcome back.'})).toBeVisible();
  await page.goto(`/#reset=${token}`);
  await page.getByLabel('New password').fill('yet another one');
  await page.getByLabel('Confirm password').fill('yet another one');
  await page.getByRole('button', {name:'Save new password'}).click();
  await expect(page.getByRole('alert')).toContainText('expired or was already used');
});
for (const width of [1440, 390, 320]) test(`auth screens fit at ${width}px without horizontal scrolling`, async ({page}) => {
  await page.setViewportSize({width, height:800});
  for (const open of [async () => {}, async () => page.getByRole('button', {name:'Create an account'}).click(), async () => page.getByRole('button', {name:'Forgot password?'}).click()]) {
    await page.goto('/'); await page.getByRole('heading', {name:'Welcome back.'}).waitFor(); await open();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.screenshot({path:`test-results-auth/screenshots/auth-${width}-${await page.title()}.png`.replace(/[^\w./-]+/g, '_'), fullPage:true});
  }
});
for (const width of [1440, 834, 390, 320]) test(`signed-in study screens fit at ${width}px with the account controls`, async ({page}) => {
  await page.setViewportSize({width, height:800});
  await signUp(page, email());
  for (const route of ['dashboard', 'practice', 'plan']) {
    await page.goto(`/#${route}`); await page.getByRole('button', {name:'Sign out'}).waitFor();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.screenshot({path:`test-results-auth/screenshots/app-${width}-${route}.png`});
  }
});
